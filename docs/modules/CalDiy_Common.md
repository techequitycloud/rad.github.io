---
title: "Cal_Common \u2014 Shared Application Configuration"
---

# Cal_Common — Shared Application Configuration

`CalDiy_Common` is the **shared application layer** for Cal.diy. It is not deployed on
its own; instead it supplies the Cal.diy-specific configuration that both
[Cal_GKE](CalDiy_GKE.md) and [Cal_CloudRun](CalDiy_CloudRun.md) build on, so the two
platform variants behave identically where it matters. End users never configure this
layer directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Cal.diy, see the platform
guides ([Cal_GKE](CalDiy_GKE.md), [Cal_CloudRun](CalDiy_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by CalDiy_Common | Where it surfaces |
|---|---|---|
| Application secrets | Generates `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY` and stores them in **Secret Manager** | Retrieved via Secret Manager (see below) |
| Container image | Pins `calcom/cal.com` as the base image and supplies a Dockerfile for building the wrapper image | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the `db-init` job (PostgreSQL setup), `db-migrate` job (Prisma migrations), and `seed-app-store` job (app store seeding) that run in sequence on first deploy | `initialization_jobs` output |
| `DATABASE_URL` assembly | Builds `DATABASE_URL` and `DATABASE_DIRECT_URL` from `DB_*` env vars at container start, making connectivity independent of image version | Runtime container entrypoint |
| Health probe defaults | Supplies a generous startup window (`initial_delay=60s`, `failure_threshold=30`, `period=10s` on GKE; `initial_delay=180s`, `failure_threshold=18` via `start.sh` path on Cloud Run) to accommodate first-boot migrations and seeding | §Observability in the platform guides |

---

## 2. Application secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager — they are never
set in plain text. Retrieve them after deployment:

```bash
# List all secrets for the deployment:
gcloud secrets list --project "$PROJECT" --filter="name~nextauth OR name~encryption-key"

# Read the current value (e.g., for manual NextAuth configuration):
gcloud secrets versions access latest --secret=<nextauth-secret-name> --project "$PROJECT"
gcloud secrets versions access latest --secret=<encryption-key-name> --project "$PROJECT"
```

| Secret suffix | Environment variable | Purpose |
|---|---|---|
| `*-nextauth-secret` | `NEXTAUTH_SECRET` | NextAuth.js session signing and encryption |
| `*-encryption-key` | `CALENDSO_ENCRYPTION_KEY` | Cal.diy data-at-rest encryption |

A 30-second pause is inserted after secret creation to prevent race conditions when
the container first reads these secrets at startup.

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Cal.diy requires **PostgreSQL 15**; the engine is fixed and MySQL is not supported.
On the first deployment three one-shot jobs run in sequence:

1. **`db-init`** — uses `postgres:15-alpine` and `CalDiy_Common/scripts/db-init.sh`
   to idempotently create the PostgreSQL database, application user, and grant
   privileges.
2. **`db-migrate`** — runs `prisma migrate deploy` against the Cal.diy schema using the
   app image. Ensures all Prisma migrations are applied before the main container
   starts.
3. **`seed-app-store`** — seeds the `App` table with available integrations using
   `seed-app-store.ts`. Depends on `db-migrate` completing first.

All three jobs are idempotent and safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and DATABASE_URL assembly

`CalDiy_Common` always sets `image_source = "custom"` and provides a `Dockerfile` that
builds a wrapper image on top of the official `calcom/cal.com` base image. The wrapper
image includes a custom entrypoint that:

1. URL-encodes the database credentials from the `DB_*` environment variables injected
   by the platform.
2. Assembles `DATABASE_URL` and `DATABASE_DIRECT_URL` (supporting both Unix socket and
   TCP connection modes automatically).
3. Exports both variables, then executes `start.sh` to launch the Next.js server.

This design makes the deployment robust regardless of which image version is in the
registry — the `DATABASE_URL` is always assembled from the current runtime credentials
rather than baked into the image.

Platform-specific adjustments:

- **Cloud Run** also runs `replace-placeholder.sh` inside `start.sh`, which rewrites
  `NEXT_PUBLIC_WEBAPP_URL` into all Next.js static chunks (~2.5 minutes on first boot).
  This is the main reason for the generous Cloud Run startup probe window.
- **GKE** has `NEXT_PUBLIC_WEBAPP_URL` and `NEXTAUTH_URL` resolved to the actual
  LoadBalancer IP or custom domain at apply time via the `$(GKE_SERVICE_URL)` sentinel;
  the startup sequence is correspondingly faster.

---

## 5. Health probe behaviour

The default probes target `/api/auth/session`, which returns HTTP 200 only once
NextAuth.js is fully initialised. This endpoint is reliable across both the base and
wrapper image variants.

- **GKE** uses an HTTP probe with a 60-second initial delay and a `failure_threshold`
  of 30 at 10-second intervals (5 minutes of tolerance after the initial delay) to
  accommodate `db-migrate` and `seed-app-store` completing before the pod is declared
  ready.
- **Cloud Run** sets a longer `initial_delay_seconds = 180` to cover `replace-placeholder.sh`
  (~2.5 min) in addition to the migration and seeding steps. The total startup window
  is approximately 6 minutes.

A readiness probe (`/api/auth/session`, `initial_delay=30s`) is also hardcoded and not
user-configurable.

---

## 6. Object storage

A default Cloud Storage `data` bucket is declared here and provisioned by the
foundation, which also grants the workload service account access. Unlike applications
with media uploads, Cal.diy does not require shared NFS — all booking state lives in
PostgreSQL. Additional buckets can be declared in the platform module's `storage_buckets`
variable. List them with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Cal.diy-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Cal_GKE](CalDiy_GKE.md)** and **[Cal_CloudRun](CalDiy_CloudRun.md)**.
