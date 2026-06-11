---
title: "Nextcloud Common \u2014 Shared Application Configuration"
---

# Nextcloud Common — Shared Application Configuration

`Nextcloud_Common` is the **shared application layer** for Nextcloud. It is not
deployed on its own; instead it supplies the Nextcloud-specific configuration that both
[Nextcloud_GKE](Nextcloud_GKE.md) and [Nextcloud_CloudRun](Nextcloud_CloudRun.md) build
on, so the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Nextcloud, see the platform
guides ([Nextcloud_GKE](Nextcloud_GKE.md), [Nextcloud_CloudRun](Nextcloud_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Nextcloud_Common | Where it surfaces |
|---|---|---|
| Admin credential | Generates the Nextcloud admin password and stores it in **Secret Manager** | Retrieve via Secret Manager (see below) |
| Post-install config secrets | Creates placeholder secrets for `instanceid`, `passwordsalt`, and `secret`; the container hook writes real values after `occ maintenance:install` | Injected as `NEXTCLOUD_INSTANCE_ID`, `NEXTCLOUD_PASSWORD_SALT`, `NEXTCLOUD_APP_SECRET` |
| Container image | Pins the official Nextcloud Apache image and builds a custom extension via Cloud Build with PHP limits baked as Docker `ARG` values | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** as the only supported engine (`utf8mb4` character set) | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy `db-init` job that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** `nc-data` bucket | `storage_buckets` output |
| Core settings | Sets the baseline Nextcloud environment — admin identity, PHP limits, trusted proxies, Redis wiring, and SMTP if configured | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe configuration targeting `/status.php` | §Observability in the platform guides |
| Redis auth | When `redis_auth` is non-empty, stores the Redis password as a Secret Manager secret | Injected as `REDIS_HOST_PASSWORD` |

---

## 2. Admin credential and config secrets in Secret Manager

The Nextcloud administrator password is generated automatically (24-character
alphanumeric) and stored as a Secret Manager secret — it is never set in plain text.
Retrieve it after deployment:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
gcloud secrets versions access latest --secret=<admin-password-secret> --project "$PROJECT"
```

Three additional secrets (`instanceid`, `passwordsalt`, `secret`) are created with the
placeholder value `"UNSET"` at deploy time. The container's post-install hook writes
the real values after `occ maintenance:install` completes on first boot. These secrets
allow subsequent pod starts to reconstruct `config.php` from Secret Manager without
depending on NFS being available:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~nextcloud"
# Look for: *-instance-id, *-password-salt, *-app-secret
```

The database password is generated and managed by the foundation; its secret name is
reported in the platform deployment outputs (`database_password_secret`). See
[App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Nextcloud requires **MySQL 8.0**; the engine is fixed and PostgreSQL is not supported.
On the first deployment a one-shot `db-init` job connects to Cloud SQL through the Auth
Proxy and idempotently:

1. creates the Nextcloud database with `utf8mb4` character set and `utf8mb4_unicode_ci`
   collation (if absent),
2. creates the application user with `mysql_native_password` authentication,
3. grants the user full privileges on the database,
4. verifies connectivity,
5. sends the Cloud SQL Auth Proxy quit signal so the Kubernetes Job completes cleanly.

The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Core application settings

`Nextcloud_Common` establishes the baseline Nextcloud environment so the application
comes up correctly on first boot:

- **Admin identity** — the initial admin username (configurable in Group 23 of the
  platform module).
- **PHP limits** — `php_memory_limit`, `upload_max_filesize`, and `post_max_size` are
  passed as Docker `ARG` values to Cloud Build so they are baked into the container
  image, and also injected as runtime environment variables.
- **NEXTCLOUD_UPDATE=1** — `occ upgrade` runs automatically on every container start.
  Set to `0` in `environment_variables` when managing upgrades manually across major
  versions.
- **Trusted proxies** — `TRUSTED_PROXIES=10.0.0.0/8 172.16.0.0/12 192.168.0.0/16`
  is set so Nextcloud honours client IPs and the HTTPS scheme behind GKE's load
  balancer and Cloud Run's proxy layer.
- **OVERWRITEPROTOCOL=https** — Nextcloud generates all share links and WebDAV
  endpoints using HTTPS.
- **Redis wiring** — when `enable_redis = true`, `REDIS_HOST` and `REDIS_HOST_PORT`
  are injected automatically.
- **SMTP wiring** — when `smtp_host` is non-empty, `SMTP_HOST`, `SMTP_SECURE`,
  `SMTP_PORT`, `SMTP_AUTHTYPE`, `SMTP_NAME`, `MAIL_FROM_ADDRESS`, and `MAIL_DOMAIN`
  are injected automatically.
- **Post-install hook env vars** — Secret Manager secret IDs for the three config
  secrets (`NC_INSTANCE_ID_SECRET_ID`, `NC_PASSWORD_SALT_SECRET_ID`,
  `NC_APP_SECRET_SECRET_ID`) and the GCP project ID (`GOOGLE_CLOUD_PROJECT`) are
  injected so the container hook knows where to write after `occ maintenance:install`.

---

## 5. Health probe behaviour

The default probes target `/status.php`, which returns an HTTP 200 with a JSON status
object as soon as Apache starts — regardless of whether Nextcloud's installation wizard
has run. This makes it the canonical Nextcloud health endpoint.

| Probe | Type | Path | Initial delay | Period | Failure threshold |
|---|---|---|---|---|---|
| Startup | HTTP | `/status.php` | 60 s | 15 s | 40 (Cloud Run) / 20 (GKE) |
| Liveness | HTTP | `/status.php` | 120 s | 30 s | 3 |

The generous startup failure thresholds exist because `occ maintenance:install` runs
synchronously on first boot before Apache starts accepting connections, and can take
several minutes on a cold Cloud SQL instance.

---

## 6. Object storage

A dedicated **Cloud Storage** `nc-data` bucket is declared here and provisioned by the
foundation in the deployment region. The workload service account is granted access
automatically. List it with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~nc-data"
```

---

## 7. Scripts

`Nextcloud_Common` ships four scripts in its `scripts/` directory:

| File | Purpose |
|---|---|
| `Dockerfile` | Custom Nextcloud image extending `nextcloud:<version>-apache`. Accepts `APP_VERSION`, `PHP_MEMORY_LIMIT`, `UPLOAD_MAX_FILESIZE`, and `POST_MAX_SIZE` as Docker `ARG` values baked at build time. |
| `entrypoint.sh` | Entrypoint wrapper: symlinks `config/` to NFS, sets `NEXTCLOUD_DATA_DIR`, and resolves `OVERWRITEHOST`/`OVERWRITECLIURL` from the service URL at runtime. |
| `db-init.sh` | Idempotent MySQL setup script — creates the database with `utf8mb4`, creates the user with `mysql_native_password`, grants privileges, and verifies connectivity. |
| `post-install-config-secrets.sh` | Post-installation hook: reads `instanceid`, `passwordsalt`, and `secret` from Nextcloud's `config.php` after `occ maintenance:install` and writes them to Secret Manager. |

---

For the Nextcloud-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[Nextcloud_GKE](Nextcloud_GKE.md)** and **[Nextcloud_CloudRun](Nextcloud_CloudRun.md)**.
