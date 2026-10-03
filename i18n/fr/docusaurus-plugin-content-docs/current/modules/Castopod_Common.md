---
title: "Castopod Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Castopod — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Castopod_Common.md @ 15fd4c7 sha256:6606089c299c -->

# Castopod Common — Configuration d'application partagée {#castopod-common--shared-application-configuration}

`Castopod_Common` est la **couche d'application partagée** pour Castopod. Elle n'est pas
déployée seule ; elle fournit plutôt la configuration spécifique à Castopod que
[Castopod_GKE](Castopod_GKE.md) et [Castopod_CloudRun](Castopod_CloudRun.md)
utilisent, de sorte que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a pas d'entrées d'interface utilisateur de déploiement propres — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute Castopod, consultez les guides de la plateforme ([Castopod_GKE](Castopod_GKE.md), [Castopod_CloudRun](Castopod_CloudRun.md))
et les guides de base ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Castopod_Common | Où cela apparaît |
|---|---|---|
| Secret cryptographique | Génère `CP_ANALYTICS_SALT` (32 caractères) et le stocke dans **Secret Manager** | Injecté automatiquement comme variable d'environnement secrète de conteneur ; récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Build personnalisé léger **FROM `castopod/castopod`** qui greffe un point d'entrée de wrapper de plateforme ; builds via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour MySQL 8.0** (`database_type = "MYSQL_8_0"`) comme moteur | §Base de données dans les guides de la plateforme |
| Amorçage de la base de données | Définit le job de premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les autorisations | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `media` pour les médias de podcast | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement de base de Castopod : gestionnaire de cache, port/préfixe de la base de données, URL de base | Comportement de l'application dans les guides de la plateforme |
| Sondes de santé | Fournit la sonde de démarrage TCP par défaut et la sonde de vivacité HTTP `/` | §Observabilité dans les guides de la plateforme |

---

## 2. Secret cryptographique dans Secret Manager {#2-cryptographic-secret-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est jamais défini
en texte clair et **ne doit jamais être modifié après le premier déploiement** :

- **`CP_ANALYTICS_SALT`** — une chaîne aléatoire de 32 caractères utilisée pour anonymiser les
  analyses de podcast intégrées de Castopod (les adresses IP et identifiants des auditeurs sont hachés avec ce sel).
  Elle doit rester constante à travers les redémarrages et les réplicas afin que les identifiants hachés
  correspondent dans le temps — c'est pourquoi elle est générée une fois et stockée dans Secret Manager
  plutôt que d'être créée à l'exécution. La faire pivoter ne corrompt pas les lignes existantes mais rompt
  la continuité de la déduplication des analyses pour les auditeurs précédemment enregistrés.

Le secret est nommé `secret-<resource-prefix>-<application_name>-analytics-salt`.
Récupérez-le après le déploiement :

```bash
# List the analytics-salt secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~analytics-salt"

# Read the secret value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par la fondation ; son
nom de secret est rapporté dans les sorties de déploiement de la plateforme (`database_password_secret`).
Voir [App_Common](App_Common.md) pour le secret partagé et le modèle Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Castopod nécessite **MySQL** ; le moteur est fixé à `MYSQL_8_0` et PostgreSQL ou
d'autres moteurs ne sont pas pris en charge. Lors du premier déploiement, un job unique (`db-init`)
s'exécute en utilisant `mysql:8.0-debian` et de manière idempotente :

1. Résout la connexion Cloud SQL — il préfère le socket Unix du proxy d'authentification Cloud SQL
   sous `/cloudsql` lorsqu'il est monté, sinon il revient à une connexion TCP IP privée
   (`DB_IP`),
2. Attend que le port MySQL 3306 soit accessible (chemin TCP),
3. Crée (ou met à jour) l'utilisateur de l'application avec le mot de passe généré
   (`CREATE USER IF NOT EXISTS … ALTER USER …`),
4. Crée la base de données de l'application (`CREATE DATABASE IF NOT EXISTS`),
5. Accorde tous les privilèges sur cette base de données à l'utilisateur de l'application,
6. Vérifie que l'utilisateur de l'application peut réellement se connecter — cela réchauffe également le
   cache d'authentification côté serveur `caching_sha2_password` afin que les connexions PHP ultérieures utilisent
   le chemin d'authentification rapide,
7. Signale au sidecar du proxy d'authentification Cloud SQL de s'arrêter gracieusement (via le
   point de terminaison d'administration `quitquitquit`).

Le job est marqué `execute_on_apply = true` et peut être réexécuté en toute sécurité. **Il n'y a pas
de job de migration séparé — mais c'est parce que le point d'entrée du wrapper de plateforme exécute la
migration explicitement, et non parce que l'image de base le fait automatiquement.** L'image
`castopod/castopod` (construite sur `serversideup/php`) n'a pas de hook de migration CodeIgniter
propre — son seul comportement de migration automatique intégré est spécifique à Laravel
(`php artisan migrate`, protégé par `AUTORUN_ENABLED`, qui par défaut est `false`), et
il ne saurait pas comment exécuter `spark migrate` de CI4 même s'il était activé. Au lieu de cela,
`Castopod_Common/scripts/entrypoint.sh` (voir §4) exécute explicitement `php spark migrate
--all` — idempotent, sûr à chaque démarrage — une fois que la connectivité `.env`/DB est en place, de sorte que
le schéma (`cp_settings`, `cp_users`, etc.) est créé au premier démarrage après que `db-init`
a provisionné la base de données et l'utilisateur. Une régression qui supprime cet appel explicite
(par exemple, en supposant que l'image migre d'elle-même) se reproduit avec chaque requête renvoyant 500 avec
`Table '...' doesn't exist`, même si `db-init` a réussi — vérifiez `entrypoint.sh`
en premier, pas l'image de base, lors du débogage de ce symptôme.

Inspectez la base de données directement avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms d'instance, de base de données et d'utilisateur se trouvent dans les sorties de déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est un **build léger FROM `castopod/castopod:<version>`** (le
`latest` par défaut de la campagne est épinglé à la version stable actuelle, `1.15.5`, pour des
builds reproductibles). Le tag de base est fourni via l'ARG de build `CASTOPOD_VERSION` spécifique à l'application — **pas**
le générique `APP_VERSION`, que la fondation écraserait autrement en `latest` et
gagnerait la fusion `build_args`. L'image greffe un petit point d'entrée de wrapper de plateforme
(`entrypoint.sh`) qui écrit la configuration de la base de données CI4, exécute explicitement
`spark migrate --all` de CodeIgniter (voir §3 — l'image amont ne le fait pas d'elle-même), et
délègue ensuite au point d'entrée amont FrankenPHP/Caddy, qui sert HTTP sur
`:8080` :

- **Matérialise la configuration de base de données native CI4 dans le fichier `.env` de Castopod.** Castopod
  est CodeIgniter 4 et lit sa connexion par défaut à partir des clés natives du framework,
  **notées par points** `database.default.hostname|database|username|password|port|
  DBDriver|DBPrefix`. Les noms de variables d'environnement Cloud Run/GKE ne peuvent pas contenir de points, donc la plateforme
  ne peut pas les injecter comme variables d'environnement de conteneur — le point d'entrée les écrit donc dans
  `.env` (chargé par CI4 au démarrage) à partir des `DB_HOST`/`DB_IP`/
  `DB_NAME`/`DB_USER`/`DB_PASSWORD` injectées par la fondation. Sans cela, Castopod se connecte à `localhost` et
  chaque route basée sur la base de données (y compris `/`) renvoie 500.
- **Résout un hôte de base de données TCP.** Le pilote `mysqli` de CI4 a besoin d'un véritable hôte TCP, pas d'un
  répertoire de socket Cloud SQL. Si `DB_HOST` est un chemin de socket (commence par `/`), le
  point d'entrée utilise `DB_IP` (TCP IP privée, pas de SSL requis pour MySQL) ; sur GKE `DB_HOST`
  est déjà `127.0.0.1` (le sidecar du proxy d'authentification) et est utilisé directement.
- **Dérive `CP_BASEURL`.** Castopod nécessite son URL de base publique. Lorsqu'elle n'est pas explicitement
  définie, le point d'entrée la dérive de `GKE_SERVICE_URL` ou
  `CLOUDRUN_SERVICE_URL` injectées par la fondation et l'écrit comme `app.baseURL` dans `.env`.
- **Exécute explicitement les migrations CodeIgniter** (`php spark migrate --all`) une fois que la connectivité `.env`/DB
  est en place — voir §3 pour savoir pourquoi cela doit être explicite plutôt que supposé
  automatique.
- **Découvre et délègue au point d'entrée amont**, exécutant le serveur FrankenPHP/Caddy
  (`frankenphp run --config /etc/frankenphp/Caddyfile`).

L'image pré-crée également `/var/www/html/public/media` (la racine de l'application est
`/var/www/html`, pas le `/var/www/castopod` presque vide de l'image), et le point d'entrée
réinitialise l'arborescence des médias à cet endroit au démarrage, car un volume fraîchement attaché se monte vide.

---

## 5. Paramètres d'application de base {#5-core-application-settings}

`Castopod_Common` établit l'environnement Castopod de base afin que l'application
démarre correctement au premier lancement :

- **Gestionnaire de cache** — `CP_CACHE_HANDLER = "file"` par défaut (cache de système de fichiers). Redis
  peut être activé via les paramètres de déploiement de la plateforme, ce qui injecte `REDIS_HOST` /
  `REDIS_PORT`.
- **Câblage de la base de données** — `CP_DATABASE_PORT = "3306"` et `CP_DATABASE_PREFIX = "cp_"`
  (préfixe de table Castopod). Les clés `database.default.*` sont écrites dans `.env` par le
  point d'entrée comme décrit ci-dessus.
- **URL de base** — `CP_BASEURL` est définie à partir de l'URL de service prédite lorsqu'elle est disponible et
  corrigée à l'exécution par le point d'entrée.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Castopod sert une page d'accueil non authentifiée à `/` qui renvoie HTTP 200 une fois que l'application
a démarré et s'est connectée à MySQL, de sorte que les sondes la ciblent directement :

- **Sonde de démarrage** — **TCP** sur le port du conteneur avec un délai initial de 30 secondes et
  une fenêtre de 20 tentatives, donnant aux migrations CodeIgniter du premier démarrage amplement le temps de se terminer.
- **Sonde de vivacité** — **HTTP `GET /`** avec un délai initial de 300 secondes (5 minutes) et
  une période de 60 secondes, correspondant à la page d'accueil de Castopod renvoyant 200 après le démarrage.

---

## 7. Stockage d'objets et persistance des médias {#7-object-storage-and-media-persistence}

Un bucket **Cloud Storage** dédié (suffixe `media`) est déclaré ici et provisionné
par la fondation, qui accorde également l'accès au compte de service de la charge de travail. Castopod
stocke l'audio des épisodes de podcast, les pochettes et autres téléchargements sous
`/var/www/html/public/media` ; les deux variantes de plateforme activent en outre un système de fichiers partagé
(**Cloud Filestore / NFS**, `enable_nfs = true` par défaut, monté à ce chemin) afin que ces téléchargements
survivent aux redémarrages des conteneurs et soient partagés entre les réplicas. Listez le bucket avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~media"
```

---

Pour la configuration spécifique à Castopod, orientée utilisateur (variables par groupe, sorties et
comment explorer chaque service depuis la Console et la CLI), consultez les guides de la plateforme :
**[Castopod_GKE](Castopod_GKE.md)** et **[Castopod_CloudRun](Castopod_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Castopod sur Google Cloud Run](Castopod_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Castopod sur GKE Autopilot](Castopod_GKE.md) — cette configuration déployée sur GKE.
