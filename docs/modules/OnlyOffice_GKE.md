---
title: "OnlyOffice on GKE Autopilot"
description: "Configuration reference for deploying OnlyOffice on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# OnlyOffice on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OnlyOffice_GKE.png" alt="OnlyOffice on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

ONLYOFFICE Document Server is an open-source collaborative online office suite for
real-time co-editing of text documents, spreadsheets, presentations, PDFs, and forms —
a self-hosted alternative to Google Docs / Microsoft Office Online. It is not usually
opened directly by end users; instead it is embedded by a host application (Nextcloud,
ownCloud, Seafile, or a custom integration) via its API and a shared JWT secret. This
module deploys OnlyOffice on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services OnlyOffice uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## What OnlyOffice costs on RAD, and how that compares

**OnlyOffice on RAD's GKE Autopilot module costs about US$150–223 a month, with the module fee charged once in RAD credits.** GKE Autopilot suits OnlyOffice that must stay up, scale across pods or run beside other Kubernetes workloads; for the lowest cost, the [Cloud Run module](OnlyOffice_CloudRun.md) runs the same OnlyOffice for about US$102 a month. If you only need it occasionally — a demo, a seasonal project, something you're evaluating — a RAD-managed project can be deleted and restored within 30 days for a handful of credits (under US$1) instead of paying for it to sit idle. See **Pause it for free**, below. Figures are as at 8 October 2026; sources are listed at the end of this section.

### What you pay on RAD

RAD deploys **OnlyOffice**, which is open source, so there is no licence fee per user. You pay for
three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 300 credits (US$30 at the top-up price) | 270 credits (10% lower) |
| Build time | About 3-6 credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$150 a month** for the default configuration (table below) — more if this isn't your only Autopilot cluster | Metered hourly in credits; RAD publishes **112 credits a day**, about 3,360 a month (about US$336 at the top-up price, US$269 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second set of them.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 2x vCPU / 4 GiB | US$79.35 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | shared across every GKE app in the project; $0 if this is your only cluster, else ~73 |
| **Total** | **about US$150** (about US$223 if this isn't your only Autopilot cluster) |

### How it compares

| Option | Price | Who runs it |
|---|---|---|
| ONLYOFFICE DocSpace, Startup | Free | ONLYOFFICE's own hosted cloud. Up to 3 admins, 2 GB storage, unlimited free users |
| ONLYOFFICE DocSpace, Business | $20/admin/month | ONLYOFFICE's own hosted cloud. 250 GB per admin, unlimited rooms |
| **RAD, Cloud Run, your own project** | **About US$102**, plus US$11 once per deployment | RAD's automation, in your project |
| **RAD, Cloud Run, a RAD-managed project** | **About 960 credits (US$77–96)** | RAD |
| RAD, GKE Autopilot | See the [GKE guide](OnlyOffice_GKE.md) | RAD |

ONLYOFFICE's own DocSpace is priced per **admin**, not per editing user, which is the fairer comparison to RAD's flat infrastructure cost. For a small team that needs only one or two admins, DocSpace's free Startup tier or its $20/month Business plan can be cheaper in cash than RAD's own-project running cost — the difference is that this module deploys the Document Server **you embed into your own application**, rather than ONLYOFFICE's bundled workspace, which matters if you're already running a document platform (Nextcloud, ownCloud, a custom app) that only needs the editing engine.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If OnlyOffice runs in **a project RAD manages for you**, you have a second option that goes well
beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to
nothing.** This suits OnlyOffice you only need occasionally — a demo, an evaluation, a seasonal
project — far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google to
  delete the project. Google does not remove the project immediately: it keeps it, recoverable,
  for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike
  deleting one module, this does not tear down the database, the VM, the cluster or the compute resource
  one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a few credits, not a rebuild.** Within 30 days, the project's owner can restore
  it. RAD asks Google to undelete the project and reattaches its billing account, then asks you to
  run **Update** on each deployment to confirm everything came back. Because nothing was
  individually destroyed, that Update finds the same resources already there — it is a check, not a
  rebuild, and an Update never charges the module fee again. That costs roughly a handful of credits (under US$1) in
  total for a typical 2-3-deployment chain.
- **So a month of occasional use can cost a few dollars, not US$150.** Deploy OnlyOffice, use
  it for a while, delete the project. Restore it next time you want it, confirm with Update, and
  delete it again when you're done. You pay only for the module fee once, the builds, and whatever
  time OnlyOffice was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages billing
  for), and you restore it yourself within the 30 days — after that, Google deletes it for good.
  Restoring is admitted like creating a new project: your purchased credit balance must still clear
  the tier's floor (100 credits for the sandbox tier most study and demo use fits). Google says most
  services are fully working again within 36 hours of a restore.
- **One real gap: nightly backups don't survive.** Backups are written to a bucket inside the
  project, and that bucket is **not** protected by Cloud Storage's soft-delete, so it is very likely
  gone as soon as you delete the project — even though the project itself is recoverable for 30
  days. If you've customised OnlyOffice and want to keep that work, copy a backup out (to Google Drive,
  or a bucket outside the project) before you delete. For a default installation with nothing
  irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

The option above only applies to a RAD-managed project; **in your own project, or once the 30-day
window has passed, the way to stop paying is to delete the deployment and deploy it again when you
need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 305
  credits (US$30.50) in your own project, or 275
  credits in a RAD-managed one. Deleting saves money once OnlyOffice would otherwise sit unused for
  about 6 days or more in your own project (about US$4.99 a
  day), or about 2 days or more in a RAD-managed one (112 credits a
  day).
- **Most of the running cost is usually the database and any shared file/cache VM.** They stop only
  when nothing else in the project uses them, so deleting OnlyOffice while something else shares the
  project saves only this app's own compute part.
- **Keep your data first.** Nightly backups go to a bucket inside the deployment and are deleted
  with it, so copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  OnlyOffice in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs OnlyOffice for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing
  pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands
  the project over and the deployments become the client's own.
- Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by
  card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the 30-day recovery window and what it says about Cloud Storage objects without soft delete; RAD fees and the daily-credit estimates from [radmodules.dev/pricing](https://radmodules.dev/pricing); [ONLYOFFICE DocSpace pricing](https://www.onlyoffice.com/docspace-prices.aspx). Prices change; check each source before relying on a figure.

## 1. Overview

The `onlyoffice/documentserver` image is "batteries included": it bundles its own
converters, nginx, and RabbitMQ (AMQP) under `supervisord`. This module externalizes
PostgreSQL (Cloud SQL) and Redis; the bundled RabbitMQ stays internal on localhost.

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | StatefulSet pods on port 80, 2 vCPU / 4Gi memory by default |
| Database | Cloud SQL for PostgreSQL 15 | Required — only `POSTGRES_13`/`14`/`15` (or `NONE`) pass a plan-time guard |
| Cache / editing state | External Redis | Mandatory — the bundled RabbitMQ stays internal, but session/editing state must be shared via an **external** Redis; defaults to the co-located NFS-VM Redis when `redis_host` is blank |
| Block storage | GKE Persistent Disk (`standard-rwo`) | 20Gi PVC per pod at `/var/www/onlyoffice/Data` — the Document Server's cache/index data, which gcsfuse would corrupt |
| File persistence | Cloud Filestore (NFS) | Attachment/document storage shared across pods at `/opt/onlyoffice/storage` |
| Object storage | Cloud Storage | Declared (`storage` suffix) but **not created by default** (`create_cloud_storage = false`) — persistence lives on the block PVC |
| Secrets | Secret Manager | Auto-generated `JWT_SECRET` (48 characters); database password managed separately |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; custom domain + managed certificate enabled by default |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is required.** `database_type` defaults to `POSTGRES_15`; a
  plan-time guard rejects anything other than `POSTGRES_13`/`14`/`15`/`NONE` — MySQL
  is not supported.
- **Redis is mandatory, not optional.** A plan-time precondition fails the deployment
  if `enable_redis = false`. With `redis_host` left blank, `enable_nfs` must stay
  `true` so the NFS server IP can serve as the default Redis host.
- **Data lives on a block PVC, not gcsfuse.** `stateful_pvc_enabled = true` by
  default provisions a 20Gi `standard-rwo` (SSD) PVC per pod mounted at
  `/var/www/onlyoffice/Data` and auto-selects `workload_type = "StatefulSet"` —
  Document Server's caches/indexes under that path would corrupt on gcsfuse.
  `create_cloud_storage` is correspondingly `false`. NFS is enabled by default
  (`enable_nfs = true`, mounted at `/opt/onlyoffice/storage`) for shared attachment
  storage, and doubles as the fallback Redis host.
- **Cloud SQL is reached via the Auth Proxy sidecar on loopback.** A cloud-sql-proxy
  sidecar (`enable_cloudsql_volume = true`) listens on `127.0.0.1:5432`; the
  wrapper `cloud-entrypoint.sh` maps the injected `DB_*` values onto Document
  Server's own variable names (`DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER` already
  match; `DB_PWD` is set from `DB_PASSWORD`).
- **JWT signing is on by default.** `JWT_ENABLED = "true"` with a 48-character
  `JWT_SECRET` generated once and stored in Secret Manager — any host application
  embedding the editor must present the same secret.
- **`"latest"` is pinned at build time.** The custom build derives its base tag from
  an app-specific `ONLYOFFICE_VERSION` build ARG (not the Foundation-injected
  `APP_VERSION`, which the Dockerfile does not use); `application_version = "latest"`
  maps to `8.3.3`.
- **Scaling defaults to `min=1`, `max=5`**, `session_affinity = "ClientIP"`. Each
  StatefulSet pod has its own independent PVC — editing/session state is shared
  through Postgres and Redis, not the PVC.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the OnlyOffice workload

OnlyOffice pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Because `stateful_pvc_enabled = true` by default, the workload is a
**StatefulSet** with a 20Gi block PVC per pod.

- **Console:** Kubernetes Engine → Workloads → select the OnlyOffice workload for
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

OnlyOffice stores document metadata, versions, and application state in a managed
Cloud SQL for PostgreSQL 15 instance. Pods reach it through the **Cloud SQL Auth
Proxy** sidecar on `127.0.0.1:5432`; no public IP is exposed. On first deploy the
`db-init` job creates the application role, database, and grants — the Document
Server then installs its own schema on first boot.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and the Secret Manager secret holding the
password are all in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the
connection model, automated backups, and password rotation.

### C. External Redis, block storage (PVC) & Cloud Filestore (NFS)

Redis holds session/editing state that must be shared across every OnlyOffice
replica — the bundled RabbitMQ stays internal, but Redis is externalized and
**mandatory** (a plan-time guard fails the deployment if `enable_redis = false`).
With `redis_host` left blank, the Foundation injects the co-located NFS-VM Redis
IP (`enable_nfs` must stay `true` in that case); set `redis_host` explicitly to
point at a different Redis instance. Two distinct persistence layers are wired in
alongside it: a per-pod **block PVC** (`standard-rwo`, 20Gi by default) mounted at
`/var/www/onlyoffice/Data` for caches/indexes/fonts (a real block device — gcsfuse
would corrupt it), and **Cloud Filestore (NFS)** mounted at
`/opt/onlyoffice/storage`, shared across all pods for attachment/document storage.

- **Console:** Compute Engine → VM instances (the NFS/Redis co-located VM);
  Kubernetes Engine → Storage (PVC/StorageClass); Filestore → Instances.
- **CLI:**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep REDIS_SERVER
  kubectl get pvc,sc -n "$NAMESPACE"
  gcloud filestore instances list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for how `enable_redis`/`redis_host` resolve to the
NFS-VM IP, and the GKE SSD-vs-HDD `stateful_pvc_storage_class` trade-off.

### D. Cloud Storage (optional)

A `storage` bucket is declared by `OnlyOffice_Common` but **not created** unless
`create_cloud_storage = true` is set explicitly — by default all persistence lives
on the block PVC and NFS above, not GCS.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~onlyoffice"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### E. Secret Manager

One OnlyOffice-specific secret is generated automatically and stored in Secret
Manager: **`JWT_SECRET`** (48 characters, no special characters), which signs every
internal Document Server API request and must be presented by any host application
that embeds the editor. The database password is managed separately by the
foundation. On GKE, secrets are projected into pods via the Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~onlyoffice-jwt-secret"
  gcloud secrets versions access latest --secret=<jwt-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`, `reserve_static_ip = true` so the address survives
redeploys), with `enable_custom_domain = true` allowing a Google-managed certificate
once `application_domains` is populated.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
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

## 3. OnlyOffice Application Behaviour

- **First-deploy database setup, no separate migration job.** The `db-init` job runs
  using `postgres:15-alpine`. It resolves the Cloud SQL host (proxy sidecar on
  `127.0.0.1`, falling back to the instance private IP), waits for PostgreSQL to be
  reachable, creates/updates the application role (`LOGIN CREATEDB`) with the
  generated password, creates the application database (owned by `postgres`, since
  the Cloud SQL superuser cannot `SET ROLE` to application roles), grants full
  privileges on the database and `public` schema, then signals the Auth Proxy to
  shut down so the Job pod completes. It only provisions the role/database/grants —
  the Document Server installs its own schema on first boot. The job is safe to
  re-run (`execute_on_apply = true`).
- **JWT secret usage.** `JWT_ENABLED = "true"`, `JWT_HEADER = "Authorization"`,
  `JWT_IN_BODY = "true"` are set by `OnlyOffice_Common`; the `JWT_SECRET` value
  itself is injected from Secret Manager (generated once, 48 characters). Every
  internal Document Server API call is signed with it, and any host application
  embedding the editor (Nextcloud, ownCloud, custom integration) must be configured
  with the identical secret — never rotate it after integrations are wired up.
- **DB and Redis env-var mapping.** `cloud-entrypoint.sh` runs before the upstream
  launcher: it sets `DB_TYPE=postgres` and `DB_PWD` from the injected `DB_PASSWORD`
  (`DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER` already match Document Server's own
  names), and maps `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` onto
  `REDIS_SERVER_HOST`/`REDIS_SERVER_PORT`/`REDIS_SERVER_PASS` before `exec`-ing
  `/app/ds/run-document-server.sh`.
- **Health path.** Startup probe is **HTTP** `GET /healthcheck` (90s initial delay,
  15s period, up to 40 failures — roughly 10 minutes of first-boot headroom while
  the bundled stack comes up and the schema installs). Liveness probe is the same
  path with a 120s delay / 30s period / 3 failures. `/healthcheck` returns `true`
  only once nginx and the document services are up and the database is reachable,
  and is served unauthenticated.
- **Scaling constraints.** `min_instance_count = 1`, `max_instance_count = 5` by
  default; `session_affinity = "ClientIP"`. Each StatefulSet pod has its own
  independent block PVC — replicas do not share the PVC, so scaling out is safe as
  long as Postgres and Redis (the shared state) are reachable by every pod.
- **Inspect the init job and running config:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep -E 'DB_|REDIS_SERVER|JWT_'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear in `variables.tf` (`{{UIMeta
group=N}}`). Only settings specific to or notable for OnlyOffice are listed; every
other input is inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `onlyoffice` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `onlyoffice/documentserver` image tag; `latest` is pinned to `8.3.3` at build time via the `ONLYOFFICE_VERSION` build ARG. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_port` | `80` | The bundled nginx listens on port 80. |
| `container_resources` | `{cpu_limit="2000m", memory_limit="4Gi"}` | The bundled stack (Postgres client/Redis client/RabbitMQ/nginx/converters under `supervisord`) needs at least 4Gi. |
| `min_instance_count` / `max_instance_count` | `1` / `5` | Pod replica bounds. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar (loopback `127.0.0.1:5432`) — required on GKE. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the OnlyOffice UI/API. |
| `workload_type` | `null` → `StatefulSet` | Auto-selected because `stateful_pvc_enabled = true`. |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod during a session. |

### Group 7 — StatefulSet Configuration

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Document Server's cache/index data must live on a block PVC — gcsfuse would corrupt it. Auto-selects `workload_type = "StatefulSet"`. |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC size. |
| `stateful_pvc_mount_path` | `/var/www/onlyoffice/Data` | The Document Server data directory. |
| `stateful_pvc_storage_class` | `standard-rwo` | SSD-backed by default; override to `standard` (HDD) if the project's `SSD_TOTAL_GB` quota is tight. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthcheck`, 90s delay, 15s period, 40 failures | Generous first-boot budget — the bundled stack is slow to become ready. |
| `liveness_probe` | HTTP `/healthcheck`, 120s delay, 30s period, 3 failures | Restarts a wedged pod after boot. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared attachment storage; also the default Redis host source when `redis_host` is blank. |
| `nfs_mount_path` | `/opt/onlyoffice/storage` | Where OnlyOffice stores shared attachments. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `false` | Off by default — persistence lives on the block PVC and NFS, not GCS. Set `true` only if you need an additional plain bucket. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Required** — a plan-time guard rejects `false`. |
| `redis_host` | `""` (→ NFS server IP) | Leave blank to use the co-located NFS-VM Redis; `enable_nfs` must be `true` in that case. |
| `redis_port` | `6379` | Redis TCP port. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Required — a plan-time guard rejects anything but `POSTGRES_13`/`14`/`15`/`NONE`. MySQL is not supported. |
| `application_database_name` | `onlyoffice` | Database name. Immutable after first deploy. |
| `application_database_user` | `onlyoffice` | Application database user; password auto-generated in Secret Manager. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisions a Kubernetes Ingress for custom domain routing (enabled by default, unlike most apps). |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `application_domains` | `[]` | Custom hostnames + managed certificate. |
| `network_tags` | `["nfsserver"]` | Required tag for the default NFS/Redis co-location path. |

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
| `service_url` | URL to reach OnlyOffice. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (empty unless `create_cloud_storage = true`). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `StatefulSet` forced alongside a stateless setting, IAP with no authorized identities, `quota_memory_*` given as bare integers, an out-of-range `container_port`/`backup_retention_days`. OnlyOffice additionally layers its own guards (PostgreSQL-only `database_type`, mandatory `enable_redis`, `redis_host`/`enable_nfs` coupling). Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (or 13/14) | Critical | Any other engine is rejected at plan time — MySQL is not supported by Document Server. |
| `enable_redis` | `true` | Critical | A plan-time guard rejects `false` — without shared Redis, session/editing state cannot be coordinated across pods. |
| `redis_host` / `enable_nfs` | Leave `redis_host` blank only with `enable_nfs = true` | Critical | Blank `redis_host` with `enable_nfs = false` fails at plan time — there is no Redis host to resolve. |
| `JWT_SECRET` (auto-generated) | Never change after integrations exist | Critical | Rotating it breaks every host application (Nextcloud/ownCloud/etc.) embedding the editor until all are updated with the new value. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all data. |
| `stateful_pvc_enabled` | `true` | High | Disabling it (or forcing `workload_type = "Deployment"` alongside it) risks gcsfuse-corrupted cache/index data — or fails at plan time if forced. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) or `standard` (HDD) under tight quota | Medium | SSD draws the tight `SSD_TOTAL_GB` quota; a wide campaign of stateful apps can exhaust it — see [App_GKE](App_GKE.md). |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar on `127.0.0.1:5432` is required for DB connectivity on GKE. |
| `container_resources.memory_limit` | `4Gi` | High | The bundled Postgres/Redis-client/RabbitMQ/nginx/converter stack under `supervisord` is heavy; undersizing risks OOM during startup. |
| `max_instance_count` | `5` (tune to load) | Medium | Each pod's converter workload is CPU/memory intensive; scaling too high without headroom risks node pressure under Autopilot. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and any registered integration callback URL. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

{/* TODO: verify whether enable_custom_domain=true with an empty application_domains list falls back to a nip.io hostname on the reserved LoadBalancer IP, or leaves the Ingress unconfigured until a domain is set. */}

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
OnlyOffice-specific application configuration shared with the Cloud Run variant is
described in **[OnlyOffice_Common](OnlyOffice_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: OnlyOffice on GKE Autopilot](../labs/OnlyOffice_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [OnlyOffice on Google Cloud Run](OnlyOffice_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [OnlyOffice Common — Shared Application Configuration](OnlyOffice_Common.md) — the configuration shared by both deployment targets.
