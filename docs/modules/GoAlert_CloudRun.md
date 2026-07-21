---
title: "GoAlert on Google Cloud Run"
description: "Configuration reference for deploying GoAlert on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# GoAlert on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/GoAlert_CloudRun.png" alt="GoAlert on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

GoAlert is an open-source, Apache 2.0-licensed on-call scheduling and incident
alert-escalation platform, originally built by Target and run in production at
scale. It lets teams define escalation policies, on-call rotations and schedules,
and dispatch outbound notifications by email, webhook, or (optionally) Twilio
SMS/voice. This module deploys GoAlert on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services GoAlert uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

GoAlert runs as a single Go binary on Cloud Run v2. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Go binary, 1 vCPU / 512 MiB by default, `cpu_always_allocated = true`, `min_instance_count = 1` — no scale-to-zero |
| Database | Cloud SQL for PostgreSQL (`POSTGRES_17`) | Required — GoAlert does not support MySQL or other engines; `pgcrypto` extension installed automatically |
| Secrets | Secret Manager | Auto-generated admin password and a data-encryption key; database password managed by the foundation |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

There is **no object storage row** in this table — `GoAlert_Common`'s
`storage_buckets` output is always `[]`. GoAlert has no file-upload/attachment
feature; every piece of application state (escalation policies, schedules, alerts,
notification history, users) lives in PostgreSQL.

**Sensible defaults worth knowing up front:**

- **PostgreSQL is mandatory.** `database_type = "POSTGRES_17"` is fixed by
  `GoAlert_Common`; selecting any other engine breaks startup.
- **Always-on CPU, no scale-to-zero.** `cpu_always_allocated = true` and
  `min_instance_count = 1` are the defaults because GoAlert runs a continuous
  in-process "engine" loop that evaluates escalation-policy timing, rotation state,
  and outbound notification dispatch. Under request-based billing or at zero
  instances, that loop simply doesn't run — an alert created via API/webhook could
  silently never escalate.
- **`max_instance_count` stays at 1.** GoAlert officially supports multiple
  concurrent engine instances (not a double-fire bug per upstream docs), but
  recommends running one default-mode instance plus additional `--api-only`
  replicas to avoid contention — a two-tier topology this module does not wire.
- **No Redis, no object storage.** GoAlert's state lives entirely in PostgreSQL; it
  needs no external cache, queue, or file storage.
- **`GOALERT_DB_URL` is assembled at container start, not at plan time.** GoAlert
  accepts only a single Postgres connection-string env var, and the runtime
  Secret-Manager-sourced `DB_PASSWORD` can't be URL-encoded until the container
  actually starts — `entrypoint.sh` (and each init-job script) builds it from the
  discrete `DB_*` values the Foundation injects.
- **`public_url` auto-computes a `run.app` URL when left empty.** `GoAlert_CloudRun`
  passes `public_url = var.public_url != "" ? var.public_url :
  "https://${service_name}-${project_number}.${region}.run.app"` into
  `GoAlert_Common`, so `GOALERT_PUBLIC_URL` (used for OIDC/CSRF-referer validation
  and links in outgoing notifications) is correct out of the box — a convenience
  the GKE variant does not have.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the GoAlert service

GoAlert runs as a Cloud Run v2 service, always-on (min instances 1, CPU always
allocated) rather than autoscaled to zero, so its escalation-engine loop keeps
running continuously.

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

### B. Cloud SQL for PostgreSQL

GoAlert stores all application data — escalation policies, schedules, rotations,
alerts, notification history, and users — in a managed Cloud SQL PostgreSQL
instance. The service connects privately through the **Cloud SQL Auth Proxy** over
a Unix socket; no public IP is exposed. `entrypoint.sh` detects the socket and
symlinks it to `/tmp/.s.PGSQL.5432` before assembling `GOALERT_DB_URL`.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection
model, backups, and password rotation.

### C. Secret Manager

Two secrets are generated automatically by `GoAlert_Common` and stored in Secret
Manager: the **admin password** (consumed by the `admin-bootstrap` init job) and a
**data-encryption key** (recommended by upstream GoAlert docs for encrypting stored
API keys/sensitive config at rest, though not code-enforced at boot). The database
password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~goalert"
  gcloud secrets versions access latest --secret=<admin-password-secret-id> --project "$PROJECT"
  ```

### D. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on;
ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. GoAlert Application Behaviour

- **The 3-stage initialization job chain is load-bearing.** `GoAlert_Common` defines
  three ordered Cloud Run Jobs, each depending on the one before it, all with
  `execute_on_apply = true`:
  1. **`db-init`** (`postgres:15-alpine`) — creates the PostgreSQL role and
     database.
  2. **`db-migrate`** (`goalert/goalert:<version>`, `depends_on_jobs = ["db-init"]`)
     — runs `goalert migrate --db-url=...`, applying GoAlert's own schema. This
     **must** run before `admin-bootstrap`: `goalert add-user` has no migration
     logic of its own, and on a fresh database it fails with
     `relation "auth_basic_users" does not exist`.
  3. **`admin-bootstrap`** (`goalert/goalert:<version>`, `depends_on_jobs =
     ["db-migrate"]`) — runs `goalert add-user --admin` directly against Postgres to
     create the first admin login. Safe to run at apply time (unlike an HTTP-based
     bootstrap) because it talks straight to the database, not the running server.

  All three scripts retry internally (up to 10 attempts, 5s apart) to absorb Cloud
  SQL/Cloud Run Job scheduling latency, and the Cloud Run Jobs themselves retry up
  to 3 times on failure.

- **No first-visit setup wizard.** GoAlert has no web-based initial-admin flow —
  the `admin-bootstrap` job is the only way an admin account gets created. Retrieve
  the generated password:
  ```bash
  gcloud secrets versions access latest --secret=<admin_password_secret_id output>
  ```

- **Health endpoint.** `/health` is GoAlert's documented public, unauthenticated
  endpoint (200 once the app lifecycle leaves the "Starting" state). This module's
  startup and liveness probes default to a **TCP** port check rather than an HTTP
  path check — a conservative default matching this catalog's established pattern
  — and both proved correct on live verification (HTTP 200 on `/health` with real
  "listening and serving HTTP" log lines).

- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for GoAlert are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. Use a distinct value (e.g. `cr`) from any co-deployed `GoAlert_GKE` (`gke`) to avoid a naming collision. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `goalert` | Base name for resources. Do not change after first deploy. |
| `display_name` | `GoAlert` | Human-readable name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `latest` | Image tag. `"latest"` maps to a pinned Dockerfile build arg (`GOALERT_VERSION = v0.34.1`), matching upstream's own recommendation against bare `latest`/`nightly` in production. |
| `admin_username` | `admin` | Username created by the `admin-bootstrap` init job. Genuinely forwarded through `goalert.tf` into `GoAlert_Common`. |
| `admin_email` | `admin@techequity.cloud` | Email for the initial admin account. |
| `public_url` | `""` | Left empty, auto-computes `https://<service>-<project-number>.<region>.run.app`. Used for OIDC/CSRF-referer validation and outgoing-notification links. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | 1 vCPU is sufficient for GoAlert's Go binary. |
| `memory_limit` | `512Mi` | Gen2 hard floor, independent of `cpu_always_allocated`. |
| `cpu_always_allocated` | `true` | Keeps CPU allocated for the whole life of a RUNNING instance — required for the escalation engine's continuous loop. |
| `min_instance_count` | `1` | Not scale-to-zero — at zero instances the escalation engine doesn't run at all. |
| `max_instance_count` | `1` | Single default-mode engine instance; multi-instance needs a `--api-only` topology this module doesn't wire. |
| `container_port` | `8081` | GoAlert's native HTTP port (`GOALERT_LISTEN`). |
| `execution_environment` | `gen2` | Required execution environment. |
| `timeout_seconds` | `300` | Maximum request duration. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy Unix-socket sidecar. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Container path for the Auth Proxy socket. |
| `container_protocol` | `http1` | `"http1"` or `"h2c"`. |
| `enable_image_mirroring` | `true` | Mirrors the GoAlert base image into Artifact Registry. |

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Traffic ingress control. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | VPC egress control. |
| `enable_iap` | `false` | Identity-Aware Proxy. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `GOALERT_LISTEN` and `GOALERT_PUBLIC_URL` are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_17` | Cloud SQL engine. GoAlert requires PostgreSQL. |
| `db_name` | `goalert` | PostgreSQL database name. |
| `db_user` | `goalert` | PostgreSQL application user. |
| `db_password_env_var_name` | `LISTMONK_db__password` | **Leftover copy-paste default from a prior template.** Additive per Foundation semantics — injects an unused extra secret env var alongside the standard `DB_PASSWORD` that GoAlert's entrypoint actually reads. Harmless; clear to `""` if it bothers you. |
| `database_password_length` | `32` | Generated password length (16–64). |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty for `GoAlert_Common`'s default 3-job chain (`db-init` → `db-migrate` → `admin-bootstrap`). A non-empty list replaces it entirely — you take over ordering and content. |
| `cron_jobs` | `[]` | GoAlert has no platform-scheduled recurring tasks by default. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, 30s delay, 30 retries | Accommodates first-boot migration latency (`db-migrate`). |
| `liveness_probe` | disabled | Cloud Run restarts the container on process exit; the startup probe gates readiness. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Cloud Monitoring uptime check. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not required by GoAlert; present for platform compatibility. |

### Group 22 — VPC Service Controls & Audit Logging

Standard `App_CloudRun` VPC-SC integration — see [App_CloudRun](App_CloudRun.md).

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Always `[]` — GoAlert provisions no storage buckets. |
| `container_image` | Deployed image. |
| `initialization_jobs` | Names of the created init jobs (`db-init`, `db-migrate`, `admin-bootstrap`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` | CI/CD status. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through
> the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values and
> combinations at plan time. Invalid configuration fails the **plan** with a clear,
> named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_17` | Critical | Any other engine breaks GoAlert's schema and startup entirely — `pgcrypto` and the whole `goalert migrate` flow are Postgres-specific. |
| `initialization_jobs` order (`db-init` → `db-migrate` → `admin-bootstrap`) | Leave `[]` unless you fully understand the dependency chain | Critical | Running `admin-bootstrap` before `db-migrate` fails with `relation "auth_basic_users" does not exist` on a fresh database — `goalert add-user` has no migration logic of its own. |
| `min_instance_count` / `cpu_always_allocated` | `1` / `true` | High | GoAlert's escalation-timing engine is a continuous in-process loop — at zero instances, or under CPU-throttled request-based billing, escalations for real alerts can be silently delayed or missed entirely. |
| `public_url` | Leave `""` (auto-computed) or set the real external URL | High | An incorrect `GOALERT_PUBLIC_URL` breaks OIDC auth callbacks and every link in outgoing notification emails (falls back to GoAlert's own `http://localhost:8081` if genuinely unset downstream). |
| `admin_username` / `admin_email` | Set once, retrieve password from Secret Manager | Medium | GoAlert has no self-service password reset flow visible from Terraform; losing track of the bootstrapped admin credential means using the `goalert` CLI directly against the database to create a new one. |
| `max_instance_count` | `1` unless you wire a `--api-only` topology | Medium | GoAlert supports multiple engine instances safely (not a double-fire bug per upstream docs), but this module has no built-in mechanism to designate `--api-only` replicas, so scaling past 1 without that extra wiring just runs multiple full engine instances. |
| `db_password_env_var_name` | Leave as-is or clear to `""` | Low | The default `LISTMONK_db__password` is inert leftover cruft from another module's template — harmless, but confusing if you go looking for it in GoAlert's actual config. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. GoAlert-specific application configuration
shared with the GKE variant is described in
**[GoAlert_Common](GoAlert_Common.md)**.
