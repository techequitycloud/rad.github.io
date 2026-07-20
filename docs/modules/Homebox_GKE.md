---
title: "Homebox on GKE Autopilot"
description: "Configuration reference for deploying Homebox on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Homebox on GKE Autopilot

Homebox is an open-source, self-hosted home inventory and organization system
with a Go REST API backend (Echo-style, Ent ORM) and a Vue 3/Nuxt frontend
served embedded from the same binary — track items, attach photos, and
organize by location. This module deploys Homebox on **GKE Autopilot**
on top of the [App_GKE](App_GKE.md) foundation, which provisions and manages
the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Homebox uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Homebox runs as a single Go binary (API + embedded frontend) — one pod,
no sidecars beyond the Cloud SQL Auth Proxy. The deployment wires together a
small, focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Go/Echo pod, 1 vCPU / 512 MiB by default |
| Database | Cloud SQL for PostgreSQL 15 | Homebox reads discrete `HBOX_DATABASE_*` env vars, not a constructed DSN |
| Object storage | Cloud Storage | A `data` bucket is created for item photos/attachments, but not auto-mounted |
| Cache & queue | none | Homebox has no Redis or queue dependency |
| Secrets | Secret Manager | Database password plus `HBOX_AUTH_API_KEY_PEPPER` (a real, app-consumed secret) |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL is the standardized engine.** `Homebox_Common` fixes
  `database_type = "POSTGRES_15"` and sets `HBOX_DATABASE_DRIVER=postgres`
  explicitly.
- **No custom container build.** The official prebuilt image
  (`ghcr.io/sysadminsmedia/homebox`) is used directly.
- **Open self-registration, not a default admin account.** Homebox does not
  ship a hardcoded credential: the first person to submit the "Register"
  form on a fresh instance becomes the initial admin user. See the
  [Common guide](Homebox_Common.md) for detail. Operators should set
  `HBOX_OPTIONS_ALLOW_REGISTRATION=false` after completing registration.
- **`workload_type = "Deployment"`, not `StatefulSet`.** Homebox keeps no
  local state beyond what's already in Cloud SQL — no PVC, no NFS mount
  required.
- **Item photos are not persisted by default.** A GCS bucket is created but
  not auto-mounted — add a `gcs_volumes` entry if uploaded item photos and
  attachments need to survive a pod restart.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set.

### A. GKE Autopilot — the Homebox workload

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
  gcloud storage buckets list --project "$PROJECT" --filter="name~homebox"
  ```

### D. Secret Manager

- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~homebox"
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

## 3. Homebox Application Behaviour

- **First-deploy database setup.** An initialization Job runs
  `create-db-and-user.sh`, idempotently creating the application role and
  database.
- **Schema migrations on start.** Homebox's Ent ORM applies its own internal
  migrations automatically on every pod start.
- **Open self-registration — no default admin credential.** The first
  visitor to complete the "Register" form becomes the admin. There is no
  credential to retrieve, reset, or rotate — set
  `HBOX_OPTIONS_ALLOW_REGISTRATION=false` once the admin account exists to
  close public signups.
- **Health path.** Startup and liveness probes target `/api/v1/status` —
  Homebox's real, unauthenticated status endpoint.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Homebox are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `homebox` | Base name for resources. |
| `application_version` | `latest` | Homebox publishes a genuine `latest` tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | No custom build needed. |
| `container_port` | `7745` | Homebox's native default port. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | HPA scaling bounds. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | one `data` bucket | Created but not auto-mounted. |
| `stateful_pvc_enabled` | `false` | Not used — Homebox is stateless at the pod level. |

### Group 12 (16) — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed by `Homebox_Common`. |
| `db_host_env_var_name` | `HBOX_DATABASE_HOST` | Aliases the platform `DB_HOST` onto Homebox's expected name. |
| `db_user_env_var_name` | `HBOX_DATABASE_USERNAME` | Aliases `DB_USER`. |
| `db_password_env_var_name` | `HBOX_DATABASE_PASSWORD` | Aliases `DB_PASSWORD`. |
| `db_name_env_var_name` | `HBOX_DATABASE_DATABASE` | Aliases `DB_NAME`. |
| `db_port_env_var_name` | `HBOX_DATABASE_PORT` | Aliases `DB_PORT`. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` / `health_check_config` | HTTP `/api/v1/status` | Probes target Homebox's real status endpoint. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Kubernetes Service identity and address. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Cloud SQL connection details. |
| `storage_buckets` | The `data` bucket for item photos and attachments. |
| `kubernetes_ready` | Whether the workload reached Ready state. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `container_image_source` | `prebuilt` (default) | High | `"custom"` triggers an unnecessary Cloud Build with no Dockerfile in this module. |
| First registration | Complete promptly after deploy | **Medium** | The first person to register on a fresh, publicly reachable instance becomes the admin — until you register and set `HBOX_OPTIONS_ALLOW_REGISTRATION=false`, anyone who discovers the URL can claim the admin account. |
| `gcs_volumes` for item photos | Add explicitly before real use | **High** | Without it, uploaded item photos and attachments live on the pod's ephemeral filesystem and do not survive a restart — this is a bigger deal for Homebox than for apps where images are optional, since photo attachments are core to a home-inventory workflow. |
| `db_*_env_var_name` variables | Leave at their Homebox-specific defaults | Critical | Changing/clearing these breaks Homebox's Postgres connection — it reads `HBOX_DATABASE_*`, not `DB_*`. |
| `HBOX_DATABASE_SSL_MODE` | `disable` (already set by this module) | Critical | On GKE, `DB_HOST` resolves to `127.0.0.1` (the cloud-sql-proxy sidecar), which terminates TLS itself and serves plaintext on loopback. Homebox's Postgres client defaults `HBOX_DATABASE_SSL_MODE` to `require` and **panics on boot** (`tls error: server refused TLS connection`) unless told the local connection is unencrypted. `Homebox_GKE` sets this via `module_env_vars` — do not clear it. Not needed on Cloud Run, which connects over a Unix socket (no TLS negotiation applies there regardless of this setting). |

---

For the foundation behaviour referenced throughout — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Homebox-specific
application configuration shared with the Cloud Run variant is described in
**[Homebox_Common](Homebox_Common.md)**.
