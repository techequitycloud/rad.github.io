---
title: "SearXNG on GKE Autopilot"
description: "Configuration reference for deploying SearXNG on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# SearXNG on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SearXNG_GKE.png" alt="SearXNG on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

SearXNG is a privacy-respecting, self-hosted metasearch engine that aggregates
results from 70+ search services without tracking users or serving ads. This module
deploys SearXNG on **GKE Autopilot** on top of the [App_GKE](App_GKE.md)
foundation, which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

This guide focuses on the cloud services SearXNG uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

SearXNG runs as a lightweight Python/Flask web workload. The deployment wires
together a minimal set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Python/Flask pods, 500m CPU / 512 MiB by default, horizontally autoscaled |
| Cache / rate limiting | Redis | Optional — disabled by default; enables rate limiting and bot detection |
| Secrets | Secret Manager | Auto-generated `SEARXNG_SECRET` (session key) injected via the CSI driver |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **No database is provisioned.** SearXNG is fully stateless — it aggregates
  search results at request time and stores nothing.
- **No NFS or Cloud Storage is provisioned.** SearXNG has no uploads or shared
  files.
- **`min_instance_count` is fixed at 1.** GKE does not support scale-to-zero;
  the module always keeps at least one pod running.
- **Redis is disabled by default.** For public-facing deployments, enable Redis
  to activate rate limiting and bot detection against upstream engine abuse.
- **`SEARXNG_SECRET` is generated automatically** and stored in Secret Manager.
  All pod replicas share the same value via the CSI driver — do not override it
  with a per-pod random value.
- **Health probes target `/healthz`.** SearXNG's built-in health endpoint
  returns 200 when the application is ready.
- **`session_affinity = "None"`.** SearXNG is stateless, so requests are
  distributed evenly across pods.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the SearXNG workload

SearXNG pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling scales the deployment between the
minimum (fixed at 1) and the configured maximum.

- **Console:** Kubernetes Engine → Workloads → select the SearXNG workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Redis cache (optional)

When `enable_redis = true`, SearXNG uses Redis for per-IP rate limiting and bot
detection. This is strongly recommended for public-facing deployments to prevent
upstream search engine API quota exhaustion. When `redis_host` is left empty and
Redis is enabled, the module defaults to `127.0.0.1` (a sidecar Redis pod).

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### C. Secret Manager — SEARXNG_SECRET

`SearXNG_Common` auto-generates the `SEARXNG_SECRET` session key and stores it
in Secret Manager. This key signs SearXNG's session cookies and HMAC query
parameters; all pod replicas must share the same value. It is injected into pods
at runtime via the Kubernetes Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and
rotation.

### D. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A
custom domain with a Google-managed certificate can be enabled, and a static IP can
be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and
static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. SearXNG Application Behaviour

- **Fully stateless.** SearXNG fetches results from external search engines at
  request time and stores nothing locally. No database migrations or
  initialisation jobs run.
- **No first-deploy setup job.** Because there is no database, the deployment
  completes without a db-init step — the pod is ready as soon as the container
  starts.
- **`SEARXNG_SECRET` is stable.** The session key is generated once and persists
  in Secret Manager across restarts and rolling updates. Rotating it invalidates
  all active user sessions; avoid rotation in production unless required for
  security.
- **`SEARXNG_BIND_ADDRESS` is injected automatically** as `0.0.0.0:8080` so
  SearXNG listens on all interfaces at its native port.
- **`ENABLE_REDIS` and `REDIS_URL` are injected automatically** when
  `enable_redis = true`. The URL is derived from `redis_host` and `redis_port`.
- **Health path.** Both the startup and liveness probes target `/healthz` (HTTP
  GET), which SearXNG answers once the application is fully initialised.
- **Fast startups.** SearXNG starts in under 5 seconds — no database connections
  or schema migrations. The startup probe uses a short initial delay of 10
  seconds.
- **Session affinity is `None`.** Because the session state is stored in the
  `SEARXNG_SECRET`-signed cookie (and optionally in Redis), no sticky routing
  is required.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for SearXNG are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `searxng` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `SearXNG Search` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `latest` | SearXNG image tag; pin to a specific version for production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_resources` | `{ cpu_limit="500m", memory_limit="512Mi" }` | CPU and memory limits per pod. SearXNG is lightweight; 500m / 512 MiB is sufficient for moderate traffic. |
| `min_instance_count` | `1` _(fixed internally)_ | Minimum replicas. Fixed at 1 — GKE does not support scale-to-zero. |
| `max_instance_count` | `3` | Maximum replicas (autoscaler ceiling). |
| `container_port` | `8080` | SearXNG's native HTTP port. |
| `container_image_source` | `prebuilt` | Use the official SearXNG image (`prebuilt`) or build from source (`custom`). |
| `enable_image_mirroring` | `true` | Mirror the image into Artifact Registry before deployment. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |
| `enable_cloudsql_volume` | `false` | **Leave false** — SearXNG does not use a database. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{ INSTANCE_NAME="SearXNG", AUTOCOMPLETE="" }` | Extra settings. `SEARXNG_BIND_ADDRESS`, `ENABLE_REDIS`, and `REDIS_URL` are injected automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name for additional secrets (e.g., upstream engine API keys). |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `None` | SearXNG is stateless; even distribution is preferred. |
| `workload_type` | `null` | Auto-resolves to `Deployment` (SearXNG is stateless — leave null). |
| `network_tags` | `['nfsserver']` | Node/pod tags for firewall rules. |

### Group 7 — StatefulSet

SearXNG is stateless — leave all `stateful_pvc_*` variables at their defaults
(`null`). See [App_GKE](App_GKE.md) for when this group applies.

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 if you need eviction headroom. |
| `enable_topology_spread` | `false` | Spread pods across zones for production deployments. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/healthz` | SearXNG's built-in health endpoint; startup allows 10s initial delay. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | SearXNG requires no initialisation jobs — leave empty. |
| `cron_jobs` | `[]` | Optional scheduled tasks (e.g., cache warming). |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | SearXNG is stateless — NFS is not required. Leave false. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `false` | SearXNG is stateless — no GCS bucket is required. Leave false. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis for rate limiting and bot detection. Recommended for public-facing deployments. |
| `redis_host` | `""` | Redis endpoint. Leave empty to default to `127.0.0.1` when Redis is enabled; set to the Memorystore IP for a managed instance. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — SearXNG does not use a database. Do not change. |

### Group 17 — Backup & Maintenance

SearXNG is stateless — there is no application data to back up. The backup
variables are inherited from the foundation interface but have no practical use.
See [App_GKE](App_GKE.md).

### Group 18 — Custom SQL Scripts

Not applicable to SearXNG (no database). See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of SearXNG (internal deployments). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. Recommended for public-facing deployments. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | `default-waf-policy` | Policy name. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach SearXNG. |
| `storage_buckets` | Created Cloud Storage buckets (empty for SearXNG). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any setup jobs (none by default). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | GitHub connection details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `SEARXNG_SECRET` (auto-generated) | auto-generated | Critical | If a custom per-pod secret is injected instead, each pod signs cookies with a different key, invalidating sessions across replicas. Always use the auto-generated Secret Manager value. |
| `database_type` | `NONE` | Critical | Changing to a real DB type provisions an unused Cloud SQL instance and breaks startup. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are read as bytes by Kubernetes and block all pod scheduling. |
| `enable_redis` | `true` for public deployments | High | Without Redis, SearXNG has no rate limiting; public instances are vulnerable to scraping that exhausts upstream engine quotas. |
| `redis_host` | Memorystore IP or explicit value | High | When `enable_redis = true` and `redis_host = ""`, the module defaults to `127.0.0.1` — there is no sidecar Redis in the default GKE setup, so rate limiting is silently disabled. |
| `vpc_egress_setting` (via foundation) | ensure outbound internet access | High | SearXNG fetches results from external engines; outbound internet must not be blocked. |
| `application_version` | pinned (not `latest`) | Medium | Using `latest` makes deployments non-reproducible; a new SearXNG release may change config schema. |
| `enable_cloud_armor` | `true` for public deployments | Medium | Without Cloud Armor, there is no WAF/DDoS protection on the public endpoint. |
| `enable_iap` | `true` for internal-only | Medium | For internal search deployments, IAP restricts access to authenticated Google accounts. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |
| `stateful_pvc_enabled` | `null` | Low | SearXNG is stateless — provisioning a PVC wastes cost and is unused. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. SearXNG-specific application configuration shared with
the Cloud Run variant is described in **[SearXNG_Common](SearXNG_Common.md)**.
