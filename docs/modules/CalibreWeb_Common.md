---
title: "Calibre-Web Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Calibre-Web module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Calibre-Web Common — Shared Application Configuration

`CalibreWeb_Common` is the **shared application layer** for Calibre-Web. It is
not deployed on its own; instead it supplies the Calibre-Web-specific configuration
that both [CalibreWeb_GKE](CalibreWeb_GKE.md) and
[CalibreWeb_CloudRun](CalibreWeb_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Calibre-Web, see the
platform guides ([CalibreWeb_GKE](CalibreWeb_GKE.md),
[CalibreWeb_CloudRun](CalibreWeb_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by CalibreWeb_Common | Where it surfaces |
|---|---|---|
| Authentication | Ships with the LinuxServer default `admin` / `admin123` login (change on first sign-in); **also** generates a 24-char random admin password and stores it in **Secret Manager** | Calibre-Web web UI on first access; secret injected as `CALIBRE_ADMIN_PASSWORD` |
| Admin-password secret | Always creates `secret-<prefix>-<app>-admin-password` and exposes it as the `CALIBRE_ADMIN_PASSWORD` env var | `secret_ids` / `admin_password_secret_id` outputs; retrieve via Secret Manager (see below) |
| Container image | Thin-wraps the official `lscr.io/linuxserver/calibre-web` image so the foundation can mirror it into Artifact Registry | `container_image` output of the platform deployment |
| Database engine | **None** — Calibre-Web uses internal SQLite databases under `/config` (`database_type = "NONE"`) | §Database in the platform guides |
| Database bootstrap | **None** — there is no `db-init` job; Calibre-Web manages its own storage | n/a |
| Object storage | Declares the **Cloud Storage** `storage` bucket that backs `/config` on Cloud Run | `storage_buckets` output |
| Core settings | Sets `PUID = 1000`, `PGID = 1000`, `TZ = Etc/UTC` and the container port `8083` | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probes targeting `/` (the login page, `200`) | §Observability in the platform guides |

---

## 2. Secrets in Secret Manager

Calibre-Web ships with a built-in default login — **`admin` / `admin123`** — that the
operator changes on first sign-in. Independently of that, `CalibreWeb_Common`
**always** generates a strong admin password and stores it in Secret Manager, so a
SERVICE secret exists in the module's `secret_ids` output (the standard injection
path):

- **`CALIBRE_ADMIN_PASSWORD`** — a 24-character random alphanumeric value
  (`special = false`) stored in Secret Manager under
  `secret-<prefix>-<app>-admin-password` (for example
  `secret-<prefix>-calibreweb-admin-password`). It is injected into the container as
  a secret environment variable via the foundation's `module_secret_env_vars`
  mechanism. The key has no `__`, so it is a valid GKE SecretSync `targetKey`.

> **Note on the first login.** The upstream LinuxServer Calibre-Web image
> authenticates its first sign-in with the built-in `admin` / `admin123`
> credentials, not the generated secret. The `CALIBRE_ADMIN_PASSWORD` secret is
> provisioned so a strong password exists in Secret Manager (and so a future image
> or entrypoint can consume it) — **change the admin password in the Calibre-Web UI
> immediately after first sign-in**, and use the generated secret value if you want a
> strong, stored password.

Retrieve the secret after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~admin-password"

# Read the generated admin password:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Calibre-Web does **not** use an external database. All of its state — the
application database (`app.db`), the Calibre library metadata database
(`metadata.db`), configuration, cache, and logs — lives in **internal SQLite files**
written under `/config`. The ebook library itself lives under `/books` (empty on
first run; the setup wizard points Calibre-Web at it). Consequently:

- `database_type = "NONE"` — no Cloud SQL instance, database, or user is created for
  Calibre-Web.
- There is **no `db-init` job** — Calibre-Web initialises its own SQLite files on
  first boot; nothing has to be bootstrapped ahead of time.
- No PostgreSQL extensions, no `pgvector`, and no Redis are involved.

Because the databases are files on the persistent `/config` volume, durability is a
function of the storage backend, not a managed database service (see §5 and §7). If
you need custom data loading or migration tasks, you can supply your own
`initialization_jobs`; none is provided by default.

---

## 4. Container image and entrypoint

Calibre-Web uses a **thin-wrapper Dockerfile** — it does not add a custom entrypoint
script and runs the upstream LinuxServer image's own s6-based init unchanged:

```dockerfile
ARG CALIBREWEB_VERSION=0.6.24
FROM lscr.io/linuxserver/calibre-web:${CALIBREWEB_VERSION}
```

- **`image_source = "custom"`** — this is set purely so the foundation
  builds/mirrors the image into Artifact Registry (via Cloud Build / Kaniko); there
  is no application code layered on top.
- **App-specific build ARG** — the Dockerfile reads `CALIBREWEB_VERSION`, **not** the
  generic `APP_VERSION` that the foundation injects (and would force to `latest`).
  When `application_version = "latest"` the Common layer pins the build to
  `0.6.24`; otherwise it passes the requested version straight through.
- **No entrypoint translation** — because Calibre-Web needs no database wiring or URL
  rewriting at boot, the upstream image's default startup is used as-is. The
  LinuxServer image drops privileges to `PUID:PGID` (`1000:1000`) and keeps all state
  under `/config`.

---

## 5. Core application settings

`CalibreWeb_Common` establishes the minimal environment Calibre-Web needs to come up
on first boot and write its state to the persistent volume:

- **`PUID = "1000"` / `PGID = "1000"`** — the user/group the LinuxServer image drops
  to; owns the `/config` (and `/books`) mounts so Calibre-Web can read and write its
  SQLite files.
- **`TZ = "Etc/UTC"`** — container timezone; override via `environment_variables`.
- **Container port `8083`** — Calibre-Web serves HTTP on port 8083 by default,
  matching the module's `container_port`.
- **No telemetry, queue, or execution-mode settings** — there is nothing further to
  configure at boot; the rest of setup (admin password change, pointing at the
  Calibre library) happens through the web UI.

Platform-specific mounting of `/config`:

- **Cloud Run** mounts the `storage` Cloud Storage bucket at `/config` via GCS FUSE
  (`enable_gcs_storage_volume = true`).
- **GKE** with `stateful_pvc_enabled = true` mounts a block PVC at `/config` and sets
  `enable_gcs_storage_volume = false` to avoid a double-mount at the same path. A
  real block PVC is recommended because gcsfuse can corrupt SQLite / media indexes.

---

## 6. Health probe behaviour

Both the startup and liveness probes issue an **HTTP GET `/`**, which returns
Calibre-Web's login page (`200`) and requires **no authentication** — so the probes
pass as soon as the server is serving, independent of any admin login.

- **Startup probe** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`,
  `failure_threshold = 10`.
- **Liveness probe** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`,
  `failure_threshold = 3`.

---

## 7. Object storage

A single **Cloud Storage** bucket is declared here and provisioned by the foundation,
which also grants the workload service account access:

- **`name_suffix = "storage"`**, storage class **STANDARD**, `force_destroy = true`,
  versioning off, with `public_access_prevention = "enforced"`.
- The bucket location is left empty so the foundation resolves it to the
  auto-discovered deployment region (`coalesce(bucket.location, region)`), matching
  the tested modules and avoiding a force-replace of the immutable-location bucket on
  a cross-region re-apply.
- On Cloud Run it backs `/config` via GCS FUSE, so it holds Calibre-Web's SQLite
  databases (`app.db`, `metadata.db`), configuration, cache, and logs.

List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

**Note on storage type.** Calibre-Web's `/config` directory is SQLite-heavy and
ideally wants **block storage**. On GKE, the block PVC (`stateful_pvc_enabled = true`)
is the best fit — low-latency random I/O against the SQLite files, without the
gcsfuse consistency caveats. Cloud Run's GCS FUSE mount works for a single
scale-pinned instance and light use; heavier libraries are far happier on the GKE
block PVC.

---

For the Calibre-Web-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the platform
guides: **[CalibreWeb_GKE](CalibreWeb_GKE.md)** and
**[CalibreWeb_CloudRun](CalibreWeb_CloudRun.md)**.
