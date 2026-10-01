---
title: "LimeSurvey Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module LimeSurvey — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/LimeSurvey_Common.md @ 3055034 sha256:31fcd7d85aa1 -->

# LimeSurvey Common — Configuration applicative partagée {#limesurvey-common--shared-application-configuration}

`LimeSurvey_Common` est la **couche applicative partagée** de LimeSurvey. Elle n'est
pas déployée seule ; elle fournit la configuration propre à LimeSurvey sur laquelle
s'appuient à la fois [LimeSurvey_GKE](LimeSurvey_GKE.md) et
[LimeSurvey_CloudRun](LimeSurvey_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais directement cette couche — elle ne possède aucune entrée
propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique
les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement LimeSurvey, consultez les
guides des plateformes ([LimeSurvey_GKE](LimeSurvey_GKE.md),
[LimeSurvey_CloudRun](LimeSurvey_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par LimeSurvey_Common | Où cela apparaît |
|---|---|---|
| Identifiant administrateur | Génère le mot de passe du super-administrateur (20 caractères) et le stocke dans **Secret Manager** ; l'injecte en tant que variable d'environnement secrète `ADMIN_PASSWORD` | À récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image upstream `martialblog/limesurvey` (Apache) avec un point d'entrée cloud léger ; build via Cloud Build et mise en miroir de l'image de base dans Artifact Registry | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for MySQL 8.0** comme moteur et force le moteur de stockage **InnoDB** | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les privilèges | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `limesurvey-uploads` | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement LimeSurvey de référence : `DB_TYPE`, `DB_PORT`, moteur de stockage, `URL_FORMAT`, identité de l'administrateur, `PUBLIC_URL` | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde de démarrage TCP et la sonde de vivacité HTTP par défaut ciblant le point de terminaison racine `/` | §Observabilité dans les guides des plateformes |

---

## 2. Identifiant administrateur dans Secret Manager {#2-admin-credential-in-secret-manager}

Le point d'entrée upstream `martialblog/limesurvey` **exige** `ADMIN_PASSWORD` — il
se termine avec le code 1 si la variable est absente — et l'utilise pour créer le
compte super-administrateur initial au premier démarrage. `LimeSurvey_Common` génère
une seule fois un mot de passe de 20 caractères et le stocke dans Secret Manager, afin
qu'il reste stable entre les redémarrages et n'apparaisse jamais en clair dans la
configuration :

- **`ADMIN_PASSWORD`** — le mot de passe du super-administrateur pour le compte
  `admin`. Stocké sous `secret-<resource_prefix>-<application_name>-admin-password`.
  Il est exposé au conteneur en cours d'exécution en tant que variable
  d'environnement secrète `ADMIN_PASSWORD` via la sortie `secret_ids`. L'identité du
  compte elle-même est fixée par des variables d'environnement statiques dans cette
  couche : `ADMIN_USER = admin`, `ADMIN_NAME = Administrator`,
  `ADMIN_EMAIL = admin@techequity.cloud`.

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`).

Récupérez le mot de passe administrateur après le déploiement :

```bash
# Find the secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~admin-password"

# Read the current value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Une fois connecté et après avoir (éventuellement) créé d'autres comptes, vous pouvez
effectuer une rotation de la valeur dans Secret Manager puis redéployer — le point
d'entrée réapplique la valeur de `ADMIN_PASSWORD` présente. Consultez
[App_Common](App_Common.md) pour le modèle partagé des secrets et de Workload
Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

LimeSurvey nécessite **MySQL 8.0** ; le moteur est imposé à `MYSQL_8_0` et les autres
moteurs ne sont pas pris en charge par ce module. Lors du premier déploiement, un
job ponctuel (`db-init`) s'exécute avec `mysql:8.0-debian` et, de manière
idempotente :

1. Localise la connexion Cloud SQL — le socket Unix du Cloud SQL Auth Proxy sous
   `/cloudsql` lorsqu'un volume de socket est monté, sinon une connexion TCP via l'IP
   privée de l'instance (`DB_IP`),
2. Attend que le port MySQL 3306 soit joignable (chemin TCP),
3. Crée (ou met à jour) l'utilisateur de l'application avec le mot de passe généré
   (`CREATE USER IF NOT EXISTS … / ALTER USER …`),
4. Crée la base de données applicative (`CREATE DATABASE IF NOT EXISTS`),
5. Accorde tous les privilèges sur cette base de données à l'utilisateur de
   l'application,
6. Vérifie que l'utilisateur de l'application peut effectivement se connecter — en
   faisant échouer le job au plus tôt en cas de mot de passe ou de privilèges
   incorrects, et en préchauffant le cache d'authentification côté serveur
   `caching_sha2_password`,
7. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter proprement (via
   `quitquitquit`) afin que le conteneur du job se termine correctement.

Le job peut être réexécuté sans risque. Notez que MySQL 8.0 utilise
`caching_sha2_password` par défaut ; en TCP simple, le script ajoute
`--get-server-public-key` pour l'échange de clés RSA lorsque le client le prend en
charge.

**Il n'existe pas de job de migration distinct.** Le schéma LimeSurvey proprement
dit (les tables `settings_global`, `surveys`, `users`, …) est créé au démarrage du
conteneur par le point d'entrée upstream `martialblog/limesurvey`, qui exécute
l'installateur en console / `updatedb` de LimeSurvey une fois que `db-init` a
provisionné une base de données vide et un utilisateur.

**Pourquoi InnoDB est forcé.** Cloud SQL MySQL 8.0 désactive le moteur de stockage
MyISAM (`disabled_storage_engines=MyISAM`). Le point d'entrée `martialblog/limesurvey`
utilise MyISAM comme moteur par défaut et l'écrit dans `config.php` ; l'installateur
en console tenterait donc `CREATE TABLE … ENGINE=MyISAM` et Cloud SQL le rejetterait
(`3161 Storage engine MyISAM is disabled`). Cette couche définit donc à la
fois `DB_MYSQL_ENGINE = InnoDB` et `DBENGINE = InnoDB` afin que la création des tables réussisse au premier démarrage.

Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est une fine surcouche `FROM martialblog/limesurvey:<tag>`
(Apache, s'exécutant sur le port 8080 en tant que `www-data` avec
`WORKDIR /var/www/html`). Le tag de base est déterminé par un argument de build propre
à l'application, `LIMESURVEY_VERSION` — **et non** par le générique `APP_VERSION`, que
le socle injecte dans `build_args` et qui serait écrasé par `latest`.
`LimeSurvey_Common` fait correspondre `application_version == "latest"` à un tag figé
dont le bon fonctionnement est connu (`6-apache`) et le transmet en tant que
`LIMESURVEY_VERSION`. L'image est construite via Cloud Build ;
`enable_image_mirroring = true` met en miroir l'image de base publique de Docker Hub
dans Artifact Registry.

La surcouche ajoute un `cloud-entrypoint.sh` qui s'exécute avant le point d'entrée
upstream et limite son travail au minimum :

- **Définit les valeurs par défaut du backend de base de données** — `DB_TYPE = mysql`,
  `DB_PORT = 3306`.
- **Crée des alias pour les noms de base de données propres au tenant** — fait
  correspondre par précaution `DB_USER → DB_USERNAME` et `DB_DATABASE → DB_NAME` si un
  nom est absent (le `main.tf` de la variante renomme déjà les valeurs injectées par
  le socle en `DB_USERNAME` / `DB_NAME` / `DB_PASSWORD`).
- **Définit `PUBLIC_URL`** — à partir de l'URL du service exportée par le socle
  (`CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`) lorsqu'elle n'est pas définie, afin que
  les liens et les ressources générés se résolvent sur l'hôte réel.
- **Passe la main au `/usr/local/bin/entrypoint.sh` upstream**, qui génère
  `application/config/config.php` à partir de l'environnement, provisionne ou met à
  jour le schéma, puis exécute finalement `apache2-foreground`.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`LimeSurvey_Common` établit l'environnement LimeSurvey de référence afin que
l'application démarre correctement dès le premier lancement :

- **Base de données** — `DB_TYPE = mysql`, `DB_PORT = 3306`,
  `DB_MYSQL_ENGINE = InnoDB`, `DBENGINE = InnoDB`. `DB_HOST`, `DB_USERNAME`,
  `DB_NAME` et `DB_PASSWORD` sont injectés par le socle (renommés en noms natifs de
  LimeSurvey via `db_*_env_var_name`).
- **Format d'URL** — `URL_FORMAT = path` pour des URL d'enquête propres, basées sur
  le chemin.
- **Identité de l'administrateur** — `ADMIN_USER = admin`,
  `ADMIN_NAME = Administrator`, `ADMIN_EMAIL = admin@techequity.cloud` ;
  `ADMIN_PASSWORD` provient de Secret Manager.
- **URL publique** — `PUBLIC_URL` à partir de l'URL prévue/réelle du service, afin
  que les liens et les ressources se résolvent sur l'hôte réel.
- **Port** — le conteneur écoute sur `8080` (Apache).

Ajustement propre à la plateforme géré ici :

- **GKE** remplace `DB_HOST = 127.0.0.1` car le Cloud SQL Auth Proxy s'exécute en
  sidecar lié à l'interface de bouclage. Sur **Cloud Run**, l'application se connecte
  à l'IP privée de Cloud SQL en TCP (MySQL en TCP sur IP privée ne nécessite pas de
  SSL).

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

LimeSurvey renvoie un HTTP 200 non authentifié sur le point de terminaison racine
(`/`) ; les sondes ciblent donc `/` :

- **Sonde de démarrage** — TCP sur le port du conteneur, délai initial de 30 secondes,
  période de 15 secondes, 20 échecs autorisés — une fenêtre généreuse pour
  l'installateur en console du premier démarrage qui provisionne le schéma.
- **Sonde de vivacité** — HTTP `GET /`, délai initial de 300 secondes, période de
  60 secondes, 3 échecs autorisés.

---

## 7. Stockage d'objets et persistance des fichiers {#7-object-storage-and-file-persistence}

Un bucket **Cloud Storage** dédié (`limesurvey-uploads`) est déclaré ici et
provisionné par le socle, qui accorde également l'accès au compte de service de la
charge de travail :

```bash
gcloud storage buckets list --project "$PROJECT"
```

Notez que la persistance du répertoire de téléversement d'exécution de LimeSurvey
(`/var/www/html/upload` — images de ressources téléversées, signatures,
codes-barres) entre les redémarrages du conteneur est assurée par le montage
**NFS (Cloud Filestore)**, que les deux variantes de plateforme activent par défaut
(`enable_nfs = true`). Le bucket GCS `limesurvey-uploads` est provisionné pour du
stockage d'objets supplémentaire mais n'est pas monté via FUSE par défaut.

---

Pour la configuration propre à LimeSurvey exposée à l'utilisateur (variables par
groupe, sorties et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[LimeSurvey_GKE](LimeSurvey_GKE.md)** et
**[LimeSurvey_CloudRun](LimeSurvey_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [LimeSurvey sur Google Cloud Run](LimeSurvey_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [LimeSurvey sur GKE Autopilot](LimeSurvey_GKE.md) — cette configuration déployée sur GKE.
