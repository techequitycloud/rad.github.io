# Sample CloudRun Module — Configuration Guide

`Sample CloudRun` is a **wrapper module** that sits on top of [`App CloudRun`](../App_CloudRun/App_CloudRun_Guide.md). It deploys a pre-configured reference Flask application (Python 3.11, PostgreSQL 15, optional Redis, optional NFS) on Cloud Run. Its purpose is to serve as a working example of how to build a custom application module on top of `App CloudRun`.

Most configuration variables in `Sample CloudRun` are passed through unchanged to `App CloudRun`. For the meaning, options, validation steps, and `gcloud` CLI commands for any variable that appears in `App CloudRun`, refer to the [App CloudRun Configuration Guide](../App_CloudRun/App_CloudRun_Guide.md). This guide documents only what is **unique to `Sample CloudRun`**: its layered architecture, the pre-configured application it ships, and the specific behaviours and variable differences it introduces on top of `App CloudRun`.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## Module Architecture

`Sample CloudRun` composes two internal layers:

```
Sample_CloudRun
├── Sample_Common  (application layer — Flask app, secrets, db-init job, Redis service)
└── App_CloudRun   (infrastructure layer — Cloud Run, Cloud SQL, NFS, networking, CI/CD)
```

**`Sample_Common`** is a shared internal module that produces the application-specific configuration object (`application_config`) consumed by `App CloudRun`. It is responsible for:

- Generating a random 32-character Flask `SECRET_KEY` and storing it in Secret Manager.
- Defining a `db-init` Cloud Run Job (using `postgres:15-alpine`) that runs the bundled database initialisation script (`scripts/db-init.sh`) on first deployment.
- Optionally defining an internal Redis additional Cloud Run service (using `redis:alpine`) when `enable_redis = true`.
- Providing a custom Cloud Build configuration that builds the sample Flask application from the bundled Dockerfile in `Sample_Common/scripts/`.

**`App CloudRun`** receives the merged configuration from `Sample_Common` and provisions all GCP infrastructure: the Cloud Run service, Cloud SQL instance, NFS Filestore/GCE VM, Artifact Registry repository, Secret Manager secrets, IAM bindings, networking, CI/CD pipelines, and observability resources.

You do not interact with `Sample_Common` directly. All inputs are exposed as variables on `Sample CloudRun` itself.

---

## Pre-configured Application

When deployed with default settings, `Sample CloudRun` provides:

| Component | Details |
|---|---|
| **Application framework** | Flask (Python 3.11-slim), listening on port `8080` |
| **Container image source** | `prebuilt` by default (hello container placeholder). Set `container_image_source = "custom"` to build the sample Flask app via Cloud Build. |
| **Database** | PostgreSQL 15, with a `db-init` Cloud Run Job that runs on first deployment |
| **Secret** | `SECRET_KEY` — auto-generated 32-character random string, stored in Secret Manager, injected as the `SECRET_KEY` environment variable |
| **Redis** | Optional — when `enable_redis = true`, an internal Redis (`redis:alpine`) Cloud Run service is deployed alongside the application |
| **NFS** | Optional — when `enable_nfs = true`, a shared NFS volume is mounted at `nfs_mount_path` |

The `db-init` job and the `SECRET_KEY` secret are managed entirely by the module. You do not need to pre-create them.

---

## Behaviours and Variables Unique to Sample CloudRun

### 1. Scale-to-Zero Default (`min_instance_count = 0`)

`Sample CloudRun` defaults `min_instance_count` to `0`, and passes it through to `App CloudRun` without override:

```terraform
# sample.tf
sample_module = merge(module.sample_app.config, {
  min_instance_count = 0  # Scale to zero when no traffic
})
```

**Why:** Cloud Run natively supports scale-to-zero — instances shut down completely when there is no traffic, eliminating idle compute costs. The trade-off is a cold-start delay (typically 1–10 seconds) on the first request after a period of inactivity. Set `min_instance_count = 1` if your application is latency-sensitive or maintains persistent connections.

**Contrast with `Sample GKE`:** `Sample GKE` overrides `min_instance_count` to `1` regardless of the configured value, because GKE Autopilot does not support true scale-to-zero for standard Deployments.

For full details on `min_instance_count` and `max_instance_count`, see [App CloudRun Guide — Group 3](../App_CloudRun/App_CloudRun_Guide.md#group-3-runtime--scaling).

### 2. Redis Requires an Explicit Host

When `enable_redis = true` and `redis_host` is not set, `Sample CloudRun` leaves `REDIS_HOST` empty:

```terraform
# sample.tf
REDIS_HOST = var.enable_redis ? (
  var.redis_host != null && var.redis_host != "" ? var.redis_host : ""
) : ""
```

**Why:** Cloud Run instances do not share a pod-level network namespace — each instance is isolated and cannot reach a co-located process via `127.0.0.1`. When `enable_redis = true`, Sample_Common deploys Redis as a separate Cloud Run service (via `additional_services`), but that service has its own internal URL, not `127.0.0.1`. You must set `redis_host` explicitly to the internal URL or IP address of your Redis instance (e.g. a Cloud Memorystore for Redis private IP, or the Cloud Run internal URL of the Redis additional service).

**Contrast with `Sample GKE`:** `Sample GKE` falls back to `127.0.0.1` when no `redis_host` is provided, because in Kubernetes the Redis additional service can be reached via a stable cluster-local address.

### 3. Flat CPU and Memory Variables

`Sample CloudRun` exposes CPU and memory as two independent scalar variables rather than a nested object:

| Variable | Type | Default | Passed to |
|---|---|---|---|
| `cpu_limit` | `string` | `"1000m"` | `Sample_Common` (application config) |
| `memory_limit` | `string` | `"512Mi"` | `Sample_Common` (application config) |

These are passed to `Sample_Common`, which assembles them into the `container_resources` object that `App CloudRun` consumes.

**Contrast with `Sample GKE`:** `Sample GKE` uses a nested `container_resources` object (matching `App GKE`'s variable structure directly), with sub-fields `cpu_limit`, `memory_limit`, `cpu_request`, `mem_request`, and `ephemeral_storage_limit`.

For guidance on appropriate CPU and memory values for Cloud Run, see [App CloudRun Guide — Group 3](../App_CloudRun/App_CloudRun_Guide.md#group-3-runtime--scaling).

### 4. Dual Probe Variables

`Sample CloudRun` exposes **two distinct sets** of health probe variables that serve different purposes:

| Variable | Passed to | Purpose |
|---|---|---|
| `startup_probe` | `Sample_Common` (application config) | Configures the sample application's startup probe within the merged `application_config` object. This is the probe definition embedded in the app module configuration. |
| `liveness_probe` | `Sample_Common` (application config) | Configures the sample application's liveness probe within the merged `application_config` object. |
| `startup_probe_config` | `App CloudRun` (directly) | Configures the Cloud Run infrastructure-level startup probe — the actual probe that Cloud Run uses to determine when the container is ready to receive traffic. |
| `health_check_config` | `App CloudRun` (directly) | Configures the Cloud Run infrastructure-level liveness probe — the actual probe that Cloud Run uses to periodically check container health. |

In most deployments you will configure `startup_probe_config` and `health_check_config` (which control Cloud Run's actual health checking behaviour). The `startup_probe` and `liveness_probe` variables configure the application-module-level probe definitions that are embedded in the `application_config` for downstream use.

For full details on probe configuration options, see [App CloudRun Guide — Group 5](../App_CloudRun/App_CloudRun_Guide.md#group-5-observability--health).

**Contrast with `Sample GKE`:** `Sample GKE` exposes only `startup_probe_config` and `health_check_config` (passed to `App GKE` and also to `Sample_Common` via the respective variable names). There is no separate `startup_probe`/`liveness_probe` pair in `Sample GKE`.

---

## Configuration Reference

All configuration variables in `Sample CloudRun` are passed through to `App CloudRun`. The table below maps each configuration group to the corresponding section of the `App CloudRun` Configuration Guide, noting any `Sample CloudRun`-specific defaults or differences.

| Group | Description | Sample CloudRun Defaults / Differences | Reference |
|---|---|---|---|
| **Group 0** | Module Metadata & Configuration | `module_description` defaults to `"Sample CloudRun: A sample application module…"`. `module_documentation` points to the Cloud Run App docs URL. `module_services` includes Cloud Run, Cloud Run Jobs, Cloud Build, Artifact Registry, Cloud SQL, Cloud SQL Auth Proxy, Filestore (NFS), GCS Fuse, Secret Manager, Direct VPC Egress, Cloud Monitoring, and Uptime Checks. `resource_creator_identity` is exposed and passed through as in `App CloudRun`. All other variables are identical to `App CloudRun`. | [App CloudRun Guide — Group 0](../App_CloudRun/App_CloudRun_Guide.md#group-0-module-metadata--configuration) |
| **Group 1** | Project & Identity | No changes. `project_id`, `tenant_deployment_id`, `support_users`, and `resource_labels` behave identically to `App CloudRun`. | [App CloudRun Guide — Group 1](../App_CloudRun/App_CloudRun_Guide.md#group-1-project--identity) |
| **Group 2** | Application Identity | `application_name` defaults to `"cloudrunapp"`. `application_display_name` defaults to `"Cloudrun Application"`. `application_description` defaults to `"Sample application to showcase Cloudrun features"`. `application_version` defaults to `"latest"`. All other behaviour is identical to `App CloudRun`. | [App CloudRun Guide — Group 2](../App_CloudRun/App_CloudRun_Guide.md#group-2-application-identity) |
| **Group 3** | Runtime & Scaling | `container_image_source` defaults to `"prebuilt"`. `container_image` defaults to `us-docker.pkg.dev/cloudrun/container/hello`. `min_instance_count` defaults to `0` (scale-to-zero; see [Scale-to-Zero Default](#1-scale-to-zero-default-min_instance_count--0) above). `max_instance_count` defaults to `1`. CPU and memory are exposed as flat `cpu_limit` / `memory_limit` variables rather than a nested `container_resources` object (see [Flat CPU and Memory Variables](#3-flat-cpu-and-memory-variables) above). `enable_image_mirroring`, `container_port`, `container_protocol`, `execution_environment`, `timeout_seconds`, `traffic_split`, `cpu_always_allocated`, `enable_cloudsql_volume`, `cloudsql_volume_mount_path`, `ingress_settings`, and `vpc_egress_setting` are passed through unchanged. | [App CloudRun Guide — Group 3](../App_CloudRun/App_CloudRun_Guide.md#group-3-runtime--scaling) |
| **Group 4** | Environment Variables & Secrets | `environment_variables` and `secret_environment_variables` are passed through to `App CloudRun`. The module automatically injects `ENABLE_REDIS`, `REDIS_HOST` (empty if no `redis_host` provided — see [Redis Requires an Explicit Host](#2-redis-requires-an-explicit-host) above), and `REDIS_PORT`, plus `SECRET_KEY` (sourced from the auto-generated Secret Manager secret). `secret_rotation_period`, `secret_propagation_delay`, `service_annotations`, and `service_labels` are passed through unchanged. | [App CloudRun Guide — Group 4](../App_CloudRun/App_CloudRun_Guide.md#group-4-environment-variables--secrets) |
| **Group 5** | Observability & Health | `startup_probe_config` and `health_check_config` are passed directly to `App CloudRun` (Cloud Run infrastructure health checks). `startup_probe` and `liveness_probe` are passed to `Sample_Common` (application module config). See [Dual Probe Variables](#4-dual-probe-variables) above for the distinction. `uptime_check_config` and `alert_policies` are passed through unchanged. | [App CloudRun Guide — Group 5](../App_CloudRun/App_CloudRun_Guide.md#group-5-observability--health) |
| **Group 6** | Jobs & Scheduled Tasks | `initialization_jobs` defaults to the pre-configured `db-init` job (using `postgres:15-alpine` and the bundled `db-init.sh` script). You may override this with a custom job list. When `enable_redis = true`, an internal Redis additional Cloud Run service is added automatically — you do not need to declare it in `additional_services`. `cron_jobs` is passed through unchanged. | [App CloudRun Guide — Group 6](../App_CloudRun/App_CloudRun_Guide.md#group-6-jobs--scheduled-tasks) |
| **Group 7** | CI/CD & GitHub Integration | All variables (`enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`) are passed through unchanged. Refer to the base guide for full descriptions. | [App CloudRun Guide — Group 7](../App_CloudRun/App_CloudRun_Guide.md#group-7-cicd--github-integration) |
| **Group 8** | Storage & Filesystem — NFS | All variables (`enable_nfs`, `nfs_mount_path`, `nfs_instance_name`, `nfs_instance_base_name`) are passed through unchanged. Refer to the base guide for full descriptions. | [App CloudRun Guide — Group 8](../App_CloudRun/App_CloudRun_Guide.md#group-8-storage--filesystem--nfs) |
| **Group 9** | Storage & Filesystem — GCS | All variables (`create_cloud_storage`, `storage_buckets`, `gcs_volumes`) are passed through unchanged. `Sample_Common` does not define any additional GCS buckets beyond what you configure here. Refer to the base guide for full descriptions. | [App CloudRun Guide — Group 9](../App_CloudRun/App_CloudRun_Guide.md#group-9-storage--filesystem--gcs) |
| **Group 10** | Redis Cache | `enable_redis`, `redis_host`, `redis_port`, and `redis_auth` are passed through to `App CloudRun`. **Note:** `redis_host` must be set explicitly when using Redis — there is no automatic fallback (see [Redis Requires an Explicit Host](#2-redis-requires-an-explicit-host) above). | [App CloudRun Guide — Group 10](../App_CloudRun/App_CloudRun_Guide.md#group-10-redis-cache) |
| **Group 11** | Database Backend | All variables (`database_type`, `application_database_name`, `application_database_user`, `database_password_length`, `enable_auto_password_rotation`, `rotation_propagation_delay_sec`) are passed through unchanged. The database is automatically initialised by the `db-init` Cloud Run Job. Refer to the base guide for full descriptions. | [App CloudRun Guide — Group 11](../App_CloudRun/App_CloudRun_Guide.md#group-11-database-backend) |
| **Group 12** | Backup & Maintenance | All variables (`backup_schedule`, `backup_retention_days`, `enable_backup_import`, `backup_source`, `backup_file`, `backup_format`) are passed through unchanged. Refer to the base guide for full descriptions. | [App CloudRun Guide — Group 12](../App_CloudRun/App_CloudRun_Guide.md#group-12-backup--maintenance) |
| **Group 13** | Custom Initialisation & SQL | All variables (`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root`) are passed through unchanged. Refer to the base guide for full descriptions. | [App CloudRun Guide — Group 13](../App_CloudRun/App_CloudRun_Guide.md#group-13-custom-initialisation--sql) |
| **Group 14** | Access & Networking | All variables (`enable_iap`, `iap_authorized_users`, `iap_authorized_groups`, `enable_vpc_sc`, `admin_ip_ranges`, `enable_cloud_armor`, `application_domains`, `enable_cdn`) are passed through unchanged. Refer to the base guide for full descriptions. | [App CloudRun Guide — Group 14](../App_CloudRun/App_CloudRun_Guide.md#group-14-access--networking) |
| **Group 15** | Identity-Aware Proxy | All IAP variables are passed through unchanged. Refer to the base guide for full descriptions. | [App CloudRun Guide — Group 15](../App_CloudRun/App_CloudRun_Guide.md#group-15-identity-aware-proxy) |
| **Group 16** | Cloud Armor & CDN | All Cloud Armor and CDN variables are passed through unchanged. Refer to the base guide for full descriptions. | [App CloudRun Guide — Group 16](../App_CloudRun/App_CloudRun_Guide.md#group-16-cloud-armor--cdn) |
| **Group 17** | VPC Service Controls | All VPC SC variables are passed through unchanged. Refer to the base guide for full descriptions. | [App CloudRun Guide — Group 17](../App_CloudRun/App_CloudRun_Guide.md#group-17-vpc-service-controls) |

---

## Redis Configuration Summary

The table below summarises the three Redis-related variables and how they interact with `Sample CloudRun`'s behaviour:

| Variable | Default | Behaviour when `enable_redis = true` |
|---|---|---|
| `enable_redis` | `true` | Deploys an internal `redis:alpine` Cloud Run additional service. Injects `ENABLE_REDIS=true`, `REDIS_HOST`, and `REDIS_PORT` into the application container. |
| `redis_host` | `""` | **Must be set explicitly.** If left empty, `REDIS_HOST` is set to an empty string. The application will not be able to connect to Redis unless a valid hostname or IP address is provided (e.g. a Cloud Memorystore private IP, or the internal URL of the Redis additional service). |
| `redis_port` | `"6379"` | Injected as `REDIS_PORT`. Change only if your Redis instance uses a non-standard port. |
| `redis_auth` | `""` | If set, stored in Secret Manager and injected securely. Leave empty for unauthenticated Redis. |

---

## Validating a Sample CloudRun Deployment

Because `Sample CloudRun` delegates all infrastructure to `App CloudRun`, validation follows the same procedures described in the [App CloudRun Configuration Guide](../App_CloudRun/App_CloudRun_Guide.md). The additional resources managed by `Sample_Common` can be validated as follows:

**Flask SECRET_KEY secret:**

```bash
# Confirm the Flask SECRET_KEY secret exists
gcloud secrets list --project=PROJECT_ID \
  --filter="name:secret-key" \
  --format="table(name,createTime)"

# View the secret's replication and rotation config
gcloud secrets describe SECRET_NAME \
  --project=PROJECT_ID \
  --format="yaml(replication,rotation)"
```

**DB-init Cloud Run Job:**

```bash
# List all Cloud Run Jobs in the project
gcloud run jobs list \
  --region=REGION \
  --format="table(name,metadata.creationTimestamp,status.conditions[0].type)"

# View the execution history of the db-init job
gcloud run jobs executions list \
  --job=db-init \
  --region=REGION \
  --format="table(name,status.conditions[0].type,status.startTime,status.completionTime)"

# View db-init job logs
gcloud logging read \
  "resource.type=cloud_run_job AND resource.labels.job_name=db-init" \
  --project=PROJECT_ID \
  --limit=50
```

**Redis additional service (when `enable_redis = true`):**

```bash
# List all Cloud Run services (Redis should appear as APPLICATION_NAME-redis)
gcloud run services list \
  --region=REGION \
  --format="table(name,status.url,status.conditions[0].status)"

# Confirm REDIS_HOST and REDIS_PORT are injected into the main service
gcloud run services describe APPLICATION_NAME \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" \
  | grep -A2 "REDIS"
```
