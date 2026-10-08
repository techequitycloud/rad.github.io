---
title: "Gatus on GKE Autopilot"
description: "Configuration reference for deploying Gatus on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Gatus on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gatus_GKE.png" alt="Gatus on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gatus is an open-source, Apache 2.0-licensed developer-oriented status page and
health-check monitor written in Go. It polls configured HTTP, TCP, DNS, ICMP, and
other endpoints on independent per-endpoint schedules, evaluates simple result
conditions (status code, response time, response body content, TLS certificate
expiry), and serves a live public status page plus alerting — no external database
required. This module deploys Gatus on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Gatus uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, backups, and the deployment
lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## What Gatus costs on RAD, and how that compares

**Running Gatus in your own Google Cloud project costs about US$40.29/month in Google Cloud charges, on top of a one-time 40-credit RAD module fee** (36 credits — 10% lower — in a RAD-managed project). Gatus is a self-hosted, developer-oriented status page and health-check monitor (Go). If you deploy into a RAD-managed project, you can pause the whole thing for free and pick it back up later — see "Pause it for free" below.

*Gatus is also available on Cloud Run — see the [Cloud Run guide](Gatus_CloudRun.md) for the lower-cost option; this guide covers the GKE variant.*

### What you pay on RAD

| | Own project | RAD-managed project |
|---|---|---|
| Module fee | **40 credits** (one-time) | **36 credits** (one-time, 10% lower) |
| Build time | ~3–6 credits (one-time, per build) | ~3–6 credits (one-time, per build) |
| Google Cloud running cost | ~US$40.29/month, billed to your own Google billing account at list price | ~63 credits/day (~US$6.30/day), metered hourly at list price plus RAD's margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| GKE Autopilot pod, 1x vCPU / 0.5 GiB | US$34.29 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | shared across every GKE app in the project; $0 if this is your only cluster, else ~73 |
| **Total** | **US$40.29** |

### How it compares

- There is no officially hosted/cloud version of Gatus to compare against, so the honest comparison is against self-managed infrastructure, not a competing SaaS.
- A bare VPS sized to roughly 1 vCPU / 0.5 GiB — a Hetzner CPX22 (2 vCPU/4GB, ~US$24/mo), a DigitalOcean 2 vCPU/4GB Droplet (US$24/mo), or GCP's own Compute Engine e2-standard-2 (2 vCPU/8GB, ~US$49/mo) — usually undercuts RAD's sticker price; a VPS a size or two smaller would undercut it further.
- What that lower price does not include is the admin's own time: patching the OS, rotating database backups, renewing TLS certificates and watching for downtime. RAD's managed Cloud SQL, Secret Manager and monitoring do that for you, which is the actual trade being made, not the sticker price.
- RAD is not claiming to be cheaper than a bare VPS in cash terms — it usually is not. The case for RAD is what's managed for you.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Gatus is running in a **RAD-managed project**, you can stop paying for it entirely without destroying
it. Deleting that project first unlinks its billing, then asks Google to delete the project outright —
Google's own 30-day recoverable soft delete. Unlike deleting the Gatus module on its own, this does not
tear down Cloud SQL, any VM or the compute resource one by one: the whole project simply stops, and nothing is
charged while it waits, because billing is already unlinked.

Restoring, within 30 days and only by the project's owner, asks Google to undelete the project and reattaches
its billing account, then asks you to run Update on each deployment to confirm everything came back. Because
nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a
rebuild, and an Update never charges the module fee again. This costs only a handful of build-time credits in
total — roughly 5–10 credits, under US$1, for a typical 2–3-deployment chain. The 36-credit module
fee is not charged again.

What this needs: you must own the project (not one RAD only manages billing for), you must restore it yourself
within 30 days — after that Google deletes it for good — and restoring is admitted like creating a new
project, so your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier
most study/demo use fits). Google says most services are fully working again within 36 hours of a restore.

One real gap: nightly backups are written to a bucket inside the project, and that bucket has Cloud Storage's
soft-delete explicitly turned off, so it is very likely gone as soon as you delete the project — even though
the project itself is recoverable for 30 days. If you have customised Gatus and want to keep that work,
copy a backup out (to Google Drive, or a bucket outside the project) before deleting. For a default install
with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

If Gatus is in your own project (or more than 30 days have passed on a RAD-managed one), the way to stop
paying is to delete the deployment and redeploy later when you need it again.

A redeploy costs the module fee again, plus the builds: roughly **40 + ~3–6 credits** (~US$4.45)
in your own project, or **36 + ~3–6 credits** on a RAD-managed one.

Deleting only saves money once Gatus would otherwise sit unused long enough to clear that redeploy cost
against its own running cost: roughly **about 4 days or more** idle in your own project (against its
~US$40.29/month Google Cloud bill), or **about 1 days or more** idle in a RAD-managed project
(against its ~63 credits/day).

Keep data first: nightly backups go to a bucket inside the deployment and are deleted with it, so copy the
latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training:** a trainer runs a session for a class. Each participant gets the app in their
  own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either the trainer
  funds every place, or each participant pays for their own. Everything is deleted when the session ends and
  unused credits go back to the trainer.
- **Managed Environments, for consultancies:** a partner runs the app for a client from a ring-fenced wallet it
  funds, and settles with the client directly. If the wallet runs low, billing pauses and the data is kept, so
  nobody receives an unexpected charge. At the end the partner hands the project over and the deployments
  become the client's own.
- Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card, bank
  transfer or mobile money.

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; radmodules.dev/pricing for RAD's own fees and daily-credit estimates; [Google's project delete/restore docs](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics.

## 1. Overview

Gatus runs as a single Go web workload. The deployment wires together a deliberately
small set of Google Cloud services — Gatus has no database, cache, or object-storage
dependency of its own:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single Go Deployment, 1 vCPU / 512 MiB by default |
| Database | **None** | `database_type = "NONE"`; optional history store is a local SQLite file, no Cloud SQL provisioned |
| Persistence | Ephemeral disk (default), NFS, or block PVC (StatefulSet) | SQLite history at `/data/data.db`; block PVC is the only option verified safe for Gatus's WAL-mode SQLite (see below) |
| Object storage | **None** | Gatus stores nothing in Cloud Storage |
| Cache / queue | **None** | No Redis; Gatus has no cache or queue dependency |
| Secrets | Secret Manager | No auto-generated secrets; only user-supplied `secret_environment_variables` |
| Ingress | Cloud Load Balancing | External LoadBalancer Service; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **No database is provisioned.** `database_type = "NONE"` — Gatus's optional
  history store is a local SQLite file. The database-related variables exist for
  completeness but are inert unless you deliberately opt in to an external database.
- **Configuration is entirely file-based.** Every monitored endpoint, alert
  integration, and storage setting lives in one YAML file baked into the image at
  build time — there is no per-setting environment variable convention and no
  runtime config-reload API. Change monitored endpoints by editing
  `modules/Gatus_Common/scripts/config.yaml` and redeploying.
- **Stateless Deployment by default, with the ONE genuinely safe durability option
  in this catalogue.** `workload_type = "Deployment"` with an **ephemeral** SQLite
  history store at `/data/data.db`. Gatus hardcodes SQLite WAL journal mode
  (confirmed live: no config option disables it), and SQLite's own documentation
  states WAL is unsupported on network filesystems — so NFS carries a real
  corruption risk here. GKE's `stateful_pvc_enabled = true` (a real block device,
  not gcsfuse) is the recommended path for durable history: pair it with
  `stateful_pvc_storage_class = "standard"` (HDD; Gatus's history needs no SSD
  IOPS, and HDD avoids the tight regional `SSD_TOTAL_GB` quota).
- **Single replica by default** (`min_instance_count = 1`, `max_instance_count = 1`).
  Multiple replicas would each independently poll every endpoint and duplicate
  alerts — there is no shared coordination between Gatus instances.
- **Exposed via a LoadBalancer Service** (`service_type = "LoadBalancer"`) so the
  status page is reachable from outside the cluster; `reserve_static_ip` and
  `enable_custom_domain` both default to `false` since Gatus bakes no
  self-referencing URL into its config at boot — enable either only if you need a
  stable IP or a custom hostname.
- **The health endpoint is `/health`**, which returns HTTP 200 as soon as the server
  binds its port.
- **To run alongside `Gatus_CloudRun` on the same tenant**, set
  `tenant_id = "gke"` (and `"cr"` on the Cloud Run variant) — see the
  recommendation in `config/deploy.tfvars`. This avoids a naming collision on shared
  secret names, GCS bucket names, and rotation topics.
- **Access control, if any, is configured in `config.yaml`.** Gatus ships with an
  open status page by default; optional basic-auth or OIDC protection is configured
  in the `security` block of `config.yaml` and requires a rebuild.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Gatus workload

Gatus pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. By default the workload is a stateless `Deployment` with a single
replica; switching to a `StatefulSet` provisions a per-pod block PVC for durable
check history.

- **Console:** Kubernetes Engine → Workloads → select the Gatus workload to see pods
  and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl get statefulset -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Persistence — the SQLite history store

Gatus has **no Cloud SQL instance**. Its optional history store is a local SQLite
file at `/data/data.db`, baked into the image's directory structure. With the
default stateless Deployment this directory is **ephemeral** — history does not
survive a pod restart.

- **StatefulSet block PVC (recommended for durable history):**
  `stateful_pvc_enabled = true` with `stateful_pvc_mount_path = "/data"` and
  `stateful_pvc_storage_class = "standard"` — a per-pod real block device holds the
  history database. This is the only persistence option in this catalogue verified
  safe for Gatus's WAL-mode SQLite file.
- **NFS (Filestore) — use with caution:** `enable_nfs = true` mounts at `/data`, but
  carries the WAL-on-network-filesystem risk described in §1.

- **Console:** Filestore → Instances (NFS); Kubernetes Engine → Storage →
  PersistentVolumeClaims (block PVC).
- **CLI:**
  ```bash
  kubectl get pvc -n "$NAMESPACE"                             # StatefulSet PVCs
  kubectl exec -n "$NAMESPACE" <pod> -- ls -l /data           # history store location
  ```

See [App_GKE](App_GKE.md) for the NFS and StatefulSet PVC models.

### C. Secret Manager

Gatus generates **no** secrets at deploy time — there is no database password or
encryption key to manage. Secret Manager is used only if you supply your own via
`secret_environment_variables` (for example a `${VAR}` referenced inside
`config.yaml`'s alerting configuration).

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### D. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP via a
LoadBalancer Service. A custom domain with a Google-managed certificate and a
reserved static IP can both be enabled if needed, but neither is required for
correctness since Gatus's config bakes no self-referencing URL.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available. Gatus logs each endpoint
check's result (success/failure, duration) as it runs.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Gatus Application Behaviour

- **No first-deploy database setup.** Gatus has no external database and no
  migration step. It reads `config.yaml`, initialises its SQLite history store (if
  configured), and starts serving immediately. There is no init job by default.
- **Persistence depends on the workload type.** A stateless `Deployment` uses an
  ephemeral history store; a `StatefulSet` with a block PVC makes it durable across
  pod restarts.
- **`imagePullPolicy = Always` for the custom image.** App_GKE sets this for
  custom-built/mirrored images so a rebuild-and-redeploy under an unchanged tag pulls
  the new layers rather than serving a stale node cache.
- **Health path.** Startup and liveness probes target `/health`, which returns HTTP
  200 as soon as the server binds port 8080. Verify from inside the cluster:
  ```bash
  kubectl run curl --rm -it --image=curlimages/curl -n "$NAMESPACE" -- \
    curl -s -o /dev/null -w '%{http_code}\n' http://<service-name>.$NAMESPACE.svc.cluster.local/health
  ```
- **View the status page** (against the external IP):
  ```bash
  EXTERNAL_IP=$(kubectl get svc <service-name> -n "$NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
  curl -s "http://$EXTERNAL_IP/" | head -20
  ```
- **Configuration changes require a rebuild.** Gatus has no admin UI or API for
  editing monitored endpoints. Edit `modules/Gatus_Common/scripts/config.yaml` (add,
  remove, or modify `endpoints` entries) and redeploy to apply changes.
- **Access is open until you configure it.** By default the status page has no
  authentication. Configure basic-auth or OIDC in `config.yaml`'s `security` block
  and redeploy to restrict viewing.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Gatus are listed; every other input is inherited
from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 / 3 — Deployment Environment & Application Identity

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix; set `"gke"` to coexist with a `Gatus_CloudRun` deployment on the same tenant (see `config/deploy.tfvars`). |
| `application_name` | `gatus` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Image version tag; `latest` maps to a pinned `v5.36.0` base. Pin `v5.x.y` in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `custom` builds the wrapper image via Cloud Build; `prebuilt` deploys an image directly. |
| `min_instance_count` | `1` | Minimum replicas (GKE has no scale-to-zero). |
| `max_instance_count` | `1` | **Keep at 1** — replicas would each independently poll every endpoint and duplicate alerts. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Per-pod CPU/memory. |
| `container_port` | `8080` | Gatus listens on port 8080. |
| `container_protocol` | `http1` | HTTP/1.1 by default. |
| `workload_type` | `Deployment` | Stateless default; `StatefulSet` for a durable per-pod PVC. |
| `enable_cloudsql_volume` | `false` | Off — Gatus has no database. |
| `enable_image_mirroring` | `true` | Mirror the Gatus image into Artifact Registry. |

### Group 5 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in. **Blocks unauthenticated viewing.** Needs `iap_oauth_client_id` / `_secret`. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Substitutions for `${VAR}`-style references inside `config.yaml`, not per-setting overrides. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (optional; none required). |

### Group 6 — GKE Cluster

| Variable | Default | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Leave empty to auto-discover the Services_GCP cluster. |
| `service_type` | `LoadBalancer` | Gatus is a public status page, so this defaults to `LoadBalancer`. |
| `session_affinity` | `None` | Set `ClientIP` if you scale replicas and want a client pinned. |

### Group 7 — StatefulSet (durable check history)

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Set `true` for a per-pod block PVC — the only durable option verified safe for Gatus's WAL-mode SQLite history. |
| `stateful_pvc_size` | `10Gi` | Per-pod PVC storage size. |
| `stateful_pvc_mount_path` | `/data` | Mount path; matches the `storage.path` directory baked into `config.yaml`. |
| `stateful_pvc_storage_class` | `standard` | HDD by default — Gatus's history store needs no SSD IOPS; avoids the tight `SSD_TOTAL_GB` quota. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health` | Startup probe. Gatus becomes healthy within seconds. |
| `health_check_config` | HTTP `/health` | Liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |

### Group 13 / 14 — Filesystem & Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Optional durable history mount. **Caution:** carries a WAL-on-network-filesystem risk — prefer `stateful_pvc_enabled`. |
| `nfs_mount_path` | `/data` | NFS mount path; matches Gatus's baked-in `storage.path`. |
| `storage_buckets` | `[]` | Not required — Gatus uses no object storage. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Gatus has no external database; leave `NONE`. |
| `application_database_name` / `application_database_user` | `gatus` | Inert unless an external database is deliberately enabled. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not required — Gatus has no Redis dependency. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `false` | Provision an Ingress for a custom hostname + managed certificate. Off by default — the `LoadBalancer` Service already gives external reachability. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `false` | Off by default — Gatus bakes no self-referencing URL, so there is no correctness reason to reserve a stable IP. |

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
| `service_external_ip` | External LoadBalancer IP. |
| `service_url` | URL to reach Gatus. |
| `database_instance_name` / `database_name` / `database_user` | Database identifiers — empty for the default `NONE` engine. |
| `database_password_secret` / `database_host` / `database_port` | Database endpoint fields — unused for `NONE`. |
| `storage_buckets` | Created Cloud Storage buckets (none by default). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of any setup and import jobs (none by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — IAP with no OAuth credentials, `enable_cloudsql_volume = true` with `database_type = "NONE"`, `min_instance_count > max_instance_count`, `quota_memory_*` without binary units. The GKE variant's own `validation.tf` enforces these guards. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_nfs` (for durable history) | Prefer `stateful_pvc_enabled` instead | Critical | Gatus hardcodes SQLite WAL journal mode, which SQLite's own documentation states is unsupported on network filesystems — NFS-backed history risks silent corruption over time. |
| `stateful_pvc_mount_path` | `/data` | High | Mounting the PVC anywhere other than Gatus's baked-in `storage.path` directory persists the wrong path and history stays ephemeral. |
| `stateful_pvc_storage_class` | `standard` (HDD) | Medium | The SSD-backed default (`standard-rwo`) draws down the tight regional `SSD_TOTAL_GB` quota for a workload that needs no SSD IOPS. |
| `max_instance_count` | `1` | High | Scaling beyond 1 has every replica independently poll every endpoint, duplicating alert notifications with no coordination between instances. |
| `enable_cloudsql_volume` | `false` | High | Setting `true` with `database_type = "NONE"` starts an Auth Proxy sidecar with no instance to reach — rejected by the plan-time guard. |
| `enable_iap` | only when auth-gated | High | IAP requires Google sign-in for every request, blocking unauthenticated status-page viewing. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects invalid values, and 0 would leave no pod to serve the status page. |
| Gatus `security` block in `config.yaml` | Configure if the page has sensitive endpoint names | Medium | Left default, the status page (including all configured endpoint names and their up/down history) is publicly visible to anyone with the external IP. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict all pods simultaneously during maintenance. |
| `application_version` | Pin `v5.x.y` in prod | Low | `latest` maps to a pinned base (`v5.36.0`); pin explicitly to control upgrades. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Gatus-specific application configuration shared with the Cloud Run variant is
described in **[Gatus_Common](Gatus_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Gatus on GKE Autopilot](../labs/Gatus_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Gatus on Google Cloud Run](Gatus_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Gatus Common — Shared Application Configuration](Gatus_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Headscale on GKE Autopilot](Headscale_GKE.md), [TechnitiumDNS on GKE Autopilot](TechnitiumDNS_GKE.md), [AdGuard Home on GKE Autopilot](AdGuardHome_GKE.md) in the **Zero-trust Network & DNS** solution.
