---
title: "Changedetection Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Changedetection — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Changedetection_Common.md @ 3055034 sha256:3a0cba990748 -->

# Changedetection Common — Configuration applicative partagée {#changedetection-common--shared-application-configuration}

`Changedetection_Common` est la **couche applicative partagée** de changedetection.io. Elle
n'est pas déployée seule ; elle fournit la configuration propre à changedetection.io sur
laquelle s'appuient [Changedetection_GKE](Changedetection_GKE.md) et
[Changedetection_CloudRun](Changedetection_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais directement cette couche — elle n'a aucun champ de déploiement qui lui soit
propre dans l'interface — mais comprendre ce qu'elle fournit explique les valeurs par défaut
que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement changedetection.io, consultez les
guides des plateformes ([Changedetection_GKE](Changedetection_GKE.md),
[Changedetection_CloudRun](Changedetection_CloudRun.md)) et les guides de la fondation
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Changedetection_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Encapsule l'image officielle `ghcr.io/dgtlmoon/changedetection.io` dans un Dockerfile minimal, puis la construit et la réplique via Cloud Build (Kaniko) dans Artifact Registry | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **`database_type = "NONE"`** — changedetection.io est autonome et n'utilise aucune base de données SQL | §Base de données dans les guides des plateformes |
| Stockage d'objets | Déclare un bucket **Cloud Storage** de stockage de données (suffixe `storage`) qui contient toutes les données des surveillances | Sortie `storage_buckets` |
| Stockage de données persistant | Définit `DATASTORE_PATH = /datastore` et monte le stockage de données sur `/datastore` (GCS FUSE sur Cloud Run, PVC bloc sur GKE) | §Persistance dans les guides des plateformes |
| Paramètres principaux | Définit l'environnement de base : chemin du stockage de données, port du conteneur et (sur Cloud Run) l'hôte `BASE_URL` des liens de notification | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les sondes de démarrage et de vivacité par défaut, qui ciblent l'interface web sur `/` (HTTP 200) | §Observabilité dans les guides des plateformes |
| Secrets | **Aucun** — changedetection.io n'a aucun secret injecté par variable d'environnement ; son jeton facultatif de l'API REST est généré dans l'interface web | Les sorties `secret_ids` / `secret_values` sont volontairement vides |

---

## 2. Image de conteneur et build {#2-container-image-and-build}

changedetection.io est une application **Python/Flask** auto-hébergée qui surveille les
modifications de pages web et envoie des notifications. Le module n'utilise pas directement
l'image amont ; il fournit un `Dockerfile` minimal servant de surcouche, afin que la
Foundation puisse construire et répliquer une copie locale au projet dans Artifact Registry :

```dockerfile
ARG CHANGEDETECTION_VERSION=0.50.19
FROM ghcr.io/dgtlmoon/changedetection.io:${CHANGEDETECTION_VERSION}
```

- **Chemin de build.** `image_source = "custom"` avec `container_build_config.enabled = true`.
  L'image est construite via Cloud Build avec Kaniko et poussée dans le dépôt Artifact
  Registry du déploiement.
- **ARG de version propre à l'application.** Le Dockerfile lit **`CHANGEDETECTION_VERSION`**,
  et non le `APP_VERSION` générique qu'injecte la Foundation (et qui est forcé à `latest`).
  Lorsque `application_version = "latest"`, le build épingle un tag connu pour fonctionner
  (`0.50.19`) ; sinon, il utilise la version demandée. Cela évite de résoudre un tag de base
  inexistant dérivé de `:latest`.
- **Réplication.** `enable_image_mirroring` vaut `true` par défaut, afin d'éviter les limites
  de débit des registres et d'améliorer la fiabilité des téléchargements d'images.

Inspectez l'image déployée :

```bash
# The image reference is reported by the platform deployment output:
gcloud artifacts docker images list \
  <region>-docker.pkg.dev/$PROJECT/<repo-name> --project "$PROJECT"
```

---

## 3. Base de données — aucune {#3-database--none}

changedetection.io stocke tout son état sur disque, et non dans une base de données
relationnelle. `Changedetection_Common` définit donc **`database_type = "NONE"`**, ne déclare
ni `db_name` ni `db_user`, et n'injecte **aucun job d'initialisation de base de données**. Il
n'y a ni instance Cloud SQL, ni job `db-init`, ni étape de migration de schéma. L'entrée
`initialization_jobs` est transmise telle quelle aux opérateurs qui souhaitent exécuter des
tâches personnalisées de chargement de données, mais aucun job par défaut n'est ajouté.

Comme il n'y a pas de base de données, il n'y a pas non plus de besoin en **Redis** — les deux
surcouches de plateforme désactivent explicitement Redis.

---

## 4. Stockage de données persistant (bucket Cloud Storage / PVC) {#4-persistent-datastore-cloud-storage-bucket--pvc}

Toute la configuration des surveillances, les instantanés de pages et l'historique résident
dans un répertoire de stockage de données unique. Le module le normalise sur
**`DATASTORE_PATH = /datastore`** et l'adosse à un stockage persistant :

- **`storage_buckets`** déclare un bucket (`name_suffix = "storage"`,
  classe `STANDARD`, `force_destroy = true`, gestion des versions désactivée,
  `public_access_prevention = enforced`). La Foundation le provisionne sous le nom
  `gcs-<service_name>-storage` dans la région du déploiement et accorde l'accès au compte de
  service de la charge de travail.
- **`enable_gcs_storage_volume`** (par défaut `true`) monte ce bucket en tant que volume
  **GCS FUSE** sur `/datastore`. C'est ainsi que Cloud Run conserve les données.
- Sur **GKE avec `stateful_pvc_enabled = true`**, la surcouche définit
  `enable_gcs_storage_volume = false` afin que ce soit le **PVC bloc** du StatefulSet qui soit
  monté sur `/datastore` — ce qui évite un double montage sur le même chemin. Un PVC bloc est
  fortement recommandé sur GKE, car changedetection.io écrit un stockage de données à base de
  fichiers (JSON des surveillances et fichiers d'instantanés d'historique) qui se comporte
  mieux sur un volume bloc POSIX que sur un montage FUSE de stockage d'objets.

Listez le bucket du stockage de données :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
gcloud storage ls gs://<data-bucket>/          # bucket name is in the platform Outputs
```

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Changedetection_Common` établit l'environnement de base afin que l'application démarre
correctement dès le premier lancement :

- **`DATASTORE_PATH = "/datastore"`** — défini explicitement pour qu'il corresponde toujours
  au chemin du volume monté sur les deux plateformes (la valeur par défaut de l'image est
  également `/datastore`).
- **Port de conteneur `5000`** — changedetection.io sert son interface web sur le port 5000
  (`container_port = 5000`).
- **`BASE_URL`** — l'URL absolue utilisée dans les liens des notifications. Sur Cloud Run, la
  surcouche injecte l'URL prévue du service sous ce nom via
  `service_url_env_var_name = "BASE_URL"`. Sur GKE, il revient à l'opérateur de la définir
  (l'URL interne au cluster n'est pas un lien de notification utile).
- Les éventuelles `environment_variables` supplémentaires fournies par l'opérateur sont
  fusionnées par-dessus (par exemple `FETCH_WORKERS`, `PLAYWRIGHT_DRIVER_URL`).

---

## 6. Secrets — aucun injecté {#6-secrets--none-injected}

changedetection.io n'a besoin d'**aucun secret injecté par variable d'environnement**. Son
jeton facultatif d'accès à l'API REST est généré et géré dans l'interface web
(**Settings → API**), et non via une variable d'environnement ; aucun secret Secret Manager
n'est donc créé ici. Les sorties `api_key_secret_id`, `secret_ids` et `secret_values` sont
conservées (sous forme de valeurs vides constantes) uniquement pour que les surcouches Cloud
Run/GKE puissent les raccorder à `module_secret_env_vars` / `explicit_secret_values` sans
traitement particulier.

Le stockage de données lui-même n'est pas chiffré au niveau applicatif ; protégez l'interface
web en définissant un mot de passe dans **Settings → General** et en plaçant le service
derrière IAP ou Cloud Armor le cas échéant (voir les guides des plateformes).

---

## 7. Comportement des sondes de santé {#7-health-probe-behaviour}

Les sondes par défaut ciblent la racine de l'interface web `/`, qui renvoie **HTTP 200** dès
que le serveur Flask est prêt. Aucune authentification n'est requise au niveau du transport,
ce qui fait de `/` une cible de sonde sûre sur les deux plateformes :

- **Sonde de démarrage** — HTTP `GET /`, délai initial de 15 secondes, période de
  10 secondes, seuil d'échec de 10 tentatives.
- **Sonde de vivacité** — HTTP `GET /`, délai initial de 30 secondes, période de
  30 secondes, seuil d'échec de 3 tentatives.

Les guides des variantes peuvent remplacer ces chemins et délais dans leur propre
`variables.tf`.

---

Pour la configuration de changedetection.io destinée aux utilisateurs (variables par groupe,
sorties et manière d'explorer chaque service depuis la console et la CLI), consultez les
guides des plateformes : **[Changedetection_GKE](Changedetection_GKE.md)** et
**[Changedetection_CloudRun](Changedetection_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Changedetection sur Google Cloud Run](Changedetection_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Changedetection sur GKE Autopilot](Changedetection_GKE.md) — cette configuration déployée sur GKE.
