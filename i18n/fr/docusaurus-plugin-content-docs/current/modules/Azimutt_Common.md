---
title: "Azimutt Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Azimutt — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Azimutt_Common.md @ 3055034 sha256:67bbb017d9eb -->

# Azimutt Common — Configuration applicative partagée {#azimutt-common--shared-application-configuration}

`Azimutt_Common` est la **couche applicative partagée** d'Azimutt. Elle n'est pas déployée
seule ; elle fournit plutôt la configuration propre à Azimutt sur laquelle reposent
[Azimutt_GKE](Azimutt_GKE.md) et [Azimutt_CloudRun](Azimutt_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais directement cette couche — elle n'a aucune entrée propre dans l'interface de déploiement — mais
comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Azimutt est un explorateur de schémas de bases de données et un outil d'ERD open source de nouvelle génération,
construit avec **Elixir/Phoenix**. L'image amont `ghcr.io/azimuttapp/azimutt` exécute
`sh -c "/app/bin/migrate && /app/bin/server"` — elle applique ses propres migrations Ecto
au démarrage puis sert le point de terminaison Phoenix sur le port **4000**. Un seul conteneur
sert l'ensemble de l'application.

Pour l'infrastructure qui provisionne et exécute réellement Azimutt, consultez les guides
de plateforme ([Azimutt_GKE](Azimutt_GKE.md), [Azimutt_CloudRun](Azimutt_CloudRun.md)) et
les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Azimutt_Common | Où cela apparaît |
|---|---|---|
| Secret cryptographique | Génère un `SECRET_KEY_BASE` Phoenix stable de 64 octets et le stocke dans **Secret Manager** | Injecté automatiquement comme variable d'environnement secrète ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Enveloppe l'image officielle `ghcr.io/azimuttapp/azimutt` avec un point d'entrée cloud léger ; construite via Cloud Build et mise en miroir dans Artifact Registry | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** (`POSTGRES_15`) comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit la tâche de premier déploiement (`db-init`) qui crée le rôle, la base de données et les droits | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare un bucket **Cloud Storage** (suffixe `storage`) | Sortie `storage_buckets` |
| Paramètres principaux | Définit l'environnement de base d'Azimutt : `PHX_SERVER`, `FILE_STORAGE_ADAPTER`, port fixe 4000 | Comportement de l'application dans les guides de plateforme |
| Câblage de la base de données à l'exécution | Le point d'entrée cloud compose `DATABASE_URL`, `DATABASE_ENABLE_SSL` et `PHX_HOST` au démarrage du conteneur | §Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de disponibilité par défaut ciblant `/` | §Observabilité dans les guides de plateforme |

---

## 2. Secret cryptographique dans Secret Manager {#2-cryptographic-secret-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est jamais défini
en clair :

- **`SECRET_KEY_BASE`** — une chaîne aléatoire de 64 caractères (Phoenix exige au moins 64
  octets d'entropie). Azimutt l'utilise pour signer et chiffrer les cookies de session. Il est
  généré une seule fois et stocké dans le secret
  `secret-<resource-prefix>-<app>-secret-key-base`, si bien qu'il reste stable lors des
  redémarrages de conteneurs et des redéploiements. **Le renouveler après le premier démarrage invalide tous
  les cookies de session actifs** — tous les utilisateurs connectés sont déconnectés et doivent se reconnecter.

Récupérez le secret après le déploiement :

```bash
# List the Azimutt secret (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"

# Read the secret value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le nom
de son secret figure dans les sorties du déploiement de plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets
et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Azimutt exige **PostgreSQL 15** ; le moteur est fixe (`database_type = POSTGRES_15`)
et MySQL ou d'autres moteurs ne sont pas pris en charge. Lors du premier déploiement, une tâche ponctuelle
(`db-init`) s'exécute avec `postgres:15-alpine` et, de manière idempotente :

1. Attend que PostgreSQL soit joignable (boucle de nouvelles tentatives `psql`),
2. Crée le rôle applicatif avec `LOGIN CREATEDB` (ou le modifie via `ALTER`) avec le
   mot de passe généré,
3. Crée la base de données applicative si elle n'existe pas (détenue par `postgres`, car
   le compte `postgres` de Cloud SQL ne peut pas faire `SET ROLE` vers les rôles applicatifs),
4. Accorde `ALL PRIVILEGES` sur la base de données, accorde `ALL ON SCHEMA public`, et
   `ALTER SCHEMA public OWNER` au rôle applicatif — nécessaire car Azimutt
   exécute ses propres migrations Ecto au démarrage sous ce rôle et Postgres 15 n'accorde plus
   `CREATE` sur `public` par défaut,
5. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter (`/quitquitquit`) afin que le pod
   de la tâche (Job) GKE se termine.

La tâche **ne provisionne que le rôle, la base de données et les droits** — Azimutt exécute lui-même les
migrations de schéma (`/app/bin/migrate`) à chaque démarrage du conteneur. La tâche peut être
réexécutée sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de plateforme.

---

## 4. Image de conteneur et point d'entrée cloud {#4-container-image-and-cloud-entrypoint}

L'image personnalisée est une **enveloppe légère FROM `ghcr.io/azimuttapp/azimutt:<version>`**.
Comme il s'agit d'une image amont préconstruite, `enable_image_mirroring = true` la met en miroir
dans Artifact Registry, et un Cloud Build produit l'image enveloppée. Le Dockerfile
utilise un ARG de build propre à l'application (`AZIMUTT_VERSION`) plutôt que l'ARG générique
`APP_VERSION` — le socle injecte `APP_VERSION` dans `build_args` et écraserait
sinon le tag de base. `application_version = "latest"` est mappé sur le tag mobile
**`main`** d'Azimutt (Azimutt ne publie aucun tag `:latest`).

Le script `cloud-entrypoint.sh` s'exécute avant la commande propre d'Azimutt et :

- **Compose `DATABASE_URL`** à partir des variables `DB_*` injectées par le socle. Azimutt
  lit une unique `DATABASE_URL` (Ecto/postgrex) et son mot de passe est un secret d'exécution
  qui ne peut pas être interpolé dans une URL au moment du plan ; l'URL est donc construite au
  démarrage du conteneur (le mot de passe est encodé pour URL en sh POSIX pur).
- **Choisit le chemin de connexion selon `DB_HOST`.** Ecto/postgrex ne sait pas analyser le DSN
  de socket Unix de Cloud SQL ; Azimutt se connecte donc toujours en **TCP** :
  - `DB_HOST` vaut `127.0.0.1`/`localhost` → l'interface loopback du sidecar Cloud SQL Auth Proxy
    sur GKE, `DATABASE_ENABLE_SSL=false` (le proxy termine le TLS).
  - sinon (Cloud Run) → l'IP privée de l'instance (`DB_IP`) avec
    `DATABASE_ENABLE_SSL=true` (Cloud SQL rejette le TCP non chiffré sur IP privée).
- **Dérive `PHX_HOST`** en retirant le schéma et le chemin de l'URL du service
  injectée (`CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`) — Phoenix a besoin d'un hôte nu.
- **Définit `PORT=4000` par défaut** (sur Cloud Run, `PORT` est injecté automatiquement ; sur GKE, il ne l'est pas),
  définit `PHX_SERVER=true`, puis **passe la main à la commande propre de l'image
  `/app/bin/migrate && /app/bin/server`** (les migrations Ecto s'exécutent en premier).

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Azimutt_Common` établit l'environnement de base d'Azimutt afin que l'application
démarre correctement dès le premier démarrage :

- **`PHX_SERVER = "true"`** — démarre le serveur HTTP Phoenix (l'image le définit par défaut
  à `false`).
- **`FILE_STORAGE_ADAPTER`** — vaut `"local"` par défaut. Il s'agit d'une variable strictement
  obligatoire (`fetch_env!`) dans le `runtime.exs` d'Azimutt ; `"local"` écrit les téléversements sur le
  disque local du conteneur et évite l'exigence de `S3_BUCKET`. Les données de projet
  d'Azimutt (schémas, diagrammes, dispositions) résident dans **PostgreSQL**, et non dans le stockage de fichiers.
- **Port fixe 4000** — le point de terminaison Phoenix d'Azimutt écoute sur `PORT` (4000) ; il ne peut
  pas être modifié via `environment_variables` (`PORT` est réservé sur Cloud Run).
- **`SECRET_KEY_BASE`** est injecté depuis Secret Manager comme variable d'environnement secrète.

Comportement propre à la plateforme géré par le point d'entrée à l'exécution : `DATABASE_URL`,
`DATABASE_ENABLE_SSL` et `PHX_HOST` sont tous composés à partir des variables `DB_*` et
d'URL de service injectées (voir §4).

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Azimutt n'expose pas de point de terminaison de santé dédié ; les sondes par défaut ciblent donc le
chemin racine Phoenix `/`, qui renvoie 200 une fois que le serveur a démarré et s'est connecté à
PostgreSQL. Une fenêtre de démarrage généreuse tient compte des migrations Ecto qui s'exécutent au
premier démarrage :

- La **sonde de disponibilité** de Common est HTTP `GET /` avec un délai initial de 30 secondes.
- La **sonde de démarrage** par défaut des variantes est HTTP `GET /` avec un délai initial de 60 secondes
  (Azimutt démarre lentement car les migrations s'exécutent avant que le point de terminaison ne se lie au port).

Les entrées `startup_probe` / `liveness_probe` de chaque variante peuvent les remplacer.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket **Cloud Storage** dédié (suffixe de nom `storage`, `STANDARD`,
`public_access_prevention = enforced`) est déclaré ici et provisionné par le
socle, qui accorde également l'accès au compte de service de la charge de travail. Notez qu'avec la
valeur par défaut `FILE_STORAGE_ADAPTER = "local"`, Azimutt écrit les téléversements sur le disque local
du conteneur plutôt que dans ce bucket ; le bucket est provisionné pour les opérateurs qui
basculent Azimutt vers un adaptateur de fichiers compatible S3. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

Sur **GKE**, la variante active en outre NFS (`enable_nfs = true`) afin que le stockage des pièces jointes
d'Azimutt survive aux redémarrages des pods — consultez [Azimutt_GKE](Azimutt_GKE.md).

---

Pour la configuration propre à Azimutt destinée aux utilisateurs (variables par groupe, sorties, et
comment explorer chaque service depuis la console et la CLI), consultez les guides de plateforme :
**[Azimutt_GKE](Azimutt_GKE.md)** et **[Azimutt_CloudRun](Azimutt_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Azimutt sur Google Cloud Run](Azimutt_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Azimutt sur GKE Autopilot](Azimutt_GKE.md) — cette configuration déployée sur GKE.
