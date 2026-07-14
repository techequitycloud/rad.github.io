---
title: "Synapse Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Synapse module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Synapse Common — Shared Application Configuration

`Synapse_Common` is the **shared application layer** for Synapse, the reference
[Matrix](https://matrix.org/) homeserver. It is not deployed on its own; instead it
supplies the Synapse-specific configuration that both
[Synapse_GKE](Synapse_GKE.md) and [Synapse_CloudRun](Synapse_CloudRun.md) build on,
so the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Synapse, see the platform
guides ([Synapse_GKE](Synapse_GKE.md), [Synapse_CloudRun](Synapse_CloudRun.md)) and
the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Synapse_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates a stable `registration_shared_secret` (injected as `REGISTRATION_SHARED_SECRET`, and again as `SECRET_KEY` via the `secret_ids` output) and a superuser password, both stored in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `matrixdotorg/synapse` image with a cloud entrypoint that generates `homeserver.yaml` + a persistent signing key and wires the platform PostgreSQL; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database with the **mandatory `C` collation** and the application role | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** data bucket | `storage_buckets` output |
| Core settings | Sets the baseline Synapse environment: `server_name`, HTTP listener port (`8008`), data directory, stats reporting, registration | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness/readiness probes targeting `/health` | §Observability in the platform guides |

---

## 2. Cryptographic secrets and the signing key

Two secrets are generated automatically and stored in Secret Manager — they are never
set in plain text:

- **`registration_shared_secret`** — a stable random string injected as the
  `REGISTRATION_SHARED_SECRET` secret env (and, redundantly, as `SECRET_KEY` via the
  `secret_ids` output on both `Synapse_CloudRun` and `Synapse_GKE`) and written into a
  `conf.d` snippet at boot. It authorises out-of-band admin/user creation with the
  `register_new_matrix_user` tool (open self-service registration is **off** by
  default). Rotating it after first boot invalidates any registration script that
  hard-codes the old value.
- **Superuser password** — a secret is generated and stored in Secret Manager
  (`secret-<prefix>-synapse-superuser-password`), but **it is not currently wired to
  any user-creation step** — no init job or entrypoint logic reads it, so it does not
  by itself give the instance an owner account. Create the first admin account
  out-of-band with `register_new_matrix_user` (using the `registration_shared_secret`
  above) or by temporarily enabling open registration.

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).

**The signing key is not a Secret Manager secret — it is a file.** On first boot the
cloud entrypoint generates a signing key into the data directory
(`SYNAPSE_DATA_DIR = /data`). This key is the homeserver's cryptographic identity:

> The signing key **must persist forever**. Regenerating it breaks federation with
> every other homeserver and invalidates all device and session state. Back the data
> directory with persistent storage (the module enables NFS by default) so the key
> survives restarts and redeploys. The entrypoint only generates a key when one does
> not already exist.

Retrieve the Secret Manager secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~synapse"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Synapse requires **PostgreSQL 15**; the engine is fixed and MySQL or other engines are
not supported. Synapse additionally has a hard requirement that its database is created
with **`LC_COLLATE='C'` and `LC_CTYPE='C'`** — it refuses to start against any other
collation (`Database has incorrect values for … collation`). The generic foundation
`db-create` does not set this, so `Synapse_Common` ships a dedicated `db-init` job that
runs `postgres:15-alpine` and idempotently:

1. Waits for PostgreSQL to be reachable through the Cloud SQL Auth Proxy,
2. Creates (or updates the password of) the application role,
3. Creates the application database with `ENCODING 'UTF8' LC_COLLATE='C' LC_CTYPE='C'
   TEMPLATE template0`, owned by the application role — recreating an empty
   wrong-collation database if the foundation created one first (no data loss on an
   empty DB),
4. Grants all privileges on the database to the application role,
5. Signals the Cloud SQL Auth Proxy to shut down gracefully so the Job completes.

**There is no migrate job.** Unlike Django-style apps, Synapse creates and upgrades its
own schema automatically every time it starts — `db-init` only prepares the
C-collation database and role. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
# Verify the collation:
#   SELECT datname, datcollate, datctype FROM pg_database WHERE datname = '<db-name>';
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image wraps `matrixdotorg/synapse:<version>` with a thin shell entrypoint
(`entrypoint.sh`) that runs before Synapse starts. Synapse is configured by a YAML file
plus a signing key — **not** by environment variables — so on first boot the entrypoint:

- **Generates the base config + signing key once** — runs
  `python3 -m synapse.app.homeserver --generate-config` into `SYNAPSE_DATA_DIR`, keyed
  on the signing-key file so it is never regenerated on subsequent boots.
- **Overrides the database section** — Synapse's generated config defaults to SQLite;
  the entrypoint writes a `conf.d/00-cloud.yaml` snippet pointing `psycopg2` at the
  platform PostgreSQL, resolving the host per the Cloud SQL socket-vs-TCP rule (Unix
  socket directory on Cloud Run with `sslmode=disable`; `127.0.0.1` via the Auth Proxy
  sidecar on GKE; private-IP TCP falls back to `sslmode=require`).
- **Configures the HTTP listener** — binds `0.0.0.0:8008` with `client` and
  `federation` resources, sets `public_baseurl` from the injected service URL, and
  writes the `registration_shared_secret` snippet.
- **Execs Synapse** — `python3 -m synapse.app.homeserver -c homeserver.yaml -c conf.d`,
  merging the generated config with the cloud overrides (last wins).

The image is built with an app-specific `SYNAPSE_VERSION` build ARG (defaulting to a
pinned `v1.119.0` when `application_version = "latest"`) so the generic `APP_VERSION`
the foundation injects cannot force an invalid `latest` base-image tag.

---

## 5. Core application settings

`Synapse_Common` establishes the baseline Synapse environment so the homeserver comes up
correctly on first boot:

- **`SYNAPSE_SERVER_NAME`** — the Matrix `server_name`, the domain baked into every user
  ID (`@user:server_name`) and into federation. Defaults to a placeholder
  (`matrix.local`). It is **IMMUTABLE after first boot** — changing it invalidates all
  user IDs, device sessions, and federation. Override it with your real domain **before**
  going to production.
- **`SYNAPSE_PORT = "8008"`** — the HTTP listener port. It is a plain env var (Synapse
  listens on a config-file port, not `$PORT`), so there is no Cloud Run reserved-port
  conflict.
- **`SYNAPSE_DATA_DIR = "/data"`** — where `homeserver.yaml`, the `conf.d` overrides, and
  the signing key live. Must be on persistent storage (see §2).
- **`SYNAPSE_REPORT_STATS = "no"`** — opts out of anonymous usage statistics.
- **Registration** — open self-service registration is disabled by default; users are
  created out-of-band with `register_new_matrix_user` using the shared secret.

Redis is intentionally **not** used — Synapse runs as a single main process, so no
`REDIS_URL` is injected.

---

## 6. Health probe behaviour

The default startup, liveness, and readiness probes target **`/health`** — an
unauthenticated endpoint that returns a plain `200 OK` as soon as Synapse is listening.
Because Synapse runs its own schema migrations on start, first boot can take a little
longer than a steady-state restart, so the startup probe allows a generous window.

- **Cloud Run / GKE** use HTTP probes against `/health` on port `8008`. The probe path
  must stay on this public, unauthenticated endpoint — pointing it at an authenticated
  Matrix API path would return 401/403 and the revision/pod would never become Ready
  even though the homeserver booted fine.
- The Matrix client API version probe **`GET /_matrix/client/versions`** (which returns
  the supported spec versions as JSON) is a good post-deploy readiness check that the
  full client API — not just the health listener — is serving.

`Synapse_Common`'s own `startup_probe`/`liveness_probe` variable defaults target
`/health` (the readiness probe, hardcoded in `Synapse_Common`, always does). Both
`Synapse_CloudRun` and `Synapse_GKE` currently override the startup and liveness
probe path to a bare `/` in their own `variables.tf` — verify the deployed revision's
actual probe path (`gcloud run revisions describe` / `kubectl get pod -o yaml`)
before assuming `/health` is what is live.

---

## 7. Object storage

A dedicated **Cloud Storage** data bucket is declared here and provisioned by the
foundation, which also grants the workload service account access. Synapse's media
repository (uploaded files, avatars, thumbnails) is stored on the persistent data
directory; the bucket is available for backups and auxiliary storage. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Synapse-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Synapse_GKE](Synapse_GKE.md)** and **[Synapse_CloudRun](Synapse_CloudRun.md)**.
