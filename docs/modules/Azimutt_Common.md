---
title: "Azimutt Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Azimutt module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Azimutt Common — Shared Application Configuration

`Azimutt_Common` is the **shared application layer** for Azimutt. It is not deployed
on its own; instead it supplies the Azimutt-specific configuration that both
[Azimutt_GKE](Azimutt_GKE.md) and [Azimutt_CloudRun](Azimutt_CloudRun.md) build on,
so the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

Azimutt is an open-source, next-generation database-schema explorer and ERD tool
built with **Elixir/Phoenix**. The upstream `ghcr.io/azimuttapp/azimutt` image runs
`sh -c "/app/bin/migrate && /app/bin/server"` — it applies its own Ecto migrations
on boot and then serves the Phoenix endpoint on port **4000**. A single container
serves the whole application.

For the infrastructure that actually provisions and runs Azimutt, see the platform
guides ([Azimutt_GKE](Azimutt_GKE.md), [Azimutt_CloudRun](Azimutt_CloudRun.md)) and
the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Azimutt_Common | Where it surfaces |
|---|---|---|
| Cryptographic secret | Generates a stable 64-byte Phoenix `SECRET_KEY_BASE` and stores it in **Secret Manager** | Injected automatically as a secret env var; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `ghcr.io/azimuttapp/azimutt` image with a thin cloud entrypoint; builds via Cloud Build and mirrors into Artifact Registry | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** (`POSTGRES_15`) as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the role, database, and grants | `initialization_jobs` output |
| Object storage | Declares a **Cloud Storage** bucket (`storage` suffix) | `storage_buckets` output |
| Core settings | Sets the baseline Azimutt environment: `PHX_SERVER`, `FILE_STORAGE_ADAPTER`, fixed port 4000 | Application behaviour in the platform guides |
| Runtime DB wiring | The cloud entrypoint composes `DATABASE_URL`, `DATABASE_ENABLE_SSL`, and `PHX_HOST` at container start | §Application behaviour in the platform guides |
| Health checks | Supplies the default readiness probe targeting `/` | §Observability in the platform guides |

---

## 2. Cryptographic secret in Secret Manager

One secret is generated automatically and stored in Secret Manager — it is never set
in plain text:

- **`SECRET_KEY_BASE`** — a 64-character random string (Phoenix requires at least 64
  bytes of entropy). Azimutt uses it to sign and encrypt session cookies. It is
  generated once and stored in the secret
  `secret-<resource-prefix>-<app>-secret-key-base`, so it stays stable across
  container restarts and redeploys. **Rotating it after first boot invalidates every
  active session cookie** — all logged-in users are signed out and must log in again.

Retrieve the secret after deployment:

```bash
# List the Azimutt secret (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"

# Read the secret value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared secret
and Workload Identity model.

---

## 3. Database engine and bootstrap

Azimutt requires **PostgreSQL 15**; the engine is fixed (`database_type = POSTGRES_15`)
and MySQL or other engines are not supported. On the first deployment a one-shot job
(`db-init`) runs using `postgres:15-alpine` and idempotently:

1. Waits for PostgreSQL to be reachable (`psql` retry loop),
2. Creates the application role with `LOGIN CREATEDB` (or `ALTER`s it) using the
   generated password,
3. Creates the application database if it does not exist (owned by `postgres`, since
   Cloud SQL's `postgres` login cannot `SET ROLE` to application roles),
4. Grants `ALL PRIVILEGES` on the database, grants `ALL ON SCHEMA public`, and
   `ALTER SCHEMA public OWNER` to the application role — required because Azimutt
   runs its own Ecto migrations on boot as that role and Postgres 15 no longer grants
   `CREATE` on `public` by default,
5. Signals the Cloud SQL Auth Proxy sidecar to shut down (`/quitquitquit`) so the GKE
   Job pod completes.

The job **only provisions the role, database, and grants** — Azimutt itself runs the
schema migrations (`/app/bin/migrate`) on every container start. The job is safe to
re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and cloud entrypoint

The custom image is a **thin wrapper FROM `ghcr.io/azimuttapp/azimutt:<version>`**.
Because it is a prebuilt upstream image, `enable_image_mirroring = true` mirrors it
into Artifact Registry, and a Cloud Build produces the wrapped image. The Dockerfile
uses an app-specific build ARG (`AZIMUTT_VERSION`) rather than the generic
`APP_VERSION` — the Foundation injects `APP_VERSION` into `build_args` and would
otherwise clobber the base tag. `application_version = "latest"` is mapped to
Azimutt's rolling **`main`** tag (Azimutt publishes no `:latest` tag).

The `cloud-entrypoint.sh` runs before Azimutt's own command and:

- **Composes `DATABASE_URL`** from the Foundation-injected `DB_*` variables. Azimutt
  reads a single `DATABASE_URL` (Ecto/postgrex) and its password is a runtime secret
  that cannot be interpolated into a URL at plan time, so the URL is built at
  container start (the password is URL-encoded in pure POSIX sh).
- **Selects the connection path by `DB_HOST`.** Ecto/postgrex cannot parse the Cloud
  SQL Unix-socket DSN, so Azimutt always connects over **TCP**:
  - `DB_HOST` is `127.0.0.1`/`localhost` → the GKE Cloud SQL Auth Proxy sidecar
    loopback, `DATABASE_ENABLE_SSL=false` (the proxy terminates TLS).
  - otherwise (Cloud Run) → the instance private IP (`DB_IP`) with
    `DATABASE_ENABLE_SSL=true` (Cloud SQL rejects unencrypted private-IP TCP).
- **Derives `PHX_HOST`** by stripping the scheme and path from the injected service
  URL (`CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`) — Phoenix needs a bare host.
- **Defaults `PORT=4000`** (on Cloud Run `PORT` is auto-injected; on GKE it is not),
  sets `PHX_SERVER=true`, then **hands off to the image's own
  `/app/bin/migrate && /app/bin/server`** command (Ecto migrations run first).

---

## 5. Core application settings

`Azimutt_Common` establishes the baseline Azimutt environment so the application
comes up correctly on first boot:

- **`PHX_SERVER = "true"`** — starts the Phoenix HTTP server (the image defaults it
  to `false`).
- **`FILE_STORAGE_ADAPTER`** — defaults to `"local"`. This is a hard-required
  (`fetch_env!`) variable in Azimutt's `runtime.exs`; `"local"` writes uploads to the
  container's local disk and avoids the `S3_BUCKET` requirement. Azimutt's project
  data (schemas, diagrams, layouts) lives in **PostgreSQL**, not in file storage.
- **Fixed port 4000** — Azimutt's Phoenix endpoint listens on `PORT` (4000); this is
  not overridable via `environment_variables` (`PORT` is reserved on Cloud Run).
- **`SECRET_KEY_BASE`** is injected from Secret Manager as a secret env var.

Platform-specific behaviour handled by the entrypoint at runtime: `DATABASE_URL`,
`DATABASE_ENABLE_SSL`, and `PHX_HOST` are all composed from the injected `DB_*` and
service-URL variables (see §4).

---

## 6. Health probe behaviour

Azimutt does not expose a dedicated health endpoint, so the default probes target the
Phoenix root path `/`, which returns 200 once the server has booted and connected to
PostgreSQL. A generous startup window accommodates the Ecto migrations that run on
first boot:

- The Common **readiness probe** is HTTP `GET /` with a 30-second initial delay.
- The variant **startup probe** default is HTTP `GET /` with a 60-second initial
  delay (Azimutt boots slowly because migrations run before the endpoint binds).

The per-variant `startup_probe` / `liveness_probe` inputs can override these.

---

## 7. Object storage

A dedicated **Cloud Storage** bucket (`storage` name suffix, `STANDARD`,
`public_access_prevention = enforced`) is declared here and provisioned by the
foundation, which also grants the workload service account access. Note that with the
default `FILE_STORAGE_ADAPTER = "local"`, Azimutt writes uploads to the container's
local disk rather than to this bucket; the bucket is provisioned for operators who
switch Azimutt to an S3-compatible file adapter. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

On **GKE** the variant additionally enables NFS (`enable_nfs = true`) so Azimutt
attachment storage survives pod restarts — see [Azimutt_GKE](Azimutt_GKE.md).

---

For the Azimutt-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Azimutt_GKE](Azimutt_GKE.md)** and **[Azimutt_CloudRun](Azimutt_CloudRun.md)**.
