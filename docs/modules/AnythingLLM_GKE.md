---
title: "AnythingLLM on GKE Autopilot"
description: "Configuration reference for deploying AnythingLLM on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# AnythingLLM on GKE Autopilot

AnythingLLM is a private AI workspace and Retrieval-Augmented Generation (RAG) platform
that lets teams chat with documents, connect to any LLM provider (OpenAI, Anthropic,
Ollama, and others), and build AI-powered knowledge assistants — without sending data to
third-party services. This module deploys AnythingLLM on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud and
Kubernetes infrastructure.

This guide focuses on the cloud services AnythingLLM uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are common
to every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

AnythingLLM runs as a Node.js AI workload. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pods, 2 vCPU / 4 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — AnythingLLM uses Prisma ORM and does not support MySQL |
| Object storage | Cloud Storage | Auto-provisioned `anythingllm-docs` document bucket; optional additional buckets |
| Persistent volumes | Kubernetes PVCs (StatefulSet) | Optional — per-pod 20 GiB PVC at `/app/server/storage` when `stateful_pvc_enabled = true` |
| Shared files | Filestore (NFS) | Enabled by default (`enable_nfs = true`) — `STORAGE_DIR` points at the NFS mount so the LanceDB vector index survives pod restarts/redeploys |
| Secrets | Secret Manager | Four app secrets auto-generated (`JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY`, `SIG_SALT`) plus database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |
| Cache | Redis | Disabled by default; optional for session or cache workloads |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** AnythingLLM's Prisma ORM requires PostgreSQL. Do not set
  `database_type` to a MySQL or SQL Server variant.
- **Four application secrets are auto-generated.** `JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY`,
  and `SIG_SALT` are created in Secret Manager on first deploy; you never set them in plain
  text.
- **`min_instance_count = 1` is recommended** to keep AnythingLLM warm and avoid cold
  starts on AI document chat and embedding operations.
- **Storage must be persistent.** All workspace documents, vector indices, and conversation
  data are written under `STORAGE_DIR`. AnythingLLM keeps its LanceDB vector index there,
  which lives on the pod's ephemeral disk without NFS — so the knowledge base is silently
  wiped on every pod restart/redeploy. `enable_nfs = true` by default points `STORAGE_DIR`
  at the NFS mount so vectors survive; `stateful_pvc_enabled = true` (off by default) is an
  alternative single-pod-only persistence path at `/app/server/storage`.
- **Redis is disabled by default.** It is not required for AnythingLLM's core
  functionality. Enable it only if your deployment requires a shared cache layer.
- **`stateful_pvc_enabled = true` auto-selects `StatefulSet`** and mounts a 20 GiB PVC at
  `/app/server/storage` with `fsGroup = 1000` to match the AnythingLLM container user.
- **The `GOOGLE_CLOUD_STORAGE_BUCKET_NAME` env var is set automatically** from the
  provisioned `anythingllm-docs` GCS bucket.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the AnythingLLM workload

AnythingLLM pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum and
maximum replica counts. AI embedding and inference operations require at least 2 vCPU and
4 GiB RAM.

- **Console:** Kubernetes Engine → Workloads → select the AnythingLLM workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

AnythingLLM stores all workspace metadata, user accounts, and conversation history in a
managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately through the **Cloud
SQL Auth Proxy** sidecar over a Unix socket, so no public IP is exposed. On first deploy
an initialization Job creates the application database and user.

The `DATABASE_URL` Prisma connection string is assembled by the AnythingLLM entrypoint
script from the `DB_*` environment variables injected by the foundation at container start
time.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Storage — document bucket

`AnythingLLM_Common` automatically provisions a dedicated **Cloud Storage** bucket
(`anythingllm-docs`) for document and vector storage. The workload service account is
granted access automatically and the bucket name is injected as
`GOOGLE_CLOUD_STORAGE_BUCKET_NAME`. Additional buckets can be declared in `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<docs-bucket>/          # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for GCS Fuse mounts and CMEK options.

### D. Persistent Volumes (StatefulSet PVCs)

For single-pod or data-persistent deployments, enabling `stateful_pvc_enabled = true`
creates a per-pod **Kubernetes PersistentVolumeClaim** mounted at `/app/server/storage`
(AnythingLLM's storage directory). The `fsGroup = 1000` security context ensures the
container user can write to the volume.

- **Console:** Kubernetes Engine → Storage → PersistentVolumeClaims.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"
  # Confirm the volume is mounted correctly:
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls /app/server/storage
  ```

### E. Filestore (NFS) — default persistent storage

`enable_nfs = true` by default. AnythingLLM's LanceDB vector index lives under
`STORAGE_DIR`, which defaults to the pod's ephemeral disk — without NFS the knowledge base
is silently wiped on every pod restart or redeploy (document metadata persists in
Postgres, but the vectors are gone). With NFS enabled, `STORAGE_DIR` is pointed at
`nfs_mount_path` so vectors survive, and multi-pod deployments share the same document and
vector view. `stateful_pvc_enabled = true` (off by default) is an alternative for
single-pod-only persistence at `/app/server/storage`.

- **Console:** Filestore → Instances.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

See [App_GKE](App_GKE.md) for NFS provisioning details.

### F. Secret Manager

Four AnythingLLM application secrets are auto-generated and stored in Secret Manager —
`JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY`, and `SIG_SALT` — plus the database password. None
of these appear in plain text anywhere in the deployment.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### G. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A custom
domain with a Google-managed certificate can be enabled, and a static IP can be reserved
so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### H. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. An uptime check targeting `/api/ping` is enabled by default.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. AnythingLLM Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) uses the
  `postgres:15-alpine` image to create the AnythingLLM database and user before the
  workload starts. It is idempotent and safe to re-run.
- **Prisma migrations on start.** The entrypoint script constructs the `DATABASE_URL`
  connection string from the platform-injected `DB_*` environment variables and runs
  Prisma migrations, so version upgrades apply schema changes automatically.
- **AI model loading.** AnythingLLM loads embedding models into memory on first boot. The
  startup probe uses a 60-second initial delay and 30 failure periods (×10 seconds = 5
  minutes total) to accommodate this.
- **Health path.** Both readiness and liveness probes target `/api/ping`, which returns
  HTTP 200 only when the application is fully initialised. This endpoint works equally well
  in GKE where probe traffic reaches the container directly without any redirect.
- **LLM provider configuration.** Use `environment_variables` for non-sensitive provider
  settings (`LLM_PROVIDER`, `EMBEDDING_ENGINE`, `VECTOR_DB`) and
  `secret_environment_variables` to map env var names to Secret Manager secrets for API
  keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.).
- **Embedding engine consistency.** Changing `EMBEDDING_ENGINE` after documents have been
  ingested makes existing vector indices incompatible. All documents must be re-ingested
  after any change to the embedding engine.
- **Fixed environment variables.** `SERVER_PORT=3001`, `STORAGE_DIR=/app/server/storage`,
  `UID=1000`, and `GID=1000` are set automatically by `AnythingLLM_Common`. Do not
  override them.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for AnythingLLM are listed; every other input is inherited from
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
| `application_name` | `anythingllm` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `AnythingLLM` | Friendly name shown in the Console. |
| `application_description` | `AnythingLLM Private AI Workspace on GKE` | Workload description annotation. |
| `application_version` | `latest` | Image version tag; pin to a release tag for production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_resources` | `{ cpu_limit="2000m", memory_limit="4Gi" }` | CPU/Memory limits. Minimum 2 vCPU / 4 GiB for AI workloads. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 to avoid cold starts. |
| `max_instance_count` | `1` | Maximum replicas (autoscaler ceiling). |
| `container_port` | `3001` | AnythingLLM's native HTTP port. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |
| `timeout_seconds` | `300` | Load balancer backend timeout. Increase for long document ingestion. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Non-secret settings, e.g. `LLM_PROVIDER`, `EMBEDDING_ENGINE`, `VECTOR_DB`. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name for API keys. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Session affinity mode. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true`. |
| `network_tags` | `['nfsserver']` | Node/pod tags for VPC firewall rules. |

### Group 7 — StatefulSet Configuration

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Set `true` to enable per-pod PVC and auto-select `StatefulSet`. |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC size. Minimum 20 GiB recommended for vector store data. |
| `stateful_pvc_mount_path` | `/app/server/storage` | Mount path — AnythingLLM's storage directory. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |
| `stateful_fs_group` | `1000` | Pod-level `fsGroup` GID; matches the AnythingLLM container user. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`8Gi`, `16Gi`)** — bare integers are read as bytes and block scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` / `startup_probe` | `/api/ping`, 60 s initial delay, 30 failures | Extended startup window for AI model loading. |
| `health_check_config` / `liveness_probe` | `/api/ping`, 30 s initial delay | Liveness probe against AnythingLLM's health endpoint. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs (e.g., maintenance tasks). |
| `additional_services` | `[]` | Sidecar or helper GKE services alongside AnythingLLM. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Filestore (NFS) is mounted by default — required so AnythingLLM's LanceDB vector index (under `STORAGE_DIR`) survives pod restarts/redeploys instead of living on ephemeral disk. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the additional data bucket. The `anythingllm-docs` bucket is always created. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Additional GCS buckets. |
| `gcs_volumes` | `[]` | GCS Fuse mounts via CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not required for AnythingLLM core functionality. Enable for optional cache workloads. |
| `redis_host` | `null` | Redis endpoint. **Required** when `enable_redis = true`. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed for AnythingLLM — do not change. |
| `application_database_name` | `anythingllmdb` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `anythingllmuser` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_postgres_extensions` | `false` | Enable PostgreSQL extension installation. |
| `postgres_extensions` | `[]` | Extensions to install (e.g., `['uuid-ossp', 'vector']`). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` | restore options | Restore from a backup on deploy. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of AnythingLLM. **Recommended for production.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | `default-waf-policy` | Policy name. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate
and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach AnythingLLM. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (includes the `anythingllm-docs` bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | GitHub repo details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | AnythingLLM requires PostgreSQL; any other engine breaks Prisma ORM and crashes startup. |
| `STORAGE_DIR` persistence | `stateful_pvc_enabled=true` or NFS | Critical | Without a persistent volume, all workspace documents, vector indices, and conversation data are lost on pod eviction. |
| `secret_environment_variables` (API keys) | Use Secret Manager refs | Critical | Provider API keys as plain `environment_variables` are visible in Kubernetes pod specs. Use `secret_environment_variables` for all secrets. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_file` fails the import job. |
| `quota_memory_requests` / `_limits` | binary units (`8Gi`) | Critical | Bare integers are bytes and block all scheduling. |
| `enable_cloudsql_volume` | `true` | Critical | Disabling causes all database connections to fail at startup. |
| `container_resources.memory_limit` | `4Gi` | High | AnythingLLM's embedding pipeline requires 3–4 GiB RAM; OOM kills corrupt in-progress ingestion. |
| `min_instance_count` | `1` | High | Scale-to-zero causes 30–60 s cold starts; in-flight AI operations during scale-down are lost. |
| `timeout_seconds` | `300` (raise for heavy workloads) | High | Long document ingestion or slow LLM completions exceed the backend timeout, returning 504. |
| `EMBEDDING_ENGINE` | set once | High | Changing the embedding engine after ingestion makes existing vectors incompatible; all documents must be re-ingested. |
| `enable_iap` / `enable_cloud_armor` | enable for production | High | Without IAP, access is controlled only by the application login screen. |
| `enable_redis` | `false` (or set `redis_host`) | Medium | If `enable_redis = true` and `redis_host` is not resolvable, the container fails to start. |
| `enable_nfs` | `true` (default) | Medium | Enabled by default so the LanceDB vector index survives pod restarts; disabling it also strands multi-replica pods on isolated ephemeral storage, breaking cross-pod document access. |
| `application_version` | pin to a release tag | Medium | `latest` risks schema-breaking upgrades in production. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. AnythingLLM-specific
application configuration shared with the Cloud Run variant is described in
**[AnythingLLM_Common](AnythingLLM_Common.md)**.
