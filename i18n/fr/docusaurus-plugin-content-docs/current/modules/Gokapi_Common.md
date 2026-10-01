---
title: "Gokapi Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Gokapi — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Gokapi_Common.md @ 3055034 sha256:3107eb3e71da -->

# Gokapi Common — Configuration applicative partagée {#gokapi-common--shared-application-configuration}

`Gokapi_Common` est la **couche applicative partagée** de Gokapi. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Gokapi sur laquelle
reposent à la fois [Gokapi_GKE](Gokapi_GKE.md) et [Gokapi_CloudRun](Gokapi_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là
où cela compte. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a aucune entrée propre dans l'interface de déploiement —
mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez
dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Gokapi, consultez les
guides de plateforme ([Gokapi_GKE](Gokapi_GKE.md), [Gokapi_CloudRun](Gokapi_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Gokapi_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Ne génère **aucun secret par défaut**. Ce n'est que lorsque `enable_api_key = true` qu'il crée un jeton API aléatoire de 32 caractères et le stocke dans **Secret Manager** | Injecté en tant que `GOKAPI_API_KEY`, récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `f0rc3/gokapi` dans un Dockerfile de build personnalisé d'une ligne (sans script de point d'entrée personnalisé) ; build via Cloud Build/Kaniko | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose `database_type = "NONE"` — Gokapi n'a aucune base de données externe | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Aucun. Aucun job `db-init` n'est injecté ; seules les `initialization_jobs` fournies par l'utilisateur sont acceptées | Sortie `initialization_jobs` (vide sauf si fournie par l'utilisateur) |
| Stockage d'objets | Déclare le bucket de données **Cloud Storage** suffixé `storage`, et le monte éventuellement en tant que volume GCS Fuse sur `/data` | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement Gokapi de référence : chemins des répertoires de configuration/données et port d'écoute fixe | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/` | §Observabilité dans les guides de plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Gokapi n'a **aucun secret généré obligatoire**. Ce module ne crée ni clé de
chiffrement, ni secret JWT, ni mot de passe administrateur — le compte
administrateur de Gokapi est au contraire revendiqué de manière interactive via
son propre assistant de premier lancement, la première fois que quelqu'un ouvre
le service.

Le seul secret que cette couche peut créer est facultatif :

- **`GOKAPI_API_KEY`** (uniquement lorsque `var.enable_api_key = true`, par défaut
  `false`) — un jeton alphanumérique aléatoire de 32 caractères
  (`random_password`, `special = false`), stocké dans Secret Manager sous le nom
  `secret-<wrapper_prefix>-gokapi-api-key` et injecté en tant que variable
  d'environnement `GOKAPI_API_KEY`. Il s'agit **uniquement d'un jeton de commodité
  pour l'opérateur** — les véritables clés API de téléversement/téléchargement
  propres à Gokapi sont normalement créées depuis l'interface d'administration une
  fois l'assistant de premier lancement terminé. Il n'y a pas de risque de
  rotation au sens habituel (rien n'en dépend cryptographiquement), mais sa
  rotation modifie la valeur qui a pu être communiquée à un appelant externe en
  tant que `GOKAPI_API_KEY`.

Récupérez-le après le déploiement (présent uniquement lorsque
`enable_api_key = true`) :

```bash
# List the secret (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~api-key"

# Read the secret version:
gcloud secrets versions access latest --secret=<api-key-secret-name> --project "$PROJECT"
```

Notez que l'ID de ce secret n'est **pas** exposé de manière générique via le nom
de clé de la table de sortie `secret_ids` de ce module — il apparaît comme
l'entrée `GOKAPI_API_KEY` de `secret_ids` (Cloud Run) ou comme la sortie
`gokapi_api_key_secret_id` (GKE, injecté sous forme de Secret Kubernetes natif
plutôt que via SecretSync). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity sur lequel reposent les deux variantes
de plateforme.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

**Aucun (SQLite sur un stockage monté).** `Gokapi_Common` code en dur
`database_type = "NONE"` dans la sortie `config` qu'il renvoie au socle.
Il n'y a ni instance Cloud SQL, ni job `db-init`, ni utilisateur/mot de passe
de base de données d'aucune sorte. Gokapi gère entièrement son état lui-même :
il écrit une base de données SQLite interne sous `GOKAPI_CONFIG_DIR` et stocke
les fichiers téléversés sous `GOKAPI_DATA_DIR`, que ce module fait tous deux
pointer vers des sous-répertoires d'un unique volume monté (voir la
[section 7](#7-object-storage)).

La sortie `initialization_jobs` est vide par défaut — le `main.tf` de
`Gokapi_Common` ne transmet des jobs que lorsque l'appelant fournit
explicitement `var.initialization_jobs` ; aucun job d'amorçage de base de
données par défaut n'est injecté, puisqu'il n'y a aucune base à amorcer. Les
champs `db_name` et `db_user` de la sortie `config` du module sont codés en dur
avec des chaînes vides, et `enable_cloudsql_volume = false` / `enable_postgres_extensions =
false` sont également figés — tous présents uniquement pour satisfaire le schéma
générique du socle, et non parce que Gokapi les utilise.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image est un **wrapper léger d'une ligne**, et non un build doté d'un point
d'entrée personnalisé :

```dockerfile
ARG GOKAPI_VERSION=v1.9.6
FROM f0rc3/gokapi:${GOKAPI_VERSION}
```

Ce module ne contient pas d'`entrypoint.sh` — `scripts/` ne contient que le
`Dockerfile` et un `cloudbuild.yaml` (plus un `.gitkeep`). Le seul objectif du
wrapper est de permettre au socle de construire et de mettre en miroir
l'image amont `f0rc3/gokapi` dans Artifact Registry sous `container_build_config`
(`dockerfile_path = "Dockerfile"`, `context_path = "."`), plutôt que de la
récupérer directement depuis Docker Hub au moment du déploiement.

Le build utilise un **argument de build propre à l'application**,
`GOKAPI_VERSION`, au lieu de l'argument générique `APP_VERSION` que le socle
injecte dans chaque build personnalisé (qui forcerait sinon le tag de l'image à
`"latest"` — un tag que `f0rc3/gokapi` ne publie pas de façon fiable sous une
forme stable). `Gokapi_Common` le résout ainsi :

```hcl
GOKAPI_VERSION = var.application_version == "latest" ? "v1.9.6" : var.application_version
```

Ainsi, la valeur par défaut `application_version = "latest"`, commune à toute la
plateforme, s'épingle tout de même sur un tag connu et testé (`v1.9.6`) au lieu
de casser le build. Le `cloudbuild.yaml` de `scripts/` reproduit en mode intégré (inline) ce
contenu exact du Dockerfile sous forme d'étape de build Kaniko, en se
réparant de lui-même face à un fichier vide ou absent avant le build.

Comme il n'y a pas de script de point d'entrée, l'`ENTRYPOINT` propre au
conteneur de Gokapi (tel qu'intégré à `f0rc3/gokapi`) s'exécute sans
modification — toute la configuration d'exécution passe uniquement par des
variables d'environnement (voir ci-dessous) et par le volume monté.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Gokapi_Common` établit l'environnement Gokapi de référence afin que
l'application démarre correctement dès le premier lancement. Contrairement à la
plupart des modules Common d'application, il y a très peu de choses à définir,
car Gokapi est un petit binaire Go autonome :

- **Répertoires de configuration et de données** — `GOKAPI_CONFIG_DIR = "/data/config"`
  (configuration de l'application et base de métadonnées SQLite) et `GOKAPI_DATA_DIR =
  "/data/data"` (fichiers téléversés). Tous deux sont des sous-répertoires de
  l'unique montage persistant sur `/data`, ce qui laisse le binaire de
  l'application dans `/app` hors d'atteinte du montage.
- **Port d'écoute** — `GOKAPI_PORT = "53842"` est **codé en dur** dans les
  `environment_variables` de ce module, en correspondance avec le
  `container_port =
  53842` fixe du module. Cette valeur est définie quelle que soit la plateforme et
  n'est dérivée d'aucune variable.
- **Aucun autre paramètre de référence.** Il n'y a ni mode file d'attente, ni
  flag de télémétrie, ni paramètre de mode d'exécution, ni commutateur
  d'inscription — Gokapi complète le reste de sa configuration via son propre
  assistant de premier lancement servi sur `/setup`, et non via des variables
  d'environnement.

Les ajustements propres à chaque plateforme sont minimes et se situent presque
entièrement en dehors de cette couche Common :

- **Cloud Run** transmet `container_port = var.container_port` via la fusion de
  `gokapi.tf` dans la configuration propre à l'application qui atteint le
  socle ; la valeur est donc techniquement active — mais la remplacer par une
  autre valeur que `53842` acheminerait le trafic vers un port sur lequel le
  conteneur (fixé ici à `GOKAPI_PORT = "53842"`) n'écoute pas réellement.
  Conservez la valeur par défaut.
- **GKE** déclare la variable équivalente `container_port` mais ne la transmet
  jamais au socle — elle y est sans effet. La décision de persistance de
  GKE (PVC en mode bloc ou GCS Fuse) est également pilotée depuis la variante GKE,
  et non directement depuis cette couche Common, même si le mécanisme
  (`enable_gcs_storage_volume`) est implémenté ici — voir la
  [section 7](#7-object-storage).

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent toutes deux `/` — la racine publique de Gokapi (son
interface, ou avant la configuration de premier lancement l'avis de maintenance) —
qui n'est pas authentifiée et renvoie 200 dès que le binaire est à l'écoute, sans
dépendre d'aucune base de données externe (puisqu'il n'y en a pas) :

- **Sonde de démarrage** — HTTP GET `/`, `initial_delay_seconds = 15`,
  `timeout_seconds = 5`, `period_seconds = 10`, `failure_threshold = 10`
  (environ 100 secondes de marge de nouvelles tentatives après le délai initial).
- **Sonde de vivacité** — HTTP GET `/`, `initial_delay_seconds = 30`,
  `timeout_seconds = 5`, `period_seconds = 30`, `failure_threshold = 3`.

Ces deux valeurs par défaut sont définies une seule fois dans le `variables.tf`
de ce module (`startup_probe` / `liveness_probe`) et sont identiques sur Cloud
Run et GKE — aucune variante de plateforme ne les remplace. Comme Gokapi n'a
aucune base de données à attendre, la fenêtre de démarrage est comparativement
courte par rapport aux modules d'application adossés à une base de données.

---

## 7. Stockage d'objets {#7-object-storage}

C'est dans cette couche que se décide réellement la stratégie de persistance de
Gokapi, et elle diffère sensiblement entre les deux variantes de plateforme, même
si la déclaration sous-jacente est la même.

`Gokapi_Common` déclare toujours un bucket Cloud Storage via sa sortie
`storage_buckets` (`name_suffix = "storage"`, classe `STANDARD`,
`force_destroy = true`, sans gestion des versions, `public_access_prevention =
"enforced"`, et un `location` vide afin que le socle le résolve en la région
de déploiement découverte automatiquement). Ce bucket est provisionné dès que
`create_cloud_storage = true` (la valeur par défaut de la plateforme), quelle que
soit la manière dont il est finalement utilisé.

Le fait que ce bucket soit réellement **monté** est contrôlé par
`var.enable_gcs_storage_volume` (par défaut `true` dans ce module) :

```hcl
_gokapi_extra_storage_volumes = var.enable_gcs_storage_volume ? [
  { name = "storage", mount_path = "/data", read_only = false }
] : []
```

- **Sur Cloud Run**, il n'existe aucune notion de PVC/stockage en mode bloc ;
  `Gokapi_CloudRun` laisse donc `enable_gcs_storage_volume` à sa valeur par défaut
  `true` et n'expose aucune variable pour le désactiver — le montage GCS Fuse sur
  `/data` est le **seul** chemin de persistance dont dispose Gokapi sur cette
  plateforme. La base de données SQLite (`GOKAPI_CONFIG_DIR`) comme chaque fichier
  téléversé (`GOKAPI_DATA_DIR`) résident sur ce montage. GCS Fuse ne fournit pas
  de véritable verrouillage de fichiers POSIX, ce qui constitue un risque réel
  pour une application adossée à SQLite — voir les sections sur les pièges de
  [Gokapi_CloudRun](Gokapi_CloudRun.md#6-configuration-pitfalls--sensible-defaults).
- **Sur GKE**, `Gokapi_GKE` utilise par défaut un véritable PVC en mode bloc
  (`stateful_pvc_enabled = true`, ce qui résout aussi automatiquement
  `workload_type` en `StatefulSet`), monté sur le même chemin `/data`. Pour
  éviter un conflit de double montage sur ce chemin, le wrapper GKE définit
  `enable_gcs_storage_volume = false` dès que le PVC de StatefulSet est actif —
  le bucket `storage` est donc toujours créé (à condition que `create_cloud_storage =
  true`) mais reste **inutilisé**, sauf si un opérateur désactive explicitement
  `stateful_pvc_enabled`, auquel cas le volume GCS Fuse de ce module se réactive
  sur le même chemin de montage.

Les volumes supplémentaires fournis par l'appelant (`var.gcs_volumes`) sont
concaténés avant le montage `storage` propre à ce module dans la liste
`gcs_volumes` transmise au socle, si bien qu'un montage personnalisé ne
remplace jamais le montage du bucket `storage`.

Listez le bucket (présent sur les deux plateformes, monté uniquement selon la
logique ci-dessus) :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
```

---

Pour la configuration propre à Gokapi et destinée aux utilisateurs (variables par
groupe, sorties, et comment explorer chaque service depuis la console et la CLI),
consultez les guides de plateforme : **[Gokapi_GKE](Gokapi_GKE.md)** et
**[Gokapi_CloudRun](Gokapi_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Gokapi sur Google Cloud Run](Gokapi_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Gokapi sur GKE Autopilot](Gokapi_GKE.md) — cette configuration déployée sur GKE.
