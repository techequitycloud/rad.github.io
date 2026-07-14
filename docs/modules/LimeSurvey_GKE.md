---
title: "LimeSurvey on GKE Autopilot"
description: "Configuration reference for deploying LimeSurvey on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# LimeSurvey on GKE Autopilot

LimeSurvey is a free, open-source online survey and questionnaire platform
(PHP/Yii). It supports unlimited surveys with dozens of question types,
conditional branching, quotas, multi-language surveys, and rich
statistics/exports. This module deploys LimeSurvey on **GKE Autopilot** on top
of the [App_GKE](App_GKE.md) foundation, which provisions and manages the
shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services LimeSurvey uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

LimeSurvey runs as a single PHP/Apache web workload built from the
`martialblog/limesurvey` image. The deployment wires together a focused set
of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | PHP/Apache pods on port 8080, 1 vCPU / 2 GiB by default |
| Database | Cloud SQL for MySQL 8.0 | Required — the Common module fixes `database_type = "MYSQL_8_0"` regardless of the app variable's `null` default |
| File persistence | Cloud Filestore (NFS) | Survey uploads/exports/runtime data persist under `/var/www/html/upload`, shared across pods |
| Object storage | Cloud Storage | A generic `data` bucket (Group 14 default) plus a Common-provisioned `limesurvey-uploads` bucket; neither is mounted into the pod by default |
| Secrets | Secret Manager | Auto-generated `ADMIN_PASSWORD` (LimeSurvey super-admin); database password managed by the foundation |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** `LimeSurvey_Common`'s `config` output hardcodes
  `database_type = "MYSQL_8_0"`, overriding the app module's `database_type`
  default of `null`; other engines are not supported.
- **Cloud SQL is reached via the Auth Proxy sidecar on loopback.** The variant
  sets `enable_cloudsql_volume = true`, and `limesurvey.tf` merges
  `DB_HOST = "127.0.0.1"` into the application config so LimeSurvey dials the
  cloud-sql-proxy sidecar rather than a socket path.
- **InnoDB is forced.** The martialblog image's entrypoint defaults the DB
  engine to MyISAM, which Cloud SQL for MySQL 8.0 disables
  (`disabled_storage_engines=MyISAM`). Without an explicit override the
  console installer's `CREATE TABLE ... ENGINE=MyISAM` fails, and — because
  the entrypoint invokes the installer without verbose output — the failure
  is swallowed: the pod reports healthy while every page 500s with `table
  settings_global not found`. The module sets `DB_MYSQL_ENGINE=InnoDB` and
  `DBENGINE=InnoDB` to avoid this.
- **Single replica by default.** `min_instance_count = 1`,
  `max_instance_count = 1`. LimeSurvey keeps PHP session state; do not scale
  beyond 1 without verifying shared-storage/session behaviour.
- **NFS is enabled by default** (`enable_nfs = true`, mounted at
  `/var/www/html/upload`) so uploaded survey assets, imports, and exports
  persist and are shared across pods.
- **Session affinity is `ClientIP`** so a client's requests reach the same
  pod.
- **First-boot auto-install (no separate migration job).** The upstream
  `martialblog/limesurvey` entrypoint runs LimeSurvey's console installer /
  `updatedb` on first container start once `db-init` has provisioned the
  database and user.
- **`ADMIN_PASSWORD` is generated automatically** and stored in Secret
  Manager. It seeds the first-run super-admin account (fixed username
  `admin`, `ADMIN_EMAIL = admin@techequity.cloud`); the martialblog entrypoint
  exits if `ADMIN_PASSWORD` is missing.
- **`PUBLIC_URL` is not preset on GKE.** The `limesurvey_app` module call in
  `limesurvey.tf` does not forward a `service_url`, so `PUBLIC_URL` is only
  injected when you explicitly set it via `environment_variables` — do so
  once the external LoadBalancer IP or custom domain is known so absolute
  links resolve correctly.
- **`application_version = "latest"` maps to a pinned base tag.** The
  Dockerfile keys the base image on an app-specific `LIMESURVEY_VERSION`
  build arg (not the generic `APP_VERSION`, which the Foundation injects into
  `build_args` and would otherwise clobber to `"latest"`); `"latest"` resolves
  to `6-apache`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the LimeSurvey workload

LimeSurvey pods are scheduled on Autopilot, which bills for the CPU/memory the
pods actually request. The workload runs as a Deployment (no NFS-forced
`Recreate` override is set for this app, so verify the effective strategy
before assuming rolling updates are safe with `max_instance_count > 1`).

- **Console:** Kubernetes Engine → Workloads → select the LimeSurvey
  workload for pods, revisions, and events. Kubernetes Engine → Services &
  Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for MySQL 8.0

LimeSurvey stores all survey data (surveys, questions, responses, users,
settings) in a managed Cloud SQL for MySQL 8.0 instance. Pods reach it through
the **Cloud SQL Auth Proxy** sidecar on `127.0.0.1:3306`; no public IP is
exposed. On first deploy the `db-init` job creates the application database,
user, and grants; the LimeSurvey console installer then creates the schema
using the forced `InnoDB` engine.

- **Console:** SQL → select the instance for connections, backups, flags,
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and the Secret Manager secret holding the
password are all in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md) for
the connection model, automated backups, and password rotation.

### C. Cloud Storage & NFS file persistence

Two Cloud Storage buckets are provisioned by default (a generic `data`
bucket from the Group 14 variable default, and a `limesurvey-uploads` bucket
supplied by `LimeSurvey_Common`); neither is mounted into the pod unless you
add an entry to `gcs_volumes`. The actual survey upload/export tree lives on
**NFS (Cloud Filestore)** at `/var/www/html/upload`, shared across pods.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~limesurvey"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Secret Manager

One LimeSurvey-specific secret is generated automatically and stored in
Secret Manager: `ADMIN_PASSWORD` (the first-run super-admin password, 20
characters, no special characters). The database password is managed
separately by the foundation. On GKE, secrets are projected into pods via the
Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~limesurvey"
  gcloud secrets versions access latest --secret=secret-<resource-prefix>-limesurvey-admin-password --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing
IP (`service_type = LoadBalancer`, `reserve_static_ip = true` so the address
survives redeploys). A custom domain with a Google-managed certificate can be
enabled.

- **Console:** Network services → Load balancing; VPC network → IP
  addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to
Cloud Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards /
  Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. LimeSurvey Application Behaviour

- **First-deploy database setup.** The `db-init` job runs `db-init.sh` using
  `mysql:8.0-debian`. It prefers a Cloud SQL Unix socket if one is present
  under `/cloudsql`, otherwise falls back to TCP via `DB_IP`/`DB_HOST`,
  idempotently creates the application database, user, and grants, verifies
  the app user can connect, then shuts down the proxy sidecar via the
  `quitquitquit` admin endpoint (falling back to `SIGKILL`). The job is safe
  to re-run (`execute_on_apply = true`, `max_retries = 3`).
- **First-boot auto-install (no separate migration job).** With the database
  provisioned, the martialblog image's own entrypoint generates
  `application/config/config.php` from the environment and runs LimeSurvey's
  console installer / `updatedb` on first pod start, creating the schema in
  the empty database using the forced `InnoDB` engine.
- **Admin account.** The installer creates a super-admin with the fixed
  username `admin` (`ADMIN_NAME = "Administrator"`,
  `ADMIN_EMAIL = admin@techequity.cloud`) and the generated `ADMIN_PASSWORD`
  secret. Retrieve it before first login.
- **DB env-var aliasing on loopback.** The variant sets
  `db_user_env_var_name = "DB_USERNAME"`, `db_password_env_var_name =
  "DB_PASSWORD"`, and `db_name_env_var_name = "DB_NAME"` so the
  tenant-scoped values the Foundation injects land on the names the
  martialblog entrypoint expects; `limesurvey.tf` overrides `DB_HOST` to
  `127.0.0.1` (the Auth Proxy sidecar).
- **`DB_MYSQL_ENGINE` / `DBENGINE` are forced to `InnoDB`.** This avoids the
  silent install failure described in [Overview](#1-overview) — Cloud SQL for
  MySQL 8.0 disables MyISAM, the image's own default.
- **Set `PUBLIC_URL` after the IP is known.** It is not preset on GKE — patch
  the deployment or set `environment_variables` to the external URL once the
  LoadBalancer IP or custom domain is assigned:
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"limesurvey","env":[
      {"name":"PUBLIC_URL","value":"https://survey.example.com"}]}]}}}}'
  ```
- **Health path.** Startup probe is **TCP** on `/` (30s initial delay, 10s
  timeout, 15s period, 20 failures — generous for first-boot install).
  Liveness probe is **HTTP** `GET /` (300s initial delay, 60s timeout, 60s
  period, 3 failures) once LimeSurvey is serving requests. Allow several
  minutes on first boot for the installer.
- **Inspect the init job and running config:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_|ADMIN_|PUBLIC_URL'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for LimeSurvey are listed; every other input
is inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `limesurvey` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `martialblog/limesurvey` base tag; `latest` resolves to the pinned `6-apache` tag via the app-specific `LIMESURVEY_VERSION` build arg. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU minimum. |
| `memory_limit` | `2Gi` | Minimum 512Mi; 2Gi recommended for production. |
| `min_instance_count` | `1` | Keep at 1 to keep the workload reachable. |
| `max_instance_count` | `1` | **Keep at 1** unless session-sharing behaviour is verified. |
| `container_port` | `8080` | The martialblog/limesurvey apache image listens on 8080 (the Cloud Run variant uses a different, prebuilt image on port 80). |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar (loopback) — required on GKE. |
| `php_memory_limit` | `512M` | PHP memory limit; raise for large surveys/exports. |
| `upload_max_filesize` / `post_max_size` | `64M` | Max upload / POST size; keep `post_max_size ≥ upload_max_filesize`. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the LimeSurvey UI. |
| `workload_type` | `null` → `Deployment` | Deployment. |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |

### Group 10 — Observability

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `TCP /`, 30s delay, 20 failures | Generous first-boot window for the console installer. |
| `liveness_probe` | `HTTP /`, 300s delay, 3 failures | The `/` landing page returns 200 once LimeSurvey is serving requests. |

### Group 13 — NFS Storage

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS is on by default so uploaded survey assets persist and are shared. |
| `nfs_mount_path` | `/var/www/html/upload` | Where LimeSurvey stores uploads/exports/runtime data. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | Generic Group 14 default bucket; a second `limesurvey-uploads` bucket is added by `LimeSurvey_Common`'s `module_storage_buckets`. Neither is mounted by default. |
| `gcs_volumes` | `[]` | No GCS Fuse mount by default — persistence goes through NFS instead. |

### Group 16 — Database Configuration

| Variable | Default | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` (forced by Common) | Only MySQL 8.0 is supported. |
| `application_database_name` | `limesurvey` | Database name. Immutable after first deploy. |
| `application_database_user` | `limesurvey` | Application database user; password auto-generated in Secret Manager. |

### Group 19 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `application_domains` | `[]` | Custom hostnames + managed certificate. |

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
| `service_url` | URL to reach LimeSurvey. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
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

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_GKE](App_GKE.md) foundation engine, which validates values
> *and combinations* at plan time — a `StatefulSet` forced alongside a
> stateless setting, IAP with no authorized identities, `quota_memory_*`
> given as bare integers, an out-of-range `container_port`/
> `backup_retention_days`. Invalid configuration fails the **plan** with a
> clear, named error before any resource is created, so most mistakes below
> are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `null` (→ forced `MYSQL_8_0`) | Critical | Only MySQL 8.0 is supported by the entrypoint and schema. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all data. |
| DB engine env vars (`DB_MYSQL_ENGINE`/`DBENGINE`) | Leave as `InnoDB` (module default) | Critical | Reverting to the image's MyISAM default breaks table creation on Cloud SQL — the pod looks healthy but every page 500s. |
| `enable_nfs` | `true` | High | Disabling it makes uploaded survey assets/exports ephemeral — lost on pod recreation. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar on `127.0.0.1:3306` is required for DB connectivity on GKE. |
| `max_instance_count` | `1` | High | Scaling beyond 1 without verified session-sharing behaviour risks split sessions. |
| `session_affinity` | `ClientIP` | High | Without stickiness, requests bounce between pods and disrupt authenticated sessions. |
| `PUBLIC_URL` (set after IP known) | External LoadBalancer/domain URL | High | A missing or wrong public URL breaks absolute links and asset resolution. |
| `memory_limit` | `2Gi` | High | Below 512Mi the PHP/Apache pod OOMs under load. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `ADMIN_PASSWORD` (auto-generated) | Retrieve before first login | Medium | Not knowing it locks you out of the first super-admin account until reset via the DB. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and `PUBLIC_URL`. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. LimeSurvey-specific application configuration
shared with the Cloud Run variant (secret generation, the `db-init` job, NFS
upload storage, and the DB env-var mapping) is described in
**[LimeSurvey_Common](LimeSurvey_Common.md)**.
