---
title: "Nextcloud on GKE Autopilot"
---

# Nextcloud on GKE Autopilot

Nextcloud is the leading self-hosted file sync and collaboration platform, trusted by
400 million users across 100,000+ organisations — including governments and healthcare
providers seeking a GDPR-compliant alternative to Google Drive and OneDrive. This module
deploys Nextcloud on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation,
which provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Nextcloud uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle
— refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Nextcloud runs as a PHP/Apache workload. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | PHP/Apache pods, 2 vCPU / 4 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for MySQL 8.0 | Required — Nextcloud does not support PostgreSQL in this deployment |
| Shared files | Filestore (NFS) | `config/` and `data/` directories shared across all replicas |
| Object storage | Cloud Storage | A `nc-data` bucket provisioned per deployment |
| Cache & locking | Redis | Enabled by default; prevents file-locking conflicts across replicas |
| Secrets | Secret Manager | Auto-generated admin password; post-install config secrets |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed; selecting PostgreSQL or
  `NONE` breaks startup.
- **NFS is enabled by default.** All replicas must share `config.php` and the user data
  directory. Without NFS every pod restart discards files.
- **Redis is enabled by default.** Without a shared cache and lock backend, concurrent
  writes across replicas cause "File is locked" errors.
- **PHP limits are baked into the container image** at build time. Changing
  `php_memory_limit`, `upload_max_filesize`, or `post_max_size` requires a new Cloud
  Build run.
- **The admin password is generated automatically** and stored in Secret Manager; you
  never set it in plain text.
- **First-boot is intentionally slow.** Nextcloud runs `occ maintenance:install`
  synchronously before Apache starts. The startup probe allows up to 10 minutes for
  the first installation to complete.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Nextcloud workload

Nextcloud pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Nextcloud workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  # Run an occ command inside a running pod:
  POD=$(kubectl get pods -n "$NAMESPACE" -o name | grep nextcloud | head -1)
  kubectl exec -n "$NAMESPACE" -it "$POD" -- php occ status
  kubectl exec -n "$NAMESPACE" -it "$POD" -- php occ db:add-missing-indices
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for MySQL 8.0

Nextcloud stores all application data (files metadata, users, shares, calendar, and
contacts) in a managed Cloud SQL for MySQL 8.0 instance. Pods reach it privately
through the **Cloud SQL Auth Proxy** sidecar over a Unix socket at `127.0.0.1:3306`
so no public IP is exposed. On first deploy an initialization Job creates the
application database and user with `utf8mb4` collation.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Filestore (NFS) and Cloud Storage

Nextcloud data is written to a **Filestore (NFS)** share mounted into every pod.
`entrypoint.sh` symlinks `/var/www/html/config` → `/mnt/nfs/nextcloud-config` and
sets `NEXTCLOUD_DATA_DIR=/mnt/nfs/nextcloud-data` so all replicas share the same
`config.php` and user files. A **Cloud Storage** `nc-data` bucket is also provisioned
per deployment and the workload service account is granted access automatically.

- **Console:** Filestore → Instances for the NFS share; Cloud Storage → Buckets for
  the data bucket.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<nc-data-bucket>/
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### D. Redis cache and file locking

Redis backs Nextcloud's distributed cache (`memcache.distributed`) and file locking
(`filelocking.enabled`). With more than one replica this is mandatory — without it
concurrent writes produce "File is locked" HTTP 503 errors. When no external Redis
host is configured and NFS is enabled, the NFS server IP is used as the Redis endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The Nextcloud admin password and four post-installation config secrets (instance ID,
password salt, app secret, and optionally the Redis auth password) are stored in
Secret Manager and injected into pods at runtime. The three config secrets start as
`"UNSET"` placeholder values; the container's post-install hook writes the real
values after `occ maintenance:install` completes.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~nextcloud"
  gcloud secrets versions access latest --secret=<admin-password-secret> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A
custom domain with a Google-managed certificate can be enabled, and a static IP can
be reserved so the address survives redeploys. Custom domains are also added to
Nextcloud's `NEXTCLOUD_TRUSTED_DOMAINS` list automatically.

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

## 3. Nextcloud Application Behaviour

- **First-deploy database setup.** An initialization Job creates the Nextcloud
  database and user with `utf8mb4` character set and grants privileges before the
  application starts. It is idempotent and safe to re-run.
- **`occ maintenance:install` on first boot.** On the very first start Nextcloud runs
  its installation routine synchronously before Apache begins serving. This can take
  several minutes on a cold Cloud SQL instance. The startup probe allows up to 10
  minutes (60 s initial delay + 20 failures × 15 s period) for this to complete.
- **Post-install config secrets.** After `occ maintenance:install` completes, a hook
  in the container writes the real `instanceid`, `passwordsalt`, and `secret` values
  to Secret Manager. Subsequent pod starts read these back to reconstruct `config.php`
  without requiring NFS.
- **PHP upgrade on start.** `NEXTCLOUD_UPDATE=1` is set by default, so Nextcloud runs
  `occ upgrade` automatically on every container start. This is intentional for minor
  version bumps. Set `NEXTCLOUD_UPDATE=0` in `environment_variables` and manage
  upgrades manually when crossing major versions.
- **Trusted domains.** Nextcloud enforces a trusted-domain whitelist. The module
  seeds `NEXTCLOUD_TRUSTED_DOMAINS` with the cluster-internal DNS name and any
  `application_domains`. Requests from unlisted hostnames receive an
  "Access through untrusted domain" error.
- **NFS config symlink.** When NFS is mounted, `entrypoint.sh` symlinks
  `/var/www/html/config` → `/mnt/nfs/nextcloud-config`. This is what allows all
  replicas to share the same `config.php`.
- **Health path.** Startup and liveness probes target `/status.php`, which returns an
  HTTP 200 with a JSON status object regardless of Nextcloud's setup state — making it
  the canonical health endpoint.
- **Admin login.** The initial admin username is configurable; the password is
  retrieved from Secret Manager (see §2.E).

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Nextcloud are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

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
| `application_name` | `nextcloud` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Nextcloud` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `30` | Nextcloud image version tag; increment to roll out a new version. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per pod; 2 vCPU recommended. |
| `memory_limit` | `4Gi` | Memory per pod; 4 GiB recommended. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Structured resource object; overrides `cpu_limit`/`memory_limit` when set. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 for WebDAV clients that maintain persistent connections. |
| `max_instance_count` | `5` | Maximum replicas. Requires Redis + NFS when > 1. |
| `container_port` | `80` | Nextcloud/Apache listens on port 80. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | SMTP defaults | Extra non-secret settings injected into the pod. Core Nextcloud vars are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Target GKE cluster. Auto-discovered when empty. |
| `namespace_name` | `""` | Kubernetes namespace. Auto-generated when empty. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true`. |
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing; recommended for stateful file operations. |
| `network_tags` | `['nfsserver']` | `nfsserver` tag is required for NFS connectivity. |
| `termination_grace_period_seconds` | `30` | Grace period before SIGKILL. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enables per-pod PVC templates; auto-selects StatefulSet when `true`. |
| `stateful_pvc_size` | `10Gi` | Storage size for each per-pod PVC. |
| `stateful_pvc_mount_path` | `/data` | Container path for the per-pod PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVC provisioning. |
| `stateful_headless_service` | `null` | Creates a headless Service for stable pod DNS entries. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` or `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` or `OnDelete`. |
| `stateful_fs_group` | `0` | GID set as pod-level `fsGroup` for PVC ownership. |

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
| `enable_topology_spread` | `false` | Spread pods across zones; recommended for `min_instance_count > 1`. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `{ path="/status.php", initial_delay_seconds=60, failure_threshold=20 }` | Allows up to ~5 minutes for first-boot `occ maintenance:install`. |
| `liveness_probe` | `{ path="/status.php", initial_delay_seconds=120, failure_threshold=3 }` | Restarts the container after 3 consecutive failures. |
| `uptime_check_config` | `{ enabled=false }` | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Kubernetes CronJobs for recurring scheduled tasks. |
| `additional_services` | `[]` | Additional sidecar or companion GKE services. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for Nextcloud config and data. **Required for multi-replica.** |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `nfs_volume_name` | `nfs-data-volume` | Kubernetes volume name for the NFS mount. |
| `nfs_instance_name` | `""` | Existing NFS GCE VM name. Auto-discovered when empty. |
| `nfs_instance_base_name` | `app-nfs` | Base name for inline NFS VM when none exists. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the `nc-data` bucket. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Additional GCS buckets. |
| `gcs_volumes` | `[]` | GCS buckets to mount via GCS Fuse CSI driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` | `7` | Maximum recent Artifact Registry images to keep. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Use Redis for distributed caching and file locking. |
| `redis_host` | `""` | Leave empty to use the NFS server IP; set explicitly when NFS is disabled. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixed — do not change. |
| `application_database_name` | `gkeappdb` | Database name. Immutable after first deploy. |
| `application_database_user` | `gkeappuser` | Application user. Immutable after first deploy. |
| `db_name` | `nextcloud` | Convenience alias forwarded to `Nextcloud_Common` as `db_name`. |
| `db_user` | `nextcloud` | Convenience alias forwarded to `Nextcloud_Common` as `db_user`. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `false` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Custom hostnames; also added to `NEXTCLOUD_TRUSTED_DOMAINS`. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Nextcloud. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Cloud Armor & CDN

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | `default-waf-policy` | Policy name. |
| `enable_cdn` | `false` | Enable Cloud CDN on the Ingress backend. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

### Group 23 — Nextcloud Application Settings

| Variable | Default | Description |
|---|---|---|
| `nextcloud_admin_user` | `admin` | Initial administrator username. Change from the default for public-facing deployments. |
| `php_memory_limit` | `512M` | PHP memory limit — baked into the container image at build time. Increase for large file operations. |
| `upload_max_filesize` | `512M` | Maximum upload file size — baked into the image. Increase for video or archive uploads. |
| `post_max_size` | `512M` | PHP POST body limit — must be ≥ `upload_max_filesize`. |

### Group 24 — Email / SMTP

| Variable | Default | Description |
|---|---|---|
| `smtp_host` | `""` | SMTP server hostname. Leave empty to disable email (password resets and share notifications will not work). |
| `smtp_secure` | `""` | Encryption: `ssl` (port 465), `tls` (STARTTLS port 587), or empty for none. |
| `smtp_port` | `""` | SMTP port. Leave empty to use the default for `smtp_secure`. |
| `smtp_authtype` | `LOGIN` | Authentication mechanism: `LOGIN`, `PLAIN`, or `NONE`. |
| `smtp_name` | `""` | SMTP login username. |
| `mail_from_address` | `""` | Local part of the From address (before the `@`). |
| `mail_domain` | `""` | Domain part of the From address (after the `@`). |

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
| `service_url` | URL to reach Nextcloud (appends `/login` to the base URL). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD repo details. |
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
| `database_type` | `MYSQL_8_0` | Critical | Nextcloud requires MySQL; other engines break the init job and startup. |
| `enable_nfs` | `true` | Critical | Without shared storage all user files and `config.php` are lost on pod restart. |
| `enable_cloudsql_volume` | `true` | Critical | Nextcloud connects via Unix socket; removing the sidecar breaks all DB connections on startup. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys data. |
| `application_domains` | include all access hostnames | Critical | Nextcloud blocks requests from unlisted domains with "Access through untrusted domain". |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all scheduling. |
| `enable_redis` | `true` | High | With > 1 replica, file locks become stale and concurrent writes return HTTP 503. |
| `redis_host` | `""` or explicit IP | High | No valid Redis endpoint when NFS is off and no host is set. |
| `upload_max_filesize` / `post_max_size` | increase for large files | High | Baked into image; files above the limit silently fail. `post_max_size` must be ≥ `upload_max_filesize`. |
| `memory_limit` | `4Gi` | High | Too little memory causes PHP OOM during large uploads or thumbnail generation. |
| `NEXTCLOUD_UPDATE` | `1` (default) or `0` | High | Leaving `1` on a major-version upgrade can corrupt the database. Set to `0` and run `occ upgrade` manually across major versions. |
| `min_instance_count` | `1` | High | `0` causes cold-start disconnections for WebDAV sync clients. |
| `max_instance_count > 1` | requires Redis + NFS | High | Multiple replicas without Redis cause file-locking errors and possible data corruption. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |
| `nextcloud_admin_user` | change from `admin` | Medium | Default `admin` is a common brute-force target on public deployments. |
| `enable_iap` / `enable_cloud_armor` | enable for admin-facing | Medium | Without these the Nextcloud admin panel is publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `php_memory_limit` | `512M` (raise for heavy use) | Medium | Baked into image; requires rebuild to change. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Nextcloud-specific
application configuration shared with the Cloud Run variant is described in
**[Nextcloud_Common](Nextcloud_Common.md)**.
