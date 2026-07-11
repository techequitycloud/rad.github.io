---
title: "Windmill Common \u2014 Shared Application Configuration"
description: "Shared configuration reference for the Windmill module — application-layer settings consumed by both the Cloud Run and GKE Autopilot deployments."
---

# Windmill Common — Shared Application Configuration

`Windmill_Common` is the **shared application layer** for Windmill. It is not deployed on its own; instead it supplies the Windmill-specific configuration that both [Windmill_GKE](Windmill_GKE.md) and [Windmill_CloudRun](Windmill_CloudRun.md) build on, so the two platform variants behave identically where it matters. End users never configure this layer directly — it has no deployment UI inputs of its own — but understanding what it provides explains the defaults you see in the platform docs.

For the infrastructure that actually provisions and runs Windmill, see the platform guides ([Windmill_GKE](Windmill_GKE.md), [Windmill_CloudRun](Windmill_CloudRun.md)) and the foundation guides ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. What this layer provides

| Area | Provided by Windmill_Common | Where it surfaces |
|---|---|---|
| SMTP credential | Generates a placeholder SMTP password and stores it in **Secret Manager** | Retrieve and replace via Secret Manager (see below) |
| Container image | Pins the official `ghcr.io/windmill-labs/windmill` image and builds a custom wrapper with a startup shim | `container_image` output of the platform deployment |
| Database engine | Fixes **Cloud SQL for PostgreSQL 16** as the only supported engine | §Database in the platform guides |
| Database bootstrap | Defines the first-deploy job that creates the database, user, roles, and grants | `initialization_jobs` output |
| Object storage | Declares the **Cloud Storage** `windmill-data` bucket for workflow outputs and artefacts | `storage_buckets` output |
| Core settings | Sets the baseline Windmill environment (combined server+worker mode, namespace isolation disabled, structured logging, Prometheus metrics, service URL) | Application behaviour in the platform guides |
| Health checks | Supplies the default startup, liveness, and readiness probe configuration targeting `/api/version` | §Observability in the platform guides |

---

## 2. SMTP credential in Secret Manager

Windmill's SMTP password is generated as a 16-character placeholder and stored as a Secret Manager secret — it is never set in plain text. The secret name follows the deployment's resource prefix. Before enabling email notifications, replace the placeholder with your actual SMTP password:

```bash
# List and identify the SMTP secret:
gcloud secrets list --project "$PROJECT" --filter="name~smtp-password"
# Replace the placeholder with your real SMTP password:
echo -n "your-real-smtp-password" | gcloud secrets versions add \
  <smtp-secret-name> --data-file=- --project "$PROJECT"
```

After updating the secret, redeploy or restart the service to pick up the new value. Also supply the remaining SMTP settings via `environment_variables` in the platform module:

```bash
# Variables to add: WINDMILL_SMTP_HOST, WINDMILL_SMTP_PORT, WINDMILL_SMTP_FROM
gcloud run services update <service-name> \
  --update-env-vars "WINDMILL_SMTP_HOST=smtp.example.com,WINDMILL_SMTP_PORT=587,WINDMILL_SMTP_FROM=noreply@example.com" \
  --region "$REGION" --project "$PROJECT"
```

The database password is generated and managed separately by the foundation; its secret name is reported in the platform deployment outputs (`database_password_secret`). See [App_Common](App_Common.md) for the shared secret and Workload Identity model.

---

## 3. Database engine and bootstrap

Windmill requires **PostgreSQL 16**; the engine is fixed and no other database type is supported. On the first deployment a one-shot job (`db-init`) connects to Cloud SQL through the Auth Proxy and idempotently:

1. creates the `windmill_admin` and `windmill_user` PostgreSQL roles (if absent),
2. creates the application user with the generated password,
3. creates the application database owned by the user,
4. grants the user full privileges on the database and the `public` schema.

The job uses `postgres:16-alpine` and is safe to re-run. Inspect the database directly with:

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

The instance, database, and user names are in the platform deployment outputs.

---

## 4. Container image and startup shim

`Windmill_Common` builds a custom container image extending the official `ghcr.io/windmill-labs/windmill` image. The custom wrapper adds `entrypoint.sh`, which:

- Constructs `DATABASE_URL` from platform-injected `DB_*` variables at start time, handling both the Cloud SQL Auth Proxy Unix socket path and plain TCP connections.
- Sets `BASE_URL` and `BASE_INTERNAL_URL` from `GKE_SERVICE_URL` (when running on GKE and the LoadBalancer IP is available) or from the `BASE_URL` environment variable provided by the platform.
- Starts the Windmill server process with the `exec windmill` call.

This shim ensures Windmill configures itself correctly regardless of whether it runs on Cloud Run or GKE Autopilot, and regardless of whether the database connection uses a socket or TCP.

---

## 5. Core application settings

`Windmill_Common` establishes the baseline Windmill environment so the application comes up correctly on first boot:

- **Combined server+worker mode** — `MODE=server,worker` and `NUM_WORKERS=3` run the API server and script execution workers in a single process. This is appropriate for Cloud Run and single-pod GKE deployments; for dedicated worker scaling define additional Kubernetes Deployments or increase `max_instance_count`.
- **Linux namespace isolation disabled** — `DISABLE_NSJAIL=true` is always injected. Both Cloud Run and GKE Autopilot lack `CAP_SYS_ADMIN` and user namespaces; Windmill's sandbox requires this flag.
- **Worker group** — `WORKER_GROUP=default` means all scripts and flows route to the default worker pool unless overridden.
- **Structured JSON logging** — `JSON_FMT=true` and `RUST_LOG=windmill=info` ensure logs are structured and parseable by Cloud Logging.
- **Prometheus metrics endpoint** — `METRICS_ADDR=:9001` exposes Windmill's internal metrics for scraping within the VPC.
- **Service URL** — `BASE_URL` and `BASE_INTERNAL_URL` are set from the platform-injected service URL so OAuth redirects, webhook callbacks, and Windmill UI deep-links all resolve correctly.

---

## 6. Health probe behaviour

All three probe types target `GET /api/version`, which returns HTTP 200 with the Windmill version string when the service is healthy and fully connected to PostgreSQL.

| Probe | Type | Path | Initial delay | Period | Failure threshold |
|---|---|---|---|---|---|
| Startup | HTTP | `/api/version` | 60 s | 10 s | 10 |
| Liveness | HTTP | `/api/version` | 60 s | 30 s | 3 |
| Readiness | HTTP | `/api/version` | 30 s | 10 s | 3 |

The startup probe allows up to 160 seconds (60 s delay + 10 × 10 s) for Windmill to connect to the database and run any pending migrations on first start. Unlike PHP-based applications that need TCP probes to avoid redirect loops, Windmill's `/api/version` endpoint responds with a plain JSON body over HTTP — no redirect handling is required on either Cloud Run or GKE.

---

## 7. Object storage

A dedicated **Cloud Storage** bucket (`windmill-data`) is declared here and provisioned by the foundation, which also grants the workload service account access. This bucket holds workflow outputs, job artefacts, and any files produced by script execution. List it with:

```bash
gcloud storage buckets list --project "$PROJECT"
```

Additional buckets can be defined in the platform module via `storage_buckets`, and GCS Fuse mounts can be configured via `gcs_volumes` to make buckets directly accessible as a filesystem path inside the container.

---

For the Windmill-specific, user-facing configuration (variables by group, outputs, and how to explore each service from the Console and CLI), see the platform guides: **[Windmill_GKE](Windmill_GKE.md)** and **[Windmill_CloudRun](Windmill_CloudRun.md)**.
