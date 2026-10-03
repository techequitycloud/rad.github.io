---
title: "Langfuse Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Langfuse — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Langfuse_Common.md @ 15fd4c7 sha256:a64427a5b8c6 -->

# Langfuse Common — Configuration d'application partagée {#langfuse-common--shared-application-configuration}

`Langfuse_Common` est la **couche d'application partagée** pour Langfuse. Elle n'est
pas déployée seule ; elle fournit plutôt la configuration spécifique à Langfuse
sur laquelle s'appuient [Langfuse_GKE](Langfuse_GKE.md) et
[Langfuse_CloudRun](Langfuse_CloudRun.md), de sorte que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais cette couche directement — elle n'a pas ses propres
entrées d'interface utilisateur de déploiement — mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute réellement Langfuse, consultez les
guides de la plateforme ([Langfuse_GKE](Langfuse_GKE.md),
[Langfuse_CloudRun](Langfuse_CloudRun.md)) et les guides de base
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Langfuse_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `NEXTAUTH_SECRET` (50 caractères) et `SALT` (24 caractères) et les stocke dans **Secret Manager** | Injectés automatiquement comme variables d'environnement secrètes ; récupérables via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `langfuse/langfuse:2` (v2, Postgres uniquement) avec un point d'entrée cloud ; build via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur supporté | §Base de données dans les guides de la plateforme |
| Amorçage de la base de données | Définit le job de premier déploiement (`db-init`) qui crée le rôle et la base de données et accorde les privilèges | Sortie `initialization_jobs` |
| Migrations de schéma | Délègue au démarrage propre de Langfuse, qui exécute `prisma migrate deploy` à chaque démarrage de conteneur | §Comportement de l'application dans les guides de la plateforme |
| Stockage d'objets | Déclare un bucket **Cloud Storage** | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement Langfuse de base : télémétrie désactivée, inscription ouverte pour que le premier utilisateur soit le propriétaire, port 3000 | Comportement de l'application dans les guides de la plateforme |
| Vérifications de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/api/public/health` | §Observabilité dans les guides de la plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager — ils ne sont
jamais définis en texte clair et ne doivent jamais être modifiés après le premier
déploiement :

- **`NEXTAUTH_SECRET`** — une chaîne aléatoire de 50 caractères, stockée sous le nom
  `secret-<prefix>-langfuse-secret-key`. Signe les JWT de session NextAuth. La faire pivoter
  après le premier démarrage invalide immédiatement toutes les sessions actives, forçant
  tous les utilisateurs à se reconnecter.
- **`SALT`** — une chaîne aléatoire de 24 caractères, stockée sous le nom
  `secret-<prefix>-langfuse-superuser-password`. Hache les clés API Langfuse avant qu'elles ne soient
  persistées. La faire pivoter après le premier démarrage invalide
  définitivement toutes les clés API existantes ; les clients SDK utilisant ces clés
  reçoivent `401 Unauthorized` jusqu'à ce que de nouvelles clés soient générées.

Les deux sont **obligatoires**. Langfuse valide l'intégralité de son environnement avec
zod au démarrage et refuse de démarrer (`Invalid environment variables`) si l'un ou l'autre
manque — c'est la cause la plus fréquente d'une révision Langfuse qui ne devient
jamais prête. Ils sont injectés dans le conteneur de service en tant que variables
d'environnement secrètes via la sortie `secret_ids` du module.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key OR name~superuser-password"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par la fondation ;
son nom de secret est indiqué dans les sorties de déploiement de la plateforme
(`database_password_secret`). Voir [App_Common](App_Common.md) pour le secret partagé et le
modèle Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Langfuse nécessite **PostgreSQL** ; ce module épingle **PostgreSQL 15**, le moteur
est fixe, et MySQL ou d'autres moteurs ne sont pas supportés. Lors du premier
déploiement, un job ponctuel (`db-init`) s'exécute en utilisant `postgres:15-alpine`
et de manière idempotente :

1. Détecte le socket Unix du proxy d'authentification Cloud SQL (ou l'hôte IP privée)
   et le mappe pour l'accès `psql`,
2. Attend que PostgreSQL soit accessible,
3. Crée (ou met à jour) le rôle de l'application (`langfuse`) avec `LOGIN CREATEDB`
   et le mot de passe généré,
4. Crée la base de données de l'application (`langfuse`) si elle n'existe pas,
5. Accorde tous les privilèges sur la base de données et le schéma `public`
   (PostgreSQL 15 n'accorde plus `CREATE` sur `public` par défaut),
6. Signale au proxy d'authentification Cloud SQL de s'arrêter gracieusement afin que le pod
   du job se termine.

**`db-init` ne crée que le rôle et la base de données — jamais les tables.**
Langfuse exécute ses propres migrations de schéma (`prisma migrate deploy`) à chaque
démarrage de conteneur, de sorte que le schéma est créé et maintenu à jour par
l'application elle-même. Il n'y a délibérément pas de job de migration séparé. Le
job `db-init` peut être réexécuté en toute sécurité.

Inspectez la base de données directement avec :

```bash
gcloud sql connect <instance-name> --user=langfuse --database=langfuse --project "$PROJECT"
```

Les noms d'instance, de base de données et d'utilisateur se trouvent dans les sorties de
déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est un mince wrapper `FROM langfuse/langfuse:2` — la ligne **v2,
Postgres uniquement**. (Langfuse v3 nécessite en plus ClickHouse, Redis et S3 et
n'entre pas dans le cadre de ce module.) La balise de base est contrôlée par l'ARG de
build `LANGFUSE_VERSION`, qui est spécifique à l'application — délibérément **pas**
le générique `APP_VERSION` que la fondation injecte et gagne — de sorte que
`application_version = "latest"` se résout en `2` plutôt qu'en une balise inexistante.
Le wrapper ajoute un point d'entrée cloud (`entrypoint.sh`) qui s'exécute avant le
propre démarrage de Langfuse :

- **Compose `DATABASE_URL`** — Langfuse lit un seul `DATABASE_URL` Prisma, et son
  mot de passe est une valeur Secret Manager d'exécution qui ne peut pas être interpolée
  dans une URL au moment de la planification. Le point d'entrée construit l'URL à partir
  des variables `DB_*` injectées par la Fondation, encodant le mot de passe
  dans l'URL et se ramifiant sur la forme de l'hôte :
  - Répertoire de socket Unix Cloud SQL (`/cloudsql/...`) → forme de socket libpq
    (`...@localhost:5432/db?host=/cloudsql/...&sslmode=disable`),
  - boucle locale (`127.0.0.1`/`localhost`, le sidecar du proxy d'authentification
    GKE) → `sslmode=disable`,
  - TCP IP privée → `sslmode=require` (Cloud SQL rejette le TCP IP privée non chiffré).
- **Définit `NEXTAUTH_URL`, `PORT` (3000) et `HOSTNAME` (`0.0.0.0`)** —
  `NEXTAUTH_URL` est dérivé de l'URL de service Cloud Run / GKE injectée afin que les
  callbacks NextAuth se résolvent correctement.
- **Désactive la télémétrie** (`TELEMETRY_ENABLED=false`).
- **Passe la main au propre démarrage de Langfuse** — `exec /app/web/entrypoint.sh`, qui exécute
  `prisma migrate deploy` puis lance le serveur Next.js. `NEXTAUTH_SECRET` et
  `SALT` sont injectés en tant que variables d'environnement secrètes et
  consommés par ce démarrage.

Les `entrypoint.sh` et `Dockerfile` sont intégrés à l'image, donc les
modifications nécessitent une reconstruction ; `db-init.sh` est monté au moment de
l'apply et prend effet lors du prochain apply sans reconstruction.

---

## 5. Paramètres d'application de base {#5-core-application-settings}

`Langfuse_Common` établit l'environnement Langfuse de base afin que l'application
démarre correctement au premier boot :

- **Port** — Langfuse (Next.js) sert sur `3000`.
- **Télémétrie** — `TELEMETRY_ENABLED = "false"` (aucune donnée d'utilisation anonyme envoyée au
  cloud Langfuse).
- **Inscription** — `AUTH_DISABLE_SIGNUP = "false"` par défaut. Langfuse n'a pas de
  crédentiel administrateur pré-initialisé ; le **premier utilisateur à
  s'inscrire devient le propriétaire de l'instance**. Remplacez par `"true"`
  via `environment_variables` après l'intégration pour empêcher d'autres inscriptions en
  libre-service.
- **File d'attente et cache** — Langfuse v2 utilise une file d'attente et un cache
  basés sur PostgreSQL, donc aucun Redis n'est provisionné. `enable_redis` reste
  `false` à moins qu'un déploiement ne l'externalise explicitement.

Ajustements spécifiques à la plateforme gérés par le point d'entrée :

- **Cloud Run** définit `NEXTAUTH_URL` à partir de `CLOUDRUN_SERVICE_URL` injecté et
  utilise le chemin du socket Cloud SQL pour `DATABASE_URL`.
- **GKE** définit `NEXTAUTH_URL` à partir de l'URL de service injectée et utilise
  le sidecar du proxy d'authentification Cloud SQL sur `127.0.0.1` pour
  `DATABASE_URL` (SSL désactivé sur la boucle locale). Mettez à jour
  `NEXTAUTH_URL` vers l'équilibreur de charge externe ou l'URL de domaine personnalisé
  via `environment_variables` une fois l'adresse externe connue.

---

## 6. Comportement de la sonde de santé {#6-health-probe-behaviour}

L'objet de sonde par défaut de cette couche cible `/api/public/health` — le point de
terminaison de santé non authentifié de Langfuse qui renvoie un 200 seulement une fois
que le serveur est entièrement initialisé — et c'est ce qu'utilise le `readiness_probe`
codé en dur. Les deux variantes de plateforme, cependant, passent leurs propres valeurs par
défaut `startup_probe`/`liveness_probe`, qui utilisent `/`, de sorte
qu'un déploiement standard sonde `/`. Une fenêtre de démarrage généreuse
s'adapte aux migrations Prisma qui s'exécutent au premier démarrage (et à toute mise à
niveau de version).

- **Cloud Run** utilise des sondes HTTP contre `/` avec une large fenêtre
  de seuil d'échec afin que les migrations du premier démarrage se terminent avant que la
  révision ne soit marquée comme non saine.
- **GKE** utilise des sondes de démarrage/vivacité HTTP contre le même chemin ; le large
  seuil d'échec de la sonde de démarrage couvre les migrations du premier démarrage.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket **Cloud Storage** dédié est déclaré ici et provisionné par la fondation,
qui accorde également l'accès au compte de service de la charge de travail. Langfuse v2
conserve toutes les données de trace et d'observabilité dans PostgreSQL ; le bucket est
disponible pour les exportations et les médias plutôt que pour l'état primaire. Langfuse
n'a pas de mode de stockage de système de fichiers, donc aucun partage NFS n'est utilisé.
Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration spécifique à Langfuse et destinée à l'utilisateur (variables par
groupe, sorties et comment explorer chaque service depuis la Console et la CLI),
consultez les guides de la plateforme : **[Langfuse_GKE](Langfuse_GKE.md)** et
**[Langfuse_CloudRun](Langfuse_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Langfuse sur Google Cloud Run](Langfuse_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Langfuse sur GKE Autopilot](Langfuse_GKE.md) — cette configuration déployée sur GKE.
