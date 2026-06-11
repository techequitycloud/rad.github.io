---
title: "Twenty CRM on GKE Autopilot"
---

# Twenty CRM on GKE Autopilot

Twenty is an open-source CRM with 25,000+ GitHub stars, built as a modern,
developer-friendly alternative to Salesforce and HubSpot. This module deploys
Twenty on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which
provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Twenty uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle
— refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Twenty runs as a Node.js workload. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pods, 1 vCPU / 1 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Twenty does not support MySQL |
| Object storage | Cloud Storage | Optional; a dedicated storage bucket when `enable_gcs_storage = true` |
| Background jobs | Redis (optional) | bull-mq when enabled; pg-boss (PostgreSQL-backed) by default with no extra infra |
| Secrets | Secret Manager | Auto-generated app secret (`APP_SECRET` / `ENCRYPTION_KEY`) and database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed; selecting MySQL or
  `NONE` breaks startup.
- **Redis is enabled by default.** Twenty v0.4+ hardcodes Redis for session and cache
  storage — without a valid Redis connection Twenty fails to start. When `redis_host`
  is left empty, the platform NFS VM IP is used (requires `enable_nfs = true` or an
  explicit `redis_host`).
- **pg-boss is the job queue when Redis is disabled.** It requires no additional
  infrastructure and uses the PostgreSQL database directly.
- **File attachments default to ephemeral local storage.** Enable `enable_gcs_storage`
  for persistent object storage using GCS.
- **Two init jobs run before the server starts.** `db-init` creates the database and
  user; `twenty-migrate` runs TypeORM schema migrations. Database migrations are
  disabled in the main container (`DISABLE_DB_MIGRATIONS=true`) to keep cold starts
  fast after the first boot.
- **`SERVER_URL` and `FRONT_BASE_URL` must be set manually.** Without them, API links,
  CORS, and email invitations are broken.
- The **APP_SECRET / ENCRYPTION_KEY** is generated automatically and stored in Secret
  Manager; you never set it in plain text.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Twenty workload

Twenty pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Twenty workload to see pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Twenty stores all application data (contacts, pipelines, custom objects) in a managed
Cloud SQL for PostgreSQL 15 instance. Pods reach it privately through the **Cloud SQL
Auth Proxy** sidecar over a Unix socket, so no public IP is exposed. On first deploy
two initialization Jobs run: `db-init` creates the database and user, and
`twenty-migrate` runs schema migrations using Twenty's own entrypoint.

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

### C. Cloud Storage (optional file storage)

When `enable_gcs_storage = true`, a dedicated **Cloud Storage** bucket is provisioned
and Twenty is configured to use the GCS S3-compatible API (`STORAGE_TYPE=s3`). Without
it, file attachments are stored in the pod's ephemeral local filesystem and are lost
on restart or rolling update.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/       # bucket name is in the Outputs
  ```

Note: when `enable_gcs_storage = true`, you must supply GCS HMAC keys via
`secret_environment_variables` (`STORAGE_S3_ACCESS_KEY_ID` and
`STORAGE_S3_SECRET_ACCESS_KEY`). Generate them in the Console under Cloud Storage →
Settings → Interoperability.

### D. Redis (background jobs)

Redis backs Twenty's session and cache storage in v0.4+ and, when enabled, switches
background processing to **bull-mq**. Without Redis, Twenty uses **pg-boss** (a
PostgreSQL-backed job queue) with no additional infrastructure. When `redis_host` is
empty and `enable_nfs = true`, the NFS VM IP is used as the Redis host.

When `enable_redis = true`, a dedicated worker Deployment must be configured via
`additional_services` to consume the bull-mq queue.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The Twenty app secret (`APP_SECRET` / `ENCRYPTION_KEY`) and the database password are
stored as Secret Manager secrets and injected into pods at runtime via Workload
Identity; plaintext never appears in configuration.

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

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Twenty Application Behaviour

- **First-deploy database setup.** Two initialization Jobs run sequentially before
  the application starts:
  1. `db-init` — connects to Cloud SQL via the Auth Proxy Unix socket, creates the
     PostgreSQL database and user, grants privileges, and installs the `uuid-ossp`
     extension. It is idempotent and safe to re-run.
  2. `twenty-migrate` — runs Twenty's own entrypoint (`twenty-entrypoint.sh`) with
     `DISABLE_DB_MIGRATIONS=false`, executing TypeORM schema migrations and registering
     background cron jobs.
  Inspect them after deploy:
  ```bash
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  kubectl logs -n "$NAMESPACE" job/db-init
  kubectl logs -n "$NAMESPACE" job/twenty-migrate
  ```
- **Migrations disabled on normal boot.** The main container runs with
  `DISABLE_DB_MIGRATIONS=true` so migrations only run via the `twenty-migrate` job.
  This reduces cold-start time from several minutes to seconds on subsequent boots.
- **Background jobs.** When Redis is disabled (pg-boss mode), background jobs — email
  sending, webhook delivery, data sync — are processed by the main Twenty service.
  When Redis is enabled (bull-mq mode), a separate worker Deployment must be deployed
  via `additional_services` pointing to the same image with the worker command.
  Verify job processing:
  ```bash
  kubectl get pods -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<worker-service-name>
  ```
- **Health path.** The startup probe polls `/healthz` with a 120-second initial delay
  and up to 40 failures (10 minutes total) to accommodate first-boot migrations. The
  liveness probe polls `/healthz` with a 30-second initial delay.
- **`SERVER_URL` is required.** Without it, Twenty generates broken API links, CORS
  errors occur on all API calls, and email invitations fail. Set it via
  `environment_variables`:
  ```bash
  environment_variables = {
    SERVER_URL     = "https://crm.example.com"
    FRONT_BASE_URL = "https://crm.example.com"
  }
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Twenty are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

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
| `application_name` | `twenty` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Twenty CRM` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `latest` | Twenty image version tag. **Pin to a specific version for production** (e.g., `0.50.0`). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` (Cloud Build) or `prebuilt` (existing image URI). |
| `container_image` | `""` | Override image URI. Leave empty for Cloud Build to manage. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="1Gi" }` | Pod CPU/memory limits and optional requests. Raise to `2Gi` for production. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 to avoid cold-start on webhook/job workloads. |
| `max_instance_count` | `3` | Maximum replicas (autoscaler ceiling). |
| `container_port` | `3000` | Twenty listens on port 3000. Do not change unless using a custom image. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for Unix socket connections. |
| `enable_image_mirroring` | `true` | Mirror the Twenty image into Artifact Registry. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Plain-text settings. **Set `SERVER_URL` and `FRONT_BASE_URL` here.** |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use for `STORAGE_S3_ACCESS_KEY_ID` and `STORAGE_S3_SECRET_ACCESS_KEY` when GCS storage is enabled. |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before restarting pods. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | `None` (round-robin) or `ClientIP` (sticky). Twenty uses JWT (stateless) — sticky sessions are not required. |
| `gke_cluster_name` | `""` | Target cluster. Auto-discovered if empty. |
| `prereq_gke_subnet_cidr` | `10.201.0.0/24` | CIDR for inline GKE subnet. Must be unique per deployment sharing the same VPC. |
| `namespace_name` | `""` | Kubernetes namespace. Auto-generated if empty. |
| `network_tags` | `[]` | Node/pod tags for firewall rule targeting. |

### Group 7 — Pod Disruption & Topology

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protect availability during node upgrades. Enable when `max_instance_count > 1`. |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 if you need eviction headroom. |
| `enable_topology_spread` | `false` | Spread pods across zones. Recommended for production. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block scheduling. |

### Group 11 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `enable_gcs_storage` | `false` | Provision a GCS bucket for persistent file storage using the S3-compatible API. |
| `create_cloud_storage` | `true` | Provision additional `storage_buckets` entries. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned storage bucket. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 13 — NFS

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS (Filestore) volume. Not required for Twenty; enable only when using NFS IP as the Redis host. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` and `twenty-migrate` jobs. |
| `cron_jobs` | `[]` | Additional recurring Kubernetes CronJobs. |
| `additional_services` | `[]` | Additional Kubernetes Deployments. Required for a dedicated bull-mq worker when `enable_redis = true`. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/healthz`, 120s delay, 40 failures | Probes `/healthz`; allows up to ~10 minutes for first-boot migrations. |
| `health_check_config` | HTTP `/healthz`, 30s delay | Liveness probe. |
| `uptime_check_config` | enabled, path `/healthz` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 15 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — do not change. Options: `POSTGRES_15`, `POSTGRES_14`, `POSTGRES_13`. |
| `application_database_name` | `twenty` | Database name. Immutable after first deploy. |
| `application_database_user` | `twenty` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_postgres_extensions` | `false` | Install additional PostgreSQL extensions during `db-init`. |
| `postgres_extensions` | `[]` | List of extensions to install (e.g., `['pgvector', 'pg_trgm']`). |

### Group 16 — Stateful Workload (PVC)

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Creates a PVC and auto-selects StatefulSet. Setting `workload_type = "Deployment"` alongside this fails at plan time. |
| `stateful_pvc_size` | `10Gi` | PVC size. |
| `stateful_pvc_mount_path` | `/data` | Container path where the PVC is mounted. |

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
| `enable_custom_domain` | `false` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. Must match `SERVER_URL`. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Twenty. Useful for internal CRM access. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Redis & Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Enable Redis. Required for Twenty v0.4+; disabling forces pg-boss. |
| `redis_host` | `""` | Redis endpoint. When empty, the NFS VM IP is used (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | _(set)_ | Policy name. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires explicit `organization_id`). |
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
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Twenty. |
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
| `SERVER_URL` / `FRONT_BASE_URL` (in `environment_variables`) | public URL of deployment | Critical | API links are broken, CORS errors block all requests, email invitations fail. Set before first use. |
| `database_type` | `POSTGRES_15` | Critical | Twenty requires PostgreSQL; MySQL or `NONE` breaks schema migrations and startup. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys data. |
| `enable_cloudsql_volume` | `true` | Critical | Twenty connects via the Auth Proxy Unix socket; disabling removes the socket and breaks all DB connections. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job; re-enabling on a live deployment overwrites data. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all scheduling. |
| `APP_SECRET` / `ENCRYPTION_KEY` (auto-generated) | do not rotate manually | Critical | Rotating the secret invalidates all active JWT sessions, immediately logging out every user. |
| `enable_redis` | `true` (required in v0.4+) | High | Without Redis, Twenty v0.4+ fails to start; session and cache storage are hardcoded to Redis. |
| `redis_host` | explicit host or `enable_nfs = true` | High | When `enable_redis = true` and `redis_host` is empty with no NFS VM, the Redis URL is empty and Twenty fails to connect. |
| `additional_services` (worker) | configured when using Redis | High | When `enable_redis = true`, bull-mq is active but no worker processes the queue; background jobs (email, webhooks) never run. |
| `enable_gcs_storage` | `true` for production | High | Without GCS storage, file attachments are stored in ephemeral pod local storage and lost on restart. |
| `STORAGE_S3_ACCESS_KEY_ID` / `SECRET_ACCESS_KEY` | via `secret_environment_variables` | High | When GCS storage is enabled, HMAC keys are not auto-generated; all file operations fail without them. |
| `container_resources.memory_limit` | `2Gi` for production | High | Below 1 GiB the Node.js process is OOM-killed under load. |
| `application_version` | pinned version (e.g., `0.50.0`) | High | `latest` resolves to a different image on each Cloud Build run, making rollbacks unpredictable. |
| `prereq_gke_subnet_cidr` | unique per deployment | High | Overlapping CIDRs with an existing subnet fail GKE node pool provisioning. |
| `min_instance_count` | `1` | Medium | `0` allows scale-to-zero; Twenty cold starts take 30–60 seconds and may miss incoming webhooks. |
| `enable_iap` / `enable_cloud_armor` | enable for non-public deployments | Medium | The CRM interface is otherwise publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |
| `organization_id` | set explicitly for VPC-SC | Medium | VPC-SC perimeter is not activated without this — `enable_vpc_sc = true` has no effect. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Twenty-specific
application configuration shared with the Cloud Run variant is described in
**[Twenty_Common](Twenty_Common.md)**.
