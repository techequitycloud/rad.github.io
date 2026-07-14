---
title: "Dify Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Dify module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Dify Common — Shared Application Configuration

`Dify_Common` is the **shared application layer** for Dify. It is not deployed on its own;
instead it supplies the Dify-specific configuration that both [Dify_GKE](Dify_GKE.md) and
[Dify_CloudRun](Dify_CloudRun.md) build on, so the two platform variants behave identically
where it matters. End users never configure this layer directly — it has no deployment UI inputs
of its own — but understanding what it provides explains the defaults you see in the platform
docs.

For the infrastructure that actually provisions and runs Dify, see the platform guides
([Dify_GKE](Dify_GKE.md), [Dify_CloudRun](Dify_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Dify_Common | Where it surfaces |
|---|---|---|
| Application secret | Generates a 64-character `SECRET_KEY` and stores it in **Secret Manager** | Retrieved from Secret Manager; injected as `SECRET_KEY` into every pod/instance |
| Container image | Sets `langgenius/dify-api` as the base image and wraps it with supervisord (API + Celery in one container) | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| pgvector extension | Enables the `vector` PostgreSQL extension so the Cloud SQL instance also serves as the vector store | `VECTOR_STORE=pgvector` with no separate vector database |
| Database bootstrap | Defines the first-deploy job that creates the database user and database | `initialization_jobs` output |
| Object storage | Declares one **Cloud Storage** bucket (suffix `storage`, e.g. `gcs-dify<resource-prefix>-storage`) | `storage_buckets` output |
| Core environment | Sets all baseline Dify environment variables (bind address, gunicorn settings, Redis URLs, storage driver, pgvector connection, CORS, service URLs) | Application behaviour in the platform guides |
| Health checks | Supplies the default HTTP startup and liveness probe behaviour (both target `/health`) | §Observability in the platform guides |

---

## 2. SECRET_KEY in Secret Manager

A 64-character random `SECRET_KEY` is generated automatically and stored as a Secret Manager
secret — it is never set in plain text. This key is used by Dify's Flask server for JWT signing,
session encryption, and CSRF tokens. Retrieve it after deployment:

```bash
# The secret name follows the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~secret-key"
gcloud secrets versions access latest --secret=<secret-key-secret> --project "$PROJECT"
```

**Do not rotate or change this secret after first deployment.** All running instances (API and
Celery worker) must share the same value; a mismatch causes authentication failures between
services and logs out all users.

The database password is generated and managed separately by the foundation; its secret name is
reported in the platform deployment outputs (`database_password_secret`). See
[App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine, pgvector, and bootstrap

Dify requires **PostgreSQL 15**; the engine is fixed and MySQL is not supported. The `vector`
PostgreSQL extension is enabled automatically on the Cloud SQL instance, allowing Dify to use
the same database as both the application store and the vector store (`VECTOR_STORE=pgvector`)
— no separate Weaviate, Qdrant, or other vector service is needed in the default configuration.

On the first deployment a one-shot `db-init` job connects to Cloud SQL through the Auth Proxy
and idempotently:

1. creates (or updates the password of) the application user,
2. grants that user role to `postgres` so it can take ownership,
3. creates the Dify database (if absent) owned by that user,
4. grants the user full privileges on the database.

The job uses the `postgres:15-alpine` image and is safe to re-run. Inspect the database
directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and supervisord

`Dify_Common` builds a custom image that extends `langgenius/dify-api:<version>` by installing
supervisord and copying a platform entrypoint (`/platform-entrypoint.sh`). At startup the
entrypoint applies several fixups before handing off to supervisord:

1. **DB_HOST remap.** If `DB_HOST` is a Cloud SQL Unix socket directory (starts with `/`), it is
   replaced with `DB_IP` (the Cloud SQL private TCP IP) and `sslmode=require` is appended to
   `DB_EXTRAS`, so pgvector and SQLAlchemy reach the database over TCP with TLS rather than a
   socket.
2. **`$(VAR)` placeholders re-resolved.** `DB_USERNAME`, `DB_DATABASE`, `REDIS_HOST`,
   `CELERY_BROKER_URL`/`CELERY_BACKEND`, `EVENT_BUS_REDIS_URL`, and `PGVECTOR_PASSWORD` are all
   re-exported explicitly from the now-fully-resolved container environment (see §5) instead of
   relying on their literal `$(...)` values.
3. **Web URL override.** If `DIFY_WEB_URL` is present (injected by the CloudRun/GKE variant when
   a separate `web` service is deployed), `CONSOLE_WEB_URL`/`APP_WEB_URL` are overridden to that
   value so email links and OAuth redirects target the browser-facing frontend rather than the
   API service.
4. supervisord then launches two processes in the same container:
   - The gunicorn API server (`MODE=api`) on port 5001.
   - The Celery worker (`MODE=worker`) which drains the task queue from Redis.

This co-located model means both the web API and the background worker are governed by the same
Cloud Run or GKE scaling controls and share the same CPU/memory allocation.

---

## 5. Core application settings

`Dify_Common` establishes all baseline Dify environment variables so the application comes up
correctly on first boot:

- **Process and binding** — `DIFY_BIND_ADDRESS=0.0.0.0`, `DIFY_PORT=5001`,
  `SERVER_WORKER_AMOUNT=2`, `GUNICORN_TIMEOUT=360`.
- **Migrations** — `MIGRATION_ENABLED=true` causes Flask-Migrate to run on every startup,
  applying schema changes automatically when the version is upgraded.
- **Database** — `DB_TYPE=postgresql`, `DB_USERNAME=$(DB_USER)`, `DB_DATABASE=$(DB_NAME)` are set
  as static config, but **Cloud Run does not interpolate `$(VAR)` references** (that is a
  Kubernetes-only env-reference feature) and even on GKE the substitution is order-dependent, so
  these placeholders are not reliably resolved by the platform itself. `entrypoint.sh` re-exports
  `DB_USERNAME`/`DB_DATABASE` from the already-resolved `DB_USER`/`DB_NAME` once every env var is
  available in the container, which is what actually makes the values correct at runtime.
- **Redis and Celery** — Three Redis connection paths are constructed from `redis_host`,
  `redis_port`, and `redis_auth`:
  - `CELERY_BROKER_URL` and `CELERY_BACKEND` — `redis://...:<port>/1` (Celery uses db 1).
  - `EVENT_BUS_REDIS_URL` — `redis://...:<port>/0` (SSE/WebSocket streaming uses db 0).
  - When `redis_host` is empty, the `$(NFS_SERVER_IP)` runtime placeholder is used as a
    fallback; because Cloud Run does not resolve it either, `entrypoint.sh` reconstructs
    `REDIS_HOST` and all three Redis-derived URLs once `NFS_SERVER_IP` is available in the
    container environment.
- **Storage** — `STORAGE_TYPE=google-storage`, `GOOGLE_STORAGE_BUCKET_NAME=<prefix>-storage`.
  The Cloud Run or GKE service identity (via Workload Identity / ADC) grants access; no JSON
  key file is used.
- **Vector store** — `VECTOR_STORE=pgvector`, `PGVECTOR_HOST=$(DB_IP)`, with all other
  pgvector connection variables set from platform-injected placeholders. `PGVECTOR_PASSWORD`
  is likewise re-exported by `entrypoint.sh` from the resolved `DB_PASSWORD` secret, since the
  static `$(DB_PASSWORD)` placeholder is declared before the secret env block and is never
  substituted by Cloud Run.
- **Service URLs** — `CONSOLE_API_URL`, `CONSOLE_WEB_URL`, `SERVICE_API_URL`, `APP_API_URL`,
  `APP_WEB_URL`, and `FILES_URL` all default to `var.service_url` (the URL passed in from the
  wrapper module). `entrypoint.sh` overrides `CONSOLE_WEB_URL`/`APP_WEB_URL` to `DIFY_WEB_URL`
  when the CloudRun/GKE variant provisions a separate `web` frontend service.
- **CORS** — `WEB_API_CORS_ALLOW_ORIGINS="*"` and `CONSOLE_CORS_ALLOW_ORIGINS="*"`. Override
  these via `environment_variables` in the platform module for production deployments.

---

## 6. Health probe behaviour

Both startup and liveness probes target `/health` with HTTP type and a 30-second initial delay.

- **GKE** keeps HTTP probes targeting `/health` with a 30-second initial delay and a 30-count
  failure threshold (total 300 seconds), providing enough time for Flask-Migrate to complete on
  first boot.
- **Cloud Run** uses the same HTTP `/health` target with the same initial delay. Unlike
  PHP-based applications that redirect HTTP to HTTPS, the Dify API serves plain HTTP on port
  5001 with no redirect, so HTTP probes work correctly on both platforms.

---

## 7. Object storage

A dedicated **Cloud Storage** bucket (suffix `storage`, e.g. `gcs-dify<resource-prefix>-storage`,
set as `GOOGLE_STORAGE_BUCKET_NAME`) is declared here and provisioned by the foundation. The
workload service account is granted access automatically via Workload Identity. Dify uses this
bucket for all uploaded files (documents, images, audio), so the bucket must exist before the
first upload. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Dify-specific, user-facing configuration (variables by group, outputs, and how to
explore each service from the Console and CLI), see the platform guides:
**[Dify_GKE](Dify_GKE.md)** and **[Dify_CloudRun](Dify_CloudRun.md)**.
