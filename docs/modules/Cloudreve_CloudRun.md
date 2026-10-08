---
title: "Cloudreve on Google Cloud Run"
description: "Configuration reference for deploying Cloudreve on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Cloudreve on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Cloudreve_CloudRun.png" alt="Cloudreve on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cloudreve is a popular open-source, self-hosted cloud storage and file-sharing
platform written in Go. It provides a web UI for uploading, organising,
previewing and sharing files, with pluggable storage back-ends. This module
deploys Cloudreve on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Cloudreve uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress
and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## What Cloudreve costs on RAD, and how that compares

**Cloudreve on RAD's Cloud Run module costs about US$32.57 a month in a Google Cloud project you own, plus a one-time 40-credit module fee (US$4).** Cloudreve is a self-hosted cloud storage and file-sharing platform. GKE Autopilot suits Cloudreve that must stay up, scale across pods, or run beside other Kubernetes workloads; for the lowest cost, this Cloud Run module is usually the right pick — see the [GKE guide](Cloudreve_GKE.md) if you need the other.

If Cloudreve is only needed occasionally — a demo, a trial, a seasonal or study workload — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that US$32.57 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 40 credits (US$4 at the top-up price) | 36 credits (10% lower) |
| Build time | A few credits per build (roughly 3–6) | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$32.57 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **15 credits a day**, about 450 a month (about US$45 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, less on a plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (warm) | US$13.14 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$32.57** |

### How it compares

- Run it yourself and a VPS running Cloudreve and its own storage back-end costs less in cash: a Hetzner CPX22 or DigitalOcean 2 vCPU/4 GB box is about $24 a month, or a GCP `e2-standard-2` about $49 a month — plus your own time for backups, security patches and upgrades, which RAD's managed Cloud SQL, Secret Manager and monitoring cover for you.
- RAD never claims to be cheaper than bare infrastructure in cash terms — it usually is not. The difference is what RAD manages for you: patching, backups, secrets and monitoring, plus the ability to pause Cloudreve for free rather than paying for idle capacity (see below).

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Cloudreve runs in **a project RAD manages for you**, you have a second option that goes well beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to nothing.** This suits Cloudreve that you only need occasionally far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google to delete the project. Google does not remove the project immediately: it keeps it, recoverable, for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike deleting one module, this does not tear down the VM or Cloud Run resources one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's owner can restore it. RAD asks Google to undelete the project and reattaches its billing account, then asks you to run **Update** on each deployment to confirm everything came back. Because nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a rebuild, and an Update never charges the module fee again. That is a handful of credits (under US$1) in total for a typical Cloudreve chain, against the 45 credits a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$32.57.** Deploy Cloudreve, use it, delete the project. Restore it next time you want it, confirm with Update, and delete it again when you're done. You pay only for the module fee once, the builds, and whatever hours it was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages billing for), and you restore it yourself within the 30 days — after that, Google deletes it for good. Restoring is admitted like creating a new project: your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier most study and demo use fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap: the backup bucket does not survive.** Nightly backups are written to a bucket inside the project, and that bucket is **not** protected by Cloud Storage's soft-delete, so it is very likely gone as soon as you delete the project — even though the project itself is recoverable for 30 days. If you have customised Cloudreve and want to keep that work, copy a backup out (to Google Drive, or a bucket outside the project) before you delete. For a default installation with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

Cloud Run keeps a warm instance, so it does not scale fully to zero on its own. The option above only applies to a RAD-managed project; **in your own project, or once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 45 credits (US$4.50) in your own project. Deleting saves money only once Cloudreve would otherwise sit unused for about 5 days or more, whether in your own project or a RAD-managed one.
- **Most of the running cost is usually the shared file or cache server.** It stops only when nothing else in the project uses it, so deleting Cloudreve while something else shares the project saves only this app's own compute part.
- **Keep your data first.** Nightly backups are written to a bucket inside the deployment and are deleted with it, so copy the latest backup out before deleting if you want to keep it.
- **Note your settings.** RAD does not recreate a deleted deployment for you; you enter the settings again when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either the trainer funds every place, or each participant pays for their own. Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's own fees and daily-credit estimates from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the 30-day recovery window and what it says about Cloud Storage objects without soft delete. Prices change; check each source before relying on a figure.

## 1. Overview

Cloudreve runs as a single Go binary serving both the web UI and file storage
API. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Go binary on port 5212, single instance by default (`min = max = 1`) |
| Persistence | Cloud Filestore (NFS) | Mounted at `/cloudreve` (`enable_nfs = true` by default); holds the embedded SQLite DB, generated `conf.ini`, uploads and avatars. Cloud Run has no block-volume equivalent to GKE's PVC, and GCS FUSE cannot host a SQLite database |
| Object storage | Cloud Storage | A `storage` bucket is created; it is mounted at `/cloudreve` via GCS FUSE only if `enable_nfs` is turned off (not recommended) |
| Database | None | Cloudreve uses an embedded SQLite database on the mounted volume — no Cloud SQL instance is created |
| Secrets | Secret Manager | None created — the first-run admin password is generated by Cloudreve itself and printed to container logs |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No SQL database.** `database_type` is fixed to `NONE` by `Cloudreve_Common`;
  every Cloud SQL-related variable is forwarded to the foundation only for
  interface compatibility and has no effect.
- **NFS is the persistence mechanism, and `enable_nfs` must stay `true`.**
  Cloud Run has no block-volume option, and GCS FUSE cannot host a SQLite
  database (no POSIX or shared-memory locking; sequential-append writes only) —
  on GCS FUSE Cloudreve's journal writes fail and an instance can fail to start
  at all. So the shared NFS volume is mounted at `/cloudreve` (`nfs_mount_path`)
  and the wrapper turns the GCS FUSE storage volume off whenever NFS is on
  (`enable_gcs_storage_volume = !var.enable_nfs`). Cloudreve uses a rollback
  journal rather than WAL, so NFS is a sound target with a single writer. For a
  real block device, use Cloudreve_GKE.
- **Binary/data co-location is handled in the image build.** Upstream's
  `cloudreve/cloudreve` image keeps both the `cloudreve` binary and its data in
  `/cloudreve`. This module's Dockerfile relocates the binary to
  `/usr/local/bin/cloudreve` in a multi-stage build (`ENTRYPOINT
  ["/usr/local/bin/cloudreve"]`, `WORKDIR /cloudreve`), so mounting the data
  volume at `/cloudreve` only shadows data files, never the binary. See
  [Section 3](#3-cloudreve-application-behaviour).
- **No Cloud SQL, no Redis.** `enable_cloudsql_volume` defaults `false` and
  `enable_redis` is explicitly overridden to `false` in `main.tf`, regardless
  of the variable's own value.
- **No injectable admin secret.** Cloudreve generates its own initial admin
  password on first boot and prints it to container logs — no Secret Manager
  secret is created; `secret_ids`/`secret_values` from `Cloudreve_Common` are
  empty maps.
- **Single instance by default.** `min_instance_count = max_instance_count =
  1`, matching Cloudreve's lack of distributed/multi-node clustering support
  and avoiding concurrent writers against the single mounted SQLite file.
- **`container_port` defaults to `5212`** and is actually forwarded to the
  effective per-app config (unlike some other pass-through variables in this
  module) — but changing it does **not** change what the Cloudreve binary
  itself listens on internally, since there is no env var or CLI flag wiring
  that port into the container. Leave it at the default.
- **Public ingress is on by default** (`ingress_settings = "all"`) so the web
  UI is reachable directly at the Cloud Run URL.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Cloudreve service

Cloudreve runs as a Cloud Run v2 service. Each deployment creates an immutable
revision; traffic can be split across revisions for safe rollouts. With the
default `min_instance_count = max_instance_count = 1`, exactly one instance
serves all traffic at any time.

- **Console:** Cloud Run → select the service for revisions, traffic, logs,
  and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud Filestore (NFS persistence) and Cloud Storage

Cloudreve's embedded SQLite database (`cloudreve.db`), generated `conf.ini`,
and uploaded files all live under `/cloudreve`, the container's working
directory. That path is the mount point of the shared **NFS** volume
(`enable_nfs = true`, `nfs_mount_path = "/cloudreve"`) — Cloud Run has no
block-volume equivalent to a GKE PVC, and GCS FUSE cannot host a SQLite
database. A dedicated `storage` Cloud Storage bucket is still created by
`Cloudreve_Common`; it is mounted at `/cloudreve` via GCS FUSE only if you turn
NFS off, which is not recommended.

- **Console:** Cloud Storage → Buckets → filter for the deployment's
  `storage` suffix.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<data-bucket>/
  ```

SQLite has a single writer here, so running more than one instance
(`max_instance_count > 1`) risks corrupting the embedded database file — see [Section 6](#6-configuration-pitfalls--sensible-defaults).
See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### C. Secret Manager

`Cloudreve_Common` creates **no** Secret Manager secrets for Cloudreve itself —
the first-run admin password is generated internally by Cloudreve and printed
to container logs on first boot, not stored in Secret Manager. Any secrets
configured via `secret_environment_variables` are still injected through the
standard Secret Manager mechanism.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~cloudreve"
  gcloud logging read 'resource.type="cloud_run_revision"' --project "$PROJECT" --limit 200 | grep -i "admin\|password"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details
(rotation has no effect here since no service secret exists).

### D. Networking & ingress

The service is reachable at its `run.app` URL by default
(`ingress_settings = "all"`). An external HTTPS load balancer with a custom
domain, Cloud CDN, and Cloud Armor can be layered on via `enable_cloud_armor`;
ingress settings and VPC egress control connectivity otherwise.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging — this is also where the generated
first-run admin password appears (see [Section 3](#3-cloudreve-application-behaviour)).
Cloud Run metrics flow to Cloud Monitoring, with optional uptime checks and
alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Cloudreve Application Behaviour

- **No database initialisation job.** `Cloudreve_Common` does not inject a
  default `db-init`/`db-create` job — Cloudreve has no SQL database to
  provision. `initialization_jobs` only runs jobs you explicitly supply.
- **First-boot self-setup, admin password in logs.** On first start Cloudreve
  creates its SQLite schema on the mounted `/cloudreve` volume and generates the
  initial admin account, printing the generated password to container logs.
  There is no separate migration step and no Secret Manager secret to
  retrieve it from — capture it with `gcloud run services logs read` (or
  `gcloud logging read`) before the log buffer rotates, then change it via the
  web UI.
- **Volume-shadowing is pre-fixed in the Dockerfile.** Without the relocation
  described in [Section 1](#1-overview), the volume mounted at `/cloudreve`
  would shadow the co-located binary, producing `exec ./cloudreve: no such
  file or directory` (crash loop). This is a **custom-build** module
  (`container_image_source = "custom"`, `image_source = "custom"` in
  `Cloudreve_Common`) precisely so this fix
  (`modules/Cloudreve_Common/scripts/Dockerfile`) can be baked in — it is not
  a bare pass-through of the upstream image. Editing the Dockerfile requires a
  rebuild (`tofu taint
  'module.app_cloudrun.module.app_build.null_resource.build_and_push_application_image[0]'`
  if a content-hash trigger misses the change).
- **Version pinning uses an app-specific build ARG.** The Dockerfile reads
  `CLOUDREVE_VERSION` (pinned to `3.8.3` when `application_version =
  "latest"`), not the generic `APP_VERSION` the Foundation injects and would
  otherwise force to the unresolvable tag `latest`.
- **Health probe paths.** Startup probe is **HTTP** `GET /`
  (`initial_delay_seconds = 15`, `failure_threshold = 10`, i.e. up to ~100s to
  become ready); liveness probe is **HTTP** `GET /` as well
  (`initial_delay_seconds = 30`, `period_seconds = 30`). Cloudreve has no
  dedicated health endpoint distinct from its web UI — `/` returns 200 once
  the server is serving.
- **Single-instance semantics.** With `min_instance_count = max_instance_count
  = 1`, only one instance serves traffic; do not raise `max_instance_count`
  without verifying Cloudreve's own multi-node/clustering support (not managed
  by this module) — the shared SQLite file has no built-in
  protection against concurrent writers.
- **`container_port` is forwarded but not wired into the app.** The Cloudreve
  binary listens on its own default port (5212) with no env var or CLI flag in
  this module's Dockerfile to change it; changing `container_port` only
  changes what Cloud Run routes to, so it should stay at the default.
- **Inspect the running service and job execution:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT"
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform (per
their `{{UIMeta group=N}}` tags). Only settings specific to or notable for
Cloudreve are listed; every other input is inherited from
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
| `application_name` | `cloudreve` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Cloudreve` | Human-readable name shown in the Console. |
| `description` | `Cloudreve — self-hosted cloud storage / file-sharing system` | Service description. |
| `application_version` | `latest` | `cloudreve/cloudreve` image tag; `latest` is pinned to `3.8.3` at build time via the `CLOUDREVE_VERSION` build ARG. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `1Gi` | Memory per instance; size for file-serving and concurrent transfers. |
| `min_instance_count` | `1` | Kept at 1 to avoid cold starts during Cloudreve's index loading. |
| `max_instance_count` | `1` | **Keep at 1** — no verified multi-node/clustering support, and a shared SQLite file has no concurrent-writer protection. |
| `container_port` | `5212` | Cloudreve's default HTTP port. Forwarded through to the effective per-app config, but not wired to the binary's own listen port — leave at default. |
| `execution_environment` | `gen2` | Required for the NFS (and GCS Fuse) mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | Cloudreve has no Cloud SQL database — always `false`. |
| `enable_image_mirroring` | `true` | Mirror the Cloudreve image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `container_protocol` | `http1` | HTTP/1.1; `h2c` available but not required by Cloudreve. |
| `service_annotations` / `service_labels` | `{}` | Custom annotations/labels on the Cloud Run service resource. |
| `container_image` / `container_image_source` / `container_build_config` / `container_resources` / `cloudsql_volume_mount_path` / `max_revisions_to_retain` | _(various)_ | Declared for Foundation-variable mirroring only — **not forwarded** in `main.tf`. The actual image, build config (Dockerfile path, `CLOUDREVE_VERSION` build arg), and resource shape are fixed inside `Cloudreve_Common`. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public access to reach the web UI directly. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of Cloudreve's own login. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings passed straight through to the container. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency (no service secret exists to rotate by default). |

### Group 7 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy (`backup_uri` is forwarded to the foundation's `backup_file` input). |
| `additional_containers` / `additional_services` | `[]` | Declared for Foundation mirroring only; Cloudreve does not use sidecar containers or supplementary services. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `github_app_installation_id`,
`cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Group 9 — Custom SQL Scripts & NFS Instance Selection

| Variable | Default | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | off | Not applicable — Cloudreve has no SQL database. |
| `nfs_instance_name` / `nfs_instance_base_name` / `nfs_volume_name` | auto-discover / `app-nfs` / `nfs-data-volume` | Select which NFS instance backs `/cloudreve` (`enable_nfs` is on by default and must stay on for Cloudreve on Cloud Run). |

### Group 10 — Load Balancer, CDN & Image Retention

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
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`; also gates the auto-provisioned `storage` bucket. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned data bucket. |
| `enable_nfs` | `true` | Must stay `true` on Cloud Run: Cloudreve keeps `conf.ini`, its SQLite database, uploads and avatars under `/cloudreve`, and GCS FUSE cannot host a SQLite database. |
| `nfs_mount_path` | `/cloudreve` | Must stay `/cloudreve` — Cloudreve's working directory, where all its state lives. |
| `gcs_volumes` | `[]` | Additional GCS Fuse volume mounts. The `storage` bucket is mounted at `/cloudreve` only when `enable_nfs = false`; with NFS on (the default) only the entries here are mounted. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `enable_redis` | App_CloudRun default `true`, but **forced `false`** in `main.tf` | Cloudreve does not use Redis; the variable's value has no effect regardless of setting. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed by `Cloudreve_Common` — Cloudreve has no SQL database. |
| `database_password_length` / `enable_auto_password_rotation` / `rotation_propagation_delay_sec` / `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `db_password_env_var_name` / `service_url_env_var_name` / `application_database_name` / `application_database_user` / `enable_mysql_plugins` / `mysql_plugins` / `enable_postgres_extensions` / `postgres_extensions` / `sql_instance_name` / `sql_instance_base_name` | _(various)_ | All declared for Foundation-variable mirroring only and **not forwarded** in `main.tf` — Cloudreve has no database to which any of these could apply. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No default job is injected — Cloudreve needs no database setup. Only supply jobs for custom data loading or maintenance tasks. |
| `cron_jobs` | `[]` | No platform-scheduled recurring tasks by default. |
| `backup_file` | `backup.sql` | Declared for Foundation mirroring only; the real restore filename comes from `backup_uri` (group 7) via `backup_source`/`backup_format`. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /`, `initial_delay=15s`, `failure_threshold=10` | No dedicated health endpoint — Cloudreve serves `/` once ready. |
| `liveness_probe` | HTTP `GET /`, `initial_delay=30s`, `period=30s` | Same endpoint as the startup probe. |
| `startup_probe_config` | HTTP `/`, enabled | Alternative structured probe; the per-app `startup_probe` above is the one actually wired through `Cloudreve_Common`. |
| `health_check_config` | HTTP `/`, enabled | Alternative structured liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 15 — Networking

| Variable | Default | Description |
|---|---|---|
| `network_name` | `""` (auto-discover) | Declared for Foundation mirroring only; **not forwarded** in `main.tf` — the module always auto-discovers the single Services_GCP-managed VPC. |

### Group 23 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `organization_id` | `""` | Override for folder-nested projects. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore
the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `cloudreve_url` | URL for the Cloudreve web UI (port 5212). Reachability depends on `ingress_settings`; `internal` restricts it to the same VPC. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets, including the `storage` bucket. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any user-supplied initialization jobs (Cloudreve injects none by default). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

Note that, unlike most application modules, there are **no `database_*`
outputs** — Cloudreve has no Cloud SQL instance to describe.

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, a `gen1` runtime with the required GCS Fuse mount, an out-of-range `container_port`/`backup_retention_days`/`secret_propagation_delay`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_nfs` (persistence at `/cloudreve`) | `true` | Critical | Turning it off falls back to a GCS FUSE mount, which cannot host Cloudreve's SQLite database: journal writes fail and an instance can fail to start. For a block device, use `Cloudreve_GKE`. |
| Dockerfile binary relocation (`/usr/local/bin/cloudreve`) | Keep as shipped | Critical | Reverting to `ENTRYPOINT ["./cloudreve"]` inside `/cloudreve` re-introduces volume-shadowing: the `/cloudreve` volume mount hides the binary and the container crash-loops with `exec ./cloudreve: no such file or directory`. |
| `max_instance_count` | `1` | Critical | Cloudreve has no verified multi-node/clustering mode in this module; scaling beyond 1 risks concurrent writers against the same SQLite file. |
| Admin password retrieval | Capture from `gcloud run services logs read` immediately after first boot | High | The generated admin password is only printed to container logs once; missing it locks you out of the first-run super-admin account until you find another recovery path. |
| `container_port` | `5212` | High | Cloudreve's binary listens on a fixed default port with no env/CLI wiring to change it in this module; changing the variable only changes Cloud Run's routing target, breaking connectivity. |
| `min_instance_count` | `1` | Medium | Scale-to-zero (`0`) adds cold-start latency while Cloudreve reloads its index from the mounted volume, and increases the chance of overlapping cold/warm instances momentarily touching the same SQLite file during a rollout. |
| `ingress_settings` | `all` | Medium | Setting to `internal` blocks direct access to the web UI unless fronted by a Load Balancer or accessed from within the VPC. |
| `enable_iap` | Optional | Low–Medium | IAP adds a Google-identity gate in front of Cloudreve's own login; without it, Cloudreve's own auth is the only barrier to the public internet. |
| `database_type` / other `db_*` / `sql_*` variables | Leave at defaults | Low | Cloudreve has no SQL database — any value here is a no-op, since `database_type` is fixed to `NONE` by `Cloudreve_Common`. |
| `enable_redis` | Leave at default | Low | Forced to `false` in `main.tf` regardless of the variable's value — Cloudreve does not use Redis. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Cloudreve-specific application
configuration shared with the GKE variant lives in the `Cloudreve_Common`
module (`modules/Cloudreve_Common`); a dedicated `Cloudreve_Common.md` guide
does not yet exist in this documentation set — see also
**[Cloudreve_GKE](Cloudreve_GKE.md)** for the block-PVC-backed production
alternative.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Cloudreve on Cloud Run](../labs/Cloudreve_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Cloudreve on GKE Autopilot](Cloudreve_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Cloudreve Common — Shared Application Configuration](Cloudreve_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Gokapi on Google Cloud Run](Gokapi_CloudRun.md), [Chibisafe on Google Cloud Run](Chibisafe_CloudRun.md) in the **File Sharing & Transfer** solution.
