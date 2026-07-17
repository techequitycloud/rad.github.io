---
title: "CloudBeaver on Google Cloud Run"
description: "Configuration reference for deploying CloudBeaver on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# CloudBeaver on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CloudBeaver_CloudRun.png" alt="CloudBeaver on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

CloudBeaver is a web-based, browser-accessible database manager from the DBeaver
project — a single administrative console for connecting to and querying PostgreSQL,
MySQL, SQL Server, Oracle, SQLite and many other engines. This module deploys
CloudBeaver on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md)
foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services CloudBeaver uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load balancing,
scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

CloudBeaver runs as a single JVM container on Cloud Run v2. Because CloudBeaver keeps
all of its own state in a persistent workspace and provisions no application database,
the deployment wires together a deliberately small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single JVM service, 1 vCPU / 1 GiB by default, port 8978 |
| Persistent workspace | Cloud Storage (GCS FUSE) | A dedicated bucket mounted at `/opt/cloudbeaver/workspace` holds all CloudBeaver state |
| Database | **None provisioned** | `database_type = "NONE"` — CloudBeaver stores its own state; it *connects out* to databases you configure in the UI |
| Cache & queue | **None** | CloudBeaver uses no Redis; `enable_redis` is forced off |
| Secrets | Secret Manager | No app-level secret is generated — the admin account is created via the first-run setup wizard |
| Ingress | Cloud Run URL / Cloud Load Balancing | **`internal` by default** (VPC-only); layer an external HTTPS LB or set `ingress_settings = "all"` for public access |

**Sensible defaults worth knowing up front:**

- **No application database is provisioned.** `database_type = "NONE"`. CloudBeaver
  keeps its metadata in an embedded H2 store inside the workspace volume. The
  databases it *manages* are added by an operator in the UI after deploy.
- **All state lives in one GCS-backed workspace.** The `storage` bucket is mounted via
  GCS FUSE at `/opt/cloudbeaver/workspace`. Lose or replace that bucket and you lose
  every saved connection, user and setting.
- **Single instance by design.** `min_instance_count = 1` (avoid slow JVM cold starts)
  and `max_instance_count = 1` (the workspace is a single-writer store). Do **not**
  raise `max_instance_count` — concurrent writers corrupt the embedded H2 database.
- **Ingress is `internal` by default.** The service is reachable only from within the
  VPC — appropriate for a database admin console. For browser access from outside the
  VPC, front it with an external HTTPS load balancer (and IAP) or set
  `ingress_settings = "all"`.
- **The admin account is claimed by the first visitor.** CloudBeaver has no seeded
  admin — complete the setup wizard immediately once the service is reachable.
- **`application_version = "latest"` passes through cleanly.** The image is built from
  `dbeaver/cloudbeaver:<version>` via an app-specific `CLOUDBEAVER_VERSION` build ARG;
  pin a specific tag for reproducible deployments.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the CloudBeaver service

CloudBeaver runs as a Cloud Run v2 service listening on port **8978**. Each deployment
creates an immutable revision; traffic can be split across revisions for safe
rollouts. Because the workspace is single-writer, keep the service at a single
instance.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the container port and image:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].ports[0].containerPort, spec.template.spec.containers[0].image)'
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud Storage — the workspace volume

CloudBeaver's entire state — its embedded H2 metadata database, saved connections,
users, and configuration — persists under `/opt/cloudbeaver/workspace`, which is a
**GCS FUSE** mount of a dedicated Cloud Storage bucket (the `storage` bucket declared
by CloudBeaver_Common). This bucket is the durable heart of the deployment.

- **Console:** Cloud Storage → Buckets → the CloudBeaver `storage` bucket.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<workspace-bucket>/          # bucket name is in the Outputs
  gcloud storage ls -r gs://<workspace-bucket>/       # inspect workspace contents
  ```

See [App_CloudRun](App_CloudRun.md) for GCS FUSE (requires the gen2 execution
environment) and CMEK options.

### C. Database connectivity (no managed instance)

This module provisions **no Cloud SQL instance** — `gcloud sql instances list` will
not show one created by CloudBeaver. Instead, CloudBeaver connects out to whatever
databases you register in its UI. To reach the deployment's own shared Cloud SQL (or
any private database), the service must have VPC egress configured (managed by the
foundation) and the target must be reachable on the VPC.

- **CLI (verify egress path exists, then test from within the VPC):**
  ```bash
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.metadata.annotations)'   # VPC connector / egress annotations
  ```

### D. Secret Manager

CloudBeaver generates **no application-level secret** — there is no encryption key,
no JWT secret, and no database password to manage (there is no database). The admin
account is created through the first-run setup wizard, and all state lives in the
workspace. Foundation-level secrets (if any) follow the standard model.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  ```

### E. Networking & ingress

The service defaults to **`ingress_settings = "internal"`** — reachable only from
inside the VPC, which suits a database administration console. The `cloudbeaver_url`
output is the internal service URL in that mode. For browser access from outside the
VPC, front the service with an external HTTPS load balancer (optionally with a custom
domain, Cloud CDN, Cloud Armor, and IAP), or set `ingress_settings = "all"`.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for load balancing, custom domains, and IAP.

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring, with
optional uptime checks and alert policies. Note that a Cloud Monitoring uptime check is
only provisioned when the endpoint is publicly reachable — with the default
`internal` ingress there is no public endpoint to probe.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. CloudBeaver Application Behaviour

- **No first-deploy database setup.** There is no db-init job and no application
  database. CloudBeaver initialises its own embedded metadata store inside the
  workspace on first start.
- **State is entirely in the workspace volume.** The embedded H2 database, saved
  connections, managed users, and configuration all live under
  `/opt/cloudbeaver/workspace`, backed by the GCS `storage` bucket. Preserve that
  bucket across redeploys to keep all CloudBeaver state.
- **First-run setup wizard.** On first access CloudBeaver presents a setup wizard to
  create the server configuration and the administrator account. There is no seeded
  admin — whoever completes the wizard first becomes the admin. Do this immediately,
  and keep ingress restricted until you have.
- **Adding databases to manage.** After logging in as admin, add connections in the
  UI (New Connection → choose the driver → supply host/port/credentials). To reach
  private databases on the VPC, ensure VPC egress is configured (foundation-managed).
- **Health path.** Startup and liveness probes target `/` (the CloudBeaver web UI),
  which returns HTTP 200 once the JVM has finished starting. The default startup probe
  allows a 15-second initial delay plus a 10-failure retry window — CloudBeaver's JVM
  boot is quick but not instant.
- **Single-writer scaling.** Keep `max_instance_count = 1`. The workspace store cannot
  be shared safely by concurrent instances.
- **Inspect the running configuration:**
  ```bash
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for CloudBeaver are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `application_name` | `cloudbeaver` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | _(set)_ | Human-readable name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `latest` | CloudBeaver image tag (built from `dbeaver/cloudbeaver:<version>`); pin for reproducibility. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `1Gi` | Memory per instance. CloudBeaver runs on the JVM — do not shrink below 512Mi. |
| `min_instance_count` | `1` | Keep 1 warm instance to avoid slow JVM cold starts. |
| `max_instance_count` | `1` | **Keep at 1.** The workspace is a single-writer store; concurrent instances corrupt it. |
| `container_port` | `8978` | CloudBeaver web UI port. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `internal` | VPC-only by default (recommended for a DB console). Use `all` or an HTTPS LB for external access. |
| `vpc_egress_setting` | _(set)_ | Controls which egress traffic routes via the VPC — required to reach private databases. |
| `enable_iap` | `false` | Require Google sign-in in front of the service (needs an external LB). |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings passed to the container. CloudBeaver needs none for first boot. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. No app secret is generated by default. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the GCS buckets, including the CloudBeaver workspace bucket. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned workspace bucket. |
| `enable_nfs` | `false` | NFS is off — CloudBeaver's workspace is on GCS, not NFS. |
| `gcs_volumes` | `[]` | Additional GCS FUSE volume mounts (the workspace mount is added automatically). |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Empty — CloudBeaver needs no bootstrap job (no application database). |
| `cron_jobs` | `[]` | No platform-scheduled recurring tasks. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 15s delay, 10 failures | Startup probe against the CloudBeaver UI. |
| `liveness_probe` | HTTP `/` 30s delay | Liveness probe against the CloudBeaver UI. |
| `uptime_check_config` | _(set)_ | Cloud Monitoring uptime check — only provisioned when the endpoint is publicly reachable. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour. Note that
`enable_redis` is forced to `false` and `database_type` is `NONE` by this module and
are not intended to be overridden.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `cloudbeaver_url` | Service URL for the CloudBeaver web UI (port 8978). Internal VPC URL when `ingress_settings = "internal"`. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (including the workspace bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any initialization jobs (empty by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a `gen1` runtime with GCS FUSE mounts, IAP with no authorized identities, an out-of-range memory value below the gen2 512Mi floor. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| Workspace `storage` bucket | Preserve across redeploys | Critical | The bucket holds all CloudBeaver state (embedded H2 DB, connections, users, config). Deleting or replacing it wipes every setting. |
| `max_instance_count` | `1` | Critical | The workspace is single-writer; two instances writing the embedded H2 store concurrently corrupt it. |
| First-run setup wizard | Complete immediately | High | There is no seeded admin — anyone who reaches the UI first can claim the administrator account. |
| `ingress_settings` | `internal` (or LB+IAP) | High | Setting `all` without IAP/Cloud Armor exposes a database admin console to the public internet. |
| `memory_limit` | `1Gi` (≥ 512Mi) | High | CloudBeaver is JVM-based; too little memory causes OOM kills. gen2 rejects below 512Mi at plan time. |
| `min_instance_count` | `1` | Medium | Scale-to-zero (`0`) adds a slow JVM cold-start delay on the first request after idle. |
| `application_version` | Pin a tag in production | Medium | `latest` can shift the CloudBeaver version between rebuilds; pin for reproducibility. |
| `enable_redis` / `database_type` | Leave as set (off / `NONE`) | Low | CloudBeaver uses neither; overriding has no benefit and is unsupported here. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. CloudBeaver-specific application configuration
shared with the GKE variant is described in
**[CloudBeaver_Common](CloudBeaver_Common.md)**.
