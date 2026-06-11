---
title: "Flowise on GKE Autopilot"
---

# Flowise on GKE Autopilot

Flowise is an open-source visual AI workflow builder that lets non-developers assemble
LangChain and LlamaIndex AI pipelines through a drag-and-drop interface. This module
deploys Flowise on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation,
which provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Flowise uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

Flowise runs as a Node.js container workload. The deployment wires together a focused
set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pods, 1 vCPU / 1 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Flowise does not support MySQL in this deployment |
| Object storage | Cloud Storage | A dedicated uploads bucket always provisioned; stores Flowise file uploads |
| Secrets | Secret Manager | Auto-generated Flowise admin password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed; selecting MySQL or
  `NONE` breaks startup.
- **GCS-backed file storage is always enabled.** `STORAGE_TYPE=gcs` and
  `APIKEY_STORAGE_TYPE=db` are injected automatically; API keys are stored in the
  database, not in files.
- **Session affinity is `ClientIP`.** Requests from a browser are pinned to one pod
  to keep the Flowise UI session consistent.
- **The admin password is generated automatically** and stored in Secret Manager;
  you never set it in plain text.
- **`DATABASE_*` variables are mapped by the entrypoint script** (`flowise-entrypoint.sh`)
  from platform-standard `DB_*` variables at container startup — do not set them
  directly as environment variables.
- **Redis is disabled by default.** It is not required for Flowise core functionality,
  but multi-replica deployments that share flow-execution state do benefit from it.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Flowise workload

Flowise pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the
minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Flowise workload to see
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

### B. Cloud SQL for PostgreSQL 15

Flowise stores all application data (flow definitions, credentials, executions) in a
managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately through the
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

### C. Cloud Storage

A dedicated **Cloud Storage** uploads bucket is always provisioned by Flowise_Common.
Its name is injected into the container automatically as
`GOOGLE_CLOUD_STORAGE_BUCKET_NAME`. Flowise writes all user-uploaded files (documents,
images) to this bucket. Additional buckets can be configured via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/          # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for GCS Fuse mounts and CMEK options.

### D. Secret Manager

The Flowise admin password is stored as a Secret Manager secret and injected into
pods at runtime; plaintext never appears in configuration. The database password is
managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

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

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Flowise Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) using the
  `postgres:15-alpine` image creates the Flowise database and user and grants
  privileges before the application starts. It is idempotent and safe to re-run.
- **Health probe.** Both startup and liveness probes target Flowise's dedicated
  health endpoint `/api/v1/ping`, which returns HTTP 200 when the application is
  ready. The startup probe allows up to 5 minutes of startup budget (30 failures
  × 10-second interval) to accommodate first-boot database initialisation.
- **Admin login.** The initial admin username is configurable via `flowise_username`
  (default `admin`). The admin password is auto-generated and stored in Secret
  Manager; retrieve it with:
  ```bash
  gcloud secrets versions access latest \
    --secret=<resource_prefix>-flowise-password --project "$PROJECT"
  ```
- **DB variable remapping.** `flowise-entrypoint.sh` unconditionally maps
  `DB_HOST`, `DB_USER`, `DB_NAME`, and `DB_PASSWORD` (injected by the platform)
  to `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_NAME`, and `DATABASE_PASSWORD`
  at container startup. Do not set `DATABASE_*` variables directly.
- **GCS file storage.** `STORAGE_TYPE=gcs` and `GCLOUD_PROJECT` are always injected.
  Flowise writes uploaded files to the auto-provisioned GCS bucket. Overriding
  `STORAGE_TYPE` causes uploads to be written to ephemeral pod storage and lost on
  every restart.
- **Multi-replica considerations.** Flowise stores in-memory flow-execution state.
  Running more than one replica without Redis causes flow executions to fail when
  requests are load-balanced to a different pod. Keep `max_instance_count = 1`
  unless Redis is configured.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Flowise are listed; every other input is
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
| `application_name` | `flowise` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Flowise` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `latest` | Flowise image version tag; update to roll out a new release. |
| `flowise_username` | `admin` | Flowise admin username injected as `FLOWISE_USERNAME`. Change before exposing publicly. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds via Cloud Build; `prebuilt` deploys an existing image URI. |
| `container_image` | `""` | Override image URI (only used when `container_image_source = "prebuilt"`). |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="1Gi" }` | CPU/memory limits per pod. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 to avoid cold starts for AI workflow execution. |
| `max_instance_count` | `1` | Maximum replicas. Increase only with Redis enabled. |
| `container_port` | `3000` | Flowise listens on port 3000. |
| `timeout_seconds` | `300` | Max backend pod response wait. Increase for long-running AI workflows (max 3600). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not override platform-managed vars (`DATABASE_*`, `FLOWISE_*`, `STORAGE_TYPE`). |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g. `{ OPENAI_API_KEY = "flowise-openai-key" }`). |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `gke_cluster_name` | `""` | GKE cluster name. Leave empty for auto-discovery. |
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing recommended for the Flowise UI. |
| `workload_type` | `null` | Defaults to `Deployment` for Flowise (stateless). |
| `network_tags` | `["nfsserver"]` | Node/pod tags for firewall rules. |

### Group 7 — StatefulSet

Only relevant when `workload_type = "StatefulSet"`.

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable PVC templates in the StatefulSet spec. |
| `stateful_pvc_size` | `10Gi` | Storage size for each PVC. |
| `stateful_pvc_mount_path` | `/data` | Container path where the PVC is mounted. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block all scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | path `/api/v1/ping`, 30s delay, 30 failures | 5-minute startup budget for DB initialisation on first boot. |
| `health_check_config` | path `/api/v1/ping`, 15s delay | Liveness probe. |
| `uptime_check_config` | enabled, path `/` | Cloud Monitoring uptime check from global locations. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs. |
| `additional_services` | `[]` | Sidecar or helper GKE services deployed alongside Flowise. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Provision Filestore NFS volume. Useful for Flowise workflow file uploads when NFS is preferred over GCS. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the additional buckets in `storage_buckets`. The Flowise uploads bucket is always created by Flowise_Common. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Additional GCS buckets to provision. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 15 — Redis (optional)

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis. Not required for core functionality; needed for multi-replica deployments. |
| `redis_host` | `""` | Redis endpoint. Required when `enable_redis = true` (or `enable_nfs = true` uses the NFS host IP). |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Cloud SQL engine. Flowise requires PostgreSQL. |
| `application_database_name` | `flowisedb` | Database name. Immutable after first deploy. |
| `application_database_user` | `flowiseuser` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_postgres_extensions` | `false` | Enable installation of PostgreSQL extensions. |
| `postgres_extensions` | `[]` | List of PostgreSQL extensions to install. |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `false` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve (e.g. `["flowise.example.com"]`). |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Flowise. Recommended for production. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Cloud Armor & CDN

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | `default-waf-policy` | Policy name. |
| `enable_cdn` | `false` | Enable Cloud CDN on the GKE Ingress backend. |

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
| `service_url` | URL to reach Flowise. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` | DB endpoint (127.0.0.1 via the Auth Proxy). |
| `database_port` | Database port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of the setup jobs. |
| `db_import_job` | Name of the (optional) import job. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD repo details. |
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
| `database_type` | `POSTGRES_15` | Critical | Flowise requires PostgreSQL; MySQL/`NONE` breaks startup. |
| `enable_cloudsql_volume` | `true` | Critical | Without the Auth Proxy sidecar, the database connection is refused. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup file fails the import job. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all scheduling. |
| `flowise_username` | change from `admin` | High | The default username is publicly known; combined with a guessed password it grants full access to all AI flows. |
| `FLOWISE_SECRETKEY_OVERWRITE` | leave unset after first deploy | High | Changing or removing this after the first deploy permanently scrambles all stored LLM API keys and vector-store credentials. |
| `container_resources.memory_limit` | `1Gi` | High | Below 512Mi the Node.js process is OOM-killed on startup. Production with large flow graphs needs 2Gi. |
| `max_instance_count` | `1` (without Redis) | High | Multiple replicas without a shared Redis store cause flow executions to fail when requests are routed to a different pod. |
| `enable_iap` | enable for admin-facing | High | The Flowise UI is otherwise publicly reachable without authentication. |
| `STORAGE_TYPE` | `gcs` (default) | High | Overriding to anything else writes uploads to ephemeral pod storage, lost on every pod restart. |
| `min_instance_count` | `1` | Medium | `0` risks cold-start latency that exceeds downstream LLM client timeouts. |
| `enable_redis` | enable with >1 replica | Medium | Required for shared session/queue state across multiple replicas. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Flowise-specific application configuration shared with the
Cloud Run variant is described in **[Flowise_Common](Flowise_Common.md)**.
