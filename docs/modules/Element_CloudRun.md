---
title: "Element on Google Cloud Run"
description: "Configuration reference for deploying Element on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Element on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Element_CloudRun.png" alt="Element on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Element is the leading open-source (AGPLv3) [Matrix](https://matrix.org/) web
client — a self-hosted, end-to-end-encrypted messaging and collaboration app. This
module deploys Element on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

Element is a **static nginx single-page application (SPA)**: the browser talks
directly to a Matrix homeserver (such as Synapse or Dendrite) over HTTPS, so the
container itself holds no server-side state — no database, no Redis, no persistent
storage, and no secrets.

This guide focuses on the cloud services Element uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Element runs as a static nginx container on Cloud Run v2. The deployment wires
together a deliberately small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | nginx static SPA, 1 vCPU / 512 MiB by default, serverless autoscaling; scale-to-zero enabled |
| Container build | Cloud Build + Artifact Registry | Thin custom image `FROM vectorim/element-web` with a runtime `config.json` entrypoint |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |
| Secrets | — | **None.** Element requires no secrets |
| Database | — | **None.** The Matrix homeserver holds all state, not Element |
| Object storage | — | **None.** Element is stateless |

**Sensible defaults worth knowing up front:**

- **Element is stateless.** All chat state, encryption keys, and media live on the
  Matrix homeserver and in the user's browser. Element itself stores nothing
  server-side, so there is no database, Redis, GCS bucket, or Secret Manager secret.
- **The homeserver is runtime configuration.** `homeserver_url` / `homeserver_name`
  are written into `/app/config.json` by the container entrypoint on every start, so
  one image can point at any homeserver without a rebuild. Leaving them blank
  defaults to the public `matrix.org`.
- **Custom build with a pinned version.** `container_image_source = "custom"` builds
  a thin image over `vectorim/element-web`. `application_version = "latest"` resolves
  to the pinned known-good tag `v1.11.86` via an app-specific `ELEMENT_VERSION` build
  ARG.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). A static asset server costs nothing at idle and
  cold-starts in well under a second — cold starts are a non-issue for Element.
- **Public ingress by default.** `ingress_settings = "all"` makes the client UI
  reachable; Element performs its own login against the homeserver. Add IAP if you
  want a Google-identity gate in front of the UI.
- **Port 80.** nginx serves the SPA on port 80; probes target `/`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Element service

Element runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Container image — Cloud Build & Artifact Registry

The Element image is built by Cloud Build from a thin Dockerfile that layers a
`config.json`-generating entrypoint on top of `vectorim/element-web`, then pushed to
Artifact Registry. `application_version = "latest"` builds the pinned `v1.11.86`.

- **Console:** Cloud Build → History; Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/<project>/<repo> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for the build pipeline, image mirroring, and
retention policy.

### C. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress
settings and VPC egress control connectivity. Because Element is a static asset
server, it is a strong candidate for Cloud CDN.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### D. Identity-Aware Proxy (optional)

Element ships open by default so users can log in against the homeserver. To restrict
who can even load the client UI to your Google identities, enable IAP (`enable_iap = true`).

- **Console:** Security → Identity-Aware Proxy.
- **CLI:**
  ```bash
  gcloud iap web get-iam-policy --resource-type=backend-services --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for IAP setup and the OAuth consent screen.

### E. Cloud Logging & Monitoring

Container (nginx access/error) logs flow to Cloud Logging; Cloud Run metrics flow to
Cloud Monitoring, with an uptime check and check-failure alert provisioned when the
endpoint is publicly reachable.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting / Uptime checks.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Element Application Behaviour

- **Runtime config generation.** The container entrypoint writes `/app/config.json`
  on every start from `HOMESERVER_URL` / `HOMESERVER_NAME`, then hands off to nginx.
  Changing the homeserver is a redeploy with new env values — no image rebuild.
- **No database, no migrations.** Element serves static assets; there is no schema,
  no init job, and no first-boot migration window. The service is Ready as soon as
  nginx binds port 80.
- **Login is a browser-to-homeserver flow.** Element authenticates the user directly
  against the configured Matrix homeserver; there is no server-side session in the
  Cloud Run container and nothing to seed in Secret Manager.
- **Verify the injected homeserver.** Confirm the running revision's env matches your
  intended homeserver:
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
  Then open `$SERVICE_URL` — the login screen should show your homeserver, and
  `curl -s "$SERVICE_URL/config.json"` should return the JSON with your `base_url`.
- **Health path.** Startup and liveness probes target `/`, which nginx answers
  immediately and unauthenticated.
- **Upgrading Element.** Bump `application_version` (or pin a newer `element-web`
  tag) and redeploy; a new image builds and a new revision rolls out. Because Element
  reuses a version tag across rebuilds, the build's content-hash trigger drives the
  new image; verify the deployed revision's digest if a change seems stale.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Element are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `element` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `App_CloudRun Application` | Human-readable name shown in the Console. Not customised for Element in `variables.tf` — override with e.g. `"Element"` for a clearer display name. |
| `application_version` | `latest` | Element image tag; `latest` builds the pinned `v1.11.86`. Pin a specific `element-web` tag in production. |
| `homeserver_url` | `""` | Matrix homeserver base URL written into `config.json`. Blank → `matrix.org`. |
| `homeserver_name` | `""` | Matrix server name (delegation identity) advertised by Element. Blank → `matrix.org`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Builds the thin Element image via Cloud Build. |
| `container_image` | `""` | Override with a prebuilt/mirrored image URI. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `512Mi` | Memory per instance (gen2 floor is 512 MiB). |
| `container_port` | `80` | nginx listens on port 80. |
| `min_instance_count` | `0` | Scale-to-zero — a static server is free at idle. |
| `max_instance_count` | `3` | Autoscaling upper bound. |
| `cpu_always_allocated` | `false` | Request-based billing (cheaper) — Element does no background work. |
| `execution_environment` | `gen2` | Cloud Run execution environment. |
| `enable_cloudsql_volume` | `false` | No database — Auth Proxy not mounted. |
| `enable_image_mirroring` | `true` | Mirror the image into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public UI. Set `internal` to restrict to the VPC. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in to load the client UI. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra settings merged with the injected `HOMESERVER_URL` / `HOMESERVER_NAME`. |
| `secret_environment_variables` | `{}` | Secret Manager references. Element needs none. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation. |
| `secret_rotation_period` | `2592000s` | Rotation notification frequency. |

### Group 7 — Backup & Restore

Inherited from [App_CloudRun](App_CloudRun.md) and **no-ops for Element** (nothing to
back up). `backup_schedule`, `backup_retention_days`, `enable_backup_import`,
`backup_source`, `backup_uri`, `backup_format`.

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 9 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN — worthwhile for Element's static assets. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

Inherited and **not used by Element** (stateless). `create_cloud_storage`,
`storage_buckets` (empty), `enable_nfs` (`false`), `gcs_volumes` (empty),
`manage_storage_kms_iam`, `enable_artifact_registry_cmek`.

### Group 12 — Database

Inherited from [App_CloudRun](App_CloudRun.md) and **inert** — `Element_Common` sets
`database_type = "NONE"`. No Cloud SQL instance, user, or password is created.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Element declares no init jobs. |
| `cron_jobs` | `[]` | No platform-scheduled recurring tasks. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 10 s delay, 6 failures | Startup probe. |
| `liveness_probe` | HTTP `/` 15 s delay | Liveness probe. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Optional Cloud Monitoring uptime check (endpoint is public). |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis Cache & Queue

Inherited from [App_CloudRun](App_CloudRun.md) and **inert** — a static SPA has no
server-side cache or queue. `enable_redis`, `redis_host`, `redis_port`, `redis_auth`.

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (empty for Element). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of setup jobs (none for Element). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, an out-of-range `timeout_seconds`. Invalid configuration fails the **plan** with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `homeserver_url` / `homeserver_name` | Your real homeserver, or blank for matrix.org | High | A wrong or unreachable homeserver leaves users unable to log in — the UI loads but authentication fails. |
| `application_version` | Pin a real `element-web` tag | High | `latest` is not a valid `element-web` tag; the module pins `v1.11.86`, but a hand-set `latest` in a raw build ARG would fail with `MANIFEST_UNKNOWN`. |
| `ingress_settings` | `all` for public UI | High | `internal` makes the client UI unreachable from browsers outside the VPC. |
| `container_image_source` | `custom` | High | Switching to `prebuilt` with an image that lacks the `config.json` entrypoint ships Element pointed at the wrong homeserver (or none). |
| `memory_limit` | `512Mi` | Medium | The gen2 execution environment rejects anything below 512 MiB at plan time, regardless of billing mode. |
| `enable_iap` | Enable to gate the UI | Medium | Without IAP anyone with the URL can load the client (they still need homeserver credentials to log in). |
| `enable_cdn` | Enable for public deployments | Low | Serving static assets straight from Cloud Run misses an easy latency/egress win. |
| Database / Redis / Backup inputs | Leave default | Low | Inert for Element; setting them has no effect. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**.
Element-specific application configuration shared with the GKE variant is described
in **[Element_Common](Element_Common.md)**.
