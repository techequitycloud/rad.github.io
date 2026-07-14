---
title: "OpenClaw on GKE Autopilot"
description: "Configuration reference for deploying OpenClaw on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# OpenClaw on GKE Autopilot

OpenClaw is a multi-tenant AI agent gateway purpose-built for isolated, persistent agent
deployments. It lets teams run per-tenant AI assistants backed by Anthropic models, with
dedicated GCS workspaces and optional Telegram or Slack channel integration — all without
shared state between agents. This module deploys OpenClaw on **GKE Autopilot** on top of
the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud
and Kubernetes infrastructure.

This guide focuses on the cloud services OpenClaw uses and how to explore and operate them
from the Google Cloud Console and the command line. For the mechanics common to every GKE
application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

OpenClaw runs as a Node.js gateway workload on GKE Autopilot. The deployment wires together
a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pods, 2 vCPU / 2 GiB by default, horizontally autoscaled |
| Workspace storage | Cloud Storage (GCS Fuse) | Per-tenant workspace bucket mounted at `/data` via the GCS Fuse CSI driver |
| AI credentials | Secret Manager | Anthropic API key and gateway token always stored; Telegram and Slack secrets optional |
| Ingress | Cloud Load Balancing | `ClusterIP` by default (behind a router); `LoadBalancer` or custom domain available |
| Secrets | Secret Manager | All credentials injected at pod startup; plaintext never in config |

**Sensible defaults worth knowing up front:**

- **No database, no Redis.** OpenClaw is a stateful Node.js gateway backed entirely by GCS
  Fuse at `/data`. Cloud SQL and Redis are never provisioned.
- **Custom container image is always built.** The module layers an `entrypoint.sh` onto the
  upstream `ghcr.io/openclaw/openclaw` image. The `BASE_IMAGE` build arg is pinned to
  `application_version`.
- **GCS workspace at `/data` is always mounted.** A dedicated `<prefix>-storage` bucket is
  always provisioned and mounted by the GCS Fuse CSI driver. Persistent agent state lives
  here across pod restarts.
- **`OPENCLAW_STATE_DIR` is on local disk.** npm staging and the XDG config home are
  redirected to `/tmp/openclaw` to avoid GCS Fuse hard-link limitations during startup.
- **`min_instance_count = 1` by default.** Keeps the agent warm so webhook events from
  Telegram or Slack are not dropped during cold-start.
- **Session affinity is `ClientIP`.** Ensures a user's WebSocket sessions are consistently
  routed to the same pod when more than one replica is running.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other identifiers
are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the OpenClaw workload

OpenClaw pods are scheduled on Autopilot, which bills for the CPU/memory the pods actually
request. Horizontal Pod Autoscaling sizes the deployment between the minimum and maximum
replica counts.

- **Console:** Kubernetes Engine → Workloads → select the OpenClaw workload to see pods,
  events, and resource usage. Kubernetes Engine → Services & Ingress shows the service
  endpoint.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud Storage — GCS Fuse workspace

All durable agent state is stored in a dedicated Cloud Storage bucket and mounted into pods
at `/data` by the GCS Fuse CSI driver. The workspace layout is:

```
<prefix>-storage/
├── workspace/              ← agent workspace (/data/workspace)
│   └── skill-library/      ← shared skills repo (when skills_repo_url is set)
├── agents/main/agent/      ← agent state directory
└── ...
```

- **Console:** Cloud Storage → Buckets → select the `<prefix>-storage` bucket.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<prefix>-storage/
  # Confirm the bucket is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /data
  ```

See [App_GKE](App_GKE.md) for GCS Fuse CSI, CMEK options, and bucket lifecycle.

### C. Secret Manager — credentials

The Anthropic API key and the gateway token are always stored in Secret Manager. When
Telegram or Slack integration is enabled, the bot tokens and webhook/signing secrets are
stored there as well. All credentials are injected at pod startup; plaintext never appears
in configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the Anthropic key (initial deploy only; manage via Secret Manager thereafter):
  gcloud secrets versions access latest --secret=<prefix>-anthropic-api-key --project "$PROJECT"
  # Retrieve the gateway token (needed to register clients):
  gcloud secrets versions access latest --secret=<prefix>-gateway-token --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### D. Networking & ingress

By default the workload is exposed as a `ClusterIP` service for internal-only access
(typically behind an OpenClaw router service). A `LoadBalancer` service type or a custom
domain via the Kubernetes Gateway API can be enabled for direct external access.

- **Console:** Kubernetes Engine → Services & Ingress; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud Armor, and static
IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring. An optional
uptime check and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. OpenClaw Application Behaviour

- **No database setup job.** OpenClaw requires no Cloud SQL and no init job. The agent state
  lives entirely on GCS; the first pod startup creates the workspace directories automatically
  via `entrypoint.sh`.
- **Config regenerated on every startup.** `entrypoint.sh` always rewrites `openclaw.json`
  in `$OPENCLAW_STATE_DIR`, ensuring the Terraform-managed environment variables (API keys,
  gateway token, channel settings) win over any stale values previously persisted on GCS.
- **Skills repository sync (optional).** When `skills_repo_url` is set, `entrypoint.sh`
  performs a shallow clone or update of the repository into `/data/workspace/skill-library`
  on every pod startup. The sync is non-fatal — the gateway starts even if the clone fails.
  Inspect the sync on a running pod:
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /data/workspace/skill-library
  ```
- **Health path.** Startup and liveness probes both target `GET /health` on port 8080. The
  startup probe allows up to ~3 minutes (36 × 5 s) for npm to stage the bundled plugin
  packages before the gateway is declared unhealthy.
- **Session affinity.** The Kubernetes Service uses `ClientIP` affinity by default so a
  user's WebSocket connection is consistently routed to the same pod when multiple replicas
  are deployed.
- **Telegram and Slack webhooks.** When `enable_telegram` or `enable_slack` is set, the
  corresponding bot token is injected as `TELEGRAM_BOT_TOKEN` or `SLACK_BOT_TOKEN`. The
  webhook/signing secrets are stored in Secret Manager for a companion router service and are
  not injected into the agent container.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for OpenClaw are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |
| `anthropic_api_key` | _(required on first deploy)_ | Anthropic API key. Stored in Secret Manager and injected as `ANTHROPIC_API_KEY`. Omit on updates to retain the stored value. Sensitive. |
| `gateway_token` | _(auto-generated)_ | Gateway authentication token. A secure 64-character hex token is generated when left blank. Stored in Secret Manager as `OPENCLAW_GATEWAY_TOKEN`. Sensitive. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `openclaw` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `OpenClaw Gateway` | Friendly name shown in the Console. |
| `description` | `OpenClaw AI Gateway - Multi-tenant AI agent gateway on GKE Autopilot` | Brief description of the application's purpose. |
| `application_version` | `latest` | OpenClaw image tag used as the `BASE_IMAGE` build arg. Pin to a specific release for reproducible builds. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | CPU and memory limits. Minimum 2 vCPU / 2 GiB recommended for agent workloads. |
| `min_instance_count` | `1` | Minimum pod replicas. Keep ≥ 1 so webhook events are not dropped during cold start. |
| `max_instance_count` | `3` | Maximum pod replicas. OpenClaw is stateful — use 1 per tenant unless using sticky session routing. |
| `container_port` | `8080` | Port the OpenClaw gateway listens on. Must match the `PORT` env var. |
| `timeout_seconds` | `3600` | Request timeout. Agent sessions are long-running; 3600 s is the maximum. |
| `enable_image_mirroring` | `true` | Mirror the built image to Artifact Registry before deployment. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically (disables HPA). |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Module-managed vars (`OPENCLAW_STATE_DIR`, `NODE_ENV`, etc.) always take precedence. |
| `secret_environment_variables` | `{}` | Map of env var → existing Secret Manager secret name. Core credentials are handled automatically. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `gke_cluster_name` | `""` | GKE cluster name. Auto-discovers the Services_GCP-managed cluster when empty. |
| `namespace_name` | `""` | Kubernetes namespace. Auto-generated from resource prefix when empty. |
| `workload_type` | `null` | `Deployment` for GCS-backed stateless replicas; `StatefulSet` for sticky pod identity. |
| `service_type` | `LoadBalancer` | `ClusterIP` for internal-only; `LoadBalancer` for direct external access. |
| `session_affinity` | `ClientIP` | Sticky routing for WebSocket session consistency across replicas. |
| `termination_grace_period_seconds` | `60` | Grace period for active agent sessions to complete before pod termination. |
| `network_tags` | `[]` | Node/pod network tags for firewall rules. |

### Group 7 — StatefulSet Configuration

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable a PVC for StatefulSet. OpenClaw normally uses GCS — enable only when local disk performance is required. |
| `stateful_pvc_size` | `10Gi` | PVC size. |
| `stateful_pvc_mount_path` | `/pvc-data` | Container mount path for the PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |
| `stateful_headless_service` | `null` | Create a headless Service for stable network identities. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` or `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` or `OnDelete`. |
| `stateful_fs_group` | `0` | fsGroup GID in the pod security context; `0` leaves it unset. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 if you need eviction headroom. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/health`, 36-attempt threshold | Allows ~3 minutes for npm startup and GCS Fuse mount. |
| `liveness_probe` / `health_check_config` | HTTP `/health` | Restarts the pod if the gateway becomes unresponsive. |
| `uptime_check_config` | `{ enabled = false }` | Disabled by default for `ClusterIP` services (not externally reachable). |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Workload Automation

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | OpenClaw has no default init job. Use for custom workspace seeding. |
| `cron_jobs` | `[]` | Recurring Kubernetes CronJobs (e.g. workspace archival). |
| `additional_services` | `[]` | Sidecar or companion services (e.g. an OpenClaw router). |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — NFS

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | OpenClaw uses GCS Fuse for state. NFS is not required and disabled by default. |
| `nfs_mount_path` | `/mnt/nfs` | NFS mount path. Only used when `enable_nfs = true`. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision additional buckets defined in `storage_buckets`. The workspace bucket is always created. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned workspace bucket. |
| `gcs_volumes` | `[]` | Additional GCS Fuse mounts. The `openclaw-data` volume at `/data` is always appended. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 15 — OpenClaw Configuration

| Variable | Default | Description |
|---|---|---|
| `skills_repo_url` | `""` | GitHub URL of a shared skills repository. Cloned into `/data/workspace/skill-library` on every pod startup. Leave empty to skip. |
| `skills_repo_ref` | `main` | Git ref (branch, tag, or SHA) to check out. |
| `enable_telegram` | `false` | Provision a Telegram bot token secret and inject `TELEGRAM_BOT_TOKEN`. Requires `telegram_bot_token`. |
| `telegram_bot_token` | `""` | Telegram bot token from @BotFather. Sensitive. |
| `telegram_webhook_secret` | `""` | Webhook validation secret for the router (not injected into the agent). Generate with `openssl rand -hex 32`. Sensitive. |
| `enable_slack` | `false` | Provision Slack secrets and inject `SLACK_BOT_TOKEN`. Requires `slack_bot_token`. |
| `slack_bot_token` | `""` | Slack bot token (`xoxb-...`). Sensitive. |
| `slack_signing_secret` | `""` | Slack signing secret for the router (not injected into the agent). Sensitive. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron for automated workspace backup (UTC). |
| `backup_retention_days` | `7` | Retention days; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Import a workspace backup on deploy. `backup_format` defaults to `tar`. |

### Group 19 — Custom Domain & Static IP

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision a Kubernetes Gateway with SSL for custom hostnames. Required for IAP. |
| `application_domains` | `[]` | Custom hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of OpenClaw. Requires `enable_custom_domain`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled. Sensitive. |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `cloud_armor_policy_name` | `default-waf-policy` | Policy name. |
| `enable_cdn` | `false` | Enable Cloud CDN on the load balancer backend. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` / `admin_ip_ranges` | _(set)_ | Access level CIDRs / dry-run mode / admin CIDRs. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate and
explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach the OpenClaw gateway. |
| `storage_buckets` | Created Cloud Storage buckets (including the workspace bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `initialization_jobs` | Names of any custom init jobs. |
| `cron_jobs` | Names of created CronJobs. |
| `statefulset_name` | StatefulSet name (when `workload_type = "StatefulSet"`). |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Connected GitHub repo. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | `true` when the cluster endpoint is available and all Kubernetes resources are deployed. `false` on the first apply of a new inline cluster — a second apply is required. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `anthropic_api_key` | Set on first deploy | Critical | Without a valid key the agent starts but all AI requests fail with 401 errors. |
| `gateway_token` consistency | Auto-generated or set once | Critical | Rotating the token in Secret Manager without restarting pods causes all client requests to be rejected until pods are recycled. |
| `quota_memory_requests` / `quota_memory_limits` | binary units | Critical | Bare integers are bytes and block all pod scheduling. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `telegram_bot_token` / `slack_bot_token` | set when integration enabled | High | Empty token causes all API calls to fail; messages are dropped. |
| `telegram_webhook_secret` / `slack_signing_secret` | set when integration enabled | High | Empty value disables signature verification, allowing fake webhook injection. |
| `min_instance_count` | `1` | High | `0` means webhook events from Telegram/Slack are dropped during cold start (typically 30–60 s for GKE pod init). |
| `skills_repo_url` | reachable URL or empty | High | An unreachable URL causes the git clone to fail at startup, putting the pod in CrashLoopBackOff. |
| `skills_repo_ref` | existing ref | High | A non-existent branch or tag causes the clone to fail at every startup. |
| `session_affinity` | `ClientIP` | High | Without stickiness, multi-replica deployments split WebSocket state across pods. |
| `enable_iap` | enable for admin-facing | Medium | The gateway is otherwise publicly reachable. Telegram/Slack webhook endpoints cannot authenticate with Google identity — ensure they are not behind IAP. |
| `stateful_pvc_enabled` | `false` | Medium | OpenClaw uses GCS. PVCs add unused local disk and can block rescheduling. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance; an accidental bucket purge permanently loses agent state. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |
| `enable_vpc_sc` without `organization_id` | set explicitly | Medium | VPC-SC is silently skipped, leaving credentials without perimeter protection. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity, autoscaling,
ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups,
and image mirroring — see **[App_GKE](App_GKE.md)**. OpenClaw-specific application
configuration shared with the Cloud Run variant is described in
**[OpenClaw_Common](OpenClaw_Common.md)**.
