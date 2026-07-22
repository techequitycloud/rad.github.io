---
title: "Ghostfolio on GKE Autopilot"
description: "Configuration reference for deploying Ghostfolio on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Ghostfolio on GKE Autopilot

Ghostfolio is an open-source, AGPL-licensed wealth management application for
tracking net worth, investment portfolios, and asset allocation across multiple
brokerage accounts and platforms — a privacy-first alternative to commercial
portfolio trackers. This module deploys Ghostfolio on **GKE Autopilot** on top of
the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Ghostfolio uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Ghostfolio runs as a NestJS (Prisma ORM) web workload. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | NestJS API + Angular frontend, 1 vCPU / 1 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Ghostfolio's Prisma ORM does not support MySQL |
| Cache & queue | Redis (**required**, not optional) | Market-data caching, sessions, and Bull queue/job management |
| Secrets | Secret Manager | Auto-generated `ACCESS_TOKEN_SALT` and `JWT_SECRET_KEY`; database password |
| Ingress | Cloud Load Balancing | External `LoadBalancer` Service by default; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; Ghostfolio's Prisma ORM does not support other engines.
- **Redis is mandatory, not optional.** Ghostfolio's own health endpoint checks
  Redis connectivity directly, so the app never reports healthy without it.
- **`ACCESS_TOKEN_SALT` and `JWT_SECRET_KEY` are generated automatically** and
  stored in Secret Manager. Both are boot-blocking. Rotating `ACCESS_TOKEN_SALT`
  after first boot invalidates every previously issued anonymous Security Token.
- **No seeded admin account.** The first visitor to the deployed URL clicks
  "Get Started" and the app mints a random Security Token as the account owner —
  there is no email/password form or first-run wizard to complete.
- **`service_type = "LoadBalancer"` by default.** Ghostfolio is a browser-facing
  web UI, so unlike internal-only apps (databases, admin tools) it needs a
  publicly reachable Service.
- **No bulk file/media storage is provisioned.** `enable_nfs` defaults `false` and
  `storage_buckets` is always empty.
- **`DATABASE_URL` is composed at runtime.** Ghostfolio's Prisma connection string
  is a URL-authority DSN; on GKE the cloud entrypoint uses the cloud-sql-proxy
  sidecar's `127.0.0.1` loopback with `sslmode=disable` when
  `enable_cloudsql_volume = true` (the default).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. Resource names are reported
in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Ghostfolio workload

Ghostfolio runs as a Kubernetes Deployment behind a Service. Autopilot manages node
provisioning and bin-packing automatically.

- **Console:** Kubernetes Engine → Workloads → select the Deployment.
- **CLI:**
  ```bash
  kubectl get deployment -n "$NAMESPACE"
  kubectl get pods -n "$NAMESPACE" -o wide
  kubectl describe deployment <deployment-name> -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" -l app=<app-label> --tail=100
  ```

See [App_GKE](App_GKE.md) for scaling, rollout strategy, and pod disruption
budgets.

### B. Cloud SQL for PostgreSQL 15

Ghostfolio stores all application data in a managed Cloud SQL for PostgreSQL 15
instance, reached via a cloud-sql-proxy sidecar listening on `127.0.0.1`. On first
deploy an initialization Job creates the application database and role.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Redis (required)

Redis backs market-data caching, sessions, and Bull queue/job management.

- **CLI:**
  ```bash
  kubectl exec -it -n "$NAMESPACE" <pod-name> -- sh -c 'echo -e "PING\r" | nc $REDIS_HOST $REDIS_PORT'
  # Confirm the pod's injected Redis env vars:
  kubectl exec -n "$NAMESPACE" <pod-name> -- env | grep REDIS
  ```

### D. Secret Manager

Two cryptographic secrets are generated automatically: `ACCESS_TOKEN_SALT` and
`JWT_SECRET_KEY`. The database password is managed separately by the foundation and
synced into the cluster via `SecretSync`.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Networking & ingress

The default `LoadBalancer` Service exposes an external IP. A Kubernetes Ingress
with a custom domain and managed certificate can be layered on via
`enable_custom_domain`.

- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  kubectl get ingress -n "$NAMESPACE"
  ```

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging automatically via the GKE logging agent;
metrics flow to Cloud Monitoring.

- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" resource.labels.namespace_name="'"$NAMESPACE"'"' --project "$PROJECT" --limit 50
  ```

---

## 3. Ghostfolio Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`, idempotently creating the application role, database, and
  grants.
- **Migrations and seeding run on EVERY container boot**, inside the same process
  as the server. The upstream `docker/entrypoint.sh` runs `prisma migrate deploy`,
  then `prisma db seed`, then starts the server — a failed migration crashes the
  container loudly instead of shipping a healthy pod against an empty database.
- **`ACCESS_TOKEN_SALT` and `JWT_SECRET_KEY` are immutable after first boot.**
  Rotating `ACCESS_TOKEN_SALT` invalidates every previously issued Security Token.
  Rotating `JWT_SECRET_KEY` logs everyone out.
- **No first-run form to fill in.** The first visitor mints their own Security
  Token via "Get Started" — no admin bootstrap step is required.
- **Health path.** Startup and liveness probes target `GET /api/v1/health`, which
  checks BOTH the database AND Redis connections and returns `503` until both are
  healthy.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Ghostfolio are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `ghostfolio` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Docker Hub's `ghostfolio/ghostfolio` publishes a real `latest` tag — pin for reproducible builds. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_resources` | `{ cpu_limit="1000m", memory_limit="1Gi" }` | 1 vCPU / 1 GiB is sufficient for typical usage. |
| `container_port` | `3333` | Ghostfolio's `DEFAULT_PORT`. |
| `enable_cloudsql_volume` | `true` | Runs the cloud-sql-proxy sidecar; `DB_IP` resolves to `127.0.0.1` and the cloud entrypoint uses `sslmode=disable`. |
| `container_image_source` | `custom` | Cloud Build wraps the prebuilt `ghostfolio/ghostfolio` image with a thin cloud entrypoint. |

### Group 6 — Kubernetes Placement & Networking

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Ghostfolio is a browser-facing web UI — do not switch to `ClusterIP` without a separate ingress path. |
| `namespace_name` | (auto-generated) | Kubernetes namespace. |

### Group 15 — Database

| Variable | Default | Description |
|---|---|---|
| `application_database_name` | `ghostfolio` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `ghostfolio` | Application database user. Password auto-generated in Secret Manager. |

### Group 13 — Jobs & NFS

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. No separate migrate job — migrations run inside the app container on every boot. |
| `enable_nfs` | `false` | Not required — Ghostfolio has no bulk file/media storage. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/api/v1/health`, 30s delay, 12-failure threshold | Checks BOTH database AND Redis connectivity. |
| `health_check_config` | HTTP `/api/v1/health`, 30s delay, 3-failure threshold | Same endpoint as the startup probe. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | REQUIRED — always forward unconditionally, never gate on `redis_host != ""`. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP. |
| `redis_auth` | `""` | Redis auth password (sensitive). Aliased at runtime onto Ghostfolio's own `REDIS_PASSWORD` env var. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `service_url` | URL of the deployed application (LoadBalancer IP, custom domain, or internal DNS). |
| `namespace` | Kubernetes namespace. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `storage_buckets` | Always empty — Ghostfolio needs no bulk file/media storage. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `initialization_jobs` | Names of the setup jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `ACCESS_TOKEN_SALT` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates every previously issued Security Token. |
| `JWT_SECRET_KEY` (auto-generated) | Only rotate in a maintenance window | Critical | Rotating it invalidates all active sessions. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_redis` | `true`, always forwarded unconditionally | Critical | Without it, Ghostfolio's health endpoint never reports healthy. |
| `service_type` | `LoadBalancer` | High | Switching to `ClusterIP` without a separate ingress path makes the app unreachable from outside the cluster. |
| `enable_cloudsql_volume` | `true` | High | Disabling it removes the proxy sidecar, so `DB_IP` falls back to the raw private IP and the cloud entrypoint's `sslmode` branching no longer matches a loopback connection. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |

---

For the foundation behaviour referenced throughout — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and
image mirroring — see **[App_GKE](App_GKE.md)**. Ghostfolio-specific application
configuration shared with the Cloud Run variant is described in
**[Ghostfolio_Common](Ghostfolio_Common.md)**.
