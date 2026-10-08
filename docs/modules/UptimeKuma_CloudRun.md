---
title: "Uptime Kuma on Google Cloud Run"
description: "Configuration reference for deploying Uptime Kuma on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Uptime Kuma on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/UptimeKuma_CloudRun.png" alt="Uptime Kuma on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Uptime Kuma is a fancy, self-hosted monitoring tool for tracking the uptime of websites, APIs, TCP ports, DNS records, and more, with a clean dashboard, status pages, and 90+ notification channels. This module deploys Uptime Kuma on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Uptime Kuma uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run application — service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Uptime Kuma costs on RAD, and how that compares

**Running Uptime Kuma on Cloud Run in your own Google Cloud project costs about US$64.16/month in Google Cloud charges**, on top of a one-off 40-credit RAD module fee (US$4) charged once at deploy time. Uptime Kuma keeps all of its own state in an embedded SQLite database on a shared NFS volume, so it needs no managed database — but it runs `alwaysOn` by default (uptime monitors have to keep checking even with nobody watching the dashboard), which is most of its running cost. In a RAD-managed project the module fee drops to 36 credits (10% lower) — see [Pause it for free](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) below — or see the [GKE guide](UptimeKuma_GKE.md) if you'd rather run it on Kubernetes.

### What you pay on RAD

| | Own project | RAD-managed project |
|---|---|---|
| Module fee (one-off) | 40 credits | 36 credits (10% lower) |
| Build time | ~3-6 credits per build, either way | ~3-6 credits per build, either way |
| Google Cloud running cost | US$64.16/month, billed by Google at list price | ~31 credits/day (about 930/month, US$93 at the top-up price), metered at list price plus RAD's margin |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan.

**Default running cost in your own project**

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 0.5 GiB (alwaysOn) | US$44.72 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **US$64.16** |


### How it compares

- Uptime Kuma has no official hosted cloud version — it is distributed only as self-hosted software, so there is no vendor SaaS plan to compare against for this exact project.
- A self-managed VPS comparison, sized to Uptime Kuma's 1 vCPU / 0.5 GiB default: a Hetzner CPX11 or DigitalOcean 1 vCPU/2GB Droplet runs about $6-12/month, cheaper in cash terms than either RAD option here — plus your own time for backups, OS patching and TLS renewal, which RAD's managed Secret Manager and monitoring cover for you.
- Because Uptime Kuma needs no managed database, almost all of its running cost here is the always-on compute itself, which is also what makes it a good candidate to pause when a monitored environment is itself only used occasionally (see below).

### Pause it for free: delete a RAD-managed project, restore it when you need it

This is the headline advantage of a RAD-managed project, and it costs nothing while paused.
Deleting a RAD-managed project unlinks its billing first, then asks Google to delete the
project outright — Google's own 30-day recoverable soft delete. Unlike deleting one module,
this does **not** tear down Cloud SQL, any VM, or the compute resource one by one: the whole
project simply stops, and nothing is charged while it waits, because billing is already
unlinked.

Restoring, within 30 days and only by the project's owner, asks Google to undelete the
project and reattaches its billing account, then asks you to run Update on each deployment to
confirm everything came back. Because nothing was individually destroyed, that Update finds
the same resources already there — it is a check, not a rebuild, and an Update never charges
the module fee again. This costs only a handful of credits (under US$1) in total for a typical
2-3-deployment chain.

What this needs: you must own the project (not one RAD only manages billing for), you must
restore it yourself within 30 days — after that Google deletes it for good — and restoring is
admitted like creating a new project, so your purchased credit balance must still clear the
tier's floor (100 credits for the sandbox tier most study/demo use fits). Google says most
services are fully working again within 36 hours of a restore.

One real gap: nightly backups are written to a bucket inside the project, and that bucket has
Cloud Storage's soft-delete explicitly turned off, so it is very likely gone as soon as you
delete the project — even though the project itself is recoverable for 30 days. If you've
customised Uptime Kuma and want to keep that work, copy a backup out (to Google Drive, or a bucket
outside the project) before deleting. For a default install with nothing irreplaceable in it,
this does not matter.

### Pay only while you use it, the other way: delete and redeploy

In your own project, or once 30 days have passed on a RAD-managed one, there is no free pause —
deleting removes the resources for good, and bringing Uptime Kuma back means redeploying from
scratch. That costs about 43-46 credits in your own project, or about
39-42 credits in a RAD-managed one.

Deleting only saves money once Uptime Kuma would otherwise sit unused long enough to clear that
redeploy cost against its own running cost — about 2 days or more in your own project
(about US$2.14 a day), or about 1 days or more in a RAD-managed one
(31 credits a day).

Keep data first: nightly backups go to a bucket inside the deployment and are deleted with it,
so copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

Lab sessions, for training: a trainer runs a session for a class. Each participant gets the
app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
trainer sets. Either the trainer funds every place, or each participant pays for their own.
Everything is deleted when the session ends and unused credits go back to the trainer.

Managed Environments, for consultancies: a partner runs the app for a client from a
ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; [radmodules.dev/pricing](https://radmodules.dev/pricing) for RAD's own fees and daily-credit estimates; [Google's project delete/restore documentation](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore claims.

## 1. Overview

Uptime Kuma runs as a Node.js container on Cloud Run v2. It is one of the simplest modules in the catalogue — there is no external database, no cache, and no application secret. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 1 vCPU / 512 MiB by default, **CPU always allocated** |
| Persistent state | Filestore (NFS) | Embedded SQLite database and uploads under `/app/data` (gen2 required) |
| Container image | Artifact Registry | Custom Cloud Build (`container_image_source = "custom"`) — a thin layer `FROM louislam/uptime-kuma` that patches the SQLite journal mode for NFS safety (see below) |
| Database | — | None — Uptime Kuma v1 uses embedded SQLite; `database_type = "NONE"` |
| Cache | — | None — Redis is not required (`enable_redis = false`) |
| Secrets | Secret Manager | No application secrets (`secret_ids = {}`); admin credentials live in SQLite |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **`cpu_always_allocated = true` is the default and is deliberate — the monitoring loop IS the product.** Uptime Kuma polls its monitors from an in-process scheduler with **no inbound request**. Under Cloud Run's request-based billing the CPU is throttled to near-zero between requests, so checks would stall or fire late. Instance-based (always-allocated) CPU keeps the scheduler running at full speed while an instance is alive. Do not set this to `false`.
- **`min_instance_count` defaults to `1`, not `0`** — at `0` Cloud Run reaps the instance about 15 minutes after the last request, and **monitoring stops while it is scaled to zero**. `cpu_always_allocated` does not cover this: it governs CPU while an instance is alive, not whether one exists. Keep `1` for genuine 24/7 monitoring.
- **No external database.** `database_type = "NONE"`, `enable_cloudsql_volume = false`, and there is no `db-init` job. Uptime Kuma creates its embedded SQLite schema automatically on first boot.
- **NFS persistence is mandatory.** `enable_nfs = true` with `nfs_mount_path = "/app/data"` mounts a Filestore (NFS) volume holding the SQLite database and uploads, so monitors and history survive restarts and revisions. Requires the gen2 execution environment.
- **Single-writer SQLite.** SQLite over NFS relies on file locking; run a **single instance** in production (`max_instance_count = 1`). The module default is `max_instance_count = 3` for burst headroom on the dashboard — lower it for production.
- **Custom build patches SQLite for NFS safety.** `container_image_source = "custom"` is the default — do not change it to `"prebuilt"`. Uptime Kuma unconditionally sets `PRAGMA journal_mode = WAL` on every boot (hardcoded in `server/database.js`, not configurable via env var); WAL relies on shared-memory byte-range locking between the DB file and its `-wal` sidecar, which the NFS-backed `/app/data` volume does not reliably provide and has produced observed `SQLITE_CORRUPT` errors. The Cloud Build step (`UptimeKuma_Common/scripts/Dockerfile`) source-patches that PRAGMA to `DELETE` mode, which only needs standard whole-file locking that NFS handles correctly. `enable_image_mirroring = true` additionally pushes the built image through Artifact Registry to avoid Docker Hub rate limits.
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

With `container_image_source = "custom"` (the default) a Cloud Build step builds a thin custom image `FROM louislam/uptime-kuma`, applying a source patch that changes the hardcoded SQLite `journal_mode` from `WAL` to `DELETE` — WAL's shared-memory locking is unsafe on the NFS-backed `/app/data` volume (see [Overview](#1-overview)). With `enable_image_mirroring = true` (the default), the built image is then pushed to the project's Artifact Registry, insulating deploys from Docker Hub rate limits and outages.

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
- **Scale-to-zero pauses monitoring.** If you lower `min_instance_count` to `0`, Cloud Run stops the last instance when it goes idle. While scaled to zero, no checks execute and no alerts fire; polling resumes when the next request (e.g. opening the dashboard) cold-starts an instance. This is safe for casual/lab use but wrong for production monitoring.
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
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
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
| `container_image_source` | `custom` | Builds a thin custom image via Cloud Build that patches SQLite's hardcoded `journal_mode` from `WAL` to `DELETE` for NFS safety (see Overview). Keep `custom`. |
| `container_image` | `louislam/uptime-kuma` | Official upstream image, mirrored into Artifact Registry. |
| `enable_image_mirroring` | `true` | Copy the image into Artifact Registry to avoid Docker Hub rate limits. |
| `cpu_limit` / `memory_limit` | `1000m` / `512Mi` | Ample for dozens of monitors; raise memory for very large monitor counts. |
| `min_instance_count` | `1` | **Keep `1` for 24/7 monitoring** — while scaled to zero, no checks run. |
| `max_instance_count` | `1` | **Keep at `1`** — SQLite is single-writer, so a second instance corrupts the database (see Pitfalls). |
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
| `min_instance_count` | `1` (default) | Critical | At `0`, the service scales to zero when idle and **no checks run while it is down** — outages in monitored systems go unnoticed. |
| `max_instance_count` | `1` for production | High | SQLite is single-writer; multiple instances writing over NFS risk lock contention or database corruption. |
| `container_port` | `3001` (default) | Critical | Mismatching Uptime Kuma's native port fails all health probes and the revision never becomes ready. |
| `database_type` | `NONE` (default) | High | Provisioning Cloud SQL wastes money — Uptime Kuma v1 cannot use it. |
| `execution_environment` | `gen2` (default) | High | NFS mounts require gen2; gen1 cannot mount Filestore. |
| `vpc_egress_setting` | per target scope | Medium | `PRIVATE_RANGES_ONLY` routes only private-range probes through the VPC; set `ALL_TRAFFIC` if monitor probes to external targets need VPC/NAT egress. |
| `enable_iap` / `ingress_settings` | IAP or `internal` for private dashboards | Medium | The dashboard (and setup page, on first deploy) is otherwise publicly reachable at the `run.app` URL. Complete first-run admin setup immediately after deploy. |
| `enable_image_mirroring` | `true` (default) | Low | Direct pulls from Docker Hub can hit rate limits and break deploys. |
| `container_image_source` | `custom` (default) | Critical | Setting `"prebuilt"` skips the Cloud Build step and deploys the unpatched upstream image — Uptime Kuma then writes SQLite in WAL mode over NFS, which has produced observed `SQLITE_CORRUPT` database corruption. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. Uptime Kuma-specific application configuration shared with the GKE variant is described in **[UptimeKuma_Common](UptimeKuma_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Uptime Kuma on Cloud Run](../labs/UptimeKuma_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Uptime Kuma on GKE Autopilot](UptimeKuma_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Uptime Kuma Common — Shared Application Configuration](UptimeKuma_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [VictoriaMetrics on GKE Autopilot](VictoriaMetrics_GKE.md), [Loki on Google Cloud Run](Loki_CloudRun.md), [Grafana on Google Cloud Run](Grafana_CloudRun.md), [GlitchTip on Google Cloud Run](GlitchTip_CloudRun.md) in the **Observability & On-call** solution.
