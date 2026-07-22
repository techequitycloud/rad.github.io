---
title: "PeerTube Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the PeerTube module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# PeerTube Common — Shared Application Configuration

`PeerTube_Common` is the **shared application layer** for PeerTube. It is not
deployed on its own; instead it supplies the PeerTube-specific configuration
that [PeerTube_CloudRun](PeerTube_CloudRun.md) builds on today, and that a
future `PeerTube_GKE` variant will build on once it is deployed and verified,
so both platform variants behave identically where it matters. End users
never configure this layer directly — it has no deployment UI inputs of its
own — but understanding what it provides explains the defaults you see in the
platform docs.

For the infrastructure that actually provisions and runs PeerTube, see
[PeerTube_CloudRun](PeerTube_CloudRun.md) and the foundation guide
[App_CloudRun](App_CloudRun.md).

---

## 1. What this layer provides

| Area | Provided by PeerTube_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `PEERTUBE_SECRET` (64-hex-char, 32 random bytes) and `PT_INITIAL_ROOT_PASSWORD` (24-char random), stores in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Object-storage credentials | Creates a dedicated service account + **HMAC key pair**, stores both halves in Secret Manager | `PEERTUBE_OBJECT_STORAGE_CREDENTIALS_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` |
| Container image | Custom Dockerfile build layered on `chocobozzz/peertube`, with a dedicated `PEERTUBE_VERSION` build ARG | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guide |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, grants, and installs `pg_trgm`/`unaccent` | `initialization_jobs` output |
| Object storage | Declares the **`data`** (local state, FUSE-mounted) and **`videos`** (public, S3-compatible) Cloud Storage buckets | `storage_buckets` output |
| Core settings | Sets the baseline PeerTube environment: network binding, public identity, admin bootstrap, registration, live-streaming toggle, database TLS, S3 object storage, SMTP | Application behaviour in the platform guide |
| Health checks | Supplies the default TCP startup probe and HTTP liveness probe targeting `/api/v1/config` | §Observability in the platform guide |

---

## 2. Cryptographic secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager:

- **`PEERTUBE_SECRET`** — 32 random bytes, hex-encoded (matching PeerTube's
  own `openssl rand -hex 32` recommendation). Signs JWT session tokens and
  TOTP codes. Rotating it invalidates all active sessions — only rotate
  during a maintenance window.
- **`PT_INITIAL_ROOT_PASSWORD`** — a 24-character random password. Read
  directly from `process.env` (not node-config, so no `PEERTUBE_` prefix) by
  PeerTube's own `installer.ts` on first boot, when no users exist yet, to
  set the auto-created `root` admin account's password. Without this secret,
  PeerTube generates and only *logs* a random password — unrecoverable if the
  boot log isn't captured in time. This secret only affects account
  *creation*; it has no effect on an already-created account's password.

Two more secrets support object storage:

- **`PEERTUBE_OBJECT_STORAGE_CREDENTIALS_ACCESS_KEY_ID`** /
  **`_SECRET_ACCESS_KEY`** — an HMAC key pair bound to a dedicated storage
  service account, used by PeerTube's native S3-compatible client (AWS SDK)
  against GCS's S3-interop XML endpoint.

And, when `smtp_host` is set:

- **`PEERTUBE_SMTP_PASSWORD`** — auto-generated unless `smtp_password` is
  supplied explicitly.

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~app-secret OR name~root-password OR name~s3-access-key OR name~s3-secret-key"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation;
its secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

---

## 3. Database engine and bootstrap

PeerTube requires **PostgreSQL 15**; the engine is fixed and MySQL or other
engines are not supported. On the first deployment a one-shot job (`db-init`)
runs using `postgres:15-alpine` and idempotently:

1. Waits for Cloud SQL to accept connections,
2. Creates (or updates) the application role with the generated password and
   `CREATEDB` privilege,
3. Creates (or reassigns ownership of) the application database with that
   role as owner,
4. Grants full privileges on the database and public schema,
5. Installs the `pg_trgm` (trigram text search) and `unaccent`
   (accent-insensitive search) extensions as the postgres superuser — both
   required by PeerTube's production install guide, and **not created by
   PeerTube itself**, so the unprivileged app role never needs `CREATE
   EXTENSION` privileges,
6. Signals the Cloud SQL Auth Proxy sidecar to shut down gracefully.

The job is safe to re-run. **No separate migrate job exists** — PeerTube
creates and migrates its own Sequelize schema automatically on every server
start. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image is built from a Dockerfile layered on the official
`chocobozzz/peertube` base image, with a `PEERTUBE_VERSION` build ARG — kept
deliberately separate from the generic `APP_VERSION` build ARG the Foundation
injects (which wins the merge on any name collision). When
`application_version = "latest"`, `PEERTUBE_VERSION` resolves to the
maintained `production` Docker Hub tag rather than an unresolvable `latest`.

A thin `docker-entrypoint.sh` runs before handing off to the vendor's own
entrypoint:

- **Remaps Redis env vars.** The Foundation injects the fixed names
  `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` (no per-app aliasing mechanism
  exists for Redis, unlike the database); the entrypoint remaps these onto
  `PEERTUBE_REDIS_HOSTNAME`/`_PORT`/`_AUTH`.
- **Derives the federation hostname when unset.** When
  `PEERTUBE_WEBSERVER_HOSTNAME` is empty (the default when `host = ""`), the
  entrypoint derives it from the platform's own predicted service URL
  (`CLOUDRUN_SERVICE_URL` on Cloud Run, `GKE_SERVICE_URL` on GKE), stripping
  the scheme and any trailing path, so a fresh deploy federates correctly
  with no pre-deploy domain decision required.
- **Waits for PostgreSQL.** Polls `pg_isready` against
  `PEERTUBE_DB_HOSTNAME`/`PEERTUBE_DB_PORT` before handing off, up to 60
  attempts with a 3-second interval.
- **Hands off to the vendor's own entrypoint**
  (`support/docker/production/entrypoint.sh`, baked into the base image),
  which performs the required `chown` of `/data` and `/config` to the
  `peertube` user, drops privileges via `gosu`, and execs `node dist/server`.
  PeerTube creates and migrates its own schema and bootstraps the `root`
  admin account automatically on first boot — no separate init/migrate job is
  needed beyond `db-init.sh`'s role/database/extension provisioning.

---

## 5. Core application settings

`PeerTube_Common` establishes the baseline PeerTube environment so the
application comes up correctly and federates on first boot:

- **Network binding** — `PEERTUBE_LISTEN_HOSTNAME = "0.0.0.0"` (PeerTube's
  own config defaults to `127.0.0.1`, which would refuse all external
  Cloud Run/GKE traffic); `PEERTUBE_LISTEN_PORT` matches `container_port`.
- **Public identity** — `PEERTUBE_WEBSERVER_HTTPS = "true"`,
  `PEERTUBE_WEBSERVER_PORT = "443"` (Cloud Run/GKE ingress terminates the
  real public TLS connection); `PEERTUBE_WEBSERVER_HOSTNAME` from `var.host`
  or derived at boot (see §4).
- **Proxy trust** — `PEERTUBE_TRUST_PROXY = ["loopback", "linklocal", "uniquelocal"]`,
  since Cloud Run/GKE ingress is the only path to the container.
- **Registration** — `PEERTUBE_SIGNUP_ENABLED` from `enable_open_registration`
  (default `false`).
- **Live streaming** — `PEERTUBE_LIVE_ENABLED` from `enable_live_streaming`
  (default `false`; has no practical effect on Cloud Run regardless of value
  — RTMP ingest needs a raw TCP port Cloud Run Services cannot expose).
- **Database TLS** — `PEERTUBE_DB_SSL` defaults `"false"` here (correct for
  GKE's cloud-sql-proxy loopback); `PeerTube_CloudRun` overrides this to
  `"true"` + reject-unauthorized `"false"` via its own `module_env_vars`,
  since Cloud Run's `db_host_env_var_name` mechanism always aliases the raw
  Cloud SQL private IP, which requires encryption (see
  [PeerTube_CloudRun](PeerTube_CloudRun.md) §3).
- **Object storage** — `PEERTUBE_OBJECT_STORAGE_ENABLED = "true"`, endpoint
  `https://storage.googleapis.com`, path-style addressing, all five bucket
  classes (web-videos, streaming-playlists, original-video-files,
  user-exports, captions) pointed at one `videos` bucket under distinct
  prefixes — mirroring PeerTube's own reference `docker-compose` layout.
  `upload_acl.*` is intentionally left unset (see §6).
- **SMTP** — only configured when `smtp_host` is non-empty; otherwise no
  `PEERTUBE_SMTP_*` env vars are injected at all.

---

## 6. Object storage

`PeerTube_Common` declares two GCS buckets, provisioned by the foundation:

- **`data`** — private, mounted via **GCS FUSE** at `/data`. Holds
  PeerTube's local (non-object-storage) state: avatars, thumbnails,
  previews, storyboards, torrents, plugins, logs, and tmp/cache. This always
  lives under `/data` regardless of whether object storage is enabled for
  video content. The vendor entrypoint runs as root before dropping to the
  `peertube` user and `chown`s `/data` itself on every boot, so no special
  `uid`/`gid` mount options are required (unlike apps whose main process runs
  as non-root throughout).
- **`videos`** — **public** (`public_access_prevention = "inherited"`,
  overriding the Foundation's secure-by-default `"enforced"`), CORS-enabled
  for `GET`/`PUT`/`POST`/`DELETE`/`HEAD` from any origin. PeerTube's own docs
  require its object-storage bucket to be public with CORS configured
  because video/streaming-playlist files are served directly from the bucket
  to end-user browsers, not proxied through the app. Without the
  `public_access_prevention` override, the Application Module's
  `google_storage_bucket_iam_member` grant for `allUsers:objectViewer` fails
  at apply time with a `412 "public access prevention is enforced"` error —
  confirmed live 2026-07-22.

Upload ACL configuration (`object_storage.upload_acl.public`/`private`) is
intentionally **omitted** — PeerTube's own docs document this as the required
workaround for S3-compatible backends without real per-object ACL support
(their documented example: Backblaze B2). GCS's S3 XML-interop under Uniform
Bucket-Level Access has the same limitation, so public read is granted at the
bucket level instead of relying on per-object ACLs.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~peertube"
gcloud storage buckets describe gs://<videos-bucket> --format='value(iamConfiguration.publicAccessPrevention)'
```

---

## 7. Health probe behaviour

- **Startup probe — TCP, not HTTP.** PeerTube's own DB/Redis migrations and
  first-boot admin bootstrap (`installer.ts`) can take longer than a typical
  HTTP readiness window allows; a TCP probe against the listening port avoids
  gating the revision on full application readiness.
- **Liveness probe — HTTP `GET /api/v1/config`.** A public, unauthenticated
  endpoint that responds once PeerTube's HTTP server is genuinely serving
  requests.

---

For the PeerTube-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guide: **[PeerTube_CloudRun](PeerTube_CloudRun.md)**.
