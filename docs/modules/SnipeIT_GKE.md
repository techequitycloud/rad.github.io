---
title: "Snipe-IT on GKE Autopilot"
description: "Configuration reference for deploying Snipe-IT on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Snipe-IT on GKE Autopilot

Snipe-IT is a free, open-source IT asset and inventory management system used to
track hardware, software licences, accessories, and consumables, with asset
check-in/out, audit logging, depreciation, and a full REST API. It is built on
Laravel/PHP and runs behind Apache. This module deploys Snipe-IT on **GKE
Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and
manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Snipe-IT uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Snipe-IT runs as a single PHP/Apache web workload pulled directly from the
official Docker Hub image. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Prebuilt `snipe/snipe-it` PHP/Apache pods on port 80, 1 vCPU / 2 GiB by default |
| Database | Cloud SQL for MySQL 8.0 | Required — the engine is fixed at `MYSQL_8_0` |
| File persistence | Cloud Filestore (NFS) | Uploaded asset images, signatures, barcodes, and the runtime keystore persist under `/var/lib/snipeit`, shared across pods |
| Object storage | Cloud Storage | A `snipeit-uploads` bucket provisioned automatically |
| Secrets | Secret Manager | Auto-generated Laravel `APP_KEY`; database password managed by the foundation |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **Prebuilt official image, no custom build.** `container_image_source =
  "prebuilt"` deploys `snipe/snipe-it:<application_version>` (default tag
  `v8-latest`) directly from Docker Hub, mirrored into Artifact Registry when
  `enable_image_mirroring = true`. There is no Cloud Build/Dockerfile step.
- **MySQL 8.0 is mandatory.** `SnipeIT_Common` fixes `database_type =
  "MYSQL_8_0"`; other engines are not supported.
- **Cloud SQL is reached via the Auth Proxy sidecar on loopback.** The variant
  sets `enable_cloudsql_volume = true` and the merged config forces `DB_HOST =
  127.0.0.1`; `main.tf` hard-codes `db_user_env_var_name = "DB_USERNAME"`,
  `db_name_env_var_name = "DB_DATABASE"`, and `db_password_env_var_name =
  "DB_PASSWORD"` — the Laravel-native env names, not the Foundation's generic
  `DB_*` defaults.
- **Single replica by default.** `min_instance_count = 1`,
  `max_instance_count = 1`. `enable_pod_disruption_budget` defaults `false` to
  match. Session state uses `SESSION_DRIVER = "database"` so sessions survive
  restarts even at one replica.
- **NFS is enabled by default** (`enable_nfs = true`, mounted at
  `/var/lib/snipeit`) so uploaded asset images, signatures, and barcodes
  persist and are shared across pods. `network_tags = ["nfsserver"]` is
  required for NFS connectivity.
- **Session affinity is `ClientIP`** so a client's requests reach the same
  pod.
- **Two ordered init jobs run on every apply.** `db-init` (creates the
  database/user via `mysql:8.0-debian`) runs first, then `migrate` (`php
  artisan migrate --force` against the `snipe/snipe-it` image) — both
  `execute_on_apply = true`, safe to re-run.
- **A Laravel `APP_KEY` is generated automatically** and stored in Secret
  Manager, injected as the `APP_KEY` secret env var. Deleting/recreating it
  invalidates sessions and any data Snipe-IT encrypted with the old key.
- **Redis is on by default** (`enable_redis = true`); when `redis_host` is
  blank, `REDIS_HOST` resolves to the NFS server IP.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Snipe-IT workload

Snipe-IT pods are scheduled on Autopilot, which bills for the CPU/memory the
pods actually request. The workload deploys as a `Deployment` (not
`StatefulSet`) reading/writing state to the shared NFS volume and Cloud SQL.

- **Console:** Kubernetes Engine → Workloads → select the Snipe-IT workload for
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

Snipe-IT stores all application data (assets, licences, accessories,
consumables, users, audit trail) in a managed Cloud SQL for MySQL 8.0
instance. Pods reach it through the **Cloud SQL Auth Proxy** sidecar on
`127.0.0.1:3306`; no public IP is exposed. On first deploy the `db-init` job
creates the application database, user, and grants; the `migrate` job then
runs Laravel's `artisan migrate --force` to create the schema.

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

A dedicated **Cloud Storage** bucket (suffix `snipeit-uploads`) is provisioned
automatically and the workload service account is granted access. Separately,
Snipe-IT's runtime data tree (uploaded asset images, signatures, barcodes,
keystore) lives on **NFS (Cloud Filestore)** at `/var/lib/snipeit`, shared
across pods.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~snipeit-uploads"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Secret Manager

One Snipe-IT secret is generated automatically and stored in Secret Manager:
the Laravel `APP_KEY` (`base64:<...>`, 32 random bytes base64-encoded). The
database password is managed separately by the foundation. On GKE, secrets
are projected into pods via the Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~snipeit"
  gcloud secrets versions access latest --secret=<app-key-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing
IP (`service_type = LoadBalancer`, `reserve_static_ip = true` so the address
survives redeploys). `enable_custom_domain = true` provisions a Kubernetes
Ingress; add hostnames via `application_domains` for a Google-managed
certificate.

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
Cloud Monitoring. Optional uptime checks and alert policies are available
(`uptime_check_config.enabled = false` by default).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Snipe-IT Application Behaviour

- **First-deploy database setup.** The `db-init` job runs on `mysql:8.0-debian`,
  idempotently creating the application database, user, and grants (safe to
  re-run — `execute_on_apply = true`, `max_retries = 3`).
- **Explicit migration job, not boot-time auto-migration.** Unlike some
  Laravel apps that migrate on container start, Snipe-IT here runs an explicit
  `migrate` init job (`php /var/www/html/artisan migrate --force`, depends on
  `db-init`, `max_retries = 2`) so the schema is ready before the first app
  revision serves traffic. The official image's own boot-time auto-migration
  behaviour, if any, is a secondary safety net.
- **DB env-var mapping to Laravel names.** `main.tf` hard-codes
  `db_user_env_var_name = "DB_USERNAME"`, `db_name_env_var_name =
  "DB_DATABASE"`, and `db_password_env_var_name = "DB_PASSWORD"` so the
  Foundation injects the tenant-scoped DB credentials directly under the
  names Snipe-IT's Laravel config expects — no entrypoint aliasing needed.
  `DB_HOST` is forced to `127.0.0.1` (the Auth Proxy sidecar) and `DB_PORT =
  "3306"` is set by `SnipeIT_Common`.
- **Session/cache/queue persistence.** `SnipeIT_Common` sets
  `SESSION_DRIVER = "database"`, `CACHE_DRIVER = "file"`, and `QUEUE_DRIVER =
  "database"` so sessions and queued jobs survive pod restarts.
- **`APP_URL` is derived automatically.** `SnipeIT_Common` sets `APP_URL` from
  the predicted GKE service URL when known; override via
  `environment_variables` if you assign a custom domain after deploy.
- **Health path.** Default startup probe is **TCP** (30 s initial delay,
  15 s period, failure threshold 20 — generous to allow first-boot DB setup).
  Default liveness probe is **HTTP** `GET /` (300 s initial delay, 60 s
  period, failure threshold 3) — Snipe-IT serves its login page at `/`
  unauthenticated, confirming the PHP app and DB connection are healthy.
- **Inspect the init jobs and running config:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl logs -n "$NAMESPACE" job/<migrate-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep DB_
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Snipe-IT are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `snipeit` | Base name for resources. Do not change after first deploy. |
| `application_version` | `v8-latest` | Tag of the official `snipe/snipe-it` image. Use a pinned version in production. |
| `php_memory_limit` | `512M` | PHP `memory_limit`. Accepted but not applied by `SnipeIT_Common` — the prebuilt image keeps its own PHP config. |
| `upload_max_filesize` / `post_max_size` | `64M` / `64M` | PHP upload / POST size. `upload_max_filesize` must not exceed `post_max_size` (plan-time guard); neither is applied to the prebuilt image. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Deploys the official image directly; `"custom"` would build via Cloud Build. |
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Per-pod CPU/memory limits. |
| `container_port` | `80` | Snipe-IT (Apache) listens on port 80. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | HPA replica bounds. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar (loopback) — required on GKE; plan-time guard rejects it when `database_type = "NONE"`. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the Snipe-IT UI. |
| `workload_type` | `null` → `Deployment` | Deployment (NFS-backed). |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |

### Group 13 — NFS

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS is on by default so uploaded asset images/signatures/barcodes persist and are shared. Keep enabled. |
| `nfs_mount_path` | `/var/lib/snipeit` | Where Snipe-IT stores uploads and runtime data. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Injects `REDIS_HOST`/`REDIS_PORT`. Plan-time guard requires either `redis_host` set or `enable_nfs = true` (NFS server IP is the fallback Redis host). |
| `redis_host` | `""` | Leave blank to use the NFS server IP. |

### Group 16 — Database

| Variable | Default | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` | Fixed by `SnipeIT_Common`; other engines are not supported. |
| `application_database_name` | `snipeit` | Database name. Immutable after first deploy. |
| `application_database_user` | `snipeit` | Application database user; password auto-generated in Secret Manager. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisions a Kubernetes Ingress for custom hostnames. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `network_tags` | `["nfsserver"]` | Required for NFS connectivity — do not remove unless NFS is disabled. |

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
| `service_url` | URL to reach Snipe-IT. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup (`db-init`, `migrate`) and (optional) import jobs. |
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
> `backup_retention_days`. `SnipeIT_GKE` adds its own guards
> (`upload_max_filesize ≤ post_max_size`, `min_instance_count ≤
> max_instance_count`, Redis needs `redis_host` or NFS, IAP needs both OAuth
> values, `enable_cloudsql_volume` needs `database_type != "NONE"`). Invalid
> configuration fails the **plan** with a clear, named error before any
> resource is created, so most mistakes below are caught up front rather than
> at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critical | Snipe-IT requires MySQL; other engines are not supported by `SnipeIT_Common`. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all data. |
| `APP_KEY` (auto-generated) | Never change | Critical | Regenerating the Laravel key after first boot invalidates sessions and any data encrypted with the old key (e.g., stored LDAP credentials). |
| `enable_nfs` | `true` | High | Disabling it makes uploaded asset images/signatures/barcodes ephemeral — isolated per pod and lost on restart. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar on `127.0.0.1:3306` is required for DB connectivity on GKE. |
| `max_instance_count` | `1` | High | Scaling beyond 1 without verified shared-storage/lock behaviour risks split sessions and NFS/DB lock contention. |
| `session_affinity` | `ClientIP` | High | Without stickiness, requests bounce between pods and disrupt authenticated sessions. |
| `network_tags` | `["nfsserver"]` | High | Removing the tag while NFS is enabled breaks pod-to-Filestore connectivity. |
| `memory_limit` | `2Gi` | High | Below 512Mi the PHP/Apache pod OOMs under load. |
| `upload_max_filesize` / `post_max_size` | `upload_max_filesize ≤ post_max_size` | Medium | The wrong order silently truncates uploads at the PHP layer; plan-time guard blocks it, but only for these two variables. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and any bookmarked/API-integrated URL. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Snipe-IT-specific application configuration shared
with the Cloud Run variant (image, `APP_KEY` secret, init jobs) is described
in `modules/SnipeIT_Common/README.md` — no standalone `docs/modules/
SnipeIT_Common.md` guide exists yet.
