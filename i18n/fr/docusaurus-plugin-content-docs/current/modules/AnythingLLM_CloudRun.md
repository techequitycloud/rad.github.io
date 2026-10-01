---
title: "AnythingLLM sur Google Cloud Run"
description: "Référence de configuration pour déployer AnythingLLM sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/AnythingLLM_CloudRun.md @ 3055034 sha256:318b77c40cc2 -->

# AnythingLLM sur Google Cloud Run {#anythingllm-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/AnythingLLM_CloudRun.png" alt="AnythingLLM sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

AnythingLLM est un espace de travail d'IA privé et une plateforme de génération augmentée
par récupération (RAG) qui permet aux équipes de dialoguer avec leurs documents, de se
connecter à n'importe quel fournisseur de LLM (OpenAI, Anthropic, Ollama, etc.) et de
créer des assistants de connaissances reposant sur l'IA — sans envoyer de données à des
services tiers. Ce module déploie AnythingLLM sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise AnythingLLM et sur la façon de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications Cloud Run — identité du service,
ingress et équilibrage de charge, scaling et concurrence, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

AnythingLLM s'exécute sous la forme d'un conteneur d'IA Node.js sur Cloud Run v2. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 4 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — AnythingLLM utilise l'ORM Prisma et ne prend pas en charge MySQL |
| Stockage d'objets | Cloud Storage | Bucket de documents `anythingllm-docs` provisionné automatiquement ; buckets supplémentaires en option |
| Fichiers partagés | Filestore (NFS) | Facultatif — pour un stockage persistant des documents/vecteurs sur plusieurs instances ; nécessite gen2 |
| Secrets | Secret Manager | Quatre secrets applicatifs générés automatiquement (`JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY`, `SIG_SALT`) plus le mot de passe de base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS global + Cloud Armor + domaine personnalisé en option |
| Cache | Redis | Désactivé par défaut ; facultatif pour les charges de travail de session ou de cache |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** L'ORM Prisma d'AnythingLLM nécessite PostgreSQL. Ne
  définissez pas `database_type` sur une variante MySQL ou SQL Server.
- **Quatre secrets applicatifs sont générés automatiquement.** `JWT_SECRET`, `AUTH_TOKEN`,
  `SIG_KEY` et `SIG_SALT` sont créés dans Secret Manager lors du premier déploiement ;
  vous ne les définissez jamais en clair.
- **`min_instance_count` vaut `0` par défaut** (scale-to-zero). NFS protège le magasin de
  vecteurs LanceDB lors des démarrages à froid ; le compromis se limite donc à un
  démarrage à froid d'environ 30 à 60 s à la première requête après une période
  d'inactivité. Définissez `min_instance_count = 1` pour l'éviter sur les déploiements
  sensibles à la latence.
- **Le stockage doit être persistant, et NFS est activé par défaut.** Tous les documents
  de l'espace de travail, les index vectoriels et les données de conversation sont écrits
  sous `STORAGE_DIR`. `enable_nfs` vaut `true` par défaut, car sinon l'index vectoriel
  LanceDB d'AnythingLLM réside sur le disque éphémère du conteneur et est effacé
  silencieusement à chaque démarrage à froid ou redéploiement.
- **Redis est désactivé par défaut.** Il n'est pas nécessaire aux fonctionnalités de
  base d'AnythingLLM. S'il est activé, `redis_host` doit être défini explicitement.
- **Facturation basée sur les requêtes par défaut.** `cpu_always_allocated = false` — la
  génération d'embeddings et l'inférence s'exécutent dans la requête qui les déclenche ;
  elles disposent donc de tout le CPU pendant leur traitement, quelle que soit la valeur
  de cet indicateur, qui ne fait que cesser de facturer le CPU pendant la période
  d'inactivité où l'instance reste active.
- **`execution_environment = gen2`** est la valeur par défaut ; elle est obligatoire
  lorsque des montages NFS ou GCS Fuse sont activés.
- **La variable d'environnement `GOOGLE_CLOUD_STORAGE_BUCKET_NAME` est définie
  automatiquement** à partir du bucket GCS `anythingllm-docs` provisionné.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service AnythingLLM {#a-cloud-run--the-anythingllm-service}

AnythingLLM s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement à la
charge des requêtes entre le nombre minimal et le nombre maximal d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions
pour des déploiements progressifs sûrs. Les opérations d'embedding et d'inférence d'IA
nécessitent au moins 2 vCPU et 4 GiB de RAM ; Startup CPU Boost est activé.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic,
  les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le scaling, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

AnythingLLM stocke toutes les métadonnées de l'espace de travail, les comptes
utilisateur et l'historique des conversations dans une instance gérée Cloud SQL for
PostgreSQL 15. Le service s'y connecte de façon privée via le **Cloud SQL Auth Proxy**
sur un socket Unix (pas d'IP publique). Lors du premier déploiement, un Job
d'initialisation crée la base de données et l'utilisateur de l'application. La chaîne de
connexion Prisma `DATABASE_URL` est assemblée par le script de point d'entrée
d'AnythingLLM à partir des variables d'environnement `DB_*` injectées par le socle
au démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation du mot de passe.

### C. Cloud Storage — bucket de documents {#c-cloud-storage--document-bucket}

`AnythingLLM_Common` provisionne automatiquement un bucket **Cloud Storage** dédié
(`anythingllm-docs`) pour le stockage des documents et des vecteurs. Le compte de
service de la charge de travail y reçoit automatiquement l'accès et le nom du bucket est
injecté sous `GOOGLE_CLOUD_STORAGE_BUCKET_NAME`. Des buckets supplémentaires peuvent être
déclarés dans `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<docs-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les montages GCS Fuse et les options CMEK.

### D. Filestore (NFS) — stockage partagé facultatif {#d-filestore-nfs--optional-shared-storage}

Pour les déploiements multi-instances où toutes les instances doivent accéder aux mêmes
documents et index vectoriels, activez **Filestore (NFS)**. NFS est désactivé par défaut
et nécessite `execution_environment = gen2`.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS et les options CMEK.

### E. Secret Manager {#e-secret-manager}

Quatre secrets applicatifs d'AnythingLLM sont générés automatiquement et stockés dans
Secret Manager — `JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY` et `SIG_SALT` — ainsi que le mot
de passe de base de données. Aucun d'eux n'apparaît en clair où que ce soit dans le
déploiement.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut via son URL `run.app`. Un équilibreur de charge
HTTPS global avec Cloud Armor, un domaine personnalisé et Cloud CDN peuvent être ajoutés.
`ingress_settings` et `vpc_egress_setting` contrôlent quelles sources de trafic peuvent
atteindre le service et comment le trafic sortant est acheminé via le VPC.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run et
Cloud SQL vers Cloud Monitoring. Un test de disponibilité facultatif (désactivé par
défaut, ciblant `/`) et des règles d'alerte peuvent être activés.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application AnythingLLM {#3-anythingllm-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation (`db-init`) utilise l'image `postgres:15-alpine` pour créer la base de
  données et l'utilisateur d'AnythingLLM avant le démarrage du service. Il est idempotent
  et peut être réexécuté sans risque.
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Migrations Prisma au démarrage.** Le script de point d'entrée construit la chaîne de
  connexion `DATABASE_URL` à partir des variables d'environnement `DB_*` injectées par la
  plateforme et exécute les migrations Prisma ; les mises à niveau de version appliquent
  donc automatiquement les modifications de schéma.
- **Chargement des modèles d'IA.** AnythingLLM charge les modèles d'embedding en mémoire
  au premier démarrage. La sonde de démarrage utilise un délai initial de 60 secondes et
  30 périodes d'échec (×10 secondes = 5 minutes au total) pour en tenir compte.
- **Chemin de santé.** Les sondes de démarrage et de liveness ciblent toutes deux
  `/api/ping` en HTTP, qui ne renvoie HTTP 200 qu'une fois l'application entièrement
  initialisée. Contrairement à Mautic/Apache, AnythingLLM ne redirige pas le trafic de
  santé HTTP ; les sondes HTTP fonctionnent donc sans ajustement sur Cloud Run.
- **Configuration du fournisseur de LLM.** Utilisez `environment_variables` pour les
  paramètres de fournisseur non sensibles (`LLM_PROVIDER`, `EMBEDDING_ENGINE`,
  `VECTOR_DB`) et `secret_environment_variables` pour associer des noms de variables
  d'environnement à des secrets Secret Manager pour les clés API (`OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, etc.).
- **Cohérence du moteur d'embedding.** Modifier `EMBEDDING_ENGINE` après l'ingestion de
  documents rend les index vectoriels existants incompatibles. Tous les documents doivent
  être réingérés après toute modification du moteur d'embedding.
- **Variables d'environnement fixes.** `SERVER_PORT=3001`, `UID=1000` et `GID=1000` sont
  définies automatiquement par `AnythingLLM_Common`. Ne les remplacez pas.
  `AnythingLLM_Common` définit également `STORAGE_DIR=/app/server/storage` comme sa
  propre valeur par défaut, mais `AnythingLLM_CloudRun` la remplace par le chemin de
  montage NFS (`nfs_mount_path`, par défaut `/mnt/nfs`) dès que `enable_nfs = true` — la
  valeur par défaut de la plateforme — de sorte qu'un déploiement s'exécute en réalité
  avec `STORAGE_DIR=/mnt/nfs`, sauf si `enable_nfs` est explicitement désactivé (voir le
  groupe 11).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à AnythingLLM ou importants pour celui-ci sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec
leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de monitoring. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `anythingllm` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `AnythingLLM` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de version de l'image ; épinglez-le sur un tag de version publiée en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance. Minimum de 2 vCPU pour les charges de travail d'IA. |
| `memory_limit` | `4Gi` | Mémoire par instance. Minimum de 4 GiB pour l'embedding et l'inférence. |
| `min_instance_count` | `0` | Nombre minimal d'instances. Définissez ≥ 1 pour éviter les démarrages à froid (NFS protège le magasin de vecteurs dans les deux cas). |
| `max_instance_count` | `1` | Nombre maximal d'instances. Augmentez-le avec NFS pour un accès partagé aux documents. |
| `container_port` | `3001` | Port HTTP natif d'AnythingLLM. |
| `execution_environment` | `gen2` | Gen2 obligatoire pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête. Augmentez-la pour l'ingestion de longs documents. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `traffic_split` | `[]` | Répartition du trafic entre les révisions pour les déploiements progressifs. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux autorisés à atteindre le service (`all` / `internal` / `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode d'acheminement du trafic sortant via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. **Recommandé en production.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets, p. ex. `LLM_PROVIDER`, `EMBEDDING_ENGINE`, `VECTOR_DB`. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom de secret Secret Manager pour les clés API. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / fréquence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer depuis une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge (nécessite `enable_cloud_armor`). |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket de données supplémentaire. Le bucket `anythingllm-docs` est toujours créé. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Buckets GCS supplémentaires. |
| `enable_nfs` | `true` | Filestore (NFS) pour le stockage persistant des documents/vecteurs — indispensable, sinon l'index vectoriel LanceDB réside sur un disque éphémère et est effacé à chaque démarrage à froid/redéploiement. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Montages GCS Fuse (nécessitent gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé pour AnythingLLM — ne pas modifier. |
| `application_database_name` | `anythingllmdb` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `anythingllmuser` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms facultatifs de variables d'environnement supplémentaires pour les informations de connexion. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |
| `additional_services` | `[]` | Services Cloud Run supplémentaires aux côtés d'AnythingLLM. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/api/ping`, délai initial de 60 s, 30 échecs | Fenêtre de démarrage étendue pour le chargement des modèles d'IA. |
| `liveness_probe` / `health_check_config` | HTTP `/api/ping`, délai initial de 30 s | Sonde de liveness sur le point de terminaison de santé d'AnythingLLM. |
| `uptime_check_config` | désactivé, `/` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis pour les fonctionnalités de base d'AnythingLLM. À activer pour des charges de travail de cache facultatives. |
| `redis_host` | `null` | Point de terminaison Redis. **Obligatoire** lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Détails des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison / port de la base. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `anythingllm-docs`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État du monitoring, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | AnythingLLM nécessite PostgreSQL ; tout autre moteur casse l'ORM Prisma et fait planter le démarrage. |
| Persistance de `STORAGE_DIR` | NFS ou GCS Fuse | Critique | Sans volume persistant, tous les documents de l'espace de travail, les index vectoriels et les données de conversation sont perdus à chaque redémarrage d'instance. |
| `secret_environment_variables` (clés API) | Utiliser des références Secret Manager | Critique | Les clés API des fournisseurs placées en clair dans `environment_variables` sont visibles dans les métadonnées des révisions Cloud Run. |
| `application_database_name` / `_user` | à définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activer sans `backup_file` valide fait échouer le job d'import. |
| `enable_cloudsql_volume` | `true` | Critique | Le désactiver fait échouer toutes les connexions à la base au démarrage. |
| `memory_limit` | `4Gi` | Élevé | Le pipeline d'embedding d'AnythingLLM nécessite 3 à 4 GiB de RAM ; les arrêts pour OOM corrompent l'ingestion en cours. |
| `min_instance_count` | `1` | Élevé | Le scale-to-zero entraîne des démarrages à froid de 30 à 60 s ; les opérations d'IA en cours lors de la réduction d'échelle sont perdues. |
| `timeout_seconds` | `300` (à augmenter pour les charges lourdes) | Élevé | L'ingestion de longs documents ou des complétions LLM lentes dépassent le délai d'expiration du backend et renvoient une erreur 504. |
| `EMBEDDING_ENGINE` | à définir une seule fois | Élevé | Changer de moteur d'embedding après l'ingestion rend les vecteurs existants incompatibles ; tous les documents doivent être réingérés. |
| `ingress_settings` / `enable_iap` | sécurisés pour la production | Élevé | `ingress_settings = "all"` sans IAP expose publiquement l'espace de travail ; seul le formulaire de connexion le protège. |
| `enable_nfs` / GCS Fuse | à activer en multi-instances | Élevé | Sans stockage partagé, au-delà d'une instance chacune dispose d'une vue de stockage isolée ; l'accès aux documents entre instances échoue. |
| `execution_environment` | `gen2` (par défaut) | Élevé | Les montages NFS et GCS Fuse nécessitent gen2 ; avec gen1, le montage du volume échoue silencieusement. |
| `enable_redis` | `false` (ou définir `redis_host`) | Moyen | Si `enable_redis = true` et que `redis_host` ne peut pas être résolu, le conteneur ne démarre pas. |
| `application_version` | épingler sur un tag de version publiée | Moyen | `latest` expose en production à des mises à niveau qui cassent le schéma. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour les exigences de conservation réglementaires. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, scaling et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à AnythingLLM,
partagée avec la variante GKE, est décrite dans
**[AnythingLLM_Common](AnythingLLM_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : AnythingLLM sur Cloud Run](../labs/AnythingLLM_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [AnythingLLM sur GKE Autopilot](AnythingLLM_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [AnythingLLM Common — Configuration applicative partagée](AnythingLLM_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés d'[Outline sur Google Cloud Run](Outline_CloudRun.md), [Ollama sur Google Cloud Run](Ollama_CloudRun.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md) et [Crawl4AI sur Google Cloud Run](Crawl4AI_CloudRun.md) dans la solution **Team Knowledge Assistant**.
