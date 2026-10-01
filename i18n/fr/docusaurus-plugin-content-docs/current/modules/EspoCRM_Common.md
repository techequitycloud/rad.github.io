---
title: "EspoCRM Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module EspoCRM — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/EspoCRM_Common.md @ 3055034 sha256:497f14228c80 -->

# EspoCRM Common — Configuration applicative partagée {#espocrm-common--shared-application-configuration}

`EspoCRM_Common` est la **couche applicative partagée** d'EspoCRM. Elle n'est pas déployée
seule ; elle fournit la configuration propre à EspoCRM sur laquelle reposent à la fois
[EspoCRM_GKE](EspoCRM_GKE.md) et [EspoCRM_CloudRun](EspoCRM_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais
comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement EspoCRM, consultez les guides
de plateforme ([EspoCRM_GKE](EspoCRM_GKE.md), [EspoCRM_CloudRun](EspoCRM_CloudRun.md)) et
les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par EspoCRM_Common | Où cela apparaît |
|---|---|---|
| Secret administrateur initial | Génère un `ESPOCRM_ADMIN_PASSWORD` de 24 caractères et le stocke dans **Secret Manager** | Injecté automatiquement sous forme de variable d'environnement secrète ; récupérez-le via Secret Manager (voir ci-dessous) |
| Image de conteneur | Build personnalisé léger **FROM `espocrm/espocrm`** (Apache) encapsulé avec `cloud-entrypoint.sh` ; construit via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for MySQL 8.0** (`database_type = "MYSQL_8_0"`) comme moteur | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket de données **Cloud Storage** (suffixe de nom `espocrm-data`, c'est-à-dire `gcs-espocrm<tenant-prefix>-espocrm-data`) | Sortie `storage_buckets` |
| Paramètres principaux | Définit l'environnement de base d'EspoCRM : plateforme de base de données, nom d'utilisateur administrateur, URL du site, port `80`, cache d'objets Redis facultatif | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit les sondes par défaut de démarrage (TCP `/`) et de vivacité (HTTP `/`) | §Observabilité dans les guides de plateforme |

---

## 2. Le secret du mot de passe administrateur dans Secret Manager {#2-the-admin-password-secret-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager :

- **`ESPOCRM_ADMIN_PASSWORD`** — un mot de passe aléatoire de 24 caractères (`special = false` afin
  qu'il puisse être interpolé sans risque dans le shell et la CLI à l'intérieur du point d'entrée). Le
  `docker-entrypoint.sh` amont le lit lors de la **première installation** pour définir le mot de passe de
  l'utilisateur `admin` (`ESPOCRM_ADMIN_USERNAME`, par défaut `admin`). Il est généré une seule fois et
  écrit dans Secret Manager, de sorte qu'il reste stable d'un redémarrage de conteneur à l'autre et n'apparaît jamais
  en clair dans l'état Terraform. Le secret est nommé
  `secret-<resource_prefix>-espocrm-admin-password`.

Récupérez l'identifiant administrateur après le déploiement :

```bash
# Locate the secret (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~espocrm-admin-password"

# Read the admin password (username defaults to "admin"):
gcloud secrets versions access latest \
  --secret="secret-<resource_prefix>-espocrm-admin-password" --project "$PROJECT"
```

Le **mot de passe de la base de données** est généré et géré séparément par le socle ; le
nom de son secret est indiqué dans les sorties du déploiement de la plateforme (`database_password_secret`).
Consultez [App_Common](App_Common.md) pour le modèle partagé des secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

EspoCRM nécessite **MySQL** ; le moteur est fixé à `MYSQL_8_0`, et PostgreSQL ou les autres
moteurs ne sont pas pris en charge. Lors du premier déploiement, un job ponctuel (`db-init`) s'exécute avec
`mysql:8.0-debian` et, de manière idempotente :

1. Résout la connexion Cloud SQL — il privilégie le socket Unix de l'Auth Proxy sous
   `/cloudsql` lorsqu'il est présent, et se rabat sinon sur un hôte TCP en IP privée (`DB_IP`),
2. Attend que le port MySQL `3306` soit accessible,
3. Crée (ou met à jour) l'utilisateur de l'application propre au tenant avec le mot de passe généré
   (`CREATE USER IF NOT EXISTS … / ALTER USER …`),
4. Crée la base de données de l'application (`CREATE DATABASE IF NOT EXISTS`),
5. Accorde tous les privilèges sur cette base de données à l'utilisateur de l'application,
6. Vérifie que l'utilisateur de l'application peut se connecter (ce qui préchauffe aussi le cache d'authentification
   côté serveur `caching_sha2_password` de MySQL 8, afin que les connexions PHP suivantes empruntent le chemin rapide),
7. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter proprement (POST
   `/quitquitquit`).

Le job s'exécute lors de l'application (`execute_on_apply = true`), a `max_retries = 3` et peut être
relancé sans risque. **Il n'y a pas de job de migration distinct** — le `docker-entrypoint.sh` amont d'EspoCRM
exécute automatiquement l'action d'installation/migration au démarrage du conteneur ; le schéma est donc
créé au premier démarrage une fois que `db-init` a provisionné la base de données et l'utilisateur. Inspectez
directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

EspoCRM est déployé sous la forme d'un **build personnalisé léger FROM `espocrm/espocrm`** (l'image
officielle en variante Apache). Le Dockerfile reste en `root` (l'image amont attribue
`data`/`custom` à `www-data` au démarrage via chown) et ajoute `cloud-entrypoint.sh`, puis enchaîne
sur le `docker-entrypoint.sh apache2-foreground` amont.

- **ARG de version propre à l'application.** Le tag de base est dérivé d'un ARG de build propre à l'application,
  `ESPOCRM_VERSION` — **et non** de l'`APP_VERSION` générique que le socle injecte
  et qui l'emporte lors de la fusion. `EspoCRM_Common` fait correspondre `application_version = "latest"` à un
  tag apache figé et éprouvé (`10.0.2`), afin qu'un build ne casse jamais à cause d'un tag mouvant ou
  absent.
- **Fait correspondre `DB_*` → `ESPOCRM_DATABASE_*`.** Le socle injecte les variables propres au tenant
  `DB_HOST`, `DB_IP`, `DB_NAME`, `DB_USER`, `DB_PORT` (et `DB_PASSWORD` sous forme de secret).
  `cloud-entrypoint.sh` exporte les variables natives d'EspoCRM `ESPOCRM_DATABASE_HOST/PORT/NAME/USER/PASSWORD`
  et `ESPOCRM_DATABASE_PLATFORM = "Mysql"`. Comme la connexion PDO MySQL d'EspoCRM nécessite
  un véritable hôte TCP, lorsque `DB_HOST` est un chemin de répertoire de socket (commençant par `/`), le
  point d'entrée se rabat sur l'IP privée (`DB_IP`) pour une connexion TCP — Cloud SQL MySQL
  n'impose pas SSL sur le TCP en IP privée ; aucun câblage TLS supplémentaire n'est donc nécessaire.
- **Résout `ESPOCRM_SITE_URL`.** EspoCRM construit les liens absolus et les vérifications de son propre installateur
  à partir de `siteUrl` ; celle-ci doit donc être l'hôte accessible du service, et non `localhost`. Le
  point d'entrée privilégie une valeur explicite, puis les URL prévues par le socle
  (`APP_URL` → `CLOUDRUN_SERVICE_URL` → `GKE_SERVICE_URL`).
- **Passe la main au point d'entrée amont.** Après avoir exporté les variables `ESPOCRM_*`, il exécute
  `exec "$@"`, laissant `docker-entrypoint.sh` installer ou migrer automatiquement l'application.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`EspoCRM_Common` établit l'environnement de base d'EspoCRM afin que l'application démarre
correctement au premier lancement :

- **Plateforme de base de données** — `ESPOCRM_DATABASE_PLATFORM = "Mysql"`.
- **Amorçage de l'administrateur** — `ESPOCRM_ADMIN_USERNAME` (par défaut `admin`) ainsi que le secret
  injecté `ESPOCRM_ADMIN_PASSWORD` ; l'installateur amont crée l'utilisateur `admin` avec
  ce mot de passe lors de la première installation.
- **URL du site** — `ESPOCRM_SITE_URL` est définie à partir de l'URL de service prévue lorsqu'elle est connue,
  et résolue sinon dans le point d'entrée.
- **Port** — le conteneur écoute sur `80` (Apache) ; `container_port = 80`.
- **Cache d'objets (Redis)** — désactivé par défaut. Lorsque `enable_redis = true`, `REDIS_HOST`
  et `REDIS_PORT` sont injectés (avec l'IP du serveur NFS pour `REDIS_HOST` lorsqu'aucun hôte explicite
  n'est fourni), ce qui active le backend de cache d'objets d'EspoCRM.
- **Réglage de PHP** — `php_memory_limit` (`512M`), `upload_max_filesize` (`64M`) et
  `post_max_size` (`64M`) sont exposés pour les sites utilisant des plugins lourds ou des médias volumineux.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

EspoCRM sert sa **page de connexion sur le chemin racine non authentifié** (`GET /` → `200`) ;
les sondes ciblent donc `/` :

- **Sonde de démarrage** — `TCP` sur le port `80` par défaut (`initial_delay_seconds = 30`,
  `period_seconds = 15`, `failure_threshold = 20`), ce qui laisse au conteneur largement le temps de
  terminer l'installation/la migration du premier démarrage avant d'être considéré comme en échec.
- **Sonde de vivacité** — `HTTP GET /` avec un délai initial généreux de 300 secondes et une
  période de 60 secondes, adaptés à la lente création du schéma d'EspoCRM au premier démarrage.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket de données **Cloud Storage** dédié (suffixe de nom `espocrm-data`, c'est-à-dire
`gcs-espocrm<tenant-prefix>-espocrm-data`, `force_destroy = true`) est
déclaré ici et provisionné par le socle, qui accorde également l'accès au compte de service
de la charge de travail. Sur GKE, la plateforme monte en outre un volume **NFS** partagé sur
`/var/www/html/data` pour les pièces jointes envoyées et les données d'exécution d'EspoCRM. Listez le bucket
avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à EspoCRM destinée aux utilisateurs (variables par groupe, sorties, et comment
explorer chaque service depuis la Console et la CLI), consultez les guides de plateforme :
**[EspoCRM_GKE](EspoCRM_GKE.md)** et **[EspoCRM_CloudRun](EspoCRM_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [EspoCRM sur Google Cloud Run](EspoCRM_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [EspoCRM sur GKE Autopilot](EspoCRM_GKE.md) — cette configuration déployée sur GKE.
