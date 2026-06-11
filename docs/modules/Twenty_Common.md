---
title: "Twenty Common \u2014 Shared Application Configuration"
---

# Twenty Common — Shared Application Configuration

`Twenty_Common` is the **shared application layer** for Twenty CRM. It is not deployed
on its own; instead it supplies the Twenty-specific configuration that both
[Twenty_GKE](Twenty_GKE.md) and [Twenty_CloudRun](Twenty_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Twenty, see the platform
guides ([Twenty_GKE](Twenty_GKE.md), [Twenty_CloudRun](Twenty_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Twenty_Common | Where it surfaces |
|---|---|---|
| App secret | Generates `APP_SECRET` / `ENCRYPTION_KEY` and stores it in **Secret Manager** | Retrieve via Secret Manager (see below) |
| Container image | Pins `twentycrm/twenty` and wraps it with a custom entrypoint via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines two first-deploy jobs: `db-init` (creates DB and user) and `twenty-migrate` (runs schema migrations) | `initialization_jobs` output |
| Background job mode | Sets `MESSAGE_QUEUE_TYPE` to `pg-boss` (default) or `bull-mq` (when Redis enabled) | Application behaviour in the platform guides |
| Object storage | Declares the **Cloud Storage** bucket when `enable_gcs_storage = true` | `storage_buckets` output |
| Core settings | Injects baseline environment variables (`SERVER_URL`, `FRONT_BASE_URL`, `STORAGE_TYPE`, `DISABLE_DB_MIGRATIONS`) | Application behaviour in the platform guides |
| Health checks | Supplies the default startup and liveness probe configuration (`/healthz` with generous first-boot window) | §Observability in the platform guides |

---

## 2. App secret in Secret Manager

The `APP_SECRET` / `ENCRYPTION_KEY` is generated automatically and stored as a Secret
Manager secret — it is never set in plain text. A 30-second propagation delay ensures
Secret Manager replication completes before the service or pods attempt to read it.

Retrieve the secret after deployment:

```bash
# The secret name follows the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~app-secret"
gcloud secrets versions access latest --secret=<app-secret-name> --project "$PROJECT"
```

The secret is mapped to both `APP_SECRET` and `ENCRYPTION_KEY` environment variable
names, ensuring compatibility across Twenty versions that use either name for JWT
signing. Do not manually rotate this secret unless you are prepared to invalidate all
active user sessions.

The database password is generated and managed separately by the foundation; its secret
name is reported in the platform deployment outputs (`database_password_secret`). See
[App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Twenty requires **PostgreSQL 15**; the engine is fixed and MySQL is not supported. On
the first deployment two one-shot jobs run sequentially before the application starts:

1. **`db-init`** — uses the `postgres:15-alpine` image, connects to Cloud SQL through
   the Auth Proxy (via `ROOT_PASSWORD` from Secret Manager), and idempotently:
   - creates the application user with the generated password,
   - creates the application database owned by that user,
   - grants all privileges on the database and schema,
   - installs the `uuid-ossp` extension (required by Twenty).

2. **`twenty-migrate`** — uses the deployed Twenty application image with
   `DISABLE_DB_MIGRATIONS=false` to run TypeORM schema migrations and register
   background cron jobs in the database. It uses Twenty's own entrypoint, so no
   external tooling is required. This job depends on `db-init` completing first.

Both jobs are safe to re-run. The main application container runs with
`DISABLE_DB_MIGRATIONS=true` to keep subsequent cold starts fast (seconds instead
of minutes). Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Core application settings

`Twenty_Common` establishes the baseline Twenty environment so the application comes
up correctly on first boot:

- **Job queue mode** — `MESSAGE_QUEUE_TYPE` defaults to `pg-boss` (PostgreSQL-backed,
  no additional infrastructure). When `enable_redis = true`, it switches to `bull-mq`,
  which requires a Redis connection and a separate worker process.
- **File storage mode** — `STORAGE_TYPE` defaults to `local` (ephemeral container
  storage). When `enable_gcs_storage = true`, it switches to `s3` (GCS S3-compatible
  API), and the bucket name, region, and endpoint are injected automatically.
- **Redis URL** — `REDIS_URL` is only injected when `enable_redis = true` **and**
  `redis_host` is non-empty. Injecting a placeholder URL when no Redis server is
  reachable causes ioredis to retry indefinitely and blocks Twenty startup for the
  entire probe window.
- **Server URLs** — `SERVER_URL` and `FRONT_BASE_URL` are injected as empty strings
  by default and **must be overridden** via the platform module's
  `environment_variables`. Without valid URLs, API links are broken, CORS errors occur
  on all requests, and email invitations cannot be generated.
- **Migrations disabled** — `DISABLE_DB_MIGRATIONS=true` and
  `DISABLE_CRON_JOBS_REGISTRATION=true` are set in the main container so the
  `twenty-migrate` init job is the sole path for schema changes.

---

## 5. Health probe behaviour

The default probes target Twenty's `/healthz` endpoint, which returns HTTP 200 when
the Node.js server is ready and the database connection is healthy:

- **Startup probe** — HTTP GET `/healthz`, 120-second initial delay, 15-second poll
  period, 40-failure threshold. This gives up to ~10 minutes total for first-boot
  migrations (which run via the `twenty-migrate` init job before the pod starts, but
  allows for variance). Both GKE and Cloud Run use the same HTTP probe because Twenty
  does not issue HTTP→HTTPS redirects on the health path.
- **Liveness probe** — HTTP GET `/healthz`, 30-second initial delay, 30-second poll
  period, 3-failure threshold. A container is restarted after 3 consecutive failures.

---

## 6. Object storage

When `enable_gcs_storage = true`, a dedicated **Cloud Storage** bucket is declared here
and provisioned by the foundation, which also grants the workload service account
access. The bucket is configured for the GCS S3-compatible API:

- `STORAGE_TYPE = "s3"` is injected automatically.
- `STORAGE_S3_NAME`, `STORAGE_S3_REGION`, and `STORAGE_S3_ENDPOINT` are injected
  from the bucket name, deployment region, and the GCS S3-compatible endpoint
  (`https://storage.googleapis.com`).
- GCS HMAC keys (`STORAGE_S3_ACCESS_KEY_ID` and `STORAGE_S3_SECRET_ACCESS_KEY`) are
  **not** generated automatically — you must create them in the Console (Cloud Storage
  → Settings → Interoperability) and supply them via `secret_environment_variables`.

List the provisioned bucket:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Twenty-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Twenty_GKE](Twenty_GKE.md)** and **[Twenty_CloudRun](Twenty_CloudRun.md)**.
