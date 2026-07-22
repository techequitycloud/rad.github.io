---
title: "Emby Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Emby module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Emby Common — Shared Application Configuration

`Emby_Common` is the **shared application layer** for Emby. It is
not deployed on its own; instead it supplies the Emby-specific configuration
that both [Emby_GKE](Emby_GKE.md) and
[Emby_CloudRun](Emby_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Emby, see the
platform guides ([Emby_GKE](Emby_GKE.md),
[Emby_CloudRun](Emby_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Emby_Common | Where it surfaces |
|---|---|---|
| Authentication | **No mandatory generated secrets** — the admin account is created through Emby's first-run setup wizard | Emby web UI on first access |
| Optional API key | When `enable_api_key = true`, generates a 32-char random API key and stores it in **Secret Manager**, injected as `EMBY_API_KEY` | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Thin-wraps the official `emby/embyserver` image so the foundation can mirror it into Artifact Registry | `container_image` output of the platform deployment |
| Database engine | **None** — Emby uses internal SQLite databases under `/config` (`database_type = "NONE"`) | §Database in the platform guides |
| Database bootstrap | **None** — there is no `db-init` job; Emby manages its own storage | n/a |
| Object storage | Declares the **Cloud Storage** `storage` bucket that backs `/config` on Cloud Run | `storage_buckets` output |
| Core settings | Sets `EMBY_CONFIG_DIR = /config` and the container port `8096` | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probes as **TCP** checks on port 8096 (no confirmed HTTP health path) | §Observability in the platform guides |

---

## 2. Secrets in Secret Manager

Emby has **no mandatory generated secrets**. Unlike database-backed
applications, it does not use an encryption key or a JWT signing secret —
authentication is configured entirely through the **first-run setup wizard**, where
you create the administrator account on first access to the web UI.

The **only optional secret** is an API key, gated behind `enable_api_key`
(default `false`):

- When `enable_api_key = true`, a 32-character random value is generated and stored
  in Secret Manager under the name `secret-<prefix>-<app>-api-key` (for example
  `secret-<prefix>-emby-api-key`), and injected into the container as `EMBY_API_KEY`
  via the foundation's `module_secret_env_vars` mechanism on both Cloud Run and GKE.
- When `enable_api_key = false` (the default), no secret is created and the module's
  secret map is empty.

**Note.** Emby itself has no documented env var that consumes `EMBY_API_KEY` at boot
— like Jellyfin (the module this one was cloned from), Emby's own API keys are
created and managed via an authenticated Dashboard/REST call (**Dashboard → API
Keys**). This secret exists so operators have a stable, Secret-Manager-backed
credential to hand to external API clients if they choose to mint an equivalent key
in-app; it is deliberately named with a single underscore (unlike the clone
source's inherited `QDRANT__SERVICE__API_KEY`-style nested-config name) so it is
also a valid GKE SecretSync `targetKey` and routes through the normal
`module_secret_env_vars` path on both platforms with no special-case wiring.

Retrieve the secret after deployment (only when `enable_api_key = true`):

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~api-key"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Emby does **not** use an external database. All of its state — the media
library index, user accounts, playback history, and settings — lives in **internal
SQLite databases** written under `/config`. Consequently:

- `database_type = "NONE"` — no Cloud SQL instance, database, or user is created for
  Emby.
- There is **no `db-init` job** — Emby initialises its own SQLite files on first
  boot; nothing has to be bootstrapped ahead of time.
- No PostgreSQL extensions, no `pgvector`, and no Redis are involved.

Because the databases are files on the persistent `/config` volume, durability is a
function of the storage backend, not a managed database service (see §5 and §7). If
you need custom data loading or migration tasks, you can supply your own
`initialization_jobs`; none is provided by default.

---

## 4. Container image and entrypoint

Emby uses a **thin-wrapper Dockerfile** — it does not add a custom entrypoint
script and runs the upstream image's own entrypoint (s6-overlay-based) unchanged:

```dockerfile
ARG EMBY_VERSION=4.10.0.15
FROM emby/embyserver:${EMBY_VERSION}
```

- **`image_source = "custom"`** — this is set purely so the foundation
  builds/mirrors the image into Artifact Registry; there is no application code
  layered on top.
- **App-specific build ARG** — the Dockerfile reads `EMBY_VERSION`, **not** the
  generic `APP_VERSION` that the foundation injects (and would force to `latest`).
  When `application_version = "latest"` the Common layer pins the build to
  `4.10.0.15`; otherwise it passes the requested version straight through.
- **No entrypoint translation** — because Emby needs no database wiring or URL
  rewriting at boot, the upstream image's default startup is used as-is. A local
  `docker build` + `docker run` verification confirmed the image boots cleanly with
  only `EMBY_CONFIG_DIR` set, reaches Emby Server's own startup logic, and serves
  a 302 redirect to the setup wizard on `/`.

---

## 5. Core application settings

`Emby_Common` establishes the minimal environment Emby needs to come up on
first boot and write its state to the persistent volume:

- **`EMBY_CONFIG_DIR = "/config"`** — points Emby's configuration, SQLite
  databases, metadata, plugins, transcode cache, and logs at the persistent volume.
  Everything Emby persists lives under this single directory.
- **Container port `8096`** — Emby serves HTTP on port 8096 by default, matching
  the module's `container_port`.
- **No telemetry, queue, or execution-mode settings** — there is nothing further to
  configure at boot; the rest of setup (admin account, libraries) happens through the
  web UI's first-run wizard.

Platform-specific mounting of `/config`:

- **Cloud Run** mounts the `storage` Cloud Storage bucket at `/config` via GCS FUSE
  (`enable_gcs_storage_volume = true`).
- **GKE** with `stateful_pvc_enabled = true` mounts a block PVC at `/config` and sets
  `enable_gcs_storage_volume = false` to avoid a double-mount at the same path.

---

## 6. Health probe behaviour

Both the startup and liveness probes are **TCP** checks against port 8096, not HTTP.
Unlike Jellyfin (the clone source, which documents an unauthenticated `/health`
endpoint returning `200`), Emby has **no confirmed, documented unauthenticated HTTP
health endpoint** — a live container test found `/health` returns `404`, while `/`
responds with a `302` redirect to the setup wizard, confirming the server is
listening but ruling out an HTTP path as the probe target. TCP passes as soon as
Emby's listener binds the port, independent of any specific path or auth behavior
that has not been verified upstream.

- **Startup probe** — TCP port 8096, `initial_delay = 15s`, `timeout = 5s`,
  `period = 10s`, `failure_threshold = 10`.
- **Liveness probe** — TCP port 8096, `initial_delay = 30s`, `timeout = 5s`,
  `period = 30s`, `failure_threshold = 3`.

---

## 7. Object storage

A single **Cloud Storage** bucket is declared here and provisioned by the foundation,
which also grants the workload service account access:

- **`name_suffix = "storage"`**, storage class **STANDARD**, with
  `public_access_prevention = "enforced"`.
- On Cloud Run it backs `/config` via GCS FUSE, so it holds Emby's SQLite
  databases, metadata, cache, and logs.

List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

**Note on storage type.** A media server ideally wants **block storage** for its
SQLite-heavy `/config` directory and transcode cache. On GKE, the block PVC
(`stateful_pvc_enabled = true`) is the best fit — low-latency random I/O against the
SQLite files. Cloud Run's GCS FUSE mount works but has higher latency and is better
suited to light use; heavy libraries and active transcoding are far happier on the
GKE block PVC.

The GKE block PVC defaults to the SSD-backed `standard-rwo` StorageClass, which
draws the tight regional `SSD_TOTAL_GB` quota — and scaling the app to zero does
**not** release the PVC, so a campaign of stateful modules can exhaust that quota.
Emby is exactly the media/SQLite case this affects: it doesn't need SSD IOPS,
so on a quota-constrained project override to HDD with
`-var stateful_pvc_storage_class=standard` (`pd-standard`, drawing the much larger
`DISKS_TOTAL_GB` quota instead) — still a real block device, so it preserves the
SQLite write-locking integrity the block PVC exists for.

---

## 8. Emby Premiere licensing (informational only)

This layer never touches licensing — it is documented here because it is the most
common question when comparing this module to `Jellyfin_Common`. Emby's core
self-hosted server (this module's entire surface: playback, library scanning, the
setup wizard, and software transcoding) requires **no license key and no
emby.media account**. **Emby Premiere** is a separate, optional paid subscription
purchased inside the Emby web UI after deployment; it unlocks hardware-accelerated
transcoding, the full mobile/TV client apps, DVR/live-TV, and offline sync. None of
that gating is enforced or bypassed by this module — it only affects what the
*operator* chooses to unlock post-deploy, not whether the module deploys or the
server boots.

---

For the Emby-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the platform
guides: **[Emby_GKE](Emby_GKE.md)** and
**[Emby_CloudRun](Emby_CloudRun.md)**.
