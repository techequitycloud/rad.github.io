---
title: "Focalboard Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Focalboard — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Focalboard_Common.md @ 3055034 sha256:39ce93abf58c -->

# Focalboard Common — Configuration applicative partagée {#focalboard-common--shared-application-configuration}

`Focalboard_Common` est la **couche applicative partagée** de Focalboard. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Focalboard sur laquelle
s'appuient à la fois [Focalboard_GKE](Focalboard_GKE.md) et [Focalboard_CloudRun](Focalboard_CloudRun.md),
afin que les deux variantes de plateforme se comportent de façon identique là où cela
compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle
n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Focalboard, consultez les
guides de plateforme ([Focalboard_GKE](Focalboard_GKE.md), [Focalboard_CloudRun](Focalboard_CloudRun.md))
et les guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

Focalboard (`mattermost/focalboard`) est un serveur auto-hébergé de tableaux Kanban et de
projets — un backend Go qui sert un frontend React compilé. Il s'appuie sur une base de
données (ici PostgreSQL) et stocke les pièces jointes téléversées dans les tableaux sur
un chemin du système de fichiers local (`filespath`). Focalboard lit sa configuration
dans un fichier `config.json` au démarrage — il n'existe **aucune substitution par
variable d'environnement** pour la connexion à la base de données — si bien que cette
couche fournit un point d'entrée personnalisé qui génère `config.json` à partir des
variables `DB_*` injectées par le socle à chaque démarrage. Aucun DSN secret n'est
jamais figé dans l'image.

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Focalboard_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Encapsulation légère `FROM mattermost/focalboard` avec un point d'entrée personnalisé qui génère `config.json` ; construite via Cloud Build (Kaniko) et mise en miroir dans Artifact Registry | Sortie `container_image` du déploiement de plateforme |
| Secret applicatif | Génère un mot de passe administrateur (`FOCALBOARD_ADMIN_PASSWORD`, 24 caractères) dans **Secret Manager** et l'injecte en tant que variable d'environnement secrète du SERVICE | Sortie `secret_ids` ; à récupérer via Secret Manager (voir ci-dessous) |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** (`database_type = POSTGRES_15`) comme moteur | §Base de données dans les guides de plateforme |
| Initialisation de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données et le rôle, et accorde les droits (idempotent) | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare un bucket **Cloud Storage** (suffixe `storage`) pour les pièces jointes des tableaux | Sortie `storage_buckets` |
| Persistance des pièces jointes | Définit `FOCALBOARD_FILESPATH = /data` et y monte le bucket de stockage via gcsfuse (Cloud Run / GKE sans PVC) ou un PVC en mode bloc (GKE) | §Persistance dans les guides de plateforme |
| Paramètres de base | Génère `config.json` : `dbtype = postgres`, port `8000`, `authMode = native`, télémétrie désactivée, tableaux partagés publics activés | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit les sondes de démarrage, de vivacité et de disponibilité (readiness) par défaut ciblant `/` | §Observabilité dans les guides de plateforme |

---

## 2. Secret applicatif dans Secret Manager {#2-app-secret-in-secret-manager}

Un unique secret applicatif est généré automatiquement et stocké dans Secret Manager :

- **`FOCALBOARD_ADMIN_PASSWORD`** — une chaîne alphanumérique aléatoire de 24
  caractères (`special = false`). Provisionné sous le nom
  `secret-<resource_prefix>-focalboard-admin-password` et injecté dans le conteneur en
  tant que variable d'environnement secrète `FOCALBOARD_ADMIN_PASSWORD` du SERVICE, sur
  le modèle des identifiants utilisé par les autres modules Application. Focalboard
  s'exécute en **mode d'authentification natif** ; le premier compte enregistré via
  l'interface web devient donc le propriétaire de l'espace de travail — ce secret est
  disponible pour les opérateurs qui scriptent un compte initial ou une étape
  d'amorçage, mais Focalboard ne l'utilise pas pour créer automatiquement un
  administrateur.

Récupérez le secret après le déploiement :

```bash
# List the secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~focalboard-admin-password"

# Read the secret value:
gcloud secrets versions access latest \
  --secret="secret-<resource_prefix>-focalboard-admin-password" --project "$PROJECT"
```

**Le mot de passe de la base de données n'est PAS le `database_password_secret` commun
à toute la flotte.** Le mot de passe de base de données partagé standard du socle
utilisait autrefois le jeu de caractères `override_special = "_%@"`, qui peut contenir
un `%` littéral faisant planter le pilote postgres Go de Focalboard : sa validation de
DSN basée sur `url.Parse` et son connecteur `lib/pq` effectif ne s'accordent pas sur le
décodage ou non de `%` en tant qu'encodage pourcent, si bien qu'aucun encodage unique de
ce mot de passe ne satisfait les deux. Depuis le 2026-08-13, les générateurs partagés
utilisent `override_special = "_@"`, de sorte que le mot de passe commun à la flotte ne
contient plus de `%`. `Focalboard_Common` conserve néanmoins, par défense en profondeur,
son **second mot de passe dédié, uniquement alphanumérique** —
`secret-<resource_prefix>-focalboard-safe-db-password` — et remplace par celui-ci le
`DB_PASSWORD` du SERVICE principal via la sortie `secret_ids` ; le job `db-init` reçoit
le même secret sous sa propre variable d'environnement, `FOCALBOARD_SAFE_DB_PASSWORD`,
et l'utilise (et non `DB_PASSWORD`) pour définir le mot de passe réel du rôle Postgres.
La sortie `database_password_secret` de la plateforme indique toujours le nom du secret
commun à la flotte, mais ce secret ne permet **pas** de s'authentifier auprès du rôle
Postgres de Focalboard — récupérez plutôt
`secret-<resource_prefix>-focalboard-safe-db-password` lorsque vous avez besoin de
l'identifiant réel de la base de données. Consultez [App_Common](App_Common.md) pour le
modèle partagé de secrets et de Workload Identity. (Correctif vérifié, testé en
conditions réelles le 2026-07-14.)

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Focalboard utilise **PostgreSQL 15** ; le moteur est fixe (`database_type = POSTGRES_15`).
Lors du premier déploiement, un job ponctuel (`db-init`) s'exécute avec
`postgres:15-alpine` et, de manière idempotente :

1. Résout l'hôte Cloud SQL — un répertoire de socket Unix sur Cloud Run ou `127.0.0.1`
   (sidecar Auth Proxy) sur GKE, en se rabattant sur l'IP privée (`DB_IP`) si nécessaire,
2. Attend que PostgreSQL soit joignable,
3. Crée (ou met à jour) le rôle applicatif avec `LOGIN CREATEDB` et le mot de passe
   issu de `FOCALBOARD_SAFE_DB_PASSWORD` — un secret dédié, uniquement alphanumérique
   (`secret-<resource_prefix>-focalboard-safe-db-password`), distinct du
   `DB_PASSWORD`/`database_password_secret` standard commun à la flotte ; consultez la
   [section 2](#2-app-secret-in-secret-manager) pour en connaître la raison,
4. Crée la base de données de l'application si elle n'existe pas (propriété de
   `postgres`, car le `postgres` de Cloud SQL ne peut pas faire `SET ROLE` vers le rôle
   applicatif),
5. Accorde tous les privilèges sur la base de données et le schéma `public`, et
   transfère la propriété du schéma `public` au rôle applicatif afin que Focalboard
   puisse exécuter ses migrations,
6. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter (`--quitquitquit`) afin que le
   pod du Job GKE puisse se terminer.

**Aucune extension Postgres n'est installée** (`enable_postgres_extensions = false`) —
Focalboard n'en a besoin d'aucune. Focalboard applique ses **propres migrations de
schéma à chaque démarrage** en tant qu'utilisateur applicatif ; la mise à niveau de la
version ne nécessite donc aucune étape de migration distincte. Le job peut être
relancé sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est une encapsulation légère `FROM mattermost/focalboard:<version>`,
construite via Cloud Build (Kaniko) et mise en miroir dans Artifact Registry
(`enable_image_mirroring = true`, `image_source = "custom"`). Le Dockerfile :

- Copie `entrypoint.sh` vers `/usr/local/bin/cloud-entrypoint.sh` et le définit comme
  `ENTRYPOINT`, avec le binaire du serveur Focalboard comme `CMD`
  (`/opt/focalboard/bin/focalboard-server`),
- Crée à l'avance `/data` (`chmod 0777`) comme répertoire persistant des pièces jointes,
  afin qu'un montage neuf soit accessible en écriture par le serveur,
- Expose le port **8000**.

Le tag de l'image de base est figé via un **ARG de build propre à l'application**,
`FOCALBOARD_VERSION` (par défaut `7.11.4`), et délibérément *pas* via l'`APP_VERSION`
générique qu'injecte le socle — le socle définit `APP_VERSION = application_version` (qui
peut valoir `latest`, et `mattermost/focalboard:latest` n'est pas un tag publié).
Lorsque `application_version = "latest"`, le build le fait correspondre au tag figé
`7.11.4`.

Le point d'entrée (`cloud-entrypoint.sh`, `sh` POSIX) s'exécute avant le démarrage du
serveur et :

- **Construit le DSN PostgreSQL à partir des variables `DB_*` du socle** sous forme de
  chaîne à mots-clés lib/pq (`user=… password=… dbname=… host=… sslmode=…`), qui accepte
  tel quel un hôte de type répertoire de socket. Il choisit selon l'hôte *résolu* : un
  hôte de bouclage (`127.0.0.1`/`localhost`, l'Auth Proxy de GKE) utilise
  `sslmode=disable` ; une véritable IP privée (Cloud Run via le VPC) utilise
  `sslmode=require`. Sur Cloud Run, il privilégie `DB_IP` au répertoire de socket, car
  le socket n'apparaît pas toujours.
- **Génère `/opt/focalboard/config.json`** avec `dbtype = postgres`, `port = 8000`,
  `filesdriver = local`, `filespath = $FOCALBOARD_FILESPATH` (par défaut `/data`),
  `authMode = native`, `enablePublicSharedBoards = true`, `enableLocalMode = false`,
  `telemetry = false`, et un `serverRoot` dérivé de `CLOUDRUN_SERVICE_URL` /
  `GKE_SERVICE_URL` lorsqu'elles sont présentes.
- **Exécute le serveur Focalboard** en tant que PID 1 ; celui-ci exécute ses migrations
  de schéma sur le DSN et sert l'interface web + l'API sur le port 8000.

---

## 5. Persistance des pièces jointes et stockage d'objets {#5-attachment-persistence-and-object-storage}

Focalboard stocke les pièces jointes téléversées dans les tableaux sur un chemin du
système de fichiers local (`filespath`), fixé ici à `/data` via `FOCALBOARD_FILESPATH`.
Ce chemin s'appuie sur un stockage différent selon la plateforme :

- **Cloud Run (et GKE sans PVC en mode bloc)** — un bucket **Cloud Storage** (déclaré
  ici avec le suffixe `storage`) est monté sur `/data` via gcsfuse
  (`enable_gcs_storage_volume = true`), afin que les pièces jointes survivent aux
  redémarrages d'instances.
- **GKE avec `stateful_pvc_enabled = true`** (la valeur par défaut sur GKE) — un
  véritable **PVC en mode bloc** occupe `/data` à la place, et l'appelant définit
  `enable_gcs_storage_volume = false` afin que le volume gcsfuse soit ignoré. Cela évite
  un double montage sur le même chemin ; gcsfuse corromprait les fichiers d'index et de
  médias qu'écrit Focalboard.

Listez le bucket avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage, de vivacité et de disponibilité par défaut ciblent le chemin
racine `/` — l'interface web de Focalboard, qui renvoie 200 dès que le serveur s'est lié
à son port et a terminé les migrations du premier démarrage. La sonde de démarrage
accorde une fenêtre généreuse (délai initial de 60 secondes, période de 15 secondes, 30
échecs) pour laisser le temps aux migrations de schéma qui s'exécutent au premier
démarrage sur une instance Cloud SQL fraîchement provisionnée.

---

Pour la configuration propre à Focalboard et visible par l'utilisateur (variables par
groupe, sorties, et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides de plateforme :
**[Focalboard_GKE](Focalboard_GKE.md)** et **[Focalboard_CloudRun](Focalboard_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Focalboard sur Google Cloud Run](Focalboard_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Focalboard sur GKE Autopilot](Focalboard_GKE.md) — cette configuration déployée sur GKE.
