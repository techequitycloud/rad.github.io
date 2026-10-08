---
title: "Node-RED on GKE Autopilot"
description: "Configuration reference for deploying Node-RED on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Node-RED on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/NodeRED_GKE.png" alt="Node-RED on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Node-RED is an open-source flow-based programming tool for wiring together IoT
devices, APIs, and online services through a visual browser-based editor. This
module deploys Node-RED on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Node-RED uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## What NodeRED costs on RAD, and how that compares

**NodeRED on RAD's GKE Autopilot module costs about US$37–110 a month, with the module fee charged once in RAD credits.** GKE Autopilot suits NodeRED that must stay up, scale across pods or run beside other Kubernetes workloads; for the lowest cost, the [Cloud Run module](NodeRED_CloudRun.md) runs the same NodeRED for about US$31 a month. If you only need it occasionally — a demo, a seasonal project, something you're evaluating — a RAD-managed project can be deleted and restored within 30 days for a handful of credits (under US$1) instead of paying for it to sit idle. See **Pause it for free**, below. Figures are as at 8 October 2026; sources are listed at the end of this section.

### What you pay on RAD

RAD deploys **NodeRED**, which is open source, so there is no licence fee per user. You pay for
three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 40 credits (US$4 at the top-up price) | 36 credits (10% lower) |
| Build time | About 3-6 credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$37 a month** for the default configuration (table below) — more if this isn't your only Autopilot cluster | Metered hourly in credits; RAD publishes **61 credits a day**, about 1,830 a month (about US$183 at the top-up price, US$146 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second set of them.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 0.5x vCPU / 0.5 GiB | US$18.04 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | shared across every GKE app in the project; $0 if this is your only cluster, else ~73 |
| **Total** | **about US$37** (about US$110 if this isn't your only Autopilot cluster) |

### How it compares

- **No turnkey managed SaaS was verified for NodeRED itself**, so the honest comparison is a self-managed server: a Hetzner CPX22 (2 vCPU/4 GB) costs about $24/month, a DigitalOcean 2 vCPU/4 GB Droplet about $24/month, and a GCP Compute Engine e2-standard-2 (2 vCPU/8 GB) about $49/month.
- This is a light workload — a cheaper, smaller VPS class than the reference boxes below would also do the job; the figures are shown for a like-for-like comparison.
- No managed SaaS offering for this exact open-source project could be verified with a current, published price, so no figure is given here. Node-RED is usually run alongside other automation infrastructure rather than bought as a standalone subscription, so the realistic alternative is a small self-managed VPS.
- **The VPS price is not the whole cost.** On a bare VPS you are also the one patching the OS, rotating backups and keeping the database (if any) healthy. RAD's managed Cloud SQL, Secret Manager and monitoring cover that for you, which is the real argument for RAD over a cheaper box — not the sticker price.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If NodeRED runs in **a project RAD manages for you**, you have a second option that goes well
beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to
nothing.** This suits NodeRED you only need occasionally — a demo, an evaluation, a seasonal
project — far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google to
  delete the project. Google does not remove the project immediately: it keeps it, recoverable,
  for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike
  deleting one module, this does not tear down the VM, the cluster or the compute resource
  one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a few credits, not a rebuild.** Within 30 days, the project's owner can restore
  it. RAD asks Google to undelete the project and reattaches its billing account, then asks you to
  run **Update** on each deployment to confirm everything came back. Because nothing was
  individually destroyed, that Update finds the same resources already there — it is a check, not a
  rebuild, and an Update never charges the module fee again. That costs roughly a handful of credits (under US$1) in
  total for a typical 2-3-deployment chain.
- **So a month of occasional use can cost a few dollars, not US$37.** Deploy NodeRED, use
  it for a while, delete the project. Restore it next time you want it, confirm with Update, and
  delete it again when you're done. You pay only for the module fee once, the builds, and whatever
  time NodeRED was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages billing
  for), and you restore it yourself within the 30 days — after that, Google deletes it for good.
  Restoring is admitted like creating a new project: your purchased credit balance must still clear
  the tier's floor (100 credits for the sandbox tier most study and demo use fits). Google says most
  services are fully working again within 36 hours of a restore.
- **One real gap: nightly backups don't survive.** Backups are written to a bucket inside the
  project, and that bucket is **not** protected by Cloud Storage's soft-delete, so it is very likely
  gone as soon as you delete the project — even though the project itself is recoverable for 30
  days. If you've customised NodeRED and want to keep that work, copy a backup out (to Google Drive,
  or a bucket outside the project) before you delete. For a default installation with nothing
  irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

The option above only applies to a RAD-managed project; **in your own project, or once the 30-day
window has passed, the way to stop paying is to delete the deployment and deploy it again when you
need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 45
  credits (US$4.50) in your own project, or 41
  credits in a RAD-managed one. Deleting saves money once NodeRED would otherwise sit unused for
  about 4 days or more in your own project (about US$1.25 a
  day), or about 1 days or more in a RAD-managed one (61 credits a
  day).
- **Most of the running cost is usually the database and any shared file/cache VM.** They stop only
  when nothing else in the project uses them, so deleting NodeRED while something else shares the
  project saves only this app's own compute part.
- **Keep your data first.** Nightly backups go to a bucket inside the deployment and are deleted
  with it, so copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  NodeRED in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs NodeRED for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing
  pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands
  the project over and the deployments become the client's own.
- Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by
  card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the 30-day recovery window and what it says about Cloud Storage objects without soft delete; RAD fees and the daily-credit estimates from [radmodules.dev/pricing](https://radmodules.dev/pricing). Prices change; check each source before relying on a figure.

## 1. Overview

Node-RED runs as a Node.js container listening on port 1880. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pods, 500m CPU / 512 MiB by default, horizontally autoscaled |
| Persistent flow storage | Filestore (NFS) | Flows, credentials, and installed nodes in `/data`, shared across all replicas |
| Object storage | Cloud Storage | A dedicated application data bucket |
| Context storage | Redis (optional) | Disabled by default; enables cross-restart and cross-instance context sharing |
| Credential secret | Secret Manager | Auto-generated `NODE_RED_CREDENTIAL_SECRET` encrypts flow credentials |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **No database is required.** Node-RED stores all state in its `/data`
  directory; `database_type` defaults to `"NONE"`.
- **NFS is enabled by default.** The `/data` directory is mounted from a
  Filestore share so flows, credentials, and installed nodes survive pod
  restarts and rescheduling.
- **`max_instance_count = 1` by default.** Node-RED is not designed for
  active-active horizontal scaling — each instance has its own in-memory
  context. Increase only when using Redis-backed external context storage.
- **Session affinity is `ClientIP`.** The editor UI uses persistent WebSocket
  connections; without stickiness, browser sessions disconnect on every
  request that routes to a different pod.
- **`NODE_RED_CREDENTIAL_SECRET` is auto-generated.** It encrypts all stored
  flow credentials and is kept in Secret Manager. Rotating it renders existing
  credentials unreadable — handle with care.
- **Health probes use HTTP GET `/`**, which returns the editor UI once
  Node-RED is fully started (30-second initial delay is sufficient).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Node-RED workload

Node-RED pods are scheduled on Autopilot, which bills for the CPU and memory
the pods actually request. Horizontal Pod Autoscaling sizes the deployment
between the minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Node-RED workload
  to see pods, revisions, and events. Kubernetes Engine → Services & Ingress
  shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Filestore (NFS) — persistent flow storage

Node-RED stores all persistent data — flows (`flows.json`), encrypted
credentials (`flows_cred.json`), installed palette nodes, and the settings
file — in its `/data` directory. An NFS share from Cloud Filestore is mounted
at `/data` so that data survives pod restarts, rescheduling, and
redeployments. All replicas share the same data.

- **Console:** Filestore → Instances for the NFS share.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Confirm the share is mounted inside the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /data
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, backup, and CMEK options.

### C. Cloud Storage

A dedicated GCS bucket is provisioned for Node-RED application data (flow
exports, backup archives). The workload service account is granted access
automatically.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for CMEK options.

### D. Secret Manager — flow credential encryption

`NODE_RED_CREDENTIAL_SECRET` is generated automatically during deployment and
stored as a Secret Manager secret. Node-RED uses this key to encrypt all
credentials stored in flows. No other application-specific secrets are
generated by this module.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Redis (optional context storage)

When `enable_redis = true`, Node-RED is configured to store flow context
externally in Redis, allowing context data to persist across pod restarts and
to be shared between multiple instances. Redis is disabled by default.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

When `enable_redis = true` and `redis_host` is empty, the NFS server IP is
used as the Redis host. If NFS is also disabled, `redis_host` must be set
explicitly.

### F. Networking & ingress

The workload is exposed through an external Cloud Load Balancing IP.
`enable_custom_domain` defaults to `true`, provisioning a Kubernetes Ingress
with a Google-managed certificate for the hostnames in `application_domains`;
a static IP is reserved by default so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN,
and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Node-RED Application Behaviour

- **No database, no initialization job.** Node-RED stores all state in its
  `/data` directory. No Cloud SQL instance is provisioned and no schema
  initialization job is required. The first start creates the default flow
  files automatically if `/data` is empty.
- **Flow credential encryption.** `NODE_RED_CREDENTIAL_SECRET` is injected
  at runtime from Secret Manager. This key encrypts the `flows_cred.json` file
  on the NFS share. Changing or rotating the key after flows are deployed
  renders all stored credentials (API keys, passwords, tokens) unreadable.
- **Safe mode.** `NODE_RED_ENABLE_SAFE_MODE` is always set to `"false"`,
  ensuring flows execute on startup. Override it to `"true"` via
  `environment_variables` to start Node-RED with flows disabled for debugging.
- **WebSocket editor sessions.** The Node-RED editor communicates over
  persistent WebSocket connections. Session affinity (`ClientIP`) is required
  to keep editor sessions routed to the same pod; without it, deploy
  operations fail with WebSocket disconnections.
- **Health probe.** Both the startup and liveness probes send HTTP GET to `/`,
  which returns the editor UI once Node-RED is ready. A 30-second initial
  delay is sufficient for a standard startup.
- **Scheduled tasks and CronJobs.** Node-RED has no built-in scheduled
  commands. Use `cron_jobs` to provision Kubernetes CronJobs for periodic
  maintenance tasks such as flow exports or cache flushes:
  ```bash
  kubectl get cronjobs -n "$NAMESPACE"
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  ```
- **Accessing the editor.** Browse to the `service_url` output and log in.
  For production deployments, enable IAP (`enable_iap = true`) to gate access
  with Google identity authentication.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Node-RED are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `nodered` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Node-RED` | Friendly name shown in the Console and dashboards. |
| `application_description` | `Node-RED - Flow-based programming for IoT and event automation` | Workload description annotation. |
| `application_version` | `latest` | Image tag for `nodered/node-red`. Pin to a specific version (e.g. `4.0.9`) for reproducible deployments. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Use `"prebuilt"` for the official Docker Hub image; `"custom"` to build via Cloud Build. |
| `container_image` | `nodered/node-red:latest` | Full image URI when `container_image_source = "prebuilt"`. |
| `container_resources` | `{ cpu_limit = "500m", memory_limit = "512Mi" }` | CPU and memory limits. Node-RED is lightweight; also accepts optional `cpu_request`, `mem_request`, `ephemeral_storage_limit`, `ephemeral_storage_request`. |
| `container_port` | `1880` | Node-RED's native HTTP port. |
| `min_instance_count` | `1` | Minimum replicas (must be ≥ 1 for GKE). |
| `max_instance_count` | `1` | Maximum replicas. Keep at `1` unless using Redis-backed external context storage. |
| `enable_image_mirroring` | `true` | Mirror from Docker Hub into Artifact Registry to avoid rate limits. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |
| `timeout_seconds` | `300` | Maximum load balancer backend wait time (seconds). |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not set `NODE_RED_CREDENTIAL_SECRET` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification period. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing required for the Node-RED editor WebSocket connections. |
| `namespace_name` | `""` | Auto-generated from `application_name` and `tenant_id` when empty. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true`; otherwise `Deployment`. |
| `network_tags` | `["nfsserver"]` | Required for NFS firewall connectivity — do not remove when `enable_nfs = true`. |

### Group 7 — StatefulSet Configuration

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable per-pod PVC templates. Setting to `true` auto-selects `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Storage size for each PVC. |
| `stateful_pvc_mount_path` | `/data` | Mount path — set to `/data` to back Node-RED's data directory with a dedicated PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are read as bytes and block scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/`, 30s delay | HTTP probe against the Node-RED editor path. |
| `health_check_config` | HTTP `/`, 30s delay | Liveness probe — restarts the container if the editor is unresponsive. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Optional Cloud Monitoring uptime check. Disabled by default; enable for production monitoring. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Node-RED requires no init jobs. Provide custom jobs for flow imports or palette installations. |
| `cron_jobs` | `[]` | Kubernetes CronJobs for periodic maintenance tasks. |
| `additional_services` | `[]` | Supplementary Kubernetes Deployments deployed alongside Node-RED. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for Node-RED's `/data` directory. Strongly recommended. |
| `nfs_mount_path` | `/data` | Must match Node-RED's data directory. |
| `nfs_volume_name` | `nfs-data-volume` | Kubernetes volume name for the NFS mount. |
| `nfs_instance_name` / `nfs_instance_base_name` | _(auto)_ | Existing NFS VM name or base name for an inline one. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the GCS buckets in `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | GCS buckets to provision. `NodeRED_Common` adds a `nodered-storage` bucket automatically. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 15 — Redis Context Storage

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis for Node-RED context storage. |
| `redis_host` | `""` | Redis endpoint. Required when `enable_redis = true` (unless `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Credential Secret & Database

| Variable | Default | Description |
|---|---|---|
| `database_password_length` | `32` | Length of the auto-generated `NODE_RED_CREDENTIAL_SECRET` (16–64). |
| `database_type` | `NONE` | Node-RED requires no database. Do not change. |
| `enable_auto_password_rotation` | `false` | Automated credential secret rotation. Rotating the key renders existing flow credentials unreadable. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated NFS backup cron (UTC). Leave empty to disable. |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` | restore options | Restore from a backup on deploy. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `network_tags` | `["nfsserver"]` | Required for NFS firewall connectivity. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Node-RED. Strongly recommended for production — the editor exposes full flow editing. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | `default-waf-policy` | Policy name. |
| `enable_cdn` | `false` | Enable Cloud CDN on the Ingress backend. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way
to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Node-RED. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any setup jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. `false` on first apply of a new inline cluster — a second apply is required. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_nfs` | `true` | Critical | Without NFS, all flows, credentials, and installed nodes are lost on every pod restart or rescheduling event. |
| `NODE_RED_CREDENTIAL_SECRET` (from `database_password_length`) | auto-generated | Critical | Encrypts all flow credentials. Rotating or changing the key after flows are deployed makes existing credentials permanently unreadable. |
| `enable_auto_password_rotation` | `false` | Critical | Automatic rotation changes the encryption key; all stored flow credentials become inaccessible. Only enable with a re-encryption procedure in place. |
| `application_name` | set once | Critical | Immutable after first deploy; renaming recreates all GCP and Kubernetes resources and disconnects the NFS share. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_file` fails the restore job. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are bytes and block all pod scheduling. |
| `max_instance_count` | `1` | High | Node-RED is not designed for active-active scaling. Multiple instances without shared context cause conflicting state. |
| `session_affinity` | `ClientIP` | High | Without stickiness, the editor WebSocket disconnects and deploy operations fail. |
| `nfs_mount_path` | `/data` | High | Must match Node-RED's native data directory. Changing it without updating the settings file routes writes to ephemeral storage. |
| `execution_environment` (Cloud Run only) | `gen2` | High | NFS mounts require gen2. |
| `database_type` | `NONE` | High | Setting to `MYSQL` or `POSTGRES` provisions a Cloud SQL instance and proxy sidecar that Node-RED does not use. |
| `enable_redis` without `redis_host` | set `redis_host` explicitly | High | With NFS disabled and no Redis host, the Redis connection string is empty and context storage fails. |
| `enable_iap` | `true` for production | High | The Node-RED editor exposes full flow editing and credential management; it should not be left publicly accessible. |
| `min_instance_count` | `1` | Medium | GKE does not support true scale-to-zero without KEDA. The HPA rejects `min > max`. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling PDB allows GKE to evict the pod during node maintenance, causing a complete outage and potential data loss if an NFS write was in progress. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Node-RED-specific application configuration shared
with the Cloud Run variant is described in **[NodeRED_Common](NodeRED_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: NodeRED on GKE Autopilot](../labs/NodeRED_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Node-RED on Google Cloud Run](NodeRED_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [NodeRED Common — Shared Application Configuration](NodeRED_Common.md) — the configuration shared by both deployment targets.
