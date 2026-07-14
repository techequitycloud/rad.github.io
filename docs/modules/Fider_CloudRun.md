---
title: "Fider on Google Cloud Run"
description: "Configuration reference for deploying Fider on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Fider on Google Cloud Run

Fider is an open-source, self-hosted feedback and feature-voting board — customers
post ideas, vote, and comment, and you prioritise by demand. This module deploys
Fider on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation,
which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Fider uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Fider runs as a single Go container on Cloud Run v2. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single Go binary, 2 vCPU / 4 GiB by default, serverless autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — Fider does not support MySQL or other engines |
| Object storage | Cloud Storage | A dedicated `storage` bucket provisioned automatically |
| File storage | Cloud Filestore (NFS) | Enabled by default for attachment storage |
| Secrets | Secret Manager | Auto-generated `JWT_SECRET`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS LB + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer (`database_type = POSTGRES_15`); selecting any other engine breaks
  startup.
- **`JWT_SECRET` is generated automatically** and stored in Secret Manager. It signs
  all authentication and session tokens (including emailed magic sign-in links) and
  **must never be rotated after first boot** — doing so invalidates all active
  sessions and pending sign-in links.
- **Fider is a single Go binary with no background worker.** All state lives in
  PostgreSQL, so there is no queue process to keep warm. The module ships
  `min_instance_count = 1` with `cpu_always_allocated = true` for a consistently warm
  service; because there is no background work, setting `min_instance_count = 0`
  (scale-to-zero) is data-safe if you prefer to trade a cold start for lower cost.
- **No Redis.** Fider uses a PostgreSQL-backed queue and cache (empty `VALKEY_URL`),
  so `enable_redis` defaults to `false`. Leave it off unless you deliberately
  externalise to Redis.
- **NFS is enabled by default** (`enable_nfs = true`) to provide a Cloud Filestore
  mount for Fider attachment storage.
- **The container listens on port 3000.** The entrypoint exports `PORT = 3000`;
  Cloud Run also auto-injects `PORT = <container_port>`.
- **Schema migrations run on boot.** The custom entrypoint runs `./fider migrate`
  before starting the server, so upgrading the version applies schema changes with no
  separate step.
- **Email is disabled for the demo.** Placeholder SMTP values let the app boot;
  sign-up / invite links are printed to the container log until real SMTP is wired via
  `environment_variables`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Fider service

Fider runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~fider"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Fider stores all application data (posts, votes, comments, users, settings) in a
managed Cloud SQL for PostgreSQL 15 instance. The service connects privately through
the **Cloud SQL Auth Proxy** over a Unix socket; no public IP is exposed. On first
deploy the `db-init` Job creates the application role and database and grants
privileges; Fider then runs its own migrations on boot.

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

### C. Cloud Storage

A dedicated **Cloud Storage** bucket (suffix `storage`) is provisioned automatically.
Additional buckets can be declared via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Cloud Filestore (NFS)

NFS is **enabled by default** (`enable_nfs = true`) to give Fider a Cloud Filestore
mount for attachment storage. The shared NFS server VM (managed by `Services_GCP`)
must be `RUNNING` before the app deploys.

- **Console:** Filestore → Instances.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Confirm the mount path injected into the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.volumes)'
  ```

Fider does **not** use Redis — do not expect a Memorystore or Redis endpoint.

### E. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager:
`JWT_SECRET` (signs authentication and session tokens). The database password is
managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~fider"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = "all"`).
An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can
be layered on; ingress settings and VPC egress control connectivity. Set a custom
`BASE_URL` via `environment_variables` when serving from a custom domain.

> **Use the numeric-project URL, not `status.url`.** Every Cloud Run service is
> reachable at two equally-valid hostnames: a numeric-project form
> (`https://<service>-<project-number>.<region>.run.app`) and a random-suffix form
> (`https://<service>-<random8>-<regioncode>.a.run.app`, what `gcloud run services
> describe --format='value(status.url)'` reports). Fider's own Content-Security-Policy
> header is scoped to whichever hostname it was booted against — normally the
> numeric-project form — so a browser landing on the random-suffix `status.url` gets
> every asset request (CSS, JS) blocked by the CSP and renders a completely blank
> page. Always share/visit the numeric-project form.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies. Note that when email is
disabled, sign-up / invite links appear in the logs.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Fider Application Behaviour

- **First-deploy database setup.** The `db-init` Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently
  creates the `fider` role and database, grants privileges, and reassigns ownership of
  the `public` schema to the application role. The job is safe to re-run.
- **Schema migrations on start.** The custom entrypoint runs `./fider migrate` before
  launching the server (the image's `CMD` is overridden to `./fider` only). Migrations
  are idempotent, so upgrading the application version applies schema changes on the
  next start without a separate migration step.
- **`JWT_SECRET` is immutable after first boot.** It is generated once and written to
  Secret Manager. Changing it invalidates all active user sessions and any pending
  emailed sign-in links. Only rotate during a planned maintenance window.
- **First-run setup.** There are no default credentials. The first visit to the
  service URL walks an operator through creating the site and its admin owner. Complete
  this immediately after deploy — use the **numeric-project** URL, not the
  `status.url` random-suffix form (see the CSP/blank-page warning under
  [Networking & ingress](#f-networking--ingress)):
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(metadata.annotations."run.googleapis.com/urls")'
  ```
- **Email is off by default.** Placeholder SMTP values let Fider boot with
  `EMAIL_NOEMAIL = true`; sign-up and invite links are printed to the container log.
  To send real mail, set the Fider SMTP variables (`EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`,
  `EMAIL_SMTP_USERNAME`, `EMAIL_SMTP_PASSWORD`, `EMAIL_NOREPLY`) via
  `environment_variables` and remove `EMAIL_NOEMAIL`.
- **Health path.** Startup and liveness probes target `/_health` — an unauthenticated
  endpoint returning `200`. Allow ~7 minutes on first boot (the default startup probe
  provides a 30-second initial delay plus a 30-failure retry window at a 15-second
  period).
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Fider are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `fider` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Fider` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Fider image tag (`getfider/fider:<tag>`), mapped to the `FIDER_VERSION` build ARG. `latest` is pinned to `stable` (there is no `:latest` tag); pin to a specific SHA tag in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance. |
| `memory_limit` | `4Gi` | Memory per instance. |
| `min_instance_count` | `1` | Warm baseline. Fider has no background worker, so `0` (scale-to-zero) is data-safe if you accept a cold start. |
| `max_instance_count` | `5` | Cost ceiling; must be ≥ `min_instance_count`. |
| `cpu_always_allocated` | `true` | Instance-based billing for a consistently warm service; safe to set `false` for request-based billing since Fider does no background work. |
| `container_port` | `3000` | Fider listens on 3000; Cloud Run auto-injects `PORT`. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the Fider image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public access; required to reach the site from browsers. |
| `enable_iap` | `false` | Require Google sign-in in front of Fider. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Wire real SMTP (`EMAIL_SMTP_*`, `EMAIL_NOREPLY`) or a custom `BASE_URL` here. Do not set `DATABASE_URL`, `JWT_SECRET`, or `PORT`. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the GCS buckets defined in `storage_buckets`. |
| `enable_nfs` | `true` | Cloud Filestore mount for Fider attachment storage. |
| `nfs_mount_path` | `/opt/fider/storage` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Fider requires PostgreSQL. |
| `db_name` | `fider` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `fider` | Application database user. Password auto-generated in Secret Manager. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/_health`, 30s delay | Allow ~7 minutes on first boot. |
| `liveness_probe` | HTTP `/_health`, 30s period | Liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Optional Cloud Monitoring uptime check. |

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Fider is Postgres-backed; leave off unless externalising to Redis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Only relevant if Redis is enabled. |

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
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `JWT_SECRET` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates all active sessions and pending emailed sign-in links. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/role and destroys all data. |
| `database_type` | `POSTGRES_15` | Critical | Any non-PostgreSQL engine breaks startup — Fider is Postgres-only. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup source fails the import job. |
| `container_port` | `3000` | High | A mismatched port makes probes hit a dead port and the revision never becomes Ready. |
| `application_version` | pin a SHA tag; `latest` → `stable` | High | `getfider/fider` has no `:latest` tag; the module pins `latest` to `stable`, but pin explicitly for reproducible upgrades. |
| `memory_limit` | `4Gi` (default) | Medium | Undersizing risks OOM under load; Fider itself is lightweight. |
| `enable_nfs` | `true` (default) | Medium | Disable only if you do not need attachment storage; the shared NFS VM must be `RUNNING` before deploy. |
| `min_instance_count` / `cpu_always_allocated` | `1` / `true` (default) | Low | Fider has no background worker — `0` / `false` is data-safe and cheaper, at the cost of cold starts. |
| SMTP (`EMAIL_SMTP_*`) | Configure for real mail | Medium | Left as placeholders, sign-up / invite links only appear in the logs — no email is sent. |
| `enable_iap` | only when public access not needed | High | IAP blocks all unauthenticated requests, including anonymous browsing of the board. |
| Which Cloud Run URL to visit | numeric-project form, not `status.url` | High | Fider's CSP is scoped to the numeric-project hostname; visiting the random-suffix `status.url` form gets every asset blocked by the browser, rendering a blank page. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Fider-specific application configuration shared
with the GKE variant is described in **[Fider_Common](Fider_Common.md)**.
