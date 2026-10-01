---
title: "OnlyOffice Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module OnlyOffice — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/OnlyOffice_Common.md @ 3055034 sha256:473bcd0b1eb9 -->

# OnlyOffice Common — Configuration applicative partagée {#onlyoffice-common--shared-application-configuration}

`OnlyOffice_Common` est la **couche applicative partagée** d'ONLYOFFICE Document
Server. Elle n'est pas déployée seule ; elle fournit la configuration propre à ONLYOFFICE
sur laquelle s'appuient [OnlyOffice_GKE](OnlyOffice_GKE.md) et
[OnlyOffice_CloudRun](OnlyOffice_CloudRun.md), de sorte que les deux variantes de plateforme
se comportent de façon identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement —
elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Document Server, consultez les
guides des plateformes ([OnlyOffice_GKE](OnlyOffice_GKE.md),
[OnlyOffice_CloudRun](OnlyOffice_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par OnlyOffice_Common | Où cela apparaît |
|---|---|---|
| Secret cryptographique | Génère un `JWT_SECRET` de 48 caractères et le stocke dans **Secret Manager** | Injecté automatiquement ; récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Construit une fine surcouche **FROM `onlyoffice/documentserver`** avec un point d'entrée cloud ; l'image amont est mise en miroir dans Artifact Registry, puis reconstruite via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme moteur pris en charge (Document Server prend en charge PostgreSQL 12 et plus ; MySQL n'est pas pris en charge) | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Cache | Requiert un **Redis externe** (`REDIS_SERVER_HOST`) pour l'état partagé d'édition et de session ; le RabbitMQ embarqué reste interne, sur localhost | §Redis dans les guides des plateformes |
| Stockage objet | Déclare un bucket **Cloud Storage** (suffixe `storage`) | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement de base de Document Server : signature JWT, type de base de données, WOPI désactivé | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde par défaut de démarrage/vivacité/disponibilité ciblant `/healthcheck` | §Observabilité dans les guides des plateformes |

---

## 2. Secret cryptographique dans Secret Manager {#2-cryptographic-secret-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est jamais défini
en clair et ne doit jamais être modifié après le premier déploiement :

- **`JWT_SECRET`** — une chaîne aléatoire de 48 caractères (sans caractères spéciaux). ONLYOFFICE
  Document Server signe chaque requête d'API interne entre ses propres composants avec
  ce secret (`JWT_ENABLED = "true"`), et toute application hôte qui intègre
  l'éditeur (Nextcloud, ownCloud, Confluence, SharePoint, une intégration personnalisée) doit être
  configurée avec le **même** secret. Le générer une seule fois et l'épingler dans Secret
  Manager le maintient stable à travers les redémarrages, les redéploiements et toutes les instances en cours d'exécution
  (sur le modèle du `SECRET_KEY_BASE` de Chatwoot). Sa rotation une fois les intégrations
  configurées rompt la confiance entre Document Server et chaque application hôte
  jusqu'à ce que toutes soient mises à jour avec la nouvelle valeur.

Le secret est nommé `secret-<resource-prefix>-onlyoffice-jwt-secret`. Récupérez-le
après le déploiement :

```bash
# List the JWT secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~onlyoffice-jwt-secret"

# Read the secret value (needed to configure the host application that embeds the editor):
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le nom de son
secret est indiqué dans les sorties du déploiement de la plateforme (`database_password_secret`).
Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Document Server requiert **PostgreSQL** (12 ou plus récent) ; le module fixe
`database_type = POSTGRES_15`. MySQL et les autres moteurs ne sont pas pris en charge et sont
rejetés par une garde de validation au moment du plan. Lors du premier déploiement, un job ponctuel
(`db-init`) s'exécute avec `postgres:15-alpine` et, de manière idempotente :

1. Résout l'hôte Cloud SQL — le répertoire du socket Unix de l'Auth Proxy (Cloud Run) ou
   le sidecar proxy sur `127.0.0.1` (GKE), avec repli sur l'IP privée de l'instance,
2. Attend que PostgreSQL soit joignable,
3. Crée (ou met à jour) le rôle applicatif avec `LOGIN CREATEDB` et le mot de passe
   généré,
4. Crée la base de données de l'application (propriété de `postgres`, car le superutilisateur de Cloud SQL
   ne peut pas faire `SET ROLE` vers des rôles applicatifs),
5. Accorde tous les privilèges sur la base de données et le schéma `public` à l'utilisateur de l'application,
6. Signale au Cloud SQL Auth Proxy de s'arrêter proprement afin que le pod du Job se termine.

Le job **se contente de provisionner le rôle, la base de données et les droits** — Document Server
installe son propre schéma (toutes les tables) au premier démarrage, aucune étape de migration n'est donc exécutée ici.
Le job peut être relancé sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

`onlyoffice/documentserver` est une image Ubuntu lourde, « tout compris », qui embarque
PostgreSQL, Redis, RabbitMQ (AMQP) et nginx sous `supervisord`. Ce module construit
une fine surcouche par-dessus et fait pointer Document Server vers PostgreSQL et Redis **externes**,
en ne laissant que RabbitMQ en interne, sur localhost :

- **Image de base** — `FROM onlyoffice/documentserver:<pinned>`. Comme le socle
  injecte `APP_VERSION` dans les arguments de build et l'emporte lors de la fusion, le Dockerfile dérive
  plutôt son tag de base d'un argument de build propre à l'application, `ONLYOFFICE_VERSION` — une
  `application_version` valant `latest` est épinglée à `8.3.3` au moment du build afin que le tag de base
  se résolve toujours.
- **Dupliquée puis reconstruite** — l'image amont de Docker Hub est mise en miroir dans Artifact
  Registry (`enable_image_mirroring = true`), puis reconstruite via Cloud Build sous forme de
  surcouche (`image_source = "custom"`).
- **`cloud-entrypoint.sh`** s'exécute avant le lanceur amont et fait correspondre les
  variables injectées par le socle à la convention propre à Document Server :
  - `DB_PWD` est défini à partir de `DB_PASSWORD`, et `DB_TYPE` est forcé à `postgres`
    (`DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER` correspondent déjà par leur nom) ; `DB_HOST` accepte
    directement le répertoire du socket Cloud SQL, ou se rabat sur `DB_IP`.
  - `REDIS_SERVER_HOST` / `REDIS_SERVER_PORT` (et `REDIS_SERVER_PASS`) sont définis à partir des
    `REDIS_HOST` / `REDIS_PORT` / `REDIS_AUTH` injectés.
  - Il exécute ensuite (`exec`) le lanceur amont `/app/ds/run-document-server.sh`, qui
    installe le schéma au premier démarrage et lance nginx / docservice / converter sous
    `supervisord`.

L'image est basée sur Ubuntu et fournit `bash`, de sorte qu'un point d'entrée `#!/bin/bash` s'exécute
proprement (aucune greffe busybox n'est nécessaire).

- **Correctif au moment du build de la porte de disponibilité amont (propre à Cloud Run)** — le
  Dockerfile corrige aussi par `sed -i` le script `/app/ds/run-document-server.sh` lui-même, et pas seulement
  `cloud-entrypoint.sh`. Sur Cloud Run, `DB_HOST` est un **répertoire** de socket Unix du Cloud SQL Auth Proxy
  (`/cloudsql/<instance>`) — la vraie connexion à la base l'accepte sans problème
  (node-postgres et psql traitent tous deux un chemin de répertoire comme un hôte valide), mais le script
  amont possède sa propre porte de disponibilité préalable distincte, `waiting_for_connection()`,
  qui exécute inconditionnellement `nc -z "$DB_HOST" "$DB_PORT"`. `nc` ne peut pas résoudre un
  chemin de système de fichiers comme hôte TCP, de sorte que sans le correctif il boucle indéfiniment — en répétant
  `Waiting for connection to the /cloudsql/... host on port 5432` dans les journaux — et le
  conteneur ne devient jamais Ready. Le `sed -i` du Dockerfile réécrit la porte pour qu'elle
  réussisse immédiatement lorsque `$1` est un répertoire existant (le montage du socket) ;
  les vrais hôtes TCP (le sidecar proxy `127.0.0.1` de GKE, ou tout nom d'hôte/IP) passent toujours
  par le contrôle `nc` d'origine, inchangé, de sorte que GKE n'est pas concerné. Une assertion `grep -q`
  placée immédiatement après le `sed` fait échouer bruyamment le Cloud Build si une future
  montée de `ONLYOFFICE_VERSION` modifie la formulation du script amont — si cela
  se produit, la solution est de mettre à jour le motif `sed` dans
  `modules/OnlyOffice_Common/scripts/Dockerfile` pour qu'il corresponde à la nouvelle formulation.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`OnlyOffice_Common` établit l'environnement de base de Document Server afin que
l'application démarre correctement dès le premier lancement :

- **Type de base de données** — `DB_TYPE = "postgres"`.
- **Signature JWT** — `JWT_ENABLED = "true"`, `JWT_HEADER = "Authorization"`,
  `JWT_IN_BODY = "true"` ; le secret lui-même (`JWT_SECRET`) est injecté depuis Secret
  Manager. Il signe tous les appels d'API internes et constitue le même jeton que l'application
  hôte doit présenter.
- **WOPI** — `WOPI_ENABLED = "false"` (le protocole WOPI est désactivé sur un déploiement de base ;
  activez-le via `environment_variables` uniquement lors d'une intégration avec un hôte WOPI tel que
  SharePoint).
- **Port** — le conteneur écoute sur le **port 80** (nginx à l'intérieur de l'image).

Les opérateurs peuvent ajouter des paramètres supplémentaires via l'entrée `environment_variables`
de la plateforme ; ils sont fusionnés par-dessus ces valeurs par défaut.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent **`/healthcheck`** — le point de terminaison de Document Server qui
ne renvoie `true` qu'une fois nginx et les services de documents démarrés et la base de données
joignable. Comme l'image est lourde (Postgres/Redis/RabbitMQ/nginx embarqués sous
`supervisord`) et lente à être prête, le budget de démarrage est volontairement généreux :

- **Sonde de démarrage** — HTTP `/healthcheck`, délai initial de 90 secondes, période de 15 secondes,
  40 échecs autorisés (≈10 minutes de marge au premier démarrage pour l'installation du schéma).
- **Sonde de vivacité** — HTTP `/healthcheck`, délai initial de 120 secondes, période de 30 secondes.
- **Sonde de disponibilité** — HTTP `/healthcheck`, délai initial de 30 secondes, période de 10 secondes.

Faire pointer une sonde vers un chemin qui n'est pas accessible publiquement empêcherait la
révision ou le pod de devenir Ready même après le démarrage de l'application — `/healthcheck` est
servi sans authentification et constitue la bonne cible.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket **Cloud Storage** dédié (déclaré avec le suffixe de nom `storage`) est
déclaré ici et provisionné par le socle, qui accorde également l'accès au compte de service
de la charge de travail. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

Sur GKE, le répertoire de données propre à Document Server est en outre adossé à un PVC en mode bloc
et à un montage NFS partagé — consultez [OnlyOffice_GKE](OnlyOffice_GKE.md) pour le modèle
de persistance.

---

Pour la configuration propre à ONLYOFFICE destinée aux utilisateurs (variables par groupe, sorties
et manière d'explorer chaque service depuis la console et la CLI), consultez les guides des plateformes :
**[OnlyOffice_GKE](OnlyOffice_GKE.md)** et
**[OnlyOffice_CloudRun](OnlyOffice_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [OnlyOffice sur Google Cloud Run](OnlyOffice_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [OnlyOffice sur GKE Autopilot](OnlyOffice_GKE.md) — cette configuration déployée sur GKE.
