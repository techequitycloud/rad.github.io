---
title: "Chatwoot sur Google Cloud Run"
description: "Référence de configuration pour déployer Chatwoot sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Chatwoot_CloudRun.md @ 3055034 sha256:85a28d8e02aa -->

# Chatwoot sur Google Cloud Run {#chatwoot-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Chatwoot_CloudRun.png" alt="Chatwoot sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Chatwoot est une plateforme open source de helpdesk multicanal et d'engagement
client (boîtes de réception e-mail, chat en direct, réseaux sociaux et messageries,
suivi des SLA et rapports) qui constitue une alternative conforme au RGPD à Zendesk
ou Intercom. Ce module déploie Chatwoot sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Chatwoot et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Chatwoot s'exécute sous la forme d'un unique conteneur Ruby on Rails qui réunit le
serveur web et un worker Sidekiq d'arrière-plan dans une même arborescence de
processus. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Rails + worker Sidekiq co-localisé sur le port 3000, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — `database_type` est fixé à `POSTGRES_15` ; l'extension `vector` (pgvector) est activée pour les fonctionnalités d'IA et de recherche de Chatwoot |
| Cache et file d'attente | Redis (hébergé sur le serveur NFS ou externe) | Sert de support à la file de jobs de Sidekiq et au pub/sub d'ActionCable ; activé par défaut |
| Persistance des fichiers | Cloud Filestore (NFS) | Les pièces jointes sont conservées sous `/opt/chatwoot/storage`, partagées entre les révisions |
| Stockage objet | Cloud Storage | Un bucket suffixé `storage` provisionné automatiquement par le module Common, plus un bucket `data` par défaut déclaré dans `storage_buckets` |
| Secrets | Secret Manager | `SECRET_KEY_BASE` de Rails généré automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` est codé en dur à `POSTGRES_15`
  par la sortie `config` du module Common ; le schéma de Chatwoot et ses fonctionnalités
  de recherche reposant sur pgvector l'exigent.
- **Image construite sur mesure.** `container_image_source = "custom"` — le module
  Common effectue un build `FROM chatwoot/chatwoot:${APP_VERSION}` et y ajoute un
  `cloud-entrypoint.sh` qui fait correspondre les variables d'environnement `DB_*`/`REDIS_*` de la fondation
  à la convention `POSTGRES_*`/`REDIS_URL` de Chatwoot, puis lance Sidekiq en
  arrière-plan avant d'exécuter (exec) le serveur Rails. L'image s'exécute **en tant que root**
  — à l'image de l'image amont, dont `/app`/`/app/tmp` appartiennent à root et ne sont
  pas accessibles en écriture au groupe ; l'étape `create_tmp_directories` de Rails a
  donc besoin de root pour réussir.
- **Cloud SQL est joint via un socket Unix, et non via le loopback TCP.** Avec
  `enable_cloudsql_volume = true`, Cloud Run monte le socket du Cloud SQL Auth Proxy
  sur `/cloudsql/<instance>` ; le point d'entrée transmet tel quel le
  `DB_HOST` injecté en tant que `POSTGRES_HOST` (le pilote Ruby `pg` accepte un
  chemin de répertoire comme hôte de socket Unix). Cela diffère de la variante GKE,
  où un proxy sidecar écoute sur `127.0.0.1:5432`.
- **Deux Jobs d'initialisation s'exécutent en séquence.** `db-init` (crée la base de
  données, le rôle et les droits — y compris un droit `cloudsqlsuperuser` afin que
  Chatwoot puisse créer lui-même les extensions Postgres) s'exécute en premier, puis
  `chatwoot-prepare` (`bundle exec rails db:chatwoot_prepare`) crée ou met à niveau
  le schéma et initialise les valeurs par défaut, en utilisant **l'image de
  l'application Chatwoot construite**. Il n'y a aucune étape de migration dans le
  conteneur ; la mise en place du schéma se fait entièrement dans ces deux Jobs, avant
  que le conteneur de l'application n'ait à servir du trafic.
- **Redis est activé par défaut** (`enable_redis = true`). Laissez `redis_host` vide
  pour utiliser l'IP du Redis partagé hébergé sur le serveur NFS, que la fondation
  injecte automatiquement.
- **`SECRET_KEY_BASE` est généré une seule fois et partagé** entre le processus web
  Rails et le worker Sidekiq (co-localisés dans le même conteneur) — il doit rester
  stable d'un redémarrage ou redéploiement à l'autre, car Rails l'utilise pour signer
  les sessions et chiffrer les colonnes chiffrées par ActiveRecord.
- **NFS est activé par défaut** (`enable_nfs = true`) afin que les pièces jointes
  téléversées soient conservées et partagées entre les révisions sur `/opt/chatwoot/storage`.
- **`cpu_always_allocated` vaut `false` par défaut** (facturation à la requête,
  démarrage à froid). Sidekiq (notifications, webhooks, affectation automatique) et
  les mises à jour en temps réel de l'interface par ActionCable ne s'exécutent que
  pendant le traitement d'une requête ou pendant la fenêtre de maintien à chaud qui la
  suit ; définissez `cpu_always_allocated =
  true` avec `min_instance_count >= 1` pour assurer une livraison en arrière-plan
  continue.
- **`ENABLE_ACCOUNT_SIGNUP` vaut `"false"` par défaut** — l'inscription libre des
  administrateurs/agents est désactivée sur un helpdesk fraîchement déployé ;
  modifiez-la via `environment_variables` si vous souhaitez une inscription publique.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Chatwoot {#a-cloud-run--the-chatwoot-service}

Chatwoot s'exécute sous la forme d'un service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre les nombres minimal et maximal
d'instances. Chaque révision (l'équivalent d'un pod) exécute à la fois le serveur web
Rails et un processus worker Sidekiq d'arrière-plan dans le même conteneur ; le service
ne doit donc pas rester longtemps à zéro instance si la livraison rapide des messages
et des notifications compte.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic,
  les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Chatwoot stocke toutes les données applicatives (conversations, contacts, boîtes de
réception, agents, rapports) dans une instance gérée Cloud SQL for PostgreSQL 15, y
compris l'extension `vector` utilisée par ses fonctionnalités d'IA et de recherche. Le
service se connecte de manière privée via le **Cloud SQL Auth Proxy**, par un socket
Unix sur `/cloudsql/<instance>` ; aucune IP publique n'est exposée. Au premier
déploiement, le Job `db-init` crée la base de données applicative, le rôle et les
droits (y compris un droit `cloudsqlsuperuser` afin que les appels de création
d'extensions de Chatwoot réussissent), puis le Job `chatwoot-prepare` exécute
`rails db:chatwoot_prepare` pour construire le schéma.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour
le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié, suffixé `storage`, est provisionné automatiquement
par le module Common, à côté du bucket `data` par défaut déclaré dans
`storage_buckets`. Des buckets supplémentaires peuvent être déclarés de la même
manière.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~chatwoot"
  gcloud storage ls gs://<bucket-name>/
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (file d'attente, cache et pub/sub) {#d-redis-queue-cache-and-pubsub}

Sidekiq (la file de jobs d'arrière-plan de Chatwoot) et ActionCable (mises à jour de
l'interface en temps réel) nécessitent tous deux Redis. `enable_redis = true` par
défaut ; lorsque `redis_host` est laissé vide, la fondation injecte l'IP du Redis
partagé hébergé sur le serveur NFS, et le point d'entrée du conteneur construit
`REDIS_URL` à partir de `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` au démarrage — ce
mécanisme s'auto-répare, que `redis_host` ait été défini explicitement ou laissé vide.

- **Console :** Memorystore → Redis (si vous utilisez une instance dédiée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Un secret propre à Chatwoot est généré automatiquement et stocké dans Secret
Manager : `SECRET_KEY_BASE` (la clé de signature des sessions et de chiffrement
ActiveRecord de Rails, partagée à l'identique entre les processus web et Sidekiq, et
également injectée dans le Job d'initialisation `chatwoot-prepare`). Le mot de passe de
la base de données est géré séparément par la fondation.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~chatwoot"
  gcloud secrets versions access latest --secret=secret-<resource-prefix>-chatwoot-secret-key-base --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, le service est joignable à son URL `run.app` (`ingress_settings =
"all"`), ce qui permet aux intégrations de canaux externes (webhooks, widgets de chat
en direct intégrés) de l'atteindre. Un équilibreur de charge HTTPS externe avec un
domaine personnalisé, Cloud CDN et Cloud Armor peuvent être ajoutés par-dessus.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr du conteneur (celles des processus Rails et Sidekiq, puisqu'ils
partagent un conteneur) sont envoyées vers Cloud Logging ; les métriques de Cloud Run
et de Cloud SQL vers Cloud Monitoring, avec des tests de disponibilité et des règles
d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Chatwoot {#3-chatwoot-application-behaviour}

- **La configuration de la base de données au premier déploiement s'exécute sous la
  forme de deux Jobs chaînés.** `db-init` (image
  `postgres:15-alpine`) se connecte via le socket Cloud SQL, crée de façon idempotente
  le rôle et la base de données, accorde les privilèges, accorde
  `cloudsqlsuperuser` au rôle de l'application (nécessaire, car l'utilisateur
  applicatif de Cloud SQL n'est pas un véritable superutilisateur Postgres et le
  `schema.rb` de `db:chatwoot_prepare` appelle `enable_extension` pour plusieurs
  extensions), et pré-crée par précaution `vector`,
  `pg_stat_statements`, `pg_trgm` et `pgcrypto`. `chatwoot-prepare`
  dépend de `db-init` (`depends_on_jobs = ["db-init"]`) et exécute `bundle exec
  rails db:chatwoot_prepare` avec l'image de l'application Chatwoot construite, et non
  une image cliente générique. Les deux Jobs ont `execute_on_apply = true`.
- **Aucune migration dans le conteneur.** La création et la mise à niveau du schéma
  sont entièrement prises en charge par le Job d'initialisation `chatwoot-prepare`
  avant que le conteneur de l'application ne soit censé servir du trafic — le point
  d'entrée d'exécution ne lance pas `rails
  db:migrate`.
- **`chatwoot-prepare` préfère TCP au socket lorsque les deux sont disponibles.**
  Son script vérifie explicitement si `DB_HOST` est un chemin de socket (commençant
  par `/`) ; si c'est le cas **et** que `DB_IP` (l'IP privée de l'instance) est
  également présent, il se connecte plutôt via `DB_IP` avec `PGSSLMODE=require`, car le
  socket Unix Cloud SQL n'apparaît pas toujours à temps dans un Job Cloud Run. Il ne se
  rabat sur le chemin littéral du socket que lorsque `DB_IP` n'est pas défini. Le point
  d'entrée du conteneur applicatif, qui s'exécute en continu, ne dispose pas d'un tel
  repli — il transmet `DB_HOST` tel quel en tant que `POSTGRES_HOST`, en comptant sur
  la présence du socket pour le service lui-même.
- **Alias des variables d'environnement de la base de données.** La plateforme injecte
  `DB_HOST` (le répertoire du socket Cloud SQL sur Cloud Run), `DB_PORT`, `DB_NAME`,
  `DB_USER`, `DB_PASSWORD` ; `cloud-entrypoint.sh` (intégré à l'image) les fait
  correspondre à la convention
  `POSTGRES_HOST`/`POSTGRES_PORT`/`POSTGRES_DATABASE`/
  `POSTGRES_USERNAME`/`POSTGRES_PASSWORD` de Chatwoot.
- **L'URL Redis s'auto-répare.** Si `REDIS_URL` n'est pas déjà défini, le point
  d'entrée la construit à partir des `REDIS_HOST`/`REDIS_PORT`/
  `REDIS_AUTH` injectés — ce qui couvre à la fois le cas d'un `redis_host` explicite et
  le cas par défaut du repli sur NFS.
- **Sidekiq s'exécute de manière co-localisée, en arrière-plan.** `cloud-entrypoint.sh`
  lance `bundle exec sidekiq -C config/sidekiq.yml &` avant d'exécuter (exec) le
  serveur Rails ; un `trap` sur `TERM`/`INT` arrête Sidekiq en même temps que le
  conteneur. Comme Sidekiq ne traite les jobs d'arrière-plan (livraison sur les canaux,
  notifications, rapports) que pendant que le conteneur s'exécute, conservez
  `min_instance_count >= 1` (et envisagez `cpu_always_allocated = true`) si une
  livraison rapide compte davantage que le coût au repos.
- **`ENABLE_ACCOUNT_SIGNUP` est désactivé par défaut.** Le module Common injecte
  `ENABLE_ACCOUNT_SIGNUP = "false"` avec `RAILS_ENV=production`,
  `RAILS_LOG_TO_STDOUT=true` et `RAILS_MAX_THREADS=5` (dimensionné au-dessus de la
  concurrence par défaut de Cloud Run pour éviter l'erreur « could not obtain a
  connection from the pool »). L'interface d'accueil de Chatwoot crée le premier compte
  administrateur de manière interactive lors de la première visite — il n'existe aucun
  secret d'identifiant administrateur généré automatiquement pour ce module.
- **Chemin de santé.** Les sondes de démarrage et de vivacité sont des requêtes
  **HTTP** `GET /` — la page de connexion/d'accueil renvoie 200 sans authentification.
  La `startup_probe` par défaut accorde un délai initial de 60 secondes plus jusqu'à 30
  tentatives à intervalle de 15 secondes (~8 minutes) avant d'échouer, afin d'absorber
  l'exécution de `chatwoot-prepare` avant le conteneur de l'application.
- **Signal d'arrêt du proxy Cloud SQL.** Les Jobs d'initialisation signalent au sidecar
  Cloud SQL Auth Proxy de s'arrêter à la fin de leur exécution, afin que le pod du Job
  se termine au lieu de rester bloqué sur un sidecar actif.
- **Inspecter l'exécution des jobs et la configuration en cours :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <chatwoot-prepare-job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Chatwoot ou importants pour celui-ci sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet, identité et intégration de la recherche {#group-1--project-identity--search-integration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |
| `elasticsearch_url` | `""` | Point de terminaison Elasticsearch facultatif (par ex. issu de `Elasticsearch_GKE`) pour la recherche plein texte de Chatwoot. Laissez vide pour la désactiver. |
| `elasticsearch_username` | `""` | Nom d'utilisateur Elasticsearch ; laissez vide lorsque `xpack.security.enabled` vaut false. |
| `elasticsearch_password_secret` | `""` | ID du secret Secret Manager contenant le mot de passe Elasticsearch ; lorsqu'il est défini, il est injecté en tant que `ELASTICSEARCH_PASSWORD` et le compte de service de la charge de travail reçoit `secretAccessor`. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de supervision. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `chatwoot` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Chatwoot Helpdesk` | Nom lisible affiché dans la console. |
| `description` | `Chatwoot - Open-source helpdesk and customer support platform` | Description du service. |
| `application_version` | `v4.15.1` | Tag d'image `chatwoot/chatwoot` utilisé comme base du build personnalisé. Incrémentez-le pour déclencher un nouveau build. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Build personnalisé à partir de `chatwoot/chatwoot` ; ne le définissez pas sur `prebuilt` — cela contourne le wrapper `cloud-entrypoint.sh`. |
| `cpu_limit` | `2000m` | 2 vCPU — Rails + worker Sidekiq co-localisé. |
| `memory_limit` | `4Gi` | 4 GiB recommandés ; les deux processus partagent le conteneur. |
| `cpu_always_allocated` | `false` | Valeur par défaut privilégiant le coût, avec démarrage à froid ; le travail de Sidekiq et d'ActionCable est suspendu entre les requêtes. Définissez `true` (avec `min_instance_count >= 1`) pour rétablir une livraison continue en arrière-plan. |
| `min_instance_count` | `0` | `0` active la mise à zéro ; définissez `1` pour garder le worker Sidekiq actif. |
| `max_instance_count` | `5` | Plafond standard de mise à l'échelle horizontale. |
| `container_port` | `3000` | Port du serveur Rails de Chatwoot. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages NFS et GCS Fuse. |
| `enable_cloudsql_volume` | `true` | Socket Unix du Cloud SQL Auth Proxy pour les connexions Postgres. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Chatwoot dans Artifact Registry. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est la valeur par défaut afin que les intégrations de canaux externes et le widget de chat en direct puissent atteindre le service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google. **Bloque les webhooks des canaux publics et le widget de chat en direct.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets, par ex. `{ ENABLE_ACCOUNT_SIGNUP = "true" }` pour ouvrir l'inscription libre. Les valeurs essentielles `RAILS_*`/`POSTGRES_*`/`REDIS_*` sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création des secrets avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; à augmenter pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Initialisation personnalisée et scripts SQL {#group-9--custom-initialization--sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutent du SQL depuis un
bucket GCS après le provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et conservation des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires, en plus du bucket suffixé `storage` provisionné automatiquement par le module Common. |
| `enable_nfs` | `true` | NFS est activé par défaut afin que les pièces jointes soient conservées et partagées entre les révisions. |
| `nfs_mount_path` | `/opt/chatwoot/storage` | Emplacement où Chatwoot stocke les pièces jointes téléversées. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Remplacé par une valeur fixe via la sortie `config` du module Common, quelle que soit la valeur définie ici ; Chatwoot nécessite Postgres 15+ avec pgvector. |
| `db_name` | `chatwoot` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `chatwoot` | Utilisateur de la base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `application_database_name` / `application_database_user` | `crappdb` / `crappuser` | Déclarations inertes reflétant la fondation (uniquement pour respecter la convention de miroir) — le `chatwoot.tf` de Chatwoot raccorde `db_name`/`db_user` à la place, si bien que celles-ci ne sont jamais transmises à `main.tf`. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la chaîne de jobs intégrée du module Common, `db-init` → `chatwoot-prepare`. |
| `cron_jobs` | `[]` | Non utilisé — Chatwoot n'a aucune tâche récurrente planifiée par la plateforme ; Sidekiq gère lui-même sa planification dans le processus. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` , délai initial de 60s, période de 15s, 30 tentatives | Sonde de démarrage ; dimensionnée pour absorber l'achèvement de `chatwoot-prepare` avant le conteneur de l'application. |
| `liveness_probe` | HTTP `/` , délai initial de 60s, période de 30s, 3 tentatives | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | HTTP `/` | Sondes structurées alternatives (au niveau du service) ; `startup_probe`/`liveness_probe` s'appliquent par défaut. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Requis pour la file d'attente de Sidekiq et le pub/sub d'ActionCable ; transmis à la fondation sans condition. |
| `redis_host` | `""` | Vide : utilise l'IP du Redis partagé hébergé sur le serveur NFS, que la fondation injecte. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées (y compris `application_display_name`,
`application_description`, `container_build_config`, `additional_services`,
`additional_containers`, qui ne servent qu'au miroir de la fondation, ainsi que les
surcharges de réseau et d'instance SQL) suivent le comportement standard
d'[App_CloudRun](App_CloudRun.md) et restent inertes sauf raccordement
explicite — le `chatwoot.tf` de Chatwoot ne les transmet pas.

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison de la base (répertoire du socket Cloud SQL) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État du monitoring, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `chatwoot-prepare`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut recommandées {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et leurs combinaisons* au moment du plan — un environnement
> d'exécution `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days`
> hors plage, un `database_type` invalide. Une configuration invalide fait échouer le
> **plan** avec une erreur claire et nommée avant la création de toute ressource ; la
> plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à
> l'exécution.

| Paramètre | Valeur recommandée | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (fixé par Common) | Critique | Le schéma de Chatwoot et sa recherche reposant sur pgvector exigent Postgres 15+ ; tout autre moteur casse `chatwoot-prepare`. |
| `db_name` / `db_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et rend toutes les données orphelines. |
| `SECRET_KEY_BASE` (généré automatiquement) | Ne jamais modifier | Critique | Le renouveler invalide chaque session/cookie signé et rend définitivement illisibles les colonnes chiffrées par ActiveRecord ; Sidekiq ne parviendra pas non plus à déchiffrer les jobs en cours. |
| `enable_redis` | `true` (transmis sans condition) | Critique | Sidekiq (jobs d'arrière-plan, livraison sur les canaux) et ActionCable (interface en temps réel) nécessitent tous deux Redis ; le désactiver casse silencieusement la livraison des messages alors même que l'interface web se charge. |
| `container_image_source` | `custom` | Élevé | Chatwoot est une image préconstruite de Docker Hub enveloppée dans un point d'entrée personnalisé (correspondance des variables d'environnement + lancement de Sidekiq) ; passer à `prebuilt` contourne ce wrapper et le conteneur ne fera pas correspondre correctement `DB_*`/`REDIS_*`. |
| Ordre du job `chatwoot-prepare` | S'exécute après `db-init` (`depends_on_jobs = ["db-init"]`) | Élevé | Exécuter la préparation du schéma avant que la base, le rôle et les droits sur les extensions n'existent fait échouer le Job (`must be superuser` sur `CREATE EXTENSION`, ou base/rôle totalement absents). |
| `enable_cloudsql_volume` | `true` | Élevé | Le socket Unix du Cloud SQL Auth Proxy est indispensable à la connectivité de la base pour le conteneur applicatif qui s'exécute en continu sur Cloud Run. |
| `enable_nfs` | `true` | Élevé | Le désactiver rend les pièces jointes téléversées éphémères — perdues à la révision suivante. |
| `min_instance_count` | `1` en production | Élevé | En dessous de 1, le worker Sidekiq co-localisé ne s'exécute pas entre les requêtes, si bien que les jobs d'arrière-plan (interrogation des canaux, notifications, rapports) sont bloqués. |
| `cpu_always_allocated` | `true` en production (avec `min_instance_count >= 1`) | Moyen/Élevé | La valeur par défaut `false`, qui privilégie le coût, n'alloue le CPU que pendant le traitement d'une requête ; le travail de Sidekiq et d'ActionCable est suspendu en dehors de cette fenêtre et de la période de maintien à chaud. |
| `ingress_settings` | `all` | Élevé | La valeur `internal` bloque les webhooks des canaux externes et le widget public de chat en direct. |
| `enable_iap` | uniquement lorsque les canaux publics ne sont pas nécessaires | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les webhooks des canaux et le widget de chat en direct. |
| `ENABLE_ACCOUNT_SIGNUP` (par défaut `"false"`) | Laisser à `false`, activer brièvement pour le premier administrateur si nécessaire | Moyen | Laisser l'inscription libre publique activée sur un helpdesk exposé à Internet permet à n'importe qui de créer un compte agent/administrateur. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour la conservation réglementaire des données de conversation et des données clients. |
| `enable_cloud_armor` | à activer en production | Moyen | La console des agents et les points de terminaison des canaux publics sont joignables sans protection WAF. |

---

Pour le comportement de la fondation évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images —
voir **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à
Chatwoot, partagée avec la variante GKE, se trouve dans le module `Chatwoot_Common`
(`modules/Chatwoot_Common`) ; consultez
**[Chatwoot_Common](Chatwoot_Common.md)** pour les secrets, l'amorçage de la base de
données, l'image de conteneur et son point d'entrée, les sondes de santé et le stockage
objet, et [Chatwoot_GKE](Chatwoot_GKE.md) pour les notes de raccordement parallèles
côté GKE.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Chatwoot sur Cloud Run](../labs/Chatwoot_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Chatwoot sur GKE Autopilot](Chatwoot_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Chatwoot Common — Configuration applicative partagée](Chatwoot_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Twenty CRM sur Google Cloud Run](Twenty_CloudRun.md), [Cal.com sur Google Cloud Run](CalCom_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Metabase sur Google Cloud Run](Metabase_CloudRun.md) dans la solution **CRM & Sales Operations**.
