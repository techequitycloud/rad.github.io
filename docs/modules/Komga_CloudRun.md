---
title: "Komga on Google Cloud Run"
description: "Configuration reference for deploying Komga on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Komga on Google Cloud Run

Komga is a free, open-source, self-hosted media server for comics, manga, and
digital book collections (Kotlin/Java, Spring Boot). It provides a clean web
reading UI, OPDS feeds, collections, read lists, and full-text search over your
library. This module deploys Komga on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Komga uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common
to every Cloud Run application — service identity, ingress and load balancing,
scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Komga runs as a single JVM container on Cloud Run v2. The deployment wires together
a minimal set of Google Cloud services — there is no external database:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | JVM (Spring Boot) container, 1 vCPU / 1 GiB by default; single instance |
| Database | None | Komga uses an embedded SQLite database under `/config` — no Cloud SQL instance is created |
| Object storage | Cloud Storage | A dedicated `storage` bucket mounted at `/config` via GCS FUSE |
| Secrets | Secret Manager | None generated — Komga has no injectable service secret |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No external database.** Komga stores its library index, users, reading
  progress, and settings in an embedded SQLite database — confirmed via upstream
  issue #1327 (open, unimplemented feature request for external DB support).
  `database_type = "NONE"`.
- **Official prebuilt image.** `container_image_source = "prebuilt"` deploys
  `gotson/komga` directly — no Cloud Build step. `enable_image_mirroring = true`
  mirrors it into Artifact Registry (digest-aware copy) to avoid Docker Hub rate
  limits.
- **Single instance only.** `min_instance_count = 1` and `max_instance_count = 1` —
  Komga serves one shared SQLite library from one volume; do not scale beyond 1.
- **`/config` is the single source of truth.** The SQLite database
  (`database.sqlite`, WAL mode), Lucene search index, thumbnail cache, and task
  queue all live under `/config` (set via the image's `KOMGA_CONFIGDIR`), backed by
  a GCS-FUSE-mounted Cloud Storage bucket on Cloud Run.
- **No generated secrets.** The admin account is created interactively through
  Komga's first-run setup wizard at `/` — there is no master key or JWT secret to
  seed ahead of time.
- **Health endpoint is `/actuator/health`.** Confirmed via local container testing
  to return `200 {"status":"UP"}` unauthenticated. The versioned
  `/api/v1/actuator/health` path is auth-gated (401) — do not point probes at it.
- **JVM heap sizing is optional.** `jvm_heap_max` (blank by default) sets `-Xmx` via
  `JAVA_TOOL_OPTIONS`; leave blank to let JVM ergonomics size the heap relative to
  `memory_limit`.
- **GCS FUSE has real latency for SQLite.** For heavier or production libraries,
  prefer `Komga_GKE`, which can mount a real block PVC instead.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Komga service

Komga runs as a Cloud Run v2 service. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud Storage — Komga's persistent state

A dedicated **Cloud Storage** bucket is mounted at `/config` via GCS FUSE. It holds
the embedded SQLite database, Lucene search index, thumbnail cache, and logs —
everything Komga persists.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### C. Secret Manager

Komga has no generated service secret — the admin account is created through the
web setup wizard. Secret Manager only holds entries you add yourself via
`secret_environment_variables`.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~komga"
  ```

### D. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on.

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

## 3. Komga Application Behaviour

- **No first-deploy database setup.** There is no `db-init` job — Komga runs its own
  Flyway schema migrations against the embedded SQLite database on first boot
  (confirmed via local container logs: `org.flywaydb.core.FlywayExecutor`,
  `Successfully validated 90 migrations`).
- **First-run setup wizard.** Open the service URL and complete the setup wizard at
  `/` to create the initial admin user — there is no seeded credential and no
  API/CLI path to create one non-interactively.
- **Add a library after first login.** Once logged in, add a "library" pointing at
  a mounted media path (see `gcs_volumes` for additional read-mostly comic/book
  storage) and trigger a scan. This is a manual operator step; no init job seeds it.
- **Health path.** Startup and liveness probes target `/actuator/health`
  (unauthenticated, `200 {"status":"UP"}` once ready). Do **not** use
  `/api/v1/actuator/health` — confirmed via local testing to return `401
  Unauthorized` even when the app is fully healthy.
- **Single shared library, single instance.** Komga's SQLite database is a single
  file on one mounted volume — running more than one instance risks concurrent
  writers corrupting it. Keep `max_instance_count = 1`.
- **JVM heap sizing.** No official memory floor is documented upstream; the module
  defaults `memory_limit = 1Gi` conservatively. For very large libraries (heavy
  Lucene index + thumbnail cache), raise `memory_limit` and optionally set
  `jvm_heap_max` to explicitly bound the JVM's `-Xmx`.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Komga are listed; every other input is
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
| `application_name` | `komga` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Komga` | Human-readable name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `latest` | Image tag, passed straight through as the `gotson/komga` tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Deploys the official `gotson/komga` image directly — no build step. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `1Gi` | Memory per instance; raise for very large libraries. |
| `min_instance_count` | `1` | Keep at `1` to avoid cold starts during the Lucene index rebuild on boot. |
| `max_instance_count` | `1` | **Do not increase** — Komga serves one shared SQLite library. |
| `container_port` | `25600` | Komga's default HTTP port. |
| `execution_environment` | `gen2` | Gen2 required for GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | Komga has no Cloud SQL — keep `false`. |
| `enable_image_mirroring` | `true` | Mirror the Komga image into Artifact Registry. |
| `jvm_heap_max` | `""` | Optional JVM `-Xmx` via `JAVA_TOOL_OPTIONS` (e.g. `"512m"`, `"1g"`). |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Declared for convention parity; not referenced by this module's deployment. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public access to the reading UI. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of Komga's own auth. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts

Not applicable — Komga has no SQL database. `enable_custom_sql_scripts` and related
variables are declared for convention parity only.

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned `storage` bucket. |
| `enable_nfs` | `false` | NFS is off by default. |
| `gcs_volumes` | `[]` | Additional GCS Fuse volume mounts — e.g. a separate read-mostly comics/books library bucket, mounted read-only. The `storage` bucket is added automatically at `/config`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

Not applicable — `database_type` is fixed to `NONE`. All database-related variables
are declared for convention parity and forwarded to the foundation with no effect.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Komga needs no default init job. |
| `cron_jobs` | `[]` | Scheduled Cloud Scheduler + Cloud Run Jobs, e.g. for library-maintenance tasks. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/actuator/health`, 15s delay | Startup probe. |
| `liveness_probe` | HTTP `/actuator/health`, 30s delay | Liveness probe. |
| `startup_probe_config` | HTTP `/actuator/health` | Alternative structured probe. |
| `health_check_config` | HTTP `/actuator/health` | Alternative structured liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/actuator/health" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 23 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `komga_url` | Internal VPC URL for the service (only reachable inside the VPC when `ingress_settings = "internal"`). |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `initialization_jobs` | Names of the setup jobs (empty by default). |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time. Most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` (never increase) | Critical | Multiple instances writing the same SQLite file concurrently risks database corruption. |
| Health probe path | `/actuator/health` | Critical | `/api/v1/actuator/health` is auth-gated (401) — using it as the probe path means the revision/pod never becomes Ready even though Komga is fully healthy. |
| `enable_gcs_storage_volume` (Common-level) | `true` on Cloud Run | Critical | Disabling it with no replacement mount means `/config` is not persisted — all library state is lost on every cold start. |
| First-run setup wizard | Complete promptly after deploy | High | An unclaimed setup wizard leaves the instance without an admin account; anyone who reaches the URL first can claim it. |
| `min_instance_count` | `1` | Medium | Scale-to-zero adds cold-start latency including a Lucene index rebuild on every cold boot. |
| `memory_limit` | `1Gi`, raise for large libraries | Medium | Undersized memory can OOM-kill during a large library scan (Lucene index + thumbnail cache held in the JVM heap). |
| `container_image_source` | `prebuilt` | Medium | Switching to `custom` with no Dockerfile in `Komga_Common/scripts` fails the build — Komga needs no custom build. |
| GCS FUSE for `/config` | Fine for light use; prefer GKE PVC for production | Low | SQLite WAL files under gcsfuse have higher latency and weaker consistency than block storage. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Komga-specific application configuration
shared with the GKE variant is described in
**[Komga_Common](Komga_Common.md)**.
