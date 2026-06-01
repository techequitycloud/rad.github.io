---
title: "LibreChat on Google Cloud Run"
sidebar_label: "LibreChat CloudRun"
---

# LibreChat on Google Cloud Run

This document provides a comprehensive reference for the `modules/LibreChat_CloudRun` Terraform module. It covers architecture, IAM, configuration variables, LibreChat-specific behaviours, and operational patterns for deploying LibreChat on Google Cloud Run (v2).

---

## 1. Module Overview

LibreChat is an open-source AI chat interface with 20,000+ GitHub stars that replicates and extends the ChatGPT experience across 20+ LLM providers (OpenAI, Anthropic, Google Gemini, Mistral, Groq, Ollama, and many more). `LibreChat CloudRun` is a **wrapper module** built on top of `App CloudRun`. It uses `App CloudRun` for all GCP infrastructure provisioning and injects LibreChat-specific application configuration, secrets, and storage via `LibreChat Common`.

**Key Capabilities:**
*   **Compute**: Cloud Run v2 (Gen2), Node.js container, 2 vCPU / 2 Gi by default. Configurable min/max instances; `min_instance_count = 1` by default to eliminate cold starts for a chat application.
*   **Database**: MongoDB — either MongoDB Atlas, self-hosted, or **GCP Firestore with MongoDB compatibility** (auto-provisioned when no `mongodb_uri` is supplied). No Cloud SQL is provisioned.
*   **Security**: Auto-generated JWT secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`), credential encryption keys (`CREDS_KEY`, `CREDS_IV`), and MongoDB URI all stored in Secret Manager. Inherits Cloud Armor WAF, IAP, Binary Authorization, and VPC Service Controls from `App CloudRun`.
*   **Storage**: GCS bucket for file uploads (`librechat-uploads`); optional GCS Fuse mounts and NFS.
*   **Redis**: Optional Redis session management and message queuing. Required for multi-instance deployments to avoid session inconsistency.
*   **CI/CD**: Defaults to `prebuilt` image from GHCR (`ghcr.io/danny-avila/librechat`), mirrored to Artifact Registry. Cloud Build custom image pipeline and Cloud Deploy optional.
*   **Reliability**: Health probes target `/` (LibreChat's root path) with generous initial delay to allow MongoDB connection and asset compilation on first boot.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 2 | `string` | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `list(string)` | `[]` | Email recipients for monitoring alerts. |
| `resource_labels` | 2 | `map(string)` | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `string` | `'librechat'` | Base resource name. Do not change after initial deployment. |
| `application_display_name` | 3 | `string` | `'LibreChat AI Chat'` | Human-readable name shown in the GCP Console. |
| `application_description` | 3 | `string` | `'LibreChat - Open-source AI Chat Interface...'` | Cloud Run service description. |
| `application_version` | 3 | `string` | `'latest'` | LibreChat image version tag. Increment to deploy a new release. |

**Wrapper architecture:** `LibreChat CloudRun` calls `LibreChat Common` to build an `application_config` object containing LibreChat-specific environment variables, probe configuration, MongoDB secret references, and the `librechat-uploads` GCS bucket. `module_secret_env_vars` carries the auto-generated JWT and credential secrets. `module_env_vars` carries `USE_REDIS` and `REDIS_URI` when Redis is enabled. `scripts_dir` is resolved to `abspath("${module.librechat_app.path}/scripts")` at apply time.

**MongoDB note:** LibreChat uses **MongoDB**, not Cloud SQL. `database_type = "NONE"` is fixed and no Cloud SQL instance is provisioned. `LibreChat Common` auto-provisions a Firestore database with MongoDB compatibility if neither `mongodb_uri` nor `firestore_mongodb_host` is supplied.

---

## 2. IAM & Access Control

`LibreChat CloudRun` delegates all IAM provisioning to `App CloudRun`. The Cloud Run SA, Cloud Build SA, IAP service agent, and password rotation role sets are identical to those in App CloudRun.

**Application-level secrets:** `LibreChat Common` auto-generates four application secrets at deploy time:
- `CREDS_KEY` — 32-byte hex key for AES-GCM encryption of saved AI provider credentials.
- `CREDS_IV` — 16-byte hex IV paired with `CREDS_KEY`.
- `JWT_SECRET` — Signs user access tokens. Rotating invalidates all active sessions.
- `JWT_REFRESH_SECRET` — Signs long-lived refresh tokens.
- `MONGO_URI` — MongoDB connection string (explicit or Firestore-constructed). Stored as a secret and injected via Secret Manager.

All secrets are injected natively by Cloud Run at revision start. Plaintext is never written to Terraform state.

**Firestore SCRAM user job:** When Firestore MongoDB compatibility is used (auto-provisioned path), `LibreChat Common` injects a `init-firestore-scram-user` Cloud Run Job that creates or updates the SCRAM user using `mongosh` with GCP Workload Identity OIDC authentication against the Firestore admin database.

**Additional Cloud Run SA role:** `roles/datastore.owner` is granted to the Cloud Run service account to allow the application to read and write Firestore data (for session or optional Firestore-backed features).

**30-second secret propagation delay:** After secrets are created, a `time_sleep` resource waits 30 seconds for Secret Manager global replication to complete before the Cloud Run service is deployed.

---

## 3. Core Service Configuration

### A. Compute (Cloud Run)

LibreChat is a Node.js application that loads AI provider configurations, connects to MongoDB, and optionally connects to Redis on startup. The module exposes all scaling and resource variables with production-ready defaults.

**Scale-to-zero is disabled by default** (`min_instance_count = 1`). LibreChat cold starts can take 15–30 seconds due to MongoDB connection establishment and asset loading. Set `min_instance_count = 0` to enable scale-to-zero if cost savings outweigh cold start latency.

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment (secrets, storage, IAM). |
| `container_image_source` | 4 | `'prebuilt'` | `'prebuilt'` deploys official LibreChat from GHCR. `'custom'` builds via Cloud Build. |
| `container_image` | 4 | `'ghcr.io/danny-avila/librechat'` | Override image URI. |
| `container_resources` | 4 | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | CPU and memory per instance. 2 vCPU / 2 Gi minimum. |
| `container_port` | 4 | `3080` | LibreChat's native port. |
| `execution_environment` | 4 | `'gen2'` | Gen2 required for NFS mounts and GCS Fuse. |
| `timeout_seconds` | 4 | `600` | Max request duration. Increase for long-running AI responses or file processing. |
| `enable_cloudsql_volume` | 4 | `false` | Must remain `false` — LibreChat does not use Cloud SQL. |
| `min_instance_count` | 4 | `1` | Minimum instances. Set to 0 for scale-to-zero. |
| `max_instance_count` | 4 | `5` | Maximum instances. |
| `traffic_split` | 4 | `[]` | Canary/blue-green traffic allocation across revisions. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |
| `enable_image_mirroring` | 4 | `true` | Mirrors the LibreChat image to Artifact Registry. Recommended. |
| `container_build_config` | 4 | `{ enabled = false }` | Cloud Build config when `container_image_source = 'custom'`. |

### B. MongoDB Database

LibreChat requires MongoDB. The module supports three connection modes:

1. **Explicit URI** — Provide `mongodb_uri` directly (MongoDB Atlas, self-hosted, etc.).
2. **Firestore manual** — Provide `firestore_mongodb_host`, `firestore_mongodb_username`, and `firestore_mongodb_password`; the MONGO_URI is constructed automatically.
3. **Firestore auto** — Leave all three empty; `LibreChat Common` discovers or creates a Firestore database with MongoDB compatibility in the GCP project.

| Variable | Group | Default | Description |
|---|---|---|---|
| `mongodb_uri` | 3 | `""` | MongoDB connection URI. Stored in Secret Manager. Leave empty to use Firestore auto-discovery. |
| `firestore_mongodb_host` | 1 | `""` | Firestore MongoDB compatibility endpoint host. Obtain from GCP Console → Firestore → Connect. |
| `firestore_mongodb_database` | 12 | `'LibreChat'` | Firestore database ID / MongoDB database name. |
| `firestore_mongodb_username` | 12 | `""` | SCRAM username for Firestore MongoDB authentication. Defaults to `'librechat'`. |
| `firestore_mongodb_password` | 12 | `""` | SCRAM password. Auto-generated and stored in Secret Manager when not set. Sensitive. |
| `database_type` | 12 | `'NONE'` | Fixed. Must remain `'NONE'` — no Cloud SQL is provisioned. |

> **Warning:** A plan-time `precondition` in `LibreChat Common` fails if no MongoDB source is reachable at apply time, preventing deployment with a clear error message rather than a cryptic runtime failure.

### C. LibreChat Application Settings

| Variable | Group | Default | Description |
|---|---|---|---|
| `app_title` | 3 | `'LibreChat'` | Title shown in the UI header and browser tab. White-label with your brand. |
| `allow_registration` | 3 | `true` | Allow new users to self-register. Set to `false` after creating the initial admin account. |
| `allow_social_login` | 3 | `false` | Enable OAuth social login (Google, GitHub, Discord). Requires additional `librechat.yaml` configuration. |

### D. Storage (GCS & NFS)

`LibreChat Common` automatically provisions a dedicated `librechat-uploads` GCS bucket for user file uploads. This bucket is separate from any buckets in `storage_buckets`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | 11 | `true` | Set `false` to skip additional bucket creation. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Additional GCS buckets beyond the auto-provisioned uploads bucket. |
| `enable_nfs` | 11 | `false` | Provisions a Cloud Filestore NFS instance and mounts it. Requires `gen2`. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Container path where the NFS share is mounted. |
| `gcs_volumes` | 11 | `[]` | GCS buckets to mount via GCS Fuse (requires `gen2`). |
| `manage_storage_kms_iam` | 11 | `false` | Creates CMEK KMS key and enables CMEK on all storage buckets. |
| `enable_artifact_registry_cmek` | 11 | `false` | Creates Artifact Registry KMS key for at-rest image encryption. |

### E. Networking

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — public internet; `'internal'` — VPC only; `'internal-and-cloud-load-balancing'` — forces traffic through the HTTPS LB. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` routes only RFC 1918 traffic via VPC. |
| `region` | 1 | `'us-central1'` | GCP region. Auto-discovered from the VPC subnet when `Services GCP` is present. |

### F. Initialization Jobs

The Firestore SCRAM init job is auto-injected by `LibreChat Common` when Firestore is in use. Additional custom initialization jobs can be appended:

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 12 | `[]` | One-shot Cloud Run Jobs appended after the auto-injected Firestore SCRAM job. LibreChat auto-migrates its MongoDB schema on first start. |
| `cron_jobs` | 13 | `[]` | Recurring jobs triggered by Cloud Scheduler. |
| `additional_services` | 13 | `[]` | Additional Cloud Run services deployed alongside LibreChat. |

---

## 4. Advanced Security

### A. AI Provider API Keys

API keys for AI providers are **not** managed by this module. Inject them via `secret_environment_variables` referencing pre-existing Secret Manager secrets:

```hcl
secret_environment_variables = {
  OPENAI_API_KEY    = "openai-api-key"       # Secret Manager secret name
  ANTHROPIC_API_KEY = "anthropic-api-key"
  GOOGLE_API_KEY    = "google-ai-api-key"
}
```

Create secrets before deploying:
```bash
echo -n "sk-..." | gcloud secrets create openai-api-key --data-file=-
```

| Variable | Group | Default | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Map of env var name → Secret Manager secret name. Resolved at runtime; never stored in state. |
| `environment_variables` | 6 | `{}` | Plain-text env vars for non-sensitive LibreChat configuration (feature flags, log levels, etc.). |
| `secret_rotation_period` | 6 | `'2592000s'` | Secret Manager rotation notification frequency. Default: 30 days. |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation before dependent resources proceed. |

### B. Cloud Armor WAF

When `enable_cloud_armor = true`, a Global HTTPS Load Balancer with a Cloud Armor WAF policy is provisioned in front of Cloud Run.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. Required for custom domains, CDN, and DDoS protection. |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | 10 | `[]` | Custom domain names with Google-managed SSL certificates. |
| `enable_cdn` | 10 | `false` | Enables Cloud CDN on the HTTPS LB backend. |

### C. Identity-Aware Proxy (IAP)

When `enable_iap = true`, Google identity authentication is required before requests reach LibreChat. Useful for internal AI assistant deployments.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Enables IAP natively on the Cloud Run service. |
| `iap_authorized_users` | 5 | `[]` | Users/service accounts granted access. Format: `'user:email'`. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted access. Format: `'group:name@example.com'`. |

### D. Binary Authorization

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Enforces image attestation. Requires a Binary Authorization policy and attestor pre-configured. |

### E. VPC Service Controls

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Registers module API calls within the project's VPC-SC perimeter. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC network access level. |
| `vpc_sc_dry_run` | 22 | `true` | Logs violations without blocking. Set `false` to enforce. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. Required when the project is under a folder. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs (DATA_READ, DATA_WRITE, ADMIN_READ). |

---

## 5. Redis Integration

Redis is **optional** but **recommended for all multi-instance deployments**. Without Redis, LibreChat sessions are in-memory per instance, causing session loss when a request is routed to a different instance.

When `enable_redis = true` and `redis_host` is set, `LibreChat CloudRun` injects `USE_REDIS = "true"` and `REDIS_URI` into the Cloud Run environment. Setting `REDIS_URI` alone is not sufficient — `USE_REDIS = "true"` must also be set.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 21 | `false` | Enables Redis for LibreChat session management and message queuing. |
| `redis_host` | 21 | `""` | Redis server hostname or IP. Use a Cloud Memorystore instance for production. |
| `redis_port` | 21 | `6379` | Redis server TCP port. |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive — never stored in state. |

---

## 6. CI/CD & Delivery

### A. Cloud Build Triggers

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT. Required on first apply. Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID (preferred for org repos). |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced trigger config: `branch_pattern`, `included_files`, `ignored_files`, `substitutions`. |

### B. Cloud Deploy Pipeline

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy pipeline. Requires `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Ordered promotion stages. |

---

## 7. Reliability & Observability

### A. Health Probes

LibreChat does not expose a dedicated health endpoint. Both probes target `/` (LibreChat's root path).

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ enabled=true, path="/", initial_delay_seconds=30, failure_threshold=10, ... }` | Startup probe. Generous failure threshold accommodates MongoDB connection time. |
| `liveness_probe` | 14 | `{ enabled=true, path="/", initial_delay_seconds=60, failure_threshold=3, ... }` | Liveness probe. Container restarted after consecutive failures. |
| `startup_probe_config` | 14 | `{ enabled=true, path="/", initial_delay_seconds=30, failure_threshold=10, ... }` | Alternative structured startup probe config. |
| `health_check_config` | 14 | `{ enabled=true, path="/", initial_delay_seconds=60, ... }` | Alternative structured liveness probe config. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/" }` | Cloud Monitoring uptime check from multiple global locations. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |

### B. Backup & Maintenance

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated NFS backup jobs. |
| `backup_retention_days` | 7 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 7 | `false` | Not applicable for LibreChat (MongoDB, not Cloud SQL). |

### C. Artifact Registry Image Management

| Variable | Group | Default | Description |
|---|---|---|---|
| `max_images_to_retain` | 10 | `7` | Maximum number of recent container images to keep in Artifact Registry. Set `0` to disable. |
| `delete_untagged_images` | 10 | `true` | Automatically deletes untagged images from Artifact Registry. |
| `image_retention_days` | 10 | `30` | Days after which images are eligible for deletion. Set `0` to disable. |

---

## 8. Platform-Managed Behaviours

The following behaviours are applied automatically regardless of variable values.

| Behaviour | Implementation | Detail |
|---|---|---|
| **MongoDB only — no Cloud SQL** | `database_type = "NONE"` fixed | No Cloud SQL instance is provisioned. Setting `database_type` to any SQL engine provisions an unused instance. |
| **Firestore auto-provisioning** | `LibreChat Common` creates ENTERPRISE Firestore DB | When `mongodb_uri` is empty and no `firestore_mongodb_host` is set, a Firestore ENTERPRISE DB is created automatically. |
| **SCRAM user init job** | Auto-injected by `LibreChat Common` | Creates/updates the MongoDB SCRAM user in Firestore using workload identity OIDC. No-op when an explicit `mongodb_uri` is supplied. |
| **JWT/credential secrets auto-generated** | `LibreChat Common` resources | `CREDS_KEY`, `CREDS_IV`, `JWT_SECRET`, `JWT_REFRESH_SECRET` generated on first apply. Rotating invalidates all active sessions. |
| **MONGO_URI always present in secret refs** | `LibreChat Common` secret_ids | The `MONGO_URI` secret reference is always included to prevent silent removal from Cloud Run spec during update runs. |
| **USE_REDIS + REDIS_URI injection** | `module_env_vars` in `librechat.tf` | When `enable_redis = true` and `redis_host != ""`, both env vars are injected. Setting `REDIS_URI` alone via `environment_variables` does not activate Redis in LibreChat. |
| **Trust proxy forced** | `TRUST_PROXY = "1"` hardcoded | Required for Express.js to read `X-Forwarded-For` correctly behind Cloud Run's ingress and to set Secure cookies over HTTPS. |
| **NODE_ENV set to production** | `NODE_ENV = "production"` hardcoded | Ensures LibreChat runs with production optimisations. |
| **GCS uploads bucket** | `librechat-uploads` bucket provisioned by `LibreChat Common` | Dedicated bucket for user file uploads, separate from `storage_buckets`. |
| **datastore.owner role** | `additional_cloudrun_sa_roles` in `main.tf` | Cloud Run SA granted `roles/datastore.owner` for Firestore access. |
| **Scripts directory** | `scripts_dir` from `LibreChat Common` | Initialization scripts sourced from `LibreChat Common`, not the deployment directory. |

---

## 9. Variable Reference

All user-configurable variables, sorted by UI group.

| Variable | Group | Default | Description |
|---|---|---|---|
| `module_description` | 0 | (LibreChat platform text) | Platform metadata: module description. |
| `module_documentation` | 0 | (docs URL) | Platform metadata: documentation URL. |
| `module_dependency` | 0 | `['Services GCP']` | Platform metadata: required modules. |
| `module_services` | 0 | (GCP service list) | Platform metadata: GCP services consumed. |
| `credit_cost` | 0 | `50` | Platform metadata: deployment credit cost. |
| `require_credit_purchases` | 0 | `false` | Platform metadata: enforces credit balance check. |
| `enable_purge` | 0 | `true` | Permits full deletion of module resources on destroy. |
| `public_access` | 0 | `false` | Platform catalogue visibility. |
| `shared_users` | 0 | `[]` | Users who can access regardless of `public_access`. Actively enforced by the platform. |
| `deployment_id` | 0 | `""` | Deployment ID suffix. Auto-generated if empty. |
| `resource_creator_identity` | 0 | (platform SA) | Service account used by Terraform to manage resources. |
| `impersonation_service_account` | 0 | `""` | SA to impersonate for shell script API calls. |
| `project_id` | 1 | — | GCP project ID. **Required.** |
| `region` | 1 | `'us-central1'` | GCP region. Auto-discovered from VPC subnets. |
| `firestore_mongodb_host` | 1 | `""` | Firestore MongoDB endpoint. Leave empty for auto-discovery. |
| `tenant_deployment_id` | 2 | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `[]` | Email addresses for monitoring alerts. |
| `resource_labels` | 2 | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `'librechat'` | Base resource name. Do not change after initial deployment. |
| `application_display_name` | 3 | `'LibreChat AI Chat'` | Human-readable name shown in the GCP Console. |
| `application_description` | 3 | `'LibreChat - Open-source AI Chat Interface...'` | Service description. |
| `application_version` | 3 | `'latest'` | LibreChat container image tag. |
| `mongodb_uri` | 3 | `""` | MongoDB connection URI. Sensitive. Leave empty for Firestore auto-discovery. |
| `app_title` | 3 | `'LibreChat'` | Title shown in the LibreChat UI. |
| `allow_registration` | 3 | `true` | Allow self-registration. Set `false` after creating admin account. |
| `allow_social_login` | 3 | `false` | Enable OAuth social login providers. |
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 4 | `'prebuilt'` | `'prebuilt'` (GHCR) or `'custom'` (Cloud Build). |
| `container_image` | 4 | `'ghcr.io/danny-avila/librechat'` | Container image URI. |
| `container_build_config` | 4 | `{ enabled = false }` | Cloud Build config for custom images. |
| `enable_image_mirroring` | 4 | `true` | Mirrors LibreChat image to Artifact Registry. |
| `container_resources` | 4 | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | CPU and memory per instance. |
| `min_instance_count` | 4 | `1` | Minimum instances. Set to 0 for scale-to-zero. |
| `max_instance_count` | 4 | `5` | Maximum instances. |
| `container_port` | 4 | `3080` | LibreChat's native HTTP port. |
| `container_protocol` | 4 | `'http1'` | `'http1'` or `'h2c'`. |
| `execution_environment` | 4 | `'gen2'` | Gen2 required for NFS mounts and GCS Fuse. |
| `timeout_seconds` | 4 | `600` | Max request duration in seconds. Range: 0–3600. |
| `enable_cloudsql_volume` | 4 | `false` | Must remain `false`. LibreChat does not use Cloud SQL. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Interface compatibility only. Not used. |
| `traffic_split` | 4 | `[]` | Canary/blue-green traffic allocation. All entries must sum to 100. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |
| `max_revisions_to_retain` | 4 | `7` | Maximum Cloud Run revisions to keep. Not referenced in this module. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'`, or `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` or `'ALL_TRAFFIC'`. |
| `enable_iap` | 5 | `false` | Enables IAP on the Cloud Run service. |
| `iap_authorized_users` | 5 | `[]` | Users/SAs granted IAP access. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted IAP access. |
| `environment_variables` | 6 | `{}` | Plain-text env vars for non-sensitive configuration. |
| `secret_environment_variables` | 6 | `{}` | Secret Manager references for AI provider API keys and other secrets. |
| `secret_rotation_period` | 6 | `'2592000s'` | Secret Manager rotation notification frequency. |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated backups. |
| `backup_retention_days` | 7 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 7 | `false` | Not applicable for LibreChat (no Cloud SQL). |
| `backup_source` | 7 | `'gcs'` | `'gcs'` or `'gdrive'`. Interface compatibility only. |
| `backup_file` | 7 | `'backup.sql'` | Not referenced. Interface compatibility only. |
| `backup_format` | 7 | `'sql'` | Not referenced. Interface compatibility only. |
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT. Required on first apply. Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger config. |
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy progressive delivery pipeline. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Ordered Cloud Deploy promotion stages. |
| `enable_binary_authorization` | 8 | `false` | Enforces image attestation on deployment. |
| `binauthz_evaluation_mode` | 8 | `'ALWAYS_ALLOW'` | Not referenced. Interface compatibility only. |
| `enable_custom_sql_scripts` | 9 | `false` | Must remain `false`. Not applicable for LibreChat. |
| `custom_sql_scripts_bucket` | 9 | `""` | Interface compatibility only. |
| `custom_sql_scripts_path` | 9 | `""` | Interface compatibility only. |
| `custom_sql_scripts_use_root` | 9 | `false` | Interface compatibility only. |
| `enable_cloud_armor` | 10 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | 10 | `[]` | Custom domains with Google-managed SSL certificates. |
| `enable_cdn` | 10 | `false` | Enables Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` | 10 | `7` | Maximum recent container images to keep. Set `0` to disable. |
| `delete_untagged_images` | 10 | `true` | Automatically deletes untagged images from Artifact Registry. |
| `image_retention_days` | 10 | `30` | Days after which images are eligible for deletion. |
| `create_cloud_storage` | 11 | `true` | Set `false` to skip additional bucket creation. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Additional GCS buckets beyond the uploads bucket. |
| `enable_nfs` | 11 | `false` | Provisions NFS shared storage. Requires `gen2`. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Container path where NFS is mounted. |
| `nfs_instance_name` | 9 | `""` | Name of an existing NFS GCE VM. Leave empty to auto-discover. |
| `nfs_instance_base_name` | 9 | `'app-nfs'` | Base name for inline NFS VM. |
| `gcs_volumes` | 11 | `[]` | GCS buckets to mount via GCS Fuse. |
| `manage_storage_kms_iam` | 11 | `false` | Creates CMEK KMS key and enables CMEK on all storage buckets. |
| `enable_artifact_registry_cmek` | 11 | `false` | Creates Artifact Registry KMS key for at-rest image encryption. |
| `database_type` | 12 | `'NONE'` | Must remain `'NONE'`. No Cloud SQL provisioned. |
| `application_database_name` | 12 | `'librechat_db'` | Not referenced. Interface compatibility only. |
| `application_database_user` | 12 | `'librechat_user'` | Not referenced. Interface compatibility only. |
| `database_password_length` | 12 | `32` | Not referenced. Interface compatibility only. |
| `firestore_mongodb_database` | 12 | `'LibreChat'` | Firestore database ID / MongoDB database name. |
| `firestore_mongodb_username` | 12 | `""` | SCRAM username. Defaults to `'librechat'`. |
| `firestore_mongodb_password` | 12 | `""` | SCRAM password. Auto-generated when not set. Sensitive. |
| `enable_auto_password_rotation` | 12 | `false` | Not applicable for LibreChat (no Cloud SQL). |
| `rotation_propagation_delay_sec` | 12 | `90` | Not applicable for LibreChat. |
| `initialization_jobs` | 12 | `[]` | One-shot Cloud Run Jobs. The Firestore SCRAM job is auto-prepended. |
| `cron_jobs` | 13 | `[]` | Recurring scheduled Cloud Run Jobs. |
| `additional_services` | 13 | `[]` | Additional Cloud Run services alongside LibreChat. |
| `startup_probe` | 14 | `{ path="/", initial_delay_seconds=30, failure_threshold=10 }` | Startup probe. |
| `liveness_probe` | 14 | `{ path="/", initial_delay_seconds=60, failure_threshold=3 }` | Liveness probe. |
| `startup_probe_config` | 14 | `{ enabled=true, path="/", initial_delay_seconds=30 }` | Alternative structured startup probe. |
| `health_check_config` | 14 | `{ enabled=true, path="/", initial_delay_seconds=60 }` | Alternative structured liveness probe. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |
| `enable_redis` | 21 | `false` | Enables Redis for session management. Recommended for multi-instance. |
| `redis_host` | 21 | `""` | Redis hostname or IP. |
| `redis_port` | 21 | `6379` | Redis TCP port. |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive. |
| `enable_vpc_sc` | 22 | `false` | Registers API calls within the VPC-SC perimeter. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC. Auto-discovered when empty. |
| `vpc_sc_dry_run` | 22 | `true` | Logs VPC-SC violations without blocking. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs. |

---

## 10. Outputs

| Output | Description |
|---|---|
| `service_name` | Name of the Cloud Run service. |
| `service_url` | Public URL of the LibreChat Cloud Run service. |
| `service_location` | GCP region where the Cloud Run service is deployed. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix used in resource names. |
| `artifact_registry_url` | Artifact Registry URL for the mirrored container image. |
| `storage_buckets` | Created GCS storage buckets. |

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `CREDS_KEY` (auto-generated) | Random 32-byte hex key in Secret Manager | **Critical** | Used for AES-GCM encryption of all saved AI provider credentials (OpenAI keys, Anthropic keys, etc.). Rotating or changing this key after credentials have been saved permanently corrupts all stored provider credentials — they cannot be decrypted and must be re-entered manually by every user. |
| `CREDS_IV` (auto-generated) | Random 16-byte hex IV in Secret Manager | **Critical** | The AES-GCM initialisation vector paired with `CREDS_KEY`. Changing it after first use has the same effect as changing `CREDS_KEY` — all stored credentials are lost. |
| `JWT_SECRET` (auto-generated) | Random secret in Secret Manager | **High** | Used to sign all user access and refresh tokens. Rotating it logs out every active user simultaneously. Plan key rotation during a maintenance window and notify users. |
| `mongodb_uri` | Auto-discovered Firestore MongoDB endpoint | **Critical** | LibreChat requires MongoDB (or Firestore MongoDB compatibility). If neither `mongodb_uri` nor `firestore_mongodb_host` is provided and auto-discovery fails, the container crashes on startup with a MongoDB connection error and serves no traffic. |
| `firestore_mongodb_host` | Auto-discovered | **High** | Manual override of the Firestore host. If set to a wrong value (typo, stale endpoint), all LibreChat data operations fail and the service is non-functional. Use auto-discovery when possible. |
| `enable_cloudsql_volume` | `false` | **Critical** | LibreChat does not use Cloud SQL — must remain `false`. If set to `true`, the Cloud SQL Auth Proxy sidecar is injected unnecessarily. The description in variables.tf explicitly warns that this must stay false. |
| `database_type` | `"NONE"` | **Critical** | LibreChat manages its own MongoDB connection and does not use Cloud SQL. Setting `database_type` to `"POSTGRES"` or `"MYSQL"` provisions an unused Cloud SQL instance and adds cost without benefiting the application. |
| `allow_registration` | `true` | **High** | Leaving registration open on a publicly accessible deployment allows anyone to create an account. Disable after the admin account is created (`allow_registration = false`) or require Google OAuth (`allow_social_login = true`) for organisational accounts only. |
| `allow_social_login` | `false` | **Medium** | Enabling social login without configuring the corresponding OAuth credentials (e.g., `GOOGLE_CLIENT_ID`) causes social login buttons to appear but fail, confusing users. Configure all required OAuth env vars before enabling. |
| `MEILI_MASTER_KEY` (auto-generated) | Random secret in Secret Manager | **High** | MeiliSearch master key. If rotated, all existing search indices require a full rebuild. LibreChat also manages a separate `MEILI_KEY` derived from this. Treat as immutable once the search index is populated. |
| `min_instance_count` | `1` | **High** | LibreChat is a stateful chat application. Scale-to-zero causes cold starts and drops in-flight SSE streaming connections. Set to `1` or more for a reliable chat experience. |
| `timeout_seconds` | `600` | **High** | SSE streaming for long AI responses can exceed several minutes. Low timeouts (e.g., `60`) terminate the stream mid-response. Set to at least `600`; increase further for slow LLM backends. |
| `secret_environment_variables` (AI provider keys) | `{}` | **Critical** | AI provider API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.) must be injected via `secret_environment_variables` referencing Secret Manager. Providing them as plain `environment_variables` exposes them in Cloud Run revision metadata and GCP audit logs. |
| `ingress_settings` | `"all"` | **High** | `"all"` exposes LibreChat to the public internet. Only the application login form protects it. Always pair with `enable_iap = true` for production or restrict to `"internal"`. |
| `enable_iap` | `false` | **High** | Without IAP, access control is application-only. A misconfigured `allow_registration = true` on a public deployment creates a security risk. |
| `USE_REDIS` / `enable_redis` | Depends on module | **Medium** | Without Redis, LibreChat stores session data in memory. Multiple Cloud Run instances each have isolated session state, causing users to lose sessions when requests land on a different instance. Set `USE_REDIS = "true"` and provide `redis_host` for multi-instance deployments. |
| `backup_schedule` | `""` (disabled) | **High** | Without backups, all LibreChat conversation history and user data in MongoDB/Firestore are unprotected. Enable daily backups for production. |
| `execution_environment` | `"gen2"` | **High** | NFS mounts are not supported in gen1. Always use gen2 for NFS-enabled deployments. |
| `gcs_volumes` | Auto-provisioned | **High** | LibreChat stores uploaded files (images, documents shared in chat) in GCS Fuse. Without the `implicit-dirs` mount option, file listings fail and attachments cannot be retrieved. |
| `application_version` | `"latest"` | **Medium** | Unplanned LibreChat upgrades can change the MongoDB schema or break existing API integrations. Pin to a specific release tag in production. |
| `app_title` | `"LibreChat"` | **Low** | Displayed in the browser tab and login screen. Purely cosmetic but worth setting for white-label deployments. |

## Destroying Resources

### Known Deletion Issue: Serverless IPv4 Address Release

When destroying a Cloud Run deployment, you may encounter an error similar to:

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause:** GCP holds serverless IPv4 addresses on the VPC subnet asynchronously after a Cloud Run service is deleted. These addresses are released by GCP approximately **20–30 minutes** after the Cloud Run service is removed.

**Resolution:** Wait 20–30 minutes after the initial destroy attempt, then re-run the destroy command:

```bash
tofu destroy
```
