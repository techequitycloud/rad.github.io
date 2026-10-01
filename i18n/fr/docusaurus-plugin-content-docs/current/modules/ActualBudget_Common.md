---
title: "ActualBudget Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module ActualBudget — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/ActualBudget_Common.md @ 3055034 sha256:99ee95da7282 -->

# ActualBudget Common — Configuration applicative partagée {#actualbudget-common--shared-application-configuration}

`ActualBudget_Common` est la **couche applicative partagée** d'ActualBudget. Elle n'est pas déployée seule ; elle fournit la configuration propre à ActualBudget sur laquelle s'appuient à la fois [ActualBudget_GKE](ActualBudget_GKE.md) et [ActualBudget_CloudRun](ActualBudget_CloudRun.md), afin que les deux variantes de plateforme se comportent de façon identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement ActualBudget, consultez les guides de plateforme ([ActualBudget_GKE](ActualBudget_GKE.md), [ActualBudget_CloudRun](ActualBudget_CloudRun.md)) et les guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par ActualBudget_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Encapsule légèrement l'image officielle `actualbudget/actual-server` afin que le socle la construise/la duplique dans Artifact Registry | Sortie `container_image` du déploiement de plateforme |
| Épinglage de version | ARG de build propre à l'application `ACTUALBUDGET_VERSION` ; `latest` fige la version sur `25.7.1` | Tag de l'image dans Artifact Registry |
| Moteur de base de données | **Aucun** — les données de budget résident dans des fichiers SQLite sous `/data` (`database_type = "NONE"`) | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | **Aucun** — pas de tâche `db-init` ; le serveur initialise ses propres fichiers au premier démarrage | sans objet |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `storage` qui sert de support à `/data` sur Cloud Run | Sortie `storage_buckets` |
| Paramètres principaux | Définit `ACTUAL_PORT = 5006`, `ACTUAL_SERVER_FILES = /data/server-files`, `ACTUAL_USER_FILES = /data/user-files` | Comportement de l'application dans les guides de plateforme |
| Clé d'API facultative | Lorsque `enable_api_key = true`, génère un jeton de 32 caractères dans **Secret Manager**, injecté en tant que `ACTUAL_TOKEN` | Sortie `secret_ids` / Secret Manager |
| Contrôles de santé | Fournit le comportement par défaut des sondes de démarrage/de vivacité sur `/health` | §Observabilité dans les guides de plateforme |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

ActualBudget n'a **aucun secret généré obligatoire**. Il n'y a ni mot de passe de base de données, ni clé de chiffrement, ni secret JWT — le **mot de passe du serveur** est défini de manière interactive sur l'écran d'accueil de première exécution, et le chiffrement de bout en bout par budget est configuré par l'utilisateur dans le client.

Le **seul secret facultatif** est un jeton d'API, conditionné par `enable_api_key` (par défaut `false`) :

- Lorsque `enable_api_key = true`, une valeur aléatoire de 32 caractères est générée et stockée dans Secret Manager sous `secret-<prefix>-<app>-api-key` (par exemple `secret-<prefix>-actualbudget-api-key`), puis injectée dans le conteneur en tant que variable d'environnement secrète `ACTUAL_TOKEN` via le mécanisme `module_secret_env_vars` du socle.
- Lorsque `enable_api_key = false` (la valeur par défaut), aucun secret n'est créé et la table `secret_ids` du module est vide.

Cette option existe pour les déploiements qui ont besoin d'un identifiant provisionné à l'avance pour l'automatisation, avant la configuration interactive (ou à sa place).

Récupérez le secret après le déploiement (uniquement lorsque `enable_api_key = true`) :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~api-key"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

ActualBudget n'utilise **pas** de base de données externe. Chaque budget est un **fichier SQLite**, et l'état propre du serveur (comptes/métadonnées) repose également sur des fichiers — tout réside sous `/data`. Par conséquent :

- `database_type = "NONE"` — aucune instance Cloud SQL, aucune base de données ni aucun utilisateur n'est créé.
- Il n'y a **pas de tâche `db-init`** — le serveur crée ses fichiers au premier démarrage ; rien ne doit être amorcé à l'avance.
- Aucune extension PostgreSQL ni aucun Redis n'interviennent (`enable_redis = false` dans la variante Cloud Run).

Comme les bases de données sont des fichiers sur le volume persistant `/data`, leur durabilité dépend du backend de stockage et non d'un service de base de données géré (voir §6). Des `initialization_jobs` personnalisées sont acceptées pour des tâches de chargement ou de migration de données ; aucune n'est fournie par défaut.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

ActualBudget utilise un **Dockerfile léger** — il n'ajoute pas de script de point d'entrée personnalisé et exécute tel quel le démarrage propre à l'image amont :

```dockerfile
ARG ACTUALBUDGET_VERSION=25.7.1
FROM actualbudget/actual-server:${ACTUALBUDGET_VERSION}
```

- **`image_source = "custom"`** — défini uniquement pour que le socle construise l'image dans Artifact Registry via Cloud Build ; aucun code applicatif n'est ajouté par-dessus.
- **ARG de build propre à l'application** — le Dockerfile lit `ACTUALBUDGET_VERSION`, **et non** l'`APP_VERSION` générique que le socle injecte (et qu'il forcerait à `latest`). Lorsque `application_version = "latest"`, le build est figé sur `25.7.1` ; sinon, la version demandée est transmise telle quelle.
- **Aucune traduction au point d'entrée** — ActualBudget n'a besoin ni de raccordement à une base de données ni de réécriture d'URL au démarrage ; le démarrage amont est donc utilisé tel quel.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`ActualBudget_Common` établit l'environnement minimal dont le serveur a besoin pour démarrer la première fois et écrire son état sur le volume persistant :

- **`ACTUAL_PORT = "5006"`** — le port HTTP du serveur, qui correspond au `container_port` du module.
- **`ACTUAL_SERVER_FILES = "/data/server-files"`** — métadonnées du serveur et base de données des comptes.
- **`ACTUAL_USER_FILES = "/data/user-files"`** — fichiers de synchronisation par budget.
- **Aucun identifiant au démarrage** — le mot de passe du serveur est défini via l'écran d'accueil de première exécution ; rien d'autre n'est configuré au démarrage.

Montage de `/data` propre à chaque plateforme :

- **Cloud Run** monte le bucket Cloud Storage `storage` sur `/data` via GCS FUSE (`enable_gcs_storage_volume = true`).
- **GKE** avec `stateful_pvc_enabled = true` monte un PVC en mode bloc sur le même chemin et définit `enable_gcs_storage_volume = false` pour éviter un double montage.

---

## 6. Stockage d'objets {#6-object-storage}

Un unique bucket **Cloud Storage** est déclaré ici et provisionné par le socle, qui accorde également l'accès au compte de service de la charge de travail :

- **`name_suffix = "storage"`**, classe de stockage **STANDARD**, `public_access_prevention = "enforced"`, emplacement résolu vers la région du déploiement.
- Sur Cloud Run, il sert de support à `/data` via GCS FUSE ; il contient donc les bases de données de budget SQLite, les fichiers du serveur et les fichiers utilisateur — la seule copie de vos données de budget.

Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~actualbudget"
```

**Remarque sur le type de stockage.** SQLite privilégie un **stockage en mode bloc** offrant des E/S aléatoires à faible latence. Le montage GCS FUSE convient à un usage mono-utilisateur / léger sur Cloud Run, mais SQLite ne tolère pas GCS FUSE sous des écritures concurrentes intensives — pour un stockage de production durable, préférez le PVC en mode bloc de la variante GKE (`stateful_pvc_enabled = true`).

---

## 7. Comportement des sondes de santé {#7-health-probe-behaviour}

Les sondes par défaut propres à `ActualBudget_Common` émettent un **HTTP GET `/health`**,
**sans authentification** — elles réussissent donc indépendamment de l'état de la
configuration initiale. (Les modules d'encapsulation `ActualBudget_CloudRun` et
`ActualBudget_GKE` remplacent cette valeur par défaut par `/`, auquel le serveur Node
répond également par un `200` dès qu'il écoute — le chemin de sonde effectivement
déployé est donc `/` ; cette section décrit la valeur par défaut propre à Common avant
ce remplacement.)

- **Sonde de démarrage** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`, `failure_threshold = 10`.
- **Sonde de vivacité** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`, `failure_threshold = 3`.

---

Pour la configuration propre à ActualBudget destinée aux utilisateurs (variables par groupe, sorties et exploration de chaque service depuis la console et la CLI), consultez les guides de plateforme :
**[ActualBudget_GKE](ActualBudget_GKE.md)** et **[ActualBudget_CloudRun](ActualBudget_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [ActualBudget sur Google Cloud Run](ActualBudget_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [ActualBudget sur GKE Autopilot](ActualBudget_GKE.md) — cette configuration déployée sur GKE.
