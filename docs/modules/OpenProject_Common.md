---
title: "OpenProject Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the OpenProject module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# OpenProject Common — Shared Application Configuration

`OpenProject_Common` is the **shared application layer** for OpenProject. It is
not deployed on its own; instead it supplies the OpenProject-specific configuration
that both [OpenProject_GKE](OpenProject_GKE.md) and
[OpenProject_CloudRun](OpenProject_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs OpenProject, see the
platform guides ([OpenProject_GKE](OpenProject_GKE.md),
[OpenProject_CloudRun](OpenProject_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by OpenProject_Common | Where it surfaces |
|---|---|---|
| Cryptographic secret | Generates `SECRET_KEY_BASE` (64 random bytes → 128 hex chars) and stores it in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `openproject/openproject` all-in-one image with a custom `cloud-entrypoint.sh`; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy jobs (`db-init` → `db-migrate`) that create the role/database and then run `rake db:migrate db:seed` | `initialization_jobs` output |
| Core settings | Sets the baseline OpenProject environment: `RAILS_ENV`, HTTPS mode, STDOUT logging, `good_job` async execution, DB pool sizing | Application behaviour in the platform guides |
| Health checks | Supplies the default **TCP** startup/liveness probes and the HTTP readiness probe (`/health_checks/default`) | §Observability in the platform guides |

---

## 2. The `SECRET_KEY_BASE` secret in Secret Manager

A single secret is generated automatically and stored in Secret Manager — it is
never set in plain text and must never be changed after the first deployment:

- **`SECRET_KEY_BASE`** — 64 random bytes rendered as a 128-character hex string.
  Rails uses it to sign sessions and cookies and to derive the key for encrypted
  database columns. It **must be stable across restarts and redeploys**: rotating it
  after first boot makes every existing session and all encrypted data unreadable.
  The module generates it once (`random_id`) and keeps it in Secret Manager, so it
  survives container recreation, scaling, and redeploys.

Retrieve the secret after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

OpenProject requires **PostgreSQL 15**; the engine is fixed and MySQL or other
engines are not supported. On the first deployment two one-shot jobs run in order:

1. **`db-init`** (using `postgres:15-alpine`) idempotently creates the application
   role and database (owner = the app user), granting the privileges OpenProject
   needs.
2. **`db-migrate`** runs the app's own custom image and executes
   `rake db:migrate db:seed` — creating the full OpenProject schema and seeding the
   default administrator account. It runs at **apply time** with a generous timeout
   (30 minutes) and full CPU, so the web container later boots quickly against an
   already-migrated schema.

Why a dedicated migrate job (rather than migrating on boot): the service runs
**web-only** (`./docker/prod/web`) to avoid the all-in-one image's Apache+Puma port
collision, and web-only skips the supervised seeder the all-in-one entrypoint would
otherwise run. Rails (production) refuses to boot Puma while migrations are pending
("You have N pending migrations" → exit 1 → startup-probe failure), so migrations
must complete *before* the service starts.

The job is **self-verifying and self-healing**:

- It explicitly runs `rake db:migrate` (not `db:schema:load`), because the schema
  purge in `schema:load` would wipe the `pg_trgm` extension and break the GIN
  trigram indexes; `db:migrate` creates `pg_trgm` via `enable_extension` before the
  indexes.
- Before migrating it runs `DROP OWNED BY CURRENT_USER CASCADE` to clear any partial
  tables left by a prior interrupted attempt (OpenProject's squashed
  `AggregatedMigrations` is non-transactional), so every attempt starts clean.
- If the seeder fails, the schema stays unmigrated and service creation fails
  **loudly** on the pending-migration guard — there is no silent empty-DB ship.

The migrate job sets `OPENPROJECT_RAILS__CACHE__STORE = file_store` (OpenProject
defaults its cache to memcached, which is not present in the job; OpenProject
validates this setting against a fixed list `{file_store, memcache, redis}`).

Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image is a thin wrapper `FROM openproject/openproject:<version>`. The
only addition is `cloud-entrypoint.sh`, which runs before the stock startup:

- **Composes `DATABASE_URL` from the Foundation `DB_*` vars.** OpenProject (Rails)
  reads a single URL-form DSN. The entrypoint branches on the resolved host shape and
  URL-encodes the password:
  - **Cloud SQL Unix socket** (`/cloudsql/...`) → libpq socket form
    `postgres://user:pass@/db?host=/cloudsql/<inst>` (the colons in the socket path
    would break a URL authority, so it goes in `?host=`).
  - **Loopback** (`127.0.0.1` — the GKE Auth Proxy sidecar) → plain TCP, no SSL.
  - **Private IP** (Cloud Run default) → `sslmode=require` (Cloud SQL rejects
    unencrypted private-IP TCP).
  This is composed **unconditionally** — the upstream image bakes a default
  `DATABASE_URL` pointing at `127.0.0.1`, so a "don't clobber if set" guard would be
  fatal on Cloud Run, where there is no loopback proxy.
- **Sets `OPENPROJECT_HOST__NAME` and `OPENPROJECT_HTTPS`** so OpenProject builds
  correct absolute URLs behind the platform HTTPS front-end.
- **Execs the stock all-in-one entrypoint + the `CMD`** — on this platform the `CMD`
  is `./docker/prod/web` (Puma only), so `good_job` runs its worker and cron in-process
  via `GOOD_JOB_EXECUTION_MODE = async`.

The image uses an app-specific `OPENPROJECT_VERSION` build ARG (not the generic
`APP_VERSION` the Foundation injects and would clobber). OpenProject publishes only
numeric major tags (16, 15, …) and **no `latest` tag**, so the campaign default
`"latest"` is pinned to the stable major `16`.

---

## 5. Core application settings

`OpenProject_Common` establishes the baseline environment so the application comes up
correctly on first boot:

- **`RAILS_ENV = production`**.
- **`OPENPROJECT_HTTPS = true`** — serve behind the platform HTTPS front-end; combined
  with `OPENPROJECT_HOST__NAME` (set by the entrypoint) this yields correct absolute
  URLs.
- **`RAILS_LOG_TO_STDOUT = true`** — emit logs for Cloud Logging / GKE.
- **`GOOD_JOB_EXECUTION_MODE = async`** — background jobs (emails, notifications,
  scheduled work) run in-process inside the web container. There is **no Redis**:
  `good_job` runs its queue on PostgreSQL, so the module forwards `enable_redis = false`.
- **`RAILS_MAX_THREADS = 5`** — the Rails DB connection pool, kept above concurrency to
  avoid pool timeouts.

Platform-specific database wiring (socket vs. loopback vs. private IP) is handled by
the entrypoint (see §4), driven by whether `enable_cloudsql_volume` is set on the
variant.

---

## 6. Health probe behaviour

OpenProject runs Rails 8, which enforces **Host Authorization** against
`OPENPROJECT_HOST__NAME` and returns `400 Bad Request: Invalid host_name configuration`
to any request whose `Host` header does not match — including the platform's HTTP
health probes, which connect with the pod IP as the `Host`. An HTTP probe therefore
**never passes** even though Puma is healthy and real browser traffic (Host = the
service domain) works fine. The probes are therefore configured as follows:

- **Startup probe: TCP.** Checks only that Puma is listening on the port, sidestepping
  Host Authorization. Because migrations run in the `db-migrate` job (not on boot), the
  container becomes port-ready quickly.
- **Liveness probe:** **TCP on GKE** (GKE supports a TCP liveness probe, so a healthy
  Puma stays alive); **disabled on Cloud Run** (Cloud Run supports only HTTP/gRPC
  liveness probes, and an HTTP one would restart-loop a healthy container).
- **Readiness probe: HTTP `GET /health_checks/default`** — OpenProject's health
  endpoint, evaluated by the platform where the `Host` header is set correctly.

---

## 7. Attachment storage

OpenProject stores work-package attachments on the local filesystem by default, which
is ephemeral on Cloud Run. For **durable** attachments, both variants default to
`enable_nfs = true` and mount Cloud Filestore at `/opt/openproject/storage`
(`OPENPROJECT_ATTACHMENTS__STORAGE__PATH`). Alternatively, configure fog/S3 against a
GCS-compatible endpoint via `OPENPROJECT_FOG_*` environment variables. No dedicated
data bucket is created by this layer.

---

For the OpenProject-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the platform
guides: **[OpenProject_GKE](OpenProject_GKE.md)** and
**[OpenProject_CloudRun](OpenProject_CloudRun.md)**.
