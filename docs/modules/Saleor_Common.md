---
title: "Saleor Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Saleor module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Saleor Common — Shared Application Configuration

`Saleor_Common` is the **shared application layer** for Saleor. It is not deployed
on its own; instead it supplies the Saleor-specific configuration that both
[Saleor_GKE](Saleor_GKE.md) and [Saleor_CloudRun](Saleor_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Saleor, see the platform
guides ([Saleor_GKE](Saleor_GKE.md), [Saleor_CloudRun](Saleor_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Saleor_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `SECRET_KEY` (Django signing key), `RSA_PRIVATE_KEY` (JWT signing keypair), and `DJANGO_SUPERUSER_PASSWORD`, all in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `ghcr.io/saleor/saleor` image with a custom entrypoint; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine, regardless of the calling module's own `database_type` variable | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job pair `db-init` → `db-migrate` (role/database creation, then Django migrations) | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** `media` bucket | `storage_buckets` output |
| Background processing | Starts a co-located Celery worker + beat scheduler as a background process inside the main container | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/health/` | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Three secrets are generated automatically and stored in Secret Manager — they are
never set in plain text:

- **`SECRET_KEY`** — a 50-character random string. Django's cryptographic signing
  key, used for session/cookie signing and other cryptographic operations.
- **`RSA_PRIVATE_KEY`** — a 2048-bit RSA private key (PEM), generated once via
  Terraform's `tls_private_key` resource. Saleor reads this directly as
  `settings.RSA_PRIVATE_KEY` (confirmed in `saleor/core/jwt_manager.py`) to sign
  every JWT access/refresh token it issues. **Must never be rotated casually** —
  without a stable key, Saleor falls back to generating a temporary one on every
  restart, invalidating every issued token and forcing every session to
  re-authenticate.
- **`DJANGO_SUPERUSER_PASSWORD`** — a 24-character random string. Password for the
  bootstrap superuser account, ensured idempotently on every container boot via
  `manage.py createsuperuser --email <SALEOR_SUPERUSER_EMAIL> --noinput` (a no-op if
  the user already exists).

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~saleor-key OR name~saleor-rsa-key OR name~saleor-admin-password"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared secret
model.

---

## 3. Database engine and bootstrap

Saleor requires **PostgreSQL 15**; the engine is fixed by `Saleor_Common` and MySQL
or other engines are not supported, regardless of what the calling
`Saleor_CloudRun`/`Saleor_GKE` module's own `database_type` variable is set to. On
the first deployment two sequential jobs run:

1. **`db-init`** (`postgres:15-alpine`, `db-init.sh`) — connects through the Cloud
   SQL Auth Proxy and idempotently creates the application database and role.
2. **`db-migrate`** (application image, `depends_on_jobs = ["db-init"]`,
   `migrate.sh`) — runs `python3 manage.py migrate --noinput` against the newly
   created schema.

Both jobs are idempotent and safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.
`pg_trgm`, `unaccent`, `hstore`, and `citext` extensions are declared as always
enabled in the assembled `config` object (`enable_postgres_extensions = true`,
`postgres_extensions = ["pg_trgm", "unaccent", "hstore", "citext"]`), independent
of the calling module's own `enable_postgres_extensions`/`postgres_extensions`
variables.

---

## 4. Container image and entrypoint

The custom image is a thin wrapper `FROM ghcr.io/saleor/saleor:${SALEOR_VERSION}`
(default `3.23`), adding only a cloud entrypoint script:

- **App-specific version ARG.** The Dockerfile's `SALEOR_VERSION` build ARG is
  intentionally distinct from the Foundation's generic `APP_VERSION` (which the
  Foundation injects into `build_args` and would otherwise force the invalid tag
  `saleor:latest`); `Saleor_Common` maps `application_version == "latest"` to the
  pinned default `3.23`.
- **Composes `DATABASE_URL` at container start.** Since the database password is a
  runtime secret unknown at plan time and Cloud Run does not interpolate `$(VAR)`
  env refs the way Kubernetes does, the entrypoint builds a URL-encoded
  `postgres://` DSN from the Foundation-injected `DB_*` vars, branching on whether
  `DB_HOST` is a Unix socket directory (Cloud Run) or a TCP host (Cloud Run `DB_IP`
  / GKE's Cloud SQL Auth Proxy loopback).
- **Composes `CACHE_URL`/`CELERY_BROKER_URL`** from `REDIS_HOST`/`REDIS_PORT` when
  Redis is enabled (separate logical Redis DBs: `/0` for cache, `/1` for the Celery
  broker).
- **Optionally bootstraps the superuser** — idempotent, guarded on
  `SALEOR_SUPERUSER_EMAIL` and `DJANGO_SUPERUSER_PASSWORD` both being set.
- **Starts the Celery worker + beat scheduler in the background** whenever the
  container's command is the default `uvicorn` (i.e. the main API server, not an
  init job invoking its own script directly) — `celery -A saleor
  --app=saleor.celeryconf:app worker --loglevel=info -B &`, with a `TERM`/`INT`
  trap that stops the worker cleanly on shutdown.
- **Re-declares the base image's `CMD` verbatim** in the wrapper Dockerfile — Docker
  only carries `CMD` forward when a child Dockerfile leaves `ENTRYPOINT` untouched,
  so declaring a new `ENTRYPOINT` (the cloud entrypoint script) silently discards
  the inherited `CMD` unless it is redeclared exactly
  (`uvicorn saleor.asgi:application --host=0.0.0.0 --port=8000 --workers=2 ...`,
  confirmed via `docker inspect` of the upstream image).

**Why the Celery worker is co-located rather than a sidecar or `additional_services`
entry:** `additional_services` only accepts a prebuilt `image` reference, but the
worker needs the exact same custom-built thin-wrapper image whose Artifact Registry
path is only known *inside* the Foundation module (referencing it back into
`additional_services` from the calling module would be a plan-time cycle). On GKE,
a separate Deployment would also run under its own ServiceAccount rather than the
main app's. This is why `cpu_always_allocated` defaults to `true` on both
platforms — the worker needs continuous CPU between requests, not just during
request handling.

---

## 5. Core application settings

`Saleor_Common` establishes the baseline environment so the application comes up
correctly on first boot:

- **`ALLOWED_HOSTS = "*"`** — standard Django host-header protection, relaxed
  because the platform already sits behind Cloud Run/GKE's own edge.
- **`SALEOR_SUPERUSER_EMAIL`** — injected from `Saleor_Common`'s own `admin_email`
  variable (default `admin@example.com`), only when non-empty. Neither
  `Saleor_CloudRun` nor `Saleor_GKE` exposes this as a user-facing variable — it is
  always the Common module's own default unless the wiring file is edited directly.
- **Container port `8000`** — uvicorn's default bind port, confirmed via
  `docker inspect` of the base image.

---

## 6. Health probe behaviour

The default probes target `/health/` — Saleor's unauthenticated health endpoint,
confirmed to return `200` as soon as the ASGI server accepts connections (both in
local container testing and live on both deployed platforms).

- **Cloud Run** uses HTTP probes targeting `/health/` with a 20-second initial delay
  and a 20-failure threshold (15-second period) for startup, and a 30-second initial
  delay / 3-failure threshold for liveness.
- **GKE** uses the same `/health/` path with a 90-second startup initial delay
  (allowing time for `db-migrate` to complete first) and a 60-second liveness
  initial delay.

---

## 7. Object storage

A dedicated Cloud Storage bucket (`name_suffix = "media"`) is declared here and
provisioned by the foundation, which also grants the workload service account
read/write access. The bucket is provisioned in the deployment region with
`public_access_prevention = "inherited"`. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

No other GCS volumes or NFS storage are configured for Saleor beyond this default.

---

For the Saleor-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[Saleor_GKE](Saleor_GKE.md)** and **[Saleor_CloudRun](Saleor_CloudRun.md)**.
