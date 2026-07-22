---
title: "PeerTube on GKE Autopilot"
description: "Configuration reference for deploying PeerTube on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# PeerTube on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PeerTube_GKE.png" alt="PeerTube on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

PeerTube is an open-source, ActivityPub-federated video hosting platform — a
self-hosted YouTube alternative where independently-operated instances follow
and federate videos, comments, and channels with each other (and the rest of
the Fediverse) the same way Mastodon federates posts. This module deploys
PeerTube on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation,
which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

This guide focuses on the cloud services PeerTube uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

PeerTube runs as a custom-built Node.js pod on GKE Autopilot, built from a
Dockerfile layered on the official `chocobozzz/peertube` base image so a
dedicated `PEERTUBE_VERSION` build ARG can pin a real release. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pod on port 9000; 2 vCPU / 2 GiB by default (conservative — raise for real transcoding) |
| Database | Cloud SQL for PostgreSQL 15 | Required — `pg_trgm`/`unaccent` extensions pre-created; PeerTube migrates its own schema; Cloud SQL Auth Proxy sidecar |
| Cache & queue | Redis | **Mandatory, not optional** — PeerTube's BullMQ job queue (transcoding, federation delivery, notifications) has no in-memory fallback |
| Object storage | Cloud Storage | A public `videos` bucket (S3-compatible, HMAC credentials) for video/streaming-playlist files; a private `data` bucket (GCS FUSE, with an explicit UID/GID fix) for local state |
| Secrets | Secret Manager | Auto-generated `PEERTUBE_SECRET`, `PT_INITIAL_ROOT_PASSWORD`, S3 HMAC access/secret key pair; database password |
| Ingress | Kubernetes Service / Gateway | Default `LoadBalancer` Service — required public for federation; optional custom domain via Kubernetes Gateway |

**Sensible defaults worth knowing up front:**

- **Redis is mandatory.** PeerTube's transcoding, federation delivery, and
  notification pipeline all run through an in-process BullMQ job queue with
  no in-memory fallback — unlike most modules in this catalogue where Redis
  is an optional performance/scaling knob. `enable_redis = true` is the
  default and should never be disabled; a plan-time precondition blocks
  `enable_redis = true` with neither `redis_host` set nor `enable_nfs = true`.
- **This module fixed a real, GKE-specific storage-permission bug.**
  PeerTube's vendor entrypoint runs as root and `chown`s `/data` to the
  `peertube` user (uid/gid **999**) before dropping privileges — that
  in-container `chown` works fine on Cloud Run's own gcsfuse integration, but
  **GKE's GCS FUSE CSI driver does not honor it**, leaving the mount
  root-owned. See §3 for the full story and the fix.
- **GKE is the right target for real transcoding load.** Unlike the Cloud Run
  variant (deliberately scoped to VOD/light-transcoding), GKE's sustained
  compute model and this module's ability to raise `cpu_limit`/`memory_limit`
  well beyond scale-to-zero economics make it the better home for production
  transcoding — PeerTube's own FAQ recommends up to 8 vCPU / 8Gi.
- **RTMP live streaming is not wired in this pass — but it's not architecturally
  blocked here the way it is on Cloud Run.** `enable_live_streaming` defaults
  `false` and currently has no effect: Cloud Run Services can never route raw
  TCP (an absolute architectural ceiling), but GKE's networking model *can*
  expose additional TCP ports via extra LoadBalancer Service ports — that
  wiring is simply not implemented yet.
- **The `videos` bucket is deliberately public.** PeerTube's own architecture
  requires browsers to fetch video/streaming-playlist files directly from
  object storage, not proxied through the app — the bucket overrides the
  Foundation's secure-by-default `public_access_prevention = "enforced"` to
  `"inherited"` so the required `allUsers:objectViewer` grant can apply (the
  same fix already proven on the Cloud Run variant — see
  [PeerTube_CloudRun](PeerTube_CloudRun.md) §3).
- **`host` (the ActivityPub federation domain) is immutable after first real
  use.** Left empty by default so the entrypoint derives it from App_GKE's
  own predicted service URL — works out of the box on a fresh deploy. Set a
  real custom domain before production use.
- **No admin-bootstrap init job is needed.** `PT_INITIAL_ROOT_PASSWORD` is
  read directly from `process.env` by PeerTube's own `installer.ts` on first
  boot when no users exist yet — the `root` account is created automatically.
- **Database connection uses the Cloud SQL Auth Proxy loopback, unencrypted.**
  Unlike the Cloud Run variant (which must override `PEERTUBE_DB_SSL` to
  `true` with cert verification off, since Cloud Run aliases the raw Cloud
  SQL private IP), App_GKE's `db_host_env_var_name` mechanism prefers the
  cloud-sql-proxy sidecar's `127.0.0.1` loopback when present — so
  `PeerTube_Common`'s shared `PEERTUBE_DB_SSL="false"` default is already
  correct here, unmodified.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. Resource names are
reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the PeerTube workload

- **Console:** Kubernetes Engine → Workloads → select the Deployment.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for Workload Identity, autoscaling, and rollout
mechanics.

### B. Cloud SQL for PostgreSQL 15

PeerTube stores all application data (accounts, videos metadata, comments,
follows, playlists) in a managed Cloud SQL for PostgreSQL 15 instance,
reached via a Cloud SQL Auth Proxy sidecar on `127.0.0.1`.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~peertube"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the connection model,
backups, and password rotation.

### C. Redis — the BullMQ job queue

Redis backs PeerTube's transcoding, federation delivery, and notification job
queue. When `redis_host` is left empty, the shared NFS server VM's IP is used
as the default Redis host.

- **CLI:**
  ```bash
  POD=$(kubectl get pods -n "$NAMESPACE" -l app=<service-name> -o jsonpath='{.items[0].metadata.name}')
  kubectl exec -n "$NAMESPACE" "$POD" -- env | grep -i PEERTUBE_REDIS
  ```

### D. Cloud Storage — `videos` (public) and `data` (private, GCS FUSE)

Two GCS buckets are provisioned:

- **`videos`** — public (`public_access_prevention = "inherited"`,
  `allUsers:objectViewer`), CORS-enabled, accessed via PeerTube's native
  S3-compatible client (AWS SDK) against GCS's S3-interop XML endpoint using
  HMAC credentials from a dedicated service account. Holds all five PeerTube
  object-storage classes (web-videos, streaming-playlists,
  original-video-files, user-exports, captions) under distinct prefixes.
- **`data`** — private, mounted via the **GCS FUSE CSI driver** at `/data`
  with explicit `uid=999,gid=999,file-mode=664,dir-mode=775` mount options
  (see §3 for why this is load-bearing on GKE). Holds PeerTube's local
  (non-object-storage) state: avatars, thumbnails, previews, storyboards,
  torrents, plugins, logs, and tmp/cache.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~peertube"
  gcloud storage ls gs://<videos-bucket>/
  gcloud storage buckets describe gs://<videos-bucket> --format='value(iamConfiguration.publicAccessPrevention)'
  ```

See [App_GKE](App_GKE.md) for GCS Fuse and CMEK options.

### E. Secret Manager

PeerTube's pod reads `PEERTUBE_SECRET`, `PT_INITIAL_ROOT_PASSWORD`
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

See [App_GKE](App_GKE.md) for injection and rotation details, and
[PeerTube_Common](PeerTube_Common.md) for the full secret list.

### F. Networking & ingress

The Kubernetes Service defaults to `service_type = "LoadBalancer"` (required
for public ActivityPub federation and video delivery). A quota-constrained
project can set `service_type = "ClusterIP"` and verify via
`kubectl port-forward` instead of consuming external/static-IP quota. A
Kubernetes Gateway with a custom domain, Cloud CDN (useful for video
delivery), and Cloud Armor can be layered on.

- **Console:** Kubernetes Engine → Gateways, Services & Ingress.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; GKE and Cloud SQL metrics flow to
Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
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
  App_GKE's own `GKE_SERVICE_URL` at container start — a working federated
  default requiring no pre-deploy domain decision. Set a real custom domain
  via `host` before production use; changing it after real accounts/videos
  exist requires PeerTube's own `update-host` maintenance script and does
  not retroactively fix already-federated URIs.
- **Health path.** The startup probe is **TCP** on port 9000 — PeerTube's own
  DB/Redis migrations and first-boot admin bootstrap can take longer than a
  typical HTTP readiness window allows, and an HTTP probe against a
  not-yet-ready API would prevent the pod from ever becoming Ready. The
  liveness probe uses the public, unauthenticated `GET /api/v1/config`
  endpoint.

### ⚠ The GCS-FUSE UID/GID bug — the GKE-specific gotcha this module fixes

PeerTube's vendor image entrypoint (`support/docker/production/entrypoint.sh`)
runs as **root** and `chown`s `/data` to the `peertube` user — confirmed
uid/gid **999** via `docker run --entrypoint sh chocobozzz/peertube:production
-c "id peertube"` — before dropping privileges to run the server as that
user.

- **On Cloud Run**, this in-container `chown` is sufficient — Cloud Run's own
  built-in gcsfuse integration tolerates it, and the mount ends up correctly
  owned with no extra configuration.
- **On GKE**, the **GCS FUSE CSI driver does not honor an in-container
  `chown`.** Without an explicit `uid=`/`gid=` mount option, the volume
  mounts root-owned and stays that way regardless of what the entrypoint
  does afterward — so PeerTube's own attempt to write into its now
  root-owned `/data` fails immediately:
  ```
  Error: EACCES: permission denied, mkdir '/data/logs'
  ```
  This crash-loops the pod on every restart, before the server ever binds
  its port.

`PeerTube_Common`'s shared `_peertube_data_volume` local (in
`modules/PeerTube_Common/main.tf`, used by **both** the Cloud Run and GKE
variants) fixes this by pinning explicit mount options:

```hcl
mount_options = [
  "implicit-dirs",
  "stat-cache-ttl=60s",
  "type-cache-ttl=60s",
  "uid=999",
  "gid=999",
  "file-mode=664",
  "dir-mode=775",
]
```

This is a no-op on Cloud Run (root already chowns to the same IDs there) and
load-bearing on GKE. It is the same bug class already found and fixed on
this catalogue's Paperless, CodeServer, CloudBeaver, and Seerr GKE variants
(see the repository `CLAUDE.md`'s "GKE gcsfuse UID/GID permission denied"
finding) — PeerTube is the latest confirmed instance, and the first where
the mismatched UID (999, not the more common 1000) came from the vendor
entrypoint's own `chown` rather than the image's declared `USER`.

**Verified live, 2026-07-22:**

```bash
kubectl get pods -n "$NAMESPACE" -l app=<service-name>
# 3/3 Running, 0 restarts (down from 5 before the fix)

kubectl logs -n "$NAMESPACE" <pod> | head -20
# HTTP server listening on 0.0.0.0:9000
# Creating the administrator ... Username: root

POD=$(kubectl get pods -n "$NAMESPACE" -l app=<service-name> -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n "$NAMESPACE" "$POD" -- ls -la /data
# every entry (logs/, avatars/, torrents/, plugins/, ...) owned peertube:peertube

kubectl port-forward -n "$NAMESPACE" "$POD" 19000:9000 &
curl -s http://localhost:19000/api/v1/config | head -c 200      # 200, real JSON
curl -s http://localhost:19000/api/v1/config/about | head -c 200 # 200, real JSON
```

**Diagnostic tell**, if you ever see this symptom on a fork of this module:

```bash
kubectl describe pod -n "$NAMESPACE" <peertube-pod>
# Look for: Error: EACCES: permission denied, mkdir '/data/logs'
```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform
(matching each variable's `{{UIMeta group=N}}` tag in `variables.tf`). Only
settings specific to or notable for PeerTube are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `peertube` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `PeerTube` | Human-readable name shown in the platform UI. |
| `application_version` | `latest` | Resolves to the maintained `production` Docker Hub tag via the dedicated `PEERTUBE_VERSION` build ARG — not the generic Foundation `APP_VERSION` (which would otherwise win the merge and produce an unresolvable `latest` tag). |
| `host` | `""` | `PEERTUBE_WEBSERVER_HOSTNAME` — the public federation domain. **Immutable after first real use.** Left empty derives it from the predicted GKE service URL. |
| `admin_email` | `admin@example.com` | Email assigned to the auto-created `root` administrator account. |
| `enable_open_registration` | `false` | Allow new users to sign themselves up. |
| `enable_live_streaming` | `false` | Present for schema symmetry; not wired in this pass — see §1/§3. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `custom` | Builds a Dockerfile-based image (`chocobozzz/peertube:${PEERTUBE_VERSION}` base) via Cloud Build. |
| `cpu_limit` | `2000m` | Conservative default for demo/VOD use. PeerTube's FAQ recommends up to 8 vCPU for real transcoding load — raise it here for production use, this is the right variant for that. |
| `memory_limit` | `2Gi` | Conservative default. PeerTube's FAQ recommends up to 8Gi for real transcoding load. |
| `container_port` | `9000` | PeerTube's native `PEERTUBE_LISTEN_PORT` default. |
| `min_instance_count` / `max_instance_count` | `0` / `3` | `0` enables scale-to-zero on the minimum; `3` is the HPA cost ceiling. |
| `enable_cloudsql_volume` | `true` | Runs the Cloud SQL Auth Proxy sidecar; App_GKE prefers its `127.0.0.1` loopback for `PEERTUBE_DB_HOSTNAME`, so PeerTube's `PEERTUBE_DB_SSL="false"` default is correct unmodified (see §1). |
| `enable_image_mirroring` | `true` | Mirror the base image into Artifact Registry. |

### Group 6 — GKE Backend Configuration

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Required for public federation by default; set `ClusterIP` under a static-IP quota constraint and verify via `kubectl port-forward` (used for this module's own live verification). |
| `session_affinity` | `ClientIP` | Sticky sessions. |
| `workload_type` | `Deployment` | `StatefulSet` is available via `stateful_pvc_enabled`. |

### Group 5 — Environment Variables, Secrets & SMTP

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Plain-text env vars merged into `PeerTube_Common`'s defaults. |
| `secret_environment_variables` | `{}` | Operator-facing Secret Manager references. |
| `smtp_host` | `""` | SMTP hostname. Empty disables email; a non-empty value provisions the SMTP password secret. |
| `smtp_port` / `smtp_user` / `smtp_password` / `smtp_secure_enabled` / `mail_from` | `587` / `""` / `""` / `false` / `""` | Standard SMTP configuration, only used when `smtp_host` is set. `mail_from` defaults to `noreply@<host>` when empty. |

### Group 13 — NFS

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisions the shared NFS VM, whose IP is used as the default Redis host when `redis_host` is empty. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | `PeerTube_Common` supplies the real `data`/`videos` bucket declarations, overriding this variable's generic `data`-only default. |
| `gcs_volumes` | `[]` | Additional GCS FUSE volume mounts beyond `data` (which already ships the uid=999/gid=999 fix — see §3). |

### Group 16 — Database

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PeerTube requires PostgreSQL. |
| `db_name` | `peertube` | The database actually created and injected as `PEERTUBE_DB_NAME`. Immutable after first deploy. |
| `db_user` | `peertube` | The role actually created and injected as `PEERTUBE_DB_USERNAME`; password auto-generated in Secret Manager. |
| `enable_postgres_extensions` | `true` | Installs `postgres_extensions` after provisioning. |
| `postgres_extensions` | `["pg_trgm", "unaccent"]` | Required by PeerTube's install guide; not created by PeerTube itself. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Mandatory** — never disable. PeerTube has no in-memory fallback for BullMQ. A plan-time precondition blocks `enable_redis=true` with no `redis_host` and no `enable_nfs`. |
| `redis_host` | `""` | Leave blank to default to the NFS server IP. |

### Group 11 — Workload Automation

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job supplied by `PeerTube_Common`. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | When `true`, App_GKE mounts a real block PVC at `/data` instead of GCS FUSE, and `PeerTube_GKE`'s own wiring (`peertube.tf`) auto-disables the GCS FUSE volume to avoid a double-mount. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, port 9000 | Confirms the port is bound; PeerTube's own DB/Redis migrations and admin bootstrap complete before the HTTP API is meaningfully ready. |
| `liveness_probe` | HTTP `/api/v1/config`, 60s initial delay | The public, unauthenticated config endpoint. |
| `uptime_check_config` | `{ enabled=true, path="/" }` | Cloud Monitoring uptime check — only meaningful when `service_type = "LoadBalancer"` or a custom domain is configured. |

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
| `service_name` / `namespace` | Kubernetes Service name and namespace. |
| `service_cluster_ip` / `service_external_ip` | Internal ClusterIP; external LoadBalancer IP (when reserved). |
| `service_url` | URL to reach PeerTube. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | `127.0.0.1` via the Cloud SQL Auth Proxy sidecar / port. |
| `storage_buckets` | Created Cloud Storage buckets (`data`, `videos`). |
| `network_name` | VPC network name. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` | Monitoring status. |
| `initialization_jobs` | Names of the setup jobs (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` | Project identifier. |
| `cicd_enabled` / `artifact_registry_repository` | CI/CD status and Artifact Registry repo. |
| `kubernetes_ready` | Whether the workload reached Ready state. |
| `vpc_sc_enabled` / `audit_logging_enabled` | VPC-SC and audit logging status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `/data` GCS FUSE `mount_options` | Leave `PeerTube_Common`'s `uid=999`/`gid=999` fix in place | **Critical** | Without it, the pod crash-loops with `Error: EACCES: permission denied, mkdir '/data/logs'` on every restart — a GKE-only failure mode not seen on Cloud Run (see §3). |
| `host` (`PEERTUBE_WEBSERVER_HOSTNAME`) | Set your real domain before first real use | Critical | Baked into every ActivityPub actor/object URI at creation time; changing it after real accounts/videos exist breaks federation for everything created under the old value. |
| `enable_redis` | `true` (never disable) | Critical | PeerTube has no in-memory fallback for BullMQ — transcoding, federation delivery, and notifications all stop working without Redis. |
| `videos` bucket `public_access_prevention` | `"inherited"` (set by `PeerTube_Common`, do not override to `"enforced"`) | Critical | PeerTube's architecture requires browsers to fetch video files directly from object storage; `"enforced"` blocks the required `allUsers:objectViewer` grant with a `412` error at apply time. |
| `database_type` | `POSTGRES_15` | Critical | PeerTube requires PostgreSQL; the `pg_trgm`/`unaccent` extensions and Sequelize schema are Postgres-specific. |
| `startup_probe` | Leave `type = "TCP"` | High | PeerTube's DB/Redis migrations and admin bootstrap take longer than a typical HTTP readiness window allows; an HTTP probe against a not-yet-ready API can prevent the pod from ever becoming Ready. |
| `cpu_limit` / `memory_limit` | Raise substantially for real transcoding load | High | The `2000m`/`2Gi` defaults are deliberately conservative for demo/VOD use; PeerTube's own FAQ recommends up to 8 vCPU/8Gi for real production transcoding — undersized resources stall or fail transcode jobs. |
| `stateful_pvc_enabled` | Leave `false` unless you need block-storage write-locking guarantees for `/data` | Medium | Enabling it switches `/data` to a real PVC and auto-disables the GCS FUSE volume — mixing the two would double-mount the path. |
| `service_type` | `LoadBalancer` for public federation; `ClusterIP` only under a real IP-quota constraint | Medium | `ClusterIP` makes the instance unreachable from outside the cluster — fine for `kubectl port-forward` verification, wrong for a production federated instance. |
| `enable_open_registration` | `false` for most deployments | Medium | Leaving registration open on a public instance allows anyone with the URL to create an account and upload video content. |
| `enable_iap` | `false` for a public instance | Medium | IAP blocks unauthenticated ActivityPub federation traffic and public video viewing — only appropriate for a fully private/testing instance. |
| `PT_INITIAL_ROOT_PASSWORD` secret | Retrieve and store securely after first deploy | Medium | This is the only credential for the `root` admin account; it is not re-generated or re-applied after the account already exists. |

---

For the foundation behaviour referenced throughout — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
backups, and image mirroring — see **[App_GKE](App_GKE.md)**. PeerTube-specific
application configuration shared with the Cloud Run variant is defined in
**[PeerTube_Common](PeerTube_Common.md)** (module source:
`modules/PeerTube_Common`). See also the Cloud Run variant's guide,
**[PeerTube_CloudRun](PeerTube_CloudRun.md)**, for the storage-bucket public-access
story shared by both platforms.
