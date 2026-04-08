# Wordpress_CloudRun Module — Configuration Guide

This guide describes the configuration variables that are **unique to the `Wordpress_CloudRun` module**. Because `Wordpress_CloudRun` is a wrapper around `App_CloudRun`, the vast majority of its variables are passed directly to that base module and are fully documented in the [App_CloudRun Configuration Guide](../App_CloudRun/App_CloudRun_Guide.md). This guide explains the WordPress-specific additions, the differences in default values, and what the `Wordpress_Common` sub-module provisions automatically.

> **Where to look:** If a variable you are configuring is not described here, consult the [App_CloudRun Configuration Guide](../App_CloudRun/App_CloudRun_Guide.md). All `App_CloudRun` features — access and networking, IAP, Cloud Armor, CDN, CI/CD, Cloud Deploy, Binary Authorization, traffic splitting, and VPC Service Controls — are available in `Wordpress_CloudRun` with identical behaviour and configuration.

---

## WordPress Application Architecture

`Wordpress_CloudRun` composes two modules:

```
Wordpress_CloudRun
├── Wordpress_Common        (generates WordPress-specific configuration)
│   ├── Custom PHP 8.4 + Apache container image
│   │   └── Extensions: gd, mysqli, imagick, bcmath, intl, zip
│   ├── MySQL 8.0 database type and defaults
│   ├── GCS uploads bucket definition
│   ├── 8 WordPress security keys/salts (auto-generated in Secret Manager)
│   └── db-init initialization job (creates database and user on every apply)
└── App_CloudRun            (Cloud Run v2 platform)
    ├── Provisions Cloud SQL MySQL 8.0 (or discovers shared Services_GCP instance)
    ├── Mounts GCS wp-uploads bucket via GCS Fuse (requires gen2 execution environment)
    ├── Injects WordPress secrets into the Cloud Run revision via Secret Manager
    └── Runs db-init Cloud Run Job (execute_on_apply = true — idempotent)
```

On first deployment the `db-init` Cloud Run Job (using `mysql:8.0-debian`) connects to the Cloud SQL instance via its **private IP over TCP** (not the Unix socket — the socket is not available during job execution) and creates the WordPress database and user. The job runs on **every** `terraform apply` because it is idempotent — it safely skips steps that are already complete.

> **Note on `service_url`:** Unlike `Wordpress_GKE`, the Cloud Run wrapper passes `local.predicted_service_url` to `Wordpress_Common` before the Cloud Run service exists. This allows `Wordpress_Common` to pre-configure `WP_HOME` and `WP_SITEURL` using the deterministic Cloud Run URL (`https://{service_name}-{project_number}.{region}.run.app`), ensuring WordPress knows its own URL from the first request without requiring a post-deployment update.

---

## Platform-Inherited Configuration

The groups below are **fully inherited from `App_CloudRun`** and behave identically. Refer to the linked sections of the [App_CloudRun Configuration Guide](../App_CloudRun/App_CloudRun_Guide.md) for complete documentation, including all option values, validation commands, and Console navigation paths.

| Configuration Area | App_CloudRun Guide Section |
|---|---|
| Module Metadata & Configuration | [Group 0](../App_CloudRun/App_CloudRun_Guide.md#group-0-module-metadata--configuration) |
| Project & Identity | [Group 1](../App_CloudRun/App_CloudRun_Guide.md#group-1-project--identity) |
| CI/CD & GitHub Integration | [Group 7](../App_CloudRun/App_CloudRun_Guide.md#group-7-cicd--github-integration) |
| Storage & Filesystem — NFS | [Group 8](../App_CloudRun/App_CloudRun_Guide.md#group-8-storage--filesystem--nfs) |
| Storage & Filesystem — GCS | [Group 9](../App_CloudRun/App_CloudRun_Guide.md#group-9-storage--filesystem--gcs) |
| Backup & Maintenance (schedule, retention, import) | [Group 12](../App_CloudRun/App_CloudRun_Guide.md#group-12-backup--maintenance) |
| Custom Initialisation & SQL | [Group 13](../App_CloudRun/App_CloudRun_Guide.md#group-13-custom-initialisation--sql) |
| Access & Networking (ingress, VPC egress, network name) | [Group 14](../App_CloudRun/App_CloudRun_Guide.md#group-14-access--networking) |
| Identity-Aware Proxy | [Group 15](../App_CloudRun/App_CloudRun_Guide.md#group-15-identity-aware-proxy) |
| Cloud Armor & CDN | [Group 16](../App_CloudRun/App_CloudRun_Guide.md#group-16-cloud-armor--cdn) |
| VPC Service Controls | [Group 17](../App_CloudRun/App_CloudRun_Guide.md#group-17-vpc-service-controls) |

---

## WordPress-Specific Configuration

The sections below document variables that are **unique to this module** or that carry **WordPress-specific defaults** which differ from the `App_CloudRun` base.

---

### Application Identity

The variables in this group work identically to [App_CloudRun Group 2](../App_CloudRun/App_CloudRun_Guide.md#group-2-application-identity), but `Wordpress_CloudRun` provides WordPress-appropriate defaults. Note that this module uses `display_name` and `description` (rather than `application_display_name` and `application_description`) for the human-readable fields. The three PHP configuration variables are unique to this module.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_name` | `"wordpress"` | `[a-z][a-z0-9-]{0,19}` | Internal identifier for this WordPress deployment. Used as the base name for the Cloud Run service, Artifact Registry repository, Cloud SQL database/user, GCS buckets, and Secret Manager secrets. **Do not change after initial deployment.** |
| `display_name` | `"Wordpress"` | Any string | Human-readable name shown in the platform UI, the Cloud Run service list, and monitoring dashboards. May be updated freely without affecting resource names. |
| `description` | `"Wordpress CMS on Cloud Run"` | Any string | Brief description of the application. Visible in the Cloud Run service details and platform documentation. |
| `application_version` | `"latest"` | Any string (e.g. `"6.5.3"`, `"6.6"`) | Version tag passed to Cloud Build as the `APP_VERSION` build argument and baked into the container image. Incrementing this value triggers a new build and Cloud Run revision. Avoid `"latest"` in production — pin to a specific WordPress version for reproducibility and reliable rollbacks. |
| `php_memory_limit` | `"512M"` | String with unit suffix (e.g. `"256M"`, `"1G"`) | PHP `memory_limit` directive applied inside the WordPress container. WordPress loads all active plugins into memory on each request — sites with many or memory-intensive plugins may exhaust the default. **Symptoms of an insufficient value:** "Allowed memory size exhausted" fatal errors, blank pages, or silent failures during plugin activation or import operations. Common production values: `"512M"` (default), `"1G"` (heavy plugin workloads). |
| `upload_max_filesize` | `"64M"` | String with unit suffix (e.g. `"64M"`, `"256M"`) | PHP `upload_max_filesize` directive. Sets the maximum size of a **single file** that can be uploaded via the WordPress media library, plugin installer, or theme installer. Must be **equal to or less than `post_max_size`**. Increase for sites managing large video, audio, or high-resolution image uploads. |
| `post_max_size` | `"64M"` | String with unit suffix (e.g. `"64M"`, `"256M"`) | PHP `post_max_size` directive. Sets the maximum size of all POST data in a single HTTP request, including file uploads. Must be **greater than or equal to `upload_max_filesize`**. If a client exceeds this limit, PHP discards all `$_POST` variables — in WordPress this causes failed uploads, empty form submissions, and silent post-save failures. |

#### Validating PHP Limits

```bash
# Confirm PHP limits are active in a running Cloud Run revision
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" \
  | grep -E "PHP_MEMORY_LIMIT|UPLOAD_MAX_FILESIZE|POST_MAX_SIZE"
```

---

### Runtime & Scaling

All variables in this group behave as documented in [App_CloudRun Group 3](../App_CloudRun/App_CloudRun_Guide.md#group-3-runtime--scaling). The table below highlights the defaults that `Wordpress_CloudRun` changes from the base module.

| Variable | WordPress Default | App_CloudRun Default | Note |
|---|---|---|---|
| `container_image_source` | `"custom"` | `"custom"` | WordPress always builds a custom PHP 8.4 + Apache image via Cloud Build. Override with `"prebuilt"` only when supplying your own pre-built WordPress image via `container_image`. |
| `container_port` | `80` | `8080` | Apache in the WordPress container listens on port 80. Do not change unless you have modified the container's Apache configuration. |
| `cpu_limit` | `"1000m"` | *(set via `container_resources`)* | Exposed as a top-level variable for convenience alongside `memory_limit`. |
| `memory_limit` | `"2Gi"` | `"512Mi"` *(via `container_resources`)* | WordPress with PHP 8.x requires substantially more memory than a generic application. The `2Gi` default accommodates WordPress core, WooCommerce, Yoast SEO, and moderate media library usage. Increase to `4Gi` for sites with many concurrent users or heavy plugin workloads. |
| `min_instance_count` | `0` | `0` | Scale-to-zero is enabled by default. Set to `1` to eliminate cold-start delays for production sites with SLA requirements or persistent database connections. |
| `max_instance_count` | `1` | `1` | WordPress stores uploaded media in a GCS Fuse–mounted bucket, which supports concurrent writers. However, in-memory PHP session state and some plugin caches may not be multi-instance–safe. Increase this value only after confirming all installed plugins handle concurrent access correctly. |
| `execution_environment` | `"gen2"` | `"gen2"` | The gen2 execution environment is **required** for NFS volume mounts and GCS Fuse mounts. Do not change to `"gen1"` — doing so will prevent NFS and GCS Fuse volumes from mounting and WordPress will lose access to its media library. |
| `container_resources` | `null` *(uses `cpu_limit`/`memory_limit`)* | `null` | When `container_resources` is set explicitly it overrides the separate `cpu_limit` and `memory_limit` variables. Use `container_resources` when you also need to specify CPU/memory *requests* or ephemeral storage limits. |

---

### Environment Variables & Secrets

Refer to [App_CloudRun Group 4](../App_CloudRun/App_CloudRun_Guide.md#group-4-environment-variables--secrets) for documentation on `environment_variables`, `secret_environment_variables`, `secret_rotation_period`, and `secret_propagation_delay`.

#### WordPress Auto-Generated Security Keys & Salts

`Wordpress_Common` automatically provisions **eight WordPress cryptographic secrets** in Secret Manager and injects them into the Cloud Run revision as secret references. You do not need to supply values — they are generated as random 64-character strings on the first deployment and persist across subsequent applies.

| Secret | WordPress Constant | Purpose |
|---|---|---|
| `*-auth-key` | `WORDPRESS_AUTH_KEY` | Signs authentication cookies |
| `*-secure-auth-key` | `WORDPRESS_SECURE_AUTH_KEY` | Signs authentication cookies over HTTPS |
| `*-logged-in-key` | `WORDPRESS_LOGGED_IN_KEY` | Identifies logged-in cookies |
| `*-nonce-key` | `WORDPRESS_NONCE_KEY` | Provides nonce uniqueness |
| `*-auth-salt` | `WORDPRESS_AUTH_SALT` | Salts the auth key |
| `*-secure-auth-salt` | `WORDPRESS_SECURE_AUTH_SALT` | Salts the secure auth key |
| `*-logged-in-salt` | `WORDPRESS_LOGGED_IN_SALT` | Salts the logged-in key |
| `*-nonce-salt` | `WORDPRESS_NONCE_SALT` | Salts the nonce key |

> **Important:** Rotating these secrets invalidates all existing browser cookies. Every logged-in WordPress user — including administrators — will be immediately signed out and will need to re-authenticate. Rotate only if a secret is believed to have been compromised.

```bash
# Confirm all WordPress secrets are present in Secret Manager
gcloud secrets list --project=PROJECT_ID \
  --filter="name:RESOURCE_PREFIX" \
  --format="table(name,createTime)"
```

#### WordPress Pre-Set Environment Variables

`Wordpress_Common` injects the following environment variables into all Cloud Run revisions automatically. Override via `environment_variables` only when customising beyond the defaults.

| Variable | Pre-Set Value | Description |
|---|---|---|
| `WORDPRESS_TABLE_PREFIX` | `wp_` | Standard WordPress table prefix. Override only when migrating an existing database with a non-standard prefix. |
| `WORDPRESS_DEBUG` | `false` | Disables debug mode. Set to `true` in development environments only — debug output may expose sensitive information in HTTP responses. |
| `ENABLE_REDIS` | `true` / `false` | Controlled by `enable_redis`. |
| `WP_REDIS_HOST` | *value of `redis_host`* | Injected only when `enable_redis = true`. |
| `WP_REDIS_PORT` | *value of `redis_port`* | Injected only when `enable_redis = true`. |

---

### Database Configuration

The WordPress database is always **MySQL 8.0** (`MYSQL_8_0`), locked in by `Wordpress_Common`. Refer to [App_CloudRun Group 11](../App_CloudRun/App_CloudRun_Guide.md#group-11-database-backend) for documentation on Cloud SQL instance discovery (`sql_instance_name`, `sql_instance_base_name`), `database_password_length`, `enable_auto_password_rotation`, and `rotation_propagation_delay_sec`.

The variables below behave identically to their `App_CloudRun` counterparts but carry WordPress-appropriate defaults.

| Variable | WordPress Default | App_CloudRun Default | Description |
|---|---|---|---|
| `database_type` | `"MYSQL_8_0"` *(set by Wordpress_Common)* | `"POSTGRES"` | WordPress requires MySQL. The default is pre-configured by `Wordpress_Common` and should not be changed. Setting this to a non-MySQL type will prevent WordPress from connecting. |
| `db_name` | `"wp"` | `"crappdb"` | Name of the MySQL database created inside the Cloud SQL instance. Injected into the Cloud Run service as `DB_NAME`. **Do not change after initial deployment** without first migrating the database contents. |
| `db_user` | `"wp"` | `"crappuser"` | MySQL username created for the WordPress application. Injected as `DB_USER`. The auto-generated password is stored in Secret Manager and injected as `DB_PASSWORD`. |

> **Note:** The variables `enable_postgres_extensions`, `postgres_extensions`, `enable_mysql_plugins`, and `mysql_plugins` are available but have no effect in the default WordPress configuration.

---

### Jobs & Scheduled Tasks

Refer to [App_CloudRun Group 6](../App_CloudRun/App_CloudRun_Guide.md#group-6-jobs--scheduled-tasks) for documentation on `initialization_jobs`, `cron_jobs`, and `additional_services`.

#### Pre-Configured db-init Job

`Wordpress_Common` automatically defines a `db-init` Cloud Run Job. This job runs the `db-init.sh` script using the `mysql:8.0-debian` image and creates the WordPress MySQL database and user in the Cloud SQL instance if they do not already exist. Key properties:

- **`execute_on_apply = true`** — the job is triggered on every `terraform apply`, not only on first deployment.
- **Idempotent** — checks whether the database and user already exist before attempting to create them; safe to run repeatedly.
- **TCP connection** — the `db-init` job connects to Cloud SQL via the instance's **private IP address over TCP** (not via the Unix socket, which is only available inside the running Cloud Run service).

If you supply custom entries in `initialization_jobs`, they **replace** the default `db-init` job entirely. If your custom jobs still require database setup, include a database initialisation step in your list.

```bash
# List all Cloud Run Jobs associated with this deployment
gcloud run jobs list \
  --region=REGION \
  --format="table(name,metadata.creationTimestamp)"

# View the most recent execution of the db-init job
gcloud run jobs executions list \
  --job=JOB_NAME \
  --region=REGION \
  --format="table(name,status.conditions[0].type,status.startTime,status.completionTime)"
```

---

### Redis Object Cache

WordPress uses Redis as a persistent object cache to store the results of expensive database queries in memory, reducing page load time and database load on high-traffic sites. This module integrates with the **Redis Object Cache** WordPress plugin.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `true` | `true` / `false` | When `true`, injects the `ENABLE_REDIS`, `WP_REDIS_HOST`, and `WP_REDIS_PORT` environment variables into the Cloud Run revision. The container entrypoint script reads these and configures the Redis Object Cache plugin accordingly. **Enabling this variable does not provision a Redis server** — the server must exist independently. Leave `redis_host` empty to automatically use the Redis-compatible service co-located on the `Services_GCP`-managed NFS server. Set to `false` to disable object caching entirely; this increases database load on busy sites but removes the Redis dependency. |
| `redis_host` | `""` *(defaults to NFS server IP)* | IP address or hostname | The hostname or IP address of the Redis server, injected as `WP_REDIS_HOST`. Leave blank to fall back to the IP of the `Services_GCP`-managed NFS server (where a Redis-compatible service is typically co-located). Set explicitly when using a dedicated Cloud Memorystore instance — use the instance's private IP from **Memorystore → Redis → *instance* → Primary endpoint**. The Cloud Run service reaches this address over the VPC — ensure the `vpc_egress_setting` routes private IP traffic through the VPC (`PRIVATE_RANGES_ONLY` is sufficient) and that firewall rules permit TCP traffic on `redis_port` from the Cloud Run VPC connector range. |
| `redis_port` | `"6379"` | Port number as string (e.g. `"6379"`) | TCP port of the Redis server, injected as `WP_REDIS_PORT`. The default `6379` is correct for standard Redis and Cloud Memorystore. Change only if your Redis instance is configured on a non-standard port. |

#### Validating Redis Configuration

```bash
# Confirm Redis environment variables are present on the latest Cloud Run revision
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" \
  | grep -E "REDIS"
```

---

### Observability & Health

Refer to [App_CloudRun Group 5](../App_CloudRun/App_CloudRun_Guide.md#group-5-observability--health) for documentation on `uptime_check_config` and `alert_policies`. The probe configuration variables below have WordPress-specific defaults that differ materially from the `App_CloudRun` base module.

WordPress requires generous probe settings due to its variable startup time: on first boot it establishes a database connection, loads all active plugins, and may run upgrade routines — all before it can serve an HTTP response.

| Variable | WordPress Default | App_CloudRun Default | Description |
|---|---|---|---|
| `startup_probe` | `{ enabled = true, type = "TCP", path = "/", initial_delay_seconds = 30, timeout_seconds = 10, period_seconds = 15, failure_threshold = 20 }` | `{ enabled = true, type = "HTTP", path = "/healthz", initial_delay_seconds = 10, failure_threshold = 10 }` | Cloud Run startup probe. Uses **TCP** rather than HTTP because WordPress may not yet respond to HTTP requests during its initialisation phase. The high `failure_threshold` (20 × 15s = 300 seconds of total grace) accommodates the `db-init` Cloud Run Job and WordPress's plugin loading phase. Cloud Run will not route any traffic to the instance until this probe succeeds. **Do not reduce `failure_threshold` below 10 for production** — premature startup probe failures cause the instance to restart during database initialisation, which can result in a restart loop. |
| `liveness_probe` | `{ enabled = true, type = "HTTP", path = "/wp-admin/install.php", initial_delay_seconds = 300, timeout_seconds = 60, period_seconds = 60, failure_threshold = 3 }` | `{ enabled = true, type = "HTTP", path = "/healthz", initial_delay_seconds = 15, failure_threshold = 3 }` | Cloud Run liveness probe. Uses `/wp-admin/install.php` as the health endpoint — this WordPress-managed page returns HTTP 200 whether WordPress is freshly installed or already configured, making it a reliable and dependency-free liveness indicator. The 300-second initial delay ensures liveness checks do not begin until after the `db-init` job has completed and WordPress has fully initialised. The 60-second `timeout_seconds` allows for slow database response times under load. |

---

## Deployment Prerequisites

Refer to [App_CloudRun — Deployment Prerequisites & Dependency Analysis](../App_CloudRun/App_CloudRun_Guide.md#deployment-prerequisites--dependency-analysis) for the complete list of hard prerequisites, silent failure modes, and soft prerequisites.

**WordPress-specific notes:**

- The `db-init` Cloud Run Job creates the MySQL database and user automatically on the first apply — no manual database setup is required before deployment.
- The eight WordPress security keys and salts are generated and stored in Secret Manager automatically — no pre-existing secrets are needed.
- The GCS uploads bucket (`wp-uploads`) is defined by `Wordpress_Common` and provisioned by `App_CloudRun` — it does not need to be created manually.
- Because `execute_on_apply = true` on the `db-init` job, every `terraform apply` triggers the initialisation script. This is intentional and safe; the script is idempotent.
- The `execution_environment` must remain `"gen2"` — changing it to `"gen1"` will prevent NFS and GCS Fuse volumes from mounting and break the WordPress media library.
- The `backup_uri` variable (for backup import) accepts a full GCS URI (`gs://bucket/path/to/file.sql`) or a Google Drive file ID, depending on `backup_source`. This differs from some other App modules that use a bare filename.

---

## Dependency on `Services_GCP`

Refer to [App_CloudRun — Dependency on `Services_GCP` for Shared Resources](../App_CloudRun/App_CloudRun_Guide.md#dependency-on-services_gcp-for-shared-resources) for a full comparison of standalone versus `Services_GCP`-backed deployments.

**WordPress-specific benefit:** when `Services_GCP` provides a shared Cloud SQL instance, the `db-init` Cloud Run Job connects to it and creates only the WordPress database and user within the shared instance — eliminating the cost of a dedicated Cloud SQL instance per WordPress deployment. This is the recommended model for multi-tenant platforms where many independent WordPress sites share the same GCP project.
