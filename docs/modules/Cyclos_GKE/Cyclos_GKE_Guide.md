---
title: "Cyclos GKE Configuration Guide"
sidebar_label: "GKE"
---

# Cyclos GKE Module — Configuration Guide

<video width="100%" controls style={{marginTop: '20px'}} poster="https://storage.googleapis.com/rad-public-2b65/modules/Cyclos_GKE.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/modules/Cyclos_GKE.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

<a href="https://storage.googleapis.com/rad-public-2b65/modules/Cyclos_GKE.pdf" target="_blank">View Presentation (PDF)</a>

Cyclos is a professional banking and payment system designed for microfinance institutions, credit unions, complementary currency schemes, and community banks. This module deploys Cyclos on **GKE Autopilot** using the official `cyclos/cyclos` container image, backed by a managed Cloud SQL PostgreSQL instance.

`Cyclos GKE` is a **wrapper module** built on top of `App GKE`. It uses `App GKE` for all GCP infrastructure provisioning (cluster, networking, Cloud SQL, GCS, secrets, CI/CD) and adds Cyclos-specific application configuration on top.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How This Guide Is Structured

This guide documents only the variables that are **unique to `Cyclos GKE`** or that have **Cyclos-specific defaults** that differ from the `App GKE` base module. For all other variables — project identity, runtime scaling, backend configuration, storage, CI/CD, observability, networking, IAP, and Cloud Armor — refer directly to the [App GKE Configuration Guide](../App_GKE/App_GKE_Guide.md).

**Variables fully covered by the App GKE guide:**

| Configuration Area | App_GKE_Guide Section | Cyclos-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | Group 0 | Different defaults for `module_description` and `module_documentation`. |
| Project & Identity | Group 1 | Refer to base App GKE module documentation. |
| Runtime & Scaling | Group 3 | See [Cyclos Runtime Configuration](#cyclos-runtime-configuration) below for Cyclos-specific resource sizing. `container_image` defaults to `cyclos/cyclos`; `container_image_source` defaults to `prebuilt`. |
| Environment Variables & Secrets | Group 4 | See [Cyclos Environment Variables](#cyclos-environment-variables) below for Cyclos-specific defaults. |
| GKE Backend Configuration | Group 5 | Refer to base App GKE module documentation. |
| Jobs & Scheduled Tasks | Group 6 | Refer to base App GKE module documentation. |
| CI/CD & GitHub Integration | Group 7 | Refer to base App GKE module documentation. |
| Storage — NFS | Group 8 | NFS is **disabled by this module**. See [Platform-Managed Behaviours](#platform-managed-behaviours). |
| Storage — GCS | Group 9 | Refer to base App GKE module documentation. |
| Backup Schedule & Retention | Group 11 | Refer to base App GKE module documentation. See also [Backup Import](#backup-import--recovery) below. |
| Custom SQL Scripts | Group 12 | Refer to base App GKE module documentation. |
| Observability & Health | Group 13 | See [Cyclos Health Probes](#cyclos-health-probes) below for renamed variables and Cyclos-specific defaults. |
| Reliability Policies | Group 14 | Refer to base App GKE module documentation. |
| Resource Quota | Group 15 | Refer to base App GKE module documentation. |
| Custom Domain, Static IP & Network | Group 16 | Refer to base App GKE module documentation. |
| Identity-Aware Proxy | Group 17 | Refer to base App GKE module documentation. |
| Cloud Armor | Group 18 | Refer to base App GKE module documentation. |

---

## Platform-Managed Behaviours

The following behaviours are applied automatically by `Cyclos GKE` regardless of the variable values in your `tfvars` file. They cannot be overridden by user configuration.

| Behaviour | Detail |
|---|---|
| **NFS disabled** | `enable_nfs` is forced to `false` in the application configuration. Cyclos stores uploaded files and media in the GCS bucket provisioned by the module (`cyclos.storedFileContentManager = gcs`), making a shared NFS filesystem unnecessary. |
| **GCS file storage** | `cyclos.storedFileContentManager = gcs` is injected automatically. The GCS bucket name is derived from the deployment identifiers and injected as `cyclos.storedFileContentManager.bucketName`. |
| **Schema management** | `cyclos.db.managed = true` is set, allowing Cyclos to create and evolve its own database schema on startup. Do not run manual schema migrations against a Cyclos database managed this way. |
| **PostgreSQL extensions** | The following extensions are automatically installed in the application database during the initialisation job: `pg_trgm`, `uuid-ossp`, `cube`, `earthdistance`, `postgis`, `unaccent`. These are required by Cyclos and are installed before the application starts. |
| **Database initialisation** | A dedicated `cyclos` database user is created with the password from Secret Manager and granted the permissions required by the application. The `postgres` superuser is used only for the extension and user setup jobs. |

---

## Cyclos Application Identity

These variables control how the Cyclos deployment is named and described. They correspond to the `application_display_name` and `application_description` variables in App GKE but use shorter names to match the Cyclos_Common interface.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_name` | `"cyclos"` | `[a-z][a-z0-9-]{0,19}` | Internal identifier used as the base name for GKE workloads, Cloud SQL, GCS buckets, and Artifact Registry. Functionally identical to `application_name` in App GKE. **Do not change after initial deployment.** |
| `application_version` | `"4.16.17"` | Cyclos version string, e.g. `"4.16.17"` | Version tag applied to the container image. Use the official Cyclos release version matching the image you intend to deploy. See the [Cyclos release notes](https://www.cyclos.org/releaseNotes) for available versions. When `container_image_source = "prebuilt"`, this controls which tagged image is pulled from Docker Hub. |
| `display_name` | `"Cyclos Community Edition"` | Any string | Human-readable name shown in the platform UI and GKE monitoring dashboards. Equivalent to `application_display_name` in App GKE. Can be updated freely without affecting resource names. |
| `description` | `"Cyclos Banking System on GKE"` | Any string | Brief description of the deployment. Populated into Kubernetes resource annotations and platform documentation. Equivalent to `application_description` in App GKE. |

### Validating Application Identity

```bash
# Confirm the Deployment exists with the expected name
kubectl get deployments -n NAMESPACE -o wide

# View workload annotations (description is stored here)
kubectl describe deployment cyclos -n NAMESPACE | grep -A5 Annotations
```

---

## Cyclos Runtime Configuration

Cyclos is a Java application and requires significantly more CPU and memory than a typical web service. The module exposes `cpu_limit` and `memory_limit` as **dedicated top-level variables** rather than requiring users to set the full `container_resources` object.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `cpu_limit` | `"2000m"` | Kubernetes CPU quantity string (e.g. `"2000m"`, `"2"`) | CPU limit for the Cyclos container. **Cyclos requires a minimum of 2 vCPU for reliable operation.** A lower value risks CPU throttling during startup (which is particularly expensive for the JVM) and during peak transaction processing. In GKE Autopilot, the CPU limit determines billing — set this based on your expected load. |
| `memory_limit` | `"4Gi"` | Kubernetes memory quantity string (e.g. `"4Gi"`, `"2Gi"`) | Memory limit for the Cyclos container. **Cyclos requires a minimum of 2 Gi; 4 Gi is recommended for production.** The JVM heap, Cyclos internal caches, and the Hazelcast session state together typically consume 2–3 Gi under normal load. Setting this below 2 Gi will cause `OutOfMemoryError` crashes. |

> **Note on `container_resources`:** The full `container_resources` object (as documented in [App_GKE_Guide Group 3](../App_GKE/App_GKE_Guide.md#group-3-runtime--scaling)) is also available. If `container_resources` is set explicitly in your `tfvars`, it takes precedence over `cpu_limit` and `memory_limit`. Use `container_resources` when you need to set `cpu_request`, `mem_request`, or `ephemeral_storage_limit`.

**Cyclos-specific runtime defaults that differ from App GKE:**

| Variable | App GKE Default | Cyclos GKE Default | Reason |
|---|---|---|---|
| `container_image_source` | `"custom"` | `"prebuilt"` | The official `cyclos/cyclos` Docker Hub image is production-ready and pre-configured. |
| `container_image` | `""` | `"cyclos/cyclos"` | The official Cyclos image from Docker Hub. |
| `max_instance_count` | `3` | `1` | Cyclos clustering requires Hazelcast configuration. The default of `1` ensures a stable single-instance deployment. Increase only after configuring Hazelcast discovery. |

### Validating Runtime Configuration

```bash
# View container resource requests and limits on the running pod
kubectl describe pod -n NAMESPACE -l app=cyclos | grep -A10 "Limits:"

# Confirm the image being used
kubectl get deployment cyclos -n NAMESPACE \
  -o jsonpath='{.spec.template.spec.containers[0].image}'
```

---

## Cyclos Database Configuration

Cyclos requires PostgreSQL. The module uses `db_name` and `db_user` (shorter names aligned with the Cyclos_Common interface) in place of the `application_database_name` and `application_database_user` variables documented in [App_GKE_Guide Group 10](../App_GKE/App_GKE_Guide.md#group-10-database-configuration).

All other database variables (`database_type`, `sql_instance_name`, `database_password_length`, `enable_auto_password_rotation`, `rotation_propagation_delay_sec`, etc.) behave identically to the App GKE equivalents — refer to [App_GKE_Guide Group 10](../App_GKE/App_GKE_Guide.md#group-10-database-configuration) for their documentation.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `db_name` | `"cyclos"` | `[a-z][a-z0-9_]{0,62}` | The name of the PostgreSQL database created within the Cloud SQL instance. Injected as the `DB_NAME` environment variable. **Do not change after initial deployment** — Cyclos stores all application data in this database and renaming it requires manual migration. |
| `db_user` | `"cyclos"` | `[a-z][a-z0-9_]{0,31}` | The PostgreSQL user created for the Cyclos application. Injected as the `DB_USER` environment variable. The password is auto-generated, stored in Secret Manager, and injected as `DB_PASSWORD`. |

> **Important:** Cyclos requires PostgreSQL. Set `database_type = "POSTGRES_15"` (or another supported PostgreSQL version) in your `tfvars`. The module's default is `"POSTGRES"` (latest managed version). Setting `database_type = "NONE"` or a MySQL/SQL Server type will prevent the application from starting.

> **PostgreSQL extensions** are installed automatically — see [Platform-Managed Behaviours](#platform-managed-behaviours). You do not need to set `enable_postgres_extensions = true` for the Cyclos-required extensions.

### Validating Database Configuration

```bash
# Confirm the database and user were created
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID

gcloud sql users list --instance=INSTANCE_NAME --project=PROJECT_ID

# Confirm DB_NAME and DB_USER env vars are injected into the pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep -E "^DB_"
```

---

## Cyclos Environment Variables

The `environment_variables` variable (documented in [App_GKE_Guide Group 4](../App_GKE/App_GKE_Guide.md#group-4-environment-variables--secrets)) has Cyclos-specific defaults that configure email delivery.

**Default `environment_variables` in Cyclos GKE:**

```hcl
environment_variables = {
  SMTP_HOST     = ""
  SMTP_PORT     = "25"
  SMTP_USER     = ""
  SMTP_PASSWORD = ""
  SMTP_SSL      = "false"
  EMAIL_FROM    = "cyclos@example.com"
}
```

Cyclos uses these variables to configure its outbound email transport (used for notifications, password resets, and transaction confirmations). Configure them to point to your SMTP server before going live. For sensitive values such as `SMTP_PASSWORD`, use `secret_environment_variables` instead:

```hcl
environment_variables = {
  SMTP_HOST  = "smtp.sendgrid.net"
  SMTP_PORT  = "587"
  SMTP_USER  = "apikey"
  SMTP_SSL   = "true"
  EMAIL_FROM = "noreply@yourbank.example.com"
}

secret_environment_variables = {
  SMTP_PASSWORD = "cyclos-smtp-password"   # Secret Manager secret name
}
```

All other `environment_variables` and `secret_environment_variables` behaviour is identical to App GKE — refer to [App_GKE_Guide Group 4](../App_GKE/App_GKE_Guide.md#group-4-environment-variables--secrets).

---

## Cyclos Health Probes

Cyclos is a Java application that performs database schema validation and migration on first boot. This startup phase can take 2–5 minutes on a fresh deployment, much longer than a typical web service. The probe variables in `Cyclos GKE` use **different names** from App GKE (`startup_probe` and `liveness_probe` instead of `startup_probe_config` and `health_check_config`) and have extended default timeouts to accommodate this behaviour.

Both probes target the `/api` endpoint, which reflects the Cyclos application's readiness more accurately than a generic `/healthz` path.

| Variable | Default | Description & Implications |
|---|---|---|
| `startup_probe` | `{ enabled = true, type = "HTTP", path = "/api", initial_delay_seconds = 90, timeout_seconds = 30, period_seconds = 60, failure_threshold = 5 }` | Determines when the container is ready to receive traffic after starting. The `initial_delay_seconds = 90` gives the JVM time to start and Cyclos time to validate or create the database schema before the first probe fires. `failure_threshold = 5` with `period_seconds = 60` allows up to 5 minutes of additional startup time beyond the initial delay. **On first deployment** (when the schema is created from scratch), startup may take longer than usual — consider increasing `failure_threshold` to `10` for the initial rollout. |
| `liveness_probe` | `{ enabled = true, type = "HTTP", path = "/api", initial_delay_seconds = 120, timeout_seconds = 10, period_seconds = 60, failure_threshold = 3 }` | Periodically checks whether a running Cyclos instance is healthy. The `initial_delay_seconds = 120` prevents premature restarts during the startup phase (after the startup probe has passed). A `period_seconds = 60` check interval is appropriate for a database-backed application — more frequent checks would add unnecessary load. |

> **Relationship to App GKE probes:** `startup_probe` corresponds to `startup_probe_config` in App GKE; `liveness_probe` corresponds to `health_check_config`. Their sub-field structure is identical. The `startup_probe_config` and `health_check_config` variables are also present in `Cyclos GKE` (with `/api` defaults) for compatibility — prefer the dedicated `startup_probe` and `liveness_probe` variables.

### Validating Health Probe Configuration

**Google Cloud Console:** Navigate to **Kubernetes Engine → Workloads → *cyclos deployment***, click a pod, and select the **Events** tab to view probe failure events.

```bash
# View startup and liveness probe config on the deployment pod spec
kubectl get deployment cyclos -n NAMESPACE \
  -o jsonpath='{.spec.template.spec.containers[0].startupProbe}' | jq .

kubectl get deployment cyclos -n NAMESPACE \
  -o jsonpath='{.spec.template.spec.containers[0].livenessProbe}' | jq .

# View pod restart counts (rising count indicates probe failures)
kubectl get pods -n NAMESPACE -o wide

# View Cyclos startup logs
kubectl logs -n NAMESPACE -l app=cyclos --since=10m | head -100
```

---

## Redis Cache

Cyclos supports Redis as a session store and application-level cache, which is particularly important for multi-instance deployments. When `enable_redis = true`, the `REDIS_HOST`, `REDIS_PORT`, and optionally `REDIS_AUTH` environment variables are injected into the Cyclos container.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `false` | `true` / `false` | When `true`, Redis connection details are injected into the Cyclos container as environment variables. Cyclos must be separately configured to use Redis via `cyclos.properties` (e.g. `cyclos.cacheHandler = redis`). For production multi-instance deployments, enabling a shared Redis cache is strongly recommended to prevent session inconsistency across replicas. |
| `redis_host` | `""` *(defaults to NFS server IP)* | IP address or hostname | The hostname or IP address of the Redis server. Leave empty to fall back to the NFS server IP (suitable for single-VM shared environments). For production, set this explicitly to a Cloud Memorystore for Redis instance private IP or a dedicated Redis GCE VM. The Cyclos container must be able to reach this host over the VPC. |
| `redis_port` | `"6379"` | Port number as string | The TCP port of the Redis server. The default `6379` is the standard Redis port and is correct for Cloud Memorystore and most self-hosted Redis instances. |
| `redis_auth` | `""` *(no authentication)* | Password string *(sensitive)* | Authentication password for the Redis server. Leave empty if the Redis instance does not require authentication. When set, the value is stored in Secret Manager and injected securely — it is never stored in plaintext. For Cloud Memorystore with AUTH enabled, set this to the instance's auth string. |

### Validating Redis Configuration

```bash
# Confirm REDIS_HOST and REDIS_PORT are injected into the pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep REDIS

# Test Redis connectivity from within the cluster (from a debug pod)
# redis-cli -h REDIS_HOST -p 6379 ping
```

---

## Backup Import & Recovery

In addition to the scheduled backup (`backup_schedule` and `backup_retention_days`, documented in [App_GKE_Guide Group 11](../App_GKE/App_GKE_Guide.md#group-11-backup-schedule--retention)), `Cyclos GKE` supports a **one-time import** of an existing Cyclos database backup during deployment. This is designed for migrating an existing Cyclos instance to GCP or seeding a new environment with production data.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_backup_import` | `false` | `true` / `false` | When `true`, triggers a one-time Kubernetes Job to restore the backup file specified by `backup_file` from the source defined in `backup_source`. The import job runs after the database is provisioned and extensions are installed. Configure `backup_source`, `backup_file`, and `backup_format` before enabling. **If the database already contains data**, the import may produce errors — test in a non-production environment first. |
| `backup_source` | `"gcs"` | `gcs` / `gdrive` | The source from which the backup file is retrieved. **`gcs`:** imports from the module's provisioned GCS backup bucket. The file must be uploaded to the bucket before deployment. **`gdrive`:** imports from a Google Drive file. Useful when the existing backup is stored in a shared Drive. Only used when `enable_backup_import` is `true`. |
| `backup_file` | `"backup.sql"` | Filename string | The filename of the backup file to import. Must exist in the configured source before deployment begins. For GCS, the file must be in the module's backup bucket. Example: `"cyclos-migration-2024-01-15.sql.gz"`. Ensure the filename exactly matches the file present in the source, including extension. |
| `backup_format` | `"sql"` | `sql` / `tar` / `gz` / `tgz` / `tar.gz` / `zip` / `auto` | The format of the backup file. **`sql`:** plain-text SQL dump (from `pg_dump`). **`gz`:** gzip-compressed SQL dump. **`auto`:** detects the format from the file extension — use when the format may vary. Explicit values are preferred for reliability. |

### Validating Backup Import

```bash
# Confirm the import job completed successfully
kubectl get jobs -n NAMESPACE --selector=app=backup-import

kubectl logs -n NAMESPACE -l job-name=IMPORT_JOB_NAME

# Verify Cyclos data is present after import
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID
```

---

## StatefulSet PVC Configuration

When `workload_type = "StatefulSet"` is set (see [App_GKE_Guide Group 5](../App_GKE/App_GKE_Guide.md#group-5-gke-backend-configuration)), the following variables configure the per-pod **PersistentVolumeClaim** automatically created for each StatefulSet replica.

> **Cyclos use case:** A StatefulSet with per-pod PVCs is relevant only if you are running Cyclos with a local disk-backed file store. For the default configuration (`cyclos.storedFileContentManager = gcs`), a StatefulSet is not needed and the default `Deployment` workload type is recommended.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `stateful_pvc_enabled` | `false` | `true` / `false` | When `true` and `workload_type = "StatefulSet"`, a PVC is provisioned for each StatefulSet replica. Set to `false` for `Deployment` workloads or StatefulSets that do not require per-pod persistent storage. |
| `stateful_pvc_size` | `"10Gi"` | Kubernetes storage quantity (e.g. `"20Gi"`) | The capacity of each per-pod PVC. For Cyclos, size this based on expected local file storage needs if not using GCS or NFS. |
| `stateful_pvc_mount_path` | `"/data"` | Filesystem path | The path inside the container where the PVC is mounted. Ensure this path matches the Cyclos file storage directory configuration. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | Kubernetes storage class name | The storage class for provisioned PVCs. `"standard-rwo"` (ReadWriteOnce) is the GKE Autopilot default and is appropriate for per-pod volumes. Use `"premium-rwo"` for lower latency. |
| `stateful_headless_service` | `true` | `true` / `false` | When `true`, a headless Kubernetes Service is created for the StatefulSet, giving each pod a stable DNS name (`POD_NAME.SERVICE_NAME.NAMESPACE.svc.cluster.local`). Required for Hazelcast clustering when `workload_type = "StatefulSet"`. |
| `stateful_pod_management_policy` | `"OrderedReady"` | `OrderedReady` / `Parallel` | Controls StatefulSet pod creation and deletion ordering. **`OrderedReady`:** pods are started one at a time in sequence, each waiting for the previous to be ready. Ensures database connection and Hazelcast cluster formation complete before the next pod starts. **`Parallel`:** all pods start simultaneously. Use only if the application supports concurrent startup without coordination. |
| `stateful_update_strategy` | `"RollingUpdate"` | `RollingUpdate` / `OnDelete` | Controls how StatefulSet pods are updated when the pod spec changes. **`RollingUpdate`:** pods are updated automatically one at a time. **`OnDelete`:** pods are updated only when manually deleted. Use `OnDelete` when you need explicit control over the update sequence during Cyclos version upgrades. |

---

## Password Rotation Propagation Delay

The `rotation_propagation_delay_sec` variable is used together with `enable_auto_password_rotation` (documented in [App_GKE_Guide Group 10](../App_GKE/App_GKE_Guide.md#group-10-database-configuration)) to control how long the module waits after writing a new database password to Secret Manager before restarting the GKE pods to pick up the new credentials.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `rotation_propagation_delay_sec` | `90` | Integer (seconds) | Seconds to wait after updating the `DB_PASSWORD` secret before triggering a rolling restart of the Cyclos Deployment. This delay allows Secret Manager's global replication to complete so the new secret version is available in all regions before pods are restarted. **Increase to `120`** in multi-region deployments or if you observe rotation failures where pods start before the new secret has fully propagated. Only used when `enable_auto_password_rotation = true`. |

---

## Resource Creator Identity

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `resource_creator_identity` | `"rad-module-creator@tec-rad-ui-2b65.iam.gserviceaccount.com"` | Service account email | The service account used by Terraform to create and manage GCP resources. For enhanced security, replace with a project-scoped service account that has been granted only the minimum permissions required. |

---

## Deployment Prerequisites & Validation

After deploying `Cyclos GKE`, confirm the deployment is healthy:

```bash
# Confirm the Cyclos pod is running and ready
kubectl get pods -n NAMESPACE -l app=cyclos -o wide

# Confirm all required PostgreSQL extensions are installed
# (Run after the db-init job completes)
gcloud sql connect INSTANCE_NAME --user=postgres --database=cyclos --project=PROJECT_ID
# Inside psql: \dx

# View the GCS bucket provisioned for Cyclos file storage
gcloud storage buckets list \
  --project=PROJECT_ID \
  --filter="name:cyclos"

# Confirm the Cyclos service has an external IP
kubectl get svc -n NAMESPACE -l app=cyclos

# Access the Cyclos web interface (after pods are ready)
# Open: http://EXTERNAL_IP:8080/ in a browser
```
