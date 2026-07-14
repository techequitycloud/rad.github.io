---
title: "Mixpost Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Mixpost module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Mixpost Common — Shared Application Configuration

`Mixpost_Common` is the **shared application layer** for Mixpost. It is not
deployed on its own; instead it supplies the Mixpost-specific configuration
that both [Mixpost_GKE](Mixpost_GKE.md) and [Mixpost_CloudRun](Mixpost_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of
its own — but understanding what it provides explains the defaults you see in
the platform docs.

For the infrastructure that actually provisions and runs Mixpost, see the
platform guides ([Mixpost_GKE](Mixpost_GKE.md), [Mixpost_CloudRun](Mixpost_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Mixpost_Common | Where it surfaces |
|---|---|---|
| Cryptographic secrets | Generates the Laravel `APP_KEY` (32 random bytes, stored as `base64:<value>`) and stores it in **Secret Manager** | Injected automatically as the `APP_KEY` secret env var; retrieve via Secret Manager (see below) |
| Container image | Deploys the official `inovector/mixpost:<version>` image **directly** — `image_source = "prebuilt"`, no custom build, `enable_image_mirroring = true` mirrors it into Artifact Registry | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** (`database_type = "MYSQL_8_0"`) as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job (`db-init`) that creates the database (`utf8mb4`), user, and grants — no separate migrate job, since the image migrates itself on boot | `initialization_jobs` output |
| Object storage | Declares a `storage`-suffixed **Cloud Storage** bucket | `storage_buckets` output |
| Core settings | Sets the baseline Laravel/Mixpost environment: app name/env/debug, `DB_CONNECTION=mysql`, `TRUSTED_PROXIES`, outbound mail sender | Application behaviour in the platform guides |
| Health checks | Supplies default startup/liveness probe defaults (both HTTP on `/`); overridden per-platform in the variant `main.tf`/`variables.tf` | §Health probe behaviour below and the platform guides |

---

## 2. Cryptographic secrets in Secret Manager

One secret is generated automatically and stored in Secret Manager — it is
never set in plain text and must never be rotated after the first deployment:

- **`APP_KEY`** (`secret-<resource_prefix>-<application_name>-app-key`) — 32
  random bytes (`random_password`, `special = false`) written to Secret Manager
  as `base64:<base64-encoded-value>`, matching Laravel's native `APP_KEY`
  format. Laravel apps require this key to encrypt/decrypt session data,
  cookies, and any encrypted database fields. Rotating it after first boot
  invalidates all existing encrypted session/cookie data and any encrypted
  columns — there is no re-encryption path.

The database password is generated and managed separately by the foundation;
its secret name is reported in the platform deployment outputs
(`database_password_secret`). See [App_Common](App_Common.md) for the shared
secret and Workload Identity model.

Retrieve the secret after deployment:

```bash
# List secrets for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~mixpost-app-key"

# Read the secret version (Laravel's native base64: format):
gcloud secrets versions access latest --secret=<app-key-secret-name> --project "$PROJECT"
```

`Mixpost_Common` also runs a `cleanup_orphaned_secrets` submodule ahead of
secret creation, and gates the `APP_KEY` secret version behind a 30-second
`time_sleep` so dependent resources (initialization jobs, the container
config) don't race the secret's propagation through Secret Manager.

---

## 3. Database engine and bootstrap

Mixpost requires **MySQL 8.0**; the engine is fixed
(`database_type = "MYSQL_8_0"`, `DB_CONNECTION = "mysql"`) and other engines are
not supported. On the first deployment a one-shot job (`db-init`, image
`mysql:8.0-debian`) runs `scripts/db-init.sh` and idempotently:

1. Resolves the target host — prefers `DB_HOST` (the Cloud SQL Auth Proxy
   loopback address on GKE) and falls back to `DB_IP` (direct private IP) —
   and detects whether it is a Unix socket path (`-S`, Cloud Run) or a TCP host
   (`-h ... --get-server-public-key`, GKE via the Auth Proxy sidecar; the
   public-key flag is required because MySQL 8's `caching_sha2_password`
   refuses to send a password over what looks like an unencrypted connection),
2. Waits for MySQL to become reachable (up to 30 retries, 2s apart), using
   root credentials if `ROOT_PASSWORD` is set, or the app user's own
   credentials otherwise,
3. Creates the application database with `utf8mb4` / `utf8mb4_0900_ai_ci`
   (MySQL 8.0 default collation),
4. Drops and recreates the application user (`DROP USER IF EXISTS` then
   `CREATE USER ... IDENTIFIED BY`, relying on the server's default auth
   plugin rather than pinning `mysql_native_password`, which MySQL 8.4 removed),
5. Grants full privileges on the database plus `CREATE, ALTER, DROP, INDEX,
   REFERENCES`,
6. Verifies the application user can connect and prints database charset/
   collation/version info,
7. On the TCP (GKE) path only, sends a `quitquitquit` shutdown POST to the
   Cloud SQL Auth Proxy sidecar on `127.0.0.1:9091` (via `curl` or a raw
   `/dev/tcp` fallback, since `mysql:8.0-debian` has neither `curl` nor `wget`
   guaranteed) so the sidecar exits after the job completes; on the Unix-socket
   (Cloud Run) path there is no proxy sidecar, so this step is skipped.

There is **no separate migration job** — the prebuilt `inovector/mixpost`
image's own supervisord entrypoint runs `php artisan migrate --force` and
seeds the admin account on every container boot, so schema upgrades apply
automatically the next time the app starts after `application_version`
changes. The `db-init` job is safe to re-run (`execute_on_apply = true`,
`max_retries = 1`).

Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

Unlike most custom-built Application modules, `Mixpost_Common` does **not**
build or wrap an image — `image_source = "prebuilt"` and
`container_build_config.enabled = false`. The container config points directly
at `inovector/mixpost:<application_version>` (Mixpost Lite), which Google
mirrors into Artifact Registry when `enable_image_mirroring = true` (the
default). There is no custom `entrypoint.sh` or `Dockerfile` in
`modules/Mixpost_Common/scripts/` — the only script shipped by this layer is
`db-init.sh` for the initialization job.

All entrypoint responsibilities — reading environment variables, running
`php artisan migrate --force`, seeding the default admin account, and starting
nginx + PHP-FPM under supervisord — are handled entirely inside the official
`inovector/mixpost` image's own boot process. This means:

- There is **no env-var translation layer** in this module (contrast with
  apps like Activepieces, which map platform `DB_*` variables to an
  app-native prefix in a custom entrypoint) — Mixpost reads the Laravel-native
  `DB_CONNECTION`, `DB_HOST`, `DB_PORT`, `DB_PASSWORD` directly, plus
  `DB_USERNAME` / `DB_DATABASE`, which the variant `main.tf` files map from the
  Foundation's tenant-scoped `DB_USER`/`DB_NAME` via `db_user_env_var_name` /
  `db_name_env_var_name` overrides (not present in `Mixpost_Common` itself).
- There is **no runtime URL-correction step** — `service_url_env_var_name =
  "APP_URL"` is set in the variant `main.tf`, so the Foundation injects the
  predicted/actual service URL straight into Laravel's native `APP_URL`
  variable; the image consumes it as-is at boot without any entrypoint-side
  rewriting.
- The initial administrator account (default `admin@example.com` / `changeme`)
  is seeded by the image itself and is **not** influenced by this module's
  `mixpost_admin_email` variable, which is declared for convention/forwarding
  parity but is not currently wired into any environment variable the image
  reads.

---

## 5. Core application settings

`Mixpost_Common` establishes the baseline Mixpost/Laravel environment so the
application comes up correctly on first boot:

- **Application identity** — `APP_NAME` (from `display_name`, default
  `Mixpost`), `APP_ENV = "production"`, `APP_DEBUG = "false"`.
- **Database connection** — `DB_CONNECTION = "mysql"` unconditionally; the
  Foundation injects the actual `DB_HOST` / `DB_PORT` / `DB_PASSWORD` (and the
  variant wiring maps `DB_USER` → `DB_USERNAME`, `DB_NAME` → `DB_DATABASE`).
- **Proxies** — `TRUSTED_PROXIES = "*"` so Laravel trusts the load
  balancer/Cloud Run front end for `X-Forwarded-*` headers.
- **Outbound mail** — `MAIL_MAILER = "smtp"`, `MAIL_FROM_NAME` (from
  `var.mail_from_name`, default `Mixpost`), `MAIL_FROM_ADDRESS` (from
  `var.mail_from_address`, default `mixpost@example.com`).
- **MySQL plugin hooks** — `enable_mysql_plugins = false`, `mysql_plugins = []`
  (no Cloud SQL plugin flags requested by this module).

Queue, cache, and session drivers (`QUEUE_CONNECTION`, `CACHE_DRIVER`,
`SESSION_DRIVER`) are **not** set by `Mixpost_Common` — each variant's own
`main.tf` locals wire them to `redis` when `enable_redis = true` (the shared
default), falling back to `sync`/`file` when Redis is disabled.

Platform-specific adjustments happen entirely in the variant modules, not
here:

- **Cloud Run** defaults `min_instance_count = 0` and
  `cpu_always_allocated = false` — cold-start, request-based billing. This
  means the in-container Laravel scheduler and queue worker (run by the
  image's supervisord) only execute while an instance happens to be warm or
  serving a request, so **scheduled social-post publishing is not reliable
  out of the box**. There is no Cloud Scheduler resource wired up by
  `Mixpost_Common` or the CloudRun module automatically — the documented fix
  is an operator-configured Cloud Scheduler job hitting a cron endpoint every
  minute (using the generic `cron_jobs` foundation variable, or an external
  scheduler), or overriding `cpu_always_allocated = true` with
  `min_instance_count >= 1` to keep the scheduler running continuously.
- **GKE** defaults `min_instance_count = 1`, so at least one pod is always
  running and the supervisord-managed scheduler/queue worker operate without
  any external cron wiring.

---

## 6. Health probe behaviour

`Mixpost_Common`'s own `startup_probe` / `liveness_probe` variables both
default to **HTTP on `/`** (startup: 90s initial delay, 15s period, 30-retry
threshold; liveness: 120s initial delay, 30s period, 3-retry threshold), but
each platform variant overrides the probe actually applied to the workload:

- **Cloud Run** overrides the startup probe to **TCP** on port 80 in its own
  `main.tf` (Cloud Run health checks arrive over plain HTTP from a
  Google-internal address, and confirming the port is listening is enough);
  the liveness probe stays **HTTP** on `/`, which Mixpost/nginx answers
  directly with `200`.
- **GKE** overrides **both** probes to **TCP** on port 80
  (`startup_probe_config` / `health_check_config`, the variables the
  Foundation actually wires into the Deployment's probes) — Mixpost answers
  `/` with a `302` redirect to the app's external URL, and the kubelet's HTTP
  probe follows that redirect to `https://<pod-ip>:443`, where nothing
  listens, causing a restart loop even though the app is healthy on `:80`.
  The `startup_probe` / `liveness_probe` variables inherited from
  `Mixpost_Common` (still HTTP) are therefore cosmetic on GKE — they populate
  the application config object but are superseded by the TCP
  `startup_probe_config` / `health_check_config` for the real pod probes.

---

## 7. Object storage

A dedicated **Cloud Storage** bucket (`name_suffix = "storage"`,
`force_destroy = true`) is declared here and provisioned by the foundation,
which also grants the workload service account access. List it with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
```

---

For the Mixpost-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guides: **[Mixpost_GKE](Mixpost_GKE.md)** and
**[Mixpost_CloudRun](Mixpost_CloudRun.md)**.
