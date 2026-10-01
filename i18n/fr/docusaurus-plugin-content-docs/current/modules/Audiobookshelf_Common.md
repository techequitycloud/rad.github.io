---
title: "Audiobookshelf Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Audiobookshelf — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Audiobookshelf_Common.md @ 3055034 sha256:235cb5d049c5 -->

# Audiobookshelf Common — Configuration applicative partagée {#audiobookshelf-common--shared-application-configuration}

`Audiobookshelf_Common` est la **couche applicative partagée** d'Audiobookshelf. Elle
n'est pas déployée seule ; elle fournit la configuration propre à Audiobookshelf sur
laquelle s'appuient à la fois [Audiobookshelf_GKE](Audiobookshelf_GKE.md) et
[Audiobookshelf_CloudRun](Audiobookshelf_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais cette couche directement — elle n'a aucune entrée propre
dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Audiobookshelf, consultez
les guides des plateformes ([Audiobookshelf_GKE](Audiobookshelf_GKE.md),
[Audiobookshelf_CloudRun](Audiobookshelf_CloudRun.md)) et les guides de fondation
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Audiobookshelf_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Encapsule l'image officielle `ghcr.io/advplyr/audiobookshelf` dans un `Dockerfile` léger et la construit/met en miroir dans **Artifact Registry** via Cloud Build (Kaniko) | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | **Aucun** — Audiobookshelf embarque sa propre base de données **SQLite** sous `CONFIG_PATH` ; pas de Cloud SQL, pas de job d'initialisation, pas de job de migration | `database_type = "NONE"` dans la configuration |
| Stockage persistant | Déclare un unique bucket de données **Cloud Storage** et le monte sur `/data` (couvrant à la fois `CONFIG_PATH` et `METADATA_PATH`) | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement de référence : `CONFIG_PATH`, `METADATA_PATH`, port du conteneur `80` (pas de variable d'environnement `PORT` — c'est un nom réservé de Cloud Run) | Comportement de l'application dans les guides des plateformes |
| Contrôles d'état | Fournit la sonde de démarrage/de vivacité par défaut ciblant `/healthcheck` | §Observabilité dans les guides des plateformes |
| Secrets | **Aucun** — le premier utilisateur administrateur (« root ») est créé de manière interactive dans l'interface web lors du premier lancement ; `secret_ids` et `secret_values` sont vides | — |

---

## 2. Aucun secret de service {#2-no-service-secrets}

Contrairement aux applications adossées à une base de données, Audiobookshelf n'a
**aucun amorçage de l'administrateur ou de l'API par variables d'environnement**. Il
n'y a ni clé cryptographique, ni secret JWT, ni mot de passe de base de données à
générer :

- L'utilisateur **root** initial est créé de manière interactive lors du premier
  accès à `/` dans l'interface web.
- Les jetons d'API sont émis ensuite dans l'interface web (Settings → Users), et non
  injectés au moment du déploiement.

En conséquence, `Audiobookshelf_Common` expose des sorties `secret_ids` et
`secret_values` **vides**. Les deux wrappers de variante les raccordent néanmoins de
manière uniforme (via `module_secret_env_vars` / `explicit_secret_values`) afin que
l'appel à la fondation soit identique d'une plateforme à l'autre — il n'y a
simplement rien à injecter.

Il n'y a donc aucun secret applicatif à récupérer dans Secret Manager pour ce module.
(La fondation peut néanmoins créer des secrets au niveau de la plateforme sans lien
avec l'application ; voir [App_Common](App_Common.md).)

---

## 3. Pas de base de données, pas de job d'initialisation {#3-no-database-no-init-job}

Audiobookshelf stocke **tout** l'état de son application dans une base de données
**SQLite** autogérée qu'il crée et migre lui-même au premier démarrage. Par
conséquent :

- `database_type = "NONE"`, `db_name = ""`, `db_user = ""` et
  `enable_cloudsql_volume = false` — aucune instance Cloud SQL, aucun Auth Proxy ni
  aucun utilisateur de base de données n'est provisionné.
- **Aucun job `db-init` n'est injecté.** Audiobookshelf crée lui-même son schéma au
  premier lancement ; `initialization_jobs` vaut donc par défaut une liste vide. Des
  jobs personnalisés peuvent toujours être fournis (pour des chargements de données
  ou des migrations ponctuels), mais aucun n'est requis.
- **Pas de Redis.** Audiobookshelf est une application à rédacteur unique ;
  `enable_redis` est forcé à `false` dans les deux wrappers de variante.

Comme le fichier SQLite réside sous le montage persistant `/data` (voir ci-dessous),
la base de données survit aux redémarrages de révisions/de pods et aux mises à niveau
de version de l'application.

---

## 4. Stockage persistant — un unique montage `/data` {#4-persistent-storage--a-single-data-mount}

Audiobookshelf conserve sa base de données de configuration SQLite sous `CONFIG_PATH`
et ses pochettes / métadonnées en cache sous `METADATA_PATH`. Les deux sont redirigés
sous **un seul** montage persistant, afin qu'un unique volume couvre configuration et
métadonnées :

- `CONFIG_PATH = /data/config` — la base de données SQLite et la configuration de
  l'application.
- `METADATA_PATH = /data/metadata` — les pochettes et les métadonnées en cache.

`Audiobookshelf_Common` déclare un bucket de données Cloud Storage (`name_suffix =
"storage"`) et, lorsque `enable_gcs_storage_volume = true`, le monte sur `/data`. Les
deux variantes réalisent ce montage différemment :

- **Cloud Run** monte le bucket comme un volume **GCS FUSE** sur `/data` (nécessite
  l'environnement d'exécution gen2).
- **GKE** monte un **Persistent Volume Claim bloc** sur `/data` via un StatefulSet.
  gcsfuse **corrompt** SQLite et l'index des fichiers multimédias ; un véritable PVC
  bloc est donc requis ; dans ce cas, le wrapper définit
  `enable_gcs_storage_volume = false` pour éviter un double montage sur le même
  chemin.

Une bibliothèque multimédia supplémentaire (livres audio / podcasts) peut être
rattachée via `gcs_volumes` (par exemple un bucket en lecture seule monté sur
`/audiobooks`), qui est concaténée au volume de stockage.

Listez le bucket de données après le déploiement :

```bash
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://<data-bucket>/          # bucket name is in the platform Outputs
```

---

## 5. Image de conteneur et épinglage de version {#5-container-image-and-version-pinning}

L'image est un **wrapper léger** construit `FROM ghcr.io/advplyr/audiobookshelf` afin
que la fondation puisse la mettre en miroir dans Artifact Registry :

- Le build passe par **Cloud Build avec Kaniko** et respecte l'ARG de build propre à
  l'application **`AUDIOBOOKSHELF_VERSION`** — délibérément *pas* l'`APP_VERSION`
  générique qu'injecte la fondation (qu'elle forcerait à `latest`). Lorsque
  `application_version = "latest"`, l'ARG correspond à la valeur épinglée par défaut
  `2.17.0` ; sinon, il utilise le tag demandé.
- `enable_image_mirroring = true` par défaut : l'image est donc récupérée une seule
  fois dans l'Artifact Registry du locataire et servie depuis celui-ci.

Inspectez l'image construite et le registre à partir des sorties du déploiement de la
plateforme (`container_image`, `container_registry`) ou :

```bash
gcloud artifacts docker images list \
  <region>-docker.pkg.dev/$PROJECT/<repo>/audiobookshelf --project "$PROJECT"
```

---

## 6. Paramètres applicatifs de base {#6-core-application-settings}

`Audiobookshelf_Common` établit l'environnement de référence afin que l'application
démarre correctement dès le premier lancement :

- **Port** — le conteneur écoute sur le port `80` via `container_port` (le port HTTP
  par défaut d'Audiobookshelf). Il n'y a **pas de variable d'environnement `PORT`** —
  Audiobookshelf écoute sur le `$PORT` que Cloud Run injecte automatiquement à partir
  de `container_port`, et une variable d'environnement `PORT` fournie par
  l'utilisateur est un nom réservé que la plateforme refuse ; le module n'en définit
  donc délibérément aucune.
- **Chemin de configuration** — `CONFIG_PATH = "/data/config"`.
- **Chemin des métadonnées** — `METADATA_PATH = "/data/metadata"`.

`CONFIG_PATH`/`METADATA_PATH` peuvent être surchargés via `environment_variables`
lorsque la même clé est fournie, mais les modifier après le premier démarrage rendrait
orphelines la base de données SQLite existante et les métadonnées en cache.

---

## 7. Comportement des sondes d'état {#7-health-probe-behaviour}

Les sondes de démarrage et de vivacité par défaut ciblent **`/healthcheck`** — le point
de terminaison non authentifié d'Audiobookshelf qui renvoie `200` dès que le serveur
est prêt. Comme le chemin de la sonde est public, elle réussit dès que le serveur HTTP
est à l'écoute et ne nécessite aucune authentification.

- **Sonde de démarrage** — HTTP `/healthcheck`, délai initial de 15 secondes, période
  de 10 secondes, 10 échecs tolérés (≈115 secondes de marge au premier démarrage).
- **Sonde de vivacité** — HTTP `/healthcheck`, délai initial de 30 secondes, période
  de 30 secondes, 3 échecs tolérés.

---

Pour la configuration propre à Audiobookshelf exposée à l'utilisateur (variables par
groupe, sorties et exploration de chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Audiobookshelf_GKE](Audiobookshelf_GKE.md)**
et **[Audiobookshelf_CloudRun](Audiobookshelf_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Audiobookshelf sur Google Cloud Run](Audiobookshelf_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Audiobookshelf sur GKE Autopilot](Audiobookshelf_GKE.md) — cette configuration déployée sur GKE.
