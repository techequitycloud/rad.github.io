---
title: "PhpMyAdmin on Google Cloud Run"
description: "Configuration reference for deploying PhpMyAdmin on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# PhpMyAdmin on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PhpMyAdmin_CloudRun.png" alt="PhpMyAdmin on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

phpMyAdmin is the most popular open-source (GPLv2) web tool for administering MySQL
and MariaDB databases over the browser — browse and edit tables, run SQL, manage
users, and import/export data. This module deploys phpMyAdmin on **Cloud Run v2** on
top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages
the shared Google Cloud infrastructure.

This guide focuses on the cloud services phpMyAdmin uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## What PhpMyAdmin costs on RAD, and how that compares

**Running PhpMyAdmin in your own Google Cloud project costs about US$16.78/month in infrastructure, plus a one-time module fee of 40 RAD credits** (sized at 1 vCPU / 0.5 GiB on a scale-to-zero Cloud Run instance). RAD charges the module fee once, at deploy time — never again on Update — plus build time metered in credits; Google Cloud usage itself is billed to your own billing account at Google's list price. On a **RAD-managed** project the same resources are metered hourly in credits at list price plus RAD's margin — about 3 credits/day — and the module fee is 10% lower, at 36 credits. See "Pause it for free" below for how a RAD-managed PhpMyAdmin deployment can be stopped, at no running cost, until you need it again. (or see the [GKE guide](PhpMyAdmin_GKE.md) if you need Kubernetes)

### What you pay on RAD

| Item | Own project | RAD-managed project |
|---|---|---|
| Module fee | 40 credits (once) | 36 credits (once) |
| Build time | ~3-6 credits, metered per build minute | same, metered in credits at list price + RAD's margin |
| Google Cloud running cost | ~$16.78/month, billed to your own billing account at Google's list price | ~3 credits/day, metered hourly at list price + RAD's margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 0.5 GiB (scaleToZero) | 10.78 |
| Cloud NAT and networking | 5 |
| Cloud Storage (add-ons, backups) | 1 |
| **Total** | **$16.78** |

### How it compares

- We could not verify a current, directly-comparable commercial SaaS price for this exact open-source project, so the honest comparison is a bare self-managed server: Hetzner CPX22 (2 vCPU/4GB, ~$24/mo), a DigitalOcean 2 vCPU/4GB Droplet (~$24/mo), or a GCP Compute Engine e2-standard-2 (2 vCPU/8GB, ~$49/mo). This app's own footprint (1 vCPU or less, 1 GiB or less) is smaller than any of those classes, so a bare self-managed box sized to match would cost less than the figures above — but you would still own every patch, backup and security update yourself.
- RAD is **not** claiming to beat a bare VPS on sticker price — it usually does not. What RAD adds for the same or a similar dollar figure is a managed database, Secret Manager-held credentials, monitoring, and one-click Update, none of which a bare VPS gives you for free.
- On a bare VPS you are the one applying OS/database security patches, taking and testing backups, and renewing certificates; RAD's managed Cloud SQL, Secret Manager and monitoring handle all three for you.

### Pause it for free: delete a RAD-managed project, restore it when you need it

This is the headline option on a **RAD-managed** project, and it is free while paused. Deleting
a RAD-managed project first unlinks its billing, then asks Google to delete the project itself —
Google's own 30-day recoverable soft delete. Unlike deleting a single module, this does not tear
down the database, any VM, or the compute resource one at a time: the whole project simply
stops, and because billing is already unlinked, nothing is charged while it waits.

Restoring — within 30 days, and only by the project's owner — asks Google to undelete the
project and reattaches its billing account, then asks you to run Update on each deployment to
confirm everything came back. Because nothing was individually destroyed, that Update finds the
same resources already there: it is a check, not a rebuild, and an Update never charges the
module fee again. The whole restore costs only a handful of credits (under US$1) in build time
for a typical chain of deployments. What this needs: you must own the project (not merely have
RAD manage its billing), you must restore it yourself within the 30 days — after that Google
deletes it for good — and restoring is admitted like creating a new project, so your purchased
credit balance must still clear the tier's floor (100 credits for the sandbox tier most study and
demo use fits). Google says most services are fully working again within 36 hours of a restore.

**One real gap:** nightly backups are written to a bucket inside the project, and that bucket has
Cloud Storage's soft-delete explicitly turned off, so the backup bucket is very likely gone as
soon as you delete the project — even though the project itself is recoverable for 30 days. If
you have customised this deployment and want to keep that work, copy a backup out (to Google
Drive, or a bucket outside the project) before deleting. For a default install with nothing
irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

The other lever, for an **own project** (or a RAD-managed one past its 30-day restore window),
is to delete PhpMyAdmin outright and redeploy it later. A redeploy costs the module fee again
plus the builds — roughly **43-46 credits** in total for this module.

Deleting only saves money once PhpMyAdmin would otherwise sit unused long enough to clear that
redeploy cost against its own running cost — for this module, that is about 8 days or more of being idle,
based on its own US$16.78/month running cost above. Most of that running cost is
usually the database and any shared file/cache VM, and they stop only once nothing else in the
project uses them, so deleting this app alone saves only its own compute share if something else
shares the project.

**Keep data first:** nightly backups go to a bucket inside the deployment and are deleted with
it, so copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training:** a trainer runs a session for a class. Each participant gets the
  app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies:** a partner runs the app for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.
- Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by
  card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; [radmodules.dev/pricing](https://radmodules.dev/pricing) for RAD's own fees and daily-credit estimates; [Resource Manager: delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics.

## 1. Overview

phpMyAdmin runs as a **stateless PHP + Apache** container on Cloud Run v2. It is one
of the lightest deployments in this repository — it wires together only the services
it truly needs:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | PHP/Apache service, 1 vCPU / 512 MiB by default, serverless autoscaling; scale-to-zero |
| Database | **None provisioned** | phpMyAdmin has no database of its own; it connects to an *external* MySQL/MariaDB server you point it at |
| Object storage | **None** | Stateless — no GCS bucket is created |
| Cache | Redis (optional, off) | Only for rate-limiting/bot-detection on public deployments; not required |
| Secrets | **None generated** | phpMyAdmin holds no secret; users log in with the target MySQL server's own credentials |
| Container image | Artifact Registry | Thin custom build `FROM phpmyadmin/phpmyadmin`, mirrored and tag-pinned |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No database is provisioned for phpMyAdmin.** `database_type = "NONE"` is fixed by
  the shared application layer. phpMyAdmin is a *client* — it administers a MySQL
  server that lives elsewhere (the platform Cloud SQL private IP, another Cloud SQL
  instance, or any reachable MySQL/MariaDB host). Nothing here creates that server.
- **The MySQL target is selected by env vars, not code.** `PMA_ARBITRARY = "1"` (the
  default) shows a server-input box on the login page so users type any host. Set
  `pma_host` (and `PMA_ARBITRARY = "0"`) to pin a single server.
- **No secrets are generated.** There is no encryption key, JWT secret, or app
  password to protect — and therefore nothing that can corrupt on redeploy.
  Authentication is against the *target database's* own accounts (cookie auth).
- **Scale-to-zero is enabled** (`min_instance_count = 0`, forced by the module).
  phpMyAdmin is an interactive admin console with no background work, so it should
  cost nothing when idle. Cold starts add a few seconds to the first request after
  idle.
- **Request-based billing** (`cpu_always_allocated = false`). phpMyAdmin does no
  in-process background work, so CPU is billed only while serving a request.
- **Public ingress by default** (`ingress_settings = "all"`). Because phpMyAdmin is a
  powerful database administration tool, seriously consider fronting it with **IAP**
  or restricting ingress before exposing it to the internet.
- **NFS and Redis are disabled by default.** phpMyAdmin keeps no state; enable Redis
  only for abuse protection on a public deployment.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the phpMyAdmin service

phpMyAdmin runs as a Cloud Run v2 service that autoscales by request load between the
minimum (0) and maximum instance counts. Each deployment creates an immutable
revision; traffic can be split across revisions for safe rollouts. The container
listens on **port 80**.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~phpmyadmin"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the MySQL-target env vars injected into the running revision:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. The target MySQL/MariaDB server (external)

phpMyAdmin does **not** provision a database — it connects to one you already have.
That target is selected via `pma_host` / `pma_port` (fixed) or `PMA_ARBITRARY = "1"`
(user types the host at login). A common pattern is to point phpMyAdmin at the
platform's shared Cloud SQL private IP:

- **Console:** SQL → select the instance to find its **private IP** and connection
  name.
- **CLI:**
  ```bash
  # Find a MySQL instance's private IP to use as pma_host:
  gcloud sql instances list --project "$PROJECT" \
    --filter="databaseVersion~MYSQL"
  gcloud sql instances describe <instance-name> --project "$PROJECT" \
    --format='value(ipAddresses[0].ipAddress)'
  ```

For phpMyAdmin to reach a private-IP MySQL server, the service must have VPC egress
to the shared VPC (handled by the foundation when `vpc_egress_setting` routes private
ranges). Users authenticate at the phpMyAdmin login page with that database's own
MySQL accounts.

### C. Cloud Storage

**Not used.** phpMyAdmin is stateless and declares no GCS bucket. (Import/export in
the phpMyAdmin UI streams files through the browser, not to GCS.)

### D. Redis (optional abuse protection)

Redis is **disabled by default** (`enable_redis = false`). It is only relevant if you
enable phpMyAdmin's rate-limiting/bot-detection on a public deployment. When left off,
phpMyAdmin functions fully — Redis is not required for normal operation.

- **CLI (only if enabled):**
  ```bash
  redis-cli -h <redis-host> ping
  ```

### E. Secret Manager

**No secrets are generated by this module.** phpMyAdmin holds no encryption key, JWT
secret, or application password — login is against the target MySQL server's own
credentials, entered at the phpMyAdmin login page and never stored. You may still add
your own `secret_environment_variables` (e.g. to inject a fixed
`PMA_PASSWORD`/`PMA_USER` for a single-signon target), which the foundation mounts
from Secret Manager.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~phpmyadmin"
  ```

See [App_CloudRun](App_CloudRun.md) for secret injection details.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = "all"`).
An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can
be layered on; IAP can gate access with Google sign-in — strongly recommended for a
database admin tool.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Apache/PHP container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. PhpMyAdmin Application Behaviour

- **No first-deploy database setup.** There is no `db-init` job and no schema to
  create — phpMyAdmin has no database of its own. The service is ready as soon as
  Apache/PHP starts.
- **No migrations, no immutable keys.** phpMyAdmin stores nothing between restarts, so
  there is no schema to migrate and no cryptographic key that can corrupt on redeploy.
  Redeploying or changing the image version is low-risk.
- **Stateless, cookie-based login.** Users log in at the phpMyAdmin page with the
  **target MySQL server's own username and password**; the session lives in a
  short-lived cookie. phpMyAdmin never persists those credentials. There is no
  phpMyAdmin "admin account" to create post-deploy.
- **MySQL target selection.** Verify the injected `PMA_*` env vars on the running
  revision:
  ```bash
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
  With `PMA_ARBITRARY = "1"`, the login page shows a server field; with a fixed
  `pma_host`, users only see username/password for that one server.
- **Health path.** Startup, liveness, and readiness probes target `/` — Apache serves
  the login page there with a `200` once PHP is up. First boot is fast (a few
  seconds); no long migration window is needed.
- **Security posture.** phpMyAdmin exposes full database administration to anyone who
  can reach it *and* holds valid MySQL credentials. Because the service is public by
  default, gate it with IAP or an HTTPS LB + Cloud Armor, and restrict
  `PMA_ARBITRARY` to `"0"` with a fixed `pma_host` if users should only reach one
  server.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for phpMyAdmin are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

All other inputs follow standard App_CloudRun behaviour.

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

All other inputs follow standard App_CloudRun behaviour.

### Group 3 — Application Identity & MySQL Target

| Variable | Default | Description |
|---|---|---|
| `application_name` | `phpmyadmin` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | phpMyAdmin image tag; `latest` resolves to the pinned `5.2.2`. Pin explicitly in production. |
| `pma_arbitrary` | `"1"` | `"1"` shows a server-input box (users type any host); `"0"` restricts to `pma_host`. |
| `pma_host` | `""` | Fixed MySQL/MariaDB host (injected as `PMA_HOST`). Leave blank in arbitrary mode; set to a Cloud SQL private IP to pin a server. |
| `pma_port` | `"3306"` | Target MySQL port (injected as `PMA_PORT`). |

All other inputs follow standard App_CloudRun behaviour.

### Group 4 — Container Image & Runtime

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | phpMyAdmin ships as a thin custom build (`FROM phpmyadmin/phpmyadmin`); keep `custom`. |
| `container_port` | `80` | Apache listens on port 80. |
| `cpu_limit` | `1000m` | CPU per instance; phpMyAdmin is lightweight. |
| `memory_limit` | `512Mi` | Memory per instance (gen2 floor is 512 MiB). |
| `cpu_always_allocated` | `false` | Request-based billing — no background work to keep warm. |
| `min_instance_count` | `0` | Forced to `0` by the module (scale-to-zero). |
| `max_instance_count` | `3` | Cost ceiling / concurrency cap. |
| `execution_environment` | `gen2` | gen2 recommended. |
| `container_protocol` | `http1` | phpMyAdmin serves HTTP/1.1. |
| `enable_image_mirroring` | `true` | Mirror the phpMyAdmin image into Artifact Registry. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public by default. Consider `internal-and-cloud-load-balancing` or IAP for a DB admin tool. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Required to reach a private-IP MySQL server. |
| `enable_iap` | `false` | Require Google sign-in — **strongly recommended** for phpMyAdmin. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

All other inputs follow standard App_CloudRun behaviour.

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `false` | phpMyAdmin is stateless — no bucket is created unless you flip this on and add `storage_buckets`. |
| `enable_nfs` | `false` | phpMyAdmin is stateless — NFS is not required. |
| `gcs_volumes` | `[]` | Not needed for phpMyAdmin. |

All other inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — phpMyAdmin has no database of its own. Do not set an engine. |

All other inputs follow standard App_CloudRun behaviour.

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/` | Login page returns `200` once PHP is up. |
| `liveness_probe` | HTTP `/` | Liveness probe. |
| `uptime_check_config` | _(set)_ | Cloud Monitoring uptime check (only when publicly reachable). |

All other inputs follow standard App_CloudRun behaviour.

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Optional rate-limiting/bot-detection for public deployments; not required. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Redis endpoint if enabled. |

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
| `storage_buckets` | Created Cloud Storage buckets (empty for phpMyAdmin). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of setup jobs (empty for phpMyAdmin). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, an out-of-range `redis_port`, `min_instance_count` above `max_instance_count`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `ingress_settings` / `enable_iap` | Restrict or gate with IAP | Critical | phpMyAdmin is full database administration; leaving it public without IAP exposes every reachable MySQL server to credential-stuffing and brute-force. |
| `pma_host` + `PMA_ARBITRARY = "0"` | Pin one server for scoped access | High | With `PMA_ARBITRARY = "1"` users can target *any* reachable MySQL host, widening the blast radius of a compromised session. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | High | Without VPC egress to private ranges, phpMyAdmin cannot reach a Cloud SQL private-IP server — the login page connects to nothing. |
| `database_type` | `NONE` (fixed) | Medium | Setting an engine provisions an unused Cloud SQL instance and incurs needless cost; the GKE variant blocks this at plan time, Cloud Run simply wastes the resource. |
| `application_version` | Pin explicitly (e.g. `5.2.2`) | Medium | `latest` resolves to the pinned `5.2.2` today; pin in production so an upstream tag change never shifts the image under you. |
| `memory_limit` | `512Mi` | Low | Below the gen2 512 MiB floor the plan is rejected; phpMyAdmin needs little more. |
| `min_instance_count` | `0` (default) | Low | Scale-to-zero adds a few seconds of cold-start latency on the first request after idle — acceptable for an interactive tool. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. phpMyAdmin-specific application configuration
shared with the GKE variant is described in
**[PhpMyAdmin_Common](PhpMyAdmin_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: PhpMyAdmin on Cloud Run](../labs/PhpMyAdmin_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [PhpMyAdmin on GKE Autopilot](PhpMyAdmin_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [PhpMyAdmin Common — Shared Application Configuration](PhpMyAdmin_Common.md) — the configuration shared by both deployment targets.
