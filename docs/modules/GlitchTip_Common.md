---
title: "GlitchTip Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the GlitchTip module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# GlitchTip Common — Shared Application Configuration

`GlitchTip_Common` is the **shared application layer** for GlitchTip. It is not
deployed on its own; instead it supplies the GlitchTip-specific configuration that
both [GlitchTip_GKE](GlitchTip_GKE.md) and [GlitchTip_CloudRun](GlitchTip_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of its
own — but understanding what it provides explains the defaults you see in the
platform docs.

For the infrastructure that actually provisions and runs GlitchTip, see the platform
guides ([GlitchTip_GKE](GlitchTip_GKE.md), [GlitchTip_CloudRun](GlitchTip_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

GlitchTip is an open-source, Sentry-compatible **error-tracking and performance-monitoring**
platform (Django/Python). Your applications send events to GlitchTip's Sentry-protocol
ingest endpoint; GlitchTip stores, groups, and alerts on them.

---

## 1. What this layer provides

| Area | Provided by GlitchTip_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates the Django `SECRET_KEY` (50-char) and the initial superuser password (24-char) and stores them in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `glitchtip/glitchtip:<version>` image (defaults to `latest`) with a cloud entrypoint; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines two first-deploy jobs (`db-init`, `glitchtip-migrate`) that create the database/user, run Django migrations, and create the superuser | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** data bucket (`storage` suffix) | `storage_buckets` output |
| Core settings | Sets the baseline GlitchTip environment: `SERVER_ROLE=all_in_one`, registration state, event retention, disabled Valkey/Redis | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness/readiness probes targeting `/_health/` | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager — they are never
set in plain text:

- **`SECRET_KEY`** — a 50-character random string generated once and stored as
  `secret-<prefix>-<app>-secret-key`. GlitchTip (Django) uses it to sign sessions and
  cookies. It is injected into the running container as the `SECRET_KEY` environment
  variable. Rotating it after first boot invalidates all active sessions, forcing
  every user to log in again.
- **Superuser password** — a 24-character random string stored as
  `secret-<prefix>-<app>-superuser-password`. It is **not** injected into the running
  service; instead the `glitchtip-migrate` job reads it to create the initial
  administrator/owner account (`SUPERUSER_EMAIL`, default `admin@techequity.cloud`)
  so the instance has an owner without opening self-service registration.

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key OR name~superuser-password"

# Read the initial admin password:
gcloud secrets versions access latest --secret=<superuser-password-secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

GlitchTip requires **PostgreSQL 15**; the engine is fixed and MySQL or other engines
are not supported. GlitchTip reads a single `DATABASE_URL`, but the database password
is a runtime Secret Manager value that cannot be interpolated into a URL at plan time,
so the container's cloud entrypoint composes `DATABASE_URL` from the injected `DB_*`
variables at runtime.

Two one-shot jobs run on the first deployment:

1. **`db-init`** (`postgres:15-alpine`) idempotently:
   - Detects the Cloud SQL Auth Proxy socket / loopback and waits for PostgreSQL,
   - Creates (or updates) the application role with `LOGIN CREATEDB` and the generated
     password,
   - Creates the application database (owned by `postgres`; Cloud SQL cannot `SET ROLE`
     to application roles),
   - Grants full privileges on the database and public schema and re-owns `public` to
     the application role (Postgres 15 no longer grants `CREATE` on `public` by default),
   - Signals the Cloud SQL Auth Proxy to shut down gracefully.
2. **`glitchtip-migrate`** (the built GlitchTip app image, `depends_on = ["db-init"]`)
   idempotently:
   - Composes `DATABASE_URL` the same way the runtime entrypoint does,
   - Runs `./manage.py migrate --noinput` (Django schema migrations),
   - Runs `createsuperuser --noinput` with `SUPERUSER_EMAIL` and the Secret Manager
     superuser password (GlitchTip's user model uses email as the username; a duplicate
     is skipped, so re-runs are safe),
   - Signals the Auth Proxy to shut down.

Both jobs run on apply (`execute_on_apply = true`) and are safe to re-run. Inspect the
database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image wraps `glitchtip/glitchtip:<version>` (defaults to `latest`) with a thin POSIX-sh entrypoint
(`entrypoint.sh`, installed as `/usr/local/bin/cloud-entrypoint.sh`) that runs before
the image's own `./bin/start.sh`:

- **Composes `DATABASE_URL`** from the platform-injected `DB_HOST`, `DB_PORT`,
  `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_IP`. It branches on `DB_HOST`:
  - a `/…` **socket directory** (Cloud Run) → `postgres://u:p@/db?host=<socketdir>`
    (the socket path's colons break the `host:port` URL form, so it goes in `?host=`);
  - `127.0.0.1` / `localhost` (**GKE** Auth Proxy sidecar) → plain loopback TCP, no SSL;
  - otherwise a **private IP** → TCP with `sslmode=require` (Cloud SQL rejects
    unencrypted private-IP TCP). Credentials and the socket path are URL-encoded with
    Python 3 (present in the image).
- **Disables Valkey/Redis** — exports `VALKEY_URL=""` so GlitchTip uses PostgreSQL for
  the task queue, cache, and sessions (an unset value would default to Redis).
- **Derives `GLITCHTIP_DOMAIN`** — the public scheme+host, from the injected
  `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`; operators can override for a custom domain.
- **Sets `PORT=8080` and `SERVER_ROLE=all_in_one`**, then `exec`s the image's default
  command (`./bin/start.sh`), which runs the web server plus the Celery worker and beat
  in one process.

The `Dockerfile`/`entrypoint.sh` are baked into the image, so edits require a rebuild;
the `db-init.sh` and `glitchtip-migrate.sh` job scripts are mounted at apply time and
take effect on the next apply with no rebuild.

---

## 5. Core application settings

`GlitchTip_Common` establishes the baseline GlitchTip environment so the application
comes up correctly on first boot:

- **All-in-one role** — `SERVER_ROLE = "all_in_one"` runs the web server, Celery
  worker, and Celery beat inside one container. Because the worker and beat are
  in-process, the platform keeps `min_instance_count >= 1` (and, on Cloud Run,
  `cpu_always_allocated = true`) so background event processing keeps running between
  HTTP requests.
- **Queue/cache backend** — `VALKEY_URL = ""` → PostgreSQL-backed queue and cache; no
  Redis is required for a single instance.
- **Debug** — `DEBUG = "false"`.
- **Registration** — `ENABLE_OPEN_USER_REGISTRATION` and `ENABLE_USER_REGISTRATION`
  default to `"false"` (from `enable_open_user_registration`). The instance owner is
  the superuser created by `glitchtip-migrate`; operators flip these on to allow
  self-service signup.
- **Event retention** — `GLITCHTIP_MAX_EVENT_LIFE_DAYS = "90"` (from
  `max_event_life_days`) purges stored error events older than N days.
- **Port** — `container_port = 8080` (Granian).

---

## 6. Health probe behaviour

The default startup, liveness, and readiness probes target `/_health/` — GlitchTip's
unauthenticated endpoint that returns 200 once the server is up. The startup probe
allows a generous window (60-second initial delay, 30 failure threshold) to
accommodate the first-boot migrations run by `glitchtip-migrate`.

- **Startup** — HTTP `GET /_health/`, 60 s initial delay, 15 s period, 30 failures.
- **Liveness** — HTTP `GET /_health/`, 60 s initial delay, 30 s period, 3 failures.
- **Readiness** — HTTP `GET /_health/`, 30 s initial delay, 10 s period, 3 failures.

---

## 7. Object storage

A dedicated **Cloud Storage** data bucket (declared with the `storage` name suffix) is
declared here and provisioned by the foundation, which also grants the workload service
account access. It backs GlitchTip's uploaded attachments/source maps when object
storage is used; the platform variants also mount NFS at `/opt/glitchtip/storage` for
shared attachment storage. List the bucket with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the GlitchTip-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[GlitchTip_GKE](GlitchTip_GKE.md)** and **[GlitchTip_CloudRun](GlitchTip_CloudRun.md)**.
