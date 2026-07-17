---
title: "Uptime Kuma on Google Cloud Run"
description: "Configuration reference for deploying Uptime Kuma on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Uptime Kuma on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/UptimeKuma_CloudRun.png" alt="Uptime Kuma on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Uptime Kuma is a fancy, self-hosted monitoring tool for tracking the uptime of websites, APIs, TCP ports, DNS records, and more, with a clean dashboard, status pages, and 90+ notification channels. This module deploys Uptime Kuma on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Uptime Kuma uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run application — service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Uptime Kuma runs as a Node.js container on Cloud Run v2. It is one of the simplest modules in the catalogue — there is no external database, no cache, and no application secret. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 1 vCPU / 512 MiB by default, **CPU always allocated** |
| Persistent state | Filestore (NFS) | Embedded SQLite database and uploads under `/app/data` (gen2 required) |
| Container image | Artifact Registry | The official `louislam/uptime-kuma` image is mirrored in (prebuilt, no Cloud Build) |
| Database | — | None — Uptime Kuma v1 uses embedded SQLite; `database_type = "NONE"` |
| Cache | — | None — Redis is not required (`enable_redis = false`) |
| Secrets | Secret Manager | No application secrets (`secret_ids = {}`); admin credentials live in SQLite |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **`cpu_always_allocated = true` is the default and is deliberate — the monitoring loop IS the product.** Uptime Kuma polls its monitors from an in-process scheduler with **no inbound request**. Under Cloud Run's request-based billing the CPU is throttled to near-zero between requests, so checks would stall or fire late. Instance-based (always-allocated) CPU keeps the scheduler running at full speed while an instance is alive. Do not set this to `false`.
- **`min_instance_count` defaults to `0`** — the service can scale to zero when nothing keeps an instance alive, and **monitoring pauses while it is scaled to zero**. For genuine 24/7 monitoring, set `min_instance_count = 1` (a single always-on instance).
- **No external database.** `database_type = "NONE"`, `enable_cloudsql_volume = false`, and there is no `db-init` job. Uptime Kuma creates its embedded SQLite schema automatically on first boot.
- **NFS persistence is mandatory.** `enable_nfs = true` with `nfs_mount_path = "/app/data"` mounts a Filestore (NFS) volume holding the SQLite database and uploads, so monitors and history survive restarts and revisions. Requires the gen2 execution environment.
- **Single-writer SQLite.** SQLite over NFS relies on file locking; run a **single instance** in production (`max_instance_count = 1`). The module default is `max_instance_count = 3` for burst headroom on the dashboard — lower it for production.
- **Prebuilt image.** `container_image_source = "prebuilt"` deploys the official `louislam/uptime-kuma:1` image directly; `enable_image_mirroring = true` copies it into Artifact Registry to avoid Docker Hub rate limits.
- **No application secrets** — there is nothing to inject from Secret Manager. The admin account is created interactively on first access.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Uptime Kuma service

Uptime Kuma runs as a Cloud Run v2 service with CPU always allocated so its background check scheduler keeps polling between requests. Each deployment creates an immutable revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and traffic splitting.

### B. Filestore (NFS) — the persistent data volume

All Uptime Kuma state — the embedded SQLite database, monitor history, uploads, and settings (including the admin user) — lives under `/app/data`, which the module mounts from a **Filestore (NFS)** share. Without it, everything is lost on restart. The gen2 execution environment is required for NFS mounts.

- **Console:** Filestore → Instances.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format="yaml(spec.template.spec.volumes)"
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS mount model and CMEK.

### C. Artifact Registry — the mirrored image

With `enable_image_mirroring = true` (the default) the official `louislam/uptime-kuma` image is copied into the project's Artifact Registry before deployment, insulating deploys from Docker Hub rate limits and outages. There is no Cloud Build step — the image is prebuilt upstream.

- **Console:** Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo>
  ```

### D. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and VPC egress control connectivity. Note that Uptime Kuma also makes **outbound** connections — every monitor check is an egress call from the container.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring, with optional uptime checks and alert policies. Yes — you can point a Google Cloud uptime check at your Uptime Kuma instance to monitor the monitor.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Uptime Kuma Application Behaviour

- **No initialization jobs.** Uptime Kuma creates its embedded SQLite schema automatically on first boot; there is no `db-init` or migration job, and `initialization_jobs` defaults to `[]`.
- **First-run setup.** On first access, Uptime Kuma presents a setup page asking you to create the admin account — there are no default credentials baked into the image. The account is stored in SQLite on the NFS volume, so it persists across revisions.
- **The check scheduler runs in-process.** Monitor polling, retries, and notification dispatch all run inside the Node.js process, driven by timers — not by inbound HTTP requests. This is why `cpu_always_allocated = true` is the default and why continuous monitoring additionally requires an instance to be running (`min_instance_count = 1`).
- **Scale-to-zero pauses monitoring.** With the default `min_instance_count = 0`, Cloud Run stops the last instance when it goes idle. While scaled to zero, no checks execute and no alerts fire; polling resumes when the next request (e.g. opening the dashboard) cold-starts an instance. This is safe for casual/lab use but wrong for production monitoring.
- **Single-writer SQLite.** SQLite is a single-writer database. Multiple concurrent instances writing the same SQLite file over NFS risk lock contention or corruption — keep `max_instance_count = 1` in production.
- **Health path.** Startup and liveness probes target `/` on port `3001`, which returns HTTP 200 once the app is up. The startup probe allows up to 30 s initial delay plus 30 failures at 10 s intervals.
- **Verification:**
  ```bash
  SERVICE=$(gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~uptimekuma" --format="value(metadata.name)" --limit=1)
  SERVICE_URL=$(gcloud run services describe "$SERVICE" \
    --project "$PROJECT" --region "$REGION" --format="value(status.url)")
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for Uptime Kuma are listed; every other input is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

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
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |

All other inputs follow standard App_CloudRun behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `uptimekuma` | Base name for resources. Do not change after first deploy. |
| `application_version` | `1` | Uptime Kuma image tag — the v1 stable line (embedded SQLite). |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Deploys the official image directly — no Cloud Build. |
| `container_image` | `louislam/uptime-kuma` | Official upstream image, mirrored into Artifact Registry. |
| `enable_image_mirroring` | `true` | Copy the image into Artifact Registry to avoid Docker Hub rate limits. |
| `cpu_limit` / `memory_limit` | `1000m` / `512Mi` | Ample for dozens of monitors; raise memory for very large monitor counts. |
| `min_instance_count` | `0` | **Set to `1` for 24/7 monitoring** — while scaled to zero, no checks run. |
| `max_instance_count` | `3` | **Set to `1` for production** — SQLite is single-writer (see Pitfalls). |
| `cpu_always_allocated` | `true` | **Keep `true`.** The in-process check scheduler needs CPU between requests; request-based billing throttles it to ~0 and checks stall. |
| `container_port` | `3001` | Uptime Kuma's native port. |
| `execution_environment` | `gen2` | Required for the NFS mount. |
| `enable_cloudsql_volume` | `false` | Unused — no external database. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public status pages need public ingress; use IAP/`internal` for private dashboards. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Routes private-range traffic through the VPC (needed to monitor internal targets). Set `ALL_TRAFFIC` to route all monitor probes through the VPC (e.g. for a stable NAT egress IP or if public probes fail). |
| `enable_iap` | `false` | Put the dashboard behind Google identity if it should not be public. |

All other inputs follow standard App_CloudRun behaviour.

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | **Required.** Provisions the Filestore share holding all Uptime Kuma state. |
| `nfs_mount_path` | `/app/data` | **Must remain `/app/data`** — Uptime Kuma's writable data directory. |
| `storage_buckets` / `gcs_volumes` | `[]` | Not needed — no GCS storage is used. |

All other inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | **Fixed by design** — Uptime Kuma v1 uses embedded SQLite; no Cloud SQL is provisioned. |
| `application_database_name` / `application_database_user` | `uptimekuma` | Declared for convention mirroring; unused. |

All other inputs follow standard App_CloudRun behaviour.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | None needed — the SQLite schema is created on first boot. |
| `cron_jobs` | `[]` | Recurring Cloud Run jobs triggered by Cloud Scheduler. |

All other inputs follow standard App_CloudRun behaviour.

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 30 s delay, 30 failures | Passed through `UptimeKuma_Common`. |
| `liveness_probe` | HTTP `/`, 30 s delay, 3 failures | Passed through `UptimeKuma_Common`. |
| `uptime_check_config` | `enabled = false` | Optional Cloud Monitoring uptime check against `/` — monitoring for the monitor. |

All other inputs follow standard App_CloudRun behaviour.

### Group 16 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Uptime Kuma does not use Redis; leave disabled. |

All other inputs follow standard App_CloudRun behaviour.

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs follow standard App_CloudRun behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` / `database_host` / `database_port` | Empty/unset — no Cloud SQL is provisioned (`database_type = "NONE"`). |
| `storage_buckets` | Created Cloud Storage buckets (none by default). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of setup jobs (empty by default). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` / `artifact_registry_repository` | CI/CD status, build trigger, and registry details. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `cpu_always_allocated` | `true` (default) | Critical | Request-based billing throttles CPU to ~0 between requests — the in-process check scheduler stalls, checks fire late or not at all, and alerts are missed. The monitoring loop IS the product. |
| `enable_nfs` | `true` (default) | Critical | Without the NFS volume, the SQLite database (monitors, history, admin account) lives on ephemeral disk and is wiped on every restart or new revision. |
| `nfs_mount_path` | `/app/data` (default) | Critical | Any other path leaves Uptime Kuma writing to ephemeral storage — silent total data loss on restart. |
| `min_instance_count` | `1` for production monitoring | Critical | With the default `0`, the service scales to zero when idle and **no checks run while it is down** — outages in monitored systems go unnoticed. |
| `max_instance_count` | `1` for production | High | SQLite is single-writer; multiple instances writing over NFS risk lock contention or database corruption. |
| `container_port` | `3001` (default) | Critical | Mismatching Uptime Kuma's native port fails all health probes and the revision never becomes ready. |
| `database_type` | `NONE` (default) | High | Provisioning Cloud SQL wastes money — Uptime Kuma v1 cannot use it. |
| `execution_environment` | `gen2` (default) | High | NFS mounts require gen2; gen1 cannot mount Filestore. |
| `vpc_egress_setting` | per target scope | Medium | `PRIVATE_RANGES_ONLY` routes only private-range probes through the VPC; set `ALL_TRAFFIC` if monitor probes to external targets need VPC/NAT egress. |
| `enable_iap` / `ingress_settings` | IAP or `internal` for private dashboards | Medium | The dashboard (and setup page, on first deploy) is otherwise publicly reachable at the `run.app` URL. Complete first-run admin setup immediately after deploy. |
| `enable_image_mirroring` | `true` (default) | Low | Direct pulls from Docker Hub can hit rate limits and break deploys. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. Uptime Kuma-specific application configuration shared with the GKE variant is described in **[UptimeKuma_Common](UptimeKuma_Common.md)**.
