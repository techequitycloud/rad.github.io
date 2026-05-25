---
title: "OpenEMR CloudRun Module — Configuration Guide"
sidebar_label: "OpenEMR CloudRun"
---

# OpenEMR CloudRun Module — Configuration Guide

`OpenEMR_CloudRun` deploys **OpenEMR Community Edition** — the world's most widely
deployed open-source Electronic Health Records (EHR) and medical practice management
platform — on Google Cloud Run Gen 2. OpenEMR is used by solo clinics, developing-world
health systems, and small/mid-size US practices; over 40% of healthcare organizations now
use at least one open-source health IT component. Version 8.0.0 (March 2026) achieved
ONC Ambulatory EHR Certification with US Core 8.0 and USCDI v5, delivering FHIR-compliant,
ONC-certified EHR at near-zero licensing cost. The application runs on Apache with PHP 8.3
FPM on Alpine 3.20, backed by Cloud SQL MySQL 8.0 connected via Unix socket, and a Cloud
Filestore NFS volume that persists the `sites` directory containing patient documents and
application state.

`OpenEMR_CloudRun` is a **wrapper module** built on top of `App_CloudRun`. All GCP
infrastructure is provisioned by `App_CloudRun`. The module adds OpenEMR-specific
configuration, a platform-managed `nfs-init` job for storage preparation and backup
restoration, auto-generated admin password and database password secrets, and runtime
defaults tuned for healthcare availability requirements.

The module uses `OpenEMR_Common` as a sub-module to resolve application configuration,
scripts, and storage bucket lists, which are passed into `App_CloudRun` via
`application_config`, `module_env_vars`, `module_secret_env_vars`, and
`module_storage_buckets`.

---

## §1 · Module Overview

| Attribute | Value |
|---|---|
| **Underlying platform** | `App_CloudRun` |
| **Sub-module** | `OpenEMR_Common` |
| **Application** | OpenEMR (Apache/PHP 8.3 FPM on Alpine 3.20) |
| **Default version** | `7.0.4` |
| **Database** | Cloud SQL MySQL 8.0 (required; Unix socket connection) |
| **Persistent storage** | Cloud Filestore NFS (`enable_nfs = true` by default) |
| **NFS mount path** | `/var/www/localhost/htdocs/openemr/sites` |
| **Default container port** | `80` |
| **Min instances default** | `1` (healthcare availability; scale-to-zero not recommended) |
| **Max instances default** | `1` (increase only after configuring Redis) |
| **Redis** | Enabled by default (`enable_redis = true`); uses NFS server IP when no host is set |
| **Platform-managed job** | `nfs-init` (NFS setup + optional backup restoration) |
| **Platform-managed secrets** | `OE_PASS` (admin password) + `MYSQL_PASS` (database password) |

### Wrapper Architecture

```
OpenEMR_CloudRun (variables.tf / openemr.tf / main.tf)
  └─ OpenEMR_Common   ← resolves app config, nfs-init job, admin-pass secret
  └─ App_CloudRun     ← provisions all GCP infrastructure
```

`OpenEMR_Common` outputs:
- `config` → merged into `application_config` (with `BACKUP_FILEID` injected into `nfs-init` when `backup_uri` is set)
- `admin_password_secret_id` → injected as `OE_PASS` via `module_secret_env_vars`
- `storage_buckets` → merged into `module_storage_buckets`
- `path` → used to resolve `scripts_dir`

The `MYSQL_PASS` secret is sourced directly from `module.app_cloudrun.database_password_secret`
and injected alongside `OE_PASS` via `module_secret_env_vars`.

---

## §2 · IAM & Project Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | — | GCP project ID. All resources are created in this project. Grant the Owner role to `rad-module-creator@tec-rad-ui-2b65.iam.gserviceaccount.com`. |
| `tenant_deployment_id` | `"demo"` | Short suffix appended to resource names. Use `"prod"`, `"clinic-1"`, etc. to deploy multiple environments in the same project. |
| `resource_creator_identity` | `"rad-module-creator@…"` | Service account used by Terraform. Override with a project-specific SA for production. |
| `support_users` | `[]` | Email addresses of users granted IAM access and added as monitoring alert recipients. |
| `resource_labels` | `{}` | Key-value labels applied to all resources (cost centre, team, environment). |
| `deployment_id` | `""` | Optional fixed deployment ID. A random hex ID is generated when left empty. |

---

## §3 · Core Service Configuration

### §3.A · Application Identity

`display_name` and `description` are OpenEMR-specific aliases for
`application_display_name` and `application_description`, passed directly to
`OpenEMR_Common` and then to `App_CloudRun`.

| Variable | Default | Description |
|---|---|---|
| `application_name` | `"openemr"` | Internal identifier used as the base name for the Cloud Run service, Artifact Registry repository, Secret Manager secrets, and GCS buckets. **Do not change after initial deployment.** |
| `display_name` | `"OpenEMR"` | Human-readable name shown in the platform UI, Cloud Run console, and monitoring dashboards. Safe to update at any time. |
| `description` | `"OpenEMR Electronic Health Records on Cloud Run"` | Brief description. Populates the Cloud Run service description field and platform documentation. |
| `application_version` | `"7.0.4"` | OpenEMR release version used as the container image tag. Changing this triggers a new image build. Supported values: `"7.0.4"`, `"7.0.3"`. |

### §3.B · Resource Sizing

OpenEMR's PHP-FPM workers and database connection pool consume 1.5–3 Gi under
normal clinical load. `cpu_limit` and `memory_limit` are built directly into
`container_resources` passed to `App_CloudRun`.

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `"2000m"` | CPU per instance. `"2000m"` is the recommended minimum for production with concurrent clinical users. CPU above `"1000m"` requires `min_instance_count >= 1`. |
| `memory_limit` | `"4Gi"` | Memory per instance. Minimum `"2Gi"` for production; below `"2Gi"` causes OOM kills during peak clinical activity. |
| `min_instance_count` | `1` | **Default is `1`** (not 0). Scale-to-zero is not recommended for healthcare — clinicians require immediate access without cold-start delays. |
| `max_instance_count` | `1` | Keep at `1` until Redis session store is operational; multiple instances without Redis cause PHP session loss. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 s). Increase for long-running operations (report generation, large file uploads, patient data exports). |
| `execution_environment` | `"gen2"` | **Must remain `"gen2"`** for NFS volume support. `"gen1"` will prevent NFS mounts and OpenEMR will fail to start. |

### §3.C · Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Plain-text environment variables injected at runtime. Use for PHP configuration (`PHP_MEMORY_LIMIT`), SMTP settings, and other non-sensitive config. |
| `secret_environment_variables` | `{}` | Map of env var name → Secret Manager secret name. Values resolved at runtime; never stored in plaintext. |
| `secret_rotation_period` | `"2592000s"` | Rotation reminder interval (30 days default). Set `null` to disable. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before dependent operations proceed. |

**Configuring PHP and SMTP:**

```hcl
environment_variables = {
  PHP_MEMORY_LIMIT = "512M"           # increase for large patient datasets
  SMTP_HOST        = "smtp.sendgrid.net"
  SMTP_PORT        = "587"
  SMTP_USER        = "apikey"
  SMTP_SSL         = "true"
  EMAIL_FROM       = "noreply@yourclinic.example.com"
}

secret_environment_variables = {
  SMTP_PASSWORD = "openemr-smtp-password"   # Secret Manager secret name
}
```

### §3.D · Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `"all"` | Traffic sources permitted to reach Cloud Run. For HIPAA-aligned deployments, consider `"internal-and-cloud-load-balancing"` combined with Cloud Armor WAF. |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | Routes RFC 1918 traffic (Cloud SQL, NFS, Redis) via VPC. Change to `"ALL_TRAFFIC"` if all egress must pass through a centralised network appliance. |
| `container_port` | `80` | Apache's listening port inside the container. Do not change unless the Apache config is modified. |
| `container_protocol` | `"http1"` | HTTP version: `"http1"` or `"h2c"`. Use `"http1"` for OpenEMR. |
| `cloudsql_volume_mount_path` | `"/cloudsql"` | Path where the Cloud SQL Auth Proxy Unix socket is mounted. OpenEMR's `sqlconf.php` uses this socket path. |

### §3.E · Container Image & Build

OpenEMR_CloudRun does not expose `container_image_source` or `container_build_config`
as user variables. Image building is managed entirely by `OpenEMR_Common` based on
`application_version`. Set `enable_image_mirroring = false` only if the image is
already available in a private registry.

| Variable | Default | Description |
|---|---|---|
| `application_version` | `"7.0.4"` | OpenEMR version used as the container image tag. Changing this triggers a new Cloud Build image build. |
| `enable_image_mirroring` | `true` | Mirrors the image into Artifact Registry before deploy. Recommended to avoid Docker Hub rate limits. |
| `deploy_application` | `true` | Set `false` to provision infrastructure only (secrets, storage, IAM) without deploying the container. |

---

## §4 · Advanced Security

### §4.A · Automated Password Rotation

| Variable | Default | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Deploys a Cloud Run + Eventarc automated rotation job. Rotates the MySQL database password on the schedule set by `secret_rotation_period`. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before Cloud Run restarts to pick up the new password. |
| `secret_rotation_period` | `"2592000s"` | Rotation reminder interval. Also used as the trigger period when `enable_auto_password_rotation = true`. |

### §4.B · VPC Service Controls

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforces VPC-SC perimeter. Restricts GCP API calls to requests from inside the perimeter. Requires an existing VPC-SC perimeter in the project. |
| `vpc_cidr_ranges` | `[]` | VPC subnet CIDR ranges for the VPC-SC network access level. Auto-discovered when empty. |
| `vpc_sc_dry_run` | `true` | When `true`, VPC-SC violations are logged but not blocked. Set to `false` to actively enforce the perimeter. |
| `organization_id` | `""` | GCP Organization ID for the VPC-SC Access Context Manager policy. Auto-discovered when empty. |
| `enable_audit_logging` | `false` | Enables detailed Cloud Audit Logs (DATA_READ, DATA_WRITE, ADMIN_READ) for compliance-sensitive environments. |

### §4.C · Identity-Aware Proxy

IAP is particularly valuable for EHR applications — it restricts access to
authenticated clinical staff before any request reaches OpenEMR.

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Enables Cloud Run native IAP. Requires Google identity authentication before the application is accessible. |
| `iap_authorized_users` | `[]` | Users granted access: `"user:doctor@clinic.com"`, `"serviceAccount:sa@project.iam.gserviceaccount.com"`. |
| `iap_authorized_groups` | `[]` | Google Groups granted access: `"group:clinical-staff@clinic.com"`. Preferred for clinic-level access management. |

### §4.D · Cloud Armor & CDN

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisions a Global HTTPS Load Balancer with Cloud Armor WAF (OWASP Top 10, DDoS). Required when `application_domains` is set. |
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

| Variable | Default | Description |
|---|---|---|
| `traffic_split` | `[]` | Canary or blue-green traffic allocations across Cloud Run revisions. All entries must sum to 100%. Leave empty to route all traffic to the latest revision. |

**Example — canary deployment:**
```hcl
traffic_split = [
  { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST",   percent = 90 },
  { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", percent = 10, revision = "openemr-00003-abc" },
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
| `enable_cicd_trigger` | `false` | Enables a Cloud Build trigger that automatically builds and deploys when code is pushed to the configured repository. |
| `github_repository_url` | `""` | Full HTTPS URL of the GitHub repository. Required when `enable_cicd_trigger = true`. |
| `github_token` | `""` | GitHub PAT for authentication. Mutually exclusive with `github_app_installation_id`. |
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

OpenEMR performs database connection validation and, on first boot, runs the full
database installation process (5–20 minutes). `startup_probe` and `liveness_probe`
are passed both to `OpenEMR_Common` and — as `startup_probe_config` /
`health_check_config` — directly to `App_CloudRun`.

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `{ enabled = true, type = "TCP", path = "/", initial_delay_seconds = 0, timeout_seconds = 5, period_seconds = 10, failure_threshold = 12 }` | TCP port check during startup. More reliable than HTTP during Apache/PHP-FPM initialisation. With `period_seconds = 10` and `failure_threshold = 12`, allows 120 s of startup time. **On first deployment** (full DB schema install), increase `failure_threshold` to `30`. |
| `liveness_probe` | `{ enabled = true, type = "HTTP", path = "/interface/login/login.php", initial_delay_seconds = 0, timeout_seconds = 10, period_seconds = 30, failure_threshold = 10 }` | HTTP check on the OpenEMR login page. Returns 200 only when Apache, PHP-FPM, and the database connection are all operational. `period_seconds = 30` with `failure_threshold = 10` allows 5 min of recovery. |

### §7.B · Storage

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | **Must remain `true`** for a functional OpenEMR deployment. Provisions Cloud Filestore NFS. OpenEMR cannot persist patient data without shared NFS storage. |
| `nfs_mount_path` | `"/var/www/localhost/htdocs/openemr/sites"` | Container mount path for the NFS volume. Maps directly to OpenEMR's `sites` directory. Do not change unless the container uses a different path. |
| `nfs_instance_name` | `""` | Name of an existing NFS GCE VM to use. Leave empty to auto-discover a Services_GCP-managed instance. |
| `nfs_instance_base_name` | `"app-nfs"` | Base name for the inline NFS GCE VM when no existing instance is found. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | GCS buckets to provision. `OpenEMR_Common` may provision additional buckets via `module_storage_buckets`. |
| `create_cloud_storage` | `true` | Set `false` to skip GCS bucket provisioning. |
| `gcs_volumes` | `[]` | GCS buckets to mount as GCS Fuse volumes inside the container (passed to both `OpenEMR_Common` and `App_CloudRun`). |
| `manage_storage_kms_iam` | `false` | Creates a CMEK KMS keyring and storage encryption key, enabling CMEK on all GCS buckets. |
| `enable_artifact_registry_cmek` | `false` | Creates an Artifact Registry KMS key, enabling CMEK encryption of container images. |

### §7.C · Database

OpenEMR requires MySQL 8.0. `db_name` and `db_user` are aliases for
`application_database_name` and `application_database_user`. The Cloud SQL
connection uses a Unix socket at `cloudsql_volume_mount_path`; TCP connections
are not used.

| Variable | Default | Description |
|---|---|---|
| `db_name` | `"openemr"` | MySQL database name. Injected into `sqlconf.php`. **Do not change after initial deployment.** |
| `db_user` | `"openemr"` | MySQL user. Password auto-generated and injected as `MYSQL_PASS`. |
| `database_password_length` | `32` | Auto-generated password length (16–64 characters). |
| `enable_auto_password_rotation` | `false` | Automates password rotation via Cloud Run + Eventarc. See §4.A. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before Cloud Run restarts. |

### §7.D · Backup & Recovery

`backup_uri` is the OpenEMR-specific name for `backup_file`. The mapping is applied
in `main.tf` (`backup_file = var.backup_uri`). When `backup_uri` is set, it is also
injected into the `nfs-init` job as `BACKUP_FILEID`, triggering backup restoration
during deployment.

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Cron expression (UTC) for automated backups. Leave empty to disable. Daily backups strongly recommended for healthcare data. |
| `backup_retention_days` | `7` | Days to retain backup files. Consider regulatory retention requirements before reducing. |
| `enable_backup_import` | `false` | Triggers backup restoration via the `nfs-init` job. The `backup_uri` value is injected as `BACKUP_FILEID`. |
| `backup_source` | `"gcs"` | Source: `"gcs"` (full GCS URI) or `"gdrive"` (Google Drive file ID). |
| `backup_uri` | `""` | For GCS: e.g. `"gs://my-bucket/backups/openemr.sql"`. Mapped to `backup_file` in App_CloudRun. |
| `backup_format` | `"sql"` | Format: `sql`, `gz`, `tar`, `tgz`, `tar.gz`, `zip`. |

---

## §8 · Integrations

### §8.A · Redis Session Store

Redis is **enabled by default** (`enable_redis = true`) and is required for
multi-instance deployments. Without Redis, each Cloud Run instance has its own
PHP session store and clinical users lose their sessions when requests land on
different instances. When `redis_host` is left empty, the module defaults to
using the NFS server IP as the Redis host (the NFS server runs a co-located
Redis instance).

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Configures OpenEMR to use Redis for PHP session storage. Injects `REDIS_SERVER` automatically. If `redis_host` is empty, uses the NFS server IP. |
| `redis_host` | `""` | Redis hostname or IP. Leave empty to use the NFS server IP. Override with a dedicated Cloud Memorystore instance for higher-availability production deployments. |
| `redis_port` | `"6379"` | Redis TCP port (string). |
| `redis_auth` | `""` | Redis AUTH password. Leave empty if authentication is not enabled. Treated as sensitive. Passed to `App_CloudRun` but not `OpenEMR_Common`. |

### §8.B · Custom SQL Scripts

| Variable | Default | Description |
|---|---|---|
| `enable_custom_sql_scripts` | `false` | Runs `.sql` files from GCS against the OpenEMR MySQL database after provisioning. |
| `custom_sql_scripts_bucket` | `""` | GCS bucket name (without `gs://`) containing the scripts. |
| `custom_sql_scripts_path` | `""` | Path prefix within the bucket. Files run in lexicographic order; use numeric prefixes (e.g. `001_schema.sql`). |
| `custom_sql_scripts_use_root` | `false` | Run scripts as the root database user (for privilege-requiring operations). |

### §8.C · Jobs & Scheduled Tasks

User-defined initialization and cron jobs supplement the platform-managed `nfs-init`
job (see §9). Both are passed through to `App_CloudRun` via `initialization_jobs`
and `cron_jobs`.

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Cloud Run jobs executed once during deployment. Each job requires at least one of `command`, `args`, or `script_path`. Set `mount_nfs = true` for jobs that need access to the sites directory. |
| `cron_jobs` | `[]` | Recurring Cloud Scheduler-triggered jobs. Each entry requires `name` and `schedule` (cron format, UTC). Set `mount_nfs = true` for jobs that access patient documents. |

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

### Initialisation Job

| Job | What it does |
|---|---|
| `nfs-init` | Mounts the Cloud Filestore NFS share; sets ownership of the `sites` directory to UID `1000` (Apache process user); downloads and restores the backup if `backup_uri` is set (injected as `BACKUP_FILEID`); regenerates `sqlconf.php` with current database credentials. **Must complete before the Cloud Run service starts.** |

### Secrets (always injected)

| Variable | Value / Source | Notes |
|---|---|---|
| `OE_PASS` | Secret Manager ref | Auto-generated OpenEMR admin password stored in Secret Manager. Used to set the administrator account on first boot. |
| `MYSQL_PASS` | `module.app_cloudrun.database_password_secret` | Auto-generated MySQL password from App_CloudRun. Do not define this in `secret_environment_variables`. |

### Structural Wiring

| Behaviour | Detail |
|---|---|
| Cloud SQL Unix socket | Connected via Unix socket at `cloudsql_volume_mount_path = "/cloudsql"`. OpenEMR's `sqlconf.php` uses this socket path. TCP connections are not used. This is enforced unconditionally. |
| `scripts_dir` | Resolved as `abspath("${module.openemr_app.path}/scripts")` — points to `OpenEMR_Common`'s bundled scripts. |
| `module_env_vars` | Sourced from `module.openemr_app.config.environment_variables` (OpenEMR_Common's resolved env vars). |
| `startup_probe` → `startup_probe_config` | `var.startup_probe` is passed as `startup_probe_config` to `App_CloudRun` in `main.tf`. |
| `liveness_probe` → `health_check_config` | `var.liveness_probe` is passed as `health_check_config` to `App_CloudRun` in `main.tf`. |
| `backup_uri` → `backup_file` | `var.backup_uri` is mapped to `backup_file` in `main.tf`. Also injected into the `nfs-init` job as `BACKUP_FILEID`. |

---

## §10 · Variable Reference

Complete list of all input variables, grouped by UI section.

| Group | Variable | Type | Default | Updatable |
|---|---|---|---|---|
| 0 | `module_description` | string | *(long description)* | — |
| 0 | `module_documentation` | string | `"https://docs.radmodules.dev/docs/applications/openemr"` | — |
| 0 | `module_dependency` | list(string) | `["Services_GCP"]` | — |
| 0 | `module_services` | list(string) | *(service list)* | — |
| 0 | `credit_cost` | number | `100` | — |
| 0 | `require_credit_purchases` | bool | `false` | — |
| 0 | `enable_purge` | bool | `true` | — |
| 0 | `public_access` | bool | `true` | — |
| 0 | `deployment_id` | string | `""` | yes |
| 0 | `resource_creator_identity` | string | `"rad-module-creator@…"` | yes |
| 1 | `project_id` | string | — | yes |
| 1 | `tenant_deployment_id` | string | `"demo"` | yes |
| 1 | `support_users` | list(string) | `[]` | yes |
| 1 | `resource_labels` | map(string) | `{}` | yes |
| 2 | `application_name` | string | `"openemr"` | yes |
| 2 | `display_name` | string | `"OpenEMR"` | yes |
| 2 | `description` | string | `"OpenEMR Electronic Health Records on Cloud Run"` | yes |
| 2 | `application_version` | string | `"7.0.4"` | yes |
| 3 | `deploy_application` | bool | `true` | yes |
| 3 | `cpu_limit` | string | `"2000m"` | yes |
| 3 | `memory_limit` | string | `"4Gi"` | yes |
| 3 | `min_instance_count` | number | `1` | yes |
| 3 | `max_instance_count` | number | `1` | yes |
| 3 | `container_port` | number | `80` | yes |
| 3 | `execution_environment` | string | `"gen2"` | yes |
| 3 | `timeout_seconds` | number | `300` | yes |
| 3 | `service_annotations` | map(string) | `{}` | yes |
| 3 | `service_labels` | map(string) | `{}` | yes |
| 3 | `traffic_split` | list(object) | `[]` | yes |
| 3 | `container_protocol` | string | `"http1"` | yes |
| 3 | `cloudsql_volume_mount_path` | string | `"/cloudsql"` | yes |
| 3 | `enable_image_mirroring` | bool | `true` | yes |
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
| 9 | `max_images_to_retain` | number | `7` | yes |
| 9 | `delete_untagged_images` | bool | `true` | yes |
| 9 | `image_retention_days` | number | `30` | yes |
| 10 | `create_cloud_storage` | bool | `true` | yes |
| 10 | `storage_buckets` | list(object) | `[{ name_suffix = "data" }]` | yes |
| 10 | `enable_nfs` | bool | `true` | yes |
| 10 | `nfs_mount_path` | string | `"/var/www/localhost/htdocs/openemr/sites"` | yes |
| 10 | `nfs_instance_name` | string | `""` | yes |
| 10 | `nfs_instance_base_name` | string | `"app-nfs"` | yes |
| 10 | `gcs_volumes` | list(object) | `[]` | yes |
| 10 | `manage_storage_kms_iam` | bool | `false` | yes |
| 10 | `enable_artifact_registry_cmek` | bool | `false` | yes |
| 11 | `db_name` | string | `"openemr"` | yes |
| 11 | `db_user` | string | `"openemr"` | yes |
| 11 | `database_password_length` | number | `32` | yes |
| 11 | `enable_auto_password_rotation` | bool | `false` | yes |
| 11 | `rotation_propagation_delay_sec` | number | `90` | yes |
| 12 | `initialization_jobs` | list(object) | `[]` | yes |
| 12 | `cron_jobs` | list(object) | `[]` | yes |
| 13 | `startup_probe` | object | `{ type = "TCP", initial_delay_seconds = 0, failure_threshold = 12, … }` | yes |
| 13 | `liveness_probe` | object | `{ type = "HTTP", path = "/interface/login/login.php", failure_threshold = 10, … }` | yes |
| 13 | `uptime_check_config` | object | `{ enabled = true, path = "/" }` | yes |
| 13 | `alert_policies` | list(object) | `[]` | yes |
| 13 | `max_revisions_to_retain` | number | `7` | yes |
| 20 | `enable_redis` | bool | `true` | yes |
| 20 | `redis_host` | string | `""` | yes |
| 20 | `redis_port` | string | `"6379"` | yes |
| 20 | `redis_auth` | string | `""` | yes |
| 21 | `enable_vpc_sc` | bool | `false` | yes |
| 21 | `vpc_cidr_ranges` | list(string) | `[]` | yes |
| 21 | `vpc_sc_dry_run` | bool | `true` | yes |
| 21 | `organization_id` | string | `""` | yes |
| 21 | `enable_audit_logging` | bool | `false` | yes |

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

