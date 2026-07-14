---
title: "Flarum on GKE Autopilot"
description: "Configuration reference for deploying Flarum on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Flarum on GKE Autopilot

Flarum is a free, open-source forum and discussion platform — a modern,
extensible alternative to traditional bulletin-board software, built on PHP
with a JavaScript/Mithril front end and a REST API. This module deploys
Flarum on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation,
which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

This guide focuses on the cloud services Flarum uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Flarum runs as a single nginx + php-fpm workload built from the
`mondedie/flarum` community image. The deployment wires together a focused
set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | nginx/php-fpm pod on port 8888, 1 vCPU / 2 GiB by default |
| Database | Cloud SQL for MySQL 8.0 | Required — the engine is fixed at `MYSQL_8_0` |
| File persistence | Cloud Filestore (NFS) | User-uploaded avatars/attachments persist under `/flarum/app/public/assets`, shared across pods |
| Object storage | Cloud Storage | A `flarum-assets` bucket is provisioned automatically (not mounted by default — see below) |
| Secrets | Secret Manager | Auto-generated `FLARUM_ADMIN_PASS`; database password managed separately |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** `Flarum_Common` hardcodes `database_type =
  "MYSQL_8_0"` in its output config; the variant's `database_type` variable
  only takes effect if explicitly overridden away from its `null` default.
- **Cloud SQL is reached via the Auth Proxy sidecar on loopback.**
  `Flarum_Common` explicitly overrides `DB_HOST = "127.0.0.1"` because the
  mondedie/flarum image's own installer reads `DB_HOST` directly; a
  cloud-sql-proxy sidecar (`enable_cloudsql_volume = true`) listens on
  `127.0.0.1:3306`.
- **Single replica by default.** `min_instance_count = 1`,
  `max_instance_count = 1`. The workload is NFS-backed
  (`enable_nfs = true`), so per the shared Foundation behaviour a redeploy
  uses the `Recreate` rollout strategy rather than `RollingUpdate` — do not
  raise `max_instance_count` without verifying Flarum's behaviour under
  multiple concurrent pods sharing the same NFS assets volume and database.
- **NFS is enabled by default** (`enable_nfs = true`, mounted at
  `/flarum/app/public/assets`) so user avatars and attachments persist and
  are shared across pods.
- **A `flarum-assets` GCS bucket is created but not mounted anywhere by
  default.** `Flarum_Common` provisions a Cloud Storage bucket
  (`storage_buckets` output, suffix `flarum-assets`), but no default
  `gcs_volumes` entry references it — it sits unused unless you add one
  explicitly. NFS, not GCS Fuse, is what actually backs the assets
  directory out of the box.
- **Session affinity is `ClientIP`** so a client's requests reach the same
  pod.
- **First-boot auto-install (no separate migration job).** The base image's
  own s6-overlay entrypoint runs Flarum's installer on first container
  start, reading `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASS`/`DB_PREF`,
  `FORUM_URL`, and the `FLARUM_ADMIN_*` variables. There is no separate
  migration job — the Dockerfile is a thin, unmodified wrapper over
  `mondedie/flarum` (only `EXPOSE 8888` and a build-arg-selected base tag).
- **`FLARUM_ADMIN_PASS` is generated automatically** and stored in Secret
  Manager. The admin username and email are **fixed by `Flarum_Common`'s
  defaults** (`admin` / `admin@techequity.cloud`) — they are not exposed as
  Application Module variables on this variant, so retrieve the generated
  password before first login rather than expecting to configure the
  username/email.
- **`FORUM_URL` is NOT wired on GKE — a known gap.** `Flarum_Common` only
  sets the `FORUM_URL` environment variable when its `service_url` input is
  non-empty, but `Flarum_GKE`'s wiring never passes `service_url` into the
  Common module call. As a result `FORUM_URL` is absent by default on this
  variant and must be set manually via `environment_variables` after the
  external IP or custom domain is known — otherwise Flarum generates
  incorrect absolute links, asset URLs, and forum redirects.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and
other identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Flarum workload

Flarum's pod is scheduled on Autopilot, which bills for the CPU/memory the
pod actually requests. Because the workload is NFS-backed, updates use the
`Recreate` strategy (a rolling update would run two pods against the same
NFS assets volume and shared DB simultaneously).

- **Console:** Kubernetes Engine → Workloads → select the Flarum workload
  for pods, revisions, and events. Kubernetes Engine → Services & Ingress
  shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for MySQL 8.0

Flarum stores all forum data (discussions, posts, users, tags) in a managed
Cloud SQL for MySQL 8.0 instance, with tables prefixed `flarum_`. Pods reach
it through the **Cloud SQL Auth Proxy** sidecar on `127.0.0.1:3306`; no
public IP is exposed. On first deploy the `db-init` job creates the
application database, user, and grants; the Flarum installer then creates
the schema on first pod boot.

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

### C. Cloud Storage & file persistence

A **Cloud Storage** bucket (suffix `flarum-assets`) is provisioned
automatically and the workload service account is granted access, but it is
not mounted into the pod by default — add an entry to `gcs_volumes` if you
want to use it. Separately, Flarum's uploaded avatars and attachments live
on **NFS (Cloud Filestore)** at `/flarum/app/public/assets`, shared across
pods.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~flarum-assets"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Secret Manager

One Flarum secret is generated automatically and stored in Secret Manager:
`FLARUM_ADMIN_PASS` (the first-run administrator password, ≥8 characters).
The admin username and email are fixed at `admin` /
`admin@techequity.cloud` and are not stored as secrets. The database
password is managed separately by the foundation. On GKE, secrets are
projected into pods via the Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~flarum"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and
rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load
Balancing IP (`service_type = LoadBalancer`, `reserve_static_ip = true` so
the address survives redeploys). A custom domain with a Google-managed
certificate can be enabled (`enable_custom_domain = true` by default, with
no domains configured until you add one).

- **Console:** Network services → Load balancing; VPC network → IP
  addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to
Cloud Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Flarum Application Behaviour

- **First-deploy database setup.** The `db-init` job runs `db-init.sh` using
  `mysql:8.0-debian`. It connects to Cloud SQL (preferring the Unix socket
  under `/cloudsql` provided by the Auth Proxy sidecar, polling up to 30s
  for the socket to appear, and falling back to TCP against `DB_IP`/`DB_HOST`
  otherwise), idempotently creates the application database (`CREATE
  DATABASE IF NOT EXISTS`) and user (`CREATE USER IF NOT EXISTS` followed by
  an unconditional `ALTER USER ... IDENTIFIED BY` so the password always
  stays in sync) and grants (`GRANT ALL PRIVILEGES ON <db>.* TO <user>@'%'`),
  verifies the app user can connect, then gracefully shuts down the proxy
  sidecar via `/quitquitquit`. The job is safe to re-run
  (`execute_on_apply = true`, `max_retries = 3`).
- **First-boot auto-install (no separate migration job).** The
  `mondedie/flarum` image's own s6-overlay entrypoint runs the Flarum
  installer on first pod start, creating the schema in the empty database.
  The custom Dockerfile is an unmodified thin wrapper over the base image —
  it neither overrides `ENTRYPOINT` nor adds a migrate step.
- **Admin account.** The installer creates a first-run administrator whose
  username is `admin` and email is `admin@techequity.cloud` (fixed
  `Flarum_Common` defaults, not exposed as module variables) and whose
  password is the generated `FLARUM_ADMIN_PASS` secret. Retrieve it before
  first login.
- **DB env-var wiring.** `Flarum_GKE`'s `main.tf` sets
  `db_user_env_var_name = "DB_USER"`, `db_password_env_var_name =
  "DB_PASS"`, and `db_name_env_var_name = "DB_NAME"` on the Foundation
  call — the exact env names the mondedie/flarum installer expects — so no
  alias entrypoint is needed. `Flarum_Common` additionally sets
  `DB_PORT = "3306"` and `DB_PREF = "flarum_"` directly in
  `environment_variables`, and overrides `DB_HOST = "127.0.0.1"` for the
  Auth Proxy sidecar.
- **NFS-backed rollouts use `Recreate`.** Updates terminate the old pod
  before starting the new one, avoiding two pods deadlocking on the shared
  NFS assets volume and DB locks.
- **`FORUM_URL` must be set manually.** It is never populated by default on
  GKE (see the Overview gap above) — set it via `environment_variables`
  once the LoadBalancer IP or custom domain is known:
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"flarum","env":[
      {"name":"FORUM_URL","value":"https://forum.example.com"}]}]}}}}'
  ```
- **Health paths.** The application-specific `startup_probe` defaults to a
  **TCP** check on the container port (8888) with a generous
  `failure_threshold = 20` at `period_seconds = 15` (five minutes of grace)
  to accommodate the first-boot installer. The application-specific
  `liveness_probe` defaults to **HTTP** `GET /` with an `initial_delay_seconds
  = 300` (five minutes) before the first check — again to avoid killing the
  pod mid-install.
- **Redis (optional).** `enable_redis` defaults to `false`. When enabled
  without an explicit `redis_host`, plan-time validation requires
  `enable_nfs = true` (the shared NFS server also hosts Redis, and the
  Foundation injects its IP as `REDIS_HOST`) — otherwise the apply fails
  with a clear error rather than deploying a forum that can't reach Redis.
- **Inspect the init job and running config:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E '^(DB_|FORUM_URL|FLARUM_ADMIN)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform.
Only settings specific to or notable for Flarum are listed; every other
input is inherited from [App_GKE](App_GKE.md) with its standard behaviour
and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `flarum` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `mondedie/flarum` image tag, mapped via the `FLARUM_VERSION` build ARG. `latest` resolves to the image's own `stable` (production-recommended) tag at build time. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU for nginx + php-fpm. |
| `memory_limit` | `2Gi` | Minimum 512Mi enforced by the gen2 floor concept on Cloud Run; on GKE, size for PHP workload. |
| `php_memory_limit` | `512M` | PHP memory limit; raise for heavy extensions or large forums. |
| `upload_max_filesize` / `post_max_size` | `64M` | Max upload / POST size; `upload_max_filesize` must be ≤ `post_max_size` (enforced at plan time). |
| `min_instance_count` | `1` | Keep at 1 to keep the forum reachable. |
| `max_instance_count` | `1` | **Keep at 1** unless multi-pod NFS/DB sharing is verified; plan-time validation requires `min_instance_count ≤ max_instance_count`. |
| `container_port` | `8888` | mondedie/flarum serves nginx + php-fpm on 8888. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar (loopback) — required on GKE while `database_type != "NONE"` (enforced at plan time). |
| `container_image_source` | `custom` | Thin build FROM `mondedie/flarum`, re-tagged via the `FLARUM_VERSION` build ARG. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the Flarum UI. |
| `workload_type` | `null` → `Deployment` | Deployment (NFS-backed, `Recreate` strategy). |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `{ type = "TCP", path = "/", initial_delay_seconds = 30, period_seconds = 15, failure_threshold = 20 }` | Flarum-specific startup probe — TCP port check with a five-minute grace window for the first-boot installer. |
| `liveness_probe` | `{ type = "HTTP", path = "/", initial_delay_seconds = 300, period_seconds = 60, failure_threshold = 3 }` | Flarum-specific liveness probe — five-minute initial delay to avoid killing the pod mid-install. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS is on by default so uploaded avatars/attachments persist and are shared. |
| `nfs_mount_path` | `/flarum/app/public/assets` | Where Flarum stores user-uploaded assets. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Optional object cache backend. |
| `redis_host` / `redis_port` | `""` / `6379` | When `redis_host` is left empty, requires `enable_nfs = true` (validated at plan time) so the Foundation-injected shared Redis IP can be used. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` | `Flarum_Common` hardcodes MySQL 8.0; this variable only matters if explicitly overridden. |
| `application_database_name` | `flarum` | Database name. Immutable after first deploy. |
| `application_database_user` | `flarum` | Application database user; password auto-generated in Secret Manager. |

### Group 16 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | User-configurable extra buckets — created alongside (not instead of) the Common-supplied `flarum-assets` bucket. |
| `gcs_volumes` | `[]` | No bucket is mounted into the pod by default; add an entry here to actually use `flarum-assets` or `data` as a filesystem mount. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `enable_custom_domain` | `true` | Provisions an Ingress; `application_domains` is empty by default. |
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
| `service_url` | URL to reach Flarum. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
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

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_GKE](App_GKE.md) foundation engine, which validates
> values *and combinations* at plan time — a `StatefulSet` forced alongside
> a stateless setting, IAP with no authorized identities, `quota_memory_*`
> given as bare integers, an out-of-range `container_port`/
> `backup_retention_days`. Flarum additionally has its own preconditions
> (`min_instance_count ≤ max_instance_count`, `enable_redis` requiring
> `redis_host` or `enable_nfs`, IAP requiring both OAuth credentials,
> `enable_cloudsql_volume` requiring a real database engine, and
> `upload_max_filesize ≤ post_max_size`). Invalid configuration fails the
> **plan** with a clear, named error before any resource is created, so most
> mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critical | Selecting a non-MySQL engine breaks the installer and every query. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all data. |
| `FORUM_URL` (not preset — set manually) | External LoadBalancer/domain URL | High | Left unset, Flarum generates broken absolute links, asset URLs, and redirects; this variant does not auto-inject it. |
| `enable_nfs` | `true` | High | Disabling it makes uploaded avatars/attachments ephemeral — lost on pod recreation. |
| `enable_cloudsql_volume` | `true` (with a real `database_type`) | High | The Auth Proxy sidecar on `127.0.0.1:3306` is required for DB connectivity on GKE; enabling it with `database_type = "NONE"` fails plan-time validation. |
| `max_instance_count` | `1` | High | Scaling beyond 1 without verified shared-storage/lock behaviour risks split sessions and NFS/DB lock contention. |
| `session_affinity` | `ClientIP` | High | Without stickiness, requests bounce between pods and disrupt authenticated sessions. |
| `enable_redis` + `redis_host` | Leave `redis_host` empty only if `enable_nfs = true` | High | Violating this combination fails plan-time validation rather than deploying a forum that can't reach Redis. |
| `memory_limit` | `2Gi` | High | Undersizing PHP-FPM under load risks OOM kills. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `FLARUM_ADMIN_PASS` (auto-generated) | Retrieve before first login | Medium | Not knowing it locks you out of the first administrator account until reset via the DB. |
| `gcs_volumes` (empty by default) | Add an entry to actually use `flarum-assets` | Medium | The `flarum-assets` bucket is billed and created but does nothing unless explicitly mounted. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and `FORUM_URL`. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Flarum-specific application configuration shared
with the Cloud Run variant is described in
**[Flarum_Common](Flarum_Common.md)**.
