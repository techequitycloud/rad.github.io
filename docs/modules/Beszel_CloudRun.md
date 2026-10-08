---
title: "Beszel on Google Cloud Run"
description: "Configuration reference for deploying Beszel on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Beszel on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Beszel_CloudRun.png" alt="Beszel on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Beszel is a lightweight, open-source server-monitoring hub — historical resource
metrics, Docker container stats, and configurable alerts, built on PocketBase (Go
plus an embedded SQLite database). This module deploys the Beszel hub on
**Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Beszel uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Beszel costs on RAD, and how that compares

**Beszel on RAD's Cloud Run module costs about US$33 a month in your own Google Cloud project, with no extra licence fee** — Beszel is open source. In a project RAD manages for you, the same deployment is metered at **15 credits a day** (about 450 a month, about US$45 at the top-up price). Or see the [GKE guide](Beszel_GKE.md) for always-on capacity across pods. If you only need Beszel occasionally — studying, a demo, a short-lived project — a RAD-managed project can be deleted and restored within 30 days for a few credits, so that monthly figure becomes a few dollars instead. See **Pause it for free**, below.

### What you pay on RAD

Beszel is open source, so there is no licence fee. You pay for three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 40 credits (US$4 at the top-up price) | 36 credits (10% lower) |
| Build time | A few credits per build (roughly 3–6 credits) | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$33 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **15 credits a day**, about 450 a month (about US$45 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the
database, file server and network are shared by every application in the project, so a second
application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (warm) | US$13.14 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$33** |

Cloud SQL and Cloud Run/GKE pod pricing is the same in africa-south1 (Johannesburg); the small VM costs about 10% more there.

- **This module is kept warm by default** (`min_instance_count ≥ 1`), so the Cloud Run figure above already assumes it never scales to zero.

### How it compares, for monitoring a small server fleet

Beszel ships only as a self-hosted binary/Docker image — the project does not sell a hosted version, so the honest comparison is a bare server:

- A Hetzner CPX22 or DigitalOcean droplet (2 vCPU/4 GB, about US$24/month) or a GCP Compute Engine e2-standard-2 (2 vCPU/8 GB, about US$49/month) would run Beszel comfortably — in fact oversized, since Beszel's own footprint here is just 1 vCPU/1 GiB, so a smaller, cheaper instance class would do just as well.
- The difference is what's managed for you: on a bare VPS you own the operating system, security patches, and your own backup discipline. RAD's module gives you the compute, Secret Manager and Cloud Monitoring already wired up, for the module fee plus the Google Cloud usage above.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Beszel runs in **a project RAD manages for you**, deleting the whole project — rather than deleting
just this module — unlinks its billing first, then asks Google to delete the project outright. Google
keeps it, recoverable, for 30 days, and because billing is already unlinked, nothing is charged while it
waits. Unlike deleting one module, this does not tear down Cloud SQL, any VM or the compute resource one
by one: the whole project simply stops.

- **Restoring is a check, not a rebuild.** Within 30 days, the project's owner can ask Google to undelete
  the project and reattach its billing account, then run **Update** on each deployment to confirm
  everything came back. Because nothing was individually destroyed, that Update finds the same resources
  already there, and an Update never charges the module fee again. For a typical 2–3-deployment chain
  this costs only a handful of credits in total (roughly 5–10 credits, under US$1).
- **What this needs.** You must own the project (not one RAD only manages billing for), restore it
  yourself within 30 days — after that Google deletes it for good — and clear the tier's admission floor
  again (100 credits for the sandbox tier most study/demo use fits). Google says most services are fully
  working again within 36 hours of a restore.
- **One real gap: nightly backups do not survive.** Backups are written to a bucket inside the project,
  and that bucket has Cloud Storage's soft-delete turned off, so it is very likely gone as soon as the
  project is deleted — even though the project itself is recoverable for 30 days. Copy a backup out (to
  Google Drive, or a bucket outside the project) before deleting if there is anything in it worth
  keeping; for a default install with nothing irreplaceable, this does not matter.

Source: [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Pay only while you use it, the other way: delete and redeploy

In your own project, or once the 30-day restore window above has passed, the way to stop paying is to
delete the deployment and deploy it again when you need it.

- **What a redeploy costs.** The module fee again, plus the builds: about 44 credits
  (about US$4.40) at the top-up price, and roughly 15–20 minutes of build time (RAD's
  own platform average). Deleting saves money only once Beszel would otherwise sit unused for about
  **3 days or more** — in your own project that is about US$1.09 a day, and
  in a RAD-managed one it is 15 credits a day.
- Most of the running cost here is usually the database and/or the shared file/cache VM or cluster. They stop only when nothing else in the project uses them, so deleting Beszel while another application shares the project saves only Beszel's own compute part.
- **Keep data first.** Nightly backups go to a bucket inside the deployment and are deleted with it, so
  copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets the app in
  their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either
  the trainer funds every place, or each participant pays for their own. Everything is deleted when the
  session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a ring-fenced
  wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the
  data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over
  and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card,
bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD fees and the daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore window and backup-bucket caveat; prices change, check each source before relying on a figure.

## 1. Overview

Beszel runs as a single Go container on Cloud Run v2, serving its web UI and REST
API on port 8090. It keeps all state in an embedded SQLite database under
`/beszel_data`, which is mounted from the shared NFS (Filestore) volume. The deployment
wires together a deliberately small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single Go container, 1 vCPU / 1 GiB by default, port 8090 |
| Database | **None** | Beszel embeds its own PocketBase/SQLite DB — no Cloud SQL is provisioned |
| File storage | Cloud Filestore (NFS) | Mounted at `/beszel_data` for all persistence; the GCS data volume is switched off while NFS owns that path |
| Cache & queue | **None** | Beszel does not use Redis; `enable_redis` is forced off |
| Secrets | Secret Manager | No app secrets injected — the first admin is created in the UI |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL (`ingress_settings = "all"`); optional external HTTPS LB + custom domain |

**Sensible defaults worth knowing up front:**

- **No database, no Redis.** Beszel is self-contained — `database_type = "NONE"`,
  `enable_cloudsql_volume = false`, and `enable_redis = false`. All state is the
  embedded SQLite database under `/beszel_data`.
- **Persistence is NFS, not GCS FUSE.** `enable_nfs = true` mounts the NFS share at
  `/beszel_data`, so the SQLite database and historical metrics survive revision
  replacement and scale events. GCS FUSE cannot host Beszel's WAL-mode SQLite
  databases (it lacks the locking SQLite needs), so the GCS data volume is turned off
  whenever NFS is mounted at `/beszel_data`. Keep `enable_nfs = true`.
- **Single instance is deliberate.** `min_instance_count = max_instance_count = 1`.
  Beszel is a single-writer app (one SQLite file); running more than one instance
  against the same database risks lock contention and corruption. Do
  **not** raise `max_instance_count`.
- **`min_instance_count = 1` (no scale-to-zero).** The hub is kept warm so the SQLite
  database stays open and agents can report continuously; this is a monitoring
  backend, not a bursty request/response app.
- **Port 8090.** Beszel's hub listens on 8090; the container port and probes are set
  accordingly.
- **Public ingress by default.** `ingress_settings = "all"` exposes the `run.app`
  URL so remote agents and browsers can reach the hub. Enabling IAP will block agent
  reporting from machines that cannot present a Google identity.
- **Health path `/api/health`.** Startup and liveness probes hit the hub's public,
  unauthenticated health endpoint (200 when ready).
- **The initial admin is created in the UI.** No admin password is stored in Secret
  Manager; open the hub after deploy and complete PocketBase's first-run superuser
  setup.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Beszel service

Beszel runs as a Cloud Run v2 service. Each deployment creates an immutable
revision; because the app is single-writer, the service is pinned to exactly one
instance rather than autoscaling.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~beszel"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. NFS — the `/beszel_data` volume

The shared NFS volume (Cloud Filestore or the Services_GCP NFS server) holds
Beszel's entire state (the SQLite database, config, and historical metrics). It is
mounted at `/beszel_data` (requires the `gen2` execution environment, which is the
default). A Cloud Storage bucket is still created for the deployment, but it is not
mounted at `/beszel_data` while NFS owns that path — GCS FUSE cannot provide the
locking SQLite's WAL mode needs.

- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format="yaml(spec.template.spec.volumes)"
  ```

> **Caution:** This volume **is** the database. Do not clear it — doing so erases
> all monitoring history and the admin account. See [App_CloudRun](App_CloudRun.md)
> for the NFS options.

### C. Secret Manager

Beszel injects **no** application secrets — there is no encryption key, JWT secret,
or database password to manage (the DB is embedded SQLite, and the admin is created
in the UI). A secret listing shows only whatever the foundation itself creates.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~beszel"
  ```

See [App_CloudRun](App_CloudRun.md) for how secret env vars would be injected if you
add any via `secret_environment_variables`.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = "all"`),
which allows the remote agents to POST their metrics to the hub. An external HTTPS
load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies. (Note that Beszel itself is a
monitoring product — the GCP monitoring here observes the *hub*, not the machines
Beszel watches.)

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Beszel Application Behaviour

- **No init job; schema is self-managed.** Beszel creates and migrates its embedded
  PocketBase/SQLite database automatically on first boot (and on every version
  upgrade). There is no `db-init` job because there is no external database.
- **State lives on the NFS volume.** Everything under `/beszel_data` — the SQLite
  database, config, and historical metrics — is persisted to the NFS share.
  Revisions and restarts reuse the same share, so history survives.
- **First-run setup is in the UI.** Open the service URL and complete PocketBase's
  first-run superuser (admin) account creation. There is no auto-generated admin
  credential in Secret Manager. After creating the admin, add the systems you want
  to monitor and install the Beszel agent on each (the hub shows the agent install
  command and public key).
- **Single writer — do not scale out.** With one SQLite file on a shared mount,
  only one instance may write. `min = max = 1` is enforced by intent; a
  plan-time guard also rejects `min_instance_count > max_instance_count`.
- **Health path.** Startup and liveness probes target `/api/health`, which returns
  `200` once the hub is ready. Inspect the running revision and its env/mounts:
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```
- **Kept warm.** `min_instance_count = 1` avoids cold starts so agents report
  continuously and the SQLite database stays open.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Beszel are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `beszel` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Beszel image tag. `latest` resolves the base image to the pinned `0.9.1`; set an explicit tag (e.g. `0.9.1`) to control upgrades. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance; Beszel is lightweight, 1 vCPU is ample. |
| `memory_limit` | `1Gi` | Memory per instance; 512 Mi–1 Gi is typical (gen2 floor is 512 Mi). |
| `min_instance_count` | `1` | Kept at 1 — one SQLite writer, no scale-to-zero. |
| `max_instance_count` | `1` | **Do not increase.** More than one instance corrupts the shared SQLite database. |
| `container_port` | `8090` | Beszel's hub listens on 8090. |
| `execution_environment` | `gen2` | Required for the NFS `/beszel_data` mount. |
| `enable_image_mirroring` | `true` | Mirror the Beszel image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` lets remote agents reach the hub. `internal` blocks off-VPC agent reporting. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks agents that cannot present a Google identity.** |

### Group — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Keep on: NFS holds `/beszel_data` (the SQLite database). GCS FUSE cannot host it. |
| `gcs_volumes` | `[]` | Extra GCS Fuse mounts (requires gen2). Do not mount one at `/beszel_data`. |
| `create_cloud_storage` | `true` | Provision the declared storage bucket(s). |

### Group — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Beszel has no external database — leave as `NONE`. |
| `enable_cloudsql_volume` | `false` | No Cloud SQL Auth Proxy; Beszel uses embedded SQLite. |

### Group — Redis Cache & Queue

Beszel does not use Redis. `enable_redis` is not exposed as a variable on this module — the
wrapper's `main.tf` hardcodes `enable_redis = false` in its call to `App_CloudRun` (whose
own default is `true`), so there is nothing to configure here.

### Group — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health` 15s delay | Startup probe; 10-retry window for first-boot schema creation. |
| `liveness_probe` | HTTP `/api/health` 30s delay | Liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/api/health" }` | Optional Cloud Monitoring uptime check against the hub. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `beszel_url` | Service URL for the Beszel hub UI/API. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any setup jobs (none by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, a `gen1` runtime with GCS mounts, an out-of-range `backup_retention_days`, `min_instance_count > max_instance_count`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| NFS share at `/beszel_data` | Never clear; keep `enable_nfs = true` | Critical | The share **is** the SQLite database — clearing it erases all monitoring history and the admin account. |
| `max_instance_count` | `1` | Critical | Running >1 instance against the shared SQLite database causes lock contention and database corruption. |
| `enable_cloudsql_volume` / `database_type` | `false` / `NONE` | High | Beszel has no external DB; enabling Cloud SQL provisions an unused instance and misconfigures startup. |
| `execution_environment` | `gen2` | High | `gen1` cannot mount the NFS `/beszel_data` volume, so state is not persisted. |
| `ingress_settings` | `all` | High | `internal` blocks agents outside the VPC from reporting to the hub. |
| `enable_iap` | only for the UI, never with off-Google agents | High | IAP blocks all unauthenticated requests, including agent metric reporting. |
| `min_instance_count` | `1` | Medium | Scale-to-zero (`0`) drops the warm SQLite writer and interrupts continuous agent reporting; also blocked by the min/max guard when set above `max`. |
| `container_port` | `8090` | Medium | The hub listens only on 8090; changing it without matching the image breaks the probes and ingress. |
| `application_version` | pin explicitly | Medium | `latest` resolves the base image to the pinned `0.9.1`; pin a real tag to control upgrades and avoid surprise schema migrations. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Beszel-specific application configuration shared
with the GKE variant is described in **[Beszel_Common](Beszel_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Beszel on Cloud Run](../labs/Beszel_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Beszel on GKE Autopilot](Beszel_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Beszel Common — Shared Application Configuration](Beszel_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Uptime Kuma on Google Cloud Run](UptimeKuma_CloudRun.md), [Gatus on Google Cloud Run](Gatus_CloudRun.md), [Healthchecks on Google Cloud Run](Healthchecks_CloudRun.md), [Netdata on Google Cloud Run](Netdata_CloudRun.md) in the **Monitoring & NOC** solution.
