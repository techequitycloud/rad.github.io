---
title: "TechnitiumDNS on Google Cloud Run"
description: "Configuration reference for deploying TechnitiumDNS on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# TechnitiumDNS on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/TechnitiumDNS_CloudRun.png" alt="TechnitiumDNS on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

> ⚠️ **Scoping disclosure:** this module deploys Technitium's **web admin console + REST API only**
> (port 5380/HTTP). Technitium's core DNS resolver function (port 53/udp+tcp) **cannot** be exposed
> through Cloud Run's HTTP(S)-only ingress. No client anywhere can query this deployment as a DNS
> resolver. See §1 and §7 below for the full explanation.

Technitium DNS Server is a self-hosted, open-source, cross-platform authoritative and recursive DNS
server (.NET) with a full-featured web admin console and REST API for managing zones, records,
DNS-based ad/tracker blocking, conditional forwarding, and DNS-over-HTTPS/TLS. This module deploys the
official `technitium/dns-server` image on **Cloud Run v2**, unmodified, on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud
infrastructure.

This guide focuses on the cloud services TechnitiumDNS uses and how to explore and operate them from the
Google Cloud Console and the command line. For the mechanics common to every Cloud Run application —
service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

TechnitiumDNS runs as a single prebuilt container on Cloud Run v2. The deployment wires together a
deliberately small set of Google Cloud services — TechnitiumDNS has no database or cache dependency of
its own:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Single prebuilt container, 500m vCPU / 512 MiB by default; request-based billing, scales to zero |
| Database | **None** | `database_type = "NONE"`; zones/settings/logs are local flat files, no Cloud SQL provisioned |
| Persistence | Cloud Storage (GCS FUSE) | Config bucket mounted at `/etc/dns`; survives restarts and redeploys |
| Object storage | Cloud Storage | One auto-created "config" bucket (also the persistence layer above) |
| Cache / queue | **None** | No Redis; TechnitiumDNS needs no external cache |
| Secrets | Secret Manager | One auto-generated secret: `DNS_SERVER_ADMIN_PASSWORD` |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL for the **web console only** — port 53 is never exposed |

**Sensible defaults worth knowing up front:**

- **No database is provisioned.** `database_type = "NONE"` — TechnitiumDNS keeps zones, settings, and
  logs as local flat files under `/etc/dns`. The database-related variables exist for completeness but
  are inert.
- **Persistent by default.** A GCS FUSE volume is mounted at `/etc/dns` automatically — config, zones,
  and logs survive restarts and redeploys with no extra configuration.
- **Prebuilt image, no custom Dockerfile.** `container_image_source = "prebuilt"` deploys
  `technitium/dns-server` as-is — verified locally to boot cleanly and honour
  `DNS_SERVER_ADMIN_PASSWORD` / `DNS_SERVER_DOMAIN` on first start.
- **Scales to zero by default** (`min_instance_count = 0`, `cpu_always_allocated = false`) — the admin
  console is a plain request/response app with no background scheduler or WebSocket stream.
- **The health endpoint is `/`**, the console's unauthenticated root page, which returns HTTP 200 with
  the full console HTML as soon as the server binds its port.
- **One auto-generated secret.** `DNS_SERVER_ADMIN_PASSWORD` bootstraps the initial `admin` account on
  the very first boot only; later restarts ignore it (the persisted `auth.config` wins).
- **No DNS resolver.** See §7 below — this is the single most important thing to understand before
  deploying this module.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the TechnitiumDNS console service

TechnitiumDNS runs as a Cloud Run v2 service. Each deployment creates an immutable revision; traffic can
be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and traffic
splitting.

### B. Persistence — the config Cloud Storage bucket

TechnitiumDNS has **no Cloud SQL instance**. All zones, settings, the auth database, and logs live under
`/etc/dns`, backed by a GCS FUSE-mounted Cloud Storage bucket created for this deployment.

- **Console:** Cloud Storage → Buckets → find the bucket named `gcs-<service-name>-config`.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~-config"
  gcloud storage ls "gs://<bucket-name>/"
  ```

See [App_CloudRun](App_CloudRun.md) for the GCS FUSE volume mount model.

### C. Secret Manager

TechnitiumDNS generates exactly one secret at deploy time: the initial admin password.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default — this is the **web console URL**, not a DNS
endpoint. An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered
on for the console; none of this exposes DNS resolution (port 53).

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring, with optional uptime
checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. TechnitiumDNS Application Behaviour

- **No first-deploy database setup.** TechnitiumDNS has no external database and no migration step. It
  reads/writes local flat files under `/etc/dns` from the moment it boots.
- **First-boot admin bootstrap.** `DNS_SERVER_ADMIN_PASSWORD` is applied only when `/etc/dns/auth.config`
  does not yet exist (a genuinely fresh deployment). On every later restart or redeploy, the persisted
  `auth.config` on the GCS-mounted volume wins and the injected password is ignored.
- **Health path.** Startup and liveness probes target `/`, which returns HTTP 200 with the full console
  HTML as soon as the server binds port 5380. Verify:
  ```bash
  SERVICE_URL=$(gcloud run services describe <service-name> \
    --project "$PROJECT" --region "$REGION" --format='value(status.url)')
  curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "$SERVICE_URL/"   # expect 200 and a large body
  ```
- **Log in.** Open `$SERVICE_URL` in a browser, sign in as `admin` with the Secret-Manager-stored
  password, and change it immediately from the console's own user-management page (Technitium does not
  re-read `DNS_SERVER_ADMIN_PASSWORD` after first boot, so changing it there is the only way to rotate
  it going forward).
- **REST API.** All console actions are also available over the REST API
  (`$SERVICE_URL/api/...`) using a session token obtained via `/api/user/login`. See
  [Technitium's API docs](https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md).
- **No DNS resolution from this deployment.** See §7 below.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or
notable for TechnitiumDNS are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 / 3 — Deployment Environment & Application Identity

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `application_name` | `technitiumdns` | Base name for the service, registry repo, and secrets. Do not change after first deploy. |
| `application_display_name` | `TechnitiumDNS` | Human-readable name shown in the Console. |
| `application_version` | `latest` | TechnitiumDNS image version tag (e.g. `latest`, `13.5.1`). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision supporting infrastructure only. |
| `container_image_source` | `prebuilt` | Deploys the official image as-is; `custom` accepted for forward-compatibility but no Dockerfile ships. |
| `cpu_limit` | `500m` | CPU per instance. |
| `memory_limit` | `512Mi` | Memory per instance (gen2 floor is 512Mi). |
| `min_instance_count` | `0` | Scales to zero when idle. |
| `max_instance_count` | `1` | Maximum instances. |
| `container_port` | `5380` | The web console's default port. |
| `cpu_always_allocated` | `false` | Request-based billing — no background work to keep warm for. |
| `enable_cloudsql_volume` | `false` | Off — TechnitiumDNS has no database. |
| `enable_image_mirroring` | `true` | Mirror the TechnitiumDNS image into Artifact Registry. |

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public console access by default. |
| `enable_iap` | `false` | Require Google sign-in. **Strongly recommended** — the console otherwise relies solely on its own admin password. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra `DNS_SERVER_*` settings (e.g. `DNS_SERVER_FORWARDERS`, `DNS_SERVER_DOMAIN`). |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (additional secrets; `DNS_SERVER_ADMIN_PASSWORD` is already wired). |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Additional GCS buckets to mount; the config bucket at `/etc/dns` is auto-added. |
| `storage_buckets` | `[]` | Additional buckets beyond the auto-created config bucket. |
| `enable_nfs` | `false` | Not needed by default — the GCS volume at `/etc/dns` already persists state. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | TechnitiumDNS has no external database; leave `NONE`. |
| `application_database_name` / `application_database_user` | `technitiumdns` | Inert — no database is provisioned. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | TechnitiumDNS needs no init job; leave empty. |
| `cron_jobs` | `[]` | Optional scheduled Cloud Run jobs. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 20s delay | Startup probe targeting the console's public root page. |
| `liveness_probe` | HTTP `/` 30s delay | Liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Optional Cloud Monitoring uptime check. |

### Group 16 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not required — TechnitiumDNS has no Redis dependency. |

All other inputs follow standard [App_CloudRun](App_CloudRun.md) behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the web console (not a DNS endpoint). |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` / `database_name` / `database_user` | Database identifiers — empty for the default `NONE` engine. |
| `database_password_secret` / `database_host` / `database_port` | Database endpoint fields — unused for `NONE`. |
| `storage_buckets` | Created Cloud Storage buckets (the config bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any setup jobs (none by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the
> [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan
> time. Invalid configuration fails the **plan** with a clear, named error before any resource is
> created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| Expecting this to be a DNS resolver | Do not point client DNS settings at this deployment | **Critical** | Port 53/udp+tcp is never exposed by Cloud Run's HTTP(S)-only ingress — DNS queries against this deployment simply fail; only the web console/API is reachable. |
| `enable_iap` | `true` for anything beyond a quick test | Critical | Without IAP, the console is protected only by its own admin password over the public internet — a single leaked/weak credential grants full DNS-management access. |
| `DNS_SERVER_ADMIN_PASSWORD` rotation | Change the password from the console after first login | High | Technitium never re-reads the env var after first boot — rotating the Secret Manager value alone does NOT change the effective console password. |
| GCS volume at `/etc/dns` | Leave `enable_gcs_storage_volume` enabled (default) | Critical | Without a mounted persistent volume, Cloud Run's read-only root filesystem would prevent any config/zone change from surviving a restart or redeploy. |
| `ingress_settings` | `all` for console access, `internal` behind IAP/VPN only if that's the intent | Medium | `internal` blocks all external access to the console, including the operator, unless a VPN/bastion path exists. |
| `min_instance_count` | `0` (default) is fine for occasional admin use | Low | Cold starts add a few seconds of latency on the first request after idling; bump to `1` only if that matters. |
| `application_version` | Pin an explicit version in production | Low | `latest` tracks upstream releases; pin explicitly to control upgrade timing. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency, ingress
and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring —
see **[App_CloudRun](App_CloudRun.md)**. TechnitiumDNS-specific application configuration shared with the
GKE variant is described in **[TechnitiumDNS_Common](TechnitiumDNS_Common.md)**.
