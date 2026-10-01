---
title: "FreeScout Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module FreeScout — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/FreeScout_Common.md @ 3055034 sha256:bea4f7beabb2 -->

# FreeScout Common — Configuration applicative partagée {#freescout-common--shared-application-configuration}

`FreeScout_Common` est la **couche applicative partagée** de FreeScout. Elle n'est pas
déployée seule ; elle fournit la configuration propre à FreeScout sur laquelle
s'appuient à la fois [FreeScout_GKE](FreeScout_GKE.md) et [FreeScout_CloudRun](FreeScout_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où cela
compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle
ne possède aucune entrée propre dans l'interface de déploiement — mais comprendre ce
qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation
des plateformes.

FreeScout est une plateforme gratuite et auto-hébergée de **helpdesk et de boîte aux
lettres partagée** construite sur Laravel (PHP). Elle transforme une ou plusieurs
boîtes de réception partagées en une file de tickets collaborative avec conversations,
notes, tags, réponses enregistrées, profil client, API REST et système de
modules/plugins.

Pour l'infrastructure qui provisionne et exécute réellement FreeScout, consultez les
guides de plateforme ([FreeScout_GKE](FreeScout_GKE.md), [FreeScout_CloudRun](FreeScout_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par FreeScout_Common | Où cela apparaît |
|---|---|---|
| Secret cryptographique | Génère l'`APP_KEY` Laravel (`base64:` + 32 octets aléatoires) et le stocke dans **Secret Manager** | Injecté automatiquement comme variable d'environnement `APP_KEY` du conteneur ; récupérable via Secret Manager (voir ci-dessous) |
| Mot de passe de l'administrateur initial | Génère un `ADMIN_PASS` alphanumérique de 24 caractères et le stocke dans **Secret Manager** | Injecté comme variable d'environnement `ADMIN_PASS` du conteneur ; crée le premier administrateur au premier démarrage |
| Image de conteneur | Construit une **image personnalisée légère** `FROM tiredofit/freescout` (tag de base `php8.3-1.17.159` lorsque `application_version = latest`) avec un point d'entrée cloud ; construite via Cloud Build | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Fixe **Cloud SQL for MySQL 8.0** (`MYSQL_8_0`) comme moteur | Section Base de données des guides de plateforme |
| Initialisation de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare un bucket de téléversements **Cloud Storage** (suffixe de nom `freescout-uploads`, c'est-à-dire `gcs-freescout<tenant-prefix>-freescout-uploads`) | Sortie `storage_buckets` |
| Paramètres essentiels | Définit l'environnement FreeScout de base : pilote MySQL, port de la base, identité de l'administrateur initial, `APP_URL`/`SITE_URL`, limites PHP | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de démarrage TCP et la sonde de vivacité HTTP `GET /` par défaut | Section Observabilité des guides de plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager — ils ne sont
jamais définis en clair et sont nommés `secret-<resource-prefix>-<app>-app-key` et
`secret-<resource-prefix>-<app>-admin-password` :

- **`APP_KEY`** — la clé d'application Laravel, stockée sous la forme `base64:` suivi
  de l'encodage base64 de 32 octets aléatoires (exactement ce qu'attend le chiffrement
  AES-256-CBC de Laravel). FreeScout l'utilise pour chiffrer les données de
  session/cookies et toutes les colonnes chiffrées de la base (par exemple les
  identifiants de boîtes aux lettres stockés et les jetons OAuth).
  **La renouveler après le premier démarrage invalide définitivement toutes les données
  chiffrées auparavant** — considérez-la comme immuable.
- **`ADMIN_PASS`** — un mot de passe alphanumérique de 24 caractères, attribué au
  premier compte administrateur (`ADMIN_EMAIL`) par le conteneur au premier démarrage.
  Il est alphanumérique à dessein, pour éviter les problèmes d'échappement shell/URL
  lors de l'initialisation du conteneur. Après la première connexion, modifiez-le dans
  l'interface de FreeScout.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~app-key OR name~admin-password"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret figure dans les sorties du déploiement de plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle de
secrets partagés et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

FreeScout exige **MySQL** ; le moteur est fixé à `MYSQL_8_0` et PostgreSQL ou les
autres moteurs ne sont pas pris en charge. Lors du premier déploiement, un job
ponctuel (`db-init`) s'exécute avec `mysql:8.0-debian` et, de manière idempotente :

1. Privilégie le socket Unix du Cloud SQL Auth Proxy sous `/cloudsql` lorsqu'il est
   monté, et se replie sinon sur une connexion TCP via l'IP privée injectée (`DB_IP`),
2. Attend que MySQL soit joignable sur le port 3306,
3. Crée (ou met à jour) l'utilisateur applicatif avec le mot de passe généré
   (`CREATE USER IF NOT EXISTS` / `ALTER USER`),
4. Crée la base de données applicative (`CREATE DATABASE IF NOT EXISTS`),
5. Accorde tous les privilèges sur cette base à l'utilisateur applicatif,
6. Vérifie que l'utilisateur applicatif peut effectivement se connecter (ce qui détecte
   tôt les problèmes de mot de passe ou de droits et préchauffe le cache
   d'authentification `caching_sha2_password` de MySQL 8),
7. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter proprement (via
   `quitquitquit`) afin que le Job se termine correctement.

Il n'y a **pas de job de migration distinct** : l'image FreeScout de tiredofit exécute
automatiquement `php artisan migrate --force` au démarrage du conteneur, de sorte que
le schéma est créé et mis à niveau au premier démarrage, une fois que `db-init` a
provisionné la base de données et l'utilisateur. Le job peut être relancé sans risque.
Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est une enveloppe légère `FROM tiredofit/freescout:<tag>` (l'image
tiredofit embarque nginx + php-fpm et un init s6 qui écoute sur le **port 80**). Le tag
de base est contrôlé par un ARG de build propre à l'application, `FREESCOUT_VERSION` —
volontairement **pas** le générique `APP_VERSION`, car le socle injecte `APP_VERSION` et
l'écraserait avec `latest` ; `FreeScout_Common` fait correspondre `application_version = "latest"`
au tag éprouvé `php8.3-1.17.159` avant de le transmettre comme `FREESCOUT_VERSION`.

L'enveloppe ajoute un point d'entrée cloud (`entrypoint.sh`) qui s'exécute avant le
`/init` amont :

- **Crée des alias des variables d'environnement de base de données du socle vers les
  noms tiredofit.** Le module applicatif définit `db_user_env_var_name = DB_USERNAME`, `db_password_env_var_name =
  DB_PASSWORD` et `db_name_env_var_name = DB_DATABASE` (les noms natifs de Laravel),
  de sorte que le socle injecte `DB_USERNAME`/`DB_PASSWORD`/`DB_DATABASE` avec les bonnes
  valeurs propres au tenant. Le point d'entrée les fait correspondre aux
  `DB_USER`/`DB_PASS`/`DB_NAME` que lit l'init amont, et définit `DB_HOST`/`DB_PORT`.
- **Résout un véritable hôte TCP sur Cloud Run.** Si `DB_HOST` arrive sous la forme d'un
  répertoire de socket Cloud SQL (`/cloudsql/<proj:region:inst>`), il se replie sur
  l'IP privée injectée `DB_IP`, car la connexion PDO MySQL de FreeScout nécessite un
  hôte TCP. Sur GKE, `DB_HOST` vaut déjà `127.0.0.1` (le sidecar Auth Proxy).
- **Définit l'URL publique.** Il exporte `APP_URL`/`SITE_URL` à partir de `CLOUDRUN_SERVICE_URL`
  (Cloud Run) ou de `GKE_SERVICE_URL` (GKE), sauf s'ils sont déjà définis, afin que
  FreeScout construise des liens absolus corrects et que la page de connexion/le tableau
  de bord s'affiche sur `GET /`.
- **Passe la main au `/init` amont**, qui exécute les migrations et crée l'administrateur.

L'image est construite via Cloud Build lors du premier déploiement (et chaque fois que
le hash du contenu du build change). Les modifications de `entrypoint.sh` ou du
`Dockerfile` sont intégrées à l'image et nécessitent un nouveau build ; `db-init.sh`
est monté dans le job et prend effet au prochain apply, sans nouveau build.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`FreeScout_Common` établit l'environnement FreeScout de base afin que l'application
démarre correctement au premier lancement :

- **Pilote de base de données** — `DB_CONNECTION = "mysql"`, `DB_PORT = "3306"`.
- **Administrateur initial** — `ADMIN_EMAIL` (par défaut `admin@techequity.cloud`, la
  convention RAD), `ADMIN_FIRST_NAME = "RAD"`, `ADMIN_LAST_NAME = "Admin"`, et le
  secret `ADMIN_PASS`. L'init amont crée ce compte au premier démarrage.
- **URL publique** — `APP_URL` / `SITE_URL` sont définis sur l'URL prévue du service
  lorsqu'elle est connue ; le point d'entrée les corrige à l'exécution à partir de
  l'URL réelle du service.
- **Journalisation** — `CONTAINER_LOG_LEVEL = "NOTICE"`.
- **Limites PHP** — `php_memory_limit` (`512M`), `upload_max_filesize` (`64M`) et
  `post_max_size` (`64M`) ajustent PHP pour le téléversement des pièces jointes.
- **Redis (facultatif)** — désactivé par défaut. Lorsqu'il est activé, `REDIS_HOST`/`REDIS_PORT`
  sont injectés (avec repli sur l'IP de la VM du serveur NFS lorsque `redis_host` est vide).

Ajustements propres à chaque plateforme gérés ici :

- **Cloud Run** se connecte à MySQL via l'IP privée (TCP) ; `enable_cloudsql_volume`
  vaut `false` par défaut sur la variante Cloud Run.
- **GKE** remplace `DB_HOST = "127.0.0.1"` car le Cloud SQL Auth Proxy s'exécute comme
  sidecar lié à l'interface de bouclage, et conserve `enable_cloudsql_volume = true`.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

FreeScout sert sa page de connexion/son tableau de bord sur `GET /` (HTTP 200) une fois
démarré ; il n'existe **pas d'endpoint de santé JSON dédié**. Les sondes par défaut en
tiennent compte :

- **Sonde de démarrage** — TCP sur le port du conteneur avec un délai initial de
  30 secondes et une fenêtre généreuse de 20 échecs (période de 15 s), pour laisser le
  temps aux migrations du premier démarrage que l'init amont exécute avant que le
  serveur web ne soit pleinement prêt.
- **Sonde de vivacité** — HTTP `GET /` avec un délai initial de 300 secondes, un
  timeout de 60 secondes et un seuil de 3 échecs, afin que le conteneur ne soit pas
  redémarré pendant qu'il exécute encore ses migrations au premier démarrage.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket de téléversements **Cloud Storage** dédié (déclaré avec `name_suffix =
"freescout-uploads"`) est déclaré ici et provisionné par le socle, qui accorde
également l'accès au compte de service de la charge de travail. Notez que le stockage
durable principal de FreeScout pour les pièces jointes et les fichiers d'exécution est
le **volume NFS** monté sur `/var/lib/freescout` (activé par défaut). Listez le bucket
avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à FreeScout visible par l'utilisateur (variables par
groupe, sorties, et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides de plateforme :
**[FreeScout_GKE](FreeScout_GKE.md)** et **[FreeScout_CloudRun](FreeScout_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [FreeScout sur Google Cloud Run](FreeScout_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [FreeScout sur GKE Autopilot](FreeScout_GKE.md) — cette configuration déployée sur GKE.
