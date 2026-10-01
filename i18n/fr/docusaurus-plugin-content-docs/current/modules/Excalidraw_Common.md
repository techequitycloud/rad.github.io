---
title: "Excalidraw Common — Configuration applicative partagée"
description: "Référence de configuration partagée du module Excalidraw — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Excalidraw_Common.md @ 3055034 sha256:299e52686ef1 -->

# Excalidraw Common — Configuration applicative partagée {#excalidraw-common--shared-application-configuration}

`Excalidraw_Common` est la **couche applicative partagée** d'Excalidraw. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Excalidraw sur laquelle
s'appuient à la fois [Excalidraw_GKE](Excalidraw_GKE.md) et
[Excalidraw_CloudRun](Excalidraw_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais cette couche directement — elle n'a aucune entrée propre
dans l'interface de déploiement —, mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Excalidraw est un tableau blanc virtuel open source (MIT) permettant d'esquisser des
diagrammes au style dessiné à la main. La distribution auto-hébergée est une
**application monopage statique servie par nginx** — il n'y a ni backend, ni base de
données, ni comptes utilisateurs, ni persistance côté serveur. Les dessins résident
dans le navigateur même du visiteur (stockage local) et sont exportés/importés sous
forme de fichiers `.excalidraw`. Le module est donc exceptionnellement léger : ni
secrets, ni Cloud SQL, ni stockage objet, ni cache.

Pour l'infrastructure qui provisionne et exécute effectivement Excalidraw, consultez
les guides des plateformes ([Excalidraw_GKE](Excalidraw_GKE.md),
[Excalidraw_CloudRun](Excalidraw_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Excalidraw_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Fine **surcouche personnalisée** `FROM excalidraw/excalidraw:<version>` ; le build se contente de mettre en miroir la SPA statique dans Artifact Registry | Sortie `container_image` du déploiement de la plateforme |
| Port du conteneur | Fixe le **port 80** — l'écouteur nginx de l'image | §Réseau dans les guides des plateformes |
| Moteur de base de données | **Aucun** (`database_type = "NONE"`). Excalidraw n'a pas de backend et ne stocke aucune donnée côté serveur | Aucune instance Cloud SQL n'est créée |
| Secrets | **Aucun** — `secret_ids` et `secret_values` sont des maps vides | Rien n'est écrit dans Secret Manager |
| Stockage objet | **Aucun** — `storage_buckets` et `gcs_volumes` sont vides | Aucun bucket GCS n'est provisionné |
| Cache / file d'attente | **Aucun** — pas de Redis, pas de file de messages | — |
| Amorçage de la base de données | **Aucun** — il n'y a pas de jobs d'initialisation (`initialization_jobs = []`) | La sortie `initialization_jobs` est vide |
| Épinglage de version | Définit un ARG de build propre à l'application, `EXCALIDRAW_VERSION`, afin que le `APP_VERSION` injecté par le socle ne puisse pas écraser le tag — mais `application_version = "latest"` se résout toujours en `"latest"` (pas d'épinglage ; `pinned_excalidraw_version` vaut lui-même `"latest"`) | `container_build_config.build_args` |
| Vérifications de santé | Fournit les sondes de démarrage, de vivacité et de disponibilité (readiness) par défaut, qui ciblent le chemin racine `/` | §Observabilité dans les guides des plateformes |

---

## 2. Image de conteneur {#2-container-image}

L'image est une **fine surcouche personnalisée** plutôt qu'une simple référence à une
image préconstruite. Le `Dockerfile` tient en deux lignes utiles :

```dockerfile
ARG EXCALIDRAW_VERSION=latest
FROM excalidraw/excalidraw:${EXCALIDRAW_VERSION}
EXPOSE 80
```

- **Image de base :** `excalidraw/excalidraw` — la SPA nginx statique officielle
  publiée sur Docker Hub. Il n'y a pas de serveur d'application : nginx sert le bundle
  frontend compilé sur le port 80.
- **Pourquoi une surcouche personnalisée :** le build existe pour **mettre en miroir**
  l'image amont dans l'Artifact Registry du projet (`enable_image_mirroring = true` par
  défaut), afin que le déploiement ne dépende ni de la disponibilité de Docker Hub ni
  de ses quotas de pull, et que les règles Binary Authorization / CMEK s'appliquent à
  une image locale au projet.
- **Piège de l'épinglage de version (pourquoi `EXCALIDRAW_VERSION` et non
  `APP_VERSION`) :** le socle injecte `APP_VERSION = application_version` dans
  `build_args` et **l'emporte** lors de toute fusion, si bien qu'un `APP_VERSION`
  défini au niveau Common serait silencieusement écrasé par `latest`. Le tag de base
  d'Excalidraw est donc dérivé d'un ARG de build **propre à l'application**,
  `EXCALIDRAW_VERSION`, auquel le socle ne touche pas. Contrairement à certains modules
  voisins, cela n'épingle **pas** `latest` sur un tag éprouvé : `main.tf` définit
  `pinned_excalidraw_version = "latest"`, de sorte que `application_version = "latest"`
  (la valeur par défaut de la campagne) se résout à nouveau en `"latest"` et que le
  build suit le tag glissant `excalidraw/excalidraw:latest` de Docker Hub. Définissez
  un tag explicite (p. ex. `v1.11.86`) pour réellement épingler une version de
  production.

Inspectez les arguments de build résolus sans déployer :

```bash
# From within Excalidraw_CloudRun or Excalidraw_GKE:
tofu console
> module.excalidraw_app.config.container_build_config.build_args
```

---

## 3. Base de données, secrets et stockage objet — volontairement vides {#3-database-secrets-and-object-storage--intentionally-empty}

Le frontend Excalidraw auto-hébergé étant entièrement côté client, cette couche ne
déclare **aucune** des primitives avec état qu'utilisent les autres modules
applicatifs :

- **`database_type = "NONE"`** — pas d'instance Cloud SQL, pas de job `db-init`, pas
  de schéma.
- **`secret_ids = {}` / `secret_values = {}`** — rien n'est écrit dans Secret Manager.
  Il n'y a ni clés de chiffrement, ni secrets JWT, ni mots de passe de base de données
  à protéger, et donc aucun à renouveler.
- **`storage_buckets = []` / `gcs_volumes = []`** — aucun bucket GCS n'est provisionné
  et aucun volume GCS Fuse n'est monté.
- **`initialization_jobs = []`** — il n'y a pas d'étape d'amorçage au premier
  déploiement ; le service est prêt dès que nginx démarre.

Vous pouvez confirmer les sorties vides depuis le module de plateforme :

```bash
tofu console
> module.excalidraw_app.secret_ids       # {}
> module.excalidraw_app.storage_buckets   # []
```

Par conséquent, les commandes CLI que vous utiliseriez normalement pour inspecter une
base de données, lister des secrets ou parcourir un bucket pour cette application ne
renverront rien — c'est le comportement attendu, et non une erreur de configuration.

---

## 4. Configuration d'exécution et variables résiduelles {#4-runtime-configuration-and-vestigial-variables}

Excalidraw n'a besoin d'**aucune configuration d'exécution propre à chaque
déploiement** — la même image fonctionne correctement partout. La couche Common
transmet une map `environment_variables` simple (vide par défaut) pour d'éventuelles
surcharges, mais le frontend statique n'en lit aucune à l'exécution.

> **Remarque — entrées Matrix/Element résiduelles.** Ce module a été généré à partir
> du modèle Element ; les deux variantes de plateforme déclarent donc encore les
> entrées `homeserver_url` et `homeserver_name` et les injectent sous forme de
> variables d'environnement `HOMESERVER_URL` / `HOMESERVER_NAME`. La SPA statique
> `excalidraw/excalidraw` **ne lit pas ces valeurs** — ce sont des restes inertes que
> vous pouvez laisser à leurs valeurs par défaut. De même, certaines *descriptions* de
> variables du module font encore référence au « principal client web Matrix » ;
> l'artefact déployé est bien l'image du tableau blanc Excalidraw, comme le confirme la
> ligne `FROM` du `Dockerfile`.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les trois sondes (démarrage, vivacité, disponibilité) effectuent un HTTP GET sur le
**chemin racine `/`**, que nginx sert avec un `200` dès le démarrage du conteneur.
Comme il n'y a aucun backend à initialiser ni aucune migration à exécuter, le service
devient sain presque immédiatement — la fenêtre de démarrage généreuse des autres
modules applicatifs est inutile ici.

- **Sonde de démarrage :** HTTP `/`, délai initial de 10 secondes, fenêtre de 6
  tentatives.
- **Sonde de vivacité :** HTTP `/`, délai initial de 15 secondes, vérification toutes
  les 30 secondes.
- **Sonde de disponibilité :** HTTP `/`, délai initial de 10 secondes, vérification
  toutes les 10 secondes.

Les entrées propres à chaque variante, `Excalidraw_CloudRun` / `Excalidraw_GKE`,
peuvent les remplacer, mais la valeur par défaut sur le chemin racine est adaptée à la
SPA statique et doit rarement être modifiée.

---

Pour la configuration propre à Excalidraw destinée aux utilisateurs (variables par
groupe, sorties, et comment explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Excalidraw_GKE](Excalidraw_GKE.md)** et
**[Excalidraw_CloudRun](Excalidraw_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Excalidraw sur Google Cloud Run](Excalidraw_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Excalidraw sur GKE Autopilot](Excalidraw_GKE.md) — cette configuration déployée sur GKE.
