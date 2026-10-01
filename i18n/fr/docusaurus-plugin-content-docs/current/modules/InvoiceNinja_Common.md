---
title: "Module de configuration partagée InvoiceNinja Common"
description: "Référence de la configuration partagée du module InvoiceNinja — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/InvoiceNinja_Common.md @ 3055034 sha256:c70e9aca5fab -->

# Module de configuration partagée InvoiceNinja Common {#invoiceninja-common-shared-configuration-module}

Le module `InvoiceNinja Common` définit la configuration de l'application Invoice Ninja pour l'écosystème RAD Modules. Il s'agit d'un **module de configuration pur** — il ne crée directement aucune ressource GCP et produit une sortie `config` consommée par les modules d'encapsulation propres à chaque plateforme (`InvoiceNinja CloudRun` et `InvoiceNinja GKE`).

## 1. Vue d'ensemble {#1-overview}

**Objectif** : centraliser toute la configuration propre à Invoice Ninja (image de conteneur, configuration de la base de données MySQL 8.0, correspondance des variables d'environnement, sondes de santé, bucket de stockage, secrets générés automatiquement et définitions des jobs d'initialisation) dans un module unique partagé par les déploiements Cloud Run et GKE.

**Architecture** :

```
Layer 3: Application Wrappers
├── InvoiceNinja_CloudRun  ──┐
└── InvoiceNinja_GKE       ──┤── instantiate InvoiceNinja_Common
                              ↓
               InvoiceNinja_Common (this module)
               Creates: APP_KEY secret in Secret Manager
               Produces: config, secret_ids, storage_buckets, path
                              ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                              ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Caractéristiques clés** :
- L'un des rares modules de l'écosystème à utiliser **MySQL 8.0** au lieu de PostgreSQL. L'application Laravel d'Invoice Ninja ne prend en charge que MySQL.
- **Génère automatiquement le secret `APP_KEY`** — une clé de chiffrement Laravel aléatoire de 32 octets encodée en base64, stockée dans Secret Manager sous la forme `base64:<value>`. Elle est générée une seule fois lors du premier apply et n'est pas régénérée lors des apply suivants.
- Définit **deux jobs d'initialisation** (`db-init` et `artisan-migrate`) qui s'exécutent séquentiellement lors du déploiement.
- Configure la **génération de PDF snappdf** avec Chromium embarqué dans le conteneur `invoiceninja/invoiceninja:5`.
- Injecte `TRUSTED_PROXIES=*` pour que Laravel gère correctement les en-têtes du proxy inverse de Cloud Run et de GKE.

---

## 2. Sorties {#2-outputs}

### `config` {#config}
L'objet de configuration de l'application transmis au module de plateforme via `application_config`.

| Champ | Valeur / Description |
|---|---|
| `app_name` | `"invoiceninja"` |
| `application_version` | Tag de version (par défaut : `"5"`) |
| `container_image` | `"invoiceninja/invoiceninja:<application_version>"` — l'image publique Docker Hub, utilisée comme base `FROM` du Dockerfile pour le build personnalisé propre au module Common |
| `image_source` | `"custom"` dans la configuration propre d'`InvoiceNinja_Common` (une fine encapsulation Cloud Build ajoutant nginx + un correctif de socket Unix Cloud SQL dans `config/database.php` — voir `container_build_config` ci-dessous). `InvoiceNinja_CloudRun` et `InvoiceNinja_GKE` définissent tous deux par défaut leur propre variable `container_image_source` sur `"prebuilt"`, ce qui prévaut sur cette valeur dans la configuration finale fusionnée, sauf si l'appelant de l'encapsulation transmet explicitement `"custom"` |
| `container_build_config` | `{ enabled = true, dockerfile_path = "Dockerfile", context_path = "<module>/scripts", build_args = { APP_VERSION = application_version } }` — n'a d'effet que lorsque l'`image_source` de l'encapsulation se résout en `"custom"` |
| `container_port` | `80` — Invoice Ninja utilise nginx sur le port 80 |
| `database_type` | `"MYSQL_8_0"` — Invoice Ninja nécessite MySQL 8.0+ |
| `db_name` | Nom de la base de données (par défaut : `"invoiceninja"`) |
| `db_user` | Utilisateur de la base de données (par défaut : `"invoiceninja"`) |
| `enable_cloudsql_volume` | Indique s'il faut monter le sidecar Cloud SQL Auth Proxy (par défaut : `true`) |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `gcs_volumes` | Liste des montages de volumes GCS Fuse (vide par défaut) |
| `container_resources` | CPU : `2000m`, mémoire : `2Gi` — la génération de PDF par Chromium nécessite des ressources importantes |
| `environment_variables` | Transmises depuis `var.environment_variables` et fusionnées avec les valeurs par défaut propres à Invoice Ninja (voir le §4) |
| `secret_environment_variables` | Contient la référence `APP_KEY` ainsi que tout secret supplémentaire issu de `var.secret_environment_variables` |
| `initialization_jobs` | Jobs par défaut `db-init` + `artisan-migrate` ou remplacement personnalisé (voir le §5) |
| `startup_probe` | HTTP `GET /`, délai initial de 90 s, délai d'expiration de 10 s, période de 15 s, seuil d'échec de 30 |
| `liveness_probe` | HTTP `GET /`, délai initial de 120 s, délai d'expiration de 10 s, période de 30 s, seuil d'échec de 3 |

### `secret_ids` {#secret_ids}
Une map contenant les ID de secrets Secret Manager des secrets créés par ce module :

| Clé | Description |
|---|---|
| `APP_KEY` | Clé de chiffrement de l'application Laravel. ID de secret au format `projects/PROJECT_ID/secrets/APP_KEY_SECRET_NAME`. |

> **Remarque :** contrairement à la plupart des modules, où `secret_ids` est transmis via `module_secret_env_vars` dans le `main.tf` de l'encapsulation, l'`APP_KEY` d'Invoice Ninja est câblée directement dans `InvoiceNinja Common`, dans le champ `config.secret_environment_variables`. L'encapsulation n'a pas besoin de gérer ce secret séparément.

### `storage_buckets` {#storage_buckets}
Une liste de configurations de buckets GCS à provisionner par le module de plateforme :

| Champ | Valeur |
|---|---|
| `name_suffix` | `"storage"` |
| `location` | Région du déploiement |
| `storage_class` | `"STANDARD"` |
| `versioning_enabled` | `false` |
| `lifecycle_rules` | `[]` |
| `public_access_prevention` | `"enforced"` |

### `path` {#path}
Le chemin absolu du répertoire du module, utilisé par les modules d'encapsulation pour localiser le répertoire `scripts/`.

---

## 3. Variables d'entrée {#3-input-variables}

### Application {#application}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `project_id` | `string` | — | ID du projet GCP. Requis pour la création des ressources Secret Manager. |
| `resource_prefix` | `string` | — | Préfixe utilisé pour nommer les ressources Secret Manager. |
| `application_name` | `string` | `"invoiceninja"` | Nom de l'application. Sert de base au nommage des ressources. |
| `display_name` | `string` | `"Invoice Ninja"` | Nom lisible de l'application. |
| `description` | `string` | `"Invoice Ninja open-source invoicing platform"` | Description transmise aux définitions des jobs d'initialisation. |
| `application_version` | `string` | `"5"` | Tag de l'image Docker Invoice Ninja. Incrémentez-le pour déployer une nouvelle version. |
| `tenant_id` | `string` | `"demo"` | Identifiant de déploiement ajouté aux noms de ressources. |
| `region` | `string` | `"us-central1"` | Région GCP de l'emplacement du bucket de stockage. |
| `db_name` | `string` | `"invoiceninja"` | Nom de la base de données MySQL. **Ne le modifiez pas après le déploiement initial.** |
| `db_user` | `string` | `"invoiceninja"` | Utilisateur applicatif MySQL. |
| `cpu_limit` | `string` | `"2000m"` | Limite de CPU du conteneur, transmise dans `config.container_resources`. |
| `memory_limit` | `string` | `"2Gi"` | Limite de mémoire du conteneur. 2 Gi minimum pour la génération de PDF par Chromium. |
| `min_instance_count` | `number` | `1` | Nombre minimal d'instances, transmis dans `config.min_instance_count`. |
| `max_instance_count` | `number` | `3` | Nombre maximal d'instances, transmis dans `config.max_instance_count`. |
| `environment_variables` | `map(string)` | `{}` | Variables d'environnement supplémentaires en clair. Fusionnées avec les valeurs par défaut d'Invoice Ninja. |
| `secret_environment_variables` | `map(string)` | `{}` | Références Secret Manager supplémentaires. Fusionnées avec la référence `APP_KEY` générée automatiquement. |
| `initialization_jobs` | `list(object)` | `[]` | Jobs d'initialisation personnalisés. Une liste vide déclenche la paire par défaut `db-init` + `artisan-migrate`. |
| `startup_probe` | `object` | voir le §6 | Configuration de la sonde de santé de démarrage. |
| `liveness_probe` | `object` | voir le §6 | Configuration de la sonde de santé de vivacité. |
| `invoiceninja_admin_email` | `string` | `"admin@example.com"` | Déclarée et transmise par les deux encapsulations, mais **actuellement non référencée** dans le `local.config` d'`InvoiceNinja_Common` — sans effet sur l'environnement déployé. Le premier compte administrateur d'Invoice Ninja est créé à la place via son propre assistant `/setup` intégré à l'application. |
| `mail_from_name` | `string` | `"Invoice Ninja"` | Nom d'affichage des e-mails sortants. |
| `mail_from_address` | `string` | `"ninja@example.com"` | Adresse e-mail de l'expéditeur des e-mails sortants. |

### Stockage et volumes {#storage--volumes}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloudsql_volume` | `bool` | `true` | Monte le socket du sidecar Cloud SQL Auth Proxy dans le conteneur. |
| `gcs_volumes` | `list(object)` | `[]` | Montages de volumes GCS Fuse : `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. |
| `labels` | `map(string)` | `{}` | Libellés à appliquer à toutes les ressources créées. |

---

## 4. Variables d'environnement injectées automatiquement {#4-auto-injected-environment-variables}

`InvoiceNinja Common` injecte automatiquement les variables d'environnement suivantes dans la configuration de l'application. Elles sont fusionnées avec une priorité **inférieure** à `var.environment_variables`, de sorte qu'un appelant de l'encapsulation (ou l'entrée `environment_variables` d'un utilisateur final) **peut** remplacer n'importe laquelle d'entre elles en fournissant la même clé.

| Variable | Valeur | Rôle |
|---|---|---|
| `APP_ENV` | `"production"` | Mode d'environnement Laravel. |
| `APP_DEBUG` | `"false"` | Désactive la sortie de débogage de Laravel en production. |
| `DB_CONNECTION` | `"mysql"` | Sélection du pilote de base de données Laravel. |
| `MAIL_MAILER` | `"smtp"` | Sélectionne le transport de messagerie SMTP. |
| `TRUSTED_PROXIES` | `"*"` | Nécessaire pour les en-têtes du proxy inverse de l'équilibreur de charge Cloud Run et GKE (X-Forwarded-For, X-Forwarded-Proto). Sans cela, Laravel génère des liens HTTP même lorsque le client accède via HTTPS. |
| `PDF_GENERATOR` | `"snappdf"` | Sélectionne le moteur de rendu PDF snappdf basé sur Chromium. |
| `SNAPPDF_EXECUTABLE_PATH` | `"/usr/local/bin/chrome"` | Chemin de l'exécutable Chromium embarqué dans le conteneur `invoiceninja/invoiceninja:5`. |
| `IN_USER_AGENT_SETTING` | `"1"` | Paramètre applicatif d'Invoice Ninja transmis sous forme de variable d'environnement. |
| `MAIL_FROM_NAME` | `var.mail_from_name` | Nom d'affichage des e-mails sortants d'Invoice Ninja. |
| `MAIL_FROM_ADDRESS` | `var.mail_from_address` | Adresse e-mail de l'expéditeur des e-mails sortants. |

La référence au secret `APP_KEY` est injectée via `secret_environment_variables` (et non `environment_variables`) — elle est résolue à l'exécution par Cloud Run ou Kubernetes depuis Secret Manager.

**Détection automatique à l'exécution dans `scripts/entrypoint.sh`.** Intégré à l'image sous `/usr/local/bin/platform-entrypoint.sh` (voir `scripts/Dockerfile`), ce point d'entrée s'exécute à chaque démarrage du conteneur — sur `InvoiceNinja_CloudRun` **comme** sur `InvoiceNinja_GKE`, puisque les deux sont construits à partir des mêmes scripts d'`InvoiceNinja_Common` — et effectue des correspondances supplémentaires au-delà du tableau ci-dessus :

- Fait correspondre `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`, injectées par la plateforme, à `APP_URL` lorsque `APP_URL` n'est pas déjà définie.
- **Détection automatique de `REQUIRE_HTTPS`.** Invoice Ninja force une redirection HTTPS sur `/` dès que `REQUIRE_HTTPS` est vrai (sa propre valeur par défaut). Le point d'entrée choisit selon le schéma de l'`APP_URL` résolue : `https://*` laisse `REQUIRE_HTTPS` à sa valeur par défaut sécurisée (`true`, via `${REQUIRE_HTTPS:-true}`), tandis que `http://*` définit `REQUIRE_HTTPS="${REQUIRE_HTTPS:-false}"`. Une variable d'environnement `REQUIRE_HTTPS` fournie explicitement par l'utilisateur l'emporte toujours sur l'une ou l'autre branche. Ce mécanisme existe précisément parce que **GKE** sert Invoice Ninja via une IP de LoadBalancer en HTTP brut, sans terminaison TLS — sans la détection automatique, la redirection forcée envoie `/` vers un écouteur `https://<ip>/` qui n'existe pas, de sorte que la page d'accueil ne se charge pas, alors que `/login` et `/dashboard` (atteints directement) fonctionnent correctement en HTTP. (Cloud Run résout toujours `APP_URL` en `https://`, cette branche est donc sans effet sur cette plateforme ; `InvoiceNinja_CloudRun/main.tf` code par ailleurs en dur `REQUIRE_HTTPS = "false"` dans sa propre fusion de variables d'environnement, quoi qu'il arrive, puisque Cloud Run termine TLS devant le conteneur.)
- Fait correspondre `DB_NAME`/`DB_USER` (convention de la plateforme) aux `DB_DATABASE`/`DB_USERNAME` attendues par Invoice Ninja et, lorsque `DB_HOST` est un chemin de socket Unix Cloud SQL, définit `DB_SOCKET` sur ce chemin et fait pointer `DB_HOST` vers `127.0.0.1` pour PDO.
- Câble `QUEUE_CONNECTION`/`CACHE_DRIVER`/`SESSION_DRIVER` sur `redis` lorsque `REDIS_HOST` est présente.

---

## 5. Jobs d'initialisation {#5-initialization-jobs}

Deux jobs sont provisionnés par défaut lorsque `initialization_jobs = []` :

### Job 1 : `db-init` {#job-1-db-init}

| Champ | Valeur |
|---|---|
| Image | `mysql:8.0-debian` |
| Script | `scripts/db-init.sh` |
| Secrets requis | `ROOT_PASSWORD` (root MySQL), `DB_PASSWORD` (utilisateur applicatif) |
| `execute_on_apply` | `true` |
| Délai d'expiration | 600 s, 1 nouvelle tentative |
| CPU / mémoire | `1000m` / `512Mi` |

Comportement de `db-init.sh` :
1. Se connecte à Cloud SQL MySQL via le transport vers lequel `DB_HOST` se résout : un chemin de socket Unix (Cloud Run, `enable_cloudsql_volume = true`) ou TCP via le sidecar Cloud SQL Auth Proxy (GKE, se rabat sur `DB_IP` si `DB_HOST` n'est pas défini).
2. Interroge MySQL jusqu'à ce qu'il soit disponible (jusqu'à 30 tentatives, à 2 s d'intervalle).
3. Crée la base de données `invoiceninja` avec le jeu de caractères `utf8mb4` et la collation `utf8mb4_0900_ai_ci` (requis pour la compatibilité de MySQL 8.0 avec Laravel).
4. Crée (ou met à jour) l'utilisateur `invoiceninja` avec une simple clause `IDENTIFIED BY`, qui utilise le plugin d'authentification par défaut du serveur (`caching_sha2_password` sur MySQL 8.4+, `mysql_native_password` sur 8.0). Le script évite délibérément d'épingler explicitement `mysql_native_password`, car ce plugin a été supprimé dans MySQL 8.4 (`ERROR 4052`).
5. Accorde `ALL PRIVILEGES` sur la base de données `invoiceninja`.
6. Vérifie que l'utilisateur applicatif peut se connecter.
7. Signale l'arrêt du Cloud SQL Proxy.

### Job 2 : `artisan-migrate` {#job-2-artisan-migrate}

| Champ | Valeur |
|---|---|
| Image | `null` — utilise par défaut l'image de conteneur de l'application elle-même (le `container_image`/la sortie de build de la configuration Common) |
| Script | `scripts/migrate.sh`, qui exécute `php artisan migrate --force` |
| `execute_on_apply` | `true` |
| `depends_on_jobs` | `["db-init"]` |
| Délai d'expiration | 600 s, 1 nouvelle tentative |
| CPU / mémoire | `1000m` / `1Gi` |

`artisan-migrate` exécute le système de migration de base de données de Laravel. Lors du premier déploiement, il crée toutes les tables d'Invoice Ninja. Lors des déploiements suivants, il applique les nouvelles migrations introduites par les mises à niveau de version d'Invoice Ninja. L'option `--force` supprime l'invite de confirmation interactive en mode production. **Il n'y a pas d'option `--seed`** — le job n'insère pas de données de démonstration/de référence ; l'assistant `/setup` de premier lancement d'Invoice Ninja se charge de la création initiale du compte.

Remplacez `initialization_jobs` par une liste non vide pour remplacer les deux jobs par défaut par des jobs personnalisés. Lorsque `initialization_jobs` n'est pas vide, `InvoiceNinja Common` n'injecte aucun des jobs par défaut.

---

## 6. Sondes de santé {#6-health-probes}

Toutes les sondes ciblent `GET /` (la page de connexion ou le tableau de bord d'Invoice Ninja, qui renvoie HTTP 200 lorsque l'application est entièrement prête). Invoice Ninja n'expose pas de point de terminaison `/healthz` dédié.

| Sonde | Délai initial | Délai d'expiration | Période | Seuil d'échec | Rôle |
|---|---|---|---|---|---|
| **Startup** (démarrage) | 90s | 10s | 15s | 30 | Laisse jusqu'à 540 s au total à Invoice Ninja pour terminer l'initialisation de PHP-FPM, la mise en cache de la configuration et les migrations de base de données au premier démarrage |
| **Liveness** (vivacité) | 120s | 10s | 30s | 3 | Redémarre le conteneur si Invoice Ninja ne répond plus après une séquence de démarrage complète |

Les seuils généreux de la sonde de démarrage tiennent compte du processus `artisan-migrate` d'Invoice Ninja, qui s'exécute de manière synchrone au premier démarrage lorsque `APP_ENV=production` et qu'aucun schéma existant n'est détecté.

**Comparaison avec les valeurs par défaut d'`App CloudRun`/`App GKE` :**

| Champ | App CloudRun | InvoiceNinja Common | Raison |
|---|---|---|---|
| `path` | `/healthz` | `/` | Invoice Ninja n'a pas de point de terminaison `/healthz`. |
| `initial_delay_seconds` de démarrage | `10` | `90` | PHP-FPM + amorçage de Laravel + migration éventuelle prennent 30 à 90 secondes. |
| `failure_threshold` de démarrage | `3` | `30` | 30 × 15 s = 450 s de tolérance supplémentaire après le délai de 90 s. |
| `initial_delay_seconds` de vivacité | `15` | `120` | Évite des échecs de vivacité prématurés avant la fin de la séquence de démarrage. |

---

## 7. Gestion du secret APP_KEY {#7-app_key-secret-management}

L'`APP_KEY` est la clé de chiffrement de l'application Laravel. Elle sert à chiffrer les cookies, les données de session et d'autres valeurs sensibles. Toutes les données chiffrées deviennent illisibles si la clé est modifiée ou perdue.

**Génération :** `InvoiceNinja Common` génère une valeur aléatoire cryptographique de 32 octets, l'encode en base64 et la stocke dans Secret Manager sous la forme `base64:<value>`. Ce format est requis par la façade `Crypt` de Laravel.

**Injection :** le secret `APP_KEY` est référencé dans `config.secret_environment_variables` sous la forme :

```
{ APP_KEY = "<secret-manager-secret-id>" }
```

Cloud Run et GKE résolvent cette référence au démarrage du conteneur, en injectant la valeur en clair comme variable d'environnement. La valeur en clair n'est jamais écrite dans l'état.

**Rotation :** l'`APP_KEY` est un secret généré une seule fois — il est créé lors du premier apply et n'est jamais renouvelé automatiquement. Modifier l'`APP_KEY` après le déploiement initial invalide toutes les sessions utilisateur existantes, les cookies chiffrés et toutes les données chiffrées avec l'ancienne clé. Ne renouvelez pas cette clé sans disposer d'un plan de migration pour rechiffrer les données existantes.

---

## 8. Différences propres à chaque plateforme {#8-platform-specific-differences}

| Aspect | InvoiceNinja CloudRun | InvoiceNinja GKE |
|---|---|---|
| `container_image_source` | `"prebuilt"` par défaut | `"prebuilt"` par défaut |
| `min_instance_count` | `1` (configurable) | `1` (configurable) |
| `max_instance_count` | `3` (configurable) | `5` (configurable) |
| `enable_cloudsql_volume` | Facultatif (par défaut `true`) | Facultatif (par défaut `true`) |
| `DB_HOST` à l'exécution | Chemin du socket Cloud SQL Auth Proxy sous `/cloudsql` | `127.0.0.1` — le sidecar Cloud SQL Auth Proxy du pod GKE écoute en loopback |
| Variables Redis | Groupe 21 | Groupe 15 |
| Affinité de session | Non applicable (Cloud Run gère le routage) | `"ClientIP"` par défaut — évite les pertes de session administrateur entre les réplicas de pods |
| NFS | Activé par défaut (`enable_nfs = true`) | Activé par défaut (`enable_nfs = true`) |

---

## 9. Modèle d'implémentation {#9-implementation-pattern}

```hcl
# Example: how InvoiceNinja_CloudRun instantiates InvoiceNinja_Common

module "invoiceninja_app" {
  source = "../InvoiceNinja_Common"

  project_id             = var.project_id
  resource_prefix        = local.resource_prefix
  application_version    = var.application_version
  db_name                = var.application_database_name
  db_user                = var.application_database_user
  cpu_limit              = var.cpu_limit
  memory_limit           = var.memory_limit
  description            = var.application_description
  startup_probe          = var.startup_probe
  liveness_probe         = var.liveness_probe
  enable_cloudsql_volume = var.enable_cloudsql_volume
  invoiceninja_admin_email = var.invoiceninja_admin_email
  mail_from_name         = var.mail_from_name
  mail_from_address      = var.mail_from_address
  environment_variables  = var.environment_variables
}

locals {
  application_modules    = { invoiceninja = module.invoiceninja_app.config }
  module_secret_env_vars = module.invoiceninja_app.secret_ids
  module_storage_buckets = module.invoiceninja_app.storage_buckets
  scripts_dir            = abspath("${module.invoiceninja_app.path}/scripts")
}

module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config          = local.application_modules
  module_secret_env_vars      = local.module_secret_env_vars
  module_storage_buckets      = local.module_storage_buckets
  scripts_dir                 = local.scripts_dir
  # ... other inputs
}
```

<!-- related-guides -->

## Guides associés {#related-guides}

- [Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Module Invoice Ninja GKE — Guide de configuration](InvoiceNinja_GKE.md) — cette configuration déployée sur GKE.
