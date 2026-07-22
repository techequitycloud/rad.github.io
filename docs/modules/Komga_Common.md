---
title: "Komga Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Komga module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Komga Common — Shared Application Configuration

`Komga_Common` is the **shared application layer** for Komga. It is not deployed on
its own; instead it supplies the Komga-specific configuration that both
[Komga_GKE](Komga_GKE.md) and [Komga_CloudRun](Komga_CloudRun.md) build on, so the
two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Komga, see the platform
guides ([Komga_GKE](Komga_GKE.md), [Komga_CloudRun](Komga_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Komga_Common | Where it surfaces |
|---|---|---|
| Authentication | **No generated secrets** — the admin account is created through Komga's first-run setup wizard at `/` | Komga web UI on first access |
| Container image | The official prebuilt `gotson/komga` image, deployed directly (no build step) | `container_image` output of the platform deployment |
| Database engine | **None** — Komga uses an embedded SQLite database (`database.sqlite`, WAL mode) under `/config` (`database_type = "NONE"`) | §Database in the platform guides |
| Database bootstrap | **None** — there is no `db-init` job; Komga manages its own storage and schema (Flyway migrations run automatically on boot) | n/a |
| Object storage | Declares the **Cloud Storage** `storage` bucket that backs `/config` on Cloud Run (and on GKE when the block PVC is disabled) | `storage_buckets` output |
| Core settings | Sets the container port `25600` and, optionally, JVM heap sizing via `JAVA_TOOL_OPTIONS` | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probes targeting `/actuator/health` | §Observability in the platform guides |

---

## 2. Secrets in Secret Manager

Komga has **no injectable service secret**. Unlike database-backed applications, it
does not require an operator-supplied encryption key, admin token, or JWT signing
secret to be created ahead of time — the administrator account is created
interactively through the **first-run setup wizard** the first time you open the
web UI at `/`, and there is no API/CLI path to seed this non-interactively.

As a result both of the Common layer's secret outputs are empty:

- `secret_ids` — `{}` (forwarded to the foundation as `module_secret_env_vars`)
- `secret_values` — `{}` (forwarded as the explicit secret-value map)

They are kept as outputs purely so the CloudRun/GKE wrappers can wire them uniformly
alongside apps that *do* have generated secrets. There is nothing to retrieve from
Secret Manager for a stock Komga deployment; any secrets you add manually via the
platform's `secret_environment_variables` input are the only entries you will find:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~komga"
```

See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Komga does **not** support an external database. All of its state — the library
index, user accounts, reading progress, bookmarks, collections, and settings —
lives in an **embedded SQLite database** (`database.sqlite`, WAL mode) written
under `/config`, alongside the Lucene full-text search index, thumbnail cache,
task queue (`tasks.sqlite`), and logs. Confirmed via a Komga upstream feature
request (issue #1327, open and unimplemented) — there is no external-database
option to enable. Consequently:

- `database_type = "NONE"` — no Cloud SQL instance, database, or user is created
  for Komga.
- There is **no `db-init` job** — Komga runs its own Flyway schema migrations on
  first boot (confirmed via local container logs:
  `org.flywaydb.core.FlywayExecutor`); nothing has to be bootstrapped ahead of
  time.
- No PostgreSQL extensions, no MySQL plugins, and no Redis are involved.

Because the database is a file on the persistent `/config` volume, durability is a
function of the storage backend, not a managed database service (see §5 and §7).
If you need custom data-loading or migration tasks, you can supply your own
`initialization_jobs`; none is provided by default.

---

## 4. Container image

Komga ships a **genuinely prebuilt, multi-arch image** (`gotson/komga`) — confirmed
via local `docker pull` + `docker inspect` (Entrypoint: `java -jar application.jar
--spring.config.additional-location=file:/config/`). No custom Dockerfile or Cloud
Build step is used:

- **`image_source = "prebuilt"`** — the foundation deploys `gotson/komga:<version>`
  directly.
- **`enable_image_mirroring = true`** by default still mirrors the image into
  Artifact Registry via a digest-aware copy (`mirror-image.sh`), avoiding Docker Hub
  rate limits — this is a copy, not a rebuild.
- **`application_version`** is passed straight through as the image tag (e.g.
  `"latest"`, `"1.25.0"`) — no app-specific build ARG is needed, unlike modules
  that wrap an image via a thin custom-build Dockerfile.

---

## 5. Core application settings

`Komga_Common` establishes the minimal environment Komga needs to come up on first
boot and write its state to the persistent volume:

- **Container port `25600`** — Komga serves HTTP on port 25600 by default
  (confirmed via the image's `EXPOSE`), matching the module's `container_port`.
- **Fixed state directory `/config`** — set via the image's own `KOMGA_CONFIGDIR`
  env default (confirmed via `docker inspect`). Komga's configuration, embedded
  SQLite database, Lucene search index, thumbnail cache, task queue, and logs all
  live under this single directory.
- **Optional JVM heap sizing** — `jvm_heap_max` (blank by default), when set,
  injects `JAVA_TOOL_OPTIONS = "-Xmx<value>"`; confirmed respected by the image's
  Eclipse Temurin JVM via local container testing (`Picked up
  JAVA_TOOL_OPTIONS`).
- **No telemetry, queue, or execution-mode settings** — there is nothing further
  to configure at boot; the rest of setup (admin account, libraries) happens
  through the web UI's first-run wizard.

Platform-specific mounting of `/config`:

- **Cloud Run** mounts the `storage` Cloud Storage bucket at `/config` via GCS
  FUSE (`enable_gcs_storage_volume = true`).
- **GKE** with `stateful_pvc_enabled = true` (the default) mounts a block PVC at
  `/config` and sets `enable_gcs_storage_volume = false` to avoid a double-mount
  at the same path (gcsfuse's lack of real file locking would also corrupt Komga's
  SQLite WAL files).

Note that this module persists only Komga's **state** directory. The actual library
content (comics, manga) is expected to be provided through mounted volumes —
additional `gcs_volumes` or an NFS mount — that you then register as libraries
inside the Komga UI.

---

## 6. Health probe behaviour

Both the startup and liveness probes issue an **HTTP GET `/actuator/health`**,
Komga's public, unauthenticated Spring Boot Actuator endpoint that returns
`200 {"status":"UP"}` once the server is serving — confirmed via local container
testing. **Do not** use `/api/v1/actuator/health` — the versioned API prefix is
auth-gated and returns `401 Unauthorized` even when the app is healthy.

- **Startup probe** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`,
  `failure_threshold = 10`.
- **Liveness probe** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`,
  `failure_threshold = 3`.

---

## 7. Object storage

A single **Cloud Storage** bucket is declared here and provisioned by the
foundation, which also grants the workload service account access:

- **`name_suffix = "storage"`**, storage class **STANDARD**, `force_destroy = true`,
  versioning disabled, with `public_access_prevention = "enforced"`.
- The bucket `location` is left empty so the foundation resolves it via the
  auto-discovered deployment region (avoiding a force-replace of the
  immutable-location bucket on a cross-region re-apply).
- On Cloud Run it backs `/config` via GCS FUSE, so it holds Komga's SQLite
  database, Lucene search index, thumbnail cache, task queue, and logs.

List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

**Note on storage type.** Komga's `/config` holds a SQLite database in WAL mode,
which needs real file locking to stay consistent — gcsfuse does not provide this.
On GKE the block PVC (`stateful_pvc_enabled = true`) is the best fit. Cloud Run's
GCS FUSE mount works but has higher latency and weaker consistency guarantees, and
is better suited to light libraries; large libraries and frequent metadata scans
are far happier on the GKE block PVC.

---

For the Komga-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform
guides: **[Komga_GKE](Komga_GKE.md)** and **[Komga_CloudRun](Komga_CloudRun.md)**.
