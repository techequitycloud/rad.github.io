---
title: "Xibo GKE Module — Configuration Guide"
description: "Configuration reference for deploying Xibo on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Xibo GKE Module — Configuration Guide

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Xibo_GKE.png" alt="Xibo on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

This guide describes every configuration variable available in the `Xibo_GKE` module. `Xibo_GKE` is a **wrapper module** that combines the generic [`App_GKE`](./App_GKE.md) infrastructure module with the [`Xibo_Common`](./Xibo_Common.md) shared application configuration to deploy the [Xibo](https://xibosignage.com/) CMS — open-source digital signage that schedules and distributes layouts, playlists and media to networks of display players — on Google Kubernetes Engine (GKE) Autopilot.

Most configuration options in `Xibo GKE` map directly to the same options in `App GKE`. Where a variable is identical in behaviour, this guide references the `App GKE` guide rather than repeating the same documentation. Only the variables and defaults that are **specific to Xibo** are described in full here.

> **Note:** Variables marked as *platform-managed* are set and maintained by the platform. You do not normally need to change them.

> **GKE only:** Xibo's media library (`/var/www/cms/library`) holds every uploaded file and the player OAuth signing certificates, and Apache serves it with XSendFile, which needs real POSIX file semantics. That is why Xibo is offered on GKE, where the library can sit on a persistent volume, rather than on Cloud Run.

> **Read [Group 7](#group-7-stateful-workloads) before your first deploy.** With the module's defaults the media library is **not** persisted.

---

## Standard Configuration Reference

The following configuration areas are provided by the underlying `App_GKE` module. Consult the linked sections of the [App_GKE Configuration Guide](./App_GKE.md) for full documentation.

| Configuration Area | App_GKE Guide Section | Xibo-Specific Notes |
|---|---|---|
| Project & Identity | Group 1 — Project & Identity | Identical. |
| Application Identity | Group 3 — Application Identity | Display-name defaults are scaffolding residue; see [Group 3](#group-3-application-identity). |
| Runtime & Scaling | Group 4 — Runtime & Scaling | Custom build from `ghcr.io`; `container_port = 80`; see [Group 4](#group-4-runtime--scaling). |
| Environment Variables & Secrets | Group 5 — Environment Variables & Secrets | Module-set `MYSQL_*` / `CMS_*` variables; see [Group 5](#group-5-environment-variables--secrets). |
| GKE Backend Configuration | Group 6 — GKE Backend Config | `service_type = "ClusterIP"`; see [Group 6](#group-6-gke-backend-configuration). |
| Stateful Workloads | Group 7 — StatefulSet / PVC | **Required to persist the media library**; see [Group 7](#group-7-stateful-workloads). |
| Initialization Jobs & CronJobs | Group 11 — Workload Automation | `db-init` supplied by `Xibo Common`; see [Group 11](#group-11-workload-automation). |
| Storage — NFS | Group 13 — NFS Storage | Mounted by default at `/mnt/nfs`, unused by Xibo; see [Group 13](#group-13-nfs). |
| Storage — GCS | Group 14 — Cloud Storage | Two buckets created, unused by Xibo; see [Group 14](#group-14-cloud-storage). |
| Database Configuration | Group 16 — Database Configuration | **MySQL 8.0, fixed**; see [Group 16](#group-16-database). |
| Backup Schedule & Retention | Group 17 — Backup & Maintenance | Identical. |
| Custom SQL Scripts | Group 18 — Custom SQL Scripts | Identical. |
| Observability & Health Checks | Group 10 — Observability | Probes on `/login`, and they reach the deployed container; see [Group 10](#group-10-observability--health). |
| Cloud Armor WAF | Group 21 — Cloud Armor & CDN | Identical. |
| Identity-Aware Proxy | Group 20 — Identity-Aware Proxy | Players must still reach the CMS; see [Groups 20–22](#groups-2022-iap-cloud-armor-vpc-service-controls). |
| Binary Authorization | Group 12 — CI/CD | Identical. |
| VPC Service Controls | Group 22 — VPC Service Controls & Audit Logging | Identical. |
| Secrets Store CSI Driver | Group 5 — Environment Variables & Secrets | Always enabled — no configuration required. |
| Traffic & Ingress | Group 19 — Access & Networking | Identical. |
| Custom Domain & Static IP | Group 19 — Access & Networking | Set `CMS_SERVER_NAME` for a custom domain; see [Group 19](#group-19-custom-domain--networking). |
| Cloud Build Triggers | Group 12 — CI/CD | Identical. |
| Cloud Deploy Pipeline | Group 12 — CI/CD | Identical. |
| Image Mirroring | Group 4 — Runtime & Scaling | Identical. |
| Pod Disruption Budgets | Group 9 — Reliability | Enabled by default. |
| Auto Password Rotation | Group 16 — Database Configuration | See [Group 16](#group-16-database). |
| Redis Cache | Group 15 — Redis Cache | Not used by Xibo. |
| Backup Import | Group 17 — Backup & Maintenance | Identical. |

---

## How Xibo GKE Relates to App GKE

`Xibo GKE` passes its variables through to `App GKE` and adds a `Xibo Common` sub-module that supplies Xibo-specific configuration. The main effects are:

1. **A thin custom image from ghcr.io.** `Xibo Common` supplies a Dockerfile, `FROM ghcr.io/xibosignage/xibo-cms:${XIBO_VERSION}`, that adds one wrapper entrypoint. `XIBO_VERSION` is set from `application_version` (an app-specific build argument, so the Foundation's generic `APP_VERSION` cannot override it). Docker Hub's `xibosignage/xibo-cms` is abandoned (newest tag `release23`, 2023) and never received Xibo 4.x.
2. **MySQL 8.0 is fixed.** `Xibo Common` sets `database_type = "MYSQL_8_0"` in the application config, which is what `App GKE` provisions whatever the wrapper's own `database_type` says.
3. **TCP to the private IP, not the socket.** The wrapper entrypoint exports `MYSQL_HOST = $DB_IP`, `MYSQL_PORT = ${DB_PORT:-3306}`, `MYSQL_DATABASE`, `MYSQL_USER` and `MYSQL_PASSWORD`, then hands off to Xibo's own `/entrypoint.sh`. `DB_HOST` can be a socket directory, which Xibo cannot use. `Xibo Common` therefore fixes `enable_cloudsql_volume = false`.
4. **Non-interactive install.** Xibo's entrypoint creates the database if absent and runs the full phinx install/upgrade on every boot. The `db-init` job exists only to create the MySQL user and database with Cloud SQL MySQL 8's `caching_sha2_password` handled correctly.
5. **Three corrected image defaults.** `MYSQL_ATTR_SSL_VERIFY_SERVER_CERT = "false"` (the image demands verification with no CA, so PDO refuses Cloud SQL as shipped); `CMS_PHP_COOKIE_SECURE = "On"` (the container only sees HTTP behind the TLS-terminating Gateway); `CMS_SERVER_NAME` derived from the service URL instead of the shipped `localhost`.
6. **Probes on `/login`.** Xibo has no health endpoint; the Foundation's generic `/healthz` returns 404 and would restart a healthy pod. `/login` returns 200 and proves the CMS rendered. `Xibo GKE` forwards `startup_probe_config`/`health_check_config` into `Xibo Common`, so these are the probes actually deployed.
7. **The web Service is ClusterIP.** The CMS is published through the L7 Gateway; a `LoadBalancer` Service would spend a second external IP on the same HTTP surface.

---

## Group 1: Project & Identity

Identical to `App_GKE`. See [App_GKE](./App_GKE.md#group-1--project--identity). `project_id` (required), `tenant_id` (`"demo"`), `region` (`"us-central1"`, fallback when subnet discovery finds nothing).

---

## Group 2: Deployment Environment

Identical to `App_GKE`: `support_users` (`[]`), `resource_labels` (`{}`).

---

## Group 3: Application Identity

| Variable | Xibo GKE Default | Notes |
|---|---|---|
| `application_name` | `"xibo"` | Base name for all resources. **Do not change after deployment.** |
| `application_display_name` | `"Wiki.js"` | **Scaffolding residue** from the module this wrapper was cloned from. It is passed to `Xibo Common` as `display_name` and becomes the application display name. Set it to something like `"Xibo CMS"`. |
| `application_description` | `"Wiki.js - The most powerful and extensible open source Wiki software"` | Also scaffolding residue; change it freely. |
| `application_version` | `"release-4.5.2"` | Tag on `ghcr.io/xibosignage/xibo-cms`, used as the build's `XIBO_VERSION`. Pin an exact release: a rebuild under an unchanged tag produces no Terraform diff and therefore no rollout. |

---

## Group 4: Runtime & Scaling

| Variable | Xibo GKE Default | Notes |
|---|---|---|
| `container_image_source` | `"custom"` | Builds the wrapper image via Cloud Build. |
| `container_image` | `"ghcr.io/xibosignage/xibo-cms"` | Base image reference. |
| `container_port` | `80` | Fixed by `Xibo Common` — Apache on 80; the entrypoint never reads `$PORT`. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | Only the limits are forwarded. |
| `min_instance_count` | `1` | — |
| `max_instance_count` | `3` | **Set to `1`.** Each replica would have its own library (see Group 7). |
| `enable_cloudsql_volume` | `true` | **Has no effect.** `Xibo Common` fixes the application config to `false` and Xibo connects over TCP. |

The remaining runtime variables (`deploy_application`, `container_build_config`, `enable_image_mirroring`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels`) behave as described in [App_GKE](./App_GKE.md#group-4--runtime--scaling).

---

## Group 5: Environment Variables & Secrets

`Xibo Common` sets these on the container; `environment_variables` entries are merged **over** them, so you can override any of them.

| Variable | Value | Purpose |
|---|---|---|
| `MYSQL_PORT` | `"3306"` | Database port (the entrypoint re-exports it from `DB_PORT` when set). |
| `MYSQL_ATTR_SSL_VERIFY_SERVER_CERT` | `"false"` | Cloud SQL's private-IP certificate cannot be verified from the container; the image's shipped `true` with no CA makes PDO refuse the connection. Traffic stays on the VPC private range. |
| `CMS_PHP_COOKIE_SECURE` | `"On"` | Secure session cookies behind the TLS-terminating Gateway. |
| `CMS_PHP_MEMORY_LIMIT` | `"512M"` | PHP memory limit (the shipped 256M fails on large layout imports). |
| `CMS_PHP_CLI_MEMORY_LIMIT` | `"512M"` | Same, for PHP CLI. |

**Set by the wrapper entrypoint at start-up:**

| Variable | Source |
|---|---|
| `MYSQL_HOST` | `DB_IP` (private IP) |
| `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` | `DB_NAME`, `DB_USER`, `DB_PASSWORD` (injected by `App GKE`) |
| `CMS_SERVER_NAME` | Only when unset or `localhost`: the host part of `CLOUDRUN_SERVICE_URL`, `GKE_SERVICE_URL` or `SERVICE_URL` (first one present) |

The entrypoint fails fast if `DB_IP`, `DB_NAME`, `DB_USER` or `DB_PASSWORD` is missing.

**Useful overrides:**

| Variable | When |
|---|---|
| `CMS_SERVER_NAME` | Serving on a custom domain — Xibo writes it into player configuration and outbound links. |
| `CMS_PHP_MEMORY_LIMIT` / `CMS_PHP_CLI_MEMORY_LIMIT` | Very large imports. |
| `XMR_HOST` | Only if you run Xibo's XMR push server separately — this module does not deploy one. |

**Secrets.** Xibo mints no application secrets of its own. The only credentials are the database password (`DB_PASSWORD`) and the root password used by `db-init`, both created and injected by `App GKE`. `secret_environment_variables`, `secret_rotation_period`, `secret_propagation_delay` and `protect_sensitive_environment_variables` behave as described in [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

---

## Group 6: GKE Backend Configuration

| Variable | Xibo GKE Default | Notes |
|---|---|---|
| `service_type` | `"ClusterIP"` | The Gateway already provides the external address. A `LoadBalancer` here spends a second external IP — which, on a project at its address quota, can leave another module's load balancer `<pending>`. |
| `workload_type` | `null` | Resolves to `"StatefulSet"` when `stateful_pvc_enabled = true`, otherwise `"Deployment"`. |
| `session_affinity` | `"ClientIP"` | — |
| `deployment_strategy` | `null` | Declared but not referenced — no effect. |

`namespace_name`, `enable_network_segmentation` and `termination_grace_period_seconds` (`30`) behave as described in [App_GKE](./App_GKE.md#group-6--gke-backend-config).

---

## Group 7: Stateful Workloads

**This group decides whether uploaded media survives a pod restart.**

Xibo keeps everything that matters on disk under `/var/www/cms/library`: all uploaded media, the `certs/` directory holding the player OAuth signing keys, `brand/`, `playersoftware/` and `temp/`. The database stores the *location*; the files themselves are only on disk.

With the module's defaults nothing is mounted at that path:

| Variable | Default | Effect of the default |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Resolves to `false` → the CMS runs as a `Deployment` with no PVC. |
| `stateful_pvc_mount_path` | `"/data"` | Even with a PVC enabled, it would be mounted at `/data`, not at the library. |

**Recommended settings, applied on the first deploy:**

```hcl
stateful_pvc_enabled       = true
stateful_pvc_mount_path    = "/var/www/cms/library"
stateful_pvc_size          = "20Gi"      # size for your media
stateful_pvc_storage_class = "standard-rwo"
max_instance_count         = 1
```

A StatefulSet's volume claim template cannot be changed in place, so choose the size and class up front. Enabling the PVC on an existing deployment replaces the `Deployment` with a `StatefulSet` whose library starts empty — re-upload media afterwards. GCS Fuse (`gcs_volumes`) is not a suitable substitute for the library because XSendFile needs POSIX semantics.

`stateful_pvc_storage_class` (`"standard-rwo"`), `stateful_headless_service`, `stateful_pod_management_policy`, `stateful_update_strategy` and `stateful_fs_group` (`0`) behave as described in [App_GKE](./App_GKE.md#group-7--statefulset--pvc).

---

## Group 9: Reliability Policies

`enable_pod_disruption_budget` defaults to `true` and `pdb_min_available` to `"1"`. With a single replica, voluntary evictions (node upgrades) wait for the replacement pod.

---

## Group 10: Observability & Health

`startup_probe_config` and `health_check_config` are forwarded into `Xibo Common` as the container's `startup_probe`/`liveness_probe`, so they are the probes actually deployed.

| Probe | Path | Initial delay | Timeout | Period | Failure threshold |
|---|---|---|---|---|---|
| Startup (`startup_probe_config`) | `/login` (HTTP) | 60s | 5s | 10s | 3 |
| Liveness (`health_check_config`) | `/login` (HTTP) | 60s | 5s | 30s | 3 |

Do not change the path to `/healthz` — Xibo returns 404 there. `/` also passes (302 → `/login`), but `/login` returns 200 and proves the CMS rendered.

`uptime_check_config` defaults to `{ enabled = false, path = "/" }`; `alert_policies` behaves as described in [App_GKE](./App_GKE.md#group-10--observability).

---

## Group 11: Workload Automation

When `initialization_jobs` is empty, `Xibo Common` supplies one job:

| Field | Value |
|---|---|
| Job name | `db-init` |
| Image | `mysql:8.0-debian` |
| Script | `Xibo_Common/scripts/db-init.sh` |
| Runs | On apply (`execute_on_apply = true`) |
| Timeout / retries | 600s / 3 |
| CPU / Memory | `1000m` / `512Mi` |

It waits for MySQL on port 3306, creates (or re-passwords) the `xibo` user, creates the `xibo` database, grants all privileges on it, verifies the user can connect, then signals any Cloud SQL Proxy sidecar in the Job pod to exit so the Job can complete. A non-empty `initialization_jobs` list **replaces** this job. `cron_jobs` and `additional_services` behave as described in [App_GKE](./App_GKE.md#group-11--workload-automation).

---

## Group 12: CI/CD & GitHub Integration

Identical to `App_GKE`. See [App_GKE](./App_GKE.md#group-12--cicd).

---

## Group 13: NFS

`enable_nfs` defaults to `true` and mounts the `Services_GCP` NFS share at `nfs_mount_path` (`"/mnt/nfs"`). Xibo does not read or write that path. Other variables behave as described in [App_GKE](./App_GKE.md#group-13--nfs-storage).

---

## Group 14: Cloud Storage

With `create_cloud_storage = true`, two buckets are created: `storage` (declared by `Xibo Common`) and `data` (the wrapper's `storage_buckets` default). An entry in `storage_buckets` with the same `name_suffix` replaces the preset. Xibo does not use either bucket. Image-retention and CMEK variables behave as described in [App_GKE](./App_GKE.md#group-14--cloud-storage).

---

## Group 15: Redis

`enable_redis` defaults to `false`. Xibo is not configured to use Redis by this module.

---

## Group 16: Database

| Variable | Xibo GKE Default | Notes |
|---|---|---|
| `database_type` | `"MYSQL_8_0"` | Feeds the plan-time validation guards only. The engine is fixed at MySQL 8.0 by `Xibo Common`. |
| `application_database_name` | `"xibo"` | Passed to `Xibo Common` as `db_name`. **Do not change after deployment** — a new, empty database would be created. |
| `application_database_user` | `"xibo"` | Passed as `db_user`. Do not change after deployment. |
| `database_password_length` | `32` | Changing it regenerates the password of a live database user. |
| `enable_auto_password_rotation` | `false` | Rotation restarts pods after `rotation_propagation_delay_sec` (`90`). |

`enable_mysql_plugins`/`mysql_plugins` and the `db_*_env_var_name` aliases behave as described in [App_GKE](./App_GKE.md#group-16--database-configuration). The PostgreSQL extension variables do not apply.

---

## Groups 17–18: Backup & Maintenance, Custom SQL

Identical to `App_GKE`. Backups cover the **database only** — media in the library is on the pod's volume (when you configure one), not in Cloud SQL. `backup_schedule` (`"0 2 * * *"`), `backup_retention_days` (`7`), `enable_backup_import` (`false`), `backup_source` (`"gcs"`), `backup_file` (`"backup.sql"`), `backup_format` (`"sql"`), and the `custom_sql_scripts_*` variables.

---

## Group 19: Custom Domain & Networking

Identical to `App_GKE`. See [App_GKE](./App_GKE.md#group-19--access--networking). With `application_domains = []` the Gateway gets a free `nip.io` hostname from its reserved IP, and `CMS_SERVER_NAME` is derived from it.

> **On a custom domain**, also set `CMS_SERVER_NAME = "<your-domain>"` in `environment_variables`. The entrypoint only derives it when it is unset or `localhost`, and Xibo writes it into the configuration players receive.

---

## Groups 20–22: IAP, Cloud Armor, VPC Service Controls

Identical to `App_GKE` — see [App_GKE](./App_GKE.md#group-20--identity-aware-proxy). If you enable IAP, remember that display players also call the CMS and cannot complete a Google sign-in.

---

## Exploring the Deployment

### Google Cloud Console

- **Kubernetes Engine → Workloads**, filtered to the namespace: the CMS workload (a `Deployment`, or a `StatefulSet` when a PVC is enabled) and the `db-init` Job.
- **Kubernetes Engine → Gateways, Services & Ingress**: the ClusterIP Service and the Gateway with its external IP.
- **SQL**: the Cloud SQL MySQL 8.0 instance and the `xibo` database.
- **Cloud Build → History**: the image build from the `Xibo_Common` Dockerfile.
- **Security → Secret Manager**: the database password secret.

### gcloud CLI and kubectl

```bash
gcloud container clusters get-credentials CLUSTER_NAME --region=REGION --project=PROJECT_ID

kubectl get deploy,statefulset,pods,pvc,jobs -n NAMESPACE

# Start-up line printed by the wrapper entrypoint: db host:port/name and server_name
kubectl logs -n NAMESPACE POD_NAME | grep "\[startup\]"

# db-init job output
kubectl logs -n NAMESPACE job/JOB_NAME

# Is anything mounted at the library?
kubectl exec -n NAMESPACE POD_NAME -- df -h /var/www/cms/library

# The login page through the Gateway
curl -s -o /dev/null -w "%{http_code}\n" SERVICE_URL/login
```

---

## Module Outputs

`Xibo GKE` exposes the standard `App_GKE` outputs, including:

| Output | Description |
|---|---|
| `service_name` | Name of the Kubernetes service |
| `service_url` | Service URL (the Gateway `nip.io` URL when no custom domain is set) |
| `service_external_ip` | External LoadBalancer IP (if static IP is reserved) |
| `namespace` | Kubernetes namespace |
| `database_instance_name` | Cloud SQL instance name |
| `database_name` / `database_user` | Application database and user |
| `database_password_secret` | Secret Manager secret name for the database password |
| `storage_buckets` | Created GCS buckets |
| `container_image` | Container image used for the deployment |
| `initialization_jobs` | Created initialization job names |
| `kubernetes_ready` | `true` when the cluster endpoint was reachable and Kubernetes resources were deployed |

---

## Configuration Pitfalls & Sensible Defaults

> Risk levels: **Critical** (data loss, full outage, security breach) — **High** (service unavailable or significant degradation) — **Medium** (degraded function or increased cost) — **Low** (minor impact).

| Variable | Sensible Default | Risk | Consequence of Incorrect Value |
|---|---|---|---|
| `project_id` | _(required)_ | **Critical** | No default — deployment fails immediately. |
| `stateful_pvc_enabled` + `stateful_pvc_mount_path` | `true` + `"/var/www/cms/library"` | **Critical** | Module defaults leave the library on the container filesystem: every uploaded file and the player signing certificates are lost when the pod is replaced. |
| `max_instance_count` | `1` | **High** | More than one replica gives each its own library; media uploaded through one pod is missing on the others. |
| `application_database_name` / `application_database_user` | `"xibo"` | **Critical** | Changing after deployment points the CMS at a new, empty database. |
| `database_password_length` | `32` | **High** | Changing it regenerates a live credential; a mismatch between the secret and the database grant locks the CMS out. |
| `application_version` | `"release-4.5.2"` | **High** | Must exist on `ghcr.io/xibosignage/xibo-cms`. Re-using a tag after rebuilding produces no rollout. |
| `startup_probe_config.path` / `health_check_config.path` | `"/login"` | **High** | `/healthz` returns 404 and the probe restarts a healthy pod in a loop. |
| `environment_variables.MYSQL_ATTR_SSL_VERIFY_SERVER_CERT` | `"false"` (module-set) | **High** | Overriding it to `true` makes PDO refuse the Cloud SQL connection. |
| `CMS_SERVER_NAME` on a custom domain | your domain | **Medium** | Left derived, players and outbound links use the `nip.io` host. |
| Signing in over plain HTTP | use HTTPS | **Medium** | `CMS_PHP_COOKIE_SECURE = "On"`: the browser will not return the session cookie over HTTP, so login appears not to stick. |
| `xibo_admin` password | change on first login | **Critical** | The image seeds a fixed administrator account; the module does not set its password. |
| `application_display_name` | `"Xibo CMS"` | **Low** | The default `"Wiki.js"` is shown in the platform. |
| `service_type` | `"ClusterIP"` | **Medium** | `"LoadBalancer"` spends a second external IP for the same HTTP surface. |
| `enable_cloudsql_volume` | (any) | **Low** | Has no effect for Xibo. |
| `enable_nfs` / `create_cloud_storage` | `true` / `true` | **Low** | Provisioned but unused by Xibo — a small, avoidable cost. |
| `backup_retention_days` | `7` | **Medium** | Database backups only; media on the library volume is not included. |

<!-- related-guides -->

## Related guides

- [Hands-on lab: Xibo on GKE Autopilot](../labs/Xibo_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Xibo Common — Shared Application Configuration](Xibo_Common.md) — the Xibo-specific configuration this module builds on.
