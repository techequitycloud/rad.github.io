---
title: "Windmill on GKE Autopilot"
description: "Configuration reference for deploying Windmill on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Windmill on GKE Autopilot

Windmill is an open-source developer platform for building internal tools, scripts, flows, and automations. This module deploys Windmill on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Windmill uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Windmill runs as a combined server+worker workload. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Combined server+worker pods, 2 vCPU / 2 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 16 | Required — Windmill requires PostgreSQL 16 or later |
| Object storage | Cloud Storage | A `windmill-data` bucket for workflow outputs and artefacts |
| Secrets | Secret Manager | Auto-generated database password and SMTP placeholder secret |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 16 is required.** Windmill uses PostgreSQL-specific features; the database engine is fixed. Selecting an older version or `NONE` will cause the init job to fail.
- **Combined server+worker mode.** `MODE=server,worker` and `NUM_WORKERS=3` run the API server and script execution workers in the same pod. For independent worker scaling, define additional Kubernetes Deployments via `additional_services`.
- **`DISABLE_NSJAIL=true` is injected automatically.** GKE Autopilot does not grant `CAP_SYS_ADMIN` or user namespaces; Windmill's Linux namespace isolation is disabled accordingly.
- **Redis is disabled by default.** Windmill operates without Redis for single-replica deployments. Enable Redis for distributed queue behaviour with multiple replicas.
- **`session_affinity` is `None`.** Windmill's API is stateless and uses cookie-based authentication, so sticky routing is not required.
- **Health probes target `/api/version`.** This lightweight endpoint returns the Windmill version string when the service is ready — no startup migration delay is required.
- **An SMTP placeholder secret is provisioned automatically.** Replace the `{prefix}-smtp-password` value in Secret Manager before enabling email notifications.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Windmill workload

Windmill pods are scheduled on Autopilot, which bills for the CPU/memory the pods actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum and maximum replica counts. The default workload type is `Deployment`; set `stateful_pvc_enabled = true` to auto-select `StatefulSet` with per-pod persistent volumes.

- **Console:** Kubernetes Engine → Workloads → select the Windmill workload to see pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type (Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 16

Windmill stores all application data — scripts, flows, variables, resources, schedules, and job history — in a managed Cloud SQL for PostgreSQL 16 instance. Pods reach it privately through the **Cloud SQL Auth Proxy** sidecar over a Unix socket; no public IP is exposed. On first deploy an initialization Job idempotently creates the application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the password are all surfaced in the [Outputs](#5-outputs). For the connection model, automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Storage

A dedicated **Cloud Storage** bucket (`windmill-data`) is provisioned for workflow outputs, artefacts, and script dependencies. The workload service account is granted access automatically.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for additional bucket options, GCS Fuse mounts, and CMEK.

### D. Secret Manager

The database password and the SMTP placeholder password are stored as Secret Manager secrets and injected into pods at runtime; plaintext never appears in configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Replace the SMTP placeholder before enabling email features:
  echo -n "your-smtp-password" | gcloud secrets versions add \
    <smtp-secret-name> --data-file=- --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A custom domain with a Google-managed certificate can be enabled, and a static IP can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging in structured JSON format (`JSON_FMT=true`). GKE and Cloud SQL metrics flow to Cloud Monitoring. A Prometheus metrics endpoint is exposed at `:9001` for scraping within the VPC.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Windmill Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) runs on first deploy using `postgres:16-alpine`. It idempotently creates the `windmill_admin` and `windmill_user` roles, the application user, and the application database, then grants full privileges. The job is safe to re-run.
- **Automatic schema migrations.** Windmill runs its own database migrations on startup, so upgrading the `application_version` applies schema changes automatically.
- **Combined server+worker mode.** Each pod runs both the Windmill API/scheduler and `NUM_WORKERS=3` script execution workers. Workers execute Python, TypeScript, Bash, Go, and SQL scripts in isolated subprocesses. The `WORKER_GROUP=default` assignment means all flows and scripts route to these pods by default.
- **`BASE_URL` and `BASE_INTERNAL_URL`.** The `entrypoint.sh` shim constructs `DATABASE_URL` from platform-injected `DB_*` variables at start time. When `GKE_SERVICE_URL` is set (injected by App_GKE once the LoadBalancer IP is allocated), `BASE_URL` is updated automatically so OAuth callbacks and webhook URLs resolve correctly.
- **Prometheus metrics.** `METRICS_ADDR=:9001` exposes Windmill metrics at `http://<pod-ip>:9001/metrics` for scraping from within the cluster.
- **Health path.** Both startup and liveness probes use `GET /api/version`. This endpoint returns HTTP 200 with the version string when Windmill is ready to serve traffic.
- **SMTP email notifications.** The `WINDMILL_SMTP_PASS` secret is initialised with a 16-character placeholder. Replace it and supply `WINDMILL_SMTP_HOST`, `WINDMILL_SMTP_PORT`, and `WINDMILL_SMTP_FROM` via `environment_variables` to enable email notifications from flows and scripts.
- **Inspect scheduled flows and jobs:**
  ```bash
  kubectl get cronjobs -n "$NAMESPACE"
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for Windmill are listed; every other input is inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

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
| `application_name` | `windmill` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Windmill` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `latest` | Windmill image version tag; set to a specific release (e.g. `1.400.0`) for production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds with the bundled Dockerfile; `prebuilt` deploys an existing image URI. |
| `container_image` | `""` | Override image URI. Leave empty for Cloud Build to manage. |
| `cpu_limit` | `2000m` | CPU per pod. 2 vCPU is the recommended minimum for combined server+worker mode. |
| `memory_limit` | `2Gi` | Memory per pod. 4 GiB recommended for production Python/TypeScript workloads. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 so webhooks and scheduled flows have a pod to run on. |
| `max_instance_count` | `3` | Maximum replicas (autoscaler ceiling). |
| `container_port` | `8000` | Windmill listens on port 8000. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar — required for the Unix socket connection. |
| `enable_image_mirroring` | `true` | Mirror the Windmill image into Artifact Registry to avoid ghcr.io rate limits. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |
| `termination_grace_period_seconds` | `60` | Seconds to wait after SIGTERM; increase to let in-flight jobs finish gracefully. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings merged with Windmill defaults. Use to set `WINDMILL_SMTP_HOST`, `NUM_WORKERS` overrides, etc. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. `WINDMILL_SMTP_PASS` is injected automatically. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `None` | Windmill's API is stateless; sticky routing is not required. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true`. |
| `network_tags` | `['nfsserver']` | Node/pod tags for firewall rules. |
| `gke_cluster_name` | `""` | GKE cluster to use. Leave empty for auto-discovery. |
| `namespace_name` | `""` | Kubernetes namespace. Leave empty to auto-generate. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable PVC templates in a StatefulSet. Setting `true` auto-selects `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Storage size per PVC. |
| `stateful_pvc_mount_path` | `/data` | Container path where the PVC is mounted. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | `/api/version`, 10s period, 10 failures | HTTP probe against Windmill's version endpoint. |
| `health_check_config` | `/api/version`, 30s period, 3 failures | Liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` PostgreSQL job. |
| `cron_jobs` | `[]` | Recurring Kubernetes CronJobs for maintenance or integration tasks. |
| `additional_services` | `[]` | Sidecar or helper Deployments alongside Windmill (e.g. dedicated worker pools). |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see [App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is disabled by default — Windmill does not require shared file storage. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container when NFS is enabled. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the `windmill-data` bucket and any additional buckets. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the auto-provisioned data bucket. |
| `gcs_volumes` | `[]` | GCS Fuse mounts via the CSI driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_16` | Fixed — Windmill requires PostgreSQL 16. Do not change. |
| `db_name` | `windmill` | Database name. Immutable after first deploy. |
| `db_user` | `windmill` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before restarting pods. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See [App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `network_tags` | `['nfsserver']` | GKE node/pod tags for firewall rules. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Windmill. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 21 — Cloud Armor & Redis

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `enable_redis` | `false` | Enable Redis for distributed queue behaviour (optional). |
| `redis_host` | `""` | Redis endpoint. Leave blank and enable NFS for auto-discovery. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

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
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Windmill. |
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
| `kubernetes_ready` | Whether the cluster/workload is ready. `false` on the first apply of a new inline cluster; re-run apply to complete. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_16` | Critical | Windmill requires PostgreSQL 16; using an older version causes the init job to fail and the database to remain uninitialised. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all scripts, flows, and job history. |
| `enable_cloudsql_volume` | `true` | Critical | Windmill connects via the Auth Proxy Unix socket; disabling this causes immediate database failure and CrashLoopBackOff. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all scheduling. |
| `cpu_limit` | `2000m` | High | Combined mode runs 3 workers in-process; insufficient CPU throttles all script execution. Each worker needs ~500m. |
| `memory_limit` | `2Gi` | High | Windmill workers execute arbitrary user scripts; OOM kills mid-execution produce silent failures in the UI. |
| `min_instance_count` | `1` | High | `0` allows scale-to-zero; scheduled flows will be missed and webhooks return 503 until a pod is ready. |
| `service_url` / `BASE_URL` | load balancer IP or custom domain | High | Empty or incorrect value breaks OAuth callbacks, webhook endpoints, and Windmill UI deep-links. |
| `enable_redis` | `false` for single replica, `true` for multi | Medium | Without Redis, each pod processes only its own local queue; with multiple replicas this causes unpredictable job routing. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |
| `backup_schedule` | `0 2 * * *` | Medium | Empty string disables backups; Windmill stores all automation definitions in PostgreSQL. |
| `enable_iap` / `enable_cloud_armor` | enable for production | Medium | Without these, the Windmill UI and API are publicly reachable. |
| `WINDMILL_SMTP_*` (via env vars) | all fields set together | Medium | Partial SMTP configuration causes silent email delivery failures with no runtime error. |
| `enable_auto_password_rotation` | `false` | Medium | When enabled, pods must be restarted after rotation; otherwise they use an expired password until connections fail. |
| `enable_vpc_sc` | `false` unless needed | High | Requires explicit `organization_id`; without it VPC-SC is silently skipped, giving a false sense of perimeter security. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Windmill-specific application configuration shared with the Cloud Run variant is described in **[Windmill_Common](Windmill_Common.md)**.
