---
title: "Firefly III Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Firefly III module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Firefly III Common — Shared Application Configuration

`FireflyIII_Common` is the **shared application layer** for Firefly III. It is not
deployed on its own; instead it supplies the Firefly III-specific configuration that
both [FireflyIII_GKE](FireflyIII_GKE.md) and [FireflyIII_CloudRun](FireflyIII_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of its
own — but understanding what it provides explains the defaults you see in the
platform docs.

For the infrastructure that actually provisions and runs Firefly III, see the
platform guides ([FireflyIII_GKE](FireflyIII_GKE.md),
[FireflyIII_CloudRun](FireflyIII_CloudRun.md)) and the foundation guides
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by FireflyIII_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates the Laravel `APP_KEY` (`base64:<44-char base64>`) and a 32-char `STATIC_CRON_TOKEN` and stores them in **Secret Manager** | Injected automatically as `APP_KEY` / `STATIC_CRON_TOKEN`; retrieve via Secret Manager (see below) |
| Container image | Uses the official prebuilt `fireflyiii/core:<version>` image directly — no Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** (`DB_CONNECTION = pgsql`) as the only engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the role, database, and grants | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** uploads bucket | `storage_buckets` output |
| Core settings | Sets the baseline Firefly III environment: connection, SSL mode, trusted proxies, app URL, environment | Application behaviour in the platform guides |
| Health checks | Supplies the default startup (TCP) / liveness (`/health`) probes | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager — they are
never set in plain text and must never be changed after the first deployment:

- **`APP_KEY`** — the Laravel application key, generated as
  `"base64:${base64encode(<32 random bytes>)}"` (a 44-character base64 string after
  the `base64:` prefix), which is exactly what Laravel's AES-256-CBC cipher expects.
  Firefly III uses it to encrypt sensitive fields at rest. **Rotating it after first
  boot makes previously encrypted data unreadable** — it is generated once and left
  untouched.
- **`STATIC_CRON_TOKEN`** — a 32-character random alphanumeric string. It
  authenticates Firefly III's cron endpoint (`GET /api/v1/cron/<STATIC_CRON_TOKEN>`)
  which drives recurring transactions, bill reminders, and auto-budgets. The token
  **must be exactly 32 characters** or Firefly III rejects the request.

Retrieve the secrets after deployment:

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~app-key OR name~cron-token"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Firefly III requires **PostgreSQL 15**; the engine is fixed (`database_type = "POSTGRES_15"`,
`DB_CONNECTION = "pgsql"`) and MySQL or other engines are not used by this module. On
the first deployment a one-shot job (`db-init`) runs using `postgres:15-alpine` and
idempotently:

1. Resolves the database host — a Cloud SQL private IP (Cloud Run) or `127.0.0.1`
   (the GKE Auth Proxy sidecar), falling back to `DB_IP`,
2. Waits for PostgreSQL to be reachable,
3. Creates (or updates) the application role with `LOGIN CREATEDB` and the generated
   password,
4. Creates the application database if it does not exist (owned by `postgres`, since
   Cloud SQL's `postgres` login cannot `SET ROLE` to application roles),
5. Grants `ALL PRIVILEGES` on the database and `ALL ON SCHEMA public` to the app
   role, and transfers `public` schema ownership (Postgres 15 no longer grants
   `CREATE` on `public` by default).

There is **no separate migrate job**. The `fireflyiii/core` image runs
`php artisan migrate --force` and `firefly-iii:upgrade-database` on container start,
so the schema is created and upgraded on first boot once `db-init` has provisioned
the database and role. The `db-init` job is safe to re-run. Inspect the database
directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image

Firefly III runs the official, prebuilt **`fireflyiii/core:<application_version>`**
image directly — `image_source = "prebuilt"`, no Cloud Build step and no custom
Dockerfile. The container serves the Laravel application over **Apache on port 8080**.
Application Modules forward `container_image_source` and `container_image` so the
foundation deploys this image rather than pointing the service at an unbuilt Artifact
Registry path.

The image self-migrates on start (`php artisan migrate --force` +
`firefly-iii:upgrade-database`), so upgrading `application_version` applies schema
changes on the next boot without a separate migration step.

---

## 5. Core application settings

`FireflyIII_Common` establishes the baseline Firefly III (Laravel) environment so the
application comes up correctly on first boot. Firefly III reads the Laravel-native DB
variables, so the Application Module sets `db_name_env_var_name = "DB_DATABASE"`,
`db_user_env_var_name = "DB_USERNAME"`, and `db_password_env_var_name = "DB_PASSWORD"`
and the foundation populates them with the deployment-scoped role/database names,
alongside `DB_HOST` and `DB_PORT`:

- **`DB_CONNECTION = "pgsql"`**, **`DB_PORT = "5432"`**.
- **`PGSQL_SSL_MODE`** — the libpq/PDO sslmode. `"require"` on **Cloud Run**
  (private-IP TCP to Cloud SQL, which rejects plaintext); `"prefer"` on **GKE**
  (the Cloud SQL Auth Proxy sidecar loopback is plaintext, so TLS is negotiated but
  not required).
- **`DB_HOST`** — the Cloud SQL private IP on Cloud Run; `127.0.0.1` on GKE (the
  proxy sidecar).
- **`TRUSTED_PROXIES = "**"`** — Firefly runs behind the Cloud Run / GKE Gateway
  reverse proxy, so it trusts all proxies to build correct absolute URLs and honour
  `X-Forwarded-*`.
- **`APP_ENV = "production"`**.
- **`APP_URL`** — set to the predicted service URL on Cloud Run (via `service_url`);
  on GKE it is left to the operator to set the real browser host via
  `application_domains` / `APP_URL`.

Platform-specific adjustments handled here:

- **Cloud Run** sets `APP_URL` from the predicted `run.app` service URL at plan time
  and connects to Cloud SQL over private-IP TCP with `sslmode=require`.
- **GKE** overrides `DB_HOST = 127.0.0.1` (the Auth Proxy sidecar) and keeps
  `sslmode=prefer`; the operator sets `APP_URL` to the LoadBalancer or custom-domain
  URL after the external IP is known.

---

## 6. Health probe behaviour

- **Startup** uses a **TCP** probe on port 8080 (the app is ready as soon as Apache
  binds its port), avoiding redirect/auth issues on an HTTP path during boot.
- **Liveness** targets Firefly III's unauthenticated **`/health`** endpoint, which
  returns HTTP 200 without a login — a healthy signal that does not require a session.
  A generous initial delay accommodates the schema migrations that run on first boot.

---

## 7. Object storage

A dedicated **Cloud Storage** uploads bucket (`fireflyiii-uploads`) is declared here
and provisioned by the foundation, which also grants the workload service account
access. On GKE and Cloud Run, Firefly III's attachments/runtime directory is also
backed by the optional NFS (Filestore) mount at `/var/lib/fireflyiii`. List the
bucket with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

## 8. First run

No admin credential is pre-seeded in Secret Manager. On first visit, Firefly III
serves a **`/register`** form; the **first account created becomes the site
owner/administrator**. After creating it, disable open registration in
**Administration → Settings** to prevent unauthorised account creation. Firefly III's
own Personal Access Tokens (for its REST API and the companion Data Importer) are
created from the running app — they are separate from the platform's
`STATIC_CRON_TOKEN`.

---

For the Firefly III-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[FireflyIII_GKE](FireflyIII_GKE.md)** and **[FireflyIII_CloudRun](FireflyIII_CloudRun.md)**.
