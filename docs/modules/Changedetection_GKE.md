---
title: "Changedetection on GKE Autopilot"
description: "Configuration reference for deploying Changedetection on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Changedetection on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Changedetection_GKE.png" alt="Changedetection on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

changedetection.io is a self-hosted, open-source service that monitors web pages for
changes and sends notifications when they occur. This module deploys changedetection.io
on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions
and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services changedetection.io uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics that
are common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## What changedetection.io costs on RAD, and how that compares

**changedetection.io on RAD's GKE Autopilot module costs about US$42 a month in your own Google Cloud project, with no extra licence fee** — changedetection.io is open source. In a project RAD manages for you, the same deployment is metered at **67 credits a day** (about 2,010 a month, about US$201 at the top-up price). Or see the [Cloud Run guide](Changedetection_CloudRun.md) for the lower-cost option. If you only need changedetection.io occasionally — studying, a demo, a short-lived project — a RAD-managed project can be deleted and restored within 30 days for a few credits, so that monthly figure becomes a few dollars instead. See **Pause it for free**, below.

### What you pay on RAD

changedetection.io is open source, so there is no licence fee. You pay for three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 75 credits (US$7.50 at the top-up price) | 67.5 credits (10% lower) |
| Build time | A few credits per build (roughly 3–6 credits) | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$42 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **67 credits a day**, about 2,010 a month (about US$201 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the
database, file server and network are shared by every application in the project, so a second
application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 1x vCPU / 1 GiB | US$36.08 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | shared across every GKE app in the project; $0 if this is your only cluster, else ~73 |
| **Total (excluding the shared GKE cluster fee)** | **about US$42** |

These prices are the same in africa-south1 (Johannesburg).

- **GKE Autopilot does not scale to zero.** At least one pod always runs, so the cost above applies whether or not anyone is using the app; extra pods are added only under load.

### How it compares, for monitoring pages for changes

changedetection.io's own team sells a hosted plan directly on changedetection.io: **US$8.99 a month**, including 5,000 URL watches, cancel anytime. That single plan is the simplest way to use it with nothing to run; RAD's module runs the same open-source changedetection.io on infrastructure you can see, with no watch-count ceiling other than what the instance size supports, for the module fee plus the Google Cloud usage above — about US$19 a month in your own project, a little more than the hosted plan but with the data living in your own project.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If changedetection.io runs in **a project RAD manages for you**, deleting the whole project — rather than deleting
just this module — unlinks its billing first, then asks Google to delete the project outright. Google
keeps it, recoverable, for 30 days, and because billing is already unlinked, nothing is charged while it
waits. Unlike deleting one module, this does not tear down Cloud SQL, any VM or the compute resource one
by one: the whole project simply stops.

- **Restoring is a check, not a rebuild.** Within 30 days, the project's owner can ask Google to undelete
  the project and reattach its billing account, then run **Update** on each deployment to confirm
  everything came back. Because nothing was individually destroyed, that Update finds the same resources
  already there, and an Update never charges the module fee again. For a typical 2–3-deployment chain
  this costs only a handful of credits in total (roughly 5–10 credits, under US$1).
- **What this needs.** You must own the project (not one RAD only manages billing for), restore it
  yourself within 30 days — after that Google deletes it for good — and clear the tier's admission floor
  again (100 credits for the sandbox tier most study/demo use fits). Google says most services are fully
  working again within 36 hours of a restore.
- **One real gap: nightly backups do not survive.** Backups are written to a bucket inside the project,
  and that bucket has Cloud Storage's soft-delete turned off, so it is very likely gone as soon as the
  project is deleted — even though the project itself is recoverable for 30 days. Copy a backup out (to
  Google Drive, or a bucket outside the project) before deleting if there is anything in it worth
  keeping; for a default install with nothing irreplaceable, this does not matter.

Source: [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects).

### Pay only while you use it, the other way: delete and redeploy

In your own project, or once the 30-day restore window above has passed, the way to stop paying is to
delete the deployment and deploy it again when you need it.

- **What a redeploy costs.** The module fee again, plus the builds: about 79 credits
  (about US$7.90) at the top-up price, and roughly 15–20 minutes of build time (RAD's
  own platform average). Deleting saves money only once changedetection.io would otherwise sit unused for about
  **3 days or more** — in your own project that is about US$1.40 a day, and
  in a RAD-managed one it is 67 credits a day.
- Most of the running cost here is usually the database and/or the shared file/cache VM or cluster. They stop only when nothing else in the project uses them, so deleting changedetection.io while another application shares the project saves only changedetection.io's own compute part.
- **Keep data first.** Nightly backups go to a bucket inside the deployment and are deleted with it, so
  copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets the app in
  their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either
  the trainer funds every place, or each participant pays for their own. Everything is deleted when the
  session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a ring-fenced
  wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the
  data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over
  and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card,
bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD fees and the daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore window and backup-bucket caveat;
[changedetection.io hosted plan](https://changedetection.io/); prices change, check each source before relying on a figure.

## 1. Overview

changedetection.io runs as a single Python/Flask web workload. The deployment wires
together a deliberately small set of Google Cloud services — there is no database and
no cache:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Python/Flask pod, 1 vCPU / 1 GiB by default, listens on port 5000 |
| Database | _None_ | changedetection.io stores all state on disk, not in SQL |
| Persistent datastore | Block Persistent Disk (PVC) or Cloud Storage (GCS FUSE) | Mounted at `/datastore`; a block PVC via StatefulSet is strongly preferred |
| Cache & queue | _None_ | Redis is not used; explicitly disabled |
| Secrets | Secret Manager | No app secret is injected; the REST API token is created in the web UI |
| Ingress | Cloud Load Balancing | `ClusterIP` Service behind a Kubernetes Ingress with a reserved static IP and managed certificate (custom domain enabled by default; a `nip.io` host is used when none is set) |

**Sensible defaults worth knowing up front:**

- **No database, no Redis.** changedetection.io is entirely self-contained. There is no
  Cloud SQL instance, no `db-init` job, and no schema migration step. Redis is disabled
  (`enable_redis = false`) and `enable_cloudsql_volume = false`.
- **Block PVC is the default for the datastore.** changedetection.io writes a file-based
  datastore (watch JSON plus history snapshot files) that behaves best on a POSIX block
  volume, so `stateful_pvc_enabled = true` by default, mounting a 20Gi block PVC (via a
  StatefulSet) at `/datastore`. This automatically **disables the GCS FUSE volume** at
  the same path (`enable_gcs_storage_volume = false`) to avoid a double-mount.
- **GCS FUSE is the fallback.** With `stateful_pvc_enabled = false`, the datastore GCS
  bucket is mounted at `/datastore` via GCS FUSE instead. This works but is less
  well-suited to the app's file-based writes than a block PVC.
- **Single replica by default.** `min_instance_count = 1` and `max_instance_count = 1`.
  The fetch scheduler runs in-process against a single datastore; running more than one
  replica against the same datastore risks concurrent-write corruption. Keep
  `max_instance_count = 1`.
- **No login by default.** The dashboard ships with no login. Set a password in
  **Settings → General** immediately, and/or front the workload with IAP.
- **`BASE_URL` is not set automatically on GKE.** Set `BASE_URL` (the notification-link
  host) to the external LoadBalancer or custom-domain URL via `environment_variables`
  after the external IP is known.
- **Version pinning.** With `application_version = "latest"` the image build pins a
  known-good tag (`0.50.19`) via the app-specific `CHANGEDETECTION_VERSION` build arg.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the changedetection.io workload

changedetection.io pods are scheduled on Autopilot, which bills for the CPU/memory the
pods actually request. Since `stateful_pvc_enabled = true` by default, `workload_type`
auto-resolves to a **StatefulSet** with a per-pod PVC; set `stateful_pvc_enabled =
false` for a `Deployment` with a GCS FUSE volume instead.

- **Console:** Kubernetes Engine → Workloads → select the changedetection workload to
  see pods and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl get statefulset,pvc -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  kubectl logs -n "$NAMESPACE" <pod-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Database — not used

changedetection.io uses **no SQL database**. `database_type = NONE` is fixed by
[Changedetection_Common](Changedetection_Common.md); no Cloud SQL instance is created
and there is no `db-init` initialization job. The `db_name`/`db_user` inputs exist only
for Foundation compatibility and provision nothing. All persistent state lives in the
datastore volume described below.

### C. Persistent datastore (PVC or Cloud Storage)

All watch configuration, page snapshots, and change history live under `/datastore`.

- **Block PVC (default).** With `stateful_pvc_enabled = true` (the default), a
  StatefulSet mounts a 20Gi block Persistent Disk at `stateful_pvc_mount_path`
  (`/datastore`).
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  ```
- **GCS FUSE (fallback).** With `stateful_pvc_enabled = false`, the datastore GCS bucket
  is mounted at `/datastore` via the GCS FUSE CSI driver.
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<data-bucket>/
  ```

See [App_GKE](App_GKE.md) for StatefulSet PVCs, CMEK options, and GCS FUSE mounts.

### D. Cache & queue — not used

changedetection.io does not use Redis or any external queue; its watch scheduler is
in-process. `enable_redis = false` is set explicitly (overriding the App_GKE default of
`true`) and no Redis inputs are wired.

### E. Secret Manager

No application secret is injected into the pod — the optional REST API token is generated
inside the web UI (**Settings → API**), and the datastore uses no encryption key. Secret
Manager is still available for any operator-supplied `secret_environment_variables`.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the Kubernetes Service is `ClusterIP` (`service_type = ClusterIP`) and the
workload is exposed through a Kubernetes Ingress with a reserved static IP and a
Google-managed certificate (`enable_custom_domain = true`, `reserve_static_ip = true`).
When no `application_domains` are set, a `nip.io` hostname derived from the reserved IP
is used so HTTPS works out of the box.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring. Optional
uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. changedetection.io Application Behaviour

- **No first-deploy database setup.** There is no database and no init job. On first
  boot changedetection.io creates its datastore files (`url-watches.json` and per-watch
  history directories) under `/datastore` if they do not already exist.
- **No schema migrations.** Datastore format upgrades are handled internally by the
  application on start; there is no separate migration step to run.
- **The datastore volume is the only stateful asset.** Everything the app remembers —
  watches, snapshots, diff history, notification config, and any UI password — lives on
  the `/datastore` volume (block PVC or GCS bucket). Deleting the PVC/bucket wipes all
  state.
- **No login by default.** The dashboard ships open. Set a password under
  **Settings → General → Password** immediately after first access, and/or enable IAP in
  front of the workload. There is no default admin account or credential.
- **REST API token is created in the UI.** To use the REST API, generate a token under
  **Settings → API** and pass it as the `x-api-key` header. It is not injected via an
  environment variable.
- **Set `BASE_URL` after the external IP is known.** Unlike the Cloud Run variant, the
  GKE wrapper does not inject a usable `BASE_URL`. Set it to the external URL so
  notification bodies contain working links:
  ```bash
  kubectl set env -n "$NAMESPACE" statefulset/<name> \
    BASE_URL=https://changedetection.example.com
  ```
  Or set `environment_variables = { BASE_URL = "https://…" }` in the module config.
- **Health path.** Startup and liveness probes target `/` — the web UI, which returns
  HTTP 200 once the Flask server is ready. First boot is fast (no migrations); the
  default startup probe allows a 15-second initial delay plus a 10-retry window.
- **Scaling constraint.** Keep `max_instance_count = 1`. Multiple replicas share the same
  datastore and would race on writes; the app has no distributed coordination.
- **Inspect the running environment:**
  ```bash
  kubectl exec -n "$NAMESPACE" <pod-name> -- env | grep -E 'DATASTORE_PATH|BASE_URL'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for changedetection.io are listed; every other input is inherited
from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

All other inputs follow standard App_GKE behaviour.

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

All other inputs follow standard App_GKE behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `changedetection` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Image version tag. `latest` pins the build to `0.50.19` via `CHANGEDETECTION_VERSION`; pin explicitly for reproducible deploys. |

All other inputs follow standard App_GKE behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only (no workload). |
| `min_instance_count` | `1` | Keep at 1 so the fetch scheduler always runs. |
| `max_instance_count` | `1` | **Keep at 1** — multiple replicas race on the shared datastore. |
| `cpu_limit` | `1000m` | CPU per pod. |
| `memory_limit` | `1Gi` | Memory per pod. |
| `enable_cloudsql_volume` | `false` | No Cloud SQL — the Auth Proxy sidecar is not needed. |
| `enable_image_mirroring` | `true` | Mirror the changedetection.io image into Artifact Registry. |
| `container_port` | `5000` | Fixed to 5000 by Changedetection_Common; not forwarded to App_GKE. |

All other inputs follow standard App_GKE behaviour.

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Set `BASE_URL` here for notification links; `DATASTORE_PATH` is set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

All other inputs follow standard App_GKE behaviour.

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed; ingress is handled separately (Group 19). |
| `workload_type` | `null` (auto) | Resolves to `StatefulSet` since `stateful_pvc_enabled = true` by default. |
| `session_affinity` | `None` | No sticky routing by default; set `ClientIP` if you want a client to keep hitting the same pod. |

All other inputs follow standard App_GKE behaviour.

### Group 7 — StatefulSet (Datastore Persistence)

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Mounts a block PVC at `/datastore` (preferred). Auto-disables the GCS FUSE volume at the same path. Set `false` to use GCS FUSE instead. |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC size for the datastore. |
| `stateful_pvc_mount_path` | `/datastore` | Datastore mount path — matches `DATASTORE_PATH`. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for the PVC. |

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
| `startup_probe` | HTTP `/` 15s delay | Startup probe against the web UI. |
| `liveness_probe` | HTTP `/` 30s delay | Liveness probe against the web UI. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

All other inputs follow standard App_GKE behaviour.

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No built-in init job — changedetection.io requires no bootstrap. |
| `cron_jobs` | `[]` | Optional Kubernetes CronJobs (the app schedules its own watch checks). |
| `additional_services` | `[]` | Sidecar/helper services (e.g. a Playwright browser fetcher). |

All other inputs follow standard App_GKE behaviour.

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see [App_GKE](App_GKE.md).
Key inputs: `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is off; the datastore uses a block PVC or GCS FUSE. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container (when NFS is enabled). |

All other inputs follow standard App_GKE behaviour.

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the datastore GCS bucket (used for FUSE fallback and backups). |
| `storage_buckets` | `[]` | Additional buckets to provision. |
| `gcs_volumes` | `[]` | Extra GCS FUSE volume mounts via the CSI driver. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

All other inputs follow standard App_GKE behaviour.

### Group 15 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` (effective) | The variable itself defaults `true`, but the wrapper's `main.tf` hardcodes `enable_redis = false` in the Foundation call and never forwards `var.enable_redis` — changedetection.io does not use Redis. |

All other inputs follow standard App_GKE behaviour.

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` / `db_user` | `""` | Not used — forwarded only for Foundation compatibility; no database is created. |

All other inputs follow standard App_GKE behaviour.

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). Back up the datastore volume/bucket (no DB exists). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |

All other inputs follow standard App_GKE behaviour.

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate (falls back to a `nip.io` host when `application_domains` is empty). |
| `application_domains` | `[]` | Hostnames to serve (also the value to set for `BASE_URL`). |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

All other inputs follow standard App_GKE behaviour.

### Group 20 — Identity-Aware Proxy (IAP)

> **Recommended.** changedetection.io has no login of its own — IAP puts Google
> authentication in front of the dashboard.

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of changedetection.io. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

All other inputs follow standard App_GKE behaviour.

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `enable_cdn` | `false` | Enable Cloud CDN on the GKE Ingress backend. |

All other inputs follow standard App_GKE behaviour.

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs follow standard App_GKE behaviour.

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
| `service_url` | URL to reach changedetection.io. |
| `storage_buckets` | Created Cloud Storage buckets (including the datastore bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any setup jobs (empty by default). |
| `statefulset_name` | Name of the StatefulSet (when `stateful_pvc_enabled = true`). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, `min_instance_count > max_instance_count`, a `Deployment` workload paired with `stateful_pvc_enabled = true`, binary-unit resource-quota values, an out-of-range `backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| Datastore PVC / GCS bucket | Never delete/recreate | Critical | The volume holds every watch, snapshot, and history entry — deleting it loses all monitoring state permanently. |
| `max_instance_count` | `1` | Critical | Multiple replicas write the same datastore concurrently and corrupt `url-watches.json`; the app has no distributed locking. |
| `stateful_pvc_enabled` vs `workload_type` | `true` (StatefulSet auto-selected; both default) | High | Setting `workload_type = "Deployment"` alongside `stateful_pvc_enabled = true` fails at plan time; block-PVC persistence requires a StatefulSet. |
| Web UI password | Set immediately | High | The dashboard ships with **no login**; exposing the Ingress endpoint without a password (or IAP) reveals all watches and notification config. |
| `application_name` | Set once | High | Immutable after first deploy; renaming recreates the datastore bucket/PVC and orphans existing data. |
| `stateful_pvc_mount_path` / `DATASTORE_PATH` | `/datastore` | High | A mismatch means the datastore is written to ephemeral pod disk and lost on restart/reschedule. |
| `BASE_URL` | External LoadBalancer / domain URL | Medium | Not injected on GKE — leaving it unset produces broken absolute links in change notifications. |
| `enable_iap` | Enable (or set a UI password) | High | Without IAP or a UI password, the public Ingress endpoint exposes an unauthenticated dashboard. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects invalid values. Keeping 1 keeps the fetch scheduler running. |
| `enable_redis` / `enable_cloudsql_volume` | `false` / `false` | Low | changedetection.io needs neither; enabling them provisions unused infrastructure. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention of the datastore backup. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
changedetection.io-specific application configuration shared with the Cloud Run variant
is described in **[Changedetection_Common](Changedetection_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Changedetection.io on GKE Autopilot](../labs/Changedetection_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Changedetection on Google Cloud Run](Changedetection_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Changedetection Common — Shared Application Configuration](Changedetection_Common.md) — the configuration shared by both deployment targets.
