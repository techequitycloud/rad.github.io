---
title: "Maybe Finance sur Google Cloud Run"
description: "Référence de configuration pour déployer Maybe Finance sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/MaybeFinance_CloudRun.md @ 3055034 sha256:434be1a16e1b -->

# Maybe Finance sur Google Cloud Run {#maybe-finance-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/MaybeFinance_CloudRun.png" alt="Maybe Finance sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Maybe (Maybe Finance) est une alternative open source et auto-hébergée à
Mint/Monarch pour la gestion des finances personnelles et du patrimoine —
budgétisation, suivi de la valeur nette, catégorisation des transactions et
agrégation de plusieurs comptes, construite sur Ruby on Rails. Ce module déploie
Maybe sur **Cloud Run v2** en s'appuyant sur le socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Maybe et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run
— identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Maybe s'exécute sous forme d'un unique conteneur Rails/Puma sur Cloud Run v2, avec
un processus de tâches d'arrière-plan Sidekiq démarré à ses côtés dans le même
conteneur par le point d'entrée cloud. Le déploiement assemble un ensemble ciblé
de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Rails/Puma sur le port 3000, 2 vCPU / 4 GiB par défaut ; Sidekiq s'exécute comme processus d'arrière-plan dans le même conteneur |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — une garde au moment du plan n'accepte que `POSTGRES_13`/`14`/`15` (ou `NONE`) ; MySQL est rejeté |
| Tâches d'arrière-plan et interface temps réel | Redis (via la VM NFS partagée, ou un hôte explicite) | Obligatoire — une précondition fait échouer le plan si `enable_redis = false` ; alimente Sidekiq (synchronisation des comptes, traitement des imports, notifications) |
| Persistance des fichiers | Cloud Filestore (NFS) | Les pièces jointes persistent sous `/opt/maybefinance/storage` ; c'est aussi la source par défaut de l'adresse IP de l'hôte Redis |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est provisionné automatiquement par `MaybeFinance_Common` ; la variable `storage_buckets` par défaut ajoute un bucket `data` |
| Secrets | Secret Manager | `SECRET_KEY_BASE` généré automatiquement (clé de session/chiffrement Rails) ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` vaut par défaut `POSTGRES_15`
  et une précondition au moment du plan (`validation.tf`) rejette toute valeur
  autre que `POSTGRES_13`/`14`/`15`/`NONE` — MySQL n'est pas pris en charge.
- **Redis est obligatoire, pas facultatif.** Une précondition fait échouer le plan
  purement et simplement si `enable_redis = false`. Lorsque `redis_host` est
  laissé vide, `enable_nfs` doit rester à `true` afin que l'adresse IP du serveur
  NFS partagé serve d'hôte Redis.
- **Cloud SQL est joint par défaut en TCP sur IP privée, et non par un socket.**
  Contrairement à la plupart des applications à module Common,
  `enable_cloudsql_volume` vaut ici par défaut **`false`** : le pilote `pg` de
  Rails ne sait pas analyser le DSN de socket Unix de Cloud SQL, si bien que le
  module se passe du sidecar Auth Proxy et se connecte plutôt via l'adresse IP
  privée de l'instance. Le point d'entrée cloud fait correspondre les variables
  `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` du socle aux variables
  d'environnement distinctes de Maybe
  `DB_HOST`/`DB_PORT`/`POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD` et définit
  `PGSSLMODE=require` (Cloud SQL refuse le TCP non chiffré sur IP privée) ; si
  `enable_cloudsql_volume` est activé, `DB_HOST` devient un répertoire de socket
  et le point d'entrée se rabat sur `DB_IP` en TCP au lieu de tenter d'utiliser
  directement le chemin du socket.
- **La mise à l'échelle à zéro est la valeur par défaut (`min_instance_count = 0`,
  `cpu_always_allocated = false`).** C'est un choix privilégiant le coût, mais
  cela signifie que le worker Sidekiq co-localisé ne s'exécute que lorsqu'une
  instance se trouve être active — définissez `min_instance_count = 1` et
  `cpu_always_allocated = true` pour que les tâches d'arrière-plan
  (synchronisation des comptes, traitement des imports, notifications)
  s'exécutent en continu, comme avec les valeurs par défaut de la variante GKE.
- **Conteneur web + worker combiné, et non un sidecar.** Le point d'entrée cloud
  lance `bundle exec sidekiq` en arrière-plan puis fait un `exec` du serveur web
  Rails au premier plan du *même* conteneur — Maybe n'est pas déployé avec un
  worker distinct dans `additional_services`. Si `REDIS_URL` se résout en valeur
  vide, le point d'entrée renonce entièrement à démarrer Sidekiq plutôt que de
  planter.
- **`SECRET_KEY_BASE` est généré une seule fois** par `MaybeFinance_Common` et
  stocké dans Secret Manager, partagé à l'identique par les processus web et
  Sidekiq. Rails l'utilise pour signer les sessions/cookies et pour dériver la clé
  qui chiffre les colonnes chiffrées par ActiveRecord.
- **Le schéma est créé par une tâche d'initialisation, pas au démarrage.** La
  tâche `maybefinance-migrate` exécute `rails db:prepare` pendant l'apply ; le
  point d'entrée d'exécution n'exécute jamais les migrations.
- **`container_image_source = "custom"`.** Cloud Build construit une image
  d'enveloppe légère `FROM ghcr.io/maybe-finance/maybe:<version>`.
  `application_version` vaut par défaut `"stable"` ; une demande `"latest"` est
  associée au canal épinglé `stable` via l'ARG de build propre à l'application
  `MAYBE_VERSION` (l'argument de build générique `APP_VERSION` du socle n'est
  volontairement pas utilisé).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
des services et des ressources figurent dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Maybe (web + Sidekiq) {#a-cloud-run--the-maybe-service-web--sidekiq}

Maybe s'exécute sous forme de service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre les nombres minimal et maximal
d'instances. Le serveur web Rails/Puma et le worker Sidekiq s'exécutent comme deux
processus dans le même conteneur, partageant `SECRET_KEY_BASE` et la connexion
Redis. Chaque déploiement crée une révision immuable ; le trafic peut être réparti
entre révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions,
  le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Maybe stocke toutes les données applicatives (comptes, transactions, budgets,
utilisateurs) dans une instance Cloud SQL for PostgreSQL 15 gérée. Contrairement
à la variante GKE (qui joint Cloud SQL via un sidecar Auth Proxy en loopback), le
service Cloud Run se connecte via l'**IP privée de l'instance avec
`sslmode=require`** — `enable_cloudsql_volume` vaut par défaut `false` parce que
Rails ne sait pas analyser le DSN de type socket que le proxy présenterait sinon.
Au premier déploiement, la tâche `db-init` crée la base de données et
l'utilisateur de l'application, accorde au rôle applicatif `cloudsqlsuperuser`
(afin que la propre migration de Maybe puisse créer des extensions Postgres sans
accès superutilisateur) et crée au préalable l'extension `pgcrypto` ;
`maybefinance-migrate` exécute ensuite `rails db:prepare`.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe figurent dans les [sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Filestore (NFS) et Redis {#c-cloud-filestore-nfs--redis}

**Cloud Filestore (NFS)** est monté sur `/opt/maybefinance/storage`
(`enable_nfs = true` par défaut) afin que les pièces jointes téléversées
persistent d'une révision à l'autre. Maybe requiert aussi **Redis**, qui est
obligatoire — une précondition au moment du plan bloque `enable_redis = false`.
Lorsque `redis_host` est laissé vide, la variable injectée `REDIS_HOST` se résout
en l'adresse IP du serveur NFS partagé (la VM NFS héberge aussi Redis selon la
convention de plateforme de ce dépôt), c'est pourquoi `enable_nfs` doit rester à
`true` sauf si un `redis_host` explicite est fourni.

- **Console :** Filestore → Instances ; Compute Engine → Instances de VM (la VM
  NFS, si elle exécute aussi Redis).
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  redis-cli -h <redis-host> ping
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les mécanismes de découverte et de
provisionnement NFS et d'injection de Redis.

### D. Cloud Storage {#d-cloud-storage}

Un bucket **`storage`** est provisionné automatiquement par `MaybeFinance_Common`,
et la variable `storage_buckets` par défaut ajoute un second bucket **`data`**.
Aucun des deux n'est monté par défaut dans le système de fichiers du conteneur —
`gcs_volumes` est vide d'origine — ils existent donc en tant que stockage
provisionné mais restent inertes tant qu'ils ne sont pas explicitement raccordés.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~maybefinance"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### E. Secret Manager {#e-secret-manager}

Un secret propre à Maybe est généré automatiquement et stocké dans Secret
Manager : `SECRET_KEY_BASE` (`secret-<prefix>-maybefinance-secret-key-base`), une
valeur aléatoire de 64 caractères partagée par le processus web Rails et le worker
Sidekiq. Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~maybefinance"
  gcloud secrets versions access latest --secret=<secret-key-base-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est joignable par défaut via son URL `run.app` (`ingress_settings
= "all"`). Un équilibreur de charge HTTPS externe avec domaine personnalisé,
Cloud CDN et Cloud Armor peut y être ajouté ; les paramètres d'entrée et la
sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux du conteneur (`RAILS_LOG_TO_STDOUT = "true"`) sont acheminés vers
Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud
Monitoring, avec en option des tests de disponibilité et des règles d'alerte.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord
  / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Maybe Finance {#3-maybe-finance-application-behaviour}

- **Configuration de la base de données au premier déploiement.** La tâche
  `db-init` exécute `db-init.sh` avec `postgres:15-alpine`. Elle se connecte en
  TCP sur IP privée (`sslmode=require`), crée de manière idempotente la base de
  données et l'utilisateur de l'application, accorde les privilèges, accorde au
  rôle applicatif `cloudsqlsuperuser` (les utilisateurs applicatifs de Cloud SQL
  ne sont pas de vrais superutilisateurs, ce qui permet donc à la propre migration
  de Maybe de créer des extensions Postgres) et crée au préalable `pgcrypto` par
  mesure de précaution supplémentaire. La tâche peut être réexécutée sans risque.
- **La migration du schéma est une tâche d'initialisation distincte.**
  `maybefinance-migrate` exécute `bundle exec rails db:prepare` sur l'image Maybe
  construite (`image = null` dans la spécification de la tâche, elle réutilise
  donc l'image et la chaîne d'outils construites pour l'application), dépend de
  l'achèvement préalable de `db-init` et effectue jusqu'à 3 nouvelles tentatives
  (`max_retries = 3`, `timeout_seconds = 1200`, `memory_limit = 2Gi`).
- **Inscription de l'administrateur au premier lancement, et non un secret créé
  automatiquement.** `SELF_HOSTED = "true"` active l'interface d'auto-hébergement
  de Maybe, qui permet au premier visiteur d'inscrire le compte administrateur
  initial via l'interface web — il n'existe aucun secret de mot de passe
  administrateur généré automatiquement à récupérer.
  {/* TODO: verify whether a first-run invite/registration lock exists after the first admin is created */}
- **`SECRET_KEY_BASE` est immuable en pratique.** Il est généré une seule fois par
  `MaybeFinance_Common` et partagé par les processus web et Sidekiq. Le faire
  tourner après le premier démarrage invalide les sessions existantes et rend
  illisibles les colonnes chiffrées par ActiveRecord.
- **La correspondance des variables d'environnement de la base de données se fait
  dans le point d'entrée cloud, pas via un DSN sous forme d'URL.** La plateforme
  injecte `DB_HOST` (l'IP privée de l'instance sur Cloud Run, puisque
  `enable_cloudsql_volume` vaut par défaut `false`), `DB_PORT`, `DB_NAME`,
  `DB_USER`, `DB_PASSWORD` et `DB_IP` ; le point d'entrée les fait correspondre à
  `POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD` (la convention
  `config/database.yml` de Rails pour Maybe) et définit `PGSSLMODE=require` car
  l'hôte résolu est une véritable IP privée, et non le loopback.
- **Raccordement de Redis.** `REDIS_URL` est construit à partir des variables
  injectées `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` s'il n'est pas déjà défini. Si
  `REDIS_URL` finit vide (Redis injoignable), le point d'entrée renonce
  entièrement à démarrer Sidekiq — les tâches d'arrière-plan cessent
  silencieusement de s'exécuter au lieu de faire planter le conteneur.
- **Les tâches d'arrière-plan nécessitent une instance toujours active.** Comme
  Sidekiq est démarré dans le processus par le point d'entrée, il ne s'exécute que
  tant qu'une instance de conteneur est active. Avec les valeurs par défaut
  CloudRun (`min_instance_count = 0`, `cpu_always_allocated = false`), les
  périodes de mise à l'échelle à zéro et la limitation du CPU entre les requêtes
  interrompent toutes deux le traitement des tâches d'arrière-plan.
- **Chemin de santé.** La sonde de démarrage est une sonde **HTTP** `GET /up` avec
  une marge généreuse pour un premier démarrage lent (`initial_delay_seconds = 60`,
  `period_seconds = 15`, `failure_threshold = 30` — environ 8 minutes de marge).
  La sonde d'activité est également une sonde **HTTP** `GET /up`
  (`initial_delay_seconds = 60`, `period_seconds = 30`,
  `failure_threshold = 3`).
- **Inspecter l'exécution des tâches :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <maybefinance-migrate-job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement (la balise `{{UIMeta group=N}}` dans la description de
chaque variable de `variables.tf`). Seuls les paramètres propres à Maybe ou
notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement et leurs valeurs par
défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `maybefinance` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Maybe` | Nom lisible affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `stable` | Tag d'image `ghcr.io/maybe-finance/maybe` utilisé comme base du build personnalisé ; `latest` est associé au canal de version épinglé `stable` via `MAYBE_VERSION`. |

`application_display_name`/`application_description` sont des déclarations miroir
inertes du socle (jamais transmises à l'appel du socle) — l'identité effective
provient de `display_name`/`description` ci-dessus.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | Image d'enveloppe légère construite FROM l'image GHCR amont. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance ; Maybe recommande au moins 2Gi. |
| `cpu_always_allocated` | `false` | Valeur par défaut privilégiant le coût, avec démarrage à froid. Définissez `true` (avec `min_instance_count >= 1`) pour que Sidekiq traite les tâches en continu. |
| `container_resources` | _(null)_ | Remplace `cpu_limit`/`memory_limit` lorsqu'il est défini. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro par défaut — diffère du `min=1` de la variante GKE ; arrête le worker Sidekiq co-localisé entre les requêtes. |
| `max_instance_count` | `5` | Plafond de coût. |
| `container_port` | `3000` | Port natif Rails/Puma de Maybe. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | **Désactivé par défaut pour Maybe** — Rails ne sait pas analyser le DSN de socket Cloud SQL, l'application se connecte donc plutôt en TCP sur IP privée. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Pertinent uniquement si `enable_cloudsql_volume` est activé. |
| `container_protocol` | `http1` | Version du protocole HTTP. |
| `traffic_split` | `[]` | Répartit le trafic entre révisions pour des déploiements par étapes. |
| `max_revisions_to_retain` | `7` | Déclaré par souci de cohérence avec la convention ; non référencé par le déploiement de ce module. |
| `enable_image_mirroring` | `true` | Toujours vrai — l'image de base GHCR est mise en miroir dans Artifact Registry avant le build de l'enveloppe. |
| `container_build_config` | `{ enabled = true }` | Paramètres de build ; l'ARG de build `MAYBE_VERSION` est défini à partir de `application_version` dans `MaybeFinance_Common`, et n'est pas exposé comme variable de premier niveau. |
| `additional_services` / `additional_containers` | `[]` | Non utilisés par Maybe (Sidekiq s'exécute dans le processus, ni comme sidecar ni comme service distinct). |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accessibilité publique de l'interface web. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `network_name` | `""` | Découvre automatiquement le réseau VPC géré par Services_GCP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les valeurs essentielles Rails/Maybe (`RAILS_ENV`, `SELF_HOSTED`, `RAILS_LOG_TO_STDOUT`, etc.) sont définies automatiquement par `MaybeFinance_Common`. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; à augmenter pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Initialisation personnalisée et SQL {#group-9--custom-initialization--sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutent du SQL depuis
un bucket GCS après le provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket GCS supplémentaire en plus du bucket `storage` provisionné automatiquement. |
| `enable_nfs` | `true` | Les pièces jointes persistent et sont partagées entre révisions ; c'est aussi la source par défaut de l'adresse IP de l'hôte Redis. |
| `nfs_mount_path` | `/opt/maybefinance/storage` | Emplacement où Maybe stocke les pièces jointes téléversées. |
| `nfs_instance_name` / `nfs_instance_base_name` | _(découverte automatique)_ | Nommage de la VM NFS existante/en ligne. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (requiert gen2) ; non utilisés d'origine. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Une précondition au moment du plan restreint cette valeur à `POSTGRES_13`/`14`/`15`/`NONE` ; MySQL est rejeté. |
| `db_name` | `maybefinance` | Nom effectif de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `maybefinance` | Utilisateur effectif de la base de données de l'application ; mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Laissé désactivé — `db-init.sh` crée déjà au préalable `pgcrypto` grâce à l'octroi de `cloudsqlsuperuser`. |
| `enable_mysql_plugins` / `mysql_plugins` | `false` / `[]` | Inutilisés — Maybe fonctionne uniquement avec PostgreSQL. |
| `application_database_name` / `application_database_user` | `crappdb` / `crappuser` | Déclarations miroir du socle **inertes** (jamais transmises à `main.tf`) — le nom et l'utilisateur réels de la base de données proviennent de `db_name`/`db_user` ci-dessus via `MaybeFinance_Common`. |

### Groupe 13 — Tâches et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les tâches intégrées `db-init` + `maybefinance-migrate`. |
| `cron_jobs` | `[]` | Non transmis — Maybe n'a aucune tâche récurrente planifiée par la plateforme ; son propre travail d'arrière-plan s'exécute dans le processus via Sidekiq. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/up`, délai de 60s, 30 tentatives | Sonde de démarrage. Prévoyez environ 8 minutes au premier démarrage. |
| `liveness_probe` | HTTP `/up`, délai de 60s | Sonde d'activité. |
| `startup_probe_config` / `health_check_config` | HTTP `/up` | Sondes structurées alternatives. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut, à activer explicitement. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire** — une précondition fait échouer le plan s'il est défini à `false`. |
| `redis_host` | `""` | Laissez vide pour utiliser l'adresse IP du serveur NFS (requiert `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (IP privée sur Cloud Run) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration (`db-init`, `maybefinance-migrate`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration
> par le moteur du socle [App_CloudRun](App_CloudRun.md), ainsi que par ses propres
> gardes `validation.tf` (`min` ≤ `max`, Redis obligatoire, un hôte Redis doit
> pouvoir être résolu, `database_type` limité à PostgreSQL, pas d'Auth Proxy sans
> véritable base de données). Une configuration invalide fait échouer le **plan**
> avec une erreur claire et nommée avant la création de toute ressource, si bien
> que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à
> l'apply ou à l'exécution.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (ou `13`/`14`) | Critique | Un moteur autre que PostgreSQL est rejeté au moment du plan ; en forcer un en contournant la garde casse l'installateur et toutes les requêtes. |
| `enable_redis` | `true` | Critique | La précondition au moment du plan bloque purement et simplement `false` — sans Redis, Maybe n'a aucune file de tâches d'arrière-plan fonctionnelle. |
| `db_name` / `db_user` | À définir une fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `SECRET_KEY_BASE` (généré automatiquement) | Ne jamais le faire tourner après le premier démarrage | Critique | Le faire tourner invalide toutes les sessions et rend illisibles les colonnes chiffrées par ActiveRecord. |
| `enable_cloudsql_volume` | `false` (Cloud Run) | Critique | L'activer transforme `DB_HOST` en un répertoire de socket que Rails ne sait pas analyser directement ; le point d'entrée se rabat sur `DB_IP`, mais une valeur erronée `database_type = "NONE"` combinée à `enable_cloudsql_volume = true` est bloquée au moment du plan, car le sidecar proxy n'aurait aucune instance à laquelle se connecter. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Lorsque Redis est activé mais que `enable_nfs` est désactivé et qu'aucun hôte n'est défini, la précondition au moment du plan échoue ; si `enable_nfs` est désactivé après un déploiement fonctionnel, les pièces jointes téléversées deviennent éphémères et l'hôte Redis peut devenir obsolète. |
| `min_instance_count` / `cpu_always_allocated` | `1` / `true` en production | Élevé | Avec les valeurs par défaut privilégiant le coût (`0` / `false`), le worker Sidekiq co-localisé ne s'exécute que lorsqu'une instance se trouve être active — la synchronisation des comptes, le traitement des imports et les notifications cessent silencieusement entre les requêtes et pendant les fenêtres de mise à l'échelle à zéro. |
| `memory_limit` | `4Gi` (par défaut) | Élevé | Le processus combiné Rails + Sidekiq est gourmand en mémoire sous les charges de travail d'import/de synchronisation ; Maybe recommande au moins 2Gi. |
| `SELF_HOSTED` (injecté automatiquement à `"true"`) | Inscrire rapidement le premier administrateur | Élevé | Laisser le déploiement joignable avant qu'un administrateur ne s'inscrive permet à quiconque dispose de l'URL de s'approprier le compte administrateur initial. |
| `ingress_settings` | `all` | Moyen | La définir à `internal` bloque l'accès à l'interface web pour toute personne extérieure au VPC. |
| `backup_retention_days` | `7` (à augmenter en prod) | Moyen | Trop court pour une rétention de conformité. |
| `enable_cloud_armor` | à activer en production | Moyen | L'interface d'administration est publiquement accessible sans protection WAF. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des
images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à Maybe, partagée avec la variante GKE, se trouve dans le module
`MaybeFinance_Common` — voir **[MaybeFinance_Common](MaybeFinance_Common.md)**
pour les secrets, l'amorçage de la base de données, le comportement du point
d'entrée, les sondes de santé et le stockage.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Maybe Finance sur Cloud Run](../labs/MaybeFinance_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Maybe Finance sur GKE Autopilot](MaybeFinance_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [MaybeFinance Common — Configuration applicative partagée](MaybeFinance_Common.md) — la configuration partagée par les deux cibles de déploiement.
