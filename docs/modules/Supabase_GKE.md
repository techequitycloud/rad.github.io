---
title: "Supabase on GKE Autopilot"
description: "Configuration reference for deploying Supabase on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Supabase on GKE Autopilot

Supabase is an open-source Firebase alternative — a full backend-as-a-service built
on PostgreSQL. It provides a PostgreSQL 15 database with the pgvector extension,
real-time subscriptions, GoTrue authentication, PostgREST REST APIs, an S3-compatible
storage service, and an admin Studio dashboard, all behind a **Kong API gateway**. This
module deploys Supabase on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

> **GKE only.** Supabase is available in the GKE variant only. Its multi-service
> architecture (Kong gateway, GoTrue, PostgREST, Realtime, Storage, Studio) requires
> persistent connections and Kubernetes primitives that Cloud Run does not support.

This guide focuses on the cloud services Supabase uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

The Supabase deployment runs a Kong API gateway as the primary GKE workload, fronting
a set of Supabase microservices. It wires together the following Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| API gateway (compute) | GKE Autopilot | Kong gateway pods, 1 vCPU / 2 GiB by default, horizontally autoscaled |
| Microservices | GKE Autopilot (additional services) | GoTrue auth, PostgREST, Realtime, Storage API, Studio — each a separate Deployment |
| Database | Cloud SQL for PostgreSQL 15 | Required — Supabase is PostgreSQL-native; pgcrypto, uuid-ossp, and pgvector extensions installed |
| Object storage | Cloud Storage | A dedicated `supabase-storage` bucket for file uploads |
| Secrets | Secret Manager | JWT signing secret (auto-generated), anon key, service role key, publishable key, secret key, and secret_key_base |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed; using any other engine
  breaks startup.
- **Kong runs in declarative (database-less) mode.** Routing is defined in
  `/home/kong/kong.yml` baked into the container image — no Kong database is needed.
- **JWT credentials are auto-generated or placeholder.** The JWT signing secret is
  auto-generated (32 random characters). The anon key and service role key are stored
  as placeholders and **must be replaced with valid signed JWTs** before production
  use.
- **pgvector is installed.** The `db-init` job enables `pgcrypto`, `uuid-ossp`, and
  `pgvector` so Supabase's AI/embedding features work out of the box.
- **Image mirroring is always on.** Kong and sidecar images are mirrored into
  Artifact Registry on every apply to avoid Docker Hub rate limits.
- **Session affinity is `None`.** Kong is stateless; sticky routing is not required
  at the gateway level.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — Kong gateway and Supabase microservices

The primary GKE workload runs the Kong API gateway on port 8000. Kong routes all
incoming requests to the Supabase microservices by path prefix:

| Path prefix | Target service | Port |
|---|---|---|
| `/auth/v1/*` | GoTrue (authentication) | 9999 |
| `/rest/v1/*` | PostgREST (REST API) | 3000 |
| `/realtime/v1/*` | Realtime (WebSocket) | 4000 |
| `/storage/v1/*` | Storage API | 5000 |

Additional Supabase services (GoTrue, PostgREST, Realtime, Storage, Studio) are
deployed as separate Kubernetes Deployments in the same namespace via
`additional_services`.

- **Console:** Kubernetes Engine → Workloads → select a workload to see pods, events,
  and metrics. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Supabase stores all application data in a managed Cloud SQL for PostgreSQL 15
instance. Pods connect through the **Cloud SQL Auth Proxy** sidecar over a Unix
socket so no public IP is exposed. On first deploy the `db-init` job creates the
database, user, and the required PostgreSQL extensions (`pgcrypto`, `uuid-ossp`,
`pgvector`), then sets up the Supabase schema.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). For the connection model, backups, and password rotation, see
[App_GKE](App_GKE.md).

### C. Cloud Storage

A dedicated **Cloud Storage** bucket (`supabase-storage`) is provisioned for
Supabase file uploads. The workload service account is granted access automatically.
Public-access prevention is set to `inherited` so bucket-level ACLs can be used for
serving objects.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Secret Manager — JWT credentials and keys

Supabase authentication is built on JWTs. Six secrets are stored in Secret Manager:

| Secret suffix | Content | Notes |
|---|---|---|
| `-jwt-secret` | 32-char JWT signing secret | Auto-generated if `jwt_secret` is empty |
| `-anon-key` | Public anonymous JWT | **Placeholder by default — must be replaced** |
| `-service-role-key` | Service role JWT | **Placeholder by default — must be replaced** |
| `-publishable-key` | Publishable (anon) opaque API key | Placeholder if not provided |
| `-secret-key` | Server-side opaque API key | Placeholder if not provided |
| `-key-base` | 64-char `secret_key_base` for Realtime/Supavisor | Auto-generated if `secret_key_base` is empty |

The database password is generated and managed separately by the foundation; its
secret name is reported in the Outputs (`database_password_secret`).

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the JWT signing secret:
  gcloud secrets versions access latest --secret=<prefix>-jwt-secret --project "$PROJECT"
  # Update the anon key after generating a signed JWT:
  echo -n "<signed-anon-jwt>" | gcloud secrets versions add <prefix>-anon-key \
    --data-file=- --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the Kong gateway is exposed through an external Cloud Load Balancing IP.
A custom domain with a Google-managed certificate can be enabled, and a static IP can
be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains and static IP
details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Supabase Application Behaviour

- **First-deploy database setup.** The `db-init` job connects to Cloud SQL through
  the Auth Proxy and idempotently creates the `postgres` database and `supabase_admin`
  user, enables the `pgcrypto`, `uuid-ossp`, and `pgvector` extensions, and sets up
  the Supabase schema. It is safe to re-run.
- **JWT placeholder replacement.** After the first deploy, the anon key and service
  role key secrets contain placeholder strings. These **must be replaced** with valid
  JWTs signed by the auto-generated `jwt_secret` before Supabase clients can
  authenticate:
  1. Retrieve the JWT secret: `gcloud secrets versions access latest --secret=<prefix>-jwt-secret`
  2. Generate an anon JWT (`role: anon`) and a service_role JWT (`role: service_role`)
     using [jwt.io](https://jwt.io) or the
     [Supabase JWT generator](https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys).
  3. Upload each JWT: `echo -n "<jwt>" | gcloud secrets versions add <secret-name> --data-file=-`
  4. Restart the Kong pod to pick up the updated secrets:
     `kubectl rollout restart deploy/<kong-workload> -n "$NAMESPACE"`
- **JWT credentials are immutable as a set.** The `jwt_secret`, `anon_key`, and
  `service_role_key` must always be regenerated together. Changing the JWT secret
  while leaving derived keys unchanged invalidates all issued tokens immediately.
- **Kong is stateless.** The gateway reads routing from the declarative `kong.yml`
  baked into the image. No Kong database is used.
- **Health probes target `/health`.** Kong's `/health` endpoint confirms the gateway
  is running and routing is configured. The startup probe allows ~3 minutes
  (`30 s initial delay × 18 failures`) for first-boot database setup to complete.
- **Realtime uses PostgreSQL LISTEN/NOTIFY.** No Redis is required for the core
  Supabase stack; `enable_redis` defaults to `false`.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Supabase are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |
| `supabase_db_password` | _(required)_ | Password for the in-namespace Supabase/PostgreSQL superuser and all Supabase service roles. Must be supplied explicitly — never auto-generated. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `supabase` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Supabase` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `2.8.1` | Kong gateway image version tag. Pin to a tested version; avoid `latest` in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_resources` | `1000m` / `2Gi` | CPU limit and memory limit for the Kong gateway container. Raise CPU to `2000m` for production traffic. |
| `min_instance_count` | `1` | Minimum Kong pod replicas. Keep ≥ 1 — cold starts disrupt OAuth redirect flows. |
| `max_instance_count` | `3` | Maximum Kong pod replicas (autoscaler ceiling). |
| `container_port` | `8000` | Kong HTTP proxy port. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar. **Must remain `true`.** |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |
| `container_image_source` | `custom` | Image source mode. `custom` builds via Cloud Build from `Supabase_Common/scripts/Dockerfile`. |
| `enable_image_mirroring` | `true` | Always enabled — Kong is mirrored from Docker Hub into Artifact Registry. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core Kong/Supabase values are set automatically. |
| `secret_environment_variables` | `{}` | Additional Secret Manager references injected as env vars. |
| `jwt_secret` | `""` | JWT signing secret. Leave empty to auto-generate 32-char random. **Treat as permanently immutable after first deploy.** |
| `anon_key` | `""` | Public anonymous JWT. Leave empty; a placeholder is stored — replace post-deploy. |
| `service_role_key` | `""` | Service role JWT (full DB access). Leave empty; replace post-deploy. **Never expose in client code.** |
| `publishable_key` | `""` | Publishable (anon) opaque API key for newer Supabase clients. Placeholder if empty. |
| `supabase_secret_key` | `""` | Server-side opaque API key for newer Supabase clients. Placeholder if empty. |
| `secret_key_base` | `""` | 64-char internal encryption secret for Realtime/Supavisor. Auto-generated if empty. |
| `site_url` | `http://localhost:3000` | Base URL for GoTrue auth redirects. Set to your public domain. |
| `api_external_url` | `http://localhost:8000` | External Supabase API URL for OAuth redirect construction. |
| `supabase_public_url` | `http://localhost:8000` | Public base URL for the dashboard and REST API. |
| `jwt_expiry` | `3600` | JWT expiry in seconds for GoTrue-issued tokens. |
| `pgrst_db_schemas` | `public,storage,graphql_public` | PostgreSQL schemas exposed by PostgREST. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kong Service is exposed externally. |
| `session_affinity` | `None` | Kong is stateless; sticky routing not required. |
| `workload_type` | `null` | Defaults to `Deployment`. |
| `gke_cluster_name` | `""` | GKE cluster name. Leave empty for auto-discovery. |
| `namespace_name` | `""` | Kubernetes namespace. Leave empty to auto-generate. |
| `termination_grace_period_seconds` | `60` | Seconds before SIGKILL after SIGTERM. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable PVC templates in the StatefulSet. Leave unset — Supabase state lives in Cloud SQL and GCS, not pod-local storage. |
| `stateful_pvc_size` | `10Gi` | PVC size per pod (if StatefulSet PVCs are enabled). |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block all pod scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 if you need eviction headroom. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health`, 30 s initial delay, 18 failures | Allows ~3 min for first-boot DB setup. |
| `health_check_config` | HTTP `/health`, 60 s initial delay, 3 failures | Liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Workload Automation

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Scheduled cluster tasks (e.g. database cleanup routines). |
| `additional_services` | `[]` | **Supabase microservices** (GoTrue, PostgREST, Realtime, Storage API, Studio) deployed as additional Kubernetes Deployments in the same namespace. Each entry specifies `name`, `image`, `port`, resource limits, environment variables, and probe configuration. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is not needed for Supabase; storage is handled by GCS. Enabling it adds unnecessary cost. |
| `nfs_mount_path` | `/var/lib/storage` | Mount path if NFS is enabled. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the `supabase-storage` bucket. |
| `storage_buckets` / `gcs_volumes` | _(set by Common)_ | Additional buckets / GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — do not change. Supabase requires PostgreSQL 15. |
| `application_database_name` | `postgres` | Database name. Immutable after first deploy. |
| `application_database_user` | `supabase_admin` | Application user. Immutable after first deploy. |
| `enable_postgres_extensions` | `true` | Install `pgcrypto`, `uuid-ossp`, and `pgvector`. Required. |
| `postgres_extensions` | `["pgcrypto","uuid-ossp","pgvector"]` | Extension list. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` | restore options | Restore from a backup on deploy. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `network_tags` | `[]` | Network tags applied to GKE nodes and pods. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of the Kong gateway. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | `default-waf-policy` | Policy name. |
| `enable_cdn` | `false` | Enable Cloud CDN on the GKE Ingress backend. |

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
| `service_name` | Kubernetes Service name (Kong gateway). |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach the Supabase API via the Kong gateway. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name (`postgres`). |
| `database_user` | Application database user (`supabase_admin`). |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed Kong image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Connected repo. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Build pipeline. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `jwt_secret` | auto-generated or fixed at first deploy | Critical | Changing it post-deploy invalidates every issued JWT; all client connections break. `anon_key` and `service_role_key` must be regenerated together. |
| `anon_key` / `service_role_key` | signed JWTs (replace placeholders) | Critical | Placeholder values cause every Supabase API call to return 401. All three JWT credentials must be regenerated as an atomic set. |
| `enable_cloudsql_volume` | `true` | Critical | Must be `true`. All Supabase services connect to PostgreSQL via the Auth Proxy socket; setting `false` causes GoTrue, PostgREST, and Storage to fail on startup. |
| `database_type` | `POSTGRES_15` | Critical | Supabase requires PostgreSQL 15; any other engine breaks startup. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`) | Critical | Bare integers are bytes and block all pod scheduling. |
| `supabase_db_password` | required | Critical | No default — must be supplied; no password means no DB superuser, and the Supabase schema init fails. |
| `enable_postgres_extensions` | `true` | Critical | `pgcrypto`, `uuid-ossp`, and `pgvector` are required for Supabase to function. |
| `min_instance_count` | `1` | High | Setting to `0` allows scale-to-zero; Kong cold starts take 15–30 s and disrupt OAuth redirect flows. |
| `container_resources` CPU | `2000m` for production | High | Insufficient CPU causes elevated latency and 504 timeouts under load. |
| `container_resources` memory | `2Gi` minimum | High | Too little memory causes OOM kills under concurrent load. |
| `startup_probe_config.failure_threshold` | `18` (default) | High | Reducing below ~12 causes the pod to be killed before GoTrue and the init job finish on first deploy. |
| `site_url` / `api_external_url` / `supabase_public_url` | real public URLs | High | Localhost defaults prevent OAuth flows and redirect construction from working outside the cluster. |
| `application_version` | pinned (not `latest`) | Medium | Pulling `latest` risks Kong versions incompatible with the bundled declarative config. |
| `enable_nfs` | `false` | Low | NFS is unnecessary for Supabase; enabling it adds Filestore cost and a dependency that can delay provisioning. |
| `enable_redis` | `false` | Medium | Redis is optional. If set to `true`, `redis_host` must point to a reachable endpoint; an unreachable host causes Kong startup timeouts. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Supabase-specific application configuration shared
across secrets, the Kong image build, and the database init job is described in
**[Supabase_Common](Supabase_Common.md)**.
