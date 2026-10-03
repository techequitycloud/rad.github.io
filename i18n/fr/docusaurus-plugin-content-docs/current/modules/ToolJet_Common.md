---
title: "ToolJet Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module ToolJet — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/ToolJet_Common.md @ 15fd4c7 sha256:7cb44cd59cee -->

# ToolJet Common — Configuration d'application partagée {#tooljet-common--shared-application-configuration}

`ToolJet_Common` est la **couche d'application partagée** pour ToolJet. Elle n'est pas déployée
seule ; elle fournit plutôt la configuration spécifique à ToolJet sur laquelle
[ToolJet_GKE](ToolJet_GKE.md) et [ToolJet_CloudRun](ToolJet_CloudRun.md) s'appuient,
afin que les deux variantes de plateforme se comportent de manière identique là où cela
importe. Les utilisateurs finaux ne configurent jamais cette couche directement — elle
n'a pas ses propres entrées d'interface utilisateur de déploiement — mais comprendre
ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation
de la plateforme.

Pour l'infrastructure qui provisionne et exécute réellement ToolJet, consultez les
guides de la plateforme ([ToolJet_GKE](ToolJet_GKE.md), [ToolJet_CloudRun](ToolJet_CloudRun.md))
et les guides de base ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par ToolJet_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY` (64 caractères hexadécimaux), et `PGRST_JWT_SECRET` et les stocke dans **Secret Manager** | Injecté automatiquement ; récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `tooljet/tooljet-ce` avec un `cloud-entrypoint.sh` personnalisé ; build via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides de la plateforme |
| Deux bases de données | Définit le job `db-init` de premier déploiement qui crée la base de données de métadonnées **et** la deuxième "ToolJet Database", accorde le rôle partagé `CREATEROLE`, et réinitialise le schéma `postgrest` | Sortie `initialization_jobs` |
| Stockage d'objets | Ne déclare **pas** de bucket de données — ToolJet stocke les applications, les sources de données et les téléchargements dans PostgreSQL | Sortie `storage_buckets` (`[]`) |
| Paramètres de base | Définit l'environnement ToolJet de base : `SERVE_CLIENT`, port 80, `TOOLJET_DB`, état d'inscription, télémétrie | Comportement de l'application dans les guides de la plateforme |
| Vérifications de santé | Déclare un chemin de sonde de démarrage/vivacité par défaut de `/api/health`, mais `ToolJet_CloudRun` et `ToolJet_GKE` transmettent toujours explicitement leurs propres variables `startup_probe`/`liveness_probe` (par défaut `path = "/"`) à cet appel de module, de sorte que cette valeur par défaut au niveau Common n'est jamais réellement utilisée | §Observabilité dans les guides de la plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Trois secrets sont générés automatiquement et stockés dans Secret Manager — ils ne
sont jamais définis en texte clair et **ne doivent jamais être modifiés après le
premier déploiement**. Ils sont générés avec `random_id` (dont la sortie `.hex`
est un hexadécimal valide — un `random_password` émettrait des caractères alphanumériques
non hexadécimaux et `LOCKBOX_MASTER_KEY` échouerait la validation `\h{64}` de ToolJet) :

- **`SECRET_KEY_BASE`** — 64 octets aléatoires rendus sous forme de 128 caractères hexadécimaux.
  Signe les sessions utilisateur et les cookies. Le faire tourner après le premier
  démarrage invalide toutes les sessions actives, forçant chaque utilisateur à se
  reconnecter.
- **`LOCKBOX_MASTER_KEY`** — 32 octets aléatoires rendus sous forme de 64 caractères hexadécimaux
  exactement (ToolJet exige cette longueur). Le Lockbox de ToolJet chiffre **toutes
  les informations d'identification de source de données stockées** et autres secrets
  au repos avec cette clé. Le faire tourner rend toutes les informations
  d'identification de source de données stockées indéchiffrables — chaque connexion
  doit être ressaisie.
- **`PGRST_JWT_SECRET`** — 32 octets aléatoires rendus sous forme de 64 caractères hexadécimaux.
  Signe les JWT PostgREST internes utilisés par la fonction ToolJet Database. Le faire
  tourner rompt la couche de requête de la ToolJet Database jusqu'à ce que chaque
  instance redémarre.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" \
  --filter="name~secret-key-base OR name~lockbox-master-key OR name~pgrst-jwt-secret"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par la base ; son
nom de secret est indiqué dans les sorties de déploiement de la plateforme (`database_password_secret`).
Voir [App_Common](App_Common.md) pour le secret partagé et le modèle Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

ToolJet nécessite **PostgreSQL 15** ; le moteur est fixe et MySQL ou d'autres moteurs
ne sont pas pris en charge. ToolJet utilise **deux bases de données sur la même
instance Cloud SQL** :

1. la **base de données de métadonnées** — applications, configurations de sources de
   données, utilisateurs, espaces de travail, sessions ; et
2. la **ToolJet Database** — la base de données sans code intégrée, exposée aux
   requêtes d'application via **PostgREST**, que chaque wrapper déploie à côté de
   l'application (un sidecar sur Cloud Run, un déploiement `additional_services` sur GKE). Les
   wrappers la nomment `<service_name>_tjdb` (les tirets remplacés par des underscores), de sorte
   que les déploiements partageant une instance Cloud SQL ne la partagent jamais ;
   `tooljet_db` n'est que la valeur par défaut autonome de ce module.

Lors du premier déploiement, un job ponctuel (`db-init`) s'exécute en utilisant `postgres:15-alpine`
et de manière idempotente :

1. Détecte le socket Unix du proxy d'authentification Cloud SQL (ou revient à l'IP
   privée) et attend que PostgreSQL soit accessible,
2. Crée (ou met à jour) le rôle d'application partagé **avec l'attribut `CREATEROLE`**
   — la création d'espace de travail de ToolJet exécute `CREATE ROLE` pour l'accès
   PostgREST par espace de travail et échoue avec *permission denied to create role*
   sans cela (`CREATEROLE` est un attribut de rôle, pas un privilège accordable —
   l'appartenance à `cloudsqlsuperuser` ne le confère pas),
3. Crée **les deux** bases de données si elles sont manquantes et accorde tous les
   privilèges sur chaque base de données et son schéma `public`,
4. Accorde `cloudsqlsuperuser` au rôle de l'application afin que ToolJet puisse gérer
   l'extension `pgcrypto`, et pré-crée `pgcrypto` sur les deux bases de données
   de manière défensive,
5. **Réinitialise le schéma `postgrest` comme appartenant à l'application** (`DROP SCHEMA IF EXISTS postgrest
   CASCADE; CREATE SCHEMA postgrest AUTHORIZATION <app_user>`)
   sur les deux bases de données — le `reconfigurePostgrest` de ToolJet au démarrage exécute
   `GRANT`/`CREATE FUNCTION` en tant qu'utilisateur de l'application, ce qui échoue
   `permission denied for schema postgrest` si le schéma est détenu par `postgres` ; le schéma ne contient que la
   configuration d'amorçage de PostgREST que ToolJet reconstruit immédiatement, donc
   une réinitialisation propre appartenant à l'application est sûre et idempotente,
6. Signale au proxy d'authentification Cloud SQL de s'arrêter gracieusement.

Le job peut être réexécuté en toute sécurité. Inspectez les bases de données
directement avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=tooljet --project "$PROJECT"
gcloud sql connect <instance-name> --user=<db-user> --database=<service_name>_tjdb --project "$PROJECT"
```

Les noms d'instance, de base de données et d'utilisateur se trouvent dans les sorties
de déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est un wrapper mince `FROM tooljet/tooljet-ce:<version>` — l'ARG Dockerfile est
**`TOOLJET_VERSION`** (pas le générique `APP_VERSION`, que la base injecte et qui
écraserait). Son `cloud-entrypoint.sh` s'exécute avant le démarrage du serveur NestJS :

- **Mappe `DB_*` aux `PG_*` / `TOOLJET_DB_*` discrets de ToolJet** — la
  plateforme injecte les variables standard `DB_HOST`, `DB_PORT`, `DB_NAME`,
  `DB_USER`, `DB_PASSWORD` ; le point d'entrée les traduit en
  `PG_HOST`/`PG_PORT`/`PG_USER`/`PG_PASS`/`PG_DB` (base de données de
  métadonnées) et les variables `TOOLJET_DB_*` correspondantes (deuxième base de données).
  node-pg accepte un **répertoire** de socket Cloud SQL comme hôte, de sorte que le
  socket fonctionne tel quel.
- **Compose `PGRST_DB_URI` en toute sécurité** — le DSN de PostgREST est une URL `user:pass@HOST`,
  qui ne peut pas contenir un répertoire de socket (ses deux-points rompent l'analyse
  d'URL). Le point d'entrée se ramifie sur la forme de l'hôte : répertoire de socket
  → forme libpq `?host=`, `127.0.0.1` (proxy GKE) → bouclage simple, IP privée →
  `sslmode=require`. Le mot de passe est encodé en URL.
- **Transmet Redis** — lit les variables `REDIS_HOST` / `REDIS_PORT` / `REDIS_AUTH`
  injectées par la base directement dans la configuration BullMQ de ToolJet.
- **Définit les valeurs par défaut `TOOLJET_HOST` et `PORT`** — `TOOLJET_HOST`
  (pilote les liens générés et les URI de redirection OAuth) prend par défaut l'URL
  de service calculée ; `PORT` prend par défaut `80` afin que les pods GKE
  lient le port attendu par le Service et les sondes (Cloud Run injecte `PORT`
  lui-même).
- **Exécute les migrations, puis exécute le serveur** — `npm run db:migrate:prod` (TypeORM
  `migration:run` pour les deux sources de données) s'exécute **avant** d'exécuter
  (`exec`) la commande de démarrage standard de ToolJet. Le `start:prod` de ToolJet
  est littéralement `node dist/src/main` et ne migre **pas** ; sans cette étape, la base de
  données de métadonnées reste vide et toute action basée sur la base de données
  échoue avec `relation "user_sessions" does not exist`. L'étape est idempotente (TypeORM enregistre les migrations
  appliquées).

---

## 5. Paramètres d'application de base {#5-core-application-settings}

`ToolJet_Common` établit l'environnement ToolJet de base afin que l'application
démarre correctement au premier démarrage :

- **Mode de service** — `SERVE_CLIENT = "true"` : le client React compilé est servi à partir
  du même processus NestJS, il n'y a donc pas de service nginx/client séparé. Le
  conteneur unique écoute sur le **port 80**.
- **Nom de la ToolJet Database** — `TOOLJET_DB = var.tooljet_db_name` nomme la deuxième base de données
  que le job `db-init` crée et que PostgREST sert. Les deux wrappers passent un
  `<service_name>_tjdb` à portée d'application ; la valeur par défaut `tooljet_db` n'est jamais
  utilisée par eux.
- **Environnement** — `NODE_ENV = "production"`.
- **Inscription** — `DISABLE_SIGNUPS = "true"` par défaut. Une nouvelle installation n'est pas
  ouverte à l'auto-inscription ; les opérateurs activent cela après avoir créé le
  premier administrateur.
- **Vérification des mises à jour** — `CHECK_FOR_UPDATES = "false"`.

Ajustements spécifiques à la plateforme gérés par le point d'entrée :

- **Cloud Run** reçoit `PORT` automatiquement (= `container_port` = 80) ; la
  valeur par défaut `PORT` du point d'entrée est une opération nulle là-bas.
- **GKE** n'est **pas** injecté `PORT`, donc la valeur par défaut `80`
  du point d'entrée est ce qui fait que le pod lie le port du Service/sonde au lieu
  de la valeur par défaut intégrée de ToolJet de 3000.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

`ToolJet_Common` déclare ses propres valeurs par défaut de variables `startup_probe`/`liveness_probe`
ciblant **`/api/health`** — le point de terminaison de santé public et non
authentifié de ToolJet (la surface `/api/*` nécessite autrement une
authentification). En pratique, cette valeur par défaut au niveau Common n'est jamais
utilisée : `ToolJet_CloudRun` et `ToolJet_GKE` transmettent toujours explicitement leurs
propres variables `startup_probe`/`liveness_probe` à l'appel du module `ToolJet_Common`,
et ces variables au niveau de la plateforme définissent la sonde `path` par
défaut à **`/`** à la place. La sonde de démarrage utilise un **budget
généreux (30 × 15 s)** pour absorber les migrations TypeORM qui s'exécutent au
premier démarrage avant que le serveur ne commence à écouter.

- **Cloud Run** — Sonde de démarrage HTTP sur `/` par défaut, délai initial
  de 60 s, période de 15 s, 30 échecs ; vivacité sur `/` par défaut,
  période de 30 s. Remplacez `startup_probe`/`liveness_probe` `path` par
  `/api/health` si préféré.
- **GKE** — les mêmes sondes `/` par défaut, la sonde de démarrage de
  l'infrastructure App_GKE absorbant la planification et le démarrage du sidecar
  Auth-Proxy.

---

## 7. Stockage d'objets {#7-object-storage}

`ToolJet_Common` ne déclare **pas** de bucket de données Cloud Storage (`storage_buckets = []`).
ToolJet stocke les définitions d'applications, les configurations de sources de
données et les fichiers téléchargés dans PostgreSQL, de sorte que le conteneur est
sans état. Des buckets supplémentaires ou des volumes GCS Fuse peuvent toujours être
déclarés par plateforme via `storage_buckets` / `gcs_volumes` si nécessaire.

---

Pour la configuration spécifique à ToolJet et destinée à l'utilisateur (variables
par groupe, sorties et comment explorer chaque service depuis la Console et la CLI),
consultez les guides de la plateforme : **[ToolJet_GKE](ToolJet_GKE.md)** et
**[ToolJet_CloudRun](ToolJet_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [ToolJet sur Google Cloud Run](ToolJet_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [ToolJet sur GKE Autopilot](ToolJet_GKE.md) — cette configuration déployée sur GKE.
