---
title: "code-server on Google Cloud Run"
description: "Configuration reference for deploying code-server on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# code-server on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CodeServer_CloudRun.png" alt="code-server on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

code-server is Coder's open-source (MIT) build of Visual Studio Code that runs on a
remote server and is accessed entirely through the browser — a full IDE with the VS
Code extension marketplace, integrated terminal, and language servers, backed by a
persistent workspace. This module deploys code-server on **Cloud Run v2** on top of
the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services code-server uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load balancing,
scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

code-server runs as a single self-contained container on Cloud Run v2. Unlike
database-backed apps, it wires together a deliberately minimal set of Google Cloud
services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single container listening on port **8080**; 1 vCPU / 1 GiB by default |
| Persistent workspace | Cloud Storage (GCS FUSE) | Workspace bucket mounted at `/home/coder`; provisioned automatically |
| Database | _None_ | `database_type = NONE` — code-server has no SQL database |
| Cache & queue | _None_ | Redis is explicitly disabled (`enable_redis = false`) |
| Secrets | Secret Manager | Auto-generated editor `PASSWORD` (when `enable_password = true`) |
| Ingress | Cloud Run URL / Cloud Load Balancing | **Default ingress is `internal`** — private by default; opt into public access |

**Sensible defaults worth knowing up front:**

- **No database and no Redis.** code-server is a single container; all state lives in
  the workspace volume. `database_type` is fixed to `NONE` by the shared application
  layer and Redis is disabled.
- **Ingress is `internal` by default.** The service is reachable only from inside the
  VPC out of the box. Set `ingress_settings = "all"` (and keep `enable_password = true`)
  to expose the editor publicly, or front it with an HTTPS load balancer.
- **A random editor `PASSWORD` is generated automatically** and stored in Secret
  Manager. It gates the login page. Disabling `enable_password` serves the editor with
  no authentication — only safe behind `internal` ingress.
- **The workspace is on GCS FUSE at `/home/coder`.** Settings, extensions, and open
  projects persist there. Requires the `gen2` execution environment (the default).
- **Single instance by design.** `min_instance_count = max_instance_count = 1`.
  code-server holds per-session editor state in memory and owns one workspace volume;
  scaling beyond one instance would split sessions and risk concurrent writes to the
  same volume.
- **Health probes hit `/healthz`, not `/health`.** `/healthz` is unauthenticated and
  returns `200` once the server is listening; `/health` returns `401` when a password
  is set and would fail the probe.
- **The image is a thin wrapper over `codercom/code-server`**, built and mirrored into
  Artifact Registry via Cloud Build; `latest` pins to `4.99.1` at build time.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the code-server service

code-server runs as a Cloud Run v2 service listening on port 8080. Each deployment
creates an immutable revision; because the app is single-instance and stateful, keep
`min = max = 1` and avoid traffic splitting across concurrent revisions.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" --filter="metadata.name~codeserver"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud Storage — the workspace volume

The single stateful resource. A dedicated **Cloud Storage** bucket is provisioned
automatically and mounted as a **GCS FUSE** volume at `/home/coder`, holding the
user's workspace, VS Code settings, and installed extensions. It survives revision
redeploys and scale events.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~codeserver"
  gcloud storage ls gs://<workspace-bucket>/          # bucket name is in the Outputs
  ```

GCS FUSE requires the `gen2` execution environment (the default). See
[App_CloudRun](App_CloudRun.md) for GCS FUSE and CMEK options.

### C. Secret Manager — the editor password

When `enable_password = true` (default), a 24-character random `PASSWORD` is generated
and stored in Secret Manager, then injected as the container's `PASSWORD` env var to
gate the login page. There is no database password (no database).

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~codeserver AND name~password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for secret injection and rotation details.

### D. Networking & ingress

The service defaults to **`internal` ingress** — reachable only from within the VPC.
To make the editor usable from a browser on the public internet, set
`ingress_settings = "all"` (keep the password enabled), or layer an external HTTPS
load balancer with a custom domain, Cloud CDN, and Cloud Armor.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies. A public endpoint is required for an
uptime check to reach the service.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. code-server Application Behaviour

- **No first-deploy database setup.** code-server has no SQL database and no
  initialization job. The service comes up as soon as the container starts and binds
  to `0.0.0.0:8080` (set via `BIND_ADDR`).
- **No migrations.** Upgrading the `application_version` simply rolls a new revision
  on the newer image; there is no schema to migrate.
- **The workspace is the only durable state.** Everything under `/home/coder` — open
  folders, `settings.json`, keybindings, and every installed extension — persists in
  the GCS FUSE bucket. Deleting the bucket wipes the workspace.
- **Login is gated by the `PASSWORD` secret.** With `enable_password = true`, the
  editor prompts for the generated password. Retrieve it from Secret Manager (§2C).
  With it disabled, anyone reaching the URL gets an unauthenticated IDE — only run
  that way behind `internal` ingress.
- **Health path.** Startup and liveness probes target the unauthenticated `/healthz`
  endpoint (returns `200` once the HTTP server is listening). Do **not** point probes
  at `/health` when a password is set — it returns `401` and the revision never
  becomes Ready. Verify the running revision's env and port:
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
- **Single-instance scaling.** Keep `min = max = 1`. Editor sessions are held in
  memory and the workspace volume has a single writer.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for code-server are listed; every other input is
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
| `application_name` | `codeserver` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `code-server` | Human-readable name shown in the Console. |
| `application_version` | `latest` | code-server image tag; `latest` pins to `4.99.1` at build time. Pin to a specific release in production. |
| `enable_password` | `true` | Generate a random editor `PASSWORD` and require it at login. **Leave enabled for any publicly reachable deployment.** |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance; raise for heavy language servers. |
| `memory_limit` | `1Gi` | Memory per instance; size to the workspaces and extensions you run. |
| `min_instance_count` | `1` | Keep at 1 — single-instance editor; avoids cold-start delays during index loading. |
| `max_instance_count` | `1` | Keep at 1 — one workspace volume, in-memory session. |
| `container_port` | `8080` | code-server listens on 8080. |
| `execution_environment` | `gen2` | Required for GCS FUSE (workspace mount) and NFS. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | code-server has no Cloud SQL — keep false. |
| `enable_image_mirroring` | `true` | Mirror the code-server image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `internal` | Private by default. Set `all` for public browser access (keep the password on). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of the editor. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings (e.g. `{ TZ = "UTC" }`). `BIND_ADDR` is set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is off by default; the workspace uses GCS FUSE, not NFS. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path if NFS is enabled. |
| `gcs_volumes` | `[]` | Additional GCS FUSE mounts; the workspace bucket is added automatically at `/home/coder`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Not referenced — code-server has no SQL database; fixed to `NONE` by CodeServer_Common. |
| `database_password_length` | `32` | Not referenced — forwarded to the foundation for compatibility. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthz` 15s delay | Startup probe; uses the unauthenticated endpoint. |
| `liveness_probe` | HTTP `/healthz` 30s delay | Liveness probe; uses the unauthenticated endpoint. |
| `health_check_config` | HTTP `/health` | Alternative structured probe (authed endpoint). |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Optional Cloud Monitoring uptime check (needs a public endpoint). |
| `alert_policies` | `[]` | Metric alert policies. |

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
| `codeserver_url` | URL of the code-server editor (port 8080). Reachable only within the VPC when ingress is `internal`. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (the workspace bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any user-supplied init jobs (none by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a `gen1` runtime with GCS FUSE/NFS mounts, IAP with no authorized identities, an out-of-range `timeout_seconds`, and so on. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_password` | `true` (keep on for public ingress) | Critical | Disabling with `ingress_settings = "all"` exposes a fully unauthenticated IDE — including a terminal — to the internet. |
| Workspace bucket | Never delete | Critical | The GCS FUSE bucket at `/home/coder` is the only persistent state; deleting it wipes all settings, extensions, and files. |
| `startup_probe` / `liveness_probe` path | `/healthz` | High | Pointing probes at `/health` while a password is set returns `401`; the revision never becomes Ready. |
| `max_instance_count` | `1` | High | Scaling beyond 1 splits editor sessions across instances and risks concurrent writes to the single workspace volume. |
| `min_instance_count` | `1` | Medium | Scale-to-zero (`0`) adds cold-start latency and re-mounts the workspace on the next request. |
| `execution_environment` | `gen2` | High | `gen1` cannot mount GCS FUSE — the workspace volume fails and state is lost on restart. |
| `ingress_settings` | `internal` (or `all` + password) | High | `all` without a password publishes an open IDE; `internal` blocks all browser access from outside the VPC. |
| `enable_cloudsql_volume` | `false` | Low | code-server has no database; enabling adds an unused Auth Proxy sidecar. |
| `memory_limit` | `1Gi`+ | Medium | Heavy language servers/extensions can OOM below 1 GiB. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. code-server-specific application configuration
shared with the GKE variant is described in
**[CodeServer_Common](CodeServer_Common.md)**.
