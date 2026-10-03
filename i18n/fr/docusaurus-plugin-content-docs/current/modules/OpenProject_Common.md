---
title: "OpenProject Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module OpenProject — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/OpenProject_Common.md @ 15fd4c7 sha256:0c3ba9688d60 -->

# OpenProject Common — Configuration d'application partagée {#openproject-common--shared-application-configuration}

`OpenProject_Common` est la **couche d'application partagée** pour OpenProject. Elle n'est
pas déployée seule ; elle fournit plutôt la configuration spécifique à OpenProject
sur laquelle s'appuient [OpenProject_GKE](OpenProject_GKE.md) et
[OpenProject_CloudRun](OpenProject_CloudRun.md), de sorte que les deux variantes de plateforme
se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a pas ses propres entrées d'interface utilisateur de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute OpenProject, consultez les
guides de la plateforme ([OpenProject_GKE](OpenProject_GKE.md),
[OpenProject_CloudRun](OpenProject_CloudRun.md)) et les guides de base
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par OpenProject_Common | Où cela apparaît |
|---|---|---|
| Secret cryptographique | Génère `SECRET_KEY_BASE` (64 octets aléatoires → 128 caractères hexadécimaux) et le stocke dans **Secret Manager** | Injecté automatiquement ; récupérable via Secret Manager (voir ci-dessous) |
| Image conteneur | Encapsule l'image tout-en-un officielle `openproject/openproject` avec un `cloud-entrypoint.sh` personnalisé ; build via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides de la plateforme |
| Amorçage de la base de données | Définit les jobs de premier déploiement (`db-init` → `db-migrate`) qui créent le rôle/la base de données puis exécutent `rake db:migrate db:seed` | Sortie `initialization_jobs` |
| Paramètres de base | Définit l'environnement OpenProject de base : `RAILS_ENV`, mode HTTPS, journalisation STDOUT, exécution asynchrone `good_job`, dimensionnement du pool de base de données | Comportement de l'application dans les guides de la plateforme |
| Sondes de santé | Définit les valeurs par défaut des sondes de démarrage/vivacité **HTTP** (`/health_checks/default`) — `OpenProject_CloudRun`/`OpenProject_GKE` les remplacent par **TCP** pour contourner l'autorisation d'hôte Rails ; assemble également un objet `readiness_probe` qui est inerte (pas un champ d'entrée reconnu `App_CloudRun`/`App_GKE`) | §Observabilité dans les guides de la plateforme |

---

## 2. Le secret `SECRET_KEY_BASE` dans Secret Manager {#2-the-secret_key_base-secret-in-secret-manager}

Un seul secret est généré automatiquement et stocké dans Secret Manager — il n'est
jamais défini en texte clair et ne doit jamais être modifié après le premier déploiement :

- **`SECRET_KEY_BASE`** — 64 octets aléatoires rendus sous forme de chaîne hexadécimale de 128 caractères.
  Rails l'utilise pour signer les sessions et les cookies et pour dériver la clé des colonnes de base de données chiffrées. Il **doit être stable lors des redémarrages et des redéploiements** : le faire tourner après le premier démarrage rend toute session existante et toutes les données chiffrées illisibles.
  Le module le génère une fois (`random_id`) et le conserve dans Secret Manager, de sorte qu'il
  survive à la recréation de conteneurs, à la mise à l'échelle et aux redéploiements.

Récupérez le secret après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par la fondation ; son
nom de secret est indiqué dans les sorties de déploiement de la plateforme (`database_password_secret`).
Voir [App_Common](App_Common.md) pour le secret partagé et le modèle Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

OpenProject nécessite **PostgreSQL 15** ; le moteur est fixe et MySQL ou d'autres
moteurs ne sont pas pris en charge. Lors du premier déploiement, deux jobs ponctuels s'exécutent dans l'ordre :

1. **`db-init`** (utilisant `postgres:15-alpine`) crée de manière idempotente le rôle et la base de données de l'application (propriétaire = l'utilisateur de l'application), accordant les privilèges dont OpenProject a besoin.
2. **`db-migrate`** exécute l'image personnalisée de l'application et exécute
   `rake db:migrate db:seed` — créant le schéma OpenProject complet et amorçant le
   compte administrateur par défaut. Il s'exécute au **moment de l'apply** avec un délai d'attente généreux
   (30 minutes) et un CPU complet, de sorte que le conteneur web démarre plus tard rapidement avec un
   schéma déjà migré.

Pourquoi un job de migration dédié (plutôt que de migrer au démarrage) : le service s'exécute
**web-only** (`./docker/prod/web`) pour éviter la collision de port Apache+Puma de l'image tout-en-un, et web-only ignore le seeder supervisé que l'entrée tout-en-un exécuterait autrement. Rails (production) refuse de démarrer Puma tant que des migrations sont en attente ("You have N pending migrations" → exit 1 → échec de la sonde de démarrage), donc les migrations
doivent être terminées *avant* le démarrage du service.

Le job est **auto-vérifiant et auto-réparateur** :

- Il exécute explicitement `rake db:migrate` (pas `db:schema:load`), car la purge du schéma dans `schema:load` effacerait l'extension `pg_trgm` et casserait les index trigrammes GIN ; `db:migrate` crée `pg_trgm` via `enable_extension` avant les index.
- Avant de migrer, il exécute `DROP OWNED BY CURRENT_USER CASCADE` pour effacer toutes les tables partielles laissées par une tentative interrompue précédente (le `AggregatedMigrations` écrasé d'OpenProject n'est pas transactionnel), de sorte que chaque tentative commence proprement.
- Si le seeder échoue, le schéma reste non migré et la création du service échoue **bruyamment** sur le garde de migration en attente — il n'y a pas de livraison silencieuse de base de données vide.

Le job de migration définit `OPENPROJECT_RAILS__CACHE__STORE = file_store` (OpenProject
définit par défaut son cache sur memcached, qui n'est pas présent dans le job ; OpenProject
valide ce paramètre par rapport à une liste fixe `{file_store, memcache, redis}`).

Inspectez la base de données directement avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms d'instance, de base de données et d'utilisateur se trouvent dans les sorties de déploiement de la plateforme.

---

## 4. Image conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est un mince wrapper `FROM openproject/openproject:<version>`. Le
seul ajout est `cloud-entrypoint.sh`, qui s'exécute avant le démarrage standard :

- **Compose `DATABASE_URL` à partir des variables `DB_*` de la Fondation.** OpenProject (Rails)
  lit un seul DSN au format URL. Le point d'entrée se ramifie en fonction de la forme d'hôte résolue et
  encode le mot de passe en URL :
  - **Socket Unix Cloud SQL** (`/cloudsql/...`) → forme de socket libpq
    `postgres://user:pass@/db?host=/cloudsql/<inst>` (les deux-points dans le chemin du socket
    casseraient une autorité d'URL, donc il va dans `?host=`).
  - **Boucle locale** (`127.0.0.1` — le sidecar GKE Auth Proxy) → TCP simple, pas de SSL.
  - **IP privée** (valeur par défaut de Cloud Run) → `sslmode=require` (Cloud SQL rejette
    le TCP IP privée non chiffré).
  Ceci est composé **inconditionnellement** — l'image amont intègre un `DATABASE_URL` par défaut
  pointant vers `127.0.0.1`, donc une garde "ne pas écraser si défini" serait
  fatale sur Cloud Run, où il n'y a pas de proxy en boucle locale.
- **Définit `OPENPROJECT_HOST__NAME` et `OPENPROJECT_HTTPS`** afin qu'OpenProject construise
  des URL absolues correctes derrière le frontal HTTPS de la plateforme.
- **Exécute le point d'entrée tout-en-un standard + le `CMD`** — sur cette plateforme, le `CMD`
  est `./docker/prod/web` (Puma uniquement), donc `good_job` exécute son worker et son cron en interne
  via `GOOD_JOB_EXECUTION_MODE = async`.

L'image utilise un ARG de build `OPENPROJECT_VERSION` spécifique à l'application (pas le générique
`APP_VERSION` que la Fondation injecte et écraserait). OpenProject ne publie que
des tags majeurs numériques (16, 15, …) et **aucun tag `latest`**, donc la valeur par défaut de la campagne
`"latest"` est épinglée au majeur stable `16`.

---

## 5. Paramètres d'application de base {#5-core-application-settings}

`OpenProject_Common` établit l'environnement de base afin que l'application démarre
correctement au premier démarrage :

- **`RAILS_ENV = production`**.
- **`OPENPROJECT_HTTPS = tostring(var.https_enabled)`** — combiné avec
  `OPENPROJECT_HOST__NAME` (défini par le point d'entrée), cela donne des URL absolues correctes,
  mais `https_enabled` n'est **pas** un `true` fixe : `OpenProject_CloudRun` passe toujours
  `true` (une URL `*.run.app` Cloud Run est toujours HTTPS), tandis que `OpenProject_GKE` passe
  `var.enable_custom_domain` — le mode HTTPS ne s'active qu'une fois qu'un domaine personnalisé + un certificat géré
  sont configurés. Forcer `true` sur GKE sans domaine personnalisé
  redirigerait chaque requête vers une adresse `https://` qui ne répond jamais (une panne totale et silencieuse),
  c'est pourquoi la variante le transmet conditionnellement au lieu de le coder en dur.
- **`RAILS_LOG_TO_STDOUT = true`** — émet des logs pour Cloud Logging / GKE.
- **`GOOD_JOB_EXECUTION_MODE = async`** — les jobs en arrière-plan (e-mails, notifications,
  travaux planifiés) s'exécutent en interne dans le conteneur web. Il n'y a **pas de Redis** :
  `good_job` exécute sa file d'attente sur PostgreSQL, donc le module transmet `enable_redis = false`.
- **`RAILS_MAX_THREADS = 5`** — le pool de connexions DB de Rails, maintenu au-dessus de la concurrence pour
  éviter les timeouts de pool.

Le câblage de base de données spécifique à la plateforme (socket vs. boucle locale vs. IP privée) est géré par
le point d'entrée (voir §4), en fonction de si `enable_cloudsql_volume` est défini sur la
variante.

---

## 6. Comportement de la sonde de santé {#6-health-probe-behaviour}

OpenProject exécute Rails 8, qui applique l'**autorisation d'hôte** contre
`OPENPROJECT_HOST__NAME` et renvoie `400 Bad Request: Invalid host_name configuration`
à toute requête dont l'en-tête `Host` ne correspond pas — y compris les sondes de santé HTTP de la plateforme, qui se connectent avec l'IP du pod comme `Host`. Une sonde HTTP ne passe donc **jamais** même si Puma est sain et que le trafic réel du navigateur (Hôte = le domaine du service) fonctionne correctement. Les sondes sont donc configurées comme suit :

- **Sonde de démarrage : TCP.** Vérifie uniquement que Puma écoute sur le port, contournant
  l'autorisation d'hôte. Étant donné que les migrations s'exécutent dans le job `db-migrate` (pas au démarrage), le
  conteneur devient rapidement prêt sur le port. Notez que ce comportement TCP provient
  des valeurs par défaut des variables `startup_probe` de `OpenProject_CloudRun`/`OpenProject_GKE` —
  la valeur par défaut `startup_probe` de `OpenProject_Common` est HTTP contre
  `/health_checks/default` ; les variantes de la plateforme la remplacent.
- **Sonde de vivacité : TCP sur GKE** (GKE prend en charge une sonde de vivacité TCP, donc un Puma sain reste en vie) ; **désactivée sur Cloud Run** (Cloud Run ne prend en charge que les sondes de vivacité HTTP/gRPC, et une sonde HTTP redémarrerait en boucle un conteneur sain). Comme pour la sonde de démarrage, cette surcharge se produit au niveau de la variante de la plateforme, pas dans `Common`.
- **Sonde de disponibilité (readiness) : non réellement évaluée.** `OpenProject_Common`'s `main.tf` construit un
  objet `readiness_probe` pointant vers `GET /health_checks/default`, mais `readiness_probe`
  n'est pas un champ d'entrée reconnu de `App_CloudRun` ou `App_GKE` (seuls `startup_probe`,
  `liveness_probe`, `health_check_config` et `uptime_check_config` le sont) — c'est une configuration inerte,
  morte. Les variables `health_check_config`/`uptime_check_config` réelles sur
  les variantes CloudRun/GKE définissent par défaut leur `path` à `/`, pas `/health_checks/default`.

---

## 7. Stockage des pièces jointes {#7-attachment-storage}

OpenProject stocke les pièces jointes des paquets de travail sur le système de fichiers local par défaut, qui
est éphémère sur Cloud Run. Pour les pièces jointes **durables**, les deux variantes utilisent par défaut
`enable_nfs = true`, montent Cloud Filestore à `/opt/openproject/storage`, et définissent
`OPENPROJECT_ATTACHMENTS__STORAGE__PATH` sur ce chemin de montage (uniquement lorsque NFS est activé, de sorte que
l'application n'est jamais dirigée vers un chemin non monté). Alternativement, configurez fog/S3 contre un
point de terminaison compatible GCS via les variables d'environnement `OPENPROJECT_FOG_*`. Aucun
bucket de données dédié n'est créé par cette couche.

---

Pour la configuration spécifique à OpenProject, orientée utilisateur (variables par groupe,
sorties, et comment explorer chaque service depuis la Console et la CLI), consultez les guides de la plateforme : **[OpenProject_GKE](OpenProject_GKE.md)** et
**[OpenProject_CloudRun](OpenProject_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [OpenProject sur Google Cloud Run](OpenProject_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [OpenProject sur GKE Autopilot](OpenProject_GKE.md) — cette configuration déployée sur GKE.
