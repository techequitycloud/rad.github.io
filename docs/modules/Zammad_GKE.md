---
title: "Zammad on GKE Autopilot"
description: "Configuration reference for deploying Zammad on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Zammad on GKE Autopilot

Zammad is an open-source helpdesk and customer support platform — a GDPR-compliant
alternative to Zendesk and Freshdesk. This module deploys Zammad on **GKE Autopilot**
on top of the [App_GKE](App_GKE.md) foundation, which provisions and manages the
shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Zammad uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

Zammad runs as a Ruby on Rails (railsserver) workload. The deployment wires together
a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Rails pods, 2 vCPU / 4 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Zammad does not support MySQL |
| Attachment storage | Filestore (NFS) | Ticket attachments at `/opt/zammad/storage`, shared across all replicas |
| Object storage | Cloud Storage | A dedicated `zammad-attachments` bucket, always provisioned |
| Cache & job queue | Redis | Enabled by default; required for ActionCable WebSocket pub/sub and Sidekiq |
| Secrets | Secret Manager | Database password managed automatically |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is required.** The database engine is fixed; MySQL is not supported
  and is rejected at plan time.
- **Redis is required.** Zammad uses Redis for real-time ticket updates (ActionCable)
  and background job processing (Sidekiq). Without it, Zammad fails to start.
- **A custom image is built via Cloud Build.** `container_image_source = "custom"` is
  the default — Cloud Build wraps the official `zammad/zammad` Docker Hub image with
  a GCP-specific `entrypoint.sh` that maps Foundation `DB_*` variables to Zammad's
  `POSTGRESQL_*` convention.
- **Database migrations run on every pod start** (idempotent via `zammad-init`). The
  startup probe allows ample time for first-boot migration.
- **Session affinity is `ClientIP`.** Zammad WebSocket connections are pinned to one
  pod; Redis pub/sub coordinates real-time events across replicas.
- **PodDisruptionBudget is enabled by default.** At least one Zammad pod stays up
  during node maintenance.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Zammad workload

Zammad pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the
minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Zammad workload to see
  pods, events, and resource usage. Kubernetes Engine → Services & Ingress shows the
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

Zammad stores all helpdesk data (tickets, users, channels, SLA records) in a managed
Cloud SQL for PostgreSQL 15 instance. Pods reach it privately through the **Cloud SQL
Auth Proxy** sidecar over a Unix socket — no public IP is exposed. On the first
deploy, an initialization Job creates the application database and user. On every
subsequent pod start, `zammad-init` applies any pending schema migrations.

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
automated backups, and password rotation, see
[App_GKE](App_GKE.md).

### C. Filestore (NFS) and Cloud Storage

Ticket attachments and uploaded files are written to a **Filestore (NFS)** share
mounted at `/opt/zammad/storage` inside every pod so all replicas see the same files.
A dedicated **Cloud Storage** (`zammad-attachments`) bucket is also provisioned
automatically; the workload service account is granted access.

- **Console:** Filestore → Instances for the NFS share; Cloud Storage → Buckets for
  the attachments bucket.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<attachments-bucket>/    # bucket name is in the Outputs
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### D. Redis cache and job queue

Redis is mandatory for Zammad and serves two critical roles:

1. **ActionCable pub/sub** — delivers real-time ticket updates to agents across
   multiple pods.
2. **Sidekiq** — processes background jobs (email dispatch, SLA notifications,
   LDAP sync, scheduler tasks).

When no external `redis_host` is configured and NFS is enabled, the NFS host IP is
used as the Redis endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  redis-cli -h <redis-host> client list    # active Sidekiq/ActionCable connections
  ```

### E. Secret Manager

The database password is stored as a Secret Manager secret and injected into pods at
runtime; plaintext never appears in configuration. Zammad manages its own internal
signing keys at startup — no application-level secret is auto-generated.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
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

## 3. Zammad Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) runs before the
  application starts. It connects to Cloud SQL via the Auth Proxy and idempotently
  creates the Zammad database, user, and grants privileges. It is safe to re-run.
- **Migrations on every start.** The custom `entrypoint.sh` calls `zammad-init`
  (Rails DB migration + seed) before starting the railsserver on every pod start.
  Pending migrations are applied; already-run ones are skipped.
- **Variable bridging.** The Foundation module injects database credentials as
  `DB_HOST`, `DB_USER`, `DB_PASSWORD`, etc. The custom `entrypoint.sh` maps these
  to Zammad's `POSTGRESQL_*` convention at runtime.
- **WebSocket connectivity.** Zammad agents receive live ticket updates via
  ActionCable WebSockets. With multiple replicas, Redis pub/sub coordinates events
  across pods — this is why `enable_redis = true` is mandatory for production.
- **Health path.** Both startup and liveness probes target `/api/v1/ping`, which
  returns HTTP 200 only when Zammad is fully initialised. The startup probe allows
  a generous tolerance (60-second initial delay, up to 30 retries) to accommodate
  first-boot schema migration.
- **Email integration.** Zammad sends email notifications for ticket events and
  password resets. Configure SMTP after first login at **Admin → Channels → Email**.
  SMTP credentials can be injected as secret environment variables.
- **Inspect running jobs:**
  ```bash
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  kubectl get cronjobs -n "$NAMESPACE"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Zammad are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |
| `elasticsearch_url` | `""` | Elasticsearch HTTP endpoint for full-text search. Leave empty to disable. |
| `elasticsearch_username` | `""` | Elasticsearch username. Leave empty when security is disabled. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `zammad` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Zammad Helpdesk` | Friendly name shown in the Console. |
| `application_description` | `Zammad Open-source Helpdesk on GKE Autopilot` | Workload description annotation. |
| `application_version` | `6.4.1` | Zammad image version tag; increment to roll out a new build. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds via Cloud Build (required for the GCP entrypoint); `prebuilt` skips the build. |
| `container_image` | `""` | Override container image URI. Leave empty for Cloud Build to manage. |
| `container_resources` | `{ cpu_limit: "2000m", memory_limit: "4Gi" }` | CPU/memory limits and optional requests. Validated at plan time. |
| `container_port` | `3000` | Zammad railsserver port. Must match `ZAMMAD_RAILSSERVER_PORT`. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 so agents avoid long cold starts. |
| `max_instance_count` | `5` | Maximum replicas (autoscaler ceiling). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar. Do not disable. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |
| `enable_image_mirroring` | `true` | Mirrors the Zammad Docker Hub image into Artifact Registry before deploy. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core `POSTGRESQL_*` and `RAILS_*` values are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g. for SMTP passwords). |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing required for WebSocket session continuity. |
| `workload_type` | `null` | Auto-resolves to StatefulSet when per-pod storage is enabled. |
| `network_tags` | `['nfsserver']` | Node/pod tags; `nfsserver` is required for NFS connectivity. |
| `termination_grace_period_seconds` | `60` | Kubernetes waits this long after SIGTERM before forcibly stopping the container. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enables PVC templates; automatically selects StatefulSet workload type. |
| `stateful_pvc_size` | `10Gi` | Storage size for each StatefulSet PVC. |
| `stateful_pvc_mount_path` | `/data` | Container path where the per-pod PVC is mounted. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |

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
| `enable_topology_spread` | `false` | Spread pods across zones for zone-failure resilience. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | `/api/v1/ping`, 60s delay, 30 retries | Generous tolerance for schema migration on first boot. |
| `liveness_probe` / `health_check_config` | `/api/v1/ping`, 60s delay | Restarts the container after 3 consecutive failures. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. Non-empty list replaces it entirely. |
| `cron_jobs` | `[]` | Scheduled CronJobs — Zammad handles its own internal scheduling; add custom maintenance jobs here. |
| `additional_services` | `[]` | Sidecar or helper GKE services deployed alongside Zammad. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for Zammad attachment storage (keep enabled). |
| `nfs_mount_path` | `/opt/zammad/storage` | Mount path inside the container. Must match Zammad's storage configuration. |
| `nfs_volume_name` | `nfs-data-volume` | Kubernetes volume name for the NFS mount. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision additional GCS buckets. The `zammad-attachments` bucket is always created. |
| `storage_buckets` / `gcs_volumes` | _(set)_ | Additional buckets / GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 15 — Redis Cache & Job Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Required.** Use Redis for ActionCable and Sidekiq. |
| `redis_host` | `""` | Leave empty to use the NFS host IP; set explicitly for Memorystore or a dedicated Redis server. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — do not change. Zammad requires PostgreSQL. |
| `application_database_name` | `zammad` | Database name. Immutable after first deploy. |
| `application_database_user` | `zammad` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_postgres_extensions` / `postgres_extensions` | off / `[]` | Install additional PostgreSQL extensions after provisioning. |
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
| `enable_custom_domain` | `true` | Provision Kubernetes Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Zammad. |
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
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Zammad. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (including `zammad-attachments`). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
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
| `database_type` | `POSTGRES_15` | Critical | Zammad requires PostgreSQL; MySQL is rejected at plan time. |
| `container_image_source` | `custom` (default) | Critical | Using `prebuilt` without the custom entrypoint means `DB_*` → `POSTGRESQL_*` mapping does not happen and all database connections fail on startup. |
| `enable_cloudsql_volume` | `true` | Critical | Disabling removes the Auth Proxy socket; all database connections fail. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all helpdesk data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job; enabling on every apply overwrites live data. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all scheduling. |
| `enable_redis` | `true` | Critical | Without Redis, ActionCable and Sidekiq fail to initialise; Zammad will not start. |
| `redis_host` | explicit or NFS IP | Critical | Empty with NFS disabled means no valid Redis endpoint — Zammad fails to start. |
| `container_resources.memory_limit` | `4Gi` | High | Zammad OOMs during schema migration or under load below 2 GiB. |
| `nfs_mount_path` | `/opt/zammad/storage` | High | Changing this causes attachments to be written to ephemeral pod storage; existing NFS attachments become inaccessible. |
| `enable_nfs` | `true` | High | Without NFS, all uploaded attachments are lost on pod restart or rolling update. |
| `min_instance_count` | `1` | High | `0` causes 60–90-second cold starts for the first agent to open a ticket. |
| `session_affinity` | `ClientIP` | High | Without stickiness and without Redis, multi-replica WebSocket sessions lose real-time updates. |
| `stateful_pvc_enabled = true` with `workload_type = "Deployment"` | avoid | High | This combination fails at plan time. |
| `startup_probe.initial_delay_seconds` | `60` (or higher) | High | Too short causes restart loops on first boot while schema migration is running. |
| `max_instance_count` > 1 without Redis | configure Redis first | Medium | Multiple pods without Redis cause race conditions on ticket assignment and real-time state divergence. |
| `enable_topology_spread` | enable for multi-replica | Medium | Without spread, all pods may land in one zone; a zone failure takes down the helpdesk. |
| `enable_iap` / `enable_cloud_armor` | enable for admin-facing | Medium | The Zammad admin UI is otherwise publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Zammad-specific application configuration shared with the
Cloud Run variant is described in **[Zammad_Common](Zammad_Common.md)**.
