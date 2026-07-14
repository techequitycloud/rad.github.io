---
title: "ActualBudget on Google Cloud Run"
description: "Configuration reference for deploying ActualBudget on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# ActualBudget on Google Cloud Run

Actual Budget is a privacy-first, local-first personal finance application built around zero-based envelope budgeting. The `actual-server` component is a lightweight Node.js sync server that stores each budget as a SQLite file and synchronises it across the web UI, desktop, and mobile clients. This module deploys the Actual Budget server on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services ActualBudget uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run application — service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

ActualBudget runs as a single Node.js container on Cloud Run v2. Because it manages its own SQLite storage, the deployment wires together a deliberately small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 1 vCPU / 1 GiB by default, single instance (`min = max = 1`) |
| Database | None | ActualBudget keeps budget data in SQLite files — `database_type = "NONE"`, no Cloud SQL |
| Persistent data | Cloud Storage (GCS FUSE) | A dedicated `storage` bucket mounted at `/data` holds the SQLite budget files and user files |
| Container image | Artifact Registry + Cloud Build | Thin-wrapper build of `actualbudget/actual-server`, mirrored into your registry |
| Secrets | Secret Manager | Optional — a pre-provisioned API token (`enable_api_key`), off by default |
| Ingress | Cloud Run URL / Cloud Load Balancing | **Defaults to `internal`** — flip to `all` or front with a load balancer for browser access |

**Sensible defaults worth knowing up front:**

- **No external database.** ActualBudget persists everything as SQLite files under `/data`; there is no Cloud SQL instance, no `db-init` job, no Redis (`enable_redis = false`), and no Cloud SQL Auth Proxy sidecar.
- **A `storage` GCS bucket is provisioned automatically** by `ActualBudget_Common` and mounted at `/data` via GCS FUSE (`enable_gcs_storage_volume = true`). `ACTUAL_SERVER_FILES = /data/server-files` and `ACTUAL_USER_FILES = /data/user-files` point both persistence subtrees at that mount so nothing lands on ephemeral container disk.
- **Single instance by design.** `min_instance_count = 1` and `max_instance_count = 1` — the server serves one shared set of SQLite files from one volume; running multiple replicas risks write conflicts.
- **Ingress defaults to `internal`.** The service is not reachable from the public internet until you set `ingress_settings = "all"` (or add a load balancer) — a deliberately private default for a personal-finance workload.
- **No generated secrets by default.** The server password is set interactively on the first-run onboarding screen. The only optional secret is a 32-character API token (`enable_api_key = true`) injected as `ACTUAL_TOKEN`.
- **Version pinning.** The Dockerfile reads an app-specific `ACTUALBUDGET_VERSION` build ARG; `application_version = "latest"` pins the build to `25.7.1`.
- **Health probes target `/`** — the server answers its root path with HTTP 200 as soon as it is listening, no authentication required.
- **Best suited to single-user / light use on Cloud Run.** SQLite over GCS FUSE does not tolerate heavy concurrent writes; for durable production storage prefer the ActualBudget_GKE variant with a block PVC.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the ActualBudget service

ActualBudget runs as a Cloud Run v2 service pinned to a single instance. Each deployment creates an immutable revision; traffic shifts to the newest healthy revision on update.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~actualbudget"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and traffic splitting.

### B. Cloud Storage — the persistent data tier

All ActualBudget state — the SQLite budget databases, server files, and per-file user data — lives on a dedicated **Cloud Storage** bucket mounted into the container at `/data` via **GCS FUSE** (gen2 execution environment required). The bucket survives revision rollouts, restarts, and re-deploys; it is the only place budget data exists, so treat it as the thing to protect and back up.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~actualbudget"
  gcloud storage ls -r gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse mount behaviour and CMEK.

### C. Artifact Registry & Cloud Build — the container image

`ActualBudget_Common` ships a thin-wrapper Dockerfile (`FROM actualbudget/actual-server:${ACTUALBUDGET_VERSION}`) that Cloud Build builds into your project's Artifact Registry repository — so deploys pull from your registry, not Docker Hub, and are compatible with Binary Authorization.

- **Console:** Artifact Registry → Repositories; Cloud Build → History.
- **CLI:**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
  ```

### D. Secret Manager — optional API token

By default no secrets are created. When `enable_api_key = true`, a 32-character random token is generated, stored in Secret Manager as `secret-<prefix>-<app>-api-key`, and injected into the service as the `ACTUAL_TOKEN` secret environment variable — useful for automations that must call the server before the UI is configured.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service defaults to `ingress_settings = "internal"`, so only traffic from inside the project's VPC can reach it. For browser access, either set `ingress_settings = "all"` (the run.app URL becomes publicly reachable), or use `internal-and-cloud-load-balancing` with a custom domain, Cloud CDN, Cloud Armor, and optionally IAP in front.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  # Tunnel to an internal-only service from your workstation:
  gcloud run services proxy <service-name> --region "$REGION" --port 8080
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring. An uptime check can be enabled via `uptime_check_config` (off by default — it requires a publicly reachable endpoint, which the `internal` ingress default does not provide).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. ActualBudget Application Behaviour

- **No initialization job.** There is no database to bootstrap; the server creates its SQLite files under `/data` on first boot. Custom `initialization_jobs` are accepted for data loading or migration tasks but none is provided by default.
- **First-run setup.** On first access the web UI shows an onboarding screen where you set the **server password** — there are no pre-seeded credentials to retrieve. Do this immediately after making the service reachable; until a password is set, anyone who can reach the URL can claim the server.
- **Data layout.** `ACTUAL_SERVER_FILES = /data/server-files` (server metadata and the account database) and `ACTUAL_USER_FILES = /data/user-files` (the per-budget sync data). Both live on the GCS FUSE mount, so budget data survives restarts and redeploys.
- **Local-first sync model.** Clients (web, desktop, mobile) keep a full local copy of the budget and use the server only to synchronise encrypted changes between devices — brief server unavailability does not block working in a client.
- **Single-writer constraint.** The server assumes exclusive access to its SQLite files. Keep `max_instance_count = 1`; a plan-time validation enforces `min_instance_count <= max_instance_count`.
- **Version updates.** Change `application_version` and re-apply — Cloud Build produces a new image and Cloud Run rolls a new revision. `latest` builds the pinned `25.7.1`.
- **Health endpoint.** Startup and liveness probes issue `GET /`, which returns HTTP 200 unauthenticated as soon as the HTTP server is listening.
- **Verification:**
  ```bash
  SERVICE=$(gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~actualbudget" --format="value(metadata.name)" --limit=1)
  SERVICE_URL=$(gcloud run services describe "$SERVICE" \
    --project "$PROJECT" --region "$REGION" --format="value(status.url)")
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200 (403/404 while ingress=internal)
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for ActualBudget are listed; every other input is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

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

All other inputs follow standard App_CloudRun behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `actualbudget` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Image version tag; `latest` builds the pinned `25.7.1`. Increment to trigger a new build and revision. |
| `enable_api_key` | `false` | Generate a 32-char API token in Secret Manager and inject it as `ACTUAL_TOKEN`. Recommended when the service is reachable outside the VPC. |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | actual-server is a lightweight Node.js process; 1 vCPU suffices. |
| `memory_limit` | `1Gi` | Modest memory is enough for typical budget files. |
| `min_instance_count` | `1` | Keeps the single instance warm. Set `0` for scale-to-zero if a cold start on first request is acceptable. |
| `max_instance_count` | `1` | **Keep at 1** — one shared SQLite volume, one writer. |
| `container_port` | `5006` | actual-server's native HTTP port. |
| `execution_environment` | `gen2` | Required for the GCS FUSE `/data` mount. |
| `enable_cloudsql_volume` | `false` | No Cloud SQL — leave `false`. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `internal` | Private by default. Set `all` for public browser access, or `internal-and-cloud-load-balancing` behind an HTTPS load balancer. |
| `enable_iap` | `false` | Add Google-identity authentication in front of the UI (load-balancer path). |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra plain env vars. `ACTUAL_PORT`, `ACTUAL_SERVER_FILES`, and `ACTUAL_USER_FILES` are injected automatically. |
| `secret_environment_variables` | `{}` | Extra Secret Manager references. The `ACTUAL_TOKEN` secret is wired automatically when `enable_api_key = true`. |

All other inputs follow standard App_CloudRun behaviour.

### Groups 7–10 — Backup, CI/CD, Custom SQL, Domain & CDN

Standard App_CloudRun behaviour — see [App_CloudRun](App_CloudRun.md). Note that the Custom SQL inputs (group 9) are inert for ActualBudget since there is no Cloud SQL instance.

### Group 11 — Cloud Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | The `storage` data bucket is always declared by `ActualBudget_Common`. |
| `gcs_volumes` | `[]` | Additional GCS FUSE mounts; the `/data` storage mount is added automatically. |
| `enable_nfs` | `false` | Not needed — persistence is on the GCS bucket. |

All other inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed to `NONE` by `ActualBudget_Common` — ActualBudget has no SQL database. |

All other inputs in this group are forwarded for compatibility but not referenced.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No default job. Supply your own only for custom data loading/migration. |
| `cron_jobs` | `[]` | Recurring jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 15 s initial delay, 10 failures | Passes as soon as the Node server is listening. |
| `liveness_probe` | HTTP `/`, 30 s initial delay, period 30 s | Root path, unauthenticated. |
| `uptime_check_config` | disabled | Enable only once the endpoint is publicly reachable (ingress `all` or a load balancer). |

All other inputs follow standard App_CloudRun behaviour.

### Group 23 — VPC Service Controls & Audit Logging

`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `organization_id`, `enable_audit_logging` — standard App_CloudRun behaviour; see [App_CloudRun](App_CloudRun.md).

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `actualbudget_url` | The service's `run.app` URL. Reachable only from inside the VPC while `ingress_settings = "internal"`. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (includes the `/data` storage bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any custom setup jobs (empty by default). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

The module ships plan-time validation for the most damaging misconfigurations (for example `min_instance_count <= max_instance_count`), but several settings deserve explicit care:

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | Multiple instances write the same SQLite files on one shared volume — corruption/conflict risk. |
| First-run server password | set immediately | Critical | Until a password is set, anyone who can reach the URL can claim the server and its budget data. |
| Storage bucket contents | never delete manually | Critical | `/data` on the GCS bucket is the only copy of the budget databases; deleting the bucket erases all budgets. |
| `container_port` | `5006` | Critical | actual-server's native port; mismatching it causes all health probes to fail. |
| `execution_environment` | `gen2` | High | GCS FUSE volume mounts require gen2; gen1 leaves `/data` unmounted and data on ephemeral disk. |
| `ingress_settings` | `internal` until hardened | High | Flipping to `all` before setting the server password exposes an unclaimed server publicly. |
| Heavy multi-user write load | move to ActualBudget_GKE (block PVC) | High | SQLite does not tolerate GCS FUSE under heavy concurrent write; Cloud Run suits single-user / light use. |
| `enable_api_key` | `true` for automation on a public endpoint | Medium | Without `ACTUAL_TOKEN`, programmatic API access relies solely on the server password. |
| `min_instance_count` | `1` (or `0` to save cost) | Medium | `0` adds a cold start to the first request after idle; data is safe either way (state is on GCS). |
| `uptime_check_config` | enable once public | Low | While ingress is `internal` the check cannot reach the service and will always fail. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. ActualBudget-specific application configuration shared with the GKE variant is described in **[ActualBudget_Common](ActualBudget_Common.md)**.
