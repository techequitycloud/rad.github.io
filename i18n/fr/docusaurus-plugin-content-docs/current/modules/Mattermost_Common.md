---
title: "Mattermost Common — Module de configuration partagée"
description: "Référence de la configuration partagée du module Mattermost — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Mattermost_Common.md @ 3055034 sha256:57e8cb652b5c -->

# Mattermost Common — Module de configuration partagée {#mattermost-common-shared-configuration-module}

Le module `Mattermost Common` définit la configuration de la plateforme de messagerie d'équipe Mattermost pour l'écosystème RAD Modules. Il s'agit d'un **module de configuration pure** : il ne crée aucune ressource GCP et produit une sortie `config` consommée par les modules d'encapsulation propres à chaque plateforme (`Mattermost CloudRun` et `Mattermost GKE`).

## 1. Vue d'ensemble {#1-overview}

**Objectif** : centraliser toute la configuration propre à Mattermost (image de conteneur personnalisée, configuration de la base de données PostgreSQL 15, correspondance des variables d'environnement, sondes de santé et job d'initialisation) dans un module unique partagé par les déploiements Cloud Run et GKE.

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

**Caractéristiques principales** :
- Utilise **PostgreSQL 15** — Mattermost nécessite PostgreSQL 13 ou une version ultérieure et ne prend pas en charge MySQL.
- Ne crée **aucune ressource GCP** — ni secrets, ni liaisons IAM. Mattermost génère ses propres clés de signature internes, secrets de session et clés de chiffrement au premier démarrage et les conserve dans la base de données PostgreSQL.
- Expose un **point de terminaison de santé dédié** à `/api/v4/system/ping`, utilisé à la fois par les sondes de démarrage et de vivacité pour un signal de santé précis. Cela le distingue de la plupart des autres modules, qui sondent le chemin racine de l'application (`/`).
- **`container_image` est codé en dur à `mattermost/mattermost-team-edition`** — `Mattermost_Common` lui-même n'a pas de variable `edition`. La sélection de l'image selon l'édition (`edition = "enterprise"` → `mattermost/mattermost-enterprise-edition`) est implémentée par les modules d'encapsulation (`Mattermost_CloudRun`, `Mattermost_GKE`), qui remplacent `container_image` dans leur propre fusion `application_config` lorsque `var.edition == "enterprise"`.
- **Configuration compatible Redis** : lorsque `enable_redis = true`, injecte automatiquement les variables d'environnement `MM_CACHEBACKEND=redis`, `MM_REDIS_ADDRESS` et `MM_REDIS_PASSWORD`.

---

## 2. Sorties {#2-outputs}

### `config` {#config}
L'objet de configuration de l'application transmis au module de plateforme via `application_config`.

| Champ | Valeur / Description |
|---|---|
| `app_name` | `"mattermost"` |
| `application_version` | Tag de version (par défaut : `"9.11.2"`) |
| `container_image` | `"mattermost/mattermost-team-edition"` (codé en dur ; les modules d'encapsulation le remplacent par l'image enterprise lorsque `edition = "enterprise"`) |
| `image_source` | `"custom"` — une image d'encapsulation personnalisée est construite à partir du Dockerfile du module Common |
| `enable_image_mirroring` | `var.enable_image_mirroring` (par défaut `true`) — met en miroir l'image Docker Hub de Mattermost dans Artifact Registry avant le déploiement |
| `container_build_config` | `dockerfile_path = "Dockerfile"`, `context_path = "."`, `build_args = { MM_VERSION = <version, "latest" mapped to "9.11.2"> }` (un nom d'argument propre à l'application, afin que l'injection générique `APP_VERSION` du socle ne puisse pas le remplacer) |
| `container_port` | `8065` |
| `database_type` | `"POSTGRES_15"` |
| `db_name` | Nom de la base de données (par défaut : `"mattermost"`) |
| `db_user` | Utilisateur de la base de données (par défaut : `"mattermost"`) |
| `enable_cloudsql_volume` | Indique s'il faut monter le sidecar Cloud SQL Auth Proxy (par défaut : `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | Liste des montages de volumes GCS Fuse transmis depuis `var.gcs_volumes` |
| `container_resources` | CPU : `2000m`, mémoire : `2Gi` (par défaut ; des valeurs plus élevées sont recommandées pour les équipes actives) |
| `environment_variables` | Variables d'environnement principales de Mattermost (voir §4) fusionnées avec `var.environment_variables` |
| `secret_environment_variables` | `var.secret_environment_variables` — variables d'environnement secrètes transmises au conteneur ; gérées en externe par défaut |
| `initialization_jobs` | Job `db-init` par défaut ou remplacement personnalisé — voir §5 |
| `startup_probe` | HTTP `GET /api/v4/system/ping`, délai initial de 30s, timeout de 10s, période de 10s, seuil d'échec de 30 |
| `liveness_probe` | HTTP `GET /api/v4/system/ping`, délai initial de 30s, timeout de 5s, période de 30s, seuil d'échec de 3 |

### `secret_ids` {#secret_ids}
Une map vide (`{}`). Mattermost Common ne génère pas automatiquement de secrets applicatifs. Mattermost génère ses propres clés internes au premier démarrage et les stocke dans PostgreSQL. Le `module_secret_env_vars` des modules d'encapsulation est défini sur cette map vide.

### `storage_buckets` {#storage_buckets}
Une liste à un seul élément déclarant un bucket `data` (`name_suffix = "data"`, classe `STANDARD`, `force_destroy = true`, versionnage désactivé, `public_access_prevention = "enforced"`). Les modules d'encapsulation transmettent cette sortie telle quelle en tant que `module_storage_buckets`, de sorte que le bucket est réellement provisionné — malgré cela, le chemin principal de stockage des fichiers du module est `gcs_volumes` (monté sur `/mattermost/data`), et non ce bucket.

### `path` {#path}
Le chemin absolu du répertoire du module, utilisé par les modules d'encapsulation pour localiser le répertoire `scripts/`.

---

## 3. Variables d'entrée {#3-input-variables}

### Application {#application}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `application_name` | `string` | `"mattermost"` | Nom de l'application — utilisé comme nom de base des ressources. |
| `application_version` | `string` | `"9.11.2"` | Tag de l'image Docker de Mattermost. Incrémentez-le pour déployer une nouvelle version. |
| `description` | `string` | `"Initialize Mattermost database schema"` | Description utilisée dans le job `db-init` par défaut. |
| `db_name` | `string` | `"mattermost"` | Nom de la base de données PostgreSQL. |
| `db_user` | `string` | `"mattermost"` | Utilisateur applicatif PostgreSQL. |
| `cpu_limit` | `string` | `"2000m"` | Limite de CPU du conteneur Mattermost. |
| `memory_limit` | `string` | `"2Gi"` | Limite de mémoire du conteneur Mattermost. |
| `environment_variables` | `map(string)` | `{}` | Variables d'environnement supplémentaires fusionnées dans la configuration principale de Mattermost. |
| `initialization_jobs` | `list(object)` | `[]` | Jobs d'initialisation personnalisés. Une liste vide déclenche le job `db-init` par défaut. |
| `startup_probe` | `object` | voir §6 | Configuration de la sonde de santé de démarrage. |
| `liveness_probe` | `object` | voir §6 | Configuration de la sonde de santé de vivacité. |
| `enable_image_mirroring` | `bool` | `true` | Met en miroir l'image de conteneur dans Artifact Registry avant le déploiement. |
| `min_instance_count` | `number` | `1` | Nombre minimal d'instances en cours d'exécution. La valeur par défaut `1` empêche la mise à l'échelle à zéro dans Cloud Run. |
| `max_instance_count` | `number` | `3` | Nombre maximal d'instances en cours d'exécution. |
| `region` | `string` | `"us-central1"` | Région GCP de déploiement des ressources. |
| `site_url` | `string` | `""` | L'URL publique à laquelle Mattermost est accessible. Définit `MM_SERVICESETTINGS_SITEURL`. |

> `edition` n'est **pas** une variable de `Mattermost_Common` — elle est déclarée sur les modules d'encapsulation (`Mattermost_CloudRun`, `Mattermost_GKE`) et y est utilisée pour sélectionner l'image de conteneur. Voir §9.

### Stockage et volumes {#storage--volumes}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloudsql_volume` | `bool` | `true` | Monte le socket du sidecar Cloud SQL Auth Proxy. |
| `gcs_volumes` | `list(object)` | `[]` | Montages de volumes GCS Fuse. Chaque entrée : `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. Montez sur `/mattermost/data` pour conserver durablement les fichiers téléversés. |

### Intégration Redis {#redis-integration}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_redis` | `bool` | `false` | Active Redis pour le cache et le stockage des sessions de Mattermost. Lorsque `true`, injecte automatiquement les variables d'environnement propres à Redis. |
| `redis_host` | `string` | `""` | Nom d'hôte ou adresse IP de Redis. Obligatoire lorsque `enable_redis = true`. |
| `redis_port` | `string` | `"6379"` | Port TCP du serveur Redis. |
| `redis_auth` | `string` | `""` | Mot de passe AUTH de Redis. Marqué `sensitive` dans Terraform, mais injecté sous forme de variable d'environnement `MM_REDIS_PASSWORD` **en clair** (et non comme référence Secret Manager) lorsqu'il n'est pas vide — `secret_environment_variables` vaut toujours `{}` pour ce module. |

---

## 4. Variables d'environnement {#4-environment-variables}

Mattermost Common injecte un ensemble de variables d'environnement principales dans chaque déploiement. Toute la configuration de Mattermost utilise le préfixe `MM_`, avec une notation de chemin à double tiret bas pour les paramètres imbriqués.

### Paramètres principaux du service {#core-service-settings}

| Variable | Valeur / Source | Rôle |
|---|---|---|
| `MM_SERVICESETTINGS_LISTENADDRESS` | `:8065` | Lie le serveur HTTP de Mattermost à toutes les interfaces sur le port 8065. |
| `MM_METRICSSETTINGS_LISTENADDRESS` | `:8067` | Point de terminaison de métriques au format Prometheus. À intégrer à Cloud Monitoring via remote write. |
| `MM_SERVICESETTINGS_SITEURL` | `var.site_url` (lorsqu'il n'est pas vide) | L'URL publique utilisée pour générer les liens dans les e-mails, les webhooks et les callbacks OAuth. |
| `MM_SERVICESETTINGS_TRUSTEDPROXYIPHEADER` | `X-Forwarded-For` | Indique à Mattermost de faire confiance à l'en-tête `X-Forwarded-For` provenant de la couche proxy de Cloud Run et de l'équilibreur de charge, afin d'extraire correctement l'adresse IP du client. |

### Stockage de fichiers {#file-storage}

| Variable | Valeur | Rôle |
|---|---|---|
| `MM_FILESETTINGS_DRIVERTYPE` | `local` | Indique à Mattermost d'utiliser le stockage sur le système de fichiers local. Lorsqu'un volume GCS FUSE est monté sur `/mattermost/data`, cela correspond de manière transparente à un stockage objet durable. |
| `MM_FILESETTINGS_DIRECTORY` | `/mattermost/data/` | Chemin de stockage des fichiers — doit correspondre au point de montage GCS FUSE ou NFS. |

### Journalisation {#logging}

| Variable | Valeur | Rôle |
|---|---|---|
| `MM_LOGSETTINGS_CONSOLELEVEL` | `INFO` | Niveau de journalisation écrit sur stdout. Cloud Run et GKE transmettent automatiquement stdout à Cloud Logging. |
| `MM_LOGSETTINGS_ENABLEFILE` | `false` | Désactive la journalisation dans des fichiers. Les journaux sous forme de fichiers ne conviennent pas aux déploiements conteneurisés — toute la sortie de journalisation va sur stdout et est capturée par Cloud Logging. |

### Regroupement des e-mails {#email-batching}

| Variable | Valeur | Rôle |
|---|---|---|
| `MM_EMAILSETTINGS_ENABLEEMAILBATCHING` | `false` | Désactivé pour la compatibilité avec Cloud Run. Le regroupement des e-mails nécessite une file d'attente en mémoire qui ne survit pas aux redémarrages de conteneur ni aux mises à l'échelle à zéro. |

### Cache Redis (injecté lorsque `enable_redis = true`) {#redis-cache-injected-when-enable_redis--true}

| Variable | Valeur / Source | Rôle |
|---|---|---|
| `MM_CACHEBACKEND` | `redis` | Bascule le backend de cache de Mattermost de la mémoire du processus vers l'instance Redis externe. |
| `MM_REDIS_ADDRESS` | `<redis_host>:<redis_port>` | Chaîne de connexion au serveur Redis. |
| `MM_REDIS_PASSWORD` | `var.redis_auth` (lorsqu'il n'est pas vide) | Mot de passe AUTH de Redis, injecté en tant que variable d'environnement secrète lorsqu'il est défini. |

Lorsque `enable_redis = false`, `MM_CACHEBACKEND` est défini sur `memory` et aucune variable de connexion Redis n'est injectée.

---

## 5. Job d'initialisation {#5-initialization-job}

Un job `db-init` s'exécute par défaut (lorsque `initialization_jobs = []`) :

| Champ | Valeur |
|---|---|
| Image | `postgres:15-alpine` |
| Script | `scripts/db-init.sh` |
| Secrets requis | `DB_PASSWORD` (mot de passe de l'utilisateur applicatif), `ROOT_PASSWORD` (superutilisateur PostgreSQL, facultatif) |
| `execute_on_apply` | `true` |
| CPU / Mémoire | `1000m` / `512Mi` |
| Timeout | 600s, 1 nouvelle tentative |

Comportement de `db-init.sh` :
1. Se connecte à Cloud SQL PostgreSQL via le socket Unix de l'Auth Proxy ou en TCP.
2. Crée l'utilisateur `mattermost` avec le mot de passe issu de Secret Manager s'il n'existe pas.
3. Crée la base de données `mattermost` si elle n'existe pas.
4. Accorde à l'utilisateur `mattermost` tous les privilèges sur la base de données.
5. Vérifie la connectivité en exécutant une simple requête `SELECT 1` en tant qu'utilisateur applicatif.

Mattermost exécute ensuite ses propres migrations de schéma au démarrage — le job `db-init` crée uniquement la base de données vide et l'utilisateur ; il n'initialise pas le schéma de Mattermost. C'est voulu : le système de migration intégré de Mattermost gère automatiquement la mise en place du schéma et les montées de version.

Remplacez `initialization_jobs` par une liste non vide pour remplacer entièrement ce job par défaut.

---

## 6. Sondes de santé {#6-health-probes}

`Mattermost_Common` déclare des variables `startup_probe`/`liveness_probe` qui ciblent par défaut le point de terminaison `/api/v4/system/ping`. Ce point de terminaison fait partie de l'API REST de Mattermost et renvoie `HTTP 200` lorsque le serveur est entièrement initialisé, connecté à la base de données et prêt à traiter les requêtes.

C'est un signal de santé plus précis que le sondage du chemin racine (`/`) : le point de terminaison ping vérifie que Mattermost s'est bien connecté à PostgreSQL et a terminé toutes les migrations de schéma en attente.

| Sonde | Chemin | Délai initial | Timeout | Période | Seuil d'échec | Rôle |
|---|---|---|---|---|---|---|
| **Startup** (démarrage) | `/api/v4/system/ping` | 30s | 10s | 10s | 30 | Accorde jusqu'à 330 secondes au total à Mattermost pour terminer la migration de la base de données et s'initialiser. Ce seuil généreux tient compte de la création du schéma lors de la première exécution sur une base de données vierge. |
| **Liveness** (vivacité) | `/api/v4/system/ping` | 30s | 5s | 30s | 3 | Redémarre le conteneur si Mattermost ne répond plus ou perd sa connexion à la base de données. |

**Ce tableau correspond à la valeur par défaut des variables de `Mattermost_Common` lui-même, et non à ce que chaque plateforme déploie réellement.** `Mattermost_GKE` transmet `startup_probe`/`liveness_probe` sans modification ; GKE utilise donc bien ces chemins et valeurs par défaut. `Mattermost_CloudRun`, en revanche, déclare ses **propres** variables `startup_probe`/`liveness_probe`, dont la valeur par défaut est `path = "/"` — cette valeur par défaut remplace silencieusement celle de `Mattermost_Common` lorsqu'elle est transmise dans `mattermost.tf`, si bien que **les sondes réellement déployées sur Cloud Run ciblent par défaut le chemin racine, et non `/api/v4/system/ping`**, sauf si l'opérateur les remplace explicitement (voir `docs/modules/Mattermost_CloudRun.md` §C).

`Mattermost_CloudRun` et `Mattermost_GKE` déclarent également chacun des variables distinctes `startup_probe_config`/`health_check_config`. Elles ne constituent **pas** un autre moyen de configurer les mêmes sondes et n'ont **pas** les mêmes chemins par défaut que le tableau ci-dessus — elles sont inopérantes pour Mattermost sur les deux plateformes, car reliées uniquement au préréglage de repli interne et inutilisé de chaque module socle (`cloudrunapp` d'`App_CloudRun` / `gkeapp` d'`App_GKE`). Les remplacer n'a aucun effet sur le service ou le pod déployé ; utilisez plutôt `startup_probe`/`liveness_probe`.

Par ailleurs, la sortie `config` de ce module définit aussi une troisième clé, `readiness_probe` (codée en dur à `path = "/api/v4/system/ping"` dans `main.tf`), qui est elle aussi inopérante — ni `App_CloudRun` ni `App_GKE` ne lit de champ `readiness_probe` dans la configuration de l'application ; elle n'a donc aucun effet à l'exécution sur l'une ou l'autre plateforme.

---

## 7. Scripts et image de conteneur {#7-scripts-and-container-image}

Tous les fichiers annexes se trouvent dans `scripts/`. Le répertoire `scripts/` sert de contexte de build Docker.

### `Dockerfile` {#dockerfile}
Encapsule l'image officielle `mattermost/mattermost-team-edition:${MM_VERSION}` :
- N'accepte que `MM_VERSION` comme argument de build Docker (par défaut `9.11.2`) ; il n'existe pas d'argument de build `EDITION`, et la ligne `FROM` est toujours `mattermost-team-edition`, quelle que soit la variable `edition` du module d'encapsulation.
- Passe à `root` uniquement pour installer le wrapper du point d'entrée, puis revient à l'uid `mattermost` intégré à l'image (`2000`).
- Copie `entrypoint.sh` vers `/usr/local/bin/mm-entrypoint.sh` et l'utilise comme `ENTRYPOINT` — ce wrapper fait correspondre les variables `DB_*` du socle à `MM_SQLSETTINGS_DATASOURCE` avant de démarrer le serveur ; tous les autres paramètres `MM_*` sont injectés directement sous forme de variables d'environnement.
- Expose le port `8065` (HTTP).

### `db-init.sh` {#db-initsh}
Crée la base de données PostgreSQL et l'utilisateur avant le premier démarrage de Mattermost :
1. Résout la connexion PostgreSQL à partir de `DB_HOST` (chemin du socket Unix pour l'Auth Proxy, ou nom d'hôte TCP).
2. Se connecte avec `ROOT_PASSWORD`, ou se rabat sur l'authentification peer si le mot de passe root n'est pas disponible.
3. Crée l'utilisateur applicatif avec `DB_PASSWORD` issu de Secret Manager.
4. Crée la base de données `mattermost` appartenant à l'utilisateur applicatif.
5. Vérifie la connectivité en tant qu'utilisateur applicatif.
6. Signale au Cloud SQL Proxy de s'arrêter proprement.

---

## 8. Différences propres à chaque plateforme {#8-platform-specific-differences}

| Aspect | Mattermost CloudRun | Mattermost GKE |
|---|---|---|
| **`min_instance_count` par défaut** | `1` — empêche la mise à l'échelle à zéro de déconnecter les sessions WebSocket. | `1` — toujours au moins un pod en cours d'exécution. |
| **`max_instance_count` par défaut** | `5` | `5` |
| **Chemin de la sonde de santé** | `/` (valeur par défaut du module Cloud Run) ; remplacez-le par `/api/v4/system/ping` pour un signal précis. | `/api/v4/system/ping` — le module GKE utilise par défaut le point de terminaison de santé précis de Mattermost. |
| **Connectivité Cloud SQL** | Socket Unix de l'Auth Proxy via `enable_cloudsql_volume = true` (par défaut). | `enable_cloudsql_volume = true` par défaut sur GKE également — mais cela injecte un sidecar `cloud-sql-proxy` à l'écoute en TCP sur `127.0.0.1`, et non un socket Unix ; `entrypoint.sh` se connecte via cette adresse TCP de bouclage. |
| **Stockage des fichiers** | Volumes GCS FUSE (`gcs_volumes`) ou NFS. GCS FUSE est à privilégier pour Cloud Run. | Volumes GCS FUSE via le pilote CSI (`gcs_volumes`) ou NFS. GCS FUSE ou PVC de StatefulSet pour GKE. |
| **Timeout WebSocket** | Le timeout de requête maximal de 60 min de Cloud Run limite la durée de vie des WebSockets. Définissez `timeout_seconds = 3600`. | Aucune contrainte de timeout — les connexions GKE persistent indéfiniment. Meilleur choix pour la production. |
| **Affinité de session** | Sans objet pour Cloud Run (serverless). | `session_affinity = "ClientIP"` par défaut — nécessaire pour des sessions d'administration Mattermost cohérentes entre les réplicas de pod. |
| **`site_url`** | À définir après le premier déploiement, une fois l'URL Cloud Run `*.run.app` connue. | À définir sur l'IP de l'équilibreur de charge ou sur le domaine personnalisé après le premier déploiement. |

---

## 9. Sélection de l'édition {#9-edition-selection}

La variable `edition` est déclarée sur les **modules d'encapsulation** (`Mattermost_CloudRun`, `Mattermost_GKE`), et non sur `Mattermost_Common` — voir §3. Lorsque `edition = "enterprise"`, le module d'encapsulation remplace le champ fusionné `container_image` par `mattermost/mattermost-enterprise-edition`. Notez que cela ne modifie **pas** l'image `FROM` à partir de laquelle le `Dockerfile` statique de `Mattermost_Common` est construit (voir §7) — ce fichier tire toujours `mattermost-team-edition:${MM_VERSION}`, quelle que soit la valeur de `edition`, puisqu'il n'a pas d'argument de build `EDITION`.

| `edition` | Image | Remarques |
|---|---|---|
| `"team"` (par défaut) | `mattermost/mattermost-team-edition:<version>` | Gratuite. Prend en charge un nombre illimité d'utilisateurs avec la messagerie standard, les canaux, les intégrations et les webhooks. |
| `"enterprise"` | `mattermost/mattermost-enterprise-edition:<version>` | Nécessite une clé de licence payante. Débloque la synchronisation LDAP/AD, le SSO SAML, les contrôles de conformité avancés, la rétention personnalisée, le clustering haute disponibilité multirégional et les fonctionnalités de sécurité enterprise. |

Pour activer les fonctionnalités Enterprise, définissez `edition = "enterprise"` et fournissez la clé de licence via `environment_variables` :

```hcl
edition = "enterprise"

environment_variables = {
  MM_LicenseKey = "your-enterprise-licence-key"
}
```

Ou utilisez `secret_environment_variables` pour éviter de stocker la clé de licence en clair :

```hcl
secret_environment_variables = {
  MM_LicenseKey = "mattermost-licence-key"
}
```

---

## 10. Modèle d'implémentation {#10-implementation-pattern}

L'exemple suivant illustre la manière dont `Mattermost_CloudRun` instancie `Mattermost_Common` :

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
    var.edition == "enterprise" ? { container_image = "mattermost/mattermost-enterprise-edition" } : {},
    # ... other container_image/container_port/container_resources overrides
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

Principales différences par rapport au modèle de Ghost Common :
- `module_secret_env_vars` est toujours vide (`{}`) — Mattermost gère lui-même ses secrets en interne.
- `module_storage_buckets` est un unique bucket `data`, transmis tel quel depuis la sortie de `Mattermost_Common` — contrairement à la plupart des modules Common, le bucket est déclaré dans Common plutôt que dans le module d'encapsulation.
- `edition` n'est **pas du tout** transmis à `module "mattermost_app"` — elle n'existe que sur le module d'encapsulation et y est consommée localement pour remplacer `container_image` dans la fusion présentée ci-dessus. Les variables Redis, en revanche, sont bel et bien transmises à `Mattermost_Common`.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Mattermost sur Google Cloud Run](Mattermost_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Module Mattermost GKE — Guide de configuration](Mattermost_GKE.md) — cette configuration déployée sur GKE.
