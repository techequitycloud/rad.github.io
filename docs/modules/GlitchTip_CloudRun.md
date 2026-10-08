---
title: "GlitchTip on Google Cloud Run"
description: "Configuration reference for deploying GlitchTip on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# GlitchTip on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/GlitchTip_CloudRun.png" alt="GlitchTip on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

GlitchTip is an open-source, Sentry-compatible error-tracking and performance-monitoring
platform (Django/Python). Your applications send exceptions and traces to GlitchTip's
Sentry-protocol ingest endpoint, and GlitchTip stores, deduplicates, and alerts on them.
This module deploys GlitchTip on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services GlitchTip uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling and
concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What GlitchTip costs on RAD, and how that compares

**Running GlitchTip in your own Google Cloud project costs about US$180.87/month in Google Cloud charges, on top of a one-time 300-credit RAD module fee** (270 credits — 10% lower — in a RAD-managed project). GlitchTip is an open-source, Sentry-compatible error tracking and application performance monitoring platform. If you deploy into a RAD-managed project, you can pause the whole thing for free and pick it back up later — see "Pause it for free" below.

*GlitchTip is also available on GKE — see the [GKE guide](GlitchTip_GKE.md) if you need Kubernetes-based orchestration; this guide covers the lower-cost Cloud Run option.*

### What you pay on RAD

| | Own project | RAD-managed project |
|---|---|---|
| Module fee | **300 credits** (one-time) | **270 credits** (one-time, 10% lower) |
| Build time | ~3–6 credits (one-time, per build) | ~3–6 credits (one-time, per build) |
| Google Cloud running cost | ~US$180.87/month, billed to your own Google billing account at list price | ~83 credits/day (~US$8.30/day), metered hourly at list price plus RAD's margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (alwaysOn) | US$110.42 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **US$180.87** |

### How it compares

- **hosted GlitchTip**'s cheapest paid plan, Small, is US$15/month (up to 100k events/month) — verified at [https://glitchtip.com/pricing](https://glitchtip.com/pricing). That undercuts RAD's ~US$180.87/month Google Cloud bill for the Cloud Run variant on sticker price alone, but it caps usage; RAD's instance is uncapped, self-hosted, and the data never leaves your own project.
- The honest trade here is cap vs. control, not price: a managed SaaS plan is cheaper at this scale, and RAD's running cost is what real Cloud SQL, compute and networking actually cost at Google's list price with nothing hidden in a bundled seat price.
- RAD is not claiming to be cheaper than a bare VPS in cash terms — it usually is not. The case for RAD is what's managed for you.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If GlitchTip is running in a **RAD-managed project**, you can stop paying for it entirely without destroying
it. Deleting that project first unlinks its billing, then asks Google to delete the project outright —
Google's own 30-day recoverable soft delete. Unlike deleting the GlitchTip module on its own, this does not
tear down Cloud SQL, any VM or the compute resource one by one: the whole project simply stops, and nothing is
charged while it waits, because billing is already unlinked.

Restoring, within 30 days and only by the project's owner, asks Google to undelete the project and reattaches
its billing account, then asks you to run Update on each deployment to confirm everything came back. Because
nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a
rebuild, and an Update never charges the module fee again. This costs only a handful of build-time credits in
total — roughly 5–10 credits, under US$1, for a typical 2–3-deployment chain. The 270-credit module
fee is not charged again.

What this needs: you must own the project (not one RAD only manages billing for), you must restore it yourself
within 30 days — after that Google deletes it for good — and restoring is admitted like creating a new
project, so your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier
most study/demo use fits). Google says most services are fully working again within 36 hours of a restore.

One real gap: nightly backups are written to a bucket inside the project, and that bucket has Cloud Storage's
soft-delete explicitly turned off, so it is very likely gone as soon as you delete the project — even though
the project itself is recoverable for 30 days. If you have customised GlitchTip and want to keep that work,
copy a backup out (to Google Drive, or a bucket outside the project) before deleting. For a default install
with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

If GlitchTip is in your own project (or more than 30 days have passed on a RAD-managed one), the way to stop
paying is to delete the deployment and redeploy later when you need it again.

A redeploy costs the module fee again, plus the builds: roughly **300 + ~3–6 credits** (~US$30.45)
in your own project, or **270 + ~3–6 credits** on a RAD-managed one.

Deleting only saves money once GlitchTip would otherwise sit unused long enough to clear that redeploy cost
against its own running cost: roughly **about 6 days or more** idle in your own project (against its
~US$180.87/month Google Cloud bill), or **about 4 days or more** idle in a RAD-managed project
(against its ~83 credits/day).

Most of GlitchTip's running cost is the database and the shared file/cache VM. They stop only when nothing else in the project uses them, so deleting this app while something else shares the project saves only this app's own compute share of the total above.

Keep data first: nightly backups go to a bucket inside the deployment and are deleted with it, so copy the
latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training:** a trainer runs a session for a class. Each participant gets the app in their
  own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either the trainer
  funds every place, or each participant pays for their own. Everything is deleted when the session ends and
  unused credits go back to the trainer.
- **Managed Environments, for consultancies:** a partner runs the app for a client from a ring-fenced wallet it
  funds, and settles with the client directly. If the wallet runs low, billing pauses and the data is kept, so
  nobody receives an unexpected charge. At the end the partner hands the project over and the deployments
  become the client's own.
- Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card, bank
  transfer or mobile money.

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; radmodules.dev/pricing for RAD's own fees and daily-credit estimates; [Google's project delete/restore docs](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics; [hosted GlitchTip pricing](https://glitchtip.com/pricing) for the hosted GlitchTip figures.

## 1. Overview

GlitchTip runs as a Python container on Cloud Run v2, served by **Granian** on port
8080. The `all_in_one` server role runs the web server, the Celery worker, and Celery
beat inside the one container. The deployment wires together a focused set of Google
Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Django/Granian service, 2 vCPU / 4 GiB by default; `min_instance_count = 1` keeps the worker/beat alive |
| Database | Cloud SQL for PostgreSQL 15 | Required — GlitchTip does not support MySQL or other engines |
| Task queue & cache | Cloud SQL (PostgreSQL) | `VALKEY_URL = ""` routes the Celery queue, cache, and sessions through Postgres; Redis is optional |
| Object / file storage | Cloud Storage + NFS | A `storage` data bucket; NFS mounted at `/opt/glitchtip/storage` for uploaded attachments |
| Secrets | Secret Manager | Auto-generated Django `SECRET_KEY` and the initial superuser password; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared application
  layer; selecting any other engine breaks startup.
- **The image is a thin custom build.** GlitchTip is built `FROM glitchtip/glitchtip:6.2.0`
  with a cloud entrypoint that composes `DATABASE_URL` from the injected `DB_*` vars
  (the DB password is a runtime secret, uninterpolatable at plan time) and disables
  Valkey/Redis before handing off to the image's own `./bin/start.sh`.
- **No Redis by default.** `VALKEY_URL = ""` means the Celery queue, cache, and sessions
  all use PostgreSQL. This is correct for a single always-on instance; enable Redis only
  when you need to scale the worker fleet.
- **`min_instance_count = 1` and `cpu_always_allocated = true`.** Because the Celery
  worker and beat run in-process (`SERVER_ROLE = all_in_one`), scaling to zero or
  throttling CPU between requests would stop background event processing and scheduled
  cleanup.
- **`SECRET_KEY` and the superuser password are generated automatically** and stored in
  Secret Manager. `SECRET_KEY` is injected into the container; the superuser password is
  consumed only by the `glitchtip-migrate` job.
- **The initial owner is seeded, not self-registered.** `glitchtip-migrate` creates the
  superuser `admin@techequity.cloud`; `ENABLE_OPEN_USER_REGISTRATION` defaults to
  `false`.
- **Public ingress is the default** (`ingress_settings = "all"`) so application SDKs and
  browsers can reach the ingest endpoint and the dashboard. Enabling IAP blocks
  unauthenticated event ingestion.
- **Event retention is 90 days** (`GLITCHTIP_MAX_EVENT_LIFE_DAYS = 90`); stored events
  older than that are purged by the background worker.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the GlitchTip service

GlitchTip runs as a Cloud Run v2 service. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts. Because the worker/beat are
in-process, the service is kept warm (`min_instance_count = 1`, `cpu_always_allocated = true`).

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and
traffic splitting.

### B. Cloud SQL for PostgreSQL 15

GlitchTip stores all application data (projects, issues, events, users, and the Celery
queue) in a managed Cloud SQL for PostgreSQL 15 instance. The service connects privately
through the **Cloud SQL Auth Proxy** over a Unix socket; no public IP is exposed. On
first deploy the `db-init` and `glitchtip-migrate` Jobs create the database and user,
run migrations, and create the superuser.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs).
See [App_CloudRun](App_CloudRun.md) for the connection model, backups, and password
rotation.

### C. Cloud Storage & NFS

A dedicated **Cloud Storage** data bucket (`storage` suffix) is provisioned automatically.
GlitchTip's uploaded attachments and source maps are stored on **NFS** mounted at
`/opt/glitchtip/storage` by default (`enable_nfs = true`).

- **Console:** Cloud Storage → Buckets; Filestore/Compute Engine for the NFS server.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse, NFS, and CMEK options.

### D. Redis / Valkey (optional)

Redis is **disabled by default** (`VALKEY_URL = ""` → PostgreSQL-backed queue and cache).
Setting `enable_redis = true` and supplying `redis_host` points GlitchTip's Celery
broker and cache at Redis/Valkey — useful only when you separate the worker fleet from
the web tier at higher volumes.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the queue backend in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager

Two secrets are generated automatically: the Django `SECRET_KEY` (session signing) and
the initial superuser password (consumed by the migrate job). The database password is
managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default, which allows the public access
required for SDK event ingestion. An external HTTPS load balancer with a custom domain,
Cloud CDN, and Cloud Armor can be layered on; ingress settings and VPC egress control
connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. GlitchTip Application Behaviour

- **First-deploy database setup.** The `db-init` Job (`postgres:15-alpine`) connects
  through the Cloud SQL Auth Proxy and idempotently creates the application database and
  user, grants privileges, and re-owns the `public` schema. It is safe to re-run.
- **Migrations + superuser bootstrap.** The `glitchtip-migrate` Job runs on the built
  GlitchTip image (`depends_on = ["db-init"]`). It composes `DATABASE_URL`, runs
  `./manage.py migrate --noinput`, then `createsuperuser --noinput` using
  `SUPERUSER_EMAIL` (`admin@techequity.cloud`) and the Secret Manager superuser password.
  A duplicate account is skipped, so re-runs are safe. The initial admin password is in
  Secret Manager (`secret-<prefix>-<app>-superuser-password`).
- **`all_in_one` server role.** `SERVER_ROLE = all_in_one` runs the web server, Celery
  worker, and beat in one container. Keep `min_instance_count >= 1` and
  `cpu_always_allocated = true` — scaling to zero stops background ingestion and the
  daily event-retention purge.
- **`SECRET_KEY` should not be rotated casually.** It signs sessions/cookies; rotating it
  logs everyone out.
- **Event ingestion needs public ingress.** Application SDKs POST events to the ingest
  endpoint (`/api/<project>/store/` and the envelope endpoint). Keep
  `ingress_settings = "all"`; enabling IAP blocks SDK ingestion (put IAP only in front of
  the dashboard if you separate concerns).
- **Health path.** Startup and liveness probes target `/` by default. Allow up to
  several minutes on first boot (the startup probe provides a 60-second initial delay
  plus a wide, 30-attempt failure window at a 15 s period) while migrations run.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for GlitchTip are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment (use `cr` to run alongside the GKE variant). |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `glitchtip` | Base name for resources. Do not change after first deploy. |
| `display_name` | `GlitchTip Error Tracking` | Human-readable name shown in the platform UI. |
| `description` | `GlitchTip - Open-source Sentry-compatible error tracking platform` | Brief description of the application's purpose. |
| `application_version` | `6.2.0` | GlitchTip image tag; drives the `FROM glitchtip/glitchtip:<tag>` build. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | GlitchTip is a thin custom build; keep `custom`. |
| `cpu_limit` | `2000m` | CPU per instance. |
| `memory_limit` | `4Gi` | Memory per instance. |
| `cpu_always_allocated` | `true` | Required — the in-process Celery worker/beat must run between requests. |
| `min_instance_count` | `1` | Keep ≥ 1 so the worker/beat stay alive. |
| `max_instance_count` | `5` | Autoscaling upper bound. |
| `container_port` | `8080` | GlitchTip is served by Granian on port 8080. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy socket. |
| `enable_image_mirroring` | `true` | Mirror the base image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Required for public SDK event ingestion. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via the VPC. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks unauthenticated event ingestion.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not set `SECRET_KEY`, `DATABASE_URL`, or `VALKEY_URL` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation. |
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
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning.

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | (data bucket) | A `storage` data bucket is declared by `GlitchTip_Common`. |
| `enable_nfs` | `true` | NFS attachment storage mounted at `nfs_mount_path`. |
| `nfs_mount_path` | `/opt/glitchtip/storage` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — GlitchTip requires PostgreSQL 15. |
| `db_name` | `glitchtip` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `glitchtip` | Application database user. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` + `glitchtip-migrate` jobs. |
| `cron_jobs` | `[]` | Optional Cloud Scheduler + Cloud Run Jobs. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 60s delay, 30 × 15s failure window | Startup probe. Allow several minutes on first boot. |
| `liveness_probe` | HTTP `/` 60s delay | Liveness probe. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, same timings | Alternative structured probes. |
| `uptime_check_config` | disabled (`enabled=false`, path `/`) | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Use Redis/Valkey for the queue and cache instead of PostgreSQL. |
| `redis_host` | `""` | Redis endpoint. Must be set explicitly on Cloud Run. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running
resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (`db-init`, `glitchtip-migrate`). |
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
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all stored events and projects. |
| `SECRET_KEY` (auto-generated) | Never rotate casually | High | Rotating it invalidates all sessions, logging every user out. |
| `min_instance_count` | `1` | High | Scaling to zero stops the in-process Celery worker/beat — event ingestion queues stall and the retention purge never runs. |
| `cpu_always_allocated` | `true` | High | Request-based billing throttles CPU to ~0 between requests, starving the worker/beat. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup file fails the import job. |
| `ingress_settings` | `all` | High | Setting to `internal` blocks external SDK event ingestion. |
| `enable_iap` | only for a dashboard-only deployment | High | IAP blocks all unauthenticated requests, including SDK event POSTs. |
| `ENABLE_OPEN_USER_REGISTRATION` (fixed `false`) | n/a | High | Not exposed as a variable on this variant — `GlitchTip_Common` always sets it `false`, so signup stays admin-invite-only. |
| `database_type` | `POSTGRES_15` | High | GlitchTip requires PostgreSQL; any other engine breaks startup (fixed by `GlitchTip_Common`). |
| `memory_limit` | `4Gi` | Medium | Below ~1 GiB the Django + worker + beat processes risk OOM under event bursts. |
| `container_port` | module default | Medium | GlitchTip serves on `8080`; overriding the port without matching Granian's bind breaks health probes. |
| `GLITCHTIP_MAX_EVENT_LIFE_DAYS` (fixed `90`) | n/a | Low | Not exposed as a variable on this variant; too high would grow the database unbounded, too low would discard events you may still need. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**.
GlitchTip-specific application configuration shared with the GKE variant is described in
**[GlitchTip_Common](GlitchTip_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: GlitchTip on Cloud Run](../labs/GlitchTip_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [GlitchTip on GKE Autopilot](GlitchTip_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [GlitchTip Common — Shared Application Configuration](GlitchTip_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Gitea on Google Cloud Run](Gitea_CloudRun.md), [Woodpecker CI on GKE Autopilot](Woodpecker_GKE.md), [Hoppscotch on Google Cloud Run](Hoppscotch_CloudRun.md) in the **Source Control & CI/CD** solution.
