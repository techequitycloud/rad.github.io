---
title: "LimeSurvey Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module LimeSurvey — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/LimeSurvey_Common.md @ 15fd4c7 sha256:53a5cd2dfe94 -->

# LimeSurvey Common — Configuration d'application partagée {#limesurvey-common--shared-application-configuration}

`LimeSurvey_Common` est la **couche d'application partagée** pour LimeSurvey. Elle n'est pas
déployée seule ; elle fournit plutôt la configuration spécifique à LimeSurvey sur laquelle
[LimeSurvey_GKE](LimeSurvey_GKE.md) et
[LimeSurvey_CloudRun](LimeSurvey_CloudRun.md) s'appuient, de sorte que les deux variantes de plateforme
se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement —
elle n'a pas d'entrées d'interface utilisateur de déploiement propres — mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute réellement LimeSurvey, consultez les guides de plateforme
([LimeSurvey_GKE](LimeSurvey_GKE.md),
[LimeSurvey_CloudRun](LimeSurvey_CloudRun.md)) et les guides de socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par LimeSurvey_Common | Où cela apparaît |
|---|---|---|
| Identifiant administrateur | Génère le mot de passe super-administrateur (20 caractères) et le stocke dans **Secret Manager** ; l'injecte comme variable d'environnement secrète `ADMIN_PASSWORD` | Récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image amont `martialblog/limesurvey` (Apache) avec un point d'entrée cloud léger ; construit via Cloud Build et met en miroir la base dans Artifact Registry | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour MySQL 8.0** comme moteur et force le moteur de stockage **InnoDB** | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job de premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les autorisations | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `limesurvey-uploads` | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement LimeSurvey de base : `DB_TYPE`, `DB_PORT`, moteur de stockage, `URL_FORMAT`, identité administrateur, `PUBLIC_URL` | Comportement de l'application dans les guides de plateforme |
| Sondes de santé | Fournit la sonde de démarrage TCP par défaut et la sonde de vivacité HTTP ciblant le point d'entrée racine `/` | §Observabilité dans les guides de plateforme |

---

## 2. Identifiant administrateur dans Secret Manager {#2-admin-credential-in-secret-manager}

Le point d'entrée amont `martialblog/limesurvey` **requiert** `ADMIN_PASSWORD` — il
se termine avec le code 1 si la variable est manquante — et initialise le compte super-administrateur
initial avec celui-ci au premier démarrage. `LimeSurvey_Common` génère un mot de passe de 20 caractères
une fois et le stocke dans Secret Manager afin qu'il soit stable lors des redémarrages et ne se retrouve jamais
en clair dans la configuration :

- **`ADMIN_PASSWORD`** — le mot de passe super-administrateur pour le compte `admin`.
  Stocké comme `secret-<resource_prefix>-<application_name>-admin-password`. Il est
  exposé au conteneur en cours d'exécution comme variable d'environnement secrète `ADMIN_PASSWORD` via la
  sortie `secret_ids`. L'identité du compte elle-même est fixée par des variables d'environnement statiques dans cette
  couche : `ADMIN_USER = admin`, `ADMIN_NAME = Administrator`,
  `ADMIN_EMAIL = admin@techequity.cloud`.

Le mot de passe de la base de données est généré et géré séparément par le socle ; son
nom de secret est indiqué dans les sorties de déploiement de la plateforme (`database_password_secret`).

Récupérez le mot de passe administrateur après le déploiement :

```bash
# Find the secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~admin-password"

# Read the current value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Une fois que vous vous êtes connecté et que vous avez (éventuellement) créé des comptes supplémentaires, vous pouvez faire pivoter
la valeur dans Secret Manager et redéployer — le point d'entrée réapplique tout ce que
`ADMIN_PASSWORD` est présent. Voir [App_Common](App_Common.md) pour le secret partagé
et le modèle Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

LimeSurvey nécessite **MySQL 8.0** ; le moteur est fixé à `MYSQL_8_0` et d'autres
moteurs ne sont pas pris en charge par ce module. Lors du premier déploiement, un job unique
(`db-init`) s'exécute en utilisant `mysql:8.0-debian` et de manière idempotente :

1. Localise la connexion Cloud SQL — le socket Unix du proxy d'authentification Cloud SQL sous
   `/cloudsql` lorsqu'un volume de socket est monté, sinon une connexion TCP via l'IP privée de l'instance
   (`DB_IP`),
2. Attend que le port MySQL 3306 soit accessible (chemin TCP),
3. Crée (ou met à jour) l'utilisateur de l'application avec le mot de passe généré
   (`CREATE USER IF NOT EXISTS … / ALTER USER …`),
4. Crée la base de données de l'application (`CREATE DATABASE IF NOT EXISTS`),
5. Accorde tous les privilèges sur cette base de données à l'utilisateur de l'application,
6. Vérifie que l'utilisateur de l'application peut réellement se connecter — faisant échouer le job tôt en cas de
   mot de passe ou de non-concordance des autorisations, et réchauffant le cache d'authentification
   côté serveur `caching_sha2_password`,
7. Signale au sidecar du proxy d'authentification Cloud SQL de s'arrêter gracieusement (via
   `quitquitquit`) afin que le conteneur du job se termine proprement.

Le job peut être réexécuté en toute sécurité. Notez que MySQL 8.0 utilise `caching_sha2_password` par
défaut ; sur TCP simple, le script ajoute `--get-server-public-key` pour l'échange de clés RSA
lorsque le client le prend en charge.

**Aucun job de migration séparé n'existe.** Le schéma LimeSurvey réel (les
tables `settings_global`, `surveys`, `users`, …) est créé au démarrage du conteneur par le
point d'entrée amont `martialblog/limesurvey`, qui exécute l'installateur de console LimeSurvey /
`updatedb` une fois que `db-init` a provisionné une base de données et un utilisateur vides.

**Pourquoi InnoDB est forcé.** Cloud SQL MySQL 8.0 désactive le moteur de stockage MyISAM
(`disabled_storage_engines=MyISAM`). Le point d'entrée `martialblog/limesurvey` définit
son moteur par défaut sur MyISAM et l'écrit dans `config.php`, de sorte que l'installateur de console essaierait
`CREATE TABLE … ENGINE=MyISAM` et Cloud SQL le rejetterait (`3161 Storage engine
MyISAM is disabled`). Cette couche définit donc à la fois `DB_MYSQL_ENGINE = InnoDB` et
`DBENGINE = InnoDB` afin que la création de table réussisse au premier démarrage.

Inspectez la base de données directement avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms d'instance, de base de données et d'utilisateur se trouvent dans les sorties de déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est un wrapper léger `FROM martialblog/limesurvey:<tag>` (Apache,
s'exécutant sur le port 8080 en tant que `www-data` avec `WORKDIR /var/www/html`). Le tag de base est
indexé sur un argument de build spécifique à l'application `LIMESURVEY_VERSION` — **pas** le générique
`APP_VERSION`, que le socle injecte dans `build_args` et qui écraserait en
`latest`. `LimeSurvey_Common` mappe `application_version == "latest"` sur un tag épinglé connu et bon
(`6-apache`) et le passe comme `LIMESURVEY_VERSION`. L'image est construite via
Cloud Build ; `enable_image_mirroring = true` met en miroir la base publique de Docker Hub dans
Artifact Registry.

Le wrapper insère un `cloud-entrypoint.sh` qui s'exécute avant le point d'entrée amont
et maintient son travail minimal :

- **Définit le backend de la base de données par défaut** — `DB_TYPE = mysql`, `DB_PORT = 3306`.
- **Alias les noms de base de données à portée locataire** — mappe de manière défensive `DB_USER → DB_USERNAME`
  et `DB_DATABASE → DB_NAME` si un nom est manquant (la variante `main.tf`
  renomme déjà les valeurs injectées par le socle en `DB_USERNAME` / `DB_NAME` /
  `DB_PASSWORD`).
- **Définit `PUBLIC_URL`** — à partir de l'URL de service exportée par le socle
  (`CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`) lorsqu'elle n'est pas définie, afin que les liens générés et
  les actifs se résolvent sur l'hôte réel.
- **Passe la main au `/usr/local/bin/entrypoint.sh` amont**, qui génère
  `application/config/config.php` à partir de l'environnement, provisionne/met à jour le
  schéma, et exécute enfin `apache2-foreground`.
- **Conserve les sessions PHP dans MySQL** — juste avant le démarrage d'Apache, il active le
  gestionnaire de sessions de base de données (`DbHttpSession`, que LimeSurvey livre commenté dans
  le fichier `config.php` généré). Par défaut, les sessions se trouveraient dans le
  répertoire éphémère `/tmp` du conteneur ; pour une enquête sans sauvegarde et reprise, la session contient les
  réponses non soumises du répondant, de sorte qu'une mise à l'échelle à zéro ou un remplacement de pod
  les perdrait autrement.

---

## 5. Paramètres d'application de base {#5-core-application-settings}

`LimeSurvey_Common` établit l'environnement LimeSurvey de base afin que l'application
démarre correctement au premier démarrage :

- **Base de données** — `DB_TYPE = mysql`, `DB_PORT = 3306`, `DB_MYSQL_ENGINE = InnoDB`,
  `DBENGINE = InnoDB`. `DB_HOST`, `DB_USERNAME`, `DB_NAME`, et `DB_PASSWORD` sont
  injectés par le socle (renommés en noms natifs de LimeSurvey via
  `db_*_env_var_name`).
- **Format d'URL** — `URL_FORMAT = path` pour des URL d'enquête propres et basées sur le chemin.
- **Identité administrateur** — `ADMIN_USER = admin`, `ADMIN_NAME = Administrator`,
  `ADMIN_EMAIL = admin@techequity.cloud` ; `ADMIN_PASSWORD` de Secret Manager.
- **URL publique** — `PUBLIC_URL` à partir de l'URL de service prédite/réelle afin que les liens et
  les actifs se résolvent sur l'hôte réel.
- **Port** — le conteneur écoute sur `8080` (Apache).

Ajustement spécifique à la plateforme géré ici :

- **GKE** surcharge `DB_HOST = 127.0.0.1` car le proxy d'authentification Cloud SQL s'exécute en tant que
  sidecar lié à la boucle locale. Sur **Cloud Run**, l'application compose l'IP privée de Cloud SQL
  sur TCP (MySQL sur IP privée TCP n'a pas besoin de SSL).

---

## 6. Comportement de la sonde de santé {#6-health-probe-behaviour}

LimeSurvey sert un HTTP 200 non authentifié au point d'entrée racine (`/`), donc
les sondes ciblent `/` :

- **Sonde de démarrage** — TCP contre le port du conteneur, délai initial de 30 secondes, période de 15 secondes,
  20 échecs autorisés — une fenêtre généreuse pour l'installateur de console au premier démarrage
  qui provisionne le schéma.
- **Sonde de vivacité** — HTTP `GET /`, délai initial de 300 secondes, période de 60 secondes, 3
  échecs autorisés.

---

## 7. Stockage d'objets et persistance des fichiers {#7-object-storage-and-file-persistence}

Un bucket **Cloud Storage** dédié (`limesurvey-uploads`) est déclaré ici et
provisionné par le socle, qui accorde également l'accès au compte de service de la charge de travail :

```bash
gcloud storage buckets list --project "$PROJECT"
```

Notez que la persistance du répertoire de téléchargement d'exécution de LimeSurvey
(`/var/www/html/upload` — images d'actifs téléchargées, signatures, codes-barres) lors des
redémarrages du conteneur est fournie par le montage **NFS (Cloud Filestore)**, que les deux
variantes de plateforme activent par défaut (`enable_nfs = true`). Le bucket GCS `limesurvey-uploads`
est provisionné pour un stockage d'objets supplémentaire mais n'est pas monté FUSE par
défaut.

---

Pour la configuration spécifique à LimeSurvey et destinée à l'utilisateur (variables par groupe, sorties,
et comment explorer chaque service depuis la Console et la CLI), consultez les guides de plateforme :
**[LimeSurvey_GKE](LimeSurvey_GKE.md)** et
**[LimeSurvey_CloudRun](LimeSurvey_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [LimeSurvey sur Google Cloud Run](LimeSurvey_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [LimeSurvey sur GKE Autopilot](LimeSurvey_GKE.md) — cette configuration déployée sur GKE.
