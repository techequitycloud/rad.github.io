---
title: "Plane on GKE Autopilot"
description: "Configuration reference for deploying Plane on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Plane on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Plane_GKE.png" alt="Plane on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Plane is an open-source project-management and issue-tracking tool (a Jira /
Linear / Asana alternative) covering issues, sprints, cycles, modules, and
product roadmaps behind a modern web UI. This module deploys Plane on **GKE
Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions
and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Plane uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Upstream Plane's self-host stack is multi-service (`web` / `space` / `admin`
frontends, `api`, `worker` + `beat` Celery workers, a `live` real-time
server, and a `migrator` job). This module does **not** wire those services
separately. Instead it deploys Plane's published **all-in-one community
image** (`makeplane/plane-aio-community`), which bundles api + worker + beat
+ space + admin + live + migrator behind an internal **Caddy reverse proxy
on port 80**, run under supervisord — so a single GKE Deployment exposes the
whole application. A thin wrapper Dockerfile/entrypoint layers on top of
that image to compose the connection strings Plane expects (`DATABASE_URL`,
`REDIS_URL`, `AMQP_URL`) from the discrete values the platform injects.

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single Deployment running the `plane-aio-community` image (custom build), port 80, 2 vCPU / 4 GiB by default |
| Database | Cloud SQL for PostgreSQL 15 | Fixed at `POSTGRES_15` by `Plane_Common`; reached via the Cloud SQL Auth Proxy sidecar on loopback |
| Message broker | RabbitMQ (`rabbitmq:3.13-management-alpine`) | Deployed as an in-cluster `additional_services` Deployment (`INGRESS_TRAFFIC_INTERNAL_ONLY`), required by Plane's Celery worker/beat |
| Cache / queue backend | Redis | `enable_redis = true` by default; resolves to the shared NFS VM's IP when no explicit `redis_host` is set |
| File persistence | Cloud Filestore (NFS) | Enabled by default primarily to host the shared Redis instance, not Plane application data |
| Object storage | Cloud Storage | A `storage` bucket is provisioned automatically, but file-upload wiring is an **open TODO** — see below |
| Secrets | Secret Manager | Auto-generated Django `SECRET_KEY` and `LIVE_SERVER_SECRET_KEY`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; optional custom domain (enabled by default) with a managed certificate |

**Sensible defaults worth knowing up front:**

- **The all-in-one image is a custom build, not prebuilt.** `Plane_Common`
  sets `image_source = "custom"` and builds a thin wrapper Dockerfile `FROM
  makeplane/plane-aio-community:<version>`; the entrypoint composes
  `DATABASE_URL`/`REDIS_URL`/`AMQP_URL` before handing off to Plane's own
  `/app/start.sh`.
- **`application_version` defaults to `"stable"`, not `"latest"`.** The
  upstream `plane-aio-community` image publishes no `latest` tag, so
  `Plane_GKE`'s own variable default is already pinned; if `latest` is
  supplied anyway, the build-arg mapping in `Plane_Common` substitutes
  `"stable"` so the base-image pull does not 404.
- **RabbitMQ is mandatory, not optional.** Plane's bundled `start.sh`
  validates `AMQP_URL` and exits non-zero if it is empty, so the `mq`
  additional service is always appended in `Plane_GKE/plane.tf`'s
  `additional_services` list — it cannot be disabled via a variable.
- **RabbitMQ credentials are static, in-code defaults** (`plane` /
  `plane` / vhost `plane`), not Secret-Manager-backed, and RabbitMQ storage
  is ephemeral (no PVC/NFS attached) — a pod restart drops queued jobs.
  <!-- TODO: verify whether this is an accepted risk or a hardening gap -->
- **Redis is NFS-VM-hosted by default**, exactly like other RAD apps that
  set `enable_redis = true` with no `redis_host` — the NFS server co-hosts
  Redis and its IP is injected via the `$(NFS_SERVER_IP)` runtime
  placeholder, resolved by the wrapper entrypoint.
- **Object storage (S3-compatible) is an unfinished TODO.** A GCS bucket is
  created and `AWS_S3_ENDPOINT_URL` points at `storage.googleapis.com`, but
  GCS's S3-interop layer requires HMAC keys that are **not provisioned by
  this module**. File uploads will fail until real S3-compatible
  credentials are supplied via the `environment_variables` override
  (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`,
  `AWS_S3_BUCKET_NAME`, `AWS_S3_ENDPOINT_URL`). Everything else in Plane
  (issues, projects, cycles) works without it.
- **RabbitMQ's DNS name is computed at plan time, not injected at apply
  time.** Unlike the Cloud Run variant (which injects a `$(PLANE_MQ_HOST)`
  placeholder via the additional-service mechanism), `Plane_GKE` overrides
  `RABBITMQ_HOST` directly to the predictable in-cluster DNS name
  `<application_name><resource_prefix>-mq.<namespace>.svc.cluster.local`
  before it ever reaches the entrypoint.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and
other identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Plane all-in-one workload

The `plane-aio-community` pods run on Autopilot, billed for the CPU/memory
the pod actually requests. All of Plane's sub-services (api, worker, beat,
web, space, admin, live) run inside this single container under
supervisord, fronted by Caddy on port 80.

- **Console:** Kubernetes Engine → Workloads → select the Plane workload for
  pods, revisions, and events.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --field-selector=status.phase=Running
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- supervisorctl status
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Plane stores all application data (workspaces, projects, issues, cycles,
modules, users) in a managed Cloud SQL for PostgreSQL 15 instance. Pods
reach it through the **Cloud SQL Auth Proxy** sidecar; the wrapper
entrypoint composes `DATABASE_URL` from the injected `DB_*` values, using
`sslmode=disable` against the loopback proxy. On first deploy the `db-init`
job creates the application role and database; Plane's own bundled
`migrator` step (inside the AIO image's supervisord) then applies the
Django schema migrations on container start.

- **Console:** SQL → select the instance for connections, backups, flags,
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the connection model, automated backups, and
password rotation.

### C. Redis (NFS-VM-hosted)

Plane uses a single `REDIS_URL` for both the Django cache and the Celery
result backend. With `enable_redis = true` and no explicit `redis_host`,
the Foundation resolves Redis to the shared NFS VM's IP (co-located
service), injected at runtime via `$(NFS_SERVER_IP)` and resolved by the
wrapper entrypoint before it composes `REDIS_URL`.

- **Console:** Compute Engine → VM instances (the NFS/Redis VM); Filestore →
  Instances.
- **CLI:**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'REDIS_HOST|REDIS_URL'
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

See [App_GKE](App_GKE.md) for how `enable_redis`/`redis_host` resolution and
the shared NFS/Redis VM are managed.

### D. RabbitMQ broker (in-cluster additional service)

Plane's Celery `worker` and `beat` processes require an AMQP broker. This
module deploys RabbitMQ as a separate in-cluster **Deployment** (via
`additional_services`, name `mq`, image `rabbitmq:3.13-management-alpine`),
reachable only inside the cluster (`INGRESS_TRAFFIC_INTERNAL_ONLY`) on port
5672. App_GKE names the Kubernetes Service
`<service_name>-mq`; the wrapper entrypoint composes `AMQP_URL` from the
static `plane`/`plane`/vhost-`plane` credentials and this DNS name.

- **Console:** Kubernetes Engine → Workloads / Services & Ingress → filter
  for the `-mq` suffix.
- **CLI:**
  ```bash
  kubectl get deploy,svc -n "$NAMESPACE" -l app~mq 2>/dev/null || kubectl get deploy,svc -n "$NAMESPACE" | grep -- '-mq'
  kubectl logs -n "$NAMESPACE" deploy/<service-name>-mq --tail=50
  kubectl exec -n "$NAMESPACE" deploy/<service-name>-mq -- rabbitmqctl list_queues
  ```

See [App_GKE](App_GKE.md) for how `additional_services` provisions sidecar
Deployments and Services.

### E. Cloud Storage & object storage (TODO)

A dedicated **Cloud Storage** bucket (suffix `storage`) is provisioned
automatically, and `AWS_S3_*` environment variables point Plane at
`storage.googleapis.com`. However, GCS's S3-interoperability layer needs
HMAC keys that this module does not provision, so **file uploads do not
work out of the box** — see the Overview section above for the fix.

- **Console:** Cloud Storage → Buckets → filter for `-storage`.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep AWS_S3
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### F. Secret Manager

Two Plane secrets are generated automatically and stored in Secret Manager:
`SECRET_KEY` (Django, 50-char) and `LIVE_SERVER_SECRET_KEY` (real-time live
server auth, 40-char). The database password is managed separately by the
foundation. On GKE, secrets are projected into pods via the Secret Store
CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~plane"
  gcloud secrets versions access latest --secret=<secret-key-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and
rotation.

### G. Networking & ingress

By default the workload is exposed through an external Cloud Load
Balancing IP (`service_type = LoadBalancer`, `reserve_static_ip = true`),
and a custom domain with a Google-managed certificate is enabled by
default (`enable_custom_domain = true`) once `application_domains` is
populated.

- **Console:** Network services → Load balancing; VPC network → IP
  addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### H. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to
Cloud Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Plane Application Behaviour

- **First-deploy database setup.** The `db-init` job runs `db-init.sh`
  (`postgres:15-alpine`). It waits for Cloud SQL to accept connections,
  idempotently creates the application role and database (`GRANT`s the
  role to `postgres` so ownership can be set), grants schema privileges,
  then signals the Cloud SQL Auth Proxy sidecar to shut down
  (`quitquitquit`).
- **Schema migration happens inside the AIO image on every start, not as a
  separate job.** Plane's own bundled `migrator` step runs under
  supervisord before api/worker/beat/web start — there is no dedicated
  `plane-migrate` Kubernetes Job.
- **Connection-string composition happens in the wrapper entrypoint, not
  Django itself.** The AIO image's `start.sh` expects single URLs
  (`DATABASE_URL`, `REDIS_URL`, `AMQP_URL`); the platform instead injects
  discrete `DB_*`/`REDIS_*`/`RABBITMQ_*` values, so `scripts/entrypoint.sh`
  composes all three URLs (handling the Cloud SQL socket-vs-TCP remap and
  the `$(NFS_SERVER_IP)`/`$(PLANE_MQ_HOST)` placeholder cases) before
  `exec`-ing `/app/start.sh`.
- **`/god-mode` admin route requires a Caddyfile patch.** The bundled admin
  ("god-mode") SPA's router basename is `/god-mode/` (with a trailing
  slash); the entrypoint idempotently inserts a 308 redirect from the
  slash-less `/god-mode` into `/app/proxy/Caddyfile` so the "Get started"
  link in the web app doesn't render a blank loading spinner.
- **No separate first-run admin bootstrap job.** Plane's own signup/login
  flow creates the first workspace owner interactively through the web UI
  on first visit; there is no auto-generated admin credential documented in
  source. <!-- TODO: verify whether Plane AIO ships any auto-provisioned admin account -->
- **Health path.** Both startup and liveness probes default to **HTTP**
  `GET /health` (startup: 30s initial delay, 10s timeout, 10s period, 30
  failures allowed — i.e. up to 5 minutes for first boot; liveness: 30s
  initial delay, 10s timeout, 30s period, 3 failures), configured via the
  `startup_probe`/`liveness_probe` variables consumed by `Plane_Common`.
  <!-- TODO: verify /health is served without auth on the AIO image's Caddy proxy -->
- **Scaling.** `min_instance_count = 1`, `max_instance_count = 3` by
  default — HPA can add replicas, but since Celery worker/beat run
  in-process inside every pod, scaling beyond 1 also multiplies scheduled
  Celery beat ticks. <!-- TODO: verify whether beat is singleton-guarded across replicas -->
- **Inspect the init job and composed connection strings:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DATABASE_URL|REDIS_URL|AMQP_URL'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform
(UIMeta `group=N`). Only settings specific to or notable for Plane are
listed; every other input is inherited from [App_GKE](App_GKE.md) with its
standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `plane` | Base name for resources. Do not change after first deploy. |
| `application_version` | `stable` | `makeplane/plane-aio-community` image tag; the upstream image has no `latest` tag, so the default is pinned. `latest` is remapped to `stable` at build time if supplied. |
| `display_name` / `description` | `Plane - Project Management` / `Plane - Open-source project management tool ...` | Platform display metadata. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `2000m` | 2 vCPU — the AIO image runs api + worker + beat + web + space + admin + live in one pod. |
| `memory_limit` | `4Gi` | 4 GiB minimum recommended given the bundled process count. |
| `min_instance_count` / `max_instance_count` | `1` / `3` | HPA range; see the Celery-beat scaling caveat in [Section 3](#3-plane-application-behaviour). |
| `container_port` | `80` | The internal Caddy reverse proxy's listen port — the only port to expose. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar (loopback) — required on GKE. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the Plane UI. |
| `workload_type` | `null` → `Deployment` | Deployment (no StatefulSet PVC by default). |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |

### Group 11 — Workload Automation

| Variable | Default | Description |
|---|---|---|
| `additional_services` | `[]` (user-supplied) | Merged with the module-injected RabbitMQ `mq` service — the RabbitMQ entry itself is **not** user-configurable through this variable; it is always appended in `plane.tf`. |
| `initialization_jobs` | `[]` → the built-in `db-init` job | Plane runs its own migrations on container start; use this variable only for *additional* tasks. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Required when `enable_redis = true` with no explicit `redis_host` — the NFS VM co-hosts Redis. Not used for Plane application file storage. |
| `nfs_mount_path` | `/mnt/nfs` | Only relevant if you mount NFS for another purpose; Plane itself does not read/write here. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | one `storage`-suffixed bucket | Created automatically for future file-upload wiring; **not currently mounted or authenticated** (see Overview TODO). |
| `gcs_volumes` | `[]` | No GCS Fuse volumes are mounted by default. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | fixed at `POSTGRES_15` by `Plane_Common` | Not user-selectable; `database_type` on this module is an inert mirrored Foundation variable. |
| `db_name` | `plane_db` | Database name, passed to `Plane_Common` and on to the Foundation. |
| `db_user` | `plane_user` | Application database user; password auto-generated in Secret Manager. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Enabled by default (unlike most modules); takes effect once `application_domains` is populated. |
| `application_domains` | `[]` | Custom hostnames + managed certificate. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `network_tags` | `["nfsserver"]` | Required for NFS/Redis-VM connectivity — do not remove. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Required for Plane's Celery task queue and cache; cannot be effectively disabled (the entrypoint always builds a `REDIS_URL`). |
| `redis_host` | `""` → NFS server IP | Leave blank to use the shared NFS/Redis VM. |
| `redis_port` | `6379` | Standard Redis port. |

<!-- TODO: verify — the Redis variables above and the Cloud Armor variables
(enable_cloud_armor, admin_ip_ranges, cloud_armor_policy_name, enable_cdn)
both carry UIMeta group=21 with overlapping order numbers in
Plane_GKE/variables.tf; this looks like an unresolved group-numbering
collision rather than an intentional shared group. -->

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest
way to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `web_url` | URL for the Plane web UI — external LoadBalancer IP if available, otherwise the internal cluster URL. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup (`db-init`) and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD GitHub details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_GKE](App_GKE.md) foundation engine, which validates
> values *and combinations* at plan time — a `StatefulSet` forced alongside
> a stateless setting, IAP with no authorized identities,
> `quota_memory_*` given as bare integers, an out-of-range
> `container_port`/`backup_retention_days`. Invalid configuration fails the
> **plan** with a clear, named error before any resource is created, so
> most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| RabbitMQ presence | Never remove the `mq` additional service | Critical | Plane's `start.sh` refuses to start with an empty `AMQP_URL`; the whole app crash-loops. |
| `enable_redis` | `true` | Critical | Plane's Celery cache/queue backend has no connection without a Redis URL — worker/beat and cache fail. |
| `db_name` / `db_user` | Set once | Critical | Renaming after first deploy points Plane at a nonexistent (or different) database and orphans all data. |
| `SECRET_KEY` / `LIVE_SERVER_SECRET_KEY` (auto-generated) | Never change | Critical | Changing them after first boot invalidates signed sessions and live-server auth tokens. |
| File uploads / `AWS_S3_*` | Supply real S3-compatible HMAC credentials | High | Without real credentials, uploads (attachments, avatars, cover images) silently fail — the placeholder wiring is not production-ready. |
| RabbitMQ storage | Attach a PVC/NFS if durability matters | High | The default `mq` service uses ephemeral pod storage; a pod restart or node preemption drops queued Celery jobs. |
| `max_instance_count` | `3` (verify Celery beat behaviour before raising further) | Medium | Because beat runs inside every pod, scaling out may duplicate scheduled task ticks. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for DB connectivity on GKE; disabling it breaks `DATABASE_URL` composition. |
| `network_tags` | keep `nfsserver` | High | Removing it breaks connectivity to the NFS/Redis VM, silently reverting Redis to an unreachable host. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and `WEB_URL`/`DOMAIN_NAME`. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Plane-specific application configuration shared
with the Cloud Run variant (all-in-one image wiring, secrets, RabbitMQ
credentials, storage TODO) is described in
**[Plane_Common](Plane_Common.md)**.
