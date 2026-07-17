---
title: "Directus on GKE Autopilot"
description: "Configuration reference for deploying Directus on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Directus on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Directus_GKE.png" alt="Directus on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Directus is an open-source headless CMS and Backend-as-a-Service (BaaS) platform that wraps any SQL database with auto-generated REST and GraphQL APIs and a no-code admin application. This module deploys Directus on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Directus uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics that are common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Directus runs as a Node.js workload. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pods, 2 vCPU / 2 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Directus hardcodes `DB_CLIENT = "pg"` |
| Shared files | Filestore (NFS) | Uploaded assets and media shared across all replicas |
| Object storage | Cloud Storage | A dedicated uploads bucket; GCS is the default Directus storage driver |
| Cache | Redis | Enabled by default; defaults to the NFS host IP when no explicit host is set |
| Secrets | Secret Manager | Auto-generated KEY, SECRET, ADMIN_PASSWORD, and REDIS connection URL |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is required.** Directus hardcodes `DB_CLIENT = "pg"`. Switching to MySQL or `NONE` prevents startup.
- **GCS is the default file storage driver.** `Directus_Common` automatically injects `STORAGE_GCS_DRIVER`, `STORAGE_GCS_BUCKET`, and `STORAGE_LOCATIONS = "gcs"`, so all uploads go to the dedicated Cloud Storage bucket.
- **Auto-migrate and bootstrap run on every start.** `AUTO_MIGRATE = "true"` applies any pending database schema migrations on startup. `BOOTSTRAP = "true"` seeds the admin user and system collections on first boot — both are idempotent.
- **Scale-to-zero is the default** (`min_instance_count = 0`). Directus uses Redis-backed sessions, so cold starts are acceptable for non-latency-critical deployments. Set `min_instance_count = 1` to eliminate cold starts in production.
- **The Directus KEY and SECRET** are generated automatically and stored in Secret Manager. Rotating them after the first deployment invalidates all active sessions and JWTs.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Directus workload

Directus pods are scheduled on Autopilot, which bills for the CPU/memory the pods actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Directus workload to see pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  # Manually verify the Directus health endpoint from within the cluster:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- curl -sf http://localhost:8055/server/ping
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type (Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Directus stores all application data in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it through the **Cloud SQL Auth Proxy** sidecar over a Unix socket. On first deploy a `db-init` job creates the application database, user, grants privileges, and installs the `uuid-ossp` and `postgis` extensions.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the password are all surfaced in the [Outputs](#5-outputs). For the connection model, automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Filestore (NFS) and Cloud Storage

Uploaded assets are written to a **Filestore (NFS)** share mounted into every pod so all replicas see the same files. A dedicated **Cloud Storage** uploads bucket is also provisioned; Directus is configured to use GCS as its primary storage driver via `STORAGE_GCS_DRIVER = "gcs"`.

- **Console:** Filestore → Instances for the NFS share; Cloud Storage → Buckets for the uploads bucket.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/          # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### D. Redis cache

Redis backs Directus's API response caching and rate-limiting state. When no explicit Redis host is configured and NFS is enabled, the NFS host IP is used as the default Redis endpoint. The full Redis connection URL (including any auth password) is stored as a Secret Manager secret and injected as the `REDIS` environment variable.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  # From a host with network access:
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm REDIS is injected into the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  ```

### E. Secret Manager

Four secrets are generated and stored automatically: `KEY` (data encryption), `SECRET` (JWT signing), `ADMIN_PASSWORD` (initial admin account), and `REDIS` (Redis connection URL when Redis is enabled). The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the admin password:
  gcloud secrets versions access latest --secret=<prefix>-admin-password --project "$PROJECT"
  # Retrieve the DB password secret name from Outputs, then:
  gcloud secrets versions access latest --secret=<database_password_secret> --project "$PROJECT"
  ```

The `database_password_secret` name is in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A custom domain with a Google-managed certificate can be enabled, and a static IP can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Directus Application Behaviour

- **First-deploy database setup.** A `db-init` job runs on every apply (`execute_on_apply = true`). It creates the Directus database user with the generated password, creates the `directus` database, installs `uuid-ossp` and `postgis` extensions (PostGIS failure is non-fatal), and grants full privileges. The job is idempotent.
- **Bootstrap on first start.** `BOOTSTRAP = "true"` seeds the initial admin user and Directus system collections on first boot. The admin email defaults to `admin@example.com` — **override this via `environment_variables = { ADMIN_EMAIL = "you@example.com" }` before the first deploy.**
- **Migrations on every start.** `AUTO_MIGRATE = "true"` causes Directus to run `database migrate:latest` on each pod start, so upgrading `application_version` applies schema changes automatically.
- **Health probe.** The startup and liveness probes target `/server/ping`, Directus's public, unauthenticated liveness endpoint (returns `pong`/200 as soon as the server is listening) — `/server/health` requires admin authentication and would 403 an unauthenticated probe. The startup probe allows up to 300 seconds (`failure_threshold = 10`, `period_seconds = 30`) to accommodate first-boot database setup.
- **KEY and SECRET rotation.** Rotating the `KEY` secret immediately invalidates all active user sessions. Rotating `SECRET` invalidates all issued JWTs. Never rotate either without a planned maintenance window and client notification.
- **Admin login.** Retrieve the generated admin password from Secret Manager (see §2.E). The default admin email is `admin@example.com` unless overridden.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for Directus are listed; every other input is inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. Do not change after first deploy. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `directus` | Base name for resources. Do not change after first deploy — embedded in Secret Manager secret IDs. |
| `application_display_name` | `Directus CMS` | Friendly name shown in the Console. |
| `application_version` | `11.1.0` | Directus image version tag; increment to roll out a new version. Pin to a specific tag — avoid `latest` in production. |
| `description` | `Directus - Open Source Headless CMS and Backend-as-a-Service` | Workload description annotation. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only (Cloud SQL, storage, secrets) without deploying the workload. |
| `cpu_limit` | `2000m` | CPU per pod; 2 vCPU recommended for responsive API generation. |
| `memory_limit` | `2Gi` | Memory per pod; 2 GiB minimum — increase for large schemas or image transformations. |
| `min_instance_count` | `0` | Minimum replicas. Set `1` to eliminate cold starts in production. |
| `max_instance_count` | `3` | Maximum replicas (autoscaler ceiling). |
| `container_port` | `8055` | Directus default listening port. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for Unix socket connections. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Override `ADMIN_EMAIL` here before first deploy. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `workload_type` | `Deployment` | `Deployment` (stateless) or `StatefulSet`. For most Directus deployments, keep the default and use `enable_nfs = true` for shared assets. |
| `session_affinity` | `ClientIP` | Sticky routing. |
| `network_tags` | `["nfsserver"]` | Node/pod tags; `nfsserver` is required for NFS connectivity. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Enable per-pod PVC templates in the StatefulSet spec. |
| `stateful_pvc_size` | `10Gi` | Storage size per pod PVC. Cannot be decreased after provisioning. |
| `stateful_pvc_mount_path` | `/data` | Container path where the per-pod PVC is mounted. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |
| `stateful_headless_service` | `true` | Create a headless Service for stable pod DNS entries. |
| `stateful_pod_management_policy` | `OrderedReady` | `OrderedReady` or `Parallel`. |
| `stateful_update_strategy` | `RollingUpdate` | `RollingUpdate` or `OnDelete`. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 if you need eviction headroom. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `/server/ping`, HTTP, failure_threshold=10 | Kubernetes startup probe. Allows up to 300 s for first-boot migrations. |
| `liveness_probe` | `/server/ping`, HTTP | Kubernetes liveness probe; pod restarted after 3 consecutive failures. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Optional Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job supplied by `Directus_Common`. |
| `cron_jobs` | `[]` | Recurring Kubernetes CronJobs (e.g., cache purge, data sync). |
| `additional_services` | `[]` | Sidecar or helper GKE services deployed alongside Directus. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see [App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for uploaded assets (keep enabled for multi-replica). |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision additional buckets in `storage_buckets`. The uploads bucket from `Directus_Common` is always provisioned. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional GCS buckets beyond the auto-provisioned uploads bucket. |
| `gcs_volumes` | `[]` | GCS buckets to mount via GCS Fuse CSI driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Use Redis for caching and rate limiting. |
| `redis_host` | `""` | Leave empty to use the NFS host IP; set explicitly for a dedicated Memorystore instance. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). The full connection URL is stored in Secret Manager. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Directus requires PostgreSQL. Do not change. |
| `db_name` | `directus` | PostgreSQL database name. Do not change after first deploy. |
| `db_user` | `directus` | Application user. Do not change after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `enable_postgres_extensions` | `true` | Install `uuid-ossp` (and optionally `postgis`) via `db-init`. |
| `postgres_extensions` | `["uuid-ossp"]` | Extensions to install. Add `"postgis"` for geospatial support. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. Set `enable_backup_import = false` immediately after a successful restore. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See [App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Directus. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | `default-waf-policy` | Policy name. |
| `enable_cdn` | `false` | Enable Cloud CDN via Gateway API. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). Use `vpc_sc_dry_run = true` first. |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Directus. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
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

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Directus requires PostgreSQL; changing to MySQL or `NONE` prevents startup and orphans the existing database. |
| `application_name` | set once | Critical | Embedded in Secret Manager secret IDs (KEY, SECRET, ADMIN_PASSWORD). Changing recreates all secrets — all active sessions and JWTs are immediately invalidated. |
| `tenant_deployment_id` | set once | Critical | Changing after first deploy orphans the Cloud SQL instance and generates a new empty database plus new KEY/SECRET, invalidating all sessions. |
| `KEY` / `SECRET` secrets | auto-generated, never rotate casually | Critical | Rotating KEY logs out all users. Rotating SECRET invalidates all API tokens. Only rotate during a planned maintenance window. |
| `ADMIN_EMAIL` env var | a real email address | High | Default `admin@example.com` creates the admin account with a guessable email. Override via `environment_variables = { ADMIN_EMAIL = "you@example.com" }` before first deploy. |
| `quota_memory_requests` / `quota_memory_limits` | binary units (`4Gi`) | Critical | Bare integers (e.g., `"4"`) are read as bytes — blocks all pod scheduling permanently. |
| `enable_nfs` | `true` | High | Without shared NFS, uploaded assets written by one pod are invisible to others and lost on restart (unless using GCS Fuse exclusively). |
| `enable_redis` | `true` for multi-replica | High | Without Redis, each pod has an isolated cache; rate-limiting is per-pod and Directus caching breaks across replicas. |
| `redis_host` | `""` (NFS) or explicit | High | No valid Redis endpoint if Redis is enabled, NFS is off, and no host is set. |
| `startup_probe.failure_threshold` | `10` or higher on first deploy | High | Too low: Directus migrations can take 1–3 minutes on a fresh database; the pod is killed before migrations complete, causing a restart loop. |
| `enable_backup_import` | `false` after restore | High | Leaving `true` re-runs the import on every apply, overwriting live data with the stale backup. |
| `memory_limit` | `2Gi` | High | Too little memory causes OOM kills during schema loading or image transformation. |
| `min_instance_count` | `1` for production | Medium | `0` in production causes 20–40 s cold starts on the first API request after an idle period. |
| `enable_pod_disruption_budget` + `pdb_min_available` | leave headroom | Medium | `pdb_min_available = "1"` with `min_instance_count = 1` blocks node drains permanently. |
| `enable_iap` / `enable_cloud_armor` | enable for admin-facing | Medium | The admin UI is otherwise publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `enable_vpc_sc` + `vpc_sc_dry_run` | start with `vpc_sc_dry_run = true` | Critical | Enabling enforcement without the SA in the access level blocks Cloud SQL, Secret Manager, and Artifact Registry simultaneously. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Directus-specific application configuration shared with the Cloud Run variant is described in **[Directus_Common](Directus_Common.md)**.
