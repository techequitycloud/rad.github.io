---
title: "OpenEMR on Google Cloud Run"
---

# OpenEMR on Google Cloud Run

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
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
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
| `min_instance_count` | `1` | Minimum instances. Keep ≥ 1 to avoid cold-start delays for clinical users. |
| `max_instance_count` | `1` | Increase only after confirming Redis session sharing is operational. |
| `container_port` | `80` | OpenEMR/Apache listens on port 80. |
| `execution_environment` | `gen2` | **Must remain `gen2`** for NFS volume support. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
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
| `uptime_check_config` | enabled | Cloud Monitoring uptime check. |
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
| `backup_retention_days` | `7` (raise for prod) | Medium | HIPAA-regulated environments should retain at least 90 days. |
| `enable_iap` / `enable_cloud_armor` | enable for healthcare | Medium | The OpenEMR admin interface and patient records are publicly reachable without these controls. |
| `enable_audit_logging` | `true` for HIPAA | Medium | HIPAA requires audit logging of access to PHI. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**.
OpenEMR-specific application configuration shared with the GKE variant is described in
**[OpenEMR_Common](OpenEMR_Common.md)**.
