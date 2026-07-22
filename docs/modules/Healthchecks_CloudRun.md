---
title: "Healthchecks on Google Cloud Run"
description: "Configuration reference for deploying Healthchecks on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Healthchecks on Google Cloud Run

Healthchecks is an open-source, self-hosted cron job and heartbeat monitoring
service: scheduled tasks "ping" it on success (or a task pings it periodically
and Healthchecks watches for a missed ping), and it alerts you by email, Slack,
SMS, or any of 100+ other integrations when a ping is late or missing. This
module deploys Healthchecks on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Healthchecks uses and how to explore
and operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Healthchecks runs as a Django/uWSGI container on Cloud Run v2. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | uWSGI service, 1 vCPU / 512 MiB by default, always-on (not scale-to-zero) |
| Database | Cloud SQL for PostgreSQL 15 | Required — the `DB` env var is explicitly set to `postgres`, overriding the image's SQLite fallback |
| Secrets | Secret Manager | Auto-generated `SECRET_KEY` and initial admin password; database password |
| Ingress | Cloud Run URL | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory**, and `DB = "postgres"` is set explicitly. The
  upstream image otherwise silently falls back to a throwaway, container-local
  SQLite database with no error — the same class of trap already documented in
  this catalog for Wallabag.
- **The container image is genuinely prebuilt** (`healthchecks/healthchecks`) —
  `container_image_source` defaults to `"prebuilt"` and no Cloud Build step runs.
- **`cpu_always_allocated = true` and `min_instance_count = 1` by default** — the
  `sendalerts`/`sendreports` background loop that notices missed check-ins and
  fires alerts is co-located in the same container and runs continuously,
  independent of inbound HTTP requests (the same shape as n8n/Kestra). Under the
  request-based billing this catalogue defaults to for most apps, that loop would
  be throttled to near-zero between requests and could silently stop noticing
  missed check-ins.
- **No dedicated health endpoint.** Startup/liveness probes target `/` (the
  public login page). `ALLOWED_HOSTS = "*"` is set so the platform's own internal
  probe Host header is never rejected by Django's host validation.
- **The initial admin account is seeded once**, not self-healing. An
  `admin-bootstrap` init job runs migrations and creates the superuser
  (`admin_email` / a generated Secret Manager password) via Django's stock
  `createsuperuser --noinput`. Re-running the job is a safe no-op if the account
  already exists.
- **Outbound email is a placeholder by default.** `DEFAULT_FROM_EMAIL` defaults
  to `healthchecks@example.org`. Configure real `EMAIL_HOST`/`EMAIL_HOST_USER`/
  `EMAIL_HOST_PASSWORD` post-deploy or alerts will fail to actually deliver.
- **No Redis, no object storage.** Healthchecks stores all state — checks,
  pings, users, alert configuration — in PostgreSQL alone.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Healthchecks service

Healthchecks runs as a Cloud Run v2 service. Each deployment creates an
immutable revision; traffic can be split across revisions for safe rollouts.

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

### B. Cloud SQL for PostgreSQL 15

Healthchecks stores all application data (checks, pings, integrations, users,
alert history) in a managed Cloud SQL for PostgreSQL 15 instance. The service
connects privately through the **Cloud SQL Auth Proxy** over a Unix socket; no
public IP is exposed. On first deploy, initialization Jobs create the
application database/role and seed the initial admin account.

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

Two cryptographic values are generated automatically and stored in Secret
Manager: `SECRET_KEY` (Django session/CSRF signing key) and `ADMIN_PASSWORD`
(the initial superuser password, seeded once). The database password is managed
separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~healthchecks"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs (including the `sendalerts`/`sendreports` background workers,
which log to the same stdout stream as the web server) flow to Cloud Logging;
Cloud Run and Cloud SQL metrics flow to Cloud Monitoring, with optional uptime
checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Healthchecks Application Behaviour

- **First-deploy database setup.** The `db-init` initialization Job runs using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and
  idempotently creates the application role and database. The job is safe to
  re-run.
- **Admin account bootstrap.** The `admin-bootstrap` Job (using the Healthchecks
  image itself) runs `manage.py migrate --noinput`, then `manage.py
  createsuperuser --noinput --username admin --email <admin_email>` (password
  from a generated Secret Manager secret). Because Cloud Run init jobs run
  strictly before the main Service is created — and because a job invokes the
  container's command directly, bypassing the image's own `uwsgi.ini` boot chain
  — the job runs its own migration first rather than assuming the schema already
  exists.
- **Database migrations also run on every normal container start** of the main
  service (the image's `uwsgi.ini` has `hook-pre-app = exec:./manage.py migrate`
  built in), so upgrading `application_version` applies schema changes
  automatically.
- **The `sendalerts`/`sendreports` background loop is co-located in the same
  container**, started automatically by the image's own `uwsgi.ini` alongside
  the web server (`attach-daemon` entries) — no separate worker service is
  deployed. This is the loop that actually detects missed check-ins and sends
  alerts, and it needs the container to be both running (`min_instance_count =
  1`) and CPU-allocated (`cpu_always_allocated = true`) to work reliably.
- **Health path.** Startup and liveness probes target `/` — Healthchecks has no
  dedicated health endpoint; the root login page always responds unauthenticated
  and would 500 (not render) if the database connection were broken.
- **Sign-in, not sign-up.** Healthchecks has no public self-service sign-up flow
  by default; the only account is the one seeded by `admin-bootstrap`.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Healthchecks are listed; every other input
is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `healthchecks` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Healthchecks` | Human-readable name shown in the Console. |
| `admin_email` | `admin@techequity.cloud` | Email/username for the initial superuser, seeded once. |
| `default_from_email` | `healthchecks@example.org` | Placeholder sender address until real SMTP is configured. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | The official image needs no custom build. |
| `container_image` | `""` | Leave empty to use `healthchecks/healthchecks:<application_version>`. |
| `container_port` | `8000` | The upstream image's uWSGI server binds here (`docker/uwsgi.ini`). |
| `min_instance_count` | `1` | Keeps the always-on alert loop warm. Setting `0` risks missed alerts while idle. |
| `max_instance_count` | `1` | A single instance is sufficient; the alert loop is not designed for multi-instance coordination. |
| `cpu_always_allocated` | `true` | Required for the in-process alert loop to run reliably between requests. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy Unix socket — `DB_HOST` is a discrete libpq/psycopg param, so the socket directory works verbatim. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Configure `EMAIL_HOST`/`EMAIL_PORT`/`EMAIL_HOST_USER` here for real alert delivery. Do not set `DB`, `SECRET_KEY`, or `DB_*` — injected automatically. |
| `secret_environment_variables` | `{}` | Use for `EMAIL_HOST_PASSWORD` or other sensitive SMTP credentials. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Not used — Healthchecks needs no shared filesystem. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Generic Foundation default; unused by the application itself. |

### Group 12 — Database

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed; MySQL/SQLite are not wired through this module. |
| `application_database_name` | `healthchecks_db` | Immutable after first deploy. |
| `application_database_user` | `healthchecks_user` | Password auto-generated in Secret Manager. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` + `admin-bootstrap` jobs. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 60s delay | No dedicated health endpoint exists; `/` is the public login page. |
| `liveness_probe` | HTTP `/` 30s delay | Same rationale. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not used — Healthchecks has no documented Redis integration. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `initialization_jobs` | Names of the setup jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `DB` (auto-set) | `"postgres"` | Critical | If somehow unset, the app silently uses a throwaway local SQLite DB — checks and alert history vanish on every restart, with no error. |
| `min_instance_count` / `cpu_always_allocated` | `1` / `true` | High | Scaling to zero or switching to request-based billing throttles the co-located `sendalerts` loop between requests, so missed check-ins can silently go unnoticed. |
| `ADMIN_PASSWORD` (auto-generated) | Retrieve once, rotate via UI after | Medium | The seeded password is only set on the FIRST successful `admin-bootstrap` run; re-running the job does not update it. |
| `DEFAULT_FROM_EMAIL` / SMTP vars | Configure real SMTP post-deploy | High | Left at the placeholder default, `sendalerts` logs delivery errors instead of actually notifying anyone of a missed check-in. |
| `ALLOWED_HOSTS` (auto-set to `"*"`) | Leave as-is unless you have a specific reason | Low | Disabling Django's Host header validation entirely is an accepted trade-off here to keep platform health probes working; Healthchecks has no other Host-based security model. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `container_image_source` | `prebuilt` | Critical | Switching to `custom` with no Dockerfile in `Healthchecks_Common/scripts` fails the build — Healthchecks has no custom-build script by design. |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Healthchecks-specific application
configuration shared with the GKE variant is described in
**[Healthchecks_Common](Healthchecks_Common.md)**.
