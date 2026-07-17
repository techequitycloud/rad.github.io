---
title: "OpenEMR on GKE Autopilot"
description: "Configuration reference for deploying OpenEMR on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# OpenEMR on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenEMR_GKE.png" alt="OpenEMR on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

OpenEMR is the world's most widely adopted open-source Electronic Health Records (EHR)
and practice management system, used by 100,000+ healthcare providers across 100+
countries. This module deploys OpenEMR on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud
and Kubernetes infrastructure.

This guide focuses on the cloud services OpenEMR uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle
— refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

OpenEMR runs as an Apache/PHP 8.3 FPM workload on Alpine 3.20. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Apache/PHP pods, 2 vCPU / 4 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for MySQL 8.0 | Required — OpenEMR does not support PostgreSQL |
| Patient documents | Filestore (NFS) | `sites/` directory with patient documents, session cache, and application state shared across all replicas |
| Object storage | Cloud Storage | A general-purpose data bucket |
| Session store | Redis | Enabled by default; falls back to the NFS server IP when no Redis host is given |
| Secrets | Secret Manager | Auto-generated admin password (`OE_PASS`) and database password (`MYSQL_PASS`) |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed; selecting PostgreSQL or
  `NONE` breaks startup.
- **NFS is mandatory.** OpenEMR's `sites/` directory — containing `sqlconf.php`,
  patient documents, Twig/Smarty caches, and uploaded files — must be on a shared NFS
  volume. The application cannot function without it.
- **Redis is enabled by default.** When `max_instance_count > 1`, a shared session
  store is required to prevent PHP session loss across pods.
- **Session affinity is `ClientIP`.** OpenEMR relies on PHP sessions, so requests from
  a browser are pinned to one pod.
- **First-boot installation is automated and slow.** On first deploy, three
  initialization jobs run in sequence: `nfs-init` (NFS directory setup), `db-init`
  (MySQL user and database creation), and `openemr-install` (schema installation via
  `auto_configure.php`). The startup probe allows up to 120 seconds for the
  application to become ready after jobs complete.
- The OpenEMR **admin password** is generated automatically and stored in Secret
  Manager; you never set it in plain text.
- **`min_instance_count` defaults to 1.** Scale-to-zero is not recommended for
  clinical EHR systems — cold starts add 20–40 seconds of latency that clinicians may
  interpret as a system failure.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the OpenEMR workload

OpenEMR pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the OpenEMR workload to see
  pods, events, and probe status. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for MySQL 8.0

OpenEMR stores all clinical data (patient records, scheduling, billing) in a managed
Cloud SQL for MySQL 8.0 instance. Pods reach it privately through the **Cloud SQL Auth
Proxy** sidecar over a Unix socket, so no public IP is exposed. On first deploy the
`db-init` job creates the application database and user before the `openemr-install`
job runs the OpenEMR schema installer.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Filestore (NFS) and Cloud Storage

OpenEMR's `sites/` directory is written to a **Filestore (NFS)** share mounted into
every pod at `/var/www/localhost/htdocs/openemr/sites`. This directory contains
`sqlconf.php` (which signals installation completion), patient-uploaded documents,
Twig/Smarty template caches, and session data. All replicas must share the same NFS
mount. A general-purpose **Cloud Storage** bucket is also provisioned.

- **Console:** Filestore → Instances for the NFS share; Cloud Storage → Buckets for
  the data bucket.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  # Confirm the NFS share is mounted and sites directory exists:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    ls /var/www/localhost/htdocs/openemr/sites/default/
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### D. Redis session store

Redis backs OpenEMR's PHP session store. When `redis_host` is left empty and NFS is
enabled, the NFS server's co-located Redis instance is used automatically. In
multi-replica deployments, a shared session store is required to prevent session loss.

- **Console:** Memorystore → Redis (if using a managed Memorystore instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  # Confirm REDIS_SERVER is set inside the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  ```

### E. Secret Manager

The OpenEMR admin password (`OE_PASS`) and the MySQL database password (`MYSQL_PASS`)
are stored as Secret Manager secrets and injected into pods at runtime via the Secret
Store CSI driver. Plaintext never appears in configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the admin password to log in for the first time:
  gcloud secrets versions access latest \
    --secret=<admin-password-secret-id> --project "$PROJECT"
  ```

The admin password secret ID is exposed as the `admin_password_secret_id` output. The
database password secret name is in `database_password_secret`. See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A
custom domain with a Google-managed certificate can be enabled, and a static IP can
be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  # Test the login page from within the cluster:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    curl -s -o /dev/null -w "%{http_code}" http://localhost/interface/login/login.php
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and
static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. OpenEMR Application Behaviour

- **Three-stage first-deploy initialization.** The following Kubernetes Jobs run in
  sequence on every apply:

  | Job | Purpose | Depends on |
  |---|---|---|
  | `nfs-init` | Prepares the NFS `sites/` directory structure, sets ownership to UID 1000 (Apache), and optionally restores a backup | — |
  | `db-init` | Creates the MySQL database and application user | — |
  | `openemr-install` | Runs `auto_configure.php` in `K8S=admin` mode to install the database schema and create the admin account; writes `$config=1` to `sqlconf.php` on NFS | `nfs-init`, `db-init` |

  The main application pod starts only after `openemr-install` completes and sees
  `$config=1` in `sqlconf.php` — it then skips the installer and begins serving.
  Inspect the jobs:
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/nfs-init
  kubectl logs -n "$NAMESPACE" job/openemr-install
  ```

- **Startup can take 5–20 minutes on first boot.** The `openemr-install` job runs the
  full PHP schema installer, which is slow. The startup probe (TCP on port 80, 12
  failure threshold) allows 120 seconds for the pod to become ready after jobs
  complete. On a truly fresh install consider raising `failure_threshold` in the
  startup probe.

- **Version-aware upgrades.** On subsequent deployments the startup script compares
  the image version against the NFS-stored version and runs the appropriate upgrade
  scripts (`fsupgrade-N.sh`) automatically.

- **Temporary health probe server.** During the installation phase `openemr.sh` starts
  a PHP built-in web server on port 80 that returns HTTP 200 on the health probe path,
  preventing the pod from being killed while the installer runs.

- **Admin login.** The initial administrator username is `admin`. The password is
  auto-generated and stored in Secret Manager — retrieve it with:
  ```bash
  gcloud secrets versions access latest \
    --secret=<admin_password_secret_id> --project "$PROJECT"
  ```
  If the admin account is locked after failed login attempts, use the
  `/root/unlock_admin.sh <new_password>` utility inside the container.

- **`K8S=yes` environment variable.** The application receives `K8S=yes` at runtime,
  which instructs `openemr.sh` to use the Kubernetes-aware startup path (skipping
  slow recursive `chown` operations that would cause timeout failures).

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for OpenEMR are listed; every other input is
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
| `application_name` | `openemr` | Base name for resources. Do not change after first deploy. |
| `application_version` | `7.0.4` | OpenEMR image version tag; increment to roll out a new version. |
| `display_name` | `OpenEMR` | Friendly name shown in the Console and dashboards. |
| `description` | _(set)_ | Workload description annotation. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per pod; 2 vCPU recommended for concurrent clinical workloads. |
| `memory_limit` | `4Gi` | Memory per pod; 4 GiB minimum for production. |
| `ephemeral_storage_limit` | `8Gi` | Ephemeral storage for PHP opcache, Apache logs, and temp files. GKE Autopilot caps total pod ephemeral storage at 10 GiB; the Auth Proxy sidecar uses ~1 GiB, leaving a maximum of 9 GiB. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 to avoid cold-start delays for clinical users. |
| `max_instance_count` | `1` | Increase only after confirming Redis session sharing is operational. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar. Not user-configurable in this module. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |
| `deployment_timeout` | `1800` | Seconds Terraform waits for rollout. Extended for OpenEMR's long first-boot install. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra plain-text settings. Core `MYSQL_*` and `OE_*` values are set automatically. Common additions: `PHP_MEMORY_LIMIT`, `SMTP_HOST`, `SMTP_PORT`. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use for sensitive values such as SMTP credentials. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing required for OpenEMR PHP sessions. |
| `workload_type` | `null` | Auto-resolves to StatefulSet when per-pod storage is enabled. |
| `network_tags` | `['nfsserver']` | Required for NFS connectivity via VPC firewall rules. Do not remove. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable PVC templates. OpenEMR uses NFS, not PVCs — leave unset. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` / `stateful_pvc_storage_class` | _(set)_ | PVC options when StatefulSet mode is explicitly needed. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Disabled by default because `max_instance_count = 1` — a PDB with `min_available = 1` blocks node drains on a single pod. Enable only when running 2+ replicas. |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 if you need eviction headroom. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP on port 80, 12 failures × 10s | TCP probe; allows up to 120 seconds for startup. Increase `failure_threshold` for first-time deploys with large databases. |
| `liveness_probe` | HTTP `GET /interface/login/login.php`, 10 failures × 30s | Login page returns HTTP 200 only when Apache, PHP-FPM, and the database connection are all operational. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Workload Automation

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `nfs-init` / `db-init` / `openemr-install` sequence. |
| `cron_jobs` | `[]` | Scheduled CronJobs (e.g., backup, report generation). |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | **Must remain `true`.** OpenEMR requires NFS for the `sites/` directory. |
| `nfs_mount_path` | `/var/www/localhost/htdocs/openemr/sites` | Mount path inside the container. Must match the OpenEMR sites directory path. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the data bucket. |
| `storage_buckets` | `[{name_suffix="data"}]` | Additional buckets. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 15 — Redis Session Store

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Use Redis for PHP session storage. |
| `redis_host` | `""` | Leave empty to use the NFS server IP; set explicitly for a dedicated Memorystore instance. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `openemr` | MySQL database name. Immutable after first deploy. |
| `db_user` | `openemr` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. Requires pod restart to pick up the new secret. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). **Do not disable for HIPAA-regulated deployments.** |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` | `false` | Restore from a backup on deploy. |
| `backup_source` | `gcs` | Import source: `gcs` or `gdrive`. |
| `backup_uri` | `""` | GCS URI (`gs://bucket/path`) or Google Drive file ID. When set, injected into `nfs-init` as `BACKUP_FILEID`. |
| `backup_format` | `sql` | Backup file format: `sql`, `tar`, `gz`, `tgz`, `tar.gz`, or `zip`. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Kubernetes Gateway for custom hostnames + managed certificate (a Gateway with a static IP is provisioned automatically). |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of OpenEMR. Recommended for restricting access to clinical staff. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | `default-waf-policy` | Policy name. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter. Requires `organization_id` to be set explicitly. Recommended for HIPAA environments. |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs (DATA_READ, DATA_WRITE). Recommended for HIPAA compliance. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach OpenEMR. |
| `admin_password_secret_id` | Secret Manager secret ID for the OpenEMR admin password (`OE_PASS`). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password (`MYSQL_PASS`). |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `nfs_server_ip` | Internal IP of the NFS server (sensitive). |
| `nfs_mount_path` | NFS mount path inside the container. |
| `nfs_share_path` | NFS share path on the server. |
| `nfs_setup_job` | Name of the NFS setup job. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | GitHub repo details. |
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
| `enable_nfs` | `true` | Critical | OpenEMR cannot function without NFS. The `sites/` directory, `sqlconf.php`, and patient documents all live on NFS. Disabling causes immediate startup failure. |
| `nfs_mount_path` | `/var/www/localhost/htdocs/openemr/sites` | Critical | Must match the OpenEMR sites directory path. A mismatch means `openemr-install` writes `sqlconf.php` to a location the main pod never checks — the pod waits indefinitely for setup completion. |
| `database_type` (via OpenEMR_Common) | `MYSQL_8_0` | Critical | OpenEMR requires MySQL; PostgreSQL or `NONE` breaks the installer and all PHP database calls. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all patient data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job and can corrupt the NFS sites directory. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`) | Critical | Bare integers are bytes and block all pod scheduling. |
| `backup_schedule` | `0 2 * * *` | Critical | Disabling backups for an EHR containing PHI is a HIPAA compliance violation. |
| `ephemeral_storage_limit` | `8Gi` | Critical | OpenEMR writes PHP opcache, Apache logs, and temp files to the container layer. GKE Autopilot's default 1 GiB is insufficient — the pod is evicted during startup. |
| `enable_redis` | `true` | High | With >1 replica, isolated per-pod PHP sessions cause login failures and session loss. |
| `redis_host` | `""` (NFS) or explicit | High | An unreachable Redis host causes PHP session failures and prevents all logins. |
| `memory_limit` | `4Gi` | High | OpenEMR PDF generation and billing reports are memory-intensive. Less than 2 GiB causes OOM kills mid-request. |
| `session_affinity` | `ClientIP` | High | Without stickiness, multi-replica deployments lose session state between requests. |
| `min_instance_count` | `1` | High | Scale-to-zero causes cold-start delays of 20–40 seconds — unacceptable for clinical access. |
| `enable_pod_disruption_budget` | enable when `min_instance_count` > 1 | High | Disabled by default because `max_instance_count = 1` — a PDB would permanently block node drains on a single-pod deployment. Enable when scaling beyond one replica. |
| `backup_retention_days` | `7` (raise for prod) | Medium | HIPAA-regulated environments should retain at least 90 days. |
| `enable_iap` / `enable_cloud_armor` | enable for healthcare | Medium | The OpenEMR admin interface is publicly reachable without these controls. |
| `enable_audit_logging` | `true` for HIPAA | Medium | HIPAA requires audit logging of access to PHI. |
| `enable_vpc_sc` | set `organization_id` explicitly | Medium | Without an explicit org ID, VPC-SC silently skips perimeter creation — leaving a false sense of security. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. OpenEMR-specific
application configuration shared with the Cloud Run variant is described in
**[OpenEMR_Common](OpenEMR_Common.md)**.
