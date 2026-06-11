---
title: "Sample Common \u2014 Shared Application Configuration"
---

# Sample Common — Shared Application Configuration

`Sample_Common` is the **shared application layer** for the Sample module. It is not
deployed on its own; instead it supplies the Sample-specific configuration that both
[Sample_GKE](Sample_GKE.md) and [Sample_CloudRun](Sample_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never configure
this layer directly — it has no deployment UI inputs of its own — but understanding what
it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs the Sample application, see the
platform guides ([Sample_GKE](Sample_GKE.md), [Sample_CloudRun](Sample_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Sample_Common | Where it surfaces |
|---|---|---|
| Flask secret key | Generates a random 32-character `SECRET_KEY` and stores it in **Secret Manager** | Injected as `SECRET_KEY` env var at runtime |
| Container image | Builds a custom **Python 3.11-slim / Gunicorn** image from the bundled Dockerfile via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy `db-init` job that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | Declares no additional GCS buckets (`storage_buckets = []`) | No extra buckets beyond what you configure in the platform module |
| Core settings | Sets `container_port = 8080`, `FLASK_ENV = production`, startup and liveness probes pointing at `/healthz` | Application behaviour in the platform guides |
| Redis sidecar | When `enable_redis = true`, adds a `redis:alpine` service to `additional_services` | An internal Redis service deployed alongside the Flask app |

---

## 2. Flask `SECRET_KEY` in Secret Manager

The Flask `SECRET_KEY` is generated automatically (32 characters, alphanumeric, no
special characters) and stored as a Secret Manager secret. It is never set in plain text.
Retrieve it after deployment:

```bash
# The secret name follows the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~secret-key"
gcloud secrets versions access latest --secret=<secret-key-secret> --project "$PROJECT"
```

The secret is wired directly into the application container at startup via the
`SECRET_KEY` environment variable. The database password is generated and managed
separately by the foundation; its secret name is reported in the platform deployment
outputs (`database_password_secret`). See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

---

## 3. Database engine and bootstrap

The Sample application requires **PostgreSQL 15**; the engine is fixed at `POSTGRES_15`
and MySQL is not supported. On the first deployment a one-shot `db-init` job runs
`db-init.sh` using the `postgres:15-alpine` image and idempotently:

1. Detects the Cloud SQL Auth Proxy Unix socket under `/cloudsql` and maps it to
   `/tmp/.s.PGSQL.5432`.
2. Waits for PostgreSQL to accept connections via `pg_isready`.
3. Creates the application user (or updates the password if it already exists).
4. Grants the user role to `postgres` (required for Cloud SQL where `postgres` is not a
   true superuser).
5. Creates the application database with the user as owner, or updates the owner if the
   database already exists.
6. Grants all privileges on the database to the application user.
7. Signals the Cloud SQL Auth Proxy to shut down via `POST http://127.0.0.1:9091/quitquitquit`.

The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and Flask application

`Sample_Common` builds a custom image from `scripts/Dockerfile` using `python:3.11-slim`
as the base. The image runs as a non-root user (`appuser`) and starts Gunicorn bound to
port `8080` with 1 worker and 8 threads.

The bundled Flask application (`app.py`) demonstrates all integration patterns:

- **`GET /`** — increments a PostgreSQL visitor counter and optionally tracks per-session
  visits via Redis if `enable_redis = true` and `REDIS_HOST` is set.
- **`GET /healthz`** — returns `{"status": "healthy"}` immediately without a database
  query. Used by both startup and liveness probes.
- **`GET /db`** — executes `SELECT version()` and returns the PostgreSQL version string.
  Useful for verifying end-to-end database connectivity after deploy.

The application reads connection details from the standard environment variables
(`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`) and supports both Unix
socket connections (Auth Proxy) and TCP connections.

---

## 5. Health probe behaviour

Both probes target the `/healthz` endpoint, which is lightweight and does not touch the
database:

| Probe | Type | Path / Port | Initial Delay | Period | Failure Threshold |
|---|---|---|---|---|---|
| Startup | HTTP | `GET /healthz` | 10 s | 10 s | 3 |
| Liveness | HTTP | `GET /healthz` | 15 s | 30 s | 3 |

**Platform-specific adjustments:**

- **GKE** uses HTTP probes — in-cluster probe traffic reaches the container directly.
- **Cloud Run** overrides the startup probe to TCP (port 8080) because Cloud Run health
  traffic may be subject to ingress restrictions; the TCP probe only checks that the port
  is open, which is sufficient to gate traffic on startup.

---

## 6. Redis sidecar

When `enable_redis = true`, an internal `redis:alpine` service is added to
`additional_services`. The Flask app uses `Flask-Session` with a Redis backend when
both `ENABLE_REDIS=true` and `REDIS_HOST` is non-empty. When `REDIS_HOST` is empty, a
warning is logged and the app falls back to cookie-based sessions.

**Behaviour differs between platforms:**

- **GKE** — when `redis_host` is empty, `REDIS_HOST` is automatically set to `127.0.0.1`
  (the Redis sidecar runs in the same pod network). For an external Redis instance such
  as Cloud Memorystore, set `redis_host` explicitly to the instance's private IP.
- **Cloud Run** — there is no automatic fallback. `redis_host` must always be set
  explicitly to the internal URL of the Redis Cloud Run service or a Memorystore IP.

Inspect the Redis sidecar:

```bash
# GKE
kubectl get deployments -n "$NAMESPACE"
kubectl exec -n "$NAMESPACE" deploy/<service-name> -- redis-cli -h 127.0.0.1 ping

# Cloud Run
gcloud run services list --project "$PROJECT" --region "$REGION"
```

---

## 7. Object storage

`Sample_Common` declares no additional GCS buckets (`storage_buckets = []`). Any
buckets provisioned for a Sample deployment come from the `storage_buckets` variable
you configure in the platform module (default: one bucket with `name_suffix = "data"`).
List deployed buckets with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Sample-specific, user-facing configuration (variables by group, outputs, and how
to explore each service from the Console and CLI), see the platform guides:
**[Sample_GKE](Sample_GKE.md)** and **[Sample_CloudRun](Sample_CloudRun.md)**.
