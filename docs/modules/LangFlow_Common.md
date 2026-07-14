---
title: "LangFlow Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the LangFlow module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# LangFlow Common — Shared Application Configuration

`LangFlow_Common` is the **shared application layer** for LangFlow. It is
not deployed on its own; instead it supplies the LangFlow-specific configuration
that both [LangFlow_GKE](LangFlow_GKE.md) and
[LangFlow_CloudRun](LangFlow_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs LangFlow, see the
platform guides ([LangFlow_GKE](LangFlow_GKE.md),
[LangFlow_CloudRun](LangFlow_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by LangFlow_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `LANGFLOW_SECRET_KEY` (32 random bytes, base64url) and `LANGFLOW_SUPERUSER_PASSWORD` (32-char password) and stores them in **Secret Manager** | Injected automatically as container secret env vars; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `langflowai/langflow` image with a thin shell entrypoint; builds via Cloud Build (`image_source = "custom"`, base tag pinned to `1.10.2` when `application_version = "latest"`) | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** (`database_type = "POSTGRES_15"`) as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, role, and grants using `postgres:15-alpine` | `initialization_jobs` output |
| Object storage | **None** — LangFlow persists flows and credentials in Postgres, so `storage_buckets` is empty | `storage_buckets` output (`[]`) |
| Core settings | Sets the baseline LangFlow environment: port `7860`, host `0.0.0.0`, `LANGFLOW_AUTO_LOGIN = "false"`, superuser username | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/health` | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager — they are never
set in plain text. Their Secret Manager IDs become the SERVICE container's secret
env-var **names** (the platform variant wires `module_secret_env_vars = secret_ids`):

- **`LANGFLOW_SECRET_KEY`** — 32 random bytes encoded base64url. LangFlow uses this
  to encrypt every stored credential (API keys, connection secrets embedded in flows).
  If it is unset LangFlow mints an ephemeral per-instance key, so a stable one is
  pinned here. **Rotating it after first boot permanently breaks all stored
  credentials** — they can no longer be decrypted and must be re-entered in every flow.
- **`LANGFLOW_SUPERUSER_PASSWORD`** — a 32-character generated password (no special
  characters). Because `LANGFLOW_AUTO_LOGIN = "false"`, LangFlow provisions its
  initial administrator account on first boot from `LANGFLOW_SUPERUSER` (the username,
  default `admin`) and this password. It is the password you log in with.

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key OR name~-password"

# Read the admin login password:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

LangFlow requires **PostgreSQL 15**; the engine is fixed and MySQL or other engines
are not supported. On the first deployment a one-shot job (`db-init`) runs using
`postgres:15-alpine` (`create-db-and-user.sh`) and idempotently:

1. Resolves the Cloud SQL host (`DB_HOST`, or `DB_IP` as fallback),
2. Waits for PostgreSQL to be reachable,
3. Creates (or updates the password of) the application role,
4. Grants it `CREATEDB` and creates (or reassigns owner of) the application database,
5. Grants full privileges on the database and the `public` schema,
6. Signals the Cloud SQL Auth Proxy sidecar to shut down gracefully
   (`POST /quitquitquit`) so the Job can exit cleanly on GKE.

The job is safe to re-run. LangFlow itself runs its **Alembic schema migrations on
every container start**, so the `db-init` job only handles role/database/grants — the
tables are created and upgraded by the application. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image wraps `langflowai/langflow:<version>` with a thin shell entrypoint
(`langflow-entrypoint.sh`) that runs before `langflow run` starts:

- **Composes `LANGFLOW_DATABASE_URL`** — LangFlow reads a single SQLAlchemy URL DSN,
  and a URL-authority DSN cannot embed the Cloud SQL Unix socket path (its colons
  break URL parsing). The entrypoint therefore builds the DSN over **TCP** from the
  platform-injected `DB_*` variables, branching on the resolved host:
  - **GKE** — `DB_HOST = 127.0.0.1` (the Cloud SQL Auth Proxy sidecar, TLS-terminated)
    → `sslmode=disable`.
  - **Cloud Run** — `DB_HOST` is the socket directory (`/cloudsql/...`); the entrypoint
    falls back to `DB_IP` (the instance private IP) → `sslmode=require`.
  - The password is URL-encoded before it is placed in the DSN.
  - Composition is skipped if the operator has supplied an explicit
    `LANGFLOW_DATABASE_URL`.
- **Sets the listen address** — `LANGFLOW_PORT = 7860` and `LANGFLOW_HOST = 0.0.0.0`
  are exported (defaulted) so LangFlow binds where the platform expects it.
- **Launches the server** — `exec "$@"` runs the image's default `langflow run` as
  PID 1.

The base-image tag comes from an app-specific build ARG (`LANGFLOW_VERSION`) so the
Foundation's generic `APP_VERSION` build-arg injection cannot clobber it to `latest`;
when `application_version = "latest"` the build pins `1.10.2` for reproducibility.

---

## 5. Core application settings

`LangFlow_Common` establishes the baseline LangFlow environment so the application
comes up correctly on first boot:

- **Port** — `LANGFLOW_PORT = "7860"`; the container listens on `7860`.
- **Host** — `LANGFLOW_HOST = "0.0.0.0"`.
- **Authentication** — `LANGFLOW_AUTO_LOGIN = "false"`, which turns on multi-user
  authentication and makes LangFlow provision the initial admin account from
  `LANGFLOW_SUPERUSER` + `LANGFLOW_SUPERUSER_PASSWORD`.
- **Superuser** — `LANGFLOW_SUPERUSER = <langflow_username>` (default `admin`).
- **Database URL** — intentionally *not* set here; the entrypoint composes
  `LANGFLOW_DATABASE_URL` at runtime from the injected `DB_*` vars (see §4).

Additional non-secret settings can be supplied through the platform
`environment_variables` input and are merged on top of these defaults.

---

## 6. Health probe behaviour

The default startup and liveness probes target **`/health`** — LangFlow's public,
unauthenticated liveness endpoint that returns `200 OK` once the server is running.
A generous startup window (30 s initial delay, 30 failure retries at 10 s each on
Cloud Run) accommodates the Alembic migrations that run on first boot.

- **Startup probe** — HTTP `GET /health`, 30 s initial delay, 10 s period, 30
  failure threshold.
- **Liveness probe** — HTTP `GET /health`, 15 s initial delay, 30 s period, 3
  failure threshold.

---

## 7. Object storage

LangFlow stores all state — flows, components, credentials, and run history — in
PostgreSQL, so **no Cloud Storage bucket is declared** (`storage_buckets` is `[]`)
and NFS is off by default. Enable NFS or GCS volumes only if you need shared file
storage for a specific custom component.

---

For the LangFlow-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[LangFlow_GKE](LangFlow_GKE.md)** and **[LangFlow_CloudRun](LangFlow_CloudRun.md)**.
