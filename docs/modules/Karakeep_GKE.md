---
title: "Karakeep on GKE Autopilot"
description: "Configuration reference for deploying Karakeep on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Karakeep on GKE Autopilot

Karakeep is an open-source, self-hostable bookmark-everything app (links, notes,
and images) with AI-based automatic tagging and full-text/semantic search. This
module deploys Karakeep on **GKE Autopilot** on top of the [App_GKE](App_GKE.md)
foundation, which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

This guide focuses on the cloud services Karakeep uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

Karakeep runs as a Next.js web workload, paired with a mandatory Meilisearch
sidecar Service for search. Unlike most apps in this catalogue it uses **no
external relational database** — all state lives in an embedded SQLite database
plus uploaded assets on the platform's shared NFS volume:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Next.js pod, 1 vCPU / 512 MiB by default, pinned to a single replica |
| Search | GKE Autopilot (internal Service) | A required Meilisearch sidecar, deployed automatically — not optional |
| Database | none | State lives in an embedded SQLite database, not Cloud SQL |
| Object storage | none (NFS instead) | Uploaded assets persist on the platform's shared NFS volume, not GCS |
| Secrets | Secret Manager | Auto-generated `NEXTAUTH_SECRET` and `MEILI_MASTER_KEY` |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **No Cloud SQL.** `database_type = "NONE"` — Karakeep's embedded SQLite
  database and uploaded assets both live on the platform's shared NFS volume.
- **Single replica only.** `max_instance_count = 1` — multiple pods writing the
  same SQLite file over NFS risks corruption even with WAL mode disabled.
- **`Recreate` deploy strategy applied automatically.** The Foundation detects
  NFS-backed apps and uses `Recreate` instead of `RollingUpdate`, avoiding the
  two-pods-briefly-running deadlock a rolling update would otherwise cause.
- **Meilisearch is mandatory, not optional.** Deployed automatically as an
  internal-only Kubernetes Service. Without it, Karakeep's `MEILI_ADDR` is unset
  and search is silently disabled.
- **No custom container build.** Karakeep's SQLite journal mode already defaults
  to the NFS-safe `DELETE` mode — the official prebuilt image is deployed as-is.
- **No admin-bootstrap credential.** The first account created through the web
  UI's sign-up form becomes the admin.
- **`NEXTAUTH_URL` uses native Kubernetes `$(VAR)` substitution** —
  `$(GKE_SERVICE_URL)` resolves to the Foundation's own injected value at
  container start (unlike Cloud Run, where `$(VAR)` is passed through literally).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set.

### A. GKE Autopilot — the Karakeep workload

- **Console:** Kubernetes Engine → Workloads → select the Karakeep workload.
  Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type are
managed.

### B. Meilisearch (required sidecar)

Deployed automatically as a separate, internal-only Kubernetes Service. Its URL
is auto-injected into the main app's `MEILI_ADDR`. Its index lives on the
sidecar's own ephemeral storage — additional services don't share the main
app's NFS volume — and rebuilds from scratch on every restart. This affects
search availability only, not data safety; bookmarks persist on the main app's
NFS-mounted `/data`.

- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE" -l app=meilisearch
  kubectl logs -n "$NAMESPACE" deploy/<service>-meilisearch --tail=50
  ```

### C. NFS (Cloud Filestore or the self-managed NFS+Redis VM)

Both Karakeep's embedded SQLite database and its uploaded assets live on the
platform's shared NFS volume, mounted at `/data`.

- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT" 2>/dev/null
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

### D. Secret Manager

Two secrets are generated automatically: `NEXTAUTH_SECRET` and
`MEILI_MASTER_KEY`.

- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~karakeep"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Networking & ingress

- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```

### F. Cloud Logging & Monitoring

- **CLI:**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Karakeep Application Behaviour

- **No first-deploy database setup Job.** Karakeep manages its own SQLite schema
  internally at startup.
- **No admin-bootstrap credential to retrieve.** The first account created
  through the web UI becomes the admin.
- **Search depends on the sidecar being reachable.** If the Meilisearch Service
  fails to start, search silently stops working; bookmarking continues.
- **Health path.** Startup and liveness probes target `/`.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Karakeep are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `karakeep` | Base name for resources. |
| `application_version` | `latest` | Maps to Karakeep's own rolling `"release"` tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | No custom build needed. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Single-replica pinned for SQLite-over-NFS safety. |
| `container_port` | `3000` | Karakeep's native default port. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Required — Karakeep's SQLite database and assets live here. |
| `nfs_mount_path` | `/data` | Karakeep's `DATA_DIR` default. |
| `stateful_pvc_enabled` | `false` | Not used — Karakeep uses NFS, not a block PVC. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — no Cloud SQL instance is provisioned. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Kubernetes namespace. |
| `service_external_ip` | External LoadBalancer IP. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Empty — not applicable. |
| `storage_buckets` | Empty — Karakeep persists via NFS. |
| `kubernetes_ready` | Whether the workload reached Ready state. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` (pinned default) | Critical | Raising this risks SQLite corruption from concurrent NFS writers. |
| First account created via sign-up | Create it immediately after deploy | Critical | The first account to register becomes admin. |
| `enable_nfs` | `true` (default) | Critical | Disabling it removes all durable storage. |
| `container_image_source` | `prebuilt` (default) | High | `"custom"` triggers an unnecessary Cloud Build with no Dockerfile in this module. |
| Meilisearch sidecar reachability | Verify `MEILI_ADDR` resolved after deploy | Medium | Search silently stops working if the sidecar fails to start. |
| `NEXTAUTH_SECRET` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates every active session. |
| `DATA_DIR` env var | Set explicitly (this module always sets it to `nfs_mount_path`) | Critical | Karakeep's own default is an **empty string**, not `/data` (that default only exists in the upstream docker-compose template). Left unset, migrations and the SQLite file silently resolve to ephemeral storage instead of the NFS mount. |
| `additional_services[].secret_env_vars` value format | Simple key name (e.g. `"MEILI_MASTER_KEY"`) | High | GKE's consolidated per-tenant K8s Secret stores keys named after the env var itself — **not** the raw Secret Manager `secret_id` string (that's the Cloud Run convention). Using the wrong format causes `CreateContainerConfigError: couldn't find key <secret_id> in Secret <prefix>-secrets`. |

---

For the foundation behaviour referenced throughout — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and
image mirroring — see **[App_GKE](App_GKE.md)**. Karakeep-specific application
configuration shared with the Cloud Run variant is described in
**[Karakeep_Common](Karakeep_Common.md)**.
