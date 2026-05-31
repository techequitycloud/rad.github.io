# Grafana on Google Cloud Run

This document provides a comprehensive reference for the `modules/Grafana_CloudRun` Terraform module. It covers architecture, IAM, configuration variables, Grafana-specific behaviours, and operational patterns for deploying Grafana on Google Cloud Run (v2).

---

## 1. Module Overview

Grafana is the world's leading open-source observability and analytics platform, used by 10M+ users at organizations such as NASA, CERN, and Goldman Sachs. It provides unified dashboards, alerting, and visualization for metrics, logs, and traces from over 100 data sources including Prometheus, BigQuery, Cloud SQL, Elasticsearch, and more.

`Grafana_CloudRun` is a **wrapper module** built on top of `App_CloudRun`. It uses `App_CloudRun` for all GCP infrastructure provisioning and injects Grafana-specific application configuration, probe tuning, and storage configuration via `Grafana_Common`.

**Key Capabilities:**
- **Compute**: Cloud Run v2 (Gen2), 1 vCPU / 2 Gi by default, configurable scaling with `min_instance_count` and `max_instance_count`.
- **Data Persistence**: Cloud SQL **PostgreSQL 15** as the Grafana application database. SQLite is not safe for multi-instance Cloud Run deployments — the module automatically injects `GF_DATABASE_TYPE=postgres`.
- **Storage**: A `grafana-data` GCS bucket is automatically provisioned by `Grafana_Common`. GCS Fuse volumes and optional NFS mounts are supported for sharing dashboards and plugins across instances.
- **Security**: Inherits Cloud Armor WAF, IAP, Binary Authorization, and VPC Service Controls from `App_CloudRun`.
- **Caching**: Optional Redis support (`enable_redis = false` by default) for Grafana session storage or caching.
- **CI/CD**: Cloud Build custom image pipeline by default; Cloud Deploy progressive delivery optional.
- **Reliability**: Health probes target `/api/health` — Grafana's dedicated health endpoint.

**Wrapper architecture:** `Grafana_CloudRun` calls `Grafana_Common` to build an `application_config` object containing Grafana-specific environment variables and probe configuration. `grafana.tf` hardcodes `GF_DATABASE_TYPE = "postgres"` into the merged environment so that Grafana uses the provisioned Cloud SQL PostgreSQL instance rather than falling back to SQLite. `module_storage_buckets` carries the `grafana-data` bucket provisioned by `Grafana_Common`. `scripts_dir` is resolved to `Grafana_Common/scripts` at apply time.

---

## 2. IAM & Access Control

`Grafana_CloudRun` delegates all IAM provisioning to `App_CloudRun`. The Cloud Run SA, Cloud Build SA, IAP service agent, and password rotation role sets are identical to those in App_CloudRun.

**Database initialisation:** Unlike Ghost or Metabase, Grafana does not ship a `db-init` Cloud Run Job by default. Grafana auto-migrates its database schema on startup when it connects to a PostgreSQL instance. The provisioned PostgreSQL database and user are passed to the Grafana container via `DB_HOST`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` environment variables injected by `App_CloudRun`.

**`GF_DATABASE_TYPE` injection:** `grafana.tf` merges `{ GF_DATABASE_TYPE = "postgres" }` into the `environment_variables` map. This is a required override — without it, Grafana defaults to SQLite regardless of the other `GF_DATABASE_*` variables present.

For the complete role tables and IAP, password rotation, and public access details, see the App_CloudRun documentation.

---

## 3. Core Service Configuration

### A. Compute (Cloud Run)

Grafana is a Go application with moderate resource requirements. The default 1 vCPU / 2 Gi configuration is sufficient for most dashboard and alerting workloads. Production deployments serving many concurrent users should increase both limits.

**Scale configuration:** `min_instance_count` defaults to `1` (no scale-to-zero). Cold starts are relatively fast for Grafana (5–15 seconds), but keeping a warm instance eliminates latency for monitoring dashboards. `max_instance_count` defaults to `5`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment (SQL, storage, secrets). |
| `container_image_source` | 4 | `'custom'` | `'custom'` builds via Cloud Build; `'prebuilt'` deploys an existing image URI. |
| `container_image` | 4 | `""` | Override image URI. Leave empty for Cloud Build to manage. |
| `cpu_limit` | 4 | `'1000m'` | CPU per instance. Increase for large dashboard query loads. |
| `memory_limit` | 4 | `'2Gi'` | Memory per instance. |
| `min_instance_count` | 4 | `1` | Minimum running instances. Set `0` for scale-to-zero. |
| `max_instance_count` | 4 | `5` | Maximum running instances. |
| `container_port` | 4 | `3000` | Grafana's default HTTP port. |
| `execution_environment` | 4 | `'gen2'` | Gen2 required for NFS mounts and GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Max request duration. |
| `enable_cloudsql_volume` | 4 | `true` | Injects the Cloud SQL Auth Proxy sidecar. |
| `container_protocol` | 4 | `'http1'` | HTTP protocol version. |
| `enable_image_mirroring` | 4 | `true` | Mirrors the Grafana image into Artifact Registry. |
| `traffic_split` | 4 | `[]` | Canary/blue-green traffic allocation. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |

### B. Database (Cloud SQL — PostgreSQL 15)

Grafana requires a relational database for persisting dashboards, users, organisations, alerts, and plugin state. The module uses **PostgreSQL 15** by default.

**SQLite is not safe for multi-instance deployments.** SQLite uses file locking, which fails when multiple Cloud Run instances attempt concurrent writes. The module hardcodes `GF_DATABASE_TYPE = "postgres"` in `grafana.tf` to ensure PostgreSQL is used regardless of other settings.

**Unix socket connection:** `enable_cloudsql_volume` defaults to `true`. `App_CloudRun` injects the Auth Proxy sidecar and sets `DB_HOST` to the socket path under `/cloudsql`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `database_type` | 12 | `'POSTGRES_15'` | Cloud SQL engine. Must be a PostgreSQL variant for Grafana. |
| `db_name` | 12 | `'grafana'` | PostgreSQL database name. Do not change after initial deployment. |
| `db_user` | 12 | `'grafana'` | PostgreSQL application user. Password auto-generated and stored in Secret Manager. |
| `database_password_length` | 12 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after rotation before restarting the service. |

### C. Storage (NFS & GCS)

**NFS is disabled by default** (`enable_nfs = false`). Enable it when multiple Cloud Run instances need to share Grafana plugins or custom dashboards stored on a shared filesystem. Requires `execution_environment = 'gen2'`.

**GCS data bucket:** `Grafana_Common` automatically provisions a `grafana-data` GCS bucket. GCS Fuse volumes can be mounted into the container for direct filesystem access to GCS objects.

| Variable | Group | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | 11 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Additional GCS buckets to provision. |
| `enable_nfs` | 11 | `false` | Provisions NFS shared storage. Requires `gen2`. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Container path where NFS is mounted. |
| `gcs_volumes` | 11 | `[]` | GCS buckets to mount via GCS Fuse (requires `gen2`). |
| `manage_storage_kms_iam` | 11 | `false` | Creates a CMEK KMS keyring and enables CMEK on storage buckets. |
| `enable_artifact_registry_cmek` | 11 | `false` | Enables at-rest CMEK encryption for container images in Artifact Registry. |

### D. Networking

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — public internet; `'internal'` — VPC only; `'internal-and-cloud-load-balancing'` — forces traffic through the HTTPS Load Balancer. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` routes only RFC 1918 traffic via VPC. `'ALL_TRAFFIC'` routes all egress via VPC. |

### E. Initialization & Bootstrap

Unlike Metabase or Ghost, Grafana does not require a `db-init` job. Grafana auto-creates and migrates its database schema on first startup. If a pre-existing Grafana database needs to be imported, use `enable_backup_import`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | One-shot Cloud Run Jobs run during deployment. Grafana does not require a default job — leave empty unless custom initialization is needed. |
| `cron_jobs` | 13 | `[]` | Recurring scheduled Cloud Run Jobs triggered by Cloud Scheduler. |

---

## 4. Advanced Security

### A. Cloud Armor WAF

When `enable_cloud_armor = true`, a Global HTTPS Load Balancer with a Cloud Armor WAF policy is provisioned in front of Cloud Run.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. Required for custom domains, CDN, and DDoS protection. |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules. |

### B. Identity-Aware Proxy (IAP)

When `enable_iap = true`, Cloud Run's native IAP integration is enabled. Google identity authentication is required before requests reach Grafana. This is recommended for internal monitoring dashboards.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Enables IAP natively on the Cloud Run service. |
| `iap_authorized_users` | 5 | `[]` | Users granted IAP access. Format: `'user:email'`. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted IAP access. Format: `'group:name@example.com'`. |

### C. Binary Authorization

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Enforces image attestation. Requires a Binary Authorization policy pre-configured in the project. |

### D. VPC Service Controls

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Registers module API calls within the project's VPC-SC perimeter. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC network access level. |
| `vpc_sc_dry_run` | 22 | `true` | Logs VPC-SC violations without blocking. Set `false` to enforce. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. Required — auto-discovery is disabled to prevent unintended perimeter activation. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs. |

### E. Secret Manager Integration

| Variable | Group | Default | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Secret Manager references injected as env vars. (e.g., `{ GF_SECURITY_ADMIN_PASSWORD = "grafana-admin-password" }`) |
| `secret_rotation_period` | 6 | `'2592000s'` | Secret rotation notification frequency. Default: 30 days. |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation before dependent resources proceed. |

---

## 5. Traffic & Ingress

### A. HTTPS Load Balancer

When `enable_cloud_armor = true`, a Global HTTPS Load Balancer backed by a Serverless NEG is provisioned. Traffic flows: Internet → Cloud Armor → Global HTTPS LB → Serverless NEG → Cloud Run.

### B. Cloud CDN

When `enable_cdn = true` (requires `enable_cloud_armor = true`), Cloud CDN is attached to the HTTPS Load Balancer backend.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cdn` | 10 | `false` | Enables Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` | 10 | `7` | Maximum recent container images to keep in Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Automatically deletes untagged images from Artifact Registry. |
| `image_retention_days` | 10 | `30` | Days after which images are eligible for deletion. |

### C. Custom Domains

| Variable | Group | Default | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Custom domain names for the HTTPS LB. Google-managed SSL certificates provisioned per domain. |

---

## 6. CI/CD & Delivery

### A. Cloud Build Triggers

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. Requires `github_repository_url` and credentials. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT. Required on first apply. Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID (preferred for org repos). |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced trigger config: `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### B. Cloud Deploy Pipeline

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy pipeline. Requires `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Ordered promotion stages. |

---

## 7. Reliability & Scheduling

### A. Health Probes & Uptime Monitoring

Grafana exposes a dedicated `/api/health` endpoint that returns HTTP 200 when the application and database connection are healthy. Both probes target this endpoint.

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ path="/api/health", initial_delay_seconds=30, failure_threshold=12 }` | Startup probe. Allows 30 seconds initial delay plus 12 × 10s = total 150 seconds startup tolerance. |
| `liveness_probe` | 14 | `{ path="/api/health", initial_delay_seconds=60, failure_threshold=3 }` | Liveness probe. Restarts the container after 3 consecutive failures. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/api/health" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |

### B. Backup

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated daily backups. |
| `backup_retention_days` | 7 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 7 | `false` | Triggers a one-time database restore on apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (full URI) or `'gdrive'` (file ID). |
| `backup_uri` | 7 | `""` | Full GCS URI (e.g., `'gs://my-bucket/grafana-2024-01.sql'`) or Google Drive file ID. |
| `backup_format` | 7 | `'sql'` | Backup format. Options: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

### C. Auto Password Rotation

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Enables automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after writing the new secret before restarting the service. |
| `secret_rotation_period` | 6 | `'2592000s'` | Rotation frequency. Default: 30 days. |

---

## 8. Integrations

### A. Redis

Redis support is available but **disabled by default** (`enable_redis = false`). When enabled, Redis can be used for Grafana session storage. For production, point `redis_host` at a dedicated Google Cloud Memorystore for Redis instance.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 21 | `false` | Enables Redis configuration. |
| `redis_host` | 21 | `""` | Redis hostname or IP. Leave blank to use the NFS server IP when `enable_redis = true`. |
| `redis_port` | 21 | `'6379'` | Redis TCP port (string). |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive. |

### B. Data Sources

Grafana supports 100+ data sources. Configure them through the Grafana UI after deployment. Common GCP-native sources:
- **Cloud Monitoring** — uses the Cloud Run service account's Workload Identity for authentication.
- **BigQuery** — requires the Cloud Run SA to have `roles/bigquery.dataViewer`.
- **Cloud SQL** — configure via the PostgreSQL or MySQL data source plugin pointing at the provisioned Cloud SQL instance.
- **Prometheus** — connect to any Prometheus endpoint reachable from the VPC.

### C. Environment Variables

Use `environment_variables` for non-sensitive Grafana configuration using GF_* environment variable names:

```hcl
environment_variables = {
  GF_SERVER_ROOT_URL         = "https://grafana.example.com"
  GF_SMTP_ENABLED            = "true"
  GF_SMTP_HOST               = "smtp.sendgrid.net:587"
  GF_AUTH_ANONYMOUS_ENABLED  = "false"
  GF_SECURITY_ALLOW_EMBEDDING = "true"
}
```

> **Note:** `GF_DATABASE_TYPE = "postgres"` is injected automatically — do not set it manually.

### D. Backup Import & Recovery

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_custom_sql_scripts` | 9 | `false` | Runs SQL scripts from GCS after provisioning. |
| `custom_sql_scripts_bucket` | 9 | `""` | GCS bucket containing SQL scripts. |
| `custom_sql_scripts_path` | 9 | `""` | Path prefix within the bucket. |
| `custom_sql_scripts_use_root` | 9 | `false` | Run scripts as the root DB user. |

---

## 9. Platform-Managed Behaviours

| Behaviour | Implementation | Detail |
|---|---|---|
| **PostgreSQL 15 required** | `database_type = "POSTGRES_15"` fixed by `Grafana_Common` | SQLite is not safe for multi-instance deployments. |
| **PostgreSQL client forced** | `GF_DATABASE_TYPE = "postgres"` injected in `grafana.tf` | Without this, Grafana falls back to SQLite even when all other `GF_DATABASE_*` variables are set. |
| **GCS data bucket** | `grafana-data` bucket provisioned by `Grafana_Common` via `module_storage_buckets` | A dedicated GCS bucket for Grafana data is provisioned automatically. |
| **Unix socket by default** | `enable_cloudsql_volume = true` default | Grafana connects to Cloud SQL via the Auth Proxy Unix socket. |
| **Custom image by default** | `container_image_source = 'custom'` | Cloud Build compiles a custom image using `Grafana_Common`'s Dockerfile extending the official `grafana/grafana` image. |
| **No default db-init job** | `initialization_jobs = []` | Grafana auto-migrates its schema on startup. No explicit database initialization job is needed. |
| **Health endpoint** | `/api/health` | Grafana exposes a dedicated health endpoint. Both startup and liveness probes target this path. |
| **Scripts directory** | `scripts_dir = abspath("${path.module}/../Grafana_Common/scripts")` | Initialization scripts are sourced from `Grafana_Common`. |

---

## 10. Variable Reference

All user-configurable variables, sorted by UI group then order. Group 0 variables are reserved for platform metadata.

| Variable | Group | Default | Description |
|---|---|---|---|
| `module_description` | 0 | (Grafana platform text) | Platform metadata: module description. |
| `module_documentation` | 0 | `https://docs.radmodules.dev/docs/modules/Grafana_CloudRun` | Platform metadata: documentation URL. |
| `module_dependency` | 0 | `['Services_GCP']` | Platform metadata: required modules. |
| `module_services` | 0 | (GCP service list) | Platform metadata: GCP services consumed. |
| `credit_cost` | 0 | `50` | Platform metadata: deployment credit cost. |
| `require_credit_purchases` | 0 | `false` | Platform metadata: enforces credit balance check. |
| `enable_purge` | 0 | `true` | Permits full deletion of module resources on destroy. |
| `public_access` | 0 | `true` | Platform catalogue visibility. |
| `deployment_id` | 0 | `""` | Deployment ID suffix. Auto-generated if empty. |
| `resource_creator_identity` | 0 | (platform SA) | Service account used by Terraform to manage resources. |
| `project_id` | 1 | — | GCP project ID. **Required.** |
| `region` | 1 | `'us-central1'` | GCP region for Cloud Run and Cloud SQL. |
| `tenant_deployment_id` | 2 | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `[]` | Email addresses for monitoring alerts. |
| `resource_labels` | 2 | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `'grafana'` | Base resource name. |
| `display_name` | 3 | `'Grafana Dashboards'` | Human-readable name in the GCP Console. |
| `description` | 3 | `'Grafana - Open-source observability and analytics platform'` | Cloud Run service description. |
| `application_version` | 3 | `'11.4.0'` | Grafana image version tag. |
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 4 | `'custom'` | `'custom'` (Cloud Build) or `'prebuilt'` (existing image). |
| `container_image` | 4 | `""` | Container image URI override. |
| `cpu_limit` | 4 | `'1000m'` | CPU per instance. |
| `memory_limit` | 4 | `'2Gi'` | Memory per instance. |
| `min_instance_count` | 4 | `1` | Minimum running instances. |
| `max_instance_count` | 4 | `5` | Maximum running instances. |
| `container_port` | 4 | `3000` | Grafana's native HTTP port. |
| `execution_environment` | 4 | `'gen2'` | Gen2 required for NFS mounts and GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Max request duration. |
| `enable_cloudsql_volume` | 4 | `true` | Injects Cloud SQL Auth Proxy sidecar. |
| `container_protocol` | 4 | `'http1'` | `'http1'` or `'h2c'`. |
| `enable_image_mirroring` | 4 | `true` | Mirrors the Grafana image into Artifact Registry. |
| `traffic_split` | 4 | `[]` | Canary/blue-green traffic allocation. |
| `max_revisions_to_retain` | 4 | `7` | Maximum Cloud Run revisions to keep. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Container path for the Auth Proxy Unix socket. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'`, or `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` or `'ALL_TRAFFIC'`. |
| `enable_iap` | 5 | `false` | Enables IAP natively on the Cloud Run service. |
| `iap_authorized_users` | 5 | `[]` | Users granted IAP access. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted IAP access. |
| `environment_variables` | 6 | `{}` | Plain-text env vars. `GF_DATABASE_TYPE` is injected automatically — do not override. |
| `secret_environment_variables` | 6 | `{}` | Secret Manager references (e.g., `{ GF_SECURITY_ADMIN_PASSWORD = "grafana-admin-password" }`). |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation. |
| `secret_rotation_period` | 6 | `'2592000s'` | Secret Manager rotation notification frequency. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated backups. |
| `backup_retention_days` | 7 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 7 | `false` | Triggers a one-time restore on apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` or `'gdrive'`. |
| `backup_uri` | 7 | `""` | Full GCS URI or Google Drive file ID. |
| `backup_format` | 7 | `'sql'` | Backup format. |
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT. Required on first apply. Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger config. |
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy progressive delivery pipeline. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Ordered Cloud Deploy promotion stages. |
| `enable_binary_authorization` | 8 | `false` | Enforces image attestation on deployment. |
| `binauthz_evaluation_mode` | 8 | `'ALWAYS_ALLOW'` | Binary Authorization evaluation mode. Not referenced in this module. |
| `enable_custom_sql_scripts` | 9 | `false` | Runs SQL scripts from GCS after provisioning. |
| `custom_sql_scripts_bucket` | 9 | `""` | GCS bucket containing SQL scripts. |
| `custom_sql_scripts_path` | 9 | `""` | Path prefix within the bucket. |
| `custom_sql_scripts_use_root` | 9 | `false` | Run scripts as the root DB user. |
| `enable_cloud_armor` | 10 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | 10 | `[]` | Custom domains with Google-managed SSL certificates. |
| `enable_cdn` | 10 | `false` | Enables Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` | 10 | `7` | Maximum recent container images to keep in Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Automatically deletes untagged images from Artifact Registry. |
| `image_retention_days` | 10 | `30` | Days after which images are eligible for deletion. |
| `create_cloud_storage` | 11 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Additional GCS buckets to provision. |
| `enable_nfs` | 11 | `false` | Provisions NFS shared storage. Requires `gen2`. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Container path where NFS is mounted. |
| `gcs_volumes` | 11 | `[]` | GCS buckets to mount via GCS Fuse (requires `gen2`). |
| `manage_storage_kms_iam` | 11 | `false` | Creates CMEK KMS key and enables CMEK on all storage buckets. |
| `enable_artifact_registry_cmek` | 11 | `false` | Creates Artifact Registry KMS key for at-rest image encryption. |
| `database_type` | 12 | `'POSTGRES_15'` | Cloud SQL engine. PostgreSQL required for Grafana. |
| `db_name` | 12 | `'grafana'` | PostgreSQL database name. |
| `db_user` | 12 | `'grafana'` | PostgreSQL application user. |
| `database_password_length` | 12 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after rotation before restarting the service. |
| `initialization_jobs` | 13 | `[]` | One-shot Cloud Run Jobs. Leave empty — Grafana auto-migrates its schema. |
| `cron_jobs` | 13 | `[]` | Recurring scheduled Cloud Run Jobs. |
| `startup_probe` | 14 | `{ path="/api/health", initial_delay_seconds=30, failure_threshold=12 }` | Startup probe. |
| `liveness_probe` | 14 | `{ path="/api/health", initial_delay_seconds=60, failure_threshold=3 }` | Liveness probe. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/api/health" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |
| `enable_redis` | 21 | `false` | Enables Redis for Grafana session storage or caching. |
| `redis_host` | 21 | `""` | Redis hostname/IP. |
| `redis_port` | 21 | `'6379'` | Redis TCP port (string). |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive. |
| `enable_vpc_sc` | 22 | `false` | Enables VPC-SC perimeter enforcement. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC network access level. |
| `vpc_sc_dry_run` | 22 | `true` | Logs VPC-SC violations without blocking. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs. |

---

## 11. Outputs

| Output | Description |
|---|---|
| `service_name` | Name of the Cloud Run service. |
| `service_url` | Public URL of the Cloud Run service. |
| `service_location` | GCP region where the Cloud Run service is deployed. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix used in resource names. |
| `database_instance_name` | Name of the Cloud SQL PostgreSQL instance. |
| `database_name` | Name of the application database. |
| `database_user` | Name of the application database user. |
| `database_password_secret` | Secret Manager secret name for the database password. |
| `storage_buckets` | Created GCS storage buckets. |
| `container_image` | Container image used for the deployment. |
| `cicd_enabled` | Whether the CI/CD pipeline is enabled. |

## Destroying Resources

### Known Deletion Issue: Serverless IPv4 Address Release

When destroying a Cloud Run deployment, you may encounter an error similar to:

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause:** GCP holds serverless IPv4 addresses on the VPC subnet asynchronously after a Cloud Run service is deleted. These addresses are released by GCP approximately **20–30 minutes** after the Cloud Run service is removed.

**Resolution:** Wait 20–30 minutes after the initial destroy attempt, then re-run:

```bash
tofu destroy
```
