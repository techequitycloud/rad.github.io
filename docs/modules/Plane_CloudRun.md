---
title: "Plane on Google Cloud Run"
description: "Configuration reference for deploying Plane on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Plane on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Plane_CloudRun.png" alt="Plane on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Plane is an open-source project-management platform — a Jira / Linear alternative for issues, cycles, modules, and roadmaps. This module deploys Plane on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Plane uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run application — service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Plane's upstream self-host stack is multi-service: `web` / `space` / `admin` (frontends), `api` (Django/gunicorn), `worker` + `beat` (Celery), `live` (real-time collaboration), and a `migrator` job, plus PostgreSQL, Redis, RabbitMQ, and S3-compatible object storage. This module deploys Plane's published **all-in-one community image** (`makeplane/plane-aio-community`), which bundles every sub-service behind an internal **Caddy reverse proxy on port 80** via supervisord — so one Cloud Run service exposes the whole app. The deployment wires together:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | All-in-one container (api + workers + frontends + migrator), 2 vCPU / 4 GiB by default |
| Message broker | RabbitMQ **in-pod sidecar** | `rabbitmq:3.13-management-alpine` at `127.0.0.1:5672` — mandatory for Celery |
| Database | Cloud SQL for PostgreSQL 15 | Plain PostgreSQL, no extensions required |
| Cache / task queue backend | Redis | Enabled by default; co-hosted on the NFS server VM when no external host is given |
| Shared files | Filestore / self-managed NFS | Required for the Redis co-location (gen2 execution environment) |
| Object storage | Cloud Storage | A dedicated `storage` bucket is provisioned — S3 upload wiring is a documented TODO |
| Secrets | Secret Manager | `SECRET_KEY`, `LIVE_SERVER_SECRET_KEY`, and the DB password managed automatically |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is the fixed engine.** Plane is a Django application; `database_type = "POSTGRES_15"` and no other engine works.
- **RabbitMQ is mandatory and runs as an in-pod sidecar.** Plane's `start.sh` exits non-zero if `AMQP_URL` is empty. AMQP (TCP 5672) is a non-HTTP protocol that Cloud Run service-to-service networking cannot carry, so the broker shares the pod at `127.0.0.1:5672`. Broker state is **ephemeral** (queue durability is a documented TODO).
- **Custom build.** A thin wrapper Dockerfile layers a platform entrypoint on the AIO image; the entrypoint composes the `DATABASE_URL` / `REDIS_URL` / `AMQP_URL` connection strings Plane expects from the discrete `DB_*` / `REDIS_*` / `RABBITMQ_*` values the foundation injects.
- **`application_version` defaults to `stable`.** The upstream image has no `latest` tag — a `latest` input is automatically mapped to `stable` at build time.
- **Cold-start by default.** `cpu_always_allocated = false` and `min_instance_count = 0` (request-based billing, scale-to-zero). Celery notifications, webhooks, and exports defer until the next request wakes an instance — set `cpu_always_allocated = true` and `min_instance_count = 1` for continuous background processing.
- **Two application secrets are auto-generated** in Secret Manager: Django `SECRET_KEY` (50 chars) and `LIVE_SERVER_SECRET_KEY` (40 chars, real-time collaboration auth).
- **A `db-init` job runs on every apply** to idempotently create the Plane database and user; schema migrations are run by the AIO image's own `migrator` step on startup.
- **File uploads are a TODO.** Plane needs an S3-compatible endpoint; the GCS `storage` bucket exists but GCS S3-interop HMAC keys are not yet wired. Issues, projects, and cycles work without it — attachments and avatars do not.
- **Health probes target `/health`** through the internal Caddy proxy on port 80.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Plane service (with the RabbitMQ sidecar)

Plane runs as a single Cloud Run v2 service. The main container is the all-in-one image (supervisord runs migrator → api / frontends / live + Celery worker/beat behind Caddy on :80); a second **`mq` sidecar container** runs RabbitMQ. The main container's startup waits on the sidecar's TCP 5672 probe.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics. The sidecar appears under the revision's Containers tab.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Plane stores workspaces, projects, issues, cycles, and users in a managed Cloud SQL for PostgreSQL 15 instance. On first deploy a `db-init` Job creates the application database and user; the AIO image's `migrator` step then applies Django migrations on every container start. The platform entrypoint connects over the **private TCP IP with `sslmode=require`** (the Cloud SQL socket volume is mounted, but Plane's Django/psycopg uses the composed `DATABASE_URL`).

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model, backups, and password rotation.

### C. Redis (Celery backend and cache)

Redis backs Plane's cache and Celery result store. When no external `redis_host` is configured, the NFS server VM co-hosts Redis and its IP is resolved at runtime (the entrypoint substitutes the `$(NFS_SERVER_IP)` placeholder before composing `REDIS_URL`).

- **Console:** Memorystore → Redis (if using a managed instance); Compute Engine → VM instances (NFS/Redis VM).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50 | grep "Composed REDIS_URL"
  ```

### D. Cloud Storage

A dedicated `storage` bucket (`gcs-<service-name>-storage`) is provisioned for Plane file uploads. **Upload wiring is a TODO**: Plane requires an S3-compatible endpoint, and while `AWS_S3_ENDPOINT_URL` points at `https://storage.googleapis.com`, the GCS S3-interoperability **HMAC keys are not provisioned** — supply `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` via `environment_variables` (or use an external S3 bucket) to enable attachments.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~plane"
  gcloud storage ls gs://<storage-bucket>/
  ```

### E. Secret Manager

Three secrets are managed automatically: the Django `SECRET_KEY`, the `LIVE_SERVER_SECRET_KEY` (real-time collaboration auth), and the Cloud SQL password. All are injected at runtime; plaintext never appears in configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~plane"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default; the predicted URL is injected as `WEB_URL` / `DOMAIN_NAME` / `CORS_ALLOWED_ORIGINS` so OAuth redirects, CORS, and email links work out of the box. An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on — if you do, the domain must match those URL variables.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs (including supervisord output from every bundled sub-service and the `mq` sidecar) flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud Monitoring, with an optional uptime check against `/health` (disabled by default) and optional alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Uptime checks.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Plane Application Behaviour

- **First-deploy database setup.** A `db-init` Job (`postgres:15-alpine`) idempotently creates the Plane database and user, grants privileges (including `GRANT <user> TO postgres` so ownership can be set), and shuts down its Cloud SQL Proxy sidecar cleanly. It runs on every apply and is safe to re-run.
- **Migrations run on startup, not in an init job.** The AIO image's supervisord runs a `migrator` program (`manage.py migrate`) before the api and frontends come up. The startup probe allows up to ~5 minutes (30 s initial delay + 30 × 10 s failures) for a cold first boot.
- **Connection URLs are composed by the entrypoint.** The platform entrypoint builds `DATABASE_URL` (private-IP TCP, `sslmode=require`; loopback with `sslmode=disable` on GKE), `REDIS_URL` (resolving `$(NFS_SERVER_IP)`), and `AMQP_URL` (from the sidecar's injected host), then execs Plane's bundled `/app/start.sh`. Look for the `Composed DATABASE_URL / REDIS_URL / AMQP_URL` log lines when debugging.
- **RabbitMQ is mandatory.** Plane's `start.sh` validates `AMQP_URL` and exits if it is empty. The sidecar's broker state is ephemeral — queued Celery tasks are lost on instance recycle (documented hardening TODO).
- **First-run setup — God Mode.** Open `<web_url>/god-mode/` to create the instance admin and configure the instance (the entrypoint patches the internal Caddyfile with a 308 redirect from `/god-mode` to `/god-mode/`, working around a Remix SPA basename issue). Then sign up at the root URL and create your first workspace.
- **File uploads fail until S3 storage is wired.** Everything else (issues, projects, cycles, modules) works; attachments and avatars need real S3 credentials (see §2D).
- **Cold-start trade-off.** Under the default `cpu_always_allocated = false` + `min = 0`, background Celery work (notifications, webhooks, exports) runs only while an instance is awake. For teams relying on timely notifications, flip to `cpu_always_allocated = true` + `min_instance_count = 1`.
- **Health path.** Startup and liveness probes and the uptime check target `/health` on port 80 (the internal Caddy proxy).
- **Verification:**
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/health"
  gcloud run services logs read <service-name> --region "$REGION" --limit 100 | grep -E "Composed|Starting Plane"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for Plane are listed; every other input is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

All other inputs follow standard App_CloudRun behaviour.

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |

All other inputs follow standard App_CloudRun behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `plane` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Plane - Project Management` | Friendly name shown in the Console. |
| `application_version` | `stable` | AIO image tag. The upstream image has no `latest` tag — `latest` is mapped to `stable` at build time. |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `2000m` | The AIO image runs many processes (api, workers, frontends, Caddy); 2 vCPU minimum. |
| `memory_limit` | `4Gi` | 4 GiB recommended — raise if the migrator or worker OOMs. |
| `cpu_always_allocated` | `false` | Cold-start / request-based billing. Celery notifications, webhooks, and exports defer until the next request; set `true` (with `min ≥ 1`) for continuous background processing. |
| `min_instance_count` | `0` | Scale-to-zero. Set `1` to avoid cold starts and keep background tasks flowing. |
| `max_instance_count` | `3` | Cost ceiling. |
| `container_port` | `80` | The internal Caddy proxy port — the only port the AIO container exposes. |
| `enable_cloudsql_volume` | `true` | Mounts the Cloud SQL socket volume (the entrypoint still connects over private-IP TCP). |
| `execution_environment` | `gen2` | Required for NFS mounts. |
| `timeout_seconds` | `300` | Request timeout. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public internet access (required for browser access to Plane). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Private-range egress via the VPC connector (Cloud SQL, Redis, NFS). |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Override or extend Plane's environment. Use this to supply real S3 credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET_NAME`, `AWS_S3_ENDPOINT_URL`) once object storage is wired. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

All other inputs follow standard App_CloudRun behaviour.

### Groups 7–10 — Backup, CI/CD, Custom SQL, Domain & CDN

Standard App_CloudRun behaviour — see [App_CloudRun](App_CloudRun.md). Notable for Plane: if you set `application_domains`, the custom domain becomes the host users reach, and `WEB_URL` / `CORS_ALLOWED_ORIGINS` / `DOMAIN_NAME` must resolve to it (override via `environment_variables`) or sign-in and email links break.

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Required for the Redis co-location on the NFS server VM (gen2). |
| `create_cloud_storage` | `true` | Provisions the `storage` bucket declared by `Plane_Common`. |

All other inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Plane requires PostgreSQL — do not change to MySQL. |
| `db_name` | `plane_db` | Database name. Immutable after first deploy. |
| `db_user` | `plane_user` | Application user. Immutable after first deploy. |

All other inputs follow standard App_CloudRun behaviour.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (`postgres:15-alpine`). Schema migrations are handled by the AIO image's own migrator on startup. |

All other inputs follow standard App_CloudRun behaviour.

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, 30 s initial delay, 30 failures × 10 s | Generous window (~5 min) for the first-boot migrator step. |
| `liveness_probe` | HTTP `/health`, 30 s delay, period 30 s | Liveness against the Caddy-fronted health endpoint. |
| `uptime_check_config` | disabled, path `/health` | Cloud Monitoring uptime check; disabled by default. |

All other inputs follow standard App_CloudRun behaviour.

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Required — Plane's Celery task queue and cache depend on Redis. |
| `redis_host` | `""` | Leave empty to use the NFS-VM-hosted Redis. |
| `redis_port` | `6379` | Redis port. |

All other inputs follow standard App_CloudRun behaviour.

### Group 22 — VPC Service Controls & Audit Logging

Standard App_CloudRun behaviour (`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `enable_audit_logging`) — see [App_CloudRun](App_CloudRun.md).

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `web_url` | URL of the Plane web UI (the internal Caddy proxy serves web/space/admin/api on this single URL). |
| `api_url` | URL of the Plane API (same service URL, routed by the internal proxy). |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (sensitive) / port. |
| `storage_buckets` | Created Cloud Storage buckets (includes the `storage` bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

Plan-time validations catch several of these; the rest surface only at runtime.

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Plane is a Django/PostgreSQL app; MySQL or `NONE` breaks the migrator and startup. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| RabbitMQ sidecar | leave wired | Critical | Plane's `start.sh` exits if `AMQP_URL` is empty — the broker is mandatory, and it must be in-pod (Cloud Run cannot route AMQP between services). |
| `container_port` | `80` | Critical | The AIO container only exposes the internal Caddy proxy on :80; any other port fails all probes. |
| `application_version` | `stable` or a real tag | High | The upstream image has no `latest` tag; the module maps `latest`→`stable`, but an invalid explicit tag 404s the build (MANIFEST_UNKNOWN). |
| `enable_redis` | `true` | High | Without Redis, Celery and caching have no backend; workers fail to start. |
| `enable_nfs` | `true` (when `redis_host` empty) | High | The default Redis lives on the NFS VM; disabling NFS with no external `redis_host` leaves Plane without a Redis endpoint. |
| `startup_probe` failure window | ≥ 30 × 10 s | High | The first-boot migrator can take minutes; a tight probe kills the instance mid-migration. |
| `cpu_always_allocated` / `min_instance_count` | `true` / `1` for notification-critical teams | Medium | Under the cold-start default, Celery notifications/webhooks/exports run only while an instance is awake. |
| Object storage (`AWS_*`) | real S3 credentials before relying on uploads | Medium | File uploads (attachments, avatars) fail until HMAC keys or an external S3 endpoint are supplied — the rest of Plane works. |
| `application_domains` + URL env vars | keep in sync | Medium | A custom domain that doesn't match `WEB_URL`/`CORS_ALLOWED_ORIGINS`/`DOMAIN_NAME` breaks sign-in redirects and email links. |
| `memory_limit` | `4Gi` | Medium | The AIO image runs many processes; undersizing OOMs the migrator or Celery worker. |
| RabbitMQ durability | accept ephemeral or externalize | Low | Sidecar broker state is ephemeral; queued tasks are lost on instance recycle. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. Plane-specific application configuration shared with the GKE variant is described in **[Plane_Common](Plane_Common.md)**.
