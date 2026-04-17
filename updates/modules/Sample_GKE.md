# Sample_GKE Module — Configuration Guide

`Sample_GKE` is a **wrapper module** that sits on top of [`App_GKE`](../App_GKE/App_GKE.md). It deploys a pre-configured reference Flask application (Python 3.11, PostgreSQL 15, optional Redis, optional NFS) on GKE Autopilot. Its purpose is to serve as a working example of how to build a custom application module on top of `App_GKE`.

Most configuration variables in `Sample_GKE` are passed through unchanged to `App_GKE`. For the meaning, options, validation steps, and `gcloud` CLI commands for any variable that appears in `App_GKE`, refer to the [App_GKE Configuration Guide](../App_GKE/App_GKE.md). This guide documents only what is **unique to `Sample_GKE`**: its layered architecture, the pre-configured application it ships, and the specific behaviours it imposes on top of `App_GKE`.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## Module Architecture

`Sample_GKE` composes two internal layers:

```
Sample_GKE
├── Sample_Common  (application layer — Flask app, secrets, db-init job, Redis service)
└── App_GKE        (infrastructure layer — GKE Autopilot, Cloud SQL, NFS, networking, CI/CD)
```

**`Sample_Common`** is a shared internal module that produces the application-specific configuration object (`application_config`) consumed by `App_GKE`. It is responsible for:

- Generating a random 32-character Flask `SECRET_KEY` and storing it in Secret Manager.
- Defining a `db-init` Kubernetes Job (using `postgres:15-alpine`) that runs the bundled database initialisation script (`scripts/db-init.sh`) on first deployment.
- Optionally defining an internal Redis additional service (using `redis:alpine`) when `enable_redis = true`.
- Providing a custom Cloud Build configuration that builds the sample Flask application from the bundled Dockerfile in `Sample_Common/scripts/`.

**`App_GKE`** receives the merged configuration from `Sample_Common` and provisions all GCP and Kubernetes infrastructure: the GKE cluster, Cloud SQL instance, NFS PersistentVolume, Artifact Registry repository, Secret Manager secrets, IAM bindings, networking, CI/CD pipelines, and observability resources.

You do not interact with `Sample_Common` directly. All inputs are exposed as variables on `Sample_GKE` itself.

---

## Pre-configured Application

When deployed with default settings, `Sample_GKE` provides:

| Component | Details |
|---|---|
| **Application framework** | Flask (Python 3.11-slim), listening on port `8080` |
| **Container image source** | `custom` — built from the bundled Dockerfile via Cloud Build |
| **Database** | PostgreSQL 15, with a `db-init` Kubernetes Job that runs on first deployment |
| **Secret** | `SECRET_KEY` — auto-generated 32-character random string, stored in Secret Manager, injected as the `SECRET_KEY` environment variable |
| **Redis** | Optional — when `enable_redis = true`, an internal Redis (`redis:alpine`) additional service is deployed alongside the application |
| **NFS** | Optional — when `enable_nfs = true`, a shared NFS volume is mounted at `nfs_mount_path` |

The `db-init` job and the `SECRET_KEY` secret are managed entirely by the module. You do not need to pre-create them.

---

## Behaviours Unique to Sample_GKE

### 1. Minimum Instance Count Override

The `min_instance_count` variable is exposed so you can tune it, but `Sample_GKE` internally overrides the value passed to `App_GKE` to be at least `1`:

```terraform
# sample.tf
sample_module = merge(module.sample_app.config, {
  min_instance_count = 1  # Always keep at least 1 pod warm
})
```

**Why:** Unlike Cloud Run, GKE Autopilot does not natively support true scale-to-zero for standard Deployments. Setting `min_instance_count = 1` ensures at least one pod is always ready to serve traffic without a cold-start delay. If you set `min_instance_count = 0` in your configuration, the module overrides it to `1` internally.

### 2. Redis Host Fallback to Sidecar (`127.0.0.1`)

When `enable_redis = true` and `redis_host` is not set (or is empty), `Sample_GKE` injects `REDIS_HOST=127.0.0.1` into the application:

```terraform
# sample.tf
REDIS_HOST = var.enable_redis ? (
  var.redis_host != null && var.redis_host != "" ? var.redis_host : "127.0.0.1"
) : ""
```

**Why:** In GKE, the Redis additional service (a separate `redis:alpine` Deployment) runs within the cluster. Using `127.0.0.1` as the fallback host is appropriate for configurations where Redis runs locally alongside the application. For an external Redis instance (e.g. Cloud Memorystore), set `redis_host` explicitly to the instance's private IP address.

**Contrast with `Sample_CloudRun`:** Cloud Run does not support pod-level co-location, so `Sample_CloudRun` does **not** fall back to `127.0.0.1` — you must always provide an explicit `redis_host` when using Redis with Cloud Run.

### 3. Explicit Secret Value Injection (`explicit_secret_values`)

`Sample_GKE` passes the raw value of the Flask `SECRET_KEY` directly to `App_GKE` via the `explicit_secret_values` mechanism:

```terraform
# main.tf
explicit_secret_values = {
  SECRET_KEY = module.sample_app.secret_values["FLASK_SECRET_KEY"]
}
```

**Why:** When a Secret Manager secret is created and then immediately referenced by a Kubernetes workload in the same Terraform apply, there is a read-after-write consistency window during which the secret version may not yet be globally available. By passing the raw value directly, `App_GKE` can create the Kubernetes Secret object without needing to read back from Secret Manager on the first apply. On subsequent applies, the secret is already present and this mechanism has no visible effect.

This is a GKE-specific pattern. `Sample_CloudRun` does not use `explicit_secret_values` because Cloud Run fetches secrets from Secret Manager at instance startup (after propagation is complete), avoiding this timing issue.

### 4. Resource Naming (`resource_prefix`)

`Sample_GKE` computes a deterministic `resource_prefix` and passes it to `Sample_Common` so that the Flask `SECRET_KEY` secret name is aligned with the naming convention used by `App_GKE` for all other resources:

```terraform
resource_prefix = "app${var.application_name}${var.tenant_deployment_id}${local.random_id}"
```

This ensures the Secret Manager secret created by `Sample_Common` is named consistently with the secrets, Cloud SQL instance, GCS buckets, and Kubernetes resources created by `App_GKE`. You do not need to set this — it is computed automatically.

---

## Configuration Reference

All configuration variables in `Sample_GKE` are passed through to `App_GKE`. The table below maps each configuration group to the corresponding section of the `App_GKE` Configuration Guide, noting any `Sample_GKE`-specific defaults or overrides.

| Group | Description | Sample_GKE Defaults / Overrides | Reference |
|---|---|---|---|
| **Group 0** | Module Metadata & Configuration | `module_description` defaults to `"Sample_GKE: A sample application module…"`. `module_documentation` points to the GKE App docs URL. `module_services` includes GKE Autopilot, Cloud Build, Artifact Registry, Cloud SQL, Filestore (NFS), Secret Manager, Workload Identity, Cloud Monitoring, and Uptime Checks. All other variables are identical to `App_GKE`. | [App_GKE §1 Module Overview](../App_GKE/App_GKE.md#1-module-overview) |
| **Group 1** | Project & Identity | No changes. `project_id`, `tenant_deployment_id`, `support_users`, `resource_labels`, and `resource_creator_identity` behave identically to `App_GKE`. | [App_GKE §2 IAM & Access Control](../App_GKE/App_GKE.md#2-iam--access-control) |
| **Group 2** | Application Identity | `application_name` defaults to `"sample"`. `application_display_name` defaults to `"Sample Application"`. `application_description` defaults to `"Sample application to showcase GKE Autopilot features"`. `application_version` defaults to `"latest"`. All other behaviour is identical to `App_GKE`. | [App_GKE §1 Module Overview](../App_GKE/App_GKE.md#1-module-overview) |
| **Group 3** | Runtime & Scaling | `container_image_source` defaults to `"custom"` (the pre-built Flask image is built by Cloud Build). `container_image` defaults to the Cloud Run hello image as a placeholder. `min_instance_count` variable defaults to `0`, but is **overridden to `1`** internally by the module (see [Minimum Instance Count Override](#1-minimum-instance-count-override) above). All other variables (`max_instance_count`, `container_port`, `container_protocol`, `container_resources`, `timeout_seconds`, `enable_image_mirroring`, `enable_vertical_pod_autoscaling`, `enable_cloudsql_volume`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels`) behave identically to `App_GKE`. | [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot) |
| **Group 4** | Environment Variables & Secrets | `environment_variables` and `secret_environment_variables` are passed through to `App_GKE`. Additionally, the module automatically injects `ENABLE_REDIS`, `REDIS_HOST`, and `REDIS_PORT` (see [Redis Host Fallback](#2-redis-host-fallback-to-sidecar-127001) above) and `SECRET_KEY` (sourced from the auto-generated Secret Manager secret). `secret_rotation_period`, `secret_propagation_delay`, and `manage_storage_kms_iam` behave identically to `App_GKE`. `enable_secrets_store_csi_driver` is not exposed in `Sample_GKE` (the module manages secret delivery internally). | [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot) |
| **Group 5** | GKE Backend Configuration | All variables (`gke_cluster_name`, `gke_cluster_selection_mode`, `namespace_name`, `workload_type`, `service_type`, `session_affinity`, `enable_multi_cluster_service`, `configure_service_mesh`, `enable_network_segmentation`, `termination_grace_period_seconds`, `deployment_timeout`, `prereq_gke_subnet_cidr`) are passed through unchanged. Refer to the base guide for full descriptions. | [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot) |
| **Group 6** | Jobs & Scheduled Tasks | `initialization_jobs` defaults to the pre-configured `db-init` job (using `postgres:15-alpine` and the bundled `db-init.sh` script). You may override this with a custom job list. When `enable_redis = true`, an internal Redis additional service is added automatically — you do not need to declare it in `additional_services`. `cron_jobs` and `additional_services` are passed through to `App_GKE` unchanged. | [App_GKE §3.E Initialization Jobs & CronJobs](../App_GKE/App_GKE.md#e-initialization-jobs--cronjobs) |
| **Group 7** | CI/CD & GitHub Integration | All variables (`enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`) are passed through unchanged. Refer to the base guide for full descriptions. | [App_GKE §6 CI/CD & Delivery](../App_GKE/App_GKE.md#6-cicd--delivery) |
| **Group 8** | Storage & Filesystem — NFS | All variables (`enable_nfs`, `nfs_mount_path`, `nfs_instance_name`, `nfs_instance_base_name`) are passed through unchanged. Refer to the base guide for full descriptions. | [App_GKE §3.C Storage (NFS / GCS / GCS Fuse)](../App_GKE/App_GKE.md#c-storage-nfs--gcs--gcs-fuse) |
| **Group 9** | Storage & Filesystem — GCS | All variables (`create_cloud_storage`, `storage_buckets`, `gcs_volumes`) are passed through unchanged. `Sample_Common` does not define any additional GCS buckets beyond what you configure here. Refer to the base guide for full descriptions. | [App_GKE §3.C Storage (NFS / GCS / GCS Fuse)](../App_GKE/App_GKE.md#c-storage-nfs--gcs--gcs-fuse) |
| **Group 10** | Database Configuration | All variables (`database_type`, `sql_instance_name`, `sql_instance_base_name`, `application_database_name`, `application_database_user`, `database_password_length`, `enable_postgres_extensions`, `postgres_extensions`, `enable_mysql_plugins`, `mysql_plugins`, `enable_auto_password_rotation`, `rotation_propagation_delay_sec`) are passed through unchanged. `application_database_name` defaults to `"cloudrunapp"` in `App_GKE` but is overridden to `"cloudrunapp"` in the `Sample_GKE` variables. The database is automatically initialised by the `db-init` job. Refer to the base guide for full descriptions. | [App_GKE §3.B Database (Cloud SQL)](../App_GKE/App_GKE.md#b-database-cloud-sql) |
| **Group 11** | Backup Schedule & Retention | All variables (`backup_schedule`, `backup_retention_days`, `enable_backup_import`, `backup_source`, `backup_uri`, `backup_format`) are passed through unchanged. Note: `backup_uri` is the user-facing variable name; it is mapped to `backup_file` internally when passed to `App_GKE`. Refer to the base guide for full descriptions. | [App_GKE §8.B Backup Import & Recovery](../App_GKE/App_GKE.md#b-backup-import) |
| **Group 12** | Custom SQL Scripts | All variables (`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root`) are passed through unchanged. Refer to the base guide for full descriptions. | [App_GKE §3.E Initialization Jobs & CronJobs](../App_GKE/App_GKE.md#e-initialization-jobs--cronjobs) |
| **Group 13** | Observability & Health | **Probe routing in Sample_GKE:** `startup_probe_config` and `health_check_config` each serve a dual role — they are passed to `Sample_Common` (as `startup_probe` and `liveness_probe` respectively) to configure the Kubernetes container probes, and also forwarded directly to `App_GKE` (using the same `startup_probe_config` / `health_check_config` names) to configure the load balancer backend health checks. Other App_GKE wrapper modules use separate `startup_probe`/`liveness_probe` variables for container probes; Sample_GKE consolidates both paths into the single `_config` pair. `alert_policies` and `uptime_check_config` are passed through unchanged. | [App_GKE §5 Traffic & Ingress](../App_GKE/App_GKE.md#5-traffic--ingress) |
| **Group 14** | Reliability Policies | All variables related to pod disruption budgets, HPA behaviour, and reliability settings are passed through unchanged. Refer to the base guide for full descriptions. | [App_GKE §7 Reliability & Scheduling](../App_GKE/App_GKE.md#7-reliability--scheduling) |
| **Group 15** | Resource Quota | All variables related to Kubernetes namespace resource quotas are passed through unchanged. Refer to the base guide for full descriptions. | [App_GKE §7.C Resource Quotas](../App_GKE/App_GKE.md#c-resource-quotas) |
| **Group 16** | Custom Domain, Static IP & Network Configuration | All variables (`application_domains`, `enable_custom_domain`, `reserve_static_ip`, `static_ip_name`, `enable_cdn`, `admin_ip_ranges`, `network_tags`, `enable_vpc_sc`) are passed through unchanged. Refer to the base guide for full descriptions. | [App_GKE §5 Traffic & Ingress](../App_GKE/App_GKE.md#5-traffic--ingress) |
| **Group 17** | Identity-Aware Proxy | All variables (`enable_iap`, `iap_authorized_users`, `iap_authorized_groups`, `iap_oauth_client_id`, `iap_oauth_client_secret`, `iap_support_email`) are passed through unchanged. Refer to the base guide for full descriptions. | [App_GKE §4.B Identity-Aware Proxy (IAP)](../App_GKE/App_GKE.md#b-identity-aware-proxy-iap) |
| **Group 18** | Cloud Armor | All variables (`enable_cloud_armor`, `cloud_armor_policy_name`) are passed through unchanged. Refer to the base guide for full descriptions. | [App_GKE §4.A Cloud Armor WAF](../App_GKE/App_GKE.md#a-cloud-armor-waf) |
| §3.D | Networking & Network Policies | All variables (`enable_network_segmentation`, `network_tags`, `admin_ip_ranges`) are passed through unchanged. Refer to the base guide for full descriptions. | [App_GKE §3.D Networking & Network Policies](../App_GKE/App_GKE.md#d-networking--network-policies) |
| §3.F | Additional Services | `additional_services` is passed through unchanged. When `enable_redis = true`, `Sample_GKE` automatically injects an internal Redis additional service — you do not need to declare it separately. Refer to the base guide for full descriptions. | [App_GKE §3.F Additional Services](../App_GKE/App_GKE.md#f-additional-services) |
| §4.C | Binary Authorization | `enable_binary_authorization` is passed through unchanged. Refer to the base guide for full descriptions. | [App_GKE §4.C Binary Authorization](../App_GKE/App_GKE.md#c-binary-authorization) |
| §4.D | VPC Service Controls | `enable_vpc_sc` is passed through unchanged. Refer to the base guide for full descriptions. | [App_GKE §4.D VPC Service Controls](../App_GKE/App_GKE.md#d-vpc-service-controls) |
| §4.E | Secrets Store CSI | `enable_secrets_store_csi_driver` is not exposed in `Sample_GKE` — the module manages secret delivery internally via `explicit_secret_values` (see [Explicit Secret Value Injection](#3-explicit-secret-value-injection-explicit_secret_values) above). | [App_GKE §4.E Secrets Store CSI](../App_GKE/App_GKE.md#e-secrets-store-csi-driver) |
| §5.B | Cloud CDN | `enable_cdn` is passed through unchanged. Refer to the base guide for full descriptions. | [App_GKE §5.B Cloud CDN](../App_GKE/App_GKE.md#b-cloud-cdn) |
| §5.C | Static IP | `reserve_static_ip` and `static_ip_name` are passed through unchanged. Refer to the base guide for full descriptions. | [App_GKE §5.C Static IP](../App_GKE/App_GKE.md#c-static-ip) |
| §7.A | Pod Disruption Budget | `enable_pod_disruption_budget` and related variables are passed through unchanged. Refer to the base guide for full descriptions. | [App_GKE §7.A Pod Disruption Budget](../App_GKE/App_GKE.md#a-pod-disruption-budgets) |
| §7.B | Topology Spread | `enable_topology_spread` and related variables are passed through unchanged. Refer to the base guide for full descriptions. | [App_GKE §7.B Topology Spread](../App_GKE/App_GKE.md#b-topology-spread-constraints) |
| §7.D | Auto Password Rotation | `enable_auto_password_rotation` and `rotation_propagation_delay_sec` are passed through unchanged. Refer to the base guide for full descriptions. | [App_GKE §7.D Auto Password Rotation](../App_GKE/App_GKE.md#d-auto-password-rotation) |
| §8.A | Redis / Memorystore | `enable_redis`, `redis_host`, `redis_port`, and `redis_auth` are passed through to `App_GKE`. Additionally, `Sample_GKE` automatically injects `ENABLE_REDIS`, `REDIS_HOST`, and `REDIS_PORT` environment variables (see [Redis Host Fallback](#2-redis-host-fallback-to-sidecar-127001) above). `enable_redis` defaults to `true`. | [App_GKE §8.A Redis / Memorystore](../App_GKE/App_GKE.md#a-redis--memorystore) |
| §8.C | Service Mesh | `configure_service_mesh` is passed through unchanged. Refer to the base guide for full descriptions. | [App_GKE §8.C Service Mesh](../App_GKE/App_GKE.md#c-service-mesh-asm-via-fleet) |
| §8.D | Multi-Cluster Services | `enable_multi_cluster_service` is passed through unchanged. Refer to the base guide for full descriptions. | [App_GKE §8.D Multi-Cluster Services](../App_GKE/App_GKE.md#d-multi-cluster-services-mcs) |

---

## Redis Configuration Summary

The table below summarises the three Redis-related variables and how they interact with the module's behaviour. The Redis integration is provided by App_GKE — see [§8.A Redis / Memorystore](../App_GKE/App_GKE.md#a-redis--memorystore) for the full integration reference.

| Variable | Default | Behaviour when `enable_redis = true` |
|---|---|---|
| `enable_redis` | `true` | Deploys an internal `redis:alpine` additional service. Injects `ENABLE_REDIS=true`, `REDIS_HOST`, and `REDIS_PORT` into the application container. |
| `redis_host` | `""` | If left empty, `REDIS_HOST` is set to `127.0.0.1` (local fallback). If set to an IP or hostname, that value is used instead (for external Redis such as Cloud Memorystore). |
| `redis_port` | `"6379"` | Injected as `REDIS_PORT`. Change only if your Redis instance uses a non-standard port. |
| `redis_auth` | `""` | If set, stored in Secret Manager and injected securely. Leave empty for unauthenticated Redis (acceptable for internal cluster services on a private network). |

---

## Validating a Sample_GKE Deployment

Because `Sample_GKE` delegates all infrastructure to `App_GKE`, validation follows the same procedures described in the [App_GKE Configuration Guide](../App_GKE/App_GKE.md). The additional resources managed by `Sample_Common` can be validated as follows:

**Flask SECRET_KEY secret:**

```bash
# Confirm the Flask SECRET_KEY secret exists
gcloud secrets list --project=PROJECT_ID \
  --filter="name:secret-key" \
  --format="table(name,createTime)"

# View the secret's replication and rotation config
gcloud secrets describe SECRET_NAME \
  --project=PROJECT_ID \
  --format="yaml(replication,rotation)"
```

**DB-init Kubernetes Job:**

```bash
# List all Kubernetes Jobs in the application namespace
kubectl get jobs -n NAMESPACE -o wide

# View the status of the db-init job
kubectl describe job db-init -n NAMESPACE

# View db-init job logs
kubectl logs -l job-name=db-init -n NAMESPACE
```

**Redis additional service (when `enable_redis = true`):**

```bash
# List all Deployments in the namespace (redis should appear alongside the app)
kubectl get deployments -n NAMESPACE -o wide

# Confirm the Redis Service exists and has a cluster IP
kubectl get service -n NAMESPACE -l app=APPLICATION_NAME-redis

# Confirm REDIS_HOST and REDIS_PORT are injected into the app container
kubectl exec -n NAMESPACE POD_NAME -- env | grep REDIS
```
