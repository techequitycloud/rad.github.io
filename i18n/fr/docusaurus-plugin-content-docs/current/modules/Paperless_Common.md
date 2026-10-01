---
title: "Module de configuration partagée Paperless-ngx Common"
description: "Référence de la configuration partagée du module Paperless-ngx — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Paperless_Common.md @ 3055034 sha256:62bd04d6a5cf -->

# Module de configuration partagée Paperless-ngx Common {#paperless-ngx-common-shared-configuration-module}

Le module `Paperless Common` définit la configuration du système de gestion documentaire Paperless-ngx pour l'écosystème RAD Modules. Il s'agit d'un **module de configuration pur** — il ne crée directement aucune ressource GCP et produit une sortie `config` utilisée par les modules wrapper propres à chaque plateforme (`Paperless CloudRun` et `Paperless GKE`). Il génère également automatiquement deux secrets applicatifs dans Secret Manager.

## 1. Vue d'ensemble {#1-overview}

**Objectif** : centraliser toute la configuration propre à Paperless-ngx (image de conteneur personnalisée, configuration de la base de données PostgreSQL, mappage des variables d'environnement, sondes de santé, stockage média GCS Fuse et définition du job `db-init`) dans un module unique partagé par les déploiements Cloud Run et GKE.

**Architecture** :

```
Layer 3: Application Wrappers
├── Paperless_CloudRun  ──┐
└── Paperless_GKE       ──┤── instantiate Paperless_Common
                          ↓
             Paperless_Common (this module)
             Creates: PAPERLESS_ADMIN_PASSWORD secret
                      PAPERLESS_SECRET_KEY secret
             Produces: config, secret_ids, storage_buckets
                      ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                      ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Caractéristiques clés** :
- Utilise **PostgreSQL 15** (contrairement à Ghost Common, qui utilise MySQL 8.0 — c'est la norme pour tous les autres modules de l'écosystème).
- **Crée deux secrets GCP** dans Secret Manager : `PAPERLESS_ADMIN_PASSWORD` et `PAPERLESS_SECRET_KEY`. C'est une différence importante par rapport à Ghost Common (qui ne crée aucun secret), et un point commun avec Django Common et Directus Common.
- Fournit un **volume média GCS Fuse** comme principal mécanisme de persistance, plutôt que de s'appuyer sur NFS pour le stockage des documents.
- `PAPERLESS_SECRET_KEY` est un secret de l'application Django — le régénérer invalide toutes les sessions utilisateur existantes.
- Redis est **obligatoire** (et non facultatif) — Paperless-ngx utilise Redis comme courtier de messages Celery pour tout le traitement en arrière-plan.

---

## 2. Sorties {#2-outputs}

### `config` {#config}
L'objet de configuration de l'application transmis au module de plateforme via `application_config`.

| Champ | Valeur / description |
|---|---|
| `app_name` | `"paperless"` |
| `application_version` | Tag de version (par défaut : `"latest"`) |
| `container_image` | `"ghcr.io/paperless-ngx/paperless-ngx"` (image GHCR utilisée comme base du build) |
| `image_source` | `"custom"` — une image wrapper personnalisée est construite |
| `enable_image_mirroring` | `var.enable_image_mirroring` (par défaut `true`) — met l'image en miroir dans Artifact Registry |
| `container_build_config` | `dockerfile_path = "Dockerfile"`, `context_path = "."`, `build_args = {}` |
| `container_port` | `8000` |
| `database_type` | `"POSTGRES_15"` |
| `db_name` | Nom de la base de données (par défaut : `"paperless"`) |
| `db_user` | Utilisateur de la base de données (par défaut : `"paperless"`) |
| `enable_cloudsql_volume` | Indique s'il faut monter le side-car Cloud SQL Auth Proxy (par défaut : `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | Montages de volumes GCS Fuse. Si la liste est vide, un volume `paperless-media` par défaut est configuré automatiquement sur `/usr/src/paperless/media` |
| `container_resources` | CPU : `2000m`, mémoire : `2Gi` |
| `environment_variables` | Assemblé à partir de toutes les entrées de variables d'environnement propres à Paperless-ngx (voir §7) |
| `initialization_jobs` | Job `db-init` par défaut ou remplacement personnalisé (voir §5) |
| `startup_probe` | HTTP `GET /`, délai initial de 60s, timeout de 10s, période de 10s, seuil d'échec de 30 |
| `liveness_probe` | HTTP `GET /`, délai initial de 60s, timeout de 10s, période de 30s, seuil d'échec de 3 |

### `secret_ids` {#secret_ids}
Une table associant des noms de variables d'environnement à des ID de secrets Secret Manager. Ils sont injectés dans le conteneur à l'exécution par le module de plateforme.

| Clé | Description du secret |
|---|---|
| `PAPERLESS_ADMIN_PASSWORD` | Mot de passe du compte administrateur initial. Chaîne aléatoire de 24 caractères générée automatiquement. |
| `PAPERLESS_SECRET_KEY` | Clé secrète de l'application Django. Chaîne aléatoire de 64 caractères générée automatiquement. Utilisée pour la signature des sessions et la protection CSRF. |

### `storage_buckets` {#storage_buckets}
Une liste de configurations de buckets GCS à provisionner par le module de plateforme :

| Champ | Valeur |
|---|---|
| `name_suffix` | `"media"` |
| `location` | Région du déploiement |
| `storage_class` | `"STANDARD"` |
| `force_destroy` | `true` |
| `versioning_enabled` | `false` |
| `lifecycle_rules` | `[]` |
| `public_access_prevention` | `"inherited"` |

---

## 3. Variables d'entrée {#3-input-variables}

### Application {#application}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `application_name` | `string` | `"paperless"` | Nom de l'application utilisé dans le nommage des ressources |
| `application_version` | `string` | `"latest"` | Tag de version de l'image Paperless-ngx. Épinglez une version précise en production |
| `description` | `string` | `"Paperless-ngx - open-source document management system"` | Description de l'application |
| `db_name` | `string` | `"paperless"` | Nom de la base de données PostgreSQL |
| `db_user` | `string` | `"paperless"` | Utilisateur applicatif PostgreSQL |
| `cpu_limit` | `string` | `"2000m"` | Limite de CPU du conteneur |
| `memory_limit` | `string` | `"2Gi"` | Limite de mémoire du conteneur |
| `environment_variables` | `map(string)` | `{}` | Variables d'environnement supplémentaires transmises au conteneur |
| `initialization_jobs` | `list(any)` | `[]` | Jobs d'initialisation personnalisés ; une liste vide déclenche le job `db-init` par défaut |
| `startup_probe` | `object` | voir §4 | Configuration de la sonde de démarrage |
| `liveness_probe` | `object` | voir §4 | Configuration de la sonde de liveness |
| `enable_image_mirroring` | `bool` | `true` | Met l'image GHCR en miroir dans Artifact Registry avant le déploiement |
| `min_instance_count` | `number` | `1` | Nombre minimal d'instances en cours d'exécution |
| `max_instance_count` | `number` | `3` | Nombre maximal d'instances en cours d'exécution |

### Stockage et volumes {#storage--volumes}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloudsql_volume` | `bool` | `true` | Monte le socket du side-car Cloud SQL Auth Proxy |
| `gcs_volumes` | `list(object)` | `[]` | Montages de volumes GCS Fuse. Une liste vide déclenche le montage automatique par défaut de paperless-media sur `/usr/src/paperless/media` |
| `region` | `string` | `"us-central1"` | Région du bucket de stockage |

### Paramètres de Paperless-ngx {#paperless-ngx-settings}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `time_zone` | `string` | `"UTC"` | Fuseau horaire des horodatages de documents et des tâches planifiées |
| `ocr_language` | `string` | `"eng"` | Code(s) de langue OCR de Tesseract. Utilisez `+` pour en combiner plusieurs |
| `admin_user` | `string` | `"admin"` | Nom d'utilisateur du superutilisateur créé automatiquement |
| `admin_email` | `string` | `"admin@example.com"` | Adresse e-mail du superutilisateur créé automatiquement |
| `service_url` | `string` | `""` | URL publique du service. Utilisée pour `PAPERLESS_URL`. |

### Intégration externe {#external-integration}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `redis_host` | `string` | `null` | IP ou nom d'hôte de Redis. Laissez vide pour utiliser l'IP du serveur NFS |
| `redis_port` | `string` | `"6379"` | Port TCP de Redis |
| `enable_redis` | `bool` | `true` | Active Redis comme courtier Celery et backend de résultats |
| `redis_auth` | `string` | `""` | Mot de passe Redis AUTH. Sensible |
| `nfs_server_ip` | `string` | `null` | IP du serveur NFS utilisée comme hôte Redis de repli lorsque `enable_redis = true` et qu'aucun `redis_host` n'est fourni |

---

## 4. Sondes de santé {#4-health-probes}

Toutes les sondes ciblent `GET /` (la page de connexion de Paperless-ngx, qui renvoie HTTP 200 une fois l'initialisation terminée) :

| Sonde | Délai initial | Timeout | Période | Seuil d'échec | Objectif |
|---|---|---|---|---|---|
| **Démarrage** | 60s | 10s | 10s | 30 | Accorde environ 360s au total (60s de délai + 30 × 10s) pour que Paperless-ngx termine les migrations de base de données et démarre les workers Celery |
| **Liveness** | 60s | 10s | 30s | 3 | Redémarre le conteneur si Paperless-ngx ne répond plus |

**Pourquoi un seuil de démarrage aussi généreux :** Paperless-ngx applique les migrations de base de données Django au premier démarrage. Sur une base de données vierge, cela peut représenter des dizaines d'étapes de migration — en particulier pour la création du schéma initial couvrant les documents, les étiquettes, les correspondants, les types de documents et les champs personnalisés. Le `failure_threshold = 30` associé à `period_seconds = 10` offre environ 360 secondes de tolérance totale au démarrage (délai initial de 60s compris), ce qui couvre même les instances Cloud SQL lentes ayant de nombreuses migrations en attente.

Contrairement à Ghost Common, Paperless Common ne définit **pas** de sonde de disponibilité (readiness) — les sondes de démarrage et de liveness suffisent pour les modèles de déploiement Cloud Run et GKE.

---

## 5. Job d'initialisation {#5-initialization-job}

Un job `db-init` s'exécute par défaut (lorsque `initialization_jobs = []`) :

| Champ | Valeur |
|---|---|
| Image | Image de client PostgreSQL |
| Script | `scripts/db-init.sh` |
| Secrets requis | `DB_PASSWORD` (utilisateur applicatif) |
| `execute_on_apply` | `true` |
| Timeout | 600s, 1 nouvelle tentative |

Comportement de `db-init.sh` :
1. Résout la connexion Cloud SQL à partir de `DB_HOST` (chemin du socket Unix sous `/cloudsql` lorsque `enable_cloudsql_volume = true`).
2. Interroge la base de données avec le client PostgreSQL (jusqu'à 30 tentatives, espacées de 2s) jusqu'à ce qu'elle soit joignable.
3. Crée l'utilisateur applicatif (`paperless`) avec le mot de passe issu de Secret Manager (`DB_PASSWORD`) s'il n'existe pas déjà.
4. Crée la base de données `paperless` si elle n'existe pas déjà, avec l'utilisateur applicatif comme propriétaire.
5. Accorde tous les privilèges nécessaires sur la base de données.
6. Signale l'arrêt de Cloud SQL Proxy une fois terminé.

Remplacez `initialization_jobs` par une liste non vide pour substituer des jobs personnalisés à ce comportement par défaut. Chaque job personnalisé doit spécifier au moins l'un des éléments `command`, `args` ou `script_path`.

---

## 6. Secrets créés par Paperless Common {#6-secrets-created-by-paperless-common}

Contrairement à Ghost Common (qui ne crée aucun secret), Paperless Common provisionne automatiquement deux secrets Secret Manager au moment de l'apply. Ces secrets sont créés dans le même projet GCP que le déploiement et injectés dans le conteneur à l'exécution via le mécanisme `module_secret_env_vars` du module de plateforme.

| Modèle de nom du secret | Variable d'environnement | Valeur | Rotation |
|---|---|---|---|
| `secret-<resource-prefix>-paperless-admin-password` | `PAPERLESS_ADMIN_PASSWORD` | Chaîne alphanumérique aléatoire de 24 caractères | Pas de rotation automatique. À récupérer dans Secret Manager pour la première connexion. |
| `secret-<resource-prefix>-paperless-key` | `PAPERLESS_SECRET_KEY` | Chaîne alphanumérique aléatoire de 64 caractères | Pas de rotation automatique. Changer cette valeur invalide toutes les sessions utilisateur actives. |

**Important :** le secret `PAPERLESS_ADMIN_PASSWORD` n'est utilisé que lors de la création initiale du superutilisateur. Après le premier démarrage de Paperless-ngx, l'utilisateur administrateur existe dans la base de données PostgreSQL et son mot de passe peut être modifié via l'interface de Paperless-ngx. Le secret Secret Manager conserve toutefois la valeur d'origine — utilisez `gcloud secrets versions access latest` pour la récupérer lors de la connexion initiale si le mot de passe n'a pas été modifié.

**Stabilité de `PAPERLESS_SECRET_KEY` :** Django utilise cette clé pour la signature des sessions, les jetons CSRF et les liens de réinitialisation de mot de passe. Si la clé est régénérée (par exemple en détruisant puis en redéployant le module), toutes les sessions utilisateur existantes sont invalidées et tous les liens de réinitialisation de mot de passe en attente deviennent invalides. Il s'agit d'un comportement de sécurité intentionnel.

---

## 7. Assemblage des variables d'environnement de Paperless-ngx {#7-paperless-ngx-environment-variable-assembly}

Paperless Common assemble les variables d'environnement suivantes et les injecte dans la table `config.environment_variables`, que le module de plateforme transmet au conteneur à l'exécution. Elles sont fusionnées avec les éventuelles `environment_variables` supplémentaires transmises par le module wrapper.

| Variable d'environnement | Source | Description |
|---|---|---|
| `PAPERLESS_PORT` | Codé en dur : `"8000"` | Port du serveur gunicorn |
| `PAPERLESS_DBENGINE` | Codé en dur : `"postgresql"` | Moteur de base de données |
| `PAPERLESS_DBPORT` | Codé en dur : `"5432"` | Port PostgreSQL |
| `PAPERLESS_MEDIA_ROOT` | Codé en dur : `"/usr/src/paperless/media"` | Point de montage GCS Fuse pour le stockage persistant des documents |
| `PAPERLESS_DATA_ROOT` | Codé en dur : `"/usr/src/paperless/data"` | Répertoire de métadonnées éphémère |
| `PAPERLESS_CONSUMPTION_DIR` | Codé en dur : `"/usr/src/paperless/consume"` | Dossier de dépôt pour l'ingestion automatique des documents |
| `PAPERLESS_URL` | `var.service_url` | URL publique du service. Définie sur l'URL prévue de Cloud Run ou de l'équilibreur de charge. |
| `PAPERLESS_ALLOWED_HOSTS` | Codé en dur : `"*"` | Hôtes autorisés par Django. `*` autorise tous les en-têtes Host. |
| `PAPERLESS_CORS_ALLOWED_HOSTS` | `var.service_url` (ou `"*"` si non défini) | Hôtes CORS autorisés par Django. |
| `PAPERLESS_TIME_ZONE` | `var.time_zone` | Fuseau horaire pour l'analyse des dates des documents et les tâches planifiées |
| `PAPERLESS_OCR_LANGUAGE` | `var.ocr_language` | Code(s) de langue Tesseract pour l'OCR |
| `PAPERLESS_WEBSERVER_WORKERS` | Codé en dur : `"2"` | Nombre de workers gunicorn |
| `USERMAP_UID` | Codé en dur : `"1000"` | UID de l'utilisateur du conteneur |
| `USERMAP_GID` | Codé en dur : `"1000"` | GID de l'utilisateur du conteneur |
| `PAPERLESS_ADMIN_USER` | `var.admin_user` | Nom d'utilisateur du superutilisateur créé automatiquement |
| `PAPERLESS_ADMIN_MAIL` | `var.admin_email` | Adresse e-mail du superutilisateur créé automatiquement |
| `PAPERLESS_TIKA_ENABLED` | Codé en dur : `"false"` | Conversion des documents bureautiques par Tika/Gotenberg. À activer via une surcharge dans `environment_variables` |
| `PAPERLESS_REDIS` | Assemblée à partir de `redis_host`/`redis_port` | URL Redis du courtier Celery. Format : `redis://:auth@host:port` ou `redis://host:port` |

**Assemblage de l'URL Redis :** la variable `PAPERLESS_REDIS` est assemblée au moment de l'apply :
- Si `redis_auth` n'est pas vide : `redis://:${redis_auth}@${redis_host}:${redis_port}`
- Sinon : `redis://${redis_host}:${redis_port}`
- Si `redis_host` est vide (ou null) : l'IP du serveur NFS est utilisée à la place — `nfs_server_ip` lorsqu'elle est fournie, sinon l'espace réservé d'exécution `$(NFS_SERVER_IP)` que App_CloudRun / App_GKE résolvent au moment du déploiement.
- Si `enable_redis = false` : `redis://localhost:6379` est utilisé.

---

## 8. Scripts et image de conteneur {#8-scripts-and-container-image}

Tous les fichiers de support se trouvent dans `scripts/`. Le répertoire `scripts/` sert de contexte de build Docker.

### `Dockerfile` {#dockerfile}
Wrapper léger autour de l'image publique `ghcr.io/paperless-ngx/paperless-ngx:<version>` :
- Passe à `USER root` et copie `entrypoint.sh` sous le nom `/platform-entrypoint.sh`.
- Expose le port `8000`.
- Définit `ENTRYPOINT ["/platform-entrypoint.sh"]`, en remplacement du point d'entrée amont.

### `entrypoint.sh` {#entrypointsh}
S'exécute avant le démarrage du processus Paperless-ngx amont :
- Fait correspondre les variables d'environnement `DB_HOST`/`DB_IP`/`DB_USER`/`DB_NAME`/`DB_PASSWORD` injectées par la plateforme aux variables natives de Paperless-ngx `PAPERLESS_DBHOST`/`PAPERLESS_DBUSER`/`PAPERLESS_DBNAME`/`PAPERLESS_DBPASS` (en privilégiant `DB_IP` plutôt qu'un `DB_HOST` de type chemin de socket, car Paperless-ngx a besoin d'un nom d'hôte ou d'une IP TCP, et non d'un socket Unix).
- Reconstruit `PAPERLESS_REDIS` à partir de `NFS_SERVER_IP` s'il contient encore un espace réservé `$(NFS_SERVER_IP)` non résolu (Cloud Run ne résout les références `$(VAR)` que dans l'ordre de déclaration).
- Exécute (`exec`) `/init` — le superviseur s6-overlay de l'image amont, qui démarre gunicorn (le processus web) ainsi que les processus Celery worker/beat. La variable d'environnement `PAPERLESS_WEBSERVER_WORKERS=2` contrôle le nombre de workers gunicorn ; le nombre de workers Celery est géré en interne par Paperless-ngx.

### `db-init.sh` {#db-initsh}
Script d'initialisation PostgreSQL exécuté par le Cloud Run Job ou le Job Kubernetes `db-init` lors du premier déploiement. Voir §5 pour le comportement détaillé.

---

## 9. Volume média GCS Fuse {#9-gcs-fuse-media-volume}

Le bucket GCS `paperless-media` constitue la couche de persistance principale de tout le contenu traité par Paperless-ngx. Contrairement à d'autres modules qui utilisent NFS pour les données applicatives, Paperless-ngx monte GCS directement via GCS Fuse sur `/usr/src/paperless/media`.

**Configuration du volume par défaut (lorsque `gcs_volumes = []`) :**

| Champ | Valeur |
|---|---|
| `name` | `"paperless-media"` |
| `bucket_name` | Bucket `gcs-paperless&lt;tenant-resource-prefix&gt;-media` provisionné automatiquement (le nom de bucket réellement créé par le socle — propre à l'application et préfixé par le tenant) |
| `mount_path` | `"/usr/src/paperless/media"` |
| `readonly` | `false` |
| `mount_options` | `["implicit-dirs", "stat-cache-ttl=60s", "type-cache-ttl=60s", "uid=1000", "gid=1000", "file-mode=0664", "dir-mode=0775"]` — les options uid/gid rendent le montage accessible en écriture à l'utilisateur non root de Paperless-ngx avec le pilote CSI GCS Fuse de GKE |

**Arborescence sous `/usr/src/paperless/media` :**

```
/usr/src/paperless/media/
├── documents/
│   ├── originals/       # Original uploaded files (PDF, images, office docs)
│   ├── archive/         # OCR-processed, searchable PDFs (if archiving enabled)
│   └── thumbnails/      # Preview thumbnails for the web UI
```

**`PAPERLESS_DATA_ROOT`** (`/usr/src/paperless/data`) est volontairement éphémère — il contient les fichiers de verrou, la base de données SQLite utilisée pour l'état des tâches (en plus de PostgreSQL) et les fichiers d'index. Ceux-ci sont recréés au démarrage et n'ont pas besoin de persister d'une révision Cloud Run à l'autre.

**`PAPERLESS_CONSUMPTION_DIR`** (`/usr/src/paperless/consume`) est le dossier de dépôt pour l'ingestion des documents. Les documents placés dans ce répertoire sont automatiquement pris en charge par la tâche de consommation Celery et déplacés vers `/usr/src/paperless/media/documents/originals` après traitement. Sur Cloud Run, ce répertoire est éphémère — pour une consommation automatisée, utilisez l'API REST de Paperless-ngx ou le téléversement via l'interface web plutôt que des dépôts dans le système de fichiers.

---

## 10. Différences selon la plateforme {#10-platform-specific-differences}

| Aspect | Paperless CloudRun | Paperless GKE |
|---|---|---|
| `min_instance_count` | `0` (valeur par défaut dans `variables.tf` ; configurable par l'utilisateur) | `1` (valeur par défaut dans `variables.tf` ; configurable par l'utilisateur) |
| `max_instance_count` | `3` (valeur par défaut dans `variables.tf` ; configurable par l'utilisateur) | `3` (valeur par défaut dans `variables.tf` ; configurable par l'utilisateur) |
| `GCS Fuse` | Monté via le volume GCS Fuse natif de Cloud Run | Monté via le pilote CSI GCS Fuse |
| `PAPERLESS_URL` | Définie sur l'URL prévue du service Cloud Run | Définie sur l'URL de l'équilibreur de charge ou du domaine personnalisé |
| `Redis` | Obligatoire ; utilise par défaut l'IP du serveur NFS lorsque `redis_host` est vide | Obligatoire ; utilise par défaut l'IP du serveur NFS lorsque `redis_host` est vide |
| Job `db-init` | Cloud Run Job | Job Kubernetes |
| `PAPERLESS_CONSUMPTION_DIR` | Éphémère (local à l'instance) | Éphémère sauf montage NFS |
| Affinité de session | Sans objet (Cloud Run sans état) | `ClientIP` par défaut — évite les problèmes de routage des sessions Django |

---

## 11. Modèle d'implémentation {#11-implementation-pattern}

```hcl
# Example: how Paperless_CloudRun instantiates Paperless_Common

module "paperless_app" {
  source = "../Paperless_Common"

  application_version    = var.application_version
  db_name                = var.db_name
  db_user                = var.db_user
  cpu_limit              = var.cpu_limit
  memory_limit           = var.memory_limit
  description            = var.description
  startup_probe          = var.startup_probe
  liveness_probe         = var.liveness_probe
  enable_cloudsql_volume = var.enable_cloudsql_volume
  time_zone              = var.time_zone
  ocr_language           = var.ocr_language
  admin_user             = var.admin_user
  admin_email            = var.admin_email
  enable_redis           = var.enable_redis
  redis_host             = var.redis_host
  redis_port             = var.redis_port
  redis_auth             = var.redis_auth
}

locals {
  application_modules    = { paperless = module.paperless_app.config }
  module_env_vars        = {}
  module_secret_env_vars = module.paperless_app.secret_ids
  module_storage_buckets = module.paperless_app.storage_buckets
  scripts_dir            = abspath("${module.paperless_app.path}/scripts")
}

module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config     = local.application_modules
  module_secret_env_vars = local.module_secret_env_vars
  module_storage_buckets = local.module_storage_buckets
  scripts_dir            = local.scripts_dir
  # ... other inputs
}
```

---

## 12. Exploration avec la console GCP {#12-exploring-with-the-gcp-console}

Après le déploiement, les zones suivantes de la console GCP sont les plus pertinentes pour les ressources gérées par `Paperless Common`.

**Secret Manager — Secrets applicatifs**
Accédez à **Security → Secret Manager**. Filtrez sur le préfixe du déploiement. Les deux secrets créés par `Paperless Common` sont :
- `secret-<resource-prefix>-paperless-admin-password` : cliquez sur **View secret value** pour la dernière version afin de récupérer le mot de passe administrateur initial pour la première connexion.
- `secret-<resource-prefix>-paperless-key` : la clé secrète Django. Il n'est pas nécessaire de la consulter en fonctionnement normal — elle est injectée automatiquement dans le conteneur.

Pour chaque secret, l'onglet **Versions** affiche toutes les versions historiques. `Paperless Common` crée une seule version lors du premier apply. Secret Manager conserve toutes les versions jusqu'à ce qu'elles soient explicitement désactivées ou détruites.

**Cloud Storage — Bucket média**
Accédez à **Cloud Storage → Buckets → gcs-paperless&lt;tenant-resource-prefix&gt;-media**. Ce bucket contient toutes les données documentaires persistantes de Paperless-ngx. Principaux répertoires à inspecter :
- `documents/originals/` — fichiers téléversés d'origine, organisés par année/mois/jour.
- `documents/thumbnails/` — aperçus en miniatures JPEG pour l'interface web.
- `documents/archive/` — PDF consultables traités par OCR (si le mode archive est activé dans les paramètres de Paperless-ngx).

L'onglet **Permissions** du bucket montre que le compte de service Cloud Run dispose de `roles/storage.objectAdmin` sur ce bucket, accordé par `App_CloudRun`.

**Cloud SQL — Vérification de la base de données**
Accédez à **SQL → Instances → &lt;instance-name&gt; → Databases**. La base de données `paperless` créée par `db-init` y est listée. Cliquez sur le nom de la base de données pour voir son jeu de caractères et sa collation (`UTF8` / `en_US.UTF-8` pour PostgreSQL 15).

---

## 13. Exploration avec gcloud {#13-exploring-with-gcloud}

```bash
# Retrieve the initial admin password for first login
gcloud secrets versions access latest \
  --secret="secret-RESOURCE_PREFIX-paperless-admin-password" \
  --project=PROJECT_ID

# List all Secret Manager secrets created by Paperless Common
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name:paperless" \
  --format="table(name,replication.automatic,createTime)"

# List versions of the admin password secret
gcloud secrets versions list secret-RESOURCE_PREFIX-paperless-admin-password \
  --project=PROJECT_ID \
  --format="table(name,state,createTime)"

# Inspect the media bucket contents (processed documents)
# SERVICE_NAME = paperless<tenant-resource-prefix>
gcloud storage ls --recursive gs://gcs-SERVICE_NAME-media/documents/

# Count objects in the media bucket (useful for monitoring growth)
gcloud storage ls --recursive gs://gcs-SERVICE_NAME-media/ | wc -l

# Check bucket size
gcloud storage du gs://gcs-SERVICE_NAME-media/ \
  --summarize \
  --readable-sizes

# Verify bucket IAM bindings (confirm Cloud Run SA has objectAdmin)
gcloud storage buckets get-iam-policy gs://gcs-SERVICE_NAME-media

# List all Cloud Run Jobs (db-init lives here)
gcloud run jobs list \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(name,metadata.creationTimestamp)"

# Check the db-init job execution history (job name = SERVICE_NAME-db-init)
gcloud run jobs executions list \
  --job=SERVICE_NAME-db-init \
  --project=PROJECT_ID \
  --region=REGION \
  --format="table(name,completionStatus,startTime,completionTime)"

# Re-run the db-init job (idempotent — safe to run again)
gcloud run jobs execute SERVICE_NAME-db-init \
  --project=PROJECT_ID \
  --region=REGION \
  --wait

# Stream db-init job logs
gcloud logging read \
  'resource.type="cloud_run_job" AND resource.labels.job_name="SERVICE_NAME-db-init"' \
  --project=PROJECT_ID \
  --freshness=1h \
  --format="table(timestamp,textPayload)" \
  --order=asc

# Verify PostgreSQL database was created (connect via Cloud SQL proxy)
# First: start the proxy locally
cloud_sql_proxy -instances=PROJECT_ID:REGION:SQL_INSTANCE_NAME=tcp:5432 &
psql -h 127.0.0.1 -U paperless -d paperless -c "\dt" # list tables

# Check Redis connectivity (if using Memorystore)
gcloud redis instances describe REDIS_INSTANCE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,authEnabled)"
```

<!-- related-guides -->

## Guides associés {#related-guides}

- [Paperless-ngx sur Google Cloud Run](Paperless_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Module Paperless-ngx GKE — Guide de configuration](Paperless_GKE.md) — cette configuration déployée sur GKE.
