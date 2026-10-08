---
title: "LubeLogger on Google Cloud Run"
description: "Configuration reference for deploying LubeLogger on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# LubeLogger on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LubeLogger_CloudRun.png" alt="LubeLogger on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

LubeLogger is a free, open-source vehicle maintenance and fuel-mileage tracker built
on ASP.NET Core (.NET), shipped as a single container image with an embedded LiteDB
database. This module deploys LubeLogger on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services LubeLogger uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What LubeLogger costs on RAD, and how that compares

**LubeLogger on RAD's Cloud Run module costs about US$33 a month in your own project, with no per-vehicle fee.** RAD charges 40 credits once per deployment in your own project (36 credits, 10% lower, in a project RAD manages), plus build time. LubeLogger also deploys on GKE Autopilot for about US$42 a month — see the [GKE guide](LubeLogger_GKE.md) if you need it to run there instead. If you only need it occasionally, a RAD-managed project can be deleted and restored within 30 days for a few credits, so that monthly figure becomes a few dollars instead — see **Pause it for free**, below.


### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 40 credits (US$4.00 at the top-up price) | 36 credits (10% lower) |
| Build time | A few credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$33 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **15 credits a day**, about 450 a month (about US$45.00 at the top-up price, less on a plan) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (warm) | US$13 |
| NFS/cache file server (small VM) | US$13 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$33** |

### How it compares

- **AUTOsist**, a commercial fleet-maintenance tracker, charges **US$6–7 per vehicle
  per month**, with a **US$59-a-month minimum for 5 vehicles** on its base Maintenance
  package.
- RAD's LubeLogger module costs about US$33 a month in your own project — in
  the same range as AUTOsist's 5-vehicle minimum, but with **no per-vehicle fee and no vehicle
  count ceiling**: a household tracking two cars costs exactly the same as a small fleet
  tracking twenty.
- Self-managed comparison: at 1 vCPU / 1 GiB, a Hetzner CPX22 or
  DigitalOcean 2 vCPU/4 GB droplet (~US$24/month) would run LubeLogger fine, but you would
  still run the OS, backups and upgrades yourself.


### Pause it for free: delete a RAD-managed project, restore it when you need it

If LubeLogger runs in **a project RAD manages for you**, you have a second option that goes
well beyond scaling to zero: **delete the whole project, and restore it within 30 days for
close to nothing.** This suits LubeLogger you only need occasionally — evaluating it, a demo
environment, a seasonal or intermittent workload — far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google
  to delete the project. Google does not remove the project immediately: it keeps it,
  recoverable, for 30 days. Because billing is already unlinked, nothing is charged while it
  waits. Unlike deleting one module, this does not tear down the database, any VM or the
  compute resource one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a few credits, not a rebuild.** Within 30 days, the project's owner can
  restore it. RAD asks Google to undelete the project and reattaches its billing account, then
  asks you to run **Update** on each deployment to confirm everything came back. Because
  nothing was individually destroyed, that Update finds the same resources already there — it
  is a check, not a rebuild, and an Update never charges the module fee again. For LubeLogger behind Services_GCP (a small NFS/cache VM) and Project_GCP, that is roughly **a handful of credits (under US$1)** in total, against the about 45 credits (US$4.50) a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$33.**
  Deploy LubeLogger, use it for a while, delete the project. Restore it next time you need it,
  confirm with Update, and delete it again when you're done. You pay only for the module fee
  once, the builds, and whatever time it was actually live.
- **What this needs.** You must own the project (not one RAD only manages billing for), and
  you restore it yourself within the 30 days — after that, Google deletes it for good.
  Restoring is admitted like creating a new project: your purchased credit balance must still
  clear the tier's floor (100 credits for the sandbox tier most evaluation use fits). Google
  says most services are fully working again within 36 hours of a restore.
- **One real gap: nightly backups do not survive.** Backups and other generated files are
  written to a bucket inside the project, and that bucket is **not** protected by Cloud
  Storage's soft-delete, so it is very likely gone as soon as you delete the project — even
  though the project itself is recoverable for 30 days. If you have customised LubeLogger and
  want to keep that work, copy a backup out (to Google Drive, or a bucket outside the project)
  before you delete. For a default installation with nothing irreplaceable in it, this does
  not matter.


### Pay only while you use it, the other way: delete and redeploy

The option above only applies to a RAD-managed project; **in your own project, or once the
30-day window has passed, the way to stop paying is to delete the deployment and deploy it
again when you need it.**

- **What a redeploy costs.** The module fee again, plus the builds — roughly
  45 credits (US$4.50) in total. Deleting saves money
  only once LubeLogger would otherwise sit unused long enough to clear that redeploy cost
  against its own running cost — about **5 days or more**, both in your own project
  (about US$1.09 a day) and in a RAD-managed one (15 credits a day).
- **Most of the running cost is usually shared.** For LubeLogger that is the database and the shared file/cache VM. They stop only when nothing else in the project uses them, so deleting this app while something else shares the project saves only this app's own compute part.
- **Keep your data first.** Nightly backups go to a bucket inside the deployment and are
  deleted with it, so copy the latest backup out before deleting if you want to keep it.


### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by
card, bank transfer or mobile money.


**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD fees and the daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics and what it says about Cloud Storage objects without soft delete; [AUTOsist](https://www.autosist.com/pricing). Prices change; check each source before relying on a figure.


## 1. Overview

LubeLogger runs as an ASP.NET Core container on Cloud Run v2. The deployment wires
together a minimal set of Google Cloud services — there is no managed database in
the default configuration:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | ASP.NET Core service, 1 vCPU / 1 GiB by default, serverless autoscaling; fixed at a single instance |
| Database | None (default) | LubeLogger's default mode uses an internal embedded LiteDB database file — no Cloud SQL instance is created |
| Object storage | Cloud Storage | Two buckets: `storage` (LiteDB database file + uploaded photos/receipts/documents) and `dpkeys` (ASP.NET Core Data Protection keys) |
| Cache & queue | None | LubeLogger has no Redis usage and no background worker/queue |
| Secrets | None | No secrets are generated — the first account is created via self-service registration |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL (`ingress_settings = "all"`); optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No external database by default.** `database_type = "NONE"` — LubeLogger's own
  embedded LiteDB database file is the source of truth, persisted via a GCS FUSE
  volume. LubeLogger also supports an optional external Postgres backend via a single
  `POSTGRES_CONNECTION` DSN environment variable, but this module does not wire Cloud
  SQL for it.
- **Single instance only.** `min_instance_count = 1` and `max_instance_count = 1` —
  LubeLogger's default mode serves one shared database file from one volume; running
  multiple instances against the same file corrupts it.
- **Secure by default.** `EnableAuth = "true"` overrides LubeLogger's own
  `appsettings.json` default of fully open access. There is no seeded admin account —
  the first person to complete the Register form on `/Login` gains access.
- **Persistent Data Protection keys.** A dedicated small `dpkeys` bucket is always
  mounted at `/root/.aspnet/DataProtection-Keys` so login sessions survive container
  restarts; this is separate from the main `storage` bucket.
- **Prebuilt image, no build step.** The module deploys the official
  `ghcr.io/hargata/lubelogger` image directly (mirrored into Artifact Registry by
  default) — there is no Dockerfile or Cloud Build involved.
- **Health probes use `/Login`,** not `/` — the app root is `[Authorize]`-gated and
  would fail an unauthenticated platform probe even on a healthy container.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the LubeLogger service

LubeLogger runs as a single Cloud Run v2 service (fixed at one instance). Each
deployment creates an immutable revision; traffic can be split across revisions for
safe rollouts.

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

### B. Cloud Storage

Two dedicated **Cloud Storage** buckets are provisioned automatically:

- **`storage`** — mounted at `/App/data` via GCS FUSE; holds the embedded LiteDB
  database file and uploaded photos/receipts/documents.
- **`dpkeys`** — mounted at `/root/.aspnet/DataProtection-Keys`; holds ASP.NET Core's
  cookie/session signing keys.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~lubelogger"
gcloud storage ls gs://<storage-bucket>/        # bucket names are in the Outputs
```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### C. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = "all"`).
An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can
be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### D. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. LubeLogger Application Behaviour

- **No first-deploy database setup.** There is no `db-init` job — LubeLogger
  initialises its own LiteDB database file and directory structure (`config/`,
  `documents/`, `images/`, `temp/`, `themes/`, `translations/` under `/App/data`) on
  first boot.
- **No fixed admin credential.** Open the service, go to `/Login`, and submit the
  **Register** form — that becomes the usable account. Complete this immediately
  after first deploy: `EnableAuth = "true"` restricts the rest of the app, but
  registration itself is open to anyone who can reach the URL until a first account
  exists.
- **Health path.** Startup and liveness probes target `/Login` — LubeLogger's public,
  unauthenticated page. The app root `/` is `[Authorize]`-gated and would 401/redirect
  an unauthenticated probe even on a healthy container.
- **Optional external Postgres.** LubeLogger supports a single `POSTGRES_CONNECTION`
  DSN environment variable (`Host=<host>;Port=5432;Username=<user>;Password=<pass>;Database=<db>;`)
  to use an external Postgres database instead of the embedded LiteDB file. This
  module does not provision Cloud SQL for this path — an operator supplying their own
  Postgres instance can set the variable via `secret_environment_variables`.
- **Single instance, always.** `max_instance_count` is fixed at `1` — LubeLogger's
  default mode has no distributed-locking or multi-writer support for its embedded
  database.
- **Inspect the running revision:**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for LubeLogger are listed; every other input is
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
| `application_name` | `lubelogger` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `LubeLogger` | Human-readable name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `latest` | Image tag on `ghcr.io/hargata/lubelogger`. Since the image is prebuilt (not custom-built), this directly selects the released version. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `1Gi` | Memory per instance. |
| `min_instance_count` | `1` | Kept at `1` to avoid cold starts. |
| `max_instance_count` | `1` | **Must stay at `1`** — LubeLogger's default mode serves one shared database file. |
| `container_port` | `8080` | LubeLogger listens on port 8080. |
| `execution_environment` | `gen2` | Gen2 required for GCS Fuse mounts. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | LubeLogger's default mode has no Cloud SQL. |
| `enable_image_mirroring` | `true` | Mirror the LubeLogger image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Declared for convention parity; not referenced by this module's deployment. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public access — LubeLogger is a user-facing web app. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings, merged with the module's default `EnableAuth = "true"`. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use this for `POSTGRES_CONNECTION` if wiring the optional external Postgres backend. |
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

### Group 10 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned `storage`/`dpkeys` buckets. |
| `enable_nfs` | `true` | Not used by LubeLogger by default. |
| `gcs_volumes` | `[]` | Additional GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — LubeLogger's default mode has no Cloud SQL database. |
| `database_password_length` | `32` | Not referenced in the default configuration. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | LubeLogger's default mode needs no init job. |
| `cron_jobs` | `[]` | No platform-scheduled recurring tasks by default. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/Login` 15s delay | Startup probe. |
| `liveness_probe` | HTTP `/Login` 30s delay | Liveness probe. |
| `startup_probe_config` | HTTP `/Login` | Alternative structured probe. |
| `health_check_config` | HTTP `/Login` | Alternative structured liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/Login" }` | Cloud Monitoring uptime check; disabled by default. |
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
| `lubelogger_url` | Internal VPC URL for the LubeLogger web UI. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (`storage`, `dpkeys`). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | LubeLogger's default mode serves one shared embedded database file from one volume; more than one instance risks database corruption from concurrent writers. |
| `storage`/`dpkeys` buckets | Never delete | Critical | Losing `storage` loses every vehicle record; losing `dpkeys` invalidates all existing login sessions (recoverable — forces re-login only). |
| `EnableAuth` | `true` (default) | Critical | Setting it to `false` reverts to LubeLogger's fully open-access mode — anyone with the URL can view/edit all data with no login at all. |
| First-run registration | Complete immediately after deploy | High | Until a first account is registered, the Register form is reachable by anyone who can reach the URL. |
| `startup_probe`/`liveness_probe` path | `/Login` | Critical | Pointing probes at `/` (or any `[Authorize]`-gated path) fails the probe on an otherwise-healthy container — the revision never becomes Ready. |
| `database_type` | `NONE` (default) | High | LubeLogger's default mode ignores this setting entirely; changing it does not connect LubeLogger to a Cloud SQL instance — use `POSTGRES_CONNECTION` instead for the optional external Postgres path. |
| `min_instance_count` | `1` | Medium | Setting to `0` allows cold starts; since `max_instance_count` is fixed at `1` there is no traffic-splitting risk, only added latency on the first request after idle. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_cloud_armor` | enable for production | Medium | The public web UI and REST API are reachable without WAF protection otherwise. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. LubeLogger-specific application configuration
shared with the GKE variant is described in
**[LubeLogger_Common](LubeLogger_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: LubeLogger on Cloud Run](../labs/LubeLogger_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [LubeLogger on GKE Autopilot](LubeLogger_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [LubeLogger Common — Shared Application Configuration](LubeLogger_Common.md) — the configuration shared by both deployment targets.
