---
title: "MongoDB on GKE Autopilot"
description: "Configuration reference for deploying MongoDB on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# MongoDB on GKE Autopilot

MongoDB is the world's most popular NoSQL document database, used by organisations
of every size for content management, IoT data pipelines, mobile backends, and
AI/ML feature stores where relational schemas are too rigid. This module deploys
MongoDB on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation,
which provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services MongoDB uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

MongoDB runs as a StatefulSet on GKE Autopilot. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot (StatefulSet) | 1 vCPU / 2 GiB by default, single-node mode |
| Persistent storage | Persistent Disk (SSD PVC) | `standard-rwo` StorageClass, 20 GiB default, mounted at `/data/db` |
| Secrets | Secret Manager | Auto-generated MongoDB root password |
| Container images | Artifact Registry | Official `mongo` image mirrored into the project registry |
| Networking | VPC / GKE Service | `LoadBalancer` by default for cross-namespace access; switch to `ClusterIP` for cluster-internal only |

**Sensible defaults worth knowing up front:**

- **No Cloud SQL.** MongoDB is its own database engine; Cloud SQL is not
  provisioned and `enable_cloudsql_volume` is hardcoded to `false`.
- **SSD-backed PVC is essential.** Without a StatefulSet PVC, all data is lost on
  every pod restart. `stateful_pvc_enabled = true` auto-selects a StatefulSet.
- **Single-node mode only.** `min_instance_count` and `max_instance_count` are
  both fixed at 1. MongoDB replica sets require additional authentication-key and
  `rs.initiate()` setup that is out of scope for this module.
- **Root password is auto-generated.** `MONGO_INITDB_ROOT_PASSWORD` is generated
  and stored in Secret Manager on the first deploy; you never set it in plain text.
- **TCP probes on port 27017.** MongoDB speaks its own binary wire protocol, not
  HTTP — HTTP probes always fail.
- **fsGroup 999 is hardcoded.** The official MongoDB image runs `mongod` as
  UID/GID 999; Kubernetes chowns the PVC mount to this GID automatically.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the MongoDB StatefulSet

MongoDB runs as a single-pod StatefulSet on Autopilot, which provisions nodes
on demand and bills for the CPU and memory the pod actually requests. Autopilot
must provision a node, attach the PVC, and pull the image before `mongod` starts
— the startup probe allows up to ~8 minutes to accommodate this.

- **Console:** Kubernetes Engine → Workloads → select the MongoDB StatefulSet for
  pod status, events, and resource usage. Kubernetes Engine → Services & Ingress
  shows the ClusterIP or external LoadBalancer IP.
- **CLI:**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<statefulset-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" <pod-name>   # events and probe status
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the StatefulSet
workload type are managed.

### B. Persistent Disk — SSD PVC

MongoDB data lives on a **Persistent Disk SSD PVC** (`standard-rwo` StorageClass)
mounted at `/data/db` inside the container. The PVC is provisioned automatically
by GKE when the StatefulSet is created and persists independently of pod restarts,
rolling updates, and node evictions.

- **Console:** Kubernetes Engine → Storage → PersistentVolumeClaims to see the PVC
  and its bound volume. Compute Engine → Disks to see the underlying Persistent Disk.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>   # capacity, access mode, status
  # Check disk usage inside the running pod:
  kubectl exec -n "$NAMESPACE" <pod-name> -- df -h /data/db
  ```

The PVC size is set at deploy time by `stateful_pvc_size` (default `20Gi`).
**PVC size cannot be decreased after creation.** Provision at least 2–3× the
expected initial data volume to avoid the `No space left on device` crash.

### C. Secret Manager — root password

The MongoDB root password (`MONGO_INITDB_ROOT_PASSWORD`) is auto-generated on
the first deploy and stored as a Secret Manager secret. It is injected into the
pod via the Secret Store CSI driver and never appears in plain text.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~mongo-root-password"
  gcloud secrets versions access latest \
    --secret=<secret-name> --project "$PROJECT"
  ```

To retrieve the root password for a `mongosh` connection:
```bash
ROOT_PASS=$(gcloud secrets versions access latest \
  --secret=<resource-prefix>-mongo-root-password --project "$PROJECT")
kubectl exec -n "$NAMESPACE" <pod-name> -- \
  mongosh --username admin --password "$ROOT_PASS" --authenticationDatabase admin
```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and
rotation.

### D. Artifact Registry — container image

The official `mongo` image is mirrored into the project's Artifact Registry before
deployment so pods never pull directly from Docker Hub. The mirrored image URI is
reported in the `container_image` output.

- **Console:** Artifact Registry → select the repository.
- **CLI:**
  ```bash
  gcloud artifacts docker images list \
    <region>-docker.pkg.dev/$PROJECT/<registry-repo> --project "$PROJECT"
  ```

### E. Networking & ingress

By default the MongoDB Kubernetes Service is a **LoadBalancer**, exposing port
27017 with an external IP so other workloads or developers inside the VPC can
reach it. Switch to `ClusterIP` to restrict access to within the GKE cluster.

- **Console:** Kubernetes Engine → Services & Ingress; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  # Get the LoadBalancer external IP:
  kubectl get svc -n "$NAMESPACE" <service-name> \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  ```

The `mongodb_endpoint` output provides the ready-to-use connection URI
(`mongodb://<ip>:27017` for LoadBalancer or the in-cluster DNS URI for ClusterIP).

See [App_GKE](App_GKE.md) for custom domains, static IPs, and
Cloud CDN details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr (including `mongod` startup and query logs) flow to Cloud
Logging. GKE and Persistent Disk metrics flow to Cloud Monitoring.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. MongoDB Application Behaviour

- **Standalone mode only.** This module deploys a single `mongod` instance.
  MongoDB replica sets (change streams, transactions, oplog replication) require
  authentication key files and `rs.initiate()` setup that are outside the scope
  of this module. `max_instance_count` is enforced at 1.
- **First startup initialisation.** On the very first boot with a fresh PVC,
  MongoDB creates the root user (`MONGO_INITDB_ROOT_USERNAME`, default `admin`)
  and the initial database (`MONGO_INITDB_DATABASE`, default `admin`). These
  values are **immutable after the PVC has been written** — changing them after
  first deploy has no effect (the init script runs only once per data directory).
- **WiredTiger cache sizing.** MongoDB's WiredTiger storage engine defaults its
  cache to approximately `(memory_limit − 1 GiB) × 0.5`. With the default `2Gi`
  limit the cache is ~500 MiB, which is sufficient for development. Scale the
  `memory_limit` to `4Gi`–`8Gi` for production document workloads.
- **Startup probe tolerance.** GKE Autopilot must provision a node, attach the
  PVC, and pull the image before `mongod` starts. The startup probe allows up to
  ~8 minutes (`failure_threshold = 45`, checking every 10 seconds). On subsequent
  pod restarts on a warm node the startup is much faster.
- **Journal flush on shutdown.** `termination_grace_period_seconds` is set to
  60 seconds (default) so Kubernetes waits for `mongod` to flush the write-ahead
  journal before forcibly killing the process — preventing journal corruption.
- **Connection string.** The correct format to connect with the root credential
  is:
  ```
  mongodb://<username>:<password>@<host>:<port>/<db>?authSource=admin
  ```
  The `authSource=admin` parameter is required when connecting to non-admin
  databases with the root account.
- **Health probes.** Both the startup and liveness probes use `type = "TCP"` on
  port 27017. MongoDB speaks its own binary wire protocol — HTTP probes always
  fail with a protocol error.
- **No scheduled tasks.** MongoDB does not require any platform-side cron jobs.
  Application-level tasks (index builds, TTL indices) are managed from within the
  application or via `mongosh`.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for MongoDB are listed; every other input is
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
| `application_name` | `mongodb` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `MongoDB` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `7.0` | MongoDB image version tag; increment to roll out a new version. Major upgrades change the on-disk format — test against a replica before upgrading production. |
| `mongo_root_username` | `admin` | Root username (`MONGO_INITDB_ROOT_USERNAME`). **Immutable after first PVC write.** |
| `mongo_initdb_database` | `admin` | Initial database created on first startup. **Immutable after first PVC write.** |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per pod. Scale to `2000m` for aggregation-heavy workloads. |
| `memory_limit` | `2Gi` | Memory per pod. WiredTiger cache ≈ `(limit − 1 GiB) × 0.5`; scale to `4Gi`–`8Gi` for production. |
| `min_instance_count` | `1` | Minimum replicas. Must be 1 for single-node mode. |
| `max_instance_count` | `1` | Maximum replicas. **Enforced at 1** — replica sets are not supported by this module. |
| `container_port` | `27017` | MongoDB wire-protocol port. Sets both the Service port and `mongod`'s listen port. |
| `enable_image_mirroring` | `true` | Mirror the `mongo` image into Artifact Registry before deployment. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `MONGO_INITDB_ROOT_USERNAME` and `MONGO_INITDB_DATABASE` are injected automatically. |
| `secret_environment_variables` | `{}` | Secret Manager references injected as env vars. Provide `MONGO_INITDB_ROOT_PASSWORD` here to use a custom password instead of the auto-generated one. |
| `secret_propagation_delay` | `30` | Seconds to wait after the root password secret is created before the pod starts. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | `LoadBalancer` exposes port 27017 with an external IP; `ClusterIP` restricts to within the cluster. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | No session stickiness required for MongoDB wire-protocol connections. |
| `gke_cluster_name` | `""` | GKE cluster name; leave empty for auto-discovery. |
| `namespace_name` | `""` | Kubernetes namespace; leave empty to auto-generate. |
| `termination_grace_period_seconds` | `60` | Grace period for `mongod` to flush the journal before SIGKILL. |
| `deployment_timeout` | `600` | Seconds Terraform waits for the StatefulSet rollout (covers node provisioning + PVC attach). |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources to restrict ingress/egress. |
| `network_tags` | `["nfsserver"]` | Node/pod network tags for firewall rules. |

### Group 7 — StatefulSet & PVC

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Set `true` to enable PVC-backed StatefulSet. **Required for data durability.** |
| `stateful_pvc_size` | `20Gi` | Storage size. Cannot be decreased after creation; provision 2–3× expected data volume. |
| `stateful_pvc_mount_path` | `/data/db` | Must match MongoDB's `--dbpath`. Do not change. |
| `stateful_pvc_storage_class` | `standard-rwo` | GKE Autopilot SSD default. Use `premium-rwo` for high-throughput workloads. |
| `stateful_headless_service` | `null` | Create a headless Service for stable pod DNS entries. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` or `Parallel` pod creation order. |
| `stateful_update_strategy` | `null` | `RollingUpdate` or `OnDelete`. |
| `stateful_fs_group` | `0` | fsGroup GID (note: `999` is **hardcoded** in the module for MongoDB — this variable has no effect). |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during disruption (for single-node MongoDB, `1` is the only sensible value). |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | TCP, 20s delay, failure_threshold 45 | TCP probe on port 27017; allows ~8 minutes for node provisioning + PVC attach + image pull. |
| `health_check_config` | TCP, 30s delay, failure_threshold 3 | TCP liveness probe on port 27017. |
| `uptime_check_config` | disabled | Uptime check — disabled by default as MongoDB is an internal service. |
| `alert_policies` | `[]` | Optional Cloud Monitoring metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Kubernetes Jobs run before the MongoDB pod starts. Not required for MongoDB — no database bootstrap job is needed. |
| `cron_jobs` | `[]` | Scheduled CronJobs. MongoDB has no required platform-side scheduled tasks. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is not required for MongoDB — use the StatefulSet PVC instead. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `false` | MongoDB does not require a GCS bucket. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options for storage and registry. |
| `max_images_to_retain` | `7` | Recent images to keep in Artifact Registry. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated `mongodump` backup cron (UTC). **Verify the backup job is active** — a missed backup combined with PVC deletion causes permanent data loss. |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |

### Group 19 — Custom Domain & Static IP

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `false` | Provision a Kubernetes Ingress for custom hostnames (unusual for a database service). |
| `application_domains` | `[]` | Custom domain names. |
| `reserve_static_ip` | `false` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

IAP is not recommended for MongoDB (a database, not a web application). Restrict
access instead via `service_type = "ClusterIP"` or Kubernetes NetworkPolicy.

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Not recommended for MongoDB. Use NetworkPolicy or ClusterIP. |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |

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
| `service_external_ip` | External LoadBalancer IP (when the service type is LoadBalancer). |
| `mongodb_endpoint` | Ready-to-use MongoDB connection URI (`mongodb://...`). ClusterIP deployments return the in-cluster DNS URI; LoadBalancer deployments return the external URI. |
| `statefulset_name` | Name of the StatefulSet. |
| `storage_buckets` | Created Cloud Storage buckets (empty by default for MongoDB). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any initialization jobs run. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | GitHub repo details. |
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
| `stateful_pvc_enabled` | `true` | Critical | Without a PVC, all MongoDB data is lost on every pod restart, rolling update, or node eviction. |
| `stateful_pvc_mount_path` | `/data/db` (default) | Critical | Must match MongoDB's `--dbpath`. Mounting elsewhere causes `mongod` to write to the ephemeral layer — all data lost on restart. |
| `MONGO_INITDB_ROOT_PASSWORD` | auto-generated (default) | Critical | MongoDB starts without authentication if the env var is absent. Any caller inside the cluster gains unrestricted admin access. Never remove or clear it. |
| `mongo_root_username` / `mongo_initdb_database` | set once | Critical | Baked into the data directory on first init. Changing after the PVC exists causes startup failure. |
| `quota_memory_requests` / `quota_memory_limits` | binary units (`4Gi`) | Critical | Bare integers are read as bytes by Kubernetes, blocking all pod scheduling. |
| `stateful_pvc_size` | `20Gi` min, size for workload | High | A full disk causes `mongod` to crash with `No space left on device`. Provision 2–3× expected data volume. Size cannot be decreased after creation. |
| `memory_limit` | `4Gi` for production | High | WiredTiger cache is ~50% of `(limit − 1 GiB)`. Insufficient cache causes excessive disk I/O and severe query degradation. |
| `workload_type` | `null` (auto StatefulSet with PVC) | High | Explicitly setting `Deployment` alongside `stateful_pvc_enabled = true` fails at plan time. Standalone MongoDB requires StatefulSet for stable PVC binding. |
| `application_version` | test major upgrades first | High | MongoDB major version upgrades change the on-disk storage format. Downgrading is not supported. Always test against a replica of the production PVC. |
| `backup_schedule` | active and tested | High | MongoDB has no built-in automatic backup outside this module's `mongodump` job. A missed backup combined with deletion of the persistent volume on destroy results in permanent data loss. |
| `service_type` | `ClusterIP` for DB-tier services | High | `LoadBalancer` exposes port 27017 with a public IP. Restrict to `ClusterIP` unless external access is explicitly required, and use firewall rules or NetworkPolicy. |
| `termination_grace_period_seconds` | `60` (default) | High | Too short a grace period risks journal corruption on shutdown if in-flight writes have not been flushed. |
| `cpu_limit` | `2000m` for production | Medium | Aggregation pipelines and index builds are CPU-intensive. Below `500m`, complex queries degrade significantly. |
| `replica set` | standalone only | High | This module is single-node. Change streams, transactions, and oplog replication require a replica set — use a Helm-based deployment for multi-node topologies. |
| `enable_iap` | `false` (default) | Low | IAP is not applicable for database services. Use NetworkPolicy or ClusterIP for access control instead. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. MongoDB_GKE has no separate Common module; all
MongoDB-specific configuration is self-contained in the module.
