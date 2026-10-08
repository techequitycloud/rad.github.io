---
title: "Directus on Cloud Run"
description: "Configuration reference for deploying Directus on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Directus on Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Directus_CloudRun.png" alt="Directus on Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Directus is an open-source headless CMS and Backend-as-a-Service (BaaS) platform that wraps any SQL database with auto-generated REST and GraphQL APIs and a no-code admin application. This module deploys Directus on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Directus uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Directus costs on RAD, and how that compares

**Directus on RAD's Cloud Run module costs about US$82.03 a month with no separate hosting licence.** This compares against US$499 a month (billed annually) or US$599 a month (billed monthly) for Directus Cloud's own hosted Team plan. A self-managed server is cheaper in cash, but then you run the database, backups, security patches and upgrades yourself. GKE Autopilot suits Directus that must stay up continuously or scale across pods; for the lowest cost, this Cloud Run module already gives you the cheaper option — see the [GKE guide](Directus_GKE.md) if you need the other one. Figures are as at 8 October 2026; sources are listed at the end of this section.

If you only need it occasionally — studying, a demo, a seasonal business — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that US$82.03 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 110 credits (US$11 at the top-up price) | 99 credits (10% lower) |
| Build time | A few credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$82.03 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **32 credits a day**, about 960 a month (about US$96 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (scaleToZero) | US$11.58 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$82.03** |

### How it compares

| Option | Per month | Who runs it |
|---|---|---|
| Directus Cloud, Team plan | US$499 (annual) – US$599 (monthly) | Directus |
| **RAD, Cloud Run, your own project** | **About US$82.03** | RAD's automation, in your project |
| **RAD, Cloud Run, a RAD-managed project** | **About US$96** | RAD |

- Directus Cloud's Team plan is priced per **project**, not per seat, and starts at several times RAD's own-project cost for the same open-source Directus Core — Directus's free Core tier is self-hosted, which is effectively what RAD automates for you.
- A cheap server is cheap until something breaks: RAD's database is Cloud SQL with daily backups and point-in-time recovery, and secrets live in Secret Manager. On your own server, or a bare VPS, each of those is a job you do yourself.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Directus runs in **a project RAD manages for you**, you have a second option that goes well
beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to
nothing.** This suits Directus you only need occasionally — studying, a demo, a seasonal
business — far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google
  to delete the project. Google does not remove the project immediately: it keeps it, recoverable,
  for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike
  deleting one module, this does not tear down Cloud SQL, the NFS VM or Cloud Run one by one — the whole project,
  and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's owner
  can restore it. RAD asks Google to undelete the project and reattaches its billing account,
  then asks you to run **Update** on each deployment to confirm everything came back. Because
  nothing was individually destroyed, that Update finds the same resources already there — it
  is a check, not a rebuild, and an Update never charges the module fee again. That costs **a
  handful of credits (under US$1)** in total for a typical Directus-sized deployment chain, against
  the 104 credits (US$10.35) a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$82.03.** Deploy Directus, use it
  for a while, delete the project. Restore it next time you want it, confirm with Update, and
  delete it again when you're done. You pay only for the module fee once, the builds, and
  whatever hours Directus was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages
  billing for), and you restore it yourself within the 30 days — after that, Google deletes it
  for good. Restoring is admitted like creating a new project: your purchased credit balance
  must still clear the tier's floor (100 credits for the sandbox tier most study and demo use
  fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap: nightly backups do not survive.** Backups are written to a bucket inside
  the project, and that bucket is **not** protected by Cloud Storage's soft-delete, so it is
  very likely gone as soon as you delete the project — even though the project itself is
  recoverable for 30 days. If you have customised the data and want to keep it, copy a backup
  out (to Google Drive, or a bucket outside the project) before you delete, the same as the
  redeploy workflow below. For a default installation with nothing irreplaceable in it, this
  does not matter.


### Pay only while you use it, the other way: delete and redeploy

Cloud Run already scales to zero between requests. The option above only applies to a RAD-managed project; **in your own project, or
once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy
it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 114 credits
  (US$11.45), and about an hour, because RAD recreates the project and shared services before Directus. Deleting saves money once Directus would otherwise sit unused
  for about **4 days or more** in your own project (about US$2.73 a day), or about
  **3 days or more** in a RAD-managed one (32 credits a day).
- **Delete everything Directus uses.** Most of the running cost is the database and the NFS/cache VM. They stop only when nothing else in the project uses them, so deleting it while something else shares the project saves only Directus's own compute part.
- **Keep your data first.** The nightly database backups are written to a bucket inside the deployment, and that bucket is deleted with it. Before deleting, copy the latest backup to Google Drive, or to a bucket you keep.
- **Note your settings.** RAD does not recreate a deleted deployment for you; you enter the
  settings again when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  Directus in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs Directus for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API;
RAD's own fees and daily-credit estimates from [radmodules.dev/pricing](https://radmodules.dev/pricing);
[Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
for the pause/restore mechanics and window. [Directus Cloud pricing](https://directus.com/pricing) for the Team plan figures;


## 1. Overview

Directus runs as a Node.js container on fully managed Cloud Run. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Serverless, auto-scales to zero between requests |
| Database | Cloud SQL for PostgreSQL 15 | Required — Directus hardcodes `DB_CLIENT = "pg"` |
| Shared files | Filestore (NFS) | Uploaded assets and media shared across all instances |
| Object storage | Cloud Storage | A dedicated uploads bucket; GCS is the default Directus storage driver |
| Cache | Redis | Enabled by default; defaults to the NFS host IP when no explicit host is set |
| Secrets | Secret Manager | Auto-generated KEY, SECRET, ADMIN_PASSWORD, and REDIS connection URL |
| Ingress | Cloud Load Balancing | HTTPS via serverless NEG + optional custom domain and managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is required.** Directus hardcodes `DB_CLIENT = "pg"`. Switching to MySQL or `NONE` prevents startup.
- **GCS is the default file storage driver.** `Directus_Common` automatically injects `STORAGE_GCS_DRIVER`, `STORAGE_GCS_BUCKET`, and `STORAGE_LOCATIONS = "gcs"`, so all uploads go to the dedicated Cloud Storage bucket.
- **Auto-migrate and bootstrap run on every start.** `AUTO_MIGRATE = "true"` applies any pending database schema migrations on startup. `BOOTSTRAP = "true"` seeds the admin user and system collections on first boot — both are idempotent.
- **Scale-to-zero is the default** (`min_instance_count = 0`). Directus uses Redis-backed sessions, so cold starts are acceptable for non-latency-critical deployments. Set `min_instance_count = 1` to eliminate cold starts in production.
- **The Directus KEY and SECRET** are generated automatically and stored in Secret Manager. Rotating them after the first deployment invalidates all active sessions and JWTs.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT`, `REGION`, and `SERVICE_NAME` are set. The service name and other identifiers are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run service — the Directus workload

Directus runs as a single Cloud Run service. Each new deployment creates a new revision; traffic management controls which revision receives traffic.

- **Console:** Cloud Run → select the service to see revisions, traffic splits, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe "$SERVICE_NAME" --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service "$SERVICE_NAME" --project "$PROJECT" --region "$REGION"
  # Stream live logs:
  gcloud run services logs tail "$SERVICE_NAME" --project "$PROJECT" --region "$REGION"
  # Verify the health endpoint manually:
  curl -sf "$(gcloud run services describe "$SERVICE_NAME" --project "$PROJECT" --region "$REGION" --format='value(status.url)')/server/ping"
  ```

See [App_CloudRun](App_CloudRun.md) for autoscaling, concurrency, execution environments, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Directus stores all application data in a managed Cloud SQL for PostgreSQL 15 instance. Instances connect by default over **TCP** (Cloud SQL connector, no Unix socket by default on Cloud Run). A `db-init` job runs on every apply (idempotent) and creates the application database, user, grants privileges, and installs the `uuid-ossp` extension.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the password are all surfaced in the [Outputs](#5-outputs). For the connection model, automated backups, and password rotation, see [App_CloudRun](App_CloudRun.md).

### C. Filestore (NFS) and Cloud Storage

Uploaded assets are written to a **Filestore (NFS)** share mounted into every instance so all replicas see the same files. A dedicated **Cloud Storage** uploads bucket is also provisioned; Directus is configured to use GCS as its primary storage driver via `STORAGE_GCS_DRIVER = "gcs"`.

- **Console:** Filestore → Instances for the NFS share; Cloud Storage → Buckets for the uploads bucket.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/          # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for NFS provisioning, GCS Fuse, and CMEK options.

### D. Redis cache

Redis backs Directus's API response caching and rate-limiting state. When no explicit Redis host is configured and NFS is enabled, the NFS host IP is used as the default Redis endpoint. The full Redis connection URL (including any auth password) is stored as a Secret Manager secret and injected as the `REDIS` environment variable.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  # Confirm REDIS is injected into the Cloud Run service environment:
  gcloud run services describe "$SERVICE_NAME" --project "$PROJECT" --region "$REGION" \
    --format='yaml(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager

Four secrets are generated and stored automatically: `KEY` (data encryption), `SECRET` (JWT signing), `ADMIN_PASSWORD` (initial admin account), and `REDIS` (Redis connection URL when Redis is enabled). The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the admin password:
  gcloud secrets versions access latest --secret=<prefix>-admin-password --project "$PROJECT"
  # Retrieve the DB password:
  gcloud secrets versions access latest --secret=<database_password_secret> --project "$PROJECT"
  ```

The `database_password_secret` name is in the [Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the secret injection model.

### F. Networking & ingress

The Cloud Run service is fronted by a serverless Network Endpoint Group attached to a global Cloud Load Balancer. HTTPS is managed automatically. A custom domain with a Google-managed certificate can be enabled, and a static IP can be reserved.

- **Console:** Network services → Load balancing; Cloud Run → service → Networking tab.
- **CLI:**
  ```bash
  gcloud run services describe "$SERVICE_NAME" --project "$PROJECT" --region "$REGION" \
    --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Container stdout/stderr flow to Cloud Logging. Cloud Run metrics and optional uptime checks flow to Cloud Monitoring.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read \
    'resource.type="cloud_run_revision" AND resource.labels.service_name="'"$SERVICE_NAME"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Directus Application Behaviour

- **First-deploy database setup.** A `db-init` job runs on every apply (`execute_on_apply = true`). It creates the Directus database user with the generated password, creates the `directus` database, installs the `uuid-ossp` extension, and grants full privileges. The job is idempotent.
- **Bootstrap on first start.** `BOOTSTRAP = "true"` seeds the initial admin user and Directus system collections on first boot. The admin email defaults to `admin@example.com` — **override this via `environment_variables = { ADMIN_EMAIL = "you@example.com" }` before the first deploy.**
- **Migrations on every start.** `AUTO_MIGRATE = "true"` causes Directus to run `database migrate:latest` on each instance start, so upgrading `application_version` applies schema changes automatically.
- **Health probe.** The startup probe targets `/server/ping` with a 30-second initial delay and a generous failure threshold (`failure_threshold = 10`, `period_seconds = 20`) to accommodate first-boot database setup. The liveness probe also targets `/server/ping`.
- **TCP database connections by default.** Unlike the GKE variant (which uses a Unix socket via the Auth Proxy sidecar), the Cloud Run variant connects to Cloud SQL over TCP using the Cloud SQL connector (`enable_cloudsql_volume = false` by default). Outbound traffic travels to private IPs only (`vpc_egress_setting = "PRIVATE_RANGES_ONLY"`).
- **KEY and SECRET rotation.** Rotating the `KEY` secret immediately invalidates all active user sessions. Rotating `SECRET` invalidates all issued JWTs. Never rotate either without a planned maintenance window and client notification.
- **Admin login.** Retrieve the generated admin password from Secret Manager (see §2.E). The default admin email is `admin@example.com` unless overridden.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for Directus are listed; every other input is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the Cloud Run service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. Do not change after first deploy. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `directus` | Base name for resources. Do not change after first deploy — embedded in Secret Manager secret IDs. |
| `display_name` | `Directus CMS` | Friendly name shown in the Console. |
| `application_version` | `11.1.0` | Directus image version tag; increment to roll out a new version. Pin to a specific tag — avoid `latest` in production. |
| `description` | `Directus - Open Source Headless CMS and Backend-as-a-Service` | Service description annotation. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only (Cloud SQL, storage, secrets) without deploying the Cloud Run service. |
| `cpu_limit` | `1000m` | vCPU per instance; 1 vCPU is suitable for light workloads. |
| `memory_limit` | `1Gi` | Memory per instance; defaulted to 1 GiB for light/typical usage (observed ~150Mi) — raise to 2 GiB for production or large schemas/image transformations. |
| `cpu_always_allocated` | `false` | Request-based billing — safe for Directus's default request/response mode. Set `true` only if enabling realtime/WebSocket subscriptions or scheduled flows that must run without an inbound request. |
| `min_instance_count` | `0` | Minimum instances. Set `1` to eliminate cold starts in production. |
| `max_instance_count` | `1` | Maximum concurrency ceiling. Increase for production traffic. |
| `container_port` | `8055` | Directus default listening port. |
| `execution_environment` | `gen2` | Cloud Run second-generation execution environment (recommended). |
| `enable_cloudsql_volume` | `false` | TCP connection by default; set `true` to enable the Unix socket via Auth Proxy sidecar. |

### Group 5 — Ingress & IAP

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `"all"` (public) or `"internal-and-cloud-load-balancing"` (private). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only private-range traffic through the VPC connector. |
| `enable_iap` | `false` | Require Google sign-in in front of Directus. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access when IAP is enabled. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | _(SMTP defaults)_ | Extra non-secret settings. The default includes SMTP placeholder variables. **Override `ADMIN_EMAIL` here before first deploy.** |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 7 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. Set `enable_backup_import = false` immediately after a successful restore. |

### Group 8 — CI/CD & GitHub Integration

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see [App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 9 — Custom SQL Scripts & NFS

| Variable | Default | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` | run SQL from GCS | See [App_CloudRun](App_CloudRun.md). |
| `nfs_instance_name` / `nfs_instance_base_name` | references shared Filestore instance | Set when the Filestore instance was not created by the same Services_GCP deployment. |

### Group 10 — Cloud Armor, Domains & CDN

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the load balancer backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `application_domains` | `[]` | Custom hostnames — enable for production with a real DNS name. |
| `enable_cdn` | `false` | Enable Cloud CDN via the load balancer. |

### Group 11 — Cloud Storage & NFS

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision additional buckets beyond the auto-provisioned uploads bucket. |
| `storage_buckets` | `[{ name_suffix = "data", location = "" }]` | Additional GCS buckets, on top of the auto-provisioned uploads bucket from `Directus_Common`. |
| `enable_nfs` | `true` | Shared Filestore volume for uploaded assets (keep enabled for multi-instance). |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS buckets to mount via GCS Fuse CSI driver. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Directus requires PostgreSQL. Do not change. |
| `db_name` | `directus` | PostgreSQL database name. Do not change after first deploy. |
| `db_user` | `directus` | Application user. Do not change after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job supplied by `Directus_Common`. |
| `cron_jobs` | `[]` | Recurring Cloud Run jobs (e.g., cache purge, data sync). |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `/server/ping`, HTTP, 30s delay, failure_threshold=10, period=20s | Cloud Run startup probe. Allows up to ~230 s for first-boot migrations. |
| `liveness_probe` | `/server/ping`, HTTP, 15s delay | Instance restarted after 3 consecutive failures. |
| `uptime_check_config` | disabled by default, path `/` | Optional Cloud Monitoring uptime check. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Use Redis for caching and rate limiting. |
| `redis_host` | `""` | Leave empty to use the NFS host IP; set explicitly for a dedicated Memorystore instance. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). The full connection URL is stored in Secret Manager. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). Use `vpc_sc_dry_run = true` first. |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | The public HTTPS URL to reach Directus. |
| `service_location` | Region where the service is deployed. |
| `stage_services` | Service URLs per Cloud Deploy stage (when multi-stage deploy is enabled). |
| `load_balancer_ip` | External IP of the load balancer frontend. |
| `load_balancer_url` | HTTPS URL via the load balancer (when a custom domain or static IP is used). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` | DB host (sensitive — returned as `(sensitive)` in plan output). |
| `database_port` | DB port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, and uptime checks. |
| `initialization_jobs` | Names of the setup jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD GitHub details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Directus requires PostgreSQL; changing to MySQL or `NONE` prevents startup and orphans the existing database. |
| `application_name` | set once | Critical | Embedded in Secret Manager secret IDs (KEY, SECRET, ADMIN_PASSWORD). Changing recreates all secrets — all active sessions and JWTs are immediately invalidated. |
| `tenant_id` | set once | Critical | Changing after first deploy orphans the Cloud SQL instance and generates a new empty database plus new KEY/SECRET, invalidating all sessions. |
| `KEY` / `SECRET` secrets | auto-generated, never rotate casually | Critical | Rotating KEY logs out all users. Rotating SECRET invalidates all API tokens. Only rotate during a planned maintenance window. |
| `ADMIN_EMAIL` env var | a real email address | High | Default `admin@example.com` creates the admin account with a guessable email. Override via `environment_variables = { ADMIN_EMAIL = "you@example.com" }` before first deploy. |
| `enable_nfs` | `true` | High | Without shared NFS, uploaded assets written by one instance are invisible to others and lost on scale-down (unless using GCS exclusively). |
| `enable_redis` | `true` for multi-instance | High | Without Redis, each instance has an isolated cache; rate-limiting is per-instance and Directus caching breaks across replicas. |
| `redis_host` | `""` (NFS) or explicit | High | No valid Redis endpoint if Redis is enabled, NFS is off, and no host is set. |
| `startup_probe.failure_threshold` | `10` on first deploy | High | Too low: Directus migrations can take 1–3 minutes on a fresh database; the instance is killed before migrations complete. |
| `enable_backup_import` | `false` after restore | High | Leaving `true` re-runs the import on every apply, overwriting live data with the stale backup. |
| `memory_limit` | `2Gi` | High | Too little memory causes OOM kills during schema loading or image transformation. |
| `min_instance_count` | `1` for production | Medium | `0` in production causes 20–40 s cold starts on the first API request after an idle period. |
| `max_instance_count` | scale for traffic | Medium | `1` blocks horizontal scaling and causes request queuing under load. |
| `enable_iap` / `enable_cloud_armor` | enable for admin-facing | Medium | The admin UI is otherwise publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_vpc_sc` + `vpc_sc_dry_run` | start with `vpc_sc_dry_run = true` | Critical | Enabling enforcement without the SA in the access level blocks Cloud SQL, Secret Manager, and Artifact Registry simultaneously. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. Directus-specific application configuration shared with the GKE variant is described in **[Directus_Common](Directus_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Directus on Cloud Run](../labs/Directus_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Directus on GKE Autopilot](Directus_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Directus Common — Shared Application Configuration](Directus_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Umami on Google Cloud Run](Umami_CloudRun.md) in the **Headless Content Platform** solution.
