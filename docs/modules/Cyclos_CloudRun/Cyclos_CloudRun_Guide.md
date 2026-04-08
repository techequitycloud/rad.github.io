---
title: "Cyclos Cloud Run Configuration Guide"
sidebar_label: "Cloud Run"
---

# Cyclos_CloudRun Module — Configuration Guide

Cyclos is a professional banking and payment system designed for microfinance institutions, credit unions, complementary currency schemes, and community banks. This module deploys Cyclos on **Google Cloud Run** using the official `cyclos/cyclos` container image, backed by a managed Cloud SQL PostgreSQL instance.

`Cyclos_CloudRun` is a **wrapper module** built on top of `App_CloudRun`. It uses `App_CloudRun` for all GCP infrastructure provisioning (Cloud Run service, networking, Cloud SQL, GCS, secrets, CI/CD) and adds Cyclos-specific application configuration on top.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How This Guide Is Structured

This guide documents only the variables that are **unique to `Cyclos_CloudRun`** or that have **Cyclos-specific defaults** that differ from the `App_CloudRun` base module. For all other variables — project identity, runtime scaling, storage, CI/CD, Redis, backup, custom SQL, networking, IAP, Cloud Armor, and VPC Service Controls — refer directly to the [App_CloudRun Configuration Guide](../App_CloudRun/App_CloudRun_Guide.md).

**Variables fully covered by the App_CloudRun guide:**

| Configuration Area | App_CloudRun_Guide Section | Cyclos-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | Group 0 | Different defaults for `module_description` and `module_documentation`. `resource_creator_identity` is the same — see Group 0. |
| Project & Identity | Group 1 | Refer to base App_CloudRun module documentation. |
| Runtime & Scaling | Group 3 | See [Cyclos Runtime Configuration](#cyclos-runtime-configuration) below for `cpu_limit`, `memory_limit`, and Cyclos-specific scaling defaults. `container_image` defaults to `cyclos/cyclos`; `container_image_source` defaults to `prebuilt`. `enable_cloudsql_volume` defaults to `false` (Cyclos uses TCP, not Unix socket). |
| Environment Variables & Secrets | Group 4 | See [Cyclos Environment Variables](#cyclos-environment-variables) below for SMTP defaults. |
| Observability & Health | Group 5 | See [Cyclos Health Probes](#cyclos-health-probes) below for renamed variables and Cyclos-specific defaults. |
| Jobs & Scheduled Tasks | Group 6 | Refer to base App_CloudRun module documentation. |
| CI/CD & GitHub Integration | Group 7 | Refer to base App_CloudRun module documentation. |
| Storage — NFS | Group 8 | NFS is **disabled by this module**. See [Platform-Managed Behaviours](#platform-managed-behaviours). `enable_nfs` defaults to `false`. |
| Storage — GCS | Group 9 | Refer to base App_CloudRun module documentation. |
| Redis Cache | Group 10 | Refer to base App_CloudRun module documentation. Cyclos uses Redis for session storage and caching — configure as documented in App_CloudRun_Guide Group 10. |
| Backup & Maintenance | Group 12 | Refer to base App_CloudRun module documentation for `backup_schedule` and `backup_retention_days`. See [Backup Import & Recovery](#backup-import--recovery) below for `enable_backup_import` and related variables. |
| Custom Initialisation & SQL | Group 13 | Refer to base App_CloudRun module documentation. |
| Access & Networking | Group 14 | Refer to base App_CloudRun module documentation (`ingress_settings`, `vpc_egress_setting`, `network_name`). |
| Identity-Aware Proxy | Group 15 | Refer to base App_CloudRun module documentation. |
| Cloud Armor & CDN | Group 16 | Refer to base App_CloudRun module documentation. |
| VPC Service Controls | Group 17 | Refer to base App_CloudRun module documentation. |

---

## Platform-Managed Behaviours

The following behaviours are applied automatically by `Cyclos_CloudRun` regardless of the variable values in your `tfvars` file. They cannot be overridden by user configuration.

| Behaviour | Detail |
|---|---|
| **NFS disabled** | `enable_nfs` is forced to `false` in the application configuration. Cyclos stores uploaded files and media in the GCS bucket provisioned by the module (`cyclos.storedFileContentManager = gcs`), making a shared NFS filesystem unnecessary. |
| **GCS file storage** | `cyclos.storedFileContentManager = gcs` is injected automatically. The GCS bucket name is derived from the deployment identifiers and injected as `cyclos.storedFileContentManager.bucketName`. |
| **Schema management** | `cyclos.db.managed = true` is set, allowing Cyclos to create and evolve its own database schema on startup. Do not run manual schema migrations against a Cyclos database managed this way. |
| **PostgreSQL extensions** | The following extensions are automatically installed in the application database during the initialisation job: `pg_trgm`, `uuid-ossp`, `cube`, `earthdistance`, `postgis`, `unaccent`. These are required by Cyclos and are installed before the application starts. |
| **Database initialisation** | A dedicated `cyclos` database user is created with the password from Secret Manager and granted the permissions required by the application. The `postgres` superuser is used only for the extension and user setup jobs. |
| **TCP database connection** | `enable_cloudsql_volume` defaults to `false`. Cyclos connects to Cloud SQL via **direct TCP to the internal IP**, not via the Cloud SQL Auth Proxy Unix socket. The `DB_HOST` environment variable is set to the Cloud SQL internal IP address automatically. |

---

## Cyclos Application Identity

These variables control how the Cyclos deployment is named and described. They correspond to the `application_display_name` and `application_description` variables in App_CloudRun but use shorter names to match the Cyclos_Common interface.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_name` | `"cyclos"` | `[a-z][a-z0-9-]{0,19}` | Internal identifier used as the base name for the Cloud Run service, Artifact Registry repository, Secret Manager secrets, and GCS buckets. Functionally identical to `application_name` in App_CloudRun. **Do not change after initial deployment.** |
| `application_version` | `"4.16.17"` | Cyclos version string, e.g. `"4.16.17"` | Version tag applied to the container image and used for deployment tracking. Use the official Cyclos release version matching the image you intend to deploy. See the [Cyclos release notes](https://www.cyclos.org/releaseNotes) for available versions. When `container_image_source = "prebuilt"`, this controls which tagged image is pulled from Docker Hub. |
| `display_name` | `"Cyclos Community Edition"` | Any string | Human-readable name shown in the platform UI, the Cloud Run service list, and monitoring dashboards. Equivalent to `application_display_name` in App_CloudRun. Can be updated freely without affecting resource names. |
| `description` | `"Cyclos Banking System on Cloud Run"` | Any string | Brief description of the deployment. Populated into the Cloud Run service description field and platform documentation. Equivalent to `application_description` in App_CloudRun. |

### Validating Application Identity

```bash
# Confirm the Cloud Run service exists with the expected name
gcloud run services describe cyclos \
  --region=REGION \
  --format="table(metadata.name,metadata.annotations['run.googleapis.com/description'])"
```

---

## Cyclos Runtime Configuration

Cyclos is a Java application and requires significantly more CPU and memory than a typical Cloud Run service. The module exposes `cpu_limit` and `memory_limit` as **dedicated top-level variables** rather than requiring users to set the full `container_resources` object.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `cpu_limit` | `"1000m"` | Cloud Run CPU quantity string (e.g. `"1000m"`, `"2000m"`) | CPU limit for the Cyclos Cloud Run instance. **Cyclos requires a minimum of 2 vCPU for reliable production operation.** The default of `1000m` is sufficient for low-traffic or development deployments. For production, set this to `"2000m"` or higher. Note: CPUs above `"1000m"` require `cpu_always_allocated = true`. |
| `memory_limit` | `"2Gi"` | Cloud Run memory quantity string (e.g. `"2Gi"`, `"4Gi"`) | Memory limit for the Cyclos Cloud Run instance. **4 Gi is recommended for production.** The JVM heap, Cyclos internal caches, and active sessions together typically consume 2–3 Gi under normal load. |

> **Note on `container_resources`:** The full `container_resources` object (as documented in [App_CloudRun_Guide Group 3](../App_CloudRun/App_CloudRun_Guide.md#group-3-runtime--scaling)) is also available and takes precedence over `cpu_limit` and `memory_limit` when set explicitly. Use `container_resources` when you need to set both CPU and memory in a single block, for example in the advanced configuration example.

**Cyclos-specific runtime defaults that differ from App_CloudRun:**

| Variable | App_CloudRun Default | Cyclos_CloudRun Default | Reason |
|---|---|---|---|
| `container_image_source` | `"custom"` | `"prebuilt"` | The official `cyclos/cyclos` Docker Hub image is production-ready and pre-configured. |
| `container_image` | `""` | `"cyclos/cyclos"` | The official Cyclos image from Docker Hub. |
| `enable_cloudsql_volume` | `true` | `false` | Cyclos connects to Cloud SQL via direct TCP to the internal IP, not via the Unix socket provided by the Cloud SQL Auth Proxy. |
| `min_instance_count` | `0` | `1` | Cyclos requires at least one warm instance to avoid cold-start latency on banking transactions. Scale-to-zero is not recommended for production Cyclos deployments. |
| `max_instance_count` | `1` | `1` | Cyclos in standalone mode (`cyclos.clusterHandler = none`) should run as a single instance to avoid session inconsistency. Increase only after configuring Hazelcast clustering. |

### Validating Runtime Configuration

```bash
# View the CPU and memory limits on the latest revision
gcloud run services describe cyclos \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].resources)"

# Confirm TCP database connection (DB_HOST should be an IP address)
gcloud run services describe cyclos \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" | grep DB_HOST
```

---

## Cyclos Database Configuration

Cyclos requires PostgreSQL. The module uses `db_name` and `db_user` (shorter names aligned with the Cyclos_Common interface) in place of the `application_database_name` and `application_database_user` variables documented in [App_CloudRun_Guide Group 11](../App_CloudRun/App_CloudRun_Guide.md#group-11-database-backend).

All other database variables (`sql_instance_name`, `database_password_length`, `enable_auto_password_rotation`, `rotation_propagation_delay_sec`, etc.) behave identically to the App_CloudRun equivalents — refer to [App_CloudRun_Guide Group 11](../App_CloudRun/App_CloudRun_Guide.md#group-11-database-backend) for their documentation.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `db_name` | `"cyclos"` | `[a-z][a-z0-9_]{0,62}` | The name of the PostgreSQL database created within the Cloud SQL instance. Injected as the `DB_NAME` environment variable. **Do not change after initial deployment** — Cyclos stores all application data in this database and renaming it requires manual migration. |
| `db_user` | `"cyclos"` | `[a-z][a-z0-9_]{0,31}` | The PostgreSQL user created for the Cyclos application. Injected as the `DB_USER` environment variable. The password is auto-generated, stored in Secret Manager, and injected as `DB_PASSWORD`. |

> **Important:** Cyclos requires PostgreSQL. The module defaults `database_type` to `"POSTGRES"` (latest managed version). Setting `database_type = "NONE"` or a MySQL/SQL Server type will prevent the application from starting.

> **PostgreSQL extensions** are installed automatically — see [Platform-Managed Behaviours](#platform-managed-behaviours). You do not need to set `enable_postgres_extensions = true` for the Cyclos-required extensions.

### Validating Database Configuration

```bash
# Confirm the database and user were created
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID

gcloud sql users list --instance=INSTANCE_NAME --project=PROJECT_ID

# Confirm DB environment variables are injected into the Cloud Run service
gcloud run services describe cyclos \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -E "DB_"
```

---

## Cyclos Environment Variables

The `environment_variables` variable (documented in [App_CloudRun_Guide Group 4](../App_CloudRun/App_CloudRun_Guide.md#group-4-environment-variables--secrets)) has Cyclos-specific defaults that configure email delivery.

**Default `environment_variables` in Cyclos_CloudRun:**

```hcl
environment_variables = {
  SMTP_HOST     = ""
  SMTP_PORT     = "25"
  SMTP_USER     = ""
  SMTP_PASSWORD = ""
  SMTP_SSL      = "false"
  EMAIL_FROM    = "cyclos@example.com"
}
```

Cyclos uses these variables to configure its outbound email transport (used for notifications, password resets, and transaction confirmations). Configure them to point to your SMTP server before going live. For sensitive values such as `SMTP_PASSWORD`, use `secret_environment_variables` instead:

```hcl
environment_variables = {
  SMTP_HOST  = "smtp.sendgrid.net"
  SMTP_PORT  = "587"
  SMTP_USER  = "apikey"
  SMTP_SSL   = "true"
  EMAIL_FROM = "noreply@yourbank.example.com"
}

secret_environment_variables = {
  SMTP_PASSWORD = "cyclos-smtp-password"   # Secret Manager secret name
}
```

All other `environment_variables` and `secret_environment_variables` behaviour is identical to App_CloudRun — refer to [App_CloudRun_Guide Group 4](../App_CloudRun/App_CloudRun_Guide.md#group-4-environment-variables--secrets).

---

## Cyclos Health Probes

Cyclos is a Java application that performs database schema validation and migration on first boot. This startup phase can take 2–5 minutes on a fresh deployment, much longer than a typical Cloud Run service. The probe variables in `Cyclos_CloudRun` use **different names** from App_CloudRun (`startup_probe` and `liveness_probe` instead of `startup_probe_config` and `health_check_config`) and have extended default timeouts to accommodate this behaviour.

Both probes target the `/api` endpoint, which reflects the Cyclos application's readiness more accurately than a generic `/healthz` path.

| Variable | Default | Description & Implications |
|---|---|---|
| `startup_probe` | `{ enabled = true, type = "HTTP", path = "/api", initial_delay_seconds = 90, timeout_seconds = 30, period_seconds = 60, failure_threshold = 5 }` | Determines when the Cloud Run instance is ready to receive traffic after starting. The `initial_delay_seconds = 90` gives the JVM time to start and Cyclos time to validate or create the database schema before the first probe fires. `failure_threshold = 5` with `period_seconds = 60` allows up to 5 minutes of additional startup time beyond the initial delay. **On first deployment** (when the schema is created from scratch), startup may take longer than usual — consider increasing `failure_threshold` to `10` for the initial rollout. |
| `liveness_probe` | `{ enabled = true, type = "HTTP", path = "/api", initial_delay_seconds = 120, timeout_seconds = 10, period_seconds = 60, failure_threshold = 3 }` | Periodically checks whether a running Cyclos instance is healthy. The `initial_delay_seconds = 120` prevents premature restarts during the startup phase. A `period_seconds = 60` check interval is appropriate for a database-backed application — more frequent checks add unnecessary load to the database. |

> **Relationship to App_CloudRun probes:** `startup_probe` corresponds to `startup_probe_config` in App_CloudRun; `liveness_probe` corresponds to `health_check_config`. Their sub-field structure is identical. The `startup_probe_config` and `health_check_config` variables are also present in `Cyclos_CloudRun` (with `/api` defaults) for compatibility — prefer the dedicated `startup_probe` and `liveness_probe` variables.

### Validating Health Probe Configuration

**Google Cloud Console:** Navigate to **Cloud Run → Services → cyclos → Revisions**, select the latest revision, then click **Container(s)** and view the **Health checks** section.

```bash
# View startup and liveness probe config on the latest revision
gcloud run services describe cyclos \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].livenessProbe,spec.template.spec.containers[0].startupProbe)"

# View Cloud Run logs for startup probe status
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=cyclos AND severity>=WARNING" \
  --project=PROJECT_ID \
  --limit=20 \
  --format="table(timestamp,severity,textPayload)"
```

---

## Backup Import & Recovery

In addition to the scheduled backup (`backup_schedule` and `backup_retention_days`, documented in [App_CloudRun_Guide Group 12](../App_CloudRun/App_CloudRun_Guide.md#group-12-backup--maintenance)), `Cyclos_CloudRun` supports a **one-time import** of an existing Cyclos database backup during deployment. This is designed for migrating an existing Cyclos instance to GCP or seeding a new environment with production data.

The backup import variables in `Cyclos_CloudRun` have the same semantics as those in App_CloudRun_Guide Group 12, with one naming difference: **`backup_uri`** (a full GCS object path or Google Drive file ID) is used instead of `backup_file` (a filename relative to the backup bucket).

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_backup_import` | `false` | `true` / `false` | When `true`, triggers a one-time Cloud Run Job to restore the backup specified by `backup_uri` from the source defined in `backup_source`. The import runs after the database is provisioned and extensions are installed. Configure `backup_source`, `backup_uri`, and `backup_format` before enabling. **If the database already contains data**, the import may produce errors — test in a non-production environment first. |
| `backup_source` | `"gcs"` | `gcs` / `gdrive` | The source from which the backup file is retrieved. **`gcs`:** imports from a Cloud Storage path. Provide the full GCS URI in `backup_uri` (e.g. `gs://my-bucket/backups/cyclos.sql.gz`). **`gdrive`:** imports from a Google Drive file. Provide the Drive file ID in `backup_uri`. Only used when `enable_backup_import = true`. |
| `backup_uri` | `""` | Full GCS URI or Google Drive file ID | For GCS: the full object URI, e.g. `"gs://my-backup-bucket/cyclos-2024-01-15.sql.gz"`. For Google Drive: the file ID from the share URL (the string after `/file/d/` in the URL). Required when `enable_backup_import = true`. |
| `backup_format` | `"gz"` | `sql` / `tar` / `gz` / `tgz` / `tar.gz` / `zip` | The format of the backup file. The default is `"gz"` (gzip-compressed SQL dump from `pg_dump`), which is the recommended format for Cyclos backups. Use `"sql"` for uncompressed plain-text dumps. |

### Validating Backup Import

```bash
# Confirm the import job completed successfully
gcloud run jobs executions list \
  --job=cyclos-backup-import \
  --region=REGION \
  --format="table(name,status.conditions[0].type,status.startTime,status.completionTime)"

# View import job logs for any errors
gcloud logging read \
  "resource.type=cloud_run_job AND resource.labels.job_name=cyclos-backup-import" \
  --project=PROJECT_ID \
  --limit=50 \
  --order=asc \
  --format="table(timestamp,severity,textPayload)"
```

---

## Deployment Prerequisites & Validation

After deploying `Cyclos_CloudRun`, confirm the deployment is healthy:

```bash
# Confirm the Cloud Run service is deployed and its URL
gcloud run services describe cyclos \
  --region=REGION \
  --format="table(status.url,status.conditions[0].type)"

# View the latest revision status
gcloud run revisions list \
  --service=cyclos \
  --region=REGION \
  --format="table(name,status.conditions[0].status,spec.containerConcurrency)"

# Confirm the GCS bucket provisioned for Cyclos file storage
gcloud storage buckets list \
  --project=PROJECT_ID \
  --filter="name:cyclos"

# Confirm PostgreSQL extensions were installed (via initialization job logs)
gcloud run jobs executions list \
  --job=cyclos-db-init \
  --region=REGION \
  --format="table(name,status.conditions[0].type)"

# Verify the Cyclos API endpoint is responding
curl -s -o /dev/null -w "%{http_code}" https://SERVICE_URL/api
# Expect: 200
```
