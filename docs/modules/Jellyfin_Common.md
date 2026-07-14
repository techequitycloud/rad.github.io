---
title: "Jellyfin Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Jellyfin module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Jellyfin Common — Shared Application Configuration

`Jellyfin_Common` is the **shared application layer** for Jellyfin. It is
not deployed on its own; instead it supplies the Jellyfin-specific configuration
that both [Jellyfin_GKE](Jellyfin_GKE.md) and
[Jellyfin_CloudRun](Jellyfin_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Jellyfin, see the
platform guides ([Jellyfin_GKE](Jellyfin_GKE.md),
[Jellyfin_CloudRun](Jellyfin_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Jellyfin_Common | Where it surfaces |
|---|---|---|
| Authentication | **No mandatory generated secrets** — the admin account is created through Jellyfin's first-run setup wizard | Jellyfin web UI on first access |
| Optional API key | When `enable_api_key = true`, generates a 32-char random API key and stores it in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Thin-wraps the official `jellyfin/jellyfin` image so the foundation can mirror it into Artifact Registry | `container_image` output of the platform deployment |
| Database engine | **None** — Jellyfin uses internal SQLite databases under `/config` (`database_type = "NONE"`) | §Database in the platform guides |
| Database bootstrap | **None** — there is no `db-init` job; Jellyfin manages its own storage | n/a |
| Object storage | Declares the **Cloud Storage** `storage` bucket that backs `/config` on Cloud Run | `storage_buckets` output |
| Core settings | Sets `JELLYFIN_CONFIG_DIR = /config` and the container port `8096` | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probes targeting `/health` | §Observability in the platform guides |

---

## 2. Secrets in Secret Manager

Jellyfin has **no mandatory generated secrets**. Unlike database-backed
applications, it does not use an encryption key or a JWT signing secret —
authentication is configured entirely through the **first-run setup wizard**, where
you create the administrator account on first access to the web UI.

The **only optional secret** is an API key, gated behind `enable_api_key`
(default `false`):

- When `enable_api_key = true`, a 32-character random value is generated and stored
  in Secret Manager under the name `secret-<prefix>-<app>-api-key` (for example
  `secret-<prefix>-jellyfin-api-key`). It is injected into the container as a secret
  environment variable via the foundation's `module_secret_env_vars` mechanism.
- When `enable_api_key = false` (the default), no secret is created and the module's
  secret map is empty.

In normal operation you do not need this option: Jellyfin creates and manages API
keys itself through **Dashboard → API Keys** in the web UI. The
`enable_api_key` secret exists only for deployments that want a pre-provisioned key
baked into the environment before the UI is reachable.

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

Jellyfin does **not** use an external database. All of its state — the media
library index, user accounts, playback history, and settings — lives in **internal
SQLite databases** written under `/config`. Consequently:

- `database_type = "NONE"` — no Cloud SQL instance, database, or user is created for
  Jellyfin.
- There is **no `db-init` job** — Jellyfin initialises its own SQLite files on first
  boot; nothing has to be bootstrapped ahead of time.
- No PostgreSQL extensions, no `pgvector`, and no Redis are involved.

Because the databases are files on the persistent `/config` volume, durability is a
function of the storage backend, not a managed database service (see §5 and §7). If
you need custom data loading or migration tasks, you can supply your own
`initialization_jobs`; none is provided by default.

---

## 4. Container image and entrypoint

Jellyfin uses a **thin-wrapper Dockerfile** — it does not add a custom entrypoint
script and runs the upstream image's own entrypoint unchanged:

```dockerfile
ARG JELLYFIN_VERSION=10.10.3
FROM jellyfin/jellyfin:${JELLYFIN_VERSION}
```

- **`image_source = "custom"`** — this is set purely so the foundation
  builds/mirrors the image into Artifact Registry; there is no application code
  layered on top.
- **App-specific build ARG** — the Dockerfile reads `JELLYFIN_VERSION`, **not** the
  generic `APP_VERSION` that the foundation injects (and would force to `latest`).
  When `application_version = "latest"` the Common layer pins the build to
  `10.10.3`; otherwise it passes the requested version straight through.
- **No entrypoint translation** — because Jellyfin needs no database wiring or URL
  rewriting at boot, the upstream image's default startup is used as-is.

---

## 5. Core application settings

`Jellyfin_Common` establishes the minimal environment Jellyfin needs to come up on
first boot and write its state to the persistent volume:

- **`JELLYFIN_CONFIG_DIR = "/config"`** — points Jellyfin's configuration, SQLite
  databases, metadata, plugins, transcode cache, and logs at the persistent volume.
  Everything Jellyfin persists lives under this single directory.
- **Container port `8096`** — Jellyfin serves HTTP on port 8096 by default, matching
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

Both the startup and liveness probes issue an **HTTP GET `/health`**, which returns
the plain string `Healthy` with a `200` status and requires **no authentication** —
so the probes pass as soon as the server is serving, independent of any admin login.

- **Startup probe** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`,
  `failure_threshold = 10`.
- **Liveness probe** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`,
  `failure_threshold = 3`.

---

## 7. Object storage

A single **Cloud Storage** bucket is declared here and provisioned by the foundation,
which also grants the workload service account access:

- **`name_suffix = "storage"`**, storage class **STANDARD**, with
  `public_access_prevention = "enforced"`.
- On Cloud Run it backs `/config` via GCS FUSE, so it holds Jellyfin's SQLite
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

---

For the Jellyfin-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the platform
guides: **[Jellyfin_GKE](Jellyfin_GKE.md)** and
**[Jellyfin_CloudRun](Jellyfin_CloudRun.md)**.
