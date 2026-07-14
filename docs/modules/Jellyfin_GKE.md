---
title: "Jellyfin on GKE Autopilot"
description: "Configuration reference for deploying Jellyfin on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Jellyfin on GKE Autopilot

Jellyfin is a free, open-source (GPLv2) self-hosted media server for streaming
your own movies, TV shows, music, photos, and live TV. Written in .NET/C# and
maintained as a community fork of Emby, it has no tracking, no ads, and no premium
tier. This module deploys Jellyfin on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Jellyfin uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

Jellyfin runs as a stateful .NET workload. On GKE this is the **recommended home for
a real media library**: a StatefulSet backed by a real **block PVC** at `/config`
gives correct POSIX filesystem semantics for SQLite and the transcode cache. The
deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | .NET StatefulSet pod, 1 vCPU / 1 GiB by default |
| Persistence | Persistent Disk (block PVC) | `/config` on a per-pod PVC — the recommended store for SQLite + transcode cache |
| Database | Internal SQLite (embedded) | No Cloud SQL — Jellyfin keeps all state in SQLite files under `/config` |
| Object / file storage | Cloud Storage (GCS FUSE) / Filestore (NFS) | Optional, for large media libraries |
| Secrets | Secret Manager | Optional auto-generated API key; no mandatory cryptographic secrets |
| Ingress | Cloud Load Balancing | ClusterIP by default; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **There is no external database.** Jellyfin stores its entire state — the SQLite
  library and playback databases, configuration XML, cached metadata and artwork,
  plugins, transcode cache, and logs — under `/config`. No Cloud SQL instance, no
  `db-init` job, and no Redis is used (`database_type = NONE`; the foundation Redis
  variables are inert for Jellyfin).
- **A block PVC at `/config` is the best fit.** `stateful_pvc_enabled = true`
  resolves the workload to a **StatefulSet** with a per-pod PVC mounted at `/config`,
  and the GCS storage volume auto-disables to avoid a double mount. Real block
  storage gives the correct filesystem semantics SQLite and the transcode cache
  need — the recommended configuration for a media server.
- **The container listens on port 8096.** Jellyfin's web/API port is set by
  Jellyfin_Common. The web UI and first-run setup wizard are served at `/web` (and
  `/`); `GET /health` returns `Healthy` (200, unauthenticated).
- **There are no default credentials.** On first access the setup wizard creates the
  administrator account and adds media libraries. Nothing is usable until then.
- **Single replica.** `min_instance_count = 1` / `max_instance_count = 1` — one
  shared SQLite library on one volume. **Do not run multiple replicas**; concurrent
  writers against one SQLite file corrupt the library.
- **NFS is optional, for large libraries.** `enable_nfs = false` by default. Enable
  it to mount a shared Filestore volume for a large media collection that outgrows
  a single PVC.
- **API-key auth is optional and off by default.** `enable_api_key = false`. Primary
  authentication is the wizard-created admin account; per-application API keys are
  created in-app under **Dashboard → API Keys**.

> **GKE vs Cloud Run — GKE is the production media server.**
> **GKE (this module)** runs Jellyfin as a StatefulSet with a real **block PVC** at
> `/config`, giving true POSIX semantics for SQLite and the transcode cache, plus
> optional **NFS** for large media libraries — the recommended choice for a real,
> multi-user, transcoding media server. **[Jellyfin_CloudRun](Jellyfin_CloudRun.md)**
> mounts `/config` from a GCS bucket over FUSE; it is simpler and cheaper for a demo
> or a small personal library, but FUSE latency and the per-request timeout model
> make it a poor fit for live transcoding or busy streaming.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Jellyfin workload

Jellyfin pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. With a block PVC the workload is a StatefulSet with a stable pod
identity and orderly restarts.

- **Console:** Kubernetes Engine → Workloads → select the Jellyfin workload to see
  pods, events, and the StatefulSet. Kubernetes Engine → Services & Ingress shows
  the external IP (when exposed).
- **CLI:**
  ```bash
  kubectl get pods,svc,statefulset,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" <pod-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Persistent configuration store (SQLite on the PVC)

Jellyfin has **no external database**. Its entire state — the SQLite library and
playback databases, configuration XML, cached metadata and artwork, installed
plugins, the transcode cache, and logs — lives under `/config`
(`JELLYFIN_CONFIG_DIR = /config`). There is no Cloud SQL instance, no Auth Proxy,
and no initialization Job to create a schema; Jellyfin creates and migrates its own
SQLite databases on first start.

On GKE, `/config` is backed by a per-pod **block PVC** (`stateful_pvc_enabled = true`,
mounted at `/config`), which is the recommended store because SQLite and the
transcode cache need true POSIX filesystem semantics that object storage cannot
provide.

- **Inspect the PVC and its bound disk:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  ```

### C. Cloud Storage & NFS (optional, for large libraries)

The auto-provisioned **Cloud Storage** bucket (name suffix `storage`, `STANDARD`,
`force_destroy = true`, versioning off, `public_access_prevention = enforced`) is
available for additional GCS FUSE mounts. When a block PVC is enabled the GCS
storage volume is auto-disabled for `/config` to avoid a double mount. For large
media collections, enable **NFS** (`enable_nfs = true`) to mount a shared Filestore
volume.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for CMEK options and the GCS FUSE CSI driver.

### D. First-run setup & the media library

On first access Jellyfin serves an interactive **setup wizard** at `/web` (and `/`)
that creates the administrator account, sets the preferred language, and lets you
add media libraries (Movies, TV, Music, Photos). Nothing is authenticated or usable
until you complete the wizard — there are no default credentials.

Media libraries point at paths inside the container: the block PVC at `/config`, an
optional NFS mount for large collections, or additional GCS FUSE volumes.

- **Reach the wizard / web UI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"      # external IP / hostname
  kubectl port-forward -n "$NAMESPACE" statefulset/<service-name> 8096:8096
  # then open http://localhost:8096/web
  ```

### E. Secret Manager & the optional API key

Jellyfin requires **no mandatory cryptographic secrets** — there is no encryption
key, JWT, or master password to manage. When `enable_api_key = true`, the module
generates a 32-character random value, stores it in Secret Manager as
`secret-<prefix>-<app>-api-key` (surfaced as the `jellyfin_api_key_secret_id`
output), and injects it so external callers can authenticate programmatically. In
day-to-day use, API keys are created and revoked in-app under **Dashboard → API
Keys**; primary auth remains the wizard admin account.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default `service_type = ClusterIP`, keeping the media server in-cluster. Set
`service_type = LoadBalancer` for an external IP, or enable a custom domain with a
Google-managed certificate via the Kubernetes Gateway API. A static IP can be
reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Jellyfin Application Behaviour

- **No initialization Job.** Jellyfin needs no `db-init` step — it creates and
  migrates its own SQLite databases under `/config` the first time it starts. Leave
  `initialization_jobs` empty unless you have custom data-loading tasks.
- **First-run wizard creates the admin.** The `/web` setup wizard walks you through
  creating the administrator account and adding libraries. Until it is completed the
  server has no users and no content.
- **`/config` is the single source of truth — persist it.** All library state is on
  the block PVC. Deleting the PVC wipes the library, plugins, and users. The
  StatefulSet keeps the PVC bound to the pod identity across restarts.
- **Custom image is a thin wrapper.** The Dockerfile is
  `ARG JELLYFIN_VERSION=10.10.3` / `FROM jellyfin/jellyfin:${JELLYFIN_VERSION}`, so
  the Foundation mirrors it into Artifact Registry (`enable_image_mirroring = true`)
  and sets `imagePullPolicy = Always` for the mirrored image.
  `application_version = "latest"` resolves to the pinned `10.10.3` via the
  app-specific `JELLYFIN_VERSION` build arg — it is **not** overwritten by the
  Foundation's generic `APP_VERSION` injection.
- **fsGroup for a group-writable PVC.** Jellyfin runs as UID 1000 / GID 2000;
  `stateful_fs_group = 3000` (the Jellyfin Helm chart default) ensures the PVC is
  group-writable.
- **Health path.** Startup and liveness probes target `GET /health`, which returns
  `Healthy` (200) without authentication once the server is ready. The startup probe
  allows a 15-second initial delay with a generous retry window; the liveness probe
  polls every 30 seconds.
- **Transcoding is CPU-heavy and GPU-less.** Autopilot pods have no GPU, so prefer
  direct-play clients. Size `cpu_limit` up for live transcoding and `memory_limit`
  up for large libraries.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Jellyfin are listed; every other input is
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
| `application_name` | `jellyfin` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Jellyfin Media Server` | Human-readable name shown in the platform UI. |
| `application_version` | `latest` | Jellyfin image tag; `latest` pins to `10.10.3` via the `JELLYFIN_VERSION` build arg. |
| `enable_api_key` | `false` | Generate a random API key in Secret Manager. Recommended when reachable outside the namespace. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per pod; raise for live transcoding. |
| `memory_limit` | `1Gi` | Memory per pod; raise for large libraries. |
| `min_instance_count` | `1` | Minimum replicas; keep at 1 (single shared library). |
| `max_instance_count` | `1` | **Keep at 1.** One shared SQLite library on one volume — never run multiple replicas. |
| `container_port` | `8096` | Jellyfin's web/API port (set by Jellyfin_Common; not forwarded to App_GKE). |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | Jellyfin has no Cloud SQL — leave `false`. |
| `enable_image_mirroring` | `true` | Mirror `jellyfin/jellyfin` into Artifact Registry. |
| `enable_vertical_pod_autoscaling` | `false` | VPA optimises requests; disables HPA when on. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings for the Jellyfin container. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `ClusterIP` | How the Kubernetes Service is exposed; `LoadBalancer` for external access. |
| `workload_type` | `null` → `StatefulSet` | Resolves to StatefulSet when `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Session affinity mode for the Service. |
| `namespace_name` | `""` | Auto-generated from `application_name` + `tenant_deployment_id` when empty. |
| `network_tags` | `["nfsserver"]` | `nfsserver` is required when `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Seconds after SIGTERM before SIGKILL — allows in-flight writes to flush. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable the PVC template. **Recommended `true` for Jellyfin** — auto-resolves to StatefulSet. |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC size; size to hold `/config` (SQLite, metadata, transcode cache). |
| `stateful_pvc_mount_path` | `/config` | Container mount path for the PVC (Jellyfin's config/persistence dir). |
| `stateful_pvc_storage_class` | `standard-rwo` | Balanced PD; use `premium-rwo` for higher IOPS. |
| `stateful_headless_service` | `null` | Headless Service for stable pod DNS names. |
| `stateful_pod_management_policy` | `null` → `OrderedReady` | Safe ordered restarts for Jellyfin. |
| `stateful_update_strategy` | `null` → `RollingUpdate` | Update strategy. |
| `stateful_fs_group` | `3000` | Pod fsGroup so the PVC is group-writable (Jellyfin UID 1000 / GID 2000). |

### Group 8 — Resource Quota

`enable_resource_quota` (`false`) plus `quota_cpu_requests` / `quota_cpu_limits` /
`quota_memory_requests` / `quota_memory_limits` / `quota_max_pods` /
`quota_max_services` / `quota_max_pvcs` — namespace ResourceQuota. The quota
`*_requests` / `*_limits` values are **not forwarded** in this module and are inert;
memory values, if used elsewhere, must carry binary unit suffixes (`4Gi`, `8192Mi`).

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health` 15s delay | Startup probe; `/health` returns 200 once ready. |
| `liveness_probe` | HTTP `/health` 30s delay | Liveness probe. |
| `startup_probe_config` | HTTP `/health` | App_GKE-level infrastructure startup probe. |
| `health_check_config` | HTTP `/health` | App_GKE-level liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Jellyfin needs no init job; provide only for custom data-loading tasks. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs (e.g. maintenance tasks). |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside Jellyfin. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Provision Cloud Filestore (NFS); enable for large shared media libraries. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `nfs_volume_name` | `nfs-data-volume` | Volume name for the NFS mount. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the Jellyfin `storage` bucket and any extras. |
| `storage_buckets` | `[]` | Additional buckets to provision. |
| `gcs_volumes` | `[]` | Additional GCS FUSE volume mounts via the CSI driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Artifact Registry cleanup policy. |

### Group 16 — Database Configuration

`database_type` (`NONE`), `database_password_length`, `application_database_name`
(`jellyfindb`), `application_database_user` (`jellyfinuser`), `enable_mysql_plugins`,
`enable_postgres_extensions`, `db_*` / `db_*_env_var_name` — **all inert for
Jellyfin** (no SQL database); retained and forwarded for foundation compatibility.

### Group 15 — Redis (forwarded for foundation compatibility)

`enable_redis`, `redis_host`, `redis_port`, `redis_auth` — **not applicable to
Jellyfin**, which uses no cache or queue. Forwarded to the foundation only for
compatibility; leave at defaults.

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC) of the `/config` volume. |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore a `/config` snapshot on deploy (`tar` default). |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `static_ip_name` | `""` | Auto-generated when empty. |

### Group 20 — Identity-Aware Proxy (IAP)

> **Warning:** Enabling IAP requires Google identity authentication for **all**
> inbound requests. Requires `enable_custom_domain` or `enable_cdn` to be true.

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Jellyfin. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

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
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | Access level CIDRs / dry-run mode. |
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
| `service_url` | URL to reach Jellyfin. |
| `jellyfin_api_key_secret_id` | Secret Manager secret ID for the API key (empty when `enable_api_key = false`). |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any setup jobs (empty for a default Jellyfin deploy). |
| `statefulset_name` | Name of the StatefulSet. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `Deployment` workload alongside `stateful_pvc_enabled = true`, IAP with no authorized identities, `quota_memory_*` without binary unit suffixes, an out-of-range `timeout_seconds`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `/config` PVC | Never delete | Critical | The PVC holds the SQLite library, users, and metadata; deleting it wipes the entire server. |
| `stateful_pvc_enabled` | `true` | Critical | Without a persistent PVC, `/config` is ephemeral and the library is lost on every pod restart. |
| `max_instance_count` | `1` | Critical | Multiple replicas write to one SQLite library and corrupt it. |
| `workload_type` vs `stateful_pvc_enabled` | Leave `workload_type` unset | Critical | `Deployment` + `stateful_pvc_enabled = true` fails at plan time; leave unset to auto-resolve to StatefulSet. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `stateful_pvc_size` | Size to library | High | An undersized PVC fills up during metadata/transcode caching and stalls the server. |
| `stateful_fs_group` | `3000` | High | A wrong fsGroup leaves the PVC non-writable by Jellyfin (UID 1000 / GID 2000) — startup fails. |
| `memory_limit` | `1Gi` (raise for large libraries) | High | Too little memory OOM-kills the pod while scanning or transcoding a large library. |
| `cpu_limit` | `1000m` (raise for transcoding) | High | Live transcoding (no GPU) saturates CPU; prefer direct-play clients. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects invalid values. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `enable_api_key` | `true` when externally reachable | Medium | Without it, the API surface relies solely on session auth once exposed. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict the single pod during maintenance, interrupting streams. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short to recover an older library snapshot. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Jellyfin-specific application configuration shared with
the Cloud Run variant is described in **[Jellyfin_Common](Jellyfin_Common.md)**. For
a guided walkthrough, see the [Jellyfin_GKE lab](../labs/Jellyfin_GKE.md).
