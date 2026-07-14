---
title: "Rocket.Chat on GKE Autopilot"
description: "Configuration reference for deploying Rocket.Chat on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Rocket.Chat on GKE Autopilot

Rocket.Chat is an open-source, self-hosted team-communication platform — a
Slack/Teams alternative built on Node.js and Meteor, with channels, direct messages,
threads, voice/video, and an omnichannel/LiveChat layer. This module deploys
Rocket.Chat on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation,
which provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Rocket.Chat uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

Rocket.Chat runs as a Node.js/Meteor **StatefulSet** with its datastore embedded in
the same pod. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js/Meteor pod, 1 vCPU / 2 GiB by default; a single StatefulSet replica |
| Datastore | Embedded MongoDB 6.0 replica set | Baked into the image — no Cloud SQL. Single-node replica set (`rs0`) over `127.0.0.1` |
| Persistence | Persistent Disk PVC (block storage) | The MongoDB data directory `/data/db` is on a `ReadWriteOnce` PVC — required for WiredTiger |
| Secrets | Secret Manager | Optional API token (`enable_api_key`) |
| Ingress | ClusterIP / Cloud Load Balancing | Internal by default; optional custom domain + managed certificate + Gateway |

**Sensible defaults worth knowing up front:**

- **MongoDB is embedded, not managed.** Meteor's real-time reactivity tails the
  MongoDB oplog, which only a **replica set** provides. No managed datastore here
  offers a MongoDB replica set, so the module bundles a single-node replica set
  (`rs0`) into the pod image. There is no Cloud SQL instance.
- **MongoDB 6.0 from the Debian bullseye repo.** The `rocketchat/rocket.chat` base
  image is Debian **bullseye** (glibc 2.31); the Dockerfile installs MongoDB 6.0 from
  the bullseye APT repo because the bookworm/7.0 package needs glibc ≥ 2.34.
- **`stateful_pvc_enabled = true` is required.** MongoDB's WiredTiger storage engine
  needs a real block filesystem — a `gcsfuse` mount corrupts it. The GKE deploy
  defaults enable a StatefulSet PVC at `/data/db` (matching `MONGO_DBPATH`). Setting
  `stateful_pvc_enabled = true` auto-resolves `workload_type` to `StatefulSet`.
- **Single replica only.** `min_instance_count = 1` and `max_instance_count = 1`. The
  PVC is `ReadWriteOnce` and the embedded MongoDB is a single writer; a second replica
  cannot attach the disk.
- **Port 3000.** Rocket.Chat listens on port 3000; the entrypoint sets `PORT=3000`.
- **Health on `/api/info`.** Startup, liveness, and uptime checks target `/api/info`,
  which returns 200 only once the server and its replica set are ready.
- **ClusterIP by default.** The Service is internal; expose it with a custom domain +
  Gateway (and optional IAP) to reach the UI from a browser.
- **First run is a 4-step setup wizard.** No admin is pre-seeded — the first browser
  visit walks through creating the admin account and organization.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Rocket.Chat workload

Rocket.Chat runs as a StatefulSet pod scheduled on Autopilot, which bills for the
CPU/memory the pod requests. Because the MongoDB data set lives on a `ReadWriteOnce`
PVC and the app is a single writer, the workload is a single replica.

- **Console:** Kubernetes Engine → Workloads → select the Rocket.Chat StatefulSet to
  see the pod, PVC, and events.
- **CLI:**
  ```bash
  kubectl get statefulset,pods,pvc,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pvc -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for how Autopilot, StatefulSets, and PVCs are managed.

### B. Embedded MongoDB (no Cloud SQL)

There is **no Cloud SQL instance** — `database_type = "NONE"`. MongoDB runs inside the
Rocket.Chat pod as a single-node replica set (`rs0`) over `127.0.0.1:27017`, with its
data on the StatefulSet PVC at `/data/db`. The entrypoint starts `mongod`, initiates
the replica set on first boot, waits for `PRIMARY`, and then launches Rocket.Chat.

```bash
# Confirm the embedded MongoDB reached PRIMARY on boot:
kubectl logs -n "$NAMESPACE" statefulset/<service-name> | grep -i "replica set rs0 is PRIMARY"
# Open a mongosh shell inside the pod (for maintenance / mongodump):
kubectl exec -it -n "$NAMESPACE" <pod> -- mongosh "mongodb://127.0.0.1:27017/rocketchat?replicaSet=rs0"
```

### C. Persistent Disk PVC (MongoDB data)

The MongoDB data set lives on a StatefulSet PVC (`standard-rwo` Balanced PD by
default) mounted at `/data/db`. This block volume is what makes WiredTiger safe — do
**not** replace it with a `gcsfuse` mount.

- **Console:** Kubernetes Engine → Storage → Persistent Volume Claims; Compute Engine
  → Disks.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud compute disks list --project "$PROJECT" --filter="name~pvc"
  ```

See [App_GKE](App_GKE.md) for StorageClasses, PVC sizing, and CMEK.

### D. Cloud Storage

A dedicated **Cloud Storage** bucket is provisioned for backups and uploaded-file
storage alongside the PVC. The workload service account is granted access.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/          # bucket name is in the Outputs
  ```

### E. Secret Manager

When `enable_api_key = true`, a random API token is generated and stored in Secret
Manager for external integrations, materialised into the namespace via the Secret
Store CSI driver. No other application secrets are created here — Rocket.Chat mints
and stores its own keys in MongoDB during first-run setup.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  kubectl get secrets -n "$NAMESPACE"
  ```

### F. Networking & ingress

By default the workload is a **ClusterIP** Service (internal). To reach the UI from a
browser, enable a custom domain with a Google-managed certificate (Gateway API) and,
optionally, IAP. A static IP can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get gateway,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

When you attach a custom domain, set `ROOT_URL` to that hostname. See [App_GKE](App_GKE.md).

### G. Cloud Logging & Monitoring

Pod stdout/stderr (both Rocket.Chat and the embedded `mongod`) flow to Cloud Logging;
GKE metrics flow to Cloud Monitoring. An optional uptime check targets `/api/info`.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Rocket.Chat Application Behaviour

- **Embedded replica-set bootstrap.** On every pod start the entrypoint starts
  `mongod --replSet rs0`, initiates the replica set once (idempotent), waits until the
  node is `PRIMARY`, then exports `MONGO_URL` / `MONGO_OPLOG_URL` and starts
  Rocket.Chat. The oplog URL enables Meteor's real-time updates.
- **First-run setup wizard.** The first browser visit opens a 4-step wizard:
  (1) **Admin Info** — create the admin account (name, username, email, password);
  (2) **Organization Info** — name, type, industry, size, country; (3) **Register
  Server** — register with Rocket.Chat Cloud or keep the server standalone;
  (4) **Complete**. No admin is pre-seeded.
- **Data persistence.** All state (messages, users, settings) lives in the embedded
  MongoDB on the PVC at `/data/db`. Deleting the PVC deletes the workspace.
- **`ROOT_URL` correctness.** The entrypoint defaults `ROOT_URL` to the computed
  service URL. If you serve Rocket.Chat on a custom domain, set `ROOT_URL` (via
  `environment_variables`) to that URL, or links and OAuth redirects point at the
  wrong host.
- **Updates recreate the single pod.** With one StatefulSet replica on a `RWO` PVC, a
  rollout terminates the old pod before the new one attaches the disk — brief downtime
  is expected during version upgrades.
- **Health path.** Startup and liveness probes target `/api/info`. Allow a few minutes
  on first boot for the replica-set election and Rocket.Chat's initial migrations.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Rocket.Chat are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. Use `gke` to run alongside a Cloud Run variant. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `rocketchat` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `RocketChat Vector Database` | Human-readable name shown in the Console (default carries a legacy label; override to something like `Rocket.Chat Team Chat`). |
| `application_version` | `latest` | Rocket.Chat image tag; `latest` pins the build to `6.12.1`. Pin to a specific release in production. |
| `enable_api_key` | `false` | Generate a random API token in Secret Manager for external integrations. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per pod. |
| `memory_limit` | `4Gi` | Memory per pod; Rocket.Chat + embedded MongoDB share it. |
| `min_instance_count` | `1` | Keep at 1 — GKE requires min ≥ 1 and the embedded MongoDB is single-writer. |
| `max_instance_count` | `1` | **Keep at 1** — the `RWO` PVC and single-writer MongoDB forbid a second replica. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | Not applicable — Rocket.Chat has no SQL database. |
| `enable_image_mirroring` | `true` | Mirror the Rocket.Chat image into Artifact Registry. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not set `MONGO_URL`/`MONGO_OPLOG_URL`/`MONGO_DBPATH` — the entrypoint owns them. Use `OVERWRITE_SETTING_*` to seed admin settings; set `ROOT_URL` for a custom domain. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `ClusterIP` | How the Kubernetes Service is exposed; front with a Gateway for external access. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true` (required). |
| `session_affinity` | `None` | Set `ClientIP` for stable WebSocket routing behind a load balancer. |
| `termination_grace_period_seconds` | `60` | Seconds after SIGTERM before SIGKILL — allow MongoDB to flush and shut down cleanly. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | **Set `true` (required).** MongoDB's WiredTiger engine needs block storage — `gcsfuse` corrupts it. Auto-selects StatefulSet. |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC size; size to hold the MongoDB data set. Cannot be decreased. |
| `stateful_pvc_mount_path` | `/data/db` | **Must equal `MONGO_DBPATH`** so the PVC holds the MongoDB data set. |
| `stateful_pvc_storage_class` | `standard-rwo` | `standard-rwo` (Balanced PD) or `premium-rwo` (higher IOPS for MongoDB). |
| `stateful_fs_group` | `3000` | fsGroup GID for PVC write access (Rocket.Chat Helm chart default). |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Create a namespace ResourceQuota. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Binary units only** (`4Gi`, `8192Mi`) — bare integers are bytes and block scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/info` 60s delay, 40 failures | Startup probe. Allow a few minutes on first boot. |
| `liveness_probe` | HTTP `/api/info` 30s delay | Liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check against `/api/info`. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No default init job — the embedded MongoDB is bootstrapped by the entrypoint. |
| `cron_jobs` | `[]` | Kubernetes CronJobs (e.g., `mongodump` backups). |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside Rocket.Chat. |

### Group 12 — CI/CD & Binary Authorization

Standard App_GKE Cloud Build / Cloud Deploy integration — see [App_GKE](App_GKE.md).
Key inputs: `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS off by default; MongoDB uses the block PVC. Enable only for uploaded-file sharing. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the backup/file bucket. |
| `gcs_volumes` | `[]` | GCS Fuse mounts — **not** for MongoDB data (use the PVC). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore a MongoDB dump on deploy. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Gateway for custom hostnames + managed certificate. Set `ROOT_URL` to match. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Rocket.Chat (requires `enable_custom_domain`). |
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
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

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
| `service_external_ip` | External IP (when a static IP is reserved). |
| `service_url` | URL to reach the Rocket.Chat web UI. |
| `rocketchat_api_key_secret_id` | Secret Manager secret ID for the API token (empty when `enable_api_key = false`). |
| `statefulset_name` | Name of the StatefulSet. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any setup jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — `workload_type = "Deployment"` with `stateful_pvc_enabled = true`, IAP with no authorized identities, non-binary quota units, an out-of-range `backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critical | On `gcsfuse` (the default when unset) MongoDB's WiredTiger data set corrupts — the workspace is unrecoverable. |
| `stateful_pvc_mount_path` | `/data/db` | Critical | Any other path means the PVC does not hold the MongoDB data set; data lives on the ephemeral pod filesystem and is lost on restart. |
| `max_instance_count` | `1` | Critical | The `RWO` PVC and single-writer MongoDB cannot support a second replica; the surge pod fails to attach the disk and corrupts state if forced. |
| PVC / `/data/db` (auto) | Never delete | Critical | Deleting the PVC deletes the entire workspace. |
| `workload_type` | leave `null` | High | Setting `Deployment` with `stateful_pvc_enabled = true` fails at plan time; leave it unset to auto-resolve to StatefulSet. |
| `ROOT_URL` (custom domain) | Match the served hostname | High | A mismatched `ROOT_URL` breaks invite links, file URLs, and OAuth callbacks. |
| `memory_limit` | `4Gi` (default) | High | Rocket.Chat plus MongoDB in one pod OOM below ~2 GiB under real load. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `stateful_pvc_storage_class` | `standard-rwo` (or `premium-rwo`) | Medium | `premium-rwo` gives MongoDB more IOPS for busy workspaces at higher cost. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict the pod during maintenance with no protection. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Rocket.Chat-specific
application configuration shared with the Cloud Run variant is described in
**[RocketChat_Common](RocketChat_Common.md)**.
