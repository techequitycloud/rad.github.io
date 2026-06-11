---
title: "Zammad Common \u2014 Shared Application Configuration"
---

# Zammad Common — Shared Application Configuration

`Zammad_Common` is the **shared application layer** for Zammad. It is not deployed on
its own; instead it supplies the Zammad-specific configuration that both
[Zammad_GKE](Zammad_GKE.md) and [Zammad_CloudRun](Zammad_CloudRun.md) build on, so
the two platform variants behave identically where it matters. End users never
configure this layer directly — it has no deployment UI inputs of its own — but
understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Zammad, see the platform
guides ([Zammad_GKE](Zammad_GKE.md), [Zammad_CloudRun](Zammad_CloudRun.md)) and the
foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Zammad_Common | Where it surfaces |
|---|---|---|
| Container image | Pins `zammad/zammad` and the Cloud Build that extends it with the GCP entrypoint | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job that creates the database, user, and grants | `initialization_jobs` output |
| Object storage | Declares the `zammad-attachments` **Cloud Storage** bucket | `storage_buckets` output |
| Core settings | Sets the baseline Zammad environment variables (`RAILS_ENV`, `POSTGRESQL_PORT`, `ZAMMAD_RAILSSERVER_*`, `RAILS_TRUSTED_PROXIES`) | Application behaviour in the platform guides |
| Health checks | Supplies the default startup, liveness, and readiness probe configurations targeting `/api/v1/ping` | §Observability in the platform guides |
| No auto-generated secrets | Returns `secret_ids = {}` — Zammad manages its own internal signing keys at runtime | Platform secrets section |

---

## 2. Container image and custom entrypoint

The official `zammad/zammad` image expects `POSTGRESQL_*` environment variables
directly. The GCP foundation modules inject database credentials as `DB_HOST`,
`DB_USER`, `DB_PASSWORD`, `DB_PORT`, and `DB_NAME`. The custom
`scripts/Dockerfile` extends the official image and replaces the entrypoint with
a GCP-specific `entrypoint.sh` that bridges this gap at container startup.

On every container start, `entrypoint.sh` performs the following steps:

1. **Variable mapping** — translates Foundation `DB_*` variables to Zammad's
   `POSTGRESQL_*` convention. User and password are URL-encoded so that special
   characters do not break the `postgres://` URI.

2. **Cloud Run TCP workaround** — Zammad's `docker-entrypoint.sh` checks PostgreSQL
   readiness using a TCP bash socket. On **Cloud Run**, `DB_HOST` is a Unix socket
   path and is not TCP-addressable; the entrypoint substitutes `DB_IP` (Cloud SQL
   private IP) for `POSTGRESQL_HOST`. On **GKE**, `DB_HOST = 127.0.0.1` (the
   cloud-sql-proxy sidecar) which is TCP-addressable — no substitution is needed.

3. **Redis URL construction** — if `REDIS_URL` is not already set and `REDIS_HOST`
   is present, builds `REDIS_URL` from `REDIS_HOST`, `REDIS_PORT`, and optionally
   `REDIS_AUTH`.

4. **`zammad-init`** — runs Zammad's own DB migration and seed step idempotently
   before the railsserver starts. Pending migrations are applied; already-run ones
   are skipped.

Retrieve the image tag deployed from the `container_image` output:

```bash
gcloud artifacts docker images list <registry-url> --project "$PROJECT"
```

---

## 3. Database engine and bootstrap

Zammad requires **PostgreSQL 13 or later**; this layer fixes `POSTGRES_15` as the
default and the platform modules reject any other engine at plan time. On the first
deployment a one-shot `db-init` job connects to Cloud SQL through the Auth Proxy
and idempotently:

1. creates the Zammad database user with the generated password,
2. creates the application database (if absent),
3. grants the user full privileges on the database and schema.

The `db-init` job uses the `postgres:15-alpine` image and runs the
`scripts/db-init.sh` script. It is safe to re-run. Inspect the database directly:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Core application settings

`Zammad_Common` establishes the baseline environment so the application starts
correctly on first boot:

- **`RAILS_ENV = "production"` / `NODE_ENV = "production"`** — production mode
  enables asset caching and disables verbose debug output.
- **`POSTGRESQL_PORT = "5432"`** — PostgreSQL connection port.
- **`ZAMMAD_RAILSSERVER_HOST = "0.0.0.0"` / `ZAMMAD_RAILSSERVER_PORT = "3000"`** —
  bind the Rails server on all interfaces so Cloud Run and GKE can route traffic
  to it.
- **`RAILS_SERVE_STATIC_FILES = "true"`** — serves static assets directly from
  Rails; required on Cloud Run where nginx is not in the request path.
- **`RAILS_TRUSTED_PROXIES`** — trusts Cloud Run's Google Front End and internal
  CGNAT ranges so client IPs are logged correctly.
- **`ELASTICSEARCH_ENABLED = "false"` (default)** — the official entrypoint waits
  indefinitely for a reachable Elasticsearch host when this is `true`. Set
  `elasticsearch_url` in the platform module to enable Elasticsearch and override
  this default.
- **`ZAMMAD_WEBSOCKET_HOST = "0.0.0.0"` / `ZAMMAD_WEBSOCKET_PORT = "6042"`** — bind
  the ActionCable WebSocket server on all interfaces.

Additional `environment_variables` passed from the platform module are merged on
top of these defaults.

---

## 5. Health probe behaviour

All probes target Zammad's `/api/v1/ping` endpoint, which returns HTTP 200 only
once the application is fully initialised (including schema migration on first boot).

- **Startup probe** — 60-second initial delay, 15-second period, 30 failure
  threshold. Gives Zammad up to ~510 seconds of total startup tolerance for large
  databases with many pending migrations.
- **Liveness probe** — 60-second initial delay, 30-second period, 3 failure
  threshold. Restarts the container after 3 consecutive failures once stable.
- **Readiness probe (GKE)** — 30-second initial delay, 10-second period, 3 failure
  threshold.

Both platform variants use the same HTTP probes. Unlike some applications (e.g.
Mautic), Zammad does not require a TCP probe workaround — the `/api/v1/ping`
endpoint responds over plain HTTP without issuing redirects.

---

## 6. Object storage

A dedicated **Cloud Storage** `zammad-attachments` bucket is declared here and
provisioned by the foundation, which also grants the workload service account
access. This bucket holds Zammad attachment files that are not served via NFS.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~attachments"
gcloud storage ls gs://<attachments-bucket>/
```

The NFS share (`/opt/zammad/storage` by default) and this bucket complement each
other: NFS provides the real-time shared filesystem for active attachment I/O;
the GCS bucket provides durable object storage.

---

## 7. No auto-generated application secrets

Unlike modules such as Directus or Django, Zammad manages its own internal signing
keys at runtime. `Zammad_Common` returns `secret_ids = {}`. The only secrets
provisioned automatically are the database password and the PostgreSQL root password,
both managed by the foundation module and surfaced via the `database_password_secret`
output. Retrieve the database password with:

```bash
gcloud secrets versions access latest --secret=<database-password-secret> --project "$PROJECT"
```

---

For the Zammad-specific, user-facing configuration (variables by group, outputs, and
how to explore each service from the Console and CLI), see the platform guides:
**[Zammad_GKE](Zammad_GKE.md)** and **[Zammad_CloudRun](Zammad_CloudRun.md)**.
