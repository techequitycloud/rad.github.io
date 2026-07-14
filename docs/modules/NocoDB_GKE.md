---
title: "NocoDB on GKE Autopilot"
description: "Configuration reference for deploying NocoDB on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# NocoDB on GKE Autopilot

NocoDB is an open-source Airtable alternative that transforms any database into a
smart spreadsheet with a no-code interface, REST and GraphQL APIs, and built-in
automations. This module deploys NocoDB on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services NocoDB uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

NocoDB runs as a Node.js workload. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pods, 1 vCPU / 1 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Default engine; MySQL 8.0 also supported |
| Object storage | Cloud Storage | A dedicated uploads bucket for file attachments |
| Cache (optional) | Redis | Disabled by default; required when running multiple replicas |
| Secrets | Secret Manager | Auto-generated JWT secret (`NC_AUTH_JWT_SECRET`) and database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is the default.** MySQL 8.0 is also supported; set `database_type`
  before first deploy.
- **NocoDB connects via private IP TCP, not the Auth Proxy socket.** The Cloud SQL
  Auth Proxy sidecar is enabled by default in the GKE variant (`enable_cloudsql_volume
  = true`), but NocoDB's internal URL constructor requires a TCP host — the private IP
  is used, not the Unix socket path.
- **NFS is disabled by default.** NocoDB stores file attachments in Cloud Storage, not
  on a shared filesystem.
- **Redis is disabled by default.** A single replica runs without Redis; enable it
  before scaling beyond one pod.
- **The JWT secret is generated automatically** and stored in Secret Manager. Do not
  rotate it after the first deploy — all existing sessions and API tokens would be
  immediately invalidated.
- **NocoDB handles its own database migrations on first start.** No external init job
  is required, though a `db-init` job is still provided to create the database and user.
- **Health probes target `/api/v1/health`**, the dedicated health endpoint NocoDB
  exposes.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the NocoDB workload

NocoDB pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the
minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the NocoDB workload to see
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

NocoDB stores all application data (tables, views, automations, row data) in a
managed Cloud SQL for PostgreSQL 15 instance. Pods reach it over a private IP TCP
connection. On first deploy an initialization Job creates the application database
and user; NocoDB then runs its own schema migrations on startup.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see
[App_GKE](App_GKE.md).

### C. Cloud Storage — file uploads

NocoDB stores file attachments in a dedicated **Cloud Storage** bucket. The bucket
name is injected into the container as `GCS_BUCKET_NAME` automatically. The
workload service account is granted access via Workload Identity.

- **Console:** Cloud Storage → Buckets → select the uploads bucket.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/      # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for CMEK and additional bucket options.

### D. Redis cache (optional)

Redis backs NocoDB's caching layer and, in multi-replica deployments, keeps cache
state consistent across pods. Redis is disabled by default; a `redis_host` must be
supplied when it is enabled.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The NocoDB JWT secret (`NC_AUTH_JWT_SECRET`) and the database password are stored as
Secret Manager secrets and injected into pods at runtime; plaintext never appears
in configuration.

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
Monitoring. Optional uptime checks against `/api/v1/health` and alert policies are
available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. NocoDB Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) creates the
  NocoDB database and user before the application starts. It is idempotent and safe
  to re-run.
- **Self-managed migrations.** NocoDB runs its own database schema migrations on
  first startup — there is no need to configure external migration jobs.
- **JWT secret.** `NC_AUTH_JWT_SECRET` is generated automatically and stored in
  Secret Manager. Do not rotate it after the first deploy; all existing sessions and
  API tokens are immediately invalidated if the secret changes.
- **GCS uploads.** The uploads bucket name (`GCS_BUCKET_NAME`) is injected
  automatically. NocoDB stores all file attachments there; the Service Account is
  granted object-level access via Workload Identity.
- **NC_DB_* environment variables.** The custom Dockerfile in `NocoDB_Common` maps
  the standard `DB_*` connection variables (injected by the foundation) to the
  `NC_DB_*` names NocoDB expects. When `container_image_source = "prebuilt"` the
  mapping is not applied — configure `NC_DB_*` variables manually via
  `environment_variables`.
- **Health path.** Readiness and liveness probes target `/api/v1/health`, which
  returns HTTP 200 when NocoDB is ready to accept requests.
- **Multi-replica sessions.** With more than one pod and no Redis, NocoDB cannot
  share session or cache state; users may be logged out when requests route to a
  different pod. Enable Redis and set `redis_host` before scaling above one replica.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for NocoDB are listed; every other input is
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
| `application_name` | `nocodb` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `NocoDB` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `latest` | NocoDB image version tag; pin to a specific version for production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "1Gi" }` | CPU and memory limits for the NocoDB pod; minimum `1Gi` memory. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 to avoid cold-start delays. |
| `max_instance_count` | `10` | Maximum replicas (autoscaler ceiling). |
| `container_port` | `8080` | NocoDB listens on port 8080. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar (connects via private IP, not socket). |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |
| `container_image_source` | `custom` | `custom` builds via Cloud Build with NC_DB_* mapping; `prebuilt` deploys an existing image. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings injected into the container. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name for additional secrets. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing; recommended for consistent NocoDB session behaviour. |
| `workload_type` | `null` | Auto-resolves to `Deployment`; set `StatefulSet` only if per-pod storage is needed. |
| `network_tags` | `["nfsserver"]` | Node/pod tags; `nfsserver` is required if NFS is ever enabled. |

### Group 7 — StatefulSet

StatefulSet options (PVC templates, headless service, pod management, update
strategy, fsGroup) — see [App_GKE](App_GKE.md). Not normally needed
for NocoDB, which stores state in PostgreSQL and GCS.

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block all scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` / `startup_probe` | `/api/v1/health` | HTTP probe, 30 s initial delay, 30 failures allowed. |
| `health_check_config` / `liveness_probe` | `/api/v1/health` | HTTP liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check against `/api/v1/health`. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Recurring Kubernetes CronJobs (e.g., custom data-sync tasks). |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is not required for NocoDB — files go to Cloud Storage. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path if NFS is enabled. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the uploads bucket. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional GCS buckets. |
| `gcs_volumes` | `[]` | GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis. Required when running more than one replica. |
| `redis_host` | `""` | Redis host. Required when `enable_redis = true`. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Default PostgreSQL; `MYSQL_8_0` also supported. Set before first deploy. |
| `application_database_name` | `nocodb` | Database name. Immutable after first deploy. |
| `application_database_user` | `nocodb` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Optional PostgreSQL extensions to install. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. |

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
| `enable_iap` | `false` | Require Google sign-in in front of NocoDB. Recommended for internal workspaces. |
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
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach NocoDB. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (private IP) / port. |
| `storage_buckets` | Created Cloud Storage buckets (includes the uploads bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
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
| `NC_AUTH_JWT_SECRET` | auto-generated (immutable) | Critical | Rotating after first deploy immediately invalidates all sessions and API tokens. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup file fails the import job. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all scheduling. |
| `container_resources.memory_limit` | `1Gi` | High | NocoDB's Node.js process is OOM-killed below 512 Mi; production workloads with many automations need 2 Gi. |
| `enable_redis` | `true` when >1 replica | High | Multiple pods without Redis cause session invalidation when requests route to different pods. |
| `redis_host` | explicit when Redis on | High | A missing host causes all Redis connections to fail on pod startup. |
| `min_instance_count` | `1` | High | `0` allows cold starts during which webhook callbacks time out and are dropped. |
| `max_instance_count` | keep low without Redis | Medium | Increasing above `1` without Redis causes session invalidation. |
| `enable_iap` / `enable_cloud_armor` | enable for internal | Medium | NocoDB is otherwise publicly reachable from the load-balancer IP. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |
| `application_version` | pin to specific tag | Medium | `latest` triggers uncontrolled upgrades on every container rebuild. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. NocoDB-specific application configuration shared with the
Cloud Run variant is described in **[NocoDB_Common](NocoDB_Common.md)**.
