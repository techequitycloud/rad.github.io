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

## What Excalidraw costs on RAD, and how that compares

**In a Google Cloud project you own, Excalidraw on RAD's Cloud Run module costs about US$17 a month, plus US$4 once per deployment and no per-user licence.** GKE Autopilot is the alternative for workloads that must stay up continuously or run beside other Kubernetes apps; see the [GKE guide](Excalidraw_GKE.md), about US$24 a month. Excalidraw is a static, open-source whiteboard for hand-drawn-style diagrams, with no database, Redis or persistent storage of its own. Figures are as at 8 October 2026; sources are listed at the end of this section.

If this runs in a project RAD manages for you, it can be deleted and restored within 30 days for a few credits instead of sitting there running — so an occasional-use deployment costs a few dollars a month, not US$17. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 40 credits (US$4 at the top-up price) | 36 credits (10% lower) |
| Build time | A few credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$17 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **3 credits a day**, about 90 a month (about US$9 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1 vCPU / 0.5 GiB, scaling to zero | US$11 |
| Cloud NAT gateway and IP address | US$5 |
| Cloud Storage for backups | US$1 |
| **Total** | **about US$17** |


### How it compares

We could not find a commercial managed/SaaS plan specifically for Excalidraw itself as at 8 October 2026, so the honest comparison is against running it yourself:

| Option | Per month | Who runs it |
|---|---|---|
| Hetzner CPX22 (2 vCPU/4GB) | ~US$24 | You: OS, updates, backups, security patches |
| DigitalOcean 2 vCPU/4GB Droplet | US$24 | You: OS, updates, backups, security patches |
| GCP Compute Engine e2-standard-2 (2 vCPU/8GB) | ~US$49 | You: OS, updates, backups, security patches |
| **RAD, Cloud Run, your own project** | **US$17**, plus US$4 once | RAD's automation, in your project |
| RAD, GKE Autopilot | about US$24; see the [GKE Autopilot guide](Excalidraw_GKE.md) | RAD |

Excalidraw's own footprint here (1 vCPU / 0.5 GiB) is lighter than that reference box, so a smaller, cheaper tier from the same providers would comfortably run it too.

- **RAD is usually not cheaper in cash than a bare VPS — the difference is what is managed for you.** A VPS price does not include the admin's own time for backups, security patches and OS upgrades; RAD's managed Cloud SQL (where this app uses a database), Secret Manager and monitoring cover that instead.
- **Excalidraw is a static, open-source whiteboard for hand-drawn-style diagrams, with no database, Redis or persistent storage of its own.** That shapes which column matters: predictable, hands-off operation is worth more to most teams running this kind of tool than shaving a few dollars off the monthly bill.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Excalidraw runs in **a project RAD manages for you**, you have an option beyond scaling down: **delete the whole project, and restore it within 30 days for close to nothing.** This suits a deployment you only need occasionally — studying for a certification, a demo, a seasonal need — far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google to delete the project. Google does not remove it immediately: it keeps it, recoverable, for 30 days, and because billing is already unlinked, nothing is charged while it waits. Unlike deleting one module, this does not tear down Cloud Run one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's owner can restore it. RAD asks Google to undelete the project and reattaches its billing account, then asks you to run **Update** on each deployment to confirm everything came back. Because nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a rebuild, and an Update never charges the module fee again. That costs a handful of build-time credits in total (under US$1) for a typical 2–3-deployment chain.
- **So a month of occasional use can cost a few dollars, not US$17.** Deploy Excalidraw, use it for a session, delete the project. Restore it next time you want it, confirm with Update, and delete it again when you're done. You pay only for the module fee once, the builds, and whatever hours it was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages billing for), and you restore it yourself within the 30 days — after that, Google deletes it for good. Restoring is admitted like creating a new project: your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier most study/demo use fits). Google says most services are fully working again within 36 hours of a restore.

### Pay only while you use it, the other way: delete and redeploy

Cloud Run already scales to zero between requests, so most of its own compute cost stops on its own when nobody is using it. The option above only applies to a RAD-managed project; **in your own project, or once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 45 credits (US$4.50). Deleting saves money if Excalidraw would otherwise sit unused for about 9 days or more in your own project (about US$0.56 a day), or about 14 days or more in a RAD-managed one (3 credits a day).
- **Note your settings.** RAD does not recreate a deleted deployment for you; you enter the settings again when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets Excalidraw in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either the trainer funds every place, or each participant pays for their own. Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's own fees and daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanism. Prices change; check each source before relying on a figure.

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
- **Legacy `homeserver_url` / `homeserver_name` inputs.** Carried over from the
  Element template and still injected as `HOMESERVER_URL` / `HOMESERVER_NAME`, which the
  static SPA ignores. They are hidden from the deploy form.

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

Live collaboration works, but through Excalidraw's own hosted room server
(`oss-collab.excalidraw.com`, end-to-end encrypted), not a service in your project —
see the defaults above. Hosting collaboration yourself would need a source build of the
frontend and a separate `excalidraw-room` server, which this module does **not** deploy.

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
- **Some optional features use Excalidraw's own hosted services.** The upstream bundle
  wires live collaboration (`oss-collab.excalidraw.com` and Firebase), "Export to link"
  (`json.excalidraw.com`), the AI text-to-diagram and diagram-to-code features
  (`oss-ai.excalidraw.com`) and the shape-library browser (`libraries.excalidraw.com`)
  to Excalidraw's servers, not to anything in your project. Nothing is contacted on a
  plain page load — only when a user invokes the feature — and collaboration is
  end-to-end encrypted, but that content does leave the project. The URLs are compiled
  into the frontend at build time, so this module cannot redirect them; self-hosting
  collaboration would need a source build plus an `excalidraw-room` server.
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
| `application_version` | `latest` | Excalidraw image tag. Unlike some sibling modules, `latest` does **not** resolve to a pinned known-good tag — `Excalidraw_Common`'s `pinned_excalidraw_version` local is itself `"latest"`, so the build tracks Docker Hub's rolling `excalidraw/excalidraw:latest` tag. Pin a specific release (e.g. `v1.11.86`) in production. |
| `homeserver_url` / `homeserver_name` | `""` | Legacy Element carry-over, hidden from the form — ignored by the Excalidraw SPA. |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Keep `custom` — the thin build mirrors the static image into Artifact Registry. With `custom`, `container_image` is ignored; it is read only with `prebuilt`. |
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

<!-- related-guides -->

## Related guides

- [Hands-on lab: Excalidraw on Cloud Run](../labs/Excalidraw_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Excalidraw on GKE Autopilot](Excalidraw_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Excalidraw Common — Shared Application Configuration](Excalidraw_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Penpot on Google Cloud Run](Penpot_CloudRun.md), [AFFiNE on Google Cloud Run](Affine_CloudRun.md) in the **Design & Visual Collaboration** solution.
