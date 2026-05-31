# Zammad on Google Cloud Run

This document provides a comprehensive reference for the `modules/Zammad_CloudRun` Terraform module. It covers architecture, IAM, configuration variables, Zammad-specific behaviours, and operational patterns for deploying Zammad on Google Cloud Run (v2).

---

## 1. Module Overview

Zammad is an open-source helpdesk and customer support platform — a GDPR-compliant alternative to Zendesk and Freshdesk. `Zammad_CloudRun` is a **wrapper module** built on top of `App_CloudRun`. It uses `App_CloudRun` for all GCP infrastructure provisioning and injects Zammad-specific application configuration, database initialisation, and storage configuration via `Zammad_Common`.

**Key Capabilities:**
*   **Compute**: Cloud Run v2 (Gen2), Rails-based container, 2 vCPU / 4 Gi by default. Scale-to-one (`min_instance_count = 1`) with `max_instance_count = 5` — configurable.
*   **Data Persistence**: Cloud SQL **PostgreSQL 15** (required — MySQL is not supported). NFS (GCE VM or Filestore) for Zammad attachment storage at `/opt/zammad/storage`. GCS `zammad-attachments` bucket auto-provisioned by `Zammad_Common`.
*   **Security**: Inherits Cloud Armor WAF, IAP, Binary Authorization, and VPC Service Controls from `App_CloudRun`. No application-level secrets are auto-generated — Zammad manages its own internal keys.
*   **Caching & Background Jobs**: Redis **enabled by default** (`enable_redis = true`). Zammad requires Redis for ActionCable WebSocket pub/sub and Sidekiq background job processing. Without Redis, Zammad will fail to start.
*   **Container Build**: `container_image_source = 'custom'` by default — Cloud Build builds a custom image using `Zammad_Common`'s Dockerfile, which extends the official `zammad/zammad` Docker Hub image and adds the custom `entrypoint.sh`.
*   **Reliability**: Health probes target `/api/v1/ping` with a 60-second initial delay. Zammad runs DB migrations on every startup — the startup probe is deliberately lenient (30 failure threshold).

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 2 | `string` | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `list(string)` | `[]` | Email recipients for monitoring alerts. |
| `resource_labels` | 2 | `map(string)` | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `string` | `'zammad'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 3 | `string` | `'Zammad Helpdesk'` | Human-readable name shown in the GCP Console. Maps to `application_display_name` in `App_CloudRun`. |
| `description` | 3 | `string` | `'Zammad - Open-source helpdesk and customer support platform'` | Cloud Run service description. Passed to `Zammad_Common`. |
| `application_version` | 3 | `string` | `'6.4.1'` | Zammad image version tag. Increment to deploy a new release. |

**Wrapper architecture:** `Zammad_CloudRun` calls `Zammad_Common` to build an `application_config` object containing Zammad-specific environment variables, probe configuration, and the `db-init` job definition. `Zammad_Common` hardcodes `database_type = "POSTGRES_15"` and sets default environment variables (`POSTGRESQL_PORT`, `RAILS_ENV`, `NODE_ENV`, `ZAMMAD_RAILSSERVER_HOST`, `ZAMMAD_RAILSSERVER_PORT`, `NGINX_SERVER_NAME`). The custom `entrypoint.sh` maps Foundation-injected `DB_*` variables to Zammad's `POSTGRESQL_*` convention and runs `zammad-init` (DB migrations + seed) before starting the Rails server. `REDIS_URL` is constructed in `module_env_vars` at the application module level from `redis_host`, `redis_port`, and `redis_auth`. `module_storage_buckets` carries the `zammad-attachments` bucket provisioned by `Zammad_Common`. `scripts_dir` is resolved to `abspath("${module.zammad_app.path}/scripts")` at apply time.

**PostgreSQL requirement:** Zammad requires **PostgreSQL 13 or later**. MySQL is not supported and will be rejected by the `validation.tf` precondition at plan time. The default is PostgreSQL 15.

---

## 2. IAM & Access Control

`Zammad_CloudRun` delegates all IAM provisioning to `App_CloudRun`. The Cloud Run SA, Cloud Build SA, IAP service agent, and password rotation role sets are identical to those in [App_CloudRun §2](../App_CloudRun/App_CloudRun.md#2-iam--access-control).

**No application-level secrets:** `Zammad_Common` does not auto-generate application secrets (`module_secret_env_vars = {}`). Zammad manages its own internal signing keys at runtime. The `DB_PASSWORD` and `ROOT_PASSWORD` secrets are provisioned automatically by `App_CloudRun` and consumed by the `db-init` job.

**Database initialisation identity:** The `db-init` Cloud Run Job runs under the Cloud Run SA. It uses the `postgres:15-alpine` image and connects to Cloud SQL PostgreSQL via the Auth Proxy Unix socket. The `db-init.sh` script creates the `zammad` database and user, runs the initial schema, and exits idempotently — re-running it is safe.

**Redis connectivity:** When `enable_redis = true`, the `REDIS_URL` environment variable is constructed and injected at apply time. It is a plain-text value — not stored in Secret Manager. If the Redis instance requires AUTH (`redis_auth != ""`), the password is embedded in the URL. For production deployments, consider using a dedicated Memorystore for Redis instance with AUTH enabled.

**120-second IAM propagation delay:** Inherited from `App_CloudRun` — the Zammad service is not deployed until the delay completes, preventing secret-read failures on the first revision start.

For the complete role tables and IAP, password rotation, and public access details, see [App_CloudRun §2](../App_CloudRun/App_CloudRun.md#2-iam--access-control).

---

## 3. Core Service Configuration

### A. Compute (Cloud Run)

Zammad is a Ruby on Rails application with substantial resource requirements. It performs DB migrations, seeds data, and initialises background worker queues on every startup. `Zammad_CloudRun` exposes `cpu_limit` and `memory_limit` as dedicated top-level variables.

**Minimum memory:** Zammad 6.x requires at least 2 Gi RAM for reliable operation. The default is 4 Gi. Do not reduce below 2 Gi.

**min_instance_count defaults to 1** — Zammad has a long startup time (60–90 seconds) due to DB migrations and worker initialisation. Scale-to-zero (`min_instance_count = 0`) is technically possible but results in user-visible cold starts. For production helpdesks, keep `min_instance_count = 1`.

**Startup CPU Boost** is always enabled (hardcoded in `App_CloudRun`).

**Container image:** `container_image_source` defaults to `'custom'`, meaning Cloud Build compiles a custom image using `Zammad_Common`'s Dockerfile (which wraps the official `zammad/zammad` image with the GCP-specific `entrypoint.sh`). Set `container_image_source = 'prebuilt'` and `container_image = 'zammad/zammad:6.4.1'` to skip the build and deploy the upstream image directly — however, the custom `entrypoint.sh` is then absent and `DB_*`-to-`POSTGRESQL_*` variable mapping will not occur.

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment (SQL, storage, secrets). |
| `container_image_source` | 4 | `'custom'` | `'custom'` builds via Cloud Build (default). `'prebuilt'` deploys an existing image URI. |
| `container_image` | 4 | `""` | Override image URI. Leave empty for Cloud Build to manage the image. |
| `cpu_limit` | 4 | `'2000m'` | CPU per instance. 2 vCPU minimum for Zammad. |
| `memory_limit` | 4 | `'4Gi'` | Memory per instance. Minimum 2 Gi; 4 Gi recommended for production. |
| `container_resources` | 4 | `null` | Structured resource block. When set, overrides `cpu_limit` and `memory_limit`. |
| `container_port` | 4 | `3000` | Zammad railsserver port. Change only if your custom Dockerfile binds to a different port. |
| `execution_environment` | 4 | `'gen2'` | Gen2 required for NFS mounts and GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Max request duration. Increase for long-running ticket imports or API bulk operations. |
| `enable_cloudsql_volume` | 4 | `true` | Default `true` — injects Auth Proxy sidecar. The custom entrypoint uses `DB_IP` for TCP connectivity. |
| `traffic_split` | 4 | `[]` | Percentage-based canary/blue-green traffic allocation. All entries must sum to 100. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |

**Differences from `App_CloudRun` defaults:**

| Variable | `App_CloudRun` | `Zammad_CloudRun` | Reason |
|---|---|---|---|
| `container_port` | `8080` | `3000` | Zammad railsserver listens on port 3000. |
| `cpu_limit` | `'1000m'` | `'2000m'` | Rails + Sidekiq workers require ≥2 vCPU. |
| `memory_limit` | `'512Mi'` | `'4Gi'` | Zammad's Rails process, asset cache, and worker queues require significantly more RAM. |
| `min_instance_count` | `0` | `1` | Scale-to-zero causes excessive cold starts for a helpdesk. |
| `enable_image_mirroring` | `false` | `true` | Zammad mirrors from Docker Hub to Artifact Registry by default. |

### B. Database (Cloud SQL — PostgreSQL 15)

Zammad requires **PostgreSQL 13 or later** — `Zammad_Common` fixes `database_type = "POSTGRES_15"` and the `validation.tf` precondition rejects any other engine at plan time. MySQL is explicitly unsupported.

**Unix socket → TCP conversion:** Zammad's `docker-entrypoint.sh` checks PostgreSQL readiness using a TCP bash socket (`echo > /dev/tcp/"${POSTGRESQL_HOST}"/"${POSTGRESQL_PORT}"`). This cannot use a Unix socket path. The custom `entrypoint.sh` handles this: on Cloud Run (where `DB_HOST` is a socket path), it uses `DB_IP` (the Cloud SQL private IP) for `POSTGRESQL_HOST`. On GKE (where `DB_HOST = 127.0.0.1`), the host is used as-is.

| Variable | Group | Default | Description |
|---|---|---|---|
| `db_name` | 12 | `'zammad'` | PostgreSQL database name. **Do not change after initial deployment.** |
| `db_user` | 12 | `'zammad'` | PostgreSQL application user. Password auto-generated and stored in Secret Manager. |
| `database_type` | 12 | `'POSTGRES_15'` | Must be `POSTGRES_13`, `POSTGRES_14`, `POSTGRES_15`, or `NONE`. Other values fail validation. |
| `database_password_length` | 12 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Automated zero-downtime password rotation. See §7.D. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after rotation before restarting the service. |

> `database_type` should not be overridden to MySQL or SQL Server — the validation precondition will reject it. `sql_instance_name` and `sql_instance_base_name` are not exposed; Cloud SQL discovery/inline provisioning is handled transparently by `App_CloudRun`.

### C. Storage (NFS & GCS)

**NFS is enabled by default** (`enable_nfs = true`). Zammad stores all ticket attachments and uploaded files in `/opt/zammad/storage`. NFS provides a shared filesystem so that all Cloud Run instances access consistent attachment data. Requires `execution_environment = 'gen2'`.

**GCS attachments bucket:** `Zammad_Common` automatically provisions a dedicated `zammad-attachments` GCS bucket via `module_storage_buckets`. This bucket is separate from any buckets in `storage_buckets`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_nfs` | 11 | `true` | Provisions an NFS volume for Zammad attachment storage at `nfs_mount_path`. Requires `gen2`. |
| `nfs_mount_path` | 11 | `'/opt/zammad/storage'` | Container path where the NFS share is mounted. Must match Zammad's storage path. |
| `create_cloud_storage` | 11 | `true` | Set `false` to skip additional bucket creation. The `zammad-attachments` bucket from `Zammad_Common` is always provisioned. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Additional GCS buckets beyond the auto-provisioned attachments bucket. |
| `gcs_volumes` | 11 | `[]` | GCS buckets to mount via GCS Fuse (requires `gen2`). Each entry: `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. |
| `nfs_instance_name` | 11 | `""` | Name of an existing NFS GCE VM. Leave empty to auto-discover. |
| `nfs_instance_base_name` | 11 | `'app-nfs'` | Base name for an inline NFS GCE VM when none exists. Deployment ID is appended. |
| `manage_storage_kms_iam` | 11 | `false` | Creates a CMEK KMS keyring/key and enables CMEK on all storage buckets. |
| `enable_artifact_registry_cmek` | 11 | `false` | Creates an Artifact Registry KMS key and enables at-rest CMEK encryption of container images. |

### D. Networking

Cloud Run uses Direct VPC Egress to reach Cloud SQL's internal IP. Because `enable_cloudsql_volume = true` is the default, the Auth Proxy sidecar handles the Cloud SQL connection — but Zammad's entrypoint uses the private IP (`DB_IP`) for its TCP readiness check.

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — public internet; `'internal'` — VPC only; `'internal-and-cloud-load-balancing'` — forces traffic through the HTTPS Load Balancer. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` routes only RFC 1918 traffic via VPC. `'ALL_TRAFFIC'` routes all egress via VPC (required for Memorystore Redis). |

> `network_name` is not exposed. The module auto-discovers the `Services_GCP` VPC network.

**Redis connectivity note:** If Redis is hosted on Google Cloud Memorystore (private IP), `vpc_egress_setting` must be `'ALL_TRAFFIC'` to route outbound Redis connections through the VPC. If the NFS server IP is used (default), `'PRIVATE_RANGES_ONLY'` is sufficient.

### E. Initialization & Bootstrap

A `db-init` Cloud Run Job is automatically provisioned by `Zammad_Common` when `initialization_jobs` is left as the default empty list (`[]`). It uses the `postgres:15-alpine` image and executes `Zammad_Common/scripts/db-init.sh`, which performs the following idempotent operations:

1. Connects to Cloud SQL PostgreSQL via the Auth Proxy Unix socket.
2. Creates the `zammad` database user with the password from Secret Manager.
3. Creates the `zammad` database if it does not exist.
4. Grants the `zammad` user full privileges on the database.

After the `db-init` job completes, the Cloud Run service is deployed. Zammad then runs its own `zammad-init` (Rails DB migrations + seed) on startup via the custom `entrypoint.sh`. This is idempotent — pending migrations are applied, already-run ones are skipped.

Override `initialization_jobs` with a non-empty list to replace the default with custom jobs.

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | One-shot Cloud Run Jobs. Leave empty for `Zammad_Common` to supply the default `db-init` job. Non-empty list replaces it entirely. |
| `cron_jobs` | 13 | `[]` | Recurring jobs triggered by Cloud Scheduler. Each entry: `name`, `schedule` (cron UTC), `image`, `command`, `args`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `task_count`, `parallelism`, `mount_nfs`, `mount_gcs_volumes`, `script_path`, `paused`. |

---

## 4. Advanced Security

### A. Cloud Armor WAF

When `enable_cloud_armor = true`, a Global HTTPS Load Balancer with a Cloud Armor WAF policy (OWASP Top 10, adaptive DDoS, 500 req/min rate limiting) is provisioned in front of Cloud Run.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. Required for custom domains, CDN, and DDoS protection. |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules (e.g., office VPN, CI/CD egress IPs). |

### B. Identity-Aware Proxy (IAP)

When `enable_iap = true`, Cloud Run's native IAP integration is enabled. Google identity authentication is required before requests reach Zammad. Useful for internal support teams where all agents have Google Workspace identities.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Enables IAP natively on the Cloud Run service. |
| `iap_authorized_users` | 5 | `[]` | Users/service accounts granted access. Format: `'user:email'` or `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted access. Format: `'group:name@example.com'`. |

**IAP and Zammad admin:** Note that Zammad has its own internal authentication system. When IAP is enabled, users must authenticate twice — once with Google (at the IAP layer) and once with their Zammad account. This is intentional for layered security. Consider IAP for staging environments to prevent accidental public exposure.

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
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC access level. Auto-discovered when empty. |
| `vpc_sc_dry_run` | 22 | `true` | Logs VPC-SC violations without blocking. Set `false` to enforce. |
| `organization_id` | 22 | `""` | GCP Organization ID. Must be set explicitly — auto-discovery is disabled to prevent unintended activation. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs (DATA_READ, DATA_WRITE, ADMIN_READ). |

### E. Secret Manager Integration

Zammad secrets are stored in Secret Manager and injected natively by Cloud Run at revision start. `Zammad_Common` does not auto-generate application-level secrets (`module_secret_env_vars = {}`). The `DB_PASSWORD` and `ROOT_PASSWORD` secrets are provisioned automatically by `App_CloudRun`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Map of env var name → Secret Manager secret ID. Resolved at runtime; never stored in state. |
| `explicit_secret_values` | 6 | `{}` | Raw sensitive values written directly into Secret Manager. Use sparingly — values known at plan time only. |
| `secret_rotation_period` | 6 | `'2592000s'` | Frequency at which Secret Manager emits rotation notifications. Default: 30 days. |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation before dependent resources proceed. |

---

## 5. Traffic & Ingress

### A. HTTPS Load Balancer

When `enable_cloud_armor = true`, a Global HTTPS Load Balancer backed by a Serverless NEG is provisioned. Traffic flows: Internet → Cloud Armor → Global HTTPS LB → Serverless NEG → Cloud Run.

Setting `ingress_settings = 'internal-and-cloud-load-balancing'` forces all Zammad traffic through the LB, preventing direct `*.run.app` URL access.

### B. Cloud CDN

When `enable_cdn = true` (requires `enable_cloud_armor = true`), Cloud CDN is attached to the HTTPS Load Balancer backend.

**Zammad consideration:** Zammad is a real-time helpdesk application. Ticket lists, agent views, and WebSocket connections are dynamic and should not be cached. CDN is appropriate only for static assets (JS, CSS, images). Ensure `Cache-Control: no-cache` headers are set for API responses before enabling CDN.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cdn` | 10 | `false` | Enables Cloud CDN on the HTTPS LB backend. Only effective when `enable_cloud_armor = true`. |
| `max_images_to_retain` | 10 | `7` | Maximum number of recent container images to keep in Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Automatically deletes untagged images from Artifact Registry. |
| `image_retention_days` | 10 | `30` | Days after which images are eligible for deletion. |

### C. Custom Domains

Custom domains are attached to the Global HTTPS Load Balancer via `application_domains`. Google-managed SSL certificates are provisioned automatically.

| Variable | Group | Default | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Custom domain names for the HTTPS LB (e.g., `['helpdesk.example.com']`). |

After the first apply, retrieve the LB IP from the Terraform output `load_balancer_ip` and create an `A` record. SSL certificate provisioning takes 10–30 minutes after DNS propagation.

---

## 6. CI/CD & Delivery

### A. Cloud Build Triggers

When `enable_cicd_trigger = true`, a Cloud Build GitHub connection and push trigger are provisioned. The trigger builds and deploys a custom Zammad image when code is pushed to the configured branch.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. Requires `github_repository_url` and credentials. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT (`repo`, `admin:repo_hook` scopes). Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID (preferred for organisation repos). |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced trigger config: `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### B. Cloud Deploy Pipeline

When `enable_cloud_deploy = true` (requires `enable_cicd_trigger = true`), the CI/CD pipeline is upgraded to a managed Cloud Deploy delivery pipeline with sequential promotion stages.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy pipeline. Requires `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Ordered promotion stages. Each: `name`, `target_name`, `service_name`, `require_approval`, `auto_promote`. |

---

## 7. Reliability & Scheduling

### A. Scaling

`min_instance_count` defaults to `1` to eliminate cold starts for a production helpdesk. `max_instance_count` defaults to `5`. Both are user-configurable via `tfvars`.

**Zammad WebSocket:** Zammad uses ActionCable WebSockets for real-time ticket updates in the agent UI. Multiple Cloud Run instances each have independent WebSocket connections. Redis pub/sub (`REDIS_URL`) synchronises real-time events across instances — this is why Redis is mandatory.

### B. Traffic Splitting

Traffic splitting is supported. Zammad's session state and WebSocket channels are handled per-connection — canary deployments are safe as long as Redis is shared across revisions.

| Variable | Group | Default | Description |
|---|---|---|---|
| `traffic_split` | 4 | `[]` | Percentage-based traffic allocation across named revisions. All entries must sum to 100. |

### C. Health Probes & Uptime Monitoring

Zammad exposes a dedicated health endpoint at `/api/v1/ping` that returns `HTTP 200` when the application is fully initialised. Both startup and liveness probes target this endpoint.

**Zammad runs DB migrations on every startup.** The startup probe defaults allow 60 seconds of initial delay plus 30 retry periods of 15 seconds each — giving Zammad up to 510 seconds of total startup tolerance on cold deployments with pending migrations.

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ enabled=true, type="HTTP", path="/api/v1/ping", initial_delay_seconds=60, timeout_seconds=10, period_seconds=15, failure_threshold=30 }` | Startup readiness probe. Container receives no traffic until this succeeds. |
| `liveness_probe` | 14 | `{ enabled=true, type="HTTP", path="/api/v1/ping", initial_delay_seconds=60, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Liveness probe. Container is restarted after `failure_threshold` consecutive failures. |
| `startup_probe_config` | 14 | `{ enabled=true, path="/api/v1/ping", initial_delay_seconds=60, ... }` | Service-level startup probe (forwarded to `App_CloudRun`). |
| `health_check_config` | 14 | `{ enabled=true, path="/api/v1/ping", initial_delay_seconds=60, ... }` | Service-level liveness probe (forwarded to `App_CloudRun`). |
| `uptime_check_config` | 14 | `{ enabled=true, path="/api/v1/ping" }` | Cloud Monitoring uptime check. Alerts notify `support_users` if unreachable. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |

### D. Auto Password Rotation

When `enable_auto_password_rotation = true`, a zero-downtime password rotation pipeline is provisioned. Zammad re-reads `DB_PASSWORD` from Secret Manager on service restart.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Enables automated password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after writing the new secret before restarting the service. |
| `secret_rotation_period` | 6 | `'2592000s'` | Rotation frequency. Default: 30 days. |

---

## 8. Integrations

### A. Redis (Required)

Redis is **enabled by default** (`enable_redis = true`) and is required for Zammad production deployments. Redis serves two critical roles:

1. **ActionCable pub/sub:** Delivers real-time ticket updates to agents across multiple Cloud Run instances.
2. **Sidekiq job queue:** Processes background jobs (email dispatch, SLA notifications, LDAP sync, etc.).

Without Redis, Zammad will fail to start — the `validation.tf` precondition enforces this when `enable_redis = true`.

When `enable_redis = true` and `redis_host` is not provided, the module defaults to using the NFS server IP as the Redis host. For production deployments, provision a dedicated Google Cloud Memorystore for Redis instance and set `redis_host` to its IP. When using Memorystore, set `vpc_egress_setting = 'ALL_TRAFFIC'`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 21 | `true` | **Required for production.** Enables Redis for ActionCable and Sidekiq. |
| `redis_host` | 21 | `""` | Redis server hostname or IP. Leave blank to use the NFS server IP. Override with Memorystore for production. |
| `redis_port` | 21 | `'6379'` | Redis server TCP port (string). |
| `redis_auth` | 21 | `""` | Redis AUTH password. Leave empty if the Redis instance does not require authentication. Sensitive. |

The `REDIS_URL` environment variable is constructed as:
- With auth: `redis://:${redis_auth}@${redis_host}:${redis_port}`
- Without auth: `redis://${redis_host}:${redis_port}`

### B. Email (SMTP)

Zammad sends email for ticket notifications, agent alerts, and password resets. SMTP must be configured post-deployment in the Zammad admin interface (**Admin → Channels → Email**). Alternatively, inject SMTP settings via `environment_variables`:

```hcl
environment_variables = {
  SMTP_HOST  = "smtp.sendgrid.net"
  SMTP_PORT  = "587"
  SMTP_USER  = "apikey"
  EMAIL_FROM = "helpdesk@example.com"
}
```

Use `secret_environment_variables` for SMTP passwords:

```hcl
secret_environment_variables = {
  SMTP_PASSWORD = "zammad-smtp-password"
}
```

| Variable | Group | Default | Description |
|---|---|---|---|
| `environment_variables` | 6 | `{}` | Plain-text env vars injected into the Cloud Run revision. Use for non-sensitive Zammad configuration. |
| `secret_environment_variables` | 6 | `{}` | Secret Manager references. Use for SMTP passwords, API keys, and other sensitive values. |

### C. Backup Import & Recovery

When `enable_backup_import = true`, a dedicated Cloud Run Job restores an existing database backup into the provisioned Cloud SQL PostgreSQL instance.

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated daily backups. |
| `backup_retention_days` | 7 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 7 | `false` | Triggers a one-time restore on apply. Set `false` after a successful import. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (GCS filename) or `'gdrive'` (Drive file ID). |
| `backup_file` | 7 | `'backup.sql'` | Filename within the backups GCS bucket, or Google Drive file ID. |
| `backup_format` | 7 | `'sql'` | Backup file format: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

> **Warning:** Import may produce errors if the database already contains data. Test in a non-production environment first.

### D. Observability & Alerting

| Variable | Group | Default | Description |
|---|---|---|---|
| `uptime_check_config` | 14 | `{ enabled=true, path="/api/v1/ping" }` | Uptime check: `enabled`, `path`, `check_interval`, `timeout`. |
| `alert_policies` | 14 | `[]` | Metric alert policies. Each: `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`, `aggregation_period`. |
| `support_users` | 2 | `[]` | Email addresses notified by uptime and alert policy triggers. |

---

## 9. Platform-Managed Behaviours

The following behaviours are applied automatically by `Zammad_CloudRun` regardless of variable values. They cannot be overridden via `tfvars`.

| Behaviour | Implementation | Detail |
|---|---|---|
| **PostgreSQL required** | Precondition in `validation.tf` | `database_type` must be `POSTGRES_13`, `POSTGRES_14`, `POSTGRES_15`, or `NONE`. Plan fails for any other value. |
| **POSTGRES_15 default** | `database_type = "POSTGRES_15"` fixed by `Zammad_Common` | Zammad 6.x is tested against PostgreSQL 15. |
| **Variable mapping via entrypoint** | Custom `entrypoint.sh` in `Zammad_Common` | Foundation's `DB_*` variables are mapped to Zammad's `POSTGRESQL_*` convention. On Cloud Run, `DB_IP` is used instead of the socket path for TCP readiness checks. |
| **zammad-init on every start** | Runs inside `entrypoint.sh` | DB migrations and seeds run idempotently on every container start before the railsserver process begins. |
| **REDIS_URL constructed at apply time** | `module_env_vars` in `zammad.tf` | Built from `redis_host`, `redis_port`, and `redis_auth`. Not stored in Secret Manager. |
| **Redis validation** | Precondition in `validation.tf` | When `enable_redis = true`, either `redis_host` must be set or `enable_nfs` must be true. Prevents silent startup failure. |
| **GCS attachments bucket** | `zammad-attachments` bucket provisioned by `Zammad_Common` via `module_storage_buckets` | Provisioned separately from `storage_buckets`. |
| **NFS mount at `/opt/zammad/storage`** | `nfs_mount_path = "/opt/zammad/storage"` default | Zammad writes attachments to this path. Changing it requires a matching Zammad configuration change. |
| **Unix socket with TCP fallback** | `enable_cloudsql_volume = true` default + `DB_IP` in entrypoint | The Auth Proxy sidecar handles Cloud SQL auth; `DB_IP` is used for the TCP readiness check that Zammad's init requires. |
| **Default db-init job** | Supplied by `Zammad_Common` when `initialization_jobs = []` | PostgreSQL database and user are created automatically. Override with a non-empty list to replace. |
| **No auto-generated app secrets** | `module_secret_env_vars = {}` | Zammad manages its own internal signing keys. No `SECRET_KEY` equivalent is created. |
| **Scripts directory** | `scripts_dir = abspath("${module.zammad_app.path}/scripts")` | Initialization scripts are sourced from `Zammad_Common`, not from the deployment directory. |

---

## 10. Variable Reference

All user-configurable variables exposed by `Zammad_CloudRun`, sorted by UI group then order. Group 0 variables are reserved for platform metadata — leave them at their defaults for standard deployments.

| Variable | Group | Default | Description |
|---|---|---|---|
| `module_description` | 0 | (Zammad platform text) | Platform metadata: module description. |
| `module_documentation` | 0 | `'https://docs.radmodules.dev/docs/modules/Zammad_CloudRun'` | Platform metadata: documentation URL. |
| `module_dependency` | 0 | `['Services_GCP']` | Platform metadata: required modules. |
| `module_services` | 0 | (GCP service list) | Platform metadata: GCP services consumed. |
| `credit_cost` | 0 | `50` | Platform metadata: deployment credit cost. |
| `require_credit_purchases` | 0 | `false` | Platform metadata: enforces credit balance check. |
| `enable_purge` | 0 | `true` | Permits full deletion of module resources on destroy. |
| `public_access` | 0 | `false` | Platform catalogue visibility. |
| `shared_users` | 0 | `[]` | Users granted access regardless of `public_access`. Actively enforced by the platform. |
| `deployment_id` | 0 | `""` | Deployment ID suffix. Auto-generated if empty. |
| `resource_creator_identity` | 0 | (platform SA) | Service account used by Terraform to manage resources. |
| `impersonation_service_account` | 0 | `""` | Service account to impersonate when calling GCP APIs from shell scripts. |
| `project_id` | 1 | — | GCP project ID. **Required.** |
| `region` | 1 | `'us-central1'` | GCP region for resource deployment. |
| `tenant_deployment_id` | 2 | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `[]` | Email addresses for monitoring alerts. |
| `resource_labels` | 2 | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `'zammad'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 3 | `'Zammad Helpdesk'` | Human-readable name. Maps to `application_display_name` in `App_CloudRun`. |
| `description` | 3 | `'Zammad - Open-source helpdesk and customer support platform'` | Service description. Passed to `Zammad_Common`. |
| `application_version` | 3 | `'6.4.1'` | Zammad container image tag. Increment to trigger a new build. |
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 4 | `'custom'` | `'custom'` (Cloud Build) or `'prebuilt'` (existing image). |
| `container_image` | 4 | `""` | Container image URI. Leave empty for Cloud Build to manage. |
| `cpu_limit` | 4 | `'2000m'` | CPU per instance. 2 vCPU minimum for Zammad. |
| `memory_limit` | 4 | `'4Gi'` | Memory per instance. Minimum 2 Gi; 4 Gi recommended. |
| `container_resources` | 4 | `null` | Structured resource block overriding `cpu_limit`/`memory_limit`. |
| `container_port` | 4 | `3000` | Zammad railsserver port. |
| `execution_environment` | 4 | `'gen2'` | Gen2 required for NFS mounts and GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Max request duration in seconds. |
| `enable_cloudsql_volume` | 4 | `true` | Injects the Cloud SQL Auth Proxy sidecar. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Container path for the Auth Proxy Unix socket. |
| `container_protocol` | 4 | `'http1'` | `'http1'` or `'h2c'`. |
| `enable_image_mirroring` | 4 | `true` | Mirrors the Zammad image from Docker Hub into Artifact Registry. |
| `traffic_split` | 4 | `[]` | Canary/blue-green traffic allocation. |
| `max_revisions_to_retain` | 4 | `7` | Maximum number of Cloud Run revisions to keep. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |
| `min_instance_count` | 4 | `1` | Minimum Cloud Run instances. Set to `0` for scale-to-zero (causes cold starts). |
| `max_instance_count` | 4 | `5` | Maximum Cloud Run instances. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'`, or `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` or `'ALL_TRAFFIC'`. Use `'ALL_TRAFFIC'` for Memorystore Redis. |
| `enable_iap` | 5 | `false` | Enables IAP on the Cloud Run service. |
| `iap_authorized_users` | 5 | `[]` | Users/SAs granted IAP access. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted IAP access. |
| `environment_variables` | 6 | `{}` | Plain-text env vars. |
| `secret_environment_variables` | 6 | `{}` | Secret Manager references. |
| `explicit_secret_values` | 6 | `{}` | Raw sensitive values written directly into Secret Manager. |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation. |
| `secret_rotation_period` | 6 | `'2592000s'` | Secret Manager rotation notification frequency. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Cron expression (UTC) for automated backups. |
| `backup_retention_days` | 7 | `7` | Days to retain backup files in GCS. |
| `enable_backup_import` | 7 | `false` | Triggers a one-time restore on apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (filename) or `'gdrive'` (file ID). |
| `backup_file` | 7 | `'backup.sql'` | Backup filename in the GCS bucket, or Google Drive file ID. |
| `backup_format` | 7 | `'sql'` | Backup format: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT. Required on first apply. Sensitive. |
| `github_app_installation_id` | 8 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger config. |
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy progressive delivery pipeline. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Ordered Cloud Deploy promotion stages. |
| `enable_binary_authorization` | 8 | `false` | Enforces image attestation on deployment. |
| `enable_custom_sql_scripts` | 9 | `false` | Runs SQL scripts from GCS after provisioning. |
| `custom_sql_scripts_bucket` | 9 | `""` | GCS bucket containing custom SQL scripts. |
| `custom_sql_scripts_path` | 9 | `""` | Path prefix within the bucket. |
| `custom_sql_scripts_use_root` | 9 | `false` | Run scripts as the root DB user. |
| `enable_cloud_armor` | 10 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | 10 | `[]` | Custom domains with Google-managed SSL certificates. |
| `enable_cdn` | 10 | `false` | Enables Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` | 10 | `7` | Maximum container images to keep in Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Automatically deletes untagged images from Artifact Registry. |
| `image_retention_days` | 10 | `30` | Days after which images are eligible for deletion. |
| `create_cloud_storage` | 11 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Additional GCS buckets to provision. |
| `enable_nfs` | 11 | `true` | Provisions NFS shared storage for Zammad attachments. Requires `gen2`. |
| `nfs_mount_path` | 11 | `'/opt/zammad/storage'` | Container path where NFS is mounted. Must match Zammad's storage path. |
| `nfs_instance_name` | 11 | `""` | Name of an existing NFS GCE VM. Leave empty to auto-discover. |
| `nfs_instance_base_name` | 11 | `'app-nfs'` | Base name for inline NFS VM. Deployment ID is appended. |
| `gcs_volumes` | 11 | `[]` | GCS buckets to mount via GCS Fuse. |
| `manage_storage_kms_iam` | 11 | `false` | Creates CMEK KMS key and enables CMEK on all storage buckets. |
| `enable_artifact_registry_cmek` | 11 | `false` | Creates Artifact Registry KMS key for at-rest image encryption. |
| `database_type` | 12 | `'POSTGRES_15'` | Must be `POSTGRES_13`, `POSTGRES_14`, `POSTGRES_15`, or `NONE`. |
| `db_name` | 12 | `'zammad'` | PostgreSQL database name. Do not change after initial deployment. |
| `db_user` | 12 | `'zammad'` | PostgreSQL application user. |
| `database_password_length` | 12 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 12 | `90` | Seconds to wait after rotation before restarting the service. |
| `initialization_jobs` | 13 | `[]` | One-shot Cloud Run Jobs. Leave empty for `Zammad_Common` to supply the default `db-init` job. |
| `cron_jobs` | 13 | `[]` | Recurring scheduled Cloud Run Jobs. |
| `startup_probe` | 14 | `{ path="/api/v1/ping", initial_delay_seconds=60, failure_threshold=30, ... }` | Startup probe. Long tolerance for DB migrations. |
| `liveness_probe` | 14 | `{ path="/api/v1/ping", initial_delay_seconds=60, failure_threshold=3, ... }` | Liveness probe. |
| `startup_probe_config` | 14 | `{ enabled=true, path="/api/v1/ping", ... }` | Service-level startup probe (forwarded to `App_CloudRun`). |
| `health_check_config` | 14 | `{ enabled=true, path="/api/v1/ping", ... }` | Service-level liveness probe (forwarded to `App_CloudRun`). |
| `uptime_check_config` | 14 | `{ enabled=true, path="/api/v1/ping" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |
| `enable_redis` | 21 | `true` | **Required for production.** Redis for ActionCable and Sidekiq. |
| `redis_host` | 21 | `""` | Redis hostname/IP. Defaults to NFS server IP when empty. |
| `redis_port` | 21 | `'6379'` | Redis TCP port (string). |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive. |
| `enable_vpc_sc` | 22 | `false` | Registers API calls within the project's VPC-SC perimeter. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for VPC-SC network access level. |
| `vpc_sc_dry_run` | 22 | `true` | Logs VPC-SC violations without blocking. Set `false` to enforce. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. Must be set explicitly. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs. |

---

## 11. Outputs

| Output | Description |
|---|---|
| `service_name` | Name of the Cloud Run service. |
| `service_url` | Public URL of the Cloud Run service. |
| `service_location` | GCP region where the Cloud Run service is deployed. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix used in resource names. |
| `database_instance_name` | Name of the Cloud SQL PostgreSQL instance. |
| `database_name` | Name of the application database (`zammad`). |
| `database_user` | Name of the application database user (`zammad`). |
| `database_password_secret` | Secret Manager secret name for the database password. |
| `storage_buckets` | Created GCS storage buckets. |
| `nfs_server_ip` | NFS server internal IP *(sensitive)*. |
| `nfs_mount_path` | NFS mount path inside containers (`/opt/zammad/storage`). |
| `container_image` | Container image used for the deployment. |
| `cicd_enabled` | Whether the CI/CD pipeline is enabled. |
| `github_repository_url` | GitHub repository URL connected for CI/CD. |

---

## 12. Configuration Pitfalls

| Pitfall | Symptom | Resolution |
|---|---|---|
| `enable_redis = true` with no `redis_host` and `enable_nfs = false` | Plan fails with precondition error | Set `redis_host` explicitly, or set `enable_nfs = true` to use the NFS server IP as the Redis host. |
| `database_type = "MYSQL_8_0"` | Plan fails with precondition error | Zammad requires PostgreSQL. Use `POSTGRES_15`. |
| `enable_cloudsql_volume = true` with `database_type = "NONE"` | Plan fails with precondition error | Either disable the Cloud SQL volume or configure a database. |
| `container_image_source = 'prebuilt'` without custom entrypoint | Zammad fails to start — `DB_*` variables not mapped to `POSTGRESQL_*` | Use `'custom'` (default) so the Cloud Build pipeline includes `Zammad_Common`'s `entrypoint.sh`. |
| `memory_limit` below `2Gi` | Zammad OOMs during startup or schema migration | Keep `memory_limit` at `4Gi` or above. Minimum is `2Gi`. |
| `min_instance_count = 0` on a production helpdesk | 60–90 second cold starts visible to users | Set `min_instance_count = 1`. |
| Redis on Memorystore with `vpc_egress_setting = 'PRIVATE_RANGES_ONLY'` | Redis connection refused | Memorystore uses a private IP — set `vpc_egress_setting = 'ALL_TRAFFIC'`. |
| `nfs_mount_path` changed from `/opt/zammad/storage` | Zammad cannot find attachments | Leave `nfs_mount_path` at its default, or configure `ZAMMAD_STORAGE_PROVIDER` to match the new path. |

---

## Destroying Resources

### Known Deletion Issue: Serverless IPv4 Address Release

When destroying a Cloud Run deployment, you may encounter an error similar to:

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause:** GCP holds serverless IPv4 addresses on the VPC subnet asynchronously after a Cloud Run service is deleted. These addresses are released approximately **20–30 minutes** after the Cloud Run service is removed.

**Resolution:** Wait 20–30 minutes after the initial destroy attempt, then re-run:

```bash
tofu destroy
```

The second run will succeed once GCP has released the reserved addresses.
