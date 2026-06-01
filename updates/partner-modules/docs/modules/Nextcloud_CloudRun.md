# Nextcloud on Google Cloud Run

This document provides a comprehensive reference for the `modules/Nextcloud_CloudRun` Terraform module. It covers architecture, IAM, configuration variables, Nextcloud-specific behaviours, and operational patterns for deploying Nextcloud on Google Cloud Run (v2).

---

## 1. Module Overview

Nextcloud is the leading self-hosted file sync and collaboration platform, used by 400 million+ users across 100,000+ organisations including governments and healthcare providers seeking GDPR-compliant alternatives to Google Drive and OneDrive. `Nextcloud_CloudRun` is a **wrapper module** built on top of `App_CloudRun`. It uses `App_CloudRun` for all GCP infrastructure provisioning and injects Nextcloud-specific application configuration, database initialisation, and storage configuration via `Nextcloud_Common`.

**Key Capabilities:**
*   **Compute**: Cloud Run v2 (Gen2), Apache/PHP container, 2 vCPU / 4 Gi by default. Scale-to-zero enabled (`min_instance_count = 0`) by default.
*   **Data Persistence**: Cloud SQL **MySQL 8.0** (required; PostgreSQL is not supported). NFS (GCE VM or Filestore) for shared `config/` and `data/` directories. GCS Fuse volumes available for object storage mounts.
*   **Security**: Inherits Cloud Armor WAF, IAP, Binary Authorization, and VPC Service Controls from `App_CloudRun`. Admin password auto-generated and stored in Secret Manager.
*   **Caching**: Redis **enabled by default** (`enable_redis = true`) — `Nextcloud_Common` configures Redis as Nextcloud's distributed cache and file locking backend.
*   **CI/CD**: Cloud Build custom image pipeline by default; Cloud Deploy progressive delivery optional.
*   **Reliability**: Health probes target `/status.php` (Nextcloud's JSON health endpoint) with a generous startup tolerance to allow database initialisation and `occ maintenance:install` to complete on first boot.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `region` | 1 | `string` | `'us-central1'` | GCP region. Used as fallback when network discovery cannot determine the region from existing VPC subnets. |
| `tenant_deployment_id` | 2 | `string` | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `list(string)` | `[]` | Email recipients for monitoring alerts. |
| `resource_labels` | 2 | `map(string)` | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `string` | `'nextcloud'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 3 | `string` | `'Nextcloud'` | Human-readable name shown in the GCP Console. |
| `description` | 3 | `string` | `'Nextcloud self-hosted collaboration and file sharing platform'` | Cloud Run service description. |
| `application_version` | 3 | `string` | `'30'` | Nextcloud image version tag. Increment to deploy a new release. |

**Wrapper architecture:** `Nextcloud_CloudRun` calls `Nextcloud_Common` to build a `config` object containing Nextcloud-specific environment variables, probe configuration, build args (PHP limits), and the default `db-init` job definition. `Nextcloud_CloudRun` merges `NEXTCLOUD_TRUSTED_DOMAINS` from `application_domains` into the environment. Runtime URL variables (`OVERWRITEHOST`, `OVERWRITECLIURL`) are derived at startup by `entrypoint.sh` from the `CLOUDRUN_SERVICE_URL` environment variable injected by `App_CloudRun`. `module_storage_buckets` carries the `nextcloud-data` bucket provisioned by `Nextcloud_Common`. `module_secret_env_vars` carries the admin password secret reference.

**MySQL note:** Nextcloud requires **MySQL 8.0**. `database_type = "MYSQL_8_0"` is fixed by `Nextcloud_Common` and cannot be overridden.

---

## 2. IAM & Access Control

`Nextcloud_CloudRun` delegates all IAM provisioning to `App_CloudRun`. The Cloud Run SA, Cloud Build SA, IAP service agent, and password rotation role sets are identical to those in [App_CloudRun §2](../App_CloudRun/App_CloudRun.md#2-iam--access-control).

**Admin password secret:** `Nextcloud_Common` auto-generates a 24-character alphanumeric admin password and stores it in Secret Manager at `<resource_prefix>-admin-password`. It is injected into the container as `NEXTCLOUD_ADMIN_PASSWORD` and read by Nextcloud's `occ maintenance:install` on first boot.

**Database initialisation identity:** The `db-init` Cloud Run Job runs under the Cloud Run SA. It connects to Cloud SQL MySQL via the Auth Proxy Unix socket (since `enable_cloudsql_volume = true` by default), using `ROOT_PASSWORD` (from Secret Manager) to create the Nextcloud database and user.

**120-second IAM propagation delay:** Inherited from `App_CloudRun` — the Nextcloud service is not deployed until the delay completes, preventing secret-read failures on the first revision start.

For the complete role tables and IAP, password rotation, and public access details, see [App_CloudRun §2](../App_CloudRun/App_CloudRun.md#2-iam--access-control).

---

## 3. Core Service Configuration

### A. Compute (Cloud Run)

Nextcloud is a PHP application that performs database schema migrations and full application installation (`occ maintenance:install`) on first boot. `Nextcloud_CloudRun` exposes `cpu_limit` and `memory_limit` as dedicated top-level variables.

**Scale-to-zero is enabled** (`min_instance_count = 0`) by default. Nextcloud cold starts can take 60–120 seconds on first boot due to database installation. For production deployments set `min_instance_count = 1` to eliminate cold starts. `max_instance_count = 1` by default — increase for higher concurrency.

**Container image:** `container_image_source` defaults to `'custom'`, triggering a Cloud Build pipeline that builds a custom Apache/PHP Nextcloud image from `Nextcloud_Common`'s Dockerfile. PHP settings (`php_memory_limit`, `upload_max_filesize`, `post_max_size`) are baked into the image via Docker `ARG` values at build time. Set `container_image_source = ''` and `container_image = 'nextcloud:30-apache'` to skip the build and deploy the upstream image directly.

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment (SQL, storage, secrets). |
| `container_image_source` | 4 | `'custom'` | `'custom'` builds via Cloud Build (default). `''` deploys an existing image URI. |
| `container_image` | 4 | `""` | Override image URI. Leave empty for Cloud Build to manage the image. |
| `cpu_limit` | 4 | `'2000m'` | CPU per instance. 2 vCPU minimum for reliable Nextcloud operation. |
| `memory_limit` | 4 | `'4Gi'` | Memory per instance. 4 Gi recommended for production with concurrent users. |
| `container_port` | 4 | `80` | Apache HTTP port. Change only if your custom Dockerfile binds to a different port. |
| `container_resources` | 4 | `null` | Structured resource limits. Takes precedence over `cpu_limit`/`memory_limit` when set. |
| `execution_environment` | 4 | `'gen2'` | Gen2 required for NFS mounts and GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Max request duration. Increase for large file uploads. Valid range: 0–3600. |
| `enable_cloudsql_volume` | 4 | `true` | Injects Cloud SQL Auth Proxy sidecar. Required for Unix socket connection to MySQL. |
| `min_instance_count` | 4 | `0` | Minimum instances. Set to 1 to prevent cold starts. |
| `max_instance_count` | 4 | `1` | Maximum instances. Increase for higher concurrency. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |

**Differences from `App_CloudRun` defaults:**

| Variable | `App_CloudRun` | `Nextcloud_CloudRun` | Reason |
|---|---|---|---|
| `container_port` | `8080` | `80` | Nextcloud Apache binds to port 80. |
| `cpu_limit` | `'1000m'` | `'2000m'` | PHP + Apache + file operations benefit from 2 vCPU. |
| `memory_limit` | `'512Mi'` | `'4Gi'` | PHP with large file handling and multiple concurrent users needs significantly more RAM. |
| `enable_cloudsql_volume` | `true` | `true` | Same — Nextcloud connects via Auth Proxy Unix socket (with TCP fallback via DB_IP). |
| `enable_image_mirroring` | `false` | `true` | Nextcloud mirrors its base image to Artifact Registry by default. |

### B. Database (Cloud SQL — MySQL 8.0)

Nextcloud requires **MySQL 8.0** — `Nextcloud_Common` fixes `database_type = "MYSQL_8_0"`. The database must use `utf8mb4` character set and `utf8mb4_general_ci` collation; the `db-init.sh` script enforces this.

The module uses `db_name` and `db_user` in place of the `application_database_name` and `application_database_user` variables in `App_CloudRun`.

**Unix socket connection with TCP fallback:** `enable_cloudsql_volume` defaults to `true`. `App_CloudRun` injects the Auth Proxy sidecar and sets `DB_HOST` to the socket path under `/cloudsql`. The `entrypoint.sh` script detects that `DB_HOST` is a socket path and overrides it with `DB_IP` for TCP — MySQL 8.0's `caching_sha2_password` authentication requires SSL to complete over TCP, which PHP PDO cannot handle without explicit SSL setup; the socket path bypasses this requirement entirely.

| Variable | Group | Default | Description |
|---|---|---|---|
| `db_name` | 12 | `'nextcloud'` | MySQL database name. **Do not change after initial deployment.** |
| `db_user` | 12 | `'nextcloud'` | MySQL application user. Password auto-generated and stored in Secret Manager. |
| `database_password_length` | 12 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Automated zero-downtime password rotation. See §7.D. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after rotation before restarting the service. |

> `database_type`, `enable_postgres_extensions`, and `enable_mysql_plugins` are not exposed — Nextcloud only supports MySQL 8.0, and database setup is managed by `Nextcloud_Common`'s `db-init.sh`. `sql_instance_name` and `sql_instance_base_name` are handled transparently by `App_CloudRun`.

### C. Storage (NFS & GCS)

**NFS is enabled by default** (`enable_nfs = true`). Nextcloud stores `config/` and `data/` on the NFS share so that all Cloud Run instances access a consistent filesystem. The `entrypoint.sh` script automatically:

1. Creates `/mnt/nfs/nextcloud-config` and `/mnt/nfs/nextcloud-data` on the NFS share.
2. Symlinks `/var/www/html/config` → `/mnt/nfs/nextcloud-config` so `config.php` persists across restarts.
3. Sets `NEXTCLOUD_DATA_DIR=/mnt/nfs/nextcloud-data` so uploaded files land on the persistent NFS share rather than the ephemeral container filesystem.

Without NFS, `config.php` is ephemeral: on every pod restart the official entrypoint finds no `config.php`, re-runs `occ maintenance:install`, and fails with "The Login is already being used" because the admin user already exists in the database.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_nfs` | 11 | `true` | Provisions NFS shared storage for Nextcloud config and data. Requires `gen2`. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Container path where the NFS share is mounted. |
| `nfs_instance_name` | 9 | `""` | Name of an existing NFS GCE VM. Leave empty to auto-discover or use inline instance. |
| `nfs_instance_base_name` | 9 | `'app-nfs'` | Base name for an inline NFS GCE VM when none exists. |
| `create_cloud_storage` | 11 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | GCS buckets to provision. Defaults to a single `data` bucket. |
| `gcs_volumes` | 11 | `[]` | GCS buckets to mount via GCS Fuse. Each entry: `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. |
| `manage_storage_kms_iam` | 11 | `false` | Creates a CMEK KMS keyring/key and enables CMEK on all storage buckets. |
| `enable_artifact_registry_cmek` | 11 | `false` | Creates an Artifact Registry KMS key and enables CMEK for container images. |

### D. Nextcloud-Specific Settings

`Nextcloud_CloudRun` exposes four Nextcloud-specific variables (group 23) that control PHP runtime behaviour and admin account creation:

| Variable | Group | Default | Description |
|---|---|---|---|
| `nextcloud_admin_user` | 23 | `'admin'` | Username for the Nextcloud administrator account. Created on first deployment via `NEXTCLOUD_ADMIN_USER`. |
| `php_memory_limit` | 23 | `'512M'` | PHP memory limit. Baked into the container image via Docker `ARG` at build time and also injected as `PHP_MEMORY_LIMIT`. Increase to `1G` or `2G` for heavy usage. |
| `upload_max_filesize` | 23 | `'512M'` | PHP `upload_max_filesize`. Baked into the image and injected as `PHP_UPLOAD_LIMIT`. Increase for large file uploads (e.g. `'5G'`). |
| `post_max_size` | 23 | `'512M'` | PHP `post_max_size`. Should be equal to or greater than `upload_max_filesize`. Baked into the image. |

### E. Networking

Cloud Run uses Direct VPC Egress to reach Cloud SQL's internal IP. Because `enable_cloudsql_volume = true` is the default, the Auth Proxy sidecar handles the Cloud SQL connection.

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — public internet; `'internal'` — VPC only; `'internal-and-cloud-load-balancing'` — forces traffic through the HTTPS Load Balancer. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` routes only RFC 1918 traffic via VPC. `'ALL_TRAFFIC'` routes all egress via VPC. |

> `network_name` is not exposed. The module auto-discovers the `Services_GCP` VPC network.

### F. Initialization & Bootstrap

A `db-init` Cloud Run Job is automatically provisioned by `Nextcloud_Common` when `initialization_jobs` is left as the default empty list (`[]`). It uses the `mysql:8.0-debian` image and executes `Nextcloud_Common/scripts/db-init.sh`, which performs the following idempotent operations:

1. Connects to Cloud SQL MySQL via the Auth Proxy Unix socket (or falls back to TCP via `DB_IP`).
2. Creates the Nextcloud database with `utf8mb4` character set and `utf8mb4_general_ci` collation.
3. Drops and recreates the Nextcloud user with `mysql_native_password` authentication (required for PHP PDO compatibility).
4. Grants all privileges on the database to the user.
5. Verifies the user can connect.
6. Sends a quit signal to the Cloud SQL Auth Proxy sidecar (required for GKE Job completion).

Override `initialization_jobs` with a non-empty list to replace this default with custom jobs.

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | One-shot Cloud Run Jobs. Leave empty for `Nextcloud_Common` to supply the default `db-init` job. Non-empty list replaces it entirely. |
| `cron_jobs` | 13 | `[]` | Recurring jobs triggered by Cloud Scheduler. Each entry: `name`, `schedule` (cron UTC), `image`, `command`, `args`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `task_count`, `parallelism`, `mount_nfs`, `mount_gcs_volumes`, `script_path`, `paused`. |

---

## 4. Advanced Security

### A. Cloud Armor WAF

When `enable_cloud_armor = true`, a Global HTTPS Load Balancer with a Cloud Armor WAF policy (OWASP Top 10, adaptive DDoS, rate limiting) is provisioned in front of Cloud Run.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. Required for custom domains, CDN, and DDoS protection. |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules (e.g., office VPN, CI/CD egress IPs). |

### B. Identity-Aware Proxy (IAP)

When `enable_iap = true`, Cloud Run's native IAP integration is enabled directly on the service. Google identity authentication is required before requests reach Nextcloud.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Enables IAP natively on the Cloud Run service. |
| `iap_authorized_users` | 5 | `[]` | Users/service accounts granted access. Format: `'user:email'` or `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted access. Format: `'group:name@example.com'`. |

### C. Binary Authorization

When `enable_binary_authorization = true`, Cloud Run enforces that deployed images carry a valid cryptographic attestation.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Enforces image attestation. Requires a Binary Authorization policy and attestor pre-configured in the project. |

### D. VPC Service Controls

When `enable_vpc_sc = true`, all GCP API calls from this module are bound within an existing VPC-SC perimeter.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Registers module API calls within the project's VPC-SC perimeter. A perimeter must already exist before enabling. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC network access level. Auto-discovered when empty. |
| `vpc_sc_dry_run` | 22 | `true` | Logs violations without blocking. Set `false` to enforce. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. Auto-discovered from project when empty. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs (DATA_READ, DATA_WRITE, ADMIN_READ). |

### E. Secret Manager Integration

| Variable | Group | Default | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Map of env var name → Secret Manager secret ID. Resolved at runtime; never stored in state. |
| `secret_rotation_period` | 6 | `'2592000s'` | Frequency at which Secret Manager emits rotation notifications. Default: 30 days. |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation before dependent resources proceed. |

**Auto-generated secrets:** `Nextcloud_Common` generates:
- `<resource_prefix>-admin-password` — Nextcloud admin account password. Injected as `NEXTCLOUD_ADMIN_PASSWORD`.

The `DB_PASSWORD` and `ROOT_PASSWORD` secrets are provisioned automatically by `App_CloudRun`.

---

## 5. Traffic & Ingress

### A. HTTPS Load Balancer

When `enable_cloud_armor = true`, a Global HTTPS Load Balancer backed by a Serverless NEG is provisioned. Traffic flows: Internet → Cloud Armor → Global HTTPS LB → Serverless NEG → Cloud Run.

Setting `ingress_settings = 'internal-and-cloud-load-balancing'` forces all Nextcloud traffic through the LB, preventing direct `*.run.app` URL access.

### B. Cloud CDN

When `enable_cdn = true` (requires `enable_cloud_armor = true`), Cloud CDN is attached to the HTTPS Load Balancer backend.

**Nextcloud consideration:** Nextcloud serves a mix of static assets and dynamically authenticated file downloads. CDN works well for static assets (JS, CSS, images). Do not cache authenticated file download responses — ensure Nextcloud's `Cache-Control` headers are respected by the CDN policy.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cdn` | 10 | `false` | Enables Cloud CDN on the HTTPS LB backend. Only effective when `enable_cloud_armor = true`. |
| `max_images_to_retain` | 10 | `7` | Maximum number of recent container images to keep in Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Automatically deletes untagged images from Artifact Registry. |
| `image_retention_days` | 10 | `30` | Days after which images are eligible for deletion. |

### C. Custom Domains & Trusted Domains

Custom domains are attached to the Global HTTPS Load Balancer via `application_domains`. Google-managed SSL certificates are provisioned automatically.

**Nextcloud `NEXTCLOUD_TRUSTED_DOMAINS` behaviour:** `Nextcloud_CloudRun` seeds `NEXTCLOUD_TRUSTED_DOMAINS` from `application_domains`. The `entrypoint.sh` script then **appends** the actual Cloud Run hostname (from `CLOUDRUN_SERVICE_URL`) at runtime. This ensures:

1. The `*.run.app` Cloud Run URL is always trusted, regardless of Terraform-computed values.
2. Custom domains from `application_domains` are also trusted.
3. `OVERWRITEHOST` and `OVERWRITECLIURL` are derived from the runtime `CLOUDRUN_SERVICE_URL` value — not from Terraform-computed strings that could diverge across separate applies.

| Variable | Group | Default | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Custom domain names for the HTTPS LB. Also seeded into `NEXTCLOUD_TRUSTED_DOMAINS`. Google-managed SSL certificates provisioned per domain. |

---

## 6. CI/CD & Delivery

### A. Cloud Build Triggers

When `enable_cicd_trigger = true`, a Cloud Build GitHub connection and push trigger are provisioned. The trigger builds and deploys a custom Nextcloud image when code is pushed to the configured branch.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. Requires `github_repository_url` and credentials. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT (`repo`, `admin:repo_hook`, `workflow` scopes). Required on first apply. Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID (preferred for organisation repos). |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced trigger config: `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### B. Cloud Deploy Pipeline

When `enable_cloud_deploy = true` (requires `enable_cicd_trigger = true`), the CI/CD pipeline is upgraded to a managed Cloud Deploy delivery pipeline.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy pipeline. Requires `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Ordered promotion stages. Each: `name`, `target_name`, `service_name`, `require_approval`, `auto_promote`. |

---

## 7. Reliability & Scheduling

### A. Health Probes & Uptime Monitoring

Nextcloud exposes `/status.php` as its canonical health endpoint. It returns a JSON object such as `{"installed":true,"maintenance":false,"needsDbUpgrade":false}` with HTTP 200. This endpoint returns 200 even during the installation phase, making it safe for startup probe use.

**First-boot consideration:** `occ maintenance:install` runs synchronously before Apache starts. On a cold Cloud SQL instance this can take several minutes. The startup probe defaults to a 60-second initial delay with 20 failure thresholds at 15-second intervals — providing a total startup tolerance of 360 seconds (60s + 20×15s = 360s) for the first installation.

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ enabled=true, type="HTTP", path="/status.php", initial_delay_seconds=60, timeout_seconds=10, period_seconds=15, failure_threshold=20 }` | Startup readiness probe. Container receives no traffic until this succeeds. |
| `liveness_probe` | 14 | `{ enabled=true, type="HTTP", path="/status.php", initial_delay_seconds=120, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` | Liveness probe. Container restarted after `failure_threshold` consecutive failures. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/" }` | Cloud Monitoring uptime check. Alerts notify `support_users` if unreachable. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. Each: `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`. |

### B. Auto Password Rotation

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Enables automated password rotation via Eventarc. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after writing the new secret before restarting the service. |
| `secret_rotation_period` | 6 | `'2592000s'` | Rotation frequency. Default: 30 days. |

---

## 8. Integrations

### A. Redis Cache

Redis is **enabled by default** (`enable_redis = true`). `Nextcloud_Common` configures the `REDIS_HOST` and `REDIS_HOST_PORT` environment variables, which Nextcloud uses for its APCu-backed distributed cache and file locking backend.

When `enable_redis = true` and `redis_host` is not provided, `REDIS_HOST` is set to `$(REDIS_HOST)` — a runtime sentinel resolved by `App_CloudRun` to the NFS server IP (where a lightweight Redis instance runs co-located). For production deployments, set `redis_host` to a dedicated Google Cloud Memorystore for Redis instance.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 21 | `true` | **Enabled by default.** Redis for Nextcloud caching and file locking. |
| `redis_host` | 21 | `""` | Redis hostname/IP. Leave blank to use the NFS server IP via `$(REDIS_HOST)` sentinel. |
| `redis_port` | 21 | `'6379'` | Redis TCP port (string). |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive — never stored in state. |

### B. Environment Variables

Nextcloud's application configuration is driven entirely by environment variables (injected by `entrypoint.sh` into the official Nextcloud entrypoint). Key variables set by `Nextcloud_Common`:

| Variable | Source | Description |
|---|---|---|
| `NEXTCLOUD_ADMIN_USER` | `nextcloud_admin_user` | Admin username for first-install bootstrap. |
| `NEXTCLOUD_ADMIN_PASSWORD` | Secret Manager | Admin password (via `NEXTCLOUD_ADMIN_PASSWORD` secret ref). |
| `PHP_MEMORY_LIMIT` | `php_memory_limit` | Passed to Apache/PHP-FPM at runtime. |
| `PHP_UPLOAD_LIMIT` | `upload_max_filesize` | Sets both `upload_max_filesize` and `post_max_size` in php.ini. |
| `NEXTCLOUD_UPDATE` | `"1"` | Enables automatic Nextcloud updates on restart. |
| `OVERWRITEPROTOCOL` | `"https"` | Forces Nextcloud to generate `https://` URLs. |
| `MYSQL_HOST` | Derived at runtime | Set by `entrypoint.sh` from `DB_IP` (TCP preferred over Unix socket for PHP PDO). |
| `MYSQL_USER` | Derived at runtime | Set from `DB_USER` by `entrypoint.sh`. |
| `MYSQL_DATABASE` | Derived at runtime | Set from `DB_NAME` by `entrypoint.sh`. |
| `MYSQL_PASSWORD` | Derived at runtime | Set from `DB_PASSWORD` (injected via Secret Manager ref). |
| `OVERWRITEHOST` | Derived at runtime | Set from `CLOUDRUN_SERVICE_URL` by `entrypoint.sh`. |
| `OVERWRITECLIURL` | Derived at runtime | Set from `CLOUDRUN_SERVICE_URL` by `entrypoint.sh`. |
| `NEXTCLOUD_TRUSTED_DOMAINS` | Merged at runtime | Custom domains from `application_domains` + Cloud Run hostname from `CLOUDRUN_SERVICE_URL`. |
| `REDIS_HOST` | `redis_host` or `$(REDIS_HOST)` | Redis hostname for caching backend. |
| `REDIS_HOST_PORT` | `redis_port` | Redis TCP port. |

Use `environment_variables` to add additional plain-text configuration, and `secret_environment_variables` for sensitive values:

| Variable | Group | Default | Description |
|---|---|---|---|
| `environment_variables` | 6 | `{}` | Plain-text env vars. Do not duplicate variables set by `Nextcloud_Common`. |
| `secret_environment_variables` | 6 | `{}` | Secret Manager references. Use for SMTP passwords and other sensitive values. |

### C. Backup Import & Recovery

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated daily backups. |
| `backup_retention_days` | 7 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 7 | `false` | Triggers a one-time restore on apply. Set `false` after a successful import. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (full GCS URI) or `'gdrive'` (Drive file ID). |
| `backup_uri` | 7 | `""` | Full GCS URI (e.g., `'gs://my-bucket/nextcloud-2024-01.sql'`) or Google Drive file ID. |
| `backup_format` | 7 | `'sql'` | Backup file format. Options: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

> **Warning:** If the database already contains data, the import may produce errors. Test in a non-production environment before importing into production.

### D. Custom SQL Scripts

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_custom_sql_scripts` | 9 | `false` | Runs SQL scripts from GCS after provisioning. |
| `custom_sql_scripts_bucket` | 9 | `""` | GCS bucket containing SQL scripts. |
| `custom_sql_scripts_path` | 9 | `""` | Path prefix within the bucket. Scripts run in lexicographic order. |
| `custom_sql_scripts_use_root` | 9 | `false` | Run scripts as the root DB user. |

---

## 9. Platform-Managed Behaviours

The following behaviours are applied automatically by `Nextcloud_CloudRun` regardless of variable values. They cannot be overridden via `tfvars`.

| Behaviour | Implementation | Detail |
|---|---|---|
| **MySQL 8.0 required** | `database_type = "MYSQL_8_0"` fixed by `Nextcloud_Common` | Nextcloud requires MySQL. PostgreSQL is not supported. |
| **Admin password auto-generated** | `Nextcloud_Common` creates `<prefix>-admin-password` secret | 24-character alphanumeric password stored in Secret Manager. Injected as `NEXTCLOUD_ADMIN_PASSWORD`. |
| **PHP limits baked at build time** | `php_memory_limit`, `upload_max_filesize`, `post_max_size` passed as Docker `ARG` | Dockerfile applies them via `RUN echo "memory_limit=..."` into `php.ini`. Also injected as env vars at runtime. |
| **NFS config symlink** | `entrypoint.sh` symlinks `/var/www/html/config` → `/mnt/nfs/nextcloud-config` | Prevents `occ maintenance:install` from re-running on every restart. Applied only when NFS is mounted at `/mnt/nfs`. |
| **Runtime URL discovery** | `entrypoint.sh` reads `CLOUDRUN_SERVICE_URL` | `OVERWRITEHOST` and `OVERWRITECLIURL` are set at container startup, not at Terraform apply time. Avoids broken URLs when `resource_prefix` diverges across separate applies. |
| **Trusted domains auto-append** | `entrypoint.sh` appends Cloud Run hostname to `NEXTCLOUD_TRUSTED_DOMAINS` | Custom domains from `application_domains` are seeded by Terraform; the actual Cloud Run hostname is always appended at runtime regardless. |
| **DB_HOST socket-to-IP override** | `entrypoint.sh` overrides socket path with `DB_IP` | MySQL 8.0's `caching_sha2_password` requires SSL over TCP; PHP PDO cannot complete the handshake without SSL configuration. The Unix socket bypasses this. `entrypoint.sh` prefers `DB_IP` for TCP. |
| **Database bootstrap fallback** | `entrypoint.sh` uses `ROOT_PASSWORD` if user credentials fail | If the `db-init` job has not run or failed, `entrypoint.sh` attempts database/user creation inline using root credentials via the Unix socket. |
| **NFS enabled by default** | `enable_nfs = true` default | NFS shared storage is provisioned for Nextcloud config and data persistence. Requires `gen2`. |
| **Redis enabled by default** | `enable_redis = true` default | Nextcloud's distributed cache and file locking backend. When `redis_host` is blank, the `$(REDIS_HOST)` sentinel resolves to the NFS server IP at deploy time. |
| **Default db-init job** | Supplied by `Nextcloud_Common` when `initialization_jobs = []` | MySQL database and user are created automatically with utf8mb4. Override with a non-empty `initialization_jobs` list to replace. |

**Inline infrastructure** (when no `Services_GCP` stack is present) is identical to `App_CloudRun` §9 — `App_CloudRun` provisions an inline VPC, Cloud NAT, Cloud SQL instance, service accounts, and GCP APIs as required.

---

## 10. Variable Reference

All user-configurable variables exposed by `Nextcloud_CloudRun`, sorted by UI group then order.

| Variable | Group | Default | Description |
|---|---|---|---|
| `module_description` | 0 | (Nextcloud platform text) | Platform metadata: module description. |
| `module_documentation` | 0 | `'https://docs.radmodules.dev/docs/modules/Nextcloud_CloudRun'` | Platform metadata: documentation URL. |
| `module_dependency` | 0 | `['Services_GCP']` | Platform metadata: required modules. |
| `module_services` | 0 | (GCP service list) | Platform metadata: GCP services consumed. |
| `credit_cost` | 0 | `50` | Platform metadata: deployment credit cost. |
| `require_credit_purchases` | 0 | `false` | Platform metadata: enforces credit balance check. |
| `enable_purge` | 0 | `true` | Permits full deletion of module resources on destroy. |
| `public_access` | 0 | `false` | Platform catalogue visibility. |
| `shared_users` | 0 | `[]` | Users who can access the module regardless of `public_access`. Actively enforced by the platform. |
| `deployment_id` | 0 | `""` | Deployment ID suffix. Auto-generated if empty. |
| `resource_creator_identity` | 0 | (platform SA) | Service account used by Terraform to manage resources. |
| `impersonation_service_account` | 0 | `""` | SA to impersonate for shell scripts. Leave empty to use runner credentials. |
| `project_id` | 1 | — | GCP project ID. **Required.** |
| `region` | 1 | `'us-central1'` | GCP region for resource deployment. |
| `tenant_deployment_id` | 2 | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `[]` | Email addresses for monitoring alerts. |
| `resource_labels` | 2 | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `'nextcloud'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 3 | `'Nextcloud'` | Human-readable name. |
| `description` | 3 | `'Nextcloud self-hosted collaboration and file sharing platform'` | Service description. |
| `application_version` | 3 | `'30'` | Nextcloud container image tag. |
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 4 | `'custom'` | `'custom'` (Cloud Build) or `''` (existing image). |
| `container_image` | 4 | `""` | Container image URI. Leave empty for Cloud Build to manage. |
| `cpu_limit` | 4 | `'2000m'` | CPU per instance. 2 vCPU minimum for Nextcloud. |
| `memory_limit` | 4 | `'4Gi'` | Memory per instance. 4 Gi recommended for production. |
| `container_port` | 4 | `80` | Apache HTTP port. |
| `container_resources` | 4 | `null` | Structured resource limits. Overrides `cpu_limit`/`memory_limit` when set. |
| `execution_environment` | 4 | `'gen2'` | Gen2 required for NFS mounts and GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Max request duration. Increase for large file uploads. |
| `enable_cloudsql_volume` | 4 | `true` | Injects Cloud SQL Auth Proxy sidecar. |
| `min_instance_count` | 4 | `0` | Minimum instances. Set 1 to eliminate cold starts. |
| `max_instance_count` | 4 | `1` | Maximum instances. |
| `enable_image_mirroring` | 4 | `true` | Mirrors Nextcloud image into Artifact Registry. |
| `traffic_split` | 4 | `[]` | Canary/blue-green traffic allocation. All entries must sum to 100. |
| `max_revisions_to_retain` | 4 | `7` | Maximum Cloud Run revisions to keep. |
| `container_protocol` | 4 | `'http1'` | `'http1'` or `'h2c'`. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Container path for the Auth Proxy Unix socket. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'`, or `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` or `'ALL_TRAFFIC'`. |
| `enable_iap` | 5 | `false` | Enables IAP natively on the Cloud Run service. |
| `iap_authorized_users` | 5 | `[]` | Users/SAs granted IAP access. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted IAP access. |
| `environment_variables` | 6 | `{}` | Plain-text env vars. |
| `secret_environment_variables` | 6 | `{}` | Secret Manager references. |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation. |
| `secret_rotation_period` | 6 | `'2592000s'` | Secret Manager rotation notification frequency. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated backups. |
| `backup_retention_days` | 7 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 7 | `false` | Triggers a one-time restore on apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (full URI) or `'gdrive'` (file ID). |
| `backup_uri` | 7 | `""` | Full GCS URI or Google Drive file ID. |
| `backup_format` | 7 | `'sql'` | Backup format. Options: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT. Required on first apply. Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger config. |
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy progressive delivery pipeline. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Ordered Cloud Deploy promotion stages. |
| `enable_binary_authorization` | 8 | `false` | Enforces image attestation on deployment. |
| `enable_custom_sql_scripts` | 9 | `false` | Runs SQL scripts from GCS after provisioning. |
| `custom_sql_scripts_bucket` | 9 | `""` | GCS bucket containing SQL scripts. |
| `custom_sql_scripts_path` | 9 | `""` | Path prefix within the bucket. |
| `custom_sql_scripts_use_root` | 9 | `false` | Run scripts as the root DB user. |
| `nfs_instance_name` | 9 | `""` | Name of an existing NFS GCE VM. Leave empty to auto-discover. |
| `nfs_instance_base_name` | 9 | `'app-nfs'` | Base name for inline NFS VM. Deployment ID is appended. |
| `enable_cloud_armor` | 10 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | 10 | `[]` | Custom domains with Google-managed SSL certificates. Also seeded into `NEXTCLOUD_TRUSTED_DOMAINS`. |
| `enable_cdn` | 10 | `false` | Enables Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` | 10 | `7` | Maximum recent container images to keep in Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Automatically deletes untagged images from Artifact Registry. |
| `image_retention_days` | 10 | `30` | Days after which images are eligible for deletion. |
| `create_cloud_storage` | 11 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | GCS buckets to provision. |
| `enable_nfs` | 11 | `true` | Provisions NFS shared storage. Requires `gen2`. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Container path where NFS is mounted. |
| `gcs_volumes` | 11 | `[]` | GCS buckets to mount via GCS Fuse. |
| `manage_storage_kms_iam` | 11 | `false` | Creates CMEK KMS key and enables CMEK on all storage buckets. |
| `enable_artifact_registry_cmek` | 11 | `false` | Creates Artifact Registry KMS key for CMEK image encryption. |
| `db_name` | 12 | `'nextcloud'` | MySQL database name. Do not change after initial deployment. |
| `db_user` | 12 | `'nextcloud'` | MySQL application user. |
| `database_password_length` | 12 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after rotation before restarting the service. |
| `db_host_env_var_name` | 12 | `""` | Additional env var name for DB host. Leave empty for `DB_HOST` only. |
| `db_user_env_var_name` | 12 | `""` | Additional env var name for DB user. |
| `db_name_env_var_name` | 12 | `""` | Additional env var name for DB name. |
| `db_port_env_var_name` | 12 | `""` | Additional env var name for DB port. |
| `service_url_env_var_name` | 12 | `""` | Additional env var name for service URL. |
| `initialization_jobs` | 13 | `[]` | One-shot Cloud Run Jobs. Leave empty for `Nextcloud_Common` to supply the default `db-init` job. |
| `cron_jobs` | 13 | `[]` | Recurring scheduled Cloud Run Jobs via Cloud Scheduler. |
| `startup_probe` | 14 | `{ path="/status.php", initial_delay_seconds=60, failure_threshold=20, ... }` | Startup probe. Long tolerance for first-boot `occ maintenance:install`. |
| `liveness_probe` | 14 | `{ path="/status.php", initial_delay_seconds=120, failure_threshold=3, ... }` | Liveness probe. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |
| `enable_redis` | 21 | `true` | **Enabled by default.** Redis for Nextcloud caching and file locking. |
| `redis_host` | 21 | `""` | Redis hostname/IP. Defaults to NFS server IP when empty. |
| `redis_port` | 21 | `'6379'` | Redis TCP port (string). |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive. |
| `enable_vpc_sc` | 22 | `false` | Registers API calls within the project's VPC-SC perimeter. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC network access level. Auto-discovered when empty. |
| `vpc_sc_dry_run` | 22 | `true` | Logs VPC-SC violations without blocking. Set `false` to enforce. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. Auto-discovered when empty. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs. |
| `nextcloud_admin_user` | 23 | `'admin'` | Nextcloud administrator account username. |
| `php_memory_limit` | 23 | `'512M'` | PHP memory limit. Baked into image and injected at runtime. |
| `upload_max_filesize` | 23 | `'512M'` | PHP `upload_max_filesize`. Baked into image. Increase for large uploads (e.g. `'5G'`). |
| `post_max_size` | 23 | `'512M'` | PHP `post_max_size`. Must be ≥ `upload_max_filesize`. Baked into image. |

---

## 11. Outputs

| Output | Description |
|---|---|
| `service_name` | Name of the Cloud Run service. |
| `service_url` | Public URL of the Cloud Run service. |
| `service_location` | GCP region where the Cloud Run service is deployed. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix used in resource names. |
| `database_instance_name` | Name of the Cloud SQL MySQL instance. |
| `database_name` | Name of the application database. |
| `database_user` | Name of the application database user. |
| `database_password_secret` | Secret Manager secret name for the database password. |
| `storage_buckets` | Created GCS storage buckets. |
| `nfs_server_ip` | NFS server internal IP *(sensitive)*. |
| `nfs_mount_path` | NFS mount path inside containers. |
| `container_image` | Container image used for the deployment. |
| `cicd_enabled` | Whether the CI/CD pipeline is enabled. |
| `github_repository_url` | GitHub repository URL connected for CI/CD. |

---

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `NEXTCLOUD_TRUSTED_DOMAINS` (via `application_domains`) | Auto-populated from `application_domains` + Cloud Run hostname | **Critical** | Nextcloud enforces a trusted domain whitelist. Any domain not in this list receives a "Access through untrusted domain" error and the application is unusable. When adding a custom domain or load balancer, add it to `application_domains`. The `entrypoint.sh` appends the Cloud Run service hostname automatically at runtime. |
| `database_type` | `"MYSQL_8_0"` | **Critical** | Nextcloud requires MySQL. `Nextcloud_Common` hardcodes `database_type = "MYSQL_8_0"`. Changing to PostgreSQL breaks the database initialization job and the application will not start. |
| `db_name` | `"nextcloud"` | **Critical** | Changing after initial deployment orphans the existing database. Nextcloud will connect to a new empty database. All files, users, calendar data, and configuration are lost from the application's perspective (they remain in the old database but are unreachable). |
| `db_user` | `"nextcloud"` | **High** | Changing after initial deployment creates a new user without ownership of existing Nextcloud tables. All database operations fail with permission errors. |
| `enable_cloudsql_volume` | `true` | **Critical** | Nextcloud connects to Cloud SQL MySQL via the Auth Proxy Unix socket. Disabling this removes the socket path, causing all database connections to fail immediately on startup. |
| `container_port` | `80` | **Critical** | `Nextcloud_Common` sets `container_port = 80` (the Apache web server default). Changing to any other port causes Cloud Run health checks and traffic routing to fail — the container starts but receives no traffic. |
| `OVERWRITEPROTOCOL` (in `environment_variables`) | `"https"` | **High** | Nextcloud generates all file share links, calendar URLs, and WebDAV endpoints using this protocol. Setting to `"http"` causes mixed-content browser warnings and WebDAV clients may reject insecure connections. Cloud Run always serves HTTPS externally — keep as `"https"`. |
| `php_memory_limit` | `"512M"` | **Medium** | PHP memory limit controls per-request memory. For large file operations, album generation, or Office document editing, `512M` may be insufficient. Increase to `1G` or `2G` for file-heavy workloads. This value is baked into the container image at build time — changing it requires a new Cloud Build run. |
| `upload_max_filesize` | `"512M"` | **High** | Files larger than this limit cannot be uploaded through the web interface. This value is also baked into the container image at build time. For organizations uploading large videos or archives, increase to `5G` or `10G` and ensure `post_max_size` matches or exceeds it. |
| `post_max_size` | `"512M"` | **High** | PHP's POST body limit. Must be equal to or greater than `upload_max_filesize`. If `post_max_size < upload_max_filesize`, PHP silently drops the upload body and Nextcloud receives an empty file. Always set `post_max_size >= upload_max_filesize`. |
| `enable_redis` | `false` | **Medium** | Without Redis, Nextcloud uses a file-based locking mechanism (`FileLocking`) and local APCu cache. With multiple instances or scale-to-zero, file locks become stale and cause 503 "File is locked" errors during concurrent operations. Enable Redis (`REDIS_HOST` and `REDIS_HOST_PORT`) for multi-instance or production deployments. |
| `redis_host` | `""` | **High** | When `enable_redis = true` and `redis_host` is empty, `Nextcloud_Common` injects `REDIS_HOST = "$(REDIS_HOST)"` literally (unresolved shell variable), causing Nextcloud to fail to connect to Redis at runtime. Always provide a valid hostname or IP when enabling Redis. |
| `min_instance_count` | `0` | **High** | Scale-to-zero means Nextcloud cold-starts on every request after idle. Nextcloud's PHP startup includes autoloader initialization and database connection establishment — cold starts are 15–30 seconds. For production use, set `min_instance_count = 1`. |
| `enable_nfs` | `false` | **High** | Without NFS, all Nextcloud data (uploaded files, app data, config) is stored in the container's ephemeral filesystem. Files are permanently lost on container restart or new revision deployment. NFS is required for any Nextcloud deployment that stores files. |
| `nfs_mount_path` | `"/mnt/nfs"` | **High** | Nextcloud must be configured to use this path as its data directory via `NEXTCLOUD_DATA_DIR`. A mismatch causes Nextcloud to write to the ephemeral container filesystem while the NFS mount is idle. |
| `max_instance_count` | `1` | **Medium** | Nextcloud with multiple instances requires Redis for distributed file locking and shared session storage. Running multiple instances without Redis causes severe data integrity issues — concurrent writes to the same file can corrupt it. Never increase above `1` without enabling Redis and NFS. |
| `nextcloud_admin_user` | `"admin"` | **Medium** | The default admin username `"admin"` is a common brute-force target. Change to a less guessable username for public-facing deployments. This is only applied on first installation — changing after deployment has no effect. |
| `NEXTCLOUD_ADMIN_PASSWORD` (auto-generated secret) | Auto-generated, stored in Secret Manager | **High** | The admin password is auto-generated at first deploy and stored in Secret Manager. If the secret is deleted or rotated without updating Nextcloud's database, the admin account password becomes unknown and recovery requires database access. |
| `memory_limit` (container) | `"1Gi"` | **Medium** | Nextcloud's PHP process and the Apache web server together require adequate memory. Below `512Mi`, PHP processes are killed under load. For workloads with Office integration or video thumbnailing, use `2Gi` or more. |
| `cpu_limit` | `"1000m"` | **Medium** | File scanning, thumbnail generation, and Office document operations are CPU-intensive. Below `500m`, these background tasks cause visible slowness in the web interface. Use `2000m` for production. |
| `ingress_settings` | `"all"` | **Medium** | Nextcloud is often used as an internal file store. Restrict to `"internal"` or `"internal-and-cloud-load-balancing"` for non-public deployments. Exposing Nextcloud to the full internet requires strong password policies and rate limiting. |
| `enable_backup_import` | `false` | **High** | Setting to `true` triggers a database import on every `tofu apply`. If `backup_uri` is not a controlled snapshot, subsequent applies overwrite the live Nextcloud database. Only enable for the initial restore, then set back to `false`. |
| `application_version` | e.g., `"28"` | **Medium** | Using `"latest"` causes each Cloud Build run to potentially use a different Nextcloud version, making rollbacks difficult and introducing unplanned major version upgrades. Pin to a specific version tag. |
| `NEXTCLOUD_UPDATE` (in `environment_variables`) | `"1"` | **Low** | `Nextcloud_Common` sets `NEXTCLOUD_UPDATE = "1"`, which auto-runs `occ upgrade` on container startup. This is intentional for automatic minor updates. Set to `"0"` to disable auto-upgrade and manage upgrades manually. |

---

## Destroying Resources

### Known Deletion Issue: Serverless IPv4 Address Release

When destroying a Cloud Run deployment, you may encounter an error similar to:

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause:** GCP holds serverless IPv4 addresses on the VPC subnet asynchronously after a Cloud Run service is deleted. These addresses are released by GCP approximately **20–30 minutes** after the Cloud Run service is removed.

**Resolution:** Wait 20–30 minutes after the initial destroy attempt, then re-run:

```bash
tofu destroy
```
