---
title: "SparkyFitness Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the SparkyFitness module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# SparkyFitness Common — Shared Application Configuration

`SparkyFitness_Common` is the **shared application layer** for SparkyFitness. It is
not deployed on its own; instead it supplies the SparkyFitness-specific configuration
that both [SparkyFitness_GKE](SparkyFitness_GKE.md) and
[SparkyFitness_CloudRun](SparkyFitness_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs SparkyFitness, see the
platform guides ([SparkyFitness_GKE](SparkyFitness_GKE.md),
[SparkyFitness_CloudRun](SparkyFitness_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by SparkyFitness_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `SPARKY_FITNESS_API_ENCRYPTION_KEY` (64-char hex), `BETTER_AUTH_SECRET`, and `SPARKY_FITNESS_APP_DB_PASSWORD`, all stored in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | References the official prebuilt `codewithcj/sparkyfitness_server` image — no custom build or entrypoint wrapper | `config.container_image` output |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the admin role and database only | `initialization_jobs` output |
| Core settings | Sets the baseline backend environment: log level, timezone, CORS, admin bootstrap, disable-signup, SMTP | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting HTTP `GET /api/health` on port 3010 | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Three secrets are generated automatically and stored in Secret Manager — they are
never set in plain text and (for two of the three) must never be changed after first
use:

- **`SPARKY_FITNESS_API_ENCRYPTION_KEY`** — a 64-character hex string (`random_id`,
  32 bytes) matching upstream's documented `openssl rand -hex 32` format. Encrypts
  stored external-data-source credentials. Rotating it after first connection
  permanently invalidates them.
- **`BETTER_AUTH_SECRET`** — signs sessions and encrypts 2FA/TOTP data. Rotating it
  after users enable two-factor authentication locks them out.
- **`SPARKY_FITNESS_APP_DB_PASSWORD`** — the password for the limited-privilege
  runtime database role (`app_db_user`). Unlike the two secrets above, this one is
  safe to rotate at any time — the backend re-syncs the role's password from this
  secret on its next restart, since it self-heals the role every boot.

Retrieve the secrets after deployment:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~sparkyfitness"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password for the **admin** role (`db_user`) is generated and managed
separately by the foundation; its secret name is reported in the platform deployment
outputs (`database_password_secret`). See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

---

## 3. Database engine and bootstrap

SparkyFitness requires **PostgreSQL 15**; the engine is fixed and no other engine is
supported. On the first deployment a one-shot job (`db-init`) runs using
`postgres:15-alpine` and idempotently:

1. Waits for PostgreSQL to be reachable (through the Cloud SQL Auth Proxy),
2. Creates (or updates) the **admin** role (`db_user`) with the generated password,
3. Creates (or reconfigures) the database (`db_name`) with that role as owner,
4. Grants full privileges on the database and public schema,
5. Signals the Cloud SQL Auth Proxy to shut down gracefully (GKE only).

Unlike most Common modules in this catalogue, there is **no second migrate job**.
SparkyFitness's own backend runs its schema migrations, and separately **self-heals
a second, limited-privilege PostgreSQL role** (`app_db_user`) using the admin role's
credentials — on every single container start, not just the first. This is upstream's
own documented least-privilege pattern: `db_user` is described as the "super user for
DB initialization and migrations," while `app_db_user` is the "application database
user with limited privileges."

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image (no custom build)

Both the backend (`codewithcj/sparkyfitness_server`) and frontend
(`codewithcj/sparkyfitness`) images are used **exactly as published** upstream — no
custom Dockerfile, no entrypoint wrapper. This is possible because:

- The backend already reads discrete, standard-shaped env vars
  (`SPARKY_FITNESS_DB_HOST`/`_PORT`/`_NAME`/`_USER`/`_PASSWORD`), which the Foundation
  can inject directly via its `db_*_env_var_name` rename mechanism — no shell-script
  translation layer is needed, unlike apps whose native env var names differ from the
  Foundation's `DB_*` convention.
- The frontend's nginx entrypoint reads `SPARKY_FITNESS_SERVER_HOST` /
  `SPARKY_FITNESS_SERVER_PORT` directly to `envsubst` its own nginx config — again, no
  wrapper needed, just the right values supplied by each platform variant's wiring
  file (see [SparkyFitness_CloudRun](SparkyFitness_CloudRun.md) and
  [SparkyFitness_GKE](SparkyFitness_GKE.md) for how those values differ by platform).

---

## 5. Core application settings

`SparkyFitness_Common` establishes the baseline backend environment so the
application comes up correctly on first boot:

- **Environment** — `NODE_ENV = "production"`.
- **Logging** — `SPARKY_FITNESS_LOG_LEVEL` (default `ERROR`).
- **Timezone** — `TZ` (default `Etc/UTC`).
- **CORS** — `ALLOW_PRIVATE_NETWORK_CORS = "false"` by default; `SPARKY_FITNESS_FRONTEND_URL`
  is set per-platform to the computed frontend URL (never a runtime placeholder — Cloud
  Run/GKE do not interpolate `$(VAR)` in env values, so this must be a real string
  known at plan time).
- **Signup control** — `SPARKY_FITNESS_DISABLE_SIGNUP` (default `false`).
- **Admin bootstrap** — `SPARKY_FITNESS_ADMIN_EMAIL` (default empty; elevates an
  EXISTING user, does not create one).
- **SMTP** — off by default; when `smtp_enabled = true`, all `SPARKY_FITNESS_EMAIL_*`
  fields are set together (host/port/secure/user/from) — the password
  (`SPARKY_FITNESS_EMAIL_PASS`) is deliberately NOT set here; supply it via the
  platform variant's `secret_environment_variables`.

---

## 6. Health probe behaviour

The default probes target `GET /api/health` on port 3010 — confirmed directly from
the backend's own Dockerfile `HEALTHCHECK` directive
(`CMD curl -f http://127.0.0.1:3010/api/health`), not inferred or guessed.

- **Cloud Run** applies this probe to the backend's `additional_containers` sidecar
  via its `startup_tcp_port`/`inherit_app_env` wiring; the main (frontend) container
  gets a separate plain TCP probe.
- **GKE** applies this probe directly to the backend, since it is the main app there.

---

For the SparkyFitness-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the platform
guides: **[SparkyFitness_GKE](SparkyFitness_GKE.md)** and
**[SparkyFitness_CloudRun](SparkyFitness_CloudRun.md)**.
