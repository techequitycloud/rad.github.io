---
title: "Calibre-Web sur Google Cloud Run"
description: "Référence de configuration pour déployer Calibre-Web sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/CalibreWeb_CloudRun.md @ 3055034 sha256:3091ccd79596 -->

# Calibre-Web sur Google Cloud Run {#calibre-web-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CalibreWeb_CloudRun.png" alt="Calibre-Web sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Calibre-Web est une application web auto-hébergée et épurée permettant de parcourir,
de lire et de télécharger des livres numériques à partir d'une bibliothèque Calibre
existante — elle propose une liseuse dans le navigateur, un flux OPDS, la gestion des
utilisateurs et la synchronisation Kobo, au-dessus de l'image amont LinuxServer.io
`calibre-web`. Ce module déploie Calibre-Web sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée ; `CalibreWeb_CloudRun` est un wrapper léger qui fournit la
configuration propre à Calibre-Web (image, ports, sondes, câblage du stockage) et
transmet tout le reste tel quel.

Ce guide se concentre sur les services cloud qu'utilise Calibre-Web et sur la manière
de les explorer et de les exploiter depuis la Google Cloud Console et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Calibre-Web s'exécute sous la forme d'une seule révision Cloud Run. Il n'a **aucune
base de données externe** — tout son état (la base de données de l'application, la
base de métadonnées de la bibliothèque Calibre, la configuration, le cache et les
journaux) réside dans des fichiers SQLite internes sous `/config`. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur Calibre-Web (image LinuxServer.io) sur le port 8083, 1 vCPU / 1 GiB par défaut ; `min_instance_count = max_instance_count = 1` |
| Persistance de la configuration et de la bibliothèque | NFS partagé (Filestore / VM NFS) | `/config` est monté depuis le serveur NFS partagé par défaut (`enable_nfs = true`, `nfs_mount_path = "/config"`). Le bucket suffixé `storage` est toujours provisionné mais **n'est pas** monté — `enable_gcs_storage_volume` est exposée comme variable du module sur `CalibreWeb_CloudRun` et vaut `false` par défaut, car GCS FUSE corrompt le `app.db` SQLite de Calibre-Web. |
| Base de données | Aucune | `database_type = "NONE"` ; aucune instance Cloud SQL, aucun utilisateur ni job `db-init` |
| Cache et file d'attente | Aucun | `enable_redis` est déclarée pour refléter les variables du socle, mais **codée en dur à `false`** dans `main.tf` quelle que soit la valeur de la variable |
| Secrets | Secret Manager | `CALIBRE_ADMIN_PASSWORD` généré automatiquement — provisionné mais **ce n'est pas** l'identifiant avec lequel Calibre-Web authentifie réellement la première connexion (voir §3) |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut (`ingress_settings = all`) ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé via Cloud Armor |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Persistance GCS Fuse, pas un PVC en mode bloc — conçu pour le développement et un
  usage léger.** Contrairement à `CalibreWeb_GKE` (qui utilise un vrai Persistent Volume
  en mode bloc précisément parce que le modèle de cohérence relâché de gcsfuse peut
  corrompre SQLite), ce module Cloud Run n'offre aucune option de stockage en mode bloc —
  `/config` repose par défaut sur un montage **NFS** partagé (`enable_nfs = true`, `nfs_mount_path = "/config"`), qui fournit la sémantique POSIX dont SQLite a besoin. Le montage GCS Fuse sur ce chemin est désactivé par défaut (`enable_gcs_storage_volume = false`) car il corrompt `app.db`.
  Le propre `module_description` du module indique explicitement que cette variante est
  « best suited for development/light use » (plus adaptée au développement et à un usage
  léger) et recommande `CalibreWeb_GKE` avec un PVC en mode bloc pour la production.
- **Révision unique par défaut.** `min_instance_count = 1` et
  `max_instance_count = 1`. Contrairement à la variante GKE (où chaque réplica du
  StatefulSet obtient son propre PVC indépendant), chaque instance Cloud Run monte le
  **même** bucket adossé à GCS — augmenter `max_instance_count` ne scinde donc pas la
  bibliothèque comme sur GKE, mais permet à deux instances d'écrire simultanément dans
  les mêmes fichiers SQLite adossés à gcsfuse, ce qui est dangereux. Conservez la valeur 1.
- **`min_instance_count` vaut `1` par défaut, et non `0`.** Ce n'est délibérément pas
  une mise à l'échelle jusqu'à zéro — l'objectif est d'éviter un démarrage à froid
  pendant que Calibre-Web charge les index de sa collection et de sa bibliothèque. Ce
  module n'expose pas du tout `cpu_always_allocated` (elle n'est ni reflétée dans
  `variables.tf` ni transmise dans `main.tf`) ; il hérite donc silencieusement de la
  valeur par défaut du socle App_CloudRun (`false`, facturation basée sur les
  requêtes) — le CPU de l'instance toujours active n'est facturé que lorsqu'elle sert
  effectivement une requête.
- **Aucune base de données.** `database_type = "NONE"` ; il n'y a pas de job `db-init`
  et aucune des variables liées à la base de données de ce module n'est référencée.
- **Aucun Redis.** `enable_redis` vaut `true` par défaut dans le `variables.tf` de ce
  module (reflet de la valeur par défaut du socle App_CloudRun) mais est
  **inerte** — `main.tf` transmet un `enable_redis = false` codé en dur à l'appel du socle, et `redis_host`/`redis_port`/`redis_auth` sont déclarées mais jamais
  transmises.
- **Le mot de passe d'administration généré n'est pas l'identifiant de connexion
  effectif.** L'image amont LinuxServer est livrée avec un identifiant par défaut intégré
  (`admin` / `admin123`) ; le secret Secret Manager `CALIBRE_ADMIN_PASSWORD` est
  provisionné pour un identifiant plus robuste mais n'est pas câblé automatiquement dans
  le conteneur. Modifiez le mot de passe dans l'interface de Calibre-Web lors de la
  première connexion.
- **`enable_cloudsql_volume` est désactivée en dur.** `main.tf` transmet
  `enable_cloudsql_volume = false` au socle quelle que soit la valeur de la
  variable du module, ce qui supprime entièrement le sidecar Cloud SQL Auth Proxy — à
  juste titre, puisque Calibre-Web n'a pas de base de données.
- **La version de l'image est épinglée via un ARG de build propre à l'application.** Le
  Dockerfile lit `CALIBREWEB_VERSION` (et non l'`APP_VERSION` générique qu'injecte le
  socle) ; lorsque `application_version = "latest"`, le build est épinglé sur une
  version éprouvée, `0.6.24`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Calibre-Web {#a-cloud-run--the-calibre-web-service}

Calibre-Web s'exécute sous la forme d'un seul service/révision Cloud Run v2. Comme
`min_instance_count = max_instance_count = 1` par défaut, une seule instance est
normalement en cours d'exécution à un instant donné.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage et GCS Fuse — le montage `/config` {#b-cloud-storage--gcs-fuse--the-config-mount}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est toujours provisionné lorsque
`create_cloud_storage = true` (la valeur par défaut), mais par défaut il **n'est pas**
monté : `enable_gcs_storage_volume = false`, donc `/config` — le chemin où Calibre-Web
conserve ses fichiers SQLite (`app.db`, le `metadata.db` de Calibre), sa configuration,
son cache et ses journaux. Le montage est contrôlé par la variable de module
`enable_gcs_storage_volume`, qui vaut **`false`** par défaut sur Cloud Run ; le bucket
est toujours provisionné mais reste non monté, et `/config` est servi par NFS à la
place (voir `enable_nfs`). Des buckets et volumes supplémentaires peuvent être déclarés
via `storage_buckets` / `gcs_volumes`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options de montage GCS Fuse et CMEK.

### C. Secret Manager {#c-secret-manager}

Un secret Calibre-Web est généré automatiquement et stocké dans Secret Manager :
`CALIBRE_ADMIN_PASSWORD` (une valeur aléatoire de 24 caractères,
`secret-<prefix>-<app>-admin-password`), injecté dans la révision Cloud Run sous forme
de variable d'environnement secrète. Il **n'est pas** appliqué comme identifiant de
connexion effectif de Calibre-Web — voir §3.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour l'injection et la rotation des secrets.

### D. Réseau et entrée {#d-networking--ingress}

Le service est joignable à son URL `run.app` par défaut (`ingress_settings = all`,
public). Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN
et Cloud Armor peut être ajouté par-dessus via `enable_cloud_armor` ; les paramètres
d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de Cloud
Run sont envoyées vers Cloud Monitoring. Les tests de disponibilité sont désactivés par
défaut (`uptime_check_config.enabled = false`).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Calibre-Web {#3-calibre-web-application-behaviour}

- **Aucun job d'initialisation par défaut.** `initialization_jobs` vaut `[]` par
  défaut ; Calibre-Web gère son propre stockage SQLite et n'a besoin d'aucune
  initialisation de base de données (il n'y a pas de job `db-init` car
  `database_type = "NONE"`). Seuls les jobs fournis par l'utilisateur s'exécutent.
- **Aucune étape de migration.** L'init amont de LinuxServer, basé sur s6, s'exécute
  sans modification — le Dockerfile est `FROM lscr.io/linuxserver/calibre-web:${CALIBREWEB_VERSION}`
  sans script de point d'entrée ajouté. `image_source = "custom"` est défini uniquement
  pour que le socle construise ou mette en miroir l'image dans Artifact Registry.
- **Organisation du stockage au premier démarrage.** L'image abandonne ses privilèges au
  profit de `PUID=1000`/`PGID=1000` (injectés comme variables d'environnement par
  `CalibreWeb_Common`) et conserve tout l'état sous `/config` (le volume monté en NFS) :
  `app.db`, le `metadata.db` de Calibre, la configuration, le cache et les journaux. La
  bibliothèque de livres numériques elle-même réside sous `/books` (vide au premier
  lancement — l'assistant de configuration intégré à l'application y fait pointer
  Calibre-Web).
- **`CALIBRE_ADMIN_PASSWORD` est provisionné mais non appliqué.** Le secret Secret
  Manager existe pour qu'un mot de passe robuste soit disponible et pour qu'une future
  image ou un futur point d'entrée puisse l'utiliser — il n'est pas câblé dans le flux
  de connexion réel du conteneur. Les identifiants de première connexion intégrés à
  l'image amont sont `admin` / `admin123`. Modifiez le mot de passe d'administration
  dans l'interface de Calibre-Web immédiatement après la première connexion.
- **Chemin de santé.** Les sondes de démarrage et de vivacité émettent toutes deux un
  **HTTP GET `/`** (la page de connexion de Calibre-Web), qui renvoie `200` sans
  authentification — les sondes réussissent dès que le serveur répond, indépendamment
  de tout état de connexion. Valeurs par défaut : démarrage `initial_delay=15s`,
  `period=10s`, `failure_threshold=10` ; vivacité `initial_delay=30s`, `period=30s`,
  `failure_threshold=3`. (Remarque : le texte de description de la variable
  `liveness_probe` dans `variables.tf` mentionne un point de terminaison `/health` que
  Calibre-Web n'expose pas — le `path` configuré par défaut est en réalité `/` ; ne le
  remplacez pas par `/health`, qui renverrait une 404.)
- **Contrainte d'écrivain unique.** `min_instance_count = max_instance_count = 1`
  garantit qu'une seule instance écrit à la fois dans les fichiers SQLite montés via
  gcsfuse. Augmenter `max_instance_count` ne donne **pas** à Calibre-Web une
  bibliothèque partagée en toute sécurité — cela permet à deux instances Cloud Run
  d'écrire simultanément dans les mêmes fichiers SQLite adossés au bucket, ce qui
  risque de les corrompre avec le modèle de cohérence relâché de GCS Fuse.
- **Inspectez l'exécution des jobs et la révision en cours :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement (selon les tags `{{UIMeta group=N}}` de `variables.tf`). Seuls les
paramètres propres à Calibre-Web ou notables pour lui sont listés ; toutes les autres
entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `calibreweb` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Calibre-Web` | Nom lisible affiché dans la Console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag `lscr.io/linuxserver/calibre-web` utilisé comme base du build personnalisé ; `latest` est épinglé sur un tag éprouvé (`0.6.24`) au moment du build via l'ARG de build propre à l'application `CALIBREWEB_VERSION`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | 1 vCPU. |
| `memory_limit` | `1Gi` | Mémoire par instance. |
| `min_instance_count` | `1` | Pas de mise à l'échelle jusqu'à zéro par défaut — évite un démarrage à froid pendant que Calibre-Web charge l'index de sa bibliothèque. |
| `max_instance_count` | `1` | **Conservez 1** — voir la contrainte d'écrivain unique au §3. |
| `container_port` | `8083` | Port de l'interface web de Calibre-Web. Contrairement à la variante GKE (où cette variable est inerte), cette valeur EST transmise — `calibreweb.tf` la fusionne par-dessus le `8083` codé en dur de `CalibreWeb_Common`, elle prend donc effet si elle est modifiée. |
| `execution_environment` | `gen2` | Gen2 obligatoire pour le montage GCS Fuse de `/config`. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Codée en dur à `false` dans `main.tf` quelle que soit cette variable — Calibre-Web n'utilise pas Cloud SQL. |
| `container_protocol` | `http1` | Le texte de description mentionne gRPC ; sans objet pour Calibre-Web — conservez `http1`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Déclarée par souci de cohérence avec les conventions ; non référencée par le déploiement de ce module. |
| `service_annotations` / `service_labels` | `{}` | Annotations et libellés personnalisés du service Cloud Run. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut afin que l'interface web soit directement joignable. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google devant l'interface de Calibre-Web. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets ; fusionnés avec les `PUID=1000`, `PGID=1000`, `TZ=Etc/UTC` de `CalibreWeb_Common`. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure `/config` à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Instance NFS et scripts SQL personnalisés {#group-9--nfs-instance--custom-sql-scripts}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` | `false` | Sans objet — Calibre-Web n'a pas de base de données SQL. |
| `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | `""` / `""` / `false` | Sans objet. |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | Entrées de découverte et de nommage NFS — sans incidence puisque `enable_nfs = false` par défaut (Groupe 11) et que Calibre-Web n'a pas de chemin de stockage basé sur NFS. |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage, système de fichiers et Redis {#group-11--storage-filesystem--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne toujours le bucket suffixé `storage`. Il **n'est pas** monté par défaut — voir `enable_gcs_storage_volume` (`false`) et le §2.B. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires en plus de celui provisionné automatiquement. |
| `enable_nfs` | `true` | NFS **est** le mode de persistance de Calibre-Web sur Cloud Run : `/config` contient un `app.db` SQLite en mode rollback-journal, que GCS FUSE ne peut pas supporter (`BufferedWriteHandler.OutOfOrderError for object: app.db-journal`). NFS fournit la sémantique POSIX de renommage, de fsync et de verrouillage que FUSE ne fournit pas. Définissez `false` uniquement si vous acceptez le risque de corruption. |
| `nfs_mount_path` | `/config` | Emplacement de montage du volume NFS — Calibre-Web y conserve tout son état (`app.db`, `metadata.db`, configuration, cache, journaux). Doit rester cohérent avec `enable_gcs_storage_volume` : monter à la fois NFS et le volume GCS FUSE sur `/config` provoque un conflit de double montage. |
| `gcs_volumes` | `[]` | Volumes GCS Fuse supplémentaires. Le volume automatique `storage`→`/config` n'est ajouté que lorsque `enable_gcs_storage_volume = true`, qui vaut `false` par défaut sur Cloud Run. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `enable_redis` | `true` (déclarée) | **Inerte** — `main.tf` code en dur `enable_redis = false` dans l'appel du socle quelle que soit cette variable. Calibre-Web ne dépend pas de Redis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Déclarées pour refléter les variables du socle mais **jamais transmises** à App_CloudRun. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixée par `CalibreWeb_Common` ; aucune instance Cloud SQL, base de données ni utilisateur n'est créé. |
| `database_password_length` | `32` | Non référencée — aucune base de données n'existe. |
| `application_database_name` / `application_database_user` / `db_password_env_var_name` / `enable_mysql_plugins` / `enable_postgres_extensions` / `enable_auto_password_rotation` / `sql_instance_name` / `sql_instance_base_name` | diverses | Toutes déclarées uniquement pour refléter les variables du socle — sans objet, puisque `database_type = "NONE"`. |
| `service_url_env_var_name` | `""` | Sans lien avec la base de données malgré son placement dans ce groupe — ajoute un nom de variable d'environnement supplémentaire pour l'URL prévue du service Cloud Run, en plus de `CLOUDRUN_SERVICE_URL`. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun job d'initialisation intégré — Calibre-Web gère lui-même son stockage SQLite. Ne fournissez des jobs que pour un chargement de données personnalisé. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` délai de 15s | La sonde effectivement appliquée (transmise via la `config` de `CalibreWeb_Common`, qui remplace l'entrée brute `startup_probe_config`). |
| `liveness_probe` | HTTP `/` délai de 30s | La sonde effectivement appliquée. Voir le §3 pour la discordance du texte de description mentionnant `/health`. |
| `startup_probe_config` / `health_check_config` | activée, chemin `/` | Alternatives inertes — dès que `CalibreWeb_Common` fournit `startup_probe`/`liveness_probe` via `application_config`, ces entrées brutes de premier niveau sont ignorées. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `organization_id` | `""` | Valeur de remplacement pour les projets imbriqués dans des dossiers. |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

Remarque : ce groupe porte le tag `group=23` dans `variables.tf`, soit un de plus que le
`22` utilisé par la plupart des autres modules d'application Cloud Run pour les mêmes
entrées VPC-SC et journaux d'audit — une particularité cosmétique de numérotation des
groupes de l'interface, sans effet fonctionnel.

Toutes les autres entrées suivent le comportement standard
d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `calibreweb_url` | L'URL du service Cloud Run (`status.url`). Remarque : la description de cette sortie dans `outputs.tf` mentionne une « internal VPC ... REST API (port 6333) » — ce texte est un copier-coller obsolète provenant d'un module sans rapport (Calibre-Web n'a ni cette API ni ce port) ; la valeur elle-même est simplement l'URL normale du service, joignable selon `ingress_settings` (public par défaut). |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (s'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés, y compris le bucket `storage` monté sur `/config`. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuels jobs de configuration fournis par l'utilisateur (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

Remarque : `outputs.tf` n'expose pas au premier niveau l'ID du secret Secret Manager de
`CALIBRE_ADMIN_PASSWORD` (contrairement à la sortie
`calibreweb_admin_password_secret_id` de `CalibreWeb_GKE`) — récupérez-le plutôt avec
`gcloud secrets list --filter="name~admin-password"`.

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Modèle de persistance de `/config` | Utilisez `CalibreWeb_GKE` pour les bibliothèques de production | Critique | Ce module n'offre aucune option de PVC en mode bloc ; `/config` repose par défaut sur **NFS** (`enable_nfs = true`, `nfs_mount_path = "/config"`), ce qui évite la corruption de SQLite par gcsfuse. Ne définissez pas `enable_gcs_storage_volume = true` sur ce chemin — le modèle de cohérence relâché de gcsfuse corrompt `app.db`/`metadata.db` en usage réel, et cela provoquerait aussi un double montage de `/config`. La propre description du module signale cette variante comme réservée au développement et à un usage léger. |
| `max_instance_count` | `1` | Critique | Au-delà de 1, plusieurs instances Cloud Run écrivent simultanément dans les **mêmes** fichiers SQLite montés via gcsfuse — un risque réel de corruption de la base de données, distinct de la scission des PVC par réplica de la variante GKE (et à certains égards plus dangereux). |
| `CALIBRE_ADMIN_PASSWORD` (généré automatiquement) | Modifiez l'identifiant dans l'interface lors de la première connexion | Élevé | Le secret généré n'est pas appliqué automatiquement ; l'identifiant de première connexion effectif est la valeur amont par défaut `admin`/`admin123` jusqu'à sa modification manuelle. |
| `enable_redis` | À ignorer — inerte | Faible | `main.tf` code en dur `enable_redis = false` quelle que soit cette variable ; Calibre-Web ne dépend pas de Redis. |
| `enable_cloudsql_volume` | À ignorer — inerte | Faible | `main.tf` code en dur `enable_cloudsql_volume = false` ; Calibre-Web ne dépend pas de Cloud SQL. |
| `min_instance_count` | `1` (par défaut) | Moyen | Maintient une instance toujours active pour éviter un démarrage à froid pendant que Calibre-Web charge l'index de sa bibliothèque ; ce module n'expose pas `cpu_always_allocated`, le CPU reste donc facturé à la requête (valeur par défaut du socle) plutôt qu'en continu. |
| `startup_probe_config` / `health_check_config` | À ignorer — inertes une fois `application_config` défini | Faible | Ces entrées brutes sont remplacées par les `startup_probe`/`liveness_probe` de `CalibreWeb_Common`, qui sont celles réellement appliquées. |
| `container_port` | `8083` (à conserver) | Moyen | Contrairement à `CalibreWeb_GKE` (où cette variable est inerte), sur Cloud Run elle remplace réellement le port du conteneur via un `merge()` dans `calibreweb.tf` — la modifier sans changer aussi le port d'écoute de l'image amont casse le routage. |
| `enable_cloud_armor` | à activer en production | Moyen | L'interface de Calibre-Web et les points de terminaison OPDS/synchronisation Kobo sont joignables publiquement sans protection WAF par défaut. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention conforme de la sauvegarde de `/config`. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à Calibre-Web partagée avec la variante GKE est décrite dans
**[CalibreWeb_Common](CalibreWeb_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Calibre-Web sur Cloud Run](../labs/CalibreWeb_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Calibre-Web sur GKE Autopilot](CalibreWeb_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Calibre-Web Common — Configuration applicative partagée](CalibreWeb_Common.md) — la configuration partagée par les deux cibles de déploiement.
