# Wikijs_GKE Module — Configuration Guide

`Wikijs_GKE` is a pre-configured wrapper around the [`App_GKE`](../App_GKE/App_GKE.md) module that deploys [Wiki.js](https://js.wiki/) — a powerful open-source wiki platform — on Google Kubernetes Engine (GKE) Autopilot.

Every variable in this module is passed through to `App_GKE`. The wrapper's role is to supply Wiki.js-appropriate defaults and to call the `Wikijs_Common` sub-module, which generates the application's Docker build context, database initialisation scripts, and storage configuration. You configure this module exactly as you would `App_GKE`; the sections below highlight only the variables whose defaults or behaviour differ meaningfully from `App_GKE`, or that are unique to this wrapper.

> **Full reference:** For complete descriptions, validation steps, and gcloud CLI examples for any variable not covered here, see the [App_GKE Configuration Guide](../App_GKE/App_GKE.md).

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## Architecture: the Wikijs_Common sub-module

Before variables are forwarded to `App_GKE`, this module calls `Wikijs_Common`, which:

- Generates the Wiki.js `Dockerfile` and Cloud Build context that builds the `requarks/wiki:2` image with the correct configuration baked in.
- Produces a set of initialisation Cloud Run Jobs (database schema setup, `pg_trgm` extension installation).
- Defines the GCS storage bucket layout (the `wikijs-storage` bucket, mounted at `/wiki-storage`).
- Computes the `application_config` object that `App_GKE` uses to wire the application into its deployment pipeline.

None of the `Wikijs_Common` internals are directly configurable through this module's variables. To customise the Wiki.js build or initialisation behaviour beyond what the variables below expose, fork the `Wikijs_Common` module.

---

## Module Metadata & Configuration

The variables in this group are identical in purpose to those in `App_GKE`. See [App_GKE §1 Module Overview](../App_GKE/App_GKE.md#1-module-overview) for full descriptions.

The Wiki.js-specific defaults for this module are:

| Variable | Wikijs_GKE Default | App_GKE Default |
|---|---|---|
| `module_description` | `"Wiki.js: Deploy powerful open-source wiki software on Google Kubernetes Engine (GKE)."` | `"App_GKE: A production-ready module…"` |
| `module_documentation` | `"https://docs.radmodules.dev/docs/applications/wiki-js"` | `"https://docs.radmodules.dev/docs/applications/gke-app"` |
| `module_services` | Includes GKE Autopilot, Cloud SQL, GCS Fuse, Filestore, Cloud Build, and related services | Same services, generic labels |

All other Group 0 variables (`credit_cost`, `require_credit_purchases`, `enable_purge`, `public_access`, `deployment_id`, `resource_creator_identity`) share the same defaults and behaviour as `App_GKE`.

---

## Project & Identity

All variables in this group are identical to `App_GKE`. See [App_GKE §2 IAM & Access Control](../App_GKE/App_GKE.md#2-iam--access-control) for full descriptions.

This module adds one variable not present in `App_GKE`:

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `deployment_region` | `"us-central1"` | GCP region string | Fallback region used when the network discovery sub-module cannot determine a region from existing VPC subnet metadata. The discovery module inspects the project's VPC subnets and selects the region of the first subnet found. If no subnets exist yet — for example, on a first deployment into a fresh project — this value is used instead. Override this if your infrastructure is in a region other than `us-central1`. This variable has no effect once a VPC with subnets exists in the project. |

---

## Application Identity

All variables are identical in purpose to `App_GKE`. See [App_GKE §1 Module Overview](../App_GKE/App_GKE.md#1-module-overview) for full descriptions.

The Wiki.js-specific defaults are:

| Variable | Wikijs_GKE Default | App_GKE Default | Notes |
|---|---|---|---|
| `application_name` | `"wikijs"` | `"gkeapp"` | Used as a base for all resource names. Do not change after initial deployment. |
| `application_display_name` | `"Wiki.js"` | `"App_GKE Application"` | Human-readable name; safe to change at any time. |
| `application_description` | `"Wiki.js - The most powerful and extensible open source Wiki software"` | `"App_GKE Custom Application…"` | Safe to update. |
| `application_version` | `"2.5.311"` | `"1.0.0"` | The Wiki.js release tag. Update to trigger a rebuild with a newer Wiki.js version. |

---

## Runtime & Scaling

All variables are identical in purpose to `App_GKE`. See [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot) for full descriptions.

The Wiki.js-specific defaults are:

| Variable | Wikijs_GKE Default | App_GKE Default | Notes |
|---|---|---|---|
| `container_image_source` | `"custom"` | `"custom"` | Wiki.js uses a custom build by default, producing a pre-configured image via Cloud Build. |
| `container_image` | `"requarks/wiki:2"` | `""` | The upstream Docker Hub image used as the base when `container_image_source = "custom"`. With `enable_image_mirroring = true` (the default), this image is mirrored into Artifact Registry before the build. |
| `container_port` | `3000` | `8080` | Wiki.js binds to port 3000 by default. Do not change unless you have customised the Wiki.js server configuration. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Wiki.js with full-text search (pg_trgm) and asset handling requires more memory than a generic app. Increase `memory_limit` to `4Gi` for wikis with heavy concurrent editing or large image uploads. |
| `min_instance_count` | `1` | `1` | Keeps one pod running at all times to avoid cold starts for wiki users. |
| `max_instance_count` | `3` | `3` | |
| `enable_image_mirroring` | `true` | `true` | Mirrors `requarks/wiki:2` from Docker Hub into Artifact Registry, avoiding rate limits and ensuring build reproducibility. |
| `enable_cloudsql_volume` | `true` | `true` | Required for Wiki.js to connect to PostgreSQL via a Unix socket. |
| `network_tags` | `["nfsserver"]` | `[]` | Applied to the GKE node pool so that firewall rules for the NFS/Filestore server allow inbound connections from Wiki.js pods. Change only if your Filestore firewall rules use different tags. |

---

## Environment Variables & Secrets

All variables are identical in purpose to `App_GKE`. See [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot) for full descriptions.

`environment_variables` is pre-populated with the Wiki.js database connection settings that the application reads at startup:

| Variable | Default Value | Purpose |
|---|---|---|
| `DB_TYPE` | `"postgres"` | Tells Wiki.js to use a PostgreSQL backend. Do not change — the module provisions only PostgreSQL. |
| `DB_PORT` | `"5432"` | PostgreSQL port. Matches the Cloud SQL Auth Proxy Unix socket convention. |
| `DB_USER` | `"wikijs"` | Matches the database user created in Group 17. Must be kept in sync with `application_database_user`. |
| `DB_NAME` | `"wikijs"` | Matches the database name created in Group 17. Must be kept in sync with `application_database_name`. |
| `DB_SSL` | `"false"` | SSL is handled by the Cloud SQL Auth Proxy tunnel; the application-level SSL handshake is not needed. |
| `HA_STORAGE_PATH` | `"/wiki-storage"` | The path where Wiki.js looks for uploaded assets. Must match the GCS Fuse mount point configured by `Wikijs_Common`. Do not change unless you also reconfigure the GCS volume mount path in `Wikijs_Common`. |

`DB_HOST` and `DB_PASSWORD` are injected automatically by the platform at runtime and do not appear in `environment_variables`. `DB_PASSWORD` is sourced from Secret Manager; `DB_HOST` points to the Cloud SQL Auth Proxy Unix socket path.

To add application-level environment variables, add entries to the `environment_variables` map. To supply sensitive values (tokens, API keys), use `secret_environment_variables` instead.

---

## GKE Backend Configuration

All variables are identical to `App_GKE`. See [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot) for full descriptions.

Wiki.js-specific defaults:

| Variable | Wikijs_GKE Default | App_GKE Default | Notes |
|---|---|---|---|
| `workload_type` | `"Deployment"` | `"Deployment"` | Wiki.js uses a standard Deployment; switch to `StatefulSet` only if you require per-pod persistent storage beyond GCS/NFS. |
| `service_type` | `"LoadBalancer"` | `"LoadBalancer"` | Exposes Wiki.js via an external load balancer IP. |
| `session_affinity` | `"ClientIP"` | `"ClientIP"` | Wiki.js maintains in-memory session context; session affinity ensures users are consistently routed to the same pod. |

---

## Database Configuration

All variables are identical in purpose to `App_GKE`. See [App_GKE §3.B Database (Cloud SQL)](../App_GKE/App_GKE.md#b-database-cloud-sql) for full descriptions.

The Wiki.js-specific defaults are:

| Variable | Wikijs_GKE Default | App_GKE Default | Notes |
|---|---|---|---|
| `database_type` | `"POSTGRES_15"` | `"POSTGRES"` | Wiki.js requires PostgreSQL. Do not change to MySQL or NONE — the application will fail to start. Pinning to `POSTGRES_15` ensures version consistency across deployments. |
| `application_database_name` | `"wikijs"` | `"gkeappdb"` | Must match `DB_NAME` in `environment_variables`. Do not change after initial deployment. |
| `application_database_user` | `"wikijs"` | `"gkeappuser"` | Must match `DB_USER` in `environment_variables`. Do not change after initial deployment. |
| `enable_postgres_extensions` | `true` | `false` | Installs the extensions in `postgres_extensions` after the database is provisioned. |
| `postgres_extensions` | `["pg_trgm"]` | `[]` | `pg_trgm` enables PostgreSQL native trigram full-text search, which Wiki.js uses for its search index. Removing this extension will disable full-text search in Wiki.js. Add further extensions here if your usage requires them (e.g. `postgis` for location-aware content). |

> **Important:** `database_type`, `application_database_name`, and `application_database_user` are embedded in Cloud SQL resource names and Kubernetes secrets. Do not change any of these after the initial deployment.

---

## All Other Configuration Groups

The following groups are available in `Wikijs_GKE` and behave exactly as documented in the `App_GKE` guide. The Wiki.js application imposes no additional constraints or defaults on them beyond what is noted in that guide.

| Configuration Area | Wikijs_GKE Variables | App_GKE.md Section |
|---|---|---|
| CI/CD & GitHub Integration | `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages` | [App_GKE §6 CI/CD & Delivery](../App_GKE/App_GKE.md#6-cicd--delivery) |
| Binary Authorization | `enable_binary_authorization`, `binauthz_evaluation_mode` | [App_GKE §4.C Binary Authorization](../App_GKE/App_GKE.md#c-binary-authorization) |
| Identity-Aware Proxy | `enable_iap`, `iap_authorized_users`, `iap_authorized_groups`, `iap_oauth_client_id`, `iap_oauth_client_secret`, `iap_support_email` | [App_GKE §4.B Identity-Aware Proxy (IAP)](../App_GKE/App_GKE.md#b-identity-aware-proxy-iap) |
| Cloud Armor | `enable_cloud_armor`, `cloud_armor_policy_name`, `admin_ip_ranges` | [App_GKE §4.A Cloud Armor WAF](../App_GKE/App_GKE.md#a-cloud-armor-waf) |
| VPC Service Controls | `enable_vpc_sc` | [App_GKE §4.D VPC Service Controls](../App_GKE/App_GKE.md#d-vpc-service-controls) |
| Secrets Store CSI | `enable_secrets_store_csi_driver` | [App_GKE §4.E Secrets Store CSI](../App_GKE/App_GKE.md#e-secrets-store-csi-driver) |
| Storage & Filesystem — NFS | `enable_nfs`, `nfs_mount_path`, `nfs_instance_name`, `nfs_instance_base_name` | [App_GKE §3.C Storage (NFS / GCS / GCS Fuse)](../App_GKE/App_GKE.md#c-storage-nfs--gcs--gcs-fuse) |
| Storage & Filesystem — GCS | `create_cloud_storage`, `storage_buckets`, `gcs_volumes` | [App_GKE §3.C Storage (NFS / GCS / GCS Fuse)](../App_GKE/App_GKE.md#c-storage-nfs--gcs--gcs-fuse) |
| Networking & Network Policies | `enable_network_segmentation`, `network_tags` | [App_GKE §3.D Networking & Network Policies](../App_GKE/App_GKE.md#d-networking--network-policies) |
| Jobs & Workload Automation | `initialization_jobs`, `cron_jobs`, `additional_services` | [App_GKE §3.E Initialization Jobs & CronJobs](../App_GKE/App_GKE.md#e-initialization-jobs--cronjobs) |
| Custom SQL Scripts | `enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` | [App_GKE §3.E Initialization Jobs & CronJobs](../App_GKE/App_GKE.md#e-initialization-jobs--cronjobs) |
| Observability & Health | `health_check_config`, `startup_probe_config`, `uptime_check_config`, `alert_policies` — **Note:** `startup_probe_config` and `health_check_config` each serve a dual role: forwarded to `Wikijs_Common` (as `startup_probe`/`liveness_probe`) for container probes, and also to `App_GKE` for LB health checks. | [App_GKE §5 Traffic & Ingress](../App_GKE/App_GKE.md#5-traffic--ingress) |
| Custom Domain | `enable_custom_domain`, `application_domains` | [App_GKE §5 Traffic & Ingress](../App_GKE/App_GKE.md#5-traffic--ingress) |
| Cloud CDN | `enable_cdn` | [App_GKE §5.B Cloud CDN](../App_GKE/App_GKE.md#b-cloud-cdn) |
| Static IP | `reserve_static_ip`, `static_ip_name` | [App_GKE §5.C Static IP](../App_GKE/App_GKE.md#c-static-ip) |
| StatefulSet Configuration | `stateful_pvc_enabled`, `stateful_pvc_size`, `stateful_pvc_mount_path`, `stateful_pvc_storage_class`, `stateful_headless_service`, `stateful_pod_management_policy`, `stateful_update_strategy` | [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot) |
| Secrets Management | `secret_propagation_delay`, `secret_rotation_period` | [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot) |
| MySQL Extensions | `enable_mysql_plugins`, `mysql_plugins` | [App_GKE §3.B Database (Cloud SQL)](../App_GKE/App_GKE.md#b-database-cloud-sql) |
| Backup Schedule & Retention | `backup_schedule`, `backup_retention_days` | [App_GKE §8.B Backup Import & Recovery](../App_GKE/App_GKE.md#b-backup-import) |
| Backup Import | `enable_backup_import`, `backup_source`, `backup_file`, `backup_format` | [App_GKE §8.B Backup Import & Recovery](../App_GKE/App_GKE.md#b-backup-import) |
| Redis Cache | `enable_redis`, `redis_host`, `redis_port`, `redis_auth` | [App_GKE §8.A Redis / Memorystore](../App_GKE/App_GKE.md#a-redis--memorystore) |
| Pod Disruption Budget | `enable_pod_disruption_budget`, `pdb_min_available` | [App_GKE §7.A Pod Disruption Budget](../App_GKE/App_GKE.md#a-pod-disruption-budgets) |
| Topology Spread | `enable_topology_spread`, `topology_spread_strict` | [App_GKE §7.B Topology Spread](../App_GKE/App_GKE.md#b-topology-spread-constraints) |
| Resource Quotas | `enable_resource_quota`, `quota_cpu_requests`, `quota_cpu_limits`, `quota_memory_requests`, `quota_memory_limits` | [App_GKE §7.C Resource Quotas](../App_GKE/App_GKE.md#c-resource-quotas) |
| Auto Password Rotation | `enable_auto_password_rotation`, `rotation_propagation_delay_sec` | [App_GKE §7.D Auto Password Rotation](../App_GKE/App_GKE.md#d-auto-password-rotation) |
| Service Mesh | `configure_service_mesh` | [App_GKE §8.C Service Mesh](../App_GKE/App_GKE.md#c-service-mesh-asm-via-fleet) |
| Multi-Cluster Services | `enable_multi_cluster_service` | [App_GKE §8.D Multi-Cluster Services](../App_GKE/App_GKE.md#d-multi-cluster-services-mcs) |

> **Note on NFS defaults:** `enable_nfs` defaults to `true` in `Wikijs_GKE`. Wiki.js uses the NFS mount for shared page assets and uploads across pod replicas. Disabling NFS (`enable_nfs = false`) is only appropriate for single-replica deployments where data loss on pod restart is acceptable.

---

## Deployment Prerequisites & Dependency Analysis

`Wikijs_GKE` inherits all prerequisites and dependency requirements from `App_GKE`. See [App_GKE — Deployment Prerequisites & Dependency Analysis](../App_GKE/App_GKE.md#deployment-prerequisites--dependency-analysis) for the full reference.

The following Wiki.js-specific points supplement that analysis:

### Wiki.js application startup

On first deployment, the `Wikijs_Common` initialisation jobs run in order before the main pod receives traffic:

1. **`db-init`** — runs `psql` to create the `wikijs` database schema and installs the `pg_trgm` extension. Requires the Cloud SQL instance and the `wikijs` database user to be fully provisioned. Terraform waits for this job to complete before proceeding.
2. The Wiki.js pod then starts. It connects to PostgreSQL via the Cloud SQL Auth Proxy Unix socket (`/cloudsql`), reads `DB_*` environment variables, and completes its own startup migration.

If the `db-init` job fails, the Wiki.js pod will also fail to start (it will crash-loop until the schema exists). Check the Cloud Run Job execution logs in **Cloud Run → Jobs** if the initial deployment appears to hang.

### NFS dependency

With `enable_nfs = true` (the default), the NFS server or Filestore instance must be reachable from the GKE cluster. The `network_tags = ["nfsserver"]` default ensures the GKE node pool has the correct network tag to match the NFS firewall rule created by `Services_GCP` (or inline by `App_GKE`). If you change `network_tags`, update the corresponding firewall rule accordingly.

### `DB_USER` / `DB_NAME` consistency

The values of `application_database_user` and `application_database_name` (Group 17) must exactly match the `DB_USER` and `DB_NAME` entries in `environment_variables` (Group 5). The module pre-populates both to `"wikijs"`. If you change one, change the other to match.
