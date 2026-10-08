---
title: "TechnitiumDNS on GKE Autopilot"
description: "Configuration reference for deploying TechnitiumDNS on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# TechnitiumDNS on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/TechnitiumDNS_GKE.png" alt="TechnitiumDNS on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

> ⚠️ **Scoping disclosure:** this module deploys Technitium's **web admin console + REST API only**
> (port 5380/HTTP). Technitium's core DNS resolver function (port 53/udp+tcp) **cannot** be exposed
> through this module's standard HTTP(S) Gateway pattern — no raw L4 UDP/TCP port-53 LoadBalancer is
> provisioned. No client anywhere can query this deployment as a DNS resolver. See §1 and §7 below for
> the full explanation.

Technitium DNS Server is a self-hosted, open-source, cross-platform authoritative and recursive DNS
server (.NET) with a full-featured web admin console and REST API for managing zones, records,
DNS-based ad/tracker blocking, conditional forwarding, and DNS-over-HTTPS/TLS. This module deploys the
official `technitium/dns-server` image on **GKE Autopilot**, unmodified, on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

This guide focuses on the cloud services TechnitiumDNS uses and how to explore and operate them from the
Google Cloud Console and the command line. For the mechanics common to every GKE application — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## What TechnitiumDNS costs on RAD, and how that compares

**TechnitiumDNS on RAD's GKE Autopilot module costs about US$24.04 a month in a Google Cloud project you own, with the module fee charged once in RAD credits.** GKE suits this module if it needs to sit beside other Kubernetes workloads; for the lowest cost, the [Cloud Run module](TechnitiumDNS_CloudRun.md) runs the same deployment for about US$16.78 a month instead. If you only need it occasionally — testing zone configuration, a short-lived evaluation — a RAD-managed project can be deleted and restored within 30 days for a handful of credits (under US$1) instead of paying for it to sit idle. See **Pause it for free**, below. Figures are as at 8 October 2026; sources are listed at the end of this section.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 40 credits (US$4 at the top-up price) | 36 credits (10% lower) |
| Build time | About 3-6 credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$24.04 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **55 credits a day**, about 1,650 a month |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the network is shared by every application in the project, so a second application does not add a second set of it.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 0.5x vCPU / 0.5 GiB | US$18.04 |
| Cloud NAT and networking | US$5.00 |
| Cloud Storage (add-ons, backups) | US$1.00 |
| GKE cluster management fee | shared across every GKE app in the project; $0 if this is your only cluster, else ~73 |
| **Total** | **US$24.04** |

### How it compares

- TechnitiumDNS has no commercial hosted SaaS of its own for this admin console/API surface — it is distributed only as self-hosted, Docker-first open-source software for an administrator to run themselves.
- A self-managed comparison: Hetzner CPX22 (2 vCPU/4GB) runs about $24/month, a DigitalOcean 2 vCPU/4GB Droplet is the same $24/month, and a GCP Compute Engine e2-standard-2 (2 vCPU/8GB) is about $49/month — all more machine than this module's 0.5 vCPU / 0.5 GiB pod needs; a $5-6/month shared-vCPU micro instance would run it comfortably, plus the admin's own time for patching and TLS that RAD's managed Secret Manager and monitoring cover for you.
- With no database here, most of RAD's own-project running cost beyond the pod itself is the shared GKE cluster management fee, which is split across every GKE app running in the same project.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If TechnitiumDNS runs in a project RAD manages for you, deleting the whole project unlinks its billing first, then asks Google to delete the project outright — Google's own 30-day recoverable soft delete. Unlike deleting one module, this does not tear down the compute resource one by one: the whole project simply stops, and nothing is charged while it waits, because billing is already unlinked.

Restoring, within 30 days and only by the project's owner, asks Google to undelete the project and reattaches its billing account, then asks you to run Update on each deployment to confirm everything came back. Because nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a rebuild, and an Update never charges the module fee again. This costs only a handful of credits (under US$1) in total for a typical 2-3-deployment chain.

What this needs: you must own the project (not one RAD only manages billing for), you must restore it yourself within 30 days — after that Google deletes it for good — and restoring is admitted like creating a new project, so your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier most study/demo use fits). Google says most services are fully working again within 36 hours of a restore.

One real gap: nightly backups are written to a bucket inside the project, and that bucket has Cloud Storage's soft-delete explicitly turned off, so it is very likely gone as soon as you delete the project — even though the project itself is recoverable for 30 days. If you have custom zone configuration you want to keep, copy a backup out (to Google Drive, or a bucket outside the project) before deleting. For a default install with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

In your own project, or once the 30-day restore window has passed, the alternative is to delete TechnitiumDNS outright and redeploy it later. A redeploy costs the module fee again, plus the builds — roughly 45 credits (about US$4.50) in your own project, or 41 credits in a RAD-managed one.

Deleting saves money only once TechnitiumDNS would otherwise sit unused long enough to clear that redeploy cost against its own daily running cost — against the own-project total above (about US$0.80 a day), that works out to about 6 days or more, or about 1 days or more in a RAD-managed one (55 credits a day). There's no database here, so deleting this app frees its entire running cost rather than just a share of it — only the shared cluster fee, if any, keeps running for other apps.

Keep data first: anything TechnitiumDNS writes to a backup bucket inside the deployment is deleted with it, so copy anything you want to keep out before deleting.

### Lab sessions and Managed Environments

- **Lab sessions, for training:** a trainer runs a session for a class. Each participant gets the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either the trainer funds every place, or each participant pays for their own. Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies:** a partner runs the app for a client from a ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over and the deployments become the client's own.
- Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; [radmodules.dev/pricing](https://radmodules.dev/pricing) for RAD's own fees and daily-credit estimates; [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics. No currently-verified commercial hosted SaaS exists for this TechnitiumDNS surface, so no competitor price is named.

## 1. Overview

TechnitiumDNS runs as a single prebuilt web workload. The deployment wires together a deliberately small
set of Google Cloud services — TechnitiumDNS has no database or cache dependency of its own:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single Deployment, 500m vCPU / 512 MiB by default |
| Database | **None** | `database_type = "NONE"`; zones/settings/logs are local flat files, no Cloud SQL provisioned |
| Persistence | Cloud Storage (GCS FUSE, default) or block PVC (StatefulSet) | Config bucket mounted at `/etc/dns`; switch to a StatefulSet block PVC for a real block device |
| Object storage | Cloud Storage | One auto-created "config" bucket (also the persistence layer above) |
| Cache / queue | **None** | No Redis; TechnitiumDNS needs no external cache |
| Secrets | Secret Manager | One auto-generated secret: `DNS_SERVER_ADMIN_PASSWORD` |
| Ingress | Cloud Load Balancing | External LoadBalancer Service (web console only); optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **No database is provisioned.** `database_type = "NONE"` — TechnitiumDNS keeps zones, settings, and
  logs as local flat files under `/etc/dns`. The database-related variables exist for completeness but
  are inert.
- **Persistent by default via GCS FUSE.** `workload_type = "Deployment"` with a GCS-mounted volume at
  `/etc/dns` — config survives pod restarts. Switch to a **StatefulSet block PVC**
  (`stateful_pvc_enabled = true` with `stateful_pvc_mount_path = "/etc/dns"`) for a real block device
  with stronger write-locking guarantees; the module automatically disables the GCS volume in that case.
- **Single replica by default** (`min_instance_count = 1`, `max_instance_count = 1`) — a low-traffic
  admin console needs no horizontal scale.
- **Exposed via a LoadBalancer Service** (`service_type = "LoadBalancer"`) with an **ephemeral** IP
  (`reserve_static_ip = false`) by default, conserving the project's often-scarce static-IP quota — the
  console does not bake a self-referencing URL into its boot-time config.
- **The health endpoint is `/`**, the console's unauthenticated root page, which returns HTTP 200 with
  the full console HTML as soon as the server binds its port.
- **The GKE variant runs on its own tenant namespace.** Give `TechnitiumDNS_GKE` a distinct
  `tenant_id` (e.g. `"gke"`) if deployed alongside `TechnitiumDNS_CloudRun` on the same
  tenant, to avoid a naming collision.
- **One auto-generated secret.** `DNS_SERVER_ADMIN_PASSWORD` bootstraps the initial `admin` account on
  the very first boot only; later restarts ignore it.
- **No DNS resolver.** See §7 below — this is the single most important thing to understand before
  deploying this module.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other identifiers are reported
in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the TechnitiumDNS workload

TechnitiumDNS pods are scheduled on Autopilot, which bills for the CPU/memory the pods actually request.
By default the workload is a stateless `Deployment` with a single replica; switching to a `StatefulSet`
provisions a per-pod block PVC for a real block device at `/etc/dns`.

- **Console:** Kubernetes Engine → Workloads → select the TechnitiumDNS workload to see pods and events.
  Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl get statefulset -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type (Deployment vs StatefulSet)
are managed.

### B. Persistence — the config Cloud Storage bucket (or block PVC)

TechnitiumDNS has **no Cloud SQL instance**. All zones, settings, the auth database, and logs live under
`/etc/dns`. By default this is backed by a GCS FUSE-mounted Cloud Storage bucket; switch to a StatefulSet
block PVC for a real block device:

- **Console:** Cloud Storage → Buckets (GCS volume); Kubernetes Engine → Storage → PersistentVolumeClaims
  (block PVC).
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~-config"
  kubectl get pvc -n "$NAMESPACE"                                # StatefulSet PVCs
  kubectl exec -n "$NAMESPACE" <pod> -- ls -l /etc/dns           # config/zone location
  ```

See [App_GKE](App_GKE.md) for the GCS FUSE CSI driver and StatefulSet PVC models.

### C. Secret Manager

TechnitiumDNS generates exactly one secret at deploy time: the initial admin password.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### D. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP via a LoadBalancer
Service — this is the **web console**, not a DNS endpoint. A custom domain with a Google-managed
certificate can be enabled for the console; a static IP is NOT reserved by default (set
`reserve_static_ip = true` for a stable address across redeploys).

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring. Optional uptime checks and
alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. TechnitiumDNS Application Behaviour

- **No first-deploy database setup.** TechnitiumDNS has no external database and no migration step. It
  reads/writes local flat files under `/etc/dns` from the moment it boots.
- **First-boot admin bootstrap.** `DNS_SERVER_ADMIN_PASSWORD` is applied only when
  `/etc/dns/auth.config` does not yet exist. On every later restart or redeploy, the persisted
  `auth.config` wins.
- **`imagePullPolicy = Always` is NOT forced for this module** — the image is pulled fresh (prebuilt,
  digest-resolved) rather than a custom-built/mirrored tag, so App_GKE's stale-cache concern for rebuilt
  images does not apply here in the same way; a version bump still requires a new `application_version`.
- **Health path.** Startup and liveness probes target `/`, which returns HTTP 200 with the full console
  HTML as soon as the server binds port 5380. Verify from inside the cluster:
  ```bash
  kubectl run curl --rm -it --image=curlimages/curl -n "$NAMESPACE" -- \
    curl -s -o /dev/null -w '%{http_code} %{size_download}\n' \
    http://<service-name>.$NAMESPACE.svc.cluster.local/
  ```
- **Log in.** Reach the external IP/hostname in a browser, sign in as `admin` with the Secret-Manager
  password, and change it from the console's own user-management page immediately (Technitium does not
  re-read `DNS_SERVER_ADMIN_PASSWORD` after first boot).
- **REST API.** All console actions are also available over the REST API using a session token obtained
  via `/api/user/login`. See
  [Technitium's API docs](https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md).
- **No DNS resolution from this deployment.** See §7 below.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or
notable for TechnitiumDNS are listed; every other input is inherited from [App_GKE](App_GKE.md) with its
standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 / 3 — Deployment Environment & Application Identity

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix; use a distinct value (e.g. `"gke"`) alongside the CloudRun variant on the same tenant. |
| `application_name` | `technitiumdns` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | TechnitiumDNS image version tag (e.g. `latest`, `13.5.1`). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Deploys the official image as-is; `custom` accepted for forward-compatibility. |
| `min_instance_count` | `1` | Minimum replicas (GKE has no scale-to-zero for Deployments). |
| `max_instance_count` | `1` | Maximum replicas. |
| `container_resources` | `{ cpu_limit="500m", memory_limit="512Mi" }` | Per-pod CPU/memory. |
| `container_port` | `5380` | The web console's default port. |
| `workload_type` | `Deployment` | Stateless default; `StatefulSet` for a durable per-pod block PVC. |
| `enable_cloudsql_volume` | `false` | Off — TechnitiumDNS has no database. |
| `enable_image_mirroring` | `true` | Mirror the TechnitiumDNS image into Artifact Registry. |

### Group 5 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in. **Strongly recommended** — needs `iap_oauth_client_id` / `_secret`. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra `DNS_SERVER_*` settings (e.g. `DNS_SERVER_FORWARDERS`, `DNS_SERVER_DOMAIN`). |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (additional secrets; `DNS_SERVER_ADMIN_PASSWORD` is already wired). |

### Group 6 — GKE Cluster

| Variable | Default | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Leave empty to auto-discover the Services_GCP cluster. |
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `None` | Single replica by default; no stickiness needed. |

### Group 7 — StatefulSet (durable config storage)

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Set `true` for a per-pod block PVC at `/etc/dns` instead of the GCS FUSE volume. |
| `stateful_pvc_size` | `10Gi` | Per-pod PVC storage size. |
| `stateful_pvc_mount_path` | `/etc/dns` | Mount path for the block PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass for the PVC. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/` | Startup probe targeting the console's public root page. |
| `health_check_config` | HTTP `/` | Liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |

### Group 13 / 14 — Filesystem & Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Not needed by default — the GCS volume at `/etc/dns` already persists state. |
| `gcs_volumes` | `[]` | Additional GCS buckets; the config bucket at `/etc/dns` is auto-added. |
| `storage_buckets` | `[]` | Additional buckets beyond the auto-created config bucket. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | TechnitiumDNS has no external database; leave `NONE`. |
| `application_database_name` / `application_database_user` | `technitiumdns` | Inert — no database is provisioned. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not required — TechnitiumDNS has no Redis dependency. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `false` | Ephemeral IP by default to conserve static-IP quota; set `true` for a stable production address. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP. |
| `service_url` | URL to reach the web console (not a DNS endpoint). |
| `database_instance_name` / `database_name` / `database_user` | Database identifiers — empty for the default `NONE` engine. |
| `database_password_secret` / `database_host` / `database_port` | Database endpoint fields — unused for `NONE`. |
| `storage_buckets` | Created Cloud Storage buckets (the config bucket). |
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

> **Inherited plan-time validation.** This module passes its configuration through the
> [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — IAP
> with no OAuth credentials, `enable_cloudsql_volume = true` with `database_type = "NONE"`,
> `min_instance_count > max_instance_count`, `quota_memory_*` without binary units. The GKE variant's own
> `validation.tf` enforces these guards. Invalid configuration fails the **plan** with a clear, named
> error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| Expecting this to be a DNS resolver | Do not point client DNS settings at this deployment | **Critical** | Port 53/udp+tcp is never exposed by this module's HTTP(S) Gateway pattern — DNS queries against this deployment simply fail; only the web console/API is reachable. |
| `enable_iap` | `true` for anything beyond a quick test | Critical | Without IAP, the console is protected only by its own admin password over the public internet. |
| `DNS_SERVER_ADMIN_PASSWORD` rotation | Change the password from the console after first login | High | Technitium never re-reads the env var after first boot — rotating the Secret Manager value alone does NOT change the effective console password. |
| `stateful_pvc_mount_path` | `/etc/dns` | High | Mounting the PVC anywhere other than `/etc/dns` leaves the actual config path unpersisted. |
| `enable_cloudsql_volume` | `false` | High | Setting `true` with `database_type = "NONE"` starts an Auth Proxy sidecar with no instance to reach — rejected by the plan-time guard. |
| `enable_iap` credentials | Set both `iap_oauth_client_id` and `_secret` together | High | Enabling IAP without both values is rejected at plan time by the validation guard. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict all pods simultaneously during maintenance. |
| `reserve_static_ip` | `true` for production | Medium | An ephemeral IP can change on Service recreation, breaking any bookmarked/hardcoded console URL. |
| `application_version` | Pin an explicit version in production | Low | `latest` tracks upstream releases; pin explicitly to control upgrade timing. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity, autoscaling, ingress and
certificates, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. TechnitiumDNS-specific application configuration shared with the Cloud Run
variant is described in **[TechnitiumDNS_Common](TechnitiumDNS_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: TechnitiumDNS on GKE Autopilot](../labs/TechnitiumDNS_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [TechnitiumDNS on Google Cloud Run](TechnitiumDNS_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [TechnitiumDNS Common — Shared Application Configuration](TechnitiumDNS_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Headscale on GKE Autopilot](Headscale_GKE.md), [AdGuard Home on GKE Autopilot](AdGuardHome_GKE.md), [Gatus on GKE Autopilot](Gatus_GKE.md) in the **Zero-trust Network & DNS** solution.
