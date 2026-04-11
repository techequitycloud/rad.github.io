---
title: "N8N Cloud Run Configuration Guide"
sidebar_label: "Cloud Run"
---

# N8N CloudRun Module

<video width="100%" controls style={{marginTop: '20px'}} poster="https://storage.googleapis.com/rad-public-2b65/modules/N8N_CloudRun.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/modules/N8N_CloudRun.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

<a href="https://storage.googleapis.com/rad-public-2b65/modules/N8N_CloudRun.pdf" target="_blank">View Presentation (PDF)</a>

n8n is an open-source workflow automation platform that lets you connect services, run logic, and build automated pipelines through a visual node-based interface. This module deploys n8n on **Google Cloud Run** with a managed PostgreSQL database and GCS-backed storage persistence.

`N8N CloudRun` is a **wrapper module** built on top of `App CloudRun`. It uses `App CloudRun` for all GCP infrastructure provisioning (Cloud Run service, networking, Cloud SQL, GCS, secrets, CI/CD) and adds n8n-specific application configuration on top.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How This Guide Is Structured

This guide documents only the variables that are **unique to `N8N CloudRun`** or that have **n8n-specific defaults** that differ from the `App CloudRun` base module. For all other variables — project identity, CI/CD, GCS storage, backup, custom SQL, access and networking, IAP, Cloud Armor, and VPC Service Controls — refer directly to the [App CloudRun Configuration Guide](../App_CloudRun/App_CloudRun_Guide.md).

**Variables fully covered by the App CloudRun guide:**

| Configuration Area | App_CloudRun_Guide Section | N8N-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | Group 0 | Different defaults for `module_description` and `module_documentation`. |
| Project & Identity | Group 1 | Refer to base App CloudRun module documentation. |
| Application Identity | Group 2 | See [N8N Application Identity](#n8n-application-identity) below for n8n-specific defaults. |
| Runtime & Scaling | Group 3 | See [N8N Runtime Configuration](#n8n-runtime-configuration) below. `container_port` defaults to `5678`. `cpu_limit` and `memory_limit` are top-level variables. |
| Environment Variables & Secrets | Group 4 | See [N8N Environment Variables](#n8n-environment-variables) below for SMTP defaults. |
| Observability & Health | Group 5 | See [N8N Health Probes](#n8n-health-probes) below for n8n-specific probe defaults. |
| Jobs & Scheduled Tasks | Group 6 | Refer to base App CloudRun module documentation. |
| CI/CD & GitHub Integration | Group 7 | Refer to base App CloudRun module documentation. |
| Storage — NFS | Group 8 | NFS is **enabled by default** (`enable_nfs = true`). See [Platform-Managed Behaviours](#platform-managed-behaviours). |
| Storage — GCS | Group 9 | Refer to base App CloudRun module documentation. |
| Redis Cache | Group 10 | See [Redis Configuration](#redis-configuration) below — n8n adds `enable_redis` and `redis_host` toggles not present in the base module. |
| Database Backend | Group 11 | See [N8N Database Configuration](#n8n-database-configuration) below. `db_name` and `db_user` replace `application_database_name` and `application_database_user`. |
| Backup & Maintenance | Group 12 | Refer to base App CloudRun module documentation. |
| Custom Initialisation & SQL | Group 13 | Refer to base App CloudRun module documentation. |
| Access & Networking | Group 14 | Refer to base App CloudRun module documentation. |
| Identity-Aware Proxy | Group 15 | Refer to base App CloudRun module documentation. Note: enabling IAP blocks public webhook endpoints — n8n webhooks will be inaccessible to external services when IAP is active. |
| Cloud Armor & CDN | Group 16 | Refer to base App CloudRun module documentation. |
| VPC Service Controls | Group 17 | Refer to base App CloudRun module documentation. |

---

## Platform-Managed Behaviours

The following behaviours are applied automatically by `N8N CloudRun` regardless of the variable values in your `tfvars` file. They cannot be overridden by user configuration.

| Behaviour | Detail |
|---|---|
| **Encryption key auto-generated** | A 32-character random encryption key is generated and stored in Secret Manager as `N8N_ENCRYPTION_KEY`. This key encrypts all n8n credentials (API keys, OAuth tokens, passwords stored in workflows). It is injected into the Cloud Run service automatically. **Back up this secret before destroying the module** — credentials encrypted with one key cannot be decrypted with a different key. |
| **SMTP password auto-generated** | A placeholder SMTP password is generated and stored in Secret Manager as `N8N_SMTP_PASS`. Replace the secret value with your real SMTP credentials before enabling email sending. |
| **n8n port fixed at 5678** | `N8N_PORT=5678` is injected automatically. The `container_port` variable defaults to `5678` to match. Do not override `N8N_PORT` in `environment_variables`. |
| **Database type set to PostgreSQL** | `DB_TYPE=postgresdb` is injected automatically. n8n requires PostgreSQL — do not change `database_type` to MySQL or SQL Server. |
| **Database connection variables injected** | `DB_POSTGRESDB_HOST`, `DB_POSTGRESDB_PORT`, `DB_POSTGRESDB_DATABASE`, `DB_POSTGRESDB_USER`, and `DB_POSTGRESDB_PASSWORD` are injected automatically from the Cloud SQL instance provisioned by App CloudRun. The n8n container connects via the Cloud SQL Auth Proxy Unix socket. |
| **Webhook and editor URLs auto-set** | `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` are set to the predicted Cloud Run service URL, computed from the project number and deployment region before the service is created. This allows n8n webhooks to be correctly advertised in the UI without a chicken-and-egg dependency on the deployed service URL. |
| **GCS persistence for workflow data** | n8n stores workflow binary data in a GCS Fuse volume. This persists data across container restarts and new revisions. |
| **Database initialisation job** | A Cloud Run Job (`db-init`) is created automatically to provision the `n8n_db` database and `n8n_user` PostgreSQL user before the n8n container starts. |

---

## N8N Application Identity

These variables control how the n8n deployment is named and described. They correspond to Group 2 variables in App CloudRun but carry n8n-specific defaults.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_name` | `"n8n"` | `[a-z][a-z0-9-]{0,19}` | Internal identifier used as the base name for the Cloud Run service, Artifact Registry repository, Secret Manager secrets, and GCS buckets. **Do not change after initial deployment** — it is embedded in resource names and changing it will cause resources to be recreated. |
| `display_name` | `"N8N Workflow Automation"` | Any string | Human-readable name shown in the platform UI, the Cloud Run service list, and monitoring dashboards. Can be updated freely without affecting resource names. |
| `description` | `"n8n Workflow Automation - Workflow automation platform"` | Any string | Brief description of the deployment. Populated into the Cloud Run service description field and platform documentation. |
| `application_version` | `"2.4.7"` | n8n version string, e.g. `"2.4.7"`, `"latest"` | Version tag applied to the container image and used for deployment tracking. Increment this value to trigger a new image build and revision. See [n8n releases](https://github.com/n8nio/n8n/releases) for available versions. |

### Validating Application Identity

```bash
# Confirm the Cloud Run service exists with the expected name
gcloud run services describe n8n \
  --region=REGION \
  --format="table(metadata.name,metadata.annotations['run.googleapis.com/description'])"
```

---

## N8N Runtime Configuration

n8n listens on port 5678 and exposes `cpu_limit` and `memory_limit` as **dedicated top-level variables** rather than requiring users to set the full `container_resources` object.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `container_port` | `5678` | Integer, 1–65535 | The TCP port n8n binds to inside the container. Cloud Run routes incoming traffic to this port. Must match `N8N_PORT`. **Do not change** unless you are overriding the default n8n port in a custom container image. |
| `cpu_limit` | `"2000m"` | Cloud Run CPU string (e.g. `"1000m"`, `"2000m"`, `"4"`) | CPU limit for the n8n container. **2 vCPU is the recommended minimum for production workflow automation.** n8n executes workflow nodes concurrently and complex workflows with many nodes are CPU-bound. Setting below `"1000m"` risks throttling and slow workflow execution. |
| `memory_limit` | `"4Gi"` | Cloud Run memory string (e.g. `"2Gi"`, `"4Gi"`, `"8Gi"`) | Memory limit for the n8n container. **4 Gi is recommended for active deployments.** n8n caches workflow state and credential data in memory. Setting below `1Gi` risks out-of-memory container restarts during complex workflow executions. |
| `min_instance_count` | `0` | Integer ≥ 0 | Minimum running instances. Set to `0` to enable scale-to-zero when idle (lowest cost). Set to `1` to eliminate cold starts and ensure webhook availability — n8n webhooks registered in the platform are only active while at least one instance is running. |
| `max_instance_count` | `1` | Integer ≥ 1 | Maximum concurrent instances. The default of `1` ensures workflow state consistency. **Enable Redis queue mode (`enable_redis = true`) before increasing beyond 1** — without Redis, multiple instances will conflict on credential and workflow state. |
| `timeout_seconds` | `300` | Integer, 0–3600 | Maximum request duration before Cloud Run returns a 504 timeout. Increase to `600` or `900` for workflows that involve long-running external API calls or large data processing steps. |

> **Note on `container_resources`:** The full `container_resources` object (as documented in [App_CloudRun_Guide Group 3](../App_CloudRun/App_CloudRun_Guide.md#group-3-runtime--scaling)) is also available. If `container_resources` is set explicitly in your `tfvars`, it takes precedence over the top-level `cpu_limit` and `memory_limit` variables. Use `container_resources` when you also need to set `cpu_request` or `mem_request`.

**N8N-specific runtime defaults that differ from App CloudRun:**

| Variable | App CloudRun Default | N8N CloudRun Default | Reason |
|---|---|---|---|
| `container_port` | `8080` | `5678` | n8n's native port. |
| `cpu_limit` | `"1000m"` | `"2000m"` | Workflow automation is CPU-intensive for concurrent node execution. |
| `memory_limit` | `"512Mi"` | `"4Gi"` | n8n requires substantial memory for workflow state and credential caching. |
| `max_instance_count` | `1` | `1` | Multi-instance requires Redis queue mode. |
| `enable_nfs` | `false` | `true` | NFS provides shared persistence for workflow data across restarts. |
| `enable_cloudsql_volume` | `true` | `true` | n8n connects to Cloud SQL via the Auth Proxy Unix socket. |

### Validating Runtime Configuration

```bash
# View the CPU, memory, and port on the latest revision
gcloud run services describe n8n \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].resources,spec.template.spec.containers[0].ports)"
```

---

## N8N Health Probes

The `N8N CloudRun` module uses **flat probe objects** (`startup_probe` and `liveness_probe`) with n8n-specific defaults. These differ from the `startup_probe_config` / `health_check_config` structured objects documented in [App_CloudRun_Guide Group 5](../App_CloudRun/App_CloudRun_Guide.md#group-5-observability--health).

| Variable | Default | Description & Implications |
|---|---|---|
| `startup_probe` | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=120, timeout_seconds=3, period_seconds=10, failure_threshold=3 }` | Determines when n8n is ready to receive traffic after starting. The `initial_delay_seconds=120` gives n8n time to connect to Cloud SQL, run any pending database migrations, and load workflow state before the probe begins checking. Reduce this value if your n8n instance starts consistently in under 60 seconds. Increase it if you observe startup probe failures during initial database schema creation. |
| `liveness_probe` | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=30, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Periodically checks that the running n8n container is healthy. A failed liveness probe causes Cloud Run to restart the container. The `initial_delay_seconds=30` avoids false-positive restarts during the startup phase. Increase `period_seconds` if liveness probe checks are contributing to CPU usage on a resource-constrained instance. |

> **Note:** The `startup_probe_config` and `health_check_config` structured object variables are also accepted by this module. When both the flat and structured forms are provided, the structured form takes precedence.

---

## Redis Configuration

These variables are **unique to `N8N CloudRun`** at the module level. The base `App CloudRun` module accepts `redis_auth` but does not have the `enable_redis`, `redis_host`, or `redis_port` toggles. Redis is required for n8n **queue mode**, which enables reliable multi-instance workflow execution.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `true` | `true` / `false` | Enables Redis as the n8n queue mode backend by injecting `REDIS_HOST` and `REDIS_PORT` into the Cloud Run service environment. When `true` and `redis_host` is empty, the module defaults to the NFS server IP auto-discovered from `GCP Services`. **Required when `max_instance_count > 1`** to avoid workflow state conflicts between instances. |
| `redis_host` | `""` *(auto-discovered)* | Hostname or IP, e.g. `"10.0.0.5"`, `"redis.internal"` | Hostname or IP of the Redis server. Leave blank to use the NFS server IP auto-discovered from `GCP Services`. Override with a dedicated Redis/Memorystore instance endpoint for production deployments requiring higher availability or AUTH. |
| `redis_port` | `"6379"` | Port string, e.g. `"6379"` | TCP port of the Redis server. Must match the port configured on the Redis instance. |
| `redis_auth` | `""` | Sensitive string | Authentication password for the Redis server. Leave empty for unauthenticated Redis. For Google Cloud Memorystore with AUTH enabled, set this to the instance auth string. Treated as sensitive — never stored in Terraform state in plaintext. |

For full documentation of the Redis Cache group including Memorystore provisioning and TLS configuration, refer to [App_CloudRun_Guide Group 10](../App_CloudRun/App_CloudRun_Guide.md#group-10-redis-cache).

### Validating Redis Configuration

```bash
# Confirm REDIS_HOST and REDIS_PORT are injected into the n8n service
gcloud run services describe n8n \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -E "REDIS"
```

---

## N8N Database Configuration

n8n requires PostgreSQL. This module exposes `db_name` and `db_user` as **short top-level variables** in place of the `application_database_name` and `application_database_user` variables documented in [App_CloudRun_Guide Group 11](../App_CloudRun/App_CloudRun_Guide.md#group-11-database-backend).

All other database variables (`database_password_length`, `enable_auto_password_rotation`, `rotation_propagation_delay_sec`, `secret_rotation_period`, etc.) behave identically to the App CloudRun equivalents — refer to [App_CloudRun_Guide Group 11](../App_CloudRun/App_CloudRun_Guide.md#group-11-database-backend) for their documentation.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `db_name` | `"n8n_db"` | `[a-z][a-z0-9_]{0,62}` | Name of the PostgreSQL database created within the Cloud SQL instance. Injected automatically as `DB_POSTGRESDB_DATABASE`. **Do not change after initial deployment** — renaming the database requires a full backup-and-restore migration. |
| `db_user` | `"n8n_user"` | `[a-z][a-z0-9_]{0,31}` | PostgreSQL user created for n8n. Injected automatically as `DB_POSTGRESDB_USER`. The password is auto-generated, stored in Secret Manager, and injected as `DB_POSTGRESDB_PASSWORD`. |

### Validating Database Configuration

```bash
# Confirm the database and user were created
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID

gcloud sql users list --instance=INSTANCE_NAME --project=PROJECT_ID

# Confirm database env vars are injected into the Cloud Run service
gcloud run services describe n8n \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -E "DB_POSTGRES"
```

---

## N8N Environment Variables

The `environment_variables` variable (documented in [App_CloudRun_Guide Group 4](../App_CloudRun/App_CloudRun_Guide.md#group-4-environment-variables--secrets)) has n8n-specific defaults that configure email delivery. These are plain-text values — for the SMTP password use `secret_environment_variables`.

**Default `environment_variables` in N8N CloudRun:**

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

Override the SMTP values to enable n8n email notifications (workflow failure alerts, credential sharing invitations). For providers such as SendGrid or Mailgun that use API key authentication, set `SMTP_USER = "apikey"` and store the actual key in `secret_environment_variables`.

> **Do not set** `N8N_PORT`, `DB_TYPE`, `DB_POSTGRESDB_*`, `N8N_ENCRYPTION_KEY`, `WEBHOOK_URL`, or `N8N_EDITOR_BASE_URL` in `environment_variables` — these are injected automatically by the platform and will be overridden.

---

## Configuration Examples

### Basic Deployment

Deploys n8n on Cloud Run using default settings. Suitable for evaluation and development. The service scales to zero when idle.

```hcl
# config/basic.tfvars
resource_creator_identity = ""
project_id                = "my-project-123"
tenant_deployment_id      = "basic"
```

### Advanced Deployment

Production-grade deployment with a minimum of 1 instance (no cold starts), Redis queue mode, CI/CD, and full observability.

```hcl
# config/advanced.tfvars
resource_creator_identity = ""
project_id                = "my-project-123"
tenant_deployment_id      = "prod"

application_name = "n8n"
display_name     = "N8N Workflow Automation"

# Scaling & Performance
cpu_limit          = "4000m"
memory_limit       = "8Gi"
min_instance_count = 1
max_instance_count = 5

# Redis (required for multi-instance scaling)
enable_redis = true

# Database
database_password_length = 32

# Traffic management
traffic_split = [
  { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", percent = 100 }
]

# CI/CD & Cloud Deploy
enable_cicd_trigger = true
enable_cloud_deploy = true
cloud_deploy_stages = [
  { name = "dev",     require_approval = false, auto_promote = false },
  { name = "staging", require_approval = false, auto_promote = false },
  { name = "prod",    require_approval = true,  auto_promote = false },
]

# Security
enable_iap                  = false  # Note: enabling IAP blocks public webhooks
enable_binary_authorization = true
enable_cloud_armor          = true

# Backup
backup_schedule       = "0 2 * * *"
backup_retention_days = 30

# Observability
uptime_check_config = {
  enabled        = true
  path           = "/"
  check_interval = "60s"
  timeout        = "10s"
}

alert_policies = [
  {
    name               = "high-latency"
    metric_type        = "run.googleapis.com/request_latencies"
    comparison         = "COMPARISON_GT"
    threshold_value    = 5000
    duration_seconds   = 300
    aggregation_period = "60s"
  }
]
```

### Custom Image Deployment

Deploys n8n with a custom-built container image, external SMTP, and an explicit Redis endpoint.

```hcl
# config/custom.tfvars
resource_creator_identity = ""
project_id                = "my-project-123"
tenant_deployment_id      = "custom"

application_name = "n8n"

# Custom Container Build
container_image_source = "custom"
container_build_config = {
  enabled            = true
  dockerfile_path    = "Dockerfile"
  context_path       = "scripts"
  dockerfile_content = null
  build_args         = {}
  artifact_repo_name = "n8n-repo"
}

# Redis
enable_redis = true
redis_host   = "10.0.0.5"   # Explicit Memorystore IP

# SMTP
environment_variables = {
  SMTP_HOST  = "smtp.sendgrid.net"
  SMTP_PORT  = "587"
  SMTP_USER  = "apikey"
  SMTP_SSL   = "true"
  EMAIL_FROM = "noreply@example.com"
}

secret_environment_variables = {
  SMTP_PASSWORD = "sendgrid-api-key-secret"
}
```
