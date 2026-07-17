---
title: "ActualBudget on GKE Autopilot"
description: "Configuration reference for deploying ActualBudget on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# ActualBudget on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ActualBudget_GKE.png" alt="ActualBudget on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Actual Budget is a privacy-first, local-first personal finance application built around
zero-based envelope budgeting. The `actual-server` component is a lightweight Node.js sync
server that stores each budget as a SQLite file and synchronises it across the web UI,
desktop, and mobile clients. This module deploys ActualBudget on **GKE Autopilot** as a
**StatefulSet** with a per-pod block PVC, on top of the [App_GKE](App_GKE.md) foundation,
which provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services ActualBudget uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are common
to every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to
the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

ActualBudget runs as a single Node.js `actual-server` workload. Because it manages its own
SQLite storage, the deployment wires together a deliberately small set of Google Cloud
services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | `actual-server` pods, 1 vCPU / 1 GiB by default, single replica (`min = max = 1`) run as a **StatefulSet** |
| Database | None | Budgets are SQLite files under `/data` — `database_type = "NONE"` is fixed by `ActualBudget_Common`; no Cloud SQL instance is created |
| Persistent storage | Kubernetes PVC (per-pod block volume) | `stateful_pvc_enabled = true` by default — a 20Gi `standard-rwo` PVC mounted at `/data` (SQLite needs block storage, not GCS FUSE) |
| Object storage | Cloud Storage | A `storage` bucket is always declared by `ActualBudget_Common`; it only mounts at `/data` (via GCS FUSE) when the block PVC is disabled |
| Secrets | Secret Manager | Optional — a 32-character API token (`enable_api_key`, default `false`) injected as `ACTUAL_TOKEN` via a native Kubernetes Secret |
| Ingress | Kubernetes Service / Gateway API | Defaults to `service_type = ClusterIP` with `enable_custom_domain = true` but no domains configured — internal-only until you add a LoadBalancer or a domain |

**Sensible defaults worth knowing up front:**

- **StatefulSet + block PVC by default.** `stateful_pvc_enabled = true` auto-resolves
  `workload_type` to `StatefulSet` (no need to set both) and mounts a 20Gi `standard-rwo`
  PVC at `/data` with `fsGroup = 3000`, matching the ActualBudget Helm chart's convention so
  the container (UID 1000/GID 2000) can write to the volume. This is deliberately preferred
  over GCS FUSE because SQLite does not tolerate a FUSE-mounted directory well.
- **No database at all.** `database_type` is fixed to `NONE` by `ActualBudget_Common`; there
  is no Cloud SQL instance, no `db-init` job, and `enable_cloudsql_volume` defaults `false`
  (no Cloud SQL Auth Proxy sidecar).
- **Redis is hard-disabled, not just off by default.** The variant's `main.tf` passes
  `enable_redis = false` to the App_GKE foundation unconditionally — it does **not** forward
  `var.enable_redis` — so ActualBudget never receives a `REDIS_HOST` on GKE regardless of how
  that variable is set.
- **Single replica by design.** `min_instance_count = 1` and `max_instance_count = 1` — the
  server assumes exclusive access to its SQLite files on the shared PVC.
- **`container_port` is fixed at `5006`** by `ActualBudget_Common` regardless of the
  `container_port` variable's own value — that variable is inert (its description/validation
  text references a stale `6333`, a harmless copy-paste artifact from another module).
- **No admin/secret generation.** The server password is set interactively on the first-run
  onboarding screen — there is no pre-seeded credential to retrieve unless `enable_api_key =
  true` generates an `ACTUAL_TOKEN`.
- **Health probes target `/`** — HTTP `GET /` returns 200 as soon as the Node server is
  listening, no authentication required.
- **Out-of-the-box exposure is internal-only.** `service_type` defaults to `ClusterIP` (not
  `LoadBalancer`, unlike most GKE app modules) and `enable_custom_domain` defaults to `true`
  but `application_domains` defaults to `[]` — so a fresh deploy has no reachable external
  endpoint until you set `service_type = LoadBalancer` or supply `application_domains` (plus
  DNS).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other identifiers
are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the ActualBudget StatefulSet

ActualBudget runs as a single-replica StatefulSet, which gives its pod a stable identity
(`<statefulset-name>-0`) and rebinds the same PVC across restarts and updates.

- **Console:** Kubernetes Engine → Workloads → select the ActualBudget workload for pods,
  revisions, and events.
- **CLI:**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Persistent Volumes — the `/data` block PVC

With `stateful_pvc_enabled = true` (the default), a per-pod PersistentVolumeClaim is
provisioned and mounted at `/data`, where `actual-server` writes its budget SQLite
databases, server files, and user files. The default `standard-rwo` StorageClass is
SSD-backed (Balanced PD) and draws the (often tight) `SSD_TOTAL_GB` regional quota.

- **Console:** Kubernetes Engine → Storage → PersistentVolumeClaims.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- df -h /data
  ```

### C. Cloud Storage — the `storage` bucket (GCS FUSE fallback)

`ActualBudget_Common` always declares a Cloud Storage bucket (`storage`), but it is only
mounted at `/data` via GCS FUSE when the block PVC is disabled
(`stateful_pvc_enabled = false`). With the default StatefulSet PVC in place, this bucket
exists but is not mounted.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~actualbudget"
  ```

See [App_GKE](App_GKE.md) for GCS Fuse mount behaviour and CMEK options.

### D. Secret Manager — optional API token

By default no secrets are created. When `enable_api_key = true`, a 32-character random
token is generated, stored in Secret Manager as `secret-<prefix>-<app>-api-key`, and
injected into the pod as the `ACTUAL_TOKEN` environment variable via a native Kubernetes
Secret — useful for automations that must call the server before the UI is configured.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

The workload defaults to `service_type = ClusterIP` — no external IP is created out of the
box. `enable_custom_domain = true` provisions a Kubernetes Gateway API resource, but with
`application_domains = []` by default there are no hostnames to route. Set
`service_type = LoadBalancer` for a direct external IP, or populate `application_domains`
(with DNS pointed at the resulting IP) for a custom-domain Gateway with a managed
certificate.

- **Console:** Kubernetes Engine → Services & Ingress; Network services → Load balancing.
- **CLI:**
  ```bash
  kubectl get svc,gateway -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring. An optional
uptime check (`uptime_check_config`, disabled by default) requires a publicly reachable
endpoint, which the `ClusterIP` default does not provide.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. ActualBudget Application Behaviour

- **No initialization job.** There is no database to bootstrap; the server creates its
  SQLite files under `/data` on first boot. Custom `initialization_jobs` are accepted for
  data loading or migration tasks but none is provided by default.
- **First-run setup.** On first access the web UI shows an onboarding screen where you set
  the **server password** — there are no pre-seeded credentials to retrieve. Do this
  immediately after making the service reachable; until a password is set, anyone who can
  reach the URL can claim the server.
- **Data layout.** `ACTUAL_SERVER_FILES = /data/server-files` (server metadata and the
  account database) and `ACTUAL_USER_FILES = /data/user-files` (per-budget sync data), both
  on the persistent `/data` mount (PVC by default).
- **Local-first sync model.** Clients (web, desktop, mobile) keep a full local copy of the
  budget and use the server only to synchronise encrypted changes between devices — brief
  server unavailability does not block working in a client.
- **Single-writer constraint, safe StatefulSet updates.** The server assumes exclusive
  access to its SQLite files; keep `max_instance_count = 1`. Because the workload is a
  StatefulSet with a stable per-pod identity bound to the same PVC, the default
  `RollingUpdate` strategy replaces the single pod in place rather than surging a second
  pod against the shared volume — unlike the Deployment+NFS combinations used by other
  modules in this repo, there is no double-mount deadlock risk here.
- **Probe precedence.** `startup_probe_config` and `health_check_config` (the generic
  top-level App_GKE probe variables) are **inert** for ActualBudget — the effective probe
  configuration always comes from ActualBudget's own `startup_probe` / `liveness_probe`
  variables (forwarded through `ActualBudget_Common`'s `config` output), both of which
  target unauthenticated HTTP `GET /`.
- **Version updates.** Change `application_version` and re-apply — Cloud Build produces a
  new image and the StatefulSet rolls the new revision. `latest` builds the pinned
  `25.7.1` via the app-specific `ACTUALBUDGET_VERSION` build ARG (not the generic
  `APP_VERSION` the foundation injects).
- **Health path.** Startup probe: HTTP `GET /`, 15s initial delay, 10s timeout, 10s period,
  10 failures allowed. Liveness probe: HTTP `GET /`, 30s initial delay, 5s timeout, 30s
  period, 3 failures allowed. Both return 200 unauthenticated as soon as the HTTP server is
  listening.
- **Verification:**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  POD=$(kubectl get pods -n "$NAMESPACE" -l app=<service-name> -o jsonpath='{.items[0].metadata.name}')
  kubectl port-forward -n "$NAMESPACE" "$POD" 5006:5006 &
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5006/   # expect 200
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for ActualBudget are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `actualbudget` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Image version tag; `latest` builds the pinned `25.7.1`. |
| `enable_api_key` | `false` | Generate a 32-char API token in Secret Manager and inject it as `ACTUAL_TOKEN`. Recommended for any deployment reachable outside the pod/namespace. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | `actual-server` is a lightweight Node.js process; 1 vCPU suffices. |
| `memory_limit` | `1Gi` | Modest memory is enough for typical budget files. |
| `min_instance_count` | `1` | Keeps the single instance warm and avoids cold starts. |
| `max_instance_count` | `1` | **Keep at 1** — one shared SQLite volume, one writer. |
| `container_port` | `5006` | Inert — `ActualBudget_Common` always sets the container port to `5006`. |
| `enable_cloudsql_volume` | `false` | No Cloud SQL — leave `false`. |
| `enable_image_mirroring` | `true` | Mirrors `actualbudget/actual-server` into Artifact Registry to avoid Docker Hub rate limits. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `ClusterIP` | Internal-only by default — unlike most GKE app modules, which default to `LoadBalancer`. |
| `workload_type` | `null` → `StatefulSet` | Auto-resolves because `stateful_pvc_enabled = true` by default. |
| `session_affinity` | `None` | No sticky routing configured (single replica makes this largely moot). |

### Group 7 — StatefulSet Configuration

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Enabled by default — `actual-server`'s SQLite budget DB and user files need block storage, not GCS FUSE. |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC size; size for the budget databases and files plus overhead. |
| `stateful_pvc_mount_path` | `/data` | Where `actual-server` persists its SQLite DB, server files, and user files. |
| `stateful_pvc_storage_class` | `standard-rwo` | SSD-backed Balanced PD; draws the `SSD_TOTAL_GB` quota — override to `standard` (HDD) if that quota is tight. |
| `stateful_fs_group` | `3000` | Matches the ActualBudget Helm chart's `fsGroup` convention so the container (UID 1000/GID 2000) can write to the PVC. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | On by default (unlike most modules) — protects the single StatefulSet replica during voluntary node disruption. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 15s initial delay, 10 failures | The **effective** startup probe (see §3 "Probe precedence"). |
| `liveness_probe` | HTTP `/`, 30s initial delay, 3 failures | The **effective** liveness probe. |
| `startup_probe_config` / `health_check_config` | HTTP `/` | Declared for foundation-variable mirroring but **inert** for ActualBudget — use `startup_probe` / `liveness_probe` above instead. |
| `uptime_check_config` | disabled | Enable only once the endpoint is publicly reachable (`LoadBalancer` or a custom domain). |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Always creates the `storage` bucket `ActualBudget_Common` declares. |
| `gcs_volumes` | `[]` | Additional GCS FUSE mounts; the `storage` bucket only auto-mounts at `/data` when `stateful_pvc_enabled = false`. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` (variable default) | **Has no effect** — `main.tf` hardcodes `enable_redis = false` to the foundation regardless of this variable's value. |
| `redis_host` / `redis_port` / `redis_auth` | inert | Not applicable — ActualBudget has no Redis integration on GKE. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` (fixed) | `ActualBudget_Common` fixes this to `NONE`; no Cloud SQL instance is created regardless of this variable. |
| `application_database_name` / `application_database_user` | `actualbudgetdb` / `actualbudgetuser` | Forwarded for foundation compatibility only — not referenced (no database exists). |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | On by default, but with `application_domains = []` the Gateway has no hostnames to route until you supply one. |
| `application_domains` | `[]` | Populate to expose ActualBudget via a custom domain + managed certificate. |
| `reserve_static_ip` | `true` | Reserves a static IP even though `service_type` defaults to `ClusterIP` (no LoadBalancer IP is allocated by default). |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate and
explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when `service_type = LoadBalancer` and a static IP is reserved). |
| `service_url` | URL to reach ActualBudget. |
| `actualbudget_api_key_secret_id` | Secret Manager secret ID for the API key. Empty when `enable_api_key = false`. |
| `statefulset_name` | Name of the StatefulSet. |
| `storage_buckets` | Created Cloud Storage buckets (includes the `storage` bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any custom setup jobs (empty by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `StatefulSet` forced alongside a stateless setting, IAP with no authorized identities, `quota_memory_*` given as bare integers, an out-of-range `container_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | Multiple pods writing the same SQLite files on one shared volume risks corruption/write conflicts. |
| First-run server password | set immediately | Critical | Until a password is set, anyone who can reach the service can claim the server and its budget data. |
| `/data` PVC contents | never delete manually | Critical | The block PVC is the only copy of the budget databases; deleting it erases all budgets. |
| `stateful_pvc_enabled` | `true` | Critical | Disabling it falls back to GCS FUSE at `/data`, which does not tolerate SQLite under heavy concurrent write. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling. |
| `service_type` / `application_domains` | set one to expose externally | High | With the defaults (`ClusterIP` + no domains), the service is reachable only from inside the cluster. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Medium | Draws the tight `SSD_TOTAL_GB` quota; override to `standard` (HDD) on a quota-constrained project — SQLite does not need SSD IOPS. |
| `enable_redis` | any value — **inert** | Low | Attempting to enable Redis via this variable has no effect on GKE; `main.tf` always forces it off. |
| `container_port` | `5006` (fixed) | Low | The variable is inert; its own description/validation text references a stale, unrelated port number. |
| `startup_probe_config` / `health_check_config` | any value — **inert** | Low | Use `startup_probe` / `liveness_probe` instead to change probe timing; these two are ignored for ActualBudget. |
| `enable_api_key` | `true` for automation on a reachable endpoint | Medium | Without `ACTUAL_TOKEN`, programmatic API access relies solely on the server password. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. ActualBudget-specific
application configuration shared with the Cloud Run variant is described in
**[ActualBudget_Common](ActualBudget_Common.md)**.
