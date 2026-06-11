---
title: "Activepieces Common \u2014 Shared Application Configuration"
---

# Activepieces Common — Shared Application Configuration

`Activepieces_Common` is the **shared application layer** for Activepieces. It is
not deployed on its own; instead it supplies the Activepieces-specific configuration
that both [Activepieces_GKE](Activepieces_GKE.md) and
[Activepieces_CloudRun](Activepieces_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Activepieces, see the
platform guides ([Activepieces_GKE](Activepieces_GKE.md),
[Activepieces_CloudRun](Activepieces_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Activepieces_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `AP_ENCRYPTION_KEY` (32-char hex) and `AP_JWT_SECRET` (32-char alphanumeric) and stores them in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `activepieces/activepieces` image with a custom entrypoint script; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, grants, and installs `pgvector` | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** data bucket | `storage_buckets` output |
| Core settings | Sets the baseline Activepieces environment: queue mode, port, telemetry, execution mode, sign-up state | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/api/v1/flags` | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager — they are never
set in plain text and must never be changed after the first deployment:

- **`AP_ENCRYPTION_KEY`** — a 32-character hex string derived from 16 random bytes.
  Used by Activepieces to encrypt all stored connection credentials and flow step
  secrets. Rotating it after first boot permanently corrupts all stored credentials;
  they cannot be decrypted and must be re-entered for every integration.
- **`AP_JWT_SECRET`** — a 32-character random alphanumeric string. Used to sign all
  user session tokens. Rotating it immediately invalidates all active sessions,
  forcing every user to log out and re-authenticate.

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~encryption-key OR name~jwt-secret"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Activepieces requires **PostgreSQL 15**; the engine is fixed and MySQL or other
engines are not supported. On the first deployment a one-shot job (`db-init`) runs
using `postgres:15-alpine` and idempotently:

1. Detects the Cloud SQL Auth Proxy Unix socket and maps it for `psql` access,
2. Waits for PostgreSQL to be reachable,
3. Creates (or updates) the application user with the generated password,
4. Creates (or reconfigures) the application database with that user as owner,
5. Grants full privileges on the database and public schema,
6. Installs the `pgvector` extension (`CREATE EXTENSION IF NOT EXISTS vector`) as
   a superuser — required for AI-powered workflow pieces that use vector similarity
   search,
7. Signals the Cloud SQL Auth Proxy to shut down gracefully.

The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image wraps `activepieces/activepieces:<version>` with a thin shell
entrypoint (`entrypoint.sh`) that runs before the Node.js server starts:

- **Maps `DB_*` to `AP_POSTGRES_*`** — the platform injects standard `DB_HOST`,
  `DB_NAME`, `DB_USER`, `DB_PASSWORD` variables; the entrypoint translates them to
  the Activepieces-native `AP_POSTGRES_HOST`, `AP_POSTGRES_DATABASE`,
  `AP_POSTGRES_USERNAME`, `AP_POSTGRES_PASSWORD` at runtime.
- **Constructs `AP_REDIS_URL`** — when Redis is enabled, builds the Redis connection
  URL from `QUEUE_BULL_REDIS_HOST`, `QUEUE_BULL_REDIS_PORT`, and optionally
  `QUEUE_BULL_REDIS_PASSWORD`.
- **Updates `AP_FRONTEND_URL` / `AP_WEBHOOK_URL_PREFIX`** — on Cloud Run, overrides
  both with the actual `CLOUDRUN_SERVICE_URL` injected at runtime, correcting any
  stale plan-time predicted URL and ensuring webhooks and OAuth redirects always use
  the real service address.
- **Locates and launches the Node.js server** — searches for `main.js` under the
  Activepieces install path and launches it with `exec node <entry>` as PID 1.

---

## 5. Core application settings

`Activepieces_Common` establishes the baseline Activepieces environment so the
application comes up correctly on first boot:

- **Queue mode** — `AP_QUEUE_MODE = "MEMORY"` by default; switches to `"REDIS"` when
  Redis is enabled via the platform deployment settings.
- **Port** — `AP_PORT = "8080"`; `AP_POSTGRES_PORT = "5432"`.
- **Environment** — `AP_ENVIRONMENT = "production"`.
- **Telemetry** — `AP_TELEMETRY_ENABLED = "false"` (disabled by default; no data
  sent to the Activepieces cloud).
- **Execution mode** — `AP_EXECUTION_MODE = "UNSANDBOXED"` with `AP_SANDBOX_TYPE = "NO_SANDBOX"`,
  required because Cloud Run and GKE do not support the privileged container sandbox
  that Activepieces' sandboxed mode requires.
- **Sign-up** — `AP_SIGN_UP_ENABLED = "true"` by default. Override this to `"false"`
  via `environment_variables` after creating the initial administrator account to
  prevent unauthorised account creation.

Platform-specific adjustments handled here:

- **Cloud Run** additionally sets `AP_FRONTEND_URL` and `AP_WEBHOOK_URL_PREFIX` from
  the predicted service URL at plan time; the entrypoint corrects them at runtime
  from `CLOUDRUN_SERVICE_URL`.
- **GKE** sets these URLs to the internal cluster service URL (`http://<name>.<namespace>.svc.cluster.local`);
  they must be updated to the external LoadBalancer or custom domain URL via
  `environment_variables` after the external IP is known.

---

## 6. Health probe behaviour

The default probes target `/api/v1/flags` — the Activepieces flags API endpoint that
responds only once the server is fully initialised and connected to PostgreSQL. A
generous startup window accommodates the database migrations that run on first boot.

- **Cloud Run** uses HTTP probes targeting `/api/v1/flags` with a 120-second initial
  delay and a 10-retry window (total ~420 seconds after the delay) — sufficient for
  first-boot migrations on typical Cloud SQL instances.
- **GKE** also uses HTTP probes targeting `/` by default with a 60-second initial
  delay; consider setting `path = "/api/v1/flags"` for more accurate health
  signalling.

---

## 7. Object storage

A dedicated **Cloud Storage** data bucket is declared here and provisioned by the
foundation, which also grants the workload service account access. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Activepieces-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the platform
guides: **[Activepieces_GKE](Activepieces_GKE.md)** and
**[Activepieces_CloudRun](Activepieces_CloudRun.md)**.
