---
title: "Jellyfin on Google Cloud Run"
description: "Configuration reference for deploying Jellyfin on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Jellyfin on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Jellyfin_CloudRun.png" alt="Jellyfin on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Jellyfin is a free, open-source (GPLv2) self-hosted media server for streaming
your own movies, TV shows, music, photos, and live TV. Written in .NET/C# and
maintained as a community fork of Emby, it has no tracking, no ads, and no premium
tier. This module deploys Jellyfin on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Jellyfin uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Jellyfin costs on RAD, and how that compares

**Jellyfin on RAD's Cloud Run module costs about US$33 a month in your own project, plus a 40-credit (US$4) module fee once per deployment, with no premium tier to upgrade to.** If you only need it part of the year, see "Pause it for free" below to stop paying without losing your media library. Jellyfin also ships as a GKE module, which costs more here (about US$42/month) because of the cluster's own management fee — Cloud Run is the lower-cost choice unless you already run GKE Autopilot for other apps.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 40 credits (US$4.00) | 36 credits (10% lower) |
| Build time | A few credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$32.57 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **15 credits a day** |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, less on a plan. In a project RAD manages, the
database, file server and network are shared by every application in the project, so a second
application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (warm) | US$13.14 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5.00 |
| Cloud Storage (add-ons, backups) | US$1.00 |
| **Total** | **about US$32.57** |

### How it compares

- Jellyfin's own project runs no hosted SaaS and does not intend to — it is built explicitly as the
  free, no-tracking alternative to paid media-server products, so there is no "Jellyfin Cloud" to
  compare against.
- Jellyfin's footprint (1 vCPU, 1 GiB) is light; a Hetzner CPX22 or DigitalOcean 2 vCPU/4 GB droplet
  (about $24/month) is more than enough, and a GCP Compute Engine e2-standard-2 (about $49/month)
  comfortably oversized — but you then run the operating system, storage and security patches yourself.
- What RAD adds over a bare VPS here is mostly the NFS share for your media library and managed
  networking and monitoring; Jellyfin itself needs no database, so there is no database administration
  to offload.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Jellyfin runs in a project RAD manages for you and you expect to come back to it — a break
between courses, a seasonal lull, or simply not knowing yet whether you'll need it next
month — this is the better option, and it costs almost nothing.

Deleting a RAD-managed project unlinks its billing first, then asks Google to delete the
project outright: Google's own 30-day recoverable soft delete. Unlike deleting Jellyfin as a
single module, this does not tear down the Cloud Run/GKE service, NFS file server and networking one by one — the whole project
simply stops, and nothing is charged while it waits, because billing is already unlinked.

Restoring, within 30 days and only by the project's owner, asks Google to undelete the
project and reattaches its billing account, then asks you to run Update on each deployment
to confirm everything came back. Because nothing was individually destroyed, that Update
finds the same resources already there — it is a check, not a rebuild, and an Update never
charges the module fee again. This costs only a handful of credits (under US$1) in build time
for a typical chain of deployments.

What this needs: you must own the project (not one RAD only manages billing for), you must
restore it yourself within 30 days — after that Google deletes it for good — and restoring is
admitted like creating a new project, so your purchased credit balance must still clear the
tier's floor (100 credits for the sandbox tier most use fits). Google says most services are
fully working again within 36 hours of a restore.

One real gap: nightly backups are written to a bucket inside the project, and that bucket has
Cloud Storage's soft-delete explicitly turned off, so it is very likely gone as soon as you
delete the project, even though the project itself is recoverable for 30 days. Jellyfin's own nightly export covers its configuration, not your media files, which live on the NFS share and are not individually destroyed by this path — but copy out anything irreplaceable before deleting all the same.

### Pay only while you use it, the other way: delete and redeploy

In your own project, or once the 30-day window above has passed, the fallback is to delete
Jellyfin outright and redeploy it later.

- **What a redeploy costs:** the module fee again, plus the builds — roughly the module fee
  shown above plus 3–6 credits of build time.
- **When it's worth it:** deleting saves money only once Jellyfin would otherwise sit unused
  for about 4 days or more in your own project (about 3 days or more in a RAD-managed one). The NFS file server is most of the running cost here, so deleting Jellyfin alone saves the whole bill above unless something else in the project shares it.
- **Keep data first.** Nightly backups are written to a bucket inside the deployment, and
  that bucket is deleted with it — copy the latest backup out (to Google Drive, or a bucket
  you keep) before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance
  the trainer sets. Either the trainer funds every place, or each participant pays for their
  own. Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.
- Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
  by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD fees and the daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Google Cloud: delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanism. Prices change; check each source before relying on a figure.

---

## 1. Overview

Jellyfin runs as a single .NET container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | .NET media server, 1 vCPU / 1 GiB by default, pinned to a single warm instance |
| Persistence | Cloud Filestore (NFS) | The `/config` directory (SQLite databases, metadata, plugins) is on the NFS share by default; GCS FUSE only if NFS is turned off |
| Database | Internal SQLite (embedded) | No Cloud SQL — Jellyfin keeps all state in SQLite files under `/config` |
| Secrets | Secret Manager | Optional auto-generated API key; no mandatory cryptographic secrets |
| Ingress | Cloud Run URL / Cloud Load Balancing | `internal` by default; optional external HTTPS load balancer + custom domain |
| Image delivery | Artifact Registry | The `jellyfin/jellyfin` image is mirrored in before deployment |

**Sensible defaults worth knowing up front:**

- **There is no external database.** Jellyfin stores its entire library — the SQLite
  databases, configuration XML, metadata, artwork, plugins, transcode cache, and
  logs — under a single `/config` directory. No Cloud SQL instance, no `db-init`
  job, and no Redis are provisioned (`database_type = NONE`).
- **`/config` must persist across revisions.** On Cloud Run the `/config` path is
  backed by the shared **NFS** volume (`enable_nfs = true`, `nfs_mount_path = /config`).
  Keep NFS on: with it off, `/config` falls back to a GCS FUSE bucket, which cannot
  host SQLite (no POSIX locking). Without a persistent `/config`, every new
  revision starts with an empty library and re-runs the first-run wizard.
- **The container listens on port 8096.** Cloud Run routes HTTP traffic to Jellyfin's
  default web/API port. The web UI and first-run setup wizard are served at `/web`
  (and `/`); `GET /health` returns `Healthy` (200, unauthenticated).
- **There are no default credentials.** On first access the setup wizard walks you
  through creating the administrator account and adding media libraries. Nothing is
  usable until that account exists.
- **A single warm instance is the default.** `min_instance_count = 1` keeps the media
  server warm (avoiding cold-start latency mid-stream) and `max_instance_count = 1`
  keeps a single shared SQLite library on a single volume. **Do not run multiple
  replicas** — concurrent writers against one SQLite file corrupt the library.
- **Cloud Run is best for light/demo use.** Network-storage latency plus Cloud Run's
  stateless, request-timeout execution model make this variant well-suited to
  evaluation and light personal use — but **not** heavy transcoding or many
  concurrent streams. For a real media library, deploy [Jellyfin_GKE](Jellyfin_GKE.md)
  with a block PVC.
- **API-key auth is optional and off by default.** `enable_api_key = false`. Primary
  authentication is the wizard-created admin account; per-application API keys are
  created in-app under **Dashboard → API Keys**.

> **Cloud Run vs GKE — pick the right home for your library.**
> **Cloud Run (this module)** mounts `/config` from the shared NFS volume. It is
> simple, scales to a single warm instance, and is ideal for a demo or a small
> personal library with occasional direct-play streaming. Network-storage latency and the
> per-request timeout model make it a poor fit for live transcoding or busy
> multi-user streaming. **[Jellyfin_GKE](Jellyfin_GKE.md)** runs as a StatefulSet
> with a real **block PVC** at `/config`, giving correct filesystem semantics for
> SQLite and the transcode cache — the recommended choice for a production media
> server, with optional NFS for large media libraries.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Jellyfin service

Jellyfin runs as a Cloud Run v2 service. Because the library is a single SQLite
store on a single volume, the service is pinned to one instance rather than
autoscaled. Each deployment creates an immutable revision; traffic can be split
across revisions for safe rollouts.

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

### B. Persistent configuration store (SQLite on `/config`)

Jellyfin has **no external database**. Its entire state — the SQLite library and
playback databases, configuration XML, cached metadata and artwork, installed
plugins, the transcode cache, and logs — lives under `/config`
(`JELLYFIN_CONFIG_DIR = /config`). There is no Cloud SQL instance, no Auth Proxy,
and no initialization Job to create a schema; Jellyfin creates and migrates its own
SQLite databases on first start.

Because everything important is a file under `/config`, persisting that directory
**is** persisting the whole server. On Cloud Run it is backed by the NFS share
(`enable_nfs = true`, the default).

- **Inspect the mounted config on the running revision:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].volumeMounts)'
  ```

### C. Cloud Storage — the `/config` bucket

A dedicated **Cloud Storage** bucket (name suffix `storage`) is provisioned
automatically. It is mounted at `/config` via **GCS FUSE** only when `enable_nfs = false`
— with NFS on (the default) the NFS share holds `/config` instead, because two volumes
cannot share a mount path and GCS FUSE cannot host SQLite. The bucket is
`STANDARD` class, `force_destroy = true`, versioning off, with
`public_access_prevention = enforced`. Additional buckets can be declared via
`storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS FUSE mount options and CMEK.

### D. First-run setup & the media library

On first access Jellyfin serves an interactive **setup wizard** at `/web` (and `/`)
that creates the administrator account, sets the preferred language, and lets you
add media libraries (Movies, TV, Music, Photos). Nothing is authenticated or usable
until you complete the wizard — there are no default credentials.

Media libraries point at paths inside the container. On Cloud Run, media is served
from the mounted `/config` volume or additional GCS FUSE mounts; for large media
libraries prefer the GKE variant with block or NFS storage.

- **Reach the wizard / web UI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)'
  # open <url>/web in a browser (requires ingress=all or an LB/IAP path)
  ```

### E. Secret Manager & the optional API key

Jellyfin requires **no mandatory cryptographic secrets** — there is no encryption
key, JWT, or master password to manage. When `enable_api_key = true`, the module
generates a 32-character random value and stores it in Secret Manager as
`secret-<prefix>-<app>-api-key`. **Known bug:** `Jellyfin_Common`'s `secret_ids`
output maps this value to the env-var key `QDRANT__SERVICE__API_KEY` — a
copy-paste leftover from the Qdrant_Common module the Jellyfin module was cloned
from — and `Jellyfin_CloudRun` forwards it unchanged via `module_secret_env_vars`.
Jellyfin has no mechanism to read an API key from any environment variable (its
Dockerfile is an unmodified thin wrapper with no custom entrypoint to consume
one), so today `enable_api_key = true` only creates an orphaned Secret Manager
secret — it does **not** let external callers authenticate. The only way to get a
usable API key is in-app under **Dashboard → API Keys**; primary auth remains the
wizard admin account.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### F. Networking & ingress

By default `ingress_settings = "internal"`, so the service is reachable only from
within the VPC — appropriate for a private media server. Set `ingress_settings = "all"`
for a public `run.app` URL, or layer on an external HTTPS load balancer with a
custom domain, Cloud CDN, and Cloud Armor. VPC egress control governs outbound
connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Jellyfin Application Behaviour

- **No initialization Job.** Jellyfin needs no `db-init` step — it creates and
  migrates its own SQLite databases under `/config` the first time it starts. Leave
  `initialization_jobs` empty unless you have custom data-loading tasks.
- **First-run wizard creates the admin.** The `/web` setup wizard walks you through
  creating the administrator account and adding libraries. Until it is completed the
  server has no users and no content.
- **`/config` is the single source of truth — persist it.** All library state is on
  the NFS-backed `/config` volume. Turning NFS off moves `/config` onto GCS FUSE,
  which cannot host SQLite; deleting the share wipes the library, plugins, and users.
  Keep Cloud Run to light/demo use and move a real library to the GKE block-PVC
  variant.
- **Custom image is a thin wrapper.** The Dockerfile is
  `ARG JELLYFIN_VERSION=10.10.3` / `FROM jellyfin/jellyfin:${JELLYFIN_VERSION}`, so
  `image_source = "custom"` and the Foundation mirrors it into Artifact Registry
  (`enable_image_mirroring = true`). `application_version = "latest"` resolves to the
  pinned `10.10.3` via the app-specific `JELLYFIN_VERSION` build arg — it is **not**
  overwritten by the Foundation's generic `APP_VERSION` injection.
- **Health path.** Startup and liveness probes target `GET /health`, which returns
  `Healthy` (200) without authentication once the server is ready. The startup probe
  allows a 15-second initial delay with a generous retry window; the liveness probe
  polls every 30 seconds.
- **Transcoding is CPU-heavy and GPU-less.** Cloud Run has no GPU, so prefer
  direct-play clients. Size `cpu_limit` up for live transcoding and `memory_limit`
  up for large libraries.
- **Inspect the running revision's image and mounts:**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].image)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Jellyfin are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `application_name` | `jellyfin` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Jellyfin Media Server` | Human-readable name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `latest` | Jellyfin image tag; `latest` pins to `10.10.3` via the `JELLYFIN_VERSION` build arg. |
| `enable_api_key` | `false` | Generate a random API key in Secret Manager. Recommended for any deployment reachable outside the VPC. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance; raise for live transcoding. |
| `memory_limit` | `1Gi` | Memory per instance; raise for large libraries. |
| `min_instance_count` | `1` | Keep 1 to stay warm and avoid cold starts mid-stream. |
| `max_instance_count` | `1` | **Keep at 1.** One shared SQLite library on one volume — never run multiple replicas. |
| `container_port` | `8096` | Jellyfin's web/API port. |
| `execution_environment` | `gen2` | Gen2 required for GCS FUSE and NFS mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | Jellyfin has no Cloud SQL — leave `false`. |
| `container_protocol` | `http1` | HTTP/1.1; `h2c` only for HTTP/2 cleartext. |
| `enable_image_mirroring` | `true` | Mirror `jellyfin/jellyfin` into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Inert in this module; foundation manages revision retention. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `internal` | `internal` keeps the server VPC-private; set `all` for a public URL. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of Jellyfin. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings injected into the revision. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC) of the `/config` bucket. |
| `backup_retention_days` | `7` | Retention; raise for production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore a `/config` snapshot on deploy (`tar` default). |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom Initialization & SQL

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — **not applicable to Jellyfin** (no SQL database);
retained for foundation compatibility. Also hosts `nfs_instance_name` /
`nfs_instance_base_name` for NFS discovery.

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the Jellyfin `/config` bucket (created automatically) and any extras. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned `storage` bucket. |
| `enable_nfs` | `true` | Mounts the shared NFS volume at `/config`, which holds Jellyfin's SQLite databases. Keep it on — with it off, `/config` falls back to GCS FUSE, which cannot host SQLite. |
| `nfs_mount_path` | `/config` | Mount path inside the container. |
| `gcs_volumes` | `[]` | Additional GCS FUSE volume mounts (the `/config` bucket is added automatically when `enable_nfs = false`). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed to `NONE` by Jellyfin_Common — Jellyfin uses embedded SQLite, no Cloud SQL. |
| `database_password_length` | `32` | Inert; forwarded for foundation compatibility. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | Not applicable — no SQL database. |
| `db_*_env_var_name` / `service_url_env_var_name` | `""` | Optional extra env-var aliases; leave empty for Jellyfin. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Jellyfin needs no init job; provide only for custom data-loading tasks. |
| `cron_jobs` | `[]` | Optional Cloud Run jobs for maintenance tasks. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health` 15s delay | Startup probe; `/health` returns 200 once ready. |
| `liveness_probe` | HTTP `/health` 30s delay | Liveness probe. |
| `startup_probe_config` | HTTP `/health` | Alternative structured startup probe. |
| `health_check_config` | HTTP `/health` | Alternative structured liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 23 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `jellyfin_url` | Service URL for the Jellyfin web UI / API (VPC-internal when `ingress_settings = internal`). |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (including the `/config` bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any setup jobs (empty for a default Jellyfin deploy). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a `gen1` runtime with NFS/GCS mounts, IAP with no authorized identities, an out-of-range `container_port`/`backup_retention_days`/`timeout_seconds`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_nfs` | `true` (the default) | Critical | The NFS share holds `/config` — the SQLite library, users, and metadata. Turning it off moves `/config` onto GCS FUSE, which cannot host SQLite; removing the share wipes the entire server. |
| `max_instance_count` | `1` | Critical | Multiple replicas write to one SQLite file and corrupt the library. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `execution_environment` | `gen2` | High | Gen1 cannot mount NFS or GCS FUSE, so `/config` never persists. |
| `min_instance_count` | `1` | High | Scale-to-zero cold-starts interrupt in-progress streams and re-load the library. |
| `memory_limit` | `1Gi` (raise for large libraries) | High | Too little memory OOM-kills the server while scanning or transcoding a large library. |
| `cpu_limit` | `1000m` (raise for transcoding) | High | Live transcoding on Cloud Run (no GPU) saturates CPU; prefer direct-play. |
| Heavy transcoding / many streams | Use [Jellyfin_GKE](Jellyfin_GKE.md) | High | Network-storage latency and Cloud Run request timeouts make Cloud Run a poor fit for busy streaming. |
| `enable_api_key` | Leave `false`; not currently functional | Medium | The generated secret is injected as `QDRANT__SERVICE__API_KEY` (a Qdrant_Common copy-paste leftover) — Jellyfin never reads it, so it only creates an orphaned Secret Manager secret. Create API keys in-app under Dashboard → API Keys instead. |
| `ingress_settings` | `internal` unless public | Medium | `all` exposes the media server to the internet — pair with IAP or Cloud Armor. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short to recover an older library snapshot. |
| First-run wizard | Complete immediately | Medium | An un-configured server has no admin; anyone who reaches it can claim the admin account. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Jellyfin-specific application configuration
shared with the GKE variant is described in
**[Jellyfin_Common](Jellyfin_Common.md)**. For a guided walkthrough, see the
[Jellyfin_CloudRun lab](../labs/Jellyfin_CloudRun.md).

<!-- related-guides -->

## Related guides

- [Hands-on lab: Jellyfin on Cloud Run](../labs/Jellyfin_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Jellyfin on GKE Autopilot](Jellyfin_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Jellyfin Common — Shared Application Configuration](Jellyfin_Common.md) — the configuration shared by both deployment targets.
