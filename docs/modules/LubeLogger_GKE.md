---
title: "LubeLogger on GKE Autopilot"
description: "Configuration reference for deploying LubeLogger on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# LubeLogger on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LubeLogger_GKE.png" alt="LubeLogger on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

LubeLogger is a free, open-source vehicle maintenance and fuel-mileage tracker built
on ASP.NET Core (.NET), shipped as a single container image with an embedded LiteDB
database. This module deploys LubeLogger on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services LubeLogger uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## What LubeLogger costs on RAD, and how that compares

**LubeLogger on RAD's GKE Autopilot module costs about US$42 a month in your own project, with no per-vehicle fee.** RAD charges 75 credits once per deployment in your own project (67.5 credits, 10% lower, in a project RAD manages), plus build time. The same app also deploys on Cloud Run for about US$33 a month — see the [Cloud Run guide](LubeLogger_CloudRun.md) for the lower-cost option. If you only need it occasionally, a RAD-managed project can be deleted and restored within 30 days for a few credits, so that monthly figure becomes a few dollars instead — see **Pause it for free**, below.


### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 75 credits (US$7.50 at the top-up price) | 67.5 credits (10% lower) |
| Build time | A few credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$42 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **67 credits a day**, about 2,010 a month (about US$201.00 at the top-up price, less on a plan) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 1x vCPU / 1 GiB | US$36 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | shared across every GKE app in the project; US$0 if this is your only cluster, else ~US$73 |
| **Total** | **about US$42** |

### How it compares

- **AUTOsist**, a commercial fleet-maintenance tracker, charges **US$6–7 per vehicle
  per month**, with a **US$59-a-month minimum for 5 vehicles** on its base Maintenance
  package.
- RAD's LubeLogger module costs about US$42 a month in your own project — in
  the same range as AUTOsist's 5-vehicle minimum, but with **no per-vehicle fee and no vehicle
  count ceiling**: a household tracking two cars costs exactly the same as a small fleet
  tracking twenty.
- Self-managed comparison: at 1 vCPU / 1 GiB, a Hetzner CPX22 or
  DigitalOcean 2 vCPU/4 GB droplet (~US$24/month) would run LubeLogger fine, but you would
  still run the OS, backups and upgrades yourself.


### Pause it for free: delete a RAD-managed project, restore it when you need it

If LubeLogger runs in **a project RAD manages for you**, you have a second option that goes
well beyond scaling to zero: **delete the whole project, and restore it within 30 days for
close to nothing.** This suits LubeLogger you only need occasionally — evaluating it, a demo
environment, a seasonal or intermittent workload — far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google
  to delete the project. Google does not remove the project immediately: it keeps it,
  recoverable, for 30 days. Because billing is already unlinked, nothing is charged while it
  waits. Unlike deleting one module, this does not tear down the database, any VM or the
  compute resource one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a few credits, not a rebuild.** Within 30 days, the project's owner can
  restore it. RAD asks Google to undelete the project and reattaches its billing account, then
  asks you to run **Update** on each deployment to confirm everything came back. Because
  nothing was individually destroyed, that Update finds the same resources already there — it
  is a check, not a rebuild, and an Update never charges the module fee again. For LubeLogger behind Services_GCP (a GKE cluster) and Project_GCP, that is roughly **a handful of credits (under US$1)** in total, against the about 80 credits (US$8.00) a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$42.**
  Deploy LubeLogger, use it for a while, delete the project. Restore it next time you need it,
  confirm with Update, and delete it again when you're done. You pay only for the module fee
  once, the builds, and whatever time it was actually live.
- **What this needs.** You must own the project (not one RAD only manages billing for), and
  you restore it yourself within the 30 days — after that, Google deletes it for good.
  Restoring is admitted like creating a new project: your purchased credit balance must still
  clear the tier's floor (100 credits for the sandbox tier most evaluation use fits). Google
  says most services are fully working again within 36 hours of a restore.
- **One real gap: nightly backups do not survive.** Backups and other generated files are
  written to a bucket inside the project, and that bucket is **not** protected by Cloud
  Storage's soft-delete, so it is very likely gone as soon as you delete the project — even
  though the project itself is recoverable for 30 days. If you have customised LubeLogger and
  want to keep that work, copy a backup out (to Google Drive, or a bucket outside the project)
  before you delete. For a default installation with nothing irreplaceable in it, this does
  not matter.


### Pay only while you use it, the other way: delete and redeploy

The option above only applies to a RAD-managed project; **in your own project, or once the
30-day window has passed, the way to stop paying is to delete the deployment and deploy it
again when you need it.**

- **What a redeploy costs.** The module fee again, plus the builds — roughly
  80 credits (US$8.00) in total. Deleting saves money
  only once LubeLogger would otherwise sit unused long enough to clear that redeploy cost
  against its own running cost — about **6 days or more**, both in your own project
  (about US$1.40 a day) and in a RAD-managed one (67 credits a day).
- **Most of the running cost is usually shared.** For LubeLogger that is the database. They stop only when nothing else in the project uses them, so deleting this app while something else shares the project saves only this app's own compute part.
- **Keep your data first.** Nightly backups go to a bucket inside the deployment and are
  deleted with it, so copy the latest backup out before deleting if you want to keep it.


### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by
card, bank transfer or mobile money.


**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD fees and the daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics and what it says about Cloud Storage objects without soft delete; [AUTOsist](https://www.autosist.com/pricing). Prices change; check each source before relying on a figure.


## 1. Overview

LubeLogger runs as a single ASP.NET Core pod, recommended as a **StatefulSet with a
real block-storage PVC**. The deployment wires together a minimal set of Google Cloud
services — there is no managed database in the default configuration:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | ASP.NET Core pod, 1 vCPU / 1 GiB by default, fixed at a single replica |
| Database | None (default) | LubeLogger's default mode uses an internal embedded LiteDB database file — no Cloud SQL instance is created |
| Object storage / block storage | Cloud Storage + Persistent Disk | A block PVC (recommended, `stateful_pvc_enabled = true`) at `/App/data`, plus a small `dpkeys` GCS bucket for ASP.NET Core Data Protection keys (always GCS-backed) |
| Cache & queue | None | LubeLogger has no Redis usage and no background worker/queue |
| Secrets | None | No secrets are generated — the first account is created via self-service registration |
| Ingress | Cloud Load Balancing | External LoadBalancer by default; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **No external database by default.** `database_type = "NONE"` — LubeLogger's own
  embedded LiteDB database file is the source of truth. LubeLogger also supports an
  optional external Postgres backend via a single `POSTGRES_CONNECTION` DSN
  environment variable, but this module does not wire Cloud SQL for it.
- **Block-storage PVC is the recommended layout.** `stateful_pvc_enabled = true`
  (default) runs LubeLogger as a StatefulSet with a per-pod PVC mounted at
  `/App/data` — a real block device gives reliable file locking for the embedded
  LiteDB database, unlike GCS FUSE.
- **Single instance only.** `min_instance_count = 1` and `max_instance_count = 1` —
  LubeLogger's default mode serves one shared database file from one volume; running
  multiple replicas against the same file corrupts it.
- **Runs as root; no fsGroup needed.** Confirmed directly against the running
  image — LubeLogger's official image has no `USER` directive, so
  `stateful_fs_group` defaults to `0` (unset).
- **Secure by default.** `EnableAuth = "true"` overrides LubeLogger's own
  `appsettings.json` default of fully open access. There is no seeded admin account —
  the first person to complete the Register form on `/Login` gains access.
- **Prebuilt image, no build step.** The module deploys the official
  `ghcr.io/hargata/lubelogger` image directly (mirrored into Artifact Registry by
  default) — there is no Dockerfile or Cloud Build involved.
- **Externally reachable by default.** `service_type = "LoadBalancer"` — LubeLogger is
  a public-facing web application, not an internal-only workload.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the LubeLogger workload

LubeLogger runs as a single pod (StatefulSet by default), which Autopilot bills for
based on requested CPU/memory.

- **Console:** Kubernetes Engine → Workloads → select the LubeLogger workload to see
  the pod, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Persistent storage — block PVC and Cloud Storage

The default layout (`stateful_pvc_enabled = true`) provisions a per-pod
**Persistent Disk-backed PVC** mounted at `/App/data` — this holds the embedded
LiteDB database file and uploaded photos/receipts/documents. A separate, small
**Cloud Storage** bucket (`dpkeys`) is always mounted via GCS FUSE at the fixed path
`/root/.aspnet/DataProtection-Keys`, independent of the PVC.

- **Console:** Kubernetes Engine → Storage (PVCs); Cloud Storage → Buckets.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud storage buckets list --project "$PROJECT" --filter="name~lubelogger"
  ```

See [App_GKE](App_GKE.md) for StorageClass, CMEK, and GCS Fuse mount options.

### C. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP.
A custom domain with a Google-managed certificate can be enabled, and a static IP
can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### D. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. LubeLogger Application Behaviour

- **No first-deploy database setup.** There is no `db-init` job — LubeLogger
  initialises its own LiteDB database file and directory structure (`config/`,
  `documents/`, `images/`, `temp/`, `themes/`, `translations/` under `/App/data`) on
  first boot.
- **No fixed admin credential.** Open the service, go to `/Login`, and submit the
  **Register** form — that becomes the usable account. Complete this immediately
  after first deploy: `EnableAuth = "true"` restricts the rest of the app, but
  registration itself is open to anyone who can reach the URL until a first account
  exists.
- **Health path.** Startup and liveness probes target `/Login` — LubeLogger's public,
  unauthenticated page. The app root `/` is `[Authorize]`-gated and would fail an
  unauthenticated probe even on a healthy container.
- **Optional external Postgres.** LubeLogger supports a single `POSTGRES_CONNECTION`
  DSN environment variable (`Host=<host>;Port=5432;Username=<user>;Password=<pass>;Database=<db>;`)
  to use an external Postgres database instead of the embedded LiteDB file. This
  module does not provision Cloud SQL for this path.
- **Single instance, always.** `max_instance_count` is fixed at `1` — LubeLogger's
  default mode has no distributed-locking or multi-writer support for its embedded
  database.
- **Runs as root.** Confirmed via `docker inspect`/`docker exec` against the actual
  image — no `USER` directive, process runs as uid 0. Relevant if you ever add
  a restricted `securityContext` — the default configuration needs none.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for LubeLogger are listed; every other input is
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
| `application_name` | `lubelogger` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Image tag on `ghcr.io/hargata/lubelogger`. Since the image is prebuilt (not custom-built), this directly selects the released version. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `min_instance_count` | `1` | Kept at `1` to avoid cold starts. |
| `max_instance_count` | `1` | **Must stay at `1`** — LubeLogger's default mode serves one shared database file. |
| `cpu_limit` | `1000m` | CPU per pod. |
| `memory_limit` | `1Gi` | Memory per pod. |
| `timeout_seconds` | `300` | Maximum request duration (0–3600 seconds). |
| `enable_cloudsql_volume` | `false` | LubeLogger's default mode has no Cloud SQL. |
| `enable_image_mirroring` | `true` | Mirror the LubeLogger image into Artifact Registry before deployment. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings, merged with the module's default `EnableAuth = "true"`. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use this for `POSTGRES_CONNECTION` if wiring the optional external Postgres backend. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | LubeLogger is a public-facing web application, so it defaults to external access. |
| `workload_type` | `null` (auto → `StatefulSet`) | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | No sticky routing needed — single replica. |
| `network_tags` | `["nfsserver"]` | Node/pod network tags; only relevant if `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Seconds to wait after SIGTERM before SIGKILL (lets LubeLogger flush writes). |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Recommended for LubeLogger — a real block PVC gives reliable file locking for the embedded LiteDB database. |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC storage size — sized for the LiteDB database, uploaded documents/receipts, and overhead. |
| `stateful_pvc_mount_path` | `/App/data` | Container mount path for the PVC — must match LubeLogger's data directory. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs; use `premium-rwo` for higher IOPS. |
| `stateful_headless_service` | `null` | Create a headless Service for stable pod DNS names. |
| `stateful_pod_management_policy` | `null` | Pod creation order: `OrderedReady` or `Parallel`. |
| `stateful_update_strategy` | `null` | Update strategy: `RollingUpdate` or `OnDelete`. |
| `stateful_fs_group` | `0` | Left unset — LubeLogger's official image runs as root and needs no fsGroup to write to the PVC. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Create a Kubernetes ResourceQuota in the application namespace. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Requires a binary suffix (e.g. `4Gi`, `8192Mi`) per convention when set. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/Login` 15s delay | Startup probe. |
| `liveness_probe` | HTTP `/Login` 30s delay | Liveness probe. |
| `startup_probe_config` | HTTP `/Login` | App_GKE-level infrastructure probe. |
| `health_check_config` | HTTP `/Login` | App_GKE-level liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | LubeLogger's default mode needs no init job. |
| `cron_jobs` | `[]` | No platform-scheduled recurring tasks by default. |
| `additional_services` | `[]` | Sidecar or helper services deployed alongside LubeLogger. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the `storage` and `dpkeys` GCS buckets. |
| `storage_buckets` | `[]` | Additional buckets to provision. |
| `gcs_volumes` | `[]` | Additional GCS Fuse volume mounts via the CSI driver. |
| `max_images_to_retain` | `7` | Maximum recent Artifact Registry images to keep. |
| `delete_untagged_images` | `true` | Automatically delete untagged images. |
| `image_retention_days` | `30` | Days after which images are eligible for deletion. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` (foundation default) | Forwarded for compatibility; `LubeLogger_GKE` forces it `false` — LubeLogger needs no Redis. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — LubeLogger's default mode has no Cloud SQL database. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
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
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach LubeLogger. |
| `storage_buckets` | Created Cloud Storage buckets (`storage`, `dpkeys`). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of setup jobs (none by default). |
| `statefulset_name` | Name of the StatefulSet. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | LubeLogger's default mode serves one shared embedded database file from one volume; more than one replica risks database corruption from concurrent writers. Enforced by a plan-time validation guard. |
| `stateful_pvc_enabled` | `true` | High | A real block PVC gives reliable file locking; falling back to GCS FUSE for `/App/data` (by setting this `false`) risks lock contention under concurrent writes. |
| `stateful_pvc_mount_path` | `/App/data` | Critical | Must match LubeLogger's actual data directory — a wrong path means the database and uploads are written to ephemeral pod storage and lost on every restart. |
| `storage`/`dpkeys` buckets, or the PVC | Never delete | Critical | Losing `/App/data` (PVC or `storage` bucket) loses every vehicle record; losing `dpkeys` invalidates all existing login sessions (recoverable — forces re-login only). |
| `EnableAuth` | `true` (default) | Critical | Setting it to `false` reverts to LubeLogger's fully open-access mode — anyone with the URL can view/edit all data with no login at all. |
| First-run registration | Complete immediately after deploy | High | Until a first account is registered, the Register form is reachable by anyone who can reach the URL. |
| `startup_probe`/`liveness_probe` path | `/Login` | Critical | Pointing probes at `/` (or any `[Authorize]`-gated path) fails the probe on an otherwise-healthy pod — it never becomes Ready. |
| `workload_type` | leave `null` (auto) | High | Setting `workload_type = "Deployment"` alongside `stateful_pvc_enabled = true` fails at plan time — a PVC template requires a StatefulSet. |
| `database_type` | `NONE` (default) | High | LubeLogger's default mode ignores this setting entirely; changing it does not connect LubeLogger to a Cloud SQL instance — use `POSTGRES_CONNECTION` instead for the optional external Postgres path. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict the pod during maintenance with no protection. |
| `service_type` | `LoadBalancer` (default) | Medium | Setting to `ClusterIP` makes the public web UI unreachable from outside the cluster. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. LubeLogger-specific application configuration shared
with the Cloud Run variant is described in
**[LubeLogger_Common](LubeLogger_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: LubeLogger on GKE Autopilot](../labs/LubeLogger_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [LubeLogger on Google Cloud Run](LubeLogger_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [LubeLogger Common — Shared Application Configuration](LubeLogger_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Grocy on GKE Autopilot](Grocy_GKE.md), [Mealie on GKE Autopilot](Mealie_GKE.md), [Homebox on GKE Autopilot](Homebox_GKE.md), [Wallos on GKE Autopilot](Wallos_GKE.md) in the **Home & Life Management** solution.
