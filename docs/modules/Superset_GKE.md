---
title: "Apache Superset on GKE Autopilot"
description: "Configuration reference for deploying Apache Superset on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Apache Superset on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Superset_GKE.png" alt="Apache Superset on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Apache Superset is an open-source data exploration and visualisation platform trusted
by organisations worldwide. This module deploys Superset on **GKE Autopilot** on top
of the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Superset uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle
— refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Superset runs as a Python/Gunicorn web workload. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Python/Gunicorn pods, 2 vCPU / 2 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — stores dashboards, charts, datasets, and user settings |
| Object storage | Cloud Storage | A dedicated data bucket provisioned automatically |
| Cache & async queries | Redis | Disabled by default; strongly recommended for production multi-user deployments |
| Secrets | Secret Manager | Auto-generated `SUPERSET_SECRET_KEY` and database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is required.** Superset uses it as its metadata database for all
  dashboards, charts, datasets, and role definitions. MySQL is not supported.
- **`SUPERSET_SECRET_KEY` is auto-generated.** A 50-character random key is generated
  and stored in Secret Manager. It signs Flask sessions — rotating it invalidates all
  active user sessions. Treat it as immutable after the first deploy.
- **Two-phase initialisation runs automatically.** A `db-init` job creates the
  PostgreSQL database and user; then an `app-init` job runs schema migrations and
  creates the admin user. Both run on every deploy but are idempotent.
- **Session affinity is `ClientIP`.** Superset's Flask sessions benefit from sticky
  routing so requests from the same browser reach the same pod.
- **Redis is disabled by default.** Without Redis, Celery workers have no broker;
  async query execution and dashboard caching are unavailable. Enable for production.
- The health probe targets **`/health`** — Superset's Gunicorn readiness endpoint.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Superset workload

Superset pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Superset workload to see
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

Superset stores all metadata (dashboards, charts, datasets, users, roles, database
connections) in a managed Cloud SQL for PostgreSQL 15 instance. Pods connect privately
through the **Cloud SQL Auth Proxy** sidecar over a Unix socket, so no public IP is
exposed. On first deploy the `db-init` job creates the application database and user,
and the `app-init` job runs `superset db upgrade` to apply the schema.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Storage

A dedicated **Cloud Storage** bucket is provisioned automatically for Superset data
exports, chart outputs, and report files. The workload service account is granted
access automatically.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for GCS Fuse mounts and CMEK options.

### D. Redis cache and async query engine

Redis serves as Superset's caching backend and Celery broker. When enabled, it powers
async SQL execution, dashboard cache warming, and scheduled reports. Without Redis,
all queries run synchronously and block Gunicorn workers.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The `SUPERSET_SECRET_KEY` and the database password are stored as Secret Manager
secrets and injected into pods at runtime; plaintext never appears in configuration.

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
custom domain with a Google-managed certificate can be enabled, and a static IP can
be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and
static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flows to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. An optional uptime check against `/health` and optional alert
policies are available (disabled by default).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Superset Application Behaviour

- **First-deploy database setup.** The `db-init` job creates the Superset database and
  user idempotently before the application starts. It runs with `postgres:15-alpine`
  and shuts down the Cloud SQL Auth Proxy sidecar via `quitquitquit` on completion.
- **Schema migrations on every deploy.** The `app-init` job runs `superset db upgrade`
  on each deploy, applying any pending Flask-AppBuilder and Superset schema changes
  automatically. This job then creates or updates the admin user with
  `superset fab create-admin`, and finally runs `superset init` to load default roles
  and permissions.
- **Startup sequence.** The `app-init` job depends on `db-init` completing
  successfully. Its 30-minute timeout accommodates slow first-run migrations on large
  or complex schemas. The startup probe allows up to 180 seconds (60 s initial delay,
  12 failure thresholds at 10 s intervals) for the Gunicorn worker pool to come up.
- **Flask secret key.** `SUPERSET_SECRET_KEY` signs Flask sessions and encrypts
  database connection credentials stored in Superset's metadata. Changing it after the
  first deploy invalidates all sessions and makes stored credentials unreadable. The
  key is auto-generated as a 50-character random string in Secret Manager.
- **Async queries and scheduled reports.** Superset's Celery workers use Redis as the
  broker and result backend. Without Redis, async queries and scheduled reports are
  unavailable. Configure `enable_redis = true` and supply `redis_host` for production.
- **Health path.** Readiness/liveness probes target `/health`, which returns HTTP 200
  when the Gunicorn worker pool is ready.
- **Admin login.** The admin credentials are set through the environment variables
  `SUPERSET_ADMIN_USERNAME`, `SUPERSET_ADMIN_EMAIL`, and `SUPERSET_ADMIN_PASSWORD`.
  The password defaults to the value of `SUPERSET_SECRET_KEY` when not explicitly set.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Superset are listed; every other input is
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
| `application_name` | `superset` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Apache Superset` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `latest` | Superset image version tag; pin to a specific release for production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | CPU and memory per pod; 2 vCPU / 2 GiB minimum for Superset. |
| `container_port` | `8088` | Superset/Gunicorn listens on port 8088. |
| `container_image_source` | `custom` | `custom` builds the bundled Dockerfile (required for psycopg2); `prebuilt` uses an existing image. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 to avoid cold-start delays. |
| `max_instance_count` | `5` | Maximum replicas (autoscaler ceiling). |
| `timeout_seconds` | `600` | Request timeout; extended for long-running SQL queries. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `SUPERSET_SECRET_KEY` is injected automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing recommended for Superset Flask sessions. |
| `workload_type` | `null` | Auto-resolves to StatefulSet when per-pod storage is enabled. |
| `network_tags` | `['nfsserver']` | Node/pod tags for firewall rules. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable PVC templates in a StatefulSet. Superset does not require per-pod storage. |
| `stateful_pvc_size` | `10Gi` | Storage size for each PVC when enabled. |
| `stateful_pvc_mount_path` | `/data` | Container mount path for the PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block all scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 if you need eviction headroom. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health`, 60 s delay, 12 failures | Allows up to 180 s for the Gunicorn worker pool to initialise. |
| `health_check_config` | HTTP `/health`, 60 s delay | Liveness probe. |
| `uptime_check_config` | disabled, `/health` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in two-phase db-init + app-init pipeline. |
| `cron_jobs` | `[]` | Recurring CronJobs — useful for cache warmup or report generation. |
| `additional_services` | `[]` | Sidecar or helper GKE services (e.g. Celery workers). |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Shared Filestore volume. Superset does not require NFS — state lives in PostgreSQL. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container if NFS is enabled. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the data bucket. |
| `storage_buckets` / `gcs_volumes` | _(set)_ | Additional buckets / GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis for Celery and caching. **Strongly recommended for production.** |
| `redis_host` | `""` | Redis hostname or IP. Required when `enable_redis = true`. |
| `redis_port` | `"6379"` | Redis port (string in the GKE variant). |
| `redis_auth` | `""` | Optional Redis authentication password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — do not change. Superset requires PostgreSQL. |
| `application_database_name` | `superset_db` | Database name. Immutable after first deploy. |
| `application_database_user` | `superset_user` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` | restore options | Restore from a backup on deploy. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Superset. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | _(set)_ | Policy name. |

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
| `service_url` | URL to reach Superset. |
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
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | GitHub repo details. |
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
| `SUPERSET_SECRET_KEY` (auto-generated) | immutable after first deploy | Critical | Changing the key invalidates all active sessions and makes stored database connection credentials in Superset's metadata permanently unreadable. |
| `database_type` | `POSTGRES_15` | Critical | Superset requires PostgreSQL; changing breaks startup. |
| `enable_cloudsql_volume` | `true` | Critical | Disabling removes the Auth Proxy sidecar; all PostgreSQL connections fail. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all dashboards and metadata. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all pod scheduling. |
| `enable_redis` | `true` for production | High | Without Redis, Celery workers have no broker; async queries and scheduled reports are unavailable. |
| `redis_host` | set explicitly | High | Required when `enable_redis = true`; empty causes Celery workers to fail on startup. |
| `container_resources.memory_limit` | `2Gi` minimum | High | Under 1 GiB Gunicorn workers are OOM-killed during query execution. |
| `container_resources.cpu_limit` | `2000m` | High | Under 1000m the app-init migration job may time out in its 30-minute window. |
| `min_instance_count` | `1` | High | `0` causes scale-to-zero; async queries submitted during cold-start are lost. |
| `session_affinity` | `ClientIP` | High | Without stickiness, Flask session state is lost between requests on multi-replica deployments. |
| `startup_probe_config.failure_threshold` | `12` or higher | High | Reducing too far causes GKE to kill pods before Superset finishes database migrations. |
| `application_version` | pin to a specific release | Medium | `latest` triggers uncontrolled upgrades that may introduce breaking API changes. |
| `enable_iap` / `enable_cloud_armor` | enable for production | Medium | Without them, the Superset login form is publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Superset-specific
application configuration shared with the Cloud Run variant is described in
**[Superset_Common](Superset_Common.md)**.
