---
title: "LangFlow on GKE Autopilot"
description: "Configuration reference for deploying LangFlow on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# LangFlow on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LangFlow_GKE.png" alt="LangFlow on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

LangFlow is an open-source, low-code visual builder for AI agents and workflows,
built on LangChain — you assemble language-model chains, RAG pipelines, and agents by
dragging and wiring components on a canvas, then expose them as APIs. This module
deploys LangFlow on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation,
which provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services LangFlow uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## 1. Overview

LangFlow runs as a single Python (FastAPI + React) web workload. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Python pods on port **7860**, 1 vCPU / 1 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — LangFlow persists all flows, components, and credentials in Postgres |
| Object storage | Cloud Storage | A dedicated `data` bucket is provisioned by default; LangFlow's application state itself lives in PostgreSQL |
| Cache & queue | Redis (optional) | Not required by LangFlow; wired for forward compatibility only |
| Secrets | Secret Manager | Auto-generated `LANGFLOW_SECRET_KEY` and `LANGFLOW_SUPERUSER_PASSWORD`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer (`database_type = "POSTGRES_15"`); selecting any other engine
  breaks startup.
- **`LANGFLOW_SECRET_KEY` is generated automatically** and stored in Secret Manager.
  It encrypts every stored credential embedded in a flow. It must never be rotated
  after first boot — rotating it permanently breaks all stored credentials, which
  then have to be re-entered in each flow.
- **The admin account is provisioned from a generated password.**
  `LANGFLOW_AUTO_LOGIN = "false"` turns on authentication; LangFlow creates the initial
  admin (`admin` by default) using the `LANGFLOW_SUPERUSER_PASSWORD` secret. Retrieve
  it from Secret Manager to log in.
- **The database connects via the Cloud SQL Auth Proxy sidecar** on `127.0.0.1`; the
  entrypoint composes `LANGFLOW_DATABASE_URL` over TCP with `sslmode=disable` (the
  proxy terminates TLS).
- **Session affinity is `ClientIP` by default.** LangFlow holds in-process session and
  flow-editor state; sticky routing keeps a client on the same pod.
- **A single pod by default** (`min_instance_count = 1`, `max_instance_count = 1`).
  GKE does not scale to zero; LangFlow's in-process state means a single replica is the
  safe default.
- **Application state lives in PostgreSQL; NFS is off by default.** A `data` Cloud
  Storage bucket is provisioned by default (`storage_buckets`), but LangFlow itself
  keeps flows, components, and credentials in the database.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the LangFlow workload

LangFlow pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the LangFlow workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

LangFlow stores all application data (flows, components, credentials, run history,
users) in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately
through the **Cloud SQL Auth Proxy** sidecar on `127.0.0.1`; no public IP is exposed.
On first deploy an initialization Job creates the application database, role, and
grants.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~langflow"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Redis (optional — not used by LangFlow)

Redis is **disabled by default** and LangFlow does not require it; the `enable_redis`
inputs are wired for forward compatibility only. Leave `enable_redis = false` unless a
future feature needs it.

- **CLI (only if enabled):**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### D. Secret Manager

Two secrets are generated automatically and stored in Secret Manager:
`LANGFLOW_SECRET_KEY` (encrypts all stored credentials) and
`LANGFLOW_SUPERUSER_PASSWORD` (the initial admin login password). They are delivered
to pods through the Secret Store CSI integration. The database password is managed
separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~langflow"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`). A custom domain with a Google-managed certificate can
be enabled, and a static IP can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

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

## 3. LangFlow Application Behaviour

- **First-deploy database setup.** An initialization Job runs `create-db-and-user.sh`
  using `postgres:15-alpine`. It waits for PostgreSQL, then idempotently creates the
  application role and database, sets ownership, and grants privileges on the database
  and `public` schema, then signals the Cloud SQL Auth Proxy sidecar to shut down
  (`POST /quitquitquit`) so the Job pod exits cleanly. It is safe to re-run.
- **Schema migrations on start.** LangFlow runs its **Alembic migrations on every
  container start**, so the tables are created and upgraded by the application itself —
  the `db-init` job only handles role/database/grants. Allow extra time on first boot.
- **`LANGFLOW_SECRET_KEY` is immutable after first boot.** It is generated once and
  written to Secret Manager. Changing it permanently breaks every stored credential
  embedded in a flow; they can no longer be decrypted. Only rotate during a planned
  maintenance window with a plan to re-enter credentials.
- **Initial admin account.** With `LANGFLOW_AUTO_LOGIN = "false"`, LangFlow creates the
  superuser (`admin` by default, set via `langflow_username`) using the
  `LANGFLOW_SUPERUSER_PASSWORD` secret. Retrieve the password and log in:
  ```bash
  gcloud secrets versions access latest \
    --secret=<langflow-password-secret> --project "$PROJECT"
  ```
- **Database URL is composed at runtime.** The entrypoint builds `LANGFLOW_DATABASE_URL`
  from the injected `DB_*` vars over TCP. On GKE `DB_HOST = 127.0.0.1` (the Auth Proxy
  sidecar) so `sslmode=disable` is used — do not set the DSN manually.
- **Health path.** Startup and liveness probes target **`/health`**, LangFlow's public
  liveness endpoint that returns `200` once the server is up. Allow time on first boot
  for the Alembic migrations before the pod becomes Ready.
- **Session affinity.** `session_affinity = ClientIP` keeps each client on the same pod
  — important because LangFlow keeps flow-editor state in-process.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for LangFlow are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

All other inputs follow standard App_GKE behaviour.

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

All other inputs follow standard App_GKE behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `langflow` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `LangFlow` | Human-readable name shown in the Console. |
| `application_version` | `latest` | LangFlow image version tag; pins base image `1.10.2` when `latest`. Pin explicitly in production. |
| `langflow_username` | `admin` | Initial superuser (admin) username; the password is auto-generated in Secret Manager. |

All other inputs follow standard App_GKE behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | LangFlow is built from the wrapped image via Cloud Build. |
| `min_instance_count` | `1` | Minimum replicas; GKE does not scale to zero. |
| `max_instance_count` | `1` | Keep at `1` — LangFlow holds in-process state. |
| `enable_vertical_pod_autoscaling` | `false` | Autopilot VPA for right-sizing. |
| `container_port` | `7860` | LangFlow listens on port 7860. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "1Gi" }` | Per-pod CPU/memory limits and requests. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for connectivity. |
| `enable_image_mirroring` | `true` | Mirror the LangFlow base image into Artifact Registry before the custom build. |

All other inputs follow standard App_GKE behaviour.

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings merged over the LangFlow defaults. Do not set `LANGFLOW_SECRET_KEY`, `LANGFLOW_SUPERUSER_PASSWORD`, or `LANGFLOW_DATABASE_URL` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g. LLM provider API keys). |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

All other inputs follow standard App_GKE behaviour.

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `gke_cluster_name` | `""` (auto-discovered) | Target Autopilot cluster (from Services_GCP). |
| `namespace_name` | `""` (auto-generated) | Kubernetes namespace for the workload. |
| `workload_type` | `null` | Resolves to `Deployment` (default); `StatefulSet` when a PVC is enabled. |
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing for in-process flow-editor state. |
| `termination_grace_period_seconds` | `30` | Seconds to wait after SIGTERM before SIGKILL. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |

All other inputs follow standard App_GKE behaviour.

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable PVC templates. Not needed — LangFlow stores all state in PostgreSQL. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` / `stateful_pvc_storage_class` | _(set)_ | Per-pod PVC sizing and mount (only if enabled). |
| `stateful_headless_service` / `stateful_pod_management_policy` / `stateful_update_strategy` | _(set)_ | StatefulSet behaviour (only if enabled). |

All other inputs follow standard App_GKE behaviour.

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Enforce a namespace ResourceQuota. |
| `quota_cpu_requests` / `quota_cpu_limits` | _(set)_ | CPU quota for the namespace. |
| `quota_memory_requests` / `quota_memory_limits` | _(set)_ | **Must use binary unit suffixes** (`4Gi`, `8192Mi`) — bare integers are treated as bytes. |

All other inputs follow standard App_GKE behaviour.

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Enable to protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |
| `enable_topology_spread` / `topology_spread_strict` | _(set)_ | Spread pods across zones/nodes. |

All other inputs follow standard App_GKE behaviour.

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health` | Startup probe. Allow time for first-boot Alembic migrations. |
| `health_check_config` | HTTP `/health` | Liveness probe. |
| `uptime_check_config` | disabled (`enabled = false`, path `/`) | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

All other inputs follow standard App_GKE behaviour.

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs (none required by LangFlow). |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside LangFlow. |

All other inputs follow standard App_GKE behaviour.

### Group 12 — CI/CD & Binary Authorization

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is off by default; LangFlow keeps state in PostgreSQL. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container (when NFS is enabled). |

All other inputs follow standard App_GKE behaviour.

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets to provision — the default creates a dedicated `data` bucket. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts via the CSI driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

All other inputs follow standard App_GKE behaviour.

### Group 15 — Redis Cache (optional)

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not used by LangFlow; wired for forward compatibility only. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Redis connection settings (only if enabled). |

All other inputs follow standard App_GKE behaviour.

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — LangFlow requires PostgreSQL 15. |
| `application_database_name` | `langflowdb` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `langflowuser` | Application database user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length. |
| `enable_postgres_extensions` / `postgres_extensions` | off | Optional Postgres extensions. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | Zero-downtime DB password rotation. |

All other inputs follow standard App_GKE behaviour.

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated Cloud SQL backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. |

All other inputs follow standard App_GKE behaviour.

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
| `network_tags` | `["nfsserver"]` | Node/pod network tags; `nfsserver` required when `enable_nfs = true`. |

All other inputs follow standard App_GKE behaviour.

### Group 20 — Identity-Aware Proxy (IAP)

> **Warning:** Enabling IAP requires Google identity authentication for **all** inbound
> requests, including calls to LangFlow's programmatic API.

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of LangFlow. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

All other inputs follow standard App_GKE behaviour.

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | `default-waf-policy` | Policy name. |
| `enable_cdn` | `false` | Enable Cloud CDN on the GKE Ingress backend. |

All other inputs follow standard App_GKE behaviour.

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs follow standard App_GKE behaviour.

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
| `service_url` | URL to reach LangFlow. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (the `data` bucket by default). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD GitHub details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine plus a `validation.tf` guard that checks values *and combinations* at plan time — `min_instance_count > max_instance_count`, Redis enabled without a host source, IAP with no OAuth credentials, and `enable_cloudsql_volume = true` with `database_type = "NONE"`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `LANGFLOW_SECRET_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it permanently breaks every stored credential embedded in a flow — they cannot be decrypted and must be re-entered. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all flows and credentials. |
| `database_type` | `POSTGRES_15` | Critical | LangFlow requires PostgreSQL 15; any other engine breaks startup. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup source fails the import job. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `LANGFLOW_SUPERUSER_PASSWORD` (auto-generated) | Retrieve from Secret Manager | High | This is the admin login; losing it means no way to sign in until it is reset. |
| `max_instance_count` | `1` | High | LangFlow keeps in-process session/flow state; scaling beyond 1 splits state across pods and causes inconsistent behaviour. |
| `session_affinity` | `ClientIP` | High | Without stickiness, requests route to different pods, disrupting the in-process flow editor. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects values above `max_instance_count`. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity; disabling it with a real database breaks all connections. |
| `container_port` | `7860` | High | LangFlow listens on 7860; a mismatched port fails all health probes. |
| `enable_iap` | only when API auth not needed externally | High | IAP puts Google sign-in in front of the whole service, including its programmatic API. |
| `container_resources.memory_limit` | ≥ `1Gi` | High | Values below 1 GiB risk OOM kills for the Python runtime under load. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict all pods simultaneously during maintenance. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image building — see **[App_GKE](App_GKE.md)**. LangFlow-specific
application configuration shared with the Cloud Run variant is described in
**[LangFlow_Common](LangFlow_Common.md)**.
