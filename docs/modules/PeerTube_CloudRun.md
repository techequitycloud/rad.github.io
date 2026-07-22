---
title: "PeerTube on Google Cloud Run"
description: "Configuration reference for deploying PeerTube on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# PeerTube on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PeerTube_CloudRun.png" alt="PeerTube on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

PeerTube is an open-source, ActivityPub-federated video hosting platform — a
self-hosted YouTube alternative where independently-operated instances follow
and federate videos, comments, and channels with each other (and the rest of
the Fediverse) the same way Mastodon federates posts. This module deploys
PeerTube on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services PeerTube uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress
and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

PeerTube runs as a custom-built Node.js container on Cloud Run v2, built from
a Dockerfile layered on the official `chocobozzz/peertube` base image so a
dedicated `PEERTUBE_VERSION` build ARG can pin a real release. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js server on port 9000; 2 vCPU / 2 GiB by default (conservative — raise for real transcoding); `cpu_always_allocated = true` |
| Database | Cloud SQL for PostgreSQL 15 | Required — `pg_trgm`/`unaccent` extensions pre-created; PeerTube migrates its own schema |
| Cache & queue | Redis | **Mandatory, not optional** — PeerTube's BullMQ job queue (transcoding, federation delivery, notifications) has no in-memory fallback |
| Object storage | Cloud Storage | A public `videos` bucket (S3-compatible, HMAC credentials) for video/streaming-playlist files; a private `data` bucket (GCS FUSE) for local state |
| Secrets | Secret Manager | Auto-generated `PEERTUBE_SECRET`, `PT_INITIAL_ROOT_PASSWORD`, S3 HMAC access/secret key pair; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL — required public for federation; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **Redis is mandatory.** PeerTube's transcoding, federation delivery, and
  notification pipeline all run through an in-process BullMQ job queue with
  no in-memory fallback — unlike most modules in this catalogue where Redis
  is an optional performance/scaling knob. `enable_redis = true` is the
  default and should never be disabled.
- **`cpu_always_allocated = true` by default.** BullMQ job processing is not
  tied to any single inbound HTTP request — under request-based billing, CPU
  throttles to near-zero between requests and a transcode job can stall or
  never finish (same rationale as this catalogue's n8n/Kestra background-worker
  pattern).
- **This is a VOD/light-transcoding variant, not a production transcoding
  deployment.** `cpu_limit = "2000m"` / `memory_limit = "2Gi"` are
  deliberately conservative defaults for demo/light use. PeerTube's own FAQ
  recommends up to 8 vCPU / 8Gi when transcoding runs co-located with the
  server — raise substantially for real load, or prefer `PeerTube_GKE`.
- **RTMP live streaming does not work on Cloud Run, period.** `enable_live_streaming`
  has no effect regardless of value — Cloud Run Services route only a single
  HTTP(S) container port, and RTMP ingest (ports 1935/1936) is a raw TCP
  protocol. Use `PeerTube_GKE` for live streaming.
- **The `videos` bucket is deliberately public.** PeerTube's own architecture
  requires browsers to fetch video/streaming-playlist files directly from
  object storage, not proxied through the app — the bucket overrides the
  Foundation's secure-by-default `public_access_prevention = "enforced"` to
  `"inherited"` so the required `allUsers:objectViewer` grant can apply. See
  §3 for the full story.
- **`host` (the ActivityPub federation domain) is immutable after first real
  use.** Left empty by default so the entrypoint derives it from Cloud Run's
  own predicted service URL — works out of the box on a fresh deploy. Set a
  real custom domain before production use.
- **No admin-bootstrap init job is needed.** `PT_INITIAL_ROOT_PASSWORD` is
  read directly from `process.env` by PeerTube's own `installer.ts` on first
  boot when no users exist yet — the `root` account is created automatically.
- **Database connection uses TCP with encrypt-without-verify, not a Unix
  socket.** `App_CloudRun`'s `db_host_env_var_name` mechanism always aliases
  the raw Cloud SQL private IP under `PEERTUBE_DB_HOSTNAME` (not the socket
  path `DB_HOST` otherwise resolves to), so `PeerTube_CloudRun` overrides
  `PEERTUBE_DB_SSL=true` with reject-unauthorized `false` — the same pattern
  already proven for GoToSocial's `GTS_DB_TLS_MODE`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource
names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the PeerTube service

- **Console:** Cloud Run → select the service for revisions, traffic, logs,
  and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

PeerTube stores all application data (accounts, videos metadata, comments,
follows, playlists) in a managed Cloud SQL for PostgreSQL 15 instance. The
service connects over encrypted TCP to the instance's private IP (see §3 for
why this is not a Unix socket connection, unlike most Cloud Run apps in this
catalogue).

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~peertube"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection
model, backups, and password rotation.

### C. Redis — the BullMQ job queue

Redis backs PeerTube's transcoding, federation delivery, and notification job
queue. When `redis_host` is left empty, the shared NFS server VM's IP is used
as the default Redis host.

- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the remapped env vars in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | grep -i redis
  ```

### D. Cloud Storage — `videos` (public) and `data` (private)

Two GCS buckets are provisioned:

- **`videos`** — public (`public_access_prevention = "inherited"`,
  `allUsers:objectViewer`), CORS-enabled, accessed via PeerTube's native
  S3-compatible client (AWS SDK) against GCS's S3-interop XML endpoint using
  HMAC credentials from a dedicated service account. Holds all five PeerTube
  object-storage classes (web-videos, streaming-playlists,
  original-video-files, user-exports, captions) under distinct prefixes.
- **`data`** — private, GCS FUSE-mounted at `/data`. Holds PeerTube's local
  (non-object-storage) state: avatars, thumbnails, previews, storyboards,
  torrents, plugins, logs, and tmp/cache — always on local/mounted disk
  regardless of the video object-storage configuration.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~peertube"
  gcloud storage ls gs://<videos-bucket>/
  gcloud storage buckets describe gs://<videos-bucket> --format='value(iamConfiguration.publicAccessPrevention)'
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### E. Secret Manager

PeerTube's container reads `PEERTUBE_SECRET`, `PT_INITIAL_ROOT_PASSWORD`
(consulted only on first boot when no users exist), the S3 HMAC access/secret
key pair, and — when SMTP is configured — an SMTP password, all as
secret-backed environment variables. The database password is managed
separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~peertube"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details, and
[PeerTube_Common](PeerTube_Common.md) §2 for the full secret list.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings
= "all"`, required for public ActivityPub federation and video delivery). An
external HTTPS load balancer with a custom domain, Cloud CDN (useful for
video delivery), and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to
Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. PeerTube Application Behaviour

- **First-deploy database setup.** The `db-init` job runs
  `scripts/peertube/db-init.sh` using `postgres:15-alpine`. It waits for
  Cloud SQL to accept connections, then idempotently creates the application
  role and database, grants privileges, and creates the `pg_trgm` and
  `unaccent` extensions as the postgres superuser — PeerTube's install guide
  requires both but does not create them itself. Safe to re-run
  (`execute_on_apply = true`, `max_retries = 3`).
- **No separate migrate job.** PeerTube creates and migrates its own
  Sequelize schema automatically on every server start.
- **Admin account bootstraps automatically — no manual trigger needed.**
  Unlike some ActivityPub apps in this catalogue (GoToSocial requires a
  manual CLI job), PeerTube's `installer.ts` reads `PT_INITIAL_ROOT_PASSWORD`
  directly from `process.env` (not node-config, so no `PEERTUBE_` prefix) on
  first boot when no users exist yet, and creates the `root` admin account
  with that password automatically. Retrieve it:
  ```bash
  SECRET=$(gcloud secrets list --project "$PROJECT" --filter="name~root-password" --format="value(name)")
  gcloud secrets versions access latest --secret="$SECRET" --project "$PROJECT"
  ```
  Log in at `$SERVICE_URL/login` with username `root`.
- **The federation domain (`host`) is immutable after real use.**
  `PEERTUBE_WEBSERVER_HOSTNAME` is baked into every locally-created
  ActivityPub actor/object URI the first time the server boots with real
  data. When `host` is left empty, `docker-entrypoint.sh` derives it from
  Cloud Run's own `CLOUDRUN_SERVICE_URL` at container start — a working
  federated default requiring no pre-deploy domain decision. Set a real
  custom domain via `host` before production use; changing it after real
  accounts/videos exist requires PeerTube's own `update-host` maintenance
  script and does not retroactively fix already-federated URIs.
- **The `videos` bucket's public-access override is load-bearing, not
  optional.** `App_CloudRun`/`App_GKE` default every provisioned bucket to
  `public_access_prevention = "enforced"` unless explicitly overridden.
  PeerTube's own docs mandate a public `videos` bucket with CORS configured
  (browsers fetch video/streaming-playlist files directly from object
  storage). Without the override, the module's own
  `google_storage_bucket_iam_member` grant for `allUsers:objectViewer` fails
  at apply time with `Error 412: ... public access prevention is enforced`.
  `PeerTube_Common`'s `storage_buckets` output sets
  `public_access_prevention = "inherited"` on the `videos` bucket
  specifically (not the `data` bucket) to fix this — confirmed live
  2026-07-22.
- **Upload ACLs are intentionally left unset.** GCS's S3 XML-interop under
  Uniform Bucket-Level Access does not honor per-object ACLs set via an S3
  client (the same limitation PeerTube's own docs describe for Backblaze B2),
  so `object_storage.upload_acl.*` is left unconfigured and public read is
  granted at the bucket level instead.
- **Health path.** The startup probe is **TCP** on port 9000 — PeerTube's own
  DB/Redis migrations and first-boot admin bootstrap can take longer than a
  typical HTTP readiness window allows, and an HTTP probe against a
  not-yet-ready API would prevent the revision from ever being created. The
  liveness probe uses the public, unauthenticated `GET /api/v1/config`
  endpoint.
- **Inspect the init job and running config:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions describe <revision-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform
(matching each variable's `{{UIMeta group=N}}` tag in `variables.tf`). Only
settings specific to or notable for PeerTube are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `peertube` | Base name for resources. Do not change after first deploy. |
| `display_name` | `PeerTube` | Human-readable name shown in the Console. |
| `description` | `PeerTube - Federated (ActivityPub) Video Hosting Platform` | Service description. |
| `application_version` | `latest` | Resolves to the maintained `production` Docker Hub tag via the dedicated `PEERTUBE_VERSION` build ARG — not the generic Foundation `APP_VERSION` (which would otherwise win the merge and produce an unresolvable `latest` tag). |
| `host` | `""` | `PEERTUBE_WEBSERVER_HOSTNAME` — the public federation domain. **Immutable after first real use.** Left empty derives it from the predicted Cloud Run URL. |
| `admin_email` | `admin@example.com` | Email assigned to the auto-created `root` administrator account. |
| `enable_open_registration` | `false` | Allow new users to sign themselves up. |
| `enable_live_streaming` | `false` | **No effect on this Cloud Run variant** — RTMP needs a raw TCP port Cloud Run Services cannot expose. Use `PeerTube_GKE`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Builds a Dockerfile-based image (`chocobozzz/peertube:${PEERTUBE_VERSION}` base) via Cloud Build. |
| `cpu_limit` | `2000m` | Conservative default for demo/VOD use. PeerTube's FAQ recommends up to 8 vCPU for real transcoding load. |
| `memory_limit` | `2Gi` | Conservative default. PeerTube's FAQ recommends up to 8Gi for real transcoding load. |
| `container_port` | `9000` | PeerTube's native `PEERTUBE_LISTEN_PORT` default. |
| `cpu_always_allocated` | `true` | Instance-based billing — PeerTube's BullMQ job queue is not tied to any inbound HTTP request. |
| `min_instance_count` | `0` | `0` enables scale-to-zero. |
| `max_instance_count` | `1` | Cost ceiling. |
| `execution_environment` | `gen2` | Required for GCS FUSE mounts. |
| `enable_cloudsql_volume` | `true` | Injects the Cloud SQL Auth Proxy socket mount; PeerTube's own `PEERTUBE_DB_*` env vars are set independently via `db_host_env_var_name` aliasing (see §3). |
| `enable_image_mirroring` | `true` | Mirror the base image into Artifact Registry. |

### Group 5 — Access, Networking, SMTP

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Required — federation and video delivery both need public reachability. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks federation** — only appropriate for a fully private instance. |
| `smtp_host` | `""` | SMTP hostname. Empty disables email; a non-empty value provisions the SMTP password secret. |
| `smtp_port` / `smtp_user` / `smtp_password` / `smtp_secure_enabled` / `mail_from` | `587` / `""` / `""` / `false` / `""` | Standard SMTP configuration, only used when `smtp_host` is set. `mail_from` defaults to `noreply@<host>` when empty. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Plain-text env vars merged into `PeerTube_Common`'s defaults. |
| `secret_environment_variables` | `{}` | Operator-facing Secret Manager references. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

Standard App_CloudRun backup/restore configuration — see
[App_CloudRun](App_CloudRun.md).

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md).

### Group 9 — Custom SQL Scripts

Standard App_CloudRun custom SQL script execution — see
[App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `application_domains` | `[]` | Custom domain names — should match `host`. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend — useful for video delivery. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets — `PeerTube_Common` supplies the real `data`/`videos` buckets, overriding this variable's generic `data`-only default. |
| `enable_nfs` | `true` (ignored) | **Hardcoded to `false` in `main.tf`** — PeerTube uses GCS FUSE and object storage instead of NFS. |
| `enable_gcs_storage_volume` | `true` | Mounts the `data` bucket via FUSE at `/data`. Keep `true` — PeerTube's local state always lives there regardless of video object-storage config. |
| `gcs_volumes` | `[]` | Additional GCS Fuse volume mounts beyond `data`. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PeerTube requires PostgreSQL. |
| `db_name` | `peertube` | The database actually created and injected as `PEERTUBE_DB_NAME`. Immutable after first deploy. |
| `db_user` | `peertube` | The role actually created and injected as `PEERTUBE_DB_USERNAME`; password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_postgres_extensions` | `true` | Installs `postgres_extensions` after provisioning. |
| `postgres_extensions` | `["pg_trgm", "unaccent"]` | Required by PeerTube's install guide; not created by PeerTube itself. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job supplied by `PeerTube_Common`. |
| `cron_jobs` | `[]` | No platform-scheduled recurring tasks are defined for PeerTube. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, port 9000 | Confirms the port is bound; PeerTube's own DB/Redis migrations and admin bootstrap complete before the HTTP API is meaningfully ready. |
| `liveness_probe` | HTTP `/api/v1/config`, 60s initial delay | The public, unauthenticated config endpoint. |
| `uptime_check_config` | `{ enabled=true, path="/" }` | Cloud Monitoring uptime check. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Mandatory** — never disable. PeerTube has no in-memory fallback for BullMQ. |
| `redis_host` | `""` | Leave blank to default to the NFS server IP. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore
the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (Cloud SQL private IP on Cloud Run) / port. |
| `storage_buckets` | Created Cloud Storage buckets (`data`, `videos`). |
| `network_name` | VPC network name. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `uptime_check_names` | Monitoring status, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` | Project identifier. |
| `cicd_enabled` / `artifact_registry_repository` | CI/CD status and Artifact Registry repo. |
| `vpc_sc_enabled` / `audit_logging_enabled` | VPC-SC and audit logging status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `host` (`PEERTUBE_WEBSERVER_HOSTNAME`) | Set your real domain before first real use | Critical | Baked into every ActivityPub actor/object URI at creation time; changing it after real accounts/videos exist breaks federation for everything created under the old value. |
| `enable_redis` | `true` (never disable) | Critical | PeerTube has no in-memory fallback for BullMQ — transcoding, federation delivery, and notifications all stop working without Redis. |
| `videos` bucket `public_access_prevention` | `"inherited"` (set by `PeerTube_Common`, do not override to `"enforced"`) | Critical | PeerTube's architecture requires browsers to fetch video files directly from object storage; `"enforced"` blocks the required `allUsers:objectViewer` grant with a `412` error at apply time. |
| `enable_live_streaming` | Leave `false`, or move to `PeerTube_GKE` | High | Has zero effect on Cloud Run regardless of value — RTMP ingest needs a raw TCP port Cloud Run Services cannot expose. Enabling it here creates a false expectation, not a working feature. |
| `PEERTUBE_DB_SSL` / reject-unauthorized override | Leave as shipped (`true` / `false`, set automatically) | Critical | Cloud Run's `db_host_env_var_name` aliases the raw Cloud SQL private IP, which requires encryption; the plain "disable" that would be correct on GKE fails here with "no encryption", and full certificate verification fails against Cloud SQL's cert (no IP SANs). |
| `cpu_limit` / `memory_limit` | Raise substantially for real transcoding load | High | The `2000m`/`2Gi` defaults are deliberately conservative for demo/VOD use; PeerTube's own FAQ recommends up to 8 vCPU/8Gi for real production transcoding — undersized resources stall or fail transcode jobs. |
| `cpu_always_allocated` | `true` (default, do not disable) | High | PeerTube's BullMQ processing is not tied to any inbound HTTP request; under request-based billing CPU throttles to near-zero between requests and background jobs can stall indefinitely. |
| `database_type` | `POSTGRES_15` | Critical | PeerTube requires PostgreSQL; the `pg_trgm`/`unaccent` extensions and Sequelize schema are Postgres-specific. |
| `startup_probe` | Leave `type = "TCP"` | High | PeerTube's DB/Redis migrations and admin bootstrap take longer than a typical HTTP readiness window allows; an HTTP probe against a not-yet-ready API can prevent the revision from ever becoming ready. |
| `enable_open_registration` | `false` for most deployments | Medium | Leaving registration open on a public instance allows anyone with the URL to create an account and upload video content. |
| `enable_iap` | `false` for a public instance | Medium | IAP blocks unauthenticated ActivityPub federation traffic and public video viewing — only appropriate for a fully private/testing instance. |
| `PT_INITIAL_ROOT_PASSWORD` secret | Retrieve and store securely after first deploy | Medium | This is the only credential for the `root` admin account; it is not re-generated or re-applied after the account already exists. |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. PeerTube-specific application
configuration is defined in **[PeerTube_Common](PeerTube_Common.md)** (module
source: `modules/PeerTube_Common`).
