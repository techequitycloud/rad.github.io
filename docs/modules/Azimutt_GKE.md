---
title: "Azimutt on GKE Autopilot"
description: "Configuration reference for deploying Azimutt on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Azimutt on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Azimutt_GKE.png" alt="Azimutt on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Azimutt is an open-source, next-generation database-schema explorer and ERD (entity
relationship diagram) tool for real-world databases, built with Elixir/Phoenix. It
lets teams explore, document, and design large schemas (thousands of tables), search
across columns and relations, and share diagrams. This module deploys Azimutt on
**GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and
manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Azimutt uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## What Azimutt costs on RAD, and how that compares

**Azimutt on RAD's GKE Autopilot module costs about US$136 a month in a project you own, with no licence fee for the software itself.** RAD charges a one-off module fee of 175 credits (US$17.50 at the top-up price) in a project you own, and 157.5 credits (10% lower) in a project RAD manages. GKE suits Azimutt that must stay up continuously or scale across pods; for the lowest cost, the [Cloud Run module](Azimutt_CloudRun.md) runs the same Azimutt for about US$89 a month. Figures are as at 8 October 2026; sources are listed at the end of this section.

If you only need it occasionally — studying for a certification, a demo, a seasonal need — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that about US$136 a month becomes close to nothing instead. See **Pause it for free**, below.

### What you pay on RAD

You pay for three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 175 credits (US$17.50 at the top-up price) | 157.5 credits (10% lower) |
| Build time | A few credits, metered per minute of build time | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about US$136 a month for the default configuration (table below) | Metered hourly in credits; RAD publishes **105 credits a day**, about 3,150 a month (about US$315 at the top-up price, US$252 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database is shared by every application in the project, so a second application does not add a second one.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 2x vCPU / 4 GiB | US$79.35 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | US$0 if this is your only Autopilot/zonal cluster on the billing account, otherwise about US$73 (shared across every GKE app in the project) |
| **Total** | **about US$136** |

### How it compares

- **No name-brand SaaS competitor is a clean match for Azimutt, so the honest comparison is a plain self-managed server.** Running the same open-source software yourself, a Hetzner CPX22 (2 vCPU/4 GB, about $24/month) or a DigitalOcean 2 vCPU/4 GB Droplet (also $24/month) is roughly the same shape; a GCP Compute Engine e2-standard-2 (2 vCPU/8 GB) runs about $49/month.
- **RAD is not cheaper than a bare VPS in cash terms, and does not try to be.** What RAD adds for a similar price is a managed database, Secret Manager for credentials, and monitoring that would otherwise be your own job to set up, patch and keep backed up.
- **The admin's own time is the real cost a VPS does not show.** Security patches, backups and version upgrades on a bare server are work someone has to keep doing; RAD's managed services absorb that.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Azimutt runs in **a project RAD manages for you**, you have an option that goes well beyond
scaling to zero: **delete the whole project, and restore it within 30 days for close to
nothing.** This suits occasional use — studying for a certification, a demo, a seasonal
need — far better than running Azimutt continuously.

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
- **One real gap: backups do not survive.** Anything Azimutt writes to a backup bucket inside the
  project is very likely gone as soon as you delete the project, even though the project itself
  is recoverable for 30 days — that bucket has Cloud Storage's soft-delete explicitly turned
  off. Anyone who has customised the deployment and wants to keep that work should copy a
  backup out (to Google Drive, or a bucket outside the project) before deleting. For a default
  install with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

This is the fallback for a project you own, or once the 30-day restore window above has
passed: **delete the deployment, and deploy it again when you next need it.**

- **What a redeploy costs.** The module fee again, plus the builds: roughly
  180 credits (about US$18) in your own project, or
  162.5 credits in a RAD-managed one, because RAD rebuilds the resources
  from scratch. Deleting saves money once Azimutt would otherwise sit unused long enough to clear that redeploy cost against its own running cost — roughly 4 days or more in your own project (US$4.55/day) or 2 days or more in a RAD-managed one (105 credits/day).
- **Most of the running cost is usually shared infrastructure.** The database stops only when nothing else in the project uses them, so deleting Azimutt while another application shares the project saves only Azimutt's own compute part.
- **Keep your data first.** Anything Azimutt writes to a backup bucket inside the deployment is
  deleted with it — copy the latest backup out (to Google Drive, or a bucket you keep) before
  deleting if you want to keep it.
- **RAD does not recreate a deleted deployment for you.** You enter the settings again when
  you redeploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  Azimutt in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs Azimutt for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's fees and daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics. Prices change; check each source before relying on a figure.

## 1. Overview

Azimutt runs as a single Elixir/Phoenix web workload listening on port **4000**. The
deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Phoenix pods, horizontally autoscaled; bills for requested CPU/memory |
| Database | Cloud SQL for PostgreSQL 15 | Required — Azimutt does not support MySQL or other engines |
| File storage | Cloud Filestore (NFS) | Optional, off by default (`enable_nfs = false`): Azimutt writes uploads to its own ephemeral working directory, never to this mount (see below) |
| Object storage | Cloud Storage | A bucket is provisioned (available for an S3-compatible file adapter) |
| Secrets | Secret Manager | Auto-generated Phoenix `SECRET_KEY_BASE`; database password |
| Image build | Cloud Build + Artifact Registry | Thin wrapper FROM `ghcr.io/azimuttapp/azimutt`, mirrored into Artifact Registry |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup. All Azimutt project
  data lives in Postgres.
- **Azimutt connects to Postgres over the Auth Proxy loopback (no SSL).** Ecto cannot
  parse the Cloud SQL socket DSN, so on GKE the entrypoint builds `DATABASE_URL`
  against `127.0.0.1` (the Cloud SQL Auth Proxy sidecar, which terminates TLS) with
  `DATABASE_ENABLE_SSL=false`. `enable_cloudsql_volume = true` is required.
- **`container_port` and probes must be 4000.** On GKE the platform does **not**
  auto-inject `PORT`, so the entrypoint defaults `PORT=4000`; the Service port and
  probes must match or the pod never becomes Ready even though the app is healthy.
- **NFS is off by default** (`enable_nfs = false`) because nothing in this module
  writes to it — `FILE_STORAGE_ADAPTER` stays `local`, so uploads land on the pod's
  ephemeral disk whether or not NFS is mounted. Project data itself
  (schemas, diagrams, layouts, users) lives in Postgres and is unaffected.
- **`SECRET_KEY_BASE` is generated automatically** and stored in Secret Manager.
  Rotating it after first boot signs out every active session; only rotate in a
  maintenance window.
- **Minimum 1 replica is maintained** (`min_instance_count = 1`) — GKE does not
  support scale-to-zero, keeping Azimutt always reachable.
- **Migrations run automatically on every boot** (`/app/bin/migrate && /app/bin/server`);
  allow extra time on the first boot.
- **`application_version = "latest"` maps to Azimutt's `main` tag.** Pin to a specific
  release in production.
- **Sign-up is open by default.** Restrict access after creating your first account.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Azimutt workload

Azimutt pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Azimutt workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl logs -n "$NAMESPACE" deploy/<service-name> | grep cloud-entrypoint  # resolved DB wiring
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Azimutt stores all application data (schemas, diagrams, layouts, users, sources) in a
managed Cloud SQL for PostgreSQL 15 instance. Pods reach it through the **Cloud SQL
Auth Proxy sidecar** on `127.0.0.1` (TLS terminated by the proxy, so
`DATABASE_ENABLE_SSL=false`). On first deploy an initialization Job creates the
application database and role; Azimutt then runs its own Ecto migrations on boot.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are all surfaced in the
[Outputs](#5-outputs). For the connection model, backups, and password rotation, see
[App_GKE](App_GKE.md).

### C. Cloud Filestore (NFS) & Cloud Storage

NFS is **off by default** (`enable_nfs = false`); if enabled it is mounted at
`nfs_mount_path`, but it is not wired to Azimutt's storage path — with the default
`FILE_STORAGE_ADAPTER = local`, Azimutt still writes uploads to its own ephemeral
working directory rather than this mount. A **Cloud Storage** bucket is also
provisioned (available if you switch Azimutt to an S3-compatible file adapter).
Project data itself (schemas, diagrams, layouts, users) lives in Postgres and is
unaffected either way.

- **Console:** Filestore → Instances; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, CMEK options, and GCS Fuse mounts.

### D. Secret Manager

The Phoenix **`SECRET_KEY_BASE`** is generated automatically and stored in Secret
Manager (used to sign and encrypt session cookies). The database password is managed
separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Cloud Build & Artifact Registry

Azimutt's image is a thin wrapper built FROM `ghcr.io/azimuttapp/azimutt`; Cloud Build
produces the wrapped image and it is mirrored into Artifact Registry
(`enable_image_mirroring = true`). Because it is a rebuilt/mirrored image, App_GKE sets
`imagePullPolicy = Always` so nodes never serve a stale cached layer.

- **Console:** Cloud Build → History; Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --include-tags
  ```

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`). A custom domain with a Google-managed certificate can
be enabled, and a static IP can be reserved so the address survives redeploys.
`session_affinity = ClientIP` keeps a client pinned to one pod.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available. The
`cloud-entrypoint` lines show the resolved `DATABASE_URL` path, `PHX_HOST`, and `PORT`.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Azimutt Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It idempotently creates the application role
  (`LOGIN CREATEDB`) and database, grants `ALL` on the database and the `public`
  schema, and `ALTER`s the schema owner — Azimutt needs full DDL rights because it
  runs its own migrations. The job then signals the Auth Proxy sidecar to shut down
  (`/quitquitquit`) so the Job pod completes. Safe to re-run.
- **Migrations run on start.** The container command is
  `/app/bin/migrate && /app/bin/server`, so Ecto applies pending migrations on every
  boot before the Phoenix endpoint binds. Upgrading `application_version` applies
  schema changes automatically.
- **Runtime DB wiring is composed by the entrypoint.** On GKE `DATABASE_URL` is built
  against the Auth Proxy loopback (`127.0.0.1`) with `DATABASE_ENABLE_SSL=false`, and
  `PORT` is defaulted to 4000 (GKE does not auto-inject it). `PHX_HOST` is derived
  from the injected service URL.
- **`SECRET_KEY_BASE` is stable and effectively immutable.** Rotating it invalidates
  every active session cookie — all users are signed out. Only rotate in a maintenance
  window.
- **Health path.** The startup probe targets the Phoenix root `/` and the liveness probe
  `/health`, both with a 60-second initial delay. The liveness probe is mirrored into the
  Gateway health check, which requires a literal 200, so it must not point at `/`. The probes and `container_port` must both be **4000** or
  the pod never becomes Ready.
- **First-run setup.** Reach the service via its external LoadBalancer IP (or custom
  domain) and create the first Azimutt account through the sign-up page. Sign-up is
  open by default — restrict access afterwards.
- **Inspect the init job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Azimutt are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

All other inputs follow standard App_GKE behaviour.

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

All other inputs follow standard App_GKE behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `azimutt` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Azimutt` | Human-readable name shown in the platform UI. |
| `application_version` | `latest` | Azimutt image tag; `latest` maps to the `main` tag. Pin to a release in production. |

All other inputs follow standard App_GKE behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `min_instance_count` | `1` | Minimum replicas; GKE does not support scale-to-zero. |
| `max_instance_count` | `5` | Maximum replicas. |
| `container_port` | `4000` | Phoenix listens on 4000; probes and Service port must match. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar for the `127.0.0.1` DB connection; required. |

All other inputs follow standard App_GKE behaviour.

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `null` | Deployment by default; auto-resolves to StatefulSet if `stateful_pvc_enabled = true`. |
| `session_affinity` | `ClientIP` | Sticky routing so a client stays on one pod. |

All other inputs follow standard App_GKE behaviour.

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Leave unset — Azimutt is NFS-backed and stores project data in Postgres. |

All other inputs follow standard App_GKE behaviour.

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |

All other inputs follow standard App_GKE behaviour.

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 60s delay, 30 × 15s failure window | Startup probe; allow time for first-boot migrations. Must target port 4000. |
| `liveness_probe` | HTTP `/health`, 60s delay | Liveness probe; also the Gateway health check, which needs a literal 200. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, App_GKE-level infrastructure probes | Structured probes. |
| `uptime_check_config` | disabled, path `/` | Optional Cloud Monitoring uptime check. |

All other inputs follow standard App_GKE behaviour.

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |

All other inputs follow standard App_GKE behaviour.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Off by default: nothing in this module writes to the NFS mount. Azimutt stores uploads with `FILE_STORAGE_ADAPTER = local` on the ephemeral container disk; durable uploads need Azimutt_Common's `s3` adapter, which enabling NFS never provided. Project data lives in PostgreSQL. |
| `nfs_mount_path` | `/opt/azimutt/storage` | Mount path inside the container. |

All other inputs follow standard App_GKE behaviour.

### Group 15 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Off by default — Azimutt uses PostgreSQL (Oban) for background jobs, not Redis. |
| `redis_host` | `""` | Redis endpoint (only if a downstream feature requires it). |

All other inputs follow standard App_GKE behaviour.

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `application_database_name` | `azimutt` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `azimutt` | Application database user. Immutable after first deploy. |

All other inputs follow standard App_GKE behaviour.

### Groups 19–22 — Custom Domain, IAP, Cloud Armor, VPC-SC

Standard App_GKE behaviour — `enable_custom_domain`, `reserve_static_ip`,
`enable_iap`, `enable_cloud_armor`, `enable_vpc_sc`, `enable_audit_logging`. See
[App_GKE](App_GKE.md).

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
| `service_url` | URL to reach Azimutt. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`, a bare-integer `quota_memory_*`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `SECRET_KEY_BASE` (auto-generated) | Never rotate outside a maintenance window | Critical | Rotating it invalidates every active session cookie — all users are signed out. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/role and orphans all Azimutt data. |
| `container_port` | `4000` | Critical | The entrypoint defaults `PORT=4000` on GKE; a mismatched Service port or probe port hits a dead port and the pod never becomes Ready. |
| `enable_cloudsql_volume` | `true` | Critical | The Auth Proxy sidecar provides the `127.0.0.1` DB connection; disabling it leaves Azimutt with no database and blocks the `db-init` bootstrap. |
| `enable_nfs` | `false` | Low | Enabling it provisions Filestore, but has no effect on Azimutt itself — `FILE_STORAGE_ADAPTER` is never pointed at the NFS mount, so uploads still land on the pod's ephemeral disk regardless of this setting (project data itself is safe in Postgres). |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects invalid values. |
| `application_version` | Pin a release | High | `latest` maps to the rolling `main` tag; an unexpected upstream change can break a redeploy. |
| `session_affinity` | `ClientIP` | Medium | Without stickiness, UI sessions bounce between pods. |
| `enable_iap` / custom domain | Restrict after first account | High | Sign-up is open by default; leaving the LoadBalancer publicly reachable lets anyone create an account. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `enable_redis` | `false` | Low | Azimutt uses Postgres/Oban, not Redis — enabling it has no effect on Azimutt itself. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Azimutt-specific
application configuration shared with the Cloud Run variant is described in
**[Azimutt_Common](Azimutt_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Azimutt on GKE Autopilot](../labs/Azimutt_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Azimutt on Google Cloud Run](Azimutt_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Azimutt Common — Shared Application Configuration](Azimutt_Common.md) — the configuration shared by both deployment targets.
