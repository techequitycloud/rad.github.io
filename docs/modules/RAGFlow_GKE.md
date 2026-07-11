---
title: "RAGFlow on GKE Autopilot"
description: "Configuration reference for deploying RAGFlow on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# RAGFlow on GKE Autopilot

RAGFlow is an open-source document intelligence and Retrieval-Augmented Generation (RAG)
platform. It ingests PDFs, Word documents, HTML pages, and other formats, chunks and embeds
them, stores vectors in Elasticsearch, exposes a REST API for question-answering, and provides
a web UI for knowledge base management and enterprise search. This module deploys RAGFlow on
**GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and
manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services RAGFlow uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

> **Deployment prerequisite:** `RAGFlow_GKE` requires `Elasticsearch_GKE` to be deployed
> first. The `elasticsearch_hosts` variable is **mandatory** — the plan is rejected if it
> is empty when `deploy_application = true`.

---

## 1. Overview

RAGFlow runs as a containerised Python/Nginx web workload. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Custom-built RAGFlow pods, 4 vCPU / 8 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for MySQL 8.0 | Required — RAGFlow does not support PostgreSQL |
| Vector search | Elasticsearch (Elasticsearch_GKE) | External dependency — must be deployed first; `elasticsearch_hosts` is mandatory |
| Task queue | Redis (Memorystore) | Required for document processing workers |
| Shared files | Filestore (NFS) | Enabled by default for shared document processing storage |
| Object storage | Cloud Storage | A dedicated `ragflow-documents` bucket |
| Secrets | Secret Manager | Auto-generated database password |
| Ingress | Cloud Load Balancing | External LoadBalancer service; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed; selecting PostgreSQL or
  `NONE` breaks startup.
- **`elasticsearch_hosts` is required.** RAGFlow cannot index or search documents without
  a reachable Elasticsearch endpoint. Deploy `Elasticsearch_GKE` first.
- **Redis is required for document processing.** With `enable_redis = true` (the default),
  `REDIS_HOST` and `REDIS_PORT` are injected automatically. Without Redis, uploaded files
  remain unprocessed indefinitely.
- **Scale-to-zero is disabled.** `min_instance_count` is hard-capped at 1. RAGFlow loads
  embedding models at startup (2–3 minutes); scale-to-zero would cause requests to time out.
- **A custom image is always built.** Cloud Build extends `infiniflow/ragflow` using the
  Dockerfile in `RAGFlow_Common/scripts/`, with `APP_VERSION` set from `application_version`.
- **`service_conf.yaml` is generated at startup.** The custom entrypoint writes
  `/ragflow/conf/service_conf.yaml` from injected environment variables before starting
  the RAGFlow processes.
- **Session affinity is `ClientIP`.** This ensures upload sessions and multi-step document
  processing requests consistently reach the same pod.
- **The database password** is generated automatically and stored in Secret Manager.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the RAGFlow workload

RAGFlow pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the
minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the RAGFlow workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Cloud SQL for MySQL 8.0

RAGFlow stores all application metadata (user accounts, knowledge bases, task state)
in a managed Cloud SQL for MySQL 8.0 instance. Pods reach it privately through the
**Cloud SQL Auth Proxy** sidecar over a Unix socket, so no public IP is exposed. On
first deploy an initialization Job creates the application database and user.

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
automated backups, and password rotation, see
[App_GKE](App_GKE.md).

### C. Elasticsearch — vector search

RAGFlow requires an external Elasticsearch instance for document indexing and vector
search. It is not bundled in this module — deploy `Elasticsearch_GKE` separately and
pass its `elasticsearch_endpoint` output as `elasticsearch_hosts`. The environment
variables `ELASTICSEARCH_HOSTS` and `ELASTICSEARCH_USERNAME` are injected
automatically.

- **Console:** Kubernetes Engine → Workloads → Elasticsearch namespace.
- **CLI:**
  ```bash
  # Confirm RAGFlow can reach Elasticsearch:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    curl -s "$ELASTICSEARCH_HOSTS/_cluster/health" | grep status
  # Check connectivity from within the cluster:
  kubectl run -it --rm curl --image=curlimages/curl --restart=Never -- \
    curl -s "http://<elasticsearch-ip>:9200/_cluster/health"
  ```

### D. Redis — task queue

Redis is the backbone of RAGFlow's document processing pipeline. Workers poll Redis
for tasks; without it, uploaded files are never parsed, chunked, or embedded.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### E. Filestore (NFS) and Cloud Storage

By default, RAGFlow mounts a **Filestore (NFS)** share into every pod for shared
document processing storage. A dedicated **Cloud Storage** bucket (`ragflow-documents`)
is also provisioned for document ingestion; the workload service account is granted
access automatically. Additional GCS Fuse volumes can be mounted via `gcs_volumes`.

- **Console:** Filestore → Instances; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<documents-bucket>/     # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### F. Secret Manager

The database password is stored as a Secret Manager secret and injected into pods at
runtime; plaintext never appears in configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### G. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A
custom domain with a Google-managed certificate can be enabled, and a static IP can
be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and
static IP details.

### H. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. RAGFlow Application Behaviour

- **First-deploy database setup.** An initialization Job (`mysql:8.0-debian`) creates the
  RAGFlow database (`rag_flow`) and user (`ragflow`) and grants privileges before the
  application starts. It is idempotent and safe to re-run.
- **`service_conf.yaml` generated at startup.** The custom entrypoint generates
  `/ragflow/conf/service_conf.yaml` from injected environment variables — including MySQL
  host/user/database, Elasticsearch endpoint, Redis host/port, and optional credentials —
  before starting the RAGFlow processes (Nginx, RAGFlow server, task workers).
- **Document processing pipeline.** Uploaded documents are queued in Redis and processed
  asynchronously by RAGFlow's document workers: OCR, chunking, embedding, and indexing
  into Elasticsearch. Without a reachable Redis and Elasticsearch, files appear uploaded
  but are never processed.
- **Embedding model loading on startup.** RAGFlow downloads and loads embedding models
  during first boot. The startup probe targets `/v1/health` with a 120-second initial
  delay and 60 failure retries to allow ample time. Liveness transitions to `/v1/health`
  once startup succeeds.
- **Health endpoints.** The readiness and liveness probes use `/v1/health` and
  `/v1/system/version`. These return HTTP 200 only when the application is fully
  initialised and all services are reachable.
- **Session affinity.** `session_affinity = "ClientIP"` routes requests from a browser to
  the same pod, ensuring upload sessions and in-progress document workflows remain
  consistent.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for RAGFlow are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |
| `elasticsearch_hosts` | _(required)_ | Elasticsearch HTTP endpoint (e.g. `http://10.0.0.5:9200`). Set to the `elasticsearch_endpoint` output from `Elasticsearch_GKE`. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `ragflow` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `RAGFlow` | Friendly name shown in the Console. |
| `application_description` / `description` | _(set)_ | Workload description annotation. |
| `application_version` | `v0.13.0` | RAGFlow image version tag passed as `APP_VERSION` to Cloud Build; increment to roll out a new version. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `4000m` | CPU per pod; 4 vCPU recommended for document parsing workloads. |
| `memory_limit` | `8Gi` | Memory per pod; 8 GiB recommended (embedding models are large). |
| `min_instance_count` | `1` | Minimum replicas. Hard-capped at 1 — scale-to-zero is not supported. |
| `max_instance_count` | `5` | Maximum replicas (autoscaler ceiling). |
| `container_port` | `80` | RAGFlow's Nginx frontend listens on port 80. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |
| `termination_grace_period_seconds` | `60` | Increase for in-flight document processing jobs. |
| `deployment_timeout` | `1800` | Seconds Terraform waits for the rollout — generous to accommodate model loading. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not override `MYSQL_*`, `ELASTICSEARCH_*`, or `REDIS_*` — these are injected automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing — required for consistent upload sessions and document processing. |
| `workload_type` | `null` | Auto-resolves to StatefulSet when per-pod storage is enabled. |
| `network_tags` | `["nfsserver"]` | Node/pod tags; `nfsserver` is required for NFS connectivity. |

### Group 7 — StatefulSet Configuration

These settings apply only when `workload_type = "StatefulSet"` or `stateful_pvc_enabled = true`.

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Provision a PVC for local model storage. Recommended for production. |
| `stateful_pvc_size` | `10Gi` | PVC size; provision at least 50 GiB for production document workloads. |
| `stateful_pvc_mount_path` | `/data` | Container mount path for the PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |
| `stateful_fs_group` | `0` | fsGroup GID for PVC ownership; set if the container process requires a specific GID. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`8Gi`, `16384Mi`)** — bare integers are read as bytes and block scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 if you need eviction headroom. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | `/v1/health`, 120s delay, 60 retries | HTTP probe allowing ample time for embedding model loading. |
| `liveness_probe` / `health_check_config` | `/v1/health` | HTTP liveness probe once startup succeeds. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Recurring scheduled tasks deployed as Kubernetes CronJobs. |
| `additional_services` | `[]` | Additional companion Kubernetes Deployments (e.g. inline Elasticsearch for dev). |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for document processing storage (keep enabled for multi-replica). |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `nfs_instance_name` | `""` | Name of an existing NFS GCE VM; auto-discovered when empty. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the GCS document bucket. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Additional GCS buckets beyond `ragflow-documents`. |
| `gcs_volumes` | `[]` | GCS Fuse volumes mounted into the RAGFlow container. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK encryption options. |
| `max_images_to_retain` | `7` | Maximum recent Artifact Registry images to keep. |

### Group 15 — Elasticsearch & Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Use Redis for the document processing task queue. |
| `redis_host` | `""` | Redis host. When empty and NFS is enabled, the NFS server IP is used. Set explicitly for Memorystore. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |
| `elasticsearch_username` | `""` | Elasticsearch username. Leave empty when `xpack.security.enabled = false`. |
| `enable_inline_elasticsearch` | `false` | Deploy a single-node Elasticsearch sidecar. **Development only** — data is lost on pod restart. |
| `elasticsearch_version` | `8.13.0` | Elasticsearch image tag for the inline instance. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed — do not change. |
| `db_name` | `rag_flow` | Database name. Immutable after first deploy. |
| `db_user` | `ragflow` | Application user. Immutable after first deploy. |
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
| `enable_custom_domain` | `false` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `network_tags` | `["nfsserver"]` | GCP network tags applied to pods. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of RAGFlow. |
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

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach RAGFlow. |
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
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Connected repository details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. `false` on first apply of a new inline cluster — the CI/CD pipeline must re-run apply to complete deployment. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `elasticsearch_hosts` | required — set from `Elasticsearch_GKE` | Critical | RAGFlow cannot index or search; all ingestion and retrieval operations fail. Plan is rejected when empty and `deploy_application = true`. |
| `enable_redis` | `true` | Critical | Without Redis the document processing task queue never runs; uploaded files remain unprocessed indefinitely. |
| `database_type` | `MYSQL_8_0` | Critical | RAGFlow requires MySQL; PostgreSQL/`NONE` breaks startup. |
| `enable_cloudsql_volume` | `true` | Critical | RAGFlow connects via Unix socket; disabling the proxy sidecar causes a database connection failure on startup. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the database/user and destroys data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all scheduling. |
| `redis_host` | explicit Memorystore IP or `""` (NFS fallback) | High | An unreachable or wrong Redis host silently breaks all async document workers. |
| `min_instance_count` | `1` | High | `0` causes scale-to-zero; cold starts take 2–3 minutes and requests time out. |
| `memory_limit` | `8Gi` | High | Embedding models plus the application server typically require 4–8 GiB; too little causes OOM kills during document processing. |
| `stateful_pvc_enabled` | `true` for production | High | Without a PVC, pod restarts lose all in-progress processing state. |
| `session_affinity` | `ClientIP` | High | Without stickiness, multi-replica upload sessions may split across pods. |
| `elasticsearch_username` | `""` or correct user | High | If Elasticsearch security is enabled, leaving this blank causes HTTP 401 and breaks all indexing. |
| `enable_nfs` | `true` | High | Multi-replica deployments without shared storage see inconsistent document views across pods. |
| `enable_iap` / `enable_cloud_armor` | enable for production | Medium | RAGFlow's web UI is otherwise publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |
| `application_version` | `v0.13.0` | Medium | Incrementing triggers an image rebuild and rolling restart; verify MySQL schema compatibility for major version jumps. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. RAGFlow-specific application configuration shared with the
Cloud Run variant is described in **[RAGFlow_Common](RAGFlow_Common.md)**.
