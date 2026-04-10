---
title: "OpenEMR GKE Configuration Guide"
sidebar_label: "GKE"
---

# OpenEMR_GKE Module — Configuration Guide

<video width="100%" controls style={{marginTop: '20px'}} poster="https://storage.googleapis.com/rad-public-2b65/modules/OpenEMR_GKE.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/modules/OpenEMR_GKE.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

<a href="https://storage.googleapis.com/rad-public-2b65/modules/OpenEMR_GKE.pdf" target="_blank">View Presentation (PDF)</a>

OpenEMR is a leading open-source electronic health records (EHR) and medical practice management platform used by clinics, hospitals, and healthcare providers worldwide. This module deploys OpenEMR on **GKE Autopilot** using a custom container image built on Alpine 3.20 with Apache and PHP 8.3 FPM, backed by a managed Cloud SQL MySQL 8.0 instance accessed via a Cloud SQL Auth Proxy sidecar, and a Filestore NFS volume for persistent patient document and sites directory storage.

`OpenEMR_GKE` is a **wrapper module** built on top of `App_GKE`. It uses `App_GKE` for all GCP infrastructure provisioning (cluster, networking, Cloud SQL, GCS, secrets, CI/CD) and adds OpenEMR-specific application configuration, initialisation jobs, health probes, and runtime defaults on top.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How This Guide Is Structured

This guide documents only the variables that are **unique to `OpenEMR_GKE`** or that have **OpenEMR-specific defaults** that differ from the `App_GKE` base module. For all other variables — project identity, GKE backend configuration, CI/CD, custom SQL scripts, observability alerting, networking, IAP, and Cloud Armor — refer directly to the [App_GKE Configuration Guide](../App_GKE/App_GKE_Guide.md).

**Variables fully covered by the App_GKE guide:**

| Configuration Area | App_GKE_Guide Section | OpenEMR-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | Group 0 | Different defaults for `module_description` and `module_documentation`. `resource_creator_identity` behaves identically. |
| Project & Identity | Group 1 | Refer to base App_GKE module documentation. |
| Runtime & Scaling | Group 3 | See [OpenEMR Runtime Configuration](#openemr-runtime-configuration) below. `container_port` defaults to `80`. `session_affinity` defaults to `"ClientIP"`. |
| Environment Variables & Secrets | Group 5 | See [OpenEMR Environment Variables](#openemr-environment-variables) below for PHP and SMTP defaults. |
| GKE Backend Configuration | Group 9 | Refer to base App_GKE module documentation. `session_affinity` defaults to `"ClientIP"`. `deployment_timeout` defaults to `1200`. |
| Jobs & Scheduled Tasks | Group 12 | Refer to base App_GKE module documentation. The module injects a platform-managed `nfs-init` initialisation job — see [Platform-Managed Behaviours](#platform-managed-behaviours). |
| CI/CD & GitHub Integration | Group 7 | Refer to base App_GKE module documentation. |
| Storage — NFS | Group 15 | NFS is **enabled by default** (`enable_nfs = true`). See [NFS & Patient Document Storage](#nfs--patient-document-storage) below. |
| Storage — GCS | Group 16 | Refer to base App_GKE module documentation. |
| Backup Schedule & Retention | Group 6 | Refer to base App_GKE module documentation. See also [Backup Import & Recovery](#backup-import--recovery) below. |
| Custom SQL Scripts | Group 8 | Refer to base App_GKE module documentation. |
| Observability & Health | Group 13 | See [OpenEMR Health Probes](#openemr-health-probes) below for OpenEMR-specific probe paths and timing defaults. |
| Reliability Policies | Group 27 | Refer to base App_GKE module documentation. |
| Resource Quota | Group 14 | Refer to base App_GKE module documentation. |
| Custom Domain, Static IP & Network | Group 11 | Refer to base App_GKE module documentation. |
| Identity-Aware Proxy | Group 4 | Refer to base App_GKE module documentation. |
| Cloud Armor | Group 13 | Refer to base App_GKE module documentation. |
| VPC Service Controls | Group 28 | Refer to base App_GKE module documentation. |
| StatefulSet Configuration | Group 10 | Refer to base App_GKE module documentation. |

---

## Platform-Managed Behaviours

The following behaviours are applied automatically by `OpenEMR_GKE` regardless of the variable values in your `tfvars` file. They cannot be overridden by user configuration.

| Behaviour | Detail |
|---|---|
| **NFS directory initialisation** | An `nfs-init` Kubernetes Job runs automatically on every apply. It mounts the Filestore NFS share, sets ownership of the `sites` directory to UID `1000` (the Apache process user), downloads and restores a backup if `backup_uri` is set, and regenerates `sqlconf.php` with current database credentials. This job must complete before OpenEMR starts. |
| **Cloud SQL Auth Proxy sidecar** | `enable_cloudsql_volume = true` is applied unconditionally. A Cloud SQL Auth Proxy container is injected as a sidecar in the same pod. The application connects to MySQL via the Unix socket at `127.0.0.1`. This is not configurable by the user. |
| **OE_PASS secret** | An OpenEMR admin password is auto-generated and stored in Secret Manager. It is injected into the container as the `OE_PASS` environment variable, which OpenEMR uses to set the administrator account on first boot. |
| **MYSQL_PASS secret** | The MySQL database password generated by `App_GKE` is automatically injected as the `MYSQL_PASS` environment variable. Do not define this manually in `secret_environment_variables`. |
| **K8S environment variable** | `K8S = "yes"` is injected unconditionally into the container. The OpenEMR startup script uses this flag to detect the Kubernetes deployment mode and apply GKE-specific behaviour (such as skipping slow recursive `chown` operations that would cause startup timeouts). |
| **Network tags** | The `network_tags` variable defaults to `["nfsserver"]`. This tag is required for GKE pod traffic to reach the GCE-based NFS server via VPC firewall rules. Do not remove this tag unless you have replaced the NFS server with Filestore or another solution that does not require it. |
| **BACKUP_FILEID injection** | When `backup_uri` is set, it is automatically injected into the `nfs-init` job as the `BACKUP_FILEID` environment variable, triggering backup restoration on deployment. |

---

## OpenEMR Application Identity

These variables define how the OpenEMR deployment is named across GCP and Kubernetes resources.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_name` | `"openemr"` | `[a-z][a-z0-9-]{0,19}` | Internal identifier used as the base name for the Kubernetes Deployment, Namespace, Cloud SQL database, GCS buckets, and Secret Manager secrets. Functionally identical to `application_name` in App_GKE. **Do not change after initial deployment.** |
| `display_name` | `"OpenEMR"` | Any string | Human-readable name shown in the platform UI and GKE monitoring dashboards. Can be updated freely without affecting resource names. |
| `description` | `"Initialize NFS directories for OpenEMR and restore backup if provided"` | Any string | Description used in Kubernetes resource annotations and the `nfs-init` job. Can be updated freely. |
| `application_version` | `"7.0.4"` | OpenEMR version string, e.g. `"7.0.4"`, `"7.0.3"` | The OpenEMR release version, used as the container image tag. When `container_image_source = "custom"`, changing this value triggers a new Cloud Build run that builds the specified version. |

### Validating Application Identity

```bash
# Confirm the Deployment exists with the expected name
kubectl get deployments -n NAMESPACE -o wide

# Confirm the running container image tag
kubectl get pods -n NAMESPACE -l app=openemr -o jsonpath='{.items[0].spec.containers[0].image}'
```

---

## OpenEMR Runtime Configuration

OpenEMR is a PHP/MySQL EHR application with an Apache HTTP server front-end. It has higher memory and ephemeral storage requirements than a typical web service, particularly during the initial database installation and on first boot.

### Container Port

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `container_port` | `80` | Integer, 1–65535 | The port Apache listens on inside the container. OpenEMR's Apache configuration binds to port 80 by default. **Do not change this** unless you have modified the Apache configuration. |

### Resource Sizing

The `OpenEMR_GKE` module exposes `cpu_limit`, `memory_limit`, and `ephemeral_storage_limit` as dedicated top-level variables. These are passed into `container_resources` for the underlying `App_GKE` module.

| Variable | Module Default | Recommended for Production |
|---|---|---|
| `cpu_limit` | `"2000m"` | `"2000m"` or higher |
| `memory_limit` | `"4Gi"` | `"4Gi"` (minimum `"2Gi"`) |
| `ephemeral_storage_limit` | `"8Gi"` | `"8Gi"` |

> **Note on ephemeral storage:** OpenEMR writes PHP opcache, Apache logs, session files, and installation temporary files to the container writable layer. The GKE Autopilot default of 1 Gi is insufficient. The Cloud SQL Auth Proxy sidecar consumes 1 Gi of ephemeral storage, leaving a maximum of 9 Gi available for the OpenEMR container within GKE Autopilot's 10 Gi per-pod limit. The `"8Gi"` default accounts for this headroom.

**Recommended production configuration:**
```hcl
cpu_limit              = "2000m"
memory_limit           = "4Gi"
ephemeral_storage_limit = "8Gi"
```

### Scaling Defaults

| Variable | App_GKE Default | OpenEMR_GKE Default | Reason |
|---|---|---|---|
| `min_instance_count` | `1` | `1` | OpenEMR should always have at least one running pod to avoid cold starts that impact clinical access. |
| `max_instance_count` | `1` | `1` | OpenEMR's PHP session handling relies on the local NFS mount. Multi-instance deployments require Redis session storage. Increase `max_instance_count` only after enabling Redis. |

### Session Affinity

| Variable | App_GKE Default | OpenEMR_GKE Default | Description & Implications |
|---|---|---|---|
| `session_affinity` | `"None"` | `"ClientIP"` | Ensures a given client consistently reaches the same pod. This mitigates cross-pod session inconsistency when Redis is not configured. Change to `"None"` only when Redis session storage is enabled and all pods share session state. |

### Deployment Timeout

| Variable | App_GKE Default | OpenEMR_GKE Default | Description & Implications |
|---|---|---|---|
| `deployment_timeout` | `600` | `1200` | OpenEMR's initial database installation and PHP asset compilation can take 10–20 minutes on first boot. The extended timeout prevents Terraform from reporting a failure during legitimate long-running first deployments. |

### Validating Runtime Configuration

```bash
# View container resource limits on the running pod
kubectl describe pod -n NAMESPACE -l app=openemr | grep -A15 "Limits:"

# Confirm session affinity on the Service
kubectl get service openemr -n NAMESPACE -o jsonpath='{.spec.sessionAffinity}'

# Confirm the K8S environment variable is set
kubectl exec -n NAMESPACE deploy/openemr -- env | grep "^K8S="
```

---

## OpenEMR Health Probes

OpenEMR performs database connection validation and, on first boot, runs the full database installation wizard. This startup phase can take 5–20 minutes on a fresh deployment. The `startup_probe` and `liveness_probe` variables in `OpenEMR_GKE` have OpenEMR-specific defaults.

| Variable | Default | Description & Implications |
|---|---|---|
| `startup_probe` | `{ enabled = true, type = "TCP", path = "/", initial_delay_seconds = 0, timeout_seconds = 5, period_seconds = 10, failure_threshold = 12 }` | Uses a **TCP port check** on port 80 rather than an HTTP endpoint. A TCP probe is more reliable during OpenEMR's boot phase, when Apache may be accepting connections before PHP and the database are fully ready. With `period_seconds = 10` and `failure_threshold = 12`, Kubernetes allows up to 120 seconds of startup time before declaring the pod unhealthy. **On first deployment**, consider increasing `failure_threshold` to `30` or higher to allow for the full database installation. |
| `liveness_probe` | `{ enabled = true, type = "HTTP", path = "/interface/login/login.php", initial_delay_seconds = 0, timeout_seconds = 10, period_seconds = 30, failure_threshold = 10 }` | Periodically checks that the OpenEMR login page is reachable. The `/interface/login/login.php` endpoint returns HTTP 200 only when Apache, PHP-FPM, and the database connection are all operational. `period_seconds = 30` and `failure_threshold = 10` allow up to 5 minutes of recovery time before the pod is restarted. |

> Both probe variables behave identically to `startup_probe_config` and `health_check_config` in App_GKE — see [App_GKE_Guide Group 13](../App_GKE/App_GKE_Guide.md#group-13-observability--health) for the full field reference. The OpenEMR_GKE defaults override the base App_GKE defaults.

### Validating Health Probes

**Google Cloud Console:** Navigate to **Kubernetes Engine → Workloads → openemr** and check the **Events** panel for probe failure messages.

```bash
# View probe configuration on the running deployment
kubectl describe deployment openemr -n NAMESPACE | grep -A30 "Liveness:"

# Tail pod logs to monitor startup progress
kubectl logs -n NAMESPACE -l app=openemr --follow | grep -E "apache|php|mysql|openemr"

# Manually test the login page endpoint from within the cluster
kubectl exec -n NAMESPACE deploy/openemr -- curl -s -o /dev/null -w "%{http_code}" http://localhost:80/interface/login/login.php
# Expect: 200
```

---

## OpenEMR Database Configuration

OpenEMR requires MySQL 8.0. The database is provisioned by the underlying `App_GKE` module — see [App_GKE_Guide Group 17](../App_GKE/App_GKE_Guide.md#group-17-database-configuration) for the full variable reference.

The following defaults are **OpenEMR-specific** and differ from the App_GKE defaults:

| Variable | App_GKE Default | OpenEMR_GKE Default | Recommendation |
|---|---|---|---|
| `db_name` | `"gkeappdb"` | `"openemr"` | The MySQL database created for OpenEMR. Injected as the database name in OpenEMR's `sqlconf.php`. |
| `db_user` | `"gkeappuser"` | `"openemr"` | The MySQL user for the application. Injected into the OpenEMR configuration. |
| `database_type` | `"POSTGRES"` | `"MYSQL_8_0"` | **Must remain MySQL 8.0.** OpenEMR does not support PostgreSQL. Setting any other `database_type` will prevent OpenEMR from starting. |

> **Database connection method:** Unlike most App_GKE applications that connect via TCP, OpenEMR connects to Cloud SQL via the **Cloud SQL Auth Proxy Unix socket** mounted at `127.0.0.1`. This is enforced by the platform-managed `enable_cloudsql_volume = true` setting and cannot be changed by the user.

### Validating Database Configuration

```bash
# Confirm the database and user were created
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID

gcloud sql users list --instance=INSTANCE_NAME --project=PROJECT_ID

# Confirm the DB password secret is injected into the running pod
kubectl exec -n NAMESPACE deploy/openemr -- env | grep -E "^MYSQL_PASS"

# Confirm the Cloud SQL Auth Proxy sidecar is running in the pod
kubectl get pod -n NAMESPACE -l app=openemr -o jsonpath='{.items[0].spec.containers[*].name}'
```

---

## OpenEMR Environment Variables

The `environment_variables` variable (documented in [App_GKE_Guide Group 5](../App_GKE/App_GKE_Guide.md#group-5-environment-variables--secrets)) can be used to set any PHP or SMTP configuration consumed by the OpenEMR container's startup script.

**Commonly configured environment variables:**

```hcl
environment_variables = {
  PHP_MEMORY_LIMIT = "512M"   # PHP memory limit; increase for large patient datasets
  SMTP_HOST        = ""       # SMTP server for outbound email notifications
  SMTP_PORT        = "25"     # SMTP server port
  SMTP_USER        = ""       # SMTP authentication username
  SMTP_PASSWORD    = ""       # Move sensitive values to secret_environment_variables
  SMTP_SSL         = "false"  # Set to "true" for TLS/SSL SMTP connections
  EMAIL_FROM       = "openemr@example.com"
}
```

Configure `PHP_MEMORY_LIMIT` before going live if your deployment handles large numbers of concurrent patients or generates complex reports. Move sensitive values such as `SMTP_PASSWORD` to `secret_environment_variables`:

```hcl
secret_environment_variables = {
  SMTP_PASSWORD = "openemr-smtp-password"   # Secret Manager secret name
}
```

All other `environment_variables` and `secret_environment_variables` behaviour is identical to App_GKE — refer to [App_GKE_Guide Group 5](../App_GKE/App_GKE_Guide.md#group-5-environment-variables--secrets).

---

## NFS & Patient Document Storage

OpenEMR stores patient-uploaded documents, the `sites` directory configuration, and application state on a shared NFS volume. NFS is **enabled by default** (`enable_nfs = true`) because OpenEMR cannot function correctly without persistent shared storage.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_nfs` | `true` | `true` / `false` | **Must remain `true`** for a functional OpenEMR deployment. Setting to `false` will prevent the `nfs-init` job from running and OpenEMR will fail to persist patient data across pod restarts. |
| `nfs_mount_path` | `"/var/www/localhost/htdocs/openemr/sites"` | Filesystem path | The path inside the container where the NFS volume is mounted. This maps directly to OpenEMR's `sites` directory, which contains patient documents, site configuration, and uploaded files. **Do not change this** unless you have modified the OpenEMR container to use a different sites path. |

For the full NFS variable reference (Filestore instance sizing, capacity, etc.), refer to [App_GKE_Guide Group 15](../App_GKE/App_GKE_Guide.md#group-15-storage--filesystem--nfs).

### Validating NFS Storage

```bash
# Confirm the nfs-init job completed successfully
kubectl get jobs -n NAMESPACE -l job-name=nfs-init

# View nfs-init job logs to confirm directory setup and any backup restoration
kubectl logs -n NAMESPACE -l job-name=nfs-init

# Confirm the NFS volume is mounted in the running pod
kubectl exec -n NAMESPACE deploy/openemr -- ls /var/www/localhost/htdocs/openemr/sites
```

---

## Redis Session Store

OpenEMR supports Redis as a shared PHP session store. Redis is **enabled by default** (`enable_redis = true`) because the OpenEMR deployment uses the NFS server's co-located Redis instance by default. When `max_instance_count > 1`, Redis is **required** to prevent session loss when requests are routed to different pods.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `true` | `true` / `false` | When `true`, OpenEMR is configured to use Redis for PHP session storage via `session.save_handler = redis`. The `REDIS_SERVER` environment variable is set automatically. If `redis_host` is left blank, the module defaults to using the NFS server's IP address as the Redis host. |
| `redis_host` | `""` | IP address or hostname | The Redis server hostname or IP. When left empty and `enable_redis = true`, the module uses the NFS server IP (which runs a co-located Redis instance). Override with a dedicated Memorystore for Redis instance IP for production deployments requiring higher availability. |
| `redis_port` | `"6379"` | Port string (e.g. `"6379"`) | The port Redis is listening on. Change only if your Redis instance uses a non-standard port. |
| `redis_auth` | `""` | String (sensitive) | Authentication password for the Redis server. Leave empty for the default co-located NFS/Redis configuration. For Memorystore instances with AUTH enabled, set this to the instance's auth string. Treated as sensitive — not stored in plaintext in Terraform state. |

### Validating Redis Configuration

```bash
# Confirm REDIS_SERVER is set in the running pod
kubectl exec -n NAMESPACE deploy/openemr -- env | grep -E "^REDIS"

# Test Redis connectivity from within the pod
kubectl exec -n NAMESPACE deploy/openemr -- redis-cli -h REDIS_HOST -p 6379 PING
# Expect: PONG
```

---

## Backup Import & Recovery

In addition to the scheduled backup (`backup_schedule` and `backup_retention_days`, documented in [App_GKE_Guide Group 6](../App_GKE/App_GKE_Guide.md#group-6-backup--maintenance)), `OpenEMR_GKE` supports a one-time backup restoration during deployment via the `nfs-init` job. Use this to migrate an existing OpenEMR instance to GCP or to seed a new environment with production data.

| Variable | Default | Options / Format | Description |
|---|---|---|---|
| `enable_backup_import` | `false` | `true` / `false` | When `true`, triggers a one-time import job after provisioning. |
| `backup_source` | `"gcs"` | `gcs` / `gdrive` | `"gcs"` to import from the automatically created GCS backups bucket; `"gdrive"` to import from a Google Drive file ID. GCS is recommended for production. |
| `backup_uri` | `""` | GCS URI or Drive file ID | For GCS: the full object URI (e.g., `"gs://my-bucket/backups/openemr.sql"`). For Google Drive: the file ID from the share URL. When set, this is automatically injected as `BACKUP_FILEID` into the `nfs-init` job. |
| `backup_format` | `"sql"` | `sql` / `tar` / `gz` / `tgz` / `tar.gz` / `zip` | The format of the backup file. OpenEMR backups are typically MySQL dumps in `"sql"` or `"gz"` (gzip-compressed) format. |

> **OpenEMR backup scope:** The `nfs-init` job restores both the MySQL database dump and the NFS `sites` directory content from the backup archive. The backup should contain the complete OpenEMR `sites` directory and the MySQL database for a full restoration.

For the full variable reference, refer to [App_GKE_Guide Group 6](../App_GKE/App_GKE_Guide.md#group-6-backup--maintenance).

---

## Deployment Prerequisites & Validation

After deploying `OpenEMR_GKE`, confirm the deployment is healthy:

```bash
# Confirm the nfs-init job completed successfully
kubectl get jobs -n NAMESPACE

# View nfs-init job logs to confirm storage preparation and backup restoration
kubectl logs -n NAMESPACE -l job-name=nfs-init

# Confirm the OpenEMR pod is running and healthy
kubectl get pods -n NAMESPACE -l app=openemr

# Retrieve the external IP of the OpenEMR LoadBalancer service
kubectl get svc -n NAMESPACE

# Test the OpenEMR login page (replace EXTERNAL_IP)
curl -s -o /dev/null -w "%{http_code}" http://EXTERNAL_IP/interface/login/login.php
# Expect: 200

# Confirm the OE_PASS admin password secret was created in Secret Manager
gcloud secrets list --project=PROJECT_ID --filter="name:openemr" | grep password

# Confirm the Cloud SQL Auth Proxy sidecar is running alongside OpenEMR
kubectl get pod -n NAMESPACE -l app=openemr -o jsonpath='{.items[0].status.containerStatuses[*].name}'
```
