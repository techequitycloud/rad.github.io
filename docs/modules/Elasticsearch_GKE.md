---
title: "Elasticsearch on GKE Autopilot"
description: "Configuration reference for deploying Elasticsearch on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Elasticsearch on GKE Autopilot

Elasticsearch is an open-source distributed search and analytics engine based on Apache
Lucene. This module deploys a **single-node Elasticsearch cluster** on **GKE Autopilot**
on top of the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Elasticsearch uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to every
GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Elasticsearch runs as a StatefulSet workload. The deployment wires together a focused
set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Elasticsearch StatefulSet pod, 2 vCPU / 4 GiB by default |
| Persistent storage | Persistent Disk (SSD) | 30 GiB PVC at `/usr/share/elasticsearch/data`, survives pod restarts |
| Secrets | Secret Manager | Optional secrets injected as environment variables |
| Ingress | Cloud Load Balancing | LoadBalancer Service on port 9200 for cross-namespace access |
| Image registry | Artifact Registry | Elasticsearch image mirrored from Elastic's registry |

**No Cloud SQL, no Redis, no GCS buckets** — Elasticsearch is entirely self-contained;
all data lives in its PVC.

**Sensible defaults worth knowing up front:**

- **StatefulSet with PVC is the required workload type.** Setting `stateful_pvc_enabled =
  true` (which auto-selects StatefulSet) gives each pod a dedicated SSD volume that
  survives restarts, rolling updates, and node evictions. Losing the PVC means losing all
  indexed data.
- **Single-node mode** (`discovery.type = single-node`) is enforced at plan time —
  `max_instance_count` is fixed at `1`. Increasing it without changing the discovery type
  creates isolated single-node clusters, not a distributed cluster.
- **JVM heap must be at most half of `memory_limit`.** Elasticsearch needs the other half
  for OS page cache and JVM overhead. Violating this ratio triggers OOM kills under search
  load. A plan-time precondition enforces this rule.
- **`cluster_name` is immutable after first index.** Changing it after documents are
  indexed causes Elasticsearch to treat the existing PVC data as foreign and reject it.
  Choose a meaningful name before the first deploy.
- **Termination grace period is 120 seconds** to allow Elasticsearch to flush in-memory
  segment writes to disk cleanly before the pod is forcibly removed.
- **This module is the required dependency for `RAGFlow_GKE`.** After deployment, the
  `elasticsearch_endpoint` output (`http://<external-ip>:9200`) is passed to RAGFlow's
  `elasticsearch_hosts` variable.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Elasticsearch workload

Elasticsearch runs as a Kubernetes StatefulSet on GKE Autopilot. Autopilot bills for
the CPU and memory the pod actually requests. A PodDisruptionBudget keeps the pod
available during node upgrades.

- **Console:** Kubernetes Engine → Workloads → select the Elasticsearch StatefulSet to
  see pod status, events, and the PVC attachment. Kubernetes Engine → Services & Ingress
  shows the LoadBalancer external IP on port 9200.
- **CLI:**
  ```bash
  kubectl get statefulsets,pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" <pod-name> --tail=100
  kubectl describe pvc -n "$NAMESPACE"          # confirm PVC is Bound
  ```

See [App_GKE](App_GKE.md) for Autopilot scaling, PDB, and the StatefulSet
lifecycle.

### B. Persistent Disk — index storage

All Elasticsearch indexes and shard files reside on a **Persistent Disk (SSD)** backed
PersistentVolumeClaim. The PVC is provisioned by the `standard-rwo` (or `premium-rwo`)
StorageClass and mounted at `/usr/share/elasticsearch/data`.

- **Console:** Kubernetes Engine → Storage → PersistentVolumeClaims to see size and
  binding state. Compute Engine → Disks shows the underlying disk.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  # Check disk usage inside the pod:
  kubectl exec -n "$NAMESPACE" <pod-name> -- df -h /usr/share/elasticsearch/data
  ```

Monitor disk-fill watermarks — Elasticsearch switches indexes to read-only at 95%
capacity by default. Plan PVC size with 50–100% headroom above expected data volume.

### C. Elasticsearch service endpoint

The Elasticsearch HTTP API is exposed on port 9200 through a Kubernetes LoadBalancer
Service. This external IP is the `elasticsearch_endpoint` output and is passed directly
to RAGFlow and other consumers.

- **Console:** Kubernetes Engine → Services & Ingress → select the service for the
  external IP and port mapping.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  # Verify the cluster is up and healthy:
  curl http://<elasticsearch-endpoint>/_cluster/health?pretty
  curl http://<elasticsearch-endpoint>/_cat/indices?v
  # List all indexes:
  curl http://<elasticsearch-endpoint>/_cat/indices?h=index,docs.count,store.size
  ```

### D. Secret Manager

Optional secrets (such as custom credentials or API keys) are stored in Secret Manager
and injected as environment variables at pod startup.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Artifact Registry — container image

The official `docker.elastic.co/elasticsearch/elasticsearch:<version>` image is
mirrored into Artifact Registry before each deployment (when `enable_image_mirroring =
true`). This avoids Elastic registry rate limits and keeps images within your VPC
perimeter.

- **Console:** Artifact Registry → select the repository for tags, digests, and
  vulnerability scan results.
- **CLI:**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list "$REGION-docker.pkg.dev/$PROJECT/<repo>" --project "$PROJECT"
  ```

### F. Networking & ingress

The LoadBalancer Service exposes Elasticsearch on port 9200. A static external IP can
be reserved. Cloud Armor can be layered on the Ingress backend for WAF protection (though
for Elasticsearch, network-level restrictions — firewall rules and `enable_network_segmentation`
— are usually preferred over browser-facing WAF rules).

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, static IPs, and Cloud
Armor details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr (Elasticsearch logs) flow to Cloud Logging. GKE metrics flow to Cloud
Monitoring. Optional uptime checks can probe `/_cluster/health`.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Elasticsearch Application Behaviour

- **Single-node operation.** The module deploys Elasticsearch with
  `discovery.type = single-node`, which disables cluster coordination. This is the
  correct and supported mode for a one-pod deployment. Do not increase
  `max_instance_count` beyond `1` without also overriding `discovery.type` — running
  multiple single-node clusters in parallel results in data isolation, not distribution.
- **Persistent index storage.** All data lives in the PVC at
  `/usr/share/elasticsearch/data`. The path is enforced — changing `stateful_pvc_mount_path`
  without updating the `path.data` setting causes writes to land in the ephemeral
  container layer and be silently lost on the next pod restart.
- **JVM heap sizing.** `ES_JAVA_OPTS` is automatically set to `-Xms<heap> -Xmx<heap>`
  from the `es_java_heap` variable. Elasticsearch's heap must be no more than half of
  `memory_limit` — the rest is consumed by Lucene's off-heap segment cache, JVM
  metaspace, and native memory. A plan-time precondition enforces this rule.
- **mmap disabled.** GKE Autopilot does not allow privileged `initContainers` to raise
  `vm.max_map_count`. Accordingly, the module sets `node.store.allow_mmap = false`, which
  prevents mmap-based memory-mapped files and incurs a minor sequential-read penalty
  compared to mmap mode. This is a known GKE Autopilot constraint.
- **Health probes target `/_cluster/health`.** Both the startup probe and liveness probe
  issue HTTP GET requests to `/_cluster/health`. The startup probe allows up to 18
  attempts (approximately 3 minutes) to accommodate the initial shard recovery period
  after the PVC is first attached. When `enable_xpack_security = true`, override both
  probe configs to use TCP — HTTP probes return `401 Unauthorized` when authentication
  is required.
- **X-Pack security is disabled by default.** With `enable_xpack_security = false`, the
  HTTP endpoint accepts unauthenticated requests. Any caller who can reach port 9200 can
  read, write, or delete all indexes. This is acceptable for a cluster accessible only
  within the VPC; enable it for public or multi-tenant deployments.
- **Cluster name is baked into node identity.** Changing `cluster_name` after the first
  index is created causes Elasticsearch to treat the existing PVC data as foreign and
  fail to start. A rename requires destroying the PVC and re-indexing all documents.
- **No initialization jobs are required.** Elasticsearch bootstraps itself on first
  start. There is no database or user creation step.
- **Termination grace period.** Kubernetes waits 120 seconds after sending SIGTERM
  before forcibly killing the pod. This allows Elasticsearch to flush translog entries
  and close shards cleanly, avoiding a potentially slow recovery from the translog on
  the next startup.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Elasticsearch are listed; every other input is inherited from
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
| `application_name` | `elasticsearch` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Elasticsearch` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `8.13.4` | Elasticsearch image version tag; increment to roll out a new version. |
| `cluster_name` | `ragflow` | Sets `cluster.name` inside Elasticsearch. **Immutable after first index** — rename requires full PVC destroy and re-index. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision the namespace and IAM without deploying the workload. |
| `container_image_source` | `prebuilt` | Always `prebuilt` — Elasticsearch uses the official Elastic image. |
| `container_image` | `""` | Override image URI; leave empty to use the official Elasticsearch image. |
| `enable_image_mirroring` | `true` | Mirror the image from Elastic's registry into Artifact Registry before deploy. |
| `min_instance_count` | `1` | Keep at `1` for single-node mode. |
| `max_instance_count` | `1` | **Fixed at `1`** — enforced at plan time. Increasing without overriding `discovery.type` creates isolated clusters. |
| `container_port` | `9200` | Elasticsearch HTTP API port. |
| `cpu_limit` | `2000m` | CPU per pod. 2 vCPU is the recommended baseline; scale to `4000m` for heavy indexing. |
| `memory_limit` | `4Gi` | Memory per pod. **Must be at least 2× `es_java_heap`.** |
| `es_java_heap` | `512m` | JVM heap (`-Xms` and `-Xmx`). **Must be ≤ half of `memory_limit`** — enforced at plan time. |
| `enable_xpack_security` | `false` | Enable X-Pack security (authentication). When `false`, port 9200 is unauthenticated. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |
| `timeout_seconds` | `300` | Load balancer backend timeout (0–3600 seconds). |
| `termination_grace_period_seconds` | `120` | Seconds Kubernetes waits after SIGTERM for segment flush before force-killing. |
| `deployment_timeout` | `1800` | Seconds Terraform waits for the StatefulSet rollout to complete. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra env vars merged into the container **after** the auto-injected Elasticsearch settings; can override any auto-set value (e.g., `discovery.type`, `ES_JAVA_OPTS`). |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification cadence. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `gke_cluster_name` | `""` | GKE cluster name; leave empty for auto-discovery. |
| `namespace_name` | `""` | Kubernetes namespace; auto-generated when empty. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true`. |
| `service_type` | `LoadBalancer` | `LoadBalancer` is required for cross-namespace access from RAGFlow. Use `ClusterIP` only when both workloads share the same namespace. |
| `session_affinity` | `None` | Session affinity. `None` is correct for Elasticsearch (stateless HTTP). |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources to restrict ingress/egress. |
| `termination_grace_period_seconds` | `120` | Also shown in Group 4; set once here. |
| `deployment_timeout` | `1800` | Also shown in Group 4; set once here. |
| `network_tags` | `["nfsserver"]` | GKE node/pod network tags for firewall rules. |

### Group 7 — StatefulSet & Persistence

Data persistence is critical — all Elasticsearch index data lives in the PVC.

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | **Set `true` for all deployments** — auto-selects StatefulSet. Without a PVC, all indexes are lost on every pod restart. |
| `stateful_pvc_size` | `30Gi` | PVC size. Plan with 50–100% headroom; Elasticsearch goes read-only at 95% disk use. |
| `stateful_pvc_mount_path` | `/usr/share/elasticsearch/data` | **Do not change** — must match Elasticsearch's `path.data` setting. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass. Use `premium-rwo` for high-throughput vector kNN indexing. StorageClass cannot be changed after PVC creation. |
| `stateful_headless_service` | `null` | Set `true` to create a headless Service for stable pod DNS entries. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` or `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` or `OnDelete`. |
| `stateful_fs_group` | `0` | Pod `fsGroup` GID. Set to `1000` so the Elasticsearch process (UID/GID 1000) can write to the PVC. Leaving at `0` causes immediate startup failure — the process cannot write to a root-owned volume. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_cpu_requests` / `quota_cpu_limits` | `""` | CPU quota strings (e.g., `"4000m"`). |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes by Kubernetes and block all pod scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | For a single-node cluster, `"1"` prevents any voluntary disruption — scale to 2+ replicas before reducing this. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/_cluster/health`, 18 retries | Generous threshold (≈3 min) for initial shard recovery. Override to TCP when `enable_xpack_security = true`. |
| `health_check_config` | HTTP `/_cluster/health`, 3 retries | Liveness probe. Override to TCP when `enable_xpack_security = true`. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check against `/_cluster/health`. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Kubernetes Jobs run before the Elasticsearch pod starts. Not required for Elasticsearch — it bootstraps itself. |
| `cron_jobs` | `[]` | Recurring Kubernetes CronJobs (e.g., index lifecycle management tasks). |
| `additional_services` | `[]` | Sidecar or helper GKE services deployed alongside Elasticsearch. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Group 13 — Filesystem (NFS)

NFS is not required for Elasticsearch — all data lives in the StatefulSet PVC.
The NFS variables are present for foundation-interface compatibility but default to
disabled (`enable_nfs = false`). See [App_GKE](App_GKE.md) for details.

### Group 14 — Cloud Storage & Artifact Registry

Cloud Storage buckets are not required for Elasticsearch (`create_cloud_storage =
false` by default). The Artifact Registry variables control the image retention policy
for the mirrored Elasticsearch image:

| Variable | Default | Description |
|---|---|---|
| `max_images_to_retain` | `7` | Maximum recent images to keep in Artifact Registry. |
| `delete_untagged_images` | `true` | Automatically delete untagged images. |
| `image_retention_days` | `30` | Age after which images are eligible for deletion. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK encryption options. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Backup cron schedule (UTC). For Elasticsearch, consider native Elasticsearch Snapshots to GCS rather than OS-level backups. |
| `backup_retention_days` | `7` | Retention in days; raise for production/compliance. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostname + managed certificate. Only takes effect once `application_domains` is non-empty. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `network_tags` | `["nfsserver"]` | GKE pod network tags for firewall rules. |

### Group 20 — Identity-Aware Proxy (IAP)

IAP is **not recommended** for Elasticsearch — use network-level controls
(`enable_network_segmentation`, firewall rules) instead. IAP variables are present
for completeness.

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Elasticsearch. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled. |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | `default-waf-policy` | Policy name. |
| `enable_cdn` | `false` | Not applicable for Elasticsearch. |

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
| `elasticsearch_endpoint` | Primary output for RAGFlow. `http://<service_external_ip>:9200`. Pass this to `RAGFlow_GKE`'s `elasticsearch_hosts` variable. Returns `null` until the external IP is assigned. |
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP. |
| `service_url` | Service URL. |
| `statefulset_name` | Name of the StatefulSet resource. |
| `storage_buckets` | Created Cloud Storage buckets (empty list — no buckets are provisioned). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any setup jobs run before the workload. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Connected GitHub repository details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | `true` when the cluster endpoint is available and all workload resources are deployed. `false` on the first apply of a new cluster — the CI/CD pipeline must re-run apply to complete the deployment. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critical | Without a PVC all indexes are stored in the ephemeral pod filesystem and permanently lost on every restart, rolling update, or node eviction. |
| `stateful_pvc_mount_path` | `/usr/share/elasticsearch/data` | Critical | Must match `path.data`. A mismatch silently writes indexes to the ephemeral layer — data is lost on each restart. |
| `cluster_name` | set once | Critical | Immutable after first index. Renaming causes Elasticsearch to reject all PVC data as foreign; a full re-index is required. |
| `es_java_heap` vs `memory_limit` | heap ≤ `memory_limit / 2` | Critical | Heap exceeding half the container memory competes with Lucene's page cache; OOM kills occur under search load. Plan-time precondition enforces this. |
| `stateful_fs_group` | `1000` | Critical | Elasticsearch runs as UID/GID 1000. `fsGroup = 0` leaves the PVC root-owned; the process cannot write to it and crashes immediately on startup. |
| `max_instance_count` | `1` | Critical | Increasing without overriding `discovery.type` creates isolated single-node clusters. Enforced at plan time. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`) | Critical | Bare integers are bytes and block all scheduling immediately. |
| `enable_xpack_security` | `true` for production | High | With `false`, any caller who can reach port 9200 can read, write, or delete all indexes without credentials. |
| `stateful_pvc_size` | size with 50–100% headroom | High | An undersized PVC triggers flood-stage watermark protection at 95% full; the index becomes read-only. |
| `stateful_pvc_storage_class` | `standard-rwo` (or `premium-rwo` for production) | Medium | `standard-rwo` is adequate for typical search workloads; high-throughput vector kNN indexing benefits from `premium-rwo`. StorageClass cannot be changed after PVC creation. |
| `memory_limit` | ≥ `2 × es_java_heap` | Critical | Insufficient memory headroom triggers OOM kills during search/indexing. |
| `startup_probe_config` | HTTP → TCP when X-Pack enabled | High | HTTP probes return `401 Unauthorized` with X-Pack security; the pod never passes readiness and enters a restart loop. |
| `enable_image_mirroring` | `true` | Low | Disabling mirroring pulls directly from Elastic's registry; rate limits can cause intermittent deployment failures. |
| `application_version` | `8.13.4` (or locked version) | Medium | Major version upgrades (7.x → 8.x) may require index compatibility checks; do not upgrade without reviewing the Elasticsearch migration guide. |
| `pdb_min_available` vs `min_instance_count` | headroom | Medium | `pdb_min_available = "1"` with a single-pod cluster prevents any voluntary disruption (e.g., node upgrades) from proceeding. Scale to 2+ pods or accept the constraint. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
