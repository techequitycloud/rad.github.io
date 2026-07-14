---
title: "Audiobookshelf Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Audiobookshelf module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Audiobookshelf Common — Shared Application Configuration

`Audiobookshelf_Common` is the **shared application layer** for Audiobookshelf. It is
not deployed on its own; instead it supplies the Audiobookshelf-specific configuration
that both [Audiobookshelf_GKE](Audiobookshelf_GKE.md) and
[Audiobookshelf_CloudRun](Audiobookshelf_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Audiobookshelf, see the
platform guides ([Audiobookshelf_GKE](Audiobookshelf_GKE.md),
[Audiobookshelf_CloudRun](Audiobookshelf_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Audiobookshelf_Common | Where it surfaces |
|---|---|---|
| Container image | Wraps the official `ghcr.io/advplyr/audiobookshelf` image with a thin `Dockerfile` and builds/mirrors it into **Artifact Registry** via Cloud Build (Kaniko) | `container_image` output of the platform deployment |
| Database engine | **None** — Audiobookshelf embeds its own **SQLite** database under `CONFIG_PATH`; no Cloud SQL, no init job, no migrations job | `database_type = "NONE"` in the config |
| Persistent storage | Declares a single **Cloud Storage** data bucket and mounts it at `/data` (covering both `CONFIG_PATH` and `METADATA_PATH`) | `storage_buckets` output |
| Core settings | Sets the baseline environment: `PORT`, `CONFIG_PATH`, `METADATA_PATH`, container port `80` | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/healthcheck` | §Observability in the platform guides |
| Secrets | **None** — the first admin ("root") user is created interactively in the first-run web UI; `secret_ids` and `secret_values` are empty | — |

---

## 2. No service secrets

Unlike database-backed apps, Audiobookshelf has **no env-based admin or API
bootstrap**. There are no cryptographic keys, no JWT secret, and no database password
to generate:

- The initial **root** user is created interactively on first access to `/` in the
  web UI.
- API tokens are minted in the web UI afterwards (Settings → Users), not injected at
  deploy time.

Accordingly, `Audiobookshelf_Common` exposes **empty** `secret_ids` and
`secret_values` outputs. Both variant wrappers still wire these uniformly (through
`module_secret_env_vars` / `explicit_secret_values`) so the foundation call is
identical across platforms — there is simply nothing to inject.

There are therefore no application secrets to retrieve from Secret Manager for this
module. (The foundation may still create platform-level secrets unrelated to the
application; see [App_Common](App_Common.md).)

---

## 3. No database, no init job

Audiobookshelf stores **all** of its application state in a self-managed **SQLite**
database that it creates and migrates itself on first boot. Consequently:

- `database_type = "NONE"`, `db_name = ""`, `db_user = ""`, and
  `enable_cloudsql_volume = false` — no Cloud SQL instance, Auth Proxy, or database
  user is provisioned.
- **No `db-init` job is injected.** Audiobookshelf self-creates its schema on first
  start, so `initialization_jobs` defaults to an empty list. Custom jobs can still be
  supplied (for one-off data loads or migrations), but none are required.
- **No Redis.** Audiobookshelf is a single-writer application; `enable_redis` is
  forced to `false` in both variant wrappers.

Because the SQLite file lives under the persistent `/data` mount (see below), the
database survives revision/pod restarts and application-version upgrades.

---

## 4. Persistent storage — a single `/data` mount

Audiobookshelf keeps its SQLite config database under `CONFIG_PATH` and its cover art
/ cached metadata under `METADATA_PATH`. Both are redirected under **one** persistent
mount so a single volume covers config + metadata:

- `CONFIG_PATH = /data/config` — the SQLite database and application config.
- `METADATA_PATH = /data/metadata` — cover art and cached metadata.

`Audiobookshelf_Common` declares one Cloud Storage data bucket (`name_suffix =
"storage"`) and, when `enable_gcs_storage_volume = true`, mounts it at `/data`. The
two variants realise this mount differently:

- **Cloud Run** mounts the bucket as a **GCS FUSE** volume at `/data` (requires the
  gen2 execution environment).
- **GKE** mounts a **block Persistent Volume Claim** at `/data` via a StatefulSet.
  gcsfuse **corrupts** SQLite and the media file index, so a real block PVC is
  required; in that case the wrapper sets `enable_gcs_storage_volume = false` to avoid
  a double-mount at the same path.

An additional media library (audiobooks / podcasts) can be attached through
`gcs_volumes` (for example a read-only bucket mounted at `/audiobooks`), which is
concatenated alongside the storage volume.

List the data bucket after deployment:

```bash
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://<data-bucket>/          # bucket name is in the platform Outputs
```

---

## 5. Container image and version pinning

The image is a **thin wrapper** built `FROM ghcr.io/advplyr/audiobookshelf` so the
foundation can mirror it into Artifact Registry:

- The build runs through **Cloud Build with Kaniko** and honours the app-specific
  build ARG **`AUDIOBOOKSHELF_VERSION`** — deliberately *not* the generic `APP_VERSION`
  the foundation injects (which it would force to `latest`). When
  `application_version = "latest"`, the ARG resolves to the pinned default `2.17.0`;
  otherwise it uses the requested tag.
- `enable_image_mirroring = true` by default, so the image is pulled once into the
  tenant's Artifact Registry and served from there.

Inspect the built image and registry from the platform deployment outputs
(`container_image`, `container_registry`) or:

```bash
gcloud artifacts docker images list \
  <region>-docker.pkg.dev/$PROJECT/<repo>/audiobookshelf --project "$PROJECT"
```

---

## 6. Core application settings

`Audiobookshelf_Common` establishes the baseline environment so the application comes
up correctly on first boot:

- **Port** — `PORT = "80"`; the container listens on port `80` (Audiobookshelf's
  default HTTP port).
- **Config path** — `CONFIG_PATH = "/data/config"`.
- **Metadata path** — `METADATA_PATH = "/data/metadata"`.

These defaults can be overridden via `environment_variables` when the same key is
supplied, but changing `CONFIG_PATH`/`METADATA_PATH` after first boot would orphan the
existing SQLite database and cached metadata.

---

## 7. Health probe behaviour

The default startup and liveness probes target **`/healthcheck`** — Audiobookshelf's
unauthenticated endpoint that returns `200` once the server is ready. Because the
probe path is public, it succeeds as soon as the HTTP server binds and does not
require authentication.

- **Startup probe** — HTTP `/healthcheck`, 15-second initial delay, 10-second period,
  10 failures allowed (≈115 seconds of first-boot grace).
- **Liveness probe** — HTTP `/healthcheck`, 30-second initial delay, 30-second period,
  3 failures allowed.

---

For the Audiobookshelf-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the platform
guides: **[Audiobookshelf_GKE](Audiobookshelf_GKE.md)** and
**[Audiobookshelf_CloudRun](Audiobookshelf_CloudRun.md)**.
