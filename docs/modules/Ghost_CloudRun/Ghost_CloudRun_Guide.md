---
title: "Ghost Cloud Run Configuration Guide"
sidebar_label: "Cloud Run"
---

# Ghost_CloudRun Module — Configuration Guide

This guide describes every configuration variable available in the `Ghost_CloudRun` module. `Ghost_CloudRun` is a **wrapper module** that combines the generic [`App_CloudRun`](../App_CloudRun/App_CloudRun_Guide.md) infrastructure module with the [`Ghost_Common`](../Ghost_Common/) shared application configuration to deploy the [Ghost](https://ghost.org/) publishing platform on Google Cloud Run (serverless).

Most configuration options in `Ghost_CloudRun` map directly to the same options in `App_CloudRun`. Where a variable is identical in behaviour, this guide references the `App_CloudRun` guide rather than repeating the same documentation. Only the variables and defaults that are **specific to Ghost** are described in full here.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How Ghost_CloudRun Relates to App_CloudRun

`Ghost_CloudRun` passes all variables through to `App_CloudRun` and adds a `Ghost_Common` sub-module that supplies Ghost-specific defaults and application configuration. The main effects are:

1. **MySQL 8.0 is required.** Ghost 6.x requires MySQL 8.0 and will not work with PostgreSQL. The `database_type` default is fixed to `"MYSQL_8_0"`.
2. **`database__client = "mysql"` is injected automatically.** Ghost 6.x will silently fall back to SQLite without this environment variable, even when all other database connection variables are present. The module injects it automatically — you do not need to set it yourself.
3. **A `ghost-content` GCS bucket is provisioned automatically.** `Ghost_Common` provides a `ghost-content` bucket definition that is merged into the module's bucket list. You do not need to define it in `storage_buckets`.
4. **A `db-init` job runs on first deployment.** `Ghost_Common` supplies a default `db-init` Cloud Run Job using a `mysql:8.0-debian` image that initialises the Ghost MySQL schema. Override `initialization_jobs` to replace it with a custom job.
5. **Resource defaults are sized for Ghost.** The default `cpu_limit` (2 vCPU) and `memory_limit` (4 Gi) are higher than the `App_CloudRun` defaults to match Ghost 6.x's resource requirements.
6. **Redis caching is enabled by default.** Ghost uses Redis for page caching. See [Group 20: Redis Cache](#group-20-redis-cache) below.
7. **Health probes are tuned for Ghost's slow startup.** Ghost runs database migrations and compiles themes on first boot. The default startup probe allows 90 seconds of initial delay before checking.
8. **Scale-to-zero is the default.** Cloud Run defaults `min_instance_count` to `0`, allowing the service to scale down completely when idle. Set `min_instance_count = 1` for production Ghost sites to eliminate cold start delays.

---

## Group 0: Module Metadata & Configuration

The behaviour of these variables is identical to `App_CloudRun`. See [App_CloudRun Group 0](../App_CloudRun/App_CloudRun_Guide.md#group-0-module-metadata--configuration) for a full description.

**Ghost-specific defaults:**

| Variable | Ghost_CloudRun Default | Notes |
|---|---|---|
| `module_description` | `"Ghost: Deploy Ghost publishing platform on Google Cloud Run…"` | Pre-populated with Ghost-specific description. |
| `module_documentation` | `"https://docs.techequity.cloud/docs/applications/ghost"` | Points to the Ghost documentation page. |
| `module_services` | Includes Ghost-relevant services | Adds `Cloud SQL (MySQL 8.0)`, `Cloud Run Jobs`, and `SMTP Integration` to the standard list. |

---

## Group 1: Project & Identity

Identical to `App_CloudRun`. See [App_CloudRun Group 1](../App_CloudRun/App_CloudRun_Guide.md#group-1-project--identity).

---

## Group 2: Application Identity

These variables behave identically to `App_CloudRun`. See [App_CloudRun Group 2](../App_CloudRun/App_CloudRun_Guide.md#group-2-application-identity) for descriptions.

**Ghost-specific defaults:**

| Variable | Ghost_CloudRun Default | App_CloudRun Default | Notes |
|---|---|---|---|
| `application_name` | `"ghost"` | `"crapp"` | Used as the base name for all GCP resources. **Do not change after deployment.** |
| `display_name` | `"Ghost Publishing"` | `"App_CloudRun Application"` | Shown in the platform UI and dashboards. Can be changed freely. |
| `description` | `"Ghost - Professional publishing platform"` | `"App_CloudRun Custom Application…"` | Descriptive label. Can be changed freely. |
| `application_version` | `"6.14.0"` | `"1.0.0"` | The Ghost release version to build and deploy. Incrementing this value triggers a new Cloud Build run and a new Cloud Run revision. |

---

## Group 3: Runtime & Scaling

Most variables behave identically to `App_CloudRun`. See [App_CloudRun Group 3](../App_CloudRun/App_CloudRun_Guide.md#group-3-runtime--scaling).

**Ghost-specific defaults and behaviour:**

| Variable | Ghost_CloudRun Default | App_CloudRun Default | Notes |
|---|---|---|---|
| `container_port` | `2368` | `8080` | Ghost's native HTTP port. Do not change unless your custom Dockerfile binds Ghost to a different port. |
| `min_instance_count` | `0` | `0` | Cloud Run defaults to scale-to-zero. **For production Ghost sites, set to `1`** to keep at least one instance warm and avoid cold start delays when readers visit the site. Cold starts can take 5–15 seconds for Ghost 6.x due to initialisation overhead. |
| `max_instance_count` | `5` | `1` | Ghost is more resource-intensive than a generic application; the higher ceiling accommodates traffic spikes during newsletter sends or content publication. |
| `cpu_limit` | `"2000m"` | `"1000m"` | Ghost 6.x requires a minimum of 1 vCPU; 2 vCPU (2000m) is recommended for production. Note that Cloud Run requires `cpu_always_allocated = true` (or equivalent) when `cpu_limit` exceeds `1000m`. |
| `memory_limit` | `"4Gi"` | `"512Mi"` | Ghost 6.x uses significantly more memory than the base default. 4 Gi is recommended for production; do not set below 512 Mi or Ghost will fail during theme compilation. |
| `container_image_source` | `"custom"` | `"custom"` | `Ghost_Common` supplies a Dockerfile-based build by default so that Ghost can be customised with plugins and themes. Set to `"prebuilt"` to deploy the official Docker Hub Ghost image directly. |
| `execution_environment` | `"gen2"` | `"gen2"` | gen2 is required for NFS mounts (`enable_nfs = true`) and GCS Fuse volumes. Do not change to `"gen1"` if NFS or GCS volume mounts are enabled. |
| `enable_cloudsql_volume` | `true` | `true` | The Cloud SQL Auth Proxy sidecar is required for Ghost to connect to Cloud SQL via a Unix socket. Only disable if connecting to Cloud SQL directly over a private TCP connection. |

**Traffic splitting for canary and blue-green deployments:**

`Ghost_CloudRun` supports the `traffic_split` variable inherited from `App_CloudRun`. This allows gradual rollouts of new Ghost revisions. See [App_CloudRun Group 3](../App_CloudRun/App_CloudRun_Guide.md#group-3-runtime--scaling) for full documentation on `traffic_split`.

The remaining runtime variables (`deploy_application`, `container_image`, `container_build_config`, `enable_image_mirroring`, `enable_vertical_pod_autoscaling` *(N/A for Cloud Run)*, `container_protocol`, `timeout_seconds`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels`, `enable_image_mirroring`, `container_protocol`) behave as described in [App_CloudRun Group 3](../App_CloudRun/App_CloudRun_Guide.md#group-3-runtime--scaling).

---

## Group 4: Access & Networking

These variables behave identically to `App_CloudRun`. See [App_CloudRun Group 4](../App_CloudRun/App_CloudRun_Guide.md) for full descriptions.

**Cloud Run-specific networking variables (not present in Ghost_GKE):**

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `"all"` | Controls which traffic sources may reach the Cloud Run service. `"all"` permits public internet traffic. `"internal"` restricts access to VPC and Google internal services only. `"internal-and-cloud-load-balancing"` is required when fronting the service with a Cloud Armor HTTPS Load Balancer. |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | Controls how outbound traffic from Ghost is routed. `"PRIVATE_RANGES_ONLY"` routes only RFC 1918 addresses through the VPC (used for Cloud SQL and NFS access); public traffic exits directly. `"ALL_TRAFFIC"` routes all egress through the VPC — use when on-premises connectivity or strict egress controls are required. |

**IAP and Cloud Armor:**

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Enables Cloud Run's native Identity-Aware Proxy integration. No load balancer is required. When enabled, configure `iap_authorized_users` and `iap_authorized_groups` to grant access. Useful for internal or admin-facing Ghost deployments. |
| `iap_authorized_users` | `[]` | Individual users or service accounts granted IAP access. Format: `"user:email@example.com"`. |
| `iap_authorized_groups` | `[]` | Google Groups granted IAP access. Format: `"group:name@example.com"`. |
| `enable_cloud_armor` | `false` | Enables a Cloud Armor WAF security policy fronted by a Global HTTPS Load Balancer. |
| `admin_ip_ranges` | `[]` | Admin CIDR ranges permitted through Cloud Armor. |
| `application_domains` | `[]` | Custom domain names associated with the Cloud Armor load balancer (e.g. `["ghost.example.com"]`). |
| `enable_cdn` | `false` | Enables Cloud CDN on the Cloud Armor load balancer to cache Ghost's static assets at Google's edge. |
| `enable_vpc_sc` | `false` | Enables VPC Service Controls perimeter enforcement. |

---

## Group 5: Environment Variables & Secrets

These variables behave identically to `App_CloudRun`. See [App_CloudRun Group 4](../App_CloudRun/App_CloudRun_Guide.md#group-4-environment-variables--secrets).

**Ghost-specific defaults:**

Ghost pre-populates `environment_variables` with SMTP settings so that Ghost's email delivery (newsletter sends, member sign-up confirmations, password resets) can be configured without additional setup:

| Variable | Default |
|---|---|
| `SMTP_HOST` | `""` *(set to your SMTP server hostname)* |
| `SMTP_PORT` | `"25"` |
| `SMTP_USER` | `""` |
| `SMTP_PASSWORD` | `""` |
| `SMTP_SSL` | `"false"` |
| `EMAIL_FROM` | `"ghost@example.com"` |

**The `database__client = "mysql"` variable is injected automatically by the module.** Do not set it manually in `environment_variables` — the module handles this to ensure Ghost 6.x connects to MySQL rather than falling back to SQLite.

Override `environment_variables` with a complete map to replace the SMTP defaults and add any additional Ghost configuration variables:

```hcl
environment_variables = {
  SMTP_HOST     = "smtp.mailgun.org"
  SMTP_PORT     = "587"
  SMTP_USER     = "postmaster@mg.example.com"
  SMTP_PASSWORD = "your-smtp-password"
  SMTP_SSL      = "true"
  EMAIL_FROM    = "noreply@example.com"
  NODE_ENV      = "production"
}
```

The remaining secrets variables (`secret_environment_variables`, `secret_rotation_period`, `secret_propagation_delay`) behave as described in [App_CloudRun Group 4](../App_CloudRun/App_CloudRun_Guide.md#group-4-environment-variables--secrets).

---

## Group 6: Backup & Maintenance

These variables behave identically to `App_CloudRun`. See [App_CloudRun Group 12](../App_CloudRun/App_CloudRun_Guide.md).

**Ghost-specific defaults:**

| Variable | Default | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Daily at 02:00 UTC. Adjust to match your Recovery Point Objective and traffic patterns. |
| `backup_retention_days` | `7` | 7-day retention. Increase for production deployments (30–90 days recommended). |

**Backup Import** — Ghost_CloudRun supports importing an existing backup on first deployment:

| Variable | Default | Description |
|---|---|---|
| `enable_backup_import` | `false` | When `true`, runs a one-time Cloud Run Job during deployment to restore the backup specified by `backup_uri`. Configure `backup_source`, `backup_uri`, and `backup_format` before enabling. |
| `backup_source` | `"gcs"` | Source system for the backup file. `"gcs"` imports from a Cloud Storage URI; `"gdrive"` imports from a Google Drive file ID. |
| `backup_uri` | `""` | Location of the backup file. For GCS: `"gs://my-bucket/backups/ghost.sql"`. For Google Drive: the file ID from the share URL (e.g. `"1A2B3C4D5E6F"` from `https://drive.google.com/file/d/1A2B3C4D5E6F/view`). |
| `backup_format` | `"sql"` | Format of the backup file. Supported values: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

---

## Group 7: CI/CD & GitHub Integration

Identical to `App_CloudRun`. See [App_CloudRun Group 7](../App_CloudRun/App_CloudRun_Guide.md).

Available variables: `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`.

**Cloud Deploy stages in Ghost_CloudRun** have a slightly different shape to the GKE equivalent: each stage targets a Cloud Run service rather than a Kubernetes namespace. See [App_CloudRun Group 7](../App_CloudRun/App_CloudRun_Guide.md) for the full `cloud_deploy_stages` field reference.

---

## Group 8: Jobs & Scheduled Tasks

These variables behave as described in [App_CloudRun Group 6](../App_CloudRun/App_CloudRun_Guide.md#group-6-jobs--scheduled-tasks), with one important Ghost-specific behaviour.

**Ghost default `db-init` job:**

When `initialization_jobs` is left as the default (empty list `[]`), `Ghost_Common` automatically supplies a `db-init` job:

| Field | Value |
|---|---|
| Job name | `db-init` |
| Image | `mysql:8.0-debian` |
| Purpose | Initialises the Ghost MySQL database schema and user |
| Execute on every apply | `true` |
| CPU / Memory | `1000m` / `512Mi` |

Override `initialization_jobs` with a non-empty list to replace this default with your own jobs.

The `cron_jobs` and `additional_services` variables are available and behave identically to `App_CloudRun`. See [App_CloudRun Group 6](../App_CloudRun/App_CloudRun_Guide.md#group-6-jobs--scheduled-tasks) for full documentation.

---

## Group 9: Custom Initialisation & SQL

Identical to `App_CloudRun`. See [App_CloudRun Group 13](../App_CloudRun/App_CloudRun_Guide.md).

Available variables: `enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root`.

---

## Group 10: Storage & Filesystem

These variables behave identically to `App_CloudRun`. See [App_CloudRun Group 10](../App_CloudRun/App_CloudRun_Guide.md).

**Ghost-specific defaults:**

| Variable | Default | Notes |
|---|---|---|
| `enable_nfs` | `true` | NFS storage is enabled by default. Ghost stores uploaded images, themes, and other content files on the shared NFS volume so all container instances access the same filesystem. Disable only if using GCS Fuse exclusively for content storage. Requires `execution_environment = "gen2"`. |
| `nfs_mount_path` | `"/mnt/nfs"` | The path where the NFS volume is mounted inside the Ghost container. Configure your Ghost Dockerfile to use this path for the `content` directory. |

`Ghost_Common` automatically provisions a `ghost-content` GCS bucket in addition to any buckets defined in `storage_buckets`. This bucket is used for Ghost media storage via GCS Fuse. You do not need to define it manually.

| Bucket | `name_suffix` | Purpose |
|---|---|---|
| Auto-provisioned | `ghost-content` | Ghost media storage (images, files, themes) via GCS Fuse CSI Driver |

The `create_cloud_storage`, `storage_buckets`, and `gcs_volumes` variables behave as described in [App_CloudRun Group 10](../App_CloudRun/App_CloudRun_Guide.md).

---

## Group 11: Database Backend

These variables behave identically to `App_CloudRun`. See [App_CloudRun Group 11](../App_CloudRun/App_CloudRun_Guide.md).

**Ghost-specific defaults and restrictions:**

| Variable | Ghost_CloudRun Default | App_CloudRun Default | Notes |
|---|---|---|---|
| `db_name` | `"ghost"` | *(not in App_CloudRun)* | Ghost-specific shorthand for the database name. Injected into Ghost_Common configuration. |
| `db_user` | `"ghost"` | *(not in App_CloudRun)* | Ghost-specific shorthand for the database user. |
| `database_password_length` | `16` | `16` | Increase to `32` for production. |

> **Important:** Ghost_CloudRun always uses `database_type = "MYSQL_8_0"`. This value is set by `Ghost_Common` and cannot be overridden — Ghost 6.x will not function with any other database engine.

**Automatic password rotation:**

| Variable | Default | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Deploys an automated database password rotation Cloud Run Job with Eventarc. When `true`, the database password is rotated on the schedule defined by `secret_rotation_period`. The Cloud Run service is automatically restarted after rotation to pick up the new credential. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before restarting the Cloud Run service, allowing Secret Manager global replication to complete. |

---

## Group 12: Jobs — Observability & Health

These variables behave identically to `App_CloudRun`. See [App_CloudRun Group 5](../App_CloudRun/App_CloudRun_Guide.md#group-5-observability--health).

**Ghost-specific defaults:**

Ghost 6.x performs database migrations and theme compilation during startup, meaning the first boot after a fresh deployment takes significantly longer than subsequent boots. The health probe defaults are tuned to accommodate this:

**Startup probe** (`startup_probe`):

| Field | Ghost Default | App_CloudRun Default | Notes |
|---|---|---|---|
| `path` | `"/"` | `"/healthz"` | Ghost does not expose a dedicated `/healthz` endpoint; the root path returns HTTP 200 when the application is ready. |
| `initial_delay_seconds` | `90` | `10` | Allows Ghost 90 seconds before the first probe attempt, giving it time to run database migrations. |
| `failure_threshold` | `10` | `10` | Ghost may take up to 100 seconds on first boot; `10 × period_seconds (10s) = 100s` total allowance. |

**Liveness probe** (`liveness_probe`):

| Field | Ghost Default | App_CloudRun Default | Notes |
|---|---|---|---|
| `path` | `"/"` | `"/healthz"` | Same as startup probe. |
| `initial_delay_seconds` | `60` | `15` | Gives Ghost additional time to stabilise before liveness checks begin. |

The `uptime_check_config` and `alert_policies` variables behave as described in [App_CloudRun Group 5](../App_CloudRun/App_CloudRun_Guide.md#group-5-observability--health).

---

## Group 20: Redis Cache

These variables are specific to Ghost and do not exist in the base `App_CloudRun` module. Ghost uses Redis for page caching and session caching, which significantly reduces database load and improves page delivery speed for high-traffic sites.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `true` | `true` / `false` | Enables Redis as Ghost's caching backend. When `true` and `redis_host` is blank, the module defaults to using the NFS server IP as the Redis host. **Recommended for all production deployments.** Disable only in development or testing environments where the additional infrastructure is not required. When disabled, Ghost serves all pages without a cache, which increases database query load and raises page load times under concurrent traffic. |
| `redis_host` | `""` *(defaults to NFS server IP)* | Hostname or IP address | The hostname or IP address of the Redis server Ghost connects to for caching. Leave blank to use the automatically discovered NFS server IP (which typically co-hosts a Redis process in the platform's default configuration). Override with an explicit IP or hostname when using a dedicated Redis instance — such as a Google Cloud Memorystore for Redis instance — for higher reliability and throughput. Example: `"10.128.0.10"`, `"redis.example.internal"`. |
| `redis_port` | `"6379"` | Port number string | The TCP port on which the Redis server is listening. The default `6379` is the standard Redis port. Change only if your Redis instance is configured to listen on a non-standard port. |
| `redis_auth` | `""` | String *(sensitive)* | The authentication password for the Redis server. Leave empty if the Redis instance does not require authentication. For production deployments using Google Cloud Memorystore with AUTH enabled, set this to the instance's AUTH string. This value is treated as sensitive and is never stored in Terraform state in plaintext. |

### Validating Group 20 Settings

**Google Cloud Console:**
- **Memorystore instance (if used):** Navigate to **Memorystore → Redis** to confirm the instance exists, its IP address, port, and AUTH status.
- **Ghost cache status:** Once deployed, navigate to the Ghost Admin panel (**Settings → Labs**) or check the Cloud Run service logs for cache connection confirmation messages.

**gcloud CLI:**
```bash
# List Memorystore Redis instances in the project (if using Memorystore)
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,memorySizeGb,authEnabled)"

# Confirm the Redis environment variables are set in the Cloud Run revision
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" \
  | grep -i redis

# View Cloud Run service logs for Redis connection messages
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=SERVICE_NAME AND textPayload:redis" \
  --project=PROJECT_ID \
  --limit=20 \
  --format="table(timestamp,textPayload)"
```
