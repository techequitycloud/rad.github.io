---
title: "Chroma on GKE Autopilot"
description: "Configuration reference for deploying Chroma on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Chroma on GKE Autopilot

Chroma is an AI-native open-source vector database purpose-built for embeddings and
similarity search. It powers RAG pipelines, semantic search, and LangChain/LlamaIndex
workflows. This module deploys Chroma on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud
and Kubernetes infrastructure.

This guide focuses on the cloud services Chroma uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

Chroma runs as a containerised vector-database workload. The deployment wires together
a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | StatefulSet or Deployment pods, 1 vCPU / 1 GiB by default |
| Data persistence | StatefulSet PVC (recommended) or GCS FUSE | PVC-backed for production; GCS FUSE for development or lower-cost deployments |
| Object storage | Cloud Storage | Auto-provisioned `<prefix>-data` bucket; used as primary store when PVC is not enabled |
| Auth token | Secret Manager | Optional API token — `CHROMA_SERVER_AUTHN_CREDENTIALS` injected at runtime |
| Ingress | Cloud Load Balancing | `ClusterIP` by default (internal cluster access); optional `LoadBalancer` with IAP or auth token |

**Sensible defaults worth knowing up front:**

- **No SQL database and no Redis.** Chroma manages its own embedded storage. No Cloud SQL
  instance is created and no Redis connection is configured.
- **`ClusterIP` by default.** The service is reachable only within the cluster; the
  `endpoint_url` output is not accessible from outside the cluster with this default.
  Set `service_type = "LoadBalancer"` only if external access is needed, and enable
  `enable_auth_token` or IAP alongside it.
- **Single-instance recommended.** `max_instance_count = 1` is the default. Multiple
  Chroma pods sharing a single PVC are not supported — concurrent writes would corrupt
  collections.
- **StatefulSet PVC for production.** Setting `stateful_pvc_enabled = true` automatically
  resolves the workload type to `StatefulSet` and disables the GCS FUSE volume at `/data`
  to prevent a double-mount conflict.
- **Auth token is optional but recommended** for any deployment reachable outside the pod
  namespace. When enabled, the token is stored in Secret Manager and must be passed as
  `Authorization: Bearer <token>` in every API call.
- **Health probes are fixed to `/api/v2/heartbeat`.** This is the only health endpoint
  Chroma exposes.
- **Anonymised telemetry is always disabled.** `ANONYMIZED_TELEMETRY=false` is injected
  automatically.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Chroma workload

Chroma pods are scheduled on Autopilot, which bills for the CPU and memory the pods
actually request. The deployment runs as a StatefulSet (when PVC-backed) or a Deployment
(when GCS FUSE-backed), with Horizontal Pod Autoscaling managing replica count.

- **Console:** Kubernetes Engine → Workloads → select the Chroma workload to see pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the service IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe statefulset -n "$NAMESPACE"    # when using StatefulSet
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Data Persistence — StatefulSet PVC or GCS FUSE

Chroma stores its embedded SQLite database, HNSW index files, and collection metadata
in a persistent volume at `/data`. Two storage backends are available:

**StatefulSet PVC (recommended for production):** A Kubernetes PersistentVolumeClaim
backed by a Balanced PD (`standard-rwo`) or SSD (`premium-rwo`) is provisioned per pod,
providing low-latency local-disk access for index reads and writes.

- **Console:** Kubernetes Engine → Storage → PersistentVolumeClaims.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  ```

**GCS FUSE (default when PVC is not enabled):** A Cloud Storage bucket (`<prefix>-data`)
is provisioned and mounted at `/data` via the GCS FUSE CSI driver.

- **Console:** Cloud Storage → Buckets — look for the bucket whose name ends in `-data`.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/chroma/    # inspect Chroma's on-disk layout
  # Confirm the GCS FUSE mount inside a pod:
  kubectl exec -n "$NAMESPACE" <pod-name> -- df -h | grep /data
  ```

See [App_GKE](App_GKE.md) for GCS Fuse, CMEK options, and PVC provisioning.

### C. Secret Manager

When `enable_auth_token = true`, Chroma's API authentication token is generated and
stored as a Secret Manager secret. It is injected into pods at runtime as
`CHROMA_SERVER_AUTHN_CREDENTIALS`; plaintext never appears in configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the token to configure API clients:
  gcloud secrets versions access latest --secret=<prefix>-auth-token --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### D. Networking & ingress

By default the Chroma service is exposed as a `ClusterIP`, accessible only within the
cluster. When `service_type = "LoadBalancer"` is set, an external Cloud Load Balancing
IP is provisioned. A custom domain, static IP, and Cloud Armor can be layered on.

- **Console:** Kubernetes Engine → Services & Ingress; Network services → Load balancing;
  VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  # Test the Chroma heartbeat from inside the cluster:
  kubectl run -n "$NAMESPACE" --rm -it curl --image=curlimages/curl -- \
    curl http://<cluster-ip>:8000/api/v2/heartbeat
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and
static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring. Optional
uptime checks against `/api/v2/heartbeat` and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Chroma Application Behaviour

- **No database bootstrap.** Chroma manages its own embedded storage and requires no
  database initialisation job. No `db-init` job is injected. If you provide custom
  `initialization_jobs`, they run before the application starts.
- **Index loading on start.** When Chroma restarts (after a pod eviction or rolling
  update), it loads its HNSW indexes from the PVC or GCS bucket. For large collections
  this can take tens of seconds; the startup probe at `/api/v2/heartbeat` waits until
  Chroma signals readiness.
- **Single-writer constraint.** Chroma does not have distributed locking over its
  storage. Running more than one pod writing to the same PVC or GCS path will corrupt
  collections. Keep `max_instance_count = 1` unless you are running a Chroma cluster
  deployment with separate storage per pod.
- **Auth token usage.** When `enable_auth_token = true`, all API calls must include
  `Authorization: Bearer <token>`. Retrieve the token from Secret Manager, then use it
  with the Python client:
  ```bash
  # Retrieve token
  TOKEN=$(gcloud secrets versions access latest \
    --secret=<prefix>-auth-token --project "$PROJECT")
  ```
  ```python
  import chromadb
  client = chromadb.HttpClient(
      host="<cluster-ip>", port=8000,
      headers={"Authorization": f"Bearer {TOKEN}"}
  )
  ```
- **Health probe.** Both the startup and liveness probes target `/api/v2/heartbeat`
  with a 15-second initial delay. The probe path is fixed by Chroma_Common and cannot
  be changed.
- **Scheduled tasks.** Chroma has no built-in scheduled commands. Use `cron_jobs` if
  you need periodic collection snapshots or maintenance tasks.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Chroma are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |
| `enable_auth_token` | `false` | Generate a random API token and store it in Secret Manager. Recommended for any deployment reachable outside the cluster namespace. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `chroma` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Chroma Vector Database` | Friendly name shown in the Console. |
| `description` | `Chroma — the AI-native open-source vector database for embeddings and similarity search` | Workload description annotation. |
| `application_version` | `latest` | Chroma image version tag. Pin to a specific version for reproducible deployments. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per pod; increase to `2000m`–`4000m` for production query workloads. |
| `memory_limit` | `1Gi` | Memory per pod. Chroma loads HNSW indexes into memory — size based on collection count and vector dimensions. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 to avoid index-reload cold starts. |
| `max_instance_count` | `1` | Maximum replicas. Keep at 1 — multiple Chroma pods on the same storage will corrupt collections. |
| `timeout_seconds` | `300` | Request timeout. Increase for large batch similarity searches. |
| `enable_image_mirroring` | `true` | Mirror the Chroma image into Artifact Registry to avoid Docker Hub rate limits. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically (disables CPU/memory HPA). |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `ANONYMIZED_TELEMETRY=false` and `CHROMA_SERVER_HTTP_PORT=8000` are always injected. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation reminder period (30 days). |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Name of the GKE cluster. Leave empty for auto-discovery. |
| `gke_cluster_selection_mode` | `primary` | Cluster selection strategy: `explicit`, `round-robin`, or `primary`. |
| `namespace_name` | `""` | Kubernetes namespace. Auto-generated when empty. |
| `workload_type` | `null` | `Deployment` or `StatefulSet`. Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true`. |
| `service_type` | `ClusterIP` | Keep `ClusterIP` for internal cluster access. Set `LoadBalancer` only if external access is needed, and enable auth or IAP alongside it. |
| `session_affinity` | `None` | `None` or `ClientIP`. |
| `termination_grace_period_seconds` | `60` | Grace period for Chroma to flush in-flight writes before the pod is terminated. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |
| `configure_service_mesh` | `false` | Enable Istio injection for the application namespace. |
| `deployment_timeout` | `1800` | Seconds Terraform waits for rollout to complete. |

### Group 7 — StatefulSet Configuration

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable PVC-backed storage for the StatefulSet. Recommended for production. Auto-selects `StatefulSet` workload type and disables the GCS FUSE volume at `/data`. |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC size. HNSW indexes for 1M 1536-dimension vectors require ~6 GiB. Size generously — capacity cannot be reduced after provisioning. |
| `stateful_pvc_mount_path` | `/data` | Container path where the PVC is mounted. Must match Chroma's storage directory. |
| `stateful_pvc_storage_class` | `standard-rwo` | Balanced PD by default. Use `premium-rwo` (SSD) for high HNSW query throughput. |
| `stateful_headless_service` | `null` | Create a headless service for stable pod network identities. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` ensures safe sequential restarts. |
| `stateful_update_strategy` | `null` | `RollingUpdate` for zero-downtime updates. |
| `stateful_fs_group` | `1000` | GID set as the pod-level fsGroup so the PVC is group-writable. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes by Kubernetes and block all pod scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during disruptions. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | `/api/v2/heartbeat` | HTTP probe — Chroma returns 200 once fully initialised. Probe path is fixed. |
| `liveness_probe` / `health_check_config` | `/api/v2/heartbeat` | Liveness probe. |
| `uptime_check_config` | `enabled=false, path=/api/v2/heartbeat` | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Chroma requires no default init job. Provide jobs for custom data loading or migration tasks only. |
| `cron_jobs` | `[]` | Scheduled CronJobs (e.g., collection snapshots or maintenance). |
| `additional_services` | `[]` | Sidecar or helper Kubernetes services deployed alongside Chroma. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 13 — NFS

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Provision Cloud Filestore NFS. Not recommended for primary Chroma storage — prefer PVCs. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the GCS buckets. The `<prefix>-data` bucket is provisioned automatically by Chroma_Common when PVC is not used. |
| `storage_buckets` / `gcs_volumes` | _(set)_ | Additional buckets / GCS FUSE mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention in days. Raise to 30–90 for production. |
| `enable_backup_import` / `backup_source` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — not applicable to Chroma (no SQL database). These
variables are accepted for foundation compatibility but have no effect. See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Kubernetes Gateway API Ingress for custom hostnames. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of the Chroma API. Requires `enable_custom_domain` or `enable_cdn`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. Requires `enable_custom_domain` or `service_type = "LoadBalancer"`. |
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
| `endpoint_url` | Chroma REST API endpoint (`<service-url>:8000`). |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any custom setup jobs. |
| `statefulset_name` | Name of the StatefulSet (when using PVC-backed storage). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
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
| `enable_auth_token` | `true` for any externally reachable deployment | Critical | Without a token any caller who can reach the Chroma API can read, write, or delete every collection. |
| `stateful_pvc_enabled` | `true` for production | High | Without a PVC, Chroma stores data in the ephemeral container filesystem. A pod restart erases all collections and vectors. |
| `stateful_pvc_mount_path` | `/data` | Critical | If the mount path does not match Chroma's storage directory, data is written to the ephemeral layer and silently lost on restart. |
| `stateful_pvc_size` | `20Gi` (size generously) | High | A full PVC causes Chroma to crash with disk-full errors. PVC capacity cannot be reduced after provisioning. |
| `max_instance_count` | `1` | High | Multiple Chroma pods on the same storage will corrupt collections — Chroma has no distributed write lock. |
| `memory_limit` | `4Gi`+ for production | High | Chroma loads HNSW indexes into memory. The default `1Gi` supports only very small collections; OOM kills drop in-flight queries. |
| `workload_type` | set by `stateful_pvc_enabled` | High | Explicitly setting `"Deployment"` alongside `stateful_pvc_enabled = true` fails at plan time. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all pod scheduling. |
| `application_version` | pin to a specific tag | Medium | Using `latest` makes deployments non-reproducible. Chroma data formats can change across major versions. |
| `iap_oauth_client_id` / `_secret` | set before enabling IAP | High | Setting `enable_iap = true` without valid OAuth credentials blocks all traffic. |
| `enable_iap` / `enable_cloud_armor` | enable for externally reachable services | High | Without authentication, an externally exposed Chroma endpoint is fully open. |
| `backup_retention_days` | raise for production | Medium | Too short for disaster recovery; regular GCS or PVC snapshots are the primary recovery path. |
| `min_instance_count` | `1` | Medium | Scale-to-zero causes the pod to be deleted; after scale-up, Chroma must reload indexes from the PVC or GCS, adding startup latency. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Chroma-specific application configuration shared with the
Cloud Run variant is described in **[Chroma_Common](Chroma_Common.md)**.
