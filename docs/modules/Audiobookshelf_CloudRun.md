---
title: "Audiobookshelf on Google Cloud Run"
description: "Configuration reference for deploying Audiobookshelf on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Audiobookshelf on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Audiobookshelf_CloudRun.png" alt="Audiobookshelf on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Audiobookshelf is a self-hosted audiobook and podcast server — it organises your audio library, streams to the web UI and the official mobile apps, and keeps per-user listening progress in sync. This module deploys Audiobookshelf on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Audiobookshelf uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run application — service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Audiobookshelf runs as a Node.js container on Cloud Run v2. Unusually for this catalogue, it needs **no external database, no Redis, and no application secrets** — the deployment footprint is deliberately small:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 1 vCPU / 1 GiB by default, pinned to a single instance |
| Database | None | Audiobookshelf embeds its own SQLite database under `/data/config` — no Cloud SQL |
| Persistent state | Cloud Storage (GCS FUSE) | A dedicated `storage` bucket mounted at `/data` (gen2 required) |
| Container image | Cloud Build + Artifact Registry | Thin wrapper built `FROM ghcr.io/advplyr/audiobookshelf` and mirrored into your registry |
| Secrets | Secret Manager | No application secrets — the admin user is created in the first-run web UI |
| Ingress | Cloud Run URL / Cloud Load Balancing | **Defaults to `internal`** (VPC-only); optional external HTTPS load balancer |

**Sensible defaults worth knowing up front:**

- **No external database.** `database_type = "NONE"` and `enable_cloudsql_volume = false` are fixed by `Audiobookshelf_Common`; Audiobookshelf creates and migrates its internal SQLite database on first boot. No `db-init` job runs.
- **One persistent mount covers everything.** `CONFIG_PATH = /data/config` (SQLite DB + app config) and `METADATA_PATH = /data/metadata` (cover art, cached metadata) are both redirected under `/data`, which is backed by an automatically provisioned GCS bucket mounted via GCS FUSE. Losing this bucket loses all Audiobookshelf state.
- **Single instance.** `min_instance_count = 1` and `max_instance_count = 1` — one shared SQLite library must be served by exactly one writer. Do not raise the maximum.
- **Ingress defaults to `internal`.** The `run.app` URL is only reachable from inside the VPC. Set `ingress_settings = "all"` (or front the service with the load balancer) to reach the web UI from a browser.
- **Custom (thin-wrapper) image.** Cloud Build wraps the upstream `ghcr.io/advplyr/audiobookshelf` image so it is mirrored into Artifact Registry. The Dockerfile reads the app-specific `AUDIOBOOKSHELF_VERSION` build ARG; `application_version = "latest"` resolves to the pinned `2.17.0`.
- **No generated secrets.** The initial **root** user is created interactively in the first-run web UI, and API tokens are minted in the UI afterwards — `Audiobookshelf_Common` exposes empty `secret_ids`.
- **Health probes target `/healthcheck`**, Audiobookshelf's unauthenticated 200 endpoint (startup: 15 s initial delay, 10 failures allowed; liveness: 30 s delay, 3 failures).
- **No Redis.** `enable_redis` is explicitly forced to `false` in the foundation call.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Audiobookshelf service

Audiobookshelf runs as a Cloud Run v2 service pinned to a single instance. Each deployment creates an immutable revision; traffic moves to the newest healthy one.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and traffic splitting.

### B. Cloud Storage — the `/data` state bucket

All Audiobookshelf state — the SQLite database, application config, cover art, and cached metadata — lives under `/data`, backed by a dedicated **Cloud Storage** bucket (suffix `storage`) mounted into the container via **GCS FUSE**. The gen2 execution environment is required for FUSE mounts. Additional media buckets (for example a read-only audiobook library) can be attached through `gcs_volumes`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/          # bucket name is in the Outputs
  gcloud storage ls gs://<storage-bucket>/config/   # SQLite DB + app config
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse mount options and CMEK.

### C. Cloud Build & Artifact Registry — the container image

The module builds a thin wrapper image `FROM ghcr.io/advplyr/audiobookshelf:${AUDIOBOOKSHELF_VERSION}` via Cloud Build and stores it in the tenant's Artifact Registry, insulating deploys from upstream registry rate limits and pinning the version.

- **Console:** Cloud Build → History; Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list \
    "$REGION-docker.pkg.dev/$PROJECT/<repo>/audiobookshelf" --project "$PROJECT"
  ```

### D. Secret Manager

Audiobookshelf itself needs no injected secrets — there is no database password, master key, or JWT secret. Secret Manager remains available for any custom `secret_environment_variables` you add.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  ```

### E. Networking & ingress

By default `ingress_settings = "internal"` — the service answers only to callers inside the VPC. To use Audiobookshelf from a browser or the mobile apps, either set `ingress_settings = "all"` or enable the external HTTPS load balancer (`enable_cloud_armor`) with a custom domain.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring, with an optional uptime check (disabled by default — it can only pass against a publicly reachable endpoint) and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Audiobookshelf Application Behaviour

- **Self-contained first boot.** On first start Audiobookshelf creates its SQLite database and directory layout under `CONFIG_PATH`/`METADATA_PATH` — no init job, migration job, or database provisioning is involved. Because both paths sit under the persistent `/data` mount, the database survives revision rollouts, version upgrades, and scale events.
- **First-run setup wizard.** Open the service URL (`/`) — Audiobookshelf prompts you to create the initial **root** user interactively. There is no environment-based admin bootstrap; API tokens are minted in the web UI afterwards.
- **Single writer.** SQLite over a shared FUSE mount tolerates exactly one writer. The module pins `min_instance_count = 1` / `max_instance_count = 1`; running replicas against the same `/data` risks database corruption.
- **Health endpoint.** `/healthcheck` returns HTTP 200 unauthenticated once the server is ready; it backs the startup probe (15 s initial delay, up to ~115 s of grace), the liveness probe, and the optional uptime check. The web UI is at `/`.
- **GCS FUSE latency caveat.** A media server ideally wants block storage for its SQLite database and library scans. GCS FUSE is fine for light-to-moderate use; for large or production libraries prefer `Audiobookshelf_GKE`, which mounts a real block PVC at `/data`.
- **Verification CLI:**
  ```bash
  SERVICE=$(gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~audiobookshelf" --format="value(metadata.name)" --limit=1)
  URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
    --format="value(status.url)")
  curl -s -o /dev/null -w "%{http_code}\n" "$URL/healthcheck"   # expect 200 (ingress "all")
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for Audiobookshelf are listed; every other input is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

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

All other inputs follow standard App_CloudRun behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `audiobookshelf` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Image tag; `latest` builds the pinned `2.17.0`. Change to trigger a new build and rollout. |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | CPU per instance. Library scans and embedded-metadata work are CPU-bound — size up for large imports. |
| `memory_limit` | `1Gi` | Memory per instance; size up for large libraries. |
| `min_instance_count` | `1` | Keeps one instance warm; the SQLite state is on GCS so `0` is data-safe but adds cold starts. |
| `max_instance_count` | `1` | **Keep at 1** — one SQLite library, one writer. |
| `container_port` | `80` | Audiobookshelf's HTTP port (`PORT=80` is injected to match). |
| `execution_environment` | `gen2` | Required for the GCS FUSE `/data` mount. |
| `enable_cloudsql_volume` | `false` | No Cloud SQL — keep `false`. |
| `enable_image_mirroring` | `true` | Mirror the upstream image into Artifact Registry. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `internal` | VPC-only by default. Set `all` (or use the load balancer) to reach the web UI and mobile apps from the internet. |
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Merged over the module defaults `PORT=80`, `CONFIG_PATH=/data/config`, `METADATA_PATH=/data/metadata`. Do not change the two paths after first boot. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (none required by Audiobookshelf). |

All other inputs follow standard App_CloudRun behaviour.

### Group 7 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | off / `gcs` / `""` / `tar` | Restore from a backup on deploy. |

All other inputs follow standard App_CloudRun behaviour.

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see [App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Group 9 — Custom SQL

`enable_custom_sql_scripts` and companions are **not applicable** — Audiobookshelf has no SQL database. Leave at their defaults.

### Group 10 — Domain, CDN, Cloud Armor & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` / `application_domains` / `enable_cdn` | off / `[]` / `false` | External HTTPS load balancer with WAF, custom domain, and CDN — the recommended way to expose Audiobookshelf publicly. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Artifact Registry cleanup policy. |

All other inputs follow standard App_CloudRun behaviour.

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | The `/data` `storage` bucket is provisioned automatically — leave enabled. |
| `gcs_volumes` | `[]` | Additional GCS FUSE mounts, e.g. a read-only media library bucket. The `storage` bucket at `/data` is always added. |
| `enable_nfs` | `false` | Optional Filestore mount; not needed for the default layout. |

All other inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

`database_type` is fixed to `NONE` by `Audiobookshelf_Common`; the remaining database inputs (`database_password_length`, rotation settings, `db_*_env_var_name`) are forwarded for foundation compatibility only and have no effect.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No default init job — Audiobookshelf self-initialises. Supply jobs only for custom one-off tasks. |
| `cron_jobs` | `[]` | Recurring jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthcheck`, 15 s initial delay, 10 failures | Allows ~115 s of first-boot grace. |
| `liveness_probe` | HTTP `/healthcheck`, 30 s initial delay, 3 failures | Restarts a hung instance. |
| `uptime_check_config` | disabled, path `/healthcheck` | Enable only when the endpoint is publicly reachable. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 23 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires org-level permissions). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `audiobookshelf_url` | URL of the web UI / API. Only reachable inside the VPC while `ingress_settings = "internal"`. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (includes the `/data` `storage` bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any custom setup jobs. |
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

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | Multiple instances write the same SQLite database over the shared FUSE mount — database corruption. |
| `create_cloud_storage` / the `storage` bucket | keep provisioned | Critical | `/data` holds *all* state (SQLite DB, config, metadata). Deleting the bucket loses the entire library configuration. |
| `CONFIG_PATH` / `METADATA_PATH` overrides | leave defaults | Critical | Changing them after first boot orphans the existing SQLite database and cached metadata. |
| `container_port` | `80` | Critical | Audiobookshelf listens on 80 (`PORT=80` injected); a mismatch fails every health probe. |
| `execution_environment` | `gen2` | High | GCS FUSE mounts require gen2; gen1 cannot mount the `/data` bucket. |
| `enable_backup_import` | `false` unless restoring | High | Enabling without a valid `backup_uri` fails the import job. |
| `ingress_settings` | `internal` (default) / `all` when needed | Medium | Left `internal`, the web UI and mobile apps get no external access (requests return 404); set `all` or add the load balancer. |
| `application_version` | pinned tag | Medium | `latest` silently resolves to the pinned `2.17.0`; pin explicitly to control upgrades. |
| `min_instance_count` | `1` | Medium | `0` saves cost (state is on GCS, so it is data-safe) but adds a cold start to the first stream after idle. |
| Library size on GCS FUSE | small/medium libraries | Medium | Large libraries and frequent scans suffer FUSE latency — use `Audiobookshelf_GKE` (block PVC) for production-scale libraries. |
| `enable_cloudsql_volume` | `false` | Low | No Cloud SQL exists; enabling wastes a sidecar. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. Audiobookshelf-specific application configuration shared with the GKE variant is described in **[Audiobookshelf_Common](Audiobookshelf_Common.md)**.
