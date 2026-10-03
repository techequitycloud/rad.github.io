---
title: "Module de configuration partagée Xibo Common"
description: "Référence de configuration partagée pour le module Xibo — paramètres de la couche application consommés par le déploiement GKE Autopilot."
---

<!-- translated-from: docs/modules/Xibo_Common.md @ 2829548 sha256:86a2f5ceacab -->

# Module de configuration partagée Xibo Common {#xibo-common-shared-configuration-module}

Le module `Xibo Common` définit la configuration du CMS d'affichage dynamique Xibo pour l'écosystème RAD Modules. C'est un **module de configuration pure** — il ne crée aucune ressource GCP et produit une sortie `config` consommée par le module wrapper de plateforme `Xibo GKE`.

## 1. Vue d'ensemble {#1-overview}

**Objectif** : Centraliser toute la configuration spécifique à Xibo — l'image de conteneur personnalisée construite à partir de la version officielle ghcr.io, les paramètres de la base de données MySQL 8.0, les corrections d'environnement nécessaires derrière une entrée de terminaison TLS et contre Cloud SQL, les sondes de santé, et le job `db-init` — dans un seul module.

**Architecture** :

```
Layer 3: Application Wrapper
└── Xibo_GKE  ── instantiates Xibo_Common
                           ↓
              Xibo_Common (this module)
              Creates: (no GCP resources)
              Produces: config, secret_ids, secret_values, storage_buckets, path
                           ↓
Layer 2: Platform Module
└── App_GKE       (Kubernetes deployment)
                           ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

Il n'y a pas de variante Cloud Run : la médiathèque de Xibo a besoin d'un système de fichiers POSIX (Apache le sert avec XSendFile), ce qui pointe vers un volume persistant sur GKE plutôt que vers un stockage d'objets.

**Caractéristiques clés** :
- **Image de ghcr.io, pas de Docker Hub.** `docker.io/xibosignage/xibo-cms` est abandonné — son tag le plus récent est `release23` (2023-05-07) et Xibo 4.x n'y a jamais été publié.
- **MySQL 8.0** (`database_type = "MYSQL_8_0"`), accessible via **TCP** à l'IP privée de l'instance.
- **Installation entièrement non interactive.** L'entrée de Xibo crée la base de données si elle est absente et exécute l'installation/mise à niveau de phinx à chaque démarrage. Il n'y a pas de job de schéma.
- **Pas de secrets d'application.** La seule information d'identification de Xibo est le compte de base de données, que la Foundation crée et injecte.
- **Les sondes sont fournies par le wrapper.** `Xibo_GKE` transmet ses sondes `/login` aux `startup_probe`/`liveness_probe` de ce module.

---

## 2. Sorties {#2-outputs}

### `config` {#config}
L'objet de configuration de l'application passé à `App_GKE` via `application_config`.

| Champ | Valeur / Description |
|---|---|
| `app_name` | `var.application_name` (par défaut `"xibo"`) |
| `application_version` | `var.application_version` (par défaut `"release-4.5.2"`) |
| `display_name` / `description` | `var.display_name` / `var.description` |
| `container_image` | `"ghcr.io/xibosignage/xibo-cms"` |
| `image_source` | `"custom"` |
| `enable_image_mirroring` | `var.enable_image_mirroring` (par défaut `true`) |
| `container_build_config` | `enabled = true`, `dockerfile_path = "Dockerfile"`, `context_path = scripts/`, `build_args = { XIBO_VERSION = var.application_version }` — un argument spécifique à l'application, donc le `APP_VERSION` générique de la Foundation ne peut pas le remplacer |
| `container_port` | `80` — Apache ; le point d'entrée ne lit jamais `$PORT` |
| `database_type` | `"MYSQL_8_0"` |
| `db_name` / `db_user` | `var.db_name` / `var.db_user` (par défaut `"xibo"` / `"xibo"`) |
| `enable_cloudsql_volume` | `false` (codé en dur — Xibo se connecte via TCP) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | `var.gcs_volumes`, normalisé |
| `container_resources` | `cpu_limit = var.cpu_limit` (`"1000m"`), `memory_limit = var.memory_limit` (`"2Gi"`), requiert `null` |
| `min_instance_count` / `max_instance_count` | `var.min_instance_count` (`1`) / `var.max_instance_count` (`3`) |
| `environment_variables` | Valeurs par défaut du module (voir §4) fusionnées avec `var.environment_variables` |
| `secret_environment_variables` | `var.secret_environment_variables` |
| `enable_mysql_plugins` / `mysql_plugins` | `false` / `[]` |
| `initialization_jobs` | Job `db-init` par défaut, ou `var.initialization_jobs` si non vide — voir §5 |
| `startup_probe` / `liveness_probe` | `var.startup_probe` / `var.liveness_probe` — voir §6 |

### `secret_ids` {#secret_ids}
`{}` — pas de secrets d'application.

### `secret_values` (sensible) {#secret_values-sensitive}
`{}`.

### `storage_buckets` {#storage_buckets}
Un seul bucket : `name_suffix = "storage"`, `STANDARD`, `force_destroy = true`, versioning désactivé, `public_access_prevention = "enforced"`. `Xibo_GKE` le transmet comme `module_storage_buckets`, il est donc créé en même temps que le bucket `data` par défaut du wrapper. Xibo ne le lit ni ne l'écrit.

### `path` {#path}
Le répertoire du module, utilisé par le wrapper pour localiser `scripts/`.

---

## 3. Variables d'entrée {#3-input-variables}

### Application {#application}

| Variable | Type | Défaut | Description |
|---|---|---|---|
| `application_name` | `string` | `"xibo"` | Nom de l'application. |
| `application_version` | `string` | `"release-4.5.2"` | Tag de l'image sur `ghcr.io/xibosignage/xibo-cms`. La valeur du wrapper l'emporte. Épinglez une version exacte. |
| `display_name` | `string` | `"Xibo CMS"` | Nom d'affichage. (`Xibo_GKE` passe son propre `application_display_name`, dont la valeur par défaut est `"Wiki.js"`.) |
| `description` | `string` | `"Xibo — open-source digital signage CMS: layouts, playlists, scheduling and media distribution to player devices."` | Description. |
| `db_name` | `string` | `"xibo"` | Nom de la base de données MySQL. |
| `db_user` | `string` | `"xibo"` | Utilisateur MySQL. |
| `cpu_limit` | `string` | `"1000m"` | Limite de CPU. |
| `memory_limit` | `string` | `"2Gi"` | Limite de mémoire. |
| `min_instance_count` | `number` | `1` | Réplicas minimum. |
| `max_instance_count` | `number` | `3` | Réplicas maximum. |
| `php_memory_limit` | `string` | `"512M"` | `CMS_PHP_MEMORY_LIMIT` et `CMS_PHP_CLI_MEMORY_LIMIT`. Non exposé par `Xibo_GKE` ; à remplacer via `environment_variables`. |
| `environment_variables` | `map(string)` | `{}` | Fusionné **sur** les valeurs par défaut du module. |
| `secret_environment_variables` | `map(string)` | `{}` | Références Secret Manager. |
| `enable_image_mirroring` | `bool` | `true` | Mettre en miroir l'image dans Artifact Registry. |
| `gcs_volumes` | `list(object)` | `[]` | Montages GCS Fuse. Ne convient pas à la bibliothèque. |
| `initialization_jobs` | `list(object)` | `[]` | Jobs personnalisés ; vide utilise `db-init`. |
| `startup_probe` / `liveness_probe` | `object` | voir §6 | Sondes de conteneur. |

### Déclarées mais inutilisées {#declared-but-unused}

`project_id`, `resource_prefix`, `labels`, `deployment_id_suffix`, `service_url`, `admin_username`, `admin_email`, `tenant_id` (validées, mais non utilisées autrement), `region`, `enable_cloudsql_volume` (la configuration code en dur `false`) et `enable_gcs_storage_volume` sont déclarées pour la cohérence de l'interface mais ne sont pas lues par `main.tf`. `admin_username` ne crée ni ne renomme de compte : l'image initialise un utilisateur `xibo_admin` fixe lors de la première installation.

---

## 4. Variables d'environnement {#4-environment-variables}

### Définies dans `config.environment_variables` {#set-in-configenvironment_variables}

| Variable | Valeur | Objectif |
|---|---|---|
| `MYSQL_PORT` | `"3306"` | Port de la base de données. |
| `MYSQL_ATTR_SSL_VERIFY_SERVER_CERT` | `"false"` | L'image livre `true` avec `MYSQL_ATTR_SSL_CA=none` — vérification exigée sans CA à vérifier — donc PDO refuse la connexion telle que livrée. Cloud SQL sur l'IP privée ne présente aucun certificat que le conteneur puisse vérifier ; la plage privée du VPC est la limite protégeant ce trafic. |
| `CMS_PHP_COOKIE_SECURE` | `"On"` | L'image livre `Off`. L'entrée termine TLS et le conteneur ne voit que HTTP, il ne le définirait donc jamais lui-même. |
| `CMS_PHP_MEMORY_LIMIT` | `var.php_memory_limit` (`"512M"`) | La limite de téléchargement de 2 Go livrée, associée à une limite de mémoire PHP de 256 Mo, échoue lors d'importations de grandes mises en page. |
| `CMS_PHP_CLI_MEMORY_LIMIT` | `var.php_memory_limit` | Idem, pour PHP CLI. |

### Définies par `scripts/entrypoint.sh` au démarrage {#set-by-scriptsentrypointsh-at-start-up}

| Variable | Valeur |
|---|---|
| `MYSQL_HOST` | `$DB_IP` — l'IP privée. `DB_HOST` peut être un répertoire de socket, que Xibo ne peut pas utiliser. |
| `MYSQL_PORT` | `${DB_PORT:-3306}` |
| `MYSQL_DATABASE` / `MYSQL_USER` / `MYSQL_PASSWORD` | `$DB_NAME` / `$DB_USER` / `$DB_PASSWORD` |
| `CMS_SERVER_NAME` | Uniquement si non défini ou `localhost` : l'hôte du premier de `CLOUDRUN_SERVICE_URL`, `GKE_SERVICE_URL`, `SERVICE_URL` qui est défini, avec `http://`/`https://` supprimé. |

Le point d'entrée se termine immédiatement si `DB_IP`, `DB_NAME`, `DB_USER` ou `DB_PASSWORD` n'est pas défini, affiche une ligne `[startup]` avec le point d'accès de la base de données, `server_name` et `XMR_HOST`, puis `exec` le `/entrypoint.sh` du fournisseur. Il note que sans le compagnon XMR de Xibo (non déployé par ce module), les lecteurs **interrogent** plutôt que de recevoir des mises à jour poussées.

---

## 5. Job d'initialisation {#5-initialization-job}

Un job `db-init` s'exécute par défaut (lorsque `initialization_jobs = []`) :

| Champ | Valeur |
|---|---|
| Image | `mysql:8.0-debian` |
| Script | `scripts/db-init.sh` |
| Secrets requis | `DB_PASSWORD`, `ROOT_PASSWORD` (tous deux injectés par la Foundation ; également lus depuis `/mnt/secrets-store/` lorsque le montage CSI est présent) |
| `execute_on_apply` | `true` |
| CPU / Mémoire | `1000m` / `512Mi` |
| Délai d'expiration / tentatives | 600s / 3 |

Comportement de `db-init.sh` :
1. Utilise un socket Unix Cloud SQL si un apparaît sous `/cloudsql` dans les 30 secondes ; sinon se connecte via TCP à `DB_IP` (ou un `DB_HOST` sans socket), en attendant le port 3306.
2. Ajoute `--get-server-public-key` sur TCP pour que le `caching_sha2_password` par défaut de Cloud SQL MySQL 8 fonctionne.
3. Crée l'utilisateur de l'application s'il est absent et (ré)initialise son mot de passe à `DB_PASSWORD`.
4. Crée la base de données si elle est absente et accorde à l'utilisateur tous les privilèges sur celle-ci.
5. Vérifie que l'utilisateur de l'application peut se connecter (ce qui amorce également le cache `caching_sha2_password`).
6. Demande à tout sidecar Cloud SQL Proxy de se terminer (`/quitquitquit`, puis `SIGKILL`) afin que le Job se termine.

Xibo installe ensuite son schéma lui-même au premier démarrage. La substitution de `initialization_jobs` par une liste non vide remplace ce job ; les jobs personnalisés ont un délai d'expiration par défaut de 1200s.

---

## 6. Sondes de santé {#6-health-probes}

| Sonde | Valeur par défaut `Xibo_Common` | Tel que déployé par `Xibo_GKE` (valeur par défaut du wrapper) |
|---|---|---|
| Démarrage | HTTP `/`, délai 30s, timeout 10s, période 15s, 20 échecs | HTTP `/login`, délai 60s, timeout 5s, période 10s, 3 échecs |
| Vivacité | HTTP `/`, délai 60s, timeout 10s, période 30s, 3 échecs | HTTP `/login`, délai 60s, timeout 5s, période 30s, 3 échecs |

Xibo ne fournit pas de point de terminaison de santé. `/` répond avec un 302 vers `/login` ; `/login` renvoie 200 et prouve que le CMS a été rendu. Le `/healthz` générique de la Foundation renvoie 404 et ne doit pas être utilisé.

---

## 7. Scripts et image de conteneur {#7-scripts-and-container-image}

Tous les fichiers de support se trouvent dans `scripts/`, qui est le contexte de build Docker.

### `Dockerfile` {#dockerfile}
- `ARG XIBO_VERSION=release-4.5.2`, `FROM ghcr.io/xibosignage/xibo-cms:${XIBO_VERSION}`.
- Copie `entrypoint.sh` vers `/cloud-entrypoint.sh` et en fait le `ENTRYPOINT`. L'image du fournisseur n'a pas de `ENTRYPOINT` (son `CMD` est `/entrypoint.sh`), donc le wrapper s'exécute en premier puis `exec` le script du fournisseur.
- Une reconstruction sous un tag inchangé ne produit pas de diff Terraform et donc pas de déploiement — épinglez des versions exactes.

### `entrypoint.sh` {#entrypointsh}
Mappe les variables `DB_*` de la Foundation sur les noms `MYSQL_*` de Xibo et dérive `CMS_SERVER_NAME` (voir §4).

### `db-init.sh` {#db-initsh}
Crée l'utilisateur et la base de données MySQL (voir §5).

---

## 8. La médiathèque {#8-the-media-library}

`/var/www/cms/library` est le répertoire qui compte : le point d'entrée de Xibo le stocke comme paramètre `LIBRARY_LOCATION`, et il contient tous les médias téléchargés ainsi que `certs/` (les clés de signature OAuth du lecteur), `brand/`, `playersoftware/` et `temp/`. Apache le sert via XSendFile, qui nécessite une sémantique POSIX réelle, donc un PVC StatefulSet est le support prévu plutôt que GCS Fuse.

`Xibo_Common` lui-même ne déclare aucun volume pour ce chemin ; le PVC provient des variables `stateful_pvc_*` du wrapper, et avec les valeurs par défaut de `Xibo_GKE` (`stateful_pvc_enabled = null`, `stateful_pvc_mount_path = "/data"`) rien n'est monté là. Voir le [guide Xibo GKE](Xibo_GKE.md#group-7-stateful-workloads) pour les paramètres qui le persistent.

---

## 9. Modèle d'implémentation {#9-implementation-pattern}

`Xibo_GKE` instancie `Xibo_Common` comme suit (abrégé) :

```hcl
module "xibo_app" {
  source = "../Xibo_Common"

  application_name             = var.application_name
  application_version          = var.application_version
  display_name                 = var.application_display_name
  db_name                      = var.application_database_name
  db_user                      = var.application_database_user
  environment_variables        = var.environment_variables
  cpu_limit                    = var.container_resources.cpu_limit
  memory_limit                 = var.container_resources.memory_limit
  min_instance_count           = var.min_instance_count
  max_instance_count           = var.max_instance_count
  gcs_volumes                  = var.gcs_volumes
  initialization_jobs          = var.initialization_jobs
  startup_probe                = var.startup_probe_config
  liveness_probe               = var.health_check_config
  secret_environment_variables = var.secret_environment_variables
  # ... other inputs
}

module "app_gke" {
  source = "../App_GKE"

  application_config     = { xibo = local.xibo_module }
  module_secret_env_vars = {}
  module_storage_buckets = module.xibo_app.storage_buckets
  scripts_dir            = abspath("${module.xibo_app.path}/scripts")
  # ... other inputs
}
```

<!-- related-guides -->

## Guides associés {#related-guides}

- [Module Xibo GKE — Guide de configuration](Xibo_GKE.md) — cette configuration déployée sur GKE.
- [Lab pratique : Xibo sur GKE Autopilot](../labs/Xibo_GKE.md) — déployez et utilisez-le étape par étape.
