---
title: "Chatwoot Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Chatwoot module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Chatwoot Common — Shared Application Configuration

`Chatwoot_Common` is the **shared application layer** for Chatwoot. It is not
deployed on its own; instead it supplies the Chatwoot-specific configuration
that both [Chatwoot_GKE](Chatwoot_GKE.md) and [Chatwoot_CloudRun](Chatwoot_CloudRun.md)
build on, so the two platform variants behave identically where it matters.
End users never configure this layer directly — it has no deployment UI
inputs of its own — but understanding what it provides explains the defaults
you see in the platform docs.

For the infrastructure that actually provisions and runs Chatwoot, see the
platform guides ([Chatwoot_GKE](Chatwoot_GKE.md), [Chatwoot_CloudRun](Chatwoot_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Chatwoot_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `SECRET_KEY_BASE` (64-char random string) and stores it in **Secret Manager** | Injected automatically into both the app container and the `chatwoot-prepare` init job |
| Container image | Wraps the official `chatwoot/chatwoot` image with a custom entrypoint script; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine (`database_type = "POSTGRES_15"`) | §Database in the platform guides |
| Database bootstrap | Defines two chained first-deploy jobs (`db-init` → `chatwoot-prepare`) that create the database, user, grants, `pgvector`/other extensions, and the Rails schema | `initialization_jobs` output |
| Object storage | Declares a `storage`-suffixed **Cloud Storage** bucket | `storage_buckets` output |
| Core settings | Sets the baseline Rails/Chatwoot environment: `RAILS_ENV`, logging to stdout, DB pool sizing, self-signup default | Application behaviour in the platform guides |
| Health checks | Supplies the default readiness probe (and the pass-through startup/liveness probe defaults) targeting `/` | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

One secret is generated automatically and stored in Secret Manager — it is
never set in plain text and must never change after the first deployment:

- **`SECRET_KEY_BASE`** — a 64-character random string (`random_password`,
  `special = false`). Rails uses it to sign and verify session cookies and to
  derive the key that encrypts ActiveRecord-encrypted columns. The value is
  shared identically between the Rails web process and the co-located
  Sidekiq worker (both run in the same container) and is also injected into
  the `chatwoot-prepare` initialization job so schema preparation uses the
  same key. Rotating it after first boot invalidates every existing signed
  session/cookie and makes any ActiveRecord-encrypted data permanently
  unreadable; Sidekiq will also fail to decrypt jobs the web process already
  enqueued.

Retrieve the secret after deployment:

```bash
# List secrets for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"

# Read the secret version:
gcloud secrets versions access latest --secret=secret-<resource-prefix>-chatwoot-secret-key-base --project "$PROJECT"
```

The database password is generated and managed separately by the foundation;
its secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

A companion `cleanup_orphaned_secrets` submodule call ensures the
`secret-key-base` secret is removed on teardown rather than left orphaned in
Secret Manager.

---

## 3. Database engine and bootstrap

Chatwoot requires **PostgreSQL 15**; the engine is fixed
(`database_type = "POSTGRES_15"`) and other engines are not supported —
Chatwoot's schema and its `pgvector`-backed AI/search features depend on it.
Database setup runs as **two chained jobs** rather than a single init job:

1. **`db-init`** (image `postgres:15-alpine`, `execute_on_apply = true`):
   - Resolves the target host from `DB_HOST` (Cloud SQL socket directory on
     Cloud Run, or the proxy loopback on GKE), falling back to `DB_IP` or
     `127.0.0.1`.
   - Waits for PostgreSQL to accept connections.
   - Creates the application role if absent, or updates its password if it
     already exists (`CREATEDB` privilege granted either way).
   - Creates the application database if it does not already exist. The
     database is **not** owned by the app role — Cloud SQL's `postgres` login
     cannot `SET ROLE` to it — so ownership stays with `postgres` and access
     is granted explicitly instead.
   - Grants full privileges on the database and the `public` schema to the
     app user.
   - Grants the `cloudsqlsuperuser` role to the app user, so Chatwoot's own
     `CREATE EXTENSION` calls (issued later by `db:chatwoot_prepare`) succeed
     — the app role is not a true Postgres superuser on Cloud SQL and would
     otherwise hit `must be superuser`.
   - Pre-creates `vector`, `pg_stat_statements`, `pg_trgm`, and `pgcrypto`
     defensively (belt-and-suspenders — Chatwoot's `schema.rb` also tries to
     create them itself).
   - Signals the Cloud SQL Auth Proxy sidecar to shut down
     (`POST http://127.0.0.1:9091/quitquitquit`) so the job pod completes.
2. **`chatwoot-prepare`** (`depends_on_jobs = ["db-init"]`, uses the **built
   Chatwoot app image**, not a generic client image, `execute_on_apply =
   true`):
   - Maps the Foundation's `DB_*` vars onto Chatwoot's `POSTGRES_*`
     convention, with a Cloud-Run-specific twist: if `DB_HOST` is a socket
     path (leading `/`) **and** `DB_IP` is also present, it prefers `DB_IP`
     over TCP with `PGSSLMODE=require`, because the Cloud SQL Unix socket
     does not always materialise inside a Cloud Run Job in time. It only uses
     the literal socket path when `DB_IP` is unset; on GKE it uses the proxy
     sidecar's `127.0.0.1`.
   - Sets a harmless fallback `REDIS_URL` (`redis://localhost:6379`) if
     neither `REDIS_URL` nor `REDIS_HOST` is present, so Rails initializers
     that read it at boot do not fail — the job does not actually need Redis.
   - Runs `bundle exec rails db:chatwoot_prepare` (Chatwoot's own idempotent
     create-or-migrate task) to build/upgrade the schema and seed defaults.
   - Signals the Cloud SQL Auth Proxy sidecar to shut down the same way.

There is no in-container migration step — schema creation/upgrade is entirely
handled by these two jobs before the long-running app container is expected
to serve traffic. Both jobs are safe to re-run. Inspect the database
directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment
outputs.

---

## 4. Container image and entrypoint

The custom image (`Dockerfile`) wraps `chatwoot/chatwoot:${APP_VERSION}`:

- Switches to `USER root` — matching the upstream image, whose `/app` and
  `/app/tmp` are root-owned and mode 755 (not group-writable). Rails'
  `create_tmp_directories` step (`mkdir /app/tmp/cache`, `/app/tmp/pids`,
  ...) needs root to succeed; a non-root uid hits `Permission denied` and the
  startup probe fails. Root also avoids GKE Autopilot's containerd
  `CreateContainerError: no users found` for a bare username not present in
  the image's `/etc/passwd`.
- Copies in `entrypoint.sh` as `/usr/local/bin/cloud-entrypoint.sh` and sets
  it as `ENTRYPOINT`, with `CMD ["bundle", "exec", "rails", "s", "-b",
  "0.0.0.0", "-p", "3000"]`.

The entrypoint (POSIX `/bin/sh` — the image ships only busybox `sh`, no
bash) runs before the Rails server starts and is responsible for:

- **Mapping `DB_*` to `POSTGRES_*`** — reads `DB_HOST` (falling back to
  `DB_IP` or `127.0.0.1`), `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` and
  exports them as `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DATABASE`,
  `POSTGRES_USERNAME`, `POSTGRES_PASSWORD` — the Ruby `pg` driver accepts a
  directory path as the host for a Unix-socket connection, so the Cloud SQL
  Auth Proxy socket directory (Cloud Run) is passed through unchanged; on
  GKE the proxy sidecar listens on `127.0.0.1`.
- **Building `REDIS_URL`** — when not already set and `REDIS_HOST` is
  present, constructs it from `REDIS_HOST`/`REDIS_PORT` (defaulting to
  `6379`), including the `REDIS_AUTH` password in the URL when supplied.
  Required for both Sidekiq's job queue and ActionCable's pub/sub backend.
- **Correcting `FRONTEND_URL`** — defaults it to `CLOUDRUN_SERVICE_URL` or
  `GKE_SERVICE_URL` when not already set, so links in emails/notifications
  point at the real, reachable service address.
- **Starting the Sidekiq worker in the background** — runs `bundle exec
  sidekiq -C config/sidekiq.yml &` before exec'ing the Rails web server, so
  web and worker are co-located in the same container/pod (Chatwoot normally
  runs them as separate containers in docker-compose). A `trap` on
  `TERM`/`INT` stops Sidekiq alongside the container so a shutdown does not
  leave an orphaned worker process.
- **Launching the Rails server** — `exec "$@"` runs the Dockerfile's `CMD` as
  the final foreground process.

---

## 5. Core application settings

`Chatwoot_Common` establishes the baseline Chatwoot/Rails environment so the
application comes up correctly on first boot:

- **Environment** — `RAILS_ENV = "production"`, `NODE_ENV = "production"`.
- **Deployment context** — `INSTALLATION_ENV = "docker"`, telling Chatwoot's
  bundled tooling it is running in a container deploy.
- **Logging** — `RAILS_LOG_TO_STDOUT = "true"` and `LOG_LEVEL = "info"` so
  Cloud Logging / GKE captures container output; `RAILS_SERVE_STATIC_FILES =
  "true"` since Chatwoot serves its own compiled assets in production.
- **DB connection pool** — `RAILS_MAX_THREADS = "5"`, sized above typical
  Cloud Run concurrency to avoid `could not obtain a connection from the
  pool` under load.
- **Self-signup** — `ENABLE_ACCOUNT_SIGNUP = "false"` by default: a freshly
  deployed helpdesk should not allow open self-service admin/agent account
  creation. Operators flip this via `environment_variables` (temporarily, to
  create the first admin, or permanently for public signup).
- **Postgres extensions** — `enable_postgres_extensions = true` with
  `postgres_extensions = ["vector"]`, requesting the Foundation's own
  extension-enablement hook create `pgvector` as a defensive second layer
  alongside `db-init.sh`'s explicit `CREATE EXTENSION` calls.
- **MySQL plugins** — explicitly disabled (`enable_mysql_plugins = false`,
  `mysql_plugins = []`); Chatwoot is Postgres-only.

Platform-specific adjustments are minimal here since the entrypoint handles
most divergence at runtime:

- **Cloud Run** — the Cloud SQL Auth Proxy presents a Unix socket
  (`DB_HOST` = socket directory); the entrypoint passes it straight through
  as `POSTGRES_HOST`.
- **GKE** — a `cloud-sql-proxy` sidecar listens on `127.0.0.1:5432`
  (`DB_HOST`/`DB_IP` resolve to loopback); the entrypoint's fallback chain
  (`DB_HOST` → `DB_IP` → `127.0.0.1`) covers both cases identically without
  needing separate Common-layer logic.

---

## 6. Health probe behaviour

The Common module's `readiness_probe` is a fixed **HTTP `GET /`** check with
a 30-second initial delay, 5-second timeout, 10-second period, and 3-retry
failure threshold — the login/onboarding page returns 200 with no auth, so
it needs no credentials to pass. `startup_probe` and `liveness_probe` are
pass-through variables (`var.startup_probe` / `var.liveness_probe`) with
Common-module defaults of HTTP `GET /`, 60-second initial delay, 10-second
timeout, 15-second period, and 30-retry failure threshold for startup
(sized to absorb the `chatwoot-prepare` job completing schema setup ahead of
the app container); liveness uses the same path with a 5-second timeout,
30-second period, and 3-retry threshold.

- **Cloud Run** uses these as the service-level startup/liveness probes
  directly.
- **GKE** uses the same defaults for its startup/liveness probes, plus the
  Common module's own `readiness_probe` at the container level — both target
  `/` since Chatwoot exposes no separate unauthenticated health endpoint.

Because schema preparation (`chatwoot-prepare`) runs entirely in an
initialization job before the app container starts, the generous startup
window mainly needs to cover Rails boot time, not in-container migrations.

---

## 7. Object storage

A dedicated **Cloud Storage** bucket (`name_suffix = "storage"`, `STANDARD`
class, `force_destroy = true`, versioning disabled, `public_access_prevention
= "enforced"`) is declared here and provisioned by the foundation, which also
grants the workload service account access. This is separate from Chatwoot's
uploaded-attachment storage, which by default lives on NFS
(`/opt/chatwoot/storage`) rather than in this GCS bucket. List it with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~chatwoot"
```

---

For the Chatwoot-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Chatwoot_GKE](Chatwoot_GKE.md)** and
**[Chatwoot_CloudRun](Chatwoot_CloudRun.md)**.
