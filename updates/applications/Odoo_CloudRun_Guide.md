# Odoo CloudRun Module — Configuration Guide

Odoo is a comprehensive open-source ERP platform covering CRM, accounting, inventory, manufacturing, HR, eCommerce, and more. This module deploys Odoo Community Edition on **Google Cloud Run** using a custom container image built from the official Odoo nightly packages, backed by a managed Cloud SQL PostgreSQL instance and a Filestore NFS volume for shared file storage.

`Odoo CloudRun` is a **wrapper module** built on top of `App CloudRun`. It uses `App CloudRun` for all GCP infrastructure provisioning (Cloud Run service, networking, Cloud SQL, GCS, secrets, CI/CD) and adds Odoo-specific application configuration, initialisation jobs, and runtime defaults on top.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How This Guide Is Structured

This guide documents only the variables that are **unique to `Odoo CloudRun`** or that have **Odoo-specific defaults** that differ from the `App CloudRun` base module. For all other variables — project identity, CI/CD, custom SQL, networking, IAP, Cloud Armor, VPC Service Controls, and Cloud Deploy — refer directly to the [App CloudRun Configuration Guide](../App_CloudRun/App_CloudRun_Guide.md).

**Variables fully covered by the App CloudRun guide:**

| Configuration Area | App_CloudRun_Guide Section | Odoo-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | Group 0 | Different defaults for `module_description` and `module_documentation`. `resource_creator_identity` behaves identically. |
| Project & Identity | Group 1 | Refer to base App CloudRun module documentation. |
| Runtime & Scaling | Group 3 | See [Odoo Runtime Configuration](#odoo-runtime-configuration) below. `container_port` defaults to `8069`. `min_instance_count` defaults to `0`; `max_instance_count` defaults to `1`. |
| Environment Variables & Secrets | Group 4/5 | See [Odoo Environment Variables](#odoo-environment-variables) below for SMTP defaults. `explicit_secret_values` — see [Platform-Managed Behaviours](#platform-managed-behaviours). |
| Observability & Health | Group 13 | See [Odoo Health Probes](#odoo-health-probes) below. The module uses **`startup_probe`** and **`liveness_probe`** (Odoo-specific names) rather than `startup_probe_config` / `health_check_config`. |
| Jobs & Scheduled Tasks | Group 12 | Refer to base App CloudRun module documentation. The module also injects two platform-managed initialisation jobs — see [Platform-Managed Behaviours](#platform-managed-behaviours). |
| CI/CD & GitHub Integration | Group 7 | Refer to base App CloudRun module documentation. Cloud Deploy (`enable_cloud_deploy`, `cloud_deploy_stages`) is also available. |
| Storage — NFS | Group 10 | NFS is **enabled by default** (`enable_nfs = true`). Requires `execution_environment = "gen2"` (the default). |
| Storage — GCS | Group 10 | Refer to base App CloudRun module documentation. |
| Redis Cache | Group 20 | See [Redis Session Store](#redis-session-store) below. Note: `redis_auth` is available in this module. |
| Backup & Maintenance | Group 6 | Refer to base App CloudRun module documentation for `backup_schedule` and `backup_retention_days`. See also [Backup Import & Recovery](#backup-import--recovery) below for `enable_backup_import` and related variables. |
| Custom Initialisation & SQL | Group 8 | Refer to base App CloudRun module documentation. |
| Access & Networking | Group 4 | Refer to base App CloudRun module documentation (`ingress_settings`, `vpc_egress_setting`). |
| Load Balancer & CDN | Group 9 | Refer to base App CloudRun module documentation (`enable_cloud_armor`, `enable_cdn`, `application_domains`). |
| Identity-Aware Proxy | Group 4 | Refer to base App CloudRun module documentation. |
| VPC Service Controls | Group 21 | Refer to base App CloudRun module documentation. |
| Traffic Splitting | Group 3 | Refer to base App CloudRun module documentation (`traffic_split`). |
| Additional Services | Group 12 | Refer to base App CloudRun module documentation (`additional_services`). |

---

## Platform-Managed Behaviours

The following behaviours are applied automatically by `Odoo CloudRun` regardless of the variable values in your `tfvars` file. They cannot be overridden by user configuration.

| Behaviour | Detail |
|---|---|
| **NFS directory initialisation** | An `nfs-init` Cloud Run Job runs automatically on deployment. It mounts the Filestore NFS share and creates the directories `/mnt/filestore`, `/mnt/sessions`, and `/mnt/extra-addons`, setting ownership to UID/GID `101:101` (the Odoo process user). This is required before Odoo starts — without it, Odoo will fail to write session and filestore data. |
| **Database initialisation** | A `db-init` Cloud Run Job runs after `nfs-init` to create the Odoo database and application user using the credentials stored in Secret Manager. |
| **ODOO_MASTER_PASS secret** | A 16-character alphanumeric master password is auto-generated and stored in Secret Manager under the name `app{application_name}{tenant_deployment_id}{deployment_id}-master-password`. It is injected into the container as the `ODOO_MASTER_PASS` environment variable via Secret Manager reference (not in plaintext). Used for Odoo's database management interface. |
| **DB_PASSWORD and ROOT_PASSWORD** | The database password generated by `App CloudRun` is automatically injected as both `DB_PASSWORD` (used by Odoo at runtime) and `ROOT_PASSWORD` (used by the `db-init` job for superuser setup). These secrets are managed automatically — do not define them manually in `secret_environment_variables`. |
| **SMTP environment defaults** | The `environment_variables` map is pre-populated with Odoo SMTP configuration keys (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL`, `EMAIL_FROM`). Override these to configure outbound email for Odoo notifications. |

---

## Odoo Application Identity

These variables define how the Odoo deployment is named across GCP resources.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_name` | `"odoo"` | `[a-z][a-z0-9-]{0,19}` | Internal identifier used as the base name for the Cloud Run service, Artifact Registry repository, Secret Manager secrets, and GCS buckets. Functionally identical to `application_name` in App CloudRun. **Do not change after initial deployment.** |
| `application_display_name` | `"Odoo ERP"` | Any string | Human-readable name shown in the platform UI, Cloud Run service list, and monitoring dashboards. Can be updated freely without affecting resource names. |
| `application_description` | `"Odoo ERP on Cloud Run"` | Any string | Brief description. Populated into the Cloud Run service description field. Can be updated freely. |
| `application_version` | `"18.0"` | Odoo version string, e.g. `"18.0"`, `"17.0"` | **For Odoo this is the Odoo release version, not a semver tag.** It maps directly to the Odoo nightly package channel used in the Dockerfile (`ODOO_VERSION` build arg). Supported values are `"18.0"`, `"17.0"`, `"16.0"`. When `container_image_source = "custom"`, changing this value triggers a new Cloud Build run. |

### Validating Application Identity

```bash
# Confirm the Cloud Run service exists with the expected name
gcloud run services describe odoo \
  --region=REGION \
  --format="table(metadata.name,metadata.annotations['run.googleapis.com/description'])"

# Confirm the Odoo version from the running container
gcloud run services describe odoo \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" | grep ODOO_VERSION
```

---

## Odoo Runtime Configuration

Odoo is a Python/PostgreSQL ERP application that requires more resources than a typical Cloud Run service, particularly during initial database creation and module installation.

### Container Port

| Variable | Default | Description & Implications |
|---|---|---|
| `container_port` | `8069` | The port Odoo listens on for HTTP traffic. **Do not change this** unless you have modified the Odoo server configuration to bind on a different port. |

### Resource Sizing

`Odoo CloudRun` exposes `cpu_limit` and `memory_limit` as **dedicated top-level variables** (in addition to the `container_resources` object). When both are set, `container_resources` takes precedence.

| Variable | Module Default | Recommended for Production |
|---|---|---|
| `cpu_limit` | `"1000m"` | `"2000m"` or higher |
| `memory_limit` | `"1Gi"` | `"4Gi"` (minimum `"2Gi"`) |

Odoo's Python worker processes and database connection pool together consume 1.5–3 Gi of memory under normal load. Setting `memory_limit` below `"2Gi"` will cause OOM kills during peak activity.

> **Note:** Cloud Run CPU allocations above `"1000m"` require `min_instance_count >= 1` (CPU is always allocated). If you increase `cpu_limit` beyond `"1000m"` while keeping `min_instance_count = 0`, Cloud Run will throttle CPU to zero between requests and Odoo will experience severe cold-start latency.

**Recommended production configuration:**
```hcl
cpu_limit          = "2000m"
memory_limit       = "4Gi"
min_instance_count = 1
max_instance_count = 3
```

### Scaling Defaults

| Variable | App CloudRun Default | Odoo CloudRun Default | Reason |
|---|---|---|---|
| `min_instance_count` | `0` | `0` | Odoo supports scale-to-zero but cold starts are slow (60–180 s). Set to `1` for production to eliminate cold starts. |
| `max_instance_count` | `1` | `1` | Odoo in standalone mode (no Redis session store) should run as a single instance to avoid session inconsistency. Increase only after configuring Redis session storage. |

### Validating Runtime Configuration

```bash
# View CPU and memory limits on the latest revision
gcloud run services describe odoo \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].resources)"

# Confirm the minimum instance count
gcloud run services describe odoo \
  --region=REGION \
  --format="yaml(spec.template.metadata.annotations)"
```

---

## Odoo Health Probes

Odoo performs database schema validation and, on first boot, full module installation. This can take 2–10 minutes. `Odoo CloudRun` uses **two sets of probe variable names**:

- **`startup_probe` and `liveness_probe`** — the primary Odoo probe variables, passed to the Odoo_Common module. These are the variables you should configure.
- `startup_probe_config` and `health_check_config` — the App CloudRun base interface names, also present and passed to App CloudRun directly. These have Odoo-specific `/web/health` defaults as well.

Prefer `startup_probe` and `liveness_probe` when tuning Odoo probe behaviour.

| Variable | Default | Description & Implications |
|---|---|---|
| `startup_probe` | `{ enabled = true, type = "TCP", path = "/", initial_delay_seconds = 60, timeout_seconds = 10, period_seconds = 30, failure_threshold = 3 }` | Uses a **TCP port check** rather than HTTP. A TCP probe is more reliable during Odoo's boot phase, when the HTTP server may not yet be accepting connections even though the process is starting. The `initial_delay_seconds = 60` gives Odoo time to start before the first check. `failure_threshold = 3` with `period_seconds = 30` allows 90 more seconds after the initial delay. **On first deployment**, consider increasing `failure_threshold` to `6` to allow for database schema creation. |
| `liveness_probe` | `{ enabled = true, type = "HTTP", path = "/web/health", initial_delay_seconds = 120, timeout_seconds = 60, period_seconds = 120, failure_threshold = 3 }` | Periodically checks whether a running Odoo instance is healthy using the `/web/health` endpoint, which returns HTTP 200 only when the application has a live database connection. The `initial_delay_seconds = 120` prevents premature restarts during startup. `period_seconds = 120` avoids unnecessary database load from frequent probing. |

> **Relationship to App CloudRun probes:** `startup_probe` configures the Cloud Run startup probe passed through Odoo_Common; `startup_probe_config` configures the startup probe on the App CloudRun module directly. In practice, the Odoo-specific probe applied to the container is the one from `startup_probe` / `liveness_probe`. Both use the same sub-field structure.

### Validating Health Probes

**Google Cloud Console:** Navigate to **Cloud Run → Services → odoo → Revisions**, select the latest revision, click **Container(s)**, and view the **Health checks** section.

```bash
# View startup and liveness probe configuration on the latest revision
gcloud run services describe odoo \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].livenessProbe,spec.template.spec.containers[0].startupProbe)"

# Monitor Cloud Run logs for probe failures
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=odoo AND severity>=WARNING" \
  --project=PROJECT_ID \
  --limit=20 \
  --format="table(timestamp,severity,textPayload)"

# Manually test the health endpoint
curl -s -o /dev/null -w "%{http_code}" https://SERVICE_URL/web/health
# Expect: 200
```

---

## Odoo Database Configuration

Odoo requires PostgreSQL. The database is provisioned by the underlying `App CloudRun` module — see [App_CloudRun_Guide Group 11](../App_CloudRun/App_CloudRun_Guide.md#group-11-database-backend) for the full variable reference.

The following defaults are **Odoo-specific** and set appropriately out of the box:

| Variable | Odoo CloudRun Default | Description |
|---|---|---|
| `application_database_name` | `"odoo"` | The PostgreSQL database created for Odoo. Injected as `DB_NAME`. |
| `application_database_user` | `"odoo"` | The PostgreSQL user for the application. Injected as `DB_USER`. |

> **Must remain PostgreSQL.** Setting any non-PostgreSQL `database_type` will prevent Odoo from starting.

### Validating Database Configuration

```bash
# Confirm the database and user were created
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID

gcloud sql users list --instance=INSTANCE_NAME --project=PROJECT_ID

# Confirm DB environment variables are injected into the Cloud Run service
gcloud run services describe odoo \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -E "DB_"
```

---

## Odoo Environment Variables

The `environment_variables` variable (documented in [App_CloudRun_Guide Group 4](../App_CloudRun/App_CloudRun_Guide.md#group-4-environment-variables--secrets)) has Odoo-specific defaults that configure outbound email delivery.

**Default `environment_variables` in Odoo CloudRun:**

```hcl
environment_variables = {
  SMTP_HOST     = ""
  SMTP_PORT     = "25"
  SMTP_USER     = ""
  SMTP_PASSWORD = ""
  SMTP_SSL      = "false"
  EMAIL_FROM    = "odoo@example.com"
}
```

Configure these before going live to enable Odoo email notifications (order confirmations, password resets, CRM activities). Move sensitive values to `secret_environment_variables`:

```hcl
environment_variables = {
  SMTP_HOST  = "smtp.sendgrid.net"
  SMTP_PORT  = "587"
  SMTP_USER  = "apikey"
  SMTP_SSL   = "true"
  EMAIL_FROM = "noreply@yourcompany.example.com"
}

secret_environment_variables = {
  SMTP_PASSWORD = "odoo-smtp-password"   # Secret Manager secret name
}
```

### Injecting the Odoo Admin Password

The Odoo master password (`ODOO_MASTER_PASS`) is generated automatically (see [Platform-Managed Behaviours](#platform-managed-behaviours)). If you need to set a specific admin password rather than using the generated one, use `explicit_secret_values`:

```hcl
explicit_secret_values = {
  ODOO_MASTER_PASS = "your-chosen-master-password"
}
```

> `explicit_secret_values` values are treated as sensitive and written directly to Secret Manager. They are never stored in plaintext in Terraform state. See [App_CloudRun_Guide Group 5](../App_CloudRun/App_CloudRun_Guide.md#group-5-environment-variables--secrets) for the full reference.

---

## Redis Session Store

Odoo supports Redis as a shared session store. When multiple Cloud Run instances are running (`max_instance_count > 1`), Redis is **required** — without it each instance has its own session store and users will be logged out on every request that lands on a different instance.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `false` | `true` / `false` | When `true`, Odoo is configured to use Redis at `redis_host:redis_port` for session storage. The `SESSION_REDIS`, `REDIS_HOST`, and `REDIS_PORT` environment variables are injected automatically. Requires `redis_host` to be set. |
| `redis_host` | `""` | IP address or hostname | The Redis server hostname or IP. For Google Memorystore, use the primary endpoint IP (available under **Memorystore → Redis → your instance → Properties**). Required when `enable_redis = true`. |
| `redis_port` | `"6379"` | Port string | The Redis port. Change only if your Redis instance uses a non-standard port. |
| `redis_auth` | `""` | String (sensitive) | Authentication password for the Redis server. Leave empty for unauthenticated Redis. For Memorystore instances with AUTH enabled, set this to the auth string. Treated as sensitive. |

For a full description of the Redis variables, refer to [App_CloudRun_Guide Group 20](../App_CloudRun/App_CloudRun_Guide.md#group-20-redis-cache).

### Validating Redis Configuration

```bash
# Confirm REDIS_HOST and REDIS_PORT are injected into the Cloud Run service
gcloud run services describe odoo \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -E "REDIS_"
```

---

## Backup Import & Recovery

In addition to the scheduled backup (`backup_schedule` and `backup_retention_days`, documented in [App_CloudRun_Guide Group 6](../App_CloudRun/App_CloudRun_Guide.md#group-6-backup--maintenance)), `Odoo CloudRun` supports a one-time database import during deployment. Use this to migrate an existing Odoo instance to GCP or to seed a new environment with production data.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_backup_import` | `false` | `true` / `false` | When `true`, triggers a one-time Cloud Run Job to restore the backup specified by `backup_file` from the source defined in `backup_source`. The import runs after the database is provisioned. Configure `backup_source`, `backup_file`, and `backup_format` before enabling. **If the database already contains data**, test in a non-production environment first — the import may conflict with existing schema. |
| `backup_source` | `"gcs"` | `gcs` / `gdrive` | `"gcs"` to import from the automatically created GCS backups bucket; `"gdrive"` to import from a Google Drive file ID. GCS is recommended for production. |
| `backup_file` | `"backup.sql"` | Filename or Drive file ID | For GCS: the filename within the backups bucket (e.g. `"odoo_prod_2024.sql.gz"`). For Google Drive: the file ID from the share URL. |
| `backup_format` | `"sql"` | `sql` / `tar` / `gz` / `tgz` / `tar.gz` / `zip` / `auto` | The format of the backup file. The recommended format for Odoo PostgreSQL dumps is `"sql"` (plain text) or `"gz"` (gzip-compressed). |

### Validating Backup Import

```bash
# Confirm the import job completed successfully
gcloud run jobs executions list \
  --job=odoo-backup-import \
  --region=REGION \
  --format="table(name,status.conditions[0].type,status.startTime,status.completionTime)"

# View import job logs for any errors
gcloud logging read \
  "resource.type=cloud_run_job AND resource.labels.job_name=odoo-backup-import" \
  --project=PROJECT_ID \
  --limit=50 \
  --order=asc \
  --format="table(timestamp,severity,textPayload)"
```

---

## Deployment Prerequisites & Validation

After deploying `Odoo CloudRun`, confirm the deployment is healthy:

```bash
# Confirm both initialisation jobs completed successfully
gcloud run jobs executions list \
  --region=REGION \
  --format="table(name,status.conditions[0].type,status.startTime,status.completionTime)"

# View nfs-init job logs
gcloud logging read \
  "resource.type=cloud_run_job AND resource.labels.job_name=odoo-nfs-init" \
  --project=PROJECT_ID \
  --limit=20

# View db-init job logs
gcloud logging read \
  "resource.type=cloud_run_job AND resource.labels.job_name=odoo-db-init" \
  --project=PROJECT_ID \
  --limit=20

# Confirm the Cloud Run service is deployed and retrieve its URL
gcloud run services describe odoo \
  --region=REGION \
  --format="table(status.url,status.conditions[0].type)"

# Confirm the ODOO_MASTER_PASS secret was created in Secret Manager
gcloud secrets list --project=PROJECT_ID --filter="name:master-password"

# Test the Odoo web interface
curl -s -o /dev/null -w "%{http_code}" https://SERVICE_URL/web/health
# Expect: 200
```
