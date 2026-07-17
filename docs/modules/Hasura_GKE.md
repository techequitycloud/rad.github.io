---
title: "Hasura on GKE Autopilot"
description: "Configuration reference for deploying Hasura on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Hasura on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Hasura_GKE.png" alt="Hasura on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Hasura is an open-source, Apache 2.0-licensed engine that gives you an instant,
realtime GraphQL (and REST) API over a PostgreSQL database, with fine-grained
role-based authorization, event triggers, and a built-in admin console. This module
deploys the Hasura GraphQL Engine (`hasura/graphql-engine`) on **GKE Autopilot** on
top of the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Hasura uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

Hasura runs as a stateless Haskell web workload. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Haskell pods, 1 vCPU / 512 MiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Hasura's metadata catalog and default data source both live in Postgres |
| Object storage | None | Hasura is stateless; no bucket is provisioned |
| Secrets | Secret Manager | Auto-generated `HASURA_GRAPHQL_ADMIN_SECRET`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; Hasura keeps its own metadata catalog in Postgres.
- **The admin secret gates everything sensitive.** `HASURA_GRAPHQL_ADMIN_SECRET` is
  generated automatically, stored in Secret Manager, and materialised into the
  namespace via the Secret Store CSI driver. It protects the `/console` UI and the
  `/v1/graphql` and `/v1/metadata` APIs; `/healthz` stays public for probes.
- **Two connection URLs are assembled in-container.** The custom image entrypoint
  builds `HASURA_GRAPHQL_DATABASE_URL` and `HASURA_GRAPHQL_METADATA_DATABASE_URL`
  from the injected `DB_*` variables. On GKE the Cloud SQL Auth Proxy sidecar listens
  on `127.0.0.1`, so the entrypoint uses a plain loopback DSN with no `sslmode` (the
  proxy terminates TLS).
- **Stateless Deployment, no sticky routing.** `workload_type = "Deployment"` and
  `session_affinity = "None"` — every pod is interchangeable because all state is in
  Postgres, so rolling updates are safe and no PVC/NFS is used.
- **Minimum 1 replica is maintained** (GKE does not support scale-to-zero) so the API
  is always reachable; a PodDisruptionBudget (`pdb_min_available = "1"`) preserves
  availability during node upgrades.
- **Exposed on a stable external IP.** `service_type = "LoadBalancer"`,
  `reserve_static_ip = true`, and `enable_custom_domain = true` by default.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Hasura workload

Hasura pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the Deployment between the minimum
and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Hasura workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type are
managed.

### B. Cloud SQL for PostgreSQL 15

Hasura stores its metadata catalog (tracked tables, relationships, permissions, event
triggers) **and** your application data in a managed Cloud SQL for PostgreSQL 15
instance. Pods reach it privately through the **Cloud SQL Auth Proxy** sidecar over
loopback; no public IP is exposed. On first deploy an initialization Job creates the
application database and user; Hasura installs its metadata schema on first boot.

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

### C. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager:
`HASURA_GRAPHQL_ADMIN_SECRET`. It is materialised into the namespace via the Secret
Store CSI driver and injected as an environment variable. The database password is
managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<admin-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### D. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP, with a
static IP reserved so the address survives redeploys and a Google-managed certificate
for the custom domain.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Hasura Application Behaviour

- **First-deploy database setup.** An initialization Job runs `create-db-and-user.sh`
  using `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and
  idempotently creates the application database and user and grants privileges. The
  job is safe to re-run.
- **Metadata catalog on start.** Hasura installs and migrates its own metadata catalog
  schema in Postgres on startup, so upgrading the image version applies catalog
  changes without a separate migration step. Tracked-table metadata persists in the
  database across pod restarts and rolling updates.
- **Two connection URLs, assembled in-container.** The entrypoint builds both
  `HASURA_GRAPHQL_DATABASE_URL` and `HASURA_GRAPHQL_METADATA_DATABASE_URL` from the
  injected `DB_*` variables. Because the Auth Proxy sidecar listens on `127.0.0.1`,
  the DSN is plain loopback with no SSL.
- **Admin secret is the security boundary.** Send it as the `x-hasura-admin-secret`
  header:
  ```bash
  ADMIN=$(gcloud secrets versions access latest --secret=<admin-secret-name> --project "$PROJECT")
  curl -s "http://${EXTERNAL_IP}/v1/graphql" \
    -H "x-hasura-admin-secret: $ADMIN" \
    -H 'Content-Type: application/json' \
    -d '{"query":"{ __schema { queryType { name } } }"}'
  ```
- **Health path.** Startup and liveness probes target `/healthz` — the public,
  unauthenticated endpoint that returns 200 once the engine is up and connected to
  Postgres. Do not repoint probes at `/v1/graphql` or `/console` (both 401 without
  the admin secret), or pods never become Ready.
- **Console access.** Reach the console at `http://<external-ip>/console` (or the
  custom domain) and paste the admin secret to track tables and run GraphQL queries.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Hasura are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix; a `-gke` suffix is appended internally so the CloudRun and GKE variants never collide. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `hasura` | Base name for resources. Do not change after first deploy. |
| `application_version` | `v2.36.0` | Hasura image tag; `latest` is remapped to a pinned v2.x tag at build time. |
| `application_database_name` | `hasura` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `hasura` | Application database user. Immutable after first deploy. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds a wrapper image that assembles the DSNs; `prebuilt` requires manual URL config. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | CPU/memory limits and requests. |
| `min_instance_count` | `1` | Minimum replicas; GKE requires ≥ 1 (no scale-to-zero). |
| `max_instance_count` | `10` | Maximum replicas. Hasura scales horizontally. |
| `workload_type` | `Deployment` | Stateless — Hasura keeps all state in Postgres. |
| `container_port` | `8080` | Hasura binds `HASURA_GRAPHQL_SERVER_PORT = 8080`. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for the Postgres connection. |
| `enable_image_mirroring` | `true` | Mirror the Hasura image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of the Ingress (API included). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `session_affinity` | `None` | No sticky routing — Hasura is stateless. |
| `network_tags` | `[]` | Node/pod network tags. Add `nfsserver` if you enable `enable_nfs`. |
| `termination_grace_period_seconds` | `30` | Seconds to wait after SIGTERM before SIGKILL. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Leave unset. Not recommended — Hasura stores all state in PostgreSQL. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` | `10Gi` / `/data` | Only relevant if a StatefulSet is forced. |

### Group 8 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra `HASURA_GRAPHQL_*` settings. Do not set the two `*_DATABASE_URL` values or the admin secret here — they are managed automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |
| `enable_resource_quota` | `false` | Enforce a namespace ResourceQuota (memory values need binary suffixes, e.g. `4Gi`). |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/healthz`, `failure_threshold=30` | Startup probe. |
| `health_check_config` | HTTP `/healthz`, `failure_threshold=3` | Liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs. |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside Hasura. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see [App_GKE](App_GKE.md).
Key inputs: `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Not required for Hasura. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[]` | Empty — Hasura requires no file storage. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts via the CSI driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Artifact Registry cleanup policy. |

### Group 15 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Declared for Foundation-variable mirroring but not forwarded to [App_GKE](App_GKE.md) in this module — Hasura does not require Redis, so this variable has no effect regardless of its value. |
| `redis_host` / `redis_port` | `""` / `6379` | Also inert for the same reason as `enable_redis`. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Fixed — Hasura requires PostgreSQL. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before rolling-restarting pods. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` | `false` | Restore from a backup on deploy. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve; empty uses the reserved IP's nip.io host. |
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
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id` for folder-nested projects). |
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
| `service_url` | URL to reach Hasura. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (empty for Hasura). |
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
| `HASURA_GRAPHQL_ADMIN_SECRET` (auto-generated) | Keep in Secret Manager; rotate deliberately | Critical | It is the only guard on the GraphQL/metadata APIs and console — exposing it grants full read/write to every tracked table. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans the metadata catalog and all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup file fails the import job. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `startup_probe_config` / `health_check_config` path | `/healthz` | High | Pointing a probe at `/v1/graphql` or `/console` returns 401 — pods never become Ready even though the engine booted. |
| `container_image_source` | `custom` | High | `prebuilt` skips the entrypoint that assembles the two `*_DATABASE_URL` values — the engine starts with no database and every request fails. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity; disabling it is blocked by a plan-time validation guard. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects invalid values. Keeping 1 ensures the API is always reachable. |
| `workload_type` / `stateful_pvc_enabled` | `Deployment` / unset | Medium | Forcing a StatefulSet gains nothing (state is in Postgres) and complicates rolling updates. |
| `HASURA_GRAPHQL_ENABLE_CONSOLE` | `false` in production | Medium | Leaving the console on widens the attack surface; manage metadata via the `hasura` CLI/migrations instead. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict all pods simultaneously during maintenance. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Hasura-specific
application configuration shared with the Cloud Run variant is described in
**[Hasura_Common](Hasura_Common.md)**.
