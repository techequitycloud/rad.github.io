---
title: "Filebrowser Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Filebrowser module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Filebrowser Common — Shared Application Configuration

`Filebrowser_Common` is the **shared application layer** for File Browser. It is
not deployed on its own; instead it supplies the Filebrowser-specific configuration
that both [Filebrowser_GKE](Filebrowser_GKE.md) and
[Filebrowser_CloudRun](Filebrowser_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Filebrowser, see the
platform guides ([Filebrowser_GKE](Filebrowser_GKE.md),
[Filebrowser_CloudRun](Filebrowser_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Filebrowser_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | **None.** Filebrowser stores its users and the initial admin credential inside its own embedded SQLite database; no Secret Manager env vars are generated | `secret_ids` / `secret_values` outputs are intentionally empty |
| Container image | Thin-wraps the official `filebrowser/filebrowser` image via a two-line Dockerfile; built with Cloud Build (Kaniko) and mirrored into Artifact Registry | `container_image` output of the platform deployment |
| Database engine | Fixes `database_type = "NONE"` — Filebrowser uses an **embedded SQLite** file, not Cloud SQL | §Persistence in the platform guides |
| Database bootstrap | **None.** No `db-init` job is injected; `initialization_jobs` is empty unless the operator supplies custom jobs | `initialization_jobs` output |
| Object storage | Declares one **Cloud Storage** bucket (suffix `storage`) that holds the persistent `/database` mount (the SQLite DB) | `storage_buckets` output |
| Core settings | Sets `FB_DATABASE = /database/filebrowser.db` and `FB_ROOT = /srv`, and pins the container to port 80 | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/health` | §Observability in the platform guides |

---

## 2. Secrets — none

Filebrowser needs **no secret environment variables**. Unlike database-backed
applications, it keeps its user table, settings, and share links inside its own
embedded SQLite database (`/database/filebrowser.db`). The initial credential is the
well-known **`admin` / `admin`** login, which the operator must change through the web
UI on first access.

Consequently the Common layer's `secret_ids` and `secret_values` outputs are
intentionally empty maps, and both variants wire them through unchanged
(`module_secret_env_vars = secret_ids`, `module_explicit_secret_values = secret_values`).
There is no encryption key or JWT secret to preserve across redeploys — the only
durable state is the SQLite file on the `/database` volume (see §5).

---

## 3. Container image and build

The custom image is a **two-line thin wrapper** over the upstream Filebrowser
release so the Foundation can mirror it into Artifact Registry:

```dockerfile
ARG FILEBROWSER_VERSION=v2.32.0
FROM filebrowser/filebrowser:${FILEBROWSER_VERSION}
```

- **App-specific build ARG.** The Dockerfile reads `FILEBROWSER_VERSION`, **not** the
  generic `APP_VERSION` the Foundation injects (which would force `latest`). When
  `application_version = "latest"`, Common resolves the build arg to the pinned
  `v2.32.0`; otherwise it passes the requested tag through. This keeps a `latest`
  deployment reproducible instead of chasing a moving upstream tag.
- **Cloud Build (Kaniko).** The image is built via `cloudbuild.yaml` using the Kaniko
  executor and pushed to the deployment's shared Artifact Registry repository, then
  used by the Cloud Run service / GKE workload.
- **No custom entrypoint.** The upstream image's own entrypoint launches the
  Filebrowser Go server directly; there is no wrapper script to remap variables.

---

## 4. Database initialization — none

Filebrowser manages its own storage and requires **no database initialization**. No
`db-init` job is injected, and `database_type` is fixed to `NONE`. The
`initialization_jobs` input is honoured only if the operator supplies custom jobs
(for example, to seed files into the served tree) — otherwise it stays empty.

On first start the Filebrowser binary creates its SQLite database at
`FB_DATABASE = /database/filebrowser.db` if the file does not yet exist, seeds the
default `admin`/`admin` user, and begins serving the file tree rooted at
`FB_ROOT = /srv`.

---

## 5. Object storage and persistence

A single **Cloud Storage** bucket (name suffix `storage`) is declared here and
provisioned by the Foundation, which also grants the workload service account
access. It is mounted into the container at **`/database`**, which is where the
embedded SQLite database lives — so users, settings, and share links survive
restarts and scale-to-zero.

- **Cloud Run** always mounts this bucket as a **GCS FUSE** volume at `/database`
  (`enable_gcs_storage_volume = true`).
- **GKE** mounts the same bucket as a GCS FUSE volume **unless** a StatefulSet block
  PVC is used at the same path (`stateful_pvc_enabled = true`), in which case Common
  sets `enable_gcs_storage_volume = false` to avoid a double-mount conflict — the
  PVC then provides `/database` instead.

The bucket location is left empty so the Foundation resolves it to the
auto-discovered deployment region (`coalesce(bucket.location, region)`), which avoids
force-replacing the immutable-location bucket on a cross-region re-apply.

List the bucket with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
```

---

## 6. Core application settings

`Filebrowser_Common` establishes the baseline environment so the application comes
up correctly on first boot:

- **`FB_DATABASE = /database/filebrowser.db`** — points the embedded SQLite database
  at the persistent `/database` mount.
- **`FB_ROOT = /srv`** — the file tree Filebrowser serves and manages.
- **Container port 80** — Filebrowser's default HTTP/1.1 listener (matches
  `container_port`).
- **First login** — `admin` / `admin`; change it in the web UI immediately.

Additional non-secret variables supplied via `environment_variables` are merged on
top of these defaults.

---

## 7. Health probe behaviour

The default startup and liveness probes target **`/health`** — Filebrowser's
unauthenticated health endpoint, which returns `200` once the server is listening.
Because there is no database migration or first-run schema step, the server becomes
ready quickly; the startup probe uses a 15-second initial delay with a 10-retry
window, and the liveness probe uses a 30-second delay.

---

For the Filebrowser-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the platform
guides: **[Filebrowser_GKE](Filebrowser_GKE.md)** and
**[Filebrowser_CloudRun](Filebrowser_CloudRun.md)**.
