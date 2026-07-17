---
title: "Monica on GKE Autopilot"
description: "Configuration reference for deploying Monica on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Monica on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Monica_GKE.png" alt="Monica on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Monica is an open-source personal relationship management (PRM) application — a
"personal CRM" for organising how you stay in touch with friends, family, and
contacts. This module deploys Monica on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Monica uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, backups, and the deployment
lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating
them here.

---

## 1. Overview

Monica runs as a PHP/Laravel web workload (official Apache image). The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Apache/PHP pods, 1 vCPU / 2 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for MySQL 8.0 | Required — Monica is fixed to MySQL |
| Object storage | Cloud Storage | A dedicated `monica-uploads` bucket for contact photos/documents, plus a default `data` bucket from `storage_buckets` |
| Persistence | NFS (enabled by default) | Shared volume for Laravel's `storage/` uploads across pods |
| Cache | Redis (optional) | Off by default; used for cache/session when enabled |
| Secrets | Secret Manager | Auto-generated Laravel `APP_KEY`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is the fixed engine.** The database engine comes from the shared
  application layer (`MYSQL_8_0`); Monica does not run on PostgreSQL here.
- **The image is the official prebuilt `monica:<version>`.** No Cloud Build step —
  `container_image_source = "prebuilt"` pulls the Apache variant from Docker Hub,
  which serves on **port 80**.
- **`APP_KEY` is generated automatically** and stored in Secret Manager. It is a
  Laravel encryption key and must never be rotated after first boot — rotating it
  permanently corrupts every encrypted database field and invalidates all sessions.
- **Migrations run automatically on start.** The image entrypoint runs
  `php artisan migrate --force` on every pod start, so the schema is created and
  upgraded on boot (after the `db-init` job provisions the database and user).
- **Cloud SQL Auth Proxy sidecar on `127.0.0.1`.** `enable_cloudsql_volume = true`
  on GKE — the Auth Proxy runs as a sidecar bound to loopback, so `Monica_GKE`
  overrides `DB_HOST = 127.0.0.1`.
- **NFS is enabled by default** (`enable_nfs = true`) so uploaded files in Laravel's
  `storage/` directory are shared and durable across pods.
- **Minimum 1 replica is maintained** (`min_instance_count = 1`, `max = 1`) — GKE
  does not support scale-to-zero, and a single replica suits a personal CRM.
- **`APP_URL` is set from the predicted service URL** so Laravel builds correct
  absolute links; update it to the external LoadBalancer/custom-domain URL after the
  IP is known.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Monica workload

Monica pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. The deployment runs a single replica by default.

- **Console:** Kubernetes Engine → Workloads → select the Monica workload to see
  pods and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe deploy -n "$NAMESPACE" <service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed. Note that when the app is NFS-backed the
foundation uses a `Recreate` update strategy to avoid two pods contending on the
shared volume/DB during rollouts.

### B. Cloud SQL for MySQL 8.0

Monica stores all application data (contacts, activities, reminders, journal entries,
users) in a managed Cloud SQL for MySQL 8.0 instance. Pods reach it privately through
the **Cloud SQL Auth Proxy** sidecar on `127.0.0.1:3306`; no public IP is exposed. On
first deploy the `db-init` Job creates the application database and user and grants
privileges; the container entrypoint then runs the Laravel migrations.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and the Secret Manager secret holding the password
are all surfaced in the [Outputs](#5-outputs). For the connection model, automated
backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Storage

A dedicated **Cloud Storage** bucket (suffix `monica-uploads`) is provisioned
automatically for Monica's uploaded files (contact photos, documents). A second
bucket (suffix `data`) is also created by default via the `storage_buckets`
variable's own default entry. The workload service account is granted access.
Additional buckets can be declared via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/          # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Redis (optional cache)

Redis is **disabled by default** (`enable_redis = false`). When enabled, the
foundation injects `REDIS_HOST`/`REDIS_PORT`; leaving `redis_host` empty while NFS is
enabled uses the NFS server VM's IP as the Redis endpoint (the NFS VM co-hosts Redis).

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the injected Redis env in the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS_HOST
  ```

### E. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager: the
Laravel **`APP_KEY`** (used for AES-256-CBC encryption of encrypted columns and for
signing sessions/cookies). It is delivered into the pod via the Secret Store CSI
driver. The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~monica-app-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`). A custom domain with a Google-managed certificate can
be enabled, and a static IP can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
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

## 3. Monica Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `mysql:8.0-debian`. It connects through the Cloud SQL Auth Proxy and idempotently
  creates the application database and user, grants privileges, and verifies the app
  user can connect (also warming the MySQL 8 `caching_sha2_password` auth cache). The
  job is safe to re-run.
- **Migrations run automatically on start.** The official Monica image's entrypoint
  runs `php artisan migrate --force` on every pod start — there is no separate
  migration job. The schema is created on first boot (after `db-init`) and upgraded
  automatically when you bump `application_version`.
- **`APP_KEY` is immutable after first boot.** It is generated once and written to
  Secret Manager. Changing it permanently corrupts all encrypted database fields and
  invalidates every session — only rotate during a planned maintenance window with a
  full data re-encryption plan.
- **First-run setup in the UI.** Monica has **no default credentials**. Reach the
  external LoadBalancer URL: an unauthenticated visitor is redirected to the
  registration/setup page. The first account you create becomes the administrator.
  Register with `admin@techequity.cloud` for RAD deployments.
- **File uploads are shared across pods.** Uploaded photos/documents live under
  Laravel's `storage/`. NFS is enabled by default so the volume is shared and durable;
  the `monica-uploads` GCS bucket is also provisioned. NFS-backed rollouts use the
  `Recreate` strategy to avoid two pods contending on the same volume.
- **Health path.** The startup probe is **TCP** on `/` (passes as soon as Apache
  binds the port) and the liveness probe is **HTTP** `GET /` (Monica's home page
  returns `200`). Allow a generous first-boot window for Apache startup plus the
  initial `php artisan migrate --force`.
- **Update `APP_URL` after the IP is known.** The predicted URL is injected at plan
  time; set `APP_URL` to the external LoadBalancer or custom-domain URL via
  `environment_variables` so absolute links and redirects resolve correctly.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Monica are listed; every other input is inherited
from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `monica` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Monica image tag; pin to a specific release in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Pulls the official `monica` image directly — do not change to `custom`. |
| `container_port` | `80` | Monica's Apache image listens on port 80. |
| `cpu_limit` | `1000m` | CPU per pod (1 vCPU). |
| `memory_limit` | `2Gi` | Memory per pod. |
| `min_instance_count` | `1` | GKE has no scale-to-zero; keep at 1 for a personal CRM. |
| `max_instance_count` | `1` | Single replica is sufficient. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar; `DB_HOST` is overridden to `127.0.0.1`. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | On by default — shared, durable volume for Laravel `storage/` uploads across pods. |
| `nfs_mount_path` | `/var/www/html/storage` | Mount path inside the container — Monica persists uploads and runtime data under Laravel's `storage/` directory. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the `monica-uploads` bucket (from the Common module) plus the buckets in `storage_buckets`. Set `false` to skip all bucket creation. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional buckets to provision — the default creates a second `data` bucket alongside `monica-uploads`. |
| `gcs_volumes` | `[]` | Optional GCS Fuse volume mounts via the CSI driver. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` (from Common) | Fixed to MySQL 8.0. |
| `application_database_name` | `monica` | Database base name (tenant-prefixed). Immutable after first deploy. |
| `application_database_user` | `monica` | Application database user base name. Immutable after first deploy. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable to add cache/session backing; injects `REDIS_HOST`/`REDIS_PORT`. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |

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
| `service_url` | URL to reach Monica. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (`monica-uploads` and `data` by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `gen1` runtime with NFS/GCS mounts, an out-of-range `redis_port`/`backup_retention_days`, bare-integer `quota_memory_*` values, a `Deployment` workload_type alongside `stateful_pvc_enabled`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `APP_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it permanently corrupts every encrypted database field and invalidates all sessions. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `database_type` | `MYSQL_8_0` | Critical | Monica is a MySQL app; a non-MySQL engine breaks the driver and migrations. |
| `enable_nfs` | `true` | High | Disabling loses the shared `storage/` volume — uploaded photos/documents are not shared across pods and are lost on pod recreation. |
| `container_image_source` | `prebuilt` | High | Setting `custom` makes App_GKE attempt a build with no Dockerfile. |
| `container_port` | `80` | High | The Apache image listens on 80; a mismatched port fails the startup probe. |
| `enable_cloudsql_volume` | `true` (GKE) | High | The Auth Proxy sidecar provides `127.0.0.1:3306`; disabling it breaks MySQL connectivity. |
| `DB_HOST` (auto-set `127.0.0.1`) | leave as injected | High | On GKE the proxy sidecar is on loopback; a different host cannot reach MySQL. |
| `APP_URL` | External LoadBalancer/domain URL | High | A wrong URL breaks absolute links and the `/` → setup/registration redirect. |
| `min_instance_count` | `1` | Medium | GKE requires min ≥ 1; a single replica suits a personal CRM. |
| `memory_limit` | `2Gi` | Medium | Trimming too far risks PHP OOM during first-boot migrations and heavy pages. |
| `enable_redis` | off unless needed | Low | Optional cache/session backing; when enabled without a host and NFS off, the Redis endpoint is blank. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Monica-specific
application configuration shared with the Cloud Run variant is described in
**[Monica_Common](Monica_Common.md)**.
