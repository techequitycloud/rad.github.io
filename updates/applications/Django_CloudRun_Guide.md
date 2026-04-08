# Django_CloudRun Module — Configuration Guide

Django is a high-level Python web framework that encourages rapid development and clean, pragmatic design. This module deploys a production-ready Django application on **Google Cloud Run**, backed by a managed Cloud SQL PostgreSQL instance, GCS media storage, and Secret Manager for secrets including the Django `SECRET_KEY`.

`Django_CloudRun` is a **wrapper module** built on top of `App_CloudRun`. It uses `App_CloudRun` for all GCP infrastructure provisioning (Cloud Run service, networking, Cloud SQL, GCS, Filestore, secrets, CI/CD) and adds Django-specific application configuration on top via the `Django_Common` sub-module.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How This Guide Is Structured

This guide documents only the variables that are **unique to `Django_CloudRun`** or that have **Django-specific defaults** that differ from the `App_CloudRun` base module. For all other variables — project identity, runtime scaling, CI/CD, backup, custom SQL, storage, networking, IAP, Cloud Armor, and VPC Service Controls — refer directly to the [App_CloudRun Configuration Guide](../App_CloudRun/App_CloudRun_Guide.md).

**Variables fully covered by the App_CloudRun guide:**

| Configuration Area | App_CloudRun_Guide Section | Django-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | Group 0 | Different defaults for `module_description` and `module_documentation`. |
| Project & Identity | Group 1 | Refer to base App_CloudRun module documentation. |
| Application Identity | Group 2 | See [Django Application Identity](#django-application-identity) below. `application_name` defaults to `"django"`. |
| Runtime & Scaling | Group 3 | `min_instance_count` defaults to `0` (scale-to-zero). `container_port` defaults to `8080`. `enable_cloudsql_volume` defaults to `true` (Unix socket connection to Cloud SQL). |
| Environment Variables & Secrets | Group 4 | Django_Common injects `DB_HOST`, `DB_ENGINE`, `SECRET_KEY`, and other database variables automatically — see [Platform-Managed Behaviours](#platform-managed-behaviours). |
| Observability & Health | Group 5 | See [Django Health Probes](#django-health-probes) — Django_CloudRun exposes a dual probe system with `/healthz` defaults. |
| Jobs & Scheduled Tasks | Group 6 | See [Initialization Jobs](#initialization-jobs) — a default `db-init` job is pre-configured. |
| CI/CD & GitHub Integration | Group 7 | Refer to base App_CloudRun module documentation. |
| Storage — NFS | Group 8 | `enable_nfs` defaults to `true` for Django. Requires `execution_environment = "gen2"` (the default). |
| Storage — GCS | Group 9 | Refer to base App_CloudRun module documentation. The media GCS bucket is provisioned automatically by Django_Common. |
| Redis Cache | Group 10 | See [Redis Configuration](#redis-configuration) — Django uses Redis for sessions and caching. |
| Database Backend | Group 11 | See [Django Database Configuration](#django-database-configuration) — PostgreSQL required, extensions auto-installed. |
| Backup & Maintenance | Group 12 | Refer to base App_CloudRun module documentation. |
| Custom Initialisation & SQL | Group 13 | Refer to base App_CloudRun module documentation. |
| Access & Networking | Group 14 | `vpc_egress_setting` defaults to `"PRIVATE_RANGES_ONLY"`. `ingress_settings` defaults to `"all"`. Refer to the App_CloudRun guide for full documentation. |
| Identity-Aware Proxy | Group 15 | Refer to base App_CloudRun module documentation. |
| Cloud Armor & CDN | Group 16 | Refer to base App_CloudRun module documentation. |
| VPC Service Controls | Group 17 | Refer to base App_CloudRun module documentation. |

---

## Platform-Managed Behaviours

The following behaviours are applied automatically by `Django_CloudRun` (via the `Django_Common` sub-module) regardless of the variable values in your `tfvars` file. They cannot be overridden by user configuration.

| Behaviour | Detail |
|---|---|
| **Django environment variables** | `Django_Common` injects the following environment variables automatically: `DB_ENGINE` (`django.db.backends.postgresql`), `DB_HOST` (Cloud SQL Auth Proxy socket path, e.g. `/cloudsql/PROJECT:REGION:INSTANCE`), `DB_PORT` (`5432`), `DB_NAME`, `DB_USER`. These values are derived from the Cloud SQL instance provisioned by `App_CloudRun` and do not need to be set manually in `environment_variables`. |
| **Django secret key** | A random `SECRET_KEY` is auto-generated and stored in Secret Manager. It is injected into the container as the `SECRET_KEY` environment variable via `module_secret_env_vars`. **Do not set `SECRET_KEY` in `environment_variables`** — the platform-managed value in Secret Manager takes precedence. |
| **PostgreSQL extensions** | The following extensions are installed automatically in the application database during the initialisation job: `pg_trgm`, `unaccent`, `hstore`, `citext`. These are required for Django's full-text search, accent-insensitive lookups, and schema-flexible field types. You do not need to set `enable_postgres_extensions = true` for these extensions. |
| **Database initialisation** | A dedicated Django database user is created with the password from Secret Manager and granted the permissions required by the application. The `postgres` superuser is used only for the extension and user setup jobs. |
| **GCS media storage** | When `gcs_volumes` is configured (e.g. a bucket mounted at `/app/media`), `Django_Common` provisions the bucket and grants the application service account `roles/storage.objectAdmin` and `roles/storage.legacyBucketReader`. The Django container (running as UID `2000`) can read and write user-uploaded media files directly to the GCS-mounted path. |
| **Non-root container user** | The Django container runs as a non-root user (UID `2000`). This UID matches the GCS FUSE user mapping to ensure write permissions on the media mount. Do not change the container's UID unless you also update the GCS FUSE mount configuration. |
| **NFS enabled by default** | `enable_nfs` defaults to `true`. Requires `execution_environment = "gen2"` (the default). If you configure GCS volumes for media instead of NFS, set `enable_nfs = false` to suppress Filestore provisioning. |
| **Default db-init job** | The `initialization_jobs` variable includes a pre-configured `db-init` job that creates the Django database and user. This job runs automatically on the first deployment. See [Initialization Jobs](#initialization-jobs). |

---

## Django Application Identity

These variables have Django-specific defaults. Their semantics are identical to the equivalents in [App_CloudRun_Guide Group 2](../App_CloudRun/App_CloudRun_Guide.md#group-2-application-identity).

| Variable | Default | Description & Implications |
|---|---|---|
| `application_name` | `"django"` | Internal identifier used as the base name for the Cloud Run service, Artifact Registry repository, Secret Manager secrets, and GCS buckets. Functionally identical to `application_name` in App_CloudRun. **Do not change after initial deployment.** |
| `application_display_name` | `"Django Application"` | Human-readable name shown in the platform UI, the Cloud Run service list, and monitoring dashboards. Can be updated freely at any time. |
| `application_description` | `"Django Application - High-level Python Web framework"` | Brief description populated into the Cloud Run service description field and platform documentation. |
| `application_version` | `"latest"` | Version tag applied to the container image. When `container_image_source = "custom"`, incrementing this value triggers a new Cloud Build run. Prefer a pinned version (e.g. `"v1.2.0"`) over `"latest"` in production to ensure reproducible deployments. |

### Validating Application Identity

```bash
# Confirm the Cloud Run service exists with the expected name
gcloud run services describe django \
  --region=REGION \
  --format="table(metadata.name,metadata.annotations['run.googleapis.com/description'])"
```

---

## Django Database Configuration

Django requires PostgreSQL. All database variables behave identically to those documented in [App_CloudRun_Guide Group 11](../App_CloudRun/App_CloudRun_Guide.md#group-11-database-backend), with the following Django-specific notes.

| Variable | Default | Description & Implications |
|---|---|---|
| `application_database_name` | `"django_db"` | The name of the PostgreSQL database created within the Cloud SQL instance. Injected as `DB_NAME`. **Do not change after initial deployment** — renaming the database requires manual data migration. |
| `application_database_user` | `"django_user"` | The PostgreSQL user created for the Django application. Injected as `DB_USER`. The password is auto-generated, stored in Secret Manager, and injected as `DB_PASSWORD`. |

> **Note on `database_type`:** Django requires PostgreSQL. The module uses the Cloud SQL engine specified by `database_type` (documented in [App_CloudRun_Guide Group 11](../App_CloudRun/App_CloudRun_Guide.md#group-11-database-backend)). Do not change to `MYSQL` or `SQLSERVER` — the `DB_ENGINE` variable (`django.db.backends.postgresql`) is hard-wired by `Django_Common` and will not work with non-PostgreSQL engines. Use a versioned value such as `"POSTGRES_15"` for consistency across environments.

> **PostgreSQL extensions** are installed automatically by `Django_Common` — see [Platform-Managed Behaviours](#platform-managed-behaviours). You do not need to set `enable_postgres_extensions = true` for the Django-required extensions.

### Validating Database Configuration

```bash
# Confirm the database and user were created
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID

gcloud sql users list --instance=INSTANCE_NAME --project=PROJECT_ID

# Confirm DB environment variables are injected into the Cloud Run service
gcloud run services describe django \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -E "DB_"

# Confirm SECRET_KEY is injected as a secret reference
gcloud run services describe django \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" | grep SECRET_KEY
```

---

## Django Health Probes

`Django_CloudRun` exposes **two independent probe systems**:

1. **`startup_probe` / `liveness_probe`** — these are used by the `Django_Common` sub-module and configure how the initialisation scripts and application entrypoint assess Django readiness. They are passed into Django_Common and are separate from the Cloud Run infrastructure probe configuration.

2. **`startup_probe_config` / `health_check_config`** — these are passed directly to `App_CloudRun` and configure the actual **Cloud Run startup and liveness probes** on the container revision. They correspond to the variables of the same names documented in [App_CloudRun_Guide Group 5](../App_CloudRun/App_CloudRun_Guide.md#group-5-observability--health).

For most deployments you will adjust both sets. `startup_probe` / `liveness_probe` control Django_Common's internal readiness assessment, while `startup_probe_config` / `health_check_config` control the Cloud Run infrastructure health checks that determine whether traffic is routed to an instance.

**`startup_probe` and `liveness_probe` (Django_Common internal probes):**

| Variable | Default | Description & Implications |
|---|---|---|
| `startup_probe` | `{ enabled = true, type = "HTTP", path = "/healthz", initial_delay_seconds = 60, timeout_seconds = 5, period_seconds = 10, failure_threshold = 3 }` | Used by `Django_Common` to assess whether Django has started successfully. The `/healthz` path is the recommended Django health check endpoint. `initial_delay_seconds = 60` accounts for database connection establishment and application loading. |
| `liveness_probe` | `{ enabled = true, type = "HTTP", path = "/healthz", initial_delay_seconds = 30, timeout_seconds = 5, period_seconds = 30, failure_threshold = 3 }` | Used by `Django_Common` to assess whether a running Django instance is healthy. Periodically hits `/healthz` and triggers a restart if `failure_threshold` consecutive checks fail. |

**`startup_probe_config` / `health_check_config` (Cloud Run infrastructure probes):**

Django-specific defaults differ from the App_CloudRun base:
- `startup_probe_config`: `{ enabled = true, type = "HTTP", path = "/healthz", initial_delay_seconds = 10, timeout_seconds = 5, period_seconds = 10, failure_threshold = 10 }`
- `health_check_config`: `{ enabled = true, type = "HTTP", path = "/healthz", initial_delay_seconds = 15, timeout_seconds = 5, period_seconds = 30, failure_threshold = 3 }`

Both use `/healthz` as the default path. Cloud Run will not route traffic to an instance until `startup_probe_config` succeeds. `failure_threshold = 10` gives Django up to ~110 seconds of startup time before the instance is considered failed.

> **Best practice:** Implement a dedicated `/healthz` view in your Django application that returns `HTTP 200` when the app is ready (database connected, migrations applied). The `django-health-check` package or a simple view function that tests the database connection is recommended.

### Validating Health Probe Configuration

**Google Cloud Console:** Navigate to **Cloud Run → Services → django → Revisions**, select the latest revision, then click **Container(s)** and view the **Health checks** section.

```bash
# View startup and liveness probe config on the latest revision
gcloud run services describe django \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].livenessProbe,spec.template.spec.containers[0].startupProbe)"

# View Cloud Run logs for startup or probe failures
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=django AND severity>=WARNING" \
  --project=PROJECT_ID \
  --limit=20 \
  --format="table(timestamp,severity,textPayload)"
```

---

## Redis Configuration

Django uses Redis as a session store and caching backend via `django-redis`. When `enable_redis = true`, the `REDIS_HOST` and `REDIS_PORT` environment variables are injected automatically into the Django container by `Django_Common`.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `false` | `true` / `false` | When `true`, `REDIS_HOST` and `REDIS_PORT` are injected into the container. Your Django `settings.py` must be configured to use these variables for `CACHES` and `SESSION_ENGINE`. Recommended for production deployments where persistent sessions or shared caching across multiple instances is required. |
| `redis_host` | `""` | IP address or hostname | The hostname or IP address of the Redis server. For Cloud Run, this must be a reachable address over the VPC — typically the private IP of a Cloud Memorystore for Redis instance. Ensure `vpc_egress_setting` is set to `"PRIVATE_RANGES_ONLY"` (the default) or `"ALL_TRAFFIC"` so that Cloud Run can reach the private Redis endpoint. |
| `redis_port` | `6379` | Integer | The TCP port of the Redis server. The default `6379` is correct for Cloud Memorystore and most self-hosted Redis instances. |
| `redis_auth` | `""` *(no authentication)* | Password string *(sensitive)* | Authentication password for the Redis server. Leave empty if the Redis instance does not require authentication. When set, the value is stored securely and never appears in Terraform state in plaintext. For Cloud Memorystore with AUTH enabled, set this to the instance's auth string. |

> **Provisioning Redis:** The `Django_CloudRun` module does not provision a Redis instance. Provision a Cloud Memorystore for Redis instance separately and set `redis_host` to its private IP address.

> **VPC connectivity:** Cloud Run must be able to reach the private Redis IP. Ensure the Cloud Run service has VPC egress configured (`vpc_egress_setting = "PRIVATE_RANGES_ONLY"`) and that the VPC network contains a subnet in the same region as the Redis instance.

### Validating Redis Configuration

```bash
# Confirm REDIS_HOST and REDIS_PORT are injected into the Cloud Run revision
gcloud run services describe django \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" | grep REDIS
```

---

## Initialization Jobs

Django deployments require database setup and schema migration jobs to run before (or immediately after) the application starts. `Django_CloudRun` pre-configures a default `db-init` job and supports additional Django-specific jobs.

**Default `initialization_jobs` in `Django_CloudRun`:**

```hcl
initialization_jobs = [
  {
    name              = "db-init"
    description       = "Initialize Sample Database"
    image             = "postgres:15-alpine"
    command           = ["/bin/sh"]
    script_path       = "scripts/db-init.sh"
    mount_nfs         = false
    mount_gcs_volumes = []
    execute_on_apply  = true
  }
]
```

The `db-init` job runs automatically on every `terraform apply` (`execute_on_apply = true`). It uses the `postgres:15-alpine` image (separate from the Django application image) to create the database, user, and PostgreSQL extensions using the `postgres` superuser credentials from Secret Manager. The script is idempotent — running it on an already-initialised database is safe.

**Adding a Django migration job:**

To run `python manage.py migrate` as part of the deployment, extend the `initialization_jobs` list:

```hcl
initialization_jobs = [
  {
    name              = "db-init"
    description       = "Create Django Database and User"
    image             = "postgres:15-alpine"
    command           = ["/bin/sh"]
    script_path       = "scripts/db-init.sh"
    mount_nfs         = false
    mount_gcs_volumes = []
    execute_on_apply  = true
  },
  {
    name              = "db-migrate"
    description       = "Run Django Migrations"
    image             = null                           # Uses the application image
    script_path       = "migrate.sh"
    mount_nfs         = false
    mount_gcs_volumes = ["django-media"]               # If GCS media volume is configured
    execute_on_apply  = false
  }
]
```

> **Script location:** Both `db-init.sh` and `migrate.sh` are provided by `Django_Common` at `modules/Django_Common/scripts/`. They are referenced via `script_path` and loaded automatically by the platform.

> **Job ordering:** Jobs are executed in the order they appear in the list, unless `depends_on_jobs` is specified. Always list `db-init` before `db-migrate`.

> **Superuser creation:** The `entrypoint.sh` in the Django_Common container checks for `DJANGO_SUPERUSER_USERNAME`, `DJANGO_SUPERUSER_EMAIL`, and `DJANGO_SUPERUSER_PASSWORD` environment variables and programmatically creates a superuser if one does not already exist. Set these via `secret_environment_variables` rather than `environment_variables` to keep credentials out of Terraform state.

For full documentation of all `initialization_jobs` sub-fields (resource limits, timeouts, retry policies, volume mounts), refer to [App_CloudRun_Guide Group 6](../App_CloudRun/App_CloudRun_Guide.md#group-6-jobs--scheduled-tasks).

### Validating Initialization Jobs

```bash
# List all Cloud Run job executions
gcloud run jobs executions list \
  --job=django-db-init \
  --region=REGION \
  --format="table(name,status.conditions[0].type,status.startTime,status.completionTime)"

# View db-init job logs
gcloud logging read \
  "resource.type=cloud_run_job AND resource.labels.job_name=django-db-init" \
  --project=PROJECT_ID \
  --limit=50 \
  --order=asc \
  --format="table(timestamp,severity,textPayload)"

# Confirm the database was created
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID
```

---

## Password Rotation Propagation Delay

The `rotation_propagation_delay_sec` variable controls how long the module waits after writing a new database password to Secret Manager before restarting the Cloud Run service to pick up the new credentials. It is used together with `enable_auto_password_rotation` (documented in [App_CloudRun_Guide Group 11](../App_CloudRun/App_CloudRun_Guide.md#group-11-database-backend)).

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `rotation_propagation_delay_sec` | `90` | Integer (seconds) | Seconds to wait after updating the `DB_PASSWORD` secret before triggering a new Cloud Run revision to pick up the new credentials. This delay allows Secret Manager's global replication to complete before the application reconnects. **Increase to `120`** in multi-region deployments or if you observe rotation failures. Only used when `enable_auto_password_rotation = true`. |

---

## Resource Creator Identity

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `resource_creator_identity` | `"rad-module-creator@tec-rad-ui-2b65.iam.gserviceaccount.com"` | Service account email | The service account used by Terraform to create and manage GCP resources. For enhanced security, replace with a project-scoped service account granted only the minimum permissions required by this module. |

---

## Deployment Prerequisites & Validation

After deploying `Django_CloudRun`, confirm the deployment is healthy:

```bash
# Confirm the Cloud Run service is deployed and view its URL
gcloud run services describe django \
  --region=REGION \
  --format="table(status.url,status.conditions[0].type)"

# View the latest revision status
gcloud run revisions list \
  --service=django \
  --region=REGION \
  --format="table(name,status.conditions[0].status,spec.containerConcurrency)"

# Confirm the GCS bucket provisioned for Django media storage
gcloud storage buckets list \
  --project=PROJECT_ID \
  --filter="name:django-media"

# Confirm the db-init job completed successfully
gcloud run jobs executions list \
  --job=django-db-init \
  --region=REGION \
  --format="table(name,status.conditions[0].type)"

# Confirm DB environment variables and SECRET_KEY are injected
gcloud run services describe django \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -E "DB_|SECRET_KEY"

# Verify the Django health endpoint is responding
SERVICE_URL=$(gcloud run services describe django --region=REGION --format="value(status.url)")
curl -s -o /dev/null -w "%{http_code}" ${SERVICE_URL}/healthz
# Expect: 200
```
