---
title: "Nextcloud Common — Configuration applicative partagée"
description: "Référence de configuration partagée du module Nextcloud — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Nextcloud_Common.md @ 3055034 sha256:1c8f4e243e00 -->

# Nextcloud Common — Configuration applicative partagée {#nextcloud-common--shared-application-configuration}

`Nextcloud_Common` est la **couche applicative partagée** de Nextcloud. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Nextcloud sur laquelle
s'appuient à la fois [Nextcloud_GKE](Nextcloud_GKE.md) et
[Nextcloud_CloudRun](Nextcloud_CloudRun.md), afin que les deux variantes de plateforme
se comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a pas d'entrées propres dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs
par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Nextcloud, consultez les
guides des plateformes ([Nextcloud_GKE](Nextcloud_GKE.md),
[Nextcloud_CloudRun](Nextcloud_CloudRun.md)) et les guides des socles
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Nextcloud_Common | Où cela apparaît |
|---|---|---|
| Identifiant administrateur | Génère le mot de passe administrateur de Nextcloud et le stocke dans **Secret Manager** | À récupérer via Secret Manager (voir ci-dessous) |
| Secrets de configuration post-installation | Crée des secrets provisoires pour `instanceid`, `passwordsalt` et `secret` ; le hook du conteneur écrit les vraies valeurs après `occ maintenance:install` | Injectés en tant que `NEXTCLOUD_INSTANCE_ID`, `NEXTCLOUD_PASSWORD_SALT`, `NEXTCLOUD_APP_SECRET` |
| Image de conteneur | Épingle l'image officielle Nextcloud Apache et construit une extension personnalisée via Cloud Build, avec les limites PHP intégrées sous forme de valeurs `ARG` Docker | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for MySQL 8.0** comme seul moteur pris en charge (jeu de caractères `utf8mb4`) | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | Définit le job `db-init` du premier déploiement, qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `nc-data` | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement Nextcloud de base — identité de l'administrateur, limites PHP, proxys de confiance, câblage Redis et SMTP s'il est configuré | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la configuration par défaut des sondes de démarrage/vivacité ciblant `/status.php` | §Observabilité dans les guides des plateformes |
| Authentification Redis | Lorsque `redis_auth` n'est pas vide, stocke le mot de passe Redis sous forme de secret Secret Manager | Injecté en tant que `REDIS_HOST_PASSWORD` |

---

## 2. Identifiant administrateur et secrets de configuration dans Secret Manager {#2-admin-credential-and-config-secrets-in-secret-manager}

Le mot de passe de l'administrateur Nextcloud est généré automatiquement (24
caractères alphanumériques) et stocké sous forme de secret Secret Manager — il n'est
jamais défini en clair. Récupérez-le après le déploiement :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
gcloud secrets versions access latest --secret=<admin-password-secret> --project "$PROJECT"
```

Trois secrets supplémentaires (`instanceid`, `passwordsalt`, `secret`) sont créés avec
la valeur provisoire `"UNSET"` au moment du déploiement. Le hook post-installation du
conteneur écrit les vraies valeurs une fois `occ maintenance:install` terminé au
premier démarrage. Ces secrets permettent aux démarrages de pods suivants de
reconstruire `config.php` à partir de Secret Manager sans dépendre de la
disponibilité de NFS :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~nextcloud"
# Look for: *-instance-id, *-password-salt, *-app-secret
```

Le mot de passe de la base de données est généré et géré par le socle ; le nom de
son secret figure dans les outputs du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé des secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Nextcloud exige **MySQL 8.0** ; le moteur est fixe et PostgreSQL n'est pas pris en
charge. Lors du premier déploiement, un job ponctuel `db-init` se connecte à Cloud SQL
via l'Auth Proxy et, de manière idempotente :

1. crée la base de données Nextcloud avec le jeu de caractères `utf8mb4` et la
   collation `utf8mb4_unicode_ci` (si elle n'existe pas),
2. crée l'utilisateur de l'application avec l'authentification
   `mysql_native_password`,
3. accorde à l'utilisateur tous les privilèges sur la base de données,
4. vérifie la connectivité,
5. envoie le signal d'arrêt au Cloud SQL Auth Proxy afin que le Job Kubernetes se
   termine proprement.

Le job peut être réexécuté sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
outputs du déploiement de la plateforme.

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`Nextcloud_Common` établit l'environnement Nextcloud de base afin que l'application
démarre correctement dès le premier lancement :

- **Identité de l'administrateur** — le nom d'utilisateur administrateur initial
  (configurable dans le groupe 23 du module de plateforme).
- **Limites PHP** — `php_memory_limit`, `upload_max_filesize` et `post_max_size` sont
  transmis sous forme de valeurs `ARG` Docker à Cloud Build afin d'être intégrés à
  l'image du conteneur, et sont également injectés comme variables d'environnement
  d'exécution.
- **NEXTCLOUD_UPDATE=1** — `occ upgrade` s'exécute automatiquement à chaque démarrage
  du conteneur. Définissez `0` dans `environment_variables` lorsque vous gérez
  manuellement les mises à niveau d'une version majeure à l'autre.
- **Proxys de confiance** — `TRUSTED_PROXIES=10.0.0.0/8 172.16.0.0/12 192.168.0.0/16`
  est défini afin que Nextcloud respecte les IP des clients et le schéma HTTPS
  derrière l'équilibreur de charge de GKE et la couche proxy de Cloud Run.
- **OVERWRITEPROTOCOL=https** — Nextcloud génère tous les liens de partage et points
  de terminaison WebDAV en HTTPS.
- **Câblage Redis** — lorsque `enable_redis = true`, `REDIS_HOST` et
  `REDIS_HOST_PORT` sont injectés automatiquement.
- **Câblage SMTP** — lorsque `smtp_host` n'est pas vide, `SMTP_HOST`, `SMTP_SECURE`,
  `SMTP_PORT`, `SMTP_AUTHTYPE`, `SMTP_NAME`, `MAIL_FROM_ADDRESS` et `MAIL_DOMAIN`
  sont injectés automatiquement.
- **Variables d'environnement du hook post-installation** — les ID des secrets
  Secret Manager des trois secrets de configuration (`NC_INSTANCE_ID_SECRET_ID`,
  `NC_PASSWORD_SALT_SECRET_ID`, `NC_APP_SECRET_SECRET_ID`) et l'ID du projet GCP
  (`GOOGLE_CLOUD_PROJECT`) sont injectés afin que le hook du conteneur sache où écrire
  après `occ maintenance:install`.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les sondes par défaut ciblent `/status.php`, qui renvoie un HTTP 200 avec un objet
JSON d'état dès le démarrage d'Apache — que l'assistant d'installation de Nextcloud
ait été exécuté ou non. Cela en fait le point de terminaison de santé de référence de
Nextcloud.

| Sonde | Type | Chemin | Délai initial | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage | HTTP | `/status.php` | 60 s | 15 s | 40 (Cloud Run) / 20 (GKE) |
| Vivacité | HTTP | `/status.php` | 120 s | 30 s | 3 |

Les seuils d'échec de démarrage généreux s'expliquent par le fait que
`occ maintenance:install` s'exécute de manière synchrone au premier démarrage, avant
qu'Apache ne commence à accepter des connexions, et peut prendre plusieurs minutes sur
une instance Cloud SQL froide.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket **Cloud Storage** `nc-data` dédié est déclaré ici et provisionné par le
socle dans la région de déploiement. Le compte de service de la charge de travail
reçoit automatiquement l'accès à ce bucket. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~nc-data"
```

---

## 7. Scripts {#7-scripts}

`Nextcloud_Common` fournit quatre scripts dans son répertoire `scripts/` :

| Fichier | Rôle |
|---|---|
| `Dockerfile` | Image Nextcloud personnalisée étendant `nextcloud:<version>-apache`. Accepte `APP_VERSION`, `NEXTCLOUD_VERSION`, `PHP_MEMORY_LIMIT`, `UPLOAD_MAX_FILESIZE` et `POST_MAX_SIZE` sous forme de valeurs `ARG` Docker intégrées au moment du build. Le tag de l'image de base provient de `NEXTCLOUD_VERSION`, et non de `APP_VERSION` — le socle injecte de force `APP_VERSION = application_version` (souvent `"latest"`, et `nextcloud:latest-apache` n'existe pas) ; le Dockerfile dérive donc son propre argument `NEXTCLOUD_VERSION` (`"latest"` étant converti en `"stable"`) pour le tag `FROM`. |
| `entrypoint.sh` | Wrapper du point d'entrée : définit `NEXTCLOUD_DATA_DIR` sur le montage NFS pour les données des fichiers utilisateur, et résout `OVERWRITEHOST`/`OVERWRITECLIURL` à partir de l'URL du service à l'exécution. `config.php` n'est ni lié symboliquement à NFS ni stocké sur NFS — il est reconstruit localement à partir des secrets de Secret Manager à chaque démarrage (voir la ligne « Secrets de configuration post-installation » au §1). |
| `db-init.sh` | Script de configuration MySQL idempotent — crée la base de données avec `utf8mb4`, crée l'utilisateur avec `mysql_native_password`, accorde les privilèges et vérifie la connectivité. |
| `post-install-config-secrets.sh` | Hook post-installation : lit `instanceid`, `passwordsalt` et `secret` dans le `config.php` de Nextcloud après `occ maintenance:install` et les écrit dans Secret Manager. |

---

Pour la configuration propre à Nextcloud exposée aux utilisateurs (variables par
groupe, outputs, et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Nextcloud_GKE](Nextcloud_GKE.md)** et
**[Nextcloud_CloudRun](Nextcloud_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Nextcloud sur GKE Autopilot](Nextcloud_GKE.md) — cette configuration déployée sur GKE.
