---
title: "Chatwoot Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Chatwoot — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Chatwoot_Common.md @ 3055034 sha256:d52104e853a2 -->

# Chatwoot Common — Configuration applicative partagée {#chatwoot-common--shared-application-configuration}

`Chatwoot_Common` est la **couche applicative partagée** de Chatwoot. Elle n'est pas
déployée seule ; elle fournit plutôt la configuration propre à Chatwoot sur laquelle
reposent [Chatwoot_GKE](Chatwoot_GKE.md) et [Chatwoot_CloudRun](Chatwoot_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où
cela compte. Les utilisateurs finaux ne configurent jamais directement cette couche —
elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce
qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation
des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Chatwoot, consultez les
guides de plateforme ([Chatwoot_GKE](Chatwoot_GKE.md), [Chatwoot_CloudRun](Chatwoot_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Chatwoot_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `SECRET_KEY_BASE` (chaîne aléatoire de 64 caractères) et le stocke dans **Secret Manager** | Injecté automatiquement à la fois dans le conteneur de l'application et dans le job d'initialisation `chatwoot-prepare` |
| Image de conteneur | Enveloppe l'image officielle `chatwoot/chatwoot` avec un script de point d'entrée personnalisé ; construite via Cloud Build | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge (`database_type = "POSTGRES_15"`) | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit deux jobs chaînés de premier déploiement (`db-init` → `chatwoot-prepare`) qui créent la base de données, l'utilisateur, les droits, `pgvector`/les autres extensions et le schéma Rails | Sortie `initialization_jobs` |
| Stockage objet | Déclare un bucket **Cloud Storage** suffixé `storage` | Sortie `storage_buckets` |
| Paramètres essentiels | Définit l'environnement de base de Rails/Chatwoot : `RAILS_ENV`, journalisation vers stdout, dimensionnement du pool de la base, valeur par défaut de l'inscription libre | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de disponibilité (readiness) par défaut (ainsi que les valeurs par défaut transmises des sondes de démarrage et de vivacité) ciblant `/` | §Observabilité dans les guides de plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est jamais
défini en clair et ne doit jamais changer après le premier déploiement :

- **`SECRET_KEY_BASE`** — une chaîne aléatoire de 64 caractères (`random_password`,
  `special = false`). Rails l'utilise pour signer et vérifier les cookies de session et
  pour dériver la clé qui chiffre les colonnes chiffrées par ActiveRecord. La valeur est
  partagée à l'identique entre le processus web Rails et le worker Sidekiq co-localisé
  (tous deux s'exécutent dans le même conteneur) et est également injectée dans le job
  d'initialisation `chatwoot-prepare`, afin que la préparation du schéma utilise la même
  clé. Renouveler ce secret après le premier démarrage invalide chaque session/cookie signé
  existant et rend définitivement illisibles toutes les données chiffrées par
  ActiveRecord ; Sidekiq ne parviendra pas non plus à déchiffrer les jobs que le
  processus web a déjà mis en file d'attente.

Récupérez le secret après le déploiement :

```bash
# List secrets for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"

# Read the secret version:
gcloud secrets versions access latest --secret=secret-<resource-prefix>-chatwoot-secret-key-base --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ;
le nom de son secret figure dans les sorties du déploiement de plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

Un appel complémentaire au sous-module `cleanup_orphaned_secrets` garantit que le
secret `secret-key-base` est supprimé lors du démantèlement au lieu de rester orphelin
dans Secret Manager.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Chatwoot nécessite **PostgreSQL 15** ; le moteur est fixé
(`database_type = "POSTGRES_15"`) et les autres moteurs ne sont pas pris en charge —
le schéma de Chatwoot et ses fonctionnalités d'IA et de recherche reposant sur `pgvector` en dépendent.
La configuration de la base de données s'exécute sous la forme de **deux jobs chaînés**
plutôt que d'un unique job d'initialisation :

1. **`db-init`** (image `postgres:15-alpine`, `execute_on_apply = true`) :
   - Détermine l'hôte cible à partir de `DB_HOST` (répertoire du socket Cloud SQL sur
     Cloud Run, ou loopback du proxy sur GKE), avec repli sur `DB_IP` ou
     `127.0.0.1`.
   - Attend que PostgreSQL accepte les connexions.
   - Crée le rôle de l'application s'il est absent, ou met à jour son mot de passe s'il
     existe déjà (le privilège `CREATEDB` est accordé dans les deux cas).
   - Crée la base de données de l'application si elle n'existe pas déjà. La base
     n'appartient **pas** au rôle de l'application — la connexion `postgres` de Cloud SQL
     ne peut pas faire `SET ROLE` vers ce rôle — si bien que la propriété reste à `postgres`
     et que l'accès est accordé explicitement à la place.
   - Accorde tous les privilèges sur la base de données et sur le schéma `public` à
     l'utilisateur de l'application.
   - Accorde le rôle `cloudsqlsuperuser` à l'utilisateur de l'application, afin que les
     appels `CREATE EXTENSION` de Chatwoot (émis plus tard par `db:chatwoot_prepare`)
     réussissent — le rôle de l'application n'est pas un véritable superutilisateur
     Postgres sur Cloud SQL et se heurterait sinon à `must be superuser`.
   - Pré-crée par précaution `vector`, `pg_stat_statements`, `pg_trgm` et `pgcrypto`
     (double sécurité — le `schema.rb` de Chatwoot tente aussi de les créer lui-même).
   - Signale au sidecar Cloud SQL Auth Proxy de s'arrêter
     (`POST http://127.0.0.1:9091/quitquitquit`) afin que le pod du job se termine.
2. **`chatwoot-prepare`** (`depends_on_jobs = ["db-init"]`, utilise **l'image de
   l'application Chatwoot construite**, et non une image cliente générique, `execute_on_apply =
   true`) :
   - Fait correspondre les variables `DB_*` du socle à la convention
     `POSTGRES_*` de Chatwoot, avec une particularité propre à Cloud Run : si `DB_HOST` est un
     chemin de socket (commençant par `/`) **et** que `DB_IP` est également présent, il
     préfère `DB_IP` via TCP avec `PGSSLMODE=require`, car le socket Unix Cloud SQL
     n'apparaît pas toujours à temps dans un Job Cloud Run. Il n'utilise le chemin
     littéral du socket que lorsque `DB_IP` n'est pas défini ; sur GKE, il utilise
     le `127.0.0.1` du sidecar proxy.
   - Définit un `REDIS_URL` de repli inoffensif (`redis://localhost:6379`) si
     ni `REDIS_URL` ni `REDIS_HOST` ne sont présents, afin que les initialiseurs Rails
     qui le lisent au démarrage n'échouent pas — le job n'a en réalité pas besoin de Redis.
   - Exécute `bundle exec rails db:chatwoot_prepare` (la tâche idempotente de Chatwoot
     qui crée ou migre) pour construire ou mettre à niveau le schéma et initialiser les
     valeurs par défaut.
   - Signale de la même manière au sidecar Cloud SQL Auth Proxy de s'arrêter.

Il n'y a aucune étape de migration dans le conteneur — la création et la mise à niveau
du schéma sont entièrement prises en charge par ces deux jobs avant que le conteneur
applicatif, qui s'exécute en continu, ne soit censé servir du trafic. Les deux jobs
peuvent être relancés sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée (`Dockerfile`) enveloppe `chatwoot/chatwoot:${APP_VERSION}` :

- Passe à `USER root` — conformément à l'image amont, dont `/app` et
  `/app/tmp` appartiennent à root avec le mode 755 (non accessibles en écriture au
  groupe). L'étape `create_tmp_directories` de Rails (`mkdir /app/tmp/cache`, `/app/tmp/pids`,
  ...) a besoin de root pour réussir ; un uid non root se heurte à `Permission denied`
  et la sonde de démarrage échoue. Root évite aussi l'erreur containerd de GKE Autopilot
  `CreateContainerError: no users found` pour un simple nom d'utilisateur absent du
  `/etc/passwd` de l'image.
- Copie `entrypoint.sh` sous `/usr/local/bin/cloud-entrypoint.sh` et le définit
  comme `ENTRYPOINT`, avec `CMD ["bundle", "exec", "rails", "s", "-b",
  "0.0.0.0", "-p", "3000"]`.

Le point d'entrée (POSIX `/bin/sh` — l'image ne contient que le `sh` de busybox, pas
bash) s'exécute avant le démarrage du serveur Rails et se charge de :

- **Faire correspondre `DB_*` à `POSTGRES_*`** — lit `DB_HOST` (avec repli sur
  `DB_IP` ou `127.0.0.1`), `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` et
  les exporte sous les noms `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DATABASE`,
  `POSTGRES_USERNAME`, `POSTGRES_PASSWORD` — le pilote Ruby `pg` accepte un
  chemin de répertoire comme hôte pour une connexion par socket Unix ; le répertoire du
  socket du Cloud SQL Auth Proxy (Cloud Run) est donc transmis sans modification ; sur
  GKE, le sidecar proxy écoute sur `127.0.0.1`.
- **Construire `REDIS_URL`** — lorsqu'il n'est pas déjà défini et que `REDIS_HOST` est
  présent, le construit à partir de `REDIS_HOST`/`REDIS_PORT` (par défaut
  `6379`), en incluant le mot de passe `REDIS_AUTH` dans l'URL lorsqu'il est fourni.
  Requis à la fois pour la file de jobs de Sidekiq et pour le backend pub/sub d'ActionCable.
- **Corriger `FRONTEND_URL`** — lui donne par défaut la valeur de `CLOUDRUN_SERVICE_URL` ou
  `GKE_SERVICE_URL` lorsqu'il n'est pas déjà défini, afin que les liens des e-mails et
  notifications pointent vers l'adresse réelle et joignable du service.
- **Démarrer le worker Sidekiq en arrière-plan** — exécute `bundle exec
  sidekiq -C config/sidekiq.yml &` avant d'exécuter (exec) le serveur web Rails, de sorte que
  le web et le worker sont co-localisés dans le même conteneur/pod (Chatwoot les exécute
  normalement dans des conteneurs distincts avec docker-compose). Un `trap` sur
  `TERM`/`INT` arrête Sidekiq en même temps que le conteneur, afin qu'un arrêt ne
  laisse pas de processus worker orphelin.
- **Lancer le serveur Rails** — `exec "$@"` exécute le `CMD` du Dockerfile comme
  processus final au premier plan.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Chatwoot_Common` établit l'environnement de base de Chatwoot/Rails afin que
l'application démarre correctement dès le premier lancement :

- **Environnement** — `RAILS_ENV = "production"`, `NODE_ENV = "production"`.
- **Contexte de déploiement** — `INSTALLATION_ENV = "docker"`, qui indique à
  l'outillage intégré de Chatwoot qu'il s'exécute dans un déploiement conteneurisé.
- **Journalisation** — `RAILS_LOG_TO_STDOUT = "true"` et `LOG_LEVEL = "info"` afin que
  Cloud Logging / GKE capture la sortie du conteneur ; `RAILS_SERVE_STATIC_FILES =
  "true"`, puisque Chatwoot sert lui-même ses ressources compilées en production.
- **Pool de connexions à la base** — `RAILS_MAX_THREADS = "5"`, dimensionné au-dessus de
  la concurrence habituelle de Cloud Run pour éviter `could not obtain a connection from the
  pool` sous charge.
- **Inscription libre** — `ENABLE_ACCOUNT_SIGNUP = "false"` par défaut : un helpdesk
  fraîchement déployé ne doit pas permettre la création libre de comptes
  administrateur/agent. Les opérateurs modifient ce paramètre via `environment_variables`
  (temporairement, pour créer le premier administrateur, ou durablement pour une
  inscription publique).
- **Extensions Postgres** — `enable_postgres_extensions = true` avec
  `postgres_extensions = ["vector"]`, ce qui demande au mécanisme d'activation des
  extensions du socle de créer `pgvector`, comme seconde couche de précaution
  en plus des appels `CREATE EXTENSION` explicites de `db-init.sh`.
- **Plugins MySQL** — explicitement désactivés (`enable_mysql_plugins = false`,
  `mysql_plugins = []`) ; Chatwoot ne fonctionne qu'avec Postgres.

Les ajustements propres à chaque plateforme sont ici minimes, puisque le point d'entrée
gère l'essentiel des différences à l'exécution :

- **Cloud Run** — le Cloud SQL Auth Proxy expose un socket Unix
  (`DB_HOST` = répertoire du socket) ; le point d'entrée le transmet tel quel
  en tant que `POSTGRES_HOST`.
- **GKE** — un sidecar `cloud-sql-proxy` écoute sur `127.0.0.1:5432`
  (`DB_HOST`/`DB_IP` se résolvent en loopback) ; la chaîne de repli du point d'entrée
  (`DB_HOST` → `DB_IP` → `127.0.0.1`) couvre les deux cas de manière identique, sans
  nécessiter de logique distincte dans la couche Common.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

La `readiness_probe` du module Common est un contrôle fixe **HTTP `GET /`** avec
un délai initial de 30 secondes, un délai d'expiration de 5 secondes, une période de 10
secondes et un seuil d'échec de 3 tentatives — la page de connexion/d'accueil renvoie
200 sans authentification ; elle n'a donc besoin d'aucun identifiant pour réussir.
`startup_probe` et `liveness_probe` sont des variables transmises
(`var.startup_probe` / `var.liveness_probe`) dont les valeurs par défaut du module
Common sont, pour le démarrage, HTTP `GET /`, un délai initial de 60 secondes, un délai
d'expiration de 10 secondes, une période de 15 secondes et un seuil d'échec de 30
tentatives (dimensionnés pour absorber l'achèvement de la mise en place du schéma par le
job `chatwoot-prepare` avant le conteneur de l'application) ; la vivacité utilise le
même chemin avec un délai d'expiration de 5 secondes, une période de 30 secondes et un
seuil de 3 tentatives.

- **Cloud Run** les utilise directement comme sondes de démarrage et de vivacité au
  niveau du service.
- **GKE** utilise les mêmes valeurs par défaut pour ses sondes de démarrage et de
  vivacité, plus la `readiness_probe` propre au module Common au niveau du conteneur —
  les deux ciblent `/`, puisque Chatwoot n'expose aucun point de terminaison de santé
  distinct non authentifié.

Comme la préparation du schéma (`chatwoot-prepare`) s'exécute entièrement dans un job
d'initialisation avant le démarrage du conteneur de l'application, la généreuse fenêtre
de démarrage doit surtout couvrir le temps de démarrage de Rails, et non des migrations
dans le conteneur.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket **Cloud Storage** dédié (`name_suffix = "storage"`, classe `STANDARD`,
`force_destroy = true`, versionnage désactivé, `public_access_prevention
= "enforced"`) est déclaré ici et provisionné par le socle, qui accorde également
l'accès au compte de service de la charge de travail. Il est distinct du stockage des
pièces jointes téléversées de Chatwoot, qui réside par défaut sur NFS
(`/opt/chatwoot/storage`) plutôt que dans ce bucket GCS. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~chatwoot"
```

---

Pour la configuration propre à Chatwoot exposée aux utilisateurs (variables par groupe,
sorties, et manière d'explorer chaque service depuis la console et la CLI), consultez
les guides de plateforme : **[Chatwoot_GKE](Chatwoot_GKE.md)** et
**[Chatwoot_CloudRun](Chatwoot_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Chatwoot sur GKE Autopilot](Chatwoot_GKE.md) — cette configuration déployée sur GKE.
