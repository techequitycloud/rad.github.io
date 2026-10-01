---
title: "MaybeFinance Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module MaybeFinance — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/MaybeFinance_Common.md @ 3055034 sha256:7d81569fc44d -->

# MaybeFinance Common — Configuration applicative partagée {#maybefinance-common--shared-application-configuration}

`MaybeFinance_Common` est la **couche applicative partagée** de Maybe (Maybe
Finance), l'application web open source de finances personnelles construite sur
Ruby on Rails. Elle n'est pas déployée seule ; elle fournit plutôt la
configuration propre à Maybe sur laquelle s'appuient à la fois
[MaybeFinance_GKE](MaybeFinance_GKE.md) et
[MaybeFinance_CloudRun](MaybeFinance_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais directement cette couche — elle n'a aucune entrée
propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation des
plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Maybe, consultez les
guides des plateformes ([MaybeFinance_GKE](MaybeFinance_GKE.md),
[MaybeFinance_CloudRun](MaybeFinance_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par MaybeFinance_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `SECRET_KEY_BASE` (chaîne aléatoire de 64 caractères) et le stocke dans **Secret Manager** | Injecté automatiquement ; récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Enveloppe l'image officielle `ghcr.io/maybe-finance/maybe` avec un script de point d'entrée personnalisé ; construite via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** (`POSTGRES_15`) comme moteur configuré | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les octrois, et crée au préalable `pgcrypto` ; un second job (`maybefinance-migrate`) exécute `rails db:prepare` | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare un bucket de données **Cloud Storage** `storage` | Sortie `storage_buckets` |
| Paramètres essentiels | Définit l'environnement Rails/Maybe de base : mode production, interface auto-hébergée, journalisation, pool de threads, gestion de TLS | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde de démarrage/d'activité par défaut ciblant `/up`, ainsi qu'un bloc `readiness_probe` inerte que le socle n'utilise pas | §Observabilité dans les guides des plateformes |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est
jamais défini en clair et ne doit jamais être modifié après le premier
déploiement :

- **`SECRET_KEY_BASE`** — une chaîne aléatoire de 64 caractères
  (`random_password`, `special = false`), partagée à l'identique par le processus
  web Rails et le worker Sidekiq co-localisé (reprend le modèle `APP_KEY`
  d'InvoiceNinja). Rails l'utilise pour signer les sessions/cookies et pour
  dériver la clé qui chiffre les colonnes chiffrées par ActiveRecord. Le faire
  tourner après le premier démarrage invalide toutes les sessions actives
  (obligeant tous les utilisateurs à se reconnecter) **et** rend définitivement
  illisibles les données existantes chiffrées par ActiveRecord — il n'existe aucun
  moyen de les rechiffrer.

Le secret n'est créé qu'une fois `google_project_service.secretmanager` activé et
après l'exécution d'une passe `cleanup_orphaned_secrets` ; la sortie `config` du
module dépend en outre d'un `time_sleep.wait_for_secrets` de 30 secondes, afin de
garantir que la version du secret existe avant que Cloud Run/GKE ne l'utilise.

Récupérez le secret après le déploiement :

```bash
# List the secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"

# Read the secret version:
gcloud secrets versions access latest --secret=secret-<prefix>-maybefinance-secret-key-base --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le
socle ; le nom de son secret figure dans les sorties du déploiement de la
plateforme (`database_password_secret`). Voir [App_Common](App_Common.md) pour le
modèle partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

La sortie `config` fixe `database_type = "POSTGRES_15"` (Maybe requiert
PostgreSQL 12+ ; les variantes de plateforme restreignent en outre cette valeur au
moment du plan à `POSTGRES_13`/`14`/`15`/`NONE`, en rejetant MySQL).
`enable_postgres_extensions` est laissé à `false` et `postgres_extensions` vide —
délibérément, car `db-init.sh` crée déjà au préalable la seule extension dont le
schéma de Maybe a besoin (`pgcrypto`) grâce à un octroi superutilisateur, si bien
que le mécanisme d'extensions propre au socle serait redondant.

Au premier déploiement, deux jobs enchaînés s'exécutent :

1. **`db-init`** (`postgres:15-alpine`, `execute_on_apply = true`,
   `max_retries = 1`, `timeout_seconds = 600`) — de manière idempotente :
   - Résout l'hôte cible : privilégie `DB_HOST`, puis se rabat sur `DB_IP`,
     puis sur `127.0.0.1` ; si `DB_HOST` s'avère être un répertoire de socket
     Cloud SQL (commençant par `/`), il se rabat plutôt sur `DB_IP` en TCP
     (`psql` sur une IP privée nécessite SSL indépendamment du montage du socket).
   - Définit `PGSSLMODE=disable` en loopback (`127.0.0.1`/`localhost`) ou
     `PGSSLMODE=require` face à une véritable IP privée.
   - Attend que PostgreSQL accepte les connexions.
   - Crée (ou met à jour, via `ALTER ROLE`) le rôle applicatif avec
     `LOGIN CREATEDB` et le mot de passe généré.
   - Crée la base de données de l'application si elle n'existe pas déjà (dont le
     propriétaire est `postgres`, car l'utilisateur `postgres` de Cloud SQL ne
     peut pas faire de `SET ROLE` vers un rôle applicatif).
   - Accorde au rôle applicatif tous les privilèges sur la base de données et sur
     le schéma `public`.
   - **Accorde `cloudsqlsuperuser` au rôle applicatif** — les utilisateurs
     applicatifs de Cloud SQL ne sont pas de vrais superutilisateurs ; c'est donc
     ce qui permet ensuite à la propre migration de Maybe de créer des extensions
     Postgres sans échouer sur `must be superuser`.
   - Crée au préalable `pgcrypto` (`CREATE EXTENSION IF NOT EXISTS pgcrypto`) par
     mesure de précaution supplémentaire, de sorte qu'un
     `CREATE EXTENSION IF NOT EXISTS` ultérieur lors du chargement du schéma de l'application soit une
     opération sans effet ne nécessitant aucun privilège.
   - Signale au sidecar Cloud SQL Auth Proxy de s'arrêter (`/quitquitquit`) afin
     que le pod du job puisse se terminer.
2. **`maybefinance-migrate`** (`image = null`, réutilise l'image applicative
   Maybe construite ; `depends_on_jobs = ["db-init"]` ; `memory_limit = 2Gi`,
   `max_retries = 3`, `timeout_seconds = 1200`) — applique la même logique de
   résolution de l'hôte de la base de données et du sslmode que le point d'entrée
   d'exécution, puis exécute `bundle exec rails db:prepare` (la tâche idempotente
   de création ou de migration de Rails) depuis `/rails` (ou `/app` en solution
   de repli), et signale ensuite à l'Auth Proxy de s'arrêter.

Les deux jobs peuvent être réexécutés sans risque. Inspectez directement la
base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans
les sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée (`scripts/Dockerfile`) est une enveloppe légère `FROM
ghcr.io/maybe-finance/maybe:${MAYBE_VERSION}` — le tag de base est piloté par un
ARG de build **propre à l'application** (`MAYBE_VERSION`), et non par l'argument
générique `APP_VERSION` du socle (qui est injecté dans `build_args` et
l'emporterait sinon lors de la fusion). `MaybeFinance_Common` associe
`application_version == "latest"` au canal de version épinglé `"stable"` afin que
les builds restent reproductibles. Le build ne passe en `USER root` que le temps
de copier le script de point d'entrée, puis rétablit l'utilisateur non privilégié
`rails` propre à l'image et `WORKDIR /rails`. `enable_image_mirroring = true` est
fixé, car `ghcr.io/maybe-finance/maybe` est une image préconstruite qui doit être
mise en miroir dans Artifact Registry avant l'exécution du build de l'enveloppe.

`entrypoint.sh` (installé en tant que `/usr/local/bin/cloud-entrypoint.sh`,
l'`ENTRYPOINT` de l'image) s'exécute avant le démarrage de
`bundle exec rails server` et a pour rôle de :

- **Faire correspondre `DB_*` aux variables d'environnement de base de données
  Rails distinctes de Maybe** — la plateforme injecte `DB_HOST`, `DB_PORT`,
  `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_IP` ; le point d'entrée résout l'hôte
  effectif (`DB_HOST`, puis `DB_IP` en repli, puis `127.0.0.1`) et exporte
  `POSTGRES_DB`/`POSTGRES_USER`/
  `POSTGRES_PASSWORD`, car le fichier `config/database.yml` de Maybe lit ces
  variables distinctes plutôt qu'un DSN sous forme d'URL.
- **Corriger un `DB_HOST` de type socket** — le pilote `pg` de Rails ne sait pas
  analyser le DSN de socket Unix de Cloud SQL ; si l'hôte résolu commence par `/`
  (un répertoire de socket), le point d'entrée lui substitue donc `DB_IP` en TCP.
- **Choisir `PGSSLMODE`** — `disable` lorsque l'hôte résolu est le loopback
  (`127.0.0.1`/`localhost`, c'est-à-dire le sidecar Auth Proxy sur GKE),
  `require` sinon (une véritable IP privée, c'est-à-dire Cloud Run sans le
  montage du socket). Ce choix dépend de l'hôte résolu, jamais de la présence de
  `DB_IP` — `DB_IP` vaut aussi `127.0.0.1` sur GKE.
- **Construire `REDIS_URL`** — construit à partir de `REDIS_HOST`/`REDIS_PORT` (et
  de `REDIS_AUTH` s'il est présent) lorsque `REDIS_URL` n'est pas déjà défini.
- **Démarrer Sidekiq en arrière-plan** — si `REDIS_URL` se résout en valeur non
  vide, `bundle exec sidekiq &` est lancé en premier (intercepté de sorte que
  `TERM`/`INT` l'arrêtent également), puis le serveur web Rails est lancé par
  `exec` au premier plan du *même* conteneur — Maybe n'est pas déployé avec un
  worker distinct dans `additional_services`. Si `REDIS_URL` est vide, Sidekiq
  n'est pas démarré du tout plutôt que de faire planter le conteneur.

La création et la migration du schéma sont entièrement prises en charge par le
job d'initialisation `maybefinance-migrate` décrit ci-dessus ; le point
d'entrée d'exécution n'exécute jamais de migrations en mode intégré (inline).

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`MaybeFinance_Common` établit l'environnement Rails/Maybe de base afin que
l'application démarre correctement dès le premier lancement (fusionné avec
`var.environment_variables`, qui peut le remplacer) :

- **`RAILS_ENV = "production"`.**
- **`SELF_HOSTED = "true"`** — active l'interface d'auto-hébergement de Maybe
  (inscription de l'administrateur au premier lancement via l'interface web) et
  désactive les intégrations réservées au SaaS. Aucun secret de mot de passe
  administrateur n'est généré automatiquement ; le premier visiteur qui atteint le
  déploiement s'approprie le compte administrateur initial.
- **`RAILS_LOG_TO_STDOUT = "true"`, `LOG_LEVEL = "info"`** — afin que Cloud
  Logging / GKE capture les journaux de l'application.
- **`RAILS_MAX_THREADS = "5"`** — maintenu au-dessus de la concurrence Cloud Run
  par défaut de la plateforme afin d'éviter les erreurs « could not obtain a
  connection from the pool » sous charge.
- **`RAILS_FORCE_SSL = "false"`, `RAILS_ASSUME_SSL = "false"`** — Cloud Run et
  l'équilibreur de charge GKE terminent tous deux TLS en périphérie et
  transmettent du HTTP en clair au conteneur ; forcer SSL redirigerait (301) la
  sonde de démarrage non authentifiée hors de `/`, et elle ne verrait jamais de
  réponse 200.
- **`RAILS_SERVE_STATIC_FILES = "true"`** — Maybe sert ses propres ressources
  précompilées en production (pas de niveau CDN/fichiers statiques séparé).

`enable_cloudsql_volume` vaut par défaut **`false`** dans `MaybeFinance_Common`
lui-même — le pilote `pg` de Rails ne sait pas analyser le DSN de socket Unix de
Cloud SQL ; la valeur par défaut de la couche Common se passe donc du sidecar
Auth Proxy et s'attend à ce que l'application se connecte via l'IP privée de
l'instance avec `sslmode=require`. La variante `MaybeFinance_CloudRun` conserve
cette valeur par défaut `false` (Cloud Run n'a de toute façon pas de proxy en
loopback) ; la variante `MaybeFinance_GKE` la remplace par `true` dans son propre
`variables.tf`, afin que les pods joignent plutôt Cloud SQL via le sidecar
`cloud-sql-proxy` en loopback. Les deux cas sont gérés par la même branche du
point d'entrée décrite au §4.

`environment_variables` a aussi une conséquence notable pour
`db-init`/`maybefinance-migrate` : aucun des deux jobs ne définit
explicitement `RAILS_ENV`/`SELF_HOSTED`, à l'exception de
`maybefinance-migrate.sh`, qui leur attribue des valeurs par défaut
(`RAILS_ENV=production`, `SELF_HOSTED=true`) et fait pointer `REDIS_URL` vers une
valeur fictive inoffensive (`redis://localhost:6379`) si les variables
d'environnement Redis sont absentes, car `rails db:prepare` démarre l'application
complète sans avoir besoin d'une connexion Redis fonctionnelle.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

`MaybeFinance_Common` expose `startup_probe` et `liveness_probe` sous forme de
variables (et non en dur), toutes deux avec pour valeur par défaut
**HTTP `GET /up`** :

- **`startup_probe`** — `initial_delay_seconds = 60`, `timeout_seconds = 10`,
  `period_seconds = 15`, `failure_threshold = 30` (environ 8 minutes de marge
  après le délai initial, pour absorber un premier démarrage lent).
- **`liveness_probe`** — `initial_delay_seconds = 60`, `timeout_seconds = 5`,
  `period_seconds = 30`, `failure_threshold = 3`.

Les deux variantes de plateforme (Cloud Run et GKE) les transmettent telles
quelles en tant que `startup_probe`/`liveness_probe` du socle, si bien que le
comportement des sondes est identique d'une plateforme à l'autre pour Maybe. La
sortie `config` inclut en outre un bloc `readiness_probe` (`enabled = true`, HTTP
`/up`, `initial_delay_seconds = 30`, `timeout_seconds = 5`, `period_seconds = 10`,
`failure_threshold = 3`) — mais ni `App_CloudRun` ni `App_GKE` ne lit de clé
`readiness_probe` dans la map de configuration de l'application (seules
`startup_probe` et `liveness_probe` sont raccordées à de véritables ressources) ;
ce bloc est donc actuellement **inerte** et n'a aucun effet sur les révisions
Cloud Run ou les pods GKE déployés.

---

## 7. Stockage d'objets {#7-object-storage}

Un unique bucket **Cloud Storage** (suffixe `storage`, classe `STANDARD`,
`force_destroy = true`, gestion des versions désactivée, `public_access_prevention =
enforced`) est déclaré ici et provisionné par le socle, qui accorde également
l'accès au compte de service de la charge de travail. Il n'est pas monté par
défaut dans le système de fichiers du conteneur (`gcs_volumes` est vide
d'origine) ; il existe donc en tant que stockage provisionné mais reste inerte
tant qu'il n'est pas explicitement raccordé via `gcs_volumes`. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~maybefinance"
```

---

Pour la configuration propre à Maybe destinée aux utilisateurs (variables par
groupe, sorties et façon d'explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[MaybeFinance_GKE](MaybeFinance_GKE.md)**
et **[MaybeFinance_CloudRun](MaybeFinance_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Maybe Finance sur Google Cloud Run](MaybeFinance_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Maybe Finance sur GKE Autopilot](MaybeFinance_GKE.md) — cette configuration déployée sur GKE.
