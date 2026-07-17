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
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
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
