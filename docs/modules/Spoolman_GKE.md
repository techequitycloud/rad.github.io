---
title: "Spoolman on GKE Autopilot"
description: "Configuration reference for deploying Spoolman on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Spoolman on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Spoolman_GKE.png" alt="Spoolman on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Spoolman is a free, open-source inventory and usage tracker for 3D-printing
filament spools — vendors, materials, remaining weight, cost per spool, and
per-print consumption. It ships as a single-process Python/FastAPI backend with
a bundled static Vue/Quasar frontend. This module deploys Spoolman on
**GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which
provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Spoolman uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Spoolman runs as a single Python/FastAPI pod — there is no separate frontend
workload; the Vue/Quasar UI is bundled and served from the same process. The
deployment wires together a minimal set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Prebuilt `ghcr.io/donkie/spoolman` image, 1 vCPU / 512Mi by default |
| Database | Cloud SQL for PostgreSQL 15 | Required — this module standardises on Postgres (Spoolman upstream also supports MySQL/SQLite/CockroachDB) |
| Object storage | None | Spoolman keeps all state in Postgres; no GCS bucket is provisioned |
| Cache | None | Spoolman has no Redis/cache integration |
| Secrets | Secret Manager | Only the auto-generated database password — Spoolman has no admin/API-key bootstrap secret of its own |
| Ingress | Cloud Load Balancing | External LoadBalancer by default |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is the only supported engine in this module.** `database_type`
  is fixed by `Spoolman_Common`; Spoolman upstream also supports MySQL and
  CockroachDB via env vars, but this module does not expose that choice.
- **No custom build.** `container_image_source = "prebuilt"` deploys
  `ghcr.io/donkie/spoolman` directly — there is no Dockerfile, no Cloud Build
  step.
- **No init job.** The Foundation auto-creates the Postgres role and database;
  Spoolman runs its own Alembic migrations automatically on every container
  start.
- **No application secrets.** Spoolman ships with **no authentication at all** —
  whoever can reach the Service has full read/write access to the inventory.
  There is no login gate to bootstrap and nothing generated in Secret Manager
  beyond the database password. If that is not acceptable, put the service
  behind IAP (`enable_iap = true`) or a Cloud Armor IP allowlist.
- **`service_type = "LoadBalancer"` by default.** Spoolman is a browser-driven
  web UI, so the Service is externally reachable out of the box.
- **`reserve_static_ip = false` by default.** Spoolman bakes no
  self-referencing URL into boot-time config (only `SPOOLMAN_CORS_ORIGIN`
  matters, and only for cross-domain access), so this module conserves the
  project's often-tight static-IP quota by not reserving one.
- **Connections use the cloud-sql-proxy sidecar's loopback, not TCP.**
  Spoolman's SQLAlchemy layer builds its connection via `URL.create()` (a
  structured object, not string concatenation), so `127.0.0.1` passes through
  cleanly with no URL-parsing issue and no TLS/`sslmode` configuration needed.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Spoolman workload

Spoolman runs as a single Deployment/pod on Autopilot, which bills for the
CPU/memory the pod actually requests.

- **Console:** Kubernetes Engine → Workloads → select the Spoolman workload for
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot and scaling are managed.

### B. Cloud SQL for PostgreSQL 15

Spoolman stores all inventory data (spools, filaments, vendors, usage history)
in a managed Cloud SQL for PostgreSQL 15 instance. The pod reaches it privately
through the **Cloud SQL Auth Proxy** sidecar over loopback; no public IP is
exposed. There is no initialization job — Spoolman applies its own schema
migrations on every boot.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the connection model,
backups, and password rotation.

### C. Secret Manager

Only the auto-generated database password lives in Secret Manager — Spoolman
has no admin account or API key of its own to bootstrap.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~spoolman"
  gcloud secrets versions access latest --secret=<db-password-secret> --project "$PROJECT"
  ```

### D. Networking & ingress

The Service is reachable at its external LoadBalancer IP by default
(`service_type = "LoadBalancer"`, `reserve_static_ip = false` so the IP is
ephemeral unless changed).

- **Console:** Kubernetes Engine → Services & Ingress.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```

See [App_GKE](App_GKE.md) for custom domains, CDN, and Cloud Armor.

### E. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

---

## 3. Spoolman Application Behaviour

- **No first-deploy database setup job.** Unlike most application modules in
  this catalogue, Spoolman needs no `db-init` job — the Foundation creates the
  Postgres role and database, and Spoolman's own Alembic migrations run
  automatically on every container start (including the very first boot).
- **No authentication.** There is no login page, no admin account, and no API
  key gate. Anyone who can reach the Service can view and modify the entire
  inventory. Decide your access-control approach (IAP, Cloud Armor allowlist,
  or accept public read/write) before exposing the LoadBalancer IP.
- **Health path.** `/api/health` is public and unauthenticated, returning a
  200/OK JSON status once the server (and its DB connection) is up. Both the
  startup and liveness probes target this path.
- **Database engine locked to Postgres.** Spoolman's own `SPOOLMAN_DB_TYPE`
  environment variable selects the engine; this module always sets it to
  `postgres`. Never unset it via `environment_variables` — without it,
  Spoolman silently falls back to a throwaway container-local SQLite file
  with no error at all.
- **Inspect Cloud SQL connectivity:**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i spoolman_db
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Spoolman are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `spoolman` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Spoolman` | Human-readable name. |
| `application_version` | `latest` | Image tag pulled from `ghcr.io/donkie/spoolman`. Genuinely prebuilt — no Dockerfile/build-arg pinning concerns. |

### Group 4 — Container & Scale

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Forwarded to the Foundation — required, or the default `"custom"` silently triggers a Kaniko build attempt with no Dockerfile. |
| `container_port` | `8000` | Spoolman's default listen port. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Ample for a single-tenant filament tracker. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Scale-to-zero is safe — Spoolman has no background work. |

### Group 16 — Database

| Variable | Default | Description |
|---|---|---|
| `db_host_env_var_name` | `SPOOLMAN_DB_HOST` | Aliases the Foundation's `DB_HOST` (`127.0.0.1` via the cloud-sql-proxy sidecar on GKE). |
| `db_user_env_var_name` | `SPOOLMAN_DB_USERNAME` | Aliases `DB_USER`. |
| `db_password_env_var_name` | `SPOOLMAN_DB_PASSWORD` | Aliases `DB_PASSWORD`. |
| `db_name_env_var_name` | `SPOOLMAN_DB_NAME` | Aliases `DB_NAME`. |
| `db_port_env_var_name` | `SPOOLMAN_DB_PORT` | Aliases `DB_PORT`. |
| `application_database_name` / `application_database_user` | `spoolman` / `spoolman` | Immutable after first deploy. |

### Group 14 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `false` | No GCS bucket needed — all state lives in Cloud SQL. |
| `enable_nfs` | `false` | No shared filesystem needed. |

### Group 19 — Networking

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Spoolman is a browser-driven web UI, exposed externally by default. |
| `reserve_static_ip` | `false` | Conserves the project's static-IP quota; Spoolman bakes no self-referencing URL into boot-time config. |

### Group 10 — Probes & Lifecycle

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/api/health`, 10s delay | Public, unauthenticated. |
| `health_check_config` | HTTP `/api/health`, 30s period | Public, unauthenticated. |

All other inputs (CI/CD, backups, VPC-SC, Cloud Armor, IAP, Redis, stateful
PVCs) are inherited from [App_GKE](App_GKE.md) with standard behaviour —
Spoolman uses none of them by default.

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Kubernetes namespace. |
| `service_cluster_ip` | Internal ClusterIP. |
| `service_external_ip` | External LoadBalancer IP. |
| `service_url` | Full URL of the deployed workload. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Always empty — Spoolman needs no GCS bucket. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo (when mirroring is enabled). |
| `monitoring_enabled` | Monitoring status. |
| `initialization_jobs` | Always empty — Spoolman needs no init job. |
| `kubernetes_ready` | Whether the workload reports ready. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| No authentication (built-in) | Front with IAP or Cloud Armor if needed | Critical | Anyone who can reach the Service can read and modify the entire filament inventory — there is no login gate to disable. |
| `SPOOLMAN_DB_TYPE` (auto-injected `postgres`) | Never unset via `environment_variables` | Critical | Unsetting it silently falls back to a throwaway container-local SQLite file — no error, and all data is lost on every pod restart. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `container_image_source` | `prebuilt` (do not override to `custom`) | Critical | Setting `"custom"` triggers a Kaniko build attempt against a module with no Dockerfile — the build fails outright. |
| `service_type` | `LoadBalancer` (default) | High | Switching to `ClusterIP` makes the service unreachable from a browser without `kubectl port-forward` or a separate ingress. |
| `SPOOLMAN_DB_QUERY` | Leave empty unless troubleshooting | Medium | Escape hatch for a TCP + `sslmode` fallback — only needed if the loopback connection path is ever found unreliable; not required for normal operation. |
| `reserve_static_ip` | `false` (default) | Low | Set `true` only if you need a stable IP for DNS/firewall allowlisting — the project's static-IP quota is limited and shared across the tenant. |
| `min_instance_count` | `0` (default) | Low | Spoolman has no background work, so scale-to-zero is safe. |

---

For the foundation behaviour referenced throughout — Workload Identity,
scaling, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Spoolman-specific application configuration shared
with the Cloud Run variant is described in
**[Spoolman_Common](Spoolman_Common.md)**.
