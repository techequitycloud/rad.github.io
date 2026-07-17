---
title: "Strapi on GKE Autopilot"
description: "Configuration reference for deploying Strapi on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Strapi on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Strapi_GKE.png" alt="Strapi on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Strapi is the leading open-source headless CMS — delivering a fully customisable
content API (REST and GraphQL) with a rich admin panel, used by enterprises and
developers worldwide for content management and API-first architectures. This module
deploys Strapi on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation,
which provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Strapi uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, backups, and the deployment
lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating
them here.

---

## 1. Overview

Strapi runs as a Node.js container on GKE Autopilot. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pods, 1 vCPU / 512 MiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Strapi requires PostgreSQL |
| Shared files | Filestore (NFS) | Media uploads and assets shared across all replicas |
| Object storage | Cloud Storage | A dedicated uploads bucket (`strapi-uploads` suffix) |
| Cache (optional) | Redis / Memorystore | Optional; disabled by default |
| Secrets | Secret Manager | Five auto-generated cryptographic secrets plus the database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL is required.** Strapi's data layer is wired to PostgreSQL; MySQL and
  `NONE` break startup.
- **A custom container image is built via Cloud Build.** `container_image_source`
  defaults to `"custom"` — the module builds a production-ready two-stage Node.js 20
  image on every version increment.
- **Five cryptographic secrets are auto-generated.** `JWT_SECRET`, `ADMIN_JWT_SECRET`,
  `API_TOKEN_SALT`, `TRANSFER_TOKEN_SALT`, and `APP_KEYS` are generated and stored in
  Secret Manager on first deploy and must never change after that — they sign all
  active sessions and API tokens.
- **NFS is enabled by default.** Strapi stores uploaded media under `/uploads`. Without
  a shared NFS volume, media is lost on pod restart.
- **Redis is disabled by default.** Enable it only when using plugins that explicitly
  require a shared cache or session store.
- **Container port is 1337.** Strapi's HTTP server binds to port 1337 by default.
- **GCS media bucket variables are auto-injected.** `GCS_BUCKET_NAME` and
  `GCS_BASE_URL` are set automatically; no manual configuration is required.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Strapi workload

Strapi pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the
minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Strapi workload to see
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

### B. Cloud SQL for PostgreSQL 15

Strapi stores all application data (content types, content, users, API tokens) in a
managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately through the
**Cloud SQL Auth Proxy** sidecar over a Unix socket, so no public IP is exposed. On
first deploy an initialization Job creates the application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see
[App_GKE](App_GKE.md).

### C. Filestore (NFS) and Cloud Storage

Uploaded media is written to a **Filestore (NFS)** share mounted into every pod so
all replicas see the same files. A dedicated **Cloud Storage** bucket (suffix
`strapi-uploads`) is also provisioned and configured as the Strapi GCS upload
provider; the workload service account is granted access automatically.

- **Console:** Filestore → Instances for the NFS share; Cloud Storage → Buckets for
  the uploads bucket.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/        # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### D. Secret Manager

Five Strapi cryptographic secrets are generated on first deploy and stored in Secret
Manager: `JWT_SECRET`, `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`, `TRANSFER_TOKEN_SALT`,
and `APP_KEYS` (four comma-joined keys). The database password is also stored here.
All secrets are injected into pods at runtime; plaintext never appears in configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Redis cache (optional)

When `enable_redis = true`, Redis is used as a session store and REST API response
cache via the `strapi-plugin-redis` and `strapi-plugin-rest-cache` plugins. When
`redis_host` is left empty and NFS is enabled, the NFS host IP is used as the Redis
endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm Redis env vars are injected into the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E "^REDIS|ENABLE_REDIS"
  ```

### F. Networking & ingress

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

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Strapi Application Behaviour

- **First-deploy database setup.** An initialization Job runs using `postgres:15-alpine`
  and idempotently creates the Strapi database and user, grants the necessary
  privileges (including `CREATEDB`, which Strapi's migration system requires), and
  signals the Cloud SQL Auth Proxy to shut down cleanly.
- **GCS media provider.** `GCS_BUCKET_NAME` and `GCS_BASE_URL` are automatically
  injected into the container. Strapi's `config/plugins.js` detects these variables
  and switches to the
  `@strapi-community/strapi-provider-upload-google-cloud-storage` provider, storing
  all media library uploads in the `strapi-uploads` GCS bucket.
- **Email delivery (optional).** If `SMTP_HOST` is set in `environment_variables`,
  `config/plugins.js` automatically enables the `nodemailer` email provider for
  Strapi notifications (user invitations, password resets, workflow events). Set
  `SMTP_PASSWORD` via `secret_environment_variables`.
- **Health probe.** Both startup and liveness probes target `/_health` — a Strapi
  endpoint that returns 200 only when the application and database connection are
  ready. The startup probe allows up to ~300 seconds for first-boot initialisation.
- **Session affinity.** Defaults to `ClientIP` — recommended because the Strapi admin
  panel uses persistent WebSocket connections for real-time content updates.
- **Cryptographic secrets are immutable after first deploy.** All five auto-generated
  secrets sign active sessions and API tokens. Regenerating any of them immediately
  invalidates all active sessions and tokens.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Strapi are listed; every other input is
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
| `application_name` | `strapi` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Strapi CMS` | Friendly name shown in the Console. |
| `application_description` | `Strapi Headless CMS on GKE` | Workload description annotation. |
| `application_version` | `5.0.0` | Image version tag; increment to trigger a new Cloud Build run. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `"custom"` triggers Cloud Build; `"prebuilt"` deploys an existing image URI. |
| `container_image` | `""` | Override image URI; leave empty for the module-built image. |
| `container_build_config` | `{ enabled = true }` | Dockerfile path, build context, and build args for Cloud Build. |
| `enable_image_mirroring` | `true` | Mirror image into Artifact Registry before deployment. |
| `min_instance_count` | `1` | Minimum pod replicas. |
| `max_instance_count` | `10` | Maximum pod replicas (autoscaler ceiling). |
| `container_port` | `1337` | Strapi's Node.js server listens on port 1337. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | CPU/memory limits and optional requests. |
| `timeout_seconds` | `300` | Max request duration; increase for long media processing operations. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `GCS_BUCKET_NAME` and `GCS_BASE_URL` are injected automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name for additional secrets. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Pub/Sub rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing recommended for Strapi WebSocket admin connections. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when per-pod storage is enabled. |
| `network_tags` | `["nfsserver"]` | Node/pod tags; `nfsserver` is required for NFS connectivity. |
| `gke_cluster_name` | `""` | Target cluster name; auto-discovered when empty. |
| `namespace_name` | `""` | Kubernetes namespace; auto-generated when empty. |

### Group 7 — StatefulSet Configuration

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable per-pod PVCs in a StatefulSet. Not needed for the default NFS-backed setup. |
| `stateful_pvc_size` | `10Gi` | Storage size per PVC. Immutable after creation. |
| `stateful_pvc_mount_path` | `/data` | Container path for the per-pod PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass for PVCs. |
| `stateful_headless_service` | `null` | Create a headless Service for stable pod DNS. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` or `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` or `OnDelete`. |

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
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/_health`, 10s delay | Startup probe targeting Strapi's health endpoint. |
| `health_check_config` | HTTP `/_health`, 15s delay | Liveness probe targeting Strapi's health endpoint. |
| `uptime_check_config` | disabled, path `/` | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Recurring Kubernetes CronJobs triggered by Cloud Scheduler. |
| `additional_services` | `[]` | Sidecar or helper GKE services deployed alongside Strapi. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for Strapi media (keep enabled). |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `nfs_volume_name` | `nfs-data-volume` | Kubernetes volume name for the NFS mount. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision GCS buckets. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional buckets beyond the auto-provisioned `strapi-uploads` bucket. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` | `7` | Maximum recent Artifact Registry images to keep. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Use Redis for caching/sessions (disabled by default). |
| `redis_host` | `""` | Redis endpoint. Leave empty to fall back to the NFS host IP when `enable_nfs = true`. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES` | PostgreSQL is required — do not change to MySQL or `NONE`. |
| `application_database_name` | `strapi` | Database name. Immutable after first deploy. |
| `application_database_user` | `strapi` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `enable_postgres_extensions` | `false` | Install additional PostgreSQL extensions after provisioning. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. |

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

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Strapi. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

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
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Strapi. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `APP_KEYS` / `JWT_SECRET` / `ADMIN_JWT_SECRET` / `API_TOKEN_SALT` (auto-generated) | generated once, never changed | Critical | Rotating any of these after first deploy immediately invalidates all active sessions and API tokens; every user is logged out and all client integrations break. |
| `database_type` | `POSTGRES` or `POSTGRES_15` | Critical | Strapi requires PostgreSQL; MySQL or `NONE` breaks startup. |
| `enable_nfs` | `true` | Critical | Without shared storage, media uploads are lost on pod restart and not shared across replicas. |
| `application_name` | set once | Critical | Immutable after first deploy; changing it renames all GCP and Kubernetes resources, triggering full recreation and data loss. |
| `application_database_name` / `application_database_user` | set once | Critical | Immutable after first deploy; renaming causes Strapi to connect to an empty database, losing all content and users. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_file` fails the import job. |
| `quota_memory_requests` / `quota_memory_limits` | binary units | Critical | Bare integers are bytes and block all scheduling. |
| `enable_cloudsql_volume` | `true` | High | Required for PostgreSQL connectivity; blocked at plan time when disabled alongside a non-`NONE` database type. |
| `memory_limit` | `512Mi` minimum | High | Strapi is a Node.js application; too little memory causes OOM kills during admin panel operations. Raise to `1Gi` or higher for production. |
| `enable_redis` | `false` | High | Enable only when plugins require it; enabling without a valid `redis_host` (and without NFS fallback) causes a startup connection error. |
| `session_affinity` | `ClientIP` | High | Without stickiness, the Strapi admin panel WebSocket connections drop and produce "unsaved changes" warnings. |
| `min_instance_count` | `1` | High | GKE does not support true scale-to-zero without KEDA; setting to `0` can leave the HPA in an inconsistent state. |
| `enable_iap` | enable for admin-facing | Medium | The Strapi admin panel is otherwise publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |
| `enable_topology_spread` | consider for prod | Low | With multiple replicas, topology spread prevents all pods from landing in the same zone. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Strapi-specific application configuration shared with the
Cloud Run variant is described in **[Strapi_Common](Strapi_Common.md)**.
