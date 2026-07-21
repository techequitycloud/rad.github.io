---
title: "Saleor on GKE Autopilot"
description: "Configuration reference for deploying Saleor on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Saleor on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Saleor_GKE.png" alt="Saleor on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Saleor is an open-source, GraphQL-first headless e-commerce platform built on
Python/Django (product catalog, checkout, orders, and payment plugins, all exposed
through a GraphQL API rather than a bundled storefront). This module deploys Saleor
on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which
provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Saleor uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

Saleor runs as a custom-built container (`ghcr.io/saleor/saleor:3.23` wrapped with a
cloud entrypoint) on GKE Autopilot. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Two Kubernetes workloads: the main Saleor API (uvicorn, 2 workers + co-located Celery worker/beat) and a separate prebuilt Dashboard; 2 vCPU / 3 GiB by default on the main pod |
| Database | Cloud SQL for PostgreSQL 15 | Required — fixed by `Saleor_Common` regardless of `database_type` |
| Object storage | Cloud Storage | A dedicated `media` bucket provisioned automatically |
| Cache & broker | Redis (optional) | Backs `CACHE_URL`/`CELERY_BROKER_URL` for the co-located Celery worker |
| Secrets | Secret Manager | Auto-generated `SECRET_KEY`, `RSA_PRIVATE_KEY`, `DJANGO_SUPERUSER_PASSWORD`; database password |
| Ingress | Cloud Load Balancing | Module default `LoadBalancer`; **this project's live deployment currently runs `ClusterIP`** due to exhausted IP quota — see Notes below |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** `Saleor_Common` fixes the database engine;
  selecting any other value in `database_type` has no effect.
- **The Celery worker (order processing, webhooks, emails, scheduled tasks) runs
  co-located inside the main pod's container**, started as a background process by
  the cloud entrypoint — not a separate `additional_services` Deployment. GKE has no
  build-sharing path between the main app and a sidecar Deployment any more than
  Cloud Run does.
- **Resource sizing is pre-tuned: `2000m` CPU / `3Gi` memory.** Confirmed live on
  GKE Autopilot that smaller sizes (even `1Gi`/`2` vCPU, Autopilot-rounded to
  `2176Mi`) OOMKill under the combined load of 2 uvicorn workers + Django + Celery
  worker/beat.
- **Three secrets are generated automatically**: `SECRET_KEY`, `RSA_PRIVATE_KEY`
  (Saleor's JWT signing keypair — must never be rotated casually), and
  `DJANGO_SUPERUSER_PASSWORD`.
- **A separate, genuinely prebuilt Dashboard workload** (`ghcr.io/saleor/saleor-dashboard:3.23`)
  is deployed alongside the API as an `additional_services` entry. Its `API_URL` is
  baked into the served UI at container start, resolved from the Foundation's
  `$(GKE_SERVICE_URL)` plan-time sentinel + `/graphql/`.
- **`service_type` module default is `LoadBalancer`; this deployment currently runs
  `ClusterIP`** — an operational choice made in `config/deploy.tfvars` because this
  project's external IP quota (`IN_USE_ADDRESSES`) was exhausted at deploy time, not
  a module design decision. Flip back once IP quota is available.
- **Redis is optional and off by default** (`enable_redis = false`). When enabled
  with `redis_host` left empty, falls back to the NFS server VM's IP.
- **Health probes target `/health/`**, unauthenticated, confirmed 200 both locally
  and live.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Saleor API and Dashboard workloads

Saleor's API pods are scheduled on Autopilot, which bills for the CPU/memory the
pods actually request. The Dashboard runs as a second, independent workload (an
`additional_services` entry) serving the static admin UI bundle.

- **Console:** Kubernetes Engine → Workloads → select the workload to see pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external
  IP (when `service_type = LoadBalancer`).
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl logs -n "$NAMESPACE" deploy/<service-name>-dashboard --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Saleor stores all application data (products, orders, checkouts, users, payment
records) in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately
through the **Cloud SQL Auth Proxy** sidecar over loopback; no public IP is exposed.
On first deploy, `db-init` creates the application database and role, then
`db-migrate` (which depends on `db-init`) applies Django's schema migrations.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Storage

A dedicated **Cloud Storage** `media` bucket is provisioned automatically for
Saleor's uploaded product/media assets. The workload service account is granted
access. Additional buckets can be declared via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Redis (cache & Celery broker)

Redis is **disabled by default**. When `enable_redis = true` is set and `redis_host`
is left empty, the NFS server VM's IP is used as the Redis endpoint (requires
`enable_nfs = true`). The cloud entrypoint composes `CACHE_URL` (Redis DB `/0`) and
`CELERY_BROKER_URL` (Redis DB `/1`) from `REDIS_HOST`/`REDIS_PORT`.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the composed URLs from the running pod's env:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'CACHE_URL|CELERY_BROKER_URL'
  ```

### E. Secret Manager

Three secrets are generated automatically and stored in Secret Manager:
`SECRET_KEY` (Django's cryptographic signing key), `RSA_PRIVATE_KEY` (JWT signing
keypair for all issued access/refresh tokens), and `DJANGO_SUPERUSER_PASSWORD`
(bootstrap admin account password). The database password is managed separately by
the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload would be exposed through an external Cloud Load Balancing
IP (`service_type = LoadBalancer`). **This project's live deployment currently runs
`service_type = ClusterIP`** because the project's external IP quota
(`IN_USE_ADDRESSES`) was exhausted at deploy time — verify with `kubectl
port-forward` rather than expecting a public IP. Once quota is available, switch
back to `service_type = "LoadBalancer"` with `reserve_static_ip = true`.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 18080:8000
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available (uptime checks
require a publicly reachable endpoint).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Saleor Application Behaviour

- **First-deploy database setup.** `db-init` (`postgres:15-alpine`) idempotently
  creates the application database and role. `db-migrate` (the application image,
  `depends_on_jobs = ["db-init"]`) then runs `python3 manage.py migrate --noinput`.
  Both jobs are safe to re-run.
- **Extensions always installed.** `pg_trgm`, `unaccent`, `hstore`, and `citext` are
  installed unconditionally by `Saleor_Common`'s assembled configuration — the
  calling module's `enable_postgres_extensions`/`postgres_extensions` variables have
  no additional effect on this base set.
- **Celery worker + beat runs co-located, not as a separate workload.** Order
  processing, webhooks, emails, and scheduled tasks all run inside the main pod's
  background worker process.
- **`SECRET_KEY`, `RSA_PRIVATE_KEY`, and `DJANGO_SUPERUSER_PASSWORD` are immutable
  after first boot.** `RSA_PRIVATE_KEY` in particular signs every JWT Saleor issues —
  rotating it invalidates all active sessions. Only rotate during a planned
  maintenance window.
- **Superuser bootstrap.** The cloud entrypoint runs
  `manage.py createsuperuser --email $SALEOR_SUPERUSER_EMAIL --noinput` on every
  boot when `DJANGO_SUPERUSER_PASSWORD` is set (idempotent — a no-op once the user
  exists). `SALEOR_SUPERUSER_EMAIL` defaults to `admin@example.com` and is not
  exposed as a variable on this module — it is `Saleor_Common`'s own fixed default.
- **Health path.** Startup and liveness probes target `/health/` — Saleor's
  unauthenticated health endpoint, confirmed to return `200` as soon as the ASGI
  server accepts connections.
- **Dashboard's `API_URL` is baked in at container start**, not read dynamically —
  confirmed via the official Dashboard image's own
  `/docker-entrypoint.d/50-replace-env-vars.sh`, which sed-replaces `API_URL` into
  the built `index.html`. On GKE this uses `$(GKE_SERVICE_URL)` — the Foundation's
  plan-time sentinel resolved to the main app's actual Service URL, since
  Kubernetes does not interpolate `$(VAR)` across containers.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Saleor are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `saleor` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Maps to the `SALEOR_VERSION` build ARG (`3.23` when `latest`) and the Dashboard image's own tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "3Gi" }` | Sized for the combined uvicorn + Celery workload — see Overview. |
| `min_instance_count` | `0` | Minimum replicas (HPA minReplicas). |
| `max_instance_count` | `1` | Maximum replicas (HPA maxReplicas). |
| `container_port` | `8000` | uvicorn's bind port — must match the base image's `CMD`. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for loopback connections. |
| `enable_image_mirroring` | `true` | Mirror the built image into Artifact Registry. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings, merged on top of `Saleor_Common`'s own defaults (`ALLOWED_HOSTS`, `SALEOR_SUPERUSER_EMAIL`). Do not set `SECRET_KEY`, `RSA_PRIVATE_KEY`, or `DJANGO_SUPERUSER_PASSWORD` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | **This deployment currently overrides to `ClusterIP` in `deploy.tfvars`** due to exhausted IP quota — see Overview. |
| `workload_type` | `Deployment` (implied by `null`) | Saleor deploys as a `Deployment`; `StatefulSet` is not used. |
| `session_affinity` | `ClientIP` | Sticky routing. |
| `network_tags` | `["nfsserver"]` | Node/pod network tags; `nfsserver` is required when `enable_nfs = true`. |
| `termination_grace_period_seconds` | `30` | Seconds to wait after SIGTERM before SIGKILL — gives the Celery worker time to finish in-flight tasks. |

### Group 8 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_GKE](App_GKE.md).

### Group 11/12 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty for the built-in `db-init` → `db-migrate` pair. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs (e.g. Saleor management commands). |

### Group 13/15 — Filesystem (NFS) & Redis

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Declared but not used by Saleor's own storage path — media is served from the `media` GCS bucket. Also the source of the Redis NFS-IP fallback when `enable_redis = true` and `redis_host = ""`. |
| `enable_redis` | `false` | Enables Saleor's cache/broker over Redis. |
| `redis_host` | `""` | Falls back to the NFS server IP when `enable_nfs = true`. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 14/16 — Cloud Storage & Database

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional buckets, on top of the `Saleor_Common`-declared `media` bucket. |
| `database_type` | `POSTGRES` | Declared for convention parity; `Saleor_Common` always fixes PostgreSQL 15 regardless of this value. |
| `application_database_name` | `gkeapp` | PostgreSQL database name. Recommended override: `saleor_db`. Immutable after first deploy. |
| `application_database_user` | `gkeapp` | Application database user. Recommended override: `saleor_user`. |

### Group 19 — Custom Domain & Static IP

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisions a Gateway API resource + static IP for custom hostnames. |
| `reserve_static_ip` | `true` | Recommended once `service_type` is switched back to `LoadBalancer`. |

### Group 10/22 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health/`, 90s delay | Startup probe forwarded to `Saleor_Common` — allows time for `db-migrate` to complete first. |
| `liveness_probe` | HTTP `/health/`, 60s delay | Liveness probe forwarded to `Saleor_Common`. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Optional Cloud Monitoring uptime check — requires a publicly reachable endpoint. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 22 — VPC Service Controls & Audit Logging

Standard App_GKE VPC-SC and audit logging options — see [App_GKE](App_GKE.md).

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name (main API). |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `service_external_ip` | External LoadBalancer IP — only populated when `service_type = LoadBalancer` and a static IP is reserved; empty on this project's current `ClusterIP` deployment. |
| `service_url` | URL to reach Saleor. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (`127.0.0.1` via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (including `media`). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed API image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

The Dashboard workload's own URL is surfaced back into the main API's environment
as `SALEOR_DASHBOARD_URL` rather than as a top-level Terraform output.

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `RSA_PRIVATE_KEY` (auto-generated) | Never rotate outside a maintenance window | Critical | Rotating it invalidates every issued JWT — all active sessions must re-authenticate. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `container_resources` | `{ cpu_limit="2000m", memory_limit="3Gi" }` | High | Smaller sizes OOMKill under Autopilot's memory rounding, confirmed live for the combined uvicorn + Celery workload. |
| `service_type` | `LoadBalancer` once IP quota allows | Medium | `ClusterIP` (this project's current state) makes Saleor unreachable except via `kubectl port-forward` or from inside the cluster. |
| `enable_redis` / `redis_host` | Consistent — set both together, or neither | High | Enabling Redis without a reachable host (and without `enable_nfs` for the fallback) breaks `CACHE_URL`/`CELERY_BROKER_URL` composition. |
| `SALEOR_SUPERUSER_EMAIL` / `DJANGO_SUPERUSER_PASSWORD` | Retrieve from Secret Manager promptly | High | The bootstrap admin account is the only way in on first deploy. |
| `termination_grace_period_seconds` | ≥ 30s | Medium | Too short cuts off the Celery worker mid-task during a rolling update or scale-down. |
| `enable_iap` | only when the Dashboard/API don't need public access | High | IAP blocks unauthenticated requests to both the API and Dashboard services. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Saleor-specific application configuration shared with
the Cloud Run variant is described in **[Saleor_Common](Saleor_Common.md)**.
