---
title: "Activepieces Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Activepieces — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Activepieces_Common.md @ 3055034 sha256:480947b86f8a -->

# Activepieces Common — Configuration applicative partagée {#activepieces-common--shared-application-configuration}

`Activepieces_Common` est la **couche applicative partagée** d'Activepieces. Elle
n'est pas déployée seule ; elle fournit la configuration propre à Activepieces sur
laquelle s'appuient à la fois [Activepieces_GKE](Activepieces_GKE.md) et
[Activepieces_CloudRun](Activepieces_CloudRun.md), afin que les deux variantes de
plateforme se comportent de façon identique là où cela compte. Les utilisateurs
finaux ne configurent jamais cette couche directement — elle n'a aucune entrée
propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique
les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Activepieces, consultez
les guides de plateforme ([Activepieces_GKE](Activepieces_GKE.md),
[Activepieces_CloudRun](Activepieces_CloudRun.md)) et les guides des socles
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Activepieces_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `AP_ENCRYPTION_KEY` (32 caractères hexadécimaux) et `AP_JWT_SECRET` (32 caractères alphanumériques) et les stocke dans **Secret Manager** | Injectés automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `activepieces/activepieces` avec un script de point d'entrée personnalisé ; construite via Cloud Build | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données et l'utilisateur, accorde les droits et installe `pgvector` | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket de données **Cloud Storage** | Sortie `storage_buckets` |
| Paramètres principaux | Définit l'environnement de base d'Activepieces : mode de file d'attente, port, télémétrie, mode d'exécution, état de l'inscription | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de démarrage/de vivacité par défaut ciblant `/api/v1/flags` | §Observabilité dans les guides de plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager — ils ne
sont jamais définis en clair et ne doivent jamais être modifiés après le premier
déploiement :

- **`AP_ENCRYPTION_KEY`** — une chaîne hexadécimale de 32 caractères dérivée de 16
  octets aléatoires. Activepieces l'utilise pour chiffrer tous les identifiants de
  connexion stockés et les secrets des étapes de flux. Sa rotation après le premier
  démarrage corrompt définitivement tous les identifiants stockés ; ils ne peuvent
  plus être déchiffrés et doivent être ressaisis pour chaque intégration.
- **`AP_JWT_SECRET`** — une chaîne alphanumérique aléatoire de 32 caractères.
  Utilisée pour signer tous les jetons de session utilisateur. Sa rotation invalide
  immédiatement toutes les sessions actives et oblige chaque utilisateur à se
  déconnecter puis à s'authentifier de nouveau.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~encryption-key OR name~jwt-secret"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ;
le nom de son secret figure dans les sorties du déploiement de plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Activepieces nécessite **PostgreSQL 15** ; le moteur est imposé et MySQL ou d'autres
moteurs ne sont pas pris en charge. Lors du premier déploiement, un job ponctuel
(`db-init`) s'exécute à l'aide de `postgres:15-alpine` et, de façon idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy et le mappe pour l'accès `psql`,
2. Attend que PostgreSQL soit joignable,
3. Crée (ou met à jour) l'utilisateur de l'application avec le mot de passe généré,
4. Crée (ou reconfigure) la base de données de l'application avec cet utilisateur
   comme propriétaire,
5. Accorde tous les privilèges sur la base de données et le schéma public,
6. Installe l'extension `pgvector` (`CREATE EXTENSION IF NOT EXISTS vector`) en tant
   que superutilisateur — requise pour les pièces de workflow alimentées par l'IA qui
   utilisent la recherche de similarité vectorielle,
7. Signale au Cloud SQL Auth Proxy de s'arrêter proprement.

Le job peut être relancé sans risque. Inspectez directement la base de données
avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée encapsule `activepieces/activepieces:<version>` avec un léger
point d'entrée shell (`entrypoint.sh`) qui s'exécute avant le démarrage du serveur
Node.js :

- **Mappe `DB_*` vers `AP_POSTGRES_*`** — la plateforme injecte les variables
  standard `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` ; le point d'entrée les
  traduit à l'exécution en variables natives d'Activepieces `AP_POSTGRES_HOST`,
  `AP_POSTGRES_DATABASE`, `AP_POSTGRES_USERNAME`, `AP_POSTGRES_PASSWORD`.
- **Construit `AP_REDIS_URL`** — lorsque Redis est activé, construit l'URL de
  connexion Redis à partir de `QUEUE_BULL_REDIS_HOST`, `QUEUE_BULL_REDIS_PORT` et,
  le cas échéant, `QUEUE_BULL_REDIS_PASSWORD`.
- **Met à jour `AP_FRONTEND_URL` / `AP_WEBHOOK_URL_PREFIX`** — sur Cloud Run,
  remplace les deux par la valeur réelle de `CLOUDRUN_SERVICE_URL` injectée à
  l'exécution, ce qui corrige toute URL prévue au moment du plan devenue obsolète et
  garantit que les webhooks et les redirections OAuth utilisent toujours l'adresse
  réelle du service.
- **Localise et lance le serveur** — recherche `main.js` sous le chemin
  d'installation d'Activepieces et le lance en tant que PID 1 avec
  `exec bun <entry>` lorsque `bun` est présent (Activepieces 0.35+), sinon avec
  `exec node <entry>`.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Activepieces_Common` établit l'environnement de base d'Activepieces afin que
l'application démarre correctement dès le premier démarrage :

- **Mode de file d'attente** — `AP_QUEUE_MODE = "MEMORY"` par défaut ; passe à
  `"REDIS"` lorsque Redis est activé via les paramètres du déploiement de plateforme.
- **Port** — `AP_PORT = "8080"` ; `AP_POSTGRES_PORT = "5432"`.
- **Environnement** — `AP_ENVIRONMENT = "production"`.
- **Télémétrie** — `AP_TELEMETRY_ENABLED = "false"` (désactivée par défaut ; aucune
  donnée envoyée au cloud Activepieces).
- **Mode d'exécution** — `AP_EXECUTION_MODE = "UNSANDBOXED"` avec `AP_SANDBOX_TYPE = "NO_SANDBOX"`,
  requis car Cloud Run et GKE ne prennent pas en charge le sandbox de conteneur
  privilégié qu'exige le mode sandboxé d'Activepieces.
- **Inscription** — `AP_SIGN_UP_ENABLED = "true"` par défaut. Remplacez cette valeur
  par `"false"` via `environment_variables` après avoir créé le compte administrateur
  initial, afin d'empêcher la création de comptes non autorisés.

Ajustements propres à chaque plateforme gérés ici :

- **Cloud Run** définit en plus `AP_FRONTEND_URL` et `AP_WEBHOOK_URL_PREFIX` à partir
  de l'URL de service prévue au moment du plan ; le point d'entrée les corrige à
  l'exécution à partir de `CLOUDRUN_SERVICE_URL`.
- **GKE** définit ces URL sur l'URL de service interne du cluster (`http://<name>.<namespace>.svc.cluster.local`) ;
  elles doivent être mises à jour vers l'URL du LoadBalancer externe ou du domaine
  personnalisé via `environment_variables` une fois l'IP externe connue.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `/api/v1/flags` — le point de terminaison de l'API de
flags d'Activepieces, qui ne répond qu'une fois le serveur entièrement initialisé et
connecté à PostgreSQL. Une fenêtre de démarrage généreuse laisse le temps aux
migrations de base de données exécutées au premier démarrage.

- **Cloud Run** utilise des sondes HTTP ciblant `/api/v1/flags` avec un délai initial
  de 120 secondes et une fenêtre de 10 nouvelles tentatives (environ 420 secondes au
  total après le délai) — suffisant pour les migrations du premier démarrage sur des
  instances Cloud SQL typiques.
- **GKE** utilise également des sondes HTTP, ciblant `/` par défaut avec un délai
  initial de 60 secondes ; envisagez de définir `path = "/api/v1/flags"` pour un
  signal de santé plus précis.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket de données **Cloud Storage** dédié est déclaré ici et provisionné par le
socle, qui accorde également l'accès au compte de service de la charge de travail.
Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Activepieces destinée aux utilisateurs (variables par
groupe, sorties et exploration de chaque service depuis la console et la CLI),
consultez les guides de plateforme : **[Activepieces_GKE](Activepieces_GKE.md)** et
**[Activepieces_CloudRun](Activepieces_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Activepieces sur Google Cloud Run](Activepieces_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Activepieces sur GKE Autopilot](Activepieces_GKE.md) — cette configuration déployée sur GKE.
