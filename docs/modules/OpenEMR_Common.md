---
title: "OpenEMR Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the OpenEMR module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# OpenEMR Common — Shared Application Configuration

`OpenEMR_Common` is the **shared application layer** for OpenEMR. It is not deployed
on its own; instead it supplies the OpenEMR-specific configuration that both
[OpenEMR_GKE](OpenEMR_GKE.md) and [OpenEMR_CloudRun](OpenEMR_CloudRun.md) build on,
so the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs OpenEMR, see the platform
guides ([OpenEMR_GKE](OpenEMR_GKE.md), [OpenEMR_CloudRun](OpenEMR_CloudRun.md)) and
the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by OpenEMR_Common | Where it surfaces |
|---|---|---|
| Admin credential | Generates the OpenEMR admin password (`OE_PASS`) and stores it in **Secret Manager** | Retrieve via Secret Manager (see below) |
| Container image | Builds a custom Alpine 3.20 image with Apache, PHP 8.3 FPM, and the OpenEMR source | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the `db-init` job that creates the MySQL database, user, and grants privileges | `initialization_jobs` output |
| NFS initialisation | Defines the `nfs-init` job that prepares the `sites/` directory structure and optionally restores a backup | `initialization_jobs` output |
| GKE schema install | Defines the `openemr-install` job (GKE only) that runs `auto_configure.php` in authority mode to install the database schema and write `$config=1` to NFS | `initialization_jobs` output |
| Object storage | Declares no GCS buckets by default — NFS covers patient document storage | `storage_buckets` output is always `[]` |
| Core settings | Sets the baseline OpenEMR environment (MySQL port, admin user, Redis session store, disable swarm mode, skip root DB access) | Application behaviour in the platform guides |
| Health checks | Supplies the default startup (TCP) and liveness (HTTP login page) probe configuration | §Observability in the platform guides |

---

## 2. Admin credential in Secret Manager

The OpenEMR administrator password is generated automatically as a 20-character
alphanumeric string and stored as a Secret Manager secret — it is never set in plain
text. Retrieve it after deployment:

```bash
# The secret ID is reported in the admin_password_secret_id deployment output.
# List secrets filtered by the resource prefix and retrieve the value:
gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
gcloud secrets versions access latest \
  --secret=<admin-password-secret-id> --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its
secret name is reported in the `database_password_secret` deployment output (injected
as `MYSQL_PASS`). See [App_Common](App_Common.md) for the shared secret and Workload
Identity model.

---

## 3. Database engine and bootstrap

OpenEMR requires **MySQL 8.0**; the engine is fixed and PostgreSQL is not supported.
On first deployment two one-shot jobs run:

1. **`nfs-init`** — mounts the NFS share and creates the `sites/` directory
   structure. If `BACKUP_FILEID` is set (by providing `backup_uri` in the platform
   module), it downloads and extracts the backup from GCS or Google Drive, then patches
   `sqlconf.php` with current database credentials.

2. **`db-init`** — connects to Cloud SQL through the Auth Proxy and idempotently
   creates the OpenEMR database and user, then grants the user full privileges.

On **GKE**, a third job — **`openemr-install`** — runs after the first two. It
launches the OpenEMR container in `K8S=admin` mode, which executes
`auto_configure.php` to install the database schema and create the admin account,
then writes `$config=1` to `sqlconf.php` on NFS and exits. The main service pod waits
for `$config=1` before starting Apache, so it skips the installer on every subsequent
start.

On **Cloud Run**, the container itself runs `auto_configure.php` on first boot with a
temporary PHP web server serving health probe responses during the installation phase.

All jobs are idempotent and safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

---

## 4. Core application settings

`OpenEMR_Common` establishes the baseline OpenEMR environment so the application comes
up correctly on first boot:

- **MySQL port** — `MYSQL_PORT=3306` is always set.
- **Admin user** — `OE_USER=admin` sets the default administrator account name used by
  `auto_configure.php`. The password is taken from the `OE_PASS` Secret Manager secret.
- **Automatic setup** — `MANUAL_SETUP=no` enables the `auto_configure.php`-driven
  installation path. Do not override this.
- **Single-instance mode** — `SWARM_MODE=no` disables the multi-instance file-lock
  coordination mechanism. In Kubernetes, the `K8S=yes` environment variable provides
  the correct startup path instead.
- **Redis session store** — `ENABLE_REDIS`, `REDIS_SERVER`, and `REDIS_PORT` are set
  from the `enable_redis`, `redis_host`, and `redis_port` platform variables. When
  `redis_host` is empty, `REDIS_SERVER=$(NFS_SERVER_IP)` is used as a placeholder
  that `openemr.sh` expands to the actual NFS server IP at container startup.
- **Skip root DB access** — `MYSQL_ROOT_PASS=BLANK` tells OpenEMR not to attempt root
  database authentication. Cloud SQL Auth Proxy handles all MySQL access.

Platform-specific adjustments:

- **GKE** additionally injects `K8S=yes` in the main pod, which instructs `openemr.sh`
  to use the Kubernetes-aware startup path (skipping slow recursive `chown` operations
  that would cause startup timeouts).
- **Cloud Run** runs the schema installer (`auto_configure.php`) inside the service
  container itself rather than in a separate job, because Cloud Run does not support
  the Kubernetes Job ordering model. A temporary PHP built-in web server serves HTTP
  200 responses on the probe path during the installation phase.

---

## 5. Health probe behaviour

The default probes are tuned for OpenEMR's multi-minute first-boot installation:

- **Startup probe — TCP.** A TCP port-open check on port 80 with a 12-failure
  threshold at 10-second intervals allows up to 120 seconds for the container to start.
  TCP is used because the application may be in the installation phase when Apache has
  not yet accepted HTTP connections.

  On first deploy with a large database, consider raising `failure_threshold` to 30
  or higher to allow for the full schema installation.

- **Liveness probe — HTTP `GET /interface/login/login.php`.** The OpenEMR login page
  returns HTTP 200 only when Apache, PHP-FPM, and the MySQL database connection are
  all fully operational. A 10-failure threshold at 30-second intervals allows up to
  5 minutes of recovery time before the container is restarted.

Both probe behaviours are consistent across GKE and Cloud Run since OpenEMR/Apache
does not issue HTTP→HTTPS redirects that would break HTTP probes (unlike PHP
applications behind TLS-terminating load balancers).

---

## 6. Container image

`OpenEMR_Common` builds a custom image from its `Dockerfile` rather than using a
pre-built image. The image is based on **Alpine 3.20** and includes:

- Apache 2 with PHP 8.3 FPM and all OpenEMR-required extensions (`pdo_mysql`,
  `mysqli`, `redis`, `gd`, `soap`, `ldap`, `opcache`, `apcu`, and others)
- The OpenEMR source code cloned from the `rel-704` branch, with Composer dependencies
  installed and the frontend assets built with npm
- The `openemr.sh` startup orchestration script, which handles variable mapping,
  version-aware upgrades, the temporary health probe server, schema installation, and
  Apache/PHP-FPM startup
- Upgrade scripts (`fsupgrade-1.sh` through `fsupgrade-7.sh`) covering upgrade paths
  from OpenEMR 5.0.1 through the current version
- Recovery utilities: `/root/unlock_admin.sh` (reactivates a locked admin account)
  and `/root/devtoolsLibrary.source` (backup, restore, and multi-site utilities)

The image is built by Cloud Build and pushed to Artifact Registry as part of each
deployment. Explore the built image:

```bash
gcloud artifacts docker images list \
  <region>-docker.pkg.dev/<project>/<repository> \
  --project "$PROJECT"
```

---

## 7. NFS `sites/` directory and patient documents

The NFS share mounted at `/var/www/localhost/htdocs/openemr/sites` is the most
critical persistent storage component. It contains:

- `sites/default/sqlconf.php` — signals installation completion (`$config=1`). The
  main pod checks this file at startup and waits until it appears before starting
  Apache.
- `sites/default/documents/` — patient-uploaded files and attachments
- `sites/default/edi/`, `sites/default/era/` — electronic billing data
- `sites/default/onsite_portal_documents/` — patient portal documents
- Twig and Smarty template caches

Because this directory is shared across all replicas via NFS, patient documents
uploaded to one pod are immediately visible to all others. List the NFS instances:

```bash
gcloud filestore instances list --project "$PROJECT"
```

---

For the OpenEMR-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[OpenEMR_GKE](OpenEMR_GKE.md)** and **[OpenEMR_CloudRun](OpenEMR_CloudRun.md)**.
