---
title: "Jellystat on GKE Autopilot"
description: "Configuration reference for deploying Jellystat on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Jellystat on GKE Autopilot

[Jellystat](https://github.com/CyferShepard/Jellystat) is an open-source
statistics and analytics dashboard for [Jellyfin](https://jellyfin.org/) media
servers, tracking playback history, active sessions, user activity, library
growth, and viewing trends. This module deploys Jellystat on **GKE Autopilot**
on top of the [App_GKE](App_GKE.md) foundation, which provisions and manages
the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Jellystat uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Jellystat runs as a single Node.js/Express Deployment (with a bundled React
frontend), fronted by a Kubernetes Service. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pod, 1 vCPU / 1 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — non-standard `POSTGRES_*` env var names |
| Object storage | Cloud Storage | A small optional `backups` bucket for database export archives |
| Secrets | Secret Manager | Auto-generated `JWT_SECRET`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer by default, optional custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer.
- **Non-standard database env var names.** Jellystat reads `POSTGRES_IP`,
  `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, and
  `POSTGRES_DATABASE` — not the platform's generic `DB_*` names, and
  specifically not `POSTGRES_DB`. Both sets are injected side by side.
  On GKE, the standard names resolve through the cloud-sql-proxy sidecar's
  `127.0.0.1` loopback (`enable_cloudsql_volume = true`).
- **`container_port = 3000` is fixed.** Jellystat's server hardcodes this
  port; it is not configurable via environment variable.
- **`service_type = "LoadBalancer"` by default.** Jellystat is a browser-facing
  dashboard.
- **`reserve_static_ip = false` by default.** Jellystat has no self-referencing
  URL baked into its own boot-time config, so a reserved IP is unnecessary —
  this also conserves the project's limited static-IP quota.
- **`JWT_SECRET` is generated automatically** and stored in Secret Manager.
- **No Redis support.** Jellystat has no native Redis integration.
- **No environment variable pairs Jellystat with a Jellyfin server.** The
  Jellyfin connection (server URL + API key) is entered entirely through
  Jellystat's own web UI after first boot — see §3 below.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Jellystat workload

Jellystat's pod is scheduled on Autopilot, which bills for the CPU/memory the
pod actually requests.

- **Console:** Kubernetes Engine → Workloads → select the Jellystat workload
  for pods, revisions, and events. Kubernetes Engine → Services & Ingress
  shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for Autopilot scaling and the workload lifecycle.

### B. Cloud SQL for PostgreSQL 15

Jellystat stores all playback/analytics data in a managed Cloud SQL for
PostgreSQL 15 instance, reached via the cloud-sql-proxy sidecar on
`127.0.0.1`. On first deploy an initialization Job creates the application
database and user; Jellystat then applies its own schema migrations on
startup.

- **Console:** SQL → select the instance for connections, backups, flags,
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage

An optional, small **Cloud Storage** bucket (`backups`) is provisioned for
Jellystat's own database export/backup archive feature.

- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

### D. Secret Manager

One cryptographic secret is generated automatically: `JWT_SECRET`, used to
sign Jellystat session/auth tokens. The database password is managed
separately by the foundation.

- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Networking & ingress

The Kubernetes Service defaults to `LoadBalancer`, giving Jellystat an
external IP directly. A custom domain via Gateway HTTPRoute, Cloud Armor, and
Cloud CDN can be layered on.

- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **CLI:**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Jellystat Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh`
  using `postgres:15-alpine`, creating the application role and database. The
  job is safe to re-run.
- **Database migrations on start.** Jellystat applies its own schema
  migrations automatically on every startup.
- **`JWT_SECRET` is generated once and stored in Secret Manager.** Rotating it
  invalidates all active sessions but causes no data loss.
- **Health path.** Startup, liveness, and uptime probes target
  `GET /auth/isConfigured` — a public, unauthenticated endpoint.
- **Manual Jellyfin pairing is required after first boot — this cannot be
  automated by Terraform.** Jellystat has no environment variable for the
  companion Jellyfin server's URL or API key; the pairing is entirely
  UI-driven:
  1. Open the deployed Jellystat URL (the Service's external IP, or your
     custom domain) and create the first admin account.
  2. In your Jellyfin server's own Dashboard → API Keys, generate a new API
     key for Jellystat.
  3. In Jellystat's settings, enter your Jellyfin server's URL and paste in
     that API key.
  If you don't already have a Jellyfin server deployed, deploy one first with
  the sibling **Jellyfin_GKE** module (or **Jellyfin_CloudRun**).
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/db-init
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Jellystat are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `jellystat` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Container image version tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Deploys the official `cyfershepard/jellystat` image directly. |
| `container_port` | `3000` | Fixed — matches Jellystat's hardcoded internal port. |
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Container resources. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Replica autoscaling bounds. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar (loopback connection). |

### Group 6 — Networking & Kubernetes Service

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Jellystat has a UI — externally reachable by default. |
| `service_port` | `80` | Kubernetes Service port clients connect to. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Off — Jellystat has no shared-file storage need. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Creates the small `backups` bucket. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES` (resolved to `POSTGRES_15` by `Jellystat_Common`) | Fixed engine. |
| `application_database_name` | `jellystat_db` | Injected as both `DB_NAME` and `POSTGRES_DATABASE`. Immutable after first deploy. |
| `application_database_user` | `jellystat_user` | Injected as both `DB_USER` and `POSTGRES_USER`. |

### Group 15 — Redis (not consumed)

| Variable | Default | Description |
|---|---|---|
| `enable_redis` / `redis_host` / `redis_port` / `redis_auth` | off / empty | **Not consumed.** Jellystat has no native Redis integration. |

### Group 19 — Custom Domain & Static IP

| Variable | Default | Description |
|---|---|---|
| `reserve_static_ip` | `false` | Jellystat has no self-referencing URL — conserves the project's static-IP quota. |

All other inputs are inherited from [App_GKE.md](App_GKE.md) with standard
behaviour.

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Kubernetes namespace. |
| `service_cluster_ip` | ClusterIP of the Kubernetes Service. |
| `service_external_ip` | External LoadBalancer IP. |
| `service_url` | Service URL. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` | Database host (`127.0.0.1` via the Cloud SQL Auth Proxy sidecar). |
| `storage_buckets` | Created storage buckets (`backups`). |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `initialization_jobs` | Names of the setup jobs (`db-init`). |
| `kubernetes_ready` | Whether the Kubernetes provider connection succeeded. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `JWT_SECRET` (auto-generated) | Only rotate deliberately | Medium | Rotating it invalidates all active sessions but causes no data loss. |
| `container_port` | `3000` (informational) | Low | Jellystat's server hardcodes port 3000 regardless of this variable's value. |
| Jellyfin URL/API key pairing | Manual, post-deploy | High | There is no environment variable for this — skipping the manual UI step leaves Jellystat showing no data even though the deployment is healthy. |
| `service_type` | `LoadBalancer` | Medium | Overriding to `ClusterIP` makes the browser UI unreachable without a separate ingress path. |
| `startup_probe_config`/`health_check_config` path | `/auth/isConfigured` | High | Pointing probes at an authenticated endpoint causes 401/403 and the pod never becomes Ready. |
| `enable_redis` | leave `false` | Low | Jellystat has no Redis integration; setting `true` has no effect. |

---

For the foundation behaviour referenced throughout — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Jellystat-specific application configuration shared with the Cloud Run variant
is described in **[Jellystat_Common](Jellystat_Common.md)**.
