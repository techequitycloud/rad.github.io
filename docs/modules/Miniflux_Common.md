---
title: "Miniflux Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Miniflux module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Miniflux Common — Shared Application Configuration

`Miniflux_Common` is the **shared application layer** for Miniflux. It is not
deployed on its own; instead it supplies the Miniflux-specific configuration that
both [Miniflux_GKE](Miniflux_GKE.md) and [Miniflux_CloudRun](Miniflux_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of its
own — but understanding what it provides explains the defaults you see in the
platform docs.

For the infrastructure that actually provisions and runs Miniflux, see the platform
guides ([Miniflux_GKE](Miniflux_GKE.md), [Miniflux_CloudRun](Miniflux_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

Miniflux is a minimalist, self-hosted RSS/Atom feed reader — a single static Go
binary that stores **all** state (feeds, entries, users, sessions) in PostgreSQL.
There is no local data directory, no Redis, and no worker/beat split: one process
serves the web UI and runs the feed poller, so a single Cloud Run / GKE container is
the whole app.

| Area | Provided by Miniflux_Common | Where it surfaces |
|---|---|---|
| Admin credential | Generates the initial owner password `ADMIN_PASSWORD` (24-char) and stores it in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Builds a thin wrapper `FROM miniflux/miniflux` with a cloud entrypoint; mirrored/built via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, role, grants, and the `hstore` extension | `initialization_jobs` output |
| Object storage | None — Miniflux keeps every byte of state in PostgreSQL (`storage_buckets` output is empty) | n/a |
| Core settings | Sets the baseline Miniflux environment: schema migrations on boot, admin seeding, listen address, base URL | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness/readiness probes targeting `/healthcheck` | §Observability in the platform guides |

---

## 2. The admin password in Secret Manager

One secret is generated automatically and stored in Secret Manager:

- **`ADMIN_PASSWORD`** — a 24-character random password (letters and digits, no
  special characters). Named `secret-<resource-prefix>-miniflux-admin-password`. On
  first boot the entrypoint sets `CREATE_ADMIN=1` and seeds the initial owner account
  (`ADMIN_USERNAME`, default `admin`) using this password. `CREATE_ADMIN` is
  idempotent — on later boots Miniflux logs "user already exists" and continues, so
  the secret is only consumed once. Changing the account password inside the Miniflux
  UI does **not** update this secret (and vice-versa).

Retrieve the secret after deployment:

```bash
# List the admin password secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~miniflux-admin-password"

# Read the seeded owner password:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Miniflux requires **PostgreSQL** (fixed as `POSTGRES_15`); MySQL or other engines
are not supported. On the first deployment a one-shot job (`db-init`) runs using
`postgres:15-alpine` and idempotently:

1. Resolves the DB host — a Cloud SQL Auth Proxy Unix-socket directory (Cloud Run),
   `127.0.0.1` (the GKE Auth Proxy sidecar), or a private IP — for `psql` access,
2. Waits for PostgreSQL to be reachable,
3. Creates (or reconfigures with `ALTER ROLE`) the `miniflux` application role
   `WITH LOGIN CREATEDB` and the generated password,
4. Creates the `miniflux` database if it does not exist,
5. Grants full privileges on the database and the `public` schema, and re-owns the
   schema to the application role (PostgreSQL 15 no longer grants `CREATE` on
   `public` by default),
6. (Re)creates the **`hstore`** extension **owned by the application role** — an
   important detail: Miniflux runs its own schema migrations as the app role, and
   migration `v119` runs `DROP EXTENSION IF EXISTS hstore`, which requires the caller
   to own the extension. Since PostgreSQL has no `ALTER EXTENSION ... OWNER`, the job
   grants `postgres` membership in the app role, `SET ROLE`s to it, and recreates
   `hstore` so the app role owns it,
7. Signals the Cloud SQL Auth Proxy sidecar to shut down (`/quitquitquit`) so the
   GKE Job pod completes.

The job runs on apply (`execute_on_apply = true`, `max_retries = 3`) and is safe to
re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=miniflux --database=miniflux --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The upstream `miniflux/miniflux` image is a minimal Alpine image (ships `/bin/sh` +
busybox, binary at `/usr/bin/miniflux`, runs as uid `65534`). Miniflux reads a single
`DATABASE_URL`, but the DB password is a runtime Secret Manager value that cannot be
interpolated at plan time — so `Miniflux_Common` builds a **thin wrapper** with a
cloud entrypoint (`cloud-entrypoint.sh`) that composes the connection string at
runtime before executing the binary:

- **Composes `DATABASE_URL`** in libpq **keyword/value** form (Miniflux's native
  connection format — not a `postgres://` URL), so the password needs no URL-encoding
  and a Unix-socket directory works verbatim as `host=/cloudsql/<inst>`. The host is
  branched three ways:
  - a `/…` socket directory (Cloud Run, `enable_cloudsql_volume = true`) →
    `sslmode=disable`,
  - `127.0.0.1` / `localhost` (GKE Auth Proxy sidecar loopback) → `sslmode=disable`,
  - otherwise a private IP → `sslmode=require` (Cloud SQL rejects unencrypted
    private-IP TCP).
- **Sets `RUN_MIGRATIONS=1`** — Miniflux runs its schema migrations on boot, so there
  is **no separate migrate job**.
- **Derives `LISTEN_ADDR`** from Cloud Run's reserved `PORT` env var when present,
  else `0.0.0.0:8080`. (Never set `PORT` yourself — Cloud Run reserves it and rejects
  a user-provided value.)
- **Sets `BASE_URL`** from `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL` for absolute
  links and feed proxying; operators override `BASE_URL` for a custom domain.
- **Sets `CREATE_ADMIN=1`** and hands off to the upstream `/usr/bin/miniflux` command
  with `exec "$@"` as PID 1.

The base-image tag comes from an **app-specific** build ARG (`MINIFLUX_VERSION`), not
the generic `APP_VERSION` — the Foundation injects `APP_VERSION` and would otherwise
clobber a pinned base tag. `:latest` is a valid, maintained Miniflux tag.

---

## 5. Core application settings

`Miniflux_Common` establishes the baseline Miniflux environment so the application
comes up correctly on first boot:

- **Migrations** — `RUN_MIGRATIONS = "1"`: schema is created and upgraded in-process
  on every start.
- **Admin seeding** — `CREATE_ADMIN = "1"` with `ADMIN_USERNAME` (default `admin`)
  and `ADMIN_PASSWORD` from Secret Manager. The owner exists on first boot without
  opening self-service registration.
- **Registration** — `DISABLE_LOCAL_AUTH = "false"` (local username/password login is
  enabled; open self-service signup remains off by default).
- **Port** — the container listens on `8080` (`LISTEN_ADDR`, derived from `PORT`).

No Redis and no GCS bucket are configured — Miniflux stores all feeds, entries, and
sessions in PostgreSQL.

---

## 6. Health probe behaviour

All default probes target **`/healthcheck`** — Miniflux serves an unauthenticated
`200 OK` there once the process is up. `Miniflux_Common` supplies:

- **Startup probe** — HTTP `/healthcheck`, 30-second initial delay, 15-second period,
  30 failure threshold (a generous window that accommodates first-boot schema
  migrations).
- **Liveness probe** — HTTP `/healthcheck`, 30-second period, 3 failure threshold.
- **Readiness probe** — HTTP `/healthcheck`, 10-second period, 3 failure threshold.

Because `/healthcheck` is public and unauthenticated, it is a valid probe target on
both Cloud Run (front-end probe) and GKE (kubelet probe).

---

## 7. Object storage

**None.** Miniflux persists every byte of state — feeds, entries, users, sessions,
and enclosure metadata — in PostgreSQL, so `Miniflux_Common` declares no GCS bucket
(`storage_buckets` returns `[]`). The platform variants still expose an optional NFS
mount for operators who want shared attachment storage, but Miniflux itself does not
require it.

---

For the Miniflux-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[Miniflux_GKE](Miniflux_GKE.md)** and **[Miniflux_CloudRun](Miniflux_CloudRun.md)**.
