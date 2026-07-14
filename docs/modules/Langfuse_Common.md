---
title: "Langfuse Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Langfuse module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Langfuse Common — Shared Application Configuration

`Langfuse_Common` is the **shared application layer** for Langfuse. It is
not deployed on its own; instead it supplies the Langfuse-specific configuration
that both [Langfuse_GKE](Langfuse_GKE.md) and
[Langfuse_CloudRun](Langfuse_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Langfuse, see the
platform guides ([Langfuse_GKE](Langfuse_GKE.md),
[Langfuse_CloudRun](Langfuse_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Langfuse_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `NEXTAUTH_SECRET` (50-char) and `SALT` (24-char) and stores them in **Secret Manager** | Injected automatically as secret env vars; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `langfuse/langfuse:2` image (v2, Postgres-only) with a cloud entrypoint; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the role and database and grants privileges | `initialization_jobs` output |
| Schema migrations | Delegates to Langfuse's own startup, which runs `prisma migrate deploy` on every container start | §Application Behaviour in the platform guides |
| Object storage | Declares a **Cloud Storage** bucket | `storage_buckets` output |
| Core settings | Sets the baseline Langfuse environment: telemetry off, open sign-up so the first user is the owner, port 3000 | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/api/public/health` | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager — they are never
set in plain text and must never be changed after the first deployment:

- **`NEXTAUTH_SECRET`** — a 50-character random string, stored as
  `secret-<prefix>-langfuse-secret-key`. Signs the NextAuth session JWTs. Rotating it
  after first boot immediately invalidates every active session, forcing all users to log
  in again.
- **`SALT`** — a 24-character random string, stored as
  `secret-<prefix>-langfuse-superuser-password`. Hashes Langfuse API keys before they are
  persisted. Rotating it after first boot permanently invalidates every existing API key;
  SDK clients using those keys receive `401 Unauthorized` until new keys are generated.

Both are **required**. Langfuse validates its entire environment with zod at boot and
refuses to start (`Invalid environment variables`) if either is missing — this is the
single most common cause of a Langfuse revision that never becomes Ready. They are injected
into the service container as secret env vars via the module's `secret_ids` output.

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key OR name~superuser-password"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Langfuse requires **PostgreSQL**; this module pins **PostgreSQL 15**, the engine is fixed,
and MySQL or other engines are not supported. On the first deployment a one-shot job
(`db-init`) runs using `postgres:15-alpine` and idempotently:

1. Detects the Cloud SQL Auth Proxy Unix socket (or private-IP host) and maps it for
   `psql` access,
2. Waits for PostgreSQL to be reachable,
3. Creates (or updates) the application role (`langfuse`) with `LOGIN CREATEDB` and the
   generated password,
4. Creates the application database (`langfuse`) if it does not exist,
5. Grants full privileges on the database and the `public` schema (PostgreSQL 15 no longer
   grants `CREATE` on `public` by default),
6. Signals the Cloud SQL Auth Proxy to shut down gracefully so the job pod completes.

**`db-init` creates only the role and database — never the tables.** Langfuse runs its own
schema migrations (`prisma migrate deploy`) on every container start, so the schema is
created and kept current by the application itself. There is deliberately no separate
migration job. The `db-init` job is safe to re-run.

Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=langfuse --database=langfuse --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image is a thin wrapper `FROM langfuse/langfuse:2` — the **v2, Postgres-only**
line. (Langfuse v3 additionally requires ClickHouse, Redis, and S3 and is out of scope for
this module.) The base tag is controlled by the `LANGFUSE_VERSION` build ARG, which is
app-specific — deliberately **not** the generic `APP_VERSION` the foundation injects and
wins — so `application_version = "latest"` resolves to `2` rather than a non-existent tag.
The wrapper adds a cloud entrypoint (`entrypoint.sh`) that runs before Langfuse's own
startup:

- **Composes `DATABASE_URL`** — Langfuse reads a single Prisma `DATABASE_URL`, and its
  password is a runtime Secret Manager value that cannot be interpolated into a URL at plan
  time. The entrypoint builds the URL from the Foundation-injected `DB_*` vars,
  URL-encoding the password and branching on the host shape:
  - Cloud SQL Unix socket dir (`/cloudsql/...`) → libpq socket form
    (`...@localhost:5432/db?host=/cloudsql/...&sslmode=disable`),
  - loopback (`127.0.0.1`/`localhost`, the GKE Auth Proxy sidecar) → `sslmode=disable`,
  - private-IP TCP → `sslmode=require` (Cloud SQL rejects unencrypted private-IP TCP).
- **Sets `NEXTAUTH_URL`, `PORT` (3000), and `HOSTNAME` (`0.0.0.0`)** — `NEXTAUTH_URL` is
  derived from the injected Cloud Run / GKE service URL so NextAuth callbacks resolve
  correctly.
- **Disables telemetry** (`TELEMETRY_ENABLED=false`).
- **Hands off to Langfuse's own startup** — `exec /app/web/entrypoint.sh`, which runs
  `prisma migrate deploy` and then launches the Next.js server. `NEXTAUTH_SECRET` and
  `SALT` are injected as secret env vars and consumed by that startup.

The `entrypoint.sh` and `Dockerfile` are baked into the image, so edits require a rebuild;
`db-init.sh` is mounted at apply time and takes effect on the next apply with no rebuild.

---

## 5. Core application settings

`Langfuse_Common` establishes the baseline Langfuse environment so the application comes up
correctly on first boot:

- **Port** — Langfuse (Next.js) serves on `3000`.
- **Telemetry** — `TELEMETRY_ENABLED = "false"` (no anonymous usage data sent to the
  Langfuse cloud).
- **Sign-up** — `AUTH_DISABLE_SIGNUP = "false"` by default. Langfuse has no pre-seeded admin
  credential; the **first user to sign up becomes the instance owner**. Override to `"true"`
  via `environment_variables` after onboarding to prevent further self-service registration.
- **Queue & cache** — Langfuse v2 uses a PostgreSQL-backed queue and cache, so no Redis is
  provisioned. `enable_redis` stays `false` unless a deployment explicitly externalizes it.

Platform-specific adjustments handled by the entrypoint:

- **Cloud Run** sets `NEXTAUTH_URL` from the injected `CLOUDRUN_SERVICE_URL` and uses the
  Cloud SQL socket path for `DATABASE_URL`.
- **GKE** sets `NEXTAUTH_URL` from the injected service URL and uses the Cloud SQL Auth Proxy
  sidecar on `127.0.0.1` for `DATABASE_URL` (SSL disabled on loopback). Update
  `NEXTAUTH_URL` to the external LoadBalancer or custom-domain URL via `environment_variables`
  once the external address is known.

---

## 6. Health probe behaviour

The default probes target `/api/public/health` — Langfuse's unauthenticated health endpoint
that returns a 200 only once the server is fully initialised. A generous startup window
accommodates the Prisma migrations that run on first boot (and on any version upgrade).

- **Cloud Run** uses HTTP probes against `/api/public/health` with a wide failure-threshold
  window so first-boot migrations complete before the revision is marked unhealthy.
- **GKE** uses HTTP startup/liveness probes against the same path; the startup probe's wide
  failure threshold covers first-boot migrations.

---

## 7. Object storage

A dedicated **Cloud Storage** bucket is declared here and provisioned by the foundation,
which also grants the workload service account access. Langfuse v2 keeps all trace and
observability data in PostgreSQL; the bucket (and the optionally-mounted NFS share at
`/opt/langfuse/storage`) are available for exports and media rather than primary state. List
it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Langfuse-specific, user-facing configuration (variables by group, outputs, and how
to explore each service from the Console and CLI), see the platform guides:
**[Langfuse_GKE](Langfuse_GKE.md)** and **[Langfuse_CloudRun](Langfuse_CloudRun.md)**.
