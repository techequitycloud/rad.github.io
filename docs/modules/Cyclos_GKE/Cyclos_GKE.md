# Cyclos_GKE Module — Configuration Guide

Cyclos is a professional banking and payment system designed for microfinance institutions, credit unions, complementary currency schemes, and community banks. This module deploys Cyclos on **GKE Autopilot** using the official `cyclos/cyclos` container image, backed by a managed Cloud SQL PostgreSQL instance.

`Cyclos_GKE` is a **wrapper module** built on top of `App_GKE`. It uses `App_GKE` for all GCP infrastructure provisioning (cluster, networking, Cloud SQL, GCS, secrets, CI/CD) and adds Cyclos-specific application configuration on top.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How This Guide Is Structured

This guide documents only the variables that are **unique to `Cyclos_GKE`** or that have **Cyclos-specific defaults** that differ from the `App_GKE` base module. For all other variables — project identity, runtime scaling, backend configuration, storage, CI/CD, observability, networking, IAP, and Cloud Armor — refer directly to the [App_GKE Module Guide](../App_GKE/App_GKE.md).

**Variables fully covered by the App_GKE guide:**

| Configuration Area | App_GKE.md Section | Cyclos-Specific Notes |
|---|---|---|
| Project & Identity | §2 IAM & Access Control | Refer to base App_GKE module documentation. |
| Runtime & Scaling | §3.A Compute (GKE Autopilot) | See [Cyclos Runtime Configuration](#cyclos-runtime-configuration) below for Cyclos-specific resource sizing. `container_image` defaults to `cyclos/cyclos`; `container_image_source` defaults to `prebuilt`. |
| Environment Variables & Secrets | (General config) | See [Cyclos Environment Variables](#cyclos-environment-variables) below for Cyclos-specific defaults. |
| GKE Backend Configuration | §3.A, §3.D | Refer to base App_GKE module documentation. |
| Jobs & Scheduled Tasks | §3.E Initialization Jobs & CronJobs | Refer to base App_GKE module documentation. |
| Additional Services | §3.F Additional Services | Refer to base App_GKE module documentation. |
| Storage — NFS | §3.C Storage | NFS is **disabled by this module**. See [Platform-Managed Behaviours](#platform-managed-behaviours). |
| Storage — GCS | §3.C Storage | Refer to base App_GKE module documentation. |
| Cloud Armor WAF | §4.A Cloud Armor WAF | Refer to base App_GKE module documentation. |
| Identity-Aware Proxy | §4.B Identity-Aware Proxy (IAP) | Refer to base App_GKE module documentation. |
| Binary Authorization | §4.C Binary Authorization | Refer to base App_GKE module documentation. |
| VPC Service Controls | §4.D VPC Service Controls | Refer to base App_GKE module documentation. |
| Secrets Store CSI Driver | §4.E Secrets Store CSI Driver | Refer to base App_GKE module documentation. |
| Traffic & Ingress | §5 Traffic & Ingress | Refer to base App_GKE module documentation. |
| CI/CD & Cloud Build | §6.A Cloud Build Triggers | Refer to base App_GKE module documentation. |
| Cloud Deploy Pipeline | §6.B Cloud Deploy Pipeline | Refer to base App_GKE module documentation. |
| Image Mirroring | §6.C Image Mirroring | Refer to base App_GKE module documentation. |
| Pod Disruption Budgets | §7.A Pod Disruption Budgets | Refer to base App_GKE module documentation. |
| Topology Spread Constraints | §7.B Topology Spread Constraints | Refer to base App_GKE module documentation. |
| Resource Quotas | §7.C Resource Quotas | Refer to base App_GKE module documentation. |
| Auto Password Rotation | §7.D Auto Password Rotation | See [Password Rotation Propagation Delay](#password-rotation-propagation-delay) below for Cyclos-specific notes. |
| Backup Import & Recovery | §8.B Backup Import | See [Backup Import & Recovery](#backup-import--recovery) below. |
| Service Mesh (ASM) | §8.C Service Mesh (ASM via Fleet) | Refer to base App_GKE module documentation. |
| Multi-Cluster Services | §8.D Multi-Cluster Services (MCS) | Refer to base App_GKE module documentation. |
| Backup Schedule & Retention | (General config) | Refer to base App_GKE module documentation. |
| Custom SQL Scripts | §3.E Initialization Jobs & CronJobs | Refer to base App_GKE module documentation. |
| Observability & Health | (General config) | See [Cyclos Health Probes](#cyclos-health-probes) below for Cyclos-specific defaults. |

---

## Platform-Managed Behaviours

The following behaviours are applied automatically by `Cyclos_GKE` regardless of the variable values in your `tfvars` file. They cannot be overridden by user configuration.

| Behaviour | Detail |
|---|---|
| **NFS disabled** | `enable_nfs` is forced to `false` in the application configuration. Cyclos stores uploaded files and media in the GCS bucket provisioned by the module (`cyclos.storedFileContentManager = gcs`), making a shared NFS filesystem unnecessary. |
| **GCS file storage** | `cyclos.storedFileContentManager = gcs` is injected automatically. The GCS bucket name is derived from the deployment identifiers and injected as `cyclos.storedFileContentManager.bucketName`. |
| **Schema management** | `cyclos.db.managed = true` is set, allowing Cyclos to create and evolve its own database schema on startup. Do not run manual schema migrations against a Cyclos database managed this way. |
| **PostgreSQL extensions** | The following extensions are automatically installed in the application database during the initialisation job: `pg_trgm`, `uuid-ossp`, `cube`, `earthdistance`, `postgis`, `unaccent`. These are required by Cyclos and are installed before the application starts. |
| **Database initialisation** | A dedicated `cyclos` database user is created with the password from Secret Manager and granted the permissions required by the application. The `postgres` superuser is used only for the extension and user setup jobs. |

---

## Cyclos Application Identity

These variables control how the Cyclos deployment is named and described. `Cyclos_GKE` exposes two parallel sets: `display_name`/`description` are passed to `Cyclos_Common` (and surface in the application config object), while `application_display_name`/`application_description` are passed directly to `App_GKE` (and surface in GKE workload annotations and the platform UI).

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_name` | `"cyclos"` | `[a-z][a-z0-9-]{0,19}` | Internal identifier used as the base name for GKE workloads, Cloud SQL, GCS buckets, and Artifact Registry. Functionally identical to `application_name` in App_GKE. **Do not change after initial deployment.** |
| `application_version` | `"4.16.17"` | Cyclos version string, e.g. `"4.16.17"` | Version tag applied to the container image. Use the official Cyclos release version matching the image you intend to deploy. See the [Cyclos release notes](https://www.cyclos.org/releaseNotes) for available versions. When `container_image_source = "prebuilt"`, this controls which tagged image is pulled from Docker Hub. |
| `display_name` | `"Cyclos Community Edition"` | Any string | Human-readable name passed to `Cyclos_Common` and used in the application config object. Can be updated freely without affecting resource names. |
| `description` | `"Cyclos Banking System on GKE"` | Any string | Description passed to `Cyclos_Common` and used in the application config object. |
| `application_display_name` | `"Cyclos Community Edition"` | Any string | Human-readable name passed directly to `App_GKE` for GKE workload annotations and platform UI display. Equivalent to `application_display_name` in App_GKE. Can be updated freely without affecting resource names. |
| `application_description` | `"Cyclos Community Edition on GKE Autopilot"` | Any string | Description passed directly to `App_GKE` for Kubernetes deployment annotations and platform documentation. Equivalent to `application_description` in App_GKE. |

### Validating Application Identity

```bash
# Confirm the Deployment exists with the expected name
kubectl get deployments -n NAMESPACE -o wide

# View workload annotations (description is stored here)
kubectl describe deployment cyclos -n NAMESPACE | grep -A5 Annotations
```

---

## Cyclos Runtime Configuration

Cyclos is a Java application and requires significantly more CPU and memory than a typical web service. `Cyclos_GKE` exposes **two complementary mechanisms** for setting resource limits:

1. **`container_resources`** (object, default `{ cpu_limit = "1000m", memory_limit = "2Gi" }`) — the primary resource configuration passed directly to `App_GKE`. This variable always takes effect and overrides the dedicated `cpu_limit`/`memory_limit` variables below.
2. **`cpu_limit` / `memory_limit`** (dedicated string variables, defaults `"2000m"` / `"4Gi"`) — convenience variables passed to `Cyclos_Common` to build the initial `container_resources` object. These are overridden by `container_resources` whenever `container_resources` is set (which includes its default value).

**In practice, configure resource limits using `container_resources` directly.** The defaults from `container_resources` (`cpu_limit = "1000m"`, `memory_limit = "2Gi"`) are lower than the Cyclos-recommended minimums — override them in your `tfvars`:

```hcl
container_resources = {
  cpu_limit    = "2000m"
  memory_limit = "4Gi"
}
```

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | Kubernetes quantity object | Full resource spec for the Cyclos container. Takes precedence over `cpu_limit` and `memory_limit`. Use this to set `cpu_request`, `mem_request`, or `ephemeral_storage_limit` in addition to limits. **Set `cpu_limit` to at least `"2000m"` and `memory_limit` to at least `"2Gi"` for reliable Cyclos operation.** `"4Gi"` memory is recommended for production. |
| `cpu_limit` | `"2000m"` | Kubernetes CPU quantity string (e.g. `"2000m"`, `"2"`) | Passed to `Cyclos_Common` for its internal config object. Effective only if `container_resources` is not set in your `tfvars` (which is unusual since it has a non-null default). |
| `memory_limit` | `"4Gi"` | Kubernetes memory quantity string (e.g. `"4Gi"`, `"2Gi"`) | Passed to `Cyclos_Common` for its internal config object. Effective only if `container_resources` is not set in your `tfvars`. |

**Cyclos-specific runtime defaults that differ from App_GKE:**

| Variable | App_GKE Default | Cyclos_GKE Default | Reason |
|---|---|---|---|
| `container_image_source` | `"custom"` | `"prebuilt"` | The official `cyclos/cyclos` Docker Hub image is production-ready and pre-configured. |
| `container_image` | `""` | `"cyclos/cyclos"` | The official Cyclos image from Docker Hub. |
| `max_instance_count` | `1` | `1` | Cyclos clustering requires Hazelcast configuration. The default of `1` ensures a stable single-instance deployment. Increase only after configuring Hazelcast discovery. |

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

Cyclos requires PostgreSQL. The module uses `db_name` and `db_user` (shorter names aligned with the Cyclos_Common interface) in place of the `application_database_name` and `application_database_user` variables documented in [App_GKE.md §3.B](../App_GKE/App_GKE.md#b-database-cloud-sql).

All other database variables (`database_type`, `sql_instance_name`, `database_password_length`, `enable_auto_password_rotation`, `rotation_propagation_delay_sec`, etc.) behave identically to the App_GKE equivalents — refer to [App_GKE.md §3.B](../App_GKE/App_GKE.md#b-database-cloud-sql) for their documentation.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `db_name` | `"cyclos"` | `[a-z][a-z0-9_]{0,62}` | The name of the PostgreSQL database created within the Cloud SQL instance. Injected as the `DB_NAME` environment variable. **Do not change after initial deployment** — Cyclos stores all application data in this database and renaming it requires manual migration. |
| `db_user` | `"cyclos"` | `[a-z][a-z0-9_]{0,31}` | The PostgreSQL user created for the Cyclos application. Injected as the `DB_USER` environment variable. The password is auto-generated, stored in Secret Manager, and injected as `DB_PASSWORD`. |

> **Important:** Cyclos requires PostgreSQL. The `database_type` variable is exposed in `Cyclos_GKE` and defaults to `"POSTGRES"` (latest managed Cloud SQL PostgreSQL version). `Cyclos_Common` configures `"POSTGRES_15"` in its config output, but since `cyclos.tf` merges `var.database_type` on top of the Cyclos_Common config, the effective default is the value of `var.database_type` (`"POSTGRES"`). You may override this to a specific version such as `"POSTGRES_15"`. Setting `database_type = "NONE"` or a MySQL/SQL Server type will prevent the application from starting.

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

The `environment_variables` variable in `Cyclos_GKE` defaults to an empty map (`{}`). There are no SMTP defaults set at the module level — unlike `Cyclos_CloudRun`, which pre-populates SMTP placeholder values. You must explicitly supply SMTP configuration if Cyclos email delivery is required.

Configure SMTP settings before going live. For sensitive values such as `SMTP_PASSWORD`, use `secret_environment_variables` instead of `environment_variables`:

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

The core runtime environment variables (`DB_HOST`, `DB_PORT`, `CYCLOS_HOME`, `cyclos.storedFileContentManager`, and `cyclos.storedFileContentManager.bucketName`) are injected automatically via `Cyclos_Common` and do not need to be set manually.

All other `environment_variables` and `secret_environment_variables` behaviour is identical to App_GKE.

---

## Cyclos Health Probes

Cyclos is a Java application that performs database schema validation and migration on first boot. This startup phase can take 2–5 minutes on a fresh deployment, much longer than a typical web service.

`Cyclos_GKE` exposes **two separate sets** of probe variables with different routing:

*   **`startup_probe` / `liveness_probe`** — Cyclos-specific variables passed to `Cyclos_Common`, which uses them to configure the Cyclos container probe spec. Both target the `/api` endpoint and have extended timeouts suited to JVM startup.
*   **`startup_probe_config` / `health_check_config`** — App_GKE-standard variables passed directly to `App_GKE`. These also default to `/api` in `Cyclos_GKE` but use App_GKE's standard (shorter) timeout defaults.

In practice, use `startup_probe` and `liveness_probe` to tune Cyclos probe behaviour. The `startup_probe_config` / `health_check_config` variables are available for compatibility but are not the primary probe path for the Cyclos container.

| Variable | Default | Description & Implications |
|---|---|---|
| `startup_probe` | `{ enabled = true, type = "HTTP", path = "/api", initial_delay_seconds = 90, timeout_seconds = 30, period_seconds = 60, failure_threshold = 5 }` | Determines when the container is ready to receive traffic after starting. The `initial_delay_seconds = 90` gives the JVM time to start and Cyclos time to validate or create the database schema before the first probe fires. `failure_threshold = 5` with `period_seconds = 60` allows up to 5 minutes of additional startup time beyond the initial delay. **On first deployment** (when the schema is created from scratch), startup may take longer than usual — consider increasing `failure_threshold` to `10` for the initial rollout. |
| `liveness_probe` | `{ enabled = true, type = "HTTP", path = "/api", initial_delay_seconds = 120, timeout_seconds = 10, period_seconds = 60, failure_threshold = 3 }` | Periodically checks whether a running Cyclos instance is healthy. The `initial_delay_seconds = 120` prevents premature restarts during the startup phase (after the startup probe has passed). A `period_seconds = 60` check interval is appropriate for a database-backed application — more frequent checks would add unnecessary load. |

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

## Redis

Redis is **not supported** by `Cyclos_GKE`. The `enable_redis` variable is not exposed — it is hardcoded to `false` in the module and passed directly to `App_GKE`. The `redis_host`, `redis_port`, and `redis_auth` variables are not available.

Cyclos manages its own session state and caching internally (via Hazelcast for clustering). If multi-instance session sharing is required, configure Hazelcast discovery via `environment_variables` rather than Redis.

---

## Backup Import & Recovery

In addition to the scheduled backup (`backup_schedule` and `backup_retention_days`, documented in [App_GKE.md §3.B](../App_GKE/App_GKE.md#b-database-cloud-sql)), `Cyclos_GKE` supports a **one-time import** of an existing Cyclos database backup during deployment. This is designed for migrating an existing Cyclos instance to GCP or seeding a new environment with production data.

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

When `workload_type = "StatefulSet"` is set (see [App_GKE.md §3.A](../App_GKE/App_GKE.md#a-compute-gke-autopilot)), the following variables configure the per-pod **PersistentVolumeClaim** automatically created for each StatefulSet replica.

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

The `rotation_propagation_delay_sec` variable is used together with `enable_auto_password_rotation` (documented in [App_GKE.md §7.D](../App_GKE/App_GKE.md#d-auto-password-rotation)) to control how long the module waits after writing a new database password to Secret Manager before restarting the GKE pods to pick up the new credentials.

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

After deploying `Cyclos_GKE`, confirm the deployment is healthy:

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
