---
title: "Plane Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Plane module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Plane Common — Shared Application Configuration

`Plane_Common` is the **shared application layer** for Plane. It is not deployed on its own; instead it supplies the Plane-specific configuration that both [Plane_CloudRun](Plane_CloudRun.md) and the GKE variant build on, so the two platform variants behave identically where it matters. End users never configure this layer directly — it has no deployment UI inputs of its own — but understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Plane, see the platform guide ([Plane_CloudRun](Plane_CloudRun.md)) and the foundation guides ([App_CloudRun](App_CloudRun.md), [App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Plane_Common | Where it surfaces |
|---|---|---|
| Container image | Thin wrapper Dockerfile `FROM makeplane/plane-aio-community:<version>` — the all-in-one image bundling api + worker + beat + web/space/admin + live + migrator behind an internal Caddy proxy on :80 | `container_image` output of the platform deployment |
| Custom entrypoint | Composes `DATABASE_URL` / `REDIS_URL` / `AMQP_URL` from the discrete `DB_*` / `REDIS_*` / `RABBITMQ_*` values the foundation injects, then execs Plane's bundled `/app/start.sh` | Application behaviour in the platform guides |
| Secrets | Auto-generates the Django `SECRET_KEY` (50 chars) and `LIVE_SERVER_SECRET_KEY` (40 chars) in Secret Manager | `secret_ids` / `secret_values` outputs, injected as secret env vars |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** (plain PostgreSQL, no extensions) | §Database in the platform guides |
| Database bootstrap | Defines the `db-init` job (`postgres:15-alpine`) that idempotently creates the database and user | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** `storage` bucket (S3 upload wiring is a documented TODO) | `storage_buckets` output |
| Core environment | `WEB_URL` / `DOMAIN_NAME` / `CORS_ALLOWED_ORIGINS` from the predicted service URL, `SITE_ADDRESS=:80`, `GUNICORN_WORKERS=2`, `DEBUG=0`, Redis and RabbitMQ endpoints, `AWS_*` storage placeholders | Environment of the running container |
| Health checks | Default startup (`/health`, 30 s delay, 30 failures × 10 s) and liveness (`/health`, 30 s delay, period 30 s) probes | §Observability in the platform guides |

---

## 2. Container image and custom entrypoint

Rather than wiring Plane's seven upstream services separately, `Plane_Common` uses the published **all-in-one community image** and layers a platform entrypoint on top via a thin wrapper Dockerfile. The `APPLICATION_VERSION` build-arg pins the base tag; because the upstream image has no `latest` tag, `latest` is mapped to `stable` at build time.

The entrypoint performs these actions on every container start:

1. **Database URL.** Prefers the injected private TCP IP (`DB_IP`) and composes `DATABASE_URL` with `sslmode=require` for direct private-IP connections (Cloud Run) or `sslmode=disable` for the loopback Cloud SQL Auth Proxy (GKE). Also exports the discrete `POSTGRES_*` variables some Plane code paths read.
2. **Redis URL.** Resolves the `$(NFS_SERVER_IP)` placeholder at runtime (Cloud Run does not substitute `$(VAR)` references) and composes `REDIS_URL`.
3. **AMQP URL.** Picks up the RabbitMQ sidecar host (injected as `PLANE_MQ_HOST` on Cloud Run; in-cluster DNS on GKE), strips any scheme/port, and composes `AMQP_URL`. Plane's `start.sh` exits if this is empty — **RabbitMQ is mandatory**.
4. **Domain and storage placeholders.** Derives `DOMAIN_NAME` from `WEB_URL` when unset and exports placeholder `AWS_*` values so `start.sh`'s validation passes (real uploads need real S3 credentials — see §6).
5. **God-mode redirect patch.** Idempotently patches the bundled Caddyfile with a 308 redirect from `/god-mode` to `/god-mode/` (the admin SPA's router basename requires the trailing slash — without it the admin panel spins forever).
6. **Hand-off.** Execs Plane's bundled `/app/start.sh`, which launches supervisord: migrator → api / space / admin / live + worker / beat + the Caddy proxy.

To confirm what the entrypoint composed:

```bash
# Cloud Run — the composed-URL log lines
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 100 \
  | grep -E "Composed (DATABASE|REDIS|AMQP)_URL|Starting Plane"
```

---

## 3. Secrets in Secret Manager

Two application secrets are generated with `random_password` and stored in Secret Manager:

| Secret | Env var | Purpose |
|---|---|---|
| `secret-<prefix>-plane-key` | `SECRET_KEY` | Django cryptographic signing key (50 chars) |
| `secret-<prefix>-plane-live-key` | `LIVE_SERVER_SECRET_KEY` | Shared secret authenticating the real-time `live` collaboration server (40 chars) |

The foundation additionally manages the Cloud SQL password secret. Inspect them:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~plane"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

A 30-second `time_sleep` after secret-version creation absorbs replication lag before the service consumes them.

---

## 4. Database engine and bootstrap

Plane requires **PostgreSQL**; the engine is fixed at `POSTGRES_15` (no extensions needed). On every apply the `db-init` job (`postgres:15-alpine`) idempotently:

1. Waits for the instance with `pg_isready` (socket or private IP).
2. Creates the application user (or resets its password).
3. Grants the user role to `postgres` so ownership can be assigned.
4. Creates the database with the application user as owner (or transfers ownership).
5. Grants all privileges on the database and on `SCHEMA public`.
6. Sends `POST /quitquitquit` to the Cloud SQL Proxy sidecar so the job exits cleanly.

**Schema migrations are not run by the init job** — the AIO image's own `migrator` step (`manage.py migrate`) runs inside supervisord on every container start, before the api and frontends come up.

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
gcloud run jobs executions list --project "$PROJECT" --region "$REGION"
```

---

## 5. Message broker contract

Plane's Celery worker and beat require an AMQP broker, and `Plane_Common` encodes the contract: `RABBITMQ_USER` / `RABBITMQ_PASSWORD` / `RABBITMQ_VHOST` default to `plane`, and the host is supplied by the **platform variant** — an in-pod `rabbitmq:3.13-management-alpine` sidecar at `127.0.0.1:5672` on Cloud Run (AMQP is a non-HTTP protocol Cloud Run service-to-service networking cannot carry). Broker state is ephemeral; durable queues are a documented hardening TODO.

---

## 6. Object storage (TODO)

A **Cloud Storage** `storage` bucket (`gcs-<service-name>-storage`) is declared here and provisioned by the foundation, and the environment points `AWS_S3_ENDPOINT_URL` at `https://storage.googleapis.com` with `USE_MINIO=0`. However, Plane speaks the **S3 API**, and GCS S3-interoperability requires **HMAC keys that are not yet provisioned** — so file uploads (attachments, avatars) fail until real credentials are supplied via the platform module's `environment_variables` (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET_NAME`, `AWS_S3_ENDPOINT_URL`). Issues, projects, cycles, and modules work without it.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~plane"
```

---

## 7. Health probe behaviour

The default probes target `/health` through the internal Caddy proxy on port 80:

- **Startup probe** — HTTP `/health`, initial delay 30 s, period 10 s, failure threshold 30. This gives the AIO container up to 30 + (30 × 10) = 330 seconds from start — deliberate headroom for the first-boot migrator step, which must finish before Caddy answers.
- **Liveness probe** — HTTP `/health`, initial delay 30 s, period 30 s, failure threshold 3.

Do not tighten the startup failure threshold: killing the container mid-migration produces a restart loop.

---

For the Plane-specific, user-facing configuration (variables by group, outputs, and how to explore each service from the Console and CLI), see the platform guide:
**[Plane_CloudRun](Plane_CloudRun.md)**.
