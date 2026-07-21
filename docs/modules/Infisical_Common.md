---
title: "Infisical Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Infisical module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Infisical Common — Shared Application Configuration

`Infisical_Common` is the **shared application layer** for Infisical. It is
not deployed on its own; instead it supplies the Infisical-specific configuration
that both [Infisical_GKE](Infisical_GKE.md) and [Infisical_CloudRun](Infisical_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of its
own — but understanding what it provides explains the defaults you see in the
platform docs.

For the infrastructure that actually provisions and runs Infisical, see the
platform guides ([Infisical_GKE](Infisical_GKE.md), [Infisical_CloudRun](Infisical_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Infisical_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `ENCRYPTION_KEY` (16 random bytes, hex), `AUTH_SECRET` (32 random bytes, base64), and `ADMIN_PASSWORD` (24-char random) and stores them in **Secret Manager**. A conditional `REDIS_URL` secret is added when Redis auth is configured. | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `infisical/infisical` image with a custom entrypoint script; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | `database_type` output / §Database in the platform guides |
| Database bootstrap | Defines the `db-init` job (creates the role + database) and the `admin-bootstrap` job (headless CLI super-admin bootstrap) | `initialization_jobs` output |
| Object storage | None — Infisical needs no bucket; `storage_buckets` output is always `[]` | n/a |
| Health checks | Supplies the default startup/liveness probe targeting `/api/status`; the CloudRun variant then overrides the startup probe to TCP and disables the liveness probe at the module level | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Three secrets are generated automatically and stored in Secret Manager — they are
never set in plain text:

- **`ENCRYPTION_KEY`** — 16 random bytes, hex-encoded (32 hex characters). Used by
  Infisical to encrypt every secret it stores. **Never rotate this after first
  boot** — rotating it makes all previously stored secrets permanently
  undecryptable.
- **`AUTH_SECRET`** — 32 random bytes, base64-encoded. Used to sign Infisical's
  JWT session/auth tokens. Rotating it invalidates all active sessions — only
  rotate during a maintenance window.
- **`ADMIN_PASSWORD`** — a 24-character random password for the bootstrapped first
  super-admin account. This secret is injected **only** into the `admin-bootstrap`
  init job's `secret_env_vars` — it is never present in the running server
  container's environment.

A fourth secret, **`REDIS_URL`**, is created conditionally: only when
`enable_redis = true` **and** `redis_auth != ""`. When `redis_auth` is empty (the
default), the Foundation itself injects a correct plain-env `REDIS_HOST`/
`REDIS_PORT` pair (resolved from NFS discovery at apply time) and no `REDIS_URL`
secret is created here — building one unconditionally would bake in the wrong host
(`127.0.0.1`) for the no-auth case. The `var.redis_auth != ""` conditional that
guards this secret's inclusion in `secret_ids` is wrapped in `nonsensitive()`
because `redis_auth` is a sensitive Terraform variable; without it, the
conditional taints the entire `secret_ids` map and breaks the downstream
`for_each` that consumes it.

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~infisical"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Infisical requires **PostgreSQL 15**; the engine is fixed and MySQL or other
engines are not supported. Two initialization jobs run in sequence:

1. **`db-init`** — a one-shot job using `postgres:15-alpine`. It detects the
   Cloud SQL Auth Proxy socket (Cloud Run) or loopback sidecar (GKE), waits for
   PostgreSQL to accept connections, then idempotently creates (or updates) the
   application role and creates (or reassigns ownership of) the application
   database, granting full privileges. `execute_on_apply = true` — this runs on
   every apply and is safe to re-run.
2. **`admin-bootstrap`** — a one-shot job using `infisical/cli:latest`, depending
   on `db-init`. It runs `infisical bootstrap --ignore-if-bootstrapped` against
   the running server's HTTP API (`INFISICAL_API_URL`, derived from `site_url`)
   to create the first super-admin account, organization, and instance-admin
   machine identity — avoiding the "open until the first visitor claims it"
   web-UI signup window. `execute_on_apply = false`: on **Cloud Run**, init jobs
   run strictly *before* the Service is created, so this job cannot reach a live
   server at apply time and must be triggered manually after the first healthy
   deploy. On **GKE**, `execute_on_apply` only gates Terraform's *wait* for the
   job — the job's pod is scheduled immediately regardless, and it retries (up to
   20 attempts, 15 seconds apart) until the server answers at `site_url`.

Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image (`Infisical_Common/scripts/Dockerfile`) wraps
`infisical/infisical:${INFISICAL_VERSION}` with a thin shell entrypoint
(`entrypoint.sh`) that runs before the Infisical server starts:

- **Assembles `DB_CONNECTION_URI` at container start, not at plan time.**
  Infisical accepts a single connection-string environment variable, not discrete
  host/user/password vars — but the runtime `DB_PASSWORD` (a Secret Manager value)
  isn't known when Terraform renders the image, and can't be URL-encoded there.
  The entrypoint URL-encodes it and builds the URI from the discrete `DB_HOST`/
  `DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` values the Foundation injects.
- **Branches `sslmode` on the shape of `DB_HOST`:** a Unix socket path (`/*`,
  Cloud Run Auth Proxy, TLS-terminated by the proxy) → `disable`; `127.0.0.1` /
  `localhost` (GKE Auth Proxy sidecar loopback, also already TLS-terminated) →
  `disable`; anything else (a raw private IP, direct TCP) → `require`, since
  Cloud SQL rejects unencrypted private-IP TCP connections.
- **`INFISICAL_VERSION` build arg maps `"latest"` to a pinned release.** Rather
  than passing `application_version = "latest"` straight through to the base
  image tag, the Dockerfile's `INFISICAL_VERSION` ARG resolves `"latest"` to a
  pinned known-good version (`v0.162.10` as of this module's authoring) — matching
  this catalog's convention against building on a moving `latest` base image tag,
  and Infisical's own guidance against running bare `latest` in production.
- **Runs as the non-root image user (UID 1000).** The Dockerfile only briefly
  switches to `USER root` to `chmod +x` the entrypoint script, then drops back to
  the base image's default user before `ENTRYPOINT`.

---

## 5. Core application settings

`Infisical_Common` establishes the baseline Infisical environment so the
application comes up correctly on first boot:

- **`HOST = "0.0.0.0"`** — Infisical listens on all interfaces; its own default is
  localhost-only, which would make it unreachable inside the container.
- **`PORT` is deliberately not set.** Cloud Run rejects `PORT` as a reserved env
  name on Jobs, and Cloud Run Services auto-inject it from `container_port`
  anyway. Infisical's own default listen port (8080) matches `container_port`'s
  default, so GKE (which has no such auto-injection) still binds correctly out of
  the box.
- **`SITE_URL`** — set from `var.site_url` when non-empty, otherwise defaults to
  `http://localhost:${container_port}`. Used for invite/email links, CORS, and as
  the `admin-bootstrap` job's target. The Cloud Run variant computes a predicted
  `run.app` URL and passes it as `site_url` automatically; the GKE variant passes
  `var.site_url` straight through with no computation — see the GKE platform
  guide's pitfalls for the operational implication.
- **`DATABASE_URL`/`DB_CONNECTION_URI` is intentionally NOT built here** — see
  §4 above; it is assembled at container start by `entrypoint.sh` instead.

---

## 6. Health probe behaviour

The default probe object (defined in `Infisical_Common/variables.tf`) targets
`/api/status`, which returns HTTP 200 with a JSON body once Infisical, its
database connection, and (if enabled) Redis are all healthy.

- **Cloud Run overrides this at the module level.** `/api/status` only returns
  2xx after *full* readiness — an HTTP startup probe against it would never pass
  during the window before Redis/DB are connected, so `Infisical_CloudRun`
  defaults its `startup_probe` to **TCP** (succeeds as soon as the port is bound)
  and **disables the liveness probe entirely** to avoid restart-looping a
  container that hasn't finished connecting yet.
- **GKE keeps the HTTP `/api/status` default** for both startup and liveness
  probes — Kubernetes-native probes don't have the same "service never gets
  created" failure mode Cloud Run's startup gate has, so a slower-to-pass HTTP
  probe is acceptable there.

---

## 7. Object storage

`Infisical_Common`'s own `storage_buckets` output is always an empty list —
Infisical stores all persistent state in PostgreSQL and needs no object storage
of its own. The generic `data` GCS bucket seen in the platform guides' Outputs
comes from the Foundation's own `storage_buckets` variable default (shared by
every Application module in this catalog), not from anything `Infisical_Common`
declares or the app actually uses.

---

For the Infisical-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Infisical_GKE](Infisical_GKE.md)** and
**[Infisical_CloudRun](Infisical_CloudRun.md)**.
