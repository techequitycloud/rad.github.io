---
title: "Metabase on GKE Autopilot"
description: "Configuration reference for deploying Metabase on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Metabase on GKE Autopilot

Metabase is an open-source business intelligence and analytics platform that lets
non-technical users query, visualise, and share data without writing SQL. This
module deploys Metabase on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Metabase uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Metabase runs as a Java/JVM (Jetty) web workload. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | JVM pods, 2 vCPU / 4 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Metabase stores all application state (questions, dashboards, users) in PostgreSQL |
| Secrets | Secret Manager | Auto-generated database password; no admin password is managed here (Metabase handles its own) |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is the only supported engine.** All application state —
  questions, dashboards, collections, users — lives in this database.
- **No Redis is required.** Metabase does not use Redis for caching;
  `enable_redis` defaults to `false`.
- **Session affinity is `ClientIP`.** Sticky routing keeps a browser session
  on one pod, avoiding session loss during HPA scale-out.
- **JVM startup takes 60–120 seconds.** The startup probe targets `/api/health`
  with a 60-second initial delay and 18 retries, giving ~240 seconds total
  tolerance. `min_instance_count = 1` keeps at least one pod warm.
- **`MB_JETTY_PORT = "3000"` and `JAVA_TIMEZONE = "UTC"` are injected
  automatically** — do not override them.
- **No GCS storage bucket is created by default.** Metabase stores everything in
  PostgreSQL. Add a bucket via `storage_buckets` only if needed.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Metabase workload

Metabase pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the
minimum and maximum replica counts. Because the JVM takes 60–120 seconds to
initialise, keep `min_instance_count = 1` in production to avoid cold-start
delays and probe failures.

- **Console:** Kubernetes Engine → Workloads → select the Metabase workload to
  see pods, revisions, and events. Kubernetes Engine → Services & Ingress shows
  the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Metabase stores its entire application state — questions, dashboards,
collections, users, permissions, and settings — in a managed Cloud SQL for
PostgreSQL 15 instance. Pods reach it privately through the **Cloud SQL Auth
Proxy** sidecar over a Unix socket, so no public IP is exposed. On first deploy
an initialization Job creates the application database and user.

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

### C. Secret Manager

The database password is stored as a Secret Manager secret and injected into pods
at runtime; plaintext never appears in configuration. Metabase manages its own
internal encryption key separately.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### D. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP.
A custom domain with a Google-managed certificate can be enabled, and a static IP
can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and
static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr (including Metabase JVM logs) flow to Cloud Logging; GKE and
Cloud SQL metrics flow to Cloud Monitoring. Optional uptime checks and alert
policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Metabase Application Behaviour

- **First-deploy database setup.** An initialization Job runs before the
  application workload, using `postgres:15-alpine` to connect to Cloud SQL
  through the Auth Proxy and idempotently create the application database and
  user. It is safe to re-run.
- **No auto-migration on startup.** Unlike some other applications, Metabase does
  not run schema migrations on every start. Migrations run as part of the Metabase
  application process on first boot against an already-initialised database —
  hence the importance of the `db-init` job completing successfully first.
- **Upgrade caution.** Metabase migrations are one-way. Downgrading after a
  migration has run corrupts the schema. Always test upgrades in a staging
  environment before applying to production.
- **Health path.** Startup and liveness probes target `/api/health`, which returns
  HTTP 200 only when the JVM is fully initialised and connected to PostgreSQL.
  The startup probe uses a 60-second initial delay with 18 retries (period 10s),
  giving ~240 seconds total tolerance. Do not reduce these values.
- **Admin setup.** On first boot Metabase presents a setup wizard in the browser.
  After setup, the admin credentials are managed inside Metabase itself — no
  `SECRET_KEY` or admin password is managed by this module.
- **Data sources.** Metabase is a BI tool that queries external databases. After
  deployment, configure data sources in Metabase Admin → Databases. Common
  GCP-native sources include BigQuery, Cloud SQL PostgreSQL/MySQL, and Google
  Sheets.
- **`MB_JETTY_PORT` and `JAVA_TIMEZONE` are fixed.** These are injected
  automatically by `Metabase_Common`. Overriding them via `environment_variables`
  breaks routing or produces incorrect report timestamps.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Metabase are listed; every other input is
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
| `application_name` | `metabase` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Metabase Analytics` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `v0.51.3` | Metabase image version tag; increment to roll out a new version. **Never downgrade** — migrations are irreversible. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | CPU/memory limits. JVM requires at least 2 GiB; 4 GiB recommended for production. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 to avoid 60–120s JVM cold starts. |
| `max_instance_count` | `5` | Maximum replicas (autoscaler ceiling). |
| `container_port` | `3000` | Metabase's Jetty port — must match `MB_JETTY_PORT`. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for Unix socket connections. Required. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically — recommended for JVM right-sizing. |
| `termination_grace_period_seconds` | `60` | Seconds Kubernetes waits after SIGTERM; allows in-flight queries to complete. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `MB_JETTY_PORT` and `JAVA_TIMEZONE` are injected automatically — do not override. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g., SMTP password). |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing required to keep browser sessions on one pod during HPA scale-out. |
| `workload_type` | `null` | Auto-resolves; Metabase is stateless so use `"Deployment"`. |
| `network_tags` | `['nfsserver']` | Node/pod tags for firewall rules. |

### Group 7 — StatefulSet (advanced)

Not recommended for Metabase — it is stateless. See [App_GKE](App_GKE.md) for
StatefulSet mechanics if needed.

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
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | `/api/health`, initial delay 60s, failure threshold 18 | HTTP probe; total tolerance ~240s for JVM startup. Do not reduce. |
| `health_check_config` | `/api/health`, initial delay 120s, failure threshold 3 | Liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (PostgreSQL database + user creation). |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs for any recurring tasks. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS storage is not required for Metabase — all state is in PostgreSQL. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision GCS buckets when `storage_buckets` is non-empty. |
| `storage_buckets` | `[]` | Empty by default — Metabase does not require object storage. Add buckets here only if needed (e.g., for Metabase Enterprise S3 storage). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — do not change. Metabase requires PostgreSQL. |
| `application_database_name` | `metabase` | Database name. Immutable after first deploy. |
| `application_database_user` | `metabase` | Application user. Immutable after first deploy. |
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
| `enable_custom_domain` | `false` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Metabase. Strongly recommended — Metabase's own login is otherwise publicly reachable. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Cloud Armor & CDN

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | _(set)_ | Policy name. |
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
| `service_url` | URL to reach Metabase. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (empty by default). |
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
| `database_type` | `POSTGRES_15` | Critical | Metabase requires PostgreSQL; any other engine breaks startup. |
| `enable_cloudsql_volume` | `true` | Critical | Disabling breaks all database connections (Auth Proxy sidecar required). |
| `container_resources.memory_limit` | `4Gi` | Critical | Under 2 GiB the JVM crashes with OutOfMemoryError on startup. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all application data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `application_version` | increment carefully | Critical | Metabase migrations are one-way; downgrading corrupts the schema. Always test upgrades in staging. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all scheduling. |
| `startup_probe_config.failure_threshold` | `18` (≥ 18) | High | Reducing causes premature pod kills before the JVM completes startup. |
| `min_instance_count` | `1` | High | `0` causes 60–120s cold starts; probe failures on first request. |
| `container_resources.cpu_limit` | `2000m` | High | Under 500m JVM JIT compilation stalls startup, triggering probe failures. |
| `session_affinity` | `ClientIP` | High | Without stickiness, multi-pod deployments lose browser session state on scale-out. |
| `enable_iap` / `enable_cloud_armor` | enable for prod | High | Metabase login page is otherwise publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |
| `enable_redis` | `false` | Low | Metabase does not use Redis; enabling has no effect. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Metabase-specific application configuration shared with
the Cloud Run variant is described in **[Metabase_Common](Metabase_Common.md)**.
