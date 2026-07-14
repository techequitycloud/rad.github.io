---
title: "Navidrome Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Navidrome module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Navidrome Common — Shared Application Configuration

`Navidrome_Common` is the **shared application layer** for Navidrome. It is
not deployed on its own; instead it supplies the Navidrome-specific configuration
that both [Navidrome_GKE](Navidrome_GKE.md) and
[Navidrome_CloudRun](Navidrome_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Navidrome, see the
platform guides ([Navidrome_GKE](Navidrome_GKE.md),
[Navidrome_CloudRun](Navidrome_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Navidrome_Common | Where it surfaces |
|---|---|---|
| Admin bootstrap | When `enable_admin_password = true` (**default**), generates a random 24-char password, stores it in **Secret Manager**, and injects it as `ND_DEVAUTOCREATEADMINPASSWORD` so the `admin` user is auto-created on first boot | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Thin-wraps the official `deluan/navidrome` image so the foundation can mirror it into Artifact Registry | `container_image` output of the platform deployment |
| Database engine | **None** — Navidrome uses an embedded SQLite database under `/data` (`database_type = "NONE"`) | §Database in the platform guides |
| Database bootstrap | **None** — there is no `db-init` job; Navidrome manages its own storage | n/a |
| Object storage | Declares the **Cloud Storage** `storage` bucket that backs `/data` on Cloud Run | `storage_buckets` output |
| Core settings | Sets `ND_DATAFOLDER = /data`, `ND_MUSICFOLDER = /music`, `ND_PORT = 4533`, and the container port `4533` | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probes targeting `/ping` | §Observability in the platform guides |

---

## 2. Secrets in Secret Manager

Unlike a database-backed application, Navidrome has **no encryption key or JWT
signing secret** to manage — user accounts and sessions live in its embedded SQLite
database. The single secret this layer manages is the **first-run admin password**,
gated behind `enable_admin_password` (default `true`):

- When `enable_admin_password = true` (the default), a 24-character random value
  (`special = false`) is generated and stored in Secret Manager under the name
  `secret-<wrapper_prefix>-navidrome-admin-password`. It is injected into the
  container as the environment variable **`ND_DEVAUTOCREATEADMINPASSWORD`**, which
  tells Navidrome to auto-create the `admin` user with that password the first time
  it starts. The username is fixed to `admin`.
- When `enable_admin_password = false`, no secret is created and the module's secret
  map is empty — you instead create the first administrator through Navidrome's
  first-run web wizard on initial access.

The password is delivered to the workload as a **raw value** rather than a Secret
Manager data-source read — the Common layer exposes it through the `secret_values`
output, which the Cloud Run wrapper forwards as `module_explicit_secret_values` and
the GKE wrapper forwards as `explicit_secret_values` (materialising a native
Kubernetes Secret). The `secret_ids` output maps
`ND_DEVAUTOCREATEADMINPASSWORD → <secret id>` and the `admin_password_secret_id`
output surfaces the secret's ID (empty when `enable_admin_password = false`).

Retrieve the generated admin password after deployment:

```bash
# List the admin-password secret for this deployment:
gcloud secrets list --project "$PROJECT" --filter="name~navidrome-admin-password"

# Read the password (log in as user "admin" with this value):
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

An orphaned-secret cleanup helper (`cleanup_orphaned_secrets`) removes a stale
admin-password secret of the same name before recreating it, so re-deploys do not
collide on `409 already exists`. See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Navidrome does **not** use an external database. All of its state — the music
library index, user accounts, playlists, play counts, and settings — lives in an
**embedded SQLite database** written under `/data` (`ND_DATAFOLDER`). Consequently:

- `database_type = "NONE"` — no Cloud SQL instance, database, or user is created for
  Navidrome.
- There is **no `db-init` job** — Navidrome creates and migrates its own SQLite file
  on first boot; nothing has to be bootstrapped ahead of time.
- No PostgreSQL extensions, no `pgvector`, and no Redis are involved
  (`enable_postgres_extensions = false`).

Because the database is a file on the persistent `/data` volume, durability is a
function of the storage backend, not a managed database service (see §5 and §7). If
you need custom data loading or migration tasks, you can supply your own
`initialization_jobs`; none is provided by default.

---

## 4. Container image and entrypoint

Navidrome uses a **thin-wrapper Dockerfile** — it does not add a custom entrypoint
script and runs the upstream image's own start command unchanged:

```dockerfile
ARG NAVIDROME_VERSION=0.54.3
FROM deluan/navidrome:${NAVIDROME_VERSION}
```

- **`image_source = "custom"`** — this is set purely so the foundation
  builds/mirrors the image into Artifact Registry; no application code is layered on
  top. The build runs via Cloud Build (Kaniko) and mirrors the result into the
  shared Artifact Registry repository.
- **App-specific build ARG** — the Dockerfile reads `NAVIDROME_VERSION`, **not** the
  generic `APP_VERSION` that the foundation injects (and would force to `latest`).
  When `application_version = "latest"` the Common layer pins the build to
  `0.54.3`; otherwise it passes the requested version straight through.
- **No entrypoint translation** — because Navidrome needs no database wiring or URL
  rewriting at boot, the upstream image's default startup is used as-is.

---

## 5. Core application settings

`Navidrome_Common` establishes the minimal environment Navidrome needs to come up on
first boot and write its state to the persistent volume (user-supplied
`environment_variables` win over these defaults):

- **`ND_DATAFOLDER = "/data"`** — points Navidrome's SQLite database, metadata cache,
  and search index at the persistent volume. Everything Navidrome persists lives
  under this single directory.
- **`ND_MUSICFOLDER = "/music"`** — the music library Navidrome scans. This path is
  **not** auto-mounted by the module; supply the music collection via an additional
  `gcs_volumes` mount or an NFS mount at `/music` (see the platform guides). Navidrome
  treats it as read-only source content.
- **`ND_PORT = "4533"`** — the HTTP port Navidrome binds, matching the module's
  `container_port`.

Platform-specific mounting of `/data`:

- **Cloud Run** mounts the `storage` Cloud Storage bucket at `/data` via GCS FUSE
  (`enable_gcs_storage_volume = true`).
- **GKE** with `stateful_pvc_enabled = true` (the default) mounts a **block PVC** at
  `/data` and sets `enable_gcs_storage_volume = false` to avoid a double-mount at the
  same path. gcsfuse cannot safely back the embedded SQLite database, so GKE uses
  block storage instead.

---

## 6. Health probe behaviour

Both the startup and liveness probes issue an **HTTP GET `/ping`**, which returns
`{"status":"ok"}` with a `200` status and requires **no authentication** — so the
probes pass as soon as the HTTP server is up, independent of any admin login.

- **Startup probe** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`,
  `failure_threshold = 10`.
- **Liveness probe** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`,
  `failure_threshold = 3`.

---

## 7. Object storage

A single **Cloud Storage** bucket is declared here and provisioned by the foundation,
which also grants the workload service account access:

- **`name_suffix = "storage"`**, storage class **STANDARD**, `force_destroy = true`,
  versioning off, with `public_access_prevention = "enforced"`. Its `location` is
  left empty so the foundation resolves it to the auto-discovered deployment region
  (avoiding an immutable-location force-replace on cross-region re-apply).
- On Cloud Run it backs `/data` via GCS FUSE, so it holds Navidrome's SQLite
  database, metadata cache, search index, and logs.

List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

**Note on storage type.** Navidrome's `/data` directory is SQLite-heavy and needs
low-latency random I/O. On GKE, the block PVC (`stateful_pvc_enabled = true`) is the
best fit and is the default. Cloud Run's GCS FUSE mount works for light/personal use
but has higher latency; a heavily-used or large library is far happier on the GKE
block PVC.

---

For the Navidrome-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the platform
guides: **[Navidrome_GKE](Navidrome_GKE.md)** and
**[Navidrome_CloudRun](Navidrome_CloudRun.md)**.
