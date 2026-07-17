---
title: "Chroma on Google Cloud Run"
description: "Configuration reference for deploying Chroma on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Chroma on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Chroma_CloudRun.png" alt="Chroma on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Chroma is an AI-native open-source vector database purpose-built for embeddings and
similarity search. It powers RAG pipelines, semantic search, and LangChain/LlamaIndex
workflows. This module deploys Chroma on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Chroma uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Chroma runs as a containerised vector-database service on Cloud Run v2. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 (Gen2) | 1 vCPU / 1 GiB by default; `min_instance_count = 1` to avoid index-reload cold starts |
| Data persistence | Cloud Storage (GCS FUSE) | Auto-provisioned `<prefix>-data` bucket mounted at `/data`; primary storage backend |
| Auth token | Secret Manager | Optional API token — `CHROMA_SERVER_AUTHN_CREDENTIALS` injected at runtime |
| Ingress | Cloud Run internal URL | `ingress_settings = "internal"` by default; optional HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No SQL database and no Redis.** Chroma manages its own embedded storage. No Cloud SQL
  instance is created and no Redis connection is configured.
- **`ingress_settings = "internal"` by default.** The `chroma_api_url` output is not
  reachable from the public internet with this setting. Changing to `"all"` requires
  `enable_auth_token = true` (enforced at plan time).
- **Single-instance required.** `max_instance_count = 1` is the default. Multiple Cloud
  Run instances against the same GCS FUSE mount cannot coordinate writes and will corrupt
  collections.
- **GCS FUSE is the persistence backend.** A `<prefix>-data` bucket is automatically
  provisioned and mounted at `/data`. Gen2 execution environment is required.
- **Auth token is optional but recommended** for any deployment reachable outside the VPC.
  When enabled, the token is stored in Secret Manager and must be passed as
  `Authorization: Bearer <token>` in every API call.
- **Health probes are fixed to `/api/v2/heartbeat`.** This is the only health endpoint
  Chroma exposes; the probe path cannot be changed.
- **Anonymised telemetry is always disabled.** `ANONYMIZED_TELEMETRY=false` is injected
  automatically.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Chroma service

Chroma runs as a Cloud Run v2 service. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts. `cpu_always_allocated`
defaults to `false` (request-based billing); set it `true` (with `min_instance_count
>= 1`) to keep CPU allocated between requests so background index operations and
health checks are never throttled.

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

### B. Cloud Storage (GCS FUSE) — Chroma data persistence

Chroma stores its embedded SQLite database, HNSW index files, and collection metadata
at the `/data` path. A dedicated Cloud Storage bucket (`<prefix>-data`) is
automatically provisioned and mounted at `/data` via the GCS FUSE CSI driver. The
Cloud Run service account is granted read/write access automatically.

- **Console:** Cloud Storage → Buckets — look for the bucket whose name ends in `-data`.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/chroma/    # inspect Chroma's on-disk layout
  # Confirm the GCS FUSE mount inside a running instance:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.volumes)'
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse, CMEK options, and bucket
management.

### C. Secret Manager

When `enable_auth_token = true`, Chroma's API authentication token is generated and
stored as a Secret Manager secret. It is injected into the service at runtime as
`CHROMA_SERVER_AUTHN_CREDENTIALS`; plaintext never appears in configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the token to configure API clients:
  gcloud secrets versions access latest --secret=<prefix>-auth-token --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### D. Networking & ingress

By default the service is reachable only within the VPC (`ingress_settings = "internal"`).
An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can
be layered on; egress settings control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  # Test the Chroma heartbeat from inside the VPC:
  curl <internal-service-url>/api/v2/heartbeat
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring, with
an optional uptime check against `/api/v2/heartbeat` and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Chroma Application Behaviour

- **No database bootstrap.** Chroma manages its own embedded storage and requires no
  database initialisation job. No `db-init` job is injected. If you provide custom
  `initialization_jobs`, they run as Cloud Run Jobs before the service is updated.
- **Index loading on cold start.** When a new instance starts (after scale-to-zero or a
  new revision), it loads HNSW indexes from the GCS bucket. For large collections this
  can take tens of seconds; the startup probe at `/api/v2/heartbeat` waits until Chroma
  signals readiness. Keep `min_instance_count = 1` to avoid this on every request.
- **Single-instance constraint.** Chroma is a single-writer store. Multiple Cloud Run
  instances against the same GCS FUSE mount will corrupt collections because there is
  no distributed write lock. Always keep `max_instance_count = 1`. Scale vertically
  (increase CPU and memory) rather than horizontally.
- **Auth token usage.** When `enable_auth_token = true`, all API calls must include
  `Authorization: Bearer <token>`. Retrieve the token from Secret Manager, then use it:
  ```bash
  TOKEN=$(gcloud secrets versions access latest \
    --secret=<prefix>-auth-token --project "$PROJECT")
  curl -H "Authorization: Bearer $TOKEN" <service-url>/api/v2/collections
  ```
  Python client:
  ```python
  import chromadb
  client = chromadb.HttpClient(
      host="<service-hostname>", port=443, ssl=True,
      headers={"Authorization": f"Bearer {TOKEN}"}
  )
  ```
- **Health probe.** Both the startup and liveness probes target `/api/v2/heartbeat`
  via HTTP. The probe path is fixed by Chroma_Common and cannot be changed. The startup
  probe allows 15 seconds initial delay to accommodate GCS FUSE mount and index loading.
- **Scheduled tasks.** Chroma has no built-in scheduled commands. Use `cron_jobs` if
  you need periodic collection snapshots or maintenance tasks, triggered by Cloud
  Scheduler.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Chroma are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |
| `enable_auth_token` | `false` | Generate a random API token and store it in Secret Manager. Recommended for any deployment reachable outside the VPC. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `chroma` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Chroma Vector Database` | Friendly name shown in the Console. |
| `description` | _(set)_ | Cloud Run service description. |
| `application_version` | `latest` | Chroma image version tag. Pin to a specific version for reproducible deployments. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance; increase to `2000m`+ for production query workloads. |
| `memory_limit` | `1Gi` | Memory per instance. Chroma loads HNSW indexes into memory — size based on collection count and vector dimensions. |
| `min_instance_count` | `1` | Minimum instances. Keep ≥ 1 to avoid index-reload cold starts. |
| `max_instance_count` | `1` | Maximum instances. Keep at 1 — multiple instances on the same GCS FUSE path will corrupt collections. |
| `container_port` | `8000` | Chroma REST API port. |
| `execution_environment` | `gen2` | Gen2 required for GCS FUSE mounts. |
| `cpu_always_allocated` | `false` | Request-based billing by default; set `true` to keep CPU allocated between requests and avoid background index operation timeouts. |
| `timeout_seconds` | `300` | Max request duration. Increase for large batch similarity searches. |
| `enable_cloudsql_volume` | `false` | Not applicable — Chroma has no SQL database. |
| `enable_image_mirroring` | `true` | Mirror the Chroma image into Artifact Registry to avoid Docker Hub rate limits. |
| `traffic_split` | `[]` | Canary/blue-green traffic allocation across revisions. |
| `max_revisions_to_retain` | `7` | Maximum Cloud Run revisions to keep. |

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `internal` | Keep `internal` so Chroma is only reachable within the VPC. Setting `all` requires `enable_auth_token = true` (enforced at plan time). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | VPC egress mode. |
| `enable_iap` | `false` | Require Google identity authentication via IAP. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `ANONYMIZED_TELEMETRY=false` and `CHROMA_SERVER_HTTP_PORT=8000` are always injected. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret rotation reminder period (30 days). |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). Leave empty to disable. |
| `backup_retention_days` | `7` | Retention in days. Raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`,
`additional_cloudrun_sa_roles`.

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — not applicable to Chroma (no SQL database). These
variables are accepted for foundation compatibility but have no effect. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Load Balancer, CDN & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision a Global HTTPS Load Balancer with Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDRs exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS load balancer. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS load balancer. Requires `enable_cloud_armor = true`. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision GCS buckets. The `<prefix>-data` bucket is provisioned automatically by Chroma_Common. |
| `storage_buckets` / `gcs_volumes` | _(set)_ | Additional buckets / GCS FUSE mounts. |
| `enable_nfs` | `false` | Mount Cloud Filestore NFS (requires gen2). Chroma uses GCS for primary storage; enable only for custom init jobs. |
| `nfs_mount_path` | `/mnt/nfs` | NFS container mount path. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

Not applicable — Chroma has no SQL database. The following variables are accepted for
foundation compatibility only and are fixed or ignored: `database_type` (fixed to
`NONE`), `database_password_length`, `enable_auto_password_rotation`,
`rotation_propagation_delay_sec`, `db_host_env_var_name`, `db_user_env_var_name`,
`db_name_env_var_name`, `db_port_env_var_name`, `service_url_env_var_name`.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Chroma requires no default init job. Provide jobs for custom data loading only. |
| `cron_jobs` | `[]` | Recurring Cloud Scheduler-triggered jobs (e.g., collection snapshots). |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | `/api/v2/heartbeat` | HTTP startup probe — Chroma returns 200 once fully initialised. Probe path is fixed. |
| `liveness_probe` / `health_check_config` | `/api/v2/heartbeat` | Liveness probe. |
| `uptime_check_config` | `enabled=false, path=/api/v2/heartbeat` | Cloud Monitoring uptime check; disabled by default. |
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
| `chroma_api_url` | Internal VPC URL for the Chroma v2 API (append `/collections`, `/heartbeat`, etc.). Only reachable within the VPC when `ingress_settings` is `internal`. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any custom setup jobs. |
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

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_auth_token` | `true` for any externally reachable deployment | Critical | Without a token any caller who can reach the Chroma API can read, write, or delete every collection. |
| `ingress_settings` | `internal` (default) | High | Changing to `"all"` without `enable_auth_token = true` exposes an unauthenticated vector database to the public internet (blocked at plan time). |
| `max_instance_count` | `1` | High | Multiple instances against the same GCS FUSE path will corrupt collections — Chroma has no distributed write lock. |
| `execution_environment` | `gen2` | High | GCS FUSE requires Gen2. Deploying with `gen1` while GCS volumes are configured fails the deployment. |
| `memory_limit` | `4Gi`+ for production | High | Chroma loads HNSW indexes into memory. The default `1Gi` supports only very small collections; OOM kills drop in-flight queries. |
| `cpu_always_allocated` | `true` | Medium | Setting `false` causes CPU throttling between requests, slowing index operations and potentially causing health check timeouts. |
| `application_version` | pin to a specific tag | Medium | Using `latest` makes deployments non-reproducible. Chroma data formats can change across major versions. |
| `timeout_seconds` | increase for large collections | Medium | Large similarity searches over millions of vectors can take several seconds; 504s return to clients if the timeout is too low. |
| `min_instance_count` | `1` | Medium | Scale-to-zero causes cold starts during which HNSW indexes must be reloaded from GCS, adding latency for the first request after idle. |
| `enable_iap` / `enable_cloud_armor` | enable for externally reachable services | High | Without authentication, an externally exposed Chroma endpoint is fully open. |
| `backup_retention_days` | raise for production | Medium | Regular GCS bucket snapshots are the primary recovery path; too-short retention limits recovery options. |
| `enable_cloudsql_volume` | `false` | Low | Chroma has no SQL database; enabling this injects a Cloud SQL Auth Proxy sidecar that consumes resources unnecessarily. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Chroma-specific application configuration shared
with the GKE variant is described in **[Chroma_Common](Chroma_Common.md)**.
