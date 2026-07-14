---
title: "Kestra on GKE Autopilot"
description: "Configuration reference for deploying Kestra on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Kestra on GKE Autopilot

Kestra is an open-source data orchestration platform (Apache 2.0) for building, scheduling,
and monitoring ETL/ELT pipelines, batch jobs, and workflow automation through declarative
YAML-based flow definitions and a 500+ plugin ecosystem. This module deploys Kestra on
**GKE Autopilot** in standalone mode on top of the [App_GKE](App_GKE.md) foundation, which
provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Kestra uses and how to explore and operate them from
the Google Cloud Console and the command line. For the mechanics common to every GKE
application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Kestra runs as a Java/JVM container in standalone mode (server, worker, and scheduler in a
single container). The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Java/JVM pod, 2 vCPU / 4 GiB by default, single-replica standalone mode |
| Database | Cloud SQL for PostgreSQL 15 | Required — stores queue, repository, and execution history |
| Object storage | Cloud Storage | Dedicated GCS bucket for flows, executions, and artifacts |
| Secrets | Secret Manager | Auto-generated Kestra admin password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** Kestra uses PostgreSQL for both its internal queue and flow
  repository. MySQL is not supported.
- **Standalone mode runs all components in one container.** Keep `max_instance_count = 1`
  to avoid conflicting queue-lock state across replicas.
- **Java JVM cold start is slow.** The default startup probe allows up to ~14 minutes
  (30s initial delay + 20s period × 40 retries). Keep `min_instance_count = 1` in
  production so scheduled triggers are never missed during cold starts.
- **Redis is not used.** Kestra uses PostgreSQL for queuing in standalone mode.
- **Session affinity is `ClientIP`.** Required for the Kestra UI's persistent log-streaming
  connection — requests from the same browser must reach the same pod.
- **The admin password is auto-generated** and stored in Secret Manager; it is never set
  in plain text.
- **A GCS storage bucket is always provisioned** for flows, executions, and artifacts; its
  name is injected as `KESTRA_STORAGE_GCS_BUCKET` automatically.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Kestra workload

Kestra pods are scheduled on Autopilot, which bills for the CPU/memory the pods actually
request. By default a single replica handles all orchestration components (server, worker,
scheduler) in one pod.

- **Console:** Kubernetes Engine → Workloads → select the Kestra workload to see pods,
  events, and status. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Kestra stores all workflow state — flow definitions, execution history, triggers, namespaces,
and the internal task queue — in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it
through the **Cloud SQL Auth Proxy** sidecar over a TCP socket at `127.0.0.1:5432`
(no public IP is exposed). On first deploy an initialization job creates the Kestra database,
user, and grants required privileges.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the password
are all surfaced in the [Outputs](#5-outputs). For the connection model, automated backups,
and password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Storage

A dedicated **Cloud Storage** bucket is provisioned for Kestra's GCS artifact storage backend.
All flow executions, task inputs/outputs, and internal storage objects are written here. The
bucket name is injected into every pod as `KESTRA_STORAGE_GCS_BUCKET`. Additional buckets or
GCS Fuse volumes can be mounted for flow data access.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<kestra-storage-bucket>/        # bucket name in Outputs
  # Confirm a GCS Fuse volume is mounted inside a pod (if configured):
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i fuse
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### D. Secret Manager

The Kestra admin password is stored as a Secret Manager secret and injected into pods at
runtime; plain text never appears in configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<admin-password-secret> --project "$PROJECT"
  ```

The admin password secret is named `<resource_prefix>-admin-password`. The database password
secret name is in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the
Secret Store CSI integration and rotation.

### E. Networking & ingress

The workload is exposed through an external Cloud Load Balancing IP. `enable_custom_domain`
defaults to `true`, provisioning a Kubernetes Gateway with a Google-managed certificate for
the hostnames in `application_domains`; a static IP is reserved by default so the address
survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud Monitoring.
Health probes target Kestra's `/health` endpoint. Optional uptime checks and alert policies
are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Kestra Application Behaviour

- **First-deploy database setup.** An initialization job (`db-init`) uses `postgres:15-alpine`
  to connect through the Cloud SQL Auth Proxy and idempotently creates the Kestra database and
  user, grants privileges, and resets the public schema so Flyway can apply all migrations
  cleanly on a fresh Cloud SQL instance. The job signals the proxy to shut down cleanly
  when done.
- **Flyway migrations on start.** Kestra runs its own Flyway-based schema migrations on every
  startup. The `FLYWAY_DATASOURCES_POSTGRES_BASELINE_ON_MIGRATE=true` setting prevents failures
  on Cloud SQL, which pre-populates the public schema with extension objects. Upgrading the
  `application_version` applies schema changes automatically.
- **JDBC socket bridge.** On GKE the Cloud SQL Auth Proxy sidecar already listens on TCP
  `127.0.0.1:5432`, so the `entrypoint.sh` JDBC bridge logic is skipped automatically — no
  `socat` bridge is needed here (unlike the Cloud Run variant).
- **Health endpoint.** Startup and liveness probes target `GET /health` on port 8080.
  Kestra (Java JVM) has a slow startup; the default probe allows up to ~14 minutes before
  declaring failure.
- **Session affinity.** The Kestra UI streams execution logs over a persistent connection.
  `session_affinity = "ClientIP"` routes all requests from the same browser to the same pod,
  preventing log-stream disconnections.
- **Termination grace period.** Set to 60 seconds (up from the Kubernetes default) to allow
  in-flight task executions to complete gracefully before the pod is forcibly terminated.
- **Admin login.** The initial admin username is `admin`. The password is retrieved from
  Secret Manager (see §2.D).
- **Scheduled triggers.** Kestra's internal scheduler processes flow-defined triggers (cron,
  interval, webhook). As long as one pod is running, all triggers fire on schedule. Setting
  `min_instance_count = 0` causes missed triggers during cold-start periods.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Kestra are listed; every other input is inherited from
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
| `application_name` | `kestra` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Kestra image version tag; increment to roll out a new version (e.g. `0.17.0`). |
| `display_name` | `Kestra Data Orchestration` | Friendly name shown in the Console and platform UI. |
| `description` | `Kestra Data Orchestration - ETL/ELT pipeline and workflow orchestration on GKE Autopilot` | Workload description annotation. |
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `2000m` | CPU per pod; 2 vCPU minimum recommended for Kestra JVM. |
| `memory_limit` | `4Gi` | Memory per pod; 4 GiB recommended (minimum 2 GiB). |
| `container_port` | `8080` | Kestra/Micronaut server port. Must match `MICRONAUT_SERVER_PORT`. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 so scheduled triggers are never missed. |
| `max_instance_count` | `1` | Maximum replicas. Keep at 1 for standalone mode to avoid queue conflicts. |
| `timeout_seconds` | `300` | Maximum request duration in seconds (0–3600). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for TCP socket connections to PostgreSQL. |
| `enable_image_mirroring` | `true` | Mirror the Kestra image into Artifact Registry before deploy. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |
| `termination_grace_period_seconds` | `60` | Seconds Kubernetes waits after SIGTERM — allows in-flight executions to finish. |
| `deployment_timeout` | `1800` | Max seconds Terraform waits for the rollout to complete (large Java image). |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core Kestra vars are injected automatically; do not override them here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g. `{ KESTRA_ENCRYPTION_SECRET = "kestra-enc-key" }`). |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation (0–300). |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification period. |
| `enable_auto_password_rotation` | `false` | Automated zero-downtime database password rotation. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before restarting pods. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing required for Kestra UI log streaming. |
| `workload_type` | `null` | Auto-resolves to StatefulSet when per-pod storage is enabled; otherwise Deployment. |
| `gke_cluster_name` | `""` | Leave empty to auto-discover the Services_GCP-managed cluster. |
| `namespace_name` | `""` | Leave empty to auto-generate from application name and tenant ID. |
| `network_tags` | `["nfsserver"]` | Node/pod tags for VPC firewall rules. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |
| `configure_service_mesh` | `false` | Enable Istio injection for the application namespace. |

### Group 7 — StatefulSet

Only relevant when `workload_type = "StatefulSet"` or `stateful_pvc_enabled = true`.

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable a PVC per pod for local plugin storage or temporary execution files. |
| `stateful_pvc_size` | `10Gi` | Storage size for each PVC. Immutable after creation — plan capacity in advance. |
| `stateful_pvc_mount_path` | `/app/storage` | Container path where the PVC is mounted. |
| `stateful_pvc_storage_class` | `""` | Kubernetes StorageClass; empty uses cluster default. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades (default `true` for Kestra). |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |
| `enable_topology_spread` | `false` | Spread pods across zones (relevant only when `max_instance_count > 1`). |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, 30s delay, period 20s, 40 failures | Application startup probe — allows up to ~14 minutes for JVM startup. |
| `liveness_probe` | HTTP `/health`, 180s delay, period 30s, 5 failures | Application liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. Provide a non-empty list to replace it entirely. |
| `cron_jobs` | `[]` | Kubernetes CronJobs for scheduled auxiliary tasks (e.g. backups). |
| `additional_services` | `[]` | Sidecar or helper GKE services deployed alongside Kestra. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Provision a Cloud Filestore (NFS) share and mount it into pods. Useful for flow scripts that write local files. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision additional buckets in `storage_buckets`. The Kestra storage bucket is always created. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the built-in storage bucket. |
| `gcs_volumes` | `[]` | GCS buckets to mount via GCS Fuse CSI Driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `kestra` | PostgreSQL database name. **Immutable after first deploy.** |
| `db_user` | `kestra` | Application user. **Immutable after first deploy.** |
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
| `enable_custom_domain` | `true` | Provision Kubernetes Gateway with SSL certificate for custom hostnames. |
| `application_domains` | `[]` | Hostnames to serve. Empty with `enable_custom_domain = true` generates a `nip.io` domain. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. Recommended for production. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Kestra. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

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

These values are returned on a successful deployment and are the quickest way to locate and
explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Kestra. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (includes the Kestra storage bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | GitHub repo details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. `false` on first apply of a new inline cluster. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `db_name` | `kestra` — set once | Critical | Immutable after first deploy; changing it connects Kestra to an empty database, losing all flows, execution history, triggers, and namespaces. |
| `application_name` | `kestra` — set once | Critical | Immutable after first deploy; changing it renames all GCP/Kubernetes resources, causing full recreation with data loss. |
| `KESTRA_BASICAUTH_ENABLED` (injected `true`) | leave as injected | Critical | Overriding to `false` exposes the full Kestra UI and REST API without authentication. Only disable behind a trusted auth proxy (IAP, Cloud Armor). |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `max_instance_count` | `1` | High | Kestra Community Edition uses PostgreSQL queue locking — multiple replicas cause task double-assignment and execution conflicts. |
| `min_instance_count` | `1` | High | Setting to `0` causes scheduled triggers to be missed during cold-start periods. Kestra JVM startup can take several minutes. |
| `memory_limit` | `4Gi` | High | Values below 2 GiB cause JVM OutOfMemoryErrors under concurrent execution load. |
| `enable_cloudsql_volume` | `true` | High | Required for PostgreSQL connectivity; blocked at plan time when `database_type != "NONE"`. |
| `KESTRA_QUEUE_TYPE` / `KESTRA_REPOSITORY_TYPE` (injected `postgres`) | leave as injected | High | Only PostgreSQL is provisioned; overriding to an unsupported backend type causes startup failure. |
| `KESTRA_STORAGE_TYPE` (injected `gcs`) | leave as injected | High | Changing to `local` causes all execution artifacts to write to ephemeral pod storage and be lost on restart. |
| `startup_probe` failure threshold | 40 (default) | High | Reducing below ~10 causes premature pod restarts on slow JVM startups before Kestra has finished loading all flows. |
| `session_affinity` | `ClientIP` | Medium | Without stickiness, Kestra UI log-streaming connections disconnect when routed to a different pod. |
| `termination_grace_period_seconds` | `60` | Medium | Values below 30 s abort in-flight task executions mid-run. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling PDB allows GKE to evict the Kestra pod during node maintenance, interrupting all running executions. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are treated as bytes by Kubernetes and block all scheduling in the namespace. |
| `enable_iap` / `enable_cloud_armor` | enable for admin-facing | Medium | The Kestra UI and API are otherwise publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention requirements. |
| `organization_id` | set when using VPC-SC | Medium | If empty, VPC Service Controls are silently skipped. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity, autoscaling,
ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups,
and image mirroring — see **[App_GKE](App_GKE.md)**. Kestra-specific application
configuration shared with the Cloud Run variant is described in
**[Kestra_Common](Kestra_Common.md)**.
