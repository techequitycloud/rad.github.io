---
title: "Changedetection on Google Cloud Run"
description: "Configuration reference for deploying Changedetection on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Changedetection on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Changedetection_CloudRun.png" alt="Changedetection on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

changedetection.io is a self-hosted, open-source service that monitors web pages for
changes and sends notifications when they occur. This module deploys changedetection.io
on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services changedetection.io uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load balancing,
scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

changedetection.io runs as a single Python/Flask container on Cloud Run v2. The
deployment wires together a deliberately small set of Google Cloud services — there is
no database and no cache:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Python/Flask service, 1 vCPU / 1 GiB by default, listens on port 5000 |
| Database | _None_ | `database_type = NONE` — changedetection.io stores all state on disk, not in SQL |
| Persistent datastore | Cloud Storage (GCS FUSE) | One data bucket mounted at `/datastore` holding watch config, snapshots, and history |
| Cache & queue | _None_ | Redis is not used; explicitly disabled |
| Secrets | Secret Manager | No app secret is injected; the REST API token is created in the web UI |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No database, no Redis.** changedetection.io is entirely self-contained. There is no
  Cloud SQL instance, no `db-init` job, and no schema migration step. Redis is disabled
  (`enable_redis = false`) and `enable_cloudsql_volume = false`.
- **All state lives in one GCS bucket.** The datastore bucket is mounted at `/datastore`
  via GCS FUSE (`enable_gcs_storage_volume = true`, requires the gen2 execution
  environment). Deleting or recreating this bucket loses every watch and its history.
- **Single instance by default.** `min_instance_count = 1` and `max_instance_count = 1`.
  changedetection.io runs its fetch scheduler in-process against a single on-disk
  datastore; running more than one instance against the same FUSE-mounted datastore
  risks concurrent-write corruption. Keep `max_instance_count = 1`.
- **`min_instance_count = 1` (no scale-to-zero).** The single instance is kept warm so
  the fetch scheduler continues to run watch checks even with no inbound web traffic.
- **Public ingress by default.** `ingress_settings = "all"` so the web dashboard is
  reachable from a browser. The UI ships with **no login** — set a password in
  **Settings → General** immediately, and/or enable IAP.
- **`BASE_URL` is injected automatically.** The predicted Cloud Run service URL is
  injected under `BASE_URL` (`service_url_env_var_name = "BASE_URL"`) so notification
  links resolve to the real service address.
- **Version pinning.** With `application_version = "latest"` the image build pins a
  known-good tag (`0.50.19`) via the app-specific `CHANGEDETECTION_VERSION` build arg.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the changedetection.io service

changedetection.io runs as a Cloud Run v2 service listening on port 5000. Each
deployment creates an immutable revision; traffic can be split across revisions for
safe rollouts. Because the fetch scheduler runs in-process, the service is normally
pinned to a single always-warm instance.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Database — not used

changedetection.io uses **no SQL database**. `database_type = NONE` is fixed by
[Changedetection_Common](Changedetection_Common.md); no Cloud SQL instance is created
and there is no `db-init` initialization job. All persistent state lives in the GCS
datastore bucket described below.

### C. Cloud Storage — the datastore

A single **Cloud Storage** bucket is provisioned automatically and mounted at
`/datastore` as a **GCS FUSE** volume (`DATASTORE_PATH = /datastore`). It holds the
watch configuration JSON, page snapshots, and change history — everything the app
persists.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  gcloud storage ls gs://<data-bucket>/url-watches.json
  ```

GCS FUSE requires the gen2 execution environment (the default). See
[App_CloudRun](App_CloudRun.md) for GCS FUSE and CMEK options.

### D. Cache & queue — not used

changedetection.io does not use Redis or any external queue; its watch scheduler is
in-process. `enable_redis = false` is set explicitly and no Redis inputs are wired.

### E. Secret Manager

No application secret is injected into the container — the optional REST API token is
generated inside the web UI (**Settings → API**), and the datastore uses no encryption
key. Secret Manager is still available for any operator-supplied
`secret_environment_variables`.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = "all"`),
which allows public browser access to the dashboard. An external HTTPS load balancer
with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings
and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring, with
optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. changedetection.io Application Behaviour

- **No first-deploy database setup.** There is no database and no init job. On first
  boot changedetection.io creates its datastore files (`url-watches.json` and per-watch
  history directories) under `/datastore` if they do not already exist.
- **No schema migrations.** Datastore format upgrades are handled internally by the
  application on start; there is no separate migration step to run.
- **The datastore is the only stateful asset.** Everything the app remembers — watches,
  snapshots, diff history, notification config, and any UI password — lives in the GCS
  datastore bucket. Protect it accordingly; recreating the bucket wipes all state.
- **No login by default.** The dashboard ships open. Set a password under
  **Settings → General → Password** immediately after first access, and/or enable IAP
  in front of the service. There is no default admin account or credential.
- **REST API token is created in the UI.** To use the REST API, generate a token under
  **Settings → API** and pass it as the `x-api-key` header. It is not injected via an
  environment variable.
- **`BASE_URL` for notification links.** The predicted service URL is injected under
  `BASE_URL` so notification bodies contain working absolute links. Verify it matches
  the real service URL after deploy:
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Health path.** Startup and liveness probes target `/` — the web UI, which returns
  HTTP 200 once the Flask server is ready. First boot is fast (no migrations); the
  default startup probe allows a 15-second initial delay plus a 10-retry window.
- **Scaling constraint.** Keep `max_instance_count = 1`. Multiple instances share the
  same FUSE-mounted datastore and would race on writes; the app has no distributed
  coordination.
- **Inspect the running environment:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for changedetection.io are listed; every other input is inherited
from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `resource_labels` | `{}` | Labels applied to all resources. |

All other inputs follow standard App_CloudRun behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `changedetection` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Changedetection.io` | Human-readable name shown in the Console. |
| `description` | `changedetection.io — self-hosted website change detection and monitoring/notification service` | Service description. |
| `application_version` | `latest` | Image version tag. `latest` pins the build to `0.50.19` via `CHANGEDETECTION_VERSION`; pin explicitly for reproducible deploys. |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `1Gi` | Memory per instance (gen2 floor is 512Mi). |
| `min_instance_count` | `1` | Keeps one instance warm so the fetch scheduler keeps running. |
| `max_instance_count` | `1` | **Keep at 1** — multiple instances race on the shared datastore. |
| `container_port` | `5000` | changedetection.io listens on port 5000. |
| `execution_environment` | `gen2` | Required for the GCS FUSE datastore mount. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | No Cloud SQL — the Auth Proxy sidecar is not needed. |
| `enable_image_mirroring` | `true` | Mirror the changedetection.io image into Artifact Registry. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public browser access to the dashboard. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of the dashboard (recommended — the app has no login by default). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings (e.g. `FETCH_WORKERS`, `PLAYWRIGHT_DRIVER_URL`). `DATASTORE_PATH` and `BASE_URL` are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

All other inputs follow standard App_CloudRun behaviour.

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). Since there is no database, back up the datastore bucket. |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |

All other inputs follow standard App_CloudRun behaviour.

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB (also fixes `BASE_URL`). |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

All other inputs follow standard App_CloudRun behaviour.

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the datastore GCS bucket. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned datastore bucket. |
| `enable_nfs` | `false` | NFS is off; the datastore uses GCS FUSE. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container (when NFS is enabled). |
| `gcs_volumes` | `[]` | Extra GCS FUSE volume mounts (requires gen2). |

All other inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed to `NONE` by Changedetection_Common; changedetection.io has no SQL database. |
| `service_url_env_var_name` | `BASE_URL` | Env var name for the injected service URL. changedetection.io reads `BASE_URL` for notification links. |

All other inputs follow standard App_CloudRun behaviour.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No built-in init job — changedetection.io requires no bootstrap. Provide only for custom data loading. |
| `cron_jobs` | `[]` | Optional platform-scheduled jobs (changedetection.io schedules its own watch checks internally). |

All other inputs follow standard App_CloudRun behaviour.

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 15s delay | Startup probe against the web UI. |
| `liveness_probe` | HTTP `/` 30s delay | Liveness probe against the web UI. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

All other inputs follow standard App_CloudRun behaviour.

### Group 23 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs follow standard App_CloudRun behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `changedetection_url` | Service URL for the changedetection.io dashboard / REST API (port 5000). |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (including the datastore bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any setup jobs (empty by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, a `gen1` runtime with GCS FUSE mounts, an out-of-range `backup_retention_days`, `min_instance_count > max_instance_count`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| Datastore GCS bucket | Never delete/recreate | Critical | The bucket holds every watch, snapshot, and history entry — deleting it loses all monitoring state permanently. |
| `max_instance_count` | `1` | Critical | Multiple instances write the same FUSE-mounted datastore concurrently and corrupt `url-watches.json`; the app has no distributed locking. |
| Web UI password | Set immediately | High | The dashboard ships with **no login**; leaving it open on public ingress exposes all watches and notification config to anyone with the URL. |
| `application_name` | Set once | High | Immutable after first deploy; renaming recreates the datastore bucket and orphans existing data. |
| `enable_gcs_storage_volume` / datastore mount | Keep enabled | High | Without the `/datastore` mount, state is written to ephemeral container disk and lost on every revision/restart. |
| `execution_environment` | `gen2` | High | GCS FUSE requires gen2; `gen1` cannot mount the datastore bucket (blocked at plan time). |
| `ingress_settings` | `all` (or IAP) | High | Public ingress + no login = open dashboard. Pair `all` with a UI password or IAP; `internal` blocks browser access entirely. |
| `service_url_env_var_name` / `BASE_URL` | Real service URL | Medium | A wrong `BASE_URL` produces broken absolute links in change notifications. |
| `min_instance_count` | `1` | Medium | Scale-to-zero (`0`) stops the in-process fetch scheduler while idle, so watches are not checked until the next inbound request. |
| `enable_cloudsql_volume` / `database_type` | `false` / `NONE` | Low | changedetection.io has no database; enabling Cloud SQL wiring provisions unused infrastructure. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention of the datastore backup. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**.
changedetection.io-specific application configuration shared with the GKE variant is
described in **[Changedetection_Common](Changedetection_Common.md)**.
