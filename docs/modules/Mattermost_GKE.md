---
title: "Mattermost GKE Module \u2014 Configuration Guide"
description: "Configuration reference for deploying Mattermost on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Mattermost GKE Module — Configuration Guide

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mattermost_GKE.png" alt="Mattermost GKE Module — Configuration Guide" style={{maxWidth: "100%", borderRadius: "8px"}} />

This guide describes every configuration variable available in the `Mattermost_GKE` module. `Mattermost_GKE` is a **wrapper module** that combines the generic [`App_GKE`](App_GKE.md) infrastructure module with the [`Mattermost_Common`](Mattermost_Common.md) shared application configuration to deploy [Mattermost](https://mattermost.com/) — an open-source, self-hostable team messaging and collaboration platform — on Google Kubernetes Engine (GKE) Autopilot.

Most configuration options in `Mattermost GKE` map directly to the same options in `App GKE`. Where a variable is identical in behaviour, this guide references the `App GKE` guide rather than repeating the same documentation. Only the variables and defaults that are **specific to Mattermost** are described in full here.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

> **GKE vs Cloud Run:** Mattermost maintains persistent WebSocket connections for real-time message delivery. GKE Autopilot is better suited to production Mattermost deployments than Cloud Run because it supports long-lived connections without the per-request timeout constraints of Cloud Run. Use `Mattermost GKE` for any team-size deployment where real-time reliability is important.

---

## Standard Configuration Reference

The following configuration areas are provided by the underlying `App_GKE` module. Consult the linked sections of the [App_GKE Configuration Guide](App_GKE.md) for full documentation.

| Configuration Area | App GKE.md Section | Mattermost-Specific Notes |
|---|---|---|
| Project & Identity | §2 IAM & Access Control | Identical. |
| Application Identity | §3.A Compute (GKE Autopilot) | Mattermost-specific defaults; see [Group 2: Application Identity](#group-2-application-identity). |
| Runtime & Scaling | §3.A Compute (GKE Autopilot) | Mattermost-specific defaults for `container_port`, `container_resources`, and `min_instance_count`; see [Group 3: Runtime & Scaling](#group-3-runtime--scaling). |
| Environment Variables & Secrets | §3 Core Service Configuration | No pre-populated environment variables — Mattermost is configured via `site_url` and `edition`; see [Group 5: Environment Variables & Secrets](#group-5-environment-variables--secrets). |
| Networking & Network Policies | §3.D Networking & Network Policies | Identical. |
| Initialization Jobs & CronJobs | §3.E Initialization Jobs & CronJobs | `db-init` PostgreSQL job supplied automatically by `Mattermost Common`; see [Group 8: Jobs & Scheduled Tasks](#group-8-jobs--scheduled-tasks). |
| Additional Services | §3.F Additional Services | Identical. |
| Storage — NFS | §3.C Storage (NFS / GCS / GCS Fuse) | `enable_nfs` defaults to `false`; see [Group 9: Storage & Filesystem — NFS](#group-9-storage--filesystem--nfs). |
| Storage — GCS | §3.C Storage (NFS / GCS / GCS Fuse) | GCS Fuse volumes preferred for `/mattermost/data`; see [Group 10: Storage & Filesystem — GCS](#group-10-storage--filesystem--gcs). |
| Database Configuration | §3.B Database (Cloud SQL) | **PostgreSQL 15 required**; see [Group 11: Database Configuration](#group-11-database-configuration). |
| Backup Schedule & Retention | §3.B Database (Cloud SQL) | Identical. |
| Custom SQL Scripts | §3.E Initialization Jobs & CronJobs | Identical. |
| Observability & Health Checks | §3.A Compute (GKE Autopilot) | Mattermost exposes `/api/v4/system/ping`; see [Group 13: Observability & Health](#group-13-observability--health). |
| Cloud Armor WAF | §4.A Cloud Armor WAF | Identical. |
| Identity-Aware Proxy | §4.B Identity-Aware Proxy (IAP) | Identical. |
| Binary Authorization | §4.C Binary Authorization | Identical. |
| VPC Service Controls | §4.D VPC Service Controls | Identical. |
| Secrets Store CSI Driver | §4.E Secrets Store CSI Driver | Always enabled — no configuration required. |
| Traffic & Ingress | §5 Traffic & Ingress | Identical. |
| CDN | §5.B CDN | Identical. |
| Custom Domain & Static IP | §5.C Static IP Reservation | Mattermost `site_url` must match; see [Group 16: Custom Domain & Static IP](#group-16-custom-domain--static-ip). |
| Cloud Build Triggers | §6.A Cloud Build Triggers | Identical. |
| Cloud Deploy Pipeline | §6.B Cloud Deploy Pipeline | Identical. |
| Image Mirroring | §6.C Image Mirroring | Identical. |
| Pod Disruption Budgets | §7.A Pod Disruption Budgets | Identical. |
| Topology Spread Constraints | §7.B Topology Spread Constraints | Identical. |
| Resource Quotas | §7.C Resource Quotas | Identical. |
| Auto Password Rotation | §7.D Auto Password Rotation | See [Group 11: Database Configuration](#group-11-database-configuration). |
| Redis Cache | §8.A Redis / Memorystore | `enable_redis` defaults to `false`; recommended for multi-replica; see [Group 15: Redis Cache](#group-15-redis-cache). |
| Backup Import | §8.B Backup Import | Exposes both `backup_uri` (full GCS URI or Drive ID) and `backup_file` (filename in module backup bucket); see [Group 6: Backup & Maintenance](#group-6-backup--maintenance). |
| Service Mesh (ASM) | §8.C Service Mesh (ASM via Fleet) | Identical. |
| Multi-Cluster Services | §8.D Multi-Cluster Services (MCS) | Identical. |

---

## How Mattermost GKE Relates to App GKE

`Mattermost GKE` passes all variables through to `App GKE` and adds a `Mattermost Common` sub-module that supplies Mattermost-specific defaults and application configuration. The main effects are:

1. **PostgreSQL 15 is required.** Mattermost requires PostgreSQL 13 or later. The `database_type` default is set to `"POSTGRES_15"`.
2. **A `db-init` job runs on first deployment.** `Mattermost Common` supplies a default `db-init` Kubernetes Job that creates the Mattermost PostgreSQL database and user. Mattermost then runs its own schema migrations on first startup — no manual schema setup is needed.
3. **No pre-populated environment variables.** Unlike Ghost, Mattermost does not require SMTP defaults injected by the module. Key settings — site URL, edition, Redis — are controlled by dedicated top-level variables (`site_url`, `edition`, `enable_redis`).
4. **Edition selection controls the container image.** Setting `edition = "enterprise"` automatically switches the container image to `mattermost/mattermost-enterprise-edition`. The default (`"team"`) uses `mattermost/mattermost-team-edition`. Enterprise Edition requires a paid licence key provided via `environment_variables`.
5. **GCS Fuse is preferred over NFS for file storage.** `enable_nfs` defaults to `false`. Mattermost file uploads and attachments are stored on GCS volumes mounted via the CSI GCS Fuse driver at `/mattermost/data`. This provides durable, multi-replica-safe storage without provisioning a Filestore instance.
6. **Resource defaults are sized for Mattermost.** The default `cpu_limit` (2 vCPU) and `memory_limit` (4 Gi) accommodate Mattermost's concurrent WebSocket handling, channel caching, and message indexing.
7. **Redis is optional but recommended for multi-replica deployments.** `enable_redis` defaults to `false`. Enabling Redis provides distributed session and cache storage, which is required for correct behaviour across more than one pod replica.
8. **Health probes use Mattermost's dedicated ping endpoint.** Both `startup_probe` and `liveness_probe` default to `path = "/api/v4/system/ping"` — Mattermost's built-in health endpoint that returns HTTP 200 when the server is ready to accept connections.
9. **`site_url` must be set for correct link generation.** Mattermost uses `MM_SERVICESETTINGS_SITEURL` for notification emails, in-app link generation, and OAuth redirects. The `site_url` variable sets this automatically.

---

## Group 1: Project & Identity

Identical to `App_GKE`. See [App_GKE](App_GKE.md#2-iam--access-control).

**Mattermost GKE-specific additions in this group:**

| Variable | Default | Description |
|---|---|---|
| `region` | `"us-central1"` | GCP region for resource deployment. Used as a fallback when VPC subnet discovery cannot determine the region. Also used as the default location for GCS buckets provisioned for Mattermost file storage. |
| `site_url` | `""` | The public URL where Mattermost is accessible (e.g., `"https://chat.example.com"`). Sets `MM_SERVICESETTINGS_SITEURL`. Required for correct link generation in notification emails, OAuth redirects, and in-app deep links. Leave empty only for initial infrastructure provisioning before a domain is assigned. |
| `edition` | `"team"` | Mattermost edition. `"team"` deploys the free Team Edition. `"enterprise"` deploys Enterprise Edition and requires a licence key supplied via `environment_variables`. Changing this value after initial deployment replaces the container image on the next apply. |

---

## Group 2: Application Identity

These variables behave identically to `App_GKE`. See [App_GKE](App_GKE.md#a-compute-gke-autopilot) for descriptions.

**Mattermost-specific defaults:**

| Variable | Mattermost GKE Default | App GKE Default | Notes |
|---|---|---|---|
| `application_name` | `"mattermost"` | `"gkeapp"` | Used as the base name for all GCP and Kubernetes resources. **Do not change after deployment.** |
| `application_display_name` | `"Mattermost"` | `"App GKE Application"` | Shown in the platform UI and dashboards. Can be changed freely. |
| `application_description` | `"Mattermost - Open-source team messaging on GKE Autopilot"` | `"App GKE Custom Application…"` | Descriptive label. Can be changed freely. |
| `application_version` | `"9.11.2"` | `"1.0.0"` | The Mattermost release version to build and deploy. Incrementing this value triggers a new Cloud Build run. |

---

## Group 3: Runtime & Scaling

Most variables behave identically to `App_GKE`. See [App_GKE Group 3](App_GKE.md#a-compute-gke-autopilot).

**Mattermost-specific defaults and behaviour:**

| Variable | Mattermost GKE Default | App GKE Default | Notes |
|---|---|---|---|
| `container_port` | `8065` | `8080` | Mattermost's native HTTP port. Do not change unless your custom Dockerfile binds Mattermost to a different port. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Mattermost handles concurrent WebSocket connections, channel caching, and message indexing. 2 vCPU and 4 Gi are the recommended production minimums. |
| `min_instance_count` | `1` | `0` | Mattermost maintains persistent WebSocket connections. Scale-to-zero drops active user sessions. Keep at `1` or higher for any deployment with active users. |
| `max_instance_count` | `5` | `3` | Higher ceiling to accommodate traffic spikes during large team communication bursts. |
| `container_image_source` | `"custom"` | `"custom"` | `Mattermost Common` supplies a Dockerfile-based build by default. Set to `"prebuilt"` to deploy a pre-built image URI directly. |
| `enable_cloudsql_volume` | `false` | `true` | Mattermost GKE connects to Cloud SQL over a private TCP connection rather than via a Unix socket sidecar by default. Set to `true` to inject the Cloud SQL Auth Proxy sidecar. |
| `timeout_seconds` | `300` | `300` | For WebSocket-heavy deployments, increase to `3600` to prevent active WebSocket connections from being severed by the backend timeout. |
| `container_protocol` | `"http1"` | `"http1"` | Mattermost uses HTTP/1.1 for its WebSocket upgrade path. Do not change to `"h2c"` unless your Mattermost configuration explicitly supports HTTP/2. |

The remaining runtime variables (`deploy_application`, `container_image`, `container_build_config`, `enable_image_mirroring`, `enable_vertical_pod_autoscaling`, `service_annotations`, `service_labels`, `cloudsql_volume_mount_path`) behave as described in [App_GKE Group 3](App_GKE.md#a-compute-gke-autopilot).

---

## Group 4: Access & Networking

These variables behave identically to `App_GKE`. See [App_GKE](App_GKE.md#4-advanced-security), [App_GKE](App_GKE.md#5-traffic--ingress), and [App_GKE](App_GKE.md#d-networking--network-policies).

> **Note:** The `ingress_settings` and `vpc_egress_setting` variables appear in `Mattermost GKE`'s variable definitions but are **not passed through to `App GKE`**. Setting these variables has no effect on the deployed infrastructure in the current implementation.

The following networking variables are available in `Mattermost GKE`:

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Enables Identity-Aware Proxy authentication on the load balancer. |
| `iap_authorized_users` | `[]` | Individual users or service accounts granted IAP access. |
| `iap_authorized_groups` | `[]` | Google Groups granted IAP access. |
| `iap_oauth_client_id` | `""` | OAuth client ID for IAP configuration. |
| `iap_oauth_client_secret` | `""` | OAuth client secret for IAP configuration. |
| `iap_support_email` | `""` | Support email shown on the Google OAuth consent screen. |
| `enable_custom_domain` | `true` | Configures Ingress/Gateway for custom domain routing with managed SSL certificates. |
| `application_domains` | `[]` | Custom domain names (e.g. `["chat.example.com"]`). |
| `reserve_static_ip` | `true` | Reserves a Global Static IP for the load balancer. |
| `static_ip_name` | `""` | Name for the reserved IP; auto-generated if blank. |
| `network_tags` | `["nfsserver"]` | Firewall tags applied to GKE cluster nodes. |
| `enable_cloud_armor` | `false` | Enables a Cloud Armor WAF security policy. |
| `admin_ip_ranges` | `[]` | Admin CIDR ranges permitted through Cloud Armor. |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Name of the Cloud Armor security policy to attach. |
| `enable_vpc_sc` | `false` | Enables VPC Service Controls perimeter enforcement. |

---

## Group 5: Environment Variables & Secrets

These variables behave identically to `App_GKE`. See [App_GKE](App_GKE.md#3-core-service-configuration).

**Mattermost-specific behaviour:**

`Mattermost GKE` does **not** pre-populate `environment_variables` with Mattermost settings. Mattermost configuration is controlled via three mechanisms:

1. **`site_url`** sets `MM_SERVICESETTINGS_SITEURL` automatically via `Mattermost Common`.
2. **`edition`** selects the container image (`team` or `enterprise`) automatically.
3. **`environment_variables`** accepts any additional Mattermost environment variables (using the `MM_` prefix convention).

**Enterprise Edition licence key:**

When `edition = "enterprise"`, supply the licence key via `environment_variables`:

```
environment_variables = {
  MM_LICENSE = "your-mattermost-enterprise-licence-key"
}
```

**Common Mattermost environment variable overrides:**

| Variable | Purpose |
|---|---|
| `MM_EMAILSETTINGS_SMTPSERVER` | SMTP server for email notifications. |
| `MM_EMAILSETTINGS_SMTPPORT` | SMTP port (e.g., `"587"`). |
| `MM_EMAILSETTINGS_SMTPUSERNAME` | SMTP authentication username. |
| `MM_EMAILSETTINGS_SMTPPASSWORD` | SMTP authentication password. |
| `MM_EMAILSETTINGS_ENABLESMTPAUTH` | `"true"` to enable SMTP authentication. |
| `MM_EMAILSETTINGS_FEEDBACKEMAIL` | From address for notification emails. |
| `MM_SERVICESETTINGS_ENABLEDEVELOPER` | `"false"` for production (disables developer mode). |

The remaining secrets variables (`secret_environment_variables`, `secret_rotation_period`, `secret_propagation_delay`, `manage_storage_kms_iam`) behave as described in [App_GKE](App_GKE.md#3-core-service-configuration).

---

## Group 6: Backup & Maintenance

These variables behave identically to `App_GKE`. See [App_GKE](App_GKE.md#b-database-cloud-sql).

**Mattermost-specific defaults:**

| Variable | Default | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Daily at 02:00 UTC. Adjust to match your Recovery Point Objective and traffic patterns. |
| `backup_retention_days` | `7` | 7-day retention. Increase for production deployments (30–90 days recommended). |

**Backup Import** — Mattermost GKE supports importing an existing backup on first deployment:

| Variable | Default | Description |
|---|---|---|
| `enable_backup_import` | `false` | When `true`, runs a one-time import job during deployment to restore the backup specified by `backup_uri`. Configure `backup_source`, `backup_uri`, and `backup_format` before enabling. |
| `backup_source` | `"gcs"` | Source system for the backup file. `"gcs"` imports from a Cloud Storage URI; `"gdrive"` imports from a Google Drive file ID. |
| `backup_uri` | `""` | Full GCS URI (`"gs://my-bucket/backups/mattermost.sql"`) or Google Drive file ID. |
| `backup_file` | `"backup.sql"` | Filename of a backup stored in the module's automatically created backups GCS bucket. An alternative to `backup_uri` for backups already placed in the module-managed bucket. |
| `backup_format` | `"sql"` | Format of the backup file. Supported values: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## Group 7: CI/CD & GitHub Integration

Identical to `App_GKE`. See [App_GKE](App_GKE.md#6-cicd--delivery).

The following CI/CD variables are available: `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`, `binauthz_evaluation_mode` (default `"ALWAYS_ALLOW"`; options: `ALWAYS_ALLOW`, `REQUIRE_ATTESTATION`, `ALWAYS_DENY`).

---

## Group 8: Jobs & Scheduled Tasks

These variables behave as described in [App_GKE](App_GKE.md#e-initialization-jobs--cronjobs), with one important Mattermost-specific behaviour.

**Mattermost default `db-init` job:**

When `initialization_jobs` is left as the default (empty list `[]`), `Mattermost Common` automatically supplies a `db-init` job:

| Field | Value |
|---|---|
| Job name | `db-init` |
| Image | PostgreSQL client image |
| Purpose | Creates the Mattermost PostgreSQL database and user; Mattermost then runs its own schema migrations on first startup |
| CPU / Memory | `1000m` / `512Mi` |

Override `initialization_jobs` with a non-empty list to replace this default with your own jobs. Each custom job must specify at least one of `command`, `args`, or `script_path`.

**CronJobs and Additional Services:**

The `cron_jobs` and `additional_services` variables are available and behave identically to `App_GKE`. See [App_GKE](App_GKE.md#e-initialization-jobs--cronjobs) for full documentation.

> **Note:** The `cron_jobs` schema in `Mattermost GKE` uses Kubernetes CronJob fields — `restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds`, `suspend` — rather than the Cloud Run–style fields used in `Mattermost CloudRun`. The `secret_env_vars` field is not available in GKE cron jobs; secrets are managed via `secret_environment_variables` at the module level.

---

## Group 9: Storage & Filesystem — NFS

These variables behave identically to `App_GKE`. See [App_GKE](App_GKE.md#c-storage-nfs--gcs--gcs-fuse).

**Mattermost-specific defaults:**

| Variable | Default | Notes |
|---|---|---|
| `enable_nfs` | `false` | NFS storage is **disabled** by default for Mattermost. GCS Fuse volumes are the preferred storage backend for `/mattermost/data` because they are durable and multi-replica-safe without the overhead of a Filestore instance. Enable NFS if your deployment requires POSIX filesystem semantics not supported by GCS Fuse (e.g., file locking). |
| `nfs_mount_path` | `"/mattermost/data"` | The path where the NFS volume is mounted inside the Mattermost container. Matches Mattermost's default data directory. |

---

## Group 10: Storage & Filesystem — GCS

These variables behave identically to `App_GKE`. See [App_GKE Group 9](App_GKE.md#c-storage-nfs--gcs--gcs-fuse).

**Mattermost-specific behaviour:**

Mattermost stores team uploads, file attachments, and plugin data under `/mattermost/data`. The recommended approach for Mattermost GKE is to provision a GCS bucket and mount it via the GCS Fuse CSI driver:

```
create_cloud_storage = true

storage_buckets = [
  {
    name_suffix    = "mattermost-data"
    storage_class  = "STANDARD"
    force_destroy  = false
    versioning_enabled = true
  }
]

gcs_volumes = [
  {
    name       = "mattermost-data"
    mount_path = "/mattermost/data"
    readonly   = false
    mount_options = ["implicit-dirs", "stat-cache-ttl=60s", "type-cache-ttl=60s"]
  }
]
```

Unlike Ghost GKE, `Mattermost Common` does **not** automatically provision a GCS bucket. You must define `storage_buckets` and `gcs_volumes` explicitly if you want GCS-backed file storage.

The `create_cloud_storage`, `storage_buckets`, and `gcs_volumes` variables behave as described in [App_GKE Group 9](App_GKE.md#c-storage-nfs--gcs--gcs-fuse).

---

## Group 11: Database Configuration

These variables behave identically to `App_GKE`. See [App_GKE](App_GKE.md#b-database-cloud-sql).

**Mattermost-specific defaults and restrictions:**

| Variable | Mattermost GKE Default | App GKE Default | Notes |
|---|---|---|---|
| `database_type` | `"POSTGRES_15"` | `"POSTGRES"` | **Mattermost requires PostgreSQL 13 or later.** Do not change to MySQL or SQL Server — Mattermost will not start. |
| `application_database_name` | `"mattermost"` | `"gkeappdb"` | PostgreSQL database name for Mattermost. Do not change after deployment — this is passed directly to `Mattermost Common` as `db_name`. |
| `application_database_user` | `"mattermost"` | `"gkeappuser"` | PostgreSQL user for Mattermost. Do not change after deployment — passed to `Mattermost Common` as `db_user`. |

> **Important:** `application_database_name` and `application_database_user` are passed through to `Mattermost Common` as `db_name` and `db_user`. Unlike Ghost GKE, there are no separate `db_name`/`db_user` shorthand variables in `Mattermost GKE` — `application_database_name` and `application_database_user` serve both purposes.

**Cloud SQL instance discovery:**

| Variable | Default | Description |
|---|---|---|
| `sql_instance_name` | `""` | Name of an existing Cloud SQL instance to use. Leave empty to auto-discover a Services GCP-managed instance or create an inline instance. |
| `sql_instance_base_name` | `"app-sql"` | Base name for the inline Cloud SQL instance when no existing instance is found. Deployment ID is appended. |

**PostgreSQL extensions:**

Mattermost does not require custom PostgreSQL extensions by default, but the module exposes extension management variables for advanced deployments:

| Variable | Default | Description |
|---|---|---|
| `enable_postgres_extensions` | `false` | Enables installation of PostgreSQL extensions after provisioning. |
| `postgres_extensions` | `[]` | List of PostgreSQL extensions to install (e.g., `["pg_trgm", "btree_gin"]`). |

**Automatic password rotation** is also supported:

| Variable | Default | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Deploys an automated database password rotation job. When `true`, the database password is rotated on the schedule defined by `secret_rotation_period` and GKE pods are restarted to pick up the new credential. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before restarting pods, to allow Secret Manager replication to complete. |

---

## Group 12: Custom SQL Scripts

Identical to `App_GKE`. See [App_GKE](App_GKE.md#e-initialization-jobs--cronjobs).

---

## Group 13: Observability & Health

These variables behave identically to `App_GKE`. See [App_GKE](App_GKE.md#a-compute-gke-autopilot).

**Mattermost-specific defaults:**

Mattermost exposes a dedicated health endpoint at `/api/v4/system/ping` that returns HTTP 200 and a JSON status body when the server is fully initialised and ready to accept connections. Both probe variable sets default to this path.

### Health probe routing

`Mattermost GKE` exposes **two parallel sets** of probe variables:

| Variable set | Passed to | Configures |
|---|---|---|
| `startup_probe`, `liveness_probe` | `Mattermost Common` sub-module | The application container's Kubernetes probe spec |
| `startup_probe_config`, `health_check_config` | `App GKE` directly | The App GKE-standard probe configuration for load balancer health checks |

These are parallel paths, not aliases. Changing `startup_probe` does not affect `startup_probe_config`.

**Startup probe** (`startup_probe` → `Mattermost Common`):

| Field | Mattermost Default | App GKE Default | Notes |
|---|---|---|---|
| `path` | `"/api/v4/system/ping"` | `"/healthz"` | Mattermost's built-in readiness endpoint. |
| `initial_delay_seconds` | `60` | `10` | Mattermost runs PostgreSQL migrations on first startup, which may take 30–60 seconds for large databases. |
| `failure_threshold` | `30` | `3` | Allows up to 7.5 minutes of startup time (`30 × 15s`). Sufficient for fresh deployments with schema migration. |
| `period_seconds` | `15` | `10` | — |

**Liveness probe** (`liveness_probe` → `Mattermost Common`):

| Field | Mattermost Default | App GKE Default | Notes |
|---|---|---|---|
| `path` | `"/api/v4/system/ping"` | `"/healthz"` | Same as startup probe. |
| `initial_delay_seconds` | `60` | `15` | Gives Mattermost additional time to stabilise after the startup probe passes. |
| `period_seconds` | `30` | `30` | — |
| `failure_threshold` | `3` | `3` | — |

**App GKE-standard probes** (`startup_probe_config`, `health_check_config` → `App GKE`):

| Variable | Mattermost Default | Notes |
|---|---|---|
| `startup_probe_config` | `{ enabled = true, path = "/", initial_delay_seconds = 120, failure_threshold = 15 }` | Override `path` to `"/api/v4/system/ping"` for accurate Mattermost health checking. |
| `health_check_config` | `{ enabled = true, path = "/" }` | Override `path` to `"/api/v4/system/ping"` for accurate Mattermost health checking. |

**`uptime_check_config`:** Defaults to `{ enabled = false, path = "/" }` — uptime checks are disabled by default. Enable and set `path = "/api/v4/system/ping"` for production monitoring.

**Prometheus metrics:** Mattermost exposes Prometheus metrics on port `8067`. These are not scraped automatically by this module but can be consumed by Cloud Monitoring using a custom metrics exporter or a Prometheus-to-Cloud-Monitoring integration.

---

## Group 14: Reliability Policies

Identical to `App_GKE`. See [App_GKE](App_GKE.md#7-reliability--scheduling).

Available variables: `enable_pod_disruption_budget`, `pdb_min_available`, `enable_topology_spread`, `topology_spread_strict`.

> **Note:** `enable_pod_disruption_budget` defaults to `false` in `Mattermost GKE`. Enable it for production deployments where rolling node upgrades must not take all Mattermost pods offline simultaneously.

---

## Group 15: Redis Cache

These variables configure Mattermost's optional Redis integration. The underlying Redis infrastructure support is provided by `App_GKE` (see [App_GKE](App_GKE.md#a-redis--memorystore)); the variables below are Mattermost-specific. Mattermost uses Redis as a distributed cache and session backend — required for correct behaviour across more than one pod replica.

> **Note:** `enable_redis` defaults to `false` in `Mattermost GKE`. This is safe for single-replica deployments. For any deployment with `min_instance_count > 1` or horizontal scaling, Redis must be enabled.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `false` | `true` / `false` | Enables Redis as Mattermost's distributed cache and session backend. When `false`, Mattermost uses an in-process cache — requests routed to different pod replicas will not share session state, causing intermittent authentication failures under load. **Required for multi-replica deployments.** |
| `redis_host` | `""` | Hostname or IP address | The hostname or IP address of the Redis server. Leave blank to use the automatically discovered NFS server IP (the platform's default co-hosted Redis). Override with an explicit IP or hostname when using a dedicated Redis instance such as Google Cloud Memorystore. Example: `"10.128.0.10"`. |
| `redis_port` | `"6379"` | Port number string | TCP port for the Redis server. The default `6379` is the standard Redis port. Change only if your Redis instance is configured to listen on a non-standard port. |
| `redis_auth` | `""` | String *(sensitive)* | Authentication password for the Redis server. Leave empty if the Redis instance does not require authentication. For Memorystore instances with AUTH enabled, set this to the instance's AUTH string. Treated as sensitive — not stored in Terraform state in plaintext. |

### Validating Group 15 Settings

**Google Cloud Console:**
- **Memorystore instance (if used):** Navigate to **Memorystore → Redis** to confirm the instance exists, its IP address, port, and AUTH status.
- **Mattermost Redis status:** Once deployed, navigate to the Mattermost System Console (**Environment → Cache**) or review container logs for cache initialisation messages.

**gcloud CLI / kubectl:**
```bash
# List Memorystore Redis instances in the project (if using Memorystore)
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,memorySizeGb,authEnabled)"

# Confirm Redis environment variables are set in the Mattermost pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep -i redis

# Test Redis connectivity from inside the Mattermost pod
kubectl exec -n NAMESPACE POD_NAME -- \
  nc -zv REDIS_HOST 6379
```

---

## Group 16: Custom Domain & Static IP

Identical to `App_GKE`. See [App_GKE](App_GKE.md#5-traffic--ingress).

> **Mattermost `site_url` configuration:** Mattermost must know its public URL at startup. When using a custom domain, set `site_url` to match the domain in `application_domains` (e.g., `site_url = "https://chat.example.com"`). Mattermost uses this URL for notification emails, OAuth provider redirects, and in-app link generation — an incorrect `site_url` causes broken notification links, failed OAuth logins, and incorrect mobile app deep links.

---

## Group 17: GKE Backend Configuration

Identical to `App_GKE`. See [App_GKE](App_GKE.md#a-compute-gke-autopilot).

Available variables: `gke_cluster_name`, `namespace_name`, `workload_type`, `service_type`, `session_affinity`, `enable_multi_cluster_service`, `configure_service_mesh`, `enable_network_segmentation`, `termination_grace_period_seconds`, `deployment_timeout`, `gke_cluster_selection_mode` (default `"primary"`), `network_name` (default `""`; auto-discovered when empty), `prereq_gke_subnet_cidr` (default `"10.201.0.0/24"`).

> **Session affinity note:** `session_affinity` defaults to `"ClientIP"`. Mattermost uses server-side session tokens. Without session affinity, users can experience intermittent authentication errors when requests are routed to different pod replicas that do not share an in-memory session cache. Keep `"ClientIP"` unless Redis is enabled with a shared session backend.

> **Service type:** `service_type` defaults to `"LoadBalancer"`. This provisions an external load balancer. For internal-only Mattermost deployments, change to `"ClusterIP"` and configure an Ingress separately.

---

## Group 18: Stateful Workloads

Identical to `App_GKE`. See the StatefulSet configuration described in [App_GKE](App_GKE.md#a-compute-gke-autopilot).

Setting `stateful_pvc_enabled = true` automatically resolves `workload_type` to `"StatefulSet"`. This provides each Mattermost pod with its own dedicated PVC for local storage, as an alternative to GCS Fuse volumes. For most Mattermost deployments, GCS Fuse is preferred over StatefulSet PVCs because GCS provides durability and cross-pod access without size constraints.

Available variables: `stateful_pvc_enabled`, `stateful_pvc_size` (default `"10Gi"`), `stateful_pvc_mount_path` (default `"/data"`), `stateful_pvc_storage_class` (default `"standard-rwo"`), `stateful_headless_service`, `stateful_pod_management_policy`, `stateful_update_strategy`, `stateful_fs_group`.

---

## Group 19: Resource Quota

Identical to `App_GKE`. See [App_GKE](App_GKE.md#c-resource-quotas).

Available variables: `enable_resource_quota`, `quota_cpu_requests`, `quota_cpu_limits`, `quota_memory_requests`, `quota_memory_limits`, `quota_max_pods`, `quota_max_services`, `quota_max_pvcs`.

> **Memory quota suffix requirement:** `quota_memory_requests` and `quota_memory_limits` must use binary unit suffixes (e.g., `"8Gi"`, `"4096Mi"`). Bare integers are treated as bytes by Kubernetes and will block all pod scheduling.

---

## Exploring the Deployment

### Google Cloud Console

**Workloads:**
Navigate to **Kubernetes Engine → Workloads** and filter by namespace (the namespace name is derived from `application_name` and `tenant_deployment_id`). The Mattermost Deployment or StatefulSet, the `db-init` Job, and any configured CronJobs appear here.

**Services & Ingress:**
Navigate to **Kubernetes Engine → Services & Ingress** to find the Mattermost Service, its external IP address, and any configured Ingress resources. If `reserve_static_ip = true`, the reserved IP appears under **VPC Network → IP Addresses**.

**Storage:**
Navigate to **Cloud Storage → Buckets** and search for buckets prefixed with `app` and your `application_name` to find the Mattermost data bucket and the automated backup bucket.

**Database:**
Navigate to **SQL** to find the Cloud SQL PostgreSQL 15 instance. The instance name follows the pattern `app<name><tenant><id>-sql`. Click the instance to view connections, query insights, and backup history.

**Secrets:**
Navigate to **Security → Secret Manager** to view the `DB_PASSWORD` and other secrets provisioned by the module. Secret names follow the `app<name><tenant><id>-*` pattern.

**Monitoring:**
Navigate to **Monitoring → Dashboards** and **Monitoring → Alerting** to view the uptime checks (if `uptime_check_config.enabled = true`) and any alert policies configured via `alert_policies`.

### gcloud CLI and kubectl

```bash
# Get the GKE cluster credentials
gcloud container clusters get-credentials CLUSTER_NAME \
  --region=REGION \
  --project=PROJECT_ID

# List pods in the Mattermost namespace
kubectl get pods -n NAMESPACE

# Tail Mattermost application logs
kubectl logs -n NAMESPACE -l app=mattermost -f

# Check the db-init job status
kubectl get jobs -n NAMESPACE

# Describe the Mattermost Deployment (or StatefulSet)
kubectl describe deployment mattermost -n NAMESPACE

# Check the external IP assigned to the Service
kubectl get service -n NAMESPACE

# View environment variables injected into the Mattermost pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep MM_

# Check Mattermost health endpoint directly from inside the pod
kubectl exec -n NAMESPACE POD_NAME -- \
  curl -s http://localhost:8065/api/v4/system/ping

# View Cloud SQL instance details
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,databaseVersion,state,ipAddresses)"

# List GCS buckets for this deployment
gcloud storage buckets list \
  --project=PROJECT_ID \
  --filter="name~mattermost"

# View Secret Manager secrets for this deployment
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~mattermost"
```

---

## Module Outputs

`Mattermost GKE` exposes the following Terraform outputs:

| Output | Description |
|---|---|
| `service_name` | Name of the Kubernetes service |
| `service_url` | Service URL |
| `service_external_ip` | External IP address of the load balancer |
| `project_id` | GCP project ID |
| `deployment_id` | Deployment ID suffix |
| `namespace` | Kubernetes namespace |
| `database_instance_name` | Name of the Cloud SQL instance |
| `database_name` | Name of the application database |
| `database_user` | Name of the application database user |
| `database_password_secret` | Secret Manager secret name for the database password |
| `storage_buckets` | Created GCS storage buckets |
| `container_image` | Container image used for the deployment |
| `cicd_enabled` | Whether the CI/CD pipeline is enabled |
| `github_repository_url` | GitHub repository URL connected for CI/CD |
| `kubernetes_ready` | `true` when the GKE cluster endpoint is reachable and all Kubernetes workload resources are deployed. `false` on the first apply of a new inline cluster — the cluster is created but the endpoint is not yet readable, so Kubernetes resources are skipped. The CI/CD pipeline must re-run apply to complete the deployment. |

---

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `project_id` | _(required)_ | **Critical** | No default — deployment fails immediately. |
| `database_type` | `"POSTGRES_15"` | **Critical** | Mattermost only supports PostgreSQL. Setting to `MYSQL_8_0` or `NONE` causes the `db-init` job to fail and Mattermost to crash at startup. |
| `application_database_name` | `"mattermost"` | **Critical** | Immutable after deployment — changing this recreates the database and destroys all Mattermost data (channels, messages, users). |
| `application_database_user` | `"mattermost"` | **Critical** | Immutable after deployment — changing this recreates the user, invalidates credentials, and breaks Mattermost's database connection. |
| `site_url` | `""` | **High** | An empty `site_url` prevents Mattermost from generating correct notification email links, OAuth redirects, and mobile deep links. Configure before inviting users. |
| `edition` | `"team"` | **High** | Setting `"enterprise"` without a valid licence key causes Mattermost to start in an unlicensed state and disables enterprise features silently. Provide the key via `environment_variables`. |
| `enable_redis` | `false` | **High** | Safe for single-replica deployments. For `min_instance_count > 1`, in-process session caching causes intermittent authentication failures when requests are load-balanced across pods. Enable Redis for any multi-replica deployment. |
| `min_instance_count` | `1` | **High** | Setting `0` allows scale-to-zero. Cold starts drop active WebSocket connections, causing users to see disconnection banners and miss real-time messages until reconnection. Keep at `1` for production. |
| `container_resources.memory_limit` | `"4Gi"` | **High** | Mattermost caches active channels and user sessions in memory. Under-provisioning (below `2Gi`) causes OOM kills under moderate team load, especially during bulk message exports or plugin execution. |
| `session_affinity` | `"ClientIP"` | **High** | Without Redis and without session affinity, admin and user sessions are not shared across pods. Users are effectively logged out on every request that routes to a different replica. |
| `container_port` | `8065` | **Critical** | Mattermost listens on `8065`. Changing this without matching the container's bound port causes all health probes to fail and the pod to enter a restart loop. |
| `timeout_seconds` | `300` | **Medium** | Mattermost WebSocket connections are long-lived. A 300-second backend timeout causes active connections to be severed regularly. Set to `3600` for WebSocket-heavy deployments. |
| `enable_nfs` | `false` | **Medium** | NFS is off by default. If `gcs_volumes` is also not configured, Mattermost file uploads are stored inside the container's ephemeral filesystem and lost on pod restart. Configure GCS Fuse volumes for durable file storage. |
| `create_cloud_storage` | `false` | **Medium** | No GCS bucket is provisioned automatically by this module. Without `create_cloud_storage = true` and a `gcs_volumes` entry, uploaded files are not durable across pod restarts. |
| `stateful_pvc_size` | `"10Gi"` | **Medium** | For teams actively sharing files and media, `10Gi` fills quickly. Provision 50–100 Gi for active teams. PVC size can be expanded but not reduced. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Critical** (GKE-specific) | Must use binary suffixes (`Gi`, `Mi`) when set. Bare integers are treated as bytes and prevent all pods from being scheduled. |
| `backup_retention_days` | `7` | **Medium** | Too short for active teams. Increase to 30+ days to provide a meaningful recovery window. |
| `enable_cloud_armor` | `false` | **Medium** | Without Cloud Armor, Mattermost's login page and API endpoints are exposed to brute-force and credential-stuffing attacks. Enable for any publicly reachable deployment. |
| `enable_pod_disruption_budget` | `false` | **Medium** | Disabled by default. Without a PDB, GKE node upgrades can terminate all Mattermost pods simultaneously, causing a full outage. Enable for production. |
| `startup_probe.failure_threshold` | `30` | **High** | Mattermost runs PostgreSQL schema migrations on first startup. Reducing `failure_threshold` below `20` on fresh deployments with large databases can cause Kubernetes to restart the pod before migrations complete, creating a restart loop. |
