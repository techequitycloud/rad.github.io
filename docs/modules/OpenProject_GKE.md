---
title: "OpenProject on GKE Autopilot"
description: "Configuration reference for deploying OpenProject on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# OpenProject on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenProject_GKE.png" alt="OpenProject on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

OpenProject is an open-source, GPLv3-licensed project-management and team-collaboration
suite — work packages, Gantt timelines, agile boards, wikis, time tracking, and
budgets. This module deploys OpenProject on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services OpenProject uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

OpenProject runs as a Ruby on Rails (Puma) web workload. The deployment wires together
a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Rails/Puma pods, 2 vCPU / 4 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — OpenProject does not support MySQL or other engines |
| Attachment storage | Cloud Filestore (NFS) | Durable work-package attachment storage, mounted at `/opt/openproject/storage` |
| Secrets | Secret Manager | Auto-generated `SECRET_KEY_BASE`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |
| Background jobs | good_job (in-process, on PostgreSQL) | No Redis — the job queue lives in PostgreSQL |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup.
- **Cloud SQL Auth Proxy sidecar.** `enable_cloudsql_volume = true` on GKE. The proxy
  listens on `127.0.0.1` and the entrypoint's loopback branch composes `DATABASE_URL`
  without SSL (the proxy terminates TLS).
- **No Redis.** Background jobs run through `good_job` with the queue in PostgreSQL
  (`GOOD_JOB_EXECUTION_MODE = async`); `enable_redis` is forwarded as `false`.
- **`SECRET_KEY_BASE` is generated automatically** and stored in Secret Manager. It
  must never be rotated after first boot — rotating it makes every existing session
  and all encrypted database columns unreadable.
- **Migrations run in a `db-migrate` job, not on boot.** The workload runs web-only
  (`./docker/prod/web`); a dedicated apply-time job runs `rake db:migrate db:seed`
  first, so pods boot fast against a migrated schema.
- **Both health probes are TCP.** Rails 8 Host Authorization `400`s any HTTP probe
  whose `Host` header is the pod IP, so a TCP probe (Puma port-listening) is used for
  both startup and liveness. GKE supports a TCP liveness probe, so it stays enabled
  (unlike Cloud Run).
- **Session affinity is `ClientIP`** and a minimum of 1 replica is maintained (GKE has
  no scale-to-zero); a PodDisruptionBudget keeps pods serving through node upgrades.
- **NFS-backed rollouts use the `Recreate` strategy** to avoid two pods writing the
  same attachment volume during an update.
- **The first login is `admin` / `admin`.** OpenProject forces a password change on the
  first sign-in — do it immediately.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the OpenProject workload

OpenProject pods are scheduled on Autopilot, which bills for the CPU/memory the
pods actually request. Horizontal Pod Autoscaling sizes the deployment between the
minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the OpenProject workload to
  see pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
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

OpenProject stores all application data (projects, work packages, wikis, users) in a
managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately through the
**Cloud SQL Auth Proxy** sidecar over the `127.0.0.1` loopback; no public IP is
exposed. On first deploy the `db-init` job creates the database and user, and the
`db-migrate` job runs `rake db:migrate db:seed`.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Filestore (NFS attachment storage)

Work-package attachments are stored on a **Cloud Filestore** NFS share mounted at
`/opt/openproject/storage` (`enable_nfs = true` by default). This keeps attachments
durable and shared across pods.

- **Console:** Filestore → Instances.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc,pv -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager:
`SECRET_KEY_BASE` (Rails session/cookie signing and encrypted-column key derivation).
The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`). A custom domain with a Google-managed certificate can
be enabled, and a static IP can be reserved so the address survives redeploys.
OpenProject builds absolute URLs from `OPENPROJECT_HOST__NAME` and
`OPENPROJECT_HTTPS = true`.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. OpenProject Application Behaviour

- **Two-phase first-deploy database setup.** The `db-init` job (`postgres:15-alpine`)
  creates the role and database; the `db-migrate` job then runs the app image with
  `rake db:migrate db:seed`. The migrate job drops any partial tables from an
  interrupted prior attempt (`DROP OWNED BY CURRENT_USER CASCADE`) before migrating,
  and creates the `pg_trgm` extension needed by OpenProject's trigram indexes.
- **Migrations do not run on boot.** The workload runs web-only (`./docker/prod/web`),
  which skips the all-in-one seeder. Rails (production) refuses to boot Puma while
  migrations are pending, so if `db-migrate` fails the apply fails loudly on the
  pending-migration guard — there is no silent empty-DB ship.
- **`SECRET_KEY_BASE` is immutable after first boot.** It is generated once and stored
  in Secret Manager. Changing it makes existing sessions and all encrypted columns
  unreadable. Only rotate during a planned maintenance window.
- **Background jobs run in-process.** `good_job` runs its worker and cron inside each
  pod (`GOOD_JOB_EXECUTION_MODE = async`) with the queue on PostgreSQL — no Redis.
- **Host Authorization gates health probes.** Rails 8 returns `400 Invalid host_name`
  to any request whose `Host` header is not `OPENPROJECT_HOST__NAME`, including the
  kubelet's HTTP health probes (which use the pod IP). Both the startup and liveness
  probes are therefore TCP; the readiness probe hits `/health_checks/default`.
- **First login is `admin` / `admin`.** Seeded by `rake db:seed`. OpenProject forces a
  password change on first sign-in.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for OpenProject are listed; every other input is
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
| `application_name` | `openproject` | Base name for resources. Do not change after first deploy. |
| `display_name` | `OpenProject` | Human-readable name shown in the Console. |
| `application_version` | `latest` | OpenProject image tag (`OPENPROJECT_VERSION`). `latest` is pinned to the stable major `16`; pin explicitly in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `min_instance_count` | `1` | Minimum replicas (GKE has no scale-to-zero). |
| `max_instance_count` | `5` | Maximum replicas (HPA upper bound). |
| `container_port` | `80` | The all-in-one image serves on port 80. |
| `container_resources` | `2000m` / `4Gi` | CPU/memory limits and requests. Rails needs headroom for migrations and workers. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar (loopback connection). |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_image_mirroring` | `true` | Mirror the OpenProject image into Artifact Registry before deployment. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings (`OPENPROJECT_*` overrides). Do not set `SECRET_KEY_BASE` or `DATABASE_URL` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `null` (Deployment) | `Deployment` (default) or `StatefulSet`. |
| `session_affinity` | `ClientIP` | Sticky routing for UI sessions. |
| `network_tags` | `["nfsserver"]` | Node/pod network tags; `nfsserver` is required when `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Seconds to wait after SIGTERM before SIGKILL. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable PVC templates. Not required — attachments use NFS. |
| `stateful_pvc_size` | `10Gi` | Per-pod PVC storage size. |
| `stateful_pvc_mount_path` | `/data` | Container mount path for the PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |
| `enable_resource_quota` | `false` | Enforce a namespace ResourceQuota. |
| `quota_memory_requests` / `quota_memory_limits` | _(set)_ | Namespace memory quota — must use binary units (`4Gi`, `8192Mi`). |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | **TCP**, 30s delay, 30 × 15s window | TCP because Rails Host Authorization `400`s HTTP probes; checks Puma is listening. |
| `liveness_probe` | **TCP**, 90s delay | TCP so a healthy Puma stays alive (GKE supports TCP liveness). |
| `startup_probe_config` | _(set)_ | App_GKE-level infrastructure probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` + `db-migrate` jobs. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs. |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside OpenProject. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Cloud Filestore for durable attachment storage. |
| `nfs_mount_path` | `/opt/openproject/storage` | OpenProject attachment path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | One `data` bucket is declared by default; extend the list if you need more. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts via the CSI driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` | `7` | Maximum recent Artifact Registry images to keep. |
| `delete_untagged_images` | `true` | Automatically delete untagged images. |
| `image_retention_days` | `30` | Days after which images are eligible for deletion. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `application_database_name` | `openproject` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `openproject` | Application database user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before rolling-restarting pods. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate (a Gateway with a static IP is provisioned automatically). |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of OpenProject. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

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
| `service_url` | URL to reach OpenProject. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup (`db-init`, `db-migrate`) and (optional) import jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `Deployment` workload with `stateful_pvc_enabled = true`, a bare-integer `quota_memory_*`, an out-of-range `backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `SECRET_KEY_BASE` (auto-generated) | Never rotate after first boot | Critical | Rotating it makes every existing session and all encrypted database columns unreadable. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_nfs` | `true` | Critical | Disabling it puts attachments on ephemeral pod storage — they are lost when a pod is rescheduled. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `startup_probe.type` / `liveness_probe.type` | `TCP` | High | An HTTP probe hits Rails Host Authorization (`400 Invalid host_name`, Host = pod IP) and never passes — a healthy pod never becomes Ready, or a TCP-healthy pod restart-loops. |
| `enable_cloudsql_volume` | `true` on GKE | High | The Auth Proxy sidecar provides the loopback PostgreSQL connection; disabling it is blocked by a plan-time validation guard. |
| `memory_limit` (via `container_resources`) | `4Gi` | High | Migrations and in-process workers OOM below ~2 GiB. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects invalid values. |
| `session_affinity` | `ClientIP` | Medium | Without stickiness, UI sessions may route to different pods between requests. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict all pods simultaneously during maintenance — with NFS `Recreate`, this drops the service. |
| `application_version` | Pin a major (`16`) | Medium | `latest` has no image tag on Docker Hub; the module pins it to `16`. Pin explicitly to control upgrades. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. OpenProject-specific application configuration shared
with the Cloud Run variant is described in
**[OpenProject_Common](OpenProject_Common.md)**.
