---
title: "Vaultwarden on GKE Autopilot"
---

# Vaultwarden on GKE Autopilot

Vaultwarden is a lightweight, self-hosted Bitwarden-compatible password manager written
in Rust. This module deploys Vaultwarden on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud
and Kubernetes infrastructure.

This guide focuses on the cloud services Vaultwarden uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

Vaultwarden runs as a compiled Rust binary in a StatefulSet. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Rust binary pods, 500m CPU / 512 Mi by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 (default) or MySQL 8.0 | Configurable engine; the init job adjusts automatically |
| Per-pod storage | Kubernetes PersistentVolumeClaim | 10 Gi at `/data` for vault data, RSA keys, and attachments |
| Object storage | Cloud Storage | A dedicated `vaultwarden-attachments` bucket |
| Secrets | Secret Manager | Database password; Vaultwarden manages its own admin token internally |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **StatefulSet with a 10 Gi PVC is the default.** Vault data (`/data`) persists across
  pod restarts and upgrades. Do not switch to Deployment while `stateful_pvc_enabled =
  true`.
- **Registrations are closed by default.** `signups_allowed = false` prevents
  anonymous account creation. Enable only during initial admin setup, then disable.
- **No admin token is auto-generated.** The `/admin` panel is disabled unless you
  provide `ADMIN_TOKEN` in `environment_variables`. This is the secure default.
- **`domain` must be set for WebAuthn and TOTP.** Without the full public URL, 2FA
  QR codes link to `localhost` and organisation invitation emails contain broken links.
- **Health probes target `/alive`**, Vaultwarden's dedicated lightweight health
  endpoint. Vaultwarden starts quickly as a Rust binary; the startup probe uses a 30 s
  initial delay.
- **Session affinity is `ClientIP` by default** to route a given Bitwarden client
  consistently to the same pod.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Vaultwarden workload

Vaultwarden pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. A StatefulSet with a PersistentVolumeClaim backs the `/data`
directory so vault data survives pod restarts and upgrades. Horizontal Pod Autoscaling
sizes the workload between the minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Vaultwarden workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  kubectl describe pvc -n "$NAMESPACE"          # per-pod storage status
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the StatefulSet
workload type are managed.

### B. Cloud SQL — PostgreSQL 15 or MySQL 8.0

Vaultwarden stores all vault data in a managed Cloud SQL instance. The default engine
is **PostgreSQL 15**; set `database_type = "MYSQL_8_0"` to use MySQL instead. Pods
connect privately through the **Cloud SQL Auth Proxy** sidecar over a Unix socket,
so no public IP is exposed. On first deploy an initialization Job creates the
application database and user.

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
automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. PersistentVolumeClaim and Cloud Storage

Vault data (the Vaultwarden SQLite fallback state, RSA signing keys, attachment
metadata, and 2FA configuration) is written to a per-pod **PersistentVolumeClaim**
at `/data`. A dedicated **Cloud Storage** bucket (`vaultwarden-attachments`) is also
provisioned for attachment files; the workload service account is granted access
automatically.

- **Console:** Kubernetes Engine → Storage → PersistentVolumeClaims; Cloud Storage →
  Buckets for the attachments bucket.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<attachments-bucket>/      # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for GCS Fuse and CMEK options.

### D. Secret Manager

The database password is stored as a Secret Manager secret and injected into pods at
runtime. Vaultwarden manages its own internal admin token and RSA signing keys within
the `/data` volume — those are not stored in Secret Manager.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A
custom domain with a Google-managed certificate can be enabled, and a static IP can
be reserved so the address survives redeploys. Cloud Armor is strongly recommended
to protect the Vaultwarden login endpoints from brute-force attacks.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud Armor, and
static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. An uptime check targeting `/alive` can be enabled.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Vaultwarden Application Behaviour

- **First-deploy database setup.** An initialization Job creates the Vaultwarden
  database and user and grants privileges before the application starts. It is
  idempotent and safe to re-run. The correct job image is selected automatically:
  `postgres:15-alpine` for PostgreSQL, `mysql:8.0-debian` for MySQL.
- **No schema migrations on start.** Vaultwarden manages its own internal schema
  evolution automatically. The init job only creates the database and user; no
  migration command is needed.
- **No scheduled tasks required.** Unlike many web applications, Vaultwarden has no
  mandatory cron jobs. All vault operations are request-driven.
- **Health path.** Both the startup and liveness probes target `/alive`, which returns
  `OK` when the server is ready. The initial delay is 30 s, matching Vaultwarden's
  fast Rust startup.
- **Admin panel.** The `/admin` panel is disabled unless `ADMIN_TOKEN` is provided via
  `environment_variables`. Generate a secure token and pass it as a non-secret env var
  (or reference it from Secret Manager via `secret_environment_variables`).
- **SMTP for notifications.** Vaultwarden uses SMTP for account verification, 2FA
  recovery codes, and emergency-access emails. Configure `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_FROM`, `SMTP_USERNAME`, and `SMTP_PASSWORD` (via `secret_environment_variables`)
  as a complete set — partial SMTP configuration causes silent delivery failures.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Vaultwarden are listed; every other input is
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

### Group 3 — Application Identity & Vaultwarden Settings

| Variable | Default | Description |
|---|---|---|
| `application_name` | `vaultwarden` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Vaultwarden Password Manager` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `1.32.7` | Vaultwarden image version tag; increment to roll out a new version. |
| `domain` | `""` | **Full public URL** (e.g. `https://vault.example.com`). Required for WebAuthn, TOTP QR codes, org invites, and attachment links. |
| `signups_allowed` | `false` | Allow new user self-registration. Enable only during initial setup; disable immediately after creating admin accounts. |
| `web_vault_enabled` | `true` | Serve the Vaultwarden web UI. Disable for API-only access via native clients. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds from the Dockerfile; `prebuilt` uses an existing image URI. |
| `cpu_limit` | `500m` | CPU per pod. Vaultwarden is a lightweight Rust binary. |
| `memory_limit` | `512Mi` | Memory per pod. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 to avoid vault unavailability on cold start. |
| `max_instance_count` | `3` | Maximum replicas (autoscaler ceiling). |
| `container_port` | `80` | Vaultwarden's Rocket HTTP port. Must match `ROCKET_PORT`. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for Unix socket connections. Required. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | _(SMTP/log defaults)_ | Plain-text settings. Core `ROCKET_PORT`, `SIGNUPS_ALLOWED`, `WEB_VAULT_ENABLED`, `DATA_FOLDER`, and optionally `DOMAIN` are injected automatically. Default includes `LOG_LEVEL=warn`, `SHOW_PASSWORD_HINT=false`, and SMTP stub values. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g. `{ SMTP_PASSWORD = "vaultwarden-smtp-pass" }`). |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification cadence. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `workload_type` | `StatefulSet` | Use StatefulSet for persistent `/data` storage (default and recommended). |
| `session_affinity` | `ClientIP` | Routes a given client consistently to the same pod. |
| `network_tags` | `["nfsserver"]` | Node/pod network tags for firewall rules. |
| `gke_cluster_name` | `""` | GKE cluster name; leave empty for auto-discovery. |
| `namespace_name` | `""` | Kubernetes namespace; leave empty to auto-generate. |

### Group 7 — StatefulSet Persistent Storage

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Provision a PVC for Vaultwarden's `/data` directory. |
| `stateful_pvc_size` | `10Gi` | PVC size. Increase for large vaults with many attachments. |
| `stateful_pvc_mount_path` | `/data` | Mount path, matching the `DATA_FOLDER` env var. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass. |
| `stateful_headless_service` | `null` | Create a headless Service for StatefulSet DNS. |
| `stateful_pod_management_policy` | `null` | Pod creation order: `OrderedReady` or `Parallel`. |
| `stateful_update_strategy` | `null` | Update strategy: `RollingUpdate` or `OnDelete`. |
| `stateful_fs_group` | `0` | fsGroup GID set in the pod security context. |

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
| `startup_probe_config` | HTTP `/alive`, 30 s delay, 6 failures | Vaultwarden's dedicated health path; 30 s matches fast Rust startup. |
| `health_check_config` | HTTP `/alive`, 30 s delay, 3 failures | Liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check targeting `/alive`. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Workload Automation (Jobs & Scheduled Tasks)

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in database setup job (selects the correct image for PostgreSQL or MySQL automatically). |
| `cron_jobs` | `[]` | Vaultwarden has no required scheduled tasks; add custom CronJobs here if needed. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Optional Filestore NFS volume. Not required for single-replica Vaultwarden (the PVC covers `/data`). Enable for shared supplementary storage across replicas. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the attachments bucket. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional buckets. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | `POSTGRES_15` (default) or `MYSQL_8_0`. The init job image is selected automatically. |
| `application_database_name` | `vaultwarden` | Database name. Immutable after first deploy. |
| `application_database_user` | `vaultwarden` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `30` | Retention; 30-day default reflects vault recovery importance. |
| `enable_backup_import` / `backup_source` / `backup_uri` | restore options | Restore from a backup on deploy. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `false` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. Also set `domain` to the full `https://` URL. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys; recommended for DNS stability. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in. Note: IAP in front of Vaultwarden may prevent Bitwarden native clients from connecting. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | **Recommended for Vaultwarden.** Attach a Cloud Armor WAF policy to protect the login endpoint from brute-force. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | _(set)_ | Policy name. |

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
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Vaultwarden. |
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
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `signups_allowed` | `false` | Critical | Any internet user can self-register on the vault while `true`. Disable immediately after creating admin accounts. |
| `enable_cloudsql_volume` | `true` | Critical | Vaultwarden connects to Cloud SQL via Unix socket; disabling causes CrashLoopBackOff immediately. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and Vaultwarden sees an empty vault. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all scheduling. |
| `workload_type` + `stateful_pvc_enabled` | StatefulSet / true | Critical | Setting `workload_type = "Deployment"` alongside `stateful_pvc_enabled = true` fails at plan time. |
| `domain` | full `https://` URL | High | Without it, TOTP QR codes link to `localhost`, org invite emails contain broken links, and attachment URLs are invalid. |
| `database_type` | set once | High | Changing after first deploy causes Vaultwarden to connect to an empty database; all credentials appear lost. |
| `container_port` | `80` | High | Must match `ROCKET_PORT`; a mismatch means the readiness probe fails and the pod never becomes Ready. |
| `min_instance_count` | `1` | High | `0` scales to zero; a password manager becomes unavailable for several seconds on cold start — Bitwarden clients show connection errors. |
| `stateful_pvc_size` | `10Gi` | High | Too small fills up when users store attachments, causing write errors. Increase before filling. |
| `session_affinity` | `ClientIP` | Medium | Without stickiness, in-progress vault sync operations may route to different pods and encounter stale state. |
| `enable_cloud_armor` | enable for production | Medium | Without Cloud Armor, the Vaultwarden login endpoint is open to brute-force attacks from the internet. |
| `backup_retention_days` | `30` (default, raise for prod) | Medium | A password manager without adequate backup retention means credential loss on database failure. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |
| `enable_iap` with native clients | use with care | Medium | IAP requires browser-based OAuth; native Bitwarden clients cannot complete the IAP flow. |
| `smtp_*` env vars | configure as a complete set | High | Partial SMTP configuration causes silent email delivery failures — 2FA recovery codes and invitation emails are never sent. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Vaultwarden-specific application configuration shared with the
Cloud Run variant is described in **[Vaultwarden_Common](Vaultwarden_Common.md)**.
