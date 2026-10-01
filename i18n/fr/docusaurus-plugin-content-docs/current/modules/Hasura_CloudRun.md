---
title: "Hasura sur Google Cloud Run"
description: "Référence de configuration pour déployer Hasura sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Hasura_CloudRun.md @ 3055034 sha256:47e1b7bb662a -->

# Hasura sur Google Cloud Run {#hasura-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Hasura_CloudRun.png" alt="Hasura sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Hasura est un moteur open source sous licence Apache 2.0 qui vous fournit instantanément une API GraphQL (et REST) en temps réel au-dessus d'une base de données PostgreSQL, avec une autorisation fine basée sur les rôles, des déclencheurs d'événements et une console d'administration intégrée. Ce module déploie le Hasura GraphQL Engine (`hasura/graphql-engine`) sur **Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Hasura et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Hasura s'exécute sous forme d'un unique conteneur Haskell sur Cloud Run v2. Le déploiement assemble un ensemble restreint de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Haskell, 1 vCPU / 512 MiB par défaut, autoscaling serverless ; mise à l'échelle jusqu'à zéro prise en charge |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — le catalogue de métadonnées de Hasura et sa source de données par défaut résident tous deux dans Postgres |
| Stockage d'objets | Aucun | Hasura est sans état ; aucun bucket n'est provisionné |
| Secrets | Secret Manager | `HASURA_GRAPHQL_ADMIN_SECRET` généré automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé en option |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche applicative partagée ; Hasura conserve son propre catalogue de métadonnées dans Postgres, aucun autre moteur n'est donc pris en charge.
- **Le secret administrateur protège tout ce qui est sensible.** `HASURA_GRAPHQL_ADMIN_SECRET` est généré automatiquement et stocké dans Secret Manager. Il protège l'interface `/console` ainsi que les API `/v1/graphql` et `/v1/metadata`. `/healthz` reste public pour les sondes de santé.
- **Deux URL de connexion sont assemblées dans le conteneur.** Le point d'entrée de l'image personnalisée construit `HASURA_GRAPHQL_DATABASE_URL` (source de données par défaut) et `HASURA_GRAPHQL_METADATA_DATABASE_URL` (stockage des métadonnées de Hasura) à partir des variables `DB_*` injectées à l'exécution — Cloud Run n'interpole pas `$(VAR)` dans les valeurs d'environnement, cela ne peut donc pas être fait au moment du plan.
- **La mise à l'échelle jusqu'à zéro est activée par défaut** (`min_instance_count = 0`, `cpu_always_allocated = false`). Comme tout l'état est externe, dans Postgres, une instance démarrée à froid répond correctement ; les démarrages à froid ajoutent quelques secondes de latence à la première requête après une période d'inactivité. Définissez `min_instance_count = 1` pour les API sensibles à la latence.
- **Entrée publique par défaut.** `ingress_settings = "all"` afin que les clients et la console puissent atteindre le service. Activer IAP protège l'ensemble du service — API comprise — derrière une identité Google.
- **La console est livrée activée.** `HASURA_GRAPHQL_ENABLE_CONSOLE = "true"` sert la console d'administration sur `/console`. Désactivez-la en production si vous gérez les métadonnées uniquement via le CI (CLI `hasura` / migrations).
- **Ni stockage, ni Redis, ni NFS.** `storage_buckets = []`, `enable_redis = false`, `enable_nfs = false` — tout réside dans PostgreSQL.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Hasura {#a-cloud-run--the-hasura-service}

Hasura s'exécute sous forme d'un service Cloud Run v2 qui s'adapte automatiquement à la charge des requêtes entre le nombre minimal et le nombre maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Hasura stocke son catalogue de métadonnées (tables suivies, relations, permissions, déclencheurs d'événements) **et** vos données applicatives dans une instance gérée Cloud SQL pour PostgreSQL 15. Le service s'y connecte de manière privée via le **Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP publique n'est exposée. Au premier déploiement, une tâche d'initialisation crée la base de données et l'utilisateur de l'application ; Hasura installe son schéma de métadonnées au premier démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager : `HASURA_GRAPHQL_ADMIN_SECRET` (accorde un accès complet aux API GraphQL/métadonnées et à la console). Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # The admin secret — use it as the x-hasura-admin-secret header:
  gcloud secrets versions access latest --secret=<admin-secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et entrée {#d-networking--ingress}

Le service est joignable par défaut à son URL `run.app`. Un équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut y être ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL à Cloud Monitoring, avec en option un test de disponibilité (ciblant `/healthz`) et des règles d'alerte.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Hasura {#3-hasura-application-behaviour}

- **Initialisation de la base de données au premier déploiement.** Une tâche d'initialisation exécute `create-db-and-user.sh` avec `postgres:15-alpine`. Elle se connecte via le Cloud SQL Auth Proxy et crée de manière idempotente la base de données et l'utilisateur de l'application, puis accorde les privilèges. La tâche peut être réexécutée sans risque.
- **Catalogue de métadonnées au démarrage.** Hasura installe et migre son propre schéma de catalogue de métadonnées dans Postgres au démarrage ; la mise à niveau de la version de l'image applique donc les modifications du catalogue sans étape de migration distincte. Les métadonnées de vos tables suivies persistent dans la base de données d'une révision à l'autre.
- **Deux URL de connexion, assemblées dans le conteneur.** Le point d'entrée construit à la fois `HASURA_GRAPHQL_DATABASE_URL` et `HASURA_GRAPHQL_METADATA_DATABASE_URL` à partir des variables `DB_*` injectées, en encodant le mot de passe pour l'URL et en distinguant selon `DB_HOST` (répertoire de socket → forme socket libpq ; loopback → simple ; IP privée → `sslmode=require`).
- **Le secret administrateur est la frontière de sécurité.** Envoyez-le dans l'en-tête `x-hasura-admin-secret`. Pour le récupérer :
  ```bash
  gcloud secrets versions access latest --secret=<admin-secret-name> --project "$PROJECT"
  # Then, e.g.:
  curl -s "$SERVICE_URL/v1/graphql" \
    -H "x-hasura-admin-secret: <secret>" \
    -H 'Content-Type: application/json' \
    -d '{"query":"{ __schema { queryType { name } } }"}'
  ```
- **Chemin de santé.** Les sondes de démarrage et de disponibilité ciblent `/healthz` — le point de terminaison public, sans authentification, qui renvoie 200 dès que le moteur est démarré et connecté à Postgres. Ne redirigez pas les sondes vers `/v1/graphql` ou `/console` (les deux renvoient 401 sans le secret administrateur).
- **Accès à la console.** Ouvrez `$SERVICE_URL/console` dans un navigateur et collez le secret administrateur lorsqu'il vous est demandé pour suivre des tables, définir des permissions et exécuter des requêtes GraphQL.
- **Inspecter l'exécution des tâches :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Hasura ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `hasura` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Hasura` | Nom lisible affiché dans la console. |
| `application_description` | `Hasura GraphQL Engine on Cloud Run` | Description du service. |
| `application_version` | `v2.36.0` | Tag de l'image Hasura ; `latest` est remplacé par un tag v2.x épinglé au moment du build. |
| `application_database_name` | `hasura` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `hasura` | Utilisateur de la base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit une image d'encapsulation qui assemble les DSN ; `prebuilt` exige une configuration manuelle des URL. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU convient à la plupart des charges de travail. |
| `memory_limit` | `512Mi` | Mémoire par instance ; à augmenter pour une forte concurrence de requêtes. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle jusqu'à zéro (sans risque — tout l'état est dans Postgres). |
| `max_instance_count` | `3` | Limite supérieure de l'autoscaling ; Hasura se met à l'échelle horizontalement. |
| `container_port` | `8080` | Hasura écoute sur `HASURA_GRAPHQL_SERVER_PORT = 8080`. |
| `cpu_always_allocated` | `false` | Facturation à la requête — Hasura n'effectue aucun travail en arrière-plan entre les requêtes. |
| `execution_environment` | `gen2` | Gen2 recommandé. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (à augmenter pour les abonnements/flux longs). |
| `enable_cloudsql_volume` | `true` | Socket du Cloud SQL Auth Proxy pour la connexion Postgres. |
| `enable_image_mirroring` | `true` | Duplique l'image Hasura dans Artifact Registry. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` permet aux clients externes et à la console d'atteindre le service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google devant l'ensemble du service (API comprise). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `HASURA_GRAPHQL_*` supplémentaires (p. ex. `HASURA_GRAPHQL_DEV_MODE`, `HASURA_GRAPHQL_CORS_DOMAIN`). Ne définissez pas ici les deux valeurs `*_DATABASE_URL` ni le secret administrateur — ils sont gérés automatiquement. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Expression cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; à augmenter pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — voir [App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Vide — Hasura n'a besoin d'aucun stockage de fichiers. |
| `enable_nfs` | `false` | Non requis pour Hasura. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Hasura nécessite PostgreSQL. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `enable_postgres_extensions` / `postgres_extensions` | désactivé / `[]` | Extensions Postgres facultatives. |

### Groupe 13 — Tâches et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée. |
| `cron_jobs` | `[]` | Cloud Scheduler + Cloud Run Jobs récurrents. |
| `additional_services` | `[]` | Services Cloud Run supplémentaires déployés aux côtés de Hasura. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthz` | Sonde de démarrage au niveau de l'application. |
| `liveness_probe` | HTTP `/healthz` | Sonde de disponibilité au niveau de l'application. |
| `startup_probe_config` | HTTP `/healthz` | Sonde de démarrage Cloud Run (au niveau du socle). |
| `health_check_config` | HTTP `/healthz` | Sonde de disponibilité Cloud Run (au niveau du socle). |
| `uptime_check_config` | `{ enabled=false, path="/healthz" }` | Test de disponibilité Cloud Monitoring. Désactivé par défaut ; à activer pour la surveillance en production. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 16 — Redis {#group-16--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Hasura ne nécessite pas Redis. |
| `redis_host` | `""` | Utilisé uniquement lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id` pour les projets imbriqués dans un dossier). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (si activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour Hasura). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des tâches d'initialisation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation au moment du plan héritée.** Ce module fait passer sa configuration par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors limites. Une configuration non valide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `HASURA_GRAPHQL_ADMIN_SECRET` (généré automatiquement) | À conserver dans Secret Manager ; rotation délibérée | Critical | C'est la seule protection des API GraphQL/métadonnées et de la console — l'exposer accorde un accès complet en lecture/écriture à toutes les tables suivies. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et rend orphelins le catalogue de métadonnées et toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_file` valide fait échouer la tâche d'import. |
| Chemin de `startup_probe` / `liveness_probe` | `/healthz` | High | Faire pointer une sonde vers `/v1/graphql` ou `/console` renvoie 401 — la révision ne devient jamais Ready alors que le moteur a démarré. |
| `HASURA_GRAPHQL_ENABLE_CONSOLE` | `false` en production | High | Laisser la console activée en production élargit la surface d'attaque ; gérez plutôt les métadonnées via la CLI `hasura`/les migrations. |
| `ingress_settings` + `enable_iap` | `all` ; IAP uniquement si l'API peut être protégée par identité | High | IAP bloque toutes les requêtes non authentifiées, y compris les clients d'API programmatiques qui s'authentifient avec l'en-tête admin/JWT et non avec une identité Google. |
| `container_image_source` | `custom` | High | `prebuilt` ignore le point d'entrée qui assemble les deux valeurs `*_DATABASE_URL` — le moteur démarre sans base de données et chaque requête échoue. |
| `memory_limit` | `512Mi`+ | Medium | Des métadonnées très volumineuses ou une forte concurrence de requêtes peuvent provoquer un OOM en dessous de 512 MiB ; l'environnement gen2 impose de toute façon un minimum de 512 MiB de mémoire. |
| `min_instance_count` | `0` (ou `1` pour la latence) | Medium | La mise à l'échelle jusqu'à zéro ajoute quelques secondes de latence de démarrage à froid à la première requête après une période d'inactivité ; définissez `1` pour les API sensibles à la latence. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention conforme aux exigences réglementaires. |
| `enable_cloud_armor` | à activer en production | Medium | L'API et la console sont accessibles publiquement sans protection WAF. |

---

Pour le comportement du socle mentionné tout au long de ce guide — identité du service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et duplication d'images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Hasura partagée avec la variante GKE est décrite dans **[Hasura_Common](Hasura_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Hasura sur Cloud Run](../labs/Hasura_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Hasura sur GKE Autopilot](Hasura_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Hasura Common — Configuration applicative partagée](Hasura_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Supabase sur GKE Autopilot](Supabase_GKE.md), [Directus sur Cloud Run](Directus_CloudRun.md), [Meilisearch sur GKE Autopilot](Meilisearch_GKE.md) dans la solution **Application Backend Services**.
