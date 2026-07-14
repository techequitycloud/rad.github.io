---
title: "Rallly Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Rallly module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Rallly Common — Shared Application Configuration

`Rallly_Common` is the **shared application layer** for Rallly. It is not deployed
on its own; instead it supplies the Rallly-specific configuration that both
[Rallly_GKE](Rallly_GKE.md) and [Rallly_CloudRun](Rallly_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Rallly, see the platform
guides ([Rallly_GKE](Rallly_GKE.md), [Rallly_CloudRun](Rallly_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Rallly_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `SECRET_PASSWORD` (32-char) and `NEXTAUTH_SECRET` (32-char), plus an optional `SMTP_PWD`, and stores them in **Secret Manager** | Injected automatically as secret env vars via the `secret_ids` output |
| Container image | Wraps the official `lukevella/rallly` image with a thin cloud entrypoint; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, role, and grants | `initialization_jobs` output |
| Core env defaults | Sets `NEXT_PUBLIC_BASE_URL` / `NEXTAUTH_URL` (public base URL) and the `NOREPLY_EMAIL` / `SUPPORT_EMAIL` / `SMTP_*` mail settings | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/api/status` | §Observability in the platform guides |

Rallly stores **all** state in PostgreSQL — it declares **no object storage** (no GCS
data bucket) and **no NFS/Redis** dependency. Those integrations are disabled by
default in both variants.

---

## 2. Cryptographic secrets in Secret Manager

Two secrets are generated automatically on first deploy and stored in Secret Manager;
a third is created only when SMTP is configured. They are never set in plain text and
are injected as secret env vars through the `secret_ids` output:

- **`SECRET_PASSWORD`** — a 32-character random string (Rallly requires ≥32 chars).
  Rallly's data-encryption / session secret; used to encrypt sensitive stored values.
  Rotating it after first boot invalidates previously encrypted data and active
  sessions — treat it as immutable.
- **`NEXTAUTH_SECRET`** — a 32-character random string. Signs all NextAuth.js session
  tokens and email login links. Rotating it immediately invalidates every active
  session and any in-flight login/verification link, forcing users to request a new
  login email.
- **`SMTP_PWD`** — created only when `smtp_host` is set. Holds the SMTP authentication
  password. If `smtp_password` is supplied it is stored verbatim; otherwise an
  auto-generated value is stored (useful only if paired with a matching relay).

The secret resource names follow the pattern
`secret-<resource-prefix>-rallly-secret-password`,
`secret-<resource-prefix>-rallly-nextauth-secret`, and
`secret-<resource-prefix>-rallly-smtp-password`.

Retrieve them after deployment:

```bash
# List Rallly secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~rallly"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Rallly requires **PostgreSQL 15** (`database_type = POSTGRES_15`); the engine is fixed
and MySQL or other engines are not supported. On the first deployment a one-shot job
(`db-init`) runs using `postgres:15-alpine` and idempotently:

1. Routes to the Cloud SQL Auth Proxy — when `DB_SSL = false` and `DB_HOST` is not a
   socket path it forces `DB_HOST = 127.0.0.1` so `psql` reaches the proxy sidecar,
2. Waits for PostgreSQL to accept connections,
3. Creates (or updates the password of) the application role and grants it `CREATEDB`,
4. Creates (or reassigns ownership of) the application database to that role,
5. Grants full privileges on the database and the `public` schema (PG15+),
6. Signals the Cloud SQL Auth Proxy to shut down gracefully (`POST /quitquitquit`).

The job is configured with `max_retries = 3` and `execute_on_apply = true`, and is
safe to re-run. Note that Rallly's **application schema** is created separately — the
container's own `./docker-start.sh` runs `prisma migrate deploy` on every start (see
§4), so `db-init` only provisions the empty database and role.

Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database (`rallly`), and user (`rallly`) names are in the platform
deployment outputs.

---

## 4. Container image and entrypoint

The custom image is a thin wrapper `FROM lukevella/rallly:${RALLLY_VERSION}` (a
Debian `node:24-slim`-based image). An app-specific `RALLLY_VERSION` build ARG is used
deliberately — the Foundation injects `APP_VERSION = application_version` and would
otherwise clobber the tag to `latest`. The image runs as the non-root `nextjs` user
and exposes port **3000**.

The wrapper's `cloud-entrypoint.sh` runs before Rallly's own startup and:

- **Composes `DATABASE_URL`** from the platform-injected `DB_*` variables in Prisma
  URL form, branching on the resolved host per the Cloud SQL socket-vs-TCP rule:
  - a **Unix socket dir** (`/cloudsql/...`, Cloud Run Auth Proxy) →
    `postgresql://…@localhost:5432/<db>?host=<socket>&sslmode=disable`,
  - **loopback** (`127.0.0.1`, GKE proxy sidecar) →
    `postgresql://…@127.0.0.1:5432/<db>?sslmode=disable`,
  - a **real private IP** → `postgresql://…@<ip>:5432/<db>?sslmode=require`.
  The password is URL-encoded with the `node` binary already present in the image.
- **Sets the public base URL** — prefers an explicit `NEXT_PUBLIC_BASE_URL`; otherwise
  adopts the platform-injected `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`, and always
  sets `NEXTAUTH_URL` to match.
- **Binds the server** — `PORT = 3000`, `HOSTNAME = 0.0.0.0`.
- **Delegates to Rallly's own `./docker-start.sh`**, which runs `prisma migrate deploy`
  (applying the app schema and any migrations) and then starts the Next.js server.

Because migrations run inside the app's own start script, upgrading the application
version applies schema changes automatically on the next start — no separate migration
job is required.

---

## 5. Core application settings

`Rallly_Common` establishes the baseline Rallly environment so the application comes
up correctly on first boot:

- **Public base URL** — `NEXT_PUBLIC_BASE_URL` and `NEXTAUTH_URL` are set from the
  `base_url` input, defaulting to the deterministic service URL when empty. Rallly
  builds all invite and login links from this value and rejects the image default
  (`localhost`) for real use, so the platform variant always passes a usable URL.
- **Email identity** — `NOREPLY_EMAIL` and `SUPPORT_EMAIL` default to
  `noreply@rallly.local` (override with `mail_from`).
- **SMTP** — when `smtp_host` is set, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and
  `SMTP_SECURE` are injected as plain env vars and `SMTP_PWD` as a secret. Rallly uses
  **passwordless, email-based authentication** (NextAuth email provider): users
  register and log in by receiving a verification link/code, so a working SMTP
  configuration is effectively required for anyone to sign in.

---

## 6. Health probe behaviour

The default startup and liveness probes target **`/api/status`** — Rallly's public,
unauthenticated status endpoint that responds once the Next.js server is up. The
startup probe allows a generous window (30-second initial delay, 20 retries at
15-second intervals) to accommodate the `prisma migrate deploy` step that runs on
first boot before the server begins serving.

---

## 7. Storage model

Rallly is **disk-stateless** — polls, participants, votes, comments, and user accounts
all live in PostgreSQL. `Rallly_Common` therefore declares **no GCS data bucket**,
leaves **NFS disabled** (`enable_nfs = false`), and uses **no Redis**
(`enable_redis = false` is hard-wired in both platform variants). There is no object
storage to inspect for this application.

---

For the Rallly-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Rallly_GKE](Rallly_GKE.md)** and **[Rallly_CloudRun](Rallly_CloudRun.md)**.
