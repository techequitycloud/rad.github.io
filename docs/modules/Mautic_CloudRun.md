---
title: "Mautic on Google Cloud Run"
description: "Configuration reference for deploying Mautic on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Mautic on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mautic_CloudRun.png" alt="Mautic on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Mautic is an open-source marketing-automation platform for email campaigns, contact
management, landing pages, and lead scoring. This module deploys Mautic on **Cloud
Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions
and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Mautic uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Mautic costs on RAD, and how that compares

**Mautic on RAD's Cloud Run module costs about US$102 a month in your own project, with no per-contact licence.** RAD charges 110 credits once per deployment in your own project (99 credits, 10% lower, in a project RAD manages), plus build time. Mautic also deploys on GKE Autopilot for about US$150 a month — see the [GKE guide](Mautic_GKE.md) if you need it to run there instead. If you only need it occasionally, a RAD-managed project can be deleted and restored within 30 days for a few credits, so that monthly figure becomes a few dollars instead — see **Pause it for free**, below.


### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 110 credits (US$11.00 at the top-up price) | 99 credits (10% lower) |
| Build time | A few credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$102 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **32 credits a day**, about 960 a month (about US$96.00 at the top-up price, less on a plan) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (scaleToZero) | US$32 |
| Cloud SQL for MySQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51 |
| NFS/cache file server (small VM) | US$13 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$102** |

### How it compares

- **HubSpot's Marketing Hub Professional plan** starts at **US$800 a month**
  (including 3 core seats; additional seats from US$45 each) and requires a **one-time
  US$3,000 onboarding fee**. Its entry Starter plan is far cheaper (from US$7/seat/month) but
  drops most marketing-automation features Mautic ships by default.
- RAD's Mautic module costs about US$102 a month in your own project — a small
  fraction of HubSpot Professional's price, with no per-contact licensing tier to outgrow and
  no onboarding fee, because it deploys Mautic's own open-source automation engine rather than
  a vendor's metered platform.
- Self-managed comparison: at 2 vCPU / 4 GiB with a MySQL database, a
  GCP Compute Engine e2-standard-2 (~US$49/month) is in range, but you run MySQL, email
  deliverability, backups and upgrades yourself.


### Pause it for free: delete a RAD-managed project, restore it when you need it

If Mautic runs in **a project RAD manages for you**, you have a second option that goes
well beyond scaling to zero: **delete the whole project, and restore it within 30 days for
close to nothing.** This suits Mautic you only need occasionally — evaluating it, a demo
environment, a seasonal or intermittent workload — far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google
  to delete the project. Google does not remove the project immediately: it keeps it,
  recoverable, for 30 days. Because billing is already unlinked, nothing is charged while it
  waits. Unlike deleting one module, this does not tear down the database, any VM or the
  compute resource one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a few credits, not a rebuild.** Within 30 days, the project's owner can
  restore it. RAD asks Google to undelete the project and reattaches its billing account, then
  asks you to run **Update** on each deployment to confirm everything came back. Because
  nothing was individually destroyed, that Update finds the same resources already there — it
  is a check, not a rebuild, and an Update never charges the module fee again. For Mautic behind Services_GCP (a small NFS/cache VM, a Mysql database) and Project_GCP, that is roughly **a handful of credits (under US$1)** in total, against the about 115 credits (US$11.50) a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$102.**
  Deploy Mautic, use it for a while, delete the project. Restore it next time you need it,
  confirm with Update, and delete it again when you're done. You pay only for the module fee
  once, the builds, and whatever time it was actually live.
- **What this needs.** You must own the project (not one RAD only manages billing for), and
  you restore it yourself within the 30 days — after that, Google deletes it for good.
  Restoring is admitted like creating a new project: your purchased credit balance must still
  clear the tier's floor (100 credits for the sandbox tier most evaluation use fits). Google
  says most services are fully working again within 36 hours of a restore.
- **One real gap: nightly backups do not survive.** Backups and other generated files are
  written to a bucket inside the project, and that bucket is **not** protected by Cloud
  Storage's soft-delete, so it is very likely gone as soon as you delete the project — even
  though the project itself is recoverable for 30 days. If you have customised Mautic and
  want to keep that work, copy a backup out (to Google Drive, or a bucket outside the project)
  before you delete. For a default installation with nothing irreplaceable in it, this does
  not matter.


### Pay only while you use it, the other way: delete and redeploy

The option above only applies to a RAD-managed project; **in your own project, or once the
30-day window has passed, the way to stop paying is to delete the deployment and deploy it
again when you need it.**

- **What a redeploy costs.** The module fee again, plus the builds — roughly
  115 credits (US$11.50) in total. Deleting saves money
  only once Mautic would otherwise sit unused long enough to clear that redeploy cost
  against its own running cost — about **4 days or more**, both in your own project
  (about US$3.40 a day) and in a RAD-managed one (32 credits a day).
- **Most of the running cost is usually shared.** For Mautic that is the database and the shared file/cache VM. They stop only when nothing else in the project uses them, so deleting this app while something else shares the project saves only this app's own compute part.
- **Keep your data first.** Nightly backups go to a bucket inside the deployment and are
  deleted with it, so copy the latest backup out before deleting if you want to keep it.


### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by
card, bank transfer or mobile money.


**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD fees and the daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics and what it says about Cloud Storage objects without soft delete; [HubSpot](https://www.hubspot.com/pricing/marketing). Prices change; check each source before relying on a figure.


## 1. Overview

Mautic runs as a PHP/Apache container on Cloud Run v2. The deployment wires together
a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | PHP/Apache service, 2 vCPU / 4 GiB by default, request-based autoscaling (scale-to-zero) |
| Database | Cloud SQL for MySQL 8.0 | Required — Mautic does not support PostgreSQL |
| Shared files | Filestore (NFS) | Uploaded media shared across all instances (mounted into the service) |
| Object storage | Cloud Storage | A dedicated media bucket |
| Cache & sessions | Redis | Enabled by default |
| Secrets | Secret Manager | Auto-generated admin password and database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** Selecting PostgreSQL or `NONE` breaks startup.
- **Probes are overridden away from the login page.** Apache issues an HTTP→HTTPS
  301 redirect once `HTTPS=on`/`MAUTIC_SITE_URL` are set, which breaks an HTTP-type
  probe against `/index.php/s/login`. The module overrides the startup probe to
  **TCP** (port-open check, 60s initial delay) and the liveness probe to **HTTP
  `/healthz`** (a static file Apache serves without a redirect, 120s initial delay).
- **`HTTPS=on` and a predicted service URL are injected** so Mautic generates correct
  absolute links and avoids the HTTP→HTTPS redirect loops behind the Cloud Run front
  end (the same redirects the TCP/`/healthz` probe overrides above are designed
  around).
- **Cold-start by default.** `min_instance_count = 0` and `cpu_always_allocated =
  false` (request-based billing): the UI and contact tracking work on-request; the
  marketing commands run as separate scheduled Cloud Run Jobs (§3), so scale-to-zero
  does not stop them.
- **Database migrations run on each instance start** (idempotent), so version upgrades
  apply automatically.
- The Mautic **admin password** is generated and stored in Secret Manager.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Mautic service

Mautic runs as a Cloud Run v2 service that autoscales by request load between the
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

### B. Cloud SQL for MySQL 8.0

Mautic stores all application data in a managed Cloud SQL for MySQL 8.0 instance.
The service connects privately through the **Cloud SQL Auth Proxy** over a Unix
socket (no public IP). On first deploy an initialization Job creates the application
database and user.

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

### C. Filestore (NFS) and Cloud Storage

Uploaded media is written to a **Filestore (NFS)** share mounted into the service so
all instances share the same files. A **Cloud Storage** `media` bucket is also
provisioned, but nothing mounts or writes to it — it is kept only because removing it
from an existing deployment trips a Terraform dependency cycle.

- **Console:** Filestore → Instances; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS mount, GCS Fuse, and CMEK.

### D. Redis cache

Redis backs Mautic's caching and session consistency across instances.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The Mautic admin password and the database password are stored in Secret Manager and
injected into the service at runtime.

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
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Mautic Application Behaviour

- **First-deploy database setup.** An initialization Job creates the Mautic database
  and user before the service starts. It is idempotent.
- **Migrations on start.** Each instance runs Mautic's migrations on startup, so
  upgrading the version applies schema changes automatically.
- **Scheduled commands (essential).** Mautic's campaigns, email queue, and segment
  updates are driven by scheduled commands; without them campaigns never fire and no
  email is sent. Mautic has no in-process scheduler, so they run as scheduled Cloud Run
  Jobs:

  | Command | Purpose | Cadence |
  |---|---|---|
  | `mautic:segments:update` | Refresh segment membership | every 15 min (`:00`, `:15`, …) |
  | `mautic:campaigns:update` | Rebuild campaign membership | every 15 min (`:05`, `:20`, …) |
  | `mautic:campaigns:trigger` | Fire scheduled campaign events | every 15 min (`:10`, `:25`, …) |

  These three are scheduled by the module itself, staggered so they never overlap,
  and run through `mautic-cron.sh` (which maps the database settings the way the web
  container does and waits for the Cloud SQL proxy). Anything else Mautic offers —
  for example `mautic:queue:process` if you queue email, or
  `mautic:maintenance:cleanup` — is added through `cron_jobs`, which is appended to
  the built-in three.

  Inspect the jobs and their executions:
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **HTTPS handling.** `HTTPS=on` and the predicted service URL are set so Mautic
  produces correct absolute URLs and avoids redirect loops behind Cloud Run.
- **Admin login.** The initial admin user name and email are configurable; the
  password is retrieved from Secret Manager (see §2.E).

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Mautic are listed; every other input is
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
| `application_name` | `mautic` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Mautic` | Friendly name shown in the Console. |
| `application_description` | `Mautic - Open-source marketing automation platform` | Service description. |
| `application_version` | `5` | Mautic image version tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance. |
| `memory_limit` | `4Gi` | Memory per instance. |
| `min_instance_count` | `0` | Minimum instances. Scale-to-zero by default; set ≥ 1 (with `cpu_always_allocated = true`) for continuous in-process work. |
| `max_instance_count` | `3` | Maximum instances. |
| `cpu_always_allocated` | `false` | Request-based billing (cold-start). Mautic runs no in-process scheduler; its commands are scheduled Cloud Run Jobs (§3). |
| `container_port` | `80` | Mautic/Apache listens on port 80. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `execution_environment` | `gen2` | Cloud Run execution generation. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |
| `ingress_settings` | `all` | Which networks may reach the service (all / internal / LB-only). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC connector. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core `MAUTIC_*` values are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `explicit_secret_values` | `{}` | Sensitive values to store and inject as secrets. |
| `secret_propagation_delay` / `secret_rotation_period` | _(set)_ | Replication wait / rotation cadence. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Group 9 — NFS Instance & Custom SQL

| Variable | Default | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(set)_ | Existing NFS instance / base name for an inline one. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | off | Run SQL from a GCS bucket after provisioning. |

### Group 10 — Domain, CDN, Cloud Armor & Image Retention

| Variable | Default | Description |
|---|---|---|
| `application_domains` | `[]` | Custom hostnames for the external load balancer. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. |
| `enable_cloud_armor` / `admin_ip_ranges` | off | Attach a WAF policy / restrict privileged access. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for Mautic media. |
| `nfs_mount_path` | `/var/www/html/docroot/media/files` | Mount path inside the container. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(set)_ | Media bucket / additional buckets / GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed — do not change. |
| `application_database_name` | `mautic` | Database name. Immutable after first deploy. |
| `application_database_user` | `mautic` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | _(set)_ | Names under which connection details are injected. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in database setup job. |
| `cron_jobs` | `[]` | Extra scheduled jobs, appended to the three Mautic commands the module schedules itself (§3). |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | Overridden to TCP (port-open check), 60s initial delay | Startup probe — TCP avoids the Apache HTTP→HTTPS 301 that breaks an HTTP probe. |
| `liveness_probe` / `health_check_config` | Overridden to HTTP `/healthz`, 120s initial delay | Liveness probe — `/healthz` is a static file served without a redirect. |
| `uptime_check_config` | disabled (`enabled = false`, path `/`) | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Use Redis for caching/sessions. |
| `redis_host` | `""` | Redis endpoint. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

### Group 23 — Mautic Application Settings

| Variable | Default | Description |
|---|---|---|
| `mautic_admin_username` | `admin` | Initial administrator login. |
| `mautic_admin_email` | `admin@example.com` | Admin email — **set to a real address**. |
| `mailer_from_name` | `Mautic` | Display name on outbound campaign email. |
| `mailer_from_email` | `mautic@example.com` | From address — **use a domain with valid SPF/DKIM**. |

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
| `database_type` | `MYSQL_8_0` | Critical | Mautic requires MySQL; PostgreSQL/`NONE` breaks startup. |
| Built-in scheduled commands (§3) | leave in place | Critical | No campaigns fire without them; add email-queue processing via `cron_jobs` if you queue email. |
| `enable_nfs` | `true` | Critical | Without shared storage, uploads are lost between instances/restarts. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `startup_probe` | TCP, not HTTP (module default) | High | An HTTP probe against `/index.php/s/login` fails: Apache 301-redirects Cloud Run's plain-HTTP health checks once `HTTPS=on` is set, so the probe never sees a 200. The module overrides `startup_probe` to TCP and `liveness_probe` to HTTP `/healthz` to avoid this. |
| `enable_redis` | `true` | High | Multiple instances with isolated caches cause inconsistency. |
| `memory_limit` | ≥ `2Gi` | High | Too little memory causes PHP OOM during imports/sends. |
| `mautic_admin_email` / `mailer_from_email` | real addresses | High | Placeholders send to nowhere and get rejected/spam-filed. |
| `min_instance_count` | `0` (default) or `1` for always-on | Medium | `0` adds cold-start latency on the first request after idle; the scheduled commands run as separate Cloud Run Jobs and are unaffected. |
| `enable_iap` / `enable_cloud_armor` | enable for admin-facing | Medium | The admin UI is otherwise publicly reachable. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Mautic-specific application configuration shared
with the GKE variant is described in **[Mautic_Common](Mautic_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Mautic on Cloud Run](../labs/Mautic_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Mautic on GKE Autopilot](Mautic_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Mautic Common — Shared Application Configuration](Mautic_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Listmonk on Google Cloud Run](Listmonk_CloudRun.md), [Matomo on Google Cloud Run](Matomo_CloudRun.md), [Shlink on Google Cloud Run](Shlink_CloudRun.md), [Mixpost on Google Cloud Run](Mixpost_CloudRun.md) in the **Marketing Automation Suite** solution.
