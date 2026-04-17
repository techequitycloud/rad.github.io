# Odoo_CloudRun Module — Configuration Guide

`Odoo_CloudRun` deploys **Odoo Community Edition** on Google Cloud Run, backed by
Cloud SQL PostgreSQL and a Cloud Filestore NFS volume for shared file storage.
It is a **wrapper module** built on top of `App_CloudRun`. All GCP infrastructure
(Cloud Run service, networking, Cloud SQL, GCS, secrets, CI/CD) is provisioned by
`App_CloudRun`. `Odoo_CloudRun` adds Odoo-specific application configuration,
two platform-managed initialisation jobs, the master-password secret, and runtime
defaults tuned for Odoo's startup characteristics.

The module uses `Odoo_Common` as a sub-module to resolve application configuration,
secrets, and storage bucket lists, which are then passed into `App_CloudRun` via
`application_config`, `module_secret_env_vars`, and `module_storage_buckets`.

---

## §1 · Module Overview

| Attribute | Value |
|---|---|
| **Underlying platform** | `App_CloudRun` |
| **Sub-module** | `Odoo_Common` |
| **Application** | Odoo Community Edition |
| **Default version** | `18.0` (nightly build channel) |
| **Database** | Cloud SQL PostgreSQL (required) |
| **Persistent storage** | Cloud Filestore NFS (`enable_nfs = true` by default) |
| **Default container port** | `8069` |
| **Default image source** | `custom` (Cloud Build from Odoo nightly Dockerfile) |
| **Max instances default** | `1` (increase only after configuring Redis session store) |
| **Redis** | Optional session store; `enable_redis = false` by default |
| **Platform-managed jobs** | `nfs-init` (directory setup) + `db-init` (database creation) |
| **Platform-managed secret** | `ODOO_MASTER_PASS` (auto-generated, stored in Secret Manager) |

### Wrapper Architecture

```
Odoo_CloudRun (variables.tf / odoo.tf / main.tf)
  └─ Odoo_Common          ← resolves app config, scripts, master-pass secret
  └─ App_CloudRun         ← provisions all GCP infrastructure
```

`Odoo_Common` outputs:
- `config` → merged into `application_config` passed to App_CloudRun
- `odoo_master_pass_secret_id` → injected as `ODOO_MASTER_PASS` via `module_secret_env_vars`
- `storage_buckets` → merged into `module_storage_buckets`
- `path` → used to resolve `scripts_dir`

---

## §2 · IAM & Project Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | — | GCP project ID. All resources are created in this project. Grant the Owner role to `rad-module-creator@tec-rad-ui-2b65.iam.gserviceaccount.com`. |
| `tenant_deployment_id` | `"demo"` | Short suffix appended to resource names. Use `"prod"`, `"staging"`, etc. to deploy multiple environments in the same project. |
| `resource_creator_identity` | `"rad-module-creator@…"` | Service account used by Terraform. Override with a project-specific SA for production. |
| `support_users` | `[]` | Email addresses of users granted IAM access and added as alert notification recipients. |
| `resource_labels` | `{}` | Key-value labels applied to all resources (cost centre, team, environment). |
| `deployment_id` | `""` | Optional fixed deployment ID. A random hex ID is generated when left empty. |

---

## §3 · Core Service Configuration

### §3.A · Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `"odoo"` | Internal identifier used as the base name for the Cloud Run service, Artifact Registry repository, Secret Manager secrets, and GCS buckets. **Do not change after initial deployment.** |
| `application_display_name` | `"Odoo ERP"` | Human-readable name shown in the platform UI, Cloud Run console, and monitoring dashboards. Safe to update at any time. |
| `application_description` | `"Odoo ERP on Cloud Run"` | Brief description populated into the Cloud Run service description field. |
| `application_version` | `"18.0"` | Odoo release version. Maps directly to the nightly build channel used in the Dockerfile (`ODOO_VERSION` build arg). Supported values: `"18.0"`, `"17.0"`, `"16.0"`. Changing this when `container_image_source = "custom"` triggers a new Cloud Build run. |

`application_display_name` and `application_description` are passed to `Odoo_Common`
as `display_name` and `description`, then merged into the `application_config` object
consumed by `App_CloudRun`.

### §3.B · Resource Sizing

Odoo is memory-intensive. Its Python workers and database connection pool typically
consume 1.5–3 Gi under normal load. `cpu_limit` and `memory_limit` are dedicated
top-level variables that take precedence over `container_resources` when both are set.

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `"1000m"` | CPU allocated per instance. Increase to `"2000m"` or higher for production. CPU above `"1000m"` requires `min_instance_count >= 1`. |
| `memory_limit` | `"1Gi"` | Memory per instance. **Minimum `"2Gi"` recommended for production**; below `"2Gi"` causes OOM kills under load. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Structured resource object. Takes precedence over `cpu_limit` / `memory_limit` when explicitly set. |
| `min_instance_count` | `0` | Scale-to-zero by default. Set to `1` for production to eliminate cold starts (60–180 s for Odoo). |
| `max_instance_count` | `1` | Keep at `1` until Redis session store is configured; multiple instances without Redis cause session inconsistency. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 s). Increase for long Odoo operations such as report generation or data imports. |
| `execution_environment` | `"gen2"` | Required for NFS mounts. Do not change to `"gen1"` when `enable_nfs = true`. |

**Recommended production sizing:**
```hcl
cpu_limit          = "2000m"
memory_limit       = "4Gi"
min_instance_count = 1
max_instance_count = 3   # only after configuring Redis
```

### §3.C · Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Plain-text environment variables injected at runtime. Use for SMTP settings, feature flags, and other non-sensitive config. |
| `secret_environment_variables` | `{}` | Map of env var name → Secret Manager secret name. Values resolved at runtime; never stored in plaintext. |
| `explicit_secret_values` | `{}` | Raw sensitive values written into Secret Manager during deployment. Use to set a custom `ODOO_MASTER_PASS` or SMTP password. Sensitive; never stored in Terraform state in plaintext. |
| `secret_rotation_period` | `"2592000s"` | Rotation reminder period (30 days default). Set `null` to disable. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before dependent operations proceed. |

**Configuring SMTP for Odoo email notifications:**

```hcl
environment_variables = {
  SMTP_HOST  = "smtp.sendgrid.net"
  SMTP_PORT  = "587"
  SMTP_USER  = "apikey"
  SMTP_SSL   = "true"
  EMAIL_FROM = "noreply@yourcompany.example.com"
}

secret_environment_variables = {
  SMTP_PASSWORD = "odoo-smtp-password"   # Secret Manager secret name
}
```

To set a known master password instead of the auto-generated one:

```hcl
explicit_secret_values = {
  ODOO_MASTER_PASS = "your-chosen-master-password"
}
```

### §3.D · Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `"all"` | Traffic sources permitted to reach Cloud Run. `"all"` = public internet; `"internal"` = VPC only; `"internal-and-cloud-load-balancing"` = when fronted by a GLB. |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | Outbound VPC routing. `"PRIVATE_RANGES_ONLY"` routes RFC 1918 traffic via VPC; `"ALL_TRAFFIC"` routes all egress via VPC. |
| `container_port` | `8069` | Port Odoo listens on inside the container. Do not change unless the Odoo server config binds to a different port. |
| `container_protocol` | `"http1"` | HTTP version: `"http1"` or `"h2c"`. Use `"http1"` for Odoo. |
| `cloudsql_volume_mount_path` | `"/cloudsql"` | Path where the Cloud SQL Auth Proxy Unix socket is mounted. Only used when `enable_cloudsql_volume = true`. |
| `enable_cloudsql_volume` | `true` | Injects Cloud SQL Auth Proxy sidecar for Unix socket connections to Cloud SQL. Disable only when connecting via TCP. |

### §3.E · Container Image & Build

Odoo_CloudRun defaults to building a custom container image from the official Odoo
nightly packages via Cloud Build. Set `container_image_source = "prebuilt"` to
skip the build and deploy a pre-existing image directly.

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `"custom"` | `"custom"` = build from source using Cloud Build; `"prebuilt"` = deploy an existing image directly. |
| `container_image` | `""` | Full image URI (e.g. `"us-docker.pkg.dev/my-project/repo/odoo:18.0"`). Used when `container_image_source = "prebuilt"` or to override the built image. |
| `container_build_config` | `{ enabled = true }` | Cloud Build configuration: `dockerfile_path`, `context_path`, `build_args`, `artifact_repo_name`. Set `enabled = false` to skip the build step. |
| `enable_image_mirroring` | `true` | Mirrors the image into Artifact Registry before deploy. Recommended to avoid Docker Hub rate limits. |
| `deploy_application` | `true` | Set `false` to provision infrastructure only without deploying the container (useful for staged rollouts). |

---

## §4 · Advanced Security

### §4.A · Automated Password Rotation

| Variable | Default | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Deploys a Cloud Run + Eventarc automated rotation job. Rotates the database password on the schedule set by `secret_rotation_period`. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before Cloud Run restarts to pick up the new value. |
| `secret_rotation_period` | `"2592000s"` | Rotation reminder interval. Also used as the trigger period when `enable_auto_password_rotation = true`. |

### §4.B · VPC Service Controls

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforces VPC-SC perimeter. Restricts GCP API calls to requests originating inside the perimeter. Requires an existing VPC-SC perimeter in the project. |

### §4.C · Identity-Aware Proxy

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Enables Cloud Run native IAP. Requires Google identity authentication before the application is accessible. |
| `iap_authorized_users` | `[]` | Users granted access: `"user:alice@example.com"`, `"serviceAccount:sa@project.iam.gserviceaccount.com"`. |
| `iap_authorized_groups` | `[]` | Google Groups granted access: `"group:engineering@example.com"`. |

### §4.D · Cloud Armor & CDN

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisions a Global HTTPS Load Balancer with a Cloud Armor WAF policy (OWASP Top 10, DDoS mitigation). Required when `application_domains` is set. |
| `application_domains` | `[]` | Custom domains. Google-managed SSL certificates are provisioned per domain. DNS must point to the GLB IP before cert provisioning completes. |
| `enable_cdn` | `false` | Enables Cloud CDN on the GLB to cache static assets at edge. Only used when `enable_cloud_armor = true`. |
| `admin_ip_ranges` | `[]` | IP CIDR ranges permitted for direct administrative access. |

### §4.E · Binary Authorization

| Variable | Default | Description |
|---|---|---|
| `enable_binary_authorization` | `false` | Enforces Binary Authorization policy. Images must carry a valid attestation before deployment. Requires a Binary Authorization policy and attestor to be configured in the project. |

---

## §5 · Traffic & Ingress

### §5.A · Traffic Splitting

Canary or blue-green deployments can be configured by splitting traffic across
Cloud Run revisions. All entries must sum to exactly 100%.

| Variable | Default | Description |
|---|---|---|
| `traffic_split` | `[]` | List of traffic allocations. Each entry: `{ type, percent, revision?, tag? }`. Leave empty to send all traffic to the latest revision. |

**Example — canary deployment:**
```hcl
traffic_split = [
  { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST",   percent = 90 },
  { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", percent = 10, revision = "odoo-00003-abc" },
]
```

### §5.B · Service Annotations & Labels

| Variable | Default | Description |
|---|---|---|
| `service_annotations` | `{}` | Kubernetes-style annotations applied to the Cloud Run service resource. Use for advanced Cloud Run config not exposed as a first-class attribute. |
| `service_labels` | `{}` | Labels applied to the Cloud Run service (in addition to `resource_labels`). |

---

## §6 · CI/CD Integration

### §6.A · GitHub Integration

| Variable | Default | Description |
|---|---|---|
| `enable_cicd_trigger` | `false` | Enables a Cloud Build trigger that automatically builds and deploys when code is pushed to the configured repository. |
| `github_repository_url` | `""` | Full HTTPS URL of the GitHub repository. Required when `enable_cicd_trigger = true`. |
| `github_token` | `""` | GitHub PAT for repository authentication. Mutually exclusive with `github_app_installation_id`. |
| `github_app_installation_id` | `""` | Cloud Build GitHub App installation ID. Preferred for organisation repositories. |
| `cicd_trigger_config` | `{ branch_pattern = "^main$" }` | Advanced trigger config: `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### §6.B · Cloud Deploy

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_deploy` | `false` | Switches CI/CD from direct Cloud Build deployments to a managed Cloud Deploy pipeline. Requires `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | `[dev, staging, prod]` | Ordered promotion stages. Each stage: `name`, `require_approval`, `auto_promote`. `prod` requires approval by default. |

---

## §7 · Reliability & Data

### §7.A · Health Probes

Odoo performs database schema validation and full module installation on first boot,
taking 2–10 minutes. The module exposes **two sets of probe variable names**:

- `startup_probe` / `liveness_probe` — passed to `Odoo_Common`; these are the
  primary variables to configure for Odoo probe tuning.
- `startup_probe_config` / `health_check_config` — the App_CloudRun interface names,
  also passed directly. They have Odoo-specific `/web/health` defaults.

When both are supplied, `startup_probe_config` / `health_check_config` take precedence
on the App_CloudRun side; `startup_probe` / `liveness_probe` apply via Odoo_Common.

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `{ enabled = true, type = "TCP", path = "/", initial_delay_seconds = 60, timeout_seconds = 10, period_seconds = 30, failure_threshold = 3 }` | TCP port check on startup. More reliable than HTTP during Odoo's boot phase. For first deployments with schema creation, increase `failure_threshold` to `6`. |
| `liveness_probe` | `{ enabled = true, type = "HTTP", path = "/web/health", initial_delay_seconds = 120, timeout_seconds = 60, period_seconds = 120, failure_threshold = 3 }` | HTTP check against `/web/health`, which returns 200 only when Odoo has a live database connection. `period_seconds = 120` avoids unnecessary database load. |
| `startup_probe_config` | `{ enabled = true, path = "/web/health", initial_delay_seconds = 180, timeout_seconds = 60, period_seconds = 120, failure_threshold = 3 }` | Structured App_CloudRun startup probe with Odoo-tuned defaults. |
| `health_check_config` | `{ enabled = true, path = "/web/health", initial_delay_seconds = 30, timeout_seconds = 5, period_seconds = 30, failure_threshold = 3 }` | Structured App_CloudRun liveness probe with Odoo-tuned defaults. |

### §7.B · Storage

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisions a Cloud Filestore NFS instance. Required for Odoo filestore, session, and extra-addons directories. Requires `execution_environment = "gen2"`. |
| `nfs_mount_path` | `"/mnt"` | Container mount path for the NFS volume. The `nfs-init` job creates subdirectories (`/mnt/filestore`, `/mnt/sessions`, `/mnt/extra-addons`) under this path. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | GCS buckets to provision. `Odoo_Common` may provision additional buckets via `module_storage_buckets`. |
| `create_cloud_storage` | `true` | Set `false` to skip GCS bucket provisioning. |
| `gcs_volumes` | `[]` | GCS buckets to mount as GCS Fuse volumes inside the container. |

### §7.C · Database

Odoo requires PostgreSQL. `application_database_name` and `application_database_user`
are the Odoo-specific defaults for the database and user provisioned by `App_CloudRun`.
All DB connection variables (`DB_NAME`, `DB_USER`, `DB_PASSWORD`, etc.) are injected
automatically — see §9 Platform-Managed Behaviours.

| Variable | Default | Description |
|---|---|---|
| `application_database_name` | `"odoo"` | PostgreSQL database name. Injected as `DB_NAME`. **Do not change after initial deployment.** |
| `application_database_user` | `"odoo"` | PostgreSQL user. Password auto-generated; injected as `DB_PASSWORD`. |
| `database_password_length` | `16` | Auto-generated password length (8–64 characters). |
| `enable_auto_password_rotation` | `false` | Automates password rotation via Cloud Run + Eventarc. See §4.A. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before Cloud Run restarts. |

### §7.D · Backup & Recovery

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Cron expression (UTC) for automated backups. Leave empty to disable. |
| `backup_retention_days` | `7` | Days to retain backup files before automatic deletion. |
| `enable_backup_import` | `false` | Triggers a one-time import job to restore a backup on the next `terraform apply`. |
| `backup_source` | `"gcs"` | Source: `"gcs"` (filename in the backups bucket) or `"gdrive"` (Google Drive file ID). |
| `backup_file` | `"backup.sql"` | For GCS: filename in the backups bucket. For Google Drive: the file ID from the share URL. |
| `backup_format` | `"sql"` | Format: `sql`, `gz`, `tar`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## §8 · Integrations

### §8.A · Redis Session Store

When `max_instance_count > 1`, Redis is required. Without it each instance has its
own session store and users are logged out on requests landing on different instances.

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Configures Odoo to use Redis for session storage. Injects `SESSION_REDIS`, `REDIS_HOST`, and `REDIS_PORT` automatically. Requires `redis_host` to be set. |
| `redis_host` | `""` | Redis hostname or IP. For Cloud Memorystore use the primary endpoint IP. Required when `enable_redis = true`. |
| `redis_port` | `"6379"` | Redis TCP port (string). |
| `redis_auth` | `""` | Redis AUTH password. Leave empty if authentication is not enabled. Treated as sensitive. |

### §8.B · Custom SQL Scripts

| Variable | Default | Description |
|---|---|---|
| `enable_custom_sql_scripts` | `false` | Runs `.sql` files from GCS against the Odoo database after provisioning. Useful for schema migrations or seed data. |
| `custom_sql_scripts_bucket` | `""` | GCS bucket name (without `gs://`) containing the scripts. |
| `custom_sql_scripts_path` | `""` | Path prefix within the bucket. Files are run in lexicographic order; use numeric prefixes (e.g. `001_schema.sql`). |
| `custom_sql_scripts_use_root` | `false` | Run scripts as the root database user (for extension creation, role management). |

### §8.C · Jobs & Scheduled Tasks

User-defined initialization and cron jobs are passed through to `App_CloudRun` in
addition to the two platform-managed jobs (`nfs-init` and `db-init` — see §9).

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Cloud Run jobs executed once during deployment. Each job requires at least one of `command`, `args`, or `script_path`. |
| `cron_jobs` | `[]` | Recurring Cloud Scheduler-triggered jobs. Each entry requires `name` and `schedule` (cron format, UTC). |
| `additional_services` | `[]` | Additional Cloud Run services deployed alongside Odoo (e.g. Celery workers, background processors). Each service URL can be injected into Odoo via `output_env_var_name`. |

### §8.D · Observability

| Variable | Default | Description |
|---|---|---|
| `uptime_check_config` | `{ enabled = true, path = "/" }` | Cloud Monitoring uptime check. `check_interval` and `timeout` use `"Ns"` format. |
| `alert_policies` | `[]` | Metric-threshold alert policies. Each entry: `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`. |
| `service_annotations` | `{}` | Kubernetes-style annotations on the Cloud Run service resource. |
| `service_labels` | `{}` | Labels on the Cloud Run service (in addition to `resource_labels`). |

---

## §9 · Platform-Managed Behaviours

These are set automatically by the module and cannot be overridden via input variables.

### Initialisation Jobs (always run)

| Job | What it does |
|---|---|
| `nfs-init` | Mounts the Filestore NFS share and creates `/mnt/filestore`, `/mnt/sessions`, and `/mnt/extra-addons` with ownership `101:101` (Odoo process user). Must succeed before the Cloud Run service starts. |
| `db-init` | Creates the Odoo database and application user using credentials from Secret Manager. Runs after `nfs-init`. |

### Environment Variables (always injected)

| Variable | Value / Source | Notes |
|---|---|---|
| `ODOO_MASTER_PASS` | Secret Manager ref | Auto-generated 16-char alphanumeric password stored as `app<app_name><tenant_id><deployment_id>-master-password`. Used for Odoo's database management interface. |
| `DB_PASSWORD` | Secret Manager ref | Auto-generated database password from App_CloudRun; injected for the Odoo application user. |
| `ROOT_PASSWORD` | Secret Manager ref | Same auto-generated database password; used by `db-init` for superuser setup. |

### Structural Wiring

| Behaviour | Detail |
|---|---|
| `scripts_dir` | Resolved as `abspath("${module.odoo_app.path}/scripts")` — points to `Odoo_Common`'s bundled scripts. |
| `module_env_vars` | Empty `{}`. All Odoo env vars are set via `environment_variables` or auto-injected by App_CloudRun. |
| `module_secret_env_vars` | `{ ODOO_MASTER_PASS = module.odoo_app.odoo_master_pass_secret_id }`. |
| `module_storage_buckets` | `module.odoo_app.storage_buckets` from Odoo_Common. |
| `application_config` | Built from `Odoo_Common` config merged with `container_image_source`, `container_image`, `container_port`, and `container_resources` overrides when set. |

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
| 2 | `application_name` | string | `"odoo"` | — |
| 2 | `application_display_name` | string | `"Odoo ERP"` | yes |
| 2 | `application_description` | string | `"Odoo ERP on Cloud Run"` | yes |
| 2 | `application_version` | string | `"18.0"` | yes |
| 3 | `deploy_application` | bool | `true` | yes |
| 3 | `container_image_source` | string | `"custom"` | yes |
| 3 | `container_image` | string | `""` | yes |
| 3 | `container_build_config` | object | `{ enabled = true }` | yes |
| 3 | `enable_image_mirroring` | bool | `true` | yes |
| 3 | `cpu_limit` | string | `"1000m"` | yes |
| 3 | `memory_limit` | string | `"1Gi"` | yes |
| 3 | `container_resources` | object | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | yes |
| 3 | `min_instance_count` | number | `0` | yes |
| 3 | `max_instance_count` | number | `1` | yes |
| 3 | `container_port` | number | `8069` | yes |
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
| 5 | `explicit_secret_values` | map(string) | `{}` | yes |
| 6 | `backup_schedule` | string | `"0 2 * * *"` | yes |
| 6 | `backup_retention_days` | number | `7` | yes |
| 6 | `enable_backup_import` | bool | `false` | yes |
| 6 | `backup_source` | string | `"gcs"` | yes |
| 6 | `backup_file` | string | `"backup.sql"` | yes |
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
| 10 | `enable_nfs` | bool | `true` | — |
| 10 | `nfs_mount_path` | string | `"/mnt"` | — |
| 10 | `gcs_volumes` | list(object) | `[]` | yes |
| 11 | `application_database_name` | string | `"odoo"` | — |
| 11 | `application_database_user` | string | `"odoo"` | — |
| 11 | `database_password_length` | number | `16` | yes |
| 11 | `enable_auto_password_rotation` | bool | `false` | yes |
| 11 | `rotation_propagation_delay_sec` | number | `90` | yes |
| 12 | `initialization_jobs` | list(object) | `[]` | yes |
| 12 | `cron_jobs` | list(object) | `[]` | yes |
| 12 | `additional_services` | list(object) | `[]` | yes |
| 13 | `startup_probe` | object | `{ type = "TCP", initial_delay_seconds = 60, … }` | yes |
| 13 | `liveness_probe` | object | `{ type = "HTTP", path = "/web/health", initial_delay_seconds = 120, … }` | yes |
| 13 | `startup_probe_config` | object | `{ path = "/web/health", initial_delay_seconds = 180, … }` | yes |
| 13 | `health_check_config` | object | `{ path = "/web/health", initial_delay_seconds = 30, … }` | yes |
| 13 | `uptime_check_config` | object | `{ enabled = true, path = "/" }` | yes |
| 13 | `alert_policies` | list(object) | `[]` | yes |
| 20 | `enable_redis` | bool | `false` | yes |
| 20 | `redis_host` | string | `""` | yes |
| 20 | `redis_port` | string | `"6379"` | yes |
| 20 | `redis_auth` | string | `""` | yes |
| 21 | `enable_vpc_sc` | bool | `false` | yes |
