---
title: "Docuseal on Google Cloud Run"
description: "Configuration reference for deploying Docuseal on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Docuseal on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Docuseal_CloudRun.png" alt="Docuseal on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

DocuSeal is an open-source document-signing platform — a self-hosted DocuSign
alternative for creating, filling, and signing PDF documents with a visual form
builder, reusable templates, and audit trails. This module deploys DocuSeal on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services DocuSeal uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

DocuSeal runs as a single Ruby on Rails (Puma) container on Cloud Run v2. The
deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Rails/Puma service on port 3000, 2 vCPU / 4 GiB by default |
| Database | Cloud SQL for PostgreSQL 15 | Required — DocuSeal does not support MySQL or other engines |
| Persistent documents | Filestore / NFS | `enable_nfs = true`; uploaded documents live at `/data/docuseal` |
| Object storage | Cloud Storage | One bucket provisioned automatically (not the default document store) |
| Secrets | Secret Manager | Auto-generated `SECRET_KEY_BASE`; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup.
- **DocuSeal connects over private-IP TCP, not the Cloud SQL socket.** Ruby's URI
  parser cannot parse the Cloud SQL Unix-socket DSN, so `enable_cloudsql_volume`
  defaults to `false` and the entrypoint composes a `DATABASE_URL` against the
  instance private IP with `sslmode=require`.
- **`SECRET_KEY_BASE` is generated automatically** and stored in Secret Manager. It
  must never be rotated after first boot — doing so invalidates all signed session
  cookies, logging every user out.
- **Uploaded documents live on NFS, not in the container.** `enable_nfs = true`
  mounts the shared NFS volume at `/data/docuseal`; without it, every uploaded
  document is lost on the next revision or cold start.
- **One instance is kept warm by default** (`min_instance_count = 1`,
  `cpu_always_allocated = true`). DocuSeal is a request/response app whose documents
  live on durable NFS, so it can safely scale to zero — set `min_instance_count = 0`
  to trade first-request latency for cost.
- **No Redis.** DocuSeal uses a PostgreSQL-backed queue/cache, so no Redis is required
  or wired (`enable_redis = false`).
- **Public ingress by default.** `ingress_settings = "all"` so the signing UI and any
  signer/API links are reachable. Enabling IAP puts a Google-sign-in gate in front of
  those links.
- **Migrations run on boot.** DocuSeal applies its own ActiveRecord migrations on
  every start; the only init job creates the PostgreSQL role and database.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the DocuSeal service

DocuSeal runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~docuseal"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

DocuSeal stores all application data (templates, submissions, submitters, users,
audit trail) in a managed Cloud SQL for PostgreSQL 15 instance. Because Ruby cannot
parse the Cloud SQL socket DSN, the service connects over the instance **private IP**
with `sslmode=require` (the `DB_IP` the foundation injects), reachable via VPC egress;
no public IP is exposed. On first deploy an initialization Job creates the application
database and role.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=docuseal --database=docuseal --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model,
backups, and password rotation.

### C. Filestore / NFS — persistent documents

DocuSeal writes uploaded documents and attachments to the local filesystem at
`/data/docuseal`. `enable_nfs = true` mounts the shared NFS (Filestore-class) volume
there so documents survive revisions and cold starts.

- **Console:** Filestore → Instances (or Compute Engine for the self-managed NFS VM,
  depending on the platform configuration).
- **CLI:**
  ```bash
  # Confirm the NFS mount and WORKDIR on the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='yaml(spec.template.spec.volumes, spec.template.spec.containers[0].volumeMounts)'
  ```

See [App_CloudRun](App_CloudRun.md) for how the shared NFS server is discovered and
mounted.

### D. Cloud Storage

One **Cloud Storage** bucket (name suffix `storage`) is provisioned automatically and
the workload service account is granted access. DocuSeal's document store defaults to
the NFS volume above, so this bucket is available for auxiliary use rather than the
primary document store.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/          # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### E. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager:
`SECRET_KEY_BASE` (used by Rails to sign session cookies and other signed values). The
database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~docuseal"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default, which allows the public
access needed for signer links and the signing UI. An external HTTPS load balancer
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

Container logs (Rails logs to stdout) flow to Cloud Logging; Cloud Run and Cloud SQL
metrics flow to Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Docuseal Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It idempotently creates the `docuseal` role and database,
  grants full privileges, and reassigns ownership of the `public` schema to the app
  role (PostgreSQL 15 no longer grants `CREATE` on `public` by default). The job is
  safe to re-run.
- **Migrations on start.** DocuSeal runs its own ActiveRecord migrations automatically
  on every boot as the application role, so upgrading the application version applies
  schema changes without a separate migration step.
- **`SECRET_KEY_BASE` is immutable after first boot.** It is generated once and written
  to Secret Manager. Rotating it invalidates all signed session cookies, forcing every
  user to log in again. Only rotate during a planned maintenance window.
- **Health path.** Startup, liveness, and readiness probes target `/up` — Rails'
  built-in health endpoint, which returns an unauthenticated `200` once the app is up.
  The default startup probe allows a 60-second initial delay plus a wide retry window
  for first-boot migrations.
- **First-run setup.** DocuSeal has no default credentials. On first access, open the
  service URL and complete the setup screen to create the initial administrator
  account (email + password) before inviting other users or creating templates.
- **Persistent documents.** Uploaded documents live at `/data/docuseal` on the NFS
  volume. Verify the injected connection and work directory on the running revision:
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for DocuSeal are listed; every other input is inherited from
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
| `application_name` | `docuseal` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | DocuSeal image tag (`FROM docuseal/docuseal:<tag>`); pin to a specific release in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance (2 vCPU). |
| `memory_limit` | `4Gi` | Memory per instance. |
| `min_instance_count` | `1` | Instances kept warm. DocuSeal tolerates `0` (scale-to-zero) since documents live on NFS. |
| `max_instance_count` | `5` | Maximum instances. |
| `container_port` | `3000` | Puma listens on 3000. Do not change. |
| `container_resources` | `null` | Structured CPU/memory override; when set, overrides `cpu_limit`/`memory_limit`. |
| `execution_environment` | `gen2` | Gen2 required for NFS mounts (and imposes a 512 MiB memory floor). |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_image_mirroring` | `true` | Mirror the DocuSeal image into Artifact Registry. |
| `container_image_source` | `custom` | Thin wrapper built from `docuseal/docuseal`. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings merged into the container. Core values (`RAILS_LOG_TO_STDOUT`, `WORKDIR`) are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. `SECRET_KEY_BASE` is injected automatically. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

### Group 10 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Mount the shared NFS volume at `/data/docuseal` for persistent documents. **Keep on** or uploads are lost on redeploy. |
| `nfs_mount_path` | `/data/docuseal` | Mount path — must match DocuSeal's `WORKDIR`. |
| `create_cloud_storage` | `true` | Create the declared GCS bucket(s). |
| `gcs_volumes` | `[]` | Optional GCS Fuse volume mounts (requires gen2). |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `docuseal` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `docuseal` | Application database user. Password auto-generated in Secret Manager. |
| `enable_cloudsql_volume` | `false` | **Keep `false`** — Ruby cannot parse the Cloud SQL socket DSN; DocuSeal uses private-IP TCP with `sslmode=require`. |
| `database_password_length` | `32` | Generated password length (16–64). |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (creates role + database). |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/up`, 60s delay | Startup probe. Allow time for first-boot migrations. |
| `liveness_probe` | HTTP `/up`, 60s delay | Liveness probe against the Rails health endpoint. |
| `uptime_check_config` | disabled, path `/` | Cloud Monitoring uptime check (public endpoints only); set `enabled = true` to provision it. |

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | DocuSeal uses a PostgreSQL-backed queue/cache; leave off. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `SECRET_KEY_BASE` (auto-generated) | Never rotate after first boot | Critical | Rotating invalidates all signed session cookies — every user is logged out. |
| `enable_nfs` | `true` | Critical | Disabling it stores documents on the ephemeral container disk; every uploaded document is lost on the next revision or cold start. |
| `nfs_mount_path` | `/data/docuseal` | Critical | Must match DocuSeal's `WORKDIR`; a mismatched path means documents write to non-persistent storage. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_cloudsql_volume` | `false` | High | Ruby cannot parse the Cloud SQL socket DSN; enabling the socket sidecar breaks the `DATABASE_URL` and startup fails. |
| `container_port` | `3000` | High | Puma listens on 3000; a mismatched port makes probes hit a dead port and the revision never becomes Ready. |
| `execution_environment` | `gen2` | High | Gen1 cannot mount NFS; the app loses persistent document storage. |
| `enable_iap` | only for internal use | High | IAP gates every request behind Google sign-in, blocking public signer links. |
| `memory_limit` | `4Gi` | Medium | PDF rendering/signing is memory-hungry; shrinking too far risks OOM under load. |
| `min_instance_count` | `1` (or `0` for cost) | Medium | Scale-to-zero adds a cold-start delay to the first request after idle; documents on NFS are safe either way. |
| `application_version` | Pin in production | Medium | `latest` can pull a new major on redeploy, applying migrations you did not review. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. DocuSeal-specific application configuration
shared with the GKE variant is described in **[Docuseal_Common](Docuseal_Common.md)**.
