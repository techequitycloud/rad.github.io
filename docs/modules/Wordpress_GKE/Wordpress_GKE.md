# Wordpress_GKE Module — Configuration Guide

This guide describes the configuration variables that are **unique to the `Wordpress_GKE` module**. Because `Wordpress_GKE` is a wrapper around `App_GKE`, the vast majority of its variables are passed directly to that base module and are fully documented in the [App_GKE Configuration Guide](../App_GKE/App_GKE.md). This guide explains the WordPress-specific additions, the differences in default values, and what the `Wordpress_Common` sub-module provisions automatically.

> **Where to look:** If a variable you are configuring is not described here, consult the [App_GKE Configuration Guide](../App_GKE/App_GKE.md). All `App_GKE` features — GKE cluster selection, session affinity, network policies, Cloud Armor, IAP, CI/CD, Cloud Deploy, Binary Authorization, StatefulSets, resource quotas, and VPC Service Controls — are available in `Wordpress_GKE` with identical behaviour and configuration.

---

## WordPress Application Architecture

`Wordpress_GKE` composes two modules:

```
Wordpress_GKE
├── Wordpress_Common        (generates WordPress-specific configuration)
│   ├── Custom PHP 8.4 + Apache container image
│   │   └── Extensions: gd, mysqli, imagick, bcmath, intl, zip
│   ├── MySQL 8.0 database type and defaults
│   ├── GCS uploads bucket definition
│   ├── 8 WordPress security keys/salts (auto-generated in Secret Manager)
│   └── db-init initialization job (creates database and user on every apply)
└── App_GKE                 (GKE Autopilot platform)
    ├── Provisions Cloud SQL MySQL 8.0 (or discovers shared Services_GCP instance)
    ├── Mounts GCS wp-uploads bucket via GCS Fuse CSI Driver
    ├── Injects WordPress secrets into pods via Secret Manager
    └── Runs db-init job (execute_on_apply = true — idempotent)
```

On first deployment the `db-init` job (using `mysql:8.0-debian`) runs a script that creates the application database and user in the Cloud SQL instance. It runs on **every** `terraform apply` because it is idempotent — it safely skips steps that are already complete.

---

## Platform-Inherited Configuration

The groups below are **fully inherited from `App_GKE`** and behave identically. Refer to the linked sections of the [App_GKE Configuration Guide](../App_GKE/App_GKE.md) for complete documentation, including all option values, validation commands, and Console navigation paths.

| Configuration Area | App_GKE.md Section |
|---|---|
| Module Metadata & Configuration | [App_GKE §1 Module Overview](../App_GKE/App_GKE.md#1-module-overview) |
| Project & Identity | [App_GKE §2 IAM & Access Control](../App_GKE/App_GKE.md#2-iam--access-control) |
| GKE Backend Configuration (cluster selection, namespace, workload type, service type, session affinity) | [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot) |
| Networking & Network Policies | [App_GKE §3.D Networking & Network Policies](../App_GKE/App_GKE.md#d-networking--network-policies) |
| Additional Services | [App_GKE §3.F Additional Services](../App_GKE/App_GKE.md#f-additional-services) |
| Storage & Filesystem — NFS | [App_GKE §3.C Storage (NFS / GCS / GCS Fuse)](../App_GKE/App_GKE.md#c-storage-nfs--gcs--gcs-fuse) |
| Storage & Filesystem — GCS | [App_GKE §3.C Storage (NFS / GCS / GCS Fuse)](../App_GKE/App_GKE.md#c-storage-nfs--gcs--gcs-fuse) |
| Custom SQL Scripts | [App_GKE §3.E Initialization Jobs & CronJobs](../App_GKE/App_GKE.md#e-initialization-jobs--cronjobs) |
| CI/CD & GitHub Integration | [App_GKE §6 CI/CD & Delivery](../App_GKE/App_GKE.md#6-cicd--delivery) |
| Binary Authorization | [App_GKE §4.C Binary Authorization](../App_GKE/App_GKE.md#c-binary-authorization) |
| Identity-Aware Proxy | [App_GKE §4.B Identity-Aware Proxy (IAP)](../App_GKE/App_GKE.md#b-identity-aware-proxy-iap) |
| Cloud Armor | [App_GKE §4.A Cloud Armor WAF](../App_GKE/App_GKE.md#a-cloud-armor-waf) |
| VPC Service Controls | [App_GKE §4.D VPC Service Controls](../App_GKE/App_GKE.md#d-vpc-service-controls) |
| Secrets Store CSI | Always enabled — no configuration required. See [App_GKE §4.E Secrets Store CSI](../App_GKE/App_GKE.md#e-secrets-store-csi-driver). |
| Observability & Health (`startup_probe_config`, `health_check_config` for LB health checks; `uptime_check_config`, `alert_policies`) | [App_GKE §5 Traffic & Ingress](../App_GKE/App_GKE.md#5-traffic--ingress) |
| Cloud CDN | [App_GKE §5.B Cloud CDN](../App_GKE/App_GKE.md#b-cloud-cdn) |
| Static IP | [App_GKE §5.C Static IP](../App_GKE/App_GKE.md#c-static-ip) |
| Backup Schedule & Retention and Backup Import | [App_GKE §8.B Backup Import & Recovery](../App_GKE/App_GKE.md#b-backup-import) |
| Pod Disruption Budget | [App_GKE §7.A Pod Disruption Budget](../App_GKE/App_GKE.md#a-pod-disruption-budgets) |
| Topology Spread | [App_GKE §7.B Topology Spread](../App_GKE/App_GKE.md#b-topology-spread-constraints) |
| Resource Quotas | [App_GKE §7.C Resource Quotas](../App_GKE/App_GKE.md#c-resource-quotas) |
| Auto Password Rotation | [App_GKE §7.D Auto Password Rotation](../App_GKE/App_GKE.md#d-auto-password-rotation) |
| Redis / Memorystore | [App_GKE §8.A Redis / Memorystore](../App_GKE/App_GKE.md#a-redis--memorystore) |
| Custom Domain | [App_GKE §5 Traffic & Ingress](../App_GKE/App_GKE.md#5-traffic--ingress) |
| Service Mesh | [App_GKE §8.C Service Mesh](../App_GKE/App_GKE.md#c-service-mesh-asm-via-fleet) |
| Multi-Cluster Services | [App_GKE §8.D Multi-Cluster Services](../App_GKE/App_GKE.md#d-multi-cluster-services-mcs) |
| StatefulSet Configuration | [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot) *(not commonly used for WordPress)* |

---

## WordPress-Specific Configuration

The sections below document variables that are **unique to this module** or that carry **WordPress-specific defaults** which differ from the `App_GKE` base.

---

### Application Identity

The variables in this group work identically to [App_GKE §1 Module Overview](../App_GKE/App_GKE.md#1-module-overview), but `Wordpress_GKE` provides WordPress-appropriate defaults. The three PHP configuration variables (`php_memory_limit`, `upload_max_filesize`, `post_max_size`) are unique to this module and control the container's PHP runtime behaviour.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_name` | `"wordpress"` | `[a-z][a-z0-9-]{0,19}` | Internal identifier for this WordPress deployment. Used as the base name for the Kubernetes namespace, Cloud SQL database/user, Artifact Registry repository, GCS buckets, and Secret Manager secrets. **Do not change after initial deployment.** |
| `application_display_name` | `"Wordpress"` | Any string | Human-readable name shown in the platform UI and monitoring dashboards. May be updated freely at any time without affecting resource names. |
| `application_description` | `"Wordpress CMS on GKE"` | Any string | Description used in resource annotations and platform documentation. |
| `application_version` | `"latest"` | Any string (e.g. `"6.5.3"`, `"6.6"`) | Version tag passed to Cloud Build as the `APP_VERSION` build argument and baked into the container image. Incrementing this value triggers a new build and rolling update. Avoid `"latest"` in production — use a pinned WordPress version to ensure reproducible deployments and reliable rollbacks. |
| `php_memory_limit` | `"512M"` | String with unit suffix (e.g. `"256M"`, `"1G"`) | PHP `memory_limit` directive applied inside the WordPress container. WordPress loads all active plugins into memory on each request — sites with many or memory-intensive plugins may exhaust the default limit. **Symptoms of an insufficient value:** "Allowed memory size exhausted" fatal errors, blank pages (white screen of death), or silent failures during plugin activation or data imports. Common production values: `"512M"` (default), `"1G"` (heavy plugin workloads). |
| `upload_max_filesize` | `"64M"` | String with unit suffix (e.g. `"64M"`, `"256M"`) | PHP `upload_max_filesize` directive. Sets the maximum size of a **single file** that can be uploaded via the WordPress media library, plugin installer, or theme installer. Must be **equal to or less than `post_max_size`** — if it exceeds `post_max_size`, PHP silently limits it to `post_max_size`. Increase for sites that manage large video, audio, or high-resolution image uploads. |
| `post_max_size` | `"64M"` | String with unit suffix (e.g. `"64M"`, `"256M"`) | PHP `post_max_size` directive. Sets the maximum size of all POST data submitted in a single HTTP request, including file upload payloads. Must be **greater than or equal to `upload_max_filesize`**. If a client exceeds this limit, PHP discards all `$_POST` variables in the request — in WordPress this manifests as failed uploads, empty form submissions, or silent post-save failures. |

#### Validating PHP Limits

```bash
# Confirm PHP limits are active in a running WordPress pod
kubectl exec -n NAMESPACE POD_NAME -- php -r "
  echo 'memory_limit: '     . ini_get('memory_limit')     . PHP_EOL;
  echo 'upload_max_filesize: ' . ini_get('upload_max_filesize') . PHP_EOL;
  echo 'post_max_size: '    . ini_get('post_max_size')    . PHP_EOL;
"
```

---

### Runtime & Scaling

All variables in this group behave as documented in [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot). The table below highlights the defaults that `Wordpress_GKE` changes from the base module values.

| Variable | WordPress Default | App_GKE Default | Note |
|---|---|---|---|
| `container_image_source` | `"custom"` | `"custom"` | WordPress always builds a custom PHP 8.4 + Apache image via Cloud Build. Override with `"prebuilt"` only when supplying your own pre-built WordPress image via `container_image`. |
| `container_port` | `80` | `8080` | Apache in the WordPress container listens on port 80. Do not change unless you have modified the Apache configuration inside the container. |
| `cpu_limit` | `"1000m"` | *(set via `container_resources`)* | Exposed as a top-level variable alongside `memory_limit` for convenience. Equivalent to setting `container_resources.cpu_limit`. |
| `memory_limit` | `"2Gi"` | `"512Mi"` *(via `container_resources`)* | WordPress with PHP 8.x and a typical plugin set requires substantially more memory than a generic application. The `2Gi` default accommodates WordPress core, WooCommerce, Yoast SEO, and moderate media library usage. Increase to `4Gi` for sites with many concurrent users or heavy plugin workloads. |
| `min_instance_count` | `1` | `1` | One pod is always running to avoid cold-start latency for WordPress visitors. |
| `max_instance_count` | `1` | `3` | WordPress stores uploaded media in a GCS Fuse–mounted bucket, which supports concurrent writers. However, PHP session state and certain plugin caches may not be multi-replica–safe. Increase this value only after verifying that all installed plugins handle concurrent access correctly, and ensure `session_affinity = "ClientIP"` (the default) is set to pin sessions to individual pods. |
| `container_resources` | `null` *(uses `cpu_limit`/`memory_limit`)* | `null` | When `container_resources` is set explicitly it overrides the separate `cpu_limit` and `memory_limit` variables. Use `container_resources` when you also need to specify CPU/memory *requests* or ephemeral storage limits. |

---

### Environment Variables & Secrets

Refer to [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot) for documentation on `environment_variables`, `secret_environment_variables`, `secret_rotation_period`, and `secret_propagation_delay`.

#### WordPress Auto-Generated Security Keys & Salts

`Wordpress_Common` automatically provisions **eight WordPress cryptographic secrets** in Secret Manager and injects them into the application pods. You do not need to supply values — they are generated as random 64-character strings on the first deployment and persist across subsequent applies.

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

> **Important:** Rotating these secrets (by deleting and recreating them) invalidates all existing browser cookies. Every logged-in WordPress user — including administrators — will be immediately signed out. Rotate only if a secret is believed to have been compromised.

```bash
# Confirm all WordPress secrets are present in Secret Manager
gcloud secrets list --project=PROJECT_ID \
  --filter="name:RESOURCE_PREFIX" \
  --format="table(name,createTime)"
```

#### WordPress Pre-Set Environment Variables

`Wordpress_Common` injects the following environment variables into all pods automatically. You do not need to configure them; override via `environment_variables` only when customising beyond the defaults.

| Variable | Pre-Set Value | Description |
|---|---|---|
| `WORDPRESS_TABLE_PREFIX` | `wp_` | Standard WordPress table prefix. Override only when migrating an existing database with a non-standard prefix. |
| `WORDPRESS_DEBUG` | `false` | Disables debug mode. Set to `true` in development environments only — debug mode may expose sensitive information in HTTP responses. |
| `ENABLE_REDIS` | `true` / `false` | Controlled by `enable_redis`. See the Redis section below. |
| `WP_REDIS_HOST` | *value of `redis_host`* | Injected only when `enable_redis = true`. |
| `WP_REDIS_PORT` | *value of `redis_port`* | Injected only when `enable_redis = true`. |

---

### Database Configuration

The WordPress database is always **MySQL 8.0** (`MYSQL_8_0`), locked in by `Wordpress_Common`. Refer to [App_GKE §3.B Database (Cloud SQL)](../App_GKE/App_GKE.md#b-database-cloud-sql) for documentation on Cloud SQL instance discovery (`sql_instance_name`, `sql_instance_base_name`), `database_password_length`, `enable_auto_password_rotation`, and `rotation_propagation_delay_sec`.

The variables below behave identically to their `App_GKE` counterparts but carry WordPress-appropriate defaults.

| Variable | WordPress Default | App_GKE Default | Description |
|---|---|---|---|
| `database_type` | `"MYSQL_8_0"` *(set by Wordpress_Common)* | `"POSTGRES"` | WordPress requires MySQL. The default is pre-configured by `Wordpress_Common` and should not be changed. Setting this to a non-MySQL type will prevent WordPress from connecting to the database. |
| `application_database_name` | `"wp"` | `"gkeappdb"` | Name of the MySQL database created inside the Cloud SQL instance. Injected into pods as `DB_NAME`. **Do not change after initial deployment** without first migrating the database contents. |
| `application_database_user` | `"wp"` | `"gkeappuser"` | MySQL username created for the WordPress application. Injected into pods as `DB_USER`. The auto-generated password is stored in Secret Manager and injected as `DB_PASSWORD`. |

> **Note:** The variables `enable_postgres_extensions`, `postgres_extensions`, `enable_mysql_plugins`, and `mysql_plugins` are available but have no effect in the default WordPress configuration. `Wordpress_Common` does not enable any MySQL plugins. They are available for advanced use cases where custom MySQL behaviour is needed alongside WordPress.

---

### Jobs & Scheduled Tasks

Refer to [App_GKE §3.E Initialization Jobs & CronJobs](../App_GKE/App_GKE.md#e-initialization-jobs--cronjobs) for documentation on `initialization_jobs`, `cron_jobs`, and `additional_services`.

#### Pre-Configured db-init Job

`Wordpress_Common` automatically defines a `db-init` initialization job. This job runs the `db-init.sh` script using the `mysql:8.0-debian` image and creates the WordPress MySQL database and database user within the Cloud SQL instance if they do not already exist. Key properties:

- **`execute_on_apply = true`** — runs on every `terraform apply`, not only on first deployment.
- **Idempotent** — checks for existing objects before creating them; safe to run repeatedly.
- **Timing** — runs before the WordPress pod is scheduled, ensuring the database and user exist before WordPress attempts to connect.

If you supply custom entries in `initialization_jobs`, they **replace** the default `db-init` job entirely. If your custom jobs still require database setup, include a database initialisation step in your list.

```bash
# List initialization jobs in the namespace
kubectl get jobs -n NAMESPACE -o wide

# View db-init job logs to confirm database creation succeeded
kubectl logs -n NAMESPACE -l job-name=JOB_NAME
```

---

### Redis Object Cache

WordPress uses Redis as a persistent object cache to store the results of expensive database queries in memory, dramatically reducing page load time and database load on high-traffic sites. This module integrates with the **Redis Object Cache** WordPress plugin. The Redis integration is provided by App_GKE — see [§8.A Redis / Memorystore](../App_GKE/App_GKE.md#a-redis--memorystore) for the full integration reference.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `true` | `true` / `false` | When `true`, injects the `ENABLE_REDIS`, `WP_REDIS_HOST`, and `WP_REDIS_PORT` environment variables into the WordPress pods. The container entrypoint script reads these and configures the Redis Object Cache plugin automatically. **Enabling this variable does not provision a Redis server** — the server must exist independently. Leave `redis_host` empty to automatically use the Redis-compatible service co-located on the `Services_GCP`-managed NFS server (the default shared deployment model). Set to `false` to disable object caching entirely; this increases database load on busy sites but removes the Redis dependency. |
| `redis_host` | `""` *(defaults to NFS server IP)* | IP address or hostname | The hostname or IP address of the Redis server, injected as `WP_REDIS_HOST`. Leave blank to fall back to the IP of the `Services_GCP`-managed NFS server (where a Redis-compatible service is typically co-located). Set explicitly when connecting to a dedicated Redis instance such as Cloud Memorystore — use the instance's private IP (found in **Memorystore → Redis → *instance* → Primary endpoint**). The GKE pods reach this address over the VPC — ensure firewall rules permit TCP traffic on `redis_port` from the cluster node subnet. |
| `redis_port` | `"6379"` | Port number as string (e.g. `"6379"`) | TCP port of the Redis server, injected as `WP_REDIS_PORT`. The default `6379` is correct for standard Redis and Cloud Memorystore. Change only if your Redis instance is configured on a non-standard port. |
| `redis_auth` | `""` | Password string *(sensitive)* | Authentication password for the Redis server, injected securely via Secret Manager. Leave empty if the Redis instance does not require authentication. For Cloud Memorystore with AUTH enabled, set this to the auth string shown in **Memorystore → Redis → *instance* → AUTH string**. This value is stored in Secret Manager and never exposed in plaintext in Terraform state or pod environment variable listings. |

#### Validating Redis Configuration

```bash
# Confirm Redis environment variables are injected into a WordPress pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep -E "^(ENABLE_REDIS|WP_REDIS)"

# Test TCP connectivity to the Redis server from within the pod
kubectl exec -n NAMESPACE POD_NAME -- sh -c 'redis-cli -h $WP_REDIS_HOST -p $WP_REDIS_PORT ping'

# Check Redis Object Cache status in WordPress (requires WP-CLI in the container)
kubectl exec -n NAMESPACE POD_NAME -- wp redis status --allow-root
```

---

### Health Checks

Refer to [App_GKE §5 Traffic & Ingress](../App_GKE/App_GKE.md#5-traffic--ingress) for documentation on `startup_probe_config`, `health_check_config`, `uptime_check_config`, and `alert_policies`.

`Wordpress_GKE` exposes two additional internal probe variables (`startup_probe` and `liveness_probe`) that are passed to `Wordpress_Common` and control the probe configuration embedded in the WordPress application configuration object. These have WordPress-specific defaults that are tuned for WordPress's startup behaviour:

| Variable | WordPress Default | App_GKE Default | Rationale |
|---|---|---|---|
| `startup_probe` | `type = "TCP"`, `initial_delay_seconds = 30`, `period_seconds = 15`, `failure_threshold = 20` | N/A *(internal to Wordpress_Common)* | Uses **TCP** rather than HTTP because WordPress may not yet respond to HTTP requests while the database connection is being established on first boot. The high `failure_threshold` (20 × 15s = 300 seconds of grace) accommodates the `db-init` job and WordPress's initialisation phase. **Do not reduce `failure_threshold` below 10** for production deployments — premature startup probe failures cause pod restarts during database initialisation, leading to a restart loop. |
| `liveness_probe` | `type = "HTTP"`, `path = "/wp-admin/install.php"`, `initial_delay_seconds = 300`, `timeout_seconds = 60`, `failure_threshold = 3` | N/A *(internal to Wordpress_Common)* | Uses `/wp-admin/install.php` as the health endpoint. This WordPress-managed page returns HTTP 200 whether WordPress is freshly installed or already configured, making it a reliable liveness indicator that does not depend on an application-specific `/healthz` route. The 300-second initial delay ensures liveness checks do not begin until after the database initialisation job has had time to complete. |

---

## Deployment Prerequisites

Refer to [App_GKE — Deployment Prerequisites & Dependency Analysis](../App_GKE/App_GKE.md#deployment-prerequisites--dependency-analysis) for the complete list of hard prerequisites, silent failure modes, and soft prerequisites.

**WordPress-specific notes:**

- The `db-init` job creates the MySQL database and user automatically on first apply — no manual database setup is required before deployment.
- The eight WordPress security keys and salts are generated and stored in Secret Manager automatically — no pre-existing secrets are needed.
- The GCS uploads bucket (`wp-uploads`) is defined by `Wordpress_Common` and provisioned by `App_GKE` — it does not need to be created manually before deployment.
- Because `execute_on_apply = true` on the `db-init` job, every `terraform apply` will run the database initialisation script. This is intentional and safe; the script is idempotent.

---

## Dependency on `Services_GCP`

Refer to [App_GKE — Dependency on `Services_GCP` for Shared Resources](../App_GKE/App_GKE.md#dependency-on-services_gcp-for-shared-resources) for a full comparison of standalone versus `Services_GCP`-backed deployments.

**WordPress-specific benefit:** when `Services_GCP` provides a shared Cloud SQL instance, the `db-init` job connects to it and creates only the WordPress database and user within the shared instance — eliminating the cost of a dedicated Cloud SQL instance per WordPress site. This is the recommended model for multi-tenant platforms where many independent WordPress deployments share the same GCP project.
