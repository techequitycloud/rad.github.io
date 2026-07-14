---
title: "CalCom Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the CalCom module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# CalCom Common — Shared Application Configuration

`CalCom_Common` is the **shared application layer** for Cal.com. It is not deployed
on its own; instead it supplies the Cal.com-specific configuration that both
[CalCom_GKE](CalCom_GKE.md) and [CalCom_CloudRun](CalCom_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

Cal.com is an open-source, AGPL-licensed scheduling platform (the self-hosted
Calendly alternative), built with **Next.js** and **Prisma** on **PostgreSQL**. For
the infrastructure that actually provisions and runs Cal.com, see the platform
guides ([CalCom_GKE](CalCom_GKE.md), [CalCom_CloudRun](CalCom_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by CalCom_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY` (each a 32-char random string) and stores them in **Secret Manager** | Injected automatically as container secret env vars; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `calcom/cal.com` image with a thin custom entrypoint; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** (`POSTGRES_15`) as the database | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the role, database, and grants | `initialization_jobs` output |
| Schema migrations | Delegates schema creation to the image's own start script, which runs `prisma migrate deploy` on every boot | Application behaviour in the platform guides |
| Core settings | Assembles `DATABASE_URL`/`DATABASE_DIRECT_URL` at runtime and defaults `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL` to the public service URL | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/` | §Observability in the platform guides |

Cal.com stores all application data — users, event types, bookings, and connected
calendar/OAuth credentials — in PostgreSQL, so **no dedicated GCS uploads bucket is
declared** (`storage_buckets` is empty).

---

## 2. Cryptographic secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager — they are
never set in plain text and must never be changed after the first deployment:

- **`CALENDSO_ENCRYPTION_KEY`** — a 32-character random string. Cal.com uses it to
  encrypt sensitive stored data, in particular the OAuth tokens and API keys for
  connected calendars and app integrations. Rotating it after first boot renders all
  previously encrypted credentials undecryptable — every calendar connection and
  integration must be re-authorised.
- **`NEXTAUTH_SECRET`** — a 32-character random string. Used by NextAuth.js to sign
  and encrypt session tokens/JWTs. Rotating it immediately invalidates all active
  sessions, forcing every user to log in again.

Both are consumed as **container secret env vars** via the `secret_ids` output (which
the variant wires into `module_secret_env_vars`).

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~nextauth-secret OR name~encryption-key"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Cal.com requires **PostgreSQL** (Prisma with the `pg` client); this layer fixes the
engine to **Cloud SQL for PostgreSQL 15**. On the first deployment a one-shot job
(`db-init`) runs using `postgres:15-alpine` and idempotently:

1. Resolves the database host — preferring `DB_IP`, or `127.0.0.1` when the Cloud SQL
   Auth Proxy sidecar is in use (non-SSL loopback),
2. Waits for PostgreSQL to be reachable,
3. Creates (or updates the password of) the application role with `LOGIN` and
   `CREATEDB`,
4. Creates (or reassigns the owner of) the application database,
5. Grants full privileges on the database and the `public` schema (PG15+),
6. Signals the Cloud SQL Auth Proxy to shut down gracefully (`POST /quitquitquit`).

The job only provisions the role and empty database; **the application schema itself
is created by Cal.com's own `prisma migrate deploy`**, which the image's start script
runs on every container boot (see §4). Both steps are idempotent and safe to re-run.

Extension provisioning (`enable_postgres_extensions`) is available but **off by
default** — Cal.com's base schema does not require a superuser-only extension.

Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image is a **thin wrapper** over the official `calcom/cal.com:<version>`
image. The base tag is keyed off an app-specific build ARG, **`CALCOM_VERSION`** —
*not* the generic `APP_VERSION` that the foundation injects and would otherwise
clobber to `latest`. The wrapper adds `curl`/`bash`/`psql` best-effort and installs a
small shell entrypoint (`docker-entrypoint.sh`) that runs before the image's own
start script:

- **Assembles `DATABASE_URL` / `DATABASE_DIRECT_URL`** — builds the Prisma connection
  string from the platform-injected `DB_*` variables, branching on how Cloud SQL is
  delivered:
  - a socket directory path (`/cloudsql/...`, Cloud Run native integration) → libpq
    `?host=<socket>&sslmode=disable`,
  - `127.0.0.1`/`localhost` (GKE Auth Proxy sidecar) → loopback, `sslmode=disable`,
  - a real private IP → `sslmode=require`.
  The username and password are URL-encoded (via `node`).
- **Defaults `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL`** — when still at the image
  default (`http://localhost:3000`), overrides both with the platform-injected
  service URL (`CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`), so NextAuth callbacks and
  the SPA base always use the real public address.
- **Execs the image's start script** (`/calcom/scripts/start.sh` via `CMD`), which
  runs `prisma migrate deploy` and then starts the Next.js server on port
  `${PORT:-3000}`.

`PORT` is a reserved Cloud Run env var (the platform injects it automatically), so the
layer never sets it explicitly.

---

## 5. Core application settings and URL handling

Cal.com **validates its public URL at startup** and refuses to boot on the image's
`http://localhost:3000` default ("Invalid environment variables" → the server 500s
and never becomes Ready). To prevent this, both the module (via `webapp_url`) and the
entrypoint default `NEXT_PUBLIC_WEBAPP_URL` and `NEXTAUTH_URL` to the deterministic
public service URL:

- **Cloud Run** — the variant computes the predicted `run.app` URL
  (`https://<service>-<projnum>.<region>.run.app`) at plan time and passes it as
  `webapp_url`. Cloud Run does not interpolate `$(CLOUDRUN_SERVICE_URL)` in an env
  value, so a computed string is required; the entrypoint additionally corrects it at
  runtime from the injected `CLOUDRUN_SERVICE_URL`.
- **GKE** — the entrypoint sets the URLs from `GKE_SERVICE_URL` at runtime. Set
  `webapp_url` to the external LoadBalancer address or a custom domain once known.

Pin `webapp_url` to a custom domain (e.g. `https://scheduling.example.com`) before
sharing booking links — the value is baked into every generated booking/OAuth URL.

Redis is **optional and off by default** (`enable_redis = false`). When enabled it
acts as Cal.com's cache / rate-limit backend; with no `redis_host` set the module
uses the NFS server VM's IP (which requires `enable_nfs = true`).

---

## 6. Health probe behaviour

The default startup and liveness probes are **HTTP GET `/`** — Cal.com's Next.js
front end responds there once the server has booted and connected to PostgreSQL. The
startup probe uses a generous window (30-second initial delay, 15-second period, up to
30 failures — roughly 8 minutes) to absorb the first-boot `prisma migrate deploy`,
which can take several minutes on a freshly created Cloud SQL instance.

---

## 7. Object storage

Cal.com keeps all state in PostgreSQL and requires no dedicated uploads bucket, so
**`CalCom_Common` declares no GCS buckets** (`storage_buckets` is empty). `enable_nfs`
defaults to `true` to provide an optional shared persistent volume (and to host
co-located Redis when enabled); it is not required for core scheduling functionality.

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Cal.com-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[CalCom_GKE](CalCom_GKE.md)** and **[CalCom_CloudRun](CalCom_CloudRun.md)**.
