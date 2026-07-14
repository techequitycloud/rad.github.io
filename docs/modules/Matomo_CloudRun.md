---
title: "Matomo on Google Cloud Run"
description: "Configuration reference for deploying Matomo on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Matomo on Google Cloud Run

Matomo is the leading open-source web analytics platform — a privacy-focused, self-hosted alternative to Google Analytics used by over a million websites. This module deploys Matomo on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Matomo uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run application — service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Matomo runs as a PHP/Apache container (the official `matomo:5-apache` image) on Cloud Run v2. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | PHP/Apache service, 1 vCPU / 2 GiB by default, request-based autoscaling |
| Database | Cloud SQL for MySQL 8.0 | Required — Matomo supports only MySQL/MariaDB |
| Shared files | Filestore (NFS) | Persists the Matomo document root `/var/www/html` (gen2 required) |
| Object storage | Cloud Storage | A dedicated `matomo-data` bucket provisioned automatically |
| Cache | Redis | Enabled by default; falls back to the NFS host IP when no Redis host is given |
| Secrets | Secret Manager | Database password managed automatically |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** Matomo requires MySQL/MariaDB; PostgreSQL is not supported.
- **The official prebuilt image is deployed directly.** `container_image_source = "prebuilt"` means no Cloud Build step — the `matomo:<application_version>` image is mirrored into Artifact Registry (to avoid Docker Hub rate limits) and deployed as-is.
- **The database connection is TCP over the VPC, not a socket.** `enable_cloudsql_volume = false` by default: the Foundation injects the Cloud SQL instance's private IP as `MATOMO_DATABASE_HOST`, and Matomo's PHP client connects directly over the private network. There is no Auth Proxy socket sidecar.
- **`MATOMO_DATABASE_*` env vars pre-fill the installer.** Host, username, database name, and password are injected by the Foundation; `MATOMO_DATABASE_ADAPTER=mysql` and `MATOMO_DATABASE_TABLES_PREFIX=matomo_` are set by `Matomo_Common`.
- **NFS persists the document root.** `nfs_mount_path` defaults to `/var/www/html`, where Matomo keeps `config.ini.php`, installed plugins, and generated assets. The image entrypoint populates an empty volume from `/usr/src/matomo` on first start.
- **A `db-init` job runs on every apply** to idempotently create the Matomo MySQL database and user.
- **Scale-to-zero by default.** `min_instance_count = 0` and `max_instance_count = 1`; cold starts take 10–30 seconds. Set `min_instance_count = 1` for always-on production.
- The **database password** is generated automatically and stored in Secret Manager. Matomo has no other application secrets.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Matomo service

Matomo runs as a Cloud Run v2 service that autoscales by request load between the minimum and maximum instance counts. Each deployment creates an immutable revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and traffic splitting.

### B. Cloud SQL for MySQL 8.0

Matomo stores all analytics data (visits, reports, users, site configuration) in a managed Cloud SQL for MySQL 8.0 instance. The service connects over the instance's **private IP** across the VPC (no public IP, no proxy socket): the Foundation injects the private IP as `MATOMO_DATABASE_HOST`. On first deploy a `db-init` Job creates the application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model, backups, and password rotation.

### C. Filestore (NFS) and Cloud Storage

Matomo's document root `/var/www/html` — configuration (`config.ini.php`), installed plugins, and generated assets — is written to a **Filestore (NFS)** share mounted into the service so it survives restarts and scale-from-zero. A dedicated **Cloud Storage** bucket (`matomo-data`) is also provisioned automatically. The gen2 execution environment is required for NFS mounts.

- **Console:** Filestore → Instances; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS mount, GCS Fuse, and CMEK.

### D. Redis cache

Redis backs Matomo's object cache, reducing database load and improving page load times. When no external Redis host is configured and NFS is enabled, the NFS host IP is used as the Redis endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The database password is stored in Secret Manager and injected into the service at runtime as `MATOMO_DATABASE_PASSWORD`; plaintext never appears in configuration. Matomo requires no other application secrets.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and VPC egress control connectivity. The tracking snippet you embed in your websites points at this URL (or your custom domain).

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

## 3. Matomo Application Behaviour

- **First-deploy database setup.** A `db-init` Job (image `mysql:8.0-debian`) connects to Cloud SQL — preferring the Auth Proxy Unix socket when mounted, falling back to a TCP connection over the private IP — and idempotently creates the Matomo database, creates the application user, and grants full privileges. It also verifies the application user can connect, which both catches credential problems early and warms MySQL 8's `caching_sha2_password` auth cache so the PHP client's subsequent TCP connections use the fast auth path. The job runs on every apply and is safe to re-run.
- **Web installer completes setup.** The `db-init` job creates only the *empty* database; browsing to the service URL for the first time launches Matomo's web installer, whose database screen is pre-filled from the injected `MATOMO_DATABASE_*` env vars. You create the superuser account and register your first tracked website there.
- **Document-root persistence.** On first start the official image's entrypoint copies the Matomo application from `/usr/src/matomo` into the (empty) NFS volume at `/var/www/html`. All subsequent state — `config.ini.php`, plugins, generated assets — persists there across restarts and version upgrades.
- **Database connection is plain TCP.** With `enable_cloudsql_volume = false`, Matomo's PHP MySQL client connects to the Cloud SQL private IP over the VPC. The `MATOMO_DATABASE_ADAPTER=mysql` and `MATOMO_DATABASE_TABLES_PREFIX=matomo_` env vars are set by `Matomo_Common`.
- **Report archiving.** Out of the box Matomo processes reports on page view (browser-triggered archiving), which suits low-to-medium traffic and the module's scale-to-zero default. For high-traffic sites, schedule `console core:archive` via the `cron_jobs` input so report processing runs as a Cloud Run Job instead of inside visitor requests.
- **Health path.** Startup uses a TCP probe (port-listening) with a generous 20-failure threshold to cover the first-boot copy from `/usr/src/matomo`; liveness targets `/` over HTTP, which returns 200 — or 302 to the installer on a fresh deploy — once Apache and PHP are up.
- **PHP tuning variables are build args.** `php_memory_limit`, `upload_max_filesize`, and `post_max_size` apply only when `container_image_source = "custom"` (they are Docker build args); with the default prebuilt image they have no effect.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for Matomo are listed; every other input is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `application_name` | `matomo` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Matomo` | Friendly name shown in the Console. |
| `application_version` | `5-apache` | Matomo image tag — use an Apache variant tag; increment to roll out a new revision. |
| `php_memory_limit` / `upload_max_filesize` / `post_max_size` | `512M` / `64M` / `64M` | PHP tuning build args — only effective with `container_image_source = "custom"`. |

All other inputs in this group follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Deploys the official Matomo image directly; `custom` builds via Cloud Build. |
| `container_image` | `""` | Leave empty to use `matomo:<application_version>`. |
| `cpu_limit` | `1000m` | CPU per instance; 1 vCPU minimum for Matomo. |
| `memory_limit` | `2Gi` | Memory per instance; 2 GiB recommended for report generation. |
| `min_instance_count` | `0` | Scale-to-zero; set `1` for always-on production. |
| `max_instance_count` | `1` | Keep at 1 unless shared NFS + session affinity are confirmed multi-instance-safe. |
| `container_port` | `80` | Matomo runs on Apache, which listens on port 80. |
| `enable_cloudsql_volume` | `false` | Matomo connects over TCP private IP (`MATOMO_DATABASE_HOST`) — no proxy socket. |
| `execution_environment` | `gen2` | Required for the NFS mount. |
| `enable_image_mirroring` | `true` | Mirror the image into Artifact Registry to avoid Docker Hub rate limits. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. Note: IAP in front of Matomo also blocks the public tracking endpoint. |
| `ingress_settings` | `all` | Which networks may reach the service. Trackers on public websites need `all` (or LB-fronted). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Private-IP traffic (including Cloud SQL) routes via the VPC. |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra plain env vars. `MATOMO_DATABASE_ADAPTER` and `MATOMO_DATABASE_TABLES_PREFIX` are injected automatically; the `MATOMO_DATABASE_HOST/USERNAME/DBNAME/PASSWORD` set comes from the Foundation. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

All other inputs follow standard App_CloudRun behaviour.

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Groups 8–10 — CI/CD, Custom SQL, Domain & Cloud Armor

Standard App_CloudRun behaviour — see [App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`, `enable_cloud_deploy`, `enable_binary_authorization`, `enable_custom_sql_scripts`, `application_domains`, `enable_cdn`, `enable_cloud_armor`.

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for the Matomo document root. Requires gen2. |
| `nfs_mount_path` | `/var/www/html` | Matomo's document root — config, plugins, and assets persist here. |
| `create_cloud_storage` / `storage_buckets` | `[{ name_suffix = "data" }]` | Additional buckets; the `matomo-data` bucket is always provisioned automatically. |

All other inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Matomo requires MySQL — do not change to PostgreSQL. |
| `db_name` | `matomo` | MySQL database name. Immutable after first deploy. |
| `db_user` | `matomo` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Automated DB password rotation. |

All other inputs follow standard App_CloudRun behaviour.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (`mysql:8.0-debian`). |
| `cron_jobs` | `[]` | Recurring jobs — the natural home for a scheduled `console core:archive` on high-traffic sites. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, 30s initial delay, 15s period, 20 failures | Generous threshold for the first-boot document-root copy. |
| `liveness_probe` | HTTP `/`, 300s initial delay, 60s period, 3 failures | Matomo serves 200/302 on `/` once PHP and Apache are up. |
| `uptime_check_config` | disabled, path `/` | Cloud Monitoring uptime check — off by default; enable for production. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Use Redis as Matomo's object cache backend. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS host IP. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter. |
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
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets (includes the `matomo-data` bucket). |
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
| `database_type` | `MYSQL_8_0` | Critical | Matomo supports only MySQL/MariaDB; any other engine breaks the installer. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all analytics data. |
| `enable_nfs` | `true` | Critical | Without the persistent document root, `config.ini.php` and plugins are lost on every restart — Matomo re-enters the installer. |
| `nfs_mount_path` | `/var/www/html` | Critical | Mounting anywhere else leaves the document root on ephemeral disk. |
| `container_port` | `80` | Critical | Apache listens on 80; mismatching it fails all health probes. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `execution_environment` | `gen2` | High | NFS mounts require gen2; gen1 cannot mount Filestore. |
| `enable_cloudsql_volume` | `false` | High | Matomo is wired for TCP via `MATOMO_DATABASE_HOST` (private IP); flipping to the socket without rewiring the host env leaves the installer pointing at an unreachable host. |
| `application_version` | Apache variant tag (e.g. `5-apache`) | High | The fpm/alpine variants have no Apache and don't serve HTTP on port 80. |
| `max_instance_count` | `1` | High | Multiple instances against the same NFS document root are not validated for Matomo session/config safety. |
| `memory_limit` | `2Gi` | High | Too little memory fails PHP report generation and archive processing. |
| `enable_redis` | `true` | Medium | Without an object cache, all cache reads hit MySQL, increasing load. |
| `min_instance_count` | `0` (dev) / `1` (prod) | Medium | `0` adds a 10–30 s cold start for the first tracked pageview after idle. |
| `cron_jobs` (core:archive) | set for high traffic | Medium | Browser-triggered archiving slows visitor-facing requests on busy sites. |
| `enable_iap` | `false` for public trackers | Medium | IAP in front of the service blocks the tracking endpoint your websites call. |
| `uptime_check_config.enabled` | `true` for prod | Low | No external availability signal; failures surface only via user reports. |
| `php_memory_limit` etc. | defaults | Low | Build args only — silently inert with the default prebuilt image. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. Matomo-specific application configuration shared with the GKE variant is described in **[Matomo_Common](Matomo_Common.md)**.
