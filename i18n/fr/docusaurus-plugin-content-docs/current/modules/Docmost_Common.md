---
title: "Docmost Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Docmost — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Docmost_Common.md @ 3055034 sha256:2de928aee3bd -->

# Docmost Common — Configuration applicative partagée {#docmost-common--shared-application-configuration}

`Docmost_Common` est la **couche applicative partagée** de Docmost. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Docmost sur laquelle
s'appuient à la fois [Docmost_GKE](Docmost_GKE.md) et [Docmost_CloudRun](Docmost_CloudRun.md),
afin que les deux variantes de plateforme se comportent de façon identique là où cela
compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle
n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Docmost, consultez les
guides de plateforme ([Docmost_GKE](Docmost_GKE.md), [Docmost_CloudRun](Docmost_CloudRun.md)) et
les guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

Docmost est une plateforme open source de wiki et de documentation collaborative en
temps réel (une alternative à Confluence/Notion), construite sur NestJS avec un
stockage de données Postgres et une couche de collaboration/files d'attente reposant sur Redis.

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Docmost_Common | Où cela apparaît |
|---|---|---|
| Secret cryptographique | Génère `APP_SECRET` (64 caractères hexadécimaux, 32 octets aléatoires) et le stocke dans **Secret Manager** | Injecté automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `docmost/docmost` avec un point d'entrée personnalisé ; construite via Cloud Build | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** (`POSTGRES_15`) comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit la tâche du premier déploiement (`db-init`) qui crée la base de données et l'utilisateur, et accorde les droits | Sortie `initialization_jobs` |
| Cache et collaboration | Exige **Redis** pour l'édition en temps réel et les files d'attente en arrière-plan (activé par défaut) | §Redis dans les guides de plateforme |
| Stockage de fichiers | Pilote de stockage local (`STORAGE_DRIVER = local`) écrivant sur un volume **adossé à NFS** à `/app/data/storage` | §Stockage dans les guides de plateforme |
| Stockage d'objets | Déclare un bucket de données **Cloud Storage** (suffixe `storage`) | Sortie `storage_buckets` |
| Paramètres principaux | Définit l'environnement de base de Docmost : `NODE_ENV`, pilote de stockage, limite de téléversement et `APP_URL` public | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de démarrage/de vivacité par défaut ciblant `/api/health` | §Observabilité dans les guides de plateforme |

---

## 2. Secret cryptographique dans Secret Manager {#2-cryptographic-secret-in-secret-manager}

Un unique secret applicatif est généré automatiquement et stocké dans Secret Manager —
il n'est jamais défini en clair et ne doit jamais être modifié après le premier déploiement :

- **`APP_SECRET`** — une chaîne hexadécimale de 64 caractères dérivée de 32 octets
  aléatoires (`random_id.app_secret`), conformément à la recommandation amont
  `openssl rand -hex 32`. Docmost l'utilise pour signer et chiffrer les jetons de
  session et les données sensibles stockées. Le faire tourner après le premier démarrage
  invalide toutes les sessions existantes et rend irrécupérables les données chiffrées
  avec l'ancienne valeur.

Le secret est créé dans `secrets.tf` sous le nom
`secret-<tenant-prefix>-docmost-app-secret`, exposé aux wrappers via la sortie
`secret_ids` (variable d'environnement `APP_SECRET`), et également présenté via la
sortie `secret_values` pour le chemin GKE à valeurs de secret explicites (GKE
matérialise son propre Secret Kubernetes à partir de la valeur).

Récupérez le secret après le déploiement :

```bash
# List the Docmost secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~docmost-app-secret"

# Read the secret value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret figure dans les sorties du déploiement de plateforme (`database_password_secret`).
Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Docmost exige **PostgreSQL 15** ; le moteur est fixé (`database_type = "POSTGRES_15"`)
et MySQL ou les autres moteurs ne sont pas pris en charge. Lors du premier déploiement,
une tâche ponctuelle (`db-init`) s'exécute avec `postgres:15-alpine` et, de façon idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy sous `/cloudsql` et l'associe au
   nom de socket `psql` standard (en vidant `DB_IP` pour que le socket l'emporte),
2. Choisit le mode SSL adapté au saut de connexion — `disable` pour le socket / le
   proxy en boucle locale, `require` pour un saut TCP direct sur IP privée,
3. Attend que PostgreSQL soit joignable (`pg_isready`),
4. Crée l'utilisateur applicatif (ou met à jour son mot de passe),
5. Accorde le rôle applicatif à `postgres` afin qu'il puisse être défini comme propriétaire,
6. Crée (ou reconfigure) la base de données applicative avec cet utilisateur comme propriétaire,
7. Accorde tous les privilèges sur la base de données et sur le schéma `public`,
8. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter proprement
   (`POST /quitquitquit`) afin que le Job puisse se terminer.

La tâche peut être relancée sans risque. Docmost n'a **pas** besoin d'une étape de
migration distincte — l'application exécute automatiquement ses propres migrations de
schéma à chaque démarrage (`pnpm start`), si bien que la tâche `db-init` n'a qu'à
provisionner la base de données vide et le rôle.

Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données (`docmost`) et de l'utilisateur (`docmost`)
figurent dans les sorties du déploiement de plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée (`scripts/Dockerfile`) encapsule `docmost/docmost:<version>` avec
un point d'entrée shell léger (`scripts/entrypoint.sh`) qui s'exécute avant la commande
par défaut de Docmost, `pnpm start` :

- **ARG de build propre à l'application.** Le tag de l'image de base est défini via un
  ARG de build `DOCMOST_VERSION` — un nom distinct que le socle n'injecte **pas** — afin
  que l'injection générique `APP_VERSION = "latest"` ne puisse pas écraser le tag voulu.
  `Docmost_Common` associe `application_version → DOCMOST_VERSION` (`"latest"` étant
  associé à lui-même).
- **Ajoute `bash` + `postgresql-client`.** L'image de base (`node:22-slim`, Debian)
  ne fournit ni l'un ni l'autre ; tous deux sont nécessaires pour assembler les URL de
  connexion et pour exécuter `pg_isready` avant le démarrage.
- **Assemble `DATABASE_URL`.** La plateforme injecte les éléments individuels
  (`DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_IP`, `DB_NAME`, `DB_PORT`) mais pas une
  URL prête à l'emploi. Le point d'entrée bifurque selon `DB_HOST` :
  - **Cloud Run** (répertoire de socket `/cloudsql/...`) — le pilote `postgres.js` de
    Docmost dérive l'hôte uniquement de l'autorité de l'URL et le découpe sur `:`, si bien
    que le chemin du socket Cloud SQL (qui contient des deux-points) ne peut jamais
    figurer dans l'URL. Le point d'entrée se connecte donc à l'**IP privée Cloud SQL en
    TCP** avec `sslmode=require` (Cloud SQL rejette le TCP non chiffré sur IP privée).
  - **GKE** (sidecar Auth Proxy sur `127.0.0.1`) — boucle locale en clair, `sslmode=disable`.
  - **IP privée directe** — `sslmode=require`.
- **Assemble `REDIS_URL`.** Utilise `REDIS_URL`/`REDIS_HOST` injectés par le socle
  (avec `REDIS_AUTH` facultatif), ou se rabat sur l'IP du serveur NFS (`NFS_SERVER_IP`,
  où la plateforme co-héberge Redis) afin que Docmost puisse démarrer.
- **Définit `APP_URL`.** Le socle injecte l'URL publique prévue du service via
  `service_url_env_var_name = "APP_URL"` ; le point d'entrée se rabat aussi sur
  `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL` injectés par la plateforme. Docmost
  construit les liens absolus et son point de terminaison WebSocket de collaboration à partir d'`APP_URL`.
- **Attend la base de données**, s'assure que `/app/data/storage` existe (le point de
  montage NFS), puis lance par `exec` la commande par défaut `pnpm start`.

Remarque : `PORT` n'est volontairement **pas** défini ici — c'est un nom de variable
d'environnement réservé de Cloud Run que la plateforme injecte pour correspondre à
`container_port = 3000`, et le point d'entrée de Docmost lit `${PORT:-3000}`.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Docmost_Common` établit l'environnement de base de Docmost afin que l'application
démarre correctement dès le premier lancement :

- **`NODE_ENV = "production"`.**
- **`STORAGE_DRIVER = "local"`** — les pièces jointes sont écrites sur le système de
  fichiers local à `/app/data/storage`, que les wrappers adossent au volume **NFS** afin
  que les téléversements survivent aux redémarrages et soient partagés entre les instances.
- **`FILE_UPLOAD_SIZE_LIMIT = "50mb"`.**
- **`APP_URL`** — injecté comme l'URL publique prévue du service (voir le point
  d'entrée, §4). Docmost en dérive les liens absolus et le point de terminaison de
  collaboration en temps réel.
- **`DATABASE_URL` / `REDIS_URL` / `APP_SECRET`** sont assemblés à l'exécution ou
  injectés comme secret — ils ne sont volontairement **pas** définis ici comme variables
  d'environnement en clair.

Valeurs par défaut du conteneur : `container_port = 3000`, aucune extension PostgreSQL
n'est installée (`enable_postgres_extensions = false` ; les migrations de Docmost créent
tout ce dont elles ont besoin).

---

## 6. Redis (obligatoire) {#6-redis-required}

Contrairement aux wikis centrés sur les fichiers qui conservent tout dans Postgres,
Docmost utilise **Redis** pour la coordination de l'édition collaborative en temps réel
et pour les files d'attente de tâches en arrière-plan. Redis est donc **activé par
défaut** dans les deux variantes de plateforme (`enable_redis = true`). Lorsque
`redis_host` est laissé vide, la plateforme co-héberge Redis sur la VM du serveur NFS et
injecte son IP ; le point d'entrée assemble `REDIS_URL` à partir des valeurs injectées.
Consultez les guides de plateforme pour savoir comment faire pointer Docmost vers une
instance Redis externe/gérée à la place.

---

## 7. Stockage de fichiers {#7-file-storage}

Le pilote de stockage local de Docmost écrit les pièces jointes téléversées sous
`/app/data/storage` (le `VOLUME` déclaré par l'image). Les wrappers montent le partage
**NFS** exactement à ce chemin (`nfs_mount_path = "/app/data/storage"`, `enable_nfs = true`
par défaut) afin que les pièces jointes persistent après les redémarrages et soient
visibles de toutes les instances.

`Docmost_Common` déclare en outre un bucket de données **Cloud Storage** (suffixe
`storage`) que le socle provisionne et auquel il donne accès au compte de service de la
charge de travail. Avec le pilote `local` par défaut, les pièces jointes résident sur NFS
plutôt que dans ce bucket ; le bucket est disponible si vous faites passer Docmost à un
pilote de stockage d'objets.

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

## 8. Comportement des sondes de santé {#8-health-probe-behaviour}

Les sondes de démarrage et de vivacité par défaut ciblent **`/api/health`** — le point
de terminaison de santé public et non authentifié de Docmost, qui renvoie HTTP 200 dès
que le serveur est opérationnel. La sonde de démarrage accorde un délai initial de 60
secondes plus une fenêtre de nouvelles tentatives (période 10s, seuil d'échec 6) pour
couvrir les migrations automatiques du premier démarrage ; la sonde de vivacité utilise
un délai initial de 60 secondes, une période de 30 secondes et un seuil d'échec de 3.

---

Pour la configuration propre à Docmost exposée aux utilisateurs (variables par groupe,
sorties, et comment explorer chaque service depuis la console et la CLI), consultez les
guides de plateforme : **[Docmost_GKE](Docmost_GKE.md)** et **[Docmost_CloudRun](Docmost_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Docmost sur Google Cloud Run](Docmost_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Docmost sur GKE Autopilot](Docmost_GKE.md) — cette configuration déployée sur GKE.
