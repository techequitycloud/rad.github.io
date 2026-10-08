---
title: "FreeScout on Google Cloud Run"
description: "Configuration reference for deploying FreeScout on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# FreeScout on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/FreeScout_CloudRun.png" alt="FreeScout on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

FreeScout is a free, self-hosted **help desk and shared-mailbox** platform built on
Laravel (PHP) — it turns shared email inboxes into a collaborative ticket queue with
conversations, tags, saved replies, a customer profile, a REST API, and a plugin
system. This module deploys FreeScout on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services FreeScout uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What FreeScout costs on RAD, and how that compares

**Running FreeScout in your own Google Cloud project costs about US$83.61/month in Google Cloud charges, on top of a one-time 110-credit RAD module fee** (99 credits — 10% lower — in a RAD-managed project). FreeScout is a free, open-source shared-inbox and help desk built on Laravel. If you deploy into a RAD-managed project, you can pause the whole thing for free and pick it back up later — see "Pause it for free" below.

*FreeScout is also available on GKE — see the [GKE guide](FreeScout_GKE.md) if you need Kubernetes-based orchestration; this guide covers the lower-cost Cloud Run option.*

### What you pay on RAD

| | Own project | RAD-managed project |
|---|---|---|
| Module fee | **110 credits** (one-time) | **99 credits** (one-time, 10% lower) |
| Build time | ~3–6 credits (one-time, per build) | ~3–6 credits (one-time, per build) |
| Google Cloud running cost | ~US$83.61/month, billed to your own Google billing account at list price | ~32 credits/day (~US$3.20/day), metered hourly at list price plus RAD's margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | US$13.16 |
| Cloud SQL for MySQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **US$83.61** |

### How it compares

- There is no officially hosted/cloud version of FreeScout to compare against, so the honest comparison is against self-managed infrastructure, not a competing SaaS.
- A bare VPS sized to roughly 1 vCPU / 2 GiB — a Hetzner CPX22 (2 vCPU/4GB, ~US$24/mo), a DigitalOcean 2 vCPU/4GB Droplet (US$24/mo), or GCP's own Compute Engine e2-standard-2 (2 vCPU/8GB, ~US$49/mo) — usually undercuts RAD's sticker price; a VPS a size or two smaller would undercut it further.
- What that lower price does not include is the admin's own time: patching the OS, rotating database backups, renewing TLS certificates and watching for downtime. RAD's managed Cloud SQL, Secret Manager and monitoring do that for you, which is the actual trade being made, not the sticker price.
- RAD is not claiming to be cheaper than a bare VPS in cash terms — it usually is not. The case for RAD is what's managed for you.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If FreeScout is running in a **RAD-managed project**, you can stop paying for it entirely without destroying
it. Deleting that project first unlinks its billing, then asks Google to delete the project outright —
Google's own 30-day recoverable soft delete. Unlike deleting the FreeScout module on its own, this does not
tear down Cloud SQL, any VM or the compute resource one by one: the whole project simply stops, and nothing is
charged while it waits, because billing is already unlinked.

Restoring, within 30 days and only by the project's owner, asks Google to undelete the project and reattaches
its billing account, then asks you to run Update on each deployment to confirm everything came back. Because
nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a
rebuild, and an Update never charges the module fee again. This costs only a handful of build-time credits in
total — roughly 5–10 credits, under US$1, for a typical 2–3-deployment chain. The 99-credit module
fee is not charged again.

What this needs: you must own the project (not one RAD only manages billing for), you must restore it yourself
within 30 days — after that Google deletes it for good — and restoring is admitted like creating a new
project, so your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier
most study/demo use fits). Google says most services are fully working again within 36 hours of a restore.

One real gap: nightly backups are written to a bucket inside the project, and that bucket has Cloud Storage's
soft-delete explicitly turned off, so it is very likely gone as soon as you delete the project — even though
the project itself is recoverable for 30 days. If you have customised FreeScout and want to keep that work,
copy a backup out (to Google Drive, or a bucket outside the project) before deleting. For a default install
with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

If FreeScout is in your own project (or more than 30 days have passed on a RAD-managed one), the way to stop
paying is to delete the deployment and redeploy later when you need it again.

A redeploy costs the module fee again, plus the builds: roughly **110 + ~3–6 credits** (~US$11.45)
in your own project, or **99 + ~3–6 credits** on a RAD-managed one.

Deleting only saves money once FreeScout would otherwise sit unused long enough to clear that redeploy cost
against its own running cost: roughly **about 5 days or more** idle in your own project (against its
~US$83.61/month Google Cloud bill), or **about 4 days or more** idle in a RAD-managed project
(against its ~32 credits/day).

Most of FreeScout's running cost is the database and the shared file/cache VM. They stop only when nothing else in the project uses them, so deleting this app while something else shares the project saves only this app's own compute share of the total above.

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

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; radmodules.dev/pricing for RAD's own fees and daily-credit estimates; [Google's project delete/restore docs](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics.

## 1. Overview

FreeScout runs as a single PHP (nginx + php-fpm) container on Cloud Run v2, built as a
thin custom image `FROM tiredofit/freescout`. The deployment wires together a focused
set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | PHP container on port 80, 1 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for MySQL 8.0 | Required — FreeScout does not support PostgreSQL or other engines |
| Persistent files | Cloud Filestore (NFS) | Enabled by default; mounted at `/var/lib/freescout` for attachments and runtime data |
| Object storage | Cloud Storage | An uploads bucket (`gcs-freescout<tenant-prefix>-freescout-uploads`) provisioned automatically |
| Cache (optional) | Redis | Optional object cache; disabled by default |
| Secrets | Secret Manager | Auto-generated Laravel `APP_KEY` and first-run `ADMIN_PASS`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed by the shared application
  layer (`MYSQL_8_0`); selecting any other engine breaks startup.
- **The Laravel `APP_KEY` is generated automatically** and stored in Secret Manager.
  It encrypts session data and any encrypted database columns (stored mailbox
  credentials, OAuth tokens). **Never rotate it after first boot** — doing so
  permanently invalidates all previously encrypted data.
- **A first-run admin is seeded automatically.** `ADMIN_EMAIL` (default
  `admin@techequity.cloud`) with the generated `ADMIN_PASS` secret creates the first
  administrator on first boot. Change the password in the UI after first login.
- **`APP_URL` / `SITE_URL` are set to the service URL.** FreeScout builds absolute
  links and its `/` → dashboard/login flow from `APP_URL`; the container entrypoint
  resolves it from the actual `CLOUDRUN_SERVICE_URL` at runtime.
- **Cloud SQL is reached over TCP (private IP), not a socket.** `enable_cloudsql_volume`
  defaults to `false` on Cloud Run; the app connects to the injected `DB_IP` on port
  3306. MySQL over the private IP needs no client SSL.
- **NFS is enabled by default** so attachments and runtime files survive container
  recycling and scale-to-zero cold starts. Requires the `gen2` execution environment.
- **Scale-to-zero is enabled** (`min_instance_count = 0`, `max_instance_count = 1`).
  Cold starts add several seconds to the first request after idle; set
  `min_instance_count = 1` to keep the service always warm.
- **Health is signalled on `GET /`.** There is no dedicated JSON health endpoint;
  the startup probe is TCP and the liveness probe is `GET /`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the FreeScout service

FreeScout runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~freescout"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud SQL for MySQL 8.0

FreeScout stores all application data (conversations, mailboxes, users, customers,
settings) in a managed Cloud SQL for MySQL 8.0 instance. On Cloud Run the service
connects over the instance **private IP (TCP, port 3306)** — `enable_cloudsql_volume`
defaults to `false`. On first deploy the `db-init` Job creates the application
database, user, and grants; the app then runs its own schema migrations on start.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~freescout"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model,
backups, and password rotation.

### C. Cloud Filestore (NFS)

FreeScout attachments and runtime files are persisted on an NFS volume mounted at
`/var/lib/freescout` (enabled by default). This keeps uploads durable across revision
changes and scale-to-zero. NFS requires the `gen2` execution environment.

- **Console:** Filestore → Instances (a Services_GCP-managed or inline instance).
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Confirm the mount in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.volumes)'
  ```

See [App_CloudRun](App_CloudRun.md) for the shared-NFS discovery model.

### D. Cloud Storage

A dedicated **Cloud Storage** uploads bucket (`gcs-freescout<tenant-prefix>-freescout-uploads`) is provisioned
automatically. Additional buckets can be declared via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~freescout"
  gcloud storage ls gs://<bucket-name>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### E. Redis (optional object cache)

Redis is **disabled by default**. When `enable_redis = true`, `REDIS_HOST`/`REDIS_PORT`
are injected into the container as an object-cache backend. When `redis_host` is left
empty and `enable_nfs` is true, the NFS server VM's IP is used as the Redis endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### F. Secret Manager

Two secrets are generated automatically and stored in Secret Manager: the Laravel
`APP_KEY` (encrypts session data and encrypted DB columns) and `ADMIN_PASS` (the
seeded first-run admin password). The database password is managed separately by the
foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~freescout"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### G. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = "all"`),
which allows public access to the help-desk UI. An external HTTPS load balancer with a
custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and VPC
egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### H. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. FreeScout Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `mysql:8.0-debian`. It connects to Cloud SQL (socket if mounted, otherwise TCP via
  `DB_IP`), idempotently creates the application database and user, grants privileges,
  and verifies the app user can connect. The job runs on apply and is safe to re-run.
- **Migrations run on container start.** There is no separate migration job — the
  tiredofit image runs `php artisan migrate --force` on every container start, so
  upgrading `application_version` applies schema changes on the next boot.
- **First-run admin is seeded.** On first boot the image creates the admin defined by
  `ADMIN_EMAIL` / `ADMIN_FIRST_NAME` / `ADMIN_LAST_NAME` with the `ADMIN_PASS` secret.
  Log in and change the password immediately.
- **`APP_KEY` is immutable after first boot.** The Laravel key is generated once and
  written to Secret Manager. Changing it permanently invalidates all previously
  encrypted data (encrypted mailbox credentials, OAuth tokens, encrypted cookies).
  Only rotate in a planned maintenance window with a full re-configuration.
- **`APP_URL` must match the browser host.** FreeScout builds absolute links and its
  `/` routing from `APP_URL`; the entrypoint sets it from the injected
  `CLOUDRUN_SERVICE_URL`. If you front the service with a custom domain, set
  `APP_URL`/`SITE_URL` (via `environment_variables`) to that host so links and
  redirects resolve correctly. Inspect the running revision:
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Health path.** The startup probe is TCP on the container port (30 s delay, 20
  failures) and the liveness probe is HTTP `GET /` (300 s initial delay). Allow several
  minutes on first boot while migrations run before the service reports healthy.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for FreeScout are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `freescout` | Base name for resources. Do not change after first deploy. |
| `display_name` | `FreeScout` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Base-image tag for the thin build (`latest` pins to `php8.3-1.17.159`); set an explicit tag such as `1.8.170` in production. |
| `php_memory_limit` | `512M` | PHP memory limit; raise for heavy attachment processing. |
| `upload_max_filesize` / `post_max_size` | `64M` | Maximum attachment upload / POST size. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | FreeScout deploys as a thin custom build; leave as `custom`. |
| `cpu_limit` | `1000m` | CPU per instance; minimum 1 vCPU. |
| `memory_limit` | `2Gi` | Memory per instance; minimum 512 Mi (gen2 floor), 2 GiB recommended. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` to avoid cold starts. |
| `max_instance_count` | `1` | Keep at 1 unless shared NFS and session handling are confirmed multi-instance-safe. |
| `container_port` | `80` | FreeScout (nginx/php-fpm) listens on port 80. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `enable_cloudsql_volume` | `false` | Cloud Run connects to MySQL over TCP (private IP); leave `false`. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public access to the help-desk UI. |
| `enable_iap` | `false` | Require Google sign-in in front of FreeScout (Cloud Run native IAP). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings (e.g. `MAIL_*`, or a custom `APP_URL` for a custom domain). Core DB and admin values are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. `APP_KEY` and `ADMIN_PASS` are wired automatically — do not set them here. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS is **on** by default — persists attachments/runtime files. |
| `nfs_mount_path` | `/var/lib/freescout` | Mount path inside the container. |
| `create_cloud_storage` | `true` | Create the declared GCS buckets. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional GCS buckets beyond the auto-provisioned uploads bucket. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed MySQL 8.0; do not change engine. |
| `db_name` | `freescout` | MySQL database name (injected as `DB_DATABASE`). Immutable after first deploy. |
| `db_user` | `freescout` | Application DB user (injected as `DB_USERNAME`). Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP `/` 30 s delay, 20 failures | Generous window for first-boot migrations. |
| `liveness_probe` | HTTP `GET /` 300 s delay | `GET /` returns 200 once booted; no dedicated health endpoint. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable a Redis object cache. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |

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
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match the app, an out-of-range `container_port`/`backup_retention_days`, IAP with no authorized identities. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `APP_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it permanently invalidates all previously encrypted data — encrypted mailbox credentials and OAuth tokens can no longer be decrypted. |
| `database_type` | `MYSQL_8_0` | Critical | FreeScout is MySQL-only; a Postgres/other engine breaks startup. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `APP_URL` / `SITE_URL` | Actual service/domain URL | High | A wrong host breaks absolute links, the `/` routing, and password-reset / email links. |
| `enable_nfs` | `true` | High | Disabling loses all attachments and runtime files on container recycle / scale-to-zero. |
| `enable_cloudsql_volume` | `false` (Cloud Run) | High | Forcing the socket without a real socket file leaves the app with no TCP host — connection fails. |
| `memory_limit` | `2Gi` (≥512Mi) | High | Below the gen2 512 Mi floor is rejected at plan time; too low OOM-kills under load. |
| `max_instance_count` | `1` | High | Scaling beyond 1 without confirmed shared-storage/session handling can cause inconsistent state across instances. |
| `enable_iap` | only for private deployments | High | IAP blocks all unauthenticated requests, including inbound email-webhook style integrations. |
| `ADMIN_PASS` (auto-generated) | Change in UI after first login | Medium | The generated password is in Secret Manager; rotate it in-app for a human-owned credential. |
| `min_instance_count` | `1` for production | Medium | Scale-to-zero (`0`) adds cold-start delay on the first request after idle. |
| `application_version` | Pin in production | Medium | `latest` can move the base image under you between deploys. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. FreeScout-specific application configuration
shared with the GKE variant is described in **[FreeScout_Common](FreeScout_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: FreeScout on Cloud Run](../labs/FreeScout_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [FreeScout on GKE Autopilot](FreeScout_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [FreeScout Common — Shared Application Configuration](FreeScout_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Chatwoot on Google Cloud Run](Chatwoot_CloudRun.md), [BookStack on Google Cloud Run](BookStack_CloudRun.md), [Fider on Google Cloud Run](Fider_CloudRun.md), [Gotify on Google Cloud Run](Gotify_CloudRun.md) in the **Customer Support Desk** solution.
