---
title: "Forgejo Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Forgejo module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Forgejo Common — Shared Application Configuration

`Forgejo_Common` is the **shared application layer** for Forgejo. It is not
deployed on its own; instead it supplies the Forgejo-specific configuration
that both [Forgejo_GKE](Forgejo_GKE.md) and [Forgejo_CloudRun](Forgejo_CloudRun.md)
build on, so the two platform variants behave identically where it matters.
End users never configure this layer directly — it has no deployment UI
inputs of its own — but understanding what it provides explains the defaults
you see in the platform docs.

For the infrastructure that actually provisions and runs Forgejo, see the
platform guides ([Forgejo_GKE](Forgejo_GKE.md), [Forgejo_CloudRun](Forgejo_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Forgejo_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates `SECRET_KEY` (64-char) and `INTERNAL_TOKEN` (64-char) and stores them in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Wraps the official `codeberg.org/forgejo/forgejo` image with a custom platform entrypoint; builds via Cloud Build | `container_image` / `container_build_config` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database role and database and grants schema privileges | `initialization_jobs` output |
| Object storage | Declares **no** application-owned GCS bucket (`storage_buckets` output is always `[]`) — Forgejo persists everything on NFS/Postgres | `storage_buckets` output |
| Core settings | Sets the baseline Forgejo/Gitea environment: database type, server domain/URL/port, install lock, self-registration, NFS data path | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe targeting `/api/healthz` | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Two secrets are generated automatically (`secrets.tf`, via `random_password`)
and stored in Secret Manager — they are never set in plain text and must
never be changed after the first deployment:

- **`SECRET_KEY`** — a 64-character random string (`random_password`,
  `special = false`). Forgejo uses it to encrypt sensitive stored data such as
  2FA secrets and OAuth tokens (`GITEA__security__SECRET_KEY`). Rotating it
  after first boot makes previously encrypted data unreadable.
- **`INTERNAL_TOKEN`** — a 64-character random string. Authenticates
  Forgejo's own internal API calls between its `web`/`ssh` processes
  (`GITEA__security__INTERNAL_TOKEN`). Rotating it breaks Forgejo's internal
  API handshake until every process picks up the new value.

Secret names follow `secret-<resource-prefix>-forgejo-secret-key` and
`secret-<resource-prefix>-forgejo-internal-token`. A `time_sleep` of 30
seconds (`wait_for_secrets`) gives Secret Manager time to reach read-after-write
consistency before the `secret_ids`/`secret_values` outputs are consumed
downstream.

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key OR name~internal-token"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation;
its secret name is reported in the platform deployment outputs
(`database_password_secret`) and is aliased to `GITEA__database__PASSWD` (Cloud
Run) via `db_password_env_var_name` in each variant's `main.tf` — on GKE that
variable is left empty and the password instead reaches Forgejo through the
CSI-mounted `GITEA__database__PASSWD__FILE` (see [Section 4](#4-container-image-and-entrypoint)
and [App_Common](App_Common.md) for the shared secret and Workload Identity
model).

---

## 3. Database engine and bootstrap

Forgejo requires **PostgreSQL 15**; the engine is fixed via `database_type =
"POSTGRES_15"` and the `db-init.sh` script is written entirely against
`psql` — MySQL or `NONE` are not supported even though the platform's
`database_type` dropdown lists them as options. On the first deployment a
one-shot job (`db-init`, `postgres:15-alpine`, `execute_on_apply = true`,
`max_retries = 3`) idempotently:

1. Installs `curl` if missing (needed on the Alpine-based image on GKE; already
   present in App_CloudRun's Debian-based job image),
2. Forces `DB_HOST=127.0.0.1` when `DB_SSL=false` and `DB_HOST` is not already
   a socket path, to make sure traffic goes through the Cloud SQL Auth Proxy
   sidecar rather than a bare private IP,
3. Waits for PostgreSQL to accept connections (`SELECT 1` against the
   `postgres` superuser database, using the injected `ROOT_PASSWORD` secret),
4. Creates the application role (`CREATE ROLE ... LOGIN PASSWORD`) if it does
   not exist, or re-passwords it if it does, and grants it `CREATEDB` plus
   membership in `postgres`,
5. Creates the application database owned by that role if it does not exist,
   or re-assigns ownership if it already does,
6. Grants full privileges on the database and the `public` schema (PG15+
   requires an explicit schema grant even for the owner's own objects),
7. Signals the Cloud SQL Auth Proxy sidecar to shut down gracefully
   (`POST /quitquitquit` on `localhost:9091`, polled for up to 60 seconds).

No Postgres extensions are installed by this script — Forgejo creates and
migrates its own schema on first container start (see
[Section 4](#4-container-image-and-entrypoint)), so nothing beyond the empty,
owned database is required. The job is safe to re-run.

Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image (`scripts/Dockerfile`) wraps
`codeberg.org/forgejo/forgejo:${FORGEJO_VERSION}` — an app-specific build ARG,
not the generic `APP_VERSION` the foundation injects into `build_args` (which
would otherwise win the merge and resolve to `forgejo:latest`); the Common
module maps `application_version = "latest"` to the pinned tag `11`. The
image runs as `root` (matching the stock Forgejo entrypoint, which itself
drops privileges to the `git` user under `s6`) and adds
`/platform-entrypoint.sh` (`scripts/entrypoint.sh`) as the container
`ENTRYPOINT`, re-declaring the stock `CMD ["/usr/bin/s6-svscan", "/etc/s6"]`
that overriding `ENTRYPOINT` would otherwise reset.

The platform entrypoint's responsibilities, run before handing off to
Forgejo's own entrypoint:

- **Composes `GITEA__database__*` from the foundation's discrete `DB_*` env
  vars at runtime**, rather than at Terraform plan time. Kubernetes-style
  `$(VAR)` references are not used because Cloud Run does not interpolate
  them (it would pass a literal `"$(DB_HOST)"` string, causing a DNS lookup
  failure) — composing at runtime keeps one entrypoint working unmodified on
  both platforms.
- **Selects the Postgres SSL mode per connection hop**, branching on the shape
  of `DB_HOST`:
  - Leading `/` (Cloud SQL Auth Proxy Unix-socket directory) → `HOST` = the
    socket dir, `SSL_MODE=disable`.
  - `127.0.0.1` or `localhost` (Cloud SQL Auth Proxy sidecar loopback, GKE) →
    `HOST` = `host:port`, `SSL_MODE=disable`.
  - Anything else (direct private-IP TCP, Cloud Run default) → `HOST` =
    `host:port`, `SSL_MODE=require` (Cloud SQL rejects unencrypted private-IP
    TCP).
- **Maps `DB_NAME` / `DB_USER`** straight through to `GITEA__database__NAME` /
  `GITEA__database__USER` when set.
- **Logs the resolved wiring** (`Forgejo DB wired: host=... sslmode=... name=...
  user=...`) for troubleshooting.
- **Re-resolves `s6-svscan` via `PATH`** if the passed command isn't directly
  runnable, since its path varies across base images (`/usr/bin` vs `/bin`),
  then `exec`s the stock `/usr/bin/entrypoint "$@"` as PID 1 — which applies
  the full `GITEA__*` environment to `app.ini` and launches the Forgejo server
  and `sshd` under `s6`.

---

## 5. Core application settings

`Forgejo_Common` establishes the baseline Forgejo/Gitea environment so the
application comes up correctly on first boot:

- **Database type** — `GITEA__database__DB_TYPE = "postgres"` (fixed).
- **Server** — `GITEA__server__DOMAIN = var.public_domain` (default
  `"localhost"`), `GITEA__server__ROOT_URL = var.public_url` (derived as
  `http://<public_domain>/` when `public_url` is left blank),
  `GITEA__server__HTTP_PORT = var.container_port` (default `3000`),
  `GITEA__server__PROTOCOL = "http"`.
- **Security** — `GITEA__security__INSTALL_LOCK = "true"`, which skips
  Forgejo's first-run web installer since the database and config are already
  supplied via environment variables.
- **Service** — `GITEA__service__DISABLE_REGISTRATION = "false"` — public
  self-registration is open by default.
- **Data path** — `GITEA__server__APP_DATA_PATH = var.nfs_mount_path` — points
  Forgejo's repository, Git LFS, and attachment storage at the mounted NFS
  volume (this module's own internal default is `/data`; both platform
  variants override it to `/mnt/nfs`).

Platform-specific adjustments handled here:

- **Cloud Run (`use_file_secrets = false`, the default)** — `SECRET_KEY` and
  `INTERNAL_TOKEN` are exposed under the `GITEA__security__` names directly in
  `secret_ids`, so the foundation injects them as `GITEA__` environment
  variables with no indirection (there is no SecretSync CRD restriction to
  work around on Cloud Run).
- **GKE (`use_file_secrets = true`)** — the GKE SecretSync CRD's `targetKey`
  validation forbids consecutive underscores, so `GITEA__` names cannot be
  synced-secret keys. Instead, `Forgejo_Common` materialises the secrets under
  the **simple** keys `SECRET_KEY` / `INTERNAL_TOKEN` (plus the DB password),
  and sets three additional environment variables that use Forgejo's own
  `GITEA__section__KEY__FILE` convention to point at the CSI-mounted files:
  `GITEA__database__PASSWD__FILE`, `GITEA__security__SECRET_KEY__FILE`,
  `GITEA__security__INTERNAL_TOKEN__FILE` (all under `var.secrets_mount_path`,
  default `/mnt/secrets-store`). These env var *names* contain `__` but are
  plain env vars, not synced-secret keys, so the CRD restriction does not
  apply to them.

---

## 6. Health probe behaviour

The default probes (declared here, in `variables.tf`) target `/api/healthz` —
Forgejo's unauthenticated health endpoint, which only responds correctly once
the server has finished its first-boot schema migrations:

- **`startup_probe`** — HTTP `/api/healthz`, `initial_delay_seconds=30`,
  `timeout_seconds=5`, `period_seconds=10`, `failure_threshold=30`.
- **`liveness_probe`** — HTTP `/api/healthz`, `initial_delay_seconds=15`,
  `timeout_seconds=5`, `period_seconds=30`, `failure_threshold=3`.

Both platform variants override these Common defaults in their own
`variables.tf`:

- **Cloud Run** widens the startup window to `period_seconds=20`,
  `failure_threshold=10` (roughly 200s of tolerance after the initial delay).
- **GKE** starts the startup probe immediately (`initial_delay_seconds=0`,
  `timeout_seconds=10`, `period_seconds=30`, `failure_threshold=10`) and
  delays the liveness probe further (`initial_delay_seconds=60`).

See the respective platform guides for the exact numbers each variant ships.

---

## 7. Object storage

`Forgejo_Common` always returns an **empty** `storage_buckets` output —
Forgejo does not use Cloud Storage for anything; all durable application data
lives on the NFS-mounted data directory (repositories, Git LFS objects,
attachments) and in Cloud SQL (metadata). Both platform variants still
provision a generic, unused `data`-suffixed bucket via the foundation's own
`storage_buckets`/`create_cloud_storage` default — that bucket exists
independently of this module and can be disabled with `create_cloud_storage =
false` if not needed. List any buckets with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~data"
```

---

For the Forgejo-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Forgejo_GKE](Forgejo_GKE.md)** and
**[Forgejo_CloudRun](Forgejo_CloudRun.md)**.
