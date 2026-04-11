# Ghost GKE Module — Configuration Guide

This guide describes every configuration variable available in the `Ghost GKE` module. `Ghost GKE` is a **wrapper module** that combines the generic [`App GKE`](../App_GKE/App_GKE_Guide.md) infrastructure module with the [`Ghost_Common`](../Ghost_Common/) shared application configuration to deploy the [Ghost](https://ghost.org/) publishing platform on Google Kubernetes Engine (GKE) Autopilot.

Most configuration options in `Ghost GKE` map directly to the same options in `App GKE`. Where a variable is identical in behaviour, this guide references the `App GKE` guide rather than repeating the same documentation. Only the variables and defaults that are **specific to Ghost** are described in full here.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How Ghost GKE Relates to App GKE

`Ghost GKE` passes all variables through to `App GKE` and adds a `Ghost_Common` sub-module that supplies Ghost-specific defaults and application configuration. The main effects are:

1. **MySQL 8.0 is required.** Ghost 6.x requires MySQL 8.0 and will not work with PostgreSQL. The `database_type` default is overridden to `"MYSQL_8_0"`.
2. **`database__client = "mysql"` is injected automatically.** Ghost 6.x will silently fall back to SQLite without this environment variable, even when all other database connection variables are present. The module injects it automatically — you do not need to set it yourself.
3. **A `ghost-content` GCS bucket is provisioned automatically.** `Ghost_Common` provides a `ghost-content` bucket definition that is merged into the module's bucket list. You do not need to define it in `storage_buckets`.
4. **A `db-init` job runs on first deployment.** `Ghost_Common` supplies a default `db-init` Kubernetes Job using a `mysql:8.0-debian` image that initialises the Ghost MySQL schema. Override `initialization_jobs` to replace it with a custom job.
5. **Resource defaults are sized for Ghost.** The default `cpu_limit` (2 vCPU) and `memory_limit` (4 Gi) are higher than the `App GKE` defaults to match Ghost 6.x's resource requirements.
6. **Redis caching is enabled by default.** Ghost uses Redis for page caching. See [Group 20: Redis Cache](#group-20-redis-cache) below.
7. **Health probes are tuned for Ghost's slow startup.** Ghost runs database migrations and compiles themes on first boot. The default startup probe allows 90 seconds of initial delay before checking.

---

## Group 0: Module Metadata & Configuration

The behaviour of these variables is identical to `App GKE`. See [App GKE Group 0](../App_GKE/App_GKE_Guide.md#group-0-module-metadata--configuration) for a full description.

**Ghost-specific defaults:**

| Variable | Ghost GKE Default | Notes |
|---|---|---|
| `module_description` | `"Ghost: Deploy Ghost publishing platform on GKE Autopilot…"` | Pre-populated with Ghost-specific description. |
| `module_documentation` | `"https://docs.radmodules.dev/docs/applications/ghost"` | Points to the Ghost documentation page. |
| `module_services` | Includes Ghost-relevant services | Adds `Cloud SQL (MySQL 8.0)` and `SMTP Integration` to the standard list. |

---

## Group 1: Project & Identity

Identical to `App GKE`. See [App GKE Group 1](../App_GKE/App_GKE_Guide.md#group-1-project--identity).

---

## Group 2: Application Identity

These variables behave identically to `App GKE`. See [App GKE Group 2](../App_GKE/App_GKE_Guide.md#group-2-application-identity) for descriptions.

**Ghost-specific defaults:**

| Variable | Ghost GKE Default | App GKE Default | Notes |
|---|---|---|---|
| `application_name` | `"ghost"` | `"gkeapp"` | Used as the base name for all GCP and Kubernetes resources. **Do not change after deployment.** |
| `application_display_name` | `"Ghost Blog"` | `"App GKE Application"` | Shown in the platform UI and dashboards. Can be changed freely. |
| `application_description` | `"Ghost Publishing Platform on GKE Autopilot"` | `"App GKE Custom Application…"` | Descriptive label. Can be changed freely. |
| `application_version` | `"6.14.0"` | `"1.0.0"` | The Ghost release version to build and deploy. Incrementing this value triggers a new Cloud Build run. |

---

## Group 3: Runtime & Scaling

Most variables behave identically to `App GKE`. See [App GKE Group 3](../App_GKE/App_GKE_Guide.md#group-3-runtime--scaling).

**Ghost-specific defaults and behaviour:**

| Variable | Ghost GKE Default | App GKE Default | Notes |
|---|---|---|---|
| `container_port` | `2368` | `8080` | Ghost's native HTTP port. Do not change unless your custom Dockerfile binds Ghost to a different port. |
| `max_instance_count` | `5` | `3` | Ghost is more resource-intensive than a generic application; the higher ceiling accommodates traffic spikes during newsletter sends or content publication. |
| `cpu_limit` | `"2000m"` | `"1000m"` | Ghost 6.x requires a minimum of 1 vCPU; 2 vCPU (2000m) is recommended for production to handle concurrent membership and admin requests without degradation. |
| `memory_limit` | `"4Gi"` | `"512Mi"` | Ghost 6.x uses significantly more memory than the base default. 4 Gi is recommended for production; do not set below 512 Mi or Ghost will OOMKill during theme compilation. |
| `container_image_source` | `"custom"` | `"custom"` | `Ghost_Common` supplies a Dockerfile-based build by default so that Ghost can be customised with plugins and themes before deployment. Set to `"prebuilt"` to deploy the official Docker Hub Ghost image directly. |
| `enable_cloudsql_volume` | `true` | `true` | The Cloud SQL Auth Proxy sidecar is required for Ghost to connect to Cloud SQL via a Unix socket. Only disable if connecting to Cloud SQL directly over a private TCP connection. |

The remaining runtime variables (`deploy_application`, `container_image`, `container_build_config`, `enable_image_mirroring`, `min_instance_count`, `enable_vertical_pod_autoscaling`, `container_protocol`, `container_resources`, `timeout_seconds`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels`) behave as described in [App GKE Group 3](../App_GKE/App_GKE_Guide.md#group-3-runtime--scaling).

---

## Group 4: Access & Networking

These variables behave identically to `App GKE`. See [App GKE Group 4: Access & Networking](../App_GKE/App_GKE_Guide.md#group-16-custom-domain-static-ip--network-configuration) and [App GKE Group 5: GKE Backend Configuration](../App_GKE/App_GKE_Guide.md#group-5-gke-backend-configuration).

The following networking variables are available in `Ghost GKE`:

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Enables Identity-Aware Proxy authentication on the load balancer. |
| `iap_authorized_users` | `[]` | Individual users or service accounts granted IAP access. |
| `iap_authorized_groups` | `[]` | Google Groups granted IAP access. |
| `iap_oauth_client_id` | `""` | OAuth client ID for IAP configuration. |
| `iap_oauth_client_secret` | `""` | OAuth client secret for IAP configuration. |
| `iap_support_email` | `""` | Support email shown on the Google OAuth consent screen. |
| `enable_custom_domain` | `false` | Configures Ingress/Gateway for custom domain routing with managed SSL certificates. |
| `application_domains` | `[]` | Custom domain names (e.g. `["ghost.example.com"]`). |
| `reserve_static_ip` | `true` | Reserves a Global Static IP for the load balancer. |
| `static_ip_name` | `""` | Name for the reserved IP; auto-generated if blank. |
| `network_tags` | `["nfsserver"]` | Firewall tags applied to GKE cluster nodes. |
| `enable_cloud_armor` | `false` | Enables a Cloud Armor WAF security policy. |
| `admin_ip_ranges` | `[]` | Admin CIDR ranges permitted through Cloud Armor. |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Name of the Cloud Armor security policy to attach. |
| `enable_vpc_sc` | `false` | Enables VPC Service Controls perimeter enforcement. |
| `ingress_settings` | `"all"` | Controls which traffic sources may reach the application (`all`, `internal`, `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | Controls whether only private-range traffic or all egress is routed through the VPC. |

---

## Group 5: Environment Variables & Secrets

These variables behave identically to `App GKE`. See [App GKE Group 4](../App_GKE/App_GKE_Guide.md#group-4-environment-variables--secrets).

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

Override `environment_variables` with a complete map to replace the SMTP defaults and add any additional Ghost configuration variables. To add variables without overriding the SMTP defaults, merge them in your Terraform configuration:

```hcl
environment_variables = merge(
  {
    SMTP_HOST     = "smtp.mailgun.org"
    SMTP_PORT     = "587"
    SMTP_USER     = "postmaster@mg.example.com"
    SMTP_PASSWORD = "your-smtp-password"
    SMTP_SSL      = "true"
    EMAIL_FROM    = "noreply@example.com"
  },
  {
    NODE_ENV = "production"
  }
)
```

The remaining secrets variables (`secret_environment_variables`, `secret_rotation_period`, `secret_propagation_delay`, `manage_storage_kms_iam`, `enable_secrets_store_csi_driver`) behave as described in [App GKE Group 4](../App_GKE/App_GKE_Guide.md#group-4-environment-variables--secrets).

---

## Group 6: Backup & Maintenance

These variables behave identically to `App GKE`. See [App GKE Group 11](../App_GKE/App_GKE_Guide.md#group-11-backup-schedule--retention).

**Ghost-specific defaults:**

| Variable | Default | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Daily at 02:00 UTC. Adjust to match your Recovery Point Objective and traffic patterns. |
| `backup_retention_days` | `7` | 7-day retention. Increase for production deployments (30–90 days recommended). |

**Backup Import** — Ghost GKE also supports importing an existing backup on first deployment:

| Variable | Default | Description |
|---|---|---|
| `enable_backup_import` | `false` | When `true`, runs a one-time import job during deployment to restore the backup specified by `backup_uri`. Configure `backup_source`, `backup_uri`, and `backup_format` before enabling. |
| `backup_source` | `"gcs"` | Source system for the backup file. `"gcs"` imports from a Cloud Storage URI; `"gdrive"` imports from a Google Drive file ID. |
| `backup_uri` | `""` | Location of the backup file. For GCS: `"gs://my-bucket/backups/ghost.sql"`. For Google Drive: the file ID from the share URL. |
| `backup_format` | `"sql"` | Format of the backup file. Supported values: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## Group 7: CI/CD & GitHub Integration

Identical to `App GKE`. See [App GKE Group 7](../App_GKE/App_GKE_Guide.md#group-7-cicd--github-integration).

The following CI/CD variables are available: `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`.

---

## Group 8: Jobs & Scheduled Tasks

These variables behave as described in [App GKE Group 6](../App_GKE/App_GKE_Guide.md#group-6-jobs--scheduled-tasks), with one important Ghost-specific behaviour.

**Ghost default `db-init` job:**

When `initialization_jobs` is left as the default (empty list `[]`), `Ghost_Common` automatically supplies a `db-init` job:

| Field | Value |
|---|---|
| Job name | `db-init` |
| Image | `mysql:8.0-debian` |
| Purpose | Initialises the Ghost MySQL database schema and user |
| Execute on every apply | `true` |
| CPU / Memory | `1000m` / `512Mi` |

Override `initialization_jobs` with a non-empty list to replace this default with your own jobs. Each custom job must specify at least one of `command`, `args`, or `script_path`.

**CronJobs and Additional Services:**

The `cron_jobs` and `additional_services` variables are available and behave identically to `App GKE`. See [App GKE Group 6](../App_GKE/App_GKE_Guide.md#group-6-jobs--scheduled-tasks) for full documentation.

---

## Group 9: Storage & Filesystem — NFS

These variables behave identically to `App GKE`. See [App GKE Group 8](../App_GKE/App_GKE_Guide.md#group-8-storage--filesystem--nfs).

**Ghost-specific defaults:**

| Variable | Default | Notes |
|---|---|---|
| `enable_nfs` | `true` | NFS storage is enabled by default. Ghost stores uploaded images, themes, and other content files on the shared NFS volume so that all pod replicas access the same filesystem. Disable only if using GCS Fuse exclusively for content storage. |
| `nfs_mount_path` | `"/mnt/nfs"` | The path where the NFS volume is mounted inside the Ghost container. Configure your Ghost Dockerfile to use this path for the `content` directory. |

---

## Group 10: Storage & Filesystem — GCS

These variables behave identically to `App GKE`. See [App GKE Group 9](../App_GKE/App_GKE_Guide.md#group-9-storage--filesystem--gcs).

**Ghost-specific defaults:**

`Ghost_Common` automatically provisions a `ghost-content` GCS bucket in addition to any buckets defined in `storage_buckets`. This bucket is used for Ghost media storage via GCS Fuse. You do not need to define it manually.

| Bucket | `name_suffix` | Purpose |
|---|---|---|
| Auto-provisioned | `ghost-content` | Ghost media storage (images, files, themes) via GCS Fuse CSI Driver |

The `create_cloud_storage`, `storage_buckets`, and `gcs_volumes` variables behave as described in [App GKE Group 9](../App_GKE/App_GKE_Guide.md#group-9-storage--filesystem--gcs).

---

## Group 11: Database Configuration

These variables behave identically to `App GKE`. See [App GKE Group 10](../App_GKE/App_GKE_Guide.md#group-10-database-configuration).

**Ghost-specific defaults and restrictions:**

| Variable | Ghost GKE Default | App GKE Default | Notes |
|---|---|---|---|
| `database_type` | `"MYSQL_8_0"` | `"POSTGRES"` | **Ghost 6.x requires MySQL 8.0.** Do not change this to a PostgreSQL or SQL Server variant — Ghost will not start. |
| `application_database_name` | `"gkeappdb"` | `"gkeappdb"` | Override to `"ghost"` or a meaningful name such as `"ghost_prod"`. |
| `application_database_user` | `"gkeappuser"` | `"gkeappuser"` | Override to `"ghost"` or a meaningful name such as `"ghost_svc"`. |
| `db_name` | `"ghost"` | *(not in App GKE)* | Shorthand variable for the database name injected into Ghost_Common. Takes precedence over `application_database_name` for Ghost configuration. |
| `db_user` | `"ghost"` | *(not in App GKE)* | Shorthand variable for the database user injected into Ghost_Common. |

> **Important:** Ghost 6.x will silently use SQLite instead of MySQL if the `database__client` variable is not set. This module injects `database__client = "mysql"` automatically. Do not remove or override it.

**Automatic password rotation** is also supported:

| Variable | Default | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Deploys an automated database password rotation job. When `true`, the database password is rotated on the schedule defined by `secret_rotation_period` and the Cloud Run service is restarted to pick up the new credential. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before restarting pods, to allow Secret Manager replication to complete. |

---

## Group 12: Custom SQL Scripts

Identical to `App GKE`. See [App GKE Group 12](../App_GKE/App_GKE_Guide.md#group-12-custom-sql-scripts).

---

## Group 13: Observability & Health

These variables behave identically to `App GKE`. See [App GKE Group 13](../App_GKE/App_GKE_Guide.md#group-13-observability--health).

**Ghost-specific defaults:**

Ghost 6.x performs database migrations and theme compilation during startup, which means the first boot after a fresh deployment takes significantly longer than subsequent boots. The health probe defaults are tuned to accommodate this:

**Startup probe** (`startup_probe`):

| Field | Ghost Default | App GKE Default | Notes |
|---|---|---|---|
| `path` | `"/"` | `"/healthz"` | Ghost does not expose a dedicated `/healthz` endpoint; the root path is used instead. |
| `initial_delay_seconds` | `90` | `10` | Allows Ghost 90 seconds before the first probe attempt, giving it time to run migrations. |
| `failure_threshold` | `10` | `3` | Ghost may take up to 100 seconds on first boot; `10 × period_seconds (10s) = 100s` total allowance. |

**Liveness probe** (`liveness_probe`):

| Field | Ghost Default | App GKE Default | Notes |
|---|---|---|---|
| `path` | `"/"` | `"/healthz"` | Same as startup probe — Ghost's root path returns HTTP 200 when healthy. |
| `initial_delay_seconds` | `60` | `15` | Gives Ghost additional time to stabilise before liveness checks begin. |

The `uptime_check_config` and `alert_policies` variables behave as described in [App GKE Group 13](../App_GKE/App_GKE_Guide.md#group-13-observability--health).

---

## Group 14: Reliability Policies

Identical to `App GKE`. See [App GKE Group 14](../App_GKE/App_GKE_Guide.md#group-14-reliability-policies).

Available variables: `enable_pod_disruption_budget`, `pdb_min_available`, `enable_topology_spread`, `topology_spread_strict`.

---

## Group 15: Resource Quota

Identical to `App GKE`. See [App GKE Group 15](../App_GKE/App_GKE_Guide.md#group-15-resource-quota).

Available variables: `enable_resource_quota`, `quota_cpu_requests`, `quota_cpu_limits`, `quota_memory_requests`, `quota_memory_limits`.

---

## Group 16: Custom Domain & Static IP

Identical to `App GKE`. See [App GKE Group 16](../App_GKE/App_GKE_Guide.md#group-16-custom-domain-static-ip--network-configuration).

> **Ghost URL configuration:** Ghost must know its public URL at startup. When using a custom domain, configure the `url` Ghost setting (typically via an environment variable or the Ghost `config.json`) to match the domain in `application_domains`. Ghost uses this URL to generate links in newsletters and member emails — incorrect URL configuration will result in broken links.

---

## Group 17: GKE Backend Configuration

Identical to `App GKE`. See [App GKE Group 5](../App_GKE/App_GKE_Guide.md#group-5-gke-backend-configuration).

Available variables: `gke_cluster_name`, `namespace_name`, `workload_type`, `service_type`, `session_affinity`, `enable_multi_cluster_service`, `configure_service_mesh`, `enable_network_segmentation`, `termination_grace_period_seconds`, `deployment_timeout`.

> **Session affinity note:** `session_affinity` defaults to `"ClientIP"` in Ghost GKE. This is important for Ghost: without session affinity, the Ghost admin panel and membership portal can experience intermittent authentication failures when requests are routed to different pod replicas that do not share session state.

---

## Group 18: Stateful Workloads

Identical to `App GKE`. See the StatefulSet configuration described in [App GKE Group 3](../App_GKE/App_GKE_Guide.md#group-3-runtime--scaling) (`workload_type = "StatefulSet"`) and the associated StatefulSet variables.

Available variables: `stateful_pvc_enabled`, `stateful_pvc_size`, `stateful_pvc_mount_path`, `stateful_pvc_storage_class`, `stateful_headless_service`, `stateful_pod_management_policy`, `stateful_update_strategy`.

---

## Group 20: Redis Cache

These variables are specific to Ghost and do not exist in the base `App GKE` module. Ghost uses Redis for page caching and session caching, which significantly reduces database load and improves page delivery speed for high-traffic sites.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `true` | `true` / `false` | Enables Redis as Ghost's caching backend. When `true` and `redis_host` is blank, the module defaults to using the NFS server IP as the Redis host. **Recommended for all production deployments.** Disable only in development or testing environments where the additional infrastructure is not required. When disabled, Ghost serves all pages without a cache, which increases database query load and raises page load times under concurrent traffic. |
| `redis_host` | `""` *(defaults to NFS server IP)* | Hostname or IP address | The hostname or IP address of the Redis server Ghost connects to for caching. Leave blank to use the automatically discovered NFS server IP (which typically co-hosts a Redis process in the platform's default configuration). Override with an explicit IP or hostname when using a dedicated Redis instance — such as a Google Cloud Memorystore for Redis instance — for higher reliability and throughput. Example: `"10.128.0.10"`, `"redis.example.internal"`. |
| `redis_port` | `"6379"` | Port number string | The TCP port on which the Redis server is listening. The default `6379` is the standard Redis port. Change only if your Redis instance is configured to listen on a non-standard port. |
| `redis_auth` | `""` | String *(sensitive)* | The authentication password for the Redis server. Leave empty if the Redis instance does not require authentication (typical for the platform's default NFS co-hosted Redis). For production deployments using Google Cloud Memorystore with AUTH enabled, set this to the instance's AUTH string. This value is treated as sensitive and is never stored in Terraform state in plaintext. |

### Validating Group 20 Settings

**Google Cloud Console:**
- **Memorystore instance (if used):** Navigate to **Memorystore → Redis** to confirm the instance exists, its IP address, port, and AUTH status.
- **Ghost cache status:** Once deployed, navigate to the Ghost Admin panel (**Settings → Labs**) or check the Ghost container logs for cache connection confirmation messages.

**gcloud CLI / kubectl:**
```bash
# List Memorystore Redis instances in the project (if using Memorystore)
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,memorySizeGb,authEnabled)"

# Confirm the Redis environment variables are set in the Ghost pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep -i redis

# Test Redis connectivity from inside the Ghost pod
kubectl exec -n NAMESPACE POD_NAME -- \
  nc -zv REDIS_HOST 6379
```
