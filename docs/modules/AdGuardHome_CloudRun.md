---
title: "AdGuard Home on Google Cloud Run"
description: "Configuration reference for deploying AdGuard Home on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# AdGuard Home on Google Cloud Run

> ⚠️ **CRITICAL — read before deploying.** AdGuard Home's core value is
> network-wide DNS ad/tracker blocking, which requires clients to query it over
> DNS on port 53 (TCP+UDP). **Cloud Run is HTTP(S)-only ingress and cannot
> expose raw port 53 under any configuration.** This module deploys AdGuard
> Home's **web admin console only** (port 3000) for filter-list, custom-rule,
> and client-settings configuration management. **The deployed instance is NOT
> reachable as a public DNS resolver on Cloud Run.** If you need AdGuard Home to
> actually resolve DNS queries for real clients, this module (as currently
> scoped) cannot do that — see [§6 Configuration Pitfalls](#6-configuration-pitfalls--sensible-defaults)
> for the full explanation and the (out-of-scope) workaround this module does
> not implement.

AdGuard Home is an open-source, GPL-3.0-licensed, network-wide DNS server that
blocks ads and trackers at the DNS level and includes parental controls. It is
a Go static binary with no external database — all configuration lives in a
flat YAML file written by its own first-run setup wizard. This module deploys
AdGuard Home's web admin console on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services AdGuard Home uses and how to explore
and operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress
and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, and the deployment lifecycle — refer to
the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them
here.

---

## 1. Overview

AdGuard Home runs as a single Go static-binary container on Cloud Run v2. The
deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single Go binary, 1 vCPU / 512 MiB by default, serverless autoscaling; scale-to-zero by default |
| Database | None | AdGuard Home has no external database — configuration is a flat YAML file |
| Object storage | Cloud Storage (×2, GCS Fuse) | `conf` bucket (config) and `work` bucket (query log/stats), both mounted as filesystem volumes |
| Secrets | Secret Manager | None generated — the admin credential is set through AdGuard Home's own first-run web wizard |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL (web admin console **only** — see the CRITICAL note above); optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **This deployment is a configuration-management console, not a DNS
  resolver.** Cloud Run cannot expose raw DNS (port 53 TCP/UDP). Do not point
  real DNS clients at this deployment's URL or IP.
- **No external database.** `database_type = "NONE"` and must not be changed.
- **Two GCS Fuse volumes are pre-wired and provisioned automatically** —
  `conf` at `/opt/adguardhome/conf` and `work` at `/opt/adguardhome/work` —
  so configuration and query-log/stats persist across restarts and cold
  starts. You do not need to set `gcs_volumes` yourself.
- **`container_port = 3000`** — AdGuard Home's setup wizard is hardcoded to
  listen on port 3000 until `AdGuardHome.yaml` exists. If you change the web
  UI's own port during the setup wizard, keep it at 3000 or the platform's
  health probe and public URL will stop matching what the container listens
  on.
- **Scale-to-zero by default** (`cpu_always_allocated = false`,
  `min_instance_count = 0`). This is a plain request/response admin console in
  this deployment shape, so idle cost is minimal.
- **No pre-seeded admin credential.** AdGuard Home's own first-run setup
  wizard, served at the deployment URL, is where you set the admin
  username/password — nothing is injected by the platform.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the AdGuard Home web admin console

AdGuard Home runs as a Cloud Run v2 service that autoscales by request load
between the minimum and maximum instance counts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs,
  and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud Storage (GCS Fuse) — config and query-log/stats

AdGuard Home stores its entire configuration in a flat YAML file
(`AdGuardHome.yaml`) and its query log / stats database under a separate
directory. Both are backed by dedicated Cloud Storage buckets mounted as GCS
Fuse filesystem volumes — `conf` and `work` — provisioned automatically.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~adguardhome"
  gcloud storage ls gs://<conf-bucket>/          # bucket names are in the Outputs
  gcloud storage cat gs://<conf-bucket>/AdGuardHome.yaml   # inspect the live config
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### C. Networking & ingress

The service is reachable at its `run.app` URL by default. **This is the web
admin console URL only — it is not a DNS server address.** An external HTTPS
load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered
on for the admin console.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

See [App_CloudRun](App_CloudRun.md).

### D. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

The entrypoint logs a DNS-scope reminder banner on every boot — visible in the
first lines of a fresh revision's log.

---

## 3. AdGuard Home Application Behaviour

- **No database bootstrap.** AdGuard Home has no external database, so there
  is no `initialization_jobs` default — the list is available for
  operator-supplied custom jobs only.
- **First-run setup wizard.** On first visit to the service URL (before
  `AdGuardHome.yaml` exists), AdGuard Home serves its own setup wizard on port
  3000: choose the admin web UI port (keep it 3000), set the admin
  username/password, and select upstream DNS servers. Nothing here is
  pre-seeded by the platform.
- **Health path.** Startup and liveness probes target `/` — there is no
  dedicated health endpoint; the root returns `200` both before and after
  initial setup.
- **DNS resolution is not reachable.** The container's own internal DNS
  listener may start, but nothing outside the revision can reach port 53 on
  Cloud Run. Only the web admin console (the container's exposed HTTP port) is
  reachable.
- **Inspect job execution** (if any custom init jobs were added):
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for AdGuard Home are listed; every other input
is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `adguardhome` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `AdGuard Home` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Deployment-tracking tag. Maps to the app-specific `ADGUARDHOME_VERSION` build ARG in the Dockerfile (not the generic `APP_VERSION`). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `512Mi` | Memory per instance. |
| `min_instance_count` | `0` | Scale-to-zero by default. |
| `max_instance_count` | `1` | Single instance — AdGuard Home has no multi-instance coordination concern for its own admin console, but do not scale beyond 1 unless you understand your GCS Fuse write pattern. |
| `container_port` | `3000` | The setup wizard's fixed port. **Not DNS port 53.** |
| `cpu_always_allocated` | `false` | Request-based billing — a plain admin-console app needs no background CPU. |
| `enable_cloudsql_volume` | `false` | Not used — no database. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public by default; the admin console has its own login. |
| `enable_iap` | `false` | Recommended to enable — puts Google identity auth in front of the DNS-filtering policy console. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Rarely needed — AdGuard Home reads config from its own YAML file. |
| `secret_environment_variables` | `{}` | No platform secrets exist for this app. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Creates the always-provisioned `conf`/`work` buckets plus any in `storage_buckets`. |
| `gcs_volumes` | `[]` | Leave empty to use the module's own `conf`/`work` mounts. |
| `enable_nfs` | `false` | Not used — persistence is via GCS Fuse. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — must not be changed. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No default job — AdGuard Home needs no database bootstrap. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/` | No dedicated health endpoint; root returns 200 before and after setup. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |

### Group 16 — Redis Cache

Not applicable — AdGuard Home does not use Redis. `enable_redis` defaults `false`.

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore
the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the web admin console (**not** a DNS resolver address). |
| `service_location` | Region the service runs in. |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (`conf`, `work`). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_CloudRun](App_CloudRun.md) foundation engine, which
> validates values and combinations at plan time. Invalid configuration fails
> the **plan** with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| Expecting real DNS resolution from this deployment | Do not rely on it | **Critical** | Cloud Run cannot expose raw port 53 TCP/UDP under any configuration — clients pointed at this deployment's IP/hostname for DNS will get no response. This module is scoped as a configuration-management console only. |
| `container_port` changed without also changing the setup wizard's own web UI port | Keep both at `3000` | Critical | AdGuard Home's runtime web-UI port comes from `AdGuardHome.yaml` (set during setup) — if it diverges from `container_port`, the platform's health probe and public URL stop matching what the container actually listens on, and the revision never becomes Ready after the first restart. |
| `database_type` | `NONE` (do not change) | Critical | AdGuard Home has no database integration; setting a real engine here has no effect but signals a misunderstanding of the module. |
| `gcs_volumes` | Leave empty (module default) | Critical | Overriding it without also mounting `conf`/`work` loses AdGuard Home's configuration and query history on every cold start / restart. |
| Admin console left with no IAP / open sign-up-equivalent | Enable `enable_iap` or restrict `ingress_settings` | High | The admin console controls DNS filtering policy; an open, unauthenticated console lets anyone reconfigure filtering or read query logs. |
| `min_instance_count = 0` (scale-to-zero) | Acceptable default | Low | Cold starts add a few seconds of latency to the first request after idle — fine for an admin console, unlike a real-time DNS resolver. |
| `memory_limit` below `512Mi` | Keep at `512Mi` (gen2 floor) | Medium | Cloud Run's gen2 execution environment rejects `memory_limit < 512Mi` outright at plan time. |

---

For the foundation behaviour referenced throughout — service identity,
scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. AdGuard-Home-specific application
configuration shared with the GKE variant is described in
**[AdGuardHome_Common](AdGuardHome_Common.md)**.
