---
title: "Metabase Common \u2014 Shared Application Configuration"
---

# Metabase Common — Shared Application Configuration

`Metabase_Common` is the **shared application layer** for Metabase. It is not
deployed on its own; instead it supplies the Metabase-specific configuration that
both [Metabase_GKE](Metabase_GKE.md) and [Metabase_CloudRun](Metabase_CloudRun.md)
build on, so the two platform variants behave identically where it matters. End
users never configure this layer directly — it has no deployment UI inputs of its
own — but understanding what it provides explains the defaults you see in the
platform docs.

For the infrastructure that actually provisions and runs Metabase, see the platform
guides ([Metabase_GKE](Metabase_GKE.md), [Metabase_CloudRun](Metabase_CloudRun.md))
and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Metabase_Common | Where it surfaces |
|---|---|---|
| Container image | Pins the official `metabase/metabase` image and builds a custom Cloud Build layer with the platform entrypoint | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 15** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy `db-init` job that creates the database and user | `initialization_jobs` output |
| Fixed environment variables | Sets `MB_JETTY_PORT = "3000"` and `JAVA_TIMEZONE = "UTC"` — these must not be overridden | Application behaviour in the platform guides |
| Health checks | Supplies the default startup/liveness probe behaviour targeting `/api/health` with generous JVM-aware delays | §Observability in the platform guides |
| Object storage | Returns an empty storage bucket list — Metabase stores all state in PostgreSQL | `storage_buckets` output (empty) |

---

## 2. Database engine and bootstrap

Metabase requires **PostgreSQL 15**; the engine is fixed and MySQL is not supported.
On the first deployment a one-shot `db-init` job runs before the Metabase workload
starts. It uses `postgres:15-alpine` and connects to Cloud SQL through the Auth
Proxy Unix socket to idempotently:

1. create the Metabase database (if absent),
2. create the application user with the auto-generated password,
3. grant the user full privileges on that database.

The job runs with `execute_on_apply = true` (runs during `tofu apply`), up to
3 retries, with a 600-second timeout. It is safe to re-run. Inspect the database
directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 3. Core application settings

`Metabase_Common` establishes the baseline Metabase environment so the application
comes up correctly on first boot:

- **`MB_JETTY_PORT = "3000"`** — Metabase's embedded Jetty server must listen on
  port 3000. This is fixed to match `container_port = 3000`. Overriding via
  `environment_variables` in the platform module breaks all routing and health
  checks.
- **`JAVA_TIMEZONE = "UTC"`** — the JVM timezone is fixed to UTC to ensure
  consistent timestamp handling in dashboards, scheduled questions, and report
  exports. Overriding causes Metabase date filtering and scheduling to diverge
  from the database timezone.
- Additional environment variables supplied via `environment_variables` in the
  platform module are merged in at deployment time. Use them for Metabase settings
  such as `MB_EMBEDDING_ENABLED`, `MB_SITE_URL`, or Java heap options.

---

## 4. Health probe behaviour

Both the startup and liveness probes target `/api/health` over HTTP. This endpoint
returns HTTP 200 only once the JVM is fully initialised and connected to
PostgreSQL. Generous initial delays are required because the Metabase JVM takes
60–120 seconds to start:

| Probe | Type | Path | Initial Delay | Period | Failure Threshold | Total tolerance |
|---|---|---|---|---|---|---|
| Startup | HTTP | `/api/health` | 120s | 10s | 15 | ~270s |
| Liveness | HTTP | `/api/health` | 120s | 30s | 3 | — |
| Readiness | HTTP | `/api/health` | 60s | 15s | 3 | — |

Both the GKE and Cloud Run variants use HTTP probes — Cloud Run health checks
reach the Metabase container directly over HTTP/2 and do not encounter the
redirect behaviour that requires a TCP probe workaround in Apache-based
applications.

Inspect probe events on GKE:
```bash
kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
```

---

## 5. No application secrets

Unlike some other application modules, `Metabase_Common` does not generate an
application-level admin password. Metabase manages its own internal encryption
key and user credentials through its first-boot setup wizard. The only secret
this layer is involved with is the **database password**, which is generated and
managed by the foundation module.

Retrieve the database password secret name from the platform deployment output
`database_password_secret`, then access it with:

```bash
gcloud secrets versions access latest --secret=<database-password-secret> --project "$PROJECT"
```

---

## 6. Object storage

`Metabase_Common` returns an empty storage bucket list. Metabase stores all
application state — questions, dashboards, collections, users, permissions — in
PostgreSQL. No GCS bucket is provisioned by default.

If your deployment requires object storage (for example, to configure
Metabase Enterprise Edition's S3-compatible storage for query results caching,
or to store custom plugin artefacts), add buckets via the `storage_buckets`
variable in the platform module (`Metabase_CloudRun` or `Metabase_GKE`):

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

## 7. Scripts

The `scripts/` directory in `Metabase_Common` contains:

| File | Purpose |
|---|---|
| `Dockerfile` | Custom Metabase image extending `metabase/metabase` with the platform entrypoint script. |
| `entrypoint.sh` | Platform entrypoint that injects Cloud-SQL-Proxy connection details before handing off to the Metabase process. |
| `db-init.sh` | Idempotent PostgreSQL setup script — creates the application database and user and grants privileges. Run using `postgres:15-alpine`. |

---

For the Metabase-specific, user-facing configuration (variables by group, outputs,
and how to explore each service from the Console and CLI), see the platform guides:
**[Metabase_GKE](Metabase_GKE.md)** and **[Metabase_CloudRun](Metabase_CloudRun.md)**.
