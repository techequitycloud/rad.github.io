---
title: "Matomo sur GKE Autopilot"
description: "Référence de configuration pour déployer Matomo sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Matomo_GKE.md @ 3055034 sha256:2d47b526ffa3 -->

# Matomo sur GKE Autopilot {#matomo-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Matomo_GKE.png" alt="Matomo sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Matomo est la principale plateforme open source d'analyse web et une alternative
auto-hébergée et respectueuse de la vie privée à Google Analytics — sans
échantillonnage des données, avec un suivi compatible RGPD/CCPA, des cartes de
chaleur, des enregistrements de sessions, des tests A/B et des analyses
d'entonnoir, et une propriété à 100 % des données collectées. Ce module déploie
Matomo sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Matomo et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que
de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Matomo s'exécute sous forme d'une charge de travail web PHP/Apache unique,
construite à partir de l'image officielle précompilée. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache (`matomo:<application_version>`) sur le port 80, 1 vCPU / 2 GiB par défaut |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — le moteur est fixé à `MYSQL_8_0` |
| Persistance des fichiers | Cloud Filestore (NFS) | La racine documentaire de Matomo (`/var/www/html`) persiste ici, partagée entre les pods |
| Cache | Redis (co-hébergé sur la VM NFS ou Memorystore) | Cache d'objets facultatif ; connectivité uniquement — voir la [section 6](#6-configuration-pitfalls--sensible-defaults) |
| Stockage d'objets | Cloud Storage | Un bucket `data` provisionné automatiquement |
| Secrets | Secret Manager | Uniquement le mot de passe de l'utilisateur applicatif Cloud SQL, généré automatiquement |
| Entrée | Cloud Load Balancing | LoadBalancer externe avec une adresse IP statique réservée ; domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la
  couche applicative partagée (`Matomo_Common` code en dur
  `database_type = "MYSQL_8_0"`) ; les autres moteurs ne sont pas pris en charge.
- **L'image officielle précompilée est utilisée par défaut.** `container_image_source =
  "prebuilt"` déploie directement `matomo:<application_version>` (par défaut
  `5-apache`) — sans étape Cloud Build. L'image est mise en miroir dans Artifact
  Registry (`enable_image_mirroring = true`) pour éviter les limites de débit de
  Docker Hub.
- **Cloud SQL est joint via le sidecar Auth Proxy sur l'adresse de bouclage.** GKE
  injecte `enable_cloudsql_volume = true` par défaut ; un sidecar cloud-sql-proxy
  écoute sur `127.0.0.1:3306`, et la plateforme fait correspondre les
  identifiants de base de données propres au déploiement à
  `MATOMO_DATABASE_HOST`/`USERNAME`/`DBNAME`/`PASSWORD` — exactement les
  variables d'environnement que lit le plugin `EnvironmentVariables` de Matomo
  pour préremplir l'écran de base de données de l'installateur web.
- **NFS est activé par défaut** (`enable_nfs = true`, monté sur
  `/var/www/html`), ce qui rend persistants la configuration de Matomo
  (`config.ini.php`), les plugins installés et les ressources générées. Le point
  d'entrée de l'image officielle remplit un volume vide à partir de
  `/usr/src/matomo` au premier démarrage.
- **Un seul réplica par défaut.** `min_instance_count = 1`, `max_instance_count
  = 1`. `session_affinity = ClientIP` maintient les requêtes d'un client sur le
  même pod ; la charge de travail adossée à NFS est déployée avec la stratégie de
  mise à jour `Recreate`, de sorte qu'une mise à jour progressive n'exécute
  jamais deux pods simultanément sur le même volume NFS et la même base de
  données partagée.
- **Aucun secret applicatif n'est généré automatiquement.** Contrairement aux
  applications qui créent un secret de mot de passe administrateur ou de sel
  d'instance, le seul secret géré de Matomo est le mot de passe de l'utilisateur
  applicatif Cloud SQL. Le compte superutilisateur de Matomo est créé de manière
  interactive via l'installateur web lors de la première visite — aucun job
  d'initialisation ne le provisionne.
- **`db-init` ne crée que la base de données vide et l'utilisateur ; l'installateur
  web fait le reste.** Il n'existe pas de job de migration de schéma sans
  interface — l'assistant d'installation de Matomo, accessible à l'URL du
  service, crée le schéma et le premier compte administrateur.
- **La connectivité Redis est câblée mais pas exploitée automatiquement.**
  `enable_redis = true` injecte par défaut `REDIS_HOST`/`REDIS_PORT` dans le pod,
  mais rien dans ce module ne modifie le backend `[Cache]` de `config.ini.php` de
  Matomo — utiliser Redis comme cache d'objets de Matomo nécessite toujours une
  configuration manuelle après le déploiement.
  {/* TODO: verify whether the official Matomo image or a plugin auto-detects
  REDIS_HOST; not confirmed from this repo's sources. */}

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Matomo {#a-gke-autopilot--the-matomo-workload}

Les pods Matomo sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. Comme la charge de travail est adossée à NFS,
le Deployment utilise la stratégie `Recreate` (une mise à jour progressive
exécuterait deux pods sur le même volume NFS et la même base de données
partagée, et provoquerait un interblocage).

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge
  de travail Matomo pour consulter les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à
l'échelle et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Matomo stocke toutes les données d'analyse (sites, visites, tables de journaux,
rapports, utilisateurs) dans une instance gérée Cloud SQL for MySQL 8.0. Les pods
la joignent via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:3306` ;
aucune adresse IP publique n'est exposée. Lors du premier déploiement, le job
`db-init` crée la base de données de l'application, l'utilisateur et les droits ;
l'installateur web de Matomo crée ensuite le schéma.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs).
Consultez [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatiques et la rotation des mots de passe.

### C. Cloud Storage et persistance des fichiers {#c-cloud-storage--file-persistence}

Un bucket **Cloud Storage** dédié (suffixe par défaut `data`) est provisionné
automatiquement et l'accès est accordé au compte de service de la charge de
travail. Par ailleurs, la racine documentaire de Matomo réside sur **NFS (Cloud
Filestore)** à `/var/www/html`, partagée entre les pods — la configuration, les
plugins et les ressources de rapports générées y persistent à travers les
redémarrages des pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~-data"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Le seul secret applicatif utilisé par Matomo est le mot de passe de l'utilisateur
applicatif Cloud SQL, généré et géré par le module de secrets partagé du socle
(aucun secret de mot de passe administrateur ou de sel propre à Matomo n'est
créé). Sur GKE, les secrets sont projetés dans les pods via le pilote Secret
Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~matomo"
  gcloud secrets versions access latest --secret=<db-password-secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la
rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud
Load Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true` pour
que l'adresse survive aux redéploiements). Un domaine personnalisé avec un
certificat géré par Google peut être activé.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'adresse IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les
métriques de GKE et de Cloud SQL sont envoyées vers Cloud Monitoring. Des tests
de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Matomo {#3-matomo-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` exécute un script avec `mysql:8.0-debian`. Il se connecte à Cloud SQL
  (via le socket du sidecar Auth Proxy, avec repli sur TCP vers l'adresse IP
  privée), crée de manière idempotente la base de données de l'application et
  l'utilisateur, accorde les privilèges, vérifie que l'utilisateur de
  l'application peut se connecter, puis arrête proprement le sidecar du proxy
  (`quitquitquit`, afin que le job se termine avec le code `0` et ne soit pas
  relancé sous `restartPolicy: OnFailure`). Le job peut être relancé sans risque
  (`execute_on_apply = true`, `max_retries = 3`).
- **Pas d'installation du schéma sans interface.** Matomo n'exécute pas de job
  de migration au démarrage. La base de données vide créée par `db-init` est
  remplie par l'assistant d'installation de Matomo, accessible en visitant l'URL
  du service — il passe par la vérification du système, la connexion à la base
  de données (préremplie à partir de `MATOMO_DATABASE_*`) et la création du
  premier compte superutilisateur.
- **Les variables d'environnement de la base de données préremplissent
  l'installateur sans le terminer automatiquement.** La plateforme injecte
  `MATOMO_DATABASE_HOST` (`127.0.0.1` via le sidecar du proxy),
  `MATOMO_DATABASE_USERNAME`, `MATOMO_DATABASE_DBNAME` et
  `MATOMO_DATABASE_PASSWORD` — lues par le plugin `EnvironmentVariables` de
  Matomo pour préremplir l'écran de connexion à la base de données de
  l'installateur. Vous devez tout de même parcourir l'installateur pour terminer
  la configuration et créer le compte administrateur.
- **Le préfixe des tables et l'adaptateur sont fixes.** `MATOMO_DATABASE_ADAPTER=mysql` et
  `MATOMO_DATABASE_TABLES_PREFIX=matomo_` sont définis par `Matomo_Common` et ne
  sont pas exposés comme variables du module.
- **Les déploiements adossés à NFS utilisent `Recreate`.** Les mises à jour
  arrêtent l'ancien pod avant de démarrer le nouveau, ce qui évite un
  interblocage de deux pods sur le volume NFS partagé et les verrous de la base
  de données.
- **Sondes de santé.** La sonde de démarrage est une sonde **TCP** sur `/` avec
  un délai initial généreux de 30 s, une période de 15 s et un seuil de 40 échecs
  (~10.5 min au total) — ce qui laisse au point d'entrée de l'image le temps de
  remplir la racine documentaire montée sur NFS à partir de `/usr/src/matomo` et
  de joindre la base de données au premier démarrage. Le seuil a été relevé de
  20 (~5.5 min) après un mode de défaillance confirmé : l'extraction n'est pas
  toujours terminée en 5.5 minutes sur la racine documentaire montée sur NFS, et
  un SIGKILL de la sonde de démarrage en pleine extraction laisse une
  arborescence partiellement copiée, appartenant à root, qui ne se répare pas
  d'elle-même au redémarrage (voir Pièges de configuration). La sonde de vivacité
  est une sonde **HTTP** `GET /` avec un délai initial de 300 s (un 200/302 vers
  l'installateur compte comme sain).
- **Inspecter le job d'initialisation et la configuration en cours :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep MATOMO_DATABASE
  ```
- **Contrainte de mise à l'échelle.** Conservez `max_instance_count = 1` tant
  que le comportement des sessions et des verrous NFS avec plusieurs pods n'a pas
  été vérifié — Matomo ne coordonne pas nativement les écritures d'archivage et
  de journaux de suivi entre des réplicas partageant un même volume NFS et une
  même base de données.
- **Le cron et l'archivage ne sont pas câblés.** Ce module ne provisionne pas de
  CronJob pour le traitement périodique des archives de Matomo
  (`console core:archive`) ; si un prétraitement planifié des rapports est
  nécessaire, ajoutez-en un via la variable générique `cron_jobs` (groupe 11)
  pointant vers l'image et la commande déployées.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Matomo ou notables pour
lui sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md)
avec leur comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `matomo` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `5-apache` | Tag de l'image officielle de Matomo à déployer. Utilisez un tag de variante Apache (par ex. `5.11-apache`, `latest`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | `prebuilt` déploie directement l'image officielle de Matomo ; `custom` effectue un build via Cloud Build. |
| `container_port` | `80` | Matomo/Apache écoute sur le port 80. |
| `cpu_limit` | `1000m` | Limite de CPU du conteneur Matomo. |
| `memory_limit` | `2Gi` | Limite de mémoire ; Matomo avec les plugins courants nécessite généralement au moins 512Mi. |
| `min_instance_count` | `1` | Conservez 1 pour que la charge de travail reste accessible. |
| `max_instance_count` | `1` | **Conservez 1** tant que le comportement NFS et des sessions avec plusieurs pods n'a pas été vérifié. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (adresse de bouclage) — obligatoire sur GKE. |
| `php_memory_limit` | `512M` | `memory_limit` de PHP ; doit être ≤ `memory_limit`. S'applique uniquement à un build d'image `custom`. |
| `upload_max_filesize` | `64M` | Taille maximale d'un envoi unique (par ex. importation de fichiers journaux). Doit être ≤ `post_max_size`. |
| `post_max_size` | `64M` | Taille maximale du corps d'une requête POST. Doit être ≥ `upload_max_filesize`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Adresse IP externe pour l'interface de Matomo. |
| `workload_type` | `null` → `Deployment` | Deployment (adossé à NFS, stratégie `Recreate`). |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne le même pod. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP `/`, délai de 30 s, période de 15 s, 40 échecs (~10.5 min) | Surcharge propre à Matomo avec un seuil généreux pour le remplissage NFS et la connexion à la base de données au premier démarrage. |
| `liveness_probe` | HTTP `/`, délai de 300 s, période de 60 s, 3 échecs | Confirme qu'Apache/PHP répond (un 200/302 vers l'installateur compte comme sain). |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que `config.ini.php`, les plugins et les ressources générées persistent et soient partagés. |
| `nfs_mount_path` | `/var/www/html` | Racine documentaire de Matomo ; le point d'entrée de l'image remplit un volume vide à partir de `/usr/src/matomo` au premier démarrage. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Injecte `REDIS_HOST`/`REDIS_PORT` dans le pod pour une utilisation comme cache d'objets de Matomo. Connectivité uniquement — voir la [section 6](#6-configuration-pitfalls--sensible-defaults). |
| `redis_host` | `""` | Laissez vide pour utiliser par défaut l'adresse IP du Redis co-hébergé sur le serveur NFS ; définissez-la explicitement pour Memorystore. |
| `redis_port` | `6379` | Port Redis standard. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` (fixé par Matomo_Common) | Seul MySQL est pris en charge. |
| `application_database_name` | `matomo` | Nom de la base de données, injecté sous la forme `MATOMO_DATABASE_DBNAME`. Immuable après le premier déploiement. |
| `application_database_user` | `matomo` | Utilisateur de la base de données de l'application, injecté sous la forme `MATOMO_DATABASE_USERNAME` ; mot de passe généré automatiquement dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Adresse IP externe stable à travers les redéploiements. |
| `application_domains` | `[]` | Noms d'hôte personnalisés et certificat géré. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsqu'une adresse IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Matomo. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration
> par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan — un `StatefulSet` imposé en même temps qu'un
> paramètre sans état, IAP sans identités autorisées, des `quota_memory_*`
> fournis sous forme d'entiers bruts, un `container_port`/
> `backup_retention_days` hors plage. Une configuration invalide fait échouer le
> **plan** avec une erreur claire et nommée avant la création de toute ressource,
> de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt
> qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critical | Matomo exige MySQL/MariaDB ; le moteur ne peut pas être remplacé par Postgres. |
| `application_database_name` / `application_database_user` | Défini une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et rend orphelines toutes les données d'analyse. |
| `enable_nfs` | `true` | High | Le désactiver rend `config.ini.php`, les plugins installés et les ressources générées éphémères — perdus lors de la recréation du pod, ce qui casse le site après le premier redémarrage. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy sur `127.0.0.1:3306` est requis pour la connectivité à la base de données sur GKE. |
| `max_instance_count` | `1` | High | Dépasser 1 sans avoir vérifié le comportement du stockage partagé et des sessions expose à des sessions fragmentées et à une contention des verrous NFS/base de données pendant le traitement des archives. |
| `session_affinity` | `ClientIP` | High | Sans affinité, les requêtes passent d'un pod à l'autre et perturbent la session de l'interface d'administration. |
| `container_port` | `80` | Critical | Matomo/Apache sert sur le port 80 ; une incohérence fait échouer toutes les sondes de vivacité et de démarrage, et le Deployment ne devient jamais Ready. |
| `memory_limit` | `2Gi` | High | En dessous d'environ 512Mi, le pod PHP/Apache subit des OOM sous charge, en particulier pendant la génération des archives et des rapports. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers bruts sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `enable_redis` | `true`, avec un vrai backend de cache configuré après le déploiement | Medium | Les variables d'environnement seules ne configurent pas le backend `[Cache]` de Matomo — laisser Redis « activé » sans service joignable (par ex. `redis_host` vide et aucun Redis co-hébergé) peut provoquer des erreurs de connexion sans réel bénéfice de mise en cache. |
| `reserve_static_ip` | `true` | Medium | Sans elle, l'adresse IP externe peut changer d'un redéploiement à l'autre, ce qui casse le DNS et toutes les URL de suivi enregistrées ou intégrées. |
| `backup_retention_days` | `7` (à augmenter pour la prod) | Medium | Trop court pour une conservation conforme des sauvegardes historiques des données d'analyse. |
| `startup_probe.failure_threshold` | `40` (~10.5 min) | Critical | Le point d'entrée de l'image remplit par `tar` la racine documentaire montée sur NFS à partir de `/usr/src/matomo` en tant que root, et n'exécute `chown -R` qu'une fois l'extraction terminée ; un seuil trop serré envoie un SIGKILL au conteneur en pleine copie, laissant une racine documentaire corrompue de manière permanente et appartenant partiellement à root (erreurs composer/vendor « not installed ») qui ne se répare **pas** d'elle-même au redémarrage — la récupération exige de vider manuellement `/var/www/html` sur le volume NFS et de laisser le point d'entrée le remplir à nouveau. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Matomo,
partagée avec la variante Cloud Run, est décrite dans
**[Matomo_Common](Matomo_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Matomo sur GKE Autopilot](../labs/Matomo_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Matomo sur Google Cloud Run](Matomo_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Matomo Common — Configuration applicative partagée](Matomo_Common.md) — la configuration partagée par les deux cibles de déploiement.
