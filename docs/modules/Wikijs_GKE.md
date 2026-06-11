---
title: "Wiki.js on GKE Autopilot"
---

# Wiki.js on GKE Autopilot

Wiki.js is a powerful open-source wiki platform designed for teams that need modern,
fast knowledge management with Git-backed version control and a clean writing
experience. This module deploys Wiki.js on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Wiki.js uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

Wiki.js runs as a Node.js web workload. The deployment wires together a focused set
of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pods, 1 vCPU / 2 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Wiki.js uses PostgreSQL with the `pg_trgm` extension for full-text search |
| Shared files | Filestore (NFS) | Uploaded assets shared across all replicas |
| Object storage | Cloud Storage | A dedicated `wikijs-storage` bucket, mountable via GCS Fuse at `/wiki-storage` |
| Cache (optional) | Redis | Disabled by default; enable for session caching in multi-replica deployments |
| Secrets | Secret Manager | Auto-generated database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed; using MySQL or `NONE`
  breaks startup. The `pg_trgm` extension is installed automatically and is required
  for Wiki.js full-text search.
- **NFS is enabled by default.** With more than one replica, a shared NFS volume is
  required so all pods see the same uploaded files.
- **Port 3000.** Wiki.js binds to port 3000, not the conventional 80 or 8080.
- **Session affinity is `ClientIP`.** Wiki.js maintains in-memory session context;
  sticky routing keeps requests from one user on the same pod.
- **The database is bootstrapped on first deploy** by a `db-init` job that creates
  the PostgreSQL user, database, and schema. The startup probe uses `/healthz` with a
  60-second initial delay to allow this.
- **Asset storage path matters.** `HA_STORAGE_PATH=/wiki-storage` tells Wiki.js where
  to write uploads. The NFS or GCS Fuse volume must be mounted at the same path.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Wiki.js workload

Wiki.js pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Wiki.js workload to see
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

Wiki.js stores all application data (pages, users, navigation, search index) in a
managed Cloud SQL for PostgreSQL 15 instance. The `pg_trgm` extension is installed
at provisioning time and powers Wiki.js's native full-text search. Pods reach the
database privately through the **Cloud SQL Auth Proxy** sidecar over a Unix socket,
so no public IP is exposed. On first deploy an initialization Job creates the
application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
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

### C. Filestore (NFS) and Cloud Storage

Uploaded assets are written to a **Filestore (NFS)** share mounted into every pod so
all replicas see the same files. A dedicated **Cloud Storage** bucket (`wikijs-storage`)
is also provisioned for persistent asset storage; it can be mounted at `/wiki-storage`
via the GCS Fuse CSI driver.

- **Console:** Filestore → Instances for the NFS share; Cloud Storage → Buckets for
  the storage bucket.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/       # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### D. Redis cache (optional)

Redis is disabled by default. When enabled, it provides session caching across
replicas. Set `enable_redis = true` and supply `redis_host` to activate.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

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

### F. Networking & ingress

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

## 3. Wiki.js Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) uses the
  `postgres:15-alpine` image to connect through the Cloud SQL Auth Proxy, idempotently
  create the `wikijs` database and user, and grant the required privileges. The
  `pg_trgm` PostgreSQL extension is then installed by the foundation as part of the
  `enable_postgres_extensions = true` / `postgres_extensions = ["pg_trgm"]`
  configuration supplied by `Wikijs_Common`. The job is safe to re-run.
- **Schema migration on first start.** Wiki.js connects to PostgreSQL on startup and
  runs its own internal schema migration. This is why the startup probe carries a
  60-second initial delay — allow time for the database schema to be fully initialised
  before health checks begin.
- **Asset storage path.** Wiki.js writes uploaded files to the path set by
  `HA_STORAGE_PATH` (default `/wiki-storage`). The NFS mount path and this variable
  must point to the same physical location. With `enable_nfs = true`, mount the NFS
  share at `/wiki-storage` or change `nfs_mount_path` and `HA_STORAGE_PATH` together.
- **Health endpoint.** Both the startup and liveness probes use `/healthz`, which
  returns HTTP 200 only once Wiki.js is running and connected to PostgreSQL. Do not
  replace this with `/` — the UI path is slow to render and may return errors during
  startup.
- **Session affinity.** `session_affinity = "ClientIP"` is the default. Wiki.js
  maintains in-memory session context; sticky routing keeps a browser session on the
  same pod.
- **Redis is optional.** Wiki.js does not require Redis for core operation. Enable it
  when you want application-level session caching in multi-replica deployments.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Wiki.js are listed; every other input is
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
| `application_name` | `wikijs` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Wiki.js` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `2.5.311` | Wiki.js image version tag; increment to roll out a new version. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds via Cloud Build; `prebuilt` uses an existing image URI. |
| `container_image` | `requarks/wiki:2` | Upstream Docker Hub image used as the Cloud Build base. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | Resource requests/limits per pod. |
| `container_port` | `3000` | Wiki.js Node.js server port — do not change. |
| `min_instance_count` | `1` | Minimum replicas (keep ≥ 1 to avoid cold starts). |
| `max_instance_count` | `3` | Maximum replicas (autoscaler ceiling). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for Unix socket connections. |
| `enable_image_mirroring` | `true` | Mirror `requarks/wiki:2` from Docker Hub into Artifact Registry. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{ DB_TYPE="postgres", DB_PORT="5432", DB_USER="wikijs", DB_NAME="wikijs", DB_SSL="false", HA_STORAGE_PATH="/wiki-storage" }` | Pre-populated with Wiki.js DB connectivity settings. Core values — do not remove. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. `DB_PASS` is wired automatically. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing for in-memory session context. |
| `workload_type` | `null` | Auto-resolves to Deployment; set `StatefulSet` for per-pod storage. |
| `network_tags` | `["nfsserver"]` | Required for NFS connectivity — do not remove. |

### Group 7 — StatefulSet Configuration

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable PVC templates in a StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Storage size per PVC. |
| `stateful_pvc_mount_path` | `/data` | Mount path inside each pod. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block all scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 if you need eviction headroom. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/healthz`, 60 s initial delay | Startup probe — generous delay for first-boot DB migration. |
| `health_check_config` | HTTP `/healthz`, 60 s initial delay | Liveness probe. |
| `uptime_check_config` | enabled, path `/` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job from `Wikijs_Common`. |
| `cron_jobs` | `[]` | Recurring Kubernetes CronJobs (e.g. scheduled exports or backups). |
| `additional_services` | `[]` | Sidecar or helper Deployments alongside Wiki.js. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for Wiki.js assets (keep enabled for multi-replica). |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container — must align with `HA_STORAGE_PATH`. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the storage bucket. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional GCS buckets beyond the `wikijs-storage` bucket. |
| `gcs_volumes` | `[]` | Mount the `wikijs-storage` bucket via GCS Fuse at `/wiki-storage`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis for session caching (optional for Wiki.js). |
| `redis_host` | `""` | Redis endpoint — required when `enable_redis = true`. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — do not change. Wiki.js requires PostgreSQL. |
| `application_database_name` | `wikijs` | Database name. Immutable after first deploy; must match `DB_NAME`. |
| `application_database_user` | `wikijs` | Application user. Immutable after first deploy; must match `DB_USER`. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_postgres_extensions` | `true` | Install extensions — required for `pg_trgm`. |
| `postgres_extensions` | `["pg_trgm"]` | Required for full-text search. Do not remove. |
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
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Wiki.js. |
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
| `service_url` | URL to reach Wiki.js. |
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
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | GitHub repo details. |
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
| `database_type` | `POSTGRES_15` | Critical | Wiki.js requires PostgreSQL; MySQL/`NONE` breaks startup. |
| `application_database_name` / `DB_NAME` | both `wikijs` | Critical | Mismatch: `db-init` creates a different database than Wiki.js connects to — crash loop. Immutable after first deploy. |
| `enable_postgres_extensions` / `postgres_extensions` | `true` / `["pg_trgm"]` | Critical | Removing `pg_trgm` disables all full-text search with a function-not-found error. |
| `quota_memory_requests` / `_limits` | binary units (`Gi`, `Mi`) | Critical | Bare integers are bytes — blocks all pod scheduling. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_file` fails the import job. |
| `enable_cloudsql_volume` | `true` | Critical | Disabling removes the Auth Proxy sidecar — all PostgreSQL connections fail. |
| `application_database_user` / `DB_USER` | both `wikijs` | High | Mismatch: grants are created for one user but Wiki.js authenticates as another — auth failure. |
| `enable_nfs` | `true` | High | Without shared storage, uploads written by one pod are invisible to others and lost on restart. |
| `nfs_mount_path` + `HA_STORAGE_PATH` | both `/wiki-storage` | High | If the NFS mount path and `HA_STORAGE_PATH` disagree, Wiki.js writes to the pod's ephemeral disk. |
| `container_resources.memory_limit` | `2Gi` | High | Below `1Gi` Wiki.js is OOM-killed on startup or under load. |
| `startup_probe_config.initial_delay_seconds` | `60` | High | Too low — Wiki.js is killed before first-boot schema migration completes. |
| `min_instance_count` | `1` | High | Scale-to-zero causes 15–30 s cold starts and in-flight DB reconnection. |
| `session_affinity` | `ClientIP` | High | Without stickiness, multi-replica deployments lose in-memory session context. |
| `application_version` | `2.5.311` | High | Wiki.js 2.x and 3.x have incompatible schemas. Test upgrades in staging. |
| `network_tags` | `["nfsserver"]` | High | Removing the tag breaks the NFS firewall rule — mount fails. |
| `enable_iap` / `enable_cloud_armor` | enable for internal wikis | Medium | The Wiki.js login page is otherwise publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |
| `enable_redis` | `false` unless needed | Low | Wiki.js does not require Redis for core operation. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Wiki.js-specific
application configuration shared with the Cloud Run variant is described in
**[Wikijs_Common](Wikijs_Common.md)**.
