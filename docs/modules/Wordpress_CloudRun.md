---
title: "WordPress on Google Cloud Run"
---

# WordPress on Google Cloud Run

WordPress is the world's most popular content management system, powering over 43% of all websites globally. This module deploys WordPress on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services WordPress uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run application — service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

WordPress runs as a PHP/Apache container on Cloud Run v2. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | PHP/Apache service, 1 vCPU / 2 GiB by default, request-based autoscaling |
| Database | Cloud SQL for MySQL 8.0 | Required — WordPress does not support PostgreSQL |
| Shared files | Filestore (NFS) | `wp-content` directory (uploads, plugins, themes) shared across all instances |
| Object storage | Cloud Storage | A dedicated `wp-uploads` media bucket |
| Cache | Redis | Optional object cache; enabled by default to reduce database load |
| Secrets | Secret Manager | Auto-generated database password and eight WordPress authentication keys and salts |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** Selecting PostgreSQL or `NONE` breaks startup.
- **NFS is required for a functional site.** WordPress stores uploaded media, installed plugins, and active themes under `wp-content/`. Without a shared NFS volume, each Cloud Run revision wipes all plugins, themes, and uploads — making WordPress on Cloud Run non-functional for any real site.
- **The startup probe is TCP, not HTTP.** WordPress may not yet respond to HTTP requests during database initialisation on first boot; a TCP probe only checks that Apache's port is open.
- **`WP_HOME` and `WP_SITEURL` are auto-set** from the predicted Cloud Run service URL (`CLOUDRUN_SERVICE_URL`), so WordPress generates correct absolute links and avoids redirect loops.
- **Database migrations run on each instance start** via the `db-init` job; version upgrades apply schema changes automatically.
- The WordPress **authentication keys and salts** are auto-generated and stored in Secret Manager; you never set them in plain text.
- **Cloud Run gen2 is required** for NFS volume mounts.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the WordPress service

WordPress runs as a Cloud Run v2 service that autoscales by request load between the minimum and maximum instance counts. Each deployment creates an immutable revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and traffic splitting.

### B. Cloud SQL for MySQL 8.0

WordPress stores all site data (posts, users, settings, comments) in a managed Cloud SQL for MySQL 8.0 instance. The service connects privately through the **Cloud SQL Auth Proxy** over a Unix socket (no public IP). On first deploy an initialisation Job creates the application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model, backups, and password rotation.

### C. Filestore (NFS) and Cloud Storage

WordPress's `wp-content` directory is mapped onto a **Filestore (NFS)** share mounted into the service so all instances share the same plugins, themes, and uploaded media. A dedicated **Cloud Storage** bucket (`wp-uploads`) is also provisioned for media assets.

- **Console:** Filestore → Instances; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS mount, GCS Fuse, and CMEK.

### D. Redis object cache

Redis backs WordPress's object cache via the **WP Redis** plugin, storing the results of expensive database queries in memory. When `redis_host` is left empty and NFS is enabled, the NFS server IP is used as the Redis endpoint (the default shared deployment model).

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The WordPress database password and the eight WordPress authentication keys and salts are stored in Secret Manager and injected into the service at runtime; plaintext values never appear in Terraform state.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # List all secrets belonging to this deployment:
  gcloud secrets list --project "$PROJECT" --filter="name~<resource-prefix>"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. WordPress Application Behaviour

- **First-deploy database setup.** An initialisation Job using the `mysql:8.0-debian` image creates the WordPress database and user before the service starts. It runs on every `tofu apply` because it is idempotent — it safely skips steps that are already complete.
- **Authentication keys and salts.** Eight 64-character WordPress security secrets (auth key, secure auth key, logged-in key, nonce key, and their corresponding salts) are generated automatically on first deploy and stored in Secret Manager. Rotating these secrets immediately invalidates all active browser sessions — every logged-in user will be signed out.
- **Site URL auto-resolution.** `CLOUDRUN_SERVICE_URL` is always injected by the foundation with the correct Cloud Run URL. `wp-config-docker.php` reads this to set `WP_HOME` and `WP_SITEURL` so WordPress generates correct absolute links and avoids redirect loops behind Cloud Run.
- **PHP configuration baked at build time.** `php_memory_limit`, `upload_max_filesize`, and `post_max_size` are applied to the container image at Cloud Build time. Changing them triggers a new image build and revision.
- **Health probe design.** The TCP startup probe confirms Apache is listening before HTTP checks begin; the high `failure_threshold` (20 × 15 s = 300 s) accommodates the `db-init` job and WordPress's initialisation phase. The liveness probe polls `/wp-admin/install.php` — which returns HTTP 200 whether WordPress is freshly installed or already configured — with a 300-second initial delay.
- **WordPress scheduled tasks.** Cloud Run is invoked on-demand, so `wp-cron` pseudo-cron may not fire on schedule if there is no traffic. For reliable scheduled execution, disable `wp-cron` via `environment_variables` and configure a `cron_jobs` entry:

  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for WordPress are listed; every other input is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `application_name` | `wordpress` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Wordpress` | Friendly name shown in the Console. Note: this module uses `display_name` (not `application_display_name`). |
| `description` | `Wordpress CMS on Cloud Run` | Service description. |
| `application_version` | `latest` | WordPress image version tag. Use a pinned version (e.g. `6.7.1`) in production. |
| `php_memory_limit` | `512M` | PHP `memory_limit` baked at build time. Increase for heavy plugin workloads. |
| `upload_max_filesize` | `64M` | Maximum size of a single file upload. Must be ≤ `post_max_size`. |
| `post_max_size` | `64M` | Maximum size of all POST data. Must be ≥ `upload_max_filesize`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `2Gi` | Memory per instance; 2 GiB recommended for WordPress with plugins. |
| `min_instance_count` | `0` | Minimum instances (scale-to-zero by default). Set to `1` to eliminate cold starts. |
| `max_instance_count` | `1` | Maximum instances. Increase only after verifying all plugins handle concurrent access correctly and NFS is enabled. |
| `container_port` | `80` | WordPress/Apache listens on port 80. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. Required. |
| `execution_environment` | `gen2` | Cloud Run gen2 is required for NFS mounts. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | How many old revisions to keep. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |
| `ingress_settings` | `all` | Which networks may reach the service. Consider `internal-and-cloud-load-balancing` when using Cloud Armor. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC connector. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `WORDPRESS_TABLE_PREFIX`, `WORDPRESS_DEBUG`, and Redis vars are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Eight WordPress auth secrets are injected automatically. |
| `secret_propagation_delay` / `secret_rotation_period` | _(set)_ | Replication wait / rotation cadence. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. Note: this module uses `backup_uri` (full GCS URI or Drive file ID). |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Domain, CDN, Cloud Armor & Image Retention

| Variable | Default | Description |
|---|---|---|
| `application_domains` | `[]` | Custom hostnames for the external load balancer. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. Requires `enable_cloud_armor = true`. |
| `enable_cloud_armor` / `admin_ip_ranges` | off | Attach a WAF policy / restrict privileged access. Strongly recommended for public WordPress sites. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for WordPress `wp-content` (keep enabled). |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. The startup script symlinks `wp-content` here. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(set)_ | Media bucket / additional buckets / GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed — do not change. WordPress requires MySQL. |
| `db_name` | `wp` | Database name. **Immutable after first deploy.** Note: this module uses `db_name` (not `application_database_name`). |
| `db_user` | `wp` | Application user. **Immutable after first deploy.** Note: this module uses `db_user` (not `application_database_user`). |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Additional env var names for connection details. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Recurring Cloud Run Jobs. Use to replace `wp-cron` for reliable scheduled task execution. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, 30s delay, threshold 20 | TCP startup probe — avoids HTTP failures during database initialisation. Do not reduce `failure_threshold` below 10. |
| `liveness_probe` | HTTP `/wp-admin/install.php`, 300s delay | 300-second initial delay accommodates first-boot database setup. |
| `uptime_check_config` | enabled | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Use Redis for WordPress object caching. |
| `redis_host` | `""` | Leave empty to use the NFS server IP; set explicitly for a dedicated Memorystore instance. |
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

Returned on a successful deployment — the quickest way to locate and explore the running resources.

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
| `database_host` / `database_port` | DB endpoint / port (sensitive). |
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
| `database_type` | `MYSQL_8_0` | Critical | WordPress requires MySQL; PostgreSQL/`NONE` breaks startup. |
| `enable_nfs` | `true` | Critical | Without NFS, every new Cloud Run revision wipes all plugins, themes, and media uploads — WordPress is non-functional for any real site. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all WordPress data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `execution_environment` | `gen2` | High | NFS mounts require Cloud Run gen2; switching to gen1 causes a volume mount error and service startup failure. |
| `container_image_source` | `custom` | High | The custom WordPress image wires the NFS symlink and Cloud SQL socket. Using `prebuilt` with the vanilla WordPress image breaks Cloud SQL socket connectivity. |
| `nfs_mount_path` | `/mnt/nfs` (do not change after deploy) | High | The startup script symlinks `wp-content` to this path; changing it after deployment breaks the symlink. |
| `startup_probe` | TCP (default) | High | An HTTP probe may fail during first-boot database initialisation. Do not reduce `failure_threshold` below 10. |
| `memory_limit` | `2Gi` | High | WordPress with popular plugins (WooCommerce, Elementor) requires at least 2 GiB; insufficient memory causes PHP fatal errors. |
| `enable_redis` | `true` | Medium | Multiple instances with isolated in-memory caches cause redundant database queries. |
| `redis_host` | `""` (NFS IP) or explicit | High | No valid Redis endpoint if Redis is on, NFS is off, and no host is set. |
| `enable_cloud_armor` | enable for public sites | High | WordPress login pages (`/wp-login.php`, `xmlrpc.php`) are prime brute-force targets. |
| `php_memory_limit` | `512M` | Medium | Must be within `memory_limit`; setting it higher than the container limit causes an OOM kill instead of a PHP error. |
| `min_instance_count` | `1` | Medium | `0` causes cold-start delays and may cause visible errors for the first visitor after idle. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for e-commerce or content-heavy sites. |
| `enable_iap` / `enable_cloud_armor` | enable for admin access | Medium | The WordPress admin panel is otherwise publicly reachable. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. WordPress-specific application configuration shared
with the GKE variant is described in **[Wordpress_Common](Wordpress_Common.md)**.
