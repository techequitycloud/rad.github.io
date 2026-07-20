---
title: "Radicale on Google Cloud Run"
description: "Configuration reference for deploying Radicale on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Radicale on Google Cloud Run

Radicale is an open-source, self-hosted **CalDAV/CardDAV server** for
calendar and contacts sync — a lightweight, pure-Python WSGI application with
no framework and no database. It stores every calendar and address book as
plain iCalendar/vCard files on disk. This module deploys Radicale on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation,
which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Radicale uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress
and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Radicale runs as a single Python WSGI container on Cloud Run v2. The
deployment wires together a small, focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single Python process, 1 vCPU / 1 GiB by default, scale-to-zero |
| Database | none | Radicale stores every collection as plain files — no Cloud SQL instance is created |
| Object storage | Cloud Storage | A `storage` bucket is mounted at `/var/lib/radicale` via GCS FUSE — the single source of truth for all data |
| Cache & queue | none | Radicale has no Redis or queue dependency |
| Secrets | Secret Manager | A real generated `ADMIN_PASSWORD` — Radicale ships with no default admin account at all |
| Ingress | Cloud Run URL | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No database of any kind.** `Radicale_Common` fixes `database_type =
  "NONE"` — Radicale is a pure filesystem store.
- **Custom, thin-wrapper build.** `Radicale_Common` layers a cloud entrypoint
  onto the official `ghcr.io/kozea/radicale` image via Cloud Build, then
  mirrors the result into Artifact Registry.
- **No default admin account — a real generated secret.** Unlike apps that
  ship a well-known first-login credential, Radicale's auth defaults to
  `denyall` until configured. `Radicale_Common` generates and injects a real
  `ADMIN_PASSWORD` on every deployment (see the
  [Common guide](Radicale_Common.md)).
- **`max_instance_count` pinned to `1`, `min_instance_count` defaults to
  `0`.** Radicale's storage backend is not designed for concurrent
  multi-instance access, but has no database/index to warm at boot, so
  scale-to-zero is safe and fast.
- **MKCOL is blocked at the edge on Cloud Run — read §3 before you deploy.**
  Creating a *new* calendar/address book normally requires the WebDAV
  `MKCOL` method, which Google's Cloud Run frontend rejects before it ever
  reaches the container. A default seed job works around this — see below.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource
names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Radicale service

- **Console:** Cloud Run → select the service for revisions, traffic, logs,
  and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, and traffic
splitting.

### B. Cloud Storage — the single source of truth

The `storage` bucket is mounted at `/var/lib/radicale` via GCS FUSE. Every
calendar, address book, item, and the generated htpasswd/config files live
here — losing this bucket loses all Radicale state.

- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~radicale"
  gcloud storage ls "gs://<bucket-name>/collections/collection-root/"
  ```

### C. Secret Manager

- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~radicale"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### D. Networking & ingress

- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

### E. Cloud Logging & Monitoring

- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Radicale Application Behaviour

- **No first-deploy database setup.** There is no `db-init` job — Radicale
  has no database to bootstrap.
- **`seed-default-collections` runs at deploy time.** A one-shot
  initialization Job (`execute_on_apply = true`) writes a "Default Calendar"
  and "Default Address Book" directly onto the storage volume for the admin
  user, bypassing HTTP entirely. This exists because of a genuine platform
  limitation — see the callout below.
- **No default admin account.** Radicale's auth defaults to `denyall` until
  an htpasswd file exists. `Radicale_Common` generates a real
  `ADMIN_PASSWORD` and the cloud entrypoint writes both the INI config and a
  bcrypt htpasswd entry **on every boot** (not just first boot — there's no
  user table to check "already initialized" against).
- **Health path.** Startup and liveness probes target `/` — Radicale's
  unauthenticated `302` redirect to its web UI, treated as healthy by both
  probe types.
- **Inspect job execution:**
  ```bash
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

### ⚠ MKCOL is blocked by Cloud Run's frontend — the most important thing to know about this module

Creating a **new** collection (calendar or address book) via the standard
CalDAV/CardDAV protocol requires the WebDAV `MKCOL` HTTP method. Confirmed
live through extensive debugging across three separate deployment attempts:

- **Google's Cloud Run frontend (GFE) rejects `MKCOL` at the edge** with a
  generic "400 Bad Request" Google error page — the request never reaches
  the Radicale container. Every other method (GET, PUT, PROPFIND) passes
  through fine; this is specific to MKCOL.
- Cloud Run services have **no shell/exec access**, so there is no manual
  operator workaround after the fact either.
- Without a fix, a fresh `Radicale_CloudRun` deployment would be unable to
  create *any* calendar — not through a standard client (Apple Calendar,
  Thunderbird, DAVx5), and not even through Radicale's own web UI, which
  also issues MKCOL internally.

**The fix:** `Radicale_Common`'s default `seed-default-collections` init job
writes the collection directory structure directly onto the storage volume —
a plain container with filesystem access, no HTTP/GFE layer involved. This
runs automatically on every deploy (`execute_on_apply = true`) and seeds a
"Default Calendar" and "Default Address Book" for the admin user. Verified
live: a `PROPFIND` on the admin's principal correctly lists both collections,
and a real `VEVENT` can be `PUT` and `GET` successfully.

**If you need additional collections beyond the two seeded defaults**, you
cannot create them via a standard client on Cloud Run. Either supply a custom
`initialization_jobs` entry that writes them the same way, or use
`Radicale_GKE`, whose plain L4 LoadBalancer Service has no MKCOL restriction.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Radicale are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `radicale` | Base name for resources. |
| `application_display_name` | `Radicale` | Human-readable name shown in the platform UI and Cloud Run console. |
| `application_version` | `latest` | Resolves to the pinned build `RADICALE_VERSION=3.7.7` — GHCR tags have no `v` prefix. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_port` | `5232` | Radicale's native default port. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Scale-to-zero; `max` is pinned to `1` non-negotiably. |
| `enable_image_mirroring` | `true` | Mirrors the built image into Artifact Registry (avoids GHCR rate limits). |
| `container_protocol` | `http1` | Correct — Radicale serves plain HTTP/1.1. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | one `storage` bucket | Mounted at `/var/lib/radicale` via GCS FUSE — the single source of truth for all Radicale state. |
| `gcs_volumes` | `[]` | The `storage` bucket mount is added automatically; use this for *additional* volumes only. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed by `Radicale_Common` — Radicale has no database of any kind. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `seed-default-collections` (injected by `Radicale_Common`) | Works around the Cloud Run MKCOL restriction — see §3. Providing a custom list replaces this default entirely. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/` | Radicale's unauthenticated 302 redirect to its web UI; both probe types treat 2xx–3xx as healthy. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` / `radicale_url` | Cloud Run service name and internal/public URL (note: this output is named `radicale_url`, not `service_url`). |
| `storage_buckets` | The `storage` bucket backing `/var/lib/radicale`. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `initialization_jobs` | Created initialization job names (includes `seed-default-collections`). |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| Creating new collections via a CalDAV/CardDAV client | Rely on the seeded defaults, or use `Radicale_GKE` for arbitrary new collections | **High** | `MKCOL` is rejected at the Cloud Run edge (GFE) before reaching the container — no standard client, and not even Radicale's own web UI, can create a NEW collection on this platform. Only the two collections seeded at deploy time exist unless you supply a custom init job. |
| `max_instance_count` | Leave at `1` | **Critical** | Radicale's storage backend uses OS-level file locking and is not designed for concurrent multi-instance access; raising this risks data corruption. |
| Admin credential | Retrieve from Secret Manager after first deploy | **Critical** | Unlike apps with a well-known default login, Radicale generates a real secret — there is no way to log in until you retrieve `ADMIN_PASSWORD`. |
| `stateful_pvc_enabled` (n/a on Cloud Run) | Use `Radicale_GKE` for production | Medium | Cloud Run's GCS FUSE mount has weaker file-locking semantics than Radicale's storage backend expects; acceptable only because concurrency is capped at 1 instance. |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Radicale-specific application
configuration shared with the GKE variant is described in
**[Radicale_Common](Radicale_Common.md)**.
