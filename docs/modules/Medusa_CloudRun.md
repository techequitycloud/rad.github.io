---
title: "Medusa on Google Cloud Run"
description: "Configuration reference for deploying Medusa on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Medusa on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Medusa_CloudRun.png" alt="Medusa on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

## 1. Introduction

**The single most important thing to know about this module: Medusa has no
official Docker image, so `Medusa_CloudRun` builds one from source on every
deploy.** Every other application module in this catalogue wraps a prebuilt
upstream image; this one instead has Cloud Build clone the
`medusajs/dtc-starter` monorepo template (only `apps/backend` — the Medusa
server plus its built-in Admin UI, same process and port — is built; the
separate Next.js `apps/storefront` is explicitly out of scope) and run `medusa
build` inside a multi-stage Dockerfile. Expect a real `git clone` + `pnpm
install` + `medusa build` on every image build — budget roughly 10 minutes for
the build step alone, separate from Cloud SQL provisioning and init-job
execution time.

Medusa itself is an open-source, headless e-commerce platform — an API-first
alternative to Shopify Plus/Saleor with full programmatic control over
products, carts, orders, customers, and payments, plus a built-in Admin UI
served by the same server process. This module deploys Medusa on **Cloud Run
v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Medusa uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress
and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 2. Overview

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service (built from source), 1 vCPU / 2 GiB by default, serverless autoscaling; `min_instance_count = 1` by default |
| Database | Cloud SQL for PostgreSQL 15 | Required — Medusa does not support MySQL or other engines |
| Cache & background workflows | Redis (**required**) | Session/cache/event-bus/workflow-engine/locking; no supported production fallback |
| Object storage (optional) | Cloud Storage | Off by default (`enable_gcs_storage = false`); when enabled, a bucket + dedicated service account + auto-generated HMAC key are provisioned |
| Secrets | Secret Manager | Auto-generated `JWT_SECRET`, `COOKIE_SECRET`, admin password; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |
| Build | Cloud Build | Clones `medusajs/dtc-starter`, runs `medusa build` — no prebuilt image exists to pull instead |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup.
- **Redis is required, not optional, in production.** `enable_redis = true` by
  default. Medusa logs `"redisUrl not found. A fake redis instance will be
  used."` and boots anyway if Redis is unreachable — that is a dev/test
  fallback, not a supported production mode.
- **`container_port = 9000`** — Medusa's documented default port, serving both
  the REST API and the Admin UI.
- **`container_image_source = "custom"` cannot be changed to `"prebuilt"`
  meaningfully** — there is no prebuilt Medusa image to deploy instead.
- **Build time is real and separate from deploy time.** The Cloud Build step
  is allotted up to 30 minutes (`timeout: 1800s` in the reference
  `cloudbuild.yaml`) though a typical build — clone, `pnpm install`, `medusa
  build` — completes in roughly 10 minutes. This is on top of normal Cloud SQL
  provisioning (20–35 minutes on a first deploy) and the four init-job
  executions that follow.
- **A four-stage initialization chain runs before the service is considered
  ready**: `db-init` → `medusa-migrate` → `medusa-verify` →
  `medusa-admin-create`, each depending on the previous.
- **`MEDUSA_WORKER_MODE = "shared"`** — a single Cloud Run instance handles
  both API requests and Medusa's background jobs/subscribers/workflows, since
  Medusa's officially-recommended split server/worker topology doesn't map
  onto a single Cloud Run service.
- **`enable_gcs_storage = false` by default.** Medusa falls back to local,
  ephemeral container filesystem storage for uploaded files until you opt in.
- **`application_version` does not pin what gets built.** The Dockerfile has
  no `ARG` consuming it — only `MEDUSA_STARTER_REF` (hardcoded to `main` in
  `Medusa_Common`) controls which `dtc-starter` branch is cloned.

---

## 3. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#6-outputs).

### A. Cloud Run — the Medusa service

Medusa runs as a Cloud Run v2 service that autoscales by request load between
the minimum and maximum instance counts. Each deployment creates an immutable
revision.

```bash
gcloud run services list --project "$PROJECT" --region "$REGION"
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud Build — the from-source image build

Every deploy (and every rebuild triggered by an edit to the Application
module's build config) runs a real build: `git clone --depth 1 --branch main
https://github.com/medusajs/dtc-starter.git`, `pnpm install`, `pnpm build`
inside `apps/backend`, then a second `pnpm install --prod` outside the pnpm
workspace before the runtime image is assembled.

```bash
gcloud builds list --project "$PROJECT" --limit 5
gcloud builds log <build-id> --project "$PROJECT"
```

### C. Cloud SQL for PostgreSQL 15

Medusa stores all application data (products, orders, customers, carts,
inventory) in a managed Cloud SQL for PostgreSQL 15 instance. The service
connects privately through the **Cloud SQL Auth Proxy** over a Unix socket by
default (`enable_cloudsql_volume = true`); no public IP is exposed.

```bash
gcloud sql instances list --project "$PROJECT"
gcloud sql instances describe <instance-name> --project "$PROJECT"
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

The instance name, database, user, and password secret are in the
[Outputs](#6-outputs). See [App_CloudRun](App_CloudRun.md) for the connection
model, backups, and password rotation.

### D. Redis

Redis is **enabled by default**. When `redis_host` is left empty, the platform
NFS VM's IP is used as the Redis host fallback (requires `enable_nfs = true`
or a discovered `Services_GCP`-managed NFS server); otherwise set `redis_host`
explicitly.

```bash
redis-cli -h <redis-host> ping
# Confirm the resolved REDIS_URL in the running revision's logs (constructed
# by entrypoint.sh at boot):
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50 | grep -i redis
```

### E. Cloud Storage (optional)

Only provisioned when `enable_gcs_storage = true`. Unlike many apps in this
catalogue, no manual HMAC key setup is required — `Medusa_Common` generates a
dedicated service account and access-key/secret-key pair automatically.

```bash
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://gcs-<service-name>-storage/
```

### F. Secret Manager

`JWT_SECRET`, `COOKIE_SECRET`, and the bootstrapped admin password are
generated automatically. The database password is managed separately by the
foundation.

```bash
gcloud secrets list --project "$PROJECT" --filter="name~medusa"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

### G. Cloud Logging & Monitoring

```bash
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
```

See [App_CloudRun](App_CloudRun.md) for uptime checks and alert policies.

---

## 4. Medusa Application Behaviour

### The four-stage initialization chain

1. **`db-init`** (`postgres:15-alpine`) — waits for the database, creates the
   application role and database, grants privileges on `public`, and
   best-effort installs the `uuid-ossp`/`postgis` extensions.
2. **`medusa-migrate`** — runs `npx medusa db:migrate` on the built image (2
   vCPU / 2Gi, up to 30 minutes, 3 retries).
3. **`medusa-verify`** — a guard job that connects after `medusa-migrate` and
   **fails the apply** if the `public` schema has zero tables. This exists
   because this Foundation does **not** fail the module apply when an init job
   fails on its own — without `medusa-verify`, a raced or failed migration
   could silently ship a healthy-looking Cloud Run service pointed at an
   **empty** database, and every request would then fail against missing
   tables with no obvious signal at deploy time. Live-verified: logged
   `"public schema has 146 table(s)"` on a successful deploy.
4. **`medusa-admin-create`** — runs `npx medusa user -e <email> -p <password>`
   to create the first admin login, using `admin_email` (default
   `admin@techequity.cloud`) and the auto-generated admin-password secret.
   Live-verified: logged `"User created successfully."`.

```bash
gcloud run jobs list --project "$PROJECT" --region "$REGION"
gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
```

### Health endpoint

`/health` is unauthenticated and used by both the startup probe (120-second
initial delay, 40 × 15-second retries — roughly 12 minutes total) and the
liveness probe (30-second initial delay, 3 retries). Live-verified: `curl
/health` returns `OK` with HTTP 200.

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/health"
```

### `MEDUSA_WORKER_MODE = "shared"`

A single Cloud Run instance runs both the API server and Medusa's background
jobs/subscribers/workflows — Medusa's officially-recommended split
server/worker topology doesn't map onto a single Cloud Run service, so this
module always runs shared mode. Practically: every running instance is doing
both request handling *and* whatever background work Medusa's workflow engine
schedules.

### Retrieving the first-run admin credentials

```bash
ADMIN_SECRET=$(gcloud secrets list --project "$PROJECT" --filter="name~medusa-admin-password" --format="value(name)")
gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project "$PROJECT"
```

The admin email is whatever `admin_email` was set to at deploy time (default
`admin@techequity.cloud`).

### Accessing the built-in Admin UI

Medusa serves its Admin UI from the same process and port as the API — open
`$SERVICE_URL/app` in a browser and sign in with the email/password retrieved
above.

---

## 5. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Medusa are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `medusa` | Base name for resources. Do not change after first deploy. |
| `admin_email` | `admin@techequity.cloud` | Email for the first admin user created by `medusa-admin-create`. |
| `application_version` | `latest` | Deployment-tracking tag only. **Does not select what's built** — the Dockerfile has no `ARG` consuming it; only `MEDUSA_STARTER_REF` (fixed to `main`) determines the cloned code. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Per-instance resource limits. |
| `min_instance_count` / `max_instance_count` | `1` / `3` | Instance bounds. |
| `container_port` | `9000` | Medusa's documented default port. |
| `cpu_always_allocated` | `false` | Request-based billing. Consider `true` if you rely on Medusa's own scheduled/event-driven workflows — shared worker mode processes them in the same instance, and request-based billing throttles CPU between inbound requests. |
| `container_image_source` | `custom` | Always builds from source — there is no `"prebuilt"` Medusa image. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy Unix socket. |

### Group 12 — Database

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed by `Medusa_Common`; MySQL is not supported. |
| `db_name` / `db_user` | `medusa` / `medusa` | Database name / application user. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_gcs_storage` | `false` | Provisions a GCS bucket + auto-generated HMAC key for Medusa's S3-compatible file provider. When `false`, uploads use local, ephemeral container storage. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Required in production. |
| `redis_host` | `""` | Empty uses the platform NFS VM IP as a fallback (requires `enable_nfs = true`); otherwise set explicitly. |
| `redis_port` / `redis_auth` | `"6379"` / `""` | Redis port / auth password (sensitive). |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, 120s delay, 40-failure threshold | ~12-minute total window. |
| `liveness_probe` | HTTP `/health`, 30s delay, 3-failure threshold | |

For every other group (CI/CD, backup, IAM, VPC-SC, load balancer/CDN, etc.),
see [App_CloudRun](App_CloudRun.md) — Medusa inherits the Foundation's
standard behaviour with no application-specific override.

---

## 6. Outputs

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `database_instance_name` / `database_name` / `database_user` | Cloud SQL identifiers. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (sensitive) / port. |
| `storage_buckets` | Created Cloud Storage buckets — empty unless `enable_gcs_storage = true`. |
| `container_image` / `container_registry` | The Cloud-Build-produced Medusa image and its Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the four created init jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` / `artifact_registry_repository` | CI/CD status and details. |
| `vpc_sc_enabled` / `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Security posture flags. |

---

## 7. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_CloudRun](App_CloudRun.md) foundation engine, which
> validates values and combinations at plan time. Invalid configuration fails
> the **plan** with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| From-source build (`container_image_source = "custom"`) | No action needed — it's the only valid mode | High | Any change to the Dockerfile, `entrypoint.sh`, or build args in `Medusa_Common` requires a real Cloud Build rebuild (~10 minutes for the build step alone) before it takes effect — there is no way to "just restart" onto new source, unlike custom-build apps whose base image already exists. Force a rebuild with `tofu taint 'module.medusa_app.module.app_build.null_resource.build_and_push_application_image[0]'` if the content-hash trigger misses an edit. |
| `enable_redis` | `true` | Critical | Medusa logs `"redisUrl not found. A fake redis instance will be used."` and boots anyway — this graceful-looking log message is a dev/test fallback, not a supported production mode. Cache/session/event-bus/workflow-engine/locking all depend on Redis; disabling it in a long-running production deployment is unsupported. |
| `medusa-verify` init job | Leave in the default chain | Critical | This job exists specifically because an init-job failure does **not** fail the module apply in this Foundation. Removing it (by overriding `initialization_jobs`) reopens the exact silent-empty-database risk it was added to close — a raced or failed `medusa-migrate` would otherwise ship a "successfully deployed" service against an empty `public` schema, and every request would fail with no obvious signal at deploy time. |
| pnpm workspace-isolation (lesson for extending this Dockerfile pattern) | N/A — informational | High | If you clone this from-source pattern for another pnpm/npm-workspace-based application, remember that build output produced *inside* a cloned monorepo is still nested under that monorepo's `pnpm-workspace.yaml`. Running `pnpm install --prod` directly on that output silently reinstalls it as part of the outer workspace and can write **zero** `node_modules` — confirmed here as `sh: medusa: not found` at runtime. Always copy standalone build output to a directory with no ancestor `pnpm-workspace.yaml` before installing its production dependencies. |
| `admin_email` / bootstrapped admin password | Retrieve from Secret Manager after deploy | High | There is no pre-seeded admin credential visible anywhere except Secret Manager (`admin_password_secret_id` output) — losing track of it means recovering access via `npx medusa user` manually against the running database. |
| `MEDUSA_WORKER_MODE = "shared"` + `cpu_always_allocated = false` (default) | Set `cpu_always_allocated = true` if you rely on scheduled/event-driven workflows | Medium | Shared worker mode processes background workflows/subscribers in the *same* instance that serves HTTP requests. Request-based billing (the default) throttles CPU to near-zero between inbound requests, which can stall in-process background work — the same class of issue documented fleet-wide for n8n/OpenClaw-style apps in this catalogue. |
| `application_version` | Understand it's metadata-only | Low | Changing it does not pin or change what code is built; only `MEDUSA_STARTER_REF` (fixed to `main`) controls the cloned `dtc-starter` branch. A fully reproducible pinned build requires overriding `container_build_config.build_args`. |
| `enable_gcs_storage = false` (default) | Enable it for any persistent-upload use case | Medium | Local storage is ephemeral container filesystem — uploaded product images/files do not survive a restart, redeploy, or scale-to-zero cold start. |

---

For the foundation behaviour referenced throughout — service identity,
scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Medusa-specific application configuration
shared with the GKE variant is described in **[Medusa_Common](Medusa_Common.md)**.
