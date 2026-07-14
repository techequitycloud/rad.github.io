---
title: "GlitchTip on GKE Autopilot"
description: "Configuration reference for deploying GlitchTip on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# GlitchTip on GKE Autopilot

GlitchTip is an open-source, Sentry-compatible error-tracking and performance-monitoring
platform (Django/Python). Your applications send exceptions and traces to GlitchTip's
Sentry-protocol ingest endpoint, and GlitchTip stores, deduplicates, and alerts on them.
This module deploys GlitchTip on **GKE Autopilot** on top of the [App_GKE](App_GKE.md)
foundation, which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

This guide focuses on the cloud services GlitchTip uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

GlitchTip runs as a Python web workload served by **Granian** on port 8080. The
`all_in_one` server role runs the web server, the Celery worker, and Celery beat inside
the one pod container. The deployment wires together a focused set of Google Cloud
services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Django/Granian pods, 2 vCPU / 4 GiB by default; minimum 1 replica keeps the worker/beat alive |
| Database | Cloud SQL for PostgreSQL 15 | Required — GlitchTip does not support MySQL or other engines |
| Task queue & cache | Cloud SQL (PostgreSQL) | `VALKEY_URL = ""` routes the Celery queue, cache, and sessions through Postgres; Redis is optional |
| Object / file storage | Cloud Storage + NFS | A `storage` data bucket; NFS mounted at `/opt/glitchtip/storage` for uploaded attachments |
| Secrets | Secret Manager | Auto-generated Django `SECRET_KEY` and the initial superuser password; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared application
  layer; selecting any other engine breaks startup.
- **The image is a thin custom build.** GlitchTip is built `FROM glitchtip/glitchtip:6.2.0`
  with a cloud entrypoint that composes `DATABASE_URL` from the injected `DB_*` vars and
  disables Valkey/Redis before handing off to `./bin/start.sh`. On GKE the entrypoint
  sees `DB_HOST = 127.0.0.1` (the Cloud SQL Auth Proxy sidecar) and connects over
  loopback TCP.
- **No Redis by default.** `VALKEY_URL = ""` means the Celery queue, cache, and sessions
  all use PostgreSQL. Enable Redis only when you separate the worker fleet at higher
  volumes.
- **Minimum 1 replica is maintained.** GKE does not support scale-to-zero, and the
  in-process Celery worker/beat must keep running for event ingestion and the daily
  retention purge.
- **Session affinity is `ClientIP` by default.** Keeps a browser session pinned to one
  pod for the dashboard.
- **NFS is enabled by default** (`enable_nfs = true`) at `/opt/glitchtip/storage` for
  uploaded attachments, so the workload deploys with the `Recreate` strategy to avoid two
  pods contending on the shared volume during an update.
- **`SECRET_KEY` and the superuser password are generated automatically** and stored in
  Secret Manager, materialised into the namespace via the Secret Store CSI driver.
- **The initial owner is seeded, not self-registered.** `glitchtip-migrate` creates
  `admin@techequity.cloud`; `ENABLE_OPEN_USER_REGISTRATION` defaults to `false`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the GlitchTip workload

GlitchTip pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum and
maximum replica counts; a PodDisruptionBudget protects availability during node upgrades.

- **Console:** Kubernetes Engine → Workloads → select the GlitchTip workload to see pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa,pdb -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type are managed.

### B. Cloud SQL for PostgreSQL 15

GlitchTip stores all application data (projects, issues, events, users, and the Celery
queue) in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately through
the **Cloud SQL Auth Proxy** sidecar over loopback (`127.0.0.1`); no public IP is exposed.
On first deploy the `db-init` and `glitchtip-migrate` Jobs create the database and user,
run migrations, and create the superuser.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are surfaced in the
[Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the connection model, backups, and
password rotation.

### C. Cloud Storage & NFS

A dedicated **Cloud Storage** data bucket (`storage` suffix) is provisioned automatically,
and the workload service account is granted access. GlitchTip's uploaded attachments are
stored on **NFS** mounted at `/opt/glitchtip/storage` (`enable_nfs = true`). The
`nfsserver` network tag (set by default) is required for pod access to the NFS server VM.

- **Console:** Cloud Storage → Buckets; Compute Engine for the NFS server VM.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  kubectl describe pod -n "$NAMESPACE" <pod> | grep -A3 nfs
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Redis / Valkey (optional)

Redis is **disabled by default** (`VALKEY_URL = ""` → PostgreSQL-backed queue and cache).
Setting `enable_redis = true` points GlitchTip's Celery broker and cache at Redis/Valkey;
leaving `redis_host` empty with `enable_nfs = true` uses the NFS server VM's IP.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i valkey
  ```

### E. Secret Manager

Two secrets are generated automatically: the Django `SECRET_KEY` and the initial superuser
password (consumed by the migrate job). The database password is managed separately by the
foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`). A custom domain with a Google-managed certificate can be
enabled (`enable_custom_domain = true`), and a static IP is reserved by default so the
address survives redeploys.

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

## 3. GlitchTip Application Behaviour

- **First-deploy database setup.** The `db-init` Job (`postgres:15-alpine`) connects
  through the Cloud SQL Auth Proxy and idempotently creates the application database and
  user, grants privileges, and re-owns the `public` schema. It is safe to re-run and
  signals the proxy sidecar (`/quitquitquit`) so the Job pod completes.
- **Migrations + superuser bootstrap.** The `glitchtip-migrate` Job runs on the built
  GlitchTip image (`depends_on = ["db-init"]`). It composes `DATABASE_URL`, runs
  `./manage.py migrate --noinput`, then `createsuperuser --noinput` using `SUPERUSER_EMAIL`
  (`admin@techequity.cloud`) and the Secret Manager superuser password. The initial admin
  password is in Secret Manager (`secret-<prefix>-<app>-superuser-password`).
- **`all_in_one` server role.** `SERVER_ROLE = all_in_one` runs the web server, Celery
  worker, and beat in one pod. GKE keeps at least 1 replica so background ingestion and
  the daily event-retention purge keep running.
- **NFS-backed updates use `Recreate`.** With NFS enabled, App_GKE sets the Deployment
  strategy to `Recreate` so an update never runs two pods against the shared attachment
  volume simultaneously.
- **`SECRET_KEY` should not be rotated casually** — it signs sessions/cookies; rotating it
  logs everyone out.
- **Event ingestion needs the external IP.** Application SDKs POST events to the ingest
  endpoint on the LoadBalancer/custom-domain URL. Set a custom domain and managed
  certificate for a stable ingest host.
- **Health path.** Startup and liveness probes target `/` by default. Allow several
  minutes on first boot while migrations run.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for GlitchTip are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment (use `gke` to run alongside the Cloud Run variant). |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `glitchtip` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `GlitchTip Error Tracking` | Human-readable name shown in the Console. |
| `application_description` | `GlitchTip Open-source Error Tracking on GKE Autopilot` | Brief description of the application. |
| `application_version` | `6.2.0` | GlitchTip image tag; drives the `FROM glitchtip/glitchtip:<tag>` build. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | GlitchTip is a thin custom build; keep `custom`. |
| `min_instance_count` | `1` | Minimum replicas; keep ≥ 1 to keep the worker/beat alive. |
| `max_instance_count` | `5` | Maximum replicas (HPA upper bound). |
| `container_port` | `8080` | GlitchTip/Granian listens on 8080. |
| `container_resources` | 2 vCPU / 4 GiB | CPU/memory requests and limits. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar (required on GKE). |
| `enable_image_mirroring` | `true` | Mirror the base image into Artifact Registry. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not set `SECRET_KEY`, `DATABASE_URL`, or `VALKEY_URL` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `null` | `Deployment` (default) or `StatefulSet`. |
| `session_affinity` | `ClientIP` | Sticky routing for dashboard sessions. |
| `network_tags` | `["nfsserver"]` | Required when `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Seconds after SIGTERM before SIGKILL. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable per-pod PVCs. Not needed — GlitchTip state lives in PostgreSQL/NFS. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` / `stateful_pvc_storage_class` | `10Gi` / `/data` / `standard-rwo` | PVC template settings. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Create a namespace ResourceQuota. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units** (`"4Gi"`) — bare integers are bytes and block scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |
| `enable_topology_spread` / `topology_spread_strict` | `false` | Spread pods across zones/nodes. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 60s delay, 30 × 15s failure window | Startup probe. Allow several minutes on first boot. |
| `liveness_probe` | HTTP `/` 60s delay | Liveness probe. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, same timings | App_GKE-level infrastructure probes. |
| `uptime_check_config` | disabled (`enabled=false`, path `/`) | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` + `glitchtip-migrate` jobs. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs. |
| `additional_services` | `[]` | Sidecar or helper services. |

### Group 12 — CI/CD & Binary Authorization

Standard App_GKE Cloud Build / Cloud Deploy integration — see [App_GKE](App_GKE.md). Key
inputs: `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS attachment storage. |
| `nfs_mount_path` | `/opt/glitchtip/storage` | Mount path inside the container. |
| `nfs_volume_name` | `nfs-data-volume` | Kubernetes volume name. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create additional GCS buckets beyond the auto-provisioned data bucket. |
| `storage_buckets` | (data bucket) | A `storage` data bucket is declared by `GlitchTip_Common`. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts via the CSI driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Artifact Registry cleanup policy. |

### Group 15 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Use Redis/Valkey for the queue and cache instead of PostgreSQL. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — GlitchTip requires PostgreSQL 15. |
| `application_database_name` | `glitchtip` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `glitchtip` | Application database user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning.

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

> **Warning:** Enabling IAP requires Google identity authentication for **all** inbound
> requests, including SDK event ingestion. Only enable IAP for a dashboard-only
> deployment where SDKs use a separate ingest path.

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of GlitchTip. |
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

These values are returned on a successful deployment and are the quickest way to locate
and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach GlitchTip. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup (`db-init`, `glitchtip-migrate`) and (optional) import jobs. |
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
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all stored events and projects. |
| `SECRET_KEY` (auto-generated) | Never rotate casually | High | Rotating it invalidates all sessions, logging every user out. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; keeping 1 keeps the in-process worker/beat alive so ingestion and the retention purge run. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity; disabling it is blocked by a plan-time validation guard. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `enable_iap` | dashboard-only deployments | High | IAP blocks all unauthenticated requests, including SDK event ingestion. |
| `ENABLE_OPEN_USER_REGISTRATION` (fixed `false`) | n/a | High | Not exposed as a variable on this variant — `GlitchTip_Common` always sets it `false`, so signup stays admin-invite-only. |
| `network_tags` includes `nfsserver` | keep default | High | Removing it while `enable_nfs = true` blocks pod access to the NFS server VM → pods stuck mounting. |
| `session_affinity` | `ClientIP` | Medium | Without stickiness, dashboard sessions bounce between pods. |
| `container_resources` memory | `4Gi` | Medium | Below ~1 GiB the Django + worker + beat processes risk OOM under event bursts. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict all pods simultaneously during maintenance. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. GlitchTip-specific
application configuration shared with the Cloud Run variant is described in
**[GlitchTip_Common](GlitchTip_Common.md)**.
