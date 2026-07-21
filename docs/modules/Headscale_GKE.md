---
title: "Headscale on GKE Autopilot"
description: "Configuration reference for deploying Headscale on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Headscale on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Headscale_GKE.png" alt="Headscale on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Headscale is an open-source, self-hosted implementation of the Tailscale
coordination server — a control plane for a private WireGuard mesh VPN,
compatible with the official Tailscale clients. Headscale is **not** a VPN
gateway or relay itself: it authenticates nodes, distributes each peer's
public key and IP allocation, and keeps the mesh's network map in sync.
Actual encrypted traffic between devices flows directly, peer-to-peer, over
WireGuard (or via Tailscale's own public DERP relay infrastructure). This
module deploys Headscale on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Headscale uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Headscale runs as a single Go binary pod on GKE Autopilot, built from a
custom, `ko`-based upstream image. The deployment wires together a focused
set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot, StatefulSet | Go workload, 1 vCPU / 1 GiB by default; hard-pinned to a single replica |
| Database | Embedded SQLite | No Cloud SQL instance — `database_type = "NONE"` |
| Persistence | **Real block-storage PVC** (default) | `stateful_pvc_enabled = true` by default — `/var/lib/headscale` on `pd-standard` HDD, not GCS Fuse |
| Secrets | Secret Manager | None — Headscale has no application-level secrets in this module |
| Ingress | Cloud Load Balancing / Gateway API | External static IP + custom domain by default (`reserve_static_ip = true`, `enable_custom_domain = true`) |

**Sensible defaults worth knowing up front:**

- **SQLite is the only supported database.** There is no external Cloud SQL
  instance; all state (node registry, pre-auth keys, the Noise-protocol
  private key) lives in a single SQLite file under `/var/lib/headscale`.
- **StatefulSet + real block PVC is the default layout, not an opt-in.**
  `stateful_pvc_enabled = true` by default runs Headscale as a StatefulSet
  with a per-pod PVC — this is the platform variant that actually solves the
  SQLite/file-locking problem Cloud Run cannot. `stateful_pvc_storage_class`
  defaults to `standard` (HDD `pd-standard`, not SSD) since Headscale's files
  are small with no high-IOPS need.
- **`max_instance_count` is hardcoded to `1` downstream, not just defaulted.**
  `Headscale_Common` sets `config.max_instance_count = 1` as a literal value
  regardless of what this module's variable holds. Headscale has no
  active-active support.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`).
- **A stable, public entry point matters more here than for most apps.**
  `reserve_static_ip = true` and `enable_custom_domain = true` are both
  defaults — every device registered against this server needs a durable
  URL, not just a browser session.
- **MagicDNS is off by default.** It requires `dns.base_domain` set and
  genuinely different from `server_url`'s domain.
- **No default initialization job.** Headscale's SQLite file is created
  automatically on first boot.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#6-outputs).

### A. GKE Autopilot — the Headscale StatefulSet

Headscale runs as a single-replica StatefulSet by default (`workload_type`
auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true`). Because
`max_instance_count` is hardcoded to `1`, there is no horizontal scaling to
observe here.

- **Console:** Kubernetes Engine → Workloads → select the Headscale workload
  for pods, revisions, and events.
- **CLI:**
  ```bash
  kubectl get statefulset,pods,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot and the workload type
(Deployment vs StatefulSet) are managed.

### B. Persistent Volume — the SQLite storage PVC

With `stateful_pvc_enabled = true` (the default), a real block-storage PVC is
mounted at `/var/lib/headscale`, holding `db.sqlite` (+ `-wal`/`-shm` sidecars
in WAL mode), `noise_private.key`, and the legacy WireGuard key. This gives
SQLite's WAL mode genuine POSIX file locking — confirmed live to be
completely free of the gcsfuse write errors observed on the Cloud Run
variant.

- **Console:** Kubernetes Engine → Storage → Persistent Volume Claims.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  ```

See [App_GKE](App_GKE.md) for the StatefulSet PVC mechanics and storage class
options.

### C. Networking & ingress

By default the workload gets a reserved static external IP and a Gateway API
Ingress for a custom hostname — important here because every registered
Tailscale client device needs a durable URL to reach the coordination server.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get gateway,httproute,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### D. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging. On boot, a healthy pod logs
private-key generation, "database opened successfully", and "listening and
serving HTTP". GKE metrics flow to Cloud Monitoring.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Headscale Application Behaviour

- **SQLite auto-initializes on boot.** No separate database-setup job — on
  first start Headscale creates `db.sqlite` under `/var/lib/headscale` and
  applies its own internal schema migrations automatically.
- **Private key auto-generation.** On first boot Headscale generates its
  Noise-protocol private key at `noise_private.key` if it does not already
  exist. Losing this key (or the PVC) forces every previously-registered
  client node to re-register.
- **Health endpoint.** `/health` is a real, unauthenticated endpoint —
  confirmed live returning HTTP 200 alongside "listening and serving HTTP" in
  the application logs. Both the startup and liveness probes target it by
  default.
- **First-run setup is a manual, post-deploy step — GKE's shell access makes
  this straightforward.** Headscale ships with no web-based signup flow.
  Create the first user and a pre-auth key by exec'ing directly into the
  running pod:
  ```bash
  POD=$(kubectl get pods -n "$NAMESPACE" -l app=<service-name> -o jsonpath='{.items[0].metadata.name}')

  # Create the first user/namespace:
  kubectl exec -n "$NAMESPACE" "$POD" -- /ko-app/headscale users create myuser

  # Issue a pre-auth key for that user (valid 1 hour, reusable):
  kubectl exec -n "$NAMESPACE" "$POD" -- /ko-app/headscale preauthkeys create \
    --user myuser --reusable --expiration 1h
  ```
  See the [hands-on lab](../labs/Headscale_GKE.md) for the full walkthrough.
- **Connecting a real Tailscale client.** Once a pre-auth key exists:
  ```bash
  tailscale up --login-server=<server_url> --authkey=<preauthkey>
  ```
- **Inspecting registered nodes:**
  ```bash
  kubectl exec -n "$NAMESPACE" "$POD" -- /ko-app/headscale nodes list
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Headscale are listed; every other input
is inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `headscale` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `"latest"` resolves to the pinned upstream build `HEADSCALE_VERSION=0.26.1`. |
| `server_url` | `""` | Public URL of the control plane, baked into every client's registration. Defaults to the internal cluster URL, or the reserved static IP / custom domain when configured. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `min_instance_count` | `0` | Scale-to-zero. |
| `max_instance_count` | `1` | **Hardcoded to `1` downstream regardless of this value** — see [Pitfalls](#7-pitfalls--gotchas). |
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Per-pod resource limits. |
| `container_port` | `8080` (declared, not forwarded) | Fixed at 8080 via `Headscale_Common` regardless of this variable's value. |

### Group 6 — GKE Backend Configuration

| Variable | Default | Description |
|---|---|---|
| `workload_type` | `null` (auto-resolves to `StatefulSet`) | Because `stateful_pvc_enabled = true` by default. |
| `service_type` | `ClusterIP` | Public reachability comes from the Gateway (`enable_custom_domain`), not this Service type — this is not the same fleet-wide "should be LoadBalancer" bug seen on browser-facing apps elsewhere in this catalog, since the actual client-facing entry point is the Gateway/static-IP path. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | **`true`** | The default, and the reason this platform variant doesn't share Cloud Run's SQLite/gcsfuse risk — see [Pitfalls](#7-pitfalls--gotchas). |
| `stateful_pvc_mount_path` | `/var/lib/headscale` | Must not be changed — this is where Headscale stores its SQLite DB and keys. |
| `stateful_pvc_storage_class` | `standard` (HDD) | Deliberately not SSD — small files, no high-IOPS need, and HDD draws from the much larger `DISKS_TOTAL_GB` quota. |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC size. |

### Group 12 — Database (forwarded for compatibility)

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed by `Headscale_Common` — no Cloud SQL instance is ever created. |

### Group 19 — Custom Domain & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisions the Gateway API Ingress — the actual public entry point. |
| `reserve_static_ip` | `true` | A stable server URL matters for every registered client device. |

### Group 20 — Identity-Aware Proxy

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | **Never enable for normal use** — IAP requires a Google identity, which the `tailscale` CLI cannot present, blocking client registration. |

### Group 22 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, 15s delay, threshold 10 | Real, unauthenticated Headscale endpoint. |
| `liveness_probe` | HTTP `/health`, 30s delay, threshold 3 | Same endpoint. |

---

## 5. GCP Service Exploration Reference

See §2 above — GKE Autopilot/StatefulSet, the persistent volume, networking,
and logging/monitoring are the full set of services this module touches
directly (beyond the shared VPC/IAM/Artifact Registry infrastructure common
to every `App_GKE` deployment).

---

## 6. Outputs

These values are returned on a successful deployment and are the quickest way
to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `service_external_ip` | External LoadBalancer/reserved IP. |
| `service_url` | URL to reach Headscale — this is what `server_url` predicts and what clients register against. |
| `storage_buckets` | Created Cloud Storage buckets (the `storage` bucket — unused as a mount when `stateful_pvc_enabled = true`, the default). |
| `statefulset_name` | Name of the StatefulSet (present with the default `workload_type = "StatefulSet"`). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any custom setup jobs (empty by default). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD GitHub details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. False on the first apply of a brand-new inline cluster — re-apply to finish. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 7. Pitfalls & Gotchas

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_GKE](App_GKE.md) foundation engine, which validates
> values and combinations at plan time — see [App_GKE](App_GKE.md) for the
> general validation behaviour, plus the module-specific
> Validation Guards section of `modules/Headscale_GKE/README.md`.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `stateful_pvc_enabled` | Keep `true` (the default) | **Critical if overridden to `false`** | This is the setting that gives Headscale's SQLite database real POSIX file locking. Setting it `false` falls back to the same GCS-Fuse-backed volume as `Headscale_CloudRun`, reintroducing the confirmed-live SQLite/gcsfuse write-error risk (`BufferedWriteHandler.OutOfOrderError`) that this platform variant exists specifically to avoid. Only disable this if you have a strong independent reason. |
| `stateful_pvc_storage_class` | `standard` (HDD, the default) | Medium (cost/quota) | Switching to `standard-rwo`/`premium-rwo` (SSD) draws from the much tighter `SSD_TOTAL_GB` regional quota for no real benefit — Headscale's files are small with no high-IOPS need. |
| `max_instance_count` | Leave at `1` (it's hardcoded anyway) | High | The variable is declared but never actually read by `Headscale_Common` — `config.max_instance_count` is a literal `1`. Setting it higher gives a false impression that horizontal scaling is available. |
| `server_url` | Set once, before registering clients | Critical | Baked into every client's registration. Changing it after clients have registered requires re-registering every node. |
| `enable_iap` | `false` | Critical | IAP requires a Google identity for every request. The `tailscale` CLI cannot present one, so enabling IAP blocks all client registration and mesh sync traffic. |
| Deleting the PVC/StatefulSet | Never delete while nodes are registered | Critical | The Noise-protocol private key and the entire node registry live on the PVC. Losing it forces every client to re-register from scratch. Recall the catalog-wide rule: scaling to zero does **not** release the PVC — only deleting it does. |
| MagicDNS (`dns.magic_dns`) | Leave `false` unless you also set a genuine `dns.base_domain` | Medium | Enabling MagicDNS without a valid, distinct `base_domain` from `server_url`'s domain produces broken DNS resolution for clients. |
| `reserve_static_ip` / `enable_custom_domain` | Keep `true` (the defaults) | Medium | Without a stable URL, an ephemeral or internal-DNS address can change under a redeploy, silently breaking every registered client's ability to reach the coordination server. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Headscale-specific application configuration
shared with the Cloud Run variant is described in
**[Headscale_Common](Headscale_Common.md)**.
