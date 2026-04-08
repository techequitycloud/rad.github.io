---
title: "N8N AI GKE Configuration Guide"
sidebar_label: "GKE"
---

# N8N_AI_GKE Module — Configuration Guide

n8n is an open-source workflow automation platform that lets you connect services, run logic, and build AI-powered pipelines through a visual node-based interface. This module deploys n8n on **GKE Autopilot** alongside two companion AI services: **Qdrant** (vector database for RAG and document search) and **Ollama** (local LLM inference for privacy-first AI). Together they form an AI Starter Kit for building intelligent agents, chatbots, and document analysis workflows without external AI API dependencies.

`N8N_AI_GKE` is a **wrapper module** built on top of `App_GKE`. It uses `App_GKE` for all GCP infrastructure provisioning (GKE Autopilot cluster, networking, Cloud SQL Auth Proxy, GCS, secrets, CI/CD) and adds n8n-specific application configuration and AI component orchestration on top.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How This Guide Is Structured

This guide documents only the variables that are **unique to `N8N_AI_GKE`** or that have **n8n-specific defaults** that differ from the `App_GKE` base module. For all other variables — project identity, GKE backend configuration, CI/CD, GCS storage, backup, custom SQL, observability, networking, IAP, and Cloud Armor — refer directly to the [App_GKE Configuration Guide](../App_GKE/App_GKE_Guide.md).

**Variables fully covered by the App_GKE guide:**

| Configuration Area | App_GKE_Guide Section | N8N_AI-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | Group 0 | Different defaults for `module_description` and `module_documentation`. |
| Project & Identity | Group 1 | Refer to base App_GKE module documentation. |
| Application Identity | Group 2 | See [N8N AI Application Identity](#n8n-ai-application-identity) below for n8n-specific defaults. |
| Runtime & Scaling | Group 3 | See [N8N Runtime Configuration](#n8n-runtime-configuration) below. `cpu_limit` and `memory_limit` are top-level variables. |
| Environment Variables & Secrets | Group 4 | See [N8N Environment Variables](#n8n-environment-variables) below for SMTP defaults. |
| GKE Backend Configuration | Group 5 | Refer to base App_GKE module documentation (`service_type`, `workload_type`, `session_affinity`, `gke_cluster_name`, `namespace_name`, etc.). |
| Jobs & Scheduled Tasks | Group 6 | Refer to base App_GKE module documentation. |
| CI/CD & GitHub Integration | Group 7 | Refer to base App_GKE module documentation. |
| Storage — NFS | Group 8 | NFS is **enabled by default** (`enable_nfs = true`). See [Platform-Managed Behaviours](#platform-managed-behaviours). |
| Storage — GCS | Group 9 | Refer to base App_GKE module documentation. |
| Database Configuration | Group 10 | See [N8N Database Configuration](#n8n-database-configuration) below. `db_name` and `db_user` replace `application_database_name` and `application_database_user`. |
| Backup Schedule & Retention | Group 11 | Refer to base App_GKE module documentation. |
| Custom SQL Scripts | Group 12 | Refer to base App_GKE module documentation. |
| Observability & Health | Group 13 | Refer to base App_GKE module documentation for `startup_probe_config`, `health_check_config`, `uptime_check_config`, and `alert_policies`. |
| Reliability Policies | Group 14 | Refer to base App_GKE module documentation (`enable_pod_disruption_budget`, `enable_resource_quota`). |
| Resource Quota | Group 15 | Refer to base App_GKE module documentation. |
| Custom Domain, Static IP & Network | Group 16 | Refer to base App_GKE module documentation. |
| Identity-Aware Proxy | Group 17 | Refer to base App_GKE module documentation. Note: GKE IAP requires `iap_oauth_client_id` and `iap_oauth_client_secret`. |
| Cloud Armor | Group 18 | Refer to base App_GKE module documentation. |

---

## Platform-Managed Behaviours

The following behaviours are applied automatically by `N8N_AI_GKE` regardless of the variable values in your `tfvars` file. They cannot be overridden by user configuration.

| Behaviour | Detail |
|---|---|
| **Encryption key auto-generated** | A 32-character random encryption key is generated and stored in Secret Manager as `N8N_ENCRYPTION_KEY`, then synced to a Kubernetes Secret. This key encrypts all n8n credentials (API keys, OAuth tokens, workflow passwords). **Back up this secret before destroying the module** — credentials encrypted with one key cannot be decrypted with a different key. |
| **SMTP password auto-generated** | A placeholder SMTP password is generated and stored in Secret Manager as `N8N_SMTP_PASS`. Replace the secret value with your real SMTP credentials before enabling email sending. |
| **n8n port fixed at 5678** | `N8N_PORT=5678` is injected automatically via the application configuration. |
| **Database type set to PostgreSQL** | `DB_TYPE=postgresdb` is injected automatically. n8n requires PostgreSQL — do not change `database_type` to MySQL or SQL Server. |
| **Database connection variables injected** | `DB_POSTGRESDB_HOST`, `DB_POSTGRESDB_PORT`, `DB_POSTGRESDB_DATABASE`, `DB_POSTGRESDB_USER`, and `DB_POSTGRESDB_PASSWORD` are injected automatically from the Cloud SQL instance provisioned by App_GKE. The n8n Pod connects via the Cloud SQL Auth Proxy sidecar running at `127.0.0.1`. |
| **Webhook and editor URLs auto-set** | `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` are set to the predicted service URL. When `enable_custom_domain = true` and `application_domains` is non-empty, the first domain is used. Otherwise the internal ClusterIP service URL (`http://<service>.<namespace>.svc.cluster.local`) is used. |
| **Qdrant URL auto-injected** | When `enable_qdrant = true`, `QDRANT_URL` is set to the internal ClusterIP service URL of the Qdrant Kubernetes Deployment. Qdrant is accessible only within the cluster namespace via the ClusterIP service. |
| **Ollama host auto-injected** | When `enable_ollama = true`, `OLLAMA_HOST` is set to the internal ClusterIP service URL of the Ollama Kubernetes Deployment. Ollama is accessible only within the cluster namespace. |
| **Qdrant and Ollama deployed as Kubernetes Deployments** | Qdrant and Ollama run as separate Kubernetes Deployments in the same namespace as n8n, each with a ClusterIP service. They are not exposed outside the cluster. |
| **Workload Identity for IAM** | The n8n Pod uses Workload Identity to authenticate to GCP services (Cloud SQL, GCS, Secret Manager) without needing to embed service account keys in the container. |
| **GCS persistence for AI data** | Qdrant stores its vector index in a GCS Fuse volume and Ollama stores model weights in a GCS Fuse volume on the shared `-n8n-data` bucket. This persists data across Pod restarts and rescheduling. |
| **Database initialisation job** | A Kubernetes Job (`db-init`) is created automatically to provision the `n8n_db` database and `n8n_user` PostgreSQL user before the n8n Deployment starts. |

---

## N8N AI Application Identity

These variables control how the n8n deployment is named and described. They correspond to Group 2 variables in App_GKE but carry n8n-specific defaults.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_name` | `"n8nai"` | `[a-z][a-z0-9-]{0,19}` | Internal identifier used as the base name for GKE workloads, Cloud SQL, GCS buckets, Kubernetes namespace, and Artifact Registry. **Do not change after initial deployment** — it is embedded in resource names and changing it will cause resources to be recreated. |
| `application_display_name` | `"N8N AI Starter Kit"` | Any string | Human-readable name shown in the platform UI and GKE monitoring dashboards. Equivalent to `application_display_name` in App_GKE. Can be updated freely without affecting resource names. |
| `description` | `"N8N AI Starter Kit - Workflow automation with Qdrant and Ollama"` | Any string | Brief description of the deployment. Populated into Kubernetes resource annotations and platform documentation. |
| `application_version` | `"2.4.7"` | n8n version string, e.g. `"2.4.7"`, `"latest"` | Version tag applied to the container image and used for deployment tracking. Increment this value to trigger a new image build and revision. See [n8n releases](https://github.com/n8nio/n8n/releases) for available versions. |

### Validating Application Identity

```bash
# Confirm the Deployment exists with the expected name
kubectl get deployments -n NAMESPACE -o wide

# View annotations (description is stored here)
kubectl describe deployment n8nai -n NAMESPACE | grep -A5 Annotations
```

---

## N8N Runtime Configuration

n8n exposes `cpu_limit` and `memory_limit` as **dedicated top-level variables** rather than requiring users to set the full `container_resources` object.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `cpu_limit` | `"2000m"` | Kubernetes CPU quantity (e.g. `"1000m"`, `"2000m"`, `"4"`) | CPU limit for the n8n container in GKE Autopilot. **2 vCPU is recommended for active AI workflows.** n8n executes workflow nodes concurrently and AI node operations are CPU-bound. In GKE Autopilot, the CPU limit also determines Pod scheduling and billing. |
| `memory_limit` | `"4Gi"` | Kubernetes memory quantity (e.g. `"2Gi"`, `"4Gi"`, `"8Gi"`) | Memory limit for the n8n container. **4 Gi is recommended for AI workflows.** n8n caches workflow state and credential data in memory; AI nodes processing large document sets can require 2–3 Gi alone. Setting below `2Gi` risks OOMKilled Pod restarts during complex workflows. |
| `min_instance_count` | `0` | Integer ≥ 0 | Minimum number of n8n Pod replicas. Set to `0` to scale to zero when idle (lowest cost, but webhooks will miss events while scaled down). Set to `1` to ensure continuous webhook availability. |
| `max_instance_count` | `3` | Integer ≥ 1 | Maximum number of n8n Pod replicas allowed by the HPA. The default of `3` permits horizontal scaling. Increase only after enabling Redis queue mode (`enable_redis = true`) — without Redis, multiple replicas will conflict on workflow state. |
| `timeout_seconds` | `300` | Integer, 0–3600 | Maximum request duration before the ingress layer times out. Increase for long-running workflow executions or Ollama inference requests. |

> **Note on `container_resources`:** The full `container_resources` object (as documented in [App_GKE_Guide Group 3](../App_GKE/App_GKE_Guide.md#group-3-runtime--scaling)) is also available. If `container_resources` is set explicitly in your `tfvars`, it takes precedence over the top-level `cpu_limit` and `memory_limit` variables. Use `container_resources` when you also need to set `cpu_request` or `mem_request`.

**N8N-specific runtime defaults that differ from App_GKE:**

| Variable | App_GKE Default | N8N_AI_GKE Default | Reason |
|---|---|---|---|
| `cpu_limit` | `"1000m"` | `"2000m"` | AI workflows are CPU-intensive. |
| `memory_limit` | `"512Mi"` | `"4Gi"` | n8n with AI nodes requires substantial memory. |
| `max_instance_count` | `3` | `3` | Same default; Redis queue mode must be enabled before scaling beyond 1. |
| `enable_nfs` | `false` | `true` | NFS provides shared persistence for workflow data and credentials. |
| `enable_cloudsql_volume` | `true` | `true` | n8n connects to Cloud SQL via the Auth Proxy sidecar. |

### Validating Runtime Configuration

```bash
# View resource requests and limits on the running n8n Pod
kubectl describe pod -n NAMESPACE -l app=n8nai | grep -A10 "Limits:"

# Check the HPA (if min/max_instance_count > 1)
kubectl get hpa -n NAMESPACE
```

---

## AI Components Configuration

These variables are **unique to `N8N_AI_GKE`** — they do not exist in `App_GKE`. They control the Qdrant vector database and Ollama LLM server that are deployed as companion Kubernetes Deployments in the same namespace as n8n.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_ai_components` | `true` | `true` / `false` | Master toggle for the entire AI stack. Set to `false` to deploy n8n as a standard workflow automation tool without Qdrant or Ollama. When `false`, the `QDRANT_URL` and `OLLAMA_HOST` environment variables are not injected and the companion Deployments are not created. |
| `enable_qdrant` | `true` | `true` / `false` | Deploys Qdrant vector database as a Kubernetes Deployment and ClusterIP service for n8n AI workflows. Qdrant enables RAG pipelines, document embedding search, and AI memory. Only used when `enable_ai_components = true`. When `false`, the `QDRANT_URL` variable is not injected. |
| `qdrant_version` | `"latest"` | Docker image tag, e.g. `"latest"`, `"v1.9.0"` | Image version of the `qdrant/qdrant` container. Use a pinned version in production for reproducible deployments. Only used when `enable_qdrant = true`. |
| `enable_ollama` | `true` | `true` / `false` | Deploys Ollama LLM server as a Kubernetes Deployment and ClusterIP service. Ollama runs open-source models (Llama 3, Mistral, Gemma) on your infrastructure — no external AI API keys required. Only used when `enable_ai_components = true`. |
| `ollama_version` | `"latest"` | Docker image tag, e.g. `"latest"`, `"0.3.0"` | Image version of the `ollama/ollama` container. Use a pinned version in production. Only used when `enable_ollama = true`. |
| `ollama_model` | `"llama3.2"` | Ollama model name, e.g. `"llama3.2"`, `"mistral"`, `"gemma2"` | The default language model served by Ollama. Available to n8n AI nodes for text generation, summarisation, and chat workflows. Larger models require more CPU and memory allocated to the Ollama Deployment. |

### AI Component Resource Allocation

The Qdrant and Ollama Kubernetes Deployments are configured with fixed resources managed by the platform. These are not user-configurable in this release:

| Service | CPU | Memory | Replicas | Storage |
|---|---|---|---|---|
| Qdrant | 1 vCPU | 1 Gi | Fixed: 1 | GCS Fuse via CSI driver |
| Ollama | 2 vCPU | 4 Gi | Fixed: 1 | GCS Fuse via CSI driver |

> **Note on GPU support:** Ollama currently runs on CPU only. When GKE Autopilot GPU node pools become generally available for this configuration, a future release will add GPU acceleration for faster LLM inference.

### Validating AI Components

```bash
# List all Deployments in the namespace (n8n, qdrant, and ollama should appear)
kubectl get deployments -n NAMESPACE

# Confirm QDRANT_URL and OLLAMA_HOST are injected into the n8n Pod
kubectl describe pod -n NAMESPACE -l app=n8nai | grep -E "QDRANT|OLLAMA"

# Confirm Qdrant and Ollama are accessible only via ClusterIP
kubectl get services -n NAMESPACE
```

---

## Redis Configuration

These variables are **unique to `N8N_AI_GKE`** — the base `App_GKE` module does not include a Redis configuration group. Redis is required for n8n **queue mode**, which enables reliable multi-replica workflow execution.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `true` | `true` / `false` | Enables Redis as the n8n queue mode backend by injecting `REDIS_HOST` and `REDIS_PORT` environment variables. When `true` and `redis_host` is empty, the module defaults to the NFS server IP discovered from `Services_GCP`. **Required when `max_instance_count > 1`** to avoid workflow state conflicts between replicas. |
| `redis_host` | `""` *(auto-discovered)* | Hostname or IP, e.g. `"10.0.0.5"`, `"redis.internal"` | Hostname or IP of the Redis server. Leave blank to use the NFS server IP auto-discovered from `Services_GCP`. Override with a dedicated Redis/Memorystore instance endpoint for production deployments requiring higher availability or AUTH. |
| `redis_port` | `"6379"` | Port string, e.g. `"6379"` | TCP port of the Redis server. Must match the port configured on the Redis instance. |
| `redis_auth` | `""` | Sensitive string | Authentication password for the Redis server. Leave empty for unauthenticated Redis. For Google Cloud Memorystore with AUTH enabled, set this to the instance auth string. Treated as sensitive — never stored in Terraform state in plaintext. |

### Validating Redis Configuration

```bash
# Confirm REDIS_HOST and REDIS_PORT are set in the n8n Pod
kubectl describe pod -n NAMESPACE -l app=n8nai | grep -E "REDIS"
```

---

## N8N Database Configuration

n8n requires PostgreSQL. This module exposes `db_name` and `db_user` as **short top-level variables** in place of the `application_database_name` and `application_database_user` variables documented in [App_GKE_Guide Group 10](../App_GKE/App_GKE_Guide.md#group-10-database-configuration).

All other database variables (`database_password_length`, `enable_mysql_plugins`, etc.) behave identically to the App_GKE equivalents — refer to [App_GKE_Guide Group 10](../App_GKE/App_GKE_Guide.md#group-10-database-configuration) for their documentation.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `db_name` | `"n8n_db"` | `[a-z][a-z0-9_]{0,62}` | Name of the PostgreSQL database created within the Cloud SQL instance. Injected automatically as `DB_POSTGRESDB_DATABASE`. **Do not change after initial deployment** — renaming the database requires a full backup-and-restore migration. |
| `db_user` | `"n8n_user"` | `[a-z][a-z0-9_]{0,31}` | PostgreSQL user created for n8n. Injected automatically as `DB_POSTGRESDB_USER`. The password is auto-generated, stored in Secret Manager, synced to a Kubernetes Secret, and injected as `DB_POSTGRESDB_PASSWORD`. |

### Validating Database Configuration

```bash
# Confirm the database and user were created
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID

gcloud sql users list --instance=INSTANCE_NAME --project=PROJECT_ID

# Confirm DB env vars are injected into the n8n Pod
kubectl describe pod -n NAMESPACE -l app=n8nai | grep -E "DB_POSTGRES"
```

---

## N8N Environment Variables

The `environment_variables` variable (documented in [App_GKE_Guide Group 4](../App_GKE/App_GKE_Guide.md#group-4-environment-variables--secrets)) has n8n-specific defaults that configure email delivery.

**Default `environment_variables` in N8N_AI_GKE:**

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

> **Do not set** `N8N_PORT`, `DB_TYPE`, `DB_POSTGRESDB_*`, `N8N_ENCRYPTION_KEY`, `WEBHOOK_URL`, `N8N_EDITOR_BASE_URL`, `QDRANT_URL`, or `OLLAMA_HOST` in `environment_variables` — these are injected automatically by the platform and will be overridden.

---

## Configuration Examples

### Basic Deployment

Deploys n8n with AI components on GKE using default settings. Suitable for evaluation and development.

```hcl
# config/basic.tfvars
resource_creator_identity = ""
project_id                = "my-project-123"
tenant_deployment_id      = "basic"
```

### Advanced Deployment

Production-grade deployment with scaled resources, Redis queue mode, CI/CD, GKE-specific reliability policies, and full observability.

```hcl
# config/advanced.tfvars
resource_creator_identity = ""
project_id                = "my-project-123"
tenant_deployment_id      = "prod"

application_name         = "n8nai"
application_display_name = "N8N AI Production"

# Scaling & Performance
cpu_limit          = "4000m"
memory_limit       = "8Gi"
min_instance_count = 1
max_instance_count = 5

# AI Components
enable_ai_components = true
enable_qdrant        = true
qdrant_version       = "v1.9.0"
enable_ollama        = true
ollama_version       = "0.3.0"
ollama_model         = "llama3.2"

# Redis (required for multi-replica scaling)
enable_redis = true

# Database
database_password_length = 32

# GKE Specific
enable_resource_quota           = true
enable_pod_disruption_budget    = true
enable_network_segmentation     = true
enable_vertical_pod_autoscaling = true

# CI/CD & Cloud Deploy
enable_cicd_trigger = true
enable_cloud_deploy = true
cloud_deploy_stages = [
  { name = "dev",     require_approval = false, auto_promote = false },
  { name = "staging", require_approval = false, auto_promote = false },
  { name = "prod",    require_approval = true,  auto_promote = false },
]

# Security
enable_iap                  = true
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
    name               = "high-cpu"
    metric_type        = "kubernetes.io/container/cpu/usage_time"
    comparison         = "COMPARISON_GT"
    threshold_value    = 2000
    duration_seconds   = 300
    aggregation_period = "60s"
  }
]
```

### Custom Image Deployment

Deploys n8n with a custom-built container image, explicit Redis, and custom SMTP configuration.

```hcl
# config/custom.tfvars
resource_creator_identity = ""
project_id                = "my-project-123"
tenant_deployment_id      = "custom"

application_name = "n8nai"

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

# AI Components
enable_ai_components = true
enable_qdrant        = true
enable_ollama        = true

# Redis
enable_redis = true
redis_host   = "10.0.0.5"   # Explicit Memorystore IP

# GKE Specific
enable_resource_quota        = true
enable_pod_disruption_budget = true

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
