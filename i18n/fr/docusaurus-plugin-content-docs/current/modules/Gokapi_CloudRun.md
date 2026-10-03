---
title: "Gokapi sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Gokapi sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Gokapi_CloudRun.md @ 15fd4c7 sha256:6626a686cc82 -->

# Gokapi sur Google Cloud Run {#gokapi-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gokapi_CloudRun.png" alt="Gokapi sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gokapi est un serveur de partage de fichiers léger et auto-hébergé écrit en Go
— une alternative auto-hébergée à WeTransfer. Les utilisateurs téléchargent des
fichiers et génèrent des liens de téléchargement partageables avec des dates
d'expiration, des limites de nombre de téléchargements et une protection par mot
de passe optionnelles, le tout soutenu par une base de données SQLite interne
(aucune base de données externe requise). Ce module déploie Gokapi sur **Cloud
Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Gokapi et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## 1. Vue d'ensemble {#1-overview}

Gokapi s'exécute comme un conteneur binaire Go unique sur Cloud Run v2, sans
base de données externe. Le déploiement relie un ensemble restreint et ciblé de
services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur binaire Go sur le port `53842`, `1000m` CPU / `1Gi` mémoire par défaut ; révision unique, `min_instance_count = 1` / `max_instance_count = 1` |
| Base de données | **Aucune (SQLite, sur stockage monté)** | Pas de Cloud SQL — `database_type` est fixé à `NONE` par `Gokapi_Common` ; Gokapi écrit sa propre base de données SQLite sous `GOKAPI_CONFIG_DIR` |
| Persistance des fichiers et de la base de données | Bucket Cloud Storage monté via **GCS Fuse** à `/data` | Le seul chemin de persistance disponible sur Cloud Run — il n'y a pas de concept de PVC/stockage par blocs ici, contrairement au PVC StatefulSet utilisé par `Gokapi_GKE` |
| Stockage d'objets | Cloud Storage | Le bucket suffixé `storage` est auto-provisionné et, sur Cloud Run, est toujours monté (pas inactif, contrairement à la variante GKE) |
| Secrets | Secret Manager | Seulement une clé API d'opérateur **optionnelle** (`GOKAPI_API_KEY`) ; pas de secret généré obligatoire |
| Ingress | URL Cloud Run / Cloud Load Balancing | `ingress_settings = "all"` par défaut, donc le service est publiquement accessible dès le départ |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de Cloud SQL, jamais.** `database_type` est fixé en dur à `NONE` par
  `Gokapi_Common` — les variables de base de données génériques de ce module
  (`sql_instance_name`, `application_database_name`, `db_*_env_var_name`, etc.)
  sont transmises à la fondation uniquement pour la compatibilité de la mise en
  miroir des variables et n'ont aucun effet.
- **SQLite + les fichiers téléchargés persistent via un montage GCS Fuse, pas un
  véritable volume de blocs.** Cloud Run n'a pas d'équivalent PVC/StatefulSet,
  donc `Gokapi_Common` monte le bucket `storage` auto-provisionné à `/data`
  en utilisant GCS Fuse (`enable_gcs_storage_volume` par défaut `true` à l'intérieur de `Gokapi_Common`,
  et cette variante Cloud Run n'expose **aucune variable pour le désactiver** —
  ce basculement n'existe que sur `Gokapi_GKE`, lié à `stateful_pvc_enabled`). `GOKAPI_CONFIG_DIR =
  /data/config`
  (configuration + la base de données SQLite) et `GOKAPI_DATA_DIR = /data/data` (fichiers
  téléchargés) résident tous deux sur ce montage. GCS Fuse ne fournit pas de
  verrouillage de fichiers POSIX réel, ce qui est exactement la sémantique dont
  dépend une application basée sur SQLite — voir la
  [Section 6](#6-configuration-pitfalls--sensible-defaults) pour le risque que
  cela comporte.
- **Le bucket GCS `storage` est essentiel ici, pas décoratif.** Contrairement à
  `Gokapi_GKE` (où le bucket reste inutilisé derrière un PVC StatefulSet par
  défaut), sur Cloud Run ce bucket **est** la couche de persistance pour la base
  de données SQLite et tous les fichiers téléchargés.
- **Instance unique par conception.** `min_instance_count = 1`, `max_instance_count =
  1`. La base de données SQLite de Gokapi est à écrivain unique sans
  mécanisme de clustering/réplication, donc ne pas dépasser 1 instance.
- **Aucun mot de passe administrateur n'est généré automatiquement.** Gokapi
  n'a pas de secret obligatoire — le compte administrateur est créé
  interactivement via l'assistant de configuration de première exécution de
  Gokapi à **`/setup`** (la sortie `setup_url`). Tant qu'il n'est pas
  terminé, toutes les autres pages — y compris `/` — répondent "Le
  serveur est en mode maintenance, veuillez réessayer dans quelques minutes".
- **Clé API d'opérateur optionnelle, requise par défaut.** `enable_api_key` (par
  défaut `true` sur `Gokapi_CloudRun`) génère un jeton aléatoire de 32
  caractères, le stocke dans Secret Manager et l'injecte comme `GOKAPI_API_KEY` via
  le mécanisme `module_secret_env_vars` du module. Il s'agit uniquement d'un jeton de
  commodité — les propres clés API de téléchargement/téléchargement de Gokapi
  sont normalement générées à partir de l'interface utilisateur d'administration
  après la configuration. Il est par défaut `true` ici (contrairement au
  propre défaut `Gokapi_Common` de `false`) en raison de la garde au moment de la
  planification ci-dessous.
- **Redis est désactivé de force.** `main.tf` code en dur `enable_redis = false` à la
  fondation quelle que soit la valeur de la variable — Gokapi n'a aucune utilité
  pour Redis.
- **L'ingress public est activé par défaut, et il est contrôlé au moment de la
  planification par la clé API.** `ingress_settings = "all"` correspond à l'objectif de Gokapi
  de générer des liens de téléchargement partageables accessibles depuis
  l'extérieur du VPC — mais cela signifie également que l'assistant de
  configuration de première exécution non authentifié est publiquement
  accessible jusqu'à ce qu'un compte administrateur soit revendiqué. La garde
  `validation.tf` de `validate_gokapi_configuration` échoue en dur le plan chaque fois que `ingress_settings = "all"`
  est combiné avec `enable_api_key = false`, de sorte que le couplage par défaut du module
  (`"all"` + `enable_api_key = true`) est la seule combinaison prête à l'emploi qui se
  planifie proprement ; le passage de `enable_api_key` à `false` nécessite
  également de restreindre `ingress_settings` à `"internal"` (ou `"internal-and-cloud-load-balancing"`).
- **Construit comme une image personnalisée mince, épinglée contre le piège de
  la balise `latest`.** L'image est un wrapper `FROM f0rc3/gokapi:${GOKAPI_VERSION}` d'une ligne afin que
  la fondation puisse la mettre en miroir dans Artifact Registry. `GOKAPI_VERSION`
  (un argument de build spécifique à l'application que l'injection générique
  `APP_VERSION` de la fondation ne touche pas) se résout en un `v1.9.6` épinglé
  lorsque `application_version = "latest"`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
de services et de ressources sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Gokapi {#a-cloud-run--the-gokapi-service}

Gokapi s'exécute comme un service/révision Cloud Run v2 unique. `min_instance_count = 1`
maintient une instance chaude en permanence (évitant les démarrages à froid et
préservant l'écrivain SQLite unique) ; `max_instance_count = 1` ne doit pas être augmenté.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Stockage persistant — le montage GCS Fuse à `/data` {#b-persistent-storage--the-gcs-fuse-mount-at-data}

Il n'y a pas d'instance Cloud SQL et pas de PVC. Au lieu de cela, le bucket
Cloud Storage `storage` auto-provisionné est monté dans le conteneur comme un
volume GCS Fuse à `/data`, et `GOKAPI_CONFIG_DIR=/data/config` (base de données de métadonnées
SQLite + configuration de l'application) et `GOKAPI_DATA_DIR=/data/data` (fichiers
téléchargés) résident tous deux sous ce montage unique. Ce montage est
inconditionnel sur ce module — il n'y a pas de variable ici pour le désactiver
(comparez `Gokapi_GKE`, qui désactive le volume GCS équivalent chaque fois que
son PVC StatefulSet est activé).

- **Console :** Cloud Storage → Buckets, pour le contenu du bucket ; Cloud Run →
  service → Révisions → **Volumes**, pour confirmer le montage.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<storage-bucket>/config gs://<storage-bucket>/data
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la sémantique du montage GCS Fuse et
ses avertissements de performance pour les charges de travail de type base de
données, et la
[Section 6](#6-configuration-pitfalls--sensible-defaults) ci-dessous pour
savoir pourquoi cela est particulièrement important pour la base de données
SQLite de Gokapi.

### C. Secret Manager — la clé API optionnelle {#c-secret-manager--the-optional-api-key}

Gokapi ne crée **aucun secret obligatoire**. Le seul secret que ce module peut
créer est le jeton de commodité d'opérateur `GOKAPI_API_KEY` optionnel, contrôlé par
`enable_api_key` (par défaut `false`). Ce secret n'est **pas** affiché dans les
[Sorties](#5-outputs) de ce module — recherchez-le directement par son nom.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<api-key-secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails sur l'injection et la
rotation des secrets.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (`ingress_settings =
"all"`), ce
qui correspond à l'objectif de Gokapi de générer des liens de téléchargement
partageables en externe. Un équilibreur de charge HTTPS externe avec Cloud
Armor, un domaine personnalisé et Cloud CDN peuvent être ajoutés via les
variables du groupe 10.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et
des politiques d'alerte optionnelles (toutes deux désactivées par défaut).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Gokapi {#3-gokapi-application-behaviour}

- **Aucun job d'initialisation n'est exécuté par défaut.** `Gokapi_Common` ne fournit
  aucune entrée `initialization_jobs` par défaut — Gokapi gère son propre stockage et n'a
  pas besoin de base de données pour démarrer. Seuls les jobs fournis par
  l'utilisateur (chargement ou migration de données personnalisées)
  apparaissent sous Cloud Run Jobs.
- **La configuration au premier démarrage est entièrement interactive.** Il n'y a
  pas de drapeau d'installation automatique et pas de mot de passe
  administrateur généré. La première personne à ouvrir **`/setup`** sur
  l'URL publique du service (la sortie `setup_url`) crée le compte
  administrateur via l'assistant de Gokapi — le premier arrivé. `/`
  lui-même n'affiche que "Le serveur est en mode maintenance" jusque-là.
- **Où les données persistent physiquement.** `GOKAPI_CONFIG_DIR=/data/config` (la base de données
  de métadonnées SQLite et la configuration de l'application) et `GOKAPI_DATA_DIR=/data/data`
  (fichiers téléchargés) résident tous deux sur le montage GCS Fuse du bucket
  `storage` à `/data`. Il n'y a pas de commutateur intégré pour déplacer
  cela vers NFS ou un backend différent ; cela nécessiterait de remplacer
  manuellement `environment_variables` et d'activer `enable_nfs`.
- **Écrivain unique, instance unique.** `min_instance_count = 1` / `max_instance_count = 1` par défaut. La
  base de données SQLite de Gokapi n'a pas de mécanisme de
  clustering/réplication, donc ne pas augmenter `max_instance_count` au-dessus de 1.
- **Les sondes de santé atteignent la racine publique, aucune authentification
  requise.** La sonde de démarrage et la sonde de vivacité sont toutes deux
  **HTTP GET `/`** (racine publique de Gokapi, 200, non authentifiée —
  avant la configuration, c'est l'avis de maintenance, toujours 200) — démarrage
  : `initial_delay=15s, timeout=5s, period=10s,
  failure_threshold=10` ; vivacité : `initial_delay=30s, timeout=5s, period=30s,
  failure_threshold=3`.
- **Le port du conteneur est fonctionnellement fixé à `53842`, même si la
  variable est transmise.** Contrairement à `Gokapi_GKE` (où la variable
  équivalente `container_port` est déclarée mais jamais transmise), le `gokapi.tf`
  de cette variante Cloud Run fusionne `container_port = var.container_port` dans la configuration par
  application qui atteint la fondation — donc la valeur est techniquement active
  ici. Cependant, le propre port d'écoute de Gokapi est séparément codé en dur
  comme `GOKAPI_PORT = "53842"` dans le `Gokapi_Common` de `environment_variables`, donc changer `container_port`
  de `53842` acheminerait le trafic Cloud Run vers un port sur lequel le
  conteneur n'écoute pas réellement. Laissez-le par défaut.
- **Inspectez le service déployé et son état persistant :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  gcloud storage ls gs://<storage-bucket>/config gs://<storage-bucket>/data
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques à Gokapi ou
remarquables pour Gokapi sont listés ; toutes les autres entrées sont héritées
de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `gokapi` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Gokapi File Sharing` | Nom lisible par l'homme affiché dans la console. |
| `description` | `Gokapi self-hosted file sharing` | Description du service. |
| `application_version` | `latest` | Balise d'image Gokapi ; se résout en un `v1.9.6` épinglé lorsque `latest` via l'argument de build `GOKAPI_VERSION` spécifique à l'application. |
| `enable_api_key` | `true` | Génère une clé API d'opérateur aléatoire dans Secret Manager, injectée comme `GOKAPI_API_KEY`. Un jeton de commodité uniquement — Gokapi génère ses propres clés API réelles à partir de l'interface utilisateur d'administration. Par défaut `true` car la garde au moment de la planification dans `validation.tf` rejette le défaut `ingress_settings = "all"` du module lorsque cela est `false`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. Gokapi est un binaire Go léger et nécessite peu de ressources. |
| `memory_limit` | `1Gi` | Mémoire par instance. |
| `min_instance_count` | `1` | Maintenu à 1 pour éviter les démarrages à froid et conserver un seul écrivain SQLite chaud. |
| `max_instance_count` | `1` | **Maintenir à 1** — la base de données SQLite de Gokapi est à écrivain unique sans mode distribué. |
| `container_port` | `53842` | Transmis dans la configuration par application du module (contrairement à `Gokapi_GKE`, où il est inerte) — mais doit correspondre à `GOKAPI_PORT`, qui est codé en dur `53842` dans `Gokapi_Common`. Ne pas modifier. |
| `execution_environment` | `gen2` | Gen2 requis pour le montage GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Doit rester `false` — Gokapi n'a pas de base de données Cloud SQL ; `main.tf` code cela en dur quelle que soit la valeur de la variable. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Gokapi dans Artifact Registry. |
| `container_protocol` | `http1` | HTTP/1.1 standard ; Gokapi n'a pas d'exigence gRPC/HTTP2. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non référencé par le déploiement de ce module. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut, correspondant à l'objectif de Gokapi de générer des liens de téléchargement partageables. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. Bloque les destinataires anonymes de suivre les liens de téléchargement partagés. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `GOKAPI_CONFIG_DIR`, `GOKAPI_DATA_DIR` et `GOKAPI_PORT` sont définis automatiquement — ne pas les remplacer. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

Les variables de job de sauvegarde/importation `App_CloudRun` standard (`backup_schedule`,
`backup_retention_days`, `enable_backup_import`, `backup_source`, `backup_uri`,
`backup_format`) sont déclarées et transmises, mais **inertes pour Gokapi** — le
mécanisme de sauvegarde et d'importation de la fondation ne fonctionne que
lorsque `database_type` n'est pas `NONE`, et celui de Gokapi est fixé à `NONE`.
Il n'y a pas de sauvegarde automatisée de la base de données SQLite ou des
fichiers téléchargés ; sauvegardez directement le bucket GCS `storage` si
nécessaire.

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés (inertes) et découverte d'instances NFS {#group-9--custom-sql-scripts-inert--nfs-instance-discovery}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé / `""` | Inerte — Gokapi n'a pas de base de données SQL sur laquelle exécuter des scripts. |
| `nfs_instance_name` | `""` | Nom d'une VM GCE NFS existante à utiliser au lieu de la découverte automatique. Pertinent uniquement si vous redirigez manuellement le stockage de Gokapi vers NFS (voir Groupe 11). |
| `nfs_instance_base_name` | `app-nfs` | Nom de base pour une VM GCE NFS intégrée, si elle est créée. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Cloud Run pour le montage NFS. |

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage, système de fichiers et Redis {#group-11--storage-filesystem--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `storage` qui soutient `/data`. Laisser ceci `false` casserait le seul chemin de persistance de Gokapi. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket `storage` auto-provisionné. |
| `enable_nfs` | `true` | Doit rester `true` sur Cloud Run : la base de données SQLite de Gokapi atterrit sous `/data`, et GCS FUSE ne peut pas héberger une base de données SQLite. |
| `nfs_mount_path` | `/data` | Chemin de montage à l'intérieur du conteneur si NFS est activé — distinct de `/data`. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse supplémentaires ; le montage `storage` de `/data` est toujours ajouté en plus de cette liste. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `enable_redis` | `true` (valeur par défaut de la variable) | **Inerte** — `main.tf` code en dur `enable_redis = false` à la fondation quelle que soit la valeur de cette variable. Gokapi n'a aucune utilité pour Redis. |
| `redis_host` / `redis_port` / `redis_auth` | — | Déclaré uniquement pour la mise en miroir de convention ; jamais transmis à la fondation. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

Toutes les variables du Groupe 12 (`database_type`, `sql_instance_name`,
`application_database_name`, `application_database_user`, `db_*_env_var_name`, `enable_postgres_extensions`,
`enable_mysql_plugins`, etc.) sont déclarées uniquement pour la compatibilité de la mise en
miroir de convention. `database_type` est fixé à `NONE` à l'intérieur de
`Gokapi_Common`, et aucune des variables de base de données sœurs n'est transmise à
la fondation par `main.tf` — Gokapi n'a pas de base de données SQL.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun job par défaut n'est injecté ; utilisez ceci uniquement pour les jobs de chargement ou de migration de données personnalisés. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents ; Gokapi n'a pas de tâche de maintenance planifiée intégrée. |
| `backup_file` | `backup.sql` | Inerte — voir Groupe 7 ; pas de base de données à restaurer. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` , 15s de délai, 10 tentatives | Sonde de démarrage — racine publique de Gokapi (son interface utilisateur, ou avant la première configuration l'avis de maintenance), pas d'authentification. |
| `liveness_probe` | HTTP `/` , 30s de délai, 3 tentatives | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/` (forme alternative) | Sonde structurée alternative. |
| `health_check_config` | HTTP `/` (forme alternative) | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métriques. |

### Groupe 15 — Réseau {#group-15--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `network_name` | `""` | Déclaré pour la mise en miroir de convention ; non transmis par `main.tf` — le réseau VPC est toujours auto-découvert. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `gokapi_url` | L'URL du service Cloud Run (nommée `gokapi_url`, pas la générique `service_url` utilisée par d'autres modules). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés — inclut le bucket `storage` monté à `/data`. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration fournis par l'utilisateur (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

Notez l'absence de toute sortie `database_*` (il n'y a pas de base de données) et
d'une sortie d'ID de secret pour la clé API optionnelle — récupérez-la
directement avec `gcloud secrets list --filter="name~api-key"` (voir [Section 2C](#c-secret-manager--the-optional-api-key)).

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — un
> réplica en lecture sans son primaire, IAP sans identités autorisées, un
> environnement d'exécution `gen1` avec des montages GCS Fuse, un
> `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le
> **plan** avec une erreur claire et nommée avant la création de toute
> ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en
> amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Montage GCS Fuse à `/data` (inconditionnel, pas de bascule sur ce module) | L'accepter pour une utilisation légère ; passer à `Gokapi_GKE` pour des charges de travail plus lourdes | Critique | GCS Fuse ne fournit pas de verrouillage de fichiers POSIX réel, dont SQLite dépend pour un accès concurrent sûr. Il n'y a aucun moyen de remplacer ce module par un véritable volume de blocs — le basculement n'existe que sur le PVC StatefulSet de `Gokapi_GKE`. |
| `ingress_settings` | `all` (par défaut) avec revendication d'administrateur rapide | Élevé | Étant donné que le compte administrateur est créé via un assistant de première exécution ouvert et non authentifié, une URL publique signifie que **n'importe qui** qui l'atteint en premier revendique le compte administrateur. Revendiquez-le immédiatement après le déploiement, ou définissez `enable_iap = true` jusqu'à ce que vous l'ayez fait. |
| `max_instance_count` | `1` | Critique | La base de données SQLite de Gokapi est à écrivain unique sans clustering ; l'exécution de plus d'une instance risque une corruption de la base de données et des téléchargements incohérents. |
| `container_port` | `53842` (laisser par défaut) | Élevé | `GOKAPI_PORT` est codé en dur à `53842` dans les variables d'environnement de `Gokapi_Common` indépendamment de cette variable ; changer `container_port` achemine le trafic Cloud Run vers un port sur lequel le conteneur n'écoute pas. |
| `create_cloud_storage` | `true` | Critique | La définition de `false` supprime le seul bucket de persistance de Gokapi — la base de données SQLite et tous les téléchargements y résident. |
| `enable_api_key` (secret auto-généré) | Laisser à la valeur par défaut `true` pendant `ingress_settings = "all"` | Élevé | Une garde au moment de la planification (`validation.tf` de `validate_gokapi_configuration`) fait échouer en dur le plan si `ingress_settings = "all"` (le défaut du module) est combiné avec `enable_api_key = false` — l'accès public sans protection par clé API est rejeté d'emblée. Vous rencontrerez cela immédiatement si vous basculez `enable_api_key` sur `false` sans également restreindre `ingress_settings` à `"internal"` ou `"internal-and-cloud-load-balancing"`. Le jeton lui-même n'est qu'un secret de commodité — les vraies clés API de téléchargement/téléchargement de Gokapi sont générées à partir de l'interface utilisateur d'administration quelle que soit cette configuration — mais la *garde* n'est pas facultative. |
| `enable_nfs` | `false` à moins que vous ne redirigiez également `GOKAPI_CONFIG_DIR`/`GOKAPI_DATA_DIR` | Moyen | L'activation de NFS seule provisionne une VM Filestore/NFS inutilisée — les données de Gokapi résident toujours à `/data` sur GCS Fuse à moins que vous ne remplaciez manuellement les variables d'environnement pour utiliser le chemin de montage NFS à la place. |
| `enable_backup_import` / `backup_schedule` / etc. | Laisser par défaut | Faible | Ces variables sont inertes pour Gokapi (`database_type = NONE`) ; aucune sauvegarde automatisée de la base de données SQLite ou des téléchargements n'existe. Sauvegardez directement le bucket `storage` si vous en avez besoin. |
| `min_instance_count` | `1` (par défaut) | Faible | Maintenir 1 instance chaude évite les démarrages à froid sur les liens de téléchargement partagés ; c'est bon marché pour un binaire Go léger. |
| `enable_cloud_armor` | activer pour la production | Moyen | Une application de partage de fichiers publiquement accessible avec des surfaces de téléchargement/administration non authentifiées bénéficie de la protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Gokapi partagée avec la variante GKE (image, bucket
de stockage, clé API optionnelle, sondes de santé) réside dans le module
`Gokapi_Common` (`modules/Gokapi_Common`), qui n'a pas encore de documentation de plateforme
autonome — voir ses `main.tf`/`variables.tf`/`README.md` pour le câblage
sous-jacent.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Gokapi sur Cloud Run](../labs/Gokapi_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Gokapi sur GKE Autopilot](Gokapi_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Gokapi Common — Configuration d'application partagée](Gokapi_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Chibisafe sur Google Cloud Run](Chibisafe_CloudRun.md), [Cloudreve sur Google Cloud Run](Cloudreve_CloudRun.md) dans la solution **Partage et transfert de fichiers**.
