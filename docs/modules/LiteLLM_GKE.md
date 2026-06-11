---
title: "LiteLLM on GKE Autopilot"
---

# LiteLLM on GKE Autopilot

LiteLLM is an open-source LLM proxy and AI gateway that provides a unified
OpenAI-compatible API across 100+ providers including OpenAI, Anthropic, Google
Gemini, Azure OpenAI, AWS Bedrock, and Ollama. Organizations use it to
centralize AI spend tracking, manage virtual API keys, enforce rate limits, and
gain full visibility over model usage. This module deploys LiteLLM on **GKE
Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions
and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services LiteLLM uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

LiteLLM runs as a Python-based proxy workload. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Python proxy pods, 2 vCPU / 2 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — LiteLLM's Prisma ORM uses PostgreSQL for virtual keys and spend tracking |
| Object storage | Cloud Storage | Optional — no buckets created by default |
| Cache | Redis | Optional — reduces latency and cost for repeated identical LLM requests |
| Secrets | Secret Manager | Auto-generated master key and salt key; LLM provider API keys injected at runtime |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** LiteLLM's Prisma ORM requires PostgreSQL for
  virtual key management and spend tracking; changing the engine breaks startup.
- **A custom container image is built by Cloud Build.** The image embeds an
  `entrypoint.sh` that assembles `DATABASE_URL` from the `DB_*` environment
  variables injected by the foundation at runtime.
- **`LITELLM_MASTER_KEY` and `LITELLM_SALT_KEY` are auto-generated** and stored
  in Secret Manager. The salt key must never be rotated after virtual keys have
  been issued — all existing virtual keys would become permanently invalid.
- **`STORE_MODEL_IN_DB = "true"` is set automatically**, enabling runtime model
  management and the Admin UI without container restarts.
- **Redis is disabled by default.** Enable it for multi-replica deployments to
  share rate-limit counters and response caches across pods.
- **The startup probe targets `/health/readiness`**, which validates database
  connectivity and confirms Prisma migrations have completed before traffic is
  routed to the pod.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the LiteLLM workload

LiteLLM pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the
minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the LiteLLM workload to
  see pods, revisions, and events. Kubernetes Engine → Services & Ingress shows
  the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

LiteLLM stores all virtual keys, usage logs, cost records, and model routing
rules in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately
through the **Cloud SQL Auth Proxy** sidecar over a Unix socket, so no public IP
is exposed. On first deploy an initialization job creates the application
database and user.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=litellm_db --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding
the password are all surfaced in the [Outputs](#5-outputs). For the connection
model, automated backups, and password rotation, see
[App_GKE](App_GKE.md).

### C. Cloud Storage

No storage buckets are created by default. Buckets can be declared via the
`storage_buckets` variable and mounted via GCS Fuse when `gcs_volumes` is set —
for example, to deliver a `config.yaml` to the container without rebuilding the
image.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/
  ```

See [App_GKE](App_GKE.md) for GCS Fuse and CMEK options.

### D. Redis cache

Redis backs LiteLLM's optional response caching and shared rate-limit counters.
When `enable_redis = true`, the `REDIS_HOST`, `REDIS_PORT`, and (optionally)
`REDIS_PASSWORD` environment variables are injected into pods automatically.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

`LITELLM_MASTER_KEY` (the primary admin API key, prefixed `sk-`) and
`LITELLM_SALT_KEY` (used to hash virtual keys) are generated automatically and
stored in Secret Manager. LLM provider API keys (e.g. `OPENAI_API_KEY`) are
injected by referencing pre-existing secrets via `secret_environment_variables`.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the master key:
  gcloud secrets versions access latest --secret=<master-key-secret> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP.
A custom domain with a Google-managed certificate can be enabled, and a static IP
can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and
static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. LiteLLM Application Behaviour

- **First-deploy database setup.** An initialization job creates the LiteLLM
  database and user and grants privileges before the application starts. It
  connects to Cloud SQL through the Auth Proxy and is idempotent.
- **Prisma migrations on start.** LiteLLM runs its Prisma ORM migrations on
  each pod start, so upgrading the application version applies schema changes
  automatically. The startup probe waits until `/health/readiness` returns 200,
  confirming migrations are complete before routing traffic to the pod.
- **Admin UI.** The LiteLLM Admin UI is available at `/ui` on the service URL.
  Authenticate with the `LITELLM_MASTER_KEY` (retrieve it from Secret Manager).
  From the UI you can add models, create virtual keys, set budgets, and view
  usage dashboards — all without restarting the container.
- **Adding LLM provider keys.** Provider API keys are not managed by this
  module. Supply them at deploy time via `secret_environment_variables` (mapping
  each env var to a pre-existing Secret Manager secret), or add them after
  deployment via the Admin UI or the `/model/new` API endpoint using the master
  key.
- **Virtual key management.** Use the `/key/generate` API with the master key
  to issue per-team or per-user virtual keys with rate limits and spend budgets.
  These keys are stored in PostgreSQL and salted with `LITELLM_SALT_KEY`.

  ```bash
  # Retrieve the master key then create a virtual key:
  MASTER_KEY=$(gcloud secrets versions access latest --secret=<master-key-secret> --project "$PROJECT")
  curl -X POST "https://<service-url>/key/generate" \
    -H "Authorization: Bearer $MASTER_KEY" \
    -H "Content-Type: application/json" \
    -d '{"key_alias": "team-a", "max_budget": 10.0}'
  ```
- **Health endpoints.** `/health/readiness` validates database connectivity and
  Prisma migration completion; `/health/liveliness` confirms the proxy process
  is running. These are used as the startup and liveness probes respectively.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for LiteLLM are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

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
| `application_name` | `litellm` | Base name for resources. Do not change after first deploy. |
| `display_name` | `LiteLLM AI Gateway` | Friendly name shown in the Console. |
| `description` | _(set)_ | Workload description annotation. |
| `application_version` | `main-stable` | LiteLLM image version tag; pin to a specific release for production stability. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per pod; 2 vCPU recommended. |
| `memory_limit` | `2Gi` | Memory per pod; increase to `4Gi` for high-throughput deployments. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 to avoid cold starts on the API gateway. |
| `max_instance_count` | `3` | Maximum replicas (autoscaler ceiling). |
| `container_port` | `4000` | LiteLLM's native port. |
| `timeout_seconds` | `600` | Request timeout; increase for long-running LLM inference calls. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for Unix socket connections. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically (disables HPA). |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{ LITELLM_LOG="INFO", NUM_WORKERS="1" }` | Extra non-secret settings. Core LiteLLM vars are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use to inject LLM provider API keys. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing; useful when a client re-uses an open connection to the same pod. |
| `workload_type` | `null` | Auto-resolves to StatefulSet when per-pod storage is enabled. |
| `network_tags` | `["nfsserver"]` | Node/pod tags for firewall rules. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable PVC templates; automatically selects StatefulSet workload type. |
| `stateful_pvc_size` | `10Gi` | Storage size for each PVC. |
| `stateful_pvc_mount_path` | `/data` | Container path where the PVC is mounted. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 if you need eviction headroom. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `/health/readiness` | HTTP probe; validates DB connectivity and Prisma migrations before routing traffic. |
| `liveness_probe` | `/health/liveliness` | HTTP probe; confirms the proxy process is running. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in database setup job from LiteLLM_Common. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs for maintenance or housekeeping tasks. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is not required for LiteLLM; enable only for shared config file delivery. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision buckets declared in `storage_buckets`. |
| `storage_buckets` | `[]` | No buckets created by default. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts for config file delivery. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Fixed — do not change; LiteLLM requires PostgreSQL 15. |
| `db_name` | `litellm_db` | Database name. Immutable after first deploy. |
| `db_user` | `litellm_user` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production. |
| `enable_backup_import` / `backup_source` / `backup_uri` | restore options | Restore from a backup on deploy. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `false` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of LiteLLM. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis for response caching and shared rate-limit counters. |
| `redis_host` | `""` | Redis endpoint; required when `enable_redis = true`. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | _(set)_ | Policy name. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach LiteLLM. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Connected repository. |
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
| `database_type` | `POSTGRES` / `POSTGRES_15` | Critical | LiteLLM requires PostgreSQL; changing the engine breaks the Prisma ORM and prevents startup. |
| `enable_cloudsql_volume` | `true` | Critical | The Auth Proxy sidecar is required for database connectivity; disabling it causes Prisma to fail at startup. |
| `LITELLM_SALT_KEY` | auto-generated, never rotated | Critical | Rotating the salt key invalidates every previously issued virtual key; all API consumers lose access immediately. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all virtual keys and spend data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all scheduling. |
| `ingress_settings` / `service_type` | restrict for production | Critical | A public LoadBalancer exposes the master key endpoint; use `ClusterIP` with an authenticated Gateway for internal deployments. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | provide when IAP enabled | Critical | Missing values prevent the IAP gateway from initialising and make the service unreachable. |
| `LITELLM_MASTER_KEY` | auto-generated | High | Treat as a credential; rotating it breaks all existing integrations holding the key until they are updated. |
| `enable_redis` | `true` for multi-replica | High | Without Redis, rate-limit counters are per-pod and not shared; quotas are not enforced across replicas. |
| `redis_host` | set when Redis enabled | High | An empty host with `enable_redis = true` causes connection errors on every request. |
| `min_instance_count` | `1` | High | Cold starts add 30–60 s latency and queue all dependent services. |
| `timeout_seconds` | `600` | High | Large language model inference can take minutes; too-short timeout causes 504 errors on slow models. |
| `application_version` | pin for production | Medium | LiteLLM releases frequently; unpinned versions may change the Prisma schema or break virtual key formats. |
| `enable_vertical_pod_autoscaling` | `false` unless using VPA | Medium | Enabling VPA disables HPA; choose one or the other. |
| `NUM_WORKERS` | `1` (raise for throughput) | Medium | A single worker serialises all requests; increase to 2–4 and scale `cpu_limit` proportionally for high-traffic gateways. |
| `backup_schedule` | `0 2 * * *` | High | Without backups, accidental deletion destroys all virtual keys and usage history with no recovery path. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. LiteLLM-specific application configuration shared with the
Cloud Run variant is described in **[LiteLLM_Common](LiteLLM_Common.md)**.
