---
title: "PhotoPrism Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module PhotoPrism — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/PhotoPrism_Common.md @ 3055034 sha256:b5464c35c945 -->

# PhotoPrism Common — Configuration applicative partagée {#photoprism-common--shared-application-configuration}

`PhotoPrism_Common` est la **couche applicative partagée** de PhotoPrism. Elle n'est pas
déployée seule ; elle fournit la configuration propre à PhotoPrism sur laquelle
s'appuient [PhotoPrism_GKE](PhotoPrism_GKE.md) et [PhotoPrism_CloudRun](PhotoPrism_CloudRun.md),
afin que les deux variantes de plateforme se comportent de façon identique là où c'est important. Les utilisateurs finaux
ne configurent jamais directement cette couche — elle n'a pas d'entrées propres dans l'interface de déploiement —
mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement PhotoPrism, consultez les guides de
plateforme ([PhotoPrism_GKE](PhotoPrism_GKE.md), [PhotoPrism_CloudRun](PhotoPrism_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par PhotoPrism_Common | Où cela apparaît |
|---|---|---|
| Identifiant administrateur | Génère un mot de passe `admin` de 24 caractères, le stocke dans **Secret Manager** et l'injecte en tant que `PHOTOPRISM_ADMIN_PASSWORD` | À récupérer via Secret Manager (voir ci-dessous) ; sorties `secret_ids` / `admin_password_secret_id` |
| Image de conteneur | Encapsule l'image officielle `photoprism/photoprism` via un Dockerfile minimal, puis la construit et la met en miroir dans **Artifact Registry** avec Cloud Build (Kaniko) | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Impose **SQLite embarqué** (`PHOTOPRISM_DATABASE_DRIVER = sqlite`) — aucun Cloud SQL n'est provisionné (`database_type = "NONE"`) | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | **Aucun** — PhotoPrism crée et migre son propre schéma SQLite au premier démarrage ; aucun job `db-init` n'est injecté | Sortie `initialization_jobs` (vide sauf si l'appelant ajoute des jobs personnalisés) |
| Stockage persistant | Déclare un unique bucket **Cloud Storage** (`storage`) et, sur Cloud Run, le monte en tant que volume GCS FUSE sur `/photoprism` | Sortie `storage_buckets` ; §Persistance dans les guides de plateforme |
| Paramètres principaux | Définit l'environnement PhotoPrism de base : pilote SQLite, chemins storage/originals/import, hôte/port HTTP, utilisateur administrateur, mode d'authentification, URL du site | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/api/v1/status` | §Observabilité dans les guides de plateforme |

---

## 2. Identifiant administrateur dans Secret Manager {#2-admin-credential-in-secret-manager}

Un unique secret est généré automatiquement et stocké dans Secret Manager. Il n'est jamais
défini en clair :

- **`PHOTOPRISM_ADMIN_PASSWORD`** — une chaîne alphanumérique aléatoire de 24 caractères
  (`special = false`). C'est le mot de passe du compte administrateur PhotoPrism initial,
  dont le nom d'utilisateur est `PHOTOPRISM_ADMIN_USER` (par défaut `admin`, issu de `admin_username`).
  Le secret est nommé
  `secret-<wrapper_prefix>-<application_name>-admin-password`. La clé
  `PHOTOPRISM_ADMIN_PASSWORD` ne contient aucun séparateur `__` ; c'est donc une `targetKey`
  SecretSync GKE valide, qui transite proprement par `module_secret_env_vars` sur
  Cloud Run comme sur GKE.

Récupérez le mot de passe administrateur après le déploiement :

```bash
# List the secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~admin-password"

# Read the current admin password:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

PhotoPrism lit `PHOTOPRISM_ADMIN_PASSWORD` au démarrage et (ré)initialise le mot de passe
du compte administrateur en conséquence ; la valeur stockée dans Secret Manager fait donc toujours
foi. Voir [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données — SQLite embarqué (pas de Cloud SQL) {#3-database-engine--embedded-sqlite-no-cloud-sql}

PhotoPrism s'exécute en **mode SQLite embarqué** : `PHOTOPRISM_DATABASE_DRIVER = "sqlite"`
est défini, `database_type = "NONE"` et `enable_cloudsql_volume = false`. Aucune instance
Cloud SQL n'est provisionnée, il n'y a pas de job `db-init` et aucune connexion à une base de données
externe n'est à configurer. Le fichier de base de données SQLite et le cache d'index résident sous
`/photoprism/storage`, sur le même volume monté que les photos importées.

Comme tout l'état de l'application — la base de données SQLite, l'index des médias, le
cache des miniatures et les originaux — réside sur un seul volume accessible en écriture, PhotoPrism doit s'exécuter
en **instance unique** (`min_instance_count = max_instance_count = 1`). Un second
écrivain simultané corromprait la base de données SQLite et l'index.

---

## 4. Organisation du stockage persistant {#4-persistent-storage-layout}

Tout ce que PhotoPrism persiste réside sous `/photoprism` :

- `/photoprism/storage` — la base de données SQLite, les fichiers sidecar et le cache des miniatures
  (`PHOTOPRISM_STORAGE_PATH`)
- `/photoprism/originals` — les photos et vidéos importées/téléversées
  (`PHOTOPRISM_ORIGINALS_PATH`)
- `/photoprism/import` — la zone de transit du processus d'import
  (`PHOTOPRISM_IMPORT_PATH`)

Monter un seul volume sur `/photoprism` couvre donc l'ensemble. Les deux variantes
de plateforme adossent ce chemin différemment :

- **Cloud Run** monte le bucket Cloud Storage déclaré en tant que volume **GCS FUSE** sur
  `/photoprism` (`enable_gcs_storage_volume = true`).
- **GKE** le remplace par un **PVC de stockage bloc** sur le même chemin
  (`stateful_pvc_enabled = true`) et définit `enable_gcs_storage_volume = false` pour
  éviter un double montage. gcsfuse ne peut pas adosser SQLite ni l'index des médias en toute sécurité ; GKE
  utilise donc toujours le PVC bloc.

Le bucket `storage` est déclaré ici avec `public_access_prevention = "enforced"`,
`force_destroy = true`, le versioning désactivé et une `location` vide, afin que le socle
le place dans la région de déploiement découverte automatiquement. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

## 5. Image de conteneur et build {#5-container-image-and-build}

L'image personnalisée est une fine surcouche de l'image amont officielle :

```dockerfile
ARG PHOTOPRISM_VERSION=240915
FROM photoprism/photoprism:${PHOTOPRISM_VERSION}
```

- **ARG de build propre à l'application.** Le Dockerfile lit `PHOTOPRISM_VERSION`, et **non**
  l'`APP_VERSION` générique que le socle injecte (et qu'elle forcerait à `latest`).
  `photoprism/photoprism` utilise des tags glissants fondés sur la date ; lorsque l'appelant laisse
  `application_version = "latest"`, le module épingle donc un tag récent fiable (`240915`) ;
  sinon, il transmet tel quel la version demandée.
- **Construite et mise en miroir.** `image_source = "custom"` avec `enable_image_mirroring = true`,
  si bien que la surcouche est construite avec Cloud Build (Kaniko) et mise en miroir dans Artifact Registry
  avant le déploiement.
- **Pas de point d'entrée personnalisé.** Le point d'entrée de l'image amont est utilisé tel quel ; toute
  la configuration est fournie par des variables d'environnement (ci-dessous). PhotoPrism effectue
  lui-même la création et la migration de son schéma SQLite au démarrage.

---

## 6. Paramètres principaux de l'application {#6-core-application-settings}

`PhotoPrism_Common` établit l'environnement PhotoPrism de base afin que l'application
démarre correctement dès le premier lancement (toutes les valeurs sont fusionnées sous les
`environment_variables` fournies par l'appelant, une clé fournie par l'utilisateur l'emportant) :

- **Base de données** — `PHOTOPRISM_DATABASE_DRIVER = "sqlite"`.
- **Chemins de stockage** — `PHOTOPRISM_STORAGE_PATH = "/photoprism/storage"`,
  `PHOTOPRISM_ORIGINALS_PATH = "/photoprism/originals"`,
  `PHOTOPRISM_IMPORT_PATH = "/photoprism/import"`.
- **Serveur HTTP** — `PHOTOPRISM_HTTP_HOST = "0.0.0.0"`, `PHOTOPRISM_HTTP_PORT = "2342"`
  (correspondant à `container_port = 2342`).
- **Compte administrateur** — `PHOTOPRISM_ADMIN_USER` (par défaut `admin`) plus le secret injecté
  `PHOTOPRISM_ADMIN_PASSWORD` ; `PHOTOPRISM_AUTH_MODE = "password"`.
- **URL du site** — `PHOTOPRISM_SITE_URL` = `var.site_url` (vide par défaut ; PhotoPrism
  se rabat alors sur l'hôte de la requête). Définissez-la sur l'URL déployée pour obtenir des liens de partage
  et des redirections OAuth corrects.

---

## 7. Comportement des sondes de santé {#7-health-probe-behaviour}

Les sondes de démarrage et de vivacité par défaut ciblent **`GET /api/v1/status`**, qui renvoie
`200` dès que le serveur HTTP de PhotoPrism est démarré et que l'index SQLite est prêt.

- **Sonde de démarrage** — HTTP `/api/v1/status`, délai initial de 15 secondes, période de 10 secondes,
  seuil de 20 échecs (soit une fenêtre d'environ 3 minutes et demie après le délai) — suffisamment généreuse
  pour la création du schéma SQLite au premier démarrage et le préchauffage de l'index.
- **Sonde de vivacité** — HTTP `/api/v1/status`, délai initial de 30 secondes, période de 30 secondes,
  seuil de 3 échecs.

Les deux valeurs par défaut peuvent être remplacées pour chaque variante via `startup_probe` / `liveness_probe`.

---

## 8. Sorties du module {#8-module-outputs}

`PhotoPrism_Common` expose les éléments suivants à ses appelants :

| Sortie | Description |
|---|---|
| `config` | La configuration complète du module PhotoPrism (image, port, variables d'environnement, sondes, volumes, ressources), transmise au socle en tant que `application_config`. |
| `storage_buckets` | La définition de l'unique bucket `storage`, transmise en tant que `module_storage_buckets`. |
| `secret_ids` | Table de correspondance `PHOTOPRISM_ADMIN_PASSWORD → <secret id>`, transmise en tant que `module_secret_env_vars`. |
| `secret_values` | Valeurs brutes des secrets (sensibles) pour une injection explicite, sans passer par les lectures de data source Secret Manager. |
| `admin_password_secret_id` | ID du secret Secret Manager contenant le mot de passe administrateur généré. |
| `path` | Chemin du module, utilisé pour localiser le répertoire `scripts/` lors du build. |

---

Pour la configuration propre à PhotoPrism et destinée aux utilisateurs (variables par groupe, sorties
et façon d'explorer chaque service depuis la console et la CLI), consultez les guides de plateforme :
**[PhotoPrism_GKE](PhotoPrism_GKE.md)** et
**[PhotoPrism_CloudRun](PhotoPrism_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [PhotoPrism sur Google Cloud Run](PhotoPrism_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [PhotoPrism sur GKE Autopilot](PhotoPrism_GKE.md) — cette configuration déployée sur GKE.
