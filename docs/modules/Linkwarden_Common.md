---
title: "Linkwarden Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Linkwarden module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Linkwarden Common — Shared Application Configuration

`Linkwarden_Common` is the **shared application layer** for Linkwarden. It is
not deployed on its own; instead it supplies the Linkwarden-specific
configuration that both [Linkwarden_GKE](Linkwarden_GKE.md) and
[Linkwarden_CloudRun](Linkwarden_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this
layer directly — it has no deployment UI inputs of its own — but understanding
what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Linkwarden, see the
platform guides ([Linkwarden_GKE](Linkwarden_GKE.md),
[Linkwarden_CloudRun](Linkwarden_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Linkwarden_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `NEXTAUTH_SECRET` (50-char) and stores it in **Secret Manager** | Injected automatically as a secret env var; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `ghcr.io/linkwarden/linkwarden` image with a cloud entrypoint; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the role and database and grants privileges | `initialization_jobs` output |
| Schema migrations | Delegates to the image's own `CMD`, which runs `prisma migrate deploy` on every container start | §Application Behaviour in the platform guides |
| Object storage | Declares a **Cloud Storage** bucket, mounted by the Application modules at `/data/data` (Linkwarden's resolved `STORAGE_FOLDER` path) | `storage_buckets` output |
| Core settings | Sets the baseline Linkwarden environment: telemetry off, archive batch size, browser toggle | Application behaviour in the platform guides |
| Health checks | Supplies the default probe targeting `/` (no confirmed dedicated health endpoint) | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

One secret is generated automatically and stored in Secret Manager — it is
never set in plain text and must never be changed after the first deployment:

- **`NEXTAUTH_SECRET`** — a 50-character random string
  (`secret-<prefix>-linkwarden-nextauth-secret`). Signs the NextAuth session
  JWTs. Rotating it after first boot immediately invalidates every active
  session, forcing all users to log in again.

Linkwarden has **no seeded superuser** — the first user to register through
the standard NextAuth registration flow becomes the instance owner.
`NEXTAUTH_SECRET` is injected into the service container as a secret env var
via the `secret_ids` output.

Retrieve the secret after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~nextauth-secret"

# Read the secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation;
its secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Linkwarden requires **PostgreSQL** (this module pins **PostgreSQL 15**); the
engine is fixed and MySQL or other engines are not supported — Linkwarden's
Prisma schema hardcodes `provider = "postgresql"`. On the first deployment a
one-shot job (`db-init`) runs using `postgres:15-alpine` and idempotently:

1. Detects the Cloud SQL Auth Proxy Unix socket (or private-IP host) and maps
   it for `psql` access,
2. Waits for PostgreSQL to be reachable,
3. Creates (or updates) the application role (`linkwarden`) with
   `LOGIN CREATEDB` and the generated password,
4. Creates the application database (`linkwarden`) if it does not exist,
5. Grants full privileges on the database and the `public` schema (PostgreSQL
   15 no longer grants `CREATE` on `public` by default),
6. Signals the Cloud SQL Auth Proxy to shut down gracefully so the job pod
   completes.

`db-init` only creates the role and database — it does **not** create tables.
Linkwarden runs its own schema migrations (`prisma migrate deploy`) on every
container start (part of the base image's own `CMD`), so the schema is
created and kept current by the application itself, not by a separate
migration job. The job is safe to re-run.

Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=linkwarden --database=linkwarden --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image is a thin wrapper `FROM ghcr.io/linkwarden/linkwarden:<tag>`.
The base tag is controlled by the `LINKWARDEN_VERSION` build ARG, which is
app-specific (**not** the generic `APP_VERSION` the foundation injects) —
Linkwarden genuinely publishes a `latest` tag upstream, so no pinned-version
fallback is needed. The wrapper adds a cloud entrypoint (`entrypoint.sh`) that
runs before the base image's own startup:

- **Composes `DATABASE_URL`** — Linkwarden's Prisma client reads a single
  URL-authority DSN, and the DB password is a runtime Secret Manager value
  that cannot be interpolated into a URL at plan time. A Cloud SQL
  Unix-socket directory path contains colons that break URL-authority
  parsing, so the entrypoint deliberately never puts it in the URL — it
  always connects over the injected `DB_IP`, branching only on whether that
  resolved host is loopback:
  - `127.0.0.1`/`localhost` (the GKE Auth Proxy sidecar) → `sslmode=disable`,
  - any other address (the real Cloud SQL private IP, on Cloud Run) →
    `sslmode=require` (Cloud SQL rejects unencrypted private-IP TCP).
- **Derives `NEXTAUTH_URL`** — appends the required `/api/v1/auth` suffix to
  the already-resolved `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL` the
  Foundation injects at container start (never a literal `$(VAR)` template,
  which Cloud Run passes through unexpanded).
- **Sets `PORT` (3000, if unset) and `HOSTNAME` (`0.0.0.0`)**.
- **Hands off to the base image's own CMD** — `prisma migrate deploy`
  followed by `concurrently` running both the Next.js web server
  (`next start`) and the background archiving worker (`worker.ts`) side by
  side in the same container. This CMD is redeclared verbatim in the
  Dockerfile since declaring a custom `ENTRYPOINT` discards the base image's
  inherited `CMD` (confirmed via `docker inspect`).

Because the entrypoint and Dockerfile are baked into the image, changes to
them require an image rebuild; the `db-init` script is mounted at apply time
and takes effect on the next apply with no rebuild.

---

## 5. Core application settings

`Linkwarden_Common` establishes the baseline Linkwarden environment so the
application comes up correctly on first boot:

- **Port** — Linkwarden (Next.js) serves on `3000`; `EXPOSE 3000` in the
  image.
- **Telemetry** — `NEXT_TELEMETRY_DISABLED = "1"`.
- **Sign-up** — Linkwarden has no pre-seeded admin credential; the **first
  user to register becomes the instance owner** via the standard NextAuth
  registration flow.
- **Archiving worker** — the background worker (run via `concurrently`
  alongside the web server) polls PostgreSQL directly and processes queued
  links in batches (`ARCHIVE_TAKE_COUNT`, default `5`) — there is no external
  queue/Redis dependency.
- **Headless Chrome** — bundled in the image (Playwright,
  `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`) for screenshot/PDF/monolith
  archiving, running IN the same process as the web server. `DISABLE_BROWSER`
  can be set to skip all browser-dependent archiving tasks as a fallback if
  headless Chrome misbehaves under a sandboxed runtime.

Platform-specific adjustments handled by the entrypoint:

- **Cloud Run** — `DATABASE_URL` connects over `DB_IP` (the real Cloud SQL
  private IP) with `sslmode=require`; `NEXTAUTH_URL` is derived from
  `CLOUDRUN_SERVICE_URL`.
- **GKE** — `DATABASE_URL` connects over the Cloud SQL Auth Proxy sidecar on
  `127.0.0.1` with `sslmode=disable`; `NEXTAUTH_URL` is derived from
  `GKE_SERVICE_URL`.

---

## 6. Health probe behaviour

Linkwarden has no confirmed dedicated health-check endpoint, so the default
probes target `/` with a generous startup window to accommodate Next.js cold
start plus headless Chrome/Playwright initialization on first request.

- **Cloud Run** uses an HTTP probe against `/` with a long failure-threshold
  window.
- **GKE** uses HTTP startup/liveness probes against the same path; the
  startup probe's wide failure threshold covers first-boot Prisma migrations
  plus Chrome initialization.

---

## 7. Object storage

A dedicated **Cloud Storage** bucket is declared here and provisioned by the
foundation, which also grants the workload service account access. The
Application modules (`Linkwarden_CloudRun`/`Linkwarden_GKE`) mount it as a GCS
Fuse volume at `/data/data` by default — the path Linkwarden's own storage
code resolves `STORAGE_FOLDER` to (verified against the built image's
compiled output: `path.join(process.cwd(), "../..", STORAGE_FOLDER)`, which
both the web and worker processes resolve to the same `/data` root despite
running from different working directories). List the bucket with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Linkwarden-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Linkwarden_GKE](Linkwarden_GKE.md)** and
**[Linkwarden_CloudRun](Linkwarden_CloudRun.md)**.
