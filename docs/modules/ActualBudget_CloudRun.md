---
title: "ActualBudget on Google Cloud Run"
description: "Configuration reference for deploying ActualBudget on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# ActualBudget on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ActualBudget_CloudRun.png" alt="ActualBudget on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Actual Budget is a privacy-first, local-first personal finance application built around zero-based envelope budgeting. The `actual-server` component is a lightweight Node.js sync server that stores each budget as a SQLite file and synchronises it across the web UI, desktop, and mobile clients. This module deploys the Actual Budget server on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services ActualBudget uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run application — service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What ActualBudget costs on RAD, and how that compares

**ActualBudget on RAD's Cloud Run module costs about US$19 a month in a project you own, with no licence fee for the software itself.** RAD charges a one-off module fee of 40 credits (US$4 at the top-up price) in a project you own, and 36 credits (10% lower) in a project RAD manages. If ActualBudget needs to run continuously across pods or beside other Kubernetes workloads, see the [GKE guide](ActualBudget_GKE.md) instead. Figures are as at 8 October 2026; sources are listed at the end of this section.

If you only need it occasionally — studying for a certification, a demo, a seasonal need — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that about US$19 a month becomes close to nothing instead. See **Pause it for free**, below.

### What you pay on RAD

You pay for three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 40 credits (US$4 at the top-up price) | 36 credits (10% lower) |
| Build time | A few credits, metered per minute of build time | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about US$19 a month for the default configuration (table below) | Metered hourly in credits; RAD publishes **9 credits a day**, about 270 a month (about US$27 at the top-up price, US$22 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (warm) | US$13.14 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$19** |

### How it compares

- YNAB (You Need A Budget), the best-known paid budgeting app in the same category, charges **$14.99/month** (or $109/year, about $9.08/month) per person — and that is a licence fee for software only, with no infrastructure of your own behind it.
- **RAD runs the open-source project itself, not a vendor's hosted tenancy.** You get the same software, under your own (or RAD's) infrastructure, instead of a per-seat or per-usage subscription that grows independently of what you actually use.
- **Against a bare self-managed server:** It is a smaller workload than a standard 2 vCPU VPS, so running it yourself on a cheaper, smaller class than a Hetzner CPX22 or DigitalOcean 2 vCPU/4 GB Droplet (both about $24/month) would do, for noticeably less than that. RAD is not cheaper than that in cash terms — the difference is the managed database, Secret Manager and monitoring that come with the module instead of being your own job.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If ActualBudget runs in **a project RAD manages for you**, you have an option that goes well beyond
scaling to zero: **delete the whole project, and restore it within 30 days for close to
nothing.** This suits occasional use — studying for a certification, a demo, a seasonal
need — far better than running ActualBudget continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google
  to delete the project outright. Google does not remove it immediately: it keeps the project,
  recoverable, for 30 days, and because billing is already unlinked nothing is charged while it
  waits. Unlike deleting one module, this does not tear down the database, any VM or the
  compute resource one by one — the whole project simply stops, and nothing is billed in the
  meantime.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, only the project's
  owner can restore it. RAD asks Google to undelete the project and reattaches its billing
  account, then asks you to run **Update** on each deployment to confirm everything came back.
  Because nothing was individually destroyed, that Update finds the same resources already
  there — it is a check, not a rebuild, and an Update never charges the module fee again. This
  costs only a handful of credits in total (under US$1), against paying the module fee and a
  full build again.
- **What this needs.** You must own the project (not one RAD only manages billing for), you
  must restore it yourself within the 30 days — after that Google deletes it for good — and
  restoring is admitted like creating a new project, so your purchased credit balance must
  still clear the tier's floor (100 credits for the sandbox tier most study and demo use
  fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap: backups do not survive.** Anything ActualBudget writes to a backup bucket inside the
  project is very likely gone as soon as you delete the project, even though the project itself
  is recoverable for 30 days — that bucket has Cloud Storage's soft-delete explicitly turned
  off. Anyone who has customised the deployment and wants to keep that work should copy a
  backup out (to Google Drive, or a bucket outside the project) before deleting. For a default
  install with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

This is the fallback for a project you own, or once the 30-day restore window above has
passed: **delete the deployment, and deploy it again when you next need it.**

- **What a redeploy costs.** The module fee again, plus the builds: roughly
  45 credits (about US$4.50) in your own project, or
  41 credits in a RAD-managed one, because RAD rebuilds the resources
  from scratch. Deleting saves money once ActualBudget would otherwise sit unused long enough to clear that redeploy cost against its own running cost — roughly 7 days or more in your own project (US$0.64/day) or 5 days or more in a RAD-managed one (9 credits/day).
- **Keep your data first.** Anything ActualBudget writes to a backup bucket inside the deployment is
  deleted with it — copy the latest backup out (to Google Drive, or a bucket you keep) before
  deleting if you want to keep it.
- **RAD does not recreate a deleted deployment for you.** You enter the settings again when
  you redeploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  ActualBudget in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs ActualBudget for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's fees and daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics; [YNAB pricing](https://www.ynab.com/pricing). Prices change; check each source before relying on a figure.

## 1. Overview

ActualBudget runs as a single Node.js container on Cloud Run v2. Because it manages its own SQLite storage, the deployment wires together a deliberately small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 1 vCPU / 1 GiB by default, single instance (`min = max = 1`) |
| Database | None | ActualBudget keeps budget data in SQLite files — `database_type = "NONE"`, no Cloud SQL |
| Persistent data | Cloud Storage (GCS FUSE) | A dedicated `storage` bucket mounted at `/data` holds the SQLite budget files and user files |
| Container image | Artifact Registry + Cloud Build | Thin-wrapper build of `actualbudget/actual-server`, mirrored into your registry |
| Secrets | Secret Manager | An API token (`enable_api_key`), **on by default** and required whenever `ingress_settings = "all"` |
| Ingress | Cloud Run URL / Cloud Load Balancing | **Defaults to `all`** (public) — needed to reach the web UI directly; switch to `internal` for VPC-only access |

**Sensible defaults worth knowing up front:**

- **No external database.** ActualBudget persists everything as SQLite files under `/data`; there is no Cloud SQL instance, no `db-init` job, no Redis (`enable_redis = false`), and no Cloud SQL Auth Proxy sidecar.
- **A `storage` GCS bucket is provisioned automatically** by `ActualBudget_Common` and mounted at `/data` via GCS FUSE (`enable_gcs_storage_volume = true`). `ACTUAL_SERVER_FILES = /data/server-files` and `ACTUAL_USER_FILES = /data/user-files` point both persistence subtrees at that mount so nothing lands on ephemeral container disk.
- **Single instance by design.** `min_instance_count = 1` and `max_instance_count = 1` — the server serves one shared set of SQLite files from one volume; running multiple replicas risks write conflicts.
- **Ingress defaults to `all` (public), paired with a mandatory API key.** `ingress_settings = "all"` is the module default — needed to reach the web UI directly — and `validation.tf` enforces a plan-time precondition (`ingress_settings != "all" || enable_api_key`) that rejects public ingress unless `enable_api_key` is also `true`. Since `enable_api_key` also defaults to `true`, pure defaults pass validation and deploy publicly reachable with API-token protection already provisioned. Switch to `ingress_settings = "internal"` for VPC-only access instead.
- **API key on by default.** The server password is still set interactively on the first-run onboarding screen, but `enable_api_key = true` (the module default) additionally provisions a 32-character API token (`ACTUAL_TOKEN`) in Secret Manager — required by the ingress precondition above whenever `ingress_settings = "all"`.
- **Version pinning.** The Dockerfile reads an app-specific `ACTUALBUDGET_VERSION` build ARG; `application_version = "latest"` pins the build to `25.7.1`.
- **Health probes target `/`** — the server answers its root path with HTTP 200 as soon as it is listening, no authentication required.
- **Best suited to single-user / light use on Cloud Run.** SQLite over GCS FUSE does not tolerate heavy concurrent writes; for durable production storage prefer the ActualBudget_GKE variant with a block PVC.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the ActualBudget service

ActualBudget runs as a Cloud Run v2 service pinned to a single instance. Each deployment creates an immutable revision; traffic shifts to the newest healthy revision on update.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~actualbudget"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and traffic splitting.

### B. Cloud Storage — the persistent data tier

All ActualBudget state — the SQLite budget databases, server files, and per-file user data — lives on a dedicated **Cloud Storage** bucket mounted into the container at `/data` via **GCS FUSE** (gen2 execution environment required). The bucket survives revision rollouts, restarts, and re-deploys; it is the only place budget data exists, so treat it as the thing to protect and back up.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~actualbudget"
  gcloud storage ls -r gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse mount behaviour and CMEK.

### C. Artifact Registry & Cloud Build — the container image

`ActualBudget_Common` ships a thin-wrapper Dockerfile (`FROM actualbudget/actual-server:${ACTUALBUDGET_VERSION}`) that Cloud Build builds into your project's Artifact Registry repository — so deploys pull from your registry, not Docker Hub, and are compatible with Binary Authorization.

- **Console:** Artifact Registry → Repositories; Cloud Build → History.
- **CLI:**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
  ```

### D. Secret Manager — API token

`enable_api_key = true` is the module default: a 32-character random token is generated, stored in Secret Manager as `secret-<prefix>-<app>-api-key`, and injected into the service as the `ACTUAL_TOKEN` secret environment variable — useful for automations that must call the server before the UI is configured, and required by `validation.tf` whenever `ingress_settings = "all"` (also the default).

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service defaults to `ingress_settings = "all"`, so the `run.app` URL is publicly reachable out of the box (needed to reach the web UI directly) — paired with the mandatory `enable_api_key = true` default (see §2.D). For VPC-only access, set `ingress_settings = "internal"`; for a custom domain, Cloud CDN, Cloud Armor, and optionally IAP in front, use `internal-and-cloud-load-balancing`.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  # Tunnel to an internal-only service from your workstation:
  gcloud run services proxy <service-name> --region "$REGION" --port 8080
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring. An uptime check can be enabled via `uptime_check_config` (off by default; it requires a publicly reachable endpoint — satisfied out of the box by the `ingress_settings = "all"` default, but not if you switch to `internal`).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. ActualBudget Application Behaviour

- **No initialization job.** There is no database to bootstrap; the server creates its SQLite files under `/data` on first boot. Custom `initialization_jobs` are accepted for data loading or migration tasks but none is provided by default.
- **First-run setup.** On first access the web UI shows an onboarding screen where you set the **server password** — there are no pre-seeded credentials to retrieve. Do this immediately after deploy; the service is publicly reachable by default (`ingress_settings = "all"`), and until a password is set, anyone who can reach the URL can claim the server.
- **Data layout.** `ACTUAL_SERVER_FILES = /data/server-files` (server metadata and the account database) and `ACTUAL_USER_FILES = /data/user-files` (the per-budget sync data). Both live on the GCS FUSE mount, so budget data survives restarts and redeploys.
- **Local-first sync model.** Clients (web, desktop, mobile) keep a full local copy of the budget and use the server only to synchronise encrypted changes between devices — brief server unavailability does not block working in a client.
- **Single-writer constraint.** The server assumes exclusive access to its SQLite files. Keep `max_instance_count = 1`; a plan-time validation enforces `min_instance_count <= max_instance_count`.
- **Version updates.** Change `application_version` and re-apply — Cloud Build produces a new image and Cloud Run rolls a new revision. `latest` builds the pinned `25.7.1`.
- **Health endpoint.** Startup and liveness probes issue `GET /`, which returns HTTP 200 unauthenticated as soon as the HTTP server is listening.
- **Verification:**
  ```bash
  SERVICE=$(gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~actualbudget" --format="value(metadata.name)" --limit=1)
  SERVICE_URL=$(gcloud run services describe "$SERVICE" \
    --project "$PROJECT" --region "$REGION" --format="value(status.url)")
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200 with the default ingress=all (403/404 if switched to internal)
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for ActualBudget are listed; every other input is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

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

All other inputs follow standard App_CloudRun behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `actualbudget` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Image version tag; `latest` builds the pinned `25.7.1`. Increment to trigger a new build and revision. |
| `enable_api_key` | `true` | Generate a 32-char API token in Secret Manager and inject it as `ACTUAL_TOKEN`. Required whenever `ingress_settings = "all"` (the module default) — `validation.tf` rejects public ingress without it. |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | actual-server is a lightweight Node.js process; 1 vCPU suffices. |
| `memory_limit` | `1Gi` | Modest memory is enough for typical budget files. |
| `min_instance_count` | `1` | Keeps the single instance warm. Set `0` for scale-to-zero if a cold start on first request is acceptable. |
| `max_instance_count` | `1` | **Keep at 1** — one shared SQLite volume, one writer. |
| `container_port` | `5006` | actual-server's native HTTP port. |
| `execution_environment` | `gen2` | Required for the GCS FUSE `/data` mount. |
| `enable_cloudsql_volume` | `false` | No Cloud SQL — leave `false`. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public by default (needed to reach the web UI directly); `validation.tf` requires `enable_api_key = true` when this is `all`. Set `internal` for VPC-only access, or `internal-and-cloud-load-balancing` behind an HTTPS load balancer. |
| `enable_iap` | `false` | Add Google-identity authentication in front of the UI (load-balancer path). |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra plain env vars. `ACTUAL_PORT`, `ACTUAL_SERVER_FILES`, and `ACTUAL_USER_FILES` are injected automatically. |
| `secret_environment_variables` | `{}` | Extra Secret Manager references. The `ACTUAL_TOKEN` secret is wired automatically when `enable_api_key = true`. |

All other inputs follow standard App_CloudRun behaviour.

### Groups 7–10 — Backup, CI/CD, Custom SQL, Domain & CDN

Standard App_CloudRun behaviour — see [App_CloudRun](App_CloudRun.md). Note that the Custom SQL inputs (group 9) are inert for ActualBudget since there is no Cloud SQL instance.

### Group 11 — Cloud Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | The `storage` data bucket is always declared by `ActualBudget_Common`. |
| `gcs_volumes` | `[]` | Additional GCS FUSE mounts; the `/data` storage mount is added automatically. |
| `enable_nfs` | `false` | Not needed — persistence is on the GCS bucket. |

All other inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed to `NONE` by `ActualBudget_Common` — ActualBudget has no SQL database. |

All other inputs in this group are forwarded for compatibility but not referenced.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No default job. Supply your own only for custom data loading/migration. |
| `cron_jobs` | `[]` | Recurring jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 15 s initial delay, 10 failures | Passes as soon as the Node server is listening. |
| `liveness_probe` | HTTP `/`, 30 s initial delay, period 30 s | Root path, unauthenticated. |
| `uptime_check_config` | disabled | Enable only once the endpoint is publicly reachable (ingress `all` or a load balancer). |

All other inputs follow standard App_CloudRun behaviour.

### Group 23 — VPC Service Controls & Audit Logging

`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `organization_id`, `enable_audit_logging` — standard App_CloudRun behaviour; see [App_CloudRun](App_CloudRun.md).

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `actualbudget_url` | The service's `run.app` URL. Publicly reachable by default (`ingress_settings = "all"`); restricted to the VPC when `ingress_settings = "internal"`. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (includes the `/data` storage bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any custom setup jobs (empty by default). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

The module ships plan-time validation for the most damaging misconfigurations (for example `min_instance_count <= max_instance_count`), but several settings deserve explicit care:

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | Multiple instances write the same SQLite files on one shared volume — corruption/conflict risk. |
| First-run server password | set immediately | Critical | Until a password is set, anyone who can reach the URL can claim the server and its budget data. |
| Storage bucket contents | never delete manually | Critical | `/data` on the GCS bucket is the only copy of the budget databases; deleting the bucket erases all budgets. |
| `container_port` | `5006` | Critical | actual-server's native port; mismatching it causes all health probes to fail. |
| `execution_environment` | `gen2` | High | GCS FUSE volume mounts require gen2; gen1 leaves `/data` unmounted and data on ephemeral disk. |
| `ingress_settings` = `"all"` (the default) | set the server password immediately after deploy | Critical | The service is publicly reachable by default; an unclaimed server can be claimed by anyone who reaches the URL first. Set `internal` instead if public access isn't needed. |
| `ingress_settings = "all"` with `enable_api_key = false` | not a valid combination | Critical | `validation.tf` enforces `ingress_settings != "all" \|\| enable_api_key` at plan time — this combination fails the plan outright rather than deploying insecurely. Both default to values that already satisfy the precondition (`all` + `true`), so pure defaults deploy cleanly; only an explicit override to `enable_api_key = false` while leaving ingress at `all` triggers the failure. |
| Heavy multi-user write load | move to ActualBudget_GKE (block PVC) | High | SQLite does not tolerate GCS FUSE under heavy concurrent write; Cloud Run suits single-user / light use. |
| `enable_api_key` | `true` (the default) | Medium | Without `ACTUAL_TOKEN`, programmatic API access relies solely on the server password. Also required by the ingress precondition above whenever `ingress_settings = "all"`. |
| `min_instance_count` | `1` (or `0` to save cost) | Medium | `0` adds a cold start to the first request after idle; data is safe either way (state is on GCS). |
| `uptime_check_config` | enable while ingress is public | Low | If `ingress_settings` is switched to `internal`, the check cannot reach the service and will always fail. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. ActualBudget-specific application configuration shared with the GKE variant is described in **[ActualBudget_Common](ActualBudget_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: ActualBudget on Cloud Run](../labs/ActualBudget_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [ActualBudget on GKE Autopilot](ActualBudget_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [ActualBudget Common — Shared Application Configuration](ActualBudget_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Firefly III on Google Cloud Run](FireflyIII_CloudRun.md), [Ghostfolio on Google Cloud Run](Ghostfolio_CloudRun.md), [Wallos on Google Cloud Run](Wallos_CloudRun.md) in the **Finance & Wealth Tracking** solution.
