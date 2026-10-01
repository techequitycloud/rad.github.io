---
title: "Module de configuration partagée Listmonk Common"
description: "Référence de la configuration partagée du module Listmonk — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Listmonk_Common.md @ 3055034 sha256:25267d45483b -->

# Module de configuration partagée Listmonk Common {#listmonk-common-shared-configuration-module}

Le module `Listmonk Common` définit la configuration du gestionnaire de newsletters Listmonk pour l'écosystème RAD Modules. Il s'agit d'un **module de configuration pure** — il crée des secrets Secret Manager et produit les sorties `config`, `secret_ids` et `storage_buckets`, consommées par les modules wrapper propres à chaque plateforme (`Listmonk CloudRun` et `Listmonk GKE`).

## 1. Vue d'ensemble {#1-overview}

**Objectif** : centraliser toute la configuration propre à Listmonk (image de conteneur, configuration de PostgreSQL, correspondance des variables d'environnement, sondes de santé, bucket de stockage des téléversements et secret du mot de passe administrateur) dans un module unique partagé par les déploiements Cloud Run et GKE.

**Architecture** :

```
Layer 3: Application Wrappers
├── Listmonk_CloudRun  ──┐
└── Listmonk_GKE       ──┤── instantiate Listmonk_Common
                          ↓
               Listmonk_Common (this module)
               Creates: Secret Manager secret (admin password)
               Produces: config, secret_ids, storage_buckets
                          ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                          ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Caractéristiques clés** :
- Utilise **PostgreSQL 15** — compatible avec les deux chemins de déploiement, Cloud Run et GKE.
- Crée **deux secrets Secret Manager** — le mot de passe administrateur (`LISTMONK_ADMIN_PASSWORD`, généré automatiquement) et un **jeton d'API déterministe** (`LISTMONK_API_TOKEN`) que le point d'entrée réinscrit dans la table `users` à chaque démarrage (voir **Self-Healing API User**, §8).
- **Points de terminaison de santé :** `/health` renvoie `{"data":true}` avec un code HTTP 200 et **sans authentification** (à utiliser pour les sondes). `/api/*` — y compris `/api/health` — exige une session authentifiée et renvoie `403 {"message":"invalid session"}` sans authentification. Les modules wrapper utilisent donc une sonde de démarrage/vivacité **TCP** sur le port 9000 (Listmonk v6.1.0 place `/api/health` derrière l'authentification par session).
- Listmonk utilise la **notation à double tiret bas** pour sa configuration via les variables d'environnement (`LISTMONK_db__host`, `LISTMONK_db__password`), qui correspondent à des clés de configuration TOML/JSON imbriquées.
- `Listmonk_CloudRun` (et non `Listmonk_Common`) définit son propre `db_password_env_var_name = "LISTMONK_db__password"` afin que `App CloudRun` injecte le secret du mot de passe de la base de données directement sous ce nom, en plus de `DB_PASSWORD`. `Listmonk_GKE` laisse cette valeur vide et s'appuie uniquement sur `entrypoint.sh`, qui fait correspondre `DB_PASSWORD` → `LISTMONK_db__password` au démarrage.

---

## 2. Sorties {#2-outputs}

### `config` {#config}

L'objet de configuration applicative transmis au module de plateforme via `application_config`.

| Champ | Valeur / Description |
|---|---|
| `app_name` | `"listmonk"` |
| `application_version` | Tag de version (par défaut : `"latest"`) |
| `container_image` | `"listmonk/listmonk"` (image Docker Hub) |
| `image_source` | `"custom"` — une image wrapper personnalisée est construite par défaut |
| `enable_image_mirroring` | `var.enable_image_mirroring` (par défaut `true`) — met l'image en miroir dans Artifact Registry |
| `container_build_config` | `dockerfile_path = "Dockerfile"`, `context_path = "."`, `build_args = {}` (vide — le Dockerfile code en dur `FROM listmonk/listmonk:latest` et ne lit pas `application_version` comme argument de build) |
| `container_port` | `9000` |
| `database_type` | `"POSTGRES_15"` — Listmonk exige PostgreSQL |
| `db_name` | Nom de la base de données (par défaut : `"listmonk"`) |
| `db_user` | Utilisateur de la base de données (par défaut : `"listmonk"`) |
| `enable_cloudsql_volume` | Indique s'il faut monter le sidecar Cloud SQL Auth Proxy (par défaut : `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | Liste des montages de volumes GCS Fuse (vide par défaut) |
| `container_resources` | CPU : `1000m`, mémoire : `512Mi` |
| `environment_variables` | Variables d'environnement de configuration de Listmonk (voir §7) |
| `secret_environment_variables` | `{ DB_PASSWORD = <database password secret id> }` — fusionnée avec les éventuelles `var.secret_environment_variables`. Le mot de passe administrateur et le jeton d'API sont exposés séparément via la sortie `secret_ids`, et non via ce champ. |
| `initialization_jobs` | Job `db-init` par défaut ou remplacement personnalisé — voir §5 |
| `startup_probe` | HTTP `GET /api/health`, délai initial de 30 s, délai d'expiration de 5 s, période de 10 s, seuil d'échec de 30 |
| `liveness_probe` | HTTP `GET /api/health`, délai initial de 30 s, délai d'expiration de 5 s, période de 30 s, seuil d'échec de 3 |

### `secret_ids` {#secret_ids}

Une table d'ID de secrets Secret Manager injectés comme variables d'environnement secrètes.

| Clé | Valeur / Description |
|---|---|
| `LISTMONK_ADMIN_PASSWORD` | ID du secret Secret Manager contenant le mot de passe administrateur généré automatiquement. Pilote l'installation automatique du super-administrateur par Listmonk v3. |
| `LISTMONK_API_TOKEN` | ID du secret Secret Manager contenant le jeton d'API déterministe. Le point d'entrée réinscrit `sha256_hex(token)` dans `users.password` à chaque démarrage (voir §8 et les notes **Self-Healing API User**). |

Deux sorties supplémentaires (non secrètes) permettent de raccorder les consommateurs en aval au même identifiant :

| Sortie | Description |
|---|---|
| `api_user` | Le nom d'utilisateur d'API que le point d'entrée injecte (`var.api_username`, par défaut `rad-api`). |
| `api_token_secret_id` | `secret_id` du jeton d'API déterministe ; faites pointer `LISTMONK_API_TOKEN` de n8n vers ce secret (`:latest`). |

### `storage_buckets` {#storage_buckets}

`Listmonk Common` ne provisionne pas de bucket GCS par défaut. La sortie `storage_buckets` est une liste vide par défaut. Les modules wrapper (`Listmonk CloudRun`, `Listmonk GKE`) gèrent directement le provisionnement des buckets GCS via les variables `storage_buckets` et `gcs_volumes`.

Si vous souhaitez provisionner un bucket de téléversements, configurez `storage_buckets` dans le module wrapper et montez le bucket obtenu via `gcs_volumes` sur `/listmonk/uploads`.

---

## 3. Variables d'entrée {#3-input-variables}

### Application {#application}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `application_name` | `string` | `"listmonk"` | Nom de l'application. Utilisé comme préfixe du secret du mot de passe administrateur. |
| `application_version` | `string` | `"latest"` | Tag de l'image Docker Listmonk. Définissez une version précise (par ex. `"v3.0.0"`) pour des déploiements de production épinglés. |
| `display_name` | `string` | `"Listmonk"` | Nom d'affichage lisible. |
| `description` | `string` | `"Listmonk is a self-hosted newsletter and mailing list manager"` | Description de l'application. Utilisée dans la description du job `db-init`. |
| `db_name` | `string` | `"listmonk"` | Nom de la base de données PostgreSQL. Doit correspondre à `application_database_name` dans le module wrapper. |
| `db_user` | `string` | `"listmonk"` | Utilisateur applicatif PostgreSQL. Doit correspondre à `application_database_user` dans le module wrapper. |
| `admin_username` | `string` | `"listmonk"` | Déclarée mais actuellement inutilisée par `main.tf` — le nom d'utilisateur du super-administrateur injecté est codé en dur à `"admin"` via `LISTMONK_ADMIN_USER`, quelle que soit la valeur de cette variable. |
| `api_username` | `string` | `"rad-api"` | Nom de l'utilisateur d'API programmatique auto-réparé, injecté dans `users` à chaque démarrage. Associé au secret déterministe `api_token` afin que les consommateurs en aval ne détiennent jamais un jeton périmé. |
| `cpu_limit` | `string` | `"1000m"` | Limite de CPU du conteneur. |
| `memory_limit` | `string` | `"512Mi"` | Limite de mémoire du conteneur. |
| `min_instance_count` | `number` | `1` | Nombre minimal d'instances en cours d'exécution. |
| `max_instance_count` | `number` | `3` | Nombre maximal d'instances en cours d'exécution. |
| `enable_cloudsql_volume` | `bool` | `true` | Monte le socket du sidecar Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | `bool` | `true` | Met l'image de conteneur en miroir dans Artifact Registry avant le déploiement. |
| `environment_variables` | `map(string)` | `{}` | Variables d'environnement supplémentaires fusionnées dans la configuration de Listmonk. |
| `secret_environment_variables` | `map(string)` | `{}` | Variables d'environnement secrètes supplémentaires, fusionnées avec la référence `DB_PASSWORD` gérée par le module. Le mot de passe administrateur et le jeton d'API sont exposés via `secret_ids`, et non via cette variable. |
| `initialization_jobs` | `list(any)` | `[]` | Jobs d'initialisation personnalisés ; une liste vide déclenche le job `db-init` par défaut. |
| `startup_probe` | `object` | Voir §4 | Configuration de la sonde de santé au démarrage. |
| `liveness_probe` | `object` | Voir §4 | Configuration de la sonde de vivacité. |

### Infrastructure {#infrastructure}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `project_id` | `string` | — | ID du projet GCP. **Obligatoire.** Utilisé pour créer le secret du mot de passe administrateur. |
| `resource_prefix` | `string` | — | Préfixe des noms de secrets Secret Manager. **Obligatoire.** Généralement `app<listmonk><tenant><id>`. |
| `tenant_id` | `string` | `"demo"` | Identifiant de l'environnement de déploiement. |
| `region` | `string` | `"us-central1"` | Région GCP du déploiement des ressources. |
| `labels` | `map(string)` | `{}` | Libellés appliqués aux ressources créées (secrets). |
| `gcs_volumes` | `list(object)` | `[]` | Montages de volumes GCS Fuse (name, bucket_name, mount_path, readonly, mount_options). |

---

## 4. Sondes de santé {#4-health-probes}

Les **valeurs par défaut des variables d'entrée** `startup_probe`/`liveness_probe` de `Listmonk_Common` correspondent à une vérification HTTP `GET /api/health` (présentée ci-dessous) — mais depuis Listmonk v6.1.0, `/api/health` se trouve derrière l'authentification par session et renvoie `403 {"message":"invalid session"}` à une sonde non authentifiée. Les deux modules wrapper (`Listmonk_CloudRun`, `Listmonk_GKE`) **remplacent** donc ces variables par une sonde **TCP** sur le port 9000 avant de les transmettre à `Listmonk_Common` — voir §9. `/health` (sans le préfixe `/api`) est le véritable point de terminaison non authentifié qui renvoie 200, mais il n'est pas utilisé comme chemin de sonde par défaut.

Valeurs par défaut des variables de `Listmonk_Common`, si elles ne sont pas remplacées :

| Sonde | Chemin | Délai initial | Délai d'expiration | Période | Seuil d'échec | Objectif |
|---|---|---|---|---|---|---|
| **Démarrage** | `/api/health` | 30s | 5s | 10s | 30 | Laisse jusqu'à 330 secondes au total (30 s de délai + 30 × 10 s) à Listmonk pour terminer la création du schéma par `--install` au premier démarrage |
| **Vivacité** | `/api/health` | 30s | 5s | 30s | 3 | Redémarre le conteneur si Listmonk ne répond plus ou perd la connexion à la base de données |

En pratique, les sondes déployées sont les sondes TCP configurées au niveau du module wrapper (voir §9 et le guide propre à chaque variante), et non cette valeur HTTP par défaut.

---

## 5. Job d'initialisation {#5-initialization-job}

Un job `db-init` s'exécute par défaut (lorsque `initialization_jobs = []`) :

| Champ | Valeur |
|---|---|
| Image | `postgres:15-alpine` |
| Script | `scripts/db-init.sh` |
| Secrets requis | `DB_PASSWORD` (utilisateur applicatif), éventuellement `ROOT_PASSWORD` (superutilisateur pour la création de l'utilisateur) |
| `execute_on_apply` | `true` |
| Délai d'expiration | 600s, 1 nouvelle tentative |

Comportement de `db-init.sh` :
1. Résout l'hôte PostgreSQL cible à partir de `DB_HOST`, ou à défaut de `DB_IP`.
2. Détecte le type de connexion : si `DB_HOST` commence par `/`, utilise un socket Unix (`PGHOST`) ; sinon, utilise TCP.
3. Interroge PostgreSQL à l'aide de `pg_isready` (jusqu'à 30 tentatives, à 2 s d'intervalle).
4. Crée l'utilisateur de base de données `listmonk` s'il n'existe pas, en lui attribuant le mot de passe issu de `DB_PASSWORD`.
5. Crée la base de données `listmonk`, détenue par l'utilisateur applicatif, si elle n'existe pas.
6. Vérifie que l'utilisateur applicatif peut se connecter à la base de données.
7. Signale l'arrêt du Cloud SQL Proxy une fois terminé.

**Listmonk gère lui-même l'installation du schéma.** Le job `db-init` crée uniquement la base de données et l'utilisateur — il n'exécute aucune migration SQL. Au premier démarrage, Listmonk détecte une base de données vierge et exécute automatiquement `--install` pour créer les tables, les index, les données initiales et l'utilisateur administrateur défini par `LISTMONK_ADMIN_USER` (codé en dur à `"admin"`, indépendamment de la variable `admin_username` — voir la note du §5 ci-dessus) / `LISTMONK_ADMIN_PASSWORD`.

Remplacez `initialization_jobs` par une liste non vide pour substituer des jobs personnalisés à ce job par défaut. Chaque job personnalisé doit spécifier au moins l'un des éléments `command`, `args` ou `script_path`.

---

## 6. Secret Secret Manager {#6-secret-manager-secret}

`Listmonk Common` crée un secret Secret Manager :

| Modèle de nom du secret | Valeur | Mode de définition |
|---|---|---|
| `secret-<resource_prefix>-<app>-admin-password` | Mot de passe aléatoire (alphanumérique, 16 caractères) | Généré automatiquement (`random_password`) lors du premier apply |
| `secret-<resource_prefix>-<app>-api-token` | Jeton d'API aléatoire (alphanumérique, 48 caractères) | Généré automatiquement (`random_password`) lors du premier apply |

Les deux sont injectés comme **variables d'environnement secrètes** du conteneur via la sortie `secret_ids` — `LISTMONK_ADMIN_PASSWORD` et `LISTMONK_API_TOKEN` (noms à tiret bas simple, clés GKE SecretSync valides). Cloud Run / GKE lit les valeurs dans Secret Manager au démarrage de la révision ou du pod — elles ne sont jamais écrites dans l'état Terraform.

Le **nom d'utilisateur** administrateur est défini via la variable d'environnement en texte clair `LISTMONK_ADMIN_USER` (par défaut `"admin"`) ; avec `LISTMONK_ADMIN_PASSWORD`, elle pilote l'installation automatique du super-administrateur par Listmonk v3. Le **nom d'utilisateur** d'API est `LISTMONK_API_USER` (issu de `var.api_username`, par défaut `"rad-api"`).

---

## 7. Variables d'environnement {#7-environment-variables}

Listmonk lit sa configuration depuis des variables d'environnement en notation à double tiret bas, qui correspondent à des clés de configuration imbriquées :

| Variable d'environnement | Valeur par défaut | Objectif |
|---|---|---|
| `LISTMONK_app__address` | `"0.0.0.0:9000"` | Adresse et port d'écoute du serveur HTTP de Listmonk |
| `LISTMONK_ADMIN_USER` | `"admin"` | Nom d'utilisateur du super-administrateur pour l'installation automatique v3 (tiret bas simple = clé GKE SecretSync valide) |
| `LISTMONK_API_USER` | `var.api_username` (par défaut `"rad-api"`) | Nom de l'utilisateur d'API programmatique auto-réparé (voir §8) |
| `LISTMONK_db__port` | `"5432"` | Port PostgreSQL |
| `LISTMONK_db__ssl_mode` | `"disable"` | Mode SSL de la connexion via le Cloud SQL Auth Proxy (le proxy gère TLS) |
| `LISTMONK_upload__provider` | `"filesystem"` | Fournisseur de stockage des téléversements. `"filesystem"` stocke les fichiers sur le chemin monté |
| `LISTMONK_upload__filesystem__upload_path` | `"/listmonk/uploads"` | Chemin de stockage des téléversements. Montez un volume GCS Fuse sur ce chemin pour la persistance |

> **`LISTMONK_db__user` / `LISTMONK_db__database` ne sont volontairement PAS définies.** Le socle crée l'utilisateur et la base de données sous des noms propres au tenant et injecte `DB_USER`/`DB_NAME` ; le point d'entrée ne les fait correspondre que si elles ne sont pas définies. Les prérégler sur `"listmonk"` écrase les vrais noms et provoque `password authentication failed for user listmonk`.

**Variables d'environnement secrètes (issues de `secret_ids`) :**

| Variable d'environnement | Source |
|---|---|
| `LISTMONK_ADMIN_PASSWORD` | Secret du mot de passe administrateur géré par ce module (pilote l'installation automatique v3) |
| `LISTMONK_API_TOKEN` | Secret du jeton d'API déterministe géré par ce module (réinscrit dans `users.password` par le point d'entrée) |
| `DB_PASSWORD` | Secret du mot de passe de la base de données injecté par la plateforme (géré par `App CloudRun`/`App GKE`) ; `entrypoint.sh` le fait correspondre à `LISTMONK_db__password` au démarrage lorsque cette dernière n'est pas définie. Sur Cloud Run, `Listmonk_CloudRun` définit en outre `db_password_env_var_name = "LISTMONK_db__password"` afin que le socle injecte également le même secret directement sous ce nom. |

**Remarque sur DB_HOST :** la variable d'environnement `LISTMONK_db__host` est renseignée à l'exécution par `entrypoint.sh`, qui y fait correspondre la valeur `DB_HOST` injectée par la plateforme lorsqu'elle n'est pas définie. Lorsque `enable_cloudsql_volume = true`, le chemin du socket de l'Auth Proxy est associé à la clé de configuration Listmonk appropriée.

---

## 8. Scripts et image de conteneur {#8-scripts-and-container-image}

Tous les fichiers associés se trouvent dans `scripts/`. Le répertoire `scripts/` sert de contexte de build Docker.

### `Dockerfile` {#dockerfile}

Encapsule l'image officielle `listmonk/listmonk:latest` (Alpine) — le tag est codé en dur et non paramétré à partir de `application_version` :
- `apk add postgresql-client` — `psql` est requis par le point d'entrée pour définir `app.root_url` et injecter l'utilisateur d'API.
- Copie `entrypoint.sh` vers `/entrypoint.sh` (`chmod +x`).
- Définit le répertoire de travail sur `/listmonk` et utilise `/entrypoint.sh` comme ENTRYPOINT.

### `entrypoint.sh` {#entrypointsh}

S'exécute avant `exec ./listmonk` pour configurer l'environnement d'exécution :

**1. Correspondance des variables de base de données** — fait correspondre les variables `DB_HOST`/`DB_USER`/`DB_NAME`/`DB_PASSWORD` injectées par la plateforme aux variables `LISTMONK_db__*` **uniquement lorsqu'elles ne sont pas définies** (de sorte que les noms propres au tenant du socle l'emportent). Les hôtes de socket Unix Cloud SQL (`/...`) définissent `ssl_mode=disable`.

**2. Installation idempotente du schéma** — exécute `./listmonk --install --idempotent --yes` à chaque démarrage. `--idempotent` est **obligatoire** : un simple `--install --yes` est destructeur (il supprime et recrée toutes les tables à chaque démarrage, effaçant les abonnés) ; avec cette option, l'installation est sans effet une fois la base configurée (`skipping install as database appears to be already setup`).

**3. URL racine publique** — définit `settings.app.root_url` dans la base de données sur `CLOUDRUN_SERVICE_URL`/`GKE_SERVICE_URL` (un paramètre en base, et non une surcharge par variable d'environnement), afin que les liens publics ne pointent pas vers `localhost:9000`.

**4. Utilisateur d'API auto-réparé** — lorsque `LISTMONK_API_USER` + `LISTMONK_API_TOKEN` sont définies, effectue un UPSERT de cet utilisateur dans la table persistante `users` (`ON CONFLICT (username) DO UPDATE` idempotent), en stockant `sha256_hex(token)` dans `users.password`. Listmonk vérifie les jetons d'API par **SHA-256 + `ConstantTimeCompare`** (et non bcrypt), si bien que `sha256sum` suffit. Le SQL est transmis à `psql` sur l'**entrée standard** (l'option `-c` de psql n'interpole pas `:'var'`) et protégé par `if SEED_OUT=$(...)` afin qu'un échec ne puisse pas interrompre le point d'entrée sous `set -e`. Le jeton et son hachage ne sont jamais journalisés. L'identifiant devient ainsi déterministe d'un redémarrage, d'un démarrage à froid ou d'une réinitialisation de la base à l'autre, de sorte que l'expéditeur de campagnes de n8n (qui référence le même secret) ne se désynchronise jamais.

**5. Démarrage** — `exec ./listmonk`.

### `db-init.sh` {#db-initsh}

Script de création de la base de données et de l'utilisateur PostgreSQL. Voir §5 pour la description complète de son comportement.

---

## 9. Différences propres à chaque plateforme {#9-platform-specific-differences}

| Aspect | Listmonk CloudRun | Listmonk GKE |
|---|---|---|
| Injection des secrets | `App CloudRun` injecte nativement `LISTMONK_ADMIN_PASSWORD` depuis Secret Manager au démarrage de la révision | `App GKE` utilise le Secrets Store CSI Driver pour monter les secrets de Secret Manager comme variables d'environnement dans les pods |
| `DB_HOST` | Chemin du socket du Cloud SQL Auth Proxy (socket Unix sous `/cloudsql`) | Adresse IP privée de Cloud SQL (connexion TCP) |
| `min_instance_count` | Par défaut `0` (mise à l'échelle à zéro, associée à `cpu_always_allocated = true` pour qu'un envoi de campagne asynchrone se termine au réveil de l'instance) | Par défaut `1` (un pod toujours en cours d'exécution) |
| Sondes de santé | Sonde de démarrage Cloud Run **TCP** sur le port 9000 ; sonde de vivacité désactivée (Cloud Run n'offre pas d'option de vivacité TCP et `/api/health` renvoie 403 à une sonde HTTP) | Sondes Kubernetes `tcpSocket` de démarrage et de vivacité sur le port 9000 via `App GKE` |
| Affinité de session | Gérée au niveau de Cloud Run | Service Kubernetes avec `sessionAffinity: "ClientIP"` pour un routage cohérent des sessions d'administration |
| Persistance des téléversements | Volume GCS Fuse via `gcs_volumes` (Cloud Run Gen2) | GCS Fuse CSI Driver via `gcs_volumes` (natif GKE) |

---

## 10. Modèle d'implémentation {#10-implementation-pattern}

```hcl
# How Listmonk_CloudRun instantiates Listmonk_Common

module "listmonk_app" {
  source = "../Listmonk_Common"

  project_id           = var.project_id
  resource_prefix      = local.resource_prefix
  tenant_id = var.tenant_id
  region               = var.region
  labels               = var.resource_labels

  application_version    = var.application_version
  db_name                = var.db_name
  db_user                = var.db_user
  admin_username         = var.admin_username
  cpu_limit              = var.cpu_limit
  memory_limit           = var.memory_limit
  min_instance_count     = var.min_instance_count
  max_instance_count     = var.max_instance_count
  description            = var.description
  startup_probe          = var.startup_probe
  liveness_probe         = var.liveness_probe
  enable_cloudsql_volume = var.enable_cloudsql_volume
  enable_image_mirroring = var.enable_image_mirroring
  gcs_volumes            = var.gcs_volumes
}

# The wrapper assembles the four locals consumed by App_CloudRun
locals {
  application_modules    = { listmonk = module.listmonk_app.config }
  module_env_vars        = {}
  module_secret_env_vars = module.listmonk_app.secret_ids
  module_storage_buckets = module.listmonk_app.storage_buckets
  scripts_dir            = abspath("${path.module}/../Listmonk_Common/scripts")
}

# Passed to App_CloudRun via application_config
module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config     = local.application_modules
  module_storage_buckets = local.module_storage_buckets
  scripts_dir            = local.scripts_dir
  # ... other inputs
}
```

---

## 11. Explorer avec la console GCP {#11-exploring-with-the-gcp-console}

Après le déploiement, utilisez la console GCP pour vérifier les secrets et la configuration générés par `Listmonk Common`.

**Secret Manager**

Accédez à **Secret Manager** dans la console. Filtrez sur le nom du déploiement ou sur `listmonk` pour repérer les secrets gérés par le module :

- `secret-<resource_prefix>-listmonk-admin-password` (injecté sous `LISTMONK_ADMIN_PASSWORD`) — sélectionnez le secret, cliquez sur **Secret versions** et vérifiez que la version 1 existe avec l'état `Enabled`. L'onglet **Permissions** montre que le compte de service Cloud Run ou GKE dispose du rôle `Secret Manager Secret Accessor` (`roles/secretmanager.secretAccessor`) — accordé automatiquement par `App CloudRun`/`App GKE`.
- `secret-<resource_prefix>-listmonk-api-token` (injecté sous `LISTMONK_API_TOKEN`) — le secret du jeton d'API déterministe.

N'affichez pas la valeur du secret dans la console pour les déploiements de production. Ne la récupérez que pour la première connexion administrateur ou pour un accès d'urgence (break-glass).

**Environnement Cloud Run (vérification de l'injection des variables)**

Accédez à **Cloud Run** → sélectionnez le service Listmonk → **onglet YAML**. Repérez la section `env` dans la spécification du conteneur. Vérifiez que :
- `LISTMONK_app__address`, `LISTMONK_ADMIN_USER`, `LISTMONK_API_USER`, `LISTMONK_db__port`, `LISTMONK_db__ssl_mode`, `LISTMONK_upload__provider`, `LISTMONK_upload__filesystem__upload_path` apparaissent comme variables d'environnement en texte clair `value:`. (`LISTMONK_db__user` / `LISTMONK_db__database` sont volontairement absentes — le point d'entrée les fait correspondre à `DB_USER`/`DB_NAME` au démarrage.)
- `LISTMONK_ADMIN_PASSWORD`, `LISTMONK_API_TOKEN` et `DB_PASSWORD` apparaissent comme entrées `valueFrom.secretKeyRef:` — ce qui confirme qu'elles proviennent de Secret Manager et ne sont pas stockées en clair dans la spécification de la révision.

**Interface d'administration de Listmonk**

Après le déploiement, l'interface d'administration de Listmonk est accessible à l'URL du service Cloud Run (issue de la sortie `service_url` ou de la console **Cloud Run**). Accédez à la racine `/` — Listmonk y sert directement l'interface d'administration. Connectez-vous avec le nom d'utilisateur `admin` (codé en dur via `LISTMONK_ADMIN_USER`, indépendamment de la variable `admin_username`) et le mot de passe issu de Secret Manager.

Depuis l'interface d'administration, vérifiez :
- **Settings → General** : confirme l'adresse de l'application et l'URL racine.
- **Settings → Performance** : affiche les valeurs par défaut de concurrence et de taille de lot pour l'envoi des campagnes.
- **Lists** : vide au départ. Créez une liste pour commencer à gérer les abonnés.

---

## 12. Explorer avec gcloud {#12-exploring-with-gcloud}

```bash
# List all Secret Manager secrets in the project related to this Listmonk deployment
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~listmonk" \
  --format="table(name,replication.automatic.customerManagedEncryption,createTime)"

# Confirm a secret version exists and is enabled for the admin password secret
gcloud secrets versions list SECRET_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,createTime,destroyTime)"

# Check which service accounts have access to the admin password secret
gcloud secrets get-iam-policy SECRET_NAME \
  --project=PROJECT_ID

# View the Listmonk container's environment variable names (not values)
# to confirm all required Listmonk config vars are present
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="yaml(spec.template.spec.containers[0].env)"

# Verify Secret Manager secret accessor binding for the Cloud Run service account
gcloud projects get-iam-policy PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.role=roles/secretmanager.secretAccessor" \
  --format="table(bindings.members)"

# Access the admin password for initial login (use with caution)
gcloud secrets versions access latest \
  --secret=ADMIN_PASSWORD_SECRET_NAME \
  --project=PROJECT_ID

# Verify the PostgreSQL database and user exist after db-init completes
# (requires Cloud SQL Auth Proxy access or a bastion)
gcloud sql databases list \
  --instance=SQL_INSTANCE_NAME \
  --project=PROJECT_ID

gcloud sql users list \
  --instance=SQL_INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,host,type)"
```

<!-- related-guides -->

## Guides associés {#related-guides}

- [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Module Listmonk GKE — Guide de configuration](Listmonk_GKE.md) — cette configuration déployée sur GKE.
