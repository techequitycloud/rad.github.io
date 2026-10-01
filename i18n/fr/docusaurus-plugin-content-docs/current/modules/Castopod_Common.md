---
title: "Castopod Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Castopod — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Castopod_Common.md @ 3055034 sha256:f5d75cb31924 -->

# Castopod Common — Configuration applicative partagée {#castopod-common--shared-application-configuration}

`Castopod_Common` est la **couche applicative partagée** de Castopod. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Castopod sur laquelle s'appuient
[Castopod_GKE](Castopod_GKE.md) et [Castopod_CloudRun](Castopod_CloudRun.md), afin que les
deux variantes de plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais directement cette couche — elle n'a aucun champ de
déploiement qui lui soit propre dans l'interface — mais comprendre ce qu'elle fournit explique
les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Castopod, consultez les guides des
plateformes ([Castopod_GKE](Castopod_GKE.md), [Castopod_CloudRun](Castopod_CloudRun.md)) et
les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Castopod_Common | Où cela apparaît |
|---|---|---|
| Secret cryptographique | Génère `CP_ANALYTICS_SALT` (32 caractères) et le stocke dans **Secret Manager** | Injecté automatiquement en tant que variable d'environnement secrète du conteneur ; récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Build personnalisé léger **FROM `castopod/castopod`** qui greffe un point d'entrée de surcouche de la plateforme ; construit via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for MySQL 8.0** (`database_type = "MYSQL_8_0"`) comme moteur | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `media` pour les médias des podcasts | Sortie `storage_buckets` |
| Paramètres principaux | Définit l'environnement de base de Castopod : gestionnaire de cache, port et préfixe de la base, URL de base | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde de démarrage TCP et la sonde de vivacité HTTP `/` par défaut | §Observabilité dans les guides des plateformes |

---

## 2. Secret cryptographique dans Secret Manager {#2-cryptographic-secret-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est jamais défini en
clair et **ne doit jamais être modifié après le premier déploiement** :

- **`CP_ANALYTICS_SALT`** — une chaîne aléatoire de 32 caractères utilisée pour anonymiser les
  statistiques de podcast intégrées à Castopod (les IP et identifiants des auditeurs sont
  hachés avec ce sel). Il doit rester constant entre les redémarrages et les réplicas afin que
  les identifiants hachés concordent dans le temps — c'est pourquoi il est généré une seule
  fois et stocké dans Secret Manager plutôt que créé à l'exécution. Le renouveler ne corrompt
  pas les lignes existantes, mais rompt la continuité de la déduplication des statistiques pour
  les auditeurs déjà enregistrés.

Le secret est nommé `secret-<resource-prefix>-<application_name>-analytics-salt`.
Récupérez-le après le déploiement :

```bash
# List the analytics-salt secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~analytics-salt"

# Read the secret value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le nom
de son secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle partagé des
secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Castopod nécessite **MySQL** ; le moteur est fixé à `MYSQL_8_0` et PostgreSQL ou les autres
moteurs ne sont pas pris en charge. Lors du premier déploiement, un job ponctuel (`db-init`)
s'exécute avec `mysql:8.0-debian` et, de manière idempotente :

1. Résout la connexion Cloud SQL — il privilégie le socket Unix du Cloud SQL Auth Proxy sous
   `/cloudsql` lorsqu'il est monté, et se replie sinon sur une connexion TCP à l'IP privée
   (`DB_IP`),
2. Attend que le port MySQL 3306 soit accessible (chemin TCP),
3. Crée (ou met à jour) l'utilisateur de l'application avec le mot de passe généré
   (`CREATE USER IF NOT EXISTS … ALTER USER …`),
4. Crée la base de données de l'application (`CREATE DATABASE IF NOT EXISTS`),
5. Accorde tous les privilèges sur cette base à l'utilisateur de l'application,
6. Vérifie que l'utilisateur de l'application peut réellement se connecter — ce qui préchauffe
   aussi le cache d'authentification `caching_sha2_password` côté serveur, afin que les
   connexions PHP suivantes empruntent le chemin d'authentification rapide,
7. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter proprement (via le point de
   terminaison d'administration `quitquitquit`).

Le job est marqué `execute_on_apply = true` et peut être relancé sans risque. **Il n'y a pas
de job de migration distinct — mais c'est parce que le point d'entrée de la surcouche de la
plateforme exécute explicitement la migration, et non parce que l'image de base le fait
automatiquement.** L'image `castopod/castopod` (construite sur `serversideup/php`) n'a pas de
hook de migration CodeIgniter propre — son seul comportement de migration automatique intégré
est spécifique à Laravel (`php artisan migrate`, conditionné par `AUTORUN_ENABLED`, qui vaut
`false` par défaut), et elle ne saurait pas exécuter le `spark migrate` de CI4 même s'il était
activé. À la place, `Castopod_Common/scripts/entrypoint.sh` (voir §4) exécute explicitement `php spark migrate
--all` — idempotent, sans risque à chaque démarrage — une fois `.env`/la connectivité à la
base en place ; le schéma (`cp_settings`, `cp_users`, etc.) est donc créé au premier
démarrage, après que `db-init` a provisionné la base et l'utilisateur. Une régression qui
supprime cet appel explicite (par exemple en supposant que l'image migre d'elle-même) se
manifeste par une erreur 500 sur chaque requête avec `Table '...' doesn't exist`, alors même
que `db-init` a réussi — vérifiez d'abord `entrypoint.sh`, et non l'image de base, lorsque
vous diagnostiquez ce symptôme.

Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base et de l'utilisateur figurent dans les sorties du
déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est un **build léger FROM `castopod/castopod:<version>`** (la valeur
par défaut de la campagne, `latest`, est épinglée sur la version stable actuelle, `1.15.5`,
pour des builds reproductibles). Le tag de base est fourni via l'ARG de build propre à
l'application `CASTOPOD_VERSION` — **et non** via le `APP_VERSION` générique, que le socle
écraserait sinon par `latest` en l'emportant lors de la fusion des `build_args`. L'image greffe
un petit point d'entrée de surcouche de la plateforme (`entrypoint.sh`) qui écrit la
configuration de base de données de CI4, exécute explicitement le `spark migrate --all` de
CodeIgniter (voir §3 — l'image amont ne le fait pas d'elle-même), et seulement ensuite délègue
au point d'entrée FrankenPHP/Caddy amont, qui sert le HTTP sur `:8080` :

- **Matérialise la configuration de base de données native de CI4 dans le fichier `.env` de Castopod.** Castopod
  est une application CodeIgniter 4 et lit sa connexion par défaut depuis les clés natives du framework, **en notation pointée**, `database.default.hostname|database|username|password|port|
  DBDriver|DBPrefix`. Les noms de variables d'environnement Cloud Run/GKE ne peuvent pas
  contenir de points ; la plateforme ne peut donc pas les injecter en tant que variables
  d'environnement du conteneur — le point d'entrée les écrit par conséquent dans `.env`
  (chargé par CI4 au démarrage) à partir des `DB_HOST`/`DB_IP`/
  `DB_NAME`/`DB_USER`/`DB_PASSWORD` injectés par le socle. Sans cela, Castopod se
  connecte à `localhost` et chaque route adossée à la base (y compris `/`) renvoie une erreur
  500.
- **Résout un hôte de base de données TCP.** Le pilote `mysqli` de CI4 a besoin d'un véritable
  hôte TCP, et non d'un répertoire de socket Cloud SQL. Si `DB_HOST` est un chemin de socket
  (commençant par `/`), le point d'entrée utilise `DB_IP` (TCP sur l'IP privée, sans SSL requis
  pour MySQL) ; sur GKE, `DB_HOST` vaut déjà `127.0.0.1` (le sidecar Auth Proxy) et est
  utilisé directement.
- **Dérive `CP_BASEURL`.** Castopod a besoin de son URL de base publique. Lorsqu'elle n'est pas
  définie explicitement, le point d'entrée la dérive du `GKE_SERVICE_URL` ou du
  `CLOUDRUN_SERVICE_URL` injecté par le socle et l'écrit sous `app.baseURL` dans `.env`.
- **Exécute explicitement les migrations CodeIgniter** (`php spark migrate --all`) une fois
  `.env`/la connectivité à la base en place — voir §3 pour comprendre pourquoi cela doit être
  explicite plutôt que supposé automatique.
- **Découvre le point d'entrée amont et lui délègue**, en lançant par exec le serveur
  FrankenPHP/Caddy (`frankenphp run --config /etc/frankenphp/Caddyfile`).

L'image crée également à l'avance `/var/www/castopod/public/media`, afin que la cible de
montage des médias existe quelle que soit l'organisation de l'image de base.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Castopod_Common` établit l'environnement de base de Castopod afin que l'application démarre
correctement dès le premier lancement :

- **Gestionnaire de cache** — `CP_CACHE_HANDLER = "file"` par défaut (cache sur le système de
  fichiers). Redis peut être activé via les paramètres du déploiement de la plateforme, ce qui
  injecte `REDIS_HOST` / `REDIS_PORT`.
- **Raccordement à la base de données** — `CP_DATABASE_PORT = "3306"` et
  `CP_DATABASE_PREFIX = "cp_"` (préfixe des tables de Castopod). Les clés
  `database.default.*` sont écrites dans `.env` par le point d'entrée, comme décrit
  ci-dessus.
- **URL de base** — `CP_BASEURL` est définie à partir de l'URL prévue du service lorsqu'elle
  est disponible, puis corrigée à l'exécution par le point d'entrée.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Castopod sert sur `/` une page d'accueil non authentifiée qui renvoie HTTP 200 une fois
l'application démarrée et connectée à MySQL ; les sondes la ciblent donc directement :

- **Sonde de démarrage** — **TCP** sur le port du conteneur, avec un délai initial de
  30 secondes et une fenêtre de 20 tentatives, ce qui laisse amplement le temps aux migrations
  CodeIgniter du premier démarrage de se terminer.
- **Sonde de vivacité** — **HTTP `GET /`** avec un délai initial de 300 secondes (5 minutes) et
  une période de 60 secondes, cohérente avec la page d'accueil de Castopod qui renvoie 200
  après le démarrage.

---

## 7. Stockage d'objets et persistance des médias {#7-object-storage-and-media-persistence}

Un bucket **Cloud Storage** dédié (suffixe `media`) est déclaré ici et provisionné par le
socle, qui accorde également l'accès au compte de service de la charge de travail.
Castopod stocke l'audio des épisodes de podcast, les illustrations de couverture et les autres
fichiers téléversés sous `/var/www/castopod/public/media` ; les deux variantes de plateforme
activent en outre un système de fichiers partagé (**Cloud Filestore / NFS**,
`enable_nfs = true` par défaut) afin que ces fichiers survivent aux redémarrages du conteneur
et soient partagés entre les réplicas. Listez le bucket avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~media"
```

---

Pour la configuration de Castopod destinée aux utilisateurs (variables par groupe, sorties et
manière d'explorer chaque service depuis la console et la CLI), consultez les guides des
plateformes : **[Castopod_GKE](Castopod_GKE.md)** et **[Castopod_CloudRun](Castopod_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Castopod sur Google Cloud Run](Castopod_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Castopod sur GKE Autopilot](Castopod_GKE.md) — cette configuration déployée sur GKE.
