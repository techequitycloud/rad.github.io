---
title: "PhpMyAdmin on GKE Autopilot"
description: "Configuration reference for deploying PhpMyAdmin on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# PhpMyAdmin on GKE Autopilot

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
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
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
| `container_port` | `80` | Apache listens on port 80. |
| `min_instance_count` | `1` | Minimum replicas; GKE has no scale-to-zero, keep ≥ 1 so the console is reachable. |
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
