---
title: "Outline Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Outline module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Outline Common — Shared Application Configuration

`Outline_Common` is the **shared application layer** for Outline. It is not deployed on its own; instead it supplies the Outline-specific configuration that both [Outline_GKE](Outline_GKE.md) and [Outline_CloudRun](Outline_CloudRun.md) build on, so the two platform variants behave identically where it matters. End users never configure this layer directly — it has no deployment UI inputs of its own — but understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Outline, see the platform guides ([Outline_GKE](Outline_GKE.md), [Outline_CloudRun](Outline_CloudRun.md)) and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Outline_Common | Where it surfaces |
|---|---|---|
| Container image | Custom build from `outlinewiki/outline` that adds `bash`, `postgresql-client`, a Corepack-pinned yarn 4, and the platform entrypoint | `container_image` output of the platform deployment |
| Custom entrypoint | Assembles `DATABASE_URL`, `REDIS_URL`, and `URL` from platform-injected variables, waits for PostgreSQL, runs Sequelize migrations, then starts the server | Application behaviour in the platform guides |
| Application secrets | Creates `SECRET_KEY` and `UTILS_SECRET` (64 hex chars each) in **Secret Manager** | `secret_ids` / `secret_values` outputs, injected into the container |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** with the `pg_trgm` extension enabled | §Database in the platform guides |
| Database bootstrap | Defines the `db-init` job (`postgres:15-alpine`) that idempotently creates the database and user | `initialization_jobs` output |
| Object storage | Declares a **Cloud Storage** bucket (suffix `storage`) | `storage_buckets` output |
| Core environment | `FILE_STORAGE=local` on the NFS path, `FORCE_HTTPS=false`, `PGSSLMODE=disable`, and blank `OIDC_*` auth placeholders | Environment of the running container |
| Health checks | Passes through the variants' HTTP `/` startup and liveness probe defaults | §Observability in the platform guides |

---

## 2. Secrets in Secret Manager

Outline requires two random secrets, generated exactly the way upstream recommends (`openssl rand -hex 32` — 32 bytes, 64 hex characters):

- `secret-<prefix>-<app>-secret-key` → **`SECRET_KEY`** — encrypts cookies and sensitive data at rest.
- `secret-<prefix>-<app>-utils-secret` → **`UTILS_SECRET`** — internal API / utilities authentication.

Both are created here and surfaced through the `secret_ids` output, which the platform variants merge into the foundation's `module_secret_env_vars` so the values are injected as secret-backed environment variables (Cloud Run secret refs; a materialised Kubernetes Secret on GKE via `secret_values`). The database password is a third secret, created by the foundation itself.

```bash
gcloud secrets list --project "$PROJECT" --filter="name~outline"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

These values are effectively immutable — regenerating `SECRET_KEY` invalidates existing sessions and encrypted data.

---

## 3. Container image and custom entrypoint

`Outline_Common` builds a customised image from the official `outlinewiki/outline` Docker Hub image via Cloud Build (`image_source = "custom"`). The Dockerfile installs `bash` and `postgresql-client` (needed by the entrypoint), bakes a Corepack-activated **yarn 4** into a world-readable `COREPACK_HOME` (the base image's global yarn 1.x refuses to run in Outline's yarn-4 project), pre-creates the persistent upload directory `/var/lib/outline/data`, and installs `/scripts/entrypoint.sh` before dropping back to the unprivileged `nodejs` user.

The entrypoint performs these actions on every container start:

1. **`DATABASE_URL` assembly.** Builds the Sequelize connection string from the platform-injected `DB_USER`, `DB_PASSWORD` (URL-encoded), `DB_HOST`, `DB_NAME`, and `DB_PORT`. When `DB_HOST` starts with `/` it uses the node-pg socket form (`?host=/cloudsql/…&sslmode=disable` — the Cloud SQL Auth Proxy socket on Cloud Run); `127.0.0.1` (the GKE proxy sidecar) and direct private-IP forms are handled too. An explicit `DATABASE_URL` takes precedence but should never be needed.
2. **`REDIS_URL` assembly.** Uses the foundation-injected `REDIS_URL` when present; otherwise builds one from `REDIS_HOST`/`REDIS_PORT`, falling back to the NFS server IP (the platform co-hosts Redis there).
3. **`URL` (public address).** Prefers an explicitly supplied `URL`; otherwise exports the platform-injected service URL (`CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`).
4. **Database wait.** Polls `pg_isready` (up to 60 × 3 s) before proceeding.
5. **Migrations.** Runs `sequelize db:migrate --env=production-ssl-disabled` by invoking the sequelize-cli binary directly (yarn's workspace preflight fails in the production-pruned image). Because sequelize-cli does not honour node-pg's `?host=<socket>` URL trick, the migration is fed discrete `DATABASE_*` variables with `DATABASE_HOST` set to the socket directory.
6. **Launch.** `exec node build/server/index.js`.

To see what the entrypoint resolved:

```bash
# Cloud Run
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 30 \
  | grep -E "Assembled DATABASE_URL|Set URL|Database is ready|migrations"

# GKE
kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=50 | grep -E "URL|Database|migrat"
```

---

## 4. Database engine and bootstrap

Outline requires **PostgreSQL**; the engine is fixed at `POSTGRES_15` inside `Outline_Common` (with `pg_trgm` enabled for search) and cannot be changed to MySQL. On every apply a one-shot `db-init` job (`postgres:15-alpine`, `execute_on_apply = true`) connects to Cloud SQL and idempotently:

1. Maps the Cloud SQL Auth Proxy socket when present (Cloud Run) and picks the correct `PGSSLMODE` per connection topology (disable on the socket/loopback, require on direct TCP).
2. Creates the application user (or resets its password if it exists).
3. Grants the user's role to `postgres` so ownership can be assigned.
4. Creates the database owned by the application user (or transfers ownership), grants all privileges plus `ALL ON SCHEMA public`.
5. Sends `POST /quitquitquit` to the Cloud SQL Proxy sidecar so the job exits cleanly on GKE.

Inspect the database directly:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

---

## 5. Core environment defaults

`Outline_Common` establishes the baseline environment so the application comes up correctly on first boot:

- **`FILE_STORAGE = local`**, `FILE_STORAGE_LOCAL_ROOT_DIR = /var/lib/outline/data` (25 MiB upload cap) — the directory is backed by the shared NFS volume so uploads persist and are shared across instances.
- **`FORCE_HTTPS = false`** — Outline's default HTTPS redirect would send the plain-HTTP health probes to a port with no listener and crash-loop the container; TLS is terminated upstream (Cloud Run front end, or an operator-supplied LB/cert on GKE).
- **`PGSSLMODE = disable`** — the Cloud SQL Auth Proxy terminates TLS itself.
- **`OIDC_*` placeholders** — `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_AUTH_URI`, `OIDC_TOKEN_URI`, `OIDC_USERINFO_URI` ship **intentionally blank** (`OIDC_DISPLAY_NAME`/`OIDC_SCOPES` are pre-filled). Outline needs a working identity provider to log in at all; with these blank the login page shows **zero providers**. Configuring an IdP is a mandatory operator step post-deploy — see the OIDC walk-through in [Outline_CloudRun](Outline_CloudRun.md) §3, including the remove-then-bind-as-secret gotcha for the client credentials.

Operator overrides supplied via the variants' `environment_variables` merge over these defaults.

---

## 6. Object storage

A dedicated **Cloud Storage** bucket (name suffix `storage`, `STANDARD` class, regional) is declared here and provisioned by the foundation, which also grants the workload service account access. List it with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~outline"
```

Combined with the shared Filestore (NFS) volume, this gives Outline durable storage for uploads that is consistent across all instances.

---

## 7. Health probe behaviour

Both variants default their probes to Outline's root path (`/`), which responds only once migrations have completed and Redis is connected:

- **Startup probe** — HTTP `/`, initial delay 60 s, period 10 s, failure threshold 6 (up to ~2 minutes from container start).
- **Liveness probe** — HTTP `/`, initial delay 60 s, period 30 s, failure threshold 3.

Do not reduce the startup delay: on first boot the entrypoint waits for PostgreSQL and runs all pending Sequelize migrations before the server binds its port. Note the probes only prove the *service* is healthy — sign-in still requires the operator-configured OIDC provider.

---

For the Outline-specific, user-facing configuration (variables by group, outputs, and how to explore each service from the Console and CLI), see the platform guides:
**[Outline_GKE](Outline_GKE.md)** and **[Outline_CloudRun](Outline_CloudRun.md)**.
