# Wordpress_CloudRun Module — Configuration Guide

`Wordpress_CloudRun` is a pre-configured wrapper around the [`App_CloudRun`](../App_CloudRun/App_CloudRun.md) module that deploys [WordPress](https://wordpress.org/) on Google Cloud Run Gen2.

Every variable in this module is passed through to `App_CloudRun`. The wrapper's role is to supply WordPress-appropriate defaults and to call the `Wordpress_Common` sub-module, which generates the application's container build context, PHP configuration, MySQL connection settings, Redis object cache configuration, and WordPress-specific secrets. You configure this module exactly as you would `App_CloudRun`; the sections below highlight only the variables whose defaults or behaviour differ meaningfully from `App_CloudRun`, or that are unique to this wrapper.

> **Where to look:** If a variable you are configuring is not described here, consult the [App_CloudRun Configuration Guide](../App_CloudRun/App_CloudRun.md). All `App_CloudRun` features — access and networking, IAP, Cloud Armor, CDN, CI/CD, Cloud Deploy, Binary Authorization, traffic splitting, and VPC Service Controls — are available in `Wordpress_CloudRun` with identical behaviour and configuration.

---

## §1 Module Overview

| Property | Value |
|---|---|
| Sub-module | `Wordpress_Common` |
| Default application name | `wordpress` |
| Default display name | `Wordpress` |
| Default version | `latest` |
| Container port | `80` |
| Execution environment | `gen2` |
| Database engine | **MySQL 8.0** |
| Default DB name | `wp` |
| Default DB user | `wp` |
| NFS enabled | `true` (mount: `/mnt/nfs`) |
| Redis enabled | `true` (object cache) |
| Image source | `custom` (Cloud Build) |
| Platform-managed job | none (empty default) |

`Wordpress_Common` generates the Dockerfile (based on the official `wordpress` image), PHP configuration (`php.ini` overrides), WordPress `wp-config.php` template, and WordPress-specific secrets. Redis object caching is enabled by default; `Wordpress_Common` injects the required `WP_REDIS_HOST` and `WP_REDIS_PORT` environment variables when `enable_redis = true`.

**Note on MySQL:** This module uses MySQL 8.0, not PostgreSQL. The Cloud SQL Auth Proxy sidecar (`enable_cloudsql_volume = true`) provides a Unix socket connection. Attempting to disable `enable_cloudsql_volume` without switching to TCP-based connectivity will break the database connection.

---

## §2 IAM & Project Identity

Behaviour is identical to `App_CloudRun`. The following variables are passed through unchanged.

| Variable | Default | Notes |
|---|---|---|
| `project_id` | _(required)_ | Target GCP project |
| `tenant_deployment_id` | `"demo"` | Appended to resource names |
| `resource_creator_identity` | `"rad-module-creator@..."` | Terraform executor SA |
| `resource_labels` | `{}` | Applied to all resources |
| `support_users` | `[]` | Alert recipients & IAM members |

---

## §3 Core Service Configuration

### §3.A Application Identity

| Variable | Default | Notes |
|---|---|---|
| `application_name` | `"wordpress"` | Base name for Cloud Run service, secrets, Artifact Registry |
| `display_name` | `"Wordpress"` | Human-readable name in UI and dashboards |
| `description` | `"Wordpress CMS on Cloud Run"` | Used by `Wordpress_Common` for internal labelling |
| `application_version` | `"latest"` | Image tag; change to a specific version (e.g. `"6.5"`) for reproducible deployments |

Note: this module uses `display_name` and `description` (not `application_display_name` / `application_description`). `display_name` is forwarded to `App_CloudRun` as `application_display_name`; `description` is used only within `Wordpress_Common` and is not passed to `App_CloudRun`.

**WordPress-specific PHP configuration variables:**

| Variable | Default | Notes |
|---|---|---|
| `php_memory_limit` | `"512M"` | PHP memory limit; increase for heavy plugin or media use |
| `upload_max_filesize` | `"64M"` | Max single upload file size |
| `post_max_size` | `"64M"` | Max POST body size; must be ≥ `upload_max_filesize` |

### §3.B Resource Sizing

| Variable | Default | Notes |
|---|---|---|
| `cpu_limit` | `"1000m"` | 1 vCPU; increase for high-traffic or plugin-heavy sites |
| `memory_limit` | `"2Gi"` | 2 GiB; WordPress with PHP 8.x and caching plugins |
| `min_instance_count` | `0` | Scale-to-zero by default; set to `1` to eliminate cold starts |
| `max_instance_count` | `1` | Single-instance default; NFS shared state required before increasing |
| `timeout_seconds` | `300` | Increase for plugin installs, theme updates, or large media imports |

`container_resources` can be used to override `cpu_limit` and `memory_limit` with a structured object including requests and ephemeral storage:

```hcl
container_resources = {
  cpu_limit    = "2000m"
  memory_limit = "4Gi"
}
```

When `container_resources` is set (non-null), it takes precedence over the flat `cpu_limit` and `memory_limit` variables.

### §3.C Environment Variables & Secrets

Plain-text variables via `environment_variables`; sensitive values via `secret_environment_variables`.

**Module-injected secrets** (provisioned by `Wordpress_Common`, injected via `module_secret_env_vars`):

WordPress auth keys and salts are auto-generated by `Wordpress_Common` and stored in Secret Manager. The secret IDs are injected as environment variables at runtime. The exact variable names follow WordPress conventions (e.g. `WORDPRESS_AUTH_KEY`, `WORDPRESS_SECURE_AUTH_KEY`, `WORDPRESS_LOGGED_IN_KEY`, `WORDPRESS_NONCE_KEY`, and their corresponding salts).

The database password is auto-generated by `App_CloudRun` and wired through the module.

**User-supplied variables (non-sensitive):**

```hcl
environment_variables = {
  WORDPRESS_DEBUG = "false"
  WP_MEMORY_LIMIT = "512M"
}
```

**User-supplied secrets:**

```hcl
secret_environment_variables = {
  SENDGRID_API_KEY = "my-sendgrid-secret"
}
```

### §3.D Networking

Key defaults:

| Variable | Default |
|---|---|
| `ingress_settings` | `"all"` |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` |
| `enable_cloudsql_volume` | `true` |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `container_protocol` | `"http1"` |

The Cloud SQL Auth Proxy sidecar is required for MySQL Unix socket connectivity. Disable only when switching to TCP-based MySQL access. Set `container_protocol = "h2c"` to enable HTTP/2 communication between the load balancer and the Cloud Run service.

### §3.E Container Image & Build

| Variable | Default | Notes |
|---|---|---|
| `container_image_source` | `"custom"` | `"custom"` triggers Cloud Build; `"prebuilt"` deploys an existing image |
| `container_image` | `""` | Leave empty for Cloud Build output; set for prebuilt image URI |
| `enable_image_mirroring` | `true` | Mirrors image to Artifact Registry before deployment |

There is no `container_build_config` user variable in this module; the build configuration is fully managed by `Wordpress_Common`.

---

## §4 Advanced Security

### §4.A Identity-Aware Proxy

```hcl
enable_iap            = true
iap_authorized_groups = ["group:wordpress-admins@example.com"]
```

### §4.B VPC Service Controls

```hcl
enable_vpc_sc = true  # group=21; requires existing VPC-SC perimeter
```

### §4.C Cloud Armor & CDN

```hcl
enable_cloud_armor  = true
application_domains = ["www.example.com"]
enable_cdn          = true
```

### §4.D Binary Authorization

```hcl
enable_binary_authorization = true
```

### §4.E Secret Rotation

```hcl
secret_rotation_period         = "2592000s"  # 30-day notification
enable_auto_password_rotation  = false
rotation_propagation_delay_sec = 90
```

---

## §5 Traffic & Ingress

### §5.A Traffic Splitting

```hcl
traffic_split = [
  { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST",   percent = 90 },
  { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", revision = "wordpress-00002", percent = 10 },
]
```

### §5.B Ingress Control

```hcl
ingress_settings   = "internal-and-cloud-load-balancing"
vpc_egress_setting = "ALL_TRAFFIC"
```

---

## §6 CI/CD Integration

### §6.A Cloud Build Trigger

```hcl
enable_cicd_trigger   = true
github_repository_url = "https://github.com/my-org/wordpress-site"
github_token          = "ghp_xxxx"  # or use github_app_installation_id
cicd_trigger_config = {
  branch_pattern = "^main$"
  included_files = ["wp-content/**", "Dockerfile"]
}
```

### §6.B Cloud Deploy Pipeline

```hcl
enable_cloud_deploy = true
cloud_deploy_stages = [
  { name = "dev",     require_approval = false },
  { name = "staging", require_approval = false },
  { name = "prod",    require_approval = true  },
]
```

---

## §7 Reliability & Data

### §7.A Health Probes

`Wordpress_CloudRun` uses only `startup_probe` and `liveness_probe` (passed to `Wordpress_Common`). There is no separate `startup_probe_config` / `health_check_config` interface in this module.

| Variable | Default | Notes |
|---|---|---|
| `startup_probe.type` | `"TCP"` | TCP check during startup |
| `startup_probe.initial_delay_seconds` | `30` | |
| `startup_probe.timeout_seconds` | `10` | |
| `startup_probe.period_seconds` | `15` | |
| `startup_probe.failure_threshold` | `20` | High threshold to allow PHP/WP initialisation |
| `liveness_probe.type` | `"HTTP"` | HTTP check during steady state |
| `liveness_probe.path` | `"/wp-admin/install.php"` | Confirms PHP and database connection |
| `liveness_probe.initial_delay_seconds` | `300` | Long delay for first-boot database setup |
| `liveness_probe.timeout_seconds` | `60` | |
| `liveness_probe.period_seconds` | `60` | |
| `liveness_probe.failure_threshold` | `3` | |

The `liveness_probe` uses `/wp-admin/install.php` because this page requires a working PHP runtime and database connection, making it a reliable indicator of application health.

### §7.B Backup & Recovery

| Variable | Default | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Daily at 02:00 UTC |
| `backup_retention_days` | `7` | GCS lifecycle rule |
| `enable_backup_import` | `false` | One-time restore on deploy |
| `backup_source` | `"gcs"` | `"gcs"` or `"gdrive"` |
| `backup_uri` | `""` | Full GCS URI or Google Drive file ID |
| `backup_format` | `"sql"` | `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto` |

Note: this module uses `backup_uri` (aliased to `backup_file` in `main.tf`).

### §7.C Scheduled Jobs

```hcl
cron_jobs = [{
  name     = "wp-cron"
  schedule = "*/5 * * * *"
  image    = "wordpress:latest"
  command  = ["wp", "cron", "event", "run", "--due-now"]
}]
```

### §7.D Observability

```hcl
uptime_check_config = {
  enabled        = true
  path           = "/"
  check_interval = "60s"
  timeout        = "10s"
}

alert_policies = [{
  name               = "high-latency"
  metric_type        = "run.googleapis.com/request_latencies"
  comparison         = "COMPARISON_GT"
  threshold_value    = 2000
  duration_seconds   = 300
  aggregation_period = "60s"
}]
```

---

## §8 Integrations

### §8.A Redis Object Cache

Redis is **enabled by default** (`enable_redis = true`). `Wordpress_Common` injects Redis connection details when enabled. Leave `redis_host` empty to use the default Redis configuration supplied by `Wordpress_Common`.

```hcl
enable_redis = true
redis_host   = "10.0.0.5"  # leave "" for default; set for external Memorystore
redis_port   = "6379"       # string type
redis_auth   = ""
```

When `enable_redis = false`, no Redis environment variables are injected and the WordPress object cache operates in memory-only mode.

### §8.B NFS Storage

NFS is used for the WordPress `wp-content` directory (uploads, themes, plugins).

```hcl
enable_nfs     = true
nfs_mount_path = "/mnt/nfs"
```

`Wordpress_Common` configures WordPress to use this mount path for persistent file storage. Disable NFS only for single-container, stateless deployments where uploads are stored externally.

### §8.C GCS Fuse Volumes

```hcl
gcs_volumes = [{
  name        = "wp-uploads"
  bucket_name = "my-wp-uploads-bucket"
  mount_path  = "/var/www/html/wp-content/uploads"
  readonly    = false
}]
```

### §8.D Additional Services

`Wordpress_CloudRun` does not expose the `additional_services` variable. Co-deployed services are not supported in this module's interface.

---

## §9 Platform-Managed Behaviours

The following are set or injected automatically and do not require configuration.

### Database credentials (MySQL 8.0)

`App_CloudRun` generates a random MySQL password and stores it in Secret Manager. `Wordpress_Common` injects the password as `WORDPRESS_DB_PASSWORD` and constructs the database host path for the Unix socket connection.

### WordPress authentication keys and salts

`Wordpress_Common` auto-generates all eight WordPress authentication keys and salts on first deploy (e.g. `WORDPRESS_AUTH_KEY`, `WORDPRESS_LOGGED_IN_KEY`, and their `_SALT` counterparts). These are stored in Secret Manager and injected at runtime.

### PHP configuration

`Wordpress_Common` applies `php_memory_limit`, `upload_max_filesize`, and `post_max_size` to the container's `php.ini` during the Cloud Build step. These do not need to be set in `environment_variables`.

### Redis injection

When `enable_redis = true`, `Wordpress_Common` injects `WP_REDIS_HOST` and `WP_REDIS_PORT` into the container environment and configures the Redis Object Cache plugin. The plugin must be installed in the WordPress image for caching to activate.

### Probe endpoints

The liveness probe uses `/wp-admin/install.php`, which returns 200 when WordPress is installed and 302 (redirect) when it is not. The TCP startup probe (`type = "TCP"`) confirms the Apache web server is listening before HTTP checks begin. The high `failure_threshold = 20` on the startup probe provides approximately 5 minutes of tolerance for first-boot database setup.

---

## §10 Variable Reference

The table below covers all variables unique to or with notable defaults in `Wordpress_CloudRun`. For the full set of inherited variables, see the [App_CloudRun Variable Reference](../App_CloudRun/App_CloudRun.md#variable-reference).

| Variable | Type | Default | Group | Notes |
|---|---|---|---|---|
| `application_name` | `string` | `"wordpress"` | 2 | Base resource name |
| `display_name` | `string` | `"Wordpress"` | 2 | UI display name (forwarded as `application_display_name`) |
| `description` | `string` | `"Wordpress CMS on Cloud Run"` | 2 | Used by Wordpress_Common only |
| `application_version` | `string` | `"latest"` | 2 | Image tag |
| `php_memory_limit` | `string` | `"512M"` | 2 | PHP memory limit |
| `upload_max_filesize` | `string` | `"64M"` | 2 | Max upload file size |
| `post_max_size` | `string` | `"64M"` | 2 | Max POST body size |
| `cpu_limit` | `string` | `"1000m"` | 3 | 1 vCPU |
| `memory_limit` | `string` | `"2Gi"` | 3 | 2 GiB |
| `container_resources` | `object` | `null` | 3 | Overrides `cpu_limit`/`memory_limit` when set |
| `min_instance_count` | `number` | `0` | 3 | Scale-to-zero |
| `max_instance_count` | `number` | `1` | 3 | |
| `container_port` | `number` | `80` | 3 | Apache default |
| `container_protocol` | `string` | `"http1"` | 3 | `"http1"` or `"h2c"` |
| `container_image_source` | `string` | `"custom"` | 3 | `"prebuilt"` or `"custom"` |
| `container_image` | `string` | `""` | 3 | Override for prebuilt |
| `enable_image_mirroring` | `bool` | `true` | 3 | Mirror to Artifact Registry |
| `enable_cloudsql_volume` | `bool` | `true` | 3 | Required for MySQL Unix socket |
| `cloudsql_volume_mount_path` | `string` | `"/cloudsql"` | 3 | Socket path |
| `db_name` | `string` | `"wp"` | 11 | MySQL database name |
| `db_user` | `string` | `"wp"` | 11 | MySQL user |
| `database_password_length` | `number` | `16` | 11 | 8–64 characters |
| `enable_nfs` | `bool` | `true` | 10 | Cloud Filestore mount |
| `nfs_mount_path` | `string` | `"/mnt/nfs"` | 10 | Container mount path |
| `storage_buckets` | `list` | `[{ name_suffix = "data" }]` | 10 | GCS buckets |
| `backup_uri` | `string` | `""` | 6 | Full GCS URI or Drive ID (aliased to `backup_file`) |
| `backup_format` | `string` | `"sql"` | 6 | Includes `"auto"` option |
| `enable_redis` | `bool` | `true` | 20 | Redis object cache (on by default) |
| `redis_host` | `string` | `""` | 20 | Leave empty for default |
| `redis_port` | `string` | `"6379"` | 20 | String type |
| `redis_auth` | `string` | `""` | 20 | Sensitive |
| `startup_probe` | `object` | `{ type="TCP", initial_delay_seconds=30, failure_threshold=20 }` | 13 | |
| `liveness_probe` | `object` | `{ type="HTTP", path="/wp-admin/install.php", initial_delay_seconds=300 }` | 13 | |
| `initialization_jobs` | `list` | `[]` | 12 | No platform-managed jobs |
| `enable_vpc_sc` | `bool` | `false` | 21 | VPC Service Controls |
