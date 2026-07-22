---
title: "NetBox on GKE Autopilot"
description: "Configuration reference for deploying NetBox on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# NetBox on GKE Autopilot

NetBox is the industry-standard open-source "source of truth" for network
engineering teams — IP address management (IPAM), device and rack inventory,
cabling, and network topology, all modeled as structured data behind a full
REST/GraphQL API. This module deploys NetBox on **GKE Autopilot** on top of
the [App_GKE](App_GKE.md) foundation, which provisions and manages the
shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services NetBox uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

NetBox runs as a custom-built Python/Django pod on GKE Autopilot, wrapping the
official `netboxcommunity/netbox` image with a co-located background
`rqworker --with-scheduler` process. The deployment wires together a focused
set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Custom-built image pods, 2 vCPU / 2 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — NetBox does not support MySQL or SQLite in production |
| Object storage | Cloud Storage (GCS Fuse CSI) | A `media` bucket mounted at `/etc/netbox/media`, NetBox's real `MEDIA_ROOT` |
| Cache & queue | Redis (mandatory) | Task queue (`REDIS_DATABASE=0`) and cache (`REDIS_CACHE_DATABASE=1`) on separate logical databases; defaults to the NFS server IP |
| Secrets | Secret Manager | Auto-generated `SECRET_KEY` and `SUPERUSER_PASSWORD`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer by default; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; NetBox does not support MySQL or SQLite for production use.
- **Redis is mandatory, not optional.** NetBox uses Redis as the broker for its
  RQ (Redis Queue) background task system — webhooks, custom scripts, reports,
  and scheduled/system jobs — and as its cache backend, on **two separate
  logical databases** (`REDIS_DATABASE=0`, `REDIS_CACHE_DATABASE=1`).
- **A background worker is co-located in the same pod.** `manage.py rqworker
  --with-scheduler` runs as a backgrounded process alongside the Granian web
  server. Without it, background tasks queue silently and never execute.
- **Media uploads are mounted at NetBox's actual `MEDIA_ROOT`.** `/etc/netbox/media`,
  confirmed live via `manage.py shell`. See §3 for the full story of how this
  path was found and why an earlier, plausible-looking path was wrong.
- **The GCS Fuse mount's `uid=0`/`gid=0` options are load-bearing on GKE.**
  Cloud Run's own GCS Fuse integration always applies a default `uid:1000/gid:1000`
  regardless of what's configured (root can write into it anyway); GKE's GCS
  Fuse CSI driver has no such default, so the explicit `uid=0`/`gid=0` pin —
  matching NetBox's root-running container — is what actually makes the mount
  writable.
- **No scale-to-zero.** GKE Autopilot always runs at least `min_instance_count`
  (default `1`) replicas, keeping the RQ worker continuously active.
- **The container runs as root** (uid 0 / gid 0) — the official
  `netboxcommunity/netbox` image sets no `USER`.
- **`SECRET_KEY` and `SUPERUSER_PASSWORD` are generated automatically** and
  stored in Secret Manager.
- **Health checks use `/login/`, not `/api/status/`.** The login page is public
  and unauthenticated; the status API requires auth and would fail every probe.
- **`service_type = "LoadBalancer"` and `reserve_static_ip = true` are the
  defaults** — public by default. Switch to `service_type = "ClusterIP"` and
  `reserve_static_ip = false` for an internal-only deployment reachable via
  `kubectl port-forward` (useful when the project's static-IP quota is tight).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the NetBox workload

NetBox pods are scheduled on Autopilot, which bills for the CPU/memory the
pods actually request. Horizontal Pod Autoscaling sizes the deployment
between the minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the NetBox workload to
  see pods, revisions, and events. Kubernetes Engine → Services & Ingress
  shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

NetBox stores all inventory and IPAM data (devices, racks, IP addresses,
prefixes, VLANs, circuits, users) in a managed Cloud SQL for PostgreSQL 15
instance. Pods reach it privately through the **Cloud SQL Auth Proxy** sidecar
over a Unix socket (surfaced to the container as loopback `127.0.0.1`); no
public IP is exposed. On first deploy an initialization Job creates the
application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding
the password are all surfaced in the [Outputs](#5-outputs). For the connection
model, automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Storage (GCS Fuse media store)

A dedicated `media` bucket is provisioned automatically and mounted via the
GCS Fuse CSI driver at `/etc/netbox/media` — NetBox's real `MEDIA_ROOT` — for
uploaded device/rack images and file attachments. The mount is pinned to
`uid=0`/`gid=0` to match the container's root user; without this, the GKE CSI
driver's default mount ownership blocks writes.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  # Verify a real upload landed in GCS (not just the pod's local filesystem):
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /etc/netbox/media
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mount tuning.

### D. Redis (task queue and cache)

Redis is **required** (`enable_redis = true` by default). When `redis_host` is
left empty and `enable_nfs` is true, the NFS server VM's IP is used as the
Redis endpoint. NetBox splits its usage across two logical databases —
`REDIS_DATABASE=0` for the RQ task queue, `REDIS_CACHE_DATABASE=1` for the
cache.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> -n 0 llen rq:queue:default   # inspect the RQ default queue depth
  # Confirm the resolved Redis host injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS_
  ```

### E. Secret Manager

Two cryptographic secrets are generated automatically and stored in Secret
Manager: `SECRET_KEY` (Django cryptographic secret used for sessions, CSRF,
and signed cookies) and `SUPERUSER_PASSWORD` (the initial admin account
password). The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing
IP. A custom domain with a Google-managed certificate can be enabled, and a
static IP can be reserved so the address survives redeploys. For an
internal-only deployment (e.g. when static-IP quota is constrained), switch
`service_type = "ClusterIP"` and `reserve_static_ip = false`, then reach the
service with `kubectl port-forward`.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  # Internal-only access:
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 18080:8080
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to
Cloud Monitoring. Optional uptime checks and alert policies are available
(uptime checks require a publicly reachable endpoint).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. NetBox Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and
  idempotently creates the application database and user and grants
  privileges. The job is safe to re-run.
- **Database migrations on start.** `docker-entrypoint.sh true` runs NetBox's
  own first-boot sequence synchronously on every container start — DB-readiness
  wait, `migrate --no-input`, stale-contenttype cleanup, session cleanup, and a
  lazy search-index reindex — before the web server and RQ worker start.
- **Superuser bootstrap is idempotent.** The initial admin account is created
  from `SUPERUSER_*` env vars on first boot; creation is skipped — not an
  error — if a user with that name already exists.
- **Media uploads persist to the real `MEDIA_ROOT` — and this is where `kubectl
  exec` earned its keep.** NetBox's actual `MEDIA_ROOT` is `/etc/netbox/media`
  (confirmed via `manage.py shell` on a live pod), which is where the GCS Fuse
  `media` volume is mounted. Before this was traced, uploads on both platforms
  looked like they worked — a `201`, and the file was even readable back
  through the app immediately — but `gcloud storage ls` against the backing
  bucket showed **zero objects**, even 50+ minutes after upload. A control test
  ruled out gcsfuse write-latency and multi-worker contention. Getting real
  shell access into the running pod (`kubectl exec ... manage.py shell` to
  print NetBox's own resolved `MEDIA_ROOT` setting) is what actually cracked
  it: the module was mounting the GCS bucket at a different, plausible-looking
  path (`/opt/netbox/netbox/media`) than the one NetBox's own `configuration.py`
  actually writes to. Every upload was silently landing on the pod's ephemeral
  local filesystem — readable back immediately because reader and writer were
  the same local disk, but never durable, and gone on the next restart. Fixed
  by correcting the mount path; re-verified live with `gcloud storage ls`
  showing the uploaded test file with correct byte size, content type, and
  timestamp within 5 seconds. **This is not a Cloud Run/GKE platform gap** —
  the identical bug existed on both platforms, and Cloud Run offers no shell
  access to diagnose it the way GKE's `kubectl exec` does; had this only been
  tested on Cloud Run, it would have looked exactly like an unfixable
  platform limitation.
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    /opt/netbox/venv/bin/python /opt/netbox/netbox/manage.py shell \
    -c "from django.conf import settings; print(settings.MEDIA_ROOT)"
  ```
- **The RQ worker processes background tasks.** Webhooks, custom scripts,
  reports, and scheduled/system jobs are executed by `manage.py rqworker
  --with-scheduler`, co-located in the same pod as the web server. Unlike
  Cloud Run, GKE keeps at least `min_instance_count` pods running continuously
  (no scale-to-zero), so the worker is always active by default.
- **Health path.** Startup and liveness probes target `/login/` — NetBox's
  public, unauthenticated login page. `/api/status/` requires authentication
  and would fail every probe.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for NetBox are listed; every other input is
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
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `netbox` | Base name for resources. Do not change after first deploy. |
| `display_name` | `NetBox - Network Documentation & IPAM` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Container image version tag, passed through to the Dockerfile's `APPLICATION_VERSION` build ARG. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per pod; shared by the web server and the RQ worker. |
| `memory_limit` | `2Gi` | Memory per pod. |
| `container_port` | `8080` | NetBox's Granian (WSGI) server listens on port 8080. |
| `min_instance_count` | `1` | Minimum replicas; GKE has no scale-to-zero. |
| `max_instance_count` | `3` | Maximum replicas. |
| `enable_vertical_pod_autoscaling` | `false` | Disables HPA when enabled to avoid conflicts. |
| `enable_pod_disruption_budget` / `pdb_min_available` | `false` / `1` | Availability protection during node maintenance. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar. |
| `enable_image_mirroring` | `true` | Mirror the built image into Artifact Registry. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not set `SECRET_KEY`, `SUPERUSER_PASSWORD`, or `DB_*` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. Use `ClusterIP` for internal-only. |
| `workload_type` | `Deployment` (auto) | `Deployment` (default stateless) or `StatefulSet`. |
| `session_affinity` | `ClientIP` | Sticky routing for UI sessions. |
| `network_tags` | `["nfsserver"]` | Required when `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Seconds to wait after SIGTERM before SIGKILL. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |
| `gke_cluster_name` / `namespace_name` | auto-discover | Leave empty to auto-discover / auto-generate. |
| `deployment_timeout` | `1800` | Max seconds Terraform waits for the rollout. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Enable per-pod PVC templates. Not needed — NetBox's persistent state is Cloud SQL + GCS. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` / `stateful_pvc_storage_class` | (defaults) | PVC sizing, mount path, StorageClass. |
| `stateful_headless_service` | `true` | Stable pod DNS names. |
| `stateful_pod_management_policy` | `OrderedReady` | `OrderedReady` or `Parallel`. |
| `stateful_update_strategy` | `RollingUpdate` | `RollingUpdate` or `OnDelete`. |

### Group 8 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — run SQL from a GCS
bucket after provisioning. See [App_GKE](App_GKE.md).

### Group 11 — Jobs & Services

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs. |
| `additional_services` | `[]` | Additional Kubernetes Services deployed alongside NetBox. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisions Filestore; used as the Redis host when `redis_host` is blank. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `nfs_volume_name` | `nfs-data-volume` | Kubernetes volume name for the NFS mount. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create additional GCS buckets beyond the auto-provisioned media bucket. |
| `storage_buckets` | `[]` | Additional buckets to provision. |
| `gcs_volumes` | `[]` | GCS Fuse CSI mounts. When empty, a default media volume is auto-mounted at `/etc/netbox/media` with explicit `uid=0`/`gid=0` options — load-bearing on GKE, unlike Cloud Run. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Artifact Registry cleanup policy. |

### Group 15 — NetBox Application Settings

| Variable | Default | Description |
|---|---|---|
| `time_zone` | `UTC` | Timezone for NetBox timestamps and scheduled tasks. |
| `admin_user` | `admin` | Username for the auto-created superuser. Creation is idempotent. |
| `admin_email` | `admin@example.com` | Email for the auto-created superuser. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `netbox` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `netbox` | Application database user. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off / `90` | Zero-downtime DB password rotation. |
| `enable_mysql_plugins` / `mysql_plugins` | `false` / `[]` | Not applicable — NetBox uses PostgreSQL. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Gateway API routing + managed SSL certificate for custom hostnames. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. Set `false` (with `service_type = "ClusterIP"`) for an internal-only, no-external-IP deployment. |
| `static_ip_name` | `""` | Leave empty to auto-generate. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of NetBox. Requires `enable_custom_domain = true`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 21 — Cloud Armor & Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | `default-waf-policy` | Policy name. |
| `enable_cdn` | `false` | Enable Cloud CDN on the GKE Ingress backend. |
| `enable_redis` | `true` | **Required.** Backs NetBox's RQ task queue and cache layer. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

### Observability & Health (NetBox-specific, superseding the generic App_GKE probes)

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/login/`, 60s delay, 60 failure threshold | NetBox-specific startup probe. |
| `liveness_probe` | HTTP `/login/`, 30s failure window | NetBox-specific liveness probe. |
| `uptime_check_config` | _(set)_ | Optional Cloud Monitoring uptime check — only meaningful when the service is publicly reachable. |
| `alert_policies` | `[]` | Optional metric alert policies. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way
to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (`127.0.0.1` via the Auth Proxy) / port. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, an out-of-range `redis_port`/`backup_retention_days`, bare-integer `quota_memory_*` values. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `gcs_volumes` mount path (auto-set to `/etc/netbox/media`) | Never override to a different path unless you've confirmed NetBox's real `MEDIA_ROOT` | Critical | A wrong mount path leaves uploads on the ephemeral pod filesystem — readable back immediately, but silently lost on every restart. Confirmed and fixed on this exact module. |
| GCS Fuse mount `uid`/`gid` (auto-set to `0`/`0`) | Match the container's actual runtime UID | Critical | On GKE (unlike Cloud Run), an unpinned mount is root-owned by default; a non-root process would get `EACCES` on every write. NetBox's container already runs as root, so this is applied defensively. |
| `SECRET_KEY` (auto-generated) | Never rotate after first boot | Critical | Invalidates all active sessions and signed cookies; NetBox also enforces a minimum 50-character length. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `enable_redis` | `true` (mandatory) | Critical | NetBox's background task system and cache layer do not function without Redis. |
| `redis_host` | `""` (NFS) or explicit | High | When Redis is on but NFS is off and no host is set, background processing silently never runs. |
| `REDIS_DATABASE` / `REDIS_CACHE_DATABASE` | Keep separate (`0` / `1`) | High | Sharing one logical Redis database risks losing queued background tasks during a cache flush. |
| `memory_limit` | `2Gi` | High | Values below 1Gi risk OOM kills, especially with the RQ worker co-located in the same pod. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; keeping it at 1 ensures NetBox and the RQ worker are always available. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity. |
| `service_type` / `reserve_static_ip` | Public by default; `ClusterIP`/`false` for internal-only | Medium | Switching to internal-only trades public reachability for lower static-IP quota consumption — verify which is actually needed before deploy. |
| `session_affinity` | `ClientIP` | Medium | Without stickiness, in-flight UI sessions can route to a different pod mid-request. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_pod_disruption_budget` | `true` for production | Medium | Disabled by default; without it, GKE can evict all pods simultaneously during node maintenance. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. NetBox-specific application configuration shared
with the Cloud Run variant is described in **[Netbox_Common](Netbox_Common.md)**.
