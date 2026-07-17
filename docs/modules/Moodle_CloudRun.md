---
title: "Moodle on Google Cloud Run"
description: "Configuration reference for deploying Moodle on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Moodle on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Moodle_CloudRun.png" alt="Moodle on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Moodle is the world's most popular open-source Learning Management System (LMS),
used by universities, schools, corporations, and online training providers worldwide.
This module deploys Moodle on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Moodle uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Moodle runs as a PHP 8.3/Apache container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | PHP 8.3/Apache service, 1 vCPU / 2 GiB by default, request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — Moodle does not support MySQL in this deployment |
| Shared files | Filestore (NFS) | Moodle `moodledata` directory shared across all instances; mandatory |
| Object storage | Cloud Storage | A data bucket and any additional user-defined buckets |
| Cache & sessions | Redis | Enabled by default; required for multi-instance PHP session consistency |
| Secrets | Secret Manager | Auto-generated cron password, SMTP password, and database password |
| Scheduler | Cloud Scheduler | Auto-provisioned cron job (every minute) against `/admin/cron.php` |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed and `MOODLE_DB_TYPE =
  "pgsql"` is hardcoded; selecting MySQL or `NONE` breaks startup.
- **NFS is mandatory.** The Moodle `moodledata` directory must be a shared writable
  filesystem accessible across all instances. `enable_nfs` defaults to `true` and
  requires `execution_environment = "gen2"`.
- **The startup probe is HTTP targeting `/health.php`.** Unlike some PHP applications
  that issue HTTP→HTTPS redirects, Apache in this deployment binds on port 8080
  without redirect, so an HTTP probe against `/health.php` returns 200 directly.
- **Redis is enabled by default.** Without a shared session store, users are logged
  out when a request reaches a different Cloud Run instance.
- **A Cloud Scheduler job is auto-provisioned.** It fires every minute to
  `/admin/cron.php` using a secure, auto-generated cron password stored in Secret
  Manager.
- The **cron password** and **SMTP password** are generated automatically and stored
  in Secret Manager; you never set them in plain text.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Moodle service

Moodle runs as a stateless Cloud Run v2 service. Request-based autoscaling adds
instances under load and, with `min_instance_count = 0`, scales to zero between
sessions (development) or keeps a warm instance when set to `1` (production).

- **Console:** Cloud Run → select the Moodle service for logs, revisions, metrics,
  and configuration.
- **CLI:**
  ```bash
  gcloud run services list --region "$REGION" --project "$PROJECT"
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT"
  gcloud run revisions list --service <service-name> --region "$REGION" --project "$PROJECT"
  # Stream recent logs:
  gcloud logging read \
    'resource.type="cloud_run_revision" AND resource.labels.service_name="<service-name>"' \
    --project "$PROJECT" --limit 50 --order asc
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, and traffic
split details.

### B. Cloud SQL for PostgreSQL 15

Moodle stores all application data (courses, users, grades, activity logs) in a
managed Cloud SQL for PostgreSQL 15 instance. Each Cloud Run instance connects
privately through the **Cloud SQL Auth Proxy** sidecar over a Unix socket, so no
public IP is exposed. On first deploy an initialization job creates the database and
user and enables the `pg_trgm` extension for Moodle's full-text search.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see
[App_CloudRun](App_CloudRun.md).

### C. Filestore (NFS) and Cloud Storage

Moodle's `moodledata` directory is written to a **Filestore (NFS)** share mounted
into every Cloud Run instance so all instances see the same uploaded files, course
materials, and user submissions. A dedicated **Cloud Storage** data bucket is also
provisioned; the service account is granted access automatically.

> NFS volume mounts require `execution_environment = "gen2"` (the default).

- **Console:** Filestore → Instances for the NFS share; Cloud Storage → Buckets for
  the data bucket.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for NFS provisioning, GCS Fuse, and
CMEK options.

### D. Redis cache

Redis backs Moodle's PHP session handling and application cache. When no external
Redis host is configured and NFS is enabled, the NFS host IP is used as the Redis
endpoint — suitable for development. For production with multiple instances, set
`redis_host` to a Cloud Memorystore instance IP.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping           # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The Moodle cron password and SMTP password are generated automatically by
`Moodle_Common` and stored as Secret Manager secrets. The database password is
generated and managed by the foundation. All three are injected into Cloud Run
instances at runtime; plaintext never appears in configuration files.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). After deployment,
update the SMTP password secret with your real SMTP credential:
```bash
echo -n "your-smtp-password" | \
  gcloud secrets versions add <smtp-password-secret> --data-file=- --project "$PROJECT"
```

See [App_CloudRun](App_CloudRun.md) for rotation details.

### F. Cloud Scheduler

A Cloud Scheduler job is auto-provisioned on every deployment to drive Moodle's
internal task queue. It fires every minute and authenticates using the auto-generated
`MOODLE_CRON_PASSWORD`.

- **Console:** Cloud Scheduler → Jobs.
- **CLI:**
  ```bash
  gcloud scheduler jobs list --project "$PROJECT"
  gcloud scheduler jobs describe <job-name> --location "$REGION" --project "$PROJECT"
  # Manually trigger a cron run:
  gcloud scheduler jobs run <job-name> --location "$REGION" --project "$PROJECT"
  ```

### G. Networking & ingress

By default Moodle is accessible via the Cloud Run-managed `run.app` URL. An optional
HTTPS load balancer with Cloud Armor and a custom domain can be enabled. Setting
`application_domains` automatically injects `MOODLE_REVERSE_PROXY = "true"` and
`ENABLE_REVERSE_PROXY = "TRUE"` so Moodle generates correct HTTPS URLs behind the
load balancer.

- **Console:** Cloud Run → select the service → Networking; Network services → Load
  balancing (if using Cloud Armor).
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format="value(status.url)"
  gcloud compute forwarding-rules list --project "$PROJECT"     # if LB is enabled
  ```

See [App_CloudRun](App_CloudRun.md) for custom domains, Cloud
CDN, and static IP details.

### H. Cloud Logging & Monitoring

Cloud Run instance stdout/stderr flow to Cloud Logging; request metrics and Cloud SQL
metrics flow to Cloud Monitoring. Optional uptime checks and alert policies are
available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read \
    'resource.type="cloud_run_revision" AND resource.labels.service_name="<service-name>"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Moodle Application Behaviour

- **First-deploy database setup.** Two initialization jobs run before the Cloud Run
  service becomes live. The `db-init` job creates the Moodle database and user,
  enables the `pg_trgm` extension, and grants privileges (idempotent, safe to
  re-run). The `nfs-init` job creates the required Moodle subdirectories (`filedir`,
  `temp`, `cache`, `localcache`) on the NFS share and sets `www-data` ownership.
- **Automatic cron scheduling.** A Cloud Scheduler job fires every minute targeting
  `/admin/cron.php?password=<MOODLE_CRON_PASSWORD>`. This drives all Moodle
  scheduled tasks: course backups, email notifications, badge processing, and
  activity completions. The job is always created and cannot be disabled.
- **Health path.** Startup and liveness probes use HTTP `/health.php`, which returns
  HTTP 200 when PHP is operational. The startup probe allows up to 10 minutes
  (`failure_threshold = 20`, `period_seconds = 30`) for first-boot schema creation
  and plugin registration.
- **SMTP outbound email.** SMTP settings are injected as environment variables.
  Override the defaults using `environment_variables` (see Group 6). The SMTP
  password is auto-generated and stored in Secret Manager; update the secret with
  your real credential after deployment.
- **`wwwroot` resolution.** Moodle's `config.php` resolves `wwwroot` from the
  `APP_URL` environment variable, falling back to `CLOUDRUN_SERVICE_URL`. When
  `application_domains` is set, `MOODLE_REVERSE_PROXY` and `ENABLE_REVERSE_PROXY`
  are automatically set to `"true"` / `"TRUE"` so Moodle generates correct HTTPS
  URLs behind the load balancer.
- **Scale-to-zero.** `min_instance_count = 0` is the default; the first request
  after idle will cold-start the PHP/Apache container. Set `min_instance_count = 1`
  in production to eliminate cold-start latency for students.
- **Admin login.** The initial admin username and email are configurable via
  `environment_variables`. The admin password is set during Moodle's first install
  via `admin/cli/install_database.php`.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Moodle are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour and
defaults.

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
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `moodle` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Moodle LMS` | Friendly name shown in the Console. |
| `description` | `Moodle LMS - Online learning and course management platform` | Service description annotation. |
| `application_version` | `4.5.1` | Container image version tag; increment to roll out a new version. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. Increase to `2000m` for production with concurrent students. |
| `memory_limit` | `2Gi` | Memory per instance; 2 GiB provides headroom for PHP with OPcache. |
| `min_instance_count` | `0` | Minimum live instances. Set to `1` to eliminate cold-start latency. |
| `max_instance_count` | `3` | Maximum concurrent instances. |
| `container_port` | `8080` | Moodle/Apache listens on port 8080. |
| `execution_environment` | `gen2` | Required for NFS volume mounts. |
| `timeout_seconds` | `300` | Maximum request duration; increase up to 3600 for large file uploads. |
| `enable_image_mirroring` | `false` | Disabled — Moodle uses a custom Dockerfile with no external prebuilt image. |

### Group 5 — Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `"all"` allows public internet traffic. Use `"internal-and-cloud-load-balancing"` when Cloud Armor is in front. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Routes only RFC 1918 traffic via the VPC connector. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Override auto-injected SMTP defaults here (e.g., `MOODLE_SMTP_HOST`, `MOODLE_ADMIN_EMAIL`). |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

### Group 7 — Backup & Recovery

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & GitHub Integration

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. Use
this to install additional PostgreSQL extensions or seed data. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Security, Storage & Images

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor WAF + HTTPS load balancer. |
| `application_domains` | `[]` | Custom domain names; also activates `MOODLE_REVERSE_PROXY = "true"`. |
| `enable_cdn` | `false` | Enable Cloud CDN on the load balancer. |
| `create_cloud_storage` | `true` | Provision the data bucket. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional GCS buckets to provision. |

### Group 11 — Filesystem (NFS) & Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for Moodle `moodledata` (keep enabled — required for all deployments). |
| `nfs_mount_path` | `/mnt/nfs` | Container path where the NFS share is mounted; injected as `MOODLE_DATA_DIR`. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts for themes or plugins. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed at PostgreSQL 15 — do not change. |
| `db_name` | `moodle` | Database name. Immutable after first deploy. |
| `db_user` | `moodle` | Application database user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length. |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |

### Group 13 — Jobs

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` and `nfs-init` jobs. |
| `cron_jobs` | `[]` | Supplemental Cloud Run Jobs triggered by Cloud Scheduler (the Moodle cron scheduler job is always created separately). |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health.php`, 20 failures × 30 s | Up to 10 minutes for Moodle to complete first-boot setup. |
| `liveness_probe` | HTTP `/health.php`, 120 s initial delay | Periodic health check after startup. |
| `uptime_check_config` | disabled, path `/` | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Use Redis for PHP sessions and Moodle application cache. |
| `redis_host` | `""` | Leave empty to use the NFS host IP (development only); set to a Cloud Memorystore IP for production. |
| `redis_port` | `6379` | Redis port (string type). |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL to reach Moodle. |
| `service_location` | Cloud Run service region. |
| `stage_services` | URLs of stage-specific service revisions (when Cloud Deploy is enabled). |
| `load_balancer_ip` | External load balancer IP (when Cloud Armor + custom domain is enabled). |
| `load_balancer_url` | HTTPS URL via the load balancer. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB host (sensitive) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `nfs_server_ip` | Private IP of the Filestore NFS server (sensitive). |
| `nfs_instance_tags` | GCE network tags on the NFS instance. |
| `nfs_mount_path` | Container path where the NFS share is mounted. |
| `nfs_share_path` | Export path on the NFS server. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `uptime_check_names` | Names of the Cloud Monitoring uptime checks. |
| `initialization_jobs` / `nfs_setup_job` | Names of the setup and NFS init jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Moodle requires PostgreSQL; `MOODLE_DB_TYPE = "pgsql"` is hardcoded — any other engine breaks startup. |
| `enable_nfs` | `true` | Critical | Without shared NFS storage, `moodledata` is not shared across instances and uploads are lost on restart. |
| `execution_environment` | `gen2` (default) | Critical | NFS volume mounts are not supported in gen1; the service will not start with NFS enabled. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `enable_redis` | `true` | High | Without a shared session store, users on multi-instance deployments are logged out on each new instance. |
| `redis_host` | `""` (NFS) or explicit | High | No valid endpoint if Redis is on but NFS is off and no host is set. |
| `memory_limit` | `2Gi` | High | Too little memory causes PHP OOM during course imports or large file uploads. |
| `min_instance_count` | `1` for production | High | `0` causes cold-start delays; the Cloud Scheduler cron job may time out waiting for the first request to warm the instance. |
| `nfs_mount_path` | `/mnt/nfs` | High | Must match `MOODLE_DATA_DIR`; changing after first deploy moves the data root and breaks the installation. |
| `application_domains` + `MOODLE_REVERSE_PROXY` | set together | High | Without the reverse proxy flags, Moodle generates HTTP URLs behind an HTTPS load balancer, breaking links and logins. |
| `enable_cloud_armor` / `enable_iap` | enable for admin-facing | Medium | The admin UI is otherwise publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `max_revisions_to_retain` | `7` | Low | Unlimited retained revisions can accumulate over time. |

---

For the foundation behaviour referenced throughout — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image lifecycle — see
**[App_CloudRun](App_CloudRun.md)**. Moodle-specific shared configuration is
described in **[Moodle_Common](Moodle_Common.md)**.
