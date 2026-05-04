# Elasticsearch_GKE Module — Configuration Guide

Elasticsearch is an open-source distributed search and analytics engine based on Apache Lucene.
This module deploys a **single-node Elasticsearch cluster** on **GKE Autopilot** as a
Kubernetes StatefulSet with persistent SSD storage. It is designed as a shared search
infrastructure dependency — primarily for `RAGFlow_GKE`, which uses it for document vector
storage and full-text search.

`Elasticsearch_GKE` is a **wrapper module** built on top of `App_GKE`. It delegates all GCP
infrastructure provisioning to `App_GKE` and assembles the Elasticsearch-specific configuration
locally using a `locals` block (there is no separate `*_Common` module).

> `Elasticsearch_GKE` must be deployed **before** `RAGFlow_GKE`. After deployment, run
> `tofu output elasticsearch_endpoint` and pass the result to `RAGFlow_GKE`'s
> `elasticsearch_hosts` variable.

---

## §1 · Module Overview

### What `Elasticsearch_GKE` provides

- An **Elasticsearch StatefulSet** (prebuilt `docker.elastic.co/elasticsearch/elasticsearch`
  image, optionally mirrored to Artifact Registry) with a **LoadBalancer service** on port
  9200, enabling cross-namespace access from `RAGFlow_GKE`.
- A **PersistentVolumeClaim** (30 Gi SSD by default) mounted at
  `/usr/share/elasticsearch/data` for durable index storage.
- A **headless Kubernetes Service** providing stable pod DNS entries.
- **No Cloud SQL**, **no Redis**, **no GCS buckets** — Elasticsearch is self-contained.
- Probes use TCP (not HTTP) because HTTP probes would fail on Elasticsearch 9.x with
  X-Pack security enabled. TCP probes validate port readiness regardless of auth state.

### Key differences from `App_GKE` defaults

| Feature | App_GKE default | Elasticsearch_GKE default |
|---|---|---|
| `container_port` | `8080` | `9200` |
| `workload_type` | `"Deployment"` | `"StatefulSet"` |
| `service_type` | varies | `"LoadBalancer"` |
| `session_affinity` | `"None"` | `"None"` |
| `min_instance_count` | `1` | `1` (single-node mode) |
| `max_instance_count` | `3` | `1` (single-node mode) |
| `termination_grace_period_seconds` | `60` | `120` (segment flush time) |
| `deployment_timeout` | `600` | `1800` (shard recovery) |
| `stateful_pvc_enabled` | `false` | `true` |
| `stateful_pvc_size` | `"10Gi"` | `"30Gi"` |
| `stateful_pvc_mount_path` | `"/data"` | `"/usr/share/elasticsearch/data"` |
| `stateful_headless_service` | `false` | `true` |
| `enable_pod_disruption_budget` | `true` | `true` |
| `image_source` | varies | `"prebuilt"` |
| `database_type` | varies | `"NONE"` (hard-coded) |
| `enable_cloudsql_volume` | `true` | `false` (hard-coded) |
| `enable_redis` | varies | `false` (hard-coded) |
| `create_cloud_storage` | `true` | `false` |
| `enable_nfs` | `false` | `false` |
| `module_dependency` | varies | `["Services_GCP"]` |
| `credit_cost` | varies | `80` |

### Architecture

```
Elasticsearch_GKE
└── App_GKE (foundation module)
    ├── GKE Autopilot cluster
    ├── Kubernetes StatefulSet (elasticsearch)
    │   ├── PVC: 30Gi at /usr/share/elasticsearch/data
    │   └── fsGroup=1000 (UID of the elasticsearch process)
    ├── Kubernetes Service (LoadBalancer on port 9200)
    ├── Headless Service (stable pod DNS)
    └── PodDisruptionBudget (min 1 available)
```

### Automatically injected environment variables

The module assembles a local `es_env_vars` map that is always injected, regardless of
`environment_variables`:

| Variable | Value | Purpose |
|---|---|---|
| `discovery.type` | `"single-node"` | Disables cluster discovery for single-node operation. |
| `cluster.name` | `var.cluster_name` | Elasticsearch cluster name. |
| `network.host` | `"0.0.0.0"` | Binds to all interfaces for Kubernetes service forwarding. |
| `http.port` | `var.container_port` | HTTP API port (default `9200`). |
| `transport.port` | `"9300"` | Internal transport port. |
| `path.data` | `"/usr/share/elasticsearch/data"` | Data directory (must match `stateful_pvc_mount_path`). |
| `path.logs` | `"/usr/share/elasticsearch/logs"` | Log directory. |
| `ES_JAVA_OPTS` | `"-Xms<heap> -Xmx<heap>"` | JVM heap sizing from `es_java_heap`. |
| `xpack.security.enabled` | `var.enable_xpack_security` | X-Pack security toggle. |
| `xpack.security.http.ssl.enabled` | `"false"` | TLS disabled (HTTP only). |
| `indices.memory.index_buffer_size` | `"10%"` | Indexing buffer fraction. |
| `bootstrap.memory_lock` | `"false"` | Required on GKE Autopilot (no privileged initContainers). |
| `node.store.allow_mmap` | `"false"` | Disables mmap — required because GKE Autopilot cannot raise `vm.max_map_count` via privileged initContainers. Incurs a minor sequential-read penalty vs. mmap mode. |

User-supplied `environment_variables` are merged **after** these defaults, so they can
override any of the above.

---

## §2 · IAM & Project Identity (Group 0 & 1)

| Variable | Type | Default | Description |
|---|---|---|---|
| `module_description` | `string` | *(Elasticsearch GKE description)* | Platform UI description. `{{UIMeta group=0 order=1}}` |
| `module_documentation` | `string` | `"https://docs.radmodules.dev/docs/applications/elasticsearch"` | Documentation URL. `{{UIMeta group=0 order=2}}` |
| `module_dependency` | `list(string)` | `["Services_GCP"]` | Modules that must be deployed first. `{{UIMeta group=0 order=3}}` |
| `module_services` | `list(string)` | `["Google Kubernetes Engine", "Persistent Disk", ...]` | GCP services consumed. `{{UIMeta group=0 order=4}}` |
| `credit_cost` | `number` | `80` | Platform credits consumed on deployment. `{{UIMeta group=0 order=5}}` |
| `require_credit_purchases` | `bool` | `true` | Enforce credit balance check. `{{UIMeta group=0 order=6}}` |
| `enable_purge` | `bool` | `true` | Permit full deletion on destroy. `{{UIMeta group=0 order=7}}` |
| `public_access` | `bool` | `false` | Platform UI visibility. `{{UIMeta group=0 order=8}}` |
| `deployment_id` | `string` | `""` | Fixed deployment ID; auto-generated when blank. `{{UIMeta group=0 order=9}}` |
| `resource_creator_identity` | `string` | `"rad-module-creator@tec-rad-ui-2b65.iam.gserviceaccount.com"` | Terraform service account. `{{UIMeta group=0 order=9}}` |
| `project_id` | `string` | **required** | GCP project ID. `{{UIMeta group=1 order=1}}` |
| `tenant_deployment_id` | `string` | `"demo"` | 1–20 lowercase letters, numbers, hyphens. `{{UIMeta group=1 order=2}}` |
| `support_users` | `list(string)` | `[]` | Email addresses granted IAM access and monitoring alerts. `{{UIMeta group=1 order=3}}` |
| `resource_labels` | `map(string)` | `{}` | Labels applied to all resources. `{{UIMeta group=1 order=4}}` |
| `deployment_region` | `string` | `"us-central1"` | GCP region fallback when VPC discovery finds no subnets. `{{UIMeta group=1 order=5}}` |

---

## §3 · Application Identity (Group 2)

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_name` | `string` | `"elasticsearch"` | Base name for Kubernetes resources and resource prefix. Do not change after deployment. `{{UIMeta group=2 order=1}}` |
| `application_display_name` | `string` | `"Elasticsearch"` | Human-readable name in the UI. `{{UIMeta group=2 order=2}}` |
| `application_description` | `string` | `"Elasticsearch search and analytics engine on GKE Autopilot"` | Description in Kubernetes annotations. `{{UIMeta group=2 order=3}}` |
| `application_version` | `string` | `"8.13.4"` | Elasticsearch image tag. Increment to trigger a new image pull and rollout. `{{UIMeta group=2 order=4}}` |
| `cluster_name` | `string` | `"ragflow"` | Elasticsearch cluster name injected via `cluster.name`. Use a descriptive name tied to the use case. `{{UIMeta group=2 order=5}}` |

---

## §4 · Runtime & Scaling (Group 3)

| Variable | Type | Default | Description |
|---|---|---|---|
| `deploy_application` | `bool` | `true` | Set `false` to provision the GKE namespace and IAM without deploying the Elasticsearch workload. `{{UIMeta group=3 order=0}}` |
| `container_image_source` | `string` | `"prebuilt"` | Always `"prebuilt"` — Elasticsearch uses the official image. Options: `prebuilt`, `custom`. `{{UIMeta group=3 order=1}}` |
| `container_image` | `string` | `""` | Override image URI. Leave empty to use `docker.elastic.co/elasticsearch/elasticsearch`. `{{UIMeta group=3 order=2}}` |
| `container_build_config` | `object` | `{ enabled=false }` | Not used for Elasticsearch. `{{UIMeta group=3 order=3}}` |
| `enable_image_mirroring` | `bool` | `true` | Mirror the Elasticsearch image from Elastic's registry to Artifact Registry before deployment. `{{UIMeta group=3 order=4}}` |
| `min_instance_count` | `number` | `1` | Minimum pod replicas. Keep at `1` for single-node mode. `{{UIMeta group=3 order=5}}` |
| `max_instance_count` | `number` | `1` | Maximum pod replicas. Keep at `1` for single-node mode. Increasing this without changing `discovery.type` will cause split-brain. `{{UIMeta group=3 order=6}}` |
| `enable_vertical_pod_autoscaling` | `bool` | `false` | Enable VPA. `{{UIMeta group=3 order=7}}` |
| `container_port` | `number` | `9200` | Elasticsearch HTTP port. `{{UIMeta group=3 order=8}}` |
| `container_protocol` | `string` | `"http1"` | HTTP protocol version. Options: `http1`, `h2c`. `{{UIMeta group=3 order=9}}` |
| `container_resources` | `object` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Full container resource override. When set, takes precedence over `cpu_limit` and `memory_limit`. `{{UIMeta group=3 order=10}}` |
| `timeout_seconds` | `number` | `300` | Load balancer backend timeout. Valid range: 0–3600. `{{UIMeta group=3 order=11}}` |
| `enable_cloudsql_volume` | `bool` | `false` | Not used for Elasticsearch. Always `false`. `{{UIMeta group=3 order=12}}` |
| `cloudsql_volume_mount_path` | `string` | `"/cloudsql"` | Not used for Elasticsearch. `{{UIMeta group=3 order=13}}` |
| `service_annotations` | `map(string)` | `{}` | Custom annotations on the Kubernetes Service. `{{UIMeta group=3 order=14}}` |
| `service_labels` | `map(string)` | `{}` | Custom labels on the Kubernetes Service. `{{UIMeta group=3 order=15}}` |
| `cpu_limit` | `string` | `"2000m"` | CPU limit. Must be sufficient to handle the configured JVM heap without CPU throttling. `{{UIMeta group=3 order=20}}` |
| `memory_limit` | `string` | `"4Gi"` | Memory limit. Must be **at least 2× `es_java_heap`** to leave headroom for OS page cache and JVM overhead. `{{UIMeta group=3 order=21}}` |
| `es_java_heap` | `string` | `"1g"` | JVM heap size (sets both `-Xms` and `-Xmx`). Should be no more than half of `memory_limit`. (e.g. `"1g"`, `"2g"`, `"4g"`) `{{UIMeta group=3 order=22}}` |
| `enable_xpack_security` | `bool` | `false` | Enable Elasticsearch X-Pack security (authentication). When `false`, the cluster is accessible without credentials. Recommended `false` for initial setup alongside RAGFlow; enable for production after configuring certificates. `{{UIMeta group=3 order=23}}` |

> **Heap sizing rule:** `es_java_heap` ≤ `memory_limit / 2`. Example: `memory_limit = "4Gi"` → `es_java_heap = "2g"`. Elasticsearch also needs memory for the OS page cache to accelerate index segment reads.

---

## §5 · GKE Backend Configuration (Group 5)

| Variable | Type | Default | Description |
|---|---|---|---|
| `gke_cluster_name` | `string` | `""` | GKE cluster name. Auto-discovered when empty. `{{UIMeta group=5 order=1}}` |
| `gke_cluster_selection_mode` | `string` | `"primary"` | Cluster selection strategy. Options: `explicit`, `round-robin`, `primary`. `{{UIMeta group=5 order=2}}` |
| `namespace_name` | `string` | `""` | Kubernetes namespace. Auto-generated when empty. `{{UIMeta group=5 order=3}}` |
| `workload_type` | `string` | `"StatefulSet"` | **Required `StatefulSet`** for data persistence. `Deployment` is not recommended — PVC data would not survive pod reschedule. `{{UIMeta group=5 order=4}}` |
| `service_type` | `string` | `"LoadBalancer"` | `"LoadBalancer"` is required for cross-namespace access from `RAGFlow_GKE`. `"ClusterIP"` requires RAGFlow and Elasticsearch to share the same namespace. Options: `ClusterIP`, `LoadBalancer`, `NodePort`. `{{UIMeta group=5 order=5}}` |
| `session_affinity` | `string` | `"None"` | Session affinity for the Kubernetes Service. `{{UIMeta group=5 order=6}}` |
| `enable_multi_cluster_service` | `bool` | `false` | Enable Multi-Cluster Services (MCS). `{{UIMeta group=5 order=7}}` |
| `configure_service_mesh` | `bool` | `false` | Enable Istio service mesh. `{{UIMeta group=5 order=8}}` |
| `enable_network_segmentation` | `bool` | `false` | Apply Kubernetes NetworkPolicies. `{{UIMeta group=5 order=9}}` |
| `termination_grace_period_seconds` | `number` | `120` | Seconds Kubernetes waits after SIGTERM. Elasticsearch needs time to flush segments. Valid range: 0–3600. `{{UIMeta group=5 order=10}}` |
| `deployment_timeout` | `number` | `1800` | Seconds Terraform waits for the StatefulSet rollout. Elasticsearch shard recovery can be slow. `{{UIMeta group=5 order=11}}` |

---

## §6 · StatefulSet & Persistence (Group 6)

Data persistence is critical for Elasticsearch — all index data lives in the PVC.

| Variable | Type | Default | Description |
|---|---|---|---|
| `stateful_pvc_enabled` | `bool` | `true` | **Required for data durability.** Provisions a PVC per StatefulSet pod. `{{UIMeta group=6 order=1}}` |
| `stateful_pvc_size` | `string` | `"30Gi"` | PVC size. Size based on expected index volume. (e.g. `"30Gi"` for small RAGFlow deployments, `"200Gi"` for large production indexes) `{{UIMeta group=6 order=2}}` |
| `stateful_pvc_mount_path` | `string` | `"/usr/share/elasticsearch/data"` | Must match the `path.data` Elasticsearch setting. Do not change. `{{UIMeta group=6 order=3}}` |
| `stateful_pvc_storage_class` | `string` | `"standard-rwo"` | GKE StorageClass. `"premium-rwo"` provides higher IOPS for production index workloads. `{{UIMeta group=6 order=4}}` |
| `stateful_headless_service` | `bool` | `true` | Creates a headless Service for stable pod DNS. `{{UIMeta group=6 order=5}}` |
| `stateful_pod_management_policy` | `string` | `"OrderedReady"` | `"OrderedReady"` or `"Parallel"`. `{{UIMeta group=6 order=6}}` |
| `stateful_update_strategy` | `string` | `"RollingUpdate"` | `"RollingUpdate"` or `"OnDelete"`. `{{UIMeta group=6 order=7}}` |
| `stateful_fs_group` | `number` | `null` | Pod `fsGroup` GID so the Elasticsearch process (UID 1000) can write to the PVC. Defaults to `1000` via the module's application config; override only if using a custom image with a different GID. `{{UIMeta group=6 order=8}}` |

---

## §7 · Environment Variables & Secrets (Group 4)

| Variable | Type | Default | Description |
|---|---|---|---|
| `environment_variables` | `map(string)` | `{}` | Additional env vars injected into the Elasticsearch container. Merged **after** the auto-injected ES settings; can override any auto-injected value. `{{UIMeta group=4 order=1}}` |
| `secret_environment_variables` | `map(string)` | `{}` | Secret Manager secret references injected as env vars. `{{UIMeta group=4 order=2}}` |
| `secret_rotation_period` | `string` | `"2592000s"` | Rotation notification period (30 days). `{{UIMeta group=4 order=3}}` |
| `secret_propagation_delay` | `number` | `30` | Seconds to wait after secret creation. `{{UIMeta group=4 order=4}}` |

---

## §8 · Access & Networking (Groups 18–21)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_iap` | `bool` | `false` | Not recommended for Elasticsearch — use NetworkPolicy instead. `{{UIMeta group=19 order=1}}` |
| `iap_authorized_users` | `list(string)` | `[]` | IAP user allowlist. `{{UIMeta group=19 order=2}}` |
| `iap_authorized_groups` | `list(string)` | `[]` | IAP group allowlist. `{{UIMeta group=19 order=3}}` |
| `iap_oauth_client_id` | `string` | `""` | OAuth 2.0 client ID for IAP. Sensitive. `{{UIMeta group=19 order=4}}` |
| `iap_oauth_client_secret` | `string` | `""` | OAuth 2.0 client secret. Sensitive. `{{UIMeta group=19 order=5}}` |
| `iap_support_email` | `string` | `""` | Support email for the OAuth consent screen. `{{UIMeta group=19 order=6}}` |
| `enable_custom_domain` | `bool` | `false` | Provision a Kubernetes Ingress for custom domain routing. `{{UIMeta group=18 order=1}}` |
| `application_domains` | `list(string)` | `[]` | Custom domain names for the Ingress. `{{UIMeta group=18 order=2}}` |
| `reserve_static_ip` | `bool` | `false` | Reserve a global static external IP. `{{UIMeta group=18 order=3}}` |
| `static_ip_name` | `string` | `""` | Static IP name. Auto-generated when empty. `{{UIMeta group=18 order=4}}` |
| `network_tags` | `list(string)` | `["nfsserver"]` | GCP network tags applied to GKE pods. `{{UIMeta group=18 order=5}}` |
| `network_name` | `string` | `""` | VPC network name. Auto-discovered when empty. `{{UIMeta group=18 order=6}}` |
| `enable_cloud_armor` | `bool` | `false` | Attach Cloud Armor WAF policy. `{{UIMeta group=20 order=1}}` |
| `admin_ip_ranges` | `list(string)` | `[]` | Admin CIDR ranges. `{{UIMeta group=20 order=2}}` |
| `cloud_armor_policy_name` | `string` | `"default-waf-policy"` | Cloud Armor policy name. `{{UIMeta group=20 order=3}}` |
| `enable_cdn` | `bool` | `false` | Not applicable for Elasticsearch. `{{UIMeta group=20 order=4}}` |
| `enable_vpc_sc` | `bool` | `false` | Enable VPC Service Controls perimeter. `{{UIMeta group=21 order=1}}` |
| `vpc_cidr_ranges` | `list(string)` | `[]` | VPC subnet CIDRs for VPC-SC. `{{UIMeta group=21 order=2}}` |
| `vpc_sc_dry_run` | `bool` | `true` | Log VPC-SC violations without blocking. `{{UIMeta group=21 order=3}}` |
| `organization_id` | `string` | `""` | GCP Organization ID for VPC-SC policy. `{{UIMeta group=21 order=4}}` |
| `enable_audit_logging` | `bool` | `false` | Enable detailed Cloud Audit Logs. `{{UIMeta group=21 order=5}}` |

---

## §9 · Storage (Group 13) — Not Used

Elasticsearch stores all data in the PVC. No GCS buckets or NFS mounts are needed.

| Variable | Type | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | `bool` | `false` | Not required for Elasticsearch. `{{UIMeta group=13 order=1}}` |
| `storage_buckets` | `list(object)` | `[]` | Not required for Elasticsearch. `{{UIMeta group=13 order=2}}` |
| `gcs_volumes` | `list(object)` | `[]` | Not required for Elasticsearch. `{{UIMeta group=13 order=3}}` |
| `manage_storage_kms_iam` | `bool` | `false` | Create CMEK KMS keyring for storage encryption. `{{UIMeta group=13 order=4}}` |
| `enable_artifact_registry_cmek` | `bool` | `false` | Enable CMEK for Artifact Registry. `{{UIMeta group=13 order=5}}` |
| `enable_nfs` | `bool` | `false` | Not required — use StatefulSet PVC instead. `{{UIMeta group=12 order=1}}` |
| `nfs_mount_path` | `string` | `"/mnt/nfs"` | NFS mount path (present for interface compatibility). `{{UIMeta group=12 order=2}}` |
| `nfs_instance_name` | `string` | `""` | NFS instance name (present for interface compatibility). `{{UIMeta group=12 order=3}}` |
| `nfs_instance_base_name` | `string` | `"app-nfs"` | NFS base name (present for interface compatibility). `{{UIMeta group=12 order=4}}` |

---

## §10 · Observability & Health (Group 9)

Probes use **TCP** (not HTTP) because:
- HTTP probes would return `401 Unauthorized` when `enable_xpack_security = true`.
- TCP probes validate that the port is open, which implies the Elasticsearch bootstrap
  checks have passed — a stronger readiness signal than an HTTP path check.

| Variable | Type | Default | Description |
|---|---|---|---|
| `startup_probe_config` | `object` | `{ enabled=true, type="HTTP", path="/_cluster/health", initial_delay_seconds=30, period_seconds=10, failure_threshold=18 }` | App_GKE-standard startup probe. The 18-attempt threshold (3 minutes) allows for shard recovery. `{{UIMeta group=9 order=1}}` |
| `health_check_config` | `object` | `{ enabled=true, type="HTTP", path="/_cluster/health", initial_delay_seconds=60, period_seconds=30, failure_threshold=3 }` | App_GKE-standard liveness probe. `{{UIMeta group=9 order=2}}` |
| `uptime_check_config` | `object` | `{ enabled=false, path="/_cluster/health", check_interval="60s", timeout="10s" }` | Cloud Monitoring uptime check. Disabled by default. `{{UIMeta group=9 order=3}}` |
| `alert_policies` | `list(object)` | `[]` | Cloud Monitoring alert policies. `{{UIMeta group=9 order=4}}` |

> Note: The container-level probes (forwarded via the application config) use TCP, while
> `startup_probe_config` and `health_check_config` at the App_GKE level default to HTTP
> with `/_cluster/health`. When `enable_xpack_security = true`, override both configs to
> use TCP.

---

## §11 · Reliability Policies (Group 8)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_pod_disruption_budget` | `bool` | `true` | Create a PodDisruptionBudget. Recommended for production Elasticsearch. `{{UIMeta group=8 order=1}}` |
| `pdb_min_available` | `string` | `"1"` | Minimum pods available during voluntary disruptions. For single-node ES, `"1"` prevents any voluntary disruption from succeeding — increase the node count before reducing this. `{{UIMeta group=8 order=2}}` |
| `enable_topology_spread` | `bool` | `false` | Add TopologySpreadConstraints. `{{UIMeta group=8 order=3}}` |
| `topology_spread_strict` | `bool` | `false` | `DoNotSchedule` (strict) vs `ScheduleAnyway`. `{{UIMeta group=8 order=4}}` |

---

## §12 · Backup & CI/CD (Groups 11 & 16)

| Variable | Type | Default | Description |
|---|---|---|---|
| `backup_schedule` | `string` | `"0 2 * * *"` | Backup cron schedule (UTC). For Elasticsearch, consider Elasticsearch Snapshots to GCS rather than OS-level backups. `{{UIMeta group=16 order=1}}` |
| `backup_retention_days` | `number` | `7` | Days to retain backup files. `{{UIMeta group=16 order=2}}` |
| `enable_backup_import` | `bool` | `false` | Not applicable for Elasticsearch. `{{UIMeta group=16 order=3}}` |
| `backup_source` | `string` | `"gcs"` | Backup import source. Options: `gcs`, `gdrive`. `{{UIMeta group=16 order=4}}` |
| `backup_uri` | `string` | `""` | Backup file URI for import. `{{UIMeta group=6 order=7}}` |
| `backup_format` | `string` | `"sql"` | Backup file format. `{{UIMeta group=16 order=6}}` |
| `enable_cicd_trigger` | `bool` | `false` | Create a Cloud Build trigger on GitHub pushes. `{{UIMeta group=11 order=1}}` |
| `github_repository_url` | `string` | `""` | GitHub repository URL. `{{UIMeta group=11 order=2}}` |
| `github_token` | `string` | `""` | GitHub Personal Access Token. Sensitive. `{{UIMeta group=11 order=3}}` |
| `github_app_installation_id` | `string` | `""` | Cloud Build GitHub App installation ID. `{{UIMeta group=11 order=4}}` |
| `cicd_trigger_config` | `object` | `{ branch_pattern="^main$" }` | CI/CD trigger configuration. `{{UIMeta group=11 order=5}}` |
| `enable_cloud_deploy` | `bool` | `false` | Switch to Cloud Deploy pipeline. `{{UIMeta group=11 order=6}}` |
| `cloud_deploy_stages` | `list(object)` | `[dev, staging, prod(approval)]` | Cloud Deploy pipeline stages. `{{UIMeta group=11 order=7}}` |
| `enable_binary_authorization` | `bool` | `false` | Enforce Binary Authorization. `{{UIMeta group=11 order=8}}` |

---

## §13 · Database (Group 15) — Not Used

Elasticsearch requires no Cloud SQL. All variables are present for interface compatibility with `App_GKE`.

| Variable | Type | Default | Description |
|---|---|---|---|
| `database_type` | `string` | `"NONE"` | Hard-coded to `NONE` in `main.tf`. Not configurable. `{{UIMeta group=15 order=1}}` |
| `application_database_name` | `string` | `"none"` | Not used. `{{UIMeta group=15 order=4}}` |
| `application_database_user` | `string` | `"none"` | Not used. `{{UIMeta group=15 order=5}}` |
| `database_password_length` | `number` | `32` | Not used. Valid range: 16–64. `{{UIMeta group=15 order=6}}` |
| `enable_postgres_extensions` | `bool` | `false` | Not used. `{{UIMeta group=15 order=7}}` |
| `postgres_extensions` | `list(string)` | `[]` | Not used. `{{UIMeta group=15 order=8}}` |
| `enable_mysql_plugins` | `bool` | `false` | Not used. `{{UIMeta group=15 order=9}}` |
| `mysql_plugins` | `list(string)` | `[]` | Not used. `{{UIMeta group=15 order=10}}` |
| `enable_auto_password_rotation` | `bool` | `false` | Not applicable when `database_type = "NONE"`. `{{UIMeta group=15 order=11}}` |
| `rotation_propagation_delay_sec` | `number` | `90` | Not applicable. `{{UIMeta group=15 order=12}}` |

---

## §14 · Workload Automation (Group 10 & 17)

Elasticsearch requires no initialization jobs or custom SQL.

| Variable | Type | Default | Description |
|---|---|---|---|
| `initialization_jobs` | `list(object)` | `[]` | Kubernetes Jobs run before Elasticsearch starts. Each job requires at least one of `command`, `args`, or `script_path`. `{{UIMeta group=10 order=1}}` |
| `cron_jobs` | `list(object)` | `[]` | Recurring Kubernetes CronJobs. `{{UIMeta group=10 order=2}}` |
| `additional_services` | `list(object)` | `[]` | Additional container deployments. `{{UIMeta group=10 order=3}}` |
| `enable_custom_sql_scripts` | `bool` | `false` | Not used for Elasticsearch. `{{UIMeta group=17 order=1}}` |
| `custom_sql_scripts_bucket` | `string` | `""` | Not used. `{{UIMeta group=17 order=2}}` |
| `custom_sql_scripts_path` | `string` | `""` | Not used. `{{UIMeta group=17 order=3}}` |
| `custom_sql_scripts_use_root` | `bool` | `false` | Not used. `{{UIMeta group=17 order=4}}` |

---

## §15 · Resource Quota (Group 7)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_resource_quota` | `bool` | `false` | Create a Kubernetes ResourceQuota. `{{UIMeta group=7 order=1}}` |
| `quota_cpu_requests` | `string` | `""` | Total CPU requests allowed in the namespace. `{{UIMeta group=7 order=2}}` |
| `quota_cpu_limits` | `string` | `""` | Total CPU limits allowed. `{{UIMeta group=7 order=3}}` |
| `quota_memory_requests` | `string` | `""` | Total memory requests allowed. `{{UIMeta group=7 order=4}}` |
| `quota_memory_limits` | `string` | `""` | Total memory limits allowed. `{{UIMeta group=7 order=5}}` |

---

## §16 · Outputs

| Output | Description |
|---|---|
| `service_name` | Kubernetes service name. |
| `service_url` | Service URL. |
| `service_external_ip` | External IP of the LoadBalancer service. |
| `elasticsearch_endpoint` | **Primary output for RAGFlow.** `http://<service_external_ip>:9200`. Pass this to `RAGFlow_GKE`'s `elasticsearch_hosts` variable. Returns `null` if the external IP is not yet assigned. |
| `project_id` | GCP project ID. |
| `deployment_id` | Unique deployment identifier. |
| `namespace` | Kubernetes namespace. |
| `storage_buckets` | Provisioned GCS buckets (empty list — no buckets are provisioned). |
| `nfs_server_ip` | NFS server IP (sensitive). Returns `null` when `enable_nfs = false`. |
| `nfs_mount_path` | NFS mount path. |
| `container_image` | Container image URI. |
| `cicd_enabled` | Whether CI/CD pipeline is enabled. |
| `github_repository_url` | Connected GitHub repository URL. |
| `kubernetes_ready` | `true` when the GKE cluster endpoint is available and all workload resources have been deployed. `false` on first apply of a new cluster — the CI/CD pipeline must re-run apply to complete deployment. |

---

## §17 · Configuration Examples

### Basic Deployment

Minimal single-node Elasticsearch for RAGFlow integration. Deploy this first, then use
`elasticsearch_endpoint` in `RAGFlow_GKE`.

```hcl
# config/basic.tfvars
resource_creator_identity = ""
project_id                = "your-gcp-project-id"
tenant_deployment_id      = "basic"

application_version = "8.13.4"

es_java_heap = "1g"
cpu_limit    = "2000m"
memory_limit = "4Gi"

stateful_pvc_size = "30Gi"

service_type = "LoadBalancer"
```

After deployment:
```bash
tofu output elasticsearch_endpoint
# → http://1.2.3.4:9200
# Paste this into RAGFlow_GKE tfvars as: elasticsearch_hosts = "http://1.2.3.4:9200"
```

### Advanced Deployment

Production-grade Elasticsearch with large heap, premium SSD, and monitoring.

```hcl
# config/advanced.tfvars
resource_creator_identity = ""
project_id                = "your-gcp-project-id"
tenant_deployment_id      = "prod"

application_version = "8.13.4"
cluster_name        = "ragflow-production"

es_java_heap      = "4g"
cpu_limit         = "8000m"
memory_limit      = "10Gi"
stateful_pvc_size = "200Gi"

stateful_pvc_storage_class = "premium-rwo"

service_type      = "LoadBalancer"
reserve_static_ip = false

enable_pod_disruption_budget = true
pdb_min_available            = "1"

uptime_check_config = {
  enabled        = true
  path           = "/_cluster/health"
  check_interval = "60s"
  timeout        = "10s"
}

resource_labels = {
  env     = "production"
  service = "elasticsearch"
}
```
