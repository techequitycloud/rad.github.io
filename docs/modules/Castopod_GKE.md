---
title: "Castopod on GKE Autopilot"
description: "Configuration reference for deploying Castopod on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Castopod on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Castopod_GKE.png" alt="Castopod on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Castopod is an open-source, ActivityPub-native podcast hosting platform built on
CodeIgniter 4 (PHP 8) and served by FrankenPHP/Caddy. This module deploys Castopod on
**GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and
manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Castopod uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## What Castopod costs on RAD, and how that compares

**Castopod on RAD's GKE Autopilot module costs about US$110 a month in your own Google Cloud project, with no extra licence fee** — Castopod is open source. In a project RAD manages for you, the same deployment is metered at **99 credits a day** (about 2,970 a month, about US$297 at the top-up price). Or see the [Cloud Run guide](Castopod_CloudRun.md) for the lower-cost option. If you only need Castopod occasionally — studying, a demo, a short-lived project — a RAD-managed project can be deleted and restored within 30 days for a few credits, so that monthly figure becomes a few dollars instead. See **Pause it for free**, below.

### What you pay on RAD

Castopod is open source, so there is no licence fee. You pay for three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 110 credits (US$11 at the top-up price) | 99 credits (10% lower) |
| Build time | A few credits per build (roughly 3–6 credits) | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$110 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **99 credits a day**, about 2,970 a month (about US$297 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the
database, file server and network are shared by every application in the project, so a second
application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 1x vCPU / 2 GiB | US$39.68 |
| Cloud SQL for MySQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | shared across every GKE app in the project; $0 if this is your only cluster, else ~73 |
| **Total (excluding the shared GKE cluster fee)** | **about US$110** |

Cloud SQL and Cloud Run/GKE pod pricing is the same in africa-south1 (Johannesburg); the small VM costs about 10% more there.

- **GKE Autopilot does not scale to zero.** At least one pod always runs, so the cost above applies whether or not anyone is using the app; extra pods are added only under load.

### How it compares, for an independent podcast

Castopod's own team sells official hosting at castopod.com:

| Plan | Per month | Storage |
|---|---|---|
| Starter | €9.96 (about US$11) | 5 GB |
| Podcaster | €24 (about US$26) | more storage and bandwidth |
| Network | €96 (about US$104) | up to 500 GB, multiple shows |

(USD figures are an approximate conversion; the plans are billed in euros.) Castopod's own hosting tiers by storage and bandwidth rather than compute size, so it is not a direct like-for-like with the table above — RAD's module gives you the same open-source Castopod on infrastructure billed by actual Google Cloud usage, plus managed Cloud SQL, Secret Manager and Cloud Monitoring.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Castopod runs in **a project RAD manages for you**, deleting the whole project — rather than deleting
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

- **What a redeploy costs.** The module fee again, plus the builds: about 114 credits
  (about US$11.40) at the top-up price, and roughly 15–20 minutes of build time (RAD's
  own platform average). Deleting saves money only once Castopod would otherwise sit unused for about
  **2 days or more** — in your own project that is about US$3.67 a day, and
  in a RAD-managed one it is 99 credits a day.
- Most of the running cost here is usually the database and/or the shared file/cache VM or cluster. They stop only when nothing else in the project uses them, so deleting Castopod while another application shares the project saves only Castopod's own compute part.
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

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD fees and the daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore window and backup-bucket caveat;
[Castopod hosting](https://castopod.com/); prices change, check each source before relying on a figure.

## 1. Overview

Castopod runs as a single FrankenPHP/Caddy web workload. The deployment wires together
a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | FrankenPHP/Caddy pods on port 8080, 1 vCPU / 2 GiB by default |
| Database | Cloud SQL for MySQL 8.0 | Required — the engine is fixed at `MYSQL_8_0`; Castopod does not support PostgreSQL |
| File persistence | Cloud Filestore (NFS) | Podcast media (audio, artwork) persists on NFS mounted at Castopod's media directory, `/var/www/html/public/media` |
| Object storage | Cloud Storage | Two buckets are provisioned by default (suffixes `data` and `media`) — neither is mounted into the pod unless `gcs_volumes` is configured |
| Cache | Redis (optional) | Castopod defaults to a filesystem cache (`CP_CACHE_HANDLER = file`); Redis is opt-in |
| Secrets | Secret Manager | Auto-generated `CP_ANALYTICS_SALT`; database password |
| Ingress | Cloud Load Balancing / Gateway API | External LoadBalancer with a reserved static IP and zero-config HTTPS via an auto-issued `<ip>.nip.io` hostname |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed by the shared application
  layer (the variant passes `database_type = null`, which keeps the Common default
  `MYSQL_8_0`); other engines are not supported and break the CodeIgniter migrations.
- **Cloud SQL is reached via the Auth Proxy sidecar on loopback, but the app dials it
  over TCP.** `enable_cloudsql_volume = true` mounts a cloud-sql-proxy sidecar
  listening on `127.0.0.1:3306`, and the Common module hardcodes `DB_HOST = 127.0.0.1`
  for the service container. Because Castopod (CodeIgniter 4) reads its database
  connection from **dot-notated** `database.default.*` keys — which cannot be
  expressed as Cloud Run/K8s env var names — the platform entrypoint writes them into
  Castopod's `.env` file at container start rather than injecting them as env vars.
- **Two replicas of configuration exist for health probes — only one is effective.**
  Castopod's app-specific `startup_probe`/`liveness_probe` variables (Group 10) always
  win; the generic `health_check_config`/`startup_probe_config` variables inherited
  from App_GKE are forwarded but structurally overridden by the Common module's own
  probe config, so they have no effect for this application.
- **Single replica by default.** `min_instance_count = 1`, `max_instance_count = 1`.
  The NFS-backed workload deploys with the `Recreate` strategy, so do not scale beyond
  1 without verifying shared-storage behaviour for media uploads and the object cache.
- **NFS is enabled by default** (`enable_nfs = true`, mounted at `/var/www/html/public/media`) so
  uploaded episode audio and artwork persist across pod restarts and are shared across
  replicas — Castopod stores media on the filesystem, not in the database.
- **Session affinity is `ClientIP`** so a client's requests reach the same pod.
- **Zero-config HTTPS is on by default.** `enable_custom_domain = true` and
  `reserve_static_ip = true` are both defaults; with `application_domains` left empty,
  App_GKE provisions a Gateway and derives a free `<ip>.nip.io` hostname with a
  Google-managed certificate — no DNS setup required to reach Castopod over HTTPS.
- **`CP_ANALYTICS_SALT` is generated automatically** and stored in Secret Manager. It
  anonymises podcast listener analytics and must stay stable after first boot.
- **No separate migration job — but migrations are not automatic in the base image
  either.** The `castopod/castopod` image (built on `serversideup/php`) has no
  CodeIgniter migration hook of its own; its only built-in automatic migration
  behaviour is Laravel-specific (`php artisan migrate`, gated behind
  `AUTORUN_ENABLED`, default `false`). The platform wrapper entrypoint
  (`Castopod_Common/scripts/entrypoint.sh`) explicitly runs `php spark migrate --all`
  on every container start, so the schema is created on first boot once the `db-init`
  job has provisioned the database and user.
- **First-run setup is manual.** After deploy, open the service URL and complete
  Castopod's web install wizard to create the first super-admin account and configure
  the instance/podcast defaults.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Castopod workload

Castopod pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Because the workload is NFS-backed, the Deployment uses the
`Recreate` strategy (a rolling update would run two pods against the same NFS-backed
media directory and shared DB and deadlock).

- **Console:** Kubernetes Engine → Workloads → select the Castopod workload for pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector="app~castopod" 2>/dev/null || kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for MySQL 8.0

Castopod stores all application data (podcasts, episodes, users, analytics) in a
managed Cloud SQL for MySQL 8.0 instance. Pods reach it through the **Cloud SQL Auth
Proxy** sidecar on `127.0.0.1:3306`; no public IP is exposed. On first deploy the
`db-init` job creates the application database, user, and grants; the CodeIgniter
migrations then create the schema on the app container's first boot.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~castopod"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and the Secret Manager secret holding the password
are all in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the connection
model, automated backups, and password rotation.

### C. Cloud Storage & file persistence

**Two Cloud Storage buckets** are provisioned automatically by default — a generic
`data` bucket (the App_GKE foundation default) and a Castopod-specific `media` bucket
declared by `Castopod_Common`. Neither is mounted into the pod filesystem unless
`gcs_volumes` is explicitly configured; instead, Castopod's actual media directory
(`/var/www/html/public/media`) is itself the **NFS (Cloud Filestore)** mount. A fresh
share mounts empty, so the entrypoint re-seeds the media tree (`persons/`, `podcasts/`,
`site/`) and hands it to `www-data` on every start.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~castopod"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Redis (optional object cache)

Redis is **disabled by default** — Castopod uses a filesystem cache
(`CP_CACHE_HANDLER = file`). When `enable_redis = true`, the module injects
`REDIS_HOST`/`REDIS_PORT` for Castopod's object cache; if `redis_host` is left empty,
the foundation resolves it to the NFS server VM's IP (requires `enable_nfs = true`).

- **Console:** Memorystore → Redis (if using a managed instance instead of the
  NFS-colocated Redis).
- **CLI:**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### E. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager:
`CP_ANALYTICS_SALT` (used to anonymise podcast listener analytics). The database
password is managed separately by the foundation. On GKE, secrets are projected into
pods via the Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~analytics-salt"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`, `reserve_static_ip = true`). Because
`enable_custom_domain = true` by default, App_GKE additionally provisions a Gateway
and — when `application_domains` is left empty — a zero-config `<ip>.nip.io` hostname
with a Google-managed certificate, so Castopod is reachable over HTTPS immediately
without owning a domain. A real custom domain can be supplied instead.

- **Console:** Network services → Load balancing / Gateways; VPC network → IP
  addresses.
- **CLI:**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Castopod Application Behaviour

- **First-deploy database setup.** The `db-init` job runs `db-init.sh` using
  `mysql:8.0-debian`. It connects to Cloud SQL (Unix socket under `/cloudsql` via the
  Auth Proxy sidecar, falling back to private-IP TCP), idempotently creates the
  application database, user, and grants, verifies the app user can connect, then
  shuts down the proxy sidecar. The job is safe to re-run (`execute_on_apply = true`,
  `max_retries = 3`).
- **Migrations run on container start (no separate migration job) — via the platform
  entrypoint, not the base image.** The `castopod/castopod` image (built on
  `serversideup/php`) has no CodeIgniter migration hook of its own; its only automatic
  migration behaviour is Laravel-specific (`php artisan migrate`, gated behind
  `AUTORUN_ENABLED`, default `false`) and would not run CI4's `spark migrate` even if
  enabled. The platform wrapper entrypoint (`Castopod_Common/scripts/entrypoint.sh`)
  explicitly runs `php spark migrate --all` — idempotent, safe on every boot — once
  `.env`/DB connectivity is written, so the schema is created on first boot once
  `db-init` has provisioned the database and user, and upgrading `application_version`
  applies schema changes on the next start, without a separate job. If this explicit
  call is ever removed, every request 500s with `Table '...' doesn't exist` even
  though `db-init` succeeded — check `entrypoint.sh` first when debugging that
  symptom.
- **Database config lives in `.env`, materialised at container start.** Castopod
  (CodeIgniter 4) reads its default connection from framework-native, dot-notated keys
  (`database.default.hostname|database|username|password|port|DBDriver|DBPrefix`) that
  cannot be expressed as Kubernetes env var names. The platform wrapper entrypoint
  writes them into Castopod's `.env` from the foundation-injected `DB_HOST` (which on
  GKE is `127.0.0.1`, the Auth Proxy sidecar) and `DB_NAME`/`DB_USER`/`DB_PASSWORD`,
  then delegates to the upstream FrankenPHP/Caddy entrypoint.
- **`CP_BASEURL` is derived automatically.** When not explicitly set, the entrypoint
  derives it from the foundation-injected `GKE_SERVICE_URL` and writes it as
  `app.baseURL` in `.env`, so podcast feed and media links reflect the real service
  address (including the auto-issued nip.io hostname).
- **`CP_ANALYTICS_SALT` should be stable after first boot.** It is generated once and
  written to Secret Manager; changing it breaks de-duplication continuity for
  previously recorded analytics, though it does not corrupt existing rows.
- **NFS-backed rollouts use `Recreate`.** Updates terminate the old pod before starting
  the new one, avoiding two pods deadlocking on the shared NFS-backed media directory
  and DB locks.
- **Health path.** The startup probe is **TCP** on the container port with a 30-second
  initial delay and a 20-retry window (`period_seconds = 15`), giving first-boot
  CodeIgniter migrations ample time to complete. The liveness probe is **HTTP
  `GET /`** with a 300-second (5-minute) initial delay — Castopod's unauthenticated
  homepage returns 200 once booted and connected to MySQL.
- **First-run setup.** After deploy, open the service URL and complete Castopod's web
  install wizard to create the first super-admin account and set the instance name and
  podcast defaults. Media uploads then persist to the NFS-backed media directory.
- **Inspect the init job and running config:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- cat /var/www/html/.env
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform (by their
`{{UIMeta group=N}}` tag, which does not always match the section headings in the
source file). Only settings specific to or notable for Castopod are listed; every
other input is inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `castopod` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `castopod/castopod` image tag used as the custom-build base; `latest` is pinned to a known-good tag (`1.15.5`) at build time via the app-specific `CASTOPOD_VERSION` build ARG. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU per Castopod container instance. |
| `memory_limit` | `2Gi` | Minimum ~512Mi to boot; 2Gi recommended for large media libraries. |
| `min_instance_count` | `1` | Keep at 1 to keep the workload reachable. |
| `max_instance_count` | `1` | **Keep at 1** unless shared NFS/cache behaviour is verified for multiple pods. |
| `container_port` | `8080` | Castopod's FrankenPHP/Caddy server listens on 8080. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar (loopback) — required on GKE. |
| `php_memory_limit` | `512M` | PHP memory limit; raise for memory-intensive plugins. |
| `upload_max_filesize` / `post_max_size` | `64M` | Max upload / POST size; keep `post_max_size ≥ upload_max_filesize` for episode audio uploads. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the Castopod UI and public podcast feeds. |
| `workload_type` | `null` → `Deployment` | Deployment (NFS-backed, `Recreate` strategy). |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, 30s delay, 20 retries | Effective startup probe — supersedes the generic `startup_probe_config`, which is forwarded but overridden and has no effect. |
| `liveness_probe` | HTTP `/`, 300s delay | Effective liveness probe against Castopod's unauthenticated homepage — supersedes the generic `health_check_config`. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS is on by default so uploaded episode audio/artwork persist and are shared. |
| `nfs_mount_path` | `/var/www/html/public/media` | Where Castopod's shared media state is mounted. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Switches Castopod's object cache from the filesystem to Redis. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` | Keeps the Common MySQL 8.0 default; Castopod does not support other engines. |
| `application_database_name` | `castopod` | Database name. Immutable after first deploy. |
| `application_database_user` | `castopod` | Application database user; password auto-generated in Secret Manager. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisions a Gateway; with `application_domains` empty, yields a zero-config `<ip>.nip.io` HTTPS hostname. |
| `application_domains` | `[]` | Set to use a real custom hostname + managed certificate instead of the nip.io fallback. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys — required for the nip.io hostname to stay constant. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Castopod. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (`data` and `media`). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup (`db-init`) and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD GitHub details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `StatefulSet` forced alongside a stateless setting, IAP with no authorized identities, `quota_memory_*` given as bare integers, an out-of-range `container_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critical | Selecting a non-MySQL engine breaks the CodeIgniter migrations and every DB-backed route. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all podcast data. |
| `enable_nfs` | `true` | Critical | With NFS off, uploaded episode audio and artwork live on ephemeral disk and are lost on every pod restart/redeploy. |
| `CP_ANALYTICS_SALT` (auto-generated) | Never change | High | Changing it after first boot breaks listener de-duplication continuity for previously recorded analytics. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar on `127.0.0.1:3306` is required for DB connectivity on GKE. |
| `max_instance_count` | `1` | High | Scaling beyond 1 without verified shared-storage/cache behaviour risks inconsistent media state and duplicated analytics. |
| `session_affinity` | `ClientIP` | High | Without stickiness, requests bounce between pods and disrupt authenticated admin sessions. |
| `memory_limit` | `2Gi` | High | Below ~512Mi the PHP/FrankenPHP pod fails to boot; large media libraries need more headroom. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `reserve_static_ip` | `true` | Medium | Without it, both the external IP and any auto-derived nip.io hostname can change across redeploys, breaking bookmarked/RSS feed URLs. |
| `enable_custom_domain` + empty `application_domains` | Fine as default (nip.io) | Low | Produces a working but non-branded `<ip>.nip.io` URL; set `application_domains` for a real hostname. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Castopod-specific application configuration shared with the Cloud Run variant is
described in **[Castopod_Common](Castopod_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Castopod on GKE Autopilot](../labs/Castopod_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Castopod on Google Cloud Run](Castopod_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Castopod Common — Shared Application Configuration](Castopod_Common.md) — the configuration shared by both deployment targets.
