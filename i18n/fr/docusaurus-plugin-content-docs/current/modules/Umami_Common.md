---
title: "Module de configuration partagée Umami Common"
description: "Référence de la configuration partagée du module Umami — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Umami_Common.md @ 3055034 sha256:a6489b5a3985 -->

# Module de configuration partagée Umami Common {#umami-common-shared-configuration-module}

Le module `Umami Common` définit la configuration de la plateforme d'analyse Umami pour l'écosystème RAD Modules. Il s'agit d'un **module de configuration et de secrets partagé** : il crée des secrets Secret Manager et produit une sortie `config` utilisée par les modules wrappers propres à chaque plateforme (`Umami CloudRun` et `Umami GKE`).

## 1. Vue d'ensemble {#1-overview}

**Objectif** : centraliser toute la configuration propre à Umami (image de conteneur, configuration de la base de données PostgreSQL, correspondance des variables d'environnement, sondes de santé, secret applicatif et job d'initialisation) dans un module unique partagé par les déploiements Cloud Run et GKE.

**Architecture** :

```
Layer 3: Application Wrappers
├── Umami_CloudRun  ──┐
└── Umami_GKE       ──┤── instantiate Umami_Common
                      ↓
           Umami_Common (this module)
           Creates: Secret Manager secret (APP_SECRET)
           Produces: config, secret_ids, storage_buckets, path
                      ↓
Layer 2: Platform Modules
├── App_CloudRun  (serverless deployment)
└── App_GKE       (Kubernetes deployment)
                      ↓
Layer 1: App_Common (networking, database, storage, secrets, IAM)
```

**Caractéristiques principales** :
- Génère un secret Secret Manager : `APP_SECRET` (injecté comme variable d'environnement `APP_SECRET`) — la clé secrète de l'application Next.js utilisée par Umami pour la signature des sessions et la sécurité.
- **Service d'analyse sans état** : Umami stocke toutes ses données dans PostgreSQL. Aucun bucket de stockage GCS n'est provisionné.
- **Aucun Redis requis** : Umami n'utilise que PostgreSQL. `storage_buckets` renvoie une liste vide.
- **Point de terminaison de santé `/api/heartbeat`** : toutes les sondes ciblent le point de terminaison heartbeat intégré d'Umami plutôt qu'un chemin racine générique.
- Les migrations de base de données sont exécutées automatiquement par Umami lui-même au démarrage du conteneur via Prisma — le job `db-init` se contente de pré-créer la base de données et l'utilisateur.

---

## 2. Sorties {#2-outputs}

### `config` {#config}
L'objet de configuration de l'application transmis au module de plateforme via `application_config`.

| Champ | Valeur / Description |
|---|---|
| `app_name` | `"umami"` |
| `application_version` | Tag de version (par défaut : `"postgresql-latest"`) |
| `container_image` | `"ghcr.io/umami-software/umami"` (image source de GitHub Container Registry) |
| `image_source` | `"custom"` — une image wrapper est construite via Cloud Build pour faire correspondre les variables DB_* à `DATABASE_URL` |
| `enable_image_mirroring` | `true` (codé en dur) — met en miroir l'image de GitHub Container Registry vers Artifact Registry |
| `container_build_config` | `dockerfile_path = "Dockerfile"`, `context_path = "."`, `build_args = { UMAMI_VERSION = <version> }` |
| `container_port` | `3000` |
| `database_type` | `"POSTGRES_15"` — Umami nécessite PostgreSQL |
| `db_name` | Nom de la base de données (par défaut : `"umami"`) |
| `db_user` | Utilisateur de la base de données (par défaut : `"umami"`) |
| `enable_cloudsql_volume` | Indique s'il faut monter l'instance Cloud SQL comme volume de socket Unix (par défaut : `true`) — intégration native du socket sur Cloud Run, sidecar `cloud-sql-proxy` sur GKE |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `container_resources` | CPU : `1000m`, mémoire : `512Mi` — Umami est léger |
| `min_instance_count` | `var.min_instance_count` (par défaut `1`) |
| `max_instance_count` | `var.max_instance_count` (par défaut `10`) |
| `environment_variables` | Transmises telles quelles depuis `var.environment_variables` |
| `initialization_jobs` | Job `db-init` par défaut (lorsque `var.initialization_jobs = []`), ou la liste fournie par l'utilisateur |
| `startup_probe` | HTTP `GET /api/heartbeat`, délai initial de 30 s, délai d'expiration de 10 s, période de 10 s, seuil d'échec de 30 |
| `liveness_probe` | HTTP `GET /api/heartbeat`, délai initial de 30 s, délai d'expiration de 10 s, période de 30 s, seuil d'échec de 3 |

### `secret_ids` {#secret_ids}
Map associant les noms de variables d'environnement aux ID de secrets Secret Manager :

```hcl
{
  APP_SECRET = "secret-<tenant_resource_prefix>-<application_name>-app-secret"
}
```

Cette map est transmise directement comme `module_secret_env_vars` au module socle et injectée dans le conteneur à l'exécution sous le nom `APP_SECRET`.

### `storage_buckets` {#storage_buckets}
Renvoie une liste vide `[]`. Umami est un service d'analyse sans état — toutes les données résident dans PostgreSQL. Aucun bucket de stockage applicatif dédié n'est provisionné.

### `path` {#path}
Le chemin absolu du répertoire du module, utilisé par les modules wrappers pour localiser le répertoire `scripts/`.

---

## 3. Secret créé {#3-secret-created}

| Modèle d'ID de secret | Description |
|---|---|
| `secret-<tenant_resource_prefix>-<application_name>-app-secret` | `APP_SECRET` alphanumérique de 32 caractères pour Umami (sans caractères spéciaux). Injecté sous le nom `APP_SECRET`. |

Le secret est créé avec `replication { auto {} }` (réplication multirégionale automatique). Une attente de propagation est insérée après la création pour éviter les situations de concurrence lorsque le service Cloud Run ou le pod GKE lit le secret pour la première fois au démarrage.

---

## 4. Variables d'entrée {#4-input-variables}

### Application {#application}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `project_id` | `string` | — | ID du projet GCP. **Obligatoire.** |
| `application_name` | `string` | `"umami"` | Nom de l'application. Sert de nom de base pour les ressources. |
| `application_version` | `string` | `"postgresql-latest"` | Tag de l'image Umami. Doit être un tag préfixé par `postgresql-`. |
| `display_name` | `string` | `"Umami"` | Nom d'affichage lisible. |
| `description` | `string` | `"Umami - Privacy-focused web analytics"` | Description de l'application. |
| `tenant_id` | `string` | `"demo"` | Identifiant unique de l'environnement de déploiement. Utilisé dans les ID de secrets. |
| `resource_labels` | `map(string)` | `{}` | Libellés communs à appliquer à toutes les ressources. |
| `db_name` | `string` | `"umami"` | Nom de la base de données PostgreSQL. |
| `db_user` | `string` | `"umami"` | Utilisateur applicatif PostgreSQL. |
| `cpu_limit` | `string` | `"1000m"` | Limite de CPU du conteneur incluse dans la sortie `config`. |
| `memory_limit` | `string` | `"512Mi"` | Limite de mémoire du conteneur incluse dans la sortie `config`. |
| `environment_variables` | `map(string)` | `{}` | Variables d'environnement supplémentaires transmises directement au conteneur. |
| `initialization_jobs` | `list(any)` | `[]` | Jobs d'initialisation personnalisés. Une liste vide déclenche le job `db-init` par défaut. |
| `startup_probe` | `object` | (voir §5) | Configuration de la sonde de santé de démarrage. |
| `liveness_probe` | `object` | (voir §5) | Configuration de la sonde de santé de vivacité (liveness). |
| `min_instance_count` | `number` | `1` | Nombre minimal d'instances en cours d'exécution. |
| `max_instance_count` | `number` | `10` | Nombre maximal d'instances en cours d'exécution. |

### Stockage et volumes {#storage--volumes}

| Variable | Type | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloudsql_volume` | `bool` | `true` | Monte le socket Unix de l'instance Cloud SQL (intégration native sur Cloud Run ; sidecar `cloud-sql-proxy` sur GKE). |
| `region` | `string` | `"us-central1"` | Région GCP (utilisée comme emplacement du bucket si un stockage était provisionné). |

---

## 5. Sondes de santé {#5-health-probes}

Umami expose `/api/heartbeat` comme point de terminaison de santé dédié. Ce point de terminaison renvoie HTTP 200 lorsqu'Umami est entièrement initialisé et connecté à PostgreSQL.

| Sonde | Chemin | Délai initial | Délai d'expiration | Période | Seuil d'échec | Rôle |
|---|---|---|---|---|---|---|
| **Startup** | `/api/heartbeat` | 30s | 10s | 10s | 30 | Laisse jusqu'à 5 minutes au total à Umami pour démarrer et exécuter les migrations Prisma sur une base de données neuve |
| **Liveness** | `/api/heartbeat` | 30s | 10s | 30s | 3 | Redémarre le conteneur si Umami ne répond plus |

Le `failure_threshold` élevé de la sonde de démarrage (30 × 10 s = 300 s après le délai initial) tient compte du provisionnement d'une base de données neuve, où les migrations Prisma doivent s'exécuter et appliquer l'intégralité du schéma Umami. Les redémarrages suivants sont plus rapides, car les migrations sont déjà appliquées.

Umami expose `/api/heartbeat` spécifiquement pour les contrôles de santé — utilisez ce chemin plutôt que le chemin racine générique `/` pour configurer les sondes.

---

## 6. Job d'initialisation {#6-initialization-job}

Un job `db-init` s'exécute par défaut (lorsque `initialization_jobs = []`) :

| Champ | Valeur |
|---|---|
| Image | `postgres:15-alpine` |
| Script | `scripts/create-db-and-user.sh` |
| Secrets requis | `DB_PASSWORD` (mot de passe de l'utilisateur applicatif), `ROOT_PASSWORD` (superutilisateur postgres) |
| `execute_on_apply` | `true` |
| Délai d'expiration | 600 s, 1 nouvelle tentative |

Comportement de `create-db-and-user.sh` :
1. Se connecte à Cloud SQL PostgreSQL via le socket Unix monté (`-h <socket-dir>`, en s'appuyant sur la prise en charge native des répertoires de socket par `psql` — aucun sidecar Auth Proxy sur Cloud Run).
2. Crée l'utilisateur de base de données `umami` avec le mot de passe issu de Secret Manager.
3. Crée la base de données `umami` si elle n'existe pas.
4. Accorde à l'utilisateur `umami` tous les privilèges sur la base de données.

**Remarque :** Umami exécute ses propres migrations de base de données basées sur Prisma au démarrage du conteneur. Le job `db-init` se contente de pré-créer la base de données vide et l'utilisateur — Umami remplit lui-même le schéma. Cela signifie que le job `db-init` doit se terminer avec succès avant le démarrage du conteneur Umami.

---

## 7. Scripts et image de conteneur {#7-scripts-and-container-image}

Tous les fichiers associés se trouvent dans `scripts/`. Le répertoire `scripts/` sert de contexte de build Docker lorsque `container_image_source = "custom"`.

### `Dockerfile` {#dockerfile}
Encapsule l'image officielle `ghcr.io/umami-software/umami:<version>` :
- Accepte `UMAMI_VERSION` comme argument de build.
- Copie un script de point d'entrée personnalisé qui assemble `DATABASE_URL` à partir des variables d'environnement DB_* injectées par la plateforme.
- Expose le port `3000`.

### Point d'entrée {#entrypoint}
Le point d'entrée personnalisé s'exécute avant le processus Umami pour :

1. **Construire `DATABASE_URL`** : assemble la chaîne de connexion PostgreSQL à partir de `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` et `DB_NAME` — les variables standard injectées par les modules `App_CloudRun` / `App_GKE` de la plateforme. Lorsque `DB_HOST` est un chemin de socket Unix (commençant par `/`), le point d'entrée le résout systématiquement en TCP `127.0.0.1`, car un chemin de socket ne peut pas figurer dans une URL `postgresql://`. **Cette substitution n'est correcte que sur GKE**, où un véritable sidecar `cloud-sql-proxy` écoute en TCP sur `127.0.0.1:5432`. L'intégration Cloud SQL de Cloud Run (`enable_cloudsql_volume=true`) est le montage de socket *natif* (`run.googleapis.com/cloudsql-instances`) — il n'y a ni sidecar Auth Proxy ni écouteur TCP localhost sur Cloud Run — si bien que sur cette plateforme, la substitution produit `ECONNREFUSED 127.0.0.1:5432` et un échec de la sonde de démarrage. Le mot de passe est encodé pour URL afin que les caractères spéciaux du secret généré ne perturbent pas l'analyseur d'URL de Prisma.

2. **Définir `DATABASE_URL`** : exporte la chaîne de connexion assemblée sous le nom `DATABASE_URL` pour l'ORM Prisma d'Umami.

3. **Démarrer Umami** : localise et lance par `exec` le serveur Node d'Umami (`/app/server.js`, avec repli sur le serveur autonome Next.js ou sur `yarn start`).

Cette approche évite d'exposer une chaîne de connexion en clair comme variable d'environnement ou de la stocker dans l'état Terraform.

---

## 8. Assemblage de DATABASE_URL {#8-database_url-assembly}

Umami utilise la variable d'environnement `DATABASE_URL` pour toute la connectivité à la base de données. La plateforme injecte des variables DB_* individuelles :

| Variable d'env. de la plateforme | Rôle |
|---|---|
| `DB_HOST` | Hôte PostgreSQL (un répertoire de socket Unix lorsque `enable_cloudsql_volume=true` — l'intégration de socket Cloud Run *native* sur Cloud Run, ou le socket du sidecar `cloud-sql-proxy` sur GKE) |
| `DB_USER` | Nom d'utilisateur applicatif PostgreSQL |
| `DB_PASSWORD` | Mot de passe applicatif PostgreSQL (issu de Secret Manager) |
| `DB_NAME` | Nom de la base de données PostgreSQL |
| `DB_PORT` | Port PostgreSQL (5432 pour les connexions standard) |

Le point d'entrée personnalisé les assemble dans `DATABASE_URL` au format suivant :

```
postgresql://DB_USER:DB_PASSWORD@DB_HOST:DB_PORT/DB_NAME
```

Lorsque `DB_HOST` est un chemin de socket Unix (le cas par défaut, via `enable_cloudsql_volume=true`), le point d'entrée substitue systématiquement `127.0.0.1` comme hôte, afin que l'URL reste analysable :

```
postgresql://DB_USER:DB_PASSWORD@127.0.0.1:5432/DB_NAME
```

**Cette substitution n'est valable que sur GKE.** Là, un véritable sidecar `cloud-sql-proxy` écoute en TCP sur `127.0.0.1:5432` en plus de son socket Unix, de sorte que la redirection vers l'interface de bouclage fonctionne. Sur **Cloud Run**, le socket Cloud SQL est l'intégration *native* `run.googleapis.com/cloudsql-instances` — il n'y a ni sidecar Auth Proxy ni écouteur TCP `127.0.0.1` — si bien que la même substitution produit `ECONNREFUSED 127.0.0.1:5432` et que le conteneur échoue à sa sonde de démarrage. Ne considérez pas « l'Auth Proxy écoute aussi en TCP sur localhost » comme un fait valable sur toutes les plateformes lorsque vous réutilisez ou modifiez ce point d'entrée ; vérifiez les valeurs réellement injectées de `DB_HOST`/`DB_IP` sur la révision déployée avant de le supposer.

C'est pourquoi `container_image_source = "custom"` est la valeur par défaut recommandée — le mode `"prebuilt"`, qui utilise l'image officielle d'Umami, exige de fournir manuellement une `DATABASE_URL` complète dans `environment_variables`.

---

## 9. Différences propres à chaque plateforme {#9-platform-specific-differences}

| Aspect | Umami CloudRun | Umami GKE |
|---|---|---|
| `min_instance_count` | `0` (mise à l'échelle à zéro prise en charge) | `1` (toujours au moins un pod en cours d'exécution) |
| `max_instance_count` | `3` (valeur par défaut Cloud Run) | `10` (valeur par défaut HPA de GKE) |
| `DB_HOST` | Chemin du socket Cloud SQL natif de Cloud Run (`/cloudsql/...`, sans sidecar Auth Proxy) | IP privée Cloud SQL ou socket du sidecar `cloud-sql-proxy` |
| Enregistrement des sondes de santé | Configuration des sondes startup/liveness de Cloud Run | Spécification des sondes Kubernetes via `App GKE` |
| Tests de disponibilité | Désactivés par défaut (`uptime_check_config.enabled = false`) | Désactivés par défaut (`uptime_check_config.enabled = false`) |
| Redis | Non utilisé (`enable_redis = false`) | Non utilisé (la déclaration miroir `enable_redis` vaut `true` par défaut mais n'est pas transmise au module socle) |
| Buckets de stockage | Aucun (liste vide renvoyée) | Aucun (liste vide renvoyée) |

---

## 10. Modèle d'implémentation {#10-implementation-pattern}

```hcl
# Example: how Umami_CloudRun instantiates Umami_Common

module "umami_app" {
  source = "../Umami_Common"

  project_id           = var.project_id
  application_name     = var.application_name
  application_version  = var.application_version
  tenant_id = var.tenant_id
  db_name              = var.application_database_name
  db_user              = var.application_database_user
  cpu_limit            = var.cpu_limit
  memory_limit         = var.memory_limit
  description          = var.application_description
  startup_probe        = var.startup_probe
  liveness_probe       = var.liveness_probe
  enable_cloudsql_volume = var.enable_cloudsql_volume
  initialization_jobs  = var.initialization_jobs
}

# The wrapper assembles the four locals the Foundation Module consumes
# (config is merged with wrapper-level overrides such as image_source)
locals {
  application_modules    = { umami = merge(module.umami_app.config, { image_source = var.container_image_source }) }
  module_env_vars        = {}
  module_secret_env_vars = module.umami_app.secret_ids
  module_storage_buckets = module.umami_app.storage_buckets
}

# config is passed to App_CloudRun via application_config
module "app_cloudrun" {
  source = "../App_CloudRun"

  application_config     = local.application_modules
  module_env_vars        = local.module_env_vars
  module_secret_env_vars = local.module_secret_env_vars
  module_storage_buckets = local.module_storage_buckets
  scripts_dir            = abspath("${module.umami_app.path}/scripts")
  # ... other inputs
}
```

---

## 11. Instructions de première connexion {#11-first-login-instructions}

Après le déploiement, ouvrez l'URL du service Umami. Les identifiants par défaut sont :

| Champ | Valeur |
|---|---|
| Nom d'utilisateur | `admin` |
| Mot de passe | `umami` |

**Modifiez-les immédiatement après la première connexion.** Les identifiants par défaut sont publiquement connus et exposeront votre tableau de bord d'analyse s'ils ne sont pas modifiés.

Pour modifier le mot de passe administrateur :
1. Connectez-vous avec les identifiants par défaut.
2. Accédez à **Settings → Profile**.
3. Modifiez le nom d'utilisateur et le mot de passe.
4. Cliquez sur **Save**.

---

## 12. Ajouter des sites web à suivre {#12-adding-websites-for-tracking}

Une fois connecté :
1. Accédez à **Settings → Websites**.
2. Cliquez sur **Add website**.
3. Saisissez le nom et le domaine du site web.
4. Cliquez sur **Save** pour générer un ID de suivi.
5. Intégrez le script de suivi dans la balise `<head>` du site web cible :

```html
<script async src="https://<your-umami-url>/script.js" data-website-id="<your-website-id>"></script>
```

Le script de suivi collecte les pages vues, les sessions, les référents, les informations sur le navigateur et l'appareil ainsi que les événements personnalisés, sans utiliser de cookies ni stocker de données personnelles.

---

## 13. API des événements personnalisés {#13-custom-events-api}

Umami prend en charge le suivi d'événements personnalisés via un appel de fonction côté client ou directement via l'API :

```javascript
// Track a custom event
umami.track('button-click', { label: 'sign-up', page: '/home' });
```

Les événements personnalisés apparaissent dans le tableau de bord Umami sous **Events**. Utilisez-les pour suivre les conversions, les clics sur des boutons, les envois de formulaires ou toute autre interaction utilisateur.

L'API REST d'Umami (`/api`) permet également de récupérer les données d'analyse par programmation afin de les intégrer à des tableaux de bord ou à des outils de reporting. Authentifiez-vous avec un jeton bearer obtenu via `POST /api/auth/login`.

---

## 14. Espaces de travail d'équipe {#14-team-workspaces}

Umami prend en charge plusieurs utilisateurs, plusieurs sites web et le contrôle d'accès basé sur les rôles :

- **Admin** : accès complet à tous les paramètres, utilisateurs et sites web.
- **View-only** : accès en lecture aux tableaux de bord d'analyse.

Pour ajouter des membres à l'équipe :
1. Accédez à **Settings → Users**.
2. Cliquez sur **Create user**.
3. Attribuez le rôle approprié.

Plusieurs sites web peuvent être suivis au sein d'une même instance Umami — chaque site web reçoit son propre ID de suivi et une vue d'analyse isolée.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Umami sur Google Cloud Run](Umami_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Module Umami GKE — Guide de configuration](Umami_GKE.md) — cette configuration déployée sur GKE.
