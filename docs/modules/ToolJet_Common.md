---
title: "ToolJet Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the ToolJet module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# ToolJet Common — Shared Application Configuration

`ToolJet_Common` is the **shared application layer** for ToolJet. It is not deployed
on its own; instead it supplies the ToolJet-specific configuration that both
[ToolJet_GKE](ToolJet_GKE.md) and [ToolJet_CloudRun](ToolJet_CloudRun.md) build on,
so the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs ToolJet, see the platform
guides ([ToolJet_GKE](ToolJet_GKE.md), [ToolJet_CloudRun](ToolJet_CloudRun.md)) and
the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by ToolJet_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY` (64 hex chars), and `PGRST_JWT_SECRET` and stores them in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `tooljet/tooljet-ce` image with a custom `cloud-entrypoint.sh`; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Two databases | Defines the first-deploy `db-init` job that creates the metadata DB **and** the second "ToolJet Database", grants the shared `CREATEROLE` role, and resets the `postgrest` schema | `initialization_jobs` output |
| Object storage | Declares **no** data bucket — ToolJet stores apps, datasources, and uploads in PostgreSQL | `storage_buckets` output (`[]`) |
| Core settings | Sets the baseline ToolJet environment: `SERVE_CLIENT`, port 80, `TOOLJET_DB`, signup state, telemetry | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness/readiness probes targeting `/api/health` | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Three secrets are generated automatically and stored in Secret Manager — they are
never set in plain text and **must never be changed after the first deployment**.
They are generated with `random_id` (whose `.hex` output is valid hex — a
`random_password` would emit non-hex alphanumerics and `LOCKBOX_MASTER_KEY` would
fail ToolJet's `\h{64}` validation):

- **`SECRET_KEY_BASE`** — 64 random bytes rendered as 128 hex chars. Signs user
  sessions and cookies. Rotating it after first boot invalidates all active
  sessions, forcing every user to log in again.
- **`LOCKBOX_MASTER_KEY`** — 32 random bytes rendered as exactly 64 hex chars
  (ToolJet requires this length). ToolJet's Lockbox encrypts **all stored datasource
  credentials** and other secrets at rest with this key. Rotating it renders every
  stored datasource credential undecryptable — every connection must be re-entered.
- **`PGRST_JWT_SECRET`** — 32 random bytes rendered as 64 hex chars. Signs the
  internal PostgREST JWTs used by the ToolJet Database feature. Rotating it breaks
  the ToolJet Database query layer until every instance restarts.

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" \
  --filter="name~secret-key-base OR name~lockbox-master-key OR name~pgrst-jwt-secret"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

ToolJet requires **PostgreSQL 15**; the engine is fixed and MySQL or other engines
are not supported. ToolJet uses **two databases on the same Cloud SQL instance**:

1. the **metadata database** (`tooljet`) — apps, datasource configs, users,
   workspaces, sessions; and
2. the **ToolJet Database** (`tooljet_db`) — the built-in no-code database, exposed
   to app queries through an in-container **PostgREST** process.

On the first deployment a one-shot job (`db-init`) runs using `postgres:15-alpine`
and idempotently:

1. Detects the Cloud SQL Auth Proxy Unix socket (or falls back to the private IP)
   and waits for PostgreSQL to be reachable,
2. Creates (or updates) the shared application role **with the `CREATEROLE`
   attribute** — ToolJet's workspace creation runs `CREATE ROLE` for per-workspace
   PostgREST access and fails with *permission denied to create role* without it
   (`CREATEROLE` is a role attribute, not a grantable privilege — membership in
   `cloudsqlsuperuser` does not confer it),
3. Creates **both** databases if missing and grants full privileges on each database
   and its `public` schema,
4. Grants `cloudsqlsuperuser` to the app role so ToolJet can manage the `pgcrypto`
   extension, and pre-creates `pgcrypto` on both databases defensively,
5. **Resets the `postgrest` schema as app-owned** (`DROP SCHEMA IF EXISTS postgrest
   CASCADE; CREATE SCHEMA postgrest AUTHORIZATION <app_user>`) on both databases —
   ToolJet's on-boot `reconfigurePostgrest` runs `GRANT`/`CREATE FUNCTION` as the app
   user, which fails `permission denied for schema postgrest` if the schema is
   `postgres`-owned; the schema holds only PostgREST bootstrap config that ToolJet
   rebuilds immediately, so a clean app-owned reset is safe and idempotent,
6. Signals the Cloud SQL Auth Proxy to shut down gracefully.

The job is safe to re-run. Inspect the databases directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=tooljet --project "$PROJECT"
gcloud sql connect <instance-name> --user=<db-user> --database=tooljet_db --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image is a thin wrapper `FROM tooljet/tooljet-ce:<version>` — the
Dockerfile ARG is **`TOOLJET_VERSION`** (not the generic `APP_VERSION`, which the
foundation injects and would clobber). Its `cloud-entrypoint.sh` runs before the
NestJS server starts:

- **Maps `DB_*` to ToolJet's discrete `PG_*` / `TOOLJET_DB_*`** — the platform
  injects standard `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`; the
  entrypoint translates them to `PG_HOST`/`PG_PORT`/`PG_USER`/`PG_PASS`/`PG_DB`
  (metadata DB) and the matching `TOOLJET_DB_*` vars (second DB). node-pg accepts a
  Cloud SQL socket **directory** as the host, so the socket works verbatim.
- **Composes `PGRST_DB_URI` safely** — PostgREST's DSN is a `user:pass@HOST` URL,
  which cannot hold a socket directory (its colons break URL parsing). The entrypoint
  branches on the host shape: socket directory → libpq `?host=` form, `127.0.0.1`
  (GKE proxy) → plain loopback, private IP → `sslmode=require`. The password is
  URL-encoded.
- **Passes Redis through** — reads the foundation-injected `REDIS_HOST` /
  `REDIS_PORT` / `REDIS_AUTH` directly into ToolJet's BullMQ configuration.
- **Defaults `TOOLJET_HOST` and `PORT`** — `TOOLJET_HOST` (drives generated links and
  OAuth redirect URIs) defaults to the computed service URL; `PORT` defaults to `80`
  so GKE pods bind the port the Service and probes expect (Cloud Run injects `PORT`
  itself).
- **Runs migrations, then execs the server** — `npm run db:migrate:prod` (TypeORM
  `migration:run` for both datasources) runs **before** `exec`-ing the stock ToolJet
  start command. ToolJet's `start:prod` is literally `node dist/src/main` and does
  **not** migrate; without this step the metadata DB stays empty and every DB-backed
  action fails with `relation "user_sessions" does not exist`. The step is idempotent
  (TypeORM records applied migrations).

---

## 5. Core application settings

`ToolJet_Common` establishes the baseline ToolJet environment so the application
comes up correctly on first boot:

- **Serve mode** — `SERVE_CLIENT = "true"`: the compiled React client is served from
  the same NestJS process, so there is no separate nginx/client service. The single
  container listens on **port 80**.
- **ToolJet Database name** — `TOOLJET_DB = "tooljet_db"` names the second database
  the `db-init` job creates and PostgREST serves.
- **Environment** — `NODE_ENV = "production"`.
- **Sign-up** — `DISABLE_SIGNUPS = "true"` by default. A fresh install is not opened
  to self-service registration; operators flip this after creating the first admin.
- **Update check** — `CHECK_FOR_UPDATES = "false"`.

Platform-specific adjustments handled by the entrypoint:

- **Cloud Run** receives `PORT` automatically (= `container_port` = 80); the
  entrypoint's `PORT` default is a no-op there.
- **GKE** is **not** injected `PORT`, so the entrypoint default of `80` is what makes
  the pod bind the Service/probe port instead of ToolJet's built-in default of 3000.

---

## 6. Health probe behaviour

The default startup, liveness, and readiness probes target **`/api/health`** — the
public, unauthenticated ToolJet health endpoint (the `/api/*` surface otherwise
requires auth). The startup probe uses a **generous budget (30 × 15 s)** to absorb
the TypeORM migrations that run on first boot before the server begins listening.

- **Cloud Run** — HTTP startup probe on `/api/health`, 60 s initial delay, 15 s
  period, 30 failures; liveness on `/api/health`, 30 s period.
- **GKE** — the same `/api/health` probes, with the App_GKE infrastructure startup
  probe absorbing scheduling and Auth-Proxy-sidecar startup.

---

## 7. Object storage

`ToolJet_Common` declares **no** Cloud Storage data bucket (`storage_buckets = []`).
ToolJet stores app definitions, datasource configs, and uploaded files in
PostgreSQL, so the container is stateless. Additional buckets or GCS Fuse volumes can
still be declared per-platform via `storage_buckets` / `gcs_volumes` if needed.

---

For the ToolJet-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[ToolJet_GKE](ToolJet_GKE.md)** and **[ToolJet_CloudRun](ToolJet_CloudRun.md)**.
