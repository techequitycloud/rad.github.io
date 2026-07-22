---
title: "Sample Application on GKE Autopilot"
description: "Configuration reference for deploying Sample Application on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Sample Application on GKE Autopilot

The Sample module is a reference implementation that demonstrates how application modules
are built on this platform. It deploys a minimal Flask web application (Python 3.11,
PostgreSQL 15, optional Redis, optional NFS) on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud
and Kubernetes infrastructure.

This guide focuses on the cloud services the Sample application uses and how to explore
and operate them from the Google Cloud Console and the command line. For the mechanics
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment
lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating
them here.

---

## 1. Overview

The Sample application runs as a Python/Gunicorn web workload. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Flask/Gunicorn pods, 1 vCPU / 512 MiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required; the `db-init` job creates the schema on first deploy |
| Shared files | Filestore (NFS) | Enabled by default; shared volume mounted at `/mnt/nfs` |
| Object storage | Cloud Storage | A single `data` bucket provisioned by default |
| Cache & sessions | Redis | Optional (`enable_redis = false` by default); when enabled, an internal `redis:alpine` sidecar is deployed |
| Secrets | Secret Manager | Auto-generated Flask `SECRET_KEY` stored at deploy time |
| Ingress | Cloud Load Balancing | External LoadBalancer Service; optional custom domain + Gateway API |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is fixed.** The database engine is set to `POSTGRES_15` by
  `Sample_Common` and cannot be changed to MySQL or `NONE` in this module.
- **A `db-init` job runs on every first deploy** to create the PostgreSQL database,
  user, and schema. It is idempotent and safe to re-run.
- **Redis is disabled by default.** When `enable_redis = true` and `redis_host` is
  empty, the module automatically deploys an internal `redis:alpine` sidecar and sets
  `REDIS_HOST=127.0.0.1`.
- **The Flask `SECRET_KEY` is auto-generated** and stored in Secret Manager; it is
  never set in plain text.
- **`min_instance_count` is overridden to `1` internally.** Even if you set it to `0`,
  the module keeps at least one pod running to avoid cold-start delays on GKE.
- **Health probes default to TCP/root, not `/healthz`.** `startup_probe_config`
  defaults to a bare TCP check (only `enabled = true` is set; type/path fall back to
  the foundation's TCP/`/` defaults) and `health_check_config` (liveness) defaults to
  `HTTP GET /` — the same visitor-counter route as the root page. The Flask app also
  exposes a lightweight `/healthz` endpoint (HTTP GET, returns
  `{"status": "healthy"}`, no DB query); set the probe `path` to `/healthz` to use it.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Sample workload

The Flask application pods are scheduled on Autopilot, which bills for the CPU/memory
the pods actually request. Horizontal Pod Autoscaling sizes the deployment between the
minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Sample workload for pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

The Sample application stores its visitor counter in a managed Cloud SQL for PostgreSQL
15 instance. Pods reach it privately through the **Cloud SQL Auth Proxy** sidecar over a
Unix socket, so no public IP is exposed. On first deploy an initialization Job creates
the application database, user, and grants privileges.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Filestore (NFS) and Cloud Storage

When `enable_nfs = true` (the default), a **Filestore (NFS)** share is mounted into
every pod at `/mnt/nfs` so all replicas see the same files. A dedicated **Cloud Storage**
bucket is also provisioned; the workload service account is granted access automatically.

- **Console:** Filestore → Instances for the NFS share; Cloud Storage → Buckets for the
  data bucket.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### D. Redis cache (optional)

When `enable_redis = true`, an internal `redis:alpine` service is deployed alongside
the application. The Flask app uses it for server-side session storage via
`Flask-Session`. The environment variables `ENABLE_REDIS`, `REDIS_HOST`, and
`REDIS_PORT` are injected automatically.

- **Console:** Kubernetes Engine → Workloads — the Redis Deployment appears alongside
  the main application workload in the same namespace.
- **CLI:**
  ```bash
  kubectl get deployments -n "$NAMESPACE"
  # Confirm Redis env vars are injected in the app container:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  # Test Redis connectivity from within the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- redis-cli -h 127.0.0.1 ping
  ```

### E. Secret Manager

The Flask `SECRET_KEY` is auto-generated on first deploy and stored as a Secret Manager
secret. The database password is also managed in Secret Manager by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP via a
Kubernetes `LoadBalancer` Service. A custom domain with Gateway API and a static IP can
be enabled.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static
IP details.

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

## 3. Sample Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` (using the
  `postgres:15-alpine` image) which idempotently creates the PostgreSQL database user,
  database, and grants privileges before the application starts.
- **Health probes.** By default `startup_probe_config` resolves to a plain TCP check
  and `health_check_config` (liveness) resolves to `GET /` — the same route that
  increments the visitor counter, so the default liveness probe issues a database
  write on every check. The Flask app also serves a lightweight `GET /healthz`
  (returns `{"status": "healthy"}`, no database query); point `health_check_config.path`
  (and `startup_probe_config.path` with `type = "HTTP"`) at it to avoid the extra load.
- **Visitor counter.** The root route (`GET /`) increments a persistent counter stored
  in the PostgreSQL `visitors` table. It demonstrates both database connectivity and
  (when Redis is enabled) per-session tracking.
- **Database diagnostics.** `GET /db` executes `SELECT version()` and returns the
  PostgreSQL version string — useful for quickly verifying end-to-end database
  connectivity.
- **Redis session handling.** When `enable_redis = true` and a Redis host is reachable,
  the Flask app uses `Flask-Session` with a Redis backend. When Redis is disabled or
  `REDIS_HOST` is empty, sessions fall back to signed cookies.
- **Flask `SECRET_KEY`.** The auto-generated key is retrieved from Secret Manager and
  injected as the `SECRET_KEY` environment variable at pod startup. It is used for
  session signing and CSRF protection.
- **Inspect running pods:**
  ```bash
  kubectl get pods -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" <pod-name>
  kubectl exec -n "$NAMESPACE" <pod-name> -- env | grep -E 'DB_|SECRET|REDIS'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Sample_GKE are listed; every other input is inherited from
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
| `application_name` | `sample` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Sample Application` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `latest` | Container image version tag; increment to trigger a new build and rollout. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `"custom"` builds the Flask image via Cloud Build; `"prebuilt"` deploys an existing image. |
| `container_image` | `""` | Override image URI. Leave empty for the auto-derived Artifact Registry path. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | CPU and memory limits per pod. |
| `min_instance_count` | `0` (overridden to `1` internally) | Minimum replicas. The module always keeps at least 1 pod warm. |
| `max_instance_count` | `3` | Maximum replicas (autoscaler ceiling). |
| `container_port` | `8080` | Flask/Gunicorn listens on port 8080. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings merged with the module defaults. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `Deployment` | `"Deployment"` (stateless) or `"StatefulSet"`. |
| `session_affinity` | `ClientIP` | Sticky routing — recommended when Redis session storage is used. |
| `network_tags` | `["nfsserver"]` | Node/pod tags; `nfsserver` is required for NFS connectivity. |
| `gke_cluster_name` | `""` | Leave empty to auto-discover the Services_GCP-managed cluster. |
| `namespace_name` | `""` | Leave empty to auto-generate from application name and tenant ID. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Provision per-pod PVCs (only meaningful when `workload_type = "StatefulSet"`). |
| `stateful_pvc_size` | `10Gi` | PVC size per pod. |
| `stateful_pvc_mount_path` | `/data` | Container path for the PVC mount. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |
| `stateful_headless_service` | `true` | Create a headless Service for stable pod DNS. |
| `stateful_pod_management_policy` | `OrderedReady` | Pod creation/deletion order. |
| `stateful_update_strategy` | `RollingUpdate` | Rolling or OnDelete update strategy. |

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
| `startup_probe_config` | `{ enabled = true }` → TCP, path `/`, 240s timeout/period | Probe used to gate pod traffic on startup; only `enabled` is set, so type/path/timeouts fall back to the foundation TCP defaults. |
| `health_check_config` | `{ enabled = true }` → HTTP `GET /`, 10s period | Ongoing liveness probe; defaults to the root (visitor-counter) route — set `path = "/healthz"` for a DB-free check. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job from `Sample_Common`. |
| `cron_jobs` | `[]` | Recurring Kubernetes CronJobs. |
| `additional_services` | `[]` | Extra sidecar or helper services. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume mounted at `nfs_mount_path`. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `nfs_instance_name` | `""` | Name of an existing NFS VM; leave empty for auto-discovery. |
| `nfs_instance_base_name` | `app-nfs` | Base name for an inline NFS VM when none exists. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the `data` bucket. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional buckets to provision. |
| `gcs_volumes` | `[]` | GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` | `7` | Keep only the N most recent container images. |
| `delete_untagged_images` | `true` | Automatically remove untagged images. |
| `image_retention_days` | `30` | Delete images older than this many days. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Deploy an internal Redis sidecar and enable session storage. |
| `redis_host` | `""` | Leave empty to use the auto-deployed sidecar at `127.0.0.1`; set explicitly for an external instance. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES` (resolved to `POSTGRES_15` by `Sample_Common`) | Fixed — do not change. |
| `application_database_name` | `sampledb` | Database name. Immutable after first deploy. |
| `application_database_user` | `sampleuser` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `enable_postgres_extensions` | `false` | Install PostgreSQL extensions after provisioning. |
| `postgres_extensions` | `[]` | List of PostgreSQL extensions to install (e.g., `uuid-ossp`). |

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
| `enable_custom_domain` | `false` | Provision Gateway API Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `network_tags` | `["nfsserver"]` | GKE node/pod network tags for firewall rules. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of the application. |
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
| `stage_service_cluster_ips` | Map of ClusterIPs for Cloud Deploy stage services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach the Sample application. |
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
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Connected GitHub repo details. |
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
| `database_type` | `POSTGRES` / `POSTGRES_15` | Critical | PostgreSQL 15 is fixed by `Sample_Common`; changing to MySQL or `NONE` breaks the `db-init` job and startup. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys data. |
| `application_name` | set once | Critical | Embedded in resource names and Secret Manager secret IDs. Changing after deploy orphans existing secrets and rebuilds all named resources. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling. |
| `container_port` | `8080` | Critical | Mismatch causes the startup probe to fail — pod never enters Ready state. |
| `startup_probe_config` / `health_check_config` path | `/healthz` for a DB-free check | Medium | The defaults (TCP `/` startup, HTTP `GET /` liveness) hit the visitor-counter route, adding a database write to every liveness check. |
| `enable_cloudsql_volume` | `true` | Critical | `false` with a PostgreSQL database: all DB connections fail at startup. The `db-init` job also fails. |
| `enable_nfs` | `true` with `network_tags = ["nfsserver"]` | High | Removing `nfsserver` from the network tags breaks the NFS firewall rule and prevents mounts. |
| `enable_redis` | `false` (default) | High | `true` without a reachable `redis_host` (or with NFS off): the Flask app logs a warning and falls back to cookies; no outright crash, but session storage silently degrades. |
| `max_instance_count` | `1` for dev; increase with DB connection pool headroom | High | Exceeding Cloud SQL connection limit: all pods fail DB queries simultaneously. |
| `container_resources.memory_limit` | `512Mi` or more | High | Less than `~128Mi` causes Flask to be OOM-killed on startup when loading client libraries. |
| `enable_iap` / `enable_cloud_armor` | enable for production | Medium | The application is otherwise publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |
| `enable_vpc_sc` with `vpc_sc_dry_run = false` | test in dry-run first | Critical | If any SA or IP is missing from the access level, all GKE API calls fail simultaneously. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. The shared
application configuration (Flask secret, database bootstrap, probe behaviour, and Redis
sidecar) is described in **[Sample_Common](Sample_Common.md)**.
