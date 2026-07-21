---
title: "Payload CMS on GKE Autopilot"
description: "Configuration reference for deploying Payload CMS on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Payload CMS on GKE Autopilot

Payload CMS is a TypeScript-native, code-first headless CMS and application framework built
directly on Next.js — not a hosted SaaS product, but a library installed into your own Next.js
application. Content is modeled through typed "Collections" defined in `payload.config.ts`, and
Payload generates an admin UI plus REST, GraphQL, and Local APIs from that same config. This
module deploys a real Payload application on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud and
Kubernetes infrastructure.

This guide focuses on the cloud services this deployment uses and how to explore and operate them
from the Google Cloud Console and the command line. For the mechanics that are common to every
GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Payload runs as a Node.js (Next.js) pod on GKE Autopilot. There is **no official Payload Docker
image** — this module builds a real, locally-verified starter application from source (a blank
`create-payload-app` template using the PostgreSQL adapter) via Cloud Build. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js (Next.js standalone) pods, horizontally autoscaled |
| Build | Cloud Build | Builds the bundled Payload starter app from `Payload_Common/scripts/Dockerfile` — no prebuilt image exists to pull |
| Database | Cloud SQL for PostgreSQL 15 | Required — Payload's Postgres adapter is used; MySQL/MongoDB are not wired |
| Object storage | None | No bucket is provisioned; media uploads go to local, ephemeral container disk |
| Secrets | Secret Manager | Auto-generated `PAYLOAD_SECRET`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer by default, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory and schema is not created on boot.** Booting the built server
  against a fresh database creates zero tables — the `payload-migrate` init job applies schema via
  the `payload migrate` CLI, using a pre-generated migration file baked into the image.
- **`container_image_source` is fixed at `"custom"`.** There is nothing to deploy without a Cloud
  Build run — the module always builds `Payload_Common/scripts/` from source.
- **Health probes target `/admin`, not `/` or an API route.** `/admin` serves Payload's
  login/first-user-creation form and returns an unauthenticated `200`; Payload's REST/GraphQL
  routes require auth and are unsuitable probe targets.
- **No storage bucket is provisioned.** Uploaded media is written to local container disk and
  does not survive a pod restart or redeploy.
- **`enable_redis` and related Group 21 variables are declared but inert.** They are not forwarded
  to `Payload_Common`, which has no Redis wiring.
- **`service_type` defaults to `LoadBalancer`.** This deployment's own live verification used
  `ClusterIP` only because the target project's `IN_USE_ADDRESSES` static IP quota was exhausted
  at deploy time — an operational choice made for that specific deployment, not a module default.
  Flip back to `LoadBalancer` (or reserve a static IP) once quota is available.
- **The first admin user is created manually.** Payload has no non-interactive CLI for this —
  visiting `/admin` on an empty `users` collection shows a signup form.
- **Minimum 1 replica is maintained by default** (`min_instance_count = 1`).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other identifiers are
reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Payload workload

Payload pods are scheduled on Autopilot, which bills for the CPU/memory the pods actually
request.

- **Console:** Kubernetes Engine → Workloads → select the Payload workload to see pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type (Deployment vs
StatefulSet) are managed.

### B. Cloud Build — building the Payload image

Because no official Payload image exists, every deploy (and every redeploy after a Dockerfile or
source change) triggers a Cloud Build run against `Payload_Common/scripts/`.

- **Console:** Cloud Build → History.
- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --limit=10
  gcloud builds log <build-id> --project "$PROJECT"
  ```

### C. Cloud SQL for PostgreSQL 15

Payload stores all application data (Collections, users, uploaded document metadata) in a managed
Cloud SQL for PostgreSQL 15 instance. Pods reach it privately through the **Cloud SQL Auth Proxy**
sidecar over a Unix socket; no public IP is exposed. On first deploy, `db-init` creates the
database and role, then `payload-migrate` applies the schema.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the password are
all surfaced in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the connection model,
automated backups, and password rotation.

### D. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager: `PAYLOAD_SECRET`
(used to sign Payload's own session/auth tokens). The database password is managed separately by
the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`). A custom domain with a Google-managed certificate can be
enabled, and a static IP can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

If the deployment was set to `service_type = "ClusterIP"` (for example because static IP quota
was exhausted at deploy time), reach the app from inside the cluster instead:

```bash
kubectl port-forward -n "$NAMESPACE" svc/<service-name> 18080:3000
curl -s http://localhost:18080/admin -o /dev/null -w '%{http_code}\n'
```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Payload Application Behaviour

- **First-deploy database setup.** `db-init` (using `postgres:15-alpine`) connects through the
  Cloud SQL Auth Proxy and idempotently creates the application role and database.
- **Schema migration is a separate, dependent job.** `payload-migrate` (`depends_on_jobs =
  ["db-init"]`) runs `./node_modules/.bin/payload migrate` from a full `/app/cli` copy of
  `node_modules` + TypeScript source baked into the image — the trimmed Next.js standalone runtime
  used to serve traffic does not include the Payload CLI or its dependencies. On GKE the Cloud SQL
  Auth Proxy runs as a native sidecar; the migrate script signals it to stop via
  `http://localhost:9091/quitquitquit` after migrations complete.
- **`PAYLOAD_SECRET` should be treated as immutable after first boot.** It signs Payload's
  session/auth tokens; rotating it invalidates all active sessions.
- **Health path.** Startup and liveness probes target `/admin` — Payload's admin UI route, which
  returns an unauthenticated `200` once the Node.js server and database connection are ready.
  Allow several minutes on first boot for the `payload-migrate` job to complete before the service
  is expected to serve real content.
- **First admin account.** Payload has no CLI command to create the first admin user
  non-interactively. Visit `$SERVICE_URL/admin` (or `kubectl port-forward` if `ClusterIP`) — with
  an empty `users` collection Payload shows a signup form to create the first administrator. This
  is a manual, one-time operator step.
- **Media uploads do not persist.** No storage bucket is provisioned; uploaded files are written
  to local container disk and are lost on the next pod restart or redeploy.
- **`service_type` may need a manual flip.** If exposed as `ClusterIP` due to IP quota
  constraints, the app is reachable only via `kubectl port-forward`/`kubectl exec` until it is
  flipped back to `LoadBalancer` (or a static IP is reserved) and re-applied.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific
to or notable for Payload are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `payload` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Payload CRM` | Human-readable name shown in the Console. Leftover text from the module's clone source — override to `Payload CMS` at deploy time; it is cosmetic only. |
| `application_version` | `latest` | Deployment-tracking tag baked into the image via the Cloud Build `application_version` build arg. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Fixed — there is no prebuilt Payload image to deploy. |
| `min_instance_count` / `max_instance_count` | `1` / `3` | Minimum replicas kept warm; GKE does not scale to zero. |
| `container_port` | `3000` | Next.js default. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="1Gi" }` | Payload (Next.js) needs headroom for the standalone server plus the migrate job's TypeScript/CLI footprint; consider raising memory for production. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |
| `enable_image_mirroring` | `true` | Mirrors the built image into Artifact Registry. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not set `PAYLOAD_SECRET` or `DATABASE_URL` here — both are computed automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. Set to `ClusterIP` if the project's static IP quota is exhausted; access via `kubectl port-forward` instead. |
| `workload_type` | `null` (resolves to `Deployment`) | Payload has no need for per-pod PVCs by default. |
| `session_affinity` | `None` | No sticky-session requirement for this minimal starter app. |

### Group 11 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `enable_gcs_storage` | `false` | Declared in `variables.tf` with a description implying an S3-compatible GCS storage adapter, but **not forwarded** to `Payload_Common` — has no effect. `Payload_Common`'s `storage_buckets` output is always `[]`. |
| `gcs_volumes` | `[]` | Genuinely forwarded — GCS Fuse volume mounts, if you want to wire persistent storage in yourself. |

### Group 13 — Filesystem (NFS) & Jobs

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` → `payload-migrate` chain. |
| `enable_nfs` | `false` | Not required — Payload's own data lives in Postgres, not NFS. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/admin`, 120s delay, 15s period, 40 retries | ~12-minute total window for first-boot migrations to complete. |
| `health_check_config` | HTTP `/admin`, 30s delay | Liveness probe. |

### Group 15 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed; Payload requires PostgreSQL. |
| `application_database_name` / `application_database_user` | `payload` / `payload` | PostgreSQL database name and application user. Immutable after first deploy. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Stable external IP across redeploys — useful once `service_type = LoadBalancer` is restored after any temporary `ClusterIP` fallback. |

### Group 21 — Cloud Armor & Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` / `redis_host` / `redis_port` / `redis_auth` | `true` / `""` / `6379` / `""` | **Inert.** Declared in `variables.tf` (with a description claiming Payload v0.4+ requires Redis) but never forwarded to `Payload_Common`, which has no Redis wiring at all. Setting these has no effect. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate and
explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved or `service_type = LoadBalancer`). |
| `service_url` | URL to reach Payload. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Always empty — no bucket is provisioned. |
| `container_image` / `container_registry` | Built image and Artifact Registry repo. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) — **Medium**
> (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `PAYLOAD_SECRET` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates every active session, forcing all users to log back in. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `startup_probe_config` / `payload-migrate` timing | Allow the full ~12-minute window | High | If the probe window is shortened below the time `payload-migrate` needs, the pod can be marked unhealthy before schema migration finishes, since the two run concurrently rather than the probe waiting on the job. |
| Media/upload persistence | Add a real storage adapter before production use | High | With no storage bucket wired, all uploaded media lives on local container disk and is lost on every pod restart or redeploy. |
| `service_type` | `LoadBalancer` (default) | High | If left at `ClusterIP` (e.g. after a quota-driven fallback), the app has no external reachability until flipped back. |
| `enable_gcs_storage` | Do not rely on this toggle | Medium | Declared but not forwarded to `Payload_Common` — enabling it does not provision or wire any storage. |
| `enable_redis` / `redis_*` | Do not rely on these toggles | Medium | Declared but not forwarded to `Payload_Common`, which has no Redis wiring — setting them has no effect. |
| First admin creation | Complete promptly after deploy | Medium | Until the first admin is created via the `/admin` signup form, the instance has no authenticated user at all. |
| `container_image_source` | Leave at `custom` | Low | There is no prebuilt Payload image; setting `prebuilt` without a valid `container_image` breaks the deploy. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity, autoscaling,
ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and
image mirroring — see **[App_GKE](App_GKE.md)**. Payload-specific application configuration
shared with the Cloud Run variant is described in **[Payload_Common](Payload_Common.md)**.
