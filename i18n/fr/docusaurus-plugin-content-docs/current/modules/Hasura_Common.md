---
title: "Hasura Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Hasura — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Hasura_Common.md @ 3055034 sha256:1a0097345875 -->

# Hasura Common — Configuration applicative partagée {#hasura-common--shared-application-configuration}

`Hasura_Common` est la **couche applicative partagée** de Hasura. Elle n'est pas déployée seule ; elle fournit la configuration propre à Hasura sur laquelle s'appuient à la fois [Hasura_GKE](Hasura_GKE.md) et [Hasura_CloudRun](Hasura_CloudRun.md), afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute effectivement Hasura, consultez les guides des plateformes ([Hasura_GKE](Hasura_GKE.md), [Hasura_CloudRun](Hasura_CloudRun.md)) et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Hasura_Common | Où cela apparaît |
|---|---|---|
| Secret cryptographique | Génère `HASURA_GRAPHQL_ADMIN_SECRET` (32 caractères) et le stocke dans **Secret Manager** | Injecté automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `hasura/graphql-engine` avec un point d'entrée personnalisé ; build via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | Définit la tâche du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les privilèges | Sortie `initialization_jobs` |
| Stockage d'objets | Aucun — Hasura est sans état (`storage_buckets = []`) | Sortie `storage_buckets` |
| Paramètres principaux | Définit l'environnement de base de Hasura : console activée, port du serveur, les deux URL de connexion assemblées à l'exécution | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde de démarrage/disponibilité par défaut ciblant `/healthz` | §Observabilité dans les guides des plateformes |

---

## 2. Le secret cryptographique dans Secret Manager {#2-the-cryptographic-secret-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est jamais défini en clair :

- **`HASURA_GRAPHQL_ADMIN_SECRET`** — une chaîne aléatoire de 32 caractères (lettres et chiffres, sans caractères spéciaux). Il accorde un accès complet aux API GraphQL et de métadonnées (`/v1/graphql`, `/v1/metadata`) et à la console web intégrée sur `/console`. Les clients le présentent dans l'en-tête de requête `x-hasura-admin-secret`. Il est stocké sous l'ID de secret `secret-<resource-prefix>-hasura-admin-secret`.

Récupérez le secret après le déploiement :

```bash
# Find the admin secret for this deployment:
gcloud secrets list --project "$PROJECT" --filter="name~admin-secret"

# Read its value (this is your x-hasura-admin-secret):
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Contrairement à une clé de chiffrement, le secret administrateur ne touche pas aux données stockées — sa rotation est sans risque, mais elle invalide immédiatement tout client (ou workflow n8n/d'automatisation) qui envoie encore l'ancienne valeur ; mettez donc à jour ces consommateurs dans la même modification. Le mot de passe de la base de données est généré et géré séparément par le socle ; le nom de son secret est indiqué dans les sorties du déploiement de la plateforme (`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et initialisation {#3-database-engine-and-bootstrap}

Hasura nécessite **PostgreSQL 15** ; le moteur est fixe et MySQL ou d'autres moteurs ne sont pas pris en charge — le catalogue de métadonnées propre à Hasura et la source de données connectée par défaut résident tous deux dans Postgres. Lors du premier déploiement, une tâche ponctuelle (`db-init`) s'exécute avec `postgres:15-alpine` et, de manière idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy et crée un lien symbolique vers celui-ci pour l'accès `psql`,
2. Attend que PostgreSQL soit joignable (jusqu'à 60 tentatives),
3. Crée le rôle de l'application avec `LOGIN` (ou met à jour son mot de passe),
4. Crée la base de données de l'application avec ce rôle comme propriétaire (si elle n'existe pas),
5. Accorde tous les privilèges sur la base de données à ce rôle,
6. Signale au Cloud SQL Auth Proxy de s'arrêter proprement (`quitquitquit`).

Au premier démarrage, Hasura installe automatiquement son propre schéma de catalogue de métadonnées dans la base de données — il n'y a pas de tâche de migration distincte. La tâche `db-init` peut être réexécutée sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée encapsule `hasura/graphql-engine:<version>` avec un léger point d'entrée en shell POSIX (`hasura-entrypoint.sh`) qui s'exécute avant `graphql-engine serve`. Le tag de base provient d'un ARG de build propre à l'application, `HASURA_VERSION` (par défaut `v2.36.0` ; `"latest"` est remplacé par ce tag épinglé) — délibérément **pas** l'`APP_VERSION` générique que le socle injecte et qui l'écraserait autrement.

Le point d'entrée existe parce que Hasura a besoin de deux chaînes de connexion et que Cloud Run n'interpole pas `$(VAR)` dans les valeurs d'environnement :

- **Assemble `HASURA_GRAPHQL_DATABASE_URL`** (la source de données connectée par défaut) et **`HASURA_GRAPHQL_METADATA_DATABASE_URL`** (où Hasura stocke ses propres métadonnées) à partir de `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` injectées par la plateforme. Pour un déploiement à base de données unique, les deux pointent vers la même base.
- **Encode le mot de passe pour l'URL** en pur shell POSIX (encodage en pourcentage RFC 3986) — l'image de base de Hasura ne contient ni node, ni python, ni jq, et des caractères tels que `@ : / ? # % & +` corrompraient sinon le DSN.
- **Distingue selon `DB_HOST`** afin que le DSN corresponde à la manière dont la plateforme fournit Postgres :
  - un **répertoire de socket** (`/cloudsql/...`, l'intégration Cloud SQL native de Cloud Run) → forme socket libpq `postgres://user:pass@/db?host=/cloudsql/<inst>` ;
  - **`127.0.0.1`/`localhost`** (le sidecar cloud-sql-proxy de GKE, TLS déjà terminé) → loopback simple, sans `sslmode` ;
  - **tout autre hôte** (TCP direct sur IP privée) → `?sslmode=require` (Cloud SQL refuse les connexions non chiffrées sur IP privée).
- **Définit `HASURA_GRAPHQL_ENABLE_CONSOLE = "true"`** et lie `HASURA_GRAPHQL_SERVER_PORT = 8080`, puis exécute `exec graphql-engine serve` en tant que PID 1.

`HASURA_GRAPHQL_ADMIN_SECRET` est injecté par la plateforme depuis Secret Manager et lu directement dans l'environnement par le moteur — aucun mappage n'est nécessaire.

---

## 5. Paramètres applicatifs principaux {#5-core-application-settings}

`Hasura_Common` établit l'environnement de base de Hasura afin que l'application démarre correctement la première fois :

- **Console** — `HASURA_GRAPHQL_ENABLE_CONSOLE = "true"` ; la console d'administration est servie sur `/console`, protégée par le secret administrateur. Définissez-la à `"false"` via `environment_variables` en production et gérez les métadonnées avec la CLI `hasura`.
- **Port** — `HASURA_GRAPHQL_SERVER_PORT = 8080` (le `container_port`).
- **Authentification** — `HASURA_GRAPHQL_ADMIN_SECRET` protège les API GraphQL et de métadonnées ainsi que la console ; `/healthz` reste public pour les sondes.
- **Ressources** — `cpu_limit = "1000m"`, `memory_limit = "512Mi"` par défaut ; augmentez la mémoire pour une forte concurrence de requêtes ou des métadonnées volumineuses.
- **Aucun stockage** — Hasura est sans état ; `storage_buckets` renvoie une liste vide.

Ajustements propres à chaque plateforme gérés ici :

- **Cloud Run** — le point d'entrée construit le DSN sous forme socket ou IP privée et permet un fonctionnement compatible avec la mise à l'échelle jusqu'à zéro (tout l'état est externe).
- **GKE** — le point d'entrée cible le sidecar Auth Proxy sur `127.0.0.1` (loopback simple, sans SSL) ; le secret administrateur est monté via CSI dans l'espace de noms.

Les variables d'environnement supplémentaires en clair transmises via l'entrée `environment_variables` de la plateforme sont fusionnées par-dessus ces valeurs par défaut (par exemple `HASURA_GRAPHQL_DEV_MODE`, `HASURA_GRAPHQL_CORS_DOMAIN` ou `HASURA_GRAPHQL_UNAUTHORIZED_ROLE`).

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent **`/healthz`** — le point de terminaison de santé public et sans authentification de Hasura, qui renvoie `200 OK` dès que le moteur a démarré et s'est connecté à Postgres. Comme `/v1/graphql`, `/v1/metadata` et `/console` exigent tous le secret administrateur, faire pointer une sonde vers l'un d'eux renvoie 401 et la charge de travail ne devient jamais Ready — `/healthz` est la bonne cible.

- **Cloud Run** utilise des sondes HTTP sur `/healthz` avec un délai initial de 30 secondes et une fenêtre de démarrage de 30 tentatives (pour laisser le temps d'installer le catalogue de métadonnées au premier démarrage).
- **GKE** utilise les mêmes sondes HTTP `/healthz` (démarrage `failure_threshold = 30`, disponibilité `failure_threshold = 3`).

---

## 7. Stockage d'objets {#7-object-storage}

Hasura stocke **tout** son état — métadonnées, schéma et données — dans PostgreSQL. Il n'a besoin d'aucun stockage de fichiers ; `storage_buckets` est donc une liste vide et aucun bucket GCS n'est provisionné. Les charges utiles des déclencheurs d'événements et les résultats des requêtes ne sont pas persistés dans un stockage d'objets.

---

Pour la configuration propre à Hasura destinée aux utilisateurs (variables par groupe, sorties et manière d'explorer chaque service depuis la console et la CLI), consultez les guides des plateformes : **[Hasura_GKE](Hasura_GKE.md)** et **[Hasura_CloudRun](Hasura_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Hasura sur Google Cloud Run](Hasura_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Hasura sur GKE Autopilot](Hasura_GKE.md) — cette configuration déployée sur GKE.
