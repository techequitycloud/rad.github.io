---
title: "Wiki.js Cloud Run Configuration Guide"
sidebar_label: "Cloud Run"
---

# Wikijs CloudRun Module

<video width="100%" controls style={{marginTop: '20px'}} poster="https://storage.googleapis.com/rad-public-2b65/modules/Wikijs_CloudRun.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/modules/Wikijs_CloudRun.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

<a href="https://storage.googleapis.com/rad-public-2b65/modules/Wikijs_CloudRun.pdf" target="_blank">View Presentation (PDF)</a>



`Wikijs_CloudRun` is a pre-configured wrapper around the [`App_CloudRun`](../App_CloudRun/App_CloudRun.md) module that deploys [Wiki.js](https://js.wiki/) — a powerful open-source wiki platform — on Google Cloud Run Gen2.

Every variable in this module is passed through to `App_CloudRun`. The wrapper's role is to supply Wiki.js-appropriate defaults and to call the `Wikijs_Common` sub-module, which generates the application's container image configuration, database initialisation logic, GCS Fuse storage mounts, and database password wiring. You configure this module exactly as you would `App_CloudRun`; the sections below highlight only the variables whose defaults or behaviour differ meaningfully from `App_CloudRun`, or that are unique to this wrapper.

> **Where to look:** If a variable you are configuring is not described here, consult the [App_CloudRun Configuration Guide](../App_CloudRun/App_CloudRun.md). All `App_CloudRun` features — access and networking, IAP, Cloud Armor, CDN, CI/CD, Cloud Deploy, Binary Authorization, traffic splitting, and VPC Service Controls — are available in `Wikijs_CloudRun` with identical behaviour and configuration.

---

## §1 Module Overview

| Property | Value |
|---|---|
| Sub-module | `Wikijs_Common` |
| Default application name | `wikijs` |
| Default display name | `Wiki.js` |
| Default version | `2.5.311` |
| Container port | Managed by `Wikijs_Common` |
| Execution environment | `gen2` |
| Database engine | PostgreSQL 15 (with `pg_trgm` extension) |
| Default DB name | `wikijs` |
| Default DB user | `wikijs` |
| NFS enabled | `true` (mount: `/mnt/nfs`) |
| Redis enabled | `false` |
| Image source | Managed by `Wikijs_Common` |
| Platform-managed job | none (empty default) |

`Wikijs_Common` manages the container image source, build configuration, and GCS Fuse storage (`wikijs-storage` bucket mounted at `/wiki-storage` for persistent asset storage). The database password is wired from `module.app_cloudrun.database_password_secret` directly into `module_secret_env_vars`. The `pg_trgm` PostgreSQL extension is installed by `Wikijs_Common` to enable native full-text search.

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
| `application_name` | `"wikijs"` | Base name for Cloud Run service, secrets, Artifact Registry |
| `display_name` | `"Wiki.js"` | Human-readable name in UI and dashboards |
| `application_version` | `"2.5.311"` | Image tag; increment to update the Wiki.js release |

Note: there is no `description` variable in this module. `display_name` is passed to `Wikijs_Common` but is not forwarded to `App_CloudRun` as `application_display_name`.

### §3.B Resource Sizing

| Variable | Default | Notes |
|---|---|---|
| `cpu_limit` | `"1000m"` | 1 vCPU; increase for wikis with heavy concurrent editing |
| `memory_limit` | `"2Gi"` | 2 GiB; required for Wiki.js with PostgreSQL full-text search |
| `min_instance_count` | `0` | Scale-to-zero by default; set to `1` to eliminate cold starts |
| `max_instance_count` | `1` | Single-instance default |
| `timeout_seconds` | `300` | Increase for large page exports or asset processing |

### §3.C Environment Variables & Secrets

`environment_variables` has a non-empty default that configures Wiki.js database connectivity:

```hcl
environment_variables = {
  DB_TYPE         = "postgres"
  DB_PORT         = "5432"
  DB_USER         = "wikijs"
  DB_NAME         = "wikijs"
  DB_SSL          = "false"
  HA_STORAGE_PATH = "/wiki-storage"
}
```

Override individual keys to change database settings or storage path. Do not remove `DB_TYPE` or `DB_PORT` as Wiki.js requires them to connect.

**Module-injected secrets** (wired via `module_secret_env_vars` in `main.tf`):

| Secret env var | Source |
|---|---|
| `database_password_secret` | `module.app_cloudrun.database_password_secret` |

The database password secret ID is injected directly from `App_CloudRun`'s output. This is wired automatically and does not require user configuration.

**User-supplied secrets:**

```hcl
secret_environment_variables = {
  GITHUB_CLIENT_SECRET = "my-github-oauth-secret"
}
```

### §3.D Networking

Key defaults:

| Variable | Default |
|---|---|
| `ingress_settings` | `"all"` |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` |
| `enable_cloudsql_volume` | `true` |
| `cloudsql_volume_mount_path` | `"/cloudsql"` |
| `container_protocol` | `"http1"` |

Set `container_protocol = "h2c"` to enable HTTP/2 communication between the load balancer and the Cloud Run service.

### §3.E Container Image & Build

Container image source and build configuration are fully managed by `Wikijs_Common`. The `container_image_source`, `container_image`, and `container_build_config` variables are not exposed in this module.

| Variable | Default | Notes |
|---|---|---|
| `enable_image_mirroring` | `true` | Mirrors image to Artifact Registry before deployment |

---

## §4 Advanced Security

### §4.A Identity-Aware Proxy

```hcl
enable_iap            = true
iap_authorized_groups = ["group:wiki-editors@example.com"]
```

### §4.B VPC Service Controls

```hcl
enable_vpc_sc = true  # group=21; requires existing VPC-SC perimeter
```

### §4.C Cloud Armor & CDN

```hcl
enable_cloud_armor  = true
application_domains = ["wiki.example.com"]
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
  { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", revision = "wikijs-00002", percent = 10 },
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
github_repository_url = "https://github.com/my-org/wikijs-config"
github_token          = "ghp_xxxx"  # or use github_app_installation_id
cicd_trigger_config = {
  branch_pattern = "^main$"
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

`Wikijs_CloudRun` uses only `startup_probe` and `liveness_probe` (passed to `Wikijs_Common`). There is no separate `startup_probe_config` / `health_check_config` interface in this module.

| Variable | Default | Notes |
|---|---|---|
| `startup_probe.type` | `"HTTP"` | |
| `startup_probe.path` | `"/healthz"` | Wiki.js health endpoint |
| `startup_probe.initial_delay_seconds` | `60` | Allows time for PostgreSQL schema init |
| `startup_probe.timeout_seconds` | `5` | |
| `startup_probe.period_seconds` | `10` | |
| `startup_probe.failure_threshold` | `3` | |
| `liveness_probe.type` | `"HTTP"` | |
| `liveness_probe.path` | `"/healthz"` | |
| `liveness_probe.initial_delay_seconds` | `60` | |
| `liveness_probe.timeout_seconds` | `5` | |
| `liveness_probe.period_seconds` | `30` | |
| `liveness_probe.failure_threshold` | `3` | |

The `/healthz` endpoint reflects both application readiness and live database connection status.

### §7.B Backup & Recovery

| Variable | Default | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Daily at 02:00 UTC |
| `backup_retention_days` | `7` | GCS lifecycle rule |
| `enable_backup_import` | `false` | One-time restore on deploy |
| `backup_source` | `"gcs"` | `"gcs"` or `"gdrive"` |
| `backup_uri` | `""` | Full GCS URI or Google Drive file ID |
| `backup_format` | `"sql"` | `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip` |

Note: this module uses `backup_uri` (aliased to `backup_file` in `main.tf`). The `"auto"` format is not listed in the variable description but the underlying `backup_format` validation accepts it.

### §7.C Scheduled Jobs

```hcl
cron_jobs = [{
  name     = "wiki-export"
  schedule = "0 3 * * 0"  # weekly Sunday at 03:00
  image    = "postgres:15-alpine"
  command  = ["pg_dump", "wikijs"]
}]
```

### §7.D Observability

```hcl
uptime_check_config = {
  enabled        = true
  path           = "/"
  check_interval = "60s"
  timeout        = "10s"
}

alert_policies = [{
  name               = "high-latency"
  metric_type        = "run.googleapis.com/request_latencies"
  comparison         = "COMPARISON_GT"
  threshold_value    = 2000
  duration_seconds   = 300
  aggregation_period = "60s"
}]
```

---

## §8 Integrations

### §8.A Redis Cache

Wiki.js can use Redis for session caching. When `enable_redis = false` (the default), no Redis environment variables are injected.

```hcl
enable_redis = true
redis_host   = "10.0.0.5"  # required when Redis enabled
redis_port   = "6379"       # string type
redis_auth   = ""
```

### §8.B NFS Storage

```hcl
enable_nfs     = true
nfs_mount_path = "/mnt/nfs"
```

### §8.C GCS Fuse Volumes (wikijs-storage)

`Wikijs_Common` provisions a `wikijs-storage` GCS bucket and expects it to be mounted at `/wiki-storage` for persistent asset storage. To wire this up, use `gcs_volumes`:

```hcl
gcs_volumes = [{
  name        = "wikijs-storage"
  bucket_name = ""          # leave empty for the auto-provisioned bucket
  mount_path  = "/wiki-storage"
  readonly    = false
}]
```

The `HA_STORAGE_PATH = "/wiki-storage"` default in `environment_variables` points Wiki.js to this mount. If you change the mount path, update `HA_STORAGE_PATH` accordingly.

### §8.D Additional Services

`Wikijs_CloudRun` does not expose the `additional_services` variable.

---

## §9 Platform-Managed Behaviours

The following are set or injected automatically and do not require configuration.

### Database password wiring

Unlike most other wrapper modules, `Wikijs_CloudRun` wires the database password directly from `App_CloudRun`'s output (`module.app_cloudrun.database_password_secret`) into `module_secret_env_vars` as `database_password_secret`. This cross-module reference is handled in `main.tf` and does not require user input.

### PostgreSQL pg_trgm extension

`Wikijs_Common` installs the `pg_trgm` PostgreSQL extension during database initialisation to enable Wiki.js's native full-text search. This is performed automatically and requires no additional configuration.

### GCS storage bucket

`Wikijs_Common` provisions a storage bucket with the suffix `wikijs-storage`. The bucket name is made available via `module.wikijs_app.storage_buckets` and passed to `App_CloudRun` as `module_storage_buckets`. Set `gcs_volumes` to mount this bucket at `/wiki-storage`.

### Default environment variables

The non-empty `environment_variables` default (`DB_TYPE`, `DB_PORT`, `DB_USER`, `DB_NAME`, `DB_SSL`, `HA_STORAGE_PATH`) is required for Wiki.js to connect to the database and locate its storage path. These values are merged with any user-supplied `environment_variables`; user values take precedence.

### Probe endpoint

Wiki.js exposes `/healthz` for both startup and liveness checks. This endpoint returns 200 when the application is running and connected to PostgreSQL. The `initial_delay_seconds = 60` on both probes allows time for PostgreSQL schema initialisation on first boot.

---

## §10 Variable Reference

The table below covers all variables unique to or with notable defaults in `Wikijs_CloudRun`. For the full set of inherited variables, see the [App_CloudRun Variable Reference](../App_CloudRun/App_CloudRun.md#variable-reference).

| Variable | Type | Default | Group | Notes |
|---|---|---|---|---|
| `application_name` | `string` | `"wikijs"` | 2 | Base resource name |
| `display_name` | `string` | `"Wiki.js"` | 2 | Passed to Wikijs_Common |
| `application_version` | `string` | `"2.5.311"` | 2 | Image tag |
| `db_name` | `string` | `"wikijs"` | 11 | PostgreSQL DB name |
| `db_user` | `string` | `"wikijs"` | 11 | PostgreSQL user |
| `cpu_limit` | `string` | `"1000m"` | 3 | 1 vCPU |
| `memory_limit` | `string` | `"2Gi"` | 3 | 2 GiB |
| `min_instance_count` | `number` | `0` | 3 | Scale-to-zero |
| `max_instance_count` | `number` | `1` | 3 | |
| `enable_image_mirroring` | `bool` | `true` | 3 | Mirror to Artifact Registry |
| `container_protocol` | `string` | `"http1"` | 3 | `"http1"` or `"h2c"` |
| `enable_cloudsql_volume` | `bool` | `true` | 3 | Unix socket proxy |
| `cloudsql_volume_mount_path` | `string` | `"/cloudsql"` | 3 | Socket path |
| `environment_variables` | `map(string)` | `{ DB_TYPE="postgres", DB_PORT="5432", ... }` | 5 | Non-empty default; required for DB connectivity |
| `database_password_length` | `number` | `16` | 11 | 8–64 characters |
| `enable_nfs` | `bool` | `true` | 10 | Cloud Filestore mount |
| `nfs_mount_path` | `string` | `"/mnt/nfs"` | 10 | Container mount path |
| `storage_buckets` | `list` | `[{ name_suffix = "data" }]` | 10 | GCS buckets |
| `gcs_volumes` | `list` | `[]` | 10 | Mount wikijs-storage at `/wiki-storage` |
| `backup_uri` | `string` | `""` | 6 | Full GCS URI or Drive ID (aliased to `backup_file`) |
| `backup_format` | `string` | `"sql"` | 6 | No `"auto"` in description (accepted by validation) |
| `enable_redis` | `bool` | `false` | 20 | Redis cache |
| `redis_host` | `string` | `""` | 20 | Required when Redis enabled |
| `redis_port` | `string` | `"6379"` | 20 | String type |
| `redis_auth` | `string` | `""` | 20 | Sensitive |
| `startup_probe` | `object` | `{ type="HTTP", path="/healthz", initial_delay_seconds=60 }` | 13 | |
| `liveness_probe` | `object` | `{ type="HTTP", path="/healthz", initial_delay_seconds=60 }` | 13 | |
| `initialization_jobs` | `list` | `[]` | 12 | No platform-managed jobs |
| `enable_vpc_sc` | `bool` | `false` | 21 | VPC Service Controls |
