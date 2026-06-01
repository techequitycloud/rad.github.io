# Superset_GKE Module — Configuration Guide

This guide describes every configuration variable available in the `Superset_GKE` module. `Superset_GKE` is a **wrapper module** that combines the generic [`App_GKE`](../App_GKE/App_GKE.md) infrastructure module with the [`Superset_Common`](../Superset_Common/) shared application configuration to deploy [Apache Superset](https://superset.apache.org/) on Google Kubernetes Engine (GKE) Autopilot.

Most configuration options in `Superset_GKE` map directly to the same options in `App_GKE`. Where a variable is identical in behaviour, this guide references the `App_GKE` guide rather than repeating the documentation.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## Standard Configuration Reference

| Configuration Area | App_GKE.md Section | Superset-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | §1 Module Overview | Superset-specific `module_description` and `module_services` defaults are pre-set. |
| Project & Identity | §2 IAM & Access Control | Identical. |
| Application Identity | §3.A Compute (GKE Autopilot) | Superset-specific defaults; see [Group 2](#group-2-application-identity). |
| Runtime & Scaling | §3.A Compute (GKE Autopilot) | Superset-specific defaults; see [Group 3](#group-3-runtime--scaling). |
| Environment Variables & Secrets | §3 Core Service Configuration | `SUPERSET_SECRET_KEY` auto-injected; see [Group 5](#group-5-environment-variables--secrets). |
| Initialization Jobs & CronJobs | §3.E Initialization Jobs & CronJobs | Two-phase `db-init` + `app-init`; see [Group 8](#group-8-jobs--scheduled-tasks). |
| Storage — GCS | §3.C Storage | `superset-data` GCS bucket provisioned automatically. |
| Database Configuration | §3.B Database (Cloud SQL) | PostgreSQL 15; see [Group 11](#group-11-database-configuration). |
| Observability & Health Checks | §3.A Compute (GKE Autopilot) | Probes target `/health`; see [Group 13](#group-13-observability--health). |
| Cloud Armor WAF | §4.A Cloud Armor WAF | Identical. |
| Identity-Aware Proxy | §4.B IAP | Useful for restricting Superset to internal users. |
| Traffic & Ingress | §5 Traffic & Ingress | `session_affinity = "ClientIP"` recommended; see [Group 17](#group-17-gke-backend-configuration). |
| Redis Cache | §8.A Redis / Memorystore | `enable_redis = false` by default; see [Group 14](#group-14-redis-cache). |

---

## How Superset_GKE Relates to App_GKE

1. **`SUPERSET_SECRET_KEY` is auto-generated.** `Superset_Common` creates a 50-character random key in Secret Manager. This key signs Flask sessions — changing it invalidates all active sessions.
2. **Two-phase initialisation.** `Superset_Common` provides `db-init` (database creation) and `app-init` (Superset schema migration and admin creation) jobs that run automatically on first deploy.
3. **`superset-data` GCS bucket is provisioned automatically.**
4. **PostgreSQL 15 is the supported database.** `database_type` defaults to `"POSTGRES_15"`.
5. **Session affinity is recommended.** `session_affinity = "ClientIP"` is the default to ensure Superset's stateful session handling works correctly across multiple pods.
6. **Health probes target `/health`.** Superset exposes a `/health` endpoint that returns HTTP 200 when the Gunicorn worker pool is ready.

---

## Group 0: Module Metadata & Configuration

Identical to `App_GKE`. See [App_GKE §1](../App_GKE/App_GKE.md#1-module-overview).

**Superset-specific defaults:**

| Variable | Superset_GKE Default | Notes |
|---|---|---|
| `credit_cost` | `150` | GKE deployments cost more credits than Cloud Run. |

---

## Group 1: Project & Identity

Identical to `App_GKE`. See [App_GKE §2](../App_GKE/App_GKE.md#2-iam--access-control).

---

## Group 2: Application Identity

**Superset-specific defaults:**

| Variable | Superset_GKE Default | App_GKE Default | Notes |
|---|---|---|---|
| `application_name` | `"superset"` | `"gkeapp"` | Base name for all resources. **Do not change after deployment.** |
| `display_name` | `"Superset"` | *(not in App_GKE)* | Human-readable name. |
| `description` | `"Apache Superset data visualisation platform"` | *(not in App_GKE)* | Deployment description. |
| `application_version` | `"latest"` | `"1.0.0"` | Superset release version. |

---

## Group 3: Runtime & Scaling

**Superset-specific defaults:**

| Variable | Superset_GKE Default | App_GKE Default | Notes |
|---|---|---|---|
| `container_port` | `8088` | `8080` | Superset's Gunicorn port. |
| `cpu_limit` | `"2000m"` | `"1000m"` | Python query execution requires 2 vCPU. |
| `memory_limit` | `"2Gi"` | `"512Mi"` | Query result caching and Pandas DataFrames require 2 Gi. |
| `min_instance_count` | `1` | `1` | Always one warm pod. |
| `max_instance_count` | `3` | `3` | Multiple concurrent users. |
| `enable_cloudsql_volume` | `true` | `true` | Cloud SQL Auth Proxy sidecar. |
| `timeout_seconds` | `600` | `300` | Extended for long-running queries. |

---

## Group 4: Access & Networking

Identical to `App_GKE`. See [App_GKE §4](../App_GKE/App_GKE.md#4-advanced-security).

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Identity-Aware Proxy. Restricts Superset to authenticated Google users. |
| `iap_authorized_users` | `[]` | Users/service accounts granted IAP access. |
| `iap_authorized_groups` | `[]` | Google Groups granted IAP access. |
| `enable_custom_domain` | `false` | Custom domain with SSL. |
| `application_domains` | `[]` | Custom domain names. |
| `reserve_static_ip` | `true` | Reserves a Global Static IP. |
| `enable_cloud_armor` | `false` | Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | WAF-exempt CIDR ranges. |
| `enable_vpc_sc` | `false` | VPC Service Controls. |

---

## Group 5: Environment Variables & Secrets

`SUPERSET_SECRET_KEY` is injected automatically from `Superset_Common`. The value is a 50-character random string stored in Secret Manager — do not rotate it without coordinating session invalidation.

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Additional env vars. |
| `secret_environment_variables` | `{}` | Additional Secret Manager references. `SUPERSET_SECRET_KEY` is auto-injected. |

---

## Group 6: Backup & Maintenance

Identical to `App_GKE`. See [App_GKE §3.B](../App_GKE/App_GKE.md#b-database-cloud-sql).

| Variable | Default | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Daily at 02:00 UTC. |
| `backup_retention_days` | `7` | 7-day retention. |
| `enable_backup_import` | `false` | One-time restore on deploy. |

---

## Group 7: CI/CD & GitHub Integration

Identical to `App_GKE`. See [App_GKE §6](../App_GKE/App_GKE.md#6-cicd--delivery).

---

## Group 8: Jobs & Scheduled Tasks

**Superset default two-phase init pipeline:**

| Job | Image | Purpose | Depends On | Timeout | `execute_on_apply` |
|---|---|---|---|---|---|
| `db-init` | `postgres:15-alpine` | Create Superset PostgreSQL database and user | — | 600s | `true` |
| `app-init` | (Superset app image) | Run `superset db upgrade` + `superset fab create-admin` | `db-init` | 1800s | `true` |

The `app-init` job runs the Superset container image itself and executes the combined database upgrade and initial admin user creation. The 30-minute timeout accommodates schema migrations on large or complex database setups.

Override `initialization_jobs` with a non-empty list to replace this default pipeline.

---

## Group 11: Database Configuration

**Superset-specific defaults:**

| Variable | Superset_GKE Default | App_GKE Default | Notes |
|---|---|---|---|
| `database_type` | `"POSTGRES_15"` | `"POSTGRES"` | Superset requires PostgreSQL. |
| `db_name` | `"superset_db"` | *(not in App_GKE)* | Database name passed to `Superset_Common`. |
| `db_user` | `"superset_user"` | *(not in App_GKE)* | Database user passed to `Superset_Common`. |

**Automatic password rotation:**

| Variable | Default | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Automated rotation. |
| `rotation_propagation_delay_sec` | `90` | Restart delay after rotation. |

---

## Group 13: Observability & Health

Superset exposes `/health` as its dedicated health endpoint.

**Startup probe:**

| Field | Superset Default | Notes |
|---|---|---|
| `path` | `"/health"` | Superset's health endpoint. |
| `initial_delay_seconds` | `60` | Gunicorn worker pool initialisation takes time. |
| `failure_threshold` | `12` | Allows up to 180s total startup tolerance. |

**Liveness probe:**

| Field | Superset Default |
|---|---|
| `path` | `"/health"` |
| `initial_delay_seconds` | `30` |

> **Override recommended:** `startup_probe_config` and `health_check_config` default to `path = "/healthz"`. Override both to `path = "/health"` for Superset.

---

## Group 14: Reliability Policies

Identical to `App_GKE`. See [App_GKE §7](../App_GKE/App_GKE.md#7-reliability--scheduling).

---

## Group 14: Redis Cache

Redis is **disabled by default** but **recommended for production** multi-user deployments. Redis serves as the Celery broker for async queries and the result backend for caching.

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enables Redis. Recommended for production. |
| `redis_host` | `""` | Redis hostname or IP. |
| `redis_port` | `"6379"` | Redis port (**string** in Superset_GKE, unlike number in Superset_CloudRun). |
| `redis_auth` | `""` | Redis AUTH password. Sensitive. |

---

## Group 17: GKE Backend Configuration

**Superset-specific defaults:**

| Variable | Superset_GKE Default | App_GKE Default | Notes |
|---|---|---|---|
| `session_affinity` | `"ClientIP"` | `"None"` | Ensures Superset sessions are consistently routed to the same pod. Required for reliable login behaviour. |
| `workload_type` | `null` | `null` | Defaults to `Deployment`. |
| `service_type` | `"LoadBalancer"` | `"LoadBalancer"` | External load balancer. |

---

## Module Outputs

| Output | Description |
|---|---|
| `service_name` | Kubernetes service name. |
| `service_url` | Service URL. |
| `service_external_ip` | External load balancer IP. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix. |
| `namespace` | Kubernetes namespace. |
| `database_instance_name` | Cloud SQL PostgreSQL 15 instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret for the database password. |
| `storage_buckets` | Created GCS storage buckets. |
| `container_image` | Container image used. |
| `kubernetes_ready` | `true` when Kubernetes resources are deployed. |

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `SUPERSET_SECRET_KEY` (via Secret Manager) | Auto-generated 50-char random string | **Critical** | If this value is changed after the first deployment, all existing user sessions are immediately invalidated and all encrypted data source credentials stored in Superset's PostgreSQL schema become permanently unreadable. Treat as immutable after first deploy. |
| `container_resources.memory_limit` | `"2Gi"` | **High** | Under 1 Gi gunicorn workers are OOM-killed during query execution. `"2Gi"` is the minimum; `"4Gi"` is recommended for production. On GKE Autopilot, `mem_request` also drives node provisioning — set close to `memory_limit`. |
| `container_resources.cpu_limit` | `"2000m"` | **High** | Superset migrations (run by the app-init job) and gunicorn startup require significant CPU. Under 1000m the init job may time out in its 1800 s window. |
| `container_resources.mem_request` | `null` (defaults to limit) | **Medium** | On GKE Autopilot, setting `mem_request` far below `memory_limit` leads to burstable scheduling and possible OOM eviction under memory pressure. |
| `enable_redis` | `false` | **High** | Without Redis, Celery workers have no broker or result backend. Async query execution, cache warming, and scheduled reports are all non-functional. For GKE production deployments, always set `enable_redis = true`. |
| `redis_host` | `null` | **High** | Required when `enable_redis = true`. An empty value causes all Celery workers to fail to connect on pod startup, making async queries permanently unavailable. |
| `SUPERSET_PORT` | `"8088"` (injected) | **High** | Must match `container_port`. Changing one without the other breaks all routing and health checks. |
| `application_database_name` | `"superset"` | **High** | Immutable after the db-init job has run. Changing orphans the entire Superset schema. |
| `application_database_user` | `"superset"` | **High** | Immutable after the db-init job has run. Renaming requires manual Cloud SQL intervention. |
| `application_version` | `"latest"` | **Medium** | Pinning to a specific version prevents uncontrolled upgrades that may introduce breaking API changes. Always test upgrades in staging. |
| `min_instance_count` | `1` | **High** | Scale-to-zero terminates Celery workers; async queries submitted while the pod is cold are lost. Superset has a 30–60 s startup time. |
| `max_instance_count` | (check your setting) | **Medium** | Multiple replicas share PostgreSQL but require Redis as a shared Celery result backend. Without Redis, async results are only accessible to the instance that executed the query. |
| `quota_memory_requests` / `quota_memory_limits` | `"4Gi"` / `"8Gi"` | **High** | GKE-specific: must use binary suffixes (`Gi`, `Mi`). Bare integers (e.g., `"4"`) are treated as bytes by Kubernetes and block all pod scheduling. |
| `stateful_pvc_enabled` | `false` | **Medium** | Superset does not need persistent volumes — state is in PostgreSQL and Redis. Enabling adds unnecessary StatefulSet complexity. |
| `pdb_min_available` | `"1"` | **Medium** | Setting to `"0"` allows all pods to be evicted simultaneously during node upgrades, causing a full Superset outage. |
| `enable_iap` | `false` | **High** | Without IAP the Superset login form is reachable from the load-balancer IP. Always enable IAP or configure Kubernetes network policies for production. |
| `startup_probe_config.failure_threshold` | `30` | **High** | Reducing below 15 causes GKE to kill pods before Superset completes db migrations and starts gunicorn. |
| `backup_schedule` | `"0 2 * * *"` | **Medium** | Disabling automated backups leaves all dashboards, charts, and RLS rules unprotected. |
| `db_tier` | `"db-f1-micro"` (Common default) | **Medium** | Insufficient for production Superset workloads. Override to at least `"db-custom-2-7680"` in production environments. |
| `SUPERSET_LOAD_EXAMPLES` | `"no"` (injected) | **Medium** | Overriding to `"yes"` populates the workspace with demo data on every startup and significantly increases init time. |
