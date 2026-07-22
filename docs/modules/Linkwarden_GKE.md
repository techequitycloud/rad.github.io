---
title: "Linkwarden on GKE Autopilot"
description: "Configuration reference for deploying Linkwarden on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Linkwarden on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Linkwarden_GKE.png" alt="Linkwarden on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Linkwarden is an open-source, self-hosted bookmark manager that goes beyond
simple link-saving: every bookmark can be automatically archived as a full-page
screenshot, PDF, and single-file "monolith" snapshot using a bundled headless
Chrome, so your links keep working even after the source page changes or
disappears. This module deploys Linkwarden on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Linkwarden uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Linkwarden runs as a single Next.js pod. The web server and a background
archiving worker run side by side in the SAME container (via `concurrently`) —
there is no separate worker Deployment. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Next.js + headless Chrome pod, 2 vCPU / 2 GiB by default, `min_instance_count = 1` |
| Database | Cloud SQL for PostgreSQL 15 | Required — Linkwarden's Prisma schema is Postgres-only |
| Object storage | Cloud Storage (GCS Fuse CSI volume) | Mounted at `/data/data` by default for archived screenshots/PDFs/monoliths |
| Cache & queue | None | The archiving worker polls PostgreSQL directly; no Redis/BullMQ dependency |
| Secrets | Secret Manager | Auto-generated `NEXTAUTH_SECRET`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate, `reserve_static_ip = true` |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** Linkwarden's Prisma schema hardcodes the
  `postgresql` provider; selecting any other engine breaks the first-boot
  migration.
- **`DATABASE_URL` connects over the cloud-sql-proxy loopback.**
  `enable_cloudsql_volume = true` is required — it launches the proxy sidecar
  that answers on `127.0.0.1`, which the cloud entrypoint uses with
  `sslmode=disable` (the proxy already terminates TLS). This differs from the
  Cloud Run variant, which connects over the raw private IP with
  `sslmode=require`.
- **`NEXTAUTH_URL` is derived automatically**, appending the required
  `/api/v1/auth` suffix to the computed service URL.
- **`reserve_static_ip = true` by default.** Linkwarden's `NEXTAUTH_URL` bakes
  in the service URL at container boot, so a stable external IP avoids the
  internal-DNS-fallback race documented for other self-referencing-URL apps
  in this catalogue.
- **Minimum 1 replica is maintained** (GKE does not support scale-to-zero) so
  the in-container background archiving worker keeps processing the queue.
- **Headless Chrome runs in-process with the web server.** Size
  `container_resources` for the whole container's peak (2 vCPU / 2Gi default;
  bump memory to 4Gi for heavy archiving loads).
- **A GCS volume is mounted automatically at `/data/data`.** This is the
  absolute path Linkwarden's storage code resolves `STORAGE_FOLDER` to. The
  image's whole container runs as root, so no gcsfuse uid/gid mount-option
  override is needed (unlike some other GKE modules in this catalogue).
- **No seeded superuser.** The first user to register through the standard
  NextAuth registration flow becomes the instance owner.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Linkwarden workload

Linkwarden pods are scheduled on Autopilot, which bills for the CPU/memory the
pods actually request.

- **Console:** Kubernetes Engine → Workloads → select the Linkwarden workload
  to see pods, revisions, and events. Kubernetes Engine → Services & Ingress
  shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
lifecycle work.

### B. Cloud SQL for PostgreSQL 15

Linkwarden stores all application data (bookmarks, collections, tags, users,
archive metadata) in a managed Cloud SQL for PostgreSQL 15 instance. The
cloud-sql-proxy sidecar (enabled via `enable_cloudsql_volume = true`) listens
on `127.0.0.1`; the cloud entrypoint connects `DATABASE_URL` there with
`sslmode=disable`. On first deploy an initialization Job creates the
application database and user; Linkwarden then runs its own
`prisma migrate deploy` on every container start.

- **Console:** SQL → select the instance for connections, backups, flags,
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the connection model,
backups, and password rotation.

### C. Cloud Storage (archived content)

A dedicated **Cloud Storage** bucket is provisioned automatically and mounted
via the GCS Fuse CSI driver at `/data/data` by default — the absolute path
Linkwarden's storage code resolves `STORAGE_FOLDER` to at runtime.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for GCS Fuse CSI driver options.

### D. Secret Manager

One secret is generated automatically and stored in Secret Manager:
`NEXTAUTH_SECRET` (signs NextAuth session JWTs). It is materialised into the
namespace and injected as a pod env var. The database password is managed
separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for injection and rotation details.

### E. Networking & ingress

The service is exposed via a `LoadBalancer` Kubernetes Service with a reserved
static IP by default (`reserve_static_ip = true`). An Ingress with a custom
domain and managed certificate, Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Kubernetes Engine → Services & Ingress; Network services → Load
  balancing.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Linkwarden Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh`
  using `postgres:15-alpine`. It connects through the cloud-sql-proxy sidecar
  and idempotently creates the application database and user and grants
  privileges. The job is safe to re-run.
- **Schema migrations run on every boot.** Linkwarden's base image `CMD` runs
  `prisma migrate deploy` before starting the web and worker processes, so
  upgrading the application version applies schema changes automatically.
- **`NEXTAUTH_SECRET` is immutable after first boot.** Generated once and
  written to Secret Manager. Rotating it invalidates every active session.
- **No pre-seeded admin account.** The first user to register through the
  standard NextAuth registration flow becomes the instance owner.
- **Background archiving worker.** A separate process (`worker.ts`, run via
  `concurrently` alongside the web server in the same container) polls
  PostgreSQL directly and processes queued links in batches
  (`ARCHIVE_TAKE_COUNT`, default `5`). Each batch launches headless Chrome
  instances for screenshot/PDF/monolith capture.
- **Health path.** Startup and liveness probes default to `/` — Linkwarden has
  no confirmed dedicated health endpoint. The startup probe allows a generous
  window for Next.js cold start plus headless Chrome/Playwright
  initialization.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Linkwarden are listed; every other input
is inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 1 / 2 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for regional resources. |
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `linkwarden` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Linkwarden` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Linkwarden publishes a genuine `latest` tag upstream. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_resources` | `{ cpu_limit="2000m", memory_limit="2Gi" }` | Headless Chrome archiving runs in-process; bump memory to `4Gi` for heavy workloads. |
| `min_instance_count` | `1` | GKE has no scale-to-zero; keeps the archiving worker alive. |
| `max_instance_count` | `5` | HPA upper bound. |
| `container_port` | `3000` | Linkwarden (Next.js) listens on port 3000. |
| `enable_cloudsql_volume` | `true` | Required — launches the cloud-sql-proxy sidecar the entrypoint connects to. |
| `enable_image_mirroring` | `true` | Mirror the Linkwarden image into Artifact Registry. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Static env vars. `DATABASE_URL`, `NEXTAUTH_URL` are set automatically — do not set them here. |
| `disable_browser` | `false` | Sets `DISABLE_BROWSER` — skips all headless-Chrome archiving tasks. |
| `archive_take_count` | `5` | Links processed per background-worker batch (`ARCHIVE_TAKE_COUNT`). |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Public-facing web UI needs external exposure. |
| `session_affinity` | `ClientIP` | Sticky routing for NextAuth session cookies. |
| `namespace_name` | `""` | Leave empty to auto-generate. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Off by default — Linkwarden uses a GCS volume instead for simplicity. |
| `nfs_mount_path` | `/data/data` | Only used when `enable_nfs = true`. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `gcs_volumes` | `[]` (falls back to a built-in default) | A default "storage" volume mounted at `/data/data` is wired automatically unless you supply your own list, which fully replaces it. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Linkwarden's Prisma schema is Postgres-only. |
| `application_database_name` | `linkwarden` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `linkwarden` | Application database user. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Linkwarden's `NEXTAUTH_URL` bakes in the service URL at boot — a stable IP avoids an internal-DNS fallback race. |
| `enable_custom_domain` | `true` | Provision Ingress + managed certificate for custom hostnames. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not used by Linkwarden — its archiving worker polls PostgreSQL directly. Kept for Foundation-variable parity. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore
the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` / `service_external_ip` | In-cluster / external IP. |
| `service_url` | URL to reach Linkwarden. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `initialization_jobs` | Names of the setup jobs. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time. Most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `NEXTAUTH_SECRET` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates every active session, forcing all users to log in again. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `database_type` | `POSTGRES_15` (fixed) | Critical | Any other engine breaks the first-boot Prisma migration entirely. |
| `enable_cloudsql_volume` | `true` (required) | Critical | Disabling it removes the cloud-sql-proxy sidecar the entrypoint depends on — `DATABASE_URL` connects to nothing. |
| `min_instance_count` | `1` | High | Scaling to 0 (not supported by default on GKE) would stop the background archiving worker. |
| `container_resources.memory_limit` | `2Gi` minimum | High | Headless Chrome archiving OOMs below this floor; the web server may still respond while archiving silently fails. |
| `service_type` | `LoadBalancer` | High | Setting `ClusterIP` on a public-facing bookmark UI makes it unreachable from a browser (a known copy-paste bug pattern elsewhere in this catalogue). |
| `reserve_static_ip` | `true` | Medium | `false` risks Linkwarden's baked-in `NEXTAUTH_URL` resolving to unreachable internal DNS if the ephemeral IP isn't known at apply time. |
| `disable_browser` | `false` unless Chrome misbehaves | Medium | Leaving it `true` unnecessarily disables all screenshot/PDF/monolith archiving. |
| `gcs_volumes` | Use the built-in default | Medium | Supplying a custom list without matching the `/data/data` mount path leaves archived content unwritable or split across storage backends. |

---

For the foundation behaviour referenced throughout — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Linkwarden-specific application configuration shared with the Cloud Run
variant is described in **[Linkwarden_Common](Linkwarden_Common.md)**.
