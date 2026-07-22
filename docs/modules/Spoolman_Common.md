---
title: "Spoolman Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Spoolman module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Spoolman Common — Shared Application Configuration

`Spoolman_Common` is the **shared application layer** for Spoolman. It is not
deployed on its own; instead it supplies the Spoolman-specific configuration
that both [Spoolman_GKE](Spoolman_GKE.md) and [Spoolman_CloudRun](Spoolman_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of
its own — but understanding what it provides explains the defaults you see in
the platform docs.

For the infrastructure that actually provisions and runs Spoolman, see the
platform guides ([Spoolman_GKE](Spoolman_GKE.md), [Spoolman_CloudRun](Spoolman_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Spoolman_Common | Where it surfaces |
|---|---|---|
| Container image | `ghcr.io/donkie/spoolman` — official prebuilt image, no custom build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | None needed — the Foundation auto-creates the role/database, and Spoolman migrates itself on boot | No `initialization_jobs` declared |
| Object storage | None — Spoolman keeps all state in Cloud SQL | `storage_buckets` output (always `[]`) |
| Core settings | Sets `SPOOLMAN_DB_TYPE=postgres` and an empty `SPOOLMAN_DB_QUERY` escape hatch | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/api/health` | §Observability in the platform guides |

---

## 2. No cryptographic secrets

Unlike most application modules in this catalogue, `Spoolman_Common` generates
**no** application-specific Secret Manager secrets. Spoolman has no
authentication of its own to bootstrap — there is no admin account, API key, or
encryption key to generate and store. The only credential that exists is the
database password, which is generated and managed entirely by the Foundation
(`App_CloudRun` / `App_GKE`), not by this layer.

```bash
# Confirm no app-specific secrets exist beyond the DB password:
gcloud secrets list --project "$PROJECT" --filter="name~spoolman"
```

See [App_Common](App_Common.md) for the shared secret and Workload Identity
model.

---

## 3. Database engine and bootstrap

Spoolman requires **PostgreSQL 15** in this module; the engine is fixed. No
initialization job is declared — the Foundation auto-creates the Postgres role
and database for `database_type = "POSTGRES_15"`, and Spoolman applies its own
Alembic schema migrations automatically on **every** container start (including
the first). This is a deliberate simplification versus most Common modules in
this catalogue, which need a `db-init` job for role/database creation, grants,
or extension installation — Spoolman needs none of that.

Connection wiring deserves a specific note: Spoolman's SQLAlchemy layer
constructs its database URL via `URL.create()` — a structured object with
discrete `host`/`port`/`username`/`password`/`database`/`query` fields, not a
concatenated connection string. This matters because the Cloud SQL Auth Proxy's
Unix-socket directory path (`/cloudsql/<project>:<region>:<instance>`) contains
colons in the instance connection name, which breaks naive URL-string parsing
in other frameworks (a documented recurring bug class in this catalogue — see
Vikunja and Logto). Spoolman is immune to it: the socket path passes straight
through as the structured `host` field with no parsing at all. Both Cloud Run
(Unix socket) and GKE (cloud-sql-proxy sidecar loopback) therefore connect with
no TLS/`sslmode` configuration required.

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image

`Spoolman_Common` sets `image_source = "prebuilt"` and `container_image =
"ghcr.io/donkie/spoolman"` — no Cloud Build step runs. This is a genuine
upstream prebuilt image; there is no Dockerfile, entrypoint script, or
build-arg version pinning in this module at all. Spoolman listens on port
`8000`.

---

## 5. Core application settings

`Spoolman_Common` establishes the minimum environment needed for Spoolman to
connect to Postgres correctly:

- **`SPOOLMAN_DB_TYPE = "postgres"`** — always injected. Without this, Spoolman
  silently falls back to its bundled default (a container-local SQLite file
  that is wiped on every restart) with **no error at all**. Never omit it.
- **`SPOOLMAN_DB_QUERY = ""`** — an empty escape hatch for extra DSN query
  parameters (e.g. `sslmode=require`). Left blank because both platforms
  connect over a local socket/loopback with no TLS required; only populate it
  if a live deployment needs to force a TCP connection instead.

The `SPOOLMAN_DB_HOST` / `SPOOLMAN_DB_PORT` / `SPOOLMAN_DB_USERNAME` /
`SPOOLMAN_DB_PASSWORD` / `SPOOLMAN_DB_NAME` env vars are **not** set by this
Common layer — they are aliased directly from the Foundation's standard
`DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` via the
`db_*_env_var_name` variables declared in `Spoolman_CloudRun` and
`Spoolman_GKE`.

---

## 6. Health probe behaviour

The default probes target `/api/health` — a public, unauthenticated endpoint
that returns a 200/OK JSON status once the server is fully initialised and
connected to PostgreSQL.

- **Cloud Run** uses HTTP probes targeting `/api/health` with a 10-second
  initial delay.
- **GKE** uses the same HTTP probe target and timing.

---

## 7. Object storage

No GCS bucket is declared — `storage_buckets` always outputs an empty list.
Spoolman keeps all state (spools, filaments, vendors, usage history) in Cloud
SQL PostgreSQL; there is nothing to persist on a separate volume.

---

For the Spoolman-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Spoolman_GKE](Spoolman_GKE.md)** and
**[Spoolman_CloudRun](Spoolman_CloudRun.md)**.
