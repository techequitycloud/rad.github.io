---
title: "Unleash Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Unleash module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Unleash Common — Shared Application Configuration

`Unleash_Common` is the **shared application layer** for Unleash. It is
not deployed on its own; instead it supplies the Unleash-specific configuration
that both [Unleash_GKE](Unleash_GKE.md) and
[Unleash_CloudRun](Unleash_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Unleash, see the
platform guides ([Unleash_GKE](Unleash_GKE.md),
[Unleash_CloudRun](Unleash_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Unleash_Common | Where it surfaces |
|---|---|---|
| Bootstrap credential | Generates a bootstrap admin API token and stores it in **Secret Manager** | Injected as `INIT_ADMIN_API_TOKENS`; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `unleashorg/unleash-server` image with a custom entrypoint script; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants | `initialization_jobs` output |
| Connection string | Composes `DATABASE_URL` at container start from the platform-injected `DB_*` variables, with SSL secure-by-default on direct private-IP TCP | §Application behaviour in the platform guides |
| Core settings | Sets the baseline Unleash environment: listen port 4242, database TLS handling | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/health` | §Observability in the platform guides |

---

## 2. The bootstrap admin API token in Secret Manager

A single bootstrap admin API token is generated automatically and stored in Secret
Manager — it is never set in plain text:

- **`INIT_ADMIN_API_TOKENS`** — a token in Unleash's admin-token format
  `*:*.<48-char-random>`, where the `*:*` prefix grants access to **all projects and
  all environments**. Unleash reads this environment variable at first boot and seeds
  the token into its database so that automation (CI pipelines, the CLI, Terraform
  providers) can call the Unleash Admin API immediately, without a human logging into
  the UI first. The secret is named `secret-<resource-prefix>-<app>-admin-token`.

Retrieve the token after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~admin-token"

# Read the token value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Use it against the Admin API:

```bash
curl -s -H "Authorization: <token>" "$SERVICE_URL/api/admin/projects"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Unleash requires **PostgreSQL 15**; the engine is fixed and MySQL or other
engines are not supported. On the first deployment a one-shot job (`db-init`) runs
using `postgres:15-alpine` and idempotently:

1. Detects the Cloud SQL Auth Proxy Unix socket and maps it for `psql` access,
2. Waits for PostgreSQL to be reachable,
3. Creates (or updates) the application role with the generated password,
4. Creates the application database with that role as owner,
5. Grants full privileges on the database to the application user,
6. Signals the Cloud SQL Auth Proxy to shut down gracefully.

Unleash applies its **own schema migrations** on every application startup — the
`db-init` job only provisions the empty database and role; it does not create tables.
The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image wraps `unleashorg/unleash-server:<version>` with a thin shell
entrypoint (`unleash-entrypoint.sh`) that runs before the Node.js server starts. Its
central job is to compose the single `DATABASE_URL` connection string Unleash expects
from the discrete `DB_*` variables the platform injects — Cloud Run does not
interpolate `$(VAR)` in env values, so the URL is assembled at runtime. The entrypoint
branches on the resolved database host:

- **Unix socket** (`/cloudsql/<instance>`, Cloud Run native Cloud SQL): builds
  `postgres://user:pass@/db?host=/cloudsql/<instance>` — the socket path cannot appear
  in a URL authority, so it goes in the `host` query parameter. TLS does not apply to a
  local socket, so `DATABASE_SSL` is off.
- **Loopback proxy** (`127.0.0.1`, GKE cloud-sql-proxy sidecar): the sidecar has
  already terminated TLS to Cloud SQL, so the hop to loopback is unencrypted and cert
  verification is off.
- **Direct private IP** (fallback): connects with `?ssl=true` and keeps
  `DATABASE_SSL_REJECT_UNAUTHORIZED=true` — **secure by default**. An operator must
  explicitly override it to disable certificate verification.

The password is URL-encoded before it is placed in the DSN so special characters
(`@ : / ? # % & +`) in the platform-generated secret cannot corrupt the connection
string. The image's build ARG is `UNLEASH_VERSION` (not the generic `APP_VERSION` the
foundation injects), and `latest` is remapped to a pinned tag (`5.7.0`) for
reproducible builds. The entrypoint finally locates and launches the Unleash server
with `exec node <entry>` as PID 1.

---

## 5. Core application settings

`Unleash_Common` establishes the baseline Unleash environment so the application
comes up correctly on first boot:

- **Listen port** — Unleash serves on port **4242** (`container_port = 4242`).
- **Database URL** — `DATABASE_URL` is composed at container start (see §4); it is
  never stored in plain text in Terraform state.
- **Database TLS** — `DATABASE_SSL_REJECT_UNAUTHORIZED` is `true` on direct private-IP
  TCP (secure by default) and `false` only on the socket / loopback-proxy paths where
  TLS is absent or already terminated.
- **Bootstrap token** — `INIT_ADMIN_API_TOKENS` is injected from Secret Manager so a
  valid all-access admin API token exists from the first boot.

Unleash also ships a well-known first-run UI credential: log in as `admin` /
`unleash4all` and change the password immediately after the first deployment.

---

## 6. Health probe behaviour

The default probes target `/health` — Unleash's dedicated, unauthenticated health
endpoint that returns 200 only once the server is initialised and connected to
PostgreSQL. A generous startup window (`failure_threshold = 30`, `period_seconds = 10`)
accommodates the schema migrations that run on first boot against a fresh database.

- **Cloud Run** uses HTTP startup and liveness probes targeting `/health` with a
  30-second initial delay and a 30-retry startup window.
- **GKE** uses the same `/health` path for the startup and liveness probes, with the
  same headroom for first-boot migrations.

Probe paths must stay on `/health` (public, unauthenticated). Pointing a probe at an
authenticated Admin API path (`/api/admin/*`) returns 401/403 and the revision or pod
never becomes Ready.

---

## 7. Object storage

Unleash is **stateless** — all flag, toggle, strategy, and audit data lives in
PostgreSQL. `Unleash_Common` therefore declares **no** Cloud Storage buckets
(`storage_buckets = []`) and enables no NFS. There is no object storage to manage for
this application.

---

For the Unleash-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[Unleash_GKE](Unleash_GKE.md)** and **[Unleash_CloudRun](Unleash_CloudRun.md)**.
