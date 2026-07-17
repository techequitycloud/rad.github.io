---
title: "DokuWiki on Google Cloud Run"
description: "Configuration reference for deploying DokuWiki on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# DokuWiki on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/DokuWiki_CloudRun.png" alt="DokuWiki on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

DokuWiki is a lightweight, standards-compliant, **flat-file wiki** (no database) that
stores all of its content — pages, media, plugins, users, and configuration — as
files on disk. This module deploys DokuWiki on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services DokuWiki uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

DokuWiki runs as a PHP/Apache container on Cloud Run v2. The deployment wires
together a deliberately small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | PHP/Apache service on port 8080, 1 vCPU / 512 MiB by default; scale-to-zero supported |
| Database | **None** | DokuWiki is a flat-file wiki — `database_type = "NONE"`, no Cloud SQL provisioned |
| Persistent storage | Cloud Storage (gcsfuse) | A `dokuwiki-data` bucket mounted at `/storage` holds *all* wiki state |
| Cache & queue | **None** | No Redis; DokuWiki has no queue/worker model |
| Secrets | **None** | No runtime secrets — the admin account is created via `/install.php` |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No database.** DokuWiki stores everything in the `/storage` flat-file directory.
  `database_type` is fixed to `"NONE"`; a plan-time validation guard rejects any
  other value (it would provision an unused Cloud SQL instance and incur cost).
- **All state lives in one Cloud Storage bucket.** `/storage` is a **gcsfuse** mount
  of the auto-provisioned `dokuwiki-data` bucket. Deleting or repointing that bucket
  loses the entire wiki. `force_destroy` is enabled, so a module destroy removes it.
- **Persistence caveat on gcsfuse.** DokuWiki relies on file locking for concurrent
  edits; gcsfuse is eventually-consistent object storage, not a POSIX filesystem.
  This is fine for a low-concurrency wiki, but heavy simultaneous editing is better
  served by the [GKE variant](DokuWiki_GKE.md), which uses a block PVC.
- **Scale-to-zero is always in effect** (`min_instance_count` is hardcoded to `0` in
  `main.tf`, regardless of the variable's value). Cold starts add a few seconds to the
  first request after idle. Because there is no shared lock coordinator, keep
  `max_instance_count` conservative — concurrent writers across instances can race on
  the same gcsfuse-backed files.
- **Request-based billing by default** (`cpu_always_allocated = false`). DokuWiki is a
  pure request/response wiki with no in-process background work, so CPU is billed only
  while serving a request.
- **No runtime secrets.** `secret_environment_variables` is empty by design; the
  administrator account is created interactively on first visit via `/install.php`.
- **Public ingress by default** (`ingress_settings = "all"`) so the wiki is reachable
  at its `run.app` URL. Enable IAP to require Google sign-in in front of it.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the DokuWiki service

DokuWiki runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~dokuwiki"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Database — not used

DokuWiki does **not** use a database. `database_type = "NONE"`, no Cloud SQL instance
is created, and no `db-init` job runs. The plan-time guard in the module rejects any
non-`NONE` `database_type`. If you are looking for where the wiki content lives, it is
the Cloud Storage bucket in §C, not a database.

### C. Cloud Storage — the `/storage` data volume

A single **Cloud Storage** bucket (`dokuwiki-data`) is provisioned automatically and
mounted at `/storage` inside the container via **gcsfuse**. This bucket holds *all*
DokuWiki state: pages, media, plugins, users, ACLs, and configuration.

- **Console:** Cloud Storage → Buckets → the `dokuwiki-data` bucket.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~dokuwiki"
  gcloud storage ls gs://<data-bucket>/                 # bucket name is in the Outputs
  gcloud storage ls -r gs://<data-bucket>/data/pages/   # browse wiki page files
  ```

The gcsfuse mount options (`implicit-dirs`, 60s stat/type cache TTLs) are set by
`DokuWiki_Common`. See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Redis — not used

DokuWiki has no queue or worker model and does not use Redis. `enable_redis` is off by
default and there is no reason to enable it.

### E. Secret Manager — no application secrets

DokuWiki injects **no** runtime secrets. The administrator account is created via the
first-run installer (`/install.php`) and persisted in `/storage`, so there is no
`AP_*`-style generated key to retrieve. `secret_environment_variables` remains empty
by design. (The foundation may still create infrastructure-level secrets; see
[App_CloudRun](App_CloudRun.md).)

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~dokuwiki"
  ```

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress
settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs (Apache access/error logs) flow to Cloud Logging; Cloud Run metrics
flow to Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. DokuWiki Application Behaviour

- **No database, no init job.** There is no schema to create and no `db-init` job.
  `initialization_jobs` is empty. First boot simply seeds the `/storage` volume with
  the default wiki (handled by the upstream image entrypoint) if it is empty.
- **First-run setup via `/install.php`.** On the first visit, open
  `https://<service-url>/install.php` to create the administrator account, set the
  wiki title, and choose the ACL policy. This is written into `/storage`. **Remove or
  block `install.php` afterwards** — anyone reaching it before you complete setup can
  claim the admin account.
- **All state is on `/storage`.** Losing or repointing the `dokuwiki-data` bucket
  loses the wiki. Because the bucket is `force_destroy = true`, a module destroy
  deletes it — back up the bucket before tearing down if you need to keep content.
- **No auto-migrations.** Upgrading `application_version` ships a newer DokuWiki
  engine that reads the same `/storage` data directory; there is no migration step.
- **Health path.** Startup, liveness, and readiness probes all target `/` — DokuWiki
  serves its start page there without authentication, so the probe passes as soon as
  Apache is up. First boot completes in seconds (no DB migrations).
- **Concurrency.** DokuWiki uses file locks for concurrent edits. On gcsfuse this is
  eventually-consistent, so keep instance counts modest and avoid heavy simultaneous
  editing; use the [GKE variant](DokuWiki_GKE.md) (block PVC) for higher write
  concurrency.
- **Inspect the running revision's mounts and env:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='yaml(spec.template.spec.containers[0].volumeMounts, spec.template.spec.volumes)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for DokuWiki are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `dokuwiki` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | DokuWiki image tag; `latest` resolves to a pinned dated release (`2024-02-06b`) at build time. Pin a specific release for production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. Gen2 with always-on CPU requires ≥ 1 vCPU; DokuWiki is lightweight. |
| `memory_limit` | `512Mi` | Memory per instance; DokuWiki needs ≥ 256 MiB, 512 MiB recommended. |
| `min_instance_count` | `0` | Hardcoded to `0` in `main.tf` regardless of this variable's value — DokuWiki always scales to zero. |
| `max_instance_count` | `3` | Cost ceiling. Keep modest — concurrent writers across instances race on the shared gcsfuse files. |
| `cpu_always_allocated` | `false` | Request-based billing — DokuWiki does no in-process background work. |
| `execution_environment` | `gen2` | Gen2 required for gcsfuse volume mounts. |
| `container_port` | `8080` | Apache listens on 8080. |
| `enable_cloudsql_volume` | `false` | No database — leave false. |
| `enable_image_mirroring` | `true` | Mirror the DokuWiki image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` exposes the wiki publicly at its `run.app` URL. |
| `enable_iap` | `false` | Require Google sign-in in front of DokuWiki. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the `dokuwiki-data` bucket backing `/storage`. |
| `gcs_volumes` | _(default set by Common)_ | The `/storage` gcsfuse mount. Leave as-is unless supplying a custom volume. |
| `enable_nfs` | `false` | DokuWiki is stateless-at-the-container-level; NFS not required. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | **Must remain `NONE`.** A plan-time guard rejects any other value. |

_All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour._

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (includes `dokuwiki-data`). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Setup job names (empty — DokuWiki has none). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, a `gen1` runtime with GCS Fuse mounts, an out-of-range `backup_retention_days`, and (module-specific) a non-`NONE` `database_type`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `dokuwiki-data` bucket | Never delete/repoint after first deploy | Critical | The bucket *is* the wiki — deleting or repointing it loses all pages, media, and users. `force_destroy = true` means a module destroy removes it; back it up first. |
| `database_type` | `NONE` | Critical | Any other value fails the plan-time guard; if bypassed it provisions an unused Cloud SQL instance and cost. |
| `install.php` after setup | Remove / block once admin exists | High | Anyone who reaches `/install.php` before you finish setup can claim the admin account. |
| `execution_environment` | `gen2` | High | `gen1` cannot mount the gcsfuse `/storage` volume — the container has nowhere to persist wiki data. |
| `max_instance_count` | Keep modest (e.g. `3`) | High | High concurrency across instances races on the same gcsfuse-backed files; DokuWiki's file locks are only eventually consistent on object storage. |
| `ingress_settings` | `all` (or IAP) | High | Left public with sign-up/ACLs misconfigured, anyone can edit; lock down via ACLs in the wiki and/or IAP. |
| `memory_limit` | `512Mi` | Medium | Below 256 MiB the PHP/Apache process can OOM under load. |
| `min_instance_count` | N/A — hardcoded to `0` | Low | `main.tf` always forces `min_instance_count = 0`; setting this variable to `1` has no effect. Scale-to-zero adds a few seconds of cold-start latency on the first request after idle. |
| `application_version` | Pin a dated release | Low | `latest` resolves to a pinned tag at build time, but pinning explicitly makes upgrades deliberate. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. DokuWiki-specific application configuration
shared with the GKE variant is described in **[DokuWiki_Common](DokuWiki_Common.md)**.
