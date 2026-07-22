---
title: "AdGuard Home on GKE Autopilot"
description: "Configuration reference for deploying AdGuard Home on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# AdGuard Home on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/AdGuardHome_GKE.png" alt="AdGuard Home on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

> ⚠️ **CRITICAL — read before deploying.** AdGuard Home's core value is
> network-wide DNS ad/tracker blocking, which requires clients to query it over
> DNS on port 53 (TCP+UDP). **This module uses GKE's standard HTTP(S) Gateway
> pattern, which cannot expose raw port 53.** (A secondary raw L4 `Service
> type=LoadBalancer` for port 53 is possible in principle on GKE — unlike Cloud
> Run, which cannot do this under any configuration — but is explicitly **out
> of scope** for this module's first cut.) This module deploys AdGuard Home's
> **web admin console only** (port 3000) for filter-list, custom-rule, and
> client-settings configuration management. **The deployed instance is NOT
> reachable as a public DNS resolver.** See
> [§6 Configuration Pitfalls](#6-configuration-pitfalls--sensible-defaults) for
> the full explanation.

AdGuard Home is an open-source, GPL-3.0-licensed, network-wide DNS server that
blocks ads and trackers at the DNS level and includes parental controls. It is
a Go static binary with no external database — all configuration lives in a
flat YAML file written by its own first-run setup wizard. This module deploys
AdGuard Home's web admin console on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services AdGuard Home uses and how to explore
and operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

AdGuard Home runs as a single Go static-binary pod on GKE Autopilot. The
deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single Go binary pod, 1 vCPU / 512 MiB by default, `Deployment` workload type |
| Database | None | AdGuard Home has no external database — configuration is a flat YAML file |
| Object storage | Cloud Storage (×2, GCS Fuse CSI) | `conf` bucket (config) and `work` bucket (query log/stats), both mounted as filesystem volumes |
| Secrets | Secret Manager | None generated — the admin credential is set through AdGuard Home's own first-run web wizard |
| Ingress | Cloud Load Balancing | External LoadBalancer Service by default; optional custom domain + managed certificate (for the web console — see the CRITICAL note above) |

**Sensible defaults worth knowing up front:**

- **This deployment is a configuration-management console, not a DNS
  resolver.** GKE's standard HTTP(S) Gateway pattern used here cannot expose
  raw DNS (port 53 TCP/UDP). Do not point real DNS clients at this
  deployment's IP or hostname.
- **No external database.** `database_type = "NONE"` and must not be changed.
- **Two GCS Fuse volumes are pre-wired and provisioned automatically** —
  `conf` at `/opt/adguardhome/conf` and `work` at `/opt/adguardhome/work` —
  so configuration and query-log/stats persist across pod restarts. You do
  not need to set `gcs_volumes` yourself, and no StatefulSet/block PVC is
  required (`workload_type = "Deployment"`).
- **`container_port = 3000`** — AdGuard Home's setup wizard is hardcoded to
  listen on port 3000 until `AdGuardHome.yaml` exists. If you change the web
  UI's own port during the setup wizard, keep it at 3000 or the platform's
  health probe and public URL will stop matching what the pod actually
  listens on.
- **`service_type = "LoadBalancer"` by default.** The admin console is a UI,
  so it is public-facing like any other web app in this catalogue — unlike an
  internal-only DB-admin tool.
- **No pre-seeded admin credential.** AdGuard Home's own first-run setup
  wizard, served at the deployment URL, is where you set the admin
  username/password — nothing is injected by the platform.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the AdGuard Home web admin console

AdGuard Home runs as a single-replica `Deployment` on Autopilot.

- **Console:** Kubernetes Engine → Workloads → select the AdGuard Home
  workload to see pods, revisions, and events. Kubernetes Engine → Services &
  Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud Storage (GCS Fuse) — config and query-log/stats

AdGuard Home stores its entire configuration in a flat YAML file
(`AdGuardHome.yaml`) and its query log / stats database under a separate
directory. Both are backed by dedicated Cloud Storage buckets mounted via the
GCS Fuse CSI driver — `conf` and `work` — provisioned automatically.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~adguardhome"
  gcloud storage ls gs://<conf-bucket>/           # bucket names are in the Outputs
  gcloud storage cat gs://<conf-bucket>/AdGuardHome.yaml   # inspect the live config
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse CSI mount details.

### C. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing
IP. **This is the web admin console URL only — it is not a DNS server
address.** A custom domain with a Google-managed certificate can be enabled,
and a static IP can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE"
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

The entrypoint logs a DNS-scope reminder banner on every boot — visible in the
first lines of a fresh pod's log.

---

## 3. AdGuard Home Application Behaviour

- **No database bootstrap.** AdGuard Home has no external database, so there
  is no `initialization_jobs` default — the list is available for
  operator-supplied custom jobs only.
- **First-run setup wizard.** On first visit to the external IP (before
  `AdGuardHome.yaml` exists), AdGuard Home serves its own setup wizard on port
  3000: choose the admin web UI port (keep it 3000), set the admin
  username/password, and select upstream DNS servers. Nothing here is
  pre-seeded by the platform.
- **Health path.** Startup and liveness probes target `/` — there is no
  dedicated health endpoint; the root returns `200` both before and after
  initial setup.
- **DNS resolution is not reachable.** The pod's own internal DNS listener may
  start, but nothing outside the pod/Service can reach port 53 through GKE's
  standard HTTP(S) Gateway. Only the web admin console is reachable.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for AdGuard Home are listed; every other input
is inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `adguardhome` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Deployment-tracking tag. Maps to the app-specific `ADGUARDHOME_VERSION` build ARG in the Dockerfile (not the generic `APP_VERSION`). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `min_instance_count` | `1` | Minimum replicas. |
| `max_instance_count` | `1` | Maximum replicas. |
| `container_port` | `3000` | The setup wizard's fixed port. **Not DNS port 53.** |
| `container_resources` | `{cpu_limit="1000m", memory_limit="512Mi"}` | Pod resource limits. |
| `enable_cloudsql_volume` | `false` | Not used — no database. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Public-facing by default — a UI, not an internal-only DB tool. |
| `workload_type` | `Deployment` | No StatefulSet needed; persistence is GCS Fuse. |

### Group 10 — IAP & VPC-SC

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Recommended to enable — puts Google identity auth in front of the DNS-filtering policy console. |

### Group 11 — Custom Domain & Networking

| Variable | Default | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `enable_custom_domain` | (foundation default) | Provision Ingress for custom hostnames + managed certificate. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Creates the always-provisioned `conf`/`work` buckets plus any in `storage_buckets`. |
| `gcs_volumes` | `[]` | Leave empty to use the module's own `conf`/`work` mounts. |

### Group 16 — Database Configuration

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — must not be changed. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` / `health_check_config` | HTTP `/` | No dedicated health endpoint; root returns 200 before and after setup. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No default job — AdGuard Home needs no database bootstrap. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |

### Group 7 — StatefulSet

Not used by default — persistence is via GCS Fuse volumes, not a block PVC.
`stateful_pvc_enabled` defaults `null` (off).

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way
to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach the AdGuard Home admin console (**not** a DNS resolver address). |
| `storage_buckets` | Created Cloud Storage buckets (`conf`, `work`). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_GKE](App_GKE.md) foundation engine, which validates values
> and combinations at plan time. Invalid configuration fails the **plan** with
> a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| Expecting real DNS resolution from this deployment | Do not rely on it | **Critical** | GKE's standard HTTP(S) Gateway pattern used by this module cannot expose raw port 53 TCP/UDP — clients pointed at this deployment's IP/hostname for DNS will get no response. A secondary raw L4 `Service type=LoadBalancer` for port 53 is possible in principle on GKE (unlike Cloud Run) but is explicitly out of scope for this module's first cut. |
| `container_port` changed without also changing the setup wizard's own web UI port | Keep both at `3000` | Critical | AdGuard Home's runtime web-UI port comes from `AdGuardHome.yaml` (set during setup) — if it diverges from `container_port`, the platform's health probe and public URL stop matching what the pod actually listens on, and the pod never becomes Ready after the first restart. |
| `database_type` | `NONE` (do not change) | Critical | AdGuard Home has no database integration; setting a real engine here has no effect but signals a misunderstanding of the module. |
| `gcs_volumes` | Leave empty (module default) | Critical | Overriding it without also mounting `conf`/`work` loses AdGuard Home's configuration and query history on every pod restart. |
| Admin console left with no IAP | Enable `enable_iap` | High | The admin console controls DNS filtering policy; an open, unauthenticated console lets anyone with the LoadBalancer IP reconfigure filtering or read query logs. |
| `workload_type` changed to `StatefulSet` | Keep `Deployment` (module default) | Medium | Not needed — persistence is GCS Fuse, not a block PVC; a StatefulSet adds complexity with no benefit here. |
| `memory_limit` below `512Mi` | Keep at `512Mi` | Medium | Undersized memory risks OOM kills under Autopilot's bin-packing. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, and image mirroring — see
**[App_GKE](App_GKE.md)**. AdGuard-Home-specific application configuration
shared with the Cloud Run variant is described in
**[AdGuardHome_Common](AdGuardHome_Common.md)**.
