---
title: "Firefly III on Google Cloud Run"
description: "Configuration reference for deploying Firefly III on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Firefly III on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/FireflyIII_CloudRun.png" alt="Firefly III on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Firefly III is a free, open-source, AGPL-licensed self-hosted personal-finance
manager. It tracks accounts, transactions, budgets, bills, categories, and recurring
transactions, and exposes a full REST API. This module deploys Firefly III on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Firefly III uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load balancing,
scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Firefly III runs as a Laravel/PHP container (Apache) on Cloud Run v2. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | PHP/Apache service, 1 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero supported |
| Database | Cloud SQL for PostgreSQL 15 | Fixed engine — `DB_CONNECTION = pgsql`; MySQL is not used |
| Object storage | Cloud Storage | A dedicated `fireflyiii-uploads` bucket provisioned automatically |
| Persistent files | Filestore (NFS, optional) | Attachments and runtime data mounted at `/var/lib/fireflyiii` |
| Secrets | Secret Manager | Auto-generated Laravel `APP_KEY` and `STATIC_CRON_TOKEN`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; Firefly connects over the Cloud SQL **private IP via TCP** with
  `PGSQL_SSL_MODE = require` (Cloud SQL rejects unencrypted private-IP TCP).
- **`APP_KEY` is generated automatically** and stored in Secret Manager. This Laravel
  key encrypts sensitive fields at rest and **must never be rotated after first boot**
  — rotating it makes previously encrypted data unreadable.
- **`STATIC_CRON_TOKEN` is generated automatically.** Firefly does no background
  scheduling on its own; a caller must hit `GET /api/v1/cron/<STATIC_CRON_TOKEN>` to
  run recurring transactions, bill reminders, and auto-budgets. Wire a Cloud Scheduler
  job to do this daily.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`). Cold starts add
  10–30 seconds of latency to the first request after idle. Set `min_instance_count = 1`
  to keep the service warm.
- **First run is `/register`.** No admin is pre-seeded — the first account created
  becomes the owner/administrator. Disable open registration afterward in
  **Administration → Settings**.
- **NFS is enabled by default** to persist uploaded attachments and runtime data at
  `/var/lib/fireflyiii` across cold starts and revisions; requires the gen2 execution
  environment.
- **Redis is off by default.** Firefly III uses the database for cache and queue; a
  single instance needs no external Redis.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Firefly III service

Firefly III runs as a Cloud Run v2 service that autoscales by request load between the
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

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Firefly III stores all application data (accounts, transactions, budgets, bills,
rules, users) in a managed Cloud SQL for PostgreSQL 15 instance. On Cloud Run the
service connects over the instance **private IP via TCP** with TLS required
(`PGSQL_SSL_MODE = require`); no public IP is exposed. On first deploy an
initialization Job creates the application role and database and grants privileges.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model,
backups, and password rotation.

### C. Cloud Storage & NFS

A dedicated **Cloud Storage** uploads bucket is provisioned automatically. When NFS is
enabled (the default), Firefly III's attachments and runtime directory is mounted from
a Filestore/NFS volume at `/var/lib/fireflyiii` so uploaded files survive cold starts
and new revisions.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse, NFS, and CMEK options.

### D. Secret Manager

Two cryptographic secrets are generated automatically and stored in Secret Manager:
the Laravel `APP_KEY` (encrypts sensitive fields at rest) and the `STATIC_CRON_TOKEN`
(authenticates the cron endpoint). The database password is managed separately by the
foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~app-key OR name~cron-token"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Cron (recurring transactions)

Firefly III runs recurring transactions, bill reminders, and auto-budgets only when a
caller hits its cron endpoint. There is no in-process scheduler.

- Wire a **Cloud Scheduler** job to `GET <service-url>/api/v1/cron/<STATIC_CRON_TOKEN>`
  daily (define it via the `cron_jobs` input or create it in the Console).
- **CLI:**
  ```bash
  # Read the token, then trigger the cron manually to verify:
  TOKEN=$(gcloud secrets versions access latest --secret=<cron-token-secret> --project "$PROJECT")
  curl -s "$SERVICE_URL/api/v1/cron/$TOKEN"
  ```

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

## 3. Firefly III Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It idempotently creates the application role and database and
  grants privileges on the database and `public` schema. The job is safe to re-run.
- **Schema created on container start.** There is **no separate migrate job**. The
  `fireflyiii/core` image runs `php artisan migrate --force` and
  `firefly-iii:upgrade-database` on every boot, so upgrading `application_version`
  applies schema changes automatically once `db-init` has provisioned the database.
- **`APP_KEY` is immutable after first boot.** It is generated once and written to
  Secret Manager. Rotating it makes all previously encrypted fields unreadable. Only
  change it during a planned data-loss-aware migration.
- **First run is `/register`.** No admin credential exists in Secret Manager. Create
  the owner account at `/register`, then disable further registration in
  **Administration → Settings**.
- **Cron endpoint drives recurring items.** Confirm the token and trigger it:
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  curl -s "$SERVICE_URL/api/v1/cron/<STATIC_CRON_TOKEN>"
  ```
- **Health path.** The startup probe is TCP on port 8080 (30s initial delay, 40
  failures allowed); the liveness probe targets Firefly III's unauthenticated
  `/status` JSON endpoint (HTTP 200, no login, 300s initial delay). Allow a
  generous first-boot window while migrations run.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Firefly III are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `fireflyiii` | Base name for resources. Do not change after first deploy. |
| `display_name` | `FireflyIII` | Human-readable name shown in the Console. |
| `application_version` | `latest` | `fireflyiii/core` image tag; pin to a release (e.g. `version-6.1.21`) in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Deploys the official `fireflyiii/core` image directly. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `2Gi` | Memory per instance; 512Mi floor on gen2. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` to avoid cold starts. |
| `max_instance_count` | `1` | Maximum instances. |
| `container_port` | `8080` | Firefly III (Apache) listens on port 8080. |
| `execution_environment` | `gen2` | Gen2 required for NFS/GCS mounts. |
| `enable_cloudsql_volume` | `false` | Cloud Run reaches Cloud SQL over private-IP TCP, not the socket sidecar. |
| `enable_image_mirroring` | `true` | Mirror the image into Artifact Registry. |
| `timeout_seconds` | `300` | Max request duration; raise for large CSV imports. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public `run.app` access. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of Firefly III (recommended for personal finance data). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings (e.g. `MAIL_*`). Core values (`DB_CONNECTION`, `PGSQL_SSL_MODE`, `TRUSTED_PROXIES`, `APP_ENV`, `APP_URL`) are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. `APP_KEY` and `STATIC_CRON_TOKEN` are injected automatically. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

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

### Group 9 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 10 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional buckets beyond the auto-provisioned uploads bucket. |
| `enable_nfs` | `true` | Persist attachments and runtime data at `/var/lib/fireflyiii`. |
| `nfs_mount_path` | `/var/lib/fireflyiii` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed to PostgreSQL 15. |
| `db_name` | `fireflyiii` | Database name, injected as `DB_DATABASE`. Immutable after first deploy. |
| `db_user` | `fireflyiii` | Application user, injected as `DB_USERNAME`. Password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Define a daily Cloud Scheduler → Cloud Run Job hit to `/api/v1/cron/<STATIC_CRON_TOKEN>`. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP port 8080, 30s delay, 40 failures | Startup probe. |
| `liveness_probe` | HTTP `/status`, 300s delay | Liveness probe (unauthenticated 200). |
| `uptime_check_config` | `{ enabled=false, path="/status" }` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Optional cache/session backend; Firefly III uses the database by default. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Redis endpoint and auth. |

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
| `database_host` / `database_port` | DB endpoint (Cloud SQL private IP) / port. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `APP_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it makes all previously encrypted fields unreadable — data is effectively lost. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `PGSQL_SSL_MODE` (auto `require`) | Leave as set | High | Cloud SQL rejects unencrypted private-IP TCP; `disable` breaks the connection. |
| `STATIC_CRON_TOKEN` / cron job | Schedule a daily hit | High | Without a scheduled cron call, recurring transactions, bills, and auto-budgets never fire. |
| `enable_nfs` | `true` | High | Disabling it puts attachments on ephemeral disk — uploaded files vanish on cold start / new revision. |
| `memory_limit` | `2Gi` | High | Below 512Mi is rejected on gen2; low memory OOM-kills PHP during imports. |
| `enable_iap` | enable for private data | High | Firefly III holds financial data; leaving it publicly reachable exposes it to anyone with the URL. |
| First-run registration | Disable after first admin | High | Leaving registration open lets anyone with the URL create an account. |
| `min_instance_count` | `1` for daily use | Medium | Scale-to-zero adds 10–30 s cold-start latency after idle. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_cloud_armor` | enable for production | Medium | The UI and API are publicly reachable without WAF protection. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Firefly III-specific application configuration
shared with the GKE variant is described in **[FireflyIII_Common](FireflyIII_Common.md)**.
