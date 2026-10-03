---
title: "Nextcloud Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Nextcloud — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Nextcloud_Common.md @ 15fd4c7 sha256:329348358de9 -->

# Nextcloud Common — Configuration d'application partagée {#nextcloud-common--shared-application-configuration}

`Nextcloud_Common` est la **couche d'application partagée** pour Nextcloud. Elle n'est pas
déployée seule ; elle fournit plutôt la configuration spécifique à Nextcloud sur laquelle
[Nextcloud_GKE](Nextcloud_GKE.md) et [Nextcloud_CloudRun](Nextcloud_CloudRun.md) se
basent, de sorte que les deux variantes de plateforme se comportent de manière identique là où cela
importe. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a pas
ses propres entrées d'interface utilisateur de déploiement — mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute réellement Nextcloud, consultez les
guides de la plateforme ([Nextcloud_GKE](Nextcloud_GKE.md), [Nextcloud_CloudRun](Nextcloud_CloudRun.md))
et les guides de fondation ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Nextcloud_Common | Où cela apparaît |
|---|---|---|
| Identifiant administrateur | Génère le mot de passe administrateur Nextcloud et le stocke dans **Secret Manager** | Récupérer via Secret Manager (voir ci-dessous) |
| Secrets de configuration post-installation | Crée des secrets de remplacement pour `instanceid`, `passwordsalt` et `secret` ; le hook du conteneur écrit les vraies valeurs après `occ maintenance:install` | Injecté comme `NEXTCLOUD_INSTANCE_ID`, `NEXTCLOUD_PASSWORD_SALT`, `NEXTCLOUD_APP_SECRET` |
| Image de conteneur | Épingle l'image officielle Nextcloud Apache et construit une extension personnalisée via Cloud Build avec des limites PHP intégrées comme valeurs Docker `ARG` | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour MySQL 8.0** comme seul moteur pris en charge (jeu de caractères `utf8mb4`) | §Base de données dans les guides de la plateforme |
| Amorçage de la base de données | Définit le job `db-init` de premier déploiement qui crée la base de données, l'utilisateur et les autorisations | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket `nc-data` **Cloud Storage** | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement Nextcloud de base — identité administrateur, limites PHP, proxys de confiance, câblage Redis et SMTP si configuré | Comportement de l'application dans les guides de la plateforme |
| Vérifications de santé | Fournit la configuration par défaut de la sonde de démarrage/vivacité ciblant `/status.php` | §Observabilité dans les guides de la plateforme |
| Authentification Redis | Lorsque `redis_auth` n'est pas vide, stocke le mot de passe Redis comme secret Secret Manager | Injecté comme `REDIS_HOST_PASSWORD` |

---

## 2. Identifiant administrateur et secrets de configuration dans Secret Manager {#2-admin-credential-and-config-secrets-in-secret-manager}

Le mot de passe administrateur Nextcloud est généré automatiquement (alphanumérique de 24 caractères)
et stocké comme secret Secret Manager — il n'est jamais défini en texte clair.
Récupérez-le après le déploiement :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
gcloud secrets versions access latest --secret=<admin-password-secret> --project "$PROJECT"
```

Trois secrets supplémentaires (`instanceid`, `passwordsalt`, `secret`) sont créés avec la
valeur de remplacement `"UNSET"` au moment du déploiement. Le hook post-installation du conteneur
écrit les vraies valeurs après que `occ maintenance:install` soit terminé au premier démarrage. Ces secrets
permettent aux démarrages de pod ultérieurs de reconstruire `config.php` à partir de Secret Manager sans
dépendre de la disponibilité de NFS :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~nextcloud"
# Look for: *-instance-id, *-password-salt, *-app-secret
```

Le mot de passe de la base de données est généré et géré par la fondation ; son nom de secret est
rapporté dans les sorties de déploiement de la plateforme (`database_password_secret`). Voir
[App_Common](App_Common.md) pour le secret partagé et le modèle Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Nextcloud nécessite **MySQL 8.0** ; le moteur est fixe et PostgreSQL n'est pas pris en charge.
Lors du premier déploiement, un job `db-init` ponctuel se connecte à Cloud SQL via le proxy d'authentification
et de manière idempotente :

1. crée la base de données Nextcloud avec le jeu de caractères `utf8mb4` et la
   collation `utf8mb4_unicode_ci` (si absente),
2. crée l'utilisateur de l'application avec l'authentification `mysql_native_password`,
3. accorde à l'utilisateur tous les privilèges sur la base de données,
4. vérifie la connectivité,
5. envoie le signal de sortie du proxy d'authentification Cloud SQL afin que le job Kubernetes se termine proprement.

Le job peut être relancé en toute sécurité. Inspectez la base de données directement avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

L'instance, la base de données et les noms d'utilisateur se trouvent dans les sorties de déploiement de la plateforme.

---

## 4. Paramètres d'application de base {#4-core-application-settings}

`Nextcloud_Common` établit l'environnement Nextcloud de base afin que l'application
démarre correctement au premier démarrage :

- **Identité administrateur** — le nom d'utilisateur administrateur initial (configurable dans le groupe 23 du
  module de la plateforme).
- **Limites PHP** — `php_memory_limit`, `upload_max_filesize` et `post_max_size` sont
  transmis comme valeurs Docker `ARG` à Cloud Build afin qu'elles soient intégrées à l'image du conteneur,
  et également injectées comme variables d'environnement d'exécution.
- **NEXTCLOUD_UPDATE=1** — `occ upgrade` s'exécute automatiquement à chaque démarrage de conteneur.
  Définir sur `0` dans `environment_variables` lors de la gestion manuelle des mises à niveau
  entre les versions majeures.
- **Proxys de confiance** — `TRUSTED_PROXIES=10.0.0.0/8 172.16.0.0/12 192.168.0.0/16`
  est défini pour que Nextcloud respecte les adresses IP des clients et le schéma HTTPS derrière le
  équilibreur de charge de GKE et la couche proxy de Cloud Run.
- **OVERWRITEPROTOCOL=https** — Nextcloud génère tous les liens de partage et les points de terminaison WebDAV
  en utilisant HTTPS.
- **Câblage Redis** — lorsque `enable_redis = true`, `REDIS_HOST` et `REDIS_HOST_PORT`
  sont injectés automatiquement.
- **Câblage SMTP** — lorsque `smtp_host` n'est pas vide, `SMTP_HOST`, `SMTP_SECURE`,
  `SMTP_PORT`, `SMTP_AUTHTYPE`, `SMTP_NAME`, `MAIL_FROM_ADDRESS` et `MAIL_DOMAIN`
  sont injectés automatiquement.
- **Variables d'environnement du hook post-installation** — les ID de secret Secret Manager pour les trois secrets de configuration
  (`NC_INSTANCE_ID_SECRET_ID`, `NC_PASSWORD_SALT_SECRET_ID`,
  `NC_APP_SECRET_SECRET_ID`) et l'ID du projet GCP (`GOOGLE_CLOUD_PROJECT`) sont
  injectés afin que le hook du conteneur sache où écrire après `occ maintenance:install`.

---

## 5. Comportement de la sonde de santé {#5-health-probe-behaviour}

Les sondes par défaut ciblent `/status.php`, qui renvoie un HTTP 200 avec un objet d'état JSON
dès qu'Apache démarre — que l'assistant d'installation de Nextcloud ait été exécuté ou non.
Cela en fait le point de terminaison de santé canonique de Nextcloud.

| Sonde | Type | Chemin | Délai initial | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage | HTTP | `/status.php` | 60 s | 15 s | 40 (Cloud Run) / 20 (GKE) |
| Vivacité | HTTP | `/status.php` | 120 s | 30 s | 3 |

Les seuils généreux d'échec au démarrage existent parce que `occ maintenance:install` s'exécute
de manière synchrone au premier démarrage avant qu'Apache ne commence à accepter les connexions, et peut prendre
plusieurs minutes sur une instance Cloud SQL froide.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket `nc-data` **Cloud Storage** dédié est déclaré ici et provisionné par la
fondation dans la région de déploiement. Le compte de service de la charge de travail se voit accorder l'accès
automatiquement. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~nc-data"
```

---

## 7. Scripts {#7-scripts}

`Nextcloud_Common` contient quatre scripts dans son répertoire `scripts/` :

| Fichier | Objectif |
|---|---|
| `Dockerfile` | Image Nextcloud personnalisée étendant `nextcloud:<version>-apache`. Accepte `APP_VERSION`, `NEXTCLOUD_VERSION`, `PHP_MEMORY_LIMIT`, `UPLOAD_MAX_FILESIZE` et `POST_MAX_SIZE` comme valeurs Docker `ARG` intégrées au moment de la construction. Le tag de l'image de base provient de `NEXTCLOUD_VERSION`, pas de `APP_VERSION` — la Fondation injecte de force `APP_VERSION = application_version` (souvent `"latest"`, et `nextcloud:latest-apache` n'existe pas), donc le Dockerfile dérive son propre argument `NEXTCLOUD_VERSION` (`"latest"` mappé à `"stable"`) pour le tag `FROM`. |
| `entrypoint.sh` | Wrapper de point d'entrée : définit `NEXTCLOUD_DATA_DIR` sur `nextcloud-data` sous le montage NFS (`NFS_MOUNT_PATH`, passé depuis `nfs_mount_path` du wrapper, par défaut `/mnt/nfs`) pour les données de fichiers utilisateur, et résout `OVERWRITEHOST`/`OVERWRITECLIURL` à partir de l'URL du service au moment de l'exécution. `config.php` n'est pas lié symboliquement ou stocké sur NFS — il est reconstruit localement à partir des secrets de Secret Manager à chaque démarrage (voir la ligne "Secrets de configuration post-installation" dans le §1). |
| `db-init.sh` | Script de configuration MySQL idempotent — crée la base de données avec `utf8mb4`, crée l'utilisateur avec `mysql_native_password`, accorde les privilèges et vérifie la connectivité. |
| `post-install-config-secrets.sh` | Hook post-installation : lit `instanceid`, `passwordsalt` et `secret` depuis `config.php` de Nextcloud après `occ maintenance:install` et les écrit dans Secret Manager. |

---

Pour la configuration spécifique à Nextcloud, orientée utilisateur (variables par groupe, sorties,
et comment explorer chaque service depuis la Console et la CLI), consultez les guides de la plateforme :
**[Nextcloud_GKE](Nextcloud_GKE.md)** et **[Nextcloud_CloudRun](Nextcloud_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Nextcloud sur GKE Autopilot](Nextcloud_GKE.md) — cette configuration déployée sur GKE.
