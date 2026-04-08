---
title: "Directus Cloud Run Configuration Guide"
sidebar_label: "Cloud Run"
---

# Directus_CloudRun Module — Configuration Guide

`Directus_CloudRun` is a wrapper module that deploys [Directus](https://directus.io/) — an open-source headless CMS and data API platform — on Google Cloud Run. It composes two underlying modules:

- **[App_CloudRun](../App_CloudRun/App_CloudRun_Guide.md)** — provides all Cloud Run infrastructure: service configuration, scaling, networking, security, CI/CD, storage, observability, and backup.
- **Directus_Common** — generates the Directus application configuration, database initialisation scripts, migration jobs, and Directus-specific environment variables. Its outputs are injected into `App_CloudRun` via the `application_config`, `module_env_vars`, `module_secret_env_vars`, and `module_storage_buckets` inputs.

> **How to use this guide:** Every variable available in `App_CloudRun` is also available in `Directus_CloudRun` under the same name and with the same behaviour, unless noted below. **For the full description of those variables, consult the [App_CloudRun Configuration Guide](../App_CloudRun/App_CloudRun_Guide.md).** This guide documents only what is unique to `Directus_CloudRun`: variables that use different names from their `App_CloudRun` equivalents, and variables whose default values have been tuned for Directus.

---

## Standard Configuration Reference

The following configuration groups are provided by the underlying `App_CloudRun` module with no Directus-specific differences. Consult the linked sections of the `App_CloudRun` Configuration Guide for full documentation.

| Group | App_CloudRun Guide Section | Notes |
|---|---|---|
| Module Metadata & Configuration | [Group 0](../App_CloudRun/App_CloudRun_Guide.md#group-0-module-metadata--configuration) | Directus-specific `module_description`, `module_documentation`, and `module_services` defaults are pre-set. |
| Project & Identity | [Group 1](../App_CloudRun/App_CloudRun_Guide.md#group-1-project--identity) | Identical. |
| Application Identity | [Group 2](../App_CloudRun/App_CloudRun_Guide.md#group-2-application-identity) | Directus-specific defaults; `display_name` and `description` are Directus-specific aliases — see [Application Identity](#application-identity) below. |
| Runtime & Scaling | [Group 3](../App_CloudRun/App_CloudRun_Guide.md#group-3-runtime--scaling) | Directus-specific defaults for `container_port`, `execution_environment`, `enable_cloudsql_volume`, and scaling counts; also exposes `cpu_limit`, `memory_limit`, `startup_probe`, and `liveness_probe` — see [Runtime Configuration](#runtime-configuration) below. |
| Environment Variables & Secrets | [Group 4](../App_CloudRun/App_CloudRun_Guide.md#group-4-environment-variables--secrets) | Identical. Note that `environment_variables` includes SMTP defaults pre-populated for Directus. |
| Observability & Health | [Group 5](../App_CloudRun/App_CloudRun_Guide.md#group-5-observability--health) | Directus exposes `startup_probe` and `liveness_probe` shorthand variables pre-tuned for the `/server/health` endpoint — see [Runtime Configuration](#runtime-configuration) below. |
| Jobs & Scheduled Tasks | [Group 6](../App_CloudRun/App_CloudRun_Guide.md#group-6-jobs--scheduled-tasks) | The Directus database migration job is injected automatically by `Directus_Common`; jobs defined in `initialization_jobs` are appended after it. Cloud Run cron jobs differ from GKE: they use Cloud Run Jobs triggered by Cloud Scheduler rather than Kubernetes CronJobs. |
| CI/CD & GitHub Integration | [Group 7](../App_CloudRun/App_CloudRun_Guide.md#group-7-cicd--github-integration) | Identical, including `enable_cloud_deploy`, `cloud_deploy_stages`, and `enable_binary_authorization`. |
| Storage & Filesystem — NFS | [Group 8](../App_CloudRun/App_CloudRun_Guide.md#group-8-storage--filesystem--nfs) | `enable_nfs` defaults to `true` for Directus to support shared asset storage. Requires `execution_environment = "gen2"`. |
| Storage & Filesystem — GCS | [Group 9](../App_CloudRun/App_CloudRun_Guide.md#group-9-storage--filesystem--gcs) | Identical. GCS Fuse mounts also require `execution_environment = "gen2"`. |
| Redis Cache | [Group 10](../App_CloudRun/App_CloudRun_Guide.md#group-10-redis-cache) | `enable_redis` defaults to `true` for Directus. All four variables (`enable_redis`, `redis_host`, `redis_port`, `redis_auth`) are fully documented in the `App_CloudRun` guide. |
| Database Backend | [Group 11](../App_CloudRun/App_CloudRun_Guide.md#group-11-database-backend) | Directus-specific defaults and simplified interface — `application_database_name` and `application_database_user` are exposed as `db_name` and `db_user`. Postgres extension installation is handled internally by `Directus_Common`. See [Database Configuration](#database-configuration) below. |
| Backup & Maintenance | [Group 12](../App_CloudRun/App_CloudRun_Guide.md#group-12-backup--maintenance) | Identical. `backup_file` in `App_CloudRun` is exposed as `backup_uri` in `Directus_CloudRun`. |
| Custom Initialisation & SQL | [Group 13](../App_CloudRun/App_CloudRun_Guide.md#group-13-custom-initialisation--sql) | Identical. |
| Access & Networking | [Group 14](../App_CloudRun/App_CloudRun_Guide.md#group-14-access--networking) | Identical (`ingress_settings`, `vpc_egress_setting`). |
| Identity-Aware Proxy | [Group 15](../App_CloudRun/App_CloudRun_Guide.md#group-15-identity-aware-proxy) | Identical. |
| Cloud Armor & CDN | [Group 16](../App_CloudRun/App_CloudRun_Guide.md#group-16-cloud-armor--cdn) | Identical (`enable_cloud_armor`, `admin_ip_ranges`, `application_domains`, `enable_cdn`). |
| VPC Service Controls | [Group 17](../App_CloudRun/App_CloudRun_Guide.md#group-17-vpc-service-controls) | Identical. |

---

## Directus-Specific Defaults

The following variables are shared with `App_CloudRun` but have different default values in `Directus_CloudRun`, pre-tuned for a Directus deployment. Where the variable name differs from its `App_CloudRun` equivalent, the `App_CloudRun` name is shown in parentheses.

| Variable | Directus_CloudRun Default | App_CloudRun Default | Reason |
|---|---|---|---|
| `application_name` | `"directus"` | `"crapp"` | Identifies the Directus workload across all resource names. |
| `application_version` | `"11.1.0"` | `"1.0.0"` | Pins the Directus container image version. |
| `container_port` | `8055` | `8080` | Directus listens on port 8055 by default. |
| `execution_environment` | `"gen2"` | `"gen2"` | Gen2 is required for NFS mounts and GCS Fuse; the default is the same. |
| `min_instance_count` | `0` | `0` | Scale-to-zero is the default; set to `1` or more to eliminate cold starts. |
| `max_instance_count` | `1` | `1` | Start with 1 and increase based on observed load. |
| `cpu_limit` (`container_resources.cpu_limit`) | `"1000m"` | `"1000m"` | 1 vCPU is the default; increase to `"2000m"` for production workloads. |
| `memory_limit` (`container_resources.memory_limit`) | `"2Gi"` | `"512Mi"` | Directus requires at minimum 512Mi; 2Gi is recommended for production. |
| `enable_cloudsql_volume` | `false` | `true` | Cloud Run connects to Cloud SQL natively via the service's `cloudsql-instances` annotation. The Auth Proxy sidecar volume is not required unless your application code explicitly uses Unix socket paths. |
| `enable_nfs` | `true` | *(varies)* | Shared NFS storage is used for Directus uploaded assets and media. Requires `execution_environment = "gen2"`. |
| `enable_redis` | `true` | `true` | Directus uses Redis for caching and rate limiting. See [App_CloudRun Guide — Group 10](../App_CloudRun/App_CloudRun_Guide.md#group-10-redis-cache). |

---

## Variable Name Differences

Several variables in `Directus_CloudRun` use different names from their `App_CloudRun` equivalents. This provides a Directus-focused interface without exposing the generic application naming.

| Directus_CloudRun Variable | App_CloudRun Equivalent | Notes |
|---|---|---|
| `display_name` | `application_display_name` | Human-readable name shown in the Cloud Run console. Default: `"Directus CMS"`. |
| `description` | `application_description` | Brief description of the application. Default: `"Directus - Open Source Headless CMS and Backend-as-a-Service"`. |
| `db_name` | `application_database_name` | Name of the database within the Cloud SQL instance. Default: `"directus"`. |
| `db_user` | `application_database_user` | Username of the database user. Default: `"directus"`. |
| `cpu_limit` | `container_resources.cpu_limit` | Top-level convenience variable; overrides the `cpu_limit` field of `container_resources`. |
| `memory_limit` | `container_resources.memory_limit` | Top-level convenience variable; overrides the `memory_limit` field of `container_resources`. |
| `startup_probe` | `startup_probe_config` | Shorthand probe object pre-configured for Directus. See [Runtime Configuration](#runtime-configuration). |
| `liveness_probe` | `health_check_config` | Shorthand probe object pre-configured for Directus. See [Runtime Configuration](#runtime-configuration). |
| `backup_uri` | `backup_file` | URI of the backup file to import. For GCS: `gs://bucket/path/file.sql`. For Google Drive: the file ID. |

---

## Application Identity

`Directus_CloudRun` renames two of the `App_CloudRun` application identity variables to use shorter, Directus-idiomatic names. The underlying behaviour is identical.

| Variable | Default | App_CloudRun Equivalent | Description |
|---|---|---|---|
| `display_name` | `"Directus CMS"` | `application_display_name` | Human-readable name for the Cloud Run service, displayed in the Cloud Run console and monitoring dashboards. Can be updated freely without affecting resource names. |
| `description` | `"Directus - Open Source Headless CMS and Backend-as-a-Service"` | `application_description` | Brief description of the application's purpose. Populated into the Cloud Run service description. |

For `application_name`, `application_version`, and `deploy_application`, see [App_CloudRun Guide — Group 2](../App_CloudRun/App_CloudRun_Guide.md#group-2-application-identity).

---

## Runtime Configuration

### CPU and Memory

Rather than nesting resource settings inside the `container_resources` object, `Directus_CloudRun` exposes `cpu_limit` and `memory_limit` as top-level variables for convenience. These override the corresponding fields of `container_resources`.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `cpu_limit` | `"1000m"` | Cloud Run CPU string (e.g. `"1000m"`, `"2000m"`) | Maximum CPU allocated to each Directus instance. Cloud Run supports `1000m`, `2000m`, `4000m`, `6000m`, and `8000m`. CPUs above `1000m` require `cpu_always_allocated = true`. For busy production deployments, `"2000m"` is recommended. |
| `memory_limit` | `"2Gi"` | Cloud Run memory string (e.g. `"1Gi"`, `"4Gi"`) | Maximum memory allocated to each Directus instance. `2Gi` is the recommended minimum for production. Directus loads schema definitions, extension metadata, and cached API responses into memory; larger deployments with many collections should increase this value. |

For full resource configuration including `container_resources.cpu_request` and `container_resources.mem_request`, use the `container_resources` variable as documented in [App_CloudRun Guide — Group 3](../App_CloudRun/App_CloudRun_Guide.md#group-3-runtime--scaling).

### Health Probes

`Directus_CloudRun` exposes two shorthand probe variables pre-configured with Directus-appropriate settings. These are applied in addition to (and take precedence over) the `startup_probe_config` and `health_check_config` structured objects from `App_CloudRun`. All probes target the `/server/health` endpoint, which reflects live Directus application and database connectivity status.

| Variable | Default | Description & Implications |
|---|---|---|
| `startup_probe` | See below | Configures the Cloud Run startup probe used to determine when a newly started Directus instance is ready to receive traffic. Cloud Run will not route requests to the instance until this probe succeeds. |
| `liveness_probe` | See below | Configures the Cloud Run liveness probe that periodically checks whether a running Directus instance remains healthy. An instance is restarted if this probe fails `failure_threshold` consecutive times. |

**`startup_probe` default:**

```hcl
startup_probe = {
  enabled               = true
  type                  = "HTTP"
  path                  = "/server/health"
  initial_delay_seconds = 30
  timeout_seconds       = 5
  period_seconds        = 20
  failure_threshold     = 10  # Allows up to 230 seconds for Directus to start
}
```

The `initial_delay_seconds = 30` and high `failure_threshold` (10 × 20s = 200 seconds after the initial delay) accommodate Directus startup, which includes database migration checks, extension loading, and schema caching. Reduce only if your deployment consistently starts within a shorter window.

**`liveness_probe` default:**

```hcl
liveness_probe = {
  enabled               = true
  type                  = "HTTP"
  path                  = "/server/health"
  initial_delay_seconds = 15
  timeout_seconds       = 5
  period_seconds        = 30
  failure_threshold     = 3
}
```

After startup, an instance is considered unhealthy and restarted if `/server/health` fails three consecutive times within 90 seconds.

For the structured probe configuration variables (`startup_probe_config`, `health_check_config`, `uptime_check_config`, `alert_policies`), see [App_CloudRun Guide — Group 5](../App_CloudRun/App_CloudRun_Guide.md#group-5-observability--health).

### Validating Runtime Configuration

```bash
# View health probe configuration on the latest Cloud Run revision
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].livenessProbe,spec.template.spec.containers[0].startupProbe)"

# Manually verify the Directus health endpoint
curl -sf https://SERVICE_URL/server/health
```

---

## Environment Variables

All environment variable and secret injection behaviour is documented in [App_CloudRun Guide — Group 4](../App_CloudRun/App_CloudRun_Guide.md#group-4-environment-variables--secrets). `Directus_CloudRun` differs in one respect: the `environment_variables` map is pre-populated with SMTP configuration keys to make email integration straightforward. These placeholders are injected into the Cloud Run revision and recognised directly by Directus.

| Pre-populated Key | Default Value | Description |
|---|---|---|
| `EMAIL_SMTP_HOST` | `""` | Hostname of the outgoing SMTP server. Set to your mail provider's SMTP host (e.g. `smtp.sendgrid.net`, `smtp.mailgun.org`). Leave blank to disable outgoing email. |
| `EMAIL_SMTP_PORT` | `"25"` | SMTP port. Common values: `25` (unencrypted), `465` (TLS), `587` (STARTTLS). Use `587` with `EMAIL_SMTP_SECURE = "false"` for most modern providers. |
| `EMAIL_SMTP_USER` | `""` | SMTP username for authentication. Required by most providers. |
| `EMAIL_SMTP_PASSWORD` | `""` | SMTP password. **Move this to `secret_environment_variables`** for any non-development environment — do not leave plaintext credentials in `environment_variables`. |
| `EMAIL_SMTP_SECURE` | `"false"` | Set to `"true"` to enable TLS wrapping on the SMTP connection (port 465). Set to `"false"` for STARTTLS (port 587) or unencrypted (port 25). |
| `EMAIL_EMAIL_FROM` | `"admin@example.com"` | The sender address displayed in outgoing Directus emails (invitations, password resets, flow notifications). Update this to a valid address associated with your SMTP account to avoid delivery failures. |

> **Security note:** If your SMTP provider requires a password, set `EMAIL_SMTP_PASSWORD` to an empty string in `environment_variables` and supply the actual password via `secret_environment_variables` — for example `{ EMAIL_SMTP_PASSWORD = "directus-smtp-password" }` — where `"directus-smtp-password"` is the name of an existing Secret Manager secret in your project.

You can override or extend these defaults by passing additional keys in `environment_variables`. Any key explicitly set in your configuration takes precedence over the module's pre-populated values.

---

## Database Configuration

`Directus_CloudRun` exposes a simplified database interface. The `application_database_name` and `application_database_user` variables are renamed to `db_name` and `db_user` with Directus-appropriate defaults. PostgreSQL extension installation (including `uuid-ossp`) is handled internally by `Directus_Common` and is not configurable through this module's variables.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `db_name` | `"directus"` | `[a-z][a-z0-9_]{0,62}` | Name of the database created within the Cloud SQL instance. Injected into the Directus container as the `DB_DATABASE` environment variable. **Do not change after initial deployment** — renaming requires manual data migration. |
| `db_user` | `"directus"` | `[a-z][a-z0-9_]{0,31}` | Username of the database user created for the Directus application. Injected as the `DB_USER` environment variable. The password is auto-generated, stored in Secret Manager, and injected as `DB_PASSWORD`. |
| `database_password_length` | `16` | Integer `8`–`64` | Length of the randomly generated database user password. **Recommended minimum for production: `32`**. |

For all other database variables (`database_type`, `sql_instance_name`, `enable_auto_password_rotation`, `rotation_propagation_delay_sec`, `enable_postgres_extensions`, `postgres_extensions`, `enable_mysql_plugins`, `mysql_plugins`), see [App_CloudRun Guide — Group 11](../App_CloudRun/App_CloudRun_Guide.md#group-11-database-backend).

### Validating Database Configuration

```bash
# List databases on the Cloud SQL instance
gcloud sql databases list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,charset,collation)"

# Confirm DB environment variables are injected into the Cloud Run revision
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" \
  | grep -E "DB_"
```
