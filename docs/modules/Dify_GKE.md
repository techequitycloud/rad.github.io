---
title: "Dify on GKE Autopilot"
description: "Configuration reference for deploying Dify on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Dify on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Dify_GKE.png" alt="Dify on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Dify is an open-source LLM application development platform for building production-grade AI
applications with a visual workflow builder, RAG pipeline, agent framework, multi-model
management, and built-in observability. This module deploys Dify on **GKE Autopilot** on top of
the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud and
Kubernetes infrastructure.

This guide focuses on the cloud services Dify uses and how to explore and operate them from the
Google Cloud Console and the command line. For the mechanics that are common to every GKE
application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Dify runs as a Python/Flask API container (with an embedded Celery worker under supervisord) plus
a separate Next.js web frontend. The deployment wires together a focused set of Google Cloud
services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | API+worker pod (2 vCPU / 4 GiB by default) + web frontend pod, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — pgvector extension enabled for vector storage |
| Vector store | pgvector (in-database) | Reuses the Cloud SQL instance; no separate vector database needed |
| Shared files | Filestore (NFS) | Shared Redis host co-location; NFS VM also used for task state |
| Object storage | Cloud Storage | A dedicated `dify-storage` bucket for uploaded files and assets |
| Cache & task queue | Redis | Required for Celery broker/backend and SSE/WebSocket LLM streaming |
| Secrets | Secret Manager | Auto-generated SECRET_KEY and database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** MySQL and `NONE` are not supported; Dify requires PostgreSQL
  for all metadata, workflow state, and user accounts.
- **pgvector is always enabled.** The `vector` extension is installed on the Cloud SQL instance
  automatically, making the same database instance the vector store — no extra service required.
- **Redis is required.** Celery (workflow execution, document indexing, async LLM calls) and the
  SSE/WebSocket event bus both depend on Redis. Disabling it breaks all background processing.
- **NFS is enabled by default.** The NFS server VM hosts the Redis process when no external Redis
  host is set.
- **A web frontend is deployed automatically.** A `langgenius/dify-web` Deployment is wired to
  the API service URL — you do not need to configure it separately.
- **SECRET_KEY is auto-generated** and stored in Secret Manager; it signs Dify sessions and must
  never be changed after first deployment.
- **Database migrations run on every pod start** (via `MIGRATION_ENABLED=true`), so version
  upgrades apply schema changes automatically.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Dify workload

Dify runs two Autopilot Deployments: the API+worker pod (Flask/gunicorn + Celery via supervisord)
and the web frontend (Next.js). Horizontal Pod Autoscaling sizes each Deployment between the
minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Dify API or web workload to see
  pods, events, and resource usage. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Dify stores all application data (workflows, knowledge bases, user accounts, API keys) in a
managed Cloud SQL for PostgreSQL 15 instance. Pods connect privately through the **Cloud SQL
Auth Proxy** sidecar over a Unix socket — no public IP is exposed. On first deploy an
initialization Job creates the application database and user. The `pgvector` extension is
installed automatically so the same instance serves as the vector store.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the password are
all surfaced in the [Outputs](#5-outputs). For the connection model, automated backups, and
password rotation, see [App_GKE](App_GKE.md).

### C. Filestore (NFS) and Cloud Storage

A **Filestore (NFS)** share is mounted into every pod. The NFS server VM also runs the Redis
process used as the Celery broker when no external Redis host is configured. A dedicated **Cloud
Storage** bucket (`dify-storage`) is provisioned for uploaded files and assets; Dify's
`google-storage` driver accesses it via Workload Identity — no service account key file is
needed.

- **Console:** Filestore → Instances for the NFS share; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<dify-storage-bucket>/
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### D. Redis — Celery and event bus

Redis is required for three functions in Dify:

| Role | Redis DB | Purpose |
|---|---|---|
| Celery broker & backend | db 1 | Queues and tracks all background tasks (LLM inference, document indexing) |
| Event bus | db 0 | SSE/WebSocket streaming for real-time LLM output |
| General cache | db 0 | Application caching |

When no external Redis host is configured, the NFS server VM IP is used as the Redis endpoint.
For production, point `redis_host` at a dedicated Memorystore for Redis instance.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The Dify `SECRET_KEY` (used for JWT signing and session encryption) and the database password
are stored as Secret Manager secrets and injected into pods at runtime; plaintext never appears
in pod specs. The `SECRET_KEY` is generated once and must not be rotated while the deployment
is running — all pods must share the same value.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the Dify service is exposed through an external Cloud Load Balancing IP. A custom
domain with a Google-managed certificate can be enabled, and a static IP can be reserved so the
address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Dify Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) connects to Cloud SQL via
  the Auth Proxy and idempotently creates the Dify database user and database. It runs
  automatically and is safe to re-run.
- **Migrations on start.** Each pod runs Dify's Flask-Migrate database migrations on startup
  (`MIGRATION_ENABLED=true`), so upgrading the application version applies schema changes
  automatically. No separate migration job is needed.
- **API + worker in one pod.** The custom container wraps `langgenius/dify-api` with supervisord.
  Both the gunicorn API server and the Celery worker run inside the same pod — they share CPU and
  memory allocation. Size accordingly: 2 vCPU and 4 GiB is the recommended minimum.
- **Web frontend.** A `langgenius/dify-web` Deployment is deployed automatically and wired to
  the API service URL. Access Dify through the web service external IP or the `web_url` output.
- **LLM provider API keys.** Provider keys (OpenAI, Anthropic, etc.) are configured per-workspace
  via the Dify web console and stored in the application database. Use
  `secret_environment_variables` only for environment-level configuration that cannot be set in
  the UI.
- **CORS.** `WEB_API_CORS_ALLOW_ORIGINS` and `CONSOLE_CORS_ALLOW_ORIGINS` default to `"*"`.
  Restrict to your domain via `environment_variables` in production.
- **Health path.** Readiness and liveness probes target `/health` with a 30-second initial delay
  to allow the API server and database migrations to complete on first boot.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific
to or notable for Dify are listed; every other input is inherited from [App_GKE](App_GKE.md)
with its standard behaviour and defaults.

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
| `resource_labels` | `{}` | Labels applied to all resources for cost and ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `dify` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Dify - LLM Application Platform` | Friendly name shown in the Console. |
| `description` | _(set)_ | Workload description annotation. |
| `application_version` | `0.15.0` | Dify image version tag; applies to both API and web containers. Pin to a specific version in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per pod; 2 vCPU minimum — gunicorn and Celery share this allocation. |
| `memory_limit` | `4Gi` | Memory per pod; 4 GiB recommended for LLM workflow caching and document processing. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 so the Celery worker maintains its Redis broker connection. |
| `max_instance_count` | `3` | Maximum replicas (autoscaler ceiling). |
| `container_port` | `5001` | Dify API server listens on port 5001. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for Unix socket connections. Required for database connectivity. |
| `enable_vertical_pod_autoscaling` | `false` | VPA tunes resource requests automatically; enabling it disables HPA. |
| `enable_pod_disruption_budget` | `false` | Creates a PodDisruptionBudget for minimum availability during node maintenance. |
| `pdb_min_available` | `1` | Minimum pods available during disruptions. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Use to override `WEB_API_CORS_ALLOW_ORIGINS`, `LOG_LEVEL`, etc. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use for LLM provider API keys. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing — recommended for Dify's session state. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when per-pod storage is enabled. |
| `network_tags` | `['nfsserver']` | Node/pod tags; `nfsserver` is required for NFS connectivity. |
| `gke_cluster_name` | `""` | GKE cluster name. Leave empty to auto-discover. |
| `namespace_name` | `""` | Kubernetes namespace. Auto-generated when empty. |
| `termination_grace_period_seconds` | `60` | Seconds Kubernetes waits after SIGTERM before force-killing. |

### Group 7 — StatefulSet Configuration

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable per-pod PVCs. Setting `true` auto-selects `StatefulSet` workload type. |
| `stateful_pvc_size` | `10Gi` | Storage size for each PVC. |
| `stateful_pvc_mount_path` | `/data` | Container path where the per-pod PVC is mounted. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVC provisioning. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` / `startup_probe` | HTTP `/health`, 30 s delay | Startup probe — container receives no traffic until `/health` returns 200. |
| `health_check_config` / `liveness_probe` | HTTP `/health` | Liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. Provide a non-empty list to replace it entirely. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs. |
| `additional_services` | `[]` | Additional Kubernetes Deployments alongside Dify (web frontend is wired automatically). |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume; also provides the default Redis host when no external Redis is set. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `nfs_instance_name` | `""` | Name of an existing NFS GCE VM. Leave empty to auto-discover. |
| `nfs_instance_base_name` | `app-nfs` | Base name for an inline NFS GCE VM when none exists. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision additional GCS buckets. The `dify-storage` bucket is always provisioned by Dify_Common. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional buckets beyond the auto-provisioned storage bucket. |
| `gcs_volumes` | `[]` | GCS Fuse mounts via the CSI driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `dify_db` | PostgreSQL database name. **Immutable after first deploy.** |
| `db_user` | `dify_user` | Application user. **Immutable after first deploy.** |
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
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Dify. Requires `enable_custom_domain = true`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Required.** Enables Redis for Celery task queue and SSE/WebSocket streaming. |
| `redis_host` | `""` | Leave empty to use the NFS server IP; set explicitly for an external Memorystore instance. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

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
| `service_name` | Kubernetes Service name (Dify API). |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP of the API service. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `web_url` | URL of the Dify web frontend (use this to open the browser UI). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD repository details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster and workload are ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_redis` | `true` (required) | Critical | All Celery tasks (workflow execution, document indexing, async LLM calls) fail silently without Redis. |
| `enable_cloudsql_volume` | `true` (required) | Critical | The Auth Proxy sidecar is the only path to PostgreSQL; disabling it breaks all database connectivity. |
| `SECRET_KEY` (auto-generated) | immutable once set | Critical | All pods must share the same key; rotating it logs out all users and invalidates active sessions. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the database and destroys data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `enable_redis` + `enable_nfs` | both `true` if no external Redis | Critical | Without NFS, there is no Redis host when `redis_host` is empty — Celery fails to start. |
| `secret_environment_variables` for LLM keys | always use secret refs | Critical | Plain env vars expose API keys in pod specs visible via `kubectl describe pod`. |
| `enable_redis` + `redis_host` | correct host | High | Incorrect `redis_host` produces a malformed Celery broker URL; all async tasks queue indefinitely. |
| `memory_limit` | `4Gi` | High | Too little memory causes OOM kills during document ingestion or LLM workflow caching. |
| `min_instance_count` | `1` | High | Scale-to-zero causes cold starts and abandons in-flight Celery tasks. |
| `timeout_seconds` | `300` (raise for workflows) | High | Multi-step workflows and RAG indexing can exceed 300 s; increase to `3600` for complex deployments. |
| `WEB_API_CORS_ALLOW_ORIGINS` | restrict in production | High | Default `"*"` allows cross-origin requests from any domain. |
| `application_version` | pin to a specific version | Medium | Unpinned versions risk unexpected schema migrations that break the application on redeploy. |
| `enable_iap` / `enable_cloud_armor` | enable for production | Medium | The Dify console is publicly reachable without these controls. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity, autoscaling,
ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and
image mirroring — see **[App_GKE](App_GKE.md)**. Dify-specific application configuration shared
with the Cloud Run variant is described in **[Dify_Common](Dify_Common.md)**.
