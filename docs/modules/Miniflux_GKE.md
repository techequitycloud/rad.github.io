---
title: "Miniflux on GKE Autopilot"
description: "Configuration reference for deploying Miniflux on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Miniflux on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Miniflux_GKE.png" alt="Miniflux on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Miniflux is a minimalist, self-hosted RSS/Atom feed reader — a single static Go
binary that stores all state in PostgreSQL. This module deploys Miniflux on
**GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions
and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Miniflux uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

Miniflux runs as a single-container Go web workload. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single Go binary in a Deployment, horizontally autoscaled between `min`/`max` replicas |
| Database | Cloud SQL for PostgreSQL 15 | Required — Miniflux stores **all** state here; no MySQL/other engine |
| Object storage | Cloud Storage (none) | Miniflux needs no bucket; an optional Filestore NFS mount is available but unused by default |
| Cache & queue | None | Miniflux has no Redis dependency and no separate worker |
| Secrets | Secret Manager | Auto-generated `ADMIN_PASSWORD` (initial owner); database password |
| Ingress | Cloud Load Balancing | External LoadBalancer with `ClientIP` session affinity, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; selecting any other engine breaks startup.
- **The feed poller runs in-process.** Miniflux has no separate worker — the same pod
  serves the UI and refreshes feeds on `POLLING_FREQUENCY`. Keep at least one replica
  running so polling continues (GKE does not scale to zero).
- **The initial owner is seeded, not self-registered.** `CREATE_ADMIN = 1` seeds the
  `admin` account from the `ADMIN_PASSWORD` secret on first boot; open self-service
  signup stays off. Retrieve the password from Secret Manager to log in.
- **Schema migrations run on boot** (`RUN_MIGRATIONS = 1`) — there is no separate
  migrate job, so upgrading the version applies schema changes automatically.
- **No Redis.** `enable_redis = false` — Miniflux keeps every feed, entry, and
  session in PostgreSQL. Leave it off. Because there is no shared queue, running
  multiple replicas simply shares request load (each still polls independently).
- **Session affinity is `ClientIP`.** Keeps a client pinned to one pod for a
  consistent UI session.
- **`DATABASE_URL` is composed at runtime** by the container entrypoint (libpq
  keyword/value form), branching on the GKE Auth Proxy loopback (`127.0.0.1`,
  `sslmode=disable`) so the same image works on Cloud Run and GKE.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Miniflux workload

Miniflux pods run as a Deployment on Autopilot listening on port **8080**, billed for
the CPU/memory they request. Horizontal Pod Autoscaling sizes the deployment between
the minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Miniflux workload to see
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

### B. Cloud SQL for PostgreSQL 15

Miniflux stores **all** application data (feeds, entries, users, sessions, categories)
in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately through the
**Cloud SQL Auth Proxy** sidecar over loopback (`127.0.0.1`); no public IP is exposed.
On first deploy the `db-init` Job creates the `miniflux` database and role and installs
the `hstore` extension owned by the app role.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=miniflux --database=miniflux --project "$PROJECT"
  ```

The instance name, database, user, and password secret are surfaced in the
[Outputs](#5-outputs). For the connection model, automated backups, and password
rotation, see [App_GKE](App_GKE.md).

### C. Cloud Storage / NFS

Miniflux needs **no** object storage — it keeps all state in PostgreSQL, so no data
bucket is provisioned by the application layer. The variant does default
`enable_nfs = true` (a Cloud Filestore mount at `/opt/miniflux/storage`) for operators
who want shared attachment storage, but Miniflux does not require it; disable it to
save cost if you have no such need.

- **Console:** Filestore → Instances (if NFS is enabled); Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Secret Manager

One secret is generated automatically: `ADMIN_PASSWORD` — the initial owner password
seeded into Miniflux on first boot. The database password is managed separately by
the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~miniflux"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP with
`ClientIP` session affinity. A custom domain with a Google-managed certificate can be
enabled, and a static IP can be reserved so the address survives redeploys. When a
custom domain is used, set `BASE_URL` so Miniflux emits correct absolute links.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available. The entrypoint
logs its `DATABASE_URL` connection mode at start — useful when diagnosing DB
connectivity.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Miniflux Application Behaviour

- **First-deploy database setup.** The `db-init` Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently
  creates the `miniflux` database and role, grants privileges, re-owns the `public`
  schema, and installs the `hstore` extension **owned by the app role** (so Miniflux
  migration `v119`, which drops `hstore`, succeeds). The job then posts to the proxy
  sidecar's `/quitquitquit` so the Job pod completes; it is safe to re-run.
- **Schema migrations on boot.** The entrypoint sets `RUN_MIGRATIONS=1`, so Miniflux
  applies its own schema migrations on every start — no separate migrate step. Allow
  extra time on the first boot for the initial schema build.
- **Initial owner is seeded.** `CREATE_ADMIN=1` seeds the `admin` account
  (`ADMIN_USERNAME`) from the `ADMIN_PASSWORD` secret. It is idempotent — later boots
  log "user already exists". Retrieve the password to log in:
  ```bash
  gcloud secrets versions access latest \
    --secret=secret-<resource-prefix>-miniflux-admin-password --project "$PROJECT"
  ```
- **Health path.** This module's startup and liveness probes default to HTTP `/` (the
  login page, an unauthenticated `200 OK`). Miniflux also serves an unauthenticated
  `200 OK` at `/healthcheck` if you prefer a dedicated probe path. Do not point probes
  at authenticated pages.
- **The feed poller is in-process.** Feeds refresh on `POLLING_FREQUENCY` inside each
  pod. Keep `min_instance_count >= 1` so polling runs; extra replicas each poll
  independently (there is no shared queue to coordinate them).
- **`BASE_URL` drives absolute links.** It defaults to the injected internal service
  URL; set it explicitly (via `environment_variables`) to the external LoadBalancer or
  custom-domain URL once the address is known.
- **Inspect the db-init job and pods:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Miniflux are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

All other inputs follow standard App_GKE behaviour.

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

All other inputs follow standard App_GKE behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `miniflux` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Miniflux image tag; pin to a release (e.g. `2.2.15`) in production. |

All other inputs follow standard App_GKE behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `min_instance_count` | `1` | Minimum replicas; keep at 1 so the feed poller keeps running. |
| `max_instance_count` | `5` | Maximum replicas. Miniflux has no shared queue — extra pods share request load only. |
| `container_port` | `8080` | Miniflux listens on 8080. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for connectivity (required on GKE). |
| `enable_image_mirroring` | `true` | Mirror the Miniflux image into Artifact Registry before deployment. |

All other inputs follow standard App_GKE behaviour.

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings (e.g. `BASE_URL`, `POLLING_FREQUENCY`). Do not set `DATABASE_URL` (composed at runtime). |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

All other inputs follow standard App_GKE behaviour.

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `null` | Auto-resolves to a stateless Deployment (Miniflux stores all state in PostgreSQL — no StatefulSet needed). |
| `session_affinity` | `ClientIP` | Pin a client to one pod for a consistent UI session. |
| `container_protocol` | `http1` | Standard HTTP/1.1. |
| `termination_grace_period_seconds` | `60` | Seconds to wait after SIGTERM before SIGKILL. |

All other inputs follow standard App_GKE behaviour.

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Leave off — Miniflux keeps all state in PostgreSQL, so no per-pod PVC is required. |

All other inputs follow standard App_GKE behaviour.

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |

All other inputs follow standard App_GKE behaviour.

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 60s delay, 15s period, 30 failures | Startup probe. Generous window for first-boot migrations. |
| `liveness_probe` | HTTP `/`, 60s delay, 30s period | Liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check; enable for production monitoring. |
| `alert_policies` | `[]` | Optional metric alert policies. |

All other inputs follow standard App_GKE behaviour.

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (role/database/`hstore`). |
| `cron_jobs` | `[]` | Optional scheduled Kubernetes CronJobs. |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside Miniflux. |

All other inputs follow standard App_GKE behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Miniflux requires PostgreSQL. |
| `application_database_name` | `miniflux` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `miniflux` | Application database user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |

All other inputs follow standard App_GKE behaviour.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisions a Filestore NFS mount at `/opt/miniflux/storage`. Optional — Miniflux stores state in PostgreSQL; disable to save cost. |
| `nfs_mount_path` | `/opt/miniflux/storage` | Mount path inside the container. |

All other inputs follow standard App_GKE behaviour.

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | One `data` bucket is declared by default; extend the list if you need more. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts via the CSI driver. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

All other inputs follow standard App_GKE behaviour.

### Group 15 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Miniflux does not use Redis — leave off. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Unused by Miniflux. |

All other inputs follow standard App_GKE behaviour.

### Group 17 — Backup & Maintenance

`backup_schedule`, `backup_retention_days`, `enable_backup_import`, `backup_source`,
`backup_uri`, `backup_format` — automated Cloud SQL backup and restore-on-deploy.
See [App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate (a Gateway with a static IP is provisioned automatically). |
| `application_domains` | `[]` | Hostnames to serve (set `BASE_URL` to match). |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

All other inputs follow standard App_GKE behaviour.

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Miniflux (blocks Fever/Reader-API token clients). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

All other inputs follow standard App_GKE behaviour.

### Group 21 — Cloud Armor

`enable_cloud_armor`, `admin_ip_ranges`, `cloud_armor_policy_name`, `enable_cdn` —
attach a WAF policy / CDN to the Ingress backend. See [App_GKE](App_GKE.md).

### Group 22 — VPC Service Controls & Audit Logging

`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `enable_audit_logging` — see
[App_GKE](App_GKE.md).

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
| `service_url` | URL to reach Miniflux. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name (`miniflux`). |
| `database_user` | Application database user (`miniflux`). |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (a `data` bucket by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `Deployment` workload with `stateful_pvc_enabled = true`, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, bare-integer `quota_memory_*` values. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Miniflux only supports PostgreSQL; any other engine breaks startup. |
| `application_database_name` / `application_database_user` | Set once (`miniflux`) | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all feeds and entries. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup source fails the import job. |
| `ADMIN_PASSWORD` (auto-generated) | Retrieve from Secret Manager | High | It is the only owner credential seeded on first boot; without it you cannot log in until you reset it in the DB. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity on GKE; disabling it breaks the DB connection. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; keeping 1 ensures the in-process feed poller keeps refreshing. |
| `enable_redis` | `false` | Medium | Redis is unused; enabling it wastes resources and changes nothing. |
| `session_affinity` | `ClientIP` | Medium | Without stickiness a client's requests hop pods, disrupting the UI session. |
| `startup_probe.path` | `/healthcheck` | High | Pointing the probe at an authenticated page returns 401/403 and the pod never becomes Ready. |
| `enable_iap` | off unless UI must be gated | Medium | IAP fronts the UI/API with Google sign-in, blocking Fever/Reader-API token clients. |
| `BASE_URL` (env) | External LoadBalancer / domain URL | Medium | A stale/wrong base URL yields broken absolute links and feed-proxy image URLs. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict all pods simultaneously during maintenance. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Miniflux-specific
application configuration shared with the Cloud Run variant is described in
**[Miniflux_Common](Miniflux_Common.md)**.
