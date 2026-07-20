---
title: "Mealie on GKE Autopilot"
description: "Configuration reference for deploying Mealie on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Mealie on GKE Autopilot

Mealie is an open-source, self-hosted recipe manager and meal planner with a
FastAPI backend and a Vue frontend, offering automatic recipe import by URL
alongside a manual UI editor. This module deploys Mealie on **GKE Autopilot**
on top of the [App_GKE](App_GKE.md) foundation, which provisions and manages
the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Mealie uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Mealie runs as a single FastAPI/Vue web workload. The deployment wires
together a small, focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | FastAPI pod, 1 vCPU / 512 MiB by default |
| Database | Cloud SQL for PostgreSQL 15 | Mealie reads discrete `POSTGRES_*` env vars, not a constructed DSN |
| Object storage | Cloud Storage | A `data` bucket is created for recipe images, but not auto-mounted |
| Cache & queue | none | Mealie has no Redis or queue dependency |
| Secrets | Secret Manager | Database password only — Mealie has no env-configurable admin credential |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL is the standardized engine.** `Mealie_Common` fixes
  `database_type = "POSTGRES_15"` and sets `DB_ENGINE=postgres` explicitly.
- **No custom container build.** The official prebuilt image
  (`ghcr.io/mealie-recipes/mealie`) is used directly.
- **Default admin account, not first-registration — and it is NOT
  configurable.** Mealie's initial credential can no longer be set via
  environment variables as of v3.x (see the
  [Common guide](Mealie_Common.md)). Every deployment boots the same
  well-known account: `changeme@example.com` / `MyPassword`. Log in immediately
  after first deploy and complete the forced password reset.
- **`workload_type = "Deployment"`, not `StatefulSet`.** Mealie keeps no local
  state beyond what's already in Cloud SQL — no PVC, no NFS mount required.
- **Recipe images are not persisted by default.** A GCS bucket is created but
  not auto-mounted — add a `gcs_volumes` entry if uploaded recipe images need
  to survive a pod restart.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set.

### A. GKE Autopilot — the Mealie workload

- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

### B. Cloud SQL for PostgreSQL 15

Pods reach the database privately through the **cloud-sql-proxy** sidecar over
`127.0.0.1`.

- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage

- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~mealie"
  ```

### D. Secret Manager

- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~mealie"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Networking & ingress

- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```

### F. Cloud Logging & Monitoring

- **CLI:**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Mealie Application Behaviour

- **First-deploy database setup.** An initialization Job runs
  `create-db-and-user.sh`, idempotently creating the application role and
  database.
- **Schema migrations on start.** Mealie applies its own internal migrations
  automatically on every pod start.
- **Fixed default admin credential — not configurable.** Mealie creates
  `changeme@example.com` / `MyPassword` on first database initialisation. This is
  a hardcoded upstream default (no env var overrides it as of v3.x), not a
  generated secret — a password reset is forced on first login, and operators
  must complete it immediately after deploy.
- **Health path.** Startup and liveness probes target `/api/app/about`.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Mealie are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `mealie` | Base name for resources. |
| `application_version` | `latest` | Mealie publishes a genuine `latest` tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | No custom build needed. |
| `container_port` | `9000` | Mealie's native default port. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | HPA scaling bounds. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | one `data` bucket | Created but not auto-mounted. |
| `stateful_pvc_enabled` | `false` | Not used — Mealie is stateless at the pod level. |

### Group 12 (16) — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed by `Mealie_Common`. |
| `db_host_env_var_name` | `POSTGRES_SERVER` | Aliases the platform `DB_HOST` onto Mealie's expected name. |
| `db_user_env_var_name` | `POSTGRES_USER` | Aliases `DB_USER`. |
| `db_password_env_var_name` | `POSTGRES_PASSWORD` | Aliases `DB_PASSWORD`. |
| `db_name_env_var_name` | `POSTGRES_DB` | Aliases `DB_NAME`. |
| `db_port_env_var_name` | `POSTGRES_PORT` | Aliases `DB_PORT`. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` / `health_check_config` | HTTP `/api/app/about` | Probes target Mealie's real info endpoint. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Kubernetes Service identity and address. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Cloud SQL connection details. |
| `storage_buckets` | The `data` bucket for recipe images. |
| `kubernetes_ready` | Whether the workload reached Ready state. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `container_image_source` | `prebuilt` (default) | High | `"custom"` triggers an unnecessary Cloud Build with no Dockerfile in this module. |
| Default admin credential (`changeme@example.com` / `MyPassword`) | Log in and change it immediately after first deploy | **Critical** | This is a fixed, publicly documented upstream default — not a generated secret — as soon as the DB initialises, anyone who knows Mealie's default credential can log in until you complete the forced first-login password reset. |
| `gcs_volumes` for recipe images | Add explicitly if needed | Medium | Without it, uploaded recipe images live on the pod's ephemeral filesystem and do not survive a restart. |
| `db_*_env_var_name` variables | Leave at their Mealie-specific defaults | Critical | Changing/clearing these breaks Mealie's Postgres connection — it reads `POSTGRES_*`, not `DB_*`. |

---

For the foundation behaviour referenced throughout — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Mealie-specific
application configuration shared with the Cloud Run variant is described in
**[Mealie_Common](Mealie_Common.md)**.
