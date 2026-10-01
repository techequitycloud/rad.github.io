---
title: "ToolJet Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module ToolJet — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/ToolJet_Common.md @ 3055034 sha256:06ee57bf6d47 -->

# ToolJet Common — Configuration applicative partagée {#tooljet-common--shared-application-configuration}

`ToolJet_Common` est la **couche applicative partagée** de ToolJet. Elle n'est pas
déployée seule ; elle fournit la configuration propre à ToolJet sur laquelle
s'appuient à la fois [ToolJet_GKE](ToolJet_GKE.md) et
[ToolJet_CloudRun](ToolJet_CloudRun.md), afin que les deux variantes de plateforme se
comportent de façon identique là où cela compte. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs
par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement ToolJet, consultez les
guides de plateforme ([ToolJet_GKE](ToolJet_GKE.md),
[ToolJet_CloudRun](ToolJet_CloudRun.md)) et les guides des socles
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par ToolJet_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY` (64 caractères hexadécimaux) et `PGRST_JWT_SECRET` et les stocke dans **Secret Manager** | Injectés automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `tooljet/tooljet-ce` avec un script `cloud-entrypoint.sh` personnalisé ; construite via Cloud Build | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Deux bases de données | Définit la tâche `db-init` du premier déploiement qui crée la base de métadonnées **et** la seconde « ToolJet Database », accorde le rôle partagé `CREATEROLE` et réinitialise le schéma `postgrest` | Sortie `initialization_jobs` |
| Stockage d'objets | Ne déclare **aucun** bucket de données — ToolJet stocke les applications, les sources de données et les fichiers téléversés dans PostgreSQL | Sortie `storage_buckets` (`[]`) |
| Paramètres principaux | Définit l'environnement de base de ToolJet : `SERVE_CLIENT`, port 80, `TOOLJET_DB`, état de l'inscription, télémétrie | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Déclare un chemin par défaut `/api/health` pour la sonde de démarrage/d'activité, mais `ToolJet_CloudRun` comme `ToolJet_GKE` transmettent toujours explicitement leurs propres variables `startup_probe`/`liveness_probe` (par défaut `path = "/"`) à l'appel de ce module ; cette valeur par défaut de la couche Common n'est donc jamais réellement utilisée | §Observabilité dans les guides de plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Trois secrets sont générés automatiquement et stockés dans Secret Manager — ils ne
sont jamais définis en clair et **ne doivent jamais être modifiés après le premier
déploiement**. Ils sont générés avec `random_id` (dont la sortie `.hex` est un
hexadécimal valide — un `random_password` produirait des caractères alphanumériques
non hexadécimaux et `LOCKBOX_MASTER_KEY` échouerait à la validation `\h{64}` de
ToolJet) :

- **`SECRET_KEY_BASE`** — 64 octets aléatoires rendus sous forme de 128 caractères
  hexadécimaux. Signe les sessions utilisateur et les cookies. Sa rotation après le
  premier démarrage invalide toutes les sessions actives et oblige chaque utilisateur
  à se reconnecter.
- **`LOCKBOX_MASTER_KEY`** — 32 octets aléatoires rendus sous forme d'exactement 64
  caractères hexadécimaux (ToolJet exige cette longueur). Le Lockbox de ToolJet
  chiffre au repos **tous les identifiants de sources de données stockés** et
  d'autres secrets avec cette clé. Sa rotation rend indéchiffrables tous les
  identifiants de sources de données stockés — chaque connexion doit être ressaisie.
- **`PGRST_JWT_SECRET`** — 32 octets aléatoires rendus sous forme de 64 caractères
  hexadécimaux. Signe les JWT PostgREST internes utilisés par la fonctionnalité
  ToolJet Database. Sa rotation casse la couche de requêtes de la ToolJet Database
  jusqu'à ce que chaque instance redémarre.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" \
  --filter="name~secret-key-base OR name~lockbox-master-key OR name~pgrst-jwt-secret"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ;
le nom de son secret est indiqué dans les sorties du déploiement de plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

ToolJet nécessite **PostgreSQL 15** ; le moteur est imposé et MySQL ou d'autres
moteurs ne sont pas pris en charge. ToolJet utilise **deux bases de données sur la
même instance Cloud SQL** :

1. la **base de métadonnées** (`tooljet`) — applications, configurations des sources
   de données, utilisateurs, espaces de travail, sessions ; et
2. la **ToolJet Database** (`tooljet_db`) — la base de données no-code intégrée,
   exposée aux requêtes des applications par un processus **PostgREST** dans le
   conteneur.

Au premier déploiement, une tâche ponctuelle (`db-init`) s'exécute avec
`postgres:15-alpine` et, de manière idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy (ou se rabat sur l'IP privée) et
   attend que PostgreSQL soit joignable,
2. Crée (ou met à jour) le rôle applicatif partagé **avec l'attribut `CREATEROLE`**
   — la création d'espaces de travail de ToolJet exécute `CREATE ROLE` pour l'accès
   PostgREST par espace de travail et échoue avec *permission denied to create role*
   sans lui (`CREATEROLE` est un attribut de rôle, pas un privilège pouvant être
   accordé — l'appartenance à `cloudsqlsuperuser` ne le confère pas),
3. Crée **les deux** bases de données si elles sont absentes et accorde tous les
   privilèges sur chaque base de données et sur son schéma `public`,
4. Accorde `cloudsqlsuperuser` au rôle applicatif afin que ToolJet puisse gérer
   l'extension `pgcrypto`, et pré-crée `pgcrypto` sur les deux bases par précaution,
5. **Réinitialise le schéma `postgrest` pour qu'il appartienne à l'application**
   (`DROP SCHEMA IF EXISTS postgrest
   CASCADE; CREATE SCHEMA postgrest AUTHORIZATION <app_user>`) sur les deux bases —
   le `reconfigurePostgrest` exécuté par ToolJet au démarrage lance
   `GRANT`/`CREATE FUNCTION` en tant qu'utilisateur de l'application, ce qui échoue
   avec `permission denied for schema postgrest` si le schéma appartient à
   `postgres` ; le schéma ne contient que la configuration d'amorçage de PostgREST,
   que ToolJet reconstruit immédiatement, de sorte qu'une réinitialisation propre au
   profit de l'application est sûre et idempotente,
6. Demande au Cloud SQL Auth Proxy de s'arrêter proprement.

La tâche peut être réexécutée sans risque. Inspectez directement les bases de
données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=tooljet --project "$PROJECT"
gcloud sql connect <instance-name> --user=<db-user> --database=tooljet_db --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est une fine surcouche `FROM tooljet/tooljet-ce:<version>` —
l'ARG du Dockerfile est **`TOOLJET_VERSION`** (et non le générique `APP_VERSION`, que
le socle injecte et qui l'écraserait). Son `cloud-entrypoint.sh` s'exécute avant le
démarrage du serveur NestJS :

- **Fait correspondre `DB_*` aux variables distinctes `PG_*` / `TOOLJET_DB_*` de
  ToolJet** — la plateforme injecte les variables standard `DB_HOST`, `DB_PORT`,
  `DB_NAME`, `DB_USER`, `DB_PASSWORD` ; le point d'entrée les traduit en
  `PG_HOST`/`PG_PORT`/`PG_USER`/`PG_PASS`/`PG_DB` (base de métadonnées) et en
  variables `TOOLJET_DB_*` correspondantes (seconde base). node-pg accepte un
  **répertoire** de socket Cloud SQL comme hôte ; le socket fonctionne donc tel quel.
- **Compose `PGRST_DB_URI` de manière sûre** — le DSN de PostgREST est une URL
  `user:pass@HOST`, qui ne peut pas contenir un répertoire de socket (ses deux-points
  cassent l'analyse de l'URL). Le point d'entrée choisit selon la forme de l'hôte :
  répertoire de socket → forme libpq `?host=`, `127.0.0.1` (proxy GKE) → simple
  loopback, IP privée → `sslmode=require`. Le mot de passe est encodé pour l'URL.
- **Transmet Redis** — lit les variables `REDIS_HOST` / `REDIS_PORT` / `REDIS_AUTH`
  injectées par le socle directement dans la configuration BullMQ de ToolJet.
- **Définit les valeurs par défaut de `TOOLJET_HOST` et `PORT`** — `TOOLJET_HOST`
  (qui détermine les liens générés et les URI de redirection OAuth) prend par défaut
  l'URL calculée du service ; `PORT` vaut par défaut `80` afin que les pods GKE
  écoutent sur le port attendu par le Service et les sondes (Cloud Run injecte
  lui-même `PORT`).
- **Exécute les migrations, puis lance le serveur** —
  `npm run db:migrate:prod` (TypeORM `migration:run` pour les deux sources de
  données) s'exécute **avant** l'`exec` de la commande de démarrage standard de
  ToolJet. Le `start:prod` de ToolJet se résume littéralement à
  `node dist/src/main` et n'effectue **aucune** migration ; sans cette étape, la base
  de métadonnées reste vide et toute action reposant sur la base échoue avec
  `relation "user_sessions" does not exist`. L'étape est idempotente (TypeORM
  enregistre les migrations appliquées).

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`ToolJet_Common` établit l'environnement de base de ToolJet afin que l'application
démarre correctement dès le premier lancement :

- **Mode de service** — `SERVE_CLIENT = "true"` : le client React compilé est servi
  par le même processus NestJS ; il n'y a donc pas de service nginx/client séparé.
  L'unique conteneur écoute sur le **port 80**.
- **Nom de la ToolJet Database** — `TOOLJET_DB = "tooljet_db"` nomme la seconde base
  de données que crée la tâche `db-init` et que sert PostgREST.
- **Environnement** — `NODE_ENV = "production"`.
- **Inscription** — `DISABLE_SIGNUPS = "true"` par défaut. Une nouvelle installation
  n'est pas ouverte à l'inscription en libre-service ; les opérateurs modifient ce
  paramètre après avoir créé le premier administrateur.
- **Vérification des mises à jour** — `CHECK_FOR_UPDATES = "false"`.

Ajustements propres à chaque plateforme gérés par le point d'entrée :

- **Cloud Run** reçoit `PORT` automatiquement (= `container_port` = 80) ; la valeur
  par défaut de `PORT` dans le point d'entrée n'a alors aucun effet.
- **GKE** ne reçoit **pas** `PORT` ; c'est donc la valeur par défaut `80` du point
  d'entrée qui fait écouter le pod sur le port du Service et des sondes plutôt que
  sur le port 3000 par défaut de ToolJet.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

`ToolJet_Common` déclare ses propres valeurs par défaut pour les variables
`startup_probe`/`liveness_probe`, ciblant **`/api/health`** — le point de terminaison
de santé public et non authentifié de ToolJet (le reste de la surface `/api/*` exige
une authentification). En pratique, cette valeur par défaut de la couche Common n'est
jamais utilisée : `ToolJet_CloudRun` comme `ToolJet_GKE` transmettent toujours
explicitement leurs propres variables `startup_probe`/`liveness_probe` à l'appel du
module `ToolJet_Common`, et ces variables de plateforme fixent par défaut le `path` de
la sonde à **`/`**. La sonde de démarrage utilise un **budget généreux (30 × 15 s)**
pour absorber les migrations TypeORM qui s'exécutent au premier démarrage avant que
le serveur ne commence à écouter.

- **Cloud Run** — sonde de démarrage HTTP sur `/` par défaut, délai initial de 60 s,
  période de 15 s, 30 échecs ; sonde d'activité sur `/` par défaut, période de 30 s.
  Remplacez le `path` de `startup_probe`/`liveness_probe` par `/api/health` si vous
  le préférez.
- **GKE** — les mêmes sondes sur `/` par défaut, la sonde de démarrage de
  l'infrastructure App_GKE absorbant la planification et le démarrage du sidecar
  Auth Proxy.

---

## 7. Stockage d'objets {#7-object-storage}

`ToolJet_Common` ne déclare **aucun** bucket de données Cloud Storage
(`storage_buckets = []`). ToolJet stocke les définitions d'applications, les
configurations des sources de données et les fichiers téléversés dans PostgreSQL ; le
conteneur est donc sans état. Des buckets supplémentaires ou des volumes GCS Fuse
peuvent toujours être déclarés par plateforme via `storage_buckets` / `gcs_volumes`
si nécessaire.

---

Pour la configuration propre à ToolJet exposée aux utilisateurs (variables par
groupe, sorties et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides de plateforme : **[ToolJet_GKE](ToolJet_GKE.md)** et
**[ToolJet_CloudRun](ToolJet_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [ToolJet sur Google Cloud Run](ToolJet_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [ToolJet sur GKE Autopilot](ToolJet_GKE.md) — cette configuration déployée sur GKE.
