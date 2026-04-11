---
title: "Directus GKE Configuration Guide"
sidebar_label: "GKE"
---

# Directus GKE Module

<video width="100%" controls style={{marginTop: '20px'}} poster="https://storage.googleapis.com/rad-public-2b65/modules/Directus_GKE.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/modules/Directus_GKE.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

<a href="https://storage.googleapis.com/rad-public-2b65/modules/Directus_GKE.pdf" target="_blank">View Presentation (PDF)</a>

`Directus GKE` is a wrapper module that deploys [Directus](https://directus.io/) — an open-source headless CMS and data API platform — on Google Kubernetes Engine (GKE) Autopilot. It composes two underlying modules:

- **[App GKE](../App_GKE/App_GKE_Guide.md)** — provides all GKE infrastructure: cluster targeting, Kubernetes workloads, networking, security, CI/CD, storage, observability, and backup.
- **Directus_Common** — generates the Directus application configuration, database initialisation scripts, migration jobs, and Directus-specific environment variables. Its outputs are injected into `App GKE` via the `application_config`, `module_env_vars`, `module_secret_env_vars`, and `module_storage_buckets` inputs.

> **How to use this guide:** Every variable available in `App GKE` is also available in `Directus GKE` under the same name and with the same behaviour, unless noted below. **For the full description of those variables, consult the [App GKE Configuration Guide](../App_GKE/App_GKE_Guide.md).** This guide documents only what is unique to `Directus GKE`: variables that exist only in this module, variables whose names differ from their `App GKE` equivalents, and variables whose default values have been tuned for Directus.

---

## Standard Configuration Reference

The following configuration groups are provided by the underlying `App GKE` module with no Directus-specific differences. Consult the linked sections of the `App GKE` Configuration Guide for full documentation.

| Group | App GKE Guide Section | Notes |
|---|---|---|
| Module Metadata & Configuration | [Group 0](../App_GKE/App_GKE_Guide.md#group-0-module-metadata--configuration) | Directus-specific `module_description`, `module_documentation`, and `module_services` defaults are pre-set. `resource_creator_identity` is present in this module but not documented in the `App GKE` guide — see [Resource Creator Identity](#resource-creator-identity) below. |
| Project & Identity | [Group 1](../App_GKE/App_GKE_Guide.md#group-1-project--identity) | Identical, plus `deployment_region` which is unique to this module — see [Project & Identity](#project--identity) below. |
| Application Identity | [Group 2](../App_GKE/App_GKE_Guide.md#group-2-application-identity) | Directus-specific defaults; also exposes `db_name`, `db_user`, and `description` — see [Application & Database Identity](#application--database-identity) below. |
| Runtime & Scaling | [Group 3](../App_GKE/App_GKE_Guide.md#group-3-runtime--scaling) | Directus-specific defaults for `container_port`, scaling counts, and `enable_cloudsql_volume`; also exposes `cpu_limit`, `memory_limit`, `startup_probe`, and `liveness_probe` — see [Runtime Configuration](#runtime-configuration) below. |
| Environment Variables & Secrets | [Group 4](../App_GKE/App_GKE_Guide.md#group-4-environment-variables--secrets) | Identical. |
| GKE Backend Configuration | [Group 5](../App_GKE/App_GKE_Guide.md#group-5-gke-backend-configuration) | Identical. |
| Jobs & Scheduled Tasks | [Group 6](../App_GKE/App_GKE_Guide.md#group-6-jobs--scheduled-tasks) | The Directus database migration job is injected automatically by `Directus_Common`; any jobs defined in `initialization_jobs` are appended after it. |
| CI/CD & GitHub Integration | [Group 7](../App_GKE/App_GKE_Guide.md#group-7-cicd--github-integration) | Identical. |
| Storage & Filesystem — NFS | [Group 8](../App_GKE/App_GKE_Guide.md#group-8-storage--filesystem--nfs) | `enable_nfs` defaults to `true` for Directus to support shared asset storage. |
| Storage & Filesystem — GCS | [Group 9](../App_GKE/App_GKE_Guide.md#group-9-storage--filesystem--gcs) | Identical. |
| Database Configuration | [Group 10](../App_GKE/App_GKE_Guide.md#group-10-database-configuration) | Directus-specific defaults for `database_type`, `enable_postgres_extensions`, and `postgres_extensions`; `application_database_name` and `application_database_user` are exposed as `db_name` and `db_user` — see [Database Configuration](#database-configuration) below. |
| Backup Schedule & Retention | [Group 11](../App_GKE/App_GKE_Guide.md#group-11-backup-schedule--retention) | Identical. |
| Custom SQL Scripts | [Group 12](../App_GKE/App_GKE_Guide.md#group-12-custom-sql-scripts) | Identical. |
| Observability & Health | [Group 13](../App_GKE/App_GKE_Guide.md#group-13-observability--health) | Directus exposes `startup_probe` and `liveness_probe` shorthand variables pre-tuned for the `/server/health` endpoint — see [Runtime Configuration](#runtime-configuration) below. |
| Reliability Policies | [Group 14](../App_GKE/App_GKE_Guide.md#group-14-reliability-policies) | Identical. |
| Resource Quota | [Group 15](../App_GKE/App_GKE_Guide.md#group-15-resource-quota) | Identical. |
| Custom Domain, Static IP & Network Configuration | [Group 16](../App_GKE/App_GKE_Guide.md#group-16-custom-domain-static-ip--network-configuration) | Identical. |
| Identity-Aware Proxy | [Group 17](../App_GKE/App_GKE_Guide.md#group-17-identity-aware-proxy) | Identical. |
| Cloud Armor | [Group 18](../App_GKE/App_GKE_Guide.md#group-18-cloud-armor) | Identical. |

---

## Directus-Specific Defaults

The following variables are shared with `App GKE` but have different default values in `Directus GKE`, pre-tuned for a Directus deployment. Where the variable name differs from its `App GKE` equivalent, the `App GKE` name is shown in parentheses.

| Variable | Directus GKE Default | App GKE Default | Reason |
|---|---|---|---|
| `application_name` | `"directus"` | `"gkeapp"` | Identifies the Directus workload across all resource names. |
| `application_version` | `"11.1.0"` | `"1.0.0"` | Pins the Directus container image version. |
| `container_port` | `8055` | `8080` | Directus listens on port 8055 by default. |
| `min_instance_count` | `0` | `1` | Scale-to-zero is the default; set to `1` or more to eliminate cold starts. |
| `max_instance_count` | `8` | `3` | Higher default to accommodate Directus workloads under load. |
| `cpu_limit` (`container_resources.cpu_limit`) | `"2000m"` | `"1000m"` | Directus benefits from 2 vCPU for responsive API generation. |
| `memory_limit` (`container_resources.memory_limit`) | `"2Gi"` | `"512Mi"` | Directus requires at minimum 512Mi; 2Gi is recommended for production. |
| `enable_nfs` | `true` | `true` | Shared NFS storage is used for Directus uploaded assets and media. |
| `enable_cloudsql_volume` | `true` | `true` | Cloud SQL Auth Proxy is required for Directus database connectivity. |
| `database_type` | `"POSTGRES_15"` | `"POSTGRES"` | Directus is optimised for PostgreSQL 15; pinning the version ensures consistency. |
| `enable_postgres_extensions` | `true` | `false` | Directus requires the `uuid-ossp` extension and benefits from PostGIS. |
| `postgres_extensions` | `["uuid-ossp"]` | `[]` | `uuid-ossp` is required for Directus UUID generation. Add `postgis` for geospatial features. |
| `enable_redis` | `true` | N/A | Directus uses Redis for caching and rate limiting. See [Redis Cache](#redis-cache) below. |
| `enable_pod_disruption_budget` | `true` | `true` | Ensures availability during node maintenance. |

---

## Variable Name Differences

Several variables in `Directus GKE` use different names from their `App GKE` equivalents. This is intentional — the Directus module exposes a simplified interface focused on Directus semantics. The mapping is:

| Directus GKE Variable | App GKE Equivalent | Notes |
|---|---|---|
| `db_name` | `application_database_name` | Name of the database created within Cloud SQL. Default: `"directus"`. |
| `db_user` | `application_database_user` | Username of the database user. Default: `"directus"`. |
| `description` | `application_description` | Brief description of the application. |
| `cpu_limit` | `container_resources.cpu_limit` | Top-level convenience variable; overrides the `cpu_limit` field of `container_resources`. |
| `memory_limit` | `container_resources.memory_limit` | Top-level convenience variable; overrides the `memory_limit` field of `container_resources`. |
| `startup_probe` | `startup_probe_config` | Shorthand probe object pre-configured for Directus. See [Runtime Configuration](#runtime-configuration). |
| `liveness_probe` | `health_check_config` | Shorthand probe object pre-configured for Directus. See [Runtime Configuration](#runtime-configuration). |
| `backup_uri` | `backup_file` | URI of the backup file to import. For GCS: `gs://bucket/path/file.sql`. For Google Drive: the file ID. |

---

## Resource Creator Identity

`resource_creator_identity` is a module-metadata variable present in `Directus GKE` that is not documented in the `App GKE` Configuration Guide. It controls which service account Terraform impersonates when provisioning GCP resources in the target project.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `resource_creator_identity` | `"rad-module-creator@tec-rad-ui-2b65.iam.gserviceaccount.com"` | Service account email address | The service account Terraform impersonates when creating and managing GCP resources in the target project. This account must hold the **Owner** role (ideally time-limited and conditional) in the destination project. For production deployments, replace this with a project-scoped service account granted only the minimum permissions required by this module. Setting this to an empty string (`""`) disables impersonation and Terraform uses the executor's credentials directly. |

**Validating Resource Creator Identity:**

**Google Cloud Console:** Navigate to **IAM & Admin → IAM** and filter by the service account email to confirm it exists and holds the expected roles in the project.

**gcloud CLI:**
```bash
# List IAM roles held by the resource creator service account
gcloud projects get-iam-policy PROJECT_ID \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:SERVICE_ACCOUNT_EMAIL" \
  --format="table(bindings.role)"
```

---

## Project & Identity

All variables described in [App GKE Guide — Group 1](../App_GKE/App_GKE_Guide.md#group-1-project--identity) apply to `Directus GKE` unchanged. In addition, `Directus GKE` exposes the following variable that has no equivalent in `App GKE`:

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `deployment_region` | `"us-central1"` | GCP region identifier (e.g. `"us-central1"`, `"europe-west1"`) | Fallback GCP region used when the module's network discovery routine cannot determine the deployment region from existing VPC subnets in the project. The module inspects subnet configurations at apply time and derives the region automatically in most environments. Set this explicitly when (1) the project has no pre-existing subnets and `GCP Services` has not yet been deployed, or (2) the default `"us-central1"` does not match the intended deployment target. If network discovery succeeds, the discovered region takes precedence over this value. |

**Validating Deployment Region:**
```bash
# Confirm the GKE cluster was created in the expected region
gcloud container clusters list --project=PROJECT_ID \
  --format="table(name,location,status)"

# Confirm the Cloud SQL instance is in the expected region
gcloud sql instances list --project=PROJECT_ID \
  --format="table(name,region,state)"
```

---

## Application & Database Identity

The `Directus GKE` module extends the `App GKE` [Group 2 (Application Identity)](../App_GKE/App_GKE_Guide.md#group-2-application-identity) with two additional variables that set the Directus database identity. These map directly to `application_database_name` and `application_database_user` in the underlying `App GKE` module.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `db_name` | `"directus"` | `[a-z][a-z0-9_]{0,62}` | Name of the PostgreSQL database created within the Cloud SQL instance. Injected into the Directus container as the `DB_DATABASE` environment variable. **Do not change after initial deployment** — renaming requires manual data migration. |
| `db_user` | `"directus"` | `[a-z][a-z0-9_]{0,31}` | Username of the database user created for the Directus application. Injected as the `DB_USER` environment variable. The password is auto-generated, stored in Secret Manager, and injected as `DB_PASSWORD`. |

For all other application identity variables (`application_name`, `application_display_name`, `application_version`, `deploy_application`), see [App GKE Guide — Group 2](../App_GKE/App_GKE_Guide.md#group-2-application-identity).

---

## Runtime Configuration

### CPU and Memory

Rather than nesting resource settings inside the `container_resources` object, `Directus GKE` exposes `cpu_limit` and `memory_limit` as top-level variables for convenience. These override the corresponding fields of `container_resources`.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `cpu_limit` | `"2000m"` | Kubernetes CPU string (e.g. `"1000m"`, `"2"`) | Maximum CPU allocated to each Directus pod. `2000m` (2 vCPU) is recommended for production to ensure responsive API generation. For `container_resources.cpu_request`, use the `container_resources` variable directly. |
| `memory_limit` | `"2Gi"` | Kubernetes memory string (e.g. `"1Gi"`, `"4Gi"`) | Maximum memory allocated to each Directus pod. `2Gi` is the recommended minimum for production. Directus loads schema definitions and extension metadata into memory; larger deployments with many collections should increase this value. |

For full resource configuration including `cpu_request`, `mem_request`, and `ephemeral_storage_limit`, use the `container_resources` variable as documented in [App GKE Guide — Group 3](../App_GKE/App_GKE_Guide.md#group-3-runtime--scaling).

### Health Probes

`Directus GKE` exposes two shorthand probe variables pre-configured with Directus-appropriate settings. These are applied in addition to (and take precedence over) the `startup_probe_config` and `health_check_config` structured objects from `App GKE`. All probes target the `/server/health` endpoint, which reflects live Directus application and database connectivity status.

| Variable | Default | Description & Implications |
|---|---|---|
| `startup_probe` | See below | Configures the Kubernetes startup probe used to determine when a newly started Directus pod is ready to receive traffic. Cloud Run will not route requests to the pod until this probe succeeds. |
| `liveness_probe` | See below | Configures the Kubernetes liveness probe that periodically checks whether a running Directus pod remains healthy. A pod is restarted if this probe fails `failure_threshold` consecutive times. |

**`startup_probe` default:**

```hcl
startup_probe = {
  enabled               = true
  type                  = "HTTP"
  path                  = "/server/health"
  initial_delay_seconds = 0
  timeout_seconds       = 10
  period_seconds        = 30
  failure_threshold     = 10  # Allows up to 300 seconds for Directus to start
}
```

The high `failure_threshold` (10 × 30s = 300 seconds) accommodates Directus startup, which includes database migration checks, extension loading, and schema caching. Reduce only if your deployment consistently starts within a shorter window.

**`liveness_probe` default:**

```hcl
liveness_probe = {
  enabled               = true
  type                  = "HTTP"
  path                  = "/server/health"
  initial_delay_seconds = 60
  timeout_seconds       = 5
  period_seconds        = 30
  failure_threshold     = 3
}
```

The `initial_delay_seconds = 60` gives Directus time to complete startup before liveness checks begin. After startup, a pod is considered unhealthy and restarted if `/server/health` fails three consecutive times within 90 seconds.

For the structured probe configuration variables (`startup_probe_config`, `health_check_config`, `uptime_check_config`, `alert_policies`), see [App GKE Guide — Group 13](../App_GKE/App_GKE_Guide.md#group-13-observability--health).

### Validating Runtime Configuration

```bash
# View resource requests, limits, and probe configuration on the Deployment
kubectl describe deployment DIRECTUS_APP_NAME -n NAMESPACE

# Check startup probe status on a running pod
kubectl describe pod POD_NAME -n NAMESPACE | grep -A 10 "Startup:"

# Check liveness probe status on a running pod
kubectl describe pod POD_NAME -n NAMESPACE | grep -A 10 "Liveness:"

# Manually verify the Directus health endpoint
kubectl exec -n NAMESPACE POD_NAME -- curl -sf http://localhost:8055/server/health
```

---

## Database Configuration

`Directus GKE` applies the following defaults that differ from those in `App GKE`. All other database variables (`sql_instance_name`, `sql_instance_base_name`, `database_password_length`, `enable_auto_password_rotation`, `rotation_propagation_delay_sec`) are available with the same names and behaviour as documented in [App GKE Guide — Group 10](../App_GKE/App_GKE_Guide.md#group-10-database-configuration).

| Variable | Directus GKE Default | App GKE Default | Notes |
|---|---|---|---|
| `database_type` | `"POSTGRES_15"` | `"POSTGRES"` | Directus is tested and optimised against PostgreSQL. The version is pinned to `POSTGRES_15` for production consistency. MySQL deployments are supported but PostGIS and some extensions require PostgreSQL. |
| `db_name` | `"directus"` | `"gkeappdb"` | See [Application & Database Identity](#application--database-identity). |
| `db_user` | `"directus"` | `"gkeappuser"` | See [Application & Database Identity](#application--database-identity). |
| `enable_postgres_extensions` | `true` | `false` | Enabled by default so that `uuid-ossp` is installed automatically. |
| `postgres_extensions` | `["uuid-ossp"]` | `[]` | `uuid-ossp` is required by Directus for UUID primary keys. Add `"postgis"` to enable geospatial support for Directus geo fields. |

For the full description of `enable_postgres_extensions`, `postgres_extensions`, `enable_mysql_plugins`, and `mysql_plugins`, see [App GKE Guide — Group 10](../App_GKE/App_GKE_Guide.md#group-10-database-configuration).

---

## Redis Cache

`Directus GKE` exposes Redis configuration as first-class variables. Redis is used by Directus for API response caching and rate limiting, and is enabled by default. This configuration group has no equivalent section in the `App GKE` guide — the underlying `App GKE` module accepts these variables and injects `REDIS_HOST`, `REDIS_PORT`, and optionally `REDIS_AUTH` as environment variables into the Directus pod.

When `enable_redis` is `true` and `redis_host` is left blank, the module defaults to using the NFS server's IP address as the Redis host. This works when a Redis-compatible service (such as Redis installed on a shared NFS VM provisioned by `GCP Services`) is co-located on that same host. For dedicated Redis instances (e.g. Cloud Memorystore), set `redis_host` explicitly.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `true` | `true` / `false` | When `true`, injects `REDIS_HOST` and `REDIS_PORT` environment variables into the Directus pod, and injects `REDIS_AUTH` when `redis_auth` is set. Directus uses these to connect to its caching and rate-limiting backend. When `false`, Directus falls back to in-memory caching, which does not persist across pod restarts and is not shared between replicas — **not suitable for deployments with `max_instance_count` > 1**. |
| `redis_host` | `""` *(defaults to NFS server IP)* | IP address or hostname | The hostname or IP address of the Redis server, injected as `REDIS_HOST`. Leave blank to fall back to the NFS server IP (suitable for single-VM `GCP Services` environments where Redis runs on the NFS host). Set explicitly when using a dedicated instance such as **Cloud Memorystore for Redis** — use the instance's private IP, found at **Memorystore → Redis → *instance* → Primary endpoint**. The GKE pods reach this host via the VPC network; ensure firewall rules permit TCP traffic from the GKE node CIDR to the Redis instance on `redis_port`. |
| `redis_port` | `"6379"` | Port number as string | The TCP port the Redis server listens on, injected as `REDIS_PORT`. The default `6379` is correct for both self-hosted Redis and Cloud Memorystore. Change only if your instance uses a non-standard port. |
| `redis_auth` | `""` *(no authentication)* | Password string *(sensitive)* | Authentication password for the Redis server. When set, this value is stored in Secret Manager and injected securely as `REDIS_AUTH` — it is never stored in plaintext. Leave empty for development environments or instances accessible only within a private VPC where auth is not required. **For production deployments using Cloud Memorystore with AUTH enabled**, set this to the instance's auth string (found at **Memorystore → Redis → *instance* → AUTH string**). Enabling AUTH is strongly recommended for any Redis instance accessible over a network. |

### Validating Redis Configuration

**Google Cloud Console:**
- **Memorystore Redis instance:** Navigate to **Memorystore → Redis** to confirm the instance exists, its IP address, port, and AUTH status.
- **Redis environment variables on pods:** Navigate to **Kubernetes Engine → Workloads → *your workload***, click a pod, and select **Environment** to confirm `REDIS_HOST` and `REDIS_PORT` are present.

**gcloud CLI / kubectl:**
```bash
# List Cloud Memorystore Redis instances
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,tier,memorySizeGb,state,authEnabled)"

# Describe a specific Memorystore instance
gcloud redis instances describe INSTANCE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="yaml(host,port,authEnabled,state)"

# Confirm REDIS_HOST and REDIS_PORT are injected into the Directus pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep REDIS

# Test Redis connectivity from within the cluster (requires redis-cli in the pod)
# kubectl exec -n NAMESPACE POD_NAME -- redis-cli -h REDIS_HOST -p 6379 ping
```

---

## StatefulSet Persistent Storage

When `workload_type` is set to `"StatefulSet"` (see [App GKE Guide — Group 5](../App_GKE/App_GKE_Guide.md#group-5-gke-backend-configuration)), `Directus GKE` exposes additional variables to configure a PersistentVolumeClaim (PVC) for each StatefulSet pod. This provides each pod with its own dedicated persistent storage, independent of the shared NFS volume.

> **Note:** StatefulSet PVCs are appropriate when each Directus replica needs its own local state that must survive pod restarts — for example when running Directus extensions that write to local disk. For shared asset storage across replicas, use `enable_nfs = true` (the default) or `gcs_volumes` instead. If `workload_type` is `"Deployment"` (the default), all StatefulSet PVC variables are ignored.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `stateful_pvc_enabled` | `false` | `true` / `false` | When `true`, a PersistentVolumeClaim is created for each StatefulSet pod using the storage class and size defined below. Each pod receives its own dedicated PVC — data is not shared between pods. Only relevant when `workload_type = "StatefulSet"`. |
| `stateful_pvc_size` | `"10Gi"` | Kubernetes storage quantity string (e.g. `"10Gi"`, `"50Gi"`) | The capacity of the PVC provisioned for each pod. Size based on the local data the pod must persist — for example, Directus extension caches or local database files. Storage costs are incurred per pod, so `max_instance_count` × `stateful_pvc_size` is the total storage consumption. |
| `stateful_pvc_mount_path` | `"/data"` | Filesystem path | The path inside each pod's container where the PVC is mounted. The Directus application (or any extensions) must be configured to write persistent data to this path. Files written outside this path are ephemeral and lost when the pod is replaced. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | Kubernetes StorageClass name | The storage class used to provision each PVC. `"standard-rwo"` is a GKE Autopilot standard class that provisions a regional SSD PersistentDisk with `ReadWriteOnce` access (only one pod can mount the volume at a time). Alternative classes: `"premium-rwo"` (higher IOPS SSD), `"standard"` (zonal standard disk). List available storage classes with `kubectl get storageclasses`. |
| `stateful_headless_service` | `true` | `true` / `false` | When `true`, creates a headless Kubernetes Service alongside the StatefulSet. A headless Service gives each pod a stable DNS name of the form `POD_NAME.SERVICE_NAME.NAMESPACE.svc.cluster.local`, enabling pod-level DNS discovery. This is the standard configuration for StatefulSets and is required if Directus extensions or other services need to address individual pod replicas by name. |
| `stateful_pod_management_policy` | `"OrderedReady"` | `OrderedReady` / `Parallel` | Controls the order in which StatefulSet pods are created and deleted. **`OrderedReady`** (default): pods are started and stopped sequentially — pod `N` must be Running and Ready before pod `N+1` starts. Use for stateful applications where startup order matters, such as database replicas with a primary-replica topology. **`Parallel`**: all pods are started or stopped simultaneously without waiting for each other. Use when startup order does not matter and faster scaling is preferred. |
| `stateful_update_strategy` | `"RollingUpdate"` | `RollingUpdate` / `OnDelete` | Controls how StatefulSet pods are updated when the pod template changes. **`RollingUpdate`** (default): pods are updated one at a time in reverse ordinal order, waiting for each pod to become Ready before continuing. This provides zero-downtime updates. **`OnDelete`**: pods are only updated when manually deleted — the controller does not replace them automatically. Use `OnDelete` when you need full manual control over when individual pods are replaced. |

### Validating StatefulSet Configuration

**Google Cloud Console:**
- **StatefulSet workload:** Navigate to **Kubernetes Engine → Workloads** — the workload type column should show `StatefulSet` rather than `Deployment`.
- **PersistentVolumeClaims:** Navigate to **Kubernetes Engine → Config & Storage → Storage** to confirm individual PVCs have been created per pod (named `PVC_NAME-POD_NAME`).
- **Headless Service:** Navigate to **Kubernetes Engine → Services & Ingress** and confirm a Service with `ClusterIP: None` exists for the StatefulSet.

**kubectl:**
```bash
# Confirm the workload is a StatefulSet and view its status
kubectl get statefulsets -n NAMESPACE -o wide

# View individual pod PVCs (one per pod)
kubectl get pvc -n NAMESPACE

# Describe a PVC to confirm it is bound and view its storage class
kubectl describe pvc PVC_NAME -n NAMESPACE

# Confirm the headless Service exists (ClusterIP should be None)
kubectl get service -n NAMESPACE -o wide

# Verify stable pod DNS names (from within the cluster)
# nslookup POD_NAME.SERVICE_NAME.NAMESPACE.svc.cluster.local
```
