---
title: "WriteFreely on Google Cloud Run"
description: "Configuration reference for deploying WriteFreely on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# WriteFreely on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/WriteFreely_CloudRun.png" alt="WriteFreely on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

WriteFreely is an open-source, minimalist, federated blogging platform written in Go
— a lightweight Medium alternative for publishing clean, distraction-free writing.
This module deploys WriteFreely on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services WriteFreely uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load balancing,
scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

WriteFreely runs as a single Go container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Go service, 1 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero enabled |
| Database | Cloud SQL for MySQL 8.0 | Required — the module fixes `MYSQL_8_0`; reached over **private-IP TCP** |
| Object storage | Cloud Storage | A dedicated `writefreely-uploads` data bucket provisioned automatically |
| Secrets | Secret Manager | Three auto-generated AES-256 key secrets; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is the fixed engine.** `database_type = MYSQL_8_0` is set by the shared
  application layer. WriteFreely upstream also supports SQLite/PostgreSQL, but this
  module standardises on Cloud SQL for MySQL.
- **Cloud SQL is reached over private-IP TCP, not a socket.** On Cloud Run
  `enable_cloudsql_volume = false` — `DB_HOST` is the Cloud SQL private IP and
  WriteFreely's `go-sql-driver` config connects over plain TCP (Cloud SQL MySQL
  accepts unencrypted private-IP TCP). This differs from the GKE variant, which uses
  the Auth Proxy sidecar on `127.0.0.1`.
- **The three AES-256 keys are generated automatically** and stored in Secret Manager
  (`cookies-auth`, `cookies-enc`, `email-key`). They must **never** be rotated after
  first boot — rotating them logs out every user and makes previously encrypted email
  data undecryptable.
- **A custom image is built, not pulled prebuilt.** `container_image_source = custom`:
  the thin config-gen wrapper (renders `config.ini`, seeds the keys, runs
  `writefreely db init`) is built by Cloud Build and pushed to Artifact Registry.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`,
  `max_instance_count = 1`). Cold starts add a few seconds to the first request after
  idle; set `min_instance_count = 1` to keep the blog always warm.
- **No admin account is created automatically.** Registration is closed
  (`open_registration = false`); create the first account as a post-deploy step
  (see §3).
- **WriteFreely is Go — Redis and PHP settings are inert.** The `enable_redis` and
  `php_*` variables come from the module scaffold and are not consumed by WriteFreely.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the WriteFreely service

WriteFreely runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud SQL for MySQL 8.0

WriteFreely stores all application data (blogs, posts, users, sessions) in a managed
Cloud SQL for MySQL 8.0 instance. On Cloud Run the service connects over **private-IP
TCP** (`enable_cloudsql_volume = false`) — no public IP is exposed. On first deploy an
initialization Job (`db-init`) creates the application database and user; the
container entrypoint then runs `writefreely db init` to build the tables.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model,
backups, and password rotation.

### C. Cloud Storage

A dedicated **Cloud Storage** data bucket (`writefreely-uploads`) is provisioned
automatically and the workload service account is granted access. Additional buckets
can be declared via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Secret Manager

Three cryptographic secrets are generated automatically and stored in Secret Manager —
the AES-256 keys WriteFreely uses to sign session cookies (`cookies-auth`), encrypt
cookie payloads (`cookies-enc`), and encrypt stored email addresses (`email-key`).
They are injected as `WF_KEY_COOKIES_AUTH`, `WF_KEY_COOKIES_ENC`, and `WF_KEY_EMAIL`
and written to the container's `keys/` directory on start. The database password is
managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" \
    --filter="name~cookies-auth OR name~cookies-enc OR name~email-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details, and
[WriteFreely_Common](WriteFreely_Common.md) for why these keys must stay stable.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = "all"`).
An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can
be layered on; ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with an optional uptime check and alert policies. The entrypoint logs its
progress (`WriteFreely: rendered config.ini …`, `… seeded stable encryption keys …`,
`… starting server …`), which is useful when diagnosing first boot.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. WriteFreely Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `mysql:8.0-debian`. It creates the application database and user, grants `ALL
  PRIVILEGES` on the database, verifies the app user can connect, and shuts down the
  Cloud SQL Proxy sidecar. The job is idempotent (`CREATE ... IF NOT EXISTS`,
  `max_retries = 3`) and safe to re-run.
- **Schema created on start.** The container entrypoint renders `config.ini` and then
  runs `writefreely db init` on every start to create the tables (tolerant if they
  already exist), so the schema is bootstrapped without a separate migration step.
- **The three AES-256 keys are immutable after first boot.** They are generated once
  and written to Secret Manager. Changing any of them logs out every user (cookie
  signatures no longer validate) and makes previously encrypted email addresses
  undecryptable. Only rotate during a planned maintenance window with the
  understanding that all sessions break.
- **Create the first account after deploy.** Registration is closed by default
  (`open_registration = false`) and no admin is seeded. To create the first account,
  either temporarily set `WF_OPEN_REGISTRATION = "true"` via `environment_variables`,
  register through the UI, then set it back to `"false"`; or run WriteFreely's
  `--create-admin` against the running container.
- **Public URL correctness.** `WF_PUBLIC_URL` is set to the predicted service URL at
  plan time and the entrypoint falls back to the runtime `CLOUDRUN_SERVICE_URL`, so
  generated links use the real `run.app` host. Verify the deployed revision's URL:
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Health path.** The startup probe is **TCP** (Ready as soon as port 8080 is bound)
  and the liveness probe is **HTTP `GET /`** — WriteFreely serves its home page with a
  `200` when healthy; there is no dedicated `/health` endpoint.
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for WriteFreely are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `writefreely` | Base name for resources. Do not change after first deploy. |
| `display_name` | `WriteFreely` | Human-readable name shown in the Console. |
| `application_version` | `latest` | `writeas/writefreely` image tag; `latest` resolves the base image to the pinned `0.12.0` build ARG. Pin a release in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only (secrets, storage, IAM) without the container. |
| `container_image_source` | `custom` | Leave as `custom` — the config-gen wrapper must be built. |
| `cpu_limit` | `1000m` | CPU per instance; 1 vCPU is sufficient for a typical blog. |
| `memory_limit` | `2Gi` | Memory per instance. |
| `min_instance_count` | `0` | `0` enables scale-to-zero; set `1` to avoid cold starts. |
| `max_instance_count` | `1` | Single instance by default. |
| `container_port` | `8080` | WriteFreely's web server binds port 8080. |
| `execution_environment` | `gen2` | Gen2 required for NFS and GCS Fuse mounts. |
| `enable_cloudsql_volume` | `false` | **Off** — Cloud Run reaches MySQL over private-IP TCP, not a socket. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Allow public internet traffic to the blog. |
| `enable_iap` | `false` | Require Google sign-in in front of WriteFreely. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra settings. Use for `WF_SITE_NAME`, `WF_SITE_DESCRIPTION`, `WF_OPEN_REGISTRATION`. Do not set `WF_KEY_*` or `DB_*` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed MySQL engine. |
| `db_name` | `writefreely` | Database name → injected as `DB_NAME`. Immutable after first deploy. |
| `db_user` | `writefreely` | Application user → injected as `DB_USER`. Password auto-generated in Secret Manager. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, 30s delay | Ready as soon as port 8080 is bound. |
| `liveness_probe` | HTTP `/`, 300s delay | Restarts the container if the home page stops responding. |

### Group 21 — Redis (inert for WriteFreely)

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Not consumed** — WriteFreely stores all state in MySQL. Scaffold leftover. |

All other inputs follow standard App_CloudRun behaviour.

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
| `database_host` / `database_port` | DB endpoint (private IP) / port. |
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

> **Inherited plan-time validation.** This module passes its configuration through the
> [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and
> combinations* at plan time — IAP with no authorized identities, a `gen1` runtime
> with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an
> out-of-range `backup_retention_days`. Invalid configuration fails the **plan** with a
> clear, named error before any resource is created, so most mistakes below are caught
> up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| AES-256 keys (`WF_KEY_*`, auto-generated) | Never rotate after first boot | Critical | Rotating logs out every user and makes encrypted email data undecryptable. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `database_type` | `MYSQL_8_0` | Critical | Changing the engine after first deploy orphans the existing data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `container_image_source` | `custom` | High | Setting `prebuilt` without an image that embeds the config-gen entrypoint yields a container that cannot render `config.ini` and fails to start. |
| `enable_cloudsql_volume` | `false` | High | On Cloud Run, forcing the socket without matching entrypoint logic breaks MySQL connectivity; TCP private IP is the tested path. |
| `application_version` | Pin a release | Medium | `latest` can shift the base image across redeploys; pinning keeps builds reproducible. |
| `ingress_settings` | `all` | Medium | `internal` makes the blog unreachable from the public internet. |
| `enable_iap` | Off for a public blog | Medium | IAP blocks all unauthenticated readers. |
| `min_instance_count` | `1` for always-warm | Medium | Scale-to-zero (`0`) adds a cold-start delay on the first request after idle. |
| `WF_OPEN_REGISTRATION` | `false` after first admin | Medium | Leaving registration open lets anyone with the URL create an account. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. WriteFreely-specific application configuration
shared with the GKE variant is described in
**[WriteFreely_Common](WriteFreely_Common.md)**.
