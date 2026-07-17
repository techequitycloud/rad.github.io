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
- **Probes are HTTP against the public login page.** The startup and liveness probes
  target `/index.php/s/login` with generous initial delays (90s / 120s) to allow
  database migrations and PHP initialisation on first boot.
- **`HTTPS=on` and a predicted service URL are injected** so Mautic generates correct
  absolute links and avoids the HTTP→HTTPS redirect loops (which would 301 the HTTP
  probes) behind the Cloud Run front end.
- **Cold-start by default.** `min_instance_count = 0` and `cpu_always_allocated =
  false` (request-based billing): the UI and contact tracking work on-request; the
  marketing cron is externalised as scheduled Cloud Run Jobs (§3). Set
  `cpu_always_allocated = true` and `min_instance_count >= 1` to restore continuous
  in-process operation.
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
all instances share the same files. A dedicated **Cloud Storage** bucket is also
provisioned for media.

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
  email is sent. They run as Cloud Run Jobs invoked on a schedule. The commands:

  | Command | Purpose | Typical cadence |
  |---|---|---|
  | `mautic:segments:update` | Refresh segment membership | every 15 min |
  | `mautic:campaigns:trigger` | Fire scheduled campaign events | every 15 min |
  | `mautic:campaigns:messages` | Send queued campaign messages | every 15 min |
  | `mautic:queue:process` | Process the email send queue | every 5 min |
  | `mautic:maintenance:cleanup` | Purge old data | weekly |

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
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
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
| `cpu_always_allocated` | `false` | Request-based billing (cold-start). Set `true` + `min_instance_count >= 1` to run Mautic's in-process cron continuously. |
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
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
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
| `cron_jobs` | `[]` | **Configure the Mautic scheduled commands in §3** — required for campaigns/email. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/index.php/s/login`, 90s initial delay | Startup probe — generous budget for first-boot migrations and PHP init. |
| `liveness_probe` / `health_check_config` | HTTP `/index.php/s/login`, 120s initial delay | Liveness probe. |
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
| `cron_jobs` | configured (§3) | Critical | No campaigns fire and no email is sent without the scheduled commands. |
| `enable_nfs` | `true` | Critical | Without shared storage, uploads are lost between instances/restarts. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `startup_probe` | HTTP `/index.php/s/login` (default) | High | Without the injected `HTTPS=on`, Apache 301-redirects Cloud Run's plain-HTTP health checks and the probe never sees a 200. |
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
