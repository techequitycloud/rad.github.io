---
title: "OpenProject Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module OpenProject — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/OpenProject_Common.md @ 3055034 sha256:dc96fd5bbee1 -->

# OpenProject Common — Configuration applicative partagée {#openproject-common--shared-application-configuration}

`OpenProject_Common` est la **couche applicative partagée** d'OpenProject. Elle n'est
pas déployée seule ; elle fournit la configuration propre à OpenProject sur laquelle
reposent à la fois [OpenProject_GKE](OpenProject_GKE.md) et
[OpenProject_CloudRun](OpenProject_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux
ne configurent jamais cette couche directement — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par
défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement OpenProject, consultez les
guides de plateforme ([OpenProject_GKE](OpenProject_GKE.md),
[OpenProject_CloudRun](OpenProject_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par OpenProject_Common | Où cela apparaît |
|---|---|---|
| Secret cryptographique | Génère `SECRET_KEY_BASE` (64 octets aléatoires → 128 caractères hexadécimaux) et le stocke dans **Secret Manager** | Injecté automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Enveloppe l'image tout-en-un officielle `openproject/openproject` avec un `cloud-entrypoint.sh` personnalisé ; build via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit les jobs du premier déploiement (`db-init` → `db-migrate`) qui créent le rôle/la base de données puis exécutent `rake db:migrate db:seed` | Sortie `initialization_jobs` |
| Paramètres de base | Définit l'environnement de base d'OpenProject : `RAILS_ENV`, mode HTTPS, journalisation sur STDOUT, exécution asynchrone de `good_job`, dimensionnement du pool de connexions à la base de données | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Définit des sondes de démarrage/vivacité **HTTP** par défaut (`/health_checks/default`) — `OpenProject_CloudRun`/`OpenProject_GKE` les remplacent par des sondes **TCP** pour contourner le Host Authorization de Rails ; assemble également un objet `readiness_probe` sans effet (ce n'est pas un champ d'entrée reconnu par `App_CloudRun`/`App_GKE`) | §Observabilité dans les guides de plateforme |

---

## 2. Le secret `SECRET_KEY_BASE` dans Secret Manager {#2-the-secret_key_base-secret-in-secret-manager}

Un unique secret est généré automatiquement et stocké dans Secret Manager — il n'est
jamais défini en clair et ne doit jamais être modifié après le premier déploiement :

- **`SECRET_KEY_BASE`** — 64 octets aléatoires rendus sous la forme d'une chaîne
  hexadécimale de 128 caractères. Rails l'utilise pour signer les sessions et les cookies
  et pour dériver la clé des colonnes chiffrées de la base de données. Il **doit rester
  stable d'un redémarrage et d'un redéploiement à l'autre** : sa rotation après le premier
  démarrage rend illisibles toutes les sessions existantes et toutes les données chiffrées.
  Le module le génère une seule fois (`random_id`) et le conserve dans Secret Manager, de
  sorte qu'il survit à la recréation des conteneurs, au dimensionnement et aux
  redéploiements.

Récupérez le secret après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret est indiqué dans les sorties du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle partagé
de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

OpenProject nécessite **PostgreSQL 15** ; le moteur est imposé et MySQL ou les autres
moteurs ne sont pas pris en charge. Lors du premier déploiement, deux jobs ponctuels
s'exécutent dans l'ordre :

1. **`db-init`** (avec `postgres:15-alpine`) crée de manière idempotente le rôle et la
   base de données de l'application (propriétaire = l'utilisateur de l'application), en
   accordant les privilèges dont OpenProject a besoin.
2. **`db-migrate`** exécute l'image personnalisée de l'application et lance
   `rake db:migrate db:seed` — ce qui crée le schéma complet d'OpenProject et le compte
   administrateur par défaut. Il s'exécute **au moment de l'apply** avec un délai
   d'expiration généreux (30 minutes) et la totalité du CPU, de sorte que le conteneur web
   démarre ensuite rapidement sur un schéma déjà migré.

Pourquoi un job de migration dédié (plutôt qu'une migration au démarrage) : le service
s'exécute en **mode web uniquement** (`./docker/prod/web`) pour éviter le conflit de ports
Apache+Puma de l'image tout-en-un, et le mode web uniquement ignore le seeder supervisé que
le point d'entrée tout-en-un exécuterait autrement. Rails (en production) refuse de
démarrer Puma tant que des migrations sont en attente (« You have N pending migrations » →
exit 1 → échec de la sonde de démarrage) ; les migrations doivent donc être terminées
*avant* le démarrage du service.

Le job est **autovérifié et autoréparateur** :

- Il exécute explicitement `rake db:migrate` (et non `db:schema:load`), car la purge du
  schéma effectuée par `schema:load` effacerait l'extension `pg_trgm` et casserait les
  index trigrammes GIN ; `db:migrate` crée `pg_trgm` via `enable_extension` avant les
  index.
- Avant de migrer, il exécute `DROP OWNED BY CURRENT_USER CASCADE` pour supprimer les
  éventuelles tables partielles laissées par une tentative précédente interrompue (les
  `AggregatedMigrations` consolidées d'OpenProject ne sont pas transactionnelles), de sorte
  que chaque tentative démarre sur une base propre.
- Si le seeder échoue, le schéma reste non migré et la création du service échoue **de
  manière visible** sur la protection contre les migrations en attente — aucune mise en
  production silencieuse avec une base de données vide.

Le job de migration définit `OPENPROJECT_RAILS__CACHE__STORE = file_store` (OpenProject
utilise memcached par défaut pour son cache, qui n'est pas présent dans le job ;
OpenProject valide ce paramètre par rapport à une liste fixe
`{file_store, memcache, redis}`).

Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est une fine enveloppe `FROM openproject/openproject:<version>`. Le
seul ajout est `cloud-entrypoint.sh`, qui s'exécute avant le démarrage standard :

- **Compose `DATABASE_URL` à partir des variables `DB_*` du socle.** OpenProject
  (Rails) lit un unique DSN sous forme d'URL. Le point d'entrée choisit une branche selon
  la forme de l'hôte résolu et encode le mot de passe pour l'URL :
  - **Socket Unix Cloud SQL** (`/cloudsql/...`) → forme socket de libpq
    `postgres://user:pass@/db?host=/cloudsql/<inst>` (les deux-points du chemin du socket
    casseraient la partie autorité de l'URL ; il est donc placé dans `?host=`).
  - **Loopback** (`127.0.0.1` — le sidecar Auth Proxy de GKE) → TCP simple, sans SSL.
  - **Adresse IP privée** (par défaut sur Cloud Run) → `sslmode=require` (Cloud SQL
    rejette les connexions TCP non chiffrées par adresse IP privée).
  Cette URL est composée **inconditionnellement** — l'image amont intègre une
  `DATABASE_URL` par défaut pointant vers `127.0.0.1` ; une protection du type « ne pas
  écraser si elle est déjà définie » serait donc fatale sur Cloud Run, où il n'existe pas
  de proxy en loopback.
- **Définit `OPENPROJECT_HOST__NAME` et `OPENPROJECT_HTTPS`** afin qu'OpenProject
  construise des URL absolues correctes derrière le front-end HTTPS de la plateforme.
- **Exécute le point d'entrée tout-en-un standard + le `CMD`** — sur cette plateforme, le
  `CMD` est `./docker/prod/web` (Puma uniquement) ; `good_job` exécute donc son worker et
  son cron dans le processus via `GOOD_JOB_EXECUTION_MODE = async`.

L'image utilise un ARG de build propre à l'application, `OPENPROJECT_VERSION` (et non le
`APP_VERSION` générique que le socle injecte et qui l'écraserait). OpenProject ne
publie que des tags de version majeure numériques (16, 15, …) et **aucun tag `latest`** ;
la valeur par défaut de la campagne `"latest"` est donc épinglée sur la version majeure
stable `16`.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`OpenProject_Common` établit l'environnement de base afin que l'application démarre
correctement dès le premier lancement :

- **`RAILS_ENV = production`**.
- **`OPENPROJECT_HTTPS = tostring(var.https_enabled)`** — combiné à
  `OPENPROJECT_HOST__NAME` (défini par le point d'entrée), il produit des URL absolues
  correctes, mais `https_enabled` n'est **pas** fixé à `true` : `OpenProject_CloudRun`
  transmet toujours `true` (une URL Cloud Run `*.run.app` est toujours en HTTPS), tandis
  que `OpenProject_GKE` transmet `var.enable_custom_domain` — le mode HTTPS ne s'active
  qu'une fois un domaine personnalisé et un certificat géré configurés. Forcer `true` sur
  GKE sans domaine personnalisé redirigerait de force chaque requête vers une adresse
  `https://` qui ne répond jamais (une panne totale et silencieuse) ; c'est pourquoi la
  variante transmet cette valeur de manière conditionnelle au lieu de l'imposer en dur.
- **`RAILS_LOG_TO_STDOUT = true`** — émet les journaux pour Cloud Logging / GKE.
- **`GOOD_JOB_EXECUTION_MODE = async`** — les jobs en arrière-plan (e-mails,
  notifications, travaux planifiés) s'exécutent dans le processus, à l'intérieur du
  conteneur web. Il n'y a **pas de Redis** : `good_job` gère sa file d'attente dans
  PostgreSQL ; le module transmet donc `enable_redis = false`.
- **`RAILS_MAX_THREADS = 5`** — le pool de connexions Rails à la base de données,
  maintenu au-dessus de la concurrence pour éviter les dépassements de délai du pool.

Le câblage de la base de données propre à chaque plateforme (socket, loopback ou adresse
IP privée) est géré par le point d'entrée (voir §4), en fonction de la valeur de
`enable_cloudsql_volume` sur la variante.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

OpenProject exécute Rails 8, qui applique le **Host Authorization** par rapport à
`OPENPROJECT_HOST__NAME` et renvoie
`400 Bad Request: Invalid host_name configuration` à toute requête dont l'en-tête `Host`
ne correspond pas — y compris les sondes de santé HTTP de la plateforme, qui se connectent
avec l'adresse IP du pod comme `Host`. Une sonde HTTP **ne réussit donc jamais**, même
lorsque Puma est sain et que le trafic réel des navigateurs (Host = le domaine du service)
fonctionne correctement. Les sondes sont donc configurées comme suit :

- **Sonde de démarrage : TCP.** Vérifie uniquement que Puma écoute sur le port, en
  contournant le Host Authorization. Comme les migrations s'exécutent dans le job
  `db-migrate` (et non au démarrage), le conteneur devient rapidement prêt sur son port.
  Notez que ce comportement TCP provient des valeurs par défaut de la variable
  `startup_probe` propre à `OpenProject_CloudRun`/`OpenProject_GKE` — la valeur par défaut
  de `startup_probe` dans `OpenProject_Common` est une sonde HTTP sur
  `/health_checks/default` ; les variantes de plateforme la remplacent.
- **Sonde de vivacité :** **TCP sur GKE** (GKE prend en charge une sonde de vivacité TCP,
  si bien qu'un Puma sain reste actif) ; **désactivée sur Cloud Run** (Cloud Run ne prend
  en charge que des sondes de vivacité HTTP/gRPC, et une sonde HTTP ferait redémarrer en
  boucle un conteneur sain). Comme pour la sonde de démarrage, ce remplacement a lieu dans
  la variante de plateforme, et non dans `Common`.
- **Sonde de disponibilité (readiness) : non évaluée en pratique.** Le `main.tf` d'`OpenProject_Common`
  construit un objet `readiness_probe` pointant vers `GET /health_checks/default`, mais
  `readiness_probe` n'est pas un champ d'entrée reconnu par `App_CloudRun` ni par
  `App_GKE` (seuls `startup_probe`, `liveness_probe`, `health_check_config` et
  `uptime_check_config` le sont) — c'est une configuration morte, sans effet. Les
  variables `health_check_config`/`uptime_check_config` réellement utilisées par les
  variantes CloudRun/GKE ont un `path` par défaut égal à `/`, et non
  `/health_checks/default`.

---

## 7. Stockage des pièces jointes {#7-attachment-storage}

Par défaut, OpenProject stocke les pièces jointes des lots de travaux sur le système de
fichiers local, qui est éphémère sur Cloud Run. Pour des pièces jointes **durables**, les
deux variantes utilisent par défaut `enable_nfs = true` et montent Cloud Filestore sur
`/opt/openproject/storage` (`OPENPROJECT_ATTACHMENTS__STORAGE__PATH`). Vous pouvez aussi
configurer fog/S3 vers un point de terminaison compatible GCS via les variables
d'environnement `OPENPROJECT_FOG_*`. Cette couche ne crée aucun bucket de données dédié.

---

Pour la configuration d'OpenProject propre à l'utilisateur (variables par groupe, sorties
et manière d'explorer chaque service depuis la console et la CLI), consultez les guides de
plateforme : **[OpenProject_GKE](OpenProject_GKE.md)** et
**[OpenProject_CloudRun](OpenProject_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [OpenProject sur Google Cloud Run](OpenProject_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [OpenProject sur GKE Autopilot](OpenProject_GKE.md) — cette configuration déployée sur GKE.
