---
title: "code-server on Google Cloud Run"
description: "Configuration reference for deploying code-server on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# code-server on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CodeServer_CloudRun.png" alt="code-server on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

code-server is Coder's open-source (MIT) build of Visual Studio Code that runs on a
remote server and is accessed entirely through the browser — a full IDE with the VS
Code extension marketplace, integrated terminal, and language servers, backed by a
persistent workspace. This module deploys code-server on **Cloud Run v2** on top of
the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services code-server uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load balancing,
scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What CodeServer costs on RAD, and how that compares

**CodeServer on RAD's Cloud Run module costs about US$32.57 a month in a Google Cloud project you own, plus a one-time 40-credit module fee (US$4).** CodeServer is Coder's open-source build of VS Code that runs in the browser against a persistent cloud workspace. GKE Autopilot suits CodeServer that must stay up, scale across pods, or run beside other Kubernetes workloads; for the lowest cost, this Cloud Run module is usually the right pick — see the [GKE guide](CodeServer_GKE.md) if you need the other.

If CodeServer is only needed occasionally — a demo, a trial, a seasonal or study workload — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that US$32.57 becomes a few dollars a month instead. See **Pause it for free**, below.

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

- **GitHub Codespaces**, the closest managed equivalent, is free for individuals up to 120 core-hours (60 hours on a 2-core machine) and 15 GB-month of storage, then $0.18/hour for a 2-core machine (doubling with core count) plus $0.07/GB-month for storage.
- Run it yourself and a small VPS running code-server yourself costs less in cash: a Hetzner CPX22 or DigitalOcean 2 vCPU/4 GB box is about $24 a month, or a GCP `e2-standard-2` about $49 a month — plus your own time for backups, security patches and upgrades, which RAD's managed Cloud SQL, Secret Manager and monitoring cover for you.
- RAD never claims to be cheaper than bare infrastructure in cash terms — it usually is not. The difference is what RAD manages for you: patching, backups, secrets and monitoring, plus the ability to pause CodeServer for free rather than paying for idle capacity (see below).

### Pause it for free: delete a RAD-managed project, restore it when you need it

If CodeServer runs in **a project RAD manages for you**, you have a second option that goes well beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to nothing.** This suits CodeServer that you only need occasionally far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google to delete the project. Google does not remove the project immediately: it keeps it, recoverable, for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike deleting one module, this does not tear down the VM or Cloud Run resources one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's owner can restore it. RAD asks Google to undelete the project and reattaches its billing account, then asks you to run **Update** on each deployment to confirm everything came back. Because nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a rebuild, and an Update never charges the module fee again. That is a handful of credits (under US$1) in total for a typical CodeServer chain, against the 45 credits a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$32.57.** Deploy CodeServer, use it, delete the project. Restore it next time you want it, confirm with Update, and delete it again when you're done. You pay only for the module fee once, the builds, and whatever hours it was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages billing for), and you restore it yourself within the 30 days — after that, Google deletes it for good. Restoring is admitted like creating a new project: your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier most study and demo use fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap: the backup bucket does not survive.** Nightly backups are written to a bucket inside the project, and that bucket is **not** protected by Cloud Storage's soft-delete, so it is very likely gone as soon as you delete the project — even though the project itself is recoverable for 30 days. If you have customised CodeServer and want to keep that work, copy a backup out (to Google Drive, or a bucket outside the project) before you delete. For a default installation with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

Cloud Run keeps a warm instance, so it does not scale fully to zero on its own. The option above only applies to a RAD-managed project; **in your own project, or once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 45 credits (US$4.50) in your own project. Deleting saves money only once CodeServer would otherwise sit unused for about 5 days or more, whether in your own project or a RAD-managed one.
- **Most of the running cost is usually the shared file or cache server.** It stops only when nothing else in the project uses it, so deleting CodeServer while something else shares the project saves only this app's own compute part.
- **Keep your data first.** Nightly backups are written to a bucket inside the deployment and are deleted with it, so copy the latest backup out before deleting if you want to keep it.
- **Note your settings.** RAD does not recreate a deleted deployment for you; you enter the settings again when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either the trainer funds every place, or each participant pays for their own. Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's own fees and daily-credit estimates from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the 30-day recovery window and what it says about Cloud Storage objects without soft delete; [GitHub Codespaces](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-codespaces/about-billing-for-github-codespaces). Prices change; check each source before relying on a figure.

## 1. Overview

code-server runs as a single self-contained container on Cloud Run v2. Unlike
database-backed apps, it wires together a deliberately minimal set of Google Cloud
services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single container listening on port **8080**; 1 vCPU / 1 GiB by default |
| Persistent workspace | Cloud Filestore (NFS) | `/home/coder` is on the NFS share by default; the workspace bucket is mounted there via GCS FUSE only if NFS is turned off |
| Database | _None_ | `database_type = NONE` — code-server has no SQL database |
| Cache & queue | _None_ | Redis is explicitly disabled (`enable_redis = false`) |
| Secrets | Secret Manager | Auto-generated editor `PASSWORD` (when `enable_password = true`) |
| Ingress | Cloud Run URL / Cloud Load Balancing | **Default ingress is `all`** — publicly reachable by default; the auto-generated `PASSWORD` gates the login page |

**Sensible defaults worth knowing up front:**

- **No database and no Redis.** code-server is a single container; all state lives in
  the workspace volume. `database_type` is fixed to `NONE` by the shared application
  layer and Redis is disabled.
- **Ingress is `all` (public) by default.** The service is reachable from the public
  internet out of the box, gated by the auto-generated `PASSWORD`. Keep
  `enable_password = true` whenever `ingress_settings = "all"`, or switch to
  `ingress_settings = "internal"` to restrict access to the VPC.
- **A random editor `PASSWORD` is generated automatically** and stored in Secret
  Manager. It gates the login page. Disabling `enable_password` serves the editor with
  no authentication — only safe behind `internal` ingress.
- **The workspace is on NFS at `/home/coder`.** Settings, extensions, and open
  projects persist there. Keep `enable_nfs = true`: on the GCS FUSE fallback, installing
  an extension fails, because GCS FUSE cannot rename a directory. Requires the `gen2` execution environment (the default).
- **Single instance by design.** `min_instance_count = max_instance_count = 1`.
  code-server holds per-session editor state in memory and owns one workspace volume;
  scaling beyond one instance would split sessions and risk concurrent writes to the
  same volume.
- **Health probes hit `/healthz`, not `/health`.** `/healthz` is unauthenticated and
  returns `200` once the server is listening; `/health` returns `401` when a password
  is set and would fail the probe.
- **The image is a thin wrapper over `codercom/code-server`**, built and mirrored into
  Artifact Registry via Cloud Build; `latest` pins to `4.99.1` at build time.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the code-server service

code-server runs as a Cloud Run v2 service listening on port 8080. Each deployment
creates an immutable revision; because the app is single-instance and stateful, keep
`min = max = 1` and avoid traffic splitting across concurrent revisions.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" --filter="metadata.name~codeserver"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud Storage — the workspace volume

The single stateful location is `/home/coder` — the user's workspace, VS Code settings,
and installed extensions. By default it is the NFS mount path, which survives revision
redeploys and scale events. A dedicated **Cloud Storage** bucket is also provisioned;
it is mounted as a **GCS FUSE** volume at `/home/coder` only when `enable_nfs = false`,
where extension installs fail.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~codeserver"
  gcloud storage ls gs://<workspace-bucket>/          # bucket name is in the Outputs
  ```

NFS and GCS FUSE both require the `gen2` execution environment (the default). See
[App_CloudRun](App_CloudRun.md) for GCS FUSE and CMEK options.

### C. Secret Manager — the editor password

When `enable_password = true` (default), a 24-character random `PASSWORD` is generated
and stored in Secret Manager, then injected as the container's `PASSWORD` env var to
gate the login page. There is no database password (no database).

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~codeserver AND name~password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for secret injection and rotation details.

### D. Networking & ingress

The service defaults to **`all` ingress** — reachable from the public internet, with
the auto-generated `PASSWORD` gating the login page. To restrict access to the VPC,
set `ingress_settings = "internal"`, or layer an external HTTPS load balancer with a
custom domain, Cloud CDN, and Cloud Armor.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies. A public endpoint is required for an
uptime check to reach the service.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. code-server Application Behaviour

- **No first-deploy database setup.** code-server has no SQL database and no
  initialization job. The service comes up as soon as the container starts and binds
  to `0.0.0.0:8080` (set via `BIND_ADDR`).
- **No migrations.** Upgrading the `application_version` simply rolls a new revision
  on the newer image; there is no schema to migrate.
- **The workspace is the only durable state.** Everything under `/home/coder` — open
  folders, `settings.json`, keybindings, and every installed extension — persists on
  the NFS share. Deleting it wipes the workspace.
- **Login is gated by the `PASSWORD` secret.** With `enable_password = true`, the
  editor prompts for the generated password. Retrieve it from Secret Manager (§2C).
  With it disabled, anyone reaching the URL gets an unauthenticated IDE — only run
  that way behind `internal` ingress.
- **Health path.** Startup and liveness probes target the unauthenticated `/healthz`
  endpoint (returns `200` once the HTTP server is listening). Do **not** point probes
  at `/health` when a password is set — it returns `401` and the revision never
  becomes Ready. Verify the running revision's env and port:
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
- **Single-instance scaling.** Keep `min = max = 1`. Editor sessions are held in
  memory and the workspace volume has a single writer.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for code-server are listed; every other input is
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
| `application_name` | `codeserver` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `code-server` | Human-readable name shown in the Console. |
| `application_version` | `latest` | code-server image tag; `latest` pins to `4.99.1` at build time. Pin to a specific release in production. |
| `enable_password` | `true` | Generate a random editor `PASSWORD` and require it at login. **Leave enabled for any publicly reachable deployment.** |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance; raise for heavy language servers. |
| `memory_limit` | `1Gi` | Memory per instance; size to the workspaces and extensions you run. |
| `min_instance_count` | `1` | Keep at 1 — single-instance editor; avoids cold-start delays during index loading. |
| `max_instance_count` | `1` | Keep at 1 — one workspace volume, in-memory session. |
| `container_port` | `8080` | code-server listens on 8080. |
| `execution_environment` | `gen2` | Required for GCS FUSE (workspace mount) and NFS. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | code-server has no Cloud SQL — keep false. |
| `enable_image_mirroring` | `true` | Mirror the code-server image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public by default (gated by the `PASSWORD` secret). Set `internal` to restrict access to the VPC. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of the editor. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings (e.g. `{ TZ = "UTC" }`). `BIND_ADDR` is set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Must stay `true` on Cloud Run: `/home/coder` holds settings, extensions and projects, and installing an extension fails on GCS FUSE (it cannot rename a directory). |
| `nfs_mount_path` | `/home/coder` | Mount path if NFS is enabled. |
| `gcs_volumes` | `[]` | Additional GCS FUSE mounts; the workspace bucket is added automatically at `/home/coder` only when `enable_nfs = false`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Not referenced — code-server has no SQL database; fixed to `NONE` by CodeServer_Common. |
| `database_password_length` | `32` | Not referenced — forwarded to the foundation for compatibility. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthz` 15s delay | Startup probe; uses the unauthenticated endpoint. |
| `liveness_probe` | HTTP `/healthz` 30s delay | Liveness probe; uses the unauthenticated endpoint. |
| `health_check_config` | HTTP `/health` | Alternative structured probe (authed endpoint). |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Optional Cloud Monitoring uptime check (needs a public endpoint). |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 23 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs follow standard App_CloudRun behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `codeserver_url` | URL of the code-server editor (port 8080). Reachable only within the VPC when ingress is `internal`. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (the workspace bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any user-supplied init jobs (none by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a `gen1` runtime with GCS FUSE/NFS mounts, IAP with no authorized identities, an out-of-range `timeout_seconds`, and so on. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_password` | `true` (keep on for public ingress) | Critical | Disabling with `ingress_settings = "all"` exposes a fully unauthenticated IDE — including a terminal — to the internet. |
| `enable_nfs` | `true` (the default) | Critical | The NFS share at `/home/coder` is the only persistent state. Turning NFS off moves the workspace onto GCS FUSE, where extension installs fail. |
| `startup_probe` / `liveness_probe` path | `/healthz` | High | Pointing probes at `/health` while a password is set returns `401`; the revision never becomes Ready. |
| `max_instance_count` | `1` | High | Scaling beyond 1 splits editor sessions across instances and risks concurrent writes to the single workspace volume. |
| `min_instance_count` | `1` | Medium | Scale-to-zero (`0`) adds cold-start latency and re-mounts the workspace on the next request. |
| `execution_environment` | `gen2` | High | `gen1` cannot mount NFS or GCS FUSE — the workspace volume fails and state is lost on restart. |
| `ingress_settings` | `all` + password (or `internal`) | High | `all` without a password publishes an open IDE; `internal` blocks all browser access from outside the VPC. |
| `enable_cloudsql_volume` | `false` | Low | code-server has no database; enabling adds an unused Auth Proxy sidecar. |
| `memory_limit` | `1Gi`+ | Medium | Heavy language servers/extensions can OOM below 1 GiB. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. code-server-specific application configuration
shared with the GKE variant is described in
**[CodeServer_Common](CodeServer_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: code-server on Cloud Run](../labs/CodeServer_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [code-server on GKE Autopilot](CodeServer_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [CodeServer Common — Shared Application Configuration](CodeServer_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Coder on Google Cloud Run](Coder_CloudRun.md), [Gitea on Google Cloud Run](Gitea_CloudRun.md), [Hoppscotch on Google Cloud Run](Hoppscotch_CloudRun.md) in the **Cloud Development Environments** solution.
