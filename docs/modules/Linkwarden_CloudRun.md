---
title: "Linkwarden on Google Cloud Run"
description: "Configuration reference for deploying Linkwarden on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Linkwarden on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Linkwarden_CloudRun.png" alt="Linkwarden on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Linkwarden is an open-source, self-hosted bookmark manager that goes beyond
simple link-saving: every bookmark can be automatically archived as a full-page
screenshot, PDF, and single-file "monolith" snapshot using a bundled headless
Chrome, so your links keep working even after the source page changes or
disappears. This module deploys Linkwarden on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Linkwarden uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Linkwarden runs as a single Node.js/Next.js container on Cloud Run v2. The web
server and a background archiving worker run side by side in the SAME
container (via `concurrently`) — there is no separate worker service. The
deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Next.js + headless Chrome container, 2 vCPU / 2 GiB by default, `min_instance_count = 1` (background worker needs to keep running) |
| Database | Cloud SQL for PostgreSQL 15 | Required — Linkwarden's Prisma schema is Postgres-only |
| Object storage | Cloud Storage (GCS Fuse volume) | Mounted at `/data/data` by default for archived screenshots/PDFs/monoliths |
| Cache & queue | None | The archiving worker polls PostgreSQL directly; no Redis/BullMQ dependency |
| Secrets | Secret Manager | Auto-generated `NEXTAUTH_SECRET`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** Linkwarden's Prisma schema hardcodes the
  `postgresql` provider; selecting any other engine breaks the first-boot
  migration.
- **`DATABASE_URL` connects over the private IP, not the socket.** A Cloud SQL
  Unix-socket directory path contains colons that break Prisma's
  URL-authority DSN parsing, so the cloud entrypoint always uses the injected
  `DB_IP` (the real Cloud SQL private IP on Cloud Run) with `sslmode=require`.
- **`NEXTAUTH_URL` is derived automatically**, appending the required
  `/api/v1/auth` suffix to the computed Cloud Run service URL — never set it
  manually with a literal `$(VAR)` template (Cloud Run passes that through
  unexpanded).
- **`min_instance_count = 1` and `cpu_always_allocated = true` by default.**
  The in-container background archiving worker must keep processing the
  queue between requests; scale-to-zero would stop archiving.
- **Headless Chrome runs in-process with the web server.** Unlike Crawl4AI (a
  separate supervisord service), Linkwarden's screenshot/PDF/monolith
  archiving shares the same container/process as the Next.js server — size
  `memory_limit`/`cpu_limit` for the whole container's peak, not just the web
  server. Default: 2 vCPU / 2Gi; bump memory to 4Gi for heavy archiving loads.
- **A GCS volume is mounted automatically at `/data/data`.** This is the
  absolute path Linkwarden's storage code resolves `STORAGE_FOLDER` to
  (verified against the built image), so archived content persists across
  restarts with no NFS required (`enable_nfs = false` by default).
- **No seeded superuser.** The first user to register through the standard
  NextAuth registration flow becomes the instance owner.
- **`DISABLE_BROWSER` is a documented fallback**, not a default. If Cloud
  Run's gVisor sandbox has trouble launching the bundled headless Chrome (a
  similar risk class to the documented Prowlarr s6-overlay/gVisor
  incompatibility elsewhere in this catalogue), set `disable_browser = true`
  to skip all browser-dependent archiving tasks while keeping link
  metadata/tag/collection features working. Verify live before assuming this
  is needed.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Linkwarden service

Linkwarden runs as a Cloud Run v2 service that autoscales by request load
between the minimum and maximum instance counts. Each deployment creates an
immutable revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs,
  and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Linkwarden stores all application data (bookmarks, collections, tags, users,
archive metadata) in a managed Cloud SQL for PostgreSQL 15 instance. The cloud
entrypoint connects over the Cloud SQL private IP directly (`DB_IP`), not the
Auth Proxy Unix socket — a Prisma-specific requirement, since a socket
directory path breaks URL-authority DSN parsing. On first deploy an
initialization Job creates the application database and user; Linkwarden then
runs its own `prisma migrate deploy` on every container start.

- **Console:** SQL → select the instance for connections, backups, flags,
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection
model, backups, and password rotation.

### C. Cloud Storage (archived content)

A dedicated **Cloud Storage** bucket is provisioned automatically and mounted
via GCS Fuse at `/data/data` by default — the absolute path Linkwarden's
storage code resolves `STORAGE_FOLDER` to at runtime. Both the web and worker
processes resolve to this same path despite running from different working
directories inside the container.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Secret Manager

One secret is generated automatically and stored in Secret Manager:
`NEXTAUTH_SECRET` (signs NextAuth session JWTs). The database password is
managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS
load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered
on; ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to
Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Linkwarden Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh`
  using `postgres:15-alpine`. It connects through the Cloud SQL private IP
  and idempotently creates the application database and user and grants
  privileges. The job is safe to re-run.
- **Schema migrations run on every boot.** Linkwarden's base image `CMD` runs
  `prisma migrate deploy` before starting the web and worker processes, so
  upgrading the application version applies schema changes automatically —
  there is no separate migration job.
- **`NEXTAUTH_SECRET` is immutable after first boot.** Generated once and
  written to Secret Manager. Rotating it invalidates every active session,
  forcing all users to log in again.
- **No pre-seeded admin account.** The first user to register through the
  standard NextAuth registration flow becomes the instance owner — there is
  no default credential to retrieve.
- **Background archiving worker.** A separate process (`worker.ts`, run via
  `concurrently` alongside the web server in the same container) polls
  PostgreSQL directly and processes queued links in batches
  (`ARCHIVE_TAKE_COUNT`, default `5`). Each batch launches headless Chrome
  instances for screenshot/PDF/monolith capture — CPU/memory spike briefly
  during each batch.
- **Health path.** Startup and liveness probes default to `/` — Linkwarden has
  no confirmed dedicated health endpoint. The startup probe allows a generous
  window (60s initial delay, 30 failure threshold) to absorb Next.js cold
  start plus headless Chrome/Playwright initialization.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Linkwarden are listed; every other input
is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 / 2 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `linkwarden` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Linkwarden` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Linkwarden publishes a genuine `latest` tag upstream — this pins/tracks the real upstream release, unlike some other custom-build modules. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | 2 vCPU — headless Chrome archiving runs in-process with the web server. |
| `memory_limit` | `2Gi` | Minimum for bundled headless Chromium; bump to `4Gi` for heavy PDF/screenshot workloads. |
| `cpu_always_allocated` | `true` | Keeps the background archiving worker processing between requests. |
| `min_instance_count` | `1` | Keeps the archiving worker alive; scale-to-zero would stop background archiving. |
| `max_instance_count` | `5` | Autoscaling upper bound. |
| `container_port` | `3000` | Linkwarden (Next.js) listens on port 3000. |
| `execution_environment` | `gen2` | Required for GCS Fuse mounts. |
| `enable_cloudsql_volume` | `true` | Kept for parity; the entrypoint connects over `DB_IP` directly, not the socket. |
| `enable_image_mirroring` | `true` | Mirror the Linkwarden image into Artifact Registry. |

### Group 5 — Access & Ingress Control

Standard `ingress_settings`, `vpc_egress_setting`, `enable_iap` — see
[App_CloudRun](App_CloudRun.md).

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `DATABASE_URL`, `NEXTAUTH_URL`, `PORT`, and `HOSTNAME` are set automatically — do not set them here. |
| `disable_browser` | `false` | Sets `DISABLE_BROWSER` — skips all headless-Chrome archiving tasks. Fallback if Cloud Run's sandbox misbehaves with Chrome. |
| `archive_take_count` | `5` | Links processed per background-worker batch (`ARCHIVE_TAKE_COUNT`). |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Off by default — Linkwarden uses a GCS volume instead for simplicity. |
| `gcs_volumes` | `[]` (falls back to a built-in default) | A default "storage" volume mounted at `/data/data` is wired automatically unless you supply your own list, which fully replaces it. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Linkwarden's Prisma schema is Postgres-only. |
| `db_name` | `linkwarden` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `linkwarden` | Application database user. Password auto-generated in Secret Manager. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. Linkwarden runs its own Prisma migrations on boot — no separate migrate job is needed. |
| `cron_jobs` | `[]` | Not used by default. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/` | Linkwarden has no confirmed dedicated health endpoint; generous timing window for cold start + Chrome init. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check; disabled by default. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not used by Linkwarden — its archiving worker polls PostgreSQL directly. Kept for Foundation-variable parity. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore
the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `initialization_jobs` | Names of the setup jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time. Most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `NEXTAUTH_SECRET` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates every active session, forcing all users to log in again. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `database_type` | `POSTGRES_15` (fixed) | Critical | Any other engine breaks the first-boot Prisma migration entirely. |
| `min_instance_count` | `1` | High | Scale-to-zero stops the background archiving worker between requests — queued links never get archived. |
| `memory_limit` | `2Gi` minimum | High | Headless Chrome archiving OOMs below this floor; the web server may still respond while archiving silently fails. |
| `enable_nfs` + `gcs_volumes` | Leave `enable_nfs=false`, use the default GCS volume | Medium | Enabling NFS without also disabling the default GCS volume wiring can leave archived content split across two storage backends. |
| `disable_browser` | `false` unless Chrome fails on Cloud Run's sandbox | Medium | Leaving it `true` unnecessarily disables all screenshot/PDF/monolith archiving — Linkwarden becomes a plain link list. |
| `archive_take_count` | `5` (default) | Low | Large values spike CPU/memory sharply during each batch (concurrent headless Chrome instances). |
| `ingress_settings` | `all` for normal use | Medium | Restricting to `internal` blocks the public login/registration flow needed for the first-run owner account. |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Linkwarden-specific application
configuration shared with the GKE variant is described in
**[Linkwarden_Common](Linkwarden_Common.md)**.
