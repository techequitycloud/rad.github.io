# Open WebUI on Google Cloud Run

This document provides a comprehensive reference for the `modules/OpenWebUI_CloudRun` Terraform module. It covers architecture, IAM, configuration variables, Open WebUI-specific behaviours, and operational patterns for deploying Open WebUI on Google Cloud Run (v2).

---

## 1. Module Overview

Open WebUI is a self-hosted AI interface with 90,000+ GitHub stars, providing a polished ChatGPT-style frontend for Ollama, OpenAI-compatible APIs, and dozens of LLM providers. `OpenWebUI_CloudRun` is a **wrapper module** built on top of `App_CloudRun`. It uses `App_CloudRun` for all GCP infrastructure provisioning and injects Open WebUI-specific application configuration, secrets, and storage via `OpenWebUI_Common`.

**Key Capabilities:**
*   **Compute**: Cloud Run v2 (Gen2), 2 vCPU / 4 Gi by default. Scale-to-zero (`min_instance_count = 0`) with `max_instance_count = 3` — both are user-configurable.
*   **Data Persistence**: Cloud SQL **PostgreSQL 15**. `OpenWebUI_Common` provisions a `db-init` job that creates the database and user on first apply. The Cloud SQL Auth Proxy sidecar is enabled by default (`enable_cloudsql_volume = true`).
*   **Security**: Inherits Cloud Armor WAF, IAP, Binary Authorization, and VPC Service Controls from `App_CloudRun`. `WEBUI_SECRET_KEY` is auto-generated and stored in Secret Manager by `OpenWebUI_Common`.
*   **No Redis**: Open WebUI persists sessions and application state in PostgreSQL — no Redis session store is required. The `enable_redis` variable exists for compatibility but defaults to `false` and no `REDIS_*` env vars are injected.
*   **AI Backend Integration**: `ollama_base_url` and `openai_api_base_url` variables configure backend AI connections. API keys should be supplied via `secret_environment_variables`.
*   **Health**: Health probes target `/health` with 30-second initial delay.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 2 | `string` | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `list(string)` | `[]` | Email recipients for monitoring alerts. |
| `resource_labels` | 2 | `map(string)` | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `string` | `'openwebui'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 3 | `string` | `'Open WebUI'` | Human-readable name shown in the GCP Console. |
| `description` | 3 | `string` | `'Open WebUI — self-hosted AI interface...'` | Cloud Run service description. |
| `application_version` | 3 | `string` | `'latest'` | Open WebUI image version tag. |

**Wrapper architecture:** `OpenWebUI_CloudRun` calls `OpenWebUI_Common` to produce an `application_config` object containing Open WebUI-specific environment variables, probe configuration, and the `db-init` job. `module_storage_buckets` carries the GCS data bucket provisioned by `OpenWebUI_Common`. `scripts_dir = abspath("${path.module}/scripts")` at apply time (note: scripts live in the `OpenWebUI_CloudRun` module itself, not in `OpenWebUI_Common`).

---

## 2. IAM & Access Control

`OpenWebUI_CloudRun` delegates all IAM provisioning to `App_CloudRun`. The Cloud Run SA, Cloud Build SA, IAP service agent, and password rotation role sets are identical to those in `App_CloudRun`.

**Auto-generated secret:** `OpenWebUI_Common` auto-generates `WEBUI_SECRET_KEY` and stores it in Secret Manager. This key is used by Open WebUI to sign sessions. It is injected into the Cloud Run service via `module_secret_env_vars`.

**Database initialisation:** The `db-init` Cloud Run Job (provisioned by `OpenWebUI_Common`) creates the PostgreSQL database and user on first apply. It runs under the Cloud Run SA.

---

## 3. Core Service Configuration

### A. Compute (Cloud Run)

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `cpu_limit` | 4 | `'2000m'` | CPU per instance. 2 vCPU for RAG and embeddings workloads. |
| `memory_limit` | 4 | `'4Gi'` | Memory per instance. 4 Gi recommended for RAG pipelines. |
| `min_instance_count` | 4 | `0` | Minimum instances. Scale-to-zero by default. |
| `max_instance_count` | 4 | `3` | Maximum instances. |
| `container_port` | 4 | `8080` | Open WebUI's HTTP port. Do not set the `PORT` env var — it is reserved by Cloud Run. |
| `execution_environment` | 4 | `'gen2'` | Gen2 recommended for NFS and GCS Fuse compatibility. |
| `timeout_seconds` | 4 | `300` | Max request duration. Increase for long-running model inference requests. |
| `enable_cloudsql_volume` | 4 | `true` | Cloud SQL Auth Proxy sidecar for Unix socket connection to PostgreSQL. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |

### B. Open WebUI Settings (Group 5)

These variables are unique to Open WebUI and are not present in `App_CloudRun`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `ollama_base_url` | 5 | `""` | Base URL for the Ollama backend (e.g., `'http://ollama:11434'`). Leave empty to disable Ollama integration. |
| `openai_api_base_url` | 5 | `""` | Base URL for an OpenAI-compatible API (e.g., `'https://api.openai.com/v1'`). Leave empty if not using OpenAI. |
| `default_user_role` | 5 | `'pending'` | Default role for new user registrations. Options: `pending` (requires admin approval), `user`, `admin`. |
| `enable_signup` | 5 | `true` | Allow new users to self-register via the signup page. |
| `webui_auth` | 5 | `true` | Enable the login/authentication system (`WEBUI_AUTH`). Only disable for single-user or air-gapped deployments. |

**API key note:** Supply `OPENAI_API_KEY` and other sensitive credentials via `secret_environment_variables`, not `environment_variables`.

### C. Database (Cloud SQL — PostgreSQL 15)

Open WebUI requires PostgreSQL. The database type is fixed to PostgreSQL 15 and cannot be changed.

| Variable | Group | Default | Description |
|---|---|---|---|
| `db_name` | 3 | `'openwebui_db'` | PostgreSQL database name. Do not change after initial deployment. |
| `db_user` | 3 | `'openwebui_user'` | PostgreSQL application user. |
| `database_password_length` | — | `32` | Auto-generated password length. |

### D. Storage (GCS)

`OpenWebUI_Common` provisions a GCS data bucket for Open WebUI's backend data directory (`DATA_DIR=/app/backend/data`).

| Variable | Group | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | 11 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Additional GCS buckets to provision. |
| `enable_nfs` | 11 | `false` | NFS disabled by default — PostgreSQL holds application state. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Container path for NFS mount when enabled. |
| `gcs_volumes` | 11 | `[]` | GCS buckets to mount via GCS Fuse (requires `gen2`). |

### E. Networking

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'`, or `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | VPC egress routing. |

### F. Environment Variables & Secrets

The platform injects `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` automatically. `OpenWebUI_Common` assembles `DATABASE_URL` from these. `WEBUI_SECRET_KEY` is auto-generated and injected from Secret Manager.

| Variable | Group | Default | Description |
|---|---|---|---|
| `environment_variables` | 6 | `{}` | Plain-text env vars. Do not include `DATABASE_URL` — it is assembled automatically. |
| `secret_environment_variables` | 6 | `{}` | Secret Manager references. Use for `OPENAI_API_KEY` and similar sensitive values. |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation before dependent resources proceed. |

---

## 4. Advanced Security

### A. Cloud Armor WAF

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | 10 | `[]` | Custom domains with Google-managed SSL certificates. |
| `enable_cdn` | 10 | `false` | Enables Cloud CDN on the HTTPS LB backend. |

### B. Identity-Aware Proxy (IAP)

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Enables IAP on the Cloud Run service. Note: enabling IAP requires additional OAuth configuration. |
| `iap_authorized_users` | 5 | `[]` | Users/SAs granted IAP access. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted IAP access. |

### C. Binary Authorization & VPC-SC

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Enforces image attestation on deployment. |
| `enable_vpc_sc` | 22 | `false` | Registers module API calls within the project's VPC-SC perimeter. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs. |

---

## 5. CI/CD & Delivery

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT. Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger config. |
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy progressive delivery pipeline. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Ordered Cloud Deploy promotion stages. |

---

## 6. Reliability

### A. Health Probes

Open WebUI exposes `/health`. Both startup and liveness probes target this path.

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ path="/health", initial_delay_seconds=30, failure_threshold=30, ... }` | Startup probe. 30s delay accommodates first-boot DB migrations. |
| `liveness_probe` | 14 | `{ path="/health", initial_delay_seconds=60, failure_threshold=3, ... }` | Liveness probe. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/health" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |

### B. Backup & Recovery

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated daily backups. |
| `backup_retention_days` | 7 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 7 | `false` | Triggers a one-time restore on apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` or `'gdrive'`. |
| `backup_uri` | 7 | `""` | Full GCS URI or Google Drive file ID. |
| `backup_format` | 7 | `'sql'` | Backup file format. |

---

## 7. Platform-Managed Behaviours

| Behaviour | Implementation | Detail |
|---|---|---|
| **PostgreSQL required** | Fixed in `OpenWebUI_Common` | Open WebUI requires PostgreSQL for session and state persistence. |
| **WEBUI_SECRET_KEY auto-generated** | `OpenWebUI_Common` creates and stores in Secret Manager | Injected via `module_secret_env_vars`. Do not set manually. |
| **DATABASE_URL assembled automatically** | `OpenWebUI_Common` entrypoint | Constructed from injected `DB_*` env vars. Do not override. |
| **No Redis** | `module_env_vars = {}` | Unlike Odoo or Moodle, no `REDIS_*` env vars are injected. `enable_redis` defaults to `false`. |
| **Scripts directory** | `scripts_dir = abspath("${path.module}/scripts")` | Init scripts reside in `OpenWebUI_CloudRun/scripts/`, not in `OpenWebUI_Common`. |

---

## 8. Outputs

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

## Destroying Resources

### Known Deletion Issue: Serverless IPv4 Address Release

When destroying a Cloud Run deployment, you may encounter an error similar to:

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Resolution:** Wait 20–30 minutes after the initial destroy attempt, then re-run `tofu destroy`. GCP releases serverless IPv4 addresses approximately 20–30 minutes after the Cloud Run service is deleted.
