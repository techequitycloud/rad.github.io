---
title: "Filebrowser Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Filebrowser — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Filebrowser_Common.md @ 3055034 sha256:8bb7714f837d -->

# Filebrowser Common — Configuration applicative partagée {#filebrowser-common--shared-application-configuration}

`Filebrowser_Common` est la **couche applicative partagée** de File Browser. Elle
n'est pas déployée seule ; elle fournit la configuration propre à Filebrowser sur
laquelle s'appuie [Filebrowser_GKE](Filebrowser_GKE.md). Elle servait auparavant
aussi une variante Cloud Run, retirée en septembre 2026 — voir la remarque
ci-dessous. Les utilisateurs finaux ne configurent jamais cette couche directement
— elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre
ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la
documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Filebrowser, consultez
le guide de la plateforme ([Filebrowser_GKE](Filebrowser_GKE.md)) et les guides du
socle ([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

> **Depuis septembre 2026, Filebrowser est disponible uniquement sur GKE.** File
> Browser stocke ses utilisateurs, ses paramètres et ses liens de partage dans une
> base de données bbolt embarquée, qui conserve un verrou exclusif pendant toute la
> durée de vie du processus. Cloud Run maintient une révision active même après que
> le trafic l'a quittée ; la révision sortante ne libérait donc jamais ce verrou et
> toutes les révisions suivantes échouaient au démarrage — le service pouvait être
> déployé une fois, mais jamais mis à jour. GKE n'est pas concerné : un StatefulSet
> arrête l'ancien pod avant de démarrer le nouveau.

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Filebrowser_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | **Aucun.** Filebrowser stocke ses utilisateurs et l'identifiant administrateur initial dans sa propre base de données SQLite embarquée ; aucune variable d'environnement Secret Manager n'est générée | Les sorties `secret_ids` / `secret_values` sont volontairement vides |
| Image de conteneur | Encapsule finement l'image officielle `filebrowser/filebrowser` au moyen d'un Dockerfile de deux lignes ; construite avec Cloud Build (Kaniko) et mise en miroir dans Artifact Registry | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose `database_type = "NONE"` — Filebrowser utilise un fichier **SQLite embarqué**, pas Cloud SQL | §Persistance dans les guides des plateformes |
| Initialisation de la base de données | **Aucune.** Aucun job `db-init` n'est injecté ; `initialization_jobs` est vide, sauf si l'opérateur fournit des jobs personnalisés | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare un bucket **Cloud Storage** (suffixe `storage`) qui contient le montage persistant `/database` (la base SQLite) | Sortie `storage_buckets` |
| Paramètres principaux | Définit `FB_DATABASE = /database/filebrowser.db` et `FB_ROOT = /srv`, et fixe le conteneur sur le port 80 | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde de démarrage/d'activité par défaut ciblant `/health` | §Observabilité dans les guides des plateformes |

---

## 2. Secrets — aucun {#2-secrets--none}

Filebrowser n'a besoin d'**aucune variable d'environnement secrète**. Contrairement
aux applications adossées à une base de données, il conserve sa table des
utilisateurs, ses paramètres et ses liens de partage dans sa propre base de données
SQLite embarquée (`/database/filebrowser.db`). L'identifiant initial est la
connexion bien connue **`admin` / `admin`**, que l'opérateur doit modifier via
l'interface web dès le premier accès.

Par conséquent, les sorties `secret_ids` et `secret_values` de la couche Common sont
volontairement des maps vides, et les deux variantes les transmettent sans
modification (`module_secret_env_vars = secret_ids`,
`module_explicit_secret_values = secret_values`). Il n'existe aucune clé de
chiffrement ni aucun secret JWT à préserver d'un redéploiement à l'autre — le seul
état durable est le fichier SQLite sur le volume `/database` (voir §5).

---

## 3. Image de conteneur et build {#3-container-image-and-build}

L'image personnalisée est une **fine surcouche de deux lignes** sur la version
d'origine de Filebrowser, afin que le socle puisse la mettre en miroir dans Artifact
Registry :

```dockerfile
ARG FILEBROWSER_VERSION=v2.32.0
FROM filebrowser/filebrowser:${FILEBROWSER_VERSION}
```

- **ARG de build propre à l'application.** Le Dockerfile lit `FILEBROWSER_VERSION`,
  **et non** l'`APP_VERSION` générique injecté par le socle (qui imposerait
  `latest`). Lorsque `application_version = "latest"`, Common résout l'argument de
  build vers la version épinglée `v2.32.0` ; sinon, il transmet le tag demandé. Un
  déploiement `latest` reste ainsi reproductible au lieu de suivre un tag amont qui
  évolue.
- **Cloud Build (Kaniko).** L'image est construite via `cloudbuild.yaml` avec
  l'exécuteur Kaniko et poussée dans le dépôt Artifact Registry partagé du
  déploiement, puis utilisée par le service Cloud Run / la charge de travail GKE.
- **Aucun point d'entrée personnalisé.** Le point d'entrée de l'image d'origine
  lance directement le serveur Go de Filebrowser ; il n'existe aucun script
  intermédiaire pour remapper les variables.

---

## 4. Initialisation de la base de données — aucune {#4-database-initialization--none}

Filebrowser gère son propre stockage et ne nécessite **aucune initialisation de base
de données**. Aucun job `db-init` n'est injecté, et `database_type` est fixé à
`NONE`. L'entrée `initialization_jobs` n'est prise en compte que si l'opérateur
fournit des jobs personnalisés (par exemple pour alimenter l'arborescence servie
en fichiers) — sinon elle reste vide.

Au premier démarrage, le binaire Filebrowser crée sa base de données SQLite à
`FB_DATABASE = /database/filebrowser.db` si le fichier n'existe pas encore, crée
l'utilisateur par défaut `admin`/`admin` et commence à servir l'arborescence de
fichiers dont la racine est `FB_ROOT = /srv`.

---

## 5. Stockage d'objets et persistance {#5-object-storage-and-persistence}

Un unique bucket **Cloud Storage** (suffixe de nom `storage`) est déclaré ici et
provisionné par le socle, qui accorde également l'accès au compte de service de la
charge de travail. Il est monté dans le conteneur sur **`/database`**, où réside la
base de données SQLite embarquée — ainsi, les utilisateurs, les paramètres et les
liens de partage survivent aux redémarrages et à la mise à l'échelle à zéro.

- **Cloud Run** monte toujours ce bucket en tant que volume **GCS FUSE** sur
  `/database` (`enable_gcs_storage_volume = true`).
- **GKE** monte le même bucket en tant que volume GCS FUSE, **sauf** si un PVC bloc
  de StatefulSet est utilisé sur le même chemin (`stateful_pvc_enabled = true`) ;
  dans ce cas, Common définit `enable_gcs_storage_volume = false` pour éviter un
  conflit de double montage — c'est alors le PVC qui fournit `/database`.

L'emplacement du bucket est laissé vide afin que le socle le résolve vers la région
de déploiement découverte automatiquement (`coalesce(bucket.location, region)`), ce
qui évite le remplacement forcé du bucket, dont l'emplacement est immuable, lors
d'un nouvel apply dans une autre région.

Listez le bucket avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
```

---

## 6. Paramètres principaux de l'application {#6-core-application-settings}

`Filebrowser_Common` établit l'environnement de base afin que l'application démarre
correctement dès le premier lancement :

- **`FB_DATABASE = /database/filebrowser.db`** — fait pointer la base de données
  SQLite embarquée vers le montage persistant `/database`.
- **`FB_ROOT = /srv`** — l'arborescence de fichiers que Filebrowser sert et gère.
- **Port du conteneur 80** — l'écouteur HTTP/1.1 par défaut de Filebrowser (en
  cohérence avec `container_port`).
- **Première connexion** — `admin` / `admin` ; modifiez-le immédiatement dans
  l'interface web.

Les variables non secrètes supplémentaires fournies via `environment_variables` sont
fusionnées par-dessus ces valeurs par défaut.

---

## 7. Comportement des sondes de santé {#7-health-probe-behaviour}

Les sondes de démarrage et d'activité par défaut ciblent **`/health`** — le point de
terminaison de santé non authentifié de Filebrowser, qui renvoie `200` dès que le
serveur écoute. Comme il n'y a ni migration de base de données ni étape de schéma au
premier lancement, le serveur est rapidement prêt ; la sonde de démarrage utilise un
délai initial de 15 secondes avec une fenêtre de 10 tentatives, et la sonde
de vivacité un délai de 30 secondes.

---

Pour la configuration propre à Filebrowser visible par l'utilisateur (variables par
groupe, sorties et exploration de chaque service depuis la console et la CLI),
consultez le guide de la plateforme : **[Filebrowser_GKE](Filebrowser_GKE.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Filebrowser sur GKE Autopilot](Filebrowser_GKE.md) — cette configuration déployée sur GKE.
