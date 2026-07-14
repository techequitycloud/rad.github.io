---
title: "Vikunja on GKE Autopilot"
description: "Configuration reference for deploying Vikunja on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Vikunja on GKE Autopilot

Vikunja is an open-source, self-hosted to-do and project management application —
lists, kanban boards, gantt charts, calendars, reminders, and team sharing via a
REST API and web UI. This module deploys Vikunja on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Vikunja uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

Vikunja runs as a Go web workload. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Go pod, 1 vCPU / 512 MiB by default, single replica |
| Database | Cloud SQL for PostgreSQL 15 | Required — Vikunja does not support MySQL in this module |
| Container build | Cloud Build + Artifact Registry | Wraps the `scratch` upstream image with a grafted busybox |
| Secrets | Secret Manager | Auto-generated `VIKUNJA_SERVICE_JWTSECRET`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup.
- **The pod connects to Cloud SQL over the proxy loopback with `sslmode=disable`.**
  On GKE the Cloud SQL Auth Proxy sidecar listens on `127.0.0.1` (plaintext), so the
  entrypoint disables SSL. The same entrypoint requires SSL over the private IP on
  Cloud Run — it branches on whether the resolved host is loopback.
- **The image is `scratch`-based and gets a busybox graft.** The upstream
  `vikunja/vikunja` image has no shell, so the custom build copies in a static
  busybox to run the entrypoint. `container_image_source` defaults to `"custom"`.
- **`VIKUNJA_SERVICE_JWTSECRET` is generated automatically** and stored in Secret
  Manager. Rotating it after first boot invalidates all active user sessions.
- **Single replica by default** (`min_instance_count = 1`, `max_instance_count = 1`)
  with `session_affinity = None`. Vikunja has no built-in multi-replica coordination.
- **A PodDisruptionBudget keeps the pod serving** through node upgrades.
- **NFS is disabled by default.** Vikunja stores data in PostgreSQL; enable NFS only
  if you need durable file attachments at `/app/vikunja/files`.
- **A custom domain + static IP are enabled by default** (`enable_custom_domain = true`,
  `reserve_static_ip = true`) so the external address survives redeploys.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Vikunja workload

Vikunja pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request.

- **Console:** Kubernetes Engine → Workloads → select the Vikunja workload to see
  pods and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe deploy -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Vikunja stores all application data (tasks, projects, boards, users, teams) in a
managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately through the
**Cloud SQL Auth Proxy** sidecar over loopback (`127.0.0.1`, `sslmode=disable`); no
public IP is exposed. On first deploy an initialization Job creates the application
database and user.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are all surfaced in the
[Outputs](#5-outputs). For the connection model, automated backups, and password
rotation, see [App_GKE](App_GKE.md).

### C. Cloud Build & Artifact Registry

Because the upstream Vikunja image is `scratch`-based, the module builds a wrapper
image via Cloud Build (grafting in a static busybox and the entrypoint) and pushes
it to Artifact Registry. App_GKE forces `imagePullPolicy=Always` for the custom
image so a rebuild-redeploy always pulls fresh layers.

- **Console:** Cloud Build → History; Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --project "$PROJECT"
  ```

### D. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager:
`VIKUNJA_SERVICE_JWTSECRET` (used to sign user session JWTs). The database password
is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Cloud Storage & file attachments (optional)

Vikunja stores file attachments on the pod filesystem at `/app/vikunja/files`.
Enable NFS and mount it over that path for durable attachments; the module declares
no dedicated GCS bucket by default. NFS-backed GKE apps deploy with the `Recreate`
strategy to avoid two pods contending for the same volume.

- **Console:** Filestore / Compute Engine (NFS VM) when `enable_nfs = true`.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP.
A custom domain with a Google-managed certificate can be enabled, and a static IP
is reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

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

## 3. Vikunja Application Behaviour

- **First-deploy database setup.** An initialization Job runs `create-db-and-user.sh`
  using `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and
  idempotently creates the application database and role and grants privileges. The
  job is safe to re-run.
- **Schema migrations on start.** Vikunja applies its own schema migrations
  automatically on the first application startup — the `db-init` job only provisions
  an empty database, so allow extra time on the first pod to become Ready.
- **`VIKUNJA_SERVICE_JWTSECRET` is immutable after first boot.** It is generated once
  and written to Secret Manager. Changing it invalidates all active user sessions.
  Only rotate during a planned maintenance window.
- **First registered account becomes the owner.** Vikunja ships no pre-seeded admin.
  Open the external URL and register — the first account owns the instance. Then set
  `VIKUNJA_SERVICE_ENABLEREGISTRATION = "false"` in `environment_variables`.
- **Health path.** Startup and liveness probes target `/health` — a public,
  unauthenticated endpoint that returns 200 once the server binds its port.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Vikunja are listed; every other input is
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
| `application_name` | `vikunja` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Vikunja` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Vikunja image version tag; `latest` builds a pinned recent release (`2.3.0`). |
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `custom` | Builds the busybox-grafted wrapper via Cloud Build. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | CPU/memory limits and requests. |
| `container_port` | `3456` | Port Vikunja's Go server listens on. |
| `min_instance_count` | `1` | Minimum replicas. |
| `max_instance_count` | `1` | Single replica — Vikunja has no multi-replica coordination. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar (loopback `127.0.0.1`). |
| `enable_image_mirroring` | `true` | Mirror the wrapper image into Artifact Registry. |
| `workload_type` | `Deployment` | Stateless Deployment (StatefulSet not needed — state is in PostgreSQL). |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra `VIKUNJA_*` settings. Do not set `VIKUNJA_DATABASE_*` or `VIKUNJA_SERVICE_JWTSECRET` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `session_affinity` | `None` | Sticky routing (`ClientIP`) or `None`. |
| `network_tags` | `[]` | Node/pod network tags for firewall rule targeting. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |

### Group 7 — StatefulSet

`stateful_pvc_enabled`, `stateful_pvc_size`, `stateful_pvc_mount_path`,
`stateful_pvc_storage_class`, `stateful_headless_service`,
`stateful_pod_management_policy`, `stateful_update_strategy` — StatefulSet PVC
templates. Not recommended for Vikunja; state lives in PostgreSQL.

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health`, 30s delay, 30 × 10s failure window | Startup probe; wide retry window for first-boot migrations. |
| `health_check_config` | HTTP `/health`, 30s delay | Liveness probe. |
| `uptime_check_config` | disabled, path `/health` | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs. |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside Vikunja. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Enable for durable file attachments at `/app/vikunja/files`. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create additional GCS buckets. |
| `storage_buckets` | `[]` | Vikunja declares no bucket by default. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts via the CSI driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` | `7` | Maximum recent Artifact Registry images to keep. |
| `delete_untagged_images` | `true` | Automatically delete untagged images. |
| `image_retention_days` | `30` | Days after which images are eligible for deletion. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Cloud SQL engine; fixed to PostgreSQL 15 by `Vikunja_Common`. |
| `application_database_name` | `vikunja` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `vikunja` | Application database user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before rolling-restarting pods. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated Cloud SQL backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
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
| `service_url` | URL to reach Vikunja. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
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
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD GitHub details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `StatefulSet`/`Deployment` mismatch, memory quota values without binary suffixes, an out-of-range `container_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `VIKUNJA_SERVICE_JWTSECRET` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates all active user sessions, forcing immediate re-login for everyone. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `enable_nfs` (for attachments) | `true` if attachments matter | High | Without NFS, file attachments live on the pod's ephemeral disk and are lost on every pod restart. |
| `container_image_source` | `custom` | High | `prebuilt` deploys the raw `scratch` image with no shell/entrypoint mapping — the container cannot map `DB_*` and fails. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity; disabling it is blocked by a plan-time validation guard. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects invalid values. |
| `VIKUNJA_SERVICE_ENABLEREGISTRATION` (env var) | `"false"` after first admin | High | Leaving registration open allows anyone with the URL to create an account. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict the pod during maintenance with no availability guard. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Vikunja-specific application configuration shared
with the Cloud Run variant is described in
**[Vikunja_Common](Vikunja_Common.md)**.
