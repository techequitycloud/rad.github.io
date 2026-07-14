---
title: "EvolutionAPI on GKE Autopilot"
description: "Configuration reference for deploying EvolutionAPI on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# EvolutionAPI on GKE Autopilot

Evolution API is an open-source Node.js WhatsApp Business API gateway (built on the
Baileys library) that provisions WhatsApp instances, sends and receives messages, and
exposes a REST API plus a manager UI for wiring WhatsApp into other systems. This
module deploys Evolution API on **GKE Autopilot** on top of the [App_GKE](App_GKE.md)
foundation, which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

This guide focuses on the cloud services Evolution API uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

Evolution API runs as a Node.js web workload on GKE Autopilot. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pod, 2 vCPU / 4 GiB by default; **pinned to a single replica** |
| Database | Cloud SQL for PostgreSQL 15 | Required — Evolution API uses Prisma against PostgreSQL only |
| Cache | Redis | **Enabled by default** (`CACHE_REDIS_URI`); caches instance/message state |
| Object storage | Cloud Storage | A dedicated data bucket provisioned automatically |
| Secrets | Secret Manager | Auto-generated `AUTHENTICATION_API_KEY`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer with `ClientIP` session affinity; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; Evolution API uses Prisma and does not support other engines.
- **The workload is pinned to a single replica** (`min_instance_count = 1`,
  `max_instance_count = 1`). Evolution API holds live WhatsApp (Baileys) socket
  sessions in memory, per-pod; those sessions are **not** shared across replicas, so
  scaling out fragments live connections. Do not raise `max_instance_count`.
- **`AUTHENTICATION_API_KEY` is generated automatically** and stored in Secret
  Manager. It is Evolution API's global admin key and must **never be rotated after
  first boot** — rotating it makes already-provisioned WhatsApp instances unreachable
  and returns `401` to every client still holding the old key.
- **Redis is enabled by default** (`enable_redis = true`). Leave `redis_host` empty to
  use the NFS server VM's IP as the Redis endpoint (requires `enable_nfs = true`), or
  point it at an explicit managed instance.
- **Session affinity is `ClientIP`** and the Service type is `LoadBalancer` by default,
  exposing an external IP for WhatsApp webhook callbacks and the manager UI.
- **Memory defaults to 4 GiB** — Evolution API needs at least 2 GiB for reliable
  operation.
- **`SERVER_URL` is defaulted at runtime** by the container entrypoint from the
  injected service URL, so QR-code and webhook callback URLs reflect the real address.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Evolution API workload

Evolution API pods are scheduled on Autopilot, which bills for the CPU/memory the
pods actually request. The workload runs as a single replica by design.

- **Console:** Kubernetes Engine → Workloads → select the Evolution API workload to
  see pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Evolution API stores all application data (WhatsApp instances, contacts, chats,
message history) in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it
privately through the **Cloud SQL Auth Proxy** sidecar over a TCP loopback
(`127.0.0.1`); no public IP is exposed. On first deploy an initialization Job creates
the application database and user; Prisma migrations then create the schema on
container boot.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=evolution --database=evolution --project "$PROJECT"
  ```

The instance name, database (`evolution`), user (`evolution`), and the Secret Manager
secret holding the password are all surfaced in the [Outputs](#5-outputs). For the
connection model, automated backups, and password rotation, see
[App_GKE](App_GKE.md).

### C. Cloud Storage

A dedicated **Cloud Storage** data bucket is provisioned automatically for Evolution
API file storage. The workload service account is granted access. Additional buckets
can be declared via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Redis (cache)

Redis is **enabled by default** (`enable_redis = true`). Evolution API uses it for
instance/message caching (`CACHE_REDIS_URI`, Redis DB index `6`). When `redis_host` is
left empty and `enable_nfs = true`, the NFS server VM's IP is used as the Redis
endpoint; the container entrypoint assembles the URI at runtime.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the cache URI is injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep CACHE_REDIS
  ```

### E. Secret Manager

One cryptographic secret is generated automatically and stored in Secret Manager:
`AUTHENTICATION_API_KEY` — Evolution API's global admin API key, mounted via the
Secret Store CSI driver. The database password is managed separately by the
foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP with
`ClientIP` session affinity — required so a WhatsApp client's requests stick to the
single pod holding its socket. A custom domain with a Google-managed certificate can
be enabled, and a static IP can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. The entrypoint emits `[cloud-entrypoint]` markers that confirm the
resolved DB/Redis/URL config on boot. Optional uptime checks and alert policies are
available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. EvolutionAPI Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently
  creates the `evolution` database and role, grants privileges, and makes the app user
  the owner of the `public` schema, then signals the proxy sidecar to shut down so the
  Job pod completes. The job is safe to re-run.
- **Prisma migrations on start.** Evolution API runs `prisma migrate deploy` on every
  container boot (via the wrapped `deploy_database.sh`), so upgrading the application
  version applies schema changes without a separate migration step. On GKE the
  cloud-sql-proxy sidecar is a TCP loopback, so the entrypoint connects with
  `sslmode=disable`.
- **`AUTHENTICATION_API_KEY` is immutable after first boot.** The global admin key is
  generated once and written to Secret Manager. Rotating it makes all
  already-provisioned WhatsApp instances unreachable and returns `401` to every client
  still holding the old key. Only rotate during a planned migration.
- **Single-replica by design.** WhatsApp (Baileys) socket sessions live in the pod's
  memory and are not shared across replicas. `min_instance_count = 1` keeps one
  running; `max_instance_count = 1` prevents fragmenting live connections. Do not
  scale out. `ClientIP` session affinity keeps each client pinned to the pod.
- **Webhook / QR callback URL.** The entrypoint defaults `SERVER_URL` to the injected
  service URL. After the LoadBalancer external IP is assigned, set `SERVER_URL` (via
  `environment_variables`) to the external URL so QR-code and webhook callbacks use a
  reachable address:
  ```bash
  kubectl get svc <service-name> -n "$NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  ```
- **First-run setup.** After deploy, retrieve `AUTHENTICATION_API_KEY` from Secret
  Manager and use it (as the `apikey` header) to reach the manager UI at `/manager`,
  create a WhatsApp instance (`POST /instance/create`), then scan the returned QR code
  from WhatsApp on your phone to connect the number.
- **Health path.** Startup and liveness probes target the root `/` — an unauthenticated
  status endpoint that responds once the server is up. Allow several minutes on first
  boot while Prisma migrations run.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Evolution API are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

All other inputs follow standard App_GKE behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `evolutionapi` | Base name for resources. Do not change after first deploy. |
| `application_version` | `v2.1.1` | Evolution API image tag; `latest` maps to a pinned `v2.1.1` in the build arg. |

All other inputs follow standard App_GKE behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `min_instance_count` | `1` | Minimum pod replicas; keeps one running for the in-memory WhatsApp sockets. |
| `max_instance_count` | `1` | **Pinned to 1.** Do not raise — sessions are not shared across pods. |
| `container_port` | `8080` | Evolution API listens on port 8080 (`SERVER_PORT`). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for PostgreSQL connectivity. |

All other inputs follow standard App_GKE behaviour.

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Exposes an external IP for webhook callbacks and the manager UI. |
| `workload_type` | `null` (auto-resolves to `Deployment`) | Stateless Deployment (all state lives in PostgreSQL + Redis). |
| `session_affinity` | `ClientIP` | Sticky routing so a client's requests reach the pod holding its WhatsApp socket. |

All other inputs follow standard App_GKE behaviour.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisions the NFS server VM, which also co-locates the Redis endpoint (see Group 15). |

All other inputs follow standard App_GKE behaviour.

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Enables Evolution API's Redis cache (`CACHE_REDIS_URI`). |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

All other inputs follow standard App_GKE behaviour.

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `application_database_name` | `evolution` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `evolution` | Application database user. Immutable after first deploy. |

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
| `service_url` | URL to reach Evolution API. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `StatefulSet` conflict, IAP with no authorized identities, non-binary `quota_memory_*` units, an out-of-range `redis_port`/`backup_retention_days`, `enable_cloudsql_volume = false` on a DB-backed app. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `AUTHENTICATION_API_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it makes every already-provisioned WhatsApp instance unreachable and returns `401` to all clients holding the old key. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all message history. |
| `max_instance_count` | `1` | Critical | Scaling out fragments in-memory WhatsApp socket sessions across pods, breaking live connections and duplicating webhook deliveries. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity; disabling it breaks the DB connection. |
| `enable_redis` | `true` | High | Disabling drops Evolution API's instance/message cache; the app is configured to expect it (`CACHE_REDIS_ENABLED = true`). |
| `redis_host` | `""` (NFS) or explicit | High | When Redis is on but NFS is off and no host is set, the cache URI is blank and caching is silently disabled. |
| `session_affinity` | `ClientIP` | High | Without stickiness, requests can route away from the single pod holding the WhatsApp socket, breaking instance operations. |
| `service_type` | `LoadBalancer` | High | `ClusterIP` makes the manager UI and webhook endpoints unreachable from outside the cluster. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects invalid values. Keeping 1 preserves the warm WhatsApp sockets. |
| `enable_iap` | only when webhooks not needed | High | IAP blocks all unauthenticated requests, including external webhook callbacks. |
| `application_version` | Pin (e.g. `v2.1.1`) | Medium | `latest` maps to a pinned tag, but pinning explicitly avoids surprise upgrades that run new Prisma migrations. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Evolution-API-specific application configuration shared
with the Cloud Run variant is described in
**[EvolutionAPI_Common](EvolutionAPI_Common.md)**.
