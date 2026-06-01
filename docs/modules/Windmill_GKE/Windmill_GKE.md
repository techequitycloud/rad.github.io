---
title: "Windmill_GKE Module — Configuration Guide"
sidebar_label: "Windmill GKE"
---

# Windmill_GKE Module — Configuration Guide

This guide describes every configuration variable available in the `Windmill_GKE` module. `Windmill_GKE` is a **wrapper module** that combines the generic [`App_GKE`](../App_GKE/App_GKE.md) infrastructure module with the [`Windmill_Common`](../Windmill_Common/) shared application configuration to deploy the [Windmill](https://www.windmill.dev/) developer platform on Google Kubernetes Engine (GKE) Autopilot.

Most configuration options in `Windmill_GKE` map directly to the same options in `App_GKE`. Where a variable is identical in behaviour, this guide references the `App_GKE` guide rather than repeating the same documentation. Only the variables and defaults that are **specific to Windmill** are described in full here.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## Standard Configuration Reference

| Configuration Area | App_GKE.md Section | Windmill-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | §1 Module Overview | Windmill-specific `module_description` and `module_services` defaults are pre-set. |
| Project & Identity | §2 IAM & Access Control | Identical. |
| Application Identity | §3.A Compute (GKE Autopilot) | Windmill-specific defaults; see [Group 2: Application Identity](#group-2-application-identity). |
| Runtime & Scaling | §3.A Compute (GKE Autopilot) | Windmill-specific defaults for `container_port`, `cpu_limit`, `memory_limit`; see [Group 3: Runtime & Scaling](#group-3-runtime--scaling). |
| Environment Variables & Secrets | §3 Core Service Configuration | Windmill env vars injected by `Windmill_Common`; see [Group 5: Environment Variables & Secrets](#group-5-environment-variables--secrets). |
| Networking & Network Policies | §3.D Networking & Network Policies | Identical. |
| Initialization Jobs & CronJobs | §3.E Initialization Jobs & CronJobs | `db-init` PostgreSQL 16 job supplied automatically by `Windmill_Common`; see [Group 8](#group-8-jobs--scheduled-tasks). |
| Storage — GCS | §3.C Storage (NFS / GCS / GCS Fuse) | `windmill-data` GCS bucket provisioned automatically. |
| Database Configuration | §3.B Database (Cloud SQL) | **PostgreSQL 16 required**; see [Group 11: Database Configuration](#group-11-database-configuration). |
| Observability & Health Checks | §3.A Compute (GKE Autopilot) | Probes target `/api/version`; see [Group 13: Observability & Health](#group-13-observability--health). |
| Cloud Armor WAF | §4.A Cloud Armor WAF | Identical. |
| Identity-Aware Proxy | §4.B Identity-Aware Proxy (IAP) | Identical. |
| Binary Authorization | §4.C Binary Authorization | Identical. |
| VPC Service Controls | §4.D VPC Service Controls | Identical. |
| Traffic & Ingress | §5 Traffic & Ingress | Identical. |
| Custom Domain & Static IP | §5.C Static IP Reservation | `BASE_URL` and `BASE_INTERNAL_URL` should match the domain. |
| Cloud Build Triggers | §6.A Cloud Build Triggers | Identical. |
| Cloud Deploy Pipeline | §6.B Cloud Deploy Pipeline | Identical. |
| Pod Disruption Budgets | §7.A Pod Disruption Budgets | Identical. |
| Redis Cache | §8.A Redis / Memorystore | `enable_redis` defaults to `false`; see [Group 14: Redis Cache](#group-14-redis-cache). |

---

## How Windmill_GKE Relates to App_GKE

`Windmill_GKE` passes all variables through to `App_GKE` and adds a `Windmill_Common` sub-module that supplies Windmill-specific defaults and application configuration. The main effects are:

1. **PostgreSQL 16 is required.** Windmill requires PostgreSQL 16. `database_type` defaults to `"POSTGRES_16"` — the only module in this repository with this requirement.
2. **`MODE=server,worker` is injected automatically.** Windmill runs both the API server and script execution workers in a single process on GKE. For separate worker scaling, define additional Kubernetes Deployments.
3. **`DISABLE_NSJAIL=true` is required.** GKE Autopilot does not provide `CAP_SYS_ADMIN` or user namespaces. Windmill's Linux namespace isolation is disabled automatically.
4. **A `windmill-data` GCS bucket is provisioned automatically.** `Windmill_Common` provides a bucket for workflow outputs and artefacts.
5. **A `db-init` job runs on first deployment.** `Windmill_Common` supplies a default `db-init` Kubernetes Job using `postgres:16-alpine` to initialise the Windmill database schema.
6. **SMTP password placeholder secret.** `Windmill_Common` provisions `{prefix}-smtp-password` in Secret Manager as a placeholder. Replace before enabling email features.
7. **Health probes target `/api/version`.** Windmill exposes `/api/version` as its primary health endpoint.

---

## Group 0: Module Metadata & Configuration

Identical to `App_GKE`. See [App_GKE §1](../App_GKE/App_GKE.md#1-module-overview).

**Windmill-specific defaults:**

| Variable | Windmill_GKE Default | Notes |
|---|---|---|
| `module_description` | `"Windmill: Deploy Windmill developer platform on GKE Autopilot…"` | Pre-populated with Windmill-specific description. |
| `credit_cost` | `150` | GKE deployments cost more credits than Cloud Run. |

---

## Group 1: Project & Identity

Identical to `App_GKE`. See [App_GKE §2](../App_GKE/App_GKE.md#2-iam--access-control).

---

## Group 2: Application Identity

**Windmill-specific defaults:**

| Variable | Windmill_GKE Default | App_GKE Default | Notes |
|---|---|---|---|
| `application_name` | `"windmill"` | `"gkeapp"` | Base name for all GCP and Kubernetes resources. **Do not change after deployment.** |
| `display_name` | `"Windmill"` | *(not in App_GKE)* | Human-readable name for the platform UI. |
| `description` | `"Windmill developer platform"` | *(not in App_GKE)* | Deployment description. |
| `application_version` | `"latest"` | `"1.0.0"` | Windmill release version. |

---

## Group 3: Runtime & Scaling

**Windmill-specific defaults and behaviour:**

| Variable | Windmill_GKE Default | App_GKE Default | Notes |
|---|---|---|---|
| `container_port` | `8000` | `8080` | Windmill's native HTTP port. |
| `cpu_limit` | `"2000m"` | `"1000m"` | Combined server+worker process requires more CPU. |
| `memory_limit` | `"2Gi"` | `"512Mi"` | Worker execution requires additional memory. |
| `min_instance_count` | `1` | `1` | At least one Windmill pod always running. |
| `max_instance_count` | `3` | `3` | Maximum pod replicas. |
| `container_image_source` | `"custom"` | `"custom"` | `Windmill_Common` supplies a bundled Dockerfile using `ghcr.io/windmill-labs/windmill` as the base. |
| `enable_cloudsql_volume` | `true` | `true` | Cloud SQL Auth Proxy sidecar for PostgreSQL connection. |

The remaining runtime variables behave as described in [App_GKE Group 3](../App_GKE/App_GKE.md#a-compute-gke-autopilot).

---

## Group 4: Access & Networking

Identical to `App_GKE`. See [App_GKE §4](../App_GKE/App_GKE.md#4-advanced-security) and [App_GKE §5](../App_GKE/App_GKE.md#5-traffic--ingress).

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Enables Identity-Aware Proxy authentication. |
| `iap_authorized_users` | `[]` | Users/service accounts granted IAP access. |
| `iap_authorized_groups` | `[]` | Google Groups granted IAP access. |
| `enable_custom_domain` | `false` | Configures Ingress for custom domain with managed SSL. |
| `application_domains` | `[]` | Custom domain names. |
| `reserve_static_ip` | `true` | Reserves a Global Static IP for the load balancer. |
| `enable_cloud_armor` | `false` | Enables a Cloud Armor WAF security policy. |
| `admin_ip_ranges` | `[]` | Admin CIDR ranges permitted through Cloud Armor. |
| `enable_vpc_sc` | `false` | Enables VPC Service Controls perimeter enforcement. |

---

## Group 5: Environment Variables & Secrets

`Windmill_Common` injects all Windmill-specific environment variables automatically. The following are hardcoded:

| Variable | Value | Description |
|---|---|---|
| `MODE` | `server,worker` | Combined server and worker mode. |
| `NUM_WORKERS` | `3` | Number of worker threads per pod. |
| `WORKER_GROUP` | `default` | Worker group name. |
| `DISABLE_NSJAIL` | `true` | Required on GKE Autopilot (no `CAP_SYS_ADMIN`). |
| `JSON_FMT` | `true` | Structured JSON logging for Cloud Logging. |
| `RUST_LOG` | `windmill=info` | Log verbosity. |
| `BASE_URL` | `var.service_url` | Public-facing service URL. |
| `BASE_INTERNAL_URL` | `var.service_url` | Internal service URL. |
| `METRICS_ADDR` | `:9001` | Prometheus metrics endpoint. |

User-supplied variables are merged on top of these defaults via `var.environment_variables`.

The `WINDMILL_SMTP_PASS` secret is injected automatically from `Windmill_Common`. Replace the placeholder value in Secret Manager before enabling email features.

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Additional env vars merged with Windmill defaults. |
| `secret_environment_variables` | `{}` | Additional Secret Manager references. `WINDMILL_SMTP_PASS` is auto-injected. |
| `service_url` | `""` | Public URL for `BASE_URL`/`BASE_INTERNAL_URL`. Set to your domain or load balancer IP. |

---

## Group 6: Backup & Maintenance

Identical to `App_GKE`. See [App_GKE §3.B](../App_GKE/App_GKE.md#b-database-cloud-sql).

| Variable | Default | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Daily at 02:00 UTC. |
| `backup_retention_days` | `7` | 7-day retention. Increase for production (30–90 days). |
| `enable_backup_import` | `false` | One-time restore on deploy. |

---

## Group 7: CI/CD & GitHub Integration

Identical to `App_GKE`. See [App_GKE §6](../App_GKE/App_GKE.md#6-cicd--delivery).

Variables available: `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`.

---

## Group 8: Jobs & Scheduled Tasks

**Windmill default `db-init` job:**

When `initialization_jobs` is left as the default empty list, `Windmill_Common` supplies a `db-init` job:

| Field | Value |
|---|---|
| Job name | `db-init` |
| Image | `postgres:16-alpine` |
| Purpose | Initialises the Windmill PostgreSQL 16 database schema and user |
| Execute on every apply | `true` |
| CPU / Memory | `1000m` / `512Mi` |

Override `initialization_jobs` with a non-empty list to replace this default. The `cron_jobs` variable behaves identically to `App_GKE`.

---

## Group 9–10: Storage & Filesystem

**GCS data bucket:**

`Windmill_Common` automatically provisions a `windmill-data` GCS bucket for workflow outputs and artefacts. You do not need to define it in `storage_buckets`.

| Bucket | `name_suffix` | Purpose |
|---|---|---|
| Auto-provisioned | `windmill-data` | Workflow outputs and artefact storage |

The `create_cloud_storage`, `storage_buckets`, and `gcs_volumes` variables behave as described in [App_GKE §3.C](../App_GKE/App_GKE.md#c-storage-nfs--gcs--gcs-fuse).

NFS (`enable_nfs`) is disabled by default — Windmill does not require NFS shared storage.

---

## Group 11: Database Configuration

**Windmill-specific defaults and restrictions:**

| Variable | Windmill_GKE Default | App_GKE Default | Notes |
|---|---|---|---|
| `database_type` | `"POSTGRES_16"` | `"POSTGRES"` | **Windmill requires PostgreSQL 16.** This is the only module in the repository with this requirement. |
| `db_name` | `"windmill"` | *(not in App_GKE)* | Database name passed to `Windmill_Common`. |
| `db_user` | `"windmill"` | *(not in App_GKE)* | Database user passed to `Windmill_Common`. |

**Automatic password rotation:**

| Variable | Default | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Deploys automated database password rotation. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before restarting pods. |

---

## Group 13: Observability & Health

Windmill exposes `/api/version` as its primary health endpoint. This is different from most modules that use `/healthz`.

**Startup probe** (`startup_probe` → `Windmill_Common`):

| Field | Windmill Default | App_GKE Default | Notes |
|---|---|---|---|
| `path` | `"/api/version"` | `"/healthz"` | Windmill's version endpoint confirms the service is ready. |
| `initial_delay_seconds` | `30` | `10` | Allows Windmill 30 seconds to start and connect to the database. |
| `failure_threshold` | `6` | `3` | Additional tolerance for first-boot database initialisation. |

**Liveness probe** (`liveness_probe` → `Windmill_Common`):

| Field | Windmill Default | App_GKE Default | Notes |
|---|---|---|---|
| `path` | `"/api/version"` | `"/healthz"` | Same endpoint as startup probe. |
| `initial_delay_seconds` | `30` | `15` | Gives Windmill time to stabilise. |

**App_GKE-standard probes:**

> **Override recommended:** `startup_probe_config` and `health_check_config` default to `path = "/healthz"`. Override both to `path = "/api/version"` to match Windmill's actual health endpoint.

The `uptime_check_config` and `alert_policies` variables behave as described in [App_GKE §3.A](../App_GKE/App_GKE.md#a-compute-gke-autopilot).

---

## Group 14: Reliability Policies

Identical to `App_GKE`. See [App_GKE §7](../App_GKE/App_GKE.md#7-reliability--scheduling).

Variables available: `enable_pod_disruption_budget`, `pdb_min_available`, `enable_topology_spread`, `topology_spread_strict`.

---

## Group 14: Redis Cache

Redis is **disabled by default** (`enable_redis = false`). Windmill does not require Redis for core operation. Enable for specific caching use cases.

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enables Redis. Not required for standard Windmill operation. |
| `redis_host` | `""` | Redis hostname or IP. |
| `redis_port` | `"6379"` | Redis port (string). |
| `redis_auth` | `""` | Redis AUTH password. Sensitive. |

---

## Group 17: GKE Backend Configuration

Identical to `App_GKE`. See [App_GKE §3.A](../App_GKE/App_GKE.md#a-compute-gke-autopilot).

Notable defaults for Windmill:

| Variable | Default | Notes |
|---|---|---|
| `workload_type` | `null` | Defaults to `Deployment`. Set `StatefulSet` if persistent local storage is needed. |
| `session_affinity` | `"None"` | Windmill API is stateless; session affinity is not required. |
| `service_type` | `"LoadBalancer"` | Exposes Windmill via an external load balancer. |

---

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `service_url` / `BASE_URL` (via Common) | Auto-predicted from GKE service URL | **High** | `BASE_URL` and `BASE_INTERNAL_URL` are set from `service_url` in Windmill Common. An incorrect or empty value breaks OAuth callbacks, webhook endpoints, and Windmill UI deep-links. Verify the predicted GKE service URL (load balancer IP or custom domain) matches the actual external endpoint before the first deploy. |
| `database_type` | `POSTGRES_15` | **Critical** | The GKE module description references PostgreSQL 16 in the database instance name output. Ensure the Cloud SQL instance version matches what Windmill's migration job expects. Using a mismatched version causes the init job to fail with unsupported migration SQL, leaving the database uninitialised. |
| `db_name` | `windmill` | **High** | Changing after first deploy causes Windmill to connect to an empty database, producing migration errors at startup and a non-functional service. |
| `db_user` | `windmill` | **High** | Changing after deploy breaks the database connection unless Cloud SQL user grants and the Secret Manager password are updated simultaneously. |
| `enable_cloudsql_volume` | `true` | **Critical** | Windmill connects to Cloud SQL via the Auth Proxy Unix socket. Disabling this causes database connection failures and Windmill enters CrashLoopBackOff immediately on startup. |
| `cpu_limit` | `2000m` | **High** | GKE Windmill runs in combined mode on single-replica deployments. Insufficient CPU throttles worker script execution. Each worker needs approximately 500m CPU; the default 3 workers require at least 2000m total. |
| `memory_limit` | `2Gi` | **High** | Windmill executes arbitrary user scripts in worker subprocesses. Python and TypeScript jobs with large dependencies can exceed 512Mi easily. OOM kills during script execution cause job failures with no visible error in the Windmill UI. |
| `min_instance_count` | `1` | **High** | Setting to `0` enables scale-to-zero via HPA. Scheduled Windmill jobs will be missed while the pod is scaled down; webhook triggers will return 503 until the pod is ready. Keep at least 1 replica running at all times. |
| `container_protocol` | `http1` | **High** | Windmill's HTTP server uses HTTP/1.1. Setting to `h2c` causes the GKE load balancer to use h2c framing for requests that Windmill does not support, resulting in 502 errors for all API and UI traffic. |
| `quota_memory_requests` / `quota_memory_limits` | `"4Gi"` / `"8Gi"` | **Critical** | Must use binary unit suffixes (e.g., `"4Gi"`, `"8192Mi"`). Bare integers are treated as bytes by Kubernetes, creating a near-zero memory quota that immediately blocks all pod scheduling. |
| `smtp_*` via Secret Manager | Dummy SMTP password secret created at deploy | **Medium** | SMTP is only functional when all of `WINDMILL_SMTP_HOST`, `WINDMILL_SMTP_PORT`, `WINDMILL_SMTP_FROM`, and the SMTP password secret are properly configured together. Partial SMTP configuration causes silent email delivery failures with no runtime error. |
| `enable_redis` | `false` | **Medium** | Redis enables Windmill's distributed queue. Without Redis on GKE multi-replica deployments, each pod processes only its own local queue — jobs submitted to one pod are invisible to others, causing unpredictable load distribution and potential job duplication. |
| `worker_group` (via `environment_variables`) | `"default"` | **Medium** | Windmill uses worker groups to route jobs to specific worker pools. If a flow or script specifies a custom worker group that does not exist, the job sits in the queue indefinitely with no timeout or error. |
| `stateful_pvc_enabled` | `false` | **Medium** | Windmill state is in Cloud SQL and GCS. Enabling StatefulSet PVCs adds persistent storage not used by Windmill, wastes resources, and can block pod rescheduling when the PVC cannot be mounted on the new node. |
| `enable_pod_disruption_budget` | `true` | **Medium** | Disabling PDB allows GKE node upgrades to evict all Windmill pods simultaneously, causing a service outage and losing all in-flight job execution state. |
| `backup_schedule` | `"0 2 * * *"` | **Medium** | An empty string disables automated backups. Windmill stores all scripts, flows, variables, resources, and job history in PostgreSQL. Without backups, any Cloud SQL failure results in complete loss of all automation definitions. |
| `enable_iap` | `false` | **Medium** | IAP requires `iap_oauth_client_id` and `iap_oauth_client_secret`. Enabling without both values leaves the backend either fully blocked or unprotected. External webhook sources cannot reach IAP-protected endpoints without explicit allowlisting. |
| `enable_vpc_sc` | `false` | **High** | Requires explicit `organization_id`. Without it, VPC Service Controls are silently skipped, giving a false sense of perimeter security. |
| `enable_auto_password_rotation` | `false` | **Medium** | When enabled, the Cloud SQL password rotates on schedule. The Windmill pod must be restarted after rotation; otherwise it continues using the old (now invalid) password until connections fail and the pod enters CrashLoopBackOff. |

---

## Module Outputs

| Output | Description |
|---|---|
| `service_name` | Name of the Kubernetes service. |
| `service_url` | Service URL. |
| `service_external_ip` | External IP of the load balancer. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix. |
| `namespace` | Kubernetes namespace. |
| `database_instance_name` | Name of the Cloud SQL PostgreSQL 16 instance. |
| `database_name` | Name of the application database. |
| `database_user` | Name of the application database user. |
| `database_password_secret` | Secret Manager secret name for the database password. |
| `storage_buckets` | Created GCS storage buckets. |
| `container_image` | Container image used for the deployment. |
| `cicd_enabled` | Whether the CI/CD pipeline is enabled. |
| `kubernetes_ready` | `true` when the GKE cluster endpoint is reachable and all Kubernetes resources are deployed. `false` on the first apply of a new inline cluster. |
