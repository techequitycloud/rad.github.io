---
title: "GoToSocial Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the GoToSocial module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# GoToSocial Common — Shared Application Configuration

`GoToSocial_Common` is the **shared application layer** for GoToSocial, a
lightweight, self-hosted ActivityPub/Fediverse server — a small alternative
to Mastodon, written as a single static Go binary. It is not deployed on its
own; instead it supplies the GoToSocial-specific configuration that both
[GoToSocial_GKE](GoToSocial_GKE.md) and
[GoToSocial_CloudRun](GoToSocial_CloudRun.md) build on, so the two platform
variants behave identically where it matters. End users never configure this
layer directly — it has no deployment UI inputs of its own — but understanding
what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs GoToSocial, see the
platform guides ([GoToSocial_GKE](GoToSocial_GKE.md),
[GoToSocial_CloudRun](GoToSocial_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by GoToSocial_Common | Where it surfaces |
|---|---|---|
| Container image | Deploys the official `docker.io/superseriousbusiness/gotosocial` image directly — **no custom build**. GoToSocial's own upstream has moved to Codeberg, but the container registry is still Docker Hub | `container_image` output; `image_source = "prebuilt"` |
| Cryptographic secrets | Generates `SUPERUSER_PASSWORD` (24-char random), plus an HMAC access/secret key pair for GCS S3-interop storage. All stored in **Secret Manager** | Injected via the `secret_ids` → `module_secret_env_vars` path (see §2) |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine, with the mandatory `C` collation | §3 below |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database with `LC_COLLATE='C' LC_CTYPE='C'` and the application role | `initialization_jobs` output |
| Admin account bootstrap | Defines the `admin-create` job, deliberately **not** auto-executed — GoToSocial has no web sign-up flow | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** `storage` bucket and a dedicated storage service account with an HMAC key pair for GoToSocial's native S3-compatible client | `storage_buckets` / `storage_sa_email` outputs |
| Core settings | Sets `GTS_HOST`, `GTS_PROTOCOL=https`, `GTS_PORT=8080`, `GTS_LETSENCRYPT_ENABLED=false`, `GTS_STORAGE_*`, `GTS_TRUSTED_PROXIES`, `GTS_ACCOUNTS_REGISTRATION_OPEN` | Application behaviour in the platform guides |
| Health checks | Declares **TCP** `startup_probe`/`liveness_probe` defaults — HTTP never works against GoToSocial's endpoints (see §6) | §Observability in the platform guides |

---

## 2. Secrets: how `SUPERUSER_PASSWORD` and the S3 keys actually reach the container

Three secrets are generated automatically and stored in Secret Manager:

- **`SUPERUSER_PASSWORD`** — a 24-character random string (`random_password`,
  `special = false`). Consumed only by the `admin-create` init job, passed to
  `gotosocial admin account create --password`. This is the password for the
  instance's first (owner) account.
- **`GTS_STORAGE_S3_ACCESS_KEY`** / **`GTS_STORAGE_S3_SECRET_KEY`** — a GCS
  HMAC key pair (`google_storage_hmac_key`) minted on a dedicated service
  account (`gotosocial_storage`, account ID `gts-store-<hex_suffix>`).
  Consumed by the main container's `GTS_STORAGE_BACKEND=s3` client.

**A real gotcha worth flagging prominently.** `GoToSocial_Common`'s `config`
object sets `secret_environment_variables = var.secret_environment_variables`
— an operator-facing passthrough — and this field is a **dead Foundation
no-op**. Confirmed against `App_CloudRun`/`App_GKE` source:
`secret_environment_variables` only ever merges the top-level
`var.secret_environment_variables` with the Foundation's own presets; it
**never** reads `local.selected_module.secret_environment_variables` (the
per-app config object field) — even though earlier scaffold generations of
this module (inherited from Synapse, itself cloned from Zammad) wrote exactly
that dead field. Wiring a secret through this field silently drops it: it
never reaches the deployed container.

The mechanism that actually works — and the one both `SUPERUSER_PASSWORD` and
the S3 keys use — is:

```
GoToSocial_Common.secret_ids  →  module_secret_env_vars local (Application module)  →  Foundation module_secret_env_vars input
```

`GoToSocial_CloudRun/gotosocial.tf` and `GoToSocial_GKE/main.tf` both set
`module_secret_env_vars = module.gotosocial_app.secret_ids`. During
development this distinction cost real debugging time: the S3 access/secret
key env vars were silently absent from the deployed revision, producing
"Access Denied" errors from GCS on every storage operation, until the wiring
was traced back to the dead `secret_environment_variables` config field.

Retrieve the secrets after deployment:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~superuser-password OR name~s3-access-key OR name~s3-secret-key"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation;
its secret name is reported in the platform deployment outputs
(`database_password_secret`).

---

## 3. Database engine and the mandatory C collation

GoToSocial requires **PostgreSQL** (`database_type = "POSTGRES_15"`), and has
a hard runtime requirement most Postgres-backed apps in this catalogue don't:
the database must be created with **`LC_COLLATE='C'` and `LC_CTYPE='C'`** — it
refuses to start against any other collation
("Database has incorrect collation ... GoToSocial now requires 'C'
collation"). The generic Foundation `db-create` step does not set this, so
`GoToSocial_Common` ships a dedicated `db-init` job
(`scripts/db-init.sh`, image `postgres:15-alpine`) that idempotently:

1. Waits for PostgreSQL to accept connections,
2. Creates (or updates the password of) the application role,
3. Creates the application database with
   `ENCODING 'UTF8' LC_COLLATE='C' LC_CTYPE='C' TEMPLATE template0`, owned by
   the application role — recreating an empty wrong-collation database if the
   Foundation created one first (no data-loss risk since this only ever
   happens on a genuinely fresh deploy),
4. Grants all privileges on the database to the application role,
5. Signals the Cloud SQL Auth Proxy sidecar to shut down (`POST
   http://127.0.0.1:9091/quitquitquit`) so the Job completes on GKE.

**There is no migrate job.** GoToSocial creates and upgrades its own schema
automatically every time it starts — `db-init` only ever prepares an empty,
correctly-collated database and role.

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
-- Verify the collation:
SELECT datname, datcollate, datctype FROM pg_database WHERE datname = '<db-name>';
```

---

## 4. Container image — no wrapper needed

Unlike most Common modules in this catalogue, `GoToSocial_Common` does
**not** build a custom image. It sets:

```hcl
image_source    = "prebuilt"
container_image = "docker.io/superseriousbusiness/gotosocial:${var.application_version}"
```

The official Dockerhub image's own `ENTRYPOINT`
(`/gotosocial/gotosocial server start`) reads discrete `GTS_*` environment
variables natively — confirmed against the upstream Dockerfile
(`alpine:3.21` base, non-root `1000:1000`). No entrypoint wrapper is needed
to translate the Foundation's generic `DB_*` names, because the calling
Application module aliases them directly onto `GTS_DB_*` via
`db_host_env_var_name`/`db_user_env_var_name`/etc. in its own `main.tf` (see
§Database in the platform guides for the Cloud Run vs. GKE TLS-mode
asymmetry this aliasing runs into).

---

## 5. Core application settings

`GoToSocial_Common` establishes the baseline GoToSocial environment
(`local.environment_variables` in `main.tf`):

- **`GTS_HOST`** — the public domain, baked into every locally-created
  ActivityPub actor/object URI at creation time. **Immutable after first
  boot** — same risk class as Synapse's `server_name` or Outline's `URL`.
- **`GTS_ACCOUNT_DOMAIN`** — optional separate vanity domain for account
  handles; defaults to `GTS_HOST` when empty. Same immutability risk.
- **`GTS_PROTOCOL = "https"`** — must stay `https` even though the container
  only ever speaks plain HTTP internally; Cloud Run/GKE terminate the real
  public HTTPS connection at their own edge. GoToSocial's own docs warn that
  switching this value later permanently breaks already-generated URIs.
- **`GTS_PORT = "8080"`**, **`GTS_BIND_ADDRESS = "0.0.0.0"`**.
- **`GTS_LETSENCRYPT_ENABLED = "false"`** — mandatory; the platform's own
  edge already terminates TLS, and GoToSocial's built-in ACME client would
  otherwise try (and fail, noisily but harmlessly) to bind ports 80/443
  itself.
- **`GTS_DB_TYPE = "postgres"`**, **`GTS_DB_TLS_MODE = "disable"`** — correct
  for GKE (the cloud-sql-proxy sidecar's `127.0.0.1` loopback); **overridden
  to `"enable"` by `GoToSocial_CloudRun`** because Cloud Run's
  `db_host_env_var_name` aliases the raw Cloud SQL private IP, not a Unix
  socket — see the CloudRun platform guide's Pitfalls table for the full
  TLS-mode explanation (`enable` vs `require` vs `disable` do **not** mean
  what their names suggest).
- **`GTS_STORAGE_BACKEND = "s3"`**, **`GTS_STORAGE_S3_ENDPOINT =
  "storage.googleapis.com"`**, **`GTS_STORAGE_S3_USE_SSL = "true"`**,
  **`GTS_STORAGE_S3_PROXY = "true"`** (GCS presigned-URL semantics differ
  from AWS S3, so media is served through GtS itself),
  **`GTS_STORAGE_S3_BUCKET_LOOKUP = "path"`**,
  **`GTS_STORAGE_S3_BUCKET = "gcs-<service_name>-storage"`**.
- **`GTS_TRUSTED_PROXIES = "0.0.0.0/0,::/0"`** — the container is only ever
  reached through Cloud Run's/GKE's own ingress (no direct client path
  exists), so the immediate hop is inherently trusted for
  `X-Forwarded-For`-based rate-limit IP bucketing, not an authentication
  decision.
- **`GTS_ACCOUNTS_REGISTRATION_OPEN`** — driven by `var.enable_open_registration`
  (default `false`). The instance owner is the `admin-create`-provisioned
  superuser.

Redis is intentionally **not** used — GoToSocial's cache is entirely
in-process; `enable_redis` defaults `false` and should stay that way.

---

## 6. Health probe behaviour — TCP only, and why

`GoToSocial_Common` declares `startup_probe` and `liveness_probe` as **TCP**
against the listening port:

- `startup_probe`: `type = "TCP"`, `path = "/readyz"` (informational only for
  a TCP probe), `initial_delay_seconds = 15`, `period_seconds = 10`,
  `failure_threshold = 10`.
- `liveness_probe`: `type = "TCP"`, `path = "/livez"`,
  `initial_delay_seconds = 30`, `period_seconds = 30`,
  `failure_threshold = 3`.

GoToSocial genuinely serves real, documented, unauthenticated `/readyz` (runs
a DB `SELECT`, returns `500` on failure) and `/livez` (cheap `200`) endpoints
— but **confirmed live**, both reject any request lacking a `User-Agent`
header with a deliberate anti-scraper `418 I'm a teapot` response:
`{"error": "I'm a teapot: no user-agent sent with request"}`. Neither Cloud
Run's nor GKE's built-in HTTP prober ever sends a `User-Agent` header, so no
HTTP-typed probe against any path — including these "unauthenticated"
health endpoints — can ever succeed. TCP-against-the-port is the only probe
type that actually works.

This holds at **both** this Common layer and the Application-module layer
(`startup_probe`/`liveness_probe` variables in `GoToSocial_CloudRun`/
`GoToSocial_GKE`) — both platform variants keep the Common defaults rather
than overriding them with an HTTP type, unlike a documented Planka precedent
elsewhere in this catalogue where a stale Application-level HTTP default
silently overrode an already-correct Common default. On Cloud Run, the
liveness probe is additionally **disabled** entirely — Cloud Run's API
rejects a TCP-socket liveness probe outright (confirmed elsewhere in this
catalogue, e.g. Kopia) — the startup probe alone is sufficient there.

`GoToSocial_Common`'s `config` object also declares a hardcoded, separate
`readiness_probe` (`type = "HTTP"`, `path = "/readyz"`) — a Foundation-level
construct distinct from `startup_probe`/`liveness_probe`; the probes that
actually gate traffic on both deployed platforms are the TCP pair above.

**Practical implication for anyone testing this app manually:** every
`curl`/tool used against a GoToSocial instance needs an explicit
`User-Agent` header, or it gets `418`'d — `curl -A "some-agent/1.0" ...`.

---

## 7. Object storage — GoToSocial's native S3 client, no FUSE mount

A dedicated **Cloud Storage** bucket (name suffix `storage`, `STANDARD`
class, `force_destroy = true`, no versioning, `public_access_prevention =
"enforced"`) is declared here and provisioned by the foundation. A companion
service account (`gotosocial_storage`, account ID
`gts-store-<hex_suffix>`) holds an HMAC key pair
(`GTS_STORAGE_S3_ACCESS_KEY` / `GTS_STORAGE_S3_SECRET_KEY`, §2) and is
granted `roles/storage.objectAdmin` on the bucket by the calling Application
module.

Unlike Documenso/Formbricks-style opt-in S3 storage, this bucket is
**required, always-on infrastructure** for GoToSocial — `GTS_STORAGE_BACKEND
= "s3"` is unconditional, so the app writes media, avatars, and attachments
to it from the very first boot. There is no GCS FUSE mount involved at all;
GoToSocial's own S3-compatible client talks to GCS's XML/S3-interop endpoint
(`storage.googleapis.com`) directly.

**The IAM grant must exist before the first pod/revision boots.** GoToSocial
**panics** on boot if it cannot reach its S3 backend
(`error opening storage backend: ... Access Denied`), so the Application
module wires the `roles/storage.objectAdmin` grant against
`module.app_cloudrun.storage_buckets["storage"]` /
`module.app_gke.storage_buckets["storage"]` (an output of the Foundation's
own storage submodule) rather than `depends_on = [module.app_cloudrun]` /
`depends_on = [module.app_gke]` (the whole module, including the
Deployment/Service). The latter would deadlock: the Deployment waits for a
healthy pod, which needs the IAM grant, which would itself be waiting on the
same Deployment to finish. Even with the narrower dependency, a **fresh
first deploy** may still hit IAM propagation delay (~1–2 minutes) racing the
very first container boot — this is an expected, occasional one-time retry,
not a bug.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~gotosocial"
gcloud iam service-accounts list --project "$PROJECT" --filter="email~gts-store"
```

---

## 8. Admin account bootstrap — deliberately manual/best-effort

GoToSocial has **no web-based sign-up flow and no REST endpoint** for the
very first account — it is CLI-only
(`gotosocial admin account create` / `admin account promote`, confirmed
against docs.gotosocial.org/admin/cli). Critically, confirmed live: the CLI
refuses to create any account until the main **server** process has
completed its own first-boot bootstrap (creating the DB's "instance
account"/"instance application" rows) — it panics with
`NewSignup: instance application not yet created, run the server at least
once before creating users` otherwise.

`GoToSocial_Common` defines the `admin-create` job with `execute_on_apply =
false`. This is deliberate, not an oversight:

- **On Cloud Run**, initialization jobs always run strictly before the
  service's first revision exists at all — so `admin-create` structurally
  cannot succeed during the same `apply` that creates the service. The job
  resource is still created (so the platform can trigger it on demand), but
  an operator must run it manually once the service is confirmed healthy —
  see the CloudRun platform guide for the exact command.
- **On GKE**, the ordering is looser: `execute_on_apply` on `App_GKE` only
  controls whether **Terraform waits** for the job
  (`wait_for_completion = try(execute_on_apply, true)`, confirmed against
  `App_GKE/jobs.tf`) — the underlying Kubernetes Job pod is still scheduled
  immediately regardless, racing the main Deployment's first pod.
  `scripts/admin-create.sh` retries up to 20 times at 15-second intervals
  specifically to give the main pod a real chance to finish booting first,
  so it has a genuine chance of succeeding automatically during the same
  `apply` — but it is not guaranteed to win that race every time.

A partially-failed `admin-create` attempt can leave an **orphaned account
row**: GoToSocial's `NewSignup` flow inserts the account row first, then
looks up the instance application ID for the corresponding `users` row,
panicking between those two steps if the server's bootstrap hadn't finished
yet. The orphaned row makes `IsUsernameAvailable` report "already in use" on
retry, while lookups used by a later `create`/`promote` attempt find nothing
— a confusing `sql: no rows in result set` panic that looks like an
unrelated bug. See the GKE platform guide's Pitfalls table and lab Task 5
for the exact SQL recovery steps.

---

For the GoToSocial-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[GoToSocial_GKE](GoToSocial_GKE.md)** and
**[GoToSocial_CloudRun](GoToSocial_CloudRun.md)**.
