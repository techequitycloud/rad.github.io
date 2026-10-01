---
title: "Flarum sur GKE Autopilot"
description: "Référence de configuration pour déployer Flarum sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Flarum_GKE.md @ 3055034 sha256:e736e8f37ccf -->

# Flarum sur GKE Autopilot {#flarum-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Flarum_GKE.png" alt="Flarum sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Flarum est une plateforme de forum et de discussion gratuite et open source — une
alternative moderne et extensible aux logiciels de forum traditionnels, construite en
PHP avec un front-end JavaScript/Mithril et une API REST. Ce module déploie Flarum sur
**GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Flarum et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Flarum s'exécute comme une charge de travail unique nginx + php-fpm construite à
partir de l'image communautaire `mondedie/flarum`. Le déploiement assemble un ensemble
ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod nginx/php-fpm sur le port 8888, 1 vCPU / 2 GiB par défaut |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — le moteur est fixé à `MYSQL_8_0` |
| Persistance des fichiers | Cloud Filestore (NFS) | Les avatars/pièces jointes téléversés par les utilisateurs sont conservés sous `/flarum/app/public/assets`, partagés entre les pods |
| Stockage objet | Cloud Storage | Un bucket `flarum-assets` est provisionné automatiquement (non monté par défaut — voir ci-dessous) |
| Secrets | Secret Manager | `FLARUM_ADMIN_PASS` généré automatiquement ; mot de passe de la base de données géré séparément |
| Entrée | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé + certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** `Flarum_Common` code en dur `database_type =
  "MYSQL_8_0"` dans sa configuration de sortie ; la variable
  `database_type` de la variante ne prend effet que si elle est explicitement modifiée
  par rapport à sa valeur par défaut `null`.
- **Cloud SQL est atteint via le sidecar Auth Proxy sur la boucle locale.**
  `Flarum_Common` remplace explicitement `DB_HOST = "127.0.0.1"` car l'installateur
  propre à l'image mondedie/flarum lit directement `DB_HOST` ; un sidecar
  cloud-sql-proxy (`enable_cloudsql_volume = true`) écoute sur `127.0.0.1:3306`.
- **Réplica unique par défaut.** `min_instance_count = 1`,
  `max_instance_count = 1`. La charge de travail est adossée à NFS
  (`enable_nfs = true`) ; conformément au comportement partagé du socle, un
  redéploiement utilise donc la stratégie de déploiement `Recreate` plutôt que
  `RollingUpdate` — n'augmentez pas `max_instance_count` sans avoir vérifié le
  comportement de Flarum avec plusieurs pods simultanés partageant le même volume NFS
  de ressources et la même base de données.
- **NFS est activé par défaut** (`enable_nfs = true`, monté sur
  `/flarum/app/public/assets`) afin que les avatars et pièces jointes des utilisateurs
  soient conservés et partagés entre les pods.
- **Un bucket GCS `flarum-assets` est créé mais n'est monté nulle part par défaut.**
  `Flarum_Common` provisionne un bucket Cloud Storage (output `storage_buckets`,
  suffixe `flarum-assets`), mais aucune entrée `gcs_volumes` par défaut ne le
  référence — il reste inutilisé à moins que vous n'en ajoutiez une explicitement.
  C'est NFS, et non GCS Fuse, qui sert réellement de support au répertoire des
  ressources dans la configuration par défaut.
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un client
  atteignent le même pod.
- **Installation automatique au premier démarrage (pas de job de migration
  distinct).** Le point d'entrée s6-overlay propre à l'image de base exécute
  l'installateur de Flarum au premier démarrage du conteneur, en lisant
  `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASS`/`DB_PREF`,
  `FORUM_URL` et les variables `FLARUM_ADMIN_*`. Il n'y a pas de job de migration
  distinct — le Dockerfile est une enveloppe minimale non modifiée de
  `mondedie/flarum` (uniquement `EXPOSE 8888` et un tag de base sélectionné par
  argument de build).
- **`FLARUM_ADMIN_PASS` est généré automatiquement** et stocké dans Secret Manager. Le
  nom d'utilisateur et l'adresse e-mail de l'administrateur sont **fixés par les valeurs
  par défaut de `Flarum_Common`** (`admin` / `admin@techequity.cloud`) — ils ne sont
  pas exposés comme variables d'Application Module sur cette variante ; récupérez donc
  le mot de passe généré avant la première connexion plutôt que de compter configurer
  le nom d'utilisateur/l'adresse e-mail.
- **`FORUM_URL` n'est PAS câblé sur GKE — une lacune connue.** `Flarum_Common` ne
  définit la variable d'environnement `FORUM_URL` que lorsque son entrée `service_url`
  n'est pas vide, mais le câblage de `Flarum_GKE` ne transmet jamais `service_url` lors
  de l'appel au module Common. Par conséquent, `FORUM_URL` est absent par défaut sur
  cette variante et doit être défini manuellement via `environment_variables` une fois
  l'IP externe ou le domaine personnalisé connu — sinon Flarum génère des liens
  absolus, des URL de ressources et des redirections du forum incorrects.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Flarum {#a-gke-autopilot--the-flarum-workload}

Le pod Flarum est ordonnancé sur Autopilot, qui facture le CPU et la mémoire
effectivement demandés par le pod. Comme la charge de travail est adossée à NFS, les
mises à jour utilisent la stratégie `Recreate` (une mise à jour progressive ferait
tourner deux pods simultanément sur le même volume NFS de ressources et la même base
de données partagée).

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Flarum pour les pods, les révisions et les événements. Kubernetes Engine → Services &
  Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et
le type de charge de travail (Deployment ou StatefulSet) sont gérés.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Flarum stocke toutes les données du forum (discussions, messages, utilisateurs, tags)
dans une instance Cloud SQL for MySQL 8.0 gérée, avec des tables préfixées `flarum_`.
Les pods l'atteignent via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:3306` ;
aucune IP publique n'est exposée. Lors du premier déploiement, le job `db-init` crée la
base de données, l'utilisateur et les droits de l'application ; l'installateur Flarum
crée ensuite le schéma au premier démarrage du pod.

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags
  et métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager
contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Consultez
[App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes automatiques et la
rotation du mot de passe.

### C. Cloud Storage et persistance des fichiers {#c-cloud-storage--file-persistence}

Un bucket **Cloud Storage** (suffixe `flarum-assets`) est provisionné automatiquement
et l'accès est accordé au compte de service de la charge de travail, mais il n'est pas
monté dans le pod par défaut — ajoutez une entrée à `gcs_volumes` si vous souhaitez
l'utiliser. Par ailleurs, les avatars et pièces jointes téléversés dans Flarum résident
sur **NFS (Cloud Filestore)** dans `/flarum/app/public/assets`, partagé entre les pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~flarum-assets"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret Flarum est généré automatiquement et stocké dans Secret Manager :
`FLARUM_ADMIN_PASS` (le mot de passe de l'administrateur au premier lancement, ≥8
caractères). Le nom d'utilisateur et l'adresse e-mail de l'administrateur sont fixés à
`admin` / `admin@techequity.cloud` et ne sont pas stockés comme secrets. Le mot de passe
de la base de données est géré séparément par le socle. Sur GKE, les secrets sont
projetés dans les pods via le pilote Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~flarum"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing
(`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse survive
aux redéploiements). Un domaine personnalisé avec un certificat géré par Google peut
être activé (`enable_custom_domain = true` par défaut, sans domaine configuré tant que
vous n'en ajoutez pas).

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud
CDN et l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés vers Cloud Logging ; les métriques GKE et
Cloud SQL alimentent Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Flarum {#3-flarum-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init`
  exécute `db-init.sh` avec `mysql:8.0-debian`. Il se connecte à Cloud SQL (en
  privilégiant le socket Unix sous `/cloudsql` fourni par le sidecar Auth Proxy, en
  attendant jusqu'à 30s l'apparition du socket, et en se repliant sinon sur TCP vers
  `DB_IP`/`DB_HOST`), crée de manière idempotente la base de données applicative (`CREATE
  DATABASE IF NOT EXISTS`) et l'utilisateur (`CREATE USER IF NOT EXISTS` suivi d'un
  `ALTER USER ... IDENTIFIED BY` inconditionnel afin que le mot de passe reste toujours
  synchronisé) ainsi que les droits (`GRANT ALL PRIVILEGES ON <db>.* TO <user>@'%'`),
  vérifie que l'utilisateur applicatif peut se connecter, puis arrête proprement le
  sidecar proxy via `/quitquitquit`. Le job peut être relancé sans risque
  (`execute_on_apply = true`, `max_retries = 3`).
- **Installation automatique au premier démarrage (pas de job de migration
  distinct).** Le point d'entrée s6-overlay propre à l'image `mondedie/flarum` exécute
  l'installateur Flarum au premier démarrage du pod, en créant le schéma dans la base
  de données vide. Le Dockerfile personnalisé est une enveloppe minimale non modifiée
  de l'image de base — il ne remplace pas `ENTRYPOINT` et n'ajoute pas d'étape de
  migration.
- **Compte administrateur.** L'installateur crée un administrateur de premier lancement
  dont le nom d'utilisateur est `admin` et l'adresse e-mail `admin@techequity.cloud`
  (valeurs par défaut fixes de `Flarum_Common`, non exposées comme variables du module)
  et dont le mot de passe est le secret généré `FLARUM_ADMIN_PASS`. Récupérez-le avant
  la première connexion.
- **Câblage des variables d'environnement de la base de données.** Le `main.tf` de
  `Flarum_GKE` définit `db_user_env_var_name = "DB_USER"`, `db_password_env_var_name =
  "DB_PASS"`, et `db_name_env_var_name = "DB_NAME"` lors de l'appel au socle —
  exactement les noms de variables d'environnement qu'attend l'installateur
  mondedie/flarum — si bien qu'aucun point d'entrée d'alias n'est nécessaire.
  `Flarum_Common` définit en outre `DB_PORT = "3306"` et `DB_PREF = "flarum_"`
  directement dans `environment_variables`, et remplace `DB_HOST = "127.0.0.1"` pour
  le sidecar Auth Proxy.
- **Les déploiements adossés à NFS utilisent `Recreate`.** Les mises à jour arrêtent
  l'ancien pod avant de démarrer le nouveau, ce qui évite que deux pods se retrouvent
  en interblocage sur le volume NFS de ressources partagé et les verrous de la base de
  données.
- **`FORUM_URL` doit être défini manuellement.** Il n'est jamais renseigné par défaut
  sur GKE (voir la lacune décrite dans la Vue d'ensemble ci-dessus) — définissez-le via
  `environment_variables` une fois l'IP du LoadBalancer ou le domaine personnalisé
  connu :
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"flarum","env":[
      {"name":"FORUM_URL","value":"https://forum.example.com"}]}]}}}}'
  ```
- **Chemins de santé.** La `startup_probe` propre à l'application est par défaut une
  vérification **TCP** sur le port du conteneur (8888) avec un `failure_threshold = 20`
  généreux à `period_seconds = 15` (cinq minutes de délai de grâce) pour laisser le
  temps à l'installateur du premier démarrage. La `liveness_probe` propre à
  l'application est par défaut une requête **HTTP** `GET /` avec un `initial_delay_seconds
  = 300` (cinq minutes) avant la première vérification — là encore pour éviter de tuer
  le pod en pleine installation.
- **Redis (facultatif).** `enable_redis` vaut `false` par défaut. Lorsqu'il est activé
  sans `redis_host` explicite, la validation au moment du plan exige
  `enable_nfs = true` (le serveur NFS partagé héberge aussi Redis, et le socle injecte
  son IP en tant que `REDIS_HOST`) — sinon l'apply échoue avec une erreur claire plutôt
  que de déployer un forum incapable de joindre Redis.
- **Inspecter le job d'initialisation et la configuration en cours :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E '^(DB_|FORUM_URL|FLARUM_ADMIN)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Flarum ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement
et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `flarum` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image `mondedie/flarum`, transmis via l'ARG de build `FLARUM_VERSION`. `latest` se résout au moment du build en le tag `stable` de l'image (recommandé pour la production). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU pour nginx + php-fpm. |
| `memory_limit` | `2Gi` | Minimum de 512Mi imposé par le concept de plancher gen2 sur Cloud Run ; sur GKE, dimensionnez en fonction de la charge de travail PHP. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; augmentez-la pour des extensions lourdes ou de grands forums. |
| `upload_max_filesize` / `post_max_size` | `64M` | Taille maximale de téléversement / de POST ; `upload_max_filesize` doit être ≤ `post_max_size` (contrôlé au moment du plan). |
| `min_instance_count` | `1` | Conservez 1 pour que le forum reste joignable. |
| `max_instance_count` | `1` | **Conservez 1** sauf si le partage NFS/base de données entre plusieurs pods a été vérifié ; la validation au moment du plan exige `min_instance_count ≤ max_instance_count`. |
| `container_port` | `8888` | mondedie/flarum sert nginx + php-fpm sur le port 8888. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (boucle locale) — requis sur GKE tant que `database_type != "NONE"` (contrôlé au moment du plan). |
| `container_image_source` | `custom` | Build minimal FROM `mondedie/flarum`, réétiqueté via l'ARG de build `FLARUM_VERSION`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface Flarum. |
| `workload_type` | `null` → `Deployment` | Deployment (adossé à NFS, stratégie `Recreate`). |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne le même pod. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `{ type = "TCP", path = "/", initial_delay_seconds = 30, period_seconds = 15, failure_threshold = 20 }` | Sonde de démarrage propre à Flarum — vérification du port TCP avec une fenêtre de grâce de cinq minutes pour l'installateur du premier démarrage. |
| `liveness_probe` | `{ type = "HTTP", path = "/", initial_delay_seconds = 300, period_seconds = 60, failure_threshold = 3 }` | Sonde de vivacité propre à Flarum — délai initial de cinq minutes pour éviter de tuer le pod en pleine installation. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que les avatars/pièces jointes téléversés soient conservés et partagés. |
| `nfs_mount_path` | `/flarum/app/public/assets` | Emplacement où Flarum stocke les ressources téléversées par les utilisateurs. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Backend de cache d'objets facultatif. |
| `redis_host` / `redis_port` | `""` / `6379` | Lorsque `redis_host` est laissé vide, `enable_nfs = true` est requis (validé au moment du plan) afin de pouvoir utiliser l'IP Redis partagée injectée par le socle. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` | `Flarum_Common` code en dur MySQL 8.0 ; cette variable n'a d'importance que si elle est explicitement remplacée. |
| `application_database_name` | `flarum` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `flarum` | Utilisateur de la base de données applicative ; mot de passe généré automatiquement dans Secret Manager. |

### Groupe 16 — Cloud Storage {#group-16--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires configurables par l'utilisateur — créés en plus (et non à la place) du bucket `flarum-assets` fourni par Common. |
| `gcs_volumes` | `[]` | Aucun bucket n'est monté dans le pod par défaut ; ajoutez ici une entrée pour utiliser réellement `flarum-assets` ou `data` comme montage de système de fichiers. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |
| `enable_custom_domain` | `true` | Provisionne un Ingress ; `application_domains` est vide par défaut. |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à Flarum. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au
> moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan — un `StatefulSet` imposé conjointement à un
> paramètre sans état, IAP sans identité autorisée, des `quota_memory_*` donnés sous
> forme d'entiers nus, un `container_port`/
> `backup_retention_days` hors limites. Flarum possède en outre ses propres
> préconditions (`min_instance_count ≤ max_instance_count`, `enable_redis` exigeant
> `redis_host` ou `enable_nfs`, IAP exigeant les deux identifiants OAuth,
> `enable_cloudsql_volume` exigeant un véritable moteur de base de données, et
> `upload_max_filesize ≤ post_max_size`). Une configuration invalide fait échouer le
> **plan** avec une erreur claire et nommée avant la création de toute ressource, de
> sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à
> l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critique | Choisir un moteur autre que MySQL casse l'installateur et toutes les requêtes. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et rend toutes les données orphelines. |
| `FORUM_URL` (non prédéfini — à définir manuellement) | URL externe du LoadBalancer/du domaine | Élevé | S'il n'est pas défini, Flarum génère des liens absolus, des URL de ressources et des redirections incorrects ; cette variante ne l'injecte pas automatiquement. |
| `enable_nfs` | `true` | Élevé | Le désactiver rend les avatars/pièces jointes téléversés éphémères — perdus lors de la recréation du pod. |
| `enable_cloudsql_volume` | `true` (avec un `database_type` réel) | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:3306` est requis pour la connectivité à la base de données sur GKE ; l'activer avec `database_type = "NONE"` fait échouer la validation au moment du plan. |
| `max_instance_count` | `1` | Élevé | Dépasser 1 sans comportement vérifié du stockage partagé et des verrous expose à des sessions fragmentées et à des conflits de verrous NFS/base de données. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance de session, les requêtes rebondissent entre les pods et perturbent les sessions authentifiées. |
| `enable_redis` + `redis_host` | Ne laisser `redis_host` vide que si `enable_nfs = true` | Élevé | Enfreindre cette combinaison fait échouer la validation au moment du plan plutôt que de déployer un forum incapable de joindre Redis. |
| `memory_limit` | `2Gi` | Élevé | Sous-dimensionner PHP-FPM sous charge expose à des arrêts pour manque de mémoire (OOM). |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Des entiers nus sont interprétés comme des octets et bloquent l'ordonnancement de tous les pods de l'espace de noms. |
| `FLARUM_ADMIN_PASS` (généré automatiquement) | À récupérer avant la première connexion | Moyen | Ne pas le connaître vous empêche d'accéder au premier compte administrateur jusqu'à sa réinitialisation via la base de données. |
| `gcs_volumes` (vide par défaut) | Ajouter une entrée pour utiliser réellement `flarum-assets` | Moyen | Le bucket `flarum-assets` est créé et facturé mais ne sert à rien s'il n'est pas explicitement monté. |
| `reserve_static_ip` | `true` | Moyen | Sans elle, l'IP externe peut changer entre les redéploiements, ce qui casse le DNS et `FORUM_URL`. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention conforme. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Flarum, partagée avec
la variante Cloud Run, est décrite dans **[Flarum_Common](Flarum_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Flarum sur GKE Autopilot](../labs/Flarum_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Flarum sur Google Cloud Run](Flarum_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Flarum Common — Configuration applicative partagée](Flarum_Common.md) — la configuration partagée par les deux cibles de déploiement.
