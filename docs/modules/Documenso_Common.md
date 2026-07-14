---
title: "Documenso Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Documenso module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Documenso Common — Shared Application Configuration

`Documenso_Common` is the **shared application layer** for Documenso. It is not
deployed on its own; instead it supplies the Documenso-specific configuration
that both [Documenso_GKE](Documenso_GKE.md) and
[Documenso_CloudRun](Documenso_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this
layer directly — it has no deployment UI inputs of its own — but understanding
what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Documenso, see the
platform guides ([Documenso_GKE](Documenso_GKE.md),
[Documenso_CloudRun](Documenso_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Documenso_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `NEXTAUTH_SECRET`, `NEXT_PRIVATE_ENCRYPTION_KEY`, and `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY` (each a 40-char random string), plus — only when `smtp_host` is set — `NEXT_PRIVATE_SMTP_PASSWORD`, and an HMAC access/secret key pair for optional S3 upload transport. All stored in **Secret Manager** | Injected automatically as secret env vars; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `documenso/documenso` image with a custom entrypoint (`docker-entrypoint.sh`); builds via Cloud Build (Kaniko) | `container_image` output of the platform deployment |
| Database engine | Declares `POSTGRES` as its own default `database_type`; not enforced by any plan-time precondition at this or any other layer | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the application role, database, ownership, and schema grants | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** `uploads` bucket (CORS-enabled) and a dedicated storage service account with an HMAC key pair | `storage_buckets` / `storage_sa_email` outputs |
| Core settings | Sets `NEXTAUTH_URL`/`NEXT_PUBLIC_WEBAPP_URL` placeholders, `NEXT_PRIVATE_SIGNING_TRANSPORT=local`, `NEXT_PUBLIC_UPLOAD_TRANSPORT=database`, and (when `smtp_host` is set) the `NEXT_PRIVATE_SMTP_*` env vars | Application behaviour in the platform guides |
| Health checks | Declares default `startup_probe`/`liveness_probe` values, though both platform variants supply and forward their own instead (see §6) | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Five secrets can be generated automatically and stored in Secret Manager — the
first three are unconditional, the last two are conditional on configuration:

- **`NEXTAUTH_SECRET`** — a 40-character random alphanumeric string (`random_password`,
  `length = 40`, `special = false`). Used by NextAuth.js to sign and encrypt
  session tokens. Documenso's Next.js app validates its environment with Zod
  at boot and will not start without it. Rotating it immediately invalidates
  every active session, forcing all users to log back in.
- **`NEXT_PRIVATE_ENCRYPTION_KEY`** — a 40-character random string (well above
  Documenso's documented 32-character minimum). The primary key used to
  encrypt sensitive data Documenso stores in Postgres. **Never regenerate this
  in place** — doing so makes previously-encrypted data unreadable. Rotate
  only by promoting a new value through the secondary-key slot below.
- **`NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY`** — a 40-character random string,
  reserved for key rotation of `NEXT_PRIVATE_ENCRYPTION_KEY` without a
  service interruption.
- **`NEXT_PRIVATE_SMTP_PASSWORD`** — only created when `var.smtp_host != ""`
  (`count = var.smtp_host != "" ? 1 : 0`). A 32-character random password,
  unless an operator supplies `smtp_password` explicitly, in which case that
  value is stored instead. Used for SMTP authentication when sending
  invitation and signing-notification email.
- **`S3_ACCESS_KEY`** / **`S3_SECRET_KEY`** — an HMAC key pair
  (`google_storage_hmac_key`) minted on a dedicated service account
  (`documenso_storage`, account ID `dc-store-<deployment_id_suffix>`).
  Provisioned unconditionally, but only consumed by the application if an
  operator opts into S3-compatible upload transport (see §7).

A destroy-time helper, `cleanup_orphaned_secrets`, tracks all six possible
secret IDs (including the conditional SMTP one) so stale Secret Manager
entries are removed even if `smtp_host` changes between deployments.

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~nextauth-secret OR name~encryption-key OR name~encryption-secondary-key OR name~smtp-password OR name~s3-access-key OR name~s3-secret-key"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation;
its secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

---

## 3. Database engine and bootstrap

`Documenso_Common`'s own `database_type` variable defaults to `"POSTGRES"`,
but neither this module nor either platform variant enforces it with a
plan-time precondition — both `Documenso_CloudRun` and `Documenso_GKE`
override the default to `"POSTGRES_15"` in their own `variables.tf`, so a
fresh deployment of either app requests Postgres 15 by default, but changing
`database_type` to MySQL or SQL Server passes `tofu plan` cleanly and only
breaks the app at runtime — Documenso's Prisma schema and the entrypoint's
`postgresql://` URL assembly both assume Postgres.

On the first deployment a one-shot job (`db-init`) runs using
`postgres:15-alpine` (`scripts/documenso/db-init.sh`) and idempotently:

1. Installs `curl` if missing (best effort, non-fatal),
2. If `DB_SSL=false` and `DB_HOST` is not already a Unix socket path, forces
   `DB_HOST=127.0.0.1` and unsets `DB_IP` — routing the job through the
   Cloud SQL Auth Proxy sidecar rather than a direct IP,
3. Waits for PostgreSQL to accept connections, authenticating as the
   `postgres` superuser via the `ROOT_PASSWORD` secret env var,
4. Creates the application role (`DB_USER`) if it does not exist, or updates
   its password if it does; grants it `CREATEDB`, grants the role to
   `postgres`, and grants it all privileges on the `postgres` database,
5. Creates the application database (`DB_NAME`) owned by `DB_USER` if it does
   not exist, or reassigns ownership to `DB_USER` if it does,
6. Grants all privileges on `DB_NAME` and on its `public` schema to `DB_USER`,
7. Signals the Cloud SQL Auth Proxy sidecar to shut down gracefully (`POST
   http://localhost:9091/quitquitquit`, retried for up to 60 seconds) so the
   job can complete.

The job is safe to re-run (`execute_on_apply = true`, `max_retries = 3`,
`timeout_seconds = 600`). Unlike Activepieces' `db-init`, this job does
**not** install any Postgres extension — `enable_postgres_extensions`
defaults to `false` because Documenso's Prisma schema needs none — and it does
**not** run schema migrations; those happen every time the container starts
(see §4).

Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image (`scripts/documenso/Dockerfile`) is `FROM
docker.io/documenso/documenso:${DOCUMENSO_VERSION}` (the app-specific
`DOCUMENSO_VERSION` build arg, set from `application_version` — never the
generic Foundation-injected `APP_VERSION`, which would otherwise win the merge
and force `latest`). As `root`, it installs `bash`, `curl`,
`postgresql-client` (for `pg_isready`), and `openssl` (for the self-signed
certificate fallback below) via `apk` or `apt-get` depending on the base
image's package manager, copies in `docker-entrypoint.sh` as the
`ENTRYPOINT`, and keeps the upstream image's own `CMD ["sh", "start.sh"]` and
`WORKDIR /app/apps/remix` — meaning **Prisma migrations still run inside the
official image's own startup script**, not inside this entrypoint.

`docker-entrypoint.sh` runs before `start.sh` and is responsible for:

- **Assembling `NEXT_PRIVATE_DATABASE_URL`.** Documenso (Next.js + Prisma)
  needs a full PostgreSQL connection string, but the platform only injects
  discrete `DB_USER`/`DB_PASSWORD`/`DB_HOST`/`DB_NAME`/`DB_PORT` values. The
  entrypoint URL-encodes the user/password (via `node -e`, falling back to
  the raw value if Node is unavailable) and branches on what `DB_HOST` looks
  like:
  - `DB_HOST` starts with `/` (a Unix socket directory) → `postgresql://user:pass@localhost/db?host=<socket_dir>&sslmode=disable`.
  - `DB_SSL=false`, or `DB_HOST` is `127.0.0.1`/`localhost` (the GKE Auth
    Proxy sidecar case) → `postgresql://user:pass@127.0.0.1:<port>/db?sslmode=disable`.
  - Otherwise (a direct Cloud SQL private-IP connection, no proxy) → uses
    `DB_IP` (falling back to `DB_HOST`) with `sslmode=require`, because a
    Cloud SQL instance without the Auth Proxy rejects plaintext connections.

  If `NEXT_PRIVATE_DATABASE_URL` is already set, this step is skipped.
  `NEXT_PRIVATE_DIRECT_DATABASE_URL` (which Documenso also reads, for
  migrations) is set to the same value if unset.

  **This is where the CloudRun-variant default mismatch matters:**
  `Documenso_Common`'s own `enable_cloudsql_volume` variable defaults to
  `true`, matching the entrypoint's first (socket-path) branch. However,
  `Documenso_CloudRun` overrides this default to **`false`** in its own
  `variables.tf`. With the default left unchanged on Cloud Run, `DB_HOST` is
  **not** a socket path, so the entrypoint instead falls into the direct-IP
  `sslmode=require` branch (or the loopback branch if `DB_SSL=false` is also
  set) rather than the Unix-socket path this entrypoint was primarily written
  for. `Documenso_GKE`, by contrast, keeps `enable_cloudsql_volume = true`, so
  GKE deployments consistently hit the loopback (`127.0.0.1`) branch through
  the cloud-sql-proxy sidecar. Operators relying on the socket-based
  connection path on Cloud Run must explicitly set `enable_cloudsql_volume =
  true`.

- **Resolving the public URL.** If `NEXT_PUBLIC_WEBAPP_URL` is still at its
  `http://localhost:3000` default (or empty) when the container starts, the
  entrypoint overwrites both `NEXT_PUBLIC_WEBAPP_URL` and `NEXTAUTH_URL` with
  whichever of `CLOUDRUN_SERVICE_URL` (Cloud Run) or `GKE_SERVICE_URL` (GKE)
  is present. `NEXT_PRIVATE_INTERNAL_WEBAPP_URL` (used by background jobs)
  defaults to the same resolved value if unset.
- **Provisioning a signing certificate.** When
  `NEXT_PRIVATE_SIGNING_TRANSPORT=local` (the default), the entrypoint first
  materialises a base64-encoded `NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS`
  (if supplied) to `/opt/documenso/cert.p12`. If no certificate is supplied
  at all and `openssl` is available, it self-generates a throwaway
  self-signed RSA-2048 `.p12` (365-day validity, passphrase defaulting to
  `"documenso"`) so the app still boots — logging a loud warning that the
  cert is **not production-safe** and must be replaced for real document
  signing.
- **Waiting for PostgreSQL.** Polls `pg_isready` against the assembled
  `NEXT_PRIVATE_DATABASE_URL` for up to 60 attempts (3s apart, ~3 minutes),
  exiting `1` on timeout.
- **Handing off to the upstream command.** `exec "$@"` — which runs the
  official image's `sh start.sh`, the step that actually executes Prisma
  migrations and launches the Next.js standalone server.

---

## 5. Core application settings

`Documenso_Common` establishes the baseline Documenso environment
(`local.environment_variables`) so the application comes up correctly on
first boot:

- **`NEXTAUTH_URL`** / **`NEXT_PUBLIC_WEBAPP_URL`** — set to `var.webapp_url`
  if provided, otherwise `"http://localhost:3000"` as a placeholder the
  entrypoint corrects at runtime (see §4).
- **`NEXT_PRIVATE_SIGNING_TRANSPORT = "local"`** — Documenso signs documents
  using a locally-supplied `.p12`/`.pfx` certificate rather than a remote
  signing service.
- **`NEXT_PUBLIC_UPLOAD_TRANSPORT = "database"`** — documents are stored as
  blobs in PostgreSQL by default; no bucket write is required for the app to
  function (see §7 for the S3 alternative).
- **Conditional SMTP block** — only injected when `var.smtp_host != ""`:
  `NEXT_PRIVATE_SMTP_TRANSPORT = "smtp-auth"`, `NEXT_PRIVATE_SMTP_HOST`,
  `NEXT_PRIVATE_SMTP_PORT` (stringified), `NEXT_PRIVATE_SMTP_USERNAME`,
  `NEXT_PRIVATE_SMTP_SECURE` (`"true"`/`"false"` from `smtp_secure_enabled`),
  `NEXT_PRIVATE_SMTP_FROM_ADDRESS` (falls back to `noreply@documenso.local`
  if `mail_from` is empty), and `NEXT_PRIVATE_SMTP_FROM_NAME = "Documenso"`.
  The SMTP **password** itself is delivered separately as a secret env var
  (`NEXT_PRIVATE_SMTP_PASSWORD`, §2), not inlined here.
- **`var.environment_variables`** is merged in last, so operators or the
  calling Application module can add or override any of the above.

Platform-specific adjustments are **not** made inside `Documenso_Common`
itself — the module has no CloudRun/GKE conditional logic beyond the
entrypoint's `CLOUDRUN_SERVICE_URL` vs. `GKE_SERVICE_URL` branch (§4). Every
other platform-specific default (CPU/memory sizing, `min`/`max_instance_count`,
`enable_cloudsql_volume`, probe timing) is declared independently in each
Application module's own `variables.tf` and simply passed through this layer
as an input, which is then echoed back unchanged in the `config` output.

---

## 6. Health probe behaviour

`Documenso_Common` declares its own `startup_probe` and `liveness_probe`
variables with these scaffold defaults:

- `startup_probe`: `enabled = true`, `type = "TCP"`, `path = "/"`,
  `initial_delay_seconds = 30`, `timeout_seconds = 10`,
  `period_seconds = 15`, `failure_threshold = 20`.
- `liveness_probe`: `enabled = false`, `path = "/"`,
  `initial_delay_seconds = 60`, `timeout_seconds = 5`,
  `period_seconds = 30`, `failure_threshold = 3`.

In practice, however, **both platform variants re-declare these same
variables with their own platform-tuned defaults** and forward them straight
into this module's inputs (`main.tf`: `startup_probe = var.startup_probe`,
`liveness_probe = var.liveness_probe`), so the values that actually reach the
Foundation are the App module's, not this scaffold default:

- **Cloud Run** (`Documenso_CloudRun`) uses a **TCP** startup probe on port
  3000 (`initial_delay_seconds = 30`, `failure_threshold = 10`) and disables
  the liveness probe entirely — Documenso has no dedicated health endpoint,
  and an HTTP probe against `/` risks failing before the app and database are
  both ready.
- **GKE** (`Documenso_GKE`) uses an **HTTP** `GET /` startup probe with a much
  longer budget (`period_seconds = 30`, `failure_threshold = 20`, roughly 10
  minutes total) to absorb cold start plus first-boot Prisma migrations, and
  an **HTTP** `GET /` liveness probe (`initial_delay_seconds = 60`,
  `failure_threshold = 3`).

Because there is no dedicated `/health`-style endpoint in Documenso, none of
these probes target anything more specific than the root path or a bare port
check.

---

## 7. Object storage

A dedicated **Cloud Storage** bucket (name suffix `uploads`, `STANDARD`
class, `force_destroy = true`, uniform bucket-level access, CORS enabled for
`GET`/`PUT`/`POST`/`DELETE`/`HEAD` from any origin) is declared here and
provisioned by the foundation. A companion service account
(`documenso_storage`, account ID `dc-store-<deployment_id_suffix>`) holds an
HMAC key pair (`S3_ACCESS_KEY` / `S3_SECRET_KEY`, §2) and is granted
`roles/storage.objectAdmin` on the bucket by the calling Application module.

This bucket is **opt-in infrastructure**: Documenso stores documents in
PostgreSQL by default (`NEXT_PUBLIC_UPLOAD_TRANSPORT = "database"`, §5) and
never writes to the bucket unless an operator explicitly sets
`NEXT_PUBLIC_UPLOAD_TRANSPORT=s3` and wires the `S3_ACCESS_KEY`/`S3_SECRET_KEY`
secret env vars into the running service. Until then, the bucket and its HMAC
key exist but are unused.

List it with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~documenso"
```

---

For the Documenso-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Documenso_GKE](Documenso_GKE.md)** and
**[Documenso_CloudRun](Documenso_CloudRun.md)**.
