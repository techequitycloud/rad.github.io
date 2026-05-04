# OpenClaw on Google Cloud Run

This document provides a comprehensive reference for the `modules/OpenClaw_CloudRun` Terraform module. It covers architecture, configuration variables, OpenClaw-specific behaviors, and operational patterns for deploying the OpenClaw AI agent gateway on Google Cloud Run (v2).

---

## 1. Module Overview

OpenClaw is a serverless, multi-tenant AI agent gateway that provides WebSocket-enabled conversational AI agents with persistent GCS-backed workspace storage. `OpenClaw_CloudRun` is a **wrapper module** built on top of `App_CloudRun`. It uses `App_CloudRun` for all GCP infrastructure provisioning and injects OpenClaw-specific application configuration, secrets, storage, and container build configuration via `OpenClaw_Common`.

**Key Capabilities:**
- **Compute**: Cloud Run v2 (Gen2), custom container image built from `ghcr.io/openclaw/openclaw`, scale-to-zero by default (`min_instance_count = 0`). CPU is always allocated (`cpu_always_allocated = true`) to support WebSocket connections and async agent operations.
- **Data Persistence**: GCS Fuse volume mounted at `/data` for durable agent workspace across container restarts. No database, no Redis — all state lives in GCS.
- **Security**: `ANTHROPIC_API_KEY` auto-stored in Secret Manager. Optional Telegram and Slack credentials also stored in Secret Manager. Inherits Cloud Armor WAF, IAP, Binary Authorization, and VPC Service Controls from `App_CloudRun`.
- **Messaging**: Optional Telegram and Slack channel integration via dedicated Secret Manager secrets. Webhook/signing secrets for a companion router are stored separately and exposed as dedicated outputs.
- **Skills Sync**: On every container startup, the entrypoint optionally clones or updates a shared GitHub skills repository into `/data/workspace/skill-library`.

**Wrapper architecture:** `OpenClaw_CloudRun` calls `OpenClaw_Common` to build an `application_config` object containing the container image reference, GCS Fuse workspace volume, environment variable injection, and Secret Manager credential references. `module_secret_env_vars` carries secret IDs from `OpenClaw_Common`. `module_explicit_secret_values` carries raw credential values for initial apply propagation. `module_storage_buckets` carries the workspace GCS bucket. `scripts_dir` is resolved to `OpenClaw_Common/scripts`.

---

## 2. IAM & Access Control

`OpenClaw_CloudRun` delegates all IAM provisioning to `App_CloudRun`. The Cloud Run SA, Cloud Build SA, and password rotation role sets are identical to those in `App_CloudRun`.

**OpenClaw secrets and IAM:** `OpenClaw_Common` creates Secret Manager secrets during provisioning: at minimum, `ANTHROPIC_API_KEY`, and optionally Telegram and Slack credentials. These are injected via `module_secret_env_vars`. The Cloud Run SA requires `roles/secretmanager.secretAccessor`, which is already granted by `App_CloudRun`.

**GCS workspace IAM:** `OpenClaw_Common` provisions a GCS workspace bucket and grants the application SA `roles/storage.objectAdmin`. The OpenClaw container runs as UID 1000, which matches the `uid=1000,gid=1000` GCS Fuse mount options.

**No database identity:** OpenClaw has no Cloud SQL dependency. The `db-init` job is not provisioned. `enable_cloudsql_volume = false` is hard-coded.

---

## 3. Core Service Configuration

### A. Compute (Cloud Run)

OpenClaw is a Node.js gateway. The default resource limits (`cpu_limit = "2000m"`, `memory_limit = "2Gi"`) are suitable for moderate agent workloads.

**Scale-to-zero is enabled by default** (`min_instance_count = 0`). This results in 15–20 second cold starts. Set `min_instance_count = 1` for latency-sensitive agent deployments.

**CPU always allocated** (`cpu_always_allocated = true`). This is required — CPU throttling breaks WebSocket connections and async agent operations. Do not set to `false`.

**Gen2 execution environment** (`execution_environment = "gen2"`) is the default and required for GCS Fuse volume mounts.

**Maximum instances** defaults to `1` per tenant. OpenClaw maintains per-session state; multiple instances for the same tenant will split state across replicas unless sticky routing (e.g. session affinity) is in place.

**Custom image build:** `container_image_source = "custom"` (via `OpenClaw_Common`) is always used. The module builds a custom image layering `entrypoint.sh` onto `ghcr.io/openclaw/openclaw:<version>`. Set `application_version` to pin a specific release.

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 3 | `true` | Set `false` for infrastructure-only deployment (GCS bucket, secrets). |
| `cpu_limit` | 3 | `"2000m"` | CPU limit per container instance. Minimum 1 vCPU recommended. |
| `memory_limit` | 3 | `"2Gi"` | Memory limit per container instance. |
| `min_instance_count` | 3 | `0` | `0` enables scale-to-zero (15–20s cold start). Set `≥1` to eliminate cold starts for latency-sensitive agents. |
| `max_instance_count` | 3 | `1` | Keep at `1` per tenant to avoid split-state. Increase only with sticky session routing. |
| `container_port` | 3 | `8080` | TCP port the OpenClaw gateway listens on. Must match the `PORT` env var. |
| `execution_environment` | 3 | `"gen2"` | Gen2 **required** for GCS Fuse. Do not change to `"gen1"`. |
| `cpu_always_allocated` | 3 | `true` | CPU always allocated. Required for WebSocket connections and async operations. Do not set to `false`. |
| `timeout_seconds` | 3 | `3600` | Maximum request duration. Agent sessions can be long-running; 3600s is the maximum. |
| `enable_cloudsql_volume` | 3 | `false` | Not used by OpenClaw. Set to `false`. |
| `service_annotations` | 3 | `{}` | Custom Cloud Run service annotations. |
| `service_labels` | 3 | `{}` | Custom labels applied to the Cloud Run service. |
| `enable_image_mirroring` | 3 | `true` | Mirror the built image to Artifact Registry. |
| `container_protocol` | 3 | `"http1"` | HTTP protocol. Use `"h2c"` only if all callers support HTTP/2 cleartext. |
| `cloudsql_volume_mount_path` | 3 | `"/cloudsql"` | Not used by OpenClaw; retained for `App_CloudRun` interface compatibility. |
| `traffic_split` | 3 | `[]` | Percentage-based canary/blue-green traffic allocation. All entries must sum to 100. |
| `max_revisions_to_retain` | 3 | `7` | Maximum Cloud Run revisions to keep after each deployment. |

### B. Networking

The default `ingress_settings = "internal"` is intentional — the OpenClaw agent is typically deployed behind a shared router that handles external traffic. Set to `"all"` for direct public access.

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 4 | `"internal"` | `"internal"` — VPC only; `"all"` — public internet; `"internal-and-cloud-load-balancing"` — forces traffic through the HTTPS LB. Recommended: `"internal"` for router-fronted deployments. |
| `vpc_egress_setting` | 4 | `"PRIVATE_RANGES_ONLY"` | `"PRIVATE_RANGES_ONLY"` routes only RFC 1918 traffic via VPC. |
| `enable_iap` | 4 | `false` | Enables IAP on the Cloud Run service. Note: IAP blocks router service-to-service calls unless the router SA is added to `iap_authorized_users`. |
| `iap_authorized_users` | 4 | `[]` | Users/SAs granted IAP access. |
| `iap_authorized_groups` | 4 | `[]` | Google Groups granted IAP access. |

### C. Storage (GCS)

OpenClaw requires no NFS. All state is persisted via GCS Fuse at `/data`. NFS is disabled by default (`enable_nfs = false`).

The workspace GCS bucket is always provisioned by `OpenClaw_Common` regardless of `create_cloud_storage` or `storage_buckets` settings.

| Variable | Group | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | 10 | `true` | Provision additional GCS buckets defined in `storage_buckets`. The workspace bucket is always created. |
| `storage_buckets` | 10 | `[]` | Additional GCS buckets beyond the auto-provisioned workspace bucket. |
| `enable_nfs` | 10 | `false` | OpenClaw uses GCS Fuse for state; NFS is not required. |
| `nfs_mount_path` | 10 | `"/mnt/nfs"` | NFS mount path. Only used when `enable_nfs = true`. |
| `nfs_instance_name` | 10 | `""` | Existing NFS GCE VM name. Auto-discovered when empty. |
| `nfs_instance_base_name` | 10 | `"app-nfs"` | Base name for inline NFS GCE VM. |
| `gcs_volumes` | 10 | `[]` | Additional GCS Fuse volumes. The `openclaw-data` workspace volume at `/data` is always appended automatically. |
| `manage_storage_kms_iam` | 10 | `false` | Creates a CMEK KMS key for GCS encryption. |
| `enable_artifact_registry_cmek` | 10 | `false` | CMEK encryption for Artifact Registry. |

---

## 4. OpenClaw Configuration

### A. Application Identity

| Variable | Group | Default | Description |
|---|---|---|---|
| `application_name` | 2 | `"openclaw"` | Internal identifier for the Cloud Run service and GCS bucket. Do not change after initial deployment. |
| `application_display_name` | 2 | `"OpenClaw Gateway"` | Human-readable name shown in the platform UI. |
| `description` | 2 | `"OpenClaw AI Gateway - Serverless multi-tenant AI agent gateway on Cloud Run"` | Cloud Run service description. |
| `application_version` | 2 | `"latest"` | OpenClaw image tag used as `BASE_IMAGE` in the Cloud Build. Pin to a specific release (e.g. `"1.2.3"`) for reproducible deployments. |

### B. Skills Repository (Group 14)

The skills repository is cloned or updated on every container startup by `entrypoint.sh`. This makes the latest skills available without requiring a container rebuild.

| Variable | Group | Default | Description |
|---|---|---|---|
| `skills_repo_url` | 14 | `""` | GitHub URL of a shared OpenClaw skills repository. Cloned into `/data/workspace/skill-library` on startup. Leave empty to skip skill syncing. |
| `skills_repo_ref` | 14 | `"main"` | Git ref (branch, tag, or SHA) to check out. |

### C. AI Provider & Messaging Credentials (Group 14)

All credentials are stored in Secret Manager and injected at runtime. Plaintext values are never written to Terraform state after the initial secret version is created.

| Variable | Group | Default | Description |
|---|---|---|---|
| `anthropic_api_key` | 14 | `""` | Anthropic API key. Stored as `<prefix>-anthropic-api-key` in Secret Manager; injected as `ANTHROPIC_API_KEY`. Required on initial deployment; omit on updates to retain stored value. Sensitive. |
| `enable_telegram` | 14 | `false` | Provision Telegram secrets. Requires `telegram_bot_token` and `telegram_webhook_secret`. |
| `telegram_bot_token` | 14 | `""` | Telegram bot token from @BotFather. Injected as `TELEGRAM_BOT_TOKEN`. Sensitive. |
| `telegram_webhook_secret` | 14 | `""` | Webhook validation secret for the router (not the agent). Stored separately; not injected into the agent container. Generate with: `openssl rand -hex 32`. Sensitive. |
| `enable_slack` | 14 | `false` | Provision Slack secrets. Requires `slack_bot_token` and `slack_signing_secret`. |
| `slack_bot_token` | 14 | `""` | Slack bot token (`xoxb-...`). Injected as `SLACK_BOT_TOKEN`. Sensitive. |
| `slack_signing_secret` | 14 | `""` | Slack signing secret for the router (not the agent). Stored separately; not injected into the agent container. Sensitive. |

**Validation:** `enable_slack = true` requires both `slack_bot_token` and `slack_signing_secret` to be non-empty. `enable_telegram = true` requires both `telegram_bot_token` and `telegram_webhook_secret` to be non-empty. Violations are caught by `validation.tf` preconditions before apply.

---

## 5. Advanced Security

### A. Cloud Armor WAF

When `enable_cloud_armor = true`, a Global HTTPS Load Balancer with a Cloud Armor WAF policy is provisioned in front of Cloud Run.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 9 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | 9 | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | 9 | `[]` | Custom domains with Google-managed SSL certificates. DNS must point to the LB IP. |
| `enable_cdn` | 9 | `false` | Enables Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` | 9 | `7` | Maximum recent container images to keep in Artifact Registry. |
| `delete_untagged_images` | 9 | `true` | Automatically delete untagged container images. |
| `image_retention_days` | 9 | `30` | Days after which images are eligible for deletion. `0` disables age-based deletion. |

### B. VPC Service Controls

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_vpc_sc` | 4 | `false` | Registers API calls within the project's VPC-SC perimeter. |
| `vpc_cidr_ranges` | 4 | `[]` | VPC subnet CIDR ranges. Auto-discovered when empty. |
| `vpc_sc_dry_run` | 4 | `true` | Log violations without blocking. Set `false` to enforce. |
| `organization_id` | 4 | `""` | GCP Organization ID. Auto-discovered when empty. |
| `enable_audit_logging` | 4 | `false` | Enables detailed Cloud Audit Logs. |

### C. Binary Authorization

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_binary_authorization` | 7 | `false` | Enforces image attestation before deployment. |

---

## 6. Environment Variables & Secrets

| Variable | Group | Default | Description |
|---|---|---|---|
| `environment_variables` | 5 | `{}` | Plain-text environment variables. Module-managed vars (`OPENCLAW_STATE_DIR`, `XDG_CONFIG_HOME`, `NODE_ENV`, `NODE_OPTIONS`, `PORT`, `SKILLS_REPO_URL`, `SKILLS_REPO_REF`) always take precedence. |
| `secret_environment_variables` | 5 | `{}` | Additional Secret Manager references (env var name → secret name). Anthropic, Telegram, and Slack credentials are managed automatically via `OpenClaw_Common`. |
| `secret_propagation_delay` | 5 | `30` | Seconds to wait after secret creation. Valid range: 0–300. |
| `secret_rotation_period` | 5 | `"2592000s"` | Secret Manager rotation notification period (30 days). |
| `enable_auto_password_rotation` | 5 | `false` | Not applicable for OpenClaw (no database). |
| `rotation_propagation_delay_sec` | 5 | `90` | Seconds to wait after rotation before restarting the service. |

---

## 7. CI/CD & Delivery

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 7 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 7 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 7 | `""` | GitHub PAT. Sensitive. |
| `github_app_installation_id` | 7 | `""` | GitHub App installation ID (preferred for org repos). |
| `cicd_trigger_config` | 7 | `{ branch_pattern = "^main$" }` | Advanced trigger config. |
| `enable_cloud_deploy` | 7 | `false` | Upgrades to a Cloud Deploy pipeline. Requires `enable_cicd_trigger`. |
| `cloud_deploy_stages` | 7 | `[dev, staging, prod(approval)]` | Ordered Cloud Deploy promotion stages. |

---

## 8. Backup & Maintenance

OpenClaw has no database — backup settings are present for interface compatibility with `App_CloudRun`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 6 | `"0 2 * * *"` | Cron expression for automated workspace backup. OpenClaw state lives in GCS and is natively durable. |
| `backup_retention_days` | 6 | `7` | Days to retain backup files. |
| `enable_backup_import` | 6 | `false` | Triggers a one-time workspace import on apply. |
| `backup_source` | 6 | `"gcs"` | Import source: `"gcs"` or `"gdrive"`. |
| `backup_format` | 6 | `"tar"` | Import format: `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

---

## 9. Observability & Health

OpenClaw exposes `/health` on port 8080. All probes target this path.

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 13 | `{ enabled=true, type="HTTP", path="/health", initial_delay_seconds=20, timeout_seconds=5, period_seconds=5, failure_threshold=24 }` | Passed to `OpenClaw_Common`. 20s initial delay and 24-attempt threshold give ~2 minutes for GCS Fuse mount and Node.js startup. |
| `liveness_probe` | 13 | `{ enabled=true, type="HTTP", path="/health", initial_delay_seconds=30, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Passed to `OpenClaw_Common`. |
| `startup_probe_config` | 13 | `{ enabled=true }` | Structured startup probe passed directly to `App_CloudRun`. |
| `health_check_config` | 13 | `{ enabled=true }` | Structured liveness probe passed directly to `App_CloudRun`. |
| `uptime_check_config` | 13 | `{ enabled=true, path="/health" }` | Cloud Monitoring uptime check from multiple global locations. |
| `alert_policies` | 13 | `[]` | Cloud Monitoring metric alert policies. |

---

## 10. Jobs & Scheduled Tasks

OpenClaw has no default initialization job — no database setup is required.

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 8 | `[]` | Cloud Run jobs executed once during deployment for custom workspace seeding. No default job. |
| `cron_jobs` | 8 | `[]` | Recurring Cloud Run jobs triggered by Cloud Scheduler. |
| `enable_custom_sql_scripts` | 8 | `false` | Not applicable for OpenClaw. |
| `custom_sql_scripts_bucket` | 8 | `""` | Not used. |
| `custom_sql_scripts_path` | 8 | `""` | Not used. |
| `custom_sql_scripts_use_root` | 8 | `false` | Not used. |

---

## 11. Platform-Managed Behaviours

The following behaviours are applied automatically by `OpenClaw_CloudRun` regardless of variable values.

| Behaviour | Implementation | Detail |
|---|---|---|
| **No database** | `enable_redis = false`, `database_type` not exposed | OpenClaw has no Cloud SQL dependency. These are hard-coded in `main.tf`. |
| **CPU always allocated** | `cpu_always_allocated = true` in `main.tf` | Required for WebSocket connections and async agent operations. Cannot be overridden. |
| **Gen2 execution environment** | `execution_environment = "gen2"` default | Required for GCS Fuse. Do not change to `"gen1"`. |
| **Custom image build** | `OpenClaw_Common` sets `image_source = "custom"` | Always builds from `ghcr.io/openclaw/openclaw:<version>` with the custom `entrypoint.sh` layered on top. |
| **GCS workspace at `/data`** | `OpenClaw_Common` appends `openclaw-data` to `gcs_volumes` | The `<prefix>-storage` bucket is always mounted at `/data` with `uid=1000,gid=1000`. |
| **State dir on local disk** | `OPENCLAW_STATE_DIR=/tmp/openclaw` | Prevents npm staging failures caused by GCS Fuse's lack of hard-link support. Agent workspace and agent state are still on `/data`. |
| **Internal ingress by default** | `ingress_settings = "internal"` default | The gateway is designed to be fronted by a router. Set to `"all"` for direct public access. |
| **Anthropic secret always created** | `OpenClaw_Common` creates `<prefix>-anthropic-api-key` unconditionally | The secret resource is always created; the secret version is only written when `anthropic_api_key` is non-empty. |
| **Skills sync on startup** | `entrypoint.sh` clones or updates `SKILLS_REPO_URL` | Runs on every container start. Non-fatal — the gateway starts even if the clone fails. |
| **Config regenerated on startup** | `entrypoint.sh` always overwrites `openclaw.json` | Ensures Terraform-managed env vars always win over stale values on the GCS volume. |
| **Scripts directory** | `scripts_dir = abspath("${module.openclaw_app.path}/scripts")` | Points to `OpenClaw_Common/scripts`. |

---

## 12. Variable Reference

Complete variable reference with UIMeta group assignments.

| Variable | Group | Default |
|---|---|---|
| `module_description` | 0 | *(OpenClaw CloudRun description)* |
| `module_documentation` | 0 | `"https://docs.radmodules.dev/docs/applications/openclaw"` |
| `module_dependency` | 0 | `["Services_GCP"]` |
| `module_services` | 0 | *(GCP service list)* |
| `credit_cost` | 0 | `100` |
| `require_credit_purchases` | 0 | `true` |
| `enable_purge` | 0 | `true` |
| `public_access` | 0 | `false` |
| `deployment_id` | 0 | `""` |
| `resource_creator_identity` | 0 | `"rad-module-creator@..."` |
| `project_id` | 1 | *(required)* |
| `tenant_deployment_id` | 1 | `"demo"` |
| `support_users` | 1 | `[]` |
| `resource_labels` | 1 | `{}` |
| `application_name` | 2 | `"openclaw"` |
| `application_display_name` | 2 | `"OpenClaw Gateway"` |
| `description` | 2 | `"OpenClaw AI Gateway..."` |
| `application_version` | 2 | `"latest"` |
| `deploy_application` | 3 | `true` |
| `cpu_limit` | 3 | `"2000m"` |
| `memory_limit` | 3 | `"2Gi"` |
| `min_instance_count` | 3 | `0` |
| `max_instance_count` | 3 | `1` |
| `container_port` | 3 | `8080` |
| `execution_environment` | 3 | `"gen2"` |
| `cpu_always_allocated` | 3 | `true` |
| `timeout_seconds` | 3 | `3600` |
| `enable_cloudsql_volume` | 3 | `false` |
| `service_annotations` | 3 | `{}` |
| `service_labels` | 3 | `{}` |
| `enable_image_mirroring` | 3 | `true` |
| `container_protocol` | 3 | `"http1"` |
| `cloudsql_volume_mount_path` | 3 | `"/cloudsql"` |
| `traffic_split` | 3 | `[]` |
| `max_revisions_to_retain` | 3 | `7` |
| `ingress_settings` | 4 | `"internal"` |
| `vpc_egress_setting` | 4 | `"PRIVATE_RANGES_ONLY"` |
| `enable_iap` | 4 | `false` |
| `iap_authorized_users` | 4 | `[]` |
| `iap_authorized_groups` | 4 | `[]` |
| `enable_vpc_sc` | 4 | `false` |
| `vpc_cidr_ranges` | 4 | `[]` |
| `vpc_sc_dry_run` | 4 | `true` |
| `organization_id` | 4 | `""` |
| `enable_audit_logging` | 4 | `false` |
| `environment_variables` | 5 | `{}` |
| `secret_environment_variables` | 5 | `{}` |
| `secret_propagation_delay` | 5 | `30` |
| `secret_rotation_period` | 5 | `"2592000s"` |
| `enable_auto_password_rotation` | 5 | `false` |
| `rotation_propagation_delay_sec` | 5 | `90` |
| `backup_schedule` | 6 | `"0 2 * * *"` |
| `backup_retention_days` | 6 | `7` |
| `enable_backup_import` | 6 | `false` |
| `backup_source` | 6 | `"gcs"` |
| `backup_format` | 6 | `"tar"` |
| `enable_cicd_trigger` | 7 | `false` |
| `github_repository_url` | 7 | `""` |
| `github_token` | 7 | `""` |
| `github_app_installation_id` | 7 | `""` |
| `cicd_trigger_config` | 7 | `{ branch_pattern = "^main$" }` |
| `enable_cloud_deploy` | 7 | `false` |
| `cloud_deploy_stages` | 7 | `[dev, staging, prod(approval)]` |
| `enable_binary_authorization` | 7 | `false` |
| `enable_custom_sql_scripts` | 8 | `false` |
| `custom_sql_scripts_bucket` | 8 | `""` |
| `custom_sql_scripts_path` | 8 | `""` |
| `custom_sql_scripts_use_root` | 8 | `false` |
| `initialization_jobs` | 8 | `[]` |
| `cron_jobs` | 8 | `[]` |
| `enable_cloud_armor` | 9 | `false` |
| `admin_ip_ranges` | 9 | `[]` |
| `application_domains` | 9 | `[]` |
| `enable_cdn` | 9 | `false` |
| `max_images_to_retain` | 9 | `7` |
| `delete_untagged_images` | 9 | `true` |
| `image_retention_days` | 9 | `30` |
| `create_cloud_storage` | 10 | `true` |
| `storage_buckets` | 10 | `[]` |
| `enable_nfs` | 10 | `false` |
| `nfs_mount_path` | 10 | `"/mnt/nfs"` |
| `nfs_instance_name` | 10 | `""` |
| `nfs_instance_base_name` | 10 | `"app-nfs"` |
| `gcs_volumes` | 10 | `[]` |
| `manage_storage_kms_iam` | 10 | `false` |
| `enable_artifact_registry_cmek` | 10 | `false` |
| `startup_probe` | 13 | `{ path="/health", initial_delay_seconds=20, failure_threshold=24, ... }` |
| `liveness_probe` | 13 | `{ path="/health", initial_delay_seconds=30, failure_threshold=3, ... }` |
| `startup_probe_config` | 13 | `{ enabled=true }` |
| `health_check_config` | 13 | `{ enabled=true }` |
| `uptime_check_config` | 13 | `{ enabled=true, path="/health" }` |
| `alert_policies` | 13 | `[]` |
| `skills_repo_url` | 14 | `""` |
| `skills_repo_ref` | 14 | `"main"` |
| `anthropic_api_key` | 14 | `""` |
| `enable_telegram` | 14 | `false` |
| `telegram_bot_token` | 14 | `""` |
| `telegram_webhook_secret` | 14 | `""` |
| `enable_slack` | 14 | `false` |
| `slack_bot_token` | 14 | `""` |
| `slack_signing_secret` | 14 | `""` |

---

## 13. Outputs

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Cloud Run service HTTPS URL. |
| `service_location` | GCP region of the Cloud Run service. |
| `stage_services` | Map of stage names to Cloud Run service details (for Cloud Deploy). |
| `storage_buckets` | All provisioned GCS buckets including the workspace bucket. |
| `network_name` | VPC network name. |
| `network_exists` | Whether the VPC network exists. |
| `regions` | Available regions in the VPC. |
| `nfs_server_ip` | NFS server internal IP (sensitive). Empty when `enable_nfs = false`. |
| `nfs_mount_path` | NFS mount path in containers. |
| `nfs_share_path` | NFS share path on server. |
| `container_image` | Container image URI used by the service. |
| `container_registry` | Artifact Registry repository name. |
| `monitoring_enabled` | Whether Cloud Monitoring is configured. |
| `monitoring_notification_channels` | Monitoring notification channel names. |
| `uptime_check_names` | Uptime check configuration names. |
| `deployment_id` | Unique deployment identifier. |
| `tenant_id` | Tenant identifier. |
| `resource_prefix` | Resource naming prefix (`app<name><tenant><id>`). |
| `project_id` | GCP project ID. |
| `project_number` | GCP project number. |
| `initialization_jobs` | Created initialization job names. |
| `nfs_setup_job` | NFS setup job name. |
| `deployment_summary` | Summary of the deployment configuration. |
| `cicd_enabled` | Whether CI/CD pipeline is enabled. |
| `github_repository_url` | GitHub repository URL connected for CI/CD. |
| `github_repository_owner` | GitHub repository owner/organization. |
| `github_repository_name` | GitHub repository name. |
| `artifact_registry_repository` | Artifact Registry repository. |
| `cloudbuild_trigger_name` | Cloud Build trigger name. |
| `cloudbuild_trigger_id` | Cloud Build trigger ID. |
| `cicd_configuration` | CI/CD pipeline configuration details. |

---

## 14. Configuration Examples

### Basic Deployment (internal agent)

```hcl
project_id           = "my-gcp-project"
tenant_deployment_id = "alice"
application_name     = "openclaw"

cpu_limit    = "2000m"
memory_limit = "2Gi"

min_instance_count = 1
max_instance_count = 1

ingress_settings = "internal"

anthropic_api_key = "sk-ant-..."
```

### Deployment with Telegram Integration

```hcl
project_id           = "my-gcp-project"
tenant_deployment_id = "bob"
application_name     = "openclaw"

cpu_limit    = "2000m"
memory_limit = "2Gi"

ingress_settings = "internal"

anthropic_api_key = "sk-ant-..."

enable_telegram         = true
telegram_bot_token      = "123456:ABCdef..."
telegram_webhook_secret = "a1b2c3d4..."  # openssl rand -hex 32

skills_repo_url = "https://github.com/my-org/openclaw-skills"
skills_repo_ref = "main"
```
