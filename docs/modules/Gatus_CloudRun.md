---
title: "Gatus on Google Cloud Run"
description: "Configuration reference for deploying Gatus on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Gatus on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gatus_CloudRun.png" alt="Gatus on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gatus is an open-source, Apache 2.0-licensed developer-oriented status page and
health-check monitor written in Go. It polls configured HTTP, TCP, DNS, ICMP, and
other endpoints on independent per-endpoint schedules, evaluates simple result
conditions (status code, response time, response body content, TLS certificate
expiry), and serves a live public status page plus alerting — no external database
required. This module deploys Gatus on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Gatus uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Gatus runs as a single Go container on Cloud Run v2. The deployment wires together a
deliberately small set of Google Cloud services — Gatus has no database, cache, or
object-storage dependency of its own:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single Go service, 1 vCPU / 512 MiB by default; CPU always allocated so the watchdog polling loop is never throttled |
| Database | **None** | `database_type = "NONE"`; optional history store is a local SQLite file, no Cloud SQL provisioned |
| Persistence | Ephemeral disk (default) or NFS (optional, with a caveat) | SQLite history at `/data/data.db`; see the WAL-journal caveat below before enabling NFS |
| Object storage | **None** | Gatus stores nothing in Cloud Storage |
| Cache / queue | **None** | No Redis; Gatus has no cache or queue dependency |
| Secrets | Secret Manager | No auto-generated secrets; only user-supplied `secret_environment_variables` |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No database is provisioned.** `database_type = "NONE"` — Gatus's optional
  history store is a local SQLite file. The database-related variables exist for
  completeness but are inert unless you deliberately opt in to an external database.
- **Configuration is entirely file-based.** Every monitored endpoint, alert
  integration, and storage setting lives in one YAML file baked into the image at
  build time — there is no per-setting environment variable convention and no
  runtime config-reload API. Change monitored endpoints by editing
  `modules/Gatus_Common/scripts/config.yaml` and redeploying.
- **The history store is ephemeral by default, deliberately.** Gatus hardcodes
  SQLite WAL journal mode (confirmed live: no config option or connection-string
  parameter disables it), and SQLite's own documentation states WAL is unsupported
  on network filesystems. Cloud Run offers only ephemeral storage or NFS for this —
  neither is a genuinely safe home for a WAL-mode SQLite file, so the module
  defaults to ephemeral rather than risking silent corruption. Deploy `Gatus_GKE`
  with `stateful_pvc_enabled = true` (a real block device) if persistent history
  matters.
- **CPU is always allocated (`cpu_always_allocated = true`).** Gatus's watchdog
  goroutine polls every configured endpoint on its own schedule, independent of
  inbound HTTP requests. Request-based billing would throttle CPU between page
  views and silently stall or skip scheduled checks — the monitoring loop **is**
  the product, the same rationale used for UptimeKuma.
- **Single instance by default** (`min_instance_count = 1`, `max_instance_count =
  1`). Multiple instances would each independently poll every endpoint and
  duplicate alerts — there is no shared coordination between Gatus instances.
- **Public ingress is the default** (`ingress_settings = "all"`) so the status page
  is publicly reachable. Enabling IAP requires Google sign-in and blocks
  unauthenticated viewing.
- **The health endpoint is `/health`**, which returns HTTP 200 as soon as the
  server binds its port.
- **Access control, if any, is configured in `config.yaml`.** Gatus ships with an
  open status page by default; optional basic-auth or OIDC protection is configured
  in the `security` block of `config.yaml` and requires a rebuild.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Gatus service

Gatus runs as a Cloud Run v2 service. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts. Because CPU is always
allocated, the watchdog polling loop keeps running between inbound requests.

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

### B. Persistence — the SQLite history store

Gatus has **no Cloud SQL instance**. Its optional history store is a local SQLite
file at `/data/data.db`, baked into the image directory structure at build time. On
Cloud Run's default configuration this directory is **ephemeral** — history does not
survive a restart or redeploy.

- **Console:** Filestore → Instances (when `enable_nfs = true`).
- **CLI:**
  ```bash
  # Confirm the injected environment on the running revision:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Before enabling NFS for durable history, read the WAL-journal caveat in
[§1 Overview](#1-overview) and in [Gatus_Common](Gatus_Common.md) — Cloud Run has no
block-PVC option, so NFS is the only optional persistence mechanism here and it
carries a real corruption risk for a WAL-mode SQLite file. See [App_CloudRun](App_CloudRun.md)
for the general NFS (Filestore) mount model.

### C. Secret Manager

Gatus generates **no** secrets at deploy time — there is no database password or
encryption key to manage. Secret Manager is used only if you supply your own via
`secret_environment_variables` (for example a `${VAR}` referenced inside
`config.yaml`'s alerting configuration).

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default, which allows the public
access a status page typically needs. An external HTTPS load balancer with a custom
domain, Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies. Gatus logs each endpoint check's
result (success/failure, duration) as it runs.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Gatus Application Behaviour

- **No first-deploy database setup.** Gatus has no external database and no
  migration step. It reads `config.yaml`, initialises its SQLite history store (if
  configured), and starts serving immediately. There is no init job by default.
- **Ephemeral history store by default.** `/data/data.db` lives on the container's
  local writable filesystem with nothing mounted unless you opt into NFS. Every
  restart or redeploy resets check history (the status page itself and all
  currently-configured checks are unaffected — only the historical results/uptime
  percentages reset).
- **The watchdog polling loop needs allocated CPU.** Each configured endpoint is
  checked on its own independent interval by an in-process goroutine;
  `cpu_always_allocated = true` ensures this keeps running between inbound page
  views.
- **Health path.** Startup and liveness probes target `/health`, which returns HTTP
  200 as soon as the server binds port 8080. Verify:
  ```bash
  SERVICE_URL=$(gcloud run services describe <service-name> \
    --project "$PROJECT" --region "$REGION" --format='value(status.url)')
  curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/health"      # -> 200
  ```
- **View the status page.**
  ```bash
  curl -s "$SERVICE_URL/" | head -20     # rendered HTML status page
  ```
- **Configuration changes require a rebuild.** Gatus has no admin UI or API for
  editing monitored endpoints. Edit `modules/Gatus_Common/scripts/config.yaml` (add,
  remove, or modify `endpoints` entries) and redeploy to apply changes.
- **Access is open until you configure it.** By default the status page has no
  authentication. Configure basic-auth or OIDC in `config.yaml`'s `security` block
  and redeploy to restrict viewing.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Gatus are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 / 3 — Deployment Environment & Application Identity

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `application_name` | `gatus` | Base name for the service, registry repo, and secrets. Do not change after first deploy. |
| `application_display_name` | `Gatus` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Image version tag; `latest` maps to a pinned `v5.36.0` base. Pin an explicit `v5.x.y` in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision supporting infrastructure only. |
| `container_image_source` | `custom` | `custom` builds the wrapper image via Cloud Build; `prebuilt` deploys an image directly. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `512Mi` | Memory per instance (gen2 floor is 512Mi). |
| `min_instance_count` | `1` | Minimum instances. |
| `max_instance_count` | `1` | **Keep at 1** — replicas would each independently poll every endpoint and duplicate alerts. |
| `container_port` | `8080` | Gatus listens on port 8080. |
| `container_protocol` | `http1` | HTTP/1.1 by default. |
| `cpu_always_allocated` | `true` | Required so the watchdog polling loop is never throttled between requests. |
| `enable_cloudsql_volume` | `false` | Off — Gatus has no database. |
| `enable_image_mirroring` | `true` | Mirror the Gatus image into Artifact Registry. |

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` is required for a public status page. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks unauthenticated viewing.** |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Substitutions for `${VAR}`-style references inside `config.yaml` (e.g. an alerting webhook token), not per-setting overrides. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (optional; none required). |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Optional durable history mount. **Caution:** carries a WAL-on-network-filesystem risk — see §1. |
| `nfs_mount_path` | `/data` | NFS mount path; matches the baked-in `storage.path` in `config.yaml`. |
| `storage_buckets` | `[]` | Not required — Gatus uses no object storage. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Gatus has no external database; leave `NONE`. |
| `application_database_name` / `application_database_user` | `gatus` | Inert unless an external database is deliberately enabled. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Gatus needs no init job; leave empty. |
| `cron_jobs` | `[]` | Optional scheduled Cloud Run jobs. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health` 10s delay | Startup probe. Gatus becomes healthy within seconds. |
| `liveness_probe` | HTTP `/health` 15s delay | Liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Optional Cloud Monitoring uptime check. |

### Group 16 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not required — Gatus has no Redis dependency. |

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
| `enable_nfs` (for durable history) | Leave `false`; use `Gatus_GKE` with `stateful_pvc_enabled` instead | Critical | Gatus hardcodes SQLite WAL journal mode, which SQLite's own documentation states is unsupported on network filesystems — NFS-backed history risks silent corruption over time. |
| `max_instance_count` | `1` | High | Scaling beyond 1 has every replica independently poll every endpoint, duplicating alert notifications with no coordination between instances. |
| `cpu_always_allocated` | `true` | High | Setting `false` lets Cloud Run throttle CPU between requests, silently stalling or skipping the watchdog's scheduled endpoint checks. |
| `ingress_settings` | `all` | High | `internal` makes a public status page unreachable from outside the VPC. |
| `enable_iap` | only when auth-gated | High | IAP requires Google sign-in for every request, blocking unauthenticated status-page viewing — usually not what a public status page wants. |
| Gatus `security` block in `config.yaml` | Configure if the page has sensitive endpoint names | Medium | Left default, the status page (including all configured endpoint names and their up/down history) is publicly visible to anyone with the URL. |
| `container_port` | `8080` | Medium | Overriding to a value Gatus is not listening on causes every health probe to fail. |
| `memory_limit` | `512Mi` | Low | The gen2 execution environment rejects values below 512Mi at apply time. |
| `application_version` | Pin `v5.x.y` in prod | Low | `latest` maps to a pinned base (`v5.36.0`); pin explicitly to control upgrades. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Gatus-specific application configuration shared
with the GKE variant is described in **[Gatus_Common](Gatus_Common.md)**.
