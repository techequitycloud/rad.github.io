---
title: "Supabase_GKE Module — Configuration Guide"
sidebar_label: "Supabase GKE"
---

# Supabase_GKE Module — Configuration Guide

This guide describes every configuration variable available in the `Supabase_GKE` module. `Supabase_GKE` is a **wrapper module** that combines the generic [`App_GKE`](../App_GKE/App_GKE.md) infrastructure module with the [`Supabase_Common`](../Supabase_Common/) shared application configuration to deploy [Supabase](https://supabase.com/) — an open-source Firebase alternative — on Google Kubernetes Engine (GKE) Autopilot.

> **GKE-only:** Supabase is available in the GKE variant only. There is no `Supabase_CloudRun` module, as Supabase's multi-service architecture (Kong API gateway, Auth, Storage, Realtime, PostgREST) requires persistent connections and Kubernetes primitives that Cloud Run does not support.

Most configuration options in `Supabase_GKE` map directly to the same options in `App_GKE`. Where a variable is identical in behaviour, this guide references the `App_GKE` guide rather than repeating the documentation.

---

## Standard Configuration Reference

| Configuration Area | App_GKE.md Section | Supabase-Specific Notes |
|---|---|---|
| Module Metadata & Configuration | §1 Module Overview | Supabase-specific `module_description` and `module_services` defaults are pre-set. |
| Project & Identity | §2 IAM & Access Control | Identical. |
| Application Identity | §3.A Compute (GKE Autopilot) | Supabase defaults; see [Group 2](#group-2-application-identity). |
| Runtime & Scaling | §3.A Compute (GKE Autopilot) | Kong gateway is the main container; see [Group 3](#group-3-runtime--scaling). |
| Environment Variables & Secrets | §3 Core Service Configuration | JWT, anon key, service role key auto-managed; see [Group 5](#group-5-environment-variables--secrets). |
| Initialization Jobs & CronJobs | §3.E Initialization Jobs & CronJobs | `db-init` PostgreSQL job; see [Group 8](#group-8-jobs--scheduled-tasks). |
| Storage — GCS | §3.C Storage | `supabase-storage` GCS bucket provisioned automatically. |
| Database Configuration | §3.B Database (Cloud SQL) | PostgreSQL 15 required with pgvector extension; see [Group 11](#group-11-database-configuration). |
| Observability & Health Checks | §3.A Compute (GKE Autopilot) | Probes target `/health`; see [Group 13](#group-13-observability--health). |
| Cloud Armor WAF | §4.A Cloud Armor WAF | Identical. |
| Identity-Aware Proxy | §4.B IAP | Identical. |
| Traffic & Ingress | §5 Traffic & Ingress | `service_type = "LoadBalancer"` for external access to Kong. |
| Additional Services | §3.F Additional Services | Supabase microservices defined via `additional_services`; see [Group 20](#group-20-supabase-microservices). |

---

## How Supabase_GKE Relates to App_GKE

1. **Kong API gateway is the main container.** The primary GKE Deployment runs the Kong API gateway on port 8000. All Supabase service requests are routed through Kong's declarative configuration.
2. **Three secrets are auto-managed.** `Supabase_Common` creates and manages:
   - `SUPABASE_JWT_SECRET` — 32-char random (auto-generated if not provided).
   - `SUPABASE_ANON_KEY` — public anon JWT (placeholder if not provided; must be replaced with a signed JWT).
   - `SUPABASE_SERVICE_KEY` — service role JWT (placeholder if not provided).
3. **PostgreSQL 15 with pgvector.** Supabase requires PostgreSQL 15. The `pgvector` extension is typically enabled for AI/embedding features.
4. **Supabase microservices via `additional_services`.** Auth, Storage, Realtime, PostgREST, and Studio run as additional Kubernetes Deployments/Services defined in `additional_services`.
5. **`supabase-storage` GCS bucket is provisioned automatically** for file uploads.
6. **`enable_image_mirroring = true` is always set.** Supabase mirrors its images to Artifact Registry for reliability and to avoid Docker Hub rate limits.

---

## Group 0: Module Metadata & Configuration

Identical to `App_GKE`. See [App_GKE §1](../App_GKE/App_GKE.md#1-module-overview).

**Supabase-specific defaults:**

| Variable | Supabase_GKE Default | Notes |
|---|---|---|
| `credit_cost` | `150` | GKE deployment. |
| `enable_image_mirroring` | `true` | Always enabled — cannot be disabled. Supabase images are mirrored to Artifact Registry on every apply. |

---

## Group 1: Project & Identity

Identical to `App_GKE`. See [App_GKE §2](../App_GKE/App_GKE.md#2-iam--access-control).

---

## Group 2: Application Identity

**Supabase-specific defaults:**

| Variable | Supabase_GKE Default | App_GKE Default | Notes |
|---|---|---|---|
| `application_name` | `"supabase"` | `"gkeapp"` | Base name for all resources. **Do not change after deployment.** |
| `display_name` | `"Supabase"` | *(not in App_GKE)* | Human-readable name. |
| `description` | `"Supabase open-source Firebase alternative"` | *(not in App_GKE)* | Deployment description. |
| `application_version` | `"latest"` | `"1.0.0"` | Kong gateway image version. |

---

## Group 3: Runtime & Scaling

The primary container in the Supabase GKE Deployment runs the **Kong API gateway**.

**Supabase-specific defaults:**

| Variable | Supabase_GKE Default | App_GKE Default | Notes |
|---|---|---|---|
| `container_port` | `8000` | `8080` | Kong API gateway HTTP port. |
| `cpu_limit` | `"1000m"` | `"1000m"` | 1 vCPU for Kong. Individual microservices define their own resources via `additional_services`. |
| `memory_limit` | `"2Gi"` | `"512Mi"` | Kong requires more memory for routing and plugin processing. |
| `min_instance_count` | `1` | `1` | Always one Kong pod running. |
| `max_instance_count` | `3` | `3` | Maximum Kong pod replicas. |
| `enable_cloudsql_volume` | `true` | `true` | Cloud SQL Auth Proxy sidecar for PostgreSQL. |

---

## Group 4: Access & Networking

Identical to `App_GKE`. See [App_GKE §4](../App_GKE/App_GKE.md#4-advanced-security).

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Identity-Aware Proxy. |
| `iap_authorized_users` | `[]` | Users/service accounts granted IAP access. |
| `iap_authorized_groups` | `[]` | Google Groups granted IAP access. |
| `enable_custom_domain` | `false` | Custom domain with managed SSL. |
| `application_domains` | `[]` | Custom domain names. |
| `reserve_static_ip` | `true` | Reserves a Global Static IP. |
| `enable_cloud_armor` | `false` | Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | WAF-exempt CIDR ranges. |

---

## Group 5: Environment Variables & Secrets

`Supabase_Common` manages three secrets automatically:

| Secret | Environment Variable | Description |
|---|---|---|
| `{prefix}-jwt-secret` | `SUPABASE_JWT_SECRET` | 32-char random JWT signing secret (auto-generated if `jwt_secret` is empty). |
| `{prefix}-anon-key` | `SUPABASE_ANON_KEY` | Public anonymous JWT key. **Placeholder by default — must be replaced with a valid signed JWT.** |
| `{prefix}-service-role-key` | `SUPABASE_SERVICE_KEY` | Service role JWT key. **Placeholder by default — must be replaced with a valid signed JWT.** |

**Important:** The anon key and service role key are JWTs signed with the `SUPABASE_JWT_SECRET`. After deployment, generate proper JWTs using the `jwt_secret` output and update the secrets in Secret Manager. All Bitwarden clients and Supabase SDK calls use the `SUPABASE_ANON_KEY`.

**Providing your own keys at deploy time:**

| Variable | Group | Default | Description |
|---|---|---|---|
| `jwt_secret` | 3 | `""` | JWT signing secret. **Sensitive.** Leave empty for auto-generation (32-char random). |
| `anon_key` | 3 | `""` | Pre-generated anonymous JWT. **Sensitive.** Leave empty to use the auto-generated placeholder. |
| `service_role_key` | 3 | `""` | Pre-generated service role JWT. **Sensitive.** Leave empty to use the auto-generated placeholder. |

Kong environment variables injected by `Supabase_Common`:

| Variable | Value | Description |
|---|---|---|
| `KONG_DATABASE` | `off` | Kong uses declarative (file-based) configuration — no Kong database. |
| `KONG_DECLARATIVE_CONFIG` | `/home/kong/kong.yml` | Path to Kong's declarative config file. |
| `SUPABASE_PORT` | `8000` | Kong's listen port. |

Additional env vars:

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Additional plain-text env vars. |
| `secret_environment_variables` | `{}` | Additional Secret Manager references. The three Supabase secrets are auto-injected. |

---

## Group 6: Backup & Maintenance

Identical to `App_GKE`. See [App_GKE §3.B](../App_GKE/App_GKE.md#b-database-cloud-sql).

| Variable | Default | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Daily at 02:00 UTC. |
| `backup_retention_days` | `7` | Increase for production (30–90 days). |

---

## Group 7: CI/CD & GitHub Integration

Identical to `App_GKE`. See [App_GKE §6](../App_GKE/App_GKE.md#6-cicd--delivery).

---

## Group 8: Jobs & Scheduled Tasks

**Supabase default `db-init` job:**

| Field | Value |
|---|---|
| Job name | `db-init` |
| Image | `postgres:15-alpine` |
| Purpose | Initialises the Supabase PostgreSQL database, user, and extensions (including `pgvector`) |
| `execute_on_apply` | `true` |
| CPU / Memory | `1000m` / `512Mi` |

Override `initialization_jobs` with a non-empty list to replace this default.

---

## Group 11: Database Configuration

**Supabase-specific defaults and requirements:**

| Variable | Supabase_GKE Default | Notes |
|---|---|---|
| `database_type` | `"POSTGRES_15"` | **Supabase requires PostgreSQL 15.** |
| `application_database_name` | `"postgres"` | Supabase uses the default `postgres` database name (not a custom db). |
| `application_database_user` | `"supabase_admin"` | Supabase admin user. |
| `db_name` | `"postgres"` | Passed to `Supabase_Common`. |
| `db_user` | `"supabase_admin"` | Passed to `Supabase_Common`. |

> **pgvector:** The Supabase `db-init.sh` script enables the `pgvector` extension in the PostgreSQL database. This is required for Supabase's AI/vector features. Ensure the Cloud SQL PostgreSQL 15 instance supports `pgvector` (available on Cloud SQL for PostgreSQL 13+).

**Automatic password rotation:**

| Variable | Default | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Automated rotation. |
| `rotation_propagation_delay_sec` | `90` | Restart delay after rotation. |

---

## Group 13: Observability & Health

Supabase's Kong gateway exposes `/health` as its health endpoint.

**Startup probe:**

| Field | Supabase Default |
|---|---|
| `path` | `"/health"` |
| `initial_delay_seconds` | `30` |
| `failure_threshold` | `6` |

> **Override recommended:** `startup_probe_config` and `health_check_config` default to `path = "/healthz"`. Override both to `path = "/health"` for Supabase.

---

## Group 14: Reliability Policies

Identical to `App_GKE`. Variables available: `enable_pod_disruption_budget` (default `true`), `pdb_min_available` (default `"1"`), `enable_topology_spread`, `topology_spread_strict`.

---

## Group 17: GKE Backend Configuration

**Supabase-specific defaults:**

| Variable | Supabase_GKE Default | Notes |
|---|---|---|
| `service_type` | `"LoadBalancer"` | External load balancer for Kong API gateway. |
| `workload_type` | `null` | Defaults to `Deployment`. |
| `session_affinity` | `"None"` | Kong is stateless; session affinity is not required at the gateway level. |

---

## Group 20: Supabase Microservices

Supabase's microservices (Auth, Storage, Realtime, PostgREST, Studio) are deployed as additional Kubernetes workloads via the `additional_services` variable. Each microservice is defined as an object specifying its container image, resources, environment variables, and exposed ports.

| Variable | Default | Description |
|---|---|---|
| `additional_services` | `[]` | List of additional Kubernetes Deployments and Services for Supabase microservices. Each entry: `name`, `image`, `container_port`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `replicas`, `service_type`. |

Example `additional_services` entries for a standard Supabase deployment:

- **supabase-auth** — GoTrue authentication service on port 9999
- **supabase-rest** — PostgREST API on port 3000
- **supabase-realtime** — Elixir Realtime server on port 4000
- **supabase-storage** — Storage API on port 5000
- **supabase-studio** — Supabase Studio dashboard on port 3000

Refer to the [Supabase self-hosting documentation](https://supabase.com/docs/guides/self-hosting) for the environment variables required by each service.

---

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `jwt_secret` | Auto-generated 32-byte random secret | **Critical** | Changing `jwt_secret` after initial deploy invalidates every issued JWT — all client connections break immediately. `anon_key` and `service_role_key` must be regenerated together whenever `jwt_secret` changes. Treat as permanently immutable after first deploy. |
| `anon_key` | Empty (placeholder stored in Secret Manager) | **Critical** | Must be a valid JWT signed with the current `jwt_secret` and payload `{ "role": "anon" }`. A mismatched or placeholder value means the Supabase JavaScript client cannot authenticate any request — all API calls return 401. |
| `service_role_key` | Empty (placeholder stored in Secret Manager) | **Critical** | Must be a valid JWT signed with `jwt_secret` and payload `{ "role": "service_role" }`. A mismatched value breaks all server-side calls that bypass RLS. This key has full database access; never expose it in client-side code. |
| `anon_key` + `service_role_key` (pair) | Generated together with `jwt_secret` | **Critical** | All three JWT credentials must be regenerated as an atomic set. Providing a new `jwt_secret` with old derived keys, or vice versa, causes immediate authentication failures across every Supabase service (GoTrue, PostgREST, Realtime, Storage). |
| `db_name` | `postgres` | **High** | The Supabase schema initialisation scripts target the `postgres` database by name. Using a different name requires fully custom init scripts; the default Kong configuration will fail to connect. |
| `db_user` | `supabase_admin` | **High** | PostgREST, GoTrue, and Realtime all connect using the `supabase_admin` user. Changing this without updating all microservice configurations causes connection failures across every Supabase service. |
| `min_instance_count` | `1` | **High** | Setting to `0` enables scale-to-zero. Kong gateway cold starts under Kubernetes take 15–30 seconds, making the Supabase API appear unavailable and breaking OAuth redirect flows that expect immediate responses. |
| `enable_cloudsql_volume` | `true` | **Critical** | Must be `true`. Supabase uses the Cloud SQL Auth Proxy Unix socket for all database connections. Setting this to `false` causes GoTrue, PostgREST, and Storage to fail on startup with connection errors. |
| `application_version` | `2.8.1` | **Medium** | Pinning to `latest` risks pulling a Kong version incompatible with the bundled Supabase Kong configuration. Always pin to a tested version and test upgrades in a staging environment first. |
| `cpu_limit` | `1000m` | **High** | The Kong gateway handles all Supabase API traffic plus JWT validation for every request. Insufficient CPU causes elevated latency and 504 timeouts under moderate load. 2000m is recommended for production. |
| `memory_limit` | `2Gi` | **High** | Kong with Lua plugins and the Supabase declarative configuration requires at least 512Mi; less than 1Gi causes OOM kills under concurrent load. 2Gi is the minimum for production. |
| `startup_probe.failure_threshold` | `18` | **High** | Supabase init jobs and database schema creation can take up to 3 minutes on first deploy. Reducing this threshold below 12 causes the pod to be killed before GoTrue finishes initialising, resulting in a CrashLoopBackOff. |
| `liveness_probe.initial_delay_seconds` | `60` | **Medium** | Too short an initial delay causes the liveness probe to fire before Kong is ready, triggering a premature restart loop on every fresh pod start. |
| `enable_nfs` | `false` | **Low** | NFS is not required for Supabase; storage is handled via GCS. Enabling NFS adds unnecessary cost and a Filestore dependency that can delay cluster provisioning. |
| `enable_redis` | `false` | **Medium** | Redis is optional. If provided, `redis_host` must point to a reachable endpoint before Supabase starts. An unreachable Redis host causes connection timeout errors in Kong at startup. |
| `redis_auth` | `""` | **Medium** | If Redis requires authentication, leaving `redis_auth` empty causes Kong to fail connecting. If Redis is open, setting `redis_auth` to a non-empty value also causes failure. Must match the Redis instance's actual auth configuration. |
| `stateful_pvc_enabled` | `false` | **High** | Supabase state is stored in Cloud SQL and GCS. Enabling StatefulSet PVCs adds persistent storage that is never actually written to by the Kong gateway, wastes resources, and increases the risk of pod scheduling failures when Autopilot cannot provision the requested disk. |
| `enable_binary_authorization` | `false` | **Medium** | When enabled with `REQUIRE_ATTESTATION`, all Supabase microservice images must carry valid Binary Authorization attestations. An unattested image blocks pod scheduling with no error shown in the application — only visible in GKE events. |
| `quota_memory_requests` / `quota_memory_limits` | `"4Gi"` / `"8Gi"` | **Critical** | Values must use binary unit suffixes (e.g., `"4Gi"`, `"8192Mi"`). A bare integer (e.g., `"4"`) is treated as bytes by Kubernetes, setting an effectively zero memory quota and blocking all pod scheduling immediately. |
| `enable_vpc_sc` | `false` | **High** | Requires `organization_id` to be explicitly set. Without it, VPC Service Controls are silently skipped. Enabling `enable_vpc_sc` without a valid org ID leaves the perimeter not created, giving a false sense of security. |
| `organization_id` | `""` | **High** | Required when `enable_vpc_sc = true`. Auto-discovery is intentionally disabled to prevent unintended VPC-SC activation. An empty value silently skips perimeter creation. |
| `enable_iap` | `false` | **Medium** | When IAP is enabled, `iap_oauth_client_id` and `iap_oauth_client_secret` must both be set. Missing values cause IAP to be misconfigured, potentially blocking all access or leaving the service unprotected. |
| `backup_schedule` | `"0 2 * * *"` | **Medium** | An empty string disables automated backups entirely. With no backup, a Cloud SQL deletion or schema corruption cannot be recovered without manual intervention. Ensure a schedule is set before go-live. |
| `enable_artifact_registry_cmek` | `false` | **Medium** | Enabling CMEK without first running `ensure_storage_key_enabled.sh` to verify the key is active causes the Artifact Registry repository creation to fail if the KMS key is in `DESTROY_SCHEDULED` or `DISABLED` state. |

---

## Module Outputs

| Output | Description |
|---|---|
| `service_name` | Kubernetes service name (Kong gateway). |
| `service_url` | Service URL. |
| `service_external_ip` | External load balancer IP (Kong gateway). |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix. |
| `namespace` | Kubernetes namespace. |
| `database_instance_name` | Cloud SQL PostgreSQL 15 instance name. |
| `database_name` | Application database name (`postgres`). |
| `database_user` | Application database user (`supabase_admin`). |
| `database_password_secret` | Secret Manager secret for the database password. |
| `storage_buckets` | Created GCS storage buckets. |
| `container_image` | Kong container image used. |
| `kubernetes_ready` | `true` when Kubernetes resources are deployed. |
