# RAGFlow_CloudRun Module — Configuration Guide

RAGFlow is an open-source document intelligence and Retrieval-Augmented Generation (RAG)
platform. It ingests PDFs, Word documents, HTML pages, and other formats, chunks and embeds
them, stores vectors in Elasticsearch, exposes a REST API for question-answering, and provides
a web UI for knowledge base management and enterprise search.

`RAGFlow_CloudRun` is a **wrapper module** built on top of `App_CloudRun`. It uses `App_CloudRun`
for all GCP infrastructure provisioning (Cloud Run service, Cloud SQL Auth Proxy, GCS buckets,
secrets, CI/CD, load balancer, NFS) and `RAGFlow_Common` to supply the RAGFlow-specific
application configuration, database initialization job, and document storage bucket.

> **Deployment prerequisite:** `RAGFlow_CloudRun` requires `Elasticsearch_GKE` to be deployed
> first. The `elasticsearch_hosts` variable **must be set** when `deploy_application = true` —
> Terraform will reject the configuration otherwise. Inline Elasticsearch is not supported on
> Cloud Run.

---

## §1 · Module Overview

### What `RAGFlow_CloudRun` provides

- A **Cloud Run v2 service** (custom image built from `infiniflow/ragflow` via Cloud Build)
  with a **minimum of one warm instance** — scale-to-zero is disabled because RAGFlow loads
  embedding models at startup, making cold starts too slow for Cloud Run's request timeout.
- **Cloud SQL MySQL 8.0** instance connected via the Cloud SQL Auth Proxy sidecar. The proxy
  Unix socket is injected at `/cloudsql`, and `MYSQL_HOST=127.0.0.1:3306` is set automatically.
- **Redis** integration for the RAGFlow task queue (document processing workers). When
  `enable_redis = true` (default) and `redis_host` is non-empty, `REDIS_HOST` and `REDIS_PORT`
  are injected automatically and the Memorystore connection is wired through the VPC.
- **Elasticsearch** integration — `ELASTICSEARCH_HOSTS` and `ELASTICSEARCH_USERNAME` are
  injected automatically from the `elasticsearch_hosts` and `elasticsearch_username` variables.
- A **GCS bucket** with the suffix `ragflow-documents` (from `RAGFlow_Common`) for document
  ingestion and storage.
- A **MySQL `db-init` Cloud Run Job** that creates the `rag_flow` database and `ragflow` user
  before the application service starts.
- Optional **GCS Fuse** volume mounts for additional document storage access.
- Optional **Cloud Filestore NFS** mount (requires `execution_environment = "gen2"`).

### Key differences from `App_CloudRun` defaults

| Feature | App_CloudRun default | RAGFlow_CloudRun default |
|---|---|---|
| `container_port` | `8080` | `80` (set by `RAGFlow_Common`) |
| `image_source` | varies | `"custom"` (always builds via Dockerfile) |
| `database_type` | varies | `"MYSQL_8_0"` |
| `execution_environment` | varies | `"gen2"` |
| `cpu_limit` | varies | `"4000m"` |
| `memory_limit` | varies | `"8Gi"` |
| `min_instance_count` | `0` | `1` (hard-coded; scale-to-zero disabled) |
| `max_instance_count` | varies | `5` |
| `timeout_seconds` | varies | `600` |
| `enable_cloudsql_volume` | varies | `true` |
| `enable_redis` | `false` | `true` (conditioned on `redis_host != ""`) |
| `vpc_egress_setting` | varies | `"PRIVATE_RANGES_ONLY"` |
| `ingress_settings` | varies | `"all"` |
| `module_dependency` | varies | `["Services_GCP", "Elasticsearch_GKE"]` |
| `credit_cost` | varies | `150` |

### Architecture

```
RAGFlow_CloudRun
├── RAGFlow_Common (sub-module)
│   ├── config output → application_config (local.application_modules)
│   ├── storage_buckets output → module_storage_buckets
│   └── path output → scripts_dir
└── App_CloudRun (foundation module)
    ├── Cloud Run v2 Service (RAGFlow container, min=1 warm instance)
    ├── Cloud SQL MySQL 8.0
    ├── Cloud SQL Auth Proxy sidecar (Unix socket at /cloudsql)
    ├── Redis (Memorystore via VPC egress)
    ├── GCS bucket (ragflow-documents)
    ├── Cloud Run Jobs (db-init, optional cron jobs)
    ├── Optional: NFS (Cloud Filestore, gen2 only)
    ├── Optional: GCS Fuse volumes
    ├── Optional: Cloud Armor WAF + HTTPS Load Balancer
    └── Optional: CI/CD (Cloud Build trigger / Cloud Deploy pipeline)
```

### Platform-managed behaviours

| Behaviour | Detail |
|---|---|
| **Elasticsearch endpoint injected** | `ELASTICSEARCH_HOSTS` is always set from `var.elasticsearch_hosts`. When `deploy_application = true`, Terraform rejects an empty value — deploy `Elasticsearch_GKE` first. |
| **MySQL connection injected** | `MYSQL_HOST=127.0.0.1`, `MYSQL_PORT=3306`, `MYSQL_DATABASE`, and `MYSQL_USER` are always injected. The Cloud SQL Auth Proxy runs as a sidecar via `enable_cloudsql_volume = true`. |
| **Redis queue injected** | When `enable_redis = true` and `redis_host` is non-empty, `REDIS_HOST` and `REDIS_PORT` are injected. The `enable_redis` flag is suppressed internally when `redis_host` is empty to avoid Foundation-level validation errors. |
| **Custom image build** | RAGFlow always builds a custom image via `RAGFlow_Common/scripts/Dockerfile` using Cloud Build. The `APP_VERSION` build argument is set from `application_version`. |
| **`db-init` job auto-generated** | A MySQL initialization Cloud Run Job (`mysql:8.0-debian`) runs `scripts/db-init.sh` on first deploy. It creates the database and user with `mysql_native_password` authentication. |
| **`service_conf.yaml` generated at startup** | The custom entrypoint (`scripts/entrypoint.sh`) writes `/ragflow/conf/service_conf.yaml` from injected environment variables before starting the RAGFlow processes. |
| **`min_instance_count` hard-capped at 1** | `RAGFlow_CloudRun` hard-codes `min_instance_count = 1` in the locals merge, regardless of any Foundation-level default. RAGFlow's embedding model loading makes scale-to-zero impractical on Cloud Run. |
| **NFS requires gen2** | If `enable_nfs = true`, `execution_environment` must be `"gen2"`. `validation.tf` enforces this at plan time. |
| **`module_storage_buckets` sourced from Common** | The document storage bucket defined in `RAGFlow_Common` is passed directly to `App_CloudRun` as `module_storage_buckets`. Any additional buckets in `var.storage_buckets` are handled separately by `App_CloudRun`. |

---

## §2 · Module Metadata (Group 0)

| Variable | Type | Default | Description |
|---|---|---|---|
| `module_description` | `string` | *(RAGFlow Cloud Run description)* | Platform UI description. `{{UIMeta group=0 order=1}}` |
| `module_documentation` | `string` | `"https://docs.radmodules.dev/docs/applications/ragflow"` | Documentation URL. `{{UIMeta group=0 order=2}}` |
| `module_dependency` | `list(string)` | `["Services_GCP", "Elasticsearch_GKE"]` | Modules that must be deployed first. `{{UIMeta group=0 order=3}}` |
| `module_services` | `list(string)` | `["Cloud Run", "Cloud Run Jobs", "Cloud Build", "Artifact Registry", "Cloud Storage", "GCS Fuse", "Cloud SQL (MySQL 8.0)", "VPC Network", "Serverless VPC Access", "Secret Manager", "Cloud IAM", "Cloud Logging", "Cloud Monitoring", "Memorystore (Redis)", "Elasticsearch"]` | GCP services consumed. `{{UIMeta group=0 order=4}}` |
| `credit_cost` | `number` | `150` | Platform credits consumed on deployment. `{{UIMeta group=0 order=5}}` |
| `require_credit_purchases` | `bool` | `true` | Enforce credit balance check before deployment. `{{UIMeta group=0 order=6}}` |
| `enable_purge` | `bool` | `true` | Permit full deletion of all resources on destroy. `{{UIMeta group=0 order=7}}` |
| `public_access` | `bool` | `false` | Platform UI visibility to all users. `{{UIMeta group=0 order=8}}` |
| `deployment_id` | `string` | `""` | Fixed deployment ID; auto-generated (4-byte hex) when blank. `{{UIMeta group=0 order=9 updatesafe}}` |
| `resource_creator_identity` | `string` | `"rad-module-creator@tec-rad-ui-2b65.iam.gserviceaccount.com"` | Service account used by Terraform to create resources. `{{UIMeta group=0 order=10 updatesafe}}` |

---

## §3 · Project & Identity (Group 1)

| Variable | Type | Default | Description |
|---|---|---|---|
| `project_id` | `string` | **required** | GCP project ID. Must be 6–30 characters, start with a letter, and contain only lowercase letters, numbers, and hyphens. `{{UIMeta group=1 order=1}}` |
| `tenant_deployment_id` | `string` | `"demo"` | Unique identifier for the deployment environment (e.g. `"prod"`, `"dev"`). 1–20 lowercase letters, numbers, and hyphens. `{{UIMeta group=1 order=2 updatesafe}}` |
| `support_users` | `list(string)` | `[]` | Email addresses granted IAM access and monitoring alerts. `{{UIMeta group=1 order=3 updatesafe}}` |
| `resource_labels` | `map(string)` | `{}` | Key-value labels applied to all resources. `{{UIMeta group=1 order=4 updatesafe}}` |

---

## §4 · Application Identity (Group 2)

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `"ragflow"` | Internal identifier for the application. Lowercase. Used as the base for resource names. `{{UIMeta group=2 order=1 updatesafe}}` |
| `display_name` | `string` | `"RAGFlow"` | Human-readable name shown in the Cloud Run console and UI. `{{UIMeta group=2 order=2 updatesafe}}` |
| `description` | `string` | `"RAGFlow Document Intelligence and RAG Engine on Cloud Run"` | Brief description passed into Kubernetes annotations and the `db-init` job. `{{UIMeta group=2 order=3 updatesafe}}` |
| `application_version` | `string` | `"v0.13.0"` | RAGFlow version tag. Increment to trigger a new Cloud Build and revision deployment. `{{UIMeta group=2 order=4 updatesafe}}` |

---

## §5 · Runtime & Scaling (Group 3)

| Variable | Type | Default | Description |
|---|---|---|---|
| `deploy_application` | `bool` | `true` | Set `false` to provision infrastructure (MySQL, secrets, GCS) without deploying the Cloud Run service. `{{UIMeta group=3 order=0 updatesafe}}` |
| `container_image_source` | `string` | `"custom"` | `"custom"` builds from `RAGFlow_Common/scripts/Dockerfile`; `"prebuilt"` deploys an existing image. Options: `prebuilt`, `custom`. `{{UIMeta group=3 order=1 updatesafe}}` |
| `container_image` | `string` | `""` | Override image URI. Leave empty to use the Cloud Build result from `RAGFlow_Common`. `{{UIMeta group=3 order=2 updatesafe}}` |
| `cpu_limit` | `string` | `"4000m"` | CPU limit per container instance. RAGFlow document parsing is CPU-intensive. `{{UIMeta group=3 order=3 updatesafe}}` |
| `memory_limit` | `string` | `"8Gi"` | Memory limit per container instance. Embedding models require significant RAM. `{{UIMeta group=3 order=4 updatesafe}}` |
| `container_port` | `number` | `80` | TCP port the RAGFlow container listens on. RAGFlow's Nginx frontend uses port 80. `{{UIMeta group=3 order=5 updatesafe}}` |
| `max_instance_count` | `number` | `5` | Maximum number of Cloud Run instances. Valid range: 1–1000. `{{UIMeta group=3 order=6 updatesafe}}` |
| `execution_environment` | `string` | `"gen2"` | Cloud Run execution environment. `"gen2"` is required for NFS mounts. Options: `gen1`, `gen2`. `{{UIMeta group=3 order=7 updatesafe}}` |
| `timeout_seconds` | `number` | `600` | Maximum duration in seconds Cloud Run waits for a response. Large document processing can be slow. Valid range: 0–3600. `{{UIMeta group=3 order=8 updatesafe}}` |
| `container_protocol` | `string` | `"http1"` | HTTP protocol version for the Cloud Run service. Options: `http1`, `h2c`. `{{UIMeta group=3 order=9 updatesafe}}` |
| `enable_image_mirroring` | `bool` | `true` | Mirrors the container image into Artifact Registry before deployment. Recommended to avoid Docker Hub rate limits. `{{UIMeta group=3 order=10 updatesafe}}` |
| `enable_cloudsql_volume` | `bool` | `true` | Injects a Cloud SQL Auth Proxy sidecar for Unix socket connections to Cloud SQL MySQL. `{{UIMeta group=3 order=11 updatesafe}}` |
| `cloudsql_volume_mount_path` | `string` | `"/cloudsql"` | Filesystem path for the Cloud SQL Auth Proxy Unix socket. `{{UIMeta group=3 order=12 updatesafe}}` |
| `traffic_split` | `list(object)` | `[]` | Traffic allocation across Cloud Run revisions for canary or blue-green deployments. Empty list sends all traffic to the latest revision. Percentages must sum to 100. `{{UIMeta group=3 order=13 updatesafe}}` |
| `service_annotations` | `map(string)` | `{}` | Custom annotations applied to the Cloud Run service resource. `{{UIMeta group=3 order=14 updatesafe}}` |
| `service_labels` | `map(string)` | `{}` | Custom labels applied to the Cloud Run service resource. `{{UIMeta group=3 order=15 updatesafe}}` |

> **Note:** `min_instance_count` is always set to `1` internally and cannot be overridden at
> the `RAGFlow_CloudRun` level. RAGFlow loads embedding models during startup, making
> scale-to-zero impractical within Cloud Run's request timeout window.

---

## §6 · Access & Networking (Group 4)

| Variable | Type | Default | Description |
|---|---|---|---|
| `ingress_settings` | `string` | `"all"` | Controls which traffic sources can reach the Cloud Run service. Options: `all`, `internal`, `internal-and-cloud-load-balancing`. `{{UIMeta group=4 order=1 updatesafe}}` |
| `vpc_egress_setting` | `string` | `"PRIVATE_RANGES_ONLY"` | Controls which outbound traffic is routed through the VPC. `"PRIVATE_RANGES_ONLY"` routes Redis and MySQL traffic through the VPC while allowing direct public egress. Options: `ALL_TRAFFIC`, `PRIVATE_RANGES_ONLY`. `{{UIMeta group=4 order=2 updatesafe}}` |
| `enable_iap` | `bool` | `false` | Enables Identity-Aware Proxy for Google identity authentication. When `true`, at least one of `iap_authorized_users` or `iap_authorized_groups` must be specified. `{{UIMeta group=4 order=3 updatesafe}}` |
| `iap_authorized_users` | `list(string)` | `[]` | IAP user allowlist. Only used when `enable_iap = true`. `{{UIMeta group=4 order=4 updatesafe}}` |
| `iap_authorized_groups` | `list(string)` | `[]` | IAP group allowlist. Only used when `enable_iap = true`. `{{UIMeta group=4 order=5 updatesafe}}` |

---

## §7 · Environment Variables & Secrets (Group 5)

| Variable | Type | Default | Description |
|---|---|---|---|
| `environment_variables` | `map(string)` | `{}` | Additional plain-text environment variables injected into the RAGFlow container. Do not override automatically-injected variables (see table below). `{{UIMeta group=5 order=1 updatesafe}}` |
| `secret_environment_variables` | `map(string)` | `{}` | Secret Manager secret names injected as environment variables. Map of env var name to secret name. `{{UIMeta group=5 order=2 updatesafe}}` |
| `secret_propagation_delay` | `number` | `30` | Seconds to wait after a secret is created before proceeding. Valid range: 0–300. `{{UIMeta group=5 order=3 updatesafe}}` |
| `secret_rotation_period` | `string` | `"2592000s"` | Secret rotation notification period (default 30 days). Must be a duration in seconds followed by `s`. `{{UIMeta group=5 order=4 updatesafe}}` |

### Automatically Injected Environment Variables

The following variables are always injected by `RAGFlow_CloudRun` and must not be set in
`environment_variables`:

| Variable | Value | Source |
|---|---|---|
| `MYSQL_HOST` | `"127.0.0.1"` | Cloud SQL Auth Proxy sidecar address |
| `MYSQL_PORT` | `"3306"` | MySQL standard port |
| `MYSQL_DATABASE` | `var.db_name` | RAGFlow database name |
| `MYSQL_USER` | `var.db_user` | RAGFlow database user |
| `ELASTICSEARCH_HOSTS` | `var.elasticsearch_hosts` | Elasticsearch HTTP endpoint |
| `ELASTICSEARCH_USERNAME` | `var.elasticsearch_username` | Elasticsearch username |
| `REDIS_HOST` | `var.redis_host` | Redis server host |
| `REDIS_PORT` | `var.redis_port` | Redis server port |

---

## §8 · Backup & Maintenance (Group 6)

| Variable | Type | Default | Description |
|---|---|---|---|
| `backup_schedule` | `string` | `"0 2 * * *"` | Backup cron schedule (UTC). `{{UIMeta group=6 order=1 updatesafe}}` |
| `backup_retention_days` | `number` | `7` | Number of days to retain backup files in GCS. `{{UIMeta group=6 order=2 updatesafe}}` |
| `enable_backup_import` | `bool` | `false` | Triggers a one-time database import Cloud Run Job during deployment. `{{UIMeta group=6 order=3 updatesafe}}` |
| `backup_source` | `string` | `"gcs"` | Source system for backup import. Options: `gcs`, `gdrive`. `{{UIMeta group=6 order=4 updatesafe}}` |
| `backup_uri` | `string` | `""` | Backup file URI for import. For GCS: `"gs://my-bucket/backup.sql"`. `{{UIMeta group=6 order=5 updatesafe}}` |
| `backup_format` | `string` | `"sql"` | Backup file format. Options: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. `{{UIMeta group=6 order=6 updatesafe}}` |

---

## §9 · CI/CD & GitHub Integration (Group 7)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | `bool` | `false` | Enables a Cloud Build trigger for automated deployments on GitHub push. `{{UIMeta group=7 order=1 updatesafe}}` |
| `github_repository_url` | `string` | `""` | Full HTTPS URL of the GitHub repository for Cloud Build. `{{UIMeta group=7 order=2 updatesafe}}` |
| `github_token` | `string` | `""` | GitHub Personal Access Token for Cloud Build. Sensitive. `{{UIMeta group=7 order=3 updatesafe}}` |
| `github_app_installation_id` | `string` | `""` | Installation ID of the Cloud Build GitHub App. `{{UIMeta group=7 order=4 updatesafe}}` |
| `cicd_trigger_config` | `object` | `{ branch_pattern="^main$", description="Automated build and deployment trigger" }` | Advanced CI/CD trigger configuration including branch filter, included/ignored files, trigger name, and substitutions. `{{UIMeta group=7 order=5 updatesafe}}` |
| `enable_cloud_deploy` | `bool` | `false` | Switches CI/CD to a managed Google Cloud Deploy pipeline. `{{UIMeta group=7 order=6 updatesafe}}` |
| `cloud_deploy_stages` | `list(object)` | `[dev, staging, prod(approval)]` | Cloud Deploy pipeline stages with optional promotion approval. `{{UIMeta group=7 order=7 updatesafe}}` |
| `enable_binary_authorization` | `bool` | `false` | Enforces Binary Authorization policy on the Cloud Run service. `{{UIMeta group=7 order=8 updatesafe}}` |

---

## §10 · Custom SQL (Group 8)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_custom_sql_scripts` | `bool` | `false` | Runs custom SQL scripts from a GCS bucket after provisioning. `{{UIMeta group=8 order=1 updatesafe}}` |
| `custom_sql_scripts_bucket` | `string` | `""` | GCS bucket containing SQL scripts. `{{UIMeta group=8 order=2 updatesafe}}` |
| `custom_sql_scripts_path` | `string` | `""` | Path prefix within the GCS bucket for SQL scripts. `{{UIMeta group=8 order=3 updatesafe}}` |
| `custom_sql_scripts_use_root` | `bool` | `false` | Execute custom SQL scripts as the root database user. `{{UIMeta group=8 order=4 updatesafe}}` |

---

## §11 · Load Balancer & CDN (Group 9)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | `bool` | `false` | Enables a Cloud Armor WAF policy fronted by a Global HTTPS Load Balancer. `{{UIMeta group=9 order=1 updatesafe}}` |
| `admin_ip_ranges` | `list(string)` | `[]` | IP CIDR ranges permitted for administrative access through Cloud Armor. `{{UIMeta group=9 order=2 updatesafe}}` |
| `application_domains` | `list(string)` | `[]` | Custom domain names for the Cloud Armor Load Balancer. Requires `enable_cloud_armor = true`. `{{UIMeta group=9 order=3 updatesafe}}` |
| `enable_cdn` | `bool` | `false` | Enables Cloud CDN on the HTTPS Load Balancer. `{{UIMeta group=9 order=4 updatesafe}}` |

---

## §12 · Storage & Filesystem (Group 10)

| Variable | Type | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | `bool` | `true` | Controls whether the module provisions additional GCS buckets. The `ragflow-documents` bucket from `RAGFlow_Common` is always created. `{{UIMeta group=10 order=1 updatesafe}}` |
| `storage_buckets` | `list(object)` | `[{ name_suffix="data" }]` | Additional GCS bucket configurations beyond the `ragflow-documents` bucket. Each supports `name_suffix`, `location`, `storage_class`, `force_destroy`, `versioning_enabled`, `lifecycle_rules`, `public_access_prevention`, and `uniform_bucket_level_access`. `{{UIMeta group=10 order=2 updatesafe}}` |
| `enable_nfs` | `bool` | `false` | Provisions a Cloud Filestore NFS instance and mounts it into the Cloud Run service. Requires `execution_environment = "gen2"`. `{{UIMeta group=10 order=3 updatesafe}}` |
| `nfs_mount_path` | `string` | `"/mnt/nfs"` | Filesystem path inside the container where the NFS volume is mounted. `{{UIMeta group=10 order=4 updatesafe}}` |
| `nfs_instance_name` | `string` | `""` | Name of an existing NFS GCE VM. Auto-discovered when empty. `{{UIMeta group=10 order=5 updatesafe}}` |
| `nfs_instance_base_name` | `string` | `"app-nfs"` | Base name for an inline NFS GCE VM provisioned by the Foundation module. `{{UIMeta group=10 order=6 updatesafe}}` |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volumes mounted into the RAGFlow container for document storage. Each entry requires `name`, `mount_path`, and optionally `bucket_name`, `readonly`, and `mount_options`. Default mount options: `implicit-dirs`, 60-second stat/type cache TTLs. `{{UIMeta group=10 order=7 updatesafe}}` |
| `manage_storage_kms_iam` | `bool` | `false` | Creates a CMEK KMS keyring for storage encryption. `{{UIMeta group=10 order=8 updatesafe}}` |
| `enable_artifact_registry_cmek` | `bool` | `false` | Enables CMEK encryption for Artifact Registry. `{{UIMeta group=10 order=9 updatesafe}}` |

---

## §13 · Database (Group 11)

| Variable | Type | Default | Description |
|---|---|---|---|
| `db_name` | `string` | `"rag_flow"` | MySQL database name for RAGFlow. Do not change after deployment. `{{UIMeta group=11 order=1 updatesafe}}` |
| `db_user` | `string` | `"ragflow"` | MySQL database user for RAGFlow. `{{UIMeta group=11 order=2 updatesafe}}` |
| `database_password_length` | `number` | `32` | Length of the randomly generated database user password. Valid range: 16–64. `{{UIMeta group=11 order=3 updatesafe}}` |
| `enable_auto_password_rotation` | `bool` | `false` | Enables automatic rotation of the database user password. `{{UIMeta group=11 order=4 updatesafe}}` |
| `rotation_propagation_delay_sec` | `number` | `90` | Seconds to wait after a new password is written before restarting the Cloud Run revision. `{{UIMeta group=11 order=5 updatesafe}}` |

---

## §14 · Jobs & Scheduled Tasks (Group 12)

| Variable | Type | Default | Description |
|---|---|---|---|
| `initialization_jobs` | `list(object)` | `[]` | Cloud Run Jobs executed before the application starts. When empty, the auto-generated MySQL `db-init` job from `RAGFlow_Common` runs. Each job supports `name`, `description`, `image`, `command`, `args`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `task_count`, `execution_mode`, `mount_nfs`, `mount_gcs_volumes`, `depends_on_jobs`, `execute_on_apply`, and `script_path`. `{{UIMeta group=12 order=1 updatesafe}}` |
| `cron_jobs` | `list(object)` | `[]` | Recurring Cloud Run Jobs deployed on a cron schedule. Each job supports `name`, `schedule`, `image`, `command`, `args`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `task_count`, `parallelism`, `mount_nfs`, `mount_gcs_volumes`, `script_path`, and `paused`. `{{UIMeta group=12 order=2 updatesafe}}` |

---

## §15 · Observability & Health (Group 13)

| Variable | Type | Default | Description |
|---|---|---|---|
| `startup_probe` | `object` | `{ enabled=true, type="HTTP", path="/v1/health", initial_delay_seconds=60, timeout_seconds=10, period_seconds=10, failure_threshold=18 }` | Startup probe configuration. RAGFlow loads embedding models at boot — the default allows up to 180 seconds before failing. `{{UIMeta group=13 order=1 updatesafe}}` |
| `liveness_probe` | `object` | `{ enabled=true, type="HTTP", path="/v1/health", initial_delay_seconds=120, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` | Liveness probe configuration. Checks `/v1/health` every 30 seconds after a 120-second initial delay. `{{UIMeta group=13 order=2 updatesafe}}` |
| `uptime_check_config` | `object` | `{ enabled=false, path="/v1/health", check_interval="60s", timeout="10s" }` | Cloud Monitoring uptime check. Enable to receive alerts when the service is unreachable. `{{UIMeta group=13 order=3 updatesafe}}` |
| `alert_policies` | `list(object)` | `[]` | Cloud Monitoring alert policies. Each policy requires `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`, and optionally `aggregation_period`. `{{UIMeta group=13 order=4 updatesafe}}` |

---

## §16 · Elasticsearch & Redis (Group 14)

| Variable | Type | Default | Description |
|---|---|---|---|
| `elasticsearch_hosts` | `string` | `""` | **Required when `deploy_application = true`.** Elasticsearch HTTP endpoint for RAGFlow document indexing and vector search. Set to the `elasticsearch_endpoint` output from `Elasticsearch_GKE` (e.g. `"http://10.0.0.5:9200"`). Inline Elasticsearch is not supported on Cloud Run. `{{UIMeta group=14 order=1 updatesafe}}` |
| `elasticsearch_username` | `string` | `""` | Username for Elasticsearch authentication. Leave empty when `xpack.security.enabled = false`. `{{UIMeta group=14 order=2 updatesafe}}` |
| `enable_redis` | `bool` | `true` | Enables Redis as the RAGFlow task queue backend. Required for document processing workers. The Redis connection is only wired when `redis_host` is non-empty. `{{UIMeta group=14 order=3 updatesafe}}` |
| `redis_host` | `string` | `""` | Hostname or IP of the Redis server for the RAGFlow task queue. Use the `redis_host` output from `Services_GCP` (Memorystore). `{{UIMeta group=14 order=4 updatesafe}}` |
| `redis_port` | `string` | `"6379"` | TCP port of the Redis server. `{{UIMeta group=14 order=5 updatesafe}}` |
| `redis_auth` | `string` | `""` | Authentication password for the Redis server. Sensitive. `{{UIMeta group=14 order=6 updatesafe}}` |

---

## §17 · VPC Service Controls (Group 21)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_vpc_sc` | `bool` | `false` | Enforces VPC Service Controls perimeters. `{{UIMeta group=21 order=1 updatesafe}}` |
| `vpc_cidr_ranges` | `list(string)` | `[]` | VPC subnet CIDR ranges for the VPC-SC network access level. `{{UIMeta group=21 order=2 updatesafe}}` |
| `vpc_sc_dry_run` | `bool` | `true` | When `true`, VPC-SC violations are logged but not blocked. `{{UIMeta group=21 order=3 updatesafe}}` |
| `organization_id` | `string` | `""` | GCP Organization ID for the VPC-SC policy. `{{UIMeta group=21 order=4 updatesafe}}` |
| `enable_audit_logging` | `bool` | `false` | Enables detailed Cloud Audit Logs for the project. `{{UIMeta group=21 order=5 updatesafe}}` |

---

## §18 · Validation Guards

`validation.tf` enforces the following preconditions at plan time using a `null_resource`
lifecycle precondition block:

| Guard | Error Message |
|---|---|
| `elasticsearch_hosts != ""` when `deploy_application = true` | `elasticsearch_hosts` must be set — deploy `Elasticsearch_GKE` first. The check is skipped for infrastructure-only applies (`deploy_application = false`) so operators can provision MySQL and storage before standing up Elasticsearch. |
| `enable_redis = true` requires `redis_host != ""` when `deploy_application = true` | When Redis is enabled and the service is being deployed, `redis_host` must be set. Use the `redis_host` output from `Services_GCP`. |
| `enable_iap = true` requires at least one of `iap_authorized_users` or `iap_authorized_groups` | When IAP is enabled, at least one authorized user or group must be specified. |
| `enable_nfs = true` requires `execution_environment = "gen2"` | NFS mounts require the gen2 Cloud Run execution environment. |

---

## §19 · Outputs

| Output | Description |
|---|---|
| `service_name` | Name of the Cloud Run service. |
| `service_url` | Public service URL (Cloud Run default URL or Cloud Armor LB URL). |
| `service_location` | GCP region where the Cloud Run service is deployed. |
| `project_id` | GCP project ID. |
| `deployment_id` | Unique deployment identifier (4-byte hex suffix). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name (`rag_flow` by default). |
| `database_user` | Application database username (`ragflow` by default). |
| `database_password_secret` | Secret Manager secret name containing the database password. |
| `storage_buckets` | All provisioned GCS buckets (includes `ragflow-documents` and any additional buckets). |
| `nfs_server_ip` | NFS server internal IP (sensitive). Empty when `enable_nfs = false`. |
| `nfs_mount_path` | NFS mount path inside containers. |
| `container_image` | Full container image URI used for the deployed revision. |
| `cicd_enabled` | Whether the CI/CD pipeline (Cloud Build trigger or Cloud Deploy) is enabled. |
| `github_repository_url` | GitHub repository URL connected for CI/CD. |

---

## §20 · Notable Differences from `RAGFlow_GKE`

| Feature | RAGFlow_GKE | RAGFlow_CloudRun |
|---|---|---|
| **Compute platform** | GKE Autopilot (Kubernetes Deployment) | Cloud Run v2 (serverless containers) |
| **Minimum instances** | Hard-coded `min_instance_count = 1` | Hard-coded `min_instance_count = 1` (same reason) |
| **Network exposure** | Kubernetes `LoadBalancer` service with external IP | Cloud Run public URL; optional Cloud Armor HTTPS LB |
| **Session affinity** | `"ClientIP"` by default | Not applicable (stateless Cloud Run requests) |
| **Static IP reservation** | `reserve_static_ip = true` by default | Managed via `enable_cloud_armor` + `application_domains` |
| **NFS** | Enabled by default (`enable_nfs = true`) | Disabled by default (`enable_nfs = false`); requires gen2 |
| **Redis auto-discovery** | `redis_host` auto-resolved from NFS VM IP | `redis_host` must be set explicitly; no auto-discovery |
| **Validation — Elasticsearch** | Terraform rejects empty `elasticsearch_hosts` unconditionally | Check is skipped when `deploy_application = false` |
| **Validation — IAP** | Requires OAuth client ID and secret | Requires at least one authorized user or group |
| **Deployment timeout** | `1800s` (GKE rollout) | Cloud Run revision timeout controlled by `timeout_seconds` |
| **Additional services** | Supports `additional_services` (extra Kubernetes Deployments) | Not applicable |
| **Pod disruption budget** | Configurable via `enable_pod_disruption_budget` | Not applicable |
| **StatefulSet support** | Configurable via `workload_type = "StatefulSet"` | Not applicable |
| **Resource quotas** | Configurable via `enable_resource_quota` | Not applicable |
| **Traffic splitting** | Native Kubernetes rolling updates | Cloud Run `traffic_split` for canary/blue-green |

---

## §21 · Resources Created

The following GCP resources are provisioned when this module is applied:

- **Cloud Run v2 Service** — RAGFlow application container (min 1 instance, gen2 by default)
- **Cloud Run Job** — MySQL `db-init` initialization job (runs `db-init.sh` on first deploy)
- **Cloud SQL MySQL 8.0** — Managed relational database for RAGFlow metadata
- **Secret Manager secrets** — Database password and any `secret_environment_variables`
- **GCS bucket** — `ragflow-documents` for document ingestion storage
- **GCS bucket** — Additional buckets per `storage_buckets` (default: one `data` bucket)
- **Artifact Registry** — Container image repository (if not already provisioned by `Services_GCP`)
- **Serverless VPC Access connector** — For private Redis and MySQL egress
- **Cloud Build trigger** — Optional; created when `enable_cicd_trigger = true`
- **Cloud Deploy pipeline** — Optional; created when `enable_cloud_deploy = true`
- **Global HTTPS Load Balancer + Cloud Armor policy** — Optional; created when `enable_cloud_armor = true`
- **Cloud CDN** — Optional; attached to the LB when `enable_cdn = true`
- **Cloud Filestore NFS** — Optional; created when `enable_nfs = true`
- **Cloud Monitoring uptime check** — Optional; created when `uptime_check_config.enabled = true`
- **Cloud Monitoring alert policies** — Optional; one per entry in `alert_policies`
- **`random_id`** — 4-byte hex deployment ID generated when `deployment_id` is not set

---

## §22 · Configuration Examples

### Basic Deployment

```hcl
# config/basic.tfvars
resource_creator_identity = "rad-module-creator@tec-rad-ui-2b65.iam.gserviceaccount.com"
project_id                = "your-gcp-project-id"
tenant_deployment_id      = "basic"

# RAGFlow version
application_version = "v0.13.0"

# Elasticsearch endpoint — from: tofu output elasticsearch_endpoint (Elasticsearch_GKE)
elasticsearch_hosts = "http://ELASTICSEARCH_EXTERNAL_IP:9200"

# Database
db_name = "rag_flow"
db_user = "ragflow"

# Redis — from Services_GCP redis_host output
enable_redis = true
redis_host   = "REDIS_IP_FROM_SERVICES_GCP"
redis_port   = "6379"

# Resources — RAGFlow is memory-intensive due to embedded AI models
cpu_limit    = "4000m"
memory_limit = "8Gi"
```

### Advanced Deployment

```hcl
# config/advanced.tfvars
resource_creator_identity = "rad-module-creator@tec-rad-ui-2b65.iam.gserviceaccount.com"
project_id                = "your-gcp-project-id"
tenant_deployment_id      = "prod"

application_version = "v0.13.0"

# Elasticsearch — required
elasticsearch_hosts    = "http://ELASTICSEARCH_EXTERNAL_IP:9200"
elasticsearch_username = ""

# Database
db_name = "rag_flow"
db_user = "ragflow"

# Redis for document processing queue
enable_redis = true
redis_host   = "REDIS_IP_FROM_SERVICES_GCP"
redis_port   = "6379"

# Scale-up for production document workloads
cpu_limit          = "8000m"
memory_limit       = "16Gi"
max_instance_count = 5

# Increase timeout for large document processing requests
timeout_seconds = 900

# Custom domain via Cloud Armor
enable_cloud_armor  = true
application_domains = ["ragflow.example.com"]
enable_cdn          = false

# Monitoring
uptime_check_config = {
  enabled        = true
  path           = "/v1/health"
  check_interval = "60s"
  timeout        = "10s"
}

# Auto-rotate the MySQL password every 30 days
enable_auto_password_rotation  = true
rotation_propagation_delay_sec = 90

support_users = ["ops@example.com"]
resource_labels = {
  env     = "production"
  service = "ragflow"
}
```
