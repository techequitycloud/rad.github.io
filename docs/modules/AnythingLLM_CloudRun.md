---
title: "AnythingLLM on Google Cloud Run"
description: "Configuration reference for deploying AnythingLLM on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# AnythingLLM on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/AnythingLLM_CloudRun.png" alt="AnythingLLM on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

AnythingLLM is a private AI workspace and Retrieval-Augmented Generation (RAG) platform
that lets teams chat with documents, connect to any LLM provider (OpenAI, Anthropic,
Ollama, and others), and build AI-powered knowledge assistants — without sending data to
third-party services. This module deploys AnythingLLM on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google
Cloud infrastructure.

This guide focuses on the cloud services AnythingLLM uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to every
Cloud Run application — service identity, ingress and load balancing, scaling and
concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups,
and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What AnythingLLM costs on RAD, and how that compares

**AnythingLLM on RAD's Cloud Run module costs about US$102 a month in a project you own, with no licence fee for the software itself.** RAD charges a one-off module fee of 110 credits (US$11 at the top-up price) in a project you own, and 99 credits (10% lower) in a project RAD manages. If AnythingLLM needs to run continuously across pods or beside other Kubernetes workloads, see the [GKE guide](AnythingLLM_GKE.md) instead. Figures are as at 8 October 2026; sources are listed at the end of this section.

If you only need it occasionally — studying for a certification, a demo, a seasonal need — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that about US$102 a month becomes close to nothing instead. See **Pause it for free**, below.

### What you pay on RAD

You pay for three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 110 credits (US$11 at the top-up price) | 99 credits (10% lower) |
| Build time | A few credits, metered per minute of build time | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about US$102 a month for the default configuration (table below) | Metered hourly in credits; RAD publishes **32 credits a day**, about 960 a month (about US$96 at the top-up price, US$77 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database and file/cache server are shared by every application in the project, so a second application does not add a second one.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (scaleToZero) | US$31.53 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$102** |

### How it compares

- AnythingLLM's own hosted Cloud offering — the same software, run by its maker — charges **$50/month** (Basic, one private instance) or **$99/month** (Pro, priority resources and a support SLA). RAD runs the identical open-source app on infrastructure you or RAD controls, rather than a third party's shared tenancy.
- **RAD runs the open-source project itself, not a vendor's hosted tenancy.** You get the same software, under your own (or RAD's) infrastructure, instead of a per-seat or per-usage subscription that grows independently of what you actually use.
- **Against a bare self-managed server:** Running the same open-source software yourself, a Hetzner CPX22 (2 vCPU/4 GB, about $24/month) or a DigitalOcean 2 vCPU/4 GB Droplet (also $24/month) is roughly the same shape; a GCP Compute Engine e2-standard-2 (2 vCPU/8 GB) runs about $49/month. RAD is not cheaper than that in cash terms — the difference is the managed database, Secret Manager and monitoring that come with the module instead of being your own job.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If AnythingLLM runs in **a project RAD manages for you**, you have an option that goes well beyond
scaling to zero: **delete the whole project, and restore it within 30 days for close to
nothing.** This suits occasional use — studying for a certification, a demo, a seasonal
need — far better than running AnythingLLM continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google
  to delete the project outright. Google does not remove it immediately: it keeps the project,
  recoverable, for 30 days, and because billing is already unlinked nothing is charged while it
  waits. Unlike deleting one module, this does not tear down the database, any VM or the
  compute resource one by one — the whole project simply stops, and nothing is billed in the
  meantime.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, only the project's
  owner can restore it. RAD asks Google to undelete the project and reattaches its billing
  account, then asks you to run **Update** on each deployment to confirm everything came back.
  Because nothing was individually destroyed, that Update finds the same resources already
  there — it is a check, not a rebuild, and an Update never charges the module fee again. This
  costs only a handful of credits in total (under US$1), against paying the module fee and a
  full build again.
- **What this needs.** You must own the project (not one RAD only manages billing for), you
  must restore it yourself within the 30 days — after that Google deletes it for good — and
  restoring is admitted like creating a new project, so your purchased credit balance must
  still clear the tier's floor (100 credits for the sandbox tier most study and demo use
  fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap: backups do not survive.** Anything AnythingLLM writes to a backup bucket inside the
  project is very likely gone as soon as you delete the project, even though the project itself
  is recoverable for 30 days — that bucket has Cloud Storage's soft-delete explicitly turned
  off. Anyone who has customised the deployment and wants to keep that work should copy a
  backup out (to Google Drive, or a bucket outside the project) before deleting. For a default
  install with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

This is the fallback for a project you own, or once the 30-day restore window above has
passed: **delete the deployment, and deploy it again when you next need it.**

- **What a redeploy costs.** The module fee again, plus the builds: roughly
  115 credits (about US$11.50) in your own project, or
  104 credits in a RAD-managed one, because RAD rebuilds the resources
  from scratch. Deleting saves money once AnythingLLM would otherwise sit unused long enough to clear that redeploy cost against its own running cost — roughly 3 days or more in your own project (US$3.40/day) or 3 days or more in a RAD-managed one (32 credits/day).
- **Most of the running cost is usually shared infrastructure.** The database and file or cache VM stop only when nothing else in the project uses them, so deleting AnythingLLM while another application shares the project saves only AnythingLLM's own compute part.
- **Keep your data first.** Anything AnythingLLM writes to a backup bucket inside the deployment is
  deleted with it — copy the latest backup out (to Google Drive, or a bucket you keep) before
  deleting if you want to keep it.
- **RAD does not recreate a deleted deployment for you.** You enter the settings again when
  you redeploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  AnythingLLM in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs AnythingLLM for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's fees and daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics; [AnythingLLM Cloud pricing](https://anythingllm.com/pricing). Prices change; check each source before relying on a figure.

## 1. Overview

AnythingLLM runs as a Node.js AI container on Cloud Run v2. The deployment wires together
a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 2 vCPU / 4 GiB by default, request-based autoscaling |
| Database | Cloud SQL for PostgreSQL 15 | Required — AnythingLLM uses Prisma ORM and does not support MySQL |
| Object storage | Cloud Storage | Auto-provisioned `anythingllm-docs` document bucket; optional additional buckets |
| Shared files | Filestore (NFS) | Optional — for multi-instance persistent document/vector storage; requires gen2 |
| Secrets | Secret Manager | Four app secrets auto-generated (`JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY`, `SIG_SALT`) plus database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional Global HTTPS LB + Cloud Armor + custom domain |
| Cache | Redis | Disabled by default; optional for session or cache workloads |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** AnythingLLM's Prisma ORM requires PostgreSQL. Do not set
  `database_type` to a MySQL or SQL Server variant.
- **Four application secrets are auto-generated.** `JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY`,
  and `SIG_SALT` are created in Secret Manager on first deploy; you never set them in plain
  text.
- **`min_instance_count` defaults to `0`** (scale-to-zero). NFS keeps the LanceDB vector
  store safe across cold starts, so the trade-off is only a ~30–60 s cold start on the
  first query after idle; set `min_instance_count = 1` to avoid it for latency-sensitive
  deployments.
- **Storage must be persistent, and NFS is on by default.** All workspace documents,
  vector indices, and conversation data are written under `STORAGE_DIR`. `enable_nfs`
  defaults to `true` because AnythingLLM's LanceDB vector index otherwise lives on the
  container's ephemeral disk and is silently wiped on every cold start or redeploy.
- **Redis is disabled by default.** It is not required for AnythingLLM's core
  functionality. If enabled, `redis_host` must be set explicitly.
- **Request-based billing by default.** `cpu_always_allocated = false` — document
  embedding continues in a background worker after the upload request returns, and
  it was measured to complete on a throttled, idle instance for a small document.
  For bulky or continuous ingest, consider `cpu_always_allocated = true`.
- **`execution_environment = gen2`** is the default and is required when NFS or GCS Fuse
  mounts are enabled.
- **The `GOOGLE_CLOUD_STORAGE_BUCKET_NAME` env var is set automatically** from the
  provisioned `anythingllm-docs` GCS bucket.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the AnythingLLM service

AnythingLLM runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts. AI embedding and inference
operations require at least 2 vCPU and 4 GiB RAM; Startup CPU Boost is enabled.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

AnythingLLM stores all workspace metadata, user accounts, and conversation history in a
managed Cloud SQL for PostgreSQL 15 instance. The service connects privately through the
**Cloud SQL Auth Proxy** over a Unix socket (no public IP). On first deploy an
initialization Job creates the application database and user. The `DATABASE_URL` Prisma
connection string is assembled by the AnythingLLM entrypoint script from the `DB_*`
environment variables injected by the foundation at container start time.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection
model, backups, and password rotation.

### C. Cloud Storage — document bucket

`AnythingLLM_Common` automatically provisions a dedicated **Cloud Storage** bucket
(`anythingllm-docs`) for document and vector storage. The workload service account is
granted access automatically and the bucket name is injected as
`GOOGLE_CLOUD_STORAGE_BUCKET_NAME`. Additional buckets can be declared in `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<docs-bucket>/          # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse mounts and CMEK options.

### D. Filestore (NFS) — optional shared storage

For multi-instance deployments where all instances need access to the same documents and
vector indices, enable **Filestore (NFS)**. NFS is disabled by default and requires
`execution_environment = gen2`.

- **Console:** Filestore → Instances.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS mount and CMEK options.

### E. Secret Manager

Four AnythingLLM application secrets are auto-generated and stored in Secret Manager —
`JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY`, and `SIG_SALT` — plus the database password. None
of these appear in plain text anywhere in the deployment.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. A Global HTTPS load balancer
with Cloud Armor, a custom domain, and Cloud CDN can be layered on. `ingress_settings`
and `vpc_egress_setting` control which traffic sources can reach the service and how
outbound traffic is routed through the VPC.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring. An optional uptime check (disabled by default, targeting `/`) and alert
policies can be enabled.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. AnythingLLM Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) uses the
  `postgres:15-alpine` image to create the AnythingLLM database and user before the
  service starts. It is idempotent and safe to re-run.
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Prisma migrations on start.** The entrypoint script constructs the `DATABASE_URL`
  connection string from the platform-injected `DB_*` environment variables and runs
  Prisma migrations, so version upgrades apply schema changes automatically.
- **AI model loading.** AnythingLLM loads embedding models into memory on first boot. The
  startup probe uses a 60-second initial delay and 30 failure periods (×10 seconds = 5
  minutes total) to accommodate this.
- **Health path.** Both startup and liveness probes target `/api/ping` using HTTP, which
  returns HTTP 200 only when the application is fully initialised. Unlike Mautic/Apache,
  AnythingLLM does not redirect HTTP health traffic, so HTTP probes work without
  adjustment on Cloud Run.
- **LLM provider configuration.** Use `environment_variables` for non-sensitive provider
  settings (`LLM_PROVIDER`, `EMBEDDING_ENGINE`, `VECTOR_DB`) and
  `secret_environment_variables` to map env var names to Secret Manager secrets for API
  keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.).
- **Embedding engine consistency.** Changing `EMBEDDING_ENGINE` after documents have been
  ingested makes existing vector indices incompatible. All documents must be re-ingested
  after any change to the embedding engine.
- **Fixed environment variables.** `SERVER_PORT=3001`, `UID=1000`, and `GID=1000` are set
  automatically by `AnythingLLM_Common`. Do not override them. `AnythingLLM_Common` also
  sets `STORAGE_DIR=/app/server/storage` as its own default, but `AnythingLLM_CloudRun`
  overrides it to the NFS mount path (`nfs_mount_path`, default `/app/server/storage`)
  whenever `enable_nfs = true` — the module default — so the knowledge base's vector
  index lands on the NFS share. With `enable_nfs = false` it falls back to the
  container's ephemeral disk and is lost on every cold start (see Group 11).

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for AnythingLLM are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `anythingllm` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `AnythingLLM` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Service description. |
| `application_version` | `latest` | Image version tag; pin to a release tag for production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per instance. Minimum 2 vCPU for AI workloads. |
| `memory_limit` | `4Gi` | Memory per instance. Minimum 4 GiB for embedding and inference. |
| `min_instance_count` | `0` | Minimum instances. Set ≥ 1 to avoid cold starts (NFS keeps the vector store safe either way). |
| `max_instance_count` | `1` | Maximum instances. Increase with NFS for shared document access. |
| `container_port` | `3001` | AnythingLLM's native HTTP port. |
| `execution_environment` | `gen2` | Gen2 required for NFS mounts and GCS Fuse. |
| `timeout_seconds` | `300` | Max request duration. Increase for long document ingestion. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |
| `traffic_split` | `[]` | Traffic allocation across revisions for staged rollouts. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Which networks may reach the service (`all` / `internal` / `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. **Recommended for production.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Non-secret settings, e.g. `LLM_PROVIDER`, `EMBEDDING_ENGINE`, `VECTOR_DB`. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name for API keys. |
| `secret_propagation_delay` / `secret_rotation_period` | _(set)_ | Replication wait / rotation cadence. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_CloudRun](App_CloudRun.md).

### Group 10 — Domain, CDN, Cloud Armor & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision a Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDRs exempted from WAF rules. |
| `application_domains` | `[]` | Custom hostnames for the external load balancer. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend (requires `enable_cloud_armor`). |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the additional data bucket. The `anythingllm-docs` bucket is always created. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Additional GCS buckets. |
| `enable_nfs` | `true` | Filestore (NFS) for persistent document/vector storage — required, otherwise the LanceDB vector index lives on ephemeral disk and is wiped on every cold start/redeploy. |
| `nfs_mount_path` | `/app/server/storage` | Mount path inside the container. |
| `gcs_volumes` | `[]` | GCS Fuse mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed for AnythingLLM — do not change. |
| `application_database_name` | `anythingllmdb` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `anythingllmuser` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Optional additional env var names for connection details. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Recurring Cloud Run Jobs triggered by Cloud Scheduler. |
| `additional_services` | `[]` | Additional Cloud Run services alongside AnythingLLM. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/api/ping`, 60 s initial delay, 30 failures | Extended startup window for AI model loading. |
| `liveness_probe` / `health_check_config` | HTTP `/api/ping`, 30 s initial delay | Liveness probe against AnythingLLM's health endpoint. |
| `uptime_check_config` | disabled, `/` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not required for AnythingLLM core functionality. Enable for optional cache workloads. |
| `redis_host` | `null` | Redis endpoint. **Required** when `enable_redis = true`. |
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
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets (includes the `anythingllm-docs` bucket). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | AnythingLLM requires PostgreSQL; any other engine breaks Prisma ORM and crashes startup. |
| `STORAGE_DIR` persistence | NFS or GCS Fuse | Critical | Without a persistent volume, all workspace documents, vector indices, and conversation data are lost on every instance restart. |
| `secret_environment_variables` (API keys) | Use Secret Manager refs | Critical | Provider API keys as plain `environment_variables` are visible in Cloud Run revision metadata. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_file` fails the import job. |
| `enable_cloudsql_volume` | `true` | Critical | Disabling causes all database connections to fail at startup. |
| `memory_limit` | `4Gi` | High | AnythingLLM's embedding pipeline requires 3–4 GiB RAM; OOM kills corrupt in-progress ingestion. |
| `min_instance_count` | `1` | High | Scale-to-zero causes 30–60 s cold starts; in-flight AI operations during scale-down are lost. |
| `timeout_seconds` | `300` (raise for heavy workloads) | High | Long document ingestion or slow LLM completions exceed the backend timeout, returning 504. |
| `EMBEDDING_ENGINE` | set once | High | Changing the embedding engine after ingestion makes existing vectors incompatible; all documents must be re-ingested. |
| `ingress_settings` / `enable_iap` | secure for production | High | `ingress_settings = "all"` with no IAP exposes the workspace publicly; only the login form protects it. |
| `enable_nfs` / GCS Fuse | enable for multi-instance | High | Without shared storage, instances > 1 each have an isolated storage view; cross-instance document access fails. |
| `execution_environment` | `gen2` (default) | High | NFS and GCS Fuse mounts require gen2; with gen1 the volume silently fails to mount. |
| `enable_redis` | `false` (or set `redis_host`) | Medium | If `enable_redis = true` and `redis_host` is not resolvable, the container fails to start. |
| `application_version` | pin to a release tag | Medium | `latest` risks schema-breaking upgrades in production. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. AnythingLLM-specific
application configuration shared with the GKE variant is described in
**[AnythingLLM_Common](AnythingLLM_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: AnythingLLM on Cloud Run](../labs/AnythingLLM_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [AnythingLLM on GKE Autopilot](AnythingLLM_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [AnythingLLM Common — Shared Application Configuration](AnythingLLM_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Outline on Google Cloud Run](Outline_CloudRun.md), [Ollama on Google Cloud Run](Ollama_CloudRun.md), [Qdrant on Google Cloud Run](Qdrant_CloudRun.md), [Crawl4AI on Google Cloud Run](Crawl4AI_CloudRun.md) in the **Team Knowledge Assistant** solution.
