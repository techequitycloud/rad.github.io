---
title: "OpenEMR on Google Cloud Run"
description: "Configuration reference for deploying OpenEMR on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# OpenEMR on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenEMR_CloudRun.png" alt="OpenEMR on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

OpenEMR is the world's most widely adopted open-source Electronic Health Records (EHR)
and practice management system, used by 100,000+ healthcare providers across 100+
countries. This module deploys OpenEMR on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services OpenEMR uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling and
concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What OpenEMR costs on RAD, and how that compares

**For a small practice, OpenEMR on RAD's Cloud Run module costs about US$181 a month with no per-user licence.** A commercial EHR vendor typically licenses the same functionality per provider per month, with implementation and hosting on top. Figures are as at 8 October 2026; sources are listed at the end of this section.

If you only need it occasionally — studying for a certification, a demo, a seasonal business — a RAD-managed project can be deleted and restored within 30 days for a few credits, so that US$181 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 300 credits (US$30 at the top-up price) | 270 credits (10% lower) |
| Build time | About 19 credits per build (RAD's average build takes about 19 minutes) | The same |
| Google Cloud running cost | Billed by Google to your own billing account (table below) | Metered hourly in credits; RAD publishes **83 credits a day**, about 2,490 credits a month (about US$249 at the top-up price, US$199 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (alwaysOn) | US$110.42 |
| Cloud SQL for MySQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$181** |

- Cloud SQL and Cloud Run cost the same in africa-south1 (Johannesburg); the VM costs about 10% more.
- **This module keeps at least one instance running by default** (`min_instance_count` is at least 1), so the Cloud Run line above does not scale down between requests.
- **Avoid Filestore for a small deployment.** The module uses a small NFS/cache VM by default. Filestore's smallest instance is 1 TiB, which costs about US$164 a month on its own.

### How it compares

- **No verified commercial OpenEMR SaaS is named here.** Most hosted-OpenEMR offerings are small regional resellers without a public, current price list, so this compares against a bare server instead.
- A bare VPS sized close to OpenEMR's own 2 vCPU / 4 GiB footprint — Hetzner CPX22 or a DigitalOcean 2 vCPU/4 GB Droplet, both about US$24/month, or a GCP Compute Engine e2-standard-2 (2 vCPU/8 GB) at about US$49/month — looks cheaper in cash than either RAD figure above.
- The difference is what is managed for you. Patient data sits in Cloud SQL with daily backups and seven days of point-in-time recovery; secrets live in Secret Manager; logs and monitoring come from Google Cloud. On a bare VPS, backups, OS patches, database upgrades and access logging are your own job.
- RAD is not the cheapest option in cash terms — a bare VPS usually is — but for a health-record system, who patches the server and who can see the backups is not a detail worth skipping.
- If OpenEMR needs to stay up without scaling to zero, or run beside other Kubernetes workloads, see the [GKE guide](OpenEMR_GKE.md) instead — about US$150 a month in your own project, or 3,360 credits (about US$269–336) a month in one RAD manages.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If OpenEMR runs in **a project RAD manages for you**, you have a second option that
goes well beyond scaling to zero: **delete the whole project, and restore it within 30
days for close to nothing.** This suits occasional use — studying for a certification,
a demo environment, a seasonal business — far better than running OpenEMR
continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks
  Google to delete the project. Google does not remove the project immediately: it keeps
  it, recoverable, for 30 days. Because billing is already unlinked, nothing is charged
  while it waits. Unlike deleting one module, this does not tear down Cloud SQL, any VM or Cloud Run
  one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's
  owner can restore it. RAD asks Google to undelete the project and reattaches its
  billing account, then asks you to run **Update** on each deployment to confirm
  everything came back. Because nothing was individually destroyed, that Update finds
  the same resources already there — it is a check, not a rebuild, and an Update never
  charges the module fee again. That costs a handful of credits (under US$1) for a
  typical 2–3-deployment chain, against the 305 credits
  (US$30.50) a full redeploy costs below.
- **So a month of occasional use can cost a few dollars, not US$181.**
  Deploy OpenEMR, use it for a while, delete the project. Restore it next time you
  want it, confirm with Update, and delete it again when you're done. You pay only for
  the module fee once, the builds, and whatever time OpenEMR was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only
  manages billing for), and you restore it yourself within the 30 days — after that,
  Google deletes it for good. Restoring is admitted like creating a new project: your
  purchased credit balance must still clear the tier's floor (100 credits for the
  sandbox tier most study and demo use fits). Google says most services are fully
  working again within 36 hours of a restore.
- **One real gap: the backup bucket does not survive.** OpenEMR's backups are written
  to a bucket inside the project, and that bucket is **not** protected by Cloud Storage's
  soft-delete, so it is very likely gone as soon as you delete the project — even though
  the project itself is recoverable for 30 days. If you have made changes to OpenEMR
  you want to keep, copy a backup out (to Google Drive, or a bucket outside the project)
  before you delete, the same as the redeploy workflow below. For a default installation
  with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

Cloud Run already scales to zero between requests. The option above only applies to a RAD-managed project; **in your own project, or once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 305
  credits (US$30.50), because RAD recreates the project and shared
  services before OpenEMR. Deleting saves money only once OpenEMR would otherwise
  sit unused for about 6 days or more, both in your own project (about
  US$6.03 a day) and in a RAD-managed one (83 credits a day).
- **Most of the running cost is usually the database and the shared file/cache VM.**
  They stop only when nothing else in the project uses
  them, so deleting OpenEMR while something else shares the
  project saves only OpenEMR's own compute part.
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

OpenEMR runs as an Apache/PHP 8.3 FPM container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Apache/PHP service, 2 vCPU / 4 GiB by default, request-based autoscaling |
| Database | Cloud SQL for MySQL 8.0 | Required — OpenEMR does not support PostgreSQL |
| Patient documents | Filestore (NFS) | `sites/` directory with patient documents, session cache, and application state shared across all instances (gen2 required) |
| Object storage | Cloud Storage | A general-purpose data bucket |
| Session store | Redis | Enabled by default; falls back to the NFS server IP when no Redis host is given |
| Secrets | Secret Manager | Auto-generated admin password (`OE_PASS`) and database password (`MYSQL_PASS`) |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** Selecting PostgreSQL or `NONE` breaks startup.
- **NFS is mandatory and requires `gen2`.** OpenEMR's `sites/` directory — containing
  `sqlconf.php`, patient documents, Twig/Smarty caches, and uploaded files — must be
  on a shared NFS volume mounted via the Cloud Run gen2 execution environment.
- **The startup probe is TCP, not HTTP.** Cloud Run health traffic arrives over plain
  HTTP. OpenEMR's Apache/PHP stack may not yet be serving HTTP during the first-boot
  installation phase, so an HTTP probe would time out. A TCP probe checks only that
  the port is open and allows the installer to complete.
- **First-boot installation is automated and slow.** On first deploy, two initialization
  jobs run — `nfs-init` (NFS directory setup and optional backup restore) and `db-init`
  (MySQL user and database creation) — after which the container itself runs
  `auto_configure.php` to install the database schema. This can take 5–20 minutes.
- The OpenEMR **admin password** is generated automatically and stored in Secret
  Manager; you never set it in plain text.
- **`min_instance_count` defaults to 1.** Scale-to-zero is not recommended for
  clinical EHR systems — cold starts add latency that clinicians may interpret as a
  system failure.
- **`max_instance_count` defaults to 1.** Increase only after confirming Redis session
  sharing is operational; multiple instances without Redis cause PHP session loss.
- **`cpu_always_allocated` defaults to `true`.** OpenEMR's first-boot setup (Twig cache
  clear, login-page-layout DB check, and a recursive file-permission hardening pass)
  is background work not tied to any single inbound request. Under request-based
  billing (`false`) Cloud Run throttles CPU to near-zero between requests, so that
  one-time setup can take many minutes or effectively never finish — confirmed live:
  the identical boot sequence went from stuck to a fully rendered login page in under
  15s once this was set `true`. Only flip to `false` once you've verified the instance
  is past first boot.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the OpenEMR service

OpenEMR runs as a Cloud Run v2 service. Each deployment creates an immutable revision;
traffic can be split across revisions for staged rollouts. The service requires the
**gen2 execution environment** for NFS volume support.

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

OpenEMR stores all clinical data in a managed Cloud SQL for MySQL 8.0 instance. The
service connects privately through the **Cloud SQL Auth Proxy** over a Unix socket
(no public IP). On first deploy the `db-init` Cloud Run job creates the application
database and user; the `nfs-init` job prepares the NFS `sites/` directory.

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

OpenEMR's `sites/` directory is written to a **Filestore (NFS)** share mounted into
the service at `/var/www/localhost/htdocs/openemr/sites`. This directory contains
`sqlconf.php` (which signals installation completion), patient-uploaded documents,
and Twig/Smarty template caches. All instances must share the same NFS mount. A
general-purpose **Cloud Storage** bucket is also provisioned.

- **Console:** Filestore → Instances; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  # Inspect the nfs-init job execution logs:
  gcloud run jobs executions list --job nfs-init --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS mount, GCS Fuse, and CMEK.

### D. Redis session store

Redis backs OpenEMR's PHP session store. When `redis_host` is left empty and NFS is
enabled, the NFS server's co-located Redis instance is used automatically. In
multi-instance deployments, a shared session store is required to prevent session loss.

- **Console:** Memorystore → Redis (if using a managed Memorystore instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The OpenEMR admin password (`OE_PASS`) and the MySQL database password (`MYSQL_PASS`)
are stored in Secret Manager and injected into the service at runtime. Plaintext never
appears in configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the admin password to log in for the first time:
  gcloud secrets versions access latest \
    --secret=<admin_password_secret_id> --project "$PROJECT"
  ```

The admin password secret ID is exposed as the `admin_password_secret_id` output. See
[App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on top.
Ingress settings and VPC egress control traffic to/from the service.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> \
    --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. OpenEMR Application Behaviour

- **Two initialization jobs run on every deploy.**

  | Job | Purpose | Image |
  |---|---|---|
  | `nfs-init` | Prepares the NFS `sites/` directory structure, sets ownership to UID 1000 (Apache), and optionally restores a backup when `backup_uri` is set | `google-cloud-cli:alpine` |
  | `db-init` | Creates the MySQL database and application user | `mysql:8.0-debian` |

  Inspect the jobs and their executions:
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job nfs-init --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job db-init --project "$PROJECT" --region "$REGION"
  ```

- **First-boot schema installation takes 5–20 minutes.** After the init jobs complete,
  the service container runs `auto_configure.php` to install the OpenEMR database
  schema and create the admin account. During this phase a temporary PHP built-in web
  server serves HTTP 200 on the startup probe path, preventing the instance from being
  killed while the installer runs.

- **Startup probe is TCP.** The Cloud Run startup probe defaults to TCP on port 80 to
  avoid false failures during the first-boot installation phase when Apache/PHP may not
  yet be serving HTTP responses.

- **Version-aware upgrades.** On subsequent deployments the startup script compares
  the image version against the NFS-stored version and runs the appropriate upgrade
  scripts (`fsupgrade-N.sh`) automatically.

- **Admin login.** The initial administrator username is `admin`. The password is
  auto-generated and stored in Secret Manager — retrieve it with:
  ```bash
  gcloud secrets versions access latest \
    --secret=<admin_password_secret_id> --project "$PROJECT"
  ```
  If the admin account is locked after failed login attempts, use the
  `/root/unlock_admin.sh <new_password>` utility from inside the running container.

- **HIPAA considerations.** OpenEMR stores Protected Health Information (PHI). For
  HIPAA-regulated deployments, enable `enable_iap` or `enable_cloud_armor` to restrict
  access, set `enable_audit_logging = true`, and raise `backup_retention_days` to at
  least 90.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for OpenEMR are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `application_name` | `openemr` | Base name for resources. Do not change after first deploy. |
| `display_name` | `OpenEMR` | Friendly name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `7.0.4` | OpenEMR image version tag; increment to deploy a new release. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only without deploying the container. |
| `cpu_limit` | `2000m` | CPU per instance; 2 vCPU recommended for concurrent clinical workloads. |
| `memory_limit` | `4Gi` | Memory per instance; 4 GiB recommended. Below 2 GiB causes OOM kills under clinical load. |
| `cpu_always_allocated` | `true` | Allocate CPU at all times (instance-based billing), not just during requests. OpenEMR's first-boot background setup (Twig cache clear, DB layout check, permission-hardening pass) needs continuous CPU; under request-based billing (`false`) it throttles to near-zero and can hang for many minutes or never complete. |
| `min_instance_count` | `1` | Minimum instances. Keep ≥ 1 to avoid cold-start delays for clinical users. |
| `max_instance_count` | `1` | Increase only after confirming Redis session sharing is operational. |
| `container_port` | `80` | OpenEMR/Apache listens on port 80. |
| `execution_environment` | `gen2` | **Must remain `gen2`** for NFS volume support. |
| `timeout_seconds` | `300` | Max request duration. Increase for report generation or large file uploads. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Which networks may reach the service. Use `internal-and-cloud-load-balancing` for HIPAA deployments fronted by a load balancer. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC connector. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. Recommended for clinical-staff-only access. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core `MYSQL_*` and `OE_*` values are set automatically. Common additions: `PHP_MEMORY_LIMIT`, `SMTP_HOST`, `SMTP_PORT`. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use for sensitive values such as SMTP credentials. |
| `secret_propagation_delay` / `secret_rotation_period` | _(set)_ | Replication wait / rotation cadence. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). **Do not disable for HIPAA-regulated deployments.** |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` | `false` | Restore from a backup on deploy. |
| `backup_source` | `gcs` | Import source: `gcs` or `gdrive`. |
| `backup_uri` | `""` | GCS URI (`gs://bucket/path`) or Google Drive file ID. When set, injected into `nfs-init` as `BACKUP_FILEID`. |
| `backup_format` | `sql` | Backup file format: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, or `zip`. |

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
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `application_domains` | `[]` | Custom hostnames for the HTTPS load balancer. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | **Must remain `true`.** OpenEMR requires NFS for the `sites/` directory. |
| `nfs_mount_path` | `/var/www/localhost/htdocs/openemr/sites` | Mount path. Must match the OpenEMR sites directory. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(set)_ | Data bucket / additional buckets / GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed — do not change. OpenEMR requires MySQL. |
| `db_name` | `openemr` | Database name. Immutable after first deploy. |
| `db_user` | `openemr` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Additional env var names under which connection details are injected. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `nfs-init` / `db-init` sequence. |
| `cron_jobs` | `[]` | Recurring Cloud Run jobs invoked on a schedule. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | **TCP** on port 80, 12 failures × 10s | TCP startup probe. Avoids HTTP probe failures during the first-boot installation phase. |
| `liveness_probe` | HTTP `GET /interface/login/login.php`, 10 failures × 30s | Login page returns HTTP 200 only when the full stack is operational. |
| `uptime_check_config` | disabled | Cloud Monitoring uptime check. Enable explicitly once the service is reachable. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Session Store

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Use Redis for PHP session storage. |
| `redis_host` | `""` | Leave empty to use the NFS server IP; set explicitly for a dedicated Memorystore instance. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter. Requires `organization_id` to be set explicitly. Recommended for HIPAA environments. |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs (DATA_READ, DATA_WRITE). Recommended for HIPAA compliance. |

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
| `admin_password_secret_id` | Secret Manager secret ID for the OpenEMR admin password (`OE_PASS`). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password (`MYSQL_PASS`). |
| `database_host` / `database_port` | DB endpoint / port. |
| `nfs_server_ip` | Internal IP of the NFS server (sensitive). |
| `nfs_instance_tags` | Network tags of the NFS instance. |
| `nfs_mount_path` | NFS mount path inside the container. |
| `nfs_share_path` | NFS share path on the server. |
| `nfs_setup_job` | Name of the NFS setup job. |
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
| `enable_nfs` | `true` | Critical | OpenEMR cannot function without NFS. The `sites/` directory, `sqlconf.php`, and patient documents all live on NFS. Disabling causes immediate startup failure. |
| `nfs_mount_path` | `/var/www/localhost/htdocs/openemr/sites` | Critical | Must match the OpenEMR sites directory path. A mismatch means `nfs-init` prepares the wrong location and the container never finds a configured `sqlconf.php`. |
| `execution_environment` | `gen2` | Critical | `gen1` does not support NFS mounts; the service fails to start. |
| `database_type` | `MYSQL_8_0` | Critical | OpenEMR requires MySQL; PostgreSQL or `NONE` breaks the installer and all PHP database calls. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all patient data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job and can corrupt the NFS sites directory. |
| `backup_schedule` | `0 2 * * *` | Critical | Disabling backups for an EHR containing PHI is a HIPAA compliance violation. |
| `startup_probe` | TCP (default) | High | An HTTP probe fails during the first-boot installation phase when Apache has not yet started fully, causing Cloud Run to restart the container before setup completes. |
| `enable_redis` | `true` | High | Multiple instances with isolated PHP session stores cause session loss and login failures for clinical users. |
| `redis_host` | `""` (NFS) or explicit | High | An unreachable Redis host causes PHP session failures and prevents all logins. |
| `memory_limit` | ≥ `4Gi` | High | OpenEMR PDF generation and billing reports are memory-intensive. Below 2 GiB causes OOM kills mid-request. |
| `min_instance_count` | `1` | High | Scale-to-zero adds cold-start latency and risks missed clinical access. |
| `cpu_always_allocated` | `true` | High | OpenEMR's first-boot setup (Twig cache clear, DB layout check, permission-hardening pass) is background work, not tied to a request. Under request-based billing (`false`) CPU throttles to near-zero between requests, so first boot can take many minutes or effectively never finish — confirmed live: identical boot went from stuck to a rendered login page in &lt;15s once set `true`. |
| `backup_retention_days` | `7` (raise for prod) | Medium | HIPAA-regulated environments should retain at least 90 days. |
| `enable_iap` / `enable_cloud_armor` | enable for healthcare | Medium | The OpenEMR admin interface and patient records are publicly reachable without these controls. |
| `enable_audit_logging` | `true` for HIPAA | Medium | HIPAA requires audit logging of access to PHI. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**.
OpenEMR-specific application configuration shared with the GKE variant is described in
**[OpenEMR_Common](OpenEMR_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: OpenEMR on Cloud Run](../labs/OpenEMR_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [OpenEMR on GKE Autopilot](OpenEMR_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [OpenEMR Common — Shared Application Configuration](OpenEMR_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Cal.com on Google Cloud Run](CalCom_CloudRun.md), [Docuseal on Google Cloud Run](Docuseal_CloudRun.md), [Paperless-ngx on Google Cloud Run](Paperless_CloudRun.md), [Chatwoot on Google Cloud Run](Chatwoot_CloudRun.md) in the **Clinic & Practice Management** solution.
