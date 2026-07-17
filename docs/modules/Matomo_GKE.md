---
title: "Matomo on GKE Autopilot"
description: "Configuration reference for deploying Matomo on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Matomo on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Matomo_GKE.png" alt="Matomo on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Matomo is the leading open-source web analytics platform and a privacy-focused,
self-hosted alternative to Google Analytics — no data sampling, GDPR/CCPA-friendly
tracking, heatmaps, session recordings, A/B testing, and funnel analytics, with 100%
ownership of the collected data. This module deploys Matomo on **GKE Autopilot** on
top of the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Matomo uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

Matomo runs as a single PHP/Apache web workload built from the official prebuilt
image. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | PHP/Apache pods (`matomo:<application_version>`) on port 80, 1 vCPU / 2 GiB by default |
| Database | Cloud SQL for MySQL 8.0 | Required — the engine is fixed at `MYSQL_8_0` |
| File persistence | Cloud Filestore (NFS) | Matomo's document root (`/var/www/html`) persists here, shared across pods |
| Cache | Redis (NFS-VM co-hosted or Memorystore) | Optional object cache; connectivity only — see [Section 6](#6-configuration-pitfalls--sensible-defaults) |
| Object storage | Cloud Storage | A `data` bucket provisioned automatically |
| Secrets | Secret Manager | Auto-generated Cloud SQL application-user password only |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed by the shared
  application layer (`Matomo_Common` hard-codes `database_type = "MYSQL_8_0"`);
  other engines are not supported.
- **The prebuilt official image is used by default.** `container_image_source =
  "prebuilt"` deploys `matomo:<application_version>` (default `5-apache`)
  directly — no Cloud Build step. The image is mirrored into Artifact Registry
  (`enable_image_mirroring = true`) to avoid Docker Hub rate limits.
- **Cloud SQL is reached via the Auth Proxy sidecar on loopback.** GKE injects
  `enable_cloudsql_volume = true` by default; a cloud-sql-proxy sidecar listens
  on `127.0.0.1:3306`, and the platform maps the deployment-scoped DB
  credentials onto `MATOMO_DATABASE_HOST`/`USERNAME`/`DBNAME`/`PASSWORD` — the
  exact env vars Matomo's `EnvironmentVariables` plugin reads to pre-fill the
  web installer's database screen.
- **NFS is enabled by default** (`enable_nfs = true`, mounted at
  `/var/www/html`), persisting Matomo's config (`config.ini.php`), installed
  plugins, and generated assets. The official image's entrypoint populates an
  empty volume from `/usr/src/matomo` on first start.
- **Single replica by default.** `min_instance_count = 1`, `max_instance_count
  = 1`. `session_affinity = ClientIP` keeps a client's requests on the same
  pod; the NFS-backed workload deploys with the `Recreate` update strategy so
  a rolling update never runs two pods against the same NFS volume and shared
  DB simultaneously.
- **No application secrets are auto-generated.** Unlike apps that mint an
  admin-password or instance-salt secret, Matomo's only managed secret is the
  Cloud SQL application-user password. The Matomo super-user account is
  created interactively through the web installer on first browse — there is
  no init job that provisions it.
- **`db-init` creates only the empty database + user; the web installer does
  the rest.** There is no headless schema-migration job — Matomo's own
  installer wizard, reached at the service URL, creates the schema and the
  first admin account.
- **Redis connectivity is wired but not auto-consumed.** `enable_redis = true`
  by default injects `REDIS_HOST`/`REDIS_PORT` into the pod, but nothing in
  this module edits Matomo's `config.ini.php` `[Cache]` backend — using Redis
  as Matomo's object cache still requires manual post-deploy configuration.
  <!-- TODO: verify whether the official Matomo image or a plugin auto-detects
  REDIS_HOST; not confirmed from this repo's sources. -->

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Matomo workload

Matomo pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Because the workload is NFS-backed, the Deployment uses the
`Recreate` strategy (a rolling update would run two pods against the same NFS
volume and shared DB and deadlock).

- **Console:** Kubernetes Engine → Workloads → select the Matomo workload for
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows
  the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for MySQL 8.0

Matomo stores all analytics data (sites, visits, log tables, reports, users)
in a managed Cloud SQL for MySQL 8.0 instance. Pods reach it through the
**Cloud SQL Auth Proxy** sidecar on `127.0.0.1:3306`; no public IP is exposed.
On first deploy the `db-init` job creates the application database, user, and
grants; Matomo's own web installer then creates the schema.

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

A dedicated **Cloud Storage** bucket (default suffix `data`) is provisioned
automatically and the workload service account is granted access. Separately,
Matomo's document root lives on **NFS (Cloud Filestore)** at `/var/www/html`,
shared across pods — config, plugins, and generated report assets persist
there across pod restarts.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~-data"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Secret Manager

The only application secret Matomo consumes is the Cloud SQL application-user
password, generated and managed by the foundation's shared secrets module (no
Matomo-specific admin-password or salt secret is minted). On GKE, secrets are
projected into pods via the Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~matomo"
  gcloud secrets versions access latest --secret=<db-password-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing
IP (`service_type = LoadBalancer`, `reserve_static_ip = true` so the address
survives redeploys). A custom domain with a Google-managed certificate can be
enabled.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
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

## 3. Matomo Application Behaviour

- **First-deploy database setup.** The `db-init` job runs a script using
  `mysql:8.0-debian`. It connects to Cloud SQL (via the Auth Proxy sidecar
  socket, falling back to TCP against the private IP), idempotently creates
  the application database and user, grants privileges, verifies the app user
  can connect, then shuts down the proxy sidecar cleanly (`quitquitquit`, so
  the job exits `0` and is not retried under `restartPolicy: OnFailure`). The
  job is safe to re-run (`execute_on_apply = true`, `max_retries = 3`).
- **No headless schema install.** Matomo does not run a migration job on
  boot. The empty database created by `db-init` is populated by Matomo's own
  installer wizard, reached by browsing to the service URL — it walks through
  system-check, database connection (pre-filled from `MATOMO_DATABASE_*`),
  and creation of the first super-user account.
- **DB env vars pre-fill, not auto-complete, the installer.** The platform
  injects `MATOMO_DATABASE_HOST` (`127.0.0.1` via the proxy sidecar),
  `MATOMO_DATABASE_USERNAME`, `MATOMO_DATABASE_DBNAME`, and
  `MATOMO_DATABASE_PASSWORD` — read by Matomo's `EnvironmentVariables` plugin
  to pre-populate the installer's database-connection screen. You still need
  to walk through the installer to finish setup and create the admin account.
- **Table prefix and adapter are fixed.** `MATOMO_DATABASE_ADAPTER=mysql` and
  `MATOMO_DATABASE_TABLES_PREFIX=matomo_` are set by `Matomo_Common` and are
  not exposed as module variables.
- **NFS-backed rollouts use `Recreate`.** Updates terminate the old pod
  before starting the new one, avoiding two pods deadlocking on the shared
  NFS volume and DB locks.
- **Health probes.** Startup probe is **TCP** on `/` with a generous
  30s initial delay, 15s period, and a 20-attempt failure threshold — giving
  the image entrypoint time to populate the NFS-mounted document root from
  `/usr/src/matomo` and reach the database on first boot. Liveness probe is
  **HTTP** `GET /` with a 300s initial delay (200/302 to the installer counts
  as healthy).
- **Inspect the init job and running config:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep MATOMO_DATABASE
  ```
- **Scaling constraint.** Keep `max_instance_count = 1` unless multi-pod
  session/NFS-lock behaviour has been verified — Matomo does not natively
  coordinate archiving/tracking-log writes across replicas sharing one NFS
  volume and one database.
- **Cron/archiving is not wired.** This module does not provision a CronJob
  for Matomo's periodic archive processing (`console core:archive`); if
  scheduled report pre-processing is required, add one via the generic
  `cron_jobs` variable (Group 11) pointing at the deployed image and command.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Matomo are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `matomo` | Base name for resources. Do not change after first deploy. |
| `application_version` | `5-apache` | Tag of the official Matomo image to deploy. Use an Apache variant tag (e.g. `5.11-apache`, `latest`). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | `prebuilt` deploys the official Matomo image directly; `custom` builds via Cloud Build. |
| `container_port` | `80` | Matomo/Apache listens on port 80. |
| `cpu_limit` | `1000m` | CPU limit for the Matomo container. |
| `memory_limit` | `2Gi` | Memory limit; Matomo with common plugins typically needs at least 512Mi. |
| `min_instance_count` | `1` | Keep at 1 to keep the workload reachable. |
| `max_instance_count` | `1` | **Keep at 1** unless multi-pod NFS/session behaviour is verified. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar (loopback) — required on GKE. |
| `php_memory_limit` | `512M` | PHP `memory_limit`; must be ≤ `memory_limit`. Applies only to a `custom` image build. |
| `upload_max_filesize` | `64M` | Max single upload (e.g. log-file import). Must be ≤ `post_max_size`. |
| `post_max_size` | `64M` | Max POST body size. Must be ≥ `upload_max_filesize`. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the Matomo UI. |
| `workload_type` | `null` → `Deployment` | Deployment (NFS-backed, `Recreate` strategy). |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP `/`, 30s delay, 15s period, 20 failures | Matomo-specific override with a generous threshold for first-boot NFS population + DB connection. |
| `liveness_probe` | HTTP `/`, 300s delay, 60s period, 3 failures | Confirms Apache/PHP is serving (200/302 to the installer counts as healthy). |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS is on by default so `config.ini.php`, plugins, and generated assets persist and are shared. |
| `nfs_mount_path` | `/var/www/html` | Matomo's document root; the image entrypoint populates an empty volume from `/usr/src/matomo` on first start. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Injects `REDIS_HOST`/`REDIS_PORT` into the pod for use as Matomo's object cache. Connectivity only — see [Section 6](#6-configuration-pitfalls--sensible-defaults). |
| `redis_host` | `""` | Leave blank to default to the NFS server's co-hosted Redis IP; set explicitly for Memorystore. |
| `redis_port` | `6379` | Standard Redis port. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` (fixed by Matomo_Common) | Only MySQL is supported. |
| `application_database_name` | `matomo` | Database name, injected as `MATOMO_DATABASE_DBNAME`. Immutable after first deploy. |
| `application_database_user` | `matomo` | Application database user, injected as `MATOMO_DATABASE_USERNAME`; password auto-generated in Secret Manager. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `application_domains` | `[]` | Custom hostnames + managed certificate. |

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
| `service_url` | URL to reach Matomo. |
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
> through the [App_GKE](App_GKE.md) foundation engine, which validates values
> *and combinations* at plan time — a `StatefulSet` forced alongside a
> stateless setting, IAP with no authorized identities, `quota_memory_*`
> given as bare integers, an out-of-range `container_port`/
> `backup_retention_days`. Invalid configuration fails the **plan** with a
> clear, named error before any resource is created, so most mistakes below
> are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critical | Matomo requires MySQL/MariaDB; the engine cannot be changed to Postgres. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all analytics data. |
| `enable_nfs` | `true` | High | Disabling it makes `config.ini.php`, installed plugins, and generated assets ephemeral — lost on pod recreation, breaking the site after the first restart. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar on `127.0.0.1:3306` is required for DB connectivity on GKE. |
| `max_instance_count` | `1` | High | Scaling beyond 1 without verified shared-storage/session behaviour risks split sessions and NFS/DB lock contention during archive processing. |
| `session_affinity` | `ClientIP` | High | Without stickiness, requests bounce between pods and disrupt the admin UI session. |
| `container_port` | `80` | Critical | Matomo/Apache serves on 80; a mismatch fails every liveness/startup probe and the Deployment never becomes Ready. |
| `memory_limit` | `2Gi` | High | Below roughly 512Mi the PHP/Apache pod OOMs under load, especially during archive/report generation. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `enable_redis` | `true`, with a real cache backend configured post-deploy | Medium | The env vars alone do not configure Matomo's `[Cache]` backend — leaving Redis "enabled" with no reachable service (e.g. blank `redis_host` and no co-hosted Redis) can surface connection errors without an actual caching benefit. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and any bookmarked/embedded tracking URLs. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention of historical analytics backups. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Matomo-specific application configuration shared
with the Cloud Run variant is described in
**[Matomo_Common](Matomo_Common.md)**.
