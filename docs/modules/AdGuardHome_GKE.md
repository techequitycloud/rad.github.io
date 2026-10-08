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

## What AdGuard Home costs on RAD, and how that compares

**AdGuard Home on RAD's GKE Autopilot module costs about US$40 a month in a project you own, with no licence fee for the software itself.** RAD charges a one-off module fee of 40 credits (US$4 at the top-up price) in a project you own, and 36 credits (10% lower) in a project RAD manages. GKE suits AdGuard Home that must stay up continuously or scale across pods; for the lowest cost, the [Cloud Run module](AdGuardHome_CloudRun.md) runs the same AdGuard Home for about US$17 a month. Figures are as at 8 October 2026; sources are listed at the end of this section.

If you only need it occasionally — studying for a certification, a demo, a seasonal need — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that about US$40 a month becomes close to nothing instead. See **Pause it for free**, below.

### What you pay on RAD

You pay for three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 40 credits (US$4 at the top-up price) | 36 credits (10% lower) |
| Build time | A few credits, metered per minute of build time | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about US$40 a month for the default configuration (table below) | Metered hourly in credits; RAD publishes **63 credits a day**, about 1,890 a month (about US$189 at the top-up price, US$151 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 1x vCPU / 0.5 GiB | US$34.29 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | US$0 if this is your only Autopilot/zonal cluster on the billing account, otherwise about US$73 (shared across every GKE app in the project) |
| **Total** | **about US$40** |

### How it compares

- NextDNS's Pro plan — unlimited queries and devices, actually resolving DNS for your network, which this module's web-console-only deployment does not do — costs **£1.79/month** (about $2.30). That buys a turnkey resolving service; it does not buy you the self-hosted filter-list and client-settings console this module runs.
- **RAD runs the open-source project itself, not a vendor's hosted tenancy.** You get the same software, under your own (or RAD's) infrastructure, instead of a per-seat or per-usage subscription that grows independently of what you actually use.
- **Against a bare self-managed server:** It is a smaller workload than a standard 2 vCPU VPS, so running it yourself on a cheaper, smaller class than a Hetzner CPX22 or DigitalOcean 2 vCPU/4 GB Droplet (both about $24/month) would do, for noticeably less than that. RAD is not cheaper than that in cash terms — the difference is the managed database, Secret Manager and monitoring that come with the module instead of being your own job.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If AdGuard Home runs in **a project RAD manages for you**, you have an option that goes well beyond
scaling to zero: **delete the whole project, and restore it within 30 days for close to
nothing.** This suits occasional use — studying for a certification, a demo, a seasonal
need — far better than running AdGuard Home continuously.

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
- **One real gap: backups do not survive.** Anything AdGuard Home writes to a backup bucket inside the
  project is very likely gone as soon as you delete the project, even though the project itself
  is recoverable for 30 days — that bucket has Cloud Storage's soft-delete explicitly turned
  off. Anyone who has customised the deployment and wants to keep that work should copy a
  backup out (to Google Drive, or a bucket outside the project) before deleting. For a default
  install with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

This is the fallback for a project you own, or once the 30-day restore window above has
passed: **delete the deployment, and deploy it again when you next need it.**

- **What a redeploy costs.** The module fee again, plus the builds: roughly
  45 credits (about US$4.50) in your own project, or
  41 credits in a RAD-managed one, because RAD rebuilds the resources
  from scratch. Deleting saves money once AdGuard Home would otherwise sit unused long enough to clear that redeploy cost against its own running cost — roughly 3 days or more in your own project (US$1.34/day) or 1 days or more in a RAD-managed one (63 credits/day).
- **The GKE cluster itself is shared infrastructure.** If another application uses the same Autopilot cluster, deleting AdGuard Home alone saves only its own pod; the cluster management fee only drops once nothing else in the project needs it.
- **Keep your data first.** Anything AdGuard Home writes to a backup bucket inside the deployment is
  deleted with it — copy the latest backup out (to Google Drive, or a bucket you keep) before
  deleting if you want to keep it.
- **RAD does not recreate a deleted deployment for you.** You enter the settings again when
  you redeploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  AdGuard Home in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs AdGuard Home for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's fees and daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics; [NextDNS pricing](https://nextdns.io/pricing). Prices change; check each source before relying on a figure.

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
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |

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

<!-- related-guides -->

## Related guides

- [Hands-on lab: AdGuardHome on GKE Autopilot](../labs/AdGuardHome_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [AdGuard Home on Google Cloud Run](AdGuardHome_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [AdGuardHome Common — Shared Application Configuration](AdGuardHome_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Headscale on GKE Autopilot](Headscale_GKE.md), [TechnitiumDNS on GKE Autopilot](TechnitiumDNS_GKE.md), [Gatus on GKE Autopilot](Gatus_GKE.md) in the **Zero-trust Network & DNS** solution.
