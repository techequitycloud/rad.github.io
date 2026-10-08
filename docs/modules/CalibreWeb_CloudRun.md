---
title: "Calibre-Web on Google Cloud Run"
description: "Configuration reference for deploying Calibre-Web on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Calibre-Web on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CalibreWeb_CloudRun.png" alt="Calibre-Web on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Calibre-Web is a clean, self-hosted web app for browsing, reading and downloading
ebooks from an existing Calibre library — it serves an in-browser reader, an OPDS
feed, user management and Kobo sync on top of the upstream LinuxServer.io
`calibre-web` image. This module deploys Calibre-Web on **Cloud Run v2** on top of
the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure; `CalibreWeb_CloudRun` is a thin wrapper that
supplies Calibre-Web's own configuration (image, ports, probes, storage wiring) and
forwards everything else straight through.

This guide focuses on the cloud services Calibre-Web uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Calibre-Web costs on RAD, and how that compares

**Calibre-Web on RAD's Cloud Run module costs about US$33 a month in your own Google Cloud project, with no extra licence fee** — Calibre-Web is open source. In a project RAD manages for you, the same deployment is metered at **15 credits a day** (about 450 a month, about US$45 at the top-up price). Or see the [GKE guide](CalibreWeb_GKE.md) for always-on capacity across pods. If you only need Calibre-Web occasionally — studying, a demo, a short-lived project — a RAD-managed project can be deleted and restored within 30 days for a few credits, so that monthly figure becomes a few dollars instead. See **Pause it for free**, below.

### What you pay on RAD

Calibre-Web is open source, so there is no licence fee. You pay for three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 75 credits (US$7.50 at the top-up price) | 67.5 credits (10% lower) |
| Build time | A few credits per build (roughly 3–6 credits) | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$33 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **15 credits a day**, about 450 a month (about US$45 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the
database, file server and network are shared by every application in the project, so a second
application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (warm) | US$13.14 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$33** |

Cloud SQL and Cloud Run/GKE pod pricing is the same in africa-south1 (Johannesburg); the small VM costs about 10% more there.

- **This module is kept warm by default** (`min_instance_count ≥ 1`), so the Cloud Run figure above already assumes it never scales to zero.

### How it compares, for a personal or small-library ebook server

Calibre-Web has no official hosted offering — it is built to run against your own existing Calibre library, so the realistic comparison is a bare server:

- A Hetzner CPX22 or DigitalOcean droplet (2 vCPU/4 GB, about US$24/month) or a GCP e2-standard-2 (2 vCPU/8 GB, about US$49/month) would run it comfortably — oversized for Calibre-Web's own 1 vCPU/1 GiB footprint here, so a smaller, cheaper instance class would do just as well.
- On a bare VPS you own the operating system, security patches and your own backup discipline. RAD's module gives you the compute, Secret Manager and Cloud Monitoring already wired up, for the module fee plus the Google Cloud usage above.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Calibre-Web runs in **a project RAD manages for you**, deleting the whole project — rather than deleting
just this module — unlinks its billing first, then asks Google to delete the project outright. Google
keeps it, recoverable, for 30 days, and because billing is already unlinked, nothing is charged while it
waits. Unlike deleting one module, this does not tear down Cloud SQL, any VM or the compute resource one
by one: the whole project simply stops.

- **Restoring is a check, not a rebuild.** Within 30 days, the project's owner can ask Google to undelete
  the project and reattach its billing account, then run **Update** on each deployment to confirm
  everything came back. Because nothing was individually destroyed, that Update finds the same resources
  already there, and an Update never charges the module fee again. For a typical 2–3-deployment chain
  this costs only a handful of credits in total (roughly 5–10 credits, under US$1).
- **What this needs.** You must own the project (not one RAD only manages billing for), restore it
  yourself within 30 days — after that Google deletes it for good — and clear the tier's admission floor
  again (100 credits for the sandbox tier most study/demo use fits). Google says most services are fully
  working again within 36 hours of a restore.
- **One real gap: nightly backups do not survive.** Backups are written to a bucket inside the project,
  and that bucket has Cloud Storage's soft-delete turned off, so it is very likely gone as soon as the
  project is deleted — even though the project itself is recoverable for 30 days. Copy a backup out (to
  Google Drive, or a bucket outside the project) before deleting if there is anything in it worth
  keeping; for a default install with nothing irreplaceable, this does not matter.

Source: [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Pay only while you use it, the other way: delete and redeploy

In your own project, or once the 30-day restore window above has passed, the way to stop paying is to
delete the deployment and deploy it again when you need it.

- **What a redeploy costs.** The module fee again, plus the builds: about 79 credits
  (about US$7.90) at the top-up price, and roughly 15–20 minutes of build time (RAD's
  own platform average). Deleting saves money only once Calibre-Web would otherwise sit unused for about
  **6 days or more** — in your own project that is about US$1.09 a day, and
  in a RAD-managed one it is 15 credits a day.
- Most of the running cost here is usually the database and/or the shared file/cache VM or cluster. They stop only when nothing else in the project uses them, so deleting Calibre-Web while another application shares the project saves only Calibre-Web's own compute part.
- **Keep data first.** Nightly backups go to a bucket inside the deployment and are deleted with it, so
  copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets the app in
  their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either
  the trainer funds every place, or each participant pays for their own. Everything is deleted when the
  session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a ring-fenced
  wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the
  data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over
  and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card,
bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD fees and the daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore window and backup-bucket caveat; prices change, check each source before relying on a figure.

## 1. Overview

Calibre-Web runs as a single Cloud Run revision. It has **no external database** —
all of its state (the application database, the Calibre library metadata database,
configuration, cache, and logs) lives in internal SQLite files under `/config`. The
deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Calibre-Web (LinuxServer.io image) container on port 8083, 1 vCPU / 1 GiB by default; `min_instance_count = max_instance_count = 1` |
| Config/library persistence | Shared NFS (Filestore / NFS VM) | `/config` is mounted from the shared NFS server by default (`enable_nfs = true`, `nfs_mount_path = "/config"`). The `storage`-suffixed bucket is still provisioned but **not** mounted — `enable_gcs_storage_volume` is exposed as a module variable on `CalibreWeb_CloudRun` and defaults to `false`, because GCS FUSE corrupts Calibre-Web's SQLite `app.db`. |
| Database | None | `database_type = "NONE"`; no Cloud SQL instance, user, or `db-init` job |
| Cache & queue | None | `enable_redis` is declared for foundation-variable mirroring but **hardcoded to `false`** in `main.tf` regardless of the variable's value |
| Secrets | Secret Manager | Auto-generated `CALIBRE_ADMIN_PASSWORD` — provisioned but **not** the credential Calibre-Web actually authenticates with on first login (see §3) |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL (`ingress_settings = all`); optional external HTTPS load balancer + custom domain via Cloud Armor |

**Sensible defaults worth knowing up front:**

- **GCS Fuse persistence, not a block PVC — dev/light-use by design.** Unlike
  `CalibreWeb_GKE` (which uses a real block Persistent Volume specifically because
  gcsfuse's relaxed consistency model can corrupt SQLite), this Cloud Run module has
  no block-storage option at all — `/config` is backed by a shared **NFS** mount by default (`enable_nfs = true`, `nfs_mount_path = "/config"`), which supplies the POSIX semantics SQLite needs. The GCS Fuse mount at that path is disabled by default (`enable_gcs_storage_volume = false`) because it corrupts `app.db`.
  The module's own `module_description` explicitly says this variant is "best
  suited for development/light use" and recommends `CalibreWeb_GKE` with a block PVC
  for production.
- **Single revision by default.** `min_instance_count = 1` and
  `max_instance_count = 1`. Unlike the GKE variant (where each StatefulSet replica
  gets its own independent PVC), every Cloud Run instance mounts the **same**
  GCS-backed bucket — so raising `max_instance_count` does not fork the library the
  way it does on GKE, but it does let two instances write to the same gcsfuse-backed
  SQLite files concurrently, which is unsafe. Keep it at 1.
- **`min_instance_count` defaults to `1`, not `0`.** This is deliberately not
  scale-to-zero — the intent is to avoid a cold start while Calibre-Web loads its
  collection/library indexes. This module does not expose `cpu_always_allocated` at
  all (it is not mirrored in `variables.tf`, nor forwarded in `main.tf`), so it
  silently inherits the App_CloudRun foundation default (`false`, request-based
  billing) — the always-warm instance's CPU is still billed only while it is
  actually serving a request.
- **No database.** `database_type = "NONE"`; there is no `db-init` job and none of
  the database-related variables in this module are referenced.
- **No Redis.** `enable_redis` defaults to `true` in this module's `variables.tf`
  (mirroring the App_CloudRun foundation default) but is **inert** — `main.tf`
  passes a hardcoded `enable_redis = false` to the Foundation call, and
  `redis_host`/`redis_port`/`redis_auth` are declared but never forwarded.
- **The generated admin password is not the working login.** The upstream
  LinuxServer image ships a built-in default login (`admin` / `admin123`); the
  `CALIBRE_ADMIN_PASSWORD` Secret Manager secret is provisioned for a stronger
  credential but is not wired into the container automatically. Change the password
  in the Calibre-Web UI on first sign-in.
- **`enable_cloudsql_volume` is hardcoded off.** `main.tf` passes
  `enable_cloudsql_volume = false` to the Foundation regardless of the module
  variable's value, fully suppressing the Cloud SQL Auth Proxy sidecar — correct,
  since Calibre-Web has no database.
- **Image version is pinned via an app-specific build ARG.** The Dockerfile reads
  `CALIBREWEB_VERSION` (not the generic `APP_VERSION` the Foundation injects); when
  `application_version = "latest"` the build is pinned to a known-good `0.6.24`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Calibre-Web service

Calibre-Web runs as a single Cloud Run v2 service/revision. Because
`min_instance_count = max_instance_count = 1` by default, there is normally exactly
one running instance at a time.

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

### B. Cloud Storage & GCS Fuse — the `/config` mount

A dedicated **Cloud Storage** bucket (suffix `storage`) is always provisioned when
`create_cloud_storage = true` (the default), but by default it is **not** mounted: `enable_gcs_storage_volume = false`, so `/config` — the path where Calibre-Web keeps its SQLite files
(`app.db`, Calibre's `metadata.db`), configuration, cache, and logs. The mount is
controlled by the `enable_gcs_storage_volume` module variable, which defaults to **`false`** on Cloud Run;
the bucket is still provisioned but left unmounted, and `/config` is served by NFS instead (see `enable_nfs`). Additional buckets/volumes
can be declared via `storage_buckets` / `gcs_volumes`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse mount options and CMEK.

### C. Secret Manager

One Calibre-Web secret is generated automatically and stored in Secret Manager:
`CALIBRE_ADMIN_PASSWORD` (a 24-character random value,
`secret-<prefix>-<app>-admin-password`), injected into the Cloud Run revision as a
secret environment variable. It is **not** applied as the actual Calibre-Web login —
see §3.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for secret injection and rotation.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = all`,
public). An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud
Armor can be layered on via `enable_cloud_armor`; ingress settings and VPC egress
control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring.
Uptime checks are disabled by default (`uptime_check_config.enabled = false`).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Calibre-Web Application Behaviour

- **No initialization job by default.** `initialization_jobs` defaults to `[]`;
  Calibre-Web manages its own SQLite storage and needs no database bootstrap (there
  is no `db-init` job because `database_type = "NONE"`). Only user-supplied jobs
  run.
- **No migrations step.** The upstream LinuxServer s6-based init runs unmodified —
  the Dockerfile is `FROM lscr.io/linuxserver/calibre-web:${CALIBREWEB_VERSION}`
  with no added entrypoint script. `image_source = "custom"` is set purely so the
  Foundation builds/mirrors the image into Artifact Registry.
- **First-boot storage layout.** The image drops privileges to `PUID=1000`/
  `PGID=1000` (injected as environment variables by `CalibreWeb_Common`) and keeps
  all state under `/config` (the NFS-mounted volume): `app.db`, Calibre's
  `metadata.db`, config, cache, and logs. The ebook library itself lives under
  `/books` (empty on first run — the in-app setup wizard points Calibre-Web at it).
- **`CALIBRE_ADMIN_PASSWORD` is provisioned but not applied.** The Secret-Manager
  secret exists so a strong password is available and so a future
  image/entrypoint can consume it — it is not wired into the container's actual
  login flow. The upstream image's built-in first-login credentials are
  `admin` / `admin123`. Change the admin password in the Calibre-Web UI immediately
  after first sign-in.
- **Health path.** Both the startup and liveness probes issue an **HTTP GET `/`**
  (Calibre-Web's login page), which returns `200` with no authentication required —
  probes pass as soon as the server is serving, independent of any login state.
  Defaults: startup `initial_delay=15s`, `period=10s`, `failure_threshold=10`;
  liveness `initial_delay=30s`, `period=30s`, `failure_threshold=3`. (Note: the
  `liveness_probe` variable's own description text in `variables.tf` references a
  `/health` endpoint that Calibre-Web does not expose — the actual configured
  default `path` is `/`; don't change it to `/health`, which would 404.)
- **Single-writer constraint.** `min_instance_count = max_instance_count = 1` keeps
  exactly one instance writing to the gcsfuse-mounted SQLite files at a time. Raising
  `max_instance_count` does **not** give Calibre-Web a safely shared library — it
  lets two Cloud Run instances write to the same bucket-backed SQLite files
  concurrently, which risks corruption under GCS Fuse's relaxed consistency model.
- **Inspect job execution and the running revision:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform (per the
`{{UIMeta group=N}}` tags in `variables.tf`). Only settings specific to or notable
for Calibre-Web are listed; every other input is inherited from
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
| `application_name` | `calibreweb` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Calibre-Web` | Human-readable name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `latest` | `lscr.io/linuxserver/calibre-web` tag used as the custom-build base; `latest` is pinned to a known-good tag (`0.6.24`) at build time via the app-specific `CALIBREWEB_VERSION` build ARG. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | 1 vCPU. |
| `memory_limit` | `1Gi` | Memory per instance. |
| `min_instance_count` | `1` | Not scale-to-zero by default — avoids a cold start while Calibre-Web loads its library index. |
| `max_instance_count` | `1` | **Keep at 1** — see §3 single-writer constraint. |
| `container_port` | `8083` | Calibre-Web's web UI port. Unlike the GKE variant (where this variable is inert), this value IS forwarded — `calibreweb.tf` merges it over `CalibreWeb_Common`'s hardcoded `8083`, so it takes effect if changed. |
| `execution_environment` | `gen2` | Gen2 required for the GCS Fuse `/config` mount. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | Hardcoded `false` in `main.tf` regardless of this variable — Calibre-Web has no Cloud SQL. |
| `container_protocol` | `http1` | Description text mentions gRPC; not applicable to Calibre-Web — leave `http1`. |
| `enable_image_mirroring` | `true` | Mirrors the image into Artifact Registry to avoid Docker Hub rate limits. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Declared for convention parity; not referenced by this module's deployment. |
| `service_annotations` / `service_labels` | `{}` | Custom Cloud Run service annotations/labels. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public by default so the web UI is reachable directly. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of the Calibre-Web UI. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings; merged with `CalibreWeb_Common`'s `PUID=1000`, `PGID=1000`, `TZ=Etc/UTC`. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore `/config` from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — NFS Instance & Custom SQL Scripts

| Variable | Default | Description |
|---|---|---|
| `enable_custom_sql_scripts` | `false` | Not applicable — Calibre-Web has no SQL database. |
| `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | `""` / `""` / `false` | Not applicable. |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | NFS discovery/naming inputs — moot since `enable_nfs = false` by default (Group 11) and Calibre-Web has no NFS-based storage path. |

### Group 10 — Domain, CDN, Cloud Armor & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Artifact Registry cleanup policy. |

### Group 11 — Storage, Filesystem & Redis

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Always provisions the `storage`-suffixed bucket. It is **not** mounted by default — see `enable_gcs_storage_volume` (`false`) and §2.B. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned one. |
| `enable_nfs` | `true` | NFS **is** how Calibre-Web persists on Cloud Run: `/config` holds a SQLite `app.db` in rollback-journal mode, which GCS FUSE cannot sustain (`BufferedWriteHandler.OutOfOrderError for object: app.db-journal`). NFS supplies the POSIX rename/fsync/locking semantics FUSE does not. Set `false` only if you accept the corruption risk. |
| `nfs_mount_path` | `/config` | Where the NFS volume is mounted — Calibre-Web keeps all of its state (`app.db`, `metadata.db`, config, cache, logs) there. Must stay in step with `enable_gcs_storage_volume`: mounting both NFS and the GCS FUSE volume at `/config` is a double-mount conflict. |
| `gcs_volumes` | `[]` | Additional GCS Fuse volumes. The automatic `storage`→`/config` volume is only merged in when `enable_gcs_storage_volume = true`, which defaults to `false` on Cloud Run. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `enable_redis` | `true` (declared) | **Inert** — `main.tf` hardcodes `enable_redis = false` on the Foundation call regardless of this variable. Calibre-Web has no Redis dependency. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Declared for foundation-variable mirroring but **not forwarded** to App_CloudRun at all. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed by `CalibreWeb_Common`; no Cloud SQL instance, database, or user is created. |
| `database_password_length` | `32` | Not referenced — no database exists. |
| `application_database_name` / `application_database_user` / `db_password_env_var_name` / `enable_mysql_plugins` / `enable_postgres_extensions` / `enable_auto_password_rotation` / `sql_instance_name` / `sql_instance_base_name` | various | All declared for foundation-variable mirroring only — not applicable, since `database_type = "NONE"`. |
| `service_url_env_var_name` | `""` | Not database-related despite the group placement — adds an extra env var name for the predicted Cloud Run service URL alongside `CLOUDRUN_SERVICE_URL`. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No built-in init job — Calibre-Web self-manages its SQLite storage. Only provide jobs for custom data loading. |
| `cron_jobs` | `[]` | No platform-scheduled recurring tasks by default. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 15s delay | The probe that is actually applied (forwarded via `CalibreWeb_Common`'s `config`, which overrides the raw `startup_probe_config` input). |
| `liveness_probe` | HTTP `/` 30s delay | The probe that is actually applied. See §3 for the `/health` description-text mismatch. |
| `startup_probe_config` / `health_check_config` | enabled, path `/` | Inert alternates — once `CalibreWeb_Common` supplies `startup_probe`/`liveness_probe` via `application_config`, these raw top-level inputs are ignored. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 23 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `organization_id` | `""` | Override for folder-nested projects. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

Note: this group is tagged `group=23` in `variables.tf`, one higher than the `22`
used by most other Cloud Run application modules for the same VPC-SC/audit-logging
inputs — a cosmetic UI-grouping numbering quirk with no functional effect.

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `calibreweb_url` | The Cloud Run service URL (`status.url`). Note: this output's description in `outputs.tf` references an "internal VPC ... REST API (port 6333)" — that text is a stale copy-paste from an unrelated module (Calibre-Web has no such API/port); the value itself is simply the normal service URL, reachable per `ingress_settings` (public by default). |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets, including the `/config`-mounted `storage` bucket. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any user-supplied setup jobs (none by default). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

Note: `outputs.tf` does not expose the Secret Manager secret ID for
`CALIBRE_ADMIN_PASSWORD` at the top level (unlike `CalibreWeb_GKE`'s
`calibreweb_admin_password_secret_id` output) — retrieve it with
`gcloud secrets list --filter="name~admin-password"` instead.

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `/config` persistence model | Use `CalibreWeb_GKE` for production libraries | Critical | This module has no block-PVC option; `/config` is **NFS**-backed by default (`enable_nfs = true`, `nfs_mount_path = "/config"`), which avoids the gcsfuse SQLite corruption. Do not set `enable_gcs_storage_volume = true` at this path — gcsfuse's relaxed consistency model corrupts `app.db`/`metadata.db` under real usage, and it would also double-mount `/config`. The module's own description flags this variant as dev/light-use only. |
| `max_instance_count` | `1` | Critical | Above 1, multiple Cloud Run instances write to the **same** gcsfuse-mounted SQLite files concurrently — a real risk of database corruption, distinct from (and in some ways riskier than) the GKE variant's per-replica PVC forking. |
| `CALIBRE_ADMIN_PASSWORD` (auto-generated) | Change the login in the UI on first sign-in | High | The generated secret is not applied automatically; the working first-login credential is the upstream default `admin`/`admin123` until changed manually. |
| `enable_redis` | Ignore — inert | Low | `main.tf` hardcodes `enable_redis = false` regardless of this variable; Calibre-Web has no Redis dependency. |
| `enable_cloudsql_volume` | Ignore — inert | Low | `main.tf` hardcodes `enable_cloudsql_volume = false`; Calibre-Web has no Cloud SQL dependency. |
| `min_instance_count` | `1` (default) | Medium | Keeps one instance always warm to avoid a cold start while Calibre-Web loads its library index; this module does not expose `cpu_always_allocated`, so CPU is still billed request-based (Foundation default) rather than always-on. |
| `startup_probe_config` / `health_check_config` | Ignore — inert once `application_config` is set | Low | These raw inputs are overridden by `CalibreWeb_Common`'s `startup_probe`/`liveness_probe`, which is what is actually applied. |
| `container_port` | `8083` (keep) | Medium | Unlike `CalibreWeb_GKE` (where this variable is inert), on Cloud Run it genuinely overrides the container port via a `merge()` in `calibreweb.tf` — changing it without also changing the upstream image's listen port breaks routing. |
| `enable_cloud_armor` | enable for production | Medium | The Calibre-Web UI and OPDS/Kobo-sync endpoints are publicly reachable without WAF protection by default. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention of the `/config` backup. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Calibre-Web-specific application configuration
shared with the GKE variant is described in
**[CalibreWeb_Common](CalibreWeb_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Calibre-Web on Cloud Run](../labs/CalibreWeb_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Calibre-Web on GKE Autopilot](CalibreWeb_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Calibre-Web Common — Shared Application Configuration](CalibreWeb_Common.md) — the configuration shared by both deployment targets.
