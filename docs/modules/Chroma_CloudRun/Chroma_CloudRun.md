---
title: "Chroma on Google Cloud Run"
sidebar_label: "Chroma CloudRun"
---

# Chroma on Google Cloud Run

This document provides a comprehensive reference for the `modules/Chroma_CloudRun` Terraform module. It covers architecture, IAM, configuration variables, Chroma-specific behaviours, and operational patterns for deploying Chroma on Google Cloud Run (v2).

---

## 1. Module Overview

Chroma is an AI-native open-source vector database purpose-built for embeddings and similarity search. `Chroma_CloudRun` is a **wrapper module** built on top of `App_CloudRun`. It uses `App_CloudRun` for all GCP infrastructure provisioning and injects Chroma-specific application configuration, an optional authentication token, and storage configuration via `Chroma_Common`.

**Key Capabilities:**
- **Compute**: Cloud Run v2 (Gen2), 1 vCPU / 1 Gi by default. `min_instance_count = 1` to avoid index-loading cold starts. `max_instance_count = 1` — Chroma is a single-writer store.
- **Data Persistence**: Cloud Storage bucket (`<prefix>-data`) mounted at `/data` via GCS FUSE. No Cloud SQL, no Redis.
- **Security**: Optional token authentication via Secret Manager. A plan-time validation blocks public ingress (`ingress_settings = "all"`) unless `enable_auth_token = true`. Inherits Cloud Armor, IAP, Binary Authorization, and VPC-SC from `App_CloudRun`.
- **CI/CD**: Cloud Build image pipeline by default; Cloud Deploy progressive delivery optional.
- **Reliability**: Health probes target `/api/v2/heartbeat`.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `region` | 1 | `string` | `'us-central1'` | GCP region fallback |
| `tenant_deployment_id` | 2 | `string` | `'demo'` | Short suffix appended to all resource names |
| `support_users` | 2 | `list(string)` | `[]` | Email recipients for monitoring alerts |
| `resource_labels` | 2 | `map(string)` | `{}` | Labels applied to all provisioned resources |
| `application_name` | 3 | `string` | `'chroma'` | Base resource name. Do not change after initial deployment. |
| `application_display_name` | 3 | `string` | `'Chroma Vector Database'` | Human-readable name in the GCP Console |
| `description` | 3 | `string` | Chroma description | Cloud Run service description |
| `application_version` | 3 | `string` | `'latest'` | Chroma image tag |

**Wrapper architecture:** `Chroma_CloudRun` calls `Chroma_Common` to build an `application_config` object containing Chroma-specific environment variables, probe configuration, and the storage volume definition. `module_storage_buckets` carries the `<prefix>-data` GCS bucket. `scripts_dir` is resolved to `abspath("${module.chroma_app.path}/scripts")` at apply time.

---

## 2. IAM & Access Control

`Chroma_CloudRun` delegates all IAM provisioning to `App_CloudRun`. The Cloud Run SA, Cloud Build SA, and IAP service agent role sets are identical to those in `App_CloudRun`.

**Auth token:** Unlike most modules, `Chroma_Common` can auto-generate a Chroma authentication token (when `enable_auth_token = true`). The token is stored in Secret Manager as `<prefix>-auth-token` and injected as `CHROMA_SERVER_AUTH_CREDENTIALS`. Applications calling Chroma must include this token in the `Authorization: Bearer <token>` header.

For the complete role tables and IAP details, see the App_CloudRun documentation.

---

## 3. Core Service Configuration

### A. Compute (Cloud Run)

`Chroma_CloudRun` exposes `cpu_limit` and `memory_limit` as dedicated top-level variables. Chroma loads embedding indexes into RAM — size `memory_limit` according to your collection size and index type.

**Single-instance constraint:** `max_instance_count = 1` is strongly recommended. Chroma is a single-writer store — multiple instances against the same GCS FUSE mount will corrupt collections. Scale vertically (increase CPU and memory) rather than horizontally.

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment |
| `cpu_limit` | 4 | `'1000m'` | CPU per instance |
| `memory_limit` | 4 | `'1Gi'` | Memory per instance. Increase for large embedding collections |
| `min_instance_count` | 4 | `1` | Keep at 1+ to avoid cold starts |
| `max_instance_count` | 4 | `1` | Keep at 1 — Chroma is single-writer |
| `container_port` | 4 | `8000` | Chroma REST API port |
| `execution_environment` | 4 | `'gen2'` | Gen2 required for GCS FUSE |
| `cpu_always_allocated` | 4 | `true` | Keep CPU allocated to avoid index load delays between requests |
| `timeout_seconds` | 4 | `300` | Max request duration (0–3600 s). Increase for large batch operations. |
| `enable_cloudsql_volume` | 4 | `false` | Not applicable — Chroma has no SQL database |
| `enable_image_mirroring` | 4 | `true` | Mirror the Chroma image into Artifact Registry |
| `container_protocol` | 4 | `'http1'` | `'http1'` or `'h2c'` |
| `traffic_split` | 4 | `[]` | Canary/blue-green traffic allocation |
| `max_revisions_to_retain` | 4 | `7` | Maximum Cloud Run revisions to keep |
| `service_annotations` | 4 | `{}` | Cloud Run service annotations |
| `service_labels` | 4 | `{}` | Cloud Run service labels |

**Differences from `App_CloudRun` defaults:**

| Variable | `App_CloudRun` | `Chroma_CloudRun` | Reason |
|---|---|---|---|
| `container_port` | `8080` | `8000` | Chroma's native REST API port |
| `ingress_settings` | `'all'` | `'internal'` | Vector databases should not be publicly exposed by default |
| `enable_redis` | `true` | `false` (hard-coded) | Chroma has no Redis dependency |
| `database_type` | configurable | `NONE` (fixed) | Chroma manages its own embedded storage |
| `min_instance_count` | `0` | `1` | Avoid cold start index-loading delays |

### B. Storage (GCS FUSE)

Chroma requires persistent storage for its embedded SQLite database, HNSW index files, and collection metadata. `Chroma_Common` automatically provisions a GCS bucket and mounts it at `/data` via GCS FUSE.

| Variable | Group | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | 11 | `true` | Set `false` to skip GCS bucket creation |
| `storage_buckets` | 11 | `[]` | Additional GCS buckets beyond the auto-provisioned data bucket |
| `gcs_volumes` | 11 | `[]` | Additional GCS FUSE volume mounts |
| `enable_nfs` | 11 | `false` | Mount Cloud Filestore NFS (requires gen2). Chroma uses GCS for storage; enable only for custom init jobs. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | NFS container mount path |
| `manage_storage_kms_iam` | 11 | `false` | Create CMEK KMS key for storage |
| `enable_artifact_registry_cmek` | 11 | `false` | Enable CMEK for Artifact Registry |

The auto-provisioned bucket uses these settings: `storage_class = "STANDARD"`, `versioning_enabled = false`, `public_access_prevention = "enforced"`.

### C. Networking

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'internal'` | Recommended. `'all'` requires `enable_auth_token = true` (plan-time validation). |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` or `'ALL_TRAFFIC'` |

---

## 4. Authentication & Access Control

### A. Chroma Auth Token

The primary Chroma-specific security control. When `enable_auth_token = true`:

- A 32-character alphanumeric token is generated and stored in Secret Manager
- Chroma starts with `CHROMA_SERVER_AUTH_CREDENTIALS` set to the token value
- All API calls must include `Authorization: Bearer <token>` in the request header
- The Python client usage: `chromadb.HttpClient(host=..., headers={"Authorization": "Bearer <token>"})`

**Plan-time guard:** `validation.tf` includes a precondition that prevents deploying with `ingress_settings = "all"` and `enable_auth_token = false` simultaneously. This blocks accidental public exposure of an unauthenticated Chroma instance.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_auth_token` | 3 | `false` | Generate and store authentication token in Secret Manager. Recommended for all non-internal deployments. |

### B. Identity-Aware Proxy (IAP)

When `enable_iap = true`, Cloud Run's native IAP integration is enabled. Google identity authentication is required before requests reach Chroma. Useful for web-based client access scenarios.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Enable IAP on the Cloud Run service |
| `iap_authorized_users` | 5 | `[]` | Users/SAs granted access. Format: `'user:email'` |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted access |

### C. Cloud Armor

When `enable_cloud_armor = true`, a Global HTTPS Load Balancer with Cloud Armor WAF policy is provisioned in front of Cloud Run.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provision Global HTTPS LB + Cloud Armor WAF |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules |
| `application_domains` | 10 | `[]` | Custom domains for the HTTPS LB |
| `enable_cdn` | 10 | `false` | Enable Cloud CDN on the HTTPS LB |

---

## 5. Observability & Health

### A. Health Probes

Chroma exposes a single health endpoint — `/api/v2/heartbeat` — which returns HTTP 200 when the service is fully initialized. Both the startup and liveness probes are hard-coded to this endpoint by `Chroma_Common`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ path="/api/v2/heartbeat", initial_delay=15, period=10, threshold=10 }` | Startup probe. Initial delay accounts for GCS FUSE mount and index loading. |
| `liveness_probe` | 14 | `{ path="/api/v2/heartbeat", initial_delay=30, period=30, threshold=3 }` | Liveness probe. Container is restarted after 3 consecutive failures. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/api/v2/heartbeat" }` | Cloud Monitoring uptime check |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies |

### B. Backup & Recovery

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated backups |
| `backup_retention_days` | 7 | `7` | Days to retain backup files |
| `enable_backup_import` | 7 | `false` | Trigger a one-time restore on apply |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (full GCS URI) or `'gdrive'` (file ID) |
| `backup_uri` | 7 | `""` | GCS URI or Drive file ID. Mapped to `backup_file` in `App_CloudRun`. |
| `backup_format` | 7 | `'tar'` | Backup format: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip` |

---

## 6. CI/CD & Delivery

Identical to `App_CloudRun`. When `enable_cicd_trigger = true`, a Cloud Build GitHub connection and push trigger are provisioned.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provision a Cloud Build GitHub trigger |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository |
| `github_token` | 8 | `""` | GitHub PAT. Sensitive. Required on first apply. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced trigger config |
| `enable_cloud_deploy` | 8 | `false` | Provision a Cloud Deploy pipeline |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Ordered promotion stages |
| `enable_binary_authorization` | 8 | `false` | Enforce image attestation |

---

## 7. Platform-Managed Behaviours

| Behaviour | Implementation | Detail |
|---|---|---|
| No database | `database_type = "NONE"` fixed by `Chroma_Common` | No Cloud SQL instance is created |
| No Redis | `enable_redis = false` hard-coded in `main.tf` | Chroma has no caching dependency |
| Telemetry disabled | `ANONYMIZED_TELEMETRY=false` always injected | Privacy by default |
| Port fixed | `CHROMA_SERVER_HTTP_PORT=8000` always injected | Matches `container_port = 8000` |
| Public ingress blocked | Plan-time validation in `validation.tf` | `ingress_settings = "all"` blocked unless `enable_auth_token = true` |
| GCS data bucket | `<prefix>-data` provisioned by `Chroma_Common` | Mounted at `/data` via GCS FUSE |
| Health probe path | Hard-coded to `/api/v2/heartbeat` | Chroma provides no configurable health path |

---

## 8. Variable Reference

All user-configurable variables, sorted by UI group then order.

| Variable | Group | Default | Description |
|---|---|---|---|
| `module_description` | 0 | Chroma platform text | Platform metadata |
| `module_documentation` | 0 | docs URL | Documentation URL |
| `module_dependency` | 0 | `['Services_GCP']` | Required modules |
| `module_services` | 0 | GCP service list | GCP services consumed |
| `credit_cost` | 0 | `50` | Deployment credit cost |
| `require_credit_purchases` | 0 | `false` | Enforce credit balance check |
| `enable_purge` | 0 | `true` | Permit full resource deletion |
| `public_access` | 0 | `false` | Platform catalogue visibility |
| `shared_users` | 0 | `[]` | Users with access regardless of `public_access` |
| `deployment_id` | 0 | `""` | Deployment ID suffix. Auto-generated when empty |
| `resource_creator_identity` | 0 | platform SA | Terraform service account |
| `project_id` | 1 | — | GCP project ID. **Required.** |
| `region` | 1 | `'us-central1'` | GCP region fallback |
| `tenant_deployment_id` | 2 | `'demo'` | Resource name suffix |
| `support_users` | 2 | `[]` | Email addresses for monitoring alerts |
| `resource_labels` | 2 | `{}` | Labels applied to all resources |
| `application_name` | 3 | `'chroma'` | Base resource name. Do not change after initial deployment. |
| `application_display_name` | 3 | `'Chroma Vector Database'` | Human-readable display name |
| `description` | 3 | Chroma description | Service description |
| `application_version` | 3 | `'latest'` | Chroma container image tag |
| `enable_auth_token` | 3 | `false` | Generate auth token in Secret Manager. Recommended for public deployments. |
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment |
| `cpu_limit` | 4 | `'1000m'` | CPU per instance |
| `memory_limit` | 4 | `'1Gi'` | Memory per instance |
| `min_instance_count` | 4 | `1` | Keep at 1+ to avoid cold starts |
| `max_instance_count` | 4 | `1` | Keep at 1 — Chroma is single-writer |
| `container_port` | 4 | `8000` | Chroma REST API port |
| `execution_environment` | 4 | `'gen2'` | Gen2 required for GCS FUSE |
| `cpu_always_allocated` | 4 | `true` | Always allocate CPU |
| `timeout_seconds` | 4 | `300` | Max request duration |
| `enable_image_mirroring` | 4 | `true` | Mirror image into Artifact Registry |
| `container_protocol` | 4 | `'http1'` | `'http1'` or `'h2c'` |
| `traffic_split` | 4 | `[]` | Canary/blue-green traffic allocation |
| `max_revisions_to_retain` | 4 | `7` | Maximum Cloud Run revisions |
| `service_annotations` | 4 | `{}` | Cloud Run service annotations |
| `service_labels` | 4 | `{}` | Cloud Run service labels |
| `ingress_settings` | 5 | `'internal'` | `'internal'`, `'all'` (requires auth token), or `'internal-and-cloud-load-balancing'` |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | VPC egress mode |
| `enable_iap` | 5 | `false` | Enable IAP |
| `iap_authorized_users` | 5 | `[]` | IAP-authorized users |
| `iap_authorized_groups` | 5 | `[]` | IAP-authorized groups |
| `environment_variables` | 6 | `{}` | Plain-text env vars |
| `secret_environment_variables` | 6 | `{}` | Secret Manager references |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation |
| `secret_rotation_period` | 6 | `'2592000s'` | Rotation reminder period |
| `backup_schedule` | 7 | `'0 2 * * *'` | Automated backup cron schedule |
| `backup_retention_days` | 7 | `7` | Days to retain backups |
| `enable_backup_import` | 7 | `false` | Trigger one-time backup restore |
| `backup_source` | 7 | `'gcs'` | Backup source: `'gcs'` or `'gdrive'` |
| `backup_uri` | 7 | `""` | GCS URI or Drive file ID |
| `backup_format` | 7 | `'tar'` | Backup file format |
| `enable_cicd_trigger` | 8 | `false` | Cloud Build GitHub trigger |
| `github_repository_url` | 8 | `""` | GitHub repository URL |
| `github_token` | 8 | `""` | GitHub PAT. Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced trigger config |
| `enable_cloud_deploy` | 8 | `false` | Cloud Deploy pipeline |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Promotion stages |
| `enable_binary_authorization` | 8 | `false` | Enforce image attestation |
| `additional_cloudrun_sa_roles` | 8 | `[]` | Extra IAM roles for Cloud Run SA |
| `enable_cloud_armor` | 10 | `false` | Global HTTPS LB + Cloud Armor WAF |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF |
| `application_domains` | 10 | `[]` | Custom domains |
| `enable_cdn` | 10 | `false` | Cloud CDN on HTTPS LB |
| `max_images_to_retain` | 10 | `7` | Max Artifact Registry images |
| `delete_untagged_images` | 10 | `true` | Delete untagged images |
| `image_retention_days` | 10 | `30` | Image retention period |
| `create_cloud_storage` | 11 | `true` | Create GCS buckets |
| `storage_buckets` | 11 | `[]` | Additional GCS buckets |
| `enable_nfs` | 11 | `false` | Mount Cloud Filestore NFS |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | NFS container mount path |
| `gcs_volumes` | 11 | `[]` | Additional GCS FUSE volumes |
| `manage_storage_kms_iam` | 11 | `false` | CMEK for storage |
| `enable_artifact_registry_cmek` | 11 | `false` | CMEK for Artifact Registry |
| `initialization_jobs` | 13 | `[]` | One-shot Cloud Run Jobs. No default job. |
| `cron_jobs` | 13 | `[]` | Recurring scheduled jobs |
| `startup_probe` | 14 | `{ path="/api/v2/heartbeat", initial_delay=15, ... }` | Startup probe |
| `liveness_probe` | 14 | `{ path="/api/v2/heartbeat", initial_delay=30, ... }` | Liveness probe |
| `uptime_check_config` | 14 | `{ enabled=true, path="/api/v2/heartbeat" }` | Uptime check |
| `alert_policies` | 14 | `[]` | Metric alert policies |
| `enable_vpc_sc` | 23 | `false` | VPC Service Controls perimeter |
| `vpc_cidr_ranges` | 23 | `[]` | VPC CIDR ranges for VPC-SC |
| `vpc_sc_dry_run` | 23 | `true` | Log violations without blocking |
| `organization_id` | 23 | `""` | GCP Organization ID (required for VPC-SC) |
| `enable_audit_logging` | 23 | `false` | Cloud Audit Logs |

---

## 9. Outputs

| Output | Description |
|---|---|
| `service_url` | Cloud Run service HTTPS URL |
| `service_name` | Cloud Run service name |
| `service_location` | GCP region where the service is deployed |
| `project_id` | GCP project ID |
| `deployment_id` | Deployment ID suffix |
| `storage_buckets` | Provisioned GCS bucket list |
| `container_image` | Container image used for the deployment |

---

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `enable_auth_token` | `false` | **Critical** | Without an authentication token, any caller who can reach the Cloud Run service can read, write, or delete any Chroma collection. Set to `true` for any deployment reachable outside the VPC. The generated token is stored in Secret Manager and must be provided in the `Authorization: Bearer <token>` header by all clients. |
| `ingress_settings` | `"internal"` | **High** | Default is `internal` (VPC-only). Changing to `"all"` exposes the Chroma API to the public internet with no authentication unless `enable_auth_token = true`. Never set to `"all"` without authentication enabled. |
| `enable_nfs` | `false` | **High** | Without NFS, Chroma stores its collection data inside the container filesystem. On Cloud Run, this storage is ephemeral — a new revision deployment or instance restart erases all collections. Enable NFS (requires `execution_environment = "gen2"`) or GCS Fuse (`enable_gcs_storage_volume = true`) for persistence. |
| `execution_environment` | `"gen2"` | **High** | NFS mounts require Gen2. If `enable_nfs = true` is set while `execution_environment = "gen1"`, the Cloud Run deployment fails. |
| `memory_limit` | `"1Gi"` | **High** | Chroma loads HNSW indexes entirely into memory. Each 1M 1536-dimension float32 vectors requires approximately 6 Gi of RAM. The default `1Gi` is only suitable for very small collections (< 100K vectors). Underprovisioning causes OOM kills under query load. |
| `cpu_always_allocated` | `true` | **Medium** | Chroma must respond to health checks and background index rebuilds even with no active requests. Setting to `false` causes CPU throttling between requests, slowing index operations and potentially causing health check timeouts. |
| `min_instance_count` | `1` | **Medium** | Scale-to-zero (`0`) causes cold starts during which in-memory indexes must be reloaded from GCS. For latency-sensitive applications, keep at `1`. |
| `max_instance_count` | `1` | **High** | Multiple Chroma Cloud Run instances do not share state. With `max_instance_count > 1` and GCS Fuse storage, concurrent writes from different instances can corrupt the collection. Chroma Cloud Run is single-instance by design; use `Chroma_GKE` with StatefulSet for multi-replica production deployments. |
| `container_port` | `8000` | **Critical** | Chroma listens on port 8000 by default. Changing this requires a matching `CHROMA_SERVER_HTTP_PORT` environment variable to be set, otherwise the container starts but Cloud Run health checks fail and the revision is never promoted. |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | **Low** | `PRIVATE_RANGES_ONLY` is correct when all dependencies are on the VPC. Only change to `ALL_TRAFFIC` if Chroma must reach public endpoints directly (e.g., embedding model APIs). |
| `timeout_seconds` | `300` | **Medium** | Large similarity searches over millions of vectors can take several seconds. Setting too low causes Cloud Run to return 504 to clients during expensive queries. Increase to `600` for large collection workloads. |
| `enable_gcs_storage_volume` | `true` (in Common) | **High** | GCS Fuse is the primary persistence mechanism for Cloud Run Chroma deployments. Disabling it means collections are lost on instance restart. Leave enabled unless NFS is used instead. |
| `application_version` | `"latest"` | **Medium** | Using `latest` means the deployed image can change on rebuild without an explicit version bump. Pin to a specific Chroma version tag for reproducible production deployments. |
| `backup_schedule` | *(varies by module)* | **Medium** | Chroma data is stored in GCS/NFS; regular snapshots of the GCS bucket are the primary backup mechanism. Ensure GCS object versioning or the module's backup job is configured for disaster recovery. |
| `enable_iap` | `false` | **High** | When `ingress_settings = "all"` and `enable_auth_token = false`, the service is fully open. Enable IAP as an additional authentication layer for user-facing deployments. |
| `secret_propagation_delay` | `30` | **Medium** | If the auth token secret is created but not yet propagated when Cloud Run reads it, the container may start with an empty auth token. Increase to `60` in large projects. |
| `enable_cloudsql_volume` | `false` | **Low** | Chroma does not use a relational database. This variable should remain `false`; enabling it injects a Cloud SQL Auth Proxy sidecar that serves no purpose and consumes container resources. |
| `resource_labels` | `{}` | **Low** | Without labels, cost attribution and resource filtering in GCP Console is difficult. Add at minimum `env` and `service` labels for production. |

## 10. Destroying Resources

When `enable_purge = true`, `tofu destroy` removes all module-managed resources. After Cloud Run service deletion, GCP may hold serverless IPv4 addresses on the VPC subnet for 20–30 minutes before release. If the destroy attempt fails with a subnet deletion error, wait and re-run:

```bash
tofu destroy
```
