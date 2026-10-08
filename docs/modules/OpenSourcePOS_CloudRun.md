---
title: "OpenSourcePOS on Google Cloud Run"
description: "Configuration reference for deploying Open Source POS on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# OpenSourcePOS on Google Cloud Run

Open Source Point of Sale (OSPOS) is a free, open-source, web-based retail point
of sale: ring up sales, manage items, customers and suppliers, print receipts,
and run sales and inventory reports from a browser. This module deploys
OpenSourcePOS on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services OpenSourcePOS uses and how to explore
and operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## What OpenSourcePOS costs on RAD, and how that compares

**For a single store, OpenSourcePOS on RAD's Cloud Run module costs about US$70 a month with no per-user licence.** A self-managed server is cheaper in cash, but then you run the database, backups, security patches and upgrades yourself. Figures are as at 8 October 2026; sources are listed at the end of this section.

If you only need it occasionally — studying for a certification, a demo, a seasonal business — a RAD-managed project can be deleted and restored within 30 days for a few credits, so that US$70 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 75 credits (US$7.50 at the top-up price) | 67.5 credits (10% lower) |
| Build time | About 19 credits per build (RAD's average build takes about 19 minutes) | The same |
| Google Cloud running cost | Billed by Google to your own billing account (table below) | Metered hourly in credits; RAD publishes **26 credits a day**, about 780 credits a month (about US$78 at the top-up price, US$62 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | US$13.16 |
| Cloud SQL for MySQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$70** |

- Cloud SQL and Cloud Run cost the same in africa-south1 (Johannesburg).
- **Scale-to-zero is the default.** The Cloud Run line above already reflects that cost; setting `min_instance_count = 1` keeps an instance warm and raises this line, in exchange for no cold starts.

### How it compares

- No open-source point-of-sale vendor sells an official hosted version of this exact project with public pricing, so this compares against a bare server.
- OpenSourcePOS only needs 1 vCPU / 2 GiB — smaller than the comparison class below, so a cheaper VPS tier would likely do. The smallest independently verified figures are: Hetzner CPX22 or a DigitalOcean 2 vCPU/4 GB Droplet, both about US$24/month, or a GCP Compute Engine e2-standard-2 at about US$49/month.
- A single till or seasonal stall is exactly the case where **Pause it for free**, below, matters most: a shop that only trades some months of the year does not need to pay for a database sitting idle the rest of the time.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If OpenSourcePOS runs in **a project RAD manages for you**, you have a second option that
goes well beyond scaling to zero: **delete the whole project, and restore it within 30
days for close to nothing.** This suits occasional use — studying for a certification,
a demo environment, a seasonal business — far better than running OpenSourcePOS
continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks
  Google to delete the project. Google does not remove the project immediately: it keeps
  it, recoverable, for 30 days. Because billing is already unlinked, nothing is charged
  while it waits. Unlike deleting one module, this does not tear down Cloud SQL or Cloud Run
  one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's
  owner can restore it. RAD asks Google to undelete the project and reattaches its
  billing account, then asks you to run **Update** on each deployment to confirm
  everything came back. Because nothing was individually destroyed, that Update finds
  the same resources already there — it is a check, not a rebuild, and an Update never
  charges the module fee again. That costs a handful of credits (under US$1) for a
  typical 2–3-deployment chain, against the 80 credits
  (US$8) a full redeploy costs below.
- **So a month of occasional use can cost a few dollars, not US$70.**
  Deploy OpenSourcePOS, use it for a while, delete the project. Restore it next time you
  want it, confirm with Update, and delete it again when you're done. You pay only for
  the module fee once, the builds, and whatever time OpenSourcePOS was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only
  manages billing for), and you restore it yourself within the 30 days — after that,
  Google deletes it for good. Restoring is admitted like creating a new project: your
  purchased credit balance must still clear the tier's floor (100 credits for the
  sandbox tier most study and demo use fits). Google says most services are fully
  working again within 36 hours of a restore.
- **One real gap: the backup bucket does not survive.** OpenSourcePOS's backups are written
  to a bucket inside the project, and that bucket is **not** protected by Cloud Storage's
  soft-delete, so it is very likely gone as soon as you delete the project — even though
  the project itself is recoverable for 30 days. If you have made changes to OpenSourcePOS
  you want to keep, copy a backup out (to Google Drive, or a bucket outside the project)
  before you delete, the same as the redeploy workflow below. For a default installation
  with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

Cloud Run already scales to zero between requests. The option above only applies to a RAD-managed project; **in your own project, or once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 80
  credits (US$8), because RAD recreates the project and shared
  services before OpenSourcePOS. Deleting saves money only once OpenSourcePOS would otherwise
  sit unused for about 4 days or more, both in your own project (about
  US$2.34 a day) and in a RAD-managed one (26 credits a day).
- **Most of the running cost is usually the database.**
  It stops only when nothing else in the project uses
  it, so deleting OpenSourcePOS while something else shares the
  project saves only OpenSourcePOS's own compute part.
- **Keep data first.** Backups are written to a bucket inside the deployment and are
  deleted with it, so copy the latest backup out before deleting if you want to keep it.
- **RAD does not recreate a deleted deployment for you**; you enter the settings again
  when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant
  gets the app in their own Google Cloud project for 15 minutes to 24 hours, within an
  allowance the trainer sets. Either the trainer funds every place, or each participant
  pays for their own. Everything is deleted when the session ends and unused credits go
  back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs
  low, billing pauses and the data is kept, so nobody receives an unexpected charge. At
  the end the partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and
ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; [radmodules.dev/pricing](https://radmodules.dev/pricing) for RAD's own fees and daily-credit estimates; [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore window and what it says about Cloud Storage objects without soft delete.

---

## 1. Overview

OpenSourcePOS runs as a PHP / CodeIgniter 4 container (a single Apache process
on port 80) on Cloud Run v2. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Apache + PHP service, 1 vCPU / 2 GiB by default; scale-to-zero by default |
| Database | Cloud SQL for MySQL 8.0 | Required — `OpenSourcePOS_Common` fixes the engine. Holds all POS data **and** user sessions |
| Object storage | Cloud Storage | A `storage` bucket, GCS-Fuse-mounted at `/app/public/uploads` for item pictures and the company logo; plus a generic `data` bucket the app does not use |
| Secrets | Secret Manager | Database password only — OpenSourcePOS has no application signing secret |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The engine is fixed by `OpenSourcePOS_Common`.
- **`enable_cloudsql_volume = false`.** OpenSourcePOS reads a plain TCP host
  (`MYSQL_HOST_NAME`), so the service connects to the instance's **private IP**
  directly. There is no port override in OpenSourcePOS — the port is always
  3306.
- **Scale-to-zero is the shipped default** (`min_instance_count = 0`,
  `max_instance_count = 1`). For a till in daily use, set
  `min_instance_count = 1`: a cashier will not wait through a cold start.
- **Multiple instances are safe.** Sessions live in MySQL (`DatabaseHandler`,
  table `ospos_sessions`) and uploads live on the shared GCS bucket, so raising
  `max_instance_count` does not log cashiers out or lose pictures.
- **Uploads persist on GCS.** `enable_gcs_storage_volume = true` mounts the
  `storage` bucket at `/app/public/uploads`. The upstream image declares no
  volume there, so without the mount uploaded images would be lost on every
  cold start.
- **NFS is off and not needed** (`enable_nfs = false`).
- **The version is pinned** (`application_version = "3.4.1"`). Never use
  `latest`.
- **The uptime check is disabled** by default (`uptime_check_config.enabled = false`).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the OpenSourcePOS service

OpenSourcePOS runs as a Cloud Run v2 service that autoscales by request load
between the minimum and maximum instance counts. Each deployment creates an
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

### B. Cloud SQL for MySQL 8.0

OpenSourcePOS stores everything — sales, items, customers, suppliers, receivings,
configuration and sessions — in a managed Cloud SQL for MySQL 8.0 instance. The
service connects over the instance's **private IP via TCP**. On first deploy a
`db-init` job creates the application database and user, followed by
`schema-load`, which loads the schema that ships inside the OpenSourcePOS image.

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

Two application buckets are provisioned:

- **`storage`** — added by `OpenSourcePOS_Common` and mounted through GCS Fuse at
  `/app/public/uploads`, where OpenSourcePOS writes item pictures and the company
  logo (only while `enable_gcs_storage_volume = true`).
- **`data`** — the Foundation's generic default from `storage_buckets`; not read
  or written by OpenSourcePOS.

The Foundation also creates a backups bucket for the scheduled backup job.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket-name>/
  ```

### D. Secret Manager

OpenSourcePOS has no application-level secret: `OpenSourcePOS_Common` returns no
secrets of its own. The only credential is the database password, which the
Foundation generates and stores in Secret Manager (its name is the
`database_password_secret` output).

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<database-password-secret> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to
Cloud Monitoring. The uptime check is off by default and alert policies are
empty until configured.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. OpenSourcePOS Application Behaviour

- **Two-stage init chain.** `db-init` (`mysql:8.0-debian`, `max_retries = 3`)
  creates the application user and database and grants privileges, then
  verifies the app user can connect. `schema-load` depends on `db-init` and runs
  on the **app image** (`image = null`), because the schema file ships only
  inside `jekkos/opensourcepos` at `/app/app/Database/database.sql`. It counts
  the tables in the database first: if any exist it exits without changes, and
  after loading it fails if the database still has no tables. Both jobs run on
  apply and are safe to re-run.
- **Why a job, not the entrypoint.** Cloud Run can cold-start several instances
  at once; two of them racing the same `CREATE TABLE` set would produce a
  half-loaded schema with no error. A job runs once, before the service serves.
- **Startup log line.** On every start the wrapper prints
  `[startup] OpenSourcePOS pointed at <ip>:3306/<db> as <user>`. If any of
  `DB_IP`, `DB_USER`, `DB_PASSWORD` or `DB_NAME` is empty it instead prints a
  `FATAL:` message and exits — OpenSourcePOS would otherwise silently fall back
  to the credentials baked into the image's `.env` and run against the wrong
  database.
- **Image patches.** The wrapper image writes a real `date.timezone` (`UTC`) into
  PHP's `timezone.ini` (upstream ships it empty), sets `CI_ENVIRONMENT =
  production` (upstream's `development` renders stack traces and the debug
  toolbar to the browser), and adds an `X-Forwarded-Proto` guard to the
  `www`-stripping rewrite in `public/.htaccess`, which would otherwise 301
  `https://www.<domain>` to `http://` on a custom domain.
- **Health checks.** Startup and liveness probes both `GET /`, the document root
  where OpenSourcePOS serves its login page — the same path the upstream image's
  own `HEALTHCHECK` uses.
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
  ```
- **Administrator account.** The administrator is created by the bundled schema
  with the username `admin`; the module does not create or change it, and the
  `admin_email` input is not applied. Change the administrator password after
  first login.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for OpenSourcePOS are listed; every other input
is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `tenant_id` | `demo` | Short suffix (1–7 lowercase alphanumerics) that makes resource names unique per environment. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `ospos` | Base name for resources. Do not change after first deploy. |
| `display_name` | `OpenSourcePOS` | Human-readable name shown in the Console. |
| `application_version` | `3.4.1` | `jekkos/opensourcepos` tag, passed to the build as `OSPOS_VERSION`. This variant's default is the one that takes effect. Pin an exact release. |
| `php_memory_limit` | `512M` | Injected as the plain env var `memory_limit`. |
| `admin_email` | `admin@example.com` | Not applied — the administrator comes from the bundled schema. |
| `enable_gcs_storage_volume` | `true` | Mount the `storage` bucket at `/app/public/uploads` (the variable's own description names `/opt/ospos/var/data`; the mounted path is `/app/public/uploads`). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Builds the wrapper image via Cloud Build. `prebuilt` skips the wrapper — no `MYSQL_*` mapping, no image patches. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `2Gi` | Memory per instance. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; use `1` for a till in use. |
| `max_instance_count` | `1` | Autoscaling upper bound. Multi-instance is safe. |
| `container_port` | `80` | Apache listens on port 80. |
| `execution_environment` | `gen2` | Required for the GCS Fuse uploads mount. |
| `timeout_seconds` | `300` | Request timeout; raise for large imports or reports. |
| `enable_cloudsql_volume` | `false` | Private-IP TCP instead of the Auth Proxy socket. |
| `enable_image_mirroring` | `true` | Mirror the image into Artifact Registry. |
| `container_protocol` | `http1` | HTTP/1.1. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public ingress by default. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in before the POS login page. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not set the `MYSQL_*` connection variables here — the wrapper exports them from `DB_*` at start. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `protect_sensitive_environment_variables` | `true` | Credential-named keys in `environment_variables` are moved to Secret Manager. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Lifecycle age applied to the backups bucket. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts & NFS Instance

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. This
group also holds `nfs_instance_name` / `nfs_instance_base_name`, relevant only if
`enable_nfs` is turned on. See [App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR allowlist for administrative access. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the module's buckets. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Generic Foundation bucket; not used by OpenSourcePOS. |
| `enable_nfs` | `false` | Not needed — uploads persist on GCS. |
| `nfs_mount_path` | `/var/lib/ospos` | Only used if `enable_nfs = true`; nothing in the image writes there. |
| `gcs_volumes` | `[]` | Extra GCS Fuse mounts, merged with the `storage` uploads volume. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed by `OpenSourcePOS_Common`. |
| `db_name` / `db_user` | `ospos` | Tenant-prefixed at deploy time. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). Do not change on a running deployment. |
| `enable_auto_password_rotation` | `false` | Automated password rotation. |
| `db_host_env_var_name` | `DB_IP` | Keep as `DB_IP` — the wrapper entrypoint reads it. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` → `schema-load` chain. Supplying any job replaces both. |
| `cron_jobs` | `[]` | No scheduled tasks by default; OpenSourcePOS needs none. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /`, 30s delay, 15s period, 20 retries | Waits for Apache to serve the login page. |
| `liveness_probe` | HTTP `GET /`, 60s delay, 30s period, 3 retries | Document root. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Enable for production monitoring. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | OpenSourcePOS has no Redis integration; leave off. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Unused by OpenSourcePOS. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter. |
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
| `stage_services` | Cloud Deploy stage services (when enabled). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (sensitive) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (`db-init`, `schema-load`). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `application_version` | An exact release (default `3.4.1`) | **Critical** | `latest` resolves to an image with a different layout; the module's history records it failing to deploy. A floating tag also rebuilds under an unchanged string, so no new revision rolls out and the running container silently keeps the old image. |
| `container_image_source` | `custom` | **Critical** | `prebuilt` skips the wrapper: no `DB_*` → `MYSQL_*` mapping (OpenSourcePOS then falls back to the baked `localhost` credentials and cannot reach Cloud SQL), and none of the timezone / `CI_ENVIRONMENT` / TLS-rewrite patches. |
| `db_host_env_var_name` | `DB_IP` | **Critical** | The wrapper entrypoint reads `DB_IP`; it refuses to start if that is empty. |
| `db_name` / `db_user` | Set once | **Critical** | Immutable after first deploy; renaming recreates the DB/user and loses all sales data. |
| `database_password_length` | Leave at `32` after deploy | High | Changing it on a running deployment writes a new password secret while the database keeps the old one; connections fail until the `db-init` job is re-run. |
| `enable_gcs_storage_volume` | `true` | High | Without the mount, item pictures and the company logo are written to the container's ephemeral filesystem and lost on every cold start or new revision. |
| `initialization_jobs` | `[]` | High | Supplying any job replaces the whole default chain, including `schema-load`; the app then starts against an empty database. |
| `min_instance_count` | `1` for a till in use | Medium | Scale-to-zero (`0`) makes the first sale after idle wait for a cold start. |
| Administrator password (bundled schema, user `admin`) | Change after first login | High | The account is created by the upstream schema, not by this module, and is not randomised. |
| `enable_cloud_armor` / `enable_iap` | Enable for production | Medium | The POS login page is publicly reachable by default. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `enable_redis` / `enable_nfs` | `false` | Low / cost | OpenSourcePOS uses neither; enabling them provisions resources nothing reads. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. OpenSourcePOS-specific application
configuration is described in
**[OpenSourcePOS_Common](OpenSourcePOS_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: OpenSourcePOS on Cloud Run](../labs/OpenSourcePOS_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [OpenSourcePOS Common — Shared Application Configuration](OpenSourcePOS_Common.md) — the application-layer configuration this module builds on.
