---
title: "PocketBase Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the PocketBase module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# PocketBase Common — Shared Application Configuration

`PocketBase_Common` is the **shared application layer** for PocketBase. It is not
deployed on its own; instead it supplies the PocketBase-specific configuration that
both [PocketBase_GKE](PocketBase_GKE.md) and [PocketBase_CloudRun](PocketBase_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End users
never configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs PocketBase, see the platform
guides ([PocketBase_GKE](PocketBase_GKE.md), [PocketBase_CloudRun](PocketBase_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by PocketBase_Common | Where it surfaces |
|---|---|---|
| Container image | Wraps the prebuilt `ghcr.io/muchobien/pocketbase` image via a thin Dockerfile so the foundation can build/mirror it into **Artifact Registry** | `container_image` output of the platform deployment |
| Image version | Pins `POCKETBASE_VERSION` to `0.22.21` when `application_version = "latest"`, so a non-existent `pocketbase:latest`-derived tag is never requested | `container_build_config.build_args` |
| Database engine | Fixes `database_type = "NONE"` — PocketBase ships an **embedded SQLite** database; no Cloud SQL instance is created | §Database behaviour in the platform guides |
| Database bootstrap | **None** — PocketBase self-creates and migrates its own SQLite schema on first boot, so no `db-init` job is injected | Application behaviour in the platform guides |
| Persistent storage | Declares a single **Cloud Storage** data bucket (suffix `storage`) and mounts it at `/pb_data` on Cloud Run via GCS FUSE; on GKE a block PVC is mounted at the same path instead | `storage_buckets` output |
| Secrets | **None** — PocketBase issues and stores all auth in its own SQLite DB; `secret_ids` / `secret_values` are intentionally empty | §Secrets below |
| Cache / queue | **None** — PocketBase is a single self-contained backend and does not use Redis | Both variants set `enable_redis = false` |
| Core settings | Container port `8090`, admin created interactively at `/_/`, no env required for first boot | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/api/health` | §Observability in the platform guides |

---

## 2. Secrets in Secret Manager

**PocketBase requires no injected secret.** Unlike most database-backed applications,
PocketBase has no env-supplied credential:

- The **superuser (admin) account** is created interactively on first access at `/_/`.
- All API authentication (admin tokens, user records, auth collections) is issued and
  stored **by PocketBase itself** inside its embedded SQLite database under `/pb_data`.

Because of this, `PocketBase_Common` deliberately exports **empty** `secret_ids` and
`secret_values` maps. The CloudRun and GKE variants still reference these outputs (wiring
them into `module_secret_env_vars` / `explicit_secret_values`) so the module contract is
uniform with every other application module — but no Secret Manager secret is created for
PocketBase's own auth.

If you add your own secrets (for example, an SMTP password or an S3 access key for
external backups), inject them through the platform's `secret_environment_variables` input
on the variant module and confirm them with:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~pocketbase"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The durable secret to protect is not in Secret Manager at all — it is the **SQLite
database in the data bucket / PVC**, which holds every record, admin, and token.

---

## 3. Container image

The image is a **thin wrapper** built from the prebuilt upstream image:

```dockerfile
ARG POCKETBASE_VERSION=0.22.21
FROM ghcr.io/muchobien/pocketbase:${POCKETBASE_VERSION}
```

- **Base image:** `ghcr.io/muchobien/pocketbase` — a maintained container distribution of
  the single-binary PocketBase server.
- **Build:** the foundation builds this Dockerfile with Cloud Build (Kaniko) and pushes it
  into the deployment's Artifact Registry repository; `enable_image_mirroring = true` by
  default.
- **App-specific version ARG.** The Dockerfile reads `POCKETBASE_VERSION`, **not** the
  generic `APP_VERSION` the foundation injects (and would otherwise force to `latest`).
  `PocketBase_Common` sets `POCKETBASE_VERSION = "0.22.21"` whenever
  `application_version = "latest"`, so the build always resolves to a real, existing tag.
- **No custom entrypoint.** The upstream image already runs
  `serve --http=0.0.0.0:8090` with its data directory at `/pb_data`, matching the
  container port and the storage mount — so no wrapper entrypoint is needed for first boot.

---

## 4. Database initialization

**There is no database initialization job.** PocketBase is a single self-contained Go
binary with an **embedded SQLite** database. On first start it creates its own database
files, tables, and system collections under `/pb_data`, and it applies any pending schema
migrations automatically on every subsequent start.

Consequently `PocketBase_Common`:

- sets `database_type = "NONE"` (no Cloud SQL instance, user, or database is provisioned),
- injects **no** default `initialization_jobs` (custom jobs are still accepted via the
  `initialization_jobs` input for bespoke data-loading tasks), and
- performs **no** `pgvector`/extension setup and requires no `enable_cloudsql_volume`.

The only thing that must persist across restarts is the `/pb_data` directory — see the
next section.

---

## 5. Persistent storage

PocketBase keeps its **entire state** — the SQLite database, uploaded files, and settings —
under a single directory, `/pb_data`. `PocketBase_Common` declares one Cloud Storage data
bucket for this and mounts it differently per platform:

| Platform | Persistence at `/pb_data` | How it is wired |
|---|---|---|
| **Cloud Run** | GCS FUSE volume backed by the `storage` bucket | `enable_gcs_storage_volume = true` injects the bucket as a FUSE mount at `/pb_data` |
| **GKE** | Block PVC (ReadWriteOnce) via a **StatefulSet** | `stateful_pvc_enabled = true` mounts a block PVC at `/pb_data`; the Common layer sets `enable_gcs_storage_volume = false` in this case to avoid a double-mount at the same path |

The bucket is declared with:

- `name_suffix = "storage"`, resolved by the foundation to
  `gcs-<service_name>-storage`,
- `location = ""` so the foundation places it in the auto-discovered deployment region
  (a hard-coded location would pin it and could force-replace the immutable-location bucket
  on re-apply in another region),
- `storage_class = "STANDARD"`, `force_destroy = true`, `versioning_enabled = false`,
- `public_access_prevention = "enforced"`.

List the bucket after deployment:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
gcloud storage ls gs://<data-bucket>/          # bucket name is in the platform Outputs
```

> **SQLite locking note.** SQLite relies on filesystem locks. A block PVC (GKE default)
> provides reliable POSIX locking; GCS FUSE (Cloud Run) is the pragmatic single-instance
> option. Either way, PocketBase must run as **one instance** (`max_instance_count = 1`) —
> concurrent writers against one SQLite file corrupt data.

---

## 6. Health probe behaviour

Both variants default their startup and liveness probes to **`/api/health`** — PocketBase's
public, unauthenticated health endpoint, which returns HTTP `200` once the server is ready.
Because there is no external database to wait on, first boot is fast; the default startup
probe uses a 15-second initial delay with a 10-retry window, which is comfortable for
SQLite initialization.

Verify it directly once the service is up:

```bash
curl -s "$SERVICE_URL/api/health"      # {"code":200,"message":"API is healthy.", ...}
```

---

For the PocketBase-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[PocketBase_GKE](PocketBase_GKE.md)** and **[PocketBase_CloudRun](PocketBase_CloudRun.md)**.
