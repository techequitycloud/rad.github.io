---
title: "PocketBase Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module PocketBase — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/PocketBase_Common.md @ 3055034 sha256:2dda0c416baf -->

# PocketBase Common — Configuration applicative partagée {#pocketbase-common--shared-application-configuration}

`PocketBase_Common` est la **couche applicative partagée** de PocketBase. Elle
n'est pas déployée seule ; elle fournit la configuration propre à PocketBase sur
laquelle s'appuient [PocketBase_GKE](PocketBase_GKE.md) et
[PocketBase_CloudRun](PocketBase_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais cette couche directement — elle n'a
aucune entrée propre dans l'interface de déploiement — mais comprendre ce
qu'elle fournit explique les valeurs par défaut que vous voyez dans la
documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement PocketBase,
consultez les guides de plateforme ([PocketBase_GKE](PocketBase_GKE.md),
[PocketBase_CloudRun](PocketBase_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par PocketBase_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Enveloppe l'image préconstruite `ghcr.io/muchobien/pocketbase` dans un Dockerfile léger afin que le socle puisse la construire/la mettre en miroir dans **Artifact Registry** | Sortie `container_image` du déploiement de la plateforme |
| Version de l'image | Épingle `POCKETBASE_VERSION` sur `0.22.21` lorsque `application_version = "latest"`, afin qu'un tag inexistant dérivé de `pocketbase:latest` ne soit jamais demandé | `container_build_config.build_args` |
| Moteur de base de données | Impose `database_type = "NONE"` — PocketBase embarque une base de données **SQLite** ; aucune instance Cloud SQL n'est créée | §Comportement de la base de données dans les guides de plateforme |
| Amorçage de la base de données | **Aucun** — PocketBase crée et migre lui-même son schéma SQLite au premier démarrage ; aucun job `db-init` n'est donc injecté | Comportement de l'application dans les guides de plateforme |
| Stockage persistant | Déclare un unique bucket de données **Cloud Storage** (suffixe `storage`) et le monte sur `/pb_data` sur Cloud Run via GCS FUSE ; sur GKE, un PVC en mode bloc est monté au même chemin à la place | Sortie `storage_buckets` |
| Secrets | **Aucun** — PocketBase émet et stocke toute l'authentification dans sa propre base SQLite ; `secret_ids` / `secret_values` sont volontairement vides | §Secrets ci-dessous |
| Cache / file d'attente | **Aucun** — PocketBase est un backend unique et autonome et n'utilise pas Redis | Les deux variantes définissent `enable_redis = false` |
| Paramètres de base | Port du conteneur `8090`, administrateur créé de manière interactive sur `/_/`, aucune variable d'environnement requise pour le premier démarrage | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/api/health` | §Observabilité dans les guides de plateforme |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

**PocketBase ne nécessite aucun secret injecté.** Contrairement à la plupart des
applications adossées à une base de données, PocketBase n'a aucun identifiant
fourni par variable d'environnement :

- Le **compte superutilisateur (administrateur)** est créé de manière
  interactive au premier accès sur `/_/`.
- Toute l'authentification de l'API (jetons administrateur, enregistrements
  utilisateur, collections d'authentification) est émise et stockée **par
  PocketBase lui-même** dans sa base de données SQLite embarquée sous
  `/pb_data`.

C'est pourquoi `PocketBase_Common` exporte délibérément des maps `secret_ids` et
`secret_values` **vides**. Les variantes CloudRun et GKE référencent tout de
même ces outputs (en les raccordant à `module_secret_env_vars` /
`explicit_secret_values`) afin que le contrat du module soit uniforme avec tous
les autres modules applicatifs — mais aucun secret Secret Manager n'est créé
pour l'authentification propre à PocketBase.

Si vous ajoutez vos propres secrets (par exemple un mot de passe SMTP ou une clé
d'accès S3 pour des sauvegardes externes), injectez-les via l'entrée
`secret_environment_variables` de la plateforme sur le module de la variante et
vérifiez-les avec :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~pocketbase"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le secret durable à protéger ne se trouve pas du tout dans Secret Manager — il
s'agit de la **base de données SQLite dans le bucket de données / le PVC**, qui
contient chaque enregistrement, administrateur et jeton.

---

## 3. Image de conteneur {#3-container-image}

L'image est une **enveloppe légère** construite à partir de l'image amont
préconstruite :

```dockerfile
ARG POCKETBASE_VERSION=0.22.21
FROM ghcr.io/muchobien/pocketbase:${POCKETBASE_VERSION}
```

- **Image de base :** `ghcr.io/muchobien/pocketbase` — une distribution
  conteneurisée maintenue du serveur PocketBase à binaire unique.
- **Build :** le socle construit ce Dockerfile avec Cloud Build (Kaniko) et le
  pousse dans le dépôt Artifact Registry du déploiement ;
  `enable_image_mirroring = true` par défaut.
- **ARG de version propre à l'application.** Le Dockerfile lit
  `POCKETBASE_VERSION`, et **non** le générique `APP_VERSION` que le socle
  injecte (et qu'il forcerait sinon à `latest`). `PocketBase_Common` définit
  `POCKETBASE_VERSION = "0.22.21"` dès que `application_version = "latest"`, de
  sorte que le build se résout toujours en un tag réel et existant.
- **Pas de point d'entrée personnalisé.** L'image amont exécute déjà
  `serve --http=0.0.0.0:8090` avec son répertoire de données sur `/pb_data`, ce
  qui correspond au port du conteneur et au montage de stockage — aucun point
  d'entrée enveloppe n'est donc nécessaire pour le premier démarrage.

---

## 4. Initialisation de la base de données {#4-database-initialization}

**Il n'y a aucun job d'initialisation de la base de données.** PocketBase est un
unique binaire Go autonome doté d'une base de données **SQLite embarquée**. Au
premier démarrage, il crée ses propres fichiers de base de données, tables et
collections système sous `/pb_data`, et il applique automatiquement les
migrations de schéma en attente à chaque démarrage ultérieur.

Par conséquent, `PocketBase_Common` :

- définit `database_type = "NONE"` (aucune instance, aucun utilisateur ni
  aucune base de données Cloud SQL n'est provisionné),
- n'injecte **aucun** `initialization_jobs` par défaut (des jobs personnalisés
  restent acceptés via l'entrée `initialization_jobs` pour des tâches de
  chargement de données sur mesure), et
- n'effectue **aucune** configuration `pgvector`/d'extension et ne nécessite pas
  `enable_cloudsql_volume`.

La seule chose qui doit persister entre les redémarrages est le répertoire
`/pb_data` — voir la section suivante.

---

## 5. Stockage persistant {#5-persistent-storage}

PocketBase conserve **l'intégralité de son état** — la base de données SQLite,
les fichiers téléversés et les paramètres — dans un seul répertoire,
`/pb_data`. `PocketBase_Common` déclare à cet effet un bucket de données Cloud
Storage et le monte différemment selon la plateforme :

| Plateforme | Persistance sur `/pb_data` | Raccordement |
|---|---|---|
| **Cloud Run** | Volume GCS FUSE adossé au bucket `storage` | `enable_gcs_storage_volume = true` injecte le bucket sous forme de montage FUSE sur `/pb_data` |
| **GKE** | PVC en mode bloc (ReadWriteOnce) via un **StatefulSet** | `stateful_pvc_enabled = true` monte un PVC en mode bloc sur `/pb_data` ; la couche Common définit alors `enable_gcs_storage_volume = false` pour éviter un double montage au même chemin |

Le bucket est déclaré avec :

- `name_suffix = "storage"`, résolu par le socle en
  `gcs-<service_name>-storage`,
- `location = ""` afin que le socle le place dans la région de déploiement
  découverte automatiquement (un emplacement codé en dur le figerait et pourrait
  forcer le remplacement du bucket, dont l'emplacement est immuable, lors d'un
  nouvel apply dans une autre région),
- `storage_class = "STANDARD"`, `force_destroy = true`,
  `versioning_enabled = false`,
- `public_access_prevention = "enforced"`.

Listez le bucket après le déploiement :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
gcloud storage ls gs://<data-bucket>/          # bucket name is in the platform Outputs
```

> **Remarque sur le verrouillage SQLite.** SQLite s'appuie sur les verrous du
> système de fichiers. Un PVC en mode bloc (par défaut sur GKE) fournit un
> verrouillage POSIX fiable ; GCS FUSE (Cloud Run) est l'option pragmatique pour
> une instance unique. Dans les deux cas, PocketBase doit s'exécuter sur **une
> seule instance** (`max_instance_count = 1`) — des écrivains concurrents sur un
> même fichier SQLite corrompent les données.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les deux variantes configurent par défaut leurs sondes de démarrage et de
vivacité sur **`/api/health`** — le point de terminaison de santé public et non
authentifié de PocketBase, qui renvoie HTTP `200` dès que le serveur est prêt.
Comme il n'y a aucune base de données externe à attendre, le premier démarrage
est rapide ; la sonde de démarrage par défaut utilise un délai initial de 15
secondes avec une fenêtre de 10 tentatives, ce qui est largement suffisant pour
l'initialisation de SQLite.

Vérifiez-le directement une fois le service démarré :

```bash
curl -s "$SERVICE_URL/api/health"      # {"code":200,"message":"API is healthy.", ...}
```

---

Pour la configuration propre à PocketBase destinée aux utilisateurs (variables
par groupe, outputs et exploration de chaque service depuis la console et la
CLI), consultez les guides de plateforme : **[PocketBase_GKE](PocketBase_GKE.md)**
et **[PocketBase_CloudRun](PocketBase_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [PocketBase sur Google Cloud Run](PocketBase_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [PocketBase sur GKE Autopilot](PocketBase_GKE.md) — cette configuration déployée sur GKE.
