---
title: "Langfuse on GKE Autopilot"
description: "Configuration reference for deploying Langfuse on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Langfuse on GKE Autopilot

Langfuse is an open-source, MIT-licensed LLM engineering and observability platform —
tracing, prompt management, evaluations, and metrics for applications built on large
language models. This module deploys Langfuse on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud and
Kubernetes infrastructure.

This guide focuses on the cloud services Langfuse uses and how to explore and operate them
from the Google Cloud Console and the command line. For the mechanics that are common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to
the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Langfuse runs as a Next.js web workload. This module deploys the **v2 line** (Postgres-only);
Langfuse v3 additionally requires ClickHouse, Redis, and S3 and is out of scope. The
deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Next.js pods, 2 vCPU / 4 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Langfuse v2 does not support MySQL or other engines |
| Object storage | Cloud Storage | A dedicated bucket provisioned automatically; optional NFS share for exports |
| Secrets | Secret Manager | Auto-generated `NEXTAUTH_SECRET` and `SALT`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **Langfuse v2 (Postgres-only) is pinned.** The image is built `FROM langfuse/langfuse:2`
  via the `LANGFUSE_VERSION` build ARG; `application_version = "latest"` resolves to `2`.
- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared application
  layer; selecting any other engine breaks startup.
- **`NEXTAUTH_SECRET` and `SALT` are generated automatically** and stored in Secret Manager,
  materialised into the namespace, and injected as env vars. Langfuse's zod env validation
  refuses to boot without both — `NEXTAUTH_SECRET` signs session JWTs, `SALT` hashes API keys.
- **Prisma migrations run on every start.** The cloud entrypoint composes `DATABASE_URL` from
  the injected `DB_*` vars, then hands off to Langfuse's own startup, which runs
  `prisma migrate deploy`. The `db-init` job only creates the role and database.
- **The first user to sign up becomes the owner.** `AUTH_DISABLE_SIGNUP = "false"` is injected;
  there is no pre-seeded admin credential.
- **Session affinity is `ClientIP` by default** so a client's requests reach the same pod.
- **Minimum 1 replica is maintained** (GKE has no scale-to-zero); a PodDisruptionBudget keeps
  the service available through node upgrades.
- **No Redis.** Langfuse v2 uses a PostgreSQL-backed queue and cache; `enable_redis` stays
  `false`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other identifiers
are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Langfuse workload

Langfuse pods are scheduled on Autopilot, which bills for the CPU/memory the pods actually
request. Horizontal Pod Autoscaling sizes the deployment between the minimum and maximum
replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Langfuse workload to see pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type (Deployment vs
StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Langfuse stores all application data (traces, observations, scores, prompts, users, projects,
API keys) in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately through
the **Cloud SQL Auth Proxy** sidecar over a loopback listener; no public IP is exposed. On
first deploy an initialization Job creates the application role and database; Langfuse then
applies its schema via `prisma migrate deploy` on start.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=langfuse --database=langfuse --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the password
are all surfaced in the [Outputs](#5-outputs). For the connection model, automated backups,
and password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Storage

A dedicated **Cloud Storage** bucket is provisioned automatically; the workload service
account is granted access. Langfuse v2 keeps all trace and observability data in PostgreSQL;
the bucket (and the optionally-mounted NFS share) are available for exports and media.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/          # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Secret Manager

Two cryptographic secrets are generated automatically and stored in Secret Manager:
`NEXTAUTH_SECRET` (signs session JWTs) and `SALT` (hashes API keys). Both are materialised into
the namespace via the Secret Store CSI driver and injected as env vars, and both are required
at boot. The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md)
for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A custom
domain with a Google-managed certificate can be enabled, and a static IP is reserved by
default so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Langfuse Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently creates
  the application role and database and grants privileges. It does **not** create tables — the
  job is safe to re-run.
- **Prisma migrations on start.** The cloud entrypoint composes `DATABASE_URL` and delegates to
  Langfuse's own startup, which runs `prisma migrate deploy` before launching the server.
  Upgrading the application version applies schema changes without a separate migration step.
- **`NEXTAUTH_SECRET` and `SALT` are immutable after first boot.** They are generated once and
  written to Secret Manager. Changing `NEXTAUTH_SECRET` invalidates all active sessions; changing
  `SALT` permanently invalidates all existing API keys (SDK clients then get `401`). Only rotate
  during a planned maintenance window.
- **First user is the owner.** On first visit, the Langfuse sign-up page creates the initial
  account, which becomes the instance owner. After onboarding, set `AUTH_DISABLE_SIGNUP = "true"`
  in `environment_variables` to prevent further self-service registration.
- **External IP for ingestion.** The default `service_type = LoadBalancer` exposes an external IP
  so your LLM app's SDK clients can POST traces. Set `NEXTAUTH_URL` to the external URL after the
  LoadBalancer IP or custom domain is assigned:
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"langfuse","env":[
      {"name":"NEXTAUTH_URL","value":"https://langfuse.example.com"}
    ]}]}}}}'
  ```
  Or set `environment_variables` in the module configuration before deploying.
- **Health path.** Startup and liveness probes target `/` by default. The startup probe's wide
  failure threshold (30 × 15s) accommodates first-boot Prisma migrations.
- **NFS rollouts use `Recreate`.** When NFS is enabled and a shared server is discovered,
  `App_GKE` sets the `Recreate` update strategy so two pods never contend on the shared volume
  during an update.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific
to or notable for Langfuse are listed; every other input is inherited from [App_GKE](App_GKE.md)
with its standard behaviour and defaults.

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
| `application_name` | `langfuse` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Langfuse Helpdesk` | Human-readable name shown in the Console. **Known clone-rot in source** (copied from a helpdesk app template) — override with `"Langfuse"` for a real deployment. |
| `application_description` | `Langfuse Open-source Helpdesk on GKE Autopilot` | Brief description. Same clone-rot as `application_display_name` — override for a real deployment. |
| `application_version` | `2` | Langfuse image tag. Pinned to the v2 (Postgres-only) line. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Langfuse builds a thin wrapper image from `langfuse/langfuse:2`. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | CPU/memory limits and requests; minimum 2 GiB memory. |
| `min_instance_count` | `1` | Minimum replicas; GKE has no scale-to-zero. |
| `max_instance_count` | `5` | Maximum replicas (HPA upper bound). |
| `container_port` | `3000` | Langfuse (Next.js) listens on port 3000. |
| `timeout_seconds` | `300` | Maximum backend pod response duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for connections. |
| `enable_image_mirroring` | `true` | Mirror the Langfuse image into Artifact Registry before deployment. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not set `NEXTAUTH_SECRET`, `SALT`, or `DATABASE_URL` here. Set `AUTH_DISABLE_SIGNUP = "true"` here after onboarding. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `Deployment` (auto) | `Deployment` (default stateless) or `StatefulSet`. |
| `session_affinity` | `ClientIP` | Sticky routing so a client's requests reach the same pod. |
| `network_tags` | `["nfsserver"]` | Node/pod network tags; `nfsserver` is required when `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Seconds to wait after SIGTERM before SIGKILL. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (auto) | Enable PVC templates. Not recommended — Langfuse stores all state in PostgreSQL. |
| `stateful_pvc_size` | `10Gi` | Per-pod PVC storage size. |
| `stateful_pvc_mount_path` | `/data` | Container mount path for the PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |
| `stateful_headless_service` | `null` (auto) | Create a headless Service for stable pod DNS names. |
| `stateful_pod_management_policy` | `null` (`OrderedReady`) | Pod creation order. |
| `stateful_update_strategy` | `null` (`RollingUpdate`) | Update strategy. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Create a Kubernetes ResourceQuota in the namespace. |
| `quota_cpu_requests` / `quota_cpu_limits` | `""` | Total CPU requests/limits across all pods. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Total memory requests/limits (binary suffix e.g. `4Gi`). |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |
| `enable_topology_spread` | `false` | Distribute pods evenly across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 60s delay, 30 × 15s failure window | Startup probe. Covers first-boot Prisma migrations. |
| `liveness_probe` | HTTP `/`, 60s delay | Liveness probe. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, App_GKE-level infrastructure probes | Structured probes. |
| `uptime_check_config` | disabled, path `/` | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs. |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside Langfuse. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see [App_GKE](App_GKE.md). Key
inputs: `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Mount an NFS share at `/opt/langfuse/storage` for optional exports/media. |
| `nfs_mount_path` | `/opt/langfuse/storage` | Mount path inside the container. |
| `nfs_volume_name` | `nfs-data-volume` | Volume name for the NFS mount. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets to provision. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts via the CSI driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 15 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Langfuse v2 uses a PostgreSQL-backed queue and cache — leave `false`. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Only used if externalizing to Redis. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Langfuse requires PostgreSQL 15+. |
| `application_database_name` | `langfuse` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `langfuse` | Application database user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before rolling-restarting pods. |

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
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

> **Warning:** Enabling IAP requires Google identity authentication for **all** inbound
> requests, including SDK trace ingestion. Only enable IAP when public ingestion is not needed.

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Langfuse. |
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

These values are returned on a successful deployment and are the quickest way to locate and
explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Langfuse. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `NEXTAUTH_SECRET` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates all active sessions, forcing immediate re-login for everyone. |
| `SALT` (auto-generated) | Never rotate after first boot | Critical | Rotating it permanently invalidates all existing API keys — every SDK client using them gets `401` until re-keyed. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all trace data. |
| `application_version` | `2` (v2 line) | Critical | A v3 tag points the build at an image needing ClickHouse + Redis + S3 this module does not provision — the pod fails to start. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup fails the import job. |
| `container_resources.memory_limit` | `4Gi` (≥ 2Gi) | High | Below 2 GiB, Langfuse OOM-kills during first-boot migrations or under ingestion load. |
| `session_affinity` | `ClientIP` | High | Without stickiness, UI sessions can bounce between pods. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects invalid values. Keeping 1 ensures ingestion is always available. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity; disabling it is blocked by a plan-time validation guard. |
| `AUTH_DISABLE_SIGNUP` (auto-injected `"false"`) | Disable after first owner | High | Leaving sign-up open lets anyone with the URL create an account. |
| `enable_iap` | only when SDK ingestion not needed | High | IAP blocks all unauthenticated requests, including SDK trace ingestion. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict all pods simultaneously during maintenance. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity, autoscaling,
ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and
image mirroring — see **[App_GKE](App_GKE.md)**. Langfuse-specific application configuration
shared with the Cloud Run variant is described in **[Langfuse_Common](Langfuse_Common.md)**.
