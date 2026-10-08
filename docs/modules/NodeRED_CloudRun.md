---
title: "Node-RED on Google Cloud Run"
description: "Configuration reference for deploying Node-RED on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Node-RED on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/NodeRED_CloudRun.png" alt="Node-RED on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Node-RED is an open-source flow-based programming tool for wiring together IoT
devices, APIs, and online services through a visual browser-based editor. This
module deploys Node-RED on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Node-RED uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## What NodeRED costs on RAD, and how that compares

**NodeRED on RAD's Cloud Run module costs about US$31 a month, with the module fee charged once in RAD credits.** Need NodeRED to stay up continuously, scale across pods, or run beside other Kubernetes workloads — or see the [GKE guide](NodeRED_GKE.md) for that option. If you only need it occasionally — a demo, a seasonal project, something you're evaluating — a RAD-managed project can be deleted and restored within 30 days for a handful of credits (under US$1) instead of paying for it to sit idle. See **Pause it for free**, below. Figures are as at 8 October 2026; sources are listed at the end of this section.

### What you pay on RAD

RAD deploys **NodeRED**, which is open source, so there is no licence fee per user. You pay for
three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 40 credits (US$4 at the top-up price) | 36 credits (10% lower) |
| Build time | About 3-6 credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$31 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **9 credits a day**, about 270 a month (about US$27 at the top-up price, US$22 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second set of them.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (scaleToZero) | US$11.58 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$31** |

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
  deleting one module, this does not tear down the VM or the compute resource
  one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a few credits, not a rebuild.** Within 30 days, the project's owner can restore
  it. RAD asks Google to undelete the project and reattaches its billing account, then asks you to
  run **Update** on each deployment to confirm everything came back. Because nothing was
  individually destroyed, that Update finds the same resources already there — it is a check, not a
  rebuild, and an Update never charges the module fee again. That costs roughly a handful of credits (under US$1) in
  total for a typical 2-3-deployment chain.
- **So a month of occasional use can cost a few dollars, not US$31.** Deploy NodeRED, use
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
  about 4 days or more in your own project (about US$1.03 a
  day), or about 5 days or more in a RAD-managed one (9 credits a
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

Node-RED runs as a Node.js container on Cloud Run v2 (gen2) listening on port
1880. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Node.js service, 1 vCPU / 1 GiB by default, request-based autoscaling |
| Persistent flow storage | Filestore (NFS) | Flows, credentials, and installed nodes in `/data` (requires gen2) |
| Object storage | Cloud Storage | A dedicated application data bucket |
| Context storage | Redis (optional) | Disabled by default; enables cross-restart and cross-instance context sharing |
| Credential secret | Secret Manager | Auto-generated `NODE_RED_CREDENTIAL_SECRET` encrypts flow credentials |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No database is required.** Node-RED stores all state in its `/data`
  directory; `database_type` defaults to `"NONE"`.
- **NFS is enabled by default.** The `/data` directory is mounted from a
  Filestore share (requires `execution_environment = "gen2"`) so flows,
  credentials, and installed nodes survive container restarts and new
  deployments.
- **Scale-to-zero is supported** (`min_instance_count = 0`). Set to `1` for
  production webhook workloads to avoid cold-start delays and missed webhooks
  during the NFS remount window.
- **`max_instance_count = 1` by default.** Node-RED is not designed for
  active-active horizontal scaling; each instance has its own in-memory
  context. Increase only when using Redis-backed external context storage.
- **`NODE_RED_CREDENTIAL_SECRET` is auto-generated.** It encrypts all stored
  flow credentials and is kept in Secret Manager. Rotating it after flows are
  deployed renders existing credentials unreadable.
- **Health probes use HTTP GET `/`**, which returns the editor UI once
  Node-RED is ready (30-second initial delay is sufficient).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Node-RED service

Node-RED runs as a Cloud Run v2 service that autoscales by request load between
the minimum and maximum instance counts. Each deployment creates an immutable
revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs,
  and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency,
execution environment, and traffic splitting.

### B. Filestore (NFS) — persistent flow storage

Node-RED stores all persistent data — flows (`flows.json`), encrypted
credentials (`flows_cred.json`), installed palette nodes, and the settings
file — in its `/data` directory. A Filestore NFS share is mounted at `/data`
(gen2 required) so data survives container restarts and new service revisions.

- **Console:** Filestore → Instances for the NFS share.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Inspect the mounted volume from an active instance:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.volumes)'
  ```

See [App_CloudRun](App_CloudRun.md) for the NFS mount, GCS Fuse, and CMEK.

### C. Cloud Storage

A dedicated GCS bucket is provisioned for Node-RED application data (flow
exports, backup archives). The service account is granted access automatically.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for CMEK options.

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

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Redis (optional context storage)

When `enable_redis = true`, Node-RED is configured to store flow context
externally in Redis, allowing context data to persist across instance restarts
and to be shared between multiple instances. Redis is disabled by default.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

When `enable_redis = true` and `redis_host` is empty but `enable_nfs = true`,
the NFS server IP is used as the Redis host; otherwise `redis_host` must be
set explicitly.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS
load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered
on; ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Node-RED Application Behaviour

- **No database, no initialization job.** Node-RED stores all state in `/data`.
  No Cloud SQL instance is provisioned and no schema initialization job is
  required. The first start creates the default flow files automatically if
  `/data` is empty.
- **Flow credential encryption.** `NODE_RED_CREDENTIAL_SECRET` is injected at
  runtime from Secret Manager. This key encrypts the `flows_cred.json` file on
  the NFS share. Changing or rotating the key after flows are deployed renders
  all stored credentials (API keys, passwords, tokens) unreadable.
- **Safe mode.** `NODE_RED_ENABLE_SAFE_MODE` is always set to `"false"`,
  ensuring flows execute on startup. Override it to `"true"` via
  `environment_variables` to start Node-RED with flows disabled for debugging.
- **Scale-to-zero and cold starts.** With `min_instance_count = 0`, Node-RED
  scales to zero when idle. On scale-up the NFS volume must remount before the
  health check passes (roughly 10–20 seconds). Webhooks fired during this
  window may be lost. Set `min_instance_count = 1` for production webhook
  workloads.
- **Health probe.** Both startup and liveness probes send HTTP GET to `/`,
  which returns the editor UI once Node-RED is ready. A 30-second initial
  delay is sufficient.
- **Scheduled tasks.** Node-RED has no built-in scheduled commands. Use
  `cron_jobs` to provision Cloud Scheduler-triggered Cloud Run jobs for
  periodic maintenance tasks such as flow exports or cache flushes:
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Accessing the editor.** Browse to the `service_url` output and log in.
  For production deployments, enable IAP (`enable_iap = true`) to gate access
  with Google identity authentication — the editor exposes full flow editing
  and credential management.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Node-RED are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `nodered` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Node-RED` | Friendly name shown in the Console. |
| `application_version` | `latest` | Image tag for `nodered/node-red`. Pin to a specific version (e.g. `4.0.9`) for reproducible deployments. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance; 1 vCPU is sufficient for most deployments. |
| `memory_limit` | `1Gi` | Memory per instance; raise to `2Gi` for flows that process large payloads. |
| `min_instance_count` | `0` | Minimum instances. `0` enables scale-to-zero; set to `1` for production webhook workloads. |
| `max_instance_count` | `1` | Maximum instances. Keep at `1` unless flows are stateless or Redis-backed. |
| `execution_environment` | `gen2` | **Must be `gen2` for NFS volume mounts to function.** |
| `timeout_seconds` | `300` | Maximum request duration before a 504 is returned. |
| `cpu_always_allocated` | `false` | When `false`, CPU is throttled at idle. Set `true` only if background tasks require continuous CPU. |
| `enable_image_mirroring` | `true` | Mirror from Docker Hub into Artifact Registry to avoid rate limits. |
| `traffic_split` | `[]` | Allocates traffic across revisions for canary/blue-green rollouts. |
| `max_revisions_to_retain` | `7` | Cloud Run revisions to keep after each deployment. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Which networks may reach the service. Use `"internal-and-cloud-load-balancing"` with Cloud Armor for production webhooks. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Outbound routing through the VPC connector. |
| `enable_iap` | `false` | Require Google sign-in. Strongly recommended for production. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not set `NODE_RED_CREDENTIAL_SECRET` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification period. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated NFS backup cron (UTC). Leave empty to disable. |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — NFS Instance & Custom SQL

| Variable | Default | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(auto)_ | Existing NFS instance / base name for an inline one. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_*` | off | Not applicable to Node-RED; kept for API compatibility. |

### Group 10 — Domain, CDN, Cloud Armor & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. `application_domains` is optional — a `nip.io` certificate is derived when unset. |
| `application_domains` | `[]` | Custom hostnames with Google-managed SSL. |
| `enable_cdn` | `false` | Enable Cloud CDN on the LB backend. Requires `enable_cloud_armor = true`. |
| `admin_ip_ranges` | `[]` | CIDRs exempted from WAF rules. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume for Node-RED's `/data` directory. Strongly recommended. Requires gen2. |
| `nfs_mount_path` | `/data` | Must match Node-RED's native data directory. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(set)_ | Data bucket / additional buckets / GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Credential Secret

| Variable | Default | Description |
|---|---|---|
| `database_password_length` | `32` | Length of the auto-generated `NODE_RED_CREDENTIAL_SECRET` (16–64). |
| `enable_auto_password_rotation` | `false` | Automated credential secret rotation. Rotating the key renders existing flow credentials unreadable. |
| `rotation_propagation_delay_sec` | `90` | Seconds to wait after rotation before restarting the service. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Node-RED requires no init jobs. Provide custom jobs for flow imports or palette installations. |
| `cron_jobs` | `[]` | Recurring Cloud Run jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 30s delay | HTTP probe against the Node-RED editor path. |
| `liveness_probe` | HTTP `/`, 30s delay | Liveness probe — restarts the container if the editor is unresponsive. |
| `uptime_check_config` | disabled, path `/` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Context Storage

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis for Node-RED context storage. |
| `redis_host` | `""` | Redis endpoint. Required when `enable_redis = true` (unless `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore
the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the Node-RED service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any setup jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_nfs` | `true` | Critical | Without NFS, all flows, credentials, and installed nodes are lost on every instance restart or new deployment. |
| `NODE_RED_CREDENTIAL_SECRET` (from `database_password_length`) | auto-generated | Critical | Encrypts all flow credentials. Rotating or changing the key after flows are deployed makes existing credentials permanently unreadable. |
| `enable_auto_password_rotation` | `false` | Critical | Automatic rotation changes the encryption key; all stored flow credentials become inaccessible. Only enable with a re-encryption procedure in place. |
| `application_name` | set once | Critical | Immutable after first deploy; renaming recreates all GCP resources and disconnects the NFS share. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the restore job. |
| `execution_environment` | `gen2` | High | NFS mounts require gen2; using gen1 causes mount failures and container startup errors. |
| `max_instance_count` | `1` | High | Node-RED is not designed for active-active scaling. Multiple instances without shared context cause conflicting state. |
| `min_instance_count` | `1` for webhooks | High | Scale-to-zero causes cold starts of 10–20 seconds; webhooks fired during NFS remount are lost. |
| `nfs_mount_path` | `/data` | High | Must match Node-RED's native data directory. Changing it routes writes to ephemeral storage. |
| `database_type` | `NONE` | High | Setting to `MYSQL` or `POSTGRES` provisions an unnecessary Cloud SQL sidecar. |
| `enable_redis` without `redis_host` | set `redis_host` explicitly | High | Without NFS fallback, an empty Redis host causes context storage failures. |
| `enable_iap` | `true` for production | High | The editor exposes full flow editing and credential management and should not be publicly accessible. |
| `ingress_settings` | `internal-and-cloud-load-balancing` for prod | Medium | `"internal"` blocks all external webhooks; `"all"` exposes the service directly without WAF. |
| `memory_limit` | `1Gi` | Medium | Flows processing large payloads or using image-processing nodes may require `2Gi`. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Node-RED-specific application configuration
shared with the GKE variant is described in **[NodeRED_Common](NodeRED_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: NodeRED on Cloud Run](../labs/NodeRED_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Node-RED on GKE Autopilot](NodeRED_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [NodeRED Common — Shared Application Configuration](NodeRED_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [n8n on Google Cloud Run](N8N_CloudRun.md), [Activepieces on Google Cloud Run](Activepieces_CloudRun.md), [Ntfy on Google Cloud Run](Ntfy_CloudRun.md), [EvolutionAPI on Google Cloud Run](EvolutionAPI_CloudRun.md) in the **Workflow Automation Hub** solution.
