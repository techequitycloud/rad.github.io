---
title: "Payload Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Payload CMS module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Payload Common — Shared Application Configuration

`Payload_Common` is the **shared application layer** for Payload CMS. It is
not deployed on its own; instead it supplies the Payload-specific configuration that both
[Payload_GKE](Payload_GKE.md) and
[Payload_CloudRun](Payload_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Payload, see the
platform guides ([Payload_GKE](Payload_GKE.md),
[Payload_CloudRun](Payload_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Payload_Common | Where it surfaces |
|---|---|---|
| Secret | Generates `PAYLOAD_SECRET` (32-character random string) and stores it in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Builds a real Payload starter app from source via Cloud Build — there is **no upstream image** to wrap | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines two sequential first-deploy jobs: `db-init` (role/database creation) and `payload-migrate` (schema migration via the `payload` CLI) | `initialization_jobs` output |
| Object storage | None — `storage_buckets` output is a static empty list | N/A |
| Core settings | Sets container port (3000), database name/user, resource limits | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/admin` | §Observability in the platform guides |

---

## 2. Container image: building from source, not wrapping a vendor image

Payload has **no official Docker image upstream** — confirmed against Payload's own
documentation, which ships only example Dockerfiles meant to be adapted into a real project.
Every other application layer in this catalogue wraps a pullable vendor image; `Payload_Common`
instead builds a real, locally-verified application from source
(`image_source = "custom"`, `container_image = ""`):

- **`scripts/`** is a genuine, buildable Next.js/Payload application — a blank template
  scaffolded with the official `create-payload-app` CLI, configured with the **PostgreSQL
  adapter** (`@payloadcms/db-postgres`) instead of Payload's default MongoDB adapter, to match
  this catalogue's standard Cloud SQL Postgres provisioning. It ships **Next.js 16, Payload
  3.86.0, React 19, on Node 22**.
- **`scripts/Dockerfile`** is a multi-stage build (`deps` → `builder` → `runner`) that fixes two
  real bugs found in the official template/Dockerfile while building this module:
  1. The generated `next.config.ts` does not set `output: 'standalone'` by default, despite the
     official Dockerfile assuming the standalone build output exists.
  2. `npm ci` fails with lockfile-consistency errors when the lockfile was generated on macOS but
     the build runs on Linux/alpine — the Dockerfile uses `npm install` instead.
  A third fix: the blank template ships no `public/` directory, but the runner stage's `COPY
  --from=builder /app/public` unconditionally expects one — the builder stage runs `mkdir -p
  public` first.
- The runner stage keeps **two copies** of the application: the trimmed Next.js **standalone**
  output (enough to serve HTTP traffic) and a full second copy of `node_modules` + `src/` under
  `/app/cli`, used exclusively by the `payload-migrate` init job, which needs the Payload CLI and
  its TypeScript loader (`tsx`) — neither of which the standalone trace includes.

Inspect recent builds:

```bash
gcloud builds list --project "$PROJECT" --limit=10
gcloud builds log <build-id> --project "$PROJECT"
```

---

## 3. Secret in Secret Manager

One secret is generated automatically and stored in Secret Manager — it is never set in plain
text and should not be rotated casually:

- **`PAYLOAD_SECRET`** — a 32-character random alphanumeric string. Payload reads it as
  `process.env.PAYLOAD_SECRET` in `payload.config.ts` to sign its own session/auth tokens.
  Rotating it after first boot invalidates every active session, forcing all users to log back in.

Retrieve the secret after deployment:

```bash
# List the secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~-secret"

# Read the secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its secret name is
reported in the platform deployment outputs (`database_password_secret`). See
[App_Common](App_Common.md) for the shared secret and Workload Identity model.

A 30-second `time_sleep` resource ensures Secret Manager replication completes before the service
or pods attempt to read `PAYLOAD_SECRET`.

---

## 4. Database engine and bootstrap

Payload requires **PostgreSQL**; the engine is fixed to `POSTGRES_15`. Unlike many apps in this
catalogue, Payload's Postgres adapter does **not** create its schema on boot in production —
confirmed locally: booting the built server against a fresh, empty database created zero tables.
Schema only appears via `payload migrate`, which needs an already-generated migration file baked
into the image (`src/migrations/*.ts`, generated once via `payload migrate:create` and
committed).

Two sequential jobs run by default:

1. **`db-init`** (`postgres:15-alpine`) — connects through the Cloud SQL Auth Proxy Unix socket
   and idempotently creates the application role and database.
2. **`payload-migrate`** (`depends_on_jobs = ["db-init"]`, uses the deployed application image
   itself) — runs `./node_modules/.bin/payload migrate` from the `/app/cli` copy of the full
   dependency tree and source. After migrations complete, it signals the Cloud SQL Auth Proxy
   sidecar to shut down (`quitquitquit` on Cloud Run, `http://localhost:9091/quitquitquit` on
   GKE's native sidecar).

The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 5. Health probe behaviour

The default probes target **`/admin`** — Payload's own admin UI route, which returns an
unauthenticated `200` (it serves the login/first-user-creation form) once the Node.js server and
database connection are ready. Payload's actual REST/GraphQL API routes require auth and would
401/403 a probe; root `/` also returns `200` but is app-content-dependent, making `/admin` the
more stable choice.

- **Cloud Run** startup probe: HTTP `/admin`, 20s initial delay, 10s period, 10 retries (default
  `Payload_CloudRun` values — see its Configuration Guide for the exact numbers in force).
- **GKE** startup probe: HTTP `/admin`, 30s initial delay (default `Payload_GKE` values).

Allow several minutes on first boot for the `payload-migrate` job to complete schema setup before
the service is expected to serve real content.

---

## 6. Object storage

`Payload_Common` provisions **no storage bucket**. The `storage_buckets` output is a static empty
list regardless of any Application Module input, so uploaded media in the bundled starter app
goes to local container disk and is **not** persisted across a pod restart or redeploy:

```bash
gcloud storage buckets list --project "$PROJECT"   # no Payload-specific bucket will be listed
```

To make media uploads durable, add a storage adapter (e.g. an S3-compatible adapter pointed at a
GCS bucket) to the application in `scripts/`.

---

For the Payload-specific, user-facing configuration (variables by group, outputs, and how to
explore each service from the Console and CLI), see the platform guides:
**[Payload_GKE](Payload_GKE.md)** and **[Payload_CloudRun](Payload_CloudRun.md)**.
