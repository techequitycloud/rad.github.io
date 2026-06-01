# Qdrant on Google Cloud Run

This document provides a comprehensive reference for the `modules/Qdrant_CloudRun` Terraform module. It covers architecture, IAM, configuration variables, Qdrant-specific behaviours, and operational patterns for deploying Qdrant on Google Cloud Run (v2).

---

## 1. Module Overview

Qdrant is a high-performance vector database and similarity search engine built in Rust. `Qdrant CloudRun` is a **wrapper module** built on top of `App CloudRun`. It uses `App CloudRun` for all GCP infrastructure provisioning and injects Qdrant-specific application configuration, an optional API key, and storage configuration via `Qdrant Common`.

**Key Capabilities:**
- **Compute**: Cloud Run v2 (Gen2), 1 vCPU / 1 Gi by default. `min_instance_count = 1` to avoid HNSW index-loading cold starts. `max_instance_count = 1` — Qdrant is a single-writer store.
- **Data Persistence**: Cloud Storage bucket (`<prefix>-storage`) mounted at `/qdrant/storage` via GCS FUSE. No Cloud SQL, no Redis.
- **Security**: Optional API key via Secret Manager. A plan-time validation blocks public ingress (`ingress_settings = "all"`) unless `enable_api_key = true`. Inherits Cloud Armor, IAP, Binary Authorization, and VPC-SC from `App CloudRun`.
- **CI/CD**: Cloud Build image pipeline by default; Cloud Deploy progressive delivery optional.
- **Reliability**: Startup probe targets `/readyz`; liveness probe targets `/livez`. Separate endpoints prevent spurious restarts during collection loading.
- **gRPC**: Qdrant supports gRPC on port 6334. Cloud Run does not multiplex two ports, so gRPC is disabled by default. Use `container_protocol = "h2c"` with a gRPC client if needed.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `region` | 1 | `string` | `'us-central1'` | GCP region fallback |
| `tenant_deployment_id` | 2 | `string` | `'demo'` | Short suffix appended to all resource names |
| `support_users` | 2 | `list(string)` | `[]` | Email recipients for monitoring alerts |
| `resource_labels` | 2 | `map(string)` | `{}` | Labels applied to all provisioned resources |
| `application_name` | 3 | `string` | `'qdrant'` | Base resource name. Do not change after initial deployment. |
| `application_display_name` | 3 | `string` | `'Qdrant Vector Database'` | Human-readable name in the GCP Console |
| `description` | 3 | `string` | Qdrant description | Cloud Run service description |
| `application_version` | 3 | `string` | `'latest'` | Qdrant image tag (e.g., `'v1.9.0'`) |

**Wrapper architecture:** `Qdrant CloudRun` calls `Qdrant Common` to build an `application_config` object containing Qdrant-specific environment variables, probe configuration, and the storage volume definition. `module_storage_buckets` carries the `<prefix>-storage` GCS bucket. `scripts_dir` is resolved to `abspath("${module.qdrant_app.path}/scripts")` at apply time.

---

## 2. IAM & Access Control

`Qdrant CloudRun` delegates all IAM provisioning to `App CloudRun`. The Cloud Run SA, Cloud Build SA, and IAP service agent role sets are identical to those in `App CloudRun`.

**API key:** When `enable_api_key = true`, `Qdrant Common` generates a 32-character API key and stores it in Secret Manager as `<prefix>-api-key`. It is injected as `QDRANT__SERVICE__API_KEY`. All REST and gRPC calls must include `api-key: <key>` in the request header.

For the complete role tables and IAP details, see the App CloudRun documentation.

---

## 3. Core Service Configuration

### A. Compute (Cloud Run)

`Qdrant CloudRun` exposes `cpu_limit` and `memory_limit` as dedicated top-level variables. Qdrant loads HNSW vector indexes into RAM — size `memory_limit` according to your collection size and vector dimensionality.

**Single-instance constraint:** `max_instance_count = 1` is strongly recommended. Qdrant is a single-writer store — multiple instances against the same GCS FUSE mount will corrupt collection data. Scale vertically (increase CPU and memory) rather than horizontally.

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment |
| `cpu_limit` | 4 | `'1000m'` | CPU per instance |
| `memory_limit` | 4 | `'1Gi'` | Memory per instance. Increase for large collections; HNSW indexes are memory-resident. |
| `min_instance_count` | 4 | `1` | Keep at 1+ to avoid cold starts during HNSW index loading |
| `max_instance_count` | 4 | `1` | Keep at 1 — Qdrant is single-writer |
| `container_port` | 4 | `6333` | Qdrant REST API port |
| `execution_environment` | 4 | `'gen2'` | Gen2 required for GCS FUSE |
| `timeout_seconds` | 4 | `300` | Max request duration (0–3600 s). Increase for large batch upserts or snapshot operations. |
| `enable_cloudsql_volume` | 4 | `false` | Not applicable — Qdrant has no SQL database |
| `enable_image_mirroring` | 4 | `true` | Mirror the Qdrant image into Artifact Registry |
| `container_protocol` | 4 | `'http1'` | Use `'h2c'` to enable HTTP/2 for gRPC clients |
| `traffic_split` | 4 | `[]` | Canary/blue-green traffic allocation |
| `max_revisions_to_retain` | 4 | `7` | Maximum Cloud Run revisions to keep |
| `service_annotations` | 4 | `{}` | Cloud Run service annotations |
| `service_labels` | 4 | `{}` | Cloud Run service labels |

**Differences from `App CloudRun` defaults:**

| Variable | `App CloudRun` | `Qdrant CloudRun` | Reason |
|---|---|---|---|
| `container_port` | `8080` | `6333` | Qdrant's native REST API port |
| `ingress_settings` | `'all'` | `'internal'` | Vector databases should not be publicly exposed by default |
| `enable_redis` | `true` | `false` (hard-coded) | Qdrant has no Redis dependency |
| `database_type` | configurable | `NONE` (fixed) | Qdrant manages its own embedded storage |
| `min_instance_count` | `0` | `1` | Avoid cold start delays during HNSW index loading |

### B. Storage (GCS FUSE)

Qdrant requires persistent storage for its WAL, collection data, HNSW index files, and metadata. `Qdrant Common` automatically provisions a GCS bucket and mounts it at `/qdrant/storage` via GCS FUSE. `QDRANT__STORAGE__STORAGE_PATH` is set to match.

| Variable | Group | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | 11 | `true` | Set `false` to skip GCS bucket creation |
| `storage_buckets` | 11 | `[]` | Additional GCS buckets beyond the storage bucket |
| `gcs_volumes` | 11 | `[]` | Additional GCS FUSE volume mounts |
| `enable_nfs` | 11 | `false` | Mount Cloud Filestore NFS (requires gen2). Qdrant uses GCS for storage. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | NFS container mount path |
| `manage_storage_kms_iam` | 11 | `false` | Create CMEK KMS key for storage |
| `enable_artifact_registry_cmek` | 11 | `false` | Enable CMEK for Artifact Registry |

The auto-provisioned bucket uses: `storage_class = "STANDARD"`, `versioning_enabled = false`, `public_access_prevention = "enforced"`.

### C. Networking

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'internal'` | Recommended. `'all'` requires `enable_api_key = true` (plan-time validation). |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` or `'ALL_TRAFFIC'` |

---

## 4. Authentication & Access Control

### A. Qdrant API Key

The primary Qdrant-specific security control. When `enable_api_key = true`:

- A 32-character alphanumeric API key is generated and stored in Secret Manager
- Qdrant starts with `QDRANT__SERVICE__API_KEY` set to the key value
- All REST calls must include `api-key: <key>` in the request header
- All gRPC calls must include `api-key: <key>` in the metadata
- Python client usage: `qdrant_client.QdrantClient(host=..., api_key="<key>")`

**Plan-time guard:** `validation.tf` includes a precondition that prevents deploying with `ingress_settings = "all"` and `enable_api_key = false` simultaneously. This blocks accidental public exposure of an unauthenticated Qdrant instance.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_api_key` | 3 | `false` | Generate and store API key in Secret Manager. Recommended for all non-internal deployments. |

### B. Identity-Aware Proxy (IAP)

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Enable IAP on the Cloud Run service |
| `iap_authorized_users` | 5 | `[]` | Users/SAs granted access |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted access |

### C. Cloud Armor

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provision Global HTTPS LB + Cloud Armor WAF |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules |
| `application_domains` | 10 | `[]` | Custom domains for the HTTPS LB |
| `enable_cdn` | 10 | `false` | Enable Cloud CDN on the HTTPS LB |

---

## 5. Observability & Health

### A. Health Probes

Qdrant exposes two dedicated health endpoints with distinct purposes:

| Probe | Endpoint | Rationale |
|---|---|---|
| `startup_probe` | `/readyz` | Qdrant reports ready once all collections are fully loaded. Prevents traffic before index loading completes. |
| `liveness_probe` | `/livez` | Dedicated liveness endpoint unaffected by collection load state. **Critical:** using `/readyz` for liveness causes spurious restart loops during large collection loads. |

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ path="/readyz", initial_delay=15, period=10, threshold=10 }` | Startup probe |
| `liveness_probe` | 14 | `{ path="/livez", initial_delay=30, period=30, threshold=3 }` | Liveness probe |
| `uptime_check_config` | 14 | `{ enabled=true, path="/readyz" }` | Cloud Monitoring uptime check |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies |

**Differences from `App CloudRun` probe defaults:**

| Field | `App CloudRun` | `Qdrant CloudRun` | Reason |
|---|---|---|---|
| Startup `path` | `/healthz` | `/readyz` | Qdrant's dedicated readiness endpoint |
| Liveness `path` | `/healthz` | `/livez` | Qdrant's dedicated liveness endpoint (separate from readiness) |

### B. Backup & Recovery

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated backups |
| `backup_retention_days` | 7 | `7` | Days to retain backup files |
| `enable_backup_import` | 7 | `false` | Trigger a one-time restore on apply |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (full GCS URI) or `'gdrive'` (file ID) |
| `backup_uri` | 7 | `""` | GCS URI or Drive file ID. Mapped to `backup_file` in `App CloudRun`. |
| `backup_format` | 7 | `'tar'` | Backup format: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip` |

---

## 6. CI/CD & Delivery

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
| No database | `database_type = "NONE"` fixed by `Qdrant Common` | No Cloud SQL instance is created |
| No Redis | `enable_redis = false` hard-coded in `main.tf` | Qdrant has no caching dependency |
| Storage path env var | `QDRANT__STORAGE__STORAGE_PATH=/qdrant/storage` always injected | Aligned with GCS FUSE mount point |
| HTTP port env var | `QDRANT__SERVICE__HTTP_PORT=6333` always injected | Explicit port matching `container_port` |
| gRPC disabled | `QDRANT__SERVICE__GRPC_PORT` not set | Cloud Run does not expose port 6334. Use `container_protocol = "h2c"` for gRPC over the main port. |
| Public ingress blocked | Plan-time validation in `validation.tf` | `ingress_settings = "all"` blocked unless `enable_api_key = true` |
| GCS storage bucket | `<prefix>-storage` provisioned by `Qdrant Common` | Mounted at `/qdrant/storage` via GCS FUSE |
| Separate liveness/readiness | Startup: `/readyz`, Liveness: `/livez` | Prevents restart loops during large collection loads |

---

## 8. Variable Reference

All user-configurable variables, sorted by UI group then order.

| Variable | Group | Default | Description |
|---|---|---|---|
| `module_description` | 0 | Qdrant platform text | Platform metadata |
| `module_documentation` | 0 | docs URL | Documentation URL |
| `module_dependency` | 0 | `['Services GCP']` | Required modules |
| `module_services` | 0 | GCP service list | GCP services consumed |
| `credit_cost` | 0 | `50` | Deployment credit cost |
| `require_credit_purchases` | 0 | `false` | Credit balance check |
| `enable_purge` | 0 | `true` | Permit full resource deletion |
| `public_access` | 0 | `false` | Platform catalogue visibility |
| `shared_users` | 0 | `[]` | Users with access regardless of `public_access` |
| `deployment_id` | 0 | `""` | Deployment ID suffix |
| `resource_creator_identity` | 0 | platform SA | Terraform service account |
| `project_id` | 1 | — | GCP project ID. **Required.** |
| `region` | 1 | `'us-central1'` | Region fallback |
| `tenant_deployment_id` | 2 | `'demo'` | Resource name suffix |
| `support_users` | 2 | `[]` | Monitoring alert recipients |
| `resource_labels` | 2 | `{}` | Resource labels |
| `application_name` | 3 | `'qdrant'` | Base resource name |
| `application_display_name` | 3 | `'Qdrant Vector Database'` | Display name |
| `description` | 3 | Qdrant description | Service description |
| `application_version` | 3 | `'latest'` | Qdrant image tag |
| `enable_api_key` | 3 | `false` | Generate API key in Secret Manager |
| `deploy_application` | 4 | `true` | Deploy the Cloud Run service |
| `cpu_limit` | 4 | `'1000m'` | CPU per instance |
| `memory_limit` | 4 | `'1Gi'` | Memory per instance |
| `min_instance_count` | 4 | `1` | Min instances |
| `max_instance_count` | 4 | `1` | Max instances (keep at 1) |
| `container_port` | 4 | `6333` | REST API port |
| `execution_environment` | 4 | `'gen2'` | Gen2 required for GCS FUSE |
| `timeout_seconds` | 4 | `300` | Request timeout |
| `enable_image_mirroring` | 4 | `true` | Mirror to Artifact Registry |
| `container_protocol` | 4 | `'http1'` | `'http1'` or `'h2c'` for gRPC |
| `traffic_split` | 4 | `[]` | Traffic allocation |
| `max_revisions_to_retain` | 4 | `7` | Max revisions |
| `ingress_settings` | 5 | `'internal'` | `'internal'`, `'all'` (requires API key), or `'internal-and-cloud-load-balancing'` |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | VPC egress mode |
| `enable_iap` | 5 | `false` | Enable IAP |
| `iap_authorized_users` | 5 | `[]` | IAP users |
| `iap_authorized_groups` | 5 | `[]` | IAP groups |
| `environment_variables` | 6 | `{}` | Plain-text env vars |
| `secret_environment_variables` | 6 | `{}` | Secret Manager references |
| `secret_propagation_delay` | 6 | `30` | Post-creation wait |
| `secret_rotation_period` | 6 | `'2592000s'` | Rotation period |
| `backup_schedule` | 7 | `'0 2 * * *'` | Backup cron |
| `backup_retention_days` | 7 | `7` | Backup retention |
| `enable_backup_import` | 7 | `false` | One-time restore |
| `backup_source` | 7 | `'gcs'` | Backup source |
| `backup_uri` | 7 | `""` | Backup location |
| `backup_format` | 7 | `'tar'` | Backup format |
| `enable_cicd_trigger` | 8 | `false` | Cloud Build trigger |
| `github_repository_url` | 8 | `""` | GitHub URL |
| `github_token` | 8 | `""` | GitHub PAT. Sensitive. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Trigger config |
| `enable_cloud_deploy` | 8 | `false` | Cloud Deploy pipeline |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Stages |
| `enable_binary_authorization` | 8 | `false` | Binary Authorization |
| `enable_cloud_armor` | 10 | `false` | Cloud Armor WAF |
| `admin_ip_ranges` | 10 | `[]` | WAF exemptions |
| `application_domains` | 10 | `[]` | Custom domains |
| `enable_cdn` | 10 | `false` | Cloud CDN |
| `max_images_to_retain` | 10 | `7` | Artifact Registry image retention count |
| `delete_untagged_images` | 10 | `true` | Delete untagged images |
| `image_retention_days` | 10 | `30` | Image retention days |
| `create_cloud_storage` | 11 | `true` | GCS buckets |
| `storage_buckets` | 11 | `[]` | Additional buckets |
| `enable_nfs` | 11 | `false` | NFS mount |
| `gcs_volumes` | 11 | `[]` | Additional GCS FUSE volumes |
| `manage_storage_kms_iam` | 11 | `false` | CMEK for storage |
| `enable_artifact_registry_cmek` | 11 | `false` | CMEK for Artifact Registry |
| `initialization_jobs` | 13 | `[]` | One-shot Cloud Run Jobs |
| `cron_jobs` | 13 | `[]` | Recurring scheduled jobs |
| `startup_probe` | 14 | `{ path="/readyz" }` | Startup probe |
| `liveness_probe` | 14 | `{ path="/livez" }` | Liveness probe |
| `uptime_check_config` | 14 | `{ path="/readyz" }` | Uptime check |
| `alert_policies` | 14 | `[]` | Alert policies |
| `enable_vpc_sc` | 23 | `false` | VPC Service Controls |
| `vpc_cidr_ranges` | 23 | `[]` | VPC-SC CIDR ranges |
| `vpc_sc_dry_run` | 23 | `true` | Log without blocking |
| `organization_id` | 23 | `""` | GCP Org ID for VPC-SC |
| `enable_audit_logging` | 23 | `false` | Cloud Audit Logs |

---

## 9. Outputs

| Output | Description |
|---|---|
| `service_url` | Cloud Run service HTTPS URL |
| `service_name` | Cloud Run service name |
| `service_location` | GCP region |
| `project_id` | GCP project ID |
| `deployment_id` | Deployment ID suffix |
| `storage_buckets` | Provisioned GCS bucket list |
| `container_image` | Container image used |

---

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `enable_api_key` (Common) | `false` | **Critical** | Without an API key, any caller who can reach the Qdrant endpoint can read, modify, or delete all collections and their vectors. Enable for any deployment reachable outside the VPC. The generated key is stored in Secret Manager and must be passed as `api-key: <key>` in all gRPC/HTTP requests. |
| `ingress_settings` | `"internal"` | **Critical** | Default is `internal` (VPC-only). Changing to `"all"` exposes the Qdrant REST and gRPC ports to the public internet. Never set to `"all"` without `enable_api_key = true`. |
| `enable_nfs` | `false` | **High** | Without NFS, Qdrant stores its collection storage at `/qdrant/storage` inside the ephemeral container filesystem. Any Cloud Run revision deployment or instance restart erases all collections and their vectors permanently. Enable NFS (requires `execution_environment = "gen2"`) for persistence. |
| `execution_environment` | `"gen2"` | **High** | NFS mounts require Gen2. If `enable_nfs = true` is set with `execution_environment = "gen1"`, the Cloud Run deployment fails at plan time. |
| `memory_limit` | `"1Gi"` | **High** | Qdrant loads vector indexes (HNSW graphs) entirely into memory. Each 1M vectors at 1536 dimensions requires approximately 6 Gi. The default `1Gi` supports only very small collections. OOM kills terminate all in-flight queries and cause a cold restart from storage. |
| `cpu_limit` | `"1000m"` | **Medium** | HNSW index builds are CPU-intensive; concurrent similarity searches compete for CPU. Under `1000m`, p99 query latency degrades noticeably. Scale to `2000m`–`4000m` for production. |
| `collection vector dimensions` | *(set at collection creation time via client)* | **Critical** | The vector dimension parameter in a Qdrant collection is immutable after creation. If the dimension does not match the embedding model used to generate vectors (e.g., 768 vs. 1536), all upsert operations fail with a dimension mismatch error and the collection is permanently unusable. Always verify the embedding model dimension before creating a collection. |
| `min_instance_count` | `1` | **Medium** | Scale-to-zero (`0`) causes Qdrant to restart and reload indexes from NFS/GCS on the next request. For collections with millions of vectors, this reload can take tens of seconds, causing request timeouts. Keep at `1` for latency-sensitive workloads. |
| `max_instance_count` | `1` | **High** | Multiple Qdrant Cloud Run instances cannot share a single NFS collection storage safely. Qdrant does not support distributed operation in this topology. Keep at `1` or use `Qdrant GKE` with StatefulSet for production scale. |
| `container_port` | `6333` | **Critical** | Qdrant listens on HTTP port 6333 and gRPC port 6334. Changing the HTTP port requires a matching `QDRANT__SERVICE__HTTP_PORT` environment variable; mismatches cause health check failures and no-traffic revisions. |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | **Low** | Correct for VPC-only deployments. Change to `ALL_TRAFFIC` only if Qdrant must fetch snapshots or reach public endpoints directly. |
| `timeout_seconds` | `300` | **Medium** | Large ANN searches or snapshot upload/download operations can take longer than the default. Increase to `600` for collections with tens of millions of vectors. |
| `application_version` | `"latest"` | **Medium** | Using `"latest"` is non-reproducible. Qdrant's storage format can change between major versions. Upgrading across incompatible storage formats requires exporting and re-importing all collections. Pin to a specific version tag in production. |
| `enable_gcs_storage_volume` (Common) | `true` | **High** | GCS Fuse is the fallback persistence mechanism when NFS is disabled. Disabling it with `enable_nfs = false` means all data is lost on instance restart. Do not disable unless NFS is used. |
| `enable_iap` | `false` | **High** | Without IAP, the endpoint (when public) is accessible to any caller. Enable IAP for user-facing deployments and ensure `enable_api_key = true` as well for defense in depth. |
| `liveness_probe` (Common) | `/livez` endpoint | **High** | Qdrant exposes `/livez` (always 200) and `/readyz` (503 while loading large collections). Using `/readyz` as the liveness target causes spurious pod restarts whenever Qdrant loads a large collection. Always use `/livez` for liveness and `/readyz` for readiness. |
| `enable_image_mirroring` | `true` | **Low** | Disabling mirroring skips copying the Qdrant image into Artifact Registry. Deployments then pull directly from Docker Hub and are subject to pull rate limits, causing intermittent deployment failures in CI/CD. |
| `secret_propagation_delay` | `30` | **Medium** | In large projects, Secret Manager replication may exceed 30 seconds. Increase to `60` to prevent the deployment from reading an empty API key secret. |

## 10. Destroying Resources

When `enable_purge = true`, `tofu destroy` removes all module-managed resources. After Cloud Run service deletion, GCP may hold serverless IPv4 addresses for 20–30 minutes. Re-run `tofu destroy` after that window if the first attempt fails.
