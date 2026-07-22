---
title: "Trilium on Google Cloud Run"
description: "Configuration reference for deploying Trilium on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Trilium on Google Cloud Run

Trilium Notes (the actively maintained **TriliumNext** fork — not the archived
`zadam/trilium`) is an open-source, hierarchical, self-hosted note-taking
application with an embedded SQLite database. This module deploys Trilium on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Trilium uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Trilium runs as a single Node.js/Express container on Cloud Run v2. The deployment
wires together a deliberately small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 1 vCPU / 1 GiB by default, serverless autoscaling — but see scaling notes below |
| Database | None (embedded SQLite) | Trilium's entire document store is a single SQLite file, `document.db`, on the persistent volume |
| Object storage | Cloud Storage | A dedicated data bucket, mounted via GCS FUSE at `/home/node/trilium-data` |
| Secrets | Secret Manager | None generated — Trilium has no env-var-driven credential |
| Ingress | Cloud Run URL | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No database engine to manage.** `database_type = "NONE"` — there is no Cloud SQL
  instance, no connection string, and nothing to back up separately from the data bucket.
- **Single-instance only.** `min_instance_count = max_instance_count = 1`. Trilium's
  embedded SQLite database has no multi-writer support — running more than one
  instance risks database corruption from concurrent writes.
- **No seeded credential.** Unlike apps with a Secret Manager-backed password,
  Trilium has **no** env-var-driven auth bootstrap. On first visit, the app itself
  presents a "Set Password" screen; complete it before sharing the URL.
- **Health probe is `/api/health-check`, not `/`.** The root path (`/`) returns a
  302 redirect to the setup/login screen. Only `/api/health-check` returns an
  unauthenticated `200 {"status":"ok"}` — confirmed live via local container testing.
- **The data directory is everything.** `/home/node/trilium-data` holds the SQLite
  database, all attachments, revision history, and settings. Losing this volume
  loses everything; it is persisted via a GCS FUSE-mounted bucket by default.
- **`mount_options` set `uid=1000,gid=1000`.** Trilium's container runs as the
  `node` user (confirmed via `docker run ... id node`); without matching mount
  options, GCS FUSE mounts the directory root-owned and the app fails to boot.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Trilium service

Trilium runs as a single Cloud Run v2 service. Because it must stay at exactly one
instance, there is no meaningful autoscaling to observe — the interesting signal is
revision health and cold-start behaviour.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud Storage — the Trilium data directory

The entire application state (SQLite `document.db`, attachments, revision history,
settings) lives in a dedicated Cloud Storage bucket, mounted via GCS FUSE at
`/home/node/trilium-data`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse mount options and CMEK.

### C. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

See [App_CloudRun](App_CloudRun.md).

### D. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Trilium Application Behaviour

- **No first-deploy database setup job.** Trilium creates and migrates its own
  SQLite schema on first web visit, via its own setup wizard — there is no
  Terraform-managed `db-init` job to inspect.
- **First-run "Set Password" screen.** Navigating to the root URL for the first
  time presents a password-setup form (no default admin/username — Trilium is a
  single-user app). There is no pre-seeded credential in Secret Manager to look up.
- **Health path.** Startup and liveness probes target `/api/health-check`, which
  returns `200 {"status":"ok"}` once the HTTP server is listening — regardless of
  whether the SQLite database has been initialized yet (that only happens after the
  operator completes the Set Password step).
- **Single-writer constraint.** Never raise `max_instance_count` above `1` — the
  embedded SQLite database is not safe for concurrent writers from multiple
  instances.
- **Inspect the running revision:**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Trilium are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `trilium` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Trilium Notes` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Docker image version tag; mapped to a pinned build ARG (`TRILIUM_VERSION`) internally, not passed through as `latest` to the Dockerfile. |
| `enable_password` | `false` | Reserved for parity with other single-user editor modules. **No effect** — Trilium has no env-var-driven password bootstrap. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `1Gi` | Memory per instance; Trilium is lightweight, raise only for very large note collections. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | **Keep both at 1** — no multi-writer support on the embedded SQLite database. |
| `container_port` | `8080` | Trilium's default HTTP port. |
| `execution_environment` | `gen2` | Gen2 required for GCS Fuse mounts. |
| `enable_image_mirroring` | `true` | Mirror the Trilium image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public by default; restrict to `internal` for a private deployment. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of Trilium. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the Trilium data bucket. |
| `gcs_volumes` | `[]` | Additional GCS Fuse volumes beyond the auto-mounted data bucket. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Not referenced — Trilium has no SQL database (embedded SQLite only). |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health-check`, 15s delay | Startup probe. |
| `liveness_probe` | HTTP `/api/health-check`, 30s delay | Liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check on `/api/health-check`. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `trilium_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | Raising it risks concurrent writers corrupting the embedded SQLite database — there is no query-layer protection against this. |
| Data bucket / `gcs_volumes` mount_options | `uid=1000,gid=1000` | Critical | Wrong uid/gid mounts the data directory root-owned; the non-root Trilium process fails to boot with a permission error. |
| First-visit "Set Password" step | Complete immediately | Critical | An un-set-password Trilium instance left on a public URL is reachable by anyone until the password is set. |
| `startup_probe` / `liveness_probe` path | `/api/health-check` | High | Pointing probes at `/` gets a 302 redirect, which most HTTP health checks treat as a failure, blocking the revision from ever becoming Ready. |
| `ingress_settings` | `internal` for private use | Medium | `all` (default) makes the (initially unauthenticated, pre-Set-Password) instance reachable from the public internet. |
| `memory_limit` | `1Gi` | Low | Trilium is lightweight; only raise for very large note/attachment collections. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Trilium-specific application configuration
shared with the GKE variant is described in **[Trilium_Common](Trilium_Common.md)**.
