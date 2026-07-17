---
title: "FreeScout on GKE Autopilot"
description: "Configuration reference for deploying FreeScout on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# FreeScout on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/FreeScout_GKE.png" alt="FreeScout on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

FreeScout is a free, self-hosted **help desk and shared-mailbox** platform built on
Laravel (PHP) — it turns shared email inboxes into a collaborative ticket queue with
conversations, tags, saved replies, a customer profile, a REST API, and a plugin
system. This module deploys FreeScout on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud
and Kubernetes infrastructure.

This guide focuses on the cloud services FreeScout uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## 1. Overview

FreeScout runs as a single PHP (nginx + php-fpm) web workload, built as a thin custom
image `FROM tiredofit/freescout`. The deployment wires together a focused set of Google
Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | PHP pods on port 80, 1 vCPU / 2 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for MySQL 8.0 | Required — FreeScout does not support PostgreSQL or other engines |
| Persistent files | Cloud Filestore (NFS) | Enabled by default; mounted at `/var/lib/freescout` for attachments and runtime data |
| Object storage | Cloud Storage | An uploads bucket (`freescout-uploads`) provisioned automatically |
| Cache (optional) | Redis | Optional object cache; disabled by default |
| Secrets | Secret Manager | Auto-generated Laravel `APP_KEY` and first-run `ADMIN_PASS`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer Service, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed by the shared application
  layer (`MYSQL_8_0`); selecting any other engine breaks startup.
- **The Laravel `APP_KEY` is generated automatically** and stored in Secret Manager.
  It encrypts session data and any encrypted database columns (stored mailbox
  credentials, OAuth tokens). **Never rotate it after first boot** — doing so
  permanently invalidates all previously encrypted data.
- **A first-run admin is seeded automatically.** `ADMIN_EMAIL` (default
  `admin@techequity.cloud`) with the generated `ADMIN_PASS` secret creates the first
  administrator on first boot. Change the password in the UI after first login.
- **Cloud SQL is reached over the Auth Proxy sidecar.** `enable_cloudsql_volume`
  defaults to `true`; the GKE variant sets `DB_HOST = "127.0.0.1"` so FreeScout dials
  the loopback proxy on port 3306.
- **NFS is enabled by default** so attachments and runtime files are shared across
  pods and survive rescheduling, mounted at `/var/lib/freescout`.
- **Session affinity is `ClientIP` by default**, keeping a client's requests on the
  same pod — important for the PHP session/UI experience.
- **Minimum 1 replica is maintained** (`min_instance_count = 1`, `max_instance_count = 1`)
  to keep the help-desk endpoint always reachable.
- **Health is signalled on `GET /`.** There is no dedicated JSON health endpoint;
  the startup probe is TCP and the liveness probe is `GET /`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the FreeScout workload

FreeScout pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Because the app is NFS-backed, the foundation deploys it with a
`Recreate` update strategy (not RollingUpdate) so two pods never contend on the same
NFS volume and shared database during an update.

- **Console:** Kubernetes Engine → Workloads → select the FreeScout workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for MySQL 8.0

FreeScout stores all application data (conversations, mailboxes, users, customers,
settings) in a managed Cloud SQL for MySQL 8.0 instance. Pods reach it privately
through the **Cloud SQL Auth Proxy** sidecar bound to `127.0.0.1:3306`; no public IP is
exposed. On first deploy the `db-init` Job creates the application database, user, and
grants; the app then runs its own schema migrations on start.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~freescout"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Filestore (NFS)

FreeScout attachments and runtime files are persisted on an NFS volume mounted at
`/var/lib/freescout` (enabled by default), shared across pods so uploads survive
rescheduling.

- **Console:** Filestore → Instances (a Services_GCP-managed or inline instance).
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc,pv -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for the shared-NFS discovery model and the `Recreate`
strategy used for NFS-backed apps.

### D. Cloud Storage

A dedicated **Cloud Storage** uploads bucket (`freescout-uploads`) is provisioned
automatically; the workload service account is granted access. Additional buckets can
be declared via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~freescout"
  gcloud storage ls gs://<bucket-name>/          # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### E. Redis (optional object cache)

Redis is **disabled by default**. When `enable_redis = true`, `REDIS_HOST`/`REDIS_PORT`
are injected into the pod as an object-cache backend. When `redis_host` is left empty
and `enable_nfs` is true, the NFS server VM's IP is used as the Redis endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  ```

### F. Secret Manager

Two secrets are generated automatically and stored in Secret Manager: the Laravel
`APP_KEY` (encrypts session data and encrypted DB columns) and `ADMIN_PASS` (the
seeded first-run admin password). They are delivered into pods via the Secret Store
CSI driver. The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~freescout"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### G. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`). A custom domain with a Google-managed certificate can
be enabled, and a static IP can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### H. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. FreeScout Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `mysql:8.0-debian`. It connects through the Cloud SQL Auth Proxy, idempotently
  creates the application database and user, grants privileges, and verifies the app
  user can connect. The job is safe to re-run.
- **Migrations run on container start.** There is no separate migration job — the
  tiredofit image runs `php artisan migrate --force` on every container start, so
  upgrading `application_version` applies schema changes on the next boot.
- **First-run admin is seeded.** On first boot the image creates the admin defined by
  `ADMIN_EMAIL` / `ADMIN_FIRST_NAME` / `ADMIN_LAST_NAME` with the `ADMIN_PASS` secret.
  Log in and change the password immediately.
- **`APP_KEY` is immutable after first boot.** The Laravel key is generated once and
  written to Secret Manager. Changing it permanently invalidates all previously
  encrypted data. Only rotate in a planned maintenance window with a full
  re-configuration.
- **`APP_URL` must match the browser host.** FreeScout builds absolute links and its
  `/` routing from `APP_URL`; the entrypoint sets it from the injected
  `GKE_SERVICE_URL`. After the LoadBalancer IP or custom domain is known, set
  `APP_URL`/`SITE_URL` to that external host so links and redirects resolve correctly:
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"freescout","env":[
      {"name":"APP_URL","value":"https://freescout.example.com"},
      {"name":"SITE_URL","value":"https://freescout.example.com"}
    ]}]}}}}'
  ```
  Or set `environment_variables` in the module configuration before deploying.
- **NFS-backed rollouts use `Recreate`.** Because FreeScout is NFS-backed, updates
  fully stop the old pod before starting the new one, avoiding two pods contending on
  the same NFS volume and shared database.
- **Health path.** The startup probe is TCP on the container port (30 s delay, 20
  failures) and the liveness probe is HTTP `GET /` (300 s initial delay). Allow several
  minutes on first boot while migrations run before the pod reports healthy.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for FreeScout are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `freescout` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Base-image tag for the thin build (`latest` pins to `php8.3-1.17.159`); set an explicit tag such as `1.8.170` in production. |
| `php_memory_limit` | `512M` | PHP memory limit; raise for heavy attachment processing. |
| `upload_max_filesize` / `post_max_size` | `64M` | Maximum attachment upload / POST size. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `min_instance_count` | `1` | Minimum replicas; keep at 1 so the endpoint is always reachable. |
| `max_instance_count` | `1` | Keep at 1 unless multi-pod behaviour is confirmed safe (NFS-backed, shared DB). |
| `container_port` | `80` | FreeScout (nginx/php-fpm) listens on port 80. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar for MySQL over loopback (`DB_HOST = 127.0.0.1`); keep `true`. |
| `enable_image_mirroring` | `true` | Mirror the base image into Artifact Registry before the thin build. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings (e.g. `MAIL_*`, or a custom `APP_URL`). Core DB and admin values are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. `APP_KEY` and `ADMIN_PASS` are wired automatically — do not set them here. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `Deployment` | `Deployment` (default) or `StatefulSet`. FreeScout is NFS-backed, so a Deployment with a `Recreate` strategy is used. |
| `session_affinity` | `ClientIP` | Sticky routing keeps a client on one pod for the PHP session/UI. |
| `network_tags` | `["nfsserver"]` | `nfsserver` required when `enable_nfs = true`. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP `/` 30 s delay, 20 failures | Generous window for first-boot migrations. |
| `liveness_probe` | HTTP `GET /` 300 s delay | `GET /` returns 200 once booted; no dedicated health endpoint. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS is **on** by default — persists attachments/runtime files across pods. |
| `nfs_mount_path` | `/var/lib/freescout` | Mount path inside the container. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable a Redis object cache. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` (from Common) | Fixed MySQL 8.0; do not change engine. |
| `application_database_name` | `freescout` | MySQL database name (injected as `DB_DATABASE`). Immutable after first deploy. |
| `application_database_user` | `freescout` | Application DB user (injected as `DB_USERNAME`). Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

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
| `service_url` | URL to reach FreeScout. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
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

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match the app, `quota_memory_*` given as bare integers, `stateful_pvc_enabled` with `workload_type = "Deployment"`, IAP with no authorized identities. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `APP_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it permanently invalidates all previously encrypted data — encrypted mailbox credentials and OAuth tokens can no longer be decrypted. |
| `database_type` | `MYSQL_8_0` | Critical | FreeScout is MySQL-only; a Postgres/other engine breaks startup. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `APP_URL` / `SITE_URL` | External LoadBalancer / domain URL | High | A wrong host breaks absolute links, the `/` routing, and password-reset / email links. |
| `enable_nfs` | `true` | High | Disabling loses shared attachments/runtime files and breaks multi-pod file consistency. |
| `enable_cloudsql_volume` | `true` (GKE) | High | The Auth Proxy sidecar provides the `127.0.0.1:3306` MySQL endpoint; disabling it is blocked by a plan-time validation guard. |
| `session_affinity` | `ClientIP` | High | Without stickiness the PHP session/UI can land on a different pod between requests. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects invalid values. |
| `memory_limit` | `2Gi` | High | Too low OOM-kills the PHP worker under attachment load. |
| `max_instance_count` | `1` | High | Scaling beyond 1 without confirmed shared-storage/session handling can cause inconsistent state across pods. |
| `enable_iap` | only for private deployments | High | IAP blocks all unauthenticated requests, including inbound integration callbacks. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `ADMIN_PASS` (auto-generated) | Change in UI after first login | Medium | The generated password is in Secret Manager; rotate it in-app for a human-owned credential. |
| `application_version` | Pin in production | Medium | `latest` can move the base image under you between deploys. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. FreeScout-specific
application configuration shared with the Cloud Run variant is described in
**[FreeScout_Common](FreeScout_Common.md)**.
