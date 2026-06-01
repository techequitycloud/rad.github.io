# Strapi_CloudRun Module — Configuration Guide

`Strapi_CloudRun` is a pre-configured wrapper around the [`App_CloudRun`](../App_CloudRun/App_CloudRun.md) module that deploys [Strapi](https://strapi.io/) — an open-source headless CMS — on Google Cloud Run Gen2.

Every variable in this module is passed through to `App_CloudRun`. The wrapper's role is to supply Strapi-appropriate defaults and to call the `Strapi_Common` sub-module, which generates the application's container build context, database initialisation jobs, Strapi-specific secrets, and GCS bucket configuration. You configure this module exactly as you would `App_CloudRun`; the sections below highlight only the variables whose defaults or behaviour differ meaningfully from `App_CloudRun`, or that are unique to this wrapper.

> **Where to look:** If a variable you are configuring is not described here, consult the [App_CloudRun Configuration Guide](../App_CloudRun/App_CloudRun.md). All `App_CloudRun` features — access and networking, IAP, Cloud Armor, CDN, CI/CD, Cloud Deploy, Binary Authorization, traffic splitting, and VPC Service Controls — are available in `Strapi_CloudRun` with identical behaviour and configuration.

---

## §1 Module Overview

| Property | Value |
|---|---|
| Sub-module | `Strapi_Common` |
| Default application name | `strapi` |
| Default display name | `Strapi CMS` |
| Default version | `5.0.0` |
| Container port | `8080` |
| Execution environment | `gen2` |
| Database engine | PostgreSQL 15 |
| Default DB name | `strapidb` |
| Default DB user | `strapiuser` |
| NFS enabled | `true` (mount: `/mnt/nfs`) |
| Redis enabled | `false` |
| Image source | `custom` (Cloud Build) |
| Platform-managed job | `db-init` |

`Strapi_Common` generates the Dockerfile, build scripts, and a `db-init` Cloud Run job. It also generates five Strapi application secrets (`APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET`) and two GCS environment variables (`GCS_BUCKET_NAME`, `GCS_BASE_URL`).

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
| `application_name` | `"strapi"` | Base name for Cloud Run service, secrets, Artifact Registry |
| `application_display_name` | `"Strapi CMS"` | Human-readable name in UI and dashboards |
| `application_description` | `"Strapi CMS on Cloud Run"` | Cloud Run service description |
| `application_version` | `"5.0.0"` | Image tag; increment to trigger rebuild |

Note: unlike some other wrapper modules, these variables are named `application_display_name` and `application_description` (not `display_name`/`description`).

### §3.B Resource Sizing

| Variable | Default | Notes |
|---|---|---|
| `cpu_limit` | `"2000m"` | 2 vCPU; Strapi's SSR and media processing benefit from the headroom |
| `memory_limit` | `"2Gi"` | 2 GiB; required for Node.js + Strapi admin panel compilation |
| `min_instance_count` | `0` | Scale-to-zero by default; set to `1` to eliminate cold starts |
| `max_instance_count` | `1` | Single-instance default; increase after confirming NFS shared state |
| `timeout_seconds` | `300` | Increase for long-running media processing or migration jobs |

### §3.C Environment Variables & Secrets

Plain-text variables are injected via `environment_variables`; sensitive values via `secret_environment_variables`.

**Module-injected environment variables** (set automatically by `strapi.tf`):

| Variable | Source |
|---|---|
| `GCS_BUCKET_NAME` | Auto-provisioned GCS bucket name (suffix: `strapi-uploads`) |
| `GCS_BASE_URL` | `https://storage.googleapis.com/<bucket-name>` |

**Module-injected secrets** (provisioned by `Strapi_Common`, injected via `module_secret_env_vars`):

| Secret env var | Purpose |
|---|---|
| `APP_KEYS` | Strapi session signing keys |
| `API_TOKEN_SALT` | API token derivation |
| `ADMIN_JWT_SECRET` | Admin panel JWT signing |
| `TRANSFER_TOKEN_SALT` | Data transfer token salt |
| `JWT_SECRET` | User-facing JWT signing |

These secrets are auto-generated and cannot be overridden via `secret_environment_variables`. Use `secret_rotation_period` to configure notification-based rotation reminders.

**User-supplied variables (non-sensitive):**

```hcl
environment_variables = {
  STRAPI_TELEMETRY_DISABLED = "true"
  NODE_ENV                  = "production"
}
```

**User-supplied secrets:**

```hcl
secret_environment_variables = {
  SENDGRID_API_KEY = "my-sendgrid-secret"
}
```

### §3.D Networking

Behaviour is identical to `App_CloudRun`. Key defaults:

| Variable | Default |
|---|---|
| `ingress_settings` | `"all"` |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` |
| `enable_cloudsql_volume` | `true` |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `container_protocol` | `"http1"` |

Set `container_protocol = "h2c"` to enable HTTP/2 (gRPC) communication between the load balancer and the Cloud Run service.

### §3.E Container Image & Build

| Variable | Default | Notes |
|---|---|---|
| `container_image_source` | `"custom"` | `"custom"` triggers Cloud Build; `"prebuilt"` deploys an existing image |
| `container_image` | `""` | Leave empty for Cloud Build output; set for prebuilt image URI |
| `container_build_config` | `{ enabled = true }` | `Strapi_Common` controls Dockerfile path and context; module overrides `dockerfile_path = "Dockerfile"` and `context_path = "."` in `strapi.tf` |
| `enable_image_mirroring` | `true` | Mirrors image to Artifact Registry before deployment |

`Strapi_Common` owns the build context (Dockerfile, scripts). The `container_build_config` override in `strapi.tf` corrects paths after symlink removal; only change `build_args` or `artifact_repo_name` if needed.

---

## §4 Advanced Security

### §4.A Identity-Aware Proxy

```hcl
enable_iap            = true
iap_authorized_groups = ["group:strapi-admins@example.com"]
```

### §4.B VPC Service Controls

```hcl
enable_vpc_sc = true  # group=21; requires existing VPC-SC perimeter
```

### §4.C Cloud Armor & CDN

```hcl
enable_cloud_armor  = true
application_domains = ["cms.example.com"]
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
  { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", revision = "strapi-00002", percent = 10 },
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
github_repository_url = "https://github.com/my-org/strapi-app"
github_token          = "ghp_xxxx"  # or use github_app_installation_id
cicd_trigger_config = {
  branch_pattern = "^main$"
  included_files = ["src/**", "Dockerfile"]
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

`Strapi_CloudRun` exposes two independent probe interfaces:

**Interface 1 — `startup_probe` / `liveness_probe`** (passed to `Strapi_Common`):

| Variable | Default |
|---|---|
| `startup_probe.type` | `"HTTP"` |
| `startup_probe.path` | `"/_health"` |
| `startup_probe.initial_delay_seconds` | `60` |
| `startup_probe.timeout_seconds` | `5` |
| `startup_probe.period_seconds` | `10` |
| `startup_probe.failure_threshold` | `3` |
| `liveness_probe.type` | `"HTTP"` |
| `liveness_probe.path` | `"/_health"` |
| `liveness_probe.initial_delay_seconds` | `30` |
| `liveness_probe.timeout_seconds` | `5` |
| `liveness_probe.period_seconds` | `30` |
| `liveness_probe.failure_threshold` | `3` |

**Interface 2 — `startup_probe_config` / `health_check_config`** (passed directly to `App_CloudRun`):

| Variable | Default |
|---|---|
| `startup_probe_config.path` | `"/_health"` |
| `startup_probe_config.initial_delay_seconds` | `30` |
| `startup_probe_config.timeout_seconds` | `5` |
| `startup_probe_config.period_seconds` | `10` |
| `startup_probe_config.failure_threshold` | `30` |
| `health_check_config.path` | `"/_health"` |
| `health_check_config.initial_delay_seconds` | `15` |
| `health_check_config.timeout_seconds` | `5` |
| `health_check_config.period_seconds` | `30` |
| `health_check_config.failure_threshold` | `3` |

Both interfaces should be kept consistent. On cold starts with database initialisation, consider increasing `startup_probe_config.failure_threshold` to allow sufficient boot time.

### §7.B Backup & Recovery

| Variable | Default | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Daily at 02:00 UTC |
| `backup_retention_days` | `7` | GCS lifecycle rule |
| `enable_backup_import` | `false` | One-time restore on deploy |
| `backup_source` | `"gcs"` | `"gcs"` or `"gdrive"` |
| `backup_file` | `"backup.sql"` | Filename in GCS backups bucket, or Google Drive file ID |
| `backup_format` | `"sql"` | `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto` |

Note: this module uses `backup_file` (not `backup_uri`) — the variable is named directly, not aliased.

### §7.C Scheduled Jobs

```hcl
cron_jobs = [{
  name     = "strapi-cleanup"
  schedule = "0 3 * * *"
  image    = "strapi:5.0.0"
  command  = ["node", "scripts/cleanup.js"]
}]
```

### §7.D Observability

```hcl
uptime_check_config = {
  enabled        = true
  path           = "/_health"
  check_interval = "60s"
  timeout        = "10s"
}

alert_policies = [{
  name               = "high-error-rate"
  metric_type        = "run.googleapis.com/request_count"
  comparison         = "COMPARISON_GT"
  threshold_value    = 100
  duration_seconds   = 60
  aggregation_period = "60s"
}]
```

---

## §8 Integrations

### §8.A Redis Cache

Strapi supports Redis for session caching. When `enable_redis = false` (the default), no Redis environment variables are injected.

```hcl
enable_redis = true
redis_host   = "10.0.0.5"  # required; no automatic fallback
redis_port   = "6379"       # string type
redis_auth   = ""
```

`redis_host` defaults to `null`. When `enable_redis = true`, you must explicitly set `redis_host` to point to a Memorystore instance or other Redis server.

### §8.B NFS Storage

```hcl
enable_nfs     = true
nfs_mount_path = "/mnt/nfs"
```

### §8.C GCS Fuse Volumes

```hcl
gcs_volumes = [{
  name        = "strapi-assets"
  bucket_name = "my-assets-bucket"
  mount_path  = "/mnt/assets"
  readonly    = false
}]
```

### §8.D Additional Services

`Strapi_CloudRun` exposes the `additional_services` variable, enabling co-deployed Cloud Run services (e.g. a background worker or internal Redis):

```hcl
additional_services = [{
  name                = "worker"
  image               = "strapi:5.0.0"
  port                = 3001
  min_instance_count  = 0
  max_instance_count  = 1
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  output_env_var_name = "WORKER_URL"
}]
```

---

## §9 Platform-Managed Behaviours

The following are set or injected automatically and do not require configuration.

### Database credentials

`App_CloudRun` generates a random PostgreSQL password and stores it in Secret Manager. `Strapi_Common` derives the database connection string from this secret and the Cloud SQL instance connection name.

### Strapi application secrets

`Strapi_Common` auto-generates all five Strapi cryptographic secrets (`APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET`) on first deploy. These are stored in Secret Manager and injected at runtime.

### GCS bucket environment variables

`strapi.tf` injects `GCS_BUCKET_NAME` and `GCS_BASE_URL` after the storage bucket is created. These point to the auto-provisioned `strapi-uploads` suffix bucket and do not need to be set in `environment_variables`.

### Platform-managed initialisation job: `db-init`

The `db-init` job (defined in the `initialization_jobs` default) runs `scripts/create-db-and-user.sh` using a `postgres:15-alpine` image on every Terraform apply (`execute_on_apply = true`). It creates the Strapi database user and initialises the schema. This job is idempotent.

### Probe endpoints

Strapi exposes `/_health` for both startup and liveness checks. This endpoint returns 200 when the application is ready to serve traffic, including when the database connection is established. The default `failure_threshold = 30` on `startup_probe_config` provides approximately 5 minutes of grace time during first-boot database initialisation.

---

## §10 Variable Reference

The table below covers all variables unique to or with notable defaults in `Strapi_CloudRun`. For the full set of inherited variables, see the [App_CloudRun Variable Reference](../App_CloudRun/App_CloudRun.md#variable-reference).

| Variable | Type | Default | Group | Notes |
|---|---|---|---|---|
| `application_name` | `string` | `"strapi"` | 2 | Base resource name |
| `application_display_name` | `string` | `"Strapi CMS"` | 2 | UI display name |
| `application_description` | `string` | `"Strapi CMS on Cloud Run"` | 2 | Service description |
| `application_version` | `string` | `"5.0.0"` | 2 | Image tag |
| `cpu_limit` | `string` | `"2000m"` | 3 | 2 vCPU |
| `memory_limit` | `string` | `"2Gi"` | 3 | 2 GiB |
| `min_instance_count` | `number` | `0` | 3 | Scale-to-zero |
| `max_instance_count` | `number` | `1` | 3 | |
| `container_port` | `number` | `8080` | 3 | Cloud Run module default; overrides Strapi_Common's 1337 |
| `container_protocol` | `string` | `"http1"` | 3 | `"http1"` or `"h2c"` |
| `container_image_source` | `string` | `"custom"` | 3 | `"prebuilt"` or `"custom"` |
| `container_image` | `string` | `""` | 3 | Override for prebuilt |
| `container_build_config` | `object` | `{ enabled = true }` | 3 | Cloud Build config |
| `enable_image_mirroring` | `bool` | `true` | 3 | Mirror to Artifact Registry |
| `enable_cloudsql_volume` | `bool` | `true` | 3 | Unix socket proxy |
| `cloudsql_volume_mount_path` | `string` | `"/cloudsql"` | 3 | Socket path |
| `application_database_name` | `string` | `"strapidb"` | 11 | PostgreSQL DB name |
| `application_database_user` | `string` | `"strapiuser"` | 11 | PostgreSQL user |
| `database_password_length` | `number` | `32` | 11 | 16–64 characters |
| `enable_nfs` | `bool` | `true` | 10 | Cloud Filestore mount |
| `nfs_mount_path` | `string` | `"/mnt/nfs"` | 10 | Container mount path |
| `storage_buckets` | `list` | `[{ name_suffix = "data" }]` | 10 | GCS buckets |
| `backup_file` | `string` | `"backup.sql"` | 6 | GCS filename or Drive ID |
| `backup_format` | `string` | `"sql"` | 6 | Includes `"auto"` option |
| `enable_redis` | `bool` | `false` | 20 | Redis cache |
| `redis_host` | `string` | `null` | 20 | Must be set when Redis enabled |
| `redis_port` | `string` | `"6379"` | 20 | String type |
| `redis_auth` | `string` | `""` | 20 | Sensitive |
| `startup_probe` | `object` | `{ type="HTTP", path="/_health", initial_delay_seconds=60 }` | 13 | Passed to Strapi_Common |
| `liveness_probe` | `object` | `{ type="HTTP", path="/_health", initial_delay_seconds=30 }` | 13 | Passed to Strapi_Common |
| `startup_probe_config` | `object` | `{ path="/_health", initial_delay_seconds=30, failure_threshold=30 }` | 13 | Passed to App_CloudRun |
| `health_check_config` | `object` | `{ path="/_health" }` | 13 | Passed to App_CloudRun |
| `initialization_jobs` | `list` | `[{ name="db-init", execute_on_apply=true }]` | 12 | Platform-managed; modify with care |
| `additional_services` | `list` | `[]` | 12 | Co-deployed Cloud Run services |
| `enable_vpc_sc` | `bool` | `false` | 21 | VPC Service Controls |

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `APP_KEYS` (auto-generated — 4 comma-joined 32-char secrets) | Auto-generated and stored in Secret Manager | **Critical** | Used to sign Strapi session cookies. Changing these keys after first deploy immediately invalidates all active admin and API user sessions. All logged-in users are logged out and cannot re-authenticate until a new login is performed. |
| `ADMIN_JWT_SECRET` (auto-generated) | Auto-generated and stored in Secret Manager | **Critical** | Signs all admin panel JWT tokens. Changing it after first deploy invalidates all admin tokens — all admin users are immediately logged out and all in-flight admin API calls return 401 until re-authentication. |
| `JWT_SECRET` (auto-generated) | Auto-generated and stored in Secret Manager | **Critical** | Signs all API user JWT tokens. Changing it after first deploy invalidates every issued API token for end-users — all user sessions are terminated and all client apps using user tokens fail immediately with 401 errors. |
| `API_TOKEN_SALT` (auto-generated) | Auto-generated and stored in Secret Manager | **Critical** | Used to hash API tokens. Changing it after first deploy permanently breaks all existing API tokens — they cannot be validated and must be regenerated by every API consumer. |
| `TRANSFER_TOKEN_SALT` (auto-generated) | Auto-generated and stored in Secret Manager | **High** | Used to hash data transfer tokens. Changing it invalidates all existing transfer tokens, breaking any in-progress or scheduled data transfers. |
| `application_name` | `"strapi"` | **Critical** | Immutable after first deploy. Changing it renames all GCP resources, triggering full recreation and database loss. |
| `db_name` | `"strapi"` | **Critical** | Immutable after first deploy. Changing it causes Strapi to connect to a new empty database, losing all content types, content data, user accounts, and API configurations. |
| `DATABASE_CLIENT` type (resolved to PostgreSQL — `db_name` and `db_user` are the contract) | `"postgres"` (hard-coded in `config/database.js`) | **High** | Strapi is wired to PostgreSQL via the Foundation Module's Cloud SQL provisioning. The database client cannot be changed to SQLite or MySQL without replacing the entire Common and Foundation module stack. No SQLite support in cloud deployments. |
| `memory_limit` | `"512Mi"` | **High** | Strapi is a Node.js application with a multi-layered content management framework. Values below `512Mi` cause frequent OOM kills during admin panel operations and content API calls. Increase to `1Gi` for production with custom plugins or complex content types. |
| `cpu_limit` | `"1000m"` | **Medium** | Strapi's admin panel and content API are CPU-bound on cold starts and plugin initialization. Values below `500m` cause severe startup throttling. |
| `min_instance_count` | `1` | **Medium** | Strapi defaults to `min_instance_count = 1` to keep at least one warm instance. Scale-to-zero (`0`) causes cold starts of 15–30 seconds due to Strapi's Node.js startup time, which may fail health checks on first request. |
| `max_instance_count` | `10` (Strapi default) | **High** | Strapi stores its admin user sessions and JWT tokens in the database (not local memory). However, rapid horizontal scaling combined with cold starts can cause temporary JWT validation inconsistencies. Use Redis (`enable_redis = true`) for session caching if scaling above `3`. |
| `enable_redis` | `false` | **Medium** | Strapi does not use Redis by default. Enable with a Redis host and port only if using Strapi plugins that explicitly require it (e.g., rate-limiting plugins, custom caching layers). Enabling without a valid Redis host causes connection errors at startup. |
| `redis_host` | `null` (uses NFS server IP when `enable_redis = true` and NFS enabled) | **High** | When `enable_redis = true` and `redis_host` is null/empty and NFS is not enabled, the Redis connection string is blank and Strapi fails to connect to Redis at startup. |
| `ENABLE_REDIS` (injected from `enable_redis`) | `"false"` | **High** | Strapi's entrypoint script reads this env var to configure the Redis connection. Manually overriding it via `environment_variables` without also providing `REDIS_HOST` and `REDIS_PORT` causes a Redis connection failure at startup. |
| `enable_nfs` | Depends on deployment | **Medium** | Strapi uploads (media files, assets) are served from the `/uploads` directory. Without NFS or a GCS bucket configured as the upload provider, uploaded files are stored on ephemeral container filesystem and lost on restart. |
| `enable_iap` | `false` | **High** | Enabling IAP without valid `iap_authorized_users` or groups causes all requests to return 403, blocking the Strapi admin panel entirely. |
| `ingress_settings` | `"all"` | **Medium** | Setting to `"internal"` blocks all public API traffic, including frontend apps that call Strapi's content API. Use `"internal-and-cloud-load-balancing"` for a load-balanced setup. |
| `backup_schedule` | `"0 2 * * *"` (daily at 02:00) | **Medium** | All Strapi content, content types, user accounts, and API configurations live in PostgreSQL. Ensure the backup schedule aligns with your content publication RPO. |
| `execution_environment` | `"gen2"` | **High** | NFS mounts require gen2. Changing to `gen1` causes NFS mount failures. |
| `enable_vpc_sc` | `false` | **Medium** | Requires `organization_id`. If empty, VPC-SC is silently skipped. |
| `secret_propagation_delay` | `30` seconds | **Low** | Too short a delay may cause Strapi to start before the five auto-generated secrets have propagated from Secret Manager, causing startup failures on first deploy with "secret version not found" errors. |

## Destroying Resources

### Known Deletion Issue: Serverless IPv4 Address Release

When destroying a Cloud Run deployment, you may encounter an error similar to:

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause:** GCP holds serverless IPv4 addresses on the VPC subnet asynchronously after a Cloud Run service is deleted. These addresses are released by GCP approximately **20–30 minutes** after the Cloud Run service is removed. Terraform/OpenTofu cannot complete the subnet or VPC deletion until they are fully released.

**Resolution:** Wait 20–30 minutes after the initial destroy attempt, then re-run the destroy command:

```bash
tofu destroy
```

The second run will succeed once GCP has released the reserved addresses.

