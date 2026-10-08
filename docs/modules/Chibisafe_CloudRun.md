---
title: "Chibisafe on Google Cloud Run"
description: "Configuration reference for deploying Chibisafe on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Chibisafe on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Chibisafe_CloudRun.png" alt="Chibisafe on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Chibisafe is a self-hosted file and image uploader with a modern dashboard,
drag-and-drop uploads, albums, and a public API. This module deploys the
**complete Chibisafe stack** — the web UI at `/`, the REST API under `/api`,
the OpenAPI reference at `/docs`, and uploaded files served by name — as one
service on **Cloud Run v2**, on top of the [App_CloudRun](App_CloudRun.md)
foundation, which provisions and manages the shared Google Cloud
infrastructure. Upstream ships Chibisafe as three containers (the
chibisafe-server backend, a Next.js front-end and a Caddy reverse proxy); this
module combines them into one custom-built image.

> **Status:** the full-stack image has not yet been built or deployed, so the
> behaviour below is described from the module source and upstream's `v6.5.5`
> release, not verified live.

This guide focuses on the cloud services Chibisafe uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress
and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## What Chibisafe costs on RAD, and how that compares

**Chibisafe on RAD's Cloud Run module costs about US$33 a month in your own Google Cloud project, with no extra licence fee** — Chibisafe is open source. In a project RAD manages for you, the same deployment is metered at **15 credits a day** (about 450 a month, about US$45 at the top-up price). Or see the [GKE guide](Chibisafe_GKE.md) for always-on capacity across pods. If you only need Chibisafe occasionally — studying, a demo, a short-lived project — a RAD-managed project can be deleted and restored within 30 days for a few credits, so that monthly figure becomes a few dollars instead. See **Pause it for free**, below.

### What you pay on RAD

Chibisafe is open source, so there is no licence fee. You pay for three things:

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

### How it compares, for a personal or small-team file host

Chibisafe has no official hosted offering — it ships as a self-hosted stack, so the realistic comparison is a bare server:

- A Hetzner CPX22 or DigitalOcean droplet (2 vCPU/4 GB, about US$24/month) or a GCP e2-standard-2 (2 vCPU/8 GB, about US$49/month) would run it comfortably — oversized for Chibisafe's own 1 vCPU/1 GiB footprint here, so a smaller, cheaper instance class would do just as well.
- On a bare VPS you own the operating system, security patches and your own backup discipline. RAD's module gives you the compute, Secret Manager and Cloud Monitoring already wired up, for the module fee plus the Google Cloud usage above.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Chibisafe runs in **a project RAD manages for you**, deleting the whole project — rather than deleting
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
  own platform average). Deleting saves money only once Chibisafe would otherwise sit unused for about
  **3 days or more** — in your own project that is about US$1.09 a day, and
  in a RAD-managed one it is 15 credits a day.
- Most of the running cost here is usually the database and/or the shared file/cache VM or cluster. They stop only when nothing else in the project uses them, so deleting Chibisafe while another application shares the project saves only Chibisafe's own compute part.
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

Chibisafe runs as a single, custom-built container on Cloud Run v2 — Caddy in
front of two Node.js processes (backend and front-end) — with no external
database. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Full-stack custom-built image (Caddy on port 8000 → backend + Next.js front-end on loopback); 1 vCPU / 1 GiB by default; `min=max=1` (single instance) |
| Database | None | Chibisafe keeps its SQLite database, uploads, and logs on the mounted volume — no Cloud SQL instance is created |
| Persistent storage | Cloud Storage (GCS Fuse) | A `storage` bucket is always provisioned and mounted at `/data` via GCS Fuse (requires `gen2`); **not** a durable block device |
| Secrets | Secret Manager | Optional `ADMIN_PASSWORD` (gated by `enable_api_key`, off by default) |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, public by default (`ingress_settings = "all"`) |

**Sensible defaults worth knowing up front:**

- **SQLite is the only "database."** `database_type` is fixed to `NONE` by
  `Chibisafe_Common`; the many `database_*`/`db_*`/`sql_instance_*` variables
  mirrored in `variables.tf` exist purely for Foundation-convention parity and
  have no effect.
- **Persistence is GCS Fuse, not a block device — and the module says so.**
  Cloud Run has no PVC/block-storage option, so the single `storage` bucket is
  mounted at `/data` via GCS Fuse. This module's own `module_description`
  explicitly warns: *"Consider Chibisafe_GKE with a block PVC for durable
  SQLite storage in production."* GCS Fuse's POSIX file-locking semantics are
  weaker than a real filesystem, which is a real risk for a single-writer
  SQLite app under sustained write load.
- **Single instance, single writer.** `min_instance_count = max_instance_count
  = 1` by default — do not scale beyond 1 without redesigning storage.
- **Custom-build image with an app-specific version pin.** The Dockerfile is
  based on `chibisafe/chibisafe-server` (backend at `/app`), copies in the
  `chibisafe/chibisafe` Next.js front-end (`/opt/chibisafe-web`) and a static
  Caddy `2.11.4` binary, and reads its own `CHIBISAFE_VERSION` build arg (not
  the generic `APP_VERSION` the Foundation injects; one tag pins backend and
  front-end); `application_version = "latest"` is pinned to `v6.5.5` at build
  time.
- **No Redis, ever.** The module mirrors an `enable_redis` variable (default
  `true`) for Foundation-convention parity, but `main.tf` always forwards
  `enable_redis = false` to App_CloudRun regardless of its value — Chibisafe
  has no Redis dependency.
- **`enable_cloudsql_volume` is inert.** Its declared default is already
  `false`, and `main.tf` additionally hardcodes `enable_cloudsql_volume = false`
  in the call to App_CloudRun — the variable's value is ignored either way.
- **Public ingress by default.** `ingress_settings = "all"` — Chibisafe is a
  public file-upload/hosting UI browsed directly. (This module was previously
  swept up in a fleet-wide bug where copy-pasted "database workload"
  boilerplate defaulted `ingress_settings` to `"internal"`; the current source
  confirms the default here is correctly `"all"`.)
- **Admin password.** Chibisafe's first-run owner account is `admin`. With
  `enable_api_key = true` (this module's default, and required by a plan-time
  guardrail when `ingress_settings = "all"`) its password is a random
  `ADMIN_PASSWORD` from Secret Manager; otherwise it is the well-known upstream
  default `admin` — change it immediately after first login.
- **Health path is `/api/health`.** This module's `startup_probe` /
  `liveness_probe` target `/api/health` through the in-container Caddy proxy:
  a literal, unauthenticated `200 {"status":"yes"}` that proves the proxy and
  the backend are serving. `/` is the web UI, whose status code is the
  front-end's choice rather than a health signal. The separate
  `startup_probe_config` / `health_check_config` variables (now also defaulting
  to `/api/health`) are superseded for this module — see §6.
- **Uploads larger than 32 MiB need a smaller chunk size.** See §3.
- **All state lives under one mount.** The entrypoint symlinks the image's
  `/app/database`, `/app/uploads`, and `/app/logs` directories into
  subdirectories of the single GCS Fuse volume (`/data`), migrating any
  image-seeded contents on first boot.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Chibisafe service

Chibisafe runs as a single Cloud Run v2 service. Each deployment creates an
immutable revision; with `min=max=1` there is normally exactly one active
container instance.

- **Console:** Cloud Run → select the service for revisions, traffic, logs,
  and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud Storage — the persistent state volume

Chibisafe has no database service to inspect — its entire state (SQLite
database, uploaded files, and logs) lives on the single Cloud Storage bucket
mounted via GCS Fuse at `/data` (requires `execution_environment = "gen2"`).
Chibisafe_Common always provisions this `storage` bucket; additional buckets
can be declared via `storage_buckets`, and additional GCS Fuse mounts via
`gcs_volumes`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~chibisafe"
  gcloud storage ls gs://<data-bucket>/database gs://<data-bucket>/uploads gs://<data-bucket>/logs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse mount mechanics and CMEK
options.

### C. Secret Manager

Chibisafe generates **no secrets by default**. The only optional secret is a
random admin password, gated by `enable_api_key` (default `true` in this
module): when
enabled, a 24-character random value is stored in Secret Manager (name suffix
`api-key`) and injected as the `ADMIN_PASSWORD` environment variable through
the standard Cloud Run Secret Manager reference path — Chibisafe's backend
seeds its first-run admin account from this value instead of the well-known
upstream default.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~chibisafe"
  gcloud secrets versions access latest --secret=<api-key-secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details. Note
that (unlike the GKE variant) this module's `outputs.tf` does **not** surface
the generated secret's name as an output — locate it with the `gcloud secrets
list` filter above.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default
(`ingress_settings = "all"`), appropriate for a public file-upload/hosting UI.
An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud
Armor can be layered on via `enable_cloud_armor`.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are disabled by default
(`uptime_check_config.enabled = false`).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Chibisafe Application Behaviour

- **No init or migration job.** Chibisafe manages its own SQLite storage;
  `Chibisafe_Common` injects no `db-init`/migration job (`database_type =
  NONE`). The `initialization_jobs` variable is forwarded to the foundation
  but only useful for custom data-loading tasks.
- **First-boot state relocation.** The image keeps mutable state under three
  sibling directories in its WORKDIR — `/app/database` (SQLite), `/app/uploads`
  (files/thumbnails), and `/app/logs`. The entrypoint (`entrypoint.sh`)
  symlinks each of these into a subdirectory of the single GCS Fuse mount
  (`/data`), migrating any image-seeded contents into the empty volume on
  first boot. This is idempotent across restarts — already-symlinked
  directories are left alone. The same entrypoint script is shared with the
  GKE variant, which mounts a block PVC at the same path instead.
- **Admin account.** On first boot the backend creates the owner account
  `admin`. If `enable_api_key = true` (the default), a random value is
  generated and injected as `ADMIN_PASSWORD`, which the backend uses as that
  account's password instead of the well-known upstream default (`admin`);
  otherwise log in with `admin`/`admin` and change it immediately.
  `ADMIN_PASSWORD` is passed only to the backend process — the entrypoint
  strips it from the front-end's and Caddy's environment.
- **No DB env-var aliasing.** `database_type = NONE` — there is no
  `DB_HOST`/`DB_USER` injection or aliasing to worry about; SQLite lives
  entirely on the `/data` GCS Fuse volume.
- **Processes and ports.** `tini` is PID 1; the entrypoint (after the state
  relocation above) starts three processes:

  | Process | Listens on | Serves |
  |---|---|---|
  | Caddy | `0.0.0.0:$PORT` (= `container_port`, default `8000`) | The only listener Cloud Run routes to |
  | chibisafe-server backend | `127.0.0.1:18000` (loopback only) | `/api/*`, `/docs*` |
  | Next.js front-end | `127.0.0.1:18001` (loopback only) | The web UI |

  They are supervised **fail-fast**: if any one exits, the others are stopped
  and the container exits with status 1, so Cloud Run restarts it (chosen over
  supervisord, which would keep a container looking healthy with a dead
  front-end).
- **Routing** (upstream's `v6.5.5` Caddyfile, same order): any path naming a
  file under `/data/uploads` is served directly by Caddy (the backend does not
  serve uploads in production); `/api/*` → backend (the REST API — see the
  `api_url` output); `/docs*` → backend (the Scalar OpenAPI reference);
  everything else → front-end (the web UI at `/`, e.g. `/dashboard`, `/login`).
  Two deviations from upstream: the `Host` header is preserved, so the file
  links the backend builds are correct without setting "Serve uploads from";
  and `X-Forwarded-For`/`X-Real-IP` are set to the client IP Caddy resolves
  itself (Google front-end ranges trusted, strict rightmost selection), so a
  client cannot spoof them.
- **Front-end → backend.** The front-end's server-side rendering calls the
  backend directly at `BASE_API_URL=http://127.0.0.1:18000`, set by the
  entrypoint — nothing relies on Cloud Run interpolating `$(VAR)`, which it
  does not do. The browser calls the same-origin `/api`.
- **Container environment.** `NODE_ENV=production` is the only container-wide
  default; `HOST`/`HOSTNAME`/`PORT` for the two Node processes are set per
  process by the entrypoint. `PORT` is deliberately **not** injected by
  `Chibisafe_Common` because Cloud Run reserves that env var name and
  auto-sets it from `container_port` — injecting it explicitly would 400 the
  service create call. Caddy listens on that `PORT`.
- **`container_port` is live here (unlike the GKE variant).** `chibisafe.tf`
  merges `container_port = var.container_port` into the module config that
  the Foundation reads, so changing this variable actually changes the port
  Cloud Run routes to and the `PORT` value Caddy listens on. It must not be
  `18000` or `18001` (the internal ports); the container refuses to start.
- **Uploads over 32 MiB.** Cloud Run caps an HTTP/1 request body at 32 MiB,
  and Chibisafe's default upload chunk size is about 81 MB, so uploads of
  files larger than 32 MiB fail on Cloud Run until an admin lowers **Chunk
  Size** in the dashboard's settings (e.g. to 25–30 MB). This is derived from
  upstream source and Cloud Run's documented limit, not measured live.
  `Chibisafe_GKE` behind a LoadBalancer has no such cap.
- **Memory.** The default `1Gi` now holds two Node processes plus Caddy; this
  has not been measured live yet — raise `memory_limit` if revisions are
  OOM-killed.
- **Updating an existing deployment.** An UPDATE of a deployment made with
  the earlier backend-only version rebuilds the image automatically (the
  scripts directory's content hash changes), keeps port `8000`, removes the
  container-wide `HOST=0.0.0.0` env var (now set per process) and leaves the
  data on `/data` untouched. `/` changes from a 404 JSON response to the web
  UI.
- **Health path.** Both the startup and liveness probes are **HTTP** `GET
  /api/health` (this module's `startup_probe`/`liveness_probe` variables,
  default `initial_delay_seconds = 15` / `30`), sent through Caddy to the
  backend, which returns a literal 200 once serving, with no authentication
  required. See §6 for why the separate `startup_probe_config` /
  `health_check_config` variables don't actually matter here.
- **Inspect the running config:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  gcloud run revisions describe <revision-name> --region "$REGION" --project "$PROJECT" \
    --format='value(spec.containers[0].env)'
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Chibisafe are listed; every other input is
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
| `application_name` | `chibisafe` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Chibisafe` | Human-readable name shown in the Console. |
| `description` | _(set)_ | Service description. |
| `application_version` | `latest` | `chibisafe/chibisafe-server` image tag; `latest` is pinned to `v6.5.5` at build time via the app-specific `CHIBISAFE_VERSION` build arg. |
| `enable_api_key` | `true` | Generates a random 24-char value in Secret Manager, injected as `ADMIN_PASSWORD`, seeding the first-run admin credential instead of the upstream default. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | 1 vCPU default. |
| `memory_limit` | `1Gi` | 1 GiB default. Description text mentions "vector indexes"/"collections" — a copy-paste artifact from a vector-DB module; ignore the wording, the default is fine. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Keep at 1 — Chibisafe is a single-writer SQLite app on one GCS Fuse mount. |
| `container_port` | `8000` | The Caddy proxy's port. Live (see §3) — changes both the Cloud Run route and the injected `PORT` env var. Must not be `18000`/`18001`. |
| `execution_environment` | `gen2` | Required for the GCS Fuse `/data` mount. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | **Inert** — `main.tf` hardcodes `false` to the Foundation regardless of this variable's value. Chibisafe has no Cloud SQL database. |
| `container_protocol` | `http1` | Description mentions "required for Chibisafe gRPC" — another copy-paste artifact; Chibisafe has no gRPC interface. Leave at `http1`. |
| `service_annotations` / `service_labels` | `{}` | Custom Cloud Run service annotations/labels. |
| `enable_image_mirroring` | `true` | Mirror the built image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |
| `max_revisions_to_retain` | `7` | Declared for convention parity; not forwarded by this module's `main.tf`. |
| `container_image_source` / `container_image` / `container_build_config` / `container_resources` | `custom` / `""` / `{enabled=true}` / `{1000m,512Mi}` | Foundation-mirrored, inert placeholders — the actual build (Dockerfile, `CHIBISAFE_VERSION` build arg) comes from `Chibisafe_Common`'s fixed config, not these variables. |

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public by default — Chibisafe is a directly browsed file-upload UI. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `NODE_ENV=production` and `HOST=0.0.0.0` are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Maintenance

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

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` are forwarded to the
Foundation but are a no-op — Chibisafe has no SQL database (`database_type =
NONE`).

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage, Filesystem & Redis (inert)

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisions the always-present `storage` bucket. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned data bucket. |
| `enable_nfs` | `true` | Must stay `true` on Cloud Run: Chibisafe's SQLite database, uploads and logs live under `/data`, and GCS FUSE cannot host a SQLite database. |
| `nfs_mount_path` | `/data` | Mount path inside the container (only relevant if `enable_nfs` is set). |
| `gcs_volumes` | `[]` | Additional GCS Fuse volume mounts. The Chibisafe `storage` bucket is auto-added at `/data`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `enable_redis` | `true` (mirrored, **inert**) | Declared only for Foundation-convention parity — `main.tf` always forwards `enable_redis = false` to App_CloudRun regardless of this value. Chibisafe has no Redis dependency. |

### Group 12 — Database Backend (not applicable)

`database_type` is fixed to `NONE` by `Chibisafe_Common`. All other Group-12
variables — `sql_instance_name`, `sql_instance_base_name`,
`database_password_length`, `application_database_name`,
`application_database_user`, `db_password_env_var_name`,
`db_host_env_var_name`, `db_user_env_var_name`, `db_name_env_var_name`,
`db_port_env_var_name`, `service_url_env_var_name`,
`enable_mysql_plugins`/`mysql_plugins`,
`enable_postgres_extensions`/`postgres_extensions`,
`enable_auto_password_rotation`/`rotation_propagation_delay_sec` — are declared
purely for Foundation-convention mirroring and have no effect on this module.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No default job is injected; use only for custom data-loading tasks. |
| `cron_jobs` | `[]` | Recurring scheduled Cloud Run jobs; none by default. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health`, 15s initial delay | The live, effective startup probe (see §3). |
| `liveness_probe` | HTTP `/api/health`, 30s initial delay | The live, effective liveness probe. |
| `startup_probe_config` | HTTP `/api/health`, enabled | **Inert for this module** — App_CloudRun's foundation always prefers the app-specific `startup_probe` supplied via `application_config` over this standalone variable, so changing it has no effect on the deployed probe. |
| `health_check_config` | HTTP `/api/health`, enabled | Same inertness as `startup_probe_config` — `liveness_probe` (Group 14, above) is what's actually deployed. |
| `uptime_check_config` | `{ enabled=false, path="/api/health" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 23 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `organization_id` | `""` | Override for folder-nested projects. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore
the running resources.

| Output | Description |
|---|---|
| `service_url` | URL of the Chibisafe web UI (served at `/`). The same origin serves the REST API under `/api`, the OpenAPI reference at `/docs` and uploaded files by name. |
| `api_url` | Base URL of the REST API (`<service_url>/api`), for upload clients and scripts; `GET <api_url>/health` returns `200 {"status":"yes"}`. |
| `service_name` | Cloud Run service name. |
| `chibisafe_url` | Alias of `service_url` (the web UI); reachable only from the same VPC when `ingress_settings` is `internal`. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when `enable_cloud_armor` is enabled). |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `initialization_jobs` | Names of any custom initialization jobs. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

Note the absence of an output for the optional `enable_api_key` secret — unlike
`Chibisafe_GKE` (which exposes `chibisafe_api_key_secret_id`), this module does
not surface the generated secret's name; find it via `gcloud secrets list
--filter="name~chibisafe"`.

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — an out-of-range `container_port`/`timeout_seconds`/`backup_retention_days`, a `gen1` runtime combined with `gcs_volumes`, an invalid `traffic_split`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| Persistence model | GCS Fuse `/data` (this module's only option) | Critical | SQLite over GCS Fuse's POSIX file-locking semantics is not fully safe under sustained/concurrent writes. The module's own metadata explicitly recommends `Chibisafe_GKE` (block PVC) for durable production storage; use this Cloud Run variant for light/low-traffic uploaders only. |
| `max_instance_count` | `1` | Critical | Chibisafe is a single-writer SQLite app; scaling beyond 1 instance risks concurrent writers corrupting the SQLite DB on the shared GCS Fuse mount. |
| `startup_probe` / `liveness_probe` `path` | `/api/health` | Medium | `/api/health` is a literal 200 through the proxy to the backend. `/` is the web UI, whose status code is the front-end's choice, so a probe there is not a reliable health signal. |
| `container_port` | `8000` | Medium | `18000`/`18001` collide with the internal backend/front-end ports and the container refuses to start. |
| Upload chunk size | lower to 25–30 MB in the dashboard settings | Medium | Cloud Run's 32 MiB HTTP/1 request-body cap rejects Chibisafe's default ~81 MB chunks, so uploads of files over 32 MiB fail (derived from upstream source, not measured live). |
| `enable_api_key` | `true` for any deployment outside a trusted network | High | With `ingress_settings = all` (the default) and `enable_api_key = false`, the plan-time guardrail rejects the configuration; without it the `admin` account would keep the well-known upstream password `admin` until someone changes it. |
| `ingress_settings` | `all` | Medium | Confirm your working copy of this module has not regressed to `internal` — a historical fleet-wide copy-paste bug defaulted several modules' `ingress_settings` to `internal`, which would make this public file uploader completely unreachable despite passing health checks. |
| `startup_probe_config` / `health_check_config` | leave as-is; understand they're inert | Low | App_CloudRun's foundation always prefers the app-specific `startup_probe`/`liveness_probe` supplied via `application_config` over these standalone variables when both are present, so editing these two has no effect on the deployed probe. |
| `enable_cloudsql_volume` | `false` (only value that matters) | Low | `main.tf` hardcodes `false` to the Foundation regardless of what this variable is set to; Chibisafe has no Cloud SQL database. |
| `enable_redis` | any value (inert) | Low | `main.tf` always forwards `enable_redis = false` — changing this variable has no effect; do not rely on it to add Redis connectivity. |
| `memory_limit` / `min_instance_count` / `container_protocol` descriptions | ignore the wording | Low | These variables' description text references "vector indexes," "collections," "index loading," and "gRPC" — leftover copy-paste from a vector-database module template. Chibisafe is a file uploader with none of these; the numeric/string defaults themselves (`1Gi`, `1`, `http1`) are correct and unaffected. |
| `database_type` / `db_*` / `sql_instance_*` variables | `NONE` / inert | Low | Chibisafe has no SQL database; these exist only for Foundation-variable mirroring and are silently ignored. |
| `enable_api_key` secret discoverability | use `gcloud secrets list --filter="name~chibisafe"` | Low | This module's `outputs.tf` does not expose the generated secret's name as an output (unlike `Chibisafe_GKE`'s `chibisafe_api_key_secret_id`). |

---

For the foundation behaviour referenced throughout — service identity,
scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Chibisafe-specific application
configuration shared with the GKE variant lives in the `Chibisafe_Common`
module (`modules/Chibisafe_Common/README.md`); the GKE variant itself is
documented in **[Chibisafe_GKE](Chibisafe_GKE.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Chibisafe on Cloud Run](../labs/Chibisafe_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Chibisafe on GKE Autopilot](Chibisafe_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Chibisafe Common — Shared Application Configuration](Chibisafe_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Gokapi on Google Cloud Run](Gokapi_CloudRun.md), [Cloudreve on Google Cloud Run](Cloudreve_CloudRun.md) in the **File Sharing & Transfer** solution.
