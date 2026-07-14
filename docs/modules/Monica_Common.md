---
title: "Monica Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Monica module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Monica Common — Shared Application Configuration

`Monica_Common` is the **shared application layer** for Monica. It is not deployed
on its own; instead it supplies the Monica-specific configuration that both
[Monica_GKE](Monica_GKE.md) and [Monica_CloudRun](Monica_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Monica, see the platform
guides ([Monica_GKE](Monica_GKE.md), [Monica_CloudRun](Monica_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Monica_Common | Where it surfaces |
|---|---|---|
| Cryptographic secret | Generates the Laravel `APP_KEY` (`base64:` + 32 random bytes) and stores it in **Secret Manager** | Injected automatically as `APP_KEY`; retrieve via Secret Manager (see below) |
| Container image | Pulls the **official `monica:<version>` Apache image** from Docker Hub directly — prebuilt, no Cloud Build step | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** as the default engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** uploads bucket (`monica-uploads`) | `storage_buckets` output |
| Core settings | Sets the Laravel-native env baseline: `DB_CONNECTION`, `DB_PORT`, `APP_URL`, and the `DB_USERNAME`/`DB_PASSWORD`/`DB_DATABASE` env-name mapping | Application behaviour in the platform guides |
| Health checks | Supplies the default TCP startup probe (targeting `/`) and HTTP liveness probe (targeting `/status`) | §Observability in the platform guides |

---

## 2. Cryptographic secret in Secret Manager

One secret is generated automatically and stored in Secret Manager — it is never
set in plain text and must never be changed after the first deployment:

- **`APP_KEY`** — Monica is a Laravel application and requires an `APP_KEY` of the
  form `base64:<base64 of 32 random bytes>`. `Monica_Common` generates 32 random
  bytes, base64-encodes them, and stores the `base64:`-prefixed value in the secret
  `secret-<resource-prefix>-monica-app-key`. Laravel uses this key for AES-256-CBC
  encryption of all encrypted database columns and for signing cookies/sessions.
  **Rotating it after first boot permanently corrupts every encrypted field** (and
  invalidates all sessions) — the ciphertext cannot be decrypted with a new key.

Retrieve the secret after deployment:

```bash
# List the APP_KEY secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~monica-app-key"

# Read the secret value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Monica requires **MySQL**; `Monica_Common` fixes the engine at
`database_type = "MYSQL_8_0"`. On the first deployment a one-shot job (`db-init`)
runs using `mysql:8.0-debian` and idempotently:

1. Locates the Cloud SQL connection — the Auth Proxy Unix socket under `/cloudsql`
   when a socket volume is mounted, otherwise TCP via the instance private IP
   (`DB_IP`),
2. Waits for MySQL port `3306` to be reachable (TCP path),
3. Creates (or re-aligns the password of) the application user
   (`CREATE USER IF NOT EXISTS … / ALTER USER …`),
4. Creates the application database (`CREATE DATABASE IF NOT EXISTS`),
5. Grants all privileges on the database to the application user,
6. Verifies the app user can actually connect (catches password/grant mismatches
   early and warms the MySQL 8 `caching_sha2_password` auth cache),
7. Signals the Cloud SQL Auth Proxy sidecar to shut down gracefully (via the
   `quitquitquit` admin endpoint) so the Job exits cleanly.

The job is safe to re-run (`execute_on_apply = true`, `max_retries = 3`). **There is
no separate migration job** — the official Monica image's entrypoint runs
`php artisan migrate --force` automatically on container start, so the schema is
created and upgraded on first boot once `db-init` has provisioned the database and
user.

Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image

Monica is deployed from the **official upstream image** — `monica:<application_version>`
(the Apache variant) pulled directly from the Docker Hub library. The image source
is `prebuilt` (`image_source = "prebuilt"`), so there is **no Cloud Build step and no
custom entrypoint**; the platform runs the vendor image as-is. The Apache variant
serves the application on **port 80** and runs `php artisan migrate --force` on
container start.

Because the image is prebuilt, the platform variant must forward
`container_image_source = "prebuilt"` to the foundation (which otherwise defaults to
`custom` and would point the service at an unbuilt Artifact Registry path). Both
`Monica_CloudRun` and `Monica_GKE` do this.

---

## 5. Core application settings

Monica is a Laravel app and reads the **Laravel-native** environment variables.
`Monica_Common` sets the non-derived static configuration and relies on the platform
variant's `db_*_env_var_name` mapping for the deployment-scoped values:

- **`DB_CONNECTION = "mysql"`** and **`DB_PORT = "3306"`** — select the MySQL driver
  and port.
- **`DB_USERNAME` / `DB_PASSWORD` / `DB_DATABASE`** — the foundation injects these
  from the tenant-scoped role, database, and generated password because the variant
  `main.tf` sets `db_user_env_var_name = "DB_USERNAME"`,
  `db_password_env_var_name = "DB_PASSWORD"`, and `db_name_env_var_name = "DB_DATABASE"`.
  Never hardcode the short names — the real role/database are tenant-prefixed.
- **`DB_HOST`** — the foundation injects the Cloud SQL private IP on Cloud Run, and
  `Monica_GKE` overrides it to `127.0.0.1` (the Cloud SQL Auth Proxy sidecar). MySQL
  over the private-IP TCP path needs no SSL (the SnipeIT/Matomo pattern).
- **`APP_URL`** — set to the predicted public service URL so Laravel builds correct
  absolute links and the `/` → setup/registration redirect resolves on the right
  host.
- **`REDIS_HOST` / `REDIS_PORT`** — added only when `enable_redis = true`; when the
  host is left empty the foundation injects the NFS server VM IP (which co-hosts
  Redis).

---

## 6. Health probe behaviour

Monica serves an unauthenticated JSON health endpoint at `/status` with a `200`. The
defaults reflect that:

- **Startup probe** — **TCP** on `/` (port-listening) with a generous
  `failure_threshold` so first-boot Apache startup plus `php artisan migrate --force`
  has time to complete before traffic is routed.
- **Liveness probe** — **HTTP** `GET /status` expecting a `200`, with a long initial
  delay so a slow first migration does not trigger a restart loop.

---

## 7. Object storage

A dedicated **Cloud Storage** bucket (suffix `monica-uploads`) is declared here and
provisioned by the foundation, which also grants the workload service account access.
It holds Monica's uploaded files (contact photos, documents, avatars). List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Monica-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Monica_GKE](Monica_GKE.md)** and **[Monica_CloudRun](Monica_CloudRun.md)**.
