---
title: "Excalidraw on Google Cloud Run"
description: "Configuration reference for deploying Excalidraw on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Excalidraw on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Excalidraw_CloudRun.png" alt="Excalidraw on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Excalidraw is an open-source (MIT) virtual whiteboard for sketching hand-drawn-style
diagrams, wireframes, and quick collaborative drawings. The self-hosted distribution
is a **static single-page application served by nginx** — there is no backend,
database, or user accounts, and drawings are stored in the visitor's own browser. This
module deploys that static frontend on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services Excalidraw uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling and
concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, and
the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md)
rather than repeating them here.

---

## 1. Overview

Excalidraw runs as a single stateless nginx container on Cloud Run v2. Because the app
has no backend, the deployment wires together only a minimal set of Google Cloud
services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Static nginx container on **port 80**, 1 vCPU / 512 MiB by default, serverless autoscaling; scale-to-zero enabled |
| Container image | Artifact Registry | Thin custom build `FROM excalidraw/excalidraw`, mirrored into the project registry |
| Database | _None_ | Excalidraw has no backend — no Cloud SQL instance is created |
| Object storage | _None_ | No GCS bucket is provisioned; drawings live in the browser |
| Cache & queue | _None_ | No Redis, no message queue |
| Secrets | _None_ | No encryption keys, JWT secrets, or DB passwords — Secret Manager is unused |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **Fully stateless — no data is stored server-side.** Drawings persist in each
  browser's local storage and are exported/imported as `.excalidraw` files. Redeploys,
  scale-to-zero, and revision changes lose **no** server data because there is none.
- **Scale-to-zero is forced on.** The wrapper pins `min_instance_count = 0`; there is
  no background work to keep an instance warm, so idle deployments cost nothing. Cold
  starts are fast (nginx serving a static bundle) — typically sub-second.
- **Request-based billing by default.** `cpu_always_allocated = false`: CPU is billed
  only while a request is being served, appropriate for a static file server with no
  in-process background work.
- **Fixed port 80.** The nginx listener is baked into the image; `container_port`
  defaults to 80 and should not be changed.
- **No Cloud SQL, Secret Manager, Redis, or GCS.** The corresponding foundation
  features are inert for this app — enabling them provisions unused infrastructure.
- **Public ingress by default.** `ingress_settings = "all"` so the whiteboard is
  reachable from a browser. Front it with IAP or Cloud Armor if you need to restrict
  access.
- **Vestigial `homeserver_url` / `homeserver_name` inputs.** Carried over from the
  Element template and injected as `HOMESERVER_URL` / `HOMESERVER_NAME`; the Excalidraw
  static SPA ignores them. Leave them at their defaults.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Excalidraw service

Excalidraw runs as a Cloud Run v2 service that autoscales by request load between the
minimum (`0`) and maximum instance counts. Each deployment creates an immutable
revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~excalidraw"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the listening port and image on the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].ports[0].containerPort, spec.template.spec.containers[0].image)'
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Artifact Registry — the container image

The Excalidraw image is a thin custom build `FROM excalidraw/excalidraw` that Cloud
Build produces and pushes into the project's Artifact Registry (`enable_image_mirroring
= true`). No Docker Hub pull is needed at runtime.

- **Console:** Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list <repo-path> --include-tags
  # Cloud Build history for the image build:
  gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
  ```

### C. Database, Secret Manager, Cloud Storage, Redis — not used

Excalidraw provisions **none** of these. There is no Cloud SQL instance, no Secret
Manager secret, no GCS bucket, and no Redis for this deployment. The following will
return empty results for the app — that is expected:

```bash
gcloud sql instances list --project "$PROJECT" --filter="name~excalidraw"   # (none)
gcloud secrets list --project "$PROJECT" --filter="name~excalidraw"          # (none)
gcloud storage buckets list --project "$PROJECT" --filter="name~excalidraw"  # (none)
```

If you need multi-user real-time collaboration (a live shared canvas), Excalidraw
requires a separate `excalidraw-room` WebSocket server, which this module does **not**
deploy.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress
settings and VPC egress control connectivity. Because the payload is static assets,
Cloud CDN is a particularly good fit for reducing latency and cost.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging & Monitoring

Container (nginx access/error) logs flow to Cloud Logging; Cloud Run metrics flow to
Cloud Monitoring, with optional uptime checks and alert policies. A public root-path
uptime check is a natural health signal for the static frontend.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Excalidraw Application Behaviour

- **No first-deploy setup.** There is no database, no init job, and no migrations. The
  service is ready as soon as nginx starts serving the static bundle — usually within a
  second or two of the revision becoming active.
- **No accounts, no login, no server persistence.** The self-hosted frontend has no
  authentication and stores nothing server-side. Each user's drawings live in **their
  own browser's local storage**; clearing browser data loses local drawings. Use
  **Export** (`.excalidraw`, PNG, or SVG) to save or share work.
- **Real-time collaboration is not included.** The live "shareable link" collaboration
  feature depends on a separate `excalidraw-room` WebSocket service that this module
  does not deploy. Single-user editing works out of the box.
- **Health path.** Startup and liveness probes target the root `/`, which nginx answers
  with `200` immediately. Verify from a browser or:
  ```bash
  SERVICE_URL=$(gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)')
  curl -sI "$SERVICE_URL/" | head -1          # expect: HTTP/2 200
  ```
- **Version upgrades are a rebuild + redeploy.** Bumping `application_version` rebuilds
  the image from a new `excalidraw/excalidraw` tag and rolls out a new revision; because
  there is no state, upgrades and rollbacks are trivial and non-destructive.
- **Vestigial env vars.** `HOMESERVER_URL` / `HOMESERVER_NAME` are injected (Element
  carry-over) but ignored by the static SPA. Setting them has no effect.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Excalidraw are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `excalidraw` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Excalidraw image tag; resolves to a pinned known-good tag when `latest`. Pin a specific release in production. |
| `homeserver_url` / `homeserver_name` | `""` | **Vestigial** Element carry-over — ignored by the Excalidraw SPA. Leave blank. |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Keep `custom` — the thin build mirrors the static image into Artifact Registry. |
| `cpu_limit` | `1000m` | CPU per instance; a static file server needs little. |
| `memory_limit` | `512Mi` | Memory per instance. Gen2 imposes a 512 MiB floor; the static bundle uses far less. |
| `cpu_always_allocated` | `false` | Request-based billing — correct for a static server with no background work. |
| `container_port` | `80` | nginx listener port; baked into the image — do not change. |
| `min_instance_count` | `0` | Forced to `0` by the wrapper — scale-to-zero, no warm instance needed. |
| `max_instance_count` | `3` | Cost/concurrency ceiling. |
| `enable_image_mirroring` | `true` | Mirror the Excalidraw image into Artifact Registry. |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra plain-text env vars. The static SPA reads none at runtime; overrides are rarely useful. |
| `secret_environment_variables` | `{}` | Unused — Excalidraw needs no secrets. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public access so the whiteboard is browser-reachable. |
| `enable_iap` | `false` | Put Google sign-in in front of Excalidraw to restrict access. |

All other inputs follow standard App_CloudRun behaviour.

### Groups 10–21 — Storage, Database, Redis

These groups are **inert** for Excalidraw: there is no database (`database_type = NONE`),
no GCS bucket, and no Redis. Leaving `enable_nfs`, `enable_redis`, `create_cloud_storage`,
and the database inputs at their defaults provisions no unused infrastructure. All other
inputs follow standard App_CloudRun behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running
resources. Storage/database/secret outputs are present for interface parity with other
modules but resolve to empty values here.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets — empty for Excalidraw. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Setup job names — empty for Excalidraw. |
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
> combinations* at plan time — an out-of-range port, a `gen1` runtime with NFS/GCS
> mounts, IAP with no authorized identities. Invalid configuration fails the **plan**
> with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `container_port` | `80` | High | The image's nginx listens only on 80; a mismatched port means the startup probe never passes and the revision never serves. |
| `container_image_source` | `custom` | High | Switching to `prebuilt` without a mirrored image points the service at an unbuilt Artifact Registry path (`Image not found`). |
| `memory_limit` | `512Mi` | Medium | Gen2 rejects `< 512Mi` at apply; the static bundle needs no more. |
| `ingress_settings` | `all` | Medium | `internal` makes the whiteboard unreachable from a browser outside the VPC. |
| `application_version` | pin in production | Medium | `latest` floats — a new upstream tag can change UI/behaviour on the next rebuild. Pin a release. |
| `enable_redis` / database inputs | leave default | Low | Enabling them provisions Redis/Cloud SQL that Excalidraw never uses — wasted cost, no benefit. |
| `homeserver_url` / `homeserver_name` | leave blank | Low | Vestigial Element inputs; setting them has no effect on the Excalidraw SPA. |
| `min_instance_count` | `0` | Low | Scale-to-zero is ideal here; forcing `> 0` only adds idle cost with no state to keep warm. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud CDN, Cloud Armor, IAP, Binary
Authorization, VPC-SC, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**.
Excalidraw-specific application configuration shared with the GKE variant is described
in **[Excalidraw_Common](Excalidraw_Common.md)**.
