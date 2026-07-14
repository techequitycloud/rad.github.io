---
title: "Meilisearch on GKE Autopilot"
description: "Configuration reference for deploying Meilisearch on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Meilisearch on GKE Autopilot

Meilisearch is a fast, open-source search engine — a single Rust binary that
delivers instant, typo-tolerant, faceted search behind a simple REST API. It is
widely used as a self-hostable alternative to Algolia. This module deploys
Meilisearch on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation,
which provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Meilisearch uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

Meilisearch runs as a single-binary Rust workload, ideally as a StatefulSet with a
Persistent Disk PVC. The deployment wires together a focused set of Google Cloud
services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Rust binary, 1 vCPU / 1 GiB by default, single replica (single-writer) |
| Persistent storage | Persistent Disk PVC or Cloud Storage (GCS FUSE) | `MEILI_DB_PATH` is fixed at `/meili_data`, and GCS FUSE mounts there automatically; the StatefulSet PVC's `stateful_pvc_mount_path` defaults to a different path (`/meilisearch/storage`) — override it to `/meili_data` to align the two |
| Database | None | Meilisearch is self-contained — no Cloud SQL, no external database |
| Cache & queue | None | Meilisearch has no Redis or queue dependency |
| Secrets | Secret Manager → native K8s Secret | Auto-generated `MEILI_MASTER_KEY` (the search admin credential) |
| Ingress | Cloud Load Balancing (optional) | ClusterIP by default; optional external Gateway + managed certificate |

**Sensible defaults worth knowing up front:**

- **No database, no Redis.** Meilisearch persists everything — indexes, documents,
  settings, tasks — to the `/meili_data` directory. There is no Cloud SQL instance
  and no Redis to operate.
- **The master key is mandatory.** Meilisearch runs in production mode
  (`MEILI_ENV = production`), which refuses to start without a ≥16-byte
  `MEILI_MASTER_KEY`. The module generates a 32-character key, stores it in Secret
  Manager, and injects it as a **native Kubernetes Secret** (`explicit_secret_values`).
- **StatefulSet PVC recommended.** Set `stateful_pvc_enabled = true` for a
  Persistent Disk PVC (`stateful_pvc_size = "20Gi"` default) — the lower-latency,
  production-grade storage option. Its mount path defaults to `/meilisearch/storage`,
  which does **not** match the fixed `MEILI_DB_PATH` (`/meili_data`) — set
  `stateful_pvc_mount_path = "/meili_data"` explicitly so the PVC actually backs
  Meilisearch's data directory. Without the PVC, the storage bucket is mounted via
  GCS FUSE at `/meili_data`. Setting the PVC skips the FUSE mount to avoid a
  double-mount.
- **ClusterIP by default.** `service_type = "ClusterIP"` keeps the search API inside
  the cluster. Expose it externally via the Gateway (`enable_custom_domain`) only
  when needed.
- **Single replica.** `max_instance_count = 1`. Meilisearch is single-writer;
  multiple pods sharing one PVC (RWO) or bucket corrupt the index. Scale vertically.
- **Image is pinned to `v1.11`.** The `application_version = "latest"` default maps
  to the `getmeili/meilisearch:v1.11` build; pin a specific release in production.
- **Health at `/health`.** Startup and liveness probes both target `/health`, which
  returns `{"status":"available"}` once the engine is ready.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Meilisearch workload

Meilisearch runs as a single-replica StatefulSet (or Deployment) on Autopilot,
which bills for the CPU/memory the pod actually requests. Because Meilisearch is
single-writer, the workload is pinned to one replica.

- **Console:** Kubernetes Engine → Workloads → select the Meilisearch workload to
  see pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  Service.
- **CLI:**
  ```bash
  kubectl get pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pvc -n "$NAMESPACE"          # PVC capacity and binding
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Persistent storage — PVC or Cloud Storage

Meilisearch data lives at `/meili_data` (`MEILI_DB_PATH`, fixed). With
`stateful_pvc_enabled = true` this is a Persistent Disk PVC (`standard-rwo` by
default) — but only if `stateful_pvc_mount_path` is set to `/meili_data`; its
default (`/meilisearch/storage`) does not match, so override it explicitly.
Otherwise it is the `storage` Cloud Storage bucket mounted via GCS FUSE, which does
use `/meili_data` automatically. Either way, this volume is the source of
truth for all indexes and documents — there is no separate database.

- **Console:** Kubernetes Engine → Storage (PVCs); Cloud Storage → Buckets.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud storage buckets list --project "$PROJECT"     # when GCS FUSE is used
  ```

See [App_GKE](App_GKE.md) for StatefulSet PVCs, CMEK options, and GCS FUSE mounts.

### C. Secret Manager — the master key

A single cryptographic secret is generated automatically and stored in Secret
Manager: `MEILI_MASTER_KEY`, the search admin credential. On GKE it is materialised
as a **native Kubernetes Secret** and injected as an environment variable. The
master key can create/delete indexes and mint scoped API keys, so treat it as a root
credential and issue scoped keys (`POST /keys`) to applications.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  kubectl get secret -n "$NAMESPACE"       # the synced native K8s Secret
  ```

The master key secret ID is in the [Outputs](#5-outputs) (`meilisearch_api_key_secret_id`).
See [App_GKE](App_GKE.md) for the secret injection model and rotation.

### D. Networking & ingress

By default the workload is exposed as a ClusterIP Service, reachable only inside the
cluster. A custom domain with a Google-managed certificate can be enabled through the
Gateway API, and a static IP can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get gateway,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available against `/health`.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Meilisearch Application Behaviour

- **No initialization job.** Meilisearch manages its own storage and needs no
  database bootstrap, so no `db-init` job runs. The first request that creates an
  index lazily initialises the `/meili_data` directory.
- **Production mode requires the master key.** With `MEILI_ENV = production`,
  Meilisearch will not start unless `MEILI_MASTER_KEY` is at least 16 bytes.
  Production mode also disables the built-in web mini-dashboard — interact via the
  REST API.
- **Everything is an API call.** From inside the cluster (or through a port-forward),
  create an index, add documents, and search with the master key as a Bearer token:
  ```bash
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 7700:7700 &
  KEY=$(gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT")

  # Add documents (creates the index on first write):
  curl -X POST "http://localhost:7700/indexes/movies/documents" \
    -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    --data '[{"id":1,"title":"Interstellar"},{"id":2,"title":"Inception"}]'

  # Search (note the deliberate typo — Meilisearch is typo-tolerant):
  curl "http://localhost:7700/indexes/movies/search" \
    -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    --data '{"q":"interstellr"}'
  ```
- **Scoped API keys.** Do not ship the master key to browsers or apps. Mint scoped,
  expiring keys with `POST /keys` (using the master key) limited to specific indexes
  and actions (e.g. search-only), and distribute those.
- **PVC path must match `MEILI_DB_PATH`.** `stateful_pvc_mount_path` defaults to
  `/meilisearch/storage`, which does **not** match the fixed `MEILI_DB_PATH`
  (`/meili_data`). Set `stateful_pvc_mount_path = "/meili_data"` explicitly when
  enabling the PVC, or writes land on a volume Meilisearch never reads from.
- **Health path.** Startup and liveness probes target `/health`, which returns
  `{"status":"available"}` when the engine is ready:
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- \
    wget -qO- http://localhost:7700/health
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Meilisearch are listed; every other input is
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
| `application_name` | `meilisearch` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Meilisearch image tag; `latest` maps to the pinned `v1.11` build. Pin a release in production. |
| `enable_api_key` | `true` | Generate the `MEILI_MASTER_KEY` in Secret Manager and inject it as a native K8s Secret. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per pod. |
| `memory_limit` | `1Gi` | Memory per pod; Meilisearch holds hot index structures in memory — raise for large indexes. |
| `min_instance_count` | `1` | GKE keeps at least one replica warm. |
| `max_instance_count` | `1` | **Keep at 1.** Meilisearch is single-writer; multiple pods corrupt the index. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_vertical_pod_autoscaling` | `false` | Enable VPA to right-size CPU/memory. |
| `enable_image_mirroring` | `true` | Mirror the Meilisearch image into Artifact Registry. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra `MEILI_*` settings. Core values are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Cluster name; empty auto-discovers. |
| `service_type` | `ClusterIP` | How the Kubernetes Service is exposed. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Session affinity mode. |
| `termination_grace_period_seconds` | `60` | Seconds after SIGTERM before SIGKILL — lets Meilisearch flush pending writes. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Set `true` for a Persistent Disk PVC (recommended). Auto-selects StatefulSet. |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC size; cannot be decreased after creation. |
| `stateful_pvc_mount_path` | `/meilisearch/storage` | Container mount path. Default does **not** match the fixed `MEILI_DB_PATH` (`/meili_data`) — set this to `/meili_data` explicitly when using the PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | `standard-rwo` (Balanced PD) or `premium-rwo` (higher IOPS). |
| `stateful_fs_group` | `3000` | fsGroup GID for PVC write access. |
| `stateful_headless_service` / `stateful_pod_management_policy` / `stateful_update_strategy` | `null` | Foundation defaults for stable identities, ordered restarts, rolling updates. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Create a namespace ResourceQuota. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary suffixes** (`4Gi`, `8192Mi`); bare integers are bytes and block scheduling. |
| `quota_cpu_requests` / `quota_cpu_limits` / `quota_max_pods` / `quota_max_services` / `quota_max_pvcs` | `""` | Namespace resource caps. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health` 15s delay | Startup probe; returns `{"status":"available"}` when ready. |
| `liveness_probe` | HTTP `/health` 30s delay | Liveness probe (same endpoint). |
| `startup_probe_config` | HTTP `/health` | App_GKE-level structured startup probe. |
| `health_check_config` | HTTP `/health` | App_GKE-level structured liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check against `/health`. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Meilisearch requires no default init job; provide jobs only for custom data loading. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs (e.g., dump snapshots). |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside Meilisearch. |

### Group 12 — CI/CD & Binary Authorization

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Meilisearch uses GCS or a PVC for storage; NFS is off by default. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `network_tags` | `["nfsserver"]` | Node/pod network tags; `nfsserver` is required when `enable_nfs = true`. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | The `<prefix>-storage` bucket is always created (used at `/meili_data` when no PVC). |
| `storage_buckets` | `[]` | Additional buckets to provision. |
| `gcs_volumes` | `[]` | Additional GCS FUSE mounts (the storage bucket is added automatically when PVC is not used). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Artifact Registry cleanup policy. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup/dump on deploy (`backup_format` defaults to `tar`). |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision the Gateway for custom hostnames + managed certificate. Only takes effect once `application_domains` is non-empty. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` / `static_ip_name` | `true` / `""` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

> **Warning:** IAP requires Google identity authentication for **all** inbound
> requests, including calls from applications querying the search API. Enable it for
> a locked-down, human-facing endpoint; mint scoped API keys for programmatic access.

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Meilisearch (requires `enable_custom_domain`). |
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
| `service_url` | URL to reach the Meilisearch REST API. |
| `meilisearch_api_key_secret_id` | Secret Manager secret ID for the master key. Empty when `enable_api_key = false`. |
| `statefulset_name` | Name of the StatefulSet (when workload type is StatefulSet). |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any custom setup jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `Deployment` workload with a PVC enabled, IAP with no authorized identities or OAuth client, memory quotas without binary suffixes, an out-of-range `backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_api_key` | `true` | Critical | Disabling it removes the master key; in production mode Meilisearch refuses to start, and if it did run, anyone reaching the Service could read or delete every index. |
| `max_instance_count` | `1` | Critical | More than one pod sharing the RWO PVC or GCS bucket corrupts the index. |
| `stateful_pvc_mount_path` | set to `/meili_data` | Critical | Defaults to `/meilisearch/storage`, which does not match the fixed `MEILI_DB_PATH`; left at the default, the PVC never receives the index data and it appears empty. |
| `stateful_pvc_size` | size to dataset | Critical | Cannot be decreased after creation; too small and the PVC fills, halting writes. |
| `workload_type` vs `stateful_pvc_enabled` | let `stateful_pvc_enabled` drive it | Critical | `workload_type = "Deployment"` with `stateful_pvc_enabled = true` is rejected at plan time; the PVC needs a StatefulSet. |
| `MEILI_MASTER_KEY` (auto-generated) | Rotate only with client updates | High | Rotating the key without updating clients breaks all authenticated search and admin calls. |
| `stateful_pvc_enabled` | `true` for production | High | GCS FUSE has higher latency than a PD PVC; a busy index performs noticeably better on a PVC. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `memory_limit` | `1Gi`+ | High | Too little memory for a large index causes OOM kills under query load. |
| `enable_iap` | for a private, human-facing endpoint | Medium | IAP requires Google identity for every request; it also blocks unauthenticated app/service calls — use scoped API keys for those. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict the single pod during maintenance, causing a search outage. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short to recover from an accidental index deletion discovered late. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Meilisearch-specific application configuration shared
with the Cloud Run variant is described in
**[Meilisearch_Common](Meilisearch_Common.md)**.
