---
title: "Chatwoot sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Chatwoot sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Chatwoot_CloudRun.md @ 15fd4c7 sha256:b0e7dd744769 -->

# Chatwoot sur Google Cloud Run {#chatwoot-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Chatwoot_CloudRun.png" alt="Chatwoot sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Chatwoot est une plateforme open source multicanal de service client et
d'engagement client (e-mail, chat en direct, boîtes de réception sociales et
de messagerie, suivi des SLA et rapports) qui constitue une alternative
conforme au RGPD à Zendesk ou Intercom. Ce module déploie Chatwoot sur
**Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Chatwoot et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à toutes les applications
Cloud Run — identité de service, ingress et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous
au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Chatwoot s'exécute sous la forme d'un conteneur Ruby on Rails unique qui
combine le serveur web et un worker Sidekiq en arrière-plan dans une seule
arborescence de processus. Le déploiement relie un ensemble ciblé de services
Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Rails + worker Sidekiq colocalisé sur le port 3000, 2 vCPU / 4 Gio par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — `database_type` est fixé à `POSTGRES_15` ; l'extension `vector` (pgvector) est activée pour les fonctionnalités d'IA/recherche de Chatwoot |
| Cache et file d'attente | Redis (hébergé sur NFS ou externe) | Prend en charge la file d'attente de jobs de Sidekiq et le pub/sub d'ActionCable ; activé par défaut |
| Persistance des fichiers | Cloud Filestore (NFS) | Les pièces jointes persistent sous `/opt/chatwoot/storage`, partagées entre les révisions |
| Stockage d'objets | Cloud Storage | Un bucket suffixé par `storage` provisionné automatiquement par le module Common, plus un bucket `data` par défaut déclaré dans `storage_buckets` |
| Secrets | Secret Manager | `SECRET_KEY_BASE` Rails auto-généré ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` est codé en dur à `POSTGRES_15`
  par la sortie `config` du module Common ; le schéma de Chatwoot et les
  fonctionnalités de recherche basées sur pgvector l'exigent.
- **Image personnalisée.** `container_image_source = "custom"` — le module Common
  construit `FROM chatwoot/chatwoot:${APP_VERSION}` et ajoute un
  `cloud-entrypoint.sh` qui mappe les variables d'environnement `DB_*`/`REDIS_*` de la
  fondation sur la convention `POSTGRES_*`/`REDIS_URL` de Chatwoot et lance Sidekiq en
  arrière-plan avant d'exécuter le serveur Rails. L'image s'exécute **en tant que root**
  — correspondant à l'image amont, dont les `/app`/`/app/tmp` sont détenus par root et ne sont pas
  inscriptibles par le groupe, de sorte que l'étape `create_tmp_directories` de Rails nécessite root pour
  réussir.
- **Cloud SQL est atteint via un socket Unix, et non un bouclage TCP.** Avec
  `enable_cloudsql_volume = true`, Cloud Run monte le socket du proxy d'authentification Cloud SQL
  à `/cloudsql/<instance>` ; le point d'entrée transmet le
  `DB_HOST` injecté directement en tant que `POSTGRES_HOST` (le pilote Ruby `pg` accepte un
  chemin de répertoire comme hôte de socket Unix). Cela diffère de la variante GKE,
  où un proxy sidecar écoute sur `127.0.0.1:5432`.
- **Deux jobs d'initialisation s'exécutent en séquence.** `db-init` (crée la
  base de données, le rôle et les autorisations — y compris une autorisation `cloudsqlsuperuser` afin que
  Chatwoot puisse créer lui-même des extensions Postgres) s'exécute en premier, puis
  `chatwoot-prepare` (`bundle exec rails db:chatwoot_prepare`) crée/met à niveau
  le schéma et initialise les valeurs par défaut, en utilisant l'**image d'application Chatwoot construite**. Il
  n'y a pas d'étape de migration dans le conteneur ; la configuration du schéma se fait entièrement dans ces
  deux jobs avant que le conteneur d'application n'ait besoin de servir le trafic.
- **Redis est activé par défaut** (`enable_redis = true`). Laissez `redis_host` vide pour
  utiliser l'adresse IP Redis partagée hébergée sur le serveur NFS que la fondation injecte
  automatiquement.
- **`SECRET_KEY_BASE` est généré une seule fois et partagé** entre le processus web Rails
  et le worker Sidekiq (colocalisés dans le même conteneur) — il doit
  rester stable lors des redémarrages/redéploiements, car Rails l'utilise pour signer les sessions
  et chiffrer les colonnes chiffrées d'ActiveRecord.
- **NFS est activé par défaut** (`enable_nfs = true`) afin que les pièces jointes téléchargées
  persistent et soient partagées entre les révisions à `/opt/chatwoot/storage`.
- **`cpu_always_allocated` est par défaut à `false`** (facturation basée sur les requêtes,
  démarrage à froid). Sidekiq (notifications, webhooks, attribution automatique) et
  les mises à jour de l'interface utilisateur en temps réel d'ActionCable ne s'exécutent que lorsqu'une requête est servie
  ou pendant la fenêtre de maintien au chaud après la requête ; définissez `cpu_always_allocated =
  true` avec `min_instance_count >= 1` pour maintenir la livraison en arrière-plan
  continue.
- **`ENABLE_ACCOUNT_SIGNUP` est par défaut à `"false"`** — l'inscription en libre-service
  administrateur/agent est désactivée sur un helpdesk fraîchement déployé ; activez-la via
  `environment_variables` si vous souhaitez une inscription publique.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources
sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Chatwoot {#a-cloud-run--the-chatwoot-service}

Chatwoot s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge des requêtes
entre le nombre minimal et maximal d'instances. Chaque révision équivalente à un pod
exécute à la fois le serveur web Rails et un processus worker Sidekiq en arrière-plan dans le
même conteneur, de sorte que le service ne devrait pas passer de longues périodes à zéro
instance si la livraison rapide des messages/notifications est importante.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux,
  et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Chatwoot stocke toutes les données d'application (conversations, contacts, boîtes de réception,
agents, rapports) dans une instance gérée de Cloud SQL pour PostgreSQL 15, y compris
l'extension `vector` utilisée par ses fonctionnalités d'IA/recherche. Le service se connecte
privatement via le **proxy d'authentification Cloud SQL** sur un socket Unix à
`/cloudsql/<instance>` ; aucune IP publique n'est exposée. Lors du premier déploiement, le
job `db-init` crée la base de données de l'application, le rôle et les autorisations (y compris une
autorisation `cloudsqlsuperuser` afin que les propres appels de création d'extension de Chatwoot réussissent),
puis le job `chatwoot-prepare` exécute `rails db:chatwoot_prepare` pour construire le
schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs,
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié suffixé par `storage` est provisionné
automatiquement par le module Common, à côté du bucket `data` par défaut
déclaré dans `storage_buckets`. Des buckets supplémentaires peuvent être déclarés de la même
manière.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~chatwoot"
  gcloud storage ls gs://<bucket-name>/
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (file d'attente, cache et pub/sub) {#d-redis-queue-cache-and-pubsub}

Sidekiq (la file d'attente de jobs en arrière-plan de Chatwoot) et ActionCable (mises à jour de l'interface utilisateur en temps réel) nécessitent tous deux Redis. `enable_redis = true` par défaut ; lorsque `redis_host` est laissé vide, la fondation injecte l'IP Redis partagée hébergée sur le serveur NFS, et le point d'entrée du conteneur construit `REDIS_URL` à partir de `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` au démarrage — cela est auto-réparateur, que `redis_host` ait été défini explicitement ou laissé vide.

> **Sidekiq nécessite Redis 6.2 ou plus récent, et le Redis hébergé sur NFS est 6.0.** Le Redis partagé sur la
> VM NFS exécute la version 6.0.16, et Sidekiq 7 refuse de démarrer avec. L'interface web continue de fonctionner (le
> point d'entrée exécute Sidekiq en arrière-plan), de sorte que le déploiement semble sain alors qu'aucun job en arrière-plan ne s'exécute.
> Pointez `redis_host` vers une instance Redis 6.2+ — par exemple Memorystore, via `create_redis = true`
> dans Services_GCP, qui provisionne Redis 7.2.

- **Console :** Memorystore → Redis (si vous utilisez une instance dédiée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Un secret spécifique à Chatwoot est généré automatiquement et stocké dans Secret
Manager : `SECRET_KEY_BASE` (clé de signature de session / de chiffrement ActiveRecord de Rails,
partagée de manière identique entre les processus web et Sidekiq, et également
injectée dans le job d'initialisation `chatwoot-prepare`). Le mot de passe de la base de données est
géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~chatwoot"
  gcloud secrets versions access latest --secret=secret-<resource-prefix>-chatwoot-secret-key-base --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut (`ingress_settings =
"all"`), ce qui permet aux intégrations de canaux externes (webhooks,
widgets de chat en direct) de l'atteindre. Un équilibreur de charge HTTPS externe avec un
domaine personnalisé, Cloud CDN et Cloud Armor peuvent être ajoutés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

La sortie standard/erreur du conteneur (les processus Rails et Sidekiq, puisqu'ils
partagent un conteneur) est acheminée vers Cloud Logging ; les métriques Cloud Run et Cloud SQL
sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des
stratégies d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Chatwoot {#3-chatwoot-application-behaviour}

- **La configuration de la base de données lors du premier déploiement s'exécute sous forme de deux jobs chaînés.** `db-init` (image
  `postgres:15-alpine`) se connecte via le socket Cloud SQL, crée de manière idempotente
  le rôle et la base de données, accorde les privilèges, accorde
  `cloudsqlsuperuser` au rôle de l'application (nécessaire car l'utilisateur de l'application de Cloud SQL n'est
  pas un véritable superutilisateur Postgres et `db:chatwoot_prepare`'s `schema.rb` appelle
  `enable_extension` pour plusieurs extensions), et pré-crée `vector`,
  `pg_stat_statements`, `pg_trgm`, et `pgcrypto` de manière défensive. `chatwoot-prepare`
  dépend de `db-init` (`depends_on_jobs = ["db-init"]`) et exécute `bundle exec
  rails db:chatwoot_prepare` en utilisant l'image d'application Chatwoot construite, et non une image client générique. Les deux jobs ont `execute_on_apply = true`.
- **Pas de migrations dans le conteneur.** La création/mise à niveau du schéma est entièrement gérée
  par le job d'initialisation `chatwoot-prepare` avant que le conteneur d'application ne soit
  censé servir le trafic — le point d'entrée d'exécution n'exécute pas `rails
  db:migrate`.
- **`chatwoot-prepare` préfère TCP au socket lorsque les deux sont disponibles.**
  Son script vérifie explicitement si `DB_HOST` est un chemin de socket (commençant par
  `/`) ; si c'est le cas **et** si `DB_IP` (l'IP privée de l'instance) est également présent, il
  se connecte via `DB_IP` avec `PGSSLMODE=require` à la place, car le socket Unix Cloud
  SQL ne se matérialise pas toujours dans un job Cloud Run à temps.
  Il ne revient au chemin de socket littéral que lorsque `DB_IP` n'est pas défini. Le
  point d'entrée du conteneur d'application à longue durée de vie n'a pas de tel repli — il
  transmet `DB_HOST` directement en tant que `POSTGRES_HOST`, en s'appuyant sur la présence du socket
  pour le service lui-même.
- **Alias de variables d'environnement de base de données.** La plateforme injecte `DB_HOST` (le répertoire du socket Cloud SQL sur Cloud Run), `DB_PORT`, `DB_NAME`, `DB_USER`,
  `DB_PASSWORD` ; `cloud-entrypoint.sh` (intégré à l'image) les mappe sur
  la convention `POSTGRES_HOST`/`POSTGRES_PORT`/`POSTGRES_DATABASE`/
  `POSTGRES_USERNAME`/`POSTGRES_PASSWORD` de Chatwoot.
- **L'URL Redis est auto-réparatrice.** Si `REDIS_URL` n'est pas déjà défini, le
  point d'entrée le construit à partir des `REDIS_HOST`/`REDIS_PORT`/
  `REDIS_AUTH` injectés — couvrant à la fois le cas `redis_host` explicite et le cas de
  repli NFS par défaut.
- **Sidekiq s'exécute en colocation, en arrière-plan.** `cloud-entrypoint.sh`
  démarre `bundle exec sidekiq -C config/sidekiq.yml &` avant d'exécuter le
  serveur Rails ; un `trap` sur `TERM`/`INT` arrête Sidekiq en même temps que le
  conteneur. Étant donné que Sidekiq traite les jobs en arrière-plan (livraison de canaux,
  notifications, rapports) uniquement lorsque le conteneur est en cours d'exécution, maintenez
  `min_instance_count >= 1` (et envisagez `cpu_always_allocated = true`) si
  une livraison rapide est plus importante que le coût d'inactivité.
- **`ENABLE_ACCOUNT_SIGNUP` est désactivé par défaut.** Le module Common injecte
  `ENABLE_ACCOUNT_SIGNUP = "false"` avec `RAILS_ENV=production`,
  `RAILS_LOG_TO_STDOUT=true`, et `RAILS_MAX_THREADS=5` (dimensionnés au-dessus de la
  concurrence par défaut de Cloud Run pour éviter « impossible d'obtenir une connexion du pool »).
  L'interface utilisateur d'intégration de Chatwoot crée le premier compte administrateur
  de manière interactive lors de la première visite — il n'y a pas de secret d'identifiant administrateur
  auto-généré pour ce module.
- **Chemin de santé.** Les sondes de démarrage et de vivacité sont **HTTP** `GET /` — la
  page de connexion/intégration renvoie 200 sans authentification. Le `startup_probe` par défaut
  permet un délai initial de 60 secondes plus jusqu'à 30 tentatives à une période de 15 secondes
  (environ 8 minutes) avant l'échec, pour absorber `chatwoot-prepare` s'exécutant
  avant le conteneur de l'application.
- **Signal d'arrêt du proxy Cloud SQL.** Les jobs d'initialisation signalent au sidecar du proxy d'authentification Cloud SQL
  de se terminer une fois l'exécution terminée afin que le pod du job se termine au lieu de
  rester bloqué sur un sidecar en cours d'exécution.
- **Inspecter l'exécution du job et la configuration en cours :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <chatwoot-prepare-job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Chatwoot sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet, identité et intégration de la recherche {#group-1--project-identity--search-integration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |
| `elasticsearch_url` | `""` | Point de terminaison Elasticsearch facultatif (par exemple, de `Elasticsearch_GKE`) pour la recherche en texte intégral de Chatwoot. Laissez vide pour désactiver. |
| `elasticsearch_username` | `""` | Nom d'utilisateur Elasticsearch ; laissez vide lorsque `xpack.security.enabled` est faux. |
| `elasticsearch_password_secret` | `""` | ID du secret Secret Manager contenant le mot de passe Elasticsearch ; lorsqu'il est défini, injecté comme `ELASTICSEARCH_PASSWORD` et le compte de service de la charge de travail reçoit `secretAccessor`. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `chatwoot` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Chatwoot Helpdesk` | Nom lisible par l'homme affiché dans la console. |
| `description` | `Chatwoot - Open-source helpdesk and customer support platform` | Description du service. |
| `application_version` | `v4.15.1` | Tag d'image `chatwoot/chatwoot` utilisé comme base de construction personnalisée. Incrémenter pour déclencher une reconstruction. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit sur mesure à partir de `chatwoot/chatwoot` ; ne pas définir à `prebuilt` — cela ignore le wrapper `cloud-entrypoint.sh`. |
| `cpu_limit` | `2000m` | 2 vCPU — Rails + worker Sidekiq colocalisé. |
| `memory_limit` | `4Gi` | 4 Gio recommandés ; les deux processus partagent le conteneur. |
| `cpu_always_allocated` | `false` | Valeur par défaut de démarrage à froid axée sur les coûts ; le travail de Sidekiq/ActionCable est mis en pause entre les requêtes. Définissez `true` (avec `min_instance_count >= 1`) pour restaurer la livraison continue en arrière-plan. |
| `min_instance_count` | `0` | `0` permet la mise à l'échelle à zéro ; définissez `1` pour maintenir le worker Sidekiq actif. |
| `max_instance_count` | `5` | Plafond de mise à l'échelle horizontale standard. |
| `container_port` | `3000` | Port du serveur Rails de Chatwoot. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `enable_cloudsql_volume` | `true` | Socket Unix du proxy d'authentification Cloud SQL pour les connexions Postgres. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Chatwoot dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements progressifs. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est la valeur par défaut afin que les intégrations de canaux externes et le widget de chat en direct puissent atteindre le service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque les webhooks de canaux publics et le widget de chat en direct.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires, par exemple `{ ENABLE_ACCOUNT_SIGNUP = "true" }` pour ouvrir l'inscription en libre-service. Les valeurs principales `RAILS_*`/`POSTGRES_*`/`REDIS_*` sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Initialisation personnalisée et scripts SQL {#group-9--custom-initialization--sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS
après le provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires au-delà du bucket suffixé par `storage` auto-provisionné par le module Common. |
| `enable_nfs` | `true` | NFS est activé par défaut afin que les pièces jointes persistent et soient partagées entre les révisions. |
| `nfs_mount_path` | `/opt/chatwoot/storage` | Où Chatwoot stocke les pièces jointes téléchargées. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Remplacé par une valeur fixe par la sortie `config` du module Common, quelle que soit la valeur définie ici ; Chatwoot nécessite Postgres 15+ avec pgvector. |
| `db_name` | `chatwoot` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `chatwoot` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `application_database_name` / `application_database_user` | `crappdb` / `crappuser` | Déclarations de miroir de fondation inertes (ne satisfont que la convention de miroir) — le `chatwoot.tf` de Chatwoot connecte `db_name`/`db_user` à la place, donc celles-ci ne sont jamais transmises à `main.tf`. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la chaîne de jobs `db-init` → `chatwoot-prepare` intégrée du module Common. |
| `cron_jobs` | `[]` | Non utilisé — Chatwoot n'a pas de tâches récurrentes planifiées par la plateforme ; Sidekiq gère sa propre planification en interne. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` , délai initial de 60s, période de 15s, 30 tentatives | Sonde de démarrage ; dimensionnée pour absorber `chatwoot-prepare` se terminant avant le conteneur de l'application. |
| `liveness_probe` | HTTP `/` , délai initial de 60s, période de 30s, 3 tentatives | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | HTTP `/` | Sondes structurées alternatives (au niveau du service) ; `startup_probe`/`liveness_probe` prennent effet par défaut. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité de Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Stratégies d'alerte métrique. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Requis pour la mise en file d'attente Sidekiq et le pub/sub ActionCable ; transmis à la fondation sans condition. |
| `redis_host` | `""` | Vide utilise l'IP Redis partagée hébergée sur le serveur NFS que la fondation injecte. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées (y compris `application_display_name`,
`application_description`, `container_build_config`, `additional_services`,
`additional_containers`, et les remplacements de réseau/instance SQL) suivent
le comportement standard de [App_CloudRun](App_CloudRun.md) et sont inertes, sauf
si elles sont explicitement câblées — le `chatwoot.tf` de Chatwoot ne les transmet pas.

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer
les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (répertoire du socket Cloud SQL) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `chatwoot-prepare`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration
> via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — un environnement d'exécution `gen1` avec
> des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors plage, un
> `database_type` invalide. Une configuration invalide fait échouer le **plan** avec une
> erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous
> sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (fixé par Common) | Critique | Le schéma de Chatwoot et la recherche basée sur pgvector nécessitent Postgres 15+ ; tout autre moteur rompt `chatwoot-prepare`. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `SECRET_KEY_BASE` (auto-généré) | Ne jamais changer | Critique | Sa rotation invalide chaque session/cookie signé et rend les colonnes chiffrées d'ActiveRecord définitivement illisibles ; Sidekiq échouera également à déchiffrer les jobs en cours. |
| `enable_redis` | `true` (transmis sans condition) | Critique | Sidekiq (jobs en arrière-plan, livraison de canaux) et ActionCable (interface utilisateur en temps réel) nécessitent tous deux Redis ; le désactiver rompt silencieusement la livraison des messages même si l'interface utilisateur web se charge. |
| `container_image_source` | `custom` | Élevé | Chatwoot est une image pré-construite de Docker Hub enveloppée dans un point d'entrée personnalisé (mappage d'environnement + lancement de Sidekiq) ; passer à `prebuilt` ignore ce wrapper et le conteneur ne mappera pas `DB_*`/`REDIS_*` correctement. |
| Ordre des jobs `chatwoot-prepare` | S'exécute après `db-init` (`depends_on_jobs = ["db-init"]`) | Élevé | L'exécution de la préparation du schéma avant l'existence des autorisations de base de données/rôle/extension fait échouer le job (`must be superuser` sur `CREATE EXTENSION`, ou la base de données/le rôle manquant entièrement). |
| `enable_cloudsql_volume` | `true` | Élevé | Le socket Unix du proxy d'authentification Cloud SQL est requis pour la connectivité de la base de données du conteneur d'application à longue durée de vie sur Cloud Run. |
| `enable_nfs` | `true` | Élevé | Le désactiver rend les pièces jointes téléchargées éphémères — perdues lors de la prochaine révision. |
| `min_instance_count` | `1` pour la production | Élevé | En dessous de 1, le worker Sidekiq colocalisé ne s'exécute pas entre les requêtes, de sorte que les jobs en arrière-plan (interrogation de canaux, notifications, rapports) sont bloqués. |
| `cpu_always_allocated` | `true` pour la production (avec `min_instance_count >= 1`) | Moyen/Élevé | La valeur par défaut `false` axée sur les coûts n'alloue le CPU que lors du traitement d'une requête ; le travail de Sidekiq et ActionCable est mis en pause en dehors de cette fenêtre et de la période de maintien au chaud. |
| `ingress_settings` | `all` | Élevé | Définir à `internal` bloque les webhooks de canaux externes et le widget de chat en direct public. |
| `enable_iap` | uniquement lorsque les canaux publics ne sont pas nécessaires | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les webhooks de canaux et le widget de chat en direct. |
| `ENABLE_ACCOUNT_SIGNUP` (par défaut `"false"`) | Laisser `false`, activer brièvement pour le premier administrateur si nécessaire | Moyen | Laisser l'inscription en libre-service publique activée sur un helpdesk accessible via Internet permet à quiconque d'enregistrer un compte agent/administrateur. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité des données de conversation/client. |
| `enable_cloud_armor` | activer pour la production | Moyen | La console de l'agent et les points de terminaison des canaux publics sont accessibles sans protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Chatwoot
partagée avec la variante GKE se trouve dans le module `Chatwoot_Common`
(`modules/Chatwoot_Common`) ; voir
**[Chatwoot_Common](Chatwoot_Common.md)** pour les secrets, le démarrage de la base de données, l'image/point d'entrée du conteneur,
les sondes de santé et le stockage d'objets, et
[Chatwoot_GKE](Chatwoot_GKE.md) pour les notes de câblage côté GKE parallèles.

## Guides associés {#related-guides}

- [Labo pratique : Chatwoot sur Cloud Run](../labs/Chatwoot_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Chatwoot sur GKE Autopilot](Chatwoot_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Chatwoot Common — Configuration d'application partagée](Chatwoot_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Twenty CRM sur Google Cloud Run](Twenty_CloudRun.md), [Cal.com sur Google Cloud Run](CalCom_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Metabase sur Google Cloud Run](Metabase_CloudRun.md) dans la solution **CRM et opérations de vente**.
