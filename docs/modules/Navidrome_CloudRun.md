---
title: "Navidrome on Google Cloud Run"
description: "Configuration reference for deploying Navidrome on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Navidrome on Google Cloud Run

Navidrome is a free, open-source (GPLv3) self-hosted, Subsonic-compatible music
streaming server written in Go. It scans a music library, serves it through a fast
web UI, and speaks the Subsonic/OpenSubsonic API so any compatible mobile or desktop
client can stream from it. This module deploys Navidrome on **Cloud Run v2** on top
of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Navidrome uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Navidrome runs as a single Go container on Cloud Run v2. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Go music server, 1 vCPU / 1 GiB by default, pinned to a single warm instance |
| Persistence | Cloud Storage + GCS FUSE | The `/data` directory (SQLite DB, metadata cache, search index) is backed by a GCS bucket |
| Database | Internal SQLite (embedded) | No Cloud SQL — Navidrome keeps all state in a SQLite file under `/data` |
| Secrets | Secret Manager | Generated `admin` password (`ND_DEVAUTOCREATEADMINPASSWORD`) when `enable_admin_password = true` |
| Ingress | Cloud Run URL / Cloud Load Balancing | `internal` by default; optional external HTTPS load balancer + custom domain |
| Image delivery | Artifact Registry | The `deluan/navidrome` image is mirrored in before deployment |

**Sensible defaults worth knowing up front:**

- **There is no external database.** Navidrome stores its entire state — the SQLite
  database, metadata cache, and search index — under a single `/data` directory. No
  Cloud SQL instance, no `db-init` job, and no Redis are provisioned
  (`database_type = NONE`; `enable_redis = false`).
- **`/data` must persist across revisions.** On Cloud Run the `/data` path is backed
  by a Cloud Storage bucket mounted via **GCS FUSE** (`enable_gcs_storage_volume = true`,
  gen2 execution environment). Without a persistent `/data`, every new revision starts
  with an empty library and re-runs the first-boot scan and setup.
- **The container listens on port 4533.** Cloud Run routes HTTP traffic to
  Navidrome's default web/API port. `GET /ping` returns `{"status":"ok"}` (200,
  unauthenticated) once the server is up.
- **A generated admin account by default.** `enable_admin_password = true` generates
  a random 24-character password, stores it in Secret Manager, and injects it as
  `ND_DEVAUTOCREATEADMINPASSWORD` so the `admin` user is auto-created on first boot.
  Retrieve it from Secret Manager and change it after first login. Set
  `enable_admin_password = false` to create the first admin through the web wizard
  instead.
- **A single warm instance is the default.** `min_instance_count = 1` keeps the
  server warm (avoiding cold-start latency mid-stream) and `max_instance_count = 1`
  keeps a single shared SQLite library on a single volume. **Do not run multiple
  replicas** — Navidrome is a single-writer server; concurrent writers against one
  SQLite file corrupt the library.
- **The music library is not auto-mounted.** `ND_MUSICFOLDER = /music` is set, but the
  module does not mount anything there — supply the music collection via a `gcs_volumes`
  mount (or NFS) at `/music`.
- **Public ingress requires the generated admin password.** A plan-time guard rejects
  `ingress_settings = "all"` unless `enable_admin_password = true` — otherwise the
  first-run wizard is open to whoever reaches the URL first.

> **Cloud Run vs GKE — pick the right home for your library.**
> **Cloud Run (this module)** mounts `/data` from a GCS bucket over FUSE. It is
> simple, scales to a single warm instance, and is ideal for a demo or a small
> personal library. FUSE I/O latency makes the SQLite-heavy `/data` directory slower
> than block storage. **[Navidrome_GKE](Navidrome_GKE.md)** runs as a StatefulSet
> with a real **block PVC** at `/data`, giving the correct filesystem semantics the
> embedded SQLite database needs — the recommended choice for a larger or busier
> library, with optional NFS for a large music collection.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Navidrome service

Navidrome runs as a Cloud Run v2 service. Because the library is a single SQLite
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

### B. Persistent data store (SQLite on `/data`)

Navidrome has **no external database**. Its entire state — the SQLite database, the
metadata cache, and the search index — lives under `/data` (`ND_DATAFOLDER = /data`).
There is no Cloud SQL instance, no Auth Proxy, and no initialization Job to create a
schema; Navidrome creates and migrates its own SQLite database on first start.

Because everything important is a file under `/data`, persisting that directory
**is** persisting the whole server. On Cloud Run it is backed by a Cloud Storage
bucket (see below).

- **Inspect the mounted volume on the running revision:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].volumeMounts)'
  ```

### C. Cloud Storage — the `/data` bucket (and music library)

A dedicated **Cloud Storage** bucket (name suffix `storage`) is provisioned
automatically and mounted at `/data` via **GCS FUSE**
(`enable_gcs_storage_volume = true`, gen2 execution environment). The bucket is
`STANDARD` class, `force_destroy = true`, versioning off, with
`public_access_prevention = enforced`. The **music library** at `/music` is not
mounted automatically — declare an additional GCS FUSE volume via `gcs_volumes` (or
enable NFS) pointing at your music collection.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS FUSE mount options and CMEK.

### D. Secret Manager & the admin password

When `enable_admin_password = true` (the default), the Common layer generates a
24-character random password, stores it in Secret Manager as
`secret-<prefix>-navidrome-admin-password`, and injects it as
`ND_DEVAUTOCREATEADMINPASSWORD` so Navidrome auto-creates the `admin` user on first
boot. There is no encryption key or JWT secret to manage.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~navidrome-admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

By default `ingress_settings = "internal"`, so the service is reachable only from
within the VPC — appropriate for a private music server. Set `ingress_settings = "all"`
for a public `run.app` URL (requires `enable_admin_password = true`, enforced at plan
time), or layer on an external HTTPS load balancer with a custom domain, Cloud CDN,
and Cloud Armor. VPC egress control governs outbound connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Navidrome Application Behaviour

- **No initialization Job.** Navidrome needs no `db-init` step — it creates and
  migrates its own SQLite database under `/data` the first time it starts. Leave
  `initialization_jobs` empty unless you have custom data-loading tasks.
- **Admin auto-creation on first boot.** With `enable_admin_password = true`,
  `ND_DEVAUTOCREATEADMINPASSWORD` is injected and Navidrome creates the `admin` user
  with the generated password on first start. Log in as `admin`, retrieve the
  password from Secret Manager, and change it. With `enable_admin_password = false`,
  the first access serves a **create-admin wizard** instead — complete it immediately
  so nobody else can claim the admin account.
- **Library scan runs on start.** Navidrome scans `ND_MUSICFOLDER` (`/music`) on
  startup and periodically; a large collection takes time to index into the SQLite
  database and search index under `/data`.
- **`/data` is the single source of truth — persist it.** All library state is on the
  GCS-backed `/data` volume. Deleting or repointing that bucket wipes the database,
  users, playlists, and play counts. Because GCS FUSE is not a true POSIX filesystem,
  keep Cloud Run to light/personal use and move a larger library to the GKE block-PVC
  variant.
- **Custom image is a thin wrapper.** The Dockerfile is
  `ARG NAVIDROME_VERSION=0.54.3` / `FROM deluan/navidrome:${NAVIDROME_VERSION}`, so
  `image_source = "custom"` and the Foundation mirrors it into Artifact Registry
  (`enable_image_mirroring = true`). `application_version = "latest"` resolves to the
  pinned `0.54.3` via the app-specific `NAVIDROME_VERSION` build arg — it is **not**
  overwritten by the Foundation's generic `APP_VERSION` injection.
- **Health path.** Startup and liveness probes target `GET /ping`, which returns
  `{"status":"ok"}` (200) without authentication once the server is ready. The
  startup probe allows a 15-second initial delay with a generous retry window; the
  liveness probe polls every 30 seconds.
- **Inspect the running revision's image and env:**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].image)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Navidrome are listed; every other input is
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
| `application_name` | `navidrome` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Navidrome Music Server` | Human-readable name shown in the Console. |
| `description` | `Navidrome — self-hosted, Subsonic-compatible music streaming server` | Service description. |
| `application_version` | `latest` | Navidrome image tag; `latest` pins to `0.54.3` via the `NAVIDROME_VERSION` build arg. |
| `enable_admin_password` | `true` | Generate a random `admin` password in Secret Manager and inject `ND_DEVAUTOCREATEADMINPASSWORD`. Required for public ingress. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance; raise for large-library scanning. |
| `memory_limit` | `1Gi` | Memory per instance; Navidrome holds its search index in memory — size to the library. |
| `min_instance_count` | `1` | Keep 1 to stay warm and avoid cold starts mid-stream. |
| `max_instance_count` | `1` | **Keep at 1.** One shared SQLite library on one volume — never run multiple replicas. |
| `container_port` | `4533` | Navidrome's web/API port. |
| `execution_environment` | `gen2` | Gen2 required for GCS FUSE and NFS mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | Navidrome has no Cloud SQL — leave `false`. |
| `enable_image_mirroring` | `true` | Mirror `deluan/navidrome` into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `internal` | `internal` keeps the server VPC-private; `all` (public) requires `enable_admin_password = true`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of Navidrome. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra `ND_*` settings; override `ND_MUSICFOLDER` / `ND_DATAFOLDER` here if you remap volumes. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC) of the `/data` bucket. |
| `backup_retention_days` | `7` | Retention; raise for production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore a `/data` snapshot on deploy (`tar` default). |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom Initialization & SQL

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — **not applicable to Navidrome** (no SQL database);
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
| `create_cloud_storage` | `true` | Provision the Navidrome `/data` bucket (created automatically) and any extras. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned `storage` bucket. |
| `enable_nfs` | `false` | Provision Cloud Filestore (NFS); enable to mount a large shared music library. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `gcs_volumes` | `[]` | Additional GCS FUSE mounts — use to mount the music library at `/music`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed to `NONE` by Navidrome_Common — Navidrome uses embedded SQLite, no Cloud SQL. |
| `database_password_length` | `32` | Inert; forwarded for foundation compatibility. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | Not applicable — no SQL database. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Navidrome needs no init job; provide only for custom data-loading tasks. |
| `cron_jobs` | `[]` | Optional Cloud Run jobs for maintenance tasks. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/ping` 15s delay | Startup probe; `/ping` returns `{"status":"ok"}` (200) once ready. |
| `liveness_probe` | HTTP `/ping` 30s delay | Liveness probe. |
| `startup_probe_config` | HTTP `/ping` | Alternative structured startup probe. |
| `health_check_config` | HTTP `/ping` | Alternative structured liveness probe. |
| `uptime_check_config` | `{ path="/ping" }` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis (forwarded for foundation compatibility)

`enable_redis` is set to `false` by this module and Navidrome uses no cache or queue;
`redis_host` / `redis_port` / `redis_auth` are inert. Leave at defaults.

### Group 22 — VPC Service Controls & Audit Logging

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
| `navidrome_url` | Service URL for the Navidrome web UI / Subsonic API (VPC-internal when `ingress_settings = internal`). |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (including the `/data` bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any setup jobs (empty for a default Navidrome deploy). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

The generated admin password is not returned as an output; retrieve it from Secret
Manager (`secret-<prefix>-navidrome-admin-password`, see §2 / §4.D).

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a `gen1` runtime with NFS/GCS mounts, IAP with no authorized identities, an out-of-range `container_port`/`backup_retention_days`/`timeout_seconds`. A Navidrome-specific guard additionally rejects `ingress_settings = "all"` unless `enable_admin_password = true`, and `min_instance_count > max_instance_count`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `/data` GCS bucket | Never delete/repoint | Critical | The `/data` bucket holds the SQLite database, users, and playlists; removing it wipes the entire server. |
| `max_instance_count` | `1` | Critical | Multiple replicas write to one SQLite file over FUSE and corrupt the library. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `ingress_settings = "all"` without `enable_admin_password` | keep admin password on | Critical | Blocked at plan time — a public URL with an open first-run wizard lets a stranger claim the `admin` account. |
| `execution_environment` | `gen2` | High | Gen1 cannot mount GCS FUSE, so `/data` never persists. |
| `min_instance_count` | `1` | High | Scale-to-zero cold-starts interrupt in-progress streams and re-open the library. |
| `memory_limit` | `1Gi` (raise for large libraries) | High | Navidrome holds its search index in memory; too little OOM-kills the server while scanning. |
| `ND_MUSICFOLDER` mount | Provide music at `/music` | High | Without a `gcs_volumes`/NFS mount at `/music`, the library is empty — nothing to stream. |
| `enable_admin_password` | `true` | Medium | Off leaves an open create-admin wizard on first access; complete it immediately or restrict ingress. |
| `ingress_settings` | `internal` unless public | Medium | `all` exposes the music server to the internet — pair with IAP or Cloud Armor. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short to recover an older library snapshot. |
| Generated admin password | Change after first login | Medium | The bootstrap password sits in Secret Manager; rotate it in-app for real users. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Navidrome-specific application configuration
shared with the GKE variant is described in
**[Navidrome_Common](Navidrome_Common.md)**.
