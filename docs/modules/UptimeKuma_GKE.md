---
title: "Uptime Kuma on GKE Autopilot"
description: "Configuration reference for deploying Uptime Kuma on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Uptime Kuma on GKE Autopilot

Uptime Kuma is a self-hosted uptime monitoring tool for websites, APIs, TCP
ports, DNS records, and more, with a clean dashboard, public status pages, and
90+ notification channels. This module deploys Uptime Kuma on **GKE
Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions
and manages the shared Google Cloud and Kubernetes infrastructure.

Uptime Kuma v1 is unusual among the applications in this repository: it stores
**all state in an embedded SQLite database** under `/app/data` — there is no
external database, no Redis cache, and no application secret to manage.

This guide focuses on the cloud services Uptime Kuma uses and how to explore
and operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Uptime Kuma runs as a single Node.js web workload pulled directly from the
official Docker Hub image. The deployment wires together a deliberately
small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Prebuilt `louislam/uptime-kuma` pods on port 3001, 1 vCPU / 512Mi by default |
| Database | None (embedded SQLite) | `database_type = "NONE"` — no Cloud SQL instance is provisioned |
| File persistence | Cloud Filestore (NFS) | The SQLite database and uploads persist under `/app/data`, shared across pods |
| Object storage | Cloud Storage | None provisioned by default — `storage_buckets = []` |
| Secrets | Secret Manager | None — Uptime Kuma has no application secret; admin credentials live in its own SQLite DB |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **No external database.** `database_type = "NONE"` is fixed by
  `UptimeKuma_Common`; `enable_cloudsql_volume = false` and no `db-init` job
  runs. Uptime Kuma creates its SQLite schema on first boot.
- **NFS is mandatory for persistence.** `enable_nfs = true`, mounted at
  `/app/data` (the container path is fixed — do not change it). Without the
  NFS volume, the SQLite database and all monitor history are ephemeral and
  lost on pod recreation.
- **No Redis, no application secrets.** `UptimeKuma_Common` outputs
  `secret_ids = {}`; there is nothing to inject from Secret Manager.
- **Prebuilt official image, no custom build.** `container_image_source =
  "prebuilt"` deploys `louislam/uptime-kuma:<application_version>` (default
  tag `1`, the v1 stable/SQLite line) directly from Docker Hub, mirrored into
  Artifact Registry by default (`enable_image_mirroring = true`) to avoid
  Docker Hub rate limits.
- **`container_port = 3001`** — Uptime Kuma's native port.
- **Single replica by default and required.** `min_instance_count = 1`,
  `max_instance_count = 1`. SQLite is a single-writer database; do not scale
  beyond 1 replica sharing the same NFS-mounted database file.
- **`tenant_deployment_id` gets a `-gke` suffix** when the variant calls
  `UptimeKuma_Common`, so a CloudRun and GKE variant on the same
  `tenant_deployment_id` do not collide on Common-owned naming.
- **First-run setup is entirely in-app.** There is no default admin account —
  Uptime Kuma prompts you to create one on first access.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Uptime Kuma workload

Uptime Kuma pods are scheduled on Autopilot, which bills for the CPU/memory
the pods actually request. The workload deploys as a `Deployment`
(`workload_type` defaults to `Deployment`; a `StatefulSet` also works with
the NFS volume if selected).

- **Console:** Kubernetes Engine → Workloads → select the Uptime Kuma
  workload for pods, revisions, and events. Kubernetes Engine → Services &
  Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud Filestore (NFS) — the only persistence layer

Because Uptime Kuma has no external database, **all durable state** —
monitors, check history, notification configuration, status pages, and the
admin account — lives in a single SQLite file on the NFS volume mounted at
`/app/data`. This makes the NFS mount the single most important resource to
protect for this module: losing it loses everything.

- **Console:** Filestore → Instances.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /app/data
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, discovery, and the shared vs.
inline NFS VM model.

### C. Cloud Storage

No GCS bucket is provisioned for Uptime Kuma by default
(`storage_buckets = []` in `UptimeKuma_Common`); all persistence is on NFS.
Set `create_cloud_storage`/`storage_buckets` explicitly if you need a bucket
for exported backups or automation.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~uptimekuma"
  ```

### D. Secret Manager

Uptime Kuma requires **no application secrets** — `secret_ids = {}`. The
database password output surfaced by the Foundation is unused (there is no
Cloud SQL instance). Only Foundation-level secrets you explicitly add via
`secret_environment_variables` will appear here.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~uptimekuma"
  ```

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing
IP (`service_type = LoadBalancer`, `reserve_static_ip = true` so the address
survives redeploys). A custom domain with a Google-managed certificate can be
enabled via `enable_custom_domain`/`application_domains`.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details. Also confirm the GKE egress path allows the pod to reach whatever
external endpoints you configure Uptime Kuma to monitor.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging. Optional Cloud Monitoring uptime
checks and alert policies are available (`uptime_check_config.enabled =
false` by default) — note this is a Google Cloud uptime check *on the Uptime
Kuma service itself*, separate from the monitors you configure inside Uptime
Kuma.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Uptime Kuma Application Behaviour

- **No initialization job.** `initialization_jobs` is empty by default —
  Uptime Kuma creates its SQLite schema itself on first boot against the
  empty `/app/data` volume. User-supplied jobs are still honoured if
  provided.
- **First-run setup is manual and in-app.** On first access to the service
  URL, Uptime Kuma serves its setup wizard to create the initial admin
  account — there are no default or auto-generated credentials to retrieve
  from Secret Manager.
- **Health path.** Both the default startup and liveness probes are **HTTP**
  `GET /` on port `3001` (startup: 30 s initial delay, 10 s period, failure
  threshold 30; liveness: 30 s initial delay, 30 s period, failure threshold
  3). The optional Cloud Monitoring uptime check also targets `GET /`.
- **Single-writer SQLite over NFS.** Running more than one replica against
  the same `/app/data` SQLite file risks database-lock contention or
  corruption; keep `min_instance_count = max_instance_count = 1` unless the
  NFS server's file-locking behaviour under concurrent SQLite writers has
  been separately verified.
- **Inspect the running config and data volume:**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i uptime
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /app/data
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Uptime Kuma are listed; every other input
is inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults.

### Group 2 — Application & Database Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `uptimekuma` | Base name for resources. Do not change after first deploy. |
| `application_version` | `1` | `louislam/uptime-kuma` image tag; `"1"` is the v1 stable line (embedded SQLite). |

### Group 3 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Deploys the official image directly; `"custom"` would build via Cloud Build. |
| `container_port` | `3001` | Uptime Kuma's native port. |
| `enable_cloudsql_volume` | `false` | Unused — Uptime Kuma has no external database. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Keep both at `1` — single SQLite writer. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Per-pod CPU/memory limits. |

### Group 6 — GKE Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the Uptime Kuma dashboard. |
| `workload_type` | `null` → `Deployment` | Deployment; `StatefulSet` also works with the NFS volume if explicitly selected. |
| `session_affinity` | (Foundation default) | No app-specific override; Uptime Kuma has no per-session server state beyond the SQLite DB. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | `{ enabled=true, path="/" }` (HTTP, port 3001) | Startup probe. |
| `health_check_config` | `{ enabled=true, path="/" }` (HTTP, port 3001) | Liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check on the service itself (not an Uptime Kuma monitor). |

### Group 13 — NFS

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | **Required.** The sole persistence mechanism for the embedded SQLite database. |
| `nfs_mount_path` | `/app/data` | Fixed by the app's storage layout — do not change. |

### Group 16 — Database

| Variable | Default | Description |
|---|---|---|
| `database_type` | `"NONE"` | Fixed by `UptimeKuma_Common`. No Cloud SQL instance is provisioned. |

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
| `service_url` | URL to reach Uptime Kuma. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` / `database_host` / `database_port` | Present for output parity with other modules; **not meaningful for Uptime Kuma** — no Cloud SQL instance is provisioned (`database_type = "NONE"`). |
| `storage_buckets` | Created Cloud Storage buckets (empty by default). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Created init job names (empty by default) and optional import job. |
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
| `enable_nfs` | `true` | Critical | Disabling it removes the only persistence layer — the embedded SQLite database (all monitors, history, and the admin account) is ephemeral and lost on every pod recreation. |
| `nfs_mount_path` | `/app/data` | Critical | Changing it points Uptime Kuma's own hard-coded data path away from the persisted volume; the app writes SQLite to a path that is not actually the mounted NFS share. |
| `max_instance_count` | `1` | High | SQLite is single-writer; running >1 replica against the same NFS-mounted database file risks lock contention or corruption. |
| `database_type` | `"NONE"` | Low | Uptime Kuma ignores this — it never connects to Cloud SQL — but changing it will still provision an unused, billed Cloud SQL instance via the Foundation. |
| `container_port` | `3001` | High | Uptime Kuma listens on 3001; pointing the Service/probes at any other port makes the workload unreachable and probes fail. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS, bookmarks, and any external status-page embed. |
| First-run admin setup | Complete immediately after deploy | Medium | The setup wizard is reachable by anyone who finds the URL before an admin account is created — do not leave a freshly deployed instance with a public IP unconfigured for long. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Applies to Foundation-managed backups; since Uptime Kuma's real state is the NFS-hosted SQLite file, verify NFS/Filestore backup coverage separately rather than relying solely on this setting. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Uptime Kuma-specific application configuration
shared with the Cloud Run variant is described in
**[UptimeKuma_Common](UptimeKuma_Common.md)**.
