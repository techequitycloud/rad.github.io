---
title: "Gotify on GKE Autopilot"
description: "Configuration reference for deploying Gotify on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Gotify on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gotify_GKE.png" alt="Gotify on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gotify is an open-source (MIT-licensed), self-hosted server for sending and receiving
real-time push notifications. Applications post messages over a simple REST API and
clients receive them instantly over WebSocket streams. This module deploys Gotify on
**GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and
manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Gotify uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, backups, and the deployment
lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating
them here.

---

## 1. Overview

Gotify runs as a single-binary Go web workload. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Go pods, 1 vCPU / 512 MiB request by default; single replica |
| Database | Cloud SQL for PostgreSQL 15 | Required — this module never uses Gotify's embedded SQLite |
| Secrets | Secret Manager | Auto-generated admin password (`GOTIFY_DEFAULTUSER_PASS`); database password |
| Container build | Cloud Build + Artifact Registry | Wraps `ghcr.io/gotify/server` with a DB-mapping entrypoint |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL is mandatory.** `database_type = "POSTGRES"` is the module default;
  Gotify's SQLite mode is not used, so no per-pod PVC is required.
- **The container listens on port 80.** `container_port = 80` and the entrypoint sets
  `GOTIFY_SERVER_PORT = 80`.
- **A single replica is the safe default.** `min = max = 1`. Gotify's message bus is
  in-process, so a client stream only receives messages delivered to the pod it is
  connected to. Scaling beyond one replica without an external fan-out layer drops
  messages for some subscribers.
- **Stateless Deployment.** `workload_type = "Deployment"` and
  `session_affinity = "None"` — any pod can serve any request because all messages
  live in PostgreSQL.
- **The admin password is generated automatically** and stored in Secret Manager,
  injected as `GOTIFY_DEFAULTUSER_PASS`. The initial admin (`admin`) is created on the
  first database initialisation only.
- **No object storage is provisioned** (`storage_buckets = []`, `enable_nfs = false`).
- **The image is custom-built.** `container_image_source = "custom"` wraps
  `ghcr.io/gotify/server` and maps the platform `DB_*` variables onto Gotify's
  `GOTIFY_DATABASE_*` (GORM) configuration; on GKE `DB_HOST` is `127.0.0.1` via the
  cloud-sql-proxy sidecar. `latest` pins to base `2.9.1`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Gotify workload

Gotify pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. The module keeps a single replica so the in-process message bus
delivers to every connected client.

- **Console:** Kubernetes Engine → Workloads → select the Gotify workload for pods and
  events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type are
managed.

### B. Cloud SQL for PostgreSQL 15

Gotify stores all application data (messages, applications, clients, users) in a
managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately through the
**Cloud SQL Auth Proxy** sidecar (loopback `127.0.0.1`); no public IP is exposed. On
first deploy an initialization Job creates the application database and role; Gotify
then applies its own schema via GORM auto-migration on first startup.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are all in the
[Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the connection model, backups,
and password rotation.

### C. Secret Manager

The admin password (`GOTIFY_DEFAULTUSER_PASS`) is generated automatically and stored
in Secret Manager, materialised into the namespace via the Secret Store CSI driver.
The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~gotify"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the CSI integration and rotation.

### D. Container build & Artifact Registry

The custom image wraps `ghcr.io/gotify/server` with a DB-mapping entrypoint. Cloud
Build builds it and pushes to Artifact Registry; `enable_image_mirroring = true`
mirrors the upstream base into Artifact Registry to avoid registry rate limits.

- **Console:** Cloud Build → History; Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts repositories list --project "$PROJECT"
  ```

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A
custom domain with a Google-managed certificate can be enabled, and a static IP can be
reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring, with an uptime check against `/health` and optional alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Gotify Application Behaviour

- **First-deploy database setup.** An initialization Job runs `create-db-and-user.sh`
  using `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and
  idempotently creates the application database and role and grants privileges. The
  job is safe to re-run.
- **Schema via GORM auto-migration.** Gotify creates and migrates its own tables on
  every startup — there is no separate migration job. Upgrading the application
  version applies schema changes automatically.
- **The admin account is bootstrapped once.** `GOTIFY_DEFAULTUSER_NAME = admin` and
  the `GOTIFY_DEFAULTUSER_PASS` secret create the initial administrator on the first
  database initialisation only. Retrieve the password from Secret Manager and change
  it after first login.
- **Send and receive are token-authenticated.** After logging in, create an
  *application* (which yields an app token) to send messages via
  `POST /message?token=<apptoken>`, and use a *client* token to subscribe over the
  WebSocket at `/stream?token=<clienttoken>`. Confirm health without a token:
  ```bash
  kubectl run curl --rm -it --image=curlimages/curl -n "$NAMESPACE" -- \
    curl -s http://<service-name>/health
  ```
- **Single-replica WebSocket delivery.** Because the message bus is in-process, keep
  `max_instance_count = 1` unless you add an external fan-out layer — otherwise a
  message sent to one pod is not delivered to clients streaming from another.
- **Health path.** Startup and liveness probes target `/health` — the public endpoint
  that returns `{"health":"green","database":"green"}` once PostgreSQL is reachable.
  The default startup probe allows ~5 minutes on first boot.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Gotify are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `gotify` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Gotify` | Human-readable name shown in the Console. |
| `application_description` | `Gotify push notification server on GKE Autopilot` | Workload description. |
| `application_version` | `latest` | Image tag; `latest` resolves to the pinned base `2.9.1`. Pin a release in production. |
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `custom` | `custom` builds the DB-mapping wrapper image; `prebuilt` deploys an image URI you configure. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Per-pod CPU/memory requests and limits. |
| `container_port` | `80` | Gotify listens on port 80. |
| `min_instance_count` | `1` | HPA minReplicas. |
| `max_instance_count` | `1` | HPA maxReplicas. Keep at 1 — the in-process message bus does not fan out across pods. |
| `workload_type` | `Deployment` | Stateless Deployment; no StatefulSet needed. |
| `timeout_seconds` | `300` | Maximum request duration; raise for long-lived streams. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for connectivity. |
| `enable_image_mirroring` | `true` | Mirror `ghcr.io/gotify/server` into Artifact Registry. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra `GOTIFY_*` settings. The database connection and `GOTIFY_DEFAULTUSER_PASS` are injected automatically — do not set them here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `session_affinity` | `None` | Correct for stateless Gotify — no per-pod session is required. |
| `namespace_name` | `""` | Auto-generated when empty. |
| `network_tags` | `[]` | Node/pod network tags for firewall rules. |
| `termination_grace_period_seconds` | `30` | Seconds to wait after SIGTERM before SIGKILL. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Create a namespace ResourceQuota. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Must use binary suffixes (`4Gi`, `8192Mi`) — bare integers are bytes and block scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |
| `enable_topology_spread` | `false` | Distribute pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health`, 30s delay, 30 failures | Startup probe. `Gotify_GKE` maps this variable into the Gotify workload's own `startup_probe` (via `Gotify_Common`), so it is the value that actually gates readiness — allows ~5 minutes on first boot. |
| `health_check_config` | HTTP `/health`, 30s delay | Liveness probe. Likewise mapped into the workload's `liveness_probe`. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs. |
| `additional_services` | `[]` | Sidecar or helper services alongside Gotify. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see [App_GKE](App_GKE.md).
Key inputs: `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Off by default; enable only to persist Gotify's on-disk image/plugin store. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create GCS buckets defined in `storage_buckets`. |
| `storage_buckets` | `[]` | Empty — Gotify is stateless in this module. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts via the CSI driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Gotify uses managed PostgreSQL. |
| `application_database_name` | `gotify` | Database name. Immutable after first deploy. |
| `application_database_user` | `gotify` | Application role. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before rolling-restarting pods. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

> **Warning:** Enabling IAP requires Google identity authentication for **all**
> inbound requests, including token-only send/receive API calls. Only enable IAP when
> those callers can also carry Google identity.

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Gotify. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `enable_cdn` | `false` | Enable Cloud CDN on the GKE Ingress backend. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (auto-discovers `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `service_url` | External URL of the GKE load balancer. |
| `service_external_ip` | External LoadBalancer IP. |
| `namespace` | Namespace the workload runs in. |
| `project_id` / `deployment_id` | Project ID / deployment suffix. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / role. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `storage_buckets` | Created Cloud Storage buckets (empty for Gotify). |
| `container_image` | Deployed image. |
| `cicd_enabled` / `github_repository_url` | CI/CD status and connected repo. |
| `kubernetes_ready` | Whether the cluster/workload is ready (re-run apply on a fresh inline cluster). |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, `min > max` replicas, `enable_cloudsql_volume` with `database_type = "NONE"`, an out-of-range `backup_retention_days`, non-binary quota memory units. Invalid configuration fails the **plan** with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | Scaling beyond 1 without external fan-out drops messages for clients streaming from other pods (in-process message bus). |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/role and destroys all messages. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup fails the import job. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `container_port` | `80` | High | Gotify listens on 80; a mismatched port fails the startup probe and the pod never becomes Ready. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity; disabling it is blocked by a plan-time guard when `database_type` is set. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; keeping 1 ensures the service is always reachable. |
| `enable_iap` | only when callers carry identity | High | IAP blocks token-only send/receive API calls. |
| `GOTIFY_DEFAULTUSER_PASS` (auto-generated) | Change admin password after first login | High | The bootstrap password only applies on first init; leaving it unchanged is a standing credential exposure. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict the pod during maintenance, dropping live streams. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Gotify-specific
application configuration shared with the Cloud Run variant is described in
**[Gotify_Common](Gotify_Common.md)**.
