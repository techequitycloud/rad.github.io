---
title: "Excalidraw Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Excalidraw — paramètres de la couche application utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Excalidraw_Common.md @ 15fd4c7 sha256:49af9125675a -->

# Excalidraw Common — Configuration d'application partagée {#excalidraw-common--shared-application-configuration}

`Excalidraw_Common` est la **couche d'application partagée** pour Excalidraw. Elle n'est pas
déployée seule ; elle fournit la configuration spécifique à Excalidraw sur laquelle
[Excalidraw_GKE](Excalidraw_GKE.md) et
[Excalidraw_CloudRun](Excalidraw_CloudRun.md) s'appuient, afin que les deux variantes de plateforme
se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement —
elle n'a pas d'entrées d'interface utilisateur de déploiement propres — mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Excalidraw est un tableau blanc virtuel open-source (MIT) pour esquisser des diagrammes
de style dessinés à la main. La distribution auto-hébergée est une **application web monopage statique servie
par nginx** — il n'y a pas de backend, pas de base de données, pas de comptes utilisateur et pas de
persistance côté serveur. Les dessins vivent dans le navigateur du visiteur (stockage local) et sont
exportés/importés sous forme de fichiers `.excalidraw`. Cela rend le module exceptionnellement léger : pas de
secrets, pas de Cloud SQL, pas de stockage d'objets et pas de cache. Plusieurs fonctionnalités optionnelles —
collaboration en direct, "Exporter vers un lien", les fonctionnalités de diagramme AI et le navigateur de
bibliothèque de formes — appellent les propres services hébergés d'Excalidraw lorsqu'un utilisateur les invoque ; ces URL sont
compilées dans le bundle amont et ne peuvent pas être redirigées par ce module.

Pour l'infrastructure qui provisionne et exécute Excalidraw, consultez les guides de la plateforme
([Excalidraw_GKE](Excalidraw_GKE.md),
[Excalidraw_CloudRun](Excalidraw_CloudRun.md)) et les guides de base
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Excalidraw_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | **Build personnalisé** léger `FROM excalidraw/excalidraw:<version>` ; le build ne fait que mettre en miroir l'application web monopage statique dans Artifact Registry | Sortie `container_image` du déploiement de la plateforme |
| Port du conteneur | Fixe le **port 80** — le listener nginx à l'intérieur de l'image | §Mise en réseau dans les guides de la plateforme |
| Moteur de base de données | **Aucun** (`database_type = "NONE"`). Excalidraw n'a pas de backend et ne stocke aucune donnée côté serveur | Aucune instance Cloud SQL n'est créée |
| Secrets | **Aucun** — `secret_ids` et `secret_values` sont des maps vides | Rien n'est écrit dans Secret Manager |
| Stockage d'objets | **Aucun** — `storage_buckets` et `gcs_volumes` sont vides | Aucun bucket GCS n'est provisionné |
| Cache / file d'attente | **Aucun** — pas de Redis, pas de file d'attente de messages | — |
| Amorçage de la base de données | **Aucun** — il n'y a pas de jobs d'initialisation (`initialization_jobs = []`) | La sortie `initialization_jobs` est vide |
| Épinglage de version | Définit un ARG de build `EXCALIDRAW_VERSION` spécifique à l'application afin que le `APP_VERSION` injecté par la Fondation ne puisse pas écraser le tag — mais `application_version = "latest"` se résout toujours en `"latest"` (pas d'épinglage ; `pinned_excalidraw_version` est lui-même `"latest"`) | `container_build_config.build_args` |
| Tests de santé | Fournit des sondes de démarrage / vivacité / disponibilité par défaut ciblant le chemin racine `/` | §Observabilité dans les guides de la plateforme |

---

## 2. Image de conteneur {#2-container-image}

L'image est un **build personnalisé léger** plutôt qu'une référence pré-construite directe. Le
`Dockerfile` contient deux lignes de substance :

```dockerfile
ARG EXCALIDRAW_VERSION=latest
FROM excalidraw/excalidraw:${EXCALIDRAW_VERSION}
EXPOSE 80
```

- **Image de base :** `excalidraw/excalidraw` — l'application web monopage statique nginx officielle publiée sur
  Docker Hub. Il n'y a pas de serveur d'application : nginx sert le bundle frontend compilé
  sur le port 80.
- **Pourquoi un build personnalisé :** le build existe pour **mettre en miroir** l'image amont dans
  l'Artifact Registry du projet (`enable_image_mirroring = true` par défaut) afin que le
  déploiement ne dépende pas de la disponibilité de Docker Hub ou des quotas de pull, et afin que les politiques
  d'autorisation binaire / CMEK s'appliquent à une image locale au projet.
- **Piège de l'épinglage de version (pourquoi `EXCALIDRAW_VERSION`, pas `APP_VERSION`) :** la
  Fondation injecte `APP_VERSION = application_version` dans `build_args` et **l'emporte** sur
  toute fusion, de sorte qu'un `APP_VERSION` au niveau Common serait silencieusement écrasé par
  `latest`. Le tag de base d'Excalidraw est donc dérivé d'un ARG de build
  **spécifique à l'application** `EXCALIDRAW_VERSION` que la Fondation ne touche pas. Contrairement à certains modules
  frères, cela **n'épingle pas** `latest` à un tag connu et fonctionnel : `main.tf` définit
  `pinned_excalidraw_version = "latest"`, de sorte que `application_version = "latest"` (la
  valeur par défaut de la campagne) se résout directement en `"latest"` et le build suit le
  tag `excalidraw/excalidraw:latest` roulant de Docker Hub. Définissez un tag explicite (par exemple `v1.11.86`) pour
  épingler réellement une version de production.

Inspectez les arguments de build résolus sans déployer :

```bash
# From within Excalidraw_CloudRun or Excalidraw_GKE:
tofu console
> module.excalidraw_app.config.container_build_config.build_args
```

---

## 3. Base de données, secrets et stockage d'objets — intentionnellement vides {#3-database-secrets-and-object-storage--intentionally-empty}

Parce que le frontend Excalidraw auto-hébergé est entièrement côté client, cette couche
ne déclare **aucun** des primitives avec état utilisées par les autres modules d'application :

- **`database_type = "NONE"`** — pas d'instance Cloud SQL, pas de job `db-init`, pas de schéma.
- **`secret_ids = {}` / `secret_values = {}`** — rien n'est écrit dans Secret Manager.
  Il n'y a pas de clés de chiffrement, de secrets JWT ou de mots de passe de base de données à protéger, et
  donc aucun à faire pivoter.
- **`storage_buckets = []` / `gcs_volumes = []`** — aucun bucket GCS n'est provisionné et aucun
  volume GCS Fuse n'est monté.
- **`initialization_jobs = []`** — il n'y a pas d'étape d'amorçage de premier déploiement ; le service
  est prêt dès que nginx démarre.

Vous pouvez confirmer les sorties vides du module de plateforme :

```bash
tofu console
> module.excalidraw_app.secret_ids       # {}
> module.excalidraw_app.storage_buckets   # []
```

Par conséquent, les commandes CLI que vous utiliseriez normalement pour inspecter une base de données, lister
les secrets ou parcourir un bucket pour cette application ne renverront rien — c'est attendu, pas une
mauvaise configuration.

---

## 4. Configuration d'exécution et variables vestigiales {#4-runtime-configuration-and-vestigial-variables}

Excalidraw n'a besoin d'**aucune configuration d'exécution par déploiement** — la même image sert
correctement partout. La couche Common transmet une map `environment_variables` simple
(vide par défaut) pour des surcharges optionnelles, mais le frontend statique n'en lit aucune
à l'exécution.

> **Note — entrées vestigiales Matrix/Element.** Ce module a été échafaudé à partir du
> modèle Element, de sorte que les deux variantes de plateforme déclarent toujours les entrées `homeserver_url` et
> `homeserver_name` et les injectent comme variables d'environnement `HOMESERVER_URL` / `HOMESERVER_NAME`.
> L'application web monopage statique `excalidraw/excalidraw` **ne lit pas ces
> valeurs** — elles sont un héritage inerte et peuvent être laissées à leurs valeurs par défaut. De même,
> certaines *descriptions* de variables dans le module font toujours référence au "client web Matrix principal" ;
> l'artefact déployé est l'image du tableau blanc Excalidraw, comme le confirme la ligne `Dockerfile` `FROM`.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les trois sondes (démarrage, vivacité, disponibilité) sont des requêtes HTTP GET sur le **chemin racine `/`**,
que nginx sert avec un `200` dès que le conteneur démarre. Comme il n'y a pas de
backend à initialiser ni de migrations à exécuter, le service devient sain presque
immédiatement — la fenêtre de démarrage généreuse des autres modules d'application est
inutile ici.

- **Sonde de démarrage :** HTTP `/`, délai initial de 10 secondes, fenêtre de 6 tentatives.
- **Sonde de vivacité :** HTTP `/`, délai initial de 15 secondes, vérifiée toutes les 30 secondes.
- **Sonde de disponibilité :** HTTP `/`, délai initial de 10 secondes, vérifiée toutes les 10 secondes.

Les entrées `Excalidraw_CloudRun` / `Excalidraw_GKE` par variante peuvent les remplacer, mais
la valeur par défaut du chemin racine est correcte pour l'application web monopage statique et devrait rarement être modifiée.

---

Pour la configuration spécifique à Excalidraw, destinée à l'utilisateur (variables par groupe, sorties,
et comment explorer chaque service depuis la Console et la CLI), consultez les guides de la plateforme :
**[Excalidraw_GKE](Excalidraw_GKE.md)** et
**[Excalidraw_CloudRun](Excalidraw_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Excalidraw sur Google Cloud Run](Excalidraw_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Excalidraw sur GKE Autopilot](Excalidraw_GKE.md) — cette configuration déployée sur GKE.
