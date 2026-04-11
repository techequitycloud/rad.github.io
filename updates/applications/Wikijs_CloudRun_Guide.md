# Wikijs CloudRun Module

`Wikijs CloudRun` is a pre-configured wrapper around the [`App CloudRun`](../App_CloudRun/App_CloudRun_Guide.md) module that deploys [Wiki.js](https://js.wiki/) — a powerful open-source wiki platform — on Google Cloud Run Gen2.

Every variable in this module is passed through to `App CloudRun`. The wrapper's role is to supply Wiki.js-appropriate defaults and to call the `Wikijs_Common` sub-module, which generates the application's Docker build context, database initialisation jobs, and storage configuration. You configure this module exactly as you would `App CloudRun`; the sections below highlight only the variables whose defaults or behaviour differ meaningfully from `App CloudRun`, or that are unique to this wrapper.

> **Full reference:** For complete descriptions, validation steps, and gcloud CLI examples for any variable not covered here, see the [App CloudRun Configuration Guide](../App_CloudRun/App_CloudRun_Guide.md).

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## Architecture: the Wikijs_Common sub-module

Before variables are forwarded to `App CloudRun`, this module calls `Wikijs_Common`, which:

- Generates the Wiki.js `Dockerfile` and Cloud Build context that builds the `requarks/wiki:2` image with the correct configuration baked in.
- Produces a set of initialisation Cloud Run Jobs (database schema setup, `pg_trgm` extension installation, initial configuration seeding).
- Defines the GCS storage bucket layout (the `wikijs-storage` bucket, mounted via GCS Fuse at `/wiki-storage`).
- Computes the `application_config` object that `App CloudRun` uses to wire the application into its deployment pipeline.

The database is always **PostgreSQL 15** with the **`pg_trgm`** extension (required for Wiki.js full-text search). The database engine and extensions are fixed by `Wikijs_Common` and are not configurable through the variables exposed by this module. To customise the Wiki.js build or initialisation behaviour beyond what the variables below expose, fork the `Wikijs_Common` module.

---

## Group 0: Module Metadata & Configuration

The variables in this group are identical in purpose to those in `App CloudRun`. See [App CloudRun — Group 0](../App_CloudRun/App_CloudRun_Guide.md#group-0-module-metadata--configuration) for full descriptions.

The Wiki.js-specific defaults for this module are:

| Variable | Wikijs CloudRun Default | App CloudRun Default |
|---|---|---|
| `module_description` | `"Wiki.js: Deploy powerful open-source wiki software on Google Cloud Run…"` | `"App CloudRun: A production-ready module…"` |
| `module_documentation` | `"https://docs.radmodules.dev/docs/applications/wiki-js"` | `"https://docs.radmodules.dev/docs/applications/…"` |
| `module_services` | Includes Cloud Run Gen2, PostgreSQL 15, pg_trgm, GCS Fuse, NFS, and related services | Same services, generic labels |

All other Group 0 variables (`credit_cost`, `require_credit_purchases`, `enable_purge`, `public_access`, `deployment_id`, `resource_creator_identity`) share the same defaults and behaviour as `App CloudRun`.

---

## Group 1: Project & Identity

All variables in this group are identical to `App CloudRun`. See [App CloudRun — Group 1](../App_CloudRun/App_CloudRun_Guide.md#group-1-project--identity) for full descriptions.

---

## Group 2: Application Identity

This group differs from `App CloudRun` in two ways: the variable `application_display_name` is named `display_name` in this module, and two additional variables (`db_name` and `db_user`) are exposed here rather than in the database group.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_name` | `"wikijs"` | `[a-z][a-z0-9-]{0,19}` | The internal identifier for the application. Used as a base name for the Cloud Run service, Artifact Registry repository, Secret Manager secrets, and GCS buckets. Do not change after initial deployment. See [App CloudRun — Group 2](../App_CloudRun/App_CloudRun_Guide.md#group-2-application-identity) for full details. |
| `display_name` | `"Wiki.js"` | Any string | Human-readable name shown in the platform UI, the Cloud Run console, and monitoring dashboards. Equivalent to `application_display_name` in `App CloudRun`. Safe to change at any time without affecting resource names. |
| `application_version` | `"2.5.311"` | Any string | The Wiki.js release tag applied to the container image. Increment to trigger a new build with a newer Wiki.js version. See [App CloudRun — Group 2](../App_CloudRun/App_CloudRun_Guide.md#group-2-application-identity). |
| `db_name` | `"wikijs"` | `[a-z][a-z0-9_]{0,62}` | The name of the PostgreSQL database created within the Cloud SQL instance. Injected into Wiki.js as the `DB_NAME` environment variable. Must match the `DB_NAME` entry in `environment_variables`. **Do not change after initial deployment.** |
| `db_user` | `"wikijs"` | `[a-z][a-z0-9_]{0,31}` | The PostgreSQL user created for the Wiki.js application. Injected as `DB_USER`. Must match the `DB_USER` entry in `environment_variables`. **Do not change after initial deployment.** |

> **Naming note:** `Wikijs CloudRun` uses `display_name` where `App CloudRun` uses `application_display_name`. The variable serves the same purpose and is mapped transparently — this naming difference only matters when comparing the two modules side by side.

---

## Group 3: Runtime & Scaling

All variables are identical in purpose to `App CloudRun`. See [App CloudRun — Group 3](../App_CloudRun/App_CloudRun_Guide.md#group-3-runtime--scaling) for full descriptions.

Note that `Wikijs CloudRun` exposes CPU and memory as **separate top-level variables** (`cpu_limit`, `memory_limit`) rather than nested inside a `container_resources` object as in `App CloudRun`. The behaviour is otherwise identical.

The Wiki.js-specific defaults are:

| Variable | Wikijs CloudRun Default | App CloudRun Default | Notes |
|---|---|---|---|
| `cpu_limit` | `"1000m"` | *(varies)* | 1 vCPU is the minimum for Wiki.js. Increase to `"2000m"` for wikis with heavy concurrent editing. |
| `memory_limit` | `"2Gi"` | *(varies)* | Wiki.js with pg_trgm full-text search and asset handling requires at least 1Gi; 2Gi is recommended for production. |
| `min_instance_count` | `0` | `0` | Scales to zero when idle. Set to `1` in production to eliminate cold start delays for wiki users. |
| `max_instance_count` | `1` | `1` | Increase for wikis with concurrent editors. Note that `max_instance_count` × DB connections must not exceed the Cloud SQL instance's connection limit. |
| `execution_environment` | `"gen2"` | `"gen2"` | Gen2 is required for NFS (Filestore) mounts and GCS Fuse. Do not change. |
| `enable_cloudsql_volume` | `true` | `true` | Required for Wiki.js to connect to PostgreSQL via a Cloud SQL Auth Proxy Unix socket. |
| `enable_image_mirroring` | `true` | `true` | Mirrors `requarks/wiki:2` from Docker Hub into Artifact Registry to avoid rate limits. |

---

## Group 5: Environment Variables & Secrets

All variables are identical in purpose to `App CloudRun`. See [App CloudRun — Group 4](../App_CloudRun/App_CloudRun_Guide.md#group-4-environment-variables--secrets) for full descriptions.

`environment_variables` is pre-populated with the Wiki.js database connection settings that the application reads at startup:

| Variable | Default Value | Purpose |
|---|---|---|
| `DB_TYPE` | `"postgres"` | Tells Wiki.js to use a PostgreSQL backend. Do not change — the module provisions only PostgreSQL. |
| `DB_PORT` | `"5432"` | PostgreSQL port. Matches the Cloud SQL Auth Proxy Unix socket convention. |
| `DB_USER` | `"wikijs"` | Must match `db_user`. |
| `DB_NAME` | `"wikijs"` | Must match `db_name`. |
| `DB_SSL` | `"false"` | SSL is handled by the Cloud SQL Auth Proxy tunnel; the application-level SSL handshake is not needed. |
| `HA_STORAGE_PATH` | `"/wiki-storage"` | The path where Wiki.js reads and writes uploaded assets. Must match the GCS Fuse mount point configured by `Wikijs_Common`. Do not change unless you also reconfigure the GCS volume mount in `Wikijs_Common`. |

`DB_HOST` and `DB_PASSWORD` are injected automatically at runtime. `DB_PASSWORD` is sourced from Secret Manager; `DB_HOST` points to the Cloud SQL Auth Proxy Unix socket.

To add application-level environment variables, add entries to the `environment_variables` map. To supply sensitive values (tokens, API keys), use `secret_environment_variables` instead.

---

## Database Configuration

The PostgreSQL 15 database, database user, and `pg_trgm` extension are provisioned automatically by `Wikijs_Common`. The only database variables directly configurable in `Wikijs CloudRun` are:

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `db_name` | `"wikijs"` | `[a-z][a-z0-9_]{0,62}` | Database name. Passed to `Wikijs_Common` and injected as `DB_NAME`. See Group 2 above. |
| `db_user` | `"wikijs"` | `[a-z][a-z0-9_]{0,31}` | Database username. Passed to `Wikijs_Common` and injected as `DB_USER`. See Group 2 above. |
| `database_password_length` | `16` | Integer `8`–`64` | Length of the randomly generated database password. Increase to `32` for production. For full details see [App CloudRun — Group 11](../App_CloudRun/App_CloudRun_Guide.md#group-11-database-backend). |

The following database variables available in `App CloudRun` are **not exposed** in `Wikijs CloudRun` because they are fixed by the `Wikijs_Common` module: `database_type` (always `POSTGRES_15`), `application_database_name` (set from `db_name`), `application_database_user` (set from `db_user`), `enable_postgres_extensions` (always `true`), `postgres_extensions` (always `["pg_trgm"]`), `enable_mysql_plugins`, `mysql_plugins`.

---

## All Other Configuration Groups

The following groups are available in `Wikijs CloudRun` and behave exactly as documented in the `App CloudRun` guide. The Wiki.js application imposes no additional constraints or defaults on them beyond what is noted in that guide.

| Group | Wikijs CloudRun Variables | App CloudRun Guide Reference |
|---|---|---|
| CI/CD & GitHub Integration | `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages` | [Group 7](../App_CloudRun/App_CloudRun_Guide.md#group-7-cicd--github-integration) |
| Custom SQL Scripts | `enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` | [Group 13](../App_CloudRun/App_CloudRun_Guide.md#group-13-custom-initialisation--sql) |
| Storage & Filesystem — NFS | `enable_nfs`, `nfs_mount_path` | [Group 8](../App_CloudRun/App_CloudRun_Guide.md#group-8-storage--filesystem--nfs) |
| Storage & Filesystem — GCS | `create_cloud_storage`, `storage_buckets`, `gcs_volumes` | [Group 9](../App_CloudRun/App_CloudRun_Guide.md#group-9-storage--filesystem--gcs) |
| Backup & Maintenance | `backup_schedule`, `backup_retention_days`, `enable_backup_import`, `backup_source`, `backup_uri`, `backup_format` | [Group 12](../App_CloudRun/App_CloudRun_Guide.md#group-12-backup--maintenance) |
| Observability & Health | `startup_probe`, `liveness_probe`, `uptime_check_config`, `alert_policies` | [Group 5](../App_CloudRun/App_CloudRun_Guide.md#group-5-observability--health) |
| Jobs & Scheduled Tasks | `initialization_jobs`, `cron_jobs` | [Group 6](../App_CloudRun/App_CloudRun_Guide.md#group-6-jobs--scheduled-tasks) |
| Access & Networking | `ingress_settings`, `vpc_egress_setting` | [Group 14](../App_CloudRun/App_CloudRun_Guide.md#group-14-access--networking) |
| Identity-Aware Proxy | `enable_iap`, `iap_authorized_users`, `iap_authorized_groups` | [Group 15](../App_CloudRun/App_CloudRun_Guide.md#group-15-identity-aware-proxy) |
| Cloud Armor & CDN | `enable_cloud_armor`, `application_domains`, `admin_ip_ranges`, `enable_cdn` | [Group 16](../App_CloudRun/App_CloudRun_Guide.md#group-16-cloud-armor--cdn) |
| Redis Cache | `enable_redis`, `redis_host`, `redis_port`, `redis_auth` | [Group 10](../App_CloudRun/App_CloudRun_Guide.md#group-10-redis-cache) |
| Secrets Management | `secret_propagation_delay`, `secret_rotation_period`, `enable_auto_password_rotation`, `rotation_propagation_delay_sec` | [Group 4](../App_CloudRun/App_CloudRun_Guide.md#group-4-environment-variables--secrets) |
| Service Configuration | `service_annotations`, `service_labels`, `container_protocol`, `cloudsql_volume_mount_path`, `traffic_split` | [Group 3](../App_CloudRun/App_CloudRun_Guide.md#group-3-runtime--scaling) |
| Binary Authorization | `enable_binary_authorization` | [Group 7](../App_CloudRun/App_CloudRun_Guide.md#group-7-cicd--github-integration) |
| VPC Service Controls | `enable_vpc_sc` | [Group 17](../App_CloudRun/App_CloudRun_Guide.md#group-17-vpc-service-controls) |

> **Note on NFS defaults:** `enable_nfs` defaults to `true` in `Wikijs CloudRun`. Wiki.js uses the NFS mount for shared page assets and uploads across container instances. Disabling NFS (`enable_nfs = false`) is only appropriate for single-instance deployments (`max_instance_count = 1`) where instance-local ephemeral storage is acceptable. Setting `max_instance_count > 1` with `enable_nfs = false` will cause asset inconsistency across instances.

---

## Deployment Prerequisites & Dependency Analysis

`Wikijs CloudRun` inherits all prerequisites and dependency requirements from `App CloudRun`. See [App CloudRun — Deployment Prerequisites & Dependency Analysis](../App_CloudRun/App_CloudRun_Guide.md#deployment-prerequisites--dependency-analysis) for the full reference.

The following Wiki.js-specific points supplement that analysis:

### Wiki.js application startup

On first deployment, the `Wikijs_Common` initialisation jobs run before the Cloud Run service begins accepting traffic:

1. **`db-init`** — runs `psql` to create the `wikijs` database schema and installs the `pg_trgm` extension. Requires the Cloud SQL instance and the `wikijs` database user to be fully provisioned. The Cloud Run service will not start until this job completes successfully.
2. The Wiki.js service revision then starts. It connects to PostgreSQL via the Cloud SQL Auth Proxy Unix socket (`/cloudsql`), reads `DB_*` environment variables, and runs its own startup schema migration.

If the `db-init` job fails, the Wiki.js service will fail its startup probe and Cloud Run will not route traffic to it. Check execution logs in **Cloud Run → Jobs** if the deployment appears to hang.

### `db_name` / `db_user` / `environment_variables` consistency

The values of `db_name` and `db_user` (Group 2) must exactly match the `DB_NAME` and `DB_USER` entries in `environment_variables` (Group 5). The module pre-populates all three to `"wikijs"`. If you change any of them, change all of them to match.

### NFS and execution environment

NFS mounts require `execution_environment = "gen2"` (the default). Changing `execution_environment` to `"gen1"` will cause NFS mounts to fail silently, resulting in Wiki.js being unable to store or serve uploaded assets.
