---
title: "Wallos on GKE Autopilot"
description: "Configuration reference for deploying Wallos on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Wallos on GKE Autopilot

Wallos is an open-source, self-hosted subscription and recurring-expense tracker
built on plain PHP 8.3 + php-fpm (no MVC framework). It tracks recurring
subscriptions, converts prices across currencies, sends renewal notifications, and
supports a household multi-user mode. This module deploys Wallos on **GKE
Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and
manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Wallos uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

Wallos runs as a single PHP/php-fpm web workload. It is deliberately minimal — no
SQL database, no cache, no queue — but it DOES run a real, always-on cron daemon,
which drives several of the defaults below:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single PHP pod, 1 vCPU / 1 GiB by default; `min = max = 1` (always-on, never scale to zero) |
| Persistent state (database) | HDD block PVC (default) or Cloud Storage (GCS FUSE) | Mounted at `/var/www/html/db`; holds the SQLite database file |
| Persistent state (uploads) | Cloud Storage (GCS FUSE), always | Mounted at `/var/www/html/images/uploads/logos`; a StatefulSet PVC only supports one mount_path, spent on the database |
| Database | None (embedded SQLite) | `database_type = NONE`; no Cloud SQL is provisioned; confirmed no MySQL/Postgres support exists anywhere in the app |
| Cache & queue | None | Wallos uses no Redis |
| Secrets | Secret Manager | No app secrets generated; users live in the SQLite DB |
| Ingress | Cloud Load Balancing | `LoadBalancer` Service by default (Wallos is a browser-driven web UI); custom domain + managed certificate available |
| Background jobs | In-container cron daemon | 8 baked-in scheduled tasks (exchange-rate refresh, renewal notifications, an email-verification poll every 2 minutes, etc.) — runs continuously inside the main pod, not as a separate CronJob |

**Sensible defaults worth knowing up front:**

- **Two independent persistent paths, no relocation env var for either.** Wallos
  has no Cloud SQL database. Its SQLite database lives at
  `/var/www/html/db/wallos.db`; user-uploaded custom provider logos live
  separately at `/var/www/html/images/uploads/logos`. Neither path can be
  relocated via an environment variable.
- **HDD block PVC by default for the database.** `stateful_pvc_enabled = true`
  (default) runs the workload as a **StatefulSet** with a per-pod PVC (default
  `10Gi`, StorageClass **`standard`** — HDD `pd-standard`, not SSD) mounted at
  `/var/www/html/db`; the GCS FUSE volume for that same path is automatically
  disabled to avoid a double-mount. HDD is deliberate: SQLite needs write-locking
  correctness, not IOPS, and HDD draws from the much larger `DISKS_TOTAL_GB` quota
  instead of the tight `SSD_TOTAL_GB` quota. The uploads path always uses GCS FUSE
  regardless, since only one PVC mount_path is available.
- **CRITICAL — single always-on replica, not just cold-start tuning.**
  `min_instance_count = max_instance_count = 1`. Wallos's SQLite database has no
  multi-writer support (so `max = 1` is required), and its baked-in cron daemon
  only fires scheduled tasks while a pod is actually running (so `min = 1` is
  required). Scaling to zero silently stops every scheduled task with no error.
- **Default login is `admin` / `admin`.** Wallos seeds this on first boot;
  change it in the web UI immediately after deploy.
- **No Redis, no init job.** `enable_redis = false` and no `db-init` job runs; the
  pod is ready as soon as the container starts.
- **Container port 80.** Wallos serves plain HTTP/1.1 on port 80.
- **Public-facing by default.** `service_type = "LoadBalancer"` — Wallos is a
  browser-driven web UI, not an internal service. `enable_custom_domain = true`
  and `reserve_static_ip = true` let you serve a custom hostname with a
  Google-managed certificate.
- **Prebuilt image.** `bellamy/wallos` is a genuine, third-party-maintained
  "latest"-tagged image (there is no official Wallos-project image); no
  Dockerfile or Cloud Build step is used. `container_image_source = "prebuilt"`
  is explicitly forwarded to the foundation.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Wallos workload

Wallos runs as a single-replica StatefulSet (the default, since
`stateful_pvc_enabled = true`) or a Deployment (if the PVC is disabled) scheduled
on Autopilot, which bills for the CPU/memory the pod actually requests.

- **Console:** Kubernetes Engine → Workloads → select the Wallos workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  Service and any external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl get statefulset,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Cloud Storage & block PVC — persistent state

Wallos has no Cloud SQL database. Its two persistent paths are backed
differently:

- **Database (`/var/www/html/db/wallos.db`):** by default a block
  **PersistentVolumeClaim** (`stateful_pvc_enabled = true`, `10Gi`, StorageClass
  `standard` / HDD); if the PVC is disabled, a dedicated **Cloud Storage** bucket
  mounted via GCS FUSE through the CSI driver instead.
- **Uploads (`/var/www/html/images/uploads/logos`):** always a dedicated
  **Cloud Storage** bucket mounted via GCS FUSE, regardless of the PVC setting.

- **Console:** Cloud Storage → Buckets; or Kubernetes Engine → Storage → PVCs.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~wallos"
  kubectl get pvc -n "$NAMESPACE"                              # database PVC (default layout)
  gcloud storage ls gs://<uploads-bucket>/                      # uploaded logo files
  ```

See [App_GKE](App_GKE.md) for CMEK options, GCS FUSE, and StatefulSet PVCs.

### C. Secret Manager

Wallos generates **no application secrets** — there is no encryption key or JWT
secret to manage, because all identity state lives in the SQLite database. Secret
Manager is still used by the foundation for platform-managed secrets (e.g. CI/CD
tokens if configured).

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~wallos"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### D. Networking & ingress

By default the Service is `LoadBalancer`, with `enable_custom_domain = true` and
`reserve_static_ip = true` so an Ingress with a Google-managed certificate can serve
a supplied hostname on a stable IP.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available. Wallos's cron daemon runs
in-process, so its scheduled-task activity (or failures) is visible only in the
pod's own logs — there is no separate CronJob to inspect.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Wallos Application Behaviour

- **No first-deploy database setup.** There is no `db-init` job and no Cloud SQL
  instance. On first start Wallos creates its SQLite database at
  `/var/www/html/db/wallos.db` if it does not already exist and seeds the default
  `admin`/`admin` user.
- **State persistence.** Subscriptions, categories, settings, and users live
  entirely in `/var/www/html/db/wallos.db` on the database mount (PVC by default,
  or GCS FUSE bucket), surviving restarts and redeploys. Custom provider logos
  persist separately on the always-GCS-FUSE uploads mount.
- **Default credentials must be changed.** The seeded `admin`/`admin` login is
  well-known. Log in and change the password (and ideally the username) in the web
  UI immediately after the first deploy.
- **Single-writer constraint.** The embedded SQLite database does not support
  concurrent writers. Keep `min_instance_count = max_instance_count = 1`; the
  StatefulSet block PVC gives proper file locking but is still single-replica.
- **Always-on cron daemon — not request-triggered.** Wallos's 8 baked-in
  scheduled tasks (exchange-rate refresh, renewal notifications, an
  email-verification poll every 2 minutes, etc.) run inside the same pod
  continuously. This is why `min_instance_count = 1` is required — scaling to
  zero would stop these tasks entirely.
- **Health path.** Startup and liveness probes target **`/`** — Wallos's
  unauthenticated login page. `bellamy/wallos` documents no dedicated `/health`
  endpoint, so this is a coarse readiness signal (verify at first deploy):
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- wget -qO- -S http://localhost:80/ 2>&1 | head -1
  ```
- **No Redis.** `enable_redis = false`; Wallos is a self-contained app with no
  queue or cache beyond its own cron daemon. The App_GKE default of
  `enable_redis = true` is explicitly overridden.
- **`stateful_fs_group` may need adjusting.** bellamy/wallos's exact runtime
  UID/GID was not confirmed during research; the default leaves `fsGroup` unset
  (`0`). If the pod hits a permission error writing to the database PVC, inspect
  the running container to find the actual UID/GID.
- **Prebuilt image needs `imagePullPolicy = Always` only if mirrored.** Since
  `enable_image_mirroring = true` re-hosts the same upstream digest into Artifact
  Registry, App_GKE still sets `imagePullPolicy = Always` for mirrored images so a
  version bump is never served stale from node cache.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Wallos are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `wallos` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Wallos image tag — `bellamy/wallos:latest` is a genuine "latest" release. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per pod. |
| `memory_limit` | `1Gi` | Memory per pod; covers php-fpm workers plus the always-running cron daemon. |
| `min_instance_count` | `1` | **CRITICAL — must stay `1`.** The cron daemon only fires while a pod is running. |
| `max_instance_count` | `1` | **CRITICAL — must stay `1`.** SQLite has no multi-writer support. |
| `container_port` | `80` | Wallos's HTTP/1.1 listener. |
| `enable_cloudsql_volume` | `false` | Wallos has no Cloud SQL; leave `false`. |
| `enable_image_mirroring` | `true` | Mirror the Wallos image into Artifact Registry. |
| `container_image_source` | `prebuilt` | **Forwarded to the foundation** — App_GKE's own default (`custom`) would otherwise silently win and trigger a from-source build with no Dockerfile. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Wallos is a browser-driven web UI, so this defaults to external access. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true` (the default), else `Deployment`. |
| `session_affinity` | `None` | Single replica, so sticky routing is unnecessary. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Recommended default — stores the database on a block PVC instead of GCS FUSE (SQLite file-locking correctness). |
| `stateful_pvc_size` | `10Gi` | Per-pod PVC storage size — Wallos's SQLite database is small. |
| `stateful_pvc_mount_path` | `/var/www/html/db` | Fixed — the directory holding Wallos's SQLite database file. |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard` — SQLite needs write-locking correctness, not SSD IOPS; avoids the tight `SSD_TOTAL_GB` quota. |
| `stateful_fs_group` | `0` (unset) | bellamy/wallos's runtime UID/GID was not confirmed during research; adjust if the pod hits a PVC permission error. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 15s delay | Startup probe; no dedicated `/health` endpoint is documented for this image. |
| `liveness_probe` | HTTP `/` 30s delay | Liveness probe on the unauthenticated login page. |
| `uptime_check_config` | `{enabled=false, path="/health"}` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is off by default; not needed for Wallos. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the Wallos `db` and `uploads` buckets (and any extra `storage_buckets`). |
| `storage_buckets` | `[]` | Additional buckets to provision. |
| `gcs_volumes` | `[]` | Extra GCS FUSE mounts. The `db` (only when the PVC is disabled) and `uploads` (always) volumes are added automatically. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 15 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Wallos uses no Redis; the App_GKE default of `true` is overridden to `false`. |

### Group 16 — Database Backend

Not applicable — Wallos has no SQL database. `database_password_length` and
`db_name` / `db_user` are forwarded to the foundation only for compatibility;
`database_type` is fixed to `NONE` by `Wallos_Common`.

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Wallos. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

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
| `service_url` | URL to reach Wallos. |
| `storage_buckets` | Created Cloud Storage buckets (`db` and `uploads`). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any init jobs (empty by default). |
| `statefulset_name` | Name of the StatefulSet (default layout). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — IAP with no OAuth credentials, `min_instance_count > max_instance_count`, `workload_type = Deployment` alongside `stateful_pvc_enabled = true`, ResourceQuota memory values without binary unit suffixes. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `min_instance_count` | `1` | Critical | Scaling to zero silently stops Wallos's cron daemon — renewal notifications and every other scheduled task stop firing, with no error anywhere. |
| `max_instance_count` | `1` | Critical | >1 puts concurrent writers on the single SQLite database, corrupting it. |
| `db` / `uploads` volumes (PVC/bucket) | Never delete | Critical | The embedded SQLite DB and custom logos live here; deleting either destroys that state permanently. |
| `admin` / `admin` (seeded login) | Change on first login | Critical | Leaving the default credential lets anyone who can reach the service take full control. |
| `stateful_pvc_mount_path` | `/var/www/html/db` | High | Must match the SQLite file's fixed directory; a mismatch stores the DB on ephemeral disk and loses state on restart. |
| `stateful_pvc_storage_class` | `standard` (HDD) | Medium | `standard-rwo` (SSD) draws from the tight, quota-constrained `SSD_TOTAL_GB` pool for no IOPS benefit SQLite actually needs. |
| `stateful_pvc_enabled` + GCS FUSE for the database | Let Common disable GCS FUSE | High | Both mounted at the same database path double-mount; Common auto-sets `enable_gcs_db_volume = false` when the PVC is on — do not force both. |
| `container_port` | `80` | High | Wallos listens on 80; a different port makes the startup probe fail and the pod never becomes Ready. |
| `startup_probe` / `liveness_probe` path | `/` | Medium | No dedicated `/health` endpoint is documented for `bellamy/wallos` — if the app ever gates its root path behind auth, the probe path needs adjusting. |
| `container_image_source` | `prebuilt` (forwarded) | High | If not forwarded, App_GKE's own default (`custom`) silently wins and triggers a from-source Kaniko build against an image with no Dockerfile — the build fails. |
| `enable_cloudsql_volume` | `false` | Medium | Wallos has no Cloud SQL; enabling adds a useless Auth Proxy sidecar. |
| `enable_redis` | `false` | Medium | Wallos has no Redis; the App_GKE default `true` is overridden — leaving it on wires an unused dependency. |
| `enable_iap` | credentials required | High | Enabling IAP without `iap_oauth_client_id`/`secret` silently exposes the service unauthenticated (blocked by a plan-time guard). |
| `stateful_fs_group` | Verify at first deploy | Medium | Runtime UID/GID for `bellamy/wallos` was not confirmed during research; a permission-denied writing to the database PVC means this needs setting explicitly. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Wallos-specific application configuration shared
with the Cloud Run variant is described in
**[Wallos_Common](Wallos_Common.md)**.
