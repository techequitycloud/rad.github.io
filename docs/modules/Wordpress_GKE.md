---
title: "WordPress on GKE Autopilot"
---

# WordPress on GKE Autopilot

WordPress is the world's most popular content management system, powering over 43% of all websites globally. This module deploys WordPress on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services WordPress uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics that are common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

WordPress runs as a PHP/Apache web workload. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | PHP/Apache pods, 1 vCPU / 2 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for MySQL 8.0 | Required — WordPress does not support PostgreSQL |
| Shared files | Filestore (NFS) | `wp-content` directory (uploads, plugins, themes) shared across all replicas |
| Object storage | Cloud Storage | A dedicated `wp-uploads` media bucket |
| Cache | Redis | Optional object cache; enabled by default to reduce database load |
| Secrets | Secret Manager | Auto-generated database password and eight WordPress authentication keys and salts |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed; selecting PostgreSQL or `NONE` breaks startup.
- **NFS is required for a functional site.** WordPress stores uploaded media, installed plugins, and active themes under `wp-content/`. Without a shared NFS volume, each pod has an isolated and ephemeral `wp-content` — plugins are lost on restart and replicas serve different versions of the site.
- **Eight WordPress authentication keys and salts are auto-generated** and stored in Secret Manager; you never set them in plain text.
- **Redis object cache is enabled by default.** Reduces database load by caching the results of expensive queries. Requires a Redis host to be reachable (defaults to the NFS server IP when `redis_host` is left empty).
- **Session affinity is `ClientIP`.** WordPress uses PHP sessions for the admin panel; requests from a browser must be pinned to one pod.
- **The startup probe is TCP, not HTTP.** WordPress may not yet respond to HTTP requests during database initialisation on first boot; a TCP probe only checks that Apache's port is open.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the WordPress workload

WordPress pods are scheduled on Autopilot, which bills for the CPU/memory the pods actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the WordPress workload to see pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type (Deployment vs StatefulSet) are managed.

### B. Cloud SQL for MySQL 8.0

WordPress stores all site data (posts, users, settings, comments) in a managed Cloud SQL for MySQL 8.0 instance. Pods reach it privately through the **Cloud SQL Auth Proxy** sidecar over a Unix socket, so no public IP is exposed. On first deploy an initialisation Job creates the application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the password are all surfaced in the [Outputs](#5-outputs). For the connection model, automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Filestore (NFS) and Cloud Storage

WordPress's `wp-content` directory is mapped onto a **Filestore (NFS)** share mounted into every pod so all replicas share the same plugins, themes, and uploaded media. A dedicated **Cloud Storage** bucket (`wp-uploads`) is also provisioned for media assets; the workload service account is granted access automatically.

- **Console:** Filestore → Instances for the NFS share; Cloud Storage → Buckets for the media bucket.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  # Confirm PHP limits (useful for diagnosing upload failures):
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- php -r "
    echo 'memory_limit: ' . ini_get('memory_limit') . PHP_EOL;
    echo 'upload_max_filesize: ' . ini_get('upload_max_filesize') . PHP_EOL;
    echo 'post_max_size: ' . ini_get('post_max_size') . PHP_EOL;
  "
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### D. Redis object cache

Redis backs WordPress's object cache via the **WP Redis** plugin, storing the results of expensive database queries in memory and dramatically reducing page load times and database load on busy sites. When `redis_host` is left empty and NFS is enabled, the NFS server IP is used as the Redis endpoint (the default shared deployment model).

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  # From inside a WordPress pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    sh -c 'redis-cli -h $WP_REDIS_HOST -p $WP_REDIS_PORT ping'
  ```

### E. Secret Manager

The WordPress database password and the eight WordPress authentication keys and salts are stored as Secret Manager secrets and injected into pods at runtime; plaintext values never appear in configuration or Terraform state.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # List all secrets belonging to this deployment:
  gcloud secrets list --project "$PROJECT" --filter="name~<resource-prefix>"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A custom domain with a Google-managed certificate can be enabled, and a static IP can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. WordPress Application Behaviour

- **First-deploy database setup.** An initialisation Job using the `mysql:8.0-debian` image creates the WordPress database and user and grants privileges before the application starts. It runs on **every** `tofu apply` because it is idempotent — it safely skips steps that are already complete.
- **Authentication keys and salts.** Eight 64-character WordPress security secrets (auth key, secure auth key, logged-in key, nonce key, and their corresponding salts) are generated automatically on first deploy and stored in Secret Manager. Rotating these secrets immediately invalidates all active browser sessions — every logged-in user will be signed out.
- **PHP configuration baked at build time.** `php_memory_limit`, `upload_max_filesize`, and `post_max_size` are applied to the container image at Cloud Build time. Changing them triggers a new image build and rolling update.
- **WordPress table prefix.** `WORDPRESS_TABLE_PREFIX` is set to `wp_` automatically. Override via `environment_variables` only when migrating an existing database with a non-standard prefix.
- **Probe behaviour.** The startup probe uses TCP (port open check) rather than HTTP to avoid failures during WordPress's database initialisation phase. The liveness probe polls `/wp-admin/install.php` — which returns HTTP 200 whether WordPress is freshly installed or already configured — with a 300-second initial delay to allow the `db-init` job to complete. Do not reduce `failure_threshold` below 10 for the startup probe on production deployments.
- **WP_HOME and WP_SITEURL.** On GKE the service URL is not known at plan time, so these constants are not auto-set. WordPress discovers the site URL from the database on first setup. Set `WP_HOME` via `environment_variables` if you need to force a specific URL before WordPress has been installed.
- **Scheduled tasks.** WordPress's built-in `wp-cron` pseudo-cron relies on site traffic to trigger. For production sites with consistent uptime requirements, disable `wp-cron` in `wp-config.php` and schedule `wp cron event run --due-now` as a `cron_jobs` entry.

  Inspect scheduled tasks:
  ```bash
  kubectl get cronjobs -n "$NAMESPACE"
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for WordPress are listed; every other input is inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

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
| `application_name` | `wordpress` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Wordpress` | Friendly name shown in the Console. |
| `application_description` | `Wordpress CMS on GKE` | Workload description annotation. |
| `application_version` | `latest` | WordPress image version tag passed as `APP_VERSION` build argument. Use a pinned version (e.g. `6.7.1`) in production for reproducible builds. |
| `php_memory_limit` | `512M` | PHP `memory_limit` baked into the container image at build time. Increase for heavy plugin workloads (e.g. WooCommerce, Elementor). |
| `upload_max_filesize` | `64M` | Maximum size of a single file upload. Must be ≤ `post_max_size`. |
| `post_max_size` | `64M` | Maximum size of all POST data in a single HTTP request. Must be ≥ `upload_max_filesize`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per pod; 1 vCPU is sufficient for typical sites. |
| `memory_limit` | `2Gi` | Memory per pod; 2 GiB recommended for WordPress with plugins. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 to avoid cold-start latency. |
| `max_instance_count` | `1` | Maximum replicas. Increase only after verifying all installed plugins handle concurrent pod access correctly. |
| `container_port` | `80` | WordPress/Apache listens on port 80. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. Required. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `WORDPRESS_TABLE_PREFIX`, `WORDPRESS_DEBUG`, and Redis vars are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Eight WordPress auth secrets are injected automatically. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing required for WordPress PHP sessions in the admin panel. |
| `workload_type` | `null` | Auto-resolves to StatefulSet when per-pod storage is enabled. |
| `network_tags` | `['nfsserver']` | Node/pod tags; `nfsserver` is required for NFS connectivity. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable per-pod PVCs when using StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Storage size per PVC. WordPress media libraries grow quickly — plan for 50–200 GiB on active sites. |
| `stateful_pvc_mount_path` | `/data` | Container path for the per-pod PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block all scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protect availability during node upgrades. The default is `false` because the default `max_instance_count` is 1; enable only when running multiple replicas. |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 to leave eviction headroom. |
| `enable_topology_spread` | `false` | Spread pods across zones for multi-replica deployments. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, 30s delay, threshold 20 | TCP probe on port 80 — avoids HTTP failures during database initialisation on first boot. Do not reduce `failure_threshold` below 10. |
| `liveness_probe` | HTTP `/wp-admin/install.php`, 300s delay | HTTP probe; 300-second initial delay accommodates the `db-init` job. |
| `uptime_check_config` | enabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. Supplying a non-empty list replaces the default entirely. |
| `cron_jobs` | `[]` | Recurring scheduled tasks. Use to replace `wp-cron` with a dedicated schedule for reliable WordPress cron execution. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for WordPress `wp-content` (keep enabled). |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. The startup script symlinks `wp-content` here. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the `wp-uploads` media bucket. |
| `storage_buckets` | `[{name_suffix="data"}]` | Additional buckets. |
| `gcs_volumes` | `[]` | GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Use Redis for WordPress object caching. |
| `redis_host` | `""` | Leave empty to use the NFS server IP (default shared model); set explicitly for a dedicated Memorystore instance. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `null` (resolved to `MYSQL_8_0` by Wordpress_Common) | Fixed — do not change. WordPress requires MySQL. |
| `application_database_name` | `wp` | Database name. **Immutable after first deploy.** |
| `application_database_user` | `wp` | Application user. **Immutable after first deploy.** |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. Note: this module uses `backup_file` (filename within the GCS backup bucket), not `backup_uri`. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `false` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of WordPress. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. Strongly recommended — WordPress login pages are prime targets for brute-force attacks. |
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

These values are returned on a successful deployment and are the quickest way to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for Cloud Deploy stage services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach WordPress. |
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
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. On a first apply of a new inline cluster this is `false` — run apply a second time to complete the deployment. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` (auto-set) | Critical | WordPress requires MySQL; PostgreSQL/`NONE` breaks startup. |
| `enable_nfs` | `true` | Critical | Without shared storage, plugins/themes/uploads are isolated per pod and lost on restart; multi-replica deployments serve inconsistent site versions. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all WordPress data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_file` in the GCS bucket fails the import job. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all scheduling. |
| `container_image_source` | `custom` | High | The custom WordPress image wires the NFS symlink and Cloud SQL socket. Using `prebuilt` with the vanilla WordPress image breaks Cloud SQL socket connectivity. |
| `nfs_mount_path` | `/mnt/nfs` (do not change after deploy) | High | The startup script symlinks `wp-content` to this path; changing it after initial deployment breaks the symlink. |
| `memory_limit` | `2Gi` | High | WordPress with popular plugins (WooCommerce, Elementor) requires at least 2 GiB; insufficient memory causes PHP fatal errors. |
| `session_affinity` | `ClientIP` | High | Without stickiness, admin users are logged out on every request that lands on a different pod. |
| `enable_redis` | `true` | Medium | With multiple replicas, isolated per-pod in-memory caches cause redundant database queries. |
| `redis_host` | `""` (NFS IP) or explicit | High | No valid Redis endpoint if Redis is on, NFS is off, and no host is set. |
| `enable_cloud_armor` | enable for public sites | High | WordPress login pages (`/wp-login.php`, `xmlrpc.php`) are prime brute-force targets. |
| `php_memory_limit` | `512M` | Medium | Must be within `memory_limit`; too low causes plugin activation failures and white screens of death. |
| `min_instance_count` | `1` | Medium | `0` causes 30–60 second cold starts and potential visible errors for the first visitor after idle. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for e-commerce or content-heavy sites; one week of posts/orders lost. |
| `stateful_pvc_size` | `10Gi` (raise for prod) | Medium | WordPress media libraries grow quickly; plan for 50–200 GiB for active sites. |
| `enable_network_segmentation` | enable for shared clusters | Medium | Without NetworkPolicy, any pod in the cluster can reach WordPress pods directly. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. WordPress-specific application configuration shared with the
Cloud Run variant is described in **[Wordpress_Common](Wordpress_Common.md)**.
