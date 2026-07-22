---
title: "Grocy on Google Cloud Run"
description: "Configuration reference for deploying Grocy on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Grocy on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Grocy_CloudRun.png" alt="Grocy on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

[Grocy](https://grocy.info/) is a self-hosted grocery and household ERP: inventory
tracking with barcode scanning, chore/task management, shopping lists, and meal
planning. It is distinct from this catalogue's `Mealie` module, which covers
recipe/meal-planning only — Grocy is the broader household-ERP tool. This module
deploys Grocy on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md)
foundation, which provisions and manages the shared Google Cloud infrastructure;
`Grocy_CloudRun` is a thin wrapper that supplies Grocy's own configuration (image,
port, probes, storage wiring) and forwards everything else straight through.

This guide focuses on the cloud services Grocy uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Grocy runs as an nginx + php-fpm container (the upstream LinuxServer.io `grocy`
image, unmodified) on Cloud Run v2. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | 1 vCPU / 1 GiB by default, `min=max=1` (no autoscaling — single-writer SQLite) |
| Database | None | Grocy uses an embedded SQLite database — no Cloud SQL instance is created |
| Persistent state | Cloud Filestore (NFS) | `/config` (SQLite database, config, uploads, backups) is mounted over NFS, **not** GCS FUSE — see §4 |
| Object storage | Cloud Storage | A `storage` bucket is provisioned but unused by default (see §4) |
| Secrets | Secret Manager | None generated for Grocy — no injectable admin credential exists |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **SQLite is the only database Grocy supports.** Confirmed by reading Grocy's own
  upstream source (`services/DatabaseService.php`) — there is no MySQL/Postgres
  driver branching at all. `database_type` is fixed to `NONE`.
- **`/config` is persisted over NFS, not GCS FUSE — a deliberate fix, not the
  catalogue's usual default.** Grocy writes to `data/grocy.db-journal` every 1–2
  seconds; GCS FUSE's object-storage translation layer cannot sustain that write
  pattern. A GCS-FUSE-backed `/config` crash-looped in production (confirmed live
  over 12 boot cycles / 20+ minutes — repeated `BufferedWriteHandler.OutOfOrderError`,
  HTTP `429` rate-limiting, stale-file-handle errors). `Grocy_CloudRun` instead sets
  `enable_nfs = true`, `nfs_mount_path = "/config"`. See §4 for the full story.
- **This is a genuinely different bug class than UptimeKuma's SQLite-on-NFS
  incident.** UptimeKuma's problem was WAL-mode lock incompatibility. Grocy never
  enables WAL mode at all (no `journal_mode` PRAGMA anywhere in its source) — its
  problem is write *frequency*, not lock semantics. Together they show "gcsfuse
  breaks SQLite" is a broader lesson than just WAL locking.
- **Single instance only.** `min_instance_count = 1`, `max_instance_count = 1`.
  Grocy's SQLite database is single-writer with no clustering support — running
  multiple replicas against the same volume is unsafe.
- **No injectable admin credential.** The upstream image ships default `admin` /
  `admin` credentials, changed via the web UI on first login. No Secret Manager
  secret is created for Grocy.
- **Health probes hit `/`, not `/health`.** Grocy has no dedicated health endpoint;
  the login page (`200`, unauthenticated) is used for both startup and liveness
  probes.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#6-outputs).

### A. Cloud Run — the Grocy service

Grocy runs as a single-instance Cloud Run v2 service. Each deployment creates an
immutable revision; traffic can be split across revisions for safe rollouts.

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

### B. Cloud Filestore (NFS) — the `/config` volume

All of Grocy's state — the embedded SQLite database (`grocy.db`), `config.php`,
uploaded images/attachments, and backups — lives under `/config`, mounted over a
Cloud Filestore (NFS) instance rather than GCS FUSE. This is the load-bearing
storage decision for this module (see §4); losing or misconfiguring this mount
loses all Grocy data.

- **Console:** Filestore → Instances.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT" --zone "$REGION-a"
  gcloud filestore instances describe <instance-name> --project "$PROJECT" --zone "$REGION-a"
  ```

See [App_CloudRun](App_CloudRun.md) for NFS auto-discovery and provisioning
behaviour.

### C. Cloud Storage

A dedicated **Cloud Storage** `storage` bucket is provisioned automatically, but by
default it is **not** used to back `/config` — that mount goes through NFS instead
(see §4). It remains available for any custom `gcs_volumes` an operator adds.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on;
ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Grocy Application Behaviour

- **No first-deploy database setup.** Grocy has no external database and no
  `db-init` job — it creates and migrates its own embedded SQLite schema under
  `/config` on first boot.
- **`/config` durability depends on the NFS mount, not a managed database.** Because
  Grocy's entire state (database, config, uploads, backups) lives in files on
  `/config`, the correctness of the NFS mount *is* the correctness of the
  deployment. Confirm the mount is healthy before trusting any data written to it.
- **No admin credential is generated or injectable.** The upstream image ships
  default `admin` / `admin` credentials. Log in with those on first access and
  change the password immediately via Users → admin → Edit in the Grocy UI — there
  is no environment variable or Secret Manager value that sets this for you.
- **Health path.** Both the startup and liveness probes issue HTTP `GET /`, which
  returns Grocy's login page (`200`) with no authentication required. This is not a
  dedicated health endpoint — Grocy has none — but it reliably indicates the
  nginx + php-fpm stack is serving.
- **Single-writer constraint is architectural, not a scaling knob.** Because Grocy's
  SQLite database has no MySQL/Postgres equivalent and no clustering support,
  `max_instance_count` must stay at `1`. There is no configuration that safely
  enables horizontal scaling for this module.
- **Verified live.** `https://grocycr31ffe08b-kj6qcu2rxa-uc.a.run.app` — 16 curl
  samples over ~5 minutes against a single stable revision
  (`grocycr31ffe08b-00003-h4w`), consistently serving `<title>Login | Grocy</title>`,
  with zero corruption-signature log entries (`OutOfOrderError` / `429` /
  `stale file` / `database is locked` / `disk I/O error` all absent) after the NFS
  fix described in §4.

---

## 4. Why `/config` Uses NFS Instead of GCS FUSE — the Real Story

This module's persistent-storage wiring is not this catalogue's usual default, and
the reason is worth understanding before changing it.

Grocy writes to `data/grocy.db-journal` on every database transaction — confirmed
live, roughly every 1–2 seconds under light use. GCS FUSE's object-storage
translation layer is built around eventual-consistency, whole-object semantics; it
does not sustain that kind of high-frequency small-write pattern. `Grocy_CloudRun`
originally mounted `/config` on a GCS-FUSE-backed bucket — this catalogue's usual
pattern for persistent app config — and it crash-looped in production. Confirmed
live over 12 full boot cycles across 20+ minutes, with real HTTP checks never once
returning a working page:

- Repeated `BufferedWriteHandler.OutOfOrderError`
- HTTP `429` rate-limiting responses from GCS
- Stale-file-handle errors
- A permanent crash-restart loop

The fix: switch `/config` from GCS FUSE to the Foundation's native **NFS** volume
support — `enable_nfs = true`, `nfs_mount_path = "/config"` — with
`Grocy_Common`'s own `enable_gcs_storage_volume` set to `false` to avoid a
double-mount at the same path. NFS implements real POSIX file semantics
(rename/fsync/advisory locks) that GCS FUSE's translation layer does not, and it
sustains Grocy's write pattern without issue.

**Why this is a genuinely different bug from the catalogue's other SQLite-on-shared-
storage incident (UptimeKuma):** UptimeKuma's problem was **WAL-mode lock**
incompatibility with NFS. Grocy never enables WAL mode at all — there is no
`journal_mode` PRAGMA anywhere in its source (confirmed against upstream
`DatabaseService.php`); it uses SQLite's default DELETE/rollback-journal mode. So
Grocy's failure on GCS FUSE had nothing to do with locking — it was purely a
write-*frequency* problem that GCS FUSE's object-storage semantics cannot absorb.
Read together, the general lesson broadens: **gcsfuse can break an embedded SQLite
database for more than one reason** — not only WAL-mode locking, but also
high-frequency write patterns in general, independent of journal mode.

A secondary, unrelated bug was fixed in passing during this module's build: a stray
`container_image_source = "prebuilt"` override in `deploy.tfvars` silently bypassed
the custom Dockerfile build entirely — the same footgun class already documented in
this catalogue for UptimeKuma.

**The GKE variant takes a different approach to the same underlying problem.**
`Grocy_GKE` is scaffolded but has **not yet been deployed or verified**. Its planned
fix is a StatefulSet **block PVC** at `/config` — real block storage, not a network
filesystem at all — matching this catalogue's general pattern for GKE variants of
SQLite-heavy apps (e.g. CalibreWeb_GKE). This guide will be updated once that
variant is deployed and verified.

---

## 5. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Grocy are listed; every other input is inherited
from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `min_instance_count` | `1` | Keeps the instance warm — avoids cold starts. |
| `max_instance_count` | `1` | **Must stay at `1`.** Grocy's SQLite database is single-writer with no clustering support. |
| `container_port` | `80` | Grocy's default HTTP port. |
| `container_protocol` | `http1` | Grocy serves plain HTTP/1.1; `h2c` is not required. |
| `execution_environment` | `gen2` | Required for the NFS mount. |
| `enable_cloudsql_volume` | `false` | Grocy has no Cloud SQL — keep `false`. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Merged with `Grocy_Common`'s defaults: `PUID=1000`, `PGID=1000`, `TZ=Etc/UTC`. |
| `secret_environment_variables` | `{}` | No default secrets exist for Grocy — this map is purely operator-supplied. |

### Group 11 — Cloud Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | **Defaults to `true` for this module** — required so `/config` can sustain Grocy's SQLite write pattern (see §4). Do not disable unless replacing it with an equally durable, POSIX-correct mount. |
| `nfs_mount_path` | `/config` | Grocy keeps all state (database, config, uploads, backups) here. Do not change unless the upstream image's data path changes. |
| `create_cloud_storage` | `true` | The `storage` bucket is still created (unused for `/config` by default; available for custom `gcs_volumes`). |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — Grocy has no SQL database of any kind. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No default init job — Grocy bootstraps its own SQLite schema on first boot. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` , 15s delay, 10 retries | Grocy's login page — no dedicated health endpoint exists. |
| `liveness_probe` | HTTP `/` , 30s delay, 3 retries | Same endpoint as the startup probe. |

All other inputs are inherited from [App_CloudRun](App_CloudRun.md) with standard
behaviour.

---

## 6. Outputs

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `grocy_url` | URL for the Grocy UI (port 80). Only reachable within the VPC when `ingress_settings = "internal"`. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (the `storage` bucket, unused for `/config` by default). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `initialization_jobs` | Created initialization job names (empty by default). |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 7. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time. Most out-of-range or contradictory inputs are caught before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_nfs` | `true` | Critical | Disabling it without an equally durable POSIX mount reverts `/config` to GCS FUSE (or an ephemeral in-container path), reproducing the confirmed crash-restart loop (`BufferedWriteHandler.OutOfOrderError`, `429`s, stale-file-handle errors) — or silently losing all state on every restart. |
| `nfs_mount_path` | `/config` | Critical | Grocy hardcodes its data path to `/config`. Changing the mount path without a matching image change loses access to the database, config, and uploads. |
| `max_instance_count` | `1` | Critical | Grocy's SQLite database is single-writer with no clustering support. Any value above `1` risks concurrent writers corrupting the database. |
| `container_image_source` | `custom` (the module default) | High | A stray `"prebuilt"` override silently bypasses the custom Dockerfile build (already hit once during this module's build, and documented for UptimeKuma) — Cloud Run then points at an unbuilt Artifact Registry path. |
| `database_type` | `NONE` | Medium | Grocy ignores this entirely (no code path reads it), but setting anything else provisions an unused, billed Cloud SQL instance. |
| Admin password | Change on first login | High | The upstream image's default `admin` / `admin` credentials are publicly documented; leaving them unchanged on a public `ingress_settings = "all"` deployment is a real exposure. |
| `min_instance_count` | `1` | Low | Setting `0` saves cost but reintroduces cold starts on Grocy's nginx + php-fpm stack. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Grocy-specific application configuration is
described in **[Grocy_Common](Grocy_Common.md)**.
