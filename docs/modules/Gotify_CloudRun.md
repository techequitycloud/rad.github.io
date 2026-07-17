---
title: "Gotify on Google Cloud Run"
description: "Configuration reference for deploying Gotify on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Gotify on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gotify_CloudRun.png" alt="Gotify on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gotify is an open-source (MIT-licensed), self-hosted server for sending and receiving
real-time push notifications. Applications post messages over a simple REST API and
clients receive them instantly over WebSocket streams. This module deploys Gotify on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Gotify uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Gotify runs as a single-binary Go container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Go service, 1 vCPU / 512 MiB by default, always-on CPU for WebSocket streams |
| Database | Cloud SQL for PostgreSQL 15 | Required — this module never uses Gotify's embedded SQLite |
| Secrets | Secret Manager | Auto-generated admin password (`GOTIFY_DEFAULTUSER_PASS`); database password |
| Container build | Cloud Build + Artifact Registry | Wraps `ghcr.io/gotify/server` with a DB-mapping entrypoint |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** `database_type = "POSTGRES_15"` is fixed by the
  shared application layer; Gotify's SQLite mode is not used, so no persistent disk is
  required.
- **The container listens on port 80.** `container_port = 80` and the entrypoint sets
  `GOTIFY_SERVER_PORT = 80`.
- **CPU is always allocated** (`cpu_always_allocated = true`) with `min = max = 1`.
  Gotify holds long-lived WebSocket streams and an in-process message bus, so CPU must
  not be throttled between requests. This defeats scale-to-zero; a low-traffic
  instance can flip `cpu_always_allocated = false`, accepting that stream delivery
  pauses while idle.
- **A single instance is the safe default.** Gotify's message bus is in-process, so a
  client stream only receives messages delivered to the instance it is connected to.
  Scaling beyond one instance without an external fan-out layer drops messages for
  some subscribers.
- **The admin password is generated automatically** and stored in Secret Manager,
  injected as `GOTIFY_DEFAULTUSER_PASS`. The initial admin (`admin`) is created on the
  first database initialisation only.
- **No object storage is provisioned** (`storage_buckets = []`, `enable_nfs = false`).
  Messages, applications, and tokens live in PostgreSQL.
- **The image is custom-built.** `container_image_source = "custom"` builds a wrapper
  around `ghcr.io/gotify/server` that maps the platform `DB_*` variables onto Gotify's
  `GOTIFY_DATABASE_*` (GORM) configuration; `latest` pins to base `2.9.1`.
- **Public ingress is the default.** `ingress_settings = "all"` so sending
  applications and receiving clients can reach the REST API and WebSocket.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Gotify service

Gotify runs as a Cloud Run v2 service. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts. Because CPU is always
allocated and a single instance is maintained, WebSocket streams stay connected
between message sends.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Gotify stores all application data (messages, applications, clients, users) in a
managed Cloud SQL for PostgreSQL 15 instance. The service connects privately through
the **Cloud SQL Auth Proxy** over a Unix socket; no public IP is exposed. On first
deploy an initialization Job creates the application database and role; Gotify then
applies its own schema via GORM auto-migration on first startup.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model,
backups, and password rotation.

### C. Secret Manager

The admin password (`GOTIFY_DEFAULTUSER_PASS`) is generated automatically and stored
in Secret Manager. The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~gotify"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### D. Container build & Artifact Registry

The custom image wraps `ghcr.io/gotify/server` with a DB-mapping entrypoint. Cloud
Build builds it and pushes to Artifact Registry; `enable_image_mirroring = true`
mirrors the upstream base into Artifact Registry to avoid registry rate limits.

- **Console:** Cloud Build → History; Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts repositories list --project "$PROJECT"
  ```

### E. Networking & ingress

The service is reachable at its `run.app` URL by default, which allows the public
access required for sending applications and receiving clients. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with an optional uptime check against `/health` (disabled by default) and
optional alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Gotify Application Behaviour

- **First-deploy database setup.** An initialization Job runs `create-db-and-user.sh`
  using `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and
  idempotently creates the application database and role and grants privileges. The
  job is safe to re-run.
- **Schema via GORM auto-migration.** Gotify creates and migrates its own tables on
  every startup — there is no separate migration job. Upgrading the application
  version applies schema changes automatically.
- **The admin account is bootstrapped once.** `GOTIFY_DEFAULTUSER_NAME = admin` and
  the `GOTIFY_DEFAULTUSER_PASS` secret create the initial administrator on the first
  database initialisation only. Retrieve the password from Secret Manager and change
  it after first login. Changing the secret later does not reset the admin password.
- **Send and receive are token-authenticated.** After logging in, create an
  *application* (which yields an app token) to send messages via
  `POST /message?token=<apptoken>`, and use a *client* token to subscribe over the
  WebSocket at `/stream?token=<clienttoken>`. Confirm health without a token:
  ```bash
  curl -s "$(gcloud run services describe <service-name> --region "$REGION" \
    --project "$PROJECT" --format='value(status.url)')/health"
  ```
- **Single-instance WebSocket delivery.** Because the message bus is in-process, keep
  `max_instance_count = 1` unless you add an external fan-out layer — otherwise a
  message sent to one instance is not delivered to clients streaming from another.
- **Health path.** Startup and liveness probes target `/health` — the public endpoint
  that returns `{"health":"green","database":"green"}` once PostgreSQL is reachable.
  The default startup probe allows ~5 minutes on first boot.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Gotify are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `gotify` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Gotify` | Human-readable name shown in the Console. |
| `application_description` | `Gotify push notification server on Cloud Run` | Service description. |
| `application_version` | `latest` | Image tag; `latest` resolves to the pinned base `2.9.1`. Pin a release in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds the DB-mapping wrapper image; `prebuilt` deploys an image URI you configure. |
| `cpu_limit` | `1000m` | CPU per instance; 1 vCPU suits most instances. |
| `memory_limit` | `512Mi` | Memory per instance; 512 MiB is the gen2 floor. |
| `min_instance_count` | `1` | Keep at 1 so WebSocket streams stay connected. |
| `max_instance_count` | `1` | Keep at 1 — the in-process message bus does not fan out across instances. |
| `cpu_always_allocated` | `true` | Required for WebSocket streams; flip to `false` only for low-traffic instances. |
| `container_port` | `80` | Gotify listens on port 80. |
| `execution_environment` | `gen2` | Gen2 execution environment. |
| `timeout_seconds` | `300` | Maximum request duration; raise for long-lived streams. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `enable_image_mirroring` | `true` | Mirror `ghcr.io/gotify/server` into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` lets sending apps and receiving clients reach the service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. Blocks token-only API callers unless they also carry identity. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra `GOTIFY_*` settings. The database connection and `GOTIFY_DEFAULTUSER_PASS` are injected automatically — do not set them here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend (requires Cloud Armor). |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[]` | Empty — Gotify needs no file storage. Add buckets only for custom needs. |
| `enable_nfs` | `false` | Off by default; enable only to persist Gotify's on-disk image/plugin store. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Gotify uses managed PostgreSQL. |
| `application_database_name` | `gotify` | Database name. Immutable after first deploy. |
| `application_database_user` | `gotify` | Application role. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `enable_postgres_extensions` / `postgres_extensions` | off | Optional PostgreSQL extensions. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Optional Cloud Scheduler + Cloud Run Jobs. |
| `additional_services` | `[]` | Additional Cloud Run services alongside Gotify. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, 30s delay, 30 failures | Startup probe. Allows ~5 minutes on first boot. |
| `liveness_probe` | HTTP `/health`, 30s delay | Liveness probe. |
| `startup_probe_config` / `health_check_config` | HTTP `/health` | App_CloudRun-level probes. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 16 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Gotify needs no Redis; leave off unless integrating an external instance. |
| `redis_host` | `""` | Redis endpoint (only used when `enable_redis = true`). |
| `redis_port` | `6379` | Redis port. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (auto-discovers `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `project_id` / `deployment_id` | Project ID / deployment suffix. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / role. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `storage_buckets` | Created Cloud Storage buckets (empty for Gotify). |
| `container_image` | Deployed image. |
| `cicd_enabled` / `github_repository_url` | CI/CD status and connected repo. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, an out-of-range `redis_port`/`backup_retention_days`, a `database_type` that does not match an enabled extension. Invalid configuration fails the **plan** with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | Scaling beyond 1 without external fan-out drops messages for clients streaming from other instances (in-process message bus). |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/role and destroys all messages. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup fails the import job. |
| `cpu_always_allocated` | `true` | High | Under request-based billing, CPU throttles between requests and WebSocket stream delivery stalls while idle. |
| `container_port` | `80` | High | Gotify listens on 80; a mismatched port fails the startup probe and the revision never serves. |
| `memory_limit` | `512Mi` | High | Below the gen2 512 MiB floor the plan is rejected. |
| `min_instance_count` | `1` | High | Scale-to-zero drops all live WebSocket streams whenever the instance is reclaimed. |
| `ingress_settings` | `all` | High | `internal` blocks external senders and receivers from reaching the service. |
| `enable_iap` | only when API callers carry identity | High | IAP requires Google identity on every request, blocking token-only send/receive callers. |
| `GOTIFY_DEFAULTUSER_PASS` (auto-generated) | Change admin password after first login | High | The bootstrap password only applies on first init; leaving the default admin password unchanged is a standing credential exposure. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_cloud_armor` | enable for production | Medium | The API and UI are publicly reachable without WAF protection. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Gotify-specific application configuration shared
with the GKE variant is described in **[Gotify_Common](Gotify_Common.md)**.
