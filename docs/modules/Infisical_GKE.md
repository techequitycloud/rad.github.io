---
title: "Infisical on GKE Autopilot"
description: "Configuration reference for deploying Infisical on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Infisical on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Infisical_GKE.png" alt="Infisical on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Infisical is an open-source, end-to-end encrypted secrets management platform:
teams and CI/CD pipelines store, inject, and rotate application secrets from a
single platform, using client SDKs, a CLI, or the web UI. This module deploys
Infisical on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation,
which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

This guide focuses on the cloud services Infisical uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

Infisical runs as a Node.js pod (a custom-built image wrapping the official
`infisical/infisical` image) as a stateless `Deployment`. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Custom-built Node.js pods, 2 vCPU / 2Gi by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Infisical does not support MySQL or other engines |
| Cache & rate-limiting | Redis (optional, on by default) | NFS-hosted Redis by default, or an authenticated external Redis via `redis_auth` |
| Secrets | Secret Manager | Auto-generated `ENCRYPTION_KEY`, `AUTH_SECRET`, `ADMIN_PASSWORD`; database password |
| Ingress | Cloud Load Balancing | External `LoadBalancer` Service by default, with a reserved static IP |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** `database_type` defaults to `POSTGRES_15` and is
  the only value Infisical supports.
- **The container image is custom-built, not the upstream image.** `Infisical_Common`
  builds `FROM infisical/infisical:${INFISICAL_VERSION}` with a wrapper `entrypoint.sh`
  that assembles the database connection string at container start.
  `application_version = "latest"` maps to a pinned known-good release
  (`v0.162.10`) as the build arg.
- **Redis defaults on, and its wiring is mutually exclusive by construction.** When
  `redis_auth` is empty (the default), the Foundation's own NFS-hosted Redis
  plain-env injection supplies `REDIS_HOST`/`REDIS_PORT`. When `redis_auth` is set,
  `Infisical_Common` instead creates and injects its own `REDIS_URL` secret.
- **`site_url` does not auto-compute on GKE.** Unlike the Cloud Run variant, this
  module passes `site_url` straight through with no predicted-URL computation.
  Leaving it empty means `SITE_URL` — and the `admin-bootstrap` job's target —
  falls back to `http://localhost:8080`, which is not reachable from the
  bootstrap job's own pod. See [§3](#3-infisical-application-behaviour).
- **The health probes target HTTP `/api/status`,** unlike the Cloud Run variant's
  TCP-only startup probe. Allow a generous `initial_delay_seconds`/
  `failure_threshold` on first boot — that endpoint only returns 2xx once the
  database (and Redis, if enabled) connections are healthy.
- **No object storage is mounted.** A generic `data` GCS bucket is provisioned via
  the Foundation's `storage_buckets` variable, but `gcs_volumes` is empty by
  default — Infisical keeps all persistent state in PostgreSQL.
- **`postgres_extensions` is vestigial for this app.** The variable defaults to
  `["vector", "uuid-ossp"]` (a leftover from the module's origin template) but is
  never forwarded to `App_GKE` — `Infisical_Common` hardcodes
  `enable_postgres_extensions = false`. Infisical does not use pgvector.
- **The admin account is bootstrapped headlessly, not via the web UI.** An
  `admin-bootstrap` init job runs the `infisical` CLI's `bootstrap` command against
  the running server. On GKE the job's pod is scheduled immediately and retries
  until the server answers — see [§3](#3-infisical-application-behaviour).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Infisical workload

Infisical pods are scheduled on Autopilot, which bills for the CPU/memory the
pods actually request. Horizontal Pod Autoscaling sizes the deployment between the
minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Infisical workload for
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type are
managed.

### B. Cloud SQL for PostgreSQL 15

Infisical stores all application data (secrets, projects, organizations, users,
audit logs) in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it
privately through the **Cloud SQL Auth Proxy** sidecar over loopback
(`enable_cloudsql_volume = true` by default). On first deploy, the `db-init`
initialization job creates the application database and role.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the connection model,
automated backups, and password rotation.

### C. Redis (cache & rate-limiting)

Redis is **enabled by default** (`enable_redis = true`). When `redis_host` is left
empty, the NFS server VM's IP is used as the default Redis host. When `redis_auth`
is set, `Infisical_Common` provisions its own `REDIS_URL` Secret Manager secret
instead of relying on the Foundation's plain-env injection.

- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm which Redis path is active in the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### D. Secret Manager

Three cryptographic secrets are generated automatically and stored in Secret
Manager: `ENCRYPTION_KEY` (encrypts every secret Infisical stores),
`AUTH_SECRET` (signs JWT session tokens), and `ADMIN_PASSWORD` (consumed only
by the `admin-bootstrap` job, never injected into the running pod). A
`REDIS_URL` secret is created conditionally. The database password is managed
separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~infisical"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`, `reserve_static_ip = true`), so the address
survives redeploys. A custom domain with a Google-managed certificate can be
enabled.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Infisical Application Behaviour

- **First-deploy database setup.** The `db-init` initialization job runs
  `postgres:15-alpine`, connects through the Cloud SQL Auth Proxy, and idempotently
  creates the application role and database. `execute_on_apply = true`, so this
  runs on every apply and is safe to re-run.
- **The database connection string is assembled at container start.** Infisical
  accepts a single `DB_CONNECTION_URI`; `entrypoint.sh` URL-encodes `DB_PASSWORD`
  and builds the URI from the discrete `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/
  `DB_NAME` values the Foundation injects, branching `sslmode` on `DB_HOST`'s shape
  (the GKE Cloud SQL Auth Proxy sidecar's `127.0.0.1` loopback → `disable`).
- **The admin account is bootstrapped headlessly, and retries until the server is
  reachable.** The `admin-bootstrap` init job (image `infisical/cli:latest`,
  depends on `db-init`) runs `infisical bootstrap --ignore-if-bootstrapped`
  against `INFISICAL_API_URL` (derived from `site_url`). On GKE,
  `execute_on_apply = false` only gates Terraform's *wait* for the job — the job's
  pod is still scheduled and runs immediately, retrying up to 20 times (15s apart).
  **This only works if `site_url` resolves to the actual reachable service.** If
  `site_url` is left empty, `INFISICAL_API_URL` defaults to
  `http://localhost:8080` — unreachable from the job's own pod — and every attempt
  fails. Set `site_url` to the external LoadBalancer IP or custom domain (known
  after the Service has an external IP) before or shortly after the first apply,
  then re-apply so the job can succeed:
  ```bash
  kubectl get svc <service-name> -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  # set site_url = "https://<that-ip-or-domain>" and re-apply
  ```
- **The admin password lives only in Secret Manager.** Retrieve the bootstrapped
  credential with:
  ```bash
  gcloud secrets versions access latest --secret=<prefix>-infisical-admin-password --project "$PROJECT"
  ```
- **Health endpoint.** `/api/status` returns HTTP 200 with a JSON body once
  Infisical, its database connection, and (if enabled) Redis are all healthy. The
  startup and liveness probes target this path directly on GKE (unlike the Cloud
  Run variant's TCP-only probe) — allow the default generous delay/threshold on
  first boot while migrations run.
- **Redis is optional but on by default.** Set `enable_redis = false` only if no
  caching/rate-limiting backend is desired.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Infisical are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `infisical` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Infisical` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Image version tag. `"latest"` maps to a pinned build arg (`v0.162.10`). |
| `site_url` | `""` | Public URL for `SITE_URL` and the `admin-bootstrap` CLI target. **Passed through unchanged — no automatic URL prediction on GKE.** See [§3](#3-infisical-application-behaviour). |
| `admin_email` | `admin@techequity.cloud` | Email for the bootstrapped first super-admin account. |
| `admin_organization` | `Default Organization` | Organization name created for the bootstrapped account. |
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `2000m` | CPU per pod. |
| `memory_limit` | `2Gi` | Memory per pod. |
| `container_port` | `8080` | Port Infisical listens on. |
| `min_instance_count` | `0` | Minimum replicas (HPA `minReplicas`). |
| `max_instance_count` | `3` | Maximum replicas (HPA `maxReplicas`). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar. |
| `enable_image_mirroring` | `true` | Mirror the built image into Artifact Registry. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Core Infisical vars are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `smtp_host` / `smtp_port` / `smtp_user` / `smtp_password` / `smtp_secure_enabled` / `mail_from` | various | **Declared but not forwarded to `Infisical_Common` — inert, no effect on the deployment.** |

### Group 6 — GKE Backend Configuration

| Variable | Default | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Leave empty for auto-discovery. |
| `namespace_name` | `""` | Leave empty to auto-generate. |
| `workload_type` | `Deployment` | Fixed to `Deployment` at the `infisical.tf` call site — Infisical keeps no state that survives a pod restart. |
| `service_type` | `LoadBalancer` | External access by default. |
| `session_affinity` | `ClientIP` | Foundation default; Infisical's own auth is JWT-based, so this is not a hard requirement. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/status` | Forwarded to `Infisical_Common`. Returns 200 once DB (and Redis, if enabled) connections are healthy. |
| `liveness_probe` | HTTP `/api/status`, 60s initial delay | Forwarded to `Infisical_Common`. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Optional Cloud Monitoring uptime check — consider pointing `path` at `/api/status`. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Only relevant here as the default source of the Redis host IP when `redis_host` is empty. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | Foundation-level default bucket — **provisioned but never mounted**. |
| `gcs_volumes` | `[]` | Empty by default and unused by Infisical. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Enable Redis for caching and rate-limiting. |
| `redis_host` | `""` | Leave blank to default to the NFS server IP. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` (sensitive) | When set, switches Infisical to `Infisical_Common`'s own `REDIS_URL` secret. |
| `cubejs_api_url` / `hub_api_url` | localhost URLs | **Declared but not forwarded to `Infisical_Common` — inert, no effect.** |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Infisical requires PostgreSQL. |
| `db_name` | `infisical` | PostgreSQL database name. Do not change after initial deployment. |
| `db_user` | `infisical` | Application database user. Password auto-generated in Secret Manager. |
| `postgres_extensions` / `enable_postgres_extensions` | `["vector","uuid-ossp"]` / `true` | **Vestigial — not forwarded to `App_GKE`.** `Infisical_Common` hardcodes `enable_postgres_extensions = false`. Infisical does not use pgvector. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision a Gateway for custom hostnames + SSL. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys — important since `site_url` must reference a durable address for `admin-bootstrap` and OAuth/email links. |

All remaining groups (Backup & Maintenance, CI/CD, Custom SQL, IAP, Cloud Armor,
StatefulSet, Reliability Policies, VPC Service Controls) behave exactly as
documented in [App_GKE](App_GKE.md).

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` / `service_external_ip` | In-cluster ClusterIP / external LoadBalancer IP. |
| `service_url` | URL to reach Infisical. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (`127.0.0.1` via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (the unused `data` bucket). |
| `network_name` | VPC network name. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` | Whether monitoring is configured. |
| `initialization_jobs` | Names of the `db-init` and `admin-bootstrap` jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `artifact_registry_repository` | CI/CD status and registry. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `audit_logging_enabled` | Security posture. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values and combinations at plan time. Invalid configuration fails the **plan** with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `ENCRYPTION_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it makes every previously stored secret permanently undecryptable. |
| `AUTH_SECRET` (auto-generated) | Only rotate in a maintenance window | Critical | Rotating it invalidates all active user sessions. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_redis` | Forward `var.enable_redis` unconditionally to `App_GKE` | Critical | Hardcoding it to `false` at the Foundation call leaves `REDIS_URL` completely unset in the common no-auth case — Infisical crashes at boot. |
| `database_type` | `POSTGRES_15` | Critical | MySQL is not supported; any non-Postgres value breaks the connection entirely. |
| `site_url` | Set after first deploy, once the LoadBalancer IP/domain is known | High | Left empty, `admin-bootstrap` targets an unreachable `localhost:8080` inside its own pod and every attempt fails — no admin account is ever created. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity on GKE. |
| `postgres_extensions` / `enable_postgres_extensions` | N/A | Low | Declared but not forwarded to `App_GKE` — setting them has no effect; Infisical does not need pgvector. |
| `smtp_host` / `smtp_user` / `smtp_password` / `mail_from` / `cubejs_api_url` / `hub_api_url` | N/A | Low | Declared for convention-mirroring parity but never forwarded to `Infisical_Common` — setting them has no effect. |
| `reserve_static_ip` | `true` (default) | Medium | Without a stable IP, `service_url`/`site_url` can reference a stale address across redeploys. |
| `memory_limit` | `2Gi` (default) or higher | Medium | Lower values risk OOM under concurrent secret-fetch load. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Infisical-specific application configuration shared
with the Cloud Run variant is described in
**[Infisical_Common](Infisical_Common.md)**.
