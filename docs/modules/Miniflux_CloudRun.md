---
title: "Miniflux on Google Cloud Run"
description: "Configuration reference for deploying Miniflux on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Miniflux on Google Cloud Run

Miniflux is a minimalist, self-hosted RSS/Atom feed reader — a single static Go
binary that stores all state in PostgreSQL. This module deploys Miniflux on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Miniflux uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Miniflux runs as a single Go container on Cloud Run v2. The deployment wires together
a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single Go binary, 2 vCPU / 4 GiB by default, always-CPU-allocated with `min = 1` for the in-process feed poller |
| Database | Cloud SQL for PostgreSQL 15 | Required — Miniflux stores **all** state here; no MySQL/other engine |
| Object storage | Cloud Storage | A default `data` bucket is provisioned but not mounted/used by the app (all state lives in PostgreSQL); an optional NFS mount is also available but unused by default |
| Cache & queue | None | Miniflux has no Redis dependency and no separate worker |
| Secrets | Secret Manager | Auto-generated `ADMIN_PASSWORD` (initial owner); database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup.
- **The feed poller runs in-process.** Miniflux has no separate worker — the same
  container serves the UI and refreshes feeds on `POLLING_FREQUENCY`. Because of
  this, `cpu_always_allocated = true` and `min_instance_count = 1` are the defaults:
  request-based billing would throttle the poller to ~0 CPU when idle and stall
  refreshes. To scale to zero, flip `cpu_always_allocated = false` + `min = 0` and
  externalize polling via a Cloud Scheduler hit to `/v1/feeds/refresh`.
- **The initial owner is seeded, not self-registered.** `CREATE_ADMIN = 1` seeds the
  `admin` account from the `ADMIN_PASSWORD` secret on first boot; open self-service
  signup stays off. Retrieve the password from Secret Manager to log in.
- **Schema migrations run on boot** (`RUN_MIGRATIONS = 1`) — there is no separate
  migrate job, so upgrading the version applies schema changes automatically.
- **No Redis.** `enable_redis = false` — Miniflux keeps every feed, entry, and
  session in PostgreSQL. Leave it off.
- **Public ingress by default.** `ingress_settings = "all"` so the web UI (and
  Miniflux's own API / Fever / Google Reader endpoints) are reachable. Enabling IAP
  will front the UI with Google sign-in.
- **`DATABASE_URL` is composed at runtime** by the container entrypoint (libpq
  keyword/value form), branching on socket vs loopback vs private-IP TCP so the same
  image works on Cloud Run and GKE.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Miniflux service

Miniflux runs as a Cloud Run v2 service listening on port **8080**. Each deployment
creates an immutable revision; traffic can be split across revisions for safe
rollouts. Because the feed poller runs in the container, CPU is allocated at all
times and at least one instance is kept warm.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~miniflux"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Miniflux stores **all** application data (feeds, entries, users, sessions, categories)
in a managed Cloud SQL for PostgreSQL 15 instance. The service connects privately
through the **Cloud SQL Auth Proxy** over a Unix socket; no public IP is exposed. On
first deploy the `db-init` Job creates the `miniflux` database and role and installs
the `hstore` extension owned by the app role.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=miniflux --database=miniflux --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model,
backups, and password rotation.

### C. Cloud Storage / NFS

Miniflux needs **no** object storage — it keeps all state in PostgreSQL. The variant's
`storage_buckets` default still provisions one `data` Cloud Storage bucket (scaffold
boilerplate), but it is not mounted or referenced by the application; override
`storage_buckets = []` to skip creating it. The variant also defaults
`enable_nfs = true` (a Cloud Filestore mount at `/opt/miniflux/storage`) for operators
who want shared attachment storage, but Miniflux does not require it; disable it to
save cost if you have no such need.

- **Console:** Filestore → Instances (if NFS is enabled); Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for NFS, GCS Fuse, and CMEK options.

### D. Secret Manager

One secret is generated automatically: `ADMIN_PASSWORD` — the initial owner password
seeded into Miniflux on first boot. The database password is managed separately by
the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~miniflux"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default (public ingress). An external
HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered
on; ingress settings and VPC egress control connectivity. When a custom domain is
used, set `BASE_URL` so Miniflux emits correct absolute links and feed-proxy URLs.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies. The entrypoint logs its
`DATABASE_URL` connection mode (socket / loopback / private-IP TCP) at start — useful
when diagnosing DB connectivity.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Miniflux Application Behaviour

- **First-deploy database setup.** The `db-init` Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently
  creates the `miniflux` database and role, grants privileges, re-owns the `public`
  schema, and installs the `hstore` extension **owned by the app role** (so Miniflux
  migration `v119`, which drops `hstore`, succeeds). The job is safe to re-run.
- **Schema migrations on boot.** The entrypoint sets `RUN_MIGRATIONS=1`, so Miniflux
  applies its own schema migrations on every start — no separate migrate step. Allow
  extra time on the first boot for the initial schema build.
- **Initial owner is seeded.** `CREATE_ADMIN=1` seeds the `admin` account
  (`ADMIN_USERNAME`) from the `ADMIN_PASSWORD` secret. It is idempotent — later boots
  log "user already exists". Retrieve the password to log in:
  ```bash
  gcloud secrets versions access latest \
    --secret=secret-<resource-prefix>-miniflux-admin-password --project "$PROJECT"
  ```
- **Health path.** The variant's `startup_probe`/`liveness_probe` defaults target `/`
  (root), not the app's own `/healthcheck` endpoint — both return an unauthenticated
  `200 OK`. Do not point probes at authenticated pages.
- **The feed poller is in-process.** Feeds refresh on `POLLING_FREQUENCY` inside the
  same container. With the default `cpu_always_allocated = true` + `min = 1`, polling
  runs continuously. If you flip to scale-to-zero, feeds will not refresh while the
  service is idle unless you drive `/v1/feeds/refresh` from Cloud Scheduler.
- **`BASE_URL` drives absolute links.** It defaults to the injected
  `CLOUDRUN_SERVICE_URL`. Set it explicitly (via `environment_variables`) to the
  custom-domain URL when you front the service with a load balancer.
- **Inspect the db-init job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Miniflux are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

All other inputs follow standard App_CloudRun behaviour.

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

All other inputs follow standard App_CloudRun behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `miniflux` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Miniflux` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Miniflux image tag (`FROM miniflux/miniflux:<tag>`). Pin to a release (e.g. `2.2.15`) in production. |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance. |
| `memory_limit` | `4Gi` | Memory per instance. |
| `cpu_always_allocated` | `true` | Keeps CPU allocated for the in-process feed poller. Flip to `false` only with `min = 0` + externalized polling. |
| `min_instance_count` | `1` | `1` keeps the feed poller running between requests; `0` (scale-to-zero) stops background polling unless externalized. |
| `max_instance_count` | `5` | Upper autoscaling bound. Miniflux is single-process; extra instances just share request load. |
| `container_port` | `8080` | Miniflux listens on 8080 (`LISTEN_ADDR`). |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the Miniflux image into Artifact Registry. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` keeps the UI/API publicly reachable. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of Miniflux. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings merged into the container (e.g. `BASE_URL`, `POLLING_FREQUENCY`, `DISABLE_LOCAL_AUTH`). Do not set `PORT` (reserved) or `DATABASE_URL` (composed at runtime). |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

All other inputs follow standard App_CloudRun behaviour.

### Group 7 — Backup & Restore

`backup_schedule`, `backup_retention_days`, `enable_backup_import`, `backup_source`,
`backup_file`, `backup_format` — automated Cloud SQL backup and restore-on-deploy.
See [App_CloudRun](App_CloudRun.md).

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[{name_suffix="data", location=""}]` | Default `data` bucket is provisioned but unused/unmounted by Miniflux — override to `[]` to skip it. |
| `enable_nfs` | `true` | Provisions a Filestore NFS mount at `/opt/miniflux/storage`. Optional — Miniflux stores state in PostgreSQL; disable to save cost. |
| `nfs_mount_path` | `/opt/miniflux/storage` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |

All other inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Miniflux requires PostgreSQL. |
| `db_name` | `miniflux` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `miniflux` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

All other inputs follow standard App_CloudRun behaviour.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (role/database/`hstore`). |
| `cron_jobs` | `[]` | Optional scheduled jobs (e.g. a Cloud Scheduler `/v1/feeds/refresh` hit when scaled to zero). |

All other inputs follow standard App_CloudRun behaviour.

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 60s initial delay, 30 failures | Startup probe. Generous window for first-boot migrations. |
| `liveness_probe` | HTTP `/`, 60s initial delay, 30s period | Liveness probe. |
| `uptime_check_config` | disabled | Cloud Monitoring uptime check against the public endpoint; enable and set a path to activate. |
| `alert_policies` | `[]` | Metric alert policies. |

All other inputs follow standard App_CloudRun behaviour.

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Miniflux does not use Redis — leave off. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Unused by Miniflux. |

All other inputs follow standard App_CloudRun behaviour.

### Group 22 — VPC Service Controls & Audit Logging

`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `enable_audit_logging` — see
[App_CloudRun](App_CloudRun.md).

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
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user (`miniflux`). |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets (a default `data` bucket unless overridden). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (`db-init`). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — an IAP config with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Miniflux only supports PostgreSQL; any other engine breaks startup. |
| `db_name` / `db_user` | Set once (`miniflux`) | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all feeds and entries. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup source fails the import job. |
| `ADMIN_PASSWORD` (auto-generated) | Retrieve from Secret Manager | High | It is the only owner credential seeded on first boot; without it you cannot log in until you reset it in the DB. |
| `cpu_always_allocated` + `min_instance_count` | `true` + `1` | High | Setting `false`/`0` without externalized polling stops feed refreshes while the service is idle. |
| `enable_redis` | `false` | Medium | Redis is unused; enabling it wastes resources and changes nothing. |
| `ingress_settings` | `all` | High | `internal` blocks the public UI and external feed-reader clients (Fever / Google Reader API). |
| `enable_iap` | off unless UI must be gated | Medium | IAP fronts the UI/API with Google sign-in, blocking Fever/Reader API clients that authenticate with app tokens. |
| `BASE_URL` (env) | Actual public URL | Medium | A stale/wrong base URL yields broken absolute links and feed-proxy image URLs. |
| `startup_probe.path` | `/` (default) | High | Pointing the probe at an authenticated page returns 401/403 and the revision never becomes Ready. |
| `memory_limit` | `4Gi` (≥512Mi floor) | Medium | Below the gen2 512Mi floor the apply is rejected; Miniflux itself is lightweight. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Miniflux-specific application configuration
shared with the GKE variant is described in **[Miniflux_Common](Miniflux_Common.md)**.
