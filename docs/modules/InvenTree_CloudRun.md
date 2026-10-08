---
title: "InvenTree on Google Cloud Run"
description: "Configuration reference for deploying InvenTree on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# InvenTree on Google Cloud Run

InvenTree is a free, open-source inventory management system: it tracks parts
and components, stock locations and movements, suppliers, bills of materials,
and purchase and sales orders, and is used by hardware teams, makerspaces and
small manufacturers. This module deploys InvenTree on **Cloud Run v2** on top of
the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services InvenTree uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## What InvenTree costs on RAD, and how that compares

**InvenTree on RAD's Cloud Run module costs about US$70 a month in your own project, plus a 75-credit (US$7.50) module fee once per deployment, with no per-seat licence.** If you only need it for a limited period — a stocktake project, a short production run — see "Pause it for free" below to stop paying without losing your inventory data. InvenTree ships only as a Cloud Run module on RAD; there is no GKE variant.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 75 credits (US$7.50) | 67.5 credits (10% lower) |
| Build time | A few credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$70.19 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **26 credits a day** |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, less on a plan. In a project RAD manages, the
database, file server and network are shared by every application in the project, so a second
application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | US$13.16 |
| Cloud SQL for MySQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| Cloud NAT and networking | US$5.00 |
| Cloud Storage (add-ons, backups) | US$1.00 |
| **Total** | **about US$70.19** |

### How it compares

- InvenTree has no official hosted SaaS plan of its own to compare against — it is distributed as a
  self-hosted application for hardware teams and makerspaces — so the honest comparison is a bare
  server, which is also how most small teams run it today.
- InvenTree's footprint (1 vCPU, 2 GiB, plus a MySQL database) is close to a Hetzner CPX22 or
  DigitalOcean 2 vCPU/4 GB droplet (about $24/month) or a GCP Compute Engine e2-standard-2 (about
  $49/month) — cheaper in cash, but then you run MySQL, backups, security patches and Django upgrades
  yourself.
- What RAD adds over a bare VPS: managed Cloud SQL with automated backups and point-in-time recovery,
  Secret Manager for the database password, and monitoring — useful for a bill-of-materials system a
  manufacturing team depends on, where a lost database is a lost parts catalogue.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If InvenTree runs in a project RAD manages for you and you expect to come back to it — a break
between courses, a seasonal lull, or simply not knowing yet whether you'll need it next
month — this is the better option, and it costs almost nothing.

Deleting a RAD-managed project unlinks its billing first, then asks Google to delete the
project outright: Google's own 30-day recoverable soft delete. Unlike deleting InvenTree as a
single module, this does not tear down the Cloud Run service, Cloud SQL database and networking one by one — the whole project
simply stops, and nothing is charged while it waits, because billing is already unlinked.

Restoring, within 30 days and only by the project's owner, asks Google to undelete the
project and reattaches its billing account, then asks you to run Update on each deployment
to confirm everything came back. Because nothing was individually destroyed, that Update
finds the same resources already there — it is a check, not a rebuild, and an Update never
charges the module fee again. This costs only a handful of credits (under US$1) in build time
for a typical chain of deployments.

What this needs: you must own the project (not one RAD only manages billing for), you must
restore it yourself within 30 days — after that Google deletes it for good — and restoring is
admitted like creating a new project, so your purchased credit balance must still clear the
tier's floor (100 credits for the sandbox tier most use fits). Google says most services are
fully working again within 36 hours of a restore.

One real gap: nightly backups are written to a bucket inside the project, and that bucket has
Cloud Storage's soft-delete explicitly turned off, so it is very likely gone as soon as you
delete the project, even though the project itself is recoverable for 30 days. InvenTree's own nightly export of the database is kept in that bucket; for a default install with nothing irreplaceable beyond what's in the database, this is the only copy worth keeping.

### Pay only while you use it, the other way: delete and redeploy

In your own project, or once the 30-day window above has passed, the fallback is to delete
InvenTree outright and redeploy it later.

- **What a redeploy costs:** the module fee again, plus the builds — roughly the module fee
  shown above plus 3–6 credits of build time.
- **When it's worth it:** deleting saves money only once InvenTree would otherwise sit unused
  for about 3 days or more in your own project (about 3 days or more in a RAD-managed one). The MySQL database is most of the running cost here, so deleting InvenTree alone saves the whole bill above unless something else in the project shares it.
- **Keep data first.** Nightly backups are written to a bucket inside the deployment, and
  that bucket is deleted with it — copy the latest backup out (to Google Drive, or a bucket
  you keep) before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance
  the trainer sets. Either the trainer funds every place, or each participant pays for their
  own. Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.
- Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
  by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD fees and the daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Google Cloud: delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanism. Prices change; check each source before relying on a figure.

---

## 1. Overview

InvenTree runs as a Python/Django application served by gunicorn on Cloud Run
v2. Each revision runs **two containers built from the same image**: the web
container and a django-q `qcluster` background-worker sidecar. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Web container (1 vCPU / 2 GiB) plus a `qcluster` sidecar (1 vCPU / 1 GiB); CPU always allocated; scale-to-zero by default |
| Database | Cloud SQL for MySQL 8.0 | Schema created by Django migrations in a dedicated `migrate` init job |
| Shared filesystem | NFS (Services_GCP NFS server) | Optional (`enable_nfs = false` by default) — needed to persist InvenTree's data directory |
| Object storage | Cloud Storage | A `data` bucket (Foundation default) and a `storage` bucket (from InvenTree_Common) are created; neither is mounted into the container |
| Secrets | Secret Manager | Database password only — the module generates no application secrets |
| Ingress | Cloud Run URL / Cloud Load Balancing | Project-number `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **Use the project-number URL.** InvenTree checks every request's host against
  `INVENTREE_SITE_URL`, which the Foundation injects from the predicted
  `https://<service>-<project-number>.<region>.run.app` URL. The hash-form
  `*.a.run.app` URL that Cloud Run also advertises returns **HTTP 500**
  (`INVE-E7`). The `service_url` output is the project-number form.
- **The data directory is ephemeral unless you enable NFS.** InvenTree keeps
  `config.yaml`, its generated `secret_key.txt`, uploaded media, collected static
  files and plugins under `/home/inventree/data`. With the default
  `enable_nfs = false`, that is the container's own filesystem and is lost on
  every cold start. Set `enable_nfs = true` and
  `nfs_mount_path = "/home/inventree/data"` for any deployment you intend to
  keep.
- **Migrations are a job, not a startup step.** `INVENTREE_AUTO_UPDATE` is
  `"false"`; the `migrate` init job owns the schema.
- **The background worker needs CPU outside requests.**
  `cpu_always_allocated = true` (instance-based billing) so the `qcluster`
  sidecar keeps polling between requests.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`,
  `max_instance_count = 1`). While no instance exists, the worker does not run
  either; set `min_instance_count = 1` if scheduled work matters.
- **No administrator account is provisioned.** The module creates no admin
  user and no admin secret (see §3).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the InvenTree service

InvenTree runs as a Cloud Run v2 service with two containers per revision:
the ingress container (gunicorn on port 8000) and the `qcluster` sidecar (no
HTTP). Each deployment creates an immutable revision; traffic can be split across
revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, containers, traffic,
  logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for MySQL 8.0

InvenTree stores all of its records — parts, stock, orders, users — in a managed
Cloud SQL for MySQL 8.0 instance. The service connects over the instance's
**private IP via TCP** (`enable_cloudsql_volume = false`): the wrapper entrypoint
sets `INVENTREE_DB_HOST` from the Foundation's `DB_IP`. On first deploy the
`db-init` job creates the database and user, then the `migrate` job creates the
schema.

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

### C. NFS — InvenTree's data directory

When `enable_nfs = true`, the Services_GCP NFS share is mounted into the web
container and the init jobs at `nfs_mount_path`, and into the `qcluster`
sidecar at `/home/inventree/data`. Point `nfs_mount_path` at
`/home/inventree/data` so all three see the same directory; the default
`/var/lib/inventree` is not a path InvenTree reads or writes.

- **Console:** Compute Engine → VM instances (the Services_GCP NFS server).
- **CLI:**
  ```bash
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

### D. Cloud Storage

Two buckets are provisioned by default: the Foundation's `data` bucket (from
`storage_buckets`) and a `storage` bucket contributed by `InvenTree_Common`.
Neither is mounted into the container (`gcs_volumes` is empty), and InvenTree
does not read or write them. The `storage` bucket is a convenient place to stage
files for `enable_custom_sql_scripts`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

### E. Secret Manager

`InvenTree_Common` generates no application secrets. The only secret is the
database password, managed by the foundation. Any credential-named key you put
in `environment_variables` is moved into Secret Manager automatically while
`protect_sensitive_environment_variables = true`.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its project-number `run.app` URL by default. An
external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can
be layered on; a custom domain also sidesteps the two-hostname issue above.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
  echo "https://<service-name>-${PROJECT_NUMBER}.${REGION}.run.app"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Logs from both containers flow to Cloud Logging; Cloud Run and Cloud SQL metrics
flow to Cloud Monitoring. The uptime check is **off** by default
(`uptime_check_config.enabled = false`).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. InvenTree Application Behaviour

- **Two-stage init chain.** `db-init` (`mysql:8.0-debian`, 3 retries, 600 s)
  creates the MySQL user and database and verifies the user can connect.
  `migrate` (the app image, 2 vCPU / 2 GiB, 1800 s, depends on `db-init`) runs
  `python3 manage.py migrate --noinput` and then counts the tables; it fails if
  fewer than 10 exist, because `migrate` can exit 0 having applied nothing.
- **Why not `INVENTREE_AUTO_UPDATE`.** Upstream's in-process migration runs in
  the gunicorn master before the port binds (so the startup probe kills the
  revision mid-migration), its empty-database branch is unreachable, and the web
  and worker containers would race on the same schema. Both containers run with
  `INVENTREE_AUTO_UPDATE = "false"`.
- **Required environment.** The wrapper entrypoint refuses to start without
  `INVENTREE_SITE_URL` (or `CLOUDRUN_SERVICE_URL` as a fallback) and the
  Foundation's `DB_IP`, `DB_NAME`, `DB_USER` and `DB_PASSWORD`. The module also
  sets `INVENTREE_USE_X_FORWARDED_PROTO = "true"` and
  `INVENTREE_SESSION_COOKIE_SECURE = "true"`, so absolute links are `https://`
  and cookies are secure behind Cloud Run's TLS termination.
- **Static files.** The web container runs `collectstatic` on every start (the
  vendor `init.sh` does not). A failure there is logged as a warning and the
  container still starts — the UI may then render unstyled.
- **Background worker.** The `qcluster` sidecar runs `/cloud-entrypoint.sh
  invoke worker` with the app's infrastructure env and secrets
  (`inherit_app_env = true`), and with `INVENTREE_AUTO_UPDATE` and
  `INVENTREE_COLLECTSTATIC` set to `false`. Turning off
  `enable_background_worker` removes it: the UI and API still work, but no
  scheduled tasks, notifications or label generation run.
- **Health checks.** Startup and liveness probes are HTTP `GET /` on port 8000.
  The root path answers with a redirect to the web UI.
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 302
  ```
- **First administrator.** The module creates no InvenTree user, and the
  `admin_email` input is not used. Create the first superuser yourself — for
  example with InvenTree's own `INVENTREE_ADMIN_USER`, `INVENTREE_ADMIN_EMAIL`
  and `INVENTREE_ADMIN_PASSWORD` settings (see the InvenTree documentation),
  supplied through `environment_variables` / `secret_environment_variables`.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for InvenTree are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `inventree` | Base name for resources. Do not change after first deploy. |
| `display_name` | `InvenTree` | Human-readable name shown in the Console. |
| `application_version` | `1.5.4` | `inventree/inventree` tag, passed as the `INVENTREE_VERSION` build ARG. Pin an exact version — this variant's value is the one that takes effect. |
| `php_memory_limit` | `512M` | **Not used** — InvenTree is a Python application. |
| `admin_email` | `admin@example.com` | **Not used** — no administrator account is created. |
| `enable_gcs_storage_volume` | `true` | **Not used** — no bucket is mounted by this setting. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Builds the wrapper image via Cloud Build. `"prebuilt"` skips the wrapper entrypoint and its `DB_*` → `INVENTREE_DB_*` mapping. |
| `cpu_limit` | `1000m` | CPU for the web container. |
| `memory_limit` | `2Gi` | Memory for the web container. |
| `min_instance_count` | `0` | `0` enables scale-to-zero. |
| `max_instance_count` | `1` | Autoscaling upper bound. |
| `container_port` | `8000` | gunicorn's port. |
| `execution_environment` | `gen2` | Cloud Run execution environment. |
| `timeout_seconds` | `300` | Maximum request duration. |
| `enable_cloudsql_volume` | `false` | Connect over private-IP TCP instead of the Auth Proxy socket. |
| `container_protocol` | `http1` | HTTP/1.1. |
| `cpu_always_allocated` | `true` | Required for the `qcluster` sidecar. |
| `enable_background_worker` | `true` | Run the `qcluster` sidecar. |
| `worker_cpu_limit` / `worker_memory_limit` | `1000m` / `1Gi` | Sidecar resources. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public ingress by default. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra InvenTree settings (`INVENTREE_*`). Merged over the module's defaults, so a key here wins — do not override `INVENTREE_AUTO_UPDATE`, `INVENTREE_DATA_DIR` or `INVENTREE_DB_ENGINE`. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `protect_sensitive_environment_variables` | `true` | Moves credential-named keys from `environment_variables` into Secret Manager. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts & NFS Naming

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning
(verified end to end on this module, executed as the application user).
`nfs_instance_name` / `nfs_instance_base_name` select the NFS server; leave them
at their defaults to use the Services_GCP server. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend (requires Cloud Armor). |
| `max_images_to_retain` | `7` | Revision/image pruning. |
| `delete_untagged_images` / `image_retention_days` | `true` / `30` | No effect in a Services_GCP deployment — the shared registry's own policy applies. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the buckets in `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Setting this **replaces** the list — adding a bucket destroys the default `data` bucket. |
| `enable_nfs` | `false` | Mount NFS into the service, jobs and sidecar. Set `true` to persist the data directory. |
| `nfs_mount_path` | `/var/lib/inventree` | Set to `/home/inventree/data` when `enable_nfs = true`. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | InvenTree is configured for MySQL. |
| `db_name` / `db_user` | `inventree` | Tenant-prefixed at deploy time. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). Do not change on a running deployment. |
| `enable_auto_password_rotation` | `false` | Automated password rotation. |
| `db_host_env_var_name` | `DB_IP` | Extra name for the DB private IP; redundant, since `DB_IP` is always injected. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` → `migrate` chain. A non-empty list replaces it entirely. |
| `cron_jobs` | `[]` | No platform-scheduled recurring tasks by default — InvenTree's own scheduling runs in the `qcluster` sidecar. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /`, 30 s delay, 15 s period, 60 retries | A long window for a cold first start. |
| `liveness_probe` | HTTP `GET /`, 60 s delay, 30 s period, 3 retries | Matches the vendor image's health check (the document root). |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Cloud Monitoring uptime check — off by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | InvenTree is not wired to Redis by this module. |
| `redis_host` / `redis_port` | `""` / `6379` | Redis endpoint. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Project-number `run.app` URL of the service — the one InvenTree accepts. |
| `service_location` | Region the service runs in. |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (sensitive) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (`db-init`, `migrate`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | CI/CD status and details. |
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
| `enable_nfs` / `nfs_mount_path` | `true` / `/home/inventree/data` | **Critical** | With the defaults (`false` / `/var/lib/inventree`) the data directory is ephemeral: uploaded media, plugins, `config.yaml` and the generated secret key are lost on every cold start, and a new secret key invalidates all sessions and password-reset tokens. Enabling NFS at the default path mounts a directory InvenTree never uses. |
| Service URL used by people | the project-number URL (`service_url` output) or a custom domain | High | The hash-form `*.a.run.app` URL returns HTTP 500 (`INVE-E7`), because the host does not match `INVENTREE_SITE_URL`. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and loses all inventory data. |
| `storage_buckets` | leave at default unless you mean to replace it | High | The list replaces the default — adding one bucket destroys the `data` bucket and anything in it. |
| `environment_variables` | do not set `INVENTREE_AUTO_UPDATE=true` | Critical | Re-enables in-process migrations in both containers: a race on one schema and a probe kill mid-migration. A half-migrated database cannot be repaired by re-running `migrate` (it fails with `Duplicate column name`) — it has to be dropped and recreated. |
| `initialization_jobs` | `[]` | High | Any non-empty list replaces `db-init` → `migrate`; without them the schema is never created and the app exits on start. |
| `container_image_source` | `custom` | Critical | `prebuilt` deploys the stock image without the wrapper entrypoint — no `INVENTREE_DB_*` mapping, so InvenTree cannot reach MySQL. |
| `application_version` | an exact tag | Medium | Pin it on this variant; a pin set only in `InvenTree_Common` is overridden. |
| `cpu_always_allocated` / `enable_background_worker` | `true` / `true` | Medium | With request-based CPU the worker is frozen between requests; without the sidecar no background tasks run. Both fail silently. |
| `min_instance_count` | `1` for production | Medium | At `0` there is no instance, and so no background worker, while idle; the first request after idle waits for a cold start. |
| `database_password_length` | Set once | High | Changing it on a running deployment rotates the password without updating the database user; every connection then fails until `db-init` is re-run. |
| `enable_cloud_armor` | enable for production | Medium | The service is publicly reachable without WAF protection by default. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. InvenTree-specific application configuration
is described in **[InvenTree_Common](InvenTree_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: InvenTree on Cloud Run](../labs/InvenTree_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [InvenTree Common — Shared Application Configuration](InvenTree_Common.md) — the application layer this module builds on.
