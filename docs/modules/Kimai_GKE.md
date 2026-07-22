---
title: "Kimai on GKE Autopilot"
description: "Configuration reference for deploying Kimai on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Kimai on GKE Autopilot

Kimai is a free, open-source time-tracking application (Symfony/PHP) used by
freelancers and agencies for billable-hours tracking, timesheets, and
reporting that feeds into invoicing. This module deploys Kimai on
**GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which
provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Kimai uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Kimai runs as a Symfony/PHP pod (the official `kimai/kimai2:apache` image,
wrapped in a thin custom build) on GKE Autopilot. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Symfony/PHP pod, 1 vCPU / 2 GiB by default; single replica by default (GKE has no scale-to-zero) |
| Database | Cloud SQL for MySQL 8.0 | Required — `Kimai_Common` fixes the engine; PostgreSQL is not supported |
| Object storage | Cloud Storage | A `storage` bucket, GCS-FUSE-mounted at `/opt/kimai/var/data` for uploaded invoice logos/templates and plugin data |
| Secrets | Secret Manager | Auto-generated `APP_SECRET` (Symfony signing key) and `ADMINPASS` (admin password); database password |
| Ingress | Cloud Load Balancing | External LoadBalancer; custom domain and reserved static IP are supported (see §4 for the defaults this module's own live deployment actually used) |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed by
  `Kimai_Common`; selecting any other engine breaks the deployment.
- **Custom wrapper image is required, not optional.** `container_image_source
  = "custom"` builds a thin image `FROM kimai/kimai2` whose entrypoint composes
  Kimai's single `DATABASE_URL` connection string at container startup from
  Foundation-injected secret values (see §3).
- **`container_port = 8001`**, not port 80 — confirmed via local `docker run`
  testing and live deployment. This is the `:apache` image variant's actual
  listening port.
- **`enable_cloudsql_volume = true`** — this is the **opposite default** from
  `Kimai_CloudRun`. A Cloud SQL Auth Proxy sidecar is injected into the pod
  and listens on `127.0.0.1`; the wrapper entrypoint's `DB_IP` alias resolves
  to that loopback address here, rather than the raw private IP Cloud Run
  uses.
- **Two Secret Manager secrets, generated once.** `APP_SECRET` (Symfony
  CSRF/session signing key) and `ADMINPASS` (initial super-admin password) —
  both re-injected from Secret Manager on every container start, so no
  persistent volume is needed just to keep them stable.
- **No scale-to-zero.** `min_instance_count = 1`, `max_instance_count = 1` by
  default; GKE Autopilot keeps a Deployment's replica count at or above its
  configured minimum.
- **`enable_nfs` defaults `true` but is functionally unused.** It mounts
  Cloud Filestore NFS at `/var/lib/kimai`, but the real persistent storage
  path is the GCS-FUSE-mounted `storage` bucket at `/opt/kimai/var/data`.
  Nothing writes to the NFS mount. Safe to disable.
- **No separate migrate job.** `kimai:install` (schema creation and
  migrations) runs on every container boot, idempotently, as part of the
  vendor's own entrypoint chain — only a single `db-init` job is needed to
  create the database and user beforehand.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Kimai workload

Kimai runs as a single-replica Deployment by default. Autopilot bills for the
CPU/memory the pod actually requests. A Cloud SQL Auth Proxy sidecar runs
alongside the main container (`enable_cloudsql_volume = true`).

- **Console:** Kubernetes Engine → Workloads → select the Kimai workload for
  pods, events, and logs. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -c <service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for MySQL 8.0

Kimai stores all application data (projects, activities, timesheets, users,
invoices) in a managed Cloud SQL for MySQL 8.0 instance. The pod reaches it
privately through a **Cloud SQL Auth Proxy sidecar** listening on
`127.0.0.1`. On first deploy, a `db-init` job creates the application database
and user; `kimai:install` then creates the schema on the container's own
first boot.

- **Console:** SQL → select the instance for connections, backups, flags, and
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

### C. Cloud Storage

Two GCS buckets can exist for this deployment: a `storage` bucket provisioned
by `Kimai_Common` and GCS-FUSE-mounted at `/opt/kimai/var/data` (uploaded
invoice logos/templates, plugin data), and a **separate**, generic
Foundation-level bucket (`storage_buckets`, defaulting to a bucket named
`data`) that Kimai does not read or write unless you wire it up explicitly.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse CSI mounts.

### D. Secret Manager

Two secrets are generated automatically and stored in Secret Manager:
`APP_SECRET` (Symfony CSRF/session signing key) and `ADMINPASS` (the initial
super-admin account password). The database password is managed separately by
the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~kimai"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing
IP; a Kubernetes Ingress for custom domains and a reserved static IP can be
layered on (both module defaults are `true`, though this module's own live
deployment was run with both set `false` — see [Outputs](#5-outputs) and §4).

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to
Cloud Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Kimai Application Behaviour

- **A single `DATABASE_URL` composed entirely at runtime, not passed through
  Terraform.** Kimai's Doctrine DBAL layer reads one connection string,
  `DATABASE_URL=mysql://user:pass@host:port/db?charset=utf8mb4&serverVersion=8.0`,
  not discrete `DB_*` variables. `Kimai_Common` builds a thin custom wrapper
  image `FROM kimai/kimai2` whose `entrypoint.sh` composes `DATABASE_URL` at
  container start from the Foundation-injected
  `DB_USER`/`DB_NAME`/`DB_PASSWORD`/`DB_IP` env vars — URL-encoding the
  password with `php -r 'echo rawurlencode(...)'` — before handing off
  unmodified to the vendor's own `docker-php-entrypoint /entrypoint.sh`.
- **`DB_IP` resolves to the Auth Proxy sidecar's loopback on GKE.** The
  wrapper reads the host from `$DB_IP` (aliased via `db_host_env_var_name =
  "DB_IP"`). On GKE, with `enable_cloudsql_volume = true` (the default), this
  resolves to the cloud-sql-proxy sidecar's `127.0.0.1` address — a plain
  host with no colons, just like the raw private IP Cloud Run's variant of
  this same module uses. This is why the same wrapper entrypoint code works
  unmodified on both platforms.
- **Verified locally before ever touching the cloud.** The password
  URL-encoding step and the vendor's own DB-wait preflight check were both
  confirmed by building the wrapper image and running it locally against a
  real MySQL container with a password containing special characters
  (`@:/?`), catching and fixing issues before the first cloud deploy attempt.
- **Health check behaviour.** Both the startup and liveness probes target
  `GET /en/login` (Kimai's login page), which returns `200` once the
  application is ready.
  ```bash
  EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
  curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/en/login"   # expect 200
  ```
- **Admin bootstrap runs on every boot, idempotently.** The vendor's own
  entrypoint runs `kimai:user:create admin "$ADMINMAIL" ROLE_SUPER_ADMIN
  "$ADMINPASS"` on every container start whenever `ADMINPASS` is set — a
  no-op once the account exists. **The username is always `admin`**,
  hardcoded by the vendor image regardless of `admin_email`'s value.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Kimai are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the cluster and regional resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `kimai` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Kimai` | Human-readable name shown in the Console. |
| `application_description` | `Kimai time tracking on GKE` | Kubernetes workload description. |
| `application_version` | `latest` | Image tag driving the `kimai/kimai2` build. `"latest"` maps to the maintained `:apache` rolling tag; any other value maps to `"<version>-apache"`. |
| `admin_email` | `admin@example.com` | Super-admin account email, injected as `ADMINMAIL`. The account username is always `admin`, hardcoded by the vendor entrypoint. |
| `enable_gcs_storage_volume` | `true` | GCS-FUSE-mount the `storage` bucket at `/opt/kimai/var/data`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `custom` | Builds the `DATABASE_URL`-composing wrapper image via Cloud Build — required, not optional, for this module. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | GKE has no scale-to-zero; single replica by default. |
| `container_port` | `8001` | Kimai's `:apache` image variant listens on 8001, confirmed via local testing and live deployment. |
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Per-pod resource limits. |
| `php_memory_limit` | `512M` | PHP `memory_limit` (the vendor entrypoint reads the lowercase `memory_limit` env var directly). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar on `127.0.0.1`. **Keep `true` on GKE** — the wrapper's `DB_IP` alias depends on it. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP by default. |
| `session_affinity` | `ClientIP` | Routes a client's requests to the same pod. |
| `workload_type` | `null` | Auto-resolves to `Deployment` (Kimai needs no per-pod PVC identity). |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in single `db-init` job. There is no separate migrate job — `kimai:install` runs on every container boot, idempotently. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | **Functionally unused** — mounted at `/var/lib/kimai`, but Kimai's real persistent storage is the GCS-FUSE-mounted `storage` bucket at `/opt/kimai/var/data`. Safe to disable. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | Generic Foundation-level bucket. Not read or written by Kimai. |
| `gcs_volumes` | `[]` | Additional GCS Fuse volume mounts, merged with the `storage` bucket mount. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `null` (resolves to `MYSQL_8_0`) | Fixed by `Kimai_Common`. |
| `application_database_name` / `application_database_user` | `kimai` | Tenant-prefixed at deploy time. Immutable after first deploy. |
| `db_host_env_var_name` | `DB_IP` | Aliases the DB host so the wrapper's `DATABASE_URL` composition reads a plain, colon-free host — resolves to the Auth Proxy sidecar's loopback on GKE. |
| `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `db_password_env_var_name` | `""` (all four) | **Unused by Kimai** — the wrapper reads the standard `DB_USER`/`DB_NAME`/`DB_PASSWORD` directly and hardcodes port `3306`. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Kubernetes Ingress with `application_domains`. This module's own live-verified deployment set this `false` (see `config/deploy.tfvars`). |
| `reserve_static_ip` | `true` | A stable IP that survives redeploys. This module's own live-verified deployment set this `false` too. |
| `network_tags` | `["nfsserver"]` | Firewall targeting; required for NFS connectivity when `enable_nfs = true`. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Kimai has no built-in Redis integration used by this module — its default cache backend is the local filesystem. |

Every other input (Group 0 metadata, Group 2 environment, Group 5 secrets,
Group 7 StatefulSet, Group 8 resource quota, Group 9 reliability, Group 10
observability, Group 12 CI/CD, Group 17 backup, Group 18 custom SQL, Group 20
IAP, Group 21 Cloud Armor, Group 22 VPC-SC) behaves exactly as documented in
[App_GKE](App_GKE.md).

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore
the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Kubernetes namespace. |
| `service_cluster_ip` / `service_external_ip` | Internal / external IP. |
| `service_url` | Service URL. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` | `127.0.0.1` via the Cloud SQL Auth Proxy sidecar. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `initialization_jobs` | Name of the setup job (`db-init`). |
| `kubernetes_ready` | Whether the cluster endpoint is available and all K8s resources are deployed. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_GKE](App_GKE.md) foundation engine, which validates values
> *and combinations* at plan time. Invalid configuration fails the **plan**
> with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `container_image_source` | `custom` | **Critical** | Switching to `prebuilt` deploys the stock `kimai/kimai2` image with no wrapper entrypoint — `DATABASE_URL` is never composed, so the pod cannot reach MySQL at all. |
| `enable_cloudsql_volume` | `true` on GKE | **Critical** | Setting `false` removes the Auth Proxy sidecar the wrapper entrypoint's `DB_IP` alias depends on to reach Cloud SQL — the pod cannot connect. |
| `container_port` | `8001` | Critical | The `:apache` image variant listens on 8001, not 80 — pointing the platform at the wrong port makes the service unreachable even though the container is healthy. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all timesheets, projects, and invoices. |
| `APP_SECRET` (auto-generated) | Never hand-edit in Secret Manager after first boot | High | Kimai uses this as a Symfony security-signing key; changing it invalidates CSRF tokens and active sessions. |
| Default administrator account (username always `admin`, password in the `ADMINPASS` secret) | Retrieve the generated password from Secret Manager and log in promptly | High | The admin password is a real, per-deployment generated secret, not a public well-known default — but still worth confirming who has read access to the secret. |
| `max_instance_count` | `1` unless verified otherwise | High | Scaling beyond 1 pod without verifying Kimai's session behaviour under multiple pods risks inconsistent user sessions across pods. |
| `enable_nfs` | `false` unless needed for another purpose | Low / cost | Defaults `true` and provisions a Filestore share Kimai never uses — a needless recurring cost; real persistence is the GCS-FUSE-mounted `storage` bucket. |
| `enable_cloud_armor` | enable for production | Medium | The service is publicly reachable without WAF protection by default. |

---

For the foundation behaviour referenced throughout — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Kimai-specific
application configuration shared with the Cloud Run variant is described in
**[Kimai_Common](Kimai_Common.md)**.
