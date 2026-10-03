---
title: "Speedtest Tracker Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Speedtest Tracker — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/SpeedtestTracker_Common.md @ 15fd4c7 sha256:157e7ae09e4e -->

# Speedtest Tracker Common — Configuration d'application partagée {#speedtest-tracker-common--shared-application-configuration}

`SpeedtestTracker_Common` est la **couche d'application partagée** pour Speedtest Tracker. Elle n'est pas déployée seule ; elle fournit plutôt la configuration spécifique à Speedtest Tracker sur laquelle s'appuient [SpeedtestTracker_GKE](SpeedtestTracker_GKE.md) et [SpeedtestTracker_CloudRun](SpeedtestTracker_CloudRun.md), de sorte que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a pas d'entrées d'interface utilisateur de déploiement propres — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute réellement Speedtest Tracker, consultez les guides de plateforme ([SpeedtestTracker_GKE](SpeedtestTracker_GKE.md), [SpeedtestTracker_CloudRun](SpeedtestTracker_CloudRun.md)) et les guides de base ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par SpeedtestTracker_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère la clé Laravel `APP_KEY` (`base64:<44-char base64>`) et la stocke dans **Secret Manager** | Injecté automatiquement comme variable d'environnement secrète `APP_KEY` |
| Image de conteneur | Fixe l'image pré-construite **`linuxserver/speedtest-tracker`** (pas de build personnalisé) | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour MySQL 8.0** comme seul moteur supporté | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job de premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les autorisations | Sortie `initialization_jobs` |
| Planification des tests de vitesse | Définit `SPEEDTEST_SCHEDULE` et `PRUNE_RESULTS_OLDER_THAN` — le planificateur Laravel intégré qui déclenche des tests de vitesse automatisés | Comportement de l'application dans les guides de plateforme |
| Paramètres de base | Définit `DB_CONNECTION = mysql`, `DB_PORT = 3306`, `APP_URL`, et les noms de variables d'environnement de base de données natifs de Laravel | Comportement de l'application dans les guides de plateforme |
| Sondes de santé | Fournit les sondes de démarrage (TCP) / de vivacité (HTTP `/api/healthcheck`) par défaut | §Observabilité dans les guides de plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est jamais défini en texte clair et ne doit jamais être modifié après le premier déploiement :

- **`APP_KEY`** — la clé d'application Laravel, au format `base64:<44-char base64>` (32 octets aléatoires, encodés en base64). Générée par `random_password` dans `SpeedtestTracker_Common`, stockée comme secret `secret-<resource_prefix>-speedtesttracker-app-key`, et injectée comme variable d'environnement secrète `APP_KEY`. Speedtest Tracker l'utilise pour chiffrer les données d'application stockées chiffrées. La faire pivoter après le premier démarrage rend ces valeurs chiffrées indéchiffrables de manière permanente — elle est effectivement immuable pendant toute la durée de vie du déploiement.

Récupérez le secret après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~app-key"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par la fondation ; son nom de secret est rapporté dans les sorties de déploiement de la plateforme (`database_password_secret`) et il est injecté comme `DB_PASSWORD`. Voir [App_Common](App_Common.md) pour le secret partagé et le modèle Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Speedtest Tracker nécessite **MySQL 8.0** (`database_type = "MYSQL_8_0"`) dans ce module ; le moteur est fixe et PostgreSQL n'est pas supporté (le défaut SQLite de l'image amont n'est jamais atteint, car ce module connecte toujours MySQL). Lors du premier déploiement, un job unique (`db-init`) s'exécute en utilisant `mysql:8.0-debian` et de manière idempotente :

1. Détecte le socket Unix du proxy d'authentification Cloud SQL ou le point de terminaison TCP et sélectionne la bonne forme de connexion pour le client `mysql`,
2. Attend que MySQL soit accessible,
3. Crée (ou met à jour) l'utilisateur de l'application avec le mot de passe généré,
4. Crée la base de données de l'application,
5. Accorde tous les privilèges sur la base de données à l'utilisateur de l'application,
6. Vérifie que l'utilisateur de l'application peut se connecter,
7. Signale au sidecar du proxy d'authentification Cloud SQL de s'arrêter gracieusement (`POST /quitquitquit`).

Le job peut être relancé en toute sécurité (`max_retries = 3`). Inspectez la base de données directement avec :

```bash
gcloud sql connect <instance-name> --user=speedtesttracker --database=<db-name> --project "$PROJECT"
```

Les noms d'instance, de base de données et d'utilisateur se trouvent dans les sorties de déploiement de la plateforme.

**Note :** `db-init` provisionne uniquement la base de données, l'utilisateur et les autorisations — le schéma lui-même est créé par le `php artisan migrate --force` automatique de l'image lors du **premier démarrage du conteneur** (et réappliqué lors des démarrages ultérieurs pour les mises à niveau). Il n'y a pas de job de migration séparé.

---

## 4. Image de conteneur {#4-container-image}

Speedtest Tracker est déployé à partir de l'image pré-construite officielle de **LinuxServer.io**, `linuxserver/speedtest-tracker:<version>` — il n'y a **pas de Cloud Build personnalisé**. Les modules d'application transmettent `container_image_source = "prebuilt"` (et `container_build_config.enabled = false`), de sorte que la plateforme met en miroir l'image dans Artifact Registry (`enable_image_mirroring = true`) et la déploie directement.

**Solution de repli :** l'image LinuxServer utilise s6-overlay comme PID 1. Si elle s'avère incompatible avec un environnement d'exécution spécifique (une classe de risque documentée pour les images s6-overlay dans ce dépôt — confirmée sur Prowlarr sous le sandbox gVisor de Cloud Run, bien que non universelle ; BookStack, également LinuxServer, fonctionne bien sur Cloud Run), remplacez `container_image` par `ghcr.io/alexjustesen/speedtest-tracker:<tag>` — l'image basée sur Alpine sans s6-overlay.

Étant donné que Speedtest Tracker est une application Laravel, elle lit les variables d'environnement de base de données **natives de Laravel** plutôt que les génériques `DB_USER`/`DB_PASS` de l'image. Les modules d'application mappent les valeurs de base de données injectées par la plateforme sur les noms Laravel via `db_*_env_var_name` :

- `db_user_env_var_name = "DB_USERNAME"`,
- `db_password_env_var_name = "DB_PASSWORD"`,
- `db_name_env_var_name = "DB_DATABASE"`.

`SpeedtestTracker_Common` définit en outre les statiques `DB_CONNECTION = "mysql"` et `DB_PORT = "3306"`. `DB_HOST` diffère selon la plateforme :

- **Cloud Run** se connecte via l'**IP privée** de Cloud SQL (`enable_cloudsql_volume = false`), donc `DB_HOST` est l'IP privée de l'instance ; MySQL via TCP sur IP privée n'a pas besoin de SSL.
- **GKE** se connecte via le **sidecar du proxy d'authentification** Cloud SQL (`enable_cloudsql_volume = true`), donc le câblage GKE remplace `DB_HOST = "127.0.0.1"`.

L'image LinuxServer exécute `php artisan migrate --force` au démarrage (voir §3), donc aucun point d'entrée personnalisé n'est nécessaire pour créer le schéma.

---

## 5. Paramètres d'application de base {#5-core-application-settings}

`SpeedtestTracker_Common` établit l'environnement de base de Speedtest Tracker afin que l'application démarre correctement au premier lancement :

- **Connexion à la base de données** — `DB_CONNECTION = "mysql"`, `DB_PORT = "3306"` ; les variables natives de Laravel `DB_USERNAME` / `DB_PASSWORD` / `DB_DATABASE` et `DB_HOST` sont injectées par la fondation (voir §4).
- **URL de l'application** — `APP_URL` est l'URL publique du service afin que les liens dans les notifications et les redirections se résolvent à l'adresse réelle : l'URL `run.app` prédite sur Cloud Run, et sur GKE le placeholder `$(GKE_SERVICE_URL)`, que la fondation résout à l'adresse de l'équilibreur de charge au moment du déploiement.
- **Planification des tests de vitesse** — `SPEEDTEST_SCHEDULE` (par défaut `"0 * * * *"`, toutes les heures) pilote le planificateur Laravel intégré de Speedtest Tracker, qui déclenche un test de vitesse automatisé indépendant de toute requête HTTP entrante. C'est pourquoi la variante Cloud Run par défaut `cpu_always_allocated = true` et `min_instance_count = 1` — la même classe d'exigence que n8n/Kestra dans ce catalogue.
- **Élagage des résultats** — `PRUNE_RESULTS_OLDER_THAN` (par défaut `"0"`, désactivé) supprime automatiquement les résultats des tests de vitesse plus anciens que le nombre de jours configuré.
- **Redis (facultatif)** — lorsque Redis est activé via les paramètres de déploiement de la plateforme, `REDIS_HOST` et `REDIS_PORT` sont injectés ; sinon, Speedtest Tracker utilise son pilote de cache local fichier/synchronisation, ce qui convient pour un déploiement à instance unique.
- **Configuration initiale** — l'interface utilisateur web de Speedtest Tracker guide la création de compte lors de la première visite ; il n'y a pas de compte administrateur par défaut pré-rempli.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut s'appuient sur la surface de santé publique de Speedtest Tracker :

- **Démarrage** — une vérification TCP sur le port `80`, qui passe dès que le serveur web PHP lie son port.
- **Vivacité** — un `GET /api/healthcheck` HTTP, le **point de terminaison de santé JSON non authentifié** de Speedtest Tracker (renvoie 200 avec un message JSON). Une fenêtre de premier démarrage généreuse (délai initial de 300 secondes) permet le `php artisan migrate --force` automatique qui s'exécute au premier démarrage du conteneur.

> Sur la variante GKE, la valeur par défaut `liveness_probe` fournie pointe déjà vers `/api/healthcheck` — aucune surcharge n'est nécessaire pour une signalisation de santé précise.

---

## 7. Stockage d'objets {#7-object-storage}

Speedtest Tracker stocke tous les résultats et la configuration dans Cloud SQL (MySQL) et n'a pas de flux de travail de téléchargement de fichiers utilisateur analogue aux pièces jointes de BookStack, donc **aucun bucket GCS n'est provisionné par défaut** (la sortie `storage_buckets` est une liste vide). Si vous avez besoin de persister `/config` (par exemple, des certificats SSL personnalisés) après les redémarrages, activez NFS via les variables de stockage du groupe 11/13 de la plateforme.

---

Pour la configuration spécifique à Speedtest Tracker, orientée utilisateur (variables par groupe, sorties et comment explorer chaque service depuis la Console et la CLI), consultez les guides de plateforme : **[SpeedtestTracker_GKE](SpeedtestTracker_GKE.md)** et **[SpeedtestTracker_CloudRun](SpeedtestTracker_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Speedtest Tracker sur Google Cloud Run](SpeedtestTracker_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Speedtest Tracker sur GKE Autopilot](SpeedtestTracker_GKE.md) — cette configuration déployée sur GKE.
