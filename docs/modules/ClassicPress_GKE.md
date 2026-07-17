---
title: "ClassicPress on GKE Autopilot"
description: "Configuration reference for deploying ClassicPress on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# ClassicPress on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ClassicPress_GKE.png" alt="ClassicPress on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

ClassicPress is a free, open-source, business-focused CMS — a lightweight fork of
WordPress 4.9.x that preserves the classic (pre-Gutenberg) editing experience, with
plugins, themes, a media library, and a REST API. This module deploys ClassicPress on
**GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and
manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services ClassicPress uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

ClassicPress runs as a single PHP/Apache web workload built from a thin custom image
`FROM classicpress/classicpress`. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | PHP/Apache pod on port 80, 1 vCPU / 2 GiB by default |
| Workload shape | Kubernetes **StatefulSet** + block PVC | `stateful_pvc_enabled = true` auto-resolves `workload_type` to `StatefulSet`; a 10Gi `standard-rwo` (SSD) PVC is mounted at `/var/www/html` — the whole ClassicPress install (code, plugins, themes, `wp-content`/uploads) lives on this per-pod volume |
| Database | Cloud SQL for MySQL 8.0 | Fixed — `ClassicPress_Common` hardcodes `database_type = "MYSQL_8_0"` |
| File persistence (secondary) | Cloud Filestore (NFS) | Mounted at `/var/lib/classicpress` by default (`enable_nfs = true`) — see the note in [Section 3](#3-classicpress-application-behaviour) on what this path is actually used for |
| Object storage | Cloud Storage | A `classicpress-uploads` bucket is provisioned automatically but is **not** mounted into the pod by default |
| Secrets | Secret Manager | Auto-generated `CLASSICPRESS_SALT_SEED` (derives the 8 WordPress-style auth keys/salts); database password |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; custom domain + managed certificate enabled by default |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory and hardcoded.** `ClassicPress_Common`'s `config` sets
  `database_type = "MYSQL_8_0"` directly; the variant's `database_type` variable
  (default `null`) only takes effect if explicitly overridden, and doing so breaks
  the MySQL-specific `db-init` job and entrypoint. Leave it `null`.
- **Custom build, not prebuilt.** `container_image_source` defaults to `"custom"` —
  Cloud Build produces a thin image `FROM classicpress/classicpress` that grafts an
  entrypoint shim aliasing the Foundation's injected `DB_*` vars onto ClassicPress's
  `CLASSICPRESS_DB_*` and deriving stable auth salts. The stock upstream image is
  never deployed directly.
- **Cloud SQL is reached via the Auth Proxy sidecar on loopback.** The variant sets
  `DB_HOST = 127.0.0.1`; a cloud-sql-proxy sidecar (`enable_cloudsql_volume = true`)
  listens on `127.0.0.1:3306`, and the entrypoint aliases the injected `DB_*` values
  onto `CLASSICPRESS_DB_*` (TCP, no SSL needed for MySQL).
- **Single replica, StatefulSet by default.** `min_instance_count = 1`,
  `max_instance_count = 1`. Each pod gets its own PVC via `stateful_pvc_enabled = true`
  (default), so scaling beyond 1 replica would give each pod a *separate*, unsynced
  copy of the install rather than a shared one.
- **NFS is also enabled by default** (`enable_nfs = true`, mounted at
  `/var/lib/classicpress`), but the grafted entrypoint and Dockerfile never reference
  that path — the actual persistent install lives on the StatefulSet PVC at
  `/var/www/html`. See the pitfalls table.
- **No auto-install — first login is manual.** `ClassicPress_Common` generates no
  admin-password secret and sets no auto-install flag. ClassicPress creates its
  schema and admin account through its own first-run web installer once `db-init`
  has provisioned the empty database.
- **`CLASSICPRESS_SALT_SEED` is generated automatically** and stored in Secret
  Manager; the entrypoint derives all 8 WordPress-style `AUTH_KEY`/`SALT` values from
  it deterministically, so cookies and sessions survive pod restarts.
- **Startup probe is generous (TCP, 20 retries)** to allow time for the upstream
  image's own entrypoint to populate the empty `/var/www/html` PVC on first boot.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the ClassicPress workload

ClassicPress runs as a **StatefulSet** (auto-selected because `stateful_pvc_enabled`
defaults to `true`), scheduled on Autopilot, which bills for the CPU/memory the pod
actually requests. The single replica owns a dedicated `standard-rwo` (SSD) PVC.

- **Console:** Kubernetes Engine → Workloads → select the ClassicPress workload for
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE" --selector 'app~classicpress' 2>/dev/null || \
    kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed, and Group 7 for StatefulSet/PVC mechanics.

### B. Cloud SQL for MySQL 8.0

ClassicPress stores all application data (posts, pages, users, options, plugin/theme
settings) in a managed Cloud SQL for MySQL 8.0 instance. Pods reach it through the
**Cloud SQL Auth Proxy** sidecar on `127.0.0.1:3306`; no public IP is exposed. On
first deploy the `db-init` job creates the application database, user, and grants,
verifies the app user can connect, then shuts the sidecar down.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and the Secret Manager secret holding the
password are all in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the
connection model, automated backups, and password rotation.

### C. Storage — StatefulSet PVC, NFS, and Cloud Storage

Three distinct storage mechanisms are present. The **StatefulSet PVC** (10Gi,
`standard-rwo`, mounted at `/var/www/html`) is the primary and only *confirmed*
persistence path — it holds the entire ClassicPress install, including uploaded
media. **NFS (Cloud Filestore)** is separately mounted at `/var/lib/classicpress`
(`enable_nfs = true`), but neither the Dockerfile nor the entrypoint shim reference
that path — see the pitfalls table. A **Cloud Storage** bucket (suffix
`classicpress-uploads`) is also provisioned but not wired into the pod as a
`gcs_volumes` mount by default; add an entry to `gcs_volumes` to use it.

- **Console:** Kubernetes Engine → Storage → PersistentVolumeClaims; Filestore →
  Instances; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT" --filter="name~classicpress-uploads"
  ```

See [App_GKE](App_GKE.md) Groups 7, 13, and 14 for PVC lifecycle, NFS discovery, and
GCS Fuse mount mechanics.

### D. Secret Manager

One ClassicPress-specific secret is generated automatically and stored in Secret
Manager: `CLASSICPRESS_SALT_SEED`, a 64-character random seed from which the
entrypoint derives all 8 WordPress-style `AUTH_KEY`/`SECURE_AUTH_KEY`/
`LOGGED_IN_KEY`/`NONCE_KEY` and their matching `SALT` values (SHA-256 of the seed
plus a fixed per-key suffix). The database password is managed separately by the
foundation. On GKE, secrets are projected into pods via the Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~classicpress"
  gcloud secrets versions access latest --secret=<db-password-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`, `reserve_static_ip = true` so the address survives
redeploys), and `enable_custom_domain = true` provisions an Ingress resource ready
for a Google-managed certificate once `application_domains` is populated.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
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

## 3. ClassicPress Application Behaviour

- **First-deploy database setup.** The `db-init` job runs `db-init.sh` using
  `mysql:8.0-debian`. It waits for TCP connectivity (or a Cloud SQL socket),
  idempotently creates the application database, user, and grants, verifies the app
  user can connect, then gracefully shuts down the Cloud SQL Auth Proxy sidecar
  (`POST /quitquitquit`, falling back to `SIGKILL`). The job is safe to re-run
  (`execute_on_apply = true`, `max_retries = 3`).
- **No separate migration job — manual first-run install.** There is no
  auto-install flag for ClassicPress. Once `db-init` has provisioned the empty
  database, ClassicPress creates its own schema and admin account through the
  first-run web installer (`/wp-admin/install.php` in the upstream image). Visit the
  service URL after first deploy and complete the installer to set the admin
  username, password, and email — there is no generated admin-password secret.
- **DB env-var aliasing on loopback.** The Foundation injects `DB_HOST = 127.0.0.1`
  (the proxy sidecar), `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`; ClassicPress
  reads `CLASSICPRESS_DB_*`. The grafted `entrypoint.sh` builds
  `CLASSICPRESS_DB_HOST` as `host:port` (or a `localhost:<socket>` form if a Cloud
  SQL socket directory is found) and aliases the rest, before handing off to the
  upstream `docker-entrypoint.sh`.
- **Auth keys/salts are derived, not stored individually.** `CLASSICPRESS_SALT_SEED`
  is the only generated secret; the entrypoint computes all 8
  `CLASSICPRESS_AUTH_KEY` / `..._SALT` values as
  `sha256(seed-<key-name>)`, so every restart and every pod (if you ever scale out)
  agrees on the same values without persisting `wp-config.php` state.
- **The install itself lives on the StatefulSet PVC.** The upstream
  `docker-entrypoint.sh` writes `wp-config.php` and copies the ClassicPress
  application into `/var/www/html` on first boot — which on this module is a 10Gi
  `standard-rwo` block PVC, not ephemeral container storage, so the install (plugins,
  themes, and `wp-content/uploads`) survives pod restarts and rescheduling.
- **NFS mount path is not referenced by the image or entrypoint.**
  <!-- TODO: could not confirm whether the upstream classicpress/classicpress image
  itself symlinks wp-content/uploads onto a VOLUME coinciding with
  /var/lib/classicpress; ClassicPress_Common's Dockerfile and entrypoint.sh never
  read or write that path. Treat enable_nfs as spare shared storage, not a
  confirmed data path, until verified against a live deployment. -->
- **Redis is optional and off by default.** When `enable_redis = true`, leaving
  `redis_host` empty lets the Foundation's own `REDIS_HOST` injection (the shared
  NFS-VM Redis IP when `enable_nfs = true`) take effect; setting `redis_host`
  explicitly points ClassicPress at an external Redis/Memorystore instance instead.
- **Health paths.** Startup probe is **TCP** on port 80 with a generous
  `failure_threshold = 20` (first boot copies the whole application onto the empty
  PVC, which can take time); liveness probe is **HTTP** `GET /` with a 300-second
  initial delay — a 200 (installed site) or a 302 redirect to the installer (fresh
  site) both count as healthy.
- **Inspect the init job and running config:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep CLASSICPRESS_DB
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform (by their
`{{UIMeta group=N}}` tag, not by the `.tf` file's section comments, which are
occasionally out of sync with the tags). Only settings specific to or notable for
ClassicPress are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `classicpress` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Maps to the `classicpress/classicpress` image tag. Tags are PHP-qualified (`php8.3-apache`, `php8.4-apache`), not version-qualified; `latest` resolves to a pinned PHP-qualified tag at build time via the app-specific `CLASSICPRESS_VERSION` build arg (the generic `APP_VERSION` build arg the Foundation injects would otherwise silently overwrite it with the literal, non-existent tag `"latest"`). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `custom` | Builds the thin `FROM classicpress/classicpress` image with the grafted entrypoint shim; required — the stock image cannot alias `DB_*` on its own. |
| `cpu_limit` | `1000m` | CPU limit for the ClassicPress container. Increase for high-traffic sites or heavy plugins. |
| `memory_limit` | `2Gi` | Memory limit. WordPress-family apps typically need ≥512Mi; more for large media libraries. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Keep both at 1 — the StatefulSet PVC is per-pod and not shared. |
| `container_port` | `80` | ClassicPress runs on Apache, port 80. |
| `php_memory_limit` | `512M` | PHP memory limit; must be ≤ `memory_limit`. |
| `upload_max_filesize` / `post_max_size` | `64M` | Max upload / POST size; keep `post_max_size ≥ upload_max_filesize`. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar (loopback) — required on GKE. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the ClassicPress UI. |
| `workload_type` | `null` → `StatefulSet` | Auto-resolved because `stateful_pvc_enabled = true`. |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |

### Group 7 — StatefulSet / PVC

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | ClassicPress stores its whole install under `/var/www/html`; enabling this auto-resolves `workload_type` to `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Per-pod PVC size. Raise for large media libraries. |
| `stateful_pvc_mount_path` | `/var/www/html` | Where the ClassicPress install (code + `wp-content`/uploads) lives. |
| `stateful_pvc_storage_class` | `standard-rwo` | SSD-backed Balanced PD; draws the `SSD_TOTAL_GB` regional quota. Override to `standard` (HDD) if quota-constrained. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `{ type: TCP, path: "/", failure_threshold: 20, period_seconds: 15 }` | Generous threshold — first boot populates the empty PVC with the full application. |
| `liveness_probe` | `{ type: HTTP, path: "/", initial_delay_seconds: 300 }` | A 200 or a 302-to-installer both count as healthy. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisions Filestore-backed shared storage; not currently referenced by the entrypoint or Dockerfile — see [Section 3](#3-classicpress-application-behaviour). |
| `nfs_mount_path` | `/var/lib/classicpress` | Container mount path for the (currently unused) NFS share. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enables ClassicPress's WordPress-style object cache backend. |
| `redis_host` | `""` | Leave empty to fall back to the Foundation's own `REDIS_HOST` (the NFS-VM Redis IP when `enable_nfs = true`); set explicitly to use an external Redis/Memorystore instance. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` | Hardcoded in `ClassicPress_Common`; leave `null`. Overriding it breaks the MySQL-specific `db-init` job and entrypoint. |
| `application_database_name` | `classicpress` | Database name. Immutable after first deploy. |
| `application_database_user` | `classicpress` | Application database user; password auto-generated in Secret Manager. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisions an Ingress ready for a managed certificate once `application_domains` is set. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `application_domains` | `[]` | Custom hostnames — empty by default; add one to activate the managed certificate. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

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
| `service_url` | URL to reach ClassicPress. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (including `classicpress-uploads`). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `StatefulSet` forced alongside a stateless setting, IAP with no authorized identities, `quota_memory_*` given as bare integers, an out-of-range `container_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime. ClassicPress also runs its own preconditions (`validation.tf`) for `upload_max_filesize ≤ post_max_size`, `min_instance_count ≤ max_instance_count`, Redis without a host source, IAP without OAuth credentials, and `enable_cloudsql_volume` with `database_type = "NONE"`.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critical | `ClassicPress_Common`'s `db-init` job and entrypoint are MySQL-specific; overriding to a Postgres/SQL Server engine breaks both. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all data. |
| `CLASSICPRESS_SALT_SEED` (auto-generated) | Never change | Critical | Changing the seed after first boot invalidates all signed cookies and logged-in sessions. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` | `10Gi` / `/var/www/html` | Critical | This PVC holds the entire install (code + uploads) — resizing down or losing the PVC destroys the site; the mount path must match where ClassicPress's entrypoint writes. |
| `max_instance_count` | `1` | High | Each StatefulSet pod gets its own PVC; scaling beyond 1 gives every replica a separate, diverging copy of the site rather than a shared one. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar on `127.0.0.1:3306` is required for DB connectivity on GKE. |
| `enable_nfs` | `true` (but currently unused by the app) | Medium | Provisions and pays for a Filestore instance that the current entrypoint/Dockerfile never mount data onto — see [Section 3](#3-classicpress-application-behaviour). Disabling it does not remove any confirmed persistence, but confirm against a live deployment before relying on this. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Medium | Draws the tight regional `SSD_TOTAL_GB` quota. Override to `standard` (HDD `pd-standard`) on quota-constrained projects — fine for a low-IOPS PHP/MySQL workload. |
| First-run admin setup | Complete `/wp-admin/install.php` promptly after deploy | Medium | Until the installer runs, the site has no schema and no admin account — there is no generated admin-password secret to recover with. |
| `memory_limit` | `2Gi` | Medium | Below ~512Mi the PHP/Apache pod risks OOM under load or with heavier plugins. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and any hardcoded site URL. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
ClassicPress-specific application configuration shared with the Cloud Run variant is
described in the `ClassicPress_Common` module (no standalone `ClassicPress_Common.md`
guide exists yet in this docs set).
