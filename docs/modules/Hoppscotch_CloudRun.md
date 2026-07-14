---
title: "Hoppscotch on Google Cloud Run"
description: "Configuration reference for deploying Hoppscotch on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Hoppscotch on Google Cloud Run

Hoppscotch is an open-source, Postman-style API development platform for designing,
sending, and inspecting HTTP, GraphQL, and WebSocket requests from the browser. This
module deploys the **self-hosted Hoppscotch frontend** as a stateless single-page app
on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which
provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Hoppscotch uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load balancing,
scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Hoppscotch runs as a static single-page web app (served by Caddy) in a container on
Cloud Run v2. It is deliberately **stateless** — no database, no cache, no persistent
storage — so the deployment wires together a small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Static SPA container on port 3000; 1 vCPU / 512 MiB by default; scale-to-zero |
| Container image | Artifact Registry + Cloud Build | Thin custom build `FROM hoppscotch/hoppscotch-frontend`, tag mirrored into Artifact Registry |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |
| Secrets | Secret Manager | **None app-specific** — Hoppscotch requires no secrets |
| Observability | Cloud Logging & Monitoring | Container logs, metrics, optional uptime check and alerts |

Services that are deliberately **not** used: **Cloud SQL** (`database_type = "NONE"`),
**Cloud Storage** (no buckets), and **Redis** (off by default; the static frontend has
no server-side rate-limiting or queue to back).

**Sensible defaults worth knowing up front:**

- **No database, ever.** `database_type = "NONE"` and `enable_cloudsql_volume = false`.
  Hoppscotch keeps all collections, environments, and history in **browser local
  storage**, so there is no server-side state. Setting a database type only wastes
  money on an idle Cloud SQL instance — the GKE variant even blocks it at plan time.
- **The frontend-only image is used on purpose.** The all-in-one
  `hoppscotch/hoppscotch` image bundles a NestJS backend that `exit(1)`s without a
  `DATABASE_URL`. This module uses `hoppscotch/hoppscotch-frontend`, which serves the
  SPA on port 3000 with no backend requirement.
- **`HOPPSCOTCH_VERSION`, not `APP_VERSION`, pins the image.** A custom build sets an
  app-specific `HOPPSCOTCH_VERSION` ARG so the Foundation's injected `APP_VERSION`
  does not overwrite the tag; `application_version = "latest"` resolves to a pinned,
  known-good tag at build time.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`). The first
  request after idle incurs a cold start of a few seconds. Because the app is a static
  SPA with no warm-up work, cold starts are cheap; set `min_instance_count = 1` only
  if you want to eliminate that first-request latency.
- **Request-based billing by default** (`cpu_always_allocated = false`). Hoppscotch
  does no in-process background work, so CPU is billed only while serving a request.
- **Public ingress by default.** `ingress_settings = "all"` exposes the `run.app` URL.
  Enable IAP to require Google sign-in for internal/organisation-only deployments.
- **No secrets and no storage buckets** are provisioned by this module.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Hoppscotch service

Hoppscotch runs as a Cloud Run v2 service that autoscales by request load between the
minimum (`0`) and maximum instance counts. Each deployment creates an immutable
revision; traffic can be split across revisions for safe rollouts. The container
listens on **port 3000** and answers `GET /` with the app UI (HTTP 200).

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~hoppscotch"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the injected port and env of the live revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].ports,spec.template.spec.containers[0].env)'
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Container image — Artifact Registry & Cloud Build

Because `container_image_source = "custom"`, the image is built by Cloud Build from
the thin `Dockerfile` (`FROM hoppscotch/hoppscotch-frontend:${HOPPSCOTCH_VERSION}`)
and pushed to Artifact Registry (image mirroring is on by default to avoid Docker Hub
rate limits).

- **Console:** Artifact Registry → Repositories; Cloud Build → History.
- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
  gcloud artifacts docker images list \
    "$REGION-docker.pkg.dev/$PROJECT/<repo>" --project "$PROJECT" \
    --include-tags --filter="package~hoppscotch"
  ```

The repository name and image URI are in the [Outputs](#5-outputs)
(`artifact_registry_repository`, `container_image`).

### C. Secret Manager

Hoppscotch provisions **no application secrets** — `secret_ids` is empty. You can
still map your own env-var-to-secret references through `secret_environment_variables`
if you extend the deployment, but nothing is required.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~hoppscotch"
  ```

See [App_CloudRun](App_CloudRun.md) for secret injection and rotation details.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = "all"`).
An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can
be layered on; ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring, with
optional uptime checks and alert policies. An uptime check against `/` confirms the
SPA is serving.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Hoppscotch Application Behaviour

- **No first-deploy database setup.** There is no `db-init` job, no Cloud SQL
  instance, and no schema. The container serves a static bundle immediately.
- **No server-side persistence.** Collections, environments, request history, and
  settings live in **browser local storage** on each user's machine. Redeploying,
  scaling to zero, or rolling out a new revision loses no user data — there is none on
  the server to lose.
- **No immutable keys.** With no secrets and no database, there is no cryptographic
  material that could corrupt stored data if changed. Rotations are a non-issue.
- **Health path.** Startup and liveness probes target the root `/`, which returns the
  app UI (HTTP 200) as soon as Caddy binds port 3000 — typically within seconds. A
  failing probe almost always means the image tag is invalid, not that a backend is
  unreachable.
- **No first-run admin account.** The self-hosted frontend has no login or user
  management of its own; open the URL and start building requests. (Team workspaces,
  which do require the backend + database, are intentionally out of scope for this
  module.)
- **Scaling is unconstrained.** Because there is no shared queue or database, any
  number of instances can run independently — increase `max_instance_count` freely as
  a cost/throughput ceiling.
- **Verify the running revision:**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  curl -sS -o /dev/null -w '%{http_code}\n' "$(gcloud run services describe <service-name> \
    --region "$REGION" --format='value(status.url)')/"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Hoppscotch are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `hoppscotch` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Hoppscotch` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Hoppscotch image tag; `latest` resolves to a pinned known-good `hoppscotch-frontend` tag at build time. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision supporting infrastructure only. |
| `container_image_source` | `custom` | Thin custom build `FROM hoppscotch/hoppscotch-frontend`. Keep `custom`. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `512Mi` | Memory per instance; ≥ 256Mi (gen2 floor is 512Mi). |
| `cpu_always_allocated` | `false` | Request-based billing — Hoppscotch does no background work. |
| `container_port` | `3000` | The port the frontend SPA listens on. |
| `min_instance_count` | `0` | Scale-to-zero; set `1` to avoid cold starts. |
| `max_instance_count` | `3` | Cost/throughput ceiling; safe to raise (no shared state). |
| `execution_environment` | `gen2` | Recommended for faster startup and networking. |
| `timeout_seconds` | `60` | Maximum request duration (0–3600). |
| `enable_cloudsql_volume` | `false` | Hoppscotch has no database — leave `false`. |
| `enable_image_mirroring` | `true` | Mirror the image into Artifact Registry (avoids Docker Hub limits). |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public `run.app` URL. Use `internal` / IAP for private deployments. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in in front of Hoppscotch. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Optional extra plain-text env vars (e.g. `{ PORT = "3000" }`). None are required. |
| `secret_environment_variables` | `{}` | Optional env var → Secret Manager references. None are required. |

All other inputs follow standard App_CloudRun behaviour.

### Group 21 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Off by default. The static frontend has no server-side queue or rate limiter, so leave disabled. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Only relevant if you wire Redis in for a custom purpose. |

All other inputs follow standard App_CloudRun behaviour.

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
| `storage_buckets` | Created Cloud Storage buckets (empty — Hoppscotch is stateless). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of setup jobs (empty — no DB bootstrap). |
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
> [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and
> combinations* at plan time — IAP with no authorized identities, a `gen1` runtime
> with NFS/GCS mounts, out-of-range `timeout_seconds`/`redis_port`. Invalid
> configuration fails the **plan** with a clear, named error before any resource is
> created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `container_image_source` | `custom` | High | Switching to `prebuilt` points the service at an unbuilt Artifact Registry path (`Image not found`); Hoppscotch requires the custom `hoppscotch-frontend` build. |
| `application_version` | `latest` or a real `hoppscotch-frontend` tag | High | An invalid tag makes the Cloud Build fail (`MANIFEST_UNKNOWN`); the service then runs a stale or missing image. |
| `enable_cloudsql_volume` | `false` | Medium | Enabling it mounts an Auth Proxy sidecar for a database that does not exist — wasted cost and a needless dependency. |
| `container_port` | `3000` | High | The frontend serves only on 3000; a mismatched port fails the startup probe and the revision never becomes Ready. |
| `memory_limit` | `512Mi` | Medium | Below 512Mi is rejected under the gen2 execution-environment floor; the plan/apply fails. |
| `enable_iap` | `false` for public use | High | Enabling IAP without OAuth credentials silently exposes or blocks the app; enabling it deliberately requires Google sign-in for every request. |
| `min_instance_count` | `0` (or `1` for no cold start) | Low | Scale-to-zero adds a small cold-start delay to the first request after idle; harmless for a static SPA. |
| `enable_redis` | `false` | Low | The static frontend has no server-side queue; enabling Redis adds cost with no benefit. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Hoppscotch-specific application configuration
shared with the GKE variant is described in
**[Hoppscotch_Common](Hoppscotch_Common.md)**.
