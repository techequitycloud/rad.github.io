# Django on Google Cloud Run

This document provides a comprehensive reference for the `modules/Django_CloudRun` Terraform module. It covers architecture, IAM, configuration variables, Django-specific behaviours, and operational patterns for deploying Django on Google Cloud Run (v2).

---

## 1. Module Overview

Django is a high-level Python web framework that encourages rapid development and clean, pragmatic design. `Django_CloudRun` is a **wrapper module** built on top of `App_CloudRun`. It uses `App_CloudRun` for all GCP infrastructure provisioning and injects Django-specific application configuration, secrets, database initialisation, and storage configuration via `Django_Common`.

**Key Capabilities:**
*   **Compute**: Cloud Run v2 (Gen2), Python container, scale-to-zero by default (`min_instance_count = 0`). Custom image build via Cloud Build is the default workflow.
*   **Data Persistence**: Cloud SQL PostgreSQL with Cloud SQL Auth Proxy sidecar (`enable_cloudsql_volume = true` by default). The `db-init.sh` script auto-detects whether to use a Unix socket or the proxy at `127.0.0.1`. NFS (GCE VM or Filestore) for shared media files. GCS media bucket provisioned automatically by `Django_Common`.
*   **Security**: `SECRET_KEY` auto-generated and stored in Secret Manager. Inherits Cloud Armor WAF, IAP, Binary Authorization, and VPC Service Controls from `App_CloudRun`.
*   **Caching**: Redis disabled by default — set `enable_redis = true` to inject `REDIS_HOST` and `REDIS_PORT` as environment variables.
*   **CI/CD**: Cloud Build custom image pipeline by default; Cloud Deploy progressive delivery optional.
*   **Reliability**: Dual probe system — `startup_probe`/`liveness_probe` for `Django_Common` and `startup_probe_config`/`health_check_config` for Cloud Run infrastructure, all targeting `/healthz`.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 1 | `string` | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 1 | `list(string)` | `[]` | Email recipients for monitoring alerts. |
| `resource_labels` | 1 | `map(string)` | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 2 | `string` | `'django'` | Base resource name. Do not change after initial deployment. |
| `application_display_name` | 2 | `string` | `'Django Application'` | Human-readable name shown in the GCP Console. |
| `application_description` | 2 | `string` | `'Django Application - High-level Python Web framework'` | Cloud Run service description. |
| `application_version` | 2 | `string` | `'latest'` | Container image version tag. Increment to deploy a new release. |

**Wrapper architecture:** `Django_CloudRun` calls `Django_Common` to build an `application_config` object containing Django environment variables, the `SECRET_KEY` secret, database initialisation, probe configuration, and the media GCS bucket definition. `module_env_vars` carries `REDIS_HOST`/`REDIS_PORT` when `enable_redis = true`. `module_secret_env_vars` carries `Django_Common`-generated secret IDs. `module_storage_buckets` carries the media bucket provisioned by `Django_Common`. `scripts_dir` is resolved to `Django_Common/scripts`.

**Django naming note:** Unlike `Cyclos_CloudRun` and `Directus_CloudRun`, which use `display_name`/`description` aliases, `Django_CloudRun` uses `application_display_name` and `application_description` directly — these are the native `App_CloudRun` variable names with no aliasing required.

---

## 2. IAM & Access Control

`Django_CloudRun` delegates all IAM provisioning to `App_CloudRun`. The Cloud Run SA, Cloud Build SA, IAP service agent, and password rotation role sets are identical to those in [App_CloudRun §2](../App_CloudRun/App_CloudRun.md#2-iam--access-control).

**Django auto-generated secrets and IAM:** `Django_Common` creates one Secret Manager secret during provisioning: `SECRET_KEY`. This is injected into the Cloud Run revision via `module_secret_env_vars`. The Cloud Run SA requires `roles/secretmanager.secretAccessor`, which is already granted by `App_CloudRun`. The `DB_PASSWORD` and `ROOT_PASSWORD` secrets are provisioned automatically by `App_CloudRun`.

**Database initialisation identity:** The `db-init` Cloud Run Job runs under the Cloud Run SA. It connects to Cloud SQL via the Auth Proxy sidecar (since `enable_cloudsql_volume = true` by default). The `db-init.sh` script auto-detects the connection mode at runtime — using either the socket path (under `/cloudsql`) or the proxy at `127.0.0.1` — along with `DB_USER` and `ROOT_PASSWORD` (from Secret Manager).

**GCS media bucket IAM:** `Django_Common` provisions a GCS media bucket and grants the application SA `roles/storage.objectAdmin` and `roles/storage.legacyBucketReader`. The Django container runs as non-root UID `2000`, which is mapped to the GCS Fuse user to ensure write access on GCS-mounted paths.

**120-second IAM propagation delay:** Inherited from `App_CloudRun` — the Django service is not deployed until the delay completes, preventing secret-read failures on the first revision start.

For the complete role tables and IAP, password rotation, and public access details, see [App_CloudRun §2](../App_CloudRun/App_CloudRun.md#2-iam--access-control).

---

## 3. Core Service Configuration

### A. Compute (Cloud Run)

Django is a Python application. The default resource limits (`cpu_limit = "1000m"`, `memory_limit = "512Mi"`) are suitable for low-traffic or development deployments. Production workloads handling concurrent requests or large media processing should increase these values. Unlike `Cyclos_CloudRun` and `Directus_CloudRun`, which expose `cpu_limit` and `memory_limit` as separate top-level variables, `Django_CloudRun` uses a single `container_resources` object.

**Scale-to-zero is enabled by default** (`min_instance_count = 0`). Django does not maintain in-process state between requests when Redis-backed sessions are used, making cold starts acceptable.

**Startup CPU Boost** is always enabled (hardcoded in `App_CloudRun`).

**Container image:** `container_image_source` defaults to `'custom'`, meaning Cloud Build compiles a custom image using `Django_Common`'s Dockerfile. Set `container_image_source = 'prebuilt'` and `container_image` to an existing image URI to skip the build.

**Cloud SQL Auth Proxy:** `enable_cloudsql_volume` defaults to `true`. The Cloud SQL Auth Proxy sidecar is injected. The `db-init.sh` script detects the connection type at runtime: if `DB_HOST` is a Unix socket path it connects directly; if `DB_SSL=false` and `DB_HOST` is a private IP it routes through the proxy at `127.0.0.1`. This differs from `Directus_CloudRun` and `Cyclos_CloudRun`, which default to TCP.

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 3 | `true` | Set `false` for infrastructure-only deployment (SQL, storage, secrets). |
| `container_image_source` | 3 | `'custom'` | `'custom'` builds via Cloud Build. `'prebuilt'` deploys an existing image URI. |
| `container_image` | 3 | `'us-docker.pkg.dev/cloudrun/container/hello'` | Override image URI. Defaults to the Cloud Run hello container for initial provisioning. |
| `container_build_config` | 3 | `{ enabled = true }` | Cloud Build configuration used when `container_image_source = 'custom'`. |
| `container_resources` | 3 | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | CPU and memory limits per instance. Use `cpu_limit` and `memory_limit` sub-fields. Optional `cpu_request` and `mem_request` for guaranteed minimums. |
| `min_instance_count` | 3 | `0` | `0` enables scale-to-zero. Set `≥1` to eliminate cold starts. |
| `max_instance_count` | 3 | `1` | Increase for high-traffic deployments. |
| `container_port` | 3 | `8080` | Django default port. Change only if your WSGI/ASGI server binds to a different port. |
| `execution_environment` | 3 | `'gen2'` | Gen2 required for NFS mounts and GCS Fuse. |
| `timeout_seconds` | 3 | `300` | Max request duration. Increase for long-running operations such as report generation or file processing. |
| `enable_cloudsql_volume` | 3 | `true` | `true` — injects Cloud SQL Auth Proxy sidecar. `db-init.sh` auto-detects whether to connect via Unix socket or proxy at `127.0.0.1`. |
| `cloudsql_volume_mount_path` | 3 | `'/cloudsql'` | Base path for the Auth Proxy Unix socket mount. Used when Django connects via the socket path. |
| `traffic_split` | 3 | `[]` | Percentage-based canary/blue-green traffic allocation. See §7.B. |
| `service_annotations` | 3 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 3 | `{}` | Labels applied to the Cloud Run service. |

**Differences from `App_CloudRun` defaults:**

| Variable | `App_CloudRun` | `Django_CloudRun` | Reason |
|---|---|---|---|
| `container_image` | `""` | `'us-docker.pkg.dev/cloudrun/container/hello'` | Placeholder image for initial provisioning before a custom image is built. |
| `enable_cloudsql_volume` | `true` | `true` | Same — Auth Proxy sidecar injected by default; connection mode (socket or `127.0.0.1`) detected at runtime by `db-init.sh`. |
| `container_resources` | object `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | same | `Django_CloudRun` uses the native object; no `cpu_limit`/`memory_limit` top-level aliases. |

### B. Database (Cloud SQL — PostgreSQL)

Django requires **PostgreSQL** — `Django_Common` hardcodes `DB_ENGINE = "django.db.backends.postgresql"`. MySQL, SQL Server, and `database_type = 'NONE'` are unsupported.

`Django_CloudRun` uses `application_database_name` and `application_database_user` — the native `App_CloudRun` variable names. Unlike `Cyclos_CloudRun` and `Directus_CloudRun`, which use `db_name`/`db_user` aliases, no aliasing is needed here.

**Connection mode:** `enable_cloudsql_volume = true` (default). When enabled, `db-init.sh` detects the connection type: if `DB_SSL=false` and `DB_HOST` is not a Unix socket, it routes traffic through the Auth Proxy at `127.0.0.1`. The environment variable `DB_HOST` is set either to the socket path (e.g., `/cloudsql/PROJECT:REGION:INSTANCE`) for socket connections or to the proxy address. `DB_PORT` is set to `5432`. `DB_NAME` and `DB_USER` are set from the variables below.

**PostgreSQL extensions:** `pg_trgm`, `unaccent`, `hstore`, and `citext` are installed automatically by `Django_Common`'s `db-init.sh` script during the initialisation job, using the `ROOT_PASSWORD` superuser secret.

| Variable | Group | Default | Description |
|---|---|---|---|
| `application_database_name` | 11 | `'django_db'` | PostgreSQL database name. Injected as `DB_NAME`. **Do not change after initial deployment.** |
| `application_database_user` | 11 | `'django_user'` | PostgreSQL application user. Injected as `DB_USER`. Password auto-generated and stored in Secret Manager as `DB_PASSWORD`. |
| `database_password_length` | 11 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 11 | `false` | Automated zero-downtime password rotation. See §7.D. |
| `rotation_propagation_delay_sec` | 11 | `90` | Seconds to wait after rotation before restarting the service. |

> `database_type`, `sql_instance_name`, `sql_instance_base_name`, `enable_postgres_extensions`, and `enable_mysql_plugins` are not exposed — Django only supports PostgreSQL, and extension installation is managed by `Django_Common`'s `db-init.sh` script.

### C. Storage (NFS & GCS)

**NFS is enabled by default** (`enable_nfs = true`). Django stores user-uploaded files on the NFS share so that all Cloud Run instances access a consistent filesystem. When `Services_GCP` is absent, an inline GCE VM NFS server is provisioned. Requires `execution_environment = 'gen2'`.

**GCS media bucket:** `Django_Common` automatically provisions a dedicated media bucket and grants the application SA `roles/storage.objectAdmin` and `roles/storage.legacyBucketReader`. GCS Fuse mounts are configured separately via `gcs_volumes`. The media bucket is separate from any buckets in `storage_buckets`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_nfs` | 10 | `true` | Provisions an NFS volume for shared uploaded assets. Requires `gen2`. Set `false` if using only GCS for file storage. |
| `nfs_mount_path` | 10 | `'/mnt/nfs'` | Container path where the NFS share is mounted. |
| `create_cloud_storage` | 10 | `true` | Set `false` to skip additional bucket creation. The media bucket from `Django_Common` is always provisioned. |
| `storage_buckets` | 10 | `[{ name_suffix = "data" }]` | Additional GCS buckets beyond the auto-provisioned media bucket. |
| `gcs_volumes` | 10 | `[]` | GCS buckets to mount via GCS Fuse (requires `gen2`). Each entry: `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. |

### D. Networking

Cloud Run uses Direct VPC Egress to reach Cloud SQL. Because `enable_cloudsql_volume = true` is the default, the Cloud SQL Auth Proxy sidecar is injected. The `db-init.sh` script determines the effective connection target at runtime (socket path or proxy at `127.0.0.1`), not a plain TCP IP address.

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 4 | `'all'` | `'all'` — public internet; `'internal'` — VPC only; `'internal-and-cloud-load-balancing'` — forces traffic through the HTTPS Load Balancer. |
| `vpc_egress_setting` | 4 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` routes only RFC 1918 traffic via VPC. `'ALL_TRAFFIC'` routes all egress via VPC (required for Redis on private IP or strict NAT setups). |

> `network_name` is not exposed. The module auto-discovers the `Services_GCP` VPC network. If multiple VPCs exist in the project, deploy via `App_CloudRun` directly with `network_name` set explicitly.

### E. Initialization & Bootstrap

A `db-init` Cloud Run Job is automatically configured in `initialization_jobs` as the variable default (with `execute_on_apply = false`). When you pass an empty list (`initialization_jobs = []`), `Django_Common` substitutes two default jobs — `db-init` and `db-migrate` — both with `execute_on_apply = true`. The `db-init` job uses `postgres:15-alpine` and executes `Django_Common/scripts/db-init.sh`, which performs the following idempotent operations:

1. Detects the connection mode: if `DB_SSL=false` and `DB_HOST` is not a Unix socket path, forces `DB_HOST=127.0.0.1` to route through the Cloud SQL Auth Proxy sidecar. Otherwise uses `DB_IP` (injected by `App_CloudRun`) or falls back to `DB_HOST`.
2. Polls the database using `psql` until it is reachable.
3. Creates (or updates) the Django database role with `CREATEDB` privileges, using the `ROOT_PASSWORD` (`postgres` superuser) secret.
4. Creates the `django_db` database as the application user (`DB_USER`) if it does not already exist.
5. Grants the application user full privileges on the database and public schema (tables, sequences, functions), and sets the database owner.
6. Installs the required PostgreSQL extensions: `pg_trgm`, `unaccent`, `hstore`, `citext` (using `CREATE EXTENSION IF NOT EXISTS`).
7. Signals Cloud SQL Proxy shutdown via `POST http://localhost:9091/quitquitquit`.

Extensions are installed as the `postgres` superuser via the `ROOT_PASSWORD` secret. The script is idempotent — running it on an already-initialised database is safe.

After `db-init` completes, the Django application applies migrations on startup. Superuser creation is handled by `entrypoint.sh` in `Django_Common`, which checks for `DJANGO_SUPERUSER_USERNAME`, `DJANGO_SUPERUSER_EMAIL`, and `DJANGO_SUPERUSER_PASSWORD` environment variables and creates a superuser if one does not already exist. Use `secret_environment_variables` to inject these credentials.

Additional initialization jobs and recurring cron jobs can be defined via the `initialization_jobs` and `cron_jobs` variables:

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 12 | `[db-init job]` | One-shot Cloud Run Jobs. The default `db-init` job is pre-configured with `execute_on_apply = false`. Additional jobs (e.g., `db-migrate`) can be appended. Each entry: `name`, `image`, `command`, `args`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `execute_on_apply`, `script_path`. When `initialization_jobs = []` is passed, `Django_Common` substitutes two default jobs: `db-init` (execute_on_apply=true) and `db-migrate` (execute_on_apply=true). |
| `cron_jobs` | 12 | `[]` | Recurring jobs triggered by Cloud Scheduler. Each entry: `name`, `schedule` (cron UTC), `image`, `command`, `cpu_limit`, `memory_limit`, `paused`. |
| `additional_services` | 12 | `[]` | Additional Cloud Run services deployed alongside the main Django application. Use for sidecar or helper services (e.g., Celery workers). Each entry: `name`, `image`, `port`, `env_vars`, `cpu_limit`, `memory_limit`, `min_instance_count`, `max_instance_count`, `ingress`, `output_env_var_name`. |

**Backup Import:** If `enable_backup_import = true`, a dedicated Cloud Run Job restores a backup into the PostgreSQL database during the apply, after the `db-init` job. See §8.C for all backup variables.

---

## 4. Advanced Security

### A. Cloud Armor WAF

Identical behaviour to `App_CloudRun`. When `enable_cloud_armor = true`, a Global HTTPS Load Balancer with a Cloud Armor WAF policy (OWASP Top 10, adaptive DDoS, 500 req/min rate limiting) is provisioned in front of Cloud Run.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 9 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. Required for custom domains, CDN, and DDoS protection. |
| `admin_ip_ranges` | 9 | `[]` | CIDR ranges exempted from WAF rules (e.g., office VPN, CI/CD egress IPs). |

> Note: Cloud Armor is in **group 9** in `Django_CloudRun` (vs group 16 in `App_CloudRun`).

### B. Identity-Aware Proxy (IAP)

When `enable_iap = true`, Cloud Run's native IAP integration is enabled directly on the service. Google identity authentication is required before requests reach Django. The public `allUsers` invoker binding is removed. Both `roles/iap.httpsResourceAccessor` (project-level) and `roles/run.invoker` (service-level) are granted to authorised principals.

IAP does not require `enable_cloud_armor`. See [App_CloudRun §4.B](../App_CloudRun/App_CloudRun.md#b-identity-aware-proxy-iap) for the full IAM role details.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 4 | `false` | Enables IAP natively on the Cloud Run service. Recommended for admin-facing or internal-only Django deployments. |
| `iap_authorized_users` | 4 | `[]` | Users/service accounts granted access. Format: `'user:email'` or `'serviceAccount:sa@...'`. The Terraform executor is automatically included. |
| `iap_authorized_groups` | 4 | `[]` | Google Groups granted access. Format: `'group:name@example.com'`. |

> Note: IAP is in **group 4** (merged with networking) in `Django_CloudRun` (vs group 15 in `App_CloudRun`).

### C. Binary Authorization

Identical to `App_CloudRun`. When `enable_binary_authorization = true`, Cloud Run enforces that deployed images carry a valid cryptographic attestation. The Cloud Build pipeline attests the image before triggering deployment.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_binary_authorization` | 7 | `false` | Enforces image attestation. Requires a Binary Authorization policy and attestor pre-configured in the project. |

> `binauthz_evaluation_mode` is not exposed in `Django_CloudRun`. To set a custom evaluation mode, deploy via `App_CloudRun` directly.

### D. VPC Service Controls

Identical to `App_CloudRun`. When `enable_vpc_sc = true`, all GCP API calls from this module are bound within an existing VPC-SC perimeter, creating a security boundary around Cloud Run, Secret Manager, Cloud SQL, and Artifact Registry.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_vpc_sc` | 21 | `false` | Registers module API calls within the project's VPC-SC perimeter. A perimeter must already exist before enabling. |

> Note: VPC SC is in **group 21** in `Django_CloudRun` (vs group 17 in `App_CloudRun`).

### E. Secret Manager Integration

Django application secrets are stored in Secret Manager and injected natively by Cloud Run at revision start — plaintext is never written to Terraform state.

`Django_Common` auto-generates one secret: `SECRET_KEY` (the Django cryptographic signing key). This is injected via `module_secret_env_vars`. The `DB_PASSWORD` and `ROOT_PASSWORD` secrets are provisioned automatically by `App_CloudRun` and consumed by the `db-init` job. User-defined secrets can be added via `secret_environment_variables`.

Superuser credentials (`DJANGO_SUPERUSER_PASSWORD`) should be managed via `secret_environment_variables` rather than `environment_variables` to keep them out of Terraform state.

| Variable | Group | Default | Description |
|---|---|---|---|
| `secret_environment_variables` | 5 | `{}` | Map of env var name → Secret Manager secret ID. Resolved at runtime by Cloud Run; never stored in state. (e.g., `{ DJANGO_SUPERUSER_PASSWORD = "django-superuser-password" }`) |
| `secret_rotation_period` | 5 | `'2592000s'` | Frequency at which Secret Manager emits rotation notifications. Default: 30 days. |
| `secret_propagation_delay` | 5 | `30` | Seconds to wait after secret creation before dependent resources proceed. |

---

## 5. Traffic & Ingress

### A. HTTPS Load Balancer

Identical to `App_CloudRun`. When `enable_cloud_armor = true`, a Global HTTPS Load Balancer backed by a Serverless NEG is provisioned. Traffic flows: Internet → Cloud Armor → Global HTTPS LB → Serverless NEG → Cloud Run.

Setting `ingress_settings = 'internal-and-cloud-load-balancing'` forces all Django traffic through the LB, preventing direct `*.run.app` URL access.

See [App_CloudRun §5.A](../App_CloudRun/App_CloudRun.md#a-https-load-balancer) for full architecture details.

### B. Cloud CDN

When `enable_cdn = true` (requires `enable_cloud_armor = true`), Cloud CDN is attached to the HTTPS Load Balancer backend.

**Django consideration:** Django serves both authenticated and public content. CDN caching is most effective for Django static files (`STATIC_URL`) and unauthenticated public pages. Ensure that authenticated responses and session-backed views include `Cache-Control: no-store` or `Vary: Cookie` headers before enabling CDN, to prevent private responses from being cached at edge locations.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cdn` | 9 | `false` | Enables Cloud CDN on the HTTPS LB backend. Only effective when `enable_cloud_armor = true`. |

### C. Custom Domains

Custom domains are attached to the Global HTTPS Load Balancer via `application_domains`. Google-managed SSL certificates are provisioned automatically. DNS must point to the load balancer IP after apply.

| Variable | Group | Default | Description |
|---|---|---|---|
| `application_domains` | 9 | `[]` | Custom domain names for the HTTPS LB. Google-managed SSL certificates provisioned per domain. DNS must point to the LB IP. (e.g., `['app.example.com']`) |

After the first apply, retrieve the LB IP from the Terraform output `load_balancer_ip` and create an `A` record. SSL certificate provisioning takes 10–30 minutes after DNS propagation.

---

## 6. CI/CD & Delivery

### A. Cloud Build Triggers

Identical to `App_CloudRun`. When `enable_cicd_trigger = true`, a Cloud Build GitHub connection and push trigger are provisioned. The trigger builds and deploys a custom Django image when code is pushed to the configured branch.

**Typical use case:** The default `container_image_source = 'custom'` already uses Cloud Build to build a Django image with `Django_Common`'s Dockerfile. Enabling a CI/CD trigger allows this same pipeline to fire automatically on repository push, for example when application code, templates, or static assets are updated.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 7 | `false` | Provisions a Cloud Build GitHub trigger. Requires `github_repository_url` and credentials. |
| `github_repository_url` | 7 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 7 | `""` | GitHub PAT (`repo`, `admin:repo_hook` scopes). Required on first apply. Sensitive. |
| `github_app_installation_id` | 7 | `""` | GitHub App installation ID (preferred for organisation repos). |
| `cicd_trigger_config` | 7 | `{ branch_pattern = "^main$" }` | Advanced trigger config: `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

See [App_CloudRun §6.A](../App_CloudRun/App_CloudRun.md#a-cloud-build-triggers) for PAT vs GitHub App authentication details.

### B. Cloud Deploy Pipeline

When `enable_cloud_deploy = true` (requires `enable_cicd_trigger = true`), the CI/CD pipeline is upgraded to a managed Cloud Deploy delivery pipeline with sequential promotion stages.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 7 | `false` | Provisions a Cloud Deploy pipeline. Requires `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 7 | `[dev, staging, prod(approval)]` | Ordered promotion stages. Each: `name`, `target_name`, `service_name`, `require_approval`, `auto_promote`. |

See [App_CloudRun §6.B](../App_CloudRun/App_CloudRun.md#b-cloud-deploy-pipeline) for the approval workflow and multi-project deployment details.

---

## 7. Reliability & Scheduling

### A. Scaling & Concurrency

Django is stateless when sessions are stored externally (database or Redis). Scale-to-zero (`min_instance_count = 0`) is the default. Set `min_instance_count = 1` to eliminate cold starts for latency-sensitive applications, and increase `max_instance_count` for high-traffic deployments.

| Variable | Group | Default | Description |
|---|---|---|---|
| `min_instance_count` | 3 | `0` | `0` enables scale-to-zero. Set `≥1` to eliminate cold starts. |
| `max_instance_count` | 3 | `1` | Increase for high-traffic deployments. Ensure sessions are stored in the database or Redis before scaling beyond 1. |

**Startup CPU Boost** is always enabled (hardcoded in `App_CloudRun`).

### B. Traffic Splitting

Traffic splitting is supported. Because Django sessions are stored in the database or Redis (not in-process), requests for the same user can be safely routed to different revisions.

| Variable | Group | Default | Description |
|---|---|---|---|
| `traffic_split` | 3 | `[]` | Percentage-based traffic allocation across named revisions. All entries must sum to 100. Empty sends 100% to the latest revision. |

See [App_CloudRun §7.B](../App_CloudRun/App_CloudRun.md#b-traffic-splitting) for the full configuration syntax.

### C. Health Probes & Uptime Monitoring

`Django_CloudRun` exposes a **dual probe system**:

**`startup_probe` / `liveness_probe`** — passed to `Django_Common` to configure how the initialisation scripts and application entrypoint assess Django readiness. These are separate from the Cloud Run infrastructure probe configuration.

**`startup_probe_config` / `health_check_config`** — passed directly to `App_CloudRun` and configure the actual Cloud Run startup and liveness probes on the container revision.

All four probes target `/healthz` by default. Implement a `/healthz` view in your Django application that returns `HTTP 200` when the database connection is live and all critical services are ready.

**`startup_probe` / `liveness_probe` (Django_Common internal):**

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 13 | `{ enabled=true, type="HTTP", path="/healthz", initial_delay_seconds=60, timeout_seconds=5, period_seconds=10, failure_threshold=3 }` | Used by `Django_Common` to assess whether Django has started successfully. `initial_delay_seconds=60` accounts for database connection establishment. |
| `liveness_probe` | 13 | `{ enabled=true, type="HTTP", path="/healthz", initial_delay_seconds=30, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Used by `Django_Common` to assess whether a running Django instance is healthy. |

**`startup_probe_config` / `health_check_config` (Cloud Run infrastructure):**

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe_config` | 13 | `{ enabled=true, path="/healthz", initial_delay_seconds=10, timeout_seconds=5, period_seconds=10, failure_threshold=10 }` | Cloud Run startup probe. Container receives no traffic until this succeeds. `failure_threshold=10` gives ~110 seconds of startup tolerance. |
| `health_check_config` | 13 | `{ enabled=true, path="/healthz", initial_delay_seconds=15, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Cloud Run liveness probe. Container is restarted after `failure_threshold` consecutive failures. |
| `uptime_check_config` | 13 | `{ enabled=true, path="/" }` | Cloud Monitoring uptime check. Alerts notify `support_users` if unreachable. |
| `alert_policies` | 13 | `[]` | Cloud Monitoring metric alert policies. Each: `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`. |

**Differences from `App_CloudRun` probe defaults:**

| Field | `App_CloudRun` | `Django_CloudRun` | Reason |
|---|---|---|---|
| `path` | `/healthz` | `/healthz` | Same — Django targets `/healthz` matching the App_CloudRun default. |
| Startup `initial_delay_seconds` (`startup_probe`) | `10` | `60` | Django_Common probe accounts for DB connection + app load time. |
| Startup `failure_threshold` (`startup_probe_config`) | `10` | `10` | Same — sufficient retry budget. |

### D. Auto Password Rotation

When `enable_auto_password_rotation = true`, a zero-downtime password rotation pipeline is provisioned identically to `App_CloudRun`:

1. Secret Manager emits a rotation notification at every `secret_rotation_period` interval.
2. Eventarc fires a Cloud Run rotation Job.
3. The job generates a new password, updates the Cloud SQL PostgreSQL user, writes a new secret version.
4. After `rotation_propagation_delay_sec` seconds, the job restarts the Django service.

Django re-establishes its database connection pool on restart and reads the updated `DB_PASSWORD` from Secret Manager. No manual intervention is required.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 11 | `false` | Enables automated password rotation. |
| `rotation_propagation_delay_sec` | 11 | `90` | Seconds to wait after writing the new secret before restarting the service. |
| `secret_rotation_period` | 5 | `'2592000s'` | Rotation frequency. Default: 30 days. |

---

## 8. Integrations

### A. Redis Cache

Redis is **disabled by default** (`enable_redis = false`). When enabled, `Django_CloudRun` injects `REDIS_HOST` and `REDIS_PORT` as plain-text environment variables via `module_env_vars`. Your Django `settings.py` must be configured to use these variables for `CACHES` and optionally `SESSION_ENGINE`.

**Note:** Unlike `Directus_CloudRun`, which generates a Redis connection URL secret, `Django_CloudRun` injects Redis connection details as plain-text env vars. No Redis secret is created.

The module does not provision a Redis instance. Provision a Cloud Memorystore for Redis instance separately and set `redis_host` to its private IP. Ensure `vpc_egress_setting = 'PRIVATE_RANGES_ONLY'` (the default) so Cloud Run can reach the private Redis endpoint.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 20 | `false` | Injects `REDIS_HOST` and `REDIS_PORT` env vars when `true`. Your `settings.py` must consume these. |
| `redis_host` | 20 | `""` | Redis server hostname or IP. Required when `enable_redis = true`. Typically the private IP of a Memorystore instance. |
| `redis_port` | 20 | `6379` | Redis server TCP port. |
| `redis_auth` | 20 | `""` | Redis AUTH password. Leave empty if the Redis instance does not require authentication. Sensitive — never stored in state. |

> Note: Redis is in **group 20** in `Django_CloudRun` (vs group 10 in `App_CloudRun`).

### B. Additional Services

`Django_CloudRun` exposes an `additional_services` variable (unique to this module — not present in Cyclos or Directus) for deploying sidecar or worker services alongside the main Django application. Each entry deploys an independent Cloud Run service in the same project and region.

**Typical use cases:** Celery workers, background task processors, Redis proxies, or any auxiliary service that needs to co-exist with the Django application.

| Variable | Group | Default | Description |
|---|---|---|---|
| `additional_services` | 12 | `[]` | List of additional Cloud Run services. Each entry: `name`, `image`, `port`, `command`, `args`, `env_vars`, `cpu_limit`, `memory_limit`, `min_instance_count`, `max_instance_count`, `ingress` (default `INGRESS_TRAFFIC_INTERNAL_ONLY`), `output_env_var_name`, `volume_mounts`, `startup_probe`, `liveness_probe`. |

The `output_env_var_name` field causes the additional service's URL to be injected into the main Django service as an environment variable — useful for pointing Django at a Celery broker or background worker URL.

### C. Backup Import & Recovery

When `enable_backup_import = true`, a dedicated Cloud Run Job restores an existing database backup into the provisioned Cloud SQL PostgreSQL instance. This runs after the `db-init` job and before the Django service is deployed.

**Django uses `backup_file`** (not `backup_uri` as in Directus/Cyclos). `backup_file` is the filename relative to the automatically created GCS backups bucket, or the Google Drive file ID when `backup_source = 'gdrive'`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 6 | `'0 2 * * *'` | Cron expression (UTC) for automated daily backups. |
| `backup_retention_days` | 6 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 6 | `false` | Triggers a one-time restore on apply. Set `false` after a successful import. |
| `backup_source` | 6 | `'gcs'` | `'gcs'` (filename in the auto-created backups bucket) or `'gdrive'` (Drive file ID). |
| `backup_file` | 6 | `'backup.sql'` | Filename in the GCS backups bucket, or Google Drive file ID. Maps to `backup_file` in `App_CloudRun`. |
| `backup_format` | 6 | `'sql'` | Backup file format. Options: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

> **Warning:** If the database already contains data, the import may produce errors. Test in a non-production environment before importing into production.

### D. Observability & Alerting

Observability is identical to `App_CloudRun`. A Cloud Monitoring uptime check polls the Django endpoint from multiple global locations. Custom alert policies can monitor Cloud Run metrics (latency, error rate, instance count) and notify `support_users`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `uptime_check_config` | 13 | `{ enabled=true, path="/" }` | Uptime check: `enabled`, `path`, `check_interval` (e.g., `"60s"`), `timeout` (e.g., `"10s"`). |
| `alert_policies` | 13 | `[]` | Metric alert policies. Each: `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`, `aggregation_period`. |
| `support_users` | 1 | `[]` | Email addresses notified by uptime and alert policy triggers. |

> Note: Observability is in **group 13** in `Django_CloudRun` (vs group 5 in `App_CloudRun`).

---

## 9. Platform-Managed Behaviours

The following behaviours are applied automatically by `Django_CloudRun` regardless of variable values. They cannot be overridden via `tfvars`.

| Behaviour | Implementation | Detail |
|---|---|---|
| **PostgreSQL required** | `DB_ENGINE = "django.db.backends.postgresql"` hardcoded by `Django_Common` | Django only supports PostgreSQL through this module. `database_type` is not exposed. |
| **Flexible proxy connection** | `enable_cloudsql_volume = true` default | `db-init.sh` detects the connection mode: if `DB_SSL=false` and `DB_HOST` is not a Unix socket path, it routes through the Cloud SQL Auth Proxy at `127.0.0.1`. If `DB_HOST` is already a socket path (e.g., `/cloudsql/PROJECT:REGION:INSTANCE`), it connects directly. Set `enable_cloudsql_volume = false` to switch to direct TCP. |
| **Django environment variables** | `DB_ENGINE`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` injected by `Django_Common` | These values are derived from the Cloud SQL instance and do not need to be set in `environment_variables`. |
| **SECRET_KEY** | Auto-generated and stored in Secret Manager by `Django_Common` | Injected via `module_secret_env_vars`. Do not set `SECRET_KEY` in `environment_variables`. |
| **PostgreSQL extensions** | Installed by `db-init` job via `Django_Common/scripts/db-init.sh` | `pg_trgm`, `unaccent`, `hstore`, `citext` are installed automatically on every apply. The job is idempotent. |
| **GCS media bucket** | Provisioned by `Django_Common`, injected via `module_storage_buckets` | A dedicated GCS bucket for Django media files is provisioned separately from `storage_buckets`. The SA is granted `roles/storage.objectAdmin` and `roles/storage.legacyBucketReader`. |
| **Non-root container** | Django container runs as UID `2000` | Matches the GCS Fuse user mapping for write access on GCS-mounted media paths. Do not change the UID without updating the GCS Fuse mount configuration. |
| **NFS enabled by default** | `enable_nfs = true` default | NFS shared storage is provisioned for media files. Requires `execution_environment = 'gen2'`. Set `enable_nfs = false` if using GCS volumes exclusively for media. |
| **Redis disabled by default** | `enable_redis = false` default | Unlike Directus, Redis is opt-in. Set `enable_redis = true` to inject `REDIS_HOST`/`REDIS_PORT`. No Redis secret is created — values are plain-text env vars. |
| **Superuser creation** | `entrypoint.sh` in `Django_Common` | If `DJANGO_SUPERUSER_USERNAME`, `DJANGO_SUPERUSER_EMAIL`, and `DJANGO_SUPERUSER_PASSWORD` are set, an admin superuser is created on first boot. Use `secret_environment_variables` for the password. |
| **Default db-init job** | `initialization_jobs` variable default includes a single `db-init` entry with `execute_on_apply = false` | The `db-init` job runs once on initial deployment. To also run `db-migrate` automatically, pass `initialization_jobs = []` — `Django_Common` then substitutes both jobs with `execute_on_apply = true`. Set `execute_on_apply = true` on the `db-init` entry to re-run it on every apply (safe — the script is idempotent). |
| **Scripts directory** | `scripts_dir = abspath("${path.module}/../Django_Common/scripts")` | Initialization and utility scripts are sourced from `Django_Common`, not from the deployment directory. |

**Inline infrastructure** (when no `Services_GCP` stack is present) is identical to `App_CloudRun` §9 — `App_CloudRun` provisions an inline VPC, Cloud NAT, Cloud SQL instance, service accounts, and GCP APIs as required. See [App_CloudRun §9](../App_CloudRun/App_CloudRun.md#9-inline-infrastructure-provisioning) for the full inline resource inventory and teardown notes.

---

## 10. Variable Reference

All user-configurable variables exposed by `Django_CloudRun`, sorted by UI group then order. Group 0 variables are reserved for platform metadata — leave them at their defaults for standard deployments.

Variables marked **[fixed]** are hardcoded by the module and cannot be overridden.

| Variable | Group | Default | Description |
|---|---|---|---|
| `module_description` | 0 | (Django platform text) | Platform metadata: module description. |
| `module_documentation` | 0 | (docs URL) | Platform metadata: documentation URL. |
| `module_dependency` | 0 | `['Services_GCP']` | Platform metadata: required modules. |
| `module_services` | 0 | (GCP service list) | Platform metadata: GCP services consumed. |
| `credit_cost` | 0 | `100` | Platform metadata: deployment credit cost. |
| `require_credit_purchases` | 0 | `true` | Platform metadata: enforces credit balance check. |
| `enable_purge` | 0 | `true` | Permits full deletion of module resources on destroy. |
| `public_access` | 0 | `false` | Platform catalogue visibility. |
| `deployment_id` | 0 | `""` | Deployment ID suffix. Auto-generated if empty. |
| `resource_creator_identity` | 0 | (platform SA) | Service account used by Terraform to manage resources. |
| `project_id` | 1 | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 1 | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 1 | `[]` | Email addresses for monitoring alerts. |
| `resource_labels` | 1 | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 2 | `'django'` | Base resource name. Do not change after initial deployment. |
| `application_display_name` | 2 | `'Django Application'` | Human-readable name shown in the GCP Console. |
| `application_description` | 2 | `'Django Application - High-level Python Web framework'` | Cloud Run service description. |
| `application_version` | 2 | `'latest'` | Container image version tag. Pin to a specific version in production. |
| `deploy_application` | 3 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 3 | `'custom'` | `'custom'` (Cloud Build) or `'prebuilt'` (existing image). |
| `container_image` | 3 | `'us-docker.pkg.dev/cloudrun/container/hello'` | Container image URI. Override with your Django application image. |
| `container_build_config` | 3 | `{ enabled = true }` | Cloud Build config (used when `container_image_source = 'custom'`). |
| `container_resources` | 3 | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | CPU and memory limits. Also accepts optional `cpu_request` and `mem_request`. |
| `min_instance_count` | 3 | `0` | `0` = scale-to-zero. Set `≥1` to eliminate cold starts. |
| `max_instance_count` | 3 | `1` | Increase for high-traffic deployments. |
| `container_port` | 3 | `8080` | TCP port Django listens on. Must match the WSGI/ASGI server binding. |
| `execution_environment` | 3 | `'gen2'` | Gen2 required for NFS mounts and GCS Fuse. |
| `timeout_seconds` | 3 | `300` | Max request duration. Increase for long reports or file processing. |
| `enable_cloudsql_volume` | 3 | `true` | Default `true` — Auth Proxy sidecar injected; `db-init.sh` auto-detects socket vs. `127.0.0.1`. Set `false` for direct TCP. |
| `cloudsql_volume_mount_path` | 3 | `'/cloudsql'` | Base path for the Auth Proxy Unix socket mount. |
| `container_protocol` | 3 | `'http1'` | `'http1'` or `'h2c'`. |
| `enable_image_mirroring` | 3 | `true` | Mirrors the container image into Artifact Registry. |
| `max_revisions_to_retain` | 3 | `7` | Maximum number of Cloud Run revisions to keep after each deployment. Set to 0 to disable pruning. |
| `traffic_split` | 3 | `[]` | Canary/blue-green traffic allocation. |
| `service_annotations` | 3 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 3 | `{}` | Labels applied to the Cloud Run service. |
| `ingress_settings` | 4 | `'all'` | `'all'`, `'internal'`, or `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 4 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` or `'ALL_TRAFFIC'`. |
| `enable_iap` | 4 | `false` | Enables IAP natively on the Cloud Run service (BETA). |
| `iap_authorized_users` | 4 | `[]` | Users/SAs granted IAP access. |
| `iap_authorized_groups` | 4 | `[]` | Google Groups granted IAP access. |
| `environment_variables` | 5 | `{}` | Plain-text env vars. Do not include `SECRET_KEY`, `DB_*`, or Redis credentials here. |
| `secret_environment_variables` | 5 | `{}` | Secret Manager references (e.g., `{ DJANGO_SUPERUSER_PASSWORD = "django-superuser-password" }`). |
| `secret_propagation_delay` | 5 | `30` | Seconds to wait after secret creation. |
| `secret_rotation_period` | 5 | `'2592000s'` | Secret Manager rotation notification frequency. |
| `backup_schedule` | 6 | `'0 2 * * *'` | Cron expression (UTC) for automated backups. |
| `backup_retention_days` | 6 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 6 | `false` | Triggers a one-time restore on apply. |
| `backup_source` | 6 | `'gcs'` | `'gcs'` (filename in auto-created bucket) or `'gdrive'` (file ID). |
| `backup_file` | 6 | `'backup.sql'` | Filename in the GCS backups bucket, or Google Drive file ID. |
| `backup_format` | 6 | `'sql'` | Backup format. Options: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |
| `enable_cicd_trigger` | 7 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 7 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 7 | `""` | GitHub PAT. Required on first apply. Sensitive. |
| `github_app_installation_id` | 7 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 7 | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger config. |
| `enable_cloud_deploy` | 7 | `false` | Provisions a Cloud Deploy progressive delivery pipeline. |
| `cloud_deploy_stages` | 7 | `[dev, staging, prod(approval)]` | Ordered Cloud Deploy promotion stages. |
| `enable_binary_authorization` | 7 | `false` | Enforces image attestation on deployment. |
| `enable_custom_sql_scripts` | 8 | `false` | Runs SQL scripts from GCS after provisioning. |
| `custom_sql_scripts_bucket` | 8 | `""` | GCS bucket containing SQL scripts. |
| `custom_sql_scripts_path` | 8 | `""` | Path prefix within the bucket. |
| `custom_sql_scripts_use_root` | 8 | `false` | Run scripts as the root DB user. |
| `enable_cloud_armor` | 9 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | 9 | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | 9 | `[]` | Custom domains with Google-managed SSL certificates. |
| `enable_cdn` | 9 | `false` | Enables Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` | 9 | `7` | Maximum number of recent container images to keep in Artifact Registry. Set to 0 to disable. |
| `delete_untagged_images` | 9 | `true` | Automatically deletes untagged container images from Artifact Registry. |
| `image_retention_days` | 9 | `30` | Days after which images are eligible for deletion from Artifact Registry. Set to 0 to disable age-based deletion. |
| `create_cloud_storage` | 10 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 10 | `[{ name_suffix = "data" }]` | Additional GCS buckets to provision. |
| `enable_nfs` | 10 | `true` | Provisions NFS shared storage for media files. Requires `gen2`. |
| `nfs_mount_path` | 10 | `'/mnt/nfs'` | Container path where NFS is mounted. |
| `nfs_instance_name` | 8 | `""` | Name of an existing NFS GCE VM to use instead of auto-discovering one. |
| `nfs_instance_base_name` | 8 | `'app-nfs'` | Base name for the inline NFS GCE VM when no existing server is found. |
| `gcs_volumes` | 10 | `[]` | GCS buckets to mount via GCS Fuse (requires `gen2`). |
| `manage_storage_kms_iam` | 10 | `false` | Creates CMEK KMS keyring and enables CMEK encryption on storage buckets. |
| `enable_artifact_registry_cmek` | 10 | `false` | Enables CMEK encryption for container images in Artifact Registry. |
| `application_database_name` | 11 | `'django_db'` | PostgreSQL database name. Injected as `DB_NAME`. Do not change after initial deployment. |
| `application_database_user` | 11 | `'django_user'` | PostgreSQL application user. Injected as `DB_USER`. |
| `database_password_length` | 11 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 11 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 11 | `90` | Seconds to wait after rotation before restarting the service. |
| `initialization_jobs` | 12 | `[db-init job (execute_on_apply=false)]` | One-shot Cloud Run Jobs. The `db-init` job is pre-configured with `execute_on_apply = false`. Pass `[]` to let `Django_Common` substitute both `db-init` and `db-migrate` jobs, each with `execute_on_apply = true`. |
| `cron_jobs` | 12 | `[]` | Recurring scheduled Cloud Run Jobs (e.g., `clearsessions`). |
| `additional_services` | 12 | `[]` | Additional Cloud Run services (e.g., Celery workers). Unique to `Django_CloudRun`. |
| `startup_probe` | 13 | `{ path="/healthz", initial_delay_seconds=60, failure_threshold=3, ... }` | Django_Common startup probe. |
| `liveness_probe` | 13 | `{ path="/healthz", initial_delay_seconds=30, failure_threshold=3, ... }` | Django_Common liveness probe. |
| `startup_probe_config` | 13 | `{ path="/healthz", initial_delay_seconds=10, failure_threshold=10, ... }` | Cloud Run infrastructure startup probe. Maps to `startup_probe_config` in `App_CloudRun`. |
| `health_check_config` | 13 | `{ path="/healthz", initial_delay_seconds=15, failure_threshold=3, ... }` | Cloud Run infrastructure liveness probe. Maps to `health_check_config` in `App_CloudRun`. |
| `uptime_check_config` | 13 | `{ enabled=true, path="/" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 13 | `[]` | Cloud Monitoring metric alert policies. |
| `enable_redis` | 20 | `false` | **Disabled by default.** Set `true` to inject `REDIS_HOST`/`REDIS_PORT`. |
| `redis_host` | 20 | `""` | Redis hostname/IP. Required when `enable_redis = true`. |
| `redis_port` | 20 | `6379` | Redis TCP port. |
| `redis_auth` | 20 | `""` | Redis AUTH password. Sensitive. |
| `enable_vpc_sc` | 21 | `false` | Registers API calls within the project's VPC-SC perimeter. |
| `vpc_cidr_ranges` | 21 | `[]` | VPC subnet CIDR ranges for the VPC-SC network access level. Auto-discovered from the VPC when empty. |
| `vpc_sc_dry_run` | 21 | `true` | When `true`, VPC-SC violations are logged but not blocked. Set to `false` to enforce. |
| `organization_id` | 21 | `""` | GCP Organization ID for the VPC-SC Access Context Manager policy. Auto-discovered when empty. |
| `enable_audit_logging` | 21 | `false` | Enables detailed Cloud Audit Logs (DATA_READ, DATA_WRITE, ADMIN_READ) for all supported services. |
