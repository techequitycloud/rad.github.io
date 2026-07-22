---
title: "Komga on GKE Autopilot"
description: "Configuration reference for deploying Komga on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Komga on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Komga_GKE.png" alt="Komga on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Komga is a free, open-source, self-hosted media server for comics, manga, and
digital book collections (Kotlin/Java, Spring Boot). It provides a clean web
reading UI, OPDS feeds, collections, read lists, and full-text search over your
library. This module deploys Komga on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Komga uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

Komga runs as a single JVM pod, recommended as a StatefulSet with a block PVC. The
deployment wires together a minimal set of Google Cloud services — there is no
external database:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | JVM (Spring Boot) pod, 1 vCPU / 1 GiB by default; single replica |
| Database | None | Komga uses an embedded SQLite database under `/config` — no Cloud SQL instance is created |
| Object storage / block storage | Cloud Storage (GCS FUSE) or PVC | `stateful_pvc_enabled = true` (default) mounts a real block PVC at `/config`; disable it to use a GCS-FUSE-backed bucket instead |
| Secrets | Secret Manager | None generated — Komga has no injectable service secret |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **No external database.** Komga stores its library index, users, reading
  progress, and settings in an embedded SQLite database — confirmed via upstream
  issue #1327 (open, unimplemented feature request for external DB support).
  `database_type = "NONE"`, `enable_redis` forced `false`.
- **Official prebuilt image.** `container_image_source = "prebuilt"` deploys
  `gotson/komga` directly — no Cloud Build step. `enable_image_mirroring = true`
  mirrors it into Artifact Registry (digest-aware copy) to avoid Docker Hub rate
  limits.
- **Block-storage PVC is the recommended layout.** `stateful_pvc_enabled = true` by
  default runs Komga as a StatefulSet with a per-pod PVC mounted at `/config` —
  gcsfuse's lack of real file locking corrupts SQLite WAL files, so a real block
  volume is preferred over GCS FUSE for production use.
- **Single instance only.** `min_instance_count = 1` and `max_instance_count = 1` —
  Komga serves one shared SQLite library from one volume; do not scale beyond 1.
- **Runs as root.** Komga's container has no `USER` directive (confirmed via local
  container testing), so no gcsfuse/PVC uid/gid mount-option workaround is needed.
- **No generated secrets.** The admin account is created interactively through
  Komga's first-run setup wizard at `/` — there is no master key or JWT secret to
  seed ahead of time.
- **Health endpoint is `/actuator/health`.** Confirmed via local container testing
  to return `200 {"status":"UP"}` unauthenticated. The versioned
  `/api/v1/actuator/health` path is auth-gated (401) — do not point probes at it.
- **JVM heap sizing is optional.** `jvm_heap_max` (blank by default) sets `-Xmx` via
  `JAVA_TOOL_OPTIONS`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Komga workload

Komga's pod is scheduled on Autopilot, which bills for the CPU/memory the pod
actually requests. With `stateful_pvc_enabled = true` (default) the workload is a
StatefulSet with a stable pod identity and its own PVC.

- **Console:** Kubernetes Engine → Workloads → select the Komga workload to see the
  pod, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Storage — Komga's persistent state

By default, a real block **PersistentVolumeClaim** is mounted at `/config`,
holding the embedded SQLite database, Lucene search index, thumbnail cache, and
logs. If `stateful_pvc_enabled = false`, a Cloud Storage bucket is mounted at the
same path via the GCS FUSE CSI driver instead (light use only — see the caveats in
[Komga_Common](Komga_Common.md)).

- **Console:** Kubernetes Engine → Storage (PVCs); Cloud Storage → Buckets (if
  GCS-FUSE mode).
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud storage buckets list --project "$PROJECT"     # if using the GCS bucket
  ```

See [App_GKE](App_GKE.md) for CMEK options and StorageClass details.

### C. Secret Manager

Komga has no generated service secret — the admin account is created through the
web setup wizard. Secret Manager only holds entries you add yourself via
`secret_environment_variables`.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~komga"
  ```

### D. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A
custom domain with a Google-managed certificate can be enabled, and a static IP can
be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and
static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring, with
optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Komga Application Behaviour

- **No first-deploy database setup.** There is no `db-init` job — Komga runs its own
  Flyway schema migrations against the embedded SQLite database on first boot
  (confirmed via local container logs: `org.flywaydb.core.FlywayExecutor`,
  `Successfully validated 90 migrations`).
- **First-run setup wizard.** Open the service URL and complete the setup wizard at
  `/` to create the initial admin user — there is no seeded credential and no
  API/CLI path to create one non-interactively.
- **Add a library after first login.** Once logged in, add a "library" pointing at
  a mounted media path and trigger a scan. This is a manual operator step; no init
  job seeds it.
- **Health path.** Startup and liveness probes target `/actuator/health`
  (unauthenticated, `200 {"status":"UP"}` once ready). Do **not** use
  `/api/v1/actuator/health` — confirmed via local testing to return `401
  Unauthorized` even when the app is fully healthy.
- **Single shared library, single instance.** Komga's SQLite database is a single
  file on one mounted volume — running more than one replica risks concurrent
  writers corrupting it. Keep `max_instance_count = 1`.
- **Block PVC over GCS FUSE.** When `stateful_pvc_enabled = true`,
  `enable_gcs_storage_volume` is auto-set `false` inside `Komga_Common` to avoid a
  double-mount at `/config`. If the project's SSD quota is constrained, override
  `stateful_pvc_storage_class = "standard"` (HDD) — Komga's SQLite access pattern
  does not need SSD IOPS.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Komga are listed; every other input is
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
| `application_name` | `komga` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Image tag, passed straight through as the `gotson/komga` tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Deploys the official `gotson/komga` image directly — no build step. |
| `cpu_limit` | `1000m` | CPU per pod. |
| `memory_limit` | `1Gi` | Memory per pod; raise for very large libraries. |
| `min_instance_count` | `1` | Keep at `1` to avoid cold starts during the Lucene index rebuild on boot. |
| `max_instance_count` | `1` | **Do not increase** — Komga serves one shared SQLite library. |
| `jvm_heap_max` | `""` | Optional JVM `-Xmx` via `JAVA_TOOL_OPTIONS` (e.g. `"512m"`, `"1g"`). |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | Komga has no Cloud SQL — keep `false`. |
| `enable_image_mirroring` | `true` | Mirror the Komga image into Artifact Registry before deployment. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `ClusterIP` | How the Kubernetes Service is exposed — set `LoadBalancer` for direct external access. |
| `workload_type` | `null` (auto → `StatefulSet`) | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | No sticky routing required — single replica. |
| `network_tags` | `["nfsserver"]` | Node/pod network tags; `nfsserver` is required when `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Seconds to wait after SIGTERM before SIGKILL (lets Komga flush writes). |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Enable a per-pod block PVC — recommended for Komga (gcsfuse corrupts its SQLite WAL database). Auto-selects `StatefulSet`. |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC storage size — size to hold the config, library metadata, and SQLite database. |
| `stateful_pvc_mount_path` | `/config` | Container mount path for the PVC — Komga's `KOMGA_CONFIGDIR`. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass for PVCs. Override to `standard` (HDD) if SSD quota is constrained. |
| `stateful_headless_service` | `null` | Create a headless Service for stable pod DNS names. |
| `stateful_pod_management_policy` | `null` | Pod creation order: `OrderedReady` (safe for Komga) or `Parallel`. |
| `stateful_update_strategy` | `null` | Update strategy: `RollingUpdate` or `OnDelete`. |
| `stateful_fs_group` | `3000` | Pod-level `fsGroup`. Komga runs as root, so not strictly required, but left set for consistency. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Create a Kubernetes ResourceQuota in the namespace. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Requires a binary suffix (e.g. `4Gi`, `8192Mi`) when enabled — bare integers are treated as bytes and block pod scheduling. |
| `quota_cpu_requests` / `quota_cpu_limits` / `quota_max_pods` / `quota_max_services` / `quota_max_pvcs` | `""` | Additional quota dimensions. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/actuator/health`, 15s delay | Startup probe. |
| `liveness_probe` | HTTP `/actuator/health`, 30s delay | Liveness probe. |
| `startup_probe_config` | HTTP `/actuator/health` | App_GKE-level infrastructure probe. |
| `health_check_config` | HTTP `/actuator/health` | App_GKE-level liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Komga needs no default init job. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs, e.g. for library-maintenance tasks. |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside Komga. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is off by default. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the auto-provisioned `storage` bucket (used when `stateful_pvc_enabled = false`). |
| `storage_buckets` | `[]` | Additional buckets to provision. |
| `gcs_volumes` | `[]` | Additional GCS Fuse volume mounts via the CSI driver — e.g. a separate read-mostly comics/books library bucket. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` | `7` | Maximum recent Artifact Registry images to keep. |
| `delete_untagged_images` | `true` | Automatically delete untagged images. |
| `image_retention_days` | `30` | Days after which images are eligible for deletion. |

### Group 15 — Redis

Not applicable — `enable_redis` is forced `false` inside `Komga_GKE`. All Redis
variables are declared for convention parity.

### Group 16 — Database Backend

Not applicable — `database_type` is fixed to `NONE`. All database-related variables
are declared for convention parity and forwarded to the foundation with no effect.

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 18 — Custom SQL Scripts

Not applicable — Komga has no SQL database. Declared for convention parity only.

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Komga's own auth. |
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
| `service_url` | URL to reach Komga. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of the setup jobs (empty by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time. Most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` (never increase) | Critical | Multiple pods writing the same SQLite file concurrently risks database corruption. |
| Health probe path | `/actuator/health` | Critical | `/api/v1/actuator/health` is auth-gated (401) — using it as the probe path means the pod never becomes Ready even though Komga is fully healthy. |
| `stateful_pvc_enabled` vs `enable_gcs_storage_volume` | Let `Komga_Common` auto-toggle | Critical | Enabling both mounts two volumes at the same `/config` path — a double-mount conflict. |
| `stateful_pvc_storage_class` | `standard-rwo`, override to `standard` under SSD pressure | Medium | SSD-backed PVCs draw the tight `SSD_TOTAL_GB` quota; a scale-to-zero campaign can exhaust it. |
| First-run setup wizard | Complete promptly after deploy | High | An unclaimed setup wizard leaves the instance without an admin account; anyone who reaches the URL first can claim it. |
| `min_instance_count` | `1` | Medium | Restarting the single pod triggers cold-start latency including a Lucene index rebuild. |
| `memory_limit` | `1Gi`, raise for large libraries | Medium | Undersized memory can OOM-kill during a large library scan. |
| `container_image_source` | `prebuilt` | Medium | Switching to `custom` with no Dockerfile fails the build — Komga needs no custom build. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict the pod during maintenance with no protection. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Komga-specific application configuration shared
with the Cloud Run variant is described in
**[Komga_Common](Komga_Common.md)**.
