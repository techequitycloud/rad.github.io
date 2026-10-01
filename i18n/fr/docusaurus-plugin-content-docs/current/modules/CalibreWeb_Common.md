---
title: "Calibre-Web Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Calibre-Web — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/CalibreWeb_Common.md @ 3055034 sha256:8a56de80aa07 -->

# Calibre-Web Common — Configuration applicative partagée {#calibre-web-common--shared-application-configuration}

`CalibreWeb_Common` est la **couche applicative partagée** de Calibre-Web. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Calibre-Web sur laquelle
s'appuient [CalibreWeb_GKE](CalibreWeb_GKE.md) et
[CalibreWeb_CloudRun](CalibreWeb_CloudRun.md), de sorte que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais cette couche directement — elle n'a aucune entrée propre
dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Calibre-Web, consultez les
guides des plateformes ([CalibreWeb_GKE](CalibreWeb_GKE.md),
[CalibreWeb_CloudRun](CalibreWeb_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par CalibreWeb_Common | Où cela apparaît |
|---|---|---|
| Authentification | Livré avec l'identifiant par défaut de LinuxServer `admin` / `admin123` (à modifier lors de la première connexion) ; génère **également** un mot de passe d'administration aléatoire de 24 caractères et le stocke dans **Secret Manager** | Interface web de Calibre-Web lors du premier accès ; secret injecté sous `CALIBRE_ADMIN_PASSWORD` |
| Secret du mot de passe d'administration | Crée toujours `secret-<prefix>-<app>-admin-password` et l'expose sous forme de variable d'environnement `CALIBRE_ADMIN_PASSWORD` | Sorties `secret_ids` / `admin_password_secret_id` ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Enveloppe légèrement l'image officielle `lscr.io/linuxserver/calibre-web` afin que le socle puisse la mettre en miroir dans Artifact Registry | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | **Aucun** — Calibre-Web utilise des bases SQLite internes sous `/config` (`database_type = "NONE"`) | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | **Aucune** — il n'y a pas de job `db-init` ; Calibre-Web gère son propre stockage | n/a |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `storage` qui sert de support à `/config` sur Cloud Run | Sortie `storage_buckets` |
| Paramètres de base | Définit `PUID = 1000`, `PGID = 1000`, `TZ = Etc/UTC` et le port de conteneur `8083` | Comportement de l'application dans les guides des plateformes |
| Contrôles d'état | Fournit les sondes de démarrage et de vivacité par défaut ciblant `/` (la page de connexion, `200`) | §Observabilité dans les guides des plateformes |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Calibre-Web est livré avec un identifiant par défaut intégré — **`admin` / `admin123`** —
que l'opérateur modifie lors de la première connexion. Indépendamment de cela,
`CalibreWeb_Common` génère **toujours** un mot de passe d'administration robuste et le
stocke dans Secret Manager, si bien qu'un secret SERVICE existe dans la sortie
`secret_ids` du module (le chemin d'injection standard) :

- **`CALIBRE_ADMIN_PASSWORD`** — une valeur alphanumérique aléatoire de 24 caractères
  (`special = false`) stockée dans Secret Manager sous
  `secret-<prefix>-<app>-admin-password` (par exemple
  `secret-<prefix>-calibreweb-admin-password`). Elle est injectée dans le conteneur sous
  forme de variable d'environnement secrète via le mécanisme `module_secret_env_vars` du
  socle. La clé ne contient pas de `__`, c'est donc un `targetKey` GKE SecretSync
  valide.

> **Remarque sur la première connexion.** L'image amont LinuxServer de Calibre-Web
> authentifie la première connexion avec les identifiants intégrés `admin` / `admin123`,
> et non avec le secret généré. Le secret `CALIBRE_ADMIN_PASSWORD` est provisionné pour
> qu'un mot de passe robuste existe dans Secret Manager (et pour qu'une future image ou
> un futur point d'entrée puisse l'utiliser) — **modifiez le mot de passe
> d'administration dans l'interface de Calibre-Web immédiatement après la première
> connexion**, et utilisez la valeur du secret généré si vous voulez un mot de passe
> robuste et stocké.

Récupérez le secret après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~admin-password"

# Read the generated admin password:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Consultez [App_Common](App_Common.md) pour le modèle partagé des secrets et de
Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Calibre-Web n'utilise **pas** de base de données externe. Tout son état — la base de
données de l'application (`app.db`), la base de métadonnées de la bibliothèque Calibre
(`metadata.db`), la configuration, le cache et les journaux — réside dans des
**fichiers SQLite internes** écrits sous `/config`. La bibliothèque de livres numériques
elle-même réside sous `/books` (vide au premier lancement ; l'assistant de
configuration y fait pointer Calibre-Web). Par conséquent :

- `database_type = "NONE"` — aucune instance Cloud SQL, base de données ni utilisateur
  n'est créé pour Calibre-Web.
- Il n'y a **pas de job `db-init`** — Calibre-Web initialise ses propres fichiers SQLite
  au premier démarrage ; rien n'a besoin d'être initialisé à l'avance.
- Aucune extension PostgreSQL, aucun `pgvector` et aucun Redis n'interviennent.

Comme les bases de données sont des fichiers sur le volume persistant `/config`, leur
durabilité dépend du backend de stockage et non d'un service de base de données géré
(voir les §5 et §7). Si vous avez besoin de tâches personnalisées de chargement de
données ou de migration, vous pouvez fournir vos propres `initialization_jobs` ; aucun
n'est fourni par défaut.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

Calibre-Web utilise un **Dockerfile wrapper léger** — il n'ajoute aucun script de point
d'entrée personnalisé et exécute sans modification l'init propre à l'image amont
LinuxServer, basé sur s6 :

```dockerfile
ARG CALIBREWEB_VERSION=0.6.24
FROM lscr.io/linuxserver/calibre-web:${CALIBREWEB_VERSION}
```

- **`image_source = "custom"`** — défini uniquement pour que le socle construise ou
  mette en miroir l'image dans Artifact Registry (via Cloud Build / Kaniko) ; aucun code
  applicatif n'est ajouté par-dessus.
- **ARG de build propre à l'application** — le Dockerfile lit `CALIBREWEB_VERSION`, et
  **non** l'`APP_VERSION` générique qu'injecte le socle (et qu'elle forcerait à
  `latest`). Lorsque `application_version = "latest"`, la couche Common épingle le
  build sur `0.6.24` ; sinon, elle transmet telle quelle la version demandée.
- **Aucune traduction du point d'entrée** — comme Calibre-Web n'a besoin d'aucun câblage
  de base de données ni d'aucune réécriture d'URL au démarrage, le démarrage par défaut
  de l'image amont est utilisé tel quel. L'image LinuxServer abandonne ses privilèges au
  profit de `PUID:PGID` (`1000:1000`) et conserve tout l'état sous `/config`.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`CalibreWeb_Common` établit l'environnement minimal dont Calibre-Web a besoin pour
démarrer au premier lancement et écrire son état sur le volume persistant :

- **`PUID = "1000"` / `PGID = "1000"`** — l'utilisateur et le groupe au profit desquels
  l'image LinuxServer abandonne ses privilèges ; propriétaires des montages `/config`
  (et `/books`) afin que Calibre-Web puisse lire et écrire ses fichiers SQLite.
- **`TZ = "Etc/UTC"`** — fuseau horaire du conteneur ; à remplacer via
  `environment_variables`.
- **Port de conteneur `8083`** — Calibre-Web sert HTTP sur le port 8083 par défaut, ce
  qui correspond au `container_port` du module.
- **Aucun paramètre de télémétrie, de file d'attente ni de mode d'exécution** — il n'y a
  rien d'autre à configurer au démarrage ; le reste de la configuration (modification du
  mot de passe d'administration, désignation de la bibliothèque Calibre) se fait via
  l'interface web.

Montage de `/config` propre à chaque plateforme :

- **Cloud Run** monte le bucket Cloud Storage `storage` sur `/config` via GCS FUSE
  (`enable_gcs_storage_volume = true`).
- **GKE** avec `stateful_pvc_enabled = true` monte un PVC en mode bloc sur `/config` et
  définit `enable_gcs_storage_volume = false` pour éviter un double montage sur le même
  chemin. Un vrai PVC en mode bloc est recommandé, car gcsfuse peut corrompre SQLite et
  les index de médias.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité émettent toutes deux un **HTTP GET `/`**, qui
renvoie la page de connexion de Calibre-Web (`200`) et ne nécessite **aucune
authentification** — les sondes réussissent donc dès que le serveur répond,
indépendamment de toute connexion administrateur.

- **Sonde de démarrage** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`,
  `failure_threshold = 10`.
- **Sonde de vivacité** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`,
  `failure_threshold = 3`.

---

## 7. Stockage d'objets {#7-object-storage}

Un seul bucket **Cloud Storage** est déclaré ici et provisionné par le socle, qui
accorde aussi l'accès au compte de service de la charge de travail :

- **`name_suffix = "storage"`**, classe de stockage **STANDARD**, `force_destroy = true`,
  versionnage désactivé, avec `public_access_prevention = "enforced"`.
- L'emplacement du bucket est laissé vide afin que le socle le résolve vers la
  région de déploiement découverte automatiquement (`coalesce(bucket.location, region)`),
  à l'instar des modules testés, ce qui évite un remplacement forcé du bucket, dont
  l'emplacement est immuable, lors d'un nouvel apply dans une autre région.
- Sur Cloud Run, il sert de support à `/config` via GCS FUSE ; il contient donc les bases
  SQLite de Calibre-Web (`app.db`, `metadata.db`), sa configuration, son cache et ses
  journaux.

Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

**Remarque sur le type de stockage.** Le répertoire `/config` de Calibre-Web fait un
usage intensif de SQLite et nécessite idéalement un **stockage en mode bloc**. Sur GKE,
le PVC en mode bloc (`stateful_pvc_enabled = true`) est le plus adapté — des E/S
aléatoires à faible latence sur les fichiers SQLite, sans les réserves de cohérence de
gcsfuse. Le montage GCS FUSE de Cloud Run convient à une instance unique au nombre
d'instances fixé et à un usage léger ; les bibliothèques plus volumineuses sont bien
mieux servies par le PVC en mode bloc de GKE.

---

Pour la configuration propre à Calibre-Web exposée aux utilisateurs (variables par
groupe, sorties et manière d'explorer chaque service depuis la Console et la CLI),
consultez les guides des plateformes : **[CalibreWeb_GKE](CalibreWeb_GKE.md)** et
**[CalibreWeb_CloudRun](CalibreWeb_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Calibre-Web sur Google Cloud Run](CalibreWeb_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Calibre-Web sur GKE Autopilot](CalibreWeb_GKE.md) — cette configuration déployée sur GKE.
