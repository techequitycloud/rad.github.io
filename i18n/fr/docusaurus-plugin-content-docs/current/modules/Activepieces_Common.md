---
title: "Activepieces Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Activepieces — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Activepieces_Common.md @ 15fd4c7 sha256:03f111d557ea -->

# Activepieces Common — Configuration d'application partagée {#activepieces-common--shared-application-configuration}

`Activepieces_Common` est la **couche d'application partagée** pour Activepieces. Elle n'est
pas déployée seule ; elle fournit plutôt la configuration spécifique à Activepieces
sur laquelle s'appuient [Activepieces_GKE](Activepieces_GKE.md) et
[Activepieces_CloudRun](Activepieces_CloudRun.md), de sorte que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux
ne configurent jamais cette couche directement — elle n'a pas ses propres entrées
d'interface utilisateur de déploiement — mais comprendre ce qu'elle fournit explique
les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute Activepieces, consultez les guides
de la plateforme ([Activepieces_GKE](Activepieces_GKE.md),
[Activepieces_CloudRun](Activepieces_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Activepieces_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `AP_ENCRYPTION_KEY` (hexadécimal 32 caractères) et `AP_JWT_SECRET` (alphanumérique 32 caractères) et les stocke dans **Secret Manager** | Injecté automatiquement ; récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `activepieces/activepieces` avec un script de point d'entrée personnalisé ; construit via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides de la plateforme |
| Amorçage de la base de données | Définit le job de premier déploiement (`db-init`) qui crée la base de données, l'utilisateur, les autorisations et installe `pgvector` | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket de données **Cloud Storage** | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement Activepieces de base : mode de file d'attente, port, télémétrie, mode d'exécution, état d'inscription | Comportement de l'application dans les guides de la plateforme |
| Sondes de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/api/v1/flags` | §Observabilité dans les guides de la plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager — ils ne sont
jamais définis en texte clair et ne doivent jamais être modifiés après le premier
déploiement :

- **`AP_ENCRYPTION_KEY`** — une chaîne hexadécimale de 32 caractères dérivée de 16 octets
  aléatoires. Utilisée par Activepieces pour chiffrer toutes les informations
  d'identification de connexion et les secrets d'étape de flux stockés. La faire
  tourner après le premier démarrage corrompt définitivement toutes les informations
  d'identification stockées ; elles ne peuvent pas être déchiffrées et doivent être
  saisies à nouveau pour chaque intégration.
- **`AP_JWT_SECRET`** — une chaîne alphanumérique aléatoire de 32 caractères. Utilisée
  pour signer tous les jetons de session utilisateur. La faire tourner invalide
  immédiatement toutes les sessions actives, forçant chaque utilisateur à se
  déconnecter et à se réauthentifier.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~encryption-key OR name~jwt-secret"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ;
son nom de secret est indiqué dans les sorties de déploiement de la plateforme
(`database_password_secret`). Voir [App_Common](App_Common.md) pour le modèle de secret partagé et
d'identité de charge de travail.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Activepieces nécessite **PostgreSQL 15** ; le moteur est fixe et MySQL ou d'autres
moteurs ne sont pas pris en charge. Lors du premier déploiement, un job ponctuel
(`db-init`) s'exécute en utilisant `postgres:15-alpine` et de manière idempotente :

1. Détecte le socket Unix du proxy d'authentification Cloud SQL et le mappe pour
   l'accès `psql`,
2. Attend que PostgreSQL soit accessible,
3. Crée (ou met à jour) l'utilisateur de l'application avec le mot de passe généré,
4. Crée (ou reconfigure) la base de données de l'application avec cet utilisateur
   comme propriétaire,
5. Accorde tous les privilèges sur la base de données et le schéma public,
6. Installe l'extension `pgvector` (`CREATE EXTENSION IF NOT EXISTS vector`) en tant que
   super-utilisateur — requise pour les éléments de workflow basés sur l'IA qui
   utilisent la recherche de similarité vectorielle,
7. Signale au proxy d'authentification Cloud SQL de s'arrêter gracieusement.

Le job peut être relancé en toute sécurité. Inspectez la base de données directement
avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms d'instance, de base de données et d'utilisateur se trouvent dans les sorties
de déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée encapsule `activepieces/activepieces:<version>` avec un point d'entrée shell
léger (`entrypoint.sh`) qui s'exécute avant le démarrage du serveur Node.js :

- **Mappe `DB_*` à `AP_POSTGRES_*`** — la plateforme injecte les
  variables standard `DB_HOST`, `DB_NAME`, `DB_USER`,
  `DB_PASSWORD` ; le point d'entrée les traduit en `AP_POSTGRES_HOST`,
  `AP_POSTGRES_DATABASE`, `AP_POSTGRES_USERNAME`, `AP_POSTGRES_PASSWORD` natifs à Activepieces
  au moment de l'exécution.
- **Construit `AP_REDIS_URL`** — lorsque Redis est activé, construit l'URL de
  connexion Redis à partir de `QUEUE_BULL_REDIS_HOST`, `QUEUE_BULL_REDIS_PORT`, et
  éventuellement `QUEUE_BULL_REDIS_PASSWORD`.
- **Met à jour `AP_FRONTEND_URL` / `AP_WEBHOOK_URL_PREFIX`** — sur Cloud Run,
  remplace les deux par le `CLOUDRUN_SERVICE_URL` réel injecté au moment de
  l'exécution, corrigeant toute URL prédite obsolète au moment de la planification
  et garantissant que les webhooks et les redirections OAuth utilisent toujours la
  véritable adresse du service.
- **Localise et lance le serveur** — recherche `main.js` sous le chemin
  d'installation d'Activepieces et le lance en tant que PID 1 avec `exec bun <entry>`
  lorsque `bun` est présent (Activepieces 0.35+), sinon `exec node <entry>`.

---

## 5. Paramètres d'application de base {#5-core-application-settings}

`Activepieces_Common` établit l'environnement Activepieces de base afin que
l'application démarre correctement au premier lancement :

- **Mode de file d'attente** — `AP_QUEUE_MODE = "MEMORY"` par défaut ; passe à `"REDIS"`
  lorsque Redis est activé via les paramètres de déploiement de la plateforme.
- **Port** — `AP_PORT = "8080"` ; `AP_POSTGRES_PORT = "5432"`.
- **Environnement** — `AP_ENVIRONMENT = "prod"` (Activepieces n'accepte que `prod`,
  `dev` ou `test`).
- **Télémétrie** — `AP_TELEMETRY_ENABLED = "false"` (désactivée par défaut ; aucune donnée
  envoyée au cloud Activepieces).
- **Mode d'exécution** — `AP_EXECUTION_MODE = "UNSANDBOXED"` avec `AP_SANDBOX_TYPE = "NO_SANDBOX"`,
  requis car Cloud Run et GKE ne prennent pas en charge le bac à sable de conteneur
  privilégié que le mode bac à sable d'Activepieces exige.
- **Inscription** — `AP_SIGN_UP_ENABLED = "true"` par défaut. Remplacez ceci par `"false"`
  via `environment_variables` après avoir créé le compte administrateur initial pour
  empêcher la création de comptes non autorisés.

Ajustements spécifiques à la plateforme gérés ici :

- **Cloud Run** définit en outre `AP_FRONTEND_URL` et `AP_WEBHOOK_URL_PREFIX` à partir
  de l'URL de service prédite au moment de la planification ; le point d'entrée les
  corrige au moment de l'exécution à partir de `CLOUDRUN_SERVICE_URL`.
- **GKE** définit ces URL sur l'URL de service du cluster interne (`http://<name>.<namespace>.svc.cluster.local`) ;
  elles doivent être mises à jour vers l'URL du LoadBalancer externe ou du domaine
  personnalisé via `environment_variables` une fois l'adresse IP externe connue.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `/api/v1/flags` — le point de terminaison de l'API
Activepieces qui ne répond qu'une fois le serveur entièrement initialisé et connecté
à PostgreSQL. Une fenêtre de démarrage généreuse permet les migrations de base de
données qui s'exécutent au premier démarrage.

- **Cloud Run** utilise des sondes HTTP ciblant `/api/v1/flags` avec un délai
  initial de 120 secondes et une fenêtre de 10 tentatives (total ~420 secondes après
  le délai) — suffisant pour les migrations au premier démarrage sur les instances
  Cloud SQL typiques.
- **GKE** utilise également des sondes HTTP ciblant `/` par défaut
  avec un délai initial de 60 secondes ; envisagez de définir `path = "/api/v1/flags"` pour
  une signalisation de santé plus précise.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket de données **Cloud Storage** dédié est déclaré ici et provisionné par le
socle, qui accorde également l'accès au compte de service de la charge de travail.
Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration spécifique à Activepieces et destinée à l'utilisateur (variables
par groupe, sorties et comment explorer chaque service depuis la Console et la CLI),
consultez les guides de la plateforme : **[Activepieces_GKE](Activepieces_GKE.md)**
et **[Activepieces_CloudRun](Activepieces_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Activepieces sur Google Cloud Run](Activepieces_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Activepieces sur GKE Autopilot](Activepieces_GKE.md) — cette configuration déployée sur GKE.
