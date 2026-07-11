---
title: "Kestra Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Kestra module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Kestra Common — Shared Application Configuration

`Kestra_Common` is the **shared application layer** for Kestra. It is not deployed on its own;
instead it supplies the Kestra-specific configuration that both [Kestra_GKE](Kestra_GKE.md)
and [Kestra_CloudRun](Kestra_CloudRun.md) build on, so the two platform variants behave
identically where it matters. End users never configure this layer directly — it has no
deployment UI inputs of its own — but understanding what it provides explains the defaults
you see in the platform docs.

For the infrastructure that actually provisions and runs Kestra, see the platform guides
([Kestra_GKE](Kestra_GKE.md), [Kestra_CloudRun](Kestra_CloudRun.md)) and the foundation
guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Kestra_Common | Where it surfaces |
|---|---|---|
| Admin credential | Generates the Kestra admin password and stores it in **Secret Manager** | Retrieve via Secret Manager (see below) |
| Container image | Builds a custom image wrapping `kestra/kestra` — adds `socat` and a custom entrypoint | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job that creates the database, user, schema, and grants | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** artifact bucket | `storage_buckets` output |
| Core settings | Sets the Kestra environment: PostgreSQL queue/repository, GCS storage, basic auth, Flyway baseline, Micronaut server port | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe configuration (HTTP `/health`, generous startup window) | §Observability in the platform guides |

---

## 2. Admin credential in Secret Manager

The Kestra administrator password is generated automatically (24 characters, no special
characters) and stored as a Secret Manager secret — it is never set in plain text. Retrieve it
after deployment:

```bash
# List secrets and find the admin password:
gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
gcloud secrets versions access latest --secret=<resource_prefix>-admin-password --project "$PROJECT"
```

The default admin username is `admin`. Log in to the Kestra UI with this username and the
retrieved password.

The database password is generated and managed separately by the foundation; its secret name
is reported in the platform deployment outputs (`database_password_secret`). See
[App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Kestra requires **PostgreSQL 15** for both its internal task queue (`KESTRA_QUEUE_TYPE=postgres`)
and flow repository (`KESTRA_REPOSITORY_TYPE=postgres`). MySQL is not supported.

On the first deployment a one-shot `db-init` job runs using `postgres:15-alpine` and
idempotently:

1. Waits for PostgreSQL to be ready via `pg_isready`.
2. Creates the Kestra database user with the generated password (or updates the password if the
   user already exists).
3. Creates the Kestra database with the correct owner (or reassigns it if it exists).
4. Grants all required privileges on the database and public schema.
5. Resets the public schema on fresh deployments that have no Flyway history — Cloud SQL
   pre-installs PostgreSQL extension objects in the public schema, which cause Flyway to refuse
   migration on a "non-empty schema". The reset allows Flyway to apply all migrations cleanly.
6. Signals the Cloud SQL Auth Proxy to shut down via the `quitquitquit` endpoint.

Kestra itself runs Flyway schema migrations on every startup (`FLYWAY_DATASOURCES_POSTGRES_BASELINE_ON_MIGRATE=true`),
so upgrading `application_version` applies schema changes automatically.

Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

---

## 4. Core application settings

`Kestra_Common` establishes the baseline Kestra environment so the application comes up
correctly on first boot:

- **PostgreSQL backends** — `KESTRA_QUEUE_TYPE=postgres` and `KESTRA_REPOSITORY_TYPE=postgres`
  are always set. These cannot be changed without provisioning a different backend.
- **GCS artifact storage** — `KESTRA_STORAGE_TYPE=gcs` and `KESTRA_STORAGE_GCS_BUCKET` are
  set to the auto-provisioned bucket. All flow execution inputs, outputs, and internal storage
  objects are written here.
- **Basic authentication** — `KESTRA_BASICAUTH_ENABLED=true` and
  `KESTRA_BASICAUTH_USERNAME=admin` are always set. The password is injected from Secret
  Manager. Disabling basic auth without a replacement authentication layer exposes the Kestra
  UI and full REST API publicly.
- **Micronaut server** — `MICRONAUT_SERVER_PORT=8080` and `ENDPOINTS_ALL_PORT=8080` ensure
  that Kestra's HTTP server and health endpoints are both accessible on port 8080 for platform
  health probes.
- **Flyway baseline** — `FLYWAY_DATASOURCES_POSTGRES_BASELINE_ON_MIGRATE=true` and
  `FLYWAY_DATASOURCES_POSTGRES_BASELINE_VERSION=0` prevent migration failures on Cloud SQL
  instances whose public schema already contains extension objects.

Platform-specific adjustments handled at the wrapper level:

- **Cloud Run** uses `entrypoint.sh` to bridge the Cloud SQL Unix socket to TCP
  `127.0.0.1:5432` using `socat` before assembling the JDBC connection URL and launching
  `kestra server standalone`. This is necessary because Java JDBC cannot connect via Unix
  sockets natively.
- **GKE** uses the Cloud SQL Auth Proxy sidecar, which already listens on TCP
  `127.0.0.1:5432`. The `entrypoint.sh` socket-bridge logic detects a TCP host and skips the
  `socat` setup.

---

## 5. Health probe behaviour

Both startup and liveness probes target Kestra's `GET /health` endpoint on port 8080, which
returns HTTP 200 once the Micronaut server is fully initialised. Kestra (Java JVM) has a
significantly slower startup than interpreted-language runtimes — the default probe is
deliberately generous:

- **Startup probe** — HTTP `/health`, 30s initial delay, 20s period, 40 failure threshold.
  This allows up to ~14 minutes for first-boot startup (JVM warm-up, Flyway migrations,
  plugin loading).
- **Liveness probe** — HTTP `/health`, 180s initial delay, 30s period, 5 failure threshold.
  Reduces false positives during normal heavy execution bursts.

For Cloud Run, the infrastructure-level startup probe (`startup_probe_config`) defaults to TCP
rather than HTTP. This gives Cloud Run's routing layer a simple port-open signal without
risking a false negative from a slow HTTP response during early JVM startup.

---

## 6. Object storage

A dedicated **Cloud Storage** bucket is declared here (with suffix `-kestra-storage`) and
provisioned by the foundation, which also grants the workload service account access. This
gives Kestra a durable, shared artifact storage backend that persists across restarts and
container replacements. List it with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~kestra-storage"
```

GCS Fuse volumes can optionally be configured in the platform modules to mount additional
buckets directly into the container filesystem, enabling flow scripts to read and write bucket
contents as if they were local files.

---

For the Kestra-specific, user-facing configuration (variables by group, outputs, and how to
explore each service from the Console and CLI), see the platform guides:
**[Kestra_GKE](Kestra_GKE.md)** and **[Kestra_CloudRun](Kestra_CloudRun.md)**.
