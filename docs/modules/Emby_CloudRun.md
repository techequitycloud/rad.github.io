---
title: "Emby on Google Cloud Run"
description: "Configuration reference for deploying Emby on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Emby on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Emby_CloudRun.png" alt="Emby on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Emby is a self-hosted media server for organising and streaming your own movies,
TV shows, music, and photos, with client apps for most TVs, phones, and browsers.
Core playback, transcoding-free streaming, and the setup wizard are free — no
license key or emby.media account is required to boot or browse. Emby Premiere, a
paid add-on purchased separately in-app, gates hardware-accelerated transcoding,
the full mobile/TV apps, DVR/live-TV, and offline sync; this differs from
Jellyfin (also in this catalogue), a community fork of the original Emby Server
codebase that is fully open-source with no equivalent gated tier. This module
deploys Emby on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md)
foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Emby uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Emby costs on RAD, and how that compares

**Emby on RAD's Cloud Run module costs about US$19.14 a month.** A self-managed server is cheaper in cash, but then you run the OS, security patches and upgrades yourself. GKE Autopilot suits Emby that must stay up continuously or scale across pods; for the lowest cost, this Cloud Run module already gives you the cheaper option — see the [GKE guide](Emby_GKE.md) if you need the other one. Figures are as at 8 October 2026; sources are listed at the end of this section.

If you only need it occasionally — studying, a demo, a seasonal business — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that US$19.14 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 40 credits (US$4 at the top-up price) | 36 credits (10% lower) |
| Build time | A few credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$19.14 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **9 credits a day**, about 270 a month (about US$27 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (warm) | US$13.14 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$19.14** |

### How it compares

- Emby does not sell hosting — there is no "Emby Cloud" to compare against — so the honest hosting comparison is a bare VPS: Emby's own default is lighter than the ~US$24/month 2 vCPU class those providers quote, so a smaller, cheaper tier of the same providers is enough.
- Separately, and on **any** host including RAD: Emby's core playback is free, but **Emby Premiere** — hardware-accelerated transcoding, the full mobile/TV apps, DVR/live TV, offline sync — is a paid add-on at US$4.99 a month, US$54 a year, or US$119 once for a lifetime licence. That cost is the same whether Emby runs on RAD, a VPS, or a spare machine at home.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Emby runs in **a project RAD manages for you**, you have a second option that goes well
beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to
nothing.** This suits Emby you only need occasionally — studying, a demo, a seasonal
business — far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google
  to delete the project. Google does not remove the project immediately: it keeps it, recoverable,
  for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike
  deleting one module, this does not tear down Cloud Run or its networking one by one — the whole project,
  and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's owner
  can restore it. RAD asks Google to undelete the project and reattaches its billing account,
  then asks you to run **Update** on each deployment to confirm everything came back. Because
  nothing was individually destroyed, that Update finds the same resources already there — it
  is a check, not a rebuild, and an Update never charges the module fee again. That costs **a
  handful of credits (under US$1)** in total for a typical Emby-sized deployment chain, against
  the 40 credits (US$4.05) a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$19.14.** Deploy Emby, use it
  for a while, delete the project. Restore it next time you want it, confirm with Update, and
  delete it again when you're done. You pay only for the module fee once, the builds, and
  whatever hours Emby was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages
  billing for), and you restore it yourself within the 30 days — after that, Google deletes it
  for good. Restoring is admitted like creating a new project: your purchased credit balance
  must still clear the tier's floor (100 credits for the sandbox tier most study and demo use
  fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap worth checking.** Whatever you have pointed Emby at for your media library —
  if it lives inside this deployment's own storage rather than an external library — follow the
  same rule as elsewhere: copy anything irreplaceable out before deleting, since Cloud Storage
  objects without soft-delete enabled do not reliably survive a project deletion even though the
  project itself does.


### Pay only while you use it, the other way: delete and redeploy

Emby's Cloud Run default keeps one instance warm rather than scaling fully to zero, to avoid cold-start delays when you open the app. The option above only applies to a RAD-managed project; **in your own project, or
once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy
it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 44 credits
  (US$4.45), and about an hour, because RAD recreates the project and shared services before Emby. Deleting saves money once Emby would otherwise sit unused
  for about **7 days or more** in your own project (about US$0.64 a day), or about
  **5 days or more** in a RAD-managed one (9 credits a day).
- **Delete everything Emby uses.** Emby's default configuration carries no separate database or VM, so deleting it stops essentially all of its own running cost right away.
- **Keep your data first.** Check whatever storage you have attached for your media library and Emby's own configuration before deleting — the module itself holds no database that needs a separate export.
- **Note your settings.** RAD does not recreate a deleted deployment for you; you enter the
  settings again when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  Emby in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs Emby for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API;
RAD's own fees and daily-credit estimates from [radmodules.dev/pricing](https://radmodules.dev/pricing);
[Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
for the pause/restore mechanics and window. [Emby Premiere pricing](https://emby.media/premiere.html) for the add-on licence figures;


## 1. Overview

Emby runs as a single container on Cloud Run v2. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Media server, 1 vCPU / 1 GiB by default, pinned to a single warm instance |
| Persistence | Cloud Storage + GCS FUSE | The `/config` directory (SQLite databases, metadata, plugins) is backed by a GCS bucket |
| Database | Internal SQLite (embedded) | No Cloud SQL — Emby keeps all state in SQLite files under `/config` |
| Secrets | Secret Manager | Optional auto-generated API key; no mandatory cryptographic secrets |
| Ingress | Cloud Run URL / Cloud Load Balancing | `internal` by default; optional external HTTPS load balancer + custom domain |
| Image delivery | Artifact Registry | The `emby/embyserver` image is mirrored in before deployment |

**Sensible defaults worth knowing up front:**

- **There is no external database.** Emby stores its entire library — the SQLite
  databases, configuration, metadata, artwork, plugins, transcode cache, and
  logs — under a single `/config` directory. No Cloud SQL instance, no `db-init`
  job, and no Redis are provisioned (`database_type = NONE`).
- **`/config` must persist across revisions.** On Cloud Run the `/config` path is
  backed by a Cloud Storage bucket mounted via **GCS FUSE**
  (`enable_gcs_storage_volume = true`). Without a persistent `/config`, every new
  revision starts with an empty library and re-runs the first-run wizard.
- **The container listens on port 8096.** Cloud Run routes HTTP traffic to Emby's
  default web/API port. The web UI and first-run setup wizard are served at `/web`
  (and `/`). Unlike Jellyfin, Emby has **no confirmed, documented unauthenticated
  HTTP health endpoint** — a live container test found `/health` returns `404`
  while `/` responds `302` to the setup wizard — so both probes default to a
  **TCP** check on port 8096 instead of an assumed HTTP path.
- **There are no default credentials.** On first access the setup wizard walks you
  through creating the administrator account and adding media libraries. Nothing is
  usable until that account exists.
- **A single warm instance is the default.** `min_instance_count = 1` keeps the media
  server warm (avoiding cold-start latency mid-stream) and `max_instance_count = 1`
  keeps a single shared SQLite library on a single volume. **Do not run multiple
  replicas** — concurrent writers against one SQLite file corrupt the library.
- **Cloud Run is best for light/demo use.** GCS FUSE latency plus Cloud Run's
  stateless, request-timeout execution model make this variant well-suited to
  evaluation and light personal use — but **not** heavy transcoding or many
  concurrent streams. For a real media library, deploy [Emby_GKE](Emby_GKE.md)
  with a block PVC.
- **API-key auth is optional and off by default.** `enable_api_key = false`. Primary
  authentication is the wizard-created admin account; per-application API keys are
  created in-app under **Dashboard → API Keys**. The generated Secret Manager value
  is injected as `EMBY_API_KEY` — for operators who want a stable credential to
  hand to external API clients, not something Emby itself reads at boot.
- **Emby Premiere is a separate, optional paid tier.** It has no bearing on whether
  this module deploys successfully or whether core streaming works — it only gates
  optional client/DVR/hardware-transcoding features the operator can unlock later.

> **Cloud Run vs GKE — pick the right home for your library.**
> **Cloud Run (this module)** mounts `/config` from a GCS bucket over FUSE. It is
> simple, scales to a single warm instance, and is ideal for a demo or a small
> personal library with occasional direct-play streaming. FUSE I/O latency and the
> per-request timeout model make it a poor fit for live transcoding or busy
> multi-user streaming. **[Emby_GKE](Emby_GKE.md)** runs as a StatefulSet
> with a real **block PVC** at `/config`, giving correct filesystem semantics for
> SQLite and the transcode cache — the recommended choice for a production media
> server, with optional NFS for large media libraries.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Emby service

Emby runs as a Cloud Run v2 service. Because the library is a single SQLite
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

Emby has **no external database**. Its entire state — the SQLite library and
playback databases, configuration, cached metadata and artwork, installed
plugins, the transcode cache, and logs — lives under `/config`
(`EMBY_CONFIG_DIR = /config`). There is no Cloud SQL instance, no Auth Proxy,
and no initialization Job to create a schema; Emby creates and migrates its own
SQLite databases on first start.

Because everything important is a file under `/config`, persisting that directory
**is** persisting the whole server. On Cloud Run it is backed by a Cloud Storage
bucket (see below).

- **Inspect the mounted config on the running revision:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].volumeMounts)'
  ```

### C. Cloud Storage — the `/config` bucket

A dedicated **Cloud Storage** bucket (name suffix `storage`) is provisioned
automatically and mounted at `/config` via **GCS FUSE**
(`enable_gcs_storage_volume = true`, gen2 execution environment). The bucket is
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

On first access Emby serves an interactive **setup wizard** at `/web` (and `/`)
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

Emby requires **no mandatory cryptographic secrets** — there is no encryption
key, JWT, or master password to manage. When `enable_api_key = true`, the module
generates a 32-character random value and stores it in Secret Manager as
`secret-<prefix>-<app>-api-key`, injected into the container as `EMBY_API_KEY`.
Emby itself has no env var that consumes this at boot — the only way to get a
usable API key inside Emby is in-app under **Dashboard → API Keys**; this secret
exists as a stable, Secret-Manager-backed credential operators can reference
externally. Primary auth remains the wizard admin account.

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

## 3. Emby Application Behaviour

- **No initialization Job.** Emby needs no `db-init` step — it creates and
  migrates its own SQLite databases under `/config` the first time it starts. Leave
  `initialization_jobs` empty unless you have custom data-loading tasks.
- **First-run wizard creates the admin.** The `/web` setup wizard walks you through
  creating the administrator account and adding libraries. Until it is completed the
  server has no users and no content.
- **`/config` is the single source of truth — persist it.** All library state is on
  the GCS-backed `/config` volume. Deleting or repointing that bucket wipes the
  library, plugins, and users. Because GCS FUSE is not a true POSIX filesystem,
  keep Cloud Run to light/demo use and move a real library to the GKE block-PVC
  variant.
- **Custom image is a thin wrapper.** The Dockerfile is
  `ARG EMBY_VERSION=4.10.0.15` / `FROM emby/embyserver:${EMBY_VERSION}`, so
  `image_source = "custom"` and the Foundation mirrors it into Artifact Registry
  (`enable_image_mirroring = true`). `application_version = "latest"` resolves to the
  pinned `4.10.0.15` via the app-specific `EMBY_VERSION` build arg — it is **not**
  overwritten by the Foundation's generic `APP_VERSION` injection. A local
  `docker build` + `docker run` verification confirmed the image boots cleanly on
  just `EMBY_CONFIG_DIR` and reaches Emby Server's real startup logic.
- **No dedicated health path — TCP probes.** Startup and liveness probes both use a
  **TCP** check against port 8096, which passes as soon as Emby's listener binds.
  A live test confirmed `/health` returns `404` (no such endpoint) while `/`
  responds `302` to the setup wizard — ruling out an HTTP path as the probe target,
  unlike Jellyfin which documents a working `/health`.
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
settings specific to or notable for Emby are listed; every other input is
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
| `application_name` | `emby` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Emby Media Server` | Human-readable name shown in the Console. |
| `description` | _(set)_ | Service description, including the Premiere licensing note. |
| `application_version` | `latest` | Emby image tag; `latest` pins to `4.10.0.15` via the `EMBY_VERSION` build arg. |
| `enable_api_key` | `false` | Generate a random API key in Secret Manager (`EMBY_API_KEY`). Recommended for any deployment reachable outside the VPC. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance; raise for live transcoding. |
| `memory_limit` | `1Gi` | Memory per instance; raise for large libraries. |
| `min_instance_count` | `1` | Keep 1 to stay warm and avoid cold starts mid-stream. |
| `max_instance_count` | `1` | **Keep at 1.** One shared SQLite library on one volume — never run multiple replicas. |
| `container_port` | `8096` | Emby's web/API port. |
| `execution_environment` | `gen2` | Gen2 required for GCS FUSE and NFS mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | Emby has no Cloud SQL — leave `false`. |
| `container_protocol` | `http1` | HTTP/1.1; `h2c` only for HTTP/2 cleartext. |
| `enable_image_mirroring` | `true` | Mirror `emby/embyserver` into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Inert in this module; foundation manages revision retention. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `internal` | `internal` keeps the server VPC-private; set `all` for a public URL. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of Emby. |
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
`custom_sql_scripts_use_root` — **not applicable to Emby** (no SQL database);
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
| `create_cloud_storage` | `true` | Provision the Emby `/config` bucket (created automatically) and any extras. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned `storage` bucket. |
| `enable_nfs` | `false` | Provision Cloud Filestore (NFS); enable for large shared media libraries. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `gcs_volumes` | `[]` | Additional GCS FUSE volume mounts (the `/config` bucket is added automatically). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed to `NONE` by Emby_Common — Emby uses embedded SQLite, no Cloud SQL. |
| `database_password_length` | `32` | Inert; forwarded for foundation compatibility. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | Not applicable — no SQL database. |
| `db_*_env_var_name` / `service_url_env_var_name` | `""` | Optional extra env-var aliases; leave empty for Emby. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Emby needs no init job; provide only for custom data-loading tasks. |
| `cron_jobs` | `[]` | Optional Cloud Run jobs for maintenance tasks. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP 8096, 15s delay | Startup probe; TCP since Emby has no confirmed health path. |
| `liveness_probe` | TCP 8096, 30s delay | Liveness probe. |
| `startup_probe_config` | `{ enabled = true }` | Alternative structured startup probe. |
| `health_check_config` | `{ enabled = true }` | Alternative structured liveness probe. |
| `uptime_check_config` | `{ enabled=false }` | Cloud Monitoring uptime check. |
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
| `emby_url` | Service URL for the Emby web UI / API (VPC-internal when `ingress_settings = internal`). |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (including the `/config` bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any setup jobs (empty for a default Emby deploy). |
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
| `/config` GCS bucket | Never delete/repoint | Critical | The `/config` bucket holds the SQLite library, users, and metadata; removing it wipes the entire server. |
| `max_instance_count` | `1` | Critical | Multiple replicas write to one SQLite file over FUSE and corrupt the library. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `execution_environment` | `gen2` | High | Gen1 cannot mount GCS FUSE, so `/config` never persists. |
| `min_instance_count` | `1` | High | Scale-to-zero cold-starts interrupt in-progress streams and re-load the library. |
| `memory_limit` | `1Gi` (raise for large libraries) | High | Too little memory OOM-kills the server while scanning or transcoding a large library. |
| `cpu_limit` | `1000m` (raise for transcoding) | High | Live transcoding on Cloud Run (no GPU) saturates CPU; prefer direct-play. |
| Heavy transcoding / many streams | Use [Emby_GKE](Emby_GKE.md) | High | GCS FUSE latency and Cloud Run request timeouts make Cloud Run a poor fit for busy streaming. |
| `startup_probe`/`liveness_probe` type | `TCP` (default) | High | An assumed HTTP `/health` path 404s on Emby (verified live) — an HTTP probe here would never pass. |
| `ingress_settings` | `internal` unless public | Medium | `all` exposes the media server to the internet — pair with IAP or Cloud Armor. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short to recover an older library snapshot. |
| First-run wizard | Complete immediately | Medium | An un-configured server has no admin; anyone who reaches it can claim the admin account. |
| `enable_api_key` | Understand it's operator-only | Low | Emby itself never reads `EMBY_API_KEY` at boot — create in-app API keys under Dashboard → API Keys for actual Emby REST auth. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Emby-specific application configuration
shared with the GKE variant is described in
**[Emby_Common](Emby_Common.md)**. For a guided walkthrough, see the
[Emby_CloudRun lab](../labs/Emby_CloudRun.md).

<!-- related-guides -->

## Related guides

- [Hands-on lab: Emby on Cloud Run](../labs/Emby_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Emby on GKE Autopilot](Emby_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Emby Common — Shared Application Configuration](Emby_Common.md) — the configuration shared by both deployment targets.
