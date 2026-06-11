---
title: "Dify Common \u2014 Shared Application Configuration"
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
| Object storage | Declares the **Cloud Storage** `dify-storage` bucket | `storage_buckets` output |
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

1. creates the Dify database (if absent),
2. creates the application user with the generated password,
3. grants the user full privileges on that database.

The job uses the `postgres:15-alpine` image and is safe to re-run. Inspect the database
directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and supervisord

`Dify_Common` builds a custom image that extends `langgenius/dify-api:<version>` by installing
supervisord and copying a platform entrypoint. At startup:

1. The platform entrypoint (`entrypoint.sh`) remaps the Cloud SQL Unix socket path to a TCP
   address (`DB_IP`) so that pgvector can reach the database over TCP rather than a socket.
2. supervisord then launches two processes in the same container:
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
- **Database** — `DB_TYPE=postgresql`, `DB_USERNAME=$(DB_USER)`, `DB_DATABASE=$(DB_NAME)`.
  The platform runtime substitution resolves the `$(...)` placeholders at container startup.
- **Redis and Celery** — Three Redis connection paths are constructed from `redis_host`,
  `redis_port`, and `redis_auth`:
  - `CELERY_BROKER_URL` and `CELERY_BACKEND` — `redis://...:<port>/1` (Celery uses db 1).
  - `EVENT_BUS_REDIS_URL` — `redis://...:<port>/0` (SSE/WebSocket streaming uses db 0).
  - When `redis_host` is empty, the `$(NFS_SERVER_IP)` runtime placeholder is used and the
    platform resolves it to the NFS server VM's IP at startup.
- **Storage** — `STORAGE_TYPE=google-storage`, `GOOGLE_STORAGE_BUCKET_NAME=<prefix>-storage`.
  The Cloud Run or GKE service identity (via Workload Identity / ADC) grants access; no JSON
  key file is used.
- **Vector store** — `VECTOR_STORE=pgvector`, `PGVECTOR_HOST=$(DB_IP)`, with all other
  pgvector connection variables set from platform-injected placeholders.
- **Service URLs** — `CONSOLE_API_URL`, `CONSOLE_WEB_URL`, `SERVICE_API_URL`, `APP_API_URL`,
  `APP_WEB_URL`, and `FILES_URL` are all set to the service URL passed in from the wrapper
  module (the Cloud Run service URL or the GKE LoadBalancer IP).
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

A dedicated **Cloud Storage** bucket (`dify-storage`) is declared here and provisioned by the
foundation. The workload service account is granted access automatically via Workload Identity.
Dify uses this bucket for all uploaded files (documents, images, audio), so the bucket must
exist before the first upload. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Dify-specific, user-facing configuration (variables by group, outputs, and how to
explore each service from the Console and CLI), see the platform guides:
**[Dify_GKE](Dify_GKE.md)** and **[Dify_CloudRun](Dify_CloudRun.md)**.
