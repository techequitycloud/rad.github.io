---
title: "CloudBeaver on Google Cloud Run"
description: "Configuration reference for deploying CloudBeaver on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# CloudBeaver on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CloudBeaver_CloudRun.png" alt="CloudBeaver on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

CloudBeaver is a web-based, browser-accessible database manager from the DBeaver
project — a single administrative console for connecting to and querying PostgreSQL,
MySQL, SQL Server, Oracle, SQLite and many other engines. This module deploys
CloudBeaver on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md)
foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services CloudBeaver uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load balancing,
scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What CloudBeaver costs on RAD, and how that compares

**CloudBeaver on RAD's Cloud Run module costs about US$19.14 a month in a Google Cloud project you own, plus a one-time 40-credit module fee (US$4).** CloudBeaver is a browser-based database manager for PostgreSQL, MySQL, SQL Server, Oracle, SQLite and more. GKE Autopilot suits CloudBeaver that must stay up, scale across pods, or run beside other Kubernetes workloads; for the lowest cost, this Cloud Run module is usually the right pick — see the [GKE guide](CloudBeaver_GKE.md) if you need the other.

If CloudBeaver is only needed occasionally — a demo, a trial, a seasonal or study workload — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that US$19.14 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 40 credits (US$4 at the top-up price) | 36 credits (10% lower) |
| Build time | A few credits per build (roughly 3–6) | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$19.14 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **9 credits a day**, about 270 a month (about US$27 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, less on a plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (warm) | US$13.14 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$19.14** |

### How it compares

- Run it yourself and a small VPS running CloudBeaver's own container costs less in cash: a Hetzner CPX22 or DigitalOcean 2 vCPU/4 GB box is about $24 a month, or a GCP `e2-standard-2` about $49 a month — plus your own time for backups, security patches and upgrades, which RAD's managed Cloud SQL, Secret Manager and monitoring cover for you.
- RAD never claims to be cheaper than bare infrastructure in cash terms — it usually is not. The difference is what RAD manages for you: patching, backups, secrets and monitoring, plus the ability to pause CloudBeaver for free rather than paying for idle capacity (see below).

### Pause it for free: delete a RAD-managed project, restore it when you need it

If CloudBeaver runs in **a project RAD manages for you**, you have a second option that goes well beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to nothing.** This suits CloudBeaver that you only need occasionally far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google to delete the project. Google does not remove the project immediately: it keeps it, recoverable, for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike deleting one module, this does not tear down Cloud Run resources one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's owner can restore it. RAD asks Google to undelete the project and reattaches its billing account, then asks you to run **Update** on each deployment to confirm everything came back. Because nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a rebuild, and an Update never charges the module fee again. That is a handful of credits (under US$1) in total for a typical CloudBeaver chain, against the 45 credits a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$19.14.** Deploy CloudBeaver, use it, delete the project. Restore it next time you want it, confirm with Update, and delete it again when you're done. You pay only for the module fee once, the builds, and whatever hours it was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages billing for), and you restore it yourself within the 30 days — after that, Google deletes it for good. Restoring is admitted like creating a new project: your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier most study and demo use fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap: the backup bucket does not survive.** Nightly backups are written to a bucket inside the project, and that bucket is **not** protected by Cloud Storage's soft-delete, so it is very likely gone as soon as you delete the project — even though the project itself is recoverable for 30 days. If you have customised CloudBeaver and want to keep that work, copy a backup out (to Google Drive, or a bucket outside the project) before you delete. For a default installation with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

Cloud Run keeps a warm instance, so it does not scale fully to zero on its own. The option above only applies to a RAD-managed project; **in your own project, or once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 45 credits (US$4.50) in your own project. Deleting saves money only once CloudBeaver would otherwise sit unused for about 8 days or more in your own project (US$0.64 a day), or about 5 days or more in a RAD-managed one (9 credits a day).
- **Keep your data first.** Nightly backups are written to a bucket inside the deployment and are deleted with it, so copy the latest backup out before deleting if you want to keep it.
- **Note your settings.** RAD does not recreate a deleted deployment for you; you enter the settings again when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either the trainer funds every place, or each participant pays for their own. Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's own fees and daily-credit estimates from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the 30-day recovery window and what it says about Cloud Storage objects without soft delete. Prices change; check each source before relying on a figure.

## 1. Overview

CloudBeaver runs as a single JVM container on Cloud Run v2. Because CloudBeaver keeps
all of its own state in a persistent workspace and provisions no application database,
the deployment wires together a deliberately small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single JVM service, 1 vCPU / 1 GiB by default, port 8978 |
| Persistent workspace | Cloud Storage (GCS FUSE) | A dedicated bucket mounted at `/opt/cloudbeaver/workspace` holds all CloudBeaver state |
| Database | **None provisioned** | `database_type = "NONE"` — CloudBeaver stores its own state; it *connects out* to databases you configure in the UI |
| Cache & queue | **None** | CloudBeaver uses no Redis; `enable_redis` is forced off |
| Secrets | Secret Manager | No app-level secret is generated — the admin account is created via the first-run setup wizard |
| Ingress | Cloud Run URL / Cloud Load Balancing | **`all` by default** (public internet); set `ingress_settings = "internal"` to restrict to the VPC, or front it with an external HTTPS LB |

**Sensible defaults worth knowing up front:**

- **No application database is provisioned.** `database_type = "NONE"`. CloudBeaver
  keeps its metadata in an embedded H2 store inside the workspace volume. The
  databases it *manages* are added by an operator in the UI after deploy.
- **All state lives in one GCS-backed workspace.** The `storage` bucket is mounted via
  GCS FUSE at `/opt/cloudbeaver/workspace`. Lose or replace that bucket and you lose
  every saved connection, user and setting.
- **Single instance by design.** `min_instance_count = 1` (avoid slow JVM cold starts)
  and `max_instance_count = 1` (the workspace is a single-writer store). Do **not**
  raise `max_instance_count` — concurrent writers corrupt the embedded H2 database.
- **Ingress is `all` by default.** The service is reachable from the public internet
  out of the box — a real consideration for a database admin console. To restrict
  access to within the VPC, set `ingress_settings = "internal"`, or front it with an
  external HTTPS load balancer (and IAP) for controlled public access.
- **The admin account is claimed by the first visitor.** CloudBeaver has no seeded
  admin — complete the setup wizard immediately once the service is reachable.
- **`application_version = "latest"` passes through cleanly.** The image is built from
  `dbeaver/cloudbeaver:<version>` via an app-specific `CLOUDBEAVER_VERSION` build ARG;
  pin a specific tag for reproducible deployments.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the CloudBeaver service

CloudBeaver runs as a Cloud Run v2 service listening on port **8978**. Each deployment
creates an immutable revision; traffic can be split across revisions for safe
rollouts. Because the workspace is single-writer, keep the service at a single
instance.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the container port and image:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].ports[0].containerPort, spec.template.spec.containers[0].image)'
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud Storage — the workspace volume

CloudBeaver's entire state — its embedded H2 metadata database, saved connections,
users, and configuration — persists under `/opt/cloudbeaver/workspace`, which is a
**GCS FUSE** mount of a dedicated Cloud Storage bucket (the `storage` bucket declared
by CloudBeaver_Common). This bucket is the durable heart of the deployment.

- **Console:** Cloud Storage → Buckets → the CloudBeaver `storage` bucket.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<workspace-bucket>/          # bucket name is in the Outputs
  gcloud storage ls -r gs://<workspace-bucket>/       # inspect workspace contents
  ```

See [App_CloudRun](App_CloudRun.md) for GCS FUSE (requires the gen2 execution
environment) and CMEK options.

### C. Database connectivity (no managed instance)

This module provisions **no Cloud SQL instance** — `gcloud sql instances list` will
not show one created by CloudBeaver. Instead, CloudBeaver connects out to whatever
databases you register in its UI. To reach the deployment's own shared Cloud SQL (or
any private database), the service must have VPC egress configured (managed by the
foundation) and the target must be reachable on the VPC.

- **CLI (verify egress path exists, then test from within the VPC):**
  ```bash
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.metadata.annotations)'   # VPC connector / egress annotations
  ```

### D. Secret Manager

CloudBeaver generates **no application-level secret** — there is no encryption key,
no JWT secret, and no database password to manage (there is no database). The admin
account is created through the first-run setup wizard, and all state lives in the
workspace. Foundation-level secrets (if any) follow the standard model.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  ```

### E. Networking & ingress

The service defaults to **`ingress_settings = "all"`** — reachable from the public
internet on the `run.app` URL out of the box, a real consideration for a database
administration console. The `cloudbeaver_url` output is that public service URL in
this mode. To restrict access to within the VPC, set `ingress_settings = "internal"`,
or front the service with an external HTTPS load balancer (optionally with a custom
domain, Cloud CDN, Cloud Armor, and IAP) for controlled public access.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for load balancing, custom domains, and IAP.

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring, with
optional uptime checks and alert policies (`uptime_check_config.enabled` defaults to
`false`, so none is created out of the box). If you enable it, note that a Cloud
Monitoring uptime check is only provisioned when the endpoint is publicly reachable —
the default `all` ingress qualifies the `run.app` URL; setting
`ingress_settings = "internal"` removes the public endpoint and, with it, the ability
to provision an uptime check.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. CloudBeaver Application Behaviour

- **No first-deploy database setup.** There is no db-init job and no application
  database. CloudBeaver initialises its own embedded metadata store inside the
  workspace on first start.
- **State is entirely in the workspace volume.** The embedded H2 database, saved
  connections, managed users, and configuration all live under
  `/opt/cloudbeaver/workspace`, backed by the GCS `storage` bucket. Preserve that
  bucket across redeploys to keep all CloudBeaver state.
- **First-run setup wizard.** On first access CloudBeaver presents a setup wizard to
  create the server configuration and the administrator account. There is no seeded
  admin — whoever completes the wizard first becomes the admin. Do this immediately,
  and keep ingress restricted until you have.
- **Adding databases to manage.** After logging in as admin, add connections in the
  UI (New Connection → choose the driver → supply host/port/credentials). To reach
  private databases on the VPC, ensure VPC egress is configured (foundation-managed).
- **Health path.** Startup and liveness probes target `/` (the CloudBeaver web UI),
  which returns HTTP 200 once the JVM has finished starting. The default startup probe
  allows a 15-second initial delay plus a 10-failure retry window — CloudBeaver's JVM
  boot is quick but not instant.
- **Single-writer scaling.** Keep `max_instance_count = 1`. The workspace store cannot
  be shared safely by concurrent instances.
- **Inspect the running configuration:**
  ```bash
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for CloudBeaver are listed; every other input is inherited from
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
| `application_name` | `cloudbeaver` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | _(set)_ | Human-readable name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `latest` | CloudBeaver image tag (built from `dbeaver/cloudbeaver:<version>`); pin for reproducibility. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `1Gi` | Memory per instance. CloudBeaver runs on the JVM — do not shrink below 512Mi. |
| `min_instance_count` | `1` | Keep 1 warm instance to avoid slow JVM cold starts. |
| `max_instance_count` | `1` | **Keep at 1.** The workspace is a single-writer store; concurrent instances corrupt it. |
| `container_port` | `8978` | CloudBeaver web UI port. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public internet by default. Set `internal` to restrict a DB console to the VPC, or front with an HTTPS LB + IAP for controlled external access. |
| `vpc_egress_setting` | _(set)_ | Controls which egress traffic routes via the VPC — required to reach private databases. |
| `enable_iap` | `false` | Require Google sign-in in front of the service (needs an external LB). |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings passed to the container. CloudBeaver needs none for first boot. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. No app secret is generated by default. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the GCS buckets, including the CloudBeaver workspace bucket. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned workspace bucket. |
| `enable_nfs` | `false` | NFS is off — CloudBeaver's workspace is on GCS, not NFS. |
| `gcs_volumes` | `[]` | Additional GCS FUSE volume mounts (the workspace mount is added automatically). |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Empty — CloudBeaver needs no bootstrap job (no application database). |
| `cron_jobs` | `[]` | No platform-scheduled recurring tasks. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 15s delay, 10 failures | Startup probe against the CloudBeaver UI. |
| `liveness_probe` | HTTP `/` 30s delay | Liveness probe against the CloudBeaver UI. |
| `uptime_check_config` | _(set)_ | Cloud Monitoring uptime check — only provisioned when the endpoint is publicly reachable. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour. Note that
`enable_redis` is forced to `false` and `database_type` is `NONE` by this module and
are not intended to be overridden.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `cloudbeaver_url` | Service URL for the CloudBeaver web UI (port 8978). Public `run.app` URL under the default `ingress_settings = "all"`; internal VPC URL when set to `"internal"`. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (including the workspace bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any initialization jobs (empty by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a `gen1` runtime with GCS FUSE mounts, IAP with no authorized identities, an out-of-range memory value below the gen2 512Mi floor. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| Workspace `storage` bucket | Preserve across redeploys | Critical | The bucket holds all CloudBeaver state (embedded H2 DB, connections, users, config). Deleting or replacing it wipes every setting. |
| `max_instance_count` | `1` | Critical | The workspace is single-writer; two instances writing the embedded H2 store concurrently corrupt it. |
| First-run setup wizard | Complete immediately | High | There is no seeded admin — anyone who reaches the UI first can claim the administrator account. |
| `ingress_settings` | `internal` (or LB+IAP) | High | Defaults to `all` — a database admin console is reachable from the public internet out of the box unless you set `internal` or front it with IAP/Cloud Armor. |
| `memory_limit` | `1Gi` (≥ 512Mi) | High | CloudBeaver is JVM-based; too little memory causes OOM kills. gen2 rejects below 512Mi at plan time. |
| `min_instance_count` | `1` | Medium | Scale-to-zero (`0`) adds a slow JVM cold-start delay on the first request after idle. |
| `application_version` | Pin a tag in production | Medium | `latest` can shift the CloudBeaver version between rebuilds; pin for reproducibility. |
| `enable_redis` / `database_type` | Leave as set (off / `NONE`) | Low | CloudBeaver uses neither; overriding has no benefit and is unsupported here. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. CloudBeaver-specific application configuration
shared with the GKE variant is described in
**[CloudBeaver_Common](CloudBeaver_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: CloudBeaver on Cloud Run](../labs/CloudBeaver_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [CloudBeaver on GKE Autopilot](CloudBeaver_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [CloudBeaver Common — Shared Application Configuration](CloudBeaver_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Django on Cloud Run](Django_CloudRun.md), [Gitea on Google Cloud Run](Gitea_CloudRun.md), [GlitchTip on Google Cloud Run](GlitchTip_CloudRun.md) in the **Custom Application Starter** solution.
