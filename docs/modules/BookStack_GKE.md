---
title: "BookStack on GKE Autopilot"
description: "Configuration reference for deploying BookStack on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# BookStack on GKE Autopilot

BookStack is a free, open-source, MIT-licensed wiki and documentation platform
built on Laravel (PHP), organising content as Shelves → Books → Chapters → Pages
with WYSIWYG and Markdown editing, full-text search, page revisions, and granular
permissions. This module deploys BookStack on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services BookStack uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

BookStack runs as a PHP web workload on GKE Autopilot. The deployment wires together
a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | PHP (LinuxServer) pods, 1 vCPU / 2 GiB by default, single replica (NFS-backed) |
| Database | Cloud SQL for MySQL 8.0 | Required — BookStack does not support PostgreSQL or other engines |
| Object storage | Cloud Storage | A dedicated `data` bucket (`gcs-bookstack<tenant>-data`) provisioned automatically |
| Persistent files | Filestore / NFS | Uploaded images and attachments persisted at `/var/lib/bookstack` |
| Cache & sessions | Redis (optional) | Disabled by default; BookStack uses the local cache/session driver |
| Secrets | Secret Manager | Auto-generated Laravel `APP_KEY`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, custom domain + managed certificate + static IP by default |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed by the shared application
  layer (`database_type = "MYSQL_8_0"`); PostgreSQL is not supported and selecting
  another engine breaks startup.
- **The prebuilt `linuxserver/bookstack` image is used directly.** There is no custom
  Cloud Build; the official LinuxServer.io image is mirrored into Artifact Registry
  (`enable_image_mirroring = true`) and deployed as-is.
- **The container listens on port 80** (`container_port = 80`, `container_protocol = "http1"`).
- **NFS persistence of uploads is on by default.** `enable_nfs = true` mounts NFS at
  `/var/lib/bookstack` so uploaded images and attachments survive restarts, redeploys,
  and pod rescheduling. Because BookStack is NFS-backed, the Deployment uses the
  `Recreate` update strategy (a single pod against the shared volume).
- **A single replica is maintained** (`min_instance_count = 1`, `max_instance_count = 1`;
  GKE has no scale-to-zero). Do not scale beyond one pod without external session/cache
  coordination — multiple pods against the same NFS volume and DB deadlock.
- **`APP_KEY` is immutable after first boot.** The Laravel app key is generated once
  and stored in Secret Manager; rotating it makes all encrypted DB values undecryptable.
- **The image runs `php artisan migrate --force` automatically on start**, so the
  schema is created on first boot after `db-init` provisions the database and user —
  there is no separate migration job.
- **A default administrator is seeded** by the LinuxServer image: `admin@admin.com`
  with password `password`. Change it immediately on first login.
- **GKE connects to Cloud SQL through the Auth Proxy sidecar** on `127.0.0.1:3306`
  (`enable_cloudsql_volume = true`), and the GKE wiring overrides `DB_HOST = "127.0.0.1"`.
- **A custom domain, managed certificate, and reserved static IP are enabled by
  default** (`enable_custom_domain = true`, `reserve_static_ip = true`), with
  `session_affinity = "ClientIP"` for sticky UI sessions.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the BookStack workload

BookStack pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Because the app is NFS-backed, the workload runs as a single-replica
Deployment using the `Recreate` strategy.

- **Console:** Kubernetes Engine → Workloads → select the BookStack workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe deploy/<service-name> -n "$NAMESPACE"    # strategy, events
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Cloud SQL for MySQL 8.0

BookStack stores all application data (books, pages, users, revisions, permissions)
in a managed Cloud SQL for MySQL 8.0 instance. Pods reach it privately through the
**Cloud SQL Auth Proxy** sidecar on `127.0.0.1:3306` (`enable_cloudsql_volume = true`);
no public IP is exposed. On first deploy an initialization Job creates the application
database and user.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=bookstack --database=<db-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see
[App_GKE](App_GKE.md).

### C. Cloud Storage

A dedicated **Cloud Storage** bucket (`storage_buckets` default: `name_suffix = "data"`,
resulting in `gcs-bookstack<tenant>-data`) is provisioned automatically. The workload
service account is granted access. Additional buckets can be declared via
`storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/        # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Redis (optional cache & sessions)

Redis is **disabled by default** (`enable_redis = false`); BookStack uses its local
cache and session drivers. When `enable_redis = true` is set, the shared layer injects
`REDIS_HOST` and `REDIS_PORT`. When `redis_host` is left empty and `enable_nfs` is
true, the NFS server VM's co-hosted Redis IP is used.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the DB wiring injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_|REDIS_'
  ```

### E. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager: the
Laravel **`APP_KEY`** (`base64:<44-char base64>`), used to encrypt all application
data that BookStack stores encrypted. The database password is managed separately by
the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP with a
custom domain and Google-managed certificate (`enable_custom_domain = true`), and a
static IP is reserved (`reserve_static_ip = true`) so the address survives redeploys.

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

## 3. BookStack Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `mysql:8.0-debian`. It detects the Cloud SQL socket or TCP endpoint, waits for MySQL
  to be reachable, creates the application database and user, grants privileges,
  verifies the app user can connect, and gracefully shuts down the Cloud SQL Auth
  Proxy sidecar. The job is idempotent and safe to re-run (`max_retries = 3`).
- **Schema auto-migration on start.** The LinuxServer BookStack image runs
  `php artisan migrate --force` automatically on every container start, so the schema
  is created on first boot and upgraded on later boots — there is **no separate
  migration job**.
- **`APP_KEY` is immutable after first boot.** The Laravel app key is generated once
  and written to Secret Manager. Rotating it makes all encrypted DB values (two-factor
  secrets, some settings) permanently undecryptable. Only rotate during a planned
  maintenance window with a re-encryption plan.
- **First-run administrator.** The image seeds a default admin account,
  `admin@admin.com` / `password`. Change the password (and ideally the email)
  immediately after the first login.
- **Uploaded files live on NFS.** Images, attachments, and other uploads are stored on
  the filesystem under `/var/lib/bookstack`, which is NFS-backed by default. The
  Deployment therefore uses the `Recreate` strategy so only one pod ever writes to the
  shared volume — do not scale to multiple replicas without external coordination.
- **Health path.** The liveness probe targets `/status` by default — BookStack's
  unauthenticated JSON health endpoint that reports app/database/cache/session status.
  The startup probe is a TCP check. Allow a generous first-boot window (300-second
  initial delay) for the automatic migrations.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for BookStack are listed; every other input is
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
| `application_name` | `bookstack` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `BookStack` | Human-readable name shown in the Console. |
| `application_description` | `BookStack wiki on GKE Autopilot` | Workload description. |
| `application_version` | `latest` | `linuxserver/bookstack` image tag; pin (e.g. `version-v24.10`) in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Deploy the mirrored LinuxServer image directly — no custom build. |
| `container_image` | `""` | Override image reference; leave empty to use the mirrored default. |
| `enable_image_mirroring` | `true` | Mirror the LinuxServer image into Artifact Registry before deployment. |
| `min_instance_count` | `1` | Minimum replicas; keep at 1 (NFS-backed single pod). |
| `max_instance_count` | `1` | Maximum replicas. Do not raise without external session/cache coordination. |
| `container_port` | `80` | BookStack listens on port 80. |
| `container_protocol` | `http1` | HTTP/1.1. |
| `cpu_limit` | `1000m` | CPU per pod; 1 vCPU by default. |
| `memory_limit` | `2Gi` | Memory per pod. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar (`127.0.0.1:3306`); required on GKE. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings (e.g. `APP_URL`, mail config). Do not set `APP_KEY` or `DB_*` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `null` | Resolves to `Deployment` (default) unless a StatefulSet is requested. |
| `session_affinity` | `ClientIP` | Sticky routing keeps a client's UI session on one pod. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |
| `termination_grace_period_seconds` | `30` | Seconds to wait after SIGTERM before SIGKILL. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Leave off — BookStack uses NFS, not per-pod PVCs. |
| `stateful_pvc_size` | `10Gi` | Per-pod PVC storage size (if enabled). |
| `stateful_pvc_mount_path` | `/data` | Container mount path for the PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Enforce a namespace ResourceQuota. |
| `quota_cpu_requests` / `quota_cpu_limits` | `""` | CPU quota. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Memory quota — use binary units (`4Gi`, `8192Mi`). |
| `quota_max_pods` / `quota_max_services` / `quota_max_pvcs` | `""` | Object-count quotas. |

### Group 9 — Reliability

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |
| `enable_topology_spread` / `topology_spread_strict` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, path `/status`, 30s | Startup probe (port-listening check). |
| `liveness_probe` | HTTP `/status`, 300s delay | Liveness probe against BookStack's unauthenticated health endpoint. |
| `startup_probe_config` / `health_check_config` | App_GKE-level probes | Infrastructure-level probes. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs. |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside BookStack. |

### Group 12 — CI/CD & Binary Authorization

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Persist uploaded images/attachments on NFS. Disabling loses uploads on redeploy. |
| `nfs_mount_path` | `/var/lib/bookstack` | Mount path where BookStack stores uploads. |
| `nfs_volume_name` | `nfs-data-volume` | Kubernetes volume name for the NFS mount. |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | NFS server discovery/naming. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the default `data` bucket and any in `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix="data" }]` | GCS buckets to provision. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts via the CSI driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` | `7` | Maximum recent Artifact Registry images to keep. |
| `delete_untagged_images` | `true` | Automatically delete untagged images. |
| `image_retention_days` | `30` | Days after which images are eligible for deletion. |

### Group 15 — Redis Cache & Sessions

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Inject `REDIS_HOST`/`REDIS_PORT` so BookStack can use Redis for cache/sessions. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` | Fixed — BookStack requires MySQL 8.0. |
| `application_database_name` | `bookstack` | MySQL database name (tenant-prefixed). Immutable after first deploy. |
| `application_database_user` | `bookstack` | Application database user (tenant-prefixed). Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length. |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before rolling-restarting pods. |

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
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `network_tags` | `["nfsserver"]` | Node/pod network tags; `nfsserver` is required when `enable_nfs = true`. |

### Group 20 — Identity-Aware Proxy (IAP)

> **Warning:** Enabling IAP requires Google identity authentication for **all**
> inbound requests, blocking anonymous readers of the wiki. Only enable IAP when
> the documentation must not be publicly readable.

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of BookStack. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 21 — Cloud Armor

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
| `service_url` | URL to reach BookStack. |
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
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD GitHub details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match the engine BookStack requires, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `APP_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it makes all encrypted DB values (two-factor secrets, some settings) permanently undecryptable. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `database_type` | `MYSQL_8_0` | Critical | BookStack requires MySQL; any other engine breaks startup. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `APP_URL` (via `environment_variables`) | External LoadBalancer / custom domain URL | High | A wrong base URL breaks asset loading, links, and login redirects. |
| `enable_nfs` | `true` | High | Disabling loses all uploaded images and attachments on redeploy or pod reschedule. |
| `memory_limit` | `2Gi` | High | Lower values risk OOM kills under concurrent editing and full-text indexing. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for MySQL connectivity on GKE; disabling it is blocked by a plan-time validation guard. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; keeping 1 is correct for the NFS-backed single-pod deployment. |
| `max_instance_count` | `1` | High | Multiple pods against the same NFS volume and DB deadlock; do not scale out without external coordination. |
| `session_affinity` | `ClientIP` | High | Without stickiness, UI sessions bounce between pods (only relevant if ever scaled >1). |
| `liveness_probe` path | `/status` (default) | Medium | Pointing the probe at any other path never returns healthy for BookStack — `/status` is its unauthenticated JSON health endpoint. |
| `enable_iap` | only when readers must authenticate | High | IAP blocks all anonymous access, including public documentation readers. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. BookStack-specific application configuration shared
with the Cloud Run variant is described in
**[BookStack_Common](BookStack_Common.md)**.
