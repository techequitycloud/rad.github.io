---
title: "Module de configuration partagée Mattermost Common"
description: "Référence de configuration partagée pour le module Mattermost — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Mattermost_Common.md @ 15fd4c7 sha256:b475dea99c3a -->

# Module de configuration partagée Mattermost Common {#mattermost-common-shared-configuration-module}

Le module `Mattermost Common` définit la configuration de la plateforme de messagerie d'équipe Mattermost pour l'écosystème des modules RAD. C'est un **module de configuration pure** — il ne crée aucune ressource GCP et produit une sortie `config` consommée par les modules wrapper spécifiques à la plateforme (`Mattermost CloudRun` et `Mattermost GKE`).

## 1. Vue d'ensemble {#1-overview}

**Objectif** : Centraliser toute la configuration spécifique à Mattermost (image de conteneur personnalisée, configuration de la base de données PostgreSQL 15, mappage des variables d'environnement, sondes de santé et job d'initialisation) dans un seul module partagé par les déploiements Cloud Run et GKE.

**Architecture** :

```
Layer 3: Application Wrappers
├── Mattermost_CloudRun  ──┐
└── Mattermost_GKE       ──┤── instantiate Mattermost_Common
                           ↓
              Mattermost_Common (this module)
              Creates: (no GCP resources)
              Produces: config, secret_ids, storage_buckets, path
                           ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                           ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Caractéristiques clés** :
- Utilise **PostgreSQL 15** — Mattermost nécessite PostgreSQL 13 ou ultérieur et ne prend pas en charge MySQL.
- Ne crée **aucune ressource GCP** — pas de secrets, pas de liaisons IAM. Mattermost génère ses propres clés de signature internes, secrets de session et clés de chiffrement lors du premier démarrage et les persiste dans la base de données PostgreSQL.
- Expose un **point de terminaison de santé dédié** à `/api/v4/system/ping` — utilisé par les sondes de démarrage et de vivacité pour une signalisation de santé précise. Ceci est distinct de la plupart des autres modules qui sondent le chemin racine de l'application (`/`).
- **L'image de base est par défaut `mattermost/mattermost-team-edition`** — `Mattermost_Common` lui-même n'a pas de variable `edition`. La sélection de l'édition est implémentée par les modules wrapper (`Mattermost_CloudRun`, `Mattermost_GKE`) : lorsque `edition = "enterprise"`, ils remplacent l'argument de build `MM_IMAGE` du Dockerfile par `mattermost/mattermost-enterprise-edition`, ce qui est réellement utilisé par le build personnalisé.
- **Configuration compatible Redis** : lorsque `enable_redis = true`, injecte automatiquement les variables d'environnement `MM_CACHEBACKEND=redis`, `MM_REDIS_ADDRESS` et `MM_REDIS_PASSWORD`.

---

## 2. Sorties {#2-outputs}

### `config` {#config}
L'objet de configuration de l'application transmis au module de plateforme via `application_config`.

| Champ | Valeur / Description |
|---|---|
| `app_name` | `"mattermost"` |
| `application_version` | Tag de version (par défaut : `"9.11.2"`) |
| `container_image` | `"mattermost/mattermost-team-edition"` (codé en dur ; les modules wrapper le remplacent par l'image Enterprise lorsque `edition = "enterprise"`) |
| `image_source` | `"custom"` — une image wrapper personnalisée est construite à partir du Dockerfile du module Common |
| `enable_image_mirroring` | `var.enable_image_mirroring` (par défaut `true`) — met en miroir l'image Mattermost Docker Hub vers Artifact Registry avant le déploiement |
| `container_build_config` | `dockerfile_path = "Dockerfile"`, `context_path = "."`, `build_args = { MM_VERSION = <version, "latest" mapped to "9.11.2"> }` (un nom d'argument spécifique à l'application pour que l'injection générique `APP_VERSION` de la Foundation ne puisse pas le remplacer) |
| `container_port` | `8065` |
| `database_type` | `"POSTGRES_15"` |
| `db_name` | Nom de la base de données (par défaut : `"mattermost"`) |
| `db_user` | Utilisateur de la base de données (par défaut : `"mattermost"`) |
| `enable_cloudsql_volume` | Monter le sidecar Cloud SQL Auth Proxy (par défaut : `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | Liste des montages de volume GCS Fuse transmis depuis `var.gcs_volumes` |
| `container_resources` | CPU : `2000m`, Mémoire : `2Gi` (par défaut ; des valeurs plus élevées sont recommandées pour les équipes actives) |
| `environment_variables` | Variables d'environnement Mattermost Core (voir §4) fusionnées avec `var.environment_variables` |
| `secret_environment_variables` | `var.secret_environment_variables` — variables d'environnement secrètes passées au conteneur ; gérées en externe par défaut |
| `initialization_jobs` | Job `db-init` par défaut ou remplacement personnalisé — voir §5 |
| `startup_probe` | HTTP `GET /api/v4/system/ping`, délai initial de 30s, timeout de 10s, période de 10s, seuil d'échec de 30 |
| `liveness_probe` | HTTP `GET /api/v4/system/ping`, délai initial de 30s, timeout de 5s, période de 30s, seuil d'échec de 3 |

### `secret_ids` {#secret_ids}
Une carte vide (`{}`). Mattermost Common ne génère pas automatiquement de secrets d'application. Mattermost génère ses propres clés internes lors du premier démarrage et les stocke dans PostgreSQL. Le `module_secret_env_vars` des modules wrapper est défini sur cette carte vide.

### `storage_buckets` {#storage_buckets}
Une liste à un seul élément déclarant un bucket `data` (`name_suffix = "data"`, classe `STANDARD`, `force_destroy = true`, versioning désactivé, `public_access_prevention = "enforced"`). Les modules wrapper transmettent cette sortie telle quelle en tant que `module_storage_buckets`, de sorte que le bucket est réellement provisionné — malgré cela, le chemin de stockage de fichiers principal du module est `gcs_volumes` (monté à `/mattermost/data`), et non ce bucket.

### `path` {#path}
Le chemin absolu vers le répertoire du module, utilisé par les modules wrapper pour localiser le répertoire `scripts/`.

---

## 3. Variables d'entrée {#3-input-variables}

### Application {#application}

| Variable | Type | Défaut | Description |
|---|---|---|---|
| `application_name` | `string` | `"mattermost"` | Nom de l'application — utilisé comme nom de base pour les ressources. |
| `application_version` | `string` | `"9.11.2"` | Tag de l'image Docker Mattermost. Incrémenter pour déployer une nouvelle version. |
| `description` | `string` | `"Initialize Mattermost database schema"` | Description utilisée dans le job `db-init` par défaut. |
| `db_name` | `string` | `"mattermost"` | Nom de la base de données PostgreSQL. |
| `db_user` | `string` | `"mattermost"` | Utilisateur de l'application PostgreSQL. |
| `cpu_limit` | `string` | `"2000m"` | Limite de CPU pour le conteneur Mattermost. |
| `memory_limit` | `string` | `"2Gi"` | Limite de mémoire pour le conteneur Mattermost. |
| `environment_variables` | `map(string)` | `{}` | Variables d'environnement supplémentaires fusionnées dans la configuration Mattermost Core. |
| `initialization_jobs` | `list(object)` | `[]` | Jobs d'initialisation personnalisés. Une liste vide déclenche le job `db-init` par défaut. |
| `startup_probe` | `object` | voir §6 | Configuration de la sonde de santé de démarrage. |
| `liveness_probe` | `object` | voir §6 | Configuration de la sonde de vivacité. |
| `enable_image_mirroring` | `bool` | `true` | Mettre en miroir l'image du conteneur vers Artifact Registry avant le déploiement. |
| `min_instance_count` | `number` | `1` | Nombre minimum d'instances en cours d'exécution. La valeur par défaut `1` empêche la mise à l'échelle à zéro dans Cloud Run. |
| `max_instance_count` | `number` | `3` | Nombre maximum d'instances en cours d'exécution. |
| `region` | `string` | `"us-central1"` | Région GCP pour le déploiement des ressources. |
| `site_url` | `string` | `""` | L'URL publique où Mattermost est accessible. Définit `MM_SERVICESETTINGS_SITEURL`. |

> `edition` n'est **pas** une variable `Mattermost_Common` — elle est déclarée sur les modules wrapper (`Mattermost_CloudRun`, `Mattermost_GKE`) et utilisée là pour sélectionner l'image du conteneur. Voir §9.

### Stockage et Volumes {#storage--volumes}

| Variable | Type | Défaut | Description |
|---|---|---|---|
| `enable_cloudsql_volume` | `bool` | `true` | Monter le socket du sidecar Cloud SQL Auth Proxy. |
| `gcs_volumes` | `list(object)` | `[]` | Montages de volume GCS Fuse. Chaque entrée : `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. Monter à `/mattermost/data` pour les téléchargements de fichiers persistants. |

### Intégration Redis {#redis-integration}

| Variable | Type | Défaut | Description |
|---|---|---|---|
| `enable_redis` | `bool` | `false` | Activer Redis pour la mise en cache et le stockage de session de Mattermost. Lorsque `true`, injecte automatiquement les variables d'environnement spécifiques à Redis. |
| `redis_host` | `string` | `""` | Nom d'hôte ou adresse IP de Redis. Requis lorsque `enable_redis = true`. |
| `redis_port` | `string` | `"6379"` | Port TCP du serveur Redis. |
| `redis_auth` | `string` | `""` | Mot de passe d'authentification Redis. Marqué `sensitive` dans Terraform, mais injecté comme variable d'environnement **simple** `MM_REDIS_PASSWORD` (pas une référence Secret Manager) lorsqu'il n'est pas vide — `secret_environment_variables` est toujours `{}` de ce module. |

---

## 4. Variables d'environnement {#4-environment-variables}

Mattermost Common injecte un ensemble de variables d'environnement de base dans chaque déploiement. Toute la configuration de Mattermost utilise le préfixe `MM_` avec la notation de chemin à double underscore pour les paramètres imbriqués.

### Paramètres du service principal {#core-service-settings}

| Variable | Valeur / Source | Objectif |
|---|---|---|
| `MM_SERVICESETTINGS_LISTENADDRESS` | `:8065` | Lie le serveur HTTP de Mattermost à toutes les interfaces sur le port 8065. |
| `MM_METRICSSETTINGS_LISTENADDRESS` | `:8067` | Point de terminaison des métriques au format Prometheus. Intégrer avec Cloud Monitoring via l'écriture à distance. |
| `MM_SERVICESETTINGS_SITEURL` | `var.site_url` (lorsqu'il n'est pas vide) ; sinon, le point d'entrée le dérive au démarrage de l'URL du service injectée par la plateforme (`CLOUDRUN_SERVICE_URL`, sinon `GKE_SERVICE_URL`) | L'URL publique pour la génération de liens dans les e-mails, les permaliens, les invitations et les rappels OAuth. |
| `MM_SERVICESETTINGS_TRUSTEDPROXYIPHEADER` | `X-Forwarded-For` | Indique à Mattermost de faire confiance à l'en-tête `X-Forwarded-For` de la couche proxy de Cloud Run et du répartiteur de charge pour une extraction correcte de l'adresse IP du client. |

### Stockage de fichiers {#file-storage}

| Variable | Valeur | Objectif |
|---|---|---|
| `MM_FILESETTINGS_DRIVERTYPE` | `local` | Indique à Mattermost d'utiliser le stockage de fichiers local. Lorsqu'un volume GCS FUSE est monté à `/mattermost/data`, cela se résout de manière transparente en un stockage d'objets durable. |
| `MM_FILESETTINGS_DIRECTORY` | `/mattermost/data/` | Chemin de stockage des fichiers — doit correspondre au point de montage GCS FUSE ou NFS. |

### Journalisation {#logging}

| Variable | Valeur | Objectif |
|---|---|---|
| `MM_LOGSETTINGS_CONSOLELEVEL` | `INFO` | Niveau de journalisation écrit sur stdout. Cloud Run et GKE capturent automatiquement stdout vers Cloud Logging. |
| `MM_LOGSETTINGS_ENABLEFILE` | `false` | Désactive la journalisation basée sur les fichiers. Les journaux de fichiers ne sont pas appropriés pour les déploiements conteneurisés — toutes les sorties de journalisation vont vers stdout et sont capturées par Cloud Logging. |

### Traitement par lots des e-mails {#email-batching}

| Variable | Valeur | Objectif |
|---|---|---|
| `MM_EMAILSETTINGS_ENABLEEMAILBATCHING` | `false` | Désactivé pour la compatibilité Cloud Run. Le traitement par lots des e-mails nécessite une file d'attente en mémoire qui ne survit pas aux redémarrages de conteneurs ou aux événements de mise à l'échelle à zéro. |

### Cache Redis (injecté lorsque `enable_redis = true`) {#redis-cache-injected-when-enable_redis--true}

| Variable | Valeur / Source | Objectif |
|---|---|---|
| `MM_CACHEBACKEND` | `redis` | Bascule le backend de cache de Mattermost de la mémoire interne vers l'instance Redis externe. |
| `MM_REDIS_ADDRESS` | `<redis_host>:<redis_port>` | Chaîne de connexion pour le serveur Redis. |
| `MM_REDIS_PASSWORD` | `var.redis_auth` (lorsqu'il n'est pas vide) | Mot de passe d'authentification Redis, injecté comme variable d'environnement secrète lorsqu'il est défini. |

Lorsque `enable_redis = false`, `MM_CACHEBACKEND` est défini sur `memory` et aucune variable de connexion Redis n'est injectée.

---

## 5. Job d'initialisation {#5-initialization-job}

Un job `db-init` s'exécute par défaut (lorsque `initialization_jobs = []`) :

| Champ | Valeur |
|---|---|
| Image | `postgres:15-alpine` |
| Script | `scripts/db-init.sh` |
| Secrets requis | `DB_PASSWORD` (mot de passe de l'utilisateur de l'application), `ROOT_PASSWORD` (superutilisateur PostgreSQL, facultatif) |
| `execute_on_apply` | `true` |
| CPU / Mémoire | `1000m` / `512Mi` |
| Timeout | 600s, 1 réessai |

Comportement de `db-init.sh` :
1. Se connecte à Cloud SQL PostgreSQL via le socket Unix du proxy d'authentification ou TCP.
2. Crée l'utilisateur `mattermost` avec le mot de passe de Secret Manager s'il n'existe pas.
3. Crée la base de données `mattermost` si elle n'existe pas.
4. Accorde à l'utilisateur `mattermost` tous les privilèges sur la base de données.
5. Vérifie la connectivité en exécutant une simple requête `SELECT 1` en tant qu'utilisateur de l'application.

Mattermost exécute ensuite ses propres migrations de schéma au démarrage — le job `db-init` ne fait que créer la base de données et l'utilisateur vides ; il n'initialise pas le schéma Mattermost. C'est intentionnel : le système de migration intégré de Mattermost gère automatiquement la configuration du schéma et les mises à niveau de version.

Remplacez `initialization_jobs` par une liste non vide pour remplacer entièrement ce job par défaut.

---

## 6. Sondes de santé {#6-health-probes}

`Mattermost_Common` déclare les variables `startup_probe`/`liveness_probe` qui ciblent par défaut le point de terminaison `/api/v4/system/ping`. Ce point de terminaison fait partie de l'API REST de Mattermost et renvoie `HTTP 200` lorsque le serveur est entièrement initialisé, connecté à la base de données et prêt à servir les requêtes.

C'est un signal de santé plus précis que de sonder le chemin racine (`/`) : le point de terminaison ping valide que Mattermost s'est connecté avec succès à PostgreSQL et a terminé toutes les migrations de schéma en attente.

| Sonde | Chemin | Délai initial | Timeout | Période | Seuil d'échec | Objectif |
|---|---|---|---|---|---|---|
| **Démarrage** | `/api/v4/system/ping` | 30s | 10s | 10s | 30 | Permet jusqu'à 330 secondes au total à Mattermost pour terminer la migration de la base de données et s'initialiser. Un seuil généreux permet la création du schéma lors de la première exécution sur une nouvelle base de données. |
| **Vivacité** | `/api/v4/system/ping` | 30s | 5s | 30s | 3 | Redémarre le conteneur si Mattermost ne répond plus ou perd sa connexion à la base de données. |

**Ce tableau est la valeur par défaut de la variable propre à `Mattermost_Common`, et non ce que chaque plateforme déploie réellement.** `Mattermost_GKE` transmet `startup_probe`/`liveness_probe` inchangés, donc GKE utilise bien ces chemins et ces valeurs par défaut. `Mattermost_CloudRun`, cependant, déclare ses **propres** variables `startup_probe`/`liveness_probe` qui par défaut sont `path = "/"` — cette valeur par défaut remplace silencieusement la valeur par défaut de `Mattermost_Common` lorsqu'elle est transmise dans `mattermost.tf`, de sorte que **les sondes réelles déployées par Cloud Run sont par défaut sur le chemin racine, et non `/api/v4/system/ping`**, à moins que l'opérateur ne les remplace explicitement (voir `docs/modules/Mattermost_CloudRun.md` §C).

`Mattermost_CloudRun` et `Mattermost_GKE` déclarent également chacun des variables `startup_probe_config`/`health_check_config` distinctes. Ce ne sont **pas** une autre façon de configurer les mêmes sondes et ne sont **pas** par défaut sur les mêmes chemins que le tableau ci-dessus — elles sont mortes pour Mattermost sur les deux plateformes, câblées uniquement dans le préréglage de secours interne et inutilisé de chaque module Foundation (`App_CloudRun`'s `cloudrunapp` / `App_GKE`'s `gkeapp`). Les remplacer n'a aucun effet sur le service/pod déployé ; utilisez `startup_probe`/`liveness_probe` à la place.

Séparément, la sortie `config` de ce module définit également une troisième clé, `readiness_probe` (codée en dur à `path = "/api/v4/system/ping"` dans `main.tf`), qui est également morte — ni `App_CloudRun` ni `App_GKE` ne lit un champ `readiness_probe` de la configuration de l'application, donc cela n'a aucun effet d'exécution sur aucune des plateformes.

---

## 7. Scripts et image de conteneur {#7-scripts-and-container-image}

Tous les fichiers de support se trouvent dans `scripts/`. Le répertoire `scripts/` est utilisé comme contexte de build Docker.

### `Dockerfile` {#dockerfile}
Enveloppe l'image officielle Mattermost, `FROM ${MM_IMAGE}:${MM_VERSION}` :
- Deux arguments de build : `MM_IMAGE` (par défaut `mattermost/mattermost-team-edition` ; les wrappers définissent `mattermost/mattermost-enterprise-edition` lorsque `edition = "enterprise"`) et `MM_VERSION` (par défaut `9.11.2`).
- Passe à `root` uniquement pour installer le wrapper de point d'entrée, puis revient à l'uid `mattermost` (`2000`) intégré à l'image.
- Copie `entrypoint.sh` vers `/usr/local/bin/mm-entrypoint.sh` et l'utilise comme `ENTRYPOINT` — ce wrapper mappe les variables `DB_*` de la Foundation en `MM_SQLSETTINGS_DATASOURCE` avant de démarrer le serveur ; tous les autres paramètres `MM_*` sont injectés directement comme variables d'environnement.
- Expose le port `8065` (HTTP).

### `db-init.sh` {#db-initsh}
Crée la base de données et l'utilisateur PostgreSQL avant le premier démarrage de Mattermost :
1. Résout la connexion PostgreSQL à partir de `DB_HOST` (chemin de socket Unix pour Auth Proxy, ou nom d'hôte TCP).
2. Se connecte en utilisant `ROOT_PASSWORD` ou revient à l'authentification par pair si le mot de passe root n'est pas disponible.
3. Crée l'utilisateur de l'application avec `DB_PASSWORD` de Secret Manager.
4. Crée la base de données `mattermost` appartenant à l'utilisateur de l'application.
5. Vérifie la connectivité en tant qu'utilisateur de l'application.
6. Signale au proxy Cloud SQL de s'arrêter proprement.

---

## 8. Différences spécifiques à la plateforme {#8-platform-specific-differences}

| Aspect | Mattermost CloudRun | Mattermost GKE |
|---|---|---|
| **`min_instance_count` par défaut** | `1` — empêche la mise à l'échelle à zéro de déconnecter les sessions WebSocket. | `1` — toujours au moins un pod en cours d'exécution. |
| **`max_instance_count` par défaut** | `5` | `5` |
| **Chemin de la sonde de santé** | `/` (par défaut du module Cloud Run) ; remplacer par `/api/v4/system/ping` pour une signalisation précise. | `/api/v4/system/ping` — le module GKE utilise par défaut le point de terminaison de santé Mattermost précis. |
| **Connectivité Cloud SQL** | Socket Unix Auth Proxy via `enable_cloudsql_volume = true` (par défaut). | `enable_cloudsql_volume = true` par défaut dans GKE aussi — mais cela injecte un sidecar `cloud-sql-proxy` écoutant sur TCP `127.0.0.1`, et non un socket Unix ; `entrypoint.sh` se connecte via cette adresse TCP de bouclage. |
| **Stockage de fichiers** | Volumes GCS FUSE (`gcs_volumes`) ou NFS. GCS FUSE est préféré pour Cloud Run. | Volumes GCS FUSE via pilote CSI (`gcs_volumes`) ou NFS. GCS FUSE ou PVC StatefulSet pour GKE. |
| **Timeout WebSocket** | Le timeout de requête max de 60 min de Cloud Run limite la durée de vie de WebSocket. Définir `timeout_seconds = 3600`. | Aucune contrainte de timeout — les connexions GKE persistent indéfiniment. Meilleur choix pour la production. |
| **Affinité de session** | Non applicable à Cloud Run (serverless). | `session_affinity = "ClientIP"` par défaut — requis pour des sessions d'administration Mattermost cohérentes entre les réplicas de pod. |
| **`site_url`** | Facultatif — laissé vide, il est dérivé au démarrage de l'URL du service Cloud Run. Définissez-le lorsque vous servez Mattermost sur un domaine personnalisé. | Facultatif — laissé vide, il est dérivé au démarrage de l'URL du répartiteur de charge. Définissez-le lorsque vous servez Mattermost sur un domaine personnalisé. |

---

## 9. Sélection de l'édition {#9-edition-selection}

La variable `edition` est déclarée sur les **modules wrapper** (`Mattermost_CloudRun`, `Mattermost_GKE`), et non sur `Mattermost_Common` — voir §3. Lorsque `edition = "enterprise"`, le wrapper remplace l'argument de build `MM_IMAGE` du build personnalisé par `mattermost/mattermost-enterprise-edition`, de sorte que le Dockerfile construit `FROM` l'image Enterprise (voir §7). `BuildEnterpriseReady` dans `/api/v4/config/client` confirme quelle édition est en cours d'exécution.

| `edition` | Image | Notes |
|---|---|---|
| `"team"` (par défaut) | `mattermost/mattermost-team-edition:<version>` | Gratuit. Prend en charge un nombre illimité d'utilisateurs avec messagerie standard, canaux, intégrations et webhooks. |
| `"enterprise"` | `mattermost/mattermost-enterprise-edition:<version>` | Nécessite une clé de licence payante. Débloque la synchronisation LDAP/AD, le SAML SSO, les contrôles de conformité avancés, la rétention personnalisée, le clustering HA multi-régions et les fonctionnalités de sécurité d'entreprise. |

Pour activer les fonctionnalités Enterprise, définissez `edition = "enterprise"` et fournissez la clé de licence via `environment_variables` :

```hcl
edition = "enterprise"

environment_variables = {
  MM_LicenseKey = "your-enterprise-licence-key"
}
```

Ou utilisez `secret_environment_variables` pour éviter de stocker la clé de licence en texte clair :

```hcl
secret_environment_variables = {
  MM_LicenseKey = "mattermost-licence-key"
}
```

---

## 10. Modèle d'implémentation {#10-implementation-pattern}

L'exemple suivant illustre comment `Mattermost_CloudRun` instancie `Mattermost_Common` :

```hcl
module "mattermost_app" {
  source = "../Mattermost_Common"

  application_version    = var.application_version
  db_name                = var.db_name
  db_user                = var.db_user
  cpu_limit              = var.cpu_limit
  memory_limit           = var.memory_limit
  description            = var.description
  startup_probe          = var.startup_probe
  liveness_probe         = var.liveness_probe
  enable_cloudsql_volume = var.enable_cloudsql_volume
  gcs_volumes            = var.gcs_volumes
  site_url               = var.site_url
  enable_redis           = var.enable_redis
  redis_host             = var.redis_host
  redis_port             = var.redis_port
  redis_auth             = var.redis_auth
  environment_variables  = var.environment_variables
  initialization_jobs    = var.initialization_jobs
}

locals {
  mattermost_module = merge(
    module.mattermost_app.config,
    # ... container_image/container_port/container_resources overrides
    # edition = "enterprise" -> container_build_config.build_args.MM_IMAGE =
    #   "mattermost/mattermost-enterprise-edition"
  )
  application_modules    = { mattermost = local.mattermost_module }
  module_env_vars        = {}
  module_secret_env_vars = module.mattermost_app.secret_ids  # {}
  module_storage_buckets = module.mattermost_app.storage_buckets  # [{ name_suffix = "data" }]
  scripts_dir            = abspath("${module.mattermost_app.path}/scripts")
}

module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config     = local.application_modules
  module_storage_buckets = local.module_storage_buckets
  scripts_dir            = local.scripts_dir
  # ... other inputs
}
```

Différences clés par rapport au modèle de Ghost Common :
- `module_secret_env_vars` est toujours vide (`{}`) — Mattermost gère ses propres secrets en interne.
- `module_storage_buckets` est un seul bucket `data`, transmis tel quel depuis la sortie de `Mattermost_Common` — contrairement à la plupart des modules Common, le bucket est déclaré dans Common plutôt que dans le wrapper.
- `edition` n'est **pas** du tout transmis à `module "mattermost_app"` — il n'existe que sur le module wrapper et est consommé localement pour remplacer l'argument `MM_IMAGE` du build. Les variables Redis, en revanche, sont réellement transmises à `Mattermost_Common`.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Mattermost sur Google Cloud Run](Mattermost_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Module Mattermost GKE — Guide de configuration](Mattermost_GKE.md) — cette configuration déployée sur GKE.
