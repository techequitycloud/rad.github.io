# Sample_CloudRun Module — Configuration Guide

`Sample_CloudRun` is a **reference wrapper module** that sits on top of `App_CloudRun`.
It deploys a pre-configured Flask application (Python 3.11, PostgreSQL 15, optional
Redis, optional NFS) on Cloud Run, and serves as a working example of how to build
a custom application module on top of `App_CloudRun`.

`Sample_CloudRun` composes two internal layers: `Sample_Common` produces the
application-specific configuration object, and `App_CloudRun` provisions all GCP
infrastructure. You do not interact with `Sample_Common` directly — all inputs are
exposed as variables on `Sample_CloudRun` itself.

---

## §1 · Module Overview

| Attribute | Value |
|---|---|
| **Underlying platform** | `App_CloudRun` |
| **Sub-module** | `Sample_Common` |
| **Application** | Flask (Python 3.11-slim), listening on port `8080` |
| **Default version** | `"latest"` |
| **Database** | Cloud SQL PostgreSQL 15, initialised by the `db-init` job |
| **Default image** | `us-docker.pkg.dev/cloudrun/container/hello` (`container_image_source = "prebuilt"`) |
| **Min instances** | `0` — **hardcoded in `sample.tf`**; overrides user input (see §9) |
| **Max instances** | `1` |
| **NFS** | Optional (`enable_nfs = true` by default), mounted at `/mnt/nfs` |
| **Redis** | Optional (`enable_redis = false` by default); no NFS-server fallback |
| **Platform-managed secret** | `SECRET_KEY` (auto-generated 32-char Flask secret key) |
| **Platform-managed job** | `db-init` (PostgreSQL schema initialisation) |

### Wrapper Architecture

```
Sample_CloudRun (variables.tf / sample.tf / main.tf)
  └─ Sample_Common    ← resolves app config, db-init job, SECRET_KEY secret, Redis service
  └─ App_CloudRun     ← provisions all GCP infrastructure
```

`Sample_Common` outputs:
- `config` → merged into `application_config` (with `min_instance_count = 0` forced)
- `secret_ids.FLASK_SECRET_KEY` → injected as `SECRET_KEY` via `module_secret_env_vars`
- `storage_buckets` → merged into `module_storage_buckets`
- `path` → used to resolve `scripts_dir`

`module_env_vars` injects `ENABLE_REDIS`, `REDIS_HOST`, and `REDIS_PORT` from the
Redis variables. `REDIS_HOST` is left empty when `redis_host` is not set — there is
no NFS-server fallback (see §8.A).

---

## §2 · IAM & Project Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | — | GCP project ID. All resources are created in this project. Grant the Owner role to `rad-module-creator@tec-rad-ui-2b65.iam.gserviceaccount.com`. |
| `tenant_deployment_id` | `"demo"` | Short suffix appended to resource names. Use `"prod"`, `"staging"`, etc. for multiple environments in the same project. |
| `resource_creator_identity` | `"rad-module-creator@…"` | Service account used by Terraform. Override with a project-specific SA for production. |
| `support_users` | `[]` | Email addresses of users granted IAM access and added as monitoring alert recipients. |
| `resource_labels` | `{}` | Key-value labels applied to all resources (cost centre, team, environment). |
| `deployment_id` | `""` | Optional fixed deployment ID. A random hex ID is generated when left empty. |

---

## §3 · Core Service Configuration

### §3.A · Application Identity

`application_display_name` and `application_description` are passed to `Sample_Common`
as `display_name` and `description`, then merged into `application_config` for
`App_CloudRun`.

| Variable | Default | Description |
|---|---|---|
| `application_name` | `"cloudrunapp"` | Internal identifier used as the base name for the Cloud Run service, Artifact Registry repository, and Secret Manager secrets. **Do not change after initial deployment.** |
| `application_display_name` | `"Cloudrun Application"` | Human-readable name shown in the platform UI and Cloud Run console. Safe to update at any time. |
| `application_description` | `"Sample application to showcase Cloudrun features"` | Brief description of the application. Populates the Cloud Run service description field. |
| `application_version` | `"latest"` | Version tag applied to the container image. Increment to trigger a new image build or revision. |
| `application_database_name` | `"cloudrunapp"` | PostgreSQL database name. Passed to `Sample_Common` as `db_name`. **Do not change after initial deployment.** |
| `application_database_user` | `"cloudrunapp"` | PostgreSQL user. Passed to `Sample_Common` as `db_user`. Password auto-generated. |

### §3.B · Resource Sizing

`cpu_limit` and `memory_limit` are flat scalar variables passed to `Sample_Common`,
which assembles them into the `container_resources` object consumed by `App_CloudRun`.

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `"1000m"` | CPU per instance (millicores). Increase for CPU-bound Flask workloads. |
| `memory_limit` | `"512Mi"` | Memory per instance. Increase for memory-intensive operations or large datasets. |
| `min_instance_count` | `0` | User-configurable, but **overridden to `0` in `sample.tf`**. Scale-to-zero is hardcoded for this reference module (see §9). |
| `max_instance_count` | `1` | Maximum concurrent instances. Increase when combined with Redis session store. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 s). |
| `execution_environment` | `"gen2"` | Required for NFS mounts when `enable_nfs = true`. |

### §3.C · Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Plain-text environment variables injected at runtime. For non-sensitive config such as feature flags, log levels, or API endpoints. |
| `secret_environment_variables` | `{}` | Map of env var name → Secret Manager secret name. Values resolved at runtime; never stored in plaintext. |
| `secret_rotation_period` | `"2592000s"` | Rotation reminder period (30 days default). Set `null` to disable. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before dependent operations proceed. |

### §3.D · Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `"all"` | Traffic sources permitted to reach Cloud Run. `"all"` = public internet; `"internal"` = VPC only; `"internal-and-cloud-load-balancing"` = when fronted by a GLB. |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | Routes RFC 1918 traffic via VPC; public traffic exits directly. Change to `"ALL_TRAFFIC"` for strict egress controls. |
| `container_port` | `8080` | Port the Flask application listens on. Must match the application's bind port. |
| `container_protocol` | `"http1"` | HTTP version: `"http1"` or `"h2c"`. |
| `enable_cloudsql_volume` | `true` | Injects Cloud SQL Auth Proxy sidecar for Unix socket connections to Cloud SQL. |
| `cloudsql_volume_mount_path` | `"/cloudsql"` | Path where the Cloud SQL Auth Proxy Unix socket is mounted. |

### §3.E · Container Image & Build

By default the module deploys the Cloud Run hello container (`prebuilt`). Set
`container_image_source = "custom"` to build the bundled sample Flask app from the
`Sample_Common/scripts/Dockerfile` via Cloud Build.

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `"prebuilt"` | `"prebuilt"` = deploy an existing image; `"custom"` = build via Cloud Build from `container_build_config`. |
| `container_image` | `"us-docker.pkg.dev/cloudrun/container/hello"` | Image URI when `container_image_source = "prebuilt"`. |
| `container_build_config` | `{ enabled = false }` | Cloud Build config when `container_image_source = "custom"`. Set `enabled = true` and provide `dockerfile_path`, `context_path`, `build_args`, `artifact_repo_name`. |
| `enable_image_mirroring` | `true` | Mirrors the image into Artifact Registry before deploy. Recommended to avoid Docker Hub rate limits. |
| `deploy_application` | `true` | Set `false` to provision infrastructure without deploying the container. |

---

## §4 · Advanced Security

### §4.A · Automated Password Rotation

| Variable | Default | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Deploys a Cloud Run + Eventarc automated rotation job. Rotates the database password on the schedule set by `secret_rotation_period`. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before Cloud Run restarts to pick up the new value. |
| `secret_rotation_period` | `"2592000s"` | Rotation reminder interval (30 days default). Also used as trigger period when rotation is enabled. |

### §4.B · VPC Service Controls

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforces VPC-SC perimeter. Restricts GCP API calls to requests from inside the perimeter. Requires an existing VPC-SC perimeter in the project. |

### §4.C · Identity-Aware Proxy

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Enables Cloud Run native IAP. Requires Google identity authentication before the application is accessible. |
| `iap_authorized_users` | `[]` | Users granted access: `"user:alice@example.com"`. |
| `iap_authorized_groups` | `[]` | Google Groups granted access: `"group:engineering@example.com"`. |

### §4.D · Cloud Armor & CDN

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisions a Global HTTPS Load Balancer with Cloud Armor WAF policy. Required when `application_domains` is set. |
| `application_domains` | `[]` | Custom domains. Google-managed SSL certificates are provisioned per domain. DNS must point to the GLB IP first. |
| `enable_cdn` | `false` | Enables Cloud CDN on the GLB to cache static assets at edge. Only used when `enable_cloud_armor = true`. |
| `admin_ip_ranges` | `[]` | IP CIDR ranges permitted for direct administrative access. |

### §4.E · Binary Authorization

| Variable | Default | Description |
|---|---|---|
| `enable_binary_authorization` | `false` | Enforces Binary Authorization policy. Images must carry a valid attestation before deployment. |

---

## §5 · Traffic & Ingress

### §5.A · Traffic Splitting

| Variable | Default | Description |
|---|---|---|
| `traffic_split` | `[]` | Canary or blue-green traffic allocations across Cloud Run revisions. All entries must sum to 100%. Leave empty to route all traffic to the latest revision. |

**Example:**
```hcl
traffic_split = [
  { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST",   percent = 90 },
  { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", percent = 10, revision = "cloudrunapp-00003-abc" },
]
```

### §5.B · Service Annotations & Labels

| Variable | Default | Description |
|---|---|---|
| `service_annotations` | `{}` | Kubernetes-style annotations on the Cloud Run service resource. |
| `service_labels` | `{}` | Labels on the Cloud Run service (in addition to `resource_labels`). |

---

## §6 · CI/CD Integration

### §6.A · GitHub Integration

| Variable | Default | Description |
|---|---|---|
| `enable_cicd_trigger` | `false` | Enables a Cloud Build trigger that builds and deploys when code is pushed to the configured repository. |
| `github_repository_url` | `""` | Full HTTPS URL of the GitHub repository. Required when `enable_cicd_trigger = true`. |
| `github_token` | `""` | GitHub PAT for authentication. Mutually exclusive with `github_app_installation_id`. |
| `github_app_installation_id` | `""` | Cloud Build GitHub App installation ID. Preferred for organisation repositories. |
| `cicd_trigger_config` | `{ branch_pattern = "^main$" }` | Advanced trigger config: `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### §6.B · Cloud Deploy

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_deploy` | `false` | Switches CI/CD to a managed Cloud Deploy pipeline. Requires `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | `[dev, staging, prod]` | Ordered promotion stages. `prod` requires manual approval by default. |

---

## §7 · Reliability & Data

### §7.A · Health Probes

`Sample_CloudRun` exposes **two distinct sets** of health probe variables:

- `startup_probe` / `liveness_probe` → passed to `Sample_Common` (application config within `application_config`)
- `startup_probe_config` / `health_check_config` → passed directly to `App_CloudRun` (the actual Cloud Run container health checks)

The `startup_probe_config` / `health_check_config` pair controls Cloud Run's live health checking behaviour. `startup_probe` / `liveness_probe` embed probe definitions in the app module config for downstream reference.

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `{ enabled = true, type = "HTTP", path = "/healthz", initial_delay_seconds = 60, timeout_seconds = 5, period_seconds = 10, failure_threshold = 3 }` | Application-level startup probe passed to `Sample_Common`. |
| `liveness_probe` | `{ enabled = true, type = "HTTP", path = "/healthz", initial_delay_seconds = 30, timeout_seconds = 5, period_seconds = 30, failure_threshold = 3 }` | Application-level liveness probe passed to `Sample_Common`. |
| `startup_probe_config` | `{ enabled = true }` | Cloud Run infrastructure startup probe (TCP, `timeout_seconds = 240`, `period_seconds = 240`, `failure_threshold = 1`). Passed directly to `App_CloudRun`. |
| `health_check_config` | `{ enabled = true }` | Cloud Run infrastructure liveness probe (HTTP, `path = "/"`, `timeout_seconds = 1`, `period_seconds = 10`, `failure_threshold = 3`). Passed directly to `App_CloudRun`. |
| `uptime_check_config` | `{ enabled = true, path = "/" }` | Cloud Monitoring uptime check. `check_interval` and `timeout` use `"Ns"` format. |
| `alert_policies` | `[]` | Metric-threshold alert policies. Each entry: `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`. |

### §7.B · Storage

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisions a Cloud Filestore NFS instance. Requires `execution_environment = "gen2"`. |
| `nfs_mount_path` | `"/mnt/nfs"` | Container mount path for the NFS volume. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | GCS buckets to provision. `Sample_Common` may provision additional buckets via `module_storage_buckets`. |
| `create_cloud_storage` | `true` | Set `false` to skip GCS bucket provisioning. |
| `gcs_volumes` | `[]` | GCS buckets to mount as GCS Fuse volumes inside the container. |

### §7.C · Database

| Variable | Default | Description |
|---|---|---|
| `application_database_name` | `"cloudrunapp"` | PostgreSQL database name, passed to `Sample_Common` as `db_name`. Initialised by the `db-init` job on first deployment. |
| `application_database_user` | `"cloudrunapp"` | PostgreSQL user, passed as `db_user`. Password auto-generated. |
| `database_password_length` | `16` | Auto-generated password length (8–64 characters). |
| `enable_auto_password_rotation` | `false` | Automated password rotation. See §4.A. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before Cloud Run restarts. |

### §7.D · Backup & Recovery

`backup_uri` is aliased to `backup_file` in `main.tf` (`backup_file = var.backup_uri`).

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Cron expression (UTC) for automated backups. Leave empty to disable. |
| `backup_retention_days` | `7` | Days to retain backup files before automatic deletion. |
| `enable_backup_import` | `false` | Triggers a one-time database restore on the next `terraform apply`. |
| `backup_source` | `"gcs"` | Source: `"gcs"` (full GCS URI) or `"gdrive"` (Google Drive file ID). |
| `backup_uri` | `""` | For GCS: e.g. `"gs://my-bucket/backups/app.sql"`. Mapped to `backup_file` in App_CloudRun. |
| `backup_format` | `"sql"` | Format: `sql`, `gz`, `tar`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## §8 · Integrations

### §8.A · Redis

Redis is **disabled by default** (`enable_redis = false`). When enabled,
`Sample_Common` deploys an internal `redis:alpine` Cloud Run additional service.
`ENABLE_REDIS`, `REDIS_HOST`, and `REDIS_PORT` are injected via `module_env_vars`.

**Important:** `REDIS_HOST` is left **empty** when `redis_host` is not set. Unlike
other modules (e.g. OpenEMR_CloudRun), there is no NFS-server-IP fallback. Cloud Run
instances are network-isolated — they cannot reach a co-located Redis via `127.0.0.1`.
You must set `redis_host` to the IP or internal URL of your Redis instance (e.g. a
Cloud Memorystore private IP, or the Cloud Run internal URL of the Redis additional
service).

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Deploys an internal `redis:alpine` Cloud Run service. Injects `ENABLE_REDIS`, `REDIS_HOST`, `REDIS_PORT` into the application container. |
| `redis_host` | `""` | **Must be set explicitly.** If left empty, `REDIS_HOST` is an empty string and the application cannot connect to Redis. |
| `redis_port` | `6379` | Redis TCP port. **Note: this is a `number` type**, unlike other modules where it is a string. |
| `redis_auth` | `""` | Redis AUTH password. Treated as sensitive; passed to `App_CloudRun`. Leave empty for unauthenticated Redis. |

### §8.B · Custom SQL Scripts

| Variable | Default | Description |
|---|---|---|
| `enable_custom_sql_scripts` | `false` | Runs `.sql` files from GCS against the PostgreSQL database after provisioning. |
| `custom_sql_scripts_bucket` | `""` | GCS bucket name (without `gs://`) containing the scripts. |
| `custom_sql_scripts_path` | `""` | Path prefix within the bucket. Files run in lexicographic order. |
| `custom_sql_scripts_use_root` | `false` | Run scripts as the root database user. |

### §8.C · Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Cloud Run jobs executed once during deployment. Supplements the platform-managed `db-init` job from `Sample_Common`. |
| `cron_jobs` | `[]` | Recurring Cloud Scheduler-triggered jobs. Each entry: `name`, `schedule` (cron, UTC). |

### §8.D · Observability

| Variable | Default | Description |
|---|---|---|
| `uptime_check_config` | `{ enabled = true, path = "/" }` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric-threshold alert policies. |
| `service_annotations` | `{}` | Kubernetes-style annotations on the Cloud Run service. |
| `service_labels` | `{}` | Labels on the Cloud Run service. |

---

## §9 · Platform-Managed Behaviours

These are set automatically by the module and cannot be overridden via input variables.

### Scale-to-Zero Override

`min_instance_count` is **always forced to `0`** in `sample.tf`, regardless of the
value you configure:

```hcl
# sample.tf
local.sample_module = merge(module.sample_app.config, {
  min_instance_count = 0  # hardcoded; overrides var.min_instance_count
})
```

This is intentional for a reference module that prioritises cost efficiency. Set
`min_instance_count = 1` in the variables if you adapt this module for production
latency requirements (and update the hardcoded value in `sample.tf`).

### Initialisation Job

| Job | What it does |
|---|---|
| `db-init` | Runs the bundled `db-init.sh` script (`postgres:15-alpine` image) against the Cloud SQL PostgreSQL instance on first deployment. Creates the application schema. Managed by `Sample_Common`. |

### Environment Variables (always injected)

| Variable | Value / Source | Notes |
|---|---|---|
| `SECRET_KEY` | Secret Manager ref | Auto-generated 32-char Flask secret key, stored as `FLASK_SECRET_KEY` in Secret Manager. Injected via `module_secret_env_vars`. |
| `ENABLE_REDIS` | `tostring(var.enable_redis)` | `"true"` or `"false"`. Injected via `module_env_vars`. |
| `REDIS_HOST` | `var.redis_host` (or `""`) | Empty string when `redis_host` is not set. No NFS-server fallback. |
| `REDIS_PORT` | `tostring(var.redis_port)` | Only injected when `enable_redis = true`; otherwise `""`. |

### Conditional: Redis Additional Service

When `enable_redis = true`, `Sample_Common` declares an `additional_services` entry
that deploys a `redis:alpine` Cloud Run service alongside the main application. The
service is internal-only (`INGRESS_TRAFFIC_INTERNAL_ONLY`).

### Structural Wiring

| Behaviour | Detail |
|---|---|
| `scripts_dir` | Resolved as `abspath("${module.sample_app.path}/scripts")` — points to `Sample_Common`'s bundled scripts. |
| `backup_uri` → `backup_file` | `var.backup_uri` is mapped to `backup_file` in `main.tf`. |
| `startup_probe` → `Sample_Common` | `var.startup_probe` is passed to `Sample_Common`, embedding it in the `application_config`. |
| `startup_probe_config` → `App_CloudRun` | `var.startup_probe_config` is passed directly to `App_CloudRun` as the live Cloud Run infrastructure probe. |
| `liveness_probe` / `health_check_config` | Same dual routing as startup probes above. |

---

## §10 · Variable Reference

Complete list of all input variables, grouped by UI section.

| Group | Variable | Type | Default | Updatable |
|---|---|---|---|---|
| 0 | `module_description` | string | *(long description)* | — |
| 0 | `module_documentation` | string | `"https://docs.radmodules.dev/docs/applications/cloud-run-app"` | — |
| 0 | `module_dependency` | list(string) | `["Services_GCP"]` | — |
| 0 | `module_services` | list(string) | *(service list)* | — |
| 0 | `credit_cost` | number | `100` | — |
| 0 | `require_credit_purchases` | bool | `true` | — |
| 0 | `enable_purge` | bool | `true` | — |
| 0 | `public_access` | bool | `false` | — |
| 0 | `deployment_id` | string | `""` | yes |
| 0 | `resource_creator_identity` | string | `"rad-module-creator@…"` | yes |
| 1 | `project_id` | string | — | yes |
| 1 | `tenant_deployment_id` | string | `"demo"` | yes |
| 1 | `support_users` | list(string) | `[]` | yes |
| 1 | `resource_labels` | map(string) | `{}` | yes |
| 2 | `application_name` | string | `"cloudrunapp"` | — |
| 2 | `application_display_name` | string | `"Cloudrun Application"` | yes |
| 2 | `application_description` | string | `"Sample application to showcase Cloudrun features"` | yes |
| 2 | `application_version` | string | `"latest"` | yes |
| 3 | `deploy_application` | bool | `true` | yes |
| 3 | `container_image_source` | string | `"prebuilt"` | yes |
| 3 | `container_image` | string | `"us-docker.pkg.dev/cloudrun/container/hello"` | yes |
| 3 | `container_build_config` | object | `{ enabled = false }` | yes |
| 3 | `enable_image_mirroring` | bool | `true` | yes |
| 3 | `cpu_limit` | string | `"1000m"` | yes |
| 3 | `memory_limit` | string | `"512Mi"` | yes |
| 3 | `min_instance_count` | number | `0` (hardcoded to `0` in `sample.tf`) | yes |
| 3 | `max_instance_count` | number | `1` | yes |
| 3 | `container_port` | number | `8080` | yes |
| 3 | `container_protocol` | string | `"http1"` | yes |
| 3 | `execution_environment` | string | `"gen2"` | yes |
| 3 | `timeout_seconds` | number | `300` | yes |
| 3 | `enable_cloudsql_volume` | bool | `true` | yes |
| 3 | `cloudsql_volume_mount_path` | string | `"/cloudsql"` | yes |
| 3 | `traffic_split` | list(object) | `[]` | yes |
| 3 | `service_annotations` | map(string) | `{}` | yes |
| 3 | `service_labels` | map(string) | `{}` | yes |
| 4 | `ingress_settings` | string | `"all"` | yes |
| 4 | `vpc_egress_setting` | string | `"PRIVATE_RANGES_ONLY"` | yes |
| 4 | `enable_iap` | bool | `false` | yes |
| 4 | `iap_authorized_users` | list(string) | `[]` | yes |
| 4 | `iap_authorized_groups` | list(string) | `[]` | yes |
| 5 | `environment_variables` | map(string) | `{}` | yes |
| 5 | `secret_environment_variables` | map(string) | `{}` | yes |
| 5 | `secret_rotation_period` | string | `"2592000s"` | yes |
| 5 | `secret_propagation_delay` | number | `30` | yes |
| 6 | `backup_schedule` | string | `"0 2 * * *"` | yes |
| 6 | `backup_retention_days` | number | `7` | yes |
| 6 | `enable_backup_import` | bool | `false` | yes |
| 6 | `backup_source` | string | `"gcs"` | yes |
| 6 | `backup_uri` | string | `""` | yes |
| 6 | `backup_format` | string | `"sql"` | yes |
| 7 | `enable_cicd_trigger` | bool | `false` | yes |
| 7 | `github_repository_url` | string | `""` | yes |
| 7 | `github_token` | string | `""` | yes |
| 7 | `github_app_installation_id` | string | `""` | yes |
| 7 | `cicd_trigger_config` | object | `{ branch_pattern = "^main$" }` | yes |
| 7 | `enable_cloud_deploy` | bool | `false` | yes |
| 7 | `cloud_deploy_stages` | list(object) | `[dev, staging, prod]` | yes |
| 7 | `enable_binary_authorization` | bool | `false` | yes |
| 8 | `enable_custom_sql_scripts` | bool | `false` | yes |
| 8 | `custom_sql_scripts_bucket` | string | `""` | yes |
| 8 | `custom_sql_scripts_path` | string | `""` | yes |
| 8 | `custom_sql_scripts_use_root` | bool | `false` | yes |
| 9 | `enable_cloud_armor` | bool | `false` | yes |
| 9 | `admin_ip_ranges` | list(string) | `[]` | yes |
| 9 | `application_domains` | list(string) | `[]` | yes |
| 9 | `enable_cdn` | bool | `false` | yes |
| 10 | `create_cloud_storage` | bool | `true` | yes |
| 10 | `storage_buckets` | list(object) | `[{ name_suffix = "data" }]` | yes |
| 10 | `enable_nfs` | bool | `true` | yes |
| 10 | `nfs_mount_path` | string | `"/mnt/nfs"` | yes |
| 10 | `gcs_volumes` | list(object) | `[]` | yes |
| 11 | `application_database_name` | string | `"cloudrunapp"` | — |
| 11 | `application_database_user` | string | `"cloudrunapp"` | — |
| 11 | `database_password_length` | number | `16` | yes |
| 11 | `enable_auto_password_rotation` | bool | `false` | yes |
| 11 | `rotation_propagation_delay_sec` | number | `90` | yes |
| 12 | `initialization_jobs` | list(object) | `[]` | yes |
| 12 | `cron_jobs` | list(object) | `[]` | yes |
| 13 | `startup_probe` | object | `{ type = "HTTP", path = "/healthz", initial_delay_seconds = 60, … }` | yes |
| 13 | `liveness_probe` | object | `{ type = "HTTP", path = "/healthz", initial_delay_seconds = 30, … }` | yes |
| 13 | `startup_probe_config` | object | `{ enabled = true }` (TCP, timeout=240, period=240, threshold=1) | yes |
| 13 | `health_check_config` | object | `{ enabled = true }` (HTTP, path="/", timeout=1, period=10, threshold=3) | yes |
| 13 | `uptime_check_config` | object | `{ enabled = true, path = "/" }` | yes |
| 13 | `alert_policies` | list(object) | `[]` | yes |
| 20 | `enable_redis` | bool | `false` | yes |
| 20 | `redis_host` | string | `""` | yes |
| 20 | `redis_port` | **number** | `6379` | yes |
| 20 | `redis_auth` | string | `""` | yes |
| 21 | `enable_vpc_sc` | bool | `false` | yes |
