---
title: "Ntfy on Google Cloud Run"
description: "Configuration reference for deploying Ntfy on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Ntfy on Google Cloud Run

ntfy is an open-source, Apache 2.0-licensed pub/sub push-notification server written
in Go. Applications publish messages over a simple REST/HTTP API and clients receive
them instantly over WebSocket or Server-Sent-Events (SSE) streams — no external
database required. This module deploys ntfy on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services ntfy uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

ntfy runs as a single Go container on Cloud Run v2. The deployment wires together a
deliberately small set of Google Cloud services — ntfy has no database, cache, or
object-storage dependency of its own:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single Go service, 1 vCPU / 512 MiB by default; CPU always allocated for long-lived streams |
| Database | **None** | `database_type = "NONE"`; message cache is a local SQLite file, no Cloud SQL provisioned |
| Persistence | Ephemeral disk (default) or NFS (optional) | SQLite cache at `/var/cache/ntfy/cache.db`; enable NFS for durable message history |
| Object storage | **None** | ntfy stores nothing in Cloud Storage |
| Cache / queue | **None** | No Redis; ntfy uses an in-process message bus |
| Secrets | Secret Manager | No auto-generated secrets; only user-supplied `secret_environment_variables` |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No database is provisioned.** `database_type = "NONE"` — ntfy keeps its message
  cache in a local SQLite file. The database-related variables exist for
  completeness but are inert unless you deliberately opt in to an external database.
- **The message cache is ephemeral by default.** It lives at
  `/var/cache/ntfy/cache.db`. Cloud Run's root filesystem is read-only, so the
  entrypoint falls back to `/tmp/ntfy` when the configured directory is not
  writable. Message history is therefore lost on each restart/redeploy unless you
  enable NFS (`enable_nfs = true`) and point the cache directory at the mount.
- **CPU is always allocated (`cpu_always_allocated = true`).** ntfy holds long-lived
  WebSocket/SSE streams open to push messages to connected subscribers in real time,
  so CPU must not be throttled between requests. Flipping this to `false` saves cost
  on a low-traffic instance but pauses real-time delivery while idle.
- **Single instance by default** (`min_instance_count = 1`, `max_instance_count = 1`).
  Because a subscriber's stream is anchored to the instance that holds it and there
  is no shared message bus, scaling out is not the default. Keep max at 1 unless you
  place a shared cache/broker behind ntfy.
- **Public ingress is the default** (`ingress_settings = "all"`) so publishers and
  subscribers can reach the service. Enabling IAP requires Google sign-in and blocks
  unauthenticated publish/subscribe calls.
- **The health endpoint is `/v1/health`**, which returns `{"healthy":true}` with HTTP
  200 as soon as the server binds its port.
- **Access control is a post-deploy step.** ntfy ships with open access; configure
  users and topic ACLs afterwards via its CLI or `NTFY_AUTH_*` environment variables.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the ntfy service

ntfy runs as a Cloud Run v2 service. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts. Because CPU is always
allocated, an active instance keeps its subscriber streams alive between requests.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Persistence — the SQLite message cache

ntfy has **no Cloud SQL instance**. Its message cache is a local SQLite file at
`NTFY_CACHE_FILE` (`/var/cache/ntfy/cache.db`), created by the entrypoint on boot.
On Cloud Run's read-only root filesystem the entrypoint falls back to `/tmp/ntfy`
when that path is not writable — so with the default configuration the cache is
**ephemeral** and message history does not survive a restart.

For durable history, enable NFS and mount it where the cache lives:

- **Console:** Filestore → Instances (when `enable_nfs = true`).
- **CLI:**
  ```bash
  # Confirm the cache path injected into the running revision:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS (Filestore) mount model.

### C. Secret Manager

ntfy generates **no** secrets at deploy time — there is no database password or
encryption key to manage. Secret Manager is used only if you supply your own via
`secret_environment_variables` (for example an `NTFY_AUTH_*` value or an upstream
push credential).

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default, which allows the public
access ntfy needs for publish/subscribe traffic. An external HTTPS load balancer
with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings
and VPC egress control connectivity. If clients use HTTP/2 streaming, set
`container_protocol = "h2c"`.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies. ntfy logs its listen address and
resolved cache path on startup.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Ntfy Application Behaviour

- **No first-deploy database setup.** ntfy has no external database and no migration
  step. The entrypoint prepares the SQLite cache directory and immediately execs
  `ntfy serve`. There is no `db-init` job by default.
- **Ephemeral cache with automatic fallback.** The entrypoint creates
  `NTFY_CACHE_FILE`'s directory; on Cloud Run's read-only rootfs it falls back to
  `/tmp/ntfy` and logs a warning. This keeps a baseline (NFS-less) deploy healthy.
  Enable NFS for durable message history.
- **Real-time delivery needs allocated CPU.** Subscribers hold open WebSocket/SSE
  streams; `cpu_always_allocated = true` ensures the in-process message bus keeps
  delivering between inbound requests.
- **Health path.** Startup and liveness probes target `/v1/health`, which returns
  `{"healthy":true}` and HTTP 200 as soon as the server binds port 80. Verify:
  ```bash
  SERVICE_URL=$(gcloud run services describe <service-name> \
    --project "$PROJECT" --region "$REGION" --format='value(status.url)')
  curl -s "$SERVICE_URL/v1/health"      # -> {"healthy":true}
  ```
- **Publish / subscribe smoke test.**
  ```bash
  curl -d "hello from ntfy" "$SERVICE_URL/mytopic"     # publish
  curl -s "$SERVICE_URL/mytopic/json"                   # subscribe (streaming JSON)
  ```
- **Access is open until you lock it down.** By default any client can publish to and
  subscribe from any topic. Configure users and per-topic ACLs post-deploy via ntfy's
  CLI (`ntfy user add`, `ntfy access`) or the `NTFY_AUTH_*` environment variables.
- **Public base URL for attachments / web push.** If you use attachments or browser
  web-push, set `NTFY_BASE_URL` (via `environment_variables`) to the service's public
  URL so generated links resolve correctly.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for ntfy are listed; every other input is inherited
from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 / 3 — Deployment Environment & Application Identity

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `application_name` | `ntfy` | Base name for the service, registry repo, and secrets. Do not change after first deploy. |
| `application_display_name` | `Ntfy` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Image version tag; `latest` maps to a pinned `v2.11.0` base. Pin an explicit `v2.x.y` in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision supporting infrastructure only. |
| `container_image_source` | `custom` | `custom` builds the wrapper image via Cloud Build; `prebuilt` deploys an image directly. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `512Mi` | Memory per instance (gen2 floor is 512Mi). |
| `min_instance_count` | `1` | Minimum instances. |
| `max_instance_count` | `1` | **Keep at 1** — streams are instance-local with no shared broker. |
| `container_port` | `80` | ntfy listens on port 80. |
| `container_protocol` | `http1` | Set `h2c` for end-to-end HTTP/2 streaming. |
| `cpu_always_allocated` | `true` | Required for real-time stream delivery; flip to `false` only for low-traffic cost savings. |
| `enable_cloudsql_volume` | `false` | Off — ntfy has no database. |
| `enable_image_mirroring` | `true` | Mirror the ntfy image into Artifact Registry. |

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` is required for public publish/subscribe traffic. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks unauthenticated publish/subscribe.** |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra `NTFY_*` settings (e.g. `NTFY_BASE_URL`, `NTFY_AUTH_DEFAULT_ACCESS`). |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (optional; none required). |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Enable to back the SQLite cache with NFS for **durable message history**. |
| `nfs_mount_path` | `/mnt/nfs` | NFS mount path; point `NTFY_CACHE_FILE` at it for persistence. |
| `storage_buckets` | `[]` | Not required — ntfy uses no object storage. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | ntfy has no external database; leave `NONE`. |
| `application_database_name` / `application_database_user` | `ntfy` | Inert unless an external database is deliberately enabled. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | ntfy needs no init job; leave empty. |
| `cron_jobs` | `[]` | Optional scheduled Cloud Run jobs. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/v1/health` 30s delay | Startup probe. ntfy becomes healthy within seconds. |
| `liveness_probe` | HTTP `/v1/health` 30s delay | Liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/v1/health" }` | Optional Cloud Monitoring uptime check. |

### Group 16 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not required — ntfy has no Redis dependency. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` / `database_name` / `database_user` | Database identifiers — empty for the default `NONE` engine. |
| `database_password_secret` / `database_host` / `database_port` | Database endpoint fields — unused for `NONE`. |
| `storage_buckets` | Created Cloud Storage buckets (none by default). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any setup jobs (none by default). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, an out-of-range `container_port`/`timeout_seconds`, a memory value below the gen2 floor. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_nfs` (for durable history) | `true` when history matters | High | With the default ephemeral cache, all message history is lost on every restart/redeploy — acceptable for a pure relay, surprising if you expected persistence. |
| `max_instance_count` | `1` | High | Scaling beyond 1 splits subscribers across instances with no shared bus, so a message published to one instance is not delivered to subscribers pinned to another. |
| `cpu_always_allocated` | `true` | High | Setting `false` lets Cloud Run throttle CPU between requests, pausing real-time WebSocket/SSE delivery while the instance is idle. |
| `ingress_settings` | `all` | High | `internal` blocks external publishers and subscribers from reaching the service. |
| `enable_iap` | only when auth-gated | High | IAP requires Google sign-in for every request, blocking unauthenticated publish/subscribe — usually not what a notification endpoint wants. |
| `NTFY_BASE_URL` | Actual service URL | Medium | Unset, attachment and web-push links resolve to the wrong host. |
| ntfy access control | Configure post-deploy | Medium | Left default, any client can publish to and subscribe from any topic on a public URL. |
| `container_protocol` | `http1` (or `h2c`) | Medium | Mismatch with clients that require HTTP/2 streaming degrades or breaks long-lived streams. |
| `memory_limit` | `512Mi` | Low | The gen2 execution environment rejects values below 512Mi at apply time. |
| `application_version` | Pin `v2.x.y` in prod | Low | `latest` maps to a pinned base (`v2.11.0`); pin explicitly to control upgrades. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. ntfy-specific application configuration shared
with the GKE variant is described in **[Ntfy_Common](Ntfy_Common.md)**.
