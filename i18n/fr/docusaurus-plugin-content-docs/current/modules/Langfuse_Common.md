---
title: "Langfuse Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Langfuse — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Langfuse_Common.md @ 3055034 sha256:aa5f82a9cd2d -->

# Langfuse Common — Configuration applicative partagée {#langfuse-common--shared-application-configuration}

`Langfuse_Common` est la **couche applicative partagée** de Langfuse. Elle
n'est pas déployée seule ; elle fournit la configuration propre à Langfuse
sur laquelle s'appuient à la fois [Langfuse_GKE](Langfuse_GKE.md) et
[Langfuse_CloudRun](Langfuse_CloudRun.md), afin que les deux variantes de
plateforme se comportent de façon identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Langfuse, consultez les
guides de plateforme ([Langfuse_GKE](Langfuse_GKE.md),
[Langfuse_CloudRun](Langfuse_CloudRun.md)) et les guides des socles
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Langfuse_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `NEXTAUTH_SECRET` (50 caractères) et `SALT` (24 caractères) et les stocke dans **Secret Manager** | Injectés automatiquement comme variables d'environnement secrètes ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `langfuse/langfuse:2` (v2, PostgreSQL uniquement) avec un point d'entrée cloud ; construite via Cloud Build | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit la tâche du premier déploiement (`db-init`) qui crée le rôle et la base de données et accorde les droits | Sortie `initialization_jobs` |
| Migrations de schéma | Délègue au démarrage propre de Langfuse, qui exécute `prisma migrate deploy` à chaque démarrage du conteneur | §Comportement de l'application dans les guides de plateforme |
| Stockage d'objets | Déclare un bucket **Cloud Storage** | Sortie `storage_buckets` |
| Paramètres principaux | Définit l'environnement de base de Langfuse : télémétrie désactivée, inscription ouverte pour que le premier utilisateur devienne propriétaire, port 3000 | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de démarrage/de vivacité par défaut ciblant `/api/public/health` | §Observabilité dans les guides de plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager — ils ne sont jamais
définis en clair et ne doivent jamais être modifiés après le premier déploiement :

- **`NEXTAUTH_SECRET`** — une chaîne aléatoire de 50 caractères, stockée sous
  `secret-<prefix>-langfuse-secret-key`. Signe les JWT de session NextAuth. Le renouveler
  après le premier démarrage invalide immédiatement toutes les sessions actives et oblige tous les utilisateurs à se
  reconnecter.
- **`SALT`** — une chaîne aléatoire de 24 caractères, stockée sous
  `secret-<prefix>-langfuse-superuser-password`. Sert à hacher les clés d'API Langfuse avant leur
  persistance. Le renouveler après le premier démarrage invalide définitivement toutes les clés d'API existantes ;
  les clients SDK qui utilisent ces clés reçoivent `401 Unauthorized` jusqu'à la génération de nouvelles clés.

Les deux sont **obligatoires**. Langfuse valide l'ensemble de son environnement avec zod au démarrage et
refuse de démarrer (`Invalid environment variables`) si l'un d'eux manque — c'est la
cause la plus fréquente d'une révision Langfuse qui ne devient jamais Ready. Ils sont injectés
dans le conteneur du service comme variables d'environnement secrètes via la sortie `secret_ids` du module.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key OR name~superuser-password"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le nom de son
secret figure dans les sorties du déploiement de plateforme (`database_password_secret`).
Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Langfuse nécessite **PostgreSQL** ; ce module fixe **PostgreSQL 15**, le moteur est imposé,
et MySQL ou d'autres moteurs ne sont pas pris en charge. Lors du premier déploiement, une tâche ponctuelle
(`db-init`) s'exécute avec `postgres:15-alpine` et, de manière idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy (ou l'hôte à IP privée) et le mappe pour
   l'accès `psql`,
2. Attend que PostgreSQL soit joignable,
3. Crée (ou met à jour) le rôle applicatif (`langfuse`) avec `LOGIN CREATEDB` et le
   mot de passe généré,
4. Crée la base de données applicative (`langfuse`) si elle n'existe pas,
5. Accorde tous les droits sur la base de données et sur le schéma `public` (PostgreSQL 15 n'accorde plus
   `CREATE` sur `public` par défaut),
6. Signale au Cloud SQL Auth Proxy de s'arrêter proprement afin que le pod de la tâche se termine.

**`db-init` crée uniquement le rôle et la base de données — jamais les tables.** Langfuse exécute ses propres
migrations de schéma (`prisma migrate deploy`) à chaque démarrage du conteneur ; le schéma est donc
créé et maintenu à jour par l'application elle-même. Il n'y a délibérément aucune tâche de migration
distincte. La tâche `db-init` peut être relancée sans risque.

Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=langfuse --database=langfuse --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est une fine surcouche `FROM langfuse/langfuse:2` — la branche **v2, PostgreSQL uniquement**.
(Langfuse v3 nécessite en plus ClickHouse, Redis et S3 et sort du périmètre de
ce module.) Le tag de base est contrôlé par l'ARG de build `LANGFUSE_VERSION`, propre à
l'application — délibérément **pas** l'`APP_VERSION` générique que le socle injecte et qui
l'emporterait — de sorte que `application_version = "latest"` se résout en `2` plutôt qu'en un tag inexistant.
La surcouche ajoute un point d'entrée cloud (`entrypoint.sh`) qui s'exécute avant le démarrage
propre de Langfuse :

- **Compose `DATABASE_URL`** — Langfuse lit une unique `DATABASE_URL` Prisma, et son
  mot de passe est une valeur Secret Manager d'exécution qui ne peut pas être interpolée dans une URL au moment
  du plan. Le point d'entrée construit l'URL à partir des variables `DB_*` injectées par le socle,
  en encodant le mot de passe pour l'URL et en choisissant selon la forme de l'hôte :
  - répertoire de socket Unix Cloud SQL (`/cloudsql/...`) → forme socket libpq
    (`...@localhost:5432/db?host=/cloudsql/...&sslmode=disable`),
  - boucle locale (`127.0.0.1`/`localhost`, le sidecar Auth Proxy sur GKE) → `sslmode=disable`,
  - TCP sur IP privée → `sslmode=require` (Cloud SQL rejette le TCP non chiffré sur IP privée).
- **Définit `NEXTAUTH_URL`, `PORT` (3000) et `HOSTNAME` (`0.0.0.0`)** — `NEXTAUTH_URL` est
  dérivée de l'URL du service Cloud Run / GKE injectée afin que les rappels NextAuth se résolvent
  correctement.
- **Désactive la télémétrie** (`TELEMETRY_ENABLED=false`).
- **Passe la main au démarrage propre de Langfuse** — `exec /app/web/entrypoint.sh`, qui exécute
  `prisma migrate deploy` puis lance le serveur Next.js. `NEXTAUTH_SECRET` et
  `SALT` sont injectés comme variables d'environnement secrètes et consommés par ce démarrage.

`entrypoint.sh` et le `Dockerfile` sont intégrés à l'image ; toute modification nécessite donc une reconstruction ;
`db-init.sh` est monté au moment de l'apply et prend effet à l'apply suivant sans reconstruction.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Langfuse_Common` établit l'environnement de base de Langfuse afin que l'application démarre
correctement dès le premier lancement :

- **Port** — Langfuse (Next.js) écoute sur `3000`.
- **Télémétrie** — `TELEMETRY_ENABLED = "false"` (aucune donnée d'utilisation anonyme envoyée au
  cloud Langfuse).
- **Inscription** — `AUTH_DISABLE_SIGNUP = "false"` par défaut. Langfuse n'a aucun identifiant administrateur
  prédéfini ; le **premier utilisateur qui s'inscrit devient le propriétaire de l'instance**. Passez la valeur à `"true"`
  via `environment_variables` après l'intégration initiale pour empêcher toute nouvelle inscription en libre-service.
- **File d'attente et cache** — Langfuse v2 utilise une file d'attente et un cache adossés à PostgreSQL ; aucun Redis n'est donc
  provisionné. `enable_redis` reste à `false` sauf si un déploiement l'externalise explicitement.

Ajustements propres à chaque plateforme gérés par le point d'entrée :

- **Cloud Run** définit `NEXTAUTH_URL` à partir de `CLOUDRUN_SERVICE_URL` injectée et utilise le
  chemin du socket Cloud SQL pour `DATABASE_URL`.
- **GKE** définit `NEXTAUTH_URL` à partir de l'URL de service injectée et utilise le sidecar Cloud SQL Auth Proxy
  sur `127.0.0.1` pour `DATABASE_URL` (SSL désactivé sur la boucle locale). Mettez à jour
  `NEXTAUTH_URL` avec l'URL externe du LoadBalancer ou du domaine personnalisé via `environment_variables`
  une fois l'adresse externe connue.

---

## 6. Comportement de la sonde de santé {#6-health-probe-behaviour}

L'objet de sonde par défaut propre à cette couche cible `/api/public/health` — le point de terminaison de santé
non authentifié de Langfuse, qui ne renvoie 200 qu'une fois le serveur entièrement
initialisé — et c'est celui qu'utilise la `readiness_probe` codée en dur. Les deux variantes de
plateforme transmettent toutefois leurs propres valeurs par défaut de `startup_probe`/`liveness_probe`, qui utilisent
`/` ; un déploiement standard sonde donc `/`. Une fenêtre de démarrage généreuse
laisse le temps aux migrations Prisma qui s'exécutent au premier démarrage (et à chaque montée de version).

- **Cloud Run** utilise des sondes HTTP sur `/` avec une large fenêtre de seuil d'échec
  afin que les migrations du premier démarrage se terminent avant que la révision soit marquée comme défaillante.
- **GKE** utilise des sondes HTTP de démarrage/de vivacité sur le même chemin ; le large seuil d'échec
  de la sonde de démarrage couvre les migrations du premier démarrage.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket **Cloud Storage** dédié est déclaré ici et provisionné par le socle,
qui accorde aussi l'accès au compte de service de la charge de travail. Langfuse v2 conserve toutes les données de traces et
d'observabilité dans PostgreSQL ; le bucket (et le partage NFS monté en option sur
`/opt/langfuse/storage`) servent aux exports et aux médias plutôt qu'à l'état principal. Listez-le
avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Langfuse destinée aux utilisateurs (variables par groupe, sorties, et comment
explorer chaque service depuis la console et la CLI), consultez les guides de plateforme :
**[Langfuse_GKE](Langfuse_GKE.md)** et **[Langfuse_CloudRun](Langfuse_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Langfuse sur Google Cloud Run](Langfuse_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Langfuse sur GKE Autopilot](Langfuse_GKE.md) — cette configuration déployée sur GKE.
