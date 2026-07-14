---
title: "Nextcloud on Google Cloud Run"
description: "Configuration reference for deploying Nextcloud on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Nextcloud on Google Cloud Run

Nextcloud is the leading self-hosted file sync and collaboration platform, trusted by
400 million users across 100,000+ organisations — including governments and healthcare
providers seeking a GDPR-compliant alternative to Google Drive and OneDrive. This module
deploys Nextcloud on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Nextcloud uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling and
concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Nextcloud runs as a PHP/Apache container on Cloud Run v2. The deployment wires together
a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | PHP/Apache service, 2 vCPU / 4 GiB by default, request-based autoscaling |
| Database | Cloud SQL for MySQL 8.0 | Required — Nextcloud does not support PostgreSQL in this deployment |
| Shared files | Filestore (NFS) | `config/` and `data/` directories shared across all instances (gen2 required) |
| Object storage | Cloud Storage | A `nc-data` bucket provisioned per deployment |
| Cache & locking | Redis | Enabled by default; prevents file-locking conflicts across instances |
| Secrets | Secret Manager | Auto-generated admin password; post-install config secrets |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** Selecting PostgreSQL or `NONE` breaks startup.
- **NFS is enabled by default and requires the gen2 execution environment.** All
  instances must share `config.php` and the user data directory. Without NFS, every
  cold start discards files.
- **Redis is enabled by default.** Without a shared cache and lock backend, concurrent
  writes across instances cause "File is locked" HTTP 503 errors.
- **PHP limits are baked into the container image** at build time. Changing
  `php_memory_limit`, `upload_max_filesize`, or `post_max_size` requires a new Cloud
  Build run.
- **The admin password is generated automatically** and stored in Secret Manager; you
  never set it in plain text.
- **First-boot is intentionally slow.** Nextcloud runs `occ maintenance:install`
  synchronously before Apache starts. The startup probe allows up to 10 minutes for
  the first installation to complete.
- **`scale-to-zero` is the default** (`min_instance_count = 0`). For production
  deployments with WebDAV sync clients, set `min_instance_count = 1` to avoid
  cold-start disconnections.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Nextcloud service

Nextcloud runs as a Cloud Run v2 service that autoscales by request load between the
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

Nextcloud stores all application data (files metadata, users, shares, calendar, and
contacts) in a managed Cloud SQL for MySQL 8.0 instance. The service connects privately
through the **Cloud SQL Auth Proxy** over a Unix socket (no public IP). On first deploy
an initialization Job creates the application database and user with `utf8mb4` character
set and collation.

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

Nextcloud data is written to a **Filestore (NFS)** share mounted into every instance.
`entrypoint.sh` symlinks `/var/www/html/config` → `/mnt/nfs/nextcloud-config` and
sets `NEXTCLOUD_DATA_DIR=/mnt/nfs/nextcloud-data` so all instances share the same
`config.php` and user files. A **Cloud Storage** `nc-data` bucket is also provisioned
per deployment.

- **Console:** Filestore → Instances; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<nc-data-bucket>/
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS mount, GCS Fuse, and CMEK.

### D. Redis cache and file locking

Redis backs Nextcloud's distributed cache (`memcache.distributed`) and file locking
(`filelocking.enabled`). With more than one instance this is mandatory — without it,
concurrent writes produce "File is locked" HTTP 503 errors. When no external Redis host
is configured and NFS is enabled, the NFS server IP is used as the default Redis
endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The Nextcloud admin password and four post-installation config secrets (instance ID,
password salt, app secret, and optionally the Redis auth password) are stored in
Secret Manager and injected into the service at runtime. The three config secrets
start as `"UNSET"` placeholder values; the container's post-install hook writes the
real values after `occ maintenance:install` completes.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~nextcloud"
  gcloud secrets versions access latest --secret=<admin-password-secret> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress
settings and VPC egress control connectivity. Custom domains are also added to
Nextcloud's `NEXTCLOUD_TRUSTED_DOMAINS` list automatically.

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

## 3. Nextcloud Application Behaviour

- **First-deploy database setup.** An initialization Job creates the Nextcloud
  database and user with `utf8mb4` character set before the service starts. It is
  idempotent.
- **`occ maintenance:install` on first boot.** On the very first start Nextcloud runs
  its installation routine synchronously before Apache begins serving. This can take
  several minutes on a cold Cloud SQL instance. The startup probe allows up to 10
  minutes (60 s initial delay + 40 failures × 15 s period) for this to complete.
- **Post-install config secrets.** After `occ maintenance:install` completes, a hook
  in the container writes the real `instanceid`, `passwordsalt`, and `secret` values
  to Secret Manager. Subsequent starts read these back to reconstruct `config.php`
  without requiring NFS.
- **PHP upgrade on start.** `NEXTCLOUD_UPDATE=1` is set by default, so Nextcloud runs
  `occ upgrade` automatically on every container start. Set `NEXTCLOUD_UPDATE=0` in
  `environment_variables` and manage upgrades manually when crossing major versions.
- **Trusted domains.** Nextcloud enforces a trusted-domain whitelist. The module seeds
  `NEXTCLOUD_TRUSTED_DOMAINS` from `application_domains`. The Cloud Run service URL is
  resolved at startup by `entrypoint.sh` from `CLOUDRUN_SERVICE_URL` and also added.
  Requests from unlisted hostnames receive an "Access through untrusted domain" error.
- **`OVERWRITEPROTOCOL=https`.** Nextcloud is told it sits behind an HTTPS proxy so
  it generates correct absolute share links and WebDAV URLs.
- **Health path.** Startup and liveness probes target `/status.php`, which returns an
  HTTP 200 with a JSON status object regardless of Nextcloud's setup state — making it
  the canonical health endpoint.
- **Admin login.** The initial admin username is configurable; the password is
  retrieved from Secret Manager (see §2.E).

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Nextcloud are listed; every other input is inherited from
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
| `application_name` | `nextcloud` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Nextcloud` | Friendly name shown in the Console. |
| `description` | `Nextcloud self-hosted collaboration and file sharing platform` | Cloud Run service description. |
| `application_version` | `31` | Nextcloud image version tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance; 2 vCPU recommended. |
| `memory_limit` | `4Gi` | Memory per instance; 4 GiB recommended. |
| `min_instance_count` | `0` | Minimum instances; set to `1` to avoid cold starts for WebDAV clients. |
| `max_instance_count` | `1` | Maximum instances. Requires Redis + NFS when > 1. |
| `container_port` | `80` | Nextcloud/Apache listens on port 80. |
| `execution_environment` | `gen2` | Gen2 required for NFS mounts. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the Nextcloud image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Which networks may reach the service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC connector. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core Nextcloud vars are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
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
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Group 9 — Custom SQL

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDRs exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB; also added to `NEXTCLOUD_TRUSTED_DOMAINS`. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the `nc-data` bucket. |
| `storage_buckets` | `[]` | Additional GCS buckets to provision. |
| `enable_nfs` | `true` | Shared Filestore volume for Nextcloud config and data. **Requires gen2.** |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `nfs_instance_name` / `nfs_instance_base_name` | _(set)_ | Existing NFS instance / base name for an inline one. |
| `gcs_volumes` | `[]` | GCS buckets to mount via GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed — do not change. |
| `db_name` | `nextcloud` | Database name. Immutable after first deploy. |
| `db_user` | `nextcloud` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Additional env var names under which connection details are injected. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Recurring Cloud Run jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `{ path="/status.php", initial_delay_seconds=60, failure_threshold=40 }` | Allows up to ~10 minutes for first-boot `occ maintenance:install`. |
| `liveness_probe` | `{ path="/status.php", initial_delay_seconds=120, failure_threshold=3 }` | Restarts the instance after 3 consecutive failures. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Use Redis for distributed caching and file locking. |
| `redis_host` | `""` | Leave empty to use the NFS server IP; set explicitly when NFS is disabled. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

### Group 23 — Nextcloud Application Settings

| Variable | Default | Description |
|---|---|---|
| `nextcloud_admin_user` | `admin` | Initial administrator username. Change from the default for public-facing deployments. |
| `php_memory_limit` | `512M` | PHP memory limit — baked into the container image at build time. |
| `upload_max_filesize` | `512M` | Maximum upload file size — baked into the image. |
| `post_max_size` | `512M` | PHP POST body limit — must be ≥ `upload_max_filesize`. |

### Group 24 — Email / SMTP

| Variable | Default | Description |
|---|---|---|
| `smtp_host` | `""` | SMTP server hostname. Leave empty to disable email. |
| `smtp_secure` | `""` | Encryption: `ssl`, `tls`, or empty for none. |
| `smtp_port` | `""` | SMTP port; defaults to mode default when empty. |
| `smtp_authtype` | `LOGIN` | Authentication mechanism: `LOGIN`, `PLAIN`, or `NONE`. |
| `smtp_name` | `""` | SMTP login username. |
| `mail_from_address` | `""` | Local part of the From address (before the `@`). |
| `mail_domain` | `""` | Domain part of the From address (after the `@`). |

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
| `database_type` | `MYSQL_8_0` | Critical | Nextcloud requires MySQL; other engines break the init job and startup. |
| `enable_nfs` | `true` | Critical | Without shared storage all user files and `config.php` are lost on each cold start. |
| `enable_cloudsql_volume` | `true` | Critical | Nextcloud connects via Unix socket; removing the sidecar breaks all DB connections. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys data. |
| `application_domains` | include all access hostnames | Critical | Nextcloud blocks requests from unlisted domains with "Access through untrusted domain". |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `execution_environment` | `gen2` | Critical | NFS mounts require gen2; gen1 cannot mount NFS and the service fails to start. |
| `enable_redis` | `true` | High | With > 1 instance, file locks become stale and concurrent writes return HTTP 503. |
| `redis_host` | `""` or explicit IP | High | No valid Redis endpoint when NFS is off and no host is set. |
| `upload_max_filesize` / `post_max_size` | increase for large files | High | Baked into image; files above the limit silently fail. `post_max_size` must be ≥ `upload_max_filesize`. |
| `memory_limit` | `4Gi` | High | Too little memory causes PHP OOM during large uploads or thumbnail generation. |
| `NEXTCLOUD_UPDATE` | `1` (default) or `0` | High | Leaving `1` on a major-version upgrade can corrupt the database. Set to `0` and run `occ upgrade` manually. |
| `min_instance_count` | `1` for WebDAV use | Medium | Scale-to-zero causes cold-start disconnections for desktop sync clients. |
| `max_instance_count > 1` | requires Redis + NFS | High | Multiple instances without Redis cause file-locking errors and possible data corruption. |
| `php_memory_limit` | `512M` (raise for heavy use) | Medium | Baked into image; requires rebuild to change. |
| `nextcloud_admin_user` | change from `admin` | Medium | Default `admin` is a common brute-force target on public deployments. |
| `enable_iap` / `enable_cloud_armor` | enable for admin-facing | Medium | Without these the Nextcloud admin panel is publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**.
Nextcloud-specific application configuration shared with the GKE variant is described
in **[Nextcloud_Common](Nextcloud_Common.md)**.
