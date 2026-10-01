---
title: "EvolutionAPI Common — Configuration applicative partagée"
description: "Référence de configuration partagée du module EvolutionAPI — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/EvolutionAPI_Common.md @ 3055034 sha256:d975775d4e62 -->

# EvolutionAPI Common — Configuration applicative partagée {#evolutionapi-common--shared-application-configuration}

`EvolutionAPI_Common` est la **couche applicative partagée** d'Evolution API. Elle
n'est pas déployée seule ; elle fournit la configuration propre à Evolution API sur
laquelle s'appuient à la fois [EvolutionAPI_GKE](EvolutionAPI_GKE.md) et
[EvolutionAPI_CloudRun](EvolutionAPI_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais cette couche directement — elle n'a aucune entrée propre
dans l'interface de déploiement —, mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Evolution API est une passerelle Node.js vers l'API WhatsApp Business (construite sur
la bibliothèque Baileys) qui expose une API REST et une interface de gestion
(manager) pour provisionner des instances WhatsApp, envoyer et recevoir des messages,
et raccorder des webhooks à d'autres systèmes.

Pour l'infrastructure qui provisionne et exécute effectivement Evolution API,
consultez les guides des plateformes ([EvolutionAPI_GKE](EvolutionAPI_GKE.md),
[EvolutionAPI_CloudRun](EvolutionAPI_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par EvolutionAPI_Common | Où cela apparaît |
|---|---|---|
| Secret cryptographique | Génère le `AUTHENTICATION_API_KEY` global (32 caractères) et le stocke dans **Secret Manager** | Injecté automatiquement comme variable d'environnement secrète ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule `evoapicloud/evolution-api` avec un point d'entrée cloud personnalisé ; build via Cloud Build et mise en miroir dans Artifact Registry | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge (Evolution API utilise Prisma) | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les droits ; les migrations Prisma s'exécutent au démarrage du conteneur | Sortie `initialization_jobs` |
| Cache | Active le backend de cache **Redis** (`CACHE_REDIS_URI`), assemblé par le point d'entrée à partir du `REDIS_HOST` injecté | §Redis dans les guides des plateformes |
| Stockage objet | Déclare un bucket de données **Cloud Storage** | Sortie `storage_buckets` |
| Paramètres principaux | Définit l'environnement de base d'Evolution API : type et port du serveur, flags d'enregistrement en base de données, préfixe de cache, mode d'authentification par clé d'API | Comportement de l'application dans les guides des plateformes |
| Vérifications de santé | Fournit les sondes de démarrage, de vivacité et de disponibilité par défaut, qui ciblent le chemin racine `/` | §Observabilité dans les guides des plateformes |

---

## 2. Secret cryptographique dans Secret Manager {#2-cryptographic-secret-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est jamais
défini en clair et ne doit jamais être modifié après le premier déploiement :

- **`AUTHENTICATION_API_KEY`** — une chaîne aléatoire de 32 caractères stockée sous
  le nom `secret-<resource-prefix>-<app>-api-key`. C'est la **clé d'API
  d'administration globale** d'Evolution API. Chaque appel d'administration et chaque
  appel de gestion d'instance s'authentifie avec elle. Elle doit être **stable d'un
  redémarrage à l'autre et identique pour chaque réplica et chaque job
  d'initialisation** — si elle fait l'objet d'une rotation, les instances WhatsApp
  déjà provisionnées deviennent injoignables et toute intégration qui détient encore
  l'ancienne clé commence à renvoyer `401`. Le module Common la génère donc une seule
  fois et l'injecte comme variable d'environnement secrète, plutôt que d'en créer une
  à chaque révision.

Récupérez la clé après le déploiement :

```bash
# List the API-key secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~api-key"

# Read the current value (this is the key your API clients send as `apikey`):
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ;
le nom de son secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Evolution API nécessite **PostgreSQL 15** ; le moteur est fixe et MySQL ou d'autres
moteurs ne sont pas pris en charge. Au premier déploiement, un job ponctuel
(`db-init`) s'exécute avec `postgres:15-alpine` et, de manière idempotente :

1. Résout l'hôte Cloud SQL — le répertoire de socket Unix de l'Auth Proxy sur Cloud
   Run, ou l'hôte TCP du proxy sur GKE (avec repli sur le `DB_IP` privé s'il n'est
   pas défini),
2. Attend que PostgreSQL soit joignable,
3. Crée (ou met à jour) le rôle applicatif `evolution` avec `LOGIN CREATEDB` et le
   mot de passe généré,
4. Crée la base de données `evolution` si elle n'existe pas déjà,
5. Accorde tous les privilèges sur la base de données et sur le schéma `public` à
   l'utilisateur de l'application et en fait le **propriétaire du schéma `public`**
   (Postgres 15 l'exige pour que Prisma puisse créer et modifier des objets sans
   `permission denied for schema public`),
6. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter (`/quitquitquit`) afin que le
   pod du Job se termine.

Le job crée uniquement la base de données et le rôle — **le schéma et les tables sont
créés par les migrations Prisma qui s'exécutent au démarrage du conteneur**
(`deploy_database.sh` → `prisma migrate deploy`), et non par ce job. Le job peut être
réexécuté sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données (`evolution`) et de l'utilisateur
(`evolution`) figurent dans les sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est une fine surcouche construite `FROM evoapicloud/evolution-api:<version>`.
L'espace de noms Docker Hub amont `atendai/evolution-api` est désormais restreint
(les pulls anonymes renvoient `401`) ; le build utilise donc l'espace de noms
`evoapicloud`, accessible publiquement, qui porte les mêmes tags de version
(`v2.1.1`, `v2.2.3`, `latest`, …). Un argument de build dédié
(`EVOLUTIONAPI_VERSION`) épingle le tag de base — et **non** le générique
`APP_VERSION`, que le socle injecte et qui serait sinon écrasé par la valeur de
`application_version`. Lorsque `application_version = "latest"`, l'argument de build
correspond à un `v2.1.1` épinglé.

Un fin point d'entrée shell (`cloud-entrypoint.sh`) s'exécute avant le démarrage du
serveur Node.js :

- **Assemble `DATABASE_CONNECTION_URI`** (une URL Prisma/`postgres://`) à partir des
  variables `DB_*` injectées par le socle, selon l'hôte résolu :
  - **Cloud Run** — `DB_HOST` est un *répertoire* de socket Cloud SQL ; le socket est
    donc passé comme paramètre de requête `?host=` (`sslmode=disable` ; l'Auth Proxy
    termine le TLS). Les deux-points du socket casseraient l'autorité de l'URL ; ils ne
    vont donc jamais dans l'emplacement `host:port`.
  - **GKE** — le sidecar cloud-sql-proxy écoute sur `127.0.0.1`, d'où du TCP simple
    avec `sslmode=disable`.
  - **IP privée directe** — `sslmode=require` (Cloud SQL refuse le TCP non chiffré
    sur IP privée). Le mot de passe de la base de données est encodé pour l'URL avant
    d'y être inséré.
- **Assemble `CACHE_REDIS_URI`** à partir des `REDIS_HOST`/`REDIS_PORT` injectés
  (index de base Redis `6`), éventuellement avec `REDIS_AUTH`.
- **Attribue par défaut à `SERVER_URL`** l'URL publique du service
  (`CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`) — Evolution API l'intègre dans les URL
  de QR code et de rappel de webhook.
- **Attend le socket du Cloud SQL Auth Proxy** (jusqu'à ~120 s) avant de passer la
  main, car la migration Prisma au démarrage échoue brutalement si la base de données
  n'est pas encore joignable — ce qui laisserait le port 8080 non lié et bloquerait
  la sonde de démarrage sans aucun journal applicatif.
- **Exécute la commande de démarrage propre à l'image** — lance le script de
  migration Prisma comme sous-processus (afin qu'un échec transitoire de migration ne
  puisse pas tuer le shell parent), puis `npm run start:prod`.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`EvolutionAPI_Common` établit l'environnement de base d'Evolution API afin que
l'application démarre correctement dès le premier lancement :

- **Serveur** — `SERVER_TYPE = "http"`, `SERVER_PORT = "8080"`.
- **Base de données (Prisma)** — `DATABASE_ENABLED = "true"`,
  `DATABASE_PROVIDER = "postgresql"`, `DATABASE_CONNECTION_CLIENT_NAME = "evolution"`,
  et les flags `DATABASE_SAVE_DATA_*` (instances, nouveaux messages, mises à jour de
  messages, contacts, conversations) tous à `"true"`, afin que l'historique des
  messages et l'état des instances persistent dans PostgreSQL. L'URI de connexion
  elle-même est construite par le point d'entrée.
- **Cache (Redis)** — `CACHE_REDIS_ENABLED = "true"`,
  `CACHE_REDIS_PREFIX_KEY = "evolution"`, `CACHE_REDIS_SAVE_INSTANCES = "true"`,
  `CACHE_LOCAL_ENABLED = "false"`. Le `CACHE_REDIS_URI` est construit par le point
  d'entrée.
- **Authentification** — `AUTHENTICATION_TYPE = "apikey"` ; la clé est injectée
  depuis Secret Manager sous le nom `AUTHENTICATION_API_KEY`.
- **Journalisation** — `LOG_LEVEL = "ERROR"`, `LOG_COLOR = "false"`.

Aucune extension PostgreSQL ni aucun plugin MySQL n'est requis — les migrations
Prisma d'Evolution API n'utilisent que le schéma standard `public`.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage, de vivacité et de disponibilité par défaut ciblent le chemin
racine **`/`** — Evolution API y sert une réponse d'état/d'accueil non authentifiée
dès que le serveur est opérationnel ; c'est donc un bon signal de vivacité non
authentifié (l'interface `/manager` et tous les points de terminaison `/instance/*`
exigent la clé d'API). Une fenêtre de démarrage généreuse laisse le temps aux
migrations Prisma qui s'exécutent au premier démarrage.

- **Démarrage** — HTTP `/` avec un délai initial de 60 secondes et une fenêtre de 30
  tentatives (période de 15 s) — suffisant pour les migrations Prisma du premier
  démarrage sur une instance Cloud SQL neuve.
- **Vivacité** — HTTP `/` avec un délai initial de 60 secondes et une période de 30
  secondes.
- **Disponibilité** — HTTP `/` avec un délai initial de 30 secondes et une période de
  10 secondes.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket de données **Cloud Storage** dédié (`name_suffix = "storage"`, classe
STANDARD, prévention de l'accès public appliquée) est déclaré ici et provisionné par
le socle, qui accorde également l'accès au compte de service de la charge de travail.
Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Evolution API destinée aux utilisateurs (variables par
groupe, sorties, et comment explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[EvolutionAPI_GKE](EvolutionAPI_GKE.md)** et
**[EvolutionAPI_CloudRun](EvolutionAPI_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [EvolutionAPI sur Google Cloud Run](EvolutionAPI_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [EvolutionAPI sur GKE Autopilot](EvolutionAPI_GKE.md) — cette configuration déployée sur GKE.
