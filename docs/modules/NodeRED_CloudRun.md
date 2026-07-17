---
title: "Node-RED on Google Cloud Run"
description: "Configuration reference for deploying Node-RED on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Node-RED on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/NodeRED_CloudRun.png" alt="Node-RED on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Node-RED is an open-source flow-based programming tool for wiring together IoT
devices, APIs, and online services through a visual browser-based editor. This
module deploys Node-RED on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Node-RED uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Node-RED runs as a Node.js container on Cloud Run v2 (gen2) listening on port
1880. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 1 vCPU / 1 GiB by default, request-based autoscaling |
| Persistent flow storage | Filestore (NFS) | Flows, credentials, and installed nodes in `/data` (requires gen2) |
| Object storage | Cloud Storage | A dedicated application data bucket |
| Context storage | Redis (optional) | Disabled by default; enables cross-restart and cross-instance context sharing |
| Credential secret | Secret Manager | Auto-generated `NODE_RED_CREDENTIAL_SECRET` encrypts flow credentials |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No database is required.** Node-RED stores all state in its `/data`
  directory; `database_type` defaults to `"NONE"`.
- **NFS is enabled by default.** The `/data` directory is mounted from a
  Filestore share (requires `execution_environment = "gen2"`) so flows,
  credentials, and installed nodes survive container restarts and new
  deployments.
- **Scale-to-zero is supported** (`min_instance_count = 0`). Set to `1` for
  production webhook workloads to avoid cold-start delays and missed webhooks
  during the NFS remount window.
- **`max_instance_count = 1` by default.** Node-RED is not designed for
  active-active horizontal scaling; each instance has its own in-memory
  context. Increase only when using Redis-backed external context storage.
- **`NODE_RED_CREDENTIAL_SECRET` is auto-generated.** It encrypts all stored
  flow credentials and is kept in Secret Manager. Rotating it after flows are
  deployed renders existing credentials unreadable.
- **Health probes use HTTP GET `/`**, which returns the editor UI once
  Node-RED is ready (30-second initial delay is sufficient).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Node-RED service

Node-RED runs as a Cloud Run v2 service that autoscales by request load between
the minimum and maximum instance counts. Each deployment creates an immutable
revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs,
  and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency,
execution environment, and traffic splitting.

### B. Filestore (NFS) — persistent flow storage

Node-RED stores all persistent data — flows (`flows.json`), encrypted
credentials (`flows_cred.json`), installed palette nodes, and the settings
file — in its `/data` directory. A Filestore NFS share is mounted at `/data`
(gen2 required) so data survives container restarts and new service revisions.

- **Console:** Filestore → Instances for the NFS share.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Inspect the mounted volume from an active instance:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.volumes)'
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS mount, GCS Fuse, and CMEK.

### C. Cloud Storage

A dedicated GCS bucket is provisioned for Node-RED application data (flow
exports, backup archives). The service account is granted access automatically.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for CMEK options.

### D. Secret Manager — flow credential encryption

`NODE_RED_CREDENTIAL_SECRET` is generated automatically during deployment and
stored as a Secret Manager secret. Node-RED uses this key to encrypt all
credentials stored in flows. No other application-specific secrets are
generated by this module.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Redis (optional context storage)

When `enable_redis = true`, Node-RED is configured to store flow context
externally in Redis, allowing context data to persist across instance restarts
and to be shared between multiple instances. Redis is disabled by default.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

When `enable_redis = true` and `redis_host` is empty but `enable_nfs = true`,
the NFS server IP is used as the Redis host; otherwise `redis_host` must be
set explicitly.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS
load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered
on; ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Node-RED Application Behaviour

- **No database, no initialization job.** Node-RED stores all state in `/data`.
  No Cloud SQL instance is provisioned and no schema initialization job is
  required. The first start creates the default flow files automatically if
  `/data` is empty.
- **Flow credential encryption.** `NODE_RED_CREDENTIAL_SECRET` is injected at
  runtime from Secret Manager. This key encrypts the `flows_cred.json` file on
  the NFS share. Changing or rotating the key after flows are deployed renders
  all stored credentials (API keys, passwords, tokens) unreadable.
- **Safe mode.** `NODE_RED_ENABLE_SAFE_MODE` is always set to `"false"`,
  ensuring flows execute on startup. Override it to `"true"` via
  `environment_variables` to start Node-RED with flows disabled for debugging.
- **Scale-to-zero and cold starts.** With `min_instance_count = 0`, Node-RED
  scales to zero when idle. On scale-up the NFS volume must remount before the
  health check passes (roughly 10–20 seconds). Webhooks fired during this
  window may be lost. Set `min_instance_count = 1` for production webhook
  workloads.
- **Health probe.** Both startup and liveness probes send HTTP GET to `/`,
  which returns the editor UI once Node-RED is ready. A 30-second initial
  delay is sufficient.
- **Scheduled tasks.** Node-RED has no built-in scheduled commands. Use
  `cron_jobs` to provision Cloud Scheduler-triggered Cloud Run jobs for
  periodic maintenance tasks such as flow exports or cache flushes:
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Accessing the editor.** Browse to the `service_url` output and log in.
  For production deployments, enable IAP (`enable_iap = true`) to gate access
  with Google identity authentication — the editor exposes full flow editing
  and credential management.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Node-RED are listed; every other input is
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
| `application_name` | `nodered` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Node-RED` | Friendly name shown in the Console. |
| `application_version` | `latest` | Image tag for `nodered/node-red`. Pin to a specific version (e.g. `4.0.9`) for reproducible deployments. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance; 1 vCPU is sufficient for most deployments. |
| `memory_limit` | `1Gi` | Memory per instance; raise to `2Gi` for flows that process large payloads. |
| `min_instance_count` | `0` | Minimum instances. `0` enables scale-to-zero; set to `1` for production webhook workloads. |
| `max_instance_count` | `1` | Maximum instances. Keep at `1` unless flows are stateless or Redis-backed. |
| `execution_environment` | `gen2` | **Must be `gen2` for NFS volume mounts to function.** |
| `timeout_seconds` | `300` | Maximum request duration before a 504 is returned. |
| `cpu_always_allocated` | `false` | When `false`, CPU is throttled at idle. Set `true` only if background tasks require continuous CPU. |
| `enable_image_mirroring` | `true` | Mirror from Docker Hub into Artifact Registry to avoid rate limits. |
| `traffic_split` | `[]` | Allocates traffic across revisions for canary/blue-green rollouts. |
| `max_revisions_to_retain` | `7` | Cloud Run revisions to keep after each deployment. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Which networks may reach the service. Use `"internal-and-cloud-load-balancing"` with Cloud Armor for production webhooks. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Outbound routing through the VPC connector. |
| `enable_iap` | `false` | Require Google sign-in. Strongly recommended for production. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not set `NODE_RED_CREDENTIAL_SECRET` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification period. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated NFS backup cron (UTC). Leave empty to disable. |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — NFS Instance & Custom SQL

| Variable | Default | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(auto)_ | Existing NFS instance / base name for an inline one. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_*` | off | Not applicable to Node-RED; kept for API compatibility. |

### Group 10 — Domain, CDN, Cloud Armor & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. Requires `application_domains`. |
| `application_domains` | `[]` | Custom hostnames with Google-managed SSL. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. Requires `enable_cloud_armor = true`. |
| `admin_ip_ranges` | `[]` | CIDRs exempted from WAF rules. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for Node-RED's `/data` directory. Strongly recommended. Requires gen2. |
| `nfs_mount_path` | `/data` | Must match Node-RED's native data directory. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(set)_ | Data bucket / additional buckets / GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Credential Secret

| Variable | Default | Description |
|---|---|---|
| `database_password_length` | `32` | Length of the auto-generated `NODE_RED_CREDENTIAL_SECRET` (16–64). |
| `enable_auto_password_rotation` | `false` | Automated credential secret rotation. Rotating the key renders existing flow credentials unreadable. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before restarting the service. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Node-RED requires no init jobs. Provide custom jobs for flow imports or palette installations. |
| `cron_jobs` | `[]` | Recurring Cloud Run jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 30s delay | HTTP probe against the Node-RED editor path. |
| `liveness_probe` | HTTP `/`, 30s delay | Liveness probe — restarts the container if the editor is unresponsive. |
| `uptime_check_config` | disabled, path `/` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Context Storage

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis for Node-RED context storage. |
| `redis_host` | `""` | Redis endpoint. Required when `enable_redis = true` (unless `enable_nfs = true`). |
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

Returned on a successful deployment — the quickest way to locate and explore
the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the Node-RED service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets. |
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

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_nfs` | `true` | Critical | Without NFS, all flows, credentials, and installed nodes are lost on every instance restart or new deployment. |
| `NODE_RED_CREDENTIAL_SECRET` (from `database_password_length`) | auto-generated | Critical | Encrypts all flow credentials. Rotating or changing the key after flows are deployed makes existing credentials permanently unreadable. |
| `enable_auto_password_rotation` | `false` | Critical | Automatic rotation changes the encryption key; all stored flow credentials become inaccessible. Only enable with a re-encryption procedure in place. |
| `application_name` | set once | Critical | Immutable after first deploy; renaming recreates all GCP resources and disconnects the NFS share. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the restore job. |
| `execution_environment` | `gen2` | High | NFS mounts require gen2; using gen1 causes mount failures and container startup errors. |
| `max_instance_count` | `1` | High | Node-RED is not designed for active-active scaling. Multiple instances without shared context cause conflicting state. |
| `min_instance_count` | `1` for webhooks | High | Scale-to-zero causes cold starts of 10–20 seconds; webhooks fired during NFS remount are lost. |
| `nfs_mount_path` | `/data` | High | Must match Node-RED's native data directory. Changing it routes writes to ephemeral storage. |
| `database_type` | `NONE` | High | Setting to `MYSQL` or `POSTGRES` provisions an unnecessary Cloud SQL sidecar. |
| `enable_redis` without `redis_host` | set `redis_host` explicitly | High | Without NFS fallback, an empty Redis host causes context storage failures. |
| `enable_iap` | `true` for production | High | The editor exposes full flow editing and credential management and should not be publicly accessible. |
| `ingress_settings` | `internal-and-cloud-load-balancing` for prod | Medium | `"internal"` blocks all external webhooks; `"all"` exposes the service directly without WAF. |
| `memory_limit` | `1Gi` | Medium | Flows processing large payloads or using image-processing nodes may require `2Gi`. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Node-RED-specific application configuration
shared with the GKE variant is described in **[NodeRED_Common](NodeRED_Common.md)**.
