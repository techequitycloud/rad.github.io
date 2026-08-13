---
title: "Documenso on GKE Autopilot"
description: "Configuration reference for deploying Documenso on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Documenso on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Documenso_GKE.png" alt="Documenso on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Documenso is an open-source DocuSign alternative — a Next.js application for
sending, signing, and managing e-signature documents on infrastructure you
control. This module deploys Documenso on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Documenso uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Documenso runs as a single Next.js workload built from a thin custom image on
top of the official `documenso/documenso` image. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Next.js pods on port 3000, 2 vCPU / 2 GiB by default |
| Database | Cloud SQL for PostgreSQL 15 | Required — the engine is fixed at `POSTGRES_15`; MySQL is not supported |
| File persistence | Cloud Filestore (NFS) | Enabled by default, mounted at `/mnt/nfs`, but not used for document storage (see below) |
| Object storage | Cloud Storage | An `uploads` bucket + HMAC service account, provisioned for optional S3-compatible upload transport |
| Secrets | Secret Manager | Auto-generated `NEXTAUTH_SECRET`, `NEXT_PRIVATE_ENCRYPTION_KEY`, `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY`, HMAC keys, and (optionally) SMTP password; database password |
| Ingress | Cloud Load Balancing / Gateway API | Custom domain enabled by default with a reserved static IP; falls back to a `nip.io` hostname if no domain is set |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** `database_type = "POSTGRES_15"` is the
  default. Documenso's Next.js + Prisma stack does not support MySQL, but
  unlike some other modules this is **not enforced by a plan-time
  precondition** — changing `database_type` away from Postgres silently
  breaks the app rather than failing the plan.
- **Custom build, not prebuilt.** `container_image_source = "custom"` builds a
  thin image `FROM docker.io/documenso/documenso:${DOCUMENSO_VERSION}` that
  adds `bash`, `curl`, `postgresql-client`, and `openssl`, plus a custom
  entrypoint. The upstream image's own `sh start.sh` runs Prisma migrations
  and starts the Next.js server — there is no separate migrate job.
- **Cloud SQL is reached via the Auth Proxy sidecar.** `enable_cloudsql_volume
  = true` runs a cloud-sql-proxy sidecar; the entrypoint assembles
  `NEXT_PRIVATE_DATABASE_URL` from the injected `DB_*` values, branching on
  Unix socket, `127.0.0.1` proxy, or direct-IP+SSL depending on what is
  injected.
- **Redis is disabled by default and not required.** Documenso uses a
  PostgreSQL-backed local jobs provider (`enable_redis = false`). Enable it
  only if you switch Documenso to the `bullmq` (Redis) jobs provider.
- **NFS is enabled by default but Documenso doesn't use it for documents.**
  Documents are stored in PostgreSQL by default
  (`NEXT_PUBLIC_UPLOAD_TRANSPORT = "database"`). The Filestore instance this
  provisions exists mainly as the fallback Redis host required by the plan
  precondition when `enable_redis = true` — with Redis off (the default) it
  is effectively unused overhead.
- **A signing certificate is required for actual document signing.**
  `NEXT_PRIVATE_SIGNING_TRANSPORT = "local"` expects a `.p12` certificate. If
  none is supplied, the entrypoint self-generates a throwaway self-signed
  certificate so the app still boots — but signing with it is not
  production-safe.
- **`webapp_url` is empty by default.** Until set, `NEXTAUTH_URL` and
  `NEXT_PUBLIC_WEBAPP_URL` default to `http://localhost:3000`; the entrypoint
  upgrades them to the platform-injected `GKE_SERVICE_URL` automatically on
  boot, but setting `webapp_url` explicitly is recommended once a stable
  domain is known.
- **Scale-to-zero by default.** `min_instance_count = 0`,
  `max_instance_count = 3`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Documenso workload

Documenso pods are scheduled on Autopilot, which bills for the CPU/memory the
pods actually request. The workload is a standard `Deployment` (not
NFS-backed in the sense that matters for rollout strategy, since documents
live in Postgres, not on the mounted NFS share).

- **Console:** Kubernetes Engine → Workloads → select the Documenso workload
  for pods, revisions, and events. Kubernetes Engine → Services & Ingress
  shows the external IP/hostname.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector="app.kubernetes.io/name=documenso" 2>/dev/null \
    || kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Documenso stores all application data (users, documents, recipients, audit
events) in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it
through the **Cloud SQL Auth Proxy** sidecar; no public IP is exposed. On
first deploy the `db-init` job creates the application role and database; the
Documenso image itself then runs its own Prisma migrations at container
startup.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~documenso"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and the Secret Manager secret holding the
password are all in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md) for
the connection model, automated backups, and password rotation.

### C. Cloud Storage & file persistence

A dedicated **Cloud Storage** bucket (suffix `uploads`, CORS-enabled for
browser-direct access) and a service account holding an **HMAC key** are
provisioned automatically, granting the storage SA `roles/storage.objectAdmin`
on the bucket. This is opt-in infrastructure: Documenso only writes to it if
you set `NEXT_PUBLIC_UPLOAD_TRANSPORT=s3` and wire the `S3_ACCESS_KEY` /
`S3_SECRET_KEY` secret env vars — by default documents are stored in
PostgreSQL. Separately, an **NFS (Cloud Filestore)** volume is mounted at
`/mnt/nfs` but is not written to by the application in its default
configuration.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~documenso"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Secret Manager

Documenso requires three secrets at boot — `NEXTAUTH_SECRET`,
`NEXT_PRIVATE_ENCRYPTION_KEY`, and `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY` —
all Zod-validated by the Next.js app, which will not start without them.
Additionally `S3_ACCESS_KEY` / `S3_SECRET_KEY` (HMAC credentials, only used if
S3 upload transport is enabled) and, when `smtp_host` is set,
`NEXT_PRIVATE_SMTP_PASSWORD` are generated. The database password is managed
separately by the foundation. On GKE, secrets are projected into pods via the
Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~documenso"
  gcloud secrets versions access latest --secret=<nextauth-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

Unlike many application modules, Documenso defaults `enable_custom_domain =
true`: a Kubernetes Gateway with a reserved static IP is provisioned
automatically. If `application_domains` is left empty, a `nip.io` hostname
based on the auto-generated static IP is used so the app is reachable over
HTTPS immediately.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,gateway -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to
Cloud Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Documenso Application Behaviour

- **First-deploy database setup.** The `db-init` job runs `db-init.sh` using
  `postgres:15-alpine`. It waits for Cloud SQL to accept connections, then
  idempotently creates the application role and database (`CREATEDB`
  privilege, ownership set on the target database), grants schema privileges,
  and finally signals the Cloud SQL Auth Proxy sidecar (`POST
  /quitquitquit`) to shut down so the job can complete. The job is safe to
  re-run (`execute_on_apply = true`, `max_retries = 3`).
- **Migrations run automatically, no separate job.** The official Documenso
  image's own `start.sh` runs Prisma migrations against
  `NEXT_PRIVATE_DATABASE_URL` on every container start, then launches the
  Next.js standalone server.
- **`NEXT_PRIVATE_DATABASE_URL` is assembled at boot.** The custom entrypoint
  builds it from the platform-injected `DB_USER`/`DB_PASSWORD`/`DB_HOST`/
  `DB_NAME`/`DB_PORT`, branching on whether `DB_HOST` is a Unix socket path, a
  `127.0.0.1` Auth Proxy loopback, or a direct IP (in which case
  `sslmode=require` is forced). `NEXT_PRIVATE_DIRECT_DATABASE_URL` mirrors it.
- **No bootstrap admin account.** This module does not create a Documenso
  admin/owner user. The first person to complete sign-up through the app's
  own web UI becomes the account owner — standard upstream Documenso
  behaviour, not something this module provisions.
- **Signing certificate is a required post-deploy step for real signing.**
  With no certificate supplied, the entrypoint self-generates a throwaway
  self-signed `.p12` at `/opt/documenso/cert.p12` so the app boots and
  non-signing features work, logging a loud warning. For production signing,
  supply a real certificate via `secret_environment_variables` mapping
  `NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS` (base64-encoded `.p12`) and
  `NEXT_PRIVATE_SIGNING_PASSPHRASE`.
- **Webapp URL resolution.** `NEXTAUTH_URL` / `NEXT_PUBLIC_WEBAPP_URL` default
  to `http://localhost:3000`. If still at that default when the container
  starts, the entrypoint overwrites both with the platform-injected
  `GKE_SERVICE_URL`. Set `webapp_url` explicitly once a custom domain is
  registered so OAuth/email links stay stable across redeploys.
- **Health path.** Startup probe is **HTTP** `GET /` on port 3000 with a
  generous budget (`period_seconds = 30`, `failure_threshold = 20`, ≈10
  minutes) to absorb cold start plus Prisma migrations; liveness probe is
  **HTTP** `GET /` with a 60s initial delay. Documenso has no dedicated health
  endpoint.
- **Inspect the init job and running config:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DATABASE_URL|WEBAPP_URL|SIGNING'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Documenso are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.
The full list of every declared variable, including ones inherited unchanged
from the Foundation, is in the [module README](https://github.com/techequitycloud/partner-modules/blob/main/modules/Documenso_GKE/README.md).

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `documenso` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Documenso` | Human-readable name shown in the GCP Console. |
| `application_version` | `latest` | Sets the `DOCUMENSO_VERSION` build arg for the custom-build `FROM docker.io/documenso/documenso:${DOCUMENSO_VERSION}` base image. |
| `description` | `"Documenso - The Open Source DocuSign Alternative"` | Populates the GKE workload description field. |
| `application_description` | `"Documenso on GKE Autopilot"` | **Not referenced** — `description` (above) takes precedence and controls the workload description instead. |
| `webapp_url` | `""` | Public URL of the instance. Set after first deploy (or a custom domain is registered) so NextAuth callbacks and email links are stable. |
| `deploy_application` | `true` | Set `false` to provision infrastructure only, without deploying the workload. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `2000m` | 2 vCPU per pod (app-specific override; the generic `container_resources` variable is not forwarded for this module). |
| `memory_limit` | `2Gi` | Memory per pod. |
| `min_instance_count` | `0` | Scale-to-zero by default. |
| `max_instance_count` | `3` | HPA ceiling. |
| `container_port` | `3000` | Documenso's Next.js server port. |
| `container_protocol` | `http1` | HTTP/1.1; `h2c` is available if a future upstream needs gRPC/HTTP2. |
| `timeout_seconds` | `300` | Maximum request duration. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar — required for DB connectivity on GKE. |
| `enable_image_mirroring` | `true` | Mirrors the built image into Artifact Registry. |
| `container_image_source` / `container_image` / `container_resources` / `container_build_config` | — | **Not referenced.** `Documenso_Common` always performs the custom build and sets its own resource limits from `cpu_limit`/`memory_limit`; these Foundation-mirrored variables have no effect on this module. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra plain-text env vars; core Documenso vars are injected automatically. |
| `secret_environment_variables` | `{}` | Extra Secret Manager references injected as env vars. |
| `smtp_host` | `""` | SMTP server hostname. Leave empty to disable email (invitations, signing notifications). |
| `smtp_port` / `smtp_secure_enabled` | `587` / `false` | Use `465` + `true` for implicit TLS, otherwise STARTTLS on `587`. |
| `smtp_user` | `""` | SMTP authentication username. |
| `smtp_password` | `""` | Auto-generates a Secret Manager value when left empty and `smtp_host` is set. |
| `mail_from` | `""` | Sender address for outgoing Documenso email. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP/Gateway for the Documenso UI. |
| `workload_type` | `Deployment` | Documenso does not use a StatefulSet/PVC. |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |
| `network_tags` | `["nfsserver"]` | Required for NFS connectivity when `enable_nfs = true` (the default). |
| `gke_cluster_name` / `namespace_name` | `""` | Leave empty for auto-discovery / auto-generated namespace name. |
| `gke_cluster_selection_mode` / `enable_multi_cluster_service` / `prereq_gke_subnet_cidr` / `extra_service_ports` | — | **Not referenced** by this module — Foundation-mirrored variables with no effect here. |

### Group 7 — StatefulSet

Not used by Documenso (`workload_type = "Deployment"` by default). All `stateful_*` variables are inherited unchanged from [App_GKE](App_GKE.md).

### Group 8 — Resource Quota

`enable_resource_quota` and all `quota_*` variables are declared for Foundation
convention parity but are **not forwarded** by this module — they have no
effect on the Documenso deployment.

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protects availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, `failure_threshold=20`, `period_seconds=30` | Documenso-specific probe forwarded through the Common module's `config` output; effectively supersedes the generic Foundation `startup_probe_config` default for this app. |
| `liveness_probe` | HTTP `/`, `initial_delay_seconds=60`, `failure_threshold=3` | Same mechanism as `startup_probe`; supersedes the generic `health_check_config` default. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |

### Group 11 — Workload Automation

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (creates the database and role only). |
| `cron_jobs` / `additional_services` | `[]` | No scheduled jobs or sidecars by default. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode` (this last one **is**
forwarded by Documenso, unlike several other Group-12 mirrored variables in
other modules).

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisions Filestore. Not used for document storage by default — see [Overview](#1-overview). Mainly relevant as the fallback Redis host if `enable_redis` is later enabled. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container (unused by the app's default configuration). |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | Existing NFS VM to reuse, or the base name for an inline one. |
| `nfs_volume_name` | `nfs-data-volume` | **Not forwarded** by this module — has no effect. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | `Documenso_Common` additionally always provisions its own `uploads` bucket (CORS-enabled), independent of this setting. |
| `gcs_volumes` | `[]` | No GCS Fuse volumes mounted by default. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Artifact Registry image retention. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Documenso uses a PostgreSQL-backed local jobs provider and does not require Redis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Only relevant if you switch Documenso to the `bullmq` jobs provider. |
| `cubejs_api_url` / `hub_api_url` | `http://localhost:4000` / `http://localhost:8080` | **Inert leftovers** from this module's Formbricks-derived variable template — forwarded to `Documenso_Common` but never read by any environment variable, Dockerfile, or entrypoint logic. No effect on deployment. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | **Not enforced at plan time** — changing this away from Postgres breaks Documenso's Prisma schema at runtime rather than failing the plan. |
| `db_name` | `documenso` | The database actually created and injected as `DB_NAME`. |
| `db_user` | `documenso` | The role actually created and injected as `DB_USER`; password auto-generated in Secret Manager. |
| `database_password_length` | `32` | Auto-generated password length. |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Documenso's Prisma schema requires no custom extension. |
| `enable_mysql_plugins` / `mysql_plugins` | `false` / `[]` | Not applicable — Documenso requires PostgreSQL. |
| `sql_instance_name` / `sql_instance_base_name` | `""` / `app-sql` | Existing Cloud SQL instance to reuse, or the base name for an inline one. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | `false` / `90` | Zero-downtime DB password rotation. |

`application_database_name` (default `documensodb`) and
`application_database_user` (default `documensouser`) are also declared on
this module but are **not forwarded** to the Foundation — `main.tf` wires
`db_name`/`db_user` (above) instead. Setting the `application_database_*`
variables has no effect. The five `db_*_env_var_name` variables (host, name,
password, port, user) are likewise declared but not forwarded.

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. `backup_uri` is the value actually forwarded to the Foundation. |
| `backup_file` | `backup.sql` | **Not referenced** — `backup_uri` (above) is what's actually used; setting `backup_file` has no effect. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisions a Gateway + static IP by default (unlike most other modules, which default this off). |
| `application_domains` | `[]` | If empty, a `nip.io` hostname based on the auto-generated static IP is used. |
| `reserve_static_ip` | `true` | Keeps the external address stable across redeploys. |
| `static_ip_name` | `""` | Leave empty to auto-generate. |
| `network_name` | `""` | **Not referenced** — network discovery is hardcoded internally; has no effect. |

### Group 20 — Identity-Aware Proxy (IAP)

`enable_iap`, `iap_authorized_users`/`iap_authorized_groups`,
`iap_oauth_client_id`/`iap_oauth_client_secret` (sensitive), `iap_support_email`
— standard App_GKE IAP gating in front of the Gateway. See [App_GKE](App_GKE.md).

### Group 21 — Cloud Armor

`enable_cloud_armor`, `admin_ip_ranges`, `cloud_armor_policy_name`, `enable_cdn`
— standard App_GKE WAF/CDN configuration. See [App_GKE](App_GKE.md).

### Group 22 — VPC Service Controls & Audit Logging

`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `organization_id`,
`enable_audit_logging` — standard App_GKE VPC-SC perimeter configuration. See
[App_GKE](App_GKE.md).

### Group 0 — Module Metadata

Platform/UI-only metadata (`module_description`, `module_documentation`,
`module_dependency`, `requires_services`, `module_services`, `credit_cost`,
`require_credit_purchases`, `enable_purge`, `public_access`,
`require_services_gcp_module`, `shared_users`, `technical_support_users`,
`resource_creator_identity`, `impersonation_service_account`,
`job_execution_wait_timeout`) plus three declared-but-inert variables
(`application_module`, `explicit_secret_values`, `scripts_dir` — the module
wires its own secret values and scripts path internally from
`Documenso_Common`). None of these affect the deployed infrastructure; see the
[module README](https://github.com/techequitycloud/partner-modules/blob/main/modules/Documenso_GKE/README.md#module-metadata-group-0)
for the full table.

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way
to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Documenso. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (the `uploads` bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup (`db-init`) and (optional) import jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `StatefulSet` forced alongside a stateless setting, IAP with no authorized identities, `quota_memory_*` given as bare integers, an out-of-range `container_port`/`backup_retention_days`. This module's own `validation.tf` additionally blocks `min_instance_count > max_instance_count`, `enable_redis = true` with neither `redis_host` nor `enable_nfs`, `enable_iap = true` without both OAuth credentials, and `enable_cloudsql_volume = true` with `database_type = "NONE"`. Invalid configuration fails the **plan** with a clear, named error before any resource is created — but `database_type` away from Postgres is *not* one of the checks, so that mistake is only caught at runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Not plan-validated — switching to MySQL/SQL Server breaks Prisma and every query at runtime, not at plan time. |
| Signing certificate (`NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS`) | Supply a real `.p12` post-deploy | Critical | Without it, the entrypoint self-signs a throwaway cert — documents "sign" but the signature is untrusted by PDF readers; not production-safe. |
| `NEXT_PRIVATE_ENCRYPTION_KEY` / `_SECONDARY_KEY` (auto-generated) | Never change directly | Critical | These encrypt Documenso data; rotate only via the secondary-key slot, never by regenerating the primary in place. |
| `webapp_url` | Set once the URL/domain is known | High | Left unset, `NEXTAUTH_URL`/`NEXT_PUBLIC_WEBAPP_URL` track whatever `GKE_SERVICE_URL` resolves to at each boot; an explicit value keeps auth callbacks and email links stable across redeploys. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for the entrypoint's default DB connectivity path on GKE. |
| `db_name` / `db_user` | Set once | High | Renaming after first deploy points the app at a different (empty) role/database — `application_database_name`/`application_database_user` are inert decoys; changing those has no effect. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `enable_nfs` | `true` (default) or `false` if Redis stays disabled | Medium | Filestore is billed whether or not the app writes to it; with `enable_redis = false` (the default) the NFS mount is unused overhead. |
| `smtp_host` | Set for production | Medium | Left empty, no `NEXT_PRIVATE_SMTP_*` variables are injected — no invitation or signing-notification emails are sent. |
| `enable_custom_domain` / `reserve_static_ip` | `true` (defaults) | Medium | Without a stable IP or domain, the `nip.io` fallback can shift, breaking `webapp_url`/OAuth callbacks across redeploys. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Documenso-specific application configuration
shared with the Cloud Run variant (secrets, the `db-init` job, and the
custom entrypoint) is described in **Documenso_Common** (module source:
`modules/Documenso_Common`).
