---
title: "MaybeFinance Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the MaybeFinance module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# MaybeFinance Common — Shared Application Configuration

`MaybeFinance_Common` is the **shared application layer** for Maybe (Maybe
Finance), the open-source personal-finance web app built on Ruby on Rails. It
is not deployed on its own; instead it supplies the Maybe-specific
configuration that both [MaybeFinance_GKE](MaybeFinance_GKE.md) and
[MaybeFinance_CloudRun](MaybeFinance_CloudRun.md) build on, so the two
platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own —
but understanding what it provides explains the defaults you see in the
platform docs.

For the infrastructure that actually provisions and runs Maybe, see the
platform guides ([MaybeFinance_GKE](MaybeFinance_GKE.md),
[MaybeFinance_CloudRun](MaybeFinance_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by MaybeFinance_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `SECRET_KEY_BASE` (64-character random string) and stores it in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `ghcr.io/maybe-finance/maybe` image with a custom entrypoint script; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** (`POSTGRES_15`) as the configured engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, grants, and pre-creates `pgcrypto`; a second job (`maybefinance-migrate`) runs `rails db:prepare` | `initialization_jobs` output |
| Object storage | Declares a **Cloud Storage** `storage` data bucket | `storage_buckets` output |
| Core settings | Sets the baseline Rails/Maybe environment: production mode, self-hosted UI, logging, thread pool, TLS handling | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/up`, plus an inert `readiness_probe` block the Foundation does not consume | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

One secret is generated automatically and stored in Secret Manager — it is
never set in plain text and must never be changed after the first
deployment:

- **`SECRET_KEY_BASE`** — a 64-character random string (`random_password`,
  `special = false`), shared identically by the Rails web process and the
  co-located Sidekiq worker (mirrors the InvoiceNinja `APP_KEY` pattern).
  Rails uses it to sign sessions/cookies and to derive the key that encrypts
  ActiveRecord-encrypted columns. Rotating it after first boot invalidates
  every active session (forcing all users to log back in) **and** makes
  existing ActiveRecord-encrypted data permanently unreadable — there is no
  re-encryption path.

The secret is created only after `google_project_service.secretmanager` is
enabled and a `cleanup_orphaned_secrets` pass runs; the module's `config`
output additionally depends on a 30-second `time_sleep.wait_for_secrets` so
the secret version is guaranteed to exist before Cloud Run/GKE consumes it.

Retrieve the secret after deployment:

```bash
# List the secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"

# Read the secret version:
gcloud secrets versions access latest --secret=secret-<prefix>-maybefinance-secret-key-base --project "$PROJECT"
```

The database password is generated and managed separately by the foundation;
its secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

---

## 3. Database engine and bootstrap

The `config` output fixes `database_type = "POSTGRES_15"` (Maybe requires
PostgreSQL 12+; the platform variants further restrict this at plan time to
`POSTGRES_13`/`14`/`15`/`NONE`, rejecting MySQL). `enable_postgres_extensions`
is left `false` and `postgres_extensions` empty — deliberately, because
`db-init.sh` already pre-creates the one extension Maybe's schema needs
(`pgcrypto`) via a superuser grant, so the Foundation's own extension hook
would be redundant.

On the first deployment, two chained jobs run:

1. **`db-init`** (`postgres:15-alpine`, `execute_on_apply = true`,
   `max_retries = 1`, `timeout_seconds = 600`) — idempotently:
   - Resolves the target host: prefers `DB_HOST`, falling back to `DB_IP`,
     then `127.0.0.1`; if `DB_HOST` turns out to be a Cloud SQL socket
     directory (leading `/`), it falls back to `DB_IP` over TCP instead
     (`psql` over a private IP needs SSL regardless of the socket mount).
   - Sets `PGSSLMODE=disable` on loopback (`127.0.0.1`/`localhost`) or
     `PGSSLMODE=require` against a real private IP.
   - Waits for PostgreSQL to accept connections.
   - Creates (or updates, via `ALTER ROLE`) the application role with
     `LOGIN CREATEDB` and the generated password.
   - Creates the application database if it does not already exist (owned by
     `postgres`, since Cloud SQL's `postgres` user cannot `SET ROLE` to an
     application role).
   - Grants full privileges on the database and the `public` schema to the
     application role.
   - **Grants `cloudsqlsuperuser` to the application role** — Cloud SQL's app
     users are not real superusers, so this is what lets Maybe's own
     migration create Postgres extensions later without failing on
     `must be superuser`.
   - Pre-creates `pgcrypto` (`CREATE EXTENSION IF NOT EXISTS pgcrypto`) as a
     belt-and-suspenders step, so a later `CREATE EXTENSION IF NOT EXISTS` in
     the app's own schema load is a privilege-free no-op.
   - Signals the Cloud SQL Auth Proxy sidecar to shut down
     (`/quitquitquit`) so the Job pod can complete.
2. **`maybefinance-migrate`** (`image = null`, reuses the built Maybe app
   image; `depends_on_jobs = ["db-init"]`; `memory_limit = 2Gi`,
   `max_retries = 3`, `timeout_seconds = 1200`) — resolves the same DB
   host/sslmode logic as the runtime entrypoint, then runs
   `bundle exec rails db:prepare` (Rails' idempotent create-or-migrate task)
   from `/rails` (or `/app` as a fallback), and signals the Auth Proxy to
   shut down afterward.

Both jobs are safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment
outputs.

---

## 4. Container image and entrypoint

The custom image (`scripts/Dockerfile`) is a thin wrapper `FROM
ghcr.io/maybe-finance/maybe:${MAYBE_VERSION}` — the base tag is driven by an
**app-specific** build ARG (`MAYBE_VERSION`), not the Foundation's generic
`APP_VERSION` (which is injected into `build_args` and would otherwise win
the merge). `MaybeFinance_Common` maps `application_version == "latest"` to
the pinned `"stable"` release channel so builds stay reproducible. The build
switches to `USER root` only long enough to copy in the entrypoint script,
then restores the image's own unprivileged `rails` user and `WORKDIR /rails`.
`enable_image_mirroring = true` is fixed, since `ghcr.io/maybe-finance/maybe`
is a prebuilt image that must be mirrored into Artifact Registry before the
wrapper build runs.

`entrypoint.sh` (installed as `/usr/local/bin/cloud-entrypoint.sh`, the
image's `ENTRYPOINT`) runs before `bundle exec rails server` starts, and is
responsible for:

- **Mapping `DB_*` to Maybe's discrete Rails DB env** — the platform injects
  `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_IP`; the
  entrypoint resolves the effective host (`DB_HOST`, falling back to `DB_IP`,
  then `127.0.0.1`) and exports `POSTGRES_DB`/`POSTGRES_USER`/
  `POSTGRES_PASSWORD`, since Maybe's `config/database.yml` reads those
  discrete variables rather than a URL-style DSN.
- **Correcting a socket-style `DB_HOST`** — Rails' `pg` driver cannot parse
  the Cloud SQL Unix-socket DSN, so if the resolved host has a leading `/`
  (a socket directory), the entrypoint substitutes `DB_IP` over TCP instead.
- **Picking `PGSSLMODE`** — `disable` when the resolved host is loopback
  (`127.0.0.1`/`localhost`, i.e. the GKE Auth Proxy sidecar), `require`
  otherwise (a real private IP, i.e. Cloud Run without the socket mount).
  This branches on the resolved host, never on "is `DB_IP` set" — `DB_IP` is
  `127.0.0.1` on GKE too.
- **Building `REDIS_URL`** — constructed from `REDIS_HOST`/`REDIS_PORT` (and
  `REDIS_AUTH` if present) when `REDIS_URL` is not already set.
- **Starting Sidekiq in the background** — if `REDIS_URL` resolves non-empty,
  `bundle exec sidekiq &` is launched first (trapped so `TERM`/`INT` also
  stops it), then the Rails web server is `exec`'d in the foreground of the
  *same* container — Maybe is not deployed with a separate
  `additional_services` worker. If `REDIS_URL` is empty, Sidekiq is skipped
  entirely rather than crashing the container.

Schema creation/migration is handled entirely by the `maybefinance-migrate`
initialization job described above; the runtime entrypoint never runs
migrations inline.

---

## 5. Core application settings

`MaybeFinance_Common` establishes the baseline Rails/Maybe environment so the
application comes up correctly on first boot (merged with, and overridable
by, `var.environment_variables`):

- **`RAILS_ENV = "production"`.**
- **`SELF_HOSTED = "true"`** — enables Maybe's self-host UI (first-run admin
  registration through the web UI) and disables SaaS-only integrations. No
  admin password secret is auto-generated; the first visitor to reach the
  deployment claims the initial administrator account.
- **`RAILS_LOG_TO_STDOUT = "true"`, `LOG_LEVEL = "info"`** — so Cloud
  Logging / GKE captures application logs.
- **`RAILS_MAX_THREADS = "5"`** — kept above the platform's default Cloud Run
  concurrency to avoid "could not obtain a connection from the pool" errors
  under load.
- **`RAILS_FORCE_SSL = "false"`, `RAILS_ASSUME_SSL = "false"`** — Cloud Run
  and the GKE load balancer both terminate TLS at the edge and forward plain
  HTTP to the container; forcing SSL would 301-redirect the unauthenticated
  startup probe off `/` and it would never see a 200.
- **`RAILS_SERVE_STATIC_FILES = "true"`** — Maybe serves its own precompiled
  assets in production (no separate CDN/static-file tier).

`enable_cloudsql_volume` defaults to **`false`** in `MaybeFinance_Common`
itself — Rails' `pg` driver cannot parse the Cloud SQL Unix-socket DSN, so the
Common-layer default skips the Auth Proxy sidecar and expects the app to
connect over the instance's private IP with `sslmode=require`. The
`MaybeFinance_CloudRun` variant keeps this `false` default (Cloud Run has no
loopback proxy anyway); the `MaybeFinance_GKE` variant overrides it to `true`
in its own `variables.tf` so pods reach Cloud SQL through the loopback
`cloud-sql-proxy` sidecar instead. Both cases are handled by the same
entrypoint branch described in §4.

`environment_variables` also carries a `db-init`/`maybefinance-migrate`
consequence worth noting: neither job sets `RAILS_ENV`/`SELF_HOSTED`
explicitly except `maybefinance-migrate.sh`, which defaults them
(`RAILS_ENV=production`, `SELF_HOSTED=true`) and points `REDIS_URL` at a
harmless placeholder (`redis://localhost:6379`) if Redis env vars are absent,
since `rails db:prepare` boots the full app but does not need a working Redis
connection.

---

## 6. Health probe behaviour

`MaybeFinance_Common` exposes `startup_probe` and `liveness_probe` as
variables (not hardcoded), both defaulting to **HTTP `GET /up`**:

- **`startup_probe`** — `initial_delay_seconds = 60`, `timeout_seconds = 10`,
  `period_seconds = 15`, `failure_threshold = 30` (roughly 8 minutes of
  headroom after the initial delay, to absorb a slow first boot).
- **`liveness_probe`** — `initial_delay_seconds = 60`, `timeout_seconds = 5`,
  `period_seconds = 30`, `failure_threshold = 3`.

Both platform variants (Cloud Run and GKE) forward these unchanged as the
Foundation's `startup_probe`/`liveness_probe`, so probe behaviour is
identical across platforms for Maybe. The `config` output additionally
includes a `readiness_probe` block (`enabled = true`, HTTP `/up`,
`initial_delay_seconds = 30`, `timeout_seconds = 5`, `period_seconds = 10`,
`failure_threshold = 3`) — but neither `App_CloudRun` nor `App_GKE` reads a
`readiness_probe` key from the application config map (only `startup_probe`
and `liveness_probe` are wired into real resources), so this block is
currently **inert** and has no effect on deployed Cloud Run revisions or GKE
pods.

---

## 7. Object storage

A single **Cloud Storage** bucket (suffix `storage`, `STANDARD` class,
`force_destroy = true`, versioning disabled, `public_access_prevention =
enforced`) is declared here and provisioned by the foundation, which also
grants the workload service account access. It is not mounted into the
container filesystem by default (`gcs_volumes` is empty out of the box), so
it exists as provisioned storage but is inert until explicitly wired up via
`gcs_volumes`. List it with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~maybefinance"
```

---

For the Maybe-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[MaybeFinance_GKE](MaybeFinance_GKE.md)** and
**[MaybeFinance_CloudRun](MaybeFinance_CloudRun.md)**.
