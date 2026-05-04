# OpenClaw_GKE Module — Configuration Guide

OpenClaw is a multi-tenant AI agent gateway that provides WebSocket-enabled conversational AI agents with persistent GCS-backed workspace storage. This module deploys OpenClaw on **GKE Autopilot** as a Kubernetes Deployment, backed by GCS Fuse CSI driver for durable agent workspace and Secret Manager for credential management.

`OpenClaw_GKE` is a **wrapper module** built on top of `App_GKE`. It delegates all GCP infrastructure provisioning to App_GKE (GKE cluster, networking, GCS, Secret Manager, CI/CD) and adds OpenClaw-specific application configuration on top via the `OpenClaw_Common` sub-module.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How This Guide Is Structured

This guide documents the variables that are **unique to `OpenClaw_GKE`** or that have **OpenClaw-specific defaults** that differ from the `App_GKE` base module. For all other variables — project identity, runtime scaling, backend configuration, CI/CD, networking, IAP, Cloud Armor, and VPC Service Controls — refer directly to the [App_GKE Configuration Guide](../App_GKE/App_GKE.md).

| Configuration Area | OpenClaw-Specific Notes |
|---|---|
| Module Metadata (Group 0) | Different `module_description` and `module_documentation` defaults. |
| Project & Identity (Group 1) | Identical. `deployment_region` exposed as a fallback. |
| Application Identity (Group 2) | `application_name` defaults to `"openclaw"`. |
| Runtime & Scaling (Group 3) | `container_resources` defaults to `cpu_limit="2000m"`, `memory_limit="2Gi"`. `min_instance_count=1`, `max_instance_count=3`. |
| Environment Variables (Group 4) | Module-managed vars always injected by `OpenClaw_Common` — see [Platform-Managed Behaviours](#platform-managed-behaviours). |
| GKE Backend Config (Group 5) | `workload_type` defaults to `"Deployment"`. `session_affinity` defaults to `"ClientIP"`. `service_type` defaults to `"ClusterIP"`. |
| StatefulSet Config (Group 6) | Available for sticky pod identity; not required for standard GCS-backed deployments. |
| Resource Quota (Group 7) | Identical. |
| Reliability Policies (Group 8) | `enable_pod_disruption_budget=true`, `pdb_min_available="1"` by default. |
| Observability (Group 9) | Probes target `/health`. See [Health Probes](#health-probes). |
| Workload Automation (Group 10) | No default initialization jobs. |
| CI/CD (Group 11) | Identical. |
| NFS (Group 12) | `enable_nfs=false` by default. OpenClaw uses GCS Fuse for state. |
| Cloud Storage (Group 13) | Module-managed workspace bucket at `/data` always provisioned. |
| OpenClaw Config (Group 14) | Skills repo, AI credentials, and messaging platform integration — see [OpenClaw Configuration](#openclaw-configuration). |
| Backup (Group 16) | Present for interface compatibility. OpenClaw state is natively durable in GCS. |
| Custom Domain (Group 18) | Standard. `enable_custom_domain` required for IAP. |
| IAP (Group 19) | Requires `iap_oauth_client_id`, `iap_oauth_client_secret`, `iap_support_email`. See [IAP](#identity-aware-proxy-gke-specific). |
| Cloud Armor (Group 20) | Standard. |
| VPC Service Controls (Group 21) | Identical. |

---

## Platform-Managed Behaviours

The following behaviours are applied automatically by `OpenClaw_GKE` (via the `OpenClaw_Common` sub-module) regardless of variable values in your `tfvars` file.

| Behaviour | Detail |
|---|---|
| **No database** | `database_type = "NONE"` and `enable_redis = false` are hard-coded in `main.tf`. Cloud SQL and Redis are never provisioned. |
| **Custom image build** | `OpenClaw_Common` sets `image_source = "custom"`. A custom image is always built that layers `entrypoint.sh` onto `ghcr.io/openclaw/openclaw:<application_version>`. The `BASE_IMAGE` build arg is set at Cloud Build time. |
| **GCS workspace at `/data`** | `OpenClaw_Common` always appends an `openclaw-data` GCS Fuse volume at `/data` with `uid=1000,gid=1000` mount options. The `<prefix>-storage` bucket is always provisioned. |
| **State dir on local disk** | `OPENCLAW_STATE_DIR=/tmp/openclaw` and `XDG_CONFIG_HOME=/tmp/openclaw` are always injected. This prevents npm staging failures caused by GCS Fuse's lack of hard-link support. Persistent agent workspace and agent state remain on `/data`. |
| **Fixed environment variables** | `NODE_ENV=production`, `NODE_OPTIONS=--max-old-space-size=1536`, `NPM_CONFIG_CACHE=/tmp/.npm` are always set. |
| **Skills sync on startup** | If `SKILLS_REPO_URL` is set, `entrypoint.sh` clones or updates the repository into `/data/workspace/skill-library` on every pod startup. Non-fatal — the gateway starts even if clone fails. |
| **Config regenerated on startup** | `entrypoint.sh` always overwrites `openclaw.json` in `$OPENCLAW_STATE_DIR`, ensuring Terraform-managed env vars win over stale GCS-persisted values. |
| **Session affinity defaults to `ClientIP`** | Ensures a given user's WebSocket sessions are consistently routed to the same pod when multiple replicas are deployed. |
| **Anthropic secret always created** | `OpenClaw_Common` creates the `<prefix>-anthropic-api-key` Secret Manager secret unconditionally. The secret version is only written when `anthropic_api_key` is non-empty. |

---

## OpenClaw Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `"openclaw"` | Internal identifier used as the base name for the Kubernetes service, GCS bucket, and related resources. Do not change after initial deployment. |
| `application_display_name` | `"OpenClaw Gateway"` | Human-readable name shown in the platform UI and monitoring dashboards. Can be updated freely. |
| `description` | `"OpenClaw AI Gateway - Multi-tenant AI agent gateway on GKE Autopilot"` | Brief description populated into Kubernetes annotations. |
| `application_version` | `"latest"` | OpenClaw image tag used as the `BASE_IMAGE` Docker build arg. Pin to a specific version (e.g. `"1.2.3"`) for reproducible builds. |

---

## Runtime & Scaling

`OpenClaw_GKE` uses a single structured `container_resources` object (as required by `App_GKE`) rather than separate `cpu_limit` and `memory_limit` top-level variables.

| Variable | Group | Default | Description |
|---|---|---|---|
| `container_resources` | 3 | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | CPU and memory limits. Optional `cpu_request`, `mem_request`, `ephemeral_storage_limit`, `ephemeral_storage_request`. Minimum 2 vCPU / 2 Gi recommended for agent workloads. |
| `min_instance_count` | 3 | `1` | Minimum pod replicas. `1` avoids cold starts for agent sessions. |
| `max_instance_count` | 3 | `3` | Maximum pod replicas. OpenClaw is stateful — per-tenant deployments typically use `1`. Increase only with sticky session routing (`session_affinity = "ClientIP"`). |
| `container_port` | 3 | `8080` | TCP port the OpenClaw gateway listens on. Must match the `PORT` env var. |
| `timeout_seconds` | 3 | `3600` | Request timeout in seconds. Agent sessions can be long-running. |
| `enable_image_mirroring` | 3 | `true` | Mirror the built image to Artifact Registry. |
| `enable_vertical_pod_autoscaling` | 3 | `false` | Enable VPA. When enabled, HPA based on CPU/Memory is disabled to avoid conflicts. |
| `container_protocol` | 3 | `"http1"` | Service protocol. Options: `"http1"`, `"h2c"`. |

**Key differences from `App_GKE` defaults:**

| Variable | App_GKE default | OpenClaw_GKE default | Reason |
|---|---|---|---|
| `container_resources.cpu_limit` | `"1000m"` | `"2000m"` | OpenClaw Node.js gateway benefits from at least 2 vCPU. |
| `container_resources.memory_limit` | `"512Mi"` | `"2Gi"` | Agent state and plugin staging require more memory. |
| `min_instance_count` | `1` | `1` | Keep warm to avoid cold-start latency for agent sessions. |
| `session_affinity` | `"None"` | `"ClientIP"` | WebSocket stickiness — routes a user's requests to the same pod. |
| `service_type` | `"ClusterIP"` | `"ClusterIP"` | Internal-only by default; external traffic flows through a router or `enable_custom_domain`. |

---

## GKE Backend Configuration

| Variable | Group | Default | Description |
|---|---|---|---|
| `gke_cluster_name` | 5 | `""` | GKE Autopilot cluster name. Auto-discovers the Services_GCP-managed cluster when empty. |
| `namespace_name` | 5 | `""` | Kubernetes namespace. Auto-generated from resource prefix when empty. |
| `workload_type` | 5 | `"Deployment"` | `"Deployment"` for stateless replicas with GCS-backed state, or `"StatefulSet"` for sticky pod identity. |
| `service_type` | 5 | `"ClusterIP"` | `"ClusterIP"` for internal-only access; `"LoadBalancer"` for direct external access. |
| `session_affinity` | 5 | `"ClientIP"` | ClientIP affinity ensures WebSocket stickiness. Set to `"None"` only for stateless replicas. |
| `termination_grace_period_seconds` | 5 | `60` | Allow sufficient time for active agent sessions to complete before pod termination. Valid range: 0–3600. |
| `configure_service_mesh` | 5 | `false` | Enable Istio sidecar injection for this namespace. |
| `enable_network_segmentation` | 5 | `false` | Enable Kubernetes NetworkPolicies restricting pod-to-pod traffic to within the same namespace. |
| `deployment_timeout` | 5 | `1800` | Timeout in seconds for waiting for the deployment to complete. |
| `network_tags` | 5 | `[]` | Network tags applied to workload pods. |

---

## StatefulSet Configuration

When `workload_type = "StatefulSet"`, these variables control the StatefulSet behavior. OpenClaw normally uses GCS Fuse for state; PVC is only needed when local disk performance is required.

| Variable | Group | Default | Description |
|---|---|---|---|
| `stateful_pvc_enabled` | 6 | `false` | Enable a PVC for StatefulSet. Use GCS Fuse instead unless local disk I/O is required. |
| `stateful_pvc_size` | 6 | `"10Gi"` | PVC size. |
| `stateful_pvc_mount_path` | 6 | `"/pvc-data"` | Container mount path for the PVC. |
| `stateful_pvc_storage_class` | 6 | `"standard-rwo"` | Storage class for the PVC. |
| `stateful_headless_service` | 6 | `true` | Create a headless service for stable network identities. |
| `stateful_pod_management_policy` | 6 | `"OrderedReady"` | Pod management policy: `"OrderedReady"` or `"Parallel"`. |
| `stateful_update_strategy` | 6 | `"RollingUpdate"` | Update strategy: `"RollingUpdate"` or `"OnDelete"`. |

---

## Reliability Policies

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_pod_disruption_budget` | 8 | `true` | Enable PodDisruptionBudget to ensure minimum availability during voluntary disruptions. |
| `pdb_min_available` | 8 | `"1"` | Minimum pods that must remain available. `"1"` ensures at least one pod is always running. |
| `enable_topology_spread` | 8 | `false` | Distribute pods across zones. |
| `topology_spread_strict` | 8 | `false` | Use `DoNotSchedule` when topology spread cannot be satisfied. |

---

## Health Probes

OpenClaw exposes `/health` on port 8080. All probes target this path.

`OpenClaw_GKE` exposes a dual probe system:

**`startup_probe` / `liveness_probe`** — passed to `OpenClaw_Common` to configure the application-level probes.

**`startup_probe_config` / `health_check_config`** — passed directly to `App_GKE` for Kubernetes probe configuration.

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 9 | `{ enabled=true, type="HTTP", path="/health", initial_delay_seconds=10, timeout_seconds=5, period_seconds=5, failure_threshold=36 }` | Passed to `OpenClaw_Common`. 36 × 5s + 10s initial = ~190s, giving headroom for npm to stage 35+ bundled plugin packages before the gateway starts. |
| `liveness_probe` | 9 | `{ enabled=true, type="HTTP", path="/health", initial_delay_seconds=30, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Passed to `OpenClaw_Common`. |
| `startup_probe_config` | 9 | `{ enabled=true, path="/health", initial_delay_seconds=10, failure_threshold=36, period_seconds=5 }` | Kubernetes startup probe. 36-attempt threshold gives ~3 minutes for gateway startup. |
| `health_check_config` | 9 | `{ enabled=true, path="/health", initial_delay_seconds=30, failure_threshold=3, period_seconds=30 }` | Kubernetes liveness probe. |
| `uptime_check_config` | 9 | `{ enabled=false, path="/health" }` | Cloud Monitoring uptime check. Disabled by default for GKE (ClusterIP services are not externally reachable). |
| `alert_policies` | 9 | `[]` | Cloud Monitoring metric alert policies. |

---

## Workload Automation

OpenClaw has no default initialization job — no database setup is required.

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 10 | `[]` | Kubernetes jobs executed once during deployment for custom workspace seeding. No default job. |
| `cron_jobs` | 10 | `[]` | Recurring Kubernetes CronJobs. |
| `additional_services` | 10 | `[]` | Additional Kubernetes sidecar or helper services deployed alongside the OpenClaw gateway. Useful for deploying an OpenClaw router as a companion service. |

---

## OpenClaw Configuration

### Skills Repository

| Variable | Group | Default | Description |
|---|---|---|---|
| `skills_repo_url` | 14 | `""` | GitHub URL of a shared OpenClaw skills repository. Cloned into `/data/workspace/skill-library` on every pod startup. Leave empty to skip skill syncing. |
| `skills_repo_ref` | 14 | `"main"` | Git ref (branch, tag, or SHA) to check out. |

### AI Provider & Messaging Credentials

All credentials are stored in Secret Manager and injected at pod startup. Plaintext values are never written to Terraform state after the initial secret version is created.

| Variable | Group | Default | Description |
|---|---|---|---|
| `anthropic_api_key` | 14 | `""` | Anthropic API key. Stored in Secret Manager; injected as `ANTHROPIC_API_KEY`. Required on initial deployment; omit on updates to retain stored value. Sensitive. |
| `enable_telegram` | 14 | `false` | Provision Telegram secrets. Requires both `telegram_bot_token` and `telegram_webhook_secret`. |
| `telegram_bot_token` | 14 | `""` | Telegram bot token from @BotFather. Injected as `TELEGRAM_BOT_TOKEN`. Sensitive. |
| `telegram_webhook_secret` | 14 | `""` | Webhook validation secret for the router (not the agent). Stored in Secret Manager; not injected into agent container. Generate with: `openssl rand -hex 32`. Sensitive. |
| `enable_slack` | 14 | `false` | Provision Slack secrets. Requires both `slack_bot_token` and `slack_signing_secret`. |
| `slack_bot_token` | 14 | `""` | Slack bot token (`xoxb-...`). Injected as `SLACK_BOT_TOKEN`. Sensitive. |
| `slack_signing_secret` | 14 | `""` | Slack signing secret for the router (not the agent). Stored in Secret Manager; not injected into agent container. Sensitive. |

**Validation:** `enable_slack = true` requires both `slack_bot_token` and `slack_signing_secret`. `enable_telegram = true` requires both `telegram_bot_token` and `telegram_webhook_secret`. Violations are caught by `validation.tf` preconditions before apply.

---

## Backup & Maintenance

OpenClaw state is natively durable in GCS. These variables are present for interface compatibility with `App_GKE`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 16 | `"0 2 * * *"` | Cron expression for automated workspace backup. |
| `backup_retention_days` | 16 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 16 | `false` | Triggers a one-time workspace import on apply. |
| `backup_source` | 16 | `"gcs"` | Import source: `"gcs"` or `"gdrive"`. |
| `backup_uri` | 16 | `""` | GCS path or Google Drive file ID of the backup to import. Maps to `backup_file` in `App_GKE`. |
| `backup_format` | 16 | `"tar"` | Import format: `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

---

## Identity-Aware Proxy (GKE-specific)

`OpenClaw_GKE` exposes three IAP variables required when `enable_iap = true` and `enable_custom_domain = true`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `iap_oauth_client_id` | 19 | `""` | OAuth client ID. Create in Google Cloud Console > APIs & Services > Credentials. Sensitive. |
| `iap_oauth_client_secret` | 19 | `""` | OAuth client secret. Sensitive. |
| `iap_support_email` | 19 | `""` | Support email shown on the OAuth consent screen. Must be a valid email address. Validated by regex. |

**Note:** IAP on GKE requires `enable_custom_domain = true`. A custom domain with a reserved static IP is used by the Kubernetes Gateway API to provision the IAP-protected ingress.

---

## Custom Domain (Group 18)

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_custom_domain` | 18 | `false` | Enable custom domain via Kubernetes Gateway API with SSL certificates. A static IP is automatically provisioned. |
| `application_domains` | 18 | `[]` | Custom domains for the application. (e.g., `["agent.example.com"]`) |
| `reserve_static_ip` | 18 | `true` | Reserve a static external IP for predictable endpoint configuration. Recommended for production. |
| `static_ip_name` | 18 | `""` | Name for the reserved static IP. Auto-generated from resource prefix when empty. |

---

## Storage (Group 13)

| Variable | Group | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | 13 | `true` | Provision additional GCS buckets defined in `storage_buckets`. The workspace bucket is always created. |
| `storage_buckets` | 13 | `[]` | Additional GCS buckets beyond the auto-provisioned workspace bucket. |
| `gcs_volumes` | 13 | `[]` | Additional GCS Fuse volumes via CSI driver. The `openclaw-data` workspace bucket at `/data` is always mounted. |
| `manage_storage_kms_iam` | 13 | `false` | Creates a CMEK KMS key for GCS encryption. |
| `enable_artifact_registry_cmek` | 13 | `false` | CMEK encryption for Artifact Registry. |

---

## NFS (Group 12)

OpenClaw uses GCS Fuse for state. NFS is disabled by default and not required.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_nfs` | 12 | `false` | Provision a Cloud Filestore NFS instance. Not required for OpenClaw. |
| `nfs_mount_path` | 12 | `"/mnt/nfs"` | NFS mount path. Only used when `enable_nfs = true`. |
| `nfs_instance_name` | 12 | `""` | Existing NFS GCE VM name. Auto-discovered when empty. |
| `nfs_instance_base_name` | 12 | `"app-nfs"` | Base name for inline NFS GCE VM. |

---

## Resource Quota (Group 7)

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_resource_quota` | 7 | `false` | Enable ResourceQuota for namespace resource limits. |
| `quota_cpu_requests` | 7 | `""` | Total CPU requests allowed. |
| `quota_cpu_limits` | 7 | `""` | Total CPU limits allowed. |
| `quota_memory_requests` | 7 | `""` | Total memory requests allowed. |
| `quota_memory_limits` | 7 | `""` | Total memory limits allowed. |
| `quota_max_pods` | 7 | `""` | Maximum pods allowed. |
| `quota_max_services` | 7 | `""` | Maximum services allowed. |
| `quota_max_pvcs` | 7 | `""` | Maximum PVCs allowed. |

---

## Outputs

| Output | Description |
|---|---|
| `service_name` | Kubernetes service name. |
| `namespace` | Kubernetes namespace. |
| `service_cluster_ip` | ClusterIP of the Kubernetes service. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP when a static IP is reserved. |
| `service_url` | Service URL (ClusterIP internal URL or custom domain). |
| `storage_buckets` | All provisioned GCS buckets including the workspace bucket. |
| `network_name` | VPC network name. |
| `network_exists` | Whether the VPC network exists. |
| `regions` | Available regions in the VPC. |
| `nfs_server_ip` | NFS server internal IP (sensitive). Empty when `enable_nfs = false`. |
| `nfs_mount_path` | NFS mount path in containers. |
| `nfs_share_path` | NFS share path on server. |
| `container_image` | Container image URI used for the deployment. |
| `container_registry` | Artifact Registry repository name. |
| `monitoring_enabled` | Whether Cloud Monitoring is configured. |
| `monitoring_notification_channels` | Monitoring notification channel names. |
| `deployment_id` | Unique deployment identifier. |
| `tenant_id` | Tenant identifier. |
| `resource_prefix` | Resource naming prefix (`app<name><tenant><id>`). |
| `project_id` | GCP project ID. |
| `project_number` | GCP project number. |
| `initialization_jobs` | Created initialization job names. |
| `cron_jobs` | Created cron job names. |
| `statefulset_name` | StatefulSet name (when `workload_type = "StatefulSet"`). |
| `nfs_setup_job` | NFS setup job name. |
| `db_import_job` | Database import job name. |
| `deployment_summary` | Summary of the deployment configuration. |
| `cicd_enabled` | Whether CI/CD pipeline is enabled. |
| `github_repository_url` | GitHub repository URL connected for CI/CD. |
| `github_repository_owner` | GitHub repository owner/organization. |
| `github_repository_name` | GitHub repository name. |
| `artifact_registry_repository` | Artifact Registry repository. |
| `cloudbuild_trigger_name` | Cloud Build trigger name. |
| `cloudbuild_trigger_id` | Cloud Build trigger ID. |
| `cicd_configuration` | CI/CD pipeline configuration details. |
| `kubernetes_ready` | `true` when the GKE cluster endpoint is available and all Kubernetes resources are deployed. `false` on the first apply of a new inline cluster — a second apply is required to complete deployment. |

---

## Platform-Specific Comparison

| Aspect | OpenClaw_CloudRun | OpenClaw_GKE |
|---|---|---|
| Compute | Cloud Run v2 (serverless) | GKE Autopilot (Kubernetes) |
| `min_instance_count` default | `0` (scale-to-zero) | `1` (always warm) |
| `max_instance_count` default | `1` | `3` |
| CPU always allocated | `true` (hard-coded) | Not applicable (Kubernetes always allocates) |
| Session affinity | Cloud Run-native IAP/IAP | `ClientIP` (Kubernetes Service sessionAffinity) |
| Service endpoint | `<service>.run.app` URL | `http://<service>.<ns>.svc.cluster.local` |
| IAP mechanism | Cloud Run native IAP | Kubernetes Gateway API + IAP |
| GCS Fuse driver | Cloud Run GCS Fuse extension | GCS Fuse CSI driver |
| Scaling mechanism | Cloud Run autoscaler | Kubernetes HPA |
| StatefulSet support | Not available | Available via `workload_type = "StatefulSet"` |
| `kubernetes_ready` output | Not applicable | Gating all Kubernetes resource creation |
