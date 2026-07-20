---
title: "Karakeep on Google Cloud Run"
description: "Configuration reference for deploying Karakeep on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Karakeep on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Karakeep_CloudRun.png" alt="Karakeep on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Karakeep is an open-source, self-hostable bookmark-everything app (links, notes,
and images) with AI-based automatic tagging and full-text/semantic search. This
module deploys Karakeep on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Karakeep uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Karakeep runs as a Next.js container on Cloud Run v2, paired with a mandatory
Meilisearch sidecar for search. Unlike most apps in this catalogue it uses **no
external relational database** — all state lives in an embedded SQLite database
plus uploaded assets on the platform's shared NFS volume:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Next.js service, 1 vCPU / 512 MiB by default, scale-to-zero, pinned to a single instance |
| Search | Cloud Run v2 (internal service) | A required Meilisearch sidecar, deployed automatically — not optional |
| Database | none | State lives in an embedded SQLite database, not Cloud SQL |
| Object storage | none (NFS instead) | Uploaded assets persist on the platform's shared NFS volume, not GCS |
| Secrets | Secret Manager | Auto-generated `NEXTAUTH_SECRET` and `MEILI_MASTER_KEY` |
| Ingress | Cloud Run URL | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No Cloud SQL.** `database_type = "NONE"` — Karakeep's embedded SQLite
  database and uploaded assets both live on the platform's shared NFS volume
  (`enable_nfs = true` by default).
- **Single instance only.** `max_instance_count = 1` — multiple Cloud Run
  instances writing the same SQLite file over NFS risks corruption even with
  WAL mode disabled (which this module keeps off by default).
- **Meilisearch is mandatory, not optional.** Deployed automatically as an
  internal-only additional Cloud Run service. Without it, Karakeep's `MEILI_ADDR`
  is unset and search is silently disabled (bookmarking itself still works).
- **No custom container build.** Karakeep's SQLite journal mode already defaults
  to the NFS-safe `DELETE` mode — the official prebuilt image is deployed as-is.
- **No admin-bootstrap credential.** The first account created through the web
  UI's sign-up form becomes the admin.
- **`NEXTAUTH_SECRET` is immutable after first boot.** Rotating it invalidates
  every active session.
- **Request-based billing by default.** `cpu_always_allocated = false`,
  `min_instance_count = 0` — Karakeep's core save/search path needs no
  background CPU; async link-crawling/AI-tagging may pause while scaled to zero.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Karakeep service

Karakeep runs as a Cloud Run v2 service. Each deployment creates an immutable
revision.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Meilisearch (required sidecar)

Karakeep's full-text and semantic search is powered entirely by a Meilisearch
instance, deployed automatically as a separate, internal-only Cloud Run service.
Its URL is auto-injected into the main app's `MEILI_ADDR` environment variable.
Its index lives on the sidecar's own ephemeral storage — additional services
don't share the main app's NFS volume — and rebuilds from scratch on every
restart. This affects search availability only, not data safety; bookmarks
persist on the main app's NFS-mounted `/data`.

- **Console:** Cloud Run → the `<service>-meilisearch` service (internal ingress
  only — not reachable from a browser directly).
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" --filter="metadata.name~meilisearch"
  gcloud run services logs read <service>-meilisearch --project "$PROJECT" --region "$REGION" --limit=50
  ```

### C. NFS (Cloud Filestore or the self-managed NFS+Redis VM)

Both Karakeep's embedded SQLite database and its uploaded assets (bookmarked
page screenshots would go here too, though this module does not enable headless
Chrome screenshot capture) live on the platform's shared NFS volume, mounted at
`/data`.

- **Console:** Filestore → instances (if `Services_GCP` created a managed
  Filestore instance) — or Compute Engine → the self-managed NFS VM.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT" 2>/dev/null
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS discovery and mounting model.

### D. Secret Manager

Two secrets are generated automatically: `NEXTAUTH_SECRET` (session JWT signing)
and `MEILI_MASTER_KEY` (shared between the app and its Meilisearch sidecar).

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~karakeep"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Karakeep Application Behaviour

- **No first-deploy database setup job.** Karakeep manages its own SQLite schema
  and migrations internally at startup — there is no separate `db-init` job to
  inspect.
- **No admin-bootstrap credential to retrieve.** The first account created
  through the web UI's sign-up form becomes the admin. There is nothing in
  Secret Manager to fetch before first login.
- **Search depends on the sidecar being reachable.** If the Meilisearch service
  fails to start, search silently stops working — bookmarking, tagging, and
  browsing all continue to function, but nothing is findable via search.
- **Health path.** Startup and liveness probes target `/` — Karakeep's public
  login/landing page.
- **Async work (link crawling, AI tagging) runs in-process.** With
  `cpu_always_allocated = false` (the default), this work may pause while the
  instance is scaled to zero between requests and resume on the next request.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Karakeep are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `karakeep` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Deployment-tracking tag. `Karakeep_Common` maps `"latest"` to Karakeep's own rolling `"release"` tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | No custom build needed — Karakeep's default SQLite journal mode is already NFS-safe. |
| `min_instance_count` | `0` | Scale-to-zero. |
| `max_instance_count` | `1` | **Pinned** — SQLite-over-NFS multi-writer safety. Do not raise. |
| `container_port` | `3000` | Karakeep's native default port. |
| `cpu_always_allocated` | `false` | Request-based billing. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Required — Karakeep's SQLite database and assets live here. |
| `nfs_mount_path` | `/data` | Karakeep's `DATA_DIR` default. |
| `storage_buckets` | `[]` | No GCS bucket provisioned — Karakeep uses NFS, not object storage. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — no Cloud SQL instance is provisioned. |

### Group 13 — Jobs & Sidecars

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Not used — Karakeep migrates its own schema at startup. |
| `additional_services` | `[]` | User-configurable *extra* services beyond Karakeep's own — the required Meilisearch sidecar is deployed automatically and is not represented here. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/` 30s delay | Probes target the public login page. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Empty — not applicable (`database_type = "NONE"`). |
| `storage_buckets` | Empty — Karakeep persists via NFS, not GCS. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` (pinned default) | Critical | Raising this risks SQLite corruption from concurrent NFS writers — Karakeep has no other database backend to fall back to. |
| First account created via sign-up | Create it immediately after deploy | Critical | The first account to register becomes admin — if left open, any visitor who reaches the URL first claims that role. |
| `enable_nfs` | `true` (default) | Critical | Disabling it removes all durable storage — the SQLite database and assets would live on Cloud Run's ephemeral filesystem and vanish on every revision restart. |
| `container_image_source` | `prebuilt` (default) | High | `"custom"` triggers an unnecessary Cloud Build with no Dockerfile configured in this module — the build will fail. |
| Meilisearch sidecar reachability | Verify `MEILI_ADDR` resolved after deploy | Medium | If the sidecar fails to start, search silently stops working while the rest of the app continues functioning normally — an easy-to-miss degraded state. |
| `NEXTAUTH_SECRET` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates every active user session. |
| `DATA_DIR` env var | Set explicitly (this module always sets it to `nfs_mount_path`) | Critical | Karakeep's own default is an **empty string**, not `/data` (that default only exists in the upstream docker-compose template). Left unset, migrations and the SQLite file silently resolve to ephemeral storage instead of the NFS mount — confirmed live: signup 500s with `SqliteError: no such table: user` until fixed. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Karakeep-specific application configuration
shared with the GKE variant is described in
**[Karakeep_Common](Karakeep_Common.md)**.
