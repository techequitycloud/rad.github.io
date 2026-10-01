---
title: "Appsmith Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Appsmith — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Appsmith_Common.md @ 3055034 sha256:f4b61848d2fe -->

# Appsmith Common — Configuration applicative partagée {#appsmith-common--shared-application-configuration}

`Appsmith_Common` est la **couche applicative partagée** d'Appsmith. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Appsmith sur
laquelle s'appuie [Appsmith_GKE](Appsmith_GKE.md). Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans le guide de la plateforme. Appsmith est
livré **uniquement pour GKE** dans ce dépôt : Appsmith CE est un conteneur
tout-en-un avec état (MongoDB + Redis embarqués) qui a besoin d'un volume
persistant et d'un rédacteur unique et stable, ce qui ne correspond pas au
modèle sans état et à mise à l'échelle jusqu'à zéro de Cloud Run — il n'existe
pas de module `Appsmith_CloudRun` à mettre en regard.

Pour l'infrastructure qui provisionne et exécute réellement Appsmith, consultez
le guide de la plateforme ([Appsmith_GKE](Appsmith_GKE.md)) et les guides du
socle ([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Appsmith_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `APPSMITH_ENCRYPTION_PASSWORD` (32 caractères), `APPSMITH_ENCRYPTION_SALT` (32 caractères) et `APPSMITH_SUPERVISOR_PASSWORD` (24 caractères) et les stocke dans **Secret Manager** | Injectés automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Pointe vers l'image « fat » officielle `appsmith/appsmith-ce` de Docker Hub (`image_source = "prebuilt"`) ; pas de Dockerfile ni d'étape Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **`database_type = "NONE"`** — Appsmith CE exécute en interne sa propre MongoDB embarquée ; aucune instance Cloud SQL n'est provisionnée ni raccordée | §Base de données dans le guide de la plateforme |
| Initialisation de la base de données | Aucune — aucun job `db-init` n'est injecté ; l'image « fat » initialise elle-même sa MongoDB et son Redis embarqués au premier démarrage | Sortie `initialization_jobs` (vide sauf si l'appelant fournit des jobs) |
| Stockage d'objets | Ne déclare **aucun** bucket Cloud Storage — `storage_buckets` renvoie toujours `[]` | Sortie `storage_buckets` |
| État persistant | Définit `enable_nfs`, `nfs_mount_path = "/appsmith-stacks"` pour un NFS à la manière de Cloud Run ; GKE préfère plutôt un PVC de StatefulSet sur le même chemin (voir `Appsmith_GKE`) | Comportement de l'application dans le guide de la plateforme |
| Paramètres de base | Définit l'environnement Appsmith de référence : télémétrie désactivée, aucune surcharge d'URL Mongo/Redis externe | Comportement de l'application dans le guide de la plateforme |
| Contrôles d'état | Fournit la sonde de démarrage/de vivacité par défaut ciblant `/api/v1/health` sur le port 80 | §Observabilité dans le guide de la plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Trois secrets sont générés automatiquement et stockés dans Secret Manager — ils
ne sont jamais définis en clair et ne doivent jamais être modifiés après le
premier déploiement :

- **`APPSMITH_ENCRYPTION_PASSWORD`** — une chaîne alphanumérique aléatoire de
  32 caractères (`random_password`, `special = false`). Utilisée avec le sel
  ci-dessous pour sécuriser le chiffrement AES-256 au repos des identifiants
  des sources de données et des clés SSH Git. La renouveler indépendamment
  d'une réinitialisation complète des données rend les données déjà chiffrées
  définitivement illisibles.
- **`APPSMITH_ENCRYPTION_SALT`** — une chaîne alphanumérique aléatoire de
  32 caractères. Associée à `APPSMITH_ENCRYPTION_PASSWORD` pour le même
  chiffrement au repos ; la même mise en garde sur le renouvellement
  s'applique.
- **`APPSMITH_SUPERVISOR_PASSWORD`** — une chaîne alphanumérique aléatoire de
  24 caractères. Protège le panneau interne de contrôle des processus
  `/supervisor` du conteneur.

Une ressource `time_sleep` attend 30 secondes après la création des versions de
secret avant d'autoriser le service ou les pods à les lire, laissant à Secret
Manager le temps de terminer la réplication.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~appsmith"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Il n'existe pas de secret distinct pour un mot de passe de base de données —
Appsmith CE n'a pas de base de données externe (voir ci-dessous). Consultez
[App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload
Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

**Aucun (`database_type = "NONE"`).** L'image « fat » officielle d'Appsmith CE
embarque sa propre MongoDB et son propre Redis dans le conteneur ; il n'y a ni
instance Cloud SQL, ni `enable_cloudsql_volume` (fixé à `false` dans ce module),
ni job `db-init`/de migration. Les variables `db_name` et `db_user` n'existent
que pour la compatibilité des wrappers avec le reste du système de modules et
ne sont pas utilisées par Appsmith. `initialization_jobs` vaut `[]` par défaut
dans `Appsmith_Common` — seuls les jobs explicitement fournis par l'Application
Module appelant sont pris en compte, et le calcul local du module n'en injecte
aucun.

Tout l'état de l'application — les fichiers de données de la Mongo embarquée,
le dump Redis, les ressources téléversées, les données des plugins et la
configuration des applications connectées à Git — réside plutôt sous
`/appsmith-stacks`, sur un stockage persistant plutôt que dans une base de
données gérée (NFS Filestore avec un raccordement à la manière de Cloud Run ;
un PVC de StatefulSet sur GKE — voir [Appsmith_GKE](Appsmith_GKE.md)).

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

`Appsmith_Common` définit :

```hcl
container_image = "appsmith/appsmith-ce"
image_source     = "prebuilt"
```

L'image « fat » officielle de la Community Edition est déployée directement
depuis Docker Hub — il n'y a ni Dockerfile, ni `container_build_config`
(explicitement désactivé : `enabled = false`), ni script de point d'entrée
personnalisé livré par ce module (le répertoire `scripts/` du module est vide).
L'image embarque une MongoDB, un Redis, le backend Java et le client React
derrière un reverse proxy nginx interne, le tout servi sur le **port 80**
(`container_port = 80`). `enable_image_mirroring` (par défaut `true`, transmis
par l'appelant) copie l'image dans Artifact Registry afin que le déploiement la
récupère depuis le réseau de Google plutôt que directement depuis Docker Hub,
ce qui évite les limites de débit.

Comme le point d'entrée provient entièrement de l'amont (non modifié par
rapport à l'image Docker Hub), il n'y a pas d'étape de traduction des
variables `DB_*` vers l'environnement natif comme en fournissent d'autres
modules Common — Appsmith ne reçoit de toute façon jamais de détails de
connexion à une base de données externe.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Appsmith_Common` établit l'environnement Appsmith de référence afin que
l'application démarre correctement dès le premier lancement :

- **Télémétrie** — `APPSMITH_DISABLE_TELEMETRY = "true"` par défaut
  (désactivée ; aucune donnée d'utilisation anonyme n'est envoyée au cloud
  d'Appsmith).
- **Aucune surcharge de magasin de données externe** — le module ne définit
  délibérément **pas** `APPSMITH_DB_URL` ni `APPSMITH_REDIS_URL`. Les clients
  Mongo/Redis internes de l'image « fat » utilisent `localhost` par défaut ;
  définir l'une ou l'autre ferait pointer Appsmith vers un magasin de données
  externe inexistant et empêcherait le démarrage.
- **Extensions Postgres** — `enable_postgres_extensions = false`,
  `postgres_extensions = []` (fixés ; sans objet, pas de backend Postgres).
- Les `environment_variables` fournies par l'appelant sont fusionnées en
  dernier et l'emportent sur la valeur par défaut de
  `APPSMITH_DISABLE_TELEMETRY`.

Ajustements de persistance propres à chaque plateforme gérés ici :

- **Le raccordement à la manière de Cloud Run** expose `enable_nfs` (transmis
  par l'appelant) et `nfs_mount_path = "/appsmith-stacks"` pour un volume
  adossé à Filestore.
- **GKE** ([Appsmith_GKE](Appsmith_GKE.md)) préfère plutôt un
  PersistentVolumeClaim de StatefulSet monté sur le même chemin, car une
  MongoDB embarquée unique gère son propre verrouillage de fichiers et est
  mieux servie par un volume bloc par pod que par un NFS partagé.

Comme une instance MongoDB embarquée unique possède le répertoire de données,
l'Application Module appelant doit limiter la charge de travail à un seul
rédacteur (`min_instance_count = max_instance_count = 1`) pour éviter une
corruption due à des rédacteurs concurrents.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `GET /api/v1/health` sur le port 80 — le point de
terminaison pour lequel le nginx/backend de l'image « fat » renvoie HTTP 200
une fois que la MongoDB embarquée, Redis et le backend Java ont tous terminé
leur initialisation.

- **Sonde de démarrage** — HTTP `/api/v1/health`,
  `initial_delay_seconds = 120`, `period_seconds = 15`,
  `failure_threshold = 40` (une fenêtre d'environ dix minutes), pour tenir
  compte du premier démarrage lent de la pile Mongo+Redis+Java embarquée.
- **Sonde de vivacité** — le même chemin avec des seuils plus stricts en
  régime établi : `initial_delay_seconds = 60`, `period_seconds = 30`,
  `failure_threshold = 3`.

---

## 7. Stockage d'objets {#7-object-storage}

Aucun. La sortie `storage_buckets` est codée en dur sur une liste vide —
Appsmith CE conserve tout son état (Mongo embarquée, Redis, téléversements,
données des applications connectées à Git) sur le volume NFS/PVC
`/appsmith-stacks` plutôt que dans Cloud Storage, si bien qu'aucun bucket GCS
n'est déclaré par cette couche.

---

Pour la configuration propre à Appsmith exposée à l'utilisateur (variables par
groupe, sorties et exploration du service depuis la console et la CLI),
consultez le guide de la plateforme : **[Appsmith_GKE](Appsmith_GKE.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Appsmith sur GKE Autopilot](Appsmith_GKE.md) — cette configuration déployée sur GKE.
