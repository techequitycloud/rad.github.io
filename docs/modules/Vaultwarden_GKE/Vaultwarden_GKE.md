---
title: "Vaultwarden_GKE Module — Configuration Guide"
sidebar_label: "Vaultwarden GKE"
---

# Vaultwarden_GKE Module — Configuration Guide

This guide describes every configuration variable available in the `Vaultwarden_GKE` module. `Vaultwarden_GKE` is a **wrapper module** that combines the generic [`App_GKE`](../App_GKE/App_GKE.md) infrastructure module with the [`Vaultwarden_Common`](../Vaultwarden_Common/) shared application configuration to deploy [Vaultwarden](https://github.com/dani-garcia/vaultwarden) on Google Kubernetes Engine (GKE) Autopilot.

Most configuration options in `Vaultwarden_GKE` map directly to the same options in `App_GKE`. Where a variable is identical in behaviour, this guide references the `App_GKE` guide rather than repeating the same documentation.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

---

## Standard Configuration Reference

| Configuration Area | App_GKE.md Section | Vaultwarden-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | §1 Module Overview | Vaultwarden-specific `module_description` and `module_services` defaults are pre-set. |
| Project & Identity | §2 IAM & Access Control | Identical. |
| Application Identity | §3.A Compute (GKE Autopilot) | Vaultwarden-specific defaults; see [Group 2](#group-2-application-identity). |
| Runtime & Scaling | §3.A Compute (GKE Autopilot) | Vaultwarden-specific defaults; see [Group 3](#group-3-runtime--scaling). |
| Environment Variables & Secrets | §3 Core Service Configuration | Application vars injected by wrapper; see [Group 5](#group-5-environment-variables--secrets). |
| Initialization Jobs & CronJobs | §3.E Initialization Jobs & CronJobs | Supports both PostgreSQL and MySQL db-init jobs; see [Group 8](#group-8-jobs--scheduled-tasks). |
| Storage — GCS | §3.C Storage | `vaultwarden-data` GCS bucket provisioned automatically. |
| Database Configuration | §3.B Database (Cloud SQL) | Supports PostgreSQL 15 (default) and MySQL 8.0; see [Group 11](#group-11-database-configuration). |
| Backup Schedule & Retention | §3.B Database (Cloud SQL) | `backup_retention_days` defaults to `30` (longer than other modules). |
| Observability & Health Checks | §3.A Compute (GKE Autopilot) | Probes target `/alive`; see [Group 13](#group-13-observability--health). |
| Cloud Armor WAF | §4.A Cloud Armor WAF | Recommended for Vaultwarden. |
| Identity-Aware Proxy | §4.B Identity-Aware Proxy (IAP) | Identical. |
| Stateful Workloads | StatefulSet config in App_GKE | **StatefulSet is the default workload type** with a 10 Gi PVC at `/data`; see [Group 18](#group-18-stateful-workloads). |
| Traffic & Ingress | §5 Traffic & Ingress | `session_affinity = "ClientIP"` by default; see [Group 17](#group-17-gke-backend-configuration). |

---

## How Vaultwarden_GKE Relates to App_GKE

`Vaultwarden_GKE` passes all variables through to `App_GKE` and adds a `Vaultwarden_Common` sub-module. The main effects are:

1. **StatefulSet with PVC is the default.** Unlike most modules that default to `Deployment`, `Vaultwarden_GKE` defaults to `workload_type = "StatefulSet"` with `stateful_pvc_enabled = true`, `stateful_pvc_size = "10Gi"`, and `stateful_pvc_mount_path = "/data"`. This provides persistent local storage for Vaultwarden's data directory.
2. **PostgreSQL 15 (default) or MySQL 8.0 supported.** Set `database_type = "MYSQL_8_0"` for MySQL. `Vaultwarden_Common` selects the appropriate init job image automatically.
3. **Session affinity is enabled by default.** `session_affinity = "ClientIP"` ensures Bitwarden client connections are routed consistently to the same pod.
4. **`DATA_FOLDER=/data` is injected automatically.** The wrapper injects this env var pointing to the PVC mount path.
5. **`SIGNUPS_ALLOWED=false` by default.** Registrations are disabled by default. Set `signups_allowed = true` for initial setup; disable immediately after creating admin accounts.
6. **No application-level secrets.** `Vaultwarden_Common` creates no Secret Manager secrets. All credential management is by `App_GKE`.

---

## Group 0: Module Metadata & Configuration

Identical to `App_GKE`. See [App_GKE §1](../App_GKE/App_GKE.md#1-module-overview).

**Vaultwarden-specific defaults:**

| Variable | Vaultwarden_GKE Default | Notes |
|---|---|---|
| `module_description` | `"Vaultwarden: Deploy Vaultwarden password manager on GKE Autopilot…"` | Pre-populated. |
| `credit_cost` | `150` | GKE deployments cost more than Cloud Run. |

---

## Group 1: Project & Identity

Identical to `App_GKE`. See [App_GKE §2](../App_GKE/App_GKE.md#2-iam--access-control).

---

## Group 2: Application Identity

**Vaultwarden-specific defaults:**

| Variable | Vaultwarden_GKE Default | App_GKE Default | Notes |
|---|---|---|---|
| `application_name` | `"vaultwarden"` | `"gkeapp"` | Base name for all resources. **Do not change after deployment.** |
| `display_name` | `"Vaultwarden"` | *(not in App_GKE)* | Human-readable name for the platform UI. |
| `description` | `"Vaultwarden password manager"` | *(not in App_GKE)* | Deployment description. |
| `application_version` | `"1.32.7"` | `"1.0.0"` | Vaultwarden release version. |

---

## Group 3: Runtime & Scaling

**Vaultwarden-specific defaults:**

| Variable | Vaultwarden_GKE Default | App_GKE Default | Notes |
|---|---|---|---|
| `container_port` | `80` | `8080` | Vaultwarden's HTTP port. |
| `cpu_limit` | `"1000m"` | `"1000m"` | Vaultwarden is a lightweight Rust binary. |
| `memory_limit` | `"512Mi"` | `"512Mi"` | Same as App_GKE default. |
| `min_instance_count` | `1` | `1` | At least one Vaultwarden pod always running. |
| `max_instance_count` | `3` | `3` | Maximum pod replicas. |
| `enable_cloudsql_volume` | `true` | `true` | Cloud SQL Auth Proxy sidecar. |

**Application-specific variables:**

| Variable | Default | Description |
|---|---|---|
| `domain` | `""` | Vaultwarden's public domain for WebAuthn and email links. Injected as `DOMAIN` when non-empty. |
| `signups_allowed` | `false` | Allow new user registrations. Set `true` for initial setup only. |
| `web_vault_enabled` | `true` | Enable the Vaultwarden web UI. |

---

## Group 4: Access & Networking

Identical to `App_GKE`. See [App_GKE §4](../App_GKE/App_GKE.md#4-advanced-security) and [App_GKE §5](../App_GKE/App_GKE.md#5-traffic--ingress).

**Cloud Armor recommendation:** Enabling `enable_cloud_armor = true` is strongly recommended for Vaultwarden deployments to protect login endpoints from brute-force attacks.

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Enables Identity-Aware Proxy. |
| `iap_authorized_users` | `[]` | Users/service accounts granted IAP access. |
| `iap_authorized_groups` | `[]` | Google Groups granted IAP access. |
| `enable_custom_domain` | `false` | Custom domain with managed SSL. |
| `application_domains` | `[]` | Custom domain names. Also set `domain` to the full `https://` URL. |
| `reserve_static_ip` | `true` | Reserves a Global Static IP. |
| `enable_cloud_armor` | `false` | Cloud Armor WAF. **Recommended for Vaultwarden.** |
| `admin_ip_ranges` | `[]` | WAF-exempt CIDR ranges. |
| `enable_vpc_sc` | `false` | VPC Service Controls. |

---

## Group 5: Environment Variables & Secrets

The `vaultwarden.tf` wrapper injects the following environment variables automatically:

| Variable | Value | Description |
|---|---|---|
| `ROCKET_PORT` | `var.container_port` | Vaultwarden's HTTP listen port. |
| `SIGNUPS_ALLOWED` | `var.signups_allowed` | Registration control. |
| `WEB_VAULT_ENABLED` | `var.web_vault_enabled` | Web UI toggle. |
| `DATA_FOLDER` | `/data` | Vaultwarden data directory (PVC mount path). |
| `DOMAIN` | `var.domain` (if non-empty) | Public URL for WebAuthn and email links. |

Default environment variable values:

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `warn` | Log verbosity. |
| `SHOW_PASSWORD_HINT` | `false` | Disable password hints. |
| `SMTP_HOST` | `""` | SMTP server hostname. |
| `SMTP_PORT` | `587` | SMTP port. |
| `SMTP_FROM` | `vaultwarden@example.com` | Sender email. |
| `SMTP_SSL` | `true` | Enable SMTP TLS. |

Override via `environment_variables`. Use `secret_environment_variables` for SMTP passwords.

---

## Group 6: Backup & Maintenance

**Vaultwarden-specific default:**

| Variable | Default | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Daily at 02:00 UTC. |
| `backup_retention_days` | `30` | **30-day retention** (higher than other modules) to accommodate vault recovery scenarios. |
| `enable_backup_import` | `false` | One-time restore on deploy. |

---

## Group 7: CI/CD & GitHub Integration

Identical to `App_GKE`. See [App_GKE §6](../App_GKE/App_GKE.md#6-cicd--delivery).

---

## Group 8: Jobs & Scheduled Tasks

**Vaultwarden db-init job:**

`Vaultwarden_Common` detects `database_type` and selects the appropriate init job image:

| `database_type` | Image | Description |
|---|---|---|
| `POSTGRES_15` (default) | `postgres:15-alpine` | Initialises Vaultwarden PostgreSQL database and user |
| `MYSQL_8_0` | `mysql:8.0-debian` | Initialises Vaultwarden MySQL database and user |

| Field | Value |
|---|---|
| Job name | `db-init` |
| `execute_on_apply` | `true` |
| CPU / Memory | `1000m` / `512Mi` |
| Max retries | `3` |

Override `initialization_jobs` with a non-empty list to replace this default.

---

## Group 11: Database Configuration

**Vaultwarden-specific defaults:**

| Variable | Vaultwarden_GKE Default | Notes |
|---|---|---|
| `database_type` | `"POSTGRES_15"` | Default. Set `"MYSQL_8_0"` for MySQL. |
| `db_name` | `"vaultwarden"` | **Do not change after deployment.** |
| `db_user` | `"vaultwarden"` | Application database user. |

**Automatic password rotation:**

| Variable | Default | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Automated rotation. |
| `rotation_propagation_delay_sec` | `90` | Restart delay after rotation. |

---

## Group 13: Observability & Health

Vaultwarden exposes `/alive` as its dedicated health endpoint.

**Startup probe:**

| Field | Vaultwarden Default | Notes |
|---|---|---|
| `path` | `"/alive"` | Vaultwarden's health endpoint. |
| `initial_delay_seconds` | `30` | Vaultwarden starts quickly as a Rust binary. |
| `failure_threshold` | `6` | Tolerance for first-boot database connection. |

**Liveness probe:**

| Field | Vaultwarden Default |
|---|---|
| `path` | `"/alive"` |
| `initial_delay_seconds` | `30` |

> **Override recommended:** `startup_probe_config` and `health_check_config` default to `path = "/healthz"`. Override both to `path = "/alive"` for Vaultwarden.

---

## Group 14: Reliability Policies

Identical to `App_GKE`. See [App_GKE §7](../App_GKE/App_GKE.md#7-reliability--scheduling).

**PodDisruptionBudget is enabled by default** (`enable_pod_disruption_budget = true`, `pdb_min_available = "1"`) to ensure zero-downtime pod evictions for a password manager.

---

## Group 17: GKE Backend Configuration

**Vaultwarden-specific defaults:**

| Variable | Vaultwarden_GKE Default | App_GKE Default | Notes |
|---|---|---|---|
| `workload_type` | `"StatefulSet"` | `null` (Deployment) | StatefulSet for persistent local storage at `/data`. |
| `session_affinity` | `"ClientIP"` | `"None"` | Ensures Bitwarden client connections route to the same pod. |
| `service_type` | `"LoadBalancer"` | `"LoadBalancer"` | Exposes Vaultwarden via external load balancer. |

---

## Group 18: Stateful Workloads

`Vaultwarden_GKE` defaults to a StatefulSet with a persistent PVC for Vaultwarden's data directory:

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Provisions a PersistentVolumeClaim for Vaultwarden's data. |
| `stateful_pvc_size` | `"10Gi"` | PVC size. Increase for large vaults. |
| `stateful_pvc_mount_path` | `"/data"` | Mount path matching `DATA_FOLDER`. |
| `stateful_pvc_storage_class` | `""` | Storage class (empty = cluster default). |
| `stateful_headless_service` | `false` | Headless service for StatefulSet DNS. |
| `stateful_pod_management_policy` | `"OrderedReady"` | Pod startup order policy. |
| `stateful_update_strategy` | `"RollingUpdate"` | Update strategy. |

> **Note:** StatefulSet auto-select applies here: `stateful_pvc_enabled = true` automatically resolves to `workload_type = "StatefulSet"`. Do not set `workload_type = "Deployment"` alongside `stateful_pvc_enabled = true` — this fails at plan time.

---

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `domain` | `""` (empty — not injected) | **High** | Must be the full public URL (e.g., `https://vault.example.com`). Without it, TOTP/2FA QR codes link to `localhost`, organisation invitation emails contain broken links, and attachment download URLs are invalid. Set this before any user enables 2FA. |
| `signups_allowed` | `false` | **Critical** | The module defaults to `false`. If set to `true` before initial admin setup, any internet user can register on the vault. Lock down registrations immediately after the first admin account is created. |
| `admin_token` (via `environment_variables`) | Not set (admin panel disabled) | **High** | When `ADMIN_TOKEN` is absent, the `/admin` panel is completely disabled — the intended secure default. If admin access is needed, set `ADMIN_TOKEN` to an Argon2 hash or a strong random string via `environment_variables`. |
| `stateful_pvc_enabled` | `false` (defaults to Deployment) | **High** | Setting to `true` without setting a `stateful_pvc_size` will use the Kubernetes default disk size. Vaultwarden data is served from Cloud SQL; local PVC data will be lost if the StatefulSet is deleted. Consider whether persistent local disk is truly needed alongside Cloud SQL. |
| `workload_type` + `stateful_pvc_enabled` | Deployment / false | **High** | Setting `workload_type = "Deployment"` and `stateful_pvc_enabled = true` fails at plan time. StatefulSet is auto-selected when `stateful_pvc_enabled = true`; do not set both explicitly. |
| `database_type` | `POSTGRES_15` | **High** | Changing the database type after first deploy causes Vaultwarden to connect to an empty database. All vault data will appear lost until the original type is restored. |
| `db_name` | `vaultwarden` | **High** | Changing after initial deploy causes Vaultwarden to see an empty database on the next pod restart. All credentials appear lost until the name is restored. |
| `min_instance_count` | `1` | **High** | Setting to `0` enables scale-to-zero in GKE (via HPA). A password manager with scale-to-zero means the vault is unavailable for several seconds after a cold start; Bitwarden clients show connection errors during this window. |
| `container_port` | `80` | **High** | Must match the `ROCKET_PORT` environment variable. A mismatch means the Kubernetes readiness probe fails and the pod never enters the Ready state, blocking all traffic indefinitely. |
| `container_protocol` | `http1` | **Medium** | Vaultwarden uses HTTP/1.1 for its REST API. Setting to `h2c` will cause the GKE load balancer to use h2c-specific connection handling that Vaultwarden does not support, resulting in protocol negotiation failures and 502 errors. |
| `enable_cloudsql_volume` | `true` | **Critical** | Must be `true`. Vaultwarden connects to Cloud SQL via the Auth Proxy Unix socket. Disabling this causes all database connections to fail and the pod enters a CrashLoopBackOff immediately. |
| `smtp_*` variables (via `environment_variables`) | Not set | **High** | SMTP variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_SECURITY`) must all be set together or not at all. Partial configuration causes silent email delivery failures — Vaultwarden logs no error but invitation, 2FA recovery, and password-reset emails are never delivered. |
| `quota_memory_requests` / `quota_memory_limits` | `"4Gi"` / `"8Gi"` | **Critical** | Values must use binary unit suffixes (e.g., `"4Gi"`, `"8192Mi"`). Bare integers are treated as bytes by Kubernetes, creating an effectively zero memory quota that blocks all pod scheduling immediately. |
| `enable_resource_quota` | `false` | **Medium** | When enabled with incorrect quota values, the namespace quota immediately prevents the Vaultwarden pod from being scheduled. Verify `quota_memory_requests` and `quota_memory_limits` values before enabling. |
| `backup_schedule` | `"0 2 * * *"` | **Medium** | An empty string disables automated backups. A password manager without backups means a Cloud SQL failure results in permanent credential loss for all vault users. |
| `enable_pod_disruption_budget` | `true` | **Medium** | Disabling PDB allows GKE node upgrades to evict the Vaultwarden pod without waiting, causing a vault outage during cluster maintenance windows. |
| `session_affinity` | `false` | **Low** | Enabling session affinity is not needed for Vaultwarden since all session state is in the database. It can cause uneven pod load distribution when multiple replicas are running. |
| `enable_vpc_sc` | `false` | **High** | Requires explicit `organization_id`. Without it, VPC Service Controls are silently skipped. Enabling without a valid org ID leaves the perimeter uncreated. |
| `enable_iap` | `false` | **Medium** | When enabled, `iap_oauth_client_id` and `iap_oauth_client_secret` must both be provided. Partial configuration leaves the backend either fully blocked or unprotected. |

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
| `database_instance_name` | Name of the Cloud SQL instance. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret for the database password. |
| `storage_buckets` | Created GCS storage buckets. |
| `container_image` | Container image used. |
| `kubernetes_ready` | `true` when Kubernetes resources are deployed. |
