---
title: "Moodle Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Moodle module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Moodle Common — Shared Application Configuration

`Moodle_Common` is the **shared application layer** for Moodle. It is not deployed on
its own; instead it supplies the Moodle-specific configuration that both
[Moodle_GKE](Moodle_GKE.md) and [Moodle_CloudRun](Moodle_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Moodle, see the platform
guides ([Moodle_GKE](Moodle_GKE.md), [Moodle_CloudRun](Moodle_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Moodle_Common | Where it surfaces |
|---|---|---|
| Cron credential | Generates the Moodle cron password (32 chars) and stores it in **Secret Manager** | Embedded in the auto-provisioned Cloud Scheduler job URL |
| SMTP credential | Generates an initial SMTP password (24 chars) and stores it in **Secret Manager** | Retrieved and replaced via Secret Manager after deployment |
| Container image | Builds a fully custom PHP 8.3/Apache image from Ubuntu 24.04 | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| PostgreSQL extension | Enables `pg_trgm` for Moodle's full-text search | Applied by the `db-init` job on first deploy |
| Database bootstrap | Defines the `db-init` job that creates the database, user, and extension | `initialization_jobs` in the platform guides |
| NFS initialisation | Defines the `nfs-init` job that creates `moodledata` subdirectories with correct ownership | `nfs_setup_job` output of the platform guides |
| Core settings | Sets port 8080, custom image build, and baseline Moodle environment | Application behaviour in the platform guides |
| Health checks | Supplies `/health.php` as the default probe endpoint for both startup and liveness | §Observability in the platform guides |

---

## 2. Credentials in Secret Manager

Two credentials are generated automatically and stored as Secret Manager secrets —
they are never set in plain text. Retrieve them after deployment:

```bash
# List all secrets for the deployment:
gcloud secrets list --project "$PROJECT" --filter="name~moodle"
# Read a specific secret:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

| Secret | Purpose | Action required |
|---|---|---|
| `<prefix>-cron-password` | Authenticates the auto-provisioned Cloud Scheduler cron job targeting `/admin/cron.php` | None — embedded in the scheduler job URL automatically |
| `<prefix>-smtp-password` | Initial SMTP credential injected as `MOODLE_SMTP_PASSWORD` | Replace the generated value with your real SMTP credential after deployment |

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs (`database_password_secret`).
See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Moodle requires **PostgreSQL 15**; the engine is fixed and MySQL is not supported.
On the first deployment a one-shot `db-init` job connects to Cloud SQL through the
Auth Proxy and idempotently:

1. creates the Moodle application user with `CREATEDB` privileges,
2. creates the Moodle database with UTF-8 encoding and `en_US.UTF-8` locale,
3. grants the user full privileges on the database and public schema,
4. enables the `pg_trgm` extension as superuser (required for Moodle full-text search).

The job is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Core application settings

`Moodle_Common` establishes the baseline Moodle environment so the application comes
up correctly on first boot:

- **Container port 8080** — Apache is configured to listen on `$PORT` (defaulting to
  8080), which matches the platform health probe and ingress configuration.
- **Custom build from Ubuntu 24.04** — PHP 8.3 with all required Moodle extensions
  (`gd`, `pgsql`, `curl`, `intl`, `mbstring`, `zip`, `soap`, `ldap`, `redis`) is
  compiled from scratch. There is no upstream Moodle Docker image; the build is
  managed by Cloud Build using the `Dockerfile` in `Moodle_Common/scripts/`.
- **SMTP settings** — default SMTP environment variables (`MOODLE_SMTP_HOST`,
  `MOODLE_SMTP_PORT`, `MOODLE_SMTP_USER`, etc.) are injected automatically. Override
  them via `environment_variables` in the platform module and replace the generated
  `MOODLE_SMTP_PASSWORD` secret with a real credential.
- **Redis session support** — when `MOODLE_REDIS_ENABLED = "true"`, `config.php`
  configures Moodle to use Redis for session storage (`\core\session\redis`).
- **`wwwroot` derivation** — `config.php` resolves `wwwroot` from `APP_URL`, falling
  back to `CLOUDRUN_SERVICE_URL` (Cloud Run) or `GKE_SERVICE_URL` (GKE). On Cloud
  Run, `APP_URL` is set from the predicted service URL before deployment.

---

## 5. Health probe behaviour

The default probes target `/health.php`, a minimal endpoint baked into the container
image that returns HTTP 200 and body `"OK"` as soon as PHP is operational. This is
more accurate for Moodle readiness than probing a full page, because:

- `/health.php` returns 200 immediately after PHP starts, regardless of whether
  Moodle's full bootstrap has completed — giving fast liveness signals.
- The startup probe uses a 10-minute window (`failure_threshold = 20`,
  `period_seconds = 30`) to allow time for first-boot schema creation and plugin
  registration on a clean database.

Both **GKE and Cloud Run use HTTP probes** against `/health.php`. Unlike some PHP
deployments where Apache issues an HTTP→HTTPS redirect that breaks HTTP-type Cloud
Run probes, Moodle's Apache configuration listens on port 8080 without redirect, so
HTTP probes work reliably on both platforms.

---

## 6. NFS initialisation and object storage

**NFS is mandatory** — the Moodle `moodledata` directory must be a shared writable
filesystem accessible across all instances or pods. Before the application starts,
the `nfs-init` job creates four required subdirectories on the NFS share:

| Directory | Purpose |
|---|---|
| `filedir` | Uploaded files and course content |
| `temp` | Temporary files during processing |
| `cache` | Application cache data |
| `localcache` | Per-instance local cache |

All directories are owned by UID/GID 33 (`www-data`) with permissions `2770` (setgid
so new files inherit the group). Without this setup, Moodle fails to write on first
boot.

An additional Cloud Storage data bucket is always provisioned via the platform
module. The bucket is available for backups, GCS Fuse plugin/theme mounts, or other
storage needs. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

For the Moodle-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Moodle_GKE](Moodle_GKE.md)** and **[Moodle_CloudRun](Moodle_CloudRun.md)**.
