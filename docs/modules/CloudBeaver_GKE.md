---
title: "CloudBeaver on GKE Autopilot"
description: "Configuration reference for deploying CloudBeaver on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# CloudBeaver on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CloudBeaver_GKE.png" alt="CloudBeaver on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

CloudBeaver is a web-based, browser-accessible database manager from the DBeaver
project — a single administrative console for connecting to and querying PostgreSQL,
MySQL, SQL Server, Oracle, SQLite and many other engines. This module deploys
CloudBeaver on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation,
which provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services CloudBeaver uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## What CloudBeaver costs on RAD, and how that compares

**CloudBeaver on RAD's GKE Autopilot module costs about US$42.08 a month in a Google Cloud project you own, plus a one-time 75-credit module fee (US$7.50).** CloudBeaver is a browser-based database manager for PostgreSQL, MySQL, SQL Server, Oracle, SQLite and more. For the lowest cost, the [Cloud Run guide](CloudBeaver_CloudRun.md) runs the same CloudBeaver for about US$19.14 a month; pick GKE here only if CloudBeaver must stay up continuously, scale across pods, or run beside other Kubernetes workloads.

If CloudBeaver is only needed occasionally — a demo, a trial, a seasonal or study workload — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that US$42.08 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 75 credits (US$7.50 at the top-up price) | 67.5 credits (10% lower) |
| Build time | A few credits per build (roughly 3–6) | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$42.08 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **56 credits a day**, about 1680 a month (about US$168 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, less on a plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 1x vCPU / 1 GiB | US$36.08 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | shared across every GKE app in the project; $0 if this is your only cluster, else ~73 |
| **Total** | **about US$42.08** |

### How it compares

- Run it yourself and a small VPS running CloudBeaver's own container costs less in cash: a Hetzner CPX22 or DigitalOcean 2 vCPU/4 GB box is about $24 a month, or a GCP `e2-standard-2` about $49 a month — plus your own time for backups, security patches and upgrades, which RAD's managed Cloud SQL, Secret Manager and monitoring cover for you.
- RAD never claims to be cheaper than bare infrastructure in cash terms — it usually is not. The difference is what RAD manages for you: patching, backups, secrets and monitoring, plus the ability to pause CloudBeaver for free rather than paying for idle capacity (see below).

### Pause it for free: delete a RAD-managed project, restore it when you need it

If CloudBeaver runs in **a project RAD manages for you**, you have a second option that goes well beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to nothing.** This suits CloudBeaver that you only need occasionally far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google to delete the project. Google does not remove the project immediately: it keeps it, recoverable, for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike deleting one module, this does not tear down GKE Autopilot resources one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's owner can restore it. RAD asks Google to undelete the project and reattaches its billing account, then asks you to run **Update** on each deployment to confirm everything came back. Because nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a rebuild, and an Update never charges the module fee again. That is a handful of credits (under US$1) in total for a typical CloudBeaver chain, against the 80 credits a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$42.08.** Deploy CloudBeaver, use it, delete the project. Restore it next time you want it, confirm with Update, and delete it again when you're done. You pay only for the module fee once, the builds, and whatever hours it was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages billing for), and you restore it yourself within the 30 days — after that, Google deletes it for good. Restoring is admitted like creating a new project: your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier most study and demo use fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap: the backup bucket does not survive.** Nightly backups are written to a bucket inside the project, and that bucket is **not** protected by Cloud Storage's soft-delete, so it is very likely gone as soon as you delete the project — even though the project itself is recoverable for 30 days. If you have customised CloudBeaver and want to keep that work, copy a backup out (to Google Drive, or a bucket outside the project) before you delete. For a default installation with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

GKE Autopilot keeps at least one pod running, so it never scales to zero on its own. The option above only applies to a RAD-managed project; **in your own project, or once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 80 credits (US$8) in your own project. Deleting saves money only once CloudBeaver would otherwise sit unused for about 6 days or more in your own project (US$1.40 a day), or about 2 days or more in a RAD-managed one (56 credits a day).
- **Keep your data first.** Nightly backups are written to a bucket inside the deployment and are deleted with it, so copy the latest backup out before deleting if you want to keep it.
- **Note your settings.** RAD does not recreate a deleted deployment for you; you enter the settings again when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either the trainer funds every place, or each participant pays for their own. Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's own fees and daily-credit estimates from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the 30-day recovery window and what it says about Cloud Storage objects without soft delete. Prices change; check each source before relying on a figure.

## 1. Overview

CloudBeaver runs as a single JVM web workload. Because CloudBeaver keeps all of its
own state in a persistent workspace and provisions no application database, the
deployment wires together a deliberately small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single JVM pod, 1 vCPU / 1 GiB by default, port 8978 |
| Persistent workspace | Persistent Disk (block PVC) via StatefulSet | **Recommended:** a per-pod block PVC mounted at `/opt/cloudbeaver/workspace` backs the embedded H2 store |
| Database | **None provisioned** | `database_type = "NONE"` — CloudBeaver stores its own state; it *connects out* to databases you configure in the UI |
| Cache & queue | **None** | CloudBeaver uses no Redis; `enable_redis` is forced off |
| Secrets | Secret Manager | No app-level secret is generated — the admin account is created via the first-run setup wizard |
| Ingress | Cloud Load Balancing | **`ClusterIP` by default** (in-cluster); use `LoadBalancer` / a custom domain for external access |

**Sensible defaults worth knowing up front:**

- **No application database is provisioned.** `database_type = "NONE"`. CloudBeaver
  keeps its metadata in an embedded H2 store inside the workspace volume. The
  databases it *manages* are added by an operator in the UI after deploy.
- **Use a block PVC for the workspace, not GCS FUSE.** `stateful_pvc_enabled = true`
  is the default and should stay on: a block Persistent Disk — not GCS FUSE — is the correct
  backing store for CloudBeaver's embedded H2 database. When the PVC is enabled the
  module automatically skips the GCS FUSE volume at the same path to avoid a
  double-mount.
- **StatefulSet is auto-selected.** Setting `stateful_pvc_enabled = true` without an
  explicit `workload_type` resolves the workload to a `StatefulSet` for stable pod
  identity and orderly restarts.
- **Single instance by design.** `min_instance_count = 1` (avoid slow JVM cold starts,
  and GKE has no scale-to-zero) and `max_instance_count = 1` (the workspace is a
  single-writer store). Do **not** raise `max_instance_count`.
- **Service is `ClusterIP` by default.** In-cluster only — appropriate for a database
  admin console. For browser access from outside the cluster, use
  `service_type = "LoadBalancer"` or an Ingress with a custom domain (and IAP).
- **The admin account is claimed by the first visitor.** CloudBeaver has no seeded
  admin — complete the setup wizard immediately once the service is reachable.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the CloudBeaver workload

CloudBeaver pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. With a block PVC enabled the workload runs as a **StatefulSet**
(port 8978) for stable pod identity. Because the workspace is single-writer, keep the
workload at a single replica.

- **Console:** Kubernetes Engine → Workloads → select the CloudBeaver workload to see
  pods and events. Kubernetes Engine → Services & Ingress shows how it is exposed.
- **CLI:**
  ```bash
  kubectl get pods,svc,statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe statefulset -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Persistent Disk — the workspace volume (block PVC)

CloudBeaver's entire state — its embedded H2 metadata database, saved connections,
users, and configuration — persists under `/opt/cloudbeaver/workspace`. The
recommended backing store is a **block Persistent Disk** provisioned per-pod by the
StatefulSet's PVC template and mounted at that path. This is the durable heart of the
deployment and the correct store for the embedded H2 database.

- **Console:** Kubernetes Engine → Storage → Persistent Volume Claims.
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"
  # Inspect the workspace contents inside the pod:
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls -la /opt/cloudbeaver/workspace
  ```

When `stateful_pvc_enabled = true`, the module sets `enable_gcs_storage_volume = false`
so the GCS FUSE volume is not also mounted at the same path. A `storage` Cloud Storage
bucket is still declared by CloudBeaver_Common for parity with the Cloud Run variant.

### C. Cloud Storage

A `storage` **Cloud Storage** bucket is declared for the deployment. With the
recommended block-PVC setup the workspace lives on the Persistent Disk rather than the
bucket, but the bucket is still provisioned and available for auxiliary storage.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Database connectivity (no managed instance)

This module provisions **no Cloud SQL instance** — `gcloud sql instances list` will
not show one created by CloudBeaver. Instead, CloudBeaver connects out to whatever
databases you register in its UI. To reach the deployment's own shared Cloud SQL (or
any private database), the target must be reachable on the VPC from the pod.

- **CLI (test reachability from within the pod):**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- sh -c 'nc -zv <db-private-ip> 5432'
  ```

### E. Secret Manager

CloudBeaver generates **no application-level secret** — there is no encryption key, no
JWT secret, and no database password to manage (there is no database). The admin
account is created through the first-run setup wizard, and all state lives in the
workspace.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed as a **`ClusterIP`** Service — reachable only from
inside the cluster, which suits a database administration console. For browser access
from outside the cluster, use `service_type = "LoadBalancer"` or enable an Ingress
with a custom domain and Google-managed certificate (optionally with IAP, Cloud Armor,
and a reserved static IP).

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring. Optional
uptime checks and alert policies are available (uptime checks require a publicly
reachable endpoint, e.g. a LoadBalancer Service).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. CloudBeaver Application Behaviour

- **No first-deploy database setup.** There is no db-init job and no application
  database. CloudBeaver initialises its own embedded metadata store inside the
  workspace on first start.
- **State is entirely in the workspace volume.** The embedded H2 database, saved
  connections, managed users, and configuration all live under
  `/opt/cloudbeaver/workspace`, backed by the block PVC. The PVC survives pod
  restarts and rescheduling, which is why a StatefulSet + block PVC is strongly
  recommended over GCS FUSE for the embedded H2 store.
- **First-run setup wizard.** On first access CloudBeaver presents a setup wizard to
  create the server configuration and the administrator account. There is no seeded
  admin — whoever completes the wizard first becomes the admin. Do this immediately,
  and keep the Service internal until you have.
- **Adding databases to manage.** After logging in as admin, add connections in the UI
  (New Connection → choose the driver → supply host/port/credentials). To reach private
  databases, ensure they are reachable on the VPC from the pod.
- **Health path.** Startup and liveness probes target `/` (the CloudBeaver web UI),
  which returns HTTP 200 once the JVM has finished starting.
- **Single-writer scaling.** Keep `max_instance_count = 1`. The workspace store cannot
  be shared safely by concurrent pods.
- **Inspect the running configuration:**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | sort
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for CloudBeaver are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

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
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `cloudbeaver` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `CloudBeaver` | Human-readable name shown in the Console. |
| `application_version` | `latest` | CloudBeaver image tag (built from `dbeaver/cloudbeaver:<version>`); pin for reproducibility. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `min_instance_count` | `1` | Keep 1 warm replica (GKE has no scale-to-zero; avoids slow JVM cold starts). |
| `max_instance_count` | `1` | **Keep at 1.** The workspace is a single-writer store; concurrent pods corrupt it. |
| `cpu_limit` | `1000m` | CPU per pod. |
| `memory_limit` | `1Gi` | Memory per pod. CloudBeaver runs on the JVM — size accordingly. |
| `container_port` | `8978` | Fixed by CloudBeaver_Common; not forwarded to App_GKE and has no effect here. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `ClusterIP` | In-cluster by default (recommended for a DB console). Use `LoadBalancer` for external access. |
| `workload_type` | `null` | Leave unset — with `stateful_pvc_enabled = true` it auto-resolves to `StatefulSet`. |
| `session_affinity` | _(set)_ | Sticky routing for UI sessions. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Keep `true`** — a block PVC (not GCS FUSE) is the correct store for CloudBeaver's embedded H2 DB. |
| `stateful_pvc_size` | `20Gi` | Per-pod PVC size; hold the workspace plus overhead. |
| `stateful_pvc_mount_path` | `/opt/cloudbeaver/workspace` | Must be CloudBeaver's workspace directory. |
| `stateful_pvc_storage_class` | _(set)_ | Kubernetes StorageClass for the PVC. |
| `stateful_headless_service` | _(set)_ | Headless Service for stable pod DNS names. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 15s delay | Startup probe against the CloudBeaver UI. |
| `liveness_probe` | HTTP `/` 30s delay | Liveness probe against the CloudBeaver UI. |
| `uptime_check_config` | _(set)_ | Cloud Monitoring uptime check — requires a publicly reachable endpoint (e.g. a LoadBalancer Service). |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is off — CloudBeaver's workspace is on the block PVC, not NFS. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the declared GCS buckets. |
| `storage_buckets` | `[]` | Additional buckets to provision. |
| `enable_image_mirroring` | `true` | Mirror the CloudBeaver image into Artifact Registry before deployment. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour. Note that
`enable_redis` is forced to `false` and no application database is provisioned
(`database_type = NONE`) by this module.

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
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved / `LoadBalancer` is used). |
| `service_url` | URL to reach CloudBeaver. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any initialization jobs (empty by default). |
| `statefulset_name` | Name of the StatefulSet. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — `workload_type = "Deployment"` alongside `stateful_pvc_enabled = true`, `quota_memory_requests`/`_limits` without binary unit suffixes, IAP with no authorized identities. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` (block PVC) | Critical | Without a persistent block PVC the workspace (embedded H2 DB, connections, users, config) is lost on pod restart. GCS FUSE is not a safe store for the embedded H2 database. |
| Workspace PVC | Preserve across redeploys | Critical | The PVC holds all CloudBeaver state; deleting it wipes every saved connection and setting. |
| `max_instance_count` | `1` | Critical | The workspace is single-writer; two pods writing the embedded H2 store concurrently corrupt it. |
| `stateful_pvc_mount_path` | `/opt/cloudbeaver/workspace` | High | CloudBeaver's workspace path is baked into the image; mounting elsewhere leaves state on ephemeral storage. |
| First-run setup wizard | Complete immediately | High | There is no seeded admin — anyone who reaches the UI first can claim the administrator account. |
| `service_type` | `ClusterIP` (or LB+IAP) | High | `LoadBalancer` without IAP/Cloud Armor exposes a database admin console to the public internet. |
| `memory_limit` | `1Gi` | High | CloudBeaver is JVM-based; too little memory causes OOM kills. |
| `min_instance_count` | `1` | Medium | GKE requires min ≥ 1; a warm replica avoids slow JVM cold starts. |
| `application_version` | Pin a tag in production | Medium | `latest` can shift the CloudBeaver version between rebuilds; pin for reproducibility. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `enable_redis` / `database_type` | Leave as set (off / `NONE`) | Low | CloudBeaver uses neither; overriding has no benefit and is unsupported here. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
CloudBeaver-specific application configuration shared with the Cloud Run variant is
described in **[CloudBeaver_Common](CloudBeaver_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: CloudBeaver on GKE Autopilot](../labs/CloudBeaver_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [CloudBeaver on Google Cloud Run](CloudBeaver_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [CloudBeaver Common — Shared Application Configuration](CloudBeaver_Common.md) — the configuration shared by both deployment targets.
