# Crawl4AI on Google Kubernetes Engine (GKE Autopilot)

This document provides a comprehensive reference for the `modules/Crawl4AI_GKE` Terraform module. It covers architecture, IAM, configuration variables, Crawl4AI-specific behaviours, and operational patterns for deploying Crawl4AI on GKE Autopilot.

---

## 1. Module Overview

Crawl4AI is an open-source LLM-friendly web crawler and scraper with 40,000+ GitHub stars. `Crawl4AI_GKE` is a **wrapper module** built on top of `App_GKE`. It uses `App_GKE` for all GCP infrastructure provisioning and injects Crawl4AI-specific application configuration via `Crawl4AI_Common`.

**Key Capabilities:**
*   **Compute**: GKE Autopilot, Python container, 4 vCPU / 8 Gi default. Supervisord manages embedded Redis (task queue) and Gunicorn ASGI server inside the pod. A dedicated `/dev/shm` emptyDir volume is mounted for Chromium shared memory — GKE provides proper `/dev/shm` support unlike Cloud Run's tmpfs approach.
*   **Data Persistence**: **Stateless** — no external database is provisioned. Redis runs inside the pod. Horizontal Pod Autoscaler (HPA) manages scaling.
*   **Security**: Inherits Workload Identity, Cloud Armor WAF, IAP, Binary Authorization, and VPC Service Controls from `App_GKE`. No application secrets are auto-generated.
*   **AI Integration**: Supports LLM-based extraction via OpenAI, Anthropic, DeepSeek, Groq, Gemini, and custom providers. API keys are injected via `secret_environment_variables`.

**Architecture note:** On GKE, Crawl4AI benefits from proper `/dev/shm` support via an emptyDir volume, unlike the Cloud Run Gen2 workaround that redirects Chromium to `/tmp`. This makes GKE the preferred platform for high-concurrency crawling workloads.

---

## 2. IAM & Access Control

`Crawl4AI_GKE` delegates all IAM provisioning to `App_GKE`. Workload Identity binds the Kubernetes service account to a GCP service account for Secret Manager access.

**No auto-generated secrets:** `Crawl4AI_Common` creates no Secret Manager secrets. Inject `SECRET_KEY` (for JWT authentication) and LLM API keys via `secret_environment_variables`.

---

## 3. Core Service Configuration

### A. Compute (GKE)

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `workload_type` | 4 | `null` | `'Deployment'` (stateless, default) or `'StatefulSet'`. |
| `container_resources` | 4 | `{ cpu_limit = "4", memory_limit = "8Gi", cpu_request = "2", mem_request = "4Gi" }` | Container CPU and memory limits and requests. Minimum 4 Gi memory. |
| `min_instance_count` | 4 | `1` | Minimum pod replicas. Set to 1 for a warm Chromium pool. |
| `max_instance_count` | 4 | `5` | Maximum pod replicas for HPA. Range: 1–1000. |
| `timeout_seconds` | 4 | `1800` | Pod termination grace period. Set to at least 1800 s to allow long batch crawls to drain. |
| `termination_grace_period_seconds` | 4 | `60` | Seconds Kubernetes waits for the pod to terminate gracefully. |
| `service_type` | 4 | `'LoadBalancer'` | Kubernetes Service type: `'ClusterIP'`, `'LoadBalancer'`, or `'NodePort'`. |
| `session_affinity` | 4 | `'None'` | `'None'` distributes requests across all pods. |
| `enable_image_mirroring` | 4 | `true` | Mirror Crawl4AI image to Artifact Registry. |
| `enable_vertical_pod_autoscaling` | 4 | `false` | Enable VPA for automatic resource adjustment. |
| `container_image_source` | 4 | `'prebuilt'` | `'prebuilt'` uses `unclecode/crawl4ai` directly; `'custom'` builds via Cloud Build. |
| `container_image` | 4 | `'unclecode/crawl4ai'` | Full URI of the container image when `container_image_source = 'prebuilt'`. |

### B. Crawl4AI-Specific Configuration

| Variable | Group | Default | Description |
|---|---|---|---|
| `redis_task_ttl_seconds` | 19 | `3600` | TTL in seconds for task results in embedded Redis. Range: 300–86400. |

### C. Application Identity

| Variable | Group | Default | Description |
|---|---|---|---|
| `application_name` | 3 | `'crawl4ai'` | Internal identifier for the application. |
| `application_display_name` | 3 | `'Crawl4AI Web Crawler'` | Human-readable name shown in the platform UI. |
| `application_description` | 3 | (Crawl4AI GKE description) | Brief description of the application's purpose. |
| `application_version` | 3 | `'latest'` | Crawl4AI Docker image tag. Use a pinned version for production. |

### D. Networking

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 20 | `false` | Enable IAP via Kubernetes Gateway. Requires `enable_custom_domain = true`. |
| `iap_authorized_users` | 20 | `[]` | User emails authorized via IAP. |
| `iap_authorized_groups` | 20 | `[]` | Google Groups authorized via IAP. |
| `iap_oauth_client_id` | 20 | `""` | OAuth client ID for IAP. Sensitive. |
| `iap_oauth_client_secret` | 20 | `""` | OAuth client secret for IAP. Sensitive. |
| `enable_custom_domain` | 19 | `false` | Enable custom domain via Kubernetes Gateway API with SSL certificates. |
| `application_domains` | 19 | `[]` | Custom domains for the application. |
| `reserve_static_ip` | 19 | `true` | Reserve a static external IP. |
| `static_ip_name` | 19 | `""` | Name for the reserved static IP. Auto-generated when empty. |
| `network_tags` | 19 | `['nfsserver']` | Network tags applied to GKE nodes. |
| `gke_cluster_name` | 6 | `""` | GKE cluster name. Leave empty to auto-discover. |
| `namespace_name` | 6 | `""` | Kubernetes namespace. Auto-generated when empty. |

### E. Environment Variables & LLM Integration

| Variable | Group | Default | Description |
|---|---|---|---|
| `environment_variables` | 5 | `{}` | Additional environment variables. `PYTHONUNBUFFERED` and `REDIS_TASK_TTL` are set automatically. **Do NOT set `REDIS_HOST` or `REDIS_PORT`**. |
| `secret_environment_variables` | 5 | `{}` | Secret Manager secret references. Use for `SECRET_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc. |
| `secret_propagation_delay` | 5 | `30` | Seconds to wait after secret creation. |
| `secret_rotation_period` | 5 | `'2592000s'` | Secret Manager rotation period. Default: 30 days. |

---

## 4. Advanced Security

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_binary_authorization` | 12 | `false` | Enable Binary Authorization requiring signed images. |
| `enable_cloud_armor` | 21 | `false` | Attach a Cloud Armor security policy to the GKE Ingress backend. |
| `admin_ip_ranges` | 21 | `[]` | CIDR ranges permitted for administrative access. |
| `cloud_armor_policy_name` | 21 | `'default-waf-policy'` | Name of the Cloud Armor security policy to apply. |
| `enable_cdn` | 21 | `false` | Enable Cloud CDN on the load balancer. |
| `enable_vpc_sc` | 22 | `false` | VPC Service Controls perimeter enforcement. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC. |
| `vpc_sc_dry_run` | 22 | `true` | Log VPC-SC violations without blocking. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. |
| `enable_audit_logging` | 22 | `false` | Enable detailed Cloud Audit Logs. |

---

## 5. Storage

| Variable | Group | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | 14 | `true` | Provision GCS buckets. |
| `storage_buckets` | 14 | `[]` | Additional GCS buckets (none by default). |
| `gcs_volumes` | 14 | `[]` | GCS FUSE volume mounts via CSI driver. |
| `manage_storage_kms_iam` | 14 | `false` | Create CMEK KMS key for GCS encryption. |
| `enable_artifact_registry_cmek` | 14 | `false` | Enable CMEK for Artifact Registry. |
| `max_images_to_retain` | 14 | `7` | Maximum container images to keep in Artifact Registry. |
| `delete_untagged_images` | 14 | `true` | Auto-delete untagged images. |
| `image_retention_days` | 14 | `30` | Image age-based deletion threshold. |

---

## 6. CI/CD & Delivery

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 12 | `false` | Enable automated Cloud Build trigger. |
| `github_repository_url` | 12 | `""` | GitHub repository URL. |
| `github_token` | 12 | `""` | GitHub PAT. Sensitive. |
| `github_app_installation_id` | 12 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 12 | `{ branch_pattern = "^main$" }` | Cloud Build trigger configuration. |
| `enable_cloud_deploy` | 12 | `false` | Google Cloud Deploy managed pipeline. |
| `cloud_deploy_stages` | 12 | `[dev, staging, prod(approval)]` | Cloud Deploy promotion stages. |

---

## 7. Reliability & Scheduling

### A. Health Probes

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ path="/health", initial_delay_seconds=40, failure_threshold=12, ... }` | Startup probe for Crawl4AI. 40 s initial delay for supervisord boot. |
| `liveness_probe` | 14 | `{ path="/health", initial_delay_seconds=60, failure_threshold=3, ... }` | Liveness probe. |
| `startup_probe_config` | 10 | `{ enabled=true }` | App_GKE startup probe config. Takes precedence. |
| `health_check_config` | 10 | `{ enabled=true }` | App_GKE liveness probe config. Takes precedence. |
| `uptime_check_config` | 10 | `{ enabled=false }` | Cloud Monitoring uptime check. |
| `alert_policies` | 10 | `[]` | Cloud Monitoring alert policies. |
| `deployment_timeout` | 6 | `1800` | Maximum seconds Terraform waits for the Kubernetes rollout to complete. |
| `enable_pod_disruption_budget` | 4 | `false` | Create a PodDisruptionBudget. |
| `pdb_min_available` | 4 | `1` | Minimum pods available during disruptions. |

### B. Backup & Scheduled Jobs

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 17 | `""` | Not applicable — Crawl4AI is stateless. |
| `backup_retention_days` | 17 | `7` | Days to retain backup files. |
| `enable_backup_import` | 17 | `false` | Not applicable for Crawl4AI. |
| `initialization_jobs` | 11 | `[]` | Kubernetes Jobs for initialization tasks. |
| `cron_jobs` | 11 | `[]` | CronJobs to deploy alongside Crawl4AI. |

---

## 8. Platform-Managed Behaviours

| Behaviour | Implementation | Detail |
|---|---|---|
| **No database provisioned** | `database_type = "NONE"` in `Crawl4AI_Common` | Crawl4AI has no external database dependency. |
| **Embedded Redis** | Supervisord starts Redis inside the pod | Task results stored in-memory. Lost on pod restart. |
| **`/dev/shm` support** | emptyDir volume mounted by `App_GKE` | GKE provides proper shared memory for Chromium — no `--disable-dev-shm-usage` workaround needed. |
| **REDIS_TASK_TTL injected** | `REDIS_TASK_TTL = tostring(var.redis_task_ttl_seconds)` | Prevents unbounded Redis memory growth. |
| **PYTHONUNBUFFERED=1** | Injected by `Crawl4AI_Common` | Ensures Python log streaming. |
| **Prebuilt image by default** | `image_source = "prebuilt"` | Uses `unclecode/crawl4ai:<version>` directly via Artifact Registry mirror. |
| **No auto-generated secrets** | `secret_ids = {}` from `Crawl4AI_Common` | Inject `SECRET_KEY` via `secret_environment_variables` to enable JWT auth. |
| **Workload Identity** | Managed by `App_GKE` | Pod accesses GCP APIs via Workload Identity — no service account key files. |

---

## 9. Outputs

| Output | Description |
|---|---|
| `service_name` | Name of the Kubernetes Service. |
| `service_url` | External URL of the Crawl4AI service. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix used in resource names. |
| `container_image` | Container image used for the deployment. |
| `cicd_enabled` | Whether the CI/CD pipeline is enabled. |

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `memory_limit` | `"8Gi"` | **Critical** | Crawl4AI spawns Chromium browser instances for JavaScript rendering. Each concurrent browser context uses 200–500 MB. Below `4Gi`, Chromium processes are OOM-killed mid-crawl returning partial results. Below `2Gi`, the container fails to start. Scale to `16Gi`+ for high-concurrency GKE deployments. |
| `cpu_limit` | `"4000m"` | **High** | Chromium rendering and DOM parsing are CPU-intensive. CPU throttling below `2000m` causes internal browser timeouts on complex pages and significantly slows crawl throughput. |
| `/dev/shm for Chromium (GKE emptyDir)` | *(must be configured via emptyDir medium: Memory in pod spec)* | **High** | On GKE, Chromium by default uses `/dev/shm` (shared memory) for inter-process communication. The default `/dev/shm` size in Kubernetes is 64 Mi, which is insufficient for Chromium. Crawl4AI's default config uses `--disable-dev-shm-usage` (Chrome uses `/tmp` instead), but if this flag is removed, configure an `emptyDir` volume with `medium: Memory` mounted at `/dev/shm` with adequate size. Insufficient `/dev/shm` causes browser crashes. |
| `min_instance_count` | `1` | **High** | Crawl4AI has a significant cold start (Chromium + embedded Redis + Supervisord). Scale-to-zero (`0`) means the first request after a cold start encounters a 30–60 second delay and likely times out. Keep at `1` in production. |
| `max_instance_count` | `3` | **Medium** | Each GKE pod runs its own Chromium pool and embedded Redis. Costs scale with pod count. Set a ceiling matching your crawl concurrency budget. |
| `redis_task_ttl_seconds` | `3600` | **Medium** | Task results in the embedded Redis expire after this TTL. Too-short values (< 300 s) cause results to expire before async clients poll for them. Too-long values cause memory growth. Valid range: 300–86400. |
| `workload_type` | `null` | **Medium** | Crawl4AI is stateless — `Deployment` is appropriate. Using `StatefulSet` without `stateful_pvc_enabled = true` wastes scheduler resources. Use `Deployment` unless local PVC caching is explicitly needed. |
| `quota_memory_requests` | `"32Gi"` | **Critical** | Must use binary unit suffixes (`Gi`, `Mi`). A bare integer (e.g. `"32"`) is treated as 32 bytes by Kubernetes, blocking all pod scheduling. Only active when `enable_resource_quota = true`. |
| `quota_memory_limits` | `"64Gi"` | **Critical** | Same constraint as `quota_memory_requests` — binary suffixes required. If set below the actual pod memory limit × replica count, pods fail to schedule. |
| `LLM_API_KEY` (env var via `environment_variables`) | *(not set)* | **High** | LLM-based extraction strategies require a valid provider API key injected as an environment variable. Missing or expired keys cause extraction jobs to return empty `extracted_content`. Use `secret_environment_variables` for production to avoid plain-text exposure. |
| `container_port` | `11235` | **Critical** | Crawl4AI listens on port 11235. Changing this without a matching `UVICORN_PORT` or Kubernetes Service port update causes health probes to fail and the service to receive no traffic. |
| `timeout_seconds` | `300` | **Medium** | Deep crawls of complex pages can exceed 5 minutes. Increase to `600`–`3600` for workloads involving JavaScript-heavy sites or LLM-based extraction. |
| `enable_iap` | `false` | **High** | Without IAP, the GKE LoadBalancer is accessible to any caller. Enable IAP or inject `CRAWL4AI_API_TOKEN` via environment variables for production deployments. |
| `application_version` | `"latest"` | **Medium** | Using `"latest"` is non-reproducible. Pin to a specific version tag to prevent unexpected API changes on rebuild. |
| `enable_image_mirroring` | `true` | **Low** | Crawl4AI images are large. Disable only if Artifact Registry already holds the correct image; otherwise every pod start pulls from Docker Hub and risks rate-limit failures. |
