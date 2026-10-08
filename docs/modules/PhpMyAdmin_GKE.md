---
title: "PhpMyAdmin on GKE Autopilot"
description: "Configuration reference for deploying PhpMyAdmin on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# PhpMyAdmin on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PhpMyAdmin_GKE.png" alt="PhpMyAdmin on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

phpMyAdmin is the most popular open-source (GPLv2) web tool for administering MySQL
and MariaDB databases over the browser — browse and edit tables, run SQL, manage
users, and import/export data. This module deploys phpMyAdmin on **GKE Autopilot** on
top of the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services phpMyAdmin uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## What PhpMyAdmin costs on RAD, and how that compares

**Running PhpMyAdmin in your own Google Cloud project costs about US$24.04/month in infrastructure, plus a one-time module fee of 40 RAD credits** (sized at 0.5 vCPU / 0.5 GiB on GKE Autopilot pods). RAD charges the module fee once, at deploy time — never again on Update — plus build time metered in credits; Google Cloud usage itself is billed to your own billing account at Google's list price. On a **RAD-managed** project the same resources are metered hourly in credits at list price plus RAD's margin — about 55 credits/day — and the module fee is 10% lower, at 36 credits. See "Pause it for free" below for how a RAD-managed PhpMyAdmin deployment can be stopped, at no running cost, until you need it again. (or see the [Cloud Run guide](PhpMyAdmin_CloudRun.md) for the lower-cost option)

### What you pay on RAD

| Item | Own project | RAD-managed project |
|---|---|---|
| Module fee | 40 credits (once) | 36 credits (once) |
| Build time | ~3-6 credits, metered per build minute | same, metered in credits at list price + RAD's margin |
| Google Cloud running cost | ~$24.04/month, billed to your own billing account at Google's list price | ~55 credits/day, metered hourly at list price + RAD's margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| GKE Autopilot pod, 0.5x vCPU / 0.5 GiB | 18.04 |
| Cloud NAT and networking | 5 |
| Cloud Storage (add-ons, backups) | 1 |
| GKE cluster management fee\* | shared across every GKE app in the project; $0 if this is your only cluster, else ~73 |
| **Total** | **$24.04** |

\* Not included in the total above — it is shared across every GKE app running in the same project, so it is $0 if this is your only GKE cluster.

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
redeploy cost against its own running cost — for this module, that is about 6 days or more of being idle,
based on its own US$24.04/month running cost above. Most of that running cost is
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

phpMyAdmin runs as a **stateless PHP + Apache** web workload on GKE Autopilot. It is
one of the lightest deployments in this repository — it wires together only the
services it truly needs:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | PHP/Apache pods, autoscaled; bills for requested CPU/memory |
| Database | **None provisioned** | phpMyAdmin has no database of its own; it connects to an *external* MySQL/MariaDB server you point it at |
| Object storage | **None** | Stateless — no GCS bucket is created |
| Cache | Redis (optional, off) | Only for rate-limiting/bot-detection on public deployments; not required |
| Secrets | **None generated** | phpMyAdmin holds no secret; users log in with the target MySQL server's own credentials |
| Container image | Artifact Registry | Thin custom build `FROM phpmyadmin/phpmyadmin`, mirrored and tag-pinned |
| Ingress | Cloud Load Balancing | External LoadBalancer Service by default; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **No database is provisioned for phpMyAdmin.** `database_type = "NONE"` is fixed and
  enforced by a plan-time validation guard. phpMyAdmin is a *client* — it administers
  a MySQL server that lives elsewhere (the platform Cloud SQL private IP, another
  Cloud SQL instance, or any reachable MySQL/MariaDB host). Nothing here creates that
  server.
- **The MySQL target is selected by env vars, not code.** `PMA_ARBITRARY = "1"` (the
  default) shows a server-input box on the login page so users type any host. Set
  `pma_host` (and `PMA_ARBITRARY = "0"`) to pin a single server.
- **No secrets are generated.** There is no encryption key, JWT secret, or app
  password to protect. Authentication is against the *target database's* own accounts
  (cookie auth).
- **Stateless Deployment, minimum 1 replica.** `workload_type` defaults to a
  `Deployment` (not a StatefulSet — there is no per-pod state) and GKE keeps at least
  one replica running (no scale-to-zero) so the console is always reachable.
- **Exposed via an external LoadBalancer** (`service_type = "LoadBalancer"`). Because
  phpMyAdmin is a powerful database administration tool, seriously consider fronting
  it with **IAP** (via Ingress) or restricting the LoadBalancer before exposing it to
  the internet.
- **NFS and Redis are disabled by default.** phpMyAdmin keeps no state; enable Redis
  only for abuse protection on a public deployment.
- **The container listens on port 80** (Apache `apache2-foreground`).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the phpMyAdmin workload

phpMyAdmin pods are scheduled on Autopilot, which bills for the CPU/memory the pods
request. Horizontal Pod Autoscaling sizes the Deployment between the minimum and
maximum replica counts. The container listens on **port 80**.

- **Console:** Kubernetes Engine → Workloads → select the phpMyAdmin workload to see
  pods and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  # Confirm the MySQL-target env vars injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep PMA_
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

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
  gcloud sql instances list --project "$PROJECT" --filter="databaseVersion~MYSQL"
  gcloud sql instances describe <instance-name> --project "$PROJECT" \
    --format='value(ipAddresses[0].ipAddress)'
  ```

Pods reach a private-IP MySQL server directly over the cluster's VPC networking (no
Auth Proxy sidecar is needed — `enable_cloudsql_volume` is `false` for phpMyAdmin
because it does not use the platform's own Cloud SQL integration). Users authenticate
at the phpMyAdmin login page with that database's own MySQL accounts.

### C. Cloud Storage

**Not used.** phpMyAdmin is stateless and declares no GCS bucket. Import/export in the
phpMyAdmin UI streams files through the browser, not to GCS.

### D. Redis (optional abuse protection)

Redis is **disabled by default** (`enable_redis = false`). It is only relevant if you
enable phpMyAdmin's rate-limiting/bot-detection on a public deployment. When left off,
phpMyAdmin functions fully — Redis is not required for normal operation.

- **CLI (only if enabled):**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  ```

### E. Secret Manager

**No secrets are generated by this module.** phpMyAdmin holds no encryption key, JWT
secret, or application password — login is against the target MySQL server's own
credentials, entered at the phpMyAdmin login page and never stored. You may still add
your own `secret_environment_variables`, which the foundation materialises via the
Secret Store CSI integration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~phpmyadmin"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = "LoadBalancer"`). A custom domain with a Google-managed certificate
can be enabled, and a static IP can be reserved so the address survives redeploys.
IAP (via Ingress) can gate access with Google sign-in — strongly recommended for a
database admin tool.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. PhpMyAdmin Application Behaviour

- **No first-deploy database setup.** There is no `db-init` job and no schema to
  create — phpMyAdmin has no database of its own. The pod is ready as soon as
  Apache/PHP starts.
- **No migrations, no immutable keys.** phpMyAdmin stores nothing between restarts, so
  there is no schema to migrate and no cryptographic key that can corrupt on redeploy.
  Rolling updates and version bumps are low-risk.
- **Stateless Deployment.** `workload_type` resolves to a `Deployment` and
  `stateful_pvc_enabled` is off — there is no per-pod state to preserve. A rolling
  update is safe because pods share no volume or lock.
- **Cookie-based login.** Users log in at the phpMyAdmin page with the **target MySQL
  server's own username and password**; the session lives in a short-lived cookie.
  phpMyAdmin never persists those credentials, and there is no phpMyAdmin "admin
  account" to create post-deploy.
- **MySQL target selection.** Verify the injected `PMA_*` env vars on the running pod:
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep PMA_
  ```
  With `PMA_ARBITRARY = "1"`, the login page shows a server field; with a fixed
  `pma_host`, users only see username/password for that one server.
- **Health path.** Startup, liveness, and readiness probes target `/` — Apache serves
  the login page there with a `200` once PHP is up. First boot is fast; no long
  migration window is needed.
- **Security posture.** phpMyAdmin exposes full database administration to anyone who
  can reach the LoadBalancer *and* holds valid MySQL credentials. Gate it with IAP or
  restrict the Service, and set `PMA_ARBITRARY = "0"` with a fixed `pma_host` if users
  should only reach one server.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for phpMyAdmin are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

All other inputs follow standard App_GKE behaviour.

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

All other inputs follow standard App_GKE behaviour.

### Group 3 — Application Identity & MySQL Target

| Variable | Default | Description |
|---|---|---|
| `application_name` | `phpmyadmin` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | phpMyAdmin image tag; `latest` resolves to the pinned `5.2.2`. Pin explicitly in production. |
| `pma_arbitrary` | `"1"` | `"1"` shows a server-input box (users type any host); `"0"` restricts to `pma_host`. |
| `pma_host` | `""` | Fixed MySQL/MariaDB host (injected as `PMA_HOST`). Leave blank in arbitrary mode; set to a Cloud SQL private IP to pin a server. |
| `pma_port` | `"3306"` | Target MySQL port (injected as `PMA_PORT`). |

All other inputs follow standard App_GKE behaviour.

### Group 4 — Container Image & Runtime

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | phpMyAdmin ships as a thin custom build (`FROM phpmyadmin/phpmyadmin`); keep `custom`. |
| `container_port` | `80` | Apache listens on port 80. **Hardcoded** — `PhpMyAdmin_Common`'s config output fixes `container_port = 80` with no `container_port` input passed through from this variable, so setting a different value in `deploy.tfvars` has no effect on the deployed workload. |
| `min_instance_count` | `1` | Minimum replicas; GKE has no scale-to-zero, keep ≥ 1 so the console is reachable. **Hardcoded** — `phpmyadmin.tf` merges `min_instance_count = 1` directly into the application config that `App_GKE` deploys (`local.selected_module.min_instance_count`, not the top-level `var.min_instance_count`), so this input is immune to user overrides. |
| `max_instance_count` | `3` | Maximum replicas. |
| `enable_cloudsql_volume` | `false` | phpMyAdmin does not use the platform Cloud SQL integration; it connects to an external MySQL host directly. |
| `enable_image_mirroring` | `true` | Mirror the phpMyAdmin image into Artifact Registry. |

All other inputs follow standard App_GKE behaviour.

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `PMA_HOST` / `PMA_PORT` / `PMA_ARBITRARY` are set from the group 3 inputs. |
| `secret_environment_variables` | `{}` | Optional — phpMyAdmin generates no secrets of its own. |

All other inputs follow standard App_GKE behaviour.

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External LoadBalancer by default. Consider `ClusterIP` behind an IAP-gated Ingress for a DB admin tool. |
| `workload_type` | `null` → `Deployment` | Stateless Deployment; no StatefulSet needed. |
| `session_affinity` | `None` | Not required — phpMyAdmin holds no per-pod session state beyond the browser cookie. |

All other inputs follow standard App_GKE behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed and enforced by a plan-time validation guard. phpMyAdmin has no database of its own. |

All other inputs follow standard App_GKE behaviour.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | phpMyAdmin is stateless — NFS is not required. |

All other inputs follow standard App_GKE behaviour.

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Optional rate-limiting/bot-detection for public deployments; not required. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Redis endpoint if enabled. |

All other inputs follow standard App_GKE behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach phpMyAdmin. |
| `storage_buckets` | Created Cloud Storage buckets (empty for phpMyAdmin). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of setup jobs (empty for phpMyAdmin). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD GitHub details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine and a module-local guard (`validation.tf`), which validate values *and combinations* at plan time — `database_type` other than `NONE`, IAP with no OAuth credentials, `min_instance_count` above `max_instance_count`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `service_type` / `enable_iap` | Restrict or gate with IAP | Critical | phpMyAdmin is full database administration; an unauthenticated external LoadBalancer exposes every reachable MySQL server to credential-stuffing and brute-force. |
| `pma_host` + `PMA_ARBITRARY = "0"` | Pin one server for scoped access | High | With `PMA_ARBITRARY = "1"` users can target *any* reachable MySQL host, widening the blast radius of a compromised session. |
| `database_type` | `NONE` (fixed) | High | Any other value fails the module's plan-time validation guard — it would otherwise provision an unused Cloud SQL instance and incur cost. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects `min > max`. Keeping 1 ensures the console is always reachable. |
| `enable_iap` without OAuth creds | Provide `iap_oauth_client_id`/`_secret` | High | Enabling IAP without credentials silently disables it, exposing phpMyAdmin without authentication — blocked by a plan-time guard. |
| `application_version` | Pin explicitly (e.g. `5.2.2`) | Medium | `latest` resolves to the pinned `5.2.2` today; pin in production so an upstream tag change never shifts the image under you. |
| `enable_cloudsql_volume` | `false` | Low | phpMyAdmin connects to an external MySQL host directly and does not use the platform Cloud SQL integration; leaving it off is correct. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, and VPC-SC — see **[App_GKE](App_GKE.md)**. phpMyAdmin-specific
application configuration shared with the Cloud Run variant is described in
**[PhpMyAdmin_Common](PhpMyAdmin_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: PhpMyAdmin on GKE Autopilot](../labs/PhpMyAdmin_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [PhpMyAdmin on Google Cloud Run](PhpMyAdmin_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [PhpMyAdmin Common — Shared Application Configuration](PhpMyAdmin_Common.md) — the configuration shared by both deployment targets.
