# RAGFlow_GKE Module — Configuration Guide

RAGFlow is an open-source document intelligence and Retrieval-Augmented Generation (RAG)
platform. It ingests PDFs, Word documents, HTML pages, and other formats, chunks and embeds
them, stores vectors in Elasticsearch, exposes a REST API for question-answering, and provides
a web UI for knowledge base management and enterprise search.

`RAGFlow_GKE` is a **wrapper module** built on top of `App_GKE`. It uses `App_GKE` for all
GCP infrastructure provisioning (GKE Autopilot cluster, networking, Cloud SQL Auth Proxy, GCS,
secrets, CI/CD) and `RAGFlow_Common` to supply the RAGFlow-specific application configuration,
database initialization job, and document storage bucket.

> **Deployment prerequisite:** `RAGFlow_GKE` requires `Elasticsearch_GKE` to be deployed
> first. The `elasticsearch_hosts` variable is **mandatory** — Terraform will reject the
> configuration if it is empty.

---

## §1 · Module Overview

### What `RAGFlow_GKE` provides

- A **RAGFlow Kubernetes Deployment** (custom image built from `infiniflow/ragflow` via
  Cloud Build) running on GKE Autopilot with a **LoadBalancer** service on port 80.
- **Cloud SQL MySQL 8.0** instance connected via the Cloud SQL Auth Proxy sidecar at
  `127.0.0.1:3306` inside the pod.
- **Redis** integration for the RAGFlow task queue (document processing workers). When
  `enable_redis = true` (default), `REDIS_HOST` and `REDIS_PORT` are injected automatically.
- **Elasticsearch** integration — `ELASTICSEARCH_HOSTS` and `ELASTICSEARCH_USERNAME` are
  injected automatically from the `elasticsearch_hosts` and `elasticsearch_username` variables.
- A **GCS bucket** (`<prefix>-ragflow-documents`) for document ingestion storage.
- A **MySQL `db-init` Kubernetes Job** that creates the `rag_flow` database and `ragflow`
  user before the application pod starts.
- **NFS** mount enabled by default (`enable_nfs = true`) for shared document processing.
- **ClientIP session affinity** by default, ensuring that browser uploads and multi-step
  document processing requests consistently reach the same pod.

### Key differences from `App_GKE` defaults

| Feature | App_GKE default | RAGFlow_GKE default |
|---|---|---|
| `container_port` | `8080` | `80` (set by RAGFlow_Common) |
| `image_source` | varies | `"custom"` (always builds via Dockerfile) |
| `database_type` | varies | `"MYSQL_8_0"` |
| `service_type` | varies | `"LoadBalancer"` |
| `session_affinity` | `"None"` | `"ClientIP"` |
| `enable_nfs` | `false` | `true` |
| `enable_redis` | varies | `true` |
| `termination_grace_period_seconds` | `60` | `60` |
| `deployment_timeout` | `600` | `1800` |
| `reserve_static_ip` | `false` | `true` |
| `network_tags` | `[]` | `["nfsserver"]` |
| `module_dependency` | varies | `["Services_GCP", "Elasticsearch_GKE"]` |
| `credit_cost` | varies | `150` |

### Architecture

```
RAGFlow_GKE
├── RAGFlow_Common (sub-module)
│   ├── config output → application_config
│   ├── storage_buckets output → module_storage_buckets
│   └── path output → scripts_dir
└── App_GKE (foundation module)
    ├── GKE Autopilot cluster
    ├── Cloud SQL MySQL 8.0
    ├── Cloud SQL Auth Proxy sidecar
    ├── Redis (Memorystore or NFS-hosted)
    ├── NFS mount
    ├── GCS bucket (ragflow-documents)
    └── Kubernetes resources (Deployment, Service, Jobs, HPA)
```

### Platform-managed behaviours

| Behaviour | Detail |
|---|---|
| **Elasticsearch endpoint injected** | `ELASTICSEARCH_HOSTS` is always set from `var.elasticsearch_hosts`. Terraform rejects empty values — deploy `Elasticsearch_GKE` first. |
| **MySQL connection injected** | `MYSQL_HOST=127.0.0.1`, `MYSQL_PORT=3306`, `MYSQL_DATABASE`, and `MYSQL_USER` are always injected. The Cloud SQL Auth Proxy runs as a sidecar. |
| **Redis queue injected** | When `enable_redis = true`, `REDIS_HOST` and `REDIS_PORT` are injected automatically. |
| **Custom image build** | RAGFlow always builds a custom image via `RAGFlow_Common/scripts/Dockerfile` using Cloud Build. The `APP_VERSION` build arg is set from `application_version`. |
| **`db-init` job auto-generated** | A MySQL initialization Job (`mysql:8.0-debian`) runs `scripts/db-init.sh` on first deploy. It creates the database and user with `mysql_native_password` auth. |
| **`service_conf.yaml` generated at startup** | The custom entrypoint (`scripts/entrypoint.sh`) writes `/ragflow/conf/service_conf.yaml` from environment variables before starting the RAGFlow processes. |
| **Network discovery** | The module uses `App_Common/modules/app_networking` to discover the VPC region from existing subnets. Falls back to `var.deployment_region` when no subnets are found. |
| **`min_instance_count` hard-capped at 1** | `RAGFlow_GKE` hard-codes `min_instance_count = 1` in the `locals` merge, regardless of `var.min_instance_count`. |

---

## §2 · IAM & Project Identity (Group 0 & 1)

| Variable | Type | Default | Description |
|---|---|---|---|
| `module_description` | `string` | *(RAGFlow GKE description)* | Platform UI description. `{{UIMeta group=0 order=1}}` |
| `module_documentation` | `string` | `"https://docs.radmodules.dev/docs/applications/ragflow"` | Documentation URL. `{{UIMeta group=0 order=2}}` |
| `module_dependency` | `list(string)` | `["Services_GCP", "Elasticsearch_GKE"]` | Modules that must be deployed first. `{{UIMeta group=0 order=3}}` |
| `module_services` | `list(string)` | *(GKE, MySQL, Elasticsearch, Redis, etc.)* | GCP services consumed. `{{UIMeta group=0 order=4}}` |
| `credit_cost` | `number` | `150` | Platform credits consumed on deployment. `{{UIMeta group=0 order=5}}` |
| `require_credit_purchases` | `bool` | `true` | Enforce credit balance check. `{{UIMeta group=0 order=6}}` |
| `enable_purge` | `bool` | `true` | Permit full deletion on destroy. `{{UIMeta group=0 order=7}}` |
| `public_access` | `bool` | `false` | Platform UI visibility. `{{UIMeta group=0 order=8}}` |
| `deployment_id` | `string` | `""` | Fixed deployment ID; auto-generated when blank. `{{UIMeta group=0 order=9}}` |
| `resource_creator_identity` | `string` | `"rad-module-creator@tec-rad-ui-2b65.iam.gserviceaccount.com"` | Terraform service account. `{{UIMeta group=0 order=9}}` |
| `project_id` | `string` | **required** | GCP project ID. `{{UIMeta group=1 order=1}}` |
| `tenant_deployment_id` | `string` | `"demo"` | 1–20 lowercase letters, numbers, hyphens. `{{UIMeta group=1 order=2}}` |
| `support_users` | `list(string)` | `[]` | Email addresses granted IAM access and monitoring alerts. `{{UIMeta group=1 order=3}}` |
| `resource_labels` | `map(string)` | `{}` | Labels applied to all resources. `{{UIMeta group=1 order=4}}` |
| `deployment_region` | `string` | `"us-central1"` | GCP region fallback. `{{UIMeta group=1 order=5}}` |

---

## §3 · Application Identity (Group 2)

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `"ragflow"` | Base name for Kubernetes resources. Do not change after deployment. `{{UIMeta group=2 order=1}}` |
| `application_display_name` | `string` | `"RAGFlow"` | Human-readable name in the UI. `{{UIMeta group=2 order=2}}` |
| `application_description` | `string` | `"RAGFlow Document Intelligence and RAG Engine on GKE Autopilot"` | Description in Kubernetes annotations. `{{UIMeta group=2 order=3}}` |
| `application_version` | `string` | `"v0.13.0"` | RAGFlow image tag. Increment to trigger a new Cloud Build and rollout. `{{UIMeta group=2 order=4}}` |
| `display_name` | `string` | `"RAGFlow"` | Alternative display name field. `{{UIMeta group=2 order=11}}` |
| `description` | `string` | `"RAGFlow Document Intelligence and RAG Engine on GKE Autopilot"` | Used in Kubernetes annotations and the `db-init` job description. `{{UIMeta group=2 order=3}}` |

---

## §4 · Runtime & Scaling (Group 3)

| Variable | Type | Default | Description |
|---|---|---|---|
| `deploy_application` | `bool` | `true` | Set `false` to provision infrastructure without deploying the Kubernetes workload. `{{UIMeta group=3 order=0}}` |
| `container_image_source` | `string` | `"custom"` | `"custom"` builds from `RAGFlow_Common/scripts/Dockerfile`; `"prebuilt"` deploys an existing image. Options: `prebuilt`, `custom`. `{{UIMeta group=3 order=1}}` |
| `container_image` | `string` | `""` | Override image URI. Leave empty to use the Cloud Build result. `{{UIMeta group=3 order=2}}` |
| `container_build_config` | `object` | `{ enabled=true }` | Cloud Build configuration. `{{UIMeta group=3 order=3}}` |
| `enable_image_mirroring` | `bool` | `true` | Mirror the source image to Artifact Registry. `{{UIMeta group=3 order=4}}` |
| `min_instance_count` | `number` | `1` | Minimum pod replicas. Hard-capped at `1` internally. `{{UIMeta group=3 order=5}}` |
| `max_instance_count` | `number` | `5` | Maximum pod replicas. `{{UIMeta group=3 order=6}}` |
| `enable_vertical_pod_autoscaling` | `bool` | `false` | Enable VPA. `{{UIMeta group=3 order=7}}` |
| `container_port` | `number` | `80` | TCP port the RAGFlow container listens on. `{{UIMeta group=3 order=8}}` |
| `container_protocol` | `string` | `"http1"` | HTTP protocol version. Options: `http1`, `h2c`. `{{UIMeta group=3 order=9}}` |
| `container_resources` | `object` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Full container resource override. When set, takes precedence over `cpu_limit` and `memory_limit`. `{{UIMeta group=3 order=10}}` |
| `timeout_seconds` | `number` | `300` | Load balancer backend timeout. Valid range: 0–3600. `{{UIMeta group=3 order=11}}` |
| `enable_cloudsql_volume` | `bool` | `true` | Injects Cloud SQL Auth Proxy sidecar. Must remain `true` when `database_type != "NONE"`. `{{UIMeta group=3 order=12}}` |
| `cloudsql_volume_mount_path` | `string` | `"/cloudsql"` | Cloud SQL Auth Proxy socket path. `{{UIMeta group=3 order=13}}` |
| `service_annotations` | `map(string)` | `{}` | Custom annotations on the Kubernetes Service. `{{UIMeta group=3 order=14}}` |
| `service_labels` | `map(string)` | `{}` | Custom labels on the Kubernetes Service. `{{UIMeta group=3 order=15}}` |
| `cpu_limit` | `string` | `"4000m"` | CPU limit (used when `container_resources` is not set). RAGFlow document parsing is CPU-intensive. `{{UIMeta group=3 order=20}}` |
| `memory_limit` | `string` | `"8Gi"` | Memory limit (used when `container_resources` is not set). Embedding models require significant RAM. `{{UIMeta group=3 order=21}}` |
| `ingress_settings` | `string` | `"all"` | Ingress traffic setting. Options: `all`, `internal`, `internal-and-cloud-load-balancing`. `{{UIMeta group=3 order=17}}` |

---

## §5 · GKE Backend Configuration (Group 5)

| Variable | Type | Default | Description |
|---|---|---|---|
| `gke_cluster_name` | `string` | `""` | GKE cluster name. Auto-discovered when empty. `{{UIMeta group=5 order=1}}` |
| `gke_cluster_selection_mode` | `string` | `"primary"` | Cluster selection strategy. Options: `explicit`, `round-robin`, `primary`. `{{UIMeta group=5 order=2}}` |
| `namespace_name` | `string` | `""` | Kubernetes namespace. Auto-generated from application name when empty. `{{UIMeta group=5 order=3}}` |
| `workload_type` | `string` | `"Deployment"` | Kubernetes workload type. Options: `Deployment`, `StatefulSet`. `{{UIMeta group=5 order=4}}` |
| `service_type` | `string` | `"LoadBalancer"` | Kubernetes Service type. `"LoadBalancer"` is required for external access. Options: `ClusterIP`, `LoadBalancer`, `NodePort`. `{{UIMeta group=5 order=5}}` |
| `session_affinity` | `string` | `"ClientIP"` | `"ClientIP"` ensures upload sessions and multi-step document processing reach the same pod. `{{UIMeta group=5 order=6}}` |
| `enable_multi_cluster_service` | `bool` | `false` | Enable Multi-Cluster Services (MCS). `{{UIMeta group=5 order=7}}` |
| `configure_service_mesh` | `bool` | `false` | Enable Istio service mesh. `{{UIMeta group=5 order=8}}` |
| `enable_network_segmentation` | `bool` | `false` | Apply Kubernetes NetworkPolicies. `{{UIMeta group=5 order=9}}` |
| `termination_grace_period_seconds` | `number` | `60` | Seconds to wait after SIGTERM. Increase for in-flight document processing. Valid range: 0–3600. `{{UIMeta group=5 order=10}}` |
| `deployment_timeout` | `number` | `1800` | Seconds Terraform waits for Deployment rollout. RAGFlow startup includes model loading. `{{UIMeta group=5 order=11}}` |

---

## §6 · RAGFlow-Specific Variables

### §6.A · Database (Group 15)

| Variable | Type | Default | Description |
|---|---|---|---|
| `db_name` | `string` | `"rag_flow"` | MySQL database name. Do not change after deployment. `{{UIMeta group=15 order=20}}` |
| `db_user` | `string` | `"ragflow"` | MySQL database username. `{{UIMeta group=15 order=21}}` |
| `database_type` | `string` | `"MYSQL_8_0"` | RAGFlow requires MySQL 8.0. `{{UIMeta group=15 order=1}}` |
| `application_database_name` | `string` | `"gkeappdb"` | Foundation-level database name variable (used for interface compatibility). Set `db_name` instead. `{{UIMeta group=15 order=4}}` |
| `application_database_user` | `string` | `"gkeappuser"` | Foundation-level database user variable (used for interface compatibility). Set `db_user` instead. `{{UIMeta group=15 order=5}}` |
| `database_password_length` | `number` | `32` | Length of the auto-generated database password. Valid range: 16–64. `{{UIMeta group=15 order=6}}` |
| `enable_postgres_extensions` | `bool` | `false` | Not applicable for RAGFlow. `{{UIMeta group=15 order=7}}` |
| `postgres_extensions` | `list(string)` | `[]` | Not applicable for RAGFlow. `{{UIMeta group=15 order=8}}` |
| `enable_mysql_plugins` | `bool` | `false` | MySQL plugins flag. `{{UIMeta group=15 order=9}}` |
| `mysql_plugins` | `list(string)` | `[]` | MySQL plugins list. `{{UIMeta group=15 order=10}}` |
| `enable_auto_password_rotation` | `bool` | `false` | Automatic database password rotation. `{{UIMeta group=15 order=11}}` |
| `rotation_propagation_delay_sec` | `number` | `90` | Seconds to wait after rotation before restarting pods. `{{UIMeta group=15 order=12}}` |

### §6.B · Elasticsearch & Redis (Group 14)

| Variable | Type | Default | Description |
|---|---|---|---|
| `elasticsearch_hosts` | `string` | `""` | **Required.** Elasticsearch HTTP endpoint for RAGFlow document indexing and vector search. Set to the `elasticsearch_endpoint` output from `Elasticsearch_GKE` (e.g. `"http://10.0.0.5:9200"`). Terraform validation rejects empty values. `{{UIMeta group=14 order=5}}` |
| `elasticsearch_username` | `string` | `""` | Username for Elasticsearch authentication. Leave empty when `xpack.security.enabled = false`. `{{UIMeta group=14 order=6}}` |
| `enable_redis` | `bool` | `true` | Enable Redis as the RAGFlow task queue backend. Required for document processing workers. `{{UIMeta group=14 order=1}}` |
| `redis_host` | `string` | `""` | Hostname or IP of the Redis server. Auto-discovered from the NFS VM when `enable_nfs = true`. Set explicitly for Memorystore. `{{UIMeta group=14 order=2}}` |
| `redis_port` | `string` | `"6379"` | TCP port of the Redis server. `{{UIMeta group=14 order=3}}` |
| `redis_auth` | `string` | `""` | Redis authentication password. Sensitive. `{{UIMeta group=14 order=4}}` |

---

## §7 · Environment Variables & Secrets (Group 4)

| Variable | Type | Default | Description |
|---|---|---|---|
| `environment_variables` | `map(string)` | `{}` | Additional plain-text env vars injected into the RAGFlow container. Do not set `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `ELASTICSEARCH_HOSTS`, `ELASTICSEARCH_USERNAME`, `REDIS_HOST`, or `REDIS_PORT` — these are injected automatically. `{{UIMeta group=4 order=1}}` |
| `secret_environment_variables` | `map(string)` | `{}` | Secret Manager references injected as environment variables. `{{UIMeta group=4 order=2}}` |
| `secret_rotation_period` | `string` | `"2592000s"` | Rotation notification period (30 days). Must be a duration in seconds followed by `s`. `{{UIMeta group=4 order=3}}` |
| `secret_propagation_delay` | `number` | `30` | Seconds to wait after secret creation before proceeding. `{{UIMeta group=4 order=4}}` |

### Automatically Injected Environment Variables

The following variables are always injected by `RAGFlow_GKE` and must not be set in `environment_variables`:

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

## §8 · Access & Networking (Groups 18–21)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_iap` | `bool` | `false` | Enable Identity-Aware Proxy. `{{UIMeta group=19 order=1}}` |
| `iap_authorized_users` | `list(string)` | `[]` | IAP user allowlist. `{{UIMeta group=19 order=2}}` |
| `iap_authorized_groups` | `list(string)` | `[]` | IAP group allowlist. `{{UIMeta group=19 order=3}}` |
| `iap_oauth_client_id` | `string` | `""` | OAuth 2.0 client ID for IAP. Sensitive. `{{UIMeta group=19 order=4}}` |
| `iap_oauth_client_secret` | `string` | `""` | OAuth 2.0 client secret for IAP. Sensitive. `{{UIMeta group=19 order=5}}` |
| `iap_support_email` | `string` | `""` | Support email on the OAuth consent screen. `{{UIMeta group=19 order=6}}` |
| `enable_custom_domain` | `bool` | `false` | Provision a Kubernetes Ingress for custom domain routing. `{{UIMeta group=18 order=1}}` |
| `application_domains` | `list(string)` | `[]` | Custom domain names for the Ingress. `{{UIMeta group=18 order=2}}` |
| `reserve_static_ip` | `bool` | `true` | Reserve a global static external IP. `{{UIMeta group=18 order=3}}` |
| `static_ip_name` | `string` | `""` | Name for the static IP. Auto-generated when empty. `{{UIMeta group=18 order=4}}` |
| `network_tags` | `list(string)` | `["nfsserver"]` | GCP network tags applied to GKE pods. `{{UIMeta group=18 order=5}}` |
| `network_name` | `string` | `""` | VPC network name. Auto-discovered when empty. `{{UIMeta group=18 order=6}}` |
| `enable_cloud_armor` | `bool` | `false` | Attach Cloud Armor WAF policy. `{{UIMeta group=20 order=1}}` |
| `admin_ip_ranges` | `list(string)` | `[]` | Admin CIDR ranges for privileged access. `{{UIMeta group=20 order=2}}` |
| `cloud_armor_policy_name` | `string` | `"default-waf-policy"` | Cloud Armor security policy name. `{{UIMeta group=20 order=3}}` |
| `enable_cdn` | `bool` | `false` | Enable Cloud CDN. `{{UIMeta group=20 order=4}}` |
| `enable_vpc_sc` | `bool` | `false` | Enable VPC Service Controls perimeter. `{{UIMeta group=21 order=1}}` |
| `vpc_cidr_ranges` | `list(string)` | `[]` | VPC subnet CIDRs for VPC-SC. `{{UIMeta group=21 order=2}}` |
| `vpc_sc_dry_run` | `bool` | `true` | Log VPC-SC violations without blocking. `{{UIMeta group=21 order=3}}` |
| `organization_id` | `string` | `""` | GCP Organization ID for VPC-SC policy. `{{UIMeta group=21 order=4}}` |
| `enable_audit_logging` | `bool` | `false` | Enable detailed Cloud Audit Logs. `{{UIMeta group=21 order=5}}` |

---

## §9 · Storage & Filesystem (Groups 12 & 13)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_nfs` | `bool` | `true` | Provision and mount Cloud Filestore NFS. Required when `redis_host` is empty — the NFS server IP is used as the Redis host. `{{UIMeta group=12 order=1}}` |
| `nfs_mount_path` | `string` | `"/mnt/nfs"` | NFS volume mount path inside the container. `{{UIMeta group=12 order=2}}` |
| `nfs_instance_name` | `string` | `""` | Name of an existing NFS GCE VM. Auto-discovered when empty. `{{UIMeta group=12 order=3}}` |
| `nfs_instance_base_name` | `string` | `"app-nfs"` | Base name for the inline NFS GCE VM. `{{UIMeta group=12 order=4}}` |
| `create_cloud_storage` | `bool` | `true` | Provision GCS buckets. The `ragflow-documents` bucket is always created by `RAGFlow_Common`. `{{UIMeta group=13 order=1}}` |
| `storage_buckets` | `list(object)` | `[{ name_suffix="data" }]` | Additional GCS bucket configurations. `{{UIMeta group=13 order=2}}` |
| `gcs_volumes` | `list(object)` | `[]` | GCS Fuse volumes mounted into the RAGFlow container. `{{UIMeta group=13 order=3}}` |
| `manage_storage_kms_iam` | `bool` | `false` | Create CMEK KMS keyring for storage encryption. `{{UIMeta group=13 order=4}}` |
| `enable_artifact_registry_cmek` | `bool` | `false` | Enable CMEK for Artifact Registry. `{{UIMeta group=13 order=5}}` |

---

## §10 · Backup & Maintenance (Group 16)

| Variable | Type | Default | Description |
|---|---|---|---|
| `backup_schedule` | `string` | `"0 2 * * *"` | Backup cron schedule (UTC). `{{UIMeta group=16 order=1}}` |
| `backup_retention_days` | `number` | `7` | Days to retain backup files. `{{UIMeta group=16 order=2}}` |
| `enable_backup_import` | `bool` | `false` | Trigger a one-time database import job during deployment. `{{UIMeta group=16 order=3}}` |
| `backup_source` | `string` | `"gcs"` | Backup import source. Options: `gcs`, `gdrive`. `{{UIMeta group=16 order=4}}` |
| `backup_uri` | `string` | `""` | Backup file URI for import. `{{UIMeta group=6 order=7}}` |
| `backup_format` | `string` | `"sql"` | Backup file format. Options: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. `{{UIMeta group=16 order=6}}` |

---

## §11 · CI/CD Integration (Group 11)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | `bool` | `false` | Create a Cloud Build trigger on GitHub pushes. `{{UIMeta group=11 order=1}}` |
| `github_repository_url` | `string` | `""` | Full HTTPS URL of the GitHub repository. `{{UIMeta group=11 order=2}}` |
| `github_token` | `string` | `""` | GitHub Personal Access Token. Sensitive. `{{UIMeta group=11 order=3}}` |
| `github_app_installation_id` | `string` | `""` | Cloud Build GitHub App installation ID. `{{UIMeta group=11 order=4}}` |
| `cicd_trigger_config` | `object` | `{ branch_pattern="^main$" }` | Branch filter, trigger name, and build substitutions. `{{UIMeta group=11 order=5}}` |
| `enable_cloud_deploy` | `bool` | `false` | Switch to a Cloud Deploy pipeline. `{{UIMeta group=11 order=6}}` |
| `cloud_deploy_stages` | `list(object)` | `[dev, staging, prod(approval)]` | Ordered promotion stages. `{{UIMeta group=11 order=7}}` |
| `enable_binary_authorization` | `bool` | `false` | Enforce Binary Authorization policy. `{{UIMeta group=11 order=8}}` |

---

## §12 · Custom Initialization & Jobs (Group 10 & 17)

| Variable | Type | Default | Description |
|---|---|---|---|
| `initialization_jobs` | `list(object)` | `[]` | Kubernetes Jobs executed before the application starts. When empty, the auto-generated MySQL `db-init` job from `RAGFlow_Common` runs. Each job must have at least one of `command`, `args`, or `script_path`. `{{UIMeta group=10 order=1}}` |
| `cron_jobs` | `list(object)` | `[]` | Recurring Kubernetes CronJobs. `{{UIMeta group=10 order=2}}` |
| `additional_services` | `list(object)` | `[]` | Additional containers deployed as separate Kubernetes Deployments. `{{UIMeta group=10 order=3}}` |
| `enable_custom_sql_scripts` | `bool` | `false` | Run custom SQL scripts from a GCS bucket after provisioning. `{{UIMeta group=17 order=1}}` |
| `custom_sql_scripts_bucket` | `string` | `""` | GCS bucket containing SQL scripts. `{{UIMeta group=17 order=2}}` |
| `custom_sql_scripts_path` | `string` | `""` | Path prefix within the bucket. `{{UIMeta group=17 order=3}}` |
| `custom_sql_scripts_use_root` | `bool` | `false` | Execute custom SQL as root database user. `{{UIMeta group=17 order=4}}` |

---

## §13 · Reliability Policies (Group 8)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_pod_disruption_budget` | `bool` | `true` | Create a Kubernetes PodDisruptionBudget. `{{UIMeta group=8 order=1}}` |
| `pdb_min_available` | `string` | `"1"` | Minimum pods available during voluntary disruptions. Integer or percentage string. `{{UIMeta group=8 order=2}}` |
| `enable_topology_spread` | `bool` | `false` | Add TopologySpreadConstraints. `{{UIMeta group=8 order=3}}` |
| `topology_spread_strict` | `bool` | `false` | `DoNotSchedule` (strict) vs `ScheduleAnyway`. `{{UIMeta group=8 order=4}}` |

---

## §14 · Resource Quota (Group 7)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_resource_quota` | `bool` | `false` | Create a Kubernetes ResourceQuota. `{{UIMeta group=7 order=1}}` |
| `quota_cpu_requests` | `string` | `""` | Total CPU requests allowed in the namespace. `{{UIMeta group=7 order=2}}` |
| `quota_cpu_limits` | `string` | `""` | Total CPU limits allowed. `{{UIMeta group=7 order=3}}` |
| `quota_memory_requests` | `string` | `""` | Total memory requests allowed. `{{UIMeta group=7 order=4}}` |
| `quota_memory_limits` | `string` | `""` | Total memory limits allowed. `{{UIMeta group=7 order=5}}` |

---

## §15 · StatefulSet Settings (Group 6)

These settings apply only when `workload_type = "StatefulSet"`.

| Variable | Type | Default | Description |
|---|---|---|---|
| `stateful_pvc_enabled` | `bool` | `false` | Provision a PVC for local storage. `{{UIMeta group=6 order=1}}` |
| `stateful_pvc_size` | `string` | `"10Gi"` | PVC size. `{{UIMeta group=6 order=2}}` |
| `stateful_pvc_mount_path` | `string` | `"/data"` | Container mount path for the PVC. `{{UIMeta group=6 order=3}}` |
| `stateful_pvc_storage_class` | `string` | `"standard-rwo"` | Kubernetes StorageClass for the PVC. `{{UIMeta group=6 order=4}}` |
| `stateful_headless_service` | `bool` | `true` | Create a headless service for stable pod DNS. `{{UIMeta group=6 order=5}}` |
| `stateful_pod_management_policy` | `string` | `"OrderedReady"` | `"OrderedReady"` or `"Parallel"`. `{{UIMeta group=6 order=6}}` |
| `stateful_update_strategy` | `string` | `"RollingUpdate"` | `"RollingUpdate"` or `"OnDelete"`. `{{UIMeta group=6 order=7}}` |

---

## §16 · Observability & Health (Group 9)

| Variable | Type | Default | Description |
|---|---|---|---|
| `startup_probe_config` | `object` | `{ enabled=true, path="/v1/health", initial_delay_seconds=60, period_seconds=10, failure_threshold=18 }` | App_GKE-standard startup probe. `{{UIMeta group=9 order=1}}` |
| `health_check_config` | `object` | `{ enabled=true, path="/v1/health", initial_delay_seconds=120, period_seconds=30 }` | App_GKE-standard liveness probe. `{{UIMeta group=9 order=2}}` |
| `uptime_check_config` | `object` | `{ enabled=false, path="/v1/health", check_interval="60s", timeout="10s" }` | Cloud Monitoring uptime check. `{{UIMeta group=9 order=3}}` |
| `alert_policies` | `list(object)` | `[]` | Cloud Monitoring alert policies. `{{UIMeta group=9 order=4}}` |
| `startup_probe` | `object` | `{ enabled=true, type="HTTP", path="/v1/health", initial_delay_seconds=60, timeout_seconds=10, period_seconds=10, failure_threshold=18 }` | Container startup probe forwarded to `RAGFlow_Common`. `{{UIMeta group=9 order=5}}` |
| `liveness_probe` | `object` | `{ enabled=true, type="HTTP", path="/v1/health", initial_delay_seconds=120, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` | Container liveness probe forwarded to `RAGFlow_Common`. `{{UIMeta group=9 order=6}}` |

---

## §17 · Validation Guards

`validation.tf` enforces the following preconditions at plan time:

| Guard | Error Message |
|---|---|
| `min_instance_count <= max_instance_count` | Minimum cannot exceed maximum. |
| `elasticsearch_hosts != ""` | `elasticsearch_hosts` must be set — deploy `Elasticsearch_GKE` first and use its `elasticsearch_endpoint` output. |
| `enable_redis = true` requires `redis_host != ""` OR `enable_nfs = true` | Without a Redis host source, the task queue will fail to connect. |
| `enable_iap = true` requires both OAuth credentials | IAP on GKE requires `iap_oauth_client_id` and `iap_oauth_client_secret`. |
| `enable_cloudsql_volume = true` requires `database_type != "NONE"` | The Auth Proxy sidecar should not be enabled without a database. |

---

## §18 · Outputs

| Output | Description |
|---|---|
| `service_name` | Kubernetes service name. |
| `service_url` | Service URL (LoadBalancer or ClusterIP). |
| `service_external_ip` | External LoadBalancer IP. |
| `project_id` | GCP project ID. |
| `deployment_id` | Unique deployment identifier. |
| `namespace` | Kubernetes namespace. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database username. |
| `database_password_secret` | Secret Manager secret name for the database password. |
| `storage_buckets` | All provisioned GCS buckets. |
| `nfs_server_ip` | NFS server internal IP (sensitive). |
| `nfs_mount_path` | NFS mount path in containers. |
| `container_image` | Container image URI. |
| `cicd_enabled` | Whether CI/CD pipeline is enabled. |
| `github_repository_url` | Connected GitHub repository URL. |
| `kubernetes_ready` | `true` when the GKE cluster endpoint is available and all workload resources have been deployed. `false` on first apply of a new cluster — the CI/CD pipeline must re-run apply to complete deployment. |

---

## §19 · Configuration Examples

### Basic Deployment

```hcl
# config/basic.tfvars
resource_creator_identity = ""
project_id                = "my-gcp-project-id"
tenant_deployment_id      = "basic"

application_version = "v0.13.0"

# Required — from: tofu output elasticsearch_endpoint (Elasticsearch_GKE)
elasticsearch_hosts = "http://ELASTICSEARCH_EXTERNAL_IP:9200"

db_name = "rag_flow"
db_user = "ragflow"

enable_redis = true
redis_host   = "REDIS_IP_FROM_SERVICES_GCP"
redis_port   = "6379"

cpu_limit    = "4000m"
memory_limit = "8Gi"
```

### Advanced Deployment

```hcl
# config/advanced.tfvars
resource_creator_identity = ""
project_id                = "my-gcp-project-id"
tenant_deployment_id      = "prod"

application_version      = "v0.13.0"
application_display_name = "RAGFlow Enterprise Search"

# Elasticsearch — required
elasticsearch_hosts    = "http://10.0.0.5:9200"
elasticsearch_username = ""

# Database
db_name = "rag_flow"
db_user = "ragflow"

# Redis for document processing queue
enable_redis = true
redis_host   = "10.0.0.6"
redis_port   = "6379"

# Resources
cpu_limit    = "8000m"
memory_limit = "16Gi"
max_instance_count = 5

# Reliability
enable_pod_disruption_budget = true
pdb_min_available            = "1"

# Networking
service_type      = "LoadBalancer"
session_affinity  = "ClientIP"
reserve_static_ip = true

# Observability
uptime_check_config = {
  enabled        = true
  path           = "/v1/health"
  check_interval = "60s"
  timeout        = "10s"
}

support_users = ["ops@example.com"]
resource_labels = {
  env     = "production"
  service = "ragflow"
}
```
