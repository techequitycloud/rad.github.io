---
title: "PhotoPrism Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the PhotoPrism module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# PhotoPrism Common — Shared Application Configuration

`PhotoPrism_Common` is the **shared application layer** for PhotoPrism. It is not
deployed on its own; instead it supplies the PhotoPrism-specific configuration that
both [PhotoPrism_GKE](PhotoPrism_GKE.md) and [PhotoPrism_CloudRun](PhotoPrism_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End users
never configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs PhotoPrism, see the platform
guides ([PhotoPrism_GKE](PhotoPrism_GKE.md), [PhotoPrism_CloudRun](PhotoPrism_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by PhotoPrism_Common | Where it surfaces |
|---|---|---|
| Admin credential | Generates a 24-character `admin` password, stores it in **Secret Manager**, and injects it as `PHOTOPRISM_ADMIN_PASSWORD` | Retrieve via Secret Manager (see below); `secret_ids` / `admin_password_secret_id` outputs |
| Container image | Wraps the official `photoprism/photoprism` image via a thin Dockerfile and builds/mirrors it into **Artifact Registry** with Cloud Build (Kaniko) | `container_image` output of the platform deployment |
| Database engine | Fixes **embedded SQLite** (`PHOTOPRISM_DATABASE_DRIVER = sqlite`) — no Cloud SQL is provisioned (`database_type = "NONE"`) | §Database in the platform guides |
| Database bootstrap | **None** — PhotoPrism creates and migrates its own SQLite schema on first boot; no `db-init` job is injected | `initialization_jobs` output (empty unless the caller adds custom jobs) |
| Persistent storage | Declares a single **Cloud Storage** bucket (`storage`) and, on Cloud Run, mounts it as a GCS FUSE volume at `/photoprism` | `storage_buckets` output; §Persistence in the platform guides |
| Core settings | Sets the baseline PhotoPrism environment: SQLite driver, storage/originals/import paths, HTTP host/port, admin user, auth mode, site URL | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/api/v1/status` | §Observability in the platform guides |

---

## 2. Admin credential in Secret Manager

A single secret is generated automatically and stored in Secret Manager. It is never
set in plain text:

- **`PHOTOPRISM_ADMIN_PASSWORD`** — a 24-character random alphanumeric string
  (`special = false`). It is the password for the initial PhotoPrism admin account,
  whose username is `PHOTOPRISM_ADMIN_USER` (default `admin`, from `admin_username`).
  The secret is named
  `secret-<wrapper_prefix>-<application_name>-admin-password`. The key
  `PHOTOPRISM_ADMIN_PASSWORD` contains no `__` separators, so it is a valid GKE
  SecretSync `targetKey` and routes cleanly through `module_secret_env_vars` on both
  Cloud Run and GKE.

Retrieve the admin password after deployment:

```bash
# List the secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~admin-password"

# Read the current admin password:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

PhotoPrism reads `PHOTOPRISM_ADMIN_PASSWORD` at startup and (re)sets the admin
account password to match, so the value in Secret Manager is always the source of
truth. See [App_Common](App_Common.md) for the shared secret and Workload Identity
model.

---

## 3. Database engine — embedded SQLite (no Cloud SQL)

PhotoPrism runs in **embedded SQLite mode**: `PHOTOPRISM_DATABASE_DRIVER = "sqlite"`
is set, `database_type = "NONE"`, and `enable_cloudsql_volume = false`. No Cloud SQL
instance is provisioned, there is no `db-init` job, and there is no external database
connection to configure. The SQLite database file and index cache live under
`/photoprism/storage`, on the same mounted volume as the imported photos.

Because the entire application state — the SQLite database, the media index, the
thumbnail cache, and the originals — lives on one writable volume, PhotoPrism must run
as a **single instance** (`min_instance_count = max_instance_count = 1`). A second
concurrent writer would corrupt the SQLite database and the index.

---

## 4. Persistent storage layout

Everything PhotoPrism persists lives under `/photoprism`:

- `/photoprism/storage` — the SQLite database, sidecar files, and thumbnail cache
  (`PHOTOPRISM_STORAGE_PATH`)
- `/photoprism/originals` — imported/uploaded photos and videos
  (`PHOTOPRISM_ORIGINALS_PATH`)
- `/photoprism/import` — the staging area for the import workflow
  (`PHOTOPRISM_IMPORT_PATH`)

Mounting a single volume at `/photoprism` therefore covers all of it. The two platform
variants back this path differently:

- **Cloud Run** mounts the declared Cloud Storage bucket as a **GCS FUSE** volume at
  `/photoprism` (`enable_gcs_storage_volume = true`).
- **GKE** replaces that with a **block-storage PVC** at the same path
  (`stateful_pvc_enabled = true`), and sets `enable_gcs_storage_volume = false` to
  avoid a double-mount. gcsfuse cannot safely back SQLite or the media index, so GKE
  always uses the block PVC.

The `storage` bucket is declared here with `public_access_prevention = "enforced"`,
`force_destroy = true`, versioning off, and an empty `location` so the foundation
places it in the auto-discovered deployment region. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

## 5. Container image and build

The custom image is a thin wrapper over the official upstream image:

```dockerfile
ARG PHOTOPRISM_VERSION=240915
FROM photoprism/photoprism:${PHOTOPRISM_VERSION}
```

- **App-specific build ARG.** The Dockerfile reads `PHOTOPRISM_VERSION`, **not** the
  generic `APP_VERSION` the foundation injects (and would force to `latest`).
  `photoprism/photoprism` uses rolling, date-based tags, so when the caller leaves
  `application_version = "latest"` the module pins a sane recent tag (`240915`);
  otherwise it passes the requested version straight through.
- **Built and mirrored.** `image_source = "custom"` with `enable_image_mirroring = true`,
  so the wrapper is built with Cloud Build (Kaniko) and mirrored into Artifact Registry
  before deployment.
- **No custom entrypoint.** The upstream image's entrypoint is used as-is; all
  configuration is supplied through environment variables (below). PhotoPrism performs
  its own SQLite schema creation and migration on boot.

---

## 6. Core application settings

`PhotoPrism_Common` establishes the baseline PhotoPrism environment so the application
comes up correctly on first boot (all values merge under any caller-supplied
`environment_variables`, where a user-supplied key wins):

- **Database** — `PHOTOPRISM_DATABASE_DRIVER = "sqlite"`.
- **Storage paths** — `PHOTOPRISM_STORAGE_PATH = "/photoprism/storage"`,
  `PHOTOPRISM_ORIGINALS_PATH = "/photoprism/originals"`,
  `PHOTOPRISM_IMPORT_PATH = "/photoprism/import"`.
- **HTTP server** — `PHOTOPRISM_HTTP_HOST = "0.0.0.0"`, `PHOTOPRISM_HTTP_PORT = "2342"`
  (matching `container_port = 2342`).
- **Admin account** — `PHOTOPRISM_ADMIN_USER` (default `admin`) plus the injected
  `PHOTOPRISM_ADMIN_PASSWORD` secret; `PHOTOPRISM_AUTH_MODE = "password"`.
- **Site URL** — `PHOTOPRISM_SITE_URL` = `var.site_url` (empty by default; PhotoPrism
  then falls back to the request host). Set it to the deployed URL for correct share
  links and OAuth redirects.

---

## 7. Health probe behaviour

The default startup and liveness probes target **`GET /api/v1/status`**, which returns
`200` once the PhotoPrism HTTP server is up and the SQLite index is ready.

- **Startup probe** — HTTP `/api/v1/status`, 15-second initial delay, 10-second period,
  20-failure threshold (roughly a 3½-minute window after the delay) — generous enough
  for first-boot SQLite schema creation and index warm-up.
- **Liveness probe** — HTTP `/api/v1/status`, 30-second initial delay, 30-second
  period, 3-failure threshold.

Both defaults can be overridden per variant via `startup_probe` / `liveness_probe`.

---

## 8. Module outputs

`PhotoPrism_Common` exposes the following to its callers:

| Output | Description |
|---|---|
| `config` | The full PhotoPrism module config (image, port, env vars, probes, volumes, resources) forwarded to the foundation as `application_config`. |
| `storage_buckets` | The single `storage` bucket definition forwarded as `module_storage_buckets`. |
| `secret_ids` | Map `PHOTOPRISM_ADMIN_PASSWORD → <secret id>`, forwarded as `module_secret_env_vars`. |
| `secret_values` | Raw secret values (sensitive) for explicit injection, bypassing Secret Manager data-source reads. |
| `admin_password_secret_id` | Secret Manager secret ID holding the generated admin password. |
| `path` | The module path, used to locate the `scripts/` directory for the build. |

---

For the PhotoPrism-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[PhotoPrism_GKE](PhotoPrism_GKE.md)** and
**[PhotoPrism_CloudRun](PhotoPrism_CloudRun.md)**.
