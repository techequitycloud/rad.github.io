# Ghost_GKE Module — Configuration Guide

This guide describes every configuration variable available in the `Ghost_GKE` module. `Ghost_GKE` is a **wrapper module** that combines the generic [`App_GKE`](../App_GKE/App_GKE.md) infrastructure module with the [`Ghost_Common`](../Ghost_Common/) shared application configuration to deploy the [Ghost](https://ghost.org/) publishing platform on Google Kubernetes Engine (GKE) Autopilot.

Most configuration options in `Ghost_GKE` map directly to the same options in `App_GKE`. Where a variable is identical in behaviour, this guide references the `App_GKE` guide rather than repeating the same documentation. Only the variables and defaults that are **specific to Ghost** are described in full here.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## Standard Configuration Reference

The following configuration areas are provided by the underlying `App_GKE` module. Consult the linked sections of the [App_GKE Configuration Guide](../App_GKE/App_GKE.md) for full documentation.

| Configuration Area | App_GKE.md Section | Ghost-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | §1 Module Overview | Ghost-specific `module_description`, `module_documentation`, and `module_services` defaults are pre-set. |
| Project & Identity | §2 IAM & Access Control | Identical. |
| Application Identity | §3.A Compute (GKE Autopilot) | Ghost-specific defaults; see [Group 2: Application Identity](#group-2-application-identity). |
| Runtime & Scaling | §3.A Compute (GKE Autopilot) | Ghost-specific defaults for `container_port`, `cpu_limit`, `memory_limit`, and `min_instance_count`; see [Group 3: Runtime & Scaling](#group-3-runtime--scaling). |
| Environment Variables & Secrets | §3 Core Service Configuration | `database__client = "mysql"` is injected automatically. SMTP defaults pre-populated; see [Group 5: Environment Variables & Secrets](#group-5-environment-variables--secrets). |
| Networking & Network Policies | §3.D Networking & Network Policies | Identical. |
| Initialization Jobs & CronJobs | §3.E Initialization Jobs & CronJobs | `db-init` MySQL job supplied automatically by `Ghost_Common`; see [Group 8: Jobs & Scheduled Tasks](#group-8-jobs--scheduled-tasks). |
| Additional Services | §3.F Additional Services | Identical. |
| Storage — NFS | §3.C Storage (NFS / GCS / GCS Fuse) | `enable_nfs` defaults to `true`; see [Group 9: Storage & Filesystem — NFS](#group-9-storage--filesystem--nfs). |
| Storage — GCS | §3.C Storage (NFS / GCS / GCS Fuse) | `ghost-content` GCS bucket provisioned automatically; see [Group 10: Storage & Filesystem — GCS](#group-10-storage--filesystem--gcs). |
| Database Configuration | §3.B Database (Cloud SQL) | **MySQL 8.0 required**; see [Group 11: Database Configuration](#group-11-database-configuration). |
| Backup Schedule & Retention | §3.B Database (Cloud SQL) | Identical. |
| Custom SQL Scripts | §3.E Initialization Jobs & CronJobs | Identical. |
| Observability & Health Checks | §3.A Compute (GKE Autopilot) | Two-path probe system; see [Group 13: Observability & Health](#group-13-observability--health). |
| Cloud Armor WAF | §4.A Cloud Armor WAF | Identical. |
| Identity-Aware Proxy | §4.B Identity-Aware Proxy (IAP) | Identical. |
| Binary Authorization | §4.C Binary Authorization | Identical. |
| VPC Service Controls | §4.D VPC Service Controls | Identical. |
| Secrets Store CSI Driver | §4.E Secrets Store CSI Driver | Always enabled — no configuration required. |
| Traffic & Ingress | §5 Traffic & Ingress | Identical. |
| CDN | §5.B CDN | Identical. |
| Custom Domain & Static IP | §5.C Static IP Reservation | Ghost URL must be configured to match; see [Group 16: Custom Domain & Static IP](#group-16-custom-domain--static-ip). |
| Cloud Build Triggers | §6.A Cloud Build Triggers | Identical. |
| Cloud Deploy Pipeline | §6.B Cloud Deploy Pipeline | Identical. |
| Image Mirroring | §6.C Image Mirroring | Identical. |
| Pod Disruption Budgets | §7.A Pod Disruption Budgets | Identical. |
| Topology Spread Constraints | §7.B Topology Spread Constraints | Identical. |
| Resource Quotas | §7.C Resource Quotas | Identical. |
| Auto Password Rotation | §7.D Auto Password Rotation | See [Group 11: Database Configuration](#group-11-database-configuration). |
| Redis Cache | §8.A Redis / Memorystore | `enable_redis` defaults to `true`; see [Group 14: Redis Cache](#group-14-redis-cache). |
| Backup Import | §8.B Backup Import | Exposes both `backup_uri` (full GCS URI or Drive ID) and `backup_file` (filename in module backup bucket); see [Group 6: Backup & Maintenance](#group-6-backup--maintenance). |
| Service Mesh (ASM) | §8.C Service Mesh (ASM via Fleet) | Identical. |
| Multi-Cluster Services | §8.D Multi-Cluster Services (MCS) | Identical. |

---

## How Ghost_GKE Relates to App_GKE

`Ghost_GKE` passes all variables through to `App_GKE` and adds a `Ghost_Common` sub-module that supplies Ghost-specific defaults and application configuration. The main effects are:

1. **MySQL 8.0 is required.** Ghost 6.x requires MySQL 8.0 and will not work with PostgreSQL. The `database_type` default is overridden to `"MYSQL_8_0"`.
2. **`database__client = "mysql"` is injected automatically.** Ghost 6.x will silently fall back to SQLite without this environment variable, even when all other database connection variables are present. The module injects it automatically — you do not need to set it yourself.
3. **A `ghost-content` GCS bucket is provisioned automatically.** `Ghost_Common` provides a `ghost-content` bucket definition that is merged into the module's bucket list. You do not need to define it in `storage_buckets`.
4. **A `db-init` job runs on first deployment.** `Ghost_Common` supplies a default `db-init` Kubernetes Job using a `mysql:8.0-debian` image that initialises the Ghost MySQL schema. Override `initialization_jobs` to replace it with a custom job.
5. **Resource defaults are sized for Ghost.** The default `cpu_limit` (2 vCPU) and `memory_limit` (4 Gi) are higher than the `App_GKE` defaults to match Ghost 6.x's resource requirements.
6. **Redis caching is enabled by default.** Ghost uses Redis for page caching. See [Group 14: Redis Cache](#group-14-redis-cache) and [App_GKE §8.A](../App_GKE/App_GKE.md#a-redis--memorystore) for details.
7. **Health probes are tuned for Ghost's slow startup.** Ghost runs database migrations and compiles themes on first boot. The default startup probe allows 90 seconds of initial delay before checking.

---

## Group 0: Module Metadata & Configuration

The behaviour of these variables is identical to `App_GKE`. See [App_GKE §1](../App_GKE/App_GKE.md#1-module-overview) for a full description.

**Ghost-specific defaults:**

| Variable | Ghost_GKE Default | Notes |
|---|---|---|
| `module_description` | `"Ghost: Deploy Ghost publishing platform on GKE Autopilot…"` | Pre-populated with Ghost-specific description. |
| `module_documentation` | `"https://docs.radmodules.dev/docs/applications/ghost"` | Points to the Ghost documentation page. |
| `module_services` | Includes Ghost-relevant services | Adds `Cloud SQL (MySQL 8.0)` and `SMTP Integration` to the standard list. |

---

## Group 1: Project & Identity

Identical to `App_GKE`. See [App_GKE §2](../App_GKE/App_GKE.md#2-iam--access-control).

**Ghost_GKE-specific addition in this group:**

| Variable | Default | Description |
|---|---|---|
| `deployment_region` | `"us-central1"` | GCP region for resource deployment. Used as a fallback when network discovery cannot determine the region from existing VPC subnets. Also used as the storage bucket location for the `ghost-content` bucket provisioned by `Ghost_Common`. |

---

## Group 2: Application Identity

These variables behave identically to `App_GKE`. See [App_GKE §3.A](../App_GKE/App_GKE.md#a-compute-gke-autopilot) for descriptions.

**Ghost-specific defaults:**

| Variable | Ghost_GKE Default | App_GKE Default | Notes |
|---|---|---|---|
| `application_name` | `"ghost"` | `"gkeapp"` | Used as the base name for all GCP and Kubernetes resources. **Do not change after deployment.** |
| `application_display_name` | `"Ghost Blog"` | `"App_GKE Application"` | Shown in the platform UI and dashboards. Can be changed freely. |
| `display_name` | `"Ghost Publishing Platform"` | *(not in App_GKE)* | Ghost_GKE-specific alias for a human-readable UI name. Passed through to `Ghost_Common`. |
| `application_description` | `"Ghost Publishing Platform on GKE Autopilot"` | `"App_GKE Custom Application…"` | Descriptive label. Can be changed freely. |
| `description` | `"Ghost Publishing Platform on GKE Autopilot"` | *(not in App_GKE)* | Ghost_GKE-specific alias for the deployment description. Passed to `Ghost_Common` as the `db-init` job description. |
| `application_version` | `"6.14.0"` | `"1.0.0"` | The Ghost release version to build and deploy. Incrementing this value triggers a new Cloud Build run. |

---

## Group 3: Runtime & Scaling

Most variables behave identically to `App_GKE`. See [App_GKE Group 3](../App_GKE/App_GKE.md#a-compute-gke-autopilot).

**Ghost-specific defaults and behaviour:**

| Variable | Ghost_GKE Default | App_GKE Default | Notes |
|---|---|---|---|
| `container_port` | `2368` | `8080` | Ghost's native HTTP port. Do not change unless your custom Dockerfile binds Ghost to a different port. |
| `max_instance_count` | `5` **[fixed in main.tf]** | `3` | Ghost is more resource-intensive than a generic application; the higher ceiling accommodates traffic spikes during newsletter sends or content publication. The variable default is `5`, and `main.tf` also hardcodes `max_instance_count = 5` in the locals merge — changing the variable has no effect without editing `main.tf` directly. |
| `cpu_limit` | `"2000m"` | `"1000m"` | Ghost 6.x requires a minimum of 1 vCPU; 2 vCPU (2000m) is recommended for production to handle concurrent membership and admin requests without degradation. |
| `memory_limit` | `"4Gi"` | `"512Mi"` | Ghost 6.x uses significantly more memory than the base default. 4 Gi is recommended for production; do not set below 512 Mi or Ghost will OOMKill during theme compilation. |
| `container_image_source` | `"custom"` | `"custom"` | `Ghost_Common` supplies a Dockerfile-based build by default so that Ghost can be customised with plugins and themes before deployment. Set to `"prebuilt"` to deploy the official Docker Hub Ghost image directly. |
| `enable_cloudsql_volume` | `true` | `true` | The Cloud SQL Auth Proxy sidecar is required for Ghost to connect to Cloud SQL via a Unix socket. Only disable if connecting to Cloud SQL directly over a private TCP connection. |

**`min_instance_count`:** The variable default is `1` (always at least one pod running — no scale-to-zero on GKE). Like `max_instance_count`, the value `1` is also hardcoded in the `main.tf` locals merge, so changing the variable via `tfvars` has no effect without editing `main.tf` directly.

**`container_resources`:** The variable default is `{ cpu_limit = "1000m", memory_limit = "512Mi" }` (the App_GKE base default). However, Ghost_Common produces a `config` with `cpu_limit = var.cpu_limit` (default `"2000m"`) and `memory_limit = var.memory_limit` (default `"4Gi"`), which are merged into `container_resources` in the `main.tf` locals block. This means the effective container resources for Ghost are 2 vCPU / 4 Gi by default, regardless of the `container_resources` variable default. To override both the `cpu_limit` / `memory_limit` shorthand variables and the `container_resources` object for consistency, set `cpu_limit`, `memory_limit`, and `container_resources` together.

The remaining runtime variables (`deploy_application`, `container_image`, `container_build_config`, `enable_image_mirroring`, `enable_vertical_pod_autoscaling`, `container_protocol`, `container_resources`, `timeout_seconds`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels`) behave as described in [App_GKE Group 3](../App_GKE/App_GKE.md#a-compute-gke-autopilot).

---

## Group 4: Access & Networking

These variables behave identically to `App_GKE`. See [App_GKE §4](../App_GKE/App_GKE.md#4-advanced-security), [App_GKE §5](../App_GKE/App_GKE.md#5-traffic--ingress), and [App_GKE §3.D](../App_GKE/App_GKE.md#d-networking--network-policies).

> **Note:** The `ingress_settings` and `vpc_egress_setting` variables appear in `Ghost_GKE`'s variable definitions but are **not passed through to `App_GKE`**. Setting these variables has no effect on the deployed infrastructure in the current implementation.

The following networking variables are available in `Ghost_GKE`:

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

These variables behave identically to `App_GKE`. See [App_GKE §3](../App_GKE/App_GKE.md#3-core-service-configuration).

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

The remaining secrets variables (`secret_environment_variables`, `secret_rotation_period`, `secret_propagation_delay`, `manage_storage_kms_iam`) behave as described in [App_GKE §3](../App_GKE/App_GKE.md#3-core-service-configuration).

---

## Group 6: Backup & Maintenance

These variables behave identically to `App_GKE`. See [App_GKE §3.B](../App_GKE/App_GKE.md#b-database-cloud-sql).

**Ghost-specific defaults:**

| Variable | Default | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Daily at 02:00 UTC. Adjust to match your Recovery Point Objective and traffic patterns. |
| `backup_retention_days` | `7` | 7-day retention. Increase for production deployments (30–90 days recommended). |

**Backup Import** — Ghost_GKE also supports importing an existing backup on first deployment:

| Variable | Default | Description |
|---|---|---|
| `enable_backup_import` | `false` | When `true`, runs a one-time import job during deployment to restore the backup specified by `backup_uri`. Configure `backup_source`, `backup_uri`, and `backup_format` before enabling. |
| `backup_source` | `"gcs"` | Source system for the backup file. `"gcs"` imports from a Cloud Storage URI; `"gdrive"` imports from a Google Drive file ID. |
| `backup_uri` | `""` | Full GCS URI (`"gs://my-bucket/backups/ghost.sql"`) or Google Drive file ID. Mapped to `backup_file` in `App_GKE`. |
| `backup_file` | `"backup.sql"` | Filename of a backup stored in the module's automatically created backups GCS bucket. An alternative to `backup_uri` for backups already placed in the module-managed bucket. |
| `backup_format` | `"sql"` | Format of the backup file. Supported values: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## Group 7: CI/CD & GitHub Integration

Identical to `App_GKE`. See [App_GKE §6](../App_GKE/App_GKE.md#6-cicd--delivery).

The following CI/CD variables are available: `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`, `binauthz_evaluation_mode` (default `"ALWAYS_ALLOW"`; options: `ALWAYS_ALLOW`, `REQUIRE_ATTESTATION`, `ALWAYS_DENY` — controls enforcement mode when `enable_binary_authorization` is true).

---

## Group 8: Jobs & Scheduled Tasks

These variables behave as described in [App_GKE §3.E](../App_GKE/App_GKE.md#e-initialization-jobs--cronjobs), with one important Ghost-specific behaviour.

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

The `cron_jobs` and `additional_services` variables are available and behave identically to `App_GKE`. See [App_GKE §3.E](../App_GKE/App_GKE.md#e-initialization-jobs--cronjobs) for full documentation.

> **Note:** The `cron_jobs` schema in `Ghost_GKE` uses Kubernetes CronJob fields — `restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds`, `suspend` — rather than the Cloud Run–style fields (`parallelism`, `paused`, `max_retries`, `task_count`) used in `Ghost_CloudRun`. The `secret_env_vars` field is also not available in GKE cron jobs (secrets are managed via `secret_environment_variables` at the module level).

---

## Group 9: Storage & Filesystem — NFS

These variables behave identically to `App_GKE`. See [App_GKE §3.C](../App_GKE/App_GKE.md#c-storage-nfs--gcs--gcs-fuse).

**Ghost-specific defaults:**

| Variable | Default | Notes |
|---|---|---|
| `enable_nfs` | `true` | NFS storage is enabled by default. Ghost stores uploaded images, themes, and other content files on the shared NFS volume so that all pod replicas access the same filesystem. Disable only if using GCS Fuse exclusively for content storage. |
| `nfs_mount_path` | `"/mnt/nfs"` | The path where the NFS volume is mounted inside the Ghost container. Configure your Ghost Dockerfile to use this path for the `content` directory. |

---

## Group 10: Storage & Filesystem — GCS

These variables behave identically to `App_GKE`. See [App_GKE Group 9](../App_GKE/App_GKE.md#c-storage-nfs--gcs--gcs-fuse).

**Ghost-specific defaults:**

`Ghost_Common` automatically provisions a `ghost-content` GCS bucket in addition to any buckets defined in `storage_buckets`. This bucket is used for Ghost media storage via GCS Fuse. You do not need to define it manually.

| Bucket | `name_suffix` | Purpose |
|---|---|---|
| Auto-provisioned | `ghost-content` | Ghost media storage (images, files, themes) via GCS Fuse CSI Driver |

The `create_cloud_storage`, `storage_buckets`, and `gcs_volumes` variables behave as described in [App_GKE Group 9](../App_GKE/App_GKE.md#c-storage-nfs--gcs--gcs-fuse).

---

## Group 11: Database Configuration

These variables behave identically to `App_GKE`. See [App_GKE §3.B](../App_GKE/App_GKE.md#b-database-cloud-sql).

**Ghost-specific defaults and restrictions:**

| Variable | Ghost_GKE Default | App_GKE Default | Notes |
|---|---|---|---|
| `database_type` | `"MYSQL_8_0"` | `"POSTGRES"` | **Ghost 6.x requires MySQL 8.0.** Do not change this to a PostgreSQL or SQL Server variant — Ghost will not start. |
| `application_database_name` | `"gkeappdb"` | `"gkeappdb"` | Override to `"ghost"` or a meaningful name such as `"ghost_prod"`. |
| `application_database_user` | `"gkeappuser"` | `"gkeappuser"` | Override to `"ghost"` or a meaningful name such as `"ghost_svc"`. |
| `db_name` | `"ghost"` | *(not in App_GKE)* | Shorthand variable for the database name passed to Ghost_Common. Controls the `db_name` field in the `application_config` used by Ghost (distinct from `application_database_name`, which controls what App_GKE provisions in Cloud SQL). |
| `db_user` | `"ghost"` | *(not in App_GKE)* | Shorthand variable for the database user passed to Ghost_Common. Controls the `db_user` field in the Ghost `application_config` (distinct from `application_database_user`). |

> **Important:** Ghost 6.x will silently use SQLite instead of MySQL if the `database__client` variable is not set. This module injects `database__client = "mysql"` automatically. Do not remove or override it.

> **Note:** Unlike `Ghost_CloudRun` (where `database_type` is fixed inside `Ghost_Common` and not user-configurable), `Ghost_GKE` exposes `database_type` as a user-configurable variable with a default of `"MYSQL_8_0"`. The variable can technically be changed, but doing so will break Ghost — the application only supports MySQL 8.0.

**Cloud SQL instance discovery:**

| Variable | Default | Description |
|---|---|---|
| `sql_instance_name` | `""` | Name of an existing Cloud SQL instance to use. Leave empty to auto-discover a Services_GCP-managed instance or create an inline instance. |
| `sql_instance_base_name` | `"app-sql"` | Base name for the inline Cloud SQL instance when no existing instance is found. Deployment ID is appended. |

**Automatic password rotation** is also supported:

| Variable | Default | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Deploys an automated database password rotation job. When `true`, the database password is rotated on the schedule defined by `secret_rotation_period` and GKE pods are restarted to pick up the new credential. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before restarting pods, to allow Secret Manager replication to complete. |

---

## Group 12: Custom SQL Scripts

Identical to `App_GKE`. See [App_GKE §3.E](../App_GKE/App_GKE.md#e-initialization-jobs--cronjobs).

---

## Group 13: Observability & Health

These variables behave identically to `App_GKE`. See [App_GKE §3.A](../App_GKE/App_GKE.md#a-compute-gke-autopilot).

**Ghost-specific defaults:**

Ghost 6.x performs database migrations and theme compilation during startup, which means the first boot after a fresh deployment takes significantly longer than subsequent boots. The health probe defaults are tuned to accommodate this.

### Health probe routing

`Ghost_GKE` exposes **two parallel sets** of probe variables that configure Kubernetes probes via different routing paths:

| Variable set | Passed to | Configures |
|---|---|---|
| `startup_probe`, `liveness_probe` | `Ghost_Common` sub-module | The application container's Kubernetes probe spec (`initialDelaySeconds`, `path`, `failureThreshold`, etc.) |
| `startup_probe_config`, `health_check_config` | `App_GKE` directly | The App_GKE-standard probe configuration used for load balancer health checks and GKE infrastructure probes |

These are parallel paths, not aliases. Changing `startup_probe` does not affect `startup_probe_config`, and vice versa.

> **Important:** `startup_probe_config` and `health_check_config` both default to `path = "/healthz"`. Ghost does not expose a `/healthz` endpoint — its root path (`/`) returns HTTP 200 when healthy. If you rely on the App_GKE-standard probes, override both variables to use `path = "/"` to match Ghost's actual health endpoint.

**Startup probe** (`startup_probe` → `Ghost_Common`):

| Field | Ghost Default | App_GKE Default | Notes |
|---|---|---|---|
| `path` | `"/"` | `"/healthz"` | Ghost does not expose a dedicated `/healthz` endpoint; the root path is used instead. |
| `initial_delay_seconds` | `90` | `10` | Allows Ghost 90 seconds before the first probe attempt, giving it time to run migrations. |
| `failure_threshold` | `10` | `3` | Ghost may take up to 100 seconds on first boot; `10 × period_seconds (10s) = 100s` total allowance. |

**Liveness probe** (`liveness_probe` → `Ghost_Common`):

| Field | Ghost Default | App_GKE Default | Notes |
|---|---|---|---|
| `path` | `"/"` | `"/healthz"` | Same as startup probe — Ghost's root path returns HTTP 200 when healthy. |
| `initial_delay_seconds` | `60` | `15` | Gives Ghost additional time to stabilise before liveness checks begin. |

**App_GKE-standard probes** (`startup_probe_config`, `health_check_config` → `App_GKE`):

| Variable | Ghost Default | Notes |
|---|---|---|
| `startup_probe_config` | `{ enabled = true, path = "/healthz" }` | **Override `path` to `"/"` for Ghost.** Ghost's root path is the correct health endpoint. |
| `health_check_config` | `{ enabled = true, path = "/healthz" }` | **Override `path` to `"/"` for Ghost.** Same reason as above. |

**`uptime_check_config`:** In `Ghost_GKE` the default is `{ enabled = false, path = "/" }` — uptime checks are **disabled by default** (unlike `Ghost_CloudRun` where they are enabled). Enable explicitly for production monitoring.

The `uptime_check_config` and `alert_policies` variables behave as described in [App_GKE §3.A](../App_GKE/App_GKE.md#a-compute-gke-autopilot).

---

## Group 14: Reliability Policies

Identical to `App_GKE`. See [App_GKE §7](../App_GKE/App_GKE.md#7-reliability--scheduling).

Available variables: `enable_pod_disruption_budget`, `pdb_min_available`, `enable_topology_spread`, `topology_spread_strict`.

---

## Group 15: Resource Quota

Identical to `App_GKE`. See [App_GKE §7.C](../App_GKE/App_GKE.md#c-resource-quotas).

Available variables: `enable_resource_quota`, `quota_cpu_requests`, `quota_cpu_limits`, `quota_memory_requests`, `quota_memory_limits`, `quota_max_pods` (default `""`; max pods in namespace), `quota_max_services` (default `""`; max services in namespace), `quota_max_pvcs` (default `""`; max PVCs in namespace).

---

## Group 16: Custom Domain & Static IP

Identical to `App_GKE`. See [App_GKE §5](../App_GKE/App_GKE.md#5-traffic--ingress).

> **Ghost URL configuration:** Ghost must know its public URL at startup. When using a custom domain, configure the `url` Ghost setting (typically via an environment variable or the Ghost `config.json`) to match the domain in `application_domains`. Ghost uses this URL to generate links in newsletters and member emails — incorrect URL configuration will result in broken links.

---

## Group 17: GKE Backend Configuration

Identical to `App_GKE`. See [App_GKE §3.A](../App_GKE/App_GKE.md#a-compute-gke-autopilot).

Available variables: `gke_cluster_name`, `namespace_name`, `workload_type`, `service_type`, `session_affinity`, `enable_multi_cluster_service`, `configure_service_mesh`, `enable_network_segmentation`, `termination_grace_period_seconds`, `deployment_timeout`, `gke_cluster_selection_mode` (default `"primary"`; options: `explicit`, `round-robin`, `primary`), `network_name` (default `""`; auto-discovered when empty), `prereq_gke_subnet_cidr` (default `"10.201.0.0/24"`; CIDR for inline GKE subnet creation).

> **Session affinity note:** `session_affinity` defaults to `"ClientIP"` in Ghost_GKE. This is important for Ghost: without session affinity, the Ghost admin panel and membership portal can experience intermittent authentication failures when requests are routed to different pod replicas that do not share session state.

---

## Group 18: Stateful Workloads

Identical to `App_GKE`. See the StatefulSet configuration described in [App_GKE §3.A](../App_GKE/App_GKE.md#a-compute-gke-autopilot) (`workload_type = "StatefulSet"`) and the associated StatefulSet variables.

Available variables: `stateful_pvc_enabled`, `stateful_pvc_size`, `stateful_pvc_mount_path`, `stateful_pvc_storage_class`, `stateful_headless_service`, `stateful_pod_management_policy`, `stateful_update_strategy`.

---

## Group 14: Redis Cache

These variables configure Ghost's Redis integration. The underlying Redis infrastructure support is provided by `App_GKE` (see [App_GKE §8.A](../App_GKE/App_GKE.md#a-redis--memorystore)); the variables below are Ghost-specific overrides and additions. Ghost uses Redis for page caching and session caching, which significantly reduces database load and improves page delivery speed for high-traffic sites.

> **Note:** In `Ghost_GKE`, the Redis variables are in **group 14** (not group 20 as in `Ghost_CloudRun`).

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `true` | `true` / `false` | Enables Redis as Ghost's caching backend. When `true` and `redis_host` is blank, the module defaults to using the NFS server IP as the Redis host. **Recommended for all production deployments.** Disable only in development or testing environments where the additional infrastructure is not required. When disabled, Ghost serves all pages without a cache, which increases database query load and raises page load times under concurrent traffic. |
| `redis_host` | `""` *(defaults to NFS server IP)* | Hostname or IP address | The hostname or IP address of the Redis server Ghost connects to for caching. Leave blank to use the automatically discovered NFS server IP (which typically co-hosts a Redis process in the platform's default configuration). Override with an explicit IP or hostname when using a dedicated Redis instance — such as a Google Cloud Memorystore for Redis instance — for higher reliability and throughput. Example: `"10.128.0.10"`, `"redis.example.internal"`. |
| `redis_port` | `"6379"` | Port number string | The TCP port on which the Redis server is listening. The default `6379` is the standard Redis port. Change only if your Redis instance is configured to listen on a non-standard port. |
| `redis_auth` | `""` | String *(sensitive)* | The authentication password for the Redis server. Leave empty if the Redis instance does not require authentication (typical for the platform's default NFS co-hosted Redis). For production deployments using Google Cloud Memorystore with AUTH enabled, set this to the instance's AUTH string. This value is treated as sensitive and is never stored in Terraform state in plaintext. |

### Validating Group 14 Settings

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

---

## Module Outputs

`Ghost_GKE` exposes the following Terraform outputs:

| Output | Description |
|---|---|
| `service_name` | Name of the Kubernetes service |
| `service_url` | Service URL |
| `service_external_ip` | External IP address of the load balancer |
| `project_id` | GCP project ID |
| `deployment_id` | Deployment ID suffix |
| `namespace` | Kubernetes namespace |
| `database_instance_name` | Name of the Cloud SQL instance |
| `database_name` | Name of the application database |
| `database_user` | Name of the application database user |
| `database_password_secret` | Secret Manager secret name for the database password |
| `storage_buckets` | Created GCS storage buckets |
| `nfs_server_ip` | NFS server internal IP *(sensitive)* |
| `nfs_mount_path` | NFS mount path inside containers |
| `container_image` | Container image used for the deployment |
| `cicd_enabled` | Whether the CI/CD pipeline is enabled |
| `github_repository_url` | GitHub repository URL connected for CI/CD |
| `kubernetes_ready` | `true` when the GKE cluster endpoint is reachable and all Kubernetes workload resources are deployed. `false` on the first apply of a new inline cluster — the cluster is created but the endpoint is not yet readable, so Kubernetes resources are skipped. The CI/CD pipeline must re-run apply to complete the deployment. |
