---
title: "VictoriaMetrics on GKE Autopilot"
description: "Configuration reference for deploying VictoriaMetrics on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# VictoriaMetrics on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/VictoriaMetrics_GKE.png" alt="VictoriaMetrics on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

VictoriaMetrics is a fast, cost-efficient, Prometheus-compatible time-series
database — the standard self-hosted metrics-storage backend for pairing with
this catalog's Grafana module. It accepts Prometheus `remote_write`, InfluxDB
line protocol, Graphite, and OpenTSDB ingestion over plain HTTP, and answers
PromQL-compatible queries. This module deploys VictoriaMetrics on **GKE
Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions
and manages the shared Google Cloud and Kubernetes infrastructure.

There is **no Cloud Run variant** of this module — see §1 below for why.

This guide focuses on the cloud services VictoriaMetrics uses and how to
explore and operate them from the Google Cloud Console and the command line.
For the mechanics that are common to every GKE application — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

VictoriaMetrics runs as a single-node, stateful time-series-database workload
on Autopilot. The deployment wires together a focused set of Google Cloud
services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single VictoriaMetrics pod, 1 vCPU / 1 GiB by default |
| Persistent storage | Persistent Disk via StatefulSet PVC | Required — mounted at `/victoria-metrics-data`; `standard` (HDD `pd-standard`) storage class by default |
| Secrets | none | VictoriaMetrics has no built-in authentication — no Secret Manager secrets are created |
| Ingress | Cloud Load Balancing | `ClusterIP` by default (internal-only, by design — see below); `LoadBalancer` or custom domain when external scraping/querying is genuinely needed |

**Why GKE-only:** VictoriaMetrics stores its time-series data as mmap'd local
files on disk (confirmed via the official FAQ: *"VictoriaMetrics stores data
in block storage..."*). This is incompatible with Cloud Run's ephemeral,
per-revision filesystem and with GCS FUSE's file-locking/mmap semantics — the
same class of constraint already documented for ClickHouse, Elasticsearch,
and MongoDB in this catalog. `VictoriaMetrics_GKE` therefore requires a real
block PersistentVolumeClaim (`stateful_pvc_enabled = true` by default) and has
no Cloud Run sibling.

**Sensible defaults worth knowing up front:**

- **No SQL database, no Redis.** VictoriaMetrics manages its own embedded
  TSDB. No Cloud SQL instance is created; `enable_redis` is hard-coded to
  `false`.
- **Single-instance by default, and this is not a "scale it up later"
  knob.** `max_instance_count = 1` — single-node VictoriaMetrics has no
  built-in clustering or replication. Two pods writing the same PVC would
  corrupt data.
- **StatefulSet PVC is required, not optional.** Unlike some stateful apps in
  this catalog where a GCS FUSE fallback exists, VictoriaMetrics has no
  fallback — its mmap'd data files are not FUSE-compatible even as a
  degraded mode. `stateful_pvc_enabled = true` is the default and should stay
  that way.
- **`ClusterIP` by default — this is correct, not a bug.** VictoriaMetrics is
  meant to be scraped and queried *internally* by Prometheus-compatible
  clients (a `remote_write` sender, `vmagent`, or Grafana) running in the same
  cluster, not exposed as a public web application. This is the same
  confirmed-correct pattern already documented for Qdrant and PhpMyAdmin in
  this catalog — do not "fix" it to `LoadBalancer` under the assumption it's
  the fleet-wide ClusterIP-copy-paste bug found elsewhere; it genuinely isn't
  here.
- **HDD storage class by default.** `stateful_pvc_storage_class = "standard"`
  (`pd-standard`), not the SSD-backed `standard-rwo` many other stateful
  modules default to — VictoriaMetrics is documented as tolerant of
  high-latency, low-IOPS storage, so this avoids drawing from the tight
  `SSD_TOTAL_GB` quota.
- **CLI-flag configuration, not environment variables.** VictoriaMetrics has
  no environment-variable-based configuration. The custom image's
  `ENTRYPOINT` pins `-storageDataPath`, `-httpListenAddr`, and
  `-retentionPeriod` directly — see §4.
- **A single `/health` endpoint** serves both the startup and liveness probe
  — there is no separate readiness/liveness distinction.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#6-outputs).

### A. GKE Autopilot — the VictoriaMetrics workload

The VictoriaMetrics pod runs on Autopilot, which bills for the CPU/memory the
pod actually requests. `max_instance_count = 1` keeps a single pod running —
horizontal scaling is intentionally not supported for this single-node
deployment.

- **Console:** Kubernetes Engine → Workloads → select the VictoriaMetrics
  workload for pods, events, and resource usage. Kubernetes Engine → Services
  & Ingress shows the ClusterIP (or external IP if `LoadBalancer` is used).
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot and the workload type
(StatefulSet) are managed.

### B. Persistent Storage — StatefulSet PVC (the only supported backend)

VictoriaMetrics persists its time-series data files at
`/victoria-metrics-data`. Unlike several other stateful apps in this catalog,
there is no GCS FUSE fallback — a real block PersistentVolumeClaim is
required. The storage class is `standard` (HDD `pd-standard`) by default.

- **Console:** Kubernetes Engine → Storage → PersistentVolumeClaims.
  Compute Engine → Disks to see the underlying Persistent Disk.
- **CLI:**
  ```bash
  # PVC status
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"

  # Confirm the mount and inspect on-disk data files inside the pod
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls -la /victoria-metrics-data
  ```

See [App_GKE](App_GKE.md) for StatefulSet PVC mechanics and storage-class
options in general.

### C. No Secret Manager secrets

VictoriaMetrics has no built-in authentication, so `VictoriaMetrics_Common`
generates and stores no secrets. Access is gated entirely at the network
layer — the `ClusterIP` default, or IAP / Cloud Armor if the service is
deliberately made externally reachable. There is nothing to retrieve from
Secret Manager for this module.

### D. Networking & ingress

By default the workload is exposed only inside the cluster via a `ClusterIP`
service — the intended access pattern is Grafana, `vmagent`, or a Prometheus
`remote_write` sender running in the same cluster. Change `service_type` to
`LoadBalancer` only if you have a genuine need to scrape or query from outside
the cluster (and add your own access controls first — VictoriaMetrics itself
enforces none).

- **Console:** Kubernetes Engine → Services & Ingress; VPC network → IP
  addresses (when a static IP is reserved).
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud
Monitoring. Optional uptime checks (against `/health`) and alert policies are
available, but only meaningful once the service is reachable from wherever
the check originates.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. VictoriaMetrics Application Behaviour

- **No database bootstrap, no init jobs.** VictoriaMetrics manages its own
  embedded TSDB. It is a self-contained binary with no schema or migration
  concept — no initialization job is injected by default, and none is needed.
  The workload starts serving as soon as its data directory is mounted.
- **Health endpoint.** A single unauthenticated `/health` endpoint (returns
  `OK`) serves both the startup and liveness probes — there is no separate
  readiness-vs-liveness split, unlike apps with a heavier startup sequence.
- **How metrics get IN.** VictoriaMetrics accepts several ingestion
  protocols over plain HTTP on port `8428`:
  - Prometheus `remote_write` → `POST /api/v1/write`
  - InfluxDB line protocol → `/write`
  - Graphite plaintext / pickle protocol
  - OpenTSDB `/api/put` and telnet put
  - Its own scrape-config-driven agent, `vmagent`, can also be deployed as a
    sidecar (via `additional_services`) to pull metrics from Prometheus
    `/metrics` endpoints, mirroring what a standalone Prometheus server would do.
- **How to QUERY it.** VictoriaMetrics exposes a PromQL-compatible query API
  (`/api/v1/query`, `/api/v1/query_range`, `/api/v1/series`, ...) — the same
  surface as Prometheus's own HTTP API. Point Grafana at it using the
  **Prometheus** datasource type with the URL set to the VictoriaMetrics
  service's internal DNS name (or external URL, if exposed), no plugin
  required.
- **Retention is baked into the image, not runtime-configurable.**
  `-retentionPeriod=12` (12 months) is compiled into the custom image's
  `ENTRYPOINT` (see §4). It is not exposed as a Terraform variable — changing
  it requires editing `VictoriaMetrics_Common/scripts/Dockerfile` and forcing
  a rebuild.
- **No clustering.** This module deploys VictoriaMetrics **single-node**
  mode. VictoriaMetrics also has a "cluster" edition (`vminsert`/`vmstorage`/
  `vmselect`) for horizontal scale, but that is a different deployment
  topology entirely and is not what this module provisions.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for VictoriaMetrics are listed; every other
input is inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults.

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
| `application_name` | `victoriametrics` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `VictoriaMetrics` | Friendly name shown in the Console. |
| `application_version` | `latest` | VictoriaMetrics image tag. `latest` maps to a pinned known-good release (`v1.148.0`) as the Dockerfile build arg, since the upstream image has no floating `latest` tag of its own. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per pod. |
| `memory_limit` | `1Gi` | Memory per pod. ~1 GB RAM per 1M active time series is the upstream scaling guideline; keep VictoriaMetrics's own usage under ~50% of available memory for OS page-cache headroom. |
| `min_instance_count` | `1` | Minimum replicas. Keep at 1 — a StatefulSet with `replicas=0` has nothing to serve queries. |
| `max_instance_count` | `1` | Maximum replicas. **Must stay 1** — no clustering/replication in single-node mode. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically (disables CPU/Memory HPA). |
| `enable_image_mirroring` | `true` | Mirror the VictoriaMetrics image into Artifact Registry to avoid Docker Hub rate limits. |
| `timeout_seconds` | `300` | Request timeout in seconds (0–3600). |
| `termination_grace_period_seconds` | `60` | Seconds Kubernetes waits after SIGTERM for VictoriaMetrics to flush in-flight writes to disk. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra env vars. **VictoriaMetrics does not read environment variables for configuration** — only CLI flags baked into the image (§4 above); values here have no effect on the running binary unless it happens to read that exact variable, which it does not by default. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Not populated by default — VictoriaMetrics has no built-in auth. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation reminder period (30 days default). Not applicable unless you add your own secrets. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Target cluster name. Auto-discovered when empty. |
| `gke_cluster_selection_mode` | `primary` | Cluster selection strategy: `explicit`, `round-robin`, or `primary`. |
| `namespace_name` | `""` | Kubernetes namespace. Auto-generated when empty. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true` (the default). |
| `service_type` | `ClusterIP` | How the Service is exposed. `ClusterIP` is correct and intentional here — see §1. |
| `session_affinity` | `None` | `None` or `ClientIP`. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources for micro-segmentation. |
| `configure_service_mesh` | `false` | Enable Istio injection for the application namespace. |

### Group 7 — StatefulSet Configuration

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Required** — VictoriaMetrics's mmap'd local-disk data files are not GCS FUSE compatible even as a fallback. Must stay `true`. |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC size. Size to hold the full retention window (12 months by default) plus merge overhead — ~20% free space recommended. |
| `stateful_pvc_mount_path` | `/victoria-metrics-data` | Container path for the PVC. Must match the `-storageDataPath` flag baked into the image. |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard` by default — VictoriaMetrics is documented as IOPS-tolerant, avoiding the tight `SSD_TOTAL_GB` quota. |
| `stateful_headless_service` | `null` | Create a headless Service for stable network identities. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` ensures safe sequential restarts. |
| `stateful_update_strategy` | `null` | `RollingUpdate` for zero-downtime updates. |
| `stateful_fs_group` | `3000` | fsGroup GID set in the pod security context. VictoriaMetrics runs as UID 1000/GID 2000; `3000` ensures the PVC is group-writable. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. With `max_instance_count = 1`, one pod cannot be evicted while satisfying `pdb_min_available = 1` — factor this into node-upgrade planning. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |
| `enable_topology_spread` | `false` | Not meaningful with a single replica. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `/health`, 15s delay | HTTP probe. |
| `liveness_probe` | `/health`, 30s delay | HTTP probe. Same endpoint as startup — VictoriaMetrics has no separate readiness/liveness distinction. |
| `uptime_check_config` | `disabled` | Optional Cloud Monitoring uptime check against `/health`. Only useful if the service is reachable from where the check originates. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | VictoriaMetrics requires no default init job — it is self-contained with no schema/migration concept. |
| `cron_jobs` | `[]` | Kubernetes CronJobs for periodic maintenance, e.g. a scripted `vmbackup` snapshot export. |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside VictoriaMetrics — e.g. a `vmagent` scrape-forwarder sidecar. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 13 — NFS

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | VictoriaMetrics uses a block PVC for storage — enable NFS only for custom jobs that need a shared filesystem. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `network_tags` | `["nfsserver"]` | GKE node/pod network tags; `nfsserver` is required when NFS is enabled. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision GCS buckets defined in `storage_buckets`. VictoriaMetrics itself declares **no default bucket** — its GCS/S3 integration is backup-only, never live query-serving storage. |
| `storage_buckets` / `gcs_volumes` | `[]` | Additional buckets / GCS FUSE mounts, unrelated to primary storage. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` | `7` | Maximum recent container images to keep in Artifact Registry (for the custom-built image). |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). No default backup mechanism is wired for VictoriaMetrics beyond the Foundation's generic scheduling hook — use `cron_jobs` with `vmbackup` for application-aware snapshot backups. |
| `backup_retention_days` | `7` | Retention. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Kubernetes Gateway API with SSL certificates. Only meaningful when the service is deliberately made externally reachable — `service_type` stays `ClusterIP` by default. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Reserve a stable external IP. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in via Kubernetes Gateway. Requires `enable_custom_domain`. Recommended over a bare `LoadBalancer` if VictoriaMetrics is ever exposed outside the cluster, since it has no auth of its own. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the GKE Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `enable_cdn` | `false` | Enable Cloud CDN via GCPBackendPolicy. Not relevant to a metrics API. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. No SQL Database, No Redis, No Secrets

Three things this module deliberately does **not** provision, unlike most
application modules in this catalog:

- **No Cloud SQL instance.** `database_type = "NONE"` is fixed by
  `VictoriaMetrics_Common`. VictoriaMetrics is itself a database.
- **No Redis.** `enable_redis` is hard-coded to `false` in `main.tf`,
  overriding the `App_GKE` default of `true`.
- **No Secret Manager secrets.** `VictoriaMetrics_Common`'s `secret_ids`
  output is always `{}`. There is no API key, admin password, or credential
  of any kind to retrieve — access control is entirely at the network layer
  (`service_type`, IAP, Cloud Armor).

---

## 6. Outputs

These values are returned on a successful deployment and are the quickest way
to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach the VictoriaMetrics HTTP API — internal `*.svc.cluster.local` DNS by default. |
| `statefulset_name` | Name of the StatefulSet. |
| `storage_buckets` | Created Cloud Storage buckets — empty by default (VictoriaMetrics declares none). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any custom setup jobs (empty by default). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Connected GitHub repository. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 7. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` (default, required) | Critical | Without a PVC there is no supported storage mode at all for this module — VictoriaMetrics's mmap'd data files are not GCS FUSE compatible even as a fallback. Do not disable. |
| `stateful_pvc_mount_path` | `/victoria-metrics-data` (default) | Critical | Must match the `-storageDataPath` flag baked into the custom image. A mismatch means the PVC is mounted somewhere the binary never writes to, and all data lives in the ephemeral pod layer — lost on every restart. |
| `service_type` | `ClusterIP` (default) — **do not "fix" this to `LoadBalancer`** | Critical (if changed carelessly) | This is the confirmed-correct default for this app, not the fleet-wide ClusterIP-copy-paste bug documented elsewhere in this catalog. VictoriaMetrics has zero built-in authentication — exposing it via `LoadBalancer` without IAP or Cloud Armor makes all ingested metrics readable/writable/deletable by anyone who can reach the IP. |
| `application_name` | set once | Critical | Immutable after first deploy; changing it recreates the namespace and PVC, losing all ingested metrics history. |
| `max_instance_count` | `1` (fixed) | Critical | Single-node VictoriaMetrics has no clustering or replication — a second replica writing the same PVC corrupts the data files. There is no supported way to scale this module horizontally; use the separate VictoriaMetrics cluster edition (not what this module deploys) if you need that. |
| `-retentionPeriod` (image-baked) | `12` months (default) | High | Not a Terraform variable — changing retention requires editing `VictoriaMetrics_Common/scripts/Dockerfile` and forcing an image rebuild. Data older than the retention window is deleted by VictoriaMetrics itself on its own schedule; there is no soft-delete or trash. |
| `environment_variables` | inert for VictoriaMetrics config | Medium | VictoriaMetrics reads no environment variables for its own configuration — only CLI flags baked into the image. Don't expect a `VICTORIA_METRICS_*`-style env var to change behaviour; it won't, unless the upstream binary happens to read that exact name (it does not by default). |
| `stateful_pvc_size` | generous (20 Gi+, scale to retention × ingestion rate) | High | An undersized PVC fills as the retention window's data accumulates; a full disk halts ingestion/merges. PVC capacity cannot be decreased after creation, and growing it requires a StatefulSet-aware resize. |
| `stateful_pvc_storage_class` | `standard` (HDD, default) | Medium | Cannot be changed after PVC creation without data migration. HDD is the sane default (VictoriaMetrics is IOPS-tolerant) — switching to `standard-rwo`/SSD only matters for very high query concurrency and draws from the tight `SSD_TOTAL_GB` quota. |
| `application_version` | pin to a specific tag for production | Medium | `latest` maps to a fixed pinned release (`v1.148.0`) at build time in this module — so unlike some other apps, "latest" here does not silently drift on rebuild. Still, pin explicitly if you need strict reproducibility across environments. |
| `min_instance_count` | `1` | Medium | Scale-to-zero leaves nothing to serve queries or accept ingestion; there is no cold-start reload behaviour worth relying on for a metrics backend that other systems depend on being always-up. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all scheduling. |
| `enable_iap` / `enable_cloud_armor` | enable if `service_type` is ever changed from `ClusterIP` | High | VictoriaMetrics enforces no access control of its own — anything that can reach the port can read and write all metrics data. |
| `pdb_min_available` vs `min_instance_count` | be aware of the interaction | Medium | `1`/`1` (the defaults) means the single pod cannot be voluntarily evicted while satisfying the PDB — can stall node upgrades until Kubernetes falls back to other eviction strategies. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. VictoriaMetrics-specific application configuration
is described in **[VictoriaMetrics_Common](VictoriaMetrics_Common.md)**.
