# Grafana on GKE Autopilot

This document provides a comprehensive reference for the `modules/Grafana_GKE` Terraform module. It covers architecture, IAM, configuration variables, Grafana-specific behaviours, and operational patterns for deploying Grafana on Google Kubernetes Engine (GKE) Autopilot.

---

## 1. Module Overview

`Grafana GKE` is a **wrapper module** built on top of `App GKE`. It uses `App GKE` for all GCP and Kubernetes infrastructure provisioning and injects Grafana-specific application configuration via `Grafana Common`.

**Key Capabilities:**
- **Compute**: GKE Autopilot Deployment or StatefulSet, 1 vCPU / 2 Gi by default with Horizontal Pod Autoscaling.
- **Data Persistence**: Cloud SQL **PostgreSQL 15** as the Grafana application database. The module automatically injects `GF_DATABASE_TYPE=postgres` to prevent Grafana from falling back to SQLite.
- **Storage**: StatefulSet PVCs (optional, for local Grafana data), GCS Fuse volumes, and NFS mounts for sharing dashboards and plugins across pods.
- **Security**: Inherits Cloud Armor WAF, IAP (OAuth 2.0), Binary Authorization, and VPC Service Controls from `App GKE`.
- **CI/CD**: Cloud Build custom image pipeline by default; Cloud Deploy progressive delivery optional.
- **Reliability**: Health probes target `/api/health`. PodDisruptionBudget is enabled by default.

**Key difference from Grafana CloudRun:** The GKE variant uses Kubernetes-native scaling (HPA), persistent volume claims for StatefulSet deployments, Workload Identity instead of service account key files, and `startup_probe_config`/`health_check_config` variables (in addition to the `startup_probe`/`liveness_probe` variables from the Common module).

---

## 2. IAM & Access Control

`Grafana GKE` delegates all IAM provisioning to `App GKE`. Grafana pods access Cloud SQL via the Cloud SQL Auth Proxy sidecar (`enable_cloudsql_volume = true` by default) and Workload Identity.

**`GF_DATABASE_TYPE` injection:** `grafana.tf` merges `{ GF_DATABASE_TYPE = "postgres" }` into the environment_variables map. This is required — without it Grafana defaults to SQLite even when all other `GF_DATABASE_*` variables are present.

---

## 3. Core Service Configuration

### A. Compute (GKE Autopilot)

| Variable | Group | Default | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Set `false` for infrastructure-only deployment. |
| `container_image_source` | 4 | `'custom'` | `'custom'` builds via Cloud Build; `'prebuilt'` deploys an existing image URI. |
| `container_image` | 4 | `""` | Override image URI. Leave empty for Cloud Build to manage. |
| `container_resources` | 4 | `{ cpu_limit="1000m", memory_limit="2Gi" }` | CPU/memory limits and requests for the Grafana container. |
| `min_instance_count` | 4 | `1` | Minimum pod replicas (HPA minReplicas). |
| `max_instance_count` | 4 | `5` | Maximum pod replicas (HPA maxReplicas). |
| `container_port` | 4 | `3000` | Grafana's default HTTP port. |
| `container_protocol` | 4 | `'http1'` | HTTP protocol version. |
| `execution_environment` | 4 | n/a | Not applicable for GKE deployments. |
| `timeout_seconds` | 4 | `300` | Max duration the load balancer waits for a backend pod response. |
| `enable_cloudsql_volume` | 4 | `true` | Injects the Cloud SQL Auth Proxy sidecar. |
| `enable_image_mirroring` | 4 | `true` | Mirrors the Grafana image into Artifact Registry. |
| `enable_vertical_pod_autoscaling` | 4 | `false` | Enables VPA to auto-adjust CPU/memory requests. Recommended for GKE Autopilot. |
| `service_annotations` | 4 | `{}` | Custom annotations on the Kubernetes Service resource. |
| `service_labels` | 4 | `{}` | Labels applied to the Kubernetes Service resource. |

### B. GKE-Specific Backend Configuration

| Variable | Group | Default | Description |
|---|---|---|---|
| `workload_type` | 6 | `null` | `'Deployment'` or `'StatefulSet'`. Auto-resolves to `'StatefulSet'` when `stateful_pvc_enabled = true`. |
| `service_type` | 6 | `'LoadBalancer'` | Kubernetes Service type. |
| `session_affinity` | 6 | `'None'` | Session affinity mode: `'None'` for round-robin or `'ClientIP'` for sticky sessions. |
| `gke_cluster_name` | 6 | `""` | Target GKE cluster. Leave empty to auto-discover. |
| `gke_cluster_selection_mode` | 6 | `'primary'` | Strategy for choosing the target cluster. |
| `namespace_name` | 6 | `""` | Kubernetes namespace. Leave empty to auto-generate. |
| `termination_grace_period_seconds` | 6 | `30` | Seconds Kubernetes waits after SIGTERM before force-terminating. |
| `enable_network_segmentation` | 6 | `false` | Creates Kubernetes NetworkPolicy resources. |
| `enable_multi_cluster_service` | 6 | `false` | Creates a ServiceExport for Multi-Cluster Services (MCS). |
| `configure_service_mesh` | 6 | `false` | Enables Istio service mesh injection for the application namespace. |
| `deployment_timeout` | 6 | `1800` | Maximum seconds Terraform waits for the Deployment rollout. |

### C. StatefulSet Configuration

For Grafana deployments that persist data locally (e.g., plugins stored on PVC), use StatefulSet mode.

| Variable | Group | Default | Description |
|---|---|---|---|
| `stateful_pvc_enabled` | 7 | `null` | Enables PVC templates in the StatefulSet. Setting `true` auto-selects `workload_type = 'StatefulSet'`. |
| `stateful_pvc_size` | 7 | `'10Gi'` | Storage size for each PVC. |
| `stateful_pvc_mount_path` | 7 | `'/var/lib/grafana'` | Container path where the PVC is mounted. `/var/lib/grafana` is Grafana's default data directory. |
| `stateful_pvc_storage_class` | 7 | `'standard-rwo'` | Kubernetes StorageClass. Leave `null` for cluster default. |
| `stateful_headless_service` | 7 | `null` | Creates a headless Service for stable pod DNS entries. |
| `stateful_pod_management_policy` | 7 | `null` | Pod creation order: `'OrderedReady'` or `'Parallel'`. |
| `stateful_update_strategy` | 7 | `null` | Update strategy: `'RollingUpdate'` or `'OnDelete'`. |
| `stateful_fs_group` | 7 | `472` | Pod-level `fsGroup` in the security context. Grafana runs as UID/GID 472 — this ensures the container can write to the PVC mount. |

### D. Database (Cloud SQL — PostgreSQL 15)

| Variable | Group | Default | Description |
|---|---|---|---|
| `database_type` | 16 | `'POSTGRES_15'` | Cloud SQL engine. PostgreSQL required for Grafana. |
| `application_database_name` | 16 | `'grafana'` | PostgreSQL database name. |
| `application_database_user` | 16 | `'grafana'` | PostgreSQL application user. |
| `database_password_length` | 16 | `32` | Auto-generated password length. Range: 16–64. |
| `enable_postgres_extensions` | 16 | `false` | Enables installation of PostgreSQL extensions. |
| `postgres_extensions` | 16 | `[]` | List of PostgreSQL extensions to install. |
| `enable_auto_password_rotation` | 16 | `false` | Automated zero-downtime password rotation. |
| `rotation_propagation_delay_sec` | 16 | `90` | Seconds to wait after rotation before restarting pods. |

### E. Storage (NFS & GCS)

| Variable | Group | Default | Description |
|---|---|---|---|
| `create_cloud_storage` | 14 | `true` | Set `false` to skip GCS bucket creation. |
| `storage_buckets` | 14 | `[{ name_suffix = "data" }]` | GCS bucket configurations. |
| `gcs_volumes` | 14 | `[]` | GCS Fuse volume mounts via CSI. |
| `manage_storage_kms_iam` | 14 | `false` | Creates CMEK KMS keyring and enables CMEK on storage buckets. |
| `enable_artifact_registry_cmek` | 14 | `false` | Enables CMEK encryption for Artifact Registry images. |
| `max_images_to_retain` | 14 | `7` | Maximum recent container images to keep. |
| `delete_untagged_images` | 14 | `true` | Automatically deletes untagged images. |
| `image_retention_days` | 14 | `30` | Days after which images are eligible for deletion. |
| `enable_nfs` | 13 | `false` | Provisions Cloud Filestore NFS and mounts it into pods. |
| `nfs_mount_path` | 13 | `'/mnt/nfs'` | Container path where the NFS volume is mounted. |
| `nfs_volume_name` | 13 | `'nfs-data-volume'` | Volume name for the NFS mount. |
| `nfs_instance_name` | 13 | `""` | Name of an existing NFS GCE VM. Leave empty to auto-discover. |
| `nfs_instance_base_name` | 13 | `'app-nfs'` | Base name for an inline NFS GCE VM. |

---

## 4. Advanced Security

### A. Identity-Aware Proxy (IAP)

IAP for GKE requires OAuth 2.0 credentials. Unlike the CloudRun variant, the GKE module requires `iap_oauth_client_id`, `iap_oauth_client_secret`, and `iap_support_email`.

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_iap` | 20 | `false` | Enables IAP for the GKE Ingress. |
| `iap_authorized_users` | 20 | `[]` | Users granted IAP access. |
| `iap_authorized_groups` | 20 | `[]` | Google Groups granted IAP access. |
| `iap_oauth_client_id` | 20 | `""` | OAuth 2.0 Client ID. Required when `enable_iap = true`. Sensitive. |
| `iap_oauth_client_secret` | 20 | `""` | OAuth 2.0 Client Secret. Required when `enable_iap = true`. Sensitive. |
| `iap_support_email` | 20 | `""` | Support email shown on the OAuth consent screen. |

### B. Cloud Armor

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cloud_armor` | 21 | `false` | Attaches a Cloud Armor security policy to the GKE Ingress backend. |
| `admin_ip_ranges` | 21 | `[]` | Admin CIDR ranges for privileged access. |
| `cloud_armor_policy_name` | 21 | `'default-waf-policy'` | Name of the Cloud Armor security policy to attach. |
| `enable_cdn` | 21 | `false` | Enables Cloud CDN on the GKE Ingress backend. Requires `enable_custom_domain = true`. |

### C. VPC Service Controls

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Enables VPC-SC perimeter enforcement. |
| `vpc_cidr_ranges` | 22 | `[]` | VPC subnet CIDR ranges for the VPC-SC network access level. |
| `vpc_sc_dry_run` | 22 | `true` | Logs violations without blocking. |
| `organization_id` | 22 | `""` | GCP Organization ID for VPC-SC. |
| `enable_audit_logging` | 22 | `false` | Enables detailed Cloud Audit Logs. |

---

## 5. Traffic & Ingress

### A. Custom Domain & Static IP

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_custom_domain` | 19 | `false` | Provisions a Kubernetes Ingress for custom domain routing. |
| `application_domains` | 19 | `[]` | Custom domain names for the Ingress. DNS must point to the LB IP. |
| `reserve_static_ip` | 19 | `true` | Provisions a global static external IP. Recommended for production. |
| `static_ip_name` | 19 | `""` | Name for the static IP. Leave empty to auto-generate. |
| `network_tags` | 19 | `['nfsserver']` | Network tags applied to GKE nodes for VPC firewall rules. |

---

## 6. CI/CD & Delivery

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 12 | `false` | Provisions a Cloud Build GitHub trigger. |
| `github_repository_url` | 12 | `""` | Full HTTPS URL of the GitHub repository. |
| `github_token` | 12 | `""` | GitHub PAT. Required on first apply. Sensitive. |
| `github_app_installation_id` | 12 | `""` | GitHub App installation ID. |
| `cicd_trigger_config` | 12 | `{ branch_pattern = "^main$" }` | Advanced Cloud Build trigger config. |
| `enable_cloud_deploy` | 12 | `false` | Provisions a Cloud Deploy pipeline. |
| `cloud_deploy_stages` | 12 | `[dev, staging, prod(approval)]` | Ordered promotion stages. |
| `enable_binary_authorization` | 12 | `false` | Enforces image attestation. |

---

## 7. Reliability & Scheduling

### A. Health Probes

| Variable | Group | Default | Description |
|---|---|---|---|
| `startup_probe_config` | 10 | `{ path="/api/health", initial_delay_seconds=15, failure_threshold=12 }` | Kubernetes startup probe. |
| `health_check_config` | 10 | `{ path="/api/health", initial_delay_seconds=30, failure_threshold=3 }` | Kubernetes liveness probe. |
| `uptime_check_config` | 10 | `{ enabled=false, path="/api/health" }` | Cloud Monitoring uptime check. |
| `alert_policies` | 10 | `[]` | Cloud Monitoring metric alert policies. |
| `startup_probe` | 10 | `{ path="/api/health", initial_delay_seconds=30, failure_threshold=12 }` | Probe config passed to `Grafana Common`. |
| `liveness_probe` | 10 | `{ path="/api/health", initial_delay_seconds=60, failure_threshold=3 }` | Probe config passed to `Grafana Common`. |

### B. Reliability Policies

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_pod_disruption_budget` | 9 | `true` | Creates a Kubernetes PodDisruptionBudget. |
| `pdb_min_available` | 9 | `'1'` | Minimum pods available during voluntary disruptions. |
| `enable_topology_spread` | 9 | `false` | Adds TopologySpreadConstraints for zone distribution. |
| `topology_spread_strict` | 9 | `false` | Rejects pods if topology spread cannot be satisfied. |

### C. Resource Quotas

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_resource_quota` | 8 | `false` | Creates a Kubernetes ResourceQuota in the namespace. |
| `quota_cpu_requests` | 8 | `""` | Total CPU requests allowed across all pods. |
| `quota_cpu_limits` | 8 | `""` | Total CPU limits allowed. |
| `quota_memory_requests` | 8 | `""` | Total memory requests. Must use binary unit suffixes (e.g., `'4Gi'`). |
| `quota_memory_limits` | 8 | `""` | Total memory limits. Must use binary unit suffixes (e.g., `'8Gi'`). |

### D. Jobs & Scheduled Tasks

| Variable | Group | Default | Description |
|---|---|---|---|
| `initialization_jobs` | 11 | `[]` | Kubernetes Jobs run before the application starts. Grafana does not require a default job — leave empty. |
| `cron_jobs` | 11 | `[]` | Scheduled cluster tasks using Kubernetes CronJobs. |
| `additional_services` | 11 | `[]` | Sidecar or helper GKE services deployed alongside the main Grafana container. |

### E. Backup

| Variable | Group | Default | Description |
|---|---|---|---|
| `backup_schedule` | 17 | `'0 2 * * *'` | Backup cron schedule in UTC. |
| `backup_retention_days` | 17 | `7` | Days to retain backup files. |
| `enable_backup_import` | 17 | `false` | Triggers a one-time database import job during deployment. |
| `backup_source` | 17 | `'gcs'` | `'gcs'` or `'gdrive'`. |
| `backup_uri` | 17 | `""` | Full GCS URI or Google Drive file ID. |
| `backup_format` | 17 | `'sql'` | Backup file format. |

---

## 8. Integrations

### A. Redis

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_redis` | 15 | `false` | Enables Redis configuration. |
| `redis_host` | 15 | `""` | Redis hostname or IP. Leave blank to use the NFS server IP. |
| `redis_port` | 15 | `'6379'` | Redis TCP port (string). |
| `redis_auth` | 15 | `""` | Redis AUTH password. Sensitive. |

### B. Custom SQL Scripts

| Variable | Group | Default | Description |
|---|---|---|---|
| `enable_custom_sql_scripts` | 18 | `false` | Runs custom SQL scripts from GCS against the Grafana database. |
| `custom_sql_scripts_bucket` | 18 | `""` | GCS bucket containing SQL scripts. |
| `custom_sql_scripts_path` | 18 | `""` | Path prefix within the GCS bucket. |
| `custom_sql_scripts_use_root` | 18 | `false` | Executes scripts as the root database user. |

---

## 9. Platform-Managed Behaviours

| Behaviour | Detail |
|---|---|
| **PostgreSQL 15 required** | Grafana requires a relational database backend. SQLite is not safe for multi-pod deployments. |
| **`GF_DATABASE_TYPE = "postgres"` injected** | Injected by `grafana.tf`. Without this, Grafana falls back to SQLite even when all other `GF_DATABASE_*` variables are present. |
| **GCS data bucket** | A `grafana-data` GCS bucket is provisioned by `Grafana Common` and passed via `module_storage_buckets`. |
| **Cloud SQL Auth Proxy sidecar** | `enable_cloudsql_volume = true` by default. Grafana connects to Cloud SQL via the Unix socket. |
| **Default fsGroup = 472** | Grafana runs as UID/GID 472. `stateful_fs_group = 472` ensures the container can write to PVC mounts without permission errors. |
| **No default init job** | Grafana auto-migrates its database schema on startup. No `db-init` job is needed. |
| **Health endpoint** | `/api/health` returns HTTP 200 when Grafana and its database connection are healthy. |
| **Custom image by default** | Cloud Build compiles a custom image using `Grafana Common`'s Dockerfile extending `grafana/grafana`. |

---

## 10. Outputs

| Output | Description |
|---|---|
| `service_name` | Name of the Kubernetes Service. |
| `external_ip` | External load balancer IP address. |
| `namespace` | Kubernetes namespace for the deployment. |
| `project_id` | GCP project ID. |
| `deployment_id` | Deployment ID suffix used in resource names. |
| `database_instance_name` | Name of the Cloud SQL PostgreSQL instance. |
| `database_name` | Name of the application database. |
| `database_user` | Name of the application database user. |
| `database_password_secret` | Secret Manager secret name for the database password. |
| `container_image` | Container image used for the deployment. |

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `GF_SECURITY_ADMIN_PASSWORD` (via `secret_environment_variables`) | Grafana default `"admin"` | **Critical** | Grafana ships with `admin`/`admin` credentials. Always inject a strong password via Secret Manager using `secret_environment_variables` before the first deployment. |
| `GF_SECURITY_ADMIN_USER` (via `environment_variables`) | `"admin"` | **High** | Well-known default is a brute-force target. Override with a non-obvious value. |
| `GF_DATABASE_TYPE` | `"postgres"` (hardcoded in `grafana.tf`) | **Critical** | Overriding to `"sqlite3"` causes data loss: the SQLite file lives on the pod ephemeral disk and is lost on every pod restart or rolling upgrade. |
| `GF_SERVER_ROOT_URL` | Not set | **High** | Must match the public URL of the service. Without it, OAuth redirects, email links, and embedded iframes all point to the wrong origin and break. |
| `GF_SERVER_DOMAIN` | Not set | **High** | Must match the domain part of `GF_SERVER_ROOT_URL`. Mismatches break cookie-based authentication. |
| `GF_SMTP_ENABLED` + all SMTP vars | Not set | **Medium** | Alert notifications silently fail if SMTP is not fully configured. All five vars (`GF_SMTP_ENABLED`, `GF_SMTP_HOST`, `GF_SMTP_USER`, `GF_SMTP_PASSWORD`, `GF_SMTP_FROM_ADDRESS`) must be set together. |
| `GF_AUTH_ANONYMOUS_ENABLED` | `false` | **Critical** | Setting to `"true"` exposes all dashboards without authentication. |
| `container_resources.memory_limit` | `"2Gi"` | **High** | Under 512Mi Grafana crashes with OOM errors. On GKE Autopilot, pod memory requests also determine node provisioning — set `mem_request` to match or close to `memory_limit`. |
| `container_resources.mem_request` | `null` (defaults to limit) | **Medium** | On GKE Autopilot, setting `mem_request` far below `memory_limit` leads to burstable scheduling and potential eviction under memory pressure on a shared node. |
| `application_version` | `"11.4.0"` | **Medium** | Pinning to a specific version prevents uncontrolled upgrades that may introduce breaking dashboard API changes. |
| `min_instance_count` | `1` | **High** | Scale-to-zero on GKE means pods are terminated; Grafana alerting evaluations are missed during the cold-start window. |
| `max_instance_count` | `3` | **Medium** | Multiple replicas share the PostgreSQL backend but not in-memory alert state. Alerts can fire duplicates. Use `1` unless a shared alert backend is configured. |
| `quota_memory_requests` / `quota_memory_limits` | `"4Gi"` / `"8Gi"` | **High** | GKE-specific: must use binary suffixes (`Gi`, `Mi`). A bare integer (e.g., `"4"`) is treated as bytes by Kubernetes and blocks all pod scheduling. |
| `enable_iap` | `false` | **High** | Without IAP the Grafana login page is reachable from the internet. At minimum configure network policies or IAP. |
| `db_name` / `db_user` | `"grafana"` / `"grafana"` | **High** | Changing after the db-init job has run orphans the existing schema. Immutable after first apply. |
| `stateful_pvc_enabled` | `false` | **Medium** | Not required for Grafana as persistence is in PostgreSQL. Enabling without understanding StatefulSet semantics can cause stuck rollouts. |
| `pdb_min_available` | `"1"` | **Medium** | Setting to `"0"` allows all replicas to be evicted simultaneously during node upgrades, causing a full Grafana outage. |
| `backup_schedule` | `"0 2 * * *"` | **Medium** | Disabling automated backups leaves dashboard and user data unprotected against Cloud SQL data loss. |
| `enable_redis` | `false` | **Low** | Grafana does not require Redis. Enabling it without a valid `redis_host` raises a validation error at plan time. |
