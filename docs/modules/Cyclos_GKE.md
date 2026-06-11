---
title: "Cyclos on GKE Autopilot"
---

# Cyclos on GKE Autopilot

Cyclos is a feature-rich banking and payment platform used by microfinance institutions,
credit unions, and complementary currency networks. This module deploys Cyclos on **GKE
Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and manages
the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Cyclos uses and how to explore and operate them
from the Google Cloud Console and the command line. For the mechanics common to every GKE
application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Cyclos runs as a Java/Tomcat web workload. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Java/Tomcat pods, 2 vCPU / 4 GiB recommended, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Cyclos does not support MySQL or SQL Server |
| Object storage | Cloud Storage | A dedicated file-storage bucket (`<prefix>-cyclos-storage`) for uploaded files and media |
| Secrets | Secret Manager | Auto-generated database password; `ROOT_PASSWORD` for superuser extension setup |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** Cyclos requires six specific PostgreSQL extensions
  (`pg_trgm`, `uuid-ossp`, `cube`, `earthdistance`, `postgis`, `unaccent`). MySQL and SQL
  Server are not supported.
- **PostgreSQL extensions are installed automatically** by the `db-init` job before Cyclos
  starts — you do not need to enable them manually.
- **GCS file storage is mandatory.** Cyclos uses Google Cloud Storage as its file content
  manager (`cyclos.storedFileContentManager = gcs`). NFS is disabled for the Cyclos
  container; the GCS bucket name is injected automatically.
- **`max_instance_count` defaults to 1.** Cyclos Community Edition requires Hazelcast
  configuration to scale horizontally. Increase only after configuring clustering.
- **Schema management on startup.** Cyclos creates and migrates its own PostgreSQL schema
  on first boot (`cyclos.db.managed = true`). First-deploy startup takes 2–5 minutes while
  extensions are created and the schema is initialised.
- **Health probes target `/api`.** The `/api` endpoint returns HTTP 200 only once Cyclos
  is fully initialised, making it the most reliable probe path.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other identifiers
are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Cyclos workload

Cyclos pods are scheduled on Autopilot, which bills for the CPU/memory the pods actually
request. Horizontal Pod Autoscaling sizes the deployment between the minimum and maximum
replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Cyclos workload to see pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Cyclos stores all application data (accounts, transactions, members) in a managed Cloud
SQL for PostgreSQL 15 instance. On first deploy, an initialization Job connects as the
`postgres` superuser, creates the application database and user, and installs all six
required PostgreSQL extensions. Subsequent starts use the application user.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=cyclos --database=cyclos --project "$PROJECT"
  # Inside psql — confirm required extensions are installed:
  # \dx
  ```

The instance name, database name, user, and the Secret Manager secret holding the password
are all surfaced in the [Outputs](#5-outputs). For the connection model, automated backups,
and password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Storage — file content manager

Cyclos stores all uploaded files, profile photos, and transaction attachments in a
dedicated Cloud Storage bucket provisioned as part of the deployment. The bucket name is
derived from the deployment resource prefix and injected automatically as
`cyclos.storedFileContentManager.bucketName`. The workload service account is granted
access automatically.

- **Console:** Cloud Storage → Buckets → look for `<prefix>-cyclos-storage`.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name:cyclos-storage"
  gcloud storage ls gs://<cyclos-storage-bucket>/
  # Confirm the bucket env var is injected into the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    sh -c 'echo $cyclos__storedFileContentManager__bucketName'
  ```

See [App_GKE](App_GKE.md) for GCS Fuse mount options and CMEK.

### D. Secret Manager

The Cyclos database password and the PostgreSQL superuser (`ROOT_PASSWORD`) are stored as
Secret Manager secrets and injected into pods at runtime; plaintext never appears in
configuration. The `db-init` job uses `ROOT_PASSWORD` to install extensions; Cyclos uses
`DB_PASSWORD` to connect at runtime.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A custom
domain with a Google-managed certificate can be enabled, and a static IP can be reserved
so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Cyclos Application Behaviour

- **First-deploy database setup.** The `db-init` job runs as the PostgreSQL superuser and
  idempotently: creates the `cyclos` database user, creates the application database,
  installs all six required extensions (`pg_trgm`, `uuid-ossp`, `cube`, `earthdistance`,
  `postgis`, `unaccent`), and grants the necessary privileges. It is safe to re-run.
- **Schema management on startup.** Cyclos creates and evolves its own PostgreSQL schema
  on startup (`cyclos.db.managed = true`). First-deploy startup takes 2–5 minutes while
  the schema is built. Subsequent starts are faster but still validate the schema.
- **JVM heap sizing.** Set the `CYCLOS_OPTIONS` environment variable to cap JVM heap
  usage — for example `{ CYCLOS_OPTIONS = "-Xmx3g" }` for a 4 GiB memory limit. Without
  this, the JVM can consume all available container memory and be OOMKilled.

  ```bash
  # Confirm CYCLOS_OPTIONS is set on the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep CYCLOS_OPTIONS
  ```
- **Health probe path.** The startup and liveness probes both target `/api`, which returns
  HTTP 200 only once Cyclos is fully initialised and the schema is applied. Using a
  different path (such as `/`) results in a 302 redirect and the probe never passes.
- **Single-instance default.** Cyclos Community Edition defaults to one replica
  (`max_instance_count = 1`). Increasing the count without Hazelcast clustering
  configuration causes non-atomic transaction processing and potential data corruption.
- **Hazelcast clustering (optional).** For multi-replica deployments, set
  `workload_type = "StatefulSet"` and configure Hazelcast discovery via
  `environment_variables`. The bundled `hazelcast.xml` uses Kubernetes DNS discovery via
  the `CLUSTER_K8S_DNS` environment variable.
- **Email delivery.** Cyclos sends transactional email (notifications, password resets)
  via SMTP. Configure SMTP settings through `environment_variables`:

  ```bash
  environment_variables = {
    SMTP_HOST  = "smtp.sendgrid.net"
    SMTP_PORT  = "587"
    SMTP_USER  = "apikey"
    SMTP_SSL   = "true"
    EMAIL_FROM = "noreply@yourbank.example.com"
  }
  ```
  Use `secret_environment_variables` for `SMTP_PASSWORD`.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Cyclos are listed; every other input is inherited from
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
| `application_name` | `cyclos` | Base name for resources. **Do not change after first deploy.** |
| `application_display_name` | `Cyclos Community Edition` | Friendly name shown in GKE workload annotations and the platform UI. |
| `application_description` | `Cyclos Community Edition on GKE Autopilot` | Workload description annotation. |
| `application_version` | `4.16.17` | Cyclos image version tag. Increment to trigger a new image pull and rollout. |
| `display_name` | `Cyclos Community Edition` | Name passed to Cyclos_Common for the application config object. |
| `description` | `Cyclos Banking System on GKE` | Description passed to Cyclos_Common. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | Full resource spec. **Override to at least `"2000m"` CPU and `"2Gi"` memory.** `"4Gi"` recommended for production. |
| `cpu_limit` | `2000m` | Convenience variable passed to Cyclos_Common. Overridden by `container_resources` in practice. |
| `memory_limit` | `4Gi` | Convenience variable passed to Cyclos_Common. Overridden by `container_resources` in practice. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 to avoid slow JVM cold starts. |
| `max_instance_count` | `1` | Maximum replicas. Keep `1` unless Hazelcast clustering is configured. |
| `container_port` | `8080` | Cyclos/Tomcat listens on port 8080. |
| `enable_cloudsql_volume` | `false` | Cloud SQL Auth Proxy sidecar. Cyclos defaults to direct TCP — enable only if verified needed. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. SMTP and `CYCLOS_OPTIONS` are configured here. Core Cyclos vars are injected automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing for consistent session handling. |
| `workload_type` | `null` | Auto-selects Deployment. Set `StatefulSet` only with Hazelcast clustering. |
| `network_tags` | `["nfsserver"]` | Node/pod tags; retained for firewall rule compatibility. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable per-pod PVCs. For Cyclos, only relevant with local file store (default is GCS). |
| `stateful_pvc_size` | `10Gi` | Storage per PVC. |
| `stateful_pvc_mount_path` | `/data` | Container path for the PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass. |
| `stateful_headless_service` | `null` | Create a headless Service for stable DNS — required for Hazelcast. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` or `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` or `OnDelete`. |
| `stateful_fs_group` | `0` | fsGroup GID for volume ownership. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protect availability during node upgrades. Enable only when `min_instance_count > 1`. |
| `pdb_min_available` | `1` | Minimum pods available during disruptions. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api`, 90s delay, 60s period, 5 failures | Cyclos-specific startup probe. Increase `failure_threshold` to `10` for first-deploy schema creation. |
| `liveness_probe` | HTTP `/api`, 120s delay, 60s period, 3 failures | Cyclos-specific liveness probe. |
| `uptime_check_config` | `{ enabled = true, path = "/" }` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (creates extensions, user, and database). |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs. |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside Cyclos. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — NFS

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is not used by the Cyclos container (GCS is the file store). Set `true` only if you need NFS provisioned for other jobs. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the additional data bucket. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional GCS buckets (the primary `cyclos-storage` bucket is provisioned automatically). |
| `gcs_volumes` | `[]` | GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Cloud SQL engine. Cyclos requires PostgreSQL. Do not change to MySQL or `NONE`. |
| `db_name` | `cyclos` | PostgreSQL database name. **Immutable after first deploy.** |
| `db_user` | `cyclos` | Application user. **Immutable after first deploy.** |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. Set `false` after a successful import. |

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
| `enable_iap` | `false` | Require Google sign-in in front of Cyclos. |
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

These values are returned on a successful deployment and are the quickest way to locate
and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Cyclos. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | GitHub repo details. |
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
| `database_type` | `POSTGRES` or `POSTGRES_15` | Critical | Cyclos requires PostgreSQL. MySQL or `NONE` breaks startup entirely. |
| `db_name` / `db_user` | set once (`cyclos` / `cyclos`) | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all financial data. |
| `max_instance_count` | `1` (default) | Critical | More than 1 without Hazelcast clustering causes non-atomic transactions and potential data corruption. |
| `application_name` | `cyclos` (do not change) | Critical | Embedded in GKE namespace, Artifact Registry repo, Secret Manager secrets, and GCS bucket name. Changing orphans all resources. |
| `cyclos.storedFileContentManager` env var | `gcs` (hardcoded) | Critical | Overriding to `local` writes files to ephemeral pod storage; all uploads are lost on restart. |
| `memory_limit` (in `container_resources`) | `≥ 2Gi` (`4Gi` recommended) | Critical | JVM throws `OutOfMemoryError`; pod is OOMKilled (exit code 137). |
| `CYCLOS_OPTIONS` env var | `-Xmx3g` for 4 GiB limit | Critical | No `-Xmx`: JVM grows to consume all container memory; pod OOMKilled under load. |
| `startup_probe.path` | `/api` | Critical | Wrong path means the probe never sees HTTP 200; GKE kills the pod before it accepts traffic. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling. |
| `enable_backup_import` | `false` after restore | High | Leaving `true` re-runs the restore on every apply, overwriting live financial data. |
| `container_resources` cpu | `≥ 2000m` | High | Java GC and Cyclos startup are CPU-bound; too little CPU causes startup probe failures. |
| `startup_probe.failure_threshold` | `≥ 5` (increase to `10` for first deploy) | High | Too low: `db-init` extension creation takes 1–3 min; pod killed before schema is ready. |
| `min_instance_count` | `1` | High | `0` causes 45–120 s JVM cold starts; banking transactions time out waiting for warmup. |
| `enable_pod_disruption_budget` | `false` unless `min_instance_count > 1` | High | PDB with `1/1` blocks node drains; Autopilot upgrades stall permanently. |
| `enable_iap` / `enable_cloud_armor` | enable for admin-facing | Medium | The Cyclos admin interface is otherwise publicly reachable. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention of financial records. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Cyclos-specific
application configuration shared with the Cloud Run variant is described in
**[Cyclos_Common](Cyclos_Common.md)**.
