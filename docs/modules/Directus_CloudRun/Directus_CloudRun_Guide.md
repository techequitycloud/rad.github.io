---
title: "Directus Cloud Run Configuration Guide"
sidebar_label: "Cloud Run"
---

# Directus CloudRun Module

<video width="100%" controls style={{marginTop: '20px'}} poster="https://storage.googleapis.com/rad-public-2b65/modules/Directus_CloudRun.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/modules/Directus_CloudRun.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

<a href="https://storage.googleapis.com/rad-public-2b65/modules/Directus_CloudRun.pdf" target="_blank">View Presentation (PDF)</a>



This document provides a comprehensive reference for the `modules/Directus_CloudRun` Terraform module. It covers architecture, IAM, configuration variables, Directus-specific behaviours, and operational patterns for deploying Directus on Google Cloud Run (v2).

---

## 1. Module Overview

Directus is an open-source headless CMS and Backend-as-a-Service (BaaS) platform that wraps any SQL database with auto-generated REST and GraphQL APIs and a no-code admin application. `Directus_CloudRun` is a **wrapper module** built on top of `App_CloudRun`. It uses `App_CloudRun` for all GCP infrastructure provisioning and injects Directus-specific application configuration, security secrets, database initialisation, and storage configuration via `Directus_Common`.

**Key Capabilities:**
*   **Compute**: Cloud Run v2 (Gen2), Node.js container, scale-to-zero by default. Custom image build via Cloud Build is the default workflow.
*   **Data Persistence**: Cloud SQL PostgreSQL with auto-migrations managed by Directus itself. NFS (GCE VM or Filestore) for shared uploaded assets. GCS for object storage via the `gcs` Directus storage driver.
*   **Security**: Four application secrets (KEY, SECRET, ADMIN_PASSWORD, REDIS) auto-generated and stored in Secret Manager. Inherits Cloud Armor WAF, IAP, Binary Authorization, and VPC Service Controls from `App_CloudRun`.
*   **Caching & Rate Limiting**: Redis enabled by default — `Directus_Common` generates the Redis connection URL secret and injects it as the `REDIS` env var.
*   **CI/CD**: Cloud Build custom image pipeline by default; Cloud Deploy progressive delivery optional.
*   **Reliability**: Health probes targeting `/server/health` with timeouts tuned for Directus startup behaviour.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 1 | `string` | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 1 | `list(string)` | `[]` | Email recipients for monitoring alerts. |
| `resource_labels` | 1 | `map(string)` | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 2 | `string` | `'directus'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 2 | `string` | `'Directus CMS'` | Human-readable name shown in the GCP Console. Maps to `application_display_name` in `App_CloudRun`. |
| `description` | 2 | `string` | `'Directus - Open Source Headless CMS and Backend-as-a-Service'` | Cloud Run service description. Maps to `application_description` in `App_CloudRun`. |
| `application_version` | 2 | `string` | `'11.1.0'` | Directus image version tag. Increment to deploy a new release. |

**Wrapper architecture:** `Directus_CloudRun` calls `Directus_Common` to build an `application_config` object containing Directus environment variables, secrets, probe configuration, the `db-init` job, and the uploads bucket definition. This object is passed to `App_CloudRun` via the `application_config`, `module_env_vars`, `module_secret_env_vars`, and `module_storage_buckets` reserved variables.

---

## 2. IAM & Access Control

`Directus_CloudRun` delegates all IAM provisioning to `App_CloudRun`. The Cloud Run SA, Cloud Build SA, IAP service agent, and password rotation role sets are identical to those in [App_CloudRun §2](../App_CloudRun/App_CloudRun.md#2-iam--access-control).

**Directus auto-generated secrets and IAM:** `Directus_Common` creates four Secret Manager secrets during provisioning: `KEY`, `SECRET`, `ADMIN_PASSWORD`, and (when `enable_redis = true`) `REDIS`. These are injected into the Cloud Run revision via `module_secret_env_vars` — the Cloud Run SA requires `roles/secretmanager.secretAccessor`, which is already granted by `App_CloudRun`.

**Database initialisation identity:** The `db-init` Cloud Run Job runs under the Cloud Run SA. It connects to Cloud SQL via TCP using `DB_HOST` (Cloud SQL internal IP), `DB_USER`, and `ROOT_PASSWORD` (from Secret Manager).

**120-second IAM propagation delay:** Inherited from `App_CloudRun` — the Directus service is not deployed until the delay completes, preventing secret-read failures on first revision start.

For the complete role tables and IAP, password rotation, and public access details, see [App_CloudRun §2](../App_CloudRun/App_CloudRun.md#2-iam--access-control).

---

## 3. Core Service Configuration

### A. Compute (Cloud Run)

Directus is a Node.js application. It is lighter than Java workloads but benefits from additional memory for schema caching, extension loading, and API response caches. `Directus_CloudRun` exposes `cpu_limit` and `memory_limit` as dedicated top-level variables.

**Scale-to-zero is enabled by default** (`min_instance_count = 0`). Unlike Cyclos, Directus does not store HTTP sessions in-process — it uses Redis-backed sessions, making cold starts acceptable for non-latency-critical deployments.

**Startup CPU Boost** is always enabled (hardcoded in `App_CloudRun`).

**Container image:** `container_image_source` defaults to `'custom'`, meaning Cloud Build compiles a custom image using `Directus_Common`'s Dockerfile (extending the official `directus/directus` base image). Set `container_image_source = 'prebuilt'` and `container_image = 'directus/directus:11.1.0'` to skip the build and deploy the upstream image directly.

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 3 | `true` | Set `false` for infrastructure-only deployment (SQL, storage, secrets). |
| `container_image_source` | 3 | `'custom'` | `'custom'` builds via Cloud Build (default). `'prebuilt'` deploys an existing image URI. |
| `container_image` | 3 | `""` | Override image URI. Leave empty for Cloud Build to manage the image. |
| `container_build_config` | 3 | `{ enabled = true }` | Cloud Build configuration used when `container_image_source = 'custom'`. |
| `cpu_limit` | 3 | `'1000m'` | CPU per instance. `'2000m'` recommended for production. |
| `memory_limit` | 3 | `'2Gi'` | Memory per instance. `'2Gi'` minimum; increase for large schema deployments. |
| `min_instance_count` | 3 | `0` | `0` enables scale-to-zero. Set `≥1` to eliminate cold starts for latency-sensitive APIs. |
| `max_instance_count` | 3 | `1` | Increase for high-traffic deployments. Multiple instances share sessions via Redis. |
| `container_port` | 3 | `8055` | Directus default port. Change only if running a custom Directus build on a different port. |
| `execution_environment` | 3 | `'gen2'` | Gen2 required for NFS mounts and GCS Fuse. |
| `timeout_seconds` | 3 | `300` | Max request duration. Increase for long-running Directus flows or file uploads. |
| `enable_cloudsql_volume` | 3 | `false` | `false` — Directus connects via TCP to the Cloud SQL internal IP. Set `true` only if your Directus configuration explicitly requires Unix socket paths. |
| `traffic_split` | 3 | `[]` | Percentage-based canary/blue-green traffic allocation. See §7.B. |
| `service_annotations` | 3 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 3 | `{}` | Labels applied to the Cloud Run service. |

**Differences from `App_CloudRun` defaults:**

| Variable | `App_CloudRun` | `Directus_CloudRun` | Reason |
|---|---|---|---|
| `container_image_source` | `'custom'` | `'custom'` | Same — both use Cloud Build by default. |
| `container_port` | `8080` | `8055` | Directus listens on 8055. |
| `enable_cloudsql_volume` | `true` | `false` | Directus uses TCP to internal IP, not Unix socket. |
| `min_instance_count` | `0` | `0` | Same — scale-to-zero is acceptable for Directus (Redis sessions). |
| `memory_limit` (via `container_resources`) | `'512Mi'` | `'2Gi'` | Directus schema cache and extensions require more RAM. |

### B. Database (Cloud SQL — PostgreSQL)

Directus requires **PostgreSQL** — `Directus_Common` hardcodes `DB_CLIENT = "pg"`. MySQL, SQL Server, and `database_type = 'NONE'` are unsupported and will prevent the application from starting.

The module uses `db_name` and `db_user` in place of the `application_database_name` and `application_database_user` variables in `App_CloudRun`. Both map to `DB_DATABASE` and `DB_USER` environment variables inside the container.

**TCP connection:** `enable_cloudsql_volume` defaults to `false`. `App_CloudRun` sets `DB_HOST` to the Cloud SQL internal IP automatically. The Cloud SQL Auth Proxy sidecar is not injected by default.

**Schema management:** `AUTO_MIGRATE = "true"` is injected automatically — Directus applies database migrations on startup. `BOOTSTRAP = "true"` seeds the initial admin user and system collections on first boot. Neither is user-configurable (see §9).

| Variable | Group | Default | Description |
|---|---|---|---|
| `db_name` | 11 | `'directus'` | PostgreSQL database name. Injected as `DB_DATABASE`. **Do not change after initial deployment.** |
| `db_user` | 11 | `'directus'` | PostgreSQL application user. Injected as `DB_USER`. Password auto-generated and stored in Secret Manager as `DB_PASSWORD`. |
| `database_password_length` | 11 | `16` | Auto-generated password length. Range: 8–64. `32` recommended for production. |
| `enable_auto_password_rotation` | 11 | `false` | Automated zero-downtime password rotation. See §7.D. |
| `rotation_propagation_delay_sec` | 11 | `90` | Seconds to wait after rotation before restarting the service. |

> `database_type`, `sql_instance_name`, `sql_instance_base_name`, `enable_postgres_extensions`, and `enable_mysql_plugins` are not exposed — Directus only supports PostgreSQL, and extension installation is managed by `Directus_Common`'s `db-init.sh` script.

### C. Storage (NFS & GCS)

**NFS is enabled by default** (`enable_nfs = true`). Directus stores user-uploaded files on the NFS share so that all Cloud Run instances access a consistent filesystem. When `Services_GCP` is absent, an inline GCE VM NFS server is provisioned (see [App_CloudRun §9](../App_CloudRun/App_CloudRun.md#9-inline-infrastructure-provisioning)). Requires `execution_environment = 'gen2'`.

**GCS uploads bucket:** `Directus_Common` automatically provisions a dedicated uploads bucket named `{project_id}-{tenant_deployment_id}-directus-uploads-{deployment_id}` and injects `STORAGE_LOCATIONS = "gcs"`, `STORAGE_GCS_DRIVER = "gcs"`, and `STORAGE_GCS_BUCKET` — configuring Directus to use GCS as its file storage driver. This bucket is separate from any buckets in `storage_buckets`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_nfs` | 10 | `true` | Provisions an NFS volume for shared uploaded assets. Requires `gen2`. Set `false` if using only GCS for file storage. |
| `nfs_mount_path` | 10 | `'/mnt/nfs'` | Container path where the NFS share is mounted. |
| `create_cloud_storage` | 10 | `true` | Set `false` to skip additional bucket creation. The uploads bucket from `Directus_Common` is always provisioned. |
| `storage_buckets` | 10 | `[{ name_suffix = "data" }]` | Additional GCS buckets beyond the auto-provisioned uploads bucket. |
| `gcs_volumes` | 10 | `[]` | GCS buckets to mount via GCS Fuse (requires `gen2`). Each entry: `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. |

> `nfs_instance_name` and `nfs_instance_base_name` are not exposed — use `App_CloudRun` directly if you need to target a named NFS instance.

### D. Networking

Cloud Run uses Direct VPC Egress to reach Cloud SQL's internal IP without a Serverless VPC Access Connector. Because `enable_cloudsql_volume = false` is the default, `DB_HOST` is set to the Cloud SQL internal IP automatically by `App_CloudRun`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 4 | `'all'` | `'all'` — public internet; `'internal'` — VPC only; `'internal-and-cloud-load-balancing'` — forces traffic through the HTTPS Load Balancer. |
| `vpc_egress_setting` | 4 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` routes only RFC 1918 traffic via VPC. `'ALL_TRAFFIC'` routes all egress via VPC (required for strict NAT/firewall setups). |

> `network_name` is not exposed. The module auto-discovers the `Services_GCP` VPC network. If multiple VPCs exist in the project, deploy via `App_CloudRun` directly with `network_name` set explicitly.

### E. Initialization & Bootstrap

A `db-init` Cloud Run Job is automatically provisioned by `Directus_Common` and runs on every `terraform apply` (`execute_on_apply = true`). It uses a PostgreSQL client image and executes `Directus_Common/scripts/db-init.sh`, which performs the following idempotent operations:

1. Connects to Cloud SQL via TCP (using `DB_HOST` and `DB_PORT`).
2. Creates the `directus` database user with the password from Secret Manager (`DB_PASSWORD`).
3. Creates the `directus` database if it does not exist.
4. Installs the required PostgreSQL extensions: `uuid-ossp`, `postgis`.
5. Grants the `directus` user full privileges on the schema, tables, sequences, and functions.
6. Sends a shutdown signal to the Cloud SQL Proxy sidecar (`/quitquitquit`) if present.

Extensions are installed as the `postgres` superuser via the `ROOT_PASSWORD` secret. `enable_postgres_extensions` is not exposed — the extension set is managed entirely by `Directus_Common`.

After `db-init` completes, Directus applies database migrations and bootstraps the admin user automatically on first start via `AUTO_MIGRATE = "true"` and `BOOTSTRAP = "true"` (see §9).

Additional initialization jobs and recurring cron jobs can be defined via the `initialization_jobs` and `cron_jobs` variables:

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 12 | `[]` | Additional one-shot Cloud Run Jobs. The `db-init` job is always injected by `Directus_Common` and does not need to be re-declared. Each entry: `name`, `image`, `command`, `args`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `execute_on_apply`, `script_path`. |
| `cron_jobs` | 12 | `[]` | Recurring jobs triggered by Cloud Scheduler. Each entry: `name`, `schedule` (cron UTC), `image`, `command`, `cpu_limit`, `memory_limit`, `paused`. |

**Backup Import:** If `enable_backup_import = true`, a dedicated Cloud Run Job restores a backup into the PostgreSQL database during the apply, after the `db-init` job. See §8.C for all backup variables.

---

## 4. Advanced Security

### A. Cloud Armor WAF

Identical behaviour to `App_CloudRun`. When `enable_cloud_armor = true`, a Global HTTPS Load Balancer with a Cloud Armor WAF policy (OWASP Top 10, adaptive DDoS, 500 req/min rate limiting) is provisioned in front of Cloud Run.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 9 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. Required for custom domains, CDN, and DDoS protection. |
| `admin_ip_ranges` | 9 | `[]` | CIDR ranges exempted from WAF rules (e.g., office VPN, CI/CD egress IPs). |

> Note: Cloud Armor is in **group 9** in `Directus_CloudRun` (vs group 16 in `App_CloudRun`).

### B. Identity-Aware Proxy (IAP)

When `enable_iap = true`, Cloud Run's native IAP integration (`iap_enabled`, BETA launch stage) is enabled directly on the service. Google identity authentication is required before requests reach Directus. The public `allUsers` invoker binding is removed. Both `roles/iap.httpsResourceAccessor` (project-level) and `roles/run.invoker` (service-level) are granted to authorised principals.

IAP does not require `enable_cloud_armor`. See [App_CloudRun §4.B](../App_CloudRun/App_CloudRun.md#b-identity-aware-proxy-iap) for the full IAM role details.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 4 | `false` | Enables IAP natively on the Cloud Run service. Recommended for admin-facing or internal-only Directus deployments. |
| `iap_authorized_users` | 4 | `[]` | Users/service accounts granted access. Format: `'user:email'` or `'serviceAccount:sa@...'`. The Terraform executor is automatically included. |
| `iap_authorized_groups` | 4 | `[]` | Google Groups granted access. Format: `'group:name@example.com'`. |

> Note: IAP is in **group 4** (merged with networking) in `Directus_CloudRun` (vs group 15 in `App_CloudRun`).

### C. Binary Authorization

Identical to `App_CloudRun`. When `enable_binary_authorization = true`, Cloud Run enforces that deployed images carry a valid cryptographic attestation. The Cloud Build pipeline attests the image before triggering deployment.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_binary_authorization` | 7 | `false` | Enforces image attestation. Requires a Binary Authorization policy and attestor pre-configured in the project. |

> `binauthz_evaluation_mode` is not exposed in `Directus_CloudRun`. To set a custom evaluation mode, deploy via `App_CloudRun` directly.

### D. VPC Service Controls

Identical to `App_CloudRun`. When `enable_vpc_sc = true`, all GCP API calls from this module are bound within an existing VPC-SC perimeter, creating a security boundary around Cloud Run, Secret Manager, Cloud SQL, and Artifact Registry.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_vpc_sc` | 21 | `false` | Registers module API calls within the project's VPC-SC perimeter. A perimeter must already exist before enabling. |

> Note: VPC SC is in **group 21** in `Directus_CloudRun` (vs group 17 in `App_CloudRun`).

### E. Secret Manager Integration

Directus application secrets are stored in Secret Manager and injected natively by Cloud Run at revision start — plaintext is never written to Terraform state.

`Directus_Common` auto-generates four secrets: `KEY` (Directus encryption key), `SECRET` (JWT signing secret), `ADMIN_PASSWORD` (initial admin user password), and `REDIS` (Redis connection URL, when `enable_redis = true`). These are injected as `module_secret_env_vars` and require no user configuration.

The `DB_PASSWORD` and `ROOT_PASSWORD` secrets are provisioned automatically by `App_CloudRun` and consumed by the `db-init` job. User-defined secrets can be added via `secret_environment_variables`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `secret_environment_variables` | 5 | `{}` | Map of env var name → Secret Manager secret ID. Resolved at runtime by Cloud Run; never stored in state. (e.g., `{ SMTP_PASSWORD = "directus-smtp-password" }`) |
| `secret_rotation_period` | 5 | `'2592000s'` | Frequency at which Secret Manager emits rotation notifications. Default: 30 days. |
| `secret_propagation_delay` | 5 | `30` | Seconds to wait after secret creation before dependent resources proceed. |

---

## 5. Traffic & Ingress

### A. HTTPS Load Balancer

Identical to `App_CloudRun`. When `enable_cloud_armor = true`, a Global HTTPS Load Balancer backed by a Serverless NEG is provisioned. Traffic flows: Internet → Cloud Armor → Global HTTPS LB → Serverless NEG → Cloud Run.

Setting `ingress_settings = 'internal-and-cloud-load-balancing'` forces all Directus traffic through the LB, preventing direct `*.run.app` URL access.

See [App_CloudRun §5.A](../App_CloudRun/App_CloudRun.md#a-https-load-balancer) for full architecture details.

### B. Cloud CDN

When `enable_cdn = true` (requires `enable_cloud_armor = true`), Cloud CDN is attached to the HTTPS Load Balancer backend.

**Directus consideration:** The Directus Admin App and API serve a mix of authenticated and public content. CDN caching is most effective for unauthenticated API endpoints, public file assets served from the uploads bucket, and static frontend assets. Ensure that authenticated API responses include appropriate `Cache-Control: no-store` headers before enabling CDN to prevent private data from being cached at edge locations.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cdn` | 9 | `false` | Enables Cloud CDN on the HTTPS LB backend. Only effective when `enable_cloud_armor = true`. |

### C. Custom Domains

Custom domains are attached to the Global HTTPS Load Balancer via `application_domains`. Google-managed SSL certificates are provisioned automatically. DNS must point to the load balancer IP after apply.

| Variable | Group | Default | Description |
|---|---|---|---|
| `application_domains` | 9 | `[]` | Custom domain names for the HTTPS LB. Google-managed SSL certificates provisioned per domain. DNS must point to the LB IP. (e.g., `['cms.myapp.com']`) |

After the first apply, retrieve the LB IP from the Terraform output `load_balancer_ip` and create an `A` record. SSL certificate provisioning takes 10–30 minutes after DNS propagation.

---

## 6. CI/CD & Delivery

### A. Cloud Build Triggers

Identical to `App_CloudRun`. When `enable_cicd_trigger = true`, a Cloud Build GitHub connection and push trigger are provisioned. The trigger builds and deploys a custom Directus image when code is pushed to the configured branch.

**Typical use case:** The default `container_image_source = 'custom'` already uses Cloud Build to build a Directus image with `Directus_Common`'s Dockerfile. Enabling a CI/CD trigger allows this same pipeline to fire automatically on repository push, for example when custom Directus extensions or configuration are updated.

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

**Note:** `cicd_enable_cloud_deploy` is not exposed in `Directus_CloudRun`. Cloud Deploy release creation from Cloud Build is controlled automatically when both `enable_cicd_trigger` and `enable_cloud_deploy` are `true`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 7 | `false` | Provisions a Cloud Deploy pipeline. Requires `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 7 | `[dev, staging, prod(approval)]` | Ordered promotion stages. Each: `name`, `target_name`, `service_name`, `require_approval`, `auto_promote`. |

See [App_CloudRun §6.B](../App_CloudRun/App_CloudRun.md#b-cloud-deploy-pipeline) for the approval workflow and multi-project deployment details.

---

## 7. Reliability & Scheduling

### A. Scaling & Concurrency

Directus uses Redis-backed sessions, so multiple instances can run concurrently without session affinity. Scale-to-zero (`min_instance_count = 0`) is safe for non-latency-critical deployments. Set `min_instance_count = 1` and increase `max_instance_count` for high-traffic deployments.

| Variable | Group | Default | Description |
|---|---|---|---|
| `min_instance_count` | 3 | `0` | `0` enables scale-to-zero. Set `≥1` to eliminate cold starts for latency-sensitive APIs. |
| `max_instance_count` | 3 | `1` | Increase for high-traffic deployments. Multiple instances share sessions via Redis. |

**Startup CPU Boost** is always enabled (hardcoded in `App_CloudRun`). CPU allocation during startup is boosted automatically; no variable is needed to configure this.

### B. Traffic Splitting

Traffic splitting is fully supported for Directus. Because Directus stores sessions in Redis (not in-process), requests for the same user can be routed to different revisions without breaking session continuity — making canary deployments safe.

| Variable | Group | Default | Description |
|---|---|---|---|
| `traffic_split` | 3 | `[]` | Percentage-based traffic allocation across named revisions. All entries must sum to 100. Empty sends 100% to the latest revision. |

See [App_CloudRun §7.B](../App_CloudRun/App_CloudRun.md#b-traffic-splitting) for the full configuration syntax.

### C. Health Probes & Uptime Monitoring

Directus exposes a `/server/health` endpoint that reflects both application and database readiness. Both the startup and liveness probes target this endpoint. In `Directus_CloudRun` the probe variables are renamed — `startup_probe` (not `startup_probe_config`) and `liveness_probe` (not `health_check_config`) — with defaults tuned for Directus's Node.js startup behaviour.

**Startup probe:** Fires after a 30-second initial delay. With `failure_threshold = 10` and `period_seconds = 20`, Cloud Run allows up to 3 minutes of additional startup time. On first deployment, when Directus runs `BOOTSTRAP` to seed the database, startup may take longer — consider increasing `failure_threshold`.

**Liveness probe:** Fires after a 15-second initial delay with a 30-second period. Prevents premature restarts during startup.

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 13 | `{ enabled=true, type="HTTP", path="/server/health", initial_delay_seconds=30, timeout_seconds=5, period_seconds=20, failure_threshold=10 }` | Startup readiness probe. Container receives no traffic until this succeeds. |
| `liveness_probe` | 13 | `{ enabled=true, type="HTTP", path="/server/health", initial_delay_seconds=15, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Liveness probe. Container is restarted after `failure_threshold` consecutive failures. |
| `uptime_check_config` | 13 | `{ enabled=true, path="/" }` | Cloud Monitoring uptime check. Alerts notify `support_users` if unreachable. |
| `alert_policies` | 13 | `[]` | Cloud Monitoring metric alert policies. Each: `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`. |

**Differences from `App_CloudRun` probe defaults:**

| Field | `App_CloudRun` | `Directus_CloudRun` | Reason |
|---|---|---|---|
| Variable names | `startup_probe_config` / `health_check_config` | `startup_probe` / `liveness_probe` | Shorter names aligned with `Directus_Common` interface |
| `path` | `/healthz` | `/server/health` | Directus exposes health at `/server/health` |
| Startup `initial_delay_seconds` | `10` | `30` | Directus + database connection takes 20–60s on cold start |
| Startup `failure_threshold` | `10` | `10` | Same — sufficient retry budget for first-boot migrations |
| Startup `period_seconds` | `10` | `20` | Less aggressive polling reduces load during startup |
| Liveness `initial_delay_seconds` | `15` | `15` | Same — aligns with typical Node.js startup time |

### D. Auto Password Rotation

When `enable_auto_password_rotation = true`, a zero-downtime password rotation pipeline is provisioned identically to `App_CloudRun`:

1. Secret Manager emits a rotation notification at every `secret_rotation_period` interval.
2. Eventarc fires a Cloud Run rotation Job.
3. The job generates a new password, updates the Cloud SQL PostgreSQL user, writes a new secret version.
4. After `rotation_propagation_delay_sec` seconds, the job restarts the Directus service.

Directus establishes a new database connection pool on restart and reads the updated `DB_PASSWORD` from Secret Manager. No manual intervention is required.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 11 | `false` | Enables automated password rotation. |
| `rotation_propagation_delay_sec` | 11 | `90` | Seconds to wait after writing the new secret before restarting the service. |
| `secret_rotation_period` | 5 | `'2592000s'` | Rotation frequency. Default: 30 days. |

---

## 8. Integrations

### A. Redis Cache

Redis is **enabled by default** (`enable_redis = true`). `Directus_Common` generates a Redis connection URL secret (`REDIS`) and injects it as an environment variable — Directus uses this for in-memory caching of API responses, schema data, and rate limiting.

When `enable_redis = true` and `redis_host` is not provided, the module defaults to using the NFS server IP as the Redis host (a lightweight Redis instance co-located on the NFS GCE VM). For production deployments, point `redis_host` at a dedicated Google Cloud Memorystore for Redis instance.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 20 | `true` | Enables Redis for Directus caching and rate limiting. Recommended for all deployments. |
| `redis_host` | 20 | `""` | Redis server hostname or IP. Leave blank to use the NFS server IP. Override with a Memorystore instance for production. |
| `redis_port` | 20 | `'6379'` | Redis server TCP port. |
| `redis_auth` | 20 | `""` | Redis AUTH password. Leave empty if the Redis instance does not require authentication. Sensitive — never stored in state. |

> Note: Redis is in **group 20** in `Directus_CloudRun` (vs group 10 in `App_CloudRun`).

### B. Email (SMTP)

Directus uses SMTP for transactional email: user invitations, password resets, and notification flows. The `environment_variables` variable includes Directus-specific SMTP defaults using the `EMAIL_` prefix convention.

**Default `environment_variables`:**

```hcl
environment_variables = {
  EMAIL_SMTP_HOST     = ""
  EMAIL_SMTP_PORT     = "25"
  EMAIL_SMTP_USER     = ""
  EMAIL_SMTP_PASSWORD = ""
  EMAIL_SMTP_SECURE   = "false"
  EMAIL_EMAIL_FROM    = "admin@example.com"
}
```

Configure these before going live. Use `secret_environment_variables` for `EMAIL_SMTP_PASSWORD`:

```hcl
environment_variables = {
  EMAIL_SMTP_HOST   = "smtp.sendgrid.net"
  EMAIL_SMTP_PORT   = "587"
  EMAIL_SMTP_USER   = "apikey"
  EMAIL_SMTP_SECURE = "true"
  EMAIL_EMAIL_FROM  = "noreply@myapp.example.com"
}

secret_environment_variables = {
  EMAIL_SMTP_PASSWORD = "directus-smtp-password"
}
```

| Variable | Group | Default | Description |
|---|---|---|---|
| `environment_variables` | 5 | SMTP defaults (see above) | Plain-text env vars. Override SMTP settings here. Do not put passwords in this map. |
| `secret_environment_variables` | 5 | `{}` | Secret Manager references. Use for `EMAIL_SMTP_PASSWORD` and any other sensitive values. |

### C. Backup Import & Recovery

When `enable_backup_import = true`, a dedicated Cloud Run Job restores an existing database backup into the provisioned Cloud SQL PostgreSQL instance. This runs after the `db-init` job and before the Directus service is deployed.

The primary naming difference from `App_CloudRun` is **`backup_uri`** (used here) vs **`backup_file`** (used in `App_CloudRun`). `backup_uri` accepts a full GCS object URI or Google Drive file ID.

The **default `backup_format` is `'sql'`**, reflecting plain SQL dump format. Use `'gz'` for compressed `pg_dump` output.

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 6 | `'0 2 * * *'` | Cron expression (UTC) for automated daily backups. |
| `backup_retention_days` | 6 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 6 | `false` | Triggers a one-time restore on apply. Set `false` after a successful import. |
| `backup_source` | 6 | `'gcs'` | `'gcs'` (full GCS URI) or `'gdrive'` (Drive file ID). |
| `backup_uri` | 6 | `""` | Full GCS URI (e.g., `'gs://my-bucket/directus-2024-01.sql'`) or Google Drive file ID. Maps to `backup_file` in `App_CloudRun`. |
| `backup_format` | 6 | `'sql'` | Backup file format. Options: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

> **Warning:** If the database already contains data, the import may produce errors. Test in a non-production environment before importing into production.

### D. Observability & Alerting

Observability is identical to `App_CloudRun`. A Cloud Monitoring uptime check polls the Directus endpoint at the configured interval from multiple global locations. Custom alert policies can monitor Cloud Run metrics (latency, error rate, instance count) and notify `support_users`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `uptime_check_config` | 13 | `{ enabled=true, path="/" }` | Uptime check: `enabled`, `path`, `check_interval` (e.g., `"60s"`), `timeout` (e.g., `"10s"`). |
| `alert_policies` | 13 | `[]` | Metric alert policies. Each: `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`, `aggregation_period`. |
| `support_users` | 1 | `[]` | Email addresses notified by uptime and alert policy triggers. |

> Note: Observability is in **group 13** in `Directus_CloudRun` (vs group 5 in `App_CloudRun`).

---

## 9. Platform-Managed Behaviours

The following behaviours are applied automatically by `Directus_CloudRun` regardless of variable values. They cannot be overridden via `tfvars`.

| Behaviour | Implementation | Detail |
|---|---|---|
| **PostgreSQL required** | `DB_CLIENT = "pg"` hardcoded in `Directus_Common` | Directus only supports PostgreSQL. `database_type`, `enable_mysql_plugins`, and MySQL-specific variables are not exposed. |
| **Auto-migration** | `AUTO_MIGRATE = "true"` injected via `Directus_Common` | Directus applies pending database schema migrations on every startup. Do not run manual Directus migrations against a module-managed database. |
| **Bootstrap** | `BOOTSTRAP = "true"` injected via `Directus_Common` | Directus creates the initial admin user and system collections on first boot. Subsequent starts are idempotent. |
| **Directus secrets** | `KEY`, `SECRET`, `ADMIN_PASSWORD`, `REDIS` auto-generated by `Directus_Common` | Four Secret Manager secrets are created and injected as `module_secret_env_vars`. The Cloud Run SA requires `roles/secretmanager.secretAccessor`, granted by `App_CloudRun`. |
| **GCS uploads bucket** | `directus-uploads` bucket provisioned by `Directus_Common` | A dedicated bucket is provisioned and `STORAGE_LOCATIONS = "gcs"`, `STORAGE_GCS_DRIVER = "gcs"`, `STORAGE_GCS_BUCKET` are injected. This bucket is separate from `storage_buckets`. |
| **TCP database connection** | `enable_cloudsql_volume` defaults to `false` | Directus connects to Cloud SQL via direct TCP to the internal IP. `DB_HOST` is set to the Cloud SQL internal IP automatically by `App_CloudRun`. The Cloud SQL Auth Proxy sidecar is not injected by default. |
| **NFS enabled by default** | `enable_nfs = true` default | NFS shared storage is provisioned for uploaded assets so all Cloud Run instances see a consistent filesystem. Requires `execution_environment = 'gen2'`. |
| **Redis enabled by default** | `enable_redis = true` default | Redis is used for caching and rate limiting. `Directus_Common` generates the `REDIS` connection URL secret automatically. |
| **Scripts directory** | `scripts_dir = abspath("${module.directus_app.path}/scripts")` | Initialization and utility scripts are sourced from `Directus_Common`, not from the deployment directory. |

**Inline infrastructure** (when no `Services_GCP` stack is present) is identical to `App_CloudRun` §9 — `App_CloudRun` provisions an inline VPC, Cloud NAT, Cloud SQL instance, service accounts, and GCP APIs as required. See [App_CloudRun §9](../App_CloudRun/App_CloudRun.md#9-inline-infrastructure-provisioning) for the full inline resource inventory and teardown notes.

---

## 10. Variable Reference

All user-configurable variables exposed by `Directus_CloudRun`, sorted by UI group then order. Group 0 variables are reserved for platform metadata — leave them at their defaults for standard deployments.

Variables marked **[fixed]** are hardcoded by the module and cannot be overridden.

| Variable | Group | Default | Description |
|---|---|---|---|
| `module_description` | 0 | (Directus platform text) | Platform metadata: module description. |
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
| `application_name` | 2 | `'directus'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 2 | `'Directus CMS'` | Human-readable name. Maps to `application_display_name` in `App_CloudRun`. |
| `description` | 2 | `'Directus - Open Source Headless CMS and Backend-as-a-Service'` | Cloud Run service description. Maps to `application_description` in `App_CloudRun`. |
| `application_version` | 2 | `'11.1.0'` | Directus container image tag. |
| `deploy_application` | 3 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 3 | `'custom'` | `'custom'` (Cloud Build) or `'prebuilt'` (existing image). |
| `container_image` | 3 | `""` | Container image URI. Leave empty for Cloud Build to manage. |
| `container_build_config` | 3 | `{ enabled = true }` | Cloud Build config (used when `container_image_source = 'custom'`). |
| `cpu_limit` | 3 | `'1000m'` | CPU per instance. `'2000m'` recommended for production. |
| `memory_limit` | 3 | `'2Gi'` | Memory per instance. `'2Gi'` minimum for production. |
| `min_instance_count` | 3 | `0` | `0` = scale-to-zero (acceptable due to Redis sessions). |
| `max_instance_count` | 3 | `1` | Increase for high-traffic deployments (requires Redis). |
| `container_port` | 3 | `8055` | Directus default port. |
| `execution_environment` | 3 | `'gen2'` | Gen2 required for NFS mounts and GCS Fuse. |
| `timeout_seconds` | 3 | `300` | Max request duration. Increase for long uploads or flows. |
| `enable_cloudsql_volume` | 3 | `false` | Set `true` for Unix socket connectivity (not recommended for Directus). |
| `container_protocol` | 3 | `'http1'` | `'http1'` or `'h2c'`. |
| `cloudsql_volume_mount_path` | 3 | `'/cloudsql'` | Container path for Auth Proxy socket (only when `enable_cloudsql_volume = true`). |
| `enable_image_mirroring` | 3 | `true` | Mirrors the Directus image into Artifact Registry. |
| `traffic_split` | 3 | `[]` | Canary/blue-green traffic allocation. Safe to use with Directus (Redis sessions). |
| `service_annotations` | 3 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 3 | `{}` | Labels applied to the Cloud Run service. |
| `ingress_settings` | 4 | `'all'` | `'all'`, `'internal'`, or `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 4 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` or `'ALL_TRAFFIC'`. |
| `enable_iap` | 4 | `false` | Enables IAP natively on the Cloud Run service (BETA). |
| `iap_authorized_users` | 4 | `[]` | Users/SAs granted IAP access. |
| `iap_authorized_groups` | 4 | `[]` | Google Groups granted IAP access. |
| `environment_variables` | 5 | SMTP defaults | Plain-text env vars. Includes `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASSWORD`, `EMAIL_SMTP_SECURE`, `EMAIL_EMAIL_FROM`. |
| `secret_environment_variables` | 5 | `{}` | Secret Manager references (e.g., `{ EMAIL_SMTP_PASSWORD = "directus-smtp-password" }`). |
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
| `enable_nfs` | 10 | `true` | Provisions NFS shared storage for uploaded assets. Requires `gen2`. |
| `nfs_mount_path` | 10 | `'/mnt/nfs'` | Container path where NFS is mounted. |
| `gcs_volumes` | 10 | `[]` | GCS buckets to mount via GCS Fuse (requires `gen2`). |
| `db_name` | 11 | `'directus'` | PostgreSQL database name. Injected as `DB_DATABASE`. Maps to `application_database_name` in `App_CloudRun`. |
| `db_user` | 11 | `'directus'` | PostgreSQL application user. Injected as `DB_USER`. Maps to `application_database_user` in `App_CloudRun`. |
| `database_password_length` | 11 | `16` | Auto-generated password length. Range: 8–64. |
| `enable_auto_password_rotation` | 11 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 11 | `90` | Seconds to wait after rotation before restarting the service. |
| `initialization_jobs` | 12 | `[]` | Additional one-shot Cloud Run Jobs (`db-init` is always injected by `Directus_Common`). |
| `cron_jobs` | 12 | `[]` | Recurring scheduled Cloud Run Jobs. |
| `startup_probe` | 13 | `{ path="/server/health", initial_delay_seconds=30, failure_threshold=10, ... }` | Startup probe. Maps to `startup_probe_config` in `App_CloudRun`. |
| `liveness_probe` | 13 | `{ path="/server/health", initial_delay_seconds=15, failure_threshold=3, ... }` | Liveness probe. Maps to `health_check_config` in `App_CloudRun`. |
| `uptime_check_config` | 13 | `{ enabled=true, path="/" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 13 | `[]` | Cloud Monitoring metric alert policies. |
| `enable_redis` | 20 | `true` | **Enabled by default.** Redis for caching and rate limiting. |
| `redis_host` | 20 | `""` | Redis hostname/IP. Defaults to NFS server IP when empty. |
| `redis_port` | 20 | `'6379'` | Redis TCP port. |
| `redis_auth` | 20 | `""` | Redis AUTH password. Sensitive. |
| `enable_vpc_sc` | 21 | `false` | Registers API calls within the project's VPC-SC perimeter. |
