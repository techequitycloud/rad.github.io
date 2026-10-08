---
title: "AFFiNE on GKE Autopilot"
description: "Configuration reference for deploying AFFiNE on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# AFFiNE on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Affine_GKE.png" alt="AFFiNE on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

AFFiNE is an open-source, privacy-first knowledge base that unifies docs,
whiteboards, and databases in one workspace — a self-hostable alternative to
Notion and Miro. This module deploys AFFiNE on **GKE Autopilot** as a thin
wrapper on top of the [App_GKE](App_GKE.md) foundation, which provisions and
manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services AFFiNE uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## What AFFiNE costs on RAD, and how that compares

**AFFiNE on RAD's GKE Autopilot module costs about US$150 a month in a project you own, with no licence fee for the software itself.** RAD charges a one-off module fee of 300 credits (US$30 at the top-up price) in a project you own, and 270 credits (10% lower) in a project RAD manages. GKE suits AFFiNE that must stay up continuously or scale across pods; for the lowest cost, the [Cloud Run module](Affine_CloudRun.md) runs the same AFFiNE for about US$181 a month. Figures are as at 8 October 2026; sources are listed at the end of this section.

If you only need it occasionally — studying for a certification, a demo, a seasonal need — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that about US$150 a month becomes close to nothing instead. See **Pause it for free**, below.

### What you pay on RAD

You pay for three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 300 credits (US$30 at the top-up price) | 270 credits (10% lower) |
| Build time | A few credits, metered per minute of build time | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about US$150 a month for the default configuration (table below) | Metered hourly in credits; RAD publishes **111 credits a day**, about 3,330 a month (about US$333 at the top-up price, US$266 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database and file/cache server are shared by every application in the project, so a second application does not add a second one.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 2x vCPU / 4 GiB | US$79.35 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | US$0 if this is your only Autopilot/zonal cluster on the billing account, otherwise about US$73 (shared across every GKE app in the project) |
| **Total** | **about US$150** |

### How it compares

- Notion, the incumbent AFFiNE is built to replace, charges **£8.50/member/month** on its Plus plan and **£16.50/member/month** on Business — a per-seat licence that keeps growing with headcount, against AFFiNE's flat infrastructure cost here.
- **RAD runs the open-source project itself, not a vendor's hosted tenancy.** You get the same software, under your own (or RAD's) infrastructure, instead of a per-seat or per-usage subscription that grows independently of what you actually use.
- **Against a bare self-managed server:** Running the same open-source software yourself, a Hetzner CPX22 (2 vCPU/4 GB, about $24/month) or a DigitalOcean 2 vCPU/4 GB Droplet (also $24/month) is roughly the same shape; a GCP Compute Engine e2-standard-2 (2 vCPU/8 GB) runs about $49/month. RAD is not cheaper than that in cash terms — the difference is the managed database, Secret Manager and monitoring that come with the module instead of being your own job.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If AFFiNE runs in **a project RAD manages for you**, you have an option that goes well beyond
scaling to zero: **delete the whole project, and restore it within 30 days for close to
nothing.** This suits occasional use — studying for a certification, a demo, a seasonal
need — far better than running AFFiNE continuously.

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
- **One real gap: backups do not survive.** Anything AFFiNE writes to a backup bucket inside the
  project is very likely gone as soon as you delete the project, even though the project itself
  is recoverable for 30 days — that bucket has Cloud Storage's soft-delete explicitly turned
  off. Anyone who has customised the deployment and wants to keep that work should copy a
  backup out (to Google Drive, or a bucket outside the project) before deleting. For a default
  install with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

This is the fallback for a project you own, or once the 30-day restore window above has
passed: **delete the deployment, and deploy it again when you next need it.**

- **What a redeploy costs.** The module fee again, plus the builds: roughly
  305 credits (about US$30.50) in your own project, or
  275 credits in a RAD-managed one, because RAD rebuilds the resources
  from scratch. Deleting saves money once AFFiNE would otherwise sit unused long enough to clear that redeploy cost against its own running cost — roughly 6 days or more in your own project (US$4.99/day) or 2 days or more in a RAD-managed one (111 credits/day).
- **Most of the running cost is usually shared infrastructure.** The database and file or cache VM stop only when nothing else in the project uses them, so deleting AFFiNE while another application shares the project saves only AFFiNE's own compute part.
- **Keep your data first.** Anything AFFiNE writes to a backup bucket inside the deployment is
  deleted with it — copy the latest backup out (to Google Drive, or a bucket you keep) before
  deleting if you want to keep it.
- **RAD does not recreate a deleted deployment for you.** You enter the settings again when
  you redeploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  AFFiNE in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs AFFiNE for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's fees and daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics; [Notion pricing](https://www.notion.com/pricing). Prices change; check each source before relying on a figure.

## 1. Overview

AFFiNE runs as a single Node.js self-host server. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js server pod on port 3010, 2 vCPU / 4 GiB by default |
| Database | Cloud SQL for PostgreSQL 15 | Required — the engine is fixed at `POSTGRES_15` |
| Real-time collaboration | Redis (co-hosted on the shared NFS VM) | Yjs document-sync pub/sub and the background job queue |
| File persistence | Cloud Filestore (NFS) | Uploaded blobs persist under `/root/.affine/storage`, shared across pods |
| Object storage | Cloud Storage | A `storage` bucket provisioned automatically (backups/auxiliary storage) |
| Secrets | Secret Manager | Only the auto-generated database password — AFFiNE's own signing key lives in PostgreSQL |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** `database_type` defaults to `POSTGRES_15`
  and `Affine_Common` fixes the engine regardless — other engines are not
  supported.
- **Cloud SQL is reached via the Auth Proxy sidecar on loopback, not a
  socket.** `enable_cloudsql_volume = true` runs a cloud-sql-proxy sidecar
  listening on `127.0.0.1:5432` (the GKE pattern) — this is different from
  the Cloud Run variant, which mounts a Unix socket. The cloud entrypoint
  resolves the loopback host and sets `sslmode=disable` for it; a real
  private IP (Cloud Run) gets `sslmode=require` instead.
- **Redis is required, not optional.** `enable_redis = true` by default; the
  shared NFS VM also co-hosts Redis, so the description explicitly says to
  keep `enable_nfs = true` unless an external `redis_host` is supplied.
  Without Redis, real-time document sync and the job queue do not work.
- **NFS is enabled by default** (`enable_nfs = true`, mounted at
  `/root/.affine/storage`) so uploaded blobs persist and can be shared across
  pods — and because it hosts the Redis instance the app depends on.
- **Session affinity is `ClientIP`** so a client's requests reach the same
  pod.
- **No admin account / password to retrieve.** AFFiNE has no forced
  first-run admin credential; the first user to sign up on the deployed URL
  becomes the workspace owner.
- **Signing key lives in the database, not Secret Manager.** AFFiNE
  generates its signing/private key during the `affine-migrate` job's
  `self-host-predeploy` step and persists it in PostgreSQL — `secret_ids` is
  intentionally empty; the database password is the only secret Secret
  Manager holds for this app.
- **Schema creation happens in an init job, not at boot.** The
  `affine-migrate` job runs `node ./scripts/self-host-predeploy` (idempotent
  migration + key generation) before the server container starts, so there
  is no first-boot installer step to wait through at runtime.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the AFFiNE workload

AFFiNE pods are scheduled on Autopilot, which bills for the CPU/memory the
pods actually request. The workload type resolves via the shared
`workload_type`/`stateful_pvc_enabled` logic (see [App_GKE](App_GKE.md)); by
default AFFiNE runs as a `Deployment`.

- **Console:** Kubernetes Engine → Workloads → select the AFFiNE workload for
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows
  the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector app~affine 2>/dev/null || kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

AFFiNE stores all workspace data (documents, whiteboards, databases, users)
in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it through the
**Cloud SQL Auth Proxy** sidecar on `127.0.0.1:5432`; no public IP is
exposed. On first deploy, the `db-init` job creates the application role and
database and grants privileges (plus a best-effort `cloudsqlsuperuser` grant
so migrations can `CREATE EXTENSION`); the `affine-migrate` job then runs
AFFiNE's own schema migration.

- **Console:** SQL → select the instance for connections, backups, flags,
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and the Secret Manager secret holding the
password are all in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md) for
the connection model, automated backups, and password rotation.

### C. Redis — real-time collaboration

AFFiNE's Yjs document-sync pub/sub and background job queue require Redis.
`enable_redis = true` by default; when `redis_host` is left blank the
Foundation injects the shared NFS server's IP (the NFS VM co-hosts Redis).
The cloud entrypoint maps the injected `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH`
onto AFFiNE's `REDIS_SERVER_HOST`/`REDIS_SERVER_PORT`/`REDIS_SERVER_PASSWORD`.

- **Console:** Compute Engine → VM instances (the shared NFS/Redis VM).
- **CLI:**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i REDIS
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

See [App_GKE](App_GKE.md) for how the shared NFS/Redis VM is discovered and
provisioned.

### D. Cloud Storage & file persistence

A dedicated **Cloud Storage** bucket (suffix `storage`) is provisioned
automatically and the workload service account is granted access; it serves
backups and auxiliary storage. Separately, AFFiNE's uploaded blobs live on
**NFS (Cloud Filestore)** at `/root/.affine/storage`, shared across pods.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~affine"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### E. Secret Manager

Only the database password secret is generated automatically for AFFiNE —
there is no application-level secret because AFFiNE persists its own signing
key in PostgreSQL. On GKE, secrets are projected into pods via the Secret
Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~affine"
  gcloud secrets versions access latest --secret=<database-password-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing
IP (`service_type = LoadBalancer`, `reserve_static_ip = true` so the address
survives redeploys). A custom domain with a Google-managed certificate can
be enabled.

- **Console:** Network services → Load balancing; VPC network → IP
  addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to
Cloud Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. AFFiNE Application Behaviour

- **First-deploy database setup.** The `db-init` job (`postgres:15-alpine`,
  timeout 600 s) idempotently creates the application role and database,
  grants privileges on the database and `public` schema, and best-effort
  grants `cloudsqlsuperuser` so later migrations can `CREATE EXTENSION`. It
  then signals the Cloud SQL Auth Proxy sidecar (`POST /quitquitquit`) so the
  Job pod exits cleanly.
- **Schema migration in a dedicated init job, not on boot.** The
  `affine-migrate` job (the built AFFiNE app image, 2Gi memory, timeout
  1200 s, `max_retries = 3`) runs after `db-init` and executes AFFiNE's own
  `node ./scripts/self-host-predeploy`, which performs idempotent schema
  migration **and generates the signing/private key**, persisting it in
  PostgreSQL. The runtime container never migrates inline — by the time the
  server starts, the schema and key already exist.
- **No forced admin account.** AFFiNE has no image-mandated superadmin
  credential; the first user to visit the deployed URL and sign up becomes
  the initial workspace owner.
- **DB connection is TCP-over-loopback via the Auth Proxy sidecar, not a
  socket.** The cloud entrypoint (`cloud-entrypoint.sh`) assembles
  `DATABASE_URL` from the injected `DB_*` vars; on GKE the resolved host is
  `127.0.0.1` (the proxy sidecar) so it uses `sslmode=disable`. It also maps
  `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` onto AFFiNE's
  `REDIS_SERVER_HOST`/`REDIS_SERVER_PORT`/`REDIS_SERVER_PASSWORD`, and
  defaults `AFFINE_SERVER_EXTERNAL_URL` to the platform-injected service URL
  so invite/share links resolve correctly.
- **Health path.** The startup probe is **HTTP** `GET /`; the liveness and
  readiness probes use `GET /info`, AFFiNE's server-info endpoint. The
  liveness path must return a literal 200 because App_GKE mirrors it into the
  Gateway health check — `/` redirects (302), which kubelet accepts but the
  load balancer treats as unhealthy, so the Gateway would serve 503. Startup probe: 60 s initial delay, 15 s period, 30 failure
  threshold (up to ~510 s from container start). Liveness: 60 s initial
  delay, 30 s period, 3 failure threshold. Because migration runs in the
  separate `affine-migrate` job, the startup window mostly covers Node.js
  bundle load and Redis/PostgreSQL connection setup, not schema creation.
- **Full-text indexer is disabled.** `AFFINE_INDEXER_ENABLED = "false"`
  because the indexer requires a pgvector-backed search backend that is not
  provisioned by this module; the server boots on plain PostgreSQL + Redis.
- **Inspect the init jobs and running config:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<affine-migrate-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DATABASE_URL|REDIS_SERVER|AFFINE_SERVER'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform.
Only settings specific to or notable for AFFiNE are listed; every other
input is inherited from [App_GKE](App_GKE.md) with its standard behaviour
and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `affine` | Base name for resources. Do not change after first deploy. |
| `application_version` | `stable` | Image tag for `ghcr.io/toeverything/affine`. `latest` maps to `stable` (AFFiNE publishes no `latest` tag). Increment to trigger a new image build. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `custom` | AFFiNE is always a thin custom build over the upstream image so the cloud entrypoint can run. |
| `container_port` | `3010` | AFFiNE's self-host server port. |
| `container_resources.cpu_limit` | `2000m` | 2 vCPU default. |
| `container_resources.memory_limit` | `4Gi` | 4Gi default. |
| `min_instance_count` | `1` | Minimum pod replicas. |
| `max_instance_count` | `5` | Maximum pod replicas. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar on loopback (`127.0.0.1:5432`) — required on GKE. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Path for the Auth Proxy Unix socket (used for the metadata/quitquitquit endpoint, not the DB connection itself). |
| `enable_image_mirroring` | `true` | Always true — the base image is mirrored from Docker Hub/GHCR into Artifact Registry. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the AFFiNE UI. |
| `workload_type` | `null` → `Deployment` | Deployment by default. |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |
| `network_tags` | `["nfsserver"]` | Applied to nodes/pods; matches the shared NFS/Redis VM's firewall tag. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Keep true — the shared NFS VM also co-hosts the Redis instance AFFiNE requires; disabling it removes both blob persistence and Redis unless an external `redis_host` is supplied. |
| `nfs_mount_path` | `/root/.affine/storage` | Where AFFiNE stores uploaded blobs. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Required for production — Yjs real-time sync and the job queue run through Redis. |
| `redis_host` | `""` | Leave blank to use the shared NFS server's IP. |
| `redis_port` | `6379` | Redis TCP port. |
| `redis_auth` | `""` | Redis auth password, if required. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | AFFiNE requires PostgreSQL 15+; other engines are rejected by the Common layer. |
| `application_database_name` | `affine` | Database name. Immutable after first deploy. |
| `application_database_user` | `affine` | Application database user; password auto-generated in Secret Manager. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `application_domains` | `[]` | Custom hostnames + managed certificate. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest
way to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach AFFiNE. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup (`db-init`, `affine-migrate`) and (optional) import jobs. |
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

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `StatefulSet` forced alongside a stateless setting, IAP with no authorized identities, `quota_memory_*` given as bare integers, an out-of-range `container_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Selecting a non-PostgreSQL engine breaks `self-host-predeploy` and every query. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all data. |
| `enable_redis` | `true` | Critical | AFFiNE's real-time document sync and job queue depend on Redis; disabling it without an alternative breaks collaboration and background jobs. |
| `enable_nfs` | `true` (unless an external `redis_host` is supplied) | Critical | The shared NFS VM also co-hosts Redis — disabling NFS with no external Redis silently removes AFFiNE's Redis connection too, not just blob persistence. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar on `127.0.0.1:5432` is required for DB connectivity on GKE. |
| `container_resources.memory_limit` | `4Gi` | High | The `affine-migrate` init job alone requests 2Gi; under-provisioning the server container risks OOM under real-time collaboration load. |
| `session_affinity` | `ClientIP` | High | Without stickiness, requests bounce between pods and disrupt WebSocket-based real-time sessions. |
| `AFFINE_SERVER_EXTERNAL_URL` (auto-defaulted) | Platform service URL | Medium | If overridden incorrectly via `environment_variables`, invite and share links resolve to the wrong host. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `AFFINE_INDEXER_ENABLED` (fixed `false`) | Leave as-is unless a vector DB is wired | Low | Enabling it without a pgvector-backed backend breaks the full-text indexer. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and `AFFINE_SERVER_EXTERNAL_URL`. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. AFFiNE-specific application configuration shared
with the Cloud Run variant is described in
**[Affine_Common](Affine_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: AFFiNE on GKE Autopilot](../labs/Affine_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [AFFiNE on Google Cloud Run](Affine_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [AFFiNE Common — Shared Application Configuration](Affine_Common.md) — the configuration shared by both deployment targets.
