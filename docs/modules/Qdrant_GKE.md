---
title: "Qdrant on GKE Autopilot"
---

# Qdrant on GKE Autopilot

Qdrant is a high-performance vector database and similarity search engine built
for AI workloads — RAG pipelines, recommendation systems, semantic search, and
embeddings storage. This module deploys Qdrant on **GKE Autopilot** on top of
the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Qdrant uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Qdrant runs as a stateful vector-database workload on Autopilot. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Qdrant pods, 1 vCPU / 1 GiB by default, horizontally autoscaled |
| Persistent storage (recommended) | Persistent Disk via StatefulSet PVC | Low-latency RWO disk at `/qdrant/storage`; `standard-rwo` (Balanced PD) or `premium-rwo` |
| Persistent storage (alternative) | Cloud Storage via GCS FUSE | Default when PVC is not enabled; `/qdrant/storage` mounted from the `<prefix>-storage` bucket |
| Secrets | Secret Manager | Optional API key (`QDRANT__SERVICE__API_KEY`) |
| Ingress | Cloud Load Balancing | `ClusterIP` by default; `LoadBalancer` or custom domain when external access is needed |

**Sensible defaults worth knowing up front:**

- **No SQL database, no Redis.** Qdrant manages its own embedded storage. No
  Cloud SQL instance is created.
- **Single-instance by default.** `max_instance_count = 1` is strongly
  recommended. Qdrant is a single-writer store — multiple pods against the same
  storage path corrupt collections.
- **StatefulSet PVC strongly recommended for production.** GCS FUSE is the
  default when `stateful_pvc_enabled` is not set, but WAL and HNSW I/O are
  latency-sensitive; a PVC provides significantly lower latency. Set
  `stateful_pvc_enabled = true` for any production deployment.
- **`ClusterIP` by default.** Qdrant should not be exposed publicly without API
  key protection. Change `service_type` to `LoadBalancer` only when needed.
- **Two distinct health endpoints.** Startup uses `/readyz`; liveness uses
  `/livez`. Never point the liveness probe at `/readyz` — Qdrant temporarily
  marks itself not-ready while loading large collections, which would cause
  spurious pod restarts.
- **gRPC is disabled by default.** Enable via `QDRANT__SERVICE__GRPC_PORT=6334`
  in `environment_variables` and configure a second Service port manually.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Qdrant workload

The Qdrant pod runs on Autopilot, which bills for the CPU/memory the pod
actually requests. Horizontal Pod Autoscaling is configured, though the default
`max_instance_count = 1` keeps a single pod running to prevent write conflicts.

- **Console:** Kubernetes Engine → Workloads → select the Qdrant workload for
  pods, events, and resource usage. Kubernetes Engine → Services & Ingress shows
  the ClusterIP (or external IP if `LoadBalancer` is used).
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  # Or for StatefulSet:
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Persistent Storage — StatefulSet PVC or GCS FUSE

Qdrant persists its WAL, collection data, HNSW index files, and metadata at
`/qdrant/storage`. Two storage backends are supported:

**StatefulSet PVC (recommended for production):** A Persistent Disk volume is
bound to the pod via a PersistentVolumeClaim. The storage class is
`standard-rwo` (Balanced PD) by default, or `premium-rwo` for higher IOPS.

**GCS FUSE (default when PVC not enabled):** A Cloud Storage bucket named
`<prefix>-storage` is provisioned and mounted at `/qdrant/storage` via the GCS
FUSE CSI driver.

- **Console (PVC):** Kubernetes Engine → Storage → PersistentVolumeClaims.
  Compute Engine → Disks to see the underlying Persistent Disk.
- **Console (GCS FUSE):** Cloud Storage → Buckets — find the `*-storage` bucket.
- **CLI:**
  ```bash
  # PVC status
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"

  # GCS bucket (when GCS FUSE is used)
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/

  # Confirm mount inside the pod
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls /qdrant/storage
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### C. Secret Manager — Qdrant API key

When `enable_api_key = true`, a 32-character alphanumeric API key is generated
and stored in Secret Manager. It is injected as `QDRANT__SERVICE__API_KEY` at
runtime, requiring all REST and gRPC callers to pass `api-key: <key>` in request
headers.

- **Console:** Security → Secret Manager — look for a secret named
  `<resource-prefix>-api-key`.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<api-key-secret> --project "$PROJECT"
  ```

The API key secret ID is reported in the [Outputs](#5-outputs) as
`qdrant_api_key_secret_id`. See [App_GKE](App_GKE.md) for the Secret
Store CSI integration and rotation.

### D. Networking & ingress

By default the workload is exposed only inside the cluster via a `ClusterIP`
service. Change `service_type` to `LoadBalancer` for external access, or enable
a custom domain with `enable_custom_domain = true` for HTTPS ingress via the
Kubernetes Gateway API.

- **Console:** Kubernetes Engine → Services & Ingress; VPC network → IP
  addresses (when a static IP is reserved).
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  kubectl get ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and
static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks (against `/readyz`) and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Qdrant Application Behaviour

- **No database bootstrap.** Qdrant manages its own embedded storage engine.
  No initialization job is injected by default. The workload starts immediately
  after the pod becomes ready.
- **Collection loading on start.** Qdrant loads all collections from disk into
  memory during startup. For instances with large collections, startup can take
  tens of seconds to several minutes. The startup probe (`/readyz`) waits for
  this to complete before traffic is sent to the pod.
- **Separate liveness and readiness endpoints.** `/readyz` returns 503 while
  collections are loading; `/livez` always returns 200 as long as the process is
  alive. The liveness probe uses `/livez` to prevent spurious pod restarts
  during collection load. Do not change the liveness probe to `/readyz`.
- **gRPC support (optional).** Qdrant supports gRPC on port 6334. It is not
  enabled by default because the default ClusterIP/LoadBalancer Service exposes
  only port 6333. To enable gRPC, add
  `environment_variables = { QDRANT__SERVICE__GRPC_PORT = "6334" }` and
  configure a second Service port manually.
- **Snapshot and maintenance tasks.** Use `cron_jobs` to schedule periodic
  Qdrant collection snapshots via the REST API or for custom maintenance
  routines.
- **Termination grace period.** `termination_grace_period_seconds = 60` by
  default gives Qdrant time to flush in-flight WAL writes before the pod is
  forcibly terminated.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Qdrant are listed; every other input is
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
| `application_name` | `qdrant` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Qdrant Vector Database` | Friendly name shown in the Console. |
| `application_version` | `latest` | Qdrant image version tag; pin to a semver tag for production (e.g. `v1.9.0`). |
| `enable_api_key` | `false` | Generate a random API key in Secret Manager; required for any deployment reachable outside the namespace. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per pod. Increase to `2000m`–`4000m` for production index builds and concurrent queries. |
| `memory_limit` | `1Gi` | Memory per pod. Qdrant loads HNSW indexes into RAM — size based on collection dimensions and vector count. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 to avoid cold starts during index loading. |
| `max_instance_count` | `1` | Maximum replicas. Keep at 1 — Qdrant is a single-writer store. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically (disables CPU/Memory HPA). |
| `enable_image_mirroring` | `true` | Mirror the Qdrant image into Artifact Registry to avoid Docker Hub rate limits. |
| `timeout_seconds` | `300` | Request timeout in seconds (0–3600). Increase for large batch upserts or snapshot operations. |
| `termination_grace_period_seconds` | `60` | Seconds Kubernetes waits after SIGTERM for Qdrant to flush WAL writes. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Use `QDRANT__…` keys to override Qdrant configuration. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation reminder period (30 days default). |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Target cluster name. Auto-discovered when empty. |
| `gke_cluster_selection_mode` | `primary` | Cluster selection strategy: `explicit`, `round-robin`, or `primary`. |
| `namespace_name` | `""` | Kubernetes namespace. Auto-generated when empty. |
| `workload_type` | `null` | `Deployment` or `StatefulSet`. Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true`. |
| `service_type` | `ClusterIP` | How the Service is exposed. `ClusterIP` (recommended), `LoadBalancer`, or `NodePort`. |
| `session_affinity` | `None` | `None` or `ClientIP`. Qdrant does not require session affinity. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources for micro-segmentation. |
| `configure_service_mesh` | `false` | Enable Istio injection for the application namespace. |

### Group 7 — StatefulSet Configuration

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable PVC for StatefulSet. Strongly recommended for production. Setting `true` auto-selects StatefulSet. |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC size. Size to hold all collections, HNSW indexes, and WAL with headroom. |
| `stateful_pvc_mount_path` | `/qdrant/storage` | Container path for the PVC. Must match `QDRANT__STORAGE__STORAGE_PATH`. |
| `stateful_pvc_storage_class` | `standard-rwo` | `standard-rwo` (Balanced PD) or `premium-rwo` for higher IOPS. Cannot be changed after PVC creation. |
| `stateful_headless_service` | `null` | Create a headless Service for stable network identities. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` ensures safe sequential restarts. |
| `stateful_update_strategy` | `null` | `RollingUpdate` for zero-downtime updates. |
| `stateful_fs_group` | `3000` | fsGroup GID set in the pod security context for PVC write access. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `/readyz`, 15s delay | HTTP probe — Qdrant reports ready once all collections are loaded. |
| `liveness_probe` | `/livez`, 30s delay | HTTP probe — dedicated liveness endpoint unaffected by collection load state. |
| `uptime_check_config` | `disabled` | Optional Cloud Monitoring uptime check against `/readyz`. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Qdrant requires no default init job; provide only custom data loading or migration tasks. |
| `cron_jobs` | `[]` | Kubernetes CronJobs for periodic collection snapshots or maintenance tasks. |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside Qdrant. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 13 — NFS

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Qdrant uses GCS or a PVC for storage — enable NFS only for custom init jobs that need a shared filesystem. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `network_tags` | `["nfsserver"]` | GKE node/pod network tags; `nfsserver` is required when NFS is enabled. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the GCS storage bucket (used when PVC is not enabled). |
| `storage_buckets` / `gcs_volumes` | `[]` | Additional buckets / GCS FUSE mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` | `7` | Maximum recent container images to keep in Artifact Registry. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `false` | Provision Kubernetes Gateway API with SSL certificates. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `false` | Reserve a stable external IP. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in via Kubernetes Gateway. Requires `enable_custom_domain`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the GKE Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | `default-waf-policy` | Policy name. |
| `enable_cdn` | `false` | Enable Cloud CDN via GCPBackendPolicy. |

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
| `service_url` | URL to reach the Qdrant REST API. |
| `qdrant_api_key_secret_id` | Secret Manager secret ID for the Qdrant API key. Empty when `enable_api_key = false`. |
| `statefulset_name` | Name of the StatefulSet (when workload type is StatefulSet). |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any custom setup jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Connected GitHub repository. |
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
| `enable_api_key` | `true` (any external deployment) | Critical | Without an API key, any caller who can reach the service can read, modify, or delete all collections. |
| `stateful_pvc_enabled` | `true` for production | Critical | Without a PVC, data lives in the ephemeral pod filesystem; any restart erases all collections permanently. |
| `stateful_pvc_mount_path` | `/qdrant/storage` (default) | Critical | Must match `QDRANT__STORAGE__STORAGE_PATH`. A mismatch stores data in the ephemeral layer and loses it on restart. |
| `application_name` | set once | Critical | Immutable after first deploy; changing recreates the namespace and storage, losing all collections. |
| `max_instance_count` | `1` | High | Multiple Qdrant pods sharing a single PVC (RWO) or GCS bucket corrupt collections. Scale vertically, not horizontally. |
| `liveness_probe` path | `/livez` (default) | High | Pointing liveness at `/readyz` causes spurious pod restarts every time a large collection is loaded from disk. |
| `memory_limit` | ≥ `4Gi` for production | High | Default `1Gi` only supports small test collections; OOM kills terminate all in-flight queries and trigger a full index reload. |
| `stateful_pvc_size` | generous (20 Gi+) | High | An undersized PVC fills as collections grow; a full disk crashes Qdrant. PVC capacity cannot be decreased after creation. |
| `stateful_pvc_storage_class` | `standard-rwo` or `premium-rwo` | Medium | Cannot be changed after PVC creation without data migration; choose based on IOPS requirements upfront. |
| `application_version` | pin to semver for production | Medium | Using `latest` can cause an unintended storage-format upgrade that makes existing collections unreadable. |
| `min_instance_count` | `1` | Medium | Scale-to-zero causes a cold reload of all collections from disk on the next request; avoid for latency-sensitive workloads. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all scheduling. |
| `enable_iap` / `enable_cloud_armor` | enable for exposed deployments | High | Without access controls, the Qdrant REST API is reachable by any caller inside the network. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Qdrant-specific application configuration shared with
the Cloud Run variant is described in **[Qdrant_Common](Qdrant_Common.md)**.
