---
title: "Speedtest Tracker Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Speedtest Tracker — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/SpeedtestTracker_Common.md @ 3055034 sha256:90ac0cdefb7c -->

# Speedtest Tracker Common — Configuration applicative partagée {#speedtest-tracker-common--shared-application-configuration}

`SpeedtestTracker_Common` est la **couche applicative partagée** de Speedtest Tracker.
Elle n'est pas déployée seule ; elle fournit la configuration propre à Speedtest
Tracker sur laquelle s'appuient à la fois [SpeedtestTracker_GKE](SpeedtestTracker_GKE.md)
et [SpeedtestTracker_CloudRun](SpeedtestTracker_CloudRun.md), afin que les deux
variantes de plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais directement cette couche — elle ne possède
aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des
plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Speedtest Tracker,
consultez les guides des plateformes ([SpeedtestTracker_GKE](SpeedtestTracker_GKE.md),
[SpeedtestTracker_CloudRun](SpeedtestTracker_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par SpeedtestTracker_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère l'`APP_KEY` Laravel (`base64:<44-char base64>`) et la stocke dans **Secret Manager** | Injectée automatiquement en tant que variable d'environnement secrète `APP_KEY` |
| Image de conteneur | Impose l'image préconstruite **`linuxserver/speedtest-tracker`** (aucun build personnalisé) | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for MySQL 8.0** comme unique moteur pris en charge | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`), qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Planification des tests de débit | Définit `SPEEDTEST_SCHEDULE` et `PRUNE_RESULTS_OLDER_THAN` — le planificateur Laravel intégré au processus qui déclenche les tests de débit automatisés | Comportement de l'application dans les guides des plateformes |
| Paramètres principaux | Définit `DB_CONNECTION = mysql`, `DB_PORT = 3306`, `APP_URL` et les noms de variables d'environnement de base de données natifs de Laravel | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les sondes par défaut de démarrage (TCP) / de vivacité (HTTP `/api/healthcheck`) | §Observabilité dans les guides des plateformes |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est jamais
défini en clair et ne doit jamais être modifié après le premier déploiement :

- **`APP_KEY`** — la clé d'application Laravel, au format `base64:<44-char base64>`
  (32 octets aléatoires, encodés en base64). Générée par `random_password` dans
  `SpeedtestTracker_Common`, stockée sous le secret
  `secret-<resource_prefix>-speedtesttracker-app-key` et injectée en tant que variable
  d'environnement secrète `APP_KEY`. Speedtest Tracker l'utilise pour chiffrer les
  données de l'application stockées sous forme chiffrée. Sa rotation après le premier
  démarrage rend ces valeurs chiffrées définitivement indéchiffrables — elle est de fait
  immuable pendant toute la durée de vie du déploiement.

Récupérez le secret après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~app-key"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`) et il est injecté en tant que `DB_PASSWORD`. Consultez
[App_Common](App_Common.md) pour le modèle partagé des secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Speedtest Tracker requiert **MySQL 8.0** (`database_type = "MYSQL_8_0"`) dans ce
module ; le moteur est fixe et PostgreSQL n'est pas pris en charge (la valeur par
défaut SQLite de l'image amont n'est jamais atteinte, car ce module câble toujours
MySQL). Lors du premier déploiement, un job ponctuel (`db-init`) s'exécute avec
`mysql:8.0-debian` et, de manière idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy ou le point de terminaison TCP et
   choisit la forme de connexion adaptée pour le client `mysql`,
2. Attend que MySQL soit joignable,
3. Crée (ou met à jour) l'utilisateur de l'application avec le mot de passe généré,
4. Crée la base de données de l'application,
5. Accorde tous les privilèges sur la base de données à l'utilisateur de l'application,
6. Vérifie que l'utilisateur de l'application peut se connecter,
7. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter proprement
   (`POST /quitquitquit`).

Le job peut être relancé sans risque (`max_retries = 3`). Inspectez directement la
base de données avec :

```bash
gcloud sql connect <instance-name> --user=speedtesttracker --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

**Remarque :** `db-init` ne provisionne que la base de données, l'utilisateur et les
droits — le schéma lui-même est créé par l'exécution automatique de
`php artisan migrate --force` par l'image au **premier démarrage du conteneur** (et
réappliqué lors des démarrages suivants pour les mises à niveau). Il n'y a pas de
job de migration distinct.

---

## 4. Image de conteneur {#4-container-image}

Speedtest Tracker est déployé à partir de l'image préconstruite officielle de
**LinuxServer.io**, `linuxserver/speedtest-tracker:<version>` — il n'y a **aucun
Cloud Build personnalisé**. Les modules Application transmettent
`container_image_source = "prebuilt"` (et `container_build_config.enabled = false`) ;
la plateforme met en miroir donc l'image dans Artifact Registry
(`enable_image_mirroring = true`) et la déploie directement.

**Solution de repli :** l'image LinuxServer utilise s6-overlay comme PID 1. Si elle se
révélait un jour incompatible avec un environnement d'exécution particulier (une
catégorie de risque documentée pour les images s6-overlay de ce dépôt — confirmée sur
Prowlarr dans le bac à sable gVisor de Cloud Run, mais pas universelle ; BookStack,
également une image LinuxServer, fonctionne bien sur Cloud Run), remplacez
`container_image` par `ghcr.io/alexjustesen/speedtest-tracker:<tag>` — l'image basée
sur Alpine, sans s6-overlay.

Speedtest Tracker étant une application Laravel, il lit les variables d'environnement
de base de données **natives de Laravel** plutôt que les variables génériques
`DB_USER`/`DB_PASS` de l'image. Les modules Application associent les valeurs de base
de données injectées par la plateforme aux noms Laravel via `db_*_env_var_name` :

- `db_user_env_var_name = "DB_USERNAME"`,
- `db_password_env_var_name = "DB_PASSWORD"`,
- `db_name_env_var_name = "DB_DATABASE"`.

`SpeedtestTracker_Common` définit en outre les valeurs statiques
`DB_CONNECTION = "mysql"` et `DB_PORT = "3306"`. `DB_HOST` diffère selon la plateforme :

- **Cloud Run** se connecte via l'**adresse IP privée** de Cloud SQL
  (`enable_cloudsql_volume = false`) ; `DB_HOST` est donc l'adresse IP privée de
  l'instance ; MySQL en TCP sur adresse IP privée ne nécessite pas SSL.
- **GKE** se connecte via le **sidecar Auth Proxy** de Cloud SQL
  (`enable_cloudsql_volume = true`) ; le câblage GKE remplace donc `DB_HOST = "127.0.0.1"`.

L'image LinuxServer exécute `php artisan migrate --force` au démarrage (voir §3) ;
aucun point d'entrée personnalisé n'est donc nécessaire pour créer le schéma.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`SpeedtestTracker_Common` établit l'environnement de base de Speedtest Tracker afin que
l'application démarre correctement dès le premier lancement :

- **Connexion à la base de données** — `DB_CONNECTION = "mysql"`, `DB_PORT = "3306"` ;
  les variables natives de Laravel `DB_USERNAME` / `DB_PASSWORD` / `DB_DATABASE` ainsi
  que `DB_HOST` sont injectées par le socle (voir §4).
- **URL de l'application** — `APP_URL` est défini à partir de l'URL prévue du service,
  afin que les liens, les ressources statiques et les redirections pointent vers
  l'adresse réelle.
- **Planification des tests de débit** — `SPEEDTEST_SCHEDULE` (par défaut
  `"0 * * * *"`, toutes les heures) pilote le planificateur Laravel intégré au processus
  de Speedtest Tracker, qui déclenche un test de débit automatisé indépendamment de
  toute requête HTTP entrante. C'est pourquoi la variante Cloud Run utilise par défaut
  `cpu_always_allocated = true` et `min_instance_count = 1` — la même catégorie
  d'exigence que pour n8n/Kestra dans ce catalogue.
- **Élagage des résultats** — `PRUNE_RESULTS_OLDER_THAN` (par défaut `"0"`, désactivé)
  supprime automatiquement les résultats de tests de débit antérieurs au nombre de
  jours configuré.
- **Redis (facultatif)** — lorsque Redis est activé via les paramètres du déploiement
  de la plateforme, `REDIS_HOST` et `REDIS_PORT` sont injectés ; sinon, Speedtest
  Tracker utilise son pilote de cache local file/sync, ce qui convient à un
  déploiement à instance unique.
- **Configuration au premier lancement** — l'interface web de Speedtest Tracker guide
  la création du compte lors de la première visite ; il n'existe aucun compte
  administrateur par défaut préchargé.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut s'appuient sur la surface de santé publique de Speedtest Tracker :

- **Démarrage** — un contrôle TCP sur le port `80`, qui réussit dès que le serveur web
  PHP se lie à son port.
- **Vivacité** — un HTTP `GET /api/healthcheck`, le **point de terminaison de santé
  JSON non authentifié** de Speedtest Tracker (renvoie 200 avec un message JSON). Une
  fenêtre généreuse pour le premier démarrage (délai initial de 300 secondes) laisse le
  temps à l'exécution automatique de `php artisan migrate --force` lors du premier
  démarrage du conteneur.

> Sur la variante GKE, la valeur par défaut fournie de `liveness_probe` pointe déjà vers
> `/api/healthcheck` — aucun remplacement n'est nécessaire pour un signalement de santé
> exact.

---

## 7. Stockage d'objets {#7-object-storage}

Speedtest Tracker stocke tous les résultats et la configuration dans Cloud SQL (MySQL)
et ne dispose d'aucun flux de téléversement de fichiers par les utilisateurs comparable
aux pièces jointes de BookStack ; **aucun bucket GCS n'est donc provisionné par
défaut** (la sortie `storage_buckets` est une liste vide). Si vous devez conserver
`/config` (par ex. des certificats SSL personnalisés) d'un redémarrage à l'autre,
activez NFS via les variables de stockage des groupes 11/13 de la plateforme.

---

Pour la configuration propre à Speedtest Tracker destinée aux utilisateurs (variables
par groupe, sorties, et comment explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[SpeedtestTracker_GKE](SpeedtestTracker_GKE.md)**
et **[SpeedtestTracker_CloudRun](SpeedtestTracker_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Speedtest Tracker sur Google Cloud Run](SpeedtestTracker_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Speedtest Tracker sur GKE Autopilot](SpeedtestTracker_GKE.md) — cette configuration déployée sur GKE.
