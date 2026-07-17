---
title: "Umami GKE Module \u2014 Configuration Guide"
description: "Configuration reference for deploying Umami on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Umami GKE Module — Configuration Guide

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Umami_GKE.png" alt="Umami GKE Module — Configuration Guide" style={{maxWidth: "100%", borderRadius: "8px"}} />

This guide describes every configuration variable available in the `Umami_GKE` module. `Umami_GKE` is a **wrapper module** that combines the generic [`App_GKE`](App_GKE.md) infrastructure module with the [`Umami_Common`](Umami_Common.md) shared application configuration to deploy the [Umami](https://umami.is/) privacy-focused web analytics platform on Google Kubernetes Engine (GKE) Autopilot.

Most configuration options in `Umami GKE` map directly to the same options in `App GKE`. Where a variable is identical in behaviour, this guide references the `App GKE` guide rather than repeating the same documentation. Only the variables and defaults that are **specific to Umami** are described in full here.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## Standard Configuration Reference

The following configuration areas are provided by the underlying `App_GKE` module. Consult the linked sections of the [App_GKE Configuration Guide](App_GKE.md) for full documentation.

| Configuration Area | App GKE.md Section | Umami-Specific Notes |
|---|---|---|
| Project & Identity | §2 IAM & Access Control | Identical. |
| Application Identity | §3.A Compute (GKE Autopilot) | Umami-specific defaults; see [Group 2: Application Identity](#group-2-application-identity). |
| Runtime & Scaling | §3.A Compute (GKE Autopilot) | Umami-specific defaults for `container_port`, `cpu_limit`, `memory_limit`; see [Group 3: Runtime & Scaling](#group-3-runtime--scaling). |
| Environment Variables & Secrets | §3 Core Service Configuration | `APP_SECRET` auto-generated; `DATABASE_URL` assembled at runtime; see [Group 5: Environment Variables & Secrets](#group-5-environment-variables--secrets). |
| Networking & Network Policies | §3.D Networking & Network Policies | Identical. |
| Initialization Jobs & CronJobs | §3.E Initialization Jobs & CronJobs | `db-init` job supplied automatically by `Umami Common`; see [Group 8: Jobs & Scheduled Tasks](#group-8-jobs--scheduled-tasks). |
| Additional Services | §3.F Additional Services | Identical. |
| Storage — NFS | §3.C Storage (NFS / GCS / GCS Fuse) | `enable_nfs` defaults to `false` — Umami is stateless and needs no shared filesystem. |
| Storage — GCS | §3.C Storage (NFS / GCS / GCS Fuse) | No storage buckets provisioned by default; see [Group 14: Cloud Storage](#group-14-cloud-storage). |
| Database Configuration | §3.B Database (Cloud SQL) | **PostgreSQL required**; see [Group 16: Database Configuration](#group-16-database-configuration). |
| Backup Schedule & Retention | §3.B Database (Cloud SQL) | Identical. |
| Custom SQL Scripts | §3.E Initialization Jobs & CronJobs | Identical. |
| Observability & Health Checks | §3.A Compute (GKE Autopilot) | Health endpoint `/api/heartbeat`; see [Group 10: Observability & Health](#group-10-observability--health). |
| Cloud Armor WAF | §4.A Cloud Armor WAF | Identical. |
| Identity-Aware Proxy | §4.B Identity-Aware Proxy (IAP) | Identical. |
| Binary Authorization | §4.C Binary Authorization | Identical. |
| VPC Service Controls | §4.D VPC Service Controls | Identical. |
| Secrets Store CSI Driver | §4.E Secrets Store CSI Driver | Always enabled — no configuration required. |
| Traffic & Ingress | §5 Traffic & Ingress | Identical. |
| CDN | §5.B CDN | Identical. |
| Custom Domain & Static IP | §5.C Static IP Reservation | See [Group 19: Custom Domain & Static IP](#group-19-custom-domain--static-ip). |
| Cloud Build Triggers | §6.A Cloud Build Triggers | Identical. |
| Cloud Deploy Pipeline | §6.B Cloud Deploy Pipeline | Identical. |
| Image Mirroring | §6.C Image Mirroring | Enabled by default to avoid GitHub Container Registry rate limits. |
| Pod Disruption Budgets | §7.A Pod Disruption Budgets | Identical. |
| Topology Spread Constraints | §7.B Topology Spread Constraints | Identical. |
| Resource Quotas | §7.C Resource Quotas | Identical. |
| Auto Password Rotation | §7.D Auto Password Rotation | See [Group 16: Database Configuration](#group-16-database-configuration). |
| Redis Cache | §8.A Redis / Memorystore | Redis not wired — Umami does not require it; see [Group: Redis Cache](#redis-cache). |
| Backup Import | §8.B Backup Import | See [Group 21: Backup Import](#group-21-backup-import). |
| Service Mesh (ASM) | §8.C Service Mesh (ASM via Fleet) | Identical. |
| Multi-Cluster Services | §8.D Multi-Cluster Services (MCS) | Identical. |

---

## How Umami GKE Relates to App GKE

`Umami GKE` passes all variables through to `App GKE` and adds a `Umami Common` sub-module that supplies Umami-specific defaults and application configuration. The main effects are:

1. **PostgreSQL is required.** Umami requires PostgreSQL for all data storage. The `database_type` default is `"POSTGRES"` (the generic PostgreSQL option).
2. **`DATABASE_URL` is assembled at runtime.** The custom Umami entrypoint constructs `DATABASE_URL` from platform-injected DB_* variables. This avoids storing a plaintext connection string in environment variables or Terraform state.
3. **`APP_SECRET` is auto-generated.** `Umami Common` generates a 32-character alphanumeric secret and stores it in Secret Manager. It is injected into the pod as `APP_SECRET`.
4. **No storage buckets are provisioned by default.** Umami is a stateless analytics service — all data lives in PostgreSQL. `storage_buckets` defaults to an empty list.
5. **A `db-init` job runs on first deployment.** `Umami Common` supplies a default `db-init` Kubernetes Job that pre-creates the Umami PostgreSQL database and user. Umami then runs its own Prisma migrations on startup.
6. **Resource defaults are sized for Umami.** The default `cpu_limit` (1 vCPU) and `memory_limit` (512Mi) reflect Umami's lightweight footprint.
7. **Health probes target `/api/heartbeat`.** Umami's dedicated health endpoint, not a generic root path.
8. **Redis is not used.** Umami stores everything in PostgreSQL; the module wires no Redis connection (the mirrored `enable_redis` declaration is not forwarded to the Foundation).
9. **Image mirroring is enabled by default.** Umami is distributed via GitHub Container Registry (`ghcr.io`). The module mirrors the image to Artifact Registry to avoid rate limits in production.

---

## Group 1: Project & Identity

Identical to `App_GKE`. See [App_GKE](App_GKE.md#2-iam--access-control).

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | GCP project ID. **Required.** |
| `region` | `"us-central1"` | GCP region for Cloud SQL, GCS, and other resources. |

---

## Group 2: Application Identity

These variables behave identically to `App_GKE`. See [App_GKE](App_GKE.md#a-compute-gke-autopilot) for descriptions.

**Umami-specific defaults:**

| Variable | Umami GKE Default | App GKE Default | Notes |
|---|---|---|---|
| `application_name` | `"umami"` | `"gkeapp"` | Used as the base name for all GCP and Kubernetes resources. **Do not change after deployment.** |
| `application_display_name` | `"Umami"` | `"App GKE Application"` | Shown in the platform UI and dashboards. Can be changed freely. |
| `application_description` | `"Umami Analytics on GKE Autopilot"` | `"App GKE Custom Application…"` | Descriptive label. Can be changed freely. |
| `application_version` | `"postgresql-latest"` | `"1.0.0"` | The Umami release version to build and deploy. Must use a `postgresql-` prefixed tag. |
| `deploy_application` | `true` | `true` | Set `false` to provision supporting infrastructure only without deploying the Umami workload. |

---

## Group 3: Runtime & Scaling

Most variables behave identically to `App_GKE`. See [App_GKE Group 3](App_GKE.md#a-compute-gke-autopilot).

**Umami-specific defaults and behaviour:**

| Variable | Umami GKE Default | App GKE Default | Notes |
|---|---|---|---|
| `container_port` | `3000` | `8080` | Umami's native Next.js port. Do not change unless your custom Dockerfile binds Umami to a different port. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Same defaults — Umami is lightweight. Increase `memory_limit` to `1Gi` for high-traffic analytics dashboards. |
| `min_instance_count` | `1` | varies | GKE default is 1 pod minimum. Set to a higher value for high-availability deployments. |
| `max_instance_count` | `10` | `3` | Umami scales horizontally safely — all state is in PostgreSQL, allowing many concurrent instances. |
| `container_image_source` | `"custom"` | `"custom"` | The `custom` mode builds a wrapper image that assembles `DATABASE_URL` from DB_* variables. Set to `"prebuilt"` only if providing `DATABASE_URL` manually. |
| `enable_cloudsql_volume` | `true` | `true` | Cloud SQL Auth Proxy sidecar. Required for Umami to connect to Cloud SQL via Unix socket. |
| `workload_type` | `"Deployment"` | `"Deployment"` | Umami is stateless — `Deployment` is the correct workload type. Do not use `StatefulSet` unless attaching persistent local storage for a non-standard use case. |

**`enable_vertical_pod_autoscaling`:** Defaults to `false`. Enable to allow GKE Autopilot to automatically right-size Umami pods based on observed resource usage. Useful for cost optimisation in production.

The remaining runtime variables (`enable_image_mirroring`, `container_build_config`, `container_protocol`, `timeout_seconds`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels`, `termination_grace_period_seconds`, `deployment_timeout`) behave as described in [App_GKE Group 3](App_GKE.md#a-compute-gke-autopilot).

---

## Group 4: Access & Networking

These variables behave identically to `App_GKE`. See [App_GKE](App_GKE.md#4-advanced-security), [App_GKE](App_GKE.md#5-traffic--ingress), and [App_GKE](App_GKE.md#d-networking--network-policies).

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Enables Identity-Aware Proxy authentication on the load balancer. |
| `iap_authorized_users` | `[]` | Individual users or service accounts granted IAP access. |
| `iap_authorized_groups` | `[]` | Google Groups granted IAP access. |
| `iap_oauth_client_id` | `""` | OAuth client ID for IAP configuration. |
| `iap_oauth_client_secret` | `""` | OAuth client secret for IAP configuration. |
| `iap_support_email` | `""` | Support email shown on the Google OAuth consent screen. |
| `enable_cloud_armor` | `false` | Attaches a Cloud Armor security policy to the GKE Ingress backend. |
| `admin_ip_ranges` | `[]` | Admin CIDR ranges permitted through Cloud Armor. |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Name of the Cloud Armor security policy to attach. |
| `enable_vpc_sc` | `false` | Enables VPC Service Controls perimeter enforcement. |
| `network_name` | `""` | VPC network name. Leave empty to auto-discover. |
| `network_tags` | `[]` | Firewall tags applied to GKE cluster nodes. |
| `enable_network_segmentation` | `false` | Applies Kubernetes NetworkPolicy rules to restrict pod-to-pod traffic. |

**IAP note for Umami:** IAP protects the Umami analytics dashboard. If applying IAP, note that the tracking script endpoint (`/script.js`) and event collection endpoint (`/api/send`) must remain publicly accessible for tracked websites to report data. Consider routing architecture carefully if restricting access.

---

## Group 5: Environment Variables & Secrets

These variables behave identically to `App_GKE`. See [App_GKE](App_GKE.md#3-core-service-configuration).

**Umami-specific behaviour:**

`Umami Common` generates `APP_SECRET` and injects it as the `APP_SECRET` environment variable. No SMTP defaults are pre-populated — Umami does not send email natively.

Use `environment_variables` for Umami configuration options:

```hcl
environment_variables = {
  DISABLE_TELEMETRY = "1"    # Disable Umami's anonymous telemetry reporting
  TRACKER_SCRIPT_NAME = "analytics.js"  # Rename tracking script to avoid ad blockers
  ALLOWED_FRAME_URLS = "https://example.com"  # Allow Umami to be embedded in iframes
}
```

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Plain-text environment variables injected into the pod at runtime. |
| `secret_environment_variables` | `{}` | Secret Manager references injected as environment variables. |
| `secret_rotation_period` | `'2592000s'` | Rotation period for Secret Manager secrets (30 days). |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

---

## Group 6: GKE Cluster

| Variable | Default | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Name of the target GKE Autopilot cluster. Leave empty to auto-discover. |
| `namespace_name` | `""` | Kubernetes namespace. Auto-generated from `application_name` and `tenant_deployment_id` when empty. |
| `service_type` | `"LoadBalancer"` | Kubernetes Service type. `"LoadBalancer"` (the default) exposes Umami directly on an external IP; use `"ClusterIP"` for internal-only access behind an Ingress. |
| `session_affinity` | `"None"` | Session affinity mode. `"None"` is correct for Umami — all state is in PostgreSQL, so any pod can handle any request. |
| `enable_multi_cluster_service` | `false` | Registers the service with GKE Multi Cluster Services. |
| `configure_service_mesh` | `false` | Injects Anthos Service Mesh (Istio) sidecar proxies. |
| `termination_grace_period_seconds` | `30` | Seconds Kubernetes waits for the pod to terminate before force-killing. |
| `deployment_timeout` | `600` | Maximum seconds to wait for the GKE deployment to reach a healthy state. |
| `gke_cluster_selection_mode` | `"primary"` | Strategy for choosing the target cluster. |

---

## Group 7: Backup & Maintenance

| Variable | Default | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Daily at 02:00 UTC. Adjust to your preferred maintenance window. |
| `backup_retention_days` | `7` | 7-day retention. Increase for production deployments (30–90 days recommended). |

---

## Group 8: Jobs & Scheduled Tasks

These variables behave as described in [App_GKE](App_GKE.md#e-initialization-jobs--cronjobs), with one important Umami-specific behaviour.

**Umami default `db-init` job:**

When `initialization_jobs` is left as the default (empty list `[]`), `Umami Common` automatically supplies a `db-init` job:

| Field | Value |
|---|---|
| Job name | `db-init` |
| Image | PostgreSQL client image |
| Purpose | Pre-creates the Umami PostgreSQL database and user before Umami runs its own Prisma migrations |
| Execute on every apply | `true` |
| CPU / Memory | `1000m` / `512Mi` |

Override `initialization_jobs` with a non-empty list to replace this default with your own jobs. Each custom job must specify at least one of `command`, `args`, or `script_path`.

**CronJobs:** The `cron_jobs` and `additional_services` variables are available and behave identically to `App_GKE`. Use `cron_jobs` for tasks such as regular analytics data exports or database maintenance.

> **Note:** The `cron_jobs` schema in `Umami GKE` uses Kubernetes CronJob fields — `restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds`, `suspend`.

---

## Group 9: Reliability Policies

Identical to `App_GKE`. See [App_GKE](App_GKE.md#7-reliability--scheduling).

| Variable | Default | Notes |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Enabled by default. Prevents all Umami pods from being evicted simultaneously during cluster maintenance. |
| `pdb_min_available` | `"1"` | At least one Umami pod must remain available during voluntary disruptions. |
| `enable_topology_spread` | `false` | Enable for high-availability deployments to distribute pods across zones. |
| `topology_spread_strict` | `false` | When `true`, uses `DoNotSchedule` spread constraint. |

---

## Group 10: Observability & Health

These variables behave identically to `App_GKE`. See [App_GKE](App_GKE.md#a-compute-gke-autopilot).

**Umami health endpoint:** Umami exposes `/api/heartbeat` as its dedicated health endpoint. This endpoint returns HTTP 200 when Umami is running and connected to PostgreSQL. All probe configuration defaults use this path.

| Variable | Umami GKE Default | Notes |
|---|---|---|
| `startup_probe_config` | `{ enabled=true, path="/api/heartbeat", initial_delay_seconds=30, failure_threshold=30 }` | High `failure_threshold` accommodates first-boot Prisma migrations. |
| `health_check_config` | `{ enabled=true, path="/api/heartbeat", initial_delay_seconds=30, failure_threshold=3 }` | Liveness probe — restarts unhealthy pods. |
| `uptime_check_config` | `{ enabled=false, path="/api/heartbeat" }` | Cloud Monitoring uptime check. Disabled by default. |
| `alert_policies` | `[]` | Custom Cloud Monitoring metric alert policies. |

**Startup probe note:** The `failure_threshold = 30` with `period_seconds = 10` gives Umami up to 5 minutes (plus the 30-second initial delay) to complete startup and run Prisma migrations on a fresh database. On subsequent restarts (migrations already applied), startup is much faster.

---

## Group 11: Workload Automation (Jobs)

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Kubernetes Jobs to run before the Umami application starts. Leave empty for `Umami Common` to supply the default `db-init` job. |
| `cron_jobs` | `[]` | Recurring Kubernetes CronJob resources. |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside the main Umami container. |

---

## Group 12: CI/CD & GitHub Integration

Identical to `App_GKE`. See [App_GKE](App_GKE.md#6-cicd--delivery).

| Variable | Default | Description |
|---|---|---|
| `enable_cicd_trigger` | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | `""` | GitHub Personal Access Token. Sensitive. |
| `github_app_installation_id` | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger configuration. |
| `enable_cloud_deploy` | `false` | Switches to a managed Google Cloud Deploy pipeline. |
| `cloud_deploy_stages` | `[dev, staging, prod(approval)]` | Ordered promotion stages. |
| `enable_binary_authorization` | `false` | Enforces Binary Authorization policy on the GKE cluster. |
| `binauthz_evaluation_mode` | `"ALWAYS_ALLOW"` | Binary Authorization enforcement mode. Not referenced. |

---

## Group 13: NFS

Umami does not require NFS. `enable_nfs` defaults to `false`. All Umami data is stored in PostgreSQL.

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisions a Cloud Filestore (NFS) instance. Not required for Umami. |
| `nfs_mount_path` | `"/mnt/nfs"` | Container NFS mount path. Only used when `enable_nfs = true`. |
| `nfs_instance_name` | `""` | Name of an existing NFS GCE VM. Auto-discovered when empty. |
| `nfs_instance_base_name` | `"app-nfs"` | Base name for an inline NFS GCE VM. |
| `nfs_volume_name` | `"nfs-data-volume"` | Kubernetes volume name for the NFS mount. |

---

## Group 14: Cloud Storage

Umami does not require GCS buckets. `storage_buckets` defaults to an empty list.

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Controls whether the module provisions GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[]` | GCS bucket configurations. Empty by default — Umami is stateless. |
| `gcs_volumes` | `[]` | GCS buckets to mount via GCS Fuse CSI driver. |
| `manage_storage_kms_iam` | `false` | Creates a CMEK KMS keyring for GCS buckets. |
| `enable_artifact_registry_cmek` | `false` | Creates an Artifact Registry KMS key for at-rest image encryption. |
| `max_images_to_retain` | `7` | Maximum container images to keep in Artifact Registry. |
| `delete_untagged_images` | `true` | Automatically deletes untagged images from Artifact Registry. |
| `image_retention_days` | `30` | Days after which images are eligible for deletion. |

---

## Group 16: Database Configuration

These variables behave identically to `App_GKE`. See [App_GKE](App_GKE.md#b-database-cloud-sql).

**Umami-specific defaults and restrictions:**

| Variable | Umami GKE Default | App GKE Default | Notes |
|---|---|---|---|
| `database_type` | `"POSTGRES"` | `"POSTGRES"` | Umami requires PostgreSQL. Do not change to MySQL or NONE. |
| `application_database_name` | `"umami"` | `"gkeappdb"` | **Do not change after deployment** — changing recreates the database and destroys all analytics data. |
| `application_database_user` | `"umami"` | `"gkeappuser"` | **Do not change after deployment.** |
| `database_password_length` | `32` | `32` | Auto-generated password length. Range: 16–64. |

**Automatic password rotation:**

| Variable | Default | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Deploys an automated database password rotation job. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before restarting pods. |

**PostgreSQL extensions:**

| Variable | Default | Description |
|---|---|---|
| `enable_postgres_extensions` | `false` | Enables installation of PostgreSQL extensions after provisioning. |
| `postgres_extensions` | `[]` | List of extensions to install (e.g., `['uuid-ossp', 'pg_trgm']`). |

---

## Group 19: Custom Domain & Static IP

Identical to `App_GKE`. See [App_GKE](App_GKE.md#5-traffic--ingress).

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisions a Kubernetes Ingress resource for custom domain routing. Enabled by default. |
| `application_domains` | `[]` | Custom domain names (e.g., `["analytics.example.com"]`). |
| `reserve_static_ip` | `true` | Reserves a Global Static IP for the load balancer. Recommended for production deployments. |
| `static_ip_name` | `""` | Name for the reserved IP. Auto-generated if empty. |
| `enable_cdn` | `false` | Enables Cloud CDN on the GKE Ingress backend. |
| `network_tags` | `[]` | VPC firewall network tags applied to GKE nodes. |
| `network_name` | `""` | VPC network name. Auto-discovered when empty. |

---

## Group 21: Backup Import

| Variable | Default | Description |
|---|---|---|
| `enable_backup_import` | `false` | Triggers a one-time database import job during deployment. |
| `backup_source` | `"gcs"` | Source for the backup file: `"gcs"` or `"gdrive"`. |
| `backup_file` | `"backup.sql"` | Filename of the backup to import. |
| `backup_format` | `"sql"` | Backup format: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## Group 8: Resource Quota

Identical to `App_GKE`. See [App_GKE](App_GKE.md#c-resource-quotas).

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Creates a Kubernetes ResourceQuota in the application namespace. |
| `quota_cpu_requests` | `""` | Total CPU requests allowed in the namespace. |
| `quota_cpu_limits` | `""` | Total CPU limits allowed in the namespace. |
| `quota_memory_requests` | `""` | Total memory requests. **Must use binary unit suffixes** (e.g., `"4Gi"`, `"8192Mi"`). |
| `quota_memory_limits` | `""` | Total memory limits. **Must use binary unit suffixes.** |

> **Warning:** `quota_memory_requests` and `quota_memory_limits` must use binary suffixes (`Gi`, `Mi`) when set. Bare integers (e.g., `"4"`) are treated as bytes by Kubernetes and will block all pod scheduling with a quota-exceeded error.

---

## Redis Cache

Umami does not use Redis — it stores all analytics data directly in PostgreSQL with no caching layer. The `enable_redis` variable is declared in `Umami_GKE` only to satisfy Foundation variable mirroring; it is **not forwarded** to the `App_GKE` call, so changing it has no effect.

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Inert declaration (Foundation mirroring only) — not forwarded to `App_GKE`, so no Redis env vars are injected regardless of value. |

If you require Redis for a custom integration or adjacent service, use `additional_services` to deploy a Redis sidecar, or configure Memorystore independently.

---

## Group 22: VPC Service Controls

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforces VPC Service Controls perimeters around GCP APIs. |
| `vpc_cidr_ranges` | `[]` | VPC subnet CIDR ranges for VPC-SC network access level. |
| `vpc_sc_dry_run` | `true` | Logs violations without blocking. |
| `organization_id` | `""` | GCP Organization ID for VPC-SC. Auto-discovered when empty. |
| `enable_audit_logging` | `false` | Enables detailed Cloud Audit Logs. |

---

## Exploring with the GCP Console

After a successful deployment, explore the Umami installation in the GCP Console:

**GKE workload:**
Navigate to **Kubernetes Engine → Workloads**. Find the Deployment named after your `application_name` and `tenant_deployment_id`. Click to view:
- Pod status, restart count, and age.
- **Logs** tab — streams container logs from running Umami pods.
- **Details** tab — shows the Deployment spec, resource limits, probe configuration, and environment variables (non-sensitive).
- **Revision history** — lists previous ReplicaSets.

**GKE Services & Ingress:**
Navigate to **Kubernetes Engine → Services & Ingress**. Find the Service for your Umami deployment. View:
- The external IP address (if `service_type = "LoadBalancer"` or `reserve_static_ip = true`).
- Port mappings.
- Load balancer health check status.

**Cloud SQL instance:**
Navigate to **SQL**. Find the instance named `app-sql-<deployment_id>`. Explore:
- **Overview** — connection name, PostgreSQL version, storage usage.
- **Databases** — the `umami` database with all analytics tables.
- **Users** — the `umami` application user.
- **Operations** — history of maintenance, failovers, and backups.

**Secret Manager:**
Navigate to **Security → Secret Manager**. Find the `secret-<tenant_resource_prefix>-<application_name>-app-secret` secret (injected as `APP_SECRET`) for this deployment. Click to view:
- Secret versions and creation timestamps.
- Access log showing when GKE pods read the secret.
- Rotation configuration.

**Artifact Registry:**
Navigate to **Artifact Registry**. Find the repository for this deployment. View mirrored Umami images from GitHub Container Registry, their tags, and retention policy.

**Cloud Monitoring:**
If `uptime_check_config.enabled = true` was set, navigate to **Monitoring → Uptime checks** to view the `/api/heartbeat` uptime check results across GCP regions. Navigate to **Monitoring → Dashboards** to find the auto-provisioned GKE dashboard with CPU, memory, and request metrics.

---

## Exploring with gcloud and kubectl

Use these commands to inspect the Umami GKE deployment. Replace `PROJECT_ID`, `CLUSTER_NAME`, `REGION`, `NAMESPACE`, and `DEPLOYMENT_NAME` with your values.

```bash
# Get GKE cluster credentials
gcloud container clusters get-credentials CLUSTER_NAME \
  --region=REGION \
  --project=PROJECT_ID

# List pods in the Umami namespace
kubectl get pods -n NAMESPACE

# Describe the Umami deployment
kubectl describe deployment DEPLOYMENT_NAME -n NAMESPACE

# View Umami pod logs
kubectl logs -n NAMESPACE -l app=DEPLOYMENT_NAME --tail=100

# Follow live logs from all Umami pods
kubectl logs -n NAMESPACE -l app=DEPLOYMENT_NAME -f

# Check resource usage across Umami pods
kubectl top pods -n NAMESPACE

# Check HPA status (horizontal pod autoscaling)
kubectl get hpa -n NAMESPACE

# Describe the Kubernetes Service
kubectl get service -n NAMESPACE
kubectl describe service SERVICE_NAME -n NAMESPACE

# Check pod environment variables (non-sensitive)
kubectl exec -n NAMESPACE POD_NAME -- env | grep -v PASSWORD | grep -v SECRET

# Test health endpoint from inside a pod
kubectl exec -n NAMESPACE POD_NAME -- \
  wget -qO- http://localhost:3000/api/heartbeat

# Check Cloud SQL instance
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,databaseVersion,settings.tier)"

# List databases
gcloud sql databases list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID

# Check Secret Manager secrets
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~umami" \
  --format="table(name,createTime)"

# List Artifact Registry images
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY_NAME \
  --project=PROJECT_ID \
  --format="table(image,tags,createTime)"

# Check Kubernetes namespace resource quota (if enabled)
kubectl describe resourcequota -n NAMESPACE

# View PodDisruptionBudget
kubectl get pdb -n NAMESPACE

# Check recent Kubernetes events for the namespace
kubectl get events -n NAMESPACE --sort-by='.metadata.creationTimestamp' | tail -20

# Check Cloud Monitoring uptime checks
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="table(displayName,httpCheck.path,period,timeout)"
```

---

## Module Outputs

`Umami GKE` exposes the following Terraform outputs:

| Output | Description |
|---|---|
| `service_name` | Name of the Kubernetes Service. |
| `service_url` | External URL of the GKE load balancer. |
| `service_external_ip` | External IP address of the load balancer. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix. |
| `namespace` | Kubernetes namespace. |
| `database_instance_name` | Name of the Cloud SQL instance. |
| `database_name` | Name of the application database. |
| `database_user` | Name of the application database user. |
| `database_password_secret` | Secret Manager secret name for the database password. |
| `storage_buckets` | Created GCS storage buckets (empty for Umami). |
| `container_image` | Container image used for the deployment. |
| `cicd_enabled` | Whether the CI/CD pipeline is enabled. |
| `github_repository_url` | GitHub repository URL connected for CI/CD. |
| `kubernetes_ready` | `true` when the GKE cluster endpoint is reachable and all Kubernetes workload resources are deployed. `false` on the first apply of a new inline cluster — re-run apply to complete the deployment. |

---

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `project_id` | _(required)_ | **Critical** | No default — deployment fails immediately. |
| `database_type` | `"POSTGRES"` | **Critical** | Umami requires PostgreSQL. Setting to MySQL or NONE causes DATABASE_URL assembly to fail and Umami cannot connect to the database. |
| `application_database_name` | `"umami"` | **Critical** | Changing this after initial deployment destroys all collected analytics data. The database is recreated empty while the old data remains orphaned in Cloud SQL. |
| `application_database_user` | `"umami"` | **Critical** | Changing this after initial deployment recreates the Cloud SQL user, invalidating credentials and breaking all database connectivity. |
| `container_port` | `3000` | **Critical** | Umami listens on 3000. Mismatching this causes all health probes to fail and Kubernetes to continuously restart the pod. |
| `container_image_source` | `"custom"` | **High** | The official Umami image does not accept individual DB_* variables — it requires a fully-formed `DATABASE_URL`. Using `"prebuilt"` without manually setting `DATABASE_URL` in `environment_variables` will cause Umami to fail at startup with a missing database connection error. |
| `application_version` | `"postgresql-latest"` | **High** | Must use a `postgresql-` prefixed tag. Plain tags (e.g., `latest`) do not exist for the PostgreSQL variant of Umami. An invalid tag causes the container pull to fail. |
| `admin_password` | _(change on first login)_ | **Critical** | Default credentials (`admin` / `umami`) are publicly known. Leaving them unchanged exposes the analytics dashboard and all tracked data to anyone who knows the service URL. |
| `container_resources.memory_limit` | `"512Mi"` | **Medium** | 512Mi is sufficient for light to moderate traffic. Under heavy concurrent dashboard use or complex analytics queries, Umami may OOM. Increase to `1Gi` if memory pressure is observed. |
| `enable_cloudsql_volume` | `true` | **Critical** | Umami connects to Cloud SQL via the Auth Proxy Unix socket. Disabling this removes the socket, causing all database connections to fail. |
| `startup_probe_config.failure_threshold` | `30` | **High** | With `period_seconds = 10`, a `failure_threshold` of 30 gives Umami up to 5 minutes to start and run Prisma migrations. Reducing this below 10 may cause Kubernetes to restart the pod before migrations complete, creating a restart loop on fresh deployments. |
| `session_affinity` | `"None"` | **Low** | Umami is fully stateless — no session affinity is required. All requests can be handled by any pod without consistency issues. |
| `min_instance_count` | `1` | **Medium** | At least one Umami pod must always be running for analytics data to be collected. Scale-to-zero would cause data gaps during periods of no dashboard traffic. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Critical** (GKE-specific) | Must use binary suffixes (`Gi`, `Mi`) when set. Bare integers are treated as bytes, blocking all pod scheduling with a quota-exceeded error. |
| `enable_pod_disruption_budget` | `true` | **Medium** | Already enabled by default. Disabling allows all pods to be terminated simultaneously during GKE Autopilot node upgrades, causing brief service interruptions. |
| `backup_retention_days` | `7` | **Medium** | Analytics data loss is difficult to recover from. Increase to 30+ days for production deployments where historical analytics data has business value. |
| `enable_backup_import` | `false` | **High** | Setting this to `true` triggers a database restore on every apply. Only enable for the initial migration from an existing Umami instance; set back to `false` immediately after. |
| `enable_vpc_sc` | `false` | **Medium** | VPC-SC perimeter is only active when `organization_id` is also set. Without both, `enable_vpc_sc = true` has no enforcement effect. |
