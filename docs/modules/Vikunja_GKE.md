---
title: "Vikunja on GKE Autopilot"
description: "Configuration reference for deploying Vikunja on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Vikunja on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Vikunja_GKE.png" alt="Vikunja on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

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
- **A PodDisruptionBudget keeps the pod serving** through node upgrades
  (`enable_pod_disruption_budget = true`).
- **NFS is disabled by default.** Vikunja stores data in PostgreSQL; enable NFS only
  if you need durable file attachments at `/app/vikunja/files`.
- **A custom domain + static IP are enabled by default** (`enable_custom_domain = true`,
  `reserve_static_ip = true`) so the external address survives redeploys.
- **A handful of Foundation variables are declared but inert.** `db_host_env_var_name`,
  `db_name_env_var_name`, `db_password_env_var_name`, `db_port_env_var_name`,
  `db_user_env_var_name`, `redis_auth`, `extra_service_ports`, `sql_instance_name`,
  `sql_instance_base_name`, `network_name`, `gke_cluster_selection_mode`,
  `prereq_gke_subnet_cidr`, `binauthz_evaluation_mode`, `explicit_secret_values`, and
  `scripts_dir` are mirrored into `variables.tf` purely to satisfy convention checks —
  this module's `main.tf` does not forward them, so setting them has no effect.

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
type (`Deployment` vs `StatefulSet`) are managed.

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
Enable NFS (`enable_nfs = true`) and mount it over that path for durable
attachments; the module declares no dedicated GCS bucket by default
(`storage_buckets = []`). NFS-backed GKE apps deploy with the `Recreate` strategy
to avoid two pods contending for the same volume.

- **Console:** Filestore / Compute Engine (NFS VM) when `enable_nfs = true`.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for CMEK options (`manage_storage_kms_iam`,
`enable_artifact_registry_cmek`) and GCS Fuse mounts (`gcs_volumes`).

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

Variables are grouped exactly as they appear on the deployment platform (the
`{{UIMeta group=N}}` tags in `variables.tf`). Only settings specific to or notable
for Vikunja are listed in each table; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 0 — Module Metadata

Standard platform metadata (`module_description`, `module_documentation`,
`module_dependency`, `requires_services`, `module_services`, `credit_cost`,
`require_credit_purchases`, `enable_purge`, `public_access`,
`require_services_gcp_module`, `shared_users`, `technical_support_users`,
`resource_creator_identity`, `impersonation_service_account`,
`job_execution_wait_timeout`) plus two variables declared but **not referenced** by
this module — `explicit_secret_values` and `scripts_dir`. `credit_cost` defaults to
`150`, higher than the Cloud Run variant.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `vikunja` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Vikunja` | Human-readable name shown in the Console. |
| `application_description` | `Vikunja task manager on GKE Autopilot` | Workload description. |
| `application_version` | `latest` | Vikunja image version tag; `latest` builds a pinned recent release (`2.3.0`). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Builds the busybox-grafted wrapper via Cloud Build. |
| `container_image` | `""` | Override image URI; leave empty for the auto-derived AR path. |
| `container_build_config` | `{ enabled = true }` | Dockerfile/context for the custom build. |
| `enable_image_mirroring` | `true` | Mirror the wrapper image into Artifact Registry. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Single replica — Vikunja has no multi-replica coordination. |
| `container_port` | `3456` | Port Vikunja's Go server listens on. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | CPU/memory limits and requests. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar (loopback `127.0.0.1`). |
| `workload_type` | `Deployment` | Stateless Deployment (StatefulSet not needed — state is in PostgreSQL). |

Also in this group, following standard App_GKE behaviour: `enable_vertical_pod_autoscaling`
(`false`), `container_protocol` (`http1`), `timeout_seconds` (`300`),
`cloudsql_volume_mount_path` (`/cloudsql`), `service_annotations` / `service_labels`
(`{}`).

### Group 5 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google identity auth before reaching Vikunja. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Identities granted access through IAP. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | OAuth 2.0 credentials. Required together when `enable_iap = true`. |
| `iap_support_email` | `""` | Support email on the IAP consent screen. |

### Group 6 — GKE Cluster, Networking & Environment Variables

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra `VIKUNJA_*` settings. Do not set `VIKUNJA_DATABASE_*` or `VIKUNJA_SERVICE_JWTSECRET` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `gke_cluster_name` | `""` | Target cluster; leave empty to auto-discover the `Services_GCP` cluster. |
| `namespace_name` | `""` | Kubernetes namespace; leave empty to auto-generate. |
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `session_affinity` | `None` | Sticky routing (`ClientIP`) or `None`. |
| `network_tags` | `[]` | Node/pod network tags for firewall rule targeting. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |

`gke_cluster_selection_mode` and `prereq_gke_subnet_cidr` are declared for
convention parity and are **not referenced**. `extra_service_ports` is declared but
**not forwarded** by this module, so setting it has no effect. Also in this group,
following standard App_GKE behaviour: `secret_rotation_period` (`2592000s`),
`secret_propagation_delay` (`30`), `enable_multi_cluster_service` (`false`),
`configure_service_mesh` (`false`), `termination_grace_period_seconds` (`30`),
`deployment_timeout` (`600`), and `prereq_subnet_cidr_override` (`""`, set only to
pin the inline VPC subnet CIDR on an existing deployment).

### Group 7 — Backups & StatefulSet Configuration

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated Cloud SQL backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |

`stateful_pvc_enabled`, `stateful_pvc_size`, `stateful_pvc_mount_path`,
`stateful_pvc_storage_class`, `stateful_headless_service`,
`stateful_pod_management_policy`, `stateful_update_strategy`, `stateful_fs_group` —
StatefulSet PVC templates. Not recommended for Vikunja; state lives in PostgreSQL.

### Group 8 — Resource Quota

`enable_resource_quota`, `quota_cpu_requests`, `quota_cpu_limits`,
`quota_memory_requests`, `quota_memory_limits` — namespace ResourceQuota. Memory
values require binary unit suffixes (e.g. `"4Gi"`).

### Group 9 — Custom SQL Scripts & Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |
| `enable_topology_spread` / `topology_spread_strict` | `false` | Distribute pods across zones. |

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — optional post-provisioning SQL script execution
against the database.

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health`, 30s delay, 30 × 10s failure window | Startup probe; wide retry window for first-boot migrations. |
| `health_check_config` | HTTP `/health`, 30s delay | Liveness probe. |
| `uptime_check_config` | disabled, path `/health` | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Workload Automation

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs. |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside Vikunja. |

### Group 12 — CI/CD, GitHub & Binary Authorization

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `github_app_installation_id`, `cicd_trigger_config`,
`enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`.
`binauthz_evaluation_mode` is declared for convention parity and is **not
referenced**.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Enable for durable file attachments at `/app/vikunja/files`. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `nfs_volume_name` | `nfs-data-volume` | Volume name for the mount. |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | Existing NFS VM to reuse, or the base name for an inline one. |

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

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Vikunja does not use Redis; provided for Foundation convention parity. |
| `redis_host` / `redis_port` | `""` / `6379` | Redis connection details, only meaningful if `enable_redis = true`. |

`redis_auth` is declared but **not forwarded** by this module, so setting it has no
effect.

### Group 16 — Database Configuration

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Cloud SQL engine; fixed to PostgreSQL 15 by `Vikunja_Common` regardless of this value. |
| `application_database_name` | `vikunja` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `vikunja` | Application database user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime database password rotation. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before restarting pods. |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Optional PostgreSQL extension installation. |

`enable_mysql_plugins` / `mysql_plugins` are not applicable to Vikunja (PostgreSQL
only). `sql_instance_name`, `sql_instance_base_name`, and the `db_*_env_var_name`
set (`db_host_env_var_name`, `db_name_env_var_name`, `db_password_env_var_name`,
`db_port_env_var_name`, `db_user_env_var_name`) are declared for convention parity
and are **not referenced/forwarded** by this module.

### Group 17 — Backup Import / Restore

`enable_backup_import`, `backup_source`, `backup_file`, `backup_format` — restore
the application database from a backup file on deploy.

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `static_ip_name` | `""` | Name for the static IP; leave empty to auto-generate. |

`network_name` is declared for convention parity and is **not referenced** (the
network is auto-discovered).

### Group 21 — Cloud Armor & CDN

`enable_cloud_armor`, `admin_ip_ranges`, `cloud_armor_policy_name`, `enable_cdn` —
attach a Cloud Armor WAF and Cloud CDN to the GKE Ingress backend.

### Group 22 — VPC Service Controls & Audit Logging

`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `organization_id`,
`enable_audit_logging` — enforce a VPC-SC perimeter and detailed Cloud Audit Logs.

All other inputs follow standard App_GKE behaviour.

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
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup source/file fails the import job. |
| `enable_nfs` (for attachments) | `true` if attachments matter | High | Without NFS, file attachments live on the pod's ephemeral disk and are lost on every pod restart. |
| `container_image_source` | `custom` | High | `prebuilt` deploys the raw `scratch` image with no shell/entrypoint mapping — the container cannot map `DB_*` and fails. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity; disabling it is blocked by a plan-time validation guard. |
| `min_instance_count` | `1` | Medium | The variable's own validation allows `0`–`1000` and there is no plan-time guard rejecting `0` — App_GKE's Deployment logic silently coerces `min_instance_count=0` to a `min_replicas` of `1` at apply time (`local.min_instance_count > 0 ? local.min_instance_count : 1`), so the deployed replica count silently diverges from what was configured rather than failing with an error. |
| `VIKUNJA_SERVICE_ENABLEREGISTRATION` (env var) | `"false"` after first admin | High | Leaving registration open allows anyone with the URL to create an account. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict the pod during maintenance with no availability guard. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `db_*_env_var_name`, `redis_auth`, `extra_service_ports`, `sql_instance_name`/`sql_instance_base_name`, `network_name`, `gke_cluster_selection_mode`, `prereq_gke_subnet_cidr`, `binauthz_evaluation_mode` | Leave at default | Low | Declared for Foundation convention parity but not forwarded/referenced by this module — setting them has no effect on the deployment. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Vikunja-specific application configuration shared
with the Cloud Run variant is described in
**[Vikunja_Common](Vikunja_Common.md)**.
