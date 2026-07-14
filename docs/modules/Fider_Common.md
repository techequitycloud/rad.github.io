---
title: "Fider Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Fider module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Fider Common — Shared Application Configuration

`Fider_Common` is the **shared application layer** for Fider. It is not deployed on
its own; instead it supplies the Fider-specific configuration that both
[Fider_GKE](Fider_GKE.md) and [Fider_CloudRun](Fider_CloudRun.md) build on, so the
two platform variants behave identically where it matters. End users never configure
this layer directly — it has no deployment UI inputs of its own — but understanding
what it provides explains the defaults you see in the platform docs.

Fider (https://fider.io) is a lightweight, single-binary Go feedback and
feature-voting board backed by PostgreSQL: customers post ideas, vote, and comment,
and you prioritise by demand. One container serves the entire app — there is **no
worker or queue process** — and it runs its schema migrations on boot. The first
visit walks an operator through creating the site and its admin owner.

For the infrastructure that actually provisions and runs Fider, see the platform
guides ([Fider_GKE](Fider_GKE.md), [Fider_CloudRun](Fider_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Fider_Common | Where it surfaces |
|---|---|---|
| Cryptographic secret | Generates a stable 64-character `JWT_SECRET` and stores it in **Secret Manager** | Injected automatically as `JWT_SECRET`; retrieve via Secret Manager (see below) |
| Container image | Builds a thin wrapper `FROM getfider/fider` with a custom cloud entrypoint via Cloud Build (Kaniko); mirrors into Artifact Registry | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** (`POSTGRES_15`) as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the role, database, grants, and chowns the `public` schema | `initialization_jobs` output |
| Schema migrations | Run by the entrypoint (`./fider migrate`) on every container start — no separate migrate job | Application behaviour in the platform guides |
| Object storage | Declares one **Cloud Storage** bucket (suffix `storage`) | `storage_buckets` output |
| Core settings | Composes `DATABASE_URL` at runtime, derives `BASE_URL`, sets `PORT = 3000`, and supplies email placeholders | Application behaviour in the platform guides |
| Health checks | Supplies the default startup / liveness / readiness probes targeting `/_health` | §Observability in the platform guides |

---

## 2. Cryptographic secret in Secret Manager

One secret is generated automatically and stored in Secret Manager — it is never set
in plain text and **must never be changed after the first deployment**:

- **`JWT_SECRET`** — a 64-character random string (`secret-<prefix>-<app>-jwt-secret`).
  Fider signs all authentication and session tokens with it (including the magic
  sign-in links it emails). If it changed on every deploy, all outstanding sessions
  and pending sign-in links would break, so the value is generated once and pinned in
  Secret Manager (mirroring the Chatwoot `SECRET_KEY_BASE` pattern). It survives
  restarts and redeploys.

Retrieve the secret after deployment:

```bash
# List the JWT secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~jwt-secret"

# Read the secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Fider requires **PostgreSQL 15**; the engine is fixed (`POSTGRES_15`) and MySQL or
other engines are not supported. On the first deployment a one-shot job (`db-init`)
runs using `postgres:15-alpine` and idempotently:

1. Resolves the database host — a Cloud SQL Auth Proxy Unix-socket directory
   (Cloud Run), `127.0.0.1` (the GKE Auth Proxy sidecar), or a private IP,
2. Waits for PostgreSQL to be reachable,
3. Creates (or reconfigures) the `fider` role with `LOGIN CREATEDB` and the generated
   password,
4. Creates the `fider` database if it does not exist (owned by `postgres`, since the
   Cloud SQL `postgres` login cannot `SET ROLE` to application roles),
5. Grants all privileges on the database and the `public` schema, and reassigns
   ownership of `public` to the `fider` role — required because PostgreSQL 15 no
   longer grants `CREATE` on `public` by default and Fider runs its own migrations as
   the application role,
6. Signals the Cloud SQL Auth Proxy to shut down gracefully so the GKE Job pod can
   complete.

The job is safe to re-run. There is **no separate migrate or superuser job** — Fider
applies its own schema migrations on boot (see §5). Inspect the database directly
with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image is a **thin wrapper** built `FROM getfider/fider:<FIDER_VERSION>`
via Cloud Build (Kaniko) and mirrored into Artifact Registry. `getfider/fider` is an
Alpine image (busybox `sh`, no `python3`), so the entrypoint is pure POSIX shell and
does its own URL-encoding. A cloud entrypoint (`cloud-entrypoint.sh`) runs before the
upstream `./fider` binary:

- **Composes `DATABASE_URL`** — Fider (Go / `lib/pq`) reads a single `DATABASE_URL`,
  and the database password is a runtime Secret Manager value that cannot be
  interpolated into a URL at plan time. The entrypoint branches on the injected
  `DB_HOST` to build the correct DSN:
  - a `/…` **socket directory** (Cloud Run) → libpq socket form
    `postgres://u:p@/db?host=<socketdir>&sslmode=disable`,
  - `127.0.0.1` / `localhost` (**GKE Auth Proxy loopback**) → plain TCP,
    `sslmode=disable`,
  - otherwise a **private IP** → TCP with `sslmode=require` (Cloud SQL rejects
    unencrypted private-IP TCP).
- **Derives `BASE_URL`** — from `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`; operators
  can override for a custom domain.
- **Runs migrations** — the upstream default command is `./fider migrate && ./fider`;
  this Dockerfile overrides `CMD` to just `./fider`, so the entrypoint runs
  `./fider migrate` explicitly before handing off (Fider's server does **not** create
  its schema on boot and would panic on a missing `blobs` table otherwise). The step
  is idempotent — Fider tracks applied migrations.
- **Sets `PORT = 3000`** — Cloud Run auto-injects `PORT`; GKE does not, so the
  entrypoint defaults it to 3000 (matching `container_port`).
- **Disables outbound email for the demo** — `EMAIL_NOEMAIL = true`, so Fider prints
  sign-up / invite links to the container log instead of sending mail.
- **Execs `./fider`** as PID 1.

Because the entrypoint and Dockerfile are baked into the image, changes to them
require an image rebuild; the `db-init.sh` job script is mounted at apply time and
takes effect without a rebuild.

---

## 5. Core application settings

`Fider_Common` establishes the baseline Fider environment so the application comes up
correctly on first boot:

- **Port** — `container_port = 3000`; the entrypoint exports `PORT = 3000` on GKE.
- **No Redis** — Fider uses a PostgreSQL-backed queue and cache (empty `VALKEY_URL`),
  so no `REDIS_URL` is injected and `enable_redis` defaults to `false`.
- **Email placeholders** — Fider has no true "no email" mode: with neither Mailgun
  nor SES configured, its env parser defaults the email type to `smtp` and hard
  requires `EMAIL_SMTP_HOST` + `EMAIL_SMTP_PORT` (and `EMAIL_NOREPLY`) at startup, or
  it panics (`exit(2)`). Placeholder values (`EMAIL_NOREPLY = noreply@fider.local`,
  `EMAIL_SMTP_HOST = localhost`, `EMAIL_SMTP_PORT = 25`) let the demo boot; they are
  only dialled when an email is actually sent. Operators wire real SMTP via
  `environment_variables` to enable outbound mail.
- **Schema migrations on boot** — run by the entrypoint (`./fider migrate`), idempotent.
- **First-run setup** — the first web visit walks an operator through creating the
  site and its admin owner interactively; there are no default credentials.

---

## 6. Health probe behaviour

The default startup, liveness, and readiness probes target **`/_health`** — an
unauthenticated endpoint that returns `200` once Fider is serving. A generous startup
window accommodates the migrations that run on first boot.

- **Startup probe** — HTTP `/_health`, 30-second initial delay, 15-second period,
  30 failures allowed (~7.5 minutes of headroom for first-boot migrations).
- **Liveness probe** — HTTP `/_health`, 30-second period.
- **Readiness probe** — HTTP `/_health`, 10-second period.

The `container_port` and the probe port must both be **3000** — on GKE the `PORT` env
is not auto-injected, so a mismatched port makes the probes hit a dead port and the
pod never becomes Ready even though the app is healthy.

---

## 7. Object storage

A single **Cloud Storage** bucket (name suffix `storage`, `STANDARD` class, public
access prevention enforced) is declared here and provisioned by the foundation, which
also grants the workload service account access. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

Note the platform variants additionally default `enable_nfs = true` to provide a
Cloud Filestore mount for Fider attachment storage — see the platform guides.

---

For the Fider-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Fider_GKE](Fider_GKE.md)** and **[Fider_CloudRun](Fider_CloudRun.md)**.
