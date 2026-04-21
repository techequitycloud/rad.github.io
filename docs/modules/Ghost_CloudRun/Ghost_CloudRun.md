---
title: "Ghost Cloud Run Configuration Guide"
sidebar_label: "Cloud Run"
---

# Ghost CloudRun Module

<YouTubeEmbed videoId="N-kCP7yhoWE" poster="https://storage.googleapis.com/rad-public-2b65/modules/Ghost_CloudRun.png" />

<br/>

<a href="https://storage.googleapis.com/rad-public-2b65/modules/Ghost_CloudRun.pdf" target="_blank">View Presentation (PDF)</a>



This document provides a comprehensive reference for the `modules/Ghost_CloudRun` Terraform module. It covers architecture, IAM, configuration variables, Ghost-specific behaviours, and operational patterns for deploying Ghost on Google Cloud Run (v2).

---

## 1. Module Overview

Ghost is a professional open-source publishing platform for newsletters, memberships, and content sites. `Ghost_CloudRun` is a **wrapper module** built on top of `App_CloudRun`. It uses `App_CloudRun` for all GCP infrastructure provisioning and injects Ghost-specific application configuration, database initialisation, and storage configuration via `Ghost_Common`.

**Key Capabilities:**
*   **Compute**: Cloud Run v2 (Gen2), Node.js container, 2 vCPU / 4 Gi by default. Scale-to-zero (`min_instance_count = 0`) with `max_instance_count = 5` — both hardcoded, not user-configurable.
*   **Data Persistence**: Cloud SQL **MySQL 8.0** (not PostgreSQL). NFS (GCE VM or Filestore) for shared content files. GCS `ghost-content` bucket auto-provisioned by `Ghost_Common`.
*   **Security**: Inherits Cloud Armor WAF, IAP, Binary Authorization, and VPC Service Controls from `App_CloudRun`. No application-level secrets are auto-generated — Ghost manages its own internal keys.
*   **Caching**: Redis **enabled by default** (`enable_redis = true`) — `Ghost_Common` configures Ghost's page caching backend.
*   **CI/CD**: Cloud Build custom image pipeline by default; Cloud Deploy progressive delivery optional.
*   **Reliability**: Health probes target `/` (Ghost's root path) with 90-second initial delay to accommodate database migrations and theme compilation on first boot.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 1 | `string` | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 1 | `list(string)` | `[]` | Email recipients for monitoring alerts. |
| `resource_labels` | 1 | `map(string)` | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 2 | `string` | `'ghost'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 2 | `string` | `'Ghost Publishing'` | Human-readable name shown in the GCP Console. Maps to `application_display_name` in `App_CloudRun`. |
| `description` | 2 | `string` | `'Ghost - Professional publishing platform'` | Cloud Run service description. Passed to `Ghost_Common`. |
| `application_version` | 2 | `string` | `'6.14.0'` | Ghost image version tag. Increment to deploy a new release. |

**Wrapper architecture:** `Ghost_CloudRun` calls `Ghost_Common` to build an `application_config` object containing Ghost-specific environment variables, probe configuration, and the `db-init` job definition. `Ghost_CloudRun` hardcodes `database__client = "mysql"` into the merged config to ensure Ghost 6.x connects to MySQL rather than falling back to SQLite. `module_storage_buckets` carries the `ghost-content` bucket provisioned by `Ghost_Common`. `scripts_dir` is resolved to `Ghost_Common/scripts`.

**MySQL note:** Unlike every other module in this repo, Ghost requires **MySQL 8.0**, not PostgreSQL. `database_type = "MYSQL_8_0"` is fixed by `Ghost_Common` and cannot be overridden.

---

## 2. IAM & Access Control

`Ghost_CloudRun` delegates all IAM provisioning to `App_CloudRun`. The Cloud Run SA, Cloud Build SA, IAP service agent, and password rotation role sets are identical to those in [App_CloudRun §2](../App_CloudRun/App_CloudRun.md#2-iam--access-control).

**No application-level secrets:** Unlike Directus or Django, `Ghost_Common` does not auto-generate application secrets (no equivalent of `SECRET_KEY` or `DIRECTUS_KEY`). Ghost manages its own internal signing keys at runtime. The `DB_PASSWORD` and `ROOT_PASSWORD` secrets are provisioned automatically by `App_CloudRun` and consumed by the `db-init` job.

**Database initialisation identity:** The `db-init` Cloud Run Job runs under the Cloud Run SA. It connects to Cloud SQL MySQL via the Auth Proxy Unix socket (since `enable_cloudsql_volume = true` by default), using `DB_HOST` (the socket path under `/cloudsql`), `DB_USER`, and `ROOT_PASSWORD` (from Secret Manager).

**120-second IAM propagation delay:** Inherited from `App_CloudRun` — the Ghost service is not deployed until the delay completes, preventing secret-read failures on the first revision start.

For the complete role tables and IAP, password rotation, and public access details, see [App_CloudRun §2](../App_CloudRun/App_CloudRun.md#2-iam--access-control).

---

## 3. Core Service Configuration

### A. Compute (Cloud Run)

Ghost is a Node.js application with significant resource requirements — it runs database migrations, compiles themes, and initialises membership features on startup. `Ghost_CloudRun` exposes `cpu_limit` and `memory_limit` as dedicated top-level variables with production-ready defaults.

**Scale-to-zero is enabled** (`min_instance_count = 0`). Ghost cold starts can take 15–30 seconds due to theme compilation and database connection setup. For production sites, set `min_instance_count = 1` by editing `main.tf` directly (see §7.A), or accept the cold start latency. `max_instance_count = 5` is hardcoded — both values are set in `main.tf` and are not user-configurable.

**Startup CPU Boost** is always enabled (hardcoded in `App_CloudRun`).

**Container image:** `container_image_source` defaults to `'custom'`, meaning Cloud Build compiles a custom image using `Ghost_Common`'s Dockerfile (extending the official `ghost` base image). Set `container_image_source = 'prebuilt'` and `container_image = 'ghost:6.14.0'` to skip the build and deploy the upstream image directly.

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 3 | `true` | Set `false` for infrastructure-only deployment (SQL, storage, secrets). |
| `container_image_source` | 3 | `'custom'` | `'custom'` builds via Cloud Build (default). `'prebuilt'` deploys an existing image URI. |
| `container_image` | 3 | `""` | Override image URI. Leave empty for Cloud Build to manage the image. |
| `cpu_limit` | 3 | `'2000m'` | CPU per instance. 2 vCPU minimum for reliable Ghost operation. |
| `memory_limit` | 3 | `'4Gi'` | Memory per instance. 4 Gi recommended; do not set below 512 Mi. |
| `container_port` | 3 | `2368` | Ghost's native HTTP port. Change only if your custom Dockerfile binds Ghost to a different port. |
| `execution_environment` | 3 | `'gen2'` | Gen2 required for NFS mounts and GCS Fuse. |
| `timeout_seconds` | 3 | `300` | Max request duration. Increase for long-running newsletter sends or image processing. |
| `enable_cloudsql_volume` | 3 | `true` | Default `true` — Ghost connects via Unix socket. Set `false` for TCP. |
| `traffic_split` | 3 | `[]` | Percentage-based canary/blue-green traffic allocation. See §7.B. |
| `service_annotations` | 3 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 3 | `{}` | Labels applied to the Cloud Run service. |

**Differences from `App_CloudRun` defaults:**

| Variable | `App_CloudRun` | `Ghost_CloudRun` | Reason |
|---|---|---|---|
| `container_port` | `8080` | `2368` | Ghost's native port. |
| `cpu_limit` | `'1000m'` | `'2000m'` | Ghost requires ≥2 vCPU for theme compilation and member features. |
| `memory_limit` | `'512Mi'` | `'4Gi'` | Ghost's Node.js process + themes + membership caches require significantly more RAM. |
| `enable_cloudsql_volume` | `true` | `true` | Same — Ghost connects via Auth Proxy Unix socket. |
| `min_instance_count` | `0` | `0` **[fixed]** | Scale-to-zero; hardcoded in `main.tf`. |
| `max_instance_count` | `1` | `5` **[fixed]** | Higher ceiling for traffic spikes; hardcoded in `main.tf`. |

### B. Database (Cloud SQL — MySQL 8.0)

Ghost requires **MySQL 8.0** — `Ghost_Common` fixes `database_type = "MYSQL_8_0"` and hardcodes `database__client = "mysql"` in the environment. PostgreSQL, SQL Server, and other engines are unsupported and will cause Ghost to fail at startup.

The module uses `db_name` and `db_user` in place of the `application_database_name` and `application_database_user` variables in `App_CloudRun`.

**Unix socket connection:** `enable_cloudsql_volume` defaults to `true`. `App_CloudRun` injects the Auth Proxy sidecar and sets `DB_HOST` to the socket path under `/cloudsql`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `db_name` | 11 | `'ghost'` | MySQL database name. **Do not change after initial deployment.** |
| `db_user` | 11 | `'ghost'` | MySQL application user. Password auto-generated and stored in Secret Manager. |
| `database_password_length` | 11 | `16` | Auto-generated password length. Range: 8–64. `32` recommended for production. |
| `enable_auto_password_rotation` | 11 | `false` | Automated zero-downtime password rotation. See §7.D. |
| `rotation_propagation_delay_sec` | 11 | `90` | Seconds to wait after rotation before restarting the service. |

> `database_type`, `sql_instance_name`, `sql_instance_base_name`, `enable_postgres_extensions`, and `enable_mysql_plugins` are not exposed — Ghost only supports MySQL 8.0, and database setup is managed by `Ghost_Common`'s `db-init.sh` script.

### C. Storage (NFS & GCS)

**NFS is enabled by default** (`enable_nfs = true`). Ghost stores uploaded images, themes, and other content files on the NFS share so that all Cloud Run instances access a consistent filesystem. Requires `execution_environment = 'gen2'`.

**GCS content bucket:** `Ghost_Common` automatically provisions a dedicated `ghost-content` GCS bucket and configures Ghost to use it for media storage via GCS Fuse. This bucket is separate from any buckets in `storage_buckets`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_nfs` | 10 | `true` | Provisions an NFS volume for shared content files. Requires `gen2`. Set `false` if using only GCS Fuse for content storage. |
| `nfs_mount_path` | 10 | `'/mnt/nfs'` | Container path where the NFS share is mounted. |
| `create_cloud_storage` | 10 | `true` | Set `false` to skip additional bucket creation. The `ghost-content` bucket from `Ghost_Common` is always provisioned. |
| `storage_buckets` | 10 | `[{ name_suffix = "data" }]` | Additional GCS buckets beyond the auto-provisioned content bucket. |
| `gcs_volumes` | 10 | `[]` | GCS buckets to mount via GCS Fuse (requires `gen2`). Each entry: `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. |

### D. Networking

Cloud Run uses Direct VPC Egress to reach Cloud SQL's internal IP. Because `enable_cloudsql_volume = true` is the default, the Auth Proxy sidecar handles the Cloud SQL connection via Unix socket.

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 4 | `'all'` | `'all'` — public internet; `'internal'` — VPC only; `'internal-and-cloud-load-balancing'` — forces traffic through the HTTPS Load Balancer. |
| `vpc_egress_setting` | 4 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` routes only RFC 1918 traffic via VPC. `'ALL_TRAFFIC'` routes all egress via VPC. |

> `network_name` is not exposed. The module auto-discovers the `Services_GCP` VPC network.

### E. Initialization & Bootstrap

A `db-init` Cloud Run Job is automatically provisioned by `Ghost_Common` when `initialization_jobs` is left as the default empty list (`[]`). It uses the `mysql:8.0-debian` image and executes `Ghost_Common/scripts/db-init.sh`, which performs the following idempotent operations:

1. Connects to Cloud SQL MySQL via the Auth Proxy Unix socket.
2. Creates the `ghost` database user with the password from Secret Manager.
3. Creates the `ghost` database if it does not exist.
4. Grants the `ghost` user full privileges on the database.

Override `initialization_jobs` with a non-empty list to replace this default with custom jobs. When `initialization_jobs` is non-empty, `Ghost_Common` does not inject the default `db-init` job.

Additional recurring cron jobs can be defined via `cron_jobs`:

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 12 | `[]` | One-shot Cloud Run Jobs. Leave empty for `Ghost_Common` to supply the default `db-init` job. Non-empty list replaces it entirely. Each entry: `name`, `image`, `command`, `args`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `execute_on_apply`, `script_path`. |
| `cron_jobs` | 12 | `[]` | Recurring jobs triggered by Cloud Scheduler. Each entry: `name`, `schedule` (cron UTC), `image`, `command`, `cpu_limit`, `memory_limit`, `paused`. |

**Backup Import:** If `enable_backup_import = true`, a dedicated Cloud Run Job restores a backup into the MySQL database during the apply. See §8.C for all backup variables.

---

## 4. Advanced Security

### A. Cloud Armor WAF

Identical behaviour to `App_CloudRun`. When `enable_cloud_armor = true`, a Global HTTPS Load Balancer with a Cloud Armor WAF policy (OWASP Top 10, adaptive DDoS, 500 req/min rate limiting) is provisioned in front of Cloud Run.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 9 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. Required for custom domains, CDN, and DDoS protection. |
| `admin_ip_ranges` | 9 | `[]` | CIDR ranges exempted from WAF rules (e.g., office VPN, CI/CD egress IPs). |

### B. Identity-Aware Proxy (IAP)

When `enable_iap = true`, Cloud Run's native IAP integration is enabled directly on the service. Google identity authentication is required before requests reach Ghost. Useful for staging environments or internal Ghost admin access.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 4 | `false` | Enables IAP natively on the Cloud Run service. |
| `iap_authorized_users` | 4 | `[]` | Users/service accounts granted access. Format: `'user:email'` or `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 4 | `[]` | Google Groups granted access. Format: `'group:name@example.com'`. |

See [App_CloudRun §4.B](../App_CloudRun/App_CloudRun.md#b-identity-aware-proxy-iap) for the full IAM role details.

### C. Binary Authorization

Identical to `App_CloudRun`. When `enable_binary_authorization = true`, Cloud Run enforces that deployed images carry a valid cryptographic attestation.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_binary_authorization` | 7 | `false` | Enforces image attestation. Requires a Binary Authorization policy and attestor pre-configured in the project. |

### D. VPC Service Controls

Identical to `App_CloudRun`. When `enable_vpc_sc = true`, all GCP API calls from this module are bound within an existing VPC-SC perimeter.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_vpc_sc` | 21 | `false` | Registers module API calls within the project's VPC-SC perimeter. A perimeter must already exist before enabling. |

### E. Secret Manager Integration

Ghost application secrets are stored in Secret Manager and injected natively by Cloud Run at revision start — plaintext is never written to Terraform state.

Unlike Directus or Django, `Ghost_Common` does not auto-generate application-level secrets. The `DB_PASSWORD` and `ROOT_PASSWORD` secrets are provisioned automatically by `App_CloudRun`. User-defined secrets can be added via `secret_environment_variables`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `secret_environment_variables` | 5 | `{}` | Map of env var name → Secret Manager secret ID. Resolved at runtime; never stored in state. (e.g., `{ SMTP_PASSWORD = "ghost-smtp-password" }`) |
| `secret_rotation_period` | 5 | `'2592000s'` | Frequency at which Secret Manager emits rotation notifications. Default: 30 days. |
| `secret_propagation_delay` | 5 | `30` | Seconds to wait after secret creation before dependent resources proceed. |

---

## 5. Traffic & Ingress

### A. HTTPS Load Balancer

Identical to `App_CloudRun`. When `enable_cloud_armor = true`, a Global HTTPS Load Balancer backed by a Serverless NEG is provisioned. Traffic flows: Internet → Cloud Armor → Global HTTPS LB → Serverless NEG → Cloud Run.

Setting `ingress_settings = 'internal-and-cloud-load-balancing'` forces all Ghost traffic through the LB, preventing direct `*.run.app` URL access.

See [App_CloudRun §5.A](../App_CloudRun/App_CloudRun.md#a-https-load-balancer) for full architecture details.

### B. Cloud CDN

When `enable_cdn = true` (requires `enable_cloud_armor = true`), Cloud CDN is attached to the HTTPS Load Balancer backend.

**Ghost consideration:** Ghost serves a mix of public cached pages and authenticated member-only content. Cloud CDN is well-suited for Ghost's public pages and static assets (theme CSS/JS, images). Ghost's built-in caching layer (backed by Redis) already handles page-level caching — CDN adds an additional edge layer for public content. Ensure member-gated content responses include appropriate `Cache-Control` or `Vary` headers before enabling.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cdn` | 9 | `false` | Enables Cloud CDN on the HTTPS LB backend. Only effective when `enable_cloud_armor = true`. |

### C. Custom Domains

Custom domains are attached to the Global HTTPS Load Balancer via `application_domains`. Google-managed SSL certificates are provisioned automatically. DNS must point to the load balancer IP after apply.

| Variable | Group | Default | Description |
|---|---|---|---|
| `application_domains` | 9 | `[]` | Custom domain names for the HTTPS LB. Google-managed SSL certificates provisioned per domain. (e.g., `['ghost.example.com']`) |

After the first apply, retrieve the LB IP from the Terraform output `load_balancer_ip` and create an `A` record. SSL certificate provisioning takes 10–30 minutes after DNS propagation.

---

## 6. CI/CD & Delivery

### A. Cloud Build Triggers

Identical to `App_CloudRun`. When `enable_cicd_trigger = true`, a Cloud Build GitHub connection and push trigger are provisioned. The trigger builds and deploys a custom Ghost image when code is pushed to the configured branch.

**Typical use case:** The default `container_image_source = 'custom'` already uses Cloud Build to build a Ghost image with `Ghost_Common`'s Dockerfile. Enabling a CI/CD trigger automates this pipeline on repository push — useful when Ghost themes, plugins, or configuration are maintained in source control.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 7 | `false` | Provisions a Cloud Build GitHub trigger. Requires `github_repository_url` and credentials. |
| `github_repository_url` | 7 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 7 | `""` | GitHub PAT (`repo`, `admin:repo_hook` scopes). Required on first apply. Sensitive. |
| `github_app_installation_id` | 7 | `""` | GitHub App installation ID (preferred for organisation repos). |
| `cicd_trigger_config` | 7 | `{ branch_pattern = "^main$" }` | Advanced trigger config: `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

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

`min_instance_count = 0` and `max_instance_count = 5` are hardcoded in `main.tf` and are not user-configurable. Ghost cold starts take 15–30 seconds due to theme compilation and database connection setup. The `max_instance_count = 5` ceiling accommodates traffic spikes from newsletter sends and content publication events.

Ghost uses Redis-backed page caching, so multiple instances can serve requests without cache inconsistency. Session management uses database-backed or cookie-based sessions, making horizontal scaling safe.

> To change instance counts, you must modify `main.tf` directly (the merge block in the `locals` section) or deploy via `App_CloudRun` with a custom `application_config`.

### B. Traffic Splitting

Traffic splitting is supported. Ghost's page cache is backed by Redis (shared across instances), making canary deployments safe — cached pages are served consistently regardless of which instance handles the request.

| Variable | Group | Default | Description |
|---|---|---|---|
| `traffic_split` | 3 | `[]` | Percentage-based traffic allocation across named revisions. All entries must sum to 100. Empty sends 100% to the latest revision. |

See [App_CloudRun §7.B](../App_CloudRun/App_CloudRun.md#b-traffic-splitting) for the full configuration syntax.

### C. Health Probes & Uptime Monitoring

Ghost does not expose a dedicated health endpoint. Both the startup and liveness probes target `/` (Ghost's root path), which returns `HTTP 200` when the application is fully initialised.

**Ghost 6.x performs database migrations and theme compilation on first boot.** The startup probe defaults allow 90 seconds of initial delay plus up to 10 retry periods of 10 seconds each — giving Ghost up to 190 seconds of total startup tolerance on cold deployments.

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 13 | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=90, timeout_seconds=10, period_seconds=10, failure_threshold=10 }` | Startup readiness probe. Container receives no traffic until this succeeds. |
| `liveness_probe` | 13 | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=60, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Liveness probe. Container is restarted after `failure_threshold` consecutive failures. |
| `uptime_check_config` | 13 | `{ enabled=true, path="/" }` | Cloud Monitoring uptime check. Alerts notify `support_users` if unreachable. |
| `alert_policies` | 13 | `[]` | Cloud Monitoring metric alert policies. Each: `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`. |

**Differences from `App_CloudRun` probe defaults:**

| Field | `App_CloudRun` | `Ghost_CloudRun` | Reason |
|---|---|---|---|
| `path` | `/healthz` | `/` | Ghost has no `/healthz` endpoint; root returns HTTP 200 when ready. |
| Startup `initial_delay_seconds` | `10` | `90` | Ghost runs DB migrations + theme compilation before accepting traffic. |
| Startup `timeout_seconds` | `5` | `10` | Root path can be slow during first-boot schema setup. |
| Liveness `initial_delay_seconds` | `15` | `60` | Prevents premature restarts before startup completes. |

### D. Auto Password Rotation

When `enable_auto_password_rotation = true`, a zero-downtime password rotation pipeline is provisioned identically to `App_CloudRun`:

1. Secret Manager emits a rotation notification at every `secret_rotation_period` interval.
2. Eventarc fires a Cloud Run rotation Job.
3. The job generates a new password, updates the Cloud SQL MySQL user, writes a new secret version.
4. After `rotation_propagation_delay_sec` seconds, the job restarts the Ghost service.

Ghost re-establishes its database connection on restart and reads the updated `DB_PASSWORD` from Secret Manager. No manual intervention is required.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 11 | `false` | Enables automated password rotation. |
| `rotation_propagation_delay_sec` | 11 | `90` | Seconds to wait after writing the new secret before restarting the service. |
| `secret_rotation_period` | 5 | `'2592000s'` | Rotation frequency. Default: 30 days. |

---

## 8. Integrations

### A. Redis Cache

Redis is **enabled by default** (`enable_redis = true`). `Ghost_Common` configures Ghost's caching backend to use Redis, significantly reducing database query load and improving page delivery speed under concurrent traffic.

When `enable_redis = true` and `redis_host` is not provided, the module defaults to using the NFS server IP as the Redis host (a lightweight Redis instance co-located on the NFS GCE VM). For production deployments, point `redis_host` at a dedicated Google Cloud Memorystore for Redis instance.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 20 | `true` | Enables Redis for Ghost page caching. Recommended for all deployments. |
| `redis_host` | 20 | `""` | Redis server hostname or IP. Leave blank to use the NFS server IP. Override with a Memorystore instance for production. |
| `redis_port` | 20 | `'6379'` | Redis server TCP port (string). |
| `redis_auth` | 20 | `""` | Redis AUTH password. Leave empty if the Redis instance does not require authentication. Sensitive — never stored in state. |

> Note: Redis is in **group 20** in `Ghost_CloudRun` (vs group 10 in `App_CloudRun`).

### B. Email (SMTP)

Ghost uses SMTP for transactional email: member sign-up confirmations, password resets, newsletter sends, and comment notifications. The `environment_variables` variable includes Ghost-specific SMTP defaults.

**Default `environment_variables`:**

```hcl
environment_variables = {
  SMTP_HOST     = ""
  SMTP_PORT     = "25"
  SMTP_USER     = ""
  SMTP_PASSWORD = ""
  SMTP_SSL      = "false"
  EMAIL_FROM    = "ghost@example.com"
}
```

Configure these before going live. Use `secret_environment_variables` for `SMTP_PASSWORD`:

```hcl
environment_variables = {
  SMTP_HOST  = "smtp.mailgun.org"
  SMTP_PORT  = "587"
  SMTP_USER  = "postmaster@mg.example.com"
  SMTP_SSL   = "true"
  EMAIL_FROM = "noreply@example.com"
}

secret_environment_variables = {
  SMTP_PASSWORD = "ghost-smtp-password"
}
```

The `database__client = "mysql"` variable is injected automatically by `main.tf` — do not set it manually in `environment_variables`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `environment_variables` | 5 | SMTP defaults (see above) | Plain-text env vars. Do not include `database__client` here. |
| `secret_environment_variables` | 5 | `{}` | Secret Manager references. Use for `SMTP_PASSWORD` and other sensitive values. |

### C. Backup Import & Recovery

When `enable_backup_import = true`, a dedicated Cloud Run Job restores an existing database backup into the provisioned Cloud SQL MySQL instance. This runs after the `db-init` job and before the Ghost service is deployed.

**Ghost uses `backup_uri`** (like Directus, not `backup_file` as in Django). `backup_uri` accepts a full GCS object URI or Google Drive file ID.

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 6 | `'0 2 * * *'` | Cron expression (UTC) for automated daily backups. |
| `backup_retention_days` | 6 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 6 | `false` | Triggers a one-time restore on apply. Set `false` after a successful import. |
| `backup_source` | 6 | `'gcs'` | `'gcs'` (full GCS URI) or `'gdrive'` (Drive file ID). |
| `backup_uri` | 6 | `""` | Full GCS URI (e.g., `'gs://my-bucket/ghost-2024-01.sql'`) or Google Drive file ID. Maps to `backup_file` in `App_CloudRun`. |
| `backup_format` | 6 | `'sql'` | Backup file format. Options: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

> **Warning:** If the database already contains data, the import may produce errors. Test in a non-production environment before importing into production.

### D. Observability & Alerting

Observability is identical to `App_CloudRun`. A Cloud Monitoring uptime check polls the Ghost endpoint from multiple global locations. Custom alert policies can monitor Cloud Run metrics (latency, error rate, instance count) and notify `support_users`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `uptime_check_config` | 13 | `{ enabled=true, path="/" }` | Uptime check: `enabled`, `path`, `check_interval` (e.g., `"60s"`), `timeout` (e.g., `"10s"`). |
| `alert_policies` | 13 | `[]` | Metric alert policies. Each: `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`, `aggregation_period`. |
| `support_users` | 1 | `[]` | Email addresses notified by uptime and alert policy triggers. |

---

## 9. Platform-Managed Behaviours

The following behaviours are applied automatically by `Ghost_CloudRun` regardless of variable values. They cannot be overridden via `tfvars`.

| Behaviour | Implementation | Detail |
|---|---|---|
| **MySQL 8.0 required** | `database_type = "MYSQL_8_0"` fixed by `Ghost_Common` | Ghost 6.x only supports MySQL. PostgreSQL is not supported. |
| **MySQL client forced** | `database__client = "mysql"` hardcoded in `main.tf` | Without this, Ghost 6.x silently falls back to SQLite even when all other database connection variables are present. |
| **Scale limits fixed** | `min_instance_count = 0`, `max_instance_count = 5` hardcoded in `main.tf` | Not user-configurable via `tfvars`. Modify `main.tf` directly (the `locals` merge block) if different values are required. |
| **GCS content bucket** | `ghost-content` bucket provisioned by `Ghost_Common` via `module_storage_buckets` | A dedicated GCS bucket for Ghost content is provisioned separately from `storage_buckets`. |
| **Unix socket by default** | `enable_cloudsql_volume = true` default | Ghost connects to Cloud SQL via the Auth Proxy Unix socket. Set `false` for TCP. |
| **NFS enabled by default** | `enable_nfs = true` default | NFS shared storage is provisioned for Ghost content files. Requires `execution_environment = 'gen2'`. |
| **Redis enabled by default** | `enable_redis = true` default | Unlike Django (opt-in), Ghost's Redis integration is on by default. When `redis_host` is blank, the NFS server IP is used. |
| **Default db-init job** | Supplied by `Ghost_Common` when `initialization_jobs = []` | MySQL database and user are created automatically. Override with a non-empty `initialization_jobs` list to replace this behaviour. |
| **No auto-generated app secrets** | `module_secret_env_vars = {}` | Ghost manages its own internal signing keys. No `SECRET_KEY` or equivalent is created. |
| **Scripts directory** | `scripts_dir = abspath("${module.ghost_app.path}/scripts")` | Initialization scripts are sourced from `Ghost_Common`, not from the deployment directory. |

**Inline infrastructure** (when no `Services_GCP` stack is present) is identical to `App_CloudRun` §9 — `App_CloudRun` provisions an inline VPC, Cloud NAT, Cloud SQL instance, service accounts, and GCP APIs as required. See [App_CloudRun §9](../App_CloudRun/App_CloudRun.md#9-inline-infrastructure-provisioning) for the full inline resource inventory and teardown notes.

---

## 10. Variable Reference

All user-configurable variables exposed by `Ghost_CloudRun`, sorted by UI group then order. Group 0 variables are reserved for platform metadata — leave them at their defaults for standard deployments.

Variables marked **[fixed]** are hardcoded by the module and cannot be overridden.

| Variable | Group | Default | Description |
|---|---|---|---|
| `module_description` | 0 | (Ghost platform text) | Platform metadata: module description. |
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
| `application_name` | 2 | `'ghost'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 2 | `'Ghost Publishing'` | Human-readable name. Maps to `application_display_name` in `App_CloudRun`. |
| `description` | 2 | `'Ghost - Professional publishing platform'` | Service description. Passed to `Ghost_Common`. |
| `application_version` | 2 | `'6.14.0'` | Ghost container image tag. |
| `deploy_application` | 3 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 3 | `'custom'` | `'custom'` (Cloud Build) or `'prebuilt'` (existing image). |
| `container_image` | 3 | `""` | Container image URI. Leave empty for Cloud Build to manage. |
| `cpu_limit` | 3 | `'2000m'` | CPU per instance. 2 vCPU minimum for Ghost. |
| `memory_limit` | 3 | `'4Gi'` | Memory per instance. 4 Gi recommended for production. |
| `container_port` | 3 | `2368` | Ghost's native port. |
| `execution_environment` | 3 | `'gen2'` | Gen2 required for NFS mounts and GCS Fuse. |
| `timeout_seconds` | 3 | `300` | Max request duration. Increase for newsletter sends. |
| `enable_cloudsql_volume` | 3 | `true` | Default `true` — Ghost connects via Unix socket. |
| `cloudsql_volume_mount_path` | 3 | `'/cloudsql'` | Container path for the Auth Proxy Unix socket. |
| `container_protocol` | 3 | `'http1'` | `'http1'` or `'h2c'`. |
| `enable_image_mirroring` | 3 | `true` | Mirrors the Ghost image into Artifact Registry. |
| `traffic_split` | 3 | `[]` | Canary/blue-green traffic allocation. |
| `service_annotations` | 3 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 3 | `{}` | Labels applied to the Cloud Run service. |
| `min_instance_count` | — | `0` | **[fixed]** Hardcoded in `main.tf`. |
| `max_instance_count` | — | `5` | **[fixed]** Hardcoded in `main.tf`. |
| `ingress_settings` | 4 | `'all'` | `'all'`, `'internal'`, or `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 4 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` or `'ALL_TRAFFIC'`. |
| `enable_iap` | 4 | `false` | Enables IAP natively on the Cloud Run service. |
| `iap_authorized_users` | 4 | `[]` | Users/SAs granted IAP access. |
| `iap_authorized_groups` | 4 | `[]` | Google Groups granted IAP access. |
| `environment_variables` | 5 | SMTP defaults | Plain-text env vars. `database__client` is injected automatically — do not set it here. |
| `secret_environment_variables` | 5 | `{}` | Secret Manager references (e.g., `{ SMTP_PASSWORD = "ghost-smtp-password" }`). |
| `secret_propagation_delay` | 5 | `30` | Seconds to wait after secret creation. |
| `secret_rotation_period` | 5 | `'2592000s'` | Secret Manager rotation notification frequency. |
| `backup_schedule` | 6 | `'0 2 * * *'` | Cron expression (UTC) for automated backups. |
| `backup_retention_days` | 6 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 6 | `false` | Triggers a one-time restore on apply. |
| `backup_source` | 6 | `'gcs'` | `'gcs'` (full URI) or `'gdrive'` (file ID). |
| `backup_uri` | 6 | `""` | Full GCS URI or Google Drive file ID. Maps to `backup_file` in `App_CloudRun`. |
| `backup_format` | 6 | `'sql'` | Backup format. Options: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |
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
| `create_cloud_storage` | 10 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 10 | `[{ name_suffix = "data" }]` | Additional GCS buckets to provision. |
| `enable_nfs` | 10 | `true` | Provisions NFS shared storage for Ghost content. Requires `gen2`. |
| `nfs_mount_path` | 10 | `'/mnt/nfs'` | Container path where NFS is mounted. |
| `gcs_volumes` | 10 | `[]` | GCS buckets to mount via GCS Fuse (requires `gen2`). |
| `db_name` | 11 | `'ghost'` | MySQL database name. Do not change after initial deployment. |
| `db_user` | 11 | `'ghost'` | MySQL application user. |
| `database_password_length` | 11 | `16` | Auto-generated password length. Range: 8–64. |
| `enable_auto_password_rotation` | 11 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 11 | `90` | Seconds to wait after rotation before restarting the service. |
| `initialization_jobs` | 12 | `[]` | One-shot Cloud Run Jobs. Leave empty for `Ghost_Common` to supply the default `db-init` job. |
| `cron_jobs` | 12 | `[]` | Recurring scheduled Cloud Run Jobs. |
| `startup_probe` | 13 | `{ path="/", initial_delay_seconds=90, failure_threshold=10, ... }` | Startup probe. Long initial delay for Ghost DB migrations. |
| `liveness_probe` | 13 | `{ path="/", initial_delay_seconds=60, failure_threshold=3, ... }` | Liveness probe. |
| `uptime_check_config` | 13 | `{ enabled=true, path="/" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 13 | `[]` | Cloud Monitoring metric alert policies. |
| `enable_redis` | 20 | `true` | **Enabled by default.** Redis for Ghost page caching. |
| `redis_host` | 20 | `""` | Redis hostname/IP. Defaults to NFS server IP when empty. |
| `redis_port` | 20 | `'6379'` | Redis TCP port (string). |
| `redis_auth` | 20 | `""` | Redis AUTH password. Sensitive. |
| `enable_vpc_sc` | 21 | `false` | Registers API calls within the project's VPC-SC perimeter. |
