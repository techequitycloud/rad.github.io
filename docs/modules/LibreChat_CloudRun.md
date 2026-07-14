---
title: "LibreChat on Google Cloud Run"
description: "Configuration reference for deploying LibreChat on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# LibreChat on Google Cloud Run

LibreChat is an open-source AI chat interface with 20,000+ GitHub stars that replicates and
extends the ChatGPT experience across 20+ LLM providers (OpenAI, Anthropic, Google Gemini,
Mistral, Groq, Ollama, and many more). This module deploys LibreChat on **Cloud Run v2**
on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services LibreChat uses and how to explore and operate them
from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run
application — service identity, ingress and load balancing, scaling and concurrency, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment
lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating
them here.

---

## 1. Overview

LibreChat runs as a Node.js container on Cloud Run v2. The deployment wires together a focused
set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 2 vCPU / 2 GiB by default, request-based autoscaling |
| Database | MongoDB (in-pod `mongo:7` sidecar by default) | Cloud SQL is not used; Firestore MongoDB-compatibility is an opt-in alternative |
| Object storage | Cloud Storage | A dedicated file-uploads bucket, plus optional extra buckets |
| Secrets | Secret Manager | JWT keys, credential encryption keys, and MongoDB URI auto-generated |
| Cache & sessions | Redis (optional) | Required for multi-instance deployments to maintain session consistency |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No Cloud SQL.** LibreChat uses MongoDB. By default `mongodb_uri` points at an **in-pod
  `mongo:7` sidecar** (`mongodb://127.0.0.1:27017/LibreChat`), added as an `additional_containers`
  entry in the same Cloud Run service, with its data directory on the shared NFS volume
  (`/data/db`). Firestore's MongoDB-compatible API authenticates but drops LibreChat's startup
  commands, so it is **not** the default — clear `mongodb_uri` to `""` (and set
  `firestore_mongodb_host`, or leave both empty for auto-discovery) to opt into Firestore instead.
- **The MongoDB sidecar makes the service a singleton.** Because its data lives on NFS at a
  single path, `min_instance_count = max_instance_count = 1` by default. Point at an external
  MongoDB (Atlas, self-hosted, or Firestore) to scale beyond one instance.
- **Firestore database is never deleted on destroy (when used).** If you opt into Firestore
  auto-provisioning, the database is retained to prevent data loss; delete it manually if no
  longer needed.
- **JWT and credential secrets are auto-generated** on first deploy and stored in Secret Manager.
  Rotating `CREDS_KEY` or `CREDS_IV` after users have saved AI provider credentials renders all
  stored credentials undecryptable.
- **Scale-to-zero is disabled by default** (`min_instance_count = 1`). LibreChat cold starts
  can take 15–30 seconds due to MongoDB connection and asset loading.
- **Redis is disabled by default.** Enable it for any deployment with more than one instance —
  without Redis, session state is isolated per instance and users lose sessions on scale events.
- **Timeout defaults to 600 seconds.** Long-running AI responses over SSE streaming require a
  generous timeout.
- **`max_instance_count` defaults to `1`** in the Cloud Run variant. The default deployment
  embeds a MongoDB sidecar whose data directory lives on a single shared NFS volume; multiple
  instances writing to the same data directory can cause corruption. When pointing at an external
  MongoDB, increase this limit freely.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported in
the deployment [Outputs](#5-outputs).

### A. Cloud Run — the LibreChat service

LibreChat runs as a Cloud Run v2 service that autoscales by request load between the minimum
and maximum instance counts. Each deployment creates an immutable revision; traffic can be split
across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. MongoDB — the LibreChat database

LibreChat stores all chat history, user accounts, and configuration in MongoDB. By default an
official `mongo:7` container runs as an **in-pod sidecar** in the same Cloud Run service
(`additional_containers`), reachable by the main container at `127.0.0.1:27017`, with its data
directory (`/data/db`) on the shared NFS volume. Alternatively, clear `mongodb_uri` to `""` to
opt into a **Firestore ENTERPRISE database with MongoDB compatibility** (auto-discovered or
created), or point `mongodb_uri` at MongoDB Atlas or any self-hosted MongoDB instance accessible
from the VPC.

- **Console:** Cloud Run → the service's revision detail shows the `mongo` sidecar container.
  Firestore → select the database (when Firestore mode is used; ID matches
  `firestore_mongodb_database`, default `LibreChat`).
- **CLI:**
  ```bash
  # Inspect the sidecar and its NFS-backed data directory:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" --format=json | jq '.spec.template.spec.containers'
  # If using Firestore mode:
  gcloud firestore databases list --project "$PROJECT"
  gcloud firestore databases describe LibreChat --project "$PROJECT"
  ```

Retrieve the MongoDB URI from Secret Manager to verify connectivity:

```bash
gcloud secrets list --project "$PROJECT" --filter="name~mongo-uri"
gcloud secrets versions access latest --secret=<mongo-uri-secret> --project "$PROJECT"
```

### C. Cloud Storage — file uploads

`LibreChat_Common` provisions a dedicated **`librechat-uploads`** Cloud Storage bucket for user
file uploads shared in chat (images, documents). The workload service account is granted access
automatically.

- **Console:** Cloud Storage → Buckets → look for the bucket with the `uploads` suffix.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/
  ```

See [App_CloudRun](App_CloudRun.md) for NFS mounts, GCS Fuse, and CMEK options.

### D. Secret Manager — auto-generated application secrets

LibreChat requires several cryptographic secrets that are generated automatically on first deploy
and never exposed in plain text.

| Secret suffix | Environment variable | Purpose |
|---|---|---|
| `creds-key` | `CREDS_KEY` | 32-byte hex AES-GCM key for saved provider credentials |
| `creds-iv` | `CREDS_IV` | 16-byte hex AES-GCM IV — paired with `CREDS_KEY` |
| `jwt-secret` | `JWT_SECRET` | Signs user access tokens |
| `jwt-refresh-secret` | `JWT_REFRESH_SECRET` | Signs long-lived refresh tokens |
| `mongo-uri` | `MONGO_URI` | MongoDB connection string |

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Redis cache (optional)

Redis backs LibreChat's session management and real-time message queuing. It is required when
more than one instance is running — without it, each instance has isolated in-memory session
state and users lose sessions on scale events.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load balancer with a
custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and VPC egress
control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring, with optional
uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. LibreChat Application Behaviour

- **No database migration job.** LibreChat auto-migrates its MongoDB schema on first startup;
  no separate initialization job is needed.
- **In-pod MongoDB sidecar by default.** `mongodb_uri` defaults to
  `mongodb://127.0.0.1:27017/LibreChat`, pointing at an official `mongo:7` container added as an
  `additional_containers` entry in the same Cloud Run service; its data directory lives on the
  shared NFS volume, which is why the service defaults to a `min = max = 1` singleton.
- **Firestore auto-provisioning (opt-in).** Set `mongodb_uri = ""` to enable it: when
  `mongodb_uri` is empty and no `firestore_mongodb_host` is set, the module discovers or creates
  a Firestore ENTERPRISE database with MongoDB compatibility. A SCRAM user is provisioned
  automatically. The database is never destroyed with the module.
- **AI provider API keys.** LibreChat connects to AI provider APIs (OpenAI, Anthropic, etc.) at
  request time. Inject provider keys via `secret_environment_variables`, which references
  pre-existing Secret Manager secrets. Do not pass keys as plain `environment_variables` — they
  would appear in Cloud Run revision metadata and GCP audit logs.
- **Health path.** Both the startup and liveness probes target `/` (LibreChat's root), which
  returns HTTP 200 once the application is fully initialised and connected to MongoDB. The
  startup probe has a generous failure threshold to allow MongoDB connection establishment on
  first boot.
- **SSE and WebSocket continuity.** LibreChat uses Server-Sent Events (SSE) for streaming AI
  responses. Ensure `timeout_seconds` is set high enough (600 s default) to avoid truncating
  long AI responses mid-stream.
- **User registration.** Self-registration is enabled by default. Set `allow_registration = false`
  after creating the initial admin account to prevent unauthorized sign-ups on public deployments.
- **Automatically injected environment variables.** The following are always set by the module
  and do not need to be provided manually:

  | Variable | Value | Purpose |
  |---|---|---|
  | `HOST` | `0.0.0.0` | Bind on all interfaces inside the container |
  | `NODE_ENV` | `production` | Production optimisations |
  | `TRUST_PROXY` | `1` | Express reads `X-Forwarded-For` correctly behind Cloud Run ingress |
  | `APP_TITLE` | `var.app_title` | UI header title |
  | `DOMAIN_CLIENT` / `DOMAIN_SERVER` | service URL | OAuth redirect URIs and email links |
  | `ALLOW_REGISTRATION` | `var.allow_registration` | Self-registration flag |

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific
to or notable for LibreChat are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |
| `firestore_mongodb_host` | `""` | Firestore MongoDB endpoint host (manual override). Leave empty for auto-discovery. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `librechat` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `LibreChat AI Chat` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Service description. |
| `application_version` | `latest` | LibreChat image version tag — **pin to a specific release in production**. |
| `mongodb_uri` | `mongodb://127.0.0.1:27017/LibreChat` | MongoDB connection URI (sensitive). Defaults to the in-pod `mongo:7` sidecar. Set to `""` to use Firestore auto-provisioning, or supply an external MongoDB/Atlas URI. |
| `app_title` | `LibreChat` | Title shown in the LibreChat UI header and browser tab. |
| `allow_registration` | `true` | Allow new users to self-register. **Set `false` after initial admin account creation.** |
| `allow_social_login` | `false` | Enable OAuth social login providers. Requires OAuth app configuration in `librechat.yaml`. |
| `allow_social_registration` | `null` | Allow account creation via social login. Defaults to the value of `allow_social_login`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | `prebuilt` (GHCR) or `custom` (Cloud Build). |
| `container_image` | `ghcr.io/danny-avila/librechat` | Container image URI. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | CPU and memory per instance; 2 vCPU / 2 GiB minimum. |
| `container_port` | `3080` | LibreChat's native HTTP port. |
| `execution_environment` | `gen2` | Gen2 required for NFS mounts and GCS Fuse. |
| `timeout_seconds` | `600` | Max request duration; increase for slow LLM backends or long AI responses. |
| `min_instance_count` | `1` | Minimum instances. Keep ≥ 1 to avoid cold starts and dropped SSE streams. |
| `max_instance_count` | `1` | Maximum instances. **Keep at `1` when using the embedded MongoDB sidecar.** |
| `enable_cloudsql_volume` | `false` | **Must remain `false`.** LibreChat does not use Cloud SQL. |
| `enable_image_mirroring` | `true` | Mirror GHCR image to Artifact Registry — avoids rate limits. |
| `traffic_split` | `[]` | Canary / blue-green traffic allocation across revisions. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` — public internet; `internal` — VPC only; `internal-and-cloud-load-balancing` — via HTTPS LB. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC connector. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core LibreChat vars are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. **Use this for AI provider API keys.** |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated NFS backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — NFS Instance

| Variable | Default | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(set)_ | Existing NFS instance / base name for an inline one. |

### Group 10 — Domain, CDN, Cloud Armor & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDRs exempted from WAF rules. |
| `application_domains` | `[]` | Custom hostnames for the external load balancer. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. Requires `enable_cloud_armor = true`. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision additional GCS buckets. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Extra buckets beyond the auto-provisioned uploads bucket. |
| `enable_nfs` | `true` | Shared Filestore volume; **required by the embedded MongoDB sidecar** (stores `/data/db`). Disable only when using an external MongoDB. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS buckets to mount via GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database / MongoDB

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | **Fixed — do not change.** LibreChat does not use Cloud SQL. |
| `firestore_mongodb_database` | `LibreChat` | Firestore database ID / MongoDB database name. |
| `firestore_mongodb_username` | `""` | SCRAM username for Firestore authentication. |
| `firestore_mongodb_password` | `""` | SCRAM password (sensitive). Auto-generated when not set. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty — LibreChat auto-migrates MongoDB on startup. Add custom setup tasks if needed. |
| `cron_jobs` | `[]` | Recurring jobs triggered by Cloud Scheduler (data cleanup, cache warming, etc.). |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | `{ path="/", initial_delay_seconds=30, failure_threshold=10 }` | HTTP probe allowing time for MongoDB connection and asset load. |
| `liveness_probe` / `health_check_config` | `{ path="/", initial_delay_seconds=60, failure_threshold=3 }` | Liveness probe targeting LibreChat's root path. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis for session management. **Required for multi-instance deployments.** |
| `redis_host` | `""` | Redis endpoint. Required when `enable_redis = true`. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running
resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (includes the uploads bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any setup jobs that were run. |
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
| `CREDS_KEY` / `CREDS_IV` (auto-generated) | set once | Critical | AES-GCM keys for saved AI provider credentials. Rotating after users have saved keys destroys all stored credentials — every user must re-enter their API keys. |
| `mongodb_uri` | leave default (sidecar) or set explicitly | Critical | LibreChat requires MongoDB. The default in-pod `mongo:7` sidecar needs NFS enabled for its data directory; clearing `mongodb_uri` to `""` with a broken Firestore/Atlas configuration crashes the container on startup and serves no traffic. |
| `enable_cloudsql_volume` | `false` | Critical | Must remain `false`. Enabling injects an unnecessary Cloud SQL Auth Proxy sidecar. |
| `database_type` | `NONE` | Critical | Setting to a SQL engine provisions an unused Cloud SQL instance at extra cost. |
| `secret_environment_variables` (AI keys) | use secrets | Critical | AI provider keys passed as plain `environment_variables` are visible in Cloud Run revision metadata and GCP audit logs. Always use Secret Manager references. |
| `allow_registration` | `false` after setup | High | Open registration on a public deployment allows anyone to create an account. Disable after admin creation or restrict with IAP. |
| `enable_redis` | `true` for multi-instance | High | Without Redis, each instance has isolated in-memory session state; users lose sessions on scale events. |
| `redis_host` | explicit endpoint | High | Required when `enable_redis = true`. If empty, LibreChat cannot connect to Redis. |
| `max_instance_count` | `1` with embedded MongoDB | High | Multiple instances writing to the same NFS-backed MongoDB data directory can corrupt the database. Increase only when using an external MongoDB. |
| `enable_nfs` | `true` with embedded MongoDB | High | The embedded MongoDB sidecar stores its data dir (`/data/db`) on NFS. Disabling NFS removes durable storage and MongoDB data is lost on restart. |
| `timeout_seconds` | `600` | High | SSE streaming for long AI responses can exceed several minutes. Insufficient timeout truncates responses mid-stream. |
| `min_instance_count` | `1` | High | Scale-to-zero drops all in-flight SSE streams and causes cold-start latency on wakeup. |
| `JWT_SECRET` (auto-generated) | set once | High | Rotating invalidates all active sessions simultaneously. Plan rotation during a maintenance window. |
| `application_version` | pinned release | Medium | `latest` can introduce breaking MongoDB schema changes or API incompatibilities on unplanned upgrades. |
| `enable_iap` / `enable_cloud_armor` | enable for production | Medium | LibreChat is otherwise directly reachable from the public internet with only application-level login protecting it. |
| `execution_environment` | `gen2` | High | NFS mounts are not supported in gen1. Always use gen2 for NFS-enabled deployments. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency,
ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups,
and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. LibreChat-specific application
configuration shared with the GKE variant is described in
**[LibreChat_Common](LibreChat_Common.md)**.
