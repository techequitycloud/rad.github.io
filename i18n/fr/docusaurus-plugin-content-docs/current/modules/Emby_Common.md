---
title: "Emby Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Emby — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Emby_Common.md @ 3055034 sha256:1eb81b19a33a -->

# Emby Common — Configuration applicative partagée {#emby-common--shared-application-configuration}

`Emby_Common` est la **couche applicative partagée** d'Emby. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Emby sur laquelle
reposent à la fois [Emby_GKE](Emby_GKE.md) et
[Emby_CloudRun](Emby_CloudRun.md), afin que les deux variantes de plateforme
se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Emby, consultez les
guides de plateforme ([Emby_GKE](Emby_GKE.md),
[Emby_CloudRun](Emby_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Emby_Common | Où cela apparaît |
|---|---|---|
| Authentification | **Aucun secret généré obligatoire** — le compte administrateur est créé via l'assistant de configuration initiale d'Emby | Interface web d'Emby au premier accès |
| Clé d'API facultative | Lorsque `enable_api_key = true`, génère une clé d'API aléatoire de 32 caractères et la stocke dans **Secret Manager**, injectée sous la forme `EMBY_API_KEY` | Injectée automatiquement ; récupérez-la via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsulation légère de l'image officielle `emby/embyserver` afin que le socle puisse la répliquer dans Artifact Registry | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | **Aucun** — Emby utilise des bases SQLite internes sous `/config` (`database_type = "NONE"`) | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | **Aucun** — il n'y a pas de job `db-init` ; Emby gère son propre stockage | n/a |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `storage` qui sert de support à `/config` sur Cloud Run | Sortie `storage_buckets` |
| Paramètres principaux | Définit `EMBY_CONFIG_DIR = /config` et le port de conteneur `8096` | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit les sondes de démarrage/vivacité par défaut sous forme de contrôles **TCP** sur le port 8096 (aucun chemin de santé HTTP confirmé) | §Observabilité dans les guides de plateforme |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Emby n'a **aucun secret généré obligatoire**. Contrairement aux applications
adossées à une base de données, il n'utilise ni clé de chiffrement ni secret de signature JWT —
l'authentification est entièrement configurée via l'**assistant de configuration initiale**, où
vous créez le compte administrateur lors du premier accès à l'interface web.

Le **seul secret facultatif** est une clé d'API, conditionnée par `enable_api_key`
(par défaut `false`) :

- Lorsque `enable_api_key = true`, une valeur aléatoire de 32 caractères est générée et stockée
  dans Secret Manager sous le nom `secret-<prefix>-<app>-api-key` (par exemple
  `secret-<prefix>-emby-api-key`), puis injectée dans le conteneur sous la forme `EMBY_API_KEY`
  via le mécanisme `module_secret_env_vars` du socle, sur Cloud Run comme sur GKE.
- Lorsque `enable_api_key = false` (valeur par défaut), aucun secret n'est créé et la table des
  secrets du module est vide.

**Remarque.** Emby lui-même ne dispose d'aucune variable d'environnement documentée qui consomme `EMBY_API_KEY` au démarrage
— comme Jellyfin (le module à partir duquel celui-ci a été cloné), les clés d'API propres à Emby sont
créées et gérées via un appel authentifié au Dashboard/REST (**Dashboard → API
Keys**). Ce secret existe pour que les opérateurs disposent d'un identifiant stable, adossé à Secret Manager,
à fournir à des clients d'API externes s'ils choisissent de créer une clé équivalente
dans l'application ; il est délibérément nommé avec un seul tiret bas (contrairement au nom de
configuration imbriquée de style `QDRANT__SERVICE__API_KEY` hérité de la source du clone) afin d'être
aussi une `targetKey` GKE SecretSync valide et de passer par le chemin normal
`module_secret_env_vars` sur les deux plateformes, sans câblage spécifique.

Récupérez le secret après le déploiement (uniquement lorsque `enable_api_key = true`) :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~api-key"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Consultez [App_Common](App_Common.md) pour le modèle partagé des secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Emby n'utilise **pas** de base de données externe. Tout son état — l'index de la
médiathèque, les comptes utilisateurs, l'historique de lecture et les paramètres — réside dans des **bases
SQLite internes** écrites sous `/config`. Par conséquent :

- `database_type = "NONE"` — aucune instance, base de données ni utilisateur Cloud SQL n'est créé pour
  Emby.
- Il n'y a **pas de job `db-init`** — Emby initialise ses propres fichiers SQLite au premier
  démarrage ; rien ne doit être amorcé à l'avance.
- Aucune extension PostgreSQL, aucun `pgvector` et aucun Redis ne sont impliqués.

Comme les bases de données sont des fichiers sur le volume persistant `/config`, leur durabilité dépend
du backend de stockage, et non d'un service de base de données géré (voir §5 et §7). Si
vous avez besoin de tâches personnalisées de chargement de données ou de migration, vous pouvez fournir vos propres
`initialization_jobs` ; aucun n'est fourni par défaut.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

Emby utilise un **Dockerfile d'encapsulation légère** — il n'ajoute aucun script de point d'entrée
personnalisé et exécute sans modification le point d'entrée propre à l'image amont (basé sur s6-overlay) :

```dockerfile
ARG EMBY_VERSION=4.10.0.15
FROM emby/embyserver:${EMBY_VERSION}
```

- **`image_source = "custom"`** — ce réglage sert uniquement à ce que le socle
  construise/mette en miroir l'image dans Artifact Registry ; aucun code applicatif n'est
  ajouté par-dessus.
- **ARG de build propre à l'application** — le Dockerfile lit `EMBY_VERSION`, **et non** l'`APP_VERSION`
  générique que le socle injecte (et qu'elle forcerait à `latest`).
  Lorsque `application_version = "latest"`, la couche Common fige le build sur
  `4.10.0.15` ; sinon, elle transmet directement la version demandée.
- **Aucune traduction du point d'entrée** — comme Emby n'a besoin d'aucun câblage de base de données ni de réécriture
  d'URL au démarrage, le démarrage par défaut de l'image amont est utilisé tel quel. Une vérification locale
  par `docker build` + `docker run` a confirmé que l'image démarre proprement avec
  seulement `EMBY_CONFIG_DIR` défini, atteint la logique de démarrage propre à Emby Server et renvoie
  une redirection 302 vers l'assistant de configuration sur `/`.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Emby_Common` établit l'environnement minimal dont Emby a besoin pour démarrer au
premier lancement et écrire son état sur le volume persistant :

- **`EMBY_CONFIG_DIR = "/config"`** — oriente la configuration d'Emby, ses bases
  SQLite, ses métadonnées, ses plugins, son cache de transcodage et ses journaux vers le volume persistant.
  Tout ce qu'Emby conserve réside dans ce répertoire unique.
- **Port de conteneur `8096`** — Emby sert le HTTP sur le port 8096 par défaut, ce qui correspond
  au `container_port` du module.
- **Aucun paramètre de télémétrie, de file d'attente ni de mode d'exécution** — il n'y a rien d'autre à
  configurer au démarrage ; le reste de la configuration (compte administrateur, médiathèques) s'effectue via
  l'assistant de configuration initiale de l'interface web.

Montage de `/config` selon la plateforme :

- **Cloud Run** monte le bucket Cloud Storage `storage` sur `/config` via GCS FUSE
  (`enable_gcs_storage_volume = true`).
- **GKE** avec `stateful_pvc_enabled = true` monte un PVC en mode bloc sur `/config` et définit
  `enable_gcs_storage_volume = false` pour éviter un double montage sur le même chemin.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité sont toutes deux des contrôles **TCP** sur le port 8096, et non HTTP.
Contrairement à Jellyfin (la source du clone, qui documente un point de terminaison `/health` non authentifié
renvoyant `200`), Emby n'a **aucun point de terminaison de santé HTTP non authentifié confirmé et
documenté** — un test sur un conteneur actif a montré que `/health` renvoie `404`, tandis que `/`
répond par une redirection `302` vers l'assistant de configuration, ce qui confirme que le serveur est
à l'écoute mais exclut un chemin HTTP comme cible de sonde. Le contrôle TCP réussit dès que
l'écouteur d'Emby se lie au port, indépendamment de tout chemin ou comportement d'authentification
qui n'a pas été vérifié en amont.

- **Sonde de démarrage** — port TCP 8096, `initial_delay = 15s`, `timeout = 5s`,
  `period = 10s`, `failure_threshold = 10`.
- **Sonde de vivacité** — port TCP 8096, `initial_delay = 30s`, `timeout = 5s`,
  `period = 30s`, `failure_threshold = 3`.

---

## 7. Stockage d'objets {#7-object-storage}

Un seul bucket **Cloud Storage** est déclaré ici et provisionné par le socle,
qui accorde également l'accès au compte de service de la charge de travail :

- **`name_suffix = "storage"`**, classe de stockage **STANDARD**, avec
  `public_access_prevention = "enforced"`.
- Sur Cloud Run, il sert de support à `/config` via GCS FUSE ; il contient donc les bases SQLite
  d'Emby, ses métadonnées, son cache et ses journaux.

Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

**Remarque sur le type de stockage.** Un serveur multimédia a idéalement besoin d'un **stockage en mode bloc** pour son
répertoire `/config` très sollicité par SQLite et pour son cache de transcodage. Sur GKE, le PVC en mode bloc
(`stateful_pvc_enabled = true`) est la meilleure option — des E/S aléatoires à faible latence sur les
fichiers SQLite. Le montage GCS FUSE de Cloud Run fonctionne, mais sa latence est plus élevée et il convient mieux
à un usage léger ; les médiathèques volumineuses et le transcodage actif s'accommodent bien mieux du
PVC en mode bloc de GKE.

Le PVC en mode bloc de GKE utilise par défaut la StorageClass `standard-rwo` adossée à des SSD, qui
consomme le quota régional restreint `SSD_TOTAL_GB` — et la mise à l'échelle de l'application à zéro ne
libère **pas** le PVC, si bien qu'une série de modules avec état peut épuiser ce quota.
Emby correspond exactement au cas multimédia/SQLite concerné : il n'a pas besoin des IOPS des SSD ;
sur un projet soumis à des contraintes de quota, basculez donc vers des HDD avec
`-var stateful_pvc_storage_class=standard` (`pd-standard`, qui consomme à la place le quota
bien plus large `DISKS_TOTAL_GB`) — il s'agit toujours d'un véritable périphérique en mode bloc, ce qui préserve
l'intégrité du verrouillage en écriture de SQLite pour laquelle le PVC en mode bloc existe.

---

## 8. Licence Emby Premiere (à titre informatif uniquement) {#8-emby-premiere-licensing-informational-only}

Cette couche ne touche jamais aux licences — le sujet est documenté ici parce que c'est la question la plus
fréquente lorsqu'on compare ce module à `Jellyfin_Common`. Le serveur auto-hébergé de base d'Emby
(toute la surface de ce module : lecture, analyse des médiathèques, assistant de
configuration et transcodage logiciel) ne nécessite **aucune clé de licence ni aucun
compte emby.media**. **Emby Premiere** est un abonnement payant distinct et facultatif,
souscrit dans l'interface web d'Emby après le déploiement ; il débloque le transcodage
accéléré par matériel, les applications clientes complètes pour mobile/TV, le DVR/la TV en direct et la synchronisation hors ligne. Aucune
de ces restrictions n'est appliquée ni contournée par ce module — elles n'affectent que ce que
l'*opérateur* choisit de débloquer après le déploiement, et non le fait que le module se déploie ou que le
serveur démarre.

---

Pour la configuration propre à Emby destinée aux utilisateurs (variables par groupe,
sorties, et comment explorer chaque service depuis la Console et la CLI), consultez les guides
de plateforme : **[Emby_GKE](Emby_GKE.md)** et
**[Emby_CloudRun](Emby_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Emby sur Google Cloud Run](Emby_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Emby sur GKE Autopilot](Emby_GKE.md) — cette configuration déployée sur GKE.
