# Strapi_GKE Module — Configuration Guide

Strapi is an open-source headless CMS that gives developers the freedom to choose their favourite tools and frameworks while enabling content editors to manage their content independently. This module deploys Strapi on **GKE Autopilot**, backed by a managed Cloud SQL PostgreSQL instance, a Cloud Filestore NFS volume for media uploads, and a GCS bucket for object storage.

`Strapi_GKE` is a **wrapper module** built on top of `App_GKE`. It uses `App_GKE` for all GCP infrastructure provisioning (cluster, networking, Cloud SQL, GCS, secrets, CI/CD) and adds Strapi-specific application configuration and secret management on top.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How This Guide Is Structured

This guide documents only the variables that are **unique to `Strapi_GKE`** or that have **Strapi-specific defaults** that differ from the `App_GKE` base module. For all other variables — project identity, runtime scaling, backend configuration, storage, CI/CD, observability, networking, IAP, and Cloud Armor — refer directly to the [App_GKE Configuration Guide](../App_GKE/App_GKE.md).

**Variables fully covered by the App_GKE guide:**

| Configuration Area | App_GKE.md Section | Strapi-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | [App_GKE §1 Module Overview](../App_GKE/App_GKE.md#1-module-overview) | Different defaults for `module_description` and `module_documentation`. |
| Project & Identity | [App_GKE §2 IAM & Access Control](../App_GKE/App_GKE.md#2-iam--access-control) | Refer to base App_GKE module documentation. |
| Application Identity | [App_GKE §1 Module Overview](../App_GKE/App_GKE.md#1-module-overview) | See [Strapi Application Identity](#strapi-application-identity) below for Strapi-specific defaults. |
| Runtime & Scaling | [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot) | See [Strapi Runtime Configuration](#strapi-runtime-configuration) below. `container_image_source` defaults to `"custom"`; `container_port` defaults to `1337`. |
| Environment Variables & Secrets | [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot) | See [Strapi Environment Variables](#strapi-environment-variables) below for email and GCS defaults. |
| GKE Backend Configuration | [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot) | Refer to base App_GKE module documentation. |
| Jobs & Scheduled Tasks | [App_GKE §3.E Initialization Jobs & CronJobs](../App_GKE/App_GKE.md#e-initialization-jobs--cronjobs) | A `db-init` job runs automatically — see [Platform-Managed Behaviours](#platform-managed-behaviours). Refer to App_GKE for customising additional jobs. |
| CI/CD & GitHub Integration | [App_GKE §6 CI/CD & Delivery](../App_GKE/App_GKE.md#6-cicd--delivery) | Refer to base App_GKE module documentation. |
| Storage — NFS | [App_GKE §3.C Storage (NFS / GCS / GCS Fuse)](../App_GKE/App_GKE.md#c-storage-nfs--gcs--gcs-fuse) | NFS is **enabled by default** in this module. See [NFS Storage](#nfs-storage) below. |
| Storage — GCS | [App_GKE §3.C Storage (NFS / GCS / GCS Fuse)](../App_GKE/App_GKE.md#c-storage-nfs--gcs--gcs-fuse) | A default `data` bucket is provisioned. Refer to App_GKE module documentation for bucket configuration. |
| Database Configuration | [App_GKE §3.B Database (Cloud SQL)](../App_GKE/App_GKE.md#b-database-cloud-sql) | See [Strapi Database Configuration](#strapi-database-configuration) below. |
| Backup Schedule & Retention | [App_GKE §8.B Backup Import & Recovery](../App_GKE/App_GKE.md#b-backup-import) | Refer to base App_GKE module documentation. See also [Backup Import & Recovery](#backup-import--recovery) below. |
| Custom SQL Scripts | [App_GKE §3.E Initialization Jobs & CronJobs](../App_GKE/App_GKE.md#e-initialization-jobs--cronjobs) | Refer to base App_GKE module documentation. |
| Observability & Health | [App_GKE §5 Traffic & Ingress](../App_GKE/App_GKE.md#5-traffic--ingress) | See [Strapi Health Probes](#strapi-health-probes) below for Strapi-specific defaults. |
| Reliability Policies | [App_GKE §7 Reliability & Scheduling](../App_GKE/App_GKE.md#7-reliability--scheduling) | Refer to base App_GKE module documentation. |
| Resource Quota | [App_GKE §7.C Resource Quotas](../App_GKE/App_GKE.md#c-resource-quotas) | Refer to base App_GKE module documentation. |
| Custom Domain, Static IP & Network | [App_GKE §5 Traffic & Ingress](../App_GKE/App_GKE.md#5-traffic--ingress) | Refer to base App_GKE module documentation. |
| Identity-Aware Proxy | [App_GKE §4.B Identity-Aware Proxy (IAP)](../App_GKE/App_GKE.md#b-identity-aware-proxy-iap) | Refer to base App_GKE module documentation. |
| Cloud Armor | [App_GKE §4.A Cloud Armor WAF](../App_GKE/App_GKE.md#a-cloud-armor-waf) | Refer to base App_GKE module documentation. |

---

## Platform-Managed Behaviours

The following behaviours are applied automatically by `Strapi_GKE` regardless of the variable values in your `tfvars` file. They cannot be overridden by user configuration.

| Behaviour | Detail |
|---|---|
| **Strapi security secrets** | Five secrets are auto-generated and stored in Secret Manager: `JWT_SECRET`, `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`, `TRANSFER_TOKEN_SALT`, and `APP_KEYS` (a comma-separated list of four keys). These are required by Strapi for authentication and API security and are injected into the container automatically. You do not need to generate or manage these values. |
| **GCS environment variables** | `GCS_BUCKET_NAME` and `GCS_BASE_URL` are automatically injected into the container, pointing to the provisioned GCS uploads bucket. Strapi is pre-configured to use the GCS upload provider when these variables are present. |
| **Database initialisation job** | A `db-init` Kubernetes Job runs automatically on each deployment using `postgres:15-alpine`. It idempotently creates the Strapi database and user, waits for Cloud SQL to be ready, and handles password updates. You do not need to run manual database setup. To override the default job, set `initialization_jobs` with your custom job definition. |
| **PostgreSQL required** | `database_type` defaults to `"POSTGRES"` (latest managed Cloud SQL PostgreSQL). Strapi requires PostgreSQL — setting `database_type = "NONE"` or a MySQL variant will cause the application to fail at startup. |
| **Container port 1337** | Strapi listens on port `1337` by default. The `container_port` variable is set to `1337`, and the `PORT` environment variable controls the listen port at runtime (configurable in `environment_variables` if needed). |
| **Custom image build** | `container_image_source` defaults to `"custom"`. The module includes a Strapi Dockerfile (based on `node:20-alpine`) that installs dependencies, builds the application, and packages it for production. Set `container_image_source = "prebuilt"` with a `container_image` URI to skip the build and deploy an existing image. |
| **NFS enabled** | `enable_nfs = true` by default. Strapi stores media uploads on the NFS volume mounted at `/mnt/nfs`, which persists across pod restarts and is shared between replicas. Disabling NFS is possible but will result in media uploads being stored ephemerally in the container filesystem. |
| **Email provider support** | If `SMTP_HOST` is set in `environment_variables`, the Strapi `plugins.js` automatically configures the `nodemailer` email provider. No code changes are required to enable email delivery. |

---

## Strapi Application Identity

These variables control how the Strapi deployment is named and described. They correspond directly to the `application_name`, `application_display_name`, and `application_description` variables in `App_GKE` and behave identically — the only difference is the Strapi-specific default values.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_name` | `"strapi"` | `[a-z][a-z0-9-]{0,19}` | Internal identifier used as the base name for GKE workloads, Cloud SQL, GCS buckets, Artifact Registry, and Secret Manager secrets. **Do not change after initial deployment.** See [App_GKE §1 Module Overview](../App_GKE/App_GKE.md#1-module-overview) for full details. |
| `application_display_name` | `"Strapi CMS"` | Any string | Human-readable name shown in the platform UI and monitoring dashboards. Can be updated freely without affecting resource names. |
| `application_description` | `"Strapi Headless CMS on GKE"` | Any string | Brief description of the deployment. Populated into Kubernetes resource annotations and platform documentation. |
| `application_version` | `"5.0.0"` | Strapi version string (e.g. `"5.0.0"`, `"4.25.0"`) | Version tag applied to the container image and used for deployment tracking. When `container_image_source = "custom"`, incrementing this value triggers a new Cloud Build run. When `container_image_source = "prebuilt"`, this value is informational only. Use the official [Strapi release](https://github.com/strapi/strapi/releases) version matching the image you intend to deploy. |

### Validating Application Identity

```bash
# Confirm the Deployment exists with the expected name
kubectl get deployments -n NAMESPACE -o wide

# View workload labels and annotations
kubectl describe deployment strapi -n NAMESPACE | grep -A5 Labels
```

---

## Strapi Runtime Configuration

Strapi is a Node.js application. The module defaults are sized for a development or small production instance. For high-traffic deployments, increase `container_resources`.

**Strapi-specific runtime defaults that differ from App_GKE:**

| Variable | App_GKE Default | Strapi_GKE Default | Reason |
|---|---|---|---|
| `container_image_source` | `"custom"` | `"custom"` | The included Strapi Dockerfile provides a production-ready build. |
| `container_port` | `8080` | `1337` | Strapi listens on port `1337` by default (configurable via the `PORT` environment variable). |
| `container_resources.cpu_limit` | `"1000m"` | `"1000m"` | Suitable for development and low-traffic production. Increase for higher throughput. |
| `container_resources.memory_limit` | `"512Mi"` | `"512Mi"` | Increase to `"1Gi"` or higher for production workloads with large media libraries or many concurrent users. |
| `min_instance_count` | `1` | `1` | Keeps at least one Strapi pod running at all times to avoid cold-start latency. |
| `max_instance_count` | `3` | `10` | Allows horizontal scaling up to 10 replicas under load. |

> **Note on `container_resources`:** The full `container_resources` object (as documented in [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot)) is available. Use it to set `cpu_request`, `mem_request`, and ephemeral storage limits in addition to the defaults above.

### deploy_application

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `deploy_application` | `true` | `true` / `false` | When `false`, the module provisions all supporting infrastructure (Cloud SQL, GCS buckets, Artifact Registry, Secret Manager secrets) without deploying the Strapi workload. This is useful for staged rollouts or when you need to validate infrastructure before the first application deployment. |

### Validating Runtime Configuration

```bash
# View container resource requests and limits on the running pod
kubectl describe pod -n NAMESPACE -l app=strapi | grep -A10 "Limits:"

# Confirm the image and port being used
kubectl get deployment strapi -n NAMESPACE \
  -o jsonpath='{.spec.template.spec.containers[0].image}'

kubectl get service strapi -n NAMESPACE \
  -o jsonpath='{.spec.ports[0].port}'
```

---

## Strapi Database Configuration

Strapi requires PostgreSQL. The module uses `application_database_name` and `application_database_user` (consistent with the App_GKE interface) to configure the database.

All other database variables (`database_type`, `sql_instance_name`, `database_password_length`, `enable_auto_password_rotation`, `rotation_propagation_delay_sec`, etc.) behave identically to the App_GKE equivalents — refer to [App_GKE §3.B Database (Cloud SQL)](../App_GKE/App_GKE.md#b-database-cloud-sql) for their documentation.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_database_name` | `"strapi"` | `[a-z][a-z0-9_]{0,62}` | The name of the PostgreSQL database created within the Cloud SQL instance. Injected as the `DB_NAME` environment variable. **Do not change after initial deployment** — Strapi stores all application data in this database and renaming it requires manual migration. |
| `application_database_user` | `"strapi"` | `[a-z][a-z0-9_]{0,31}` | The PostgreSQL user created for the Strapi application. Injected as the `DB_USER` environment variable. The password is auto-generated, stored in Secret Manager, and injected as `DB_PASSWORD`. |
| `database_type` | `"POSTGRES"` | `POSTGRES`, `POSTGRES_15`, `POSTGRES_14`, etc. | The Cloud SQL PostgreSQL version. Defaults to the latest managed version. **Strapi requires PostgreSQL** — do not set this to `"NONE"` or a MySQL variant. |

> **Note:** The `db-init` initialisation job connects as the `postgres` superuser to create the Strapi database and user before the application starts. You do not need to run these steps manually.

### Validating Database Configuration

```bash
# Confirm the database and user were created
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID

gcloud sql users list --instance=INSTANCE_NAME --project=PROJECT_ID

# Confirm DB_NAME and DB_USER env vars are injected into the pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep -E "^DB_"
```

---

## Strapi Environment Variables

The `environment_variables` variable (documented in [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot)) is used by Strapi to configure email delivery and other runtime settings.

**Email delivery (optional):**

If `SMTP_HOST` is set, the built-in `plugins.js` automatically configures the `nodemailer` email provider for Strapi notifications (user invitations, password resets, and workflow notifications). For sensitive values such as `SMTP_PASSWORD`, use `secret_environment_variables` instead:

```hcl
environment_variables = {
  SMTP_HOST  = "smtp.sendgrid.net"
  SMTP_PORT  = "587"
  SMTP_USER  = "apikey"
  EMAIL_FROM = "noreply@example.com"
}

secret_environment_variables = {
  SMTP_PASSWORD = "strapi-smtp-password"   # Secret Manager secret name
}
```

**GCS upload integration (auto-injected):**

`GCS_BUCKET_NAME` and `GCS_BASE_URL` are injected automatically by the platform and do not need to be set manually. Strapi's `plugins.js` reads these values to configure the GCS upload provider.

All other `environment_variables` and `secret_environment_variables` behaviour is identical to App_GKE — refer to [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot).

---

## Strapi Health Probes

Strapi performs database connection validation and may run pending migrations on startup. The health probes in `Strapi_GKE` use the Strapi-native `/_health` endpoint rather than a generic path, and have extended timeouts to accommodate the Node.js startup sequence and database checks.

**Probe routing in Strapi_GKE:** `startup_probe_config` and `health_check_config` each serve a dual role — they are passed to `Strapi_Common` (as `startup_probe` and `liveness_probe` respectively) to configure the Kubernetes container probes, and also forwarded directly to `App_GKE` (using the same `startup_probe_config` / `health_check_config` names) to configure the load balancer backend health checks. Other App_GKE wrapper modules use separate `startup_probe`/`liveness_probe` variables for container probes; Strapi_GKE consolidates both paths into the single `_config` pair. See [App_GKE §5 Traffic & Ingress](../App_GKE/App_GKE.md#5-traffic--ingress) for the App_GKE field reference.

**Strapi-specific probe defaults that differ from App_GKE:**

| Variable | App_GKE Default `path` | Strapi_GKE Default `path` | Reason |
|---|---|---|---|
| `startup_probe_config` | `"/"` | `"/_health"` | Strapi exposes a dedicated health endpoint at `/_health` that confirms the application and database connection are ready. |
| `health_check_config` | `"/"` | `"/_health"` | Using `/_health` for the liveness probe ensures Cloud Run only routes traffic to fully initialised Strapi instances. |

**Default probe configuration:**

```hcl
startup_probe_config = {
  enabled               = true
  type                  = "HTTP"
  path                  = "/_health"
  initial_delay_seconds = 10
  timeout_seconds       = 5
  period_seconds        = 10
  failure_threshold     = 3
}

health_check_config = {
  enabled               = true
  type                  = "HTTP"
  path                  = "/_health"
  initial_delay_seconds = 15
  timeout_seconds       = 5
  period_seconds        = 30
  failure_threshold     = 3
}
```

> **On first deployment**, when Strapi initialises its database schema, startup may take longer than usual. If the startup probe fails on initial deploy, increase `startup_probe_config.initial_delay_seconds` or `failure_threshold`.

### Validating Health Probes

```bash
# View startup and liveness probe config on the running pod
kubectl get deployment strapi -n NAMESPACE \
  -o jsonpath='{.spec.template.spec.containers[0].startupProbe}' | jq .

kubectl get deployment strapi -n NAMESPACE \
  -o jsonpath='{.spec.template.spec.containers[0].livenessProbe}' | jq .

# View pod restart counts (rising count indicates probe failures)
kubectl get pods -n NAMESPACE -o wide

# View Strapi startup logs
kubectl logs -n NAMESPACE -l app=strapi --since=10m | head -100
```

---

## NFS Storage

Strapi stores media uploads and shared files on the NFS volume. `Strapi_GKE` enables NFS by default, unlike the `App_GKE` base module where NFS is opt-in.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_nfs` | `true` | `true` / `false` | When `true`, a Cloud Filestore instance is provisioned and mounted into the Strapi container. Media uploads written to `nfs_mount_path` are preserved across pod restarts and shared between all Strapi replicas. Set to `false` only if you are using GCS as the sole upload backend (via the GCS upload provider). |
| `nfs_mount_path` | `"/mnt/nfs"` | Filesystem path | The path inside the container where the NFS volume is mounted. Strapi should be configured to write uploads to this path. |

> **Note:** All other NFS configuration variables (`nfs_share_name`, `nfs_server_ip`, `filestore_tier`, etc.) are identical to the App_GKE equivalents — refer to [App_GKE §3.C Storage (NFS / GCS / GCS Fuse)](../App_GKE/App_GKE.md#c-storage-nfs--gcs--gcs-fuse) for their documentation.

### Validating NFS Configuration

```bash
# Confirm the NFS PersistentVolume is bound
kubectl get pv -n NAMESPACE

# Confirm the NFS volume is mounted in the pod
kubectl describe pod -n NAMESPACE -l app=strapi | grep -A5 "Mounts:"

# Test NFS write access from within the container
kubectl exec -n NAMESPACE POD_NAME -- ls -la /mnt/nfs
```

---

## Redis Cache

Strapi supports Redis as a session store and application-level cache. When `enable_redis = true`, the `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, and `ENABLE_REDIS` environment variables are injected into the Strapi container, and Strapi's built-in configuration automatically enables the Redis cache backend. The Redis integration is provided by App_GKE — see [§8.A Redis / Memorystore](../App_GKE/App_GKE.md#a-redis--memorystore) for the full integration reference.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `false` | `true` / `false` | When `true`, Redis connection details are injected into the Strapi container. Strapi's built-in `config/plugins.js` detects `ENABLE_REDIS = "true"` and switches the cache backend automatically. For production multi-replica deployments, enabling a shared Redis cache is recommended to prevent session inconsistency across replicas. |
| `redis_host` | `""` *(defaults to NFS server IP)* | IP address or hostname | The hostname or IP address of the Redis server. Leave empty to fall back to the NFS server IP (suitable for single-node shared environments). For production, set this explicitly to a Cloud Memorystore for Redis instance private IP or a dedicated Redis VM. |
| `redis_port` | `"6379"` | Port number as string | The TCP port of the Redis server. The default `6379` is the standard Redis port and is correct for Cloud Memorystore and most self-hosted Redis instances. |
| `redis_auth` | `""` *(no authentication)* | Password string *(sensitive)* | Authentication password for the Redis server. Leave empty if the Redis instance does not require authentication. When set, the value is injected securely via `REDIS_PASSWORD`. For Cloud Memorystore with AUTH enabled, set this to the instance's auth string. |

### Validating Redis Configuration

```bash
# Confirm REDIS_HOST, REDIS_PORT, and ENABLE_REDIS are injected into the pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep -E "^REDIS|ENABLE_REDIS"
```

---

## Backup Import & Recovery

In addition to the scheduled backup (`backup_schedule` and `backup_retention_days`, documented in [App_GKE §8.B Backup Import & Recovery](../App_GKE/App_GKE.md#b-backup-import)), `Strapi_GKE` supports a **one-time import** of an existing database backup during deployment. This is designed for migrating an existing Strapi instance to GCP or seeding a new environment with production data.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_backup_import` | `false` | `true` / `false` | When `true`, triggers a one-time Kubernetes Job to restore the backup file specified by `backup_file` from the source defined in `backup_source`. The import job runs after the database is provisioned. **If the database already contains data**, the import may produce errors — test in a non-production environment first. |
| `backup_source` | `"gcs"` | `gcs` / `gdrive` | The source from which the backup file is retrieved. **`gcs`:** imports from the module's provisioned GCS backup bucket. **`gdrive`:** imports from a Google Drive file ID. |
| `backup_file` | `"backup.sql"` | Filename string | The filename (for GCS) or file ID (for Google Drive) of the backup to import. For GCS, the file must exist in the module's backup bucket before deployment. |
| `backup_format` | `"sql"` | `sql` / `tar` / `gz` / `tgz` / `tar.gz` / `zip` / `auto` | The format of the backup file. Use `"auto"` to detect the format from the file extension (GCS only). |

### Validating Backup Import

```bash
# Confirm the import job completed successfully
kubectl get jobs -n NAMESPACE --selector=app=backup-import

kubectl logs -n NAMESPACE -l job-name=IMPORT_JOB_NAME

# Verify the Strapi database is present after import
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID
```

---

## StatefulSet PVC Configuration

When `workload_type = "StatefulSet"` is set (see [App_GKE §3.A Compute (GKE Autopilot)](../App_GKE/App_GKE.md#a-compute-gke-autopilot)), the following variables configure the per-pod **PersistentVolumeClaim** automatically created for each StatefulSet replica.

> **Strapi use case:** A StatefulSet with per-pod PVCs is relevant only if you are running Strapi with a local disk-backed file store. For the default configuration (NFS-backed uploads at `/mnt/nfs`), a StatefulSet is not needed and the default `Deployment` workload type is recommended.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `stateful_pvc_enabled` | `false` | `true` / `false` | When `true` and `workload_type = "StatefulSet"`, a PVC is provisioned for each StatefulSet replica. |
| `stateful_pvc_size` | `"10Gi"` | Kubernetes storage quantity | The capacity of each per-pod PVC. |
| `stateful_pvc_mount_path` | `"/data"` | Filesystem path | The path inside the container where the PVC is mounted. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | Kubernetes storage class name | `"standard-rwo"` is the GKE Autopilot default. Use `"premium-rwo"` for lower-latency workloads. |
| `stateful_headless_service` | `true` | `true` / `false` | When `true`, creates a headless Kubernetes Service giving each pod a stable DNS name. |
| `stateful_pod_management_policy` | `"OrderedReady"` | `OrderedReady` / `Parallel` | Controls StatefulSet pod creation ordering. `OrderedReady` starts pods one at a time; `Parallel` starts all simultaneously. |
| `stateful_update_strategy` | `"RollingUpdate"` | `RollingUpdate` / `OnDelete` | Controls how StatefulSet pods are updated when the pod spec changes. |
