---
title: "Snipe-IT Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Snipe-IT module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Snipe-IT Common — Shared Application Configuration

`SnipeIT_Common` is the **shared application layer** for Snipe-IT. It is not
deployed on its own; instead it supplies the Snipe-IT-specific configuration
that both [SnipeIT_GKE](SnipeIT_GKE.md) and [SnipeIT_CloudRun](SnipeIT_CloudRun.md)
build on, so the two platform variants behave identically where it matters.
End users never configure this layer directly — it has no deployment UI
inputs of its own — but understanding what it provides explains the defaults
you see in the platform docs.

For the infrastructure that actually provisions and runs Snipe-IT, see the
platform guides ([SnipeIT_GKE](SnipeIT_GKE.md), [SnipeIT_CloudRun](SnipeIT_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by SnipeIT_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates the Laravel `APP_KEY` (`base64:` + 32 random bytes base64-encoded) and stores it in **Secret Manager** | Injected automatically; retrieve via Secret Manager (see below) |
| Container image | Deploys the official `snipe/snipe-it:<application_version>` image directly — no custom build, no custom entrypoint | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the ordered init-job chain (`db-init` → `migrate`) that creates the database/user and runs Laravel migrations | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** `snipeit-uploads` bucket | `storage_buckets` output |
| Core settings | Sets the baseline Snipe-IT (Laravel) environment: `APP_ENV`, `DB_CONNECTION`, session/cache/queue drivers, `APP_URL`, Redis wiring | Application behaviour in the platform guides |
| Health checks | Supplies the default TCP startup probe and HTTP liveness probe, identical across both platform variants | §Observability in the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

Exactly **one** secret is generated automatically and stored in Secret
Manager — unlike some Common modules that mint two or three, Snipe-IT needs
only the Laravel application key. It is never set in plain text and should
never be changed after the first deployment:

- **`APP_KEY`** — Laravel requires this in the form `"base64:<base64 of 32
  random bytes>"`. `SnipeIT_Common` generates a 32-character ASCII
  `random_password` (32 bytes), base64-encodes it, and prefixes it with
  `base64:` — exactly what Laravel's AES-256-CBC cipher expects once the
  prefix is stripped. It is stored at
  `secret-<resource_prefix>-snipeit-app-key` and injected as the `APP_KEY`
  secret environment variable via the `secret_ids` output. Rotating it after
  first boot invalidates all active sessions and makes any data Snipe-IT
  encrypted with the old key (e.g. stored third-party credentials)
  unrecoverable.

A `cleanup_orphaned_secrets` submodule runs ahead of secret creation to
remove stale secret versions left behind by a renamed/recreated deployment,
and a `time_sleep` of 30 seconds (`wait_for_secrets`) gates the `secret_ids`
output so dependent resources don't race the secret version's propagation.

The database password is generated and managed separately by the foundation;
its secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

Retrieve the secret after deployment:

```bash
# List the Snipe-IT secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~snipeit-app-key"

# Read the secret version (returns the full "base64:..." value):
gcloud secrets versions access latest --secret=<app-key-secret-name> --project "$PROJECT"
```

---

## 3. Database engine and bootstrap

Snipe-IT requires **MySQL 8.0**; `SnipeIT_Common` hardcodes
`database_type = "MYSQL_8_0"` in its `config` output regardless of what the
Application module or user passes in — no other engine is supported. Unless
an Application module overrides `initialization_jobs`, two ordered jobs run
on every apply:

1. **`db-init`** (image `mysql:8.0-debian`, `execute_on_apply = true`,
   `max_retries = 3`, 600 s timeout) — runs `scripts/db-init.sh`, which:
   - installs `nc`/`curl`/`mysql-client` for whichever base image it lands on,
   - on GKE, prefers Secret Store CSI-mounted files under
     `/mnt/secrets-store/` (`root-password`, `db-password`) over the injected
     env vars, since the mounted files are always authoritative,
   - looks for a Cloud SQL Auth Proxy Unix socket under `/cloudsql` (waiting
     up to 30 s for it to appear) and prefers it; if none is mounted or none
     appears, falls back to TCP against `DB_IP` (or a non-socket `DB_HOST`),
   - waits for TCP connectivity on port 3306 when using TCP,
   - detects whether the local `mysql` client supports
     `--get-server-public-key` and uses it for TCP connections, since Cloud
     SQL MySQL 8's `caching_sha2_password` needs RSA key exchange over a
     plain (proxy-terminated) TCP channel,
   - writes a temporary `~/.my.cnf` (root credentials, safely escaped) rather
     than passing the password on the command line,
   - idempotently creates (or re-passwords) the application user, creates the
     database if missing, and grants full privileges on it,
   - **verifies the app user can actually connect** — this both catches
     password/grant problems at job time rather than at pod boot, and warms
     MySQL 8's server-side `caching_sha2_password` auth cache so later
     PHP/client connections don't need the RSA exchange,
   - shuts the Cloud SQL Auth Proxy sidecar down gracefully via the
     `quitquitquit` admin endpoint (falling back to `SIGKILL`, never
     `SIGTERM`, since `SIGTERM` exits 143 and triggers an `OnFailure` restart).
2. **`migrate`** (image `snipe/snipe-it:<application_version>`,
   `depends_on_jobs = ["db-init"]`, `max_retries = 2`, 1200 s timeout) — runs
   `php /var/www/html/artisan migrate --force` so the schema exists before
   the first application revision serves traffic. The Foundation merges the
   full app env and secrets (`APP_ENV`, `DB_CONNECTION`, `DB_HOST`,
   `DB_DATABASE`, `DB_USERNAME`, `DB_PORT`, `APP_KEY`, `DB_PASSWORD`,
   `ROOT_PASSWORD`) into this job automatically, so no per-job env wiring is
   defined here. The official image's own boot-time auto-migration, if any,
   is a secondary safety net, not the primary schema-creation path.

Both jobs are safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment
outputs.

---

## 4. Container image and entrypoint

`SnipeIT_Common` deploys the **official, unmodified** `snipe/snipe-it:<application_version>`
image (default tag `v8-latest`) straight from Docker Hub:

- `image_source = "prebuilt"` and `container_build_config.enabled = false` —
  there is no Cloud Build step and no Dockerfile owned by this module. The
  `dockerfile_path`/`context_path`/`base_image` fields in
  `container_build_config` are declared for shape parity with custom-build
  Common modules but are inert while `enabled = false`.
- **No custom entrypoint script.** Unlike Common modules that wrap their
  base image with a shell entrypoint to translate env vars or correct URLs
  at runtime, `SnipeIT_Common`'s `scripts/` directory contains only
  `db-init.sh` (an init-job script, not a container entrypoint) — there is
  no `entrypoint.sh` or `Dockerfile` here. All boot-time behaviour (Apache
  startup, permission fix-ups, Laravel key/config checks) is whatever the
  official `snipe/snipe-it` image already does internally; this repository
  does not intercept or modify it.
- Because there is no translation layer, the Foundation's injected
  `DB_HOST`/`DB_IP`/`DB_PASSWORD`/`APP_KEY` must already match the names
  Laravel's `env()` config expects. `SnipeIT_Common`'s own code comments
  note that this is achieved one layer up: the Application module's
  `main.tf` sets `db_user_env_var_name = "DB_USERNAME"` and
  `db_name_env_var_name = "DB_DATABASE"` so the Foundation populates
  `DB_USERNAME`/`DB_DATABASE` directly, and injects the password under
  `db_password_env_var_name = "DB_PASSWORD"`. `SnipeIT_Common` itself only
  sets the static, non-derived configuration (`DB_CONNECTION`, `DB_PORT`,
  etc.) on top of that.
- `enable_mysql_plugins = false` and `mysql_plugins = []` are fixed in the
  `config` output — Snipe-IT has no MySQL plugin requirement.

---

## 5. Core application settings

`SnipeIT_Common` establishes the baseline Snipe-IT (Laravel) environment so
the application comes up correctly on first boot, merging (in order) static
defaults, a conditional `APP_URL`, conditional Redis settings, and finally
any caller-supplied `environment_variables` (which win on key conflicts):

- **Environment** — `APP_ENV = "production"`, `APP_DEBUG = "false"`.
- **Database connection** — `DB_CONNECTION = "mysql"`, `DB_PORT = "3306"`.
  (`DB_HOST`, `DB_USERNAME`, `DB_DATABASE`, `DB_PASSWORD` are injected by the
  Foundation under the Laravel-native names configured one layer up — see
  §4.)
- **Session/cache/queue persistence** — `SESSION_DRIVER = "database"`,
  `CACHE_DRIVER = "file"`, `QUEUE_DRIVER = "database"` — sessions and queued
  jobs are persisted so they survive container/pod restarts even with a
  single running instance.
- **`APP_URL`** — set from `var.service_url` whenever it is non-empty (the
  Foundation always exports a predicted service URL — `CLOUDRUN_SERVICE_URL`
  on Cloud Run, the GKE service URL on GKE — which the Application module
  passes through as `service_url`). Getting this wrong breaks Snipe-IT's
  `/` → `/setup` installation-wizard redirect.
- **Redis** — when `var.enable_redis` is true, sets `REDIS_HOST` (to
  `var.redis_host` if non-empty, else the Foundation's `$(REDIS_HOST)`
  runtime reference) and `REDIS_PORT`. This module always forwards
  `enable_redis` unconditionally rather than gating it on `redis_host`
  being set, per the repository's Redis-injection convention.

Platform-specific adjustments are **not** made inside `SnipeIT_Common`
itself — the `enable_cloudsql_volume` variable declared here defaults to
`true` (a generic Common-layer default), but each Application module
overrides it independently to match its platform's connection model:
`SnipeIT_CloudRun` defaults it to **`false`** (reach Cloud SQL over the
private-IP TCP path — the proven convention for this Laravel/MySQL app,
matching Matomo), while `SnipeIT_GKE` defaults it to **`true`** (the Cloud
SQL Auth Proxy sidecar listening on `127.0.0.1`, required on GKE). Both
variants rely on the same `db-init.sh` socket-or-TCP fallback logic
described in §3.

---

## 6. Health probe behaviour

The default probes are declared once in `SnipeIT_Common`'s `variables.tf`
and are **identical across both platform variants** — neither
`SnipeIT_CloudRun` nor `SnipeIT_GKE` overrides them:

- **Startup probe** — **TCP** on the container port, 30 s initial delay,
  10 s timeout, 15 s period, failure threshold 20 (a ~5-minute window) —
  generous enough to cover the `db-init` → `migrate` job chain and the
  PHP/Apache boot sequence on first deploy.
- **Liveness probe** — **HTTP** `GET /`, 300 s initial delay, 60 s timeout,
  60 s period, failure threshold 3. Snipe-IT serves its login/setup page at
  `/` unauthenticated, so a 200 there confirms the PHP application and its
  database connection are healthy without requiring credentials.

Unlike Common modules whose GKE and Cloud Run variants diverge (e.g. one
platform lacking an accurate health endpoint by default), Snipe-IT's probe
behaviour is identical on both because both variants inherit these defaults
unmodified.

---

## 7. Object storage

A single dedicated **Cloud Storage** bucket is declared here and provisioned
by the foundation, which also grants the workload service account access:

- **`snipeit-uploads`** (`name_suffix = "snipeit-uploads"`, `location =
  var.region`, `force_destroy = true`).

This bucket is separate from Snipe-IT's NFS (Cloud Filestore) mount — the
runtime upload tree for asset images, signatures, and barcodes
(`/var/lib/snipeit` by default) is provisioned and mounted by the
Application module's `enable_nfs`/`nfs_mount_path` settings in
[App_GKE](App_GKE.md)/[App_CloudRun](App_CloudRun.md), not by
`SnipeIT_Common`.

List the bucket with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~snipeit-uploads"
```

---

**Note on declared-but-unused variables.** `SnipeIT_Common`'s
`variables.tf` declares `php_memory_limit`, `upload_max_filesize`, and
`post_max_size` (carried over, under a leftover `# Wordpress Specific
Variables` comment, from the module template this was cloned from). None of
the three is referenced anywhere in `local.config` — they are accepted for
UI/convention parity with sibling PHP-app modules but have no effect on the
deployed Snipe-IT container, which keeps the official image's own baked-in
PHP settings.

---

For the Snipe-IT-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[SnipeIT_GKE](SnipeIT_GKE.md)** and
**[SnipeIT_CloudRun](SnipeIT_CloudRun.md)**.
