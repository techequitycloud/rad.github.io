---
title: "Beszel on Google Cloud Run"
description: "Configuration reference for deploying Beszel on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Beszel on Google Cloud Run

Beszel is a lightweight, open-source server-monitoring hub — historical resource
metrics, Docker container stats, and configurable alerts, built on PocketBase (Go
plus an embedded SQLite database). This module deploys the Beszel hub on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Beszel uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Beszel runs as a single Go container on Cloud Run v2, serving its web UI and REST
API on port 8090. It keeps all state in an embedded SQLite database under
`/beszel_data`, which is FUSE-mounted from a Cloud Storage bucket. The deployment
wires together a deliberately small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single Go container, 1 vCPU / 1 GiB by default, port 8090 |
| Database | **None** | Beszel embeds its own PocketBase/SQLite DB — no Cloud SQL is provisioned |
| Object storage | Cloud Storage | One data bucket, GCS FUSE-mounted at `/beszel_data` for all persistence |
| Cache & queue | **None** | Beszel does not use Redis; `enable_redis` is forced off |
| Secrets | Secret Manager | No app secrets injected — the first admin is created in the UI |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL (`ingress_settings = "all"`); optional external HTTPS LB + custom domain |

**Sensible defaults worth knowing up front:**

- **No database, no Redis.** Beszel is self-contained — `database_type = "NONE"`,
  `enable_cloudsql_volume = false`, and `enable_redis = false`. All state is the
  embedded SQLite database under `/beszel_data`.
- **Persistence is a GCS FUSE bucket.** The Cloud Storage data bucket is mounted at
  `/beszel_data`, so the SQLite database and historical metrics survive revision
  replacement and scale events. Deleting the bucket destroys all monitoring history.
- **Single instance is deliberate.** `min_instance_count = max_instance_count = 1`.
  Beszel is a single-writer app (one SQLite file); running more than one instance
  against the same FUSE-mounted database risks lock contention and corruption. Do
  **not** raise `max_instance_count`.
- **`min_instance_count = 1` (no scale-to-zero).** The hub is kept warm so the SQLite
  database stays open and agents can report continuously; this is a monitoring
  backend, not a bursty request/response app.
- **Port 8090.** Beszel's hub listens on 8090; the container port and probes are set
  accordingly.
- **Public ingress by default.** `ingress_settings = "all"` exposes the `run.app`
  URL so remote agents and browsers can reach the hub. Enabling IAP will block agent
  reporting from machines that cannot present a Google identity.
- **Health path `/api/health`.** Startup and liveness probes hit the hub's public,
  unauthenticated health endpoint (200 when ready).
- **The initial admin is created in the UI.** No admin password is stored in Secret
  Manager; open the hub after deploy and complete PocketBase's first-run superuser
  setup.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Beszel service

Beszel runs as a Cloud Run v2 service. Each deployment creates an immutable
revision; because the app is single-writer, the service is pinned to exactly one
instance rather than autoscaling.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~beszel"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud Storage — the `/beszel_data` volume

A single Cloud Storage bucket holds Beszel's entire state (the SQLite database,
uploaded config, and historical metrics). The foundation grants the workload
service account access and mounts the bucket as a **GCS FUSE** volume at
`/beszel_data` (requires the `gen2` execution environment, which is the default).

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~beszel"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

> **Caution:** This bucket **is** the database. Do not delete it or clear its
> objects — doing so erases all monitoring history and the admin account. See
> [App_CloudRun](App_CloudRun.md) for GCS FUSE and CMEK options.

### C. Secret Manager

Beszel injects **no** application secrets — there is no encryption key, JWT secret,
or database password to manage (the DB is embedded SQLite, and the admin is created
in the UI). A secret listing shows only whatever the foundation itself creates.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~beszel"
  ```

See [App_CloudRun](App_CloudRun.md) for how secret env vars would be injected if you
add any via `secret_environment_variables`.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = "all"`),
which allows the remote agents to POST their metrics to the hub. An external HTTPS
load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies. (Note that Beszel itself is a
monitoring product — the GCP monitoring here observes the *hub*, not the machines
Beszel watches.)

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Beszel Application Behaviour

- **No init job; schema is self-managed.** Beszel creates and migrates its embedded
  PocketBase/SQLite database automatically on first boot (and on every version
  upgrade). There is no `db-init` job because there is no external database.
- **State lives in the FUSE bucket.** Everything under `/beszel_data` — the SQLite
  database, config, and historical metrics — is persisted to the Cloud Storage data
  bucket. Revisions and restarts reuse the same bucket, so history survives.
- **First-run setup is in the UI.** Open the service URL and complete PocketBase's
  first-run superuser (admin) account creation. There is no auto-generated admin
  credential in Secret Manager. After creating the admin, add the systems you want
  to monitor and install the Beszel agent on each (the hub shows the agent install
  command and public key).
- **Single writer — do not scale out.** With one SQLite file behind a GCS FUSE
  mount, only one instance may write. `min = max = 1` is enforced by intent; a
  plan-time guard also rejects `min_instance_count > max_instance_count`.
- **Health path.** Startup and liveness probes target `/api/health`, which returns
  `200` once the hub is ready. Inspect the running revision and its env/mounts:
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```
- **Kept warm.** `min_instance_count = 1` avoids cold starts so agents report
  continuously and the SQLite database stays open.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Beszel are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `beszel` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Beszel image tag. `latest` resolves the base image to the pinned `0.9.1`; set an explicit tag (e.g. `0.9.1`) to control upgrades. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance; Beszel is lightweight, 1 vCPU is ample. |
| `memory_limit` | `1Gi` | Memory per instance; 512 Mi–1 Gi is typical (gen2 floor is 512 Mi). |
| `min_instance_count` | `1` | Kept at 1 — one SQLite writer, no scale-to-zero. |
| `max_instance_count` | `1` | **Do not increase.** More than one instance corrupts the shared SQLite database. |
| `container_port` | `8090` | Beszel's hub listens on 8090. |
| `execution_environment` | `gen2` | Required for the GCS FUSE `/beszel_data` mount. |
| `enable_image_mirroring` | `true` | Mirror the Beszel image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` lets remote agents reach the hub. `internal` blocks off-VPC agent reporting. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks agents that cannot present a Google identity.** |

### Group — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is off; Beszel persists to the GCS FUSE data bucket, not NFS. |
| `gcs_volumes` | `[]` | Extra GCS Fuse mounts beyond the `/beszel_data` data bucket (requires gen2). |
| `create_cloud_storage` | `true` | Provision the declared storage bucket(s). |

### Group — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Beszel has no external database — leave as `NONE`. |
| `enable_cloudsql_volume` | `false` | No Cloud SQL Auth Proxy; Beszel uses embedded SQLite. |

### Group — Redis Cache & Queue

Beszel does not use Redis. `enable_redis` is not exposed as a variable on this module — the
wrapper's `main.tf` hardcodes `enable_redis = false` in its call to `App_CloudRun` (whose
own default is `true`), so there is nothing to configure here.

### Group — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health` 15s delay | Startup probe; 10-retry window for first-boot schema creation. |
| `liveness_probe` | HTTP `/api/health` 30s delay | Liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/api/health" }` | Optional Cloud Monitoring uptime check against the hub. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `beszel_url` | Service URL for the Beszel hub UI/API. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (the `/beszel_data` data bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any setup jobs (none by default). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, a `gen1` runtime with GCS mounts, an out-of-range `backup_retention_days`, `min_instance_count > max_instance_count`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| Storage data bucket | Never delete or clear | Critical | The bucket **is** the SQLite database — deleting it erases all monitoring history and the admin account. |
| `max_instance_count` | `1` | Critical | Running >1 instance against the shared FUSE-mounted SQLite database causes lock contention and database corruption. |
| `enable_cloudsql_volume` / `database_type` | `false` / `NONE` | High | Beszel has no external DB; enabling Cloud SQL provisions an unused instance and misconfigures startup. |
| `execution_environment` | `gen2` | High | `gen1` cannot mount the GCS FUSE `/beszel_data` volume, so state is not persisted. |
| `ingress_settings` | `all` | High | `internal` blocks agents outside the VPC from reporting to the hub. |
| `enable_iap` | only for the UI, never with off-Google agents | High | IAP blocks all unauthenticated requests, including agent metric reporting. |
| `min_instance_count` | `1` | Medium | Scale-to-zero (`0`) drops the warm SQLite writer and interrupts continuous agent reporting; also blocked by the min/max guard when set above `max`. |
| `container_port` | `8090` | Medium | The hub listens only on 8090; changing it without matching the image breaks the probes and ingress. |
| `application_version` | pin explicitly | Medium | `latest` resolves the base image to the pinned `0.9.1`; pin a real tag to control upgrades and avoid surprise schema migrations. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Beszel-specific application configuration shared
with the GKE variant is described in **[Beszel_Common](Beszel_Common.md)**.
