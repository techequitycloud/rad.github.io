---
title: "Rocket.Chat on Google Cloud Run"
description: "Configuration reference for deploying Rocket.Chat on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Rocket.Chat on Google Cloud Run

Rocket.Chat is an open-source, self-hosted team-communication platform — a
Slack/Teams alternative built on Node.js and Meteor, with channels, direct messages,
threads, voice/video, and an omnichannel/LiveChat layer. This module deploys
Rocket.Chat on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md)
foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Rocket.Chat uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load balancing,
scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Rocket.Chat runs as a single Node.js/Meteor container on Cloud Run v2 with its
datastore **embedded in the same container**. The deployment wires together a focused
set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js/Meteor service, 1 vCPU / 4 GiB by default; pinned to a single always-warm instance |
| Datastore | Embedded MongoDB 6.0 replica set | Baked into the image — no Cloud SQL. Runs as a single-node replica set (`rs0`) over `127.0.0.1` |
| Persistence | Cloud Storage (GCS volume) | The MongoDB data directory `/data/db` is mounted on a GCS-backed volume so chats survive revisions |
| Secrets | Secret Manager | Optional API token (`enable_api_key`) |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL (public); optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MongoDB is embedded, not managed.** Meteor's real-time reactivity tails the
  MongoDB oplog, which only a **replica set** provides. No managed datastore here
  offers a MongoDB replica set, so the module bundles a single-node replica set
  (`rs0`) into the image. There is no Cloud SQL instance.
- **MongoDB 6.0 from the Debian bullseye repo.** The `rocketchat/rocket.chat` base
  image is Debian **bullseye** (glibc 2.31); the Dockerfile installs MongoDB 6.0 from
  the bullseye APT repo because the bookworm/7.0 package needs glibc ≥ 2.34.
- **Single instance only.** `min_instance_count = 1` and `max_instance_count = 1`.
  Each instance runs its own embedded MongoDB against the same GCS-backed volume —
  running two would corrupt the database. The single instance is kept warm so the
  replica set stays `PRIMARY`.
- **Port 3000.** Rocket.Chat listens on port 3000; the entrypoint sets `PORT=3000`.
- **Health on `/api/info`.** Startup, liveness, and uptime checks target `/api/info`,
  which returns a JSON info payload with HTTP 200 only once the server and its replica
  set are ready.
- **`ingress_settings` defaults to `"all"`.** The `run.app` URL is public out of the
  box, which is required to reach the web UI from a browser. Restrict to `"internal"`
  or front it with a Load Balancer via `"internal-and-cloud-load-balancing"` if you
  need to lock it down.
- **`ROOT_URL` follows the service URL.** The entrypoint sets `ROOT_URL` to the
  computed Cloud Run URL; override it via a custom domain so links, invites, and
  OAuth callbacks resolve correctly.
- **First run is a 4-step setup wizard.** No admin is pre-seeded — the first browser
  visit walks through creating the admin account and organization.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Rocket.Chat service

Rocket.Chat runs as a Cloud Run v2 service. Because the MongoDB data set lives on a
mounted volume and the app is a single writer, the service is pinned to one instance
rather than autoscaling.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for execution environment, concurrency, and
traffic splitting.

### B. Embedded MongoDB (no Cloud SQL)

There is **no Cloud SQL instance** — `database_type = "NONE"`. MongoDB runs inside the
Rocket.Chat container as a single-node replica set (`rs0`) and is reachable only over
`127.0.0.1:27017` within the instance. The entrypoint starts `mongod`, initiates the
replica set on first boot, waits for `PRIMARY`, and then launches Rocket.Chat. To
inspect the database, exec into the running container context via the logs and admin
UI; there is no external database endpoint.

```bash
# Confirm the embedded MongoDB reached PRIMARY on boot:
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50 \
  | grep -i "replica set rs0 is PRIMARY"
```

### C. Cloud Storage (MongoDB data volume)

A dedicated **Cloud Storage** bucket backs the MongoDB data directory `/data/db`,
mounted as a GCS volume so chats, users, and settings survive revision replacement.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/          # bucket name is in the Outputs
  ```

> **Note:** MongoDB's WiredTiger engine expects a real block filesystem. The GCS
> volume works here only because access is single-writer and low-volume. For
> production-grade I/O and integrity, use the **GKE variant with a StatefulSet PVC**.

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Secret Manager

When `enable_api_key = true`, a random API token is generated and stored in Secret
Manager, but it is injected as `QDRANT__SERVICE__API_KEY` — an env var Rocket.Chat does
not read, so it currently has no effect on Rocket.Chat auth (a known limitation; see
the Group 3 table below). No other application secrets are created here — Rocket.Chat
mints and stores its own keys in MongoDB during first-run setup.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = "all"`),
which is required to reach the web UI from a browser. An external HTTPS load balancer
with a custom domain, Cloud CDN, and Cloud Armor can be layered on; IAP can gate access
to authenticated Google identities.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

When you attach a custom domain, set `ROOT_URL` to that hostname so invite links and
OAuth callbacks match the address users actually visit. See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs (both Rocket.Chat and the embedded `mongod`) flow to Cloud Logging;
Cloud Run metrics flow to Cloud Monitoring, with an uptime check against `/api/info`
and optional alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Rocket.Chat Application Behaviour

- **Embedded replica-set bootstrap.** On every container start the entrypoint starts
  `mongod --replSet rs0`, initiates the replica set once (idempotent), waits until the
  node is `PRIMARY`, then exports `MONGO_URL` / `MONGO_OPLOG_URL` and starts
  Rocket.Chat. The oplog URL is what enables Meteor's real-time updates.
- **First-run setup wizard.** The first browser visit to the service URL opens a
  4-step wizard: (1) **Admin Info** — create the admin account (name, username, email,
  password); (2) **Organization Info** — name, type, industry, size, country;
  (3) **Register Server** — register with Rocket.Chat Cloud or keep the server
  standalone; (4) **Complete**. No admin is pre-seeded.
- **Data persistence.** All state (messages, users, settings, uploaded-file metadata)
  lives in the embedded MongoDB, whose `/data/db` directory is on the GCS-backed
  volume. Deleting the volume deletes the workspace.
- **`ROOT_URL` correctness.** The entrypoint defaults `ROOT_URL` to the Cloud Run
  service URL. If you serve Rocket.Chat on a custom domain, set `ROOT_URL` (via
  `environment_variables`) to that URL, or links and OAuth redirects will point at the
  wrong host.
- **Health path.** Startup and liveness probes target `/api/info`. Allow a few minutes
  on first boot for the replica-set election and Rocket.Chat's initial migrations.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Rocket.Chat are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. Use `cr` to run alongside a GKE variant. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `rocketchat` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `RocketChat` | Human-readable name shown in the Console. |
| `description` | `RocketChat — open-source team chat on Cloud Run` | Service description. |
| `application_version` | `latest` | Rocket.Chat image tag; `latest` pins the build to a known-good release (`6.12.1`). Pin to a specific release in production. |
| `enable_api_key` | `false` | **Known limitation:** generates a random key in Secret Manager, but it is injected as `QDRANT__SERVICE__API_KEY` — an env var Rocket.Chat does not read. Rocket.Chat has no single static API-key concept; it issues per-user personal access tokens via its own Admin API instead. Enabling this creates the secret but has no effect on Rocket.Chat auth. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `4Gi` | Memory per instance; Rocket.Chat + embedded MongoDB share it. |
| `min_instance_count` | `1` | Keep at 1 so the embedded replica set stays PRIMARY. |
| `max_instance_count` | `1` | **Keep at 1** — the embedded MongoDB is a single writer. |
| `container_port` | `3000` | Rocket.Chat listens on port 3000. |
| `execution_environment` | `gen2` | Gen2 required for the GCS volume mount. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds); raise for large uploads. |
| `enable_cloudsql_volume` | `false` | Not applicable — Rocket.Chat has no SQL database. |
| `enable_image_mirroring` | `true` | Mirror the Rocket.Chat image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` (public) is required to reach the web UI from a browser. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of Rocket.Chat. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not set `MONGO_URL`/`MONGO_OPLOG_URL`/`MONGO_DBPATH` — the entrypoint owns them. Use `OVERWRITE_SETTING_*` to seed admin settings; set `ROOT_URL` for a custom domain. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore a MongoDB dump on deploy. |

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
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. Set `ROOT_URL` to match. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets; the `<prefix>-storage` bucket (MongoDB data volume) is always created. |
| `storage_buckets` | `[]` | Additional GCS buckets. |
| `enable_nfs` | `false` | NFS off by default; MongoDB uses the GCS volume. |
| `gcs_volumes` | `[]` | Additional GCS Fuse volume mounts (requires gen2). The `/data/db` volume is added automatically. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No default init job — the embedded MongoDB is bootstrapped by the entrypoint. |
| `cron_jobs` | `[]` | Recurring Cloud Run Jobs (e.g., `mongodump` backups). |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/info`, 60s delay, 40 × 10s failure window | Startup probe. The generous window accommodates replica-set election and Rocket.Chat's initial migrations on first boot. |
| `liveness_probe` | HTTP `/api/info`, 30s delay | Liveness probe. |
| `uptime_check_config` | disabled (`path="/api/info"`) | Cloud Monitoring uptime check; enable for production monitoring. |
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
| `rocketchat_url` | `run.app` URL of the Rocket.Chat web UI (only reachable from a browser once `ingress_settings = "all"`). |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (incl. the MongoDB data volume). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any setup jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a `gen1` runtime with GCS/NFS mounts, an out-of-range `backup_retention_days`, IAP with no authorized identities. Invalid configuration fails the **plan** with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | The embedded MongoDB is a single writer against the same GCS-backed volume — two instances corrupt the database. |
| `min_instance_count` | `1` | High | Scaling to zero stops the embedded MongoDB; on the next cold start the replica set must re-elect, adding latency and risking corruption on abrupt shutdown. |
| GCS volume `/data/db` (auto) | Never delete | Critical | Deleting the storage bucket deletes the entire workspace (messages, users, settings). |
| `execution_environment` | `gen2` | High | Gen1 cannot mount the GCS volume; MongoDB has nowhere durable to write. |
| `ROOT_URL` (custom domain) | Match the served hostname | High | A mismatched `ROOT_URL` breaks invite links, file URLs, and OAuth callbacks. |
| `application_version` | Pin in production | Medium | `latest` builds against the pinned `6.12.1`; explicitly pinning gives reproducible upgrades. |
| `memory_limit` | `4Gi`+ | High | Rocket.Chat plus MongoDB in one container OOM below ~2 GiB under real load. |
| `ingress_settings` | `all` | Medium | `internal` makes the web UI unreachable from a browser without a load balancer. |
| `enable_iap` | enable for private workspaces | Medium | Without IAP or a custom-domain WAF, the login page is publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

For production-grade MongoDB storage (real block PVC, higher IOPS, no `gcsfuse`
caveat), prefer the **GKE variant** — see [RocketChat_GKE](RocketChat_GKE.md).

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Rocket.Chat-specific application configuration
shared with the GKE variant is described in
**[RocketChat_Common](RocketChat_Common.md)**.
