---
title: "SimpleRisk Common — Shared Application Configuration"
description: "Shared configuration reference for the SimpleRisk module — application-layer settings consumed by the Google Cloud Run deployment."
---

# SimpleRisk Common — Shared Application Configuration

`SimpleRisk_Common` is the **shared application layer** for SimpleRisk. It is not
deployed on its own; instead it supplies the SimpleRisk-specific configuration
that [SimpleRisk_CloudRun](SimpleRisk_CloudRun.md) builds on. (There is currently
no GKE variant of SimpleRisk.) End users never configure this layer directly — it
has no deployment UI inputs of its own — but understanding what it provides
explains the defaults you see in the platform guide.

For the infrastructure that actually provisions and runs SimpleRisk, see the
platform guide ([SimpleRisk_CloudRun](SimpleRisk_CloudRun.md)) and the foundation
guides ([App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by SimpleRisk_Common | Where it surfaces |
|---|---|---|
| Application secrets | **None** — SimpleRisk's only credential is the database password, which the foundation generates | `secret_ids` / `secret_values` outputs are empty |
| Container image | Wraps the official `simplerisk/simplerisk` image with a replacement entrypoint and a rewritten Apache vhost; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** (`database_type = "MYSQL_8_0"`) and disables the Auth Proxy socket (`enable_cloudsql_volume = false`) | §Database in the platform guide |
| Database bootstrap | Defines two ordered jobs: `db-init` (database, user, grants) and `schema-load` (loads SimpleRisk's schema) | `initialization_jobs` output |
| Object storage | Declares a `storage` bucket and, by default, GCS-FUSE-mounts it at `/var/www/simplerisk/files` | `storage_buckets` output |
| Core settings | Sets `DB_PORT = "3306"` and `memory_limit` (from `php_memory_limit`); the container port is 80 | Application behaviour in the platform guide |
| Health checks | Passes through HTTP startup/liveness probes on `/` | §Observability in the platform guide |

---

## 2. Why the vendor image is wrapped

`simplerisk/simplerisk` is an all-in-one appliance, not a twelve-factor app. Its
own entrypoint:

- hardcodes `127.0.0.1` / `simplerisk` / `simplerisk` as the database host, user
  and database — literals in the script, not environment reads, so no external
  database can be injected;
- generates a random database password into `/passwords/` on first boot;
- starts a MySQL server **inside the container** and loads `/simplerisk.sql` into it;
- keeps all of that in Docker `VOLUME`s (`/passwords`, `/configurations`,
  `/var/lib/mysql`).

On Cloud Run every one of those paths is ephemeral. The stock image would boot,
create an empty database, serve normally — and lose the whole risk register on
the next cold start, with no error. The wrapper image therefore **replaces** the
vendor entrypoint (it does not delegate to it) and points SimpleRisk at the
foundation's Cloud SQL instance.

The image is built `FROM simplerisk/simplerisk:${SIMPLERISK_VERSION}`. The build
argument is app-specific because SimpleRisk tags are **dated build ids** (for
example `20260909-001`), not semver — the generic `APP_VERSION` the foundation
injects would resolve to a tag that does not exist. This layer's own
`application_version` default is `latest`, but the platform module passes its own
pinned value (`20260909-001`), which is the one that takes effect.

---

## 3. The entrypoint

`scripts/entrypoint.sh` runs on every container start and:

1. **Checks its inputs.** It exits if `DB_IP`, `DB_NAME`, `DB_USER` or
   `DB_PASSWORD` is unset, or if `includes/config.sample.php` is missing from the
   image (a sign the image layout changed).
2. **Renders `config.php`** at `/var/www/simplerisk/includes/config.php` from the
   vendor's `config.sample.php`, replacing its `__DB_HOSTNAME__`, `__DB_PORT__`,
   `__DB_USERNAME__`, `__DB_PASSWORD__` and `__DB_DATABASE__` placeholders with
   `DB_IP`, `DB_PORT` (default `3306`), `DB_USER`, `DB_PASSWORD` and `DB_NAME`.
   The substitution uses PHP `str_replace` rather than `sed`, because a generated
   password containing `/`, `&` or `\` would break a `sed` replacement. The file is
   rendered on **every** boot — the vendor guarded this with a marker file on an
   ephemeral path, which can never be seen on a later cold start.
3. **Stores sessions in the database** by setting `__USE_DATABASE_FOR_SESSIONS__`
   to `true`. File-backed sessions would log users out whenever a request lands on
   a different instance.
4. **Starts Apache** (`/etc/apache2/foreground.sh`, the command the vendor's
   supervisord used for httpd).

`DB_IP` — the raw Cloud SQL private IP — is used rather than `DB_HOST`, because
`config.php` takes a plain host and the socket-directory form of `DB_HOST`
contains colons. This is why the platform module sets
`db_host_env_var_name = "DB_IP"` and leaves `enable_cloudsql_volume = false`.

---

## 4. Container image and Apache

The Dockerfile makes three changes to the vendor image:

- **Port 80 serves the application.** The vendor's port-80 virtual host has no
  `DocumentRoot` and only redirects to HTTPS; the application is served only on
  443. Behind a TLS-terminating platform that is first an infinite redirect loop
  and then Apache's default page. The wrapper rewrites the port-80 vhost to serve
  `/var/www/simplerisk`, carrying over the vendor's `Directory` block and security
  headers. **HSTS is deliberately not carried over** — the container never sees
  the TLS connection. The 443 vhost (with its self-signed placeholder certificate)
  is removed.
- **Apache only.** The vendor `CMD` ran supervisord with `mysqld_safe`, `httpd`,
  `rsyslog` and `cron`. The wrapper runs Apache alone: the database is Cloud SQL,
  logs go to stdout, and `cron` is not started — so SimpleRisk's scheduled tasks
  (reports, notifications) do not run inside the container.
- **The replacement entrypoint** described above.

---

## 5. Database engine and bootstrap

SimpleRisk always uses **MySQL 8.0** on managed Cloud SQL. When
`initialization_jobs` is left empty, two jobs run in order:

| Job | Image | What it does |
|---|---|---|
| `db-init` | `mysql:8.0-debian` (timeout 600s, 3 retries) | Waits for MySQL on 3306, creates (or re-passwords with `ALTER USER`) the application user, creates the database, grants all privileges on it, and verifies the app user can connect. Uses `--get-server-public-key` where the client supports it, for `caching_sha2_password` over plain TCP. |
| `schema-load` | The **app image** (timeout 900s, 2 retries; depends on `db-init`) | Counts the tables in the database. If there are none, loads `/simplerisk.sql` and counts again, failing if the load left no tables. If tables already exist, it does nothing. |

`schema-load` has to run on the app image because `simplerisk.sql` ships inside
`simplerisk/simplerisk` and is not published anywhere else. It runs as a job
rather than in the entrypoint because several Cloud Run instances can cold-start
at once, and two of them loading the same schema concurrently would leave a
half-loaded schema with no error. Both scripts use bare `set -e` (no
`pipefail`), because the job runner invokes them with `sh`.

Supplying any `initialization_jobs` list replaces both jobs.

---

## 6. Health probe behaviour

The probes target `/` over HTTP — the same path the vendor image's own
`HEALTHCHECK` uses. Startup is quick because the entrypoint only renders
`config.php` before starting Apache. The platform module's defaults are a 30s
initial delay, 15s period and 20 failures for startup, and a 60s delay, 30s period
and 3 failures for liveness. The page at `/` renders without the database, so a
passing probe does not prove database connectivity.

---

## 7. Object storage

This layer declares one bucket, `storage` (standard class, public access
prevention enforced, `force_destroy = true`, no versioning). With
`enable_gcs_storage_volume = true` (the default) it is mounted with GCS FUSE at
`/var/www/simplerisk/files`, where SimpleRisk keeps uploaded files. Everything
else SimpleRisk stores is in MySQL.

Data-at-rest encryption, a SimpleRisk Extra, is deliberately out of scope: it
introduces a key file under `/var/www/simplerisk`, which would be ephemeral on
Cloud Run.

---

## 8. Known limits

- **First visitor becomes administrator.** SimpleRisk ships no default
  credentials; it renders a *Default Admin Account Creation* form on first access.
  This layer does not create an administrator — the `admin_username` and
  `admin_email` inputs are not used by its configuration. Create the account
  immediately after deploying, or restrict access first (see the platform guide).
- **Scheduled tasks do not run in the container**, because `cron` is not started.
- **Pin an exact image tag.** A rebuild under an unchanged tag produces no
  Terraform diff and therefore no new revision.

---

For the SimpleRisk-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guide: **[SimpleRisk_CloudRun](SimpleRisk_CloudRun.md)**.

<!-- related-guides -->

## Related guides

- [SimpleRisk on Google Cloud Run](SimpleRisk_CloudRun.md) — this configuration deployed on Cloud Run.
