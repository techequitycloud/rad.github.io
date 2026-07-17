---
title: "Coder on Google Cloud Run"
description: "Configuration reference for deploying Coder on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Coder on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Coder_CloudRun.png" alt="Coder on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Coder is an open-source, self-hosted platform for provisioning remote development environments (workspaces) defined as code with Terraform — developers get consistent, ready-to-code environments while platform teams keep source and dependencies on their own infrastructure. This module deploys the Coder control plane on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Coder uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run application — service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Coder runs as a single Go binary (`coder server`) in a container on Cloud Run v2. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Go control-plane service, 2 vCPU / 4 GiB by default, always-allocated CPU |
| Database | Cloud SQL for PostgreSQL 15 | Required — Coder needs PostgreSQL 13+; MySQL is rejected at plan time |
| Object storage | Cloud Storage | A `storage` bucket provisioned automatically (available for operator use) |
| Image build | Cloud Build + Artifact Registry | Thin custom wrapper built FROM `ghcr.io/coder/coder` |
| Secrets | Secret Manager | Database password managed automatically — Coder needs no app secret of its own |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** Coder requires PostgreSQL 13+; a plan-time validation rejects MySQL engines.
- **The control plane is stateless.** All state — templates, workspaces, users, sessions, the build queue, and Coder's self-generated signing keys — lives in PostgreSQL. No NFS, no Redis, no Common-managed application secret.
- **`cpu_always_allocated = true` and `min_instance_count = 1`.** `coder server` runs built-in provisioner daemons in-process that continuously poll the database for pending workspace builds and terminate workspace agent connections — this background work stalls under request-based CPU throttling or scale-to-zero.
- **The connection URL is assembled at runtime.** The custom entrypoint builds `CODER_PG_CONNECTION_URL` (a `postgres://` URL with a URL-encoded password) from the Foundation-injected `DB_*` variables, preferring the private-IP TCP path with `sslmode=require` on Cloud Run.
- **`CODER_ACCESS_URL` is set automatically** from the injected Cloud Run service URL, so workspace/agent connection URLs and OAuth redirect URIs are correct out of the box.
- **A `db-init` job runs on every apply** to idempotently create the Coder database and role; Coder runs its own schema migrations on server boot.
- **Health probes target `/healthz`** (unauthenticated) with a 60-second initial delay for first-boot schema migration.
- The **database password** is generated automatically and stored in Secret Manager.
- **`application_version = "latest"` maps to a pinned tag** (`v2.24.1`) via the app-specific `CODER_VERSION` build ARG — Coder's GHCR tags are semver-prefixed.

> This module deploys the Coder **control plane**. Provisioning actual workspaces additionally requires a configured provisioner and a compute target (e.g. a Kubernetes cluster or a cloud VM template), set up post-deploy through Coder's template system.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Coder service

Coder runs as a Cloud Run v2 service with always-allocated CPU and a warm minimum instance, so the in-process provisioner daemons keep polling for workspace builds even with no inbound requests. Each deployment creates an immutable revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Coder stores everything — users, organizations, templates, workspace state, provisioner job queue, and its signing keys — in a managed Cloud SQL for PostgreSQL 15 instance. The service connects over private IP with `sslmode=require` (Coder's URL-form DSN cannot carry the Unix-socket path); the `db-init` Job creates the application database and role on first deploy.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model, backups, and password rotation.

### C. Cloud Storage

A dedicated **Cloud Storage** bucket (suffix `storage`) is provisioned automatically. Coder does not require it for control-plane operation — the control plane keeps no files on disk — but it is available for template assets or operator use.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

### D. Cloud Build & Artifact Registry

`container_image_source = "custom"` triggers a Cloud Build that wraps `ghcr.io/coder/coder:<version>` with the cloud entrypoint and pushes the result to Artifact Registry (the base image is mirrored first, `enable_image_mirroring = true`).

- **Console:** Cloud Build → History; Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --limit 5
  ```

### E. Secret Manager

The database password is the only secret in the deployment — stored in Secret Manager and injected at runtime as `DB_PASSWORD`, then URL-encoded into the connection URL by the entrypoint. Coder self-generates its signing keys and persists them in PostgreSQL, so no session/app secret exists to manage.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default; the entrypoint exports that URL as `CODER_ACCESS_URL`, from which Coder builds workspace and agent connection URLs. An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs (structured, to STDOUT) flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Coder Application Behaviour

- **First-deploy database setup.** A `db-init` Job (`postgres:15-alpine`) connects as the `postgres` superuser and idempotently creates the Coder role (`LOGIN CREATEDB`), creates the database, grants all privileges, and reassigns ownership of schema `public` to the app role (Coder's migrations create all objects there). The job runs on every apply and is safe to re-run.
- **Migrations run on boot.** Coder applies its own schema migrations every time `coder server` starts — version upgrades need no manual migrate step. First boot against a fresh database takes longer; the startup probe allows up to ~8 minutes before giving up.
- **Runtime DSN assembly.** The cloud entrypoint builds `CODER_PG_CONNECTION_URL` from `DB_HOST`/`DB_IP`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`: on Cloud Run it prefers the private IP with `sslmode=require` (the Cloud SQL socket path cannot live in a URL authority); the password is percent-encoded so special characters never break the URL. An explicitly provided `CODER_PG_CONNECTION_URL` wins.
- **Access URL.** `CODER_ACCESS_URL` is set from the injected `CLOUDRUN_SERVICE_URL`. Coder builds workspace/agent connection URLs and OAuth redirect URIs from it — if you front the service with a custom domain, set `CODER_ACCESS_URL` in `environment_variables` to that domain.
- **No app secrets.** Coder generates and persists its signing keys in PostgreSQL. Container recreation, scaling, and redeploys are safe; nothing desyncs.
- **First-run setup.** The first visit to the service URL prompts you to create the initial admin (owner) account — complete it promptly, as the endpoint is publicly reachable until then (`ingress_settings = "all"` by default).
- **Workspace provisioning is a day-2 step.** The control plane alone runs no workspaces. Create a template (Terraform) pointing at a compute target — e.g. a GKE cluster or GCE VMs — and ensure the provisioner has credentials for it.
- **Health path.** Startup, liveness, and readiness probes target `/healthz`, which Coder serves unauthenticated with HTTP 200 once the server is up.

Verification:

```bash
SERVICE_URL=$(gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)')
curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/healthz"     # expect 200
curl -s "$SERVICE_URL/api/v2/buildinfo"                             # Coder version info
```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for Coder are listed; every other input is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

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

All other inputs follow standard App_CloudRun behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `coder` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Coder` | Friendly name shown in the Console. |
| `application_version` | `latest` | Coder release tag; `latest` maps to the pinned `v2.24.1` via the `CODER_VERSION` build ARG. Increment to trigger a new image build and revision. |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `2000m` | CPU per instance. |
| `memory_limit` | `4Gi` | Memory per instance; Coder requires at least 2Gi for reliable operation. |
| `min_instance_count` | `1` | Keep ≥ 1 — the in-process provisioner daemons must stay warm to pick up workspace builds. |
| `max_instance_count` | `5` | Cost ceiling. |
| `cpu_always_allocated` | `true` | Instance-based billing. Keep `true` — provisioner polling and agent connections stall under request-based throttling. Set `false` only for a UI-only evaluation. |
| `container_port` | `3000` | Coder's HTTP port (`CODER_HTTP_ADDRESS = 0.0.0.0:3000`). |
| `container_image_source` | `custom` | Required — the upstream image lacks the entrypoint that assembles the DB connection URL and access URL. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar; the entrypoint still connects over private-IP TCP because Coder's URL-form DSN cannot carry the socket path. |
| `enable_image_mirroring` | `true` | The GHCR base image is mirrored into Artifact Registry before the build. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Coder must be reachable by developers and workspace agents; restrict with IAP or Cloud Armor rather than internal-only ingress. |
| `enable_iap` | `false` | Require Google sign-in in front of Coder's own authentication. |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra `CODER_*` configuration (e.g. `CODER_OIDC_*` for SSO, `CODER_ACCESS_URL` for a custom domain). `CODER_HTTP_ADDRESS`, `CODER_TELEMETRY_ENABLE=false`, and `CODER_VERBOSE=false` are pre-set by `Coder_Common`. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g. an OIDC client secret). |

All other inputs follow standard App_CloudRun behaviour.

### Groups 7–10 — Backup, CI/CD, Custom SQL, LB & CDN

Standard App_CloudRun behaviour — see [App_CloudRun](App_CloudRun.md). Key inputs: `backup_schedule`, `enable_backup_import`, `enable_cicd_trigger`, `enable_binary_authorization`, `enable_cloud_armor`, `application_domains`, `enable_cdn`.

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Not required — the control plane is stateless; all state lives in PostgreSQL. |
| `nfs_mount_path` | `/home/coder/data` | Only when `enable_nfs=true`. Must be a real directory — never a subpath of `/opt/coder`, which is the coder **binary** (a file); mounting over it prevents container start. |

All other inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Coder requires PostgreSQL 13+ — MySQL is rejected by a plan-time validation. |
| `db_name` | `coder` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `coder` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64); special characters are safe — the entrypoint URL-encodes the password. |

All other inputs follow standard App_CloudRun behaviour.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (`postgres:15-alpine`). |
| `cron_jobs` | `[]` | Recurring jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthz`, 60s initial delay, 30 failures | Generous threshold (~8 min) for first-boot schema migration against a fresh Cloud SQL instance. |
| `liveness_probe` | HTTP `/healthz`, 60s initial delay | Liveness probe against Coder's unauthenticated health endpoint. |
| `uptime_check_config` | disabled, path `/` | Cloud Monitoring uptime check; point it at `/healthz` when enabling. |

All other inputs follow standard App_CloudRun behaviour.

### Group 21 — Redis / Group 22 — VPC-SC

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not required — sessions and the build queue live in PostgreSQL. |
| `enable_vpc_sc` | `false` | Standard perimeter enforcement — see [App_CloudRun](App_CloudRun.md). |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service (Coder's access URL). |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets (includes the `storage` bucket). |
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

Plan-time validations in `validation.tf` catch the worst combinations early: min/max instance ordering, Redis-without-a-host, non-PostgreSQL engines, and a Cloud SQL proxy sidecar with `database_type = "NONE"`.

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Coder requires PostgreSQL 13+; MySQL is rejected at plan time. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all templates, workspaces, users, and signing keys. |
| `container_image_source` | `custom` | Critical | The upstream image cannot assemble `CODER_PG_CONNECTION_URL` from the Foundation `DB_*` vars — the server never connects to PostgreSQL. |
| `container_port` | `3000` | Critical | Must match `CODER_HTTP_ADDRESS = 0.0.0.0:3000`; a mismatch fails every health probe. |
| `cpu_always_allocated` | `true` | High | Under request-based billing the in-process provisioner daemons are throttled to ~0 between requests — workspace builds silently stall. |
| `min_instance_count` | `1` | High | At `0` the control plane scales to zero and no provisioner is polling — queued workspace builds wait until the next inbound request wakes an instance. |
| `memory_limit` | `4Gi` (≥ `2Gi`) | High | Below 2Gi the Go server risks OOM during workspace build bursts and template imports. |
| `application_version` | pinned tag (e.g. `v2.24.1`) | High | Coder's GHCR tags are semver-prefixed (`vX.Y.Z`); `latest` is mapped to a pin by the module — override only with a real tag. |
| `startup_probe` path / delay | `/healthz`, 60s | High | Pointing probes at an authenticated path returns 401/403 and the revision never becomes ready; cutting the threshold kills first boots mid-migration. |
| `CODER_ACCESS_URL` (via `environment_variables`) | service URL (auto) or custom domain | High | A wrong access URL breaks workspace agent connections and OAuth redirect URIs — set it explicitly when fronting with a custom domain. |
| `enable_nfs` / `nfs_mount_path` | `false` / real directory | High | NFS is unnecessary; if enabled, a mount under `/opt/coder` shadows the coder binary and the container cannot start. |
| `enable_redis` | `false` | Medium | Coder never reads Redis; enabling it provisions an endpoint nothing uses. |
| `enable_iap` / `enable_cloud_armor` | enable for private teams | Medium | Until the first admin account is created, the setup page is publicly reachable at the `run.app` URL. |
| `enable_backup_import` | `false` unless restoring | Medium | Enabling without a valid `backup_file` fails the import job. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. Coder-specific application configuration shared with the GKE variant is described in **[Coder_Common](Coder_Common.md)**.
