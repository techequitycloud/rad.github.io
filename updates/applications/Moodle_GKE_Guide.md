# Moodle_GKE Module — Configuration Guide

Moodle is the world's most popular open-source Learning Management System (LMS), used by educational institutions, corporations, and online learning platforms worldwide. This module deploys Moodle on **GKE Autopilot** using a custom PHP 8.3/Apache container, backed by a managed Cloud SQL PostgreSQL instance and shared NFS storage for course materials.

`Moodle_GKE` is a **wrapper module** built on top of `App_GKE`. It uses `App_GKE` for all GCP infrastructure provisioning (cluster, networking, Cloud SQL, GCS, secrets, CI/CD) and adds Moodle-specific application configuration, an automated cron Cloud Scheduler job, and database initialisation on top.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How This Guide Is Structured

This guide documents only the variables that are **unique to `Moodle_GKE`** or that have **Moodle-specific defaults** that differ from the `App_GKE` base module. For all other variables — project identity, runtime scaling, backend configuration, storage, CI/CD, observability, networking, IAP, and Cloud Armor — refer directly to the [App_GKE Configuration Guide](../App_GKE/App_GKE_Guide.md).

**Variables fully covered by the App_GKE guide:**

| Configuration Area | App_GKE_Guide Section | Moodle-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | Group 0 | Different defaults for `module_description` and `module_documentation`. |
| Project & Identity | Group 1 | Refer to base App_GKE module documentation. |
| Runtime & Scaling | Group 3 | See [Moodle Runtime Configuration](#moodle-runtime-configuration) below for `cpu_limit`, `memory_limit`, and Moodle-specific scaling defaults. `container_image_source` defaults to `"custom"` — Moodle is built from a Dockerfile. |
| Environment Variables & Secrets | Group 4 | See [Moodle Environment Variables](#moodle-environment-variables) below for Moodle-specific injected defaults. |
| GKE Backend Configuration | Group 5 | `enable_custom_domain` defaults to `true` and `reserve_static_ip` defaults to `true`. See [Platform-Managed Behaviours](#platform-managed-behaviours). |
| Jobs & Scheduled Tasks | Group 6 | See [Platform-Managed Behaviours](#platform-managed-behaviours) for the auto-provisioned Moodle cron Cloud Scheduler job. |
| CI/CD & GitHub Integration | Group 7 | Refer to base App_GKE module documentation. |
| Storage — NFS | Group 8 | `enable_nfs` defaults to `true`. NFS is the active Moodle data directory (`moodledata`). See [Platform-Managed Behaviours](#platform-managed-behaviours). |
| Storage — GCS | Group 9 | Refer to base App_GKE module documentation. An additional `moodle-data` GCS bucket is provisioned automatically. |
| Database Configuration | Group 10 | See [Moodle Database Configuration](#moodle-database-configuration) below for the `db_name` and `db_user` variable naming. |
| Backup Schedule & Retention | Group 11 | Refer to base App_GKE module documentation. See [Backup Import & Recovery](#backup-import--recovery) below for the `backup_uri` naming difference. |
| Custom SQL Scripts | Group 12 | Refer to base App_GKE module documentation. |
| Observability & Health | Group 13 | See [Moodle Health Probes](#moodle-health-probes) below for the `startup_probe` and `liveness_probe` variables and their `/health.php` defaults. |
| Reliability Policies | Group 14 | Refer to base App_GKE module documentation. |
| Resource Quota | Group 15 | Refer to base App_GKE module documentation. |
| Custom Domain, Static IP & Network | Group 16 | `enable_custom_domain` defaults to `true`. See [Platform-Managed Behaviours](#platform-managed-behaviours). |
| Identity-Aware Proxy | Group 17 | Refer to base App_GKE module documentation. |
| Cloud Armor | Group 18 | Refer to base App_GKE module documentation. |

---

## Platform-Managed Behaviours

The following behaviours are applied automatically by `Moodle_GKE` regardless of the variable values in your `tfvars` file. They cannot be overridden by user configuration.

| Behaviour | Detail |
|---|---|
| **PostgreSQL forced** | `MOODLE_DB_TYPE = "pgsql"` is injected automatically. Moodle requires PostgreSQL — do not set `database_type` to a MySQL or SQL Server variant. |
| **Cloud SQL Auth Proxy** | `enable_cloudsql_volume` is forced to `true`. Moodle connects to Cloud SQL via the Auth Proxy Unix socket. |
| **NFS as moodledata** | `MOODLE_DATA_DIR` and `DATA_PATH` are automatically set to the value of `nfs_mount_path`. The NFS volume is the active `moodledata` directory where Moodle stores uploaded files, course materials, and user submissions. |
| **Reverse proxy headers** | `MOODLE_REVERSE_PROXY` and `ENABLE_REVERSE_PROXY` are set to `"true"` / `"TRUE"` when `application_domains` is non-empty, and `"false"` / `"FALSE"` otherwise. This ensures Moodle generates correct URLs behind the GKE load balancer. |
| **Moodle cron job** | A Cloud Scheduler job is created automatically, targeting `/admin/cron.php?password=CRON_PASSWORD` on the application URL every minute. The cron password is a randomly generated 32-character string stored in Secret Manager and never exposed in plaintext. |
| **SMTP defaults** | `MOODLE_SMTP_HOST`, `MOODLE_SMTP_PORT` (`"587"`), `MOODLE_SMTP_USER`, `MOODLE_SMTP_SECURE` (`"tls"`), and `MOODLE_SMTP_AUTH` (`"LOGIN"`) are injected with defaults. Override these via `environment_variables` to configure your SMTP server before going live. |
| **Site identity defaults** | `MOODLE_SITE_NAME` (`"Moodle LMS"`), `MOODLE_SITE_FULLNAME`, `LANGUAGE` (`"en"`), `MOODLE_ADMIN_USER` (`"admin"`), `MOODLE_ADMIN_EMAIL` (`"admin@example.com"`), `MOODLE_SKIP_INSTALL` (`"no"`), and `MOODLE_UPDATE` (`"yes"`) are injected with defaults. Override via `environment_variables`. |
| **Moodle data GCS bucket** | An additional GCS bucket with the suffix `moodle-data` is provisioned alongside any buckets defined in `storage_buckets`. |
| **CRON and SMTP secrets** | `MOODLE_CRON_PASSWORD` and `MOODLE_SMTP_PASSWORD` are generated and stored in Secret Manager automatically. |
| **Custom domain enabled** | `enable_custom_domain` defaults to `true` and `reserve_static_ip` defaults to `true`. This ensures a stable external IP is reserved and Moodle's `wwwroot` is configured correctly from the first deployment without manual post-deployment steps. |

---

## Moodle Application Identity

These variables control how the Moodle deployment is named and described. They correspond to the standard identity variables in App_GKE but have Moodle-specific defaults. An additional `description` variable is also present, used by the `Moodle_Common` sub-module interface.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_name` | `"moodle"` | `[a-z][a-z0-9-]{0,19}` | Internal identifier used as the base name for GKE workloads, Cloud SQL, GCS buckets, Artifact Registry, and the Kubernetes namespace. Functionally identical to `application_name` in App_GKE. **Do not change after initial deployment.** |
| `application_version` | `"4.5.1"` | Moodle version string, e.g. `"4.5.1"` | Version tag applied to the container image and used for deployment tracking. Increment this to trigger a new Cloud Build run and rolling update. |
| `application_display_name` | `"Moodle LMS"` | Any string | Human-readable name shown in the platform UI and GKE monitoring dashboards. Equivalent to `application_display_name` in App_GKE. Can be updated freely without affecting resource names. |
| `application_description` | `"Moodle Learning Management System on GKE Autopilot"` | Any string | Brief description of the deployment. Populated into Kubernetes resource annotations and platform documentation. Equivalent to `application_description` in App_GKE. |
| `description` | `"Moodle LMS - Online learning and course management platform"` | Any string | Additional description used by the internal `Moodle_Common` sub-module interface. Distinct from `application_description` — both are present. For most purposes, setting `application_description` is sufficient. |

### Validating Application Identity

```bash
# Confirm the Deployment exists with the expected name and namespace
kubectl get deployments -n NAMESPACE -o wide

# View workload annotations
kubectl describe deployment moodle -n NAMESPACE | grep -A5 Annotations
```

---

## Moodle Runtime Configuration

Moodle is a PHP 8.3/Apache application. The module exposes `cpu_limit` and `memory_limit` as **dedicated top-level variables** (passed through the `Moodle_Common` configuration layer) in addition to the standard `container_resources` object which is passed directly to App_GKE.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `cpu_limit` | `"2000m"` | Kubernetes CPU quantity string (e.g. `"1000m"`, `"4000m"`) | CPU limit for the Moodle application container. PHP with OPcache and concurrent student requests can generate significant CPU bursts during quiz rendering, grade calculations, and file operations. **Minimum `1000m` for development; `2000m` recommended for production.** |
| `memory_limit` | `"4Gi"` | Kubernetes memory quantity string (e.g. `"2Gi"`, `"4Gi"`) | Memory limit for the Moodle application container. PHP 8.3 with OPcache, active student sessions, and file upload handling typically consumes 1–2 Gi under normal load. **Minimum `1Gi` for development; `4Gi` recommended for production** with concurrent course delivery. |

> **Note on `container_resources`:** The standard `container_resources` object (documented in [App_GKE_Guide Group 3](../App_GKE/App_GKE_Guide.md#group-3-runtime--scaling)) is also available and is passed directly to App_GKE. Use it when you need to set `cpu_request`, `mem_request`, or `ephemeral_storage_limit`. The `cpu_limit` and `memory_limit` top-level variables are applied via the `Moodle_Common` application configuration layer and are the primary knobs for Moodle container sizing.

**Moodle-specific runtime defaults that differ from App_GKE:**

| Variable | App_GKE Default | Moodle_GKE Default | Reason |
|---|---|---|---|
| `application_name` | `"gkeapp"` | `"moodle"` | Moodle-specific application identifier. |
| `application_version` | `"1.0.0"` | `"4.5.1"` | Default Moodle release version. |
| `max_instance_count` | `3` | `5` | Moodle can scale horizontally when Redis handles PHP sessions and NFS provides shared file storage; a higher ceiling accommodates busy educational institutions. |
| `enable_custom_domain` | `false` | `true` | Required for correct `wwwroot` URL generation — Moodle must know its external URL at startup to render links correctly. A static IP is reserved automatically. |

### Validating Runtime Configuration

```bash
# View container resource requests and limits on the running pod
kubectl describe pod -n NAMESPACE -l app=moodle | grep -A10 "Limits:"

# Confirm the image and version being used
kubectl get deployment moodle -n NAMESPACE \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
```

---

## Moodle Database Configuration

Moodle requires PostgreSQL. The module uses `db_name` and `db_user` (shorter names aligned with the `Moodle_Common` interface) alongside the standard `application_database_name` and `application_database_user` variables from App_GKE. Both naming pairs are present; they serve distinct roles in the module's two-layer architecture.

All other database variables (`database_type`, `sql_instance_name`, `database_password_length`, `enable_auto_password_rotation`, `rotation_propagation_delay_sec`, etc.) behave identically to the App_GKE equivalents — refer to [App_GKE_Guide Group 10](../App_GKE/App_GKE_Guide.md#group-10-database-configuration) for their documentation.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `db_name` | `"moodle"` | `[a-z][a-z0-9_]{0,62}` | The database name passed to the `Moodle_Common` sub-module, used in Moodle-specific initialisation scripts. The companion variable `application_database_name` (default `"gkeapp"`) is passed to App_GKE for Cloud SQL provisioning. **Set both to the same value for a consistent deployment.** Do not change after initial deployment. |
| `db_user` | `"moodle"` | `[a-z][a-z0-9_]{0,31}` | The database user name passed to the `Moodle_Common` sub-module. The companion variable `application_database_user` (default `"gkeapp"`) is passed to App_GKE. **Set both to the same value for a consistent deployment.** |

> **Important:** Moodle requires PostgreSQL. Set `database_type = "POSTGRES_15"` (or another supported PostgreSQL version) in your `tfvars`. The module's default is `"POSTGRES"` (latest managed version). Setting `database_type = "NONE"` or a MySQL/SQL Server type will prevent Moodle from starting.

> **`pg_trgm` extension:** Required by Moodle for full-text search performance. Enable it by setting `enable_postgres_extensions = true` and `postgres_extensions = ["pg_trgm"]` in your `tfvars`.

### Validating Database Configuration

```bash
# Confirm the database and user were created
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID

gcloud sql users list --instance=INSTANCE_NAME --project=PROJECT_ID

# Confirm DB environment variables are injected into the pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep -E "^DB_"
```

---

## Moodle Environment Variables

The `environment_variables` variable (documented in [App_GKE_Guide Group 4](../App_GKE/App_GKE_Guide.md#group-4-environment-variables--secrets)) is supplemented by a set of Moodle-specific defaults that are **automatically injected** by the module.

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

# Reverse proxy (set based on whether application_domains is non-empty)
MOODLE_REVERSE_PROXY = "true"    # "false" when application_domains is empty
ENABLE_REVERSE_PROXY = "TRUE"    # "FALSE" when application_domains is empty

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

All other `environment_variables` and `secret_environment_variables` behaviour is identical to App_GKE — refer to [App_GKE_Guide Group 4](../App_GKE/App_GKE_Guide.md#group-4-environment-variables--secrets).

---

## Moodle Health Probes

Moodle performs database schema validation and plugin checks on startup. The module exposes **dedicated probe variables** — `startup_probe` and `liveness_probe` — with Moodle-specific defaults targeting the `/health.php` endpoint, which reflects both PHP availability and database connectivity and is more accurate for Moodle's readiness than a generic `/healthz` path.

In addition to these, the App_GKE passthrough variables `startup_probe_config` and `health_check_config` are also present in `Moodle_GKE`. Prefer the dedicated Moodle variables below — they are applied at the application layer via `Moodle_Common`.

| Variable | Default | Description & Implications |
|---|---|---|
| `startup_probe` | `{ enabled = true, type = "HTTP", path = "/health.php", initial_delay_seconds = 0, timeout_seconds = 10, period_seconds = 30, failure_threshold = 20 }` | Determines when the Moodle container is ready to receive traffic. The `/health.php` endpoint checks PHP availability and database connectivity. `failure_threshold = 20` with `period_seconds = 30` allows up to 10 minutes of startup time — sufficient for first-boot schema creation and plugin setup. On subsequent deployments the schema is already in place and startup is significantly faster, so the high failure threshold is a safety margin for initial rollouts. |
| `liveness_probe` | `{ enabled = true, type = "HTTP", path = "/health.php", initial_delay_seconds = 120, timeout_seconds = 10, period_seconds = 60, failure_threshold = 3 }` | Periodically checks whether the running Moodle instance is healthy. The `initial_delay_seconds = 120` prevents premature restarts during the post-startup phase. A `period_seconds = 60` interval is appropriate for a database-backed LMS — more frequent checks would add unnecessary load. |

> **Relationship to App_GKE probes:** `startup_probe` corresponds to `startup_probe_config` in App_GKE; `liveness_probe` corresponds to `health_check_config`. Their sub-field structure is identical. The `startup_probe_config` and `health_check_config` variables are also present in `Moodle_GKE` (with `/health.php` defaults) for compatibility — prefer the dedicated `startup_probe` and `liveness_probe` variables.

### Validating Health Probe Configuration

**Google Cloud Console:** Navigate to **Kubernetes Engine → Workloads → *moodle deployment***, click a pod, and select the **Events** tab to view probe failure events.

```bash
# View probe configuration on the running pod spec
kubectl get deployment moodle -n NAMESPACE \
  -o jsonpath='{.spec.template.spec.containers[0].startupProbe}' | jq .

kubectl get deployment moodle -n NAMESPACE \
  -o jsonpath='{.spec.template.spec.containers[0].livenessProbe}' | jq .

# View pod restart counts (rising count indicates probe failures)
kubectl get pods -n NAMESPACE -o wide

# View Moodle startup logs
kubectl logs -n NAMESPACE -l app=moodle --since=15m | head -150
```

---

## Redis Cache

Moodle uses Redis as the PHP session handler and application cache. When `enable_redis = true`, the `MOODLE_REDIS_ENABLED`, `MOODLE_REDIS_HOST`, `MOODLE_REDIS_PORT`, and `MOODLE_REDIS_PASSWORD` environment variables are injected automatically. **Redis is enabled by default** in `Moodle_GKE` because session consistency across multiple pod replicas requires a shared external session store — without it, users may be logged out when a request is routed to a different pod.

For detailed documentation on the Redis variables `enable_redis`, `redis_host`, `redis_port`, and `redis_auth`, refer to [App_GKE_Guide](../App_GKE/App_GKE_Guide.md) — the variable semantics are identical, but the defaults differ:

| Variable | App_GKE Default | Moodle_GKE Default | Reason |
|---|---|---|---|
| `enable_redis` | — | `true` | Redis session handling is critical for Moodle with multiple pod replicas. |
| `redis_host` | `""` | `""` | Defaults to NFS server IP when blank. Override with a Cloud Memorystore instance IP for production. |
| `redis_port` | `"6379"` | `"6379"` | Standard Redis port. |
| `redis_auth` | `""` | `""` | Set to the Memorystore AUTH string for production deployments. |

### Validating Redis Configuration

```bash
# Confirm MOODLE_REDIS_* variables are injected into the pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep MOODLE_REDIS

# Test Redis connectivity from a debug pod within the cluster
kubectl run redis-test --rm -it --image=redis:alpine --restart=Never -- \
  redis-cli -h REDIS_HOST -p 6379 ping
```

---

## Backup Import & Recovery

In addition to the scheduled backup (`backup_schedule` and `backup_retention_days`, documented in [App_GKE_Guide Group 11](../App_GKE/App_GKE_Guide.md#group-11-backup-schedule--retention)), `Moodle_GKE` supports a **one-time import** of an existing Moodle database backup during deployment. This is designed for migrating an existing Moodle instance to GCP or seeding a new environment with production data.

The key naming difference from App_GKE is that **`backup_uri`** (a full GCS object path or Google Drive file ID) is used instead of `backup_file` (a filename relative to the backup bucket). The value is mapped internally to the App_GKE `backup_file` input.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_backup_import` | `false` | `true` / `false` | When `true`, triggers a one-time Kubernetes Job to restore the backup at `backup_uri`. The import runs after the database is provisioned. **If the database already contains data**, the import may produce errors — test in a non-production environment first. |
| `backup_source` | `"gcs"` | `gcs` / `gdrive` | The source from which the backup file is retrieved. **`gcs`:** provide the full GCS URI in `backup_uri`. **`gdrive`:** provide the Google Drive file ID in `backup_uri`. Only used when `enable_backup_import = true`. |
| `backup_uri` | `""` | Full GCS URI or Google Drive file ID | For GCS: e.g. `"gs://my-bucket/backups/moodle.sql.gz"`. For Google Drive: the file ID from the share URL (the string after `/file/d/` in the URL). Required when `enable_backup_import = true`. |
| `backup_format` | `"sql"` | `sql` / `tar` / `gz` / `tgz` / `tar.gz` / `zip` / `auto` | The format of the backup file. The default `"sql"` is appropriate for `pg_dump` plain-text output. Use `"gz"` for gzip-compressed dumps. |

### Validating Backup Import

```bash
# Confirm the import job completed successfully
kubectl get jobs -n NAMESPACE --selector=app=backup-import

kubectl logs -n NAMESPACE -l job-name=IMPORT_JOB_NAME

# Verify Moodle data is present after import
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID
```

---

## StatefulSet PVC Configuration

When `workload_type = "StatefulSet"` is set (see [App_GKE_Guide Group 5](../App_GKE/App_GKE_Guide.md#group-5-gke-backend-configuration)), the following variables configure the per-pod **PersistentVolumeClaim** created for each replica. For full documentation on each variable, refer to [App_GKE_Guide Group 5](../App_GKE/App_GKE_Guide.md#group-5-gke-backend-configuration).

> **Moodle use case:** StatefulSets are generally not needed for `Moodle_GKE` because course files and uploads are stored on the shared NFS volume (accessible by all pods simultaneously) and the GCS bucket. The default `Deployment` workload type is recommended for Moodle. Use a StatefulSet only if your Moodle configuration requires per-pod local disk storage.

The following StatefulSet variables are present in `Moodle_GKE` and pass through to App_GKE with the same behaviour and defaults:

| Variable | Default |
|---|---|
| `stateful_pvc_enabled` | `false` |
| `stateful_pvc_size` | `"10Gi"` |
| `stateful_pvc_mount_path` | `"/data"` |
| `stateful_pvc_storage_class` | `"standard-rwo"` |
| `stateful_headless_service` | `true` |
| `stateful_pod_management_policy` | `"OrderedReady"` |
| `stateful_update_strategy` | `"RollingUpdate"` |

---

## Deployment Prerequisites & Validation

After deploying `Moodle_GKE`, confirm the deployment is healthy:

```bash
# Confirm the Moodle pod is running and ready
kubectl get pods -n NAMESPACE -l app=moodle -o wide

# Confirm the Cloud Scheduler cron job was created (fires every minute)
gcloud scheduler jobs list \
  --location=REGION \
  --project=PROJECT_ID \
  --filter="name~moodle-cron" \
  --format="table(name,schedule,state)"

# View the reserved static IP (needed for DNS configuration)
gcloud compute addresses list \
  --global \
  --project=PROJECT_ID \
  --format="table(name,address,status)"

# Confirm the GCS moodle-data bucket was provisioned
gcloud storage buckets list \
  --project=PROJECT_ID \
  --filter="name~moodle-data"

# Confirm the pg_trgm extension is installed (if enabled)
gcloud sql connect INSTANCE_NAME --user=postgres --database=DB_NAME --project=PROJECT_ID
# Inside psql: \dx

# View Moodle startup logs
kubectl logs -n NAMESPACE -l app=moodle --since=15m | head -150

# Check the Moodle health endpoint via port-forward
kubectl port-forward -n NAMESPACE svc/moodle 8080:80 &
curl -s http://localhost:8080/health.php
# Expect: a 200 response indicating PHP and database are healthy
```
