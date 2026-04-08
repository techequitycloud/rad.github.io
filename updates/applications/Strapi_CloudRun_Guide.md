# Strapi_CloudRun Module — Configuration Guide

Strapi is an open-source headless CMS that gives developers the freedom to choose their favourite tools and frameworks while enabling content editors to manage their content independently. This module deploys Strapi on **Google Cloud Run** (Gen2), backed by a managed Cloud SQL PostgreSQL instance, an optional Cloud Filestore NFS volume for media uploads, and a GCS bucket for object storage.

`Strapi_CloudRun` is a **wrapper module** built on top of `App_CloudRun`. It uses `App_CloudRun` for all GCP infrastructure provisioning (Cloud Run service, networking, Cloud SQL, GCS, secrets, CI/CD) and adds Strapi-specific application configuration and secret management on top.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How This Guide Is Structured

This guide documents only the variables that are **unique to `Strapi_CloudRun`** or that have **Strapi-specific defaults** that differ from the `App_CloudRun` base module. For all other variables — project identity, runtime scaling, storage, CI/CD, backup, custom SQL, networking, IAP, Cloud Armor, and VPC Service Controls — refer directly to the [App_CloudRun Configuration Guide](../App_CloudRun/App_CloudRun_Guide.md).

**Variables fully covered by the App_CloudRun guide:**

| Configuration Area | App_CloudRun_Guide Section | Strapi-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | Group 0 | Different defaults for `module_description` and `module_documentation`. `resource_creator_identity` is the same. |
| Project & Identity | Group 1 | Refer to base App_CloudRun module documentation. |
| Application Identity | Group 2 | See [Strapi Application Identity](#strapi-application-identity) below for Strapi-specific defaults. |
| Runtime & Scaling | Group 3 | See [Strapi Runtime Configuration](#strapi-runtime-configuration) below for `cpu_limit`, `memory_limit`, `container_port`, and scaling defaults. |
| Environment Variables & Secrets | Group 4 | See [Strapi Environment Variables](#strapi-environment-variables) below for email and GCS defaults. |
| Observability & Health | Group 5 | See [Strapi Health Probes](#strapi-health-probes) below for `startup_probe`, `liveness_probe`, and their Strapi-specific defaults. |
| Jobs & Scheduled Tasks | Group 6 | A `db-init` Cloud Run job runs automatically — see [Platform-Managed Behaviours](#platform-managed-behaviours). Refer to App_CloudRun_Guide for customising additional jobs. |
| CI/CD & GitHub Integration | Group 7 | See [Cloud Deploy Pipeline](#cloud-deploy-pipeline) below for Strapi-specific Cloud Deploy defaults. Refer to App_CloudRun module documentation for all other CI/CD variables. |
| Storage — NFS | Group 8 | NFS is **enabled by default** in this module. See [NFS Storage](#nfs-storage) below. |
| Storage — GCS | Group 9 | A default `data` bucket is provisioned. Refer to App_CloudRun module documentation for bucket configuration. |
| Redis Cache | Group 10 | See [Redis Cache](#redis-cache) below for Strapi-specific Redis configuration and environment variable injection. |
| Database Backend | Group 11 | See [Strapi Database Configuration](#strapi-database-configuration) below. |
| Backup & Maintenance | Group 12 | Refer to base App_CloudRun module documentation for `backup_schedule` and `backup_retention_days`. See [Backup Import & Recovery](#backup-import--recovery) below for `enable_backup_import` and related variables. |
| Custom Initialisation & SQL | Group 13 | Refer to base App_CloudRun module documentation. |
| Access & Networking | Group 14 | Refer to base App_CloudRun module documentation (`ingress_settings`, `vpc_egress_setting`). |
| Identity-Aware Proxy | Group 15 | Refer to base App_CloudRun module documentation. |
| Cloud Armor & CDN | Group 16 | Refer to base App_CloudRun module documentation. |
| VPC Service Controls | Group 17 | Refer to base App_CloudRun module documentation. |

---

## Platform-Managed Behaviours

The following behaviours are applied automatically by `Strapi_CloudRun` regardless of the variable values in your `tfvars` file. They cannot be overridden by user configuration.

| Behaviour | Detail |
|---|---|
| **Strapi security secrets** | Five secrets are auto-generated and stored in Secret Manager: `JWT_SECRET`, `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`, `TRANSFER_TOKEN_SALT`, and `APP_KEYS` (a comma-separated list of four keys). These are required by Strapi for authentication and API security and are injected into the container automatically. You do not need to generate or manage these values. |
| **GCS environment variables** | `GCS_BUCKET_NAME` and `GCS_BASE_URL` are automatically injected into the container, pointing to the provisioned GCS uploads bucket. Strapi is pre-configured to use the GCS upload provider when these variables are present. |
| **Database initialisation job** | A `db-init` Cloud Run job runs automatically on each deployment using `postgres:15-alpine`. It idempotently creates the Strapi database and user, waits for Cloud SQL to be ready, and handles password updates. You do not need to run manual database setup. To override the default job, set `initialization_jobs` with your custom job definition. |
| **PostgreSQL 15 enforced** | `database_type` is set to `"POSTGRES_15"` by the Strapi_Common module. Strapi requires PostgreSQL — there is no `database_type` variable in `Strapi_CloudRun` to change this. |
| **Container port 8080** | Cloud Run automatically injects `PORT=8080` into every container. Strapi reads this environment variable (`env.int('PORT', 1337)`) and listens on port `8080` when deployed on Cloud Run. The `container_port` variable defaults to `8080` to match this behaviour. |
| **Custom image build** | `container_image_source` defaults to `"custom"`. The module includes a Strapi Dockerfile (based on `node:20-alpine`) that installs dependencies, builds the application, and packages it for production. Set `container_image_source = "prebuilt"` with a `container_image` URI to skip the build and deploy an existing image. |
| **NFS enabled** | `enable_nfs = true` by default. Strapi stores media uploads on the NFS volume mounted at `/mnt/nfs`, which persists across container restarts and is shared between instances. Requires the Gen2 execution environment (the default). |
| **Email provider support** | If `SMTP_HOST` is set in `environment_variables`, the built-in `plugins.js` automatically configures the `nodemailer` email provider for Strapi notifications. No code changes are required to enable email delivery. |

---

## Strapi Application Identity

These variables control how the Strapi deployment is named and described. They correspond directly to the `application_name`, `application_display_name`, and `application_description` variables in `App_CloudRun` and behave identically — the only difference is the Strapi-specific default values.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_name` | `"strapi"` | `[a-z][a-z0-9-]{0,19}` | Internal identifier used as the base name for the Cloud Run service, Artifact Registry repository, Secret Manager secrets, and GCS buckets. **Do not change after initial deployment.** See [App_CloudRun_Guide Group 2](../App_CloudRun/App_CloudRun_Guide.md#group-2-application-identity) for full details. |
| `application_display_name` | `"Strapi CMS"` | Any string | Human-readable name shown in the platform UI, the Cloud Run service list, and monitoring dashboards. Can be updated freely without affecting resource names. |
| `application_description` | `"Strapi Headless CMS on Cloud Run"` | Any string | Brief description of the deployment. Populated into the Cloud Run service description field and platform documentation. |
| `application_version` | `"5.0.0"` | Strapi version string (e.g. `"5.0.0"`, `"4.25.0"`) | Version tag applied to the container image. When `container_image_source = "custom"`, incrementing this value triggers a new Cloud Build run and creates a new Cloud Run revision. Use official [Strapi release](https://github.com/strapi/strapi/releases) versions. |

### Validating Application Identity

```bash
# Confirm the Cloud Run service exists with the expected name
gcloud run services describe strapi \
  --region=REGION \
  --format="table(metadata.name,metadata.annotations['run.googleapis.com/description'])"
```

---

## Strapi Runtime Configuration

Strapi is a Node.js application. The module defaults are sized for a production workload, with scale-to-zero enabled for cost efficiency. Adjust `cpu_limit` and `memory_limit` based on your expected traffic and content volume.

The CloudRun module exposes `cpu_limit` and `memory_limit` as **dedicated top-level variables** (rather than the `container_resources` object used in `Strapi_GKE`).

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `cpu_limit` | `"2000m"` | Kubernetes CPU quantity (e.g. `"1000m"`, `"2"`) | CPU allocated to each Strapi container instance. 2 vCPU is recommended for production to handle media processing (image resizing via `sharp`) and concurrent API requests without throttling. |
| `memory_limit` | `"2Gi"` | Kubernetes memory quantity (e.g. `"1Gi"`, `"2Gi"`) | Memory allocated to each Strapi container instance. 2 Gi is recommended for production workloads with large media libraries. Reducing below `512Mi` may cause out-of-memory crashes during image processing. |

**Strapi-specific runtime defaults that differ from App_CloudRun:**

| Variable | App_CloudRun Default | Strapi_CloudRun Default | Reason |
|---|---|---|---|
| `cpu_limit` | `"1000m"` | `"2000m"` | Strapi's image processing (sharp) and Node.js runtime benefit from 2 vCPU. |
| `memory_limit` | `"512Mi"` | `"2Gi"` | Strapi holds content schemas, plugins, and media buffers in memory. |
| `container_port` | `8080` | `8080` | Cloud Run sets `PORT=8080`; Strapi reads this and listens on port 8080 automatically. |
| `min_instance_count` | `0` | `0` | Scale-to-zero is enabled by default to minimise cost for development and staging. Set to `1` for production to eliminate cold starts. |
| `max_instance_count` | `3` | `1` | Defaults to a single instance to prevent race conditions during Strapi initialisation. Increase after the application has fully started for the first time. |
| `execution_environment` | `"gen2"` | `"gen2"` | Gen2 is required for NFS volume mounts and provides faster startup and improved networking. |

### deploy_application

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `deploy_application` | `true` | `true` / `false` | When `false`, the module provisions all supporting infrastructure (Cloud SQL, GCS buckets, Artifact Registry, Secret Manager secrets) without deploying the Strapi Cloud Run service. Useful for staged rollouts or infrastructure-first workflows. |

### Validating Runtime Configuration

```bash
# Confirm the Cloud Run service was deployed with the expected resources
gcloud run services describe strapi \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].resources)"

# Check current scaling configuration
gcloud run services describe strapi \
  --region=REGION \
  --format="yaml(spec.template.metadata.annotations)"
```

---

## Strapi Database Configuration

Strapi requires PostgreSQL. `Strapi_CloudRun` uses `application_database_name` and `application_database_user` (consistent with the App_CloudRun interface) to configure the database. The PostgreSQL version is fixed at `POSTGRES_15` by the Strapi_Common module — there is no `database_type` variable in `Strapi_CloudRun`.

All other database variables (`database_password_length`, `enable_auto_password_rotation`, `rotation_propagation_delay_sec`, `enable_cloudsql_volume`, `cloudsql_volume_mount_path`) behave identically to the App_CloudRun equivalents — refer to [App_CloudRun_Guide Group 11](../App_CloudRun/App_CloudRun_Guide.md#group-11-database-backend) for their documentation.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_database_name` | `"strapidb"` | `[a-z][a-z0-9_]{0,62}` | The name of the PostgreSQL database created within the Cloud SQL instance. Injected as the `DB_NAME` environment variable. **Do not change after initial deployment** — Strapi stores all application data in this database and renaming it requires manual migration. |
| `application_database_user` | `"strapiuser"` | `[a-z][a-z0-9_]{0,31}` | The PostgreSQL user created for the Strapi application. Injected as the `DB_USER` environment variable. The password is auto-generated, stored in Secret Manager, and injected as `DB_PASSWORD`. |

> **Note:** The database defaults in `Strapi_CloudRun` (`strapidb` / `strapiuser`) differ from `Strapi_GKE` (`strapi` / `strapi`). Do not mix these defaults when migrating between deployment targets — ensure the database name and user match your existing data.

> **Note:** The `db-init` initialisation job connects as the `postgres` superuser to create the database and user before the application starts. You do not need to run these steps manually.

### Validating Database Configuration

```bash
# Confirm the database and user were created
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID

gcloud sql users list --instance=INSTANCE_NAME --project=PROJECT_ID

# Confirm DB environment variables are injected into the Cloud Run revision
gcloud run services describe strapi \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)"
```

---

## Strapi Environment Variables

The `environment_variables` variable (documented in [App_CloudRun_Guide Group 4](../App_CloudRun/App_CloudRun_Guide.md#group-4-environment-variables--secrets)) is used by Strapi to configure email delivery and other runtime settings.

**Email delivery (optional):**

If `SMTP_HOST` is set, the built-in `plugins.js` automatically configures the `nodemailer` email provider for Strapi notifications (user invitations, password resets, and workflow notifications). For sensitive values such as `SMTP_PASSWORD`, use `secret_environment_variables` instead:

```hcl
environment_variables = {
  SMTP_HOST  = "smtp.sendgrid.net"
  SMTP_PORT  = "587"
  SMTP_USER  = "apikey"
  EMAIL_FROM = "noreply@example.com"
}

secret_environment_variables = {
  SMTP_PASSWORD = "strapi-smtp-password"   # Secret Manager secret name
}
```

**GCS upload integration (auto-injected):**

`GCS_BUCKET_NAME` and `GCS_BASE_URL` are injected automatically by the platform and do not need to be set manually. Strapi's `plugins.js` reads these values to configure the GCS upload provider.

All other `environment_variables` and `secret_environment_variables` behaviour is identical to App_CloudRun — refer to [App_CloudRun_Guide Group 4](../App_CloudRun/App_CloudRun_Guide.md#group-4-environment-variables--secrets).

---

## Strapi Health Probes

Strapi performs database connection validation and may run pending migrations on startup. `Strapi_CloudRun` provides **two sets of health probe variables**:

- **`startup_probe` / `liveness_probe`**: These are the **primary probe variables** in `Strapi_CloudRun`, passed directly to Strapi_Common. They use the Strapi-native `/_health` endpoint.
- **`startup_probe_config` / `health_check_config`**: These are the App_CloudRun-compatible variable names, also accepted by `Strapi_CloudRun` and passed to `App_CloudRun`. They default to the same `/_health` endpoint.

Prefer `startup_probe` and `liveness_probe` when configuring probes in `Strapi_CloudRun`. The `startup_probe_config` and `health_check_config` variables exist for users familiar with the App_CloudRun interface.

> **Relationship to App_CloudRun probes:** `startup_probe` corresponds to `startup_probe_config` in App_CloudRun; `liveness_probe` corresponds to `health_check_config`. Their sub-field structure is identical. Refer to [App_CloudRun_Guide Group 5](../App_CloudRun/App_CloudRun_Guide.md#group-5-observability--health) for the full field reference.

**Default probe configuration:**

```hcl
startup_probe = {
  enabled               = true
  type                  = "HTTP"
  path                  = "/_health"
  initial_delay_seconds = 60
  timeout_seconds       = 5
  period_seconds        = 10
  failure_threshold     = 3
}

liveness_probe = {
  enabled               = true
  type                  = "HTTP"
  path                  = "/_health"
  initial_delay_seconds = 30
  timeout_seconds       = 5
  period_seconds        = 30
  failure_threshold     = 3
}
```

**Strapi-specific probe defaults that differ from App_CloudRun:**

| Variable | App_CloudRun Default `path` | Strapi_CloudRun Default `path` | Reason |
|---|---|---|---|
| `startup_probe` / `startup_probe_config` | `"/_health"` | `"/_health"` | Strapi exposes a dedicated health endpoint that confirms the application and database connection are ready. |
| `liveness_probe` / `health_check_config` | `"/_health"` | `"/_health"` | Using `/_health` ensures Cloud Run only routes traffic to fully initialised Strapi instances. |

> **On first deployment**, when Strapi initialises its database schema, startup may take longer than usual. If the startup probe fails, increase `startup_probe.initial_delay_seconds` or `failure_threshold`.

### Validating Health Probes

```bash
# View current probe configuration on the Cloud Run revision
gcloud run services describe strapi \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].livenessProbe)"

# View recent Cloud Run logs for startup issues
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="strapi"' \
  --project=PROJECT_ID \
  --limit=50
```

---

## NFS Storage

Strapi stores media uploads and shared files on the NFS volume. `Strapi_CloudRun` enables NFS by default, unlike the `App_CloudRun` base module where NFS is opt-in. NFS mounts on Cloud Run require the Gen2 execution environment (the default).

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_nfs` | `true` | `true` / `false` | When `true`, a Cloud Filestore instance is provisioned and mounted into the Strapi container. Media uploads written to `nfs_mount_path` are preserved across container restarts and shared between all Cloud Run instances. Set to `false` only if you are using GCS as the sole upload backend. Requires `execution_environment = "gen2"`. |
| `nfs_mount_path` | `"/mnt/nfs"` | Filesystem path | The path inside the container where the NFS volume is mounted. Strapi should be configured to write uploads to this path. |

> **Note:** All other NFS configuration variables are identical to the App_CloudRun equivalents — refer to [App_CloudRun_Guide Group 8](../App_CloudRun/App_CloudRun_Guide.md#group-8-storage--filesystem--nfs) for their documentation.

### Validating NFS Configuration

```bash
# Confirm the NFS volume is mounted in the Cloud Run revision
gcloud run services describe strapi \
  --region=REGION \
  --format="yaml(spec.template.spec.volumes)"
```

---

## Redis Cache

Strapi supports Redis as a session store and application-level cache. When `enable_redis = true`, the `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, and `ENABLE_REDIS` environment variables are injected into the Strapi container. Strapi's built-in `plugins.js` detects `ENABLE_REDIS = "true"` and switches the cache backend automatically.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `false` | `true` / `false` | When `true`, Redis connection details are injected into the Strapi container. For production multi-instance deployments, enabling a shared Redis cache is recommended to prevent session inconsistency across Cloud Run revisions. |
| `redis_host` | `null` | IP address or hostname | The hostname or IP address of the Redis server. Required when `enable_redis` is `true`. Set this to a Cloud Memorystore for Redis instance private IP or a dedicated Redis host accessible from the VPC. |
| `redis_port` | `"6379"` | Port number as string | The TCP port of the Redis server. The default `6379` is correct for Cloud Memorystore and most self-hosted Redis instances. |
| `redis_auth` | `""` *(no authentication)* | Password string *(sensitive)* | Authentication password for the Redis server. Leave empty if the Redis instance does not require authentication. For Cloud Memorystore with AUTH enabled, set this to the instance's auth string. |

### Validating Redis Configuration

```bash
# Confirm REDIS_HOST, REDIS_PORT, and ENABLE_REDIS are injected into the revision
gcloud run services describe strapi \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -i redis
```

---

## Backup Import & Recovery

In addition to the scheduled backup (`backup_schedule` and `backup_retention_days`, documented in [App_CloudRun_Guide Group 12](../App_CloudRun/App_CloudRun_Guide.md#group-12-backup--maintenance)), `Strapi_CloudRun` supports a **one-time import** of an existing database backup during deployment. This is designed for migrating an existing Strapi instance to GCP or seeding a new environment with production data.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_backup_import` | `false` | `true` / `false` | When `true`, triggers a one-time Cloud Run job to restore the backup file specified by `backup_file` from the source defined in `backup_source`. The import job runs after the database is provisioned. **If the database already contains data**, the import may produce errors — test in a non-production environment first. |
| `backup_source` | `"gcs"` | `gcs` / `gdrive` | The source from which the backup file is retrieved. **`gcs`:** imports from the module's provisioned GCS backup bucket. **`gdrive`:** imports from a Google Drive file ID. GCS is recommended for production due to better security and performance. |
| `backup_file` | `"backup.sql"` | Filename string or Google Drive file ID | The filename (for GCS) or file ID (for Google Drive) of the backup to import. For GCS, the file must exist in the module's backup bucket before deployment. |
| `backup_format` | `"sql"` | `sql` / `tar` / `gz` / `tgz` / `tar.gz` / `zip` / `auto` | The format of the backup file. Use `"auto"` to detect the format from the file extension (GCS only). |

### Validating Backup Import

```bash
# List Cloud Run jobs and confirm the import job ran
gcloud run jobs list --region=REGION --project=PROJECT_ID

# View import job execution logs
gcloud logging read \
  'resource.type="cloud_run_job" AND resource.labels.job_name~"backup-import"' \
  --project=PROJECT_ID \
  --limit=50
```

---

## Cloud Deploy Pipeline

`Strapi_CloudRun` supports managed progressive delivery via Google Cloud Deploy. When `enable_cloud_deploy = true`, Cloud Build creates a Cloud Deploy release that deploys to the `dev` stage automatically; subsequent promotions to `staging` and `prod` are triggered manually via the Cloud Console or `gcloud` CLI.

This feature requires `enable_cicd_trigger = true`. Refer to [App_CloudRun_Guide Group 7](../App_CloudRun/App_CloudRun_Guide.md#group-7-cicd--github-integration) for CI/CD trigger configuration.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_cloud_deploy` | `false` | `true` / `false` | When `true`, switches the CI/CD pipeline from direct Cloud Build deployments to a Google Cloud Deploy pipeline with defined promotion stages. Enables controlled progressive delivery with optional approvals between stages. |
| `cloud_deploy_stages` | *(dev → staging → prod)* | List of stage objects | Ordered list of promotion stages. Each stage creates a Cloud Deploy target and an associated Cloud Run service. The default pipeline is: `dev` (auto-deploy, no approval) → `staging` (no approval) → `prod` (approval required). Customise stage names, approval requirements, and auto-promotion behaviour as needed. |

**Default pipeline:**

```hcl
cloud_deploy_stages = [
  { name = "dev",     require_approval = false, auto_promote = false },
  { name = "staging", require_approval = false, auto_promote = false },
  { name = "prod",    require_approval = true,  auto_promote = false },
]
```

### Promoting a Release

```bash
# List active Cloud Deploy releases
gcloud deploy releases list \
  --delivery-pipeline=PIPELINE_NAME \
  --region=REGION \
  --project=PROJECT_ID

# Promote from staging to prod
gcloud deploy releases promote \
  --release=RELEASE_NAME \
  --delivery-pipeline=PIPELINE_NAME \
  --region=REGION \
  --to-target=prod \
  --project=PROJECT_ID
```

---

## Additional Services

`Strapi_CloudRun` supports deploying helper services alongside the main Strapi application using the `additional_services` variable, identical in behaviour to `App_CloudRun`. Refer to [App_CloudRun_Guide Group 6](../App_CloudRun/App_CloudRun_Guide.md#group-6-jobs--scheduled-tasks) for the full variable reference.

Common use cases include:
- A **Redis sidecar** (when a managed Memorystore instance is not available)
- A **background worker** service that processes Strapi webhooks or scheduled content operations
- A **media processing microservice** that handles image transformation

```hcl
additional_services = [
  {
    name               = "redis"
    image              = "redis:7-alpine"
    port               = 6379
    min_instance_count = 1
    max_instance_count = 1
    ingress            = "INGRESS_TRAFFIC_INTERNAL_ONLY"
    output_env_var_name = "REDIS_HOST"
  }
]
```

When `output_env_var_name` is set, the service URL is automatically injected into the main Strapi container as the named environment variable.
