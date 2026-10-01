---
title: "Navidrome Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Navidrome — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Navidrome_Common.md @ 3055034 sha256:ee2409d055b6 -->

# Navidrome Common — Configuration applicative partagée {#navidrome-common--shared-application-configuration}

`Navidrome_Common` est la **couche applicative partagée** de Navidrome. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Navidrome sur laquelle
s'appuient à la fois [Navidrome_GKE](Navidrome_GKE.md) et
[Navidrome_CloudRun](Navidrome_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais cette couche directement — elle n'a aucune entrée propre
dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Navidrome, consultez les
guides des plateformes ([Navidrome_GKE](Navidrome_GKE.md),
[Navidrome_CloudRun](Navidrome_CloudRun.md)) et les guides de fondation
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Navidrome_Common | Où cela apparaît |
|---|---|---|
| Amorçage de l'administrateur | Lorsque `enable_admin_password = true` (**par défaut**), génère un mot de passe aléatoire de 24 caractères, le stocke dans **Secret Manager** et l'injecte sous `ND_DEVAUTOCREATEADMINPASSWORD` afin que l'utilisateur `admin` soit créé automatiquement au premier démarrage | Injecté automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `deluan/navidrome` dans une enveloppe légère afin que la fondation puisse la mettre en miroir dans Artifact Registry | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | **Aucun** — Navidrome utilise une base de données SQLite embarquée sous `/data` (`database_type = "NONE"`) | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | **Aucun** — il n'y a pas de job `db-init` ; Navidrome gère son propre stockage | n/a |
| Stockage objet | Déclare le bucket **Cloud Storage** `storage` qui sert de support à `/data` sur Cloud Run | Sortie `storage_buckets` |
| Paramètres de base | Définit `ND_DATAFOLDER = /data`, `ND_MUSICFOLDER = /music`, `ND_PORT = 4533` et le port du conteneur `4533` | Comportement de l'application dans les guides des plateformes |
| Contrôles d'état | Fournit les sondes de démarrage/de vivacité par défaut ciblant `/ping` | §Observabilité dans les guides des plateformes |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Contrairement à une application adossée à une base de données, Navidrome n'a **aucune
clé de chiffrement ni secret de signature JWT** à gérer — les comptes utilisateurs et
les sessions résident dans sa base de données SQLite embarquée. Le seul secret géré
par cette couche est le **mot de passe administrateur du premier lancement**,
conditionné par `enable_admin_password` (par défaut `true`) :

- Lorsque `enable_admin_password = true` (valeur par défaut), une valeur aléatoire de
  24 caractères (`special = false`) est générée et stockée dans Secret Manager sous le
  nom `secret-<wrapper_prefix>-navidrome-admin-password`. Elle est injectée dans le
  conteneur sous la variable d'environnement **`ND_DEVAUTOCREATEADMINPASSWORD`**, qui
  indique à Navidrome de créer automatiquement l'utilisateur `admin` avec ce mot de
  passe lors de son premier démarrage. Le nom d'utilisateur est fixé à `admin`.
- Lorsque `enable_admin_password = false`, aucun secret n'est créé et la table des
  secrets du module est vide — vous créez alors le premier administrateur via
  l'assistant web de premier lancement de Navidrome lors du premier accès.

Le mot de passe est transmis à la charge de travail sous forme de **valeur brute**
plutôt que par une lecture de source de données Secret Manager — la couche Common
l'expose via la sortie `secret_values`, que le wrapper Cloud Run transmet sous
`module_explicit_secret_values` et que le wrapper GKE transmet sous
`explicit_secret_values` (en matérialisant un Secret Kubernetes natif). La sortie
`secret_ids` associe `ND_DEVAUTOCREATEADMINPASSWORD → <secret id>` et la sortie
`admin_password_secret_id` expose l'ID du secret (vide lorsque
`enable_admin_password = false`).

Récupérez le mot de passe administrateur généré après le déploiement :

```bash
# List the admin-password secret for this deployment:
gcloud secrets list --project "$PROJECT" --filter="name~navidrome-admin-password"

# Read the password (log in as user "admin" with this value):
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Un utilitaire de nettoyage des secrets orphelins (`cleanup_orphaned_secrets`) supprime
un secret de mot de passe administrateur obsolète portant le même nom avant de le
recréer, afin que les redéploiements n'échouent pas sur `409 already exists`.
Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de
Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Navidrome n'utilise **pas** de base de données externe. Tout son état — l'index de la
bibliothèque musicale, les comptes utilisateurs, les playlists, les compteurs
d'écoute et les paramètres — réside dans une **base de données SQLite embarquée**
écrite sous `/data` (`ND_DATAFOLDER`). Par conséquent :

- `database_type = "NONE"` — aucune instance, base de données ni utilisateur Cloud SQL
  n'est créé pour Navidrome.
- Il n'y a **aucun job `db-init`** — Navidrome crée et migre son propre fichier SQLite
  au premier démarrage ; rien ne doit être amorcé à l'avance.
- Aucune extension PostgreSQL, ni `pgvector`, ni Redis n'est impliqué
  (`enable_postgres_extensions = false`).

Comme la base de données est un fichier sur le volume persistant `/data`, sa
durabilité dépend du backend de stockage, et non d'un service de base de données géré
(voir §5 et §7). Si vous avez besoin de tâches personnalisées de chargement ou de
migration de données, vous pouvez fournir vos propres `initialization_jobs` ; aucun
n'est fourni par défaut.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

Navidrome utilise un **Dockerfile d'enveloppe légère** — il n'ajoute aucun script de
point d'entrée personnalisé et exécute sans modification la commande de démarrage de
l'image amont :

```dockerfile
ARG NAVIDROME_VERSION=0.54.3
FROM deluan/navidrome:${NAVIDROME_VERSION}
```

- **`image_source = "custom"`** — ce paramètre est défini uniquement pour que la
  fondation construise/mette en miroir l'image dans Artifact Registry ; aucun code
  applicatif n'est ajouté par-dessus. Le build s'exécute via Cloud Build (Kaniko) et
  met le résultat en miroir dans le dépôt Artifact Registry partagé.
- **ARG de build propre à l'application** — le Dockerfile lit `NAVIDROME_VERSION`, et
  **non** l'`APP_VERSION` générique que la fondation injecte (et qui forcerait
  `latest`). Lorsque `application_version = "latest"`, la couche Common fixe le build
  sur `0.54.3` ; sinon, elle transmet directement la version demandée.
- **Aucune traduction de point d'entrée** — comme Navidrome n'a besoin d'aucun
  câblage de base de données ni de réécriture d'URL au démarrage, le démarrage par
  défaut de l'image amont est utilisé tel quel.

---

## 5. Paramètres de base de l'application {#5-core-application-settings}

`Navidrome_Common` établit l'environnement minimal dont Navidrome a besoin pour
démarrer la première fois et écrire son état sur le volume persistant (les
`environment_variables` fournies par l'utilisateur l'emportent sur ces valeurs par
défaut) :

- **`ND_DATAFOLDER = "/data"`** — dirige la base de données SQLite, le cache de
  métadonnées et l'index de recherche de Navidrome vers le volume persistant. Tout ce
  que Navidrome persiste réside sous ce répertoire unique.
- **`ND_MUSICFOLDER = "/music"`** — la bibliothèque musicale que Navidrome analyse. Ce
  chemin n'est **pas** monté automatiquement par le module ; fournissez la collection
  musicale via un montage `gcs_volumes` supplémentaire ou un montage NFS sur `/music`
  (voir les guides des plateformes). Navidrome le traite comme un contenu source en
  lecture seule.
- **`ND_PORT = "4533"`** — le port HTTP sur lequel Navidrome écoute, correspondant au
  `container_port` du module.

Montage de `/data` selon la plateforme :

- **Cloud Run** monte le bucket Cloud Storage `storage` sur `/data` via GCS FUSE
  (`enable_gcs_storage_volume = true`).
- **GKE** avec `stateful_pvc_enabled = true` (valeur par défaut) monte un **PVC en
  mode bloc** sur `/data` et définit `enable_gcs_storage_volume = false` pour éviter
  un double montage sur le même chemin. gcsfuse ne peut pas servir de support fiable à
  la base de données SQLite embarquée ; GKE utilise donc un stockage en mode bloc.

---

## 6. Comportement des sondes d'état {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité émettent toutes deux une **requête HTTP GET
`/ping`**, qui renvoie `{"status":"ok"}` avec un statut `200` et ne nécessite **aucune
authentification** — les sondes réussissent donc dès que le serveur HTTP est
opérationnel, indépendamment de toute connexion administrateur.

- **Sonde de démarrage** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`,
  `failure_threshold = 10`.
- **Sonde de vivacité** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`,
  `failure_threshold = 3`.

---

## 7. Stockage objet {#7-object-storage}

Un unique bucket **Cloud Storage** est déclaré ici et provisionné par la fondation,
qui accorde également l'accès au compte de service de la charge de travail :

- **`name_suffix = "storage"`**, classe de stockage **STANDARD**, `force_destroy = true`,
  gestion des versions désactivée, avec `public_access_prevention = "enforced"`. Son
  `location` est laissé vide afin que la fondation le résolve vers la région de
  déploiement découverte automatiquement (ce qui évite un remplacement forcé dû à un
  emplacement immuable lors d'une réapplication dans une autre région).
- Sur Cloud Run, il sert de support à `/data` via GCS FUSE ; il contient donc la base
  de données SQLite, le cache de métadonnées, l'index de recherche et les journaux de
  Navidrome.

Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

**Remarque sur le type de stockage.** Le répertoire `/data` de Navidrome sollicite
fortement SQLite et nécessite des E/S aléatoires à faible latence. Sur GKE, le PVC en
mode bloc (`stateful_pvc_enabled = true`) est le plus adapté et constitue la valeur
par défaut. Le montage GCS FUSE de Cloud Run convient à un usage léger/personnel mais
présente une latence plus élevée ; une bibliothèque très sollicitée ou volumineuse se
porte bien mieux sur le PVC en mode bloc de GKE.

---

Pour la configuration propre à Navidrome destinée aux utilisateurs (variables par
groupe, sorties, et comment explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Navidrome_GKE](Navidrome_GKE.md)** et
**[Navidrome_CloudRun](Navidrome_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Navidrome sur Google Cloud Run](Navidrome_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Navidrome sur GKE Autopilot](Navidrome_GKE.md) — cette configuration déployée sur GKE.
