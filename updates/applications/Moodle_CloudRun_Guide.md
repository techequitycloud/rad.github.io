# Moodle CloudRun Module — Configuration Guide

Moodle is the world's most popular open-source Learning Management System (LMS), used by educational institutions, corporations, and online learning platforms worldwide. This module deploys Moodle on **Google Cloud Run** using a custom PHP 8.3/Apache container, backed by a managed Cloud SQL PostgreSQL instance and shared NFS storage for course materials.

`Moodle CloudRun` is a **wrapper module** built on top of `App CloudRun`. It uses `App CloudRun` for all GCP infrastructure provisioning (Cloud Run service, networking, Cloud SQL, GCS, secrets, CI/CD) and adds Moodle-specific application configuration, an automated cron Cloud Scheduler job, and database initialisation on top.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How This Guide Is Structured

This guide documents only the variables that are **unique to `Moodle CloudRun`** or that have **Moodle-specific defaults** that differ from the `App CloudRun` base module. For all other variables — project identity, runtime scaling, storage, CI/CD, backup, custom SQL, networking, IAP, Cloud Armor, and VPC Service Controls — refer directly to the [App CloudRun Configuration Guide](../App_CloudRun/App_CloudRun_Guide.md).

**Variables fully covered by the App CloudRun guide:**

| Configuration Area | App_CloudRun_Guide Section | Moodle-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | Group 0 | Different defaults for `module_description` and `module_documentation`. `resource_creator_identity` is the same — see Group 0. |
| Project & Identity | Group 1 | Refer to base App CloudRun module documentation. |
| Runtime & Scaling | Group 3 | See [Moodle Runtime Configuration](#moodle-runtime-configuration) below for `cpu_limit`, `memory_limit`, and Moodle-specific scaling defaults. `enable_image_mirroring` defaults to `false`. `enable_cloudsql_volume` is forced to `true`. |
| Environment Variables & Secrets | Group 4 | See [Moodle Environment Variables](#moodle-environment-variables) below for Moodle-specific injected defaults. |
| Observability & Health | Group 5 | See [Moodle Health Probes](#moodle-health-probes) below for the `startup_probe` and `liveness_probe` variables and their `/health.php` defaults. |
| Jobs & Scheduled Tasks | Group 6 | See [Platform-Managed Behaviours](#platform-managed-behaviours) for the auto-provisioned Moodle cron Cloud Scheduler job. |
| CI/CD & GitHub Integration | Group 7 | Refer to base App CloudRun module documentation. |
| Storage — NFS | Group 8 | `enable_nfs` defaults to `true`. NFS is the active Moodle data directory. See [Platform-Managed Behaviours](#platform-managed-behaviours). |
| Storage — GCS | Group 9 | Refer to base App CloudRun module documentation. An additional `moodle-data` GCS bucket is provisioned automatically. |
| Redis Cache | Group 10 | `enable_redis` defaults to `true`. See [Redis Cache](#redis-cache) below for Moodle-specific defaults and the `MOODLE_REDIS_*` variable injection. |
| Database Backend | Group 11 | See [Moodle Database Configuration](#moodle-database-configuration) below for the `db_name` and `db_user` naming difference from App CloudRun. |
| Backup & Maintenance | Group 12 | Refer to base App CloudRun module documentation for `backup_schedule` and `backup_retention_days`. See [Backup Import & Recovery](#backup-import--recovery) below for the `backup_uri` naming difference. |
| Custom Initialisation & SQL | Group 13 | Refer to base App CloudRun module documentation. |
| Access & Networking | Group 14 | Refer to base App CloudRun module documentation. |
| Identity-Aware Proxy | Group 15 | Refer to base App CloudRun module documentation. |
| Cloud Armor & CDN | Group 16 | Refer to base App CloudRun module documentation. |
| VPC Service Controls | Group 17 | Refer to base App CloudRun module documentation. |

---

## Platform-Managed Behaviours

The following behaviours are applied automatically by `Moodle CloudRun` regardless of the variable values in your `tfvars` file. They cannot be overridden by user configuration.

| Behaviour | Detail |
|---|---|
| **PostgreSQL forced** | `MOODLE_DB_TYPE = "pgsql"` is injected automatically. Moodle requires PostgreSQL — do not set `database_type` to a MySQL or SQL Server variant. |
| **Cloud SQL Auth Proxy** | `enable_cloudsql_volume` is forced to `true`. Moodle connects to Cloud SQL via the Auth Proxy Unix socket at `cloudsql_volume_mount_path`. |
| **Reverse proxy headers** | `MOODLE_REVERSE_PROXY = "true"` and `ENABLE_REVERSE_PROXY = "TRUE"` are always injected. This ensures Moodle generates correct HTTPS URLs behind the Cloud Run load balancer, which is always present in a Cloud Run deployment. |
| **NFS as moodledata** | `MOODLE_DATA_DIR` and `DATA_PATH` are automatically set to the value of `nfs_mount_path`. The NFS volume is the active `moodledata` directory where Moodle stores uploaded files, course materials, and user submissions. |
| **Moodle cron job** | A Cloud Scheduler job is created automatically, targeting `/admin/cron.php?password=CRON_PASSWORD` on the Cloud Run service URL every minute. The cron password is a randomly generated 32-character string stored in Secret Manager and never exposed in plaintext. |
| **SMTP defaults** | `MOODLE_SMTP_HOST`, `MOODLE_SMTP_PORT` (`"587"`), `MOODLE_SMTP_USER`, `MOODLE_SMTP_SECURE` (`"tls"`), and `MOODLE_SMTP_AUTH` (`"LOGIN"`) are injected with defaults. Override via `environment_variables` to configure your SMTP server before going live. |
| **Site identity defaults** | `MOODLE_SITE_NAME` (`"Moodle LMS"`), `MOODLE_SITE_FULLNAME`, `LANGUAGE` (`"en"`), `MOODLE_ADMIN_USER` (`"admin"`), `MOODLE_ADMIN_EMAIL` (`"admin@example.com"`), `MOODLE_SKIP_INSTALL` (`"no"`), and `MOODLE_UPDATE` (`"yes"`) are injected with defaults. Override via `environment_variables`. |
| **Moodle data GCS bucket** | An additional GCS bucket with the suffix `moodle-data` is provisioned alongside any buckets defined in `storage_buckets`. |
| **CRON and SMTP secrets** | `MOODLE_CRON_PASSWORD` and `MOODLE_SMTP_PASSWORD` are generated and stored in Secret Manager automatically. |

---

## Moodle Application Identity

These variables control how the Moodle deployment is named and described. They use shorter names (`display_name`, `description`) aligned with the `Moodle_Common` interface rather than the full `application_display_name` and `application_description` names from App CloudRun.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_name` | `"moodle"` | `[a-z][a-z0-9-]{0,19}` | Internal identifier used as the base name for the Cloud Run service, Artifact Registry repository, Secret Manager secrets, and GCS buckets. Functionally identical to `application_name` in App CloudRun. **Do not change after initial deployment.** |
| `application_version` | `"4.5.1"` | Moodle version string, e.g. `"4.5.1"` | Version tag applied to the container image and used for deployment tracking. Increment to trigger a new Cloud Build run and create a new Cloud Run revision. |
| `display_name` | `"Moodle LMS"` | Any string | Human-readable name shown in the platform UI and Cloud Run service list. Equivalent to `application_display_name` in App CloudRun. Can be updated freely without affecting resource names. |
| `description` | `"Moodle LMS - Online learning and course management platform"` | Any string | Brief description of the deployment. Populated into the Cloud Run service description field and platform documentation. Equivalent to `application_description` in App CloudRun. |

### Validating Application Identity

```bash
# Confirm the Cloud Run service exists with the expected name and description
gcloud run services describe moodle \
  --region=REGION \
  --format="table(metadata.name,metadata.annotations['run.googleapis.com/description'])"
```

---

## Moodle Runtime Configuration

Moodle is a PHP 8.3/Apache application. The module exposes `cpu_limit` and `memory_limit` as **dedicated top-level variables** rather than requiring users to set the full `container_resources` object.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `cpu_limit` | `"2000m"` | Cloud Run CPU quantity string (e.g. `"1000m"`, `"2000m"`, `"4000m"`) | CPU limit for the Moodle Cloud Run instance. PHP with OPcache and concurrent student requests benefits from 2 vCPU. Note: CPUs above `"1000m"` require `cpu_always_allocated = true` — ensure this is set to avoid throttling during idle periods. |
| `memory_limit` | `"4Gi"` | Cloud Run memory quantity string (e.g. `"2Gi"`, `"4Gi"`) | Memory limit for the Moodle Cloud Run instance. PHP 8.3 with OPcache, active student sessions, and file upload handling typically consumes 1–2 Gi under normal load. **4 Gi recommended for production** with concurrent course delivery. |

> **Note on `container_resources`:** The full `container_resources` object (documented in [App_CloudRun_Guide Group 3](../App_CloudRun/App_CloudRun_Guide.md#group-3-runtime--scaling)) takes precedence over `cpu_limit` and `memory_limit` when set explicitly in your `tfvars`. Use `container_resources` when you need to configure both CPU and memory in a single block, for example in the advanced configuration.

**Moodle-specific runtime defaults that differ from App CloudRun:**

| Variable | App CloudRun Default | Moodle CloudRun Default | Reason |
|---|---|---|---|
| `application_name` | `"crapp"` | `"moodle"` | Moodle-specific application identifier. |
| `application_version` | `"1.0.0"` | `"4.5.1"` | Default Moodle release version. |
| `enable_image_mirroring` | `true` | `false` | Moodle is built from a custom Dockerfile; there is no external prebuilt image to mirror. |
| `enable_cloudsql_volume` | `true` | `true` (forced) | Moodle connects to Cloud SQL via the Auth Proxy Unix socket. This cannot be changed. |
| `min_instance_count` | `0` | `0` | Scale-to-zero is permitted for development and low-traffic deployments. Set to `1` for production to avoid cold-start latency between student sessions. |
| `max_instance_count` | `1` | `3` | Moodle scales horizontally when Redis handles PHP sessions. |

### Validating Runtime Configuration

```bash
# View the CPU and memory limits on the latest revision
gcloud run services describe moodle \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].resources)"

# Confirm Cloud SQL socket connection is configured
gcloud run services describe moodle \
  --region=REGION \
  --format="yaml(spec.template.spec.volumes)"
```

---

## Moodle Database Configuration

Moodle requires PostgreSQL. The module uses `db_name` and `db_user` (shorter names aligned with the `Moodle_Common` interface) in place of the `application_database_name` and `application_database_user` variables documented in [App_CloudRun_Guide Group 11](../App_CloudRun/App_CloudRun_Guide.md#group-11-database-backend).

All other database variables (`sql_instance_name`, `database_password_length`, `enable_auto_password_rotation`, `rotation_propagation_delay_sec`, etc.) behave identically to the App CloudRun equivalents — refer to [App_CloudRun_Guide Group 11](../App_CloudRun/App_CloudRun_Guide.md#group-11-database-backend) for their documentation.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `db_name` | `"moodle"` | `[a-z][a-z0-9_]{0,62}` | The name of the PostgreSQL database created within the Cloud SQL instance. Injected as the `DB_NAME` environment variable. **Do not change after initial deployment** — Moodle stores all course data in this database and renaming it requires a manual migration. |
| `db_user` | `"moodle"` | `[a-z][a-z0-9_]{0,31}` | The PostgreSQL user created for the Moodle application. Injected as the `DB_USER` environment variable. The password is auto-generated, stored in Secret Manager, and injected as `DB_PASSWORD`. |

> **Important:** Moodle requires PostgreSQL. The module defaults `database_type` to `"POSTGRES"` (latest managed version). Setting `database_type = "NONE"` or a MySQL/SQL Server type will prevent Moodle from starting.

> **`pg_trgm` extension:** Required by Moodle for full-text search performance. Enable it by setting `enable_postgres_extensions = true` and `postgres_extensions = ["pg_trgm"]` in your `tfvars`.

### Validating Database Configuration

```bash
# Confirm the database and user were created
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID

gcloud sql users list --instance=INSTANCE_NAME --project=PROJECT_ID

# Confirm DB environment variables are injected into the Cloud Run service
gcloud run services describe moodle \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -E "DB_"
```

---

## Moodle Environment Variables

The `environment_variables` variable (documented in [App_CloudRun_Guide Group 4](../App_CloudRun/App_CloudRun_Guide.md#group-4-environment-variables--secrets)) is supplemented by a set of Moodle-specific defaults that are **automatically injected** by the module.

**Moodle environment variables injected automatically:**

```hcl
# Platform identity (auto-injected; override via environment_variables)
MOODLE_SITE_NAME     = "Moodle LMS"
MOODLE_SITE_FULLNAME = "Moodle Learning Management System"
LANGUAGE             = "en"
MOODLE_ADMIN_USER    = "admin"
MOODLE_ADMIN_EMAIL   = "admin@example.com"
MOODLE_SKIP_INSTALL  = "no"
MOODLE_UPDATE        = "yes"

# Storage paths (derived from nfs_mount_path)
MOODLE_DATA_DIR      = "/mnt/nfs"   # value of nfs_mount_path
DATA_PATH            = "/mnt/nfs"   # value of nfs_mount_path

# SMTP (defaults — configure for production email delivery)
MOODLE_SMTP_HOST     = ""
MOODLE_SMTP_PORT     = "587"
MOODLE_SMTP_USER     = ""
MOODLE_SMTP_SECURE   = "tls"
MOODLE_SMTP_AUTH     = "LOGIN"

# Database type (hardcoded)
MOODLE_DB_TYPE       = "pgsql"

# Reverse proxy (always enabled for Cloud Run)
MOODLE_REVERSE_PROXY = "true"
ENABLE_REVERSE_PROXY = "TRUE"

# Redis (derived from enable_redis, redis_host, redis_port, redis_auth)
MOODLE_REDIS_ENABLED  = "true"   # value of enable_redis
MOODLE_REDIS_HOST     = ""       # defaults to NFS server IP when redis_host is blank
MOODLE_REDIS_PORT     = "6379"
MOODLE_REDIS_PASSWORD = ""
```

To configure SMTP for production email delivery:

```hcl
environment_variables = {
  MOODLE_SMTP_HOST   = "smtp.sendgrid.net"
  MOODLE_SMTP_USER   = "apikey"
  MOODLE_ADMIN_EMAIL = "admin@yourinstitution.edu"
  MOODLE_SITE_NAME   = "My University LMS"
}

secret_environment_variables = {
  MOODLE_SMTP_PASSWORD = "moodle-smtp-password"   # Secret Manager secret name
}
```

All other `environment_variables` and `secret_environment_variables` behaviour is identical to App CloudRun — refer to [App_CloudRun_Guide Group 4](../App_CloudRun/App_CloudRun_Guide.md#group-4-environment-variables--secrets).

---

## Moodle Health Probes

Moodle performs database schema validation and plugin checks on startup. The module exposes **dedicated probe variables** — `startup_probe` and `liveness_probe` — that use **different names** from App CloudRun (`startup_probe_config` and `health_check_config`) and have Moodle-specific defaults targeting the `/health.php` endpoint, which reflects both PHP availability and database connectivity and is more accurate for Moodle's readiness than a generic `/healthz` path.

| Variable | Default | Description & Implications |
|---|---|---|
| `startup_probe` | `{ enabled = true, type = "HTTP", path = "/health.php", initial_delay_seconds = 0, timeout_seconds = 10, period_seconds = 30, failure_threshold = 20 }` | Determines when the Cloud Run instance is ready to receive traffic. `failure_threshold = 20` with `period_seconds = 30` allows up to 10 minutes of startup time — sufficient for first-boot schema creation and plugin setup. On subsequent deployments the schema is already in place and startup is significantly faster; the high failure threshold is a safety margin for the initial rollout. |
| `liveness_probe` | `{ enabled = true, type = "HTTP", path = "/health.php", initial_delay_seconds = 120, timeout_seconds = 10, period_seconds = 60, failure_threshold = 3 }` | Periodically checks whether the running Moodle instance is healthy. The `initial_delay_seconds = 120` prevents premature restarts during the post-startup phase. A `period_seconds = 60` interval is appropriate for a database-backed LMS. |

> **Relationship to App CloudRun probes:** `startup_probe` corresponds to `startup_probe_config` in App CloudRun; `liveness_probe` corresponds to `health_check_config`. Their sub-field structure is identical. The `startup_probe_config` and `health_check_config` variables are also present in `Moodle CloudRun` (with `/health.php` defaults) for compatibility — prefer the dedicated `startup_probe` and `liveness_probe` variables.

### Validating Health Probe Configuration

**Google Cloud Console:** Navigate to **Cloud Run → Services → moodle → Revisions**, select the latest revision, then click **Container(s)** and view the **Health checks** section.

```bash
# View startup and liveness probe config on the latest revision
gcloud run services describe moodle \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].livenessProbe,spec.template.spec.containers[0].startupProbe)"

# View Cloud Run logs for startup probe status
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=moodle AND severity>=WARNING" \
  --project=PROJECT_ID \
  --limit=20 \
  --format="table(timestamp,severity,textPayload)"
```

---

## Redis Cache

Moodle uses Redis as the PHP session handler and application cache. When `enable_redis = true`, the `MOODLE_REDIS_ENABLED`, `MOODLE_REDIS_HOST`, `MOODLE_REDIS_PORT`, and `MOODLE_REDIS_PASSWORD` environment variables are injected automatically. **Redis is enabled by default** in `Moodle CloudRun` because Cloud Run routes requests across multiple instances simultaneously, and shared Redis session storage prevents users from being logged out when a request reaches a different instance.

For detailed documentation on the Redis variables `enable_redis`, `redis_host`, `redis_port`, and `redis_auth`, refer to [App_CloudRun_Guide Group 10](../App_CloudRun/App_CloudRun_Guide.md#group-10-redis-cache) — the variable semantics are identical, but the defaults differ:

| Variable | App CloudRun Default | Moodle CloudRun Default | Reason |
|---|---|---|---|
| `enable_redis` | `true` | `true` | Redis session handling is critical for Moodle with multiple Cloud Run instances. |
| `redis_host` | `""` | `""` | Defaults to NFS server IP when blank. Override with a Cloud Memorystore instance IP for production. |
| `redis_port` | `"6379"` | `"6379"` | Standard Redis port. |
| `redis_auth` | `""` | `""` | Set to the Memorystore AUTH string for production deployments. |

### Validating Redis Configuration

```bash
# Confirm MOODLE_REDIS_* variables are injected into the Cloud Run service
gcloud run services describe moodle \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" | grep REDIS
```

---

## Backup Import & Recovery

In addition to the scheduled backup (`backup_schedule` and `backup_retention_days`, documented in [App_CloudRun_Guide Group 12](../App_CloudRun/App_CloudRun_Guide.md#group-12-backup--maintenance)), `Moodle CloudRun` supports a **one-time import** of an existing Moodle database backup during deployment. This is designed for migrating an existing Moodle instance to GCP or seeding a new environment with production data.

The key naming difference from App CloudRun is that **`backup_uri`** (a full GCS object path or Google Drive file ID) is used instead of `backup_file` (a filename relative to the backup bucket). The value is mapped internally to the App CloudRun `backup_file` input.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_backup_import` | `false` | `true` / `false` | When `true`, triggers a one-time Cloud Run Job to restore the backup at `backup_uri`. The import runs after the database is provisioned. **If the database already contains data**, the import may produce errors — test in a non-production environment first. |
| `backup_source` | `"gcs"` | `gcs` / `gdrive` | The source from which the backup file is retrieved. **`gcs`:** provide the full GCS URI in `backup_uri`. **`gdrive`:** provide the Google Drive file ID in `backup_uri`. Only used when `enable_backup_import = true`. |
| `backup_uri` | `""` | Full GCS URI or Google Drive file ID | For GCS: e.g. `"gs://my-bucket/backups/moodle.sql.gz"`. For Google Drive: the file ID from the share URL (the string after `/file/d/` in the URL). Required when `enable_backup_import = true`. |
| `backup_format` | `"sql"` | `sql` / `tar` / `gz` / `tgz` / `tar.gz` / `zip` | The format of the backup file. The default `"sql"` is appropriate for `pg_dump` plain-text output. Use `"gz"` for gzip-compressed dumps. |

### Validating Backup Import

```bash
# Confirm the import job completed successfully
gcloud run jobs executions list \
  --job=moodle-backup-import \
  --region=REGION \
  --format="table(name,status.conditions[0].type,status.startTime,status.completionTime)"

# View import job logs for any errors
gcloud logging read \
  "resource.type=cloud_run_job AND resource.labels.job_name=moodle-backup-import" \
  --project=PROJECT_ID \
  --limit=50 \
  --order=asc \
  --format="table(timestamp,severity,textPayload)"
```

---

## Deployment Prerequisites & Validation

After deploying `Moodle CloudRun`, confirm the deployment is healthy:

```bash
# Confirm the Cloud Run service is deployed and view its URL
gcloud run services describe moodle \
  --region=REGION \
  --format="table(status.url,status.conditions[0].type)"

# View the latest revision status
gcloud run revisions list \
  --service=moodle \
  --region=REGION \
  --format="table(name,status.conditions[0].status,spec.containerConcurrency)"

# Confirm the Cloud Scheduler cron job was created (fires every minute)
gcloud scheduler jobs list \
  --location=REGION \
  --project=PROJECT_ID \
  --filter="name~moodle-cron" \
  --format="table(name,schedule,state)"

# Confirm the GCS moodle-data bucket was provisioned
gcloud storage buckets list \
  --project=PROJECT_ID \
  --filter="name~moodle-data"

# Confirm the pg_trgm extension is installed (if enabled)
gcloud run jobs executions list \
  --job=moodle-db-init \
  --region=REGION \
  --format="table(name,status.conditions[0].type)"

# Verify the Moodle health endpoint is responding
curl -s -o /dev/null -w "%{http_code}" https://SERVICE_URL/health.php
# Expect: 200
```
