---
title: "Stirling-PDF on Google Cloud Run"
description: "Configuration reference for deploying Stirling-PDF on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Stirling-PDF on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/StirlingPDF_CloudRun.png" alt="Stirling-PDF on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Stirling-PDF is an open-source (MIT-licensed core), locally-hosted web PDF toolkit —
merge, split, convert, OCR, compress, watermark, sign, redact, and 50+ other PDF
operations, all processed on your own infrastructure so documents never touch a
third-party service. This module deploys Stirling-PDF on **Cloud Run v2** on top of
the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Stirling-PDF uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What Stirling-PDF costs on RAD, and how that compares

**Stirling-PDF on RAD's Cloud Run module costs about US$19.16 a month in a Google Cloud project you own, with the module fee charged once in RAD credits.** Stirling-PDF is stateless with no database, so this is the cheapest configuration on the platform's Cloud Run side. For the lowest running cost it stays here; GKE Autopilot is only worth it if it needs to sit beside other Kubernetes workloads — see the [GKE guide](StirlingPDF_GKE.md) for that option, at about US$45.68 a month instead. If you only need it occasionally — a batch of documents, a one-off conversion job — a RAD-managed project can be deleted and restored within 30 days for a handful of credits (under US$1) instead of paying for it to sit idle. See **Pause it for free**, below. Figures are as at 8 October 2026; sources are listed at the end of this section.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 40 credits (US$4 at the top-up price) | 36 credits (10% lower) |
| Build time | About 3-6 credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$19.16 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **3 credits a day**, about 90 a month |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the network is shared by every application in the project, so a second application does not add a second set of it.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | US$13.16 |
| Cloud NAT and networking | US$5.00 |
| Cloud Storage (add-ons, backups) | US$1.00 |
| **Total** | **US$19.16** |

### How it compares

- Stirling PDF's own hosted plan, **Stirling PDF Team**, costs **$99/month for up to 100 users** on its hosted SaaS — a per-organisation fee aimed at teams, not infrastructure cost (source: [stirling.com/pricing](https://www.stirling.com/pricing)). RAD's own-project figure is a small fraction of that because it's the raw Cloud Run compute cost with no per-seat software fee layered on.
- A self-managed comparison: Hetzner CPX22 (2 vCPU/4GB) runs about $24/month, a DigitalOcean 2 vCPU/4GB Droplet is the same $24/month, and a GCP Compute Engine e2-standard-2 (2 vCPU/8GB) is about $49/month — all more than RAD's own-project Cloud Run figure, and all need to be kept patched by hand, which RAD's managed Secret Manager and monitoring otherwise cover.
- With no database and no persistent state, Stirling-PDF is close to the floor of what any deployment on RAD costs — almost the whole bill is the Cloud Run container itself.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Stirling-PDF runs in a project RAD manages for you, deleting the whole project unlinks its billing first, then asks Google to delete the project outright — Google's own 30-day recoverable soft delete. Unlike deleting one module, this does not tear down the compute resource one by one: the whole project simply stops, and nothing is charged while it waits, because billing is already unlinked.

Restoring, within 30 days and only by the project's owner, asks Google to undelete the project and reattaches its billing account, then asks you to run Update on each deployment to confirm everything came back. Because nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a rebuild, and an Update never charges the module fee again. This costs only a handful of credits (under US$1) in total for a typical 2-3-deployment chain.

What this needs: you must own the project (not one RAD only manages billing for), you must restore it yourself within 30 days — after that Google deletes it for good — and restoring is admitted like creating a new project, so your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier most study/demo use fits). Google says most services are fully working again within 36 hours of a restore.

One real gap: nightly backups are written to a bucket inside the project, and that bucket has Cloud Storage's soft-delete explicitly turned off, so it is very likely gone as soon as you delete the project — even though the project itself is recoverable for 30 days. Stirling-PDF itself holds no database, so for a default install with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

In your own project, or once the 30-day restore window has passed, the alternative is to delete Stirling-PDF outright and redeploy it later. A redeploy costs the module fee again, plus the builds — roughly 45 credits (about US$4.50) in your own project, or 41 credits in a RAD-managed one.

Deleting saves money only once Stirling-PDF would otherwise sit unused long enough to clear that redeploy cost against its own daily running cost — against the own-project total above (about US$0.64 a day), that works out to about 8 days or more, or about 14 days or more in a RAD-managed one (3 credits a day). There's no database here, so deleting this app frees its entire running cost rather than just a share of it.

Keep data first: anything Stirling-PDF writes to a backup bucket inside the deployment is deleted with it, so copy anything you want to keep out before deleting.

### Lab sessions and Managed Environments

- **Lab sessions, for training:** a trainer runs a session for a class. Each participant gets the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either the trainer funds every place, or each participant pays for their own. Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies:** a partner runs the app for a client from a ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over and the deployments become the client's own.
- Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; [radmodules.dev/pricing](https://radmodules.dev/pricing) for RAD's own fees and daily-credit estimates; [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics; [stirling.com/pricing](https://www.stirling.com/pricing) for Stirling PDF Team's hosted price.

## 1. Overview

Stirling-PDF runs as a Java / Spring Boot container (with a bundled LibreOffice for
document conversions) on Cloud Run v2. The deployment wires together a deliberately
small set of Google Cloud services — Stirling-PDF is stateless, so there is no
database, no persistent storage, and no secrets to manage:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Java service, 1 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero enabled |
| Container image | Artifact Registry | Official `stirlingtools/stirling-pdf` image, mirrored in by default |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |
| Redis (inert) | Redis | Off by default. `enable_redis` only makes the Foundation inject `REDIS_*` env vars — Stirling-PDF never reads them, so this provides no rate limiting or bot detection |
| Observability | Cloud Logging / Cloud Monitoring | Container logs, metrics, optional uptime check and alerts |

**Sensible defaults worth knowing up front:**

- **Stateless — no database, no storage, no secrets.** `database_type = "NONE"`,
  no GCS buckets, no NFS, and an empty secret map. Every PDF operation runs in a
  per-request ephemeral working directory that is discarded on completion.
- **Prebuilt image.** `container_image_source = "prebuilt"` deploys the official
  `stirlingtools/stirling-pdf` image directly; `enable_image_mirroring = true`
  mirrors it into Artifact Registry to avoid Docker Hub rate limits.
- **Login is disabled by default.** `enable_login = false`
  (`SECURITY_ENABLELOGIN=false`) ships an open instance. Enable it and front the
  service with IAP or Cloud Armor for a private deployment.
- **Request-based billing + scale-to-zero.** `cpu_always_allocated = false` and
  `min_instance_count = 0` — CPU is billed only while serving a request, and the
  service scales to zero when idle. A cold start adds a few seconds of JVM warm-up.
- **2 GiB memory floor.** The JVM plus LibreOffice needs at least `2Gi`; raise
  `memory_limit` for heavy OCR / conversion workloads.
- **Public ingress by default.** `ingress_settings = "all"` so the toolkit is
  reachable at its `run.app` URL. Combine with IAP for identity-gated access.
- **Health probes hit `/api/v1/info/status`** — a public, unauthenticated endpoint
  that returns 200 once the JVM and LibreOffice have initialised (~70s first-boot
  window).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Stirling-PDF service

Stirling-PDF runs as a Cloud Run v2 service that autoscales by request load between
the minimum (0) and maximum instance counts. Each deployment creates an immutable
revision; traffic can be split across revisions for safe rollouts.

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

### B. Artifact Registry — the container image

The official `stirlingtools/stirling-pdf` image is mirrored into Artifact Registry
(`enable_image_mirroring = true`) and Cloud Run pulls it from there. No Cloud Build
step runs — the image is prebuilt upstream.

- **Console:** Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list <repo-path> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for the mirroring mechanism and image retention.

### C. Networking & ingress

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

### D. Redis (inert — enable_redis has no application effect)

Redis is **disabled by default** (`enable_redis = false`). Setting `enable_redis =
true` only makes the `App_CloudRun` foundation inject `REDIS_HOST`/`REDIS_PORT`/
`REDIS_AUTH` env vars into the container — Stirling-PDF **never reads them**.
`stirlingpdf.tf`'s own comment confirms "no DB or Redis", and neither
`StirlingPDF_Common` nor this module maps those env vars into any
Stirling-PDF-recognized setting. Enabling Redis does **not** implement rate
limiting or bot detection for this application; there is no supported way to add
that behaviour to Stirling-PDF through this module. Use `enable_cloud_armor` for
actual abuse mitigation on a public instance.

- **CLI (to confirm the env vars are present but unused):**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Identity-Aware Proxy (optional)

Because Stirling-PDF processes potentially sensitive documents, a private deployment
should gate access with IAP. Enabling `enable_iap` requires an authenticated,
authorized Google identity before any request reaches the service — no VPN or
Stirling-PDF login configuration needed.

- **Console:** Security → Identity-Aware Proxy.
- **CLI:**
  ```bash
  gcloud iap web get-iam-policy --resource-type=backend-services --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for the IAP wiring.

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring,
with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Stirling-PDF Application Behaviour

- **Nothing is persisted.** Uploads are written to a per-request ephemeral working
  directory and deleted when the response is returned. There is no database and no
  bucket — a redeploy or scale event loses nothing because there is nothing to lose.
- **Slow first boot.** Spring Boot plus LibreOffice initialisation takes tens of
  seconds. The startup probe targets `/api/v1/info/status` and allows up to ~70
  seconds (10s initial delay + 6 × 10s) before the revision is marked unhealthy.
- **Login is optional and off by default.** `enable_login = false` ships an open
  instance. Set `enable_login = true` to require Stirling-PDF's built-in
  authentication; combine with IAP for defence in depth.
- **Version upgrades are image-tag bumps.** Because the image is unmodified upstream
  and there is no schema, changing `application_version` rolls out a new revision
  with no migration step.
- **Large files and long conversions.** Raise `memory_limit` and `timeout_seconds`
  for large documents or heavy OCR; set `SYSTEM_MAXFILESIZE` via
  `environment_variables` to cap upload size.
- **Confirm the running configuration:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Stirling-PDF are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `stirlingpdf` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Stirling-PDF` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Stirling-PDF image tag; pin to a specific release in production. |
| `enable_login` | `false` | Enable Stirling-PDF's built-in auth (`SECURITY_ENABLELOGIN`). |
| `default_locale` | `en-US` | Default UI locale (`SYSTEM_DEFAULTLOCALE`). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Deploy the official image (`prebuilt`) or build a custom one. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `2Gi` | Memory per instance; **2Gi floor** for JVM + LibreOffice. |
| `cpu_always_allocated` | `false` | Request-based billing — Stirling-PDF has no background work. |
| `min_instance_count` | `0` | Fixed at 0 (scale-to-zero) — the module hardcodes this value; the variable is not forwarded to the Foundation and cannot be changed. |
| `max_instance_count` | `3` | Autoscaling upper bound (safe to raise — no shared state). |
| `container_port` | `8080` | Stirling-PDF listens on port 8080. |
| `execution_environment` | `gen2` | Gen2 recommended. |
| `timeout_seconds` | `60` | Maximum request duration; raise for large conversions. |
| `enable_cloudsql_volume` | `false` | Not used — Stirling-PDF has no database. |
| `enable_image_mirroring` | `true` | Mirror the image into Artifact Registry. |
| `traffic_split` | `[]` | Split traffic across revisions for staged rollouts. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` for public access; `internal-and-cloud-load-balancing` behind an LB. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. Recommended for private/sensitive-document instances. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra Stirling-PDF settings (e.g. `SYSTEM_MAXFILESIZE`). Login and locale are set via `enable_login` / `default_locale`. |
| `secret_environment_variables` | `{}` | Secret Manager references. Stirling-PDF needs none by default. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 7 — Backup & Restore

Stirling-PDF is stateless, so backup inputs (`backup_schedule`,
`backup_retention_days`, `enable_backup_import`, `backup_source`, `backup_uri`,
`backup_format`) have no application data to protect. Left at defaults.

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. Recommended for public instances. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domain names for the HTTPS LB. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `false` | Stirling-PDF is stateless — no bucket by default. |
| `storage_buckets` | `[]` | Optional additional GCS buckets. |
| `enable_nfs` | `false` | NFS off by default; enable only if co-locating Redis on the NFS server. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — Stirling-PDF uses no database. |
| `database_password_length` | `32` | Not used. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | Not applicable. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/v1/info/status`, 10s delay, 6 retries | Startup probe. ~70s first-boot window for JVM + LibreOffice. |
| `liveness_probe` | HTTP `/api/v1/info/status`, 15s delay | Liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/api/v1/info/status" }` | Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis (inert Foundation passthrough)

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Inert for Stirling-PDF: only makes `App_CloudRun` inject `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` env vars, which the application never reads. No rate limiting or bot detection results from enabling this. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP. Unused by Stirling-PDF regardless of value. |
| `redis_port` | `6379` | Redis port. Unused by Stirling-PDF regardless of value. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). Unused by Stirling-PDF regardless of value. |

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
| `storage_buckets` | Created Cloud Storage buckets (empty — Stirling-PDF is stateless). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, an out-of-range `redis_port`/`timeout_seconds`, a memory below the gen2 floor. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_login` + ingress | `enable_login = true` **or** IAP for private use | High | Default `enable_login = false` + public ingress leaves an open PDF toolkit anyone with the URL can use. |
| `enable_iap` | Enable for sensitive-document instances | High | Without IAP (and with login off) the service is unauthenticated; users can upload confidential documents to an open endpoint. |
| `memory_limit` | `2Gi` | High | Below ~2Gi the JVM + LibreOffice OOM-kills during conversions; gen2 also rejects `< 512Mi` at plan time. |
| `timeout_seconds` | `60`, raise for big files | High | Large OCR/conversion jobs exceeding the timeout return 504 mid-operation. |
| `startup_probe` window | Keep the ~70s default | Medium | Shortening the initial delay / failure threshold marks the revision unhealthy before LibreOffice finishes warming up. |
| `enable_cloud_armor` | Enable for public instances | Medium | A public toolkit without a WAF is exposed to abuse and automated scanning. |
| `enable_redis` | Leave `false` — it is inert for this application | Low | Enabling it only adds unused `REDIS_*` env vars to the revision; Stirling-PDF never reads them, so it provides **no** rate limiting or bot detection. Use `enable_cloud_armor` instead for actual abuse mitigation. |
| `min_instance_count` | `0` (fixed) | Low | Scale-to-zero adds a few seconds of JVM warm-up on the first request after idle. The module hardcodes `min_instance_count = 0` — the variable is not forwarded, so it cannot be raised to `1` to eliminate cold starts. |
| `SYSTEM_MAXFILESIZE` (via `environment_variables`) | Set a sane cap | Low | Unbounded uploads let a single large file consume the instance's memory. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Stirling-PDF-specific application configuration
shared with the GKE variant is described in
**[StirlingPDF_Common](StirlingPDF_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Stirling-PDF on Cloud Run](../labs/StirlingPDF_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Stirling-PDF on GKE Autopilot](StirlingPDF_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Stirling-PDF Common — Shared Application Configuration](StirlingPDF_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Outline on Google Cloud Run](Outline_CloudRun.md), [BookStack on Google Cloud Run](BookStack_CloudRun.md), [Paperless-ngx on Google Cloud Run](Paperless_CloudRun.md) in the **Knowledge Base & Documentation** solution.
