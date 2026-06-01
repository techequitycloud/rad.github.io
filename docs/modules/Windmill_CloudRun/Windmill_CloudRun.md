---
title: "Windmill on Google Cloud Run"
sidebar_label: "Windmill CloudRun"
---

# Windmill on Google Cloud Run

This document provides a comprehensive reference for the `modules/Windmill_CloudRun` Terraform module. It covers architecture, IAM, configuration variables, Windmill-specific behaviours, and operational patterns for deploying Windmill on Google Cloud Run (v2).

---

## 1. Module Overview

Windmill is an open-source developer platform for building internal tools, scripts, and automation workflows. `Windmill CloudRun` is a **wrapper module** built on top of `App CloudRun`. It uses `App CloudRun` for all GCP infrastructure provisioning and injects Windmill-specific application configuration, database initialisation, and storage configuration via `Windmill Common`.

**Key Capabilities:**
*   **Compute**: Cloud Run v2 (Gen2), combined server+worker mode, 2 vCPU / 2 Gi by default. Configurable min/max instance count.
*   **Data Persistence**: Cloud SQL **PostgreSQL 16** (uniquely requires Postgres 16, not 15). GCS `windmill-data` bucket auto-provisioned by `Windmill Common`.
*   **Security**: Inherits Cloud Armor WAF, IAP, Binary Authorization, and VPC Service Controls from `App CloudRun`. `WINDMILL_SMTP_PASS` secret auto-generated as a placeholder in Secret Manager.
*   **Caching**: Redis optional (`enable_redis = false` by default).
*   **CI/CD**: Cloud Build custom image pipeline using the bundled Dockerfile.
*   **Reliability**: Health probes target `/api/version` for readiness checks.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 1 | `string` | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 1 | `list(string)` | `[]` | Email recipients for monitoring alerts. |
| `resource_labels` | 1 | `map(string)` | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 2 | `string` | `'windmill'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 2 | `string` | `'Windmill'` | Human-readable name shown in the GCP Console. |
| `description` | 2 | `string` | `'Windmill developer platform'` | Cloud Run service description. |
| `application_version` | 2 | `string` | `'latest'` | Windmill image version tag. |

**Wrapper architecture:** `Windmill CloudRun` calls `Windmill Common` to build an `application_config` object containing Windmill-specific environment variables, probe configuration, and the `db-init` job definition. `Windmill Common` injects `MODE=server,worker`, `NUM_WORKERS=3`, `DISABLE_NSJAIL=true`, and structured logging variables. `module_storage_buckets` carries the `windmill-data` bucket. `module_env_vars` is empty — all Windmill environment variables are sourced from `Windmill Common`.

**PostgreSQL 16 note:** Unlike every other module in this repo which uses PostgreSQL 15, Windmill requires **PostgreSQL 16**. `database_type = "POSTGRES_16"` is fixed by `Windmill Common` and cannot be overridden.

---

## 2. IAM & Access Control

`Windmill_CloudRun` delegates all IAM provisioning to `App_CloudRun`. The Cloud Run SA, Cloud Build SA, IAP service agent, and password rotation role sets are identical to those in [App_CloudRun §2](../App_CloudRun/App_CloudRun.md#2-iam--access-control).

**SMTP password placeholder:** `Windmill Common` auto-generates a placeholder SMTP password (16-char random) and stores it in Secret Manager as `{prefix}-smtp-password`. The `WINDMILL_SMTP_PASS` secret ID is injected into the container via `module_secret_env_vars`. Replace the secret value with your actual SMTP password before enabling email features.

**Database initialisation identity:** The `db-init` Cloud Run Job runs under the Cloud Run SA. It connects to Cloud SQL PostgreSQL 16 via the Auth Proxy Unix socket, using `postgres:16-alpine` and `scripts/db-init.sh` from `Windmill Common`.

**120-second IAM propagation delay:** Inherited from `App CloudRun` — the Windmill service is not deployed until the delay completes, preventing secret-read failures on the first revision start.

For the complete role tables and IAP, password rotation, and public access details, see [App_CloudRun §2](../App_CloudRun/App_CloudRun.md#2-iam--access-control).

---

## 3. Core Service Configuration

### A. Compute (Cloud Run)

Windmill runs as a combined `server,worker` process on Cloud Run — both the API server and script execution workers run in the same container. This simplifies Cloud Run deployment while limiting worker scalability; for production workloads requiring separate worker scaling, use `Windmill GKE`.

**Startup CPU Boost** is always enabled (hardcoded in `App CloudRun`).

**Container image:** `container_image_source` defaults to `'custom'`, meaning Cloud Build compiles a custom image using `Windmill Common`'s bundled Dockerfile. The upstream image `ghcr.io/windmill-labs/windmill` is the build base.

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 3 | `true` | Set `false` for infrastructure-only deployment (SQL, storage, secrets). |
| `container_image_source` | 3 | `'custom'` | `'custom'` builds via Cloud Build. `'prebuilt'` deploys an existing image URI. |
| `container_image` | 3 | `""` | Override image URI. Leave empty for Cloud Build to manage the image. |
| `cpu_limit` | 3 | `'2000m'` | CPU per instance. 2 vCPU recommended for combined server+worker mode. |
| `memory_limit` | 3 | `'2Gi'` | Memory per instance. |
| `container_port` | 3 | `8000` | Windmill's HTTP port. |
| `execution_environment` | 3 | `'gen2'` | Gen2 required for GCS Fuse mounts. |
| `timeout_seconds` | 3 | `300` | Max request duration. |
| `enable_cloudsql_volume` | 3 | `true` | Default `true` — Windmill connects via Unix socket. |
| `min_instance_count` | 3 | `1` | Minimum Cloud Run instances. |
| `max_instance_count` | 3 | `3` | Maximum Cloud Run instances. |
| `traffic_split` | 3 | `[]` | Percentage-based canary/blue-green traffic allocation. |
| `service_annotations` | 3 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 3 | `{}` | Labels applied to the Cloud Run service. |

**Differences from `App CloudRun` defaults:**

| Variable | `App CloudRun` | `Windmill CloudRun` | Reason |
|---|---|---|---|
| `container_port` | `8080` | `8000` | Windmill's native port. |
| `cpu_limit` | `'1000m'` | `'2000m'` | Combined server+worker requires more CPU. |
| `memory_limit` | `'512Mi'` | `'2Gi'` | Worker execution requires additional memory. |
| `min_instance_count` | `0` | `1` | Windmill benefits from at least one warm instance. |

### B. Database (Cloud SQL — PostgreSQL 16)

Windmill requires **PostgreSQL 16** — `Windmill Common` fixes `database_type = "POSTGRES_16"`. This is the only module in this repository that uses PostgreSQL 16; all others default to PostgreSQL 15.

**Unix socket connection:** `enable_cloudsql_volume` defaults to `true`. `App CloudRun` injects the Auth Proxy sidecar and sets `DB_HOST` to the socket path under `/cloudsql`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `db_name` | 11 | `'windmill'` | PostgreSQL database name. **Do not change after initial deployment.** |
| `db_user` | 11 | `'windmill'` | PostgreSQL application user. Password auto-generated and stored in Secret Manager. |
| `database_password_length` | 11 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 11 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 11 | `90` | Seconds to wait after rotation before restarting the service. |

### C. Storage (GCS)

**GCS data bucket:** `Windmill Common` automatically provisions a `windmill-data` GCS bucket for workflow outputs and artefacts.

| Variable | Group | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | 10 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 10 | `[{ name_suffix = "data" }]` | Additional GCS buckets beyond the auto-provisioned data bucket. |
| `gcs_volumes` | 10 | `[]` | GCS buckets to mount via GCS Fuse. Each entry: `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. |
| `enable_nfs` | 10 | `false` | NFS shared storage. Disabled by default for Windmill. |

### D. Networking

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 4 | `'all'` | `'all'` — public internet; `'internal'` — VPC only; `'internal-and-cloud-load-balancing'` — forces traffic through the HTTPS Load Balancer. |
| `vpc_egress_setting` | 4 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` routes only RFC 1918 traffic via VPC. `'ALL_TRAFFIC'` routes all egress via VPC. |

### E. Environment Variables

`Windmill Common` injects all Windmill-specific environment variables. The following are hardcoded and not user-configurable:

| Variable | Value | Description |
|---|---|---|
| `MODE` | `server,worker` | Combined server and worker mode for Cloud Run. |
| `NUM_WORKERS` | `3` | Number of worker threads per instance. |
| `WORKER_GROUP` | `default` | Worker group name. |
| `DISABLE_NSJAIL` | `true` | Required when running without `CAP_SYS_ADMIN` (Cloud Run, GKE Autopilot). |
| `JSON_FMT` | `true` | Structured JSON logging for Cloud Logging compatibility. |
| `RUST_LOG` | `windmill=info` | Log verbosity. |
| `BASE_URL` | `var.service_url` | Public-facing service URL. |
| `BASE_INTERNAL_URL` | `var.service_url` | Internal service URL. |
| `METRICS_ADDR` | `:9001` | Prometheus metrics endpoint. |

User-supplied variables are merged into this set via `var.environment_variables`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `environment_variables` | 5 | `{}` | Additional plain-text env vars merged with Windmill defaults. |
| `secret_environment_variables` | 5 | `{}` | Secret Manager references merged with the SMTP secret auto-injected by `Windmill Common`. |
| `service_url` | 5 | `""` | Public URL for `BASE_URL` and `BASE_INTERNAL_URL`. Set this to your Cloud Run service URL or custom domain. |

### F. Initialization & Bootstrap

A `db-init` Cloud Run Job is automatically provisioned by `Windmill Common` when `initialization_jobs` is left as the default empty list (`[]`). It uses the `postgres:16-alpine` image and executes `Windmill_Common/scripts/db-init.sh`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 12 | `[]` | One-shot Cloud Run Jobs. Leave empty for `Windmill Common` to supply the default `db-init` job. Non-empty list replaces it entirely. |
| `cron_jobs` | 12 | `[]` | Recurring jobs triggered by Cloud Scheduler. |

---

## 4. Advanced Security

### A. Cloud Armor WAF

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 9 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. Required for custom domains, CDN, and DDoS protection. |
| `admin_ip_ranges` | 9 | `[]` | CIDR ranges exempted from WAF rules. |

### B. Identity-Aware Proxy (IAP)

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 4 | `false` | Enables IAP natively on the Cloud Run service. |
| `iap_authorized_users` | 4 | `[]` | Users/service accounts granted access. |
| `iap_authorized_groups` | 4 | `[]` | Google Groups granted access. |

### C. Secret Manager Integration

`Windmill Common` auto-provisions the `WINDMILL_SMTP_PASS` secret with a placeholder value. Replace this value in Secret Manager before enabling SMTP features.

| Variable | Group | Default | Description |
|---|---|---|---|
| `secret_environment_variables` | 5 | `{}` | Additional Secret Manager references. `WINDMILL_SMTP_PASS` is injected automatically. |
| `secret_rotation_period` | 5 | `'2592000s'` | Secret Manager rotation notification frequency. Default: 30 days. |

---

## 5. Traffic & Ingress

### A. HTTPS Load Balancer

When `enable_cloud_armor = true`, a Global HTTPS Load Balancer backed by a Serverless NEG is provisioned. See [App_CloudRun §5.A](../App_CloudRun/App_CloudRun.md#a-https-load-balancer) for full architecture details.

### B. Cloud CDN

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cdn` | 9 | `false` | Enables Cloud CDN on the HTTPS LB backend. Only effective when `enable_cloud_armor = true`. |

**Windmill consideration:** Windmill serves API responses and script execution results that are not cacheable. CDN is appropriate only for static frontend assets. Ensure `Cache-Control` headers are set correctly before enabling.

### C. Custom Domains

| Variable | Group | Default | Description |
|---|---|---|---|
| `application_domains` | 9 | `[]` | Custom domain names for the HTTPS LB. Google-managed SSL certificates provisioned per domain. |

When using a custom domain, set `service_url` to the custom domain so `BASE_URL` and `BASE_INTERNAL_URL` are configured correctly.

---

## 6. CI/CD & Delivery

### A. Cloud Build Triggers

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 7 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 7 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 7 | `""` | GitHub PAT. Required on first apply. Sensitive. |
| `github_app_installation_id` | 7 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 7 | `{ branch_pattern = "^main$" }` | Advanced trigger config. |

### B. Cloud Deploy Pipeline

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 7 | `false` | Provisions a Cloud Deploy pipeline. Requires `enable_cicd_trigger = true`. |

---

## 7. Reliability & Scheduling

### A. Health Probes

Windmill exposes a `/api/version` endpoint that returns the current version when the service is ready.

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 13 | `{ enabled=true, type="HTTP", path="/api/version", initial_delay_seconds=30, timeout_seconds=5, period_seconds=10, failure_threshold=6 }` | Startup readiness probe. |
| `liveness_probe` | 13 | `{ enabled=true, type="HTTP", path="/api/version", initial_delay_seconds=30, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Liveness probe. |
| `uptime_check_config` | 13 | `{ enabled=true, path="/api/version" }` | Cloud Monitoring uptime check. |

### B. Auto Password Rotation

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 11 | `false` | Enables automated password rotation. |
| `rotation_propagation_delay_sec` | 11 | `90` | Seconds to wait after writing the new secret before restarting. |

---

## 8. Integrations

### A. Redis Cache

Redis is **disabled by default** (`enable_redis = false`). Windmill does not require Redis for core operation.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 20 | `false` | Enables Redis. Not required for standard Windmill operation. |
| `redis_host` | 20 | `""` | Redis server hostname or IP. |
| `redis_port` | 20 | `'6379'` | Redis server TCP port (string). |

### B. Email (SMTP)

Windmill supports SMTP for sending workflow notifications and alerts. The `WINDMILL_SMTP_PASS` secret is provisioned automatically as a placeholder. Configure SMTP settings via `environment_variables`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `environment_variables` | 5 | `{}` | Add `SMTP_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS_IMPLICIT_PORTS` as needed. |
| `secret_environment_variables` | 5 | `{}` | `WINDMILL_SMTP_PASS` is auto-injected. Override the placeholder in Secret Manager. |

### C. Metrics & Observability

Windmill exposes Prometheus metrics at `:9001/metrics` via `METRICS_ADDR`. This endpoint is accessible within the VPC for scraping.

---

## 9. Platform-Managed Behaviours

| Behaviour | Implementation | Detail |
|---|---|---|
| **PostgreSQL 16 required** | `database_type = "POSTGRES_16"` fixed by `Windmill Common` | Windmill requires PG 16. Only module in this repo with this constraint. |
| **Combined server+worker** | `MODE=server,worker` hardcoded in `Windmill Common` | Both the API server and worker run in the same process. Suitable for Cloud Run. Use GKE for separate worker scaling. |
| **DISABLE_NSJAIL** | `DISABLE_NSJAIL=true` hardcoded in `Windmill Common` | Required when running without `CAP_SYS_ADMIN`. Cloud Run and GKE Autopilot do not have this capability. |
| **JSON logging** | `JSON_FMT=true`, `RUST_LOG=windmill=info` | Structured JSON for Cloud Logging compatibility. |
| **SMTP secret placeholder** | `WINDMILL_SMTP_PASS` auto-generated by `Windmill Common` | Replace the placeholder in Secret Manager before enabling email features. |
| **GCS data bucket** | `windmill-data` bucket provisioned by `Windmill Common` | Provisioned separately from user-defined `storage_buckets`. |
| **Unix socket by default** | `enable_cloudsql_volume = true` default | Windmill connects to Cloud SQL via the Auth Proxy Unix socket. |
| **Metrics endpoint** | `METRICS_ADDR=:9001` | Prometheus metrics available within the VPC. |
| **Empty module_env_vars** | `module_env_vars = {}` in `windmill.tf` | All Windmill environment variables are supplied by `Windmill Common`; the wrapper does not inject additional vars. |

---

## 10. Variable Reference

| Variable | Group | Default | Description |
|---|---|---|---|
| `module_description` | 0 | (Windmill platform text) | Platform metadata: module description. |
| `module_documentation` | 0 | (docs URL) | Platform metadata: documentation URL. |
| `module_dependency` | 0 | `['Services GCP']` | Platform metadata: required modules. |
| `module_services` | 0 | (GCP service list) | Platform metadata: GCP services consumed. |
| `credit_cost` | 0 | `50` | Platform metadata: deployment credit cost. |
| `require_credit_purchases` | 0 | `false` | Platform metadata: enforces credit balance check. |
| `enable_purge` | 0 | `true` | Permits full deletion of module resources on destroy. |
| `public_access` | 0 | `true` | Platform catalogue visibility. |
| `deployment_id` | 0 | `""` | Deployment ID suffix. Auto-generated if empty. |
| `project_id` | 1 | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 1 | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 1 | `[]` | Email addresses for monitoring alerts. |
| `resource_labels` | 1 | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 2 | `'windmill'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 2 | `'Windmill'` | Human-readable name. |
| `description` | 2 | `'Windmill developer platform'` | Service description. |
| `application_version` | 2 | `'latest'` | Windmill container image tag. |
| `deploy_application` | 3 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 3 | `'custom'` | `'custom'` (Cloud Build) or `'prebuilt'` (existing image). |
| `container_image` | 3 | `""` | Container image URI. Leave empty for Cloud Build to manage. |
| `cpu_limit` | 3 | `'2000m'` | CPU per instance. |
| `memory_limit` | 3 | `'2Gi'` | Memory per instance. |
| `container_port` | 3 | `8000` | Windmill's native port. |
| `execution_environment` | 3 | `'gen2'` | Gen2 execution environment. |
| `timeout_seconds` | 3 | `300` | Max request duration. |
| `enable_cloudsql_volume` | 3 | `true` | Connects via Unix socket. |
| `min_instance_count` | 3 | `1` | Minimum Cloud Run instances. |
| `max_instance_count` | 3 | `3` | Maximum Cloud Run instances. |
| `enable_image_mirroring` | 3 | `false` | Mirrors image into Artifact Registry. |
| `traffic_split` | 3 | `[]` | Canary/blue-green traffic allocation. |
| `service_annotations` | 3 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 3 | `{}` | Labels applied to the Cloud Run service. |
| `ingress_settings` | 4 | `'all'` | `'all'`, `'internal'`, or `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 4 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` or `'ALL_TRAFFIC'`. |
| `enable_iap` | 4 | `false` | Enables IAP on the Cloud Run service. |
| `iap_authorized_users` | 4 | `[]` | Users/SAs granted IAP access. |
| `iap_authorized_groups` | 4 | `[]` | Google Groups granted IAP access. |
| `environment_variables` | 5 | `{}` | Additional plain-text env vars merged with Windmill defaults. |
| `secret_environment_variables` | 5 | `{}` | Additional Secret Manager references. |
| `service_url` | 5 | `""` | Public URL for `BASE_URL` and `BASE_INTERNAL_URL`. |
| `secret_propagation_delay` | 5 | `30` | Seconds to wait after secret creation. |
| `secret_rotation_period` | 5 | `'2592000s'` | Secret Manager rotation notification frequency. |
| `backup_schedule` | 6 | `'0 2 * * *'` | Cron expression (UTC) for automated backups. |
| `backup_retention_days` | 6 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 6 | `false` | Triggers a one-time restore on apply. |
| `backup_source` | 6 | `'gcs'` | `'gcs'` or `'gdrive'`. |
| `backup_uri` | 6 | `""` | Full GCS URI or Google Drive file ID. |
| `backup_format` | 6 | `'sql'` | Backup format. |
| `enable_cicd_trigger` | 7 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 7 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 7 | `""` | GitHub PAT. Sensitive. |
| `github_app_installation_id` | 7 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 7 | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger config. |
| `enable_cloud_deploy` | 7 | `false` | Provisions a Cloud Deploy pipeline. |
| `enable_binary_authorization` | 7 | `false` | Enforces image attestation on deployment. |
| `nfs_instance_name` | 8 | `""` | Name of an existing NFS GCE VM. |
| `nfs_instance_base_name` | 8 | `'app-nfs'` | Base name for inline NFS VM. |
| `enable_cloud_armor` | 9 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | 9 | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | 9 | `[]` | Custom domains with Google-managed SSL certificates. |
| `enable_cdn` | 9 | `false` | Enables Cloud CDN. |
| `max_images_to_retain` | 9 | `7` | Maximum container images to keep in Artifact Registry. |
| `delete_untagged_images` | 9 | `true` | Deletes untagged images from Artifact Registry. |
| `image_retention_days` | 9 | `30` | Days after which images are eligible for deletion. |
| `create_cloud_storage` | 10 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 10 | `[{ name_suffix = "data" }]` | Additional GCS buckets to provision. |
| `enable_nfs` | 10 | `false` | NFS shared storage. Disabled by default. |
| `gcs_volumes` | 10 | `[]` | GCS buckets to mount via GCS Fuse. |
| `db_name` | 11 | `'windmill'` | PostgreSQL database name. Do not change after deployment. |
| `db_user` | 11 | `'windmill'` | PostgreSQL application user. |
| `database_password_length` | 11 | `32` | Auto-generated password length. |
| `enable_auto_password_rotation` | 11 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 11 | `90` | Seconds to wait after rotation before restarting. |
| `initialization_jobs` | 12 | `[]` | One-shot Cloud Run Jobs. Leave empty for `Windmill Common` to supply the default `db-init` job. |
| `cron_jobs` | 12 | `[]` | Recurring scheduled Cloud Run Jobs. |
| `startup_probe` | 13 | `{ path="/api/version", initial_delay_seconds=30, failure_threshold=6, ... }` | Startup probe. |
| `liveness_probe` | 13 | `{ path="/api/version", initial_delay_seconds=30, failure_threshold=3, ... }` | Liveness probe. |
| `uptime_check_config` | 13 | `{ enabled=true, path="/api/version" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 13 | `[]` | Cloud Monitoring metric alert policies. |
| `enable_redis` | 20 | `false` | Optional Redis integration. Disabled by default. |
| `redis_host` | 20 | `""` | Redis hostname/IP. |
| `redis_port` | 20 | `'6379'` | Redis TCP port (string). |
| `enable_vpc_sc` | 22 | `false` | Registers API calls within the project's VPC-SC perimeter. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC. |
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
| `database_instance_name` | Name of the Cloud SQL PostgreSQL 16 instance. |
| `database_name` | Name of the application database. |
| `database_user` | Name of the application database user. |
| `database_password_secret` | Secret Manager secret name for the database password. |
| `storage_buckets` | Created GCS storage buckets. |
| `container_image` | Container image used for the deployment. |
| `cicd_enabled` | Whether the CI/CD pipeline is enabled. |
| `github_repository_url` | GitHub repository URL connected for CI/CD. |

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `service_url` / `BASE_URL` (via Common) | Auto-predicted from Cloud Run service URL | **High** | `BASE_URL` and `BASE_INTERNAL_URL` are derived from `service_url` in Windmill Common. If this is empty or incorrect, OAuth callbacks fail (GitHub, Google, etc.), script execution webhooks point to the wrong host, and Windmill's UI deep-links are broken. Always verify the predicted service URL matches the actual Cloud Run service URL. |
| `database_type` | `POSTGRES_15` | **Critical** | The Windmill module description mentions PostgreSQL 16 support in some contexts. Ensure the Cloud SQL instance version matches what Windmill's migration scripts expect. Using a lower PostgreSQL version (e.g., 13) can cause migration failures during the init job, leaving the database in a partially-initialised state. |
| `db_name` | `windmill` | **High** | Changing after first deploy causes Windmill to connect to a database with no schema, resulting in migration errors at startup and a non-functional service. |
| `db_user` | `windmill` | **High** | Windmill's initialisation job creates the schema under this user. Changing it after deploy breaks the database connection unless the Cloud SQL user grants and Secret Manager password are also updated in sync. |
| `enable_cloudsql_volume` | `true` | **Critical** | Windmill connects to Cloud SQL via the Auth Proxy Unix socket. Disabling this causes the database connection to fail and Windmill to crash immediately on startup. |
| `cpu_limit` | `2000m` | **High** | Windmill Cloud Run runs in combined `server,worker` mode (both server and worker processes in the same container). Insufficient CPU (below 1000m) causes worker script execution to be severely throttled, increasing job queue latency and causing timeouts on long-running scripts. |
| `memory_limit` | `2Gi` | **High** | Windmill workers execute arbitrary user scripts (Python, TypeScript, Go, Bash). A 512Mi limit causes OOM kills during script execution. 2Gi is the functional minimum; 4Gi is recommended for production Python workloads. |
| `min_instance_count` | `1` | **High** | Setting to `0` enables scale-to-zero. Windmill webhooks and scheduled jobs require the service to be running at all times. Scale-to-zero causes missed scheduled executions and HTTP 503 for webhook triggers until the instance warms up. |
| `timeout_seconds` | `300` | **Medium** | Windmill jobs that exceed the Cloud Run request timeout are killed mid-execution. For long-running scripts, increase this up to 3600. Windmill's internal job timeout must be set below this value to ensure graceful termination. |
| `smtp_*` via Secret Manager | SMTP password stored as a dummy secret | **Medium** | Windmill creates a dummy SMTP password secret at deploy time. SMTP is only functional when `WINDMILL_SMTP_HOST`, `WINDMILL_SMTP_PORT`, `WINDMILL_SMTP_FROM`, and the actual SMTP password are all set together. Configuring some but not all SMTP variables causes silent email delivery failures. |
| `enable_redis` | `false` | **Medium** | Redis enables Windmill's distributed queue mode for multi-worker setups. Without Redis, multiple Cloud Run instances each process only their own queue, which can cause job duplication or starvation under concurrent load. |
| `redis_host` | `""` | **High** | Required when `enable_redis = true`. An empty value causes the Windmill container to start without a valid Redis connection string, defaulting to in-memory queue mode silently — losing all benefits of the Redis queue. |
| `worker_group` / `NUM_WORKERS` (via Common) | `"default"` / `"3"` | **Medium** | Cloud Run combined mode runs 3 workers by default within the container. Increasing `NUM_WORKERS` without increasing `cpu_limit` and `memory_limit` proportionally causes resource contention and worker starvation. Each worker needs approximately 500m CPU and 512Mi RAM. |
| `backup_schedule` | `"0 2 * * *"` | **Medium** | An empty string disables automated database backups. Windmill stores all flows, scripts, variables, and job history in PostgreSQL. Without backups, a Cloud SQL failure results in complete loss of all automation definitions. |
| `ingress_settings` | `"all"` | **Medium** | Setting to `internal` restricts Windmill to VPC-only access. Webhooks from external services (GitHub, Slack, etc.) will not reach the service. Use `internal-and-cloud-load-balancing` when behind a GCLB for public webhook access with VPC-internal routing. |
| `enable_iap` | `false` | **Medium** | IAP requires `iap_oauth_client_id` and `iap_oauth_client_secret`. Enabling IAP without both values causes the IAP binding to fail. IAP also requires a custom domain on a GCLB — direct Cloud Run URL access bypasses IAP entirely. |
| `max_instance_count` | `3` | **Medium** | Each Cloud Run instance runs multiple workers in combined mode. More than 3 instances without Redis-based queue coordination causes the same job to be picked up by multiple workers simultaneously, leading to duplicate executions. Use Redis when scaling beyond 1 instance. |
| `execution_environment` | `"gen2"` | **High** | Gen2 is required for NFS mounts. If NFS is needed for shared script storage, gen1 does not support the required Unix socket paths and NFS protocol. |
| `enable_vpc_sc` | `false` | **High** | Requires explicit `organization_id`. Without it, VPC Service Controls are silently skipped, giving a false sense of perimeter security. |
| `enable_auto_password_rotation` | `false` | **Medium** | When enabled, the Cloud SQL password rotates on a schedule. The Cloud Run revision must be redeployed after rotation to pick up the new Secret Manager version; otherwise Windmill uses an invalid password until connections fail. |

## Destroying Resources

### Known Deletion Issue: Serverless IPv4 Address Release

When destroying a Cloud Run deployment, you may encounter:

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Resolution:** Wait 20–30 minutes after the initial destroy attempt, then re-run `tofu destroy`. GCP holds serverless IPv4 addresses on the VPC subnet asynchronously; the second run will succeed once they are released.
