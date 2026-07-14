---
title: "Filebrowser on Google Cloud Run"
description: "Configuration reference for deploying Filebrowser on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Filebrowser on Google Cloud Run

File Browser is a lightweight, open-source web file manager written in Go — it
serves a directory tree over HTTP for browsing, uploading, editing, and sharing
files. This module deploys Filebrowser on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Filebrowser uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Filebrowser runs as a single Go container on Cloud Run v2. It is deliberately
minimal — no SQL database, no cache, no queue — so the deployment wires together a
small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single Go service, 1 vCPU / 1 GiB by default; `min = max = 1` |
| Persistent state | Cloud Storage (GCS FUSE) | One bucket mounted at `/database` holding the embedded SQLite DB |
| Database | None (embedded SQLite) | `database_type = NONE`; no Cloud SQL is provisioned |
| Cache & queue | None | Filebrowser uses no Redis |
| Secrets | Secret Manager | No app secrets generated; users live in the SQLite DB |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default ingress is **`internal`** — public access must be enabled explicitly |

**Sensible defaults worth knowing up front:**

- **State lives in an embedded SQLite file on GCS.** Filebrowser has no Cloud SQL
  database. Its users, settings, and share links are stored in
  `/database/filebrowser.db`, which is a Cloud Storage bucket mounted via GCS FUSE.
  Losing or wiping that bucket loses all Filebrowser state.
- **Single instance by design.** `min_instance_count = max_instance_count = 1`.
  SQLite on a GCS FUSE mount does not tolerate concurrent writers — running more than
  one instance risks database corruption. Keep `max = 1`.
- **Default login is `admin` / `admin`.** Filebrowser seeds this credential on first
  boot. Change it in the web UI immediately after deploy.
- **Ingress defaults to `internal`.** The service is reachable only from within the
  VPC out of the box. To expose it publicly, set `ingress_settings = "all"` or front
  it with the HTTPS load balancer (`enable_cloud_armor = true` + `application_domains`).
- **No Redis, no init job.** `enable_redis = false` and no `db-init` job runs; the
  app is ready as soon as the container starts.
- **Container port 80.** Filebrowser serves plain HTTP/1.1 on port 80
  (`container_protocol = http1`).
- **Scale-to-zero is safe but not the default.** The SQLite DB is on the persistent
  GCS volume, so a cold start reloads all state; `min = 1` is the default only to
  avoid the cold-start delay while the file index loads.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Filebrowser service

Filebrowser runs as a Cloud Run v2 service pinned to a single instance. Each
deployment creates an immutable revision; traffic can be split across revisions for
safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~filebrowser"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud Storage — persistent state (GCS FUSE)

Filebrowser has no Cloud SQL database. Its embedded SQLite database
(`/database/filebrowser.db`) lives in a dedicated **Cloud Storage** bucket mounted
into the container at `/database` via GCS FUSE (requires the `gen2` execution
environment). This bucket is the single source of truth for users, settings, and
share links.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<data-bucket>/                 # bucket name is in the Outputs
  gcloud storage ls gs://<data-bucket>/filebrowser.db   # the SQLite DB object
  ```

See [App_CloudRun](App_CloudRun.md) for GCS FUSE and CMEK options.

### C. Secret Manager

Filebrowser generates **no application secrets** — there is no encryption key or JWT
secret to manage, because all identity state lives in the SQLite database. Secret
Manager is still used by the foundation for platform-managed secrets (e.g. CI/CD
tokens if configured).

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~filebrowser"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### D. Networking & ingress

The service's ingress defaults to **`internal`** — reachable only from within the
VPC. To serve users on the public internet, set `ingress_settings = "all"`, or layer
an external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Filebrowser Application Behaviour

- **No first-deploy database setup.** There is no `db-init` job and no Cloud SQL
  instance. On first start the Filebrowser binary creates its SQLite database at
  `/database/filebrowser.db` (on the GCS FUSE mount) if it does not already exist and
  seeds the default `admin`/`admin` user.
- **State persistence.** Users, settings, and share links live entirely in
  `/database/filebrowser.db`. Because that file is on the persistent GCS bucket, it
  survives restarts, redeploys, and scale-to-zero. `FB_ROOT = /srv` is the file tree
  the app serves and manages.
- **Default credentials must be changed.** The seeded `admin`/`admin` login is
  well-known. Log in and change the password (and ideally the username) in the web UI
  immediately after the first deploy.
- **Single-writer constraint.** The embedded SQLite database does not support
  concurrent writers across instances on a GCS FUSE mount. Keep
  `max_instance_count = 1`; scaling out risks corrupting the database.
- **Health path.** Startup and liveness probes target **`/health`** — Filebrowser's
  unauthenticated health endpoint, which returns `200` as soon as the server is
  listening. Startup is fast (no migrations), so the default 15-second startup delay
  is ample:
  ```bash
  curl -s "$SERVICE_URL/health"    # 200 once the server is up
  ```
- **No Redis.** `enable_redis = false`; Filebrowser is a self-contained file manager
  with no queue or cache.
- **Inspect the running revision's env and mounts:**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Filebrowser are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `filebrowser` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `File Browser` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Filebrowser image tag. `latest` resolves to the pinned `v2.32.0` at build time; pin explicitly in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision supporting infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance; Filebrowser is lightweight. |
| `memory_limit` | `1Gi` | Memory per instance; 256Mi is ample for the Go server. |
| `min_instance_count` | `1` | `1` avoids cold-start delay while the file index loads; `0` (scale-to-zero) is safe because state is on GCS. |
| `max_instance_count` | `1` | **Keep at 1** — SQLite on GCS FUSE cannot take concurrent writers. |
| `container_port` | `80` | Filebrowser's HTTP/1.1 listener. |
| `container_protocol` | `http1` | Filebrowser serves plain HTTP/1.1. |
| `execution_environment` | `gen2` | Required for the `/database` GCS FUSE mount. |
| `enable_cloudsql_volume` | `false` | Filebrowser has no Cloud SQL; leave `false`. |
| `enable_image_mirroring` | `true` | Mirror the Filebrowser image into Artifact Registry (avoids Docker Hub rate limits). |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `internal` | **Default is VPC-only.** Set `all` for public access or `internal-and-cloud-load-balancing` behind a Load Balancer. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of Filebrowser. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `FB_DATABASE`, `FB_ROOT` are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Filebrowser uses none by default. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — **not applicable** to Filebrowser (no SQL database).
Leave at defaults.

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the Filebrowser `/database` bucket (and any extra `storage_buckets`). |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned `/database` bucket. |
| `enable_nfs` | `false` | NFS is off by default; not needed for Filebrowser. |
| `gcs_volumes` | `[]` | Extra GCS FUSE mounts. The `/database` bucket is added automatically. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

Not applicable — Filebrowser has no SQL database. `database_type` is fixed to `NONE`
by `Filebrowser_Common`, and `database_password_length`, the `db_*_env_var_name`
inputs, and password rotation are forwarded only for foundation compatibility.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No default init job. Provide jobs only for custom data loading/migration. |
| `cron_jobs` | `[]` | Optional recurring Cloud Run jobs (e.g. snapshot/maintenance tasks). |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health` 15s delay | Startup probe; Filebrowser exposes `/health` once ready. |
| `liveness_probe` | HTTP `/health` 30s delay | Liveness probe on the unauthenticated `/health` endpoint. |
| `uptime_check_config` | disabled, path `/health` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 23 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `filebrowser_url` | URL of the Filebrowser web UI (port 80). VPC-internal when `ingress_settings = internal`. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (includes the `/database` bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any init jobs (empty by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, a `gen1` runtime with GCS FUSE mounts, `min_instance_count > max_instance_count`, out-of-range timeouts. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `/database` GCS bucket | Never delete | Critical | The embedded SQLite DB lives here; deleting the bucket destroys all users, settings, and share links. |
| `admin` / `admin` (seeded login) | Change on first login | Critical | Leaving the default credential lets anyone who can reach the service take full control. |
| `max_instance_count` | `1` | High | >1 puts concurrent writers on SQLite over GCS FUSE, corrupting the database. |
| `ingress_settings` | `internal` (or `all` for public) | High | Default `internal` makes the service unreachable from the public internet; setting `all` exposes it — pair with IAP or Cloud Armor. |
| `container_port` | `80` | High | Filebrowser listens on 80; a different port makes the startup probe fail and the revision never becomes Ready. |
| `startup_probe` / `liveness_probe` path | `/health` | High | Pointing probes at an authenticated path returns 401/403 and the revision never goes Ready. |
| `enable_cloudsql_volume` | `false` | Medium | Filebrowser has no Cloud SQL; enabling adds a useless Auth Proxy sidecar. |
| `execution_environment` | `gen2` | High | `gen1` cannot mount the `/database` GCS FUSE volume, so state is not persisted. |
| `min_instance_count` | `1` (or `0`) | Medium | `0` adds a cold-start delay while the file index loads; state is safe either way. |
| `application_version` | pin in production | Medium | `latest` resolves to a pinned `v2.32.0` at build time; pin explicitly to control upgrades. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Filebrowser-specific application configuration
shared with the GKE variant is described in
**[Filebrowser_Common](Filebrowser_Common.md)**.
