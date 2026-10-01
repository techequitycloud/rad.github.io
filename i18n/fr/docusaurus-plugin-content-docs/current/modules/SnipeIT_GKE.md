---
title: "Snipe-IT sur GKE Autopilot"
description: "Référence de configuration pour déployer Snipe-IT sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/SnipeIT_GKE.md @ 3055034 sha256:f22b53997151 -->

# Snipe-IT sur GKE Autopilot {#snipe-it-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SnipeIT_GKE.png" alt="Snipe-IT sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Snipe-IT est un système libre et open source de gestion des actifs et de
l'inventaire informatiques, utilisé pour suivre le matériel, les licences
logicielles, les accessoires et les consommables, avec l'attribution et la
restitution des actifs, la journalisation d'audit, l'amortissement et une API
REST complète. Il repose sur Laravel/PHP et s'exécute derrière Apache. Ce module
déploie Snipe-IT sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide porte sur les services cloud qu'utilise Snipe-IT et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — consultez le
[guide du socle App_GKE](App_GKE.md) plutôt que de les retrouver répétés ici.

---

## 1. Vue d'ensemble {#1-overview}

Snipe-IT s'exécute comme une seule charge de travail web PHP/Apache, récupérée
directement depuis l'image officielle de Docker Hub. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache préconstruits `snipe/snipe-it` sur le port 80, 1 vCPU / 2 GiB par défaut |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — le moteur est fixé à `MYSQL_8_0` |
| Persistance des fichiers | Cloud Filestore (NFS) | Les images d'actifs, signatures et codes-barres téléversés ainsi que le keystore d'exécution sont conservés sous `/var/lib/snipeit`, partagés entre les pods |
| Stockage d'objets | Cloud Storage | Un bucket `snipeit-uploads` provisionné automatiquement |
| Secrets | Secret Manager | `APP_KEY` Laravel généré automatiquement ; mot de passe de la base de données géré par le socle |
| Entrée | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé + certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Image officielle préconstruite, sans build personnalisé.** `container_image_source =
  "prebuilt"` déploie `snipe/snipe-it:<application_version>` (tag par défaut
  `v8-latest`) directement depuis Docker Hub, mise en miroir dans Artifact Registry
  lorsque `enable_image_mirroring = true`. Il n'y a pas d'étape Cloud
  Build/Dockerfile.
- **MySQL 8.0 est obligatoire.** `SnipeIT_Common` fixe `database_type =
  "MYSQL_8_0"`; les autres moteurs ne sont pas pris en charge.
- **Cloud SQL est joint via le sidecar Auth Proxy sur l'interface de bouclage.** La variante
  définit `enable_cloudsql_volume = true` et la configuration fusionnée impose `DB_HOST =
  127.0.0.1`; `main.tf` code en dur `db_user_env_var_name = "DB_USERNAME"`,
  `db_name_env_var_name = "DB_DATABASE"`, et `db_password_env_var_name =
  "DB_PASSWORD"` — les noms de variables d'environnement natifs de Laravel, et
  non les valeurs par défaut génériques `DB_*` du socle.
- **Un seul réplica par défaut.** `min_instance_count = 1`,
  `max_instance_count = 1`. `enable_pod_disruption_budget` vaut `false` par
  défaut en conséquence. L'état des sessions utilise `SESSION_DRIVER = "database"`
  afin que les sessions survivent aux redémarrages, même avec un seul réplica.
- **NFS est activé par défaut** (`enable_nfs = true`, monté sur
  `/var/lib/snipeit`) afin que les images d'actifs, signatures et codes-barres
  téléversés soient conservés et partagés entre les pods. `network_tags = ["nfsserver"]`
  est requis pour la connectivité NFS.
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un client
  atteignent le même pod.
- **Deux jobs d'initialisation ordonnés s'exécutent à chaque apply.** `db-init`
  (crée la base de données et l'utilisateur via `mysql:8.0-debian`) s'exécute
  en premier, puis `migrate` (`php
  artisan migrate --force` sur l'image `snipe/snipe-it`) — toutes deux en
  `execute_on_apply = true`, et peuvent être relancées sans risque.
- **Un `APP_KEY` Laravel est généré automatiquement** et stocké dans Secret
  Manager, puis injecté comme variable d'environnement secrète `APP_KEY`. Le
  supprimer/recréer invalide les sessions et toutes les données que Snipe-IT a
  chiffrées avec l'ancienne clé.
- **Redis est activé par défaut** (`enable_redis = true`) ; lorsque `redis_host`
  est vide, `REDIS_HOST` est résolu vers l'IP du serveur NFS.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Snipe-IT {#a-gke-autopilot--the-snipe-it-workload}

Les pods Snipe-IT sont planifiés sur Autopilot, qui facture le CPU et la mémoire
que les pods demandent réellement. La charge de travail est déployée comme un
`Deployment` (et non un `StatefulSet`) qui lit et écrit son état sur le volume
NFS partagé et dans Cloud SQL.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Snipe-IT pour consulter les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la manière dont Autopilot, la mise à
l'échelle et le type de charge de travail (Deployment ou StatefulSet) sont gérés.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Snipe-IT stocke toutes les données de l'application (actifs, licences,
accessoires, consommables, utilisateurs, piste d'audit) dans une instance gérée
Cloud SQL for MySQL 8.0. Les pods la joignent via le sidecar **Cloud SQL Auth
Proxy** sur `127.0.0.1:3306` ; aucune IP publique n'est exposée. Lors du premier
déploiement, la tâche `db-init` crée la base de données, l'utilisateur et les
autorisations de l'application ; la tâche `migrate` exécute ensuite
`artisan migrate --force` de Laravel pour créer le schéma.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions,
  les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [Sorties](#5-outputs).
Consultez [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatiques et la rotation des mots de passe.

### C. Cloud Storage et persistance des fichiers {#c-cloud-storage--file-persistence}

Un bucket **Cloud Storage** dédié (suffixe `snipeit-uploads`) est provisionné
automatiquement et l'accès en est accordé au compte de service de la charge de
travail. Par ailleurs, l'arborescence des données d'exécution de Snipe-IT
(images d'actifs, signatures, codes-barres téléversés, keystore) réside sur
**NFS (Cloud Filestore)** dans `/var/lib/snipeit`, partagée entre les pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~snipeit-uploads"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret Snipe-IT est généré automatiquement et stocké dans Secret Manager :
l'`APP_KEY` Laravel (`base64:<...>`, 32 octets aléatoires encodés en base64). Le
mot de passe de la base de données est géré séparément par le socle. Sur GKE,
les secrets sont projetés dans les pods via le pilote Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~snipeit"
  gcloud secrets versions access latest --secret=<app-key-secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration de Secret Store CSI et la
rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing
externe (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que
l'adresse survive aux redéploiements). `enable_custom_domain = true` provisionne
un Ingress Kubernetes ; ajoutez des noms d'hôte via `application_domains` pour
obtenir un certificat géré par Google.

- **Console :** Network services → Load balancing ; VPC network →
  IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et
les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les
métriques de GKE et de Cloud SQL sont envoyées à Cloud Monitoring. Des tests de
disponibilité et des règles d'alerte facultatifs sont disponibles
(`uptime_check_config.enabled = false` par défaut).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Snipe-IT {#3-snipe-it-application-behaviour}

- **Configuration de la base de données au premier déploiement.** La tâche
  `db-init` s'exécute sur `mysql:8.0-debian` et crée de manière idempotente la
  base de données, l'utilisateur et les autorisations de l'application (elle
  peut être relancée sans risque — `execute_on_apply = true`, `max_retries = 3`).
- **Tâche de migration explicite, et non une migration automatique au démarrage.**
  Contrairement à certaines applications Laravel qui effectuent leurs
  migrations au démarrage du conteneur, Snipe-IT exécute ici un job
  d'initialisation `migrate` explicite (`php /var/www/html/artisan migrate --force`,
  qui dépend de `db-init`, `max_retries = 2`) afin que le schéma soit prêt avant
  que la première révision de l'application ne serve du trafic. Le comportement
  de migration automatique au démarrage de l'image officielle, s'il existe,
  constitue un filet de sécurité secondaire.
- **Mappage des variables d'environnement de la base de données vers les noms Laravel.** `main.tf` code en dur
  `db_user_env_var_name = "DB_USERNAME"`, `db_name_env_var_name =
  "DB_DATABASE"` et `db_password_env_var_name = "DB_PASSWORD"` afin que le
  socle injecte les identifiants de base de données propres au tenant
  directement sous les noms qu'attend la configuration Laravel de Snipe-IT —
  aucun alias dans le point d'entrée n'est nécessaire.
  `DB_HOST` est imposé à `127.0.0.1` (le sidecar Auth Proxy) et `DB_PORT =
  "3306"` est défini par `SnipeIT_Common`.
- **Persistance des sessions, du cache et de la file d'attente.** `SnipeIT_Common` définit
  `SESSION_DRIVER = "database"`, `CACHE_DRIVER = "file"` et `QUEUE_DRIVER =
  "database"` afin que les sessions et les tâches en file d'attente survivent
  aux redémarrages de pods.
- **`APP_URL` est dérivé automatiquement.** `SnipeIT_Common` définit `APP_URL` à
  partir de l'URL prévue du service GKE lorsqu'elle est connue ; remplacez-la
  via `environment_variables` si vous attribuez un domaine personnalisé après le
  déploiement.
- **Chemin de santé.** La sonde de démarrage par défaut est une sonde **TCP**
  (délai initial de 30 s, période de 15 s, seuil d'échec de 20 — généreux pour
  laisser le temps à la configuration de la base de données au premier
  démarrage). La sonde de vivacité par défaut est une sonde **HTTP** `GET /`
  (délai initial de 300 s, période de 60 s, seuil d'échec de 3) — Snipe-IT sert
  sa page de connexion sur `/` sans authentification, ce qui confirme que
  l'application PHP et la connexion à la base de données sont saines.
- **Inspectez les jobs d'initialisation et la configuration en cours :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl logs -n "$NAMESPACE" job/<migrate-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep DB_
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Snipe-IT ou notables
pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `snipeit` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `v8-latest` | Tag de l'image officielle `snipe/snipe-it`. Utilisez une version épinglée en production. |
| `php_memory_limit` | `512M` | `memory_limit` de PHP. Accepté mais non appliqué par `SnipeIT_Common` — l'image préconstruite conserve sa propre configuration PHP. |
| `upload_max_filesize` / `post_max_size` | `64M` / `64M` | Taille de téléversement / de POST PHP. `upload_max_filesize` ne doit pas dépasser `post_max_size` (contrôle au moment du plan) ; aucun des deux n'est appliqué à l'image préconstruite. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle ; `"custom"` construirait l'image via Cloud Build. |
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Limites de CPU/mémoire par pod. |
| `container_port` | `80` | Snipe-IT (Apache) écoute sur le port 80. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Bornes de réplicas du HPA. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (interface de bouclage) — requis sur GKE ; un contrôle au moment du plan le rejette lorsque `database_type = "NONE"`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface de Snipe-IT. |
| `workload_type` | `null` → `Deployment` | Deployment (adossé à NFS). |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne toujours le même pod. |

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que les images d'actifs, signatures et codes-barres téléversés soient conservés et partagés. Laissez-le activé. |
| `nfs_mount_path` | `/var/lib/snipeit` | Emplacement où Snipe-IT stocke les fichiers téléversés et les données d'exécution. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Injecte `REDIS_HOST`/`REDIS_PORT`. Un contrôle au moment du plan exige soit que `redis_host` soit défini, soit `enable_nfs = true` (l'IP du serveur NFS sert d'hôte Redis de repli). |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP du serveur NFS. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` | Imposé par `SnipeIT_Common` ; les autres moteurs ne sont pas pris en charge. |
| `application_database_name` | `snipeit` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `snipeit` | Utilisateur de la base de données de l'application ; mot de passe généré automatiquement dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress Kubernetes pour les noms d'hôte personnalisés. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `network_tags` | `["nfsserver"]` | Requis pour la connectivité NFS — ne le supprimez pas, sauf si NFS est désactivé. |

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
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant de joindre Snipe-IT. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration (`db-init`, `migrate`) et d'import (facultative). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan — un `StatefulSet` imposé avec un paramètre
> sans état, IAP sans identités autorisées, des `quota_memory_*`
> fournis sous forme d'entiers bruts, un `container_port`/
> `backup_retention_days` hors plage. `SnipeIT_GKE` ajoute ses propres contrôles
> (`upload_max_filesize ≤ post_max_size`, `min_instance_count ≤
> max_instance_count`, Redis exige `redis_host` ou NFS, IAP exige les deux valeurs
> OAuth, `enable_cloudsql_volume` exige `database_type != "NONE"`). Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource ; la plupart des erreurs
> ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critical | Snipe-IT nécessite MySQL ; les autres moteurs ne sont pas pris en charge par `SnipeIT_Common`. |
| `application_database_name` / `application_database_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et rend orphelines toutes les données. |
| `APP_KEY` (généré automatiquement) | Ne jamais le modifier | Critical | Régénérer la clé Laravel après le premier démarrage invalide les sessions et toutes les données chiffrées avec l'ancienne clé (p. ex. des identifiants LDAP stockés). |
| `enable_nfs` | `true` | High | Le désactiver rend éphémères les images d'actifs, signatures et codes-barres téléversés — isolés par pod et perdus au redémarrage. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy sur `127.0.0.1:3306` est indispensable à la connectivité à la base de données sur GKE. |
| `max_instance_count` | `1` | High | Dépasser 1 sans comportement vérifié du stockage partagé et des verrous expose à des sessions fragmentées et à des contentions de verrous NFS/base de données. |
| `session_affinity` | `ClientIP` | High | Sans persistance, les requêtes passent d'un pod à l'autre et perturbent les sessions authentifiées. |
| `network_tags` | `["nfsserver"]` | High | Supprimer ce tag alors que NFS est activé casse la connectivité entre les pods et Filestore. |
| `memory_limit` | `2Gi` | High | En dessous de 512Mi, le pod PHP/Apache subit des OOM sous charge. |
| `upload_max_filesize` / `post_max_size` | `upload_max_filesize ≤ post_max_size` | Medium | Un ordre incorrect tronque silencieusement les téléversements au niveau de PHP ; le contrôle au moment du plan le bloque, mais uniquement pour ces deux variables. |
| `quota_memory_requests` / `_limits` | Unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers bruts sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `reserve_static_ip` | `true` | Medium | Sans elle, l'IP externe peut changer d'un redéploiement à l'autre, ce qui casse le DNS et toute URL mise en favori ou intégrée à une API. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention réglementaire. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et
Workload Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Snipe-IT
partagée avec la variante Cloud Run (image, secret `APP_KEY`, jobs
d'initialisation) est décrite dans `modules/SnipeIT_Common/README.md` — aucun
guide autonome `docs/modules/
SnipeIT_Common.md` n'existe encore.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : SnipeIT sur GKE Autopilot](../labs/SnipeIT_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Snipe-IT sur Google Cloud Run](SnipeIT_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Snipe-IT Common — Configuration applicative partagée](SnipeIT_Common.md) — la configuration partagée par les deux cibles de déploiement.
