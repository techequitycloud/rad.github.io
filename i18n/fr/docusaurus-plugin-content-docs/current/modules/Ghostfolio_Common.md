---
title: "Ghostfolio Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Ghostfolio — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Ghostfolio_Common.md @ 3055034 sha256:2cfab7f5aec4 -->

# Ghostfolio Common — Configuration applicative partagée {#ghostfolio-common--shared-application-configuration}

`Ghostfolio_Common` est la **couche applicative partagée** de Ghostfolio. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Ghostfolio sur laquelle
s'appuient à la fois [Ghostfolio_GKE](Ghostfolio_GKE.md) et
[Ghostfolio_CloudRun](Ghostfolio_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où c'est important. Les
utilisateurs finaux ne configurent jamais cette couche directement — elle n'a
aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des
plateformes.

Pour l'infrastructure qui provisionne et exécute effectivement Ghostfolio,
consultez les guides des plateformes ([Ghostfolio_GKE](Ghostfolio_GKE.md),
[Ghostfolio_CloudRun](Ghostfolio_CloudRun.md)) et les guides des socles
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Ghostfolio_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `ACCESS_TOKEN_SALT` et `JWT_SECRET_KEY` (deux chaînes aléatoires de 32 caractères) et les stocke dans **Secret Manager** | Injectés automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `ghostfolio/ghostfolio` de Docker Hub avec un point d'entrée cloud personnalisé (reprend la technique de `Langfuse_Common`) ; construite via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** (ORM Prisma) comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`), qui crée la base de données, le rôle et les autorisations — PAS de job de migration distinct, car le conteneur de Ghostfolio exécute lui-même les migrations Prisma à chaque démarrage | Sortie `initialization_jobs` |
| Stockage objet | Aucun — Ghostfolio n'a besoin d'aucun stockage de fichiers/médias en masse | Sortie `storage_buckets` (toujours `[]`) |
| Paramètres principaux | Définit `NODE_ENV=production` et le port du conteneur (3333) | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/api/v1/health` (vérifie la base de données et Redis) | §Observabilité dans les guides des plateformes |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager — ils ne
sont jamais définis en clair et tous deux sont bloquants au démarrage (Ghostfolio
n'a de valeur par défaut raisonnable pour aucun des deux) :

- **`ACCESS_TOKEN_SALT`** — une chaîne aléatoire de 32 caractères. Sert à hacher
  l'identifiant anonyme « Security Token » que Ghostfolio génère pour le
  propriétaire du compte lors du premier « Get Started » (il n'existe ni compte
  administrateur pré-créé ni formulaire e-mail/mot de passe). Le faire tourner
  après le premier démarrage invalide tous les Security Tokens émis précédemment —
  les utilisateurs concernés ne peuvent plus s'authentifier avec leur jeton
  existant.
- **`JWT_SECRET_KEY`** — une chaîne aléatoire de 32 caractères. Sert à signer tous
  les JWT d'authentification émis après la connexion par Security Token. Le faire
  tourner invalide immédiatement toutes les sessions actives et oblige chaque
  utilisateur à se reconnecter.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~access-token-salt OR name~jwt-secret-key"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ;
le nom de son secret est indiqué dans les sorties du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Ghostfolio nécessite **PostgreSQL 15** (ORM Prisma) ; le moteur est fixé, et MySQL
ou d'autres moteurs ne sont pas pris en charge. Lors du premier déploiement, un job
ponctuel (`db-init`) s'exécute avec `postgres:15-alpine` et, de manière
idempotente :

1. Attend que PostgreSQL soit joignable,
2. Crée (ou met à jour) le rôle de l'application avec le mot de passe généré,
3. Crée la base de données de l'application si elle n'existe pas déjà,
4. Accorde tous les privilèges sur la base de données et le schéma public,
5. Signale au Cloud SQL Auth Proxy de s'arrêter proprement (GKE).

**Contrairement à plusieurs autres modules Common, il n'existe pas de job de
migration distinct.** Le point d'entrée amont du conteneur de Ghostfolio
(`docker/entrypoint.sh`) exécute `prisma migrate deploy`, puis `prisma db seed`,
puis démarre le serveur — le tout à chaque démarrage du conteneur, dans le même
processus que l'application. Une migration en échec fait planter le conteneur de
manière visible (le script amont utilise `set -ex`) au lieu de livrer un service
sain face à une base de données vide ; c'est pourquoi aucun job supplémentaire de
garde/vérification n'est nécessaire ici (à comparer avec le modèle
`twenty-verify` de Twenty).

Le job peut être relancé sans risque. Inspectez directement la base de données
avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est un **mince wrapper** `FROM ghostfolio/ghostfolio:<version>`
— la même technique que celle utilisée par `Langfuse_Common` pour d'autres
applications reposant sur une image prête à l'emploi. `cloud-entrypoint.sh`
s'exécute avant la séquence de démarrage propre à Ghostfolio :

- **Compose `DATABASE_URL`** à partir des variables `DB_*` injectées par le socle.
  Le DSN de Ghostfolio est une chaîne de connexion de type URL
  (`postgresql://user:pass@host:port/db?...`) ; le point d'entrée n'utilise donc
  JAMAIS le chemin du socket Unix de Cloud SQL (ses deux-points casseraient
  l'analyse de l'URL — le même piège que celui documenté pour Vikunja/Logto). Il se
  connecte toujours en TCP via `DB_IP`, en distinguant uniquement si l'hôte résolu
  est une adresse de bouclage :
  - **Cloud Run** : `DB_IP` est toujours la véritable IP privée de Cloud SQL →
    `sslmode=require`.
  - **GKE** : `DB_IP` se résout en `127.0.0.1` lorsque le sidecar cloud-sql-proxy
    est actif → `sslmode=disable`.
- **Associe `REDIS_AUTH` à `REDIS_PASSWORD`** — le socle injecte toujours le secret
  du mot de passe Redis sous le nom codé en dur `REDIS_AUTH` (non configurable dans
  `App_CloudRun`/`App_GKE`), mais le client Redis de Ghostfolio lit
  `REDIS_PASSWORD` (`apps/api/src/helper/redis.helper.ts`). `REDIS_HOST` et
  `REDIS_PORT` n'ont pas besoin d'alias.
- **Délègue au CMD de l'image de base** (`/ghostfolio/entrypoint.sh`) via
  `exec "$@"` — ce qui exécute la migration Prisma, l'amorçage et le démarrage du
  serveur, reproduisant exactement le comportement de l'image non encapsulée. Le
  Dockerfile redéclare explicitement ce `CMD` — un `ENTRYPOINT` personnalisé seul,
  sans `CMD` correspondant, l'écarterait sinon silencieusement.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Ghostfolio_Common` établit l'environnement de base de Ghostfolio :

- **`NODE_ENV = "production"`**.
- **`container_port = 3333`** — le `DEFAULT_PORT` de Ghostfolio
  (`libs/common/src/lib/config.ts`) ; l'application écoute sur `0.0.0.0`
  (`DEFAULT_HOST`) par défaut, aucune surcharge de l'hôte n'est donc nécessaire.
- **Redis est obligatoire, pas facultatif** — `enable_redis` doit être transmis
  sans condition par les modules applicatifs ; le conditionner à
  `redis_host != ""` supprimerait l'injection de repli Redis sur l'IP NFS de la
  plateforme et laisserait `REDIS_HOST` non défini.
- **Pas de câblage `STORAGE_TYPE`/GCS** — Ghostfolio n'a besoin d'aucun stockage de
  fichiers/médias en masse.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `GET /api/v1/health` — le contrôleur de santé propre
à Ghostfolio (`apps/api/src/app/health/health.controller.ts`) vérifie À LA FOIS la
connexion à la base de données ET celle à Redis, et renvoie `503` tant que les deux
ne sont pas saines ; il fait donc office de véritable barrière de disponibilité
plutôt que de simple ping de vivacité.

- **Sonde de démarrage** : HTTP, délai initial de 30s, période de 10s, seuil de 12
  échecs (~2 minutes au total).
- **Sonde de vivacité** : HTTP, délai initial de 30s, période de 30s, seuil de 3
  échecs.

---

## 7. Stockage d'objets {#7-object-storage}

Aucun. Ghostfolio n'a besoin d'aucun stockage de fichiers/médias en masse —
`storage_buckets` vaut toujours `[]`.

```bash
gcloud storage buckets list --project "$PROJECT"   # will not show a Ghostfolio-specific bucket
```

---

Pour la configuration propre à Ghostfolio visible par l'utilisateur (variables par
groupe, sorties et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Ghostfolio_GKE](Ghostfolio_GKE.md)** et
**[Ghostfolio_CloudRun](Ghostfolio_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Ghostfolio sur Google Cloud Run](Ghostfolio_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Ghostfolio sur GKE Autopilot](Ghostfolio_GKE.md) — cette configuration déployée sur GKE.
