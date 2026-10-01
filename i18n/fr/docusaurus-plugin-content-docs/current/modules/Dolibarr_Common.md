---
title: "Dolibarr Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Dolibarr — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Dolibarr_Common.md @ 3055034 sha256:9f166d24f26b -->

# Dolibarr Common — Configuration applicative partagée {#dolibarr-common--shared-application-configuration}

`Dolibarr_Common` est la **couche applicative partagée** de Dolibarr. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Dolibarr sur laquelle
s'appuient à la fois [Dolibarr_GKE](Dolibarr_GKE.md) et
[Dolibarr_CloudRun](Dolibarr_CloudRun.md), afin que les deux variantes de plateforme
se comportent de façon identique là où cela compte. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs
par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Dolibarr, consultez les
guides de plateforme ([Dolibarr_GKE](Dolibarr_GKE.md),
[Dolibarr_CloudRun](Dolibarr_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Dolibarr_Common | Où cela apparaît |
|---|---|---|
| Identifiants administrateur | Génère le mot de passe administrateur initial (`DOLI_ADMIN_PASSWORD`, 24 caractères) et un sel propre à l'instance (`DOLI_INSTANCE_UNIQUE_ID`, 16 octets en hexadécimal), et les stocke tous deux dans **Secret Manager** | Injectés comme variables d'environnement secrètes du conteneur SERVICE ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Build personnalisé léger de l'image officielle `dolibarr/dolibarr` (php:apache) avec un entrypoint wrapper ; construit via Cloud Build | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Fixe **Cloud SQL for MySQL 8.0** (`MYSQL_8_0`) comme moteur | §Base de données dans les guides de plateforme |
| Amorçage de la base | Définit le job du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Stockage objet | Déclare le bucket de documents **Cloud Storage** (`dolibarr-documents`) | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement Dolibarr de référence : pilote de base de données, installation automatique, mode production, identifiant administrateur, URL racine | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de démarrage TCP et la sonde de vivacité HTTP par défaut ciblant `/` (la page de connexion) | §Observabilité dans les guides de plateforme |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager — ils ne sont
jamais définis en clair :

- **`DOLI_ADMIN_PASSWORD`** — un mot de passe de 24 caractères (caractères spéciaux
  désactivés pour pouvoir le copier-coller sans risque lors de la connexion de
  l'opérateur), stocké sous `secret-<prefix>-<app>-admin-password`. C'est le mot de
  passe du compte administrateur initial dont le nom d'utilisateur est
  `DOLI_ADMIN_LOGIN` (`admin` par défaut). L'installateur Dolibarr l'utilise au premier
  démarrage lorsqu'il crée le compte super-administrateur ; le modifier dans Secret
  Manager après la création du compte ne change **pas** rétroactivement le mot de passe
  du compte (cela doit se faire dans Dolibarr).
- **`DOLI_INSTANCE_UNIQUE_ID`** — une chaîne hexadécimale de 16 octets stockée sous
  `secret-<prefix>-<app>-instance-id`, utilisée comme sel de sécurité propre à
  l'instance (par exemple pour les URL cron et la signature des jetons). Gardez-la
  stable pendant toute la durée de vie du déploiement.

Les deux sont injectés directement comme variables d'environnement secrètes du
conteneur SERVICE, sous les noms exacts ci-dessus (via la sortie `secret_ids` du
module) ; le `docker-run.sh` de Dolibarr les lit tels quels. Le mot de passe de la base
de données est généré et géré séparément par le socle ; le nom de son secret figure
dans les sorties du déploiement de plateforme (`database_password_secret`).

Récupérez les secrets après le déploiement :

```bash
# List Dolibarr secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~admin-password OR name~instance-id"

# Read the generated admin password (use with the DOLI_ADMIN_LOGIN username):
gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
```

Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload
Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Dolibarr s'exécute sur **Cloud SQL for MySQL 8.0** (`MYSQL_8_0`) ; le moteur est fixé
par cette couche. Lors du premier déploiement, un job ponctuel (`db-init`) s'exécute
avec `mysql:8.0-debian` et, de manière idempotente :

1. Localise la connexion Cloud SQL — un socket Unix sous `/cloudsql` lorsque le
   volume/sidecar Auth Proxy est monté, sinon TCP via l'IP privée de l'instance
   (`DB_IP`),
2. Attend que MySQL soit joignable sur le port 3306,
3. Crée (ou réaligne) l'utilisateur applicatif avec le mot de passe généré
   (`CREATE USER IF NOT EXISTS … ; ALTER USER …`),
4. Crée la base de données applicative (`CREATE DATABASE IF NOT EXISTS`),
5. Accorde tous les privilèges sur cette base à l'utilisateur applicatif,
6. Vérifie que l'utilisateur applicatif peut se connecter (ce qui préchauffe aussi le
   cache côté serveur de `caching_sha2_password`), puis signale au sidecar Cloud SQL
   Auth Proxy de s'arrêter proprement.

Le job peut être relancé sans risque (`execute_on_apply = true`, `max_retries = 3`). Il
n'y a **pas de job de migration distinct** : comme `DOLI_INSTALL_AUTO = 1`, l'image
Dolibarr exécute son propre installateur au premier démarrage du conteneur et crée le
schéma dans la base (vide) provisionnée par `db-init`. Inspectez directement la base
avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est un build léger : `FROM dolibarr/dolibarr:<DOLIBARR_VERSION>`
(l'image officielle PHP/Apache) plus un entrypoint wrapper
(`dolibarr-entrypoint.sh`) qui s'exécute avant le `docker-run.sh` de l'image de base.

- **Mappe `DB_*` vers `DOLI_DB_*`** — la plateforme injecte les variables standard,
  propres au locataire, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` ;
  Dolibarr lit plutôt `DOLI_DB_HOST`, `DOLI_DB_HOST_PORT`, `DOLI_DB_NAME`,
  `DOLI_DB_USER`, `DOLI_DB_PASSWORD`. L'entrypoint reporte les valeurs injectées sur
  les noms `DOLI_DB_*` à l'exécution.
- **Privilégie les valeurs `DB_*` injectées par rapport aux valeurs par défaut figées
  dans l'image au build.** L'image officielle fige `DOLI_DB_HOST=mysql` /
  `DOLI_DB_NAME=dolidb`, qui sont donc déjà non vides à l'exécution. L'entrypoint
  applique la précédence `${DB_HOST:-${DOLI_DB_HOST}}` afin que l'hôte Cloud SQL réel
  de la plateforme l'emporte — sinon Dolibarr attendrait indéfiniment un hôte nommé
  `mysql` et la sonde de démarrage ne réussirait jamais.
- **Passe la main à l'image de base** — `exec docker-run.sh "$@"` exécute
  l'installation/la mise à niveau automatique de Dolibarr (`DOLI_INSTALL_AUTO = 1`),
  puis démarre Apache (`apache2-foreground`) sur le port 80.

Le tag de base est contrôlé par un ARG de build **propre à l'application**,
`DOLIBARR_VERSION` (et non par l'`APP_VERSION` générique que le socle injecte et qui
l'écraserait sinon) ; `application_version = "latest"` est mappé sur un tag épinglé
éprouvé (`23.0.3`) au moment du build.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Dolibarr_Common` établit l'environnement de référence afin que l'application
s'installe et démarre correctement dès le premier lancement :

- **`DOLI_DB_TYPE = "mysqli"`** — le pilote MySQL qu'utilise Dolibarr.
- **`DOLI_INSTALL_AUTO = "1"`** — exécute automatiquement l'installateur au premier
  démarrage, en créant le schéma dans la base provisionnée par `db-init`.
- **`DOLI_INIT_DEMO = "0"`** — ne charge pas les données de démonstration.
- **`DOLI_PROD = "1"`** — mode production (erreurs détaillées désactivées).
- **`DOLI_ADMIN_LOGIN`** — nom d'utilisateur du super-administrateur initial (`admin`
  par défaut) ; le mot de passe correspondant est le secret généré
  `DOLI_ADMIN_PASSWORD`.
- **`DOLI_URL_ROOT`** — l'URL publique du service, utilisée pour construire les liens
  absolus et la redirection de connexion. Sur Cloud Run, la variante transmet l'URL
  `run.app` prévue ; sur GKE, elle reste non définie tant que l'adresse du
  LoadBalancer externe n'est pas connue (définissez-la ensuite via
  `environment_variables`).

Valeurs par défaut du conteneur définies ici : `container_port = 80`,
`database_type = MYSQL_8_0`, `cloudsql_volume_mount_path = /cloudsql`, ainsi que les
limites de ressources et les nombres d'instances transmis par la variante.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Dolibarr sert sa page de connexion sur `/` (HTTP 200, sans authentification) — il n'y
a pas de point de terminaison `/health` dédié, donc `/` fait office de chemin de santé.

- **Sonde de démarrage** — **TCP** sur le port du conteneur (80), avec un délai
  initial de 30 secondes et une fenêtre de 20 tentatives, de sorte que la sonde a
  seulement besoin que l'écouteur Apache soit lié, indépendamment de l'avancement de
  l'installateur du premier démarrage.
- **Sonde de vivacité** — **HTTP** `GET /` avec un délai initial de 300 secondes, qui
  ne redémarre le conteneur que si la page de connexion cesse de répondre. Ce délai
  initial généreux laisse le temps à l'installation automatique du premier démarrage.

---

## 7. Stockage objet et persistance des fichiers {#7-object-storage-and-file-persistence}

- Un bucket **Cloud Storage** dédié est déclaré ici avec le suffixe de nom
  `dolibarr-documents` et provisionné par le socle, qui accorde également l'accès au
  compte de service de la charge de travail.
- Les documents téléversés, les PDF générés et les données d'exécution de Dolibarr
  résident sous `/var/lib/dolibarr` ; les variantes de plateforme adossent ce chemin à
  **NFS (Cloud Filestore)** afin que les données survivent aux redémarrages du
  conteneur et soient partagées entre les instances.

Listez le bucket avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~dolibarr-documents"
```

---

Pour la configuration propre à Dolibarr destinée aux utilisateurs (variables par
groupe, sorties et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides de plateforme : **[Dolibarr_GKE](Dolibarr_GKE.md)** et
**[Dolibarr_CloudRun](Dolibarr_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Dolibarr sur Google Cloud Run](Dolibarr_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Dolibarr sur GKE Autopilot](Dolibarr_GKE.md) — cette configuration déployée sur GKE.
