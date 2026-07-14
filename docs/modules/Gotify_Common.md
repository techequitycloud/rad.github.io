---
title: "Gotify Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Gotify module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Gotify Common — Shared Application Configuration

`Gotify_Common` is the **shared application layer** for Gotify. It is not deployed
on its own; instead it supplies the Gotify-specific configuration that both
[Gotify_GKE](Gotify_GKE.md) and [Gotify_CloudRun](Gotify_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Gotify, see the platform
guides ([Gotify_GKE](Gotify_GKE.md), [Gotify_CloudRun](Gotify_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Gotify_Common | Where it surfaces |
|---|---|---|
| Admin bootstrap secret | Generates a 24-character admin password and stores it in **Secret Manager** | Injected as `GOTIFY_DEFAULTUSER_PASS`; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `ghcr.io/gotify/server` image with a custom entrypoint; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the engine (Gotify's SQLite mode is not used) | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, role, and grants | `initialization_jobs` output |
| Object storage | Declares **no** buckets — Gotify keeps all messages in PostgreSQL | `storage_buckets` output (empty) |
| Core settings | Sets the baseline Gotify environment: database dialect/connection, server port, default admin user | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/health` | §Observability in the platform guides |

---

## 2. The admin secret in Secret Manager

A single secret is generated automatically and stored in Secret Manager:

- **Admin password** — a 24-character random password (no special characters, so it
  is shell- and URL-safe). It is written to a secret named
  `secret-<resource-prefix>-gotify-admin-password` and injected into the container
  as **`GOTIFY_DEFAULTUSER_PASS`**. Together with `GOTIFY_DEFAULTUSER_NAME=admin`
  (set by the entrypoint), Gotify creates the initial administrator account **on the
  first database initialisation only**. Changing the secret after first boot does not
  reset the admin password — that must be done in the Gotify UI or via the API.

Retrieve the secret after deployment:

```bash
# List the admin-password secret for this deployment:
gcloud secrets list --project "$PROJECT" --filter="name~gotify-admin-password"

# Read it:
gcloud secrets versions access latest \
  --secret="secret-<resource-prefix>-gotify-admin-password" --project "$PROJECT"
```

Gotify has no separate encryption key or JWT secret — it authenticates callers with
**application tokens** and **client tokens** that it generates and stores in its own
`users`/`applications`/`clients` tables. Those tokens are created through the UI or
REST API after first login, not injected by this layer.

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Gotify supports either an embedded SQLite file or an external PostgreSQL server. This
module always uses **PostgreSQL 15** on managed Cloud SQL — the embedded SQLite mode
is never used, so no persistent disk is required for the database. On the first
deployment a one-shot job (`db-init`) runs using `postgres:15-alpine` and
idempotently:

1. Detects the Cloud SQL Auth Proxy Unix socket and symlinks it for `psql` access,
2. Waits for PostgreSQL to be reachable (up to 60 retries),
3. Creates (or updates the password of) the application role,
4. Creates the application database with that role as owner,
5. Grants full privileges on the database to the role,
6. Signals the Cloud SQL Auth Proxy to shut down gracefully.

Gotify then applies its **own schema** via GORM auto-migration on first application
startup — there is no separate migration job. The `db-init` job is safe to re-run.
Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image wraps `ghcr.io/gotify/server:<version>` with a thin shell entrypoint
(`gotify-entrypoint.sh`) that runs before the Go server starts. Because Gotify
publishes numeric tags (e.g. `2.9.1`) and the foundation injects `APP_VERSION` into
the build args, the Dockerfile uses an app-specific **`GOTIFY_VERSION`** build ARG
(which the foundation does not inject); `application_version = "latest"` maps to the
pinned base `2.9.1` so a fresh build never resolves a bad tag.

The entrypoint:

- **Maps `DB_*` onto `GOTIFY_DATABASE_*`** — the platform injects standard `DB_HOST`,
  `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` variables; the entrypoint sets
  `GOTIFY_DATABASE_DIALECT=postgres` and builds `GOTIFY_DATABASE_CONNECTION` as a
  GORM `key=value` DSN (`host=… port=… user=… password='…' dbname=… sslmode=disable`).
  The `lib/pq` driver accepts the Cloud SQL Auth Proxy socket **directory** as the
  `host=` value, so the same mapping works on Cloud Run (socket dir) and GKE
  (`127.0.0.1` via the proxy sidecar).
- **Sets the server port** — `GOTIFY_SERVER_PORT=80`.
- **Sets the default admin user** — `GOTIFY_DEFAULTUSER_NAME=admin` (the password
  comes from the injected `GOTIFY_DEFAULTUSER_PASS` secret).
- **Launches the server** — `exec /app/gotify-app` as PID 1.

Discrete env values need no URL-encoding (only URL-form DSNs do), so the password is
passed verbatim inside single quotes; `sslmode=disable` is correct because the socket
is local and the Auth Proxy terminates TLS upstream.

---

## 5. Core application settings

`Gotify_Common` establishes the baseline Gotify environment so the application comes
up correctly on first boot:

- **Database** — `GOTIFY_DATABASE_DIALECT = "postgres"`; connection assembled from the
  injected `DB_*` variables at runtime.
- **Port** — `GOTIFY_SERVER_PORT = "80"`; the container listens on port 80.
- **Default admin** — `GOTIFY_DEFAULTUSER_NAME = "admin"` with the generated
  `GOTIFY_DEFAULTUSER_PASS`, applied on the first initialisation only.

Any additional `GOTIFY_*` setting (stream ping period, upload limits, CORS, and so
on) can be supplied through the platform `environment_variables` input without
touching this layer.

---

## 6. Health probe behaviour

The default probes target **`/health`** — Gotify's public, unauthenticated health
endpoint, which returns `{"health":"green","database":"green"}` once the server is
up and connected to PostgreSQL. A generous startup window (`initial_delay_seconds =
30`, `failure_threshold = 30`, `period_seconds = 10`) accommodates the GORM
auto-migration that runs on first boot against a fresh database.

- **Cloud Run** uses HTTP startup and liveness probes against `/health`.
- **GKE** uses HTTP startup and liveness probes against `/health` with the same
  headroom.

The REST send API (`/message`) and the receive WebSocket (`/stream`) both require a
token, so they are not used for health checks.

---

## 7. Object storage

Gotify stores messages, applications, and client tokens in PostgreSQL, so
**no Cloud Storage bucket is declared** here (`storage_buckets` is empty). Gotify's
optional on-disk store for uploaded application images and plugins is not persisted
by default; enable NFS or a GCS Fuse volume at the platform layer if you rely on it.

---

For the Gotify-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Gotify_GKE](Gotify_GKE.md)** and **[Gotify_CloudRun](Gotify_CloudRun.md)**.
