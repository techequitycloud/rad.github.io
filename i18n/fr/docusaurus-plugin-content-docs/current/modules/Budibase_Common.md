---
title: "Budibase Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Budibase — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Budibase_Common.md @ 3055034 sha256:7a218085da5b -->

# Budibase Common — Configuration applicative partagée {#budibase-common--shared-application-configuration}

`Budibase_Common` est la **couche applicative partagée** de Budibase. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Budibase sur laquelle
s'appuient [Budibase_GKE](Budibase_GKE.md) et [Budibase_CloudRun](Budibase_CloudRun.md),
afin que les deux variantes de plateforme se comportent de façon identique là où cela compte. Les
utilisateurs finaux ne configurent jamais directement cette couche — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la
documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Budibase, consultez les guides
de plateforme ([Budibase_GKE](Budibase_GKE.md), [Budibase_CloudRun](Budibase_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Budibase_Common | Où cela apparaît |
|---|---|---|
| Identifiants internes | Génère sept secrets stables — `INTERNAL_API_KEY`, `JWT_SECRET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `API_ENCRYPTION_KEY`, `REDIS_PASSWORD` et le mot de passe administrateur CouchDB — et les stocke dans **Secret Manager** | Injectés automatiquement comme variables d'environnement secrètes du service ; récupérables via Secret Manager (voir ci-dessous) |
| Image de conteneur | Construit une **image enveloppe légère** `FROM budibase/budibase` (l'image tout-en-un officielle) via Cloud Build, en fixant le tag de base au moyen d'un ARG de build propre à l'application, `BUDIBASE_VERSION` | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | **`database_type = "NONE"`** — Budibase intègre son propre **CouchDB** (ainsi que MinIO et Redis) dans l'unique conteneur ; il n'y a aucune base de données gérée externe | §Comportement de l'application dans les guides de plateforme |
| Modèle d'état | Tout l'état réside dans le répertoire de données du conteneur `/data` (documents CouchDB + magasin d'objets MinIO), chiffré avec les secrets générés | §Persistance dans les guides de plateforme |
| Stockage d'objets | Déclare un bucket **Cloud Storage** (suffixe `storage`) provisionné par le socle | Sortie `storage_buckets` |
| Paramètres essentiels | Définit l'environnement Budibase de base : mode production auto-hébergé, utilisateur administrateur CouchDB, niveau de journalisation, port `80` | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit les sondes de démarrage/vivacité/disponibilité par défaut ciblant le chemin racine non authentifié `/` | §Observabilité dans les guides de plateforme |

---

## 2. Identifiants internes dans Secret Manager {#2-internal-credentials-in-secret-manager}

L'image tout-en-un de Budibase exécute ensemble CouchDB, MinIO, Redis et les processus
application/worker/proxy, et chiffre les données de `/data` avec un ensemble d'identifiants
internes. `Budibase_Common` génère chacun d'eux **une seule fois**, le stocke dans Secret
Manager et l'injecte dans le conteneur en cours d'exécution comme variable d'environnement secrète du **service**.
Ces valeurs **doivent rester constantes d'un redémarrage à l'autre** — si l'une d'elles change après
le premier démarrage, les données déjà écrites dans `/data` (chiffrées avec l'ancienne valeur)
deviennent illisibles.

| Variable d'environnement secrète | Rôle |
|---|---|
| `INTERNAL_API_KEY` | Clé partagée pour les appels internes de service à service entre les applications/le worker intégrés |
| `JWT_SECRET` | Signe les jetons de session utilisateur ; sa rotation déconnecte tout le monde |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | Identifiants du magasin d'objets MinIO intégré qui contient les éléments et pièces jointes des applications |
| `API_ENCRYPTION_KEY` | Chiffre les secrets/identifiants de connexion stockés ; **sa rotation corrompt toutes les données chiffrées** |
| `REDIS_PASSWORD` | Mot de passe du Redis intégré au conteneur |
| `COUCH_DB_PASSWORD` | Mot de passe administrateur du CouchDB intégré (associé à `COUCH_DB_USER`, `admin` par défaut) |

Les ID des secrets Secret Manager suivent le modèle
`secret-<resource-prefix>-<app>-<name>` (par exemple
`secret-<prefix>-budibase-api-encryption-key`). Récupérez-les après le déploiement :

```bash
# List the Budibase internal-credential secrets for this deployment:
gcloud secrets list --project "$PROJECT" --filter="name~budibase"

# Read a specific secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity.

---

## 3. Image de conteneur et build {#3-container-image-and-build}

Budibase est distribué sous forme d'image **tout-en-un** précompilée sur Docker Hub
(`budibase/budibase`), qui regroupe CouchDB + MinIO + Redis + les applications/le worker/le proxy
Budibase et sert le HTTP sur le **port 80**. `Budibase_Common` ne modifie **pas**
l'environnement d'exécution — il construit une **image enveloppe légère** afin que le tag de l'image de base
soit fixé de manière déterministe :

- `image_source = "custom"` avec un `Dockerfile` d'une seule ligne (`FROM budibase/budibase:${BUDIBASE_VERSION}`),
  construit via Cloud Build (Kaniko) et répliqué dans Artifact Registry
  (`enable_image_mirroring = true`).
- Le tag de base est fixé via l'ARG de build propre à l'application **`BUDIBASE_VERSION`**,
  et **non** via l'`APP_VERSION` générique. Le socle injecte `APP_VERSION = application_version`
  (`"latest"` par défaut) dans `build_args` et l'emporte lors de la fusion ; un Dockerfile reposant
  sur `APP_VERSION` se résoudrait donc toujours en `:latest`. `BUDIBASE_VERSION` est défini par
  les `build_args` de `Budibase_Common` et n'est jamais écrasé.
- Aucune surcharge d'`ENTRYPOINT`/`CMD` — le lanceur tout-en-un amont est hérité
  tel quel.

L'image déployée et le dépôt Artifact Registry sont indiqués dans les outputs de la plateforme
(`container_image`, `container_registry`).

---

## 4. Base de données et initialisation au premier démarrage {#4-database-and-first-boot-bootstrap}

Il n'y a **aucune base de données gérée externe** et **aucun job `db-init`** à exécuter. Avec
`database_type = "NONE"`, Budibase provisionne lui-même ses CouchDB et MinIO intégrés au
premier démarrage dans le conteneur. `Budibase_Common` ne prend en compte que les
`initialization_jobs` **fournis par l'utilisateur** ; par défaut, la liste est vide.

Environnement de base défini par cette couche :

- `BUDIBASE_ENVIRONMENT = "PRODUCTION"` et `SELF_HOSTED = "1"` — mode production
  auto-hébergé avec tous les services colocalisés.
- `COUCH_DB_USER = "admin"` (le mot de passe associé est injecté via le secret
  `COUCH_DB_PASSWORD`).
- `LOG_LEVEL = "info"`.

Comme l'état réside dans `/data`, ce répertoire doit reposer sur un **stockage
persistant**, faute de quoi chaque redémarrage efface l'instance — la variante GKE monte un PVC en mode bloc
sur `/data`, tandis que Cloud Run ne dispose d'aucun disque local durable (voir les guides de plateforme).

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Le proxy nginx intégré de Budibase renvoie un `200` non authentifié sur le chemin racine `/`
une fois les services intégrés démarrés. Les trois sondes ciblent `/` :

- **Sonde de démarrage** — HTTP `/`, délai initial de 60 secondes, période de 15 secondes, fenêtre de 40
  tentatives (une fenêtre généreuse, car le conteneur doit démarrer CouchDB, MinIO, Redis
  et la couche applicative avant de servir).
- **Sonde de vivacité** — HTTP `/`, délai initial de 60 secondes, période de 30 secondes.
- **Sonde de disponibilité** — HTTP `/`, délai initial de 30 secondes, période de 10 secondes.

---

## 6. Stockage d'objets {#6-object-storage}

Un unique bucket **Cloud Storage** (suffixe de nom `storage`, classe `STANDARD`,
`public_access_prevention = enforced`) est déclaré ici et provisionné par le
socle, qui accorde également l'accès au compte de service de la charge de travail. Le stockage
d'éléments/de pièces jointes propre à Budibase est le **MinIO** intégré sur `/data` ; le bucket GCS est
disponible pour l'intégration du stockage au niveau du socle. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Budibase destinée aux utilisateurs (variables par groupe, outputs,
et manière d'explorer chaque service depuis la console et la CLI), consultez les guides de plateforme :
**[Budibase_GKE](Budibase_GKE.md)** et **[Budibase_CloudRun](Budibase_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Budibase sur Google Cloud Run](Budibase_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Budibase sur GKE Autopilot](Budibase_GKE.md) — cette configuration déployée sur GKE.
