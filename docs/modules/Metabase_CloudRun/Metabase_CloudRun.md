---
title: "Metabase on Google Cloud Run"
sidebar_label: "Metabase CloudRun"
---

# Metabase on Google Cloud Run

This document provides a comprehensive reference for the `modules/Metabase_CloudRun` Terraform module. It covers architecture, IAM, configuration variables, Metabase-specific behaviours, and operational patterns for deploying Metabase on Google Cloud Run (v2).

---

## 1. Module Overview

Metabase is an open-source business intelligence and analytics platform with 40,000+ GitHub stars, used by 50,000+ organizations to democratize data access — enabling non-technical users to query and visualize data without writing SQL. It connects to 20+ database types including BigQuery, PostgreSQL, MySQL, and Cloud SQL.

`Metabase CloudRun` is a **wrapper module** built on top of `App CloudRun`. It uses `App CloudRun` for all GCP infrastructure provisioning and injects Metabase-specific application configuration, database initialization, and startup probes via `Metabase Common`.

**Key Capabilities:**
- **Compute**: Cloud Run v2 (Gen2), 2 vCPU / 4 Gi by default to accommodate the Metabase JVM. Scale-to-zero supported (`min_instance_count = 0` default) but cold starts take 60–120 seconds.
- **Data Persistence**: Cloud SQL **PostgreSQL 15** as the Metabase application database (distinct from data sources Metabase queries). A `db-init` Cloud Run Job runs automatically on first deployment.
- **Security**: Inherits Cloud Armor WAF, IAP, Binary Authorization, and VPC Service Controls from `App CloudRun`.
- **CI/CD**: Cloud Build custom image pipeline by default; Cloud Deploy progressive delivery optional.
- **Reliability**: Health probes target `/api/health` with a generous 120-second initial delay to accommodate JVM startup.

**JVM cold start warning:** Metabase runs on the JVM and takes 60–120 seconds to start from cold. For production deployments, set `min_instance_count = 1` to eliminate cold starts.

**Wrapper architecture:** `Metabase CloudRun` calls `Metabase Common` to build an `application_config` object. `metabase.tf` assembles the application configuration. `Metabase Common` automatically provides a default `db-init` PostgreSQL initialization job using `postgres:15-alpine` that runs the `db-init.sh` script before Metabase first boots.

---

## 2. IAM & Access Control

`Metabase CloudRun` delegates all IAM provisioning to `App CloudRun`. The Cloud Run SA, Cloud Build SA, and IAP service agent roles are identical to those in App CloudRun.

**Database initialisation:** A `db-init` Cloud Run Job is automatically provisioned by `Metabase Common` when `initialization_jobs` is left as the default empty list. It uses `postgres:15-alpine` and executes `Metabase_Common/scripts/db-init.sh`, which idempotently creates the Metabase PostgreSQL database and user. Override `initialization_jobs` with a non-empty list to replace this default.

**Fixed environment variables:** `Metabase Common` automatically sets `MB_JETTY_PORT = "3000"` and `JAVA_TIMEZONE = "UTC"` in the container environment. Do not override these in `environment_variables`.

---

## 3. Core Service Configuration

### A. Compute (Cloud Run)

Metabase is a Java/JVM application with substantial resource requirements. The defaults (2 vCPU, 4 Gi) are the minimum recommended for stable operation. Production deployments should consider increasing to 4 vCPU / 8 Gi for large user bases.

**Cold start note:** With `min_instance_count = 0` (the default), Metabase will scale to zero when idle. Cold starts take 60–120 seconds as the JVM initializes and connects to PostgreSQL. Set `min_instance_count = 1` for production to eliminate this latency.

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 4 | `'custom'` | `'custom'` builds via Cloud Build; `'prebuilt'` deploys an existing image URI. |
| `container_image` | 4 | `""` | Override image URI. Leave empty for Cloud Build to manage. |
| `cpu_limit` | 4 | `'2000m'` | CPU per instance. Minimum 1 vCPU; 2 vCPU recommended for production. |
| `memory_limit` | 4 | `'4Gi'` | Memory per instance. Minimum 2 Gi for JVM; 4 Gi recommended for production. |
| `container_port` | 4 | `3000` | Metabase's Jetty HTTP port. Must match `MB_JETTY_PORT`. |
| `min_instance_count` | 4 | `0` | Minimum running instances. Set `1` for production to eliminate cold starts. |
| `max_instance_count` | 4 | `3` | Maximum running instances. |
| `execution_environment` | 4 | `'gen2'` | Gen2 required for improved startup and networking. |
| `timeout_seconds` | 4 | `300` | Max request duration. Increase for long-running BI queries. |
| `enable_cloudsql_volume` | 4 | `true` | Injects the Cloud SQL Auth Proxy sidecar. |
| `container_protocol` | 4 | `'http1'` | HTTP protocol version. |
| `enable_image_mirroring` | 4 | `true` | Mirrors the Metabase image into Artifact Registry. |
| `traffic_split` | 4 | `[]` | Canary/blue-green traffic allocation. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |

### B. Database (Cloud SQL — PostgreSQL 15)

Metabase requires a PostgreSQL or MySQL database to store its own application data: questions, dashboards, users, collections, and settings. This is separate from the data sources that Metabase queries.

**Default `db-init` job:** `Metabase Common` automatically provides a `db-init` job that creates the Metabase database and PostgreSQL user before the Metabase service starts. This job uses `postgres:15-alpine` and runs with `execute_on_apply = true`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `database_type` | 12 | `'POSTGRES_15'` | Cloud SQL engine. PostgreSQL required for Metabase. |
| `db_name` | 12 | `'metabase'` | PostgreSQL database name. Do not change after initial deployment. |
| `db_user` | 12 | `'metabase'` | PostgreSQL application user. Password auto-generated and stored in Secret Manager. |
| `database_password_length` | 12 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after rotation before restarting the service. |

### C. Storage

Metabase does not require dedicated GCS storage by default — its application state is stored entirely in PostgreSQL. The `storage_buckets` default is an empty list.

| Variable | Group | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | 11 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 11 | `[]` | GCS buckets to provision. Empty by default — Metabase does not require object storage. |
| `enable_nfs` | 11 | `false` | Provisions NFS storage. Not typically required for Metabase. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Container path where NFS is mounted. |
| `gcs_volumes` | 11 | `[]` | GCS Fuse volume mounts. |
| `manage_storage_kms_iam` | 11 | `false` | Creates CMEK KMS keyring and enables CMEK on storage buckets. |
| `enable_artifact_registry_cmek` | 11 | `false` | Enables CMEK encryption for Artifact Registry images. |

### D. Networking

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — public internet; `'internal'` — VPC only; `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | VPC egress routing. |

### E. Initialization & Bootstrap

`Metabase Common` automatically provides a default `db-init` Cloud Run Job when `initialization_jobs` is empty. Override with a non-empty list to replace the default.

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | One-shot Cloud Run Jobs. Leave empty for `Metabase Common` to supply the default `db-init` PostgreSQL job. Non-empty list replaces it entirely. |
| `cron_jobs` | 13 | `[]` | Recurring scheduled Cloud Run Jobs triggered by Cloud Scheduler. |

---

## 4. Advanced Security

### A. Cloud Armor WAF

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules. |

### B. Identity-Aware Proxy (IAP)

IAP is particularly useful for Metabase, which is often deployed as an internal analytics tool. Enabling IAP ensures only authenticated Google users can access the Metabase UI.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Enables IAP natively on the Cloud Run service. |
| `iap_authorized_users` | 5 | `[]` | Users granted IAP access. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted IAP access. |

### C. Binary Authorization

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Enforces image attestation on deployment. |

### D. VPC Service Controls

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Enables VPC-SC perimeter enforcement. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC network access level. |
| `vpc_sc_dry_run` | 22 | `true` | Logs violations without blocking. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs. |

### E. Secret Manager Integration

| Variable | Group | Default | Description |
|---|---|---|---|
| `environment_variables` | 6 | `{}` | Plain-text env vars. `MB_JETTY_PORT` and `JAVA_TIMEZONE` are injected automatically — do not override. |
| `secret_environment_variables` | 6 | `{}` | Secret Manager references (e.g., `{ MB_EMAIL_SMTP_PASSWORD = "metabase-smtp-password" }`). |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation. |
| `secret_rotation_period` | 6 | `'2592000s'` | Secret Manager rotation notification frequency. |

---

## 5. Traffic & Ingress

### A. HTTPS Load Balancer & CDN

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cdn` | 10 | `false` | Enables Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` | 10 | `7` | Maximum recent container images to keep in Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Automatically deletes untagged images. |
| `image_retention_days` | 10 | `30` | Days after which images are eligible for deletion. |

### B. Custom Domains

| Variable | Group | Default | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Custom domain names for the HTTPS LB. |

---

## 6. CI/CD & Delivery

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT. Required on first apply. Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger config. |
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy pipeline. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Ordered promotion stages. |

---

## 7. Reliability & Scheduling

### A. Health Probes

Metabase requires generous initial delays due to JVM startup time. The default startup probe allows 120 seconds initial delay plus 15 × 10s retry periods = total of approximately 270 seconds startup tolerance.

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ path="/api/health", initial_delay_seconds=120, failure_threshold=15 }` | Startup probe. Generous delay for JVM initialization. |
| `liveness_probe` | 14 | `{ path="/api/health", initial_delay_seconds=120, failure_threshold=3 }` | Liveness probe. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/api/health" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |

### B. Backup

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated daily backups. |
| `backup_retention_days` | 7 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 7 | `false` | Triggers a one-time database restore on apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` or `'gdrive'`. |
| `backup_uri` | 7 | `""` | Full GCS URI or Google Drive file ID. |
| `backup_format` | 7 | `'sql'` | Backup format. |

### C. Auto Password Rotation

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Enables automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after rotation before restarting the service. |

---

## 8. Integrations

### A. Redis

Metabase does not natively use Redis. The `enable_redis` variable injects `REDIS_HOST` and `REDIS_PORT` environment variables but does not configure Metabase's caching — leave disabled unless a plugin or custom configuration requires Redis.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 21 | `false` | Injects Redis environment variables. Metabase does not require Redis. |
| `redis_host` | 21 | `""` | Redis hostname or IP. |
| `redis_port` | 21 | `'6379'` | Redis TCP port (string). |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive. |

### B. Data Sources

Metabase is a BI tool that queries external databases. After deployment, configure data sources in the Metabase Admin panel. Common GCP-native sources:
- **BigQuery** — Add via the Metabase Admin > Databases panel using a service account key or Workload Identity.
- **Cloud SQL PostgreSQL** — Connect using the internal VPC IP or via Cloud SQL Auth Proxy.
- **Cloud SQL MySQL** — Supported natively via JDBC.
- **Google Sheets** — Available as a data source with a Google service account.

### C. Environment Variables

Use `environment_variables` for non-sensitive Metabase configuration:

```hcl
environment_variables = {
  MB_EMBEDDING_ENABLED     = "true"
  MB_EMBEDDING_SECRET_KEY  = "..."   # use secret_environment_variables for this
  MB_SITE_URL              = "https://metabase.example.com"
  MB_SEND_EMAIL_ON_FIRST_LOGIN_FROM_NEW_DEVICE = "false"
}
```

> **Note:** `MB_JETTY_PORT = "3000"` and `JAVA_TIMEZONE = "UTC"` are set automatically by `Metabase Common`. Do not override these values.

### D. Custom SQL & Backup

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
| **PostgreSQL 15 required** | `database_type = "POSTGRES_15"` fixed by `Metabase Common` | Metabase uses PostgreSQL as its application database. |
| **MB_JETTY_PORT fixed** | `MB_JETTY_PORT = "3000"` injected by `Metabase Common` | Must match `container_port = 3000`. |
| **JAVA_TIMEZONE fixed** | `JAVA_TIMEZONE = "UTC"` injected by `Metabase Common` | UTC timezone ensures consistent timestamp handling. |
| **Default db-init job** | Supplied by `Metabase Common` when `initialization_jobs = []` | PostgreSQL database and user are created automatically. Override with a non-empty list. |
| **No application secrets generated** | `module_secret_env_vars = {}` | Metabase manages its own internal keys. No `SECRET_KEY` equivalent is created. |
| **No default GCS storage** | `storage_buckets = []` in `Metabase Common` | Metabase stores all state in PostgreSQL. Add buckets via `storage_buckets` if needed. |
| **Unix socket by default** | `enable_cloudsql_volume = true` default | Connects to Cloud SQL via Auth Proxy Unix socket. |
| **Scale-to-zero by default** | `min_instance_count = 0` | JVM cold starts take 60–120 seconds. Set to `1` for production. |

---

## 10. Variable Reference

| Variable | Group | Default | Description |
|---|---|---|---|
| `module_description` | 0 | (Metabase platform text) | Platform metadata: module description. |
| `module_documentation` | 0 | `https://docs.radmodules.dev/docs/modules/Metabase_CloudRun` | Platform metadata: documentation URL. |
| `module_dependency` | 0 | `['Services GCP']` | Platform metadata: required modules. |
| `module_services` | 0 | (GCP service list) | Platform metadata: GCP services consumed. |
| `credit_cost` | 0 | `50` | Platform metadata: deployment credit cost. |
| `require_credit_purchases` | 0 | `false` | Platform metadata: enforces credit balance check. |
| `enable_purge` | 0 | `true` | Permits full deletion of module resources on destroy. |
| `public_access` | 0 | `false` | Platform catalogue visibility. |
| `deployment_id` | 0 | `""` | Deployment ID suffix. Auto-generated if empty. |
| `resource_creator_identity` | 0 | (platform SA) | Service account used by Terraform to manage resources. |
| `project_id` | 1 | — | GCP project ID. **Required.** |
| `region` | 1 | `'us-central1'` | GCP region for Cloud Run and Cloud SQL. |
| `tenant_deployment_id` | 2 | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `[]` | Email addresses for monitoring alerts. |
| `resource_labels` | 2 | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `'metabase'` | Base resource name. |
| `display_name` | 3 | `'Metabase Analytics'` | Human-readable name in the GCP Console. |
| `description` | 3 | `'Metabase — open-source business intelligence and analytics platform'` | Cloud Run service description. |
| `application_version` | 3 | `'v0.51.3'` | Metabase image version tag. |
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 4 | `'custom'` | `'custom'` (Cloud Build) or `'prebuilt'` (existing image). |
| `container_image` | 4 | `""` | Container image URI override. |
| `cpu_limit` | 4 | `'2000m'` | CPU per instance. Minimum 1 vCPU; 2 vCPU recommended. |
| `memory_limit` | 4 | `'4Gi'` | Memory per instance. Minimum 2 Gi for JVM. |
| `container_port` | 4 | `3000` | Metabase's Jetty port. |
| `min_instance_count` | 4 | `0` | Minimum running instances. Set `1` for production. |
| `max_instance_count` | 4 | `3` | Maximum running instances. |
| `execution_environment` | 4 | `'gen2'` | Gen2 recommended. |
| `timeout_seconds` | 4 | `300` | Max request duration. Increase for long BI queries. |
| `enable_cloudsql_volume` | 4 | `true` | Injects Cloud SQL Auth Proxy sidecar. |
| `container_protocol` | 4 | `'http1'` | `'http1'` or `'h2c'`. |
| `enable_image_mirroring` | 4 | `true` | Mirrors the Metabase image into Artifact Registry. |
| `traffic_split` | 4 | `[]` | Canary/blue-green traffic allocation. |
| `max_revisions_to_retain` | 4 | `7` | Maximum Cloud Run revisions to keep. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Container path for the Auth Proxy Unix socket. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'`, or `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | VPC egress routing. |
| `enable_iap` | 5 | `false` | Enables IAP natively on the Cloud Run service. |
| `iap_authorized_users` | 5 | `[]` | Users granted IAP access. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted IAP access. |
| `environment_variables` | 6 | `{}` | Plain-text env vars. |
| `secret_environment_variables` | 6 | `{}` | Secret Manager references. |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation. |
| `secret_rotation_period` | 6 | `'2592000s'` | Secret rotation frequency. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated backups. |
| `backup_retention_days` | 7 | `7` | Days to retain backup files. |
| `enable_backup_import` | 7 | `false` | Triggers a one-time restore on apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` or `'gdrive'`. |
| `backup_uri` | 7 | `""` | Full GCS URI or Google Drive file ID. |
| `backup_format` | 7 | `'sql'` | Backup format. |
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT. Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger config. |
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy pipeline. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Ordered Cloud Deploy promotion stages. |
| `enable_binary_authorization` | 8 | `false` | Enforces image attestation. |
| `enable_custom_sql_scripts` | 9 | `false` | Runs SQL scripts from GCS after provisioning. |
| `custom_sql_scripts_bucket` | 9 | `""` | GCS bucket containing SQL scripts. |
| `custom_sql_scripts_path` | 9 | `""` | Path prefix within the bucket. |
| `custom_sql_scripts_use_root` | 9 | `false` | Run scripts as the root DB user. |
| `enable_cloud_armor` | 10 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | 10 | `[]` | Custom domains with Google-managed SSL certificates. |
| `enable_cdn` | 10 | `false` | Enables Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` | 10 | `7` | Maximum recent container images to keep. |
| `delete_untagged_images` | 10 | `true` | Automatically deletes untagged images. |
| `image_retention_days` | 10 | `30` | Days after which images are eligible for deletion. |
| `create_cloud_storage` | 11 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 11 | `[]` | GCS buckets. Empty by default for Metabase. |
| `enable_nfs` | 11 | `false` | Provisions NFS storage. Not typically required. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | NFS mount path. |
| `gcs_volumes` | 11 | `[]` | GCS Fuse volume mounts. |
| `manage_storage_kms_iam` | 11 | `false` | Creates CMEK KMS key for storage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Enables CMEK for Artifact Registry images. |
| `database_type` | 12 | `'POSTGRES_15'` | Cloud SQL engine. PostgreSQL required. |
| `db_name` | 12 | `'metabase'` | PostgreSQL database name. |
| `db_user` | 12 | `'metabase'` | PostgreSQL application user. |
| `database_password_length` | 12 | `32` | Auto-generated password length. |
| `enable_auto_password_rotation` | 12 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after rotation before restarting. |
| `initialization_jobs` | 13 | `[]` | One-shot Cloud Run Jobs. Leave empty for the default `db-init` job. |
| `cron_jobs` | 13 | `[]` | Recurring scheduled Cloud Run Jobs. |
| `startup_probe` | 14 | `{ path="/api/health", initial_delay_seconds=120, failure_threshold=15 }` | Startup probe. Generous delay for JVM. |
| `liveness_probe` | 14 | `{ path="/api/health", initial_delay_seconds=120, failure_threshold=3 }` | Liveness probe. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/api/health" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |
| `enable_redis` | 21 | `false` | Injects Redis env vars. Not required by Metabase. |
| `redis_host` | 21 | `""` | Redis hostname/IP. |
| `redis_port` | 21 | `'6379'` | Redis TCP port. |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive. |
| `enable_vpc_sc` | 22 | `false` | Enables VPC-SC perimeter enforcement. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC. |
| `vpc_sc_dry_run` | 22 | `true` | Logs violations without blocking. |
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
| `container_image` | Container image used for the deployment. |

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `memory_limit` | `"4Gi"` | **Critical** | Metabase runs on the JVM. Under 2 Gi the JVM cannot complete startup and the container restarts continuously with `java.lang.OutOfMemoryError`. Minimum safe value is `"2Gi"`; default `"4Gi"` is recommended for production. |
| `cpu_limit` | `"2000m"` | **High** | Metabase's JVM compilation phase during startup requires significant CPU. Under 500m the startup can take over 5 minutes, triggering Cloud Run startup-probe failures before the service becomes healthy. |
| `MB_JAVA_OPTS` (via `environment_variables`) | Not set | **High** | If set, always include `-Xmx` that stays below `memory_limit`. For example with `memory_limit = "4Gi"`, use `-Xmx3500m`. Setting `-Xmx` higher than available container memory causes OOM kills. |
| `MB_JETTY_PORT` | `"3000"` (hardcoded in Common) | **High** | Hard-coded in the Common module to `"3000"`. Overriding via `environment_variables` to any other port without also changing `container_port` causes health checks and all routing to fail. |
| `JAVA_TIMEZONE` | `"UTC"` (hardcoded in Common) | **Medium** | Overriding with a non-UTC timezone causes Metabase reports and scheduled questions to use a different timezone than the database, producing inconsistent date filtering results. |
| `application_database_name` | `"metabase"` | **High** | Changing after the database is initialised orphans the Metabase application schema. All question/dashboard metadata is lost. Immutable after first apply. |
| `application_database_user` | `"metabase"` | **High** | The database user is created in the db-init job. Renaming it requires manual Cloud SQL intervention. Immutable after first apply. |
| `application_version` | `"v0.51.3"` | **High** | Metabase does not support downgrading versions — a migration applied by a newer version cannot be reverted. Always test upgrades in a staging environment before applying to production. |
| `min_instance_count` | `1` | **High** | Scale-to-zero causes cold starts of 60–90 s (JVM startup + DB migrations check). Cloud Run health checks must be configured with a generous `startup_probe.failure_threshold` (default 30, = 300 s total). Reducing `failure_threshold` below 10 causes premature restarts. |
| `startup_probe.initial_delay_seconds` | `60` | **High** | Metabase needs at least 60 s before it can serve health-check traffic. Reducing this below 30 causes perpetual restart loops on first boot. |
| `startup_probe.failure_threshold` | `30` (= 300 s) | **High** | Reducing causes premature container kills before Metabase completes JVM startup and DB migration. Do not reduce below `20`. |
| `enable_cloudsql_volume` | `true` | **Critical** | Required for the Cloud SQL Auth Proxy sidecar to function. Disabling it with a PostgreSQL backend causes all database connections to fail. |
| `enable_iap` | `false` | **High** | Metabase's own login page is reachable publicly without IAP. For internal business intelligence tools, always enable IAP or restrict `ingress_settings`. |
| `ingress_settings` | `"all"` | **High** | Leaves Metabase accessible from the public internet. For internal deployments set to `"internal-and-cloud-load-balancing"`. |
| `max_instance_count` | `1` (check your setting) | **Medium** | Metabase uses PostgreSQL for shared state, so multiple instances are safe for read queries. However, the embedded Metabase scheduler (question execution, alert polling) should run on a single instance — keep at `1` unless you have a clear need for horizontal scale. |
| `enable_redis` | `false` | **Low** | Metabase does not natively integrate with Redis for caching. Enabling without a Metabase Enterprise licence that supports it has no effect. |
| `backup_schedule` | `"0 2 * * *"` | **Medium** | The Metabase application database contains all saved questions, dashboards, collections, and user metadata. Disabling automated backups means this cannot be recovered after accidental deletion. |
| `enable_auto_password_rotation` | `false` | **Medium** | Enabling DB password rotation without sufficient `rotation_propagation_delay_sec` causes brief intervals where Metabase holds a stale password and returns `500` errors during the rotation window. |
| `timeout_seconds` | `300` | **Medium** | Metabase complex query execution can take a long time. Reducing below 120 s causes in-flight analytical queries to be aborted. |
| `MB_DB_*` env vars (MB_DB_HOST, MB_DB_PORT, etc.) | Injected by entrypoint | **Critical** | The Common module's entrypoint injects these from platform-level DB_* variables. Manually overriding them via `environment_variables` can create conflicting connection strings and cause startup failures. |

## Destroying Resources

### Known Deletion Issue: Serverless IPv4 Address Release

When destroying a Cloud Run deployment, you may encounter:

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Resolution:** Wait 20–30 minutes after the initial destroy attempt, then re-run:

```bash
tofu destroy
```
