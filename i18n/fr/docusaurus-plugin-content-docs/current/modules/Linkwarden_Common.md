---
title: "Linkwarden Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Linkwarden — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Linkwarden_Common.md @ 3055034 sha256:76e085ce38d4 -->

# Linkwarden Common — Configuration applicative partagée {#linkwarden-common--shared-application-configuration}

`Linkwarden_Common` est la **couche applicative partagée** de Linkwarden. Elle
n'est pas déployée seule ; elle fournit la configuration propre à Linkwarden sur
laquelle s'appuient à la fois [Linkwarden_GKE](Linkwarden_GKE.md) et
[Linkwarden_CloudRun](Linkwarden_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais directement cette couche — elle ne possède aucune
entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation des
plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Linkwarden, consultez
les guides des plateformes ([Linkwarden_GKE](Linkwarden_GKE.md),
[Linkwarden_CloudRun](Linkwarden_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Linkwarden_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `NEXTAUTH_SECRET` (50 caractères) et le stocke dans **Secret Manager** | Injecté automatiquement en tant que variable d'environnement secrète ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `ghcr.io/linkwarden/linkwarden` avec un point d'entrée cloud ; build via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | Définit le job du premier déploiement (`db-init`) qui crée le rôle et la base de données et accorde les privilèges | Sortie `initialization_jobs` |
| Migrations du schéma | Délègue au `CMD` propre à l'image, qui exécute `prisma migrate deploy` à chaque démarrage du conteneur | §Comportement de l'application dans les guides des plateformes |
| Stockage d'objets | Déclare un bucket **Cloud Storage**, monté par les modules applicatifs sur `/data/data` (le chemin `STORAGE_FOLDER` résolu par Linkwarden) | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement Linkwarden de référence : télémétrie désactivée, taille des lots d'archivage, activation du navigateur | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde par défaut ciblant `/` (aucun point de terminaison de santé dédié confirmé) | §Observabilité dans les guides des plateformes |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est
jamais défini en clair et ne doit jamais être modifié après le premier
déploiement :

- **`NEXTAUTH_SECRET`** — une chaîne aléatoire de 50 caractères
  (`secret-<prefix>-linkwarden-nextauth-secret`). Signe les JWT de session
  NextAuth. Sa rotation après le premier démarrage invalide immédiatement toutes
  les sessions actives et oblige tous les utilisateurs à se reconnecter.

Linkwarden n'a **aucun super-utilisateur pré-créé** — le premier utilisateur qui
s'inscrit via le flux d'inscription NextAuth standard devient le propriétaire de
l'instance. `NEXTAUTH_SECRET` est injecté dans le conteneur du service en tant que
variable d'environnement secrète via la sortie `secret_ids`.

Récupérez le secret après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~nextauth-secret"

# Read the secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ;
le nom de son secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé des secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Linkwarden nécessite **PostgreSQL** (ce module fige **PostgreSQL 15**) ; le moteur
est imposé et MySQL ou les autres moteurs ne sont pas pris en charge — le schéma
Prisma de Linkwarden code en dur `provider = "postgresql"`. Lors du premier
déploiement, un job ponctuel (`db-init`) s'exécute avec `postgres:15-alpine`
et, de manière idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy (ou l'hôte sur IP privée) et le
   fait correspondre pour l'accès via `psql`,
2. Attend que PostgreSQL soit joignable,
3. Crée (ou met à jour) le rôle applicatif (`linkwarden`) avec `LOGIN CREATEDB` et
   le mot de passe généré,
4. Crée la base de données applicative (`linkwarden`) si elle n'existe pas,
5. Accorde tous les privilèges sur la base de données et sur le schéma `public`
   (PostgreSQL 15 n'accorde plus `CREATE` sur `public` par défaut),
6. Signale au Cloud SQL Auth Proxy de s'arrêter proprement afin que le pod du
   job se termine.

`db-init` crée uniquement le rôle et la base de données — il ne crée **pas** les
tables. Linkwarden exécute ses propres migrations du schéma
(`prisma migrate deploy`) à chaque démarrage du conteneur (dans le cadre du `CMD`
propre à l'image de base) ; le schéma est donc créé et maintenu à jour par
l'application elle-même, et non par un job de migration distinct. Le job peut
être réexécuté sans risque.

Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=linkwarden --database=linkwarden --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est une fine surcouche `FROM ghcr.io/linkwarden/linkwarden:<tag>`.
Le tag de base est contrôlé par l'ARG de build `LINKWARDEN_VERSION`, propre à
l'application (**et non** le générique `APP_VERSION` injecté par le socle) —
Linkwarden publie réellement un tag `latest` en amont ; aucun repli sur une version
figée n'est donc nécessaire. La surcouche ajoute un point d'entrée cloud
(`entrypoint.sh`) qui s'exécute avant le démarrage propre à l'image de base :

- **Compose `DATABASE_URL`** — le client Prisma de Linkwarden lit une URL DSN
  unique avec une partie « authority », et le mot de passe de la base de données est
  une valeur Secret Manager obtenue à l'exécution qui ne peut pas être interpolée
  dans une URL au moment du plan. Le chemin du répertoire du socket Unix Cloud SQL
  contient des deux-points qui cassent l'analyse de la partie « authority » de
  l'URL ; le point d'entrée ne l'insère donc délibérément jamais dans l'URL — il se
  connecte toujours via la variable `DB_IP` injectée, en ne distinguant que le cas
  où l'hôte résolu est l'interface de bouclage :
  - `127.0.0.1`/`localhost` (le sidecar Auth Proxy sur GKE) → `sslmode=disable`,
  - toute autre adresse (l'IP privée réelle de Cloud SQL, sur Cloud Run) →
    `sslmode=require` (Cloud SQL refuse le TCP non chiffré sur IP privée).
- **Dérive `NEXTAUTH_URL`** — ajoute le suffixe requis `/api/v1/auth` à
  `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`, déjà résolu, que le socle injecte au
  démarrage du conteneur (jamais un modèle littéral `$(VAR)`, que Cloud Run
  transmet sans l'interpréter).
- **Définit `PORT` (3000, s'il n'est pas défini) et `HOSTNAME` (`0.0.0.0`)**.
- **Passe la main au CMD propre à l'image de base** — `prisma migrate deploy`
  suivi de `concurrently`, qui exécute côte à côte le serveur web Next.js
  (`next start`) et le worker d'archivage en arrière-plan (`worker.ts`) dans le
  même conteneur. Ce CMD est redéclaré à l'identique dans le Dockerfile, car la
  déclaration d'un `ENTRYPOINT` personnalisé supprime le `CMD` hérité de l'image de
  base (confirmé via `docker inspect`).

Comme le point d'entrée et le Dockerfile sont intégrés à l'image, leur modification
nécessite une reconstruction de l'image ; le script `db-init` est monté au moment de
l'apply et prend effet à l'apply suivant sans reconstruction.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Linkwarden_Common` établit l'environnement Linkwarden de référence afin que
l'application démarre correctement dès le premier lancement :

- **Port** — Linkwarden (Next.js) écoute sur `3000` ; `EXPOSE 3000` dans l'image.
- **Télémétrie** — `NEXT_TELEMETRY_DISABLED = "1"`.
- **Inscription** — Linkwarden n'a aucun identifiant administrateur pré-créé ; le
  **premier utilisateur qui s'inscrit devient le propriétaire de l'instance** via le
  flux d'inscription NextAuth standard.
- **Worker d'archivage** — le worker en arrière-plan (lancé via `concurrently` aux
  côtés du serveur web) interroge directement PostgreSQL et traite les liens en file
  d'attente par lots (`ARCHIVE_TAKE_COUNT`, `5` par défaut) — il n'y a aucune
  dépendance externe à une file d'attente ou à Redis.
- **Chrome headless** — intégré à l'image (Playwright,
  `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`) pour l'archivage des captures d'écran,
  PDF et monoliths, et s'exécutant DANS le même processus que le serveur web.
  `DISABLE_BROWSER` peut être défini pour ignorer toutes les tâches d'archivage
  dépendant du navigateur, en guise de repli si Chrome headless se comporte mal dans
  un environnement d'exécution en bac à sable.

Ajustements propres à chaque plateforme gérés par le point d'entrée :

- **Cloud Run** — `DATABASE_URL` se connecte via `DB_IP` (l'IP privée réelle de
  Cloud SQL) avec `sslmode=require` ; `NEXTAUTH_URL` est dérivé de
  `CLOUDRUN_SERVICE_URL`.
- **GKE** — `DATABASE_URL` se connecte via le sidecar Cloud SQL Auth Proxy sur
  `127.0.0.1` avec `sslmode=disable` ; `NEXTAUTH_URL` est dérivé de
  `GKE_SERVICE_URL`.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Linkwarden ne dispose d'aucun point de terminaison de contrôle de santé dédié
confirmé ; les sondes par défaut ciblent donc `/` avec une fenêtre de démarrage
généreuse pour absorber le démarrage à froid de Next.js ainsi que l'initialisation
de Chrome headless/Playwright lors de la première requête.

- **Cloud Run** utilise une sonde HTTP sur `/` avec une longue fenêtre de seuil
  d'échec.
- **GKE** utilise des sondes HTTP de démarrage et de vivacité sur le même chemin ;
  le large seuil d'échec de la sonde de démarrage couvre les migrations Prisma du
  premier démarrage ainsi que l'initialisation de Chrome.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket **Cloud Storage** dédié est déclaré ici et provisionné par le socle, qui
accorde également l'accès au compte de service de la charge de travail. Les modules
applicatifs (`Linkwarden_CloudRun`/`Linkwarden_GKE`) le montent par défaut en tant
que volume GCS Fuse sur `/data/data` — le chemin vers lequel le code de stockage
propre à Linkwarden résout `STORAGE_FOLDER` (vérifié sur la sortie compilée de
l'image construite : `path.join(process.cwd(), "../..", STORAGE_FOLDER)`, que les
processus web et worker résolvent tous deux vers la même racine `/data` bien qu'ils
s'exécutent depuis des répertoires de travail différents). Listez le bucket avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Linkwarden exposée à l'utilisateur (variables par
groupe, sorties et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Linkwarden_GKE](Linkwarden_GKE.md)** et
**[Linkwarden_CloudRun](Linkwarden_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Linkwarden sur Google Cloud Run](Linkwarden_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Linkwarden sur GKE Autopilot](Linkwarden_GKE.md) — cette configuration déployée sur GKE.
