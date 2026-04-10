---
title: "OpenEMR Cloud Run Configuration Guide"
sidebar_label: "Cloud Run"
---

# OpenEMR_CloudRun Module — Configuration Guide

<video width="100%" controls style={{marginTop: '20px'}} poster="https://storage.googleapis.com/rad-public-2b65/modules/OpenEMR_CloudRun.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/modules/OpenEMR_CloudRun.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

<a href="https://storage.googleapis.com/rad-public-2b65/modules/OpenEMR_CloudRun.pdf" target="_blank">View Presentation (PDF)</a>

OpenEMR is a leading open-source electronic health records (EHR) and medical practice management platform used by clinics, hospitals, and healthcare providers worldwide. This module deploys OpenEMR on **Google Cloud Run Gen 2** using a custom container image built on Alpine 3.20 with Apache and PHP 8.3 FPM, backed by a managed Cloud SQL MySQL 8.0 instance connected via Unix socket, and a Filestore NFS volume for persistent patient document and sites directory storage.

`OpenEMR_CloudRun` is a **wrapper module** built on top of `App_CloudRun`. It uses `App_CloudRun` for all GCP infrastructure provisioning (Cloud Run service, networking, Cloud SQL, GCS, secrets, CI/CD) and adds OpenEMR-specific application configuration, initialisation jobs, health probes, and runtime defaults on top.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How This Guide Is Structured

This guide documents only the variables that are **unique to `OpenEMR_CloudRun`** or that have **OpenEMR-specific defaults** that differ from the `App_CloudRun` base module. For all other variables — project identity, CI/CD, custom SQL, load balancer, VPC Service Controls, and Cloud Deploy — refer directly to the [App_CloudRun Configuration Guide](../App_CloudRun/App_CloudRun_Guide.md).

**Variables fully covered by the App_CloudRun guide:**

| Configuration Area | App_CloudRun_Guide Section | OpenEMR-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | Group 0 | Different defaults for `module_description` and `module_documentation`. `resource_creator_identity` behaves identically. |
| Project & Identity | Group 1 | Refer to base App_CloudRun module documentation. |
| Runtime & Scaling | Group 3 | See [OpenEMR Runtime Configuration](#openemr-runtime-configuration) below. `container_port` defaults to `80`. `execution_environment` must remain `"gen2"` for NFS support. |
| Environment Variables & Secrets | Group 4/5 | See [OpenEMR Environment Variables](#openemr-environment-variables) below for PHP and SMTP configuration. |
| Observability & Health | Group 12/13 | See [OpenEMR Health Probes](#openemr-health-probes) below. The module uses **`startup_probe`** and **`liveness_probe`** (OpenEMR-specific names). |
| Jobs & Scheduled Tasks | Group 12 | Refer to base App_CloudRun module documentation. The module injects a platform-managed `nfs-init` initialisation job — see [Platform-Managed Behaviours](#platform-managed-behaviours). |
| CI/CD & GitHub Integration | Group 7 | Refer to base App_CloudRun module documentation. Cloud Deploy (`enable_cloud_deploy`, `cloud_deploy_stages`) is also available. |
| Storage — NFS | Group 10 | NFS is **enabled by default** (`enable_nfs = true`). Requires `execution_environment = "gen2"` (the default). See [NFS & Patient Document Storage](#nfs--patient-document-storage) below. |
| Storage — GCS | Group 10 | Refer to base App_CloudRun module documentation. |
| Redis Cache | Group 20 | See [Redis Session Store](#redis-session-store) below. `enable_redis` defaults to `true`. |
| Backup & Maintenance | Group 6 | Refer to base App_CloudRun module documentation for `backup_schedule` and `backup_retention_days`. See also [Backup Import & Recovery](#backup-import--recovery) below. |
| Custom Initialisation & SQL | Group 8 | Refer to base App_CloudRun module documentation. |
| Access & Networking | Group 5 | Refer to base App_CloudRun module documentation (`ingress_settings`, `vpc_egress_setting`). See [OpenEMR Networking Defaults](#openemr-networking-defaults) below for OpenEMR-specific values. |
| Load Balancer & CDN | Group 13 | Refer to base App_CloudRun module documentation (`enable_cloud_armor`, `enable_cdn`, `application_domains`). |
| Identity-Aware Proxy | Group 5 | Refer to base App_CloudRun module documentation. |
| VPC Service Controls | Group 21 | Refer to base App_CloudRun module documentation. |
| Traffic Splitting | Group 3 | Refer to base App_CloudRun module documentation (`traffic_split`). |

---

## Platform-Managed Behaviours

The following behaviours are applied automatically by `OpenEMR_CloudRun` regardless of the variable values in your `tfvars` file. They cannot be overridden by user configuration.

| Behaviour | Detail |
|---|---|
| **NFS directory initialisation** | An `nfs-init` Cloud Run Job runs automatically on deployment. It mounts the Filestore NFS share, sets ownership of the `sites` directory to UID `1000` (the Apache process user), downloads and restores a backup if `backup_uri` is set, and regenerates `sqlconf.php` with current database credentials. This job must complete before OpenEMR can serve traffic. |
| **OE_PASS secret** | An OpenEMR admin password is auto-generated and stored in Secret Manager. It is injected into the container as the `OE_PASS` environment variable via Secret Manager reference (not in plaintext). OpenEMR uses this to set the administrator account on first boot. |
| **MYSQL_PASS secret** | The MySQL database password generated by `App_CloudRun` is automatically injected as the `MYSQL_PASS` environment variable. Do not define this manually in `secret_environment_variables`. |
| **Cloud SQL Unix socket** | The Cloud SQL instance is connected via a Unix socket mounted at `/cloudsql` inside the container (`cloudsql_volume_mount_path = "/cloudsql"`). OpenEMR's `sqlconf.php` is configured to use this socket path. This is applied unconditionally and is not configurable by the user. |
| **BACKUP_FILEID injection** | When `backup_uri` is set, it is automatically injected into the `nfs-init` job as the `BACKUP_FILEID` environment variable, triggering backup restoration during deployment. |

---

## OpenEMR Application Identity

These variables define how the OpenEMR deployment is named across GCP resources.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_name` | `"openemr"` | `[a-z][a-z0-9-]{0,19}` | Internal identifier used as the base name for the Cloud Run service, Artifact Registry repository, Secret Manager secrets, and GCS buckets. Functionally identical to `application_name` in App_CloudRun. **Do not change after initial deployment.** |
| `display_name` | `"OpenEMR"` | Any string | Human-readable name shown in the platform UI, Cloud Run service list, and monitoring dashboards. Can be updated freely without affecting resource names. |
| `description` | `"Initialize NFS directories for OpenEMR and restore backup if provided"` | Any string | Description populates the Cloud Run service description field and is used in the `nfs-init` job. Can be updated freely. |
| `application_version` | `"7.0.4"` | OpenEMR version string, e.g. `"7.0.4"`, `"7.0.3"` | The OpenEMR release version, used as the container image tag. When `container_image_source = "custom"`, changing this value triggers a new Cloud Build run that builds the specified version. |

### Validating Application Identity

```bash
# Confirm the Cloud Run service exists with the expected name
gcloud run services describe openemr \
  --region=REGION \
  --format="table(metadata.name,metadata.annotations['run.googleapis.com/description'])"

# Confirm the running container image tag
gcloud run services describe openemr \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].image)"
```

---

## OpenEMR Runtime Configuration

OpenEMR is a PHP/MySQL EHR application running on Apache. It requires more CPU and memory than a typical Cloud Run service, particularly during initial database installation and on first boot.

### Container Port

| Variable | Default | Description & Implications |
|---|---|---|
| `container_port` | `80` | The port Apache listens on inside the container. Cloud Run routes incoming HTTP traffic to this port. **Do not change this** unless you have modified the Apache configuration to bind on a different port. |

### Execution Environment

| Variable | Default | Description & Implications |
|---|---|---|
| `execution_environment` | `"gen2"` | **Must remain `"gen2"`** for NFS volume support. Cloud Run Gen 2 provides full Linux kernel compatibility required for NFS mounts. Setting `"gen1"` will prevent NFS volumes from mounting and OpenEMR will fail to start. |

### Resource Sizing

`OpenEMR_CloudRun` exposes `cpu_limit` and `memory_limit` as **dedicated top-level variables**.

| Variable | Module Default | Recommended for Production |
|---|---|---|
| `cpu_limit` | `"2000m"` | `"2000m"` or higher |
| `memory_limit` | `"4Gi"` | `"4Gi"` (minimum `"2Gi"`) |

OpenEMR's PHP-FPM worker processes and database connection pool together consume 1.5–3 Gi of memory under normal load. Setting `memory_limit` below `"2Gi"` will cause OOM kills during peak clinical activity.

> **Note:** Cloud Run CPU allocations above `"1000m"` require `min_instance_count >= 1` (CPU is always allocated). The default `cpu_limit = "2000m"` combined with `min_instance_count = 1` ensures CPU is always available, eliminating cold-start latency that would be unacceptable for clinical users.

**Recommended production configuration:**
```hcl
cpu_limit          = "2000m"
memory_limit       = "4Gi"
min_instance_count = 1
max_instance_count = 1
```

### Scaling Defaults

| Variable | App_CloudRun Default | OpenEMR_CloudRun Default | Reason |
|---|---|---|---|
| `min_instance_count` | `0` | `1` | OpenEMR must always have at least one warm instance to provide immediate access for clinical users. Scale-to-zero is not appropriate for healthcare applications. |
| `max_instance_count` | `1` | `1` | OpenEMR's PHP session handling relies on the shared NFS mount. Multi-instance deployments require Redis session storage (`enable_redis = true`). Increase only after confirming Redis is operational. |

### Validating Runtime Configuration

```bash
# View CPU and memory limits on the latest revision
gcloud run services describe openemr \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].resources)"

# Confirm the execution environment is gen2
gcloud run services describe openemr \
  --region=REGION \
  --format="yaml(spec.template.metadata.annotations['run.googleapis.com/execution-environment'])"

# Confirm minimum instance count
gcloud run services describe openemr \
  --region=REGION \
  --format="yaml(spec.template.metadata.annotations['autoscaling.knative.dev/minScale'])"
```

---

## OpenEMR Health Probes

OpenEMR performs database connection validation and, on first boot, runs the full database installation process. This startup phase can take 5–20 minutes on a fresh deployment. `OpenEMR_CloudRun` uses **two sets of probe variable names**:

- **`startup_probe` and `liveness_probe`** — the primary OpenEMR probe variables, passed to the OpenEMR_Common module. These are the variables you should configure.
- `startup_probe_config` and `health_check_config` — the App_CloudRun base interface names, also present and passed to App_CloudRun directly.

Prefer `startup_probe` and `liveness_probe` when tuning OpenEMR probe behaviour.

| Variable | Default | Description & Implications |
|---|---|---|
| `startup_probe` | `{ enabled = true, type = "TCP", path = "/", initial_delay_seconds = 0, timeout_seconds = 5, period_seconds = 10, failure_threshold = 12 }` | Uses a **TCP port check** on port 80 rather than an HTTP endpoint. A TCP probe is more reliable during OpenEMR's boot phase, when Apache may be accepting connections before PHP-FPM and the database are fully initialised. With `period_seconds = 10` and `failure_threshold = 12`, Cloud Run allows up to 120 seconds of startup time. **On first deployment** (when the database schema is created from scratch), consider increasing `failure_threshold` to `30` or setting `initial_delay_seconds = 120` to allow for the full OpenEMR installation wizard to complete. |
| `liveness_probe` | `{ enabled = true, type = "HTTP", path = "/interface/login/login.php", initial_delay_seconds = 0, timeout_seconds = 10, period_seconds = 30, failure_threshold = 10 }` | Periodically checks that the OpenEMR login page is reachable. The `/interface/login/login.php` endpoint returns HTTP 200 only when Apache, PHP-FPM, and the database connection are all operational. `period_seconds = 30` and `failure_threshold = 10` allow up to 5 minutes of recovery time before Cloud Run restarts the container. |

> **Relationship to App_CloudRun probes:** `startup_probe` configures the Cloud Run startup probe passed through OpenEMR_Common; `startup_probe_config` configures the startup probe directly on the App_CloudRun module. In practice, the OpenEMR-specific probe applied to the container revision is the one from `startup_probe` / `liveness_probe`.

### Validating Health Probes

**Google Cloud Console:** Navigate to **Cloud Run → Services → openemr → Revisions**, select the latest revision, click **Container(s)**, and view the **Health checks** section.

```bash
# View startup and liveness probe configuration on the latest revision
gcloud run services describe openemr \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].livenessProbe,spec.template.spec.containers[0].startupProbe)"

# Monitor Cloud Run logs for probe failures or startup errors
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=openemr AND severity>=WARNING" \
  --project=PROJECT_ID \
  --limit=20 \
  --format="table(timestamp,severity,textPayload)"

# Manually test the login page endpoint
curl -s -o /dev/null -w "%{http_code}" https://SERVICE_URL/interface/login/login.php
# Expect: 200
```

---

## OpenEMR Database Configuration

OpenEMR requires MySQL 8.0. The database is provisioned by the underlying `App_CloudRun` module — see [App_CloudRun_Guide Group 11](../App_CloudRun/App_CloudRun_Guide.md#group-11-database-backend) for the full variable reference.

The following defaults are **OpenEMR-specific** and set appropriately out of the box:

| Variable | App_CloudRun Default | OpenEMR_CloudRun Default | Description |
|---|---|---|---|
| `db_name` | `"appdb"` | `"openemr"` | The MySQL database created for OpenEMR. Injected into the `sqlconf.php` configuration file. |
| `db_user` | `"appuser"` | `"openemr"` | The MySQL user for the application. Injected into the OpenEMR configuration. |
| `database_type` | `"MYSQL_8_0"` | `"MYSQL_8_0"` | **Must remain MySQL 8.0.** OpenEMR does not support PostgreSQL or other database engines. |

> **Database connection method:** OpenEMR connects to Cloud SQL via a **Unix socket** mounted at `/cloudsql` inside the container (`cloudsql_volume_mount_path`). This is the recommended connection method for Cloud Run services and is enforced by the platform. TCP connections to Cloud SQL are not used.

### Validating Database Configuration

```bash
# Confirm the database and user were created
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID

gcloud sql users list --instance=INSTANCE_NAME --project=PROJECT_ID

# Confirm the DB password secret is injected into the Cloud Run service
gcloud run services describe openemr \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -E "MYSQL_PASS"
```

---

## OpenEMR Environment Variables

The `environment_variables` variable (documented in [App_CloudRun_Guide Group 4](../App_CloudRun/App_CloudRun_Guide.md#group-4-environment-variables--secrets)) can be used to set any PHP or SMTP configuration consumed by the OpenEMR container's startup script.

**Commonly configured environment variables:**

```hcl
environment_variables = {
  PHP_MEMORY_LIMIT = "512M"    # PHP memory limit; increase for large patient datasets
  SMTP_HOST        = ""        # SMTP server for outbound email notifications
  SMTP_PORT        = "25"      # SMTP server port
  SMTP_USER        = ""        # SMTP authentication username
  SMTP_SSL         = "false"   # Set to "true" for TLS/SSL SMTP connections
  EMAIL_FROM       = "openemr@example.com"
}
```

Configure `PHP_MEMORY_LIMIT` before going live if your deployment handles large numbers of concurrent patients or generates complex clinical reports. Move sensitive values to `secret_environment_variables`:

```hcl
environment_variables = {
  PHP_MEMORY_LIMIT = "512M"
  SMTP_HOST        = "smtp.sendgrid.net"
  SMTP_PORT        = "587"
  SMTP_USER        = "apikey"
  SMTP_SSL         = "true"
  EMAIL_FROM       = "noreply@yourclinic.example.com"
}

secret_environment_variables = {
  SMTP_PASSWORD = "openemr-smtp-password"   # Secret Manager secret name
}
```

All other `environment_variables` and `secret_environment_variables` behaviour is identical to App_CloudRun — refer to [App_CloudRun_Guide Group 4](../App_CloudRun/App_CloudRun_Guide.md#group-4-environment-variables--secrets).

---

## OpenEMR Networking Defaults

The following networking variables have OpenEMR-specific defaults that differ from the `App_CloudRun` base module. For the full variable reference and all available options, refer to [App_CloudRun_Guide Group 5](../App_CloudRun/App_CloudRun_Guide.md#group-5-access--networking-cloud-run).

| Variable | App_CloudRun Default | OpenEMR_CloudRun Default | Recommendation |
|---|---|---|---|
| `ingress_settings` | `"all"` | `"all"` | Allows public internet access. For HIPAA-compliant deployments, consider `"internal-and-cloud-load-balancing"` combined with Cloud Armor WAF to restrict and protect access to the EHR. |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | `"PRIVATE_RANGES_ONLY"` | Routes only RFC 1918 private IP traffic (Cloud SQL, NFS server, Redis) through the VPC. Public traffic exits directly. Change to `"ALL_TRAFFIC"` if your organisation requires all egress to pass through a centralised network appliance. |

---

## NFS & Patient Document Storage

OpenEMR stores patient-uploaded documents, the `sites` directory configuration, and application state on a shared NFS volume. NFS is **enabled by default** (`enable_nfs = true`) because OpenEMR cannot function correctly without persistent shared storage across container restarts.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_nfs` | `true` | `true` / `false` | **Must remain `true`** for a functional OpenEMR deployment. Setting to `false` will prevent the `nfs-init` job from running and OpenEMR will fail to persist patient data across instance restarts. |
| `nfs_mount_path` | `"/var/www/localhost/htdocs/openemr/sites"` | Filesystem path | The path inside the container where the NFS volume is mounted. This maps directly to OpenEMR's `sites` directory. **Do not change this** unless you have modified the OpenEMR container to use a different sites path. |

> **Gen 2 requirement:** NFS volume mounts require `execution_environment = "gen2"`, which is the default. Never change the execution environment to `"gen1"` when NFS is enabled.

For the full NFS variable reference (Filestore instance sizing, capacity, etc.), refer to [App_CloudRun_Guide Group 9](../App_CloudRun/App_CloudRun_Guide.md#group-9-storage--filesystem--nfs).

### Validating NFS Storage

```bash
# Confirm the nfs-init job completed successfully
gcloud run jobs executions list \
  --job=openemr-nfs-init \
  --region=REGION \
  --format="table(name,status.conditions[0].type,status.startTime,status.completionTime)"

# View nfs-init job logs to confirm directory setup and any backup restoration
gcloud logging read \
  "resource.type=cloud_run_job AND resource.labels.job_name=openemr-nfs-init" \
  --project=PROJECT_ID \
  --limit=30 \
  --order=asc \
  --format="table(timestamp,severity,textPayload)"
```

---

## Redis Session Store

OpenEMR supports Redis as a shared PHP session store. Redis is **enabled by default** (`enable_redis = true`) and is **required** for multi-instance deployments (`max_instance_count > 1`) — without it, each instance has its own PHP session store and users will experience session loss when their requests land on a different instance.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `true` | `true` / `false` | When `true`, OpenEMR is configured to use Redis for PHP session storage via `session.save_handler = redis`. The `REDIS_SERVER` environment variable is set automatically. If `redis_host` is left blank, the module defaults to using the NFS server IP, which runs a co-located Redis instance. |
| `redis_host` | `""` | IP address or hostname | The Redis server hostname or IP. When left empty and `enable_redis = true`, the module uses the NFS server IP. Override with a dedicated Google Memorystore for Redis instance IP for higher-availability production deployments. |
| `redis_port` | `"6379"` | Port string | The Redis port. Change only if your Redis instance uses a non-standard port. |

For a full description of the Redis variables and Memorystore configuration guidance, refer to [App_CloudRun_Guide Group 20](../App_CloudRun/App_CloudRun_Guide.md#group-20-redis-cache).

### Validating Redis Configuration

```bash
# Confirm the REDIS_SERVER environment variable is set on the Cloud Run service
gcloud run services describe openemr \
  --region=REGION \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -E "REDIS"
```

---

## Backup Import & Recovery

In addition to the scheduled backup (`backup_schedule` and `backup_retention_days`, documented in [App_CloudRun_Guide Group 6](../App_CloudRun/App_CloudRun_Guide.md#group-6-backup--maintenance)), `OpenEMR_CloudRun` supports a one-time backup restoration during deployment via the `nfs-init` job. Use this to migrate an existing OpenEMR instance to GCP or to seed a new environment with production data.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_backup_import` | `false` | `true` / `false` | When `true`, the `backup_uri` is injected into the `nfs-init` job as `BACKUP_FILEID`, triggering restoration of the backup during deployment. Configure `backup_source`, `backup_uri`, and `backup_format` before enabling. |
| `backup_source` | `"gcs"` | `gcs` / `gdrive` | `"gcs"` to import from a Cloud Storage path; `"gdrive"` to import from a Google Drive file ID. GCS is recommended for production due to better security and performance. |
| `backup_uri` | `""` | GCS URI or Drive file ID | For GCS: the full object URI (e.g., `"gs://my-bucket/backups/openemr.sql"`). For Google Drive: the file ID from the share URL. |
| `backup_format` | `"sql"` | `sql` / `tar` / `gz` / `tgz` / `tar.gz` / `zip` | The format of the backup file. OpenEMR backups are typically MySQL dumps in `"sql"` or `"gz"` format. |

> **OpenEMR backup scope:** The `nfs-init` job restores both the MySQL database dump and the NFS `sites` directory content from the backup archive. The backup should contain the complete OpenEMR `sites` directory and the MySQL database for a full restoration.

### Validating Backup Import

```bash
# Confirm the nfs-init job (which performs the restore) completed successfully
gcloud run jobs executions list \
  --job=openemr-nfs-init \
  --region=REGION \
  --format="table(name,status.conditions[0].type,status.startTime,status.completionTime)"

# View restore logs for any errors
gcloud logging read \
  "resource.type=cloud_run_job AND resource.labels.job_name=openemr-nfs-init" \
  --project=PROJECT_ID \
  --limit=50 \
  --order=asc \
  --format="table(timestamp,severity,textPayload)"
```

---

## Deployment Prerequisites & Validation

After deploying `OpenEMR_CloudRun`, confirm the deployment is healthy:

```bash
# Confirm the nfs-init job completed successfully
gcloud run jobs executions list \
  --region=REGION \
  --format="table(name,status.conditions[0].type,status.startTime,status.completionTime)"

# View nfs-init job logs to confirm storage preparation
gcloud logging read \
  "resource.type=cloud_run_job AND resource.labels.job_name=openemr-nfs-init" \
  --project=PROJECT_ID \
  --limit=20

# Confirm the Cloud Run service is deployed and retrieve its URL
gcloud run services describe openemr \
  --region=REGION \
  --format="table(status.url,status.conditions[0].type)"

# Confirm the OE_PASS admin password secret was created in Secret Manager
gcloud secrets list --project=PROJECT_ID --filter="name:openemr" | grep password

# Test the OpenEMR login page
curl -s -o /dev/null -w "%{http_code}" https://SERVICE_URL/interface/login/login.php
# Expect: 200
```
