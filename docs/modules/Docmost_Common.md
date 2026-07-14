---
title: "Docmost Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Docmost module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Docmost Common — Shared Application Configuration

`Docmost_Common` is the **shared application layer** for Docmost. It is not deployed
on its own; instead it supplies the Docmost-specific configuration that both
[Docmost_GKE](Docmost_GKE.md) and [Docmost_CloudRun](Docmost_CloudRun.md) build on,
so the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Docmost, see the platform
guides ([Docmost_GKE](Docmost_GKE.md), [Docmost_CloudRun](Docmost_CloudRun.md)) and
the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

Docmost is an open-source, real-time collaborative wiki and documentation platform
(a Confluence/Notion alternative), built on NestJS with a Postgres data store and a
Redis-backed collaboration/queue layer.

---

## 1. What this layer provides

| Area | Provided by Docmost_Common | Where it surfaces |
|---|---|---|
| Cryptographic secret | Generates `APP_SECRET` (64-hex, 32 random bytes) and stores it in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `docmost/docmost` image with a custom entrypoint; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** (`POSTGRES_15`) as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants | `initialization_jobs` output |
| Cache & collaboration | Requires **Redis** for real-time editing and background queues (enabled by default) | §Redis in the platform guides |
| File storage | Local storage driver (`STORAGE_DRIVER = local`) writing to an **NFS-backed** volume at `/app/data/storage` | §Storage in the platform guides |
| Object storage | Declares a **Cloud Storage** data bucket (`storage` suffix) | `storage_buckets` output |
| Core settings | Sets the baseline Docmost environment: `NODE_ENV`, storage driver, upload limit, and the public `APP_URL` | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/api/health` | §Observability in the platform guides |

---

## 2. Cryptographic secret in Secret Manager

A single application secret is generated automatically and stored in Secret Manager —
it is never set in plain text and must never be changed after the first deployment:

- **`APP_SECRET`** — a 64-character hex string derived from 32 random bytes
  (`random_id.app_secret`), following the upstream `openssl rand -hex 32`
  recommendation. Docmost uses it to sign and encrypt session tokens and sensitive
  stored data. Rotating it after first boot invalidates all existing sessions and
  renders any data encrypted under the old value unrecoverable.

The secret is created in `secrets.tf` under the name
`secret-<tenant-prefix>-docmost-app-secret`, exposed to the wrappers through the
`secret_ids` output (env var `APP_SECRET`), and additionally surfaced through the
`secret_values` output for the GKE explicit-secret-values path (GKE materialises its
own Kubernetes Secret from the value).

Retrieve the secret after deployment:

```bash
# List the Docmost secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~docmost-app-secret"

# Read the secret value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Docmost requires **PostgreSQL 15**; the engine is fixed (`database_type = "POSTGRES_15"`)
and MySQL or other engines are not supported. On the first deployment a one-shot job
(`db-init`) runs using `postgres:15-alpine` and idempotently:

1. Detects the Cloud SQL Auth Proxy Unix socket under `/cloudsql` and maps it to the
   standard `psql` socket name (clearing `DB_IP` so the socket wins),
2. Chooses the correct SSL mode for the connection hop — `disable` for the socket /
   loopback proxy, `require` for a direct private-IP TCP hop,
3. Waits for PostgreSQL to be reachable (`pg_isready`),
4. Creates (or updates the password of) the application user,
5. Grants the app role to `postgres` so it can be set as owner,
6. Creates (or reconfigures) the application database with that user as owner,
7. Grants all privileges on the database and the `public` schema,
8. Signals the Cloud SQL Auth Proxy sidecar to shut down gracefully
   (`POST /quitquitquit`) so the Job can complete.

The job is safe to re-run. Docmost does **not** need a separate migration step — the
application runs its own schema migrations automatically on every boot (`pnpm start`),
so the `db-init` job only has to provision the empty database and role.

Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database (`docmost`), and user (`docmost`) names are in the platform
deployment outputs.

---

## 4. Container image and entrypoint

The custom image (`scripts/Dockerfile`) wraps `docmost/docmost:<version>` with a
thin shell entrypoint (`scripts/entrypoint.sh`) that runs before Docmost's default
`pnpm start` command:

- **App-specific build ARG.** The base-image tag is set through a `DOCMOST_VERSION`
  build ARG — a distinct name the foundation does **not** inject — so the generic
  `APP_VERSION = "latest"` injection cannot clobber the intended tag. `Docmost_Common`
  maps `application_version → DOCMOST_VERSION` (with `"latest"` mapping to itself).
- **Adds `bash` + `postgresql-client`.** The base image (`node:22-slim`, Debian)
  ships neither; both are needed to assemble the connection URLs and to `pg_isready`
  before starting.
- **Assembles `DATABASE_URL`.** The platform injects the individual pieces
  (`DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_IP`, `DB_NAME`, `DB_PORT`) but not a
  ready-made URL. The entrypoint branches on `DB_HOST`:
  - **Cloud Run** (socket directory `/cloudsql/...`) — Docmost's `postgres.js` driver
    derives the host only from the URL authority and splits it on `:`, so the Cloud
    SQL socket path (which contains colons) can never appear in the URL. The
    entrypoint therefore connects to the Cloud SQL **private IP over TCP** with
    `sslmode=require` (Cloud SQL rejects unencrypted private-IP TCP).
  - **GKE** (`127.0.0.1` Auth Proxy sidecar) — plaintext loopback, `sslmode=disable`.
  - **Direct private IP** — `sslmode=require`.
- **Assembles `REDIS_URL`.** Uses the foundation-injected `REDIS_URL`/`REDIS_HOST`
  (with optional `REDIS_AUTH`), or falls back to the NFS server IP (`NFS_SERVER_IP`,
  where the platform co-hosts Redis) so Docmost can start.
- **Sets `APP_URL`.** The foundation injects the predicted public service URL via
  `service_url_env_var_name = "APP_URL"`; the entrypoint also falls back to the
  platform-injected `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`. Docmost builds
  absolute links and its collaboration WebSocket endpoint from `APP_URL`.
- **Waits for the database**, ensures `/app/data/storage` exists (the NFS mount
  point), then `exec`s the default `pnpm start`.

Note: `PORT` is intentionally **not** set here — it is a Cloud Run reserved env name
that the platform injects to match `container_port = 3000`, and Docmost's entrypoint
reads `${PORT:-3000}`.

---

## 5. Core application settings

`Docmost_Common` establishes the baseline Docmost environment so the application
comes up correctly on first boot:

- **`NODE_ENV = "production"`.**
- **`STORAGE_DRIVER = "local"`** — attachments are written to the local filesystem
  at `/app/data/storage`, which the wrappers back with the **NFS** volume so uploads
  survive restarts and are shared across instances.
- **`FILE_UPLOAD_SIZE_LIMIT = "50mb"`.**
- **`APP_URL`** — injected as the predicted public service URL (see the entrypoint,
  §4). Docmost derives absolute links and the real-time collaboration endpoint from it.
- **`DATABASE_URL` / `REDIS_URL` / `APP_SECRET`** are assembled at runtime or injected
  as a secret — they are deliberately **not** set as plain env vars here.

Container defaults: `container_port = 3000`, no PostgreSQL extensions are installed
(`enable_postgres_extensions = false`; Docmost's migrations create everything they need).

---

## 6. Redis (required)

Unlike file-centric wikis that keep everything in Postgres, Docmost uses **Redis** for
real-time collaborative editing coordination and background job queues. Redis is
therefore **enabled by default** in both platform variants (`enable_redis = true`).
When `redis_host` is left empty, the platform co-hosts Redis on the NFS server VM and
injects its IP; the entrypoint assembles `REDIS_URL` from the injected values. See
the platform guides for how to point Docmost at an external/managed Redis instead.

---

## 7. File storage

Docmost's local storage driver writes uploaded attachments under `/app/data/storage`
(the image's declared `VOLUME`). The wrappers mount the **NFS** share at that exact
path (`nfs_mount_path = "/app/data/storage"`, `enable_nfs = true` by default) so
attachments persist across restarts and are visible to every instance.

`Docmost_Common` additionally declares a **Cloud Storage** data bucket (`storage`
suffix) that the foundation provisions and grants the workload service account access
to. With the default `local` driver, attachments live on NFS rather than in this
bucket; the bucket is available if you switch Docmost to an object-storage driver.

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

## 8. Health probe behaviour

The default startup and liveness probes target **`/api/health`** — Docmost's public,
unauthenticated health endpoint that returns HTTP 200 once the server is up. The
startup probe allows a 60-second initial delay plus a retry window (period 10s,
failure threshold 6) to cover the automatic first-boot migrations; the liveness probe
uses a 60-second initial delay, 30-second period, and failure threshold 3.

---

For the Docmost-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Docmost_GKE](Docmost_GKE.md)** and **[Docmost_CloudRun](Docmost_CloudRun.md)**.
