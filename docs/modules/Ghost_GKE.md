---
title: "Ghost on GKE Autopilot"
description: "Configuration reference for deploying Ghost on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Ghost on GKE Autopilot

Ghost is a modern open-source publishing platform powering 2M+ publications with built-in membership, subscriptions, and newsletters. This module deploys Ghost on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Ghost uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics that are common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Ghost runs as a Node.js web workload. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pods, 2 vCPU / 4 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for MySQL 8.0 | Required — Ghost 6.x does not support PostgreSQL |
| Shared files | Filestore (NFS) | Uploaded content and themes shared across all replicas |
| Object storage | Cloud Storage | A dedicated content bucket (`ghost-content`) provisioned automatically |
| Cache | Redis | Enabled by default; falls back to the NFS host IP when no Redis host is given |
| Secrets | Secret Manager | Database password managed automatically |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** Ghost 6.x requires MySQL; PostgreSQL is not supported and will not start.
- **`database__client = "mysql"` is injected automatically.** Without this Ghost silently falls back to SQLite — the module handles it so you never need to set it manually.
- **Redis is enabled by default.** Ghost uses Redis for page caching to reduce database load and improve response times.
- **Session affinity is `ClientIP`.** Ghost's admin panel and membership portal use server-side sessions; requests from a browser are pinned to one pod.
- **A `ghost-content` GCS bucket is provisioned automatically** by `Ghost_Common` and does not need to be added to `storage_buckets`.
- **A `db-init` job runs on every apply** to idempotently create the Ghost MySQL database and user.
- **Health probes target `/`** with a 90-second initial delay to allow Ghost to run database migrations and compile themes on first boot.
- The **database password** is generated automatically and stored in Secret Manager.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Ghost workload

Ghost pods are scheduled on Autopilot, which bills for the CPU/memory the pods actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Ghost workload to see pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type (Deployment vs StatefulSet) are managed.

### B. Cloud SQL for MySQL 8.0

Ghost stores all application data (posts, members, settings) in a managed Cloud SQL for MySQL 8.0 instance. Pods reach it privately through the **Cloud SQL Auth Proxy** sidecar over a Unix socket, so no public IP is exposed. On first deploy a `db-init` Job creates the application database and user.

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

Uploaded content (images, themes, files) is written to a **Filestore (NFS)** share mounted into every pod so all replicas see the same files. A dedicated **Cloud Storage** bucket (`ghost-content`) is also provisioned automatically for content; the workload service account is granted access automatically.

- **Console:** Filestore → Instances for the NFS share; Cloud Storage → Buckets for the content bucket.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<content-bucket>/          # bucket name is in the Outputs
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### D. Redis cache

Redis backs Ghost's page caching. When no external Redis host is configured and NFS is enabled, the NFS host IP is used as the Redis endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  # Confirm Redis env vars are set in the Ghost pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### E. Secret Manager

The database password is stored as a Secret Manager secret and injected into pods at runtime; plaintext never appears in configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

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

## 3. Ghost Application Behaviour

- **First-deploy database setup.** A `db-init` Job connects to Cloud SQL via the Auth Proxy and idempotently creates the Ghost database (with `utf8mb4` charset and `utf8mb4_0900_ai_ci` collation), creates the application user, and grants full privileges. The job runs on every apply and is safe to re-run.
- **Slow first boot.** Ghost runs database migrations and compiles themes on first start. The startup probe allows 90 seconds of initial delay (`initial_delay_seconds = 90`, `failure_threshold = 10`) — do not reduce this below 60 seconds or Ghost will be killed before it finishes initialising.
- **Dynamic URL detection.** The custom entrypoint script queries the Cloud Run/GKE metadata server at startup to discover the service URL and export it as `url` and `admin__url` for Ghost. An explicit `url` environment variable always takes precedence.
- **Database connection.** The entrypoint maps the foundation's `DB_HOST`, `DB_USER`, `DB_NAME`, `DB_PASSWORD`, and `DB_PORT` variables to Ghost's `database__connection__*` settings automatically. When `DB_HOST` starts with `/` it is treated as a Unix socket path.
- **SMTP for email.** Ghost requires SMTP for member sign-ups, password resets, and newsletter delivery. Pre-populated `environment_variables` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL`, `EMAIL_FROM`) — configure them before inviting members.
- **Admin login.** Ghost's admin panel is at `<url>/ghost`. On first boot Ghost creates an admin user interactively.
- **Health path.** Readiness/liveness probes target `/`, which returns HTTP 200 when Ghost is fully initialised.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for Ghost are listed; every other input is inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

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
| `application_name` | `ghost` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Ghost Blog` | Friendly name shown in the Console. |
| `application_description` | `Ghost Publishing Platform on GKE Autopilot` | Workload description annotation. |
| `application_version` | `6.14.0` | Ghost image version tag; increment to roll out a new version. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per pod; 2 vCPU minimum for Ghost 6.x. |
| `memory_limit` | `4Gi` | Memory per pod; 4 GiB recommended (Ghost OOMs below 1 GiB). |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 to avoid cold starts and migration delays. |
| `max_instance_count` | `5` | Maximum replicas (autoscaler ceiling). |
| `container_port` | `2368` | Ghost's native HTTP port. Do not change unless your Dockerfile binds to a different port. |
| `container_image_source` | `custom` | `custom` builds via Cloud Build (default); `prebuilt` deploys an existing image. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. Required for Ghost. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{SMTP_HOST="", SMTP_PORT="25", SMTP_USER="", SMTP_PASSWORD="", SMTP_SSL="false", EMAIL_FROM="ghost@example.com"}` | SMTP settings pre-populated for Ghost email delivery. `database__client=mysql` is injected automatically — do not set it here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing required for Ghost admin and membership sessions. |
| `workload_type` | `null` | Auto-resolves to StatefulSet when per-pod storage is enabled. |
| `network_tags` | `['nfsserver']` | Node/pod tags; `nfsserver` is required for NFS connectivity. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable per-pod PVCs for StatefulSet deployments. |
| `stateful_pvc_size` | `10Gi` | Storage per pod. Provision more for active media-heavy publications. |
| `stateful_pvc_mount_path` | `/data` | Container path for the per-pod PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 if you need eviction headroom. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 90s initial delay, 10 failures | HTTP probe against Ghost's root path (200 when ready). Generous delay for first-boot migrations. |
| `liveness_probe` | HTTP `/` 60s initial delay | Liveness probe targeting Ghost's root path. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Workload Automation

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (`mysql:8.0-debian`). |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs for Ghost maintenance tasks. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see [App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for Ghost content (keep enabled for multi-replica). |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the additional bucket from `storage_buckets`. The `ghost-content` bucket is always provisioned automatically. |
| `storage_buckets` | `[{name_suffix="data"}]` | Additional buckets beyond the auto-provisioned content bucket. |
| `gcs_volumes` | `[]` | GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Use Redis for Ghost page caching. |
| `redis_host` | `""` | Leave empty to use the NFS host IP; set explicitly when NFS is disabled. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Ghost requires MySQL 8.0 — do not change. |
| `db_name` | `ghost` | MySQL database name. Immutable after first deploy. |
| `db_user` | `ghost` | Application user. Immutable after first deploy. |
| `application_database_name` | `gkeappdb` | Cloud SQL database name (App_GKE variable). Override to `ghost` for consistency. |
| `application_database_user` | `gkeappuser` | Cloud SQL user (App_GKE variable). Override to `ghost` for consistency. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See [App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `false` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. Ghost must know its public URL at startup — ensure the domain matches. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Ghost. |
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

These values are returned on a successful deployment and are the quickest way to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Ghost. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (includes the `ghost-content` bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
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
| `database_type` | `MYSQL_8_0` | Critical | Ghost requires MySQL 8.0; any other engine breaks startup. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_nfs` | `true` | Critical | Without shared storage, uploaded content is lost on pod restart and not shared across replicas. |
| `container_port` | `2368` | Critical | Ghost's native port; mismatching it causes all health probes to fail. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all scheduling. |
| `startup_probe` initial_delay_seconds | `90` | High | Reducing below 60 causes Kubernetes to kill Ghost before it finishes running migrations. |
| `enable_redis` | `true` | High | Without Redis, Ghost serves all pages without a cache, increasing database load. |
| `redis_host` | `""` (NFS) or explicit | High | No valid endpoint if Redis is on but NFS is off and no host is set. |
| `memory_limit` | `4Gi` | High | Too little memory causes Node.js OOM during newsletter sends or theme compilation. |
| `session_affinity` | `ClientIP` | High | Without stickiness, multi-replica Ghost admin sessions fail intermittently. |
| `environment_variables` SMTP settings | real SMTP server | High | No email delivery means no member sign-ups, no password resets, no newsletters. |
| `container_image_source` | `custom` | High | The upstream Ghost image lacks the custom entrypoint that maps DB credentials and detects the service URL. |
| `min_instance_count` | `1` | Medium | `0` causes cold starts during which Ghost runs migrations, making first requests time out. |
| `enable_iap` / `enable_cloud_armor` | enable for admin-facing | Medium | The Ghost admin panel (`/ghost`) is otherwise publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Ghost-specific application configuration shared with the Cloud Run variant is described in **[Ghost_Common](Ghost_Common.md)**.
