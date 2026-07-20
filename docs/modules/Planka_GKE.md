---
title: "Planka on GKE Autopilot"
description: "Configuration reference for deploying Planka on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Planka on GKE Autopilot

Planka is an open-source, self-hosted, Trello-like kanban board application
with a Node.js (Sails.js) backend and a React frontend, used for team and
personal project management — boards, lists, cards, due dates, labels, and
file attachments. This module deploys Planka on **GKE Autopilot** on top of
the [App_GKE](App_GKE.md) foundation, which provisions and manages the
shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Planka uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Planka runs as a single Node.js web workload, serving both its API and its
React frontend from one port. The deployment wires together a small, focused
set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pod, 2 vCPU / 4 GiB by default |
| Database | Cloud SQL for PostgreSQL 15 | Planka's Knex query builder supports no other engine |
| Object storage | Cloud Storage | A `storage` bucket is created for attachments, but not auto-mounted |
| Cache & queue | none | Planka has no Redis or queue dependency — real-time updates ride Socket.io in-process |
| Secrets | Secret Manager | `SECRET_KEY` and `DEFAULT_ADMIN_PASSWORD` — both real, functional secrets — plus the database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, reserved static IP, optional custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL is the only supported engine.** `Planka_Common` fixes
  `database_type = "POSTGRES_15"`.
- **A thin custom build, not the prebuilt image.** Planka needs a cloud
  entrypoint to compose `DATABASE_URL` and derive `BASE_URL`, so
  `container_image_source = "custom"` builds `FROM
  ghcr.io/plankanban/planka:<version>` via Cloud Build.
- **`DATABASE_URL` is a URL-authority connection string, but SSL is set via
  separate env vars — never a `?sslmode=` query parameter.** Planka has two
  independent DB connection paths (the migration CLI and the running server's
  Sails ORM), each needing SSL configured a different way, and each ignoring
  a URL-embedded `?sslmode=` for its own, unrelated reason. On GKE, the Cloud
  SQL Auth Proxy sidecar listens on `127.0.0.1` and terminates TLS itself, so
  the entrypoint sets **neither** `PGSSLMODE` nor
  `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE` for that loopback connection — no
  SSL config is needed at all. See the [Common guide](Planka_Common.md) for
  the full two-path explanation and the private-IP TCP branch.
- **Two real, functional application secrets.** `SECRET_KEY` (session/token
  signing, required at boot) and `DEFAULT_ADMIN_PASSWORD` (seeds the initial
  admin account on first, empty-database boot) are both genuinely consumed by
  Planka. There is **no forced password-reset prompt**, so change the seeded
  password immediately after first deploy.
- **`workload_type` defaults to `Deployment`, not `StatefulSet`.** Planka
  keeps no local state beyond what's already in Cloud SQL.
- **`reserve_static_ip = true`** (overriding the App_GKE default of
  `false`). The cloud entrypoint derives `BASE_URL` from the injected
  `GKE_SERVICE_URL`; without a reserved static IP, `BASE_URL` can fall back
  to unreachable internal `*.svc.cluster.local` DNS, breaking attachment
  links and email notifications.
- **Attachments are not persisted by default.** A GCS bucket is created but
  not auto-mounted — add a `gcs_volumes` entry if uploaded
  attachments/avatars/backgrounds need to survive a pod restart.
- **No Redis, no NFS.** `enable_redis` and `enable_nfs` both default to
  `false` — Planka needs neither a cache/queue backend nor POSIX filesystem
  sharing.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set.

### A. GKE Autopilot — the Planka workload

- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_HOST|DB_IP|BASE_URL'
  ```

### B. Cloud SQL for PostgreSQL 15

Pods reach the database privately through the **cloud-sql-proxy** sidecar over
`127.0.0.1`. On first deploy an initialization Job creates the application
database and role; Planka then runs its own migrations and seed on every pod
start.

- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage

- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~planka"
  ```

### D. Secret Manager

- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~planka"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing
IP with a reserved static address. Planka's `BASE_URL` (used for attachment
links and email notifications) is derived from this address — update
`BASE_URL` explicitly if a custom domain is layered on afterward.

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

## 3. Planka Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh`,
  idempotently creating the application role and database (no
  `CREATEROLE`/`CREATEDB` needed).
- **Schema migrations and seed on every boot.** The official image's own
  `start.sh` runs `node db/init.js` (migrations + seed) before starting the
  server.
- **Real admin bootstrap credential — no forced reset.** Planka seeds
  `admin@example.com` with the generated `DEFAULT_ADMIN_PASSWORD` on first
  (empty-database) boot, with no forced password-reset prompt — log in and
  change the password via Planka's own UI promptly after deploy.
- **`DATABASE_URL` composed by the cloud entrypoint.** Built at container
  startup from the Foundation-injected `DB_*` values (the password is a
  runtime Secret Manager value, unavailable at plan time). See
  [Planka_Common](Planka_Common.md) for the full detail.
- **Health path.** Startup and liveness probes are configured via the
  `startup_probe`/`liveness_probe` variables. Planka's own
  `server/healthcheck.js` targets the **root path `/`** with no auth, and
  this module's `startup_probe`/`liveness_probe` variables now correctly
  default to `path = "/"` to match.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Planka are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `planka` | Base name for resources. |
| `application_version` | `latest` | Used as the `PLANKA_VERSION` build ARG. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `custom` | Planka needs the cloud-entrypoint wrapper — keep `custom`. |
| `container_port` | `1337` | Planka's native default port; container port and probes must match. |
| `min_instance_count` / `max_instance_count` | `0` / `5` | HPA scaling bounds. |
| `container_resources.memory_limit` | `4Gi` | Planka requires at least 2Gi for reliable operation. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `workload_type` | `null` (→ `Deployment`) | Planka is stateless at the pod level. |
| `service_type` | `LoadBalancer` | Public-facing kanban app — a `ClusterIP` override has no reason here. |
| `session_affinity` | `ClientIP` | Sticky routing so a client stays on one pod. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | one `storage` bucket | Created but not auto-mounted. |
| `gcs_volumes` | `[]` | Add an entry mounted at `/app/data` for persistent attachment storage. |

### Group 16 — Database Configuration

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — Knex supports no other engine. |
| `application_database_name` / `application_database_user` | `planka` / `planka` | PostgreSQL database name and application username. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/`, 60s delay | The probes actually applied to the deployed pod, now matching Planka's real, unauthenticated health target (`server/healthcheck.js`). |
| `startup_probe_config` / `health_check_config` | HTTP `/`, 60s delay | Foundation-level defaults; superseded by `startup_probe`/`liveness_probe` above — effectively inert. |

### Group 13 — NFS

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Not needed — Planka has no POSIX filesystem requirement. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Planka has no cache/queue dependency. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisions an Ingress + managed certificate. |
| `reserve_static_ip` | `true` | Overrides the App_GKE default (`false`) so `BASE_URL` resolves to a real, reachable address — see §1. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Kubernetes Service identity and address. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Cloud SQL connection details. |
| `storage_buckets` | The `storage` bucket for attachments. |
| `kubernetes_ready` | Whether the workload reached Ready state. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/role and destroys all data. |
| `container_image_source` | `custom` (default) | High | `"prebuilt"` deploys the official image directly, skipping the cloud entrypoint — Planka boots with no `DATABASE_URL`. |
| `startup_probe` / `liveness_probe` path | `/` (the module default) | **High** | Matches Planka's real, unauthenticated health target (per `server/healthcheck.js`, a plain HTTP GET to `/` checking for 200). If overridden to another path, the pod can fail to become Ready. |
| `reserve_static_ip` | `true` (already the module default) | High | `false` can leave `BASE_URL` pointed at unreachable internal `*.svc.cluster.local` DNS, breaking attachment links and email notifications. |
| `DEFAULT_ADMIN_PASSWORD` (generated secret) | Log in and change it immediately after first deploy | **Critical** | Planka does not force a password reset — anyone who obtains the seeded password can log in as admin indefinitely until it's changed. |
| `DATABASE_URL` / SSL config | Never hand-edit — controlled by the cloud entrypoint via `PGSSLMODE`/`KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE` env vars, NOT a `?sslmode=` query param | **Critical** | Planka has two independent DB connection paths with different SSL mechanisms, confirmed by tracing the actual dependency chain: (1) the migration CLI (`server/db/knexfile.js`) reads `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE`; (2) the running server's Sails ORM (`sails-postgresql` → `machinepack-postgresql`) parses `DATABASE_URL` with Node's legacy `url.parse()`, which silently **drops every query parameter** including `?sslmode=` — so a URL-embedded sslmode does nothing for the runtime path. With no explicit `ssl` config, raw `pg` falls back to the `PGSSLMODE` *environment variable*, where `require` means "encrypt AND verify" (not "encrypt only" like classic libpq) — only `PGSSLMODE=no-verify` skips certificate verification. Cloud SQL's self-signed cert isn't in Node's CA bundle, so anything but `no-verify` fails at boot with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` and the Sails `orm` hook never loads. The GKE loopback connection (Cloud SQL Auth Proxy sidecar) needs neither var set — the proxy already terminates TLS. |
| `gcs_volumes` for attachments | Add explicitly if needed | Medium | Without it, uploaded attachments live on the pod's ephemeral filesystem and do not survive a restart. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Planka-specific application configuration shared
with the Cloud Run variant is described in
**[Planka_Common](Planka_Common.md)**.
