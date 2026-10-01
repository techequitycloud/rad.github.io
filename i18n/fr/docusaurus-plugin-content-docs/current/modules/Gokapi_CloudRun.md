---
title: "Gokapi sur Google Cloud Run"
description: "Référence de configuration pour déployer Gokapi sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Gokapi_CloudRun.md @ 3055034 sha256:70e715f80edf -->

# Gokapi sur Google Cloud Run {#gokapi-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gokapi_CloudRun.png" alt="Gokapi sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gokapi est un serveur de partage de fichiers léger et auto-hébergé, écrit en Go —
une alternative auto-hébergée à WeTransfer. Les utilisateurs téléversent des
fichiers et génèrent des liens de téléchargement partageables, avec en option une
date d'expiration, une limite du nombre de téléchargements et une protection par
mot de passe, le tout adossé à une base de données SQLite interne (aucune base de
données externe requise). Ce module déploie Gokapi sur **Cloud Run v2** au-dessus
de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Gokapi et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run —
identité du service, ingress et équilibrage de charge, scaling et concurrence,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Gokapi s'exécute sous la forme d'un conteneur composé d'un unique binaire Go sur
Cloud Run v2, sans base de données externe. Le déploiement associe un ensemble
restreint et ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur du binaire Go sur le port `53842`, `1000m` de CPU / `1Gi` de mémoire par défaut ; révision unique, `min_instance_count = 1` / `max_instance_count = 1` |
| Base de données | **Aucune (SQLite, sur un stockage monté)** | Pas de Cloud SQL — `database_type` est fixé à `NONE` par `Gokapi_Common` ; Gokapi écrit sa propre base SQLite sous `GOKAPI_CONFIG_DIR` |
| Persistance des fichiers et de la base | Bucket Cloud Storage monté via **GCS Fuse** sur `/data` | Le seul chemin de persistance disponible sur Cloud Run — il n'existe ici aucune notion de PVC/stockage en mode bloc, contrairement au PVC de StatefulSet utilisé par `Gokapi_GKE` |
| Stockage d'objets | Cloud Storage | Le bucket suffixé `storage` est provisionné automatiquement et, sur Cloud Run, est toujours monté (il n'est pas inutilisé, contrairement à la variante GKE) |
| Secrets | Secret Manager | Uniquement une clé API d'opérateur **facultative** (`GOKAPI_API_KEY`) ; aucun secret généré obligatoire |
| Ingress | URL Cloud Run / Cloud Load Balancing | `ingress_settings = "all"` par défaut, si bien que le service est joignable publiquement d'emblée |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Jamais de Cloud SQL.** `database_type` est fixé en dur à `NONE` par
  `Gokapi_Common` — les variables de base de données génériques de ce module
  (`sql_instance_name`, `application_database_name`, `db_*_env_var_name`, etc.)
  ne sont transmises à la fondation que pour la compatibilité de mise en miroir des
  variables et n'ont aucun effet.
- **SQLite et les fichiers téléversés persistent via un montage GCS Fuse, et non
  un véritable volume en mode bloc.** Cloud Run n'a pas d'équivalent PVC/StatefulSet ;
  `Gokapi_Common` monte donc le bucket `storage` provisionné automatiquement sur
  `/data` via GCS Fuse (`enable_gcs_storage_volume` vaut `true` par défaut dans
  `Gokapi_Common`, et cette variante Cloud Run n'expose **aucune variable pour le
  désactiver** — ce commutateur n'existe que sur `Gokapi_GKE`, lié à
  `stateful_pvc_enabled`). `GOKAPI_CONFIG_DIR =
  /data/config` (configuration + base de données SQLite) et `GOKAPI_DATA_DIR = /data/data`
  (fichiers téléversés) résident tous deux sur ce montage. GCS Fuse ne fournit pas de véritable verrouillage de
  fichiers POSIX, soit précisément la sémantique dont dépend une application
  adossée à SQLite — voir la [section 6](#6-configuration-pitfalls--sensible-defaults)
  pour le risque que cela comporte.
- **Le bucket GCS `storage` est ici essentiel, et non décoratif.** Contrairement à
  `Gokapi_GKE` (où le bucket reste inutilisé derrière un PVC de StatefulSet par
  défaut), sur Cloud Run ce bucket **est** la couche de persistance à la fois de
  la base de données SQLite et de chaque fichier téléversé.
- **Instance unique par conception.** `min_instance_count = 1`, `max_instance_count =
  1`. La base de données SQLite de Gokapi n'accepte qu'un seul rédacteur et ne
  propose ni clustering ni réplication ; ne dépassez donc pas 1 instance.
- **Aucun mot de passe administrateur n'est généré automatiquement.** Gokapi n'a
  aucun secret obligatoire — le compte administrateur est créé de manière
  interactive via l'assistant de premier lancement propre à Gokapi, sur
  **`/setup`** (la sortie `setup_url`). Tant qu'il n'est pas terminé, toutes les
  autres pages — `/` comprise — répondent « Server is in maintenance mode,
  please try again in a few minutes ».
- **Clé API d'opérateur facultative, requise par défaut.** `enable_api_key` (par
  défaut `true` sur `Gokapi_CloudRun`) génère un jeton aléatoire de 32 caractères,
  le stocke dans Secret Manager et l'injecte en tant que `GOKAPI_API_KEY` via le
  mécanisme `module_secret_env_vars` du module. Il s'agit uniquement d'un jeton de
  commodité — les clés API de téléversement/téléchargement propres à Gokapi sont
  normalement créées depuis l'interface d'administration après la configuration.
  Il vaut `true` par défaut ici (contrairement à la valeur par défaut `false` de
  `Gokapi_Common`) en raison de la garde au moment du plan décrite ci-dessous.
- **Redis est désactivé de force.** `main.tf` code en dur `enable_redis = false`
  vers la fondation, quelle que soit la valeur de la variable — Gokapi n'a aucun
  usage de Redis.
- **L'ingress public est activé par défaut, et il est conditionné à la clé API au
  moment du plan.** `ingress_settings = "all"` correspond à la finalité de Gokapi,
  qui génère des liens de téléchargement partageables joignables depuis
  l'extérieur du VPC — mais cela signifie aussi que l'assistant de premier
  lancement, non authentifié, reste joignable publiquement tant qu'aucun compte
  administrateur n'a été revendiqué. La garde `validate_gokapi_configuration` de
  `validation.tf` fait échouer le plan dès que `ingress_settings = "all"` est
  combiné à `enable_api_key = false` ; l'association par défaut du module
  (`"all"` + `enable_api_key = true`) est donc la seule combinaison prête à
  l'emploi qui passe le plan sans erreur ; passer `enable_api_key` à `false`
  impose aussi de restreindre `ingress_settings` à `"internal"` (ou
  `"internal-and-cloud-load-balancing"`).
- **Construit comme une image personnalisée légère, épinglée pour éviter le piège
  du tag `latest`.** L'image est un wrapper d'une ligne
  `FROM f0rc3/gokapi:${GOKAPI_VERSION}` afin que la fondation puisse la mettre en
  miroir dans Artifact Registry. `GOKAPI_VERSION` (un argument de build propre à
  l'application, que l'injection générique `APP_VERSION` de la fondation ne
  touche pas) se résout en une version épinglée `v1.9.6` lorsque
  `application_version = "latest"`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources sont indiqués dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Gokapi {#a-cloud-run--the-gokapi-service}

Gokapi s'exécute sous la forme d'un unique service/d'une unique révision Cloud
Run v2. `min_instance_count = 1` maintient en permanence une instance à chaud
(ce qui évite les démarrages à froid et préserve le rédacteur SQLite unique) ;
`max_instance_count = 1` ne doit pas être augmenté.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le scaling, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Stockage persistant — le montage GCS Fuse sur `/data` {#b-persistent-storage--the-gcs-fuse-mount-at-data}

Il n'y a ni instance Cloud SQL ni PVC. À la place, le bucket Cloud Storage
`storage` provisionné automatiquement est monté dans le conteneur en tant que
volume GCS Fuse sur `/data`, et `GOKAPI_CONFIG_DIR=/data/config` (base de
métadonnées SQLite + configuration de l'application) comme
`GOKAPI_DATA_DIR=/data/data` (fichiers téléversés) résident sous ce montage
unique. Ce montage est inconditionnel dans ce module — aucune variable ne permet
ici de le désactiver (à comparer avec `Gokapi_GKE`, qui désactive le volume GCS
équivalent dès que son PVC de StatefulSet est activé).

- **Console :** Cloud Storage → Buckets, pour le contenu du bucket ; Cloud Run →
  service → Revisions → **Volumes**, pour confirmer le montage.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<storage-bucket>/config gs://<storage-bucket>/data
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la sémantique des montages GCS
Fuse et la mise en garde qui y figure quant aux performances pour les charges de
travail de type base de données, et la [section 6](#6-configuration-pitfalls--sensible-defaults)
ci-dessous pour comprendre pourquoi cela importe spécifiquement pour la base de
données SQLite de Gokapi.

### C. Secret Manager — la clé API facultative {#c-secret-manager--the-optional-api-key}

Gokapi ne crée **aucun secret obligatoire**. Le seul secret que ce module peut
créer est le jeton de commodité d'opérateur facultatif `GOKAPI_API_KEY`,
conditionné par `enable_api_key` (par défaut `false`). Ce secret n'est **pas**
exposé dans les [sorties](#5-outputs) de ce module — recherchez-le directement
par son nom.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<api-key-secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails sur l'injection et la
rotation des secrets.

### D. Réseau et ingress {#d-networking--ingress}

Le service est joignable par défaut à son URL `run.app` (`ingress_settings =
"all"`), conformément à la finalité de Gokapi, qui génère des liens de
téléchargement partageables avec l'extérieur. Un équilibreur de charge HTTPS
externe avec Cloud Armor, un domaine personnalisé et Cloud CDN peuvent être
ajoutés via les variables du groupe 10.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés à Cloud Logging ; les métriques Cloud Run
sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des règles
d'alerte facultatifs (tous deux désactivés par défaut).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Gokapi {#3-gokapi-application-behaviour}

- **Aucune tâche d'initialisation ne s'exécute par défaut.** `Gokapi_Common` ne
  fournit aucune entrée `initialization_jobs` par défaut — Gokapi gère son propre
  stockage et n'a aucune base de données à amorcer. Seules les tâches fournies par
  l'utilisateur (chargement de données ou migration personnalisés) apparaissent
  dans Cloud Run Jobs.
- **La configuration au premier démarrage est entièrement interactive.** Il n'y a
  ni flag d'installation automatique ni mot de passe administrateur généré. La
  première personne qui ouvre **`/setup`** sur l'URL publique du service (la
  sortie `setup_url`) crée le compte administrateur via l'assistant propre à
  Gokapi — c'est le premier arrivé qui l'emporte. Jusque-là, `/` n'affiche que
  « Server is in maintenance mode ».
- **Où les données persistent physiquement.** `GOKAPI_CONFIG_DIR=/data/config` (la
  base de métadonnées SQLite et la configuration de l'application) et
  `GOKAPI_DATA_DIR=/data/data` (fichiers téléversés) se trouvent tous deux sur le
  montage GCS Fuse du bucket `storage` sur `/data`. Aucun commutateur intégré ne
  permet de les déplacer vers NFS ou un autre backend ; il faudrait pour cela
  remplacer manuellement `environment_variables` et activer `enable_nfs`.
- **Rédacteur unique, instance unique.** `min_instance_count = 1` /
  `max_instance_count = 1` par défaut. La base de données SQLite de Gokapi ne
  propose ni clustering ni réplication ; n'augmentez donc pas
  `max_instance_count` au-delà de 1.
- **Les sondes de santé interrogent la racine publique, sans authentification.**
  La sonde de démarrage comme la sonde de vivacité sont des **HTTP GET `/`** (la
  racine publique de Gokapi, 200, non authentifiée — avant la configuration, il
  s'agit de l'avis de maintenance, toujours en 200) — démarrage : `initial_delay=15s, timeout=5s, period=10s,
  failure_threshold=10` ; vivacité : `initial_delay=30s, timeout=5s, period=30s,
  failure_threshold=3`.
- **Le port du conteneur est fonctionnellement fixé à `53842`, même si la
  variable est transmise.** Contrairement à `Gokapi_GKE` (où la variable
  équivalente `container_port` est déclarée mais jamais transmise), le
  `gokapi.tf` de cette variante Cloud Run fusionne `container_port = var.container_port`
  dans la configuration propre à l'application qui atteint la fondation — la
  valeur est donc techniquement active ici. Cependant, le port d'écoute propre à
  Gokapi est codé en dur séparément sous la forme `GOKAPI_PORT = "53842"` dans les
  `environment_variables` de `Gokapi_Common` ; remplacer `container_port` par une
  autre valeur que `53842` acheminerait donc le trafic Cloud Run vers un port sur
  lequel le conteneur n'écoute pas réellement. Conservez la valeur par défaut.
- **Inspectez le service déployé et son état persistant :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  gcloud storage ls gs://<storage-bucket>/config gs://<storage-bucket>/data
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Gokapi ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `gokapi` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Gokapi File Sharing` | Nom lisible affiché dans la console. |
| `description` | `Gokapi self-hosted file sharing` | Description du service. |
| `application_version` | `latest` | Tag de l'image Gokapi ; se résout en une version épinglée `v1.9.6` lorsqu'il vaut `latest`, via l'argument de build propre à l'application `GOKAPI_VERSION`. |
| `enable_api_key` | `true` | Génère une clé API d'opérateur aléatoire dans Secret Manager, injectée en tant que `GOKAPI_API_KEY`. Simple jeton de commodité — Gokapi crée ses propres véritables clés API depuis l'interface d'administration. Vaut `true` par défaut, car la garde au moment du plan de `validation.tf` rejette la valeur par défaut du module `ingress_settings = "all"` lorsque ce paramètre vaut `false`. |

### Groupe 4 — Exécution et scaling {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. Gokapi est un binaire Go léger et a besoin de peu de ressources. |
| `memory_limit` | `1Gi` | Mémoire par instance. |
| `min_instance_count` | `1` | Maintenu à 1 pour éviter les démarrages à froid et conserver un unique rédacteur SQLite à chaud. |
| `max_instance_count` | `1` | **Conservez 1** — la base SQLite de Gokapi n'accepte qu'un seul rédacteur et n'a pas de mode distribué. |
| `container_port` | `53842` | Transmis dans la configuration propre à l'application du module (contrairement à `Gokapi_GKE`, où il est sans effet) — mais doit correspondre à `GOKAPI_PORT`, codé en dur à `53842` dans `Gokapi_Common`. Ne pas modifier. |
| `execution_environment` | `gen2` | Gen2 est requis pour le montage GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Doit rester `false` — Gokapi n'a pas de base de données Cloud SQL ; `main.tf` code cette valeur en dur quelle que soit la valeur de la variable. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Gokapi dans Artifact Registry. |
| `container_protocol` | `http1` | HTTP/1.1 standard ; Gokapi n'a aucune exigence gRPC/HTTP2. |
| `traffic_split` | `[]` | Répartit le trafic entre révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Déclarée par souci de cohérence avec les conventions ; non référencée par le déploiement de ce module. |

### Groupe 5 — Contrôle des accès et de l'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut, conformément à la finalité de Gokapi, qui génère des liens de téléchargement partageables. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google. Empêche les destinataires anonymes de suivre les liens de téléchargement partagés. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. `GOKAPI_CONFIG_DIR`, `GOKAPI_DATA_DIR` et `GOKAPI_PORT` sont définis automatiquement — ne les remplacez pas. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

Les variables standard de tâches de sauvegarde/importation d'`App_CloudRun`
(`backup_schedule`, `backup_retention_days`, `enable_backup_import`,
`backup_source`, `backup_uri`, `backup_format`) sont déclarées et transmises, mais
**sans effet pour Gokapi** — les mécanismes de sauvegarde et d'importation de la
fondation ne fonctionnent que lorsque `database_type` n'est pas `NONE`, et celui de
Gokapi est fixé à `NONE`. Il n'existe aucune sauvegarde automatisée de la base
SQLite ni des fichiers téléversés ; sauvegardez directement le bucket GCS
`storage` si nécessaire.

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés (sans effet) et découverte de l'instance NFS {#group-9--custom-sql-scripts-inert--nfs-instance-discovery}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé / `""` | Sans effet — Gokapi n'a pas de base de données SQL sur laquelle exécuter des scripts. |
| `nfs_instance_name` | `""` | Nom d'une VM GCE NFS existante à utiliser à la place de la découverte automatique. Pertinent uniquement si vous redirigez manuellement le stockage de Gokapi vers NFS (voir le groupe 11). |
| `nfs_instance_base_name` | `app-nfs` | Nom de base d'une VM GCE NFS en ligne, si elle est créée. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Cloud Run pour le montage NFS. |

### Groupe 10 — Équilibreur de charge, CDN et conservation des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage, système de fichiers et Redis {#group-11--storage-filesystem--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `storage` qui sous-tend `/data`. Le laisser à `false` casserait le seul chemin de persistance de Gokapi. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket `storage` provisionné automatiquement. |
| `enable_nfs` | `false` | Désactivé par défaut. L'activer provisionne Filestore/une VM NFS mais ne déplace **pas** automatiquement les données de Gokapi vers celui-ci — `GOKAPI_CONFIG_DIR`/`GOKAPI_DATA_DIR` pointent toujours vers `/data` (le montage GCS Fuse), sauf si vous les remplacez vous-même. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur si NFS est activé — distinct de `/data`. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse supplémentaires ; le montage `/data` du bucket `storage` est toujours ajouté en plus de cette liste. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `enable_redis` | `true` (valeur par défaut de la variable) | **Sans effet** — `main.tf` code en dur `enable_redis = false` vers la fondation, quelle que soit la valeur de cette variable. Gokapi n'a aucun usage de Redis. |
| `redis_host` / `redis_port` / `redis_auth` | — | Déclarées uniquement par souci de cohérence avec les conventions ; jamais transmises à la fondation. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

Toutes les variables du groupe 12 (`database_type`, `sql_instance_name`,
`application_database_name`, `application_database_user`,
`db_*_env_var_name`, `enable_postgres_extensions`, `enable_mysql_plugins`, etc.)
sont déclarées uniquement pour la compatibilité avec la mise en miroir des
conventions. `database_type` est fixé à `NONE` dans `Gokapi_Common`, et aucune des
variables de base de données associées n'est transmise à la fondation par
`main.tf` — Gokapi n'a pas de base de données SQL.

### Groupe 13 — Tâches et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucune tâche par défaut n'est injectée ; utilisez cette variable uniquement pour des tâches personnalisées de chargement de données ou de migration. |
| `cron_jobs` | `[]` | Tâches Cloud Run récurrentes ; Gokapi n'a aucune tâche de maintenance planifiée intégrée. |
| `backup_file` | `backup.sql` | Sans effet — voir le groupe 7 ; aucune base de données dans laquelle restaurer. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` , délai de 15 s, 10 tentatives | Sonde de démarrage — la racine publique de Gokapi (son interface, ou avant la configuration de premier lancement l'avis de maintenance), sans authentification. |
| `liveness_probe` | HTTP `/` , délai de 30 s, 3 tentatives | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/` (forme alternative) | Sonde structurée alternative. |
| `health_check_config` | HTTP `/` (forme alternative) | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 15 — Réseau {#group-15--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `network_name` | `""` | Déclarée par souci de cohérence avec les conventions ; non transmise par `main.tf` — le réseau VPC est toujours découvert automatiquement. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `gokapi_url` | L'URL du service Cloud Run (nommée `gokapi_url`, et non `service_url` comme la sortie générique des autres modules). |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés — inclut le bucket `storage` monté sur `/data`. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuelles tâches de configuration fournies par l'utilisateur (aucune par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

Notez l'absence de toute sortie `database_*` (il n'y a pas de base de données) et
d'une sortie d'ID de secret pour la clé API facultative — récupérez celle-ci
directement avec `gcloud secrets list --filter="name~api-key"` (voir la
[section 2C](#c-secret-manager--the-optional-api-key)).

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages GCS Fuse, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de la moindre ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'au moment de l'apply ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Montage GCS Fuse sur `/data` (inconditionnel, aucun commutateur dans ce module) | Acceptez-le pour un usage léger ; passez à `Gokapi_GKE` pour des charges de travail plus lourdes | Critical | GCS Fuse ne fournit pas de véritable verrouillage de fichiers POSIX, dont SQLite dépend pour un accès concurrent sûr. Il est impossible de faire passer ce module à un véritable volume en mode bloc — le commutateur n'existe que sur le PVC de StatefulSet de `Gokapi_GKE`. |
| `ingress_settings` | `all` (par défaut), avec une revendication rapide du compte administrateur | High | Comme le compte administrateur est créé via un assistant de premier lancement ouvert et non authentifié, une URL publique signifie que **n'importe qui** l'atteignant en premier revendique le compte administrateur. Revendiquez-le immédiatement après le déploiement, ou définissez `enable_iap = true` en attendant. |
| `max_instance_count` | `1` | Critical | La base de données SQLite de Gokapi n'accepte qu'un seul rédacteur et ne propose pas de clustering ; exécuter plus d'une instance expose à une corruption de la base et à des téléversements incohérents. |
| `container_port` | `53842` (conservez la valeur par défaut) | High | `GOKAPI_PORT` est codé en dur à `53842` dans les variables d'environnement de `Gokapi_Common`, indépendamment de cette variable ; modifier `container_port` achemine le trafic Cloud Run vers un port sur lequel le conteneur n'écoute pas. |
| `create_cloud_storage` | `true` | Critical | La valeur `false` supprime le seul bucket de persistance de Gokapi — la base SQLite et chaque fichier téléversé s'y trouvent. |
| `enable_api_key` (secret généré automatiquement) | Conservez la valeur par défaut `true` tant que `ingress_settings = "all"` | High | Une garde au moment du plan (`validate_gokapi_configuration` de `validation.tf`) fait échouer le plan si `ingress_settings = "all"` (la valeur par défaut du module) est combiné à `enable_api_key = false` — un accès public sans protection par clé API est rejeté d'emblée. Vous y serez confronté immédiatement si vous passez `enable_api_key` à `false` sans restreindre également `ingress_settings` à `"internal"` ou `"internal-and-cloud-load-balancing"`. Le jeton lui-même n'est qu'un secret de commodité — les véritables clés API de téléversement/téléchargement de Gokapi sont créées depuis l'interface d'administration, quel que soit ce paramètre — mais la *garde*, elle, n'est pas facultative. |
| `enable_nfs` | `false`, sauf si vous redirigez aussi `GOKAPI_CONFIG_DIR`/`GOKAPI_DATA_DIR` | Medium | Activer NFS seul provisionne une VM Filestore/NFS inutilisée — les données de Gokapi restent sur `/data` dans GCS Fuse, sauf si vous remplacez manuellement les variables d'environnement pour utiliser plutôt le chemin de montage NFS. |
| `enable_backup_import` / `backup_schedule` / etc. | Conservez les valeurs par défaut | Low | Ces variables sont sans effet pour Gokapi (`database_type = NONE`) ; il n'existe aucune sauvegarde automatisée de la base SQLite ni des téléversements. Sauvegardez directement le bucket `storage` si vous en avez besoin. |
| `min_instance_count` | `1` (par défaut) | Low | Maintenir 1 instance à chaud évite les démarrages à froid sur les liens de téléchargement partagés ; c'est peu coûteux pour un binaire Go léger. |
| `enable_cloud_armor` | activez-le en production | Medium | Une application de partage de fichiers joignable publiquement, dotée de surfaces de téléversement/d'administration non authentifiées, bénéficie de la protection d'un WAF. |

---

Pour le comportement de la fondation évoqué tout au long de ce guide — identité du
service, scaling et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des
images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à Gokapi partagée avec la variante GKE (image, bucket de
stockage, clé API facultative, sondes de santé) réside dans le module
`Gokapi_Common` (`modules/Gokapi_Common`), qui n'a pas encore de documentation de
plateforme autonome — consultez ses fichiers `main.tf`/`variables.tf`/`README.md`
pour le câblage sous-jacent.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Gokapi sur Cloud Run](../labs/Gokapi_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Gokapi sur GKE Autopilot](Gokapi_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Gokapi Common — Configuration applicative partagée](Gokapi_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Chibisafe sur Google Cloud Run](Chibisafe_CloudRun.md) et de [Cloudreve sur Google Cloud Run](Cloudreve_CloudRun.md) dans la solution **File Sharing & Transfer**.
