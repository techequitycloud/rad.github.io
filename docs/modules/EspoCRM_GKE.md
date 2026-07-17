---
title: "EspoCRM on GKE Autopilot"
description: "Configuration reference for deploying EspoCRM on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# EspoCRM on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/EspoCRM_GKE.png" alt="EspoCRM on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

EspoCRM is an open-source, GPLv3-licensed Customer Relationship Management (CRM) platform
built on PHP and Apache. This module deploys EspoCRM on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud and
Kubernetes infrastructure.

This guide focuses on the cloud services EspoCRM uses and how to explore and operate them
from the Google Cloud Console and the command line. For the mechanics that are common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer
to the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

EspoCRM runs as a PHP/Apache web workload. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Apache/PHP pods, 1 vCPU / 2 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for MySQL 8.0 | Required — EspoCRM does not support PostgreSQL; reached via the Auth Proxy sidecar |
| Object storage | Cloud Storage + NFS (Filestore) | `espocrm-data` bucket; shared NFS mounted at `/var/lib/espocrm` for uploads |
| Cache | Redis (optional) | Optional object cache; disabled by default |
| Secrets | Secret Manager | Auto-generated `ESPOCRM_ADMIN_PASSWORD`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed by the shared application
  layer (`database_type = "MYSQL_8_0"`); EspoCRM does not support PostgreSQL.
- **The database is reached through the Auth Proxy sidecar on loopback.** The GKE variant
  overrides `DB_HOST = "127.0.0.1"` so EspoCRM dials the co-located Cloud SQL Auth Proxy
  sidecar on `127.0.0.1:3306`; `enable_cloudsql_volume = true` by default.
- **The admin account is bootstrapped automatically.** The upstream installer creates the
  `admin` user with the auto-generated `ESPOCRM_ADMIN_PASSWORD` on first boot — retrieve
  it from Secret Manager to log in.
- **Schema is created on first boot, not by a migrate job.** `db-init` creates the
  database and user; the upstream `docker-entrypoint.sh` then runs the install/migrate
  action automatically when the pod starts.
- **NFS is enabled by default.** `enable_nfs = true` mounts a shared Filestore volume at
  `/var/lib/espocrm`, so EspoCRM's uploaded attachments and runtime data persist across
  pod restarts and are shared between replicas.
- **Single replica by default.** `min_instance_count = 1`, `max_instance_count = 1` — GKE
  keeps at least one pod running (no scale-to-zero) so the CRM is always reachable.
- **Session affinity is `ClientIP` by default**, routing a client's requests to the same
  pod — useful once you scale beyond one replica.
- **`ESPOCRM_SITE_URL` is derived from the service URL** so EspoCRM's absolute links and
  installer checks use the reachable host rather than `localhost`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other identifiers
are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the EspoCRM workload

EspoCRM pods are scheduled on Autopilot, which bills for the CPU/memory the pods actually
request. Horizontal Pod Autoscaling sizes the deployment between the minimum and maximum
replica counts. Because the app is NFS-backed, the foundation uses the `Recreate` update
strategy so two pods never write the same NFS volume during a rollout.

- **Console:** Kubernetes Engine → Workloads → select the EspoCRM workload to see pods and
  events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for MySQL 8.0

EspoCRM stores all application data (contacts, leads, opportunities, activities, users) in
a managed Cloud SQL for MySQL 8.0 instance. Pods reach it privately through the **Cloud SQL
Auth Proxy** sidecar bound to `127.0.0.1:3306`; no public IP is exposed. On first deploy an
initialization Job creates the application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the password
are all surfaced in the [Outputs](#5-outputs). For the connection model, automated backups,
and password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Storage & NFS

A dedicated **Cloud Storage** bucket (`espocrm-data`) is provisioned automatically, and a
shared **NFS (Filestore)** volume is mounted at `/var/lib/espocrm` for EspoCRM's uploaded
attachments and runtime data. The workload service account is granted access to the bucket.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /var/lib/espocrm
  ```

See [App_GKE](App_GKE.md) for CMEK options, GCS Fuse mounts, and the NFS server model.

### D. Redis (object cache)

Redis is **disabled by default**. When `enable_redis = true` is set, `REDIS_HOST` and
`REDIS_PORT` are injected and EspoCRM uses Redis as its object cache backend to reduce
database load. When `redis_host` is left empty and `enable_nfs` is true, the NFS server
VM's IP is used as the Redis endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the Redis env injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  ```

### E. Secret Manager

The first-run admin password (`ESPOCRM_ADMIN_PASSWORD`) is generated automatically and
stored in Secret Manager, then injected into the pod as a secret env var via the Secret
Store CSI driver. The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~espocrm-admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`). A custom domain with a Google-managed certificate can be
enabled, and a static IP can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available. The `cloud-entrypoint.sh`
prints the resolved `ESPOCRM_DATABASE_*` and `ESPOCRM_SITE_URL` values at pod start — a
quick way to confirm the DB host and site URL.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. EspoCRM Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `mysql:8.0-debian`. It resolves the Cloud SQL connection (Auth Proxy socket if present,
  otherwise TCP), idempotently creates the application database and user, grants
  privileges, and verifies the app user can connect (warming the MySQL 8
  `caching_sha2_password` auth cache). The job runs on apply and is safe to re-run.
- **Schema created on first boot.** There is no separate migrate job. Once `db-init` has
  provisioned the database, the upstream EspoCRM `docker-entrypoint.sh` runs the
  install/migrate action automatically on pod start, creating the schema and the `admin`
  user.
- **Admin login is auto-generated.** The `admin` user's password comes from the
  `ESPOCRM_ADMIN_PASSWORD` secret. Retrieve it before your first login:
  ```bash
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-espocrm-admin-password" --project "$PROJECT"
  ```
  Change it in the EspoCRM UI (Administration → Users) once you are in.
- **Uploads persist on NFS.** With `enable_nfs = true` (default), EspoCRM's attachments and
  runtime data live under the shared `/var/lib/espocrm` Filestore mount, surviving pod
  restarts and shared across replicas.
- **Site URL must match the reachable host.** EspoCRM builds absolute links from
  `ESPOCRM_SITE_URL`; the entrypoint sets it from the service URL. After the LoadBalancer
  IP or custom domain is known, ensure the site URL reflects the external host so links and
  OAuth redirects are correct.
- **Health path.** Both the startup and liveness probes are `HTTP GET /` — EspoCRM serves
  its login page there unauthenticated (`200`). The startup probe (`startup_probe_config`)
  defaults to a 10-second initial delay, 10-second period, and 3-failure threshold; the
  liveness probe (`health_check_config`) defaults to a 15-second initial delay, 30-second
  period, and 3-failure threshold. These are noticeably tighter than the Cloud Run
  variant's defaults — on a slow first boot (the install/migrate step), pods can flap
  before EspoCRM finishes initializing; raise the initial delay / failure threshold via
  `startup_probe_config` / `health_check_config` if you see this.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for EspoCRM are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `espocrm` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Image tag for `espocrm/espocrm`; `latest` is pinned internally to `10.0.2`. Pin to a specific release in production. |
| `php_memory_limit` | `512M` | PHP memory limit; raise for heavy plugins or large media. |
| `upload_max_filesize` / `post_max_size` | `64M` | Upload / POST size limits; `post_max_size` must be ≥ `upload_max_filesize`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per pod; minimum 1 vCPU for EspoCRM + MySQL. |
| `memory_limit` | `2Gi` | Memory per pod; minimum 512Mi (PHP 8.x). |
| `min_instance_count` | `1` | Minimum replicas; GKE keeps ≥ 1 so the CRM is always reachable. |
| `max_instance_count` | `1` | Maximum replicas. Increase only with shared NFS + `ClientIP` affinity confirmed. |
| `container_port` | `80` | Apache listens on port 80. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar (loopback `127.0.0.1:3306`). |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `null` (Deployment) | `Deployment` (default) or `StatefulSet` with per-pod PVCs. |
| `session_affinity` | `ClientIP` | Sticky routing to the same pod. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Mount a shared Filestore volume for EspoCRM uploads/runtime data. |
| `nfs_mount_path` | `/var/lib/espocrm` | Container mount path for the NFS volume. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis as EspoCRM's object cache backend. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP. |
| `redis_port` | `6379` | Redis port. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `null` variable default → effectively `MYSQL_8_0` (EspoCRM_Common always sets `MYSQL_8_0` in its `config` output; this variant's own `database_type` variable only overrides it when explicitly set to a non-null value) | Cloud SQL engine. EspoCRM requires MySQL — do not select PostgreSQL. |
| `application_database_name` | `espocrm` | MySQL database name. Immutable after first deploy. |
| `application_database_user` | `espocrm` | Application database user. Password auto-generated in Secret Manager. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate and
explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach EspoCRM. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — binary-unit memory quotas, a `StatefulSet` conflict, IAP with no authorized identities, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critical | EspoCRM only supports MySQL; selecting PostgreSQL breaks startup. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `ESPOCRM_ADMIN_PASSWORD` (auto-generated) | Retrieve from Secret Manager; change in UI | Critical | Only sets the admin password on the **first** install; losing it locks you out until reset via DB. |
| `enable_nfs` | `true` | Critical | Disabling it stores uploads on ephemeral pod disk — attachments are lost on pod restart/reschedule. |
| `DB_HOST` (overridden to `127.0.0.1`) | Leave as-is | High | EspoCRM dials the Auth Proxy sidecar on loopback; changing it breaks DB connectivity. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for MySQL connectivity on GKE. |
| `ESPOCRM_SITE_URL` (auto-derived) | External LoadBalancer / custom-domain URL | High | A wrong site URL breaks absolute links, the installer check, and OAuth redirects. |
| `memory_limit` | `2Gi` | High | Below 512Mi PHP 8.x OOM-kills during install/migrate and under load. |
| `max_instance_count` | `1` unless affinity + NFS confirmed | High | Scaling with a `RollingUpdate` on an NFS-backed app can deadlock; the foundation uses `Recreate` for NFS apps. |
| `session_affinity` | `ClientIP` | Medium | Without stickiness, multi-replica sessions bounce between pods. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `enable_iap` | only when public UI not needed | Medium | IAP requires Google sign-in for every request, including API integrations. |
| `application_version` | Pin in production | Medium | `latest` maps to a pinned tag internally, but pinning explicitly avoids surprise upgrades on redeploy. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. EspoCRM-specific
application configuration shared with the Cloud Run variant is described in
**[EspoCRM_Common](EspoCRM_Common.md)**.
