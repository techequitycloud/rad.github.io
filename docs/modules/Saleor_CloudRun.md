---
title: "Saleor on Google Cloud Run"
description: "Configuration reference for deploying Saleor on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Saleor on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Saleor_CloudRun.png" alt="Saleor on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Saleor is an open-source, GraphQL-first headless e-commerce platform built on
Python/Django (product catalog, checkout, orders, and payment plugins, all exposed
through a GraphQL API rather than a bundled storefront). This module deploys Saleor
on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Saleor uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Saleor costs on RAD, and how that compares

**Running Saleor in your own GCP project costs about $100.40/month in Google Cloud charges; RAD's module fee is a one-time 175 credits (or 157.5 credits in a RAD-managed project), covering setup and support -- not the ongoing cloud bill, which Google bills you directly in your own project or RAD meters hourly in credits in a RAD-managed one.**
Or see the GKE guide for the alternative deployment target; either way, if you deploy into a RAD-managed project you can pause the whole thing for free when you are not using it -- see [Pause it for free](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) below.

### What you pay on RAD

| | Your own project | RAD-managed project |
|---|---|---|
| Module fee | 175 credits, once | 157.5 credits, once (10% lower) |
| Build time | metered in credits as the build runs (a few credits, typically) | same |
| Google Cloud running cost | ~$100.40/month, billed to your own billing account at Google's list price | ~32 credits/day, metered hourly by RAD at list price plus margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| Cloud Run, 2x vCPU / 3 GiB (scaleToZero) | $29.95 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | $51.02 |
| NFS/cache file server (small VM) | $13.43 |
| Cloud NAT and networking | $5.00 |
| Cloud Storage (add-ons, backups) | $1.00 |
| **Total** | **$100.40** |

### How it compares

- Saleor's own official managed offering, Saleor Cloud, starts at **$1,599/month** (Select tier, up to $200,000 GMV; source: https://saleor.io/pricing) -- aimed at production storefronts at real transaction volume, so it is not a like-for-like comparison with a single self-serve deployment, but it is the only verified commercial price for this exact platform.
- Running it yourself on a bare VPS is still the cheapest cash option -- Hetzner CPX22 (2 vCPU/4GB) runs about **$24/month**, a DigitalOcean 2 vCPU/4GB Droplet is also **$24/month**, and a GCP Compute Engine e2-standard-2 (2 vCPU/8GB) is about **$49/month** -- plus the admin's own time for backups, security patches and upgrades, which RAD's managed Cloud SQL, Secret Manager and monitoring cover for you -- but RAD's price is never meant to beat a VPS, only to replace the admin time a VPS still needs.
- Saleor is a commerce API that live storefronts depend on, so uptime tends to matter more here than squeezing the running cost down -- but the same pause mechanism below still applies to a staging or demo storefront that is not taking live orders.

### Pause it for free: delete a RAD-managed project, restore it when you need it

**This is the headline for a RAD-managed project.** Deleting a RAD-managed project first unlinks
its billing, then asks Google to delete the project outright -- Google's own 30-day recoverable
soft delete. Unlike deleting one module, this does not tear down Cloud SQL, any VM or the
compute resource one by one: the whole project simply stops, and nothing is charged while it
waits, because billing is already unlinked.

Restoring, within 30 days and only by the project's owner, asks Google to undelete the project
and reattaches its billing account, then asks you to run Update on each deployment to confirm
everything came back. Because nothing was individually destroyed, that Update finds the same
resources already there -- it is a check, not a rebuild, and an Update never charges the module
fee again. This costs only a handful of credits (under US$1) in total for a typical 2-3-deployment
chain.

What this needs: you must own the project (not one RAD only manages billing for), you must
restore it yourself within 30 days -- after that Google deletes it for good -- and restoring is
admitted like creating a new project, so your purchased credit balance must still clear the
tier's floor (100 credits for the sandbox tier most study/demo use fits). Google says most
services are fully working again within 36 hours of a restore.

**One real gap:** nightly backups are written to a bucket inside the project, and that bucket has
Cloud Storage's soft-delete explicitly turned off, so it is very likely gone as soon as you delete
the project -- even though the project itself is recoverable for 30 days. If you have customised
the app and want to keep that work, copy a backup out (to Google Drive, or a bucket outside the
project) before deleting. For a default install with nothing irreplaceable in it, this does not
matter.

### Pay only while you use it, the other way: delete and redeploy

In your own project (or once you are past the 30-day restore window above), the alternative is to delete Saleor outright and redeploy it later. A redeploy costs the module fee again, plus the builds -- roughly 175 + 3-6 credits of build time.

Deleting saves money only once Saleor would otherwise sit unused long enough to clear that redeploy cost against its own daily running cost -- against the own-project total above, that works out to about 5 days or more. Most of the running cost here is usually the database and the NFS/cache VM; they stop only when nothing else in the project uses them, so deleting this app while something else shares the project saves only this app's own compute part.

**Keep data first:** nightly backups go to a bucket inside the deployment and are deleted with it, so copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training:** a trainer runs a session for a class. Each participant gets the
  app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies:** a partner runs the app for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.
- Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
  by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; radmodules.dev/pricing for RAD's own fees and daily-credit estimates; https://cloud.google.com/resource-manager/docs/delete-restore-projects for the pause/restore mechanics; https://saleor.io/pricing for the named competitor's price.

## 1. Overview

Saleor runs as a custom-built container (`ghcr.io/saleor/saleor:3.23` wrapped with a
cloud entrypoint) on Cloud Run v2. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Two Cloud Run services: the main Saleor API (uvicorn, 2 workers + co-located Celery worker/beat) and a separate prebuilt Dashboard service; 2 vCPU / 3 GiB by default on the main service |
| Database | Cloud SQL for PostgreSQL 15 | Required — fixed by `Saleor_Common` regardless of `database_type` |
| Object storage | Cloud Storage | A dedicated `media` bucket provisioned automatically |
| Cache & broker | Redis (optional) | Backs `CACHE_URL`/`CELERY_BROKER_URL` for the co-located Celery worker |
| Secrets | Secret Manager | Auto-generated `SECRET_KEY`, `RSA_PRIVATE_KEY`, `DJANGO_SUPERUSER_PASSWORD`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, fully public; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** `Saleor_Common` fixes the database engine;
  selecting any other value in `database_type` has no effect.
- **The Celery worker (order processing, webhooks, emails, scheduled tasks) runs
  co-located inside the main container**, started as a background process by the
  cloud entrypoint — not a separate `additional_services` sidecar. It needs the same
  custom-built image the Foundation only knows the Artifact Registry path for
  *after* this module call, so co-location avoids a plan-time cycle.
- **`cpu_always_allocated = true` by default.** The co-located Celery worker needs
  continuous CPU between requests, not only while serving a request — confirmed live
  that request-based billing under-resources the combined workload.
- **Resource sizing is pre-tuned: `2000m` CPU / `3Gi` memory.** Confirmed live that
  smaller sizes OOMKill under the combined load of 2 uvicorn workers + Django +
  Celery worker/beat, all in one container.
- **Three secrets are generated automatically**: `SECRET_KEY`, `RSA_PRIVATE_KEY`
  (Saleor's JWT signing keypair — must never be rotated casually), and
  `DJANGO_SUPERUSER_PASSWORD`.
- **A separate, genuinely prebuilt Dashboard service** (`ghcr.io/saleor/saleor-dashboard:3.23`)
  is deployed alongside the API as an `additional_services` entry. Its `API_URL` is
  baked into the served UI at container start, computed from the main API's own
  predicted service URL + `/graphql/`.
- **Redis is optional and off by default** (`enable_redis = false`). When enabled,
  `redis_host` must be set explicitly — Cloud Run has no automatic NFS-IP fallback.
- **Health probes target `/health/`**, unauthenticated, confirmed 200 both locally
  and live.
- **`min_instance_count = 0`** by default — the main API scales to zero when idle;
  set to `1` in production to avoid cold starts.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Saleor API and Dashboard services

Saleor's API runs as a Cloud Run v2 service that autoscales by request load. The
Dashboard runs as a second, independent Cloud Run service (an `additional_services`
entry) serving the static admin UI bundle.

- **Console:** Cloud Run → select either service for revisions, traffic, logs, and
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

Saleor stores all application data (products, orders, checkouts, users, payment
records) in a managed Cloud SQL for PostgreSQL 15 instance. The service connects
privately through the **Cloud SQL Auth Proxy** (Unix socket or TCP private IP
depending on `enable_cloudsql_volume`); no public IP is exposed. On first deploy,
`db-init` creates the application database and role, then `db-migrate` (which
depends on `db-init`) applies Django's schema migrations.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the
connection model, backups, and password rotation.

### C. Cloud Storage

A dedicated **Cloud Storage** `media` bucket is provisioned automatically for
Saleor's uploaded product/media assets. Additional buckets can be declared via
`storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Redis (cache & Celery broker)

Redis is **disabled by default**. When `enable_redis = true` is set, `redis_host`
and `redis_port` are injected as `REDIS_HOST`/`REDIS_PORT`, and the cloud entrypoint
composes `CACHE_URL` (Redis DB `/0`) and `CELERY_BROKER_URL` (Redis DB `/1`) from
them.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the composed URLs in the running revision's logs (entrypoint echoes on start):
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

### E. Secret Manager

Three secrets are generated automatically and stored in Secret Manager:
`SECRET_KEY` (Django's cryptographic signing key), `RSA_PRIVATE_KEY` (JWT signing
keypair for all issued access/refresh tokens), and `DJANGO_SUPERUSER_PASSWORD`
(bootstrap admin account password). The database password is managed separately by
the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The main API service is reachable at its `run.app` URL by default (fully public —
`ingress_settings = "all"`). The Dashboard service is deployed with
`ingress = INGRESS_TRAFFIC_ALL` so the admin UI is also directly reachable. An
external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can be
layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs from both services flow to Cloud Logging; Cloud Run and Cloud SQL
metrics flow to Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Saleor Application Behaviour

- **First-deploy database setup.** `db-init` (`postgres:15-alpine`) idempotently
  creates the application database and role. `db-migrate` (the application image,
  `depends_on_jobs = ["db-init"]`) then runs `python3 manage.py migrate --noinput`.
  Both jobs are safe to re-run.
- **Extensions always installed.** `pg_trgm`, `unaccent`, `hstore`, and `citext` are
  installed unconditionally by `Saleor_Common`'s assembled configuration — the
  calling module's `enable_postgres_extensions`/`postgres_extensions` variables have
  no additional effect on this base set.
- **Celery worker + beat runs co-located, not as a separate service.** Order
  processing, webhooks, emails, and scheduled tasks all run inside the main
  container's background worker process. This is why `cpu_always_allocated`
  defaults to `true` — without continuous CPU allocation, the worker starves between
  API requests.
- **`SECRET_KEY`, `RSA_PRIVATE_KEY`, and `DJANGO_SUPERUSER_PASSWORD` are immutable
  after first boot.** `RSA_PRIVATE_KEY` in particular signs every JWT Saleor issues —
  rotating it invalidates all active sessions. Only rotate during a planned
  maintenance window.
- **Superuser bootstrap.** The cloud entrypoint runs
  `manage.py createsuperuser --email $SALEOR_SUPERUSER_EMAIL --noinput` on every
  boot when `DJANGO_SUPERUSER_PASSWORD` is set (idempotent — a no-op once the user
  exists). `SALEOR_SUPERUSER_EMAIL` defaults to `admin@example.com` and is not
  exposed as a variable on this module — it is `Saleor_Common`'s own fixed default.
- **Health path.** Startup and liveness probes target `/health/` — Saleor's
  unauthenticated health endpoint, confirmed to return `200` as soon as the ASGI
  server accepts connections.
- **Dashboard's `API_URL` is baked in at container start**, not read dynamically —
  confirmed via the official Dashboard image's own
  `/docker-entrypoint.d/50-replace-env-vars.sh`, which sed-replaces `API_URL` into
  the built `index.html`. On Cloud Run this is a computed string (the main API's own
  predicted service URL + `/graphql/`), safe for `for_each` planning since it is not
  known-after-apply.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Saleor are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the services and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `saleor` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Saleor Application` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Maps to the `SALEOR_VERSION` build ARG (`3.23` when `latest`) and the Dashboard image's own tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "3Gi" }` | Sized for the combined uvicorn + Celery workload — see Overview. |
| `cpu_always_allocated` | `true` | Required so the co-located Celery worker keeps processing between requests. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` to avoid cold starts. |
| `max_instance_count` | `1` | Cost ceiling. |
| `container_port` | `8000` | uvicorn's bind port — must match the base image's `CMD`. |
| `execution_environment` | `gen2` | Gen2 required for NFS/GCS Fuse mounts, if used. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the built image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Fully public by default. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings, merged on top of `Saleor_Common`'s own defaults (`ALLOWED_HOSTS`, `SALEOR_SUPERUSER_EMAIL`). Do not set `SECRET_KEY`, `RSA_PRIVATE_KEY`, or `DJANGO_SUPERUSER_PASSWORD` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

Standard `backup_schedule`, `backup_retention_days`, `enable_backup_import`,
`backup_source`, `backup_file`, `backup_format` — see
[App_CloudRun](App_CloudRun.md).

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md).

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

Standard App_CloudRun load balancer/CDN/Artifact Registry cleanup options — see
[App_CloudRun](App_CloudRun.md).

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional buckets, on top of the `Saleor_Common`-declared `media` bucket. |
| `enable_nfs` | `true` | Declared but not used by Saleor's own storage path — media is served from the `media` GCS bucket. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Declared for convention parity; `Saleor_Common` always fixes PostgreSQL 15 regardless of this value. |
| `application_database_name` | `saleor_db` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `saleor_user` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |

### Group 12 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty for the built-in `db-init` → `db-migrate` pair. |
| `cron_jobs` | `[]` | Recurring jobs (e.g. Saleor management commands) via Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health/`, 20s delay | Startup probe forwarded to `Saleor_Common`. |
| `liveness_probe` | HTTP `/health/`, 30s delay | Liveness probe forwarded to `Saleor_Common`. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enables Saleor's cache/broker over Redis. |
| `redis_host` | `""` | Must be set explicitly when enabled — no automatic fallback on Cloud Run. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

Standard App_CloudRun VPC-SC and audit logging options — see
[App_CloudRun](App_CloudRun.md).

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name (main API). |
| `service_url` | Default `run.app` URL of the main API service. |
| `service_location` | Region the services run in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets (including `media`). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed API image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the `db-init`/`db-migrate` jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

The Dashboard service's own URL is surfaced back into the main API's environment as
`SALEOR_DASHBOARD_URL` rather than as a top-level Terraform output.

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `RSA_PRIVATE_KEY` (auto-generated) | Never rotate outside a maintenance window | Critical | Rotating it invalidates every issued JWT — all active sessions must re-authenticate. |
| `SECRET_KEY` (auto-generated) | Never rotate casually | Critical | Rotating Django's signing key invalidates signed cookies/sessions. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `cpu_always_allocated` | `true` | High | Setting `false` starves the co-located Celery worker between requests — order/webhook/email processing degrades or stalls. |
| `container_resources` | `{ cpu_limit="2000m", memory_limit="3Gi" }` | High | Smaller sizes OOMKill under the combined uvicorn + Celery workload — confirmed live. |
| `enable_redis` | `true` before relying on async task throughput at scale | Medium | Without Redis, cache and Celery broker fall back to no-op/in-memory behavior tied to a single instance. |
| `redis_host` | Set explicitly when `enable_redis = true` | High | Cloud Run has no automatic Redis-host fallback; a blank host breaks `CACHE_URL`/`CELERY_BROKER_URL` composition. |
| `min_instance_count` | `1` for production | Medium | Scale-to-zero (`0`) adds cold-start delay to the first request after idle, plus a brief window before the Celery worker resumes. |
| `SALEOR_SUPERUSER_EMAIL` / `DJANGO_SUPERUSER_PASSWORD` | Retrieve from Secret Manager promptly | High | The bootstrap admin account is the only way in on first deploy; losing track of the generated password requires a manual Django shell reset. |
| `enable_iap` | only when the Dashboard/API don't need public access | High | IAP blocks unauthenticated requests to both the API and Dashboard services. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Saleor-specific application configuration
shared with the GKE variant is described in
**[Saleor_Common](Saleor_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Saleor on Cloud Run](../labs/Saleor_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Saleor on GKE Autopilot](Saleor_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Saleor Common — Shared Application Configuration](Saleor_Common.md) — the configuration shared by both deployment targets.
