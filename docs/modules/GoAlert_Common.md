---
title: "GoAlert Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the GoAlert module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# GoAlert Common — Shared Application Configuration

`GoAlert_Common` is the **shared application layer** for GoAlert. It is not
deployed on its own; instead it supplies the GoAlert-specific configuration that
both [GoAlert_GKE](GoAlert_GKE.md) and [GoAlert_CloudRun](GoAlert_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of its
own — but understanding what it provides explains the defaults you see in the
platform docs.

For the infrastructure that actually provisions and runs GoAlert, see the platform
guides ([GoAlert_GKE](GoAlert_GKE.md), [GoAlert_CloudRun](GoAlert_CloudRun.md)) and
the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md)).

---

## 1. What this layer provides

| Area | Provided by GoAlert_Common | Where it surfaces |
|---|---|---|
| Container image | Wraps the official `goalert/goalert` image with a custom `entrypoint.sh`; builds via Cloud Build | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL** (`POSTGRES_17`) as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines a 3-stage initialization job chain — `db-init` → `db-migrate` → `admin-bootstrap` | `initialization_jobs` output |
| Postgres extension | Installs `pgcrypto` unconditionally (`enable_postgres_extensions = true`, `postgres_extensions = ["pgcrypto"]`), required by GoAlert's schema | `config` object |
| Secrets | Generates and stores the initial admin password and a data-encryption key in **Secret Manager** | `secret_ids`, `secret_values`, `admin_password_secret_id` outputs |
| Object storage | None — GoAlert has no file-upload feature | `storage_buckets` output is always `[]` |
| Health checks | Supplies the default startup/liveness probe targeting `/health` | §Observability in the platform guides |

---

## 2. Container image and entrypoint

GoAlert's own image (`goalert/goalert`) ships as a single static binary with no
built-in support for assembling a Postgres connection string from discrete
host/user/password parts at runtime, so `GoAlert_Common`'s `Dockerfile` wraps it
with a thin shell entrypoint:

```dockerfile
ARG GOALERT_VERSION=v0.34.1
FROM goalert/goalert:${GOALERT_VERSION}

USER root
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER 1000

ENTRYPOINT ["/entrypoint.sh"]
```

`entrypoint.sh` runs before the real `goalert` process starts:

1. **Detects the Cloud SQL connection mode.** If `/cloudsql` contains a Unix
   socket (Cloud Run with `enable_cloudsql_volume = true`), it symlinks the socket
   to `/tmp/.s.PGSQL.5432` and sets `DB_HOST=/tmp`, `DB_IP=""`. On GKE, the
   cloud-sql-proxy sidecar listens on loopback TCP instead, so this branch is
   skipped.
2. **URL-encodes `DB_PASSWORD`.** Since the runtime password sourced from Secret
   Manager can contain characters (`@`, `:`, `/`, `?`, `#`, `'`, space) that break a
   URL if left raw, a portable `sed` bracket expression handles the encoding —
   deliberately `s/[?]/%3F/g`, not the GNU-only `s/\?/%3F/g`, because this image's
   `/bin/sh` is BusyBox (Alpine-based `goalert/goalert`), which rejects the GNU
   extension.
3. **Assembles `GOALERT_DB_URL`.** GoAlert accepts exactly one Postgres connection
   string. The DSN form is chosen by the resolved host: a socket/loopback host uses
   `postgres://user:pass@/db?host=<path>&sslmode=disable`; a real TCP IP uses
   `postgres://user:pass@host:5432/db?sslmode=require`.
4. **Execs the real binary** at `/usr/bin/goalert` — **not** `/bin/goalert**, a
   natural but wrong guess; the official image only has the binary at the former
   path.

`db-migrate.sh` and `admin-bootstrap.sh` (the two Postgres-talking init-job
scripts) duplicate this same socket-detection / URL-encoding / DSN-assembly logic,
since Cloud Run Jobs and Kubernetes Jobs run as separate one-shot containers from
the main server, each needing to build its own `GOALERT_DB_URL`.

---

## 3. Database engine and the 3-stage bootstrap chain

GoAlert requires **PostgreSQL**; the engine is fixed to `POSTGRES_17` and MySQL or
other engines are not supported. Because a fresh Cloud SQL instance needs a role,
a database, a schema, and a first admin login before GoAlert is genuinely usable,
`GoAlert_Common` defines **three ordered one-shot jobs**, each depending on the
previous one via `depends_on_jobs`, all with `execute_on_apply = true`:

1. **`db-init`** (`postgres:15-alpine`, `depends_on_jobs = []`)
   - Detects the Cloud SQL Auth Proxy socket (mirrors `entrypoint.sh`'s logic).
   - Waits for PostgreSQL to become reachable (`pg_isready` poll loop).
   - Creates (or updates) the application role with the generated password.
   - Grants that role to `postgres` so ownership can be assigned.
   - Creates (or reassigns ownership of) the application database.
   - Grants full privileges on the database and the `public` schema.
   - Signals the Cloud SQL Auth Proxy's `/quitquitquit` endpoint so the Job
     completes cleanly.

2. **`db-migrate`** (`goalert/goalert:<version>`, `depends_on_jobs = ["db-init"]`)
   - Runs `goalert migrate --db-url="$GOALERT_DB_URL"`, applying GoAlert's own
     schema migrations.
   - **Must complete before `admin-bootstrap`** — `goalert add-user` (the next
     job) has zero migration logic of its own. On a schema-less fresh database it
     fails immediately with `relation "auth_basic_users" does not exist`.
   - Retries up to 10 times internally (5s apart) to absorb Cloud SQL readiness
     latency, on top of the Cloud Run Job / Kubernetes Job's own `max_retries = 3`.

3. **`admin-bootstrap`** (`goalert/goalert:<version>`, `depends_on_jobs =
   ["db-migrate"]`)
   - Runs `goalert add-user --admin --user="$GOALERT_ADMIN_USER"
     --email="$GOALERT_ADMIN_EMAIL" --pass="$GOALERT_ADMIN_PASSWORD"` directly
     against Postgres.
   - Safe to run at apply time (`execute_on_apply = true`) — unlike an HTTP-based
     bootstrap that would need the main server already listening, this talks
     straight to the database.
   - Tolerates re-runs: if the admin user already exists, the script detects
     "already exists"/"duplicate" in the error output and exits 0 instead of
     failing.
   - Also retries up to 10 times internally.

Every job's `command`/`args` are left empty; the Foundation auto-generates
`["/bin/sh", "-c", file(script_path)]` when `script_path` is set, inlining the
script content directly into the Job spec — the pattern this catalog uses to avoid
mounting `scripts/` as a volume into a container that has no such mount.

Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Postgres extension: `pgcrypto`

GoAlert's schema requires the `pgcrypto` extension, but its own tenant-scoped
database role lacks `CREATE EXTENSION` privilege on Cloud SQL. `GoAlert_Common`
sets `enable_postgres_extensions = true` and `postgres_extensions = ["pgcrypto"]`
unconditionally in the `config` object it returns — this is **not** driven by any
input variable exposed to the operator; it always happens. The Foundation's
privileged `postgres-extensions` init job installs it before the application
database is otherwise usable.

---

## 5. Secrets in Secret Manager

Two secrets are generated automatically and stored in Secret Manager:

- **Admin password** (`secret-<prefix>-<app>-admin-password`) — a 20-character
  random password (`special = false`) consumed by the `admin-bootstrap` init job
  as `GOALERT_ADMIN_PASSWORD`. Retrieve it after deployment:
  ```bash
  gcloud secrets versions access latest --secret=<admin_password_secret_id output>
  ```
- **Data-encryption key** (`secret-<prefix>-<app>-data-encryption-key`) — a
  32-byte random hex string. Recommended by upstream GoAlert documentation for
  encrypting stored API keys/sensitive config at rest — **not** code-enforced at
  boot by this module, but exposed via `secret_ids.GOALERT_DATA_ENCRYPTION_KEY` so
  it's injected as a container secret env var. All instances sharing a database
  must use the same key.

The database password itself is generated and managed separately by the
foundation; its Secret Manager secret name is reported in the platform deployment
outputs (`database_password_secret`).

---

## 6. Health probe behaviour

The default probes target `/health` — GoAlert's documented public, unauthenticated
endpoint (200 once the app lifecycle leaves the "Starting" state). Both the
Cloud Run and GKE variants default to a **TCP** port check rather than an HTTP path
check as a conservative, catalog-consistent default; live verification confirmed
`/health` itself also returns a real HTTP 200 with genuine "listening and serving
HTTP" server log lines, so an HTTP-path probe would also have worked. A 30-second
initial delay and a high failure-threshold (30 retries) accommodate the
`db-migrate` init job's first-boot schema-migration time.

---

## 7. Outputs

| Output | Type | Description |
|---|---|---|
| `config` | `object` | Full application configuration object (image, env vars, DB settings, probes, the 3-job init chain). |
| `secret_ids` | `map(string)` | `{ GOALERT_DATA_ENCRYPTION_KEY = <secret-id> }`. `DB_PASSWORD` is managed by the Foundation itself. |
| `secret_values` | `sensitive object` | `{ ADMIN_PASSWORD = <generated-password> }`, forwarded as `explicit_secret_values` so the first apply can materialise secrets before Secret Manager values otherwise exist for the wiring to read (needed on GKE's SecretSync path). |
| `storage_buckets` | `list(object)` | Always `[]`. |
| `admin_password_secret_id` | `string` | Secret Manager secret ID holding the bootstrapped admin password. |
| `path` | `string` | Absolute filesystem path to the `GoAlert_Common` module directory (used to resolve `scripts_dir`). |
| `resource_prefix` | `string` | Computed tenant resource naming prefix. |
| `service_name` | `string` | Computed application-scoped service name. |

---

## 8. Container port and network settings

GoAlert listens on **`0.0.0.0:8081`** (`GOALERT_LISTEN`), fixed in the environment
variables local — both platform variants also default `container_port = 8081`.

---

For the GoAlert-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform
guides: **[GoAlert_GKE](GoAlert_GKE.md)** and
**[GoAlert_CloudRun](GoAlert_CloudRun.md)**.
