---
title: "Odoo GKE Configuration Guide"
sidebar_label: "GKE"
---

# Odoo_GKE Module — Configuration Guide

<video width="100%" controls style={{marginTop: '20px'}} poster="https://storage.googleapis.com/rad-public-2b65/modules/Odoo_GKE.png">
  <source src="https://storage.googleapis.com/rad-public-2b65/modules/Odoo_GKE.mp4" type="video/mp4" />
  Your browser does not support the video tag.
</video>

<br/>

<a href="https://storage.googleapis.com/rad-public-2b65/modules/Odoo_GKE.pdf" target="_blank">View Presentation (PDF)</a>

Odoo is a comprehensive open-source ERP platform covering CRM, accounting, inventory, manufacturing, HR, eCommerce, and more. This module deploys Odoo Community Edition on **GKE Autopilot** using a custom container image built from the official Odoo nightly packages, backed by a managed Cloud SQL PostgreSQL instance and a Filestore NFS volume for shared file storage.

`Odoo_GKE` is a **wrapper module** built on top of `App_GKE`. It uses `App_GKE` for all GCP infrastructure provisioning (cluster, networking, Cloud SQL, GCS, secrets, CI/CD) and adds Odoo-specific application configuration, initialisation jobs, and runtime defaults on top.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## How This Guide Is Structured

This guide documents only the variables that are **unique to `Odoo_GKE`** or that have **Odoo-specific defaults** that differ from the `App_GKE` base module. For all other variables — project identity, GKE backend configuration, CI/CD, custom SQL scripts, observability alerting, networking, IAP, and Cloud Armor — refer directly to the [App_GKE Configuration Guide](../App_GKE/App_GKE_Guide.md).

**Variables fully covered by the App_GKE guide:**

| Configuration Area | App_GKE_Guide Section | Odoo-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | Group 0 | Different defaults for `module_description` and `module_documentation`. `resource_creator_identity` behaves identically. |
| Project & Identity | Group 1 | Refer to base App_GKE module documentation. |
| Runtime & Scaling | Group 3 | See [Odoo Runtime Configuration](#odoo-runtime-configuration) below. `container_port` defaults to `8069`. `session_affinity` defaults to `"ClientIP"`. |
| Environment Variables & Secrets | Group 5 | See [Odoo Environment Variables](#odoo-environment-variables) below for SMTP defaults. |
| GKE Backend Configuration | Group 9 | Refer to base App_GKE module documentation. Note: `session_affinity` defaults to `"ClientIP"` for Odoo. |
| Jobs & Scheduled Tasks | Group 12 | Refer to base App_GKE module documentation. The module also injects two platform-managed initialisation jobs — see [Platform-Managed Behaviours](#platform-managed-behaviours). |
| CI/CD & GitHub Integration | Group 7 | Refer to base App_GKE module documentation. The module injects `ODOO_VERSION` as a Cloud Build substitution variable automatically. |
| Storage — NFS | Group 15 | NFS is **enabled by default** (`enable_nfs = true`). See [Platform-Managed Behaviours](#platform-managed-behaviours) for the NFS initialisation job. |
| Storage — GCS | Group 16 | Refer to base App_GKE module documentation. |
| Backup Schedule & Retention | Group 6 | Refer to base App_GKE module documentation. See also [Backup Import & Recovery](#backup-import--recovery) below. |
| Custom SQL Scripts | Group 8 | Refer to base App_GKE module documentation. |
| Observability & Health | Group 13 | See [Odoo Health Probes](#odoo-health-probes) below for Odoo-specific probe paths and timing defaults. |
| Reliability Policies | Group 27 | Refer to base App_GKE module documentation. `enable_pod_disruption_budget` defaults to `true`. |
| Resource Quota | Group 14 | Refer to base App_GKE module documentation. |
| Custom Domain, Static IP & Network | Group 11 | Refer to base App_GKE module documentation. |
| Identity-Aware Proxy | Group 4 | Refer to base App_GKE module documentation. |
| Cloud Armor | Group 13 | Refer to base App_GKE module documentation. |
| VPC Service Controls | Group 28 | Refer to base App_GKE module documentation. |
| StatefulSet Configuration | Group 10 | Refer to base App_GKE module documentation. |

---

## Platform-Managed Behaviours

The following behaviours are applied automatically by `Odoo_GKE` regardless of the variable values in your `tfvars` file. They cannot be overridden by user configuration.

| Behaviour | Detail |
|---|---|
| **NFS directory initialisation** | A `nfs-init` Kubernetes Job runs automatically on every apply. It mounts the Filestore NFS share and creates the directories `/mnt/filestore`, `/mnt/sessions`, and `/mnt/extra-addons`, setting ownership to UID/GID `101:101` (the Odoo process user) with mode `777`. This is required before Odoo starts or it will fail to write session and filestore data. |
| **Database initialisation** | A `db-init` Kubernetes Job runs after `nfs-init` to create the Odoo database and application user using the credentials stored in Secret Manager. The job runs as a PostgreSQL client against the Cloud SQL instance. |
| **ODOO_MASTER_PASS secret** | A 16-character alphanumeric master password is auto-generated and stored in Secret Manager under the name `app{application_name}{tenant_deployment_id}{deployment_id}-master-password`. It is injected into the container as the `ODOO_MASTER_PASS` environment variable and used for Odoo's database management interface. |
| **Custom Dockerfile** | When `container_image_source = "custom"`, Cloud Build uses the Odoo_Common `Dockerfile` which installs the Odoo version specified by `application_version` from the official Odoo nightly package repository. The `ODOO_VERSION` build argument is automatically injected from `application_version`. |
| **SMTP environment defaults** | The `environment_variables` map is pre-populated with Odoo SMTP configuration keys (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL`, `EMAIL_FROM`). Override these to configure outbound email for Odoo notifications and alerts. |
| **Pod Disruption Budget enabled** | `enable_pod_disruption_budget` defaults to `true` with `pdb_min_available = "1"`, ensuring at least one Odoo pod remains available during node maintenance. This is appropriate for stateful workloads. |

---

## Odoo Application Identity

These variables define how the Odoo deployment is named across GCP and Kubernetes resources.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `application_name` | `"odoo"` | `[a-z][a-z0-9-]{0,19}` | Internal identifier used as the base name for the Kubernetes Deployment, Namespace, Cloud SQL database, GCS buckets, and Secret Manager secrets. Functionally identical to `application_name` in App_GKE. **Do not change after initial deployment.** |
| `application_display_name` | `"Odoo ERP"` | Any string | Human-readable name shown in the platform UI and GKE monitoring dashboards. Can be updated freely without affecting resource names. |
| `application_description` | `"Odoo ERP on GKE Autopilot"` | Any string | Brief description of the deployment. Populated into Kubernetes resource annotations. Can be updated freely. |
| `application_version` | `"18.0"` | Odoo version string, e.g. `"18.0"`, `"17.0"` | **For Odoo this is the Odoo release version, not a semver tag.** It maps directly to the Odoo nightly package channel used in the Dockerfile (`ODOO_VERSION` build arg). Supported values are the Odoo long-term supported (LTS) versions: `"18.0"`, `"17.0"`, `"16.0"`. When `container_image_source = "custom"`, changing this value triggers a new Cloud Build run that installs the specified Odoo version. |

### Validating Application Identity

```bash
# Confirm the Deployment exists with the expected name
kubectl get deployments -n NAMESPACE -o wide

# Confirm the Odoo version running in the container
kubectl exec -n NAMESPACE deploy/odoo -- odoo --version
```

---

## Odoo Runtime Configuration

Odoo is a Python/PostgreSQL ERP application that requires more resources than a generic web service, particularly during initial database creation and module installation.

### Container Port

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `container_port` | `8069` | Integer, 1–65535 | The port Odoo listens on for HTTP traffic. The Odoo server binds to `0.0.0.0:8069` by default. **Do not change this unless you have modified the Odoo server configuration to listen on a different port.** |

### Resource Sizing

The `container_resources` variable behaves identically to App_GKE (see [App_GKE_Guide Group 3](../App_GKE/App_GKE_Guide.md#group-3-runtime--scaling)), but the Odoo defaults are lower than recommended for production:

| Variable | Module Default | Recommended for Production |
|---|---|---|
| `container_resources.cpu_limit` | `"1000m"` | `"2000m"` or higher |
| `container_resources.memory_limit` | `"512Mi"` | `"4Gi"` (minimum `"2Gi"`) |
| `container_resources.cpu_request` | `null` | `"2000m"` |
| `container_resources.mem_request` | `null` | `"4Gi"` |

Odoo's Python worker processes and database connection pool together consume 1.5–3 Gi of memory under normal load. Setting `memory_limit` below `"2Gi"` will cause OOM kills during peak activity. The initial module installation on first boot also requires significant CPU — under-sizing CPU causes very slow first-boot behaviour.

**Recommended production configuration:**
```hcl
container_resources = {
  cpu_limit    = "2000m"
  memory_limit = "4Gi"
  cpu_request  = "2000m"
  mem_request  = "4Gi"
}
```

### Session Affinity

| Variable | App_GKE Default | Odoo_GKE Default | Description & Implications |
|---|---|---|---|
| `session_affinity` | `"None"` | `"ClientIP"` | Odoo stores HTTP session data on the local filesystem (`/mnt/sessions` on NFS) keyed by session ID, but worker processes are assigned by the xmlrpc load balancer. Setting `"ClientIP"` ensures a given client consistently reaches the same pod, avoiding cross-pod session lookup overhead. Change to `"None"` only if Redis session storage is configured and all workers share session state. |

### Validating Runtime Configuration

```bash
# View container resource limits on the running pod
kubectl describe pod -n NAMESPACE -l app=odoo | grep -A10 "Limits:"

# Confirm session affinity on the Service
kubectl get service odoo -n NAMESPACE -o jsonpath='{.spec.sessionAffinity}'
```

---

## Odoo Health Probes

Odoo performs database schema validation and, on first boot, full module installation. This startup phase can take 2–10 minutes on a fresh deployment, depending on the number of installed modules and available CPU. The `startup_probe_config` and `health_check_config` variables in `Odoo_GKE` have Odoo-specific defaults for the `/web/health` endpoint.

| Variable | Default | Description & Implications |
|---|---|---|
| `startup_probe_config` | `{ enabled = true, type = "HTTP", path = "/web/health", initial_delay_seconds = 180, timeout_seconds = 60, period_seconds = 120, failure_threshold = 3 }` | Determines when the Odoo pod is ready to serve traffic. The `initial_delay_seconds = 180` gives Odoo time to load Python modules and perform database migration before the first probe fires. `period_seconds = 120` and `failure_threshold = 3` allow up to 6 minutes of additional startup time. **On first deployment** (when the schema is created from scratch), consider increasing `failure_threshold` to `5` or `initial_delay_seconds` to `300`. |
| `health_check_config` | `{ enabled = true, type = "HTTP", path = "/web/health", initial_delay_seconds = 30, timeout_seconds = 5, period_seconds = 30, failure_threshold = 3 }` | Periodically checks whether a running Odoo instance is healthy. The `/web/health` endpoint returns HTTP 200 only when Odoo has a live database connection and the application is operational. A `period_seconds = 30` check is appropriate. Kubernetes will restart the pod if this probe fails 3 consecutive times. |

> Both probe variables behave identically to `startup_probe_config` and `health_check_config` in App_GKE — see [App_GKE_Guide Group 13](../App_GKE/App_GKE_Guide.md#group-13-observability--health) for the full field reference. The Odoo_GKE defaults override the base App_GKE defaults.

### Validating Health Probes

**Google Cloud Console:** Navigate to **Kubernetes Engine → Workloads → odoo** and check the **Events** panel for probe failure messages.

```bash
# View probe configuration on the running deployment
kubectl describe deployment odoo -n NAMESPACE | grep -A30 "Liveness:"

# Tail Odoo pod logs to monitor startup progress
kubectl logs -n NAMESPACE -l app=odoo --follow | grep -E "odoo.modules|http.server"

# Manually test the health endpoint from within the cluster
kubectl exec -n NAMESPACE deploy/odoo -- curl -s -o /dev/null -w "%{http_code}" http://localhost:8069/web/health
# Expect: 200
```

---

## Odoo Database Configuration

Odoo requires PostgreSQL. The database is provisioned by the underlying `App_GKE` module — see [App_GKE_Guide Group 17](../App_GKE/App_GKE_Guide.md#group-17-database-configuration) for the full variable reference.

The following defaults are **Odoo-specific** and differ from the App_GKE defaults:

| Variable | App_GKE Default | Odoo_GKE Default | Recommendation |
|---|---|---|---|
| `application_database_name` | `"gkeappdb"` | `"gkeappdb"` | Set to `"odoo"` to match Odoo conventions. |
| `application_database_user` | `"gkeappuser"` | `"gkeappuser"` | Set to `"odoo"` to match Odoo conventions. |
| `database_type` | `"POSTGRES"` | `"POSTGRES"` | **Must remain PostgreSQL.** Setting `database_type = "NONE"` or a MySQL/SQL Server type will prevent Odoo from starting. |

> **Note on PostgreSQL extensions:** The `db-init` job (see [Platform-Managed Behaviours](#platform-managed-behaviours)) creates the database and user but does not install extensions. If your Odoo deployment uses modules that require PostgreSQL extensions such as `postgis` or `unaccent`, enable them using `enable_postgres_extensions = true` and `postgres_extensions = ["postgis", "unaccent"]`.

### Validating Database Configuration

```bash
# Confirm the database and user were created by the db-init job
gcloud sql databases list --instance=INSTANCE_NAME --project=PROJECT_ID

gcloud sql users list --instance=INSTANCE_NAME --project=PROJECT_ID

# Confirm DB environment variables are injected into the running pod
kubectl exec -n NAMESPACE deploy/odoo -- env | grep -E "^(DB_|PGHOST|PGUSER)"
```

---

## Odoo Environment Variables

The `environment_variables` variable (documented in [App_GKE_Guide Group 5](../App_GKE/App_GKE_Guide.md#group-5-environment-variables--secrets)) has Odoo-specific defaults that configure outbound email delivery.

**Default `environment_variables` in Odoo_GKE:**

```hcl
environment_variables = {
  SMTP_HOST     = ""
  SMTP_PORT     = "25"
  SMTP_USER     = ""
  SMTP_PASSWORD = ""
  SMTP_SSL      = "false"
  EMAIL_FROM    = "odoo@example.com"
}
```

Odoo uses these variables to configure its outbound mail transport, which is required for order confirmations, password resets, and CRM notifications. Configure them to point to your SMTP server before going live. Move sensitive values such as `SMTP_PASSWORD` to `secret_environment_variables`:

```hcl
environment_variables = {
  SMTP_HOST  = "smtp.sendgrid.net"
  SMTP_PORT  = "587"
  SMTP_USER  = "apikey"
  SMTP_SSL   = "true"
  EMAIL_FROM = "noreply@yourcompany.example.com"
}

secret_environment_variables = {
  SMTP_PASSWORD = "odoo-smtp-password"   # Secret Manager secret name
}
```

All other `environment_variables` and `secret_environment_variables` behaviour is identical to App_GKE — refer to [App_GKE_Guide Group 5](../App_GKE/App_GKE_Guide.md#group-5-environment-variables--secrets).

---

## Redis Session Store

Odoo supports Redis as a shared session store. When multiple Odoo pods are running (i.e. `max_instance_count > 1`), Redis is **strongly recommended** to avoid session loss when a request is routed to a pod that does not hold the user's local session. Without Redis, `session_affinity = "ClientIP"` mitigates this but does not eliminate the risk during pod restarts.

| Variable | Default | Options / Format | Description & Implications |
|---|---|---|---|
| `enable_redis` | `false` | `true` / `false` | When `true`, Odoo is configured to use the Redis instance at `redis_host:redis_port` for session storage. The `SESSION_REDIS` environment variable is set to `true` and `REDIS_HOST`/`REDIS_PORT` are injected automatically. Requires `redis_host` to be set to a reachable Redis endpoint (e.g. a Google Memorystore for Redis instance IP). |
| `redis_host` | `""` | IP address or hostname | The Redis server hostname or IP. For Google Memorystore, use the instance's primary endpoint IP (available in the Cloud Console under **Memorystore → Redis → your instance → Properties**). Required when `enable_redis = true`. |
| `redis_port` | `"6379"` | Port string (e.g. `"6379"`) | The port on which Redis is listening. Defaults to the standard Redis port. Change only if your Redis instance is configured on a non-standard port. |
| `redis_auth` | `""` | String (sensitive) | Authentication password for the Redis server. Leave empty for unauthenticated Redis. For Memorystore instances with AUTH enabled, set this to the instance's auth string. Treated as sensitive — not stored in Terraform state in plaintext. |

### Validating Redis Configuration

```bash
# Confirm REDIS_HOST and REDIS_PORT are injected into the running pod
kubectl exec -n NAMESPACE deploy/odoo -- env | grep -E "^REDIS_"

# Test Redis connectivity from within the pod (requires redis-cli on the image)
kubectl exec -n NAMESPACE deploy/odoo -- redis-cli -h REDIS_HOST -p REDIS_PORT PING
# Expect: PONG
```

---

## Backup Import & Recovery

In addition to the scheduled backup (`backup_schedule` and `backup_retention_days`, documented in [App_GKE_Guide Group 6](../App_GKE/App_GKE_Guide.md#group-6-backup--maintenance)), `Odoo_GKE` supports a one-time database import during deployment. Use this to migrate an existing Odoo instance to GCP or to seed a new environment with production data.

The backup import variables behave identically to those in App_GKE_Guide Group 6:

| Variable | Default | Description |
|---|---|---|
| `enable_backup_import` | `false` | When `true`, triggers a one-time import job after provisioning. |
| `backup_source` | `"gcs"` | `"gcs"` to import from the automatically created backups bucket; `"gdrive"` to import from a Google Drive file ID. |
| `backup_file` | `"backup.sql"` | Filename within the GCS backups bucket, or the Google Drive file ID. |
| `backup_format` | `"sql"` | The format of the backup: `"sql"`, `"gz"`, `"tar"`, `"tgz"`, `"tar.gz"`, `"zip"`, or `"auto"`. |

> The Odoo backup is a PostgreSQL dump (`pg_dump`). The recommended format for Odoo is `"sql"` (plain text) or `"gz"` (gzip-compressed). The import job restores the dump into the database identified by `application_database_name`.

For the full variable reference and validation steps, refer to [App_GKE_Guide Group 6](../App_GKE/App_GKE_Guide.md#group-6-backup--maintenance).

---

## Deployment Prerequisites & Validation

After deploying `Odoo_GKE`, confirm the deployment is healthy:

```bash
# Confirm both initialisation jobs completed successfully
kubectl get jobs -n NAMESPACE

# View nfs-init job logs
kubectl logs -n NAMESPACE -l job-name=nfs-init

# View db-init job logs
kubectl logs -n NAMESPACE -l job-name=db-init

# Confirm the Odoo pod is running and healthy
kubectl get pods -n NAMESPACE -l app=odoo

# Retrieve the external IP of the Odoo LoadBalancer service
kubectl get svc -n NAMESPACE

# Test the Odoo web interface (replace EXTERNAL_IP with the LoadBalancer IP)
curl -s -o /dev/null -w "%{http_code}" http://EXTERNAL_IP/web/health
# Expect: 200

# Confirm the ODOO_MASTER_PASS secret was created in Secret Manager
gcloud secrets list --project=PROJECT_ID --filter="name:master-password"
```
