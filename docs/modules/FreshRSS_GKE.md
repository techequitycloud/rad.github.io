---
title: "FreshRSS on GKE Autopilot"
description: "Configuration reference for deploying FreshRSS on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# FreshRSS on GKE Autopilot

FreshRSS is a free, self-hosted, GPL-3.0-licensed RSS and Atom feed aggregator — a
lightweight, multi-user "news reader" written in PHP that runs behind Apache and
exposes the Google Reader and Fever APIs for mobile clients. This module deploys
FreshRSS on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which
provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services FreshRSS uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

FreshRSS runs as a PHP/Apache web workload. The deployment wires together a focused
set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | PHP/Apache pods on port 80, 1 vCPU / 2 GiB by default |
| Database | Cloud SQL for PostgreSQL 15 | Required — the entrypoint installs with `--db-type pgsql` |
| Persistent storage | NFS (Filestore / self-managed) or block PVC | Data dir at `/var/www/FreshRSS/data`; holds config, per-user state, feed cache. No GCS bucket |
| Cache | Redis (optional) | Off by default; FreshRSS does not require it |
| Secrets | Secret Manager | Auto-generated `FRESHRSS_ADMIN_PASSWORD`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is the supported engine.** The container entrypoint hardcodes
  `--db-type pgsql` and the `db-init` job is Postgres-only; the schema is created by
  FreshRSS's own installer on first boot.
- **On GKE the Cloud SQL Auth Proxy runs as a sidecar** bound to `127.0.0.1:5432`,
  so FreshRSS dials the loopback address (`DB_HOST = 127.0.0.1`) — the entrypoint
  treats loopback as a plaintext TCP host (the proxy terminates TLS).
- **NFS is enabled by default** (`enable_nfs = true`) and mounted at
  `/var/www/FreshRSS/data`. FreshRSS writes its generated config, per-user state,
  cached articles, and favicons there — without a persistent volume this state is
  lost on pod restart. An NFS-backed Deployment uses the `Recreate` strategy so two
  pods never write the same volume during a rollout.
- **`FRESHRSS_ADMIN_PASSWORD` is generated automatically** and stored in Secret
  Manager. It seeds the default `admin` account (and its API password) on first
  install.
- **Session affinity is `ClientIP` by default.** Keeps a client's requests on the
  same pod.
- **Minimum 1 replica is maintained** (`min_instance_count = 1`,
  `max_instance_count = 1`); GKE does not support scale-to-zero, so the
  in-container feed-refresh cron always runs.
- **A static external IP is reserved by default** (`reserve_static_ip = true`) and
  a custom-domain Ingress is provisioned by default (`enable_custom_domain = true`)
  — populate `application_domains` to serve real hostnames.
- **The container listens on port 80** (Apache), not 8080.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the FreshRSS workload

FreshRSS pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Because the data dir is NFS-backed, the Deployment uses the
`Recreate` update strategy rather than a rolling update.

- **Console:** Kubernetes Engine → Workloads → select the FreshRSS workload to see
  pods and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe deploy -n "$NAMESPACE" <service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

FreshRSS stores all application data (feeds, subscriptions, articles, categories,
users) in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately
through the **Cloud SQL Auth Proxy** sidecar over the `127.0.0.1:5432` loopback; no
public IP is exposed. On first deploy the `db-init` Job creates the application
database and user, and FreshRSS's own installer creates the schema.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are all surfaced in the
[Outputs](#5-outputs). For the connection model, backups, and password rotation,
see [App_GKE](App_GKE.md).

### C. Persistent storage (NFS / PVC)

FreshRSS's data directory (`/var/www/FreshRSS/data`) is backed by an **NFS volume**
(`enable_nfs = true`), which holds the generated config, per-user state, cached
articles, and favicons. This module declares **no GCS bucket**. A block PVC
(StatefulSet) is an alternative persistence mode via the Group 7 StatefulSet
variables.

- **Console:** Filestore → Instances (managed NFS); Kubernetes Engine → Storage
  (PVCs).
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /var/www/FreshRSS/data
  ```

See [App_GKE](App_GKE.md) for the NFS server model, block PVCs, and GCS Fuse.

### D. Redis (optional cache)

Redis is **disabled by default** (`enable_redis = false`) and FreshRSS does not
require it. It is exposed as a forwarded option for parity with sibling PHP modules;
leave it off unless you have a specific reason to enable it.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  ```

### E. Secret Manager

One application secret is generated automatically: `FRESHRSS_ADMIN_PASSWORD`, which
seeds the default `admin` account and its API password on first install. The
database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~freshrss"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP with
a reserved static IP, and a custom-domain Ingress is provisioned. Add hostnames via
`application_domains` for a Google-managed certificate.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. FreshRSS Application Behaviour

- **First-deploy database setup.** The `db-init` Job runs using `postgres:15-alpine`.
  It connects through the Cloud SQL Auth Proxy and idempotently creates the
  application database and user and grants privileges. The job is safe to re-run.
- **First-boot install.** The container's `platform-entrypoint.sh` resolves the DB
  host (`127.0.0.1` proxy loopback on GKE), then drives FreshRSS's own
  `cli/do-install.php` (creates `data/config.php` and the schema) and
  `cli/create-user.php` (creates the `admin` account from `FRESHRSS_ADMIN_PASSWORD`),
  then chains the upstream entrypoint. The install is idempotent — skipped once
  `data/config.php` exists on the persistent volume.
- **Feed refresh cron.** The upstream image starts an in-container cron
  (`CRON_MIN = */15`) that actualizes subscribed feeds every 15 minutes. Because GKE
  keeps at least one replica running, the cron always fires.
- **Admin credential.** The default login is `admin` with the generated
  `FRESHRSS_ADMIN_PASSWORD`; the same value is set as the API password used by
  Google Reader / Fever API mobile clients. Change it in the FreshRSS UI after first
  login — rotating the Secret Manager value alone will not re-set an
  already-installed account.
- **Rollout strategy.** With NFS enabled the Deployment uses `Recreate` (not
  `RollingUpdate`) so two pods never write the shared data dir simultaneously — a
  rolling update on this stateful app would deadlock on the file/DB locks.
- **Health path.** The startup probe is a TCP check on port 80; the liveness probe
  is an HTTP GET on `/` (200). FreshRSS also serves an unauthenticated `/status`
  JSON endpoint suitable for uptime checks. Allow a generous first-boot window while
  the installer creates the schema.
- **Set the external URL after the IP is known.** Confirm the LoadBalancer IP /
  Ingress host and set `BASE_URL` (via `environment_variables`) or
  `application_domains` so FreshRSS's self-referencing links resolve correctly:
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for FreshRSS are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `freshrss` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | FreshRSS image tag; `latest` is pinned to a known-good tag (`1.26.3`) at build time. Pin explicitly in production. |

All other inputs follow standard App_GKE behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | FreshRSS ships a thin custom build; use `prebuilt` only with an external `container_image`. |
| `cpu_limit` | `1000m` | CPU per pod (1 vCPU). |
| `memory_limit` | `2Gi` | Memory per pod; keep ≥ 512Mi. |
| `min_instance_count` | `1` | Minimum replicas; GKE requires ≥ 1. Keeps FreshRSS and its refresh cron running. |
| `max_instance_count` | `1` | Keep at 1 — a single pod owns the refresh cron and file-based state. |
| `container_port` | `80` | FreshRSS/Apache listens on port 80. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for Postgres connections. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |

All other inputs follow standard App_GKE behaviour.

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `null` | Resolves to `Deployment`; NFS-backed, so it uses the `Recreate` strategy. Set `StatefulSet` only with a block PVC. |
| `session_affinity` | `ClientIP` | Sticky routing so a client stays on one pod. |
| `network_tags` | `["nfsserver"]` | `nfsserver` is required when `enable_nfs = true`. |

All other inputs follow standard App_GKE behaviour.

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable a per-pod block PVC as an alternative to NFS for the data dir. |
| `stateful_pvc_size` | `10Gi` | Per-pod PVC storage size. |
| `stateful_pvc_mount_path` | `/var/www/FreshRSS/data` | Container mount path for the PVC; must match the NFS mount path so the data dir persists either way. |

All other inputs follow standard App_GKE behaviour.

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP `/` 30s delay, threshold 20 | Startup probe; the high threshold allows first-boot install time. |
| `liveness_probe` | HTTP `/` 300s delay | Liveness probe; `/status` is an alternative unauthenticated JSON endpoint. |
| `uptime_check_config` | `{enabled=false, path="/"}` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Optional metric alert policies. |

All other inputs follow standard App_GKE behaviour.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Mounts a persistent NFS volume for the FreshRSS data directory. **Keep enabled** — required to persist config and per-user state. |
| `nfs_mount_path` | `/var/www/FreshRSS/data` | Where the NFS volume is mounted inside the container. |

All other inputs follow standard App_GKE behaviour.

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PostgreSQL engine version. FreshRSS installs with `--db-type pgsql`. |
| `application_database_name` | `freshrss` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `freshrss` | Application database user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |

All other inputs follow standard App_GKE behaviour.

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve; set to obtain a managed certificate. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

All other inputs follow standard App_GKE behaviour.

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Off by default; FreshRSS does not require Redis. |
| `redis_host` / `redis_port` | `""` / `6379` | Redis endpoint if enabled. |

All other inputs follow standard App_GKE behaviour.

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
| `service_url` | URL to reach FreshRSS. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (FreshRSS declares none). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `Deployment` workload with `stateful_pvc_enabled = true`, IAP with no authorized identities, memory quota values without binary unit suffixes, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_nfs` (or a block PVC) | `true` | Critical | Without a persistent volume the FreshRSS data dir is ephemeral — `config.php`, per-user state, and cache are wiped on pod restart, forcing a re-install. |
| `nfs_mount_path` | `/var/www/FreshRSS/data` | Critical | Mounting elsewhere leaves the data dir ephemeral (same effect as no NFS). |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all feed data. |
| `database_type` | `POSTGRES_15` | Critical | FreshRSS installs with `--db-type pgsql`; a non-Postgres engine breaks the installer and `db-init`. |
| `container_port` | `80` | High | FreshRSS/Apache listens on 80; a wrong port fails the startup probe and pods never become Ready. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity over the `127.0.0.1` loopback. |
| `max_instance_count` | `1` | High | Running more than one pod duplicates the in-container refresh cron and splits file-based session/cache state; a rolling update on the shared NFS dir deadlocks. |
| `session_affinity` | `ClientIP` | High | Without stickiness, a client's requests scatter across pods, disrupting logged-in sessions. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects invalid values. Keeping 1 keeps FreshRSS and its refresh cron running. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `enable_iap` | only for private deploys | High | IAP blocks all unauthenticated requests, including mobile clients using the Google Reader / Fever API. |
| `FRESHRSS_ADMIN_PASSWORD` (auto-generated) | Change in the UI after first login | Medium | Rotating the secret alone does not re-set an already-installed account; the first password remains valid until changed in-app. |
| `application_domains` | Set with `enable_custom_domain` | Medium | `enable_custom_domain = true` with no hostnames provisions an Ingress that serves no managed certificate. |
| `memory_limit` | `2Gi` | Medium | Values below 512Mi risk OOM under heavy feed refresh. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
FreshRSS-specific application configuration shared with the Cloud Run variant is
described in **[FreshRSS_Common](FreshRSS_Common.md)**.
