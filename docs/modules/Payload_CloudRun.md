---
title: "Payload CMS on Google Cloud Run"
description: "Configuration reference for deploying Payload CMS on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Payload CMS on Google Cloud Run

Payload CMS is a TypeScript-native, code-first headless CMS and application framework built
directly on Next.js — not a hosted SaaS product, but a library installed into your own Next.js
application. Content is modeled through typed "Collections" defined in `payload.config.ts`, and
Payload generates an admin UI plus REST, GraphQL, and Local APIs from that same config. This
module deploys a real Payload application on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud
infrastructure.

This guide focuses on the cloud services this deployment uses and how to explore and operate them
from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run
application — service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Payload runs as a Node.js (Next.js) container on Cloud Run v2. There is **no official Payload
Docker image** — this module builds a real, locally-verified starter application from source (a
blank `create-payload-app` template using the PostgreSQL adapter) via Cloud Build. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js (Next.js standalone) service, serverless autoscaling; scale-to-zero supported by default |
| Build | Cloud Build | Builds the bundled Payload starter app from `Payload_Common/scripts/Dockerfile` — no prebuilt image exists to pull |
| Database | Cloud SQL for PostgreSQL 15 | Required — Payload's Postgres adapter is used; MySQL/MongoDB are not wired |
| Object storage | None | No bucket is provisioned; media uploads go to local, ephemeral container disk |
| Secrets | Secret Manager | Auto-generated `PAYLOAD_SECRET`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory and schema is not created on boot.** Booting the built server
  against a fresh database creates zero tables — the `payload-migrate` init job applies schema via
  the `payload migrate` CLI, using a pre-generated migration file baked into the image.
- **`container_image_source` is fixed at `"custom"`.** There is nothing to deploy without a Cloud
  Build run — the module always builds `Payload_Common/scripts/` from source.
- **Health probes target `/admin`, not `/` or an API route.** `/admin` serves Payload's
  login/first-user-creation form and returns an unauthenticated `200`; Payload's REST/GraphQL
  routes require auth and are unsuitable probe targets.
- **No storage bucket is provisioned.** Uploaded media is written to local container disk and
  does not survive a pod restart or redeploy.
- **`enable_redis` and related Group 21 variables are declared but inert.** They are not forwarded
  to `Payload_Common`, which has no Redis wiring.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`). Cold starts add latency to
  the first request after idle, compounded by Next.js's own cold-start cost.
- **The first admin user is created manually.** Payload has no non-interactive CLI for this —
  visiting `/admin` on an empty `users` collection shows a signup form.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported in
the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Payload service

Payload runs as a Cloud Run v2 service that autoscales by request load between the minimum and
maximum instance counts. Each deployment creates an immutable revision.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and traffic
splitting.

### B. Cloud Build — building the Payload image

Because no official Payload image exists, every deploy (and every redeploy after a Dockerfile or
source change) triggers a Cloud Build run against `Payload_Common/scripts/`.

- **Console:** Cloud Build → History.
- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --limit=10
  gcloud builds log <build-id> --project "$PROJECT"
  ```

### C. Cloud SQL for PostgreSQL 15

Payload stores all application data (Collections, users, uploaded document metadata) in a managed
Cloud SQL for PostgreSQL 15 instance. The service connects privately through the **Cloud SQL Auth
Proxy** over a Unix socket; no public IP is exposed. On first deploy, `db-init` creates the
database and role, then `payload-migrate` applies the schema.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs). See
[App_CloudRun](App_CloudRun.md) for the connection model, backups, and password rotation.

### D. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager: `PAYLOAD_SECRET`
(used to sign Payload's own session/auth tokens). The database password is managed separately by
the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load balancer with a
custom domain, Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Payload Application Behaviour

- **First-deploy database setup.** `db-init` (using `postgres:15-alpine`) connects through the
  Cloud SQL Auth Proxy and idempotently creates the application role and database.
- **Schema migration is a separate, dependent job.** `payload-migrate` (`depends_on_jobs =
  ["db-init"]`) runs `./node_modules/.bin/payload migrate` from a full `/app/cli` copy of
  `node_modules` + TypeScript source baked into the image — the trimmed Next.js standalone runtime
  used to serve traffic does not include the Payload CLI or its dependencies. This is a real
  behavioural fact confirmed locally: booting the app against a schema-less database serves zero
  tables and every collection query fails until migrations have run.
- **`PAYLOAD_SECRET` should be treated as immutable after first boot.** It signs Payload's
  session/auth tokens; rotating it invalidates all active sessions.
- **Health path.** Startup and liveness probes target `/admin` — Payload's admin UI route, which
  returns an unauthenticated `200` once the Node.js server and database connection are ready.
  Allow several minutes on first boot for the `payload-migrate` job to complete before the service
  is expected to serve real content.
- **First admin account.** Payload has no CLI command to create the first admin user
  non-interactively. Visit `$SERVICE_URL/admin` — with an empty `users` collection Payload shows a
  signup form to create the first administrator. This is a manual, one-time operator step.
- **Media uploads do not persist.** No storage bucket is provisioned; uploaded files are written
  to local container disk and are lost on the next pod restart, redeploy, or scale-to-zero cold
  start replacing the container.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific
to or notable for Payload are listed; every other input is inherited from
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

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `payload` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Payload CRM` | Human-readable name shown in the Console. Leftover text from the module's clone source — override to `Payload CMS` (or any label you prefer) at deploy time; it is cosmetic only. |
| `application_version` | `latest` | Deployment-tracking tag baked into the image via the Cloud Build `application_version` build arg. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Payload (Next.js) needs headroom for the standalone server plus the migrate job's TypeScript/CLI footprint. |
| `cpu_always_allocated` | `false` | Request-based billing — Payload runs server-only (no worker process, cron disabled), so it is pure request/response with nothing to throttle. |
| `min_instance_count` / `max_instance_count` | `0` / `3` | `0` enables scale-to-zero. |
| `container_port` | `3000` | Next.js default. |
| `container_image_source` | `custom` | Fixed — there is no prebuilt Payload image to deploy. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `enable_image_mirroring` | `true` | Mirrors the built image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public by default. |
| `enable_iap` | `false` | Require Google sign-in — blocks anonymous visitors from `/admin`'s first-user signup form if enabled before the first admin exists. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not set `PAYLOAD_SECRET` or `DATABASE_URL` here — both are computed automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 11 — Cloud Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_gcs_storage` | `false` | Declared in `variables.tf` with a description implying an S3-compatible GCS storage adapter, but **not forwarded** to `Payload_Common` — has no effect. `Payload_Common`'s `storage_buckets` output is always `[]`. |
| `gcs_volumes` | `[]` | Genuinely forwarded — GCS Fuse volume mounts, if you want to wire persistent storage in yourself. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed; Payload requires PostgreSQL. |
| `db_name` / `db_user` | `payload` / `payload` | PostgreSQL database name and application user. Immutable after first deploy. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` → `payload-migrate` chain. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/admin`, 120s delay, 15s period, 40 retries | ~12-minute total window for first-boot migrations to complete. |
| `liveness_probe` | HTTP `/admin`, 30s delay | Liveness probe. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` / `redis_host` / `redis_port` / `redis_auth` | `true` / `""` / `6379` / `""` | **Inert.** Declared in `variables.tf` (with a description claiming Payload v0.4+ requires Redis) but never forwarded to `Payload_Common`, which has no Redis wiring at all. Setting these has no effect. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running
resources.

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
| `storage_buckets` | Always empty — no bucket is provisioned. |
| `container_image` / `container_registry` | Built image and Artifact Registry repo. |
| `initialization_jobs` | Names of the `db-init` and `payload-migrate` jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) — **Medium**
> (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `PAYLOAD_SECRET` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates every active session, forcing all users to log back in. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `startup_probe` / `payload-migrate` timing | Allow the full ~12-minute window | High | If the probe window is shortened below the time `payload-migrate` needs, the revision can be marked unhealthy before schema migration finishes, since the two run concurrently rather than the probe waiting on the job. |
| Media/upload persistence | Add a real storage adapter before production use | High | With no storage bucket wired, all uploaded media lives on local container disk and is lost on every pod restart, redeploy, or cold start. |
| `enable_gcs_storage` | Do not rely on this toggle | Medium | Declared but not forwarded to `Payload_Common` — enabling it does not provision or wire any storage. |
| `enable_redis` / `redis_*` | Do not rely on these toggles | Medium | Declared but not forwarded to `Payload_Common`, which has no Redis wiring — setting them has no effect. |
| First admin creation | Complete promptly after deploy | Medium | Until the first admin is created via the `/admin` signup form, the instance has no authenticated user at all. |
| `container_image_source` | Leave at `custom` | Low | There is no prebuilt Payload image; setting `prebuilt` without a valid `container_image` breaks the deploy. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency,
ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and
image mirroring — see **[App_CloudRun](App_CloudRun.md)**. Payload-specific application
configuration shared with the GKE variant is described in
**[Payload_Common](Payload_Common.md)**.
