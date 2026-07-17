---
title: "ToolJet on GKE Autopilot"
description: "Configuration reference for deploying ToolJet on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# ToolJet on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ToolJet_GKE.png" alt="ToolJet on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

ToolJet is an open-source, low-code platform for building and deploying internal
tools — dashboards, admin panels, CRUD apps, and workflows — with a drag-and-drop
builder over your own databases and APIs. This module deploys ToolJet on **GKE
Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and
manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services ToolJet uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

ToolJet runs as a single NestJS + React web workload — the backend API and the
compiled client are served from the same process (`SERVE_CLIENT = "true"`) on port
80. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pods, 2 vCPU / 4 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — **two** databases on one instance (metadata + ToolJet Database) |
| ToolJet Database | In-container PostgREST | Serves the second DB (`tooljet_db`) to app queries; signed with `PGRST_JWT_SECRET` |
| Cache & queue | Redis | Enabled by default; backs ToolJet's BullMQ queues; NFS VM co-hosts Redis when `redis_host` is empty |
| Secrets | Secret Manager | Auto-generated `SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, `PGRST_JWT_SECRET`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup.
- **Two databases are created.** The first-deploy `db-init` job creates the metadata
  database (`tooljet`) and the second "ToolJet Database" (`tooljet_db`), and grants
  the shared application role the **`CREATEROLE`** attribute.
- **Schema migrations run on start.** The container entrypoint runs
  `npm run db:migrate:prod` (TypeORM) **before** launching the server.
- **`SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, and `PGRST_JWT_SECRET` are generated
  automatically** and stored in Secret Manager. These keys must never be rotated
  after first boot — rotating `LOCKBOX_MASTER_KEY` corrupts all stored datasource
  credentials, and rotating `SECRET_KEY_BASE` invalidates all sessions.
- **Session affinity is `ClientIP` by default.** ToolJet's app builder uses
  persistent WebSocket connections for multiplayer editing; requests from the same
  client must reach the same pod.
- **`PORT` is defaulted to 80 by the entrypoint.** GKE does not inject `PORT`, so
  without the default ToolJet would bind 3000 while the Service and probes target 80.
- **Redis is enabled by default** and, with an empty `redis_host`, the NFS server
  VM's IP is injected as `REDIS_HOST` (`enable_nfs = true` provisions that VM).
- **A stable external IP + `nip.io` HTTPS host** are provisioned out of the box
  (`reserve_static_ip = true`, `enable_custom_domain = true`).
- **Sign-up is disabled by default.** `DISABLE_SIGNUPS = "true"` ships on; first run
  is a **setup wizard** that creates the initial admin user and workspace.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the ToolJet workload

ToolJet pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the ToolJet workload to see
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

### B. Cloud SQL for PostgreSQL 15 — two databases

ToolJet stores all application data — apps, datasource configs, users, workspaces,
sessions — in a managed Cloud SQL for PostgreSQL 15 instance, and uses a **second
database** (`tooljet_db`) on the same instance for the built-in ToolJet Database
feature. Pods reach it privately through the **Cloud SQL Auth Proxy** sidecar over a
loopback TCP endpoint (`127.0.0.1`); no public IP is exposed. On first deploy an
initialization Job creates both databases, the shared `CREATEROLE` role, `pgcrypto`,
and an app-owned `postgrest` schema.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=tooljet --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=tooljet_db --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see [App_GKE](App_GKE.md).

> **`enable_cloudsql_volume` must stay `true` on GKE.** The Auth Proxy sidecar
> provides the `127.0.0.1` PostgreSQL endpoint the pod and the `db-create` job
> depend on; disabling it on GKE hangs `db-create`.

### C. Redis (queue & cache)

Redis is **enabled by default** and backs ToolJet's BullMQ queues (background jobs,
notifications, the multiplayer editor). When `redis_host` is left empty and
`enable_nfs = true`, the NFS server VM's private IP is injected as `REDIS_HOST`; set
`redis_host` explicitly to point at a Memorystore instance instead.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the host injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS_HOST
  ```

### D. Secret Manager

Three cryptographic secrets are generated automatically and stored in Secret Manager:
`SECRET_KEY_BASE` (signs sessions), `LOCKBOX_MASTER_KEY` (encrypts all stored
datasource credentials), and `PGRST_JWT_SECRET` (signs the internal PostgREST JWTs).
The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP, with a
`nip.io` HTTPS host and a Google-managed certificate. A custom domain can be enabled,
and a static IP is reserved so the address survives redeploys. `TOOLJET_HOST` (which
drives generated links and OAuth redirect URIs) defaults to the computed service URL.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Storage & NFS

ToolJet stores apps, datasource configs, and uploads in PostgreSQL; a `data` Cloud
Storage bucket is provisioned by default (`storage_buckets`) but ToolJet itself does
not depend on it. NFS is enabled by default only because its VM co-hosts Redis when
`redis_host` is empty; the ToolJet pods themselves are stateless.

- **Console:** Cloud Storage → Buckets; Compute Engine → VM instances (NFS server).
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud compute instances list --project "$PROJECT" --filter="labels.managed-by=services-gcp"
  ```

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

## 3. ToolJet Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently
  creates the metadata database and the ToolJet Database, the shared `CREATEROLE`
  role, grants `cloudsqlsuperuser`, pre-creates `pgcrypto`, and resets the
  `postgrest` schema as app-owned on both databases. Without an app-owned `postgrest`
  schema, ToolJet's on-boot `reconfigurePostgrest` fails
  `permission denied for schema postgrest` and the pod crash-loops. The job is safe
  to re-run.
- **Migrations run before the server starts.** `cloud-entrypoint.sh` runs
  `npm run db:migrate:prod` (TypeORM `migration:run`) first — ToolJet's `start:prod`
  is `node dist/src/main` and does **not** migrate. Without it the metadata DB stays
  empty and every DB-backed action fails (`relation "user_sessions" does not exist`).
- **`SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, and `PGRST_JWT_SECRET` are immutable
  after first boot.** Changing `LOCKBOX_MASTER_KEY` corrupts all stored datasource
  credentials; changing `SECRET_KEY_BASE` invalidates all sessions. Only touch them
  in a planned maintenance window.
- **First run is a setup wizard.** With `DISABLE_SIGNUPS = "true"`, open the external
  URL and complete the wizard: it creates the first admin user and workspace, then
  lands you in the app builder.
- **Multiplayer editing needs sticky sessions.** `session_affinity = "ClientIP"`
  keeps a client's WebSocket connection on one pod; without it, real-time
  collaboration in the builder is disrupted.
- **Health path.** Startup and liveness probes default to `/` (the served client is
  public and unauthenticated); `/api/health` is also available as a probe path. Allow
  several minutes on first boot for the migration step.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for ToolJet are listed; every other input is
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

### Group 3 — Application & Database Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `tooljet` | Base name for resources (and namespace stem). Do not change after first deploy. |
| `application_display_name` | `ToolJet` | Human-readable name shown in the Console. |
| `application_version` | `latest` | `tooljet/tooljet-ce` image tag; pin to a specific release in production. |
| `application_database_name` | `tooljet` | Metadata database name. Immutable after first deploy. |
| `application_database_user` | `tooljet` | Application database user (shared by both databases). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | Per-pod CPU/memory limits and requests. |
| `min_instance_count` | `1` | Minimum replicas; GKE requires ≥ 1. |
| `max_instance_count` | `5` | Maximum replicas. **Only increase when Redis is enabled** (it is, by default). |
| `enable_vertical_pod_autoscaling` | `false` | VPA for automatic request adjustment. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar — required on GKE. |
| `enable_image_mirroring` | `true` | Mirror the ToolJet image into Artifact Registry. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not set `SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, `PGRST_JWT_SECRET`, or `PG_*` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `null` (auto) | `Deployment` or `StatefulSet`; resolves to `Deployment` when unset. |
| `session_affinity` | `ClientIP` | Sticky routing required for the multiplayer WebSocket editor. |
| `network_tags` | `["nfsserver"]` | Node/pod network tags; `nfsserver` is required when `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Seconds to wait after SIGTERM before SIGKILL. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (off) | Enable PVC templates. Not recommended — ToolJet stores all state in PostgreSQL. |
| `stateful_pvc_size` | `10Gi` | Per-pod PVC storage size. |
| `stateful_pvc_mount_path` | `/data` | Container mount path for the PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 60s initial delay | Startup probe with a wide budget (30 × 15s) for first-boot migrations. |
| `liveness_probe` | HTTP `/`, 60s initial delay | Liveness probe. |
| `startup_probe_config` / `health_check_config` | enabled, HTTP `/` | App_GKE-level infrastructure probes. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs. |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside ToolJet. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see [App_GKE](App_GKE.md).
Key inputs: `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | On by default; its VM co-hosts Redis when `redis_host` is empty. |
| `nfs_mount_path` | `/opt/tooljet/storage` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the configured GCS buckets. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets to provision — the default creates a `data` bucket (ToolJet's own state lives in PostgreSQL). |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts via the CSI driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 15 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Backs ToolJet's BullMQ queues. Forwarded unchanged. |
| `redis_host` | `""` | Leave empty to use the NFS server IP (requires `enable_nfs = true`), or set a Memorystore endpoint. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16/17 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before rolling-restarting pods. |

### Group 17/6 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_GKE](App_GKE.md).

### Group 10/19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress + managed certificate (defaults to a `nip.io` host). |
| `application_domains` | `[]` | Additional hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of ToolJet. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 13/21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
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
| `service_url` | URL to reach ToolJet. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Metadata database name. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `LOCKBOX_MASTER_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it permanently corrupts every stored datasource credential — they cannot be decrypted. |
| `SECRET_KEY_BASE` (auto-generated) | Only rotate in a maintenance window | Critical | Rotating it invalidates all active sessions, forcing immediate re-login for everyone. |
| `PGRST_JWT_SECRET` (auto-generated) | Never rotate after first boot | Critical | Rotating it breaks the ToolJet Database query layer until every pod restarts. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity on GKE; disabling it hangs `db-create`. |
| App role `CREATEROLE` (set by `db-init`) | Leave as provisioned | High | Without it, ToolJet workspace creation fails `permission denied to create role`. |
| App-owned `postgrest` schema (set by `db-init`) | Leave as provisioned | High | A `postgres`-owned schema makes `reconfigurePostgrest` fail and the pod crash-loops. |
| `PORT` (entrypoint default 80) | Leave as provisioned | High | If the pod binds 3000 while the Service targets 80, it never becomes Ready. |
| `session_affinity` | `ClientIP` | High | Without stickiness, WebSocket reconnections route to different pods, disrupting multiplayer editing. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects invalid values. |
| `memory_limit` | `4Gi` | High | ToolJet + PostgREST + worker can OOM below ~2 GiB under load. |
| `enable_redis` | `true` | Medium | With Redis off, BullMQ falls back and background features degrade. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `DISABLE_SIGNUPS` (auto-injected `"true"`) | Keep on after first admin | High | Opening sign-up lets anyone with the URL create an account. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict all pods simultaneously during maintenance. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
ToolJet-specific application configuration shared with the Cloud Run variant is
described in **[ToolJet_Common](ToolJet_Common.md)**.
