---
title: "Audiobookshelf on GKE Autopilot"
description: "Configuration reference for deploying Audiobookshelf on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Audiobookshelf on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Audiobookshelf_GKE.png" alt="Audiobookshelf on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Audiobookshelf is a self-hosted audiobook and podcast server — it organises your audio library, streams to the web UI and the official mobile apps, and keeps per-user listening progress in sync. This module deploys Audiobookshelf on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Audiobookshelf uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics that are common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## What Audiobookshelf costs on RAD, and how that compares

**Audiobookshelf on RAD's GKE Autopilot module costs about US$42 a month in a project you own, with no licence fee for the software itself.** RAD charges a one-off module fee of 75 credits (US$7.50 at the top-up price) in a project you own, and 67.5 credits (10% lower) in a project RAD manages. GKE suits Audiobookshelf that must stay up continuously or scale across pods; for the lowest cost, the [Cloud Run module](Audiobookshelf_CloudRun.md) runs the same Audiobookshelf for about US$19 a month. Figures are as at 8 October 2026; sources are listed at the end of this section.

If you only need it occasionally — studying for a certification, a demo, a seasonal need — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that about US$42 a month becomes close to nothing instead. See **Pause it for free**, below.

### What you pay on RAD

You pay for three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 75 credits (US$7.50 at the top-up price) | 67.5 credits (10% lower) |
| Build time | A few credits, metered per minute of build time | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about US$42 a month for the default configuration (table below) | Metered hourly in credits; RAD publishes **67 credits a day**, about 2,010 a month (about US$201 at the top-up price, US$161 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 1x vCPU / 1 GiB | US$36.08 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | US$0 if this is your only Autopilot/zonal cluster on the billing account, otherwise about US$73 (shared across every GKE app in the project) |
| **Total** | **about US$42** |

### How it compares

- **No name-brand SaaS competitor is a clean match for Audiobookshelf, so the honest comparison is a plain self-managed server.** It is a smaller workload than a standard 2 vCPU VPS, so running it yourself on a cheaper, smaller class than a Hetzner CPX22 or DigitalOcean 2 vCPU/4 GB Droplet (both about $24/month) would do, for noticeably less than that.
- **RAD is not cheaper than a bare VPS in cash terms, and does not try to be.** What RAD adds for a similar price is a managed database, Secret Manager for credentials, and monitoring that would otherwise be your own job to set up, patch and keep backed up.
- **The admin's own time is the real cost a VPS does not show.** Security patches, backups and version upgrades on a bare server are work someone has to keep doing; RAD's managed services absorb that.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Audiobookshelf runs in **a project RAD manages for you**, you have an option that goes well beyond
scaling to zero: **delete the whole project, and restore it within 30 days for close to
nothing.** This suits occasional use — studying for a certification, a demo, a seasonal
need — far better than running Audiobookshelf continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google
  to delete the project outright. Google does not remove it immediately: it keeps the project,
  recoverable, for 30 days, and because billing is already unlinked nothing is charged while it
  waits. Unlike deleting one module, this does not tear down the database, any VM or the
  compute resource one by one — the whole project simply stops, and nothing is billed in the
  meantime.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, only the project's
  owner can restore it. RAD asks Google to undelete the project and reattaches its billing
  account, then asks you to run **Update** on each deployment to confirm everything came back.
  Because nothing was individually destroyed, that Update finds the same resources already
  there — it is a check, not a rebuild, and an Update never charges the module fee again. This
  costs only a handful of credits in total (under US$1), against paying the module fee and a
  full build again.
- **What this needs.** You must own the project (not one RAD only manages billing for), you
  must restore it yourself within the 30 days — after that Google deletes it for good — and
  restoring is admitted like creating a new project, so your purchased credit balance must
  still clear the tier's floor (100 credits for the sandbox tier most study and demo use
  fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap: backups do not survive.** Anything Audiobookshelf writes to a backup bucket inside the
  project is very likely gone as soon as you delete the project, even though the project itself
  is recoverable for 30 days — that bucket has Cloud Storage's soft-delete explicitly turned
  off. Anyone who has customised the deployment and wants to keep that work should copy a
  backup out (to Google Drive, or a bucket outside the project) before deleting. For a default
  install with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

This is the fallback for a project you own, or once the 30-day restore window above has
passed: **delete the deployment, and deploy it again when you next need it.**

- **What a redeploy costs.** The module fee again, plus the builds: roughly
  80 credits (about US$8) in your own project, or
  72.5 credits in a RAD-managed one, because RAD rebuilds the resources
  from scratch. Deleting saves money once Audiobookshelf would otherwise sit unused long enough to clear that redeploy cost against its own running cost — roughly 6 days or more in your own project (US$1.40/day) or 1 days or more in a RAD-managed one (67 credits/day).
- **The GKE cluster itself is shared infrastructure.** If another application uses the same Autopilot cluster, deleting Audiobookshelf alone saves only its own pod; the cluster management fee only drops once nothing else in the project needs it.
- **Keep your data first.** Anything Audiobookshelf writes to a backup bucket inside the deployment is
  deleted with it — copy the latest backup out (to Google Drive, or a bucket you keep) before
  deleting if you want to keep it.
- **RAD does not recreate a deleted deployment for you.** You enter the settings again when
  you redeploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  Audiobookshelf in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs Audiobookshelf for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's fees and daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics. Prices change; check each source before relying on a figure.

## 1. Overview

Audiobookshelf runs as a single Node.js workload on GKE Autopilot. Unusually for this catalogue, it needs **no external database, no Redis, and no application secrets** — the deployment footprint is deliberately small:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pod, 1 vCPU / 1 GiB by default, single replica |
| Database | None | Audiobookshelf embeds its own SQLite database under `CONFIG_PATH` — no Cloud SQL |
| Persistent state | Persistent Volume Claim (block storage) | A StatefulSet PVC mounted at `/data`, backing both `CONFIG_PATH` and `METADATA_PATH` |
| Container image | Cloud Build + Artifact Registry | Thin wrapper built `FROM ghcr.io/advplyr/audiobookshelf` and mirrored into your registry |
| Secrets | Secret Manager | No application secrets — the admin user is created in the first-run web UI |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; optional custom domain |

**Sensible defaults worth knowing up front:**

- **No external database.** `database_type = "NONE"` and `enable_cloudsql_volume = false` are fixed by `Audiobookshelf_Common`; Audiobookshelf creates and migrates its internal SQLite database on first boot. No `db-init` job runs.
- **A real block PVC, not GCS FUSE, backs `/data`.** `stateful_pvc_enabled = true` by default — gcsfuse corrupts SQLite and the media file index, so Audiobookshelf requires a genuine block device. When the PVC is enabled, the variant automatically disables the GCS-FUSE storage volume at the same path (`enable_gcs_storage_volume = !stateful_pvc_enabled`) to avoid a double-mount conflict at `/data`. This is the key difference from `Audiobookshelf_CloudRun`, which has no PVC option and uses GCS FUSE instead.
- **`stateful_pvc_enabled = true` with no explicit `workload_type` resolves to `StatefulSet`.** One PVC per pod, provisioned from the `standard-rwo` (SSD, Balanced PD) StorageClass by default — see §6 for the SSD-quota implication.
- **One persistent mount covers everything.** `CONFIG_PATH = /data/config` (SQLite DB + app config) and `METADATA_PATH = /data/metadata` (cover art, cached metadata) are both redirected under the single `stateful_pvc_mount_path` (`/data`). Losing this PVC loses all Audiobookshelf state.
- **Single replica.** `min_instance_count = 1` and `max_instance_count = 1` — one shared SQLite library must be served by exactly one writer. Do not raise the maximum without verifying multi-writer safety (there is none).
- **Custom (thin-wrapper) image.** Cloud Build wraps the upstream `ghcr.io/advplyr/audiobookshelf` image so it is mirrored into Artifact Registry. The Dockerfile reads the app-specific `AUDIOBOOKSHELF_VERSION` build ARG (not the generic `APP_VERSION` the foundation injects); `application_version = "latest"` resolves to the pinned `2.17.0`.
- **No generated secrets.** The initial **root** user is created interactively in the first-run web UI, and API tokens are minted in the UI afterwards — `Audiobookshelf_Common` exposes empty `secret_ids`/`secret_values`.
- **Health probes target `/healthcheck`**, Audiobookshelf's unauthenticated 200 endpoint (startup: 15 s initial delay, 10-second period, 10 failures allowed; liveness: 30 s delay, 30-second period, 3 failures).
- **No Redis.** The variant's `main.tf` overrides the foundation's `enable_redis` default to `false` for this module.
- **Custom domain enabled by default.** `enable_custom_domain = true` (unlike most other GKE modules, which default this off) — supply `application_domains` to attach a hostname, or it falls back to the LoadBalancer IP.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Audiobookshelf StatefulSet

Audiobookshelf runs as a single-pod **StatefulSet** (the default resolved workload type when `stateful_pvc_enabled = true`), giving it a stable pod identity and an ordered restart — appropriate for a single-writer SQLite workload.

- **Console:** Kubernetes Engine → Workloads → select the Audiobookshelf workload for pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type (Deployment vs StatefulSet) are managed.

### B. Persistent Volume Claim — the `/data` block storage

All Audiobookshelf state — the SQLite database, application config, cover art, and cached metadata — lives under `/data`, backed by a **block Persistent Volume Claim** provisioned per-pod by the StatefulSet. gcsfuse is explicitly avoided here because it corrupts SQLite and the media file index. Additional media libraries (for example a read-only audiobook bucket) can still be attached through `gcs_volumes` at a different mount path.

- **Console:** Kubernetes Engine → Workloads → select the workload → the Volumes/Storage tab. Compute Engine → Disks also lists the underlying Persistent Disk.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" -l app=<service-name>
  gcloud compute disks list --project "$PROJECT" --filter="name~<service-name>"
  ```

See [App_GKE](App_GKE.md) §7 (StatefulSet / PVC) for StorageClass options, and §6 below for the SSD-quota pitfall.

### C. Cloud Build & Artifact Registry — the container image

The module builds a thin wrapper image `FROM ghcr.io/advplyr/audiobookshelf:${AUDIOBOOKSHELF_VERSION}` via Cloud Build and stores it in the tenant's Artifact Registry, insulating deploys from upstream registry rate limits and pinning the version.

- **Console:** Cloud Build → History; Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list \
    "$REGION-docker.pkg.dev/$PROJECT/<repo>/audiobookshelf" --project "$PROJECT"
  ```

### D. Secret Manager

Audiobookshelf itself needs no injected secrets — there is no database password, master key, or JWT secret. Secret Manager remains available for any custom `secret_environment_variables` you add. On GKE, secrets are projected into pods via the Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~audiobookshelf"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP (`service_type = ClusterIP` by default at the foundation level, but Audiobookshelf's ingress is normally reached via `enable_custom_domain = true` and a reserved static IP; set `service_type = LoadBalancer` for a direct external IP without a custom domain). A custom domain with a Google-managed certificate is enabled by default for this module.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring. Optional uptime checks and alert policies are available (uptime checks are disabled by default and only pass against a publicly reachable endpoint).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Audiobookshelf Application Behaviour

- **Self-contained first boot, no init job.** On first start Audiobookshelf creates its SQLite database and directory layout under `CONFIG_PATH`/`METADATA_PATH` — no init job, migration job, or database provisioning is involved. Because both paths sit under the persistent PVC mount, the database survives pod restarts and application-version upgrades. `Audiobookshelf_Common` injects no default `initialization_jobs`; custom jobs can still be supplied for one-off data loads.
- **First-run setup wizard.** Open the service URL (`/`) — Audiobookshelf prompts you to create the initial **root** user interactively. There is no environment-based admin bootstrap; API tokens are minted in the web UI afterwards (Settings → Users).
- **Single writer, single replica.** SQLite over a block PVC tolerates exactly one writer. The module pins `min_instance_count = 1` / `max_instance_count = 1`; a StatefulSet with `stateful_pod_management_policy = OrderedReady` further ensures pods are not started concurrently during scaling events.
- **Health endpoint.** `/healthcheck` returns HTTP 200 unauthenticated once the server is ready; it backs the **HTTP** startup probe (15 s initial delay, 10-second period, up to 10 failures ≈ 115 s of first-boot grace) and the **HTTP** liveness probe (30 s initial delay, 30-second period, 3 failures). The web UI is at `/`.
- **Scaling constraints.** As a StatefulSet with a single-writer SQLite backend, do not scale beyond 1 replica. The default `stateful_update_strategy` and `stateful_pod_management_policy` (both `null` → foundation defaults of `RollingUpdate`/`OrderedReady`) are adequate at replica count 1; they only matter if you experiment with more than one pod, which is not supported by the application.
- **Verification CLI:**
  ```bash
  kubectl get pods,pvc -n "$NAMESPACE"
  SERVICE=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[?(@.metadata.labels.application=="audiobookshelf")].metadata.name}')
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- wget -qO- http://localhost:80/healthcheck
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 8080:80
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/healthcheck   # expect 200
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for Audiobookshelf are listed; every other input is inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `audiobookshelf` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `ghcr.io/advplyr/audiobookshelf` image tag used as the custom-build base; `latest` resolves to the pinned `2.17.0` via the app-specific `AUDIOBOOKSHELF_VERSION` build ARG. |
| `application_display_name` | `Audiobookshelf Media Server` | Human-readable display name. |
| `description` | `Audiobookshelf — self-hosted audiobook and podcast server with progress sync across clients` | Workload description. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | CPU per pod. Library scans are CPU-bound — size up for large imports. |
| `memory_limit` | `1Gi` | Memory per pod; size up for large libraries. |
| `min_instance_count` | `1` | Keep at 1 to avoid cold starts during library/index loading. |
| `max_instance_count` | `1` | **Keep at 1** — one SQLite library, one writer. |
| `container_port` | `80` | Audiobookshelf's HTTP port (fixed by `Audiobookshelf_Common`; this variable is not itself forwarded to App_GKE). |
| `enable_cloudsql_volume` | `false` | No Cloud SQL — keep `false`; Audiobookshelf does not use it. |
| `enable_image_mirroring` | `true` | Mirror the upstream image into Artifact Registry. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Kubernetes Service type; set `LoadBalancer` for a direct external IP. |
| `workload_type` | `null` → `StatefulSet` (via `stateful_pvc_enabled = true`) | Recommended for Audiobookshelf's stable pod identity and ordered restarts. |
| `session_affinity` | `None` | Single-replica deployment, so sticky sessions are not required. |
| `network_tags` | `["nfsserver"]` | Foundation-inherited default; Audiobookshelf does not use NFS, so this tag has no practical effect unless `enable_nfs` is also enabled. |

### Group 7 — StatefulSet / PVC

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Required — gcsfuse corrupts Audiobookshelf's SQLite database and media file index, so a real block PVC backs `/data`. |
| `stateful_pvc_size` | `20Gi` | Size to hold the full audio library index plus overhead (the PVC holds config/metadata, not necessarily raw audio files if those are mounted separately via `gcs_volumes`). |
| `stateful_pvc_mount_path` | `/data` | Both `CONFIG_PATH` (`/data/config`) and `METADATA_PATH` (`/data/metadata`) live under this mount. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD, Balanced PD) | See §6 — consider `standard` (HDD) to avoid exhausting the `SSD_TOTAL_GB` quota; Audiobookshelf's SQLite/media workload does not need SSD IOPS. |
| `stateful_pod_management_policy` | `null` → `OrderedReady` | Required for safe restarts of a single-writer workload. |
| `stateful_update_strategy` | `null` → `RollingUpdate` | Only matters if replica count is (unsupportedly) raised above 1. |
| `stateful_fs_group` | `3000` | Matches the Audiobookshelf Helm chart's fsGroup convention (the app runs as UID 1000/GID 2000) so the PVC is group-writable. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Not used by default — Audiobookshelf's state lives on the block PVC, not NFS. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisions the Common module's `storage` bucket; unused for the primary `/data` mount when `stateful_pvc_enabled = true` (the PVC replaces GCS FUSE at that path), but still created and available for `gcs_volumes` overrides. |
| `gcs_volumes` | `[]` | Additional GCS FUSE mounts, e.g. a read-only media library bucket at a separate path. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` (foundation default) → forced to `false` by `main.tf` | Audiobookshelf does not use Redis; the variant hardcodes `enable_redis = false` in its `App_GKE` call regardless of this variable's value. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — Audiobookshelf has no SQL database; all other database inputs are forwarded for foundation compatibility only and have no effect. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Enabled by default for this module (unlike most GKE modules, which default this off). |
| `application_domains` | `[]` | Custom hostnames + managed certificate; supply one to use the custom domain. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires org-level permissions). |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

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
| `service_url` | URL to reach Audiobookshelf. |
| `statefulset_name` | Name of the StatefulSet. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any custom setup jobs (none by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `StatefulSet` forced alongside a stateless setting, IAP with no authorized identities, `quota_memory_*` given as bare integers, an out-of-range `container_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | Multiple pods write the same SQLite database over the shared PVC — database corruption. |
| `stateful_pvc_enabled` | `true` | Critical | Disabling it falls back toward a GCS-FUSE-style mount for `/data`; gcsfuse corrupts Audiobookshelf's SQLite database and media file index. |
| `CONFIG_PATH` / `METADATA_PATH` (via `environment_variables`) | leave defaults | Critical | Changing them after first boot orphans the existing SQLite database and cached metadata. |
| `stateful_pvc_mount_path` | `/data` | Critical | Must stay in sync with `CONFIG_PATH`/`METADATA_PATH`; a mismatch means the SQLite DB is never actually persisted to the PVC. |
| `stateful_pvc_storage_class` | `standard` (HDD) recommended over the `standard-rwo` (SSD) default | High | This module currently defaults to `standard-rwo`, which draws the tight `SSD_TOTAL_GB` regional quota (e.g. only 500 GB on Qwiklabs); Audiobookshelf's SQLite/media workload does not need SSD IOPS. A campaign of several SSD-backed stateful apps can exhaust the quota — pass `-var stateful_pvc_storage_class=standard` to use HDD (`pd-standard`) instead. Scaling the workload to zero does **not** release the PVC; only deleting it does. |
| `container_port` | `80` | Critical | Audiobookshelf listens on 80 (`PORT=80` injected by `Audiobookshelf_Common`); a mismatch fails every health probe. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace (only relevant if `enable_resource_quota = true`). |
| `enable_redis` | forced `false` regardless of input | Low | Audiobookshelf has no use for Redis; the variant ignores this variable and always passes `false` to the foundation. |
| `application_version` | pinned tag | Medium | `latest` silently resolves to the pinned `2.17.0`; pin explicitly to control upgrades. |
| `enable_custom_domain` / `application_domains` | `true` / set a hostname | Medium | Left `true` with no `application_domains`, the module falls back to the internal cluster URL or LoadBalancer IP rather than a stable hostname. |
| `enable_cloudsql_volume` | `false` | Low | No Cloud SQL exists; enabling wastes a sidecar. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Audiobookshelf-specific application configuration shared with the Cloud Run variant is
described in **[Audiobookshelf_Common](Audiobookshelf_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Audiobookshelf on GKE Autopilot](../labs/Audiobookshelf_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Audiobookshelf on Google Cloud Run](Audiobookshelf_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Audiobookshelf Common — Shared Application Configuration](Audiobookshelf_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Calibre-Web on GKE Autopilot](CalibreWeb_GKE.md), [Komga on GKE Autopilot](Komga_GKE.md), [Kavita on GKE Autopilot](Kavita_GKE.md), [Navidrome on GKE Autopilot](Navidrome_GKE.md) in the **Digital Library** solution.
