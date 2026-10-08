---
title: "Cyclos on Google Cloud Run"
description: "Configuration reference for deploying Cyclos on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Cyclos on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Cyclos_CloudRun.png" alt="Cyclos on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cyclos is a feature-rich banking and payment platform used by microfinance institutions,
credit unions, and complementary currency networks. This module deploys Cyclos on **Cloud
Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and
manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Cyclos uses and how to explore and operate them
from the Google Cloud Console and the command line. For the mechanics common to every
Cloud Run application — service identity, ingress and load balancing, scaling and
concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Cyclos costs on RAD, and how that compares

**Cyclos on RAD's Cloud Run module costs about US$76.75 a month in a Google Cloud project you own, plus a one-time 110-credit module fee (US$11).** Cyclos is a banking and payment platform used by microfinance institutions, credit unions and community currency networks. GKE Autopilot suits Cyclos that must stay up, scale across pods, or run beside other Kubernetes workloads; for the lowest cost, this Cloud Run module is usually the right pick — see the [GKE guide](Cyclos_GKE.md) if you need the other.

If Cyclos is only needed occasionally — a demo, a trial, a seasonal or study workload — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that US$76.75 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 110 credits (US$11 at the top-up price) | 99 credits (10% lower) |
| Build time | A few credits per build (roughly 3–6) | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$76.75 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **34 credits a day**, about 1020 a month (about US$102 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, less on a plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (warm) | US$19.72 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$76.75** |

### How it compares

- Run it yourself and a VPS running Cyclos and PostgreSQL yourself — a bigger ask here than for most apps, given the compliance and uptime a banking platform needs costs less in cash: a Hetzner CPX22 or DigitalOcean 2 vCPU/4 GB box is about $24 a month, or a GCP `e2-standard-2` about $49 a month — plus your own time for backups, security patches and upgrades, which RAD's managed Cloud SQL, Secret Manager and monitoring cover for you.
- RAD never claims to be cheaper than bare infrastructure in cash terms — it usually is not. The difference is what RAD manages for you: patching, backups, secrets and monitoring, plus the ability to pause Cyclos for free rather than paying for idle capacity (see below).
- Most of the running cost above is the managed PostgreSQL database (and, where used, the shared file server) — the part a bare VPS comparison has to run and back up by hand.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Cyclos runs in **a project RAD manages for you**, you have a second option that goes well beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to nothing.** This suits Cyclos that you only need occasionally far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google to delete the project. Google does not remove the project immediately: it keeps it, recoverable, for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike deleting one module, this does not tear down Cloud SQL or Cloud Run resources one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's owner can restore it. RAD asks Google to undelete the project and reattaches its billing account, then asks you to run **Update** on each deployment to confirm everything came back. Because nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a rebuild, and an Update never charges the module fee again. That is a handful of credits (under US$1) in total for a typical Cyclos chain, against the 115 credits a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$76.75.** Deploy Cyclos, use it, delete the project. Restore it next time you want it, confirm with Update, and delete it again when you're done. You pay only for the module fee once, the builds, and whatever hours it was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages billing for), and you restore it yourself within the 30 days — after that, Google deletes it for good. Restoring is admitted like creating a new project: your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier most study and demo use fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap: the backup bucket does not survive.** Nightly backups are written to a bucket inside the project, and that bucket is **not** protected by Cloud Storage's soft-delete, so it is very likely gone as soon as you delete the project — even though the project itself is recoverable for 30 days. If you have customised Cyclos and want to keep that work, copy a backup out (to Google Drive, or a bucket outside the project) before you delete. For a default installation with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

Cloud Run keeps a warm instance, so it does not scale fully to zero on its own. The option above only applies to a RAD-managed project; **in your own project, or once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 115 credits (US$11.50) in your own project. Deleting saves money only once Cyclos would otherwise sit unused for about 5 days or more, whether in your own project or a RAD-managed one.
- **Most of the running cost is usually the database.** It stops only when nothing else in the project uses it, so deleting Cyclos while something else shares the project saves only this app's own compute part.
- **Keep your data first.** Nightly backups are written to a bucket inside the deployment and are deleted with it, so copy the latest backup out before deleting if you want to keep it.
- **Note your settings.** RAD does not recreate a deleted deployment for you; you enter the settings again when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either the trainer funds every place, or each participant pays for their own. Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's own fees and daily-credit estimates from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the 30-day recovery window and what it says about Cloud Storage objects without soft delete. Prices change; check each source before relying on a figure.

## 1. Overview

Cyclos runs as a Java/Tomcat container on Cloud Run v2. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Java/Tomcat service, 1 vCPU / 2 GiB by default (raise for production), request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — Cyclos does not support MySQL or SQL Server |
| Object storage | Cloud Storage | A dedicated file-storage bucket (`<prefix>-cyclos-storage`) for uploaded files and media |
| Secrets | Secret Manager | Auto-generated database password; `ROOT_PASSWORD` for superuser extension setup |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** Cyclos requires six specific PostgreSQL extensions
  (`pg_trgm`, `uuid-ossp`, `cube`, `earthdistance`, `postgis`, `unaccent`). MySQL and
  SQL Server are not supported.
- **PostgreSQL extensions are installed automatically** by the `db-init` job before Cyclos
  starts — you do not need to enable them manually.
- **GCS file storage is mandatory.** Cyclos uses Google Cloud Storage as its file content
  manager (`cyclos.storedFileContentManager = gcs`). The bucket name is injected
  automatically.
- **`enable_cloudsql_volume` defaults to `false`.** Cyclos connects to Cloud SQL via
  direct TCP to the private IP, not via the Auth Proxy Unix socket.
- **`max_instance_count` defaults to 1.** Cyclos Community Edition requires Hazelcast
  configuration to scale horizontally. Increase only after configuring clustering.
- **TCP startup probe.** The startup probe uses TCP on port 8080 — not HTTP — because
  Cyclos holds the database lock during its Spring/schema initialisation phase. An HTTP
  probe on `/api` would not pass until Cyclos fully initialises, which during a rolling
  update causes a deadlock with the previous instance. TCP succeeds as soon as Tomcat is
  listening, allowing traffic to shift and the old instance to release the lock.
- **Schema management on startup.** Cyclos creates and migrates its own PostgreSQL schema
  on first boot. First-deploy startup takes 2–5 minutes.
- **Health probes target `/api`.** The liveness probe targets `/api`, which returns HTTP
  200 only once Cyclos is fully initialised.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Cyclos service

Cyclos runs as a Cloud Run v2 service that autoscales by request load between the minimum
and maximum instance counts. Each deployment creates an immutable revision; traffic can be
split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Cyclos stores all application data (accounts, transactions, members) in a managed Cloud
SQL for PostgreSQL 15 instance. The service connects via direct TCP to the Cloud SQL
private IP. On first deploy an initialization Job (run as a Cloud Run Job) creates the
application database, user, and all six required extensions.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=cyclos --database=cyclos --project "$PROJECT"
  # Inside psql — confirm required extensions are installed:
  # \dx
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection
model, backups, and password rotation.

### C. Cloud Storage — file content manager

Cyclos stores all uploaded files, profile photos, and transaction attachments in a
dedicated Cloud Storage bucket provisioned as part of the deployment. The bucket name is
injected automatically as `cyclos.storedFileContentManager.bucketName`. The service
account is granted access automatically.

- **Console:** Cloud Storage → Buckets → look for `<prefix>-cyclos-storage`.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name:cyclos-storage"
  gcloud storage ls gs://<cyclos-storage-bucket>/
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse mounts and CMEK.

### D. Secret Manager

The Cyclos database password and the PostgreSQL superuser (`ROOT_PASSWORD`) are stored in
Secret Manager and injected into the service at runtime. The `db-init` job uses
`ROOT_PASSWORD` to install extensions; Cyclos uses `DB_PASSWORD` to connect at runtime.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load balancer
with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and
VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> \
    --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Cyclos Application Behaviour

- **First-deploy database setup.** The `db-init` job runs as the PostgreSQL superuser and
  idempotently: creates the `cyclos` database user, creates the application database,
  installs all six required extensions (`pg_trgm`, `uuid-ossp`, `cube`, `earthdistance`,
  `postgis`, `unaccent`), and grants the necessary privileges. It is safe to re-run.

  Inspect the job and its executions:
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Schema management on startup.** Cyclos creates and evolves its own PostgreSQL schema
  on startup (`cyclos.db.managed = true`). First-deploy startup takes 2–5 minutes.
- **TCP startup probe.** During a rolling update, the new instance needs to acquire the
  Cyclos database initialisation lock before the old instance releases it. An HTTP probe
  on `/api` would never pass until Cyclos fully initialises, causing a deadlock. The TCP
  startup probe succeeds as soon as Tomcat is listening (~32 seconds), allows the traffic
  shift to the new revision, which sends SIGTERM to the old instance and releases the lock.
  The liveness probe then catches any uninitialised Spring context and triggers a clean
  restart.
- **JVM heap sizing.** Set the `CYCLOS_OPTIONS` environment variable to cap JVM heap —
  for example `{ CYCLOS_OPTIONS = "-Xmx2g" }` for a 4 GiB memory limit. Without this,
  the JVM can consume all available container memory and be OOMKilled.
- **Single-instance default.** Cyclos Community Edition defaults to one instance
  (`max_instance_count = 1`). Increasing without Hazelcast clustering configuration causes
  non-atomic transaction processing and potential data corruption.
- **Email delivery.** Cyclos sends transactional email via SMTP. The module pre-populates
  SMTP placeholder values in `environment_variables` — update them before going live:
  ```bash
  environment_variables = {
    SMTP_HOST  = "smtp.sendgrid.net"
    SMTP_PORT  = "587"
    SMTP_USER  = "apikey"
    SMTP_SSL   = "true"
    EMAIL_FROM = "noreply@yourbank.example.com"
  }
  ```
  Use `secret_environment_variables` for `SMTP_PASSWORD`.
- **Direct TCP database connection.** `DB_HOST` is set to the Cloud SQL private IP address
  (not a socket path). Ensure Private Service Access is configured on the VPC so the Cloud
  Run service can reach the Cloud SQL instance.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Cyclos are listed; every other input is inherited from
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
| `application_name` | `cyclos` | Base name for resources. **Do not change after first deploy.** |
| `display_name` | `Cyclos Community Edition` | Friendly name shown in the Console and monitoring dashboards. |
| `description` | `Cyclos Banking System on Cloud Run` | Service description. |
| `application_version` | `4.16.17` | Cyclos image version tag. Increment to trigger a new revision. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. **Raise to `2000m` for production.** |
| `memory_limit` | `2Gi` | Memory per instance. **Raise to `4Gi` for production.** |
| `min_instance_count` | `1` | Minimum instances. Keep ≥ 1 to avoid slow JVM cold starts. |
| `max_instance_count` | `1` | Maximum instances. Keep `1` unless Hazelcast clustering is configured. |
| `container_port` | `8080` | Cyclos/Tomcat listens on port 8080. |
| `execution_environment` | `gen2` | Cloud Run execution generation. Gen2 required for VPC egress to Cloud SQL private IP. |
| `enable_cloudsql_volume` | `false` | Cyclos uses TCP to Cloud SQL private IP by default; enable only if using Auth Proxy. |
| `traffic_split` | `[]` | Canary/blue-green traffic allocation across revisions. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Which networks may reach the service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic routes through the VPC connector. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | SMTP placeholder map | Pre-populated with SMTP defaults — configure before going live. Core Cyclos vars are injected automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use for `SMTP_PASSWORD`. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. Set `false` after a successful import. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Lifecycle

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDRs exempted from WAF rules. |
| `application_domains` | `[]` | Custom hostnames for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the additional data bucket. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional GCS buckets (the primary `cyclos-storage` bucket is provisioned automatically). |
| `enable_nfs` | `false` | NFS is not used by the Cyclos container (GCS is the file store). |
| `gcs_volumes` | `[]` | GCS Fuse mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `cyclos` | PostgreSQL database name. **Immutable after first deploy.** |
| `db_user` | `cyclos` | Application user. **Immutable after first deploy.** |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (creates extensions, user, and database). |
| `cron_jobs` | `[]` | Recurring Cloud Run Jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | **TCP**, port 8080, 60s delay, 20s period, 15 failures | TCP probe avoids the rolling-update database lock deadlock. |
| `liveness_probe` | HTTP `/api`, 120s delay, 30s period, 3 failures | HTTP probe catches uninitialised Spring context after startup. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

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
| `database_type` | `POSTGRES_15` (hardcoded via Cyclos_Common) | Critical | Cyclos requires PostgreSQL with six extensions. MySQL or `NONE` breaks startup entirely. |
| `db_name` / `db_user` | set once (`cyclos` / `cyclos`) | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all financial data. |
| `max_instance_count` | `1` (default) | Critical | More than 1 without Hazelcast clustering causes non-atomic transactions and potential data corruption. |
| `application_name` | `cyclos` (do not change) | Critical | Embedded in Cloud Run service name, Artifact Registry repo, Secret Manager secrets, and GCS bucket name. Changing orphans all resources. |
| `application_version` | pinned tag (e.g. `4.16.17`) | Critical | Cyclos schema migrations are one-way; deploying a newer version without a tested migration path corrupts the schema. |
| `cyclos.storedFileContentManager` env var | `gcs` (hardcoded) | Critical | Overriding to `local` writes files to ephemeral container storage; all uploads are lost on restart. |
| `memory_limit` | `≥ 2Gi` (`4Gi` recommended) | Critical | JVM throws `OutOfMemoryError`; container is OOMKilled (exit code 137). |
| `CYCLOS_OPTIONS` env var | `-Xmx2g` for 4 GiB limit | Critical | No JVM heap cap: Cyclos consumes all container memory; OOMKilled under load. |
| `startup_probe.type` | `TCP` (default) | High | HTTP probe on `/api` during a rolling update causes a database lock deadlock; the new revision never becomes healthy. |
| `startup_probe.path` (liveness) | `/api` | Critical | Wrong path: probe never sees HTTP 200; Cloud Run kills the revision. |
| `enable_cloudsql_volume` | `false` (default) | High | If Private Service Access is not configured, direct TCP connection to Cloud SQL private IP fails; db-init and app startup both fail. |
| `min_instance_count` | `1` | High | `0` (scale-to-zero) adds 45–120 s JVM cold starts; banking transactions time out. |
| `execution_environment` | `gen2` | High | Gen1 can have routing issues with Cloud SQL private IP via VPC. Always use gen2 for Cyclos. |
| `enable_backup_import` | `false` after restore | High | Leaving `true` re-runs the restore on every apply, overwriting live financial data. |
| `SMTP_HOST` / `EMAIL_FROM` | real server / real address | High | Placeholder defaults deliver no email; password resets and transaction notifications are silently dropped. |
| `enable_iap` / `enable_cloud_armor` | enable for admin-facing | Medium | The Cyclos admin interface is otherwise publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention of financial records. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. Cyclos-specific
application configuration shared with the GKE variant is described in
**[Cyclos_Common](Cyclos_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Cyclos on Cloud Run](../labs/Cyclos_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Cyclos on GKE Autopilot](Cyclos_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Cyclos Common — Shared Application Configuration](Cyclos_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [EspoCRM on Google Cloud Run](EspoCRM_CloudRun.md), [Listmonk on Google Cloud Run](Listmonk_CloudRun.md), [Metabase on Google Cloud Run](Metabase_CloudRun.md), [Vaultwarden on Google Cloud Run](Vaultwarden_CloudRun.md) in the **Financial Inclusion & Community Banking** solution.
