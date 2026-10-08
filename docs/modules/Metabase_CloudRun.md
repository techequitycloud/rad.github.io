---
title: "Metabase on Google Cloud Run"
description: "Configuration reference for deploying Metabase on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Metabase on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Metabase_CloudRun.png" alt="Metabase on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Metabase is an open-source business intelligence and analytics platform that lets
non-technical users query, visualise, and share data without writing SQL. This
module deploys Metabase on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Metabase uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Metabase costs on RAD, and how that compares

**Running Metabase in your own GCP project costs about $88.56/month in Google Cloud charges; RAD's module fee is a one-time 75 credits (or 67.5 credits in a RAD-managed project), covering setup and support -- not the ongoing cloud bill, which Google bills you directly in your own project or RAD meters hourly in credits in a RAD-managed one.**
Or see the GKE guide for the alternative deployment target; either way, if you deploy into a RAD-managed project you can pause the whole thing for free when you are not using it -- see [Pause it for free](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) below.

### What you pay on RAD

| | Your own project | RAD-managed project |
|---|---|---|
| Module fee | 75 credits, once | 67.5 credits, once (10% lower) |
| Build time | metered in credits as the build runs (a few credits, typically) | same |
| Google Cloud running cost | ~$88.56/month, billed to your own billing account at Google's list price | ~26 credits/day, metered hourly by RAD at list price plus margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (scaleToZero) | $31.53 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | $51.02 |
| Cloud NAT and networking | $5.00 |
| Cloud Storage (add-ons, backups) | $1.00 |
| **Total** | **$88.56** |

### How it compares

- Metabase's own official managed cloud (Metabase Cloud) starts at **$90/month** (Starter, billed monthly; $100/month list) (source: https://www.metabase.com/pricing), run by the project itself with no infrastructure to operate -- the comparison that matters here is less the sticker price and more whether you want the vendor's own cloud or your own GCP project with RAD managing it.
- Running it yourself on a bare VPS is still the cheapest cash option -- Hetzner CPX22 (2 vCPU/4GB) runs about **$24/month**, a DigitalOcean 2 vCPU/4GB Droplet is also **$24/month**, and a GCP Compute Engine e2-standard-2 (2 vCPU/8GB) is about **$49/month** -- plus the admin's own time for backups, security patches and upgrades, which RAD's managed Cloud SQL, Secret Manager and monitoring cover for you -- but RAD's price is never meant to beat a VPS, only to replace the admin time a VPS still needs.
- Either way, this is a team BI/analytics tool queried occasionally rather than continuously, so the running cost above is what actually drives the bill, not the module fee -- and that running cost is the one you can pause (see below).

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

In your own project (or once you are past the 30-day restore window above), the alternative is
to delete Metabase outright and redeploy it later. A redeploy costs the module fee again, plus
the builds -- roughly 75 + 3-6 credits of build time.

Deleting saves money only once Metabase would otherwise sit unused long enough to clear that
redeploy cost against its own daily running cost -- against the own-project total above, that
works out to about 3 days or more. Most of the running cost here is usually the database; it stops only when nothing else in the project uses it, so deleting this app while something else shares the project saves only this app's own compute part.

**Keep data first:** nightly backups go to a bucket inside the deployment and are deleted with
it, so copy the latest backup out before deleting if you want to keep it.

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

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; radmodules.dev/pricing for RAD's own fees and daily-credit estimates; https://cloud.google.com/resource-manager/docs/delete-restore-projects for the pause/restore mechanics; https://www.metabase.com/pricing for the named competitor's price.

## 1. Overview

Metabase runs as a Java/JVM (Jetty) container on Cloud Run v2. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | JVM service, 2 vCPU / 4 GiB by default, request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — Metabase stores all application state (questions, dashboards, users) in PostgreSQL |
| Secrets | Secret Manager | Auto-generated database password; Metabase manages its own internal keys |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is the only supported engine.** All application state lives in
  this database.
- **No Redis is required.** Metabase does not use Redis; `enable_redis` defaults
  to `false`.
- **`min_instance_count` defaults to `0` (scale-to-zero).** JVM cold starts take
  60–120 seconds. Set to `1` for production to eliminate this latency.
- **`cpu_always_allocated` defaults to `false` (request-based billing).** Metabase
  serves interactive queries on request, so CPU is billed only while handling a
  call. If you rely on **scheduled subscriptions/pulses or periodic DB-sync
  scans**, that work runs with no inbound request and gets throttled under
  request-based billing — set `cpu_always_allocated = true` so scheduled jobs
  actually complete.
- **Health probes target `/api/health`** (HTTP), which returns 200 only once the
  JVM is fully up. The startup probe uses a 120-second initial delay with 15
  retries, giving ~270 seconds total tolerance.
- **`MB_JETTY_PORT = "3000"` and `JAVA_TIMEZONE = "UTC"` are injected
  automatically** — do not override them.
- **No GCS storage bucket is created by default.** Metabase stores everything in
  PostgreSQL.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Metabase service

Metabase runs as a Cloud Run v2 service that autoscales by request load between
the minimum and maximum instance counts. Each deployment creates an immutable
revision; traffic can be split across revisions for safe rollouts. With
`min_instance_count = 0` the service scales to zero when idle; JVM cold starts
take 60–120 seconds, so set `min_instance_count = 1` for production.

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

Metabase stores its entire application state — questions, dashboards, collections,
users, permissions, and settings — in a managed Cloud SQL for PostgreSQL 15
instance. The service connects privately through the **Cloud SQL Auth Proxy** over
a Unix socket (no public IP). On first deploy an initialization Job creates the
application database and user.

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

### C. Secret Manager

The database password is stored in Secret Manager and injected into the service at
runtime. Metabase manages its own internal encryption keys separately.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on;
ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs (including JVM output) flow to Cloud Logging; Cloud Run and Cloud
SQL metrics flow to Cloud Monitoring, with optional uptime checks and alert
policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Metabase Application Behaviour

- **First-deploy database setup.** An initialization Job runs before the service
  starts. It uses `postgres:15-alpine` to connect to Cloud SQL and idempotently
  create the application database and user. It is safe to re-run.
- **No auto-migration on startup.** Metabase applies migrations as part of its
  own startup process — the `db-init` job must succeed first so the database and
  user already exist when Metabase boots.
- **Upgrade caution.** Metabase migrations are one-way. Downgrading after a
  migration has run corrupts the schema. Always test upgrades in staging before
  applying to production.
- **Health path.** Startup and liveness probes target `/api/health` (HTTP 200
  when the JVM is fully initialised). The startup probe allows a 120-second
  initial delay plus 15 × 10s retries (~270 seconds total). Do not reduce these
  values.
- **Admin setup.** On first boot Metabase presents a setup wizard in the browser.
  Admin credentials are managed inside Metabase itself — no admin secret is
  created by this module.
- **Data sources.** After deployment, configure data sources in Metabase Admin →
  Databases. Common GCP-native sources include BigQuery, Cloud SQL
  PostgreSQL/MySQL, and Google Sheets.
- **`MB_JETTY_PORT` and `JAVA_TIMEZONE` are fixed.** Injected automatically by
  `Metabase_Common`. Overriding them breaks routing or produces inconsistent
  report timestamps.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Metabase are listed; every other input is
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
| `application_name` | `metabase` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Metabase Analytics` | Friendly name shown in the Console. |
| `description` | `Metabase — open-source business intelligence and analytics platform` | Service description. |
| `application_version` | `v0.51.3` | Metabase image version tag. **Never downgrade** — migrations are irreversible. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance; minimum 1 vCPU, 2 vCPU recommended. |
| `memory_limit` | `4Gi` | Memory per instance; JVM requires at least 2 GiB; 4 GiB recommended for production. |
| `min_instance_count` | `0` | Minimum instances. Set to `1` for production to eliminate 60–120s JVM cold starts. |
| `max_instance_count` | `3` | Maximum instances (cost ceiling). |
| `cpu_always_allocated` | `false` | Request-based billing by default — Metabase serves on request. Set `true` if you rely on scheduled subscriptions/pulses or periodic DB-sync scans, which run with no inbound request and would otherwise be throttled. |
| `container_port` | `3000` | Metabase's Jetty port — must match `MB_JETTY_PORT`. |
| `execution_environment` | `gen2` | Gen2 recommended for improved startup performance. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for Unix socket connections. Required. |
| `timeout_seconds` | `300` | Max request duration; increase for long-running analytical queries. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Which networks may reach the service. Use `internal-and-cloud-load-balancing` for production. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. Recommended for internal deployments. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `MB_JETTY_PORT` and `JAVA_TIMEZONE` are injected automatically — do not override. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g., SMTP password). |
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
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts & NFS

| Variable | Default | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | off | Run SQL from a GCS bucket after provisioning. See [App_CloudRun](App_CloudRun.md). |
| `nfs_instance_name` / `nfs_instance_base_name` | _(set)_ | NFS storage — not required for Metabase. |

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
| `create_cloud_storage` | `true` | Provision GCS buckets when `storage_buckets` is non-empty. |
| `storage_buckets` | `[]` | Empty by default — Metabase does not require object storage. |
| `enable_nfs` | `false` | NFS storage is not required for Metabase. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — do not change. Metabase requires PostgreSQL. |
| `db_name` | `metabase` | Database name. Immutable after first deploy. |
| `db_user` | `metabase` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (PostgreSQL database + user creation). |
| `cron_jobs` | `[]` | Recurring jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `/api/health`, initial delay 120s, failure threshold 15 | HTTP startup probe; total tolerance ~270s for JVM. Do not reduce. |
| `liveness_probe` | `/api/health`, initial delay 120s, failure threshold 3 | Liveness probe. |
| `uptime_check_config` | disabled, `/api/health` | Cloud Monitoring uptime check. Enable for production monitoring. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Metabase does not use Redis; leave disabled. |
| `redis_host` / `redis_port` / `redis_auth` | _(set)_ | Only relevant if a plugin or custom configuration requires Redis. |

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
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets (empty by default). |
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
| `database_type` | `POSTGRES_15` | Critical | Metabase requires PostgreSQL; any other engine breaks startup. |
| `enable_cloudsql_volume` | `true` | Critical | Disabling breaks all database connections (Auth Proxy sidecar required). |
| `memory_limit` | `4Gi` | Critical | Under 2 GiB the JVM crashes with OutOfMemoryError on startup. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all application data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `application_version` | increment carefully | Critical | Metabase migrations are one-way; downgrading corrupts the schema. |
| `startup_probe.failure_threshold` | `15` (≥ 15) | High | Reducing causes premature container kills before the JVM completes startup. |
| `min_instance_count` | `1` for production | High | `0` causes 60–120s cold starts; startup probe failures on first request. |
| `cpu_limit` | `2000m` | High | Under 500m JVM JIT compilation stalls startup, triggering probe failures. |
| `cpu_always_allocated` | `true` if using scheduled subscriptions/pulses/DB-sync scans | Medium | Defaults `false` (request-based billing); scheduled subscriptions/pulses/DB-sync scans run with no inbound request and are throttled to near-zero CPU, so they may not complete unless flipped to `true`. |
| `enable_iap` / `ingress_settings` | IAP on; `internal-and-cloud-load-balancing` | High | Metabase login page is otherwise publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `timeout_seconds` | `300` | Medium | Reducing below 120s aborts in-flight analytical queries. |
| `enable_auto_password_rotation` | `false` | Medium | Enabling without sufficient `rotation_propagation_delay_sec` causes brief 500 errors during rotation. |
| `enable_redis` | `false` | Low | Metabase does not use Redis; enabling has no effect. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Metabase-specific application configuration
shared with the GKE variant is described in
**[Metabase_Common](Metabase_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Metabase on Cloud Run](../labs/Metabase_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Metabase on GKE Autopilot](Metabase_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Metabase Common — Shared Application Configuration](Metabase_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Odoo on Cloud Run](Odoo_CloudRun.md), [Paperless-ngx on Google Cloud Run](Paperless_CloudRun.md), [OnlyOffice on Google Cloud Run](OnlyOffice_CloudRun.md), [Passbolt on Google Cloud Run](Passbolt_CloudRun.md) in the **Integrated ERP Platform** solution.
