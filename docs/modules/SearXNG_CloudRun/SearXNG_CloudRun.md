---
title: "SearXNG on Google Cloud Run"
sidebar_label: "SearXNG CloudRun"
---

# SearXNG on Google Cloud Run

This document provides a comprehensive reference for the `modules/SearXNG_CloudRun` Terraform module. It covers architecture, IAM, configuration variables, SearXNG-specific behaviours, and operational patterns for deploying SearXNG on Google Cloud Run (v2).

---

## 1. Module Overview

SearXNG is a privacy-respecting, self-hosted metasearch engine with 10,000+ GitHub stars that aggregates results from 70+ search services without tracking users or serving ads. It is ideal for organisations requiring a GDPR-compliant, ad-free alternative to Google or Bing with zero data profiling. `SearXNG CloudRun` is a **wrapper module** built on top of `App CloudRun`. It uses `App CloudRun` for all GCP infrastructure provisioning and injects SearXNG-specific application configuration via `SearXNG Common`.

**Key Capabilities:**
*   **Compute**: Cloud Run v2 (Gen2), 1 vCPU / 512 Mi by default. **Scale-to-zero is fixed** (`min_instance_count = 0` hardcoded in `searxng.tf`). `max_instance_count` is user-configurable.
*   **Stateless**: SearXNG does not use a database. No Cloud SQL instance is provisioned. `enable_cloudsql_volume` defaults to `false`.
*   **Secret**: `SEARXNG_SECRET` (session key) is auto-generated and stored in Secret Manager by `SearXNG Common`. It is injected into the container at runtime.
*   **Redis** (optional): Redis can be enabled for rate limiting and bot detection. When `enable_redis = true` and `redis_host` is empty, defaults to `127.0.0.1`.
*   **Prebuilt default**: `container_image_source = 'prebuilt'` is the default — the official SearXNG image is deployed directly. Set to `'custom'` to build a modified image via Cloud Build.
*   **Health**: Health probes target `/healthz`.

**Project & Application Identity**

| Variable | Group | Type | Default | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | GCP project ID. **Required.** |
| `tenant_deployment_id` | 2 | `string` | `'demo'` | Short suffix appended to all resource names. |
| `support_users` | 2 | `list(string)` | `[]` | Email recipients for monitoring alerts. |
| `resource_labels` | 2 | `map(string)` | `{}` | Labels applied to all provisioned resources. |
| `application_name` | 3 | `string` | `'searxng'` | Base resource name. Do not change after initial deployment. |
| `display_name` | 3 | `string` | `'SearXNG Search'` | Human-readable name shown in the GCP Console. |
| `description` | 3 | `string` | `'SearXNG — privacy-respecting metasearch engine on Cloud Run'` | Cloud Run service description. |
| `application_version` | 3 | `string` | `'latest'` | SearXNG image version tag (e.g., `'2024.11.4'`). |

**Wrapper architecture:** `SearXNG CloudRun` calls `SearXNG Common` to produce an `application_config` object. The `module_secret_env_vars` carries only `SEARXNG_SECRET`. `module_storage_buckets = module.searxng_app.storage_buckets`. The `min_instance_count = 0` is hardcoded in the `searxng_module` merge in `searxng.tf`. `SEARXNG_BIND_ADDRESS`, `ENABLE_REDIS`, and `REDIS_URL` are injected via `module_env_vars`.

---

## 2. IAM & Access Control

`SearXNG CloudRun` delegates all IAM provisioning to `App CloudRun`. Because SearXNG is stateless (no database, no file uploads), the IAM footprint is minimal — only Secret Manager read access for `SEARXNG_SECRET` is required beyond the standard Cloud Run SA roles.

**Auto-generated secret:** `SearXNG Common` auto-generates `SEARXNG_SECRET` and stores it in Secret Manager. This key is used for SearXNG's session cryptography and must be consistent across all running instances.

---

## 3. Core Service Configuration

### A. Compute (Cloud Run)

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 4 | `'prebuilt'` | `'prebuilt'` deploys the official SearXNG image. `'custom'` builds from source. |
| `container_image` | 4 | `""` | Container image URI override. Leave blank for the official SearXNG image. |
| `cpu_limit` | 4 | `'1000m'` | CPU per instance. SearXNG is lightweight; 1 vCPU handles moderate traffic. |
| `memory_limit` | 4 | `'512Mi'` | Memory per instance. 512 Mi is recommended minimum. |
| `max_instance_count` | 4 | `3` | Maximum instances (acts as a cost ceiling). |
| `container_port` | 4 | `8080` | SearXNG's HTTP port. |
| `execution_environment` | 4 | `'gen2'` | Gen2 recommended. |
| `timeout_seconds` | 4 | `60` | Max request duration. SearXNG requests are short-lived search aggregations. |
| `enable_cloudsql_volume` | 4 | `false` | **Disabled** — SearXNG does not use a database. |
| `service_annotations` | 4 | `{}` | Advanced Cloud Run annotations. |
| `service_labels` | 4 | `{}` | Labels applied to the Cloud Run service. |
| `enable_image_mirroring` | 4 | `true` | Mirrors the SearXNG image into Artifact Registry. |
| `traffic_split` | 4 | `[]` | Canary/blue-green traffic allocation. |
| `max_revisions_to_retain` | 4 | `7` | Maximum Cloud Run revisions to keep. |
| `container_protocol` | 4 | `'http1'` | HTTP protocol version. |

> **Note:** `min_instance_count` is hardcoded to `0` in `searxng.tf` and is not user-configurable. SearXNG cold starts are fast (< 5 seconds) because the container does not perform database connections or schema migrations.

**Differences from `App CloudRun` defaults:**

| Variable | `App CloudRun` | `SearXNG CloudRun` | Reason |
|---|---|---|---|
| `enable_cloudsql_volume` | `true` | `false` | SearXNG has no database. |
| `container_image_source` | `'custom'` | `'prebuilt'` | No custom Dockerfile required for the official SearXNG image. |
| `timeout_seconds` | `300` | `60` | Search requests complete quickly. |
| `memory_limit` | `'512Mi'` | `'512Mi'` | SearXNG is lightweight. |

### B. No Database

SearXNG is **stateless** — it aggregates results from external search engines at request time and does not persist data. No Cloud SQL instance is provisioned. `database_type` is effectively `NONE`.

The following database-related variables exist in `variables.tf` (inherited from the Foundation Module interface) but have no effect for SearXNG:
- `db_host_env_var_name`, `db_user_env_var_name`, `db_name_env_var_name`, `db_port_env_var_name`, `service_url_env_var_name` — all default to `""` (empty, not aliased).

### C. Secret Management

`SEARXNG_SECRET` is auto-generated and must not be changed after the initial deployment. Rotating this secret will invalidate all active user sessions.

| Variable | Group | Default | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Additional Secret Manager secret references. |
| `secret_propagation_delay` | 6 | `30` | Seconds to wait after secret creation. |
| `secret_rotation_period` | 6 | `'2592000s'` | Secret Manager rotation notification frequency. |

### D. Environment Variables

`INSTANCE_NAME`, `AUTOCOMPLETE`, and `SEARXNG_BIND_ADDRESS` are pre-populated as defaults.

| Variable | Group | Default | Description |
|---|---|---|---|
| `environment_variables` | 6 | `{ INSTANCE_NAME="SearXNG", AUTOCOMPLETE="", SEARXNG_BIND_ADDRESS="0.0.0.0:8080" }` | Plain-text env vars for SearXNG configuration. |

`SEARXNG_BIND_ADDRESS`, `ENABLE_REDIS`, and `REDIS_URL` are also injected automatically via `module_env_vars` in `searxng.tf`.

### E. Networking

| Variable | Group | Default | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'`, or `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | VPC egress routing. |

> For public SearXNG deployments, `ingress_settings = 'all'` and no IAP is typical. For internal organisation deployments, `enable_iap = true` restricts access to authenticated Google accounts.

---

## 4. Advanced Security

### A. Cloud Armor WAF

SearXNG is a high-traffic public-facing service. Cloud Armor is recommended for production deployments to protect against DDoS and abuse.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisions Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | 10 | `[]` | Custom domains with Google-managed SSL certificates. |
| `enable_cdn` | 10 | `false` | Enables Cloud CDN on the HTTPS LB backend. |

### B. Identity-Aware Proxy (IAP)

For internal deployments, IAP can restrict SearXNG to specific Google-authenticated users without requiring application-level authentication.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Enables IAP on the Cloud Run service. |
| `iap_authorized_users` | 5 | `[]` | Users/SAs granted IAP access. |
| `iap_authorized_groups` | 5 | `[]` | Google Groups granted IAP access. |

### C. Binary Authorization & VPC-SC

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Enforces image attestation on deployment. |
| `enable_vpc_sc` | 22 | `false` | Registers module API calls within the project's VPC-SC perimeter. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs. |

---

## 5. Redis Integration

Redis is **disabled by default** (`enable_redis = false`). When enabled, Redis provides rate limiting and bot detection capabilities, which are strongly recommended for public-facing SearXNG instances.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 21 | `false` | Enables Redis for SearXNG rate limiting and bot detection. |
| `redis_host` | 21 | `""` | Redis hostname/IP. Defaults to `127.0.0.1` when `enable_redis = true` and no host is specified. |
| `redis_port` | 21 | `'6379'` | Redis TCP port. |
| `redis_auth` | 21 | `""` | Redis AUTH password. Sensitive. |

---

## 6. CI/CD & Delivery

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 8 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 8 | `""` | GitHub PAT. Sensitive. |
| `enable_cloud_deploy` | 8 | `false` | Provisions a Cloud Deploy pipeline. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Ordered Cloud Deploy promotion stages. |

---

## 7. Reliability

### A. Health Probes

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ path="/healthz", initial_delay_seconds=10, failure_threshold=6, ... }` | Startup probe. SearXNG starts fast — short initial delay. |
| `liveness_probe` | 14 | `{ path="/healthz", initial_delay_seconds=15, failure_threshold=3, ... }` | Liveness probe. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/healthz" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 14 | `[]` | Cloud Monitoring metric alert policies. |

### B. Backup

SearXNG is stateless — there is no user data to back up. The backup variables are inherited from the Foundation Module interface but have no practical use.

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Not applicable to SearXNG. Inherited from foundation interface. |
| `enable_backup_import` | 7 | `false` | Not applicable to SearXNG. |

---

## 8. Platform-Managed Behaviours

| Behaviour | Implementation | Detail |
|---|---|---|
| **Stateless** | `database_type = "NONE"` (effective), `enable_cloudsql_volume = false` | SearXNG aggregates results at request time. No database is provisioned. |
| **Scale-to-zero fixed** | `min_instance_count = 0` hardcoded in `searxng.tf` merge | SearXNG cold starts are fast (< 5 seconds). Not user-configurable. |
| **SEARXNG_SECRET auto-generated** | `SearXNG Common` creates and stores in Secret Manager | Session key injected via `module_secret_env_vars`. Do not rotate in production without coordinating with active sessions. |
| **SEARXNG_BIND_ADDRESS injected** | `module_env_vars = { SEARXNG_BIND_ADDRESS = "0.0.0.0:8080" }` | Hardcoded to bind on all interfaces at Cloud Run's expected port. |
| **Prebuilt image by default** | `container_image_source = 'prebuilt'` | The official SearXNG image works without customisation. |

---

## 9. Outputs

| Output | Description |
|---|---|
| `service_name` | Name of the Cloud Run service. |
| `service_url` | Public URL of the Cloud Run service. |
| `service_location` | GCP region where the Cloud Run service is deployed. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix used in resource names. |
| `container_image` | Container image used for the deployment. |

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `SEARXNG_SECRET` (auto-generated by Common) | *(auto-generated — stored in Secret Manager)* | **Critical** | SearXNG uses `SEARXNG_SECRET` to sign user sessions and HMAC query parameters. If scale-to-zero is enabled (`min_instance_count = 0`), each cold start generates a new instance. Without a stable secret stored externally (Secret Manager), session cookies from a previous instance become invalid on cold start, breaking all active user sessions and search result caching. The module auto-generates and stores the secret in Secret Manager — do not override it with a hardcoded value. |
| `min_instance_count` | `1` | **Critical** | SearXNG must have `min_instance_count = 1` (no scale-to-zero). A cold-started instance has no user session continuity. If the secret is somehow regenerated per-instance, all existing sessions are immediately invalidated. Always keep at least one warm instance. |
| `enable_redis` | `false` | **High** | Redis provides SearXNG with rate limiting, bot detection, and result caching. Without Redis, public-facing deployments have no rate limiting, making them vulnerable to scraping and API quota exhaustion from upstream search engines. Enable Redis and provide a `redis_host` for any public deployment. |
| `redis_host` | `""` | **High** | When `enable_redis = true` and `redis_host` is empty, SearXNG defaults to `127.0.0.1` (no reachable Redis). Rate limiting and caching are silently disabled. Set to the Memorystore Redis IP from `Services GCP`. |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | **High** | SearXNG fetches search results from upstream engines (Google, Bing, DuckDuckGo, etc.) over the internet. `PRIVATE_RANGES_ONLY` only routes VPC-internal traffic; external search engine requests are blocked. Use `"ALL_TRAFFIC"` if the upstream search engine endpoints are not reachable via private IP, or ensure a Cloud NAT gateway is configured for the VPC. |
| `ingress_settings` | `"all"` | **High** | Public ingress is intentional for a meta-search engine. However, without Redis-based rate limiting, public access enables unlimited scraping. Combine with `enable_redis = true` and upstream API keys for production. |
| `memory_limit` | `"512Mi"` | **Medium** | SearXNG is lightweight (Python/Flask), but processing simultaneous results from many search engines increases memory usage. Under high concurrency, `256Mi` can cause OOM kills. The default `512Mi` is adequate for moderate traffic; scale to `1Gi` for high-traffic public instances. |
| `cpu_limit` | `"1000m"` | **Medium** | Aggregating and de-duplicating results from many concurrent search engines is CPU-bound. Under `500m`, response latency increases noticeably at higher concurrency. |
| `timeout_seconds` | `300` | **Medium** | SearXNG waits for all enabled search engines to respond. Slow upstream engines can cause individual requests to take 20–30 seconds. Setting timeout too low causes Cloud Run to 504 before all results are aggregated. |
| `SerpAPI key / other engine API keys` (env vars) | *(not set)* | **Medium** | Many search engines (Google, Bing via SerpAPI) require API keys for reliable operation. Without keys, SearXNG scrapes public pages, which is subject to rate limiting and IP blocks by upstream services. Inject via `environment_variables` or `secret_environment_variables`. |
| `application_version` | `"latest"` | **Low** | Using `"latest"` makes deployments non-reproducible. Pin to a specific SearXNG version for production to prevent unexpected configuration schema changes. |
| `enable_iap` | `false` | **Medium** | For internal-only deployments, enable IAP to restrict search to authenticated users. For public meta-search, IAP is inappropriate — rely on Redis rate limiting instead. |
| `backup_schedule` | `"0 2 * * *"` | **Low** | SearXNG is stateless (no persistent data beyond session cache in Redis). Backups are not critical, but GCS bucket backups for configuration are recommended. |
| `max_instance_count` | `1` | **Medium** | Multiple Cloud Run instances share the same Redis for session state, which is correct. However, ensure Redis `maxmemory-policy` is configured (e.g., `allkeys-lru`) to prevent unbounded memory growth as sessions accumulate across instances. |

## Destroying Resources

### Known Deletion Issue: Serverless IPv4 Address Release

When destroying a Cloud Run deployment, you may encounter an error similar to:

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Resolution:** Wait 20–30 minutes after the initial destroy attempt, then re-run `tofu destroy`.
