---
title: "n8n on GKE Autopilot"
description: "Configuration reference for deploying n8n on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# n8n on GKE Autopilot

n8n is a fair-code workflow automation platform that connects APIs, databases, and
services with a visual node editor. This module deploys n8n on **GKE Autopilot**
on top of the [App_GKE](App_GKE.md) foundation, which provisions and manages the
shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services n8n uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

n8n runs as a Node.js workload. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pods, 2 vCPU / 4 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — n8n uses PostgreSQL for all workflow and credential data |
| Shared files | Filestore (NFS) | Binary file data shared across all replicas; also serves as the default Redis endpoint |
| Object storage | Cloud Storage | A dedicated data bucket |
| Queue & coordination | Redis | Enabled by default; enables n8n queue mode for horizontal scaling |
| Secrets | Secret Manager | Auto-generated encryption key and SMTP password placeholder |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed; selecting any other
  engine or `NONE` breaks startup.
- **Redis is enabled by default.** Queue mode allows multiple n8n replicas to
  distribute workflow execution. Without Redis, only a single replica can process
  workflows reliably.
- **The encryption key is irreplaceable.** `N8N_ENCRYPTION_KEY` is generated once
  and stored in Secret Manager. All workflow credentials are encrypted with it. If
  the key is rotated or deleted, every saved credential becomes permanently
  unreadable.
- **Session affinity is `ClientIP`.** The editor uses WebSockets, so requests from
  a browser are pinned to one pod.
- **`WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` are pre-set** to the expected service
  URL before deployment so webhooks resolve correctly from first start.
- The **SMTP password** secret is seeded with a dummy value; update it in Secret
  Manager before configuring email sending.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the n8n workload

n8n pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the
minimum and maximum replica counts. Session affinity pins editor sessions to a
single pod.

- **Console:** Kubernetes Engine → Workloads → select the n8n workload to see
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

n8n stores all workflow definitions, execution history, and encrypted credentials
in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately through
the **Cloud SQL Auth Proxy** sidecar over a Unix socket, so no public IP is
exposed. The `entrypoint.sh` script translates the platform-injected `DB_*`
variables to n8n-native `DB_POSTGRESDB_*` variables at runtime. On first deploy an
initialization Job creates the application database and user.

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
automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Filestore (NFS) and Cloud Storage

Binary files uploaded to or produced by workflows are written to a **Filestore
(NFS)** share mounted into every pod so all replicas see the same data
(`N8N_DEFAULT_BINARY_DATA_MODE=filesystem`). The NFS host IP also serves as the
default Redis endpoint when no explicit `redis_host` is configured. A dedicated
**Cloud Storage** bucket is provisioned for broader data persistence.

- **Console:** Filestore → Instances for the NFS share; Cloud Storage → Buckets for
  the data bucket.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### D. Redis queue

Redis enables n8n's queue mode, which distributes workflow executions across
multiple replicas using Bull. In queue mode one or more "worker" instances pick up
executions from the queue while the main instance handles the editor and webhook
registration. When no external Redis host is configured and NFS is enabled, the NFS
host IP is used as the Redis endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The n8n encryption key and the SMTP password placeholder are stored as Secret
Manager secrets and injected into pods at runtime; plaintext never appears in
configuration. The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Update the SMTP password with the real credential:
  echo -n "my-real-smtp-password" | \
    gcloud secrets versions add <smtp-secret-name> --data-file=- --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
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

## 3. n8n Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) uses
  `postgres:15-alpine` to create the n8n database and user and grants privileges
  before the application starts. It is idempotent and safe to re-run.
- **Environment variable translation.** `entrypoint.sh` maps `DB_HOST`,
  `DB_NAME`, `DB_USER`, and `DB_PASSWORD` (injected by the platform) to the
  n8n-native `DB_POSTGRESDB_*` equivalents at container startup. The Cloud SQL
  Auth Proxy socket path is rewritten to a symlink that PostgreSQL drivers can
  locate.
- **Queue mode operation.** With `enable_redis = true` (the default), n8n starts
  in queue mode. The main pod handles webhook registration, the editor UI, and
  execution coordination; additional replicas act as workers picking jobs from the
  Bull queue.
- **Webhook URL stability.** `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` are set to
  the predicted service URL before deployment. If the external IP or custom domain
  changes, these values must be updated and the workload redeployed.
- **Binary data storage.** `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` directs n8n
  to write binary files (attachments, downloads) to the NFS-mounted filesystem
  rather than the database, which is required for multi-replica deployments.
- **Health path.** Readiness/liveness probes target the n8n root (`/`), which
  returns HTTP 200 only once the application and database connection are fully
  initialised. The startup probe allows 120 seconds for first-boot setup.
- **Encryption key criticality.** `N8N_ENCRYPTION_KEY` encrypts all workflow
  credentials stored in the database. The key is generated once; if it changes, all
  saved credentials (API keys, passwords, tokens) become permanently unreadable.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for n8n are listed; every other input is
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
| `application_name` | `n8n` | Base name for resources. Do not change after first deploy. |
| `display_name` | `N8N Workflow Automation` | Friendly name shown in the Console. |
| `description` | _(set)_ | Workload description annotation. |
| `application_version` | `2.4.7` | n8n image version tag; increment to roll out a new version. |
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `2000m` | CPU per pod; 2 vCPU recommended for n8n workflow execution. |
| `memory_limit` | `4Gi` | Memory per pod. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 so queued workflows always have a worker. |
| `max_instance_count` | `3` | Maximum replicas (autoscaler ceiling). |
| `container_port` | `5678` | n8n listens on port 5678. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the n8n image into Artifact Registry before deploy. |
| `timeout_seconds` | `300` | Max request duration in seconds. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | SMTP placeholder defaults | Extra non-secret settings. Core `N8N_*` and `DB_TYPE` values are set automatically. The default map includes `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL`, and `EMAIL_FROM` as empty/placeholder values ready to override with real credentials. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency (~30 days). |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing required for n8n's WebSocket editor sessions. |
| `workload_type` | `null` | Auto-resolves to StatefulSet when per-pod storage is enabled. |
| `network_tags` | `['nfsserver']` | Node/pod tags; `nfsserver` is required for NFS connectivity. |
| `gke_cluster_name` | `""` | Leave empty for auto-discovery. |
| `namespace_name` | `""` | Leave empty to auto-generate. |
| `configure_service_mesh` | `false` | Enable Istio injection for the namespace. |
| `termination_grace_period_seconds` | `30` | Seconds to wait after SIGTERM before SIGKILL. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable PVC templates in the StatefulSet. Setting `true` auto-selects StatefulSet workload type. |
| `stateful_pvc_size` | `10Gi` | Storage size per PVC. |
| `stateful_pvc_mount_path` | `/data` | Mount path inside the container. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 if you need eviction headroom. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `GET /` | Probes target the n8n root. Startup probe allows 120s initial delay. |
| `startup_probe_config` / `health_check_config` | _(set)_ | Structured probe objects forwarded to the foundation. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` database setup job. |
| `cron_jobs` | `[]` | Scheduled CronJobs. n8n's built-in scheduler handles workflow triggers; use these for external operations (maintenance scripts, custom data jobs). |
| `additional_services` | `[]` | Sidecar or helper GKE services deployed alongside n8n. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for binary file data (keep enabled for multi-replica). |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `nfs_volume_name` | `nfs-data-volume` | Kubernetes volume name for the NFS mount. |
| `nfs_instance_name` | `""` | Name of an existing NFS GCE VM. Leave empty for auto-discovery. |
| `nfs_instance_base_name` | `app-nfs` | Base name for an inline NFS GCE VM when none exists. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the data bucket. |
| `storage_buckets` / `gcs_volumes` | _(set)_ | Additional buckets / GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 15 — Redis Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Use Redis for queue-mode workflow execution. |
| `redis_host` | `""` | Leave empty to use the NFS host IP; set explicitly when NFS is disabled. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `n8n_db` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `n8n_user` | Application user. Immutable after first deploy. |
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
| `enable_custom_domain` | `true` | Provision a Gateway for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of n8n. |
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
| `service_url` | URL to reach n8n. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (via the Auth Proxy) / port. |
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
| `N8N_ENCRYPTION_KEY` | _(auto-generated, never rotate)_ | Critical | Rotating or deleting this key destroys all saved workflow credentials permanently. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all workflow data. |
| `enable_nfs` | `true` | Critical | Without shared storage, binary files are not shared across replicas and `filesystem` binary mode fails. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all pod scheduling. |
| `enable_redis` | `true` | High | Without Redis queue mode, running more than one replica causes workflow execution conflicts. |
| `redis_host` | `""` (NFS) or explicit | High | No valid endpoint if Redis is on but NFS is off and no host is set. |
| `session_affinity` | `ClientIP` | High | Without stickiness, WebSocket editor sessions drop when routed to a different pod. |
| `min_instance_count` | `1` | High | `0` leaves queued workflows with no worker to pick them up. |
| `memory_limit` | `4Gi` | High | Too little memory causes OOM during large workflow execution batches. |
| `enable_iap` / `enable_cloud_armor` | enable for production | Medium | The n8n editor is otherwise publicly reachable and exposes all saved credentials. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. n8n-specific application configuration shared with the
Cloud Run variant is described in **[N8N_Common](N8N_Common.md)**.
