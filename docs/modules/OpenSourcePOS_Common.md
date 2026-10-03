---
title: "OpenSourcePOS Common — Shared Application Configuration"
description: "Shared configuration reference for the Open Source POS module — application-layer settings consumed by the Google Cloud Run deployment."
---

# OpenSourcePOS Common — Shared Application Configuration

`OpenSourcePOS_Common` is the **shared application layer** for Open Source Point
of Sale. It is not deployed on its own; instead it supplies the
OpenSourcePOS-specific configuration that
[OpenSourcePOS_CloudRun](OpenSourcePOS_CloudRun.md) builds on. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform
docs.

For the infrastructure that actually provisions and runs OpenSourcePOS, see the
platform guide ([OpenSourcePOS_CloudRun](OpenSourcePOS_CloudRun.md)) and the
foundation guides ([App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by OpenSourcePOS_Common | Where it surfaces |
|---|---|---|
| Secrets | **None** — OpenSourcePOS has no application signing secret; its only credential is the database password the Foundation generates | `secret_ids` / `secret_values` outputs are empty |
| Container image | Thin custom build of `jekkos/opensourcepos` with three image patches and a wrapper entrypoint; built via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** (`MYSQL_8_0`) | §Database in the platform guide |
| Database bootstrap | Two-job chain: `db-init` (database, user, grants) → `schema-load` (loads the schema bundled in the image) | `initialization_jobs` output |
| Upload storage | Declares a `storage` bucket and, when `enable_gcs_storage_volume = true`, a GCS Fuse volume at `/app/public/uploads` | `storage_buckets` output |
| Core settings | `DB_PORT = 3306` and `memory_limit` (from `php_memory_limit`) | Application behaviour in the platform guide |
| Health checks | Declares `startup_probe`/`liveness_probe` variables — the variant's own values are what take effect (see §7) | §Observability in the platform guide |

It also enables the Secret Manager API (`secretmanager.googleapis.com`) on the
project, with `disable_on_destroy = false`.

---

## 2. Secrets

OpenSourcePOS has no application-level signing secret, so this layer generates
none: `secret_ids` is `{}` and `secret_values` is `{}`. The database password is
generated and managed by the foundation; its secret name is reported in the
platform deployment outputs (`database_password_secret`).

```bash
gcloud secrets list --project "$PROJECT"
```

See [App_Common](App_Common.md) for the shared secret model.

---

## 3. Database engine and bootstrap

OpenSourcePOS runs on **Cloud SQL for MySQL 8.0** (`MYSQL_8_0`); the engine is
fixed by this layer. `enable_cloudsql_volume = false`: OpenSourcePOS reads a plain
TCP host, so the raw Cloud SQL private IP (`DB_IP`) is used and no socket volume
is mounted. There is no port override in OpenSourcePOS — the port stays at 3306.

When `initialization_jobs` is empty, two jobs run in sequence:

1. **`db-init`** (`mysql:8.0-debian`, `execute_on_apply = true`, `max_retries = 3`,
   `timeout_seconds = 600`) — uses the Cloud SQL Unix socket under `/cloudsql`
   when one is mounted, otherwise TCP via `DB_IP`; waits for MySQL; creates (or
   re-aligns the password of) the application user; creates the database; grants
   privileges; verifies the application user can connect (which also warms the
   `caching_sha2_password` server-side cache); then signals any Cloud SQL Auth
   Proxy sidecar to shut down.
2. **`schema-load`** (`depends_on_jobs = ["db-init"]`, `execute_on_apply = true`,
   `max_retries = 2`, `timeout_seconds = 900`) — runs on the **app image**
   (`image = null`) because the schema, `/app/app/Database/database.sql`, ships
   only inside `jekkos/opensourcepos`. It installs a MySQL client if the image
   lacks one, waits up to 60 seconds for the database, and counts the tables in
   it: if any exist it exits without changes. Otherwise it loads the schema and
   then counts again, failing if the database still has no tables (a client can
   exit 0 having applied only part of a script).

The schema is loaded by a job, not lazily at container start, because Cloud Run
can cold-start several instances at once and two of them racing the same
`CREATE TABLE` set would leave a half-loaded schema with no error. The upstream
image's CodeIgniter migrations (`php spark migrate`) are not used: they need a
fully bootstrapped app and a reachable database, which is circular at init time.

Supplying any `initialization_jobs` replaces both default jobs.

---

## 4. Container image and entrypoint

The custom image is a thin build: `FROM jekkos/opensourcepos:${OSPOS_VERSION}`
(one Apache process on port 80; `/var/www/html` is a symlink to `/app/public`, so
the DocumentRoot needs no change). The repository is **`jekkos/opensourcepos`** —
`opensourcepos/opensourcepos` does not exist on Docker Hub; the `opensourcepos`
organisation publishes only build tooling.

`OSPOS_VERSION` is an app-specific build ARG fed from `application_version`. The
Dockerfile's own fallback is `3.4.1`, and the
[OpenSourcePOS_CloudRun](OpenSourcePOS_CloudRun.md) variant also defaults to
`3.4.1` — the variant passes `application_version` down, so its value is the one
that takes effect. `3.4.1` is the newest tag matching a published upstream
stable release; the floating `3.4.2` tag corresponds to no upstream release.

`scripts/Dockerfile` patches three defects baked into the upstream image:

1. **Empty `timezone.ini`.** Upstream wrote `date.timezone = ""` from a build
   argument that was never set. The wrapper writes `date.timezone = "UTC"`
   (`PHP_TIMEZONE` build ARG, default `UTC`).
2. **`CI_ENVIRONMENT = development`.** CodeIgniter 4's development environment
   renders stack traces and the debug toolbar to the browser. The wrapper rewrites
   it to `production` in `/app/.env`. (This is a security fix, not a database one:
   the `MYSQL_*` overrides apply to every config group.)
3. **A `www`-stripping rewrite that downgrades TLS.** `public/.htaccess` ships an
   active rule that, behind Cloud Run's TLS termination, would 301
   `https://www.<domain>` to `http://`. The wrapper adds a
   `RewriteCond %{HTTP:X-Forwarded-Proto} !=https` guard.

`scripts/entrypoint.sh` runs on every container start:

- **Asserts `DB_IP`, `DB_USER`, `DB_PASSWORD` and `DB_NAME` are non-empty** and
  exits with a `FATAL:` message otherwise (see §5).
- **Maps them onto the four names OpenSourcePOS reads:** `MYSQL_HOST_NAME` ←
  `DB_IP`, `MYSQL_USERNAME` ← `DB_USER`, `MYSQL_PASSWORD` ← `DB_PASSWORD`,
  `MYSQL_DB_NAME` ← `DB_NAME`. `DB_HOST` is not used, because its socket-directory
  form is not a TCP host.
- Logs `[startup] OpenSourcePOS pointed at <ip>:3306/<db> as <user>`.
- Hands off with `exec docker-php-entrypoint "$@"` (`CMD ["apache2-foreground"]`).

---

## 5. The empty-variable trap (why the entrypoint refuses to start)

OpenSourcePOS's `Config/Database.php` applies each override as
`!getenv('X') ? $baked : getenv('X')`. `!getenv()` is true for an **empty string**
as well as an unset variable, so a blank value does not fail — it silently falls
through to the credentials baked into the image's `/app/.env` (`localhost` /
`admin` / `pointofsale` / `ospos`). The container would start, fail to reach a
database that is not there, and surface a generic CodeIgniter error naming nothing
useful. The wrapper therefore checks all four values and refuses to start rather
than run against the wrong database.

---

## 6. Storage and core settings

- **`storage` bucket** — declared by this layer (`STANDARD`, `force_destroy =
  true`, versioning off, public access prevention enforced). When
  `enable_gcs_storage_volume = true` (the default) it is mounted read-write at
  **`/app/public/uploads`**, where OpenSourcePOS stores item pictures and the
  company logo. The upstream image declares no volume for that path, so without
  the mount uploads are lost on every cold start.
- **Sessions** are stored in MySQL (CodeIgniter `DatabaseHandler`, table
  `ospos_sessions`), which is what makes running more than one instance safe.
- **Environment** — `DB_PORT = "3306"` and `memory_limit = var.php_memory_limit`
  (default `512M`), merged with any caller `environment_variables`.
- **`admin_username` / `admin_email`** — declared for display/documentation only.
  The OpenSourcePOS administrator is created by the bundled schema, not by this
  module.

This layer's own `min_instance_count`/`max_instance_count` defaults (`1`/`3`) are
overridden by the values the variant passes in (`0`/`1` in
[OpenSourcePOS_CloudRun](OpenSourcePOS_CloudRun.md)).

---

## 7. Health probe behaviour

This layer declares `startup_probe`/`liveness_probe` variables probing the
document root, where OpenSourcePOS serves its login form. The
[OpenSourcePOS_CloudRun](OpenSourcePOS_CloudRun.md) variant always passes its own
values, which are also HTTP `GET /`:

- **Startup probe** — `initial_delay_seconds = 30`, `period_seconds = 15`,
  `failure_threshold = 20`.
- **Liveness probe** — `initial_delay_seconds = 60`, `period_seconds = 30`,
  `failure_threshold = 3`.

---

For the OpenSourcePOS-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guide: **[OpenSourcePOS_CloudRun](OpenSourcePOS_CloudRun.md)**.

<!-- related-guides -->

## Related guides

- [OpenSourcePOS on Google Cloud Run](OpenSourcePOS_CloudRun.md) — this configuration deployed on Cloud Run.
