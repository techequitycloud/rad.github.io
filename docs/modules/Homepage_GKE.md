---
title: "Homepage on GKE Autopilot"
description: "Configuration reference for deploying Homepage on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Homepage on GKE Autopilot

[Homepage](https://gethomepage.dev/) (gethomepage/homepage) is a self-hosted,
highly customizable application dashboard/service-launcher — a Next.js
16 / Node 22 application whose entire configuration (services, bookmarks,
widgets, layout) lives in a handful of YAML files, with optional live
status/stats widgets for other self-hosted apps you run. This module deploys
Homepage on **GKE Autopilot** on top of the [App_GKE](App_GKE.md)
foundation, which provisions and manages the shared Google Cloud and
Kubernetes infrastructure.

This guide focuses on the cloud services Homepage uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Homepage runs as a single Node.js/Next.js pod on GKE Autopilot. Like the
Cloud Run variant, it has **no database and no cache** — its entire state is
a directory of YAML files. What's different on GKE is the storage layer
itself: Cloud Run has no PVC concept, so `Homepage_CloudRun` always uses a
GCS FUSE volume; `Homepage_GKE` defaults to the same GCS FUSE approach but
additionally offers a real block-storage PVC as an explicit opt-in.

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single Node.js pod, `1000m` CPU / `1Gi` memory by default |
| Database | none | Homepage has no database of any kind; `database_type = "NONE"` |
| Object storage | Cloud Storage (default) **or** a block PVC | Default: a `storage` bucket mounted at `/app/config` via the GCS FUSE CSI driver. With `stateful_pvc_enabled = true`: a per-pod `standard-rwo` PVC (`5Gi` default) at the same path instead, and the workload becomes a `StatefulSet` |
| Cache & queue | none | `enable_redis = false` is hardcoded in `main.tf`, overriding the foundation's own default of `true` |
| Secrets | none | No secret is generated — Homepage needs no credentials of its own |
| Ingress | Cloud Load Balancing | `LoadBalancer` Service by default, with an optional custom domain + managed certificate; `ClusterIP` is available for internal-only or quota-constrained deployments |

**Sensible defaults worth knowing up front:**

- **Genuinely prebuilt — no custom image, no Cloud Build for the app.**
  `Homepage_Common` sets `image_source = "prebuilt"` and
  `container_build_config.enabled = false`; `ghcr.io/gethomepage/homepage` is
  deployed directly. `enable_image_mirroring = true` still copies it into
  Artifact Registry (avoids GHCR rate limits), but that is a mirror, not a
  build.
- **Port 3000, health path `/api/healthcheck`.** Confirmed via a live
  deployment: `GET /api/healthcheck` returns an unauthenticated `200 "up"`
  once the app is ready (backed by the image's own `HEALTHCHECK` directive).
  `GET /` returns the real dashboard HTML (confirmed: `<title>Homepage</title>`).
- **Two storage layouts, chosen by `stateful_pvc_enabled`.** The default
  (`false`) runs a stateless `Deployment` with the `storage` GCS bucket
  mounted at `/app/config` — identical in shape to `Homepage_CloudRun`.
  Setting it `true` switches to a `StatefulSet` with a real block-storage
  PVC at the same path instead (the GCS volume is then automatically
  disabled to avoid a double-mount). This is a genuine, deliberate
  platform-driven difference — GKE has PVCs, Cloud Run does not — not an
  inconsistency between the two variants. **The block-PVC mode is what was
  verified live for this module** (see §3).
- **No database, no Redis — architecturally unusual for this catalogue.**
  Almost every other application module wires a Cloud SQL instance and/or
  Redis through the foundation; Homepage needs neither. This also means it
  has none of the usual DSN-wiring, socket-vs-TCP, or password-URL-encoding
  classes of bugs documented elsewhere in this repository — there is simply
  no database connection to get wrong.
- **Multi-instance safety depends on the storage mode.** In the default GCS
  FUSE mode, `max_instance_count > 1` is genuinely safe — every pod reads
  the same shared bucket live from disk, with no in-process cache. With
  `stateful_pvc_enabled = true`, each `StatefulSet` pod ordinal gets its
  **own separate PVC** (standard Kubernetes `volumeClaimTemplates`
  semantics) — running more than one replica in that mode gives each pod an
  independently diverging config, not a shared dashboard. Keep
  `max_instance_count = 1` whenever the block PVC is enabled.
- **No authentication of its own.** `HOMEPAGE_ALLOWED_HOSTS` defaults to
  `"*"` — this only gates the `Host` header check on Homepage's `/api/*`
  widget-data calls, not real access control. Put it behind IAP, a VPN, or a
  reverse proxy if you need to restrict who can reach it.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and
other identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Homepage workload

- **Console:** Kubernetes Engine → Workloads → select the Homepage workload
  for pods, revisions, and events. Kubernetes Engine → Services & Ingress
  shows the external IP (if `service_type = LoadBalancer`).
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  # If stateful_pvc_enabled = true, the workload is a StatefulSet:
  kubectl get statefulset -n "$NAMESPACE"
  # Otherwise it is a Deployment:
  kubectl get deploy -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" <pod-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Storage — `/app/config`

The storage mechanism depends on `stateful_pvc_enabled`:

- **Default (`false`) — GCS FUSE.** The `storage` bucket is mounted at
  `/app/config` via the GCS FUSE CSI driver. It holds every YAML config file
  Homepage reads (`settings.yaml`, `services.yaml`, `bookmarks.yaml`,
  `widgets.yaml`, `docker.yaml`) plus Homepage's logs.
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~homepage"
  gcloud storage ls "gs://<bucket-name>/"
  gcloud storage cat "gs://<bucket-name>/settings.yaml"
  ```
- **Opt-in (`true`) — block PVC.** A per-pod `standard-rwo` PVC (`5Gi`
  default) is mounted at `/app/config` instead. Inspect it directly:
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls -la /app/config
  kubectl exec -n "$NAMESPACE" <pod-name> -- cat /app/config/settings.yaml
  ```
  There is no GCS bucket to inspect in this mode — `storage_buckets` output
  is only populated when the module runs in its default (non-PVC) layout.

### C. Secret Manager

Nothing to see here — Homepage generates no secrets. Confirming this is
itself a useful sanity check on a fresh deployment:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~homepage"
# expect: no results
```

### D. Networking & ingress

```bash
kubectl get svc -n "$NAMESPACE"
gcloud compute addresses list --project "$PROJECT" --filter="name~homepage"
```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### E. Cloud Logging & Monitoring

```bash
kubectl logs -n "$NAMESPACE" <pod-name> --tail=100
gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
  --project "$PROJECT" --limit 50
```

---

## 3. Homepage Application Behaviour

- **No first-deploy database-schema job.** Homepage has no database, so
  `initialization_jobs` is empty by default and no job is needed.
- **No first-run setup wizard.** There is no admin account to create and no
  onboarding flow — Homepage renders its dashboard from whatever config
  exists in `/app/config` (the upstream image's own bundled defaults on a
  fresh deployment, since the entrypoint self-seeds any missing file).
  Customize the dashboard by editing the YAML files directly (via the GCS
  bucket or `kubectl exec`, depending on storage mode — see §2B) or by
  configuring `docker.yaml`/label-based discovery if you connect it to a
  Docker/Kubernetes API.
- **Health path.** Startup and liveness probes both target
  `GET /api/healthcheck` — an unauthenticated `200 "up"`, confirmed live.

### Verified live: StatefulSet + block PVC

This module's first deployment used `stateful_pvc_enabled = true` (set in
`config/deploy.tfvars`), exercising the block-PVC storage path end to end:

- Pod `<service>-0` reported `1/1 Running` with **0 restarts**.
- PVC `data-<service>-0` reported `Bound`.
- Boot logs showed a clean sequence: a config-directory ownership fix, the
  Next.js server becoming ready, then `settings.yaml`/`kubernetes.yaml`
  self-seeding onto the empty PVC with no errors.
- `GET /api/healthcheck` returned `200 "up"`.
- `GET /` returned the real dashboard HTML (`<title>Homepage</title>`), not
  a placeholder or error page.
- PVC files were correctly owned (`node:node`) — the entrypoint's own chown
  step at boot handled this; the GCS FUSE `uid=1000`/`gid=1000`
  `mount_options` documented for `Homepage_CloudRun` and the default GKE
  layout are simply not in play in this mode, since no GCS volume is
  mounted when `stateful_pvc_enabled = true`.

The deploy also confirmed the project's external-IP quota constraint led to
`service_type = "ClusterIP"` and `reserve_static_ip = false` for this
specific deployment (see `config/deploy.tfvars`) rather than the module's
own `LoadBalancer`/`reserve_static_ip = true` defaults — a project-level
choice, not a module requirement. Access was verified via
`kubectl port-forward` rather than an external IP.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform.
Only settings specific to or notable for Homepage are listed; every other
input is inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `homepage` | Base name for resources. |
| `application_display_name` | `Homepage` | Human-readable name shown in the platform UI. |
| `application_version` | `latest` | Passed straight through as the `ghcr.io/gethomepage/homepage` image tag — no build step. |
| `homepage_allowed_hosts` | `*` | `HOMEPAGE_ALLOWED_HOSTS` — comma-separated `Host` header allowlist for Homepage's own `/api/*` calls. Not a real access-control boundary. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_port` | `3000` | Homepage's Next.js standalone server port. Fixed by `Homepage_Common`; not forwarded to `App_GKE`. |
| `container_image_source` | `prebuilt` | Deploys `ghcr.io/gethomepage/homepage` directly — no Cloud Build for the app. |
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Lightweight — Homepage is a single Next.js standalone server. |
| `min_instance_count` / `max_instance_count` | `1` / `3` | Multiple replicas are only safe in the default GCS FUSE storage mode — see §1 and §3. Keep `max_instance_count = 1` when `stateful_pvc_enabled = true`. |
| `enable_image_mirroring` | `true` | Mirrors the prebuilt image into Artifact Registry (avoids GHCR rate limits) — not a build. |
| `enable_cloudsql_volume` | `false` | Homepage has no Cloud SQL — keep `false`. |

### Group 6 — GKE Backend Configuration

| Variable | Default | Description |
|---|---|---|
| `workload_type` | `null` (resolves to `Deployment`) | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true`. |
| `service_type` | `LoadBalancer` | Homepage is a browser-facing dashboard; use `ClusterIP` for internal-only access or quota-constrained projects (this module's own live verification used `ClusterIP`). |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | `true` switches Homepage to a `StatefulSet` with a real block PVC at `/app/config` instead of the default GCS FUSE volume — the mode verified live for this module. |
| `stateful_pvc_size` | `5Gi` | Homepage's YAML config plus logs is tiny; sized to the platform floor. |
| `stateful_pvc_mount_path` | `/app/config` | Same path as the default GCS FUSE mount — the two are mutually exclusive, never double-mounted. |
| `stateful_fs_group` | `3000` | Pod-level `fsGroup` for the block PVC (upstream Helm chart default). |

### Group 11 — Workload Automation

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Stays empty by default — nothing to bootstrap. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `gcs_volumes` | `[]` | The `storage` bucket mount at `/app/config` is added automatically **only** when `stateful_pvc_enabled = false`; use this for *additional* volumes only. |

### Group 16 — Database

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed by `Homepage_Common` — Homepage has no SQL database, full stop. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/healthcheck` | Unauthenticated `200 "up"` — an accurate default matching the image's own `HEALTHCHECK` directive, forwarded unchanged from `Homepage_Common`. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` / `service_url` | Kubernetes Service name and the dashboard URL (port 3000). |
| `namespace` | Kubernetes namespace the workload runs in. |
| `service_cluster_ip` / `service_external_ip` | In-cluster ClusterIP / external LoadBalancer IP (when reserved). |
| `storage_buckets` | The `storage` bucket backing `/app/config` — populated only in the default, non-PVC storage mode. |
| `statefulset_name` | Name of the StatefulSet — populated only when `stateful_pvc_enabled = true`. |
| `container_image` / `container_registry` | The deployed image reference and Artifact Registry repository. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `initialization_jobs` | Created initialization job names (empty for Homepage). |
| `kubernetes_ready` | Whether the cluster/workload is ready. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` with `stateful_pvc_enabled = true` | Keep at `1` | High | Each StatefulSet pod ordinal gets its own separate PVC (not shared storage) — scaling beyond one replica in block-PVC mode gives each pod an independently diverging dashboard config, not a consistent shared one. |
| `stateful_pvc_mount_path` / `gcs_volumes` at `/app/config` | Leave the automatic mount in place, whichever mode you use | **Critical** | Removing or misconfiguring this volume loses every YAML config file on the next cold start or pod reschedule — Homepage has no other source of truth. |
| `HOMEPAGE_ALLOWED_HOSTS` | Leave `*` unless you know the final hostname, then tighten it | Medium | A too-narrow value 400s every API-backed widget (page shell still loads) if the actual request hostname doesn't match; treating it as a real auth boundary is a false sense of security either way. |
| Probe path | Leave at `/api/healthcheck` | High | An authenticated or nonexistent probe path would leave the pod permanently `Ready=False` even though the app booted fine. |
| `enable_redis` | Leave the hardcoded `false` alone (do not attempt to force it via `environment_variables`) | Low | Homepage has nothing to cache; enabling Redis wastes a Memorystore/NFS-Redis dependency for no benefit. |
| `workload_type = "Deployment"` with `stateful_pvc_enabled = true` | Leave `workload_type` unset (`null`) | Low | A plan-time validation guard rejects this combination outright — a PVC template requires a StatefulSet. |
| `service_type` | `LoadBalancer` unless quota-constrained | Medium | `ClusterIP` requires `kubectl port-forward` for access — fine for internal use or quota-limited projects (as used in this module's own live verification), but not reachable from a browser without it. |

---

For the foundation behaviour referenced throughout — Workload Identity,
autoscaling, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Homepage-specific application configuration
shared with the Cloud Run variant is described in
**[Homepage_Common](Homepage_Common.md)**.
