---
title: "Roundcube Common — Shared Application Configuration"
description: "Shared configuration reference for the Roundcube module — application-layer settings consumed by the Google Cloud Run deployment."
---

# Roundcube Common — Shared Application Configuration

`Roundcube_Common` is the **shared application layer** for Roundcube. It is not
deployed on its own; instead it supplies the Roundcube-specific configuration that
[Roundcube_CloudRun](Roundcube_CloudRun.md) builds on. End users never configure
this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

Roundcube is a browser-based IMAP webmail **client**, not a mail server. This
layer deploys no IMAP or SMTP service; it points Roundcube at one that already
exists.

For the infrastructure that actually provisions and runs Roundcube, see the
platform guide ([Roundcube_CloudRun](Roundcube_CloudRun.md)) and the foundation
guides ([App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Roundcube_Common | Where it surfaces |
|---|---|---|
| Session key | Generates Roundcube's `des_key` (24-character random string) and stores it in **Secret Manager** | Injected as `ROUNDCUBEMAIL_DES_KEY`; retrieve via Secret Manager (see below) |
| Container image | Thin custom build of the official `roundcube/roundcubemail` `-apache` image with a wrapper entrypoint; built via Cloud Build | `container_image` output of the platform deployment |
| Database engine | **Cloud SQL for MySQL 8.0** (`MYSQL_8_0`) | §Database in the platform guide |
| Database bootstrap | One `db-init` job (creates the database, user and grants); the image creates the schema itself | `initialization_jobs` output |
| Mail-server settings | Sets `ROUNDCUBEMAIL_DEFAULT_HOST`/`_DEFAULT_PORT`, `ROUNDCUBEMAIL_SMTP_SERVER`/`_SMTP_PORT` and `ROUNDCUBEMAIL_SKIN` | Application behaviour in the platform guide |
| Health checks | HTTP `GET /` startup and liveness probe defaults | §Observability in the platform guide |

---

## 2. The `des_key` in Secret Manager

Exactly one application secret is generated automatically and stored in Secret
Manager — it is never set in plain text:

- **`ROUNDCUBEMAIL_DES_KEY`** — a 24-character random string (no special
  characters, matching the length the vendor image generates), stored as
  `secret-<prefix>-roundcube-des-key`. Roundcube uses it to encrypt session data
  and the IMAP password it holds on each signed-in user's behalf.

**Why it must be a managed secret.** When `config/config.inc.php` is absent, the
vendor entrypoint generates a key per container:

```sh
GENERATED_DES_KEY=`head /dev/urandom | base64 | head -c 24`
```

The image declares no volumes, so that file never persists on Cloud Run, and
every instance would mint a **different** key. The failure is silent: nothing is
logged, users are simply logged out at random as requests land on other
instances, and again after every cold start. The image reads
`ROUNDCUBEMAIL_DES_KEY` via `getenv()` at runtime, so a stable, Secret
Manager-backed env var fixes it. The wrapper entrypoint prints a warning if the
variable is ever missing.

The database password is generated and managed separately by the foundation; its
secret name is reported in the platform deployment outputs
(`database_password_secret`).

Retrieve the secret after deployment:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~des-key"
gcloud secrets versions access latest --secret=<des-key-secret-name> --project "$PROJECT"
```

See [App_Common](App_Common.md) for the shared secret model.

---

## 3. Database engine and bootstrap

Roundcube runs on **Cloud SQL for MySQL 8.0** (`MYSQL_8_0`). The database holds
Roundcube's own data — preferences, contacts and session data — never mail.

There is **one** initialization job, not two:

1. **`db-init`** (`mysql:8.0-debian`, `execute_on_apply = true`, `max_retries = 3`,
   `timeout_seconds = 600`) — locates the Cloud SQL connection (a Unix socket
   under `/cloudsql` when the Auth Proxy volume is mounted, otherwise TCP via the
   instance private IP `DB_IP`), waits for MySQL to be reachable, creates/aligns
   the application user and database, grants privileges, and verifies the
   application user can connect (which also warms the `caching_sha2_password`
   server-side cache). It still runs because Cloud SQL MySQL 8's
   `caching_sha2_password` default needs the role and database created with
   `--get-server-public-key` handling. It then signals a Cloud SQL Auth Proxy
   sidecar, if any, to shut down.

The **schema** is not a job: the vendor entrypoint runs `bin/installto.sh -y` on
every container start, which creates the schema on first boot and upgrades it
after a version change, idempotently.

Supplying any `initialization_jobs` list replaces the default `db-init` job
entirely. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and entrypoint

The custom image is a thin build `FROM roundcube/roundcubemail:<ROUNDCUBE_VERSION>`
— the `-apache` variant, because the `-fpm` variant has no web server of its own.

`scripts/Dockerfile`:

```dockerfile
ARG ROUNDCUBE_VERSION=1.6.19-apache
FROM roundcube/roundcubemail:${ROUNDCUBE_VERSION}

COPY entrypoint.sh /cloud-entrypoint.sh
RUN chmod +x /cloud-entrypoint.sh

ENTRYPOINT ["/cloud-entrypoint.sh"]
CMD ["apache2-foreground"]
```

`scripts/entrypoint.sh` runs first on every container start:

- **Composes a URL-encoded DSN.** The vendor entrypoint builds
  `${TYPE}://${USER}:${PASSWORD}@${HOST}:${PORT}/${NAME}` with **no URL
  encoding**, and Cloud SQL generated passwords routinely contain
  `@ : / ? # % & +` — every one a URL delimiter. The wrapper encodes the password
  with PHP's `rawurlencode` (the image has no Python) and exports
  `ROUNDCUBEMAIL_DSNW=mysql://DB_USER:<encoded>@DB_IP:DB_PORT/DB_NAME`. The vendor
  uses `:=`, so a DSN that is already set wins. This cannot be done in Terraform:
  the password is a runtime secret, and Cloud Run does not interpolate `$(VAR)`
  references.
- **Uses `DB_IP`, not `DB_HOST`.** `DB_IP` is a plain host (the Cloud SQL private
  IP on Cloud Run); `DB_HOST`'s socket-directory form
  (`/cloudsql/project:region:instance`) contains colons and would break the URL.
  This is why the layer sets `enable_cloudsql_volume = false`.
- **Sets `ROUNDCUBEMAIL_DSNR` to the same DSN** (there is no read replica) and
  also exports `ROUNDCUBEMAIL_DB_TYPE`/`_HOST`/`_PORT`/`_NAME`/`_USER`/`_PASSWORD`,
  so the two vendor code paths stay consistent.
- **Applies the PHP memory limit.** PHP reads no environment variable for
  `memory_limit`, and the image ships `conf.d/roundcube-defaults.ini` with
  `memory_limit=64M`. The entrypoint writes `PHP_MEMORY_LIMIT` into
  `/usr/local/etc/php/conf.d/zz-rad-overrides.ini` (`zz-` so it loads after the
  image's own file) and logs `[startup] PHP memory_limit set to …`.
- **Hands off unchanged** — `exec /docker-entrypoint.sh "$@"`.

The base tag comes from an **app-specific** build ARG `ROUNDCUBE_VERSION` (not the
generic `APP_VERSION` the Foundation injects), because Roundcube tags carry a
variant suffix (`1.6.19-apache`) that a bare version would not resolve. Pin an
exact tag: a rebuild under an unchanged tag string produces no Terraform diff and
therefore no new revision, so a rolling tag silently keeps the old image.

---

## 5. Core application settings

This layer sets the baseline environment; any key the calling variant passes in
`environment_variables` is merged over it and wins:

| Variable | Source | Default |
|---|---|---|
| `ROUNDCUBEMAIL_DEFAULT_HOST` | `imap_host` | `""` |
| `ROUNDCUBEMAIL_DEFAULT_PORT` | `imap_port` | `993` |
| `ROUNDCUBEMAIL_SMTP_SERVER` | `smtp_host` | `""` |
| `ROUNDCUBEMAIL_SMTP_PORT` | `smtp_port` | `587` |
| `ROUNDCUBEMAIL_SKIN` | `skin` | `elastic` |
| `ROUNDCUBEMAIL_TEMP_DIR` | fixed | `/tmp/roundcube-temp` — container-local scratch for attachments in flight, never mail at rest |
| `PHP_MEMORY_LIMIT` | `php_memory_limit` | `512M` |

- **IMAP host scheme.** `ssl://host` for implicit TLS (port 993), `tls://host` for
  STARTTLS (port 143). A bare host name is cleartext and should only be used for
  a server inside the VPC.
- **SMTP port.** Google Cloud blocks outbound port 25 for all egress, so the SMTP
  server must be a submission port (587 or 465) on a relay that accepts
  authenticated mail.
- **`Roundcube_CloudRun` does not forward `imap_host`, `imap_port`, `smtp_host`,
  `smtp_port` or `skin`**, so on that variant they keep the defaults above and
  the mail server is configured through `environment_variables` instead.
- **No accounts.** Roundcube has no local accounts: users authenticate against the
  IMAP server. `admin_username` and `admin_email` are recorded for display only;
  nothing is created from them.
- **`enable_gcs_storage_volume`** is declared but not referenced by this layer —
  it has no effect.

Container defaults set here: `container_port = 80`, `database_type = MYSQL_8_0`,
`enable_cloudsql_volume = false`, `cloudsql_volume_mount_path = /cloudsql`, plus
the resource limits and instance counts forwarded from the variant.

---

## 6. Health probe behaviour

Both probes target the document root, where Roundcube serves its login form:

- **Startup probe** — HTTP `GET /`, 30 s initial delay, 10 s timeout, 15 s period,
  20 failures allowed. The vendor entrypoint runs `bin/installto.sh` and waits for
  the database before Apache starts, so the threshold is generous.
- **Liveness probe** — HTTP `GET /`, 60 s initial delay, 10 s timeout, 30 s
  period, 3 failures.

`Roundcube_CloudRun` passes its own `startup_probe`/`liveness_probe` values, which
carry the same settings.

---

## 7. Object storage

This layer does **not** declare its own storage bucket (`storage_buckets` output
is `[]`) and does not populate `gcs_volumes` by default. Roundcube keeps no data
on disk that must survive a restart — mail lives on the IMAP server and
Roundcube's own data lives in MySQL. The generic `data` GCS bucket seen in the
platform guide comes from the Foundation-level `storage_buckets` default, not
from this layer, and is not mounted into the container.

---

For the Roundcube-specific, user-facing configuration (variables by group,
outputs, and how to explore each service from the Console and CLI), see the
platform guide: **[Roundcube_CloudRun](Roundcube_CloudRun.md)**.

<!-- related-guides -->

## Related guides

- [Roundcube on Google Cloud Run](Roundcube_CloudRun.md) — this configuration deployed on Cloud Run.
