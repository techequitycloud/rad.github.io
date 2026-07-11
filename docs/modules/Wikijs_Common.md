---
title: "Wikijs Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Wikijs module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Wikijs Common — Shared Application Configuration

`Wikijs_Common` is the **shared application layer** for Wiki.js. It is not deployed on
its own; instead it supplies the Wiki.js-specific configuration that both
[Wikijs_GKE](Wikijs_GKE.md) and [Wikijs_CloudRun](Wikijs_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Wiki.js, see the platform
guides ([Wikijs_GKE](Wikijs_GKE.md), [Wikijs_CloudRun](Wikijs_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Wikijs_Common | Where it surfaces |
|---|---|---|
| Container image | Pins `requarks/wiki:2` and builds a custom image from `scripts/` via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| PostgreSQL extension | Declares `enable_postgres_extensions = true` and `postgres_extensions = ["pg_trgm"]` for Wiki.js full-text search | Foundation install step at deploy time |
| Database bootstrap | Defines the first-deploy `db-init` job that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | Declares the **`wikijs-storage` Cloud Storage bucket** for persistent asset storage | `storage_buckets` output |
| Core settings | Sets the baseline Wiki.js environment (`DB_TYPE`, `DB_PORT`, `DB_USER`, `DB_NAME`, `DB_SSL`, `HA_STORAGE_PATH`) | Application environment variables |
| Health checks | Supplies the default startup/liveness probe targeting `/healthz` with a 60-second initial delay | §Observability in the platform guides |

---

## 2. Container image

`Wikijs_Common` sets `container_image = "requarks/wiki:2"` and
`image_source = "custom"`. Cloud Build is used to build an extended image from the
`Dockerfile` in the `scripts/` subdirectory, which installs Chromium (for PDF export)
and wires in a custom `entrypoint.sh`. The built image is pushed to Artifact Registry.

When `enable_image_mirroring = true` (the default), the upstream `requarks/wiki:2`
image is mirrored from Docker Hub into Artifact Registry before the build, avoiding
Docker Hub rate limits and ensuring build reproducibility.

---

## 3. Database engine and bootstrap

Wiki.js requires **PostgreSQL 15**; the engine is fixed and MySQL is not supported.
On the first deployment a one-shot `db-init` job runs the `postgres:15-alpine` image
and connects to Cloud SQL through the Auth Proxy. It idempotently:

1. Creates the `wikijs` user (or updates the password if the user already exists),
2. Grants the user the necessary roles,
3. Creates the `wikijs` database owned by that user (if absent),
4. Grants all privileges on the database and public schema to the user.

The job then signals the Cloud SQL Proxy sidecar to shut down so the Job completes
cleanly. The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

The `pg_trgm` PostgreSQL extension — required for Wiki.js full-text search — is
installed separately by the foundation after the database is provisioned.

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Core application settings

`Wikijs_Common` establishes the baseline Wiki.js environment so the application comes
up correctly on first boot:

- **Database connectivity** — `DB_TYPE=postgres`, `DB_PORT=5432`, `DB_USER`, `DB_NAME`,
  `DB_SSL=false`. These are pre-populated in `environment_variables` and must not be
  removed. `DB_HOST` is injected at runtime from the Cloud SQL Auth Proxy socket path.
  `DB_PASS` is sourced from Secret Manager and injected via `secret_environment_variables`.
- **Asset storage path** — `HA_STORAGE_PATH=/wiki-storage` tells Wiki.js where to write
  uploaded files and assets. The NFS volume (when `enable_nfs = true`) or GCS Fuse
  volume must be mounted at this same path. Changing `HA_STORAGE_PATH` without also
  changing the volume mount path causes uploads to land on the ephemeral container disk
  and be lost on restart.
- **Container port** — Wiki.js binds on port 3000. This is fixed by `Wikijs_Common`
  and must not be changed.
- **Entrypoint** — `entrypoint.sh` maps platform-standard variable names
  (`DB_PASSWORD` → `DB_PASS`, `DB_IP` → `DB_HOST`) to the names Wiki.js reads
  before handing off to `node server`.

---

## 5. Object storage

A dedicated **Cloud Storage** `wikijs-storage` bucket is declared here and
provisioned by the foundation. The bucket holds persistent Wiki.js assets. To make
the bucket accessible inside the container, configure `gcs_volumes` in the platform
module to mount it at `/wiki-storage`:

```bash
# List the provisioned storage bucket:
gcloud storage buckets list --project "$PROJECT" --filter="name~wikijs"
```

For both the Cloud Run and GKE variants, the bucket is not auto-mounted — you must
explicitly add a GCS Fuse volume entry via `gcs_volumes`. The NFS Filestore share
(`enable_nfs = true`) provides a complementary shared volume for files that need
low-latency access by multiple pods.

---

## 6. Health probe behaviour

Both the startup and liveness probes target `/healthz`, which Wiki.js exposes as a
lightweight endpoint reflecting live application and database connection status. The
probes carry a **60-second initial delay** on both variants to allow time for:

- First-boot: the `db-init` job completes, and then Wiki.js connects and runs its
  own internal schema migration before accepting requests.
- Steady-state: the Node.js process loads all modules before the pod is marked ready.

Do not reduce `initial_delay_seconds` below 30 on new deployments — Wiki.js will be
killed before its database initialisation completes.

---

For the Wiki.js-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Wikijs_GKE](Wikijs_GKE.md)** and **[Wikijs_CloudRun](Wikijs_CloudRun.md)**.
