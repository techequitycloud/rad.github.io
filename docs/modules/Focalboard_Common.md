---
title: "Focalboard Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Focalboard module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Focalboard Common — Shared Application Configuration

`Focalboard_Common` is the **shared application layer** for Focalboard. It is not
deployed on its own; instead it supplies the Focalboard-specific configuration that
both [Focalboard_GKE](Focalboard_GKE.md) and [Focalboard_CloudRun](Focalboard_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End users
never configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Focalboard, see the platform
guides ([Focalboard_GKE](Focalboard_GKE.md), [Focalboard_CloudRun](Focalboard_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

Focalboard (`mattermost/focalboard`) is a self-hosted Kanban / project-board server —
a Go backend serving a built React frontend. It is DB-backed (PostgreSQL here) and
stores uploaded board attachments on a local filesystem path (`filespath`). Focalboard
reads its configuration from a `config.json` at startup — there is **no environment
variable override** for the database connection — so this layer ships a custom
entrypoint that generates `config.json` from the Foundation-injected `DB_*` variables
on every start. No secret DSN is ever baked into the image.

---

## 1. What this layer provides

| Area | Provided by Focalboard_Common | Where it surfaces |
|---|---|---|
| Container image | Thin wrapper `FROM mattermost/focalboard` with a custom `config.json`-generating entrypoint; built via Cloud Build (Kaniko) and mirrored into Artifact Registry | `container_image` output of the platform deployment |
| App secret | Generates an admin password (`FOCALBOARD_ADMIN_PASSWORD`, 24-char) in **Secret Manager** and injects it as a SERVICE secret env | `secret_ids` output; retrieve via Secret Manager (see below) |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** (`database_type = POSTGRES_15`) as the engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, role, and grants (idempotent) | `initialization_jobs` output |
| Object storage | Declares a **Cloud Storage** bucket (`storage` suffix) for board attachments | `storage_buckets` output |
| Attachment persistence | Sets `FOCALBOARD_FILESPATH = /data` and mounts the storage bucket there via gcsfuse (Cloud Run / non-PVC GKE) or a block PVC (GKE) | §Persistence in the platform guides |
| Core settings | Generates `config.json`: `dbtype = postgres`, port `8000`, `authMode = native`, telemetry off, public shared boards on | Application behaviour in the platform guides |
| Health checks | Supplies the default startup / liveness / readiness probes targeting `/` | §Observability in the platform guides |

---

## 2. App secret in Secret Manager

A single application secret is generated automatically and stored in Secret Manager:

- **`FOCALBOARD_ADMIN_PASSWORD`** — a 24-character random alphanumeric string
  (`special = false`). Provisioned under the name
  `secret-<resource_prefix>-focalboard-admin-password` and injected into the container
  as the `FOCALBOARD_ADMIN_PASSWORD` SERVICE secret env, mirroring the credential
  pattern used by the other Application modules. Focalboard runs in **native auth
  mode**, so the first account registered through the web UI becomes the workspace
  owner — this secret is available for operators who script an initial account or a
  bootstrap step, but Focalboard does not consume it to auto-create an admin.

Retrieve the secret after deployment:

```bash
# List the secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~focalboard-admin-password"

# Read the secret value:
gcloud secrets versions access latest \
  --secret="secret-<resource_prefix>-focalboard-admin-password" --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Focalboard uses **PostgreSQL 15**; the engine is fixed (`database_type = POSTGRES_15`).
On the first deployment a one-shot job (`db-init`) runs using `postgres:15-alpine` and
idempotently:

1. Resolves the Cloud SQL host — a Unix-socket directory on Cloud Run or `127.0.0.1`
   (Auth Proxy sidecar) on GKE, falling back to the private IP (`DB_IP`) if needed,
2. Waits for PostgreSQL to be reachable,
3. Creates (or updates) the application role with `LOGIN CREATEDB` and the generated
   password,
4. Creates the application database if it does not exist (owned by `postgres`, since
   Cloud SQL's `postgres` cannot `SET ROLE` to the application role),
5. Grants all privileges on the database and the `public` schema, and reassigns the
   `public` schema owner to the application role so Focalboard can run its migrations,
6. Signals the Cloud SQL Auth Proxy sidecar to shut down (`--quitquitquit`) so the GKE
   Job pod can complete.

**No Postgres extensions are installed** (`enable_postgres_extensions = false`) —
Focalboard needs none. Focalboard applies its **own schema migrations on every boot**
as the application user, so upgrading the version needs no separate migration step. The
job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image is a thin wrapper `FROM mattermost/focalboard:<version>`, built via
Cloud Build (Kaniko) and mirrored into Artifact Registry (`enable_image_mirroring = true`,
`image_source = "custom"`). The Dockerfile:

- Copies `entrypoint.sh` to `/usr/local/bin/cloud-entrypoint.sh` and sets it as the
  `ENTRYPOINT`, with the Focalboard server binary as the `CMD`
  (`/opt/focalboard/bin/focalboard-server`),
- Pre-creates `/data` (`chmod 0777`) as the persistent attachment dir so a fresh mount
  is writable by the server,
- Exposes port **8000**.

The base-image tag is pinned via an **app-specific build ARG** `FOCALBOARD_VERSION`
(default `7.11.4`), deliberately *not* the generic `APP_VERSION` that the Foundation
injects — the Foundation sets `APP_VERSION = application_version` (which can be
`latest`, and `mattermost/focalboard:latest` is not a published tag). When
`application_version = "latest"`, the build maps it to the pinned `7.11.4`.

The entrypoint (`cloud-entrypoint.sh`, POSIX `sh`) runs before the server starts and:

- **Builds the PostgreSQL DSN from the Foundation `DB_*` vars** into a lib/pq keyword
  string (`user=… password=… dbname=… host=… sslmode=…`), which accepts a
  socket-directory host verbatim. It branches on the *resolved* host: a loopback host
  (`127.0.0.1`/`localhost`, the GKE Auth Proxy) uses `sslmode=disable`; a real private
  IP (Cloud Run over VPC) uses `sslmode=require`. On Cloud Run it prefers `DB_IP` over
  the socket directory because the socket does not always materialise.
- **Generates `/opt/focalboard/config.json`** with `dbtype = postgres`, `port = 8000`,
  `filesdriver = local`, `filespath = $FOCALBOARD_FILESPATH` (default `/data`),
  `authMode = native`, `enablePublicSharedBoards = true`, `enableLocalMode = false`,
  `telemetry = false`, and `serverRoot` derived from `CLOUDRUN_SERVICE_URL` /
  `GKE_SERVICE_URL` when present.
- **Execs the Focalboard server** as PID 1, which runs its schema migrations against
  the DSN and serves the web UI + API on port 8000.

---

## 5. Attachment persistence and object storage

Focalboard stores uploaded board attachments on a local filesystem path
(`filespath`), fixed here to `/data` via `FOCALBOARD_FILESPATH`. That path is backed
differently per platform:

- **Cloud Run (and GKE without a block PVC)** — a **Cloud Storage** bucket (declared
  here with the `storage` suffix) is mounted at `/data` via gcsfuse
  (`enable_gcs_storage_volume = true`), so attachments survive instance restarts.
- **GKE with `stateful_pvc_enabled = true`** (the GKE default) — a real **block PVC**
  owns `/data` instead, and the caller sets `enable_gcs_storage_volume = false` so the
  gcsfuse volume is skipped. This avoids a double-mount at the same path; gcsfuse would
  corrupt the index/media files Focalboard writes.

List the bucket with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

## 6. Health probe behaviour

The default startup, liveness, and readiness probes target the root path `/` — the
Focalboard web UI, which returns 200 once the server has bound its port and completed
first-boot migrations. The startup probe allows a generous window (60-second initial
delay, 15-second period, 30 failures) to accommodate the schema migrations that run on
first boot against a freshly provisioned Cloud SQL instance.

---

For the Focalboard-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[Focalboard_GKE](Focalboard_GKE.md)** and **[Focalboard_CloudRun](Focalboard_CloudRun.md)**.
