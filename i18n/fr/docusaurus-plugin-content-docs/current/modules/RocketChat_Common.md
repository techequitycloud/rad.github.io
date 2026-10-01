---
title: "Rocket.Chat Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Rocket.Chat — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/RocketChat_Common.md @ 3055034 sha256:43d1b178ba15 -->

# Rocket.Chat Common — Configuration applicative partagée {#rocketchat-common--shared-application-configuration}

`RocketChat_Common` est la **couche applicative partagée** de Rocket.Chat. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Rocket.Chat sur laquelle
s'appuie [RocketChat_GKE](RocketChat_GKE.md). Les utilisateurs finaux ne configurent
jamais directement cette couche — elle n'a aucune entrée d'interface de déploiement
propre — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous
voyez dans la documentation de la plateforme.

**GKE uniquement.** Rocket.Chat embarque son propre replica set MongoDB (`rs0`), qui
nécessite un véritable périphérique bloc pour WiredTiger — le modèle de stockage de
Cloud Run (uniquement des volumes adossés à gcsfuse) ne peut pas le supporter, et chaque
tentative de déploiement sur cette plateforme échoue aux sondes de démarrage sur des
erreurs fallocate de WiredTiger. `RocketChat_CloudRun` a été retiré du catalogue pour
cette raison ; déployez plutôt sur GKE Autopilot avec `stateful_pvc_enabled = true`.

Pour l'infrastructure qui provisionne et exécute réellement Rocket.Chat, consultez le
guide de plateforme [RocketChat_GKE](RocketChat_GKE.md) et les guides du socle
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par RocketChat_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Encapsule l'image officielle `rocketchat/rocket.chat`, y intègre un **replica set MongoDB 6.0** à nœud unique et un point d'entrée personnalisé ; build via Cloud Build | Sortie `container_image` du déploiement de plateforme |
| Stockage de données | Fixe `database_type = "NONE"` — pas de Cloud SQL. La base MongoDB de Rocket.Chat est intégrée au conteneur | §Stockage de données dans les guides de plateforme |
| Persistance | Déclare le bucket de données **Cloud Storage** et monte le répertoire de données MongoDB (`/data/db`) sur un stockage persistant (PVC sur GKE, volume GCS sur Cloud Run) | Sortie `storage_buckets` |
| Amorçage du replica set | Le point d'entrée initialise le replica set `rs0` au premier démarrage et attend qu'il atteigne l'état `PRIMARY` avant de lancer Rocket.Chat | Comportement de l'application dans les guides de plateforme |
| Paramètres principaux | Définit l'environnement de base de Rocket.Chat : `MONGO_URL`, `MONGO_OPLOG_URL`, `ROOT_URL`, `PORT`, `MONGO_DBPATH` | Comportement de l'application dans les guides de plateforme |
| Jeton d'API facultatif | Génère une clé d'API aléatoire dans **Secret Manager** lorsque `enable_api_key = true` (injectée sous le nom de variable d'environnement `QDRANT__SERVICE__API_KEY` — un vestige du module à partir duquel celui-ci a été cloné ; le point d'entrée de Rocket.Chat ne la lit pas) | Sorties `api_key_secret_id` / `secret_ids` |
| Contrôles de santé | Fournit la sonde de démarrage/d'activité par défaut ciblant `/api/info` | §Observabilité dans les guides de plateforme |

---

## 2. Pourquoi le replica set MongoDB est intégré {#2-why-the-mongodb-replica-set-is-embedded}

Rocket.Chat est une application Node.js/Meteor, et la réactivité en temps réel de Meteor
repose sur le **suivi de l'oplog MongoDB**. Un `mongod` autonome n'a pas d'oplog ;
Rocket.Chat *exige* donc un **replica set** MongoDB — pas n'importe quelle instance
MongoDB. Aucun des stockages de données gérés de cette plateforme (Cloud SQL,
Memorystore) ne fournit de replica set MongoDB ; `RocketChat_Common` intègre donc un
**replica set à nœud unique (`rs0`) dans l'image de conteneur** et l'exécute aux côtés
de l'application :

- MongoDB et Rocket.Chat communiquent via **`127.0.0.1`** au sein du même
  conteneur/pod ; le replica set peut ainsi annoncer `127.0.0.1:27017` et les clients du
  même conteneur suivent l'hôte annoncé sans DNS inter-Service à résoudre.
- L'image dérive de `rocketchat/rocket.chat`, basée sur **Debian bullseye**
  (glibc 2.31). Le Dockerfile installe donc **MongoDB 6.0 depuis le dépôt APT
  bullseye** — le paquet bookworm / MongoDB 7.0 nécessite glibc ≥ 2.34 et ne s'installe
  pas sur l'image de base de Rocket.Chat.
- Le répertoire de données MongoDB `/data/db` (`MONGO_DBPATH`) est monté sur un
  **stockage bloc persistant**. Sur GKE, il s'agit d'un PVC de StatefulSet ; sur Cloud
  Run, d'un volume adossé à GCS. **Le moteur de stockage WiredTiger de MongoDB exige un
  véritable système de fichiers bloc** — consultez les guides de plateforme pour la mise
  en garde sur le stockage.

Le point d'entrée (`scripts/entrypoint.sh`) s'exécute à chaque démarrage du conteneur et
est idempotent :

1. Démarre `mongod --replSet rs0 --bind_ip 127.0.0.1 --dbpath /data/db` en
   arrière-plan,
2. Attend que `mongod` accepte les connexions,
3. Initialise le replica set (`rs.initiate`) une seule fois — ignoré s'il est déjà
   initialisé,
4. Attend que le nœud signale `isWritablePrimary`,
5. Exporte `MONGO_URL=mongodb://127.0.0.1:27017/rocketchat?replicaSet=rs0` et
   `MONGO_OPLOG_URL=mongodb://127.0.0.1:27017/local?replicaSet=rs0`,
6. Définit `ROOT_URL` sur l'URL de service calculée et `PORT=3000`,
7. Lance Rocket.Chat avec `exec node main.js`.

---

## 3. Image de conteneur et point d'entrée {#3-container-image-and-entrypoint}

L'image personnalisée encapsule `rocketchat/rocket.chat:<version>` et ajoute le serveur
MongoDB, le shell `mongosh` et le point d'entrée cloud. Deux détails de build comptent :

- **ARG de version propre à l'application.** Le Dockerfile lit un argument de build
  `ROCKETCHAT_VERSION`, *et non* l'`APP_VERSION` générique qu'injecte le socle (qui le
  forcerait à `latest`). Lorsque `application_version = "latest"`, `RocketChat_Common`
  épingle le build sur une version éprouvée (`6.12.1`) ; épinglez `application_version`
  sur un tag précis pour des déploiements reproductibles.
- **Intégré à l'image.** Le point d'entrée, l'installation de MongoDB et l'épinglage de
  version sont tous intégrés à l'image personnalisée — les modifier nécessite un nouveau
  build (incrémentez `application_version`), pas seulement un nouvel apply.

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`RocketChat_Common` établit l'environnement de base de Rocket.Chat afin que l'application
démarre correctement dès le premier démarrage :

- **`MONGO_DBPATH = "/data/db"`** — le répertoire de données MongoDB, monté sur un
  stockage persistant pour que les discussions, utilisateurs et paramètres survivent aux
  redémarrages.
- **`MONGO_URL` / `MONGO_OPLOG_URL`** — définis par le point d'entrée une fois que le
  replica set intégré atteint l'état `PRIMARY` ; tous deux pointent vers
  `127.0.0.1:27017` avec `replicaSet=rs0`.
- **`ROOT_URL`** — l'adresse par laquelle le navigateur atteint Rocket.Chat ; par défaut,
  l'URL de service Cloud Run / GKE calculée. Les opérateurs la remplacent par un domaine
  personnalisé.
- **`PORT = 3000`** — Rocket.Chat écoute sur le port 3000.
- **`OVERWRITE_SETTING_Show_Setup_Wizard = "pending"`** — garde l'assistant de
  configuration initiale disponible lors d'un premier démarrage propre sans interface.

Aucun secret applicatif cryptographique n'est généré ici — contrairement aux applications
adossées à une base de données, Rocket.Chat crée ses propres clés pendant la
configuration initiale et les stocke dans sa propre base MongoDB. Le seul secret
facultatif est le jeton d'API ci-dessous.

---

## 5. Jeton d'API facultatif dans Secret Manager {#5-optional-api-token-in-secret-manager}

Lorsque `enable_api_key = true`, un jeton aléatoire de 32 caractères est généré et stocké
dans **Secret Manager** (nom du secret `secret-<prefix>-<app>-api-key`). Il est exposé via
les sorties `api_key_secret_id` et `secret_ids` afin de pouvoir être injecté dans le
conteneur ou utilisé par des intégrations externes. Lorsque `enable_api_key = false` (la
valeur par défaut), aucun secret n'est créé.

**Mise en garde — nom de variable d'environnement vestigial.** Les sorties
`secret_ids`/`secret_values` indexent le jeton sous `QDRANT__SERVICE__API_KEY`, un nom
hérité du module à partir duquel celui-ci a été cloné (la convention de clé d'API
REST/gRPC de Qdrant), et non un véritable paramètre de Rocket.Chat. `RocketChat_GKE` — la
seule variante restante — fait transiter la valeur par `explicit_secret_values` plutôt
que par `module_secret_env_vars`, car une clé brute `QDRANT__SERVICE__API_KEY` ne peut
pas être représentée comme `targetKey` de SecretSync sur GKE, qui interdit les
underscores consécutifs. (Le `RocketChat_CloudRun` désormais retiré l'injectait plutôt
sous ce nom littéral de variable d'environnement, Cloud Run n'ayant ni CRD SecretSync ni
une telle restriction.)
Dans tous les cas, le point d'entrée et le code applicatif de Rocket.Chat ne lisent
jamais cette variable — l'API REST de Rocket.Chat s'authentifie via les en-têtes
`X-Auth-Token`/`X-User-Id` émis à la connexion ou via des jetons d'accès personnels créés
dans l'interface d'administration, et non via une variable d'environnement statique.
Considérez `enable_api_key` comme « créer un jeton dans Secret Manager pour vos propres
outils externes », et non comme un réglage qui modifie le comportement d'authentification
de l'API de Rocket.Chat.

Récupérez-le après le déploiement :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~api-key"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est déclaré ici et provisionné par
le socle, qui accorde également l'accès au compte de service de la charge de travail. Sur
Cloud Run, il supporte le volume de données MongoDB ; sur GKE, il est disponible pour les
sauvegardes et le stockage des fichiers téléversés, en complément du PVC du StatefulSet.
Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

## 7. Comportement des sondes de santé {#7-health-probe-behaviour}

Les sondes par défaut ciblent **`/api/info`** — le point de terminaison d'information de
Rocket.Chat, qui renvoie une charge utile JSON (version et état) une fois le serveur
entièrement initialisé et connecté à son replica set MongoDB. Une fenêtre de démarrage
généreuse laisse le temps à l'élection du replica set et aux migrations de démarrage de
Rocket.Chat lors du premier lancement.

- **Sonde de démarrage** — HTTP `GET /api/info`, délai initial de 15 secondes, période
  de 10 secondes, fenêtre de 10 tentatives.
- **Sonde d'activité** — HTTP `GET /api/info`, délai initial de 30 secondes, période de
  30 secondes, fenêtre de 3 tentatives.

---

Pour la configuration propre à Rocket.Chat destinée aux utilisateurs (variables par
groupe, sorties et manière d'explorer chaque service depuis la console et la CLI),
consultez le guide de plateforme : **[RocketChat_GKE](RocketChat_GKE.md)**. (Il n'existe
pas de `RocketChat_CloudRun` — consultez la note en haut de ce guide pour comprendre
pourquoi Cloud Run ne peut pas supporter la base MongoDB intégrée de Rocket.Chat.)

<!-- related-guides -->

## Guides associés {#related-guides}

- [Rocket.Chat sur GKE Autopilot](RocketChat_GKE.md) — cette configuration déployée sur GKE.
