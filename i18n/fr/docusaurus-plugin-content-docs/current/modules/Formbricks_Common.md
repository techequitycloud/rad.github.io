---
title: "Module de configuration partagée Formbricks Common"
description: "Référence de la configuration partagée du module Formbricks — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Formbricks_Common.md @ 3055034 sha256:d86fb3493115 -->

# Module de configuration partagée Formbricks Common {#formbricks-common-shared-configuration-module}

Le module `Formbricks Common` définit la configuration de la plateforme d'enquêtes Formbricks pour l'écosystème RAD Modules. Il s'agit d'un **module de configuration applicative partagée** : il crée des identifiants HMAC GCS, provisionne des secrets dans Secret Manager et produit les sorties `config`, `secret_ids` et `storage_buckets` consommées par les modules wrapper propres à chaque plateforme (`Formbricks CloudRun` et `Formbricks GKE`).

## 1. Vue d'ensemble {#1-overview}

**Objectif** : centraliser toute la configuration propre à Formbricks (image de conteneur, configuration de la base de données PostgreSQL, secrets applicatifs générés automatiquement, câblage du stockage compatible S3 sur GCS, mappage des variables d'environnement, sondes de santé et définition du job `db-init`) dans un module unique partagé par les déploiements Cloud Run et GKE.

**Architecture** :

```
Layer 3: Application Wrappers
├── Formbricks_CloudRun  ──┐
└── Formbricks_GKE       ──┤── instantiate Formbricks_Common
                            ↓
               Formbricks_Common (this module)
               Creates: Secret Manager secrets, GCS HMAC key
               Produces: config, secret_ids, storage_buckets
                            ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                            ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Caractéristiques clés** :
- Utilise **PostgreSQL 15**, comme tous les autres modules de cet écosystème, à l'exception de Ghost (qui nécessite MySQL 8.0).
- **Crée des secrets Secret Manager** — contrairement à Ghost Common (qui n'en crée aucun), Formbricks Common génère automatiquement `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `HUB_API_KEY`, `CUBEJS_API_SECRET`, ainsi que des identifiants HMAC GCS (`S3_ACCESS_KEY`, `S3_SECRET_KEY`). Les secrets SMTP et Redis sont provisionnés de manière conditionnelle selon la configuration.
- Provisionne un **bucket GCS `uploads`** et configure Formbricks pour utiliser l'API XML compatible S3 de GCS, avec une authentification HMAC, pour le stockage des fichiers.
- Expose un **point de terminaison de santé dédié** sur `/api/v2/health` — une route native de Formbricks qui reflète à la fois la disponibilité de l'application et la connectivité active à la base de données.
- Le job `db-init` crée la base de données et l'utilisateur PostgreSQL à l'aide du client PostgreSQL standard, avant que les migrations Prisma de Formbricks ne s'exécutent au démarrage du conteneur.

---

## 2. Sorties {#2-outputs}

### `config` {#config}

L'objet de configuration applicative transmis au module de plateforme via `application_config`.

| Champ | Valeur / Description |
|---|---|
| `app_name` | `"formbricks"` |
| `application_version` | Tag de version (par défaut : `"latest"`) |
| `container_image` | `"ghcr.io/formbricks/formbricks"` (image amont de GitHub Container Registry) |
| `image_source` | `"custom"` — une image wrapper personnalisée est construite via Cloud Build |
| `container_port` | `3000` |
| `database_type` | `var.database_type` (valeur par défaut du module `"POSTGRES"` ; les deux wrappers transmettent `"POSTGRES_15"`) |
| `db_name` | Nom de la base de données (par défaut : `"formbricks"`) |
| `db_user` | Utilisateur de la base de données (par défaut : `"formbricks"`) |
| `enable_cloudsql_volume` | `var.enable_cloudsql_volume` (par défaut `true`) — connexion via le volume/sidecar du Cloud SQL Auth Proxy |
| `environment_variables` | Variables d'environnement propres à Formbricks : `STORAGE_PROVIDER`, `S3_ENDPOINT_URL`, `S3_BUCKET_NAME`, `NEXTAUTH_URL`, `WEBAPP_URL`, `HUB_API_URL`, `CUBEJS_API_URL`, et les variables SMTP lorsqu'elles sont configurées |
| `container_resources` | CPU `var.cpu_limit` (valeur par défaut du module `"1000m"`), mémoire `var.memory_limit` (valeur par défaut du module `"1Gi"`) ; les wrappers transmettent `1000m`/`2Gi` (Cloud Run) ou `2000m`/`2Gi` (GKE) |
| `initialization_jobs` | Job `db-init` par défaut (PostgreSQL) ou remplacement personnalisé |
| `startup_probe` | HTTP `GET /api/v2/health`, délai initial de 30 s, délai d'expiration de 10 s, période de 15 s, seuil d'échec de 20 |
| `liveness_probe` | HTTP `GET /api/v2/health`, délai initial de 60 s, délai d'expiration de 5 s, période de 30 s, seuil d'échec de 3 |

### `secret_ids` {#secret_ids}

Une table de correspondance entre noms de variables d'environnement et ID de secrets Secret Manager. Elle est transmise sous la forme `module_secret_env_vars` au module socle, qui les injecte comme variables d'environnement secrètes à l'exécution. Les valeurs en clair ne sont jamais accessibles via le fichier d'état.

| Variable d'environnement | Secret | Condition |
|---|---|---|
| `NEXTAUTH_SECRET` | `<prefix>-nextauth-secret` | Toujours |
| `ENCRYPTION_KEY` | `<prefix>-encryption-key` | Toujours |
| `CRON_SECRET` | `<prefix>-cron-secret` | Toujours |
| `HUB_API_KEY` | `<prefix>-hub-api-key` | Toujours |
| `CUBEJS_API_SECRET` | `<prefix>-cubejs-api-secret` | Toujours |
| `S3_ACCESS_KEY` | `<prefix>-s3-access-key` | Toujours — clé d'accès HMAC GCS |
| `S3_SECRET_KEY` | `<prefix>-s3-secret-key` | Toujours — clé secrète HMAC GCS |
| `SMTP_PASSWORD` | `<prefix>-smtp-password` | Uniquement lorsque `smtp_host` est configuré |
| `REDIS_URL` | `<prefix>-redis-url` | Uniquement lorsque `enable_redis = true` et que `redis_auth` n'est pas vide |

Le `<prefix>` est construit à partir du nom de l'application et de l'ID de déploiement (par exemple, `formbricks-demo`).

### `storage_buckets` {#storage_buckets}

Une liste de configurations de buckets GCS à provisionner par le module de plateforme :

| Champ | Valeur |
|---|---|
| `name_suffix` | `"uploads"` |
| `location` | Région du déploiement |
| `storage_class` | `"STANDARD"` |
| `force_destroy` | `true` |
| `uniform_bucket_level_access` | `true` |
| `cors` | Autorise `GET`/`PUT`/`POST`/`DELETE`/`HEAD` depuis n'importe quelle origine (`*`), durée maximale de 3600 s — requis pour le flux de téléversement S3 depuis le navigateur |

---

## 3. Stockage GCS compatible S3 {#3-gcs-s3-compatible-storage}

Formbricks utilise le protocole de l'API S3 pour les téléversements de fichiers (pièces jointes des réponses aux enquêtes, images, ressources personnalisées). Sur GCP, ce besoin est couvert par l'API XML de GCS associée à des identifiants HMAC.

**Fonctionnement :**

1. `Formbricks Common` crée une clé HMAC GCS pour le compte de service Cloud Run / GKE.
2. La clé d'accès et la clé secrète HMAC sont stockées dans Secret Manager sous les noms `S3_ACCESS_KEY` et `S3_SECRET_KEY`.
3. Les variables d'environnement suivantes sont injectées dans le conteneur Formbricks :
   - `STORAGE_PROVIDER=s3` — indique à Formbricks d'utiliser le pilote de stockage S3.
   - `S3_ENDPOINT_URL=https://storage.googleapis.com` — dirige le client S3 vers GCS.
   - `S3_BUCKET_NAME` — le nom du bucket GCS `uploads` provisionné automatiquement.
   - `S3_ACCESS_KEY` et `S3_SECRET_KEY` — injectées comme variables d'environnement secrètes à l'exécution.
4. Formbricks téléverse et récupère les fichiers via des appels standard du SDK S3, servis de manière transparente par GCS.

Cette approche est transparente pour Formbricks — aucune modification de code ni aucun plugin n'est nécessaire. Tout client compatible S3 pouvant être dirigé vers un point de terminaison personnalisé fonctionne de la même manière.

---

## 4. Variables d'entrée {#4-input-variables}

### Application {#application}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `application_name` | `string` | `"formbricks"` | Nom de l'application. Utilisé comme préfixe de tous les noms de ressources. |
| `application_version` | `string` | `"latest"` | Tag de l'image Docker Formbricks. |
| `description` | `string` | `"Formbricks - Open Source Survey & Experience Management"` | Description du job d'initialisation et du service. |
| `tenant_id` | `string` | `"demo"` | Identifiant de déploiement du locataire utilisé dans le nommage des ressources. |
| `resource_prefix` / `deployment_id_suffix` | `string` | `""` | Remplacements de nommage fournis par les modules wrapper. |
| `db_name` | `string` | `"formbricks"` | Nom de la base de données PostgreSQL. |
| `db_user` | `string` | `"formbricks"` | Utilisateur applicatif PostgreSQL. |
| `cpu_limit` | `string` | `"1000m"` | Limite de CPU du conteneur. |
| `memory_limit` | `string` | `"1Gi"` | Limite de mémoire du conteneur (les wrappers transmettent `2Gi`). |
| `min_instance_count` | `number` | `1` | Nombre minimal d'instances (les wrappers transmettent `0`). |
| `max_instance_count` | `number` | `10` | Nombre maximal d'instances (les wrappers transmettent `1`/`3`). |
| `webapp_url` | `string` | `""` | URL publique de l'instance Formbricks. Injectée sous la forme `NEXTAUTH_URL` et `WEBAPP_URL`. Laissez-la vide lors du premier déploiement ; mettez-la à jour une fois l'URL du service connue. |
| `initialization_jobs` | `list(object)` | `[]` | Jobs d'initialisation personnalisés. Une liste vide déclenche le job `db-init` par défaut. |
| `startup_probe` | `object` | Voir §5 | Sonde de santé de démarrage ciblant `/api/v2/health`. |
| `liveness_probe` | `object` | Voir §5 | Sonde de santé de vivacité ciblant `/api/v2/health`. |
| `enable_image_mirroring` | `bool` | `true` | Met en miroir l'image Formbricks dans Artifact Registry avant le déploiement. |

### E-mail (SMTP) {#email-smtp}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `smtp_host` | `string` | `""` | Nom d'hôte du serveur SMTP. S'il est vide, aucun secret `SMTP_PASSWORD` n'est créé. |
| `smtp_port` | `number` | `587` | Port SMTP. |
| `smtp_user` | `string` | `""` | Nom d'utilisateur d'authentification SMTP. |
| `smtp_password` | `string` | `""` | Mot de passe SMTP. Généré automatiquement et stocké dans Secret Manager s'il est vide. Sensible. |
| `smtp_secure_enabled` | `bool` | `false` | Active le TLS implicite (`true` pour le port 465). |
| `mail_from` | `string` | `""` | Adresse d'expéditeur des e-mails sortants de Formbricks. |

### Redis {#redis}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_redis` | `bool` | `true` | Lorsque `true`, un secret `REDIS_URL` est créé si `redis_auth` n'est pas vide. |
| `redis_host` | `string` | `""` | Nom d'hôte ou IP du serveur Redis. |
| `redis_port` | `string` | `"6379"` | Port Redis. |
| `redis_auth` | `string` | `""` | Mot de passe Redis AUTH. Sensible. |

### Formbricks Hub et Cube.js {#formbricks-hub--cubejs}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `hub_api_url` | `string` | `"http://localhost:8080"` | URL de l'API Formbricks Hub. Injectée sous la forme `HUB_API_URL`. |
| `cubejs_api_url` | `string` | `"http://localhost:4000"` | URL de l'API d'analytique Cube.js. Injectée sous la forme `CUBEJS_API_URL`. |

### Stockage et volumes {#storage--volumes}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloudsql_volume` | `bool` | `true` | Monte le volume/sidecar du Cloud SQL Auth Proxy. |
| `gcs_volumes` | `list(object)` | `[]` | Montages de volumes GCS Fuse (name, bucket_name, mount_path, readonly, mount_options). |
| `region` | `string` | `"us-central1"` | Région du bucket de stockage `uploads`. |

---

## 5. Sondes de santé {#5-health-probes}

Formbricks expose `/api/v2/health` — un point de terminaison d'API dédié qui ne renvoie `HTTP 200` que lorsque l'application Next.js est en cours d'exécution et que la connexion à la base de données PostgreSQL est active. Les deux types de sondes ciblent ce point de terminaison.

| Sonde | Délai initial | Délai d'expiration | Période | Seuil d'échec | Objectif |
|---|---|---|---|---|---|
| **Startup** | 30s | 10s | 15s | 20 | Accorde jusqu'à 330 s au total à Formbricks pour exécuter les migrations Prisma et s'initialiser au premier démarrage |
| **Liveness** | 60s | 5s | 30s | 3 | Redémarre le conteneur si Formbricks ne répond plus ou perd sa connexion à la base de données |

Notez que les wrappers de plateforme remplacent ces valeurs par défaut de Common : `Formbricks_CloudRun`
remplace la sonde de démarrage par une sonde de port **TCP** (le point de terminaison HTTP ne renvoie
un code 2xx qu'à disponibilité complète, ce qui bloquait la création du service) et livre sa sonde de vivacité
**désactivée** (`enabled = false`) — la vivacité Cloud Run ne peut pas utiliser de socket TCP et le
point de terminaison HTTP provoquerait une boucle de redémarrage d'un conteneur sain. `Formbricks_GKE` conserve les deux sondes HTTP
sur `/api/v2/health`.

Les seuils de la sonde de démarrage tiennent compte du processus de migration du schéma de base de données de Prisma, qui s'exécute automatiquement à chaque démarrage du conteneur et peut être lent au premier démarrage sur une base de données vierge.

**Comparaison avec d'autres modules :**

| Module | Point de terminaison de santé | Délai initial au démarrage | Raison |
|---|---|---|---|
| Formbricks | `/api/v2/health` | 30s | Les migrations Prisma sont rapides ; la compilation Next.js est effectuée en amont |
| Ghost | `/` | 90s | Ghost compile les thèmes et exécute les migrations de schéma au démarrage |
| Django | `/healthz` | 60s | Le démarrage de Django est léger ; le délai couvre les migrations du premier démarrage |

---

## 6. Job d'initialisation {#6-initialization-job}

Un job `db-init` s'exécute par défaut (lorsque `initialization_jobs = []`) :

| Champ | Valeur |
|---|---|
| Image | `postgres:15-alpine` |
| Script | `scripts/formbricks/db-init.sh` |
| Secrets requis | `ROOT_PASSWORD` (superutilisateur PostgreSQL, requis pour se connecter) |
| `execute_on_apply` | `true` |
| Délai d'expiration | 600 s, jusqu'à 3 nouvelles tentatives |

`db-init.sh` effectue les opérations idempotentes suivantes :

1. Résout l'hôte cible : privilégie `DB_IP` lorsqu'il est défini, sinon se rabat sur `DB_HOST` ; force `DB_HOST=127.0.0.1` (et supprime `DB_IP`) lorsque `DB_SSL=false` et que `DB_HOST` n'est pas déjà un chemin de socket, afin qu'une connexion sans SSL passe par le sidecar local du Cloud SQL Auth Proxy.
2. Attend indéfiniment (boucle de nouvelles tentatives non bornée, à 2 secondes d'intervalle) que PostgreSQL accepte une connexion en tant que `postgres` avec `ROOT_PASSWORD`.
3. Crée le rôle `$DB_USER` s'il n'existe pas (ou met à jour son mot de passe s'il existe), lui accorde `CREATEDB`, accorde ce rôle à `postgres` et lui accorde tous les privilèges sur la base de données `postgres`.
4. Crée la base de données `$DB_NAME` appartenant à `$DB_USER` si elle n'existe pas, ou réattribue sa propriété si elle existe.
5. Accorde tous les privilèges sur la base de données et sur le schéma `public` à `$DB_USER`.
6. Signale au sidecar du Cloud SQL Auth Proxy de s'arrêter via `POST http://localhost:9091/quitquitquit` (jusqu'à 30 tentatives, à 2 secondes d'intervalle).

Les migrations Prisma de Formbricks s'exécutent ensuite automatiquement au démarrage du conteneur — le job `db-init` garantit seulement que la base de données et l'utilisateur existent avant que Prisma ne tente de se connecter.

---

## 7. Cycle de vie des secrets {#7-secrets-lifecycle}

Contrairement à Ghost Common (qui ne crée aucun secret), Formbricks Common crée et gère tous les secrets au niveau de l'application :

**Secrets toujours créés :**
- `NEXTAUTH_SECRET` — chaîne aléatoire cryptographique de 32 caractères. Utilisée par NextAuth.js pour signer et chiffrer les jetons de session JWT. Régénérer cette valeur invalide toutes les sessions utilisateur actives.
- `ENCRYPTION_KEY` — clé de chiffrement des données Formbricks. Sert à chiffrer au repos, au sein de l'application, les données sensibles des réponses aux enquêtes.
- `CRON_SECRET` — jeton transmis par Cloud Scheduler au point de terminaison cron de Formbricks pour authentifier les jobs planifiés. Doit rester confidentiel.
- `HUB_API_KEY` — clé API pour l'authentification auprès du service Formbricks Hub (utilisé à partir de la v5).
- `CUBEJS_API_SECRET` — secret de signature JWT pour l'authentification à l'API d'analytique Cube.js.
- `S3_ACCESS_KEY` — clé d'accès HMAC GCS. Générée à partir du compte de service Cloud Run / GKE et utilisée par le client S3 de Formbricks pour authentifier les requêtes de téléversement de fichiers vers GCS.
- `S3_SECRET_KEY` — clé secrète HMAC GCS. La paire de clés HMAC est créée une seule fois ; une rotation nécessite un nouveau provisionnement.

**Secrets créés de manière conditionnelle :**
- `SMTP_PASSWORD` — créé et stocké dans Secret Manager uniquement lorsque `smtp_host` n'est pas vide. Si `smtp_password` est laissé vide, une valeur aléatoire générée automatiquement est stockée — utile pour les comptes qui exigent un mot de passe SMTP mais dont la valeur est gérée en externe.
- `REDIS_URL` — créé uniquement lorsque `enable_redis = true` et que `redis_auth` n'est pas vide. Contient l'URL complète `redis://:password@host:port`.

**Valeur de repli fictive pour `SMTP_USER` (variable d'environnement en clair, pas un secret) :** Formbricks valide `SMTP_USER` comme une chaîne non vide (`z.string().min(1)`) dès que `smtp_host` est configuré — un `smtp_user` vide associé à un `smtp_host` non vide fait sinon échouer la validation Zod au démarrage (« Invalid environment variables » → le serveur ne démarre jamais). `main.tf` attribue par défaut à `SMTP_USER` la valeur `"noreply@formbricks.local"` lorsque `smtp_host` est défini mais que `smtp_user` est laissé vide, afin que l'application démarre toujours ; les opérateurs remplacent `smtp_user` par de véritables identifiants pour réellement envoyer des e-mails. Ce mécanisme reprend le modèle de secret conditionnel de `SMTP_PASSWORD`, mais sous forme de variable d'environnement en clair (non secrète). Dans ce même cas de configuration partielle, `EMAIL_VERIFICATION_DISABLED` est défini à `"1"` (e-mails de vérification désactivés) — il n'est défini à `"0"` (vérification activée) que lorsque `smtp_host` et `smtp_user` sont tous deux non vides, car un `SMTP_USER` fictif ne dispose d'aucun identifiant SMTP fonctionnel pour réellement envoyer les e-mails de vérification.

**Rotation des secrets :** aucun de ces secrets propres à Formbricks ne comporte de bloc `rotation` — ils sont créés une seule fois comme versions statiques de secrets Secret Manager, sans rotation automatique ni notification Pub/Sub. En faire tourner un (par exemple `NEXTAUTH_SECRET`, pour invalider toutes les sessions) nécessite de créer manuellement une nouvelle version du secret et de redémarrer le conteneur. Seul `DB_PASSWORD` (géré par le module socle, en dehors de `Formbricks Common`) prend en charge la rotation automatisée lorsque `enable_auto_password_rotation = true`.

---

## 8. Différences propres à chaque plateforme {#8-platform-specific-differences}

| Aspect | Formbricks CloudRun | Formbricks GKE |
|---|---|---|
| `enable_cloudsql_volume` | `true` (volume Cloud SQL natif — socket Unix sous `/cloudsql`) | `true` (sidecar Auth Proxy sur `127.0.0.1`) |
| `min_instance_count` | `0` (mise à l'échelle à zéro) | `0` (mise à l'échelle à zéro ; HPA Kubernetes) |
| `max_instance_count` | `1` (configurable) | `3` (configurable ; maxReplicas du HPA) |
| `cpu_limit` | `"1000m"` par défaut | `"2000m"` par défaut |
| `memory_limit` | `"2Gi"` par défaut | `"2Gi"` par défaut |
| NFS | Activé par défaut (`enable_nfs = true`) | Activé par défaut (`enable_nfs = true`) |
| Redis | Activé par défaut (`enable_redis = true`) | Activé par défaut (`enable_redis = true`) |
| Affinité de session | Sans objet (Cloud Run achemine par révision) | `ClientIP` — requis pour des sessions d'administration stables |
| Sonde de démarrage | Sonde de port **TCP**, délai initial de 30 s (HTTP `/api/v2/health` ne renvoie un code 2xx qu'à disponibilité complète) | HTTP `/api/v2/health`, délai initial de 0 s, budget de 10 × 30 s |
| Sonde de vivacité | **Désactivée** (`enabled = false`) — provoquerait une boucle de redémarrage d'un conteneur sain | HTTP `/api/v2/health`, délai initial de 60 s |

---

## 9. Modèle d'implémentation {#9-implementation-pattern}

```hcl
# Example: how Formbricks_CloudRun instantiates Formbricks_Common

module "formbricks_app" {
  source = "../Formbricks_Common"

  application_name    = var.application_name
  application_version = var.application_version
  tenant_id = var.tenant_id
  db_name             = var.db_name
  db_user             = var.db_user
  cpu_limit           = var.cpu_limit
  memory_limit        = var.memory_limit
  description         = var.description
  startup_probe       = var.startup_probe
  liveness_probe      = var.liveness_probe
  webapp_url          = var.webapp_url
  smtp_host           = var.smtp_host
  smtp_port           = var.smtp_port
  smtp_user           = var.smtp_user
  smtp_password       = var.smtp_password
  smtp_secure_enabled = var.smtp_secure_enabled
  mail_from           = var.mail_from
  enable_redis        = var.enable_redis
  redis_host          = var.redis_host
  redis_port          = var.redis_port
  redis_auth          = var.redis_auth
  hub_api_url         = var.hub_api_url
  cubejs_api_url      = var.cubejs_api_url
  enable_image_mirroring = var.enable_image_mirroring
}

# The four locals consumed by App_CloudRun
locals {
  application_modules    = { formbricks = module.formbricks_app.config }
  module_env_vars        = {}
  module_secret_env_vars = module.formbricks_app.secret_ids
  module_storage_buckets = module.formbricks_app.storage_buckets
  scripts_dir            = abspath("${path.module}/../Formbricks_Common/scripts")
}

module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config     = local.application_modules
  module_secret_env_vars = local.module_secret_env_vars
  module_storage_buckets = local.module_storage_buckets
  scripts_dir            = local.scripts_dir
  # ... all other variables forwarded from var.*
}
```

<!-- related-guides -->

## Guides associés {#related-guides}

- [Formbricks sur Google Cloud Run](Formbricks_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Module Formbricks GKE — Guide de configuration](Formbricks_GKE.md) — cette configuration déployée sur GKE.
