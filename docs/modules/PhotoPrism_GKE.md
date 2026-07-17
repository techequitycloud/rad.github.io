---
title: "PhotoPrism on GKE Autopilot"
description: "Configuration reference for deploying PhotoPrism on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# PhotoPrism on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PhotoPrism_GKE.png" alt="PhotoPrism on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

PhotoPrism is a self-hosted, AI-powered photo and video management application:
it browses, organizes, and shares a personal media library with automatic
tagging, facial recognition, and full-text/visual search, all served from a
single Go binary with an embedded SQLite database. This module deploys
PhotoPrism on **GKE Autopilot** on top of the [App_GKE](App_GKE.md)
foundation, which provisions and manages the shared Google Cloud and
Kubernetes infrastructure.

This guide focuses on the cloud services PhotoPrism uses and how to explore
and operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

PhotoPrism runs as a single Go binary web workload, deployed as a
**StatefulSet with a block Persistent Volume Claim** rather than a stateless
Deployment. The deployment wires together a focused set of Google Cloud
services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | PhotoPrism pod on port 2342, StatefulSet by default |
| Database | None | Embedded SQLite (`PHOTOPRISM_DATABASE_DRIVER=sqlite`) — no Cloud SQL instance is provisioned |
| Block storage | Persistent Disk (block PVC) | `/photoprism` (SQLite database, cache, originals, imports) — **required**, gcsfuse cannot safely back SQLite |
| Object storage | Cloud Storage | A `storage` bucket is provisioned but only mounted via GCS FUSE if the block PVC is disabled |
| Secrets | Secret Manager | Auto-generated admin password (`PHOTOPRISM_ADMIN_PASSWORD`) |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **No database is ever provisioned.** `PhotoPrism_Common` hardcodes
  `database_type = "NONE"` and `enable_cloudsql_volume = false`; PhotoPrism
  manages its own SQLite files under `/photoprism/storage`. The GKE-level
  `database_type`/`application_database_*`/`enable_mysql_plugins`/etc.
  variables are all inert placeholders forwarded for foundation compatibility
  only.
- **Block PVC, not gcsfuse, is mandatory.** `stateful_pvc_enabled = true` by
  default, resolving `workload_type` to `StatefulSet` and mounting a
  `standard-rwo` (SSD) 20Gi Persistent Disk at `/photoprism`. gcsfuse cannot
  safely host SQLite or the media index, so the module automatically sets
  `enable_gcs_storage_volume = false` on the Common layer when the PVC is
  enabled, avoiding a double-mount at the same path.
- **Single replica, always.** `min_instance_count = 1`, `max_instance_count =
  1`. PhotoPrism serves one shared SQLite library from one writable volume —
  do not scale beyond 1.
- **Redis is forced off.** The GKE-level `enable_redis` variable defaults
  `true` (the App_GKE foundation default), but `PhotoPrism_GKE`'s `main.tf`
  hard-overrides it to `false` — PhotoPrism has no Redis integration, so no
  Memorystore/NFS Redis host is ever injected.
- **NFS is off by default** (`enable_nfs = false`). The block PVC is the
  durable store; NFS is not needed unless you add custom jobs/services that
  require shared filesystem access.
- **Admin password is auto-generated.** A 24-character password is created
  and stored in Secret Manager, then injected as the `PHOTOPRISM_ADMIN_PASSWORD`
  secret env var; the admin username is the plain `admin_username` variable
  (default `admin`).
- **Custom image build is a thin mirror, not app logic.** The build wraps the
  upstream `photoprism/photoprism` image (`FROM photoprism/photoprism:${PHOTOPRISM_VERSION}`)
  so the Foundation can mirror it into Artifact Registry; the app-specific
  build arg is `PHOTOPRISM_VERSION` (not the generic `APP_VERSION`), pinned to
  `240915` when `application_version = "latest"`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the PhotoPrism StatefulSet

PhotoPrism runs as a **StatefulSet** (not a Deployment) so its single pod gets
a stable identity and an ordered restart, matched to its single writable block
PVC. Autopilot bills for the CPU/memory the pod actually requests.

- **Console:** Kubernetes Engine → Workloads → select the PhotoPrism
  StatefulSet for pods, revisions, and events. Kubernetes Engine → Services &
  Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Persistent block storage (Persistent Disk)

All PhotoPrism state — the SQLite database and cache (`/photoprism/storage`),
imported media (`/photoprism/originals`), and staged imports
(`/photoprism/import`) — lives on a single per-pod block PVC provisioned by
the StatefulSet at `/photoprism`, backed by the `standard-rwo` StorageClass
(Balanced Persistent Disk / SSD) by default, sized `20Gi`.

- **Console:** Kubernetes Engine → Storage → Persistent Volume Claims; Compute
  Engine → Disks.
- **CLI:**
  ```bash
  kubectl get pvc,pv -n "$NAMESPACE"
  gcloud compute disks list --project "$PROJECT" --filter="name~<service-name>"
  ```

See [App_GKE](App_GKE.md) for StatefulSet PVC provisioning, StorageClass
options, and the GKE `SSD_TOTAL_GB` quota caveat.

### C. Cloud Storage

A dedicated **Cloud Storage** bucket (suffix `storage`) is provisioned by
default (`create_cloud_storage = true`), but it is only mounted into the pod
via GCS FUSE when the block PVC is disabled
(`stateful_pvc_enabled = false`) — in the default StatefulSet configuration
the bucket exists but is unused by the running container.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse CSI driver mounts.

### D. Secret Manager

One secret is generated automatically: the PhotoPrism admin password
(`secret-<prefix>-photoprism-admin-password`), injected into the container as
`PHOTOPRISM_ADMIN_PASSWORD`. On GKE, secrets are projected into pods via the
Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~photoprism-admin-password"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through a `ClusterIP` Service
(`service_type = "ClusterIP"`); switch to `LoadBalancer` for a direct external
IP, or enable a custom domain (`enable_custom_domain = true` by default) via
the Kubernetes Gateway API with a Google-managed certificate.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud
Monitoring. An optional uptime check (`uptime_check_config`, disabled by
default) and custom alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. PhotoPrism Application Behaviour

- **No init/db-create job.** `initialization_jobs` defaults to `[]` — there is
  no database to bootstrap. PhotoPrism creates and migrates its own SQLite
  schema on first boot, under the mounted block PVC.
- **Storage layout.** All state lives under the single mounted directory
  `/photoprism`: `PHOTOPRISM_STORAGE_PATH=/photoprism/storage` (SQLite
  database + cache), `PHOTOPRISM_ORIGINALS_PATH=/photoprism/originals`
  (imported/indexed media), `PHOTOPRISM_IMPORT_PATH=/photoprism/import`
  (staged imports).
- **Admin account.** `PHOTOPRISM_ADMIN_USER` is the plain `admin_username`
  variable (default `admin`); `PHOTOPRISM_ADMIN_PASSWORD` is the
  auto-generated Secret Manager value, injected as a secret env var.
  `PHOTOPRISM_AUTH_MODE = "password"` is set explicitly. Retrieve the
  password from Secret Manager before first login.
- **Site URL.** `PHOTOPRISM_SITE_URL` is empty by default — PhotoPrism
  tolerates this and falls back to the request host, but set `site_url` to
  the deployed URL for correctly generated absolute links.
- **fsGroup for the PVC.** PhotoPrism runs as UID 1000 / GID 2000; the
  StatefulSet sets `stateful_fs_group = 3000` (the upstream Helm chart's
  convention) so the mounted PVC is group-writable.
- **Health path.** Both startup and liveness probes are **HTTP**
  `GET /api/v1/status` (initial delay 15s / 10 retries for startup, 30s / 3
  retries for liveness) — no auth required. The Group-10 foundation-level
  `startup_probe_config`/`health_check_config` variables mirror the same
  path as generic defaults. <!-- TODO: verify precedence if the two probe
  configuration surfaces (Common-level startup_probe/liveness_probe vs.
  Group-10 startup_probe_config/health_check_config) are set to conflicting
  values. -->
- **Scaling is pinned to one pod.** `min_instance_count = 1` and
  `max_instance_count = 1` — PhotoPrism keeps a single writable SQLite
  database and a single writable media volume; there is no multi-writer
  support.
- **Inspect the running config and storage:**
  ```bash
  kubectl get pods,pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep PHOTOPRISM_
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for PhotoPrism are listed; every other input
is inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `photoprism` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `photoprism/photoprism` image tag used as the custom-build base; `latest` is pinned to a known-good tag (`240915`) at build time. |
| `admin_username` | `admin` | Initial admin account username (`PHOTOPRISM_ADMIN_USER`); the password is generated separately. |
| `site_url` | `""` | Public site URL (`PHOTOPRISM_SITE_URL`). Empty falls back to the request host; set once the external URL is known for correct absolute links. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | CPU allocated to the PhotoPrism container. Indexing/thumbnailing is CPU-bound; raise for large libraries. |
| `memory_limit` | `1Gi` | Memory allocated to the container. `<!-- TODO: verify --> PhotoPrism_Common's own default is 4Gi; PhotoPrism_GKE's variable default is 1Gi — raise for large libraries.` |
| `min_instance_count` | `1` | Keep at 1 to avoid cold starts during index loading. |
| `max_instance_count` | `1` | **Keep at 1** — single writable SQLite DB and media volume. |
| `container_port` | `2342` | Not forwarded to App_GKE; PhotoPrism always serves on 2342, fixed by `PhotoPrism_Common`. |
| `enable_cloudsql_volume` | `false` | No Cloud SQL Auth Proxy sidecar — PhotoPrism has no external database. |

### Group 7 — StatefulSet (block PVC)

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Required.** gcsfuse cannot safely back SQLite/the media index; when true without an explicit `workload_type`, resolves to `StatefulSet` and disables the GCS FUSE storage volume automatically. |
| `stateful_pvc_size` | `20Gi` | Size the PVC to hold all collections plus overhead. |
| `stateful_pvc_mount_path` | `/photoprism` | PhotoPrism's data dir — covers `storage` (SQLite/cache) and `originals`. |
| `stateful_pvc_storage_class` | `standard-rwo` | Balanced PD (SSD) — draws the `SSD_TOTAL_GB` quota; see §6. |
| `stateful_fs_group` | `3000` | GID for pod-level `fsGroup`; PhotoPrism runs as UID 1000/GID 2000. |
| `stateful_pod_management_policy` | `null` → `OrderedReady` | Safe, ordered restarts for a stateful single-pod workload. |

### Group 10 — Health & Observability

| Variable | Default | Description |
|---|---|---|
| `startup_probe` (Common) | HTTP `/api/v1/status`, 15s delay, 10 retries | Applied to the PhotoPrism container. |
| `liveness_probe` (Common) | HTTP `/api/v1/status`, 30s delay, 3 retries | Applied to the PhotoPrism container. |
| `uptime_check_config` | `enabled = false`, path `/api/v1/status` | Optional external uptime check; off by default. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Creates the `storage` bucket even though it is unused when the block PVC (default) is active. |
| `gcs_volumes` | `[]` | Additional GCS FUSE mounts beyond the (auto-managed) PhotoPrism storage volume. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` (var default) → **forced `false`** | `main.tf` hard-overrides this to `false` regardless of the value passed — PhotoPrism has no Redis integration. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — PhotoPrism has no SQL database (embedded SQLite only). All other `database_*`/`application_database_*`/MySQL-plugin variables in this group are inert, forwarded only for foundation compatibility. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Kubernetes Gateway API + managed certificate. |
| `application_domains` | `[]` | Custom hostnames; required if `enable_custom_domain` is left `true` with no `LoadBalancer` fallback. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way
to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach PhotoPrism. |
| `photoprism_admin_password_secret_id` | Secret Manager secret ID holding the generated admin password. |
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

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_GKE](App_GKE.md) foundation engine, which validates values
> *and combinations* at plan time — a `StatefulSet` forced alongside a
> stateless setting, IAP with no authorized identities, `quota_memory_*`
> given as bare integers, an out-of-range `container_port`/
> `backup_retention_days`. Invalid configuration fails the **plan** with a
> clear, named error before any resource is created, so most mistakes below
> are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critical | Disabling it falls back to GCS FUSE, which cannot safely host SQLite or the media index — corruption risk. |
| `max_instance_count` | `1` | Critical | Scaling beyond 1 gives two pods a single writable SQLite DB and PVC — corruption/lock contention. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) — consider `standard` (HDD) | Medium–High | `standard-rwo` draws the tight regional `SSD_TOTAL_GB` quota (500GB on Qwiklabs); a campaign of stateful apps can exhaust it around app #8. PhotoPrism does not need SSD IOPS for correctness, only for indexing/thumbnailing throughput — override to HDD (`-var stateful_pvc_storage_class=standard`) on quota-constrained projects. |
| `enable_redis` | Forced `false` in `main.tf` | Low | No action needed — the override is intentional and cannot be defeated by setting the variable `true`. |
| `create_cloud_storage` | `true` | Low | The `storage` bucket is created but unused while the block PVC is active; harmless, minor idle storage cost. |
| `PHOTOPRISM_ADMIN_PASSWORD` (auto-generated) | Retrieve before first login | Medium | Not knowing it locks you out of the first admin account until reset via the database. |
| `site_url` | Set to the deployed URL once known | Medium | Left empty, PhotoPrism falls back to the request host; absolute links/thumbnail URLs can be wrong behind a proxy or custom domain. |
| `stateful_fs_group` | `3000` | High | A mismatched or unset fsGroup can leave the PVC non-writable by PhotoPrism's UID 1000/GID 2000, blocking startup. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and `site_url`. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. PhotoPrism-specific application configuration
shared with the Cloud Run variant is described in
**[PhotoPrism_Common](PhotoPrism_Common.md)**.
