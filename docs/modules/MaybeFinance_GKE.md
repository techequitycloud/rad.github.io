---
title: "Maybe Finance on GKE Autopilot"
description: "Configuration reference for deploying Maybe Finance on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Maybe Finance on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/MaybeFinance_GKE.png" alt="Maybe Finance on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Maybe (Maybe Finance) is an open-source, self-hosted alternative to Mint/Monarch
for personal finance and wealth management — budgeting, net-worth tracking,
transaction categorization, and multi-account aggregation, built on Ruby on
Rails. This module deploys Maybe on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Maybe uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Maybe runs as a single Rails/Puma web workload with a Sidekiq background-job
process co-located in the same container. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Rails/Puma pods on port 3000, 2 vCPU / 4 GiB by default; Sidekiq runs as a background process inside the same container |
| Database | Cloud SQL for PostgreSQL 15 | Required — a plan-time guard accepts only `POSTGRES_13`/`14`/`15` (or `NONE`); MySQL is rejected |
| Background jobs & real-time UI | Redis (via the shared NFS VM, or an explicit host) | Mandatory — a plan-time guard fails if disabled; powers Sidekiq (account syncing, import processing, notifications) and ActionCable |
| File persistence | Cloud Filestore (NFS) | Attachments persist under `/opt/maybefinance/storage`, shared across pods; also the default source for the Redis host IP |
| Object storage | Cloud Storage | A `storage` bucket is auto-provisioned by `MaybeFinance_Common`; not mounted into pods unless `gcs_volumes` is set |
| Secrets | Secret Manager | Auto-generated `SECRET_KEY_BASE` (Rails session/encryption key); database password |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; custom domain + managed certificate enabled by default |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** `database_type` defaults to `POSTGRES_15`
  and a plan-time guard (`validation.tf`) rejects anything other than
  `POSTGRES_13`/`14`/`15`/`NONE` — MySQL is not supported.
- **Redis is mandatory, not optional.** A plan-time precondition fails the
  plan outright if `enable_redis = false`. When `redis_host` is left blank,
  `enable_nfs` must stay `true` so the shared NFS server's IP is used as the
  Redis host (the NFS VM co-hosts Redis in this repo's convention).
- **Cloud SQL is reached via the Auth Proxy sidecar on loopback.**
  `enable_cloudsql_volume = true` injects a cloud-sql-proxy sidecar listening
  on `127.0.0.1:5432`. Rails cannot parse the Cloud SQL Unix-socket DSN, so
  the cloud entrypoint never builds a URL-style DSN — it maps the
  Foundation's `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` onto
  Maybe's discrete `DB_HOST`/`DB_PORT`/`POSTGRES_DB`/`POSTGRES_USER`/
  `POSTGRES_PASSWORD` env vars and sets `PGSSLMODE=disable` on loopback
  (`require` on a real private IP).
- **`min_instance_count = 1` / `max_instance_count = 5`.** At least one pod
  stays up so the in-process Sidekiq worker keeps draining the job queue;
  scaling to zero stops background jobs entirely.
- **Combined web + worker container, not a sidecar.** The cloud entrypoint
  starts `bundle exec sidekiq` in the background and then `exec`s the Rails
  web server in the foreground of the *same* container — Maybe is not
  deployed with a separate `additional_services` worker.
- **`SECRET_KEY_BASE` is generated once** by `MaybeFinance_Common` and stored
  in Secret Manager, shared identically by the web and Sidekiq processes.
  Rails uses it to sign sessions/cookies and to derive the key that encrypts
  ActiveRecord-encrypted columns.
- **Schema is created by an init job, not on boot.** The
  `maybefinance-migrate` job runs `rails db:prepare` during apply; the
  runtime entrypoint never runs migrations.
- **Session affinity is `ClientIP`** so a client's requests reach the same
  pod.
- **`container_image_source = "custom"`.** Cloud Build builds a thin wrapper
  image `FROM ghcr.io/maybe-finance/maybe:<version>`. `application_version`
  defaults to `"stable"`; a `"latest"` request is mapped to the pinned
  `stable` channel via the app-specific `MAYBE_VERSION` build ARG (the
  Foundation's generic `APP_VERSION` build arg is intentionally not used).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Maybe workload (web + Sidekiq)

Maybe pods are scheduled on Autopilot, which bills for the CPU/memory the
pods actually request. The Rails/Puma web server and the Sidekiq worker run
as two processes inside the same container, sharing `SECRET_KEY_BASE` and the
Redis connection.

- **Console:** Kubernetes Engine → Workloads → select the Maybe workload for
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows
  the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ps aux | grep -E 'puma|sidekiq'
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Maybe stores all application data (accounts, transactions, budgets, users) in
a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it through the
**Cloud SQL Auth Proxy** sidecar on `127.0.0.1:5432`; no public IP is
exposed. On first deploy the `db-init` job creates the application database
and user, grants the app role `cloudsqlsuperuser` (so Maybe's migrations can
create Postgres extensions without superuser access), and pre-creates the
`pgcrypto` extension; `maybefinance-migrate` then runs `rails db:prepare`.

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

### C. NFS (Cloud Filestore) & Redis

**Cloud Filestore (NFS)** is mounted at `/opt/maybefinance/storage` so
uploaded attachments persist and are shared across pods. Maybe also requires
**Redis** for Sidekiq (background account syncing, import processing,
notifications) and ActionCable (real-time UI updates); when `redis_host` is
left blank, the injected `REDIS_HOST` resolves to the shared NFS server's IP
(the NFS VM co-hosts Redis in this repo's platform convention).

- **Console:** Filestore → Instances; Compute Engine → VM instances (the NFS
  VM, if it also runs Redis).
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'REDIS_URL|REDIS_HOST'
  ```

See [App_GKE](App_GKE.md) for NFS discovery/provisioning behaviour and the
Redis injection mechanics.

### D. Cloud Storage

A **Cloud Storage** bucket (suffix `storage`) is provisioned automatically by
`MaybeFinance_Common`, and the default `storage_buckets` variable adds a
second bucket (suffix `data`). Neither is mounted into the pod filesystem by
default — `gcs_volumes` is empty out of the box — so they exist as
provisioned storage but are inert until explicitly wired up.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~maybefinance"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### E. Secret Manager

One Maybe-specific secret is generated automatically and stored in Secret
Manager: `SECRET_KEY_BASE` (`secret-<prefix>-maybefinance-secret-key-base`),
a 64-character random value shared by the Rails web process and the Sidekiq
worker. The database password is managed separately by the foundation. On
GKE, secrets are projected into pods via the Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~maybefinance"
  gcloud secrets versions access latest --secret=<secret-key-base-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing
IP (`service_type = LoadBalancer`, `reserve_static_ip = true` so the address
survives redeploys) with `enable_custom_domain = true` provisioning a
Kubernetes Ingress. `network_tags` defaults to `["nfsserver"]`, required for
the NFS/Redis discovery path.

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

Pod stdout/stderr flow to Cloud Logging (`RAILS_LOG_TO_STDOUT = "true"`); GKE
and Cloud SQL metrics flow to Cloud Monitoring. Optional uptime checks and
alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Maybe Finance Application Behaviour

- **First-deploy database setup.** The `db-init` job runs `db-init.sh` using
  `postgres:15-alpine`. It connects to Cloud SQL, idempotently creates the
  application database and user, grants privileges, grants the app role
  `cloudsqlsuperuser` (Cloud SQL's app users aren't real superusers, so this
  lets Maybe's own migration create Postgres extensions), and pre-creates
  `pgcrypto` as a belt-and-suspenders step. The job is safe to re-run
  (`execute_on_apply = true`, `max_retries = 1`).
- **Schema migration is a separate init job.** `maybefinance-migrate` runs
  `bundle exec rails db:prepare` against the image built for the app
  (`image = null` in its job spec, so it reuses the built Maybe image and
  toolchain), depends on `db-init` completing first, and retries up to 3
  times (`max_retries = 3`, `timeout_seconds = 1200`, `memory_limit = 2Gi`).
- **First-run admin registration, not an auto-created secret.**
  `SELF_HOSTED = "true"` enables Maybe's self-host UI, which lets the first
  visitor register the initial admin account through the web UI — unlike
  some other modules in this repo, there is no auto-generated admin password
  secret to retrieve. <!-- TODO: verify whether a first-run invite/registration lock exists after the first admin is created -->
- **`SECRET_KEY_BASE` is immutable in practice.** It is generated once by
  `MaybeFinance_Common` and shared by the web and Sidekiq processes.
  Rotating it after first boot invalidates existing sessions and makes
  ActiveRecord-encrypted columns unreadable.
- **DB env-var mapping happens in the cloud entrypoint, not a URL DSN.** The
  platform injects `DB_HOST` (loopback via the proxy sidecar on GKE),
  `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`; the entrypoint maps these
  onto `POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD` (Maybe's Rails
  `config/database.yml` convention) and sets `PGSSLMODE` based on whether the
  resolved host is loopback.
- **Redis wiring.** `REDIS_URL` is built from the injected `REDIS_HOST`/
  `REDIS_PORT`/`REDIS_AUTH` if not already set. If `REDIS_URL` ends up empty
  (Redis unreachable), the entrypoint skips starting Sidekiq entirely —
  background jobs silently stop running rather than crashing the pod.
- **Health path.** Startup probe is **HTTP** `GET /up` with a generous
  allowance for a slow first boot (`initial_delay_seconds = 60`,
  `period_seconds = 15`, `failure_threshold = 30` — roughly 8 minutes of
  headroom). Liveness probe is also **HTTP** `GET /up`
  (`initial_delay_seconds = 60`, `period_seconds = 30`,
  `failure_threshold = 3`).
- **Inspect the init jobs and running config:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl logs -n "$NAMESPACE" job/<maybefinance-migrate-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'RAILS_ENV|POSTGRES_|REDIS_URL'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform
(the `{{UIMeta group=N}}` tag in each variable's description in
`variables.tf`). Only settings specific to or notable for Maybe are listed;
every other input is inherited from [App_GKE](App_GKE.md) with its standard
behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `maybefinance` | Base name for resources. Do not change after first deploy. |
| `application_version` | `stable` | `ghcr.io/maybe-finance/maybe` image tag used as the custom-build base; `latest` is mapped to the pinned `stable` release channel via `MAYBE_VERSION`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_port` | `3000` | Maybe's native Rails/Puma port. |
| `container_resources` | `cpu_limit=2000m, memory_limit=4Gi` | 2 vCPU / 4 GiB for the combined Rails + Sidekiq container. |
| `min_instance_count` | `1` | Keep at 1 so the co-located Sidekiq worker always has a pod to run in. |
| `max_instance_count` | `5` | HPA ceiling. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar (loopback) — required on GKE. |
| `container_image_source` | `custom` | Thin wrapper image built FROM the upstream GHCR image. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the Maybe UI. |
| `workload_type` | `null` → `Deployment` | Deployment (combined web + Sidekiq pod). |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Keeps at least one pod available during voluntary node disruptions. |
| `pdb_min_available` | `"1"` | Minimum pods available during disruptions. |

### Group 13 — NFS

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Attachments persist and are shared across pods; also the default source for the Redis host IP. |
| `nfs_mount_path` | `/opt/maybefinance/storage` | Where Maybe stores uploaded attachments. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Mandatory** — a plan-time guard fails the plan if set to `false`. |
| `redis_host` | `""` | Leave blank to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis server port. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Guard restricts this to `POSTGRES_13`/`14`/`15`/`NONE`; MySQL is rejected. |
| `application_database_name` | `maybefinance` | Database name. Immutable after first deploy. |
| `application_database_user` | `maybefinance` | Application database user; password auto-generated in Secret Manager. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisions a Kubernetes Ingress for custom domain routing. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `network_tags` | `["nfsserver"]` | Required tag for NFS/Redis-host discovery. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way
to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Maybe. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `initialization_jobs` / `db_import_job` | Names of the setup (`db-init`, `maybefinance-migrate`) and (optional) import jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_GKE](App_GKE.md) foundation engine, which validates
> values *and combinations* at plan time — plus MaybeFinance's own
> `validation.tf` guards (Redis mandatory, PostgreSQL-only, `min` ≤ `max`,
> IAP credentials required when enabled, no Auth Proxy without a real
> database). Invalid configuration fails the **plan** with a clear, named
> error before any resource is created, so most mistakes below are caught up
> front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (or `13`/`14`) | Critical | A non-PostgreSQL engine is rejected at plan time; forcing one around the guard breaks the installer and every query. |
| `enable_redis` | `true` | Critical | The plan-time guard blocks `false` outright — Maybe has no functioning background-job queue or real-time UI without Redis. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all data. |
| `SECRET_KEY_BASE` (auto-generated) | Never change | Critical | Rotating it after first boot invalidates all sessions and makes ActiveRecord-encrypted columns unreadable. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `min_instance_count` | `1` | High | Scaling to 0 stops the co-located Sidekiq worker — account syncing, import processing, and notifications silently stop firing. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar on `127.0.0.1:5432` is required for DB connectivity on GKE. |
| `enable_nfs` | `true` (unless `redis_host` is set explicitly) | High | If left `false` with `redis_host` empty, the plan-time guard fails; if disabled after a working deploy with an explicit `redis_host`, uploaded attachments become ephemeral. |
| `redis_host` | `""` (use NFS IP) or a real, reachable host | High | An unreachable Redis host makes `REDIS_URL` resolve but fail to connect — Sidekiq starts but jobs never process; the entrypoint only skips Sidekiq when `REDIS_URL` is entirely empty. |
| `container_resources.memory_limit` | `4Gi` (default) | High | The combined Rails + Sidekiq process is memory-hungry under import/sync workloads; shrinking it risks OOM. <!-- TODO: verify the exact minimum safe memory floor --> |
| `session_affinity` | `ClientIP` | High | Without stickiness, requests bounce between pods and can disrupt authenticated sessions. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and any configured custom domain. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Maybe-specific application configuration shared
with the Cloud Run variant lives in the `MaybeFinance_Common` module (its own
`docs/modules/MaybeFinance_Common.md` guide has not been published yet).
