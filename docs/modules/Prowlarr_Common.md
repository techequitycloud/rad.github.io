---
title: "Prowlarr Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Prowlarr module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Prowlarr Common — Shared Application Configuration

`Prowlarr_Common` is the **shared application layer** for Prowlarr. It is not
deployed on its own; instead it supplies the Prowlarr-specific configuration
that [Prowlarr_GKE](Prowlarr_GKE.md) builds on. End users never configure
this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform
guide.

**There is no Cloud Run sibling to keep in sync with.** Most `*_Common`
modules in this catalogue exist to keep a CloudRun and a GKE variant
behaving identically. Prowlarr is different: it is **GKE-only**. The
official `lscr.io/linuxserver/prowlarr` image uses s6-overlay as its init
process, which cannot exec inside Cloud Run's gVisor sandbox — confirmed via
three separate live diagnostic deploys (default configuration, with an added
GCS volume, and with increased CPU/memory), all failing identically with
zero container output and "Application exec likely failed." A
`Prowlarr_CloudRun` module was built, deployed, diagnosed, and then removed
from the catalogue — see [Prowlarr_GKE](Prowlarr_GKE.md) §3 for the full
writeup. `Prowlarr_Common` follows the same shape every Common module in
this catalogue uses purely for consistency, not because a second platform
variant exists or is planned.

For the infrastructure that actually provisions and runs Prowlarr, see the
platform guide ([Prowlarr_GKE](Prowlarr_GKE.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Prowlarr_Common | Where it surfaces |
|---|---|---|
| Authentication | **No generated secrets at all** — Prowlarr ships with no default admin account; operators enable auth via the web UI's Settings → General → Security if desired | `secret_ids` / `secret_values` outputs (both empty maps) |
| Container image | The **official** `lscr.io/linuxserver/prowlarr` image, deployed unmodified — no Dockerfile, no build, no custom entrypoint | `container_image` output of the platform deployment |
| Database engine | **None** — Prowlarr uses an internal, embedded SQLite database (WAL mode) at `/config/prowlarr.db` (`database_type = "NONE"`) | §3 below and the platform guide |
| Database bootstrap | **None** — there is no `db-init` job; Prowlarr manages its own schema | n/a |
| Object storage | Declares the **Cloud Storage** `storage` bucket, mounted at `/config` only when no block PVC is used | `storage_buckets` output |
| Core settings | Container port `9696`; no extra environment required for first boot | Application behaviour in the platform guide |
| Health checks | Supplies the default startup/liveness probes targeting `/ping` | §6 below |

---

## 2. Secrets in Secret Manager

Prowlarr has **no generated secrets at all**. Unlike database-backed
applications in this catalogue, there is no encryption key or JWT signing
secret to create — and unlike zero-secret apps that still need a bootstrapped
admin credential, Prowlarr has no first-run admin account this layer needs
to seed either. It simply starts with authentication disabled until an
operator explicitly enables it in the web UI.

`Prowlarr_Common` still exposes the standard `secret_ids` and `secret_values`
outputs so it composes with `App_GKE` the same way every other application
module in this catalogue does, but both resolve to **empty maps** — there is
no secret-creation logic anywhere in this module.

```bash
gcloud secrets list --project "$PROJECT" --filter="name~prowlarr"
```

See [App_Common](App_Common.md) for the shared secret and Workload Identity
model that every application module, including this one, builds on.

---

## 3. Database engine and bootstrap

Prowlarr does **not** use an external database. All of its state —
configured indexers, connected *arr applications (Sonarr, Radarr, Lidarr,
Readarr), and sync/history logs — lives in an **internal, embedded SQLite
database in WAL mode** at `/config/prowlarr.db`. Consequently:

- `database_type = "NONE"` — no Cloud SQL instance, database, or user is
  created.
- There is **no `db-init` job** — Prowlarr creates and migrates its own
  SQLite schema on first boot; nothing needs to be bootstrapped ahead of
  time.
- No PostgreSQL extensions, no MySQL plugins, and no Redis are involved
  (`enable_redis` is hardcoded `false` by `Prowlarr_GKE`'s `main.tf`).

Because the database is a file on the persistent `/config` volume,
durability depends entirely on the storage backend, not a managed database
service — see §7. Supply your own `initialization_jobs` if you need custom
data-loading or migration tasks; none is provided by default.

---

## 4. Container image

Unlike several Common modules in this catalogue that layer a custom
entrypoint onto an upstream base image, `Prowlarr_Common` deploys the
**official image unmodified**:

```
lscr.io/linuxserver/prowlarr:<application_version>
```

- **`image_source = "prebuilt"`, `container_build_config.enabled = false`**
  — there is no Dockerfile and no build step. `Prowlarr_Common`'s `scripts/`
  directory contains nothing but a placeholder (`.gitkeep`) — this is the
  simplest Common module in the catalogue in that specific respect.
- **`enable_image_mirroring = true`** by default still applies — the
  official image is mirrored into the project's own Artifact Registry to
  avoid Docker Hub rate limits, even though nothing about the image is
  modified.
- **No app-specific version-pin build ARG.** Several custom-build Common
  modules in this catalogue read an app-specific `*_VERSION` build ARG
  instead of the generic `APP_VERSION` (which the Foundation would force to
  `latest`) — that entire class of problem doesn't apply here, because there
  is no build. `application_version = "latest"` is passed straight through
  as the deployed image tag.

---

## 5. Core application settings

`Prowlarr_Common` establishes the minimal configuration Prowlarr needs to
come up and serve its UI/API:

- **Container port `9696`** — Prowlarr's default HTTP port, matching the
  module's `container_port`.
- **`/config`** — Prowlarr persists its embedded SQLite database and all
  other application state under `/config` by default (the LinuxServer.io
  image's standard persistent-data path). No dedicated environment variable
  is required — it is the image's own default.
- **No telemetry, queue, or execution-mode settings** — there is nothing
  further to configure at boot; authentication, if wanted, is enabled
  entirely from within the web UI.

Mounting of `/config`:

- **GKE** with the (default) `stateful_pvc_enabled = true` mounts a real
  block PVC at `/config` and sets `enable_gcs_storage_volume = false` to
  avoid a double-mount at the same path — this is the recommended layout,
  since WAL-mode SQLite needs real POSIX file locking that a block device
  provides and GCS FUSE does not reliably.
- Without the PVC, the `storage` GCS bucket is mounted at `/config` via GCS
  FUSE instead.

---

## 6. Health probe behaviour

Both the startup and liveness probes issue an **HTTP GET `/ping`**,
Prowlarr's public, unauthenticated status endpoint — confirmed via local
container testing and a live GKE deployment to return
`200 {"status":"OK"}`.

This is a real fix over this module's original clone source, which pointed
both probes at `/api/health` (a path that does not exist on Prowlarr and
would have failed every probe). That stale `/api/health` value still lingers
in the separate, module-level `startup_probe_config` /
`health_check_config` / `uptime_check_config` variables surfaced by
`Prowlarr_GKE` — but for the actual Pod's startup and liveness probes, it is
harmless: `App_GKE` always prefers the per-app `startup_probe`/
`liveness_probe` supplied here (via `Prowlarr_Common`'s `config` output)
over the top-level `startup_probe_config`/`health_check_config` variables,
so the stale default in those two never reaches the running Pod. The one
exception is `uptime_check_config`, which **is** applied as-is if an
operator enables the optional Cloud Monitoring uptime check — see
[Prowlarr_GKE](Prowlarr_GKE.md) §6.

- **Startup probe** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`,
  `failure_threshold = 10`.
- **Liveness probe** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`,
  `failure_threshold = 3`.

---

## 7. Object storage

A single **Cloud Storage** bucket is declared here and provisioned by the
foundation, which also grants the workload service account access:

- **`name_suffix = "storage"`**, storage class **STANDARD**, with
  `public_access_prevention = "enforced"`.
- Only actually mounted at `/config` when `stateful_pvc_enabled = false`
  — not the recommended configuration for Prowlarr. With the default block
  PVC in place, this bucket is provisioned but unused as a mount.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~prowlarr"
```

**Why storage type matters here.** Prowlarr's embedded, WAL-mode SQLite
database needs a filesystem with real POSIX file locking. The GKE block PVC
(`stateful_pvc_enabled = true`, the default) is the correct fit — low-latency
random I/O with real file locking against the SQLite file. GCS FUSE does not
reliably support that locking model, and this catalogue has a documented
history of GCS FUSE corrupting other WAL-mode SQLite apps (see UptimeKuma) —
which is exactly why Prowlarr defaults to the PVC rather than the bucket
mount that most Common modules in this catalogue default to.

---

For the Prowlarr-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guide: **[Prowlarr_GKE](Prowlarr_GKE.md)**.
