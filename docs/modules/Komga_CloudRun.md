---
title: "Komga on Google Cloud Run"
description: "Configuration reference for deploying Komga on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Komga on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Komga_CloudRun.png" alt="Komga on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Komga is a free, open-source, self-hosted media server for comics, manga, and
digital book collections (Kotlin/Java, Spring Boot). It provides a clean web
reading UI, OPDS feeds, collections, read lists, and full-text search over your
library. This module deploys Komga on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Komga uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common
to every Cloud Run application — service identity, ingress and load balancing,
scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Komga costs on RAD, and how that compares

**Komga on RAD's Cloud Run module costs about US$33 a month in a Google Cloud project you own, plus a one-off 40-credit (US$4.00) module fee.** Komga is free and open source, with no database to run — its catalogue lives in an embedded SQLite file on the shared file server. If you only need it occasionally, a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that US$33 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 40 credits (US$4.00 at the top-up price) | 36.0 credits (10% lower) |
| Build time | A few credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$33 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **15 credits a day**, about 450 a month (about US$45 at the top-up price, US$36 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project
RAD manages, the database, file server and network are shared by every
application in the project, so a second application does not add a second
database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (warm) | US$13.14 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5.00 |
| Cloud Storage (add-ons, backups) | US$1.00 |
| **Total** | **about US$33** |

### How it compares

- **No vendor sells a hosted Komga SaaS** — it is a self-hosted media server by design, so there is no official price to compare against.
- **Komga is light** (1 vCPU/1 GiB, no database), so a smaller/cheaper self-managed box than the usual comparison class often suffices — a small Hetzner or DigitalOcean instance well under the 2 vCPU/4 GB, US$24/month class can run it, plus your own time for the operating system, backups and security patches.
- RAD's figure is higher mainly because of the always-on NAT gateway and file server rather than Komga itself, which is why the gap narrows if this project already runs another app sharing those.
- See the [GKE guide](Komga_GKE.md) if you'd rather run it alongside other Kubernetes workloads.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Komga runs in **a project RAD manages for you**, you have a second option that
goes well beyond scaling to zero: **delete the whole project, and restore it within
30 days for close to nothing.** This suits Komga you only need occasionally — a
course project, a demo, a short-lived evaluation — far better than running it
continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then
  asks Google to delete the project. Google does not remove the project
  immediately: it keeps it, recoverable, for 30 days. Because billing is already
  unlinked, nothing is charged while it waits. Unlike deleting one module, this does
  not tear down any VM or Komga's own compute one by one — the whole
  project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the
  project's owner can restore it. RAD asks Google to undelete the project and
  reattaches its billing account, then asks you to run **Update** on each
  deployment to confirm everything came back. Because nothing was individually
  destroyed, that Update finds the same resources already there — it is a check,
  not a rebuild, and an Update never charges the module fee again. For Komga
  behind a small Services_GCP and Project_GCP, that is **a handful of credits
  (under US$1)** in total, against the 45 credits a full
  redeploy costs.
- **What this needs.** You must own the project (not a bring-your-own one RAD only
  manages billing for), and you restore it yourself within the 30 days — after
  that, Google deletes it for good. Restoring is admitted like creating a new
  project: your purchased credit balance must still clear the tier's floor (100
  credits for the sandbox tier most study and demo use fits). Google says most
  services are fully working again within 36 hours of a restore.
- **One real gap: the backup bucket does not survive.** Komga's nightly backups
  are written to a bucket inside the project, and that bucket is **not** protected
  by Cloud Storage's soft-delete, so it is very likely gone as soon as you delete
  the project — even though the project itself is recoverable for 30 days. If
  you've customised Komga and want to keep that work, copy a backup out (to Google
  Drive, or a bucket outside the project) before you delete, the same as the
  redeploy workflow below. For a default installation with nothing irreplaceable
  in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

This module keeps Cloud Run warm (at least one instance allocated) rather than scaling fully to zero, so some of its cost is already continuous. The option above only applies to a RAD-managed project; **in your
own project, or once the 30-day window has passed, the way to stop paying is to
delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about
  45 credits (US$4.50), because RAD
  recreates the project and shared services before Komga. Deleting saves money
  only once Komga would otherwise sit unused for about five days
  or more, both in your own project (about US$1.09 a day) and in
  a RAD-managed one (15 credits a day).
- **Delete everything Komga uses.** Most of the running cost is usually the shared file/cache VM. It stops only when nothing else in the project uses it, so deleting Komga while something else shares the project saves only Komga's own compute part.
- **Keep your data first.** Nightly backups go to a bucket inside the deployment
  and are deleted with it, so copy the latest backup out before deleting if you
  want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a Komga session for a class. Each
  participant gets Komga in their own Google Cloud project for 15 minutes to 24
  hours, within an allowance the trainer sets. Either the trainer funds every place
  up front, or each participant pays for their own. Everything is deleted when the
  session ends, and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs Komga for a client
  from a ring-fenced wallet it funds, and settles with the client directly. If the
  wallet runs low, billing pauses and the data is kept, so nobody receives an
  unexpected charge. At the end of the engagement the partner hands the project
  over, and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES
and ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog
API; RAD fees and the 15-credit daily estimate from
[radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore
projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for
the 30-day recovery window and what it says about Cloud Storage objects without soft
delete. Prices change; check each source before relying on a figure.

## 1. Overview

Komga runs as a single JVM container on Cloud Run v2. The deployment wires together
a minimal set of Google Cloud services — there is no external database:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | JVM (Spring Boot) container, 1 vCPU / 1 GiB by default; single instance |
| Database | None | Komga uses an embedded SQLite database under `/config` — no Cloud SQL instance is created |
| Shared storage | Filestore (NFS) | Mounted at `/config` (`enable_nfs = true`); holds the SQLite databases and index |
| Object storage | Cloud Storage | A `storage` bucket, mounted at `/config` via GCS FUSE only if NFS is not |
| Secrets | Secret Manager | None generated — Komga has no injectable service secret |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No external database.** Komga stores its library index, users, reading
  progress, and settings in an embedded SQLite database — confirmed via upstream
  issue #1327 (open, unimplemented feature request for external DB support).
  `database_type = "NONE"`.
- **Official prebuilt image.** `container_image_source = "prebuilt"` deploys
  `gotson/komga` directly — no Cloud Build step. `enable_image_mirroring = true`
  mirrors it into Artifact Registry (digest-aware copy) to avoid Docker Hub rate
  limits.
- **Single instance only.** `min_instance_count = 1` and `max_instance_count = 1` —
  Komga serves one shared SQLite library from one volume; do not scale beyond 1.
- **`/config` is the single source of truth.** The SQLite database
  (`database.sqlite`, WAL mode), Lucene search index, thumbnail cache, and task
  queue all live under `/config` (set via the image's `KOMGA_CONFIGDIR`), backed by
  the NFS share on Cloud Run.
- **No generated secrets.** The admin account is created interactively through
  Komga's first-run setup wizard at `/` — there is no master key or JWT secret to
  seed ahead of time.
- **Health endpoint is `/actuator/health`.** Confirmed via local container testing
  to return `200 {"status":"UP"}` unauthenticated. The versioned
  `/api/v1/actuator/health` path is auth-gated (401) — do not point probes at it.
- **JVM heap sizing is optional.** `jvm_heap_max` (blank by default) sets `-Xmx` via
  `JAVA_TOOL_OPTIONS`; leave blank to let JVM ergonomics size the heap relative to
  `memory_limit`.
- **`/config` must not be on GCS FUSE.** gcsfuse lacks the file locking and
  shared-memory file SQLite's WAL mode needs, and both databases are lost there. The
  default keeps `/config` on NFS; Komga's own startup checks refuse a database on any network filesystem (they test the filesystem type, not whether locking works); the module sets `KOMGA_DATABASE_CHECKLOCALFILESYSTEM` and `KOMGA_TASKSDB_CHECKLOCALFILESYSTEM` to `false` only while `/config` is on NFS.
  `Komga_GKE` uses a block PVC instead.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Komga service

Komga runs as a Cloud Run v2 service. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

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

### B. Cloud Storage — Komga's persistent state

By default `/config` is the **Filestore (NFS)** share (`enable_nfs = true`,
`nfs_mount_path = "/config"`). It holds the embedded SQLite databases, Lucene search
index, thumbnail cache, and logs — everything Komga persists. A `storage` bucket is
also created; it is mounted at `/config` via GCS FUSE only if NFS is turned off or
mounted elsewhere, and that configuration does not keep the SQLite databases.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### C. Secret Manager

Komga has no generated service secret — the admin account is created through the
web setup wizard. Secret Manager only holds entries you add yourself via
`secret_environment_variables`.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~komga"
  ```

### D. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Komga Application Behaviour

- **No first-deploy database setup.** There is no `db-init` job — Komga runs its own
  Flyway schema migrations against the embedded SQLite database on first boot
  (confirmed via local container logs: `org.flywaydb.core.FlywayExecutor`,
  `Successfully validated 90 migrations`).
- **First-run setup wizard.** Open the service URL and complete the setup wizard at
  `/` to create the initial admin user — there is no seeded credential and no
  API/CLI path to create one non-interactively.
- **Add a library after first login.** Once logged in, add a "library" pointing at
  a mounted media path (see `gcs_volumes` for additional read-mostly comic/book
  storage) and trigger a scan. This is a manual operator step; no init job seeds it.
- **Health path.** Startup and liveness probes target `/actuator/health`
  (unauthenticated, `200 {"status":"UP"}` once ready). Do **not** use
  `/api/v1/actuator/health` — confirmed via local testing to return `401
  Unauthorized` even when the app is fully healthy.
- **Single shared library, single instance.** Komga's SQLite database is a single
  file on one mounted volume — running more than one instance risks concurrent
  writers corrupting it. Keep `max_instance_count = 1`.
- **JVM heap sizing.** No official memory floor is documented upstream; the module
  defaults `memory_limit = 1Gi` conservatively. For very large libraries (heavy
  Lucene index + thumbnail cache), raise `memory_limit` and optionally set
  `jvm_heap_max` to explicitly bound the JVM's `-Xmx`.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Komga are listed; every other input is
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
| `application_name` | `komga` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Komga` | Human-readable name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `latest` | Image tag, passed straight through as the `gotson/komga` tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Deploys the official `gotson/komga` image directly — no build step. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `1Gi` | Memory per instance; raise for very large libraries. |
| `min_instance_count` | `1` | Keep at `1` to avoid cold starts during the Lucene index rebuild on boot. |
| `max_instance_count` | `1` | **Do not increase** — Komga serves one shared SQLite library. |
| `container_port` | `25600` | Komga's default HTTP port. |
| `execution_environment` | `gen2` | Gen2 required for GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | Komga has no Cloud SQL — keep `false`. |
| `enable_image_mirroring` | `true` | Mirror the Komga image into Artifact Registry. |
| `jvm_heap_max` | `""` | Optional JVM `-Xmx` via `JAVA_TOOL_OPTIONS` (e.g. `"512m"`, `"1g"`). |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Declared for convention parity; not referenced by this module's deployment. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public access to the reading UI. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of Komga's own auth. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Custom SQL Scripts

Not applicable — Komga has no SQL database. `enable_custom_sql_scripts` and related
variables are declared for convention parity only.

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned `storage` bucket. |
| `enable_nfs` | `true` | Provisions a Cloud Filestore (NFS) instance mounted into the service. Requires the gen2 execution environment. |
| `gcs_volumes` | `[]` | Additional GCS Fuse volume mounts — e.g. a separate read-mostly comics/books library bucket, mounted read-only. The `storage` bucket is mounted at `/config` only when NFS is not. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

Not applicable — `database_type` is fixed to `NONE`. All database-related variables
are declared for convention parity and forwarded to the foundation with no effect.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Komga needs no default init job. |
| `cron_jobs` | `[]` | Scheduled Cloud Scheduler + Cloud Run Jobs, e.g. for library-maintenance tasks. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/actuator/health`, 15s delay | Startup probe. |
| `liveness_probe` | HTTP `/actuator/health`, 30s delay | Liveness probe. |
| `startup_probe_config` | HTTP `/actuator/health` | Alternative structured probe. |
| `health_check_config` | HTTP `/actuator/health` | Alternative structured liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/actuator/health" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 23 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `komga_url` | Internal VPC URL for the service (only reachable inside the VPC when `ingress_settings = "internal"`). |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `initialization_jobs` | Names of the setup jobs (empty by default). |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time. Most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` (never increase) | Critical | Multiple instances writing the same SQLite file concurrently risks database corruption. |
| Health probe path | `/actuator/health` | Critical | `/api/v1/actuator/health` is auth-gated (401) — using it as the probe path means the revision/pod never becomes Ready even though Komga is fully healthy. |
| `enable_nfs` / `nfs_mount_path` | `true` / `/config` | Critical | Moving `/config` off NFS puts it on GCS FUSE (or ephemeral disk), where the SQLite databases are not persisted. |
| First-run setup wizard | Complete promptly after deploy | High | An unclaimed setup wizard leaves the instance without an admin account; anyone who reaches the URL first can claim it. |
| `min_instance_count` | `1` | Medium | Scale-to-zero adds cold-start latency including a Lucene index rebuild on every cold boot. |
| `memory_limit` | `1Gi`, raise for large libraries | Medium | Undersized memory can OOM-kill during a large library scan (Lucene index + thumbnail cache held in the JVM heap). |
| `container_image_source` | `prebuilt` | Medium | Switching to `custom` with no Dockerfile in `Komga_Common/scripts` fails the build — Komga needs no custom build. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Komga-specific application configuration
shared with the GKE variant is described in
**[Komga_Common](Komga_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Komga on Cloud Run](../labs/Komga_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Komga on GKE Autopilot](Komga_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Komga Common — Shared Application Configuration](Komga_Common.md) — the configuration shared by both deployment targets.
