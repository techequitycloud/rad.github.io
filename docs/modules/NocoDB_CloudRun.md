---
title: "NocoDB on Google Cloud Run"
description: "Configuration reference for deploying NocoDB on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# NocoDB on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/NocoDB_CloudRun.png" alt="NocoDB on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

NocoDB is an open-source Airtable alternative that transforms any database into a
smart spreadsheet with a no-code interface, REST and GraphQL APIs, and built-in
automations. This module deploys NocoDB on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services NocoDB uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What NocoDB costs on RAD, and how that compares

**NocoDB on RAD's Cloud Run module costs about US$69 a month, with the module fee charged once in RAD credits.** Need NocoDB to stay up continuously, scale across pods, or run beside other Kubernetes workloads — or see the [GKE guide](NocoDB_GKE.md) for that option. If you only need it occasionally — a demo, a seasonal project, something you're evaluating — a RAD-managed project can be deleted and restored within 30 days for a handful of credits (under US$1) instead of paying for it to sit idle. See **Pause it for free**, below. Figures are as at 8 October 2026; sources are listed at the end of this section.

### What you pay on RAD

RAD deploys **NocoDB**, which is open source, so there is no licence fee per user. You pay for
three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 75 credits (US$8 at the top-up price) | 67.5 credits (10% lower) |
| Build time | About 3-6 credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$69 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **26 credits a day**, about 780 a month (about US$78 at the top-up price, US$62 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second set of them.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (scaleToZero) | US$11.58 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$69** |

### How it compares

| Option | Price | Who runs it |
|---|---|---|
| Airtable, Team plan | $20/user/month, billed annually | Airtable. Per-seat; what NocoDB is built to replace |
| Airtable, Business plan | $45/user/month, billed annually | Airtable |
| NocoDB Cloud, Plus | about $12-15/month, unlimited seats | NocoDB Labs' own hosted plan for the same open-source project |
| NocoDB Cloud, Business | about $24-30/month, unlimited seats | NocoDB Labs |
| **RAD, Cloud Run, your own project** | **About US$69**, plus US$8 once per deployment | RAD's automation, in your project |
| **RAD, Cloud Run, a RAD-managed project** | **About 780 credits (US$62–78)** | RAD |
| RAD, GKE Autopilot | See the [GKE guide](NocoDB_GKE.md) | RAD |

**Airtable charges per seat; RAD's cost is the infrastructure, which does not grow with headcount.** A five-person team on Airtable's Team plan pays $100/month before any automation add-ons; the same team on RAD's own project pays a flat running cost regardless of how many people have logins. NocoDB Cloud's own unlimited-seat pricing is the closer like-for-like, since it is the same open-source project hosted by its maintainer — RAD's own-project figure sits below its Plus plan and its RAD-managed figure sits close to its Business plan, for infrastructure you can also inspect and move off at any time.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If NocoDB runs in **a project RAD manages for you**, you have a second option that goes well
beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to
nothing.** This suits NocoDB you only need occasionally — a demo, an evaluation, a seasonal
project — far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google to
  delete the project. Google does not remove the project immediately: it keeps it, recoverable,
  for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike
  deleting one module, this does not tear down the database or the compute resource
  one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a few credits, not a rebuild.** Within 30 days, the project's owner can restore
  it. RAD asks Google to undelete the project and reattaches its billing account, then asks you to
  run **Update** on each deployment to confirm everything came back. Because nothing was
  individually destroyed, that Update finds the same resources already there — it is a check, not a
  rebuild, and an Update never charges the module fee again. That costs roughly a handful of credits (under US$1) in
  total for a typical 2-3-deployment chain.
- **So a month of occasional use can cost a few dollars, not US$69.** Deploy NocoDB, use
  it for a while, delete the project. Restore it next time you want it, confirm with Update, and
  delete it again when you're done. You pay only for the module fee once, the builds, and whatever
  time NocoDB was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages billing
  for), and you restore it yourself within the 30 days — after that, Google deletes it for good.
  Restoring is admitted like creating a new project: your purchased credit balance must still clear
  the tier's floor (100 credits for the sandbox tier most study and demo use fits). Google says most
  services are fully working again within 36 hours of a restore.
- **One real gap: nightly backups don't survive.** Backups are written to a bucket inside the
  project, and that bucket is **not** protected by Cloud Storage's soft-delete, so it is very likely
  gone as soon as you delete the project — even though the project itself is recoverable for 30
  days. If you've customised NocoDB and want to keep that work, copy a backup out (to Google Drive,
  or a bucket outside the project) before you delete. For a default installation with nothing
  irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

The option above only applies to a RAD-managed project; **in your own project, or once the 30-day
window has passed, the way to stop paying is to delete the deployment and deploy it again when you
need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 80
  credits (US$8) in your own project, or 72
  credits in a RAD-managed one. Deleting saves money once NocoDB would otherwise sit unused for
  about 3 days or more in your own project (about US$2.29 a
  day), or about 3 days or more in a RAD-managed one (26 credits a
  day).
- **Most of the running cost is usually the database and any shared file/cache VM.** They stop only
  when nothing else in the project uses them, so deleting NocoDB while something else shares the
  project saves only this app's own compute part.
- **Keep your data first.** Nightly backups go to a bucket inside the deployment and are deleted
  with it, so copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  NocoDB in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs NocoDB for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing
  pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands
  the project over and the deployments become the client's own.
- Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by
  card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the 30-day recovery window and what it says about Cloud Storage objects without soft delete; RAD fees and the daily-credit estimates from [radmodules.dev/pricing](https://radmodules.dev/pricing); [NocoDB pricing](https://nocodb.com/pricing); [Airtable pricing](https://airtable.com/pricing). Prices change; check each source before relying on a figure.

## 1. Overview

NocoDB runs as a Node.js container on Cloud Run v2. The deployment wires together
a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 1 vCPU / 1 GiB by default, request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | `database_type` has no effect on Cloud Run — Postgres 15 is always provisioned |
| Object storage | Cloud Storage | Provisioned, but not wired to NocoDB's attachment storage (see below) |
| Cache (optional) | Redis | Disabled by default; required when running multiple instances |
| Secrets | Secret Manager | Auto-generated JWT secret (`NC_AUTH_JWT_SECRET`) and database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 only, on Cloud Run.** The `database_type` variable is defined but
  never forwarded to `NocoDB_Common` (which hardcodes `POSTGRES_15`), so setting it
  has no effect here — Postgres 15 is provisioned regardless of the value. MySQL
  8.0 is supported on `NocoDB_GKE`, where the equivalent override is wired.
- **NocoDB connects via private IP TCP, not the Auth Proxy socket.** The Cloud SQL
  Auth Proxy sidecar is **disabled** by default (`enable_cloudsql_volume = false`)
  because NocoDB's internal URL constructor rejects Unix socket paths. The private
  IP is used directly.
- **NFS is disabled by default.** NocoDB has no shared-filesystem dependency, but
  it also has no working Cloud Storage attachment backend out of the box (see
  §2C) — attachments use local/ephemeral container disk unless configured manually.
- **Redis is disabled by default.** A single instance runs without Redis; enable it
  before scaling beyond one instance.
- **`cpu_always_allocated = false` by default.** Request-based billing; NocoDB's
  background automation and webhook retry logic only continues while an instance is
  handling a request. Set `true` (with `min_instance_count ≥ 1`) for uninterrupted
  background processing.
- **The JWT secret is generated automatically** and stored in Secret Manager. Do not
  rotate it after the first deploy — all existing sessions and API tokens would be
  immediately invalidated.
- **NocoDB handles its own database migrations on first start.** No external init job
  is required.
- **Health probes target `/api/v1/health`**, the dedicated health endpoint NocoDB
  exposes.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the NocoDB service

NocoDB runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

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

NocoDB stores all application data (tables, views, automations, row data) in a
managed Cloud SQL for PostgreSQL 15 instance. The service connects over a private IP
TCP connection (no public IP, no Auth Proxy socket). On first deploy an
initialization Job creates the application database and user; NocoDB then runs its
own schema migrations on startup.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the
connection model, backups, and password rotation.

### C. Cloud Storage — provisioned, not wired to attachments

The `storage_buckets` variable provisions a GCS bucket (default `name_suffix =
"data"`) and a `GCS_BUCKET_NAME` value is injected into the service as an env var.
However, `NocoDB_Common`'s entrypoint script never reads `GCS_BUCKET_NAME` (or any
other S3/GCS variable), and the injected value does not match the name of any
bucket the foundation actually creates. NocoDB therefore does **not** automatically
store attachments in Cloud Storage — uploaded files are written to local/ephemeral
container disk and are lost on restart or cold start. To persist attachments in
GCS, configure NocoDB's own S3-compatible storage settings manually (via its admin
UI or `environment_variables`) pointed at a bucket the Cloud Run service account
can access.

- **Console:** Cloud Storage → Buckets → select the provisioned bucket.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/      # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse, CMEK, and additional
bucket options.

### D. Redis cache (optional)

Redis backs NocoDB's caching layer and, in multi-instance deployments, keeps cache
and session state consistent. Redis is disabled by default; a `redis_host` must be
supplied when it is enabled.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The NocoDB JWT secret (`NC_AUTH_JWT_SECRET`) and the database password are stored in
Secret Manager and injected into the service at runtime.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress
settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks against `/api/v1/health` and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. NocoDB Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) creates the
  NocoDB database and user before the service starts. It is idempotent.
- **Self-managed migrations.** NocoDB runs its own database schema migrations on
  startup — there is no need to configure external migration jobs.
- **JWT secret.** `NC_AUTH_JWT_SECRET` is generated automatically and stored in
  Secret Manager. Do not rotate it after the first deploy; all existing sessions and
  API tokens are immediately invalidated if the secret changes.
- **GCS uploads are not automatic.** A `GCS_BUCKET_NAME` env var is injected, but
  the entrypoint script never reads it and the value does not match any bucket the
  foundation creates. Attachments use local/ephemeral container disk unless the
  operator manually configures NocoDB's own S3-compatible storage settings.
- **NC_DB_* environment variables.** The custom Dockerfile in `NocoDB_Common` maps
  the standard `DB_*` connection variables (injected by the foundation) to the
  `NC_DB_*` names NocoDB expects. When `container_image_source = "prebuilt"` the
  mapping is not applied — configure `NC_DB_*` variables manually via
  `environment_variables`.
- **Public URL.** The Cloud Run service URL is injected as `NC_PUBLIC_URL` so NocoDB
  generates correct absolute URLs in share links, email notifications, and webhook
  callbacks. Controlled by `service_url_env_var_name` (default `"NC_PUBLIC_URL"`).
- **Health path.** Readiness and liveness probes target `/api/v1/health`, which
  returns HTTP 200 when NocoDB is ready to accept requests.
- **Multi-instance sessions.** With more than one instance and no Redis, NocoDB
  cannot share session or cache state; users may be logged out when requests route to
  a different instance. Enable Redis and set `redis_host` before scaling above one
  instance.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for NocoDB are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `nocodb` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `NocoDB` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Service description. |
| `application_version` | `latest` | NocoDB image version tag; pin to a specific version for production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `1Gi` | Memory per instance; minimum 1 GiB to avoid OOM on startup. |
| `min_instance_count` | `0` | Minimum instances; `0` enables scale-to-zero. Keep ≥ 1 if webhooks must not be dropped. |
| `max_instance_count` | `3` | Maximum instances. |
| `container_port` | `8080` | NocoDB listens on port 8080. |
| `execution_environment` | `gen2` | Gen2 recommended for faster startup and improved networking. |
| `enable_cloudsql_volume` | `false` | **Disabled** — NocoDB connects via private IP TCP, not the Auth Proxy socket. |
| `cpu_always_allocated` | `false` | Request-based billing by default. Set `true` to keep background automation tasks running between requests. |
| `container_image_source` | `custom` | `custom` builds via Cloud Build with NC_DB_* mapping; `prebuilt` deploys an existing image. |
| `traffic_split` | `[]` | Canary/blue-green traffic allocation across revisions. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in. Recommended for internal workspaces. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |
| `ingress_settings` | `all` | Which networks may reach the service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` / `secret_rotation_period` | _(set)_ | Replication wait / rotation cadence. |

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
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDRs exempted from WAF rules. |
| `application_domains` | `[]` | Custom hostnames for the external load balancer. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the GCS buckets defined in `storage_buckets`. Not wired to NocoDB attachments — see §2C. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | GCS buckets to provision. |
| `enable_nfs` | `false` | NFS is not required for NocoDB. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path if NFS is enabled. |
| `gcs_volumes` | `[]` | GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Not wired through on Cloud Run — `NocoDB_Common` hardcodes `POSTGRES_15` regardless of this value; use `NocoDB_GKE` for `MYSQL_8_0`. |
| `application_database_name` | `nocodb` | Database name. Immutable after first deploy. |
| `application_database_user` | `nocodb` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` | `NC_DB_HOST` | Additional env var name for the DB host. |
| `db_port_env_var_name` | `NC_DB_PORT` | Additional env var name for the DB port. |
| `db_name_env_var_name` | `NC_DB_NAME` | Additional env var name for the DB name. |
| `db_user_env_var_name` | `NC_DB_USER` | Additional env var name for the DB user. |
| `db_password_env_var_name` | `NC_DB_PASSWORD` | Additional env var name for the DB password. |
| `service_url_env_var_name` | `NC_PUBLIC_URL` | Env var name under which the public service URL is injected. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Recurring jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | `/api/v1/health` | HTTP startup probe, 30 s initial delay. |
| `liveness_probe` / `health_check_config` | `/api/v1/health` | HTTP liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check against `/api/v1/health`. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis. Required when running more than one instance. |
| `redis_host` | `null` | Redis endpoint. Required when `enable_redis = true`. |
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
| `database_host` / `database_port` | DB endpoint (private IP) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs. |
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

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `NC_AUTH_JWT_SECRET` | auto-generated (immutable) | Critical | Rotating after first deploy immediately invalidates all sessions and API tokens. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup file fails the import job. |
| `enable_cloudsql_volume` | `false` (default) | Critical | Setting `true` does not help NocoDB — its URL constructor rejects socket paths and all DB connections fail. |
| `memory_limit` | `1Gi` | High | NocoDB's Node.js process is OOM-killed below 512 Mi; production workloads with many automations need 2 Gi. |
| `enable_redis` | `true` when >1 instance | High | Multiple instances without Redis cause session invalidation when requests route to different instances. |
| `redis_host` | explicit when Redis on | High | A missing host causes all Redis connections to fail on startup. |
| `NC_PUBLIC_URL` / `service_url_env_var_name` | `NC_PUBLIC_URL` (default) | High | NocoDB uses this to build share links, webhook URLs, and email notifications; an incorrect value breaks all outbound references. |
| `cpu_always_allocated` | `false` (default); `true` for heavy automation | Medium | Under the default request-based billing, NocoDB background automation and webhook retry tasks pause between requests. |
| `min_instance_count` | `1` | Medium | `0` causes cold starts during which webhook callbacks time out and are dropped. |
| `max_instance_count` | keep low without Redis | Medium | Increasing above `1` without Redis causes session invalidation. |
| `enable_iap` / `enable_cloud_armor` | enable for internal | Medium | NocoDB is otherwise publicly reachable at its `run.app` URL. |
| `application_version` | pin to specific tag | Medium | `latest` triggers uncontrolled upgrades on every container rebuild. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. NocoDB-specific application configuration shared
with the GKE variant is described in **[NocoDB_Common](NocoDB_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: NocoDB on Cloud Run](../labs/NocoDB_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [NocoDB on GKE Autopilot](NocoDB_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [NocoDB Common — Shared Application Configuration](NocoDB_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Metabase on Google Cloud Run](Metabase_CloudRun.md), [CloudBeaver on Google Cloud Run](CloudBeaver_CloudRun.md), [Azimutt on Google Cloud Run](Azimutt_CloudRun.md) in the **Self-service BI** solution.
