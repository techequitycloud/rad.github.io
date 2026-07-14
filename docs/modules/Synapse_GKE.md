---
title: "Synapse on GKE Autopilot"
description: "Configuration reference for deploying Synapse on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Synapse on GKE Autopilot

Synapse is the reference [Matrix](https://matrix.org/) homeserver — the open-source,
Apache 2.0-licensed Python server for the Matrix protocol, an open standard for
decentralized, federated real-time communication (secure chat and VoIP). This module
deploys Synapse on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation,
which provisions and manages the shared Google Cloud and Kubernetes infrastructure.
Users connect to the homeserver with a Matrix client such as the
[Element](https://element.io/) web app.

This guide focuses on the cloud services Synapse uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Synapse runs as a Python web workload. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Python pods, 2 vCPU / 4 GiB by default, at least 1 replica |
| Database | Cloud SQL for PostgreSQL 15 | Required — Synapse does not support MySQL; database **must** use `C` collation |
| Object storage | Cloud Storage | A dedicated data bucket provisioned automatically |
| Persistent files | NFS (Filestore) | Signing key + media repository under the data directory; enabled by default |
| Secrets | Secret Manager | Auto-generated registration shared secret; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory, with `C` collation.** The engine is fixed by the shared
  application layer, and the first-deploy `db-init` job creates the database with
  `LC_COLLATE='C' LC_CTYPE='C'` — Synapse refuses to start against any other collation.
- **Synapse self-manages its schema.** There is no separate migrate job; Synapse creates
  and upgrades its own schema automatically on every start.
- **`homeserver.yaml` and the signing key are generated on first boot.** The cloud
  entrypoint generates the config plus a persistent signing key into the data directory
  and wires the platform PostgreSQL before starting Synapse.
- **The signing key must persist.** Regenerating it breaks federation and invalidates
  all device sessions, so the data directory is backed by persistent NFS storage
  (`enable_nfs = true` by default). For per-pod durability a StatefulSet PVC can be used.
- **`server_name` is immutable.** It is the domain in every user ID (`@user:server_name`)
  and in federation. The default (`matrix.local`) is a placeholder — override it with
  your real domain **before** production.
- **The container port and all probes must be 8008.** Synapse's client + federation
  listener is set to `8008` in the generated config; the container port and the
  Kubernetes startup/liveness/readiness probes must all target `8008` or the pod never
  becomes Ready even though the homeserver is healthy.
- **At least 1 replica is maintained.** GKE does not scale to zero, which suits a
  federating homeserver that must stay reachable. A PodDisruptionBudget keeps it
  available through node upgrades.
- **Session affinity is `ClientIP` by default.** Keeps a client's requests on the same
  pod.
- **Redis is not used.** Synapse runs a single main process backed entirely by
  PostgreSQL.
- **Admin users are created out-of-band.** Open self-service registration is off by
  default; create users with `register_new_matrix_user` and the registration shared
  secret in Secret Manager.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Synapse workload

Synapse pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Synapse workload to see pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Synapse stores all homeserver state (accounts, rooms, events, device keys, federation
state) in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately through
the **Cloud SQL Auth Proxy** sidecar over a `127.0.0.1` loopback; no public IP is
exposed. On first deploy a `db-init` Job creates the application database **with `C`
collation** and the application user.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  # Verify the mandatory collation:
  #   SELECT datname, datcollate, datctype FROM pg_database WHERE datname = '<db-name>';
  ```

The instance name, database, user, and the Secret Manager secret holding the password
are all surfaced in the [Outputs](#5-outputs). For the connection model, automated
backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Storage & the persistent data directory

A dedicated **Cloud Storage** data bucket is provisioned automatically. Synapse's own
runtime state — `homeserver.yaml`, the `conf.d` overrides, the **signing key**, and the
media repository — lives under the data directory (`SYNAPSE_DATA_DIR = /data`), backed by
the NFS (Filestore) volume mounted at the configured mount path.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"          # if using a StatefulSet PVC
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Secret Manager

A **registration shared secret** is generated automatically and stored in Secret
Manager; it backs `register_new_matrix_user` for out-of-band account creation. The
database password is managed separately by the foundation. Secrets are materialised into
the namespace via the Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~synapse"
  kubectl get secrets -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. Matrix
client and federation traffic require public reachability. A custom domain with a
Google-managed certificate (the domain should match `server_name`) can be enabled, and a
static IP can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
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

## 3. Synapse Application Behaviour

- **First-deploy database setup.** A `db-init` Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently
  creates the application role and the database **with `C` collation**
  (`LC_COLLATE='C' LC_CTYPE='C' TEMPLATE template0`). The job is safe to re-run.
- **No migrate job — schema self-managed.** Synapse creates and upgrades its schema on
  every start, so upgrading the application version applies schema changes without a
  separate migration step.
- **Config + signing key generated on first boot.** The cloud entrypoint generates
  `homeserver.yaml` and a persistent signing key into `/data`, writes a `conf.d` snippet
  wiring PostgreSQL (via the `127.0.0.1` Auth Proxy sidecar) and the `0.0.0.0:8008`
  listener, then execs Synapse. The signing key is generated only once — keep `/data` on
  a persistent volume (NFS by default, or a StatefulSet PVC).
- **`server_name` is immutable after first boot.** Set your real domain before the first
  deploy. Changing it later invalidates every user ID, device session, and federation
  relationship.
- **Container port and probes must be 8008.** The Deployment container port and the
  startup/liveness/readiness probes all target `8008`; a mismatch means the probe hits a
  dead port and the pod never becomes Ready.
- **Health path.** Probes default to `/` on 8008 — Synapse serves an unauthenticated
  landing page there; `/health` (returns `OK`) also works as a probe path. Confirm
  the client API is serving with `GET /_matrix/client/versions`:
  ```bash
  EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" \
    -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
  curl -s "http://${EXTERNAL_IP}/_matrix/client/versions"
  ```
- **Create the first admin user** with the Matrix registration tool from inside a pod:
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    register_new_matrix_user -c /data/homeserver.yaml -u admin -a http://localhost:8008
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Synapse are listed; every other input is inherited from
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
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `synapse` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Synapse Helpdesk` | Human-readable name. |
| `application_version` | `latest` | Synapse image tag; pin to a specific release (e.g. `v1.119.0`) in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_port` | `8008` | Synapse's client + federation listener. Probes must match this. |
| `min_instance_count` | `1` | Minimum replicas; keep at 1 so the homeserver is always reachable for federation. |
| `max_instance_count` | `5` | Maximum replicas. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for connections. |
| `container_image_source` | `custom` | Thin custom build `FROM matrixdotorg/synapse`. |
| `enable_image_mirroring` | `true` | Mirror the Synapse base image into Artifact Registry. |
| `enable_vertical_pod_autoscaling` | `false` | VPA for automatic request adjustment. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core `SYNAPSE_*` values are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for Matrix client + federation traffic. |
| `workload_type` | `null` (auto) | `Deployment` or `StatefulSet`; when unset, resolves to `Deployment` unless `stateful_pvc_enabled = true` (then `StatefulSet`). |
| `session_affinity` | `ClientIP` | Sticky routing keeps a client on the same pod. |
| `network_tags` | `["nfsserver"]` | Required when `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Seconds to wait after SIGTERM before SIGKILL. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (off) | Enable PVC templates — useful to give the signing key + media per-pod persistence. |
| `stateful_pvc_size` | `10Gi` | Per-pod PVC storage size. |
| `stateful_pvc_mount_path` | `/data` | Container mount path for the PVC (the Synapse data directory). |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |
| `stateful_headless_service` | `null` (auto) | Create a headless Service for stable pod DNS names. |
| `stateful_pod_management_policy` | `null` (→ `OrderedReady`) | Pod creation order. |
| `stateful_update_strategy` | `null` (auto) | Update strategy (`RollingUpdate` or `OnDelete`). |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` on 8008, 60s initial delay | Startup probe. Allow first-boot schema setup time. |
| `liveness_probe` | HTTP `/` on 8008, 60s initial delay | Liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (C-collation database + role). |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs. |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside Synapse. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see [App_GKE](App_GKE.md).
Key inputs: `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Persistent NFS for the data directory (signing key + media). |
| `nfs_mount_path` | `/opt/synapse/storage` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the configured GCS buckets. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets to provision — the default creates the dedicated data bucket. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts via the CSI driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Synapse uses a PostgreSQL-backed queue/cache — leave `false` unless externalizing. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Redis endpoint (only when externalizing). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `application_database_name` | `synapse` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `synapse` | Application database user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before rolling-restarting pods. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate (should match `server_name`). |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `network_tags` | `["nfsserver"]` | Firewall tags; `nfsserver` required for NFS. |

### Group 20 — Identity-Aware Proxy (IAP)

> **Warning:** Enabling IAP requires Google identity authentication for **all** inbound
> requests, including Matrix federation and external clients. Only enable IAP for
> admin-only/private homeservers that do not federate.

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Synapse. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | `default-waf-policy` | Policy name. |
| `enable_cdn` | `false` | Enable Cloud CDN on the GKE Ingress backend (useful for media). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

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
| `service_url` | URL to reach Synapse. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a read replica without its primary, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, an out-of-range `redis_port`/`backup_retention_days`, ResourceQuota memory without a binary unit suffix. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `server_name` | Real domain, set once | Critical | Immutable after first boot — changing it invalidates every user ID, device session, and federation relationship. |
| Signing key persistence (`enable_nfs` / StatefulSet PVC) | persistent | Critical | If the data directory is not persistent, a pod restart regenerates the signing key, breaking federation and invalidating all device sessions. |
| Database collation (`db-init`) | `C` (automatic) | Critical | Synapse refuses to start against any non-`C` collation; do not bypass the `db-init` job. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `container_port` / probe port | `8008` | High | Probes on any other port hit a dead port and the pod never becomes Ready even though Synapse is healthy. |
| Probe path | `/` (default) or `/health` | High | Pointing a probe at an authenticated Matrix API path returns 401/403 and the pod never becomes Ready. |
| `memory_limit` | `4Gi` (≥ 2 GiB) | High | Below 2 GiB Synapse OOMs under real room/federation load. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; keeping 1 ensures the homeserver is always reachable for federation. |
| `session_affinity` | `ClientIP` | High | Without stickiness, a client's requests scatter across pods, disrupting long-lived sync connections. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity; disabling it is blocked by a plan-time validation guard. |
| `enable_iap` | only for private servers | High | IAP blocks federation and external clients; use only for admin-only deployments. |
| Rolling update on NFS-backed pods | `Recreate` (automatic) | High | Two pods against the same data directory + DB can contend; the foundation uses `Recreate` for NFS-backed apps. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict all pods simultaneously during maintenance. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Synapse-specific
application configuration shared with the Cloud Run variant is described in
**[Synapse_Common](Synapse_Common.md)**.
