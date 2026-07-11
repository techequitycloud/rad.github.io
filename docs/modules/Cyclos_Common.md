---
title: "Cyclos Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Cyclos module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Cyclos Common — Shared Application Configuration

`Cyclos_Common` is the **shared application layer** for Cyclos. It is not deployed on its
own; instead it supplies the Cyclos-specific configuration that both
[Cyclos_GKE](Cyclos_GKE.md) and [Cyclos_CloudRun](Cyclos_CloudRun.md) build on, so the
two platform variants behave identically where it matters. End users never configure this
layer directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Cyclos, see the platform guides
([Cyclos_GKE](Cyclos_GKE.md), [Cyclos_CloudRun](Cyclos_CloudRun.md)) and the foundation
guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Cyclos_Common | Where it surfaces |
|---|---|---|
| Container image | Pins the official `cyclos/cyclos` image and the build config that wraps it | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| PostgreSQL extensions | Declares the six required extensions installed by `db-init` | `initialization_jobs` output |
| Database bootstrap | Defines the first-deploy `db-init` job that creates the user, database, and installs extensions | `initialization_jobs` output |
| GCS file storage | Sets `cyclos.storedFileContentManager = gcs` and derives the bucket name from the resource prefix | `storage_buckets` output; auto-injected env vars |
| Core environment | Injects `DB_HOST`, `DB_PORT`, `CYCLOS_HOME`, and GCS bucket name | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe configuration (HTTP `/api` with extended JVM timeouts) | §Observability in the platform guides |

---

## 2. Database engine and bootstrap

Cyclos requires **PostgreSQL 15**; the engine is fixed and MySQL is not supported.
On the first deployment, a one-shot `db-init` job connects to Cloud SQL using the
`postgres` superuser and idempotently:

1. Creates the Cyclos database user (`cyclos`) with the generated password from Secret
   Manager.
2. Creates the Cyclos application database if absent.
3. Installs all six required PostgreSQL extensions as superuser.
4. Grants the application user full privileges on the database and sets defaults for future
   objects.
5. Signals the Cloud SQL Proxy (when present) to shut down cleanly.

The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=cyclos --database=cyclos --project "$PROJECT"
# Inside psql — confirm extensions:
# \dx
```

The instance, database, and user names are in the platform deployment outputs.

---

## 3. PostgreSQL extensions

The following extensions are installed automatically before Cyclos starts:

| Extension | Purpose |
|---|---|
| `pg_trgm` | Trigram-based text search and similarity matching for member and transaction search |
| `uuid-ossp` | UUID generation functions used for Cyclos entity IDs |
| `cube` | Multi-dimensional cube data type — prerequisite for `earthdistance` |
| `earthdistance` | Geographic distance calculations for location-based features |
| `postgis` | Full geospatial query support |
| `unaccent` | Unicode accent-insensitive text search |

These extensions must be created as the PostgreSQL superuser — the `db-init` job handles
this automatically. You do not need to set `enable_postgres_extensions = true` in the
platform module.

---

## 4. GCS file storage

A dedicated **Cloud Storage** bucket (`<resource_prefix>-cyclos-storage`) is declared here
and provisioned by the foundation. The bucket stores all Cyclos uploaded files, profile
photos, and transaction attachments. Two environment variables are injected automatically:

- `cyclos.storedFileContentManager` → `gcs`
- `cyclos.storedFileContentManager.bucketName` → `<resource_prefix>-cyclos-storage`

NFS is disabled for the Cyclos container — GCS is the only supported file backend for
containerised Cyclos deployments.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name:cyclos-storage"
```

---

## 5. Core application settings

`Cyclos_Common` establishes the baseline Cyclos runtime environment:

- **Database connection** — `DB_HOST` is set to `/var/run/postgresql` (PostgreSQL socket
  path) as a base; platform modules override this with the actual Cloud SQL IP or socket
  path. `DB_PORT` is set to `5432`.
- **Cyclos home** — `CYCLOS_HOME` is set to `/usr/local/cyclos` inside the container.
- **Schema management** — `cyclos.db.managed = true` and `cyclos.db.skipLock = true` are
  baked into `cyclos.properties`, enabling automatic schema creation and evolution on
  startup without distributed locking (required for serverless/Autopilot deployments).
- **Clustering** — defaults to `none` (single instance). Set `cyclos.clusterHandler =
  hazelcast` via `environment_variables` to enable the bundled `hazelcast.xml`
  Kubernetes DNS discovery for multi-pod deployments.

Platform-specific adjustments handled here:

- **Cloud Run** — `DB_HOST` is overridden to the Cloud SQL private IP for direct TCP
  connection (`enable_cloudsql_volume = false` by default).
- **GKE** — `DB_HOST` defaults to the Cloud SQL private IP via direct TCP; the Auth Proxy
  socket path is available if `enable_cloudsql_volume = true`.

---

## 6. Health probe behaviour

The default probes target Cyclos's `/api` endpoint, which returns HTTP 200 only once the
application is fully initialised and the schema is validated. Generous timeouts accommodate
the JVM startup and first-deploy schema creation phase (2–5 minutes).

- **GKE** uses HTTP probes for both startup and liveness — in-cluster probe traffic
  reaches the container directly without routing concerns.
- **Cloud Run** uses a **TCP** startup probe. During a rolling update, a new Cloud Run
  instance needs to acquire Cyclos's database initialisation lock, which the old instance
  still holds. An HTTP probe on `/api` would never pass until Cyclos fully initialises,
  creating a deadlock. A TCP probe succeeds as soon as Tomcat is listening (~32 seconds),
  allowing traffic to shift to the new revision, which sends SIGTERM to the old instance
  and releases the lock. The liveness probe then uses HTTP `/api` to catch any
  uninitialised Spring context and trigger a clean restart.

---

## 7. Container image and Dockerfile

`Cyclos_Common` uses `container_image = "cyclos/cyclos"` with `image_source = "prebuilt"`.
A `Dockerfile` is provided in the `scripts/` directory that wraps the official
`cyclos/cyclos:<version>` image by copying `cyclos.properties` and `hazelcast.xml` into
the container. This allows custom property files to be baked into the image without
modifying the upstream image.

Relevant files in `scripts/`:

| File | Purpose |
|---|---|
| `Dockerfile` | Wraps `cyclos/cyclos:<version>`; copies `cyclos.properties` and `hazelcast.xml` |
| `db-init.sh` | Idempotent PostgreSQL setup script — creates user, database, and installs all six extensions |
| `cyclos.properties` | Primary Cyclos configuration — database pool, schema management, GCS file storage, clustering, logging |
| `hazelcast.xml` | Optional Hazelcast cluster configuration for multi-pod Kubernetes deployments |

---

For the Cyclos-specific, user-facing configuration (variables by group, outputs, and how
to explore each service from the Console and CLI), see the platform guides:
**[Cyclos_GKE](Cyclos_GKE.md)** and **[Cyclos_CloudRun](Cyclos_CloudRun.md)**.
