---
title: "Hasura Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Hasura module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Hasura Common — Shared Application Configuration

`Hasura_Common` is the **shared application layer** for Hasura. It is not deployed on
its own; instead it supplies the Hasura-specific configuration that both
[Hasura_GKE](Hasura_GKE.md) and [Hasura_CloudRun](Hasura_CloudRun.md) build on, so the
two platform variants behave identically where it matters. End users never configure
this layer directly — it has no deployment UI inputs of its own — but understanding
what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Hasura, see the platform
guides ([Hasura_GKE](Hasura_GKE.md), [Hasura_CloudRun](Hasura_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Hasura_Common | Where it surfaces |
|---|---|---|
| Cryptographic secret | Generates `HASURA_GRAPHQL_ADMIN_SECRET` (32-char) and stores it in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `hasura/graphql-engine` image with a custom entrypoint; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | None — Hasura is stateless (`storage_buckets = []`) | `storage_buckets` output |
| Core settings | Sets the baseline Hasura environment: console enabled, server port, the two connection URLs assembled at runtime | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/healthz` | §Observability in the platform guides |

---

## 2. The cryptographic secret in Secret Manager

One secret is generated automatically and stored in Secret Manager — it is never set
in plain text:

- **`HASURA_GRAPHQL_ADMIN_SECRET`** — a 32-character random string (letters and digits,
  no special characters). It grants full access to the GraphQL and metadata APIs
  (`/v1/graphql`, `/v1/metadata`) and to the built-in web console at `/console`.
  Clients present it as the `x-hasura-admin-secret` request header. It is stored under
  the secret ID `secret-<resource-prefix>-hasura-admin-secret`.

Retrieve the secret after deployment:

```bash
# Find the admin secret for this deployment:
gcloud secrets list --project "$PROJECT" --filter="name~admin-secret"

# Read its value (this is your x-hasura-admin-secret):
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Unlike an encryption key, the admin secret does not touch stored data — rotating it is
safe, but it immediately invalidates any client (or n8n/automation workflow) still
sending the old value, so update those consumers in the same change. The database
password is generated and managed separately by the foundation; its secret name is
reported in the platform deployment outputs (`database_password_secret`). See
[App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Hasura requires **PostgreSQL 15**; the engine is fixed and MySQL or other engines are
not supported — Hasura's own metadata catalog and the default connected data source
both live in Postgres. On the first deployment a one-shot job (`db-init`) runs using
`postgres:15-alpine` and idempotently:

1. Detects the Cloud SQL Auth Proxy Unix socket and symlinks it for `psql` access,
2. Waits for PostgreSQL to be reachable (up to 60 retries),
3. Creates (or updates the password of) the application role with `LOGIN`,
4. Creates the application database with that role as owner (if absent),
5. Grants all privileges on the database to the role,
6. Signals the Cloud SQL Auth Proxy to shut down gracefully (`quitquitquit`).

On first startup Hasura installs its own metadata catalog schema into the database
automatically — there is no separate migration job. The `db-init` job is safe to
re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image wraps `hasura/graphql-engine:<version>` with a thin POSIX shell
entrypoint (`hasura-entrypoint.sh`) that runs before `graphql-engine serve`. The base
tag comes from an app-specific `HASURA_VERSION` build ARG (default `v2.36.0`;
`"latest"` is remapped to that pinned tag) — deliberately **not** the generic
`APP_VERSION` that the foundation injects and would otherwise overwrite.

The entrypoint exists because Hasura needs two connection strings and Cloud Run does
not interpolate `$(VAR)` in env values:

- **Assembles `HASURA_GRAPHQL_DATABASE_URL`** (the default connected data source) and
  **`HASURA_GRAPHQL_METADATA_DATABASE_URL`** (where Hasura stores its own metadata)
  from the platform-injected `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
  For a single-database deployment both point at the same database.
- **URL-encodes the password** in pure POSIX shell (RFC 3986 percent-encoding) — the
  Hasura base image ships no node/python/jq, and characters such as `@ : / ? # % & +`
  would otherwise corrupt the DSN.
- **Branches on `DB_HOST`** so the DSN matches how the platform delivers Postgres:
  - a **socket directory** (`/cloudsql/...`, Cloud Run's native Cloud SQL integration)
    → libpq socket form `postgres://user:pass@/db?host=/cloudsql/<inst>`;
  - **`127.0.0.1`/`localhost`** (the GKE cloud-sql-proxy sidecar, TLS already
    terminated) → plain loopback, no `sslmode`;
  - **any other host** (direct private-IP TCP) → `?sslmode=require` (Cloud SQL rejects
    unencrypted private-IP connections).
- **Sets `HASURA_GRAPHQL_ENABLE_CONSOLE = "true"`** and binds
  `HASURA_GRAPHQL_SERVER_PORT = 8080`, then `exec graphql-engine serve` as PID 1.

`HASURA_GRAPHQL_ADMIN_SECRET` is injected by the platform from Secret Manager and read
directly from the environment by the engine — no mapping needed.

---

## 5. Core application settings

`Hasura_Common` establishes the baseline Hasura environment so the application comes up
correctly on first boot:

- **Console** — `HASURA_GRAPHQL_ENABLE_CONSOLE = "true"`; the admin console is served
  at `/console`, gated by the admin secret. Set it to `"false"` via
  `environment_variables` in production and manage metadata with the `hasura` CLI.
- **Port** — `HASURA_GRAPHQL_SERVER_PORT = 8080` (the `container_port`).
- **Auth** — `HASURA_GRAPHQL_ADMIN_SECRET` protects the GraphQL and metadata APIs and
  the console; `/healthz` remains public for probes.
- **Resources** — `cpu_limit = "1000m"`, `memory_limit = "512Mi"` by default; raise
  memory for high query concurrency or large metadata.
- **No storage** — Hasura is stateless; `storage_buckets` returns an empty list.

Platform-specific adjustments handled here:

- **Cloud Run** — the entrypoint builds the socket-form or private-IP DSN and enables
  scale-to-zero-safe operation (all state is external).
- **GKE** — the entrypoint targets the Auth Proxy sidecar on `127.0.0.1` (plain
  loopback, no SSL); the admin secret is CSI-mounted into the namespace.

Additional plain-text environment variables passed through the platform's
`environment_variables` input are merged on top of these defaults (for example
`HASURA_GRAPHQL_DEV_MODE`, `HASURA_GRAPHQL_CORS_DOMAIN`, or
`HASURA_GRAPHQL_UNAUTHORIZED_ROLE`).

---

## 6. Health probe behaviour

The default probes target **`/healthz`** — Hasura's public, unauthenticated health
endpoint that returns `200 OK` once the engine has started and connected to Postgres.
Because `/v1/graphql`, `/v1/metadata`, and `/console` all require the admin secret,
pointing a probe at any of them returns 401 and the workload never becomes Ready —
`/healthz` is the correct target.

- **Cloud Run** uses HTTP probes on `/healthz` with a 30-second initial delay and a
  30-retry startup window (accommodating first-boot metadata catalog installation).
- **GKE** uses the same `/healthz` HTTP probes (startup `failure_threshold = 30`,
  liveness `failure_threshold = 3`).

---

## 7. Object storage

Hasura stores **all** state — metadata, schema, and data — in PostgreSQL. There is no
file-storage requirement, so `storage_buckets` is an empty list and no GCS bucket is
provisioned. Event-trigger payloads and query results are not persisted to object
storage.

---

For the Hasura-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Hasura_GKE](Hasura_GKE.md)** and **[Hasura_CloudRun](Hasura_CloudRun.md)**.
