---
title: "Django GKE Configuration Guide"
sidebar_label: "GKE"
---

# Django GKE Module — Configuration Guide

<video width="100%" controls style={{marginTop: '20px'}} poster="https://storage.googleapis.com/rad-public-2b65/modules/Django_GKE.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/modules/Django_GKE.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

<a href="https://storage.googleapis.com/rad-public-2b65/modules/Django_GKE.pdf" target="_blank">View Presentation (PDF)</a>

Django is a high-level Python web framework that encourages rapid development and clean, pragmatic design. This module deploys a production-ready Django application on **GKE Autopilot**, backed by a managed Cloud SQL PostgreSQL instance, GCS media storage, and Secret Manager for secrets including the Django `SECRET_KEY`.

`Django GKE` is a **wrapper module** built on top of `App GKE`. It uses `App GKE` for all GCP infrastructure provisioning (cluster, networking, Cloud SQL, GCS, Filestore, secrets, CI/CD) and adds Django-specific application configuration on top via the `Django_Common` sub-module.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How This Guide Is Structured

This guide documents only the variables that are **unique to `Django GKE`** or that have **Django-specific defaults** that differ from the `App GKE` base module. For all other variables — project identity, runtime scaling, backend configuration, CI/CD, networking, IAP, Cloud Armor, and VPC Service Controls — refer directly to the [App GKE Configuration Guide](../App_GKE/App_GKE_Guide.md).

**Variables fully covered by the App GKE guide:**

| Configuration Area | App_GKE_Guide Section | Django-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | Group 0 | Different defaults for `module_description` and `module_documentation`. |
| Project & Identity | Group 1 | Refer to base App GKE module documentation. |
| Application Identity | Group 2 | See [Django Application Identity](#django-application-identity) below. `application_name` defaults to `"django"`. |
| Runtime & Scaling | Group 3 | `min_instance_count` defaults to `0`. `container_image_source` defaults to `"custom"`. `container_port` defaults to `8080`. |
| Environment Variables & Secrets | Group 4 | Django_Common injects `DB_HOST`, `DB_ENGINE`, `SECRET_KEY`, and other database variables automatically — see [Platform-Managed Behaviours](#platform-managed-behaviours). |
| GKE Backend Configuration | Group 5 | `session_affinity` defaults to `"ClientIP"` — see [Session Affinity](#session-affinity). All other GKE backend variables are documented in the App GKE guide. |
| Jobs & Scheduled Tasks | Group 6 | See [Initialization Jobs](#initialization-jobs) for Django-specific job patterns. |
| CI/CD & GitHub Integration | Group 7 | Refer to base App GKE module documentation. |
| Storage — NFS | Group 8 | `enable_nfs` defaults to `true` for Django (shared file storage across pods). |
| Storage — GCS | Group 9 | Refer to base App GKE module documentation. The media GCS bucket is provisioned automatically by Django_Common. |
| Database Configuration | Group 10 | See [Django Database Configuration](#django-database-configuration). PostgreSQL required, extensions auto-installed. |
| Backup Schedule & Retention | Group 11 | Refer to base App GKE module documentation. |
| Custom SQL Scripts | Group 12 | Refer to base App GKE module documentation. |
| Observability & Health | Group 13 | See [Django Health Probes](#django-health-probes) — Django GKE exposes a dual probe system. |
| Reliability Policies | Group 14 | Refer to base App GKE module documentation. |
| Resource Quota | Group 15 | Refer to base App GKE module documentation. |
| Custom Domain, Static IP & Network | Group 16 | Refer to base App GKE module documentation. |
| Identity-Aware Proxy | Group 17 | Refer to base App GKE module documentation. |
| Cloud Armor | Group 18 | Refer to base App GKE module documentation. |

---

## Platform-Managed Behaviours

The following behaviours are applied automatically by `Django GKE` (via the `Django_Common` sub-module) regardless of the variable values in your `tfvars` file. They cannot be overridden by user configuration.

| Behaviour | Detail |
|---|---|
| **Django environment variables** | `Django_Common` injects the following environment variables automatically: `DB_ENGINE` (`django.db.backends.postgresql`), `DB_HOST` (Cloud SQL Auth Proxy socket path, e.g. `/cloudsql/PROJECT:REGION:INSTANCE`), `DB_PORT` (`5432`), `DB_NAME`, `DB_USER`. These values are derived from the Cloud SQL instance provisioned by `App GKE` and do not need to be set manually in `environment_variables`. |
| **Django secret key** | A random `SECRET_KEY` is auto-generated and stored in Secret Manager. It is injected into the container as the `SECRET_KEY` environment variable via `module_secret_env_vars`. **Do not set `SECRET_KEY` in `environment_variables`** — the platform-managed value in Secret Manager takes precedence. |
| **PostgreSQL extensions** | The following extensions are installed automatically in the application database during the initialisation job: `pg_trgm`, `unaccent`, `hstore`, `citext`. These are required for Django's full-text search, accent-insensitive lookups, and schema-flexible field types. You do not need to set `enable_postgres_extensions = true` for these extensions. |
| **Database initialisation** | A dedicated Django database user is created with the password from Secret Manager and granted the permissions required by the application. The `postgres` superuser is used only for the extension and user setup jobs. |
| **GCS media storage** | When `gcs_volumes` is configured (e.g. a bucket mounted at `/app/media`), `Django_Common` provisions the bucket and grants the application service account `roles/storage.objectAdmin` and `roles/storage.legacyBucketReader`. The Django application can read and write user-uploaded media files directly to the GCS-mounted path. |
| **NFS enabled by default** | `enable_nfs` defaults to `true` so that shared persistent storage is available across all pod replicas for Django media files. If you configure GCS volumes for media instead of NFS, set `enable_nfs = false` to suppress Filestore provisioning. |
| **Session affinity** | `session_affinity` defaults to `"ClientIP"` so that a given user's requests are consistently routed to the same pod. This prevents session inconsistency in deployments that use in-process session storage or local caching rather than Redis. |

---

## Django Application Identity

These variables have Django-specific defaults. Their semantics are identical to the equivalents in [App_GKE_Guide Group 2](../App_GKE/App_GKE_Guide.md#group-2-application-identity).

| Variable | Default | Description & Implications |
|---|---|---|
| `application_name` | `"django"` | Internal identifier used as the base name for GKE workloads, Cloud SQL, GCS buckets, and Artifact Registry. Functionally identical to `application_name` in App GKE. **Do not change after initial deployment.** |
| `application_display_name` | `"Django Application"` | Human-readable name shown in the platform UI and monitoring dashboards. Can be updated freely at any time. |
| `application_description` | `"Django Application - High-level Python Web framework on GKE Autopilot"` | Brief description populated into Kubernetes annotations and platform documentation. |
| `application_version` | `"latest"` | Version tag applied to the container image. When `container_image_source = "custom"`, incrementing this value triggers a new Cloud Build run. Prefer a pinned version (e.g. `"v1.2.0"`) over `"latest"` in production to ensure reproducible deployments. |

### Validating Application Identity

```bash
# Confirm the Deployment exists with the expected name
kubectl get deployments -n NAMESPACE -o wide

# View workload annotations (description is stored here)
kubectl describe deployment django -n NAMESPACE | grep -A5 Annotations
```

---

## Django Database Configuration

Django requires PostgreSQL. All database variables behave identically to those documented in [App_GKE_Guide Group 10](../App_GKE/App_GKE_Guide.md#group-10-database-configuration), with the following Django-specific notes.

| Variable | Default | Description & Implications |
|---|---|---|
| `application_database_name` | `"gkeapp"` | The name of the PostgreSQL database created within the Cloud SQL instance. Injected as `DB_NAME`. **Recommended: change to `"django_db"`** to clearly identify this as a Django database. **Do not change after initial deployment** — renaming the database requires manual data migration. |
| `application_database_user` | `"gkeapp"` | The PostgreSQL user created for the Django application. Injected as `DB_USER`. **Recommended: change to `"django_user"`** for clarity. The password is auto-generated, stored in Secret Manager, and injected as `DB_PASSWORD`. |
| `database_type` | `"POSTGRES"` | Cloud SQL database engine. **Django requires PostgreSQL** — do not change to `MYSQL` or `SQLSERVER`. The Django `DB_ENGINE` variable (`django.db.backends.postgresql`) is hard-wired by `Django_Common` and will not work with non-PostgreSQL engines. Use a versioned value such as `"POSTGRES_15"` in production for consistency across environments. |
| `enable_postgres_extensions` | `false` | You do not need to set this to `true` for Django's required extensions (`pg_trgm`, `unaccent`, `hstore`, `citext`) — these are installed automatically by `Django_Common`. Set `enable_postgres_extensions = true` only if you need to install **additional** extensions beyond those managed by the platform. |
| `postgres_extensions` | `[]` | Additional PostgreSQL extensions to install. Used only when `enable_postgres_extensions = true`. The Django_Common-managed extensions (`pg_trgm`, `unaccent`, `hstore`, `citext`) are always installed regardless of this list. Common additions: `postgis` (geospatial queries), `uuid-ossp` (UUID generation), `pg_stat_statements` (query performance analysis). |
| `enable_mysql_plugins` | `false` | MySQL plugins. Not applicable for Django — Django does not support MySQL in the default module configuration. Leave as `false`. |
| `mysql_plugins` | `[]` | MySQL plugins list. Not applicable for Django. Leave as `[]`. |

> **Note on `database_password_length`:** This variable, the `database_password_length` default, and the `enable_auto_password_rotation` / `rotation_propagation_delay_sec` variables are documented in [App_GKE_Guide Group 10](../App_GKE/App_GKE_Guide.md#group-10-database-configuration). See also [Password Rotation Propagation Delay](#password-rotation-propagation-delay) below.

### Validating Database Configuration

```bash
# Confirm the database and user were created
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID

gcloud sql users list --instance=INSTANCE_NAME --project=PROJECT_ID

# Confirm DB environment variables are injected into the running pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep -E "^DB_"

# Confirm SECRET_KEY is injected
kubectl exec -n NAMESPACE POD_NAME -- env | grep SECRET_KEY
```

---

## Django Health Probes

`Django GKE` exposes **two independent probe systems**:

1. **`startup_probe` / `liveness_probe`** — these are used by the `Django_Common` sub-module to configure how the initialisation scripts and application entrypoint assess Django readiness. They are separate from the Kubernetes probe configuration.

2. **`startup_probe_config` / `health_check_config`** — these are passed directly to `App GKE` and configure the actual **Kubernetes startup and liveness probes** on the pod. They correspond to the variables of the same names documented in [App_GKE_Guide Group 13](../App_GKE/App_GKE_Guide.md#group-13-observability--health).

For most deployments you will adjust only `startup_probe_config` and `health_check_config` (the Kubernetes probes). The `startup_probe` and `liveness_probe` variables control the internal Django readiness assessment and normally do not need to be changed.

**`startup_probe` and `liveness_probe` (Django_Common internal probes):**

| Variable | Default | Description & Implications |
|---|---|---|
| `startup_probe` | `{ enabled = true, type = "HTTP", path = "/", initial_delay_seconds = 90, timeout_seconds = 5, period_seconds = 10, failure_threshold = 3 }` | Used by `Django_Common` to assess whether Django has started successfully. `initial_delay_seconds = 90` accounts for Django's startup time (database connection, application loading). The path `/` assumes a Django view responds to the root URL — configure a dedicated `/healthz/` view for cleaner health signalling. |
| `liveness_probe` | `{ enabled = true, type = "HTTP", path = "/", initial_delay_seconds = 60, timeout_seconds = 5, period_seconds = 30, failure_threshold = 3 }` | Used by `Django_Common` to assess whether a running Django instance is healthy. |

**`startup_probe_config` / `health_check_config` (Kubernetes infrastructure probes):**

These variables control the probes that Kubernetes applies to the pod. They are documented in [App_GKE_Guide Group 13](../App_GKE/App_GKE_Guide.md#group-13-observability--health).

Django-specific defaults:
- `startup_probe_config`: `{ enabled = true, type = "TCP", path = "/", initial_delay_seconds = 0, timeout_seconds = 240, period_seconds = 240, failure_threshold = 1 }`
- `health_check_config`: `{ enabled = true, type = "HTTP", path = "/", initial_delay_seconds = 0, timeout_seconds = 1, period_seconds = 10, failure_threshold = 3 }`

> **Best practice:** Implement a dedicated health endpoint (e.g. `GET /healthz/`) in your Django application that returns `HTTP 200` when the app is ready (database connected, migrations applied). Then set `path = "/healthz/"` in both the `startup_probe` / `liveness_probe` and the `startup_probe_config` / `health_check_config` variables for consistent health signalling.

### Validating Health Probe Configuration

**Google Cloud Console:** Navigate to **Kubernetes Engine → Workloads → *django deployment***, click a pod, and select the **Events** tab to view probe failure events.

```bash
# View startup and liveness probe config on the deployment pod spec
kubectl get deployment django -n NAMESPACE \
  -o jsonpath='{.spec.template.spec.containers[0].startupProbe}' | jq .

kubectl get deployment django -n NAMESPACE \
  -o jsonpath='{.spec.template.spec.containers[0].livenessProbe}' | jq .

# View pod restart counts (rising count indicates probe failures)
kubectl get pods -n NAMESPACE -o wide

# View Django startup logs
kubectl logs -n NAMESPACE -l app=django --since=10m | head -100
```

---

## Redis Configuration

Django uses Redis as a session store and caching backend via `django-redis`. When `enable_redis = true`, the `REDIS_HOST` and `REDIS_PORT` environment variables are injected automatically into the Django container by `Django_Common`.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `false` | `true` / `false` | When `true`, `REDIS_HOST` and `REDIS_PORT` are injected into the container. Your Django `settings.py` must be configured to use these variables for `CACHES` and `SESSION_ENGINE`. Recommended for production deployments with multiple replicas or where Django's session framework is used. |
| `redis_host` | `""` *(falls back to NFS server IP)* | IP address or hostname | The hostname or IP address of the Redis server. Leave empty to fall back to the NFS server IP (suitable for single-VM shared environments where Redis is co-located). For production, set this explicitly to a Cloud Memorystore for Redis private IP. The cluster must be able to reach this address over the VPC. |
| `redis_port` | `"6379"` | Port number as string | The TCP port of the Redis server. The default `6379` is the standard Redis port and is correct for Cloud Memorystore and most self-hosted Redis instances. |
| `redis_auth` | `""` *(no authentication)* | Password string *(sensitive)* | Authentication password for the Redis server. Leave empty if the Redis instance does not require authentication. When set, the value is stored securely and never appears in Terraform state in plaintext. For Cloud Memorystore with AUTH enabled, set this to the instance's auth string. |

> **Provisioning Redis:** The `Django GKE` module does not provision a Redis instance. Provision a Cloud Memorystore instance separately, or deploy `GCP Services` first — it provides a shared Memorystore instance that is auto-discovered when `redis_host` is left blank.

### Validating Redis Configuration

```bash
# Confirm REDIS_HOST and REDIS_PORT are injected into the pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep REDIS

# Test Redis connectivity from within the cluster (using a debug pod or exec)
# redis-cli -h REDIS_HOST -p 6379 ping
```

---

## Session Affinity

Django applications that rely on in-process session storage or local caching benefit from routing a given user's requests consistently to the same pod.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `session_affinity` | `"ClientIP"` | `None` / `ClientIP` | **`ClientIP`:** the Kubernetes Service routes requests from a given client IP to the same pod for the duration of the affinity timeout (default 10800 seconds / 3 hours). Prevents session data loss on deployments using Django's default database-backed sessions or in-process caching. **`None`:** requests are distributed across all pods without affinity. Use `None` when all session and cache state is externalised to Redis or the database, as is the case for fully stateless Django deployments. |

> **Note:** `session_affinity` is documented in the GKE Backend Configuration section of [App_GKE_Guide Group 5](../App_GKE/App_GKE_Guide.md#group-5-gke-backend-configuration). The `"ClientIP"` default in `Django GKE` differs from the `App GKE` default — this is intentional to provide better out-of-the-box behaviour for Django session handling.

---

## Initialization Jobs

Django deployments typically require database setup and schema migration jobs to run before (or immediately after) the application starts. `Django GKE` supports these via the `initialization_jobs` variable (documented in [App_GKE_Guide Group 6](../App_GKE/App_GKE_Guide.md#group-6-jobs--scheduled-tasks)).

`Django GKE` does **not** configure a default `initialization_jobs` list — the variable defaults to `[]`. You must configure initialization jobs explicitly in your `tfvars` file.

**Recommended Django initialization jobs:**

```hcl
initialization_jobs = [
  {
    name              = "db-init"
    description       = "Create Django Database and User"
    image             = "postgres:15-alpine"
    script_path       = "db-init.sh"
    mount_nfs         = false
    mount_gcs_volumes = []
    execute_on_apply  = true
  },
  {
    name              = "db-migrate"
    description       = "Run Django Migrations"
    image             = null       # Uses the application image
    script_path       = "migrate.sh"
    mount_nfs         = false
    mount_gcs_volumes = ["django-media"]   # If GCS media volume is configured
    execute_on_apply  = false
  }
]
```

**Job descriptions:**

| Job | Image | Purpose |
|---|---|---|
| `db-init` | `postgres:15-alpine` | Creates the Django database and user in the Cloud SQL instance. Uses the `postgres` superuser credentials from Secret Manager. Run `execute_on_apply = true` so that the database is ready before the application starts. |
| `db-migrate` | Application image (`null`) | Runs `python manage.py migrate` and `python manage.py collectstatic`. Uses the application's own container image so that it has access to the current migration files. Set `execute_on_apply = false` to run only on explicit invocation, or `true` to apply on every deployment. |

> **Script location:** Both `db-init.sh` and `migrate.sh` are provided by `Django_Common` at `modules/Django_Common/scripts/`. They are referenced via `script_path` and loaded automatically by the platform. You do not need to copy or manage these scripts.

### Validating Initialization Jobs

```bash
# List all Kubernetes Jobs in the namespace
kubectl get jobs -n NAMESPACE

# View logs of the db-init job
kubectl logs -n NAMESPACE -l job-name=db-init --tail=50

# View logs of the db-migrate job
kubectl logs -n NAMESPACE -l job-name=db-migrate --tail=50

# Confirm the database was created
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID
```

---

## StatefulSet PVC Configuration

When `workload_type = "StatefulSet"` is set (see [App_GKE_Guide Group 5](../App_GKE/App_GKE_Guide.md#group-5-gke-backend-configuration)), the following variables configure the per-pod **PersistentVolumeClaim** automatically created for each StatefulSet replica.

> **Django use case:** A StatefulSet is rarely needed for Django. The default `Deployment` workload type with GCS-mounted media (`gcs_volumes`) and shared NFS (`enable_nfs = true`) is recommended. Use a StatefulSet only if your Django application requires per-pod local persistent storage that cannot be externalised to GCS or NFS.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `stateful_pvc_enabled` | `false` | `true` / `false` | When `true` and `workload_type = "StatefulSet"`, a PVC is provisioned for each pod replica. Leave `false` for standard `Deployment` workloads. |
| `stateful_pvc_size` | `"10Gi"` | Kubernetes storage quantity | Capacity of each per-pod PVC. Size based on expected local storage needs for the pod. |
| `stateful_pvc_mount_path` | `"/data"` | Filesystem path | Path inside the container where the PVC is mounted. Ensure this matches the Django file path configuration. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | Kubernetes storage class name | Storage class for PVCs. `"standard-rwo"` (ReadWriteOnce) is the GKE Autopilot default. Use `"premium-rwo"` for lower latency I/O. |
| `stateful_headless_service` | `true` | `true` / `false` | Creates a headless Kubernetes Service giving each pod a stable DNS name. Required if pods need to address each other directly. |
| `stateful_pod_management_policy` | `"OrderedReady"` | `OrderedReady` / `Parallel` | **`OrderedReady`:** pods start sequentially, each waiting for the previous to be ready — safer for coordinated startup. **`Parallel`:** all pods start simultaneously. |
| `stateful_update_strategy` | `"RollingUpdate"` | `RollingUpdate` / `OnDelete` | **`RollingUpdate`:** pods are updated automatically one at a time. **`OnDelete`:** pods are only updated when manually deleted. |

---

## Password Rotation Propagation Delay

The `rotation_propagation_delay_sec` variable controls how long the module waits after writing a new database password to Secret Manager before restarting the GKE pods to pick up the new credentials. It is used together with `enable_auto_password_rotation` (documented in [App_GKE_Guide Group 10](../App_GKE/App_GKE_Guide.md#group-10-database-configuration)).

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `rotation_propagation_delay_sec` | `90` | Integer (seconds) | Seconds to wait after updating the `DB_PASSWORD` secret before triggering a rolling restart of the Django Deployment. This delay allows Secret Manager's global replication to complete before pods attempt to reconnect with new credentials. **Increase to `120`** in multi-region deployments or if you observe rotation failures. Only used when `enable_auto_password_rotation = true`. |

---

## Resource Creator Identity

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `resource_creator_identity` | `"rad-module-creator@tec-rad-ui-2b65.iam.gserviceaccount.com"` | Service account email | The service account used by Terraform to create and manage GCP resources. For enhanced security, replace with a project-scoped service account granted only the minimum permissions required by this module. |

---

## Deployment Prerequisites & Validation

After deploying `Django GKE`, confirm the deployment is healthy:

```bash
# Confirm the Django pod is running and ready
kubectl get pods -n NAMESPACE -l app=django -o wide

# Confirm the Cloud SQL instance is running
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,databaseVersion)"

# Confirm the GCS media bucket was created
gcloud storage buckets list \
  --project=PROJECT_ID \
  --filter="name:django-media"

# Confirm DB and SECRET_KEY environment variables are injected
kubectl exec -n NAMESPACE POD_NAME -- env | grep -E "^(DB_|SECRET_KEY)"

# Confirm the database and user exist
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID
gcloud sql users list --instance=INSTANCE_NAME --project=PROJECT_ID

# View Django application logs
kubectl logs -n NAMESPACE -l app=django --since=5m
```
