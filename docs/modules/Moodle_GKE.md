---
title: "Moodle on GKE Autopilot"
description: "Configuration reference for deploying Moodle on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Moodle on GKE Autopilot

Moodle is the world's most popular open-source Learning Management System (LMS),
used by universities, schools, corporations, and online training providers worldwide.
This module deploys Moodle on **GKE Autopilot** on top of the [App_GKE](App_GKE.md)
foundation, which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

This guide focuses on the cloud services Moodle uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, backups, and the deployment
lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## 1. Overview

Moodle runs as a PHP 8.3/Apache web workload backed by PostgreSQL. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | PHP 8.3/Apache pods, 2 vCPU / 4 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Moodle does not support MySQL in this deployment |
| Shared files | Filestore (NFS) | Moodle `moodledata` directory shared across all replicas; mandatory |
| Object storage | Cloud Storage | A data bucket and any additional user-defined buckets |
| Cache & sessions | Redis | Enabled by default; falls back to the NFS host IP when no Redis host is given |
| Secrets | Secret Manager | Auto-generated cron password, SMTP password, and database password |
| Scheduler | Cloud Scheduler | Auto-provisioned cron job (every minute) against `/admin/cron.php` |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed and `MOODLE_DB_TYPE =
  "pgsql"` is hardcoded; selecting MySQL or `NONE` breaks startup.
- **NFS is mandatory.** The Moodle `moodledata` directory must be a shared writable
  filesystem accessible across all replicas. `enable_nfs` defaults to `true`.
- **Redis is enabled by default.** With more than one replica, a shared cache is
  required to keep PHP session and Moodle application state consistent across pods.
- **Session affinity is `ClientIP`.** Moodle relies on PHP sessions, so requests
  from a browser are pinned to one pod.
- **Custom domain is enabled by default** (`enable_custom_domain = true`) so
  Moodle's `wwwroot` resolves to a stable address rather than a transient pod IP.
- **A Cloud Scheduler job is auto-provisioned.** It fires every minute to
  `/admin/cron.php` using a secure, auto-generated cron password stored in Secret
  Manager.
- The **cron password** and **SMTP password** are generated automatically and stored
  in Secret Manager; you never set them in plain text.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Moodle workload

Moodle pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the
minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Moodle workload to see
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

Moodle stores all application data (courses, users, grades, activity logs) in a
managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately through the
**Cloud SQL Auth Proxy** sidecar over a Unix socket, so no public IP is exposed. On
first deploy an initialization job creates the application database and user and
enables the `pg_trgm` extension for Moodle's full-text search.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Filestore (NFS) and Cloud Storage

Moodle's `moodledata` directory is written to a **Filestore (NFS)** share mounted
into every pod so all replicas see the same uploaded files, course materials, and
user submissions. A dedicated **Cloud Storage** data bucket is also provisioned; the
workload service account is granted access automatically.

- **Console:** Filestore → Instances for the NFS share; Cloud Storage → Buckets for
  the data bucket.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep nfs
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### D. Redis cache

Redis backs Moodle's PHP session handling and application cache. When no external
Redis host is configured and NFS is enabled, the NFS host IP is used as the Redis
endpoint — suitable for development. For production with multiple replicas, set
`redis_host` to a Cloud Memorystore instance IP.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping           # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The Moodle cron password and SMTP password are generated automatically by
`Moodle_Common` and stored as Secret Manager secrets. The database password is
generated and managed by the foundation. All three are injected into pods at runtime;
plaintext never appears in configuration files.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). After deployment,
update the SMTP password secret with your real SMTP credential:
```bash
echo -n "your-smtp-password" | \
  gcloud secrets versions add <smtp-password-secret> --data-file=- --project "$PROJECT"
```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Cloud Scheduler

A Cloud Scheduler job is auto-provisioned on every deployment to drive Moodle's
internal task queue. It fires every minute and authenticates using the auto-generated
`MOODLE_CRON_PASSWORD`.

- **Console:** Cloud Scheduler → Jobs.
- **CLI:**
  ```bash
  gcloud scheduler jobs list --project "$PROJECT"
  gcloud scheduler jobs describe <job-name> --location "$REGION" --project "$PROJECT"
  # Manually trigger a cron run:
  gcloud scheduler jobs run <job-name> --location "$REGION" --project "$PROJECT"
  ```

### G. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A
custom domain with a Google-managed certificate can be enabled, and a static IP can
be reserved so the address survives redeploys. `enable_custom_domain` defaults to
`true` so Moodle's `wwwroot` is always resolvable to a stable address.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and
static IP details.

### H. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Moodle Application Behaviour

- **First-deploy database setup.** Two initialization jobs run before the application
  starts. The `db-init` job creates the Moodle database and user, enables the
  `pg_trgm` extension, and grants privileges (idempotent, safe to re-run). The
  `nfs-init` job creates the required Moodle subdirectories (`filedir`, `temp`,
  `cache`, `localcache`) on the NFS share and sets `www-data` ownership.
- **Automatic cron scheduling.** A Cloud Scheduler job fires every minute targeting
  `/admin/cron.php?password=<MOODLE_CRON_PASSWORD>`. This drives all Moodle
  scheduled tasks: course backups, email notifications, badge processing, and
  activity completions. The job is always created and cannot be disabled.
- **Health path.** Readiness/liveness use `/health.php`, which returns HTTP 200 when
  PHP is operational. The startup probe allows up to 10 minutes for first-boot schema
  creation and plugin registration.
- **SMTP outbound email.** SMTP settings are injected as environment variables.
  Override the defaults using `environment_variables` (see Group 5). The SMTP
  password is auto-generated and stored in Secret Manager; update the secret with
  your real credential after deployment.
- **`wwwroot` resolution.** Moodle's `config.php` resolves `wwwroot` from the
  `APP_URL` environment variable, falling back to `GKE_SERVICE_URL`. Custom domains
  require `enable_custom_domain = true` (the default) to produce a stable URL.
- **Admin login.** The initial admin username and email are configurable via
  `environment_variables`. The admin password is set during Moodle's first install
  via `admin/cli/install_database.php`.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Moodle are listed; every other input is
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
| `application_name` | `moodle` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Moodle LMS` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `4.5.1` | Container image version tag; increment to roll out a new version. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per pod; 2 vCPU recommended for Moodle. |
| `memory_limit` | `4Gi` | Memory per pod; 4 GiB recommended (avoids PHP OOM on imports). |
| `min_instance_count` | `0` | Minimum replicas. Set to `1` for production to keep scheduled tasks running. |
| `max_instance_count` | `5` | Maximum replicas (autoscaler ceiling). |
| `container_port` | `8080` | Moodle/Apache listens on port 8080. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for Unix socket connections. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Override auto-injected SMTP defaults here (e.g., `MOODLE_SMTP_HOST`, `MOODLE_ADMIN_EMAIL`). |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing required for Moodle PHP sessions. |
| `workload_type` | `null` | Auto-resolves to StatefulSet when per-pod storage is enabled. |
| `network_tags` | `['nfsserver']` | Node/pod tags; `nfsserver` is required for NFS connectivity. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable PVC templates for per-pod persistent storage. |
| `stateful_pvc_size` | `10Gi` | Storage size per PVC. |
| `stateful_pvc_mount_path` | `/data` | Container path where the PVC is mounted. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block all scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 if you need eviction headroom. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health.php`, 20 failures × 30 s | Up to 10 minutes for Moodle to complete first-boot setup. |
| `liveness_probe` | HTTP `/health.php`, 120 s initial delay | Periodic health check after startup. |
| `uptime_check_config` | enabled, path `/` | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` and `nfs-init` jobs. |
| `cron_jobs` | `[]` | Supplemental Kubernetes CronJobs (the Cloud Scheduler Moodle cron is always created separately). |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for Moodle `moodledata` (keep enabled — required for all deployments). |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container; injected as `MOODLE_DATA_DIR`. |
| `nfs_volume_name` | `nfs-data-volume` | Kubernetes volume name for the NFS mount. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the data bucket. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional GCS buckets to provision. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts for themes or plugins. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Use Redis for PHP sessions and Moodle application cache. |
| `redis_host` | `""` | Leave empty to use the NFS host IP (development only); set to a Cloud Memorystore IP for production. |
| `redis_port` | `6379` | Redis port (string type). |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Fixed at PostgreSQL — do not change. |
| `application_database_name` | `gkeapp` | Database name. Immutable after first deploy. |
| `application_database_user` | `gkeapp` | Application user. Immutable after first deploy. |
| `db_name` | `moodle` | Moodle-specific database name alias; keep consistent with `application_database_name`. |
| `db_user` | `moodle` | Moodle-specific user alias; keep consistent with `application_database_user`. |
| `database_password_length` | `32` | Generated password length. |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` | restore options | Restore from a backup on deploy. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. Use
this to run additional PostgreSQL extensions or seed data. See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate (required for correct Moodle `wwwroot`). |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Moodle. |
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
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Moodle. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `nfs_server_ip` | Private IP of the Filestore NFS server (sensitive). |
| `nfs_mount_path` | Container path where the NFS share is mounted. |
| `nfs_share_path` | Export path on the NFS server. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` / `nfs_setup_job` | Names of the setup and (optional) import/NFS jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES` | Critical | Moodle requires PostgreSQL; `MOODLE_DB_TYPE = "pgsql"` is hardcoded — any other engine breaks startup. |
| `enable_nfs` | `true` | Critical | Without shared NFS storage, `moodledata` is not shared across replicas and uploads are lost on pod restart. |
| `application_database_name` / `db_name` | set once, keep consistent | Critical | Immutable after first deploy; renaming recreates the DB and destroys data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all pod scheduling. |
| `enable_redis` | `true` | High | With >1 replica, isolated per-pod caches cause PHP session inconsistency. |
| `redis_host` | `""` (NFS) or explicit | High | No valid endpoint if Redis is on but NFS is off and no host is set. |
| `memory_limit` | `4Gi` | High | Too little memory causes PHP OOM during course imports or large file uploads. |
| `session_affinity` | `ClientIP` | High | Without stickiness, multi-replica Moodle logins lose session state. |
| `min_instance_count` | `1` for production | High | `0` can leave the Cloud Scheduler cron job with no pod to deliver to during scale-to-zero periods. |
| `enable_custom_domain` | `true` (default) | High | Without a stable URL, Moodle's `wwwroot` resolves to a transient pod IP, breaking absolute links and file paths. |
| `nfs_mount_path` | `/mnt/nfs` | High | Must match `MOODLE_DATA_DIR`; changing after first deploy moves the data root and breaks the installation. |
| `enable_iap` / `enable_cloud_armor` | enable for admin-facing | Medium | The admin UI is otherwise publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Moodle-specific shared configuration is described in
**[Moodle_Common](Moodle_Common.md)**.
