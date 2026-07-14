---
title: "Chibisafe on GKE Autopilot"
description: "Configuration reference for deploying Chibisafe on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Chibisafe on GKE Autopilot

Chibisafe is a self-hosted file and image uploader with a modern dashboard,
drag-and-drop uploads, albums, and a public API. This module deploys the
**chibisafe-server backend only** (port 8000) on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure. Chibisafe's upstream project also ships a
separate SvelteKit front-end and a Caddy reverse proxy; those are not deployed by
this module.

This guide focuses on the cloud services Chibisafe uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

Chibisafe runs as a single Node.js backend workload with no external database. The
deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | chibisafe-server pod on port 8000, StatefulSet by default, 1 vCPU / 1 GiB by default |
| Database | None | Chibisafe keeps its SQLite database, uploads, and logs on the persistent volume — no Cloud SQL instance is created |
| Block storage | GKE StatefulSet PVC | Default 20Gi `standard-rwo` PVC mounted at `/data`, holding the SQLite DB, uploads, and logs |
| Object storage | Cloud Storage | A `storage` bucket is always provisioned; only mounted as a GCS FUSE volume when the StatefulSet PVC is disabled |
| Secrets | Secret Manager | Optional `ADMIN_PASSWORD` (gated by `enable_api_key`, off by default) |
| Ingress | Kubernetes Gateway / Cloud Load Balancing | Custom domain + managed certificate enabled **by default** (`enable_custom_domain = true`) |

**Sensible defaults worth knowing up front:**

- **SQLite is the only "database."** `database_type` is fixed to `NONE` by
  `Chibisafe_Common`; the many `database_*`/`db_*` variables mirrored in
  `variables.tf` exist purely for Foundation-convention parity and have no effect.
- **StatefulSet + block PVC is the default.** SQLite does not tolerate GCS FUSE's
  POSIX file-locking semantics, so `stateful_pvc_enabled = true` by default, which
  auto-resolves `workload_type` to `StatefulSet` with a 20Gi `standard-rwo` PVC at
  `/data`.
- **Single-writer, single replica.** `min_instance_count = 1`, `max_instance_count
  = 1` — Chibisafe is a single-writer SQLite app; do not scale beyond 1 without
  redesigning storage.
- **Custom-build image with an app-specific version pin.** `image_source = "custom"`
  wraps `chibisafe/chibisafe-server` in a thin Dockerfile. The build reads its own
  `CHIBISAFE_VERSION` build arg (not the generic `APP_VERSION` the Foundation
  injects); `application_version = "latest"` is pinned to `v6.5.5` at build time.
- **No Redis, ever.** The variant mirrors an `enable_redis` variable for Foundation
  convention parity, but `main.tf` always forwards `enable_redis = false` to
  App_GKE regardless of its value — Chibisafe has no Redis dependency.
- **Custom domain is on by default.** Unlike most modules, `enable_custom_domain =
  true` out of the box; set `application_domains` for the managed certificate to
  actually attach to a hostname.
- **No mandatory secrets.** `enable_api_key = false` by default — Chibisafe creates
  and manages its own admin account and API keys through its first-run setup wizard
  and Dashboard UI. Flip `enable_api_key` to `true` only to pre-seed a random
  `ADMIN_PASSWORD` from Secret Manager instead of the well-known upstream default.
- **All state lives under one mount.** The entrypoint symlinks the image's
  `/app/database`, `/app/uploads`, and `/app/logs` directories into subdirectories
  of the single persistent volume (`/data`), migrating any image-seeded contents on
  first boot.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Chibisafe workload

Chibisafe pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. With the default `stateful_pvc_enabled = true`, the workload is a
**StatefulSet** with `OrderedReady` pod management and a stable per-pod PVC — a
better fit than a Deployment for a single-writer SQLite app.

- **Console:** Kubernetes Engine → Workloads → select the Chibisafe workload for
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP (if any).
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector=app~chibisafe
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Persistent storage — block PVC and Cloud Storage

Chibisafe has no database service to inspect — its state (SQLite database,
uploaded files, and logs) lives entirely on the persistent volume mounted at
`/data`. By default that volume is a per-pod **block PersistentVolumeClaim**
(`stateful_pvc_enabled = true`, 20Gi `standard-rwo`), which gives the SQLite files
the low-latency, POSIX-correct I/O they need. A **Cloud Storage** `storage` bucket
is always provisioned by `Chibisafe_Common`, but it is only mounted as a GCS FUSE
volume when the StatefulSet PVC is disabled (`enable_gcs_storage_volume` is
computed as `!stateful_pvc_enabled` in `main.tf`) — avoiding a double-mount at the
same path.

- **Console:** Kubernetes Engine → Storage → PersistentVolumeClaims for the PVC;
  Cloud Storage → Buckets for the always-created `storage` bucket.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" <pod-name> -- df -h /data
  gcloud storage buckets list --project "$PROJECT" --filter="name~chibisafe"
  ```

See [App_GKE](App_GKE.md) for StatefulSet PVC lifecycle, StorageClass options, and
GCS FUSE mount details.

### C. Secret Manager

Chibisafe generates **no secrets by default**. The only optional secret is a
random admin password, gated by `enable_api_key` (default `false`): when enabled,
a 24-character random value is stored in Secret Manager (name suffix `api-key`)
and delivered to the pod as a **native Kubernetes Secret** (via
`explicit_secret_values`, not the usual Secret Manager → SecretSync path) injected
as the `ADMIN_PASSWORD` environment variable — Chibisafe's backend seeds its
first-run admin account from this value instead of the well-known upstream
default.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~chibisafe"
  gcloud secrets versions access latest --secret=<api-key-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI / native-Secret injection model
and rotation.

### D. Networking & ingress

`enable_custom_domain = true` by default, exposing Chibisafe through a Kubernetes
Gateway with a Google-managed certificate once `application_domains` is populated.
The internal Service defaults to `ClusterIP`; switch `service_type` to
`LoadBalancer` for a direct external IP instead of (or alongside) the Gateway path.

- **Console:** Network services → Gateways, or Load balancing (if `service_type =
  LoadBalancer`); VPC network → IP addresses for the reserved static IP.
- **CLI:**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available but disabled by default
(`uptime_check_config.enabled = false`).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

See [App_GKE](App_GKE.md) for uptime-check reachability requirements and alert
wiring.

---

## 3. Chibisafe Application Behaviour

- **No init or migration job.** Chibisafe manages its own SQLite storage;
  `Chibisafe_Common` injects no `db-init`/migration job by default. The
  `initialization_jobs` variable is available for custom data-loading tasks only.
- **First-boot state relocation.** The image keeps mutable state under three
  sibling directories in its WORKDIR — `/app/database` (SQLite), `/app/uploads`
  (files/thumbnails), and `/app/logs`. The entrypoint (`entrypoint.sh`) symlinks
  each of these into a subdirectory of the single persistent mount (`/data` by
  default), migrating any image-seeded contents into the empty volume on first
  boot. This is idempotent across restarts — already-symlinked directories are left
  alone.
- **Admin account.** Chibisafe creates its administrator account through its own
  first-run setup wizard in the web UI (no generated username/password is baked in
  by default). If `enable_api_key = true`, a random value is generated and injected
  as `ADMIN_PASSWORD`, which the backend uses to seed the first-run admin credential
  instead of the well-known upstream default.
- **No DB env-var aliasing.** `database_type = NONE` — there is no `DB_HOST`/
  `DB_USER` injection or aliasing to worry about; SQLite lives entirely on the
  `/data` volume.
- **Container environment.** The backend listens on `0.0.0.0:8000`
  (`HOST=0.0.0.0`, `NODE_ENV=production`); `PORT` is deliberately left unset by
  `Chibisafe_Common` so the image's own default (`8000`, matching
  `container_port`) is used consistently across platforms.
- **Health path.** Both the startup and liveness probes are **HTTP** `GET /`
  (`health_check_config`/`startup_probe_config` default `path = "/"`) — the
  backend returns 200 as soon as it is serving, with no authentication required.
- **Single-writer scaling constraint.** `min_instance_count = max_instance_count =
  1` by default; each StatefulSet pod owns its own PVC, so scaling beyond 1 without
  redesigning storage risks split SQLite writers.
- **Inspect the running config:**
  ```bash
  kubectl get pods,pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls -la /app/database /app/uploads /app/logs
  kubectl exec -n "$NAMESPACE" <pod-name> -- env | grep -E 'HOST|NODE_ENV|PORT'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Chibisafe are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `chibisafe` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `chibisafe/chibisafe-server` image tag; `latest` is pinned to `v6.5.5` at build time via the app-specific `CHIBISAFE_VERSION` build arg. |
| `enable_api_key` | `false` | Generates a random value in Secret Manager, injected as `ADMIN_PASSWORD` via a native Kubernetes Secret, seeding the first-run admin credential instead of the upstream default. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU default. |
| `memory_limit` | `1Gi` | 1 GiB default. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Keep at 1 — Chibisafe is a single-writer SQLite app. |
| `container_port` | `8000` | Fixed by `Chibisafe_Common`; this variable is not forwarded to App_GKE and changing it has no effect. |
| `enable_cloudsql_volume` | `false` | Chibisafe has no Cloud SQL database — leave `false`. |
| `enable_image_mirroring` | `true` | Mirrors the built image into Artifact Registry. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `ClusterIP` | Internal by default; the Gateway path (Group 19) is the default route to external traffic. |
| `workload_type` | `null` → `StatefulSet` | Auto-resolves because `stateful_pvc_enabled = true` by default. |
| `session_affinity` | `None` | No client stickiness configured by default. |

### Group 7 — StatefulSet / PVC

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Required — SQLite does not tolerate GCS FUSE's POSIX file locking. Auto-resolves `workload_type` to `StatefulSet`. |
| `stateful_pvc_size` | `20Gi` | Size the PVC to hold the SQLite DB plus all uploaded files. |
| `stateful_pvc_mount_path` | `/data` | The entrypoint symlinks `/app/database`, `/app/uploads`, and `/app/logs` into this mount. |
| `stateful_pvc_storage_class` | `standard-rwo` | SSD-backed Balanced PD; draws the `SSD_TOTAL_GB` quota — override to `standard` (HDD) on quota-constrained projects. |
| `stateful_fs_group` | `3000` | Matches the Chibisafe Helm chart's UID 1000 / GID 2000 convention so the PVC is group-writable. |

### Group 10 — Observability

| Variable | Default | Description |
|---|---|---|
| `health_check_config` / `startup_probe_config` | `path = "/"` | The backend returns 200 on `GET /` once serving; no auth required. |
| `uptime_check_config` | `enabled = false` | Enable to add a public uptime check and alert once the endpoint is publicly reachable. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisions the always-present `storage` bucket (suffix `storage`). |
| `gcs_volumes` | `[]` | Additional GCS FUSE mounts. The Chibisafe storage bucket is auto-mounted at `/data` only when `stateful_pvc_enabled = false`; with the StatefulSet default it is created but left unmounted to avoid a double-mount at `/data`. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` (mirrored, **inert**) | Declared only for Foundation-convention parity — `Chibisafe_GKE/main.tf` always forwards `enable_redis = false` to App_GKE regardless of this value. Chibisafe has no Redis dependency. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | On by default (unusual among modules) — Kubernetes Gateway + managed certificate. |
| `application_domains` | `[]` | Must be populated for the managed certificate to attach to a real hostname. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

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
| `service_external_ip` | External LoadBalancer IP (when `service_type = LoadBalancer` and a static IP is reserved). |
| `service_url` | URL to reach Chibisafe. |
| `chibisafe_api_key_secret_id` | Secret Manager secret ID for the optional admin-password secret. Empty when `enable_api_key = false`. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `initialization_jobs` | Names of any custom initialization jobs. |
| `statefulset_name` | Name of the StatefulSet. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — pairing `workload_type = "Deployment"` with `stateful_pvc_enabled = true`, `quota_memory_*` given as bare integers, an out-of-range `container_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critical | Disabling it falls back to a GCS FUSE mount at `/data`, whose POSIX file-locking behaviour is unsafe for SQLite and risks database corruption. |
| `stateful_pvc_mount_path` | `/data` | Critical | The entrypoint's relocation symlinks (`/app/database`, `/app/uploads`, `/app/logs`) are hard-coded to this mount; changing it without also updating the image breaks state persistence. |
| `workload_type` | `null` (→ `StatefulSet`) | Critical | Forcing `Deployment` alongside `stateful_pvc_enabled = true` fails at plan time; forcing it via `stateful_pvc_enabled = false` instead trades SQLite integrity for GCS FUSE risk (see above). |
| `max_instance_count` | `1` | High | Chibisafe is a single-writer SQLite app; scaling beyond 1 pod risks split writers and corrupted state even though each StatefulSet replica gets its own PVC. |
| `stateful_fs_group` | `3000` | High | A mismatched or unset `fsGroup` leaves the PVC mount without group-write access for the container's UID, causing write failures for the SQLite DB and uploads. |
| `stateful_pvc_storage_class` | `standard-rwo` (override to `standard` if constrained) | Medium | SSD-backed `standard-rwo` draws the tight `SSD_TOTAL_GB` quota; a campaign of stateful apps can exhaust it. Scale-to-zero does **not** release the PVC — only deletion does. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace (only relevant if `enable_resource_quota = true`). |
| `enable_custom_domain` | `true` with `application_domains` set | Medium | Left on with an empty `application_domains`, the Gateway/managed-certificate path has no hostname to attach to. |
| `enable_redis` | any value (inert) | Low | `main.tf` always forwards `enable_redis = false` — changing this variable has no effect; do not rely on it to add Redis connectivity. |
| `container_port` | `8000` (fixed) | Low | The variable is declared for convention parity but not forwarded to App_GKE; changing it does not change the backend's actual listening port. |
| `database_type` / `db_*` variables | `NONE` / inert | Low | Chibisafe has no SQL database; these exist only for Foundation-variable mirroring and are silently ignored. |
| `enable_api_key` | `false` unless pre-seeding is required | Low | Chibisafe manages its own admin account and API keys through its UI; the generated `ADMIN_PASSWORD` secret is only useful for automation that needs credentials before the UI is reachable. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Chibisafe-specific application configuration shared with the Cloud Run variant is
described in the Chibisafe_Common module (`modules/Chibisafe_Common/README.md`).
