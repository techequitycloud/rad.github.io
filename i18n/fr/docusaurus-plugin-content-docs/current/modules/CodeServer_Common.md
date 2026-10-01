---
title: "CodeServer Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module CodeServer — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/CodeServer_Common.md @ 3055034 sha256:ac55199d9d72 -->

# CodeServer Common — Configuration applicative partagée {#codeserver-common--shared-application-configuration}

`CodeServer_Common` est la **couche applicative partagée** de code-server. Elle n'est
pas déployée seule ; elle fournit la configuration propre à code-server sur laquelle
reposent à la fois [CodeServer_GKE](CodeServer_GKE.md) et
[CodeServer_CloudRun](CodeServer_CloudRun.md), de sorte que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais cette couche directement — elle n'a aucune entrée
d'interface de déploiement qui lui soit propre — mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

code-server exécute un IDE VS Code complet dans le navigateur, adossé à un espace de
travail persistant. Il s'agit d'un conteneur unique et autonome : **pas de base de
données, pas de Redis, pas de file de messages** — tout l'état réside dans le
répertoire de l'espace de travail `/home/coder`, que cette couche adosse à un
stockage objet durable.

Pour l'infrastructure qui provisionne et exécute réellement code-server, consultez les
guides de plateforme ([CodeServer_GKE](CodeServer_GKE.md),
[CodeServer_CloudRun](CodeServer_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par CodeServer_Common | Où cela apparaît |
|---|---|---|
| Mot de passe de l'éditeur | Génère un mot de passe aléatoire de 24 caractères, le stocke dans **Secret Manager** et l'injecte comme variable d'environnement `PASSWORD` afin que la page de connexion de code-server l'exige | Injecté automatiquement lorsque `enable_password = true` ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `codercom/code-server` dans un `Dockerfile` minimal et la construit/réplique dans **Artifact Registry** via Cloud Build (Kaniko) | Output `container_image` du déploiement de plateforme |
| Moteur de base de données | Fixe **`database_type = NONE`** — code-server n'a ni base SQL ni job d'initialisation | §Comportement de l'application dans les guides de plateforme |
| Espace de travail persistant | Déclare le bucket **Cloud Storage** de l'espace de travail monté sur `/home/coder` (GCS FUSE sur Cloud Run, PVC bloc sur GKE) | Output `storage_buckets` |
| Paramètres de base | Définit `BIND_ADDR = 0.0.0.0:8080` afin que le frontal de la plateforme puisse router vers l'éditeur ; valeurs par défaut de mise à l'échelle à instance unique | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant le point de terminaison non authentifié `/healthz` | §Observabilité dans les guides de plateforme |

---

## 2. Mot de passe de l'éditeur dans Secret Manager {#2-editor-password-in-secret-manager}

Lorsque `enable_password = true` (valeur par défaut), un unique secret est généré
automatiquement et stocké dans Secret Manager — il n'est jamais défini en clair :

- **`PASSWORD`** — une chaîne alphanumérique aléatoire de 24 caractères
  (`special = false`). Injectée dans le conteneur comme variable d'environnement
  `PASSWORD`, que code-server lit pour protéger sa page de connexion. Toute personne
  atteignant l'URL de l'éditeur doit saisir ce mot de passe. Le secret est nommé
  `secret-<wrapper_prefix>-<application_name>-password`.

Le mot de passe reste stable d'un apply à l'autre (il repose sur une ressource
`random_password` dans l'état), de sorte que les redéploiements ne bloquent pas les
utilisateurs existants. Récupérez-le après le déploiement :

```bash
# List the password secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~codeserver AND name~password"

# Read the current editor password:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

L'ID du secret est également exposé comme output de plateforme
`codeserver_password_secret_id` (GKE) / output Common `password_secret_id`. Définir
`enable_password = false` supprime entièrement la création du secret et sert
l'éditeur **sans authentification** — ce n'est approprié que pour un déploiement
privé, à entrée `internal`, accessible uniquement depuis le VPC. Consultez
[App_Common](App_Common.md) pour le modèle de secrets partagés et de Workload
Identity.

---

## 3. Image de conteneur et build {#3-container-image-and-build}

code-server est livré sous la forme de l'image officielle `codercom/code-server`. Cette
couche l'encapsule dans un `Dockerfile` minimal (une seule ligne `FROM codercom/code-server:${CODESERVER_VERSION}`
avec un `ARG`) afin que le socle puisse la construire et la répliquer dans Artifact
Registry via Cloud Build avec Kaniko :

- **`image_source = "custom"`** avec `container_build_config.enabled = true`.
- Le Dockerfile lit un **ARG de build `CODESERVER_VERSION` propre à l'application**,
  et *non* l'`APP_VERSION` générique que le socle injecte (et qu'il forcerait à
  `latest`). Lorsque `application_version = "latest"`, le build épingle
  `CODESERVER_VERSION = 4.99.1` (une version éprouvée) ; sinon, il utilise le tag de
  version demandé.
- `enable_image_mirroring = true` par défaut réplique l'image dans Artifact Registry
  pour éviter les limites de débit de Docker Hub.

Inspectez la référence de l'image construite :

```bash
gcloud artifacts docker images list \
  <region>-docker.pkg.dev/$PROJECT/<repo>/codeserver --project "$PROJECT"
```

---

## 4. Pas de base de données, pas de Redis, pas de job d'initialisation {#4-no-database-no-redis-no-init-job}

code-server est un éditeur autonome. Cette couche définit **`database_type = NONE`**,
ne déclare **aucun job d'initialisation** (seuls les jobs personnalisés fournis par
l'utilisateur sont pris en compte), et les deux variantes de plateforme **désactivent
explicitement Redis** (`enable_redis = false`), car le socle l'active par défaut
(`true`). Il n'y a aucun schéma à créer, aucune migration à exécuter et aucun cache à
provisionner — la seule ressource stateful est le volume de l'espace de travail (§5).

---

## 5. Stockage persistant de l'espace de travail {#5-persistent-workspace-storage}

code-server conserve l'espace de travail de l'utilisateur, les paramètres de
l'éditeur, les extensions installées et sa configuration générée sous
**`/home/coder`**. Ce répertoire est l'unique source d'état persistant ; cette couche
déclare donc un bucket **Cloud Storage** (`name_suffix = "storage"`) que le socle
provisionne et monte sur `/home/coder` :

- **Cloud Run** monte le bucket comme volume **GCS FUSE** sur `/home/coder`
  (`enable_gcs_storage_volume = true`).
- **GKE** utilise par défaut le même volume GCS FUSE, mais lorsque
  `stateful_pvc_enabled = true`, la surcouche GKE définit
  `enable_gcs_storage_volume = false` et monte à la place un **PVC bloc de
  StatefulSet** sur `/home/coder` — ce qui évite un conflit de double montage. Le PVC
  bloc offre des E/S à plus faible latence pour les grands espaces de travail et
  l'installation d'extensions.

L'emplacement du bucket est laissé vide afin que le socle le résolve vers la région du
déploiement (`coalesce(bucket.location, region)`) ; l'épingler exposerait à un
remplacement forcé du bucket, dont l'emplacement est immuable, lors d'un nouvel apply
dans une autre région. Listez le bucket avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~codeserver"
```

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent **`/healthz`** — le point de terminaison de santé **non
authentifié** de code-server, qui renvoie `200` dès que le serveur HTTP écoute. C'est
important, car l'autre chemin de santé de code-server, `/health`, renvoie `401`
lorsqu'un `PASSWORD` est défini, ce qui ferait échouer une sonde non authentifiée et
provoquerait des redémarrages intempestifs.

- **Cloud Run** utilise des sondes HTTP ciblant `/healthz` (démarrage : délai initial
  de 15 s, fenêtre de 10 tentatives ; vivacité : délai de 30 s).
- **GKE** applique la même structure de sondes de démarrage/vivacité ; notez que la
  valeur `default` de la sonde de la variante GKE cible `/health` — remplacez-la par
  `/healthz` si un mot de passe est activé afin que les sondes restent non
  authentifiées.

---

Pour la configuration de code-server visible par l'utilisateur (variables par groupe,
outputs et manière d'explorer chaque service depuis la console et la CLI), consultez
les guides de plateforme : **[CodeServer_GKE](CodeServer_GKE.md)** et
**[CodeServer_CloudRun](CodeServer_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [code-server sur Google Cloud Run](CodeServer_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [code-server sur GKE Autopilot](CodeServer_GKE.md) — cette configuration déployée sur GKE.
