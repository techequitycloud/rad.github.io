---
title: "Mixpost on GKE Autopilot"
description: "Configuration reference for deploying Mixpost on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Mixpost on GKE Autopilot

Mixpost is an open-source, self-hosted social media scheduling and management
platform — a Buffer/Hootsuite alternative for composing, scheduling, publishing,
and analysing posts across multiple social accounts from one dashboard. It ships
as a Laravel application (nginx + PHP-FPM + supervisord running the queue worker
and scheduler inside one container). This module deploys Mixpost on **GKE
Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and
manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Mixpost uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

Mixpost runs as a single, self-contained web workload (the official
`inovector/mixpost` image). The deployment wires together a focused set of Google
Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | nginx + PHP-FPM + supervisord pod on port 80, 2 vCPU / 2 GiB by default |
| Database | Cloud SQL for MySQL 8.0 | Required — the engine is fixed at `MYSQL_8_0` |
| Queue, cache & sessions | Redis | Enabled by default; drives `QUEUE_CONNECTION`/`CACHE_DRIVER`/`SESSION_DRIVER`; defaults to the co-located NFS server IP when no external host is given |
| File persistence | Cloud Filestore (NFS) | Media/uploads persist under `/mnt/nfs`, shared across pods; also the default Redis host source |
| Object storage | Cloud Storage | A `storage` bucket provisioned automatically by `Mixpost_Common` |
| Secrets | Secret Manager | Auto-generated Laravel `APP_KEY`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed by the shared
  application layer (`Mixpost_Common` sets `database_type = "MYSQL_8_0"` and
  `DB_CONNECTION = "mysql"`); other engines are not supported.
- **Cloud SQL is reached via the Auth Proxy sidecar over plain TCP loopback, not a
  socket.** The variant sets `DB_HOST = 127.0.0.1`; on GKE the Cloud SQL Auth
  Proxy (`enable_cloudsql_volume = true`) is a plain TCP listener on
  `127.0.0.1:3306` (unlike Cloud Run's Unix socket). **Keep this `true`** —
  disabling it makes the `db-init` job connect over the private IP and finish
  before the proxy starts, so its `quitquitquit` shutdown signal misses and the
  proxy sidecar runs forever, hanging the job.
- **Redis is on by default and effectively required.** `enable_redis = true`
  wires `QUEUE_CONNECTION`, `CACHE_DRIVER`, and `SESSION_DRIVER` to `redis`
  (falling back to `sync`/`file` only when disabled). When `redis_host` is empty,
  the module defaults to the NFS server IP — a plan-time validation guard
  enforces that either `redis_host` is set or `enable_nfs` is `true`.
- **`min_instance_count = 1`, `max_instance_count = 5`.** Unlike the Cloud Run
  variant's cold-start default, GKE keeps at least one pod running continuously,
  so the supervisord-managed Laravel scheduler and queue worker operate without
  any external cron — the CLAUDE.md convention of externalising scheduled work
  via Cloud Scheduler (used for the Cloud Run variant's `schedule:run`) does
  **not** apply here.
- **NFS is enabled by default** (`enable_nfs = true`, mounted at `/mnt/nfs`) for
  shared media/file storage, and doubles as the default Redis host.
- **Session affinity is `ClientIP`** so a client's requests reach the same pod.
- **No separate migration job.** The prebuilt `inovector/mixpost` image runs
  `php artisan migrate --force` and seeds the admin account itself on every boot
  via its built-in supervisord entrypoint; the only init job is the idempotent
  `db-init` database/user creation.
- **Laravel DB env mapping.** `main.tf` hardcodes
  `db_user_env_var_name = "DB_USERNAME"` and `db_name_env_var_name = "DB_DATABASE"`
  so the tenant-scoped `DB_USER`/`DB_NAME` the Foundation creates are exposed
  under the names Laravel's `env()` actually reads — this is not
  operator-configurable.
- **`APP_KEY` is generated automatically** and stored in Secret Manager; the GKE
  variant suffixes its resource prefix with `-gke` so the secret does not collide
  with a same-tenant Cloud Run deployment.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Mixpost workload

Mixpost pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Because the workload is NFS-backed by default, the Deployment
uses the `Recreate` strategy (a rolling update would run two pods against the
same NFS volume and shared DB and deadlock).

- **Console:** Kubernetes Engine → Workloads → select the Mixpost workload for
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

### B. Cloud SQL for MySQL 8.0

Mixpost stores all application data (accounts, posts, media metadata, users) in
a managed Cloud SQL for MySQL 8.0 instance. Pods reach it through the **Cloud SQL
Auth Proxy** sidecar listening on `127.0.0.1:3306` (plain TCP loopback — not a
Unix socket on GKE). On first deploy the `db-init` job creates the application
database (`utf8mb4`/`utf8mb4_0900_ai_ci`), user, and grants, then signals the
proxy sidecar to shut down.

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

### C. Redis — queue, cache & sessions

Mixpost's background publishing pipeline, response cache, and sessions all run
through Redis when `enable_redis = true` (the default). No dedicated Memorystore
instance is provisioned by this module — unless `redis_host` is overridden to an
external instance, Redis is expected to be reachable at the NFS server IP (the
same Compute Engine VM that serves NFS also runs Redis in this repository's
shared-infrastructure convention).

- **Console:** Memorystore → Redis instances (only if you point `redis_host` at
  a managed instance); otherwise Compute Engine → VM instances for the NFS/Redis
  host.
- **CLI:**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'QUEUE_CONNECTION|CACHE_DRIVER|SESSION_DRIVER|REDIS'
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

### D. Cloud Storage & file persistence (NFS)

A dedicated **Cloud Storage** bucket (suffix `storage`) is provisioned
automatically and the workload service account is granted access. Separately,
Mixpost's media/upload tree lives on **NFS (Cloud Filestore)** at `/mnt/nfs`,
shared across pods.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### E. Secret Manager

One Mixpost-specific secret is generated automatically: the Laravel `APP_KEY`
(`secret-<resource_prefix>-gke-mixpost-app-key`), a random 32-character value
base64-encoded in Laravel's native `base64:<value>` format. The database
password is managed separately by the foundation. On GKE, secrets are projected
into pods via the Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~mixpost"
  gcloud secrets versions access latest --secret=<app-key-secret-name> --project "$PROJECT"
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

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Mixpost Application Behaviour

- **First-deploy database setup.** The `db-init` job runs `scripts/db-init.sh`
  using `mysql:8.0-debian`. It connects through the Cloud SQL Auth Proxy sidecar
  over TCP (`--get-server-public-key`, needed because `caching_sha2_password`
  refuses to send a password over an unencrypted-looking loopback connection),
  idempotently creates the application database with `utf8mb4`/
  `utf8mb4_0900_ai_ci`, drops and recreates the application user, grants
  privileges, verifies the app user can connect, then POSTs `quitquitquit` to the
  proxy sidecar on port 9091 to shut it down. The job is safe to re-run
  (`execute_on_apply = true`, `max_retries = 1`).
- **No separate migration job.** The prebuilt `inovector/mixpost` image's
  built-in supervisord entrypoint runs `php artisan migrate --force` and seeds
  the admin account on every boot; there is no distinct migrate init job.
- **Admin account defaults are baked into the image, not configurable via this
  module.** Initial login defaults to `admin@example.com` / `changeme` regardless
  of `mixpost_admin_email` — that variable is declared for variant forwarding but
  is **not currently injected** into the running config (the image seeds the
  admin account itself). Change the admin password immediately after first
  login.
- **DB env-var mapping.** The Foundation injects `DB_HOST` (`127.0.0.1`, the
  proxy sidecar), `DB_PORT`, and `DB_PASSWORD`; `main.tf` hardcodes
  `db_user_env_var_name = "DB_USERNAME"` and `db_name_env_var_name = "DB_DATABASE"`
  so the tenant-scoped database user/name land on the Laravel-native variable
  names.
- **Redis wiring.** `QUEUE_CONNECTION`, `CACHE_DRIVER`, and `SESSION_DRIVER` are
  set to `redis` when `enable_redis = true` (the default), falling back to
  `sync`/`file` otherwise. `Mixpost_Common` does **not** set these itself — the
  GKE variant's own `main.tf` locals merge sets them based on `enable_redis`.
- **NFS-backed rollouts use `Recreate`.** Updates terminate the old pod before
  starting the new one, avoiding two pods deadlocking on the shared NFS volume
  and DB locks.
- **Health probes are TCP, not HTTP, at the pod level.** Mixpost answers `/`
  with a `302` redirect to `https://<app_url>/`; the GKE kubelet HTTP probe
  **follows redirects**, landing on `https://<pod-ip>:443` where nothing
  listens — connection refused, probe failure, restart loop (`0/1` pods) even
  though the app serves fine on `:80`. `startup_probe_config` and
  `health_check_config` (the variables the Foundation actually uses for the
  Deployment's `startupProbe`/`livenessProbe`) therefore default to
  `type = "TCP"` on port 80. (Cloud Run's probe does not follow redirects, which
  is why the same HTTP probe works unmodified on that variant.) The separate
  `startup_probe`/`liveness_probe` variables forwarded into the application
  config default to HTTP and are cosmetic at the config-object level — the real
  pod probes come from `startup_probe_config`/`health_check_config`.
- **Scheduler runs continuously in-pod.** With `min_instance_count = 1`, one pod
  is always running, so the supervisord-managed Laravel scheduler and queue
  worker publish scheduled posts without any external Cloud Scheduler wiring
  (a contrast with the Cloud Run variant's cold-start default, which needs an
  externalised `schedule:run` cron hit).
- **Inspect the init job and running config:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_|APP_KEY|QUEUE_CONNECTION'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Mixpost are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `mixpost` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `inovector/mixpost` image tag deployed directly (prebuilt, no custom build). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Deploys `inovector/mixpost` directly; forwarded explicitly so the Foundation does not treat this as a custom build with no Dockerfile. |
| `cpu_limit` | `2000m` | 2 vCPU default. |
| `memory_limit` | `2Gi` | 2 GiB default. |
| `min_instance_count` | `1` | Keeps the in-pod Laravel scheduler/queue worker running continuously. |
| `max_instance_count` | `5` | HPA maxReplicas ceiling. |
| `container_port` | `80` | nginx + PHP-FPM serve plain HTTP. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar (TCP loopback) — required on GKE; disabling it hangs the `db-init` job. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the Mixpost UI. |
| `workload_type` | `null` → `Deployment` | Deployment (NFS-backed, `Recreate` strategy). |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | TCP `/`, 90s delay, period 15s, failure_threshold 20 | The actual pod-level startup probe. TCP avoids the 302-redirect trap. |
| `health_check_config` | TCP `/`, 120s delay, period 30s, failure_threshold 3 | The actual pod-level liveness probe. TCP for the same reason. |
| `startup_probe` / `liveness_probe` | HTTP `/` (90s / 120s) | Forwarded into the application config object; cosmetic — superseded by the TCP probes above for the real Deployment spec. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS is on by default for shared media/uploads, and doubles as the default Redis host source. |
| `nfs_mount_path` | `/mnt/nfs` | Where Mixpost stores media/uploads. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Wires `QUEUE_CONNECTION`/`CACHE_DRIVER`/`SESSION_DRIVER` to `redis`. Plan-time guard requires `redis_host` set or `enable_nfs = true`. |
| `redis_host` | `""` → NFS server IP | Override to point at an external Redis/Memorystore instance. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Redis AUTH password, if the target instance requires one. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed by `Mixpost_Common`; not overridable to another engine. |
| `application_database_name` | `mixpost` | Database name. Immutable after first deploy. |
| `application_database_user` | `mixpost` | Application database user; password auto-generated in Secret Manager. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `application_domains` | `[]` | Custom hostnames + managed certificate. |

### Group 23 — Mixpost Application Settings

| Variable | Default | Description |
|---|---|---|
| `mixpost_admin_email` | `admin@example.com` | Declared for variant forwarding; **not currently injected into the running config** — the image seeds `admin@example.com` / `changeme` itself regardless. |
| `mail_from_name` | `Mixpost` | Sender display name on outgoing emails. |
| `mail_from_address` | `mixpost@example.com` | Sender address on outgoing emails. |

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
| `service_url` | URL to reach Mixpost. |
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

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `StatefulSet` forced alongside a stateless setting, IAP with no authorized identities, `quota_memory_*` given as bare integers, an out-of-range `container_port`/`backup_retention_days`. `Mixpost_GKE`'s own `validation.tf` adds four more guards (min/max instance ordering, Redis host source, IAP OAuth credentials, Cloud SQL volume vs `database_type = "NONE"`). Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` (fixed) | Critical | Not overridable to another engine; `Mixpost_Common` hardcodes MySQL regardless of this variable's face value. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all data. |
| `APP_KEY` (auto-generated) | Never change | Critical | Rotating the Laravel key after first boot invalidates encrypted session/cookie data and any encrypted DB fields. |
| `enable_cloudsql_volume` | `true` | Critical | Disabling it makes the `db-init` job's `quitquitquit` shutdown signal miss the not-yet-started proxy, hanging the job indefinitely on GKE. |
| `enable_redis` + `redis_host` / `enable_nfs` | `true` + NFS on, or an explicit `redis_host` | High | Enabling Redis with no host source (no `redis_host`, no NFS) leaves `REDIS_HOST` empty — blocked at plan time by `validation.tf`, but overriding both to off/empty breaks queueing, caching, and sessions. |
| `startup_probe_config` / `health_check_config` | `type = "TCP"` | High | Switching these to HTTP reintroduces the 302-redirect-to-`:443` failure — the Deployment restart-loops at `0/1` even though the app is healthy. |
| `enable_nfs` | `true` | High | Disabling it removes both shared media persistence and (unless `redis_host` is set) the default Redis host, degrading publishing reliability. |
| `min_instance_count` | `1` | High | Scaling to `0` stops the in-pod Laravel scheduler and queue worker — scheduled social posts silently stop publishing. |
| `mixpost_admin_email` | Retrieve real credentials post-deploy | Medium | The variable is not injected into the running config; the first login is always `admin@example.com` / `changeme` regardless — change it immediately after first login. |
| `memory_limit` | `2Gi` | High | Below the working set for PHP-FPM + supervisord-managed workers, pods OOM under load. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and any registered social-platform OAuth redirect URIs. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Mixpost-specific application configuration (the `APP_KEY` secret, the `db-init`
script, and the environment variables merged into the container) is shared with
the Cloud Run variant via the internal `Mixpost_Common` module, which is not
deployed directly and does not yet have its own configuration guide.
