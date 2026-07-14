---
title: "OpenClaw on Google Cloud Run"
description: "Configuration reference for deploying OpenClaw on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# OpenClaw on Google Cloud Run

OpenClaw is a multi-tenant AI agent gateway purpose-built for isolated, persistent agent
deployments. It lets teams run per-tenant AI assistants backed by Anthropic models, with
dedicated GCS workspaces and optional Telegram or Slack channel integration — all without
shared state between agents. This module deploys OpenClaw on **Cloud Run v2** on top of
the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services OpenClaw uses and how to explore and operate them
from the Google Cloud Console and the command line. For the mechanics common to every Cloud
Run application — service identity, ingress and load balancing, scaling and concurrency,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather
than repeating them here.

---

## 1. Overview

OpenClaw runs as a Node.js container on Cloud Run v2 (Gen2). The deployment wires together
a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 (Gen2) | Node.js service, 1 vCPU / 1 GiB by default, CPU always allocated |
| Workspace storage | Cloud Storage (GCS Fuse) | Per-tenant workspace bucket mounted at `/data` via GCS Fuse |
| AI credentials | Secret Manager | Anthropic API key and gateway token always stored; Telegram and Slack secrets optional |
| Ingress | Cloud Run URL / Cloud Load Balancing | Internal by default (behind a router); optional external HTTPS LB + custom domain |
| Secrets | Secret Manager | All credentials injected at runtime; plaintext never in config |

**Sensible defaults worth knowing up front:**

- **No database, no Redis.** OpenClaw is a stateful Node.js gateway backed entirely by GCS
  Fuse at `/data`. Cloud SQL and Redis are never provisioned.
- **CPU is always allocated.** `cpu_always_allocated = true` is required. WebSocket
  connections and async agent operations break under CPU throttling. Do not set to `false`.
- **Gen2 execution environment is required.** GCS Fuse volume mounts are not available in
  Gen1 and will silently fail.
- **Custom container image is always built.** The module layers an `entrypoint.sh` onto the
  upstream `ghcr.io/openclaw/openclaw` image.
- **GCS workspace at `/data` is always mounted.** A dedicated `<prefix>-storage` bucket is
  always provisioned and mounted. Persistent agent state lives here across container restarts.
- **`OPENCLAW_STATE_DIR` is on local disk.** npm staging and the XDG config home are
  redirected to `/tmp/openclaw` to avoid GCS Fuse hard-link limitations during startup.
- **`min_instance_count = 0` by default (scale-to-zero).** Set to `1` for latency-sensitive
  agent deployments to avoid 15–20 s cold starts.
- **`max_instance_count = 1` per tenant.** OpenClaw is stateful; multiple instances for the
  same tenant split state across replicas unless sticky routing is in place.
- **Ingress defaults to `internal`.** The gateway is designed to be fronted by an OpenClaw
  router. Set to `all` for direct public access.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported
in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the OpenClaw service

OpenClaw runs as a Cloud Run v2 service on the Gen2 execution environment. CPU is always
allocated to support WebSocket connections and async agent operations. Each deployment creates
an immutable revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud Storage — GCS Fuse workspace

All durable agent state is stored in a dedicated Cloud Storage bucket and mounted into the
service at `/data` by GCS Fuse. The workspace layout is:

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
  ```

See [App_CloudRun](App_CloudRun.md) for the GCS Fuse mount, CMEK options, and
bucket lifecycle.

### C. Secret Manager — credentials

The Anthropic API key and the gateway token are always stored in Secret Manager. When
Telegram or Slack integration is enabled, the bot tokens and webhook/signing secrets are
stored there as well. All credentials are injected into the service at runtime.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the Anthropic key (initial deploy only; manage via Secret Manager thereafter):
  gcloud secrets versions access latest --secret=<prefix>-anthropic-api-key --project "$PROJECT"
  # Retrieve the gateway token (needed to register clients):
  gcloud secrets versions access latest --secret=<prefix>-gateway-token --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default, restricted to internal VPC traffic
(`ingress_settings = "internal"`). An external HTTPS load balancer with a custom domain,
Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring, with
optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. OpenClaw Application Behaviour

- **No database setup job.** OpenClaw requires no Cloud SQL and no init job. The agent state
  lives entirely on GCS; the first container startup creates the workspace directories
  automatically via `entrypoint.sh`.
- **Config regenerated on every startup.** `entrypoint.sh` always rewrites `openclaw.json`
  in `$OPENCLAW_STATE_DIR`, ensuring the Terraform-managed environment variables (API keys,
  gateway token, channel settings) win over any stale values previously persisted on GCS.
- **Skills repository sync (optional).** When `skills_repo_url` is set, `entrypoint.sh`
  performs a shallow clone or update of the repository into `/data/workspace/skill-library`
  on every container startup. The sync is non-fatal — the gateway starts even if the clone
  fails. Check Cloud Logging for `skill-library` entries to verify sync status.
- **Health path.** Startup and liveness probes both target `GET /health` on port 8080. The
  startup probe allows ~2 minutes for GCS Fuse mount and Node.js startup.
- **Telegram and Slack webhooks.** When `enable_telegram` or `enable_slack` is set, the
  corresponding bot token is injected as `TELEGRAM_BOT_TOKEN` or `SLACK_BOT_TOKEN`. The
  webhook/signing secrets are stored in Secret Manager for a companion router service and are
  not injected into the agent container.
- **Scale-to-zero and cold starts.** With `min_instance_count = 0`, Telegram/Slack webhook
  events arriving during a cold start (15–20 s) may be dropped. Set `min_instance_count = 1`
  for production agent deployments.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for OpenClaw are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |
| `anthropic_api_key` | _(required on first deploy)_ | Anthropic API key. Stored in Secret Manager and injected as `ANTHROPIC_API_KEY`. Omit on updates to retain the stored value. Sensitive. |
| `gateway_token` | _(auto-generated)_ | Gateway authentication token. A secure 64-character hex token is generated when left blank. Stored in Secret Manager as `OPENCLAW_GATEWAY_TOKEN`. Sensitive. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `openclaw` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `OpenClaw Gateway` | Friendly name shown in the Console. |
| `description` | `OpenClaw AI Gateway - Serverless multi-tenant AI agent gateway on Cloud Run` | Service description. |
| `application_version` | `latest` | OpenClaw image tag used as the `BASE_IMAGE` build arg. Pin to a specific release for reproducible builds. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `1Gi` | Memory per instance. Sized for light/typical usage (observed ~400Mi peak); raise to `2Gi` for heavier concurrent agent sessions. |
| `min_instance_count` | `0` | `0` enables scale-to-zero (15–20 s cold start). Set ≥ `1` to eliminate cold starts. |
| `max_instance_count` | `1` | Keep at `1` per tenant to avoid split-state. Increase only with sticky routing. |
| `container_port` | `8080` | Port the OpenClaw gateway listens on. Must match the `PORT` env var. |
| `execution_environment` | `gen2` | Gen2 **required** for GCS Fuse. Do not change to `gen1`. |
| `cpu_always_allocated` | `true` | Required for WebSocket connections and async operations. Do not set to `false`. |
| `timeout_seconds` | `3600` | Maximum request duration. Agent sessions are long-running; 3600 s is the maximum. |
| `enable_cloudsql_volume` | `false` | OpenClaw does not use Cloud SQL. Leave `false`. |
| `traffic_split` | `[]` | Canary/blue-green traffic allocation. All entries must sum to 100. |
| `max_revisions_to_retain` | `7` | Old revisions to keep after each deployment. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `internal` for VPC-only (recommended behind a router); `all` for direct public access. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | VPC egress routing. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Module-managed vars (`OPENCLAW_STATE_DIR`, `NODE_ENV`, etc.) always take precedence. |
| `secret_environment_variables` | `{}` | Map of env var → existing Secret Manager secret name. Core credentials are handled automatically. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Rotation notification frequency (30 days). |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron for automated workspace backup (UTC). |
| `backup_retention_days` | `7` | Retention days; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_format` | restore options | Import a workspace backup on deploy. `backup_format` defaults to `tar`. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision a Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDRs exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision additional buckets defined in `storage_buckets`. The workspace bucket is always created. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned workspace bucket. |
| `enable_nfs` | `false` | OpenClaw uses GCS Fuse for state. NFS is not required and disabled by default. |
| `gcs_volumes` | `[]` | Additional GCS Fuse mounts. The `openclaw-data` volume at `/data` is always appended. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | OpenClaw has no default init job. Use for custom workspace seeding. |
| `cron_jobs` | `[]` | Recurring Cloud Run jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/health`, 24-attempt threshold | Allows ~2 minutes for GCS Fuse mount and Node.js startup. |
| `liveness_probe` / `health_check_config` | HTTP `/health` | Restarts the container if the gateway becomes unresponsive. |
| `uptime_check_config` | `{ enabled = false, path = "/health" }` | Cloud Monitoring uptime check. Disabled by default; enable for production monitoring. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 15 — OpenClaw Configuration

| Variable | Default | Description |
|---|---|---|
| `skills_repo_url` | `""` | GitHub URL of a shared skills repository. Cloned into `/data/workspace/skill-library` on every container startup. Leave empty to skip. |
| `skills_repo_ref` | `main` | Git ref (branch, tag, or SHA) to check out. |
| `enable_telegram` | `false` | Provision a Telegram bot token secret and inject `TELEGRAM_BOT_TOKEN`. Requires `telegram_bot_token`. |
| `telegram_bot_token` | `""` | Telegram bot token from @BotFather. Sensitive. |
| `telegram_webhook_secret` | `""` | Webhook validation secret for the router (not injected into the agent). Generate with `openssl rand -hex 32`. Sensitive. |
| `enable_slack` | `false` | Provision Slack secrets and inject `SLACK_BOT_TOKEN`. Requires `slack_bot_token`. |
| `slack_bot_token` | `""` | Slack bot token (`xoxb-...`). Sensitive. |
| `slack_signing_secret` | `""` | Slack signing secret for the router (not injected into the agent). Sensitive. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running
resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `storage_buckets` | Created Cloud Storage buckets (including the workspace bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `initialization_jobs` | Names of any custom init jobs. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Connected GitHub repo. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `anthropic_api_key` | Set on first deploy | Critical | Without a valid key the agent starts but all AI requests fail with 401 errors. |
| `gateway_token` consistency | Auto-generated or set once | Critical | Rotating the token in Secret Manager without redeploying the service causes all client requests to be rejected until the service is redeployed. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `execution_environment` | `gen2` | High | Gen1 does not support GCS Fuse; the workspace mount silently fails. |
| `cpu_always_allocated` | `true` | High | CPU throttling breaks WebSocket connections and async agent operations. |
| `telegram_bot_token` / `slack_bot_token` | set when integration enabled | High | Empty token causes all API calls to fail; messages are dropped. |
| `telegram_webhook_secret` / `slack_signing_secret` | set when integration enabled | High | Empty value disables signature verification, allowing fake webhook injection. |
| `min_instance_count` | `1` for production agents | High | `0` means webhook events from Telegram/Slack are dropped during cold start (15–20 s). |
| `skills_repo_url` | reachable URL or empty | High | An unreachable URL causes the git clone to fail at startup, restarting the container. |
| `skills_repo_ref` | existing ref | High | A non-existent branch or tag causes the clone to fail at every startup. |
| `max_instance_count` | `1` per tenant | High | Multiple instances for the same tenant split agent state across replicas. |
| `enable_iap` | enable for admin-facing | Medium | The gateway is otherwise reachable at its `run.app` URL. Telegram/Slack webhook endpoints cannot authenticate with Google identity — ensure they are not behind IAP. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance; an accidental bucket purge permanently loses agent state. |
| `enable_vpc_sc` without `organization_id` | set explicitly | Medium | VPC-SC is silently skipped, leaving credentials without perimeter protection. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. OpenClaw-
specific application configuration shared with the GKE variant is described in
**[OpenClaw_Common](OpenClaw_Common.md)**.
