---
title: "Wikijs GKE Module — Configuration Guide"
sidebar_label: "Wikijs GKE"
---

# Wikijs GKE Module — Configuration Guide

`Wikijs_GKE` is a pre-configured wrapper around the [`App_GKE`](../App_GKE/App_GKE.md) module that deploys [Wiki.js](https://js.wiki/) — a powerful open-source wiki platform — on Google Kubernetes Engine (GKE) Autopilot.

Every variable in this module is passed through to `App GKE`. The wrapper's role is to supply Wiki.js-appropriate defaults and to call the `Wikijs Common` sub-module, which generates the application's Docker build context, database initialisation scripts, and storage configuration. You configure this module exactly as you would `App GKE`; the sections below highlight only the variables whose defaults or behaviour differ meaningfully from `App GKE`, or that are unique to this wrapper.

> **Full reference:** For complete descriptions, validation steps, and gcloud CLI examples for any variable not covered here, see the [App_GKE Configuration Guide](../App_GKE/App_GKE.md).

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## Architecture: the Wikijs Common sub-module

Before variables are forwarded to `App GKE`, this module calls `Wikijs Common`, which:

- Generates the Wiki.js `Dockerfile` and Cloud Build context that builds the `requarks/wiki:2` image with the correct configuration baked in.
- Produces a set of initialisation Cloud Run Jobs (database schema setup, `pg_trgm` extension installation).
- Defines the GCS storage bucket layout (the `wikijs-storage` bucket, mounted at `/wiki-storage`).
- Computes the `application_config` object that `App GKE` uses to wire the application into its deployment pipeline.

None of the `Wikijs Common` internals are directly configurable through this module's variables. To customise the Wiki.js build or initialisation behaviour beyond what the variables below expose, fork the `Wikijs Common` module.

---

## Module Metadata & Configuration

The variables in this group are identical in purpose to those in `App_GKE`. See [App_GKE §1 Module Overview](../App_GKE/App_GKE.md#1-module-overview) for full descriptions.

The Wiki.js-specific defaults for this module are:

| Variable | Wikijs GKE Default | App GKE Default |
|---|---|---|
| `module_description` | `"Wiki.js: Deploy powerful open-source wiki software on Google Kubernetes Engine (GKE)."` | `"App GKE: A production-ready module…"` |
| `module_documentation` | `"https://docs.radmodules.dev/docs/applications/wiki-js"` | `"https://docs.radmodules.dev/docs/applications/gke-app"` |
| `module_services` | Includes GKE Autopilot, Cloud SQL, GCS Fuse, Filestore, Cloud Build, and related services | Same services, generic labels |

All other Group 0 variables (`credit_cost`, `require_credit_purchases`, `enable_purge`, `public_access`, `deployment_id`, `resource_creator_identity`) share the same defaults and behaviour as `App GKE`.

---

## Project & Identity

All variables in this group are identical to `App_GKE`. See [App_GKE §2 IAM & Access Control](../App_GKE/App_GKE.md#2-iam--access-control) for full descriptions.

This module adds one variable not present in `App GKE`:

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `region` | `"us-central1"` | GCP region string | Fallback region used when the network discovery sub-module cannot determine a region from existing VPC subnet metadata. The discovery module inspects the project's VPC subnets and selects the region of the first subnet found. If no subnets exist yet — for example, on a first deployment into a fresh project — this value is used instead. Override this if your infrastructure is in a region other than `us-central1`. This variable has no effect once a VPC with subnets exists in the project. |

---

## Application Identity

All variables are identical in purpose to `App_GKE`. See [App_GKE §1 Module Overview](../App_GKE/App_GKE.md#1-module-overview) for full descriptions.

The Wiki.js-specific defaults are:

| Variable | Wikijs GKE Default | App GKE Default | Notes |
|---|---|---|---|
| `application_name` | `"wikijs"` | `"gkeapp"` | Used as a base for all resource names. Do not change after initial deployment. |
| `application_display_name` | `"Wiki.js"` | `"App GKE Application"` | Human-readable name; safe to change at any time. |
| `application_description` | `"Wiki.js - The most powerful and extensible open source Wiki software"` | `"App GKE Custom Application…"` | Safe to update. |
| `application_version` | `"2.5.311"` | `"1.0.0"` | The Wiki.js release tag. Update to trigger a rebuild with a newer Wiki.js version. |

---

## Runtime & Scaling

All variables are identical in purpose to `App_GKE`. See [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot) for full descriptions.

The Wiki.js-specific defaults are:

| Variable | Wikijs GKE Default | App GKE Default | Notes |
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
| `HA_STORAGE_PATH` | `"/wiki-storage"` | The path where Wiki.js looks for uploaded assets. Must match the GCS Fuse mount point configured by `Wikijs Common`. Do not change unless you also reconfigure the GCS volume mount path in `Wikijs Common`. |

`DB_HOST` and `DB_PASSWORD` are injected automatically by the platform at runtime and do not appear in `environment_variables`. `DB_PASSWORD` is sourced from Secret Manager; `DB_HOST` points to the Cloud SQL Auth Proxy Unix socket path.

To add application-level environment variables, add entries to the `environment_variables` map. To supply sensitive values (tokens, API keys), use `secret_environment_variables` instead.

---

## GKE Backend Configuration

All variables are identical to `App_GKE`. See [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot) for full descriptions.

Wiki.js-specific defaults:

| Variable | Wikijs GKE Default | App GKE Default | Notes |
|---|---|---|---|
| `workload_type` | `"Deployment"` | `"Deployment"` | Wiki.js uses a standard Deployment; switch to `StatefulSet` only if you require per-pod persistent storage beyond GCS/NFS. |
| `service_type` | `"LoadBalancer"` | `"LoadBalancer"` | Exposes Wiki.js via an external load balancer IP. |
| `session_affinity` | `"ClientIP"` | `"ClientIP"` | Wiki.js maintains in-memory session context; session affinity ensures users are consistently routed to the same pod. |

---

## Database Configuration

All variables are identical in purpose to `App_GKE`. See [App_GKE §3.B Database (Cloud SQL)](../App_GKE/App_GKE.md#b-database-cloud-sql) for full descriptions.

The Wiki.js-specific defaults are:

| Variable | Wikijs GKE Default | App GKE Default | Notes |
|---|---|---|---|
| `database_type` | `"POSTGRES_15"` | `"POSTGRES"` | Wiki.js requires PostgreSQL. Do not change to MySQL or NONE — the application will fail to start. Pinning to `POSTGRES_15` ensures version consistency across deployments. |
| `application_database_name` | `"wikijs"` | `"gkeappdb"` | Must match `DB_NAME` in `environment_variables`. Do not change after initial deployment. |
| `application_database_user` | `"wikijs"` | `"gkeappuser"` | Must match `DB_USER` in `environment_variables`. Do not change after initial deployment. |
| `enable_postgres_extensions` | `true` | `false` | Installs the extensions in `postgres_extensions` after the database is provisioned. |
| `postgres_extensions` | `["pg_trgm"]` | `[]` | `pg_trgm` enables PostgreSQL native trigram full-text search, which Wiki.js uses for its search index. Removing this extension will disable full-text search in Wiki.js. Add further extensions here if your usage requires them (e.g. `postgis` for location-aware content). |

> **Important:** `database_type`, `application_database_name`, and `application_database_user` are embedded in Cloud SQL resource names and Kubernetes secrets. Do not change any of these after the initial deployment.

---

## All Other Configuration Groups

The following groups are available in `Wikijs GKE` and behave exactly as documented in the `App GKE` guide. The Wiki.js application imposes no additional constraints or defaults on them beyond what is noted in that guide.

| Configuration Area | Wikijs GKE Variables | App GKE.md Section |
|---|---|---|
| CI/CD & GitHub Integration | `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages` | [App_GKE §6 CI/CD & Delivery](../App_GKE/App_GKE.md#6-cicd--delivery) |
| Binary Authorization | `enable_binary_authorization`, `binauthz_evaluation_mode` | [App_GKE §4.C Binary Authorization](../App_GKE/App_GKE.md#c-binary-authorization) |
| Identity-Aware Proxy | `enable_iap`, `iap_authorized_users`, `iap_authorized_groups`, `iap_oauth_client_id`, `iap_oauth_client_secret`, `iap_support_email` | [App_GKE §4.B Identity-Aware Proxy (IAP)](../App_GKE/App_GKE.md#b-identity-aware-proxy-iap) |
| Cloud Armor | `enable_cloud_armor`, `cloud_armor_policy_name`, `admin_ip_ranges` | [App_GKE §4.A Cloud Armor WAF](../App_GKE/App_GKE.md#a-cloud-armor-waf) |
| VPC Service Controls | `enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `organization_id`, `enable_audit_logging` | [App_GKE §4.D VPC Service Controls](../App_GKE/App_GKE.md#d-vpc-service-controls) |
| Secrets Store CSI | Always enabled — no configuration required. | [App_GKE §4.E Secrets Store CSI](../App_GKE/App_GKE.md#e-secrets-store-csi-driver) |
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
| Resource Quotas | `enable_resource_quota`, `quota_cpu_requests`, `quota_cpu_limits`, `quota_memory_requests`, `quota_memory_limits`, `quota_max_pods`, `quota_max_services`, `quota_max_pvcs` | [App_GKE §7.C Resource Quotas](../App_GKE/App_GKE.md#c-resource-quotas) |
| Auto Password Rotation | `enable_auto_password_rotation`, `rotation_propagation_delay_sec` | [App_GKE §7.D Auto Password Rotation](../App_GKE/App_GKE.md#d-auto-password-rotation) |
| Service Mesh | `configure_service_mesh` | [App_GKE §8.C Service Mesh](../App_GKE/App_GKE.md#c-service-mesh-asm-via-fleet) |
| Multi-Cluster Services | `enable_multi_cluster_service` | [App_GKE §8.D Multi-Cluster Services](../App_GKE/App_GKE.md#d-multi-cluster-services-mcs) |

> **Note on NFS defaults:** `enable_nfs` defaults to `true` in `Wikijs GKE`. Wiki.js uses the NFS mount for shared page assets and uploads across pod replicas. Disabling NFS (`enable_nfs = false`) is only appropriate for single-replica deployments where data loss on pod restart is acceptable.

---

## Required Providers

`Wikijs GKE` declares the following required providers in `versions.tf` (minimum versions):

| Provider | Source | Version |
|---|---|---|
| `google` | `hashicorp/google` | `>= 6.0.0` |
| `google-beta` | `hashicorp/google-beta` | `>= 6.0.0` |
| `kubernetes` | `hashicorp/kubernetes` | `>= 2.0` |
| `random` | `hashicorp/random` | `>= 3.0` |
| `external` | `hashicorp/external` | `>= 2.0` |
| `null` | `hashicorp/null` | `>= 3.0` |
| `github` | `integrations/github` | `>= 5.0.0` (configuration alias: `github.cicd`) |

OpenTofu/Terraform `>= 1.0` is required.

---

## Cross-Variable Validation Guards

`Wikijs GKE` includes a `validation.tf` file with lifecycle `precondition` blocks that catch invalid configuration combinations at plan time:

| Guard | Condition |
|---|---|
| Instance count | `min_instance_count` must not exceed `max_instance_count` |
| Redis without host | When `enable_redis = true`, either `redis_host` must be non-empty or `enable_nfs = true` (NFS server IP used as Redis host fallback) |
| IAP without credentials | When `enable_iap = true`, both `iap_oauth_client_id` and `iap_oauth_client_secret` must be provided |
| CloudSQL volume without database | `enable_cloudsql_volume` must not be `true` when `database_type = "NONE"` |

---

## Module Outputs

| Output | Description |
|--------|-------------|
| `service_url` | URL of the deployed Wiki.js service. |
| `kubernetes_ready` | `true` when the GKE cluster endpoint is available and all Kubernetes workload resources have been deployed. `false` on the first apply of a new inline cluster — the cluster is created but its endpoint is not yet readable, so Kubernetes resources are skipped. The CI/CD pipeline must detect this value and re-run `apply` to complete the deployment. |

---

## Configuration Pitfalls & Sensible Defaults

The table below identifies the variables most commonly misconfigured in `Wikijs GKE` deployments, explains the sensible starting value, and describes exactly what happens when the value is wrong.

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `application_name` | `"wikijs"` (default; do not change after first deploy) | **Critical** | Embedded in GKE namespace name, Artifact Registry repo, and Secret Manager secret IDs. Changing recreates all named resources — existing wiki content, page history, and user accounts are left in the orphaned Cloud SQL instance. |
| `tenant_deployment_id` | Match environment: `"prod"`, `"staging"`, `"dev"` | **Critical** | Changing after first deploy orphans the old Cloud SQL instance. A new empty PostgreSQL database is provisioned. All wiki pages, attachments, and user accounts are left behind and inaccessible. |
| `application_database_name` and `DB_NAME` | Both `"wikijs"` (must match) | **Critical** | Mismatch between `application_database_name` and the `DB_NAME` value in `environment_variables`: the `db-init` job creates one database while Wiki.js connects to a different (non-existent) one. Wiki.js crashes on startup with a DB-not-found error. Change both together or leave both at the default. |
| `application_database_user` and `DB_USER` | Both `"wikijs"` (must match) | **High** | Mismatch: `db-init` creates grants for one user while Wiki.js authenticates as another. DB authentication fails. Outage until both values are corrected and `db-init` re-runs. |
| `quota_memory_requests` | `"2Gi"` minimum (binary suffix required) | **Critical** | A bare integer like `"2"` is treated as **2 bytes** by Kubernetes. The ResourceQuota rejects every pod — **all Wiki.js pods fail to schedule**. Always use `"2Gi"` or `"2048Mi"`. |
| `quota_memory_limits` | `"4Gi"` (must be ≥ `quota_memory_requests`) | **Critical** | Same bare-integer issue. Always use binary suffixes. |
| `memory_limit` | `"2Gi"` (default) — minimum `"1Gi"` | **High** | Wiki.js (Node.js) is OOMKilled under `512Mi`. Rendering complex pages with many embedded images or running search indexing can spike memory to 1–2 Gi. Increase to `"2Gi"` for wikis with significant content. |
| `DB_TYPE` | `"postgres"` (hardcoded in `Wikijs Common`) | **Critical** | `Wikijs Common` hardcodes `DB_TYPE = "postgres"` and installs the `pg_trgm` extension. Overriding to `"mysql"` or `"sqlite"` via `environment_variables` causes a schema mismatch and the `db-init` job fails. Do not override `DB_TYPE`. |
| `enable_postgres_extensions` and `postgres_extensions` | `true` and `["pg_trgm"]` (set by Common) | **Critical** | `pg_trgm` is required for Wiki.js full-text search. Disabling extensions or removing `pg_trgm` causes all search operations to fail with a PostgreSQL function-not-found error. Never override these values from the Common module defaults. |
| `enable_nfs` | `true` (default; required for shared file uploads across replicas) | **High** | `false` with `max_instance_count > 1`: uploaded files written by one pod are invisible to other pods. Users see 404 for assets recently uploaded by a different replica. Files on a pod are lost on pod restart. Configure NFS correctly before scaling beyond 1 replica. |
| `nfs_mount_path` | `"/mnt/nfs"` (default) | **High** | Mismatch with `HA_STORAGE_PATH` (`"/wiki-storage"` set by Common): Wiki.js writes uploads to the unshared path and files are lost on pod restart. The NFS mount path and `HA_STORAGE_PATH` must resolve to the same physical location. |
| `HA_STORAGE_PATH` | `"/wiki-storage"` (hardcoded in `Wikijs Common`) | **High** | Overriding without also changing `nfs_mount_path` to match: Wiki.js writes to the new path, which is not on the NFS volume. All uploads are lost on pod restart. Always override both together. |
| `workload_type` | `null` (auto-selects Deployment) | **Medium** | `"StatefulSet"` without `stateful_pvc_enabled = true` creates a StatefulSet with no persistent per-pod storage. Wiki.js shared storage is handled by NFS, not per-pod PVCs. |
| `startup_probe.failure_threshold` | `3` (default; allows 30 s after initial delay) | **High** | Too low on first deploy: Wiki.js must connect to PostgreSQL and run schema migrations before serving requests. With a freshly provisioned Cloud SQL instance, migrations can take 30–60 s. Increase `failure_threshold` to `12` or `initial_delay_seconds` to `90` for first-deploy reliability. |
| `startup_probe.path` | `"/healthz"` (Wiki.js built-in health endpoint) | **Critical** | Wrong path: GKE kills the pod before it accepts traffic. `"/healthz"` returns `200 OK` once Wiki.js is fully initialised and connected to PostgreSQL. Do not use `"/"` — it serves the UI and may be slow to render. |
| `min_instance_count` | `1` (default; Wiki.js benefits from a warm connection pool) | **High** | `0` (scale-to-zero): Wiki.js Node.js startup + DB reconnect + module loading takes 15–30 s. Incoming requests during cold start are queued and may time out. |
| `max_instance_count` | `3` (default) | **Medium** | Wiki.js uses PostgreSQL for persistent state and NFS for file storage — both are shared safely across replicas. However, ensure `max_instance_count` × connection pool size stays within Cloud SQL's `max_connections` limit to avoid `FATAL: too many clients`. |
| `network_tags` | `["nfsserver"]` (default; required for NFS firewall rule) | **High** | Removing `"nfsserver"`: the GKE node loses the tag matching the NFS firewall rule. The NFS mount fails, Wiki.js cannot write uploads, and the pod may fail to start if NFS is a required volume. |
| `enable_pod_disruption_budget` | `false` (default) | **High** | `true` with `max_instance_count = 1` and `pdb_min_available = "1"`: GKE node drains are permanently blocked. Autopilot maintenance windows cannot complete. Enable only when `min_instance_count ≥ 2`. |
| `binauthz_evaluation_mode` | `"ALWAYS_ALLOW"` until CI pipeline attests images | **Critical** | `"REQUIRE_ATTESTATION"` without a working attestation pipeline: no new Wiki.js image can be deployed to GKE, and rollbacks also fail. |
| `enable_vpc_sc` | `false` until perimeter is validated; use `vpc_sc_dry_run = true` first | **Critical** | `enable_vpc_sc = true` with `vpc_sc_dry_run = false`: if the Wiki.js GKE SA is absent from the VPC-SC access level, Cloud SQL, Secret Manager, and Artifact Registry calls all fail simultaneously. |
| `secret_environment_variables` | `{ DB_PASS = "database_password_secret" }` (auto-set by Common) | **Critical** | Removing `DB_PASS`: Wiki.js cannot authenticate to PostgreSQL on startup. The pod enters a crash loop. |

## Deployment Prerequisites & Dependency Analysis

`Wikijs_GKE` inherits all prerequisites and dependency requirements from `App_GKE`. See [App_GKE — Deployment Prerequisites & Dependency Analysis](../App_GKE/App_GKE.md#deployment-prerequisites--dependency-analysis) for the full reference.

The following Wiki.js-specific points supplement that analysis:

### Wiki.js application startup

On first deployment, the `Wikijs Common` initialisation jobs run in order before the main pod receives traffic:

1. **`db-init`** — runs `psql` to create the `wikijs` database user and database, then grants the necessary privileges. The `pg_trgm` extension is installed separately by `App GKE` using the `enable_postgres_extensions = true` / `postgres_extensions = ["pg_trgm"]` configuration emitted by `Wikijs Common`. Requires the Cloud SQL instance to be fully provisioned. Terraform waits for this job to complete before proceeding.
2. The Wiki.js pod then starts. It connects to PostgreSQL via the Cloud SQL Auth Proxy Unix socket (`/cloudsql`), reads `DB_*` environment variables, and completes its own startup migration.

If the `db-init` job fails, the Wiki.js pod will also fail to start (it will crash-loop until the schema exists). Check the Kubernetes Job logs in **GKE → Workloads → Jobs** if the initial deployment appears to hang.

### NFS dependency

With `enable_nfs = true` (the default), the NFS server or Filestore instance must be reachable from the GKE cluster. The `network_tags = ["nfsserver"]` default ensures the GKE node pool has the correct network tag to match the NFS firewall rule created by `Services GCP` (or inline by `App GKE`). If you change `network_tags`, update the corresponding firewall rule accordingly.

### `DB_USER` / `DB_NAME` consistency

The values of `application_database_user` and `application_database_name` (Group 17) must exactly match the `DB_USER` and `DB_NAME` entries in `environment_variables` (Group 5). The module pre-populates both to `"wikijs"`. If you change one, change the other to match.

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `DB_TYPE` | `"postgres"` (hardcoded in Common) | **Critical** | Overriding to `"mysql"` or `"sqlite"` causes Wiki.js to misconnect and the `pg_trgm` extension install to fail during the db-init job. |
| `DB_PASS` | Auto-injected from `database_password_secret` | **Critical** | Overriding via plain-text `environment_variables` exposes the DB password in Terraform state. Always use `secret_environment_variables`. |
| `application_database_name` / `db_name` | `"wikijs"` | **High** | Must exactly match `DB_NAME` in `environment_variables`. Mismatches cause the db-init job to create a different database than the one Wiki.js connects to. Immutable after first apply. |
| `application_database_user` / `db_user` | `"wikijs"` | **High** | Must exactly match `DB_USER` in `environment_variables`. Immutable after first apply. |
| `HA_STORAGE_PATH` | `"/wiki-storage"` (hardcoded in Common) | **High** | Must match the GCS volume mount path. Overriding without changing the GCS volume mount causes uploads to go to the pod ephemeral disk, which is lost on every pod restart. |
| `container_resources.memory_limit` | `"2Gi"` | **High** | Under 512Mi Wiki.js is OOM-killed on startup. On GKE Autopilot, `mem_request` drives node provisioning — set close to `memory_limit` to avoid burstable eviction. |
| `container_resources.mem_request` | `null` (defaults to limit) | **Medium** | Far below `memory_limit` leads to burstable scheduling and possible eviction under memory pressure on a shared GKE Autopilot node. |
| `enable_cloudsql_volume` | `true` | **Critical** | Required for the Cloud SQL Auth Proxy sidecar. Disabling causes all PostgreSQL connections to fail. |
| `application_version` | `"2.5.311"` | **High** | Wiki.js 2.x and 3.x schemas are incompatible. Do not mix versions across upgrade cycles without staging validation. |
| `startup_probe_config.initial_delay_seconds` | `60` | **High** | Wiki.js performs database migrations and module loading on first start. Reducing below 30 causes GKE to kill the pod before it is ready. |
| `min_instance_count` | `1` | **High** | Scale-to-zero terminates in-flight database migrations and causes a 15–30 s cold start on the next request. |
| `max_instance_count` | `3` | **Medium** | Multiple replicas are safe for read-heavy wikis. Ensure GCS volumes are correctly mounted on all pods before scaling out. |
| `postgres_extensions` | `["pg_trgm"]` (hardcoded in Common) | **High** | Required for Wiki.js full-text search. Do not remove or disable. |
| `quota_memory_requests` / `quota_memory_limits` | `"4Gi"` / `"8Gi"` | **High** | GKE-specific: must use binary suffixes (`Gi`, `Mi`). A bare integer (e.g., `"4"`) is treated as bytes and blocks all pod scheduling. |
| `pdb_min_available` | `"1"` | **Medium** | Setting to `"0"` allows all Wiki.js pods to be evicted during GKE node upgrades, causing a full wiki outage. |
| `enable_iap` | `false` | **High** | Without IAP or network policies the Wiki.js interface is reachable from the load-balancer IP. Enable IAP for internal wikis. |
| `enable_nfs` | `true` | **Medium** | Wiki.js relies on the NFS mount for shared storage across replicas. Disabling while `max_instance_count > 1` causes split-brain storage where each pod has its own local upload directory. |
| `network_tags` | `["nfsserver"]` | **Medium** | Changing this without updating the corresponding NFS firewall rule in `Services GCP` breaks the NFS mount and causes pod startup failures when `enable_nfs = true`. |
| `backup_schedule` | `"0 2 * * *"` | **Medium** | Disabling automated backups leaves all wiki content and user accounts unprotected. |
| `secret_environment_variables` | `{ DB_PASS = "database_password_secret" }` | **Critical** | Removing `DB_PASS` breaks the database connection — Wiki.js will fail to authenticate to PostgreSQL on startup. |
