---
title: "Medusa Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Medusa module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Medusa Common — Shared Application Configuration

`Medusa_Common` is the **shared application layer** for Medusa. It is not deployed
on its own; instead it supplies the Medusa-specific configuration that both
[Medusa_GKE](Medusa_GKE.md) and [Medusa_CloudRun](Medusa_CloudRun.md) build on, so
the two platform variants behave identically where it matters. Because Medusa has
**no official Docker image**, this layer also owns the from-source build recipe —
a responsibility most `*_Common` modules in this catalogue don't carry, since they
typically wrap a prebuilt upstream image instead. End users never configure this
layer directly — it has no deployment UI inputs of its own — but understanding what
it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Medusa, see the platform
guides ([Medusa_GKE](Medusa_GKE.md), [Medusa_CloudRun](Medusa_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Medusa_Common | Where it surfaces |
|---|---|---|
| From-source image build | Owns the multi-stage Dockerfile that clones `medusajs/dtc-starter` and runs `medusa build` — there is no upstream image to wrap | `container_image` output; `container_build_config` |
| Cryptographic secrets | Generates `JWT_SECRET`, `COOKIE_SECRET` (both mandatory in production), and a bootstrapped admin password, all in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap + 4-stage init chain | Defines `db-init` → `medusa-migrate` → `medusa-verify` → `medusa-admin-create`, each depending on the previous | `initialization_jobs` output |
| Object storage (optional) | When `enable_gcs_storage = true`, provisions a GCS bucket **plus** a dedicated service account and auto-generated HMAC key for Medusa's S3-compatible file provider | `storage_buckets` / `storage_sa_email` outputs |
| Core settings | Sets `MEDUSA_WORKER_MODE = "shared"`, `STORAGE_PROVIDER`, and conditionally `REDIS_URL` / `S3_*` | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/health` | §Observability in the platform guides |

---

## 2. The from-source build

Medusa publishes no official Docker image. `Medusa_Common` sets `image_source =
"custom"` and points Cloud Build at a Dockerfile in `scripts/` with build arg
`MEDUSA_STARTER_REF = "main"` — the branch of the `medusajs/dtc-starter` monorepo
template to clone. Only `apps/backend` (the Medusa server + built-in Admin UI, same
process and port) is built; `apps/storefront`, a separate Next.js storefront app,
is explicitly out of scope for this module.

The build is a two-stage Dockerfile:

1. **Builder** (`node:20-alpine` + git/python3/make/g++ + `pnpm@10`): clones
   `dtc-starter` at `$MEDUSA_STARTER_REF`, `pnpm install --frozen-lockfile` at the
   monorepo root, then `pnpm build` inside `apps/backend`. This produces a
   **self-contained** standalone app at `.medusa/server`, complete with its own
   `package.json`.
2. `.medusa/server` is copied to `/server-build` — a fresh directory with no
   ancestor `pnpm-workspace.yaml` — before `pnpm install --prod` runs there.
3. **Runtime** (`node:20-alpine`, `NODE_ENV=production`): copies in the installed
   build output and `entrypoint.sh`, exposes port 9000.

### Why the copy-to-`/server-build` step exists

`.medusa/server` is produced *inside* `/build`, which — because it's the root of
the cloned monorepo — is itself a pnpm workspace root (it has a
`pnpm-workspace.yaml`). pnpm auto-detects workspace roots by walking up the
directory tree, so a naive `pnpm install --prod` run directly inside
`.medusa/server` while still nested under `/build` silently treats the standalone
build output as part of the *outer* workspace (build logs show `"Scope: all 3
workspace projects"` and an auto-answered "reinstall from scratch?" prompt) and
writes **no `node_modules` at all**. The resulting runtime image had zero
`node_modules` and no `medusa` CLI binary — confirmed locally via `docker run`:
`sh: medusa: not found`. Copying to a directory with no ancestor
`pnpm-workspace.yaml` forces a genuine standalone install. This was caught entirely
via local Docker testing before any cloud deploy was attempted, and is a durable
lesson for any future from-source Dockerfile built on a pnpm/npm workspace
monorepo.

`application_version` does **not** select what gets built — the Dockerfile has no
`ARG` consuming it. Only `MEDUSA_STARTER_REF` (hardcoded to `main`) controls which
branch is cloned, so every build pulls whatever is current on that branch; a fully
pinned, reproducible build requires overriding `container_build_config.build_args`
with a specific tag or commit.

---

## 3. Cryptographic secrets in Secret Manager

Three secrets are generated automatically and stored in Secret Manager:

- **`JWT_SECRET`** — a 32-character random alphanumeric string. Mandatory in
  production; Medusa throws a startup error if it's unset.
- **`COOKIE_SECRET`** — a 32-character random alphanumeric string, same mandatory
  class as `JWT_SECRET`.
- **Admin password** — a 20-character random alphanumeric string, consumed
  directly by the `medusa-admin-create` init job (not injected as a runtime env
  var into the main container). Retrieve it with:

```bash
gcloud secrets versions access latest --secret=<admin-password-secret-id> --project "$PROJECT"
```

The secret ID is surfaced via the `admin_password_secret_id` output of
`Medusa_Common` (and reachable indirectly through the platform deployment). The
database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~jwt-secret OR name~cookie-secret OR name~admin-password"
```

---

## 4. Database engine and the four-stage initialization chain

Medusa requires **PostgreSQL 15**; the engine is fixed and other engines are not
supported. Unlike modules where the app migrates its own schema on boot, Medusa's
migrations are deliberately kept out of the main container's startup path — four
sequential jobs run instead, each depending on the previous:

1. **`db-init`** (`postgres:15-alpine`) — waits for the database, creates the
   application role (`LOGIN`, `CREATEDB`) and database owned by that role, grants
   privileges on the database and `public` schema, and best-effort installs the
   `uuid-ossp` and `postgis` extensions (`postgis` is skipped with a warning if
   unavailable). Signals the Cloud SQL Auth Proxy sidecar to shut down on
   completion.
2. **`medusa-migrate`** — runs `npx medusa db:migrate` directly via the CLI, on the
   already-built Medusa image (2 vCPU / 2Gi, 30-minute timeout, 3 retries).
   **This job originally ran `npm run predeploy`**, following the convention
   mentioned in Medusa's own deployment docs — but the `dtc-starter` template's
   built `package.json` only defines `build`, `start`, `dev`, `lint`, and `test:*`
   scripts; there is no `predeploy` script. `npm run predeploy` failed `Missing
   script: predeploy`, discoverable only via a real Cloud Build + Cloud Run/GKE Job
   execution (local testing with fake DB credentials never reached this far).
   Fixed by invoking the `medusa` CLI directly.
3. **`medusa-verify`** (`postgres:15-alpine`) — a guard job. An init-job failure
   does **not** fail the module apply on its own in this Foundation, so a raced or
   failed `medusa-migrate` could otherwise leave a healthy-looking service pointed
   at an **empty** database. `medusa-verify` connects after `medusa-migrate`,
   counts tables in the `public` schema, and **fails the apply** (loud, not silent)
   if it finds none. Live-verified in production: logged `"public schema has 146
   table(s)"` on a successful deploy.
4. **`medusa-admin-create`** — runs `npx medusa user -e <email> -p <password>` on
   the built image to create the first admin login, using the auto-generated admin
   password secret and `var.admin_email` (default `admin@techequity.cloud`).
   Live-verified: logged `"User created successfully."`.

All four are safe to re-run; inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 5. `entrypoint.sh`

The runtime image's `ENTRYPOINT` runs before `exec "$@"` hands off to `CMD` (or an
init job's `args`):

- **Constructs `DATABASE_URL`** from the platform-injected `DB_HOST` / `DB_IP` /
  `DB_USER` / `DB_PASSWORD` / `DB_NAME` / `DB_PORT`. A Unix-socket `DB_HOST`
  (`enable_cloudsql_volume = true`, Cloud Run) falls back to TCP via `DB_IP` with
  `sslmode=require`, since Medusa's Postgres client needs a URL-authority DSN and a
  socket path's colons break URL parsing. On GKE, a `127.0.0.1`/`localhost`
  `DB_HOST` (the Cloud SQL Auth Proxy sidecar) uses `sslmode=disable` since the
  proxy already TLS-terminates.
- **Constructs `REDIS_URL`** from `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` when not
  already set by `Medusa_Common`'s own config — this is the path taken when
  `redis_host` was left empty and the platform injected the NFS VM IP as
  `REDIS_HOST` instead.
- **Sets `MEDUSA_BACKEND_URL`** from `CLOUDRUN_SERVICE_URL` (Cloud Run) or
  `GKE_SERVICE_URL` (GKE) if not already configured.
- **Sets `MEDUSA_WORKER_MODE=shared`** as a final default.

---

## 6. Core application settings

- **`MEDUSA_WORKER_MODE = "shared"`** (fixed) — a single instance handles both API
  requests and Medusa's background jobs/subscribers/workflows. Medusa's
  officially-recommended split server/worker topology doesn't map cleanly onto a
  single Cloud Run/GKE service, so this module always runs both in one process.
- **`STORAGE_PROVIDER`** — `"s3"` when `enable_gcs_storage = true`, otherwise
  `"local"` (ephemeral container filesystem — uploaded files do not survive a
  restart or redeploy).
- **Redis is required in production.** Medusa logs `"redisUrl not found. A fake
  redis instance will be used."` and boots anyway if Redis is unreachable — this is
  a dev/test fallback, not a supported production mode; there is no documented
  graceful degradation for a long-running deployment without Redis.

---

## 7. Health probe behaviour

The default probes target `/health` — an unauthenticated endpoint. The
`Medusa_Common`-level default is a 60-second initial delay with a 20-failure
threshold; both `Medusa_CloudRun` and `Medusa_GKE` override this to a 120-second
initial delay with a 40-failure threshold (≈12 minutes total), which is the
effective default operators see. Live-verified: `curl /health` returns `OK` (200),
and the running server logs `"Server is ready on port: 9000"`.

---

## 8. Object storage (optional)

When `enable_gcs_storage = true`, a dedicated **Cloud Storage** bucket
(`gcs-<service_name>-storage`, CORS-enabled for `GET`/`PUT`/`POST`/`DELETE`/`HEAD`)
is declared here and provisioned by the foundation. Unlike some other apps in this
catalogue, no manual secret setup is needed: `Medusa_Common` also creates a
dedicated service account and an HMAC access-key/secret-key pair automatically,
stored as `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` secrets and wired straight
into the running container. This is architecturally plausible (GCS's S3-interop
XML API + `forcePathStyle`) per Medusa's S3 file-storage provider shape, but is
**unverified against real Medusa upload traffic** — smoke-test a file upload via
the Admin UI after enabling it.

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Medusa-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform
guides: **[Medusa_GKE](Medusa_GKE.md)** and **[Medusa_CloudRun](Medusa_CloudRun.md)**.
