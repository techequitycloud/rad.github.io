---
title: "Django on GKE Autopilot"
---

# Django on GKE Autopilot

Django is a battle-tested Python web framework that encourages rapid development and
clean, pragmatic design, powering some of the world's most demanding web applications.
This module deploys Django on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud
and Kubernetes infrastructure.

This guide focuses on the cloud services Django uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

Django runs as a Python/Gunicorn web workload. The deployment wires together a focused
set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Python/Gunicorn pods, 1 vCPU / 512 MiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Django's `DB_ENGINE` is fixed to `django.db.backends.postgresql` |
| Shared files | Filestore (NFS) | Shared media and uploads across all replicas |
| Object storage | Cloud Storage | A dedicated media bucket provisioned by Django_Common |
| Secrets | Secret Manager | Auto-generated Django `SECRET_KEY` and database password |
| Cache (optional) | Redis / Cloud Memorystore | Disabled by default; enable for session storage and caching |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is fixed.** `Django_Common` hard-wires `DB_ENGINE` to PostgreSQL;
  MySQL and `NONE` are not supported through this module.
- **The Django `SECRET_KEY` is auto-generated** and stored in Secret Manager;
  it is injected at runtime and never set in plain text.
- **Four PostgreSQL extensions are installed automatically** (`pg_trgm`, `unaccent`,
  `hstore`, `citext`) by the `db-init` job, so you do not need to configure them.
- **Two initialization jobs run by default** — `db-init` (creates the database and
  user) and `db-migrate` (runs `manage.py migrate` and `collectstatic`).
- **NFS is enabled by default.** All pod replicas share the same Filestore volume
  for uploaded media files. Session affinity defaults to `ClientIP`.
- **Redis is disabled by default.** Enable with `enable_redis = true` and point at a
  Cloud Memorystore instance for production session storage and caching.
- **Scale to zero by default.** `min_instance_count` defaults to `0`; set to `1`
  for production to eliminate cold starts.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Django workload

Django pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the Deployment between the
minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Django workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Django stores all application data in a managed Cloud SQL for PostgreSQL 15 instance.
Pods reach it privately through the **Cloud SQL Auth Proxy** sidecar over a Unix
socket, so no public IP is exposed. On first deploy the `db-init` job creates the
application database and user, installs the required extensions, and grants
privileges. The `db-migrate` job then runs `manage.py migrate` and
`manage.py collectstatic`.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  # Confirm DB env vars are injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E "^(DB_|SECRET_KEY)"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Filestore (NFS) and Cloud Storage

Uploaded media is written to a **Filestore (NFS)** share mounted into every pod so
all replicas see the same files. A dedicated **Cloud Storage** media bucket is also
provisioned automatically by `Django_Common`; the workload service account is granted
access.

- **Console:** Filestore → Instances for the NFS share; Cloud Storage → Buckets for
  the media bucket.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### D. Redis cache

Redis is **disabled by default**. When `enable_redis = true`, Django receives
`REDIS_HOST` and `REDIS_PORT` as environment variables. Configure `settings.py` to
use these for `CACHES` and `SESSION_ENGINE`. The module does not provision a Redis
instance — use a Cloud Memorystore instance and set `redis_host` to its private IP.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  # Confirm REDIS_HOST and REDIS_PORT are injected:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  ```

### E. Secret Manager

The Django `SECRET_KEY` and the database password are stored as Secret Manager
secrets and injected into pods at runtime; plaintext never appears in configuration.
The superuser password (if you create one via `DJANGO_SUPERUSER_PASSWORD`) should
also be stored here.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A
custom domain with a Google-managed certificate can be enabled via
`enable_custom_domain`, and a static IP can be reserved so the address survives
redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and
static IP details.

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

## 3. Django Application Behaviour

- **First-deploy database setup.** A `db-init` job creates the PostgreSQL database
  and user, grants privileges, and installs the four required extensions (`pg_trgm`,
  `unaccent`, `hstore`, `citext`) using the `ROOT_PASSWORD` superuser secret. The job
  is idempotent and safe to re-run.
- **Migrations on first deploy.** A `db-migrate` job runs `manage.py migrate` and
  `manage.py collectstatic --noinput --clear` after `db-init` completes. These jobs
  run with `execute_on_apply = true` by default. Override `initialization_jobs` with
  a non-empty list to replace them with custom jobs.
- **`SECRET_KEY` management.** A 50-character random key is generated by
  `Django_Common` and stored in Secret Manager. It is injected as `SECRET_KEY`.
  Do not set `SECRET_KEY` in `environment_variables`.
- **Superuser creation.** If `DJANGO_SUPERUSER_USERNAME`, `DJANGO_SUPERUSER_EMAIL`,
  and `DJANGO_SUPERUSER_PASSWORD` are present as environment variables when the
  container starts, `entrypoint.sh` creates a Django superuser on first boot. Use
  `secret_environment_variables` for the password:
  ```bash
  # Retrieve the SECRET_KEY or superuser password from Secret Manager
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```
- **Scheduled tasks.** Django management commands (e.g., `clearsessions`) can be
  scheduled as Kubernetes CronJobs via the `cron_jobs` variable:
  ```bash
  kubectl get cronjobs -n "$NAMESPACE"
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  ```
- **Health probes.** The default startup probe targets `GET /` with a 90-second
  initial delay (to allow first-boot migrations) and the liveness probe targets
  `GET /` with a 60-second initial delay. Implement a lightweight `/healthz/` view
  that returns HTTP 200 and set `path = "/healthz/"` in both probe variables for
  cleaner health signalling.
- **Session affinity.** Defaults to `ClientIP` so that a given user's requests are
  routed to the same pod. Set `session_affinity = "None"` when all session state is
  externalised to the database or Redis.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Django are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `django` | Base name for resources. **Do not change after first deploy.** |
| `application_display_name` | `Django Application` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `latest` | Image version tag; increment to roll out a new build. Pin to a specific tag in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds via Cloud Build; `prebuilt` deploys an existing image URI. |
| `container_image` | `us-docker.pkg.dev/cloudrun/container/hello` | Override container image URI. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | CPU and memory limits per pod. |
| `min_instance_count` | `0` | Minimum replicas. Set ≥ 1 to eliminate cold starts in production. |
| `max_instance_count` | `1` | Maximum replicas (autoscaler ceiling). |
| `container_port` | `8080` | Django/Gunicorn listens on port 8080. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not include `SECRET_KEY` or `DB_*` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g., `DJANGO_SUPERUSER_PASSWORD`). |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing recommended for in-process session storage. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled` is set. |
| `network_tags` | `["nfsserver"]` | Node/pod tags; `nfsserver` is required for NFS connectivity. |

### Group 7 — StatefulSet / PVC

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable PVC templates in a StatefulSet. Not normally needed for Django. |
| `stateful_pvc_size` | `10Gi` | Storage size for each per-pod PVC. |
| `stateful_pvc_mount_path` | `/data` | Container path where the PVC is mounted. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protect availability during node upgrades. Disabled by default because the default `max_instance_count` is 1. |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 if you need eviction headroom. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /`, 90s initial delay | Startup probe passed to `Django_Common`. Increase delay for large migration sets. |
| `liveness_probe` | HTTP `GET /`, 60s initial delay | Liveness probe passed to `Django_Common`. Use a lightweight `/healthz/` endpoint. |
| `startup_probe_config` | TCP, 240s timeout | App_GKE-level infrastructure startup probe. |
| `health_check_config` | HTTP `GET /`, 1s timeout | App_GKE-level infrastructure liveness probe. |
| `uptime_check_config` | enabled, path `/` | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` (uses built-in `db-init` + `db-migrate`) | Leave empty to use the default database setup and migration jobs. Provide a non-empty list to replace them with custom jobs. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs (e.g., `clearsessions`, `cleartokens`). |
| `additional_services` | `[]` | Sidecar or helper GKE services deployed alongside Django. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for Django media (keep enabled for multi-replica). |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. Must match `MEDIA_ROOT` in `settings.py`. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the additional data bucket. The media bucket is always provisioned by `Django_Common`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional buckets beyond the auto-provisioned media bucket. |
| `gcs_volumes` | `[]` | GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis for session storage and caching. |
| `redis_host` | `""` | Redis host IP or hostname. Leave empty to fall back to the NFS server IP when enabled. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES` | **PostgreSQL required.** Django does not support MySQL through this module. |
| `application_database_name` | `gkeapp` | Database name. **Recommended: set to `django_db`.** Immutable after first deploy. |
| `application_database_user` | `gkeapp` | Application user. **Recommended: set to `django_user`.** Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `enable_postgres_extensions` | `false` | Set `true` only to install **additional** extensions beyond `pg_trgm`, `unaccent`, `hstore`, and `citext` (which are always installed). |
| `postgres_extensions` | `[]` | Additional PostgreSQL extensions (e.g., `postgis`, `uuid-ossp`). |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` | restore options | Restore from a backup on deploy. Set `enable_backup_import = false` after a successful import. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `false` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Django. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | `default-waf-policy` | Policy name. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for Cloud Deploy stage services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Django. |
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
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD repo details. |
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
| `database_type` | `POSTGRES` or `POSTGRES_15` | Critical | Django requires PostgreSQL; MySQL or `NONE` will fail the `db-init` job. |
| `application_name` / `tenant_deployment_id` | set once | Critical | Embedded in resource names; changing recreates all named resources and destroys data. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys data. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`) | Critical | Bare integers are bytes and block all pod scheduling. |
| `startup_probe` `failure_threshold` | ≥ 30 with migrations | Critical | Too low: Kubernetes kills the pod before migrations finish, causing a restart loop. |
| `cloudsql_volume_mount_path` | `/cloudsql` (default) | Critical | Wrong path: `db-init.sh` cannot find the Auth Proxy socket; all DB operations fail. |
| `enable_backup_import` | `false` after restore | High | Leaving `true` re-runs the import on every apply, overwriting live data with stale backup. |
| `enable_nfs` | `true` (default) | High | Disabling with `max_instance_count > 1` means each pod has isolated ephemeral storage; uploads are lost on restart. |
| `nfs_mount_path` | `/mnt/nfs` — must match `MEDIA_ROOT` | High | Mismatch causes Django to write media to ephemeral local storage; files lost on pod restart. |
| `container_resources` memory | ≥ `512Mi`; raise for ORM-heavy workloads | High | Too little memory: pod is OOMKilled (exit code 137) on large querysets or file processing. |
| `min_instance_count` | `1` for production | Medium | `0` causes cold starts (>60 s) on first request after idle; scheduled tasks may find no pod. |
| `application_version` | pinned tag, not `latest` | Medium | `latest` makes rollback ambiguous; Kubernetes cannot distinguish two `latest` pulls. |
| `enable_redis` | `true` when using Redis-backed sessions | Medium | Left `false` with Redis-configured `settings.py`: `ConnectionRefusedError` on every cache/session access. |
| `session_affinity` | `ClientIP` for database-backed sessions | Medium | `None` with in-process caching: requests from the same user may hit different pods, losing cache. |
| `enable_pod_disruption_budget` | `false` when `max_instance_count = 1` | High | `true` with a single replica blocks node drains and stalls cluster maintenance. |
| `enable_iap` / `enable_cloud_armor` | enable for admin-facing | Medium | Django admin UI is otherwise publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Django-specific application configuration shared with the
Cloud Run variant is described in **[Django_Common](Django_Common.md)**.
