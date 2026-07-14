---
title: "Vikunja Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Vikunja module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Vikunja Common — Shared Application Configuration

`Vikunja_Common` is the **shared application layer** for Vikunja. It is
not deployed on its own; instead it supplies the Vikunja-specific configuration
that both [Vikunja_GKE](Vikunja_GKE.md) and
[Vikunja_CloudRun](Vikunja_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this layer
directly — it has no deployment UI inputs of its own — but understanding what it
provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Vikunja, see the
platform guides ([Vikunja_GKE](Vikunja_GKE.md),
[Vikunja_CloudRun](Vikunja_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Vikunja_Common | Where it surfaces |
|---|---|---|
| Cryptographic secret | Generates `VIKUNJA_SERVICE_JWTSECRET` (32-char random) and stores it in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Wraps the `scratch`-based `vikunja/vikunja` image with a grafted busybox and a custom entrypoint; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants | `initialization_jobs` output |
| Runtime DB wiring | Maps the platform `DB_*` vars onto Vikunja's `VIKUNJA_DATABASE_*` config and chooses the right connection host/SSL mode | Application behaviour in the platform guides |
| Port & health checks | Sets the container port to 3456 and the default startup/liveness probe targeting `/health` | §Observability in the platform guides |

---

## 2. Cryptographic secret in Secret Manager

One secret is generated automatically and stored in Secret Manager — it is never
set in plain text and must never be changed after the first deployment:

- **`VIKUNJA_SERVICE_JWTSECRET`** — a 32-character random string. Vikunja signs all
  user session JWTs with it. If it were left unset, Vikunja randomises it on every
  container start, which invalidates all sessions and logs every user out on each
  restart. `Vikunja_Common` therefore provisions a stable secret. Rotating it after
  first boot immediately invalidates all active sessions, forcing every user to log
  in again.

Retrieve the secret after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~jwt-secret"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Vikunja requires **PostgreSQL 15**; the engine is fixed and MySQL or other
engines are not supported. On the first deployment a one-shot job (`db-init`) runs
using `postgres:15-alpine` and idempotently:

1. Detects the Cloud SQL Auth Proxy Unix socket and symlinks it into `/tmp` for `psql` access,
2. Waits for PostgreSQL to be reachable (up to 60 retries),
3. Creates (or updates the password of) the application role,
4. Creates the application database with that role as owner (if it does not exist),
5. Grants full privileges on the database to the role,
6. Signals the Cloud SQL Auth Proxy to shut down gracefully (`/quitquitquit`).

Vikunja itself runs its schema migrations on the **first application startup** — the
`db-init` job only provisions the empty database and role. The job is safe to
re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The upstream `vikunja/vikunja` image is **`scratch`-based**: it contains only the
static `/app/vikunja/vikunja` binary, with no shell and no `/etc/passwd`. To run a
shell entrypoint that maps the platform's environment onto Vikunja's native config,
the custom Dockerfile is multi-stage:

- **Grafts in a static busybox** (`COPY --from=busybox /bin/busybox`) and uses
  `busybox sh` as the entrypoint interpreter — a plain `FROM … + RUN` thin-build is
  impossible because there is no shell or user database to resolve.
- **Pre-creates the attachments dir** `/app/vikunja/files` owned by uid 1000
  (`COPY --chown=1000:0`), because the app runs as uid 1000 under a root-owned
  WORKDIR and cannot `mkdir` it at boot. For durable attachments, mount NFS over
  this path.
- Builds with an app-specific `VIKUNJA_VERSION` build ARG — **not** the generic
  `APP_VERSION`, which the foundation injects into `build_args` and would otherwise
  win the merge and resolve `vikunja:latest` (a non-existent tag). `"latest"` maps
  to a pinned recent release (`2.3.0`).

The entrypoint script (`vikunja-entrypoint.sh`) runs before the Go server starts:

- **Maps `DB_*` to `VIKUNJA_DATABASE_*`** — translates the platform-injected
  `DB_USER`, `DB_PASSWORD`, `DB_NAME` onto `VIKUNJA_DATABASE_USER`,
  `VIKUNJA_DATABASE_PASSWORD`, `VIKUNJA_DATABASE_DATABASE`, and sets
  `VIKUNJA_DATABASE_TYPE = postgres`. Discrete env values need no URL-encoding —
  Vikunja encodes them itself.
- **Connects over the private IP, not the socket.** Vikunja builds a `postgres://`
  URL internally, so it cannot use the Cloud SQL socket directory as the host — the
  path `/cloudsql/<project>:<region>:<instance>` contains colons the URL builder
  parses as a bogus port (`invalid port after host`). The entrypoint connects over
  the Cloud SQL **private IP** (`DB_IP`) with `sslmode=require` on Cloud Run
  (Cloud SQL rejects unencrypted private-IP TCP), and over the proxy **loopback**
  (`127.0.0.1`) with `sslmode=disable` on GKE. It branches on whether the resolved
  host is loopback — not on whether `DB_IP` is set — because `DB_IP` is `127.0.0.1`
  on GKE.
- **Sets `VIKUNJA_SERVICE_PUBLICURL`** from `CLOUDRUN_SERVICE_URL` (Cloud Run) or
  `GKE_SERVICE_URL` (GKE) so links and the frontend use the real service address.
- **Launches the server** with `exec /app/vikunja/vikunja` as PID 1.

---

## 5. Core application settings

`Vikunja_Common` establishes the baseline Vikunja environment so the application
comes up correctly on first boot:

- **Port** — Vikunja listens on `3456`.
- **Database type** — `VIKUNJA_DATABASE_TYPE = postgres`.
- **Public URL** — derived at runtime from the platform-injected service URL.
- **JWT secret** — `VIKUNJA_SERVICE_JWTSECRET` injected from Secret Manager.
- **First-run ownership** — Vikunja ships no pre-seeded admin; the **first
  registered account becomes the owner**. After creating it, disable open
  registration by setting `VIKUNJA_SERVICE_ENABLEREGISTRATION = "false"` via
  `environment_variables`.

Platform-specific adjustments handled here:

- **Cloud Run** connects to Cloud SQL over the private IP (`sslmode=require`) and
  reads its public URL from `CLOUDRUN_SERVICE_URL`.
- **GKE** connects over the cloud-sql-proxy sidecar loopback (`sslmode=disable`)
  and reads its public URL from `GKE_SERVICE_URL`.

---

## 6. Health probe behaviour

The default startup and liveness probes target `/health` — Vikunja's public,
unauthenticated liveness endpoint that returns 200 as soon as the server binds its
port. A generous startup window accommodates the schema migrations Vikunja runs on
first boot.

- **Cloud Run** and **GKE** both use HTTP probes on `/health` with a 30-second
  initial delay; the startup probe allows a wide retry window (default failure
  threshold 30) for first-boot migrations.

---

## 7. Object storage

Vikunja stores its data in PostgreSQL and its file attachments on the local
filesystem (`/app/vikunja/files`). `Vikunja_Common` therefore declares **no**
dedicated Cloud Storage bucket (`storage_buckets = []`). For durable attachments,
enable NFS in the platform variant and mount it over the attachments path.

---

For the Vikunja-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform
guides: **[Vikunja_GKE](Vikunja_GKE.md)** and
**[Vikunja_CloudRun](Vikunja_CloudRun.md)**.
