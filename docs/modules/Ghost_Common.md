---
title: "Ghost Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Ghost module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Ghost Common — Shared Application Configuration

`Ghost_Common` is the **shared application layer** for Ghost. It is not deployed on its own; instead it supplies the Ghost-specific configuration that both [Ghost_GKE](Ghost_GKE.md) and [Ghost_CloudRun](Ghost_CloudRun.md) build on, so the two platform variants behave identically where it matters. End users never configure this layer directly — it has no deployment UI inputs of its own — but understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Ghost, see the platform guides ([Ghost_GKE](Ghost_GKE.md), [Ghost_CloudRun](Ghost_CloudRun.md)) and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Ghost_Common | Where it surfaces |
|---|---|---|
| Container image | Pins the official Ghost image and builds a customised variant via a Dockerfile | `container_image` output of the platform deployment |
| Custom entrypoint | Installs a startup script that detects the service URL, maps foundation DB env vars to Ghost's `database__connection__*` settings, and injects `database__client=mysql` | Application behaviour in the platform guides |
| Database engine | Fixes **Cloud SQL for MySQL 8.0** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy `db-init` job that creates the database with `utf8mb4` charset, creates the user, and grants privileges | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** `ghost-content` bucket | `storage_buckets` output |
| Health checks | Supplies default startup (`/`, 90s initial delay, 10 failures) and liveness (`/`, 60s delay) probe behaviour | §Observability in the platform guides |
| Readiness probe | HTTP `/`, 30s initial delay, period 10s, 3 failures | Applied to the running container |

---

## 2. Container image and custom entrypoint

`Ghost_Common` extends the official `ghost:<version>` Docker Hub image with a custom Dockerfile that installs `curl`, `jq`, and `netcat-openbsd`, then adds a startup script (`entrypoint.sh`) as `/usr/local/bin/custom-entrypoint.sh`.

The startup script performs these actions on every container start:

1. **Service URL detection.** Queries the GCP metadata API (`/computeMetadata/v1/instance/service-accounts/default/token`, the Cloud Run API, and `K_SERVICE`) to discover the public service URL and exports it as `url` and `admin__url` for Ghost. An explicit `url` environment variable takes precedence. Falls back to a `GKE_SERVICE_URL` environment variable, then to `http://localhost:2368` for local development.
2. **DB credential mapping.** Maps `DB_HOST` (or `DB_IP` as fallback), `DB_USER`, `DB_NAME`, `DB_PASSWORD`, and `DB_PORT` — injected by the foundation — to Ghost's `database__connection__socketPath`, `database__connection__host`, `database__connection__user`, `database__connection__database`, `database__connection__password`, and `database__connection__port`. When `DB_HOST` starts with `/` it is treated as a Unix socket (the Cloud SQL Auth Proxy socket path).
3. **Configuration validation.** Warns when `database__client` is not set (Ghost would fall back to SQLite) and verifies MySQL connectivity before starting Ghost.
4. **Ghost launch.** Delegates to `docker-entrypoint.sh "$@"` — the official Ghost startup sequence.

To explore the running configuration:

```bash
# Cloud Run — check what URL Ghost detected
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 30 | grep -E "URL:|Starting Ghost"

# GKE — check the Ghost pod startup output
kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=50 | grep -E "URL:|Database|Starting"
```

---

## 3. Database engine and bootstrap

Ghost requires **MySQL 8.0**; the engine is fixed at `MYSQL_8_0` inside `Ghost_Common` and cannot be changed to PostgreSQL. On the first deployment a one-shot `db-init` job connects to Cloud SQL through the Auth Proxy and idempotently:

1. Creates the Ghost database with `CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci` (the MySQL 8.0 default, required by Ghost 6.x).
2. Creates the application user.
3. Grants all privileges on the Ghost database plus `CREATE`, `ALTER`, `DROP`, `INDEX`, `REFERENCES` for migrations.
4. Sends a `POST /quitquitquit` shutdown signal to the Cloud SQL Proxy sidecar so the Kubernetes Job exits cleanly.

The job runs on every apply (`execute_on_apply = true`) and is idempotent. Inspect the database directly:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Core application settings

`Ghost_Common` establishes the baseline Ghost environment so the application comes up correctly on first boot:

- **Database client** — `database__client = "mysql"` is injected via the entrypoint. Without it Ghost silently uses SQLite, even when all other database connection variables are present.
- **Migrations on start** — Ghost runs its database migrations automatically on each startup, so version upgrades apply schema changes without a manual step.
- **URL awareness** — the entrypoint discovers and exports the service URL at startup so Ghost generates correct absolute links in newsletters and admin navigation. This is essential when using custom domains or Cloud Run's dynamic `run.app` URL.
- **SMTP pre-population** — the calling Application Module pre-populates `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL`, and `EMAIL_FROM` as default environment variables. Set real SMTP values before inviting members — without a working SMTP configuration, Ghost cannot send sign-up confirmations, password resets, or newsletters.

---

## 5. Health probe behaviour

The default probes target Ghost's root path (`/`), which returns HTTP 200 only once the application is fully initialised, with a generous startup delay to allow first-boot database migrations and theme compilation.

- **Startup probe** — HTTP `/`, initial delay 90 s, period 10 s, failure threshold 10. This gives Ghost up to 90 + (10 × 10) = 190 seconds from container start before it is killed as unhealthy.
- **Liveness probe** — HTTP `/`, initial delay 60 s, period 30 s, failure threshold 3.
- **Readiness probe** — HTTP `/`, initial delay 30 s, period 10 s, failure threshold 3.

Both GKE and Cloud Run use HTTP probes against `/`. Unlike Mautic (which issues HTTP→HTTPS redirects causing probe failures on Cloud Run), Ghost serves its root path directly over HTTP on port 2368 with no redirect, so HTTP probes work on both platforms.

Do not reduce `initial_delay_seconds` below 60 seconds. On first boot Ghost must connect to MySQL, run all pending migrations, and compile default themes before it can respond to HTTP requests. Killing Ghost during this window produces a restart loop.

---

## 6. Object storage

A dedicated **Cloud Storage** `ghost-content` bucket is declared here and provisioned by the foundation, which also grants the workload service account access. This bucket is available for content storage via GCS Fuse or direct SDK access. List it with:

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~ghost-content"
```

Combined with the shared Filestore (NFS) volume, this gives Ghost durable content storage that is consistent across all instances.

---

For the Ghost-specific, user-facing configuration (variables by group, outputs, and how to explore each service from the Console and CLI), see the platform guides:
**[Ghost_GKE](Ghost_GKE.md)** and **[Ghost_CloudRun](Ghost_CloudRun.md)**.
