# Temporal GKE Module

The `Temporal_GKE` module deploys [Temporal Workflow Engine](https://temporal.io/) to GKE Autopilot using the official `temporalio/auto-setup` all-in-one image. It provisions all four Temporal services — Frontend, History, Matching, and Worker — in a single pod, backed by Cloud SQL PostgreSQL for persistence and visibility. An optional Elasticsearch integration unlocks advanced visibility for full-text workflow search and custom search attributes.

A separate Temporal Web UI deployment (`ubuntu/temporal-ui`) is always provisioned alongside the server and exposed via its own LoadBalancer service.

---

## 1. Overview

**Purpose**: Deploy a production-ready Temporal Workflow Engine on GKE Autopilot with automatic schema initialisation, App_GKE standard credential management, and an optional Elasticsearch advanced visibility backend.

**Architecture**:

```
Layer 3: Temporal_GKE (this module)
  ├── temporal-db-init (Kubernetes Job — runs before server pod)
  │     └── Creates PostgreSQL role with CREATEDB privilege (postgres:15-alpine)
  └── app_gke (App_GKE)
        ├── Temporal server pod (temporalio/auto-setup)
        │     ├── Cloud SQL Auth Proxy sidecar (127.0.0.1:5432)
        │     └── Shell wrapper maps DB_USER/DB_PASSWORD/DB_NAME → Temporal env vars
        └── Temporal Web UI pod (ubuntu/temporal-ui:2.39.0-24.04_edge)
              └── LoadBalancer Service on port 8081
                       ↓
Layer 2: App_GKE (Kubernetes Deployment, Service, HPA, Workload Identity,
                  Cloud SQL user + database creation, Secret Manager credential)
                       ↓
Layer 1: Services_GCP (VPC, Cloud SQL, GKE Autopilot cluster, Artifact Registry)
```

**Key characteristics**:
- The `temporalio/auto-setup` image runs schema initialisation on first start, then launches all four Temporal services (`frontend,history,matching,worker`). No separate admin-tools init job is needed.
- Database credentials (user, password, DB_USER / DB_PASSWORD / DB_NAME env vars) are managed by App_GKE's standard mechanism — the same as Django, Ghost, and every other module.
- The `temporal-db-init` Kubernetes Job creates the PostgreSQL role with `CREATEDB` privilege before the server pod starts. `auto-setup` then creates the `DBNAME` and `VISIBILITY_DBNAME` databases itself and runs schema migrations.
- The Temporal Frontend gRPC port is hardcoded to **7233** in `main.tf` (`service_port = 7233`). The `container_port` variable has no effect on service exposure.
- The Cloud SQL Auth Proxy sidecar is always injected (`enable_cloudsql_volume = true`). Temporal connects via `127.0.0.1:5432`, and `DB = "postgres12"` tells `auto-setup` to use the PostgreSQL 12 driver/schema.
- Redis is explicitly disabled (`enable_redis = false`). Temporal uses PostgreSQL as its queue and persistence backend.
- The Temporal server `service_type` defaults to **ClusterIP** — SDK workers connect from within the GKE cluster. Use `service_type = "LoadBalancer"` only if external SDK workers need direct gRPC access.
- The Web UI is always added as an `additional_service` with `ingress = "INGRESS_TRAFFIC_ALL"`, giving it an external IP on port **8081**.

---

## 2. Module Composition

`temporal.tf` defines the following locals consumed by `main.tf`:

| Symbol | Purpose |
|---|---|
| `local.temporal_module` | Application config map passed to App_GKE as `application_config` |
| `local.application_modules` | `{ temporal = local.temporal_module }` |
| `local.module_env_vars` | Empty — all env vars are set inside `temporal_module.environment_variables` |
| `local.module_secret_env_vars` | Empty — `DB_PASSWORD` / `ROOT_PASSWORD` are managed by App_GKE's standard mechanism |
| `local.module_storage_buckets` | Empty — Temporal requires no GCS buckets |
| `local.temporal_ui_additional_services` | Web UI deployment spec (always included) |

The `temporal_module` config sets `db_name` and `db_user` to non-empty values so that App_GKE's standard credential management is activated — creating the Secret Manager secret for `DB_PASSWORD` and injecting both `DB_PASSWORD` and `ROOT_PASSWORD` as secret env vars. The actual SQL username (`DB_USER`) is always `replace(App_GKE_resource_prefix, "-", "_")`, matching the convention used by all other modules.

---

## 3. Container Image

| Component | Image | Tag |
|---|---|---|
| Temporal server | `temporalio/auto-setup` | `var.application_version` (default: `1.25.0`) |
| Temporal Web UI | `ubuntu/temporal-ui` | `2.39.0-24.04_edge` (hardcoded) |
| DB init job | `postgres` | `15-alpine` (hardcoded) |

- `enable_image_mirroring = true` by default — the Temporal server image is mirrored from Docker Hub into Artifact Registry before deployment.
- `image_source = "prebuilt"` — no custom Dockerfile is required.
- `NUM_HISTORY_SHARDS` defaults to `4` (suitable for dev/demo); set to `512` or higher for production. **This value cannot be changed after deployment.**

---

## 4. Environment Variables

The Temporal server container is started via a shell wrapper command:

```
/bin/sh -c "export POSTGRES_USER=\"$DB_USER\" && export POSTGRES_PWD=\"$DB_PASSWORD\" && export DBNAME=\"$DB_NAME\" && export VISIBILITY_DBNAME=\"${DB_NAME}_vis\" && exec /etc/temporal/entrypoint.sh"
```

This wrapper maps App_GKE's standard env vars to the Temporal-specific names before exec-ing the entrypoint. Kubernetes `$(VAR)` substitution is not used because `DBNAME` sorts alphabetically before `DB_NAME`, which would prevent the substitution from resolving.

### Static Variables (set in `environment_variables`)

| Variable | Default Value | Description |
|---|---|---|
| `DB` | `"postgres12"` | Tells `auto-setup` to use the PostgreSQL 12+ driver and schema paths |
| `POSTGRES_SEEDS` | `"127.0.0.1"` | Cloud SQL Auth Proxy sidecar address |
| `NUM_HISTORY_SHARDS` | `"4"` | History shard count (power of two; cannot change post-deploy) |
| `SERVICES` | `"frontend,history,matching,worker"` | All four Temporal services in one pod |

### Dynamically Mapped Variables (set by shell wrapper at startup)

| Variable | Source | Description |
|---|---|---|
| `POSTGRES_USER` | `$DB_USER` (injected by App_GKE) | PostgreSQL username |
| `POSTGRES_PWD` | `$DB_PASSWORD` (Secret Manager, via App_GKE) | PostgreSQL password |
| `DBNAME` | `$DB_NAME` (injected by App_GKE) | Primary persistence database name |
| `VISIBILITY_DBNAME` | `${DB_NAME}_vis` | Visibility database name (derived from primary) |

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

The Web UI is deployed unconditionally as a `temporal_ui_additional_services` entry that is concatenated with any user-supplied `additional_services`.

| Aspect | Value |
|---|---|
| Image | `ubuntu/temporal-ui:2.39.0-24.04_edge` |
| Port | `8081` |
| Service type | `LoadBalancer` (via `ingress = "INGRESS_TRAFFIC_ALL"`) |
| Scaling | `min_instance_count = 1`, `max_instance_count = 1` |
| CPU / Memory | `500m` / `256Mi` |
| gRPC backend | Resolved from `GKE_SERVICE_URL` injected by App_GKE — the scheme is stripped to produce `<service-fqdn>:7233` |

The startup command writes a minimal `development.yaml` config before exec-ing the UI binary:
```
temporalGrpcAddress: <service-fqdn>:7233
port: 8081
enableUi: true
defaultNamespace: default
auth:
  enabled: false
```

Authentication for the Web UI is disabled by default. Use `iap_authorized_users` / `iap_authorized_groups` with `enable_iap = true` if access control is required (note that IAP is not recommended for the main Temporal gRPC port).

---

## 6. Health Probes

TCP probes are used for both the startup and liveness checks because Temporal Frontend exposes gRPC (not HTTP/1.1) on port 7233.

| Probe | Type | Initial Delay | Period | Failure Threshold |
|---|---|---|---|---|
| Startup | TCP | 30s | 10s | 90 (15-minute window for schema init) |
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
| `temporal_db_user` | PostgreSQL username (from App_GKE `database_user` output) |
| `temporal_db_name` | Primary persistence database name (from App_GKE `database_name` output) |
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
| `service_type` | `string` | `"ClusterIP"` | Kubernetes Service type for the Temporal Frontend. Use `ClusterIP` for cluster-internal SDK workers (recommended — the Web UI is exposed separately via its own LoadBalancer). Use `LoadBalancer` only if SDK workers need to connect from outside the cluster. |
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

Database provisioning follows the same pattern as Django, Ghost, and all other modules:

1. **App_GKE** creates the Cloud SQL user and database, and injects `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and `ROOT_PASSWORD` into the pod and jobs.
2. **`temporal-db-init` job** (runs before the server pod) connects as the `postgres` superuser using `ROOT_PASSWORD` and creates the Temporal PostgreSQL role with `CREATEDB` privilege.
3. **`temporalio/auto-setup`** connects as `DB_USER` (remapped to `POSTGRES_USER` by the shell wrapper) and creates the `DBNAME` and `VISIBILITY_DBNAME` databases, then runs all schema migrations.

The database name and username are always derived from the App_GKE resource prefix (`replace(resource_prefix, "-", "_")`), ensuring consistent naming with all other GKE modules.

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
