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

## What DokuWiki costs on RAD, and how that compares

**DokuWiki on RAD's Cloud Run module costs about US$16.78 a month.** A self-managed server is cheaper in cash, but then you run the OS, security patches and upgrades yourself. GKE Autopilot suits DokuWiki that must stay up continuously or scale across pods; for the lowest cost, this Cloud Run module already gives you the cheaper option — see the [GKE guide](DokuWiki_GKE.md) if you need the other one. Figures are as at 8 October 2026; sources are listed at the end of this section.

If you only need it occasionally — studying, a demo, a seasonal business — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that US$16.78 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 40 credits (US$4 at the top-up price) | 36 credits (10% lower) |
| Build time | A few credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$16.78 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **3 credits a day**, about 90 a month (about US$9 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 0.5 GiB (scaleToZero) | US$10.78 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$16.78** |

### How it compares

- DokuWiki has no official commercial cloud edition to compare against — there is no vendor selling "DokuWiki hosting" the way Odoo or Documenso sell their own. The honest comparison is a bare VPS: even the smallest, cheapest tier from Hetzner or DigitalOcean comfortably runs a flat-file wiki with no database, well under the ~US$24/month 2 vCPU class those providers quote for a heavier app.
- What you are paying RAD for here is less about raw compute — DokuWiki is already nearly free to run — and more about not maintaining the OS, TLS certificate, and GCS-backed storage yourself.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If DokuWiki runs in **a project RAD manages for you**, you have a second option that goes well
beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to
nothing.** This suits DokuWiki you only need occasionally — studying, a demo, a seasonal
business — far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google
  to delete the project. Google does not remove the project immediately: it keeps it, recoverable,
  for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike
  deleting one module, this does not tear down Cloud Run or its storage bucket one by one — the whole project,
  and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's owner
  can restore it. RAD asks Google to undelete the project and reattaches its billing account,
  then asks you to run **Update** on each deployment to confirm everything came back. Because
  nothing was individually destroyed, that Update finds the same resources already there — it
  is a check, not a rebuild, and an Update never charges the module fee again. That costs **a
  handful of credits (under US$1)** in total for a typical DokuWiki-sized deployment chain, against
  the 40 credits (US$4.05) a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$16.78.** Deploy DokuWiki, use it
  for a while, delete the project. Restore it next time you want it, confirm with Update, and
  delete it again when you're done. You pay only for the module fee once, the builds, and
  whatever hours DokuWiki was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages
  billing for), and you restore it yourself within the 30 days — after that, Google deletes it
  for good. Restoring is admitted like creating a new project: your purchased credit balance
  must still clear the tier's floor (100 credits for the sandbox tier most study and demo use
  fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap, and it matters more here than for a database-backed app.** DokuWiki has no
  separate database to fall back on — the storage bucket holding your pages and media is the
  only copy. It is **not** protected by Cloud Storage's soft-delete, so it is very likely gone
  as soon as you delete the project, even though the project itself is recoverable for 30 days.
  Copy the bucket's contents out before deleting if your wiki holds anything you have not
  copied elsewhere.


### Pay only while you use it, the other way: delete and redeploy

Cloud Run already scales to zero between requests. The option above only applies to a RAD-managed project; **in your own project, or
once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy
it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 44 credits
  (US$4.45), and about an hour, because RAD recreates the project and shared services before DokuWiki. Deleting saves money once DokuWiki would otherwise sit unused
  for about **8 days or more** in your own project (about US$0.56 a day), or about
  **14 days or more** in a RAD-managed one (3 credits a day).
- **Delete everything DokuWiki uses.** DokuWiki has no separate database or VM — its only running cost is its own compute and a little networking — so deleting it stops essentially all of its own cost right away.
- **Keep your data first.** DokuWiki keeps its entire wiki — pages, media, plugins and configuration — in that one storage bucket, and the bucket is deleted with the deployment. Copy its contents out (to Google Drive, or a bucket you keep) before deleting if you want to keep your wiki.
- **Note your settings.** RAD does not recreate a deleted deployment for you; you enter the
  settings again when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  DokuWiki in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs DokuWiki for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API;
RAD's own fees and daily-credit estimates from [radmodules.dev/pricing](https://radmodules.dev/pricing);
[Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
for the pause/restore mechanics and window.


## 1. Overview

DokuWiki runs as a PHP/Apache container on Cloud Run v2. The deployment wires
together a deliberately small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | PHP/Apache service on port 8080, 1 vCPU / 512 MiB by default; scale-to-zero supported |
| Database | **None** | DokuWiki is a flat-file wiki — `database_type = "NONE"`, no Cloud SQL provisioned |
| Persistent storage | Cloud Storage (gcsfuse) | A `gcs-dokuwiki<tenant-prefix>-data` bucket mounted at `/storage` holds *all* wiki state |
| Cache & queue | **None** | No Redis; DokuWiki has no queue/worker model |
| Secrets | **None** | No runtime secrets — the admin account is created via `/install.php` |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No database.** DokuWiki stores everything in the `/storage` flat-file directory.
  `database_type` is fixed to `"NONE"`; a plan-time validation guard rejects any
  other value (it would provision an unused Cloud SQL instance and incur cost).
- **All state lives in one Cloud Storage bucket.** `/storage` is a **gcsfuse** mount
  of the auto-provisioned `gcs-dokuwiki<tenant-prefix>-data` bucket. Deleting or repointing that bucket
  loses the entire wiki. `force_destroy` is enabled, so a module destroy removes it.
- **Persistence caveat on gcsfuse.** DokuWiki relies on file locking for concurrent
  edits; gcsfuse is eventually-consistent object storage, not a POSIX filesystem.
  This is fine for a low-concurrency wiki, but heavy simultaneous editing is better
  served by the [GKE variant](DokuWiki_GKE.md), which uses a block PVC.
- **Scale-to-zero is always in effect** (`min_instance_count` is hardcoded to `0` in
  `dokuwiki.tf`, regardless of the variable's value). Cold starts add a few seconds to the
  first request after idle. `max_instance_count` defaults to `1` and must stay there:
  DokuWiki's edit safety depends on `.lock` files, which the shared GCS FUSE bucket cannot
  honour, so a second instance would race page writes. Scale vertically instead.
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

A single **Cloud Storage** bucket (`gcs-dokuwiki<tenant-prefix>-data`) is provisioned automatically and
mounted at `/storage` inside the container via **gcsfuse**. This bucket holds *all*
DokuWiki state: pages, media, plugins, users, ACLs, and configuration.

- **Console:** Cloud Storage → Buckets → the `gcs-dokuwiki<tenant-prefix>-data` bucket.
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
- **All state is on `/storage`.** Losing or repointing the `gcs-dokuwiki<tenant-prefix>-data` bucket
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
| `min_instance_count` | `0` | Hardcoded to `0` in `dokuwiki.tf` regardless of this variable's value — DokuWiki always scales to zero. |
| `max_instance_count` | `1` | Cost ceiling. Keep modest — concurrent writers across instances race on the shared gcsfuse files. |
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
| `create_cloud_storage` | `true` | Create the `gcs-dokuwiki<tenant-prefix>-data` bucket backing `/storage`. |
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
| `storage_buckets` | Created Cloud Storage buckets (includes `gcs-dokuwiki<tenant-prefix>-data`). |
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
| `gcs-dokuwiki<tenant-prefix>-data` bucket | Never delete/repoint after first deploy | Critical | The bucket *is* the wiki — deleting or repointing it loses all pages, media, and users. `force_destroy = true` means a module destroy removes it; back it up first. |
| `database_type` | `NONE` | Critical | Any other value fails the plan-time guard; if bypassed it provisions an unused Cloud SQL instance and cost. |
| `install.php` after setup | Remove / block once admin exists | High | Anyone who reaches `/install.php` before you finish setup can claim the admin account. |
| `execution_environment` | `gen2` | High | `gen1` cannot mount the gcsfuse `/storage` volume — the container has nowhere to persist wiki data. |
| `max_instance_count` | Keep at `1` (the default) | High | Every instance mounts the same GCS FUSE bucket, which cannot provide the locking DokuWiki's `.lock` files assume — concurrent instances race page writes. Scale with `cpu_limit` / `memory_limit` instead. |
| `ingress_settings` | `all` (or IAP) | High | Left public with sign-up/ACLs misconfigured, anyone can edit; lock down via ACLs in the wiki and/or IAP. |
| `memory_limit` | `512Mi` | Medium | Below 256 MiB the PHP/Apache process can OOM under load. |
| `min_instance_count` | N/A — hardcoded to `0` | Low | `dokuwiki.tf` always forces `min_instance_count = 0`; setting this variable to `1` has no effect. Scale-to-zero adds a few seconds of cold-start latency on the first request after idle. |
| `application_version` | Pin a dated release | Low | `latest` resolves to a pinned tag at build time, but pinning explicitly makes upgrades deliberate. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. DokuWiki-specific application configuration
shared with the GKE variant is described in **[DokuWiki_Common](DokuWiki_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: DokuWiki on Cloud Run](../labs/DokuWiki_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [DokuWiki on GKE Autopilot](DokuWiki_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [DokuWiki Common — Shared Application Configuration](DokuWiki_Common.md) — the configuration shared by both deployment targets.
