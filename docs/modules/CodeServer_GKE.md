---
title: "code-server on GKE Autopilot"
description: "Configuration reference for deploying code-server on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# code-server on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CodeServer_GKE.png" alt="code-server on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

code-server is Coder's open-source (MIT) build of Visual Studio Code that runs on a
remote server and is accessed entirely through the browser — a full IDE with the VS
Code extension marketplace, integrated terminal, and language servers, backed by a
persistent workspace. This module deploys code-server on **GKE Autopilot** on top of
the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services code-server uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

code-server runs as a single self-contained web workload listening on port **8080**.
Unlike database-backed apps, it wires together a deliberately minimal set of Google
Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single pod on port **8080**; 1 vCPU / 1 GiB by default |
| Persistent workspace | Cloud Storage (GCS FUSE) **or** Persistent Disk (block PVC) | Mounted at `/home/coder`; block PVC when `stateful_pvc_enabled = true` |
| Database | _None_ | `database_type = NONE` — code-server has no SQL database |
| Cache & queue | _None_ | Redis is explicitly disabled (`enable_redis = false`) |
| Secrets | Secret Manager | Auto-generated editor `PASSWORD` (when `enable_password = true`), delivered via SecretSync |
| Ingress | Cloud Load Balancing | **Default `service_type = ClusterIP`** — in-cluster only; opt into external exposure |

**Sensible defaults worth knowing up front:**

- **No database and no Redis.** code-server is a single container; all state lives in
  the workspace volume. `database_type` is fixed to `NONE` and Redis is disabled.
- **Service type is `ClusterIP` by default.** The workload is reachable only inside
  the cluster out of the box. Set `service_type = LoadBalancer` (or enable a custom
  domain) for external browser access.
- **Two workspace storage modes.** By default the workspace is a **GCS FUSE** volume
  at `/home/coder`. Setting `stateful_pvc_enabled = true` switches to a **StatefulSet
  block PVC** at `/home/coder` (lower-latency I/O for large workspaces); the wrapper
  then automatically disables the GCS volume to avoid a double-mount.
- **A random editor `PASSWORD` is generated automatically** and stored in Secret
  Manager, delivered into the pod via SecretSync as the `PASSWORD` env var. `PASSWORD`
  is a valid SecretSync `targetKey` (no `__`/consecutive separators).
- **Single replica by design.** `min_instance_count = max_instance_count = 1`.
  code-server holds per-session editor state in memory and owns one workspace volume.
- **`fsGroup = 3000`** is set on the StatefulSet security context so the block PVC is
  group-writable by the code-server process (which runs as UID 1000 / GID 2000).
- **The image is a thin wrapper over `codercom/code-server`**, built and mirrored into
  Artifact Registry via Cloud Build; `latest` pins to `4.99.1` at build time.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the code-server workload

code-server runs as a single pod on Autopilot (a Deployment by default, or a
StatefulSet when `stateful_pvc_enabled = true` / `workload_type = StatefulSet`).
Autopilot bills for the CPU/memory the pod actually requests.

- **Console:** Kubernetes Engine → Workloads → select the code-server workload to see
  the pod, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  ClusterIP / external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl get statefulset,pvc -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Workspace storage — GCS FUSE or Persistent Disk

The single stateful resource, mounted at `/home/coder`:

- **GCS FUSE (default).** A dedicated **Cloud Storage** bucket is provisioned and
  mounted via the CSI driver at `/home/coder`.
- **Block PVC (`stateful_pvc_enabled = true`).** A per-pod **Persistent Disk** PVC
  (`standard-rwo` by default, `20Gi`) is mounted at `/home/coder` instead, and the GCS
  volume is disabled to avoid a double-mount.

```bash
# GCS FUSE workspace bucket:
gcloud storage buckets list --project "$PROJECT" --filter="name~codeserver"
# Block PVC (when enabled):
kubectl get pvc -n "$NAMESPACE"
kubectl describe pvc -n "$NAMESPACE" <pvc-name>
```

See [App_GKE](App_GKE.md) for CMEK options, GCS FUSE, and StatefulSet PVC details.

### C. Secret Manager — the editor password

When `enable_password = true` (default), a 24-character random `PASSWORD` is generated
and stored in Secret Manager, then synced into the pod as the `PASSWORD` env var via
SecretSync to gate the login page. There is no database password (no database).

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~codeserver AND name~password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Confirm the env var reached the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -c PASSWORD
  ```

The secret ID is surfaced as the `codeserver_password_secret_id` output. See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### D. Networking & ingress

The Service defaults to **`ClusterIP`** — in-cluster only. For external browser access
set `service_type = LoadBalancer`, or enable a custom domain (`enable_custom_domain`,
`true` by default) with a Google-managed certificate via the Gateway API. A static IP
is reserved by default (`reserve_static_ip = true`) so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available (an uptime check needs a
reachable external endpoint).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. code-server Application Behaviour

- **No first-deploy database setup.** code-server has no SQL database and no
  initialization job. The pod comes up as soon as the container binds to
  `0.0.0.0:8080` (set via `BIND_ADDR`).
- **No migrations.** Upgrading `application_version` rolls a new pod on the newer
  image; there is no schema to migrate.
- **The workspace is the only durable state.** Everything under `/home/coder` — open
  folders, `settings.json`, keybindings, and installed extensions — persists on the
  GCS FUSE bucket or the block PVC. Deleting it wipes the workspace.
- **Login is gated by the `PASSWORD` secret.** With `enable_password = true`, the
  editor prompts for the SecretSync-delivered password (§2C). With it disabled, anyone
  reaching the Service gets an unauthenticated IDE — only run that way behind
  `ClusterIP`.
- **Health path.** The GKE variant's startup/liveness probes default to `/health`;
  when a password is enabled, override the path to the unauthenticated `/healthz`
  (which returns `200` without auth), since `/health` returns `401` and would fail the
  probe. Inspect the running pod:
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep BIND_ADDR
  ```
- **Single-replica scaling.** Keep `min = max = 1`. Editor sessions are in memory and
  the workspace volume has a single writer. With a block PVC, `stateful_pod_management_policy`
  defaults to `OrderedReady` for safe restarts.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for code-server are listed; every other input is
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
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `codeserver` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | code-server image tag; `latest` pins to `4.99.1` at build time. Pin a release in production. |
| `enable_password` | `true` | Generate a random editor `PASSWORD` and require it at login. **Leave enabled for any externally exposed deployment.** |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per pod; raise for heavy language servers. |
| `memory_limit` | `1Gi` | Memory per pod; size to the workspaces and extensions you run. |
| `min_instance_count` | `1` | Keep at 1 — single-instance editor. GKE does not scale to zero. |
| `max_instance_count` | `1` | Keep at 1 — one workspace volume, in-memory session. |
| `enable_cloudsql_volume` | `false` | code-server has no Cloud SQL — keep false. |
| `enable_image_mirroring` | `true` | Mirror the code-server image into Artifact Registry. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `ClusterIP` | In-cluster by default. Set `LoadBalancer` for external browser access. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true`; otherwise `Deployment`. |
| `session_affinity` | `None` | Sticky routing is unnecessary for a single-replica editor. |
| `namespace_name` | `""` | Auto-generated from `application_name` + `tenant_deployment_id` when empty. |
| `termination_grace_period_seconds` | `60` | Allow code-server to flush in-flight writes before SIGKILL. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Set `true` to mount a block PVC at `/home/coder` (recommended for large workspaces); auto-selects StatefulSet and disables the GCS volume. |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC size; hold all workspace files plus overhead. |
| `stateful_pvc_mount_path` | `/home/coder` | Workspace mount path. |
| `stateful_pvc_storage_class` | `standard-rwo` | Balanced PD default; use `premium-rwo` for higher IOPS. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` recommended for safe restarts. |
| `stateful_fs_group` | `3000` | Pod-level `fsGroup` so the PVC is group-writable (code-server runs as UID 1000 / GID 2000). |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health` 15s delay | Startup probe. Override `path` to `/healthz` when a password is enabled. |
| `liveness_probe` | HTTP `/health` 30s delay | Liveness probe. Override `path` to `/healthz` when a password is enabled. |
| `uptime_check_config` | `{ enabled = false, path = "/health" }` | Cloud Monitoring uptime check; disabled by default (needs an external endpoint). |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is off by default; the workspace uses GCS FUSE or a block PVC, not NFS. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path if NFS is enabled. |

### Group 15 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | _(forced `false`)_ | Not applicable to code-server; the wrapper overrides the App_GKE default of `true`. |
| `redis_auth` | `""` | Not applicable; forwarded to the foundation for compatibility. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `codeserverdb` | Not referenced — code-server has no SQL database; forwarded for compatibility. |
| `db_user` | `codeserveruser` | Not referenced — forwarded for compatibility. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Gateway API Ingress + managed certificate for custom hostnames. |
| `application_domains` | `[]` | Hostnames to serve (e.g. `codeserver.example.com`). |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

All other inputs follow standard App_GKE behaviour.

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
| `service_url` | URL to reach code-server. |
| `codeserver_password_secret_id` | Secret Manager secret ID holding the editor password (empty when `enable_password = false`). |
| `storage_buckets` | Created Cloud Storage buckets (the workspace bucket). |
| `statefulset_name` | Name of the StatefulSet (when a block PVC is enabled). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any user-supplied init jobs (none by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — `workload_type = "Deployment"` alongside `stateful_pvc_enabled = true`, IAP with no authorized identities, a bare-integer `quota_memory_*` value, an out-of-range `timeout_seconds`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_password` | `true` (keep on for external exposure) | Critical | Disabling with `service_type = LoadBalancer` (or a custom domain) exposes a fully unauthenticated IDE — including a terminal — to the internet. |
| Workspace volume (bucket / PVC) | Never delete | Critical | The `/home/coder` GCS bucket or PVC is the only persistent state; deleting it wipes all settings, extensions, and files. |
| `startup_probe` / `liveness_probe` path | `/healthz` when a password is set | High | The GKE default `/health` returns `401` under a password; the pod never becomes Ready and restart-loops. |
| `stateful_pvc_enabled` + `workload_type` | Do not set `Deployment` with PVC enabled | High | The combination is rejected at plan time; PVC requires a StatefulSet. |
| `max_instance_count` | `1` | High | Scaling beyond 1 splits editor sessions across pods and risks concurrent writes to a single workspace volume. |
| `stateful_fs_group` | `3000` (non-zero) | High | Setting `0` leaves `fsGroup` unset; the block PVC may be root-owned and code-server (UID 1000) cannot write to `/home/coder`. |
| `service_type` | `ClusterIP` (or LoadBalancer + password) | High | `LoadBalancer` without a password publishes an open IDE; `ClusterIP` blocks all external browser access. |
| `enable_cloudsql_volume` | `false` | Low | code-server has no database; enabling adds an unused Auth Proxy sidecar. |
| `memory_limit` | `1Gi`+ | Medium | Heavy language servers/extensions can OOM below 1 GiB. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. code-server-specific
application configuration shared with the Cloud Run variant is described in
**[CodeServer_Common](CodeServer_Common.md)**.
