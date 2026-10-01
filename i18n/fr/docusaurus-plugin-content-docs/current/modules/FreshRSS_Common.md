---
title: "FreshRSS Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module FreshRSS — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/FreshRSS_Common.md @ 3055034 sha256:f4fd4bb5c806 -->

# FreshRSS Common — Configuration applicative partagée {#freshrss-common--shared-application-configuration}

`FreshRSS_Common` est la **couche applicative partagée** de FreshRSS. Elle n'est pas
déployée seule ; elle fournit la configuration propre à FreshRSS sur laquelle
s'appuient à la fois [FreshRSS_GKE](FreshRSS_GKE.md) et
[FreshRSS_CloudRun](FreshRSS_CloudRun.md), afin que les deux variantes de plateforme
se comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais directement cette couche — elle ne possède aucune entrée propre
dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement FreshRSS, consultez les
guides des plateformes ([FreshRSS_GKE](FreshRSS_GKE.md),
[FreshRSS_CloudRun](FreshRSS_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par FreshRSS_Common | Où cela apparaît |
|---|---|---|
| Identifiant administrateur | Génère un `FRESHRSS_ADMIN_PASSWORD` de 24 caractères et le stocke dans **Secret Manager** ; injecté comme variable d'environnement secrète du service | À récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Build personnalisé léger superposé à l'image officielle `freshrss/freshrss` avec un wrapper `platform-entrypoint.sh` ; construit via Cloud Build | Output `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme moteur pris en charge (le point d'entrée code en dur `--db-type pgsql`) | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les droits | Output `initialization_jobs` |
| Installation au premier lancement | Le point d'entrée pilote les scripts `cli/do-install.php` + `cli/create-user.php` de FreshRSS au premier démarrage | Comportement de l'application dans les guides des plateformes |
| Stockage persistant | Ne déclare **aucun bucket GCS** ; l'état par utilisateur et la configuration résident dans le répertoire de données de FreshRSS, rendu persistant via NFS (ou un PVC en mode bloc sur GKE) | Output `storage_buckets` (vide) |
| Paramètres de base | Définit la configuration de référence de FreshRSS : utilisateur administrateur, langue, fuseau horaire, cadence du cron d'actualisation des flux, URL de base | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les sondes par défaut de démarrage (TCP) et d'activité (HTTP) ; FreshRSS sert aussi un point de terminaison JSON `/status` non authentifié | §Observabilité dans les guides des plateformes |

---

## 2. Identifiant administrateur dans Secret Manager {#2-admin-credential-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager :

- **`FRESHRSS_ADMIN_PASSWORD`** — un mot de passe aléatoire de 24 caractères (sans
  caractères spéciaux). Lors de la première installation, le point d'entrée le
  transmet à la CLI `create-user.php` de FreshRSS afin que le compte `admin` par
  défaut (ainsi que le mot de passe d'API correspondant, utilisé par les clients
  mobiles via les API Google Reader / Fever) soit utilisable immédiatement après le
  déploiement. Il est fourni au conteneur en cours d'exécution comme **variable
  d'environnement secrète du service** via l'output `secret_ids` du module.

Le secret est nommé `secret-<resource_prefix>-<application_name>-admin-password`
(par exemple `secret-appfreshrssdemo1a2b3c4d-freshrss-admin-password`). Récupérez-le
après le déploiement :

```bash
# List the FreshRSS admin-password secret for this deployment:
gcloud secrets list --project "$PROJECT" --filter="name~admin-password"

# Read the current admin password:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

L'utilisateur de connexion par défaut est `admin`. Comme la CLI de première
installation est conditionnée par la présence de `data/config.php`, modifier ce
secret **après** l'installation initiale ne réinitialise pas automatiquement
l'identifiant administrateur — changez plutôt le mot de passe depuis l'interface de
FreshRSS (ou réexécutez `create-user.php`).

Le mot de passe de la base de données est généré et géré séparément par le socle ;
le nom de son secret figure dans les outputs du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur et initialisation de la base de données {#3-database-engine-and-bootstrap}

FreshRSS fonctionne avec **PostgreSQL 15**. Bien que la variable `database_type` de
la plateforme propose nominalement d'autres options, le point d'entrée de FreshRSS
effectue l'installation avec `--db-type pgsql` et le job d'initialisation ne prend
en charge que Postgres : PostgreSQL est donc le moteur pris en charge. Lors du
premier déploiement, un job ponctuel (`db-init`) s'exécute avec `postgres:15-alpine`
et, de manière idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy (Cloud Run) et le mappe pour
   l'accès `psql`, ou utilise le loopback du proxy `127.0.0.1` (GKE) / une
   connexion TCP par IP privée,
2. Sélectionne le `PGSSLMODE` adapté au saut de connexion (`disable` pour le
   socket / le loopback, `require` pour une connexion TCP directe par IP privée),
3. Attend que PostgreSQL soit joignable (`pg_isready`),
4. Crée (ou met à jour) l'utilisateur de l'application avec le mot de passe généré,
5. Crée (ou reconfigure) la base de données de l'application avec cet utilisateur
   comme propriétaire,
6. Accorde tous les privilèges sur la base de données et le schéma `public`,
7. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter (`/quitquitquit`) afin que
   le Job puisse se terminer.

Le job peut être réexécuté sans risque. Inspectez directement la base de données
avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
outputs du déploiement de la plateforme. Il n'existe **aucun job de migration
distinct** : le schéma de FreshRSS est créé par le script `cli/do-install.php` de
l'application elle-même, que le point d'entrée exécute au premier démarrage une fois
que `db-init` a provisionné la base de données et le rôle.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est un build léger `FROM freshrss/freshrss:<version>` (Apache,
port 80) auquel s'ajoute un petit `platform-entrypoint.sh`. Le tag de l'image de base
est piloté par un **ARG de build propre à l'application, `FRESHRSS_VERSION`** (jamais
l'`APP_VERSION` générique, que le socle injecte et qui l'écraserait en `latest`) ;
lorsque le déploiement demande `latest`, le module épingle un tag éprouvé (`1.26.3`)
pour des reconstructions déterministes.

Le point d'entrée s'exécute avant le point d'entrée d'origine de FreshRSS et :

- **Résout l'hôte de la base de données** — privilégie le répertoire du socket Unix
  Cloud SQL lorsque le volume est monté (Cloud Run), et se rabat sur le loopback du
  proxy `127.0.0.1` (GKE) ou sur un hôte TCP à IP privée. Il ne transmet jamais un
  chemin de socket à une connexion TCP.
- **Construit les arguments des CLI d'installation et d'utilisateur** — assemble
  `FRESHRSS_INSTALL` (`--db-type pgsql`, hôte, utilisateur, mot de passe, base,
  `--auth-type form`, `--api-enabled`, `--language`, `--base-url`) et
  `FRESHRSS_USER` (utilisateur administrateur + mot de passe + mot de passe d'API) à
  partir des variables `DB_*` injectées par la plateforme et du secret
  `FRESHRSS_ADMIN_PASSWORD`. Le script `do-install.php` de FreshRSS n'accepte
  **pas** d'option `--db-port`, si bien qu'aucun port explicite n'est transmis.
- **Déduit l'URL de base publique** — à partir de `BASE_URL`, avec repli sur
  `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`.
- **Enchaîne sur le point d'entrée d'origine de FreshRSS** — qui exécute
  l'installation de manière idempotente (conditionnée par `data/config.php`),
  configure le cron d'actualisation des flux et lance la CMD Apache. Un repli par
  CLI directe exécute l'installation si le point d'entrée d'origine est absent.

Le `Dockerfile` restaure également à l'identique la CMD par défaut d'origine
(chargement des envvars Apache → démarrage de `cron` → `exec apache2 -D FOREGROUND`),
car la définition d'un ENTRYPOINT personnalisé réinitialise la CMD héritée.

---

## 5. Paramètres de base de l'application {#5-core-application-settings}

`FreshRSS_Common` établit l'environnement de référence de FreshRSS afin que
l'application démarre correctement dès le premier lancement :

- **Utilisateur administrateur** — `FRESHRSS_ADMIN_USER = "admin"`.
- **Langue** — `FRESHRSS_LANGUAGE = "en"`.
- **Fuseau horaire** — `TZ = "UTC"`.
- **Cron d'actualisation des flux** — `CRON_MIN = "*/15"` ; l'image d'origine
  exécute un cron dans le conteneur qui actualise les flux suivis toutes les
  15 minutes.
- **URL de base** — `BASE_URL` est défini sur l'URL publique du service (l'URL
  Cloud Run prévue ou l'URL du service GKE) ; le point d'entrée privilégie
  `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL` injectés à l'exécution lorsqu'ils sont
  présents.
- **Raccordement à la base de données** — le socle injecte les variables standard
  `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_HOST`, `DB_IP`, `DB_PORT` sous leurs
  **noms par défaut** (ce module ne les renomme pas) ; le point d'entrée les
  consomme directement.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

La sonde de démarrage est une vérification **TCP** sur le port 80 (le conteneur est
prêt dès qu'Apache se lie à son port), et la sonde d'activité est une vérification
**HTTP**. FreshRSS sert son index non authentifié sur `/` (HTTP 200) et un point de
terminaison de santé JSON non authentifié sur `/status` ; les variantes CloudRun/GKE
ciblent `/` par défaut, tandis que la valeur par défaut de la sonde d'activité de
cette couche partagée cible `/status`. Une fenêtre de démarrage généreuse (un
`failure_threshold` élevé) laisse le temps à l'installation du premier démarrage qui
crée le schéma.

---

## 7. Stockage persistant {#7-persistent-storage}

FreshRSS conserve sa configuration générée (`data/config.php`), l'état par
utilisateur, les articles mis en cache et les favicons des flux dans le répertoire
de données `/var/www/FreshRSS/data`. Cette couche ne déclare **aucun bucket GCS**
(`storage_buckets` est vide) ; les variantes de plateforme montent plutôt un
**volume NFS sur `/var/www/FreshRSS/data`** (`enable_nfs = true` par défaut) afin
que cet état survive aux redémarrages de conteneur et aux redéploiements. Sur GKE,
un PVC en mode bloc (StatefulSet) constitue un mode de persistance alternatif.

Listez le stockage provisionné avec :

```bash
gcloud storage buckets list --project "$PROJECT"   # FreshRSS declares none of its own
```

---

Pour la configuration propre à FreshRSS destinée aux utilisateurs (variables par
groupe, outputs, et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[FreshRSS_GKE](FreshRSS_GKE.md)** et
**[FreshRSS_CloudRun](FreshRSS_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [FreshRSS sur Google Cloud Run](FreshRSS_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [FreshRSS sur GKE Autopilot](FreshRSS_GKE.md) — cette configuration déployée sur GKE.
