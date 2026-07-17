---
title: "Cal.diy on GKE Autopilot"
description: "Configuration reference for deploying Cal.diy on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Cal.diy on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CalDiy_GKE.png" alt="Cal.diy on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cal.diy is the MIT-licensed, self-hostable fork of Cal.com — the open-source scheduling
platform used by millions worldwide to eliminate back-and-forth meeting coordination.
This module deploys Cal.diy on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud
and Kubernetes infrastructure.

This guide focuses on the cloud services Cal.diy uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

Cal.diy runs as a Next.js (Node.js) web workload. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Next.js pods, 2 vCPU / 2 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Cal.diy uses Prisma ORM targeting PostgreSQL |
| Object storage | Cloud Storage | A `data` bucket provisioned by default |
| Secrets | Secret Manager | Auto-generated `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY` |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed; selecting MySQL or
  `NONE` breaks startup.
- **Redis is disabled by default.** Enable it for multi-replica deployments to share
  session state across pods.
- **Session affinity is `None` by default.** Cal.diy stores sessions in PostgreSQL
  (NextAuth.js), so sticky routing is not required — but enabling Redis is recommended
  for multi-replica production.
- **Three initialization jobs run on first deploy:** `db-init` (PostgreSQL setup),
  `db-migrate` (Prisma schema migrations), and `seed-app-store` (seeds the Cal.diy app
  store table). All are idempotent and run sequentially.
- **`NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY`** are generated automatically and
  stored in Secret Manager; you never set them in plain text.
- **`NEXT_PUBLIC_WEBAPP_URL` and `NEXTAUTH_URL`** are set to the `$(GKE_SERVICE_URL)`
  sentinel, which `App_GKE` resolves to the actual LoadBalancer IP or custom domain at
  apply time.
- **`calcom/cal.diy` has no `latest` tag** — always pin `application_version` to a
  versioned release (e.g., `v6.2.0`).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Cal.diy workload

Cal.diy pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Cal.diy workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
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

Cal.diy stores all application data (bookings, users, schedules, integrations) in a
managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately through the
**Cloud SQL Auth Proxy** sidecar over a Unix socket, so no public IP is exposed. On
first deploy a sequence of initialization Jobs creates the database and user, runs
Prisma schema migrations, and seeds the app store.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see
[App_GKE](App_GKE.md).

### C. Cloud Storage

A default Cloud Storage bucket (suffix `data`) is provisioned and the workload
service account is granted access automatically. Cal.diy does not require shared NFS
storage by default — the database stores all booking state.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for CMEK and additional bucket options.

### D. Secret Manager

`NEXTAUTH_SECRET` (NextAuth.js session signing) and `CALENDSO_ENCRYPTION_KEY` (Cal.diy
data encryption) are generated automatically and stored as Secret Manager secrets.
The database password is also managed here. Secrets are injected into pods at runtime;
plaintext never appears in configuration.

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
be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and
static IP details.

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

## 3. Cal.diy Application Behaviour

- **First-deploy initialization sequence.** Three Kubernetes Jobs run before the
  application starts, in order:

  | Job | Image | Purpose |
  |---|---|---|
  | `db-init` | `postgres:15-alpine` | Creates the PostgreSQL database and user, grants privileges |
  | `db-migrate` | Cal.diy app image | Runs `prisma migrate deploy` to apply the full schema |
  | `seed-app-store` | Cal.diy app image | Seeds the `App` table with available integrations |

  All three are idempotent and safe to re-run. Inspect their status:
  ```bash
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  kubectl logs -n "$NAMESPACE" job/db-init
  kubectl logs -n "$NAMESPACE" job/db-migrate
  kubectl logs -n "$NAMESPACE" job/seed-app-store
  ```

- **`DATABASE_URL` assembly.** The entrypoint script assembles `DATABASE_URL` and
  `DATABASE_DIRECT_URL` from `DB_*` environment variables at container start, then
  launches the Next.js server. This makes database connectivity independent of which
  image variant (base mirror or CI/CD-built) is deployed.

- **Startup probe.** Health probes target `/api/auth/session` (HTTP 200 when NextAuth
  is ready). A generous startup window (`initial_delay=60s`,
  `failure_threshold=12`, `period=10s` ≈ 2 minutes) accommodates `db-migrate` and
  `seed-app-store` which must complete before the application serves requests.

- **Public URL wiring.** `NEXT_PUBLIC_WEBAPP_URL` and `NEXTAUTH_URL` are set to the
  `$(GKE_SERVICE_URL)` sentinel at deploy time. `App_GKE` replaces this with the
  actual LoadBalancer IP or custom domain. When using a custom domain, set
  `NEXT_PUBLIC_WEBAPP_URL` in `environment_variables` to the custom domain URL so
  OAuth callbacks and booking links are correct.

- **Email (SMTP).** Cal.diy uses SMTP for booking confirmations, cancellation notices,
  reminders, and password resets. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `EMAIL_FROM` in `environment_variables` and store `SMTP_PASSWORD` as a
  `secret_environment_variables` reference before going live.

- **No scheduled tasks required.** Unlike traditional queue-based apps, Cal.diy does
  not require separately scheduled background jobs — bookings and reminders are
  handled by Next.js API routes triggered by calendar webhooks and client interactions.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Cal.diy are listed; every other input is
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
| `application_name` | `cal` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Cal.com Scheduling` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `v6.2.0` | Cal.diy image version tag — **no `latest` tag exists**, always pin to a versioned release. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | `prebuilt` uses the official Cal.diy image; `custom` builds via Cloud Build. |
| `container_image` | `""` | Override container image URI. Leave empty to use default. |
| `container_resources` | `{ cpu_limit="2000m", memory_limit="2Gi" }` | CPU and memory limits; raise `memory_limit` to `4Gi` for production multi-user load. |
| `container_port` | `3000` | Cal.diy's native Next.js port. Do not change. |
| `container_protocol` | `http1` | HTTP protocol version: `http1` or `h2c`. |
| `min_instance_count` | `1` | Minimum replicas. GKE Autopilot has no scale-to-zero by default; keep ≥ 1. |
| `max_instance_count` | `5` | Maximum replicas (autoscaler ceiling). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. Must be `true` when `database_type != "NONE"`. |
| `enable_image_mirroring` | `true` | Mirror the Cal.diy image into Artifact Registry before deployment. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |
| `timeout_seconds` | `300` | Maximum seconds the load balancer waits for a pod response. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | SMTP skeleton | Plain-text settings. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `EMAIL_FROM` here. Also set `NEXT_PUBLIC_WEBAPP_URL` once a custom domain is known. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use for `SMTP_PASSWORD`. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification period. |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before restarting pods. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `gke_cluster_name` | `""` | GKE cluster name; auto-discovered if empty. |
| `namespace_name` | `""` | Kubernetes namespace; auto-generated if empty. |
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when per-pod storage is enabled. |
| `session_affinity` | `None` | `None` recommended — Cal.diy sessions are stored in PostgreSQL. |
| `network_tags` | `['nfsserver']` | Node/pod tags for VPC firewall rules. |
| `deployment_timeout` | `1800` | Maximum seconds Terraform waits for rollout to complete. |

### Group 7 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protect availability during node upgrades. Enable when `max_instance_count > 1`. |
| `pdb_min_available` | `1` | Minimum pods available during disruptions. |
| `enable_topology_spread` | `false` | Spread pods across availability zones. |
| `topology_spread_strict` | `false` | Reject pods if zone spread cannot be satisfied. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block scheduling. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/api/auth/session`, 60s delay, 12 × 10s failure window | Cal.diy's `/api/auth/session` returns 200 when NextAuth is ready. |
| `liveness_probe` / `health_check_config` | HTTP `/api/auth/session` | Liveness probe after startup. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init`, `db-migrate`, and `seed-app-store` jobs. |
| `cron_jobs` | `[]` | Recurring Kubernetes CronJobs. Cal.diy does not require scheduled tasks by default. |
| `additional_services` | `[]` | Sidecar or helper services to run alongside the main container. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is not required for Cal.diy — enable only if custom storage is needed. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the default `data` bucket. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional buckets to provision. |
| `gcs_volumes` | `[]` | GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 15 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Enable PVC templates (auto-selects StatefulSet). |
| `stateful_pvc_size` | `10Gi` | Storage size per PVC. |
| `stateful_pvc_mount_path` | `/data` | Container path where the PVC is mounted. |
| `stateful_pvc_storage_class` | `""` | Kubernetes StorageClass; uses cluster default if empty. |
| `stateful_headless_service` | `false` | Headless Service for stable DNS pod identities. |
| `stateful_pod_management_policy` | `OrderedReady` | `OrderedReady` or `Parallel`. |
| `stateful_update_strategy` | `RollingUpdate` | `RollingUpdate` or `OnDelete`. |
| `stateful_fs_group` | `null` | fsGroup GID for volume ownership. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — do not change. Cal.diy requires PostgreSQL. |
| `application_database_name` | `calcom` | Database name. Immutable after first deploy. |
| `application_database_user` | `calcom` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_postgres_extensions` | `false` | Install PostgreSQL extensions after provisioning. |
| `postgres_extensions` | `[]` | List of extensions to install (e.g., `['uuid-ossp']`). |

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
| `application_domains` | `[]` | Hostnames to serve. When set, also update `NEXT_PUBLIC_WEBAPP_URL` in `environment_variables`. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `enable_cdn` | `false` | Enable Cloud CDN on the load balancer backend. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Cal.diy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Use Redis for session caching. Recommended when `max_instance_count > 1`. |
| `redis_host` | `""` | Redis endpoint. Required when `enable_redis = true`. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | `default-waf-policy` | Cloud Armor policy name. |

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
| `service_url` | URL to reach Cal.diy. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via Auth Proxy) / port. |
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
| `database_type` | `POSTGRES_15` | Critical | Cal.diy requires PostgreSQL with Prisma ORM; MySQL or `NONE` breaks schema migrations and startup. |
| `container_port` | `3000` | Critical | Cal.diy's Next.js server listens on 3000; any other value misdirects health checks and traffic routing. |
| `enable_cloudsql_volume` | `true` | Critical | Cal.diy connects to Cloud SQL via Unix socket; disabling removes the socket and all DB connections fail. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans existing data. |
| `application_version` | pinned release | Critical | `calcom/cal.diy` has no `latest` tag; an invalid version fails the image pull. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job and may overwrite live data on subsequent applies. |
| `NEXT_PUBLIC_WEBAPP_URL` | match public URL | Critical | Cal.diy embeds this in Next.js chunks; a mismatch breaks OAuth callbacks and booking links. |
| `NEXTAUTH_URL` | match public URL | Critical | NextAuth validates OAuth redirect URIs against this; a mismatch blocks all logins. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes — blocks all pod scheduling. |
| `container_resources.memory_limit` | `2Gi` minimum | High | Cal.diy startup (DB migration + seed) requires ≥ 2 GiB; OOM kills before the app is ready. |
| `startup_probe.failure_threshold` | `12` (10s period ≈ 2 min) | High | Reducing too aggressively kills pods before `db-migrate` and `seed-app-store` complete. |
| `enable_redis` | `true` for multi-replica | High | Without Redis, sessions are per-pod; users are logged out when requests land on different pods. |
| `redis_host` | required when `enable_redis=true` | High | Empty `redis_host` with Redis enabled injects a malformed URL; session operations fail at runtime. |
| `enable_pod_disruption_budget` | `true` when `max > 1` | Medium | Without PDB, cluster maintenance can evict all pods simultaneously. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades (single pod cannot be evicted). |
| `enable_topology_spread` | enable for production | Medium | Without spread, all replicas may run in a single zone; a zone failure takes down the service. |
| `min_instance_count` | `1` | Medium | Cal.diy's first-boot startup is 3–5 minutes; `0` with scale-to-zero adds significant cold-start latency. |
| `SMTP_HOST` / `EMAIL_FROM` | real SMTP config | Medium | Without valid SMTP, booking confirmations, reminders, and password resets are never delivered. |
| `organization_id` | set explicitly for VPC-SC | Medium | VPC-SC perimeter is only activated when `organization_id` is set; `enable_vpc_sc = true` alone has no effect. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Cal.diy-specific application configuration shared with the
Cloud Run variant is described in **[Cal_Common](CalDiy_Common.md)**.
