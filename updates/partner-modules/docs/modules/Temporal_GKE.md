# Temporal GKE Module

The `Temporal_GKE` module deploys [Temporal Workflow Engine](https://temporal.io/) to GKE Autopilot using the official `temporalio/auto-setup` all-in-one image. It provisions all four Temporal services — Frontend, History, Matching, and Worker — in a single pod, backed by Cloud SQL PostgreSQL for persistence and visibility. An optional Elasticsearch integration unlocks advanced visibility for full-text workflow search and custom search attributes.

A Temporal Web UI can be optionally added via the `additional_services` variable.

---

## 1. Overview

**Purpose**: Deploy a production-ready Temporal Workflow Engine on GKE Autopilot with automatic schema initialisation, App GKE standard credential management, and an optional Elasticsearch advanced visibility backend.

**Architecture**:

```
Layer 3: Temporal_GKE (this module)
  ├── temporal-db-init (Kubernetes Job — runs before server pod)
  │     └── Creates PostgreSQL role with CREATEDB privilege (postgres:15-alpine)
  └── app_gke (App_GKE)
        └── Temporal server pod (temporalio/auto-setup)
              └── Connects directly to Cloud SQL via private IP (no Auth Proxy sidecar)
                       ↓
Layer 2: App_GKE (Kubernetes Deployment, Service, HPA, Workload Identity,
                  Secret Manager credential management)
                       ↓
Layer 1: Services_GCP (VPC, Cloud SQL, GKE Autopilot cluster, Artifact Registry)
```

**Key characteristics**:
- The `temporalio/auto-setup` image runs schema initialisation on first start, then launches all four Temporal services (`frontend,history,matching,worker`). No separate admin-tools init job is needed.
- Database credentials (user, password, DB_USER / DB_PASSWORD / DB_NAME env vars) are managed by App GKE's standard mechanism — the same as Django, Ghost, and every other module.
- The `temporal-db-init` Kubernetes Job creates the PostgreSQL role with `CREATEDB` privilege before the server pod starts. `auto-setup` then creates the `DBNAME` and `VISIBILITY_DBNAME` databases itself and runs schema migrations.
- The Temporal Frontend gRPC port is hardcoded to **7233** in `main.tf` (`service_port = 7233`). The `container_port` variable has no effect on service exposure.
- **No Cloud SQL Auth Proxy sidecar** — `enable_cloudsql_volume = false`. Temporal connects directly to Cloud SQL via the private IP discovered by the `sql_discovery` sub-module (`POSTGRES_SEEDS = <db_internal_ip>`). `DB = "postgres12"` tells `auto-setup` to use the PostgreSQL 12 driver/schema.
- Redis is explicitly disabled (`enable_redis = false`). Temporal uses PostgreSQL as its queue and persistence backend.
- The Temporal server `service_type` defaults to **ClusterIP** — SDK workers connect from within the GKE cluster. Use `service_type = "LoadBalancer"` only if external SDK workers need direct gRPC access.
- No Web UI is deployed automatically. Use the `additional_services` variable to add a Temporal Web UI container if desired.

---

## 2. Module Composition

`temporal.tf` defines the following locals consumed by `main.tf`:

| Symbol | Purpose |
|---|---|
| `local.temporal_module` | Application config map passed to App GKE as `application_config` |
| `local.application_modules` | `{ temporal = local.temporal_module }` |
| `local.module_env_vars` | Empty — all env vars are set inside `temporal_module.environment_variables` |
| `local.module_secret_env_vars` | Empty — `DB_PASSWORD` / `ROOT_PASSWORD` are managed by App GKE's standard mechanism |
| `local.module_storage_buckets` | Empty — Temporal requires no GCS buckets |

The `temporal_module` config sets `db_name = ""` and `db_user = ""` so App GKE's standard Cloud SQL database creation is skipped. Database and user provisioning is handled entirely by `Temporal Common` (which creates its own Secret Manager secret for the password). The secret is injected via `module_secret_env_vars = module.temporal_common.secret_ids`.

---

## 3. Container Image

| Component | Image | Tag |
|---|---|---|
| Temporal server | `temporalio/auto-setup` | `var.application_version` (default: `1.25.0`) |
| DB init job | `postgres` | `15-alpine` (hardcoded) |

- `enable_image_mirroring = true` by default — the Temporal server image is mirrored from Docker Hub into Artifact Registry before deployment.
- `image_source = "prebuilt"` — no custom Dockerfile is required.
- `NUM_HISTORY_SHARDS` defaults to `4` (suitable for dev/demo); set to `512` or higher for production. **This value cannot be changed after deployment.**

---

## 4. Environment Variables

The Temporal server environment variables are set directly in `environment_variables` within `temporal.tf`. There is no shell wrapper — all variables are passed as Kubernetes env vars.

### Static Variables (set in `environment_variables`)

| Variable | Default Value | Description |
|---|---|---|
| `DB` | `"postgres12"` | Tells `auto-setup` to use the PostgreSQL 12+ driver and schema paths |
| `POSTGRES_SEEDS` | `module.sql_discovery.db_internal_ip` | Cloud SQL private IP (auto-discovered from Services GCP) |
| `POSTGRES_USER` | `var.temporal_db_user` | PostgreSQL username (from `temporal_db_user` variable) |
| `DBNAME` | `var.temporal_database_name` | Primary persistence database name |
| `VISIBILITY_DBNAME` | `var.temporal_visibility_database_name` | Visibility database name |
| `NUM_HISTORY_SHARDS` | `"4"` | History shard count (power of two; cannot change post-deploy) |
| `SERVICES` | `"frontend,history,matching,worker"` | All four Temporal services in one pod |
| `SQL_TLS_ENABLED` | `"true"` | Enables TLS for direct Cloud SQL connections |
| `POSTGRES_TLS_ENABLED` | `"true"` | Enables TLS in schema migration tool |
| `POSTGRES_TLS_DISABLE_HOST_VERIFICATION` | `"true"` | Skips host verification (Cloud SQL CA cert not available in pod) |

The `POSTGRES_PWD` is injected via `module_secret_env_vars` from `Temporal Common`'s Secret Manager secret.

### Elasticsearch Variables (when `enable_elasticsearch = true`)

| Variable | Source | Description |
|---|---|---|
| `ENABLE_ES` | `"true"` | Activates Elasticsearch advanced visibility |
| `ES_SEEDS` | Parsed from `elasticsearch_url` (host only, no scheme/port) | Elasticsearch cluster host |
| `ES_PORT` | Parsed from `elasticsearch_url` | Elasticsearch cluster port (default `9200`) |
| `ES_VERSION` | `var.elasticsearch_version` (`"v7"` or `"v8"`) | Elasticsearch major version |
| `ES_INDICES_VISIBILITY` | `var.elasticsearch_index_visibility` (default `"temporal_visibility_v1"`) | Index name for advanced visibility |

---

## 5. Temporal Web UI

No Temporal Web UI is deployed automatically by this module. To add a Web UI, pass a configuration entry via the `additional_services` variable. A typical example using `ubuntu/temporal-ui`:

```hcl
additional_services = [
  {
    name         = "temporal-ui"
    image        = "ubuntu/temporal-ui:2.39.0-24.04_edge"
    port         = 8081
    cpu_limit    = "500m"
    memory_limit = "256Mi"
    env_vars = {
      TEMPORAL_ADDRESS = "<temporal-frontend-service>:7233"
      TEMPORAL_UI_PORT = "8081"
    }
    min_instance_count = 1
    max_instance_count = 1
    ingress            = "INGRESS_TRAFFIC_ALL"
  }
]
```

Replace `<temporal-frontend-service>` with the Kubernetes Service name of the Temporal frontend (available from the `service_name` output).

---

## 6. Health Probes

TCP probes are used for both the startup and liveness checks because Temporal Frontend exposes gRPC (not HTTP/1.1) on port 7233.

| Probe | Type | Initial Delay | Period | Failure Threshold |
|---|---|---|---|---|
| Startup | TCP | 30s | 10s | 60 (10-minute window for schema init) |
| Liveness | TCP | 60s | 30s | 3 |

The Web UI uses HTTP GET `/` probes on port 8081.

---

## 7. Outputs

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name for the Temporal server |
| `service_url` | Cluster-internal service URL (ClusterIP by default) |
| `service_external_ip` | External IP (non-null only when `service_type = "LoadBalancer"`) |
| `temporal_frontend_address` | `<service-url>:7233` — the gRPC address for SDK workers |
| `namespace` | Kubernetes namespace |
| `project_id` | GCP project ID |
| `deployment_id` | Deployment identifier used for all resource names |
| `temporal_db_user` | PostgreSQL username (from App GKE `database_user` output) |
| `temporal_db_name` | Primary persistence database name (from App GKE `database_name` output) |
| `temporal_visibility_db_name` | Visibility database name (`<temporal_db_name>_vis`) |
| `temporal_db_password_secret_id` | Secret Manager secret name for the database password |
| `storage_buckets` | Always empty |
| `container_image` | Resolved container image URI (after mirroring) |
| `kubernetes_ready` | `true` once the GKE cluster endpoint is available and Kubernetes resources are deployed |
| `cicd_enabled` | Whether CI/CD pipeline is active |
| `github_repository_url` | Connected GitHub repository (if CI/CD is enabled) |

---

## 8. Key Variables

### Application & Runtime

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_version` | `string` | `"1.25.0"` | Temporal server image tag. Pin to a specific version; schema migrations must be run before upgrading. |
| `num_history_shards` | `number` | `4` | History shard count. Must be a power of two. **Cannot be changed after first deployment.** Use 4 for dev/demo, 512+ for production. |
| `min_instance_count` | `number` | `1` | Minimum replica count for the Temporal server pod. |
| `max_instance_count` | `number` | `1` | Maximum replica count. |
| `cpu_limit` | `string` | `"2000m"` | CPU limit for the all-in-one container (all four services share this). |
| `memory_limit` | `string` | `"4Gi"` | Memory limit for the all-in-one container. |
| `deploy_application` | `bool` | `true` | Set `false` to provision databases and secrets without deploying pods. |
| `deployment_timeout` | `number` | `1800` | Seconds Terraform waits for the Deployment rollout. Default 30 min covers Autopilot node provisioning (~10 min) plus schema init (~5 min) on first deploy. |

### Networking

| Variable | Type | Default | Description |
|---|---|---|---|
| `service_type` | `string` | `"ClusterIP"` | Kubernetes Service type for the Temporal Frontend. Use `ClusterIP` for cluster-internal SDK workers (recommended). Use `LoadBalancer` only if SDK workers need to connect from outside the cluster. |
| `container_protocol` | `string` | `"h2c"` | HTTP/2 cleartext — required for gRPC. |
| `timeout_seconds` | `number` | `300` | Backend response timeout for the load balancer. |

### Elasticsearch (Advanced Visibility)

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_elasticsearch` | `bool` | `false` | Enables Elasticsearch advanced visibility. |
| `elasticsearch_url` | `string` | `""` | Elasticsearch endpoint. Accepts `http://host:9200` or `host:9200`. Required when `enable_elasticsearch = true`. |
| `elasticsearch_version` | `string` | `"v7"` | `"v7"` or `"v8"`. Must match the actual cluster version. |
| `elasticsearch_index_visibility` | `string` | `"temporal_visibility_v1"` | Index name; auto-created by `auto-setup` on first start. |

### Database

| Variable | Type | Default | Description |
|---|---|---|---|
| `application_database_name` | `string` | `"none"` | Passed through to App GKE. The actual Temporal database name is always derived from the deployment resource prefix; this value does not override it. |
| `application_database_user` | `string` | `"none"` | Passed through to App GKE. The actual Temporal database user is always derived from the deployment resource prefix; this value does not override it. |
| `database_password_length` | `number` | `32` | Length in characters of the randomly generated database user password. Valid range: 16–64 characters. |

### Reliability

| Variable | Type | Default | Description |
|---|---|---|---|
| `enable_pod_disruption_budget` | `bool` | `true` | Creates a PodDisruptionBudget (recommended for production). |
| `pdb_min_available` | `string` | `"1"` | Minimum pods available during node disruptions. |
| `enable_vertical_pod_autoscaling` | `bool` | `false` | Enables VPA for the Temporal server deployment. |

---

## 9. Deployment Notes

### Database Initialisation

Database provisioning for Temporal uses a dedicated `Temporal Common` sub-module rather than App GKE's standard mechanism:

1. **`Temporal Common`** creates the Cloud SQL user (`temporal_db_user`), both databases (`temporal_database_name` and `temporal_visibility_database_name`), and the Secret Manager secret for the database password.
2. **`temporal-db-init` job** (runs before the server pod) connects as the `postgres` superuser and creates the Temporal PostgreSQL role with `CREATEDB` privilege, so that `auto-setup` can create the databases itself.
3. **`temporalio/auto-setup`** connects as `POSTGRES_USER` (set from `var.temporal_db_user`) directly to the Cloud SQL private IP and creates the `DBNAME` and `VISIBILITY_DBNAME` databases, then runs all schema migrations.

Because `Temporal Common` manages its own credentials, `db_name = ""` and `db_user = ""` are passed to `App GKE`, and `enable_cloudsql_volume = false` — the Cloud SQL Auth Proxy is not used.

### Schema Initialisation

`temporalio/auto-setup` performs schema detection on every startup:
- If no schema exists, it creates and migrates both the default and visibility schemas.
- If the schema is already at the current version, startup proceeds immediately.
- Schema migrations are run before any Temporal services begin accepting connections.

### Upgrading Temporal Version

1. Update `application_version` to the target tag.
2. Review the [Temporal release notes](https://github.com/temporalio/temporal/releases) for breaking schema changes.
3. `auto-setup` applies any pending schema migrations automatically on the next startup.
4. For large deployments, run `temporal-sql-tool update-schema` manually before updating the deployment to avoid extended startup latency.

### Connecting SDK Workers

SDK workers connect to the Temporal Frontend gRPC address:

```go
// Go SDK example
c, err := client.Dial(client.Options{
    HostPort: "<temporal_frontend_address>", // e.g., "apptemporaldemod1a2b3c:7233"
})
```

For workers running inside the same GKE cluster, use `temporal_frontend_address` output directly. For workers outside the cluster, set `service_type = "LoadBalancer"` and use `service_external_ip:7233`.

### Namespace Management

Temporal uses its own internal namespace concept (not Kubernetes namespaces). The `default` Temporal namespace is created automatically by `auto-setup`. Additional namespaces can be created with:

```bash
kubectl exec -n <k8s-namespace> deploy/<app-name> -- \
  temporal operator namespace create my-namespace
```

---

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `num_history_shards` | `4` (dev/demo), `512`+ (production) | **Critical** | **Permanently immutable after first deploy.** The shard count is written into the Temporal database schema during initialisation. Changing it requires a full data wipe and re-initialisation — all in-flight and historical workflow data is lost. Set correctly before the first `tofu apply`. Use `512` or higher for any production deployment. |
| `application_database_name` | `temporal` | **Critical** | Hardcoded in the schema initialisation job. Changing this after first deploy orphans the existing schema and causes Temporal server to start with an uninitialised database, crashing on every boot. |
| `db_visibility_name` | `temporal_visibility` | **Critical** | Temporal's visibility store is initialised separately from the main database. Changing this after first deploy causes Temporal to lose all workflow search/filter capability and fail to write execution records, breaking the Temporal Web UI. |
| `db_user` | `temporal` | **High** | Both `temporal` and `temporal_visibility` databases share this user. Changing the user after deploy without updating the Cloud SQL IAM grants and Secret Manager password causes all Temporal server connections to fail with authentication errors. |
| `container_protocol` | `h2c` | **Critical** | Temporal uses gRPC for all inter-service and client-to-server communication. Changing to `http1` breaks gRPC entirely — SDK workers cannot connect, workflow execution stops, and the Temporal Web UI becomes non-functional. h2c (HTTP/2 cleartext) is mandatory. |
| `postgres_instance_name` | Auto-discovered from Services GCP | **Critical** | Must not be empty. If Services GCP has not been deployed first, or its Cloud SQL instance is not labelled `managed-by=services-gcp`, Temporal Common cannot resolve the instance name and the plan fails immediately. |
| `enable_elasticsearch` | `false` | **Medium** | When set to `true`, `elasticsearch_url` must point to a reachable Elasticsearch 7.x or 8.x endpoint before Temporal starts. An unreachable endpoint causes Temporal to crash on startup — it does not fall back to PostgreSQL visibility. |
| `elasticsearch_url` | `""` | **High** | Required when `enable_elasticsearch = true`. An empty value with Elasticsearch enabled causes Temporal server to start without a valid visibility store URL, crashing immediately. Format must be `host:port` or `http://host:port`. |
| `elasticsearch_version` | `"v7"` | **High** | Must match the actual Elasticsearch cluster version (`v7` for 7.x, `v8` for 8.x). A mismatch causes Temporal's index management to use incompatible mappings, resulting in visibility write failures and missing workflow entries. |
| `elasticsearch_index_visibility` | `"temporal_visibility_v1"` | **Medium** | Temporal auto-creates this index on first start. Changing the name after initial deployment means the new index is empty — all historical visibility data is in the old index and cannot be queried. |
| `min_instance_count` | `1` | **High** | Setting to `0` allows scale-to-zero. Temporal requires at least one running pod at all times to process workflow timers, activity retries, and heartbeats. Scale-to-zero causes missed timers and stalled workflows. |
| `cpu_limit` | `2000m` | **High** | Temporal's all-in-one mode runs history, matching, frontend, and worker services in a single process. Insufficient CPU (below 1000m) causes high scheduling latency and timer fires to be delayed, directly impacting workflow SLAs. |
| `memory_limit` | `2Gi` | **High** | Temporal holds shard state in memory proportional to `num_history_shards`. With the default 4 shards and a modest workflow load, 1Gi is the absolute minimum; 2Gi is the recommended starting point for production. |
| `quota_memory_requests` / `quota_memory_limits` | `"4Gi"` / `"8Gi"` | **Critical** | Must use binary unit suffixes (e.g., `"4Gi"`, `"8192Mi"`). A bare integer is treated as bytes by Kubernetes, sets an effectively zero quota, and immediately blocks all pod scheduling. |
| `stateful_pvc_enabled` | `false` | **High** | Temporal stores all durable state in Cloud SQL PostgreSQL. Enabling PVCs adds persistent storage that is never written by Temporal, wastes resources, and can cause pod scheduling failures on Autopilot when disk quota is not available. |
| `enable_cloudsql_volume` | `true` | **Critical** | Must be `true`. Temporal connects to Cloud SQL via the Auth Proxy Unix socket. Setting to `false` causes all database connections to fail and Temporal to crash on startup. Direct private IP is not used — only the socket path. |
| `backup_schedule` | `"0 2 * * *"` | **Medium** | An empty string disables automated database backups. Without backups, a Cloud SQL failure or accidental schema mutation cannot be recovered without data loss. Always configure a schedule before go-live. |
| `enable_pod_disruption_budget` | `true` | **Medium** | Disabling PDB means GKE node upgrades can evict all Temporal pods simultaneously, causing a full service interruption including dropped gRPC connections from all SDK workers. |
| `workload_type` | `"Deployment"` | **Medium** | Temporal is stateless at the pod level (state is in PostgreSQL). Using `StatefulSet` is not recommended and provides no benefit; it adds complexity around pod identity and PVC management. |
| `session_affinity` | `false` | **Low** | Temporal gRPC connections use long-lived streams managed by the SDK. Session affinity is not required and can cause uneven pod load distribution. Leave disabled. |
| `enable_vpc_sc` | `false` | **High** | Requires explicit `organization_id`. Without it, VPC Service Controls are silently skipped, giving a false sense of perimeter security. |
| `enable_auto_password_rotation` | `false` | **Medium** | When enabled, the Cloud SQL password is rotated on a schedule. The Temporal pod must be restarted after rotation to pick up the new Secret Manager version; without a restart, Temporal continues with the old (now invalid) password until connections fail. |

## 10. Variable Reference (All Groups)

Variables are organised into UIMeta groups for platform UI rendering:

| Group | Section | Key Variables |
|---|---|---|
| 0 | Module Metadata | `module_description`, `module_dependency`, `credit_cost`, `public_access`, `shared_users`, `deployment_id` |
| 1 | Project & Identity | `project_id`, `region` |
| 2 | Deployment Identity | `tenant_deployment_id`, `support_users`, `resource_labels` |
| 3 | Application | `application_name`, `application_version`, `application_display_name` |
| 4 | Runtime & Scaling | `deploy_application`, `min_instance_count`, `max_instance_count`, `cpu_limit`, `memory_limit`, `container_protocol`, `enable_image_mirroring` |
| 5 | Env Vars & Secrets | `environment_variables`, `secret_environment_variables` |
| 6 | GKE Backend | `service_type`, `workload_type`, `namespace_name`, `gke_cluster_name`, `session_affinity`, `enable_network_segmentation` |
| 7 | StatefulSet | `stateful_pvc_enabled` *(not recommended for Temporal)* |
| 8 | Resource Quota | `enable_resource_quota`, `quota_memory_requests`, `quota_memory_limits` |
| 9 | Reliability | `enable_pod_disruption_budget`, `pdb_min_available`, `enable_topology_spread` |
| 10 | Observability | `health_check_config`, `startup_probe_config`, `uptime_check_config`, `alert_policies` |
| 11 | Workload Automation | `initialization_jobs`, `cron_jobs`, `additional_services` |
| 12 | CI/CD | `enable_cicd_trigger`, `github_repository_url`, `enable_cloud_deploy` |
| 13 | NFS | `enable_nfs` *(not required for Temporal)* |
| 14 | Cloud Storage | `create_cloud_storage` *(not required for Temporal)*, `max_images_to_retain` |
| 15 | Database & Temporal-Specific | `application_database_name`, `application_database_user`, `database_password_length`, `num_history_shards`, `enable_elasticsearch`, `elasticsearch_url`, `elasticsearch_version`, `elasticsearch_index_visibility` |
| 16 | Secret Rotation | `enable_auto_password_rotation` |
| 17 | Backup | `backup_schedule`, `backup_retention_days` |
| 19 | Custom Domain / Static IP | `enable_custom_domain`, `application_domains`, `reserve_static_ip` |
| 20 | Access & IAP | `enable_iap`, `iap_authorized_users`, `iap_authorized_groups` |
| 21 | Cloud Armor / CDN | `enable_cloud_armor`, `cloud_armor_policy_name` |
| 22 | VPC Service Controls | `enable_vpc_sc`, `organization_id` |
