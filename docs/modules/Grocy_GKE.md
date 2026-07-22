---
title: "Grocy on GKE Autopilot"
description: "Configuration reference for deploying Grocy on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Grocy on GKE Autopilot

[Grocy](https://grocy.info/) is a self-hosted grocery and household ERP:
inventory tracking with barcode scanning, chore/task management, shopping lists,
and meal planning. It is distinct from this catalogue's `Mealie` module, which
covers recipe/meal-planning only — Grocy is the broader household-ERP tool. This
module deploys Grocy on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure; `Grocy_GKE` is a thin wrapper that supplies
Grocy's own configuration (image, port, probes, storage wiring) and forwards
everything else straight through.

This guide focuses on the cloud services Grocy uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common
to every GKE application — Workload Identity, ingress and load balancing,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Grocy runs as an nginx + php-fpm container (the upstream LinuxServer.io `grocy`
image, unmodified) on GKE Autopilot as a **StatefulSet**. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot (StatefulSet) | 1 vCPU / 1 GiB by default, `min=max=1` (no autoscaling — single-writer SQLite) |
| Database | None | Grocy uses an embedded SQLite database — no Cloud SQL instance is created |
| Persistent state | **Block-storage PVC** (`standard-rwo`, 20Gi) | `/config` (SQLite database, config, uploads, backups) is mounted on a real block device, per-pod via `volumeClaimTemplates` — see §4 |
| Object storage | Cloud Storage | A `storage` bucket is provisioned but unused when the PVC is enabled (the default) |
| Cache | None | `enable_redis` is hardcoded `false` in `main.tf` — Grocy has no cache dependency |
| Secrets | Secret Manager | None generated for Grocy — no injectable admin credential exists |
| Ingress | Kubernetes Service | `LoadBalancer` by module default; this deployment uses `ClusterIP` (see §5) |

**Sensible defaults worth knowing up front:**

- **SQLite is the only database Grocy supports.** Confirmed by reading Grocy's own
  upstream source (`services/DatabaseService.php`) — there is no MySQL/Postgres
  driver branching at all. `database_type` is fixed to `NONE`.
- **A real block PVC, not NFS or GCS FUSE — by design, not as a bug fix.**
  `stateful_pvc_enabled = true` is the module default, auto-resolving
  `workload_type` to `"StatefulSet"`. `Grocy_Common` sets
  `enable_gcs_storage_volume = !stateful_pvc_enabled`, so the GCS-FUSE volume is
  skipped entirely whenever the PVC is used (the default state). See §4 for why
  this matters and how it compares to the Cloud Run variant.
- **Single instance only.** `min_instance_count = 1`, `max_instance_count = 1`.
  Grocy's SQLite database is single-writer with no clustering support — and
  because the StatefulSet uses `volumeClaimTemplates`, raising the replica count
  would give each pod its own unsynchronised PVC rather than sharing `/config`.
- **No injectable admin credential.** The upstream image ships default `admin` /
  `admin` credentials, changed via the web UI on first login. No Secret Manager
  secret is created for Grocy.
- **Health probes hit `/`, not `/health`.** Grocy has no dedicated health
  endpoint; the login page (`200`, unauthenticated) is used for both startup and
  liveness probes.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. Service and resource names
are reported in the deployment [Outputs](#6-outputs).

### A. GKE Autopilot — the Grocy StatefulSet

Grocy runs as a single-replica **StatefulSet** (not a Deployment) so its
`volumeClaimTemplates` can bind a stable, per-pod block PVC.

- **Console:** Kubernetes Engine → Workloads → select the StatefulSet.
- **CLI:**
  ```bash
  kubectl get statefulset -n "$NAMESPACE"
  kubectl get pods -n "$NAMESPACE" -o wide
  kubectl describe statefulset <name> -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for StatefulSet vs. Deployment mechanics, rollout
strategy, and Autopilot resource requests/limits.

### B. The `/config` block-storage PVC

All of Grocy's state — the embedded SQLite database (`grocy.db`), `config.php`,
uploaded images/attachments, and backups — lives under `/config`, mounted on a
real `standard-rwo` (Balanced PD) block volume via the StatefulSet's
`volumeClaimTemplates`. This is the load-bearing storage decision for this module
(see §4); losing or misconfiguring this PVC loses all Grocy data.

- **Console:** Kubernetes Engine → Storage → Persistent Volume Claims.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc <pvc-name> -n "$NAMESPACE"
  ```

### C. Cloud Storage

A dedicated **Cloud Storage** `storage` bucket is provisioned automatically, but
by default it is **not** used to back `/config` — that mount goes through the
block PVC instead (see §4). It remains available for any custom `gcs_volumes` an
operator adds.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~grocy"
  ```

### D. Networking & ingress

The module default is a `LoadBalancer` Service with an optional custom domain via
Gateway API. This deployment's `config/deploy.tfvars` overrides this to
`service_type = "ClusterIP"` with `reserve_static_ip = false` (a per-project
static-IP quota constraint) — access it via `kubectl port-forward` or from inside
the cluster.

- **Console:** Kubernetes Engine → Gateways, Services & Ingress.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 8080:80
  ```

See [App_GKE](App_GKE.md) for Gateway API, static IPs, and custom domains.

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Kubernetes metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  kubectl logs -n "$NAMESPACE" <pod-name> --tail=100
  ```

---

## 3. Grocy Application Behaviour

- **No first-deploy database setup.** Grocy has no external database and no
  `db-init` job — it creates and migrates its own embedded SQLite schema under
  `/config` on first boot.
- **`/config` durability depends on the PVC, not a managed database.** Because
  Grocy's entire state (database, config, uploads, backups) lives in files on
  `/config`, the correctness of the block PVC *is* the correctness of the
  deployment. Confirm the PVC is bound and writable before trusting any data
  written to it.
- **No admin credential is generated or injectable.** The upstream image ships
  default `admin` / `admin` credentials. Log in with those on first access and
  change the password immediately via Users → admin → Edit in the Grocy UI —
  there is no environment variable or Secret Manager value that sets this for
  you.
- **Health path.** Both the startup and liveness probes issue HTTP `GET /`, which
  returns Grocy's login page (`200`) with no authentication required. This is not
  a dedicated health endpoint — Grocy has none — but it reliably indicates the
  nginx + php-fpm stack is serving.
- **Single-writer constraint is architectural, not a scaling knob.** Because
  Grocy's SQLite database has no MySQL/Postgres equivalent and no clustering
  support, `max_instance_count` must stay at `1`. There is no configuration that
  safely enables horizontal scaling for this module.
- **Verified live.** Pod `grocygkee6a1e84d-0` reported `1/1 Running`, **0
  restarts**. Boot logs show a clean s6-overlay/LinuxServer startup — migrations
  succeeded, self-signed TLS keys generated under `/config/keys` with no
  permission errors, `[ls.io-init] done.`. `kubectl exec ... curl` against
  `GET /` returned `302` → `Location: /stockoverview` → followed to `GET /login`
  → `200`, body containing `<title>Login | Grocy</title>` (10,102 bytes) —
  matching the Cloud-Run-verified login page exactly.

---

## 4. Why This Module Uses a Block PVC — a Clean-Slate Design, Not a Bug Fix

This module's persistent-storage wiring is worth understanding by contrast with
its sibling, `Grocy_CloudRun`.

On Cloud Run, Grocy originally mounted `/config` on a GCS-FUSE-backed bucket —
this catalogue's usual pattern for persistent app config — and it crash-looped in
production. Grocy writes to `data/grocy.db-journal` on every database transaction
(roughly every 1–2 seconds under light use), and GCS FUSE's object-storage
translation layer, built around eventual-consistency whole-object semantics,
could not sustain that write frequency. The Cloud Run fix was to switch `/config`
to a Cloud Filestore (NFS) mount instead — see the
[Grocy_CloudRun guide, §4](Grocy_CloudRun.md#4-why-config-uses-nfs-instead-of-gcs-fuse--the-real-story)
for the full story.

`Grocy_GKE` never had that problem to fix, because it was designed with a
different storage primitive from the start: `stateful_pvc_enabled = true` is the
module's own default, which runs Grocy as a StatefulSet with a genuine **block
device** (`standard-rwo`, a Balanced Persistent Disk) mounted per-pod at
`/config`. A block PVC is not a network filesystem and not an object-storage
translation layer — from the container's point of view it behaves exactly like a
local disk, with real POSIX semantics (rename, fsync, byte-range locks) and no
FUSE layer sitting between the SQLite engine and the bytes on disk. There is
nothing here for a high write-frequency journal file to overwhelm.

`Grocy_Common` encodes this relationship directly:
`enable_gcs_storage_volume = !stateful_pvc_enabled` — so whenever the PVC is
enabled (the default), the GCS-FUSE volume that caused the Cloud Run bug is never
even wired in. This also means the **separate** GKE-specific gcsfuse UID/GID
mount-permission bug hit elsewhere in this catalogue (confirmed on modules like
PeerTube_GKE, where a non-root container can't write to a gcsfuse mount without
explicit `uid`/`gid` mount options) simply doesn't apply here either — there is no
gcsfuse mount to misconfigure.

`stateful_fs_group = 1000` matches the LinuxServer.io image's real PUID/PGID
(1000/1000), so the block PVC comes up group-writable for the container's actual
process — confirmed live: the pod's boot log shows self-signed TLS keys generated
under `/config/keys` with zero permission errors.

**The result: this module was deployed and verified with zero bugs found or
fixed.** Where `Grocy_CloudRun`'s story is "the wrong storage primitive broke
SQLite, and here's the fix," `Grocy_GKE`'s story is simpler — the right storage
primitive for a single-writer SQLite workload was chosen from the start, and nothing
broke.

---

## 5. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Grocy are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `grocy` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Grocy` | Human-readable name shown in the Console. |
| `application_version` | `latest` | LinuxServer image tag. `"latest"` resolves to the pinned `v4.6.0-ls333` (the `GROCY_VERSION` build ARG, not the generic `APP_VERSION`). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Grocy is lightweight; the memory default gives headroom for image/attachment uploads. |
| `min_instance_count` | `1` | Keeps the pod warm — avoids cold starts. |
| `max_instance_count` | `1` | **Must stay at `1`.** Grocy's SQLite database is single-writer with no clustering support, and a StatefulSet's `volumeClaimTemplates` gives each additional replica its own unsynchronised PVC. |
| `container_port` | `80` | Grocy's default HTTP port. |
| `enable_cloudsql_volume` | `false` | Grocy has no Cloud SQL — keep `false`. |

### Group 6 — GKE Backend Configuration

| Variable | Default | Description |
|---|---|---|
| `workload_type` | `null` | Auto-resolves to `"StatefulSet"` because `stateful_pvc_enabled = true` by default. |
| `service_type` | `LoadBalancer` | Module default for a browser-facing app. This deployment overrides to `ClusterIP` via `config/deploy.tfvars` (per-project static-IP quota constraint). |

### Group 7 — StatefulSet Configuration

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **The core design decision for this module** — see §4. A real block-storage PVC, not a network filesystem or GCS FUSE. |
| `stateful_pvc_size` | `20Gi` | Sized to hold the SQLite database, images/attachments, and backups under `/config`. |
| `stateful_pvc_mount_path` | `/config` | Grocy keeps all state (database, config, uploads, backups) here. Do not change unless the upstream image's data path changes. |
| `stateful_pvc_storage_class` | `standard-rwo` | Balanced Persistent Disk — a genuine block device, no FUSE translation layer. |
| `stateful_fs_group` | `1000` | Matches Grocy's real PUID/PGID (1000/1000) — confirmed live via successful TLS-key generation under `/config/keys`. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | **Not used on GKE**, unlike `Grocy_CloudRun` which relies on NFS. The block PVC replaces that role here. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` (variable default) | **Overridden unconditionally to `false` in `main.tf`** regardless of this variable's value — Grocy has no cache dependency. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — Grocy has no SQL database of any kind. |

### Group 11 — Workload Automation

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No default init job — Grocy bootstraps its own SQLite schema on first boot. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 15s delay, 10 retries | Grocy's login page — no dedicated health endpoint exists. |
| `liveness_probe` | HTTP `/`, 30s delay, 3 retries | Same endpoint as the startup probe. |

All other inputs are inherited from [App_GKE](App_GKE.md) with standard
behaviour.

---

## 6. Outputs

| Output | Description |
|---|---|
| `service_name` / `namespace` / `service_cluster_ip` | Kubernetes Service identity. |
| `service_external_ip` / `service_url` | External address (if `LoadBalancer` and a static IP are in use). |
| `statefulset_name` | Name of the StatefulSet running Grocy. |
| `storage_buckets` | Created Cloud Storage buckets (the `storage` bucket, unused for `/config` when the PVC is enabled). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `initialization_jobs` | Created initialization job names (empty by default). |
| `kubernetes_ready` | Whether the cluster endpoint is available and all Kubernetes resources are deployed. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 7. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_GKE](App_GKE.md) foundation engine, which validates values
> *and combinations* at plan time. Most out-of-range or contradictory inputs are
> caught before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critical | Disabling it without a matching `gcs_volumes` mount reverts `/config` to GCS FUSE, reproducing the write-frequency corruption risk confirmed on `Grocy_CloudRun` — a network/object-storage translation layer cannot sustain Grocy's `grocy.db-journal` write pattern. |
| `stateful_pvc_mount_path` | `/config` | Critical | Grocy hardcodes its data path to `/config`. Changing the mount path without a matching image change loses access to the database, config, and uploads. |
| `max_instance_count` | `1` | Critical | Grocy's SQLite database is single-writer with no clustering support. Because the StatefulSet uses `volumeClaimTemplates`, any value above `1` doesn't even share storage across replicas — each pod gets its own disconnected copy of the data. |
| `stateful_fs_group` | `1000` | High | Grocy runs as UID 1000 / GID 1000 (LinuxServer PUID/PGID). A mismatched `fsGroup` leaves the PVC unwritable by the container's actual process, producing permission errors on first boot. |
| `enable_redis` | Any value — ignored | Low | `main.tf` hardcodes `enable_redis = false` regardless of this variable, so setting it `true` has no effect. Not a risk, just a no-op worth knowing about. |
| `database_type` | `NONE` | Medium | Grocy ignores this entirely (no code path reads it), but setting anything else provisions an unused, billed Cloud SQL instance. |
| Admin password | Change on first login | High | The upstream image's default `admin` / `admin` credentials are publicly documented; leaving them unchanged on a `LoadBalancer`-exposed deployment is a real exposure. |
| `min_instance_count` | `1` | Low | Setting `0` saves cost but reintroduces cold starts on Grocy's nginx + php-fpm stack. |

---

For the foundation behaviour referenced throughout — Workload Identity, ingress
and load balancing, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Grocy-specific application configuration shared with the Cloud Run variant is
described in **[Grocy_Common](Grocy_Common.md)**. For the storage-corruption bug
this module avoided by design, see **[Grocy_CloudRun](Grocy_CloudRun.md)**.
