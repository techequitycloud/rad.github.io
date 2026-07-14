---
title: "Chatwoot on GKE Autopilot"
description: "Configuration reference for deploying Chatwoot on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Chatwoot on GKE Autopilot

Chatwoot is an open-source, multi-channel helpdesk and customer-engagement platform
(email, live chat, social, and messaging inboxes, SLA tracking, and reporting) that
serves as a GDPR-compliant alternative to Zendesk or Intercom. This module deploys
Chatwoot on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which
provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Chatwoot uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

Chatwoot runs as a single Ruby on Rails workload that combines the web server and a
background Sidekiq worker in one pod. The deployment wires together a focused set
of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Rails + co-located Sidekiq worker on port 3000, 2 vCPU / 4 GiB by default |
| Database | Cloud SQL for PostgreSQL 15 | Required — the engine is fixed at `POSTGRES_15`; the `vector` (pgvector) extension is enabled for Chatwoot's AI/search features |
| Cache & queue | Redis (Cloud Filestore-hosted NFS VM, or external) | Backs Sidekiq's job queue and ActionCable pub/sub |
| File persistence | Cloud Filestore (NFS) | Attachments persist under `/opt/chatwoot/storage`, shared across pods |
| Object storage | Cloud Storage | A `storage` bucket suffix provisioned automatically |
| Secrets | Secret Manager | Auto-generated Rails `SECRET_KEY_BASE`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** `database_type` defaults to `POSTGRES_15`; Chatwoot's
  schema and pgvector-backed features require it.
- **Custom-built image.** `container_image_source = "custom"` — the Common module
  builds `FROM chatwoot/chatwoot:${APP_VERSION}` and layers in a cloud entrypoint
  that maps the Foundation's `DB_*`/`REDIS_*` env vars onto Chatwoot's
  `POSTGRES_*`/`REDIS_URL` convention and launches Sidekiq in the background before
  exec'ing the Rails server. The image runs **as root** — matching the upstream
  image, whose `/app`/`/app/tmp` are root-owned and not group-writable, so Rails'
  `create_tmp_directories` step needs root to succeed.
- **Cloud SQL is reached via the Auth Proxy sidecar on loopback.** `enable_cloudsql_volume
  = true` runs a cloud-sql-proxy sidecar listening on `127.0.0.1:5432`; the entrypoint
  maps the injected `DB_HOST`/`DB_IP` onto `POSTGRES_HOST`.
- **Two initialization jobs run in sequence.** `db-init` (creates the database, role,
  and grants — including a `cloudsqlsuperuser` grant so Chatwoot can create Postgres
  extensions itself) runs first, then `chatwoot-prepare` (`rails db:chatwoot_prepare`)
  creates/upgrades the schema and seeds defaults. There is no in-container migration
  step; schema setup happens entirely in these two Jobs before the app container
  needs to serve traffic.
- **Redis defaults on** (`enable_redis = true`). Leave `redis_host` blank to use the
  shared NFS-server-hosted Redis IP that the Foundation injects automatically.
- **`SECRET_KEY_BASE` is generated once and shared** between the Rails web process
  and the Sidekiq worker (they run in the same container here, but the value must
  also stay stable across restarts/redeploys — Rails uses it to sign sessions and
  encrypt ActiveRecord-encrypted columns).
- **Session affinity is `ClientIP`** so a client's requests reach the same pod.
- **PodDisruptionBudget is on by default** (`enable_pod_disruption_budget = true`,
  `pdb_min_available = "1"`).
- **`ENABLE_ACCOUNT_SIGNUP` defaults to `"false"`** — open self-service admin/agent
  signup is disabled on a freshly deployed helpdesk; flip it via
  `environment_variables` if you want public signup.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Chatwoot workload

Chatwoot pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Each pod runs both the Rails web server and a background Sidekiq
worker process, so the workload should not be scaled to zero — Sidekiq is what
delivers/receives channel messages and processes background jobs.

- **Console:** Kubernetes Engine → Workloads → select the Chatwoot workload for
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Chatwoot stores all application data (conversations, contacts, inboxes, agents,
reports) in a managed Cloud SQL for PostgreSQL 15 instance, including the `vector`
extension used by its AI/search features. Pods reach it through the **Cloud SQL
Auth Proxy** sidecar on `127.0.0.1:5432`; no public IP is exposed. On first deploy
the `db-init` Job creates the application database, role, and grants (including a
`cloudsqlsuperuser` grant so Chatwoot's own extension-creation calls succeed), then
the `chatwoot-prepare` Job runs `rails db:chatwoot_prepare` to build the schema.

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

### C. Redis (cache, queue, and pub/sub)

Sidekiq (Chatwoot's background job queue) and ActionCable (real-time UI updates)
both require Redis. `enable_redis = true` by default; when `redis_host` is left
blank, the Foundation injects the shared NFS-server-hosted Redis IP as `REDIS_HOST`,
and the container entrypoint builds `REDIS_URL` from it at startup. Point
`redis_host`/`redis_port`/`redis_auth` at a dedicated Cloud Memorystore instance for
a heavier production workload.

- **Console:** Memorystore → Redis instances (if using a dedicated instance).
- **CLI:**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E '^REDIS_'
  gcloud redis instances list --project "$PROJECT" --region "$REGION"
  ```

See [App_GKE](App_GKE.md) for how the NFS-hosted Redis fallback and Memorystore
integration are wired.

### D. Cloud Storage & file persistence (NFS)

A dedicated **Cloud Storage** bucket (suffix `storage`) is provisioned automatically
and the workload service account is granted access. Separately, Chatwoot's
attachments live on **NFS (Cloud Filestore)** at `/opt/chatwoot/storage`, shared
across pods.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### E. Secret Manager

One Chatwoot-specific secret is generated automatically and stored in Secret
Manager: `SECRET_KEY_BASE` (Rails' session-signing / ActiveRecord-encryption key,
shared identically between the web and Sidekiq processes). The database password is
managed separately by the foundation. On GKE, secrets are projected into pods via
the Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~chatwoot"
  gcloud secrets versions access latest --secret=secret-<resource-prefix>-chatwoot-secret-key-base --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`, `reserve_static_ip = true` so the address survives
redeploys). A custom domain with a Google-managed certificate can be enabled.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr (both the Rails and Sidekiq processes, since they share a
container) flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

See [App_GKE](App_GKE.md) for uptime check gating and alert policy wiring.

---

## 3. Chatwoot Application Behaviour

- **First-deploy database setup runs as two chained Jobs.** `db-init` (image
  `postgres:15-alpine`) connects to Cloud SQL, idempotently creates the database
  role and database, grants privileges, grants `cloudsqlsuperuser` to the app role
  (needed because Cloud SQL's app user is not a real Postgres superuser and
  `db:chatwoot_prepare`'s `schema.rb` calls `enable_extension` for several
  extensions), and pre-creates `vector`, `pg_stat_statements`, `pg_trgm`, and
  `pgcrypto` defensively. `chatwoot-prepare` then depends on `db-init` and runs
  `bundle exec rails db:chatwoot_prepare` using the **built Chatwoot app image**
  (not a generic client image) so the full Rails toolchain and config are present.
  Both jobs run on `execute_on_apply = true`.
- **No in-container migrations.** Schema creation/upgrade is entirely handled by the
  `chatwoot-prepare` initialization Job before the app container is expected to
  serve traffic — the runtime entrypoint does not run `rails db:migrate`.
- **DB env-var aliasing.** The platform injects `DB_HOST` (the proxy sidecar,
  `127.0.0.1` on GKE), `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`; the cloud
  entrypoint (`cloud-entrypoint.sh`, baked into the image) maps these onto
  Chatwoot's `POSTGRES_HOST`/`POSTGRES_PORT`/`POSTGRES_DATABASE`/
  `POSTGRES_USERNAME`/`POSTGRES_PASSWORD` convention.
  <!-- TODO: could not confirm whether App_GKE also forwards db_host_env_var_name / db_user_env_var_name aliasing vars for Chatwoot; the entrypoint does its own mapping regardless, so these Foundation-mirror variables in Group 16 are effectively unused for this app. -->
- **Redis URL is self-healing.** If `REDIS_URL` is not already set, the entrypoint
  builds it from the injected `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` — this covers
  both the explicit `redis_host` case and the default NFS-fallback case, so leaving
  `redis_host` blank still produces a working `REDIS_URL` at container start.
- **Sidekiq runs co-located, in the background.** `cloud-entrypoint.sh` starts
  `bundle exec sidekiq -C config/sidekiq.yml &` before exec'ing the Rails server; a
  `trap` on `TERM`/`INT` stops Sidekiq alongside the container. Because Sidekiq
  processes background jobs (channel delivery, notifications, reports) only while a
  pod is alive, keep `min_instance_count >= 1` in production.
- **Admin/first-run account.** Chatwoot's own onboarding UI creates the first admin
  account interactively at `/installation/onboarding` on first visit — there is no
  auto-generated admin credential secret for this module.
  <!-- TODO: could not confirm the exact first-run onboarding route/behaviour from the wiring files alone; verified against general Chatwoot self-hosted conventions, not this repo's source. -->
- **Health path.** Startup and liveness probes are **HTTP** `GET /` (the login/
  onboarding page returns 200 with no auth); the readiness probe set by the Common
  module (`initial_delay_seconds = 30`) also targets `/`. Allow time on first boot —
  `chatwoot-prepare` must finish before the app container even starts.
- **Cloud SQL proxy shutdown signal.** Both init Jobs `wget`/`curl`-POST to the
  proxy sidecar's `--quitquitquit` endpoint (`127.0.0.1:9091/quitquitquit`) on exit
  so the Job pod completes instead of hanging on a live sidecar.
- **Inspect the init jobs and running config:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl logs -n "$NAMESPACE" job/<chatwoot-prepare-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'POSTGRES_|REDIS_'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Chatwoot are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `chatwoot` | Base name for resources. Do not change after first deploy. |
| `application_version` | `v4.15.1` | `chatwoot/chatwoot` image tag used as the custom-build base. Increment to trigger a rebuild. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_resources.cpu_limit` | `2000m` | 2 vCPU — Rails + co-located Sidekiq worker. |
| `container_resources.memory_limit` | `4Gi` | 4 GiB minimum recommended; both processes share the container. |
| `min_instance_count` | `1` | Keep at 1 so the Sidekiq worker (and ActionCable) stay alive. |
| `max_instance_count` | `5` | Standard horizontal scaling ceiling. |
| `container_port` | `3000` | Chatwoot's Rails server port. |
| `container_image_source` | `custom` | Custom-built from `chatwoot/chatwoot`; do not set to `prebuilt`. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar (loopback) — required on GKE. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the Chatwoot UI. |
| `workload_type` | `null` → `Deployment` | Standard Deployment (no PVC needed by default). |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |

### Group 9 — Reliability

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Limits simultaneous voluntary pod evictions. |
| `pdb_min_available` | `"1"` | Keeps at least one pod (and its Sidekiq worker) available during disruptions. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS is on by default so attachments persist and are shared. |
| `nfs_mount_path` | `/opt/chatwoot/storage` | Where Chatwoot stores uploaded attachments. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Required for Sidekiq queueing and ActionCable pub/sub; forwarded to the foundation unconditionally. |
| `redis_host` | `""` | Blank uses the shared NFS-server-hosted Redis IP that the Foundation injects. |
| `redis_port` | `6379` | Redis TCP port. |
| `redis_auth` | `""` | Redis AUTH password, if the target instance requires one. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed by the Common module's config output (also hardcoded in the Common `config.database_type`); Chatwoot requires PostgreSQL 15+ with pgvector. |
| `application_database_name` | `chatwoot` | Database name. Immutable after first deploy. |
| `application_database_user` | `chatwoot` | Application database user; password auto-generated in Secret Manager. |
| `enable_postgres_extensions` | `true` (Common default) | Enables `vector` post-provisioning; `db-init.sh` also pre-creates it defensively. |

### Group 1 — Search & Optional Integrations

| Variable | Default | Description |
|---|---|---|
| `elasticsearch_url` | `""` | Optional Elasticsearch endpoint (e.g. from `Elasticsearch_GKE`) for Chatwoot's full-text search. Leave empty to disable. |
| `elasticsearch_username` | `""` | Elasticsearch username; leave empty when `xpack.security.enabled` is false. |
| `elasticsearch_password_secret` | `""` | Secret Manager secret ID holding the Elasticsearch password; when set, injected as `ELASTICSEARCH_PASSWORD` and granted `secretAccessor`. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `application_domains` | `[]` | Custom hostnames + managed certificate. |

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
| `service_url` | URL to reach Chatwoot. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup (`db-init`, `chatwoot-prepare`) and (optional) import jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — mismatched workload-type/PVC settings, IAP enabled with no authorized identities, `quota_memory_*` given as bare integers, an out-of-range `container_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (fixed by Common) | Critical | Chatwoot's schema and pgvector-backed search require Postgres 15+; any other engine breaks `chatwoot-prepare`. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all data. |
| `SECRET_KEY_BASE` (auto-generated) | Never change | Critical | Rotating it invalidates every signed session/cookie and makes ActiveRecord-encrypted columns permanently unreadable; Sidekiq will also fail to decrypt in-flight jobs. |
| `enable_redis` | `true` (forwarded unconditionally) | Critical | Sidekiq (background jobs, channel delivery) and ActionCable (real-time UI) both require Redis; disabling it silently breaks message delivery even though the web UI loads. |
| `min_instance_count` | `1` | High | Below 1, the co-located Sidekiq worker is not running between requests, so background jobs (channel polling, notifications, reports) stall between cold starts. |
| `enable_nfs` | `true` | High | Disabling it makes uploaded attachments ephemeral — lost on pod recreation. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar on `127.0.0.1:5432` is required for DB connectivity on GKE. |
| `chatwoot-prepare` job order | Runs after `db-init` (`depends_on_jobs = ["db-init"]`) | High | Running schema prep before the database/role/extension grants exist fails the Job (`must be superuser` on `CREATE EXTENSION`, or the DB/role missing entirely). |
| `container_image_source` | `custom` | High | Chatwoot is a Docker Hub prebuilt image wrapped in a custom entrypoint (env mapping + Sidekiq launch); switching to `prebuilt` skips that wrapper and the container won't map `DB_*`/`REDIS_*` correctly. |
| `pdb_min_available` | `"1"` | Medium | Voluntary node maintenance/upgrades could otherwise evict the only pod running Sidekiq, pausing background processing. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and any configured webhook/channel callback URLs. |
| `ENABLE_ACCOUNT_SIGNUP` | `"false"` (default) | Medium | Leaving public self-service signup enabled on an internet-facing helpdesk lets anyone register an agent/admin account. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention of conversation/customer data. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Chatwoot-specific application configuration shared with the Cloud Run variant is
described in the Chatwoot_Common module (`modules/Chatwoot_Common`); a dedicated
`Chatwoot_Common.md` guide has not been published yet.
