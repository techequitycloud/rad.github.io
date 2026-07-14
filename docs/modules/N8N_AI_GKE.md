---
title: "N8N AI on GKE Autopilot"
description: "Configuration reference for deploying N8N AI on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# N8N AI on GKE Autopilot

n8n is an open-source workflow automation platform with a visual node-based interface for
connecting services, running logic, and building AI-powered pipelines. This module deploys
n8n on **GKE Autopilot** alongside two companion AI services — **Qdrant** (vector database
for RAG and semantic search) and **Ollama** (local LLM inference for privacy-first AI) — on
top of the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services n8n AI uses and how to explore and operate them from
the Google Cloud Console and the command line. For the mechanics common to every GKE
application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

N8N AI runs as a Node.js workflow workload alongside Qdrant and Ollama Kubernetes Deployments.
The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | n8n + Qdrant + Ollama Deployments, 2 vCPU / 4 GiB by default for n8n |
| Database | Cloud SQL for PostgreSQL 15 | Required — n8n requires PostgreSQL; the engine is fixed |
| Object storage | Cloud Storage (GCS Fuse) | Shared AI data bucket mounted at `/mnt/gcs`; workflow data at `/home/node/.n8n` |
| Shared files | Filestore (NFS) | Shared NFS volume for cross-replica persistence; doubles as default Redis host |
| Cache & queue | Redis | Enabled by default; used for n8n queue mode across multiple replicas |
| Vector database | Qdrant (in-cluster) | Deployed as a companion Kubernetes Deployment; internal-only ClusterIP service |
| LLM inference | Ollama (in-cluster) | Deployed as a companion Kubernetes Deployment; internal-only ClusterIP service |
| Secrets | Secret Manager | Auto-generated `N8N_ENCRYPTION_KEY` and `N8N_SMTP_PASS`; synced to Kubernetes Secrets |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate via Gateway API |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the common configuration;
  changing `database_type` to MySQL breaks startup.
- **`N8N_ENCRYPTION_KEY` is auto-generated** and stored in Secret Manager. Back it up before
  destroying the module — credentials encrypted with one key cannot be decrypted with a
  different key.
- **Qdrant and Ollama run as internal-only Kubernetes Deployments** in the same namespace as
  n8n, each with a ClusterIP service. They are not exposed outside the cluster.
- **GCS Fuse persistence** keeps Qdrant's vector index (`/mnt/gcs/qdrant`) and Ollama's
  model weights (`/mnt/gcs/ollama/models`) durable across pod restarts.
- **Redis is enabled by default.** With more than one replica, a shared queue backend is
  required to prevent split-brain workflow execution.
- **`min_instance_count` defaults to `0`.** GKE HPA does not support true scale-to-zero the
  same way Cloud Run does; set to `1` for reliable webhook availability.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other identifiers
are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the n8n AI workload

n8n, Qdrant, and Ollama each run as a separate Kubernetes Deployment in the same namespace.
Horizontal Pod Autoscaling governs n8n replica count between the minimum and maximum limits.
Qdrant and Ollama are fixed at one replica each.

- **Console:** Kubernetes Engine → Workloads → select each workload to see pods, revisions,
  and events. Kubernetes Engine → Services & Ingress shows external IPs and ClusterIP
  endpoints.
- **CLI:**
  ```bash
  kubectl get deployments,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/n8nai --tail=100
  kubectl logs -n "$NAMESPACE" deploy/qdrant --tail=50
  kubectl logs -n "$NAMESPACE" deploy/ollama --tail=50
  kubectl describe hpa -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for Autopilot, scaling, and workload type details.

### B. Cloud SQL for PostgreSQL 15

n8n stores all workflow definitions, execution history, and credentials in a managed Cloud
SQL for PostgreSQL 15 instance. Pods reach it privately through the **Cloud SQL Auth Proxy**
sidecar over a Unix socket at `127.0.0.1`. On first deploy a `db-init` job creates the
application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=n8n_db --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the password
are all surfaced in the [Outputs](#5-outputs). For the connection model, automated backups,
and password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Storage (GCS Fuse) and Filestore (NFS)

A shared **Cloud Storage** bucket is mounted into every container via GCS Fuse:

- n8n workflow data and credentials at `/home/node/.n8n`
- Qdrant's vector index at `/mnt/gcs/qdrant`
- Ollama's model weights at `/mnt/gcs/ollama/models`

**Filestore (NFS)** is enabled by default and provides a shared persistent volume for
multi-replica data and doubles as the default Redis endpoint.

- **Console:** Cloud Storage → Buckets for the AI data bucket; Filestore → Instances for
  the NFS share.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<ai-data-bucket>/          # bucket name is in the Outputs
  gcloud filestore instances list --project "$PROJECT"
  kubectl exec -n "$NAMESPACE" deploy/n8nai -- df -h | grep -E "gcs|nfs"
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### D. Redis queue backend

Redis backs n8n's queue mode, enabling reliable multi-replica workflow execution. When no
`redis_host` is configured and NFS is enabled, the NFS server IP is used as the Redis
endpoint. For production with high availability, point to a Cloud Memorystore instance.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app=n8nai | grep -E "REDIS"
  redis-cli -h <redis-host> ping
  ```

### E. Qdrant — vector database

Qdrant provides high-performance vector similarity search for RAG pipelines, document
embeddings, and AI memory within n8n workflows. It is deployed as an internal-only
Kubernetes Deployment and is reachable from n8n via the `QDRANT_URL` environment variable,
which points to its ClusterIP service.

- **Console:** Kubernetes Engine → Workloads → select the `qdrant` Deployment.
- **CLI:**
  ```bash
  kubectl get deployment qdrant -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/qdrant --tail=50
  # Confirm QDRANT_URL is injected into n8n
  kubectl describe pod -n "$NAMESPACE" -l app=n8nai | grep QDRANT_URL
  # Check Qdrant's health endpoint from inside the cluster
  kubectl exec -n "$NAMESPACE" deploy/n8nai -- curl -s http://qdrant:6333/healthz
  ```

### F. Ollama — local LLM server

Ollama runs open-source language models (Llama 3, Mistral, Gemma) directly on your
infrastructure, enabling privacy-first AI inference without external API dependencies. It is
an internal-only Kubernetes Deployment; `OLLAMA_HOST` is injected into n8n to reach it.

- **Console:** Kubernetes Engine → Workloads → select the `ollama` Deployment.
- **CLI:**
  ```bash
  kubectl get deployment ollama -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/ollama --tail=50
  # Confirm OLLAMA_HOST is injected into n8n
  kubectl describe pod -n "$NAMESPACE" -l app=n8nai | grep OLLAMA_HOST
  # List models loaded in Ollama (from inside the cluster)
  kubectl exec -n "$NAMESPACE" deploy/n8nai -- curl -s http://ollama:11434/api/tags
  ```

### G. Secret Manager

The n8n encryption key and SMTP password are generated automatically and stored as Secret
Manager secrets, then synced to Kubernetes Secrets and injected into pods at runtime.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<encryption-key-secret> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### H. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. Custom
domain support via the Kubernetes Gateway API with a Google-managed certificate is enabled
by default (`enable_custom_domain = true`), and a static IP is reserved by default so the
address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get gateway,httproute,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP.

### I. Cloud Logging & Monitoring

Pod stdout/stderr flows to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. N8N AI Application Behaviour

- **First-deploy database setup.** A `db-init` Kubernetes Job runs before the n8n Deployment
  starts. It creates the `n8n_db` PostgreSQL database and `n8n_user` user via the Cloud SQL
  Auth Proxy socket, grants full privileges, and shuts down the proxy cleanly. The job is
  idempotent and safe to re-run.
- **Encryption key.** `N8N_ENCRYPTION_KEY` is auto-generated on first deploy and stored in
  Secret Manager. **Back up this secret before destroying the module.** All n8n credentials
  (API keys, OAuth tokens, workflow passwords) are encrypted with this key; they cannot be
  decrypted after a re-deploy with a different key.
- **Health probes.** The startup probe targets `GET /` on port 5678 with a 120-second initial
  delay, giving n8n time to connect to PostgreSQL and load workflow state. The liveness probe
  checks the same path after startup.
- **Webhook and editor URLs.** `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` are set to the
  predicted service URL before the Deployment is created so webhooks work without a
  post-deploy re-apply.
- **Queue mode.** When Redis is enabled, n8n operates in queue mode for reliable workflow
  execution across multiple replicas. Without Redis, only a single replica should run.
- **SMTP password.** `N8N_SMTP_PASS` is auto-generated as a placeholder. Replace the secret
  value in Secret Manager with real SMTP credentials before enabling email sending.
- **Inspect scheduled jobs and CronJobs:**
  ```bash
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  kubectl get cronjobs -n "$NAMESPACE"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for n8n AI are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `n8nai` | Base name for resources. **Do not change after first deploy.** |
| `application_display_name` | `N8N AI Starter Kit` | Friendly name shown in the Console. |
| `description` | _(set)_ | Workload description annotation. |
| `application_version` | `2.4.7` | n8n image version tag; increment to roll out a new version. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per n8n pod; also inherited by Ollama. 2 vCPU recommended. |
| `memory_limit` | `4Gi` | Memory per n8n pod; also inherited by Ollama. 4 GiB minimum for AI workloads. |
| `min_instance_count` | `0` | Minimum n8n replicas. Set to `1` for continuous webhook availability. |
| `max_instance_count` | `3` | Maximum replicas. Increase only with Redis enabled. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |
| `timeout_seconds` | `300` | Max request duration; increase for long AI inference workflows. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | SMTP placeholders | Non-sensitive settings. Core n8n vars are injected automatically; do not set `N8N_PORT`, `DB_TYPE`, `DB_POSTGRESDB_*`, `N8N_ENCRYPTION_KEY`, `WEBHOOK_URL`, `QDRANT_URL`, or `OLLAMA_HOST`. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use for external AI provider API keys. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `None` | n8n AI is stateless across instances with Redis. Change to `ClientIP` only if needed. |
| `workload_type` | `null` | Auto-resolves to StatefulSet when per-pod storage is enabled. |
| `network_tags` | `['nfsserver']` | Required for NFS connectivity firewall rules. |
| `gke_cluster_name` | `""` | Leave empty for auto-discovery. |
| `namespace_name` | `""` | Leave empty to auto-generate. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable PVC templates in the StatefulSet. Setting `true` auto-selects StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Storage size for each PVC. |
| `stateful_pvc_mount_path` | `/data` | Container path where the PVC is mounted. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are treated as bytes and block scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 if you need eviction headroom. |
| `enable_topology_spread` | `false` | Spread n8n, Qdrant, and Ollama pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` — 120s delay | n8n startup probe; generous delay allows DB connect + workflow load. |
| `liveness_probe` | HTTP `/` — 30s delay | n8n liveness probe. |
| `startup_probe_config` | TCP — enabled | App_GKE-standard startup probe. |
| `health_check_config` | HTTP `/` — enabled | App_GKE-standard liveness probe. |
| `uptime_check_config` | disabled | Enable for production monitoring. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Workload Automation

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Scheduled CronJobs for periodic tasks (exports, maintenance). |
| `additional_services` | `[]` | Extra sidecar or helper Deployments alongside n8n. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for workflow data and default Redis host discovery. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision GCS buckets. |
| `storage_buckets` | `[]` | Additional buckets beyond the auto-provisioned AI data bucket. |
| `gcs_volumes` | `[]` | Additional GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 15 — Redis Queue Backend

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Use Redis for n8n queue mode. **Required when `max_instance_count > 1`.** |
| `redis_host` | `""` | Leave empty to use the NFS server IP; set explicitly for a Memorystore instance. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `n8n_db` | PostgreSQL database name. **Immutable after first deploy.** |
| `db_user` | `n8n_user` | Application user. **Immutable after first deploy.** |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` | restore options | Restore from a backup on deploy. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Kubernetes Gateway API for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of n8n. **Note:** enabling IAP blocks public webhook endpoints. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 21 — Cloud Armor & CDN

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | _(set)_ | Policy name. |
| `enable_cdn` | `false` | Enable Cloud CDN on the backend. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

### Group — AI Components

| Variable | Default | Description |
|---|---|---|
| `enable_ai_components` | `true` | Master toggle. Set `false` to deploy n8n without Qdrant or Ollama. |
| `enable_qdrant` | `true` | Deploy Qdrant as an internal-only Kubernetes Deployment. |
| `qdrant_version` | `latest` | Qdrant Docker image tag. Pin to a specific version for production stability. |
| `enable_ollama` | `true` | Deploy Ollama as an internal-only Kubernetes Deployment. |
| `ollama_version` | `latest` | Ollama Docker image tag. Pin to a specific version for production stability. |
| `ollama_model` | `llama3.2` | Default model declaration. Note: this variable is not currently forwarded to the Ollama service — models must be pulled separately at the Ollama API level. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate and
explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name for the n8n workload. |
| `namespace` | Namespace all workloads (n8n, Qdrant, Ollama) run in. |
| `service_cluster_ip` | In-cluster ClusterIP for the n8n Service. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach the n8n UI. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name (`n8n_db`). |
| `database_user` | Application database user (`n8n_user`). |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (including the AI data bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Connected repo details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `N8N_ENCRYPTION_KEY` (auto-generated) | Back up immediately | Critical | Changing after first run permanently destroys all saved n8n credentials. |
| `application_name` | `n8nai` — set once | Critical | Immutable after first deploy; renaming recreates all GCP and Kubernetes resources with data loss. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming points n8n at a new empty database, losing all workflows. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all pod scheduling. |
| `enable_qdrant` | `true` | High | Active RAG workflows fail at runtime with connection errors if Qdrant is removed. |
| `enable_ollama` | `true` | High | Workflows using the local LLM node fail; only disable when using external AI providers exclusively. |
| `enable_redis` | `true` | High | Without Redis, multiple replicas conflict on workflow state; split-brain execution corrupts runs. |
| `redis_host` | `""` (NFS) or explicit | High | When Redis is on but both `redis_host` and NFS are unset, n8n fails to start. |
| `memory_limit` | `4Gi` | High | AI workflows (embedding, vector search, LLM chaining) cause OOM kills below 4 GiB. |
| `max_instance_count` | `1` unless Redis configured | High | Scaling above 1 without Redis causes split-brain; increasing with Redis is safe. |
| `min_instance_count` | `1` for webhooks | Medium | `0` may leave webhooks without a target pod; HPA state can be inconsistent on GKE. |
| `enable_nfs` | `true` | High | Qdrant and Ollama use GCS Fuse on the AI data bucket; without it model files and vector indexes are lost on pod restart. |
| `enable_iap` | only with valid OAuth creds | High | Enabling without `iap_oauth_client_id` / `iap_oauth_client_secret` blocks all access. IAP also blocks public webhooks. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity, autoscaling,
ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups,
and image mirroring — see **[App_GKE](App_GKE.md)**. n8n AI-specific application
configuration shared with the Cloud Run variant is described in
**[N8N_AI_Common](N8N_AI_Common.md)**.
