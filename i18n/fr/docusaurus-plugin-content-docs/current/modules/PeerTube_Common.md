---
title: "PeerTube Common — Configuration applicative partagée"
description: "Référence de configuration partagée du module PeerTube — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/PeerTube_Common.md @ 3055034 sha256:883b3a823249 -->

# PeerTube Common — Configuration applicative partagée {#peertube-common--shared-application-configuration}

`PeerTube_Common` est la **couche applicative partagée** de PeerTube. Elle n'est pas
déployée seule ; elle fournit la configuration propre à PeerTube
sur laquelle s'appuie aujourd'hui [PeerTube_CloudRun](PeerTube_CloudRun.md), et sur laquelle s'appuiera une
future variante `PeerTube_GKE` une fois déployée et vérifiée,
afin que les deux variantes de plateforme se comportent de façon identique là où cela compte. Les utilisateurs finaux
ne configurent jamais cette couche directement — elle ne possède aucun champ de saisie propre dans l'interface
de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la
documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute réellement PeerTube, consultez
[PeerTube_CloudRun](PeerTube_CloudRun.md) et le guide de fondation
[App_CloudRun](App_CloudRun.md).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par PeerTube_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `PEERTUBE_SECRET` (64 caractères hexadécimaux, 32 octets aléatoires) et `PT_INITIAL_ROOT_PASSWORD` (24 caractères aléatoires), et les stocke dans **Secret Manager** | Injectés automatiquement ; récupérables via Secret Manager (voir ci-dessous) |
| Identifiants de stockage d'objets | Crée un compte de service dédié + une **paire de clés HMAC**, et stocke les deux moitiés dans Secret Manager | `PEERTUBE_OBJECT_STORAGE_CREDENTIALS_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` |
| Image de conteneur | Build personnalisé basé sur un Dockerfile reposant sur `chocobozzz/peertube`, avec un ARG de build dédié `PEERTUBE_VERSION` | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Impose **Cloud SQL pour PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans le guide de plateforme |
| Initialisation de la base de données | Définit le job de premier déploiement (`db-init`) qui crée la base de données et l'utilisateur, accorde les droits et installe `pg_trgm`/`unaccent` | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare les buckets Cloud Storage **`data`** (état local, monté via FUSE) et **`videos`** (public, compatible S3) | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement PeerTube de référence : liaison réseau, identité publique, initialisation de l'administrateur, inscription, activation du streaming en direct, TLS de la base de données, stockage d'objets S3, SMTP | Comportement de l'application dans le guide de plateforme |
| Vérifications d'état | Fournit la sonde de démarrage TCP par défaut et la sonde de vivacité HTTP ciblant `/api/v1/config` | §Observabilité dans le guide de plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager :

- **`PEERTUBE_SECRET`** — 32 octets aléatoires, encodés en hexadécimal (conformément à la
  recommandation `openssl rand -hex 32` de PeerTube). Signe les jetons de session JWT et
  les codes TOTP. Sa rotation invalide toutes les sessions actives — n'effectuez la rotation
  que pendant une fenêtre de maintenance.
- **`PT_INITIAL_ROOT_PASSWORD`** — un mot de passe aléatoire de 24 caractères. Lu
  directement depuis `process.env` (et non via node-config, donc sans préfixe `PEERTUBE_`) par
  le propre `installer.ts` de PeerTube au premier démarrage, lorsqu'aucun utilisateur n'existe encore, pour
  définir le mot de passe du compte administrateur `root` créé automatiquement. Sans ce secret,
  PeerTube génère un mot de passe aléatoire et se contente de le *journaliser* — irrécupérable si le
  journal de démarrage n'est pas capturé à temps. Ce secret n'affecte que la *création*
  du compte ; il n'a aucun effet sur le mot de passe d'un compte déjà créé.

Deux autres secrets servent au stockage d'objets :

- **`PEERTUBE_OBJECT_STORAGE_CREDENTIALS_ACCESS_KEY_ID`** /
  **`_SECRET_ACCESS_KEY`** — une paire de clés HMAC liée à un compte de service de
  stockage dédié, utilisée par le client natif compatible S3 de PeerTube (AWS SDK)
  sur le point de terminaison XML d'interopérabilité S3 de GCS.

Et, lorsque `smtp_host` est défini :

- **`PEERTUBE_SMTP_PASSWORD`** — généré automatiquement, sauf si `smtp_password` est
  fourni explicitement.

Récupérer les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~app-secret OR name~root-password OR name~s3-access-key OR name~s3-secret-key"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par la fondation ;
le nom de son secret est indiqué dans les sorties du déploiement de plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle partagé
de secrets et de Workload Identity.

---

## 3. Moteur de base de données et initialisation {#3-database-engine-and-bootstrap}

PeerTube nécessite **PostgreSQL 15** ; le moteur est fixe, et MySQL ou d'autres
moteurs ne sont pas pris en charge. Au premier déploiement, un job ponctuel (`db-init`)
s'exécute avec `postgres:15-alpine` et, de manière idempotente :

1. Attend que Cloud SQL accepte les connexions,
2. Crée (ou met à jour) le rôle de l'application avec le mot de passe généré et le
   privilège `CREATEDB`,
3. Crée la base de données de l'application (ou en réattribue la propriété) avec ce
   rôle comme propriétaire,
4. Accorde tous les privilèges sur la base de données et le schéma public,
5. Installe les extensions `pg_trgm` (recherche textuelle par trigrammes) et `unaccent`
   (recherche insensible aux accents) en tant que superutilisateur postgres — toutes deux
   requises par le guide d'installation en production de PeerTube, et **non créées par
   PeerTube lui-même** ; le rôle applicatif non privilégié n'a ainsi jamais besoin des privilèges `CREATE
   EXTENSION`,
6. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter proprement.

Le job peut être réexécuté sans risque. **Il n'existe pas de job de migration distinct** — PeerTube
crée et migre lui-même son schéma Sequelize automatiquement à chaque démarrage du
serveur. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est construite à partir d'un Dockerfile reposant sur l'image de base officielle
`chocobozzz/peertube`, avec un ARG de build `PEERTUBE_VERSION` — maintenu
volontairement séparé de l'ARG de build générique `APP_VERSION` injecté par la fondation
(qui l'emporte lors de la fusion en cas de collision de noms). Lorsque
`application_version = "latest"`, `PEERTUBE_VERSION` se résout en l'étiquette Docker Hub
maintenue `production` plutôt qu'en une étiquette `latest` impossible à résoudre.

Un fin `docker-entrypoint.sh` s'exécute avant de passer la main au point d'entrée
propre au fournisseur :

- **Il remappe les variables d'environnement Redis.** La fondation injecte les noms fixes
  `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` (aucun mécanisme d'alias par application
  n'existe pour Redis, contrairement à la base de données) ; le point d'entrée les remappe sur
  `PEERTUBE_REDIS_HOSTNAME`/`_PORT`/`_AUTH`.
- **Il dérive le nom d'hôte de fédération lorsqu'il n'est pas défini.** Lorsque
  `PEERTUBE_WEBSERVER_HOSTNAME` est vide (la valeur par défaut lorsque `host = ""`), le
  point d'entrée le dérive de l'URL de service prévue par la plateforme
  (`CLOUDRUN_SERVICE_URL` sur Cloud Run, `GKE_SERVICE_URL` sur GKE), en retirant
  le schéma et tout chemin final, de sorte qu'un nouveau déploiement fédère correctement
  sans qu'aucune décision de domaine ne soit nécessaire avant le déploiement.
- **Il attend PostgreSQL.** Il interroge `pg_isready` sur
  `PEERTUBE_DB_HOSTNAME`/`PEERTUBE_DB_PORT` avant de passer la main, jusqu'à 60
  tentatives espacées de 3 secondes.
- **Il passe la main au point d'entrée propre au fournisseur**
  (`support/docker/production/entrypoint.sh`, intégré à l'image de base),
  qui effectue le `chown` requis de `/data` et `/config` vers l'utilisateur
  `peertube`, abandonne les privilèges via `gosu` et exécute `node dist/server`.
  PeerTube crée et migre lui-même son schéma et initialise automatiquement le compte administrateur
  `root` au premier démarrage — aucun job d'initialisation/de migration distinct n'est
  nécessaire au-delà du provisionnement du rôle, de la base et des extensions par `db-init.sh`.

---

## 5. Paramètres de base de l'application {#5-core-application-settings}

`PeerTube_Common` établit l'environnement PeerTube de référence afin que
l'application démarre correctement et fédère dès le premier démarrage :

- **Liaison réseau** — `PEERTUBE_LISTEN_HOSTNAME = "0.0.0.0"` (la configuration propre à PeerTube
  utilise par défaut `127.0.0.1`, ce qui refuserait tout le trafic externe
  Cloud Run/GKE) ; `PEERTUBE_LISTEN_PORT` correspond à `container_port`.
- **Identité publique** — `PEERTUBE_WEBSERVER_HTTPS = "true"`,
  `PEERTUBE_WEBSERVER_PORT = "443"` (l'ingress Cloud Run/GKE termine la
  véritable connexion TLS publique) ; `PEERTUBE_WEBSERVER_HOSTNAME` provient de `var.host`
  ou est dérivé au démarrage (voir le §4).
- **Confiance envers le proxy** — `PEERTUBE_TRUST_PROXY = ["loopback", "linklocal", "uniquelocal"]`,
  puisque l'ingress Cloud Run/GKE est le seul chemin vers le conteneur.
- **Inscription** — `PEERTUBE_SIGNUP_ENABLED` provient de `enable_open_registration`
  (par défaut `false`).
- **Streaming en direct** — `PEERTUBE_LIVE_ENABLED` provient de `enable_live_streaming`
  (par défaut `false` ; sans effet pratique sur Cloud Run quelle que soit la valeur
  — l'ingestion RTMP nécessite un port TCP brut que les services Cloud Run ne peuvent pas exposer).
- **TLS de la base de données** — `PEERTUBE_DB_SSL` vaut ici `"false"` par défaut (correct pour
  le loopback cloud-sql-proxy de GKE) ; `PeerTube_CloudRun` le remplace par
  `"true"` + reject-unauthorized `"false"` via ses propres `module_env_vars`,
  car le mécanisme `db_host_env_var_name` de Cloud Run associe toujours l'IP privée
  brute de Cloud SQL, qui exige le chiffrement (voir
  [PeerTube_CloudRun](PeerTube_CloudRun.md) §3).
- **Stockage d'objets** — `PEERTUBE_OBJECT_STORAGE_ENABLED = "true"`, point de terminaison
  `https://storage.googleapis.com`, adressage de type chemin (path-style), les cinq classes
  de bucket (web-videos, streaming-playlists, original-video-files,
  user-exports, captions) pointant vers un seul bucket `videos` sous des
  préfixes distincts — à l'image de la disposition `docker-compose` de référence de PeerTube.
  `upload_acl.*` n'est volontairement pas défini (voir le §6).
- **SMTP** — configuré uniquement lorsque `smtp_host` n'est pas vide ; dans le cas contraire, aucune
  variable d'environnement `PEERTUBE_SMTP_*` n'est injectée.

---

## 6. Stockage d'objets {#6-object-storage}

`PeerTube_Common` déclare deux buckets GCS, provisionnés par la fondation :

- **`data`** — privé, monté via **GCS FUSE** sur `/data`. Il contient
  l'état local de PeerTube (hors stockage d'objets) : avatars, miniatures,
  aperçus, storyboards, torrents, plugins, journaux et tmp/cache. Cet état réside
  toujours sous `/data`, que le stockage d'objets soit activé ou non pour le
  contenu vidéo. Le point d'entrée du fournisseur s'exécute en root avant de basculer vers
  l'utilisateur `peertube` et effectue lui-même le `chown` de `/data` à chaque démarrage ; aucune option de montage
  `uid`/`gid` particulière n'est donc requise (contrairement aux applications dont le processus principal s'exécute
  sans privilèges root du début à la fin).
- **`videos`** — **public** (`public_access_prevention = "inherited"`,
  qui remplace la valeur sécurisée par défaut `"enforced"` de la fondation), avec CORS activé
  pour `GET`/`PUT`/`POST`/`DELETE`/`HEAD` depuis n'importe quelle origine. La documentation de PeerTube
  exige que son bucket de stockage d'objets soit public avec CORS configuré,
  car les fichiers vidéo et de playlists de streaming sont servis directement depuis le bucket
  aux navigateurs des utilisateurs finaux, sans passer par l'application. Sans le remplacement de
  `public_access_prevention`, l'autorisation
  `google_storage_bucket_iam_member` du module applicatif pour `allUsers:objectViewer` échoue
  au moment de l'apply avec une erreur `412 "public access prevention is enforced"` —
  confirmé en conditions réelles le 2026-07-22.

La configuration des ACL de téléversement (`object_storage.upload_acl.public`/`private`) est
volontairement **omise** — la documentation de PeerTube présente cette omission comme le contournement
requis pour les backends compatibles S3 dépourvus d'une véritable prise en charge des ACL par objet
(leur exemple documenté : Backblaze B2). L'interopérabilité XML S3 de GCS avec l'accès uniforme
au niveau du bucket présente la même limitation ; la lecture publique est donc accordée au
niveau du bucket au lieu de reposer sur des ACL par objet.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~peertube"
gcloud storage buckets describe gs://<videos-bucket> --format='value(iamConfiguration.publicAccessPrevention)'
```

---

## 7. Comportement des sondes d'état {#7-health-probe-behaviour}

- **Sonde de démarrage — TCP, et non HTTP.** Les migrations DB/Redis de PeerTube et
  l'initialisation de l'administrateur au premier démarrage (`installer.ts`) peuvent prendre plus de temps que ce
  qu'autorise une fenêtre de disponibilité HTTP classique ; une sonde TCP sur le port d'écoute évite
  de conditionner la révision à la disponibilité complète de l'application.
- **Sonde de vivacité — HTTP `GET /api/v1/config`.** Un point de terminaison public et non authentifié
  qui répond dès que le serveur HTTP de PeerTube sert réellement des
  requêtes.

---

Pour la configuration propre à PeerTube et destinée aux utilisateurs (variables par groupe,
sorties, et comment explorer chaque service depuis la Console et la CLI), consultez le
guide de plateforme : **[PeerTube_CloudRun](PeerTube_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [PeerTube sur Google Cloud Run](PeerTube_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [PeerTube sur GKE Autopilot](PeerTube_GKE.md) — cette configuration déployée sur GKE.
