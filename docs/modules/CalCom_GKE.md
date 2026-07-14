---
title: "Cal.com on GKE Autopilot"
description: "Configuration reference for deploying Cal.com on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Cal.com on GKE Autopilot

Cal.com is an open-source, AGPL-licensed scheduling platform — the self-hosted
Calendly alternative — built with **Next.js** and **Prisma** on PostgreSQL. This
module deploys Cal.com on **GKE Autopilot** on top of the [App_GKE](App_GKE.md)
foundation, which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

This guide focuses on the cloud services Cal.com uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## 1. Overview

Cal.com runs as a Next.js web workload. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Next.js pods, 2 vCPU / 2 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Cal.com (Prisma/`pg`) targets PostgreSQL only |
| Object storage | Cloud Storage (none by default) | Cal.com stores all state in PostgreSQL; no uploads bucket is created |
| Cache | Redis (optional) | Off by default; used for caching / rate limiting |
| Secrets | Secret Manager | Auto-generated `NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer Service, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; Cal.com's Prisma schema targets PostgreSQL only.
- **`NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY` are generated automatically** and
  stored in Secret Manager. Never rotate them after first boot without a maintenance
  window — rotating `CALENDSO_ENCRYPTION_KEY` renders all stored calendar/OAuth
  credentials undecryptable, and rotating `NEXTAUTH_SECRET` invalidates all sessions.
- **The public URL is validated at startup.** `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL`
  default to the cluster service URL (set from `GKE_SERVICE_URL` at runtime); set
  `webapp_url` to the external LoadBalancer address or custom domain once known, or
  booking/OAuth links will be wrong.
- **The schema is created on boot, not by a migration job.** The `db-init` job only
  provisions the empty database and role; Cal.com runs `prisma migrate deploy` on
  every start. Allow several minutes on the first boot.
- **Memory floor is 2 GiB.** Cal.com (Next.js 16) OOM-crashes at startup below 2 GiB.
- **Session affinity is `ClientIP` by default**, keeping a client's requests on the
  same pod for consistent UI/session behaviour.
- **The Cloud SQL Auth Proxy sidecar is used by default** (`enable_cloudsql_volume = true`),
  giving Cal.com a loopback `127.0.0.1` PostgreSQL endpoint with plaintext (the proxy
  terminates mTLS).
- **Redis is disabled by default.** Enable it only for cache / rate-limit backing.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Cal.com workload

Cal.com pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Cal.com workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Cal.com stores all application data (users, event types, bookings, connected calendar
credentials) in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it privately
through the **Cloud SQL Auth Proxy** sidecar on `127.0.0.1`; no public IP is exposed. On
first deploy an initialization Job creates the application database and role, and
Cal.com applies its schema via Prisma on boot.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Storage

Cal.com keeps all state in PostgreSQL, so **no data bucket is created by default**
(`storage_buckets` is empty). Additional buckets can still be declared via
`storage_buckets` if needed for custom integrations.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Redis (optional cache)

Redis is **disabled by default** (`enable_redis = false`). When enabled, Cal.com uses
it as a cache / rate-limit backend. When `redis_host` is left empty and `enable_nfs`
is true, the NFS server VM's IP is used as the Redis endpoint.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm env injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### E. Secret Manager

Two cryptographic secrets are generated automatically and stored in Secret Manager:
`NEXTAUTH_SECRET` (signs NextAuth.js session tokens) and `CALENDSO_ENCRYPTION_KEY`
(encrypts stored calendar/OAuth credentials). The database password is managed
separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`). A custom domain with a Google-managed certificate can
be enabled (`enable_custom_domain = true` by default), and a static IP is reserved so
the address survives redeploys. Set `webapp_url` to the resulting external URL so
Cal.com's generated booking/OAuth links are correct.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Cal.com Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently
  creates the application role and database and grants privileges on the `public`
  schema. It does **not** create the application schema — that is Cal.com's job.
- **Schema migrations on boot.** The image's start script runs `prisma migrate deploy`
  on every start, creating the schema on first boot and applying new migrations on
  version upgrades — no separate migration step. Budget several minutes for the first
  boot before the pod becomes Ready.
- **`NEXTAUTH_SECRET` and `CALENDSO_ENCRYPTION_KEY` are immutable after first boot.**
  Changing `CALENDSO_ENCRYPTION_KEY` makes all stored calendar/OAuth credentials
  undecryptable (every integration must be re-authorised); changing `NEXTAUTH_SECRET`
  logs out every user. Only rotate during a planned maintenance window.
- **Public URL requires the external IP.** `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL`
  are set from `GKE_SERVICE_URL` at runtime. After the LoadBalancer IP (or custom
  domain) is assigned, set `webapp_url` to that address:
  ```bash
  kubectl get svc <service-name> -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  ```
  Or set `environment_variables`/`webapp_url` in the module configuration before
  deploying.
- **First-run setup.** Open the external URL and complete the Cal.com onboarding to
  create the initial administrator/owner account, then configure at least one connected
  calendar. Self-hosted Cal.com allows self-service sign-up by default — restrict it
  (or front the service with IAP) if the instance should not be public.
- **Health path.** Startup and liveness probes target `/`. The generous startup window
  (0-second initial delay, up to a 30×30s retry window ≈ 15 minutes) accommodates
  first-boot Prisma migrations.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Cal.com are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

All other inputs follow standard App_GKE behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `calcom` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Cal.com` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Cal.com image tag (sets `CALCOM_VERSION`); pin to a specific release in production. |
| `webapp_url` | `""` | Public URL for `NEXT_PUBLIC_WEBAPP_URL`/`NEXTAUTH_URL`. Empty → the runtime cluster URL; set to the LoadBalancer/custom-domain address once known. |

All other inputs follow standard App_GKE behaviour.

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_port` | `3000` | Port Cal.com listens on. |
| `cpu_limit` | `2000m` | CPU per pod. |
| `memory_limit` | `2Gi` | **Minimum 2 GiB** — Next.js 16 OOM-crashes below it. |
| `min_instance_count` | `0` | Minimum replicas. |
| `max_instance_count` | `3` | Maximum replicas. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar for socket/loopback connections. Keep `true` for PostgreSQL connectivity. |
| `enable_image_mirroring` | `true` | Mirror the Cal.com image into Artifact Registry before deployment. |

All other inputs follow standard App_GKE behaviour.

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Do not set `NEXTAUTH_SECRET`, `CALENDSO_ENCRYPTION_KEY`, or `DATABASE_URL` here — they are managed automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g. SMTP or OAuth app credentials). |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |

All other inputs follow standard App_GKE behaviour.

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `Deployment` | `Deployment` (stateless) or `StatefulSet`. Cal.com is stateless — keep `Deployment`. |
| `session_affinity` | `ClientIP` | Sticky routing so a client's requests reach the same pod. |
| `termination_grace_period_seconds` | `30` | Seconds to wait after SIGTERM before SIGKILL. |

All other inputs follow standard App_GKE behaviour.

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Enable PVC templates. Not needed — Cal.com stores all state in PostgreSQL. |

All other inputs follow standard App_GKE behaviour.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Optional shared volume; also hosts co-located Redis when enabled. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

All other inputs follow standard App_GKE behaviour.

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis as the cache / rate-limit backend. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server IP (requires `enable_nfs = true`). |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

All other inputs follow standard App_GKE behaviour.

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `calcom` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `calcom` | Application database user. Immutable after first deploy. |
| `database_type` | `POSTGRES_15` | Fixed to PostgreSQL 15; other engines are unsupported. |
| `database_password_length` | `32` | Generated password length. |

All other inputs follow standard App_GKE behaviour.

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

All other inputs follow standard App_GKE behaviour.

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Cal.com. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

All other inputs follow standard App_GKE behaviour.

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs follow standard App_GKE behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate
and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Cal.com. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (empty by default). |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — `min_instance_count > max_instance_count`, IAP with no OAuth client, Redis enabled with neither `redis_host` nor NFS, `enable_cloudsql_volume` with `database_type = NONE`, and binary-unit ResourceQuota values. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `CALENDSO_ENCRYPTION_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it makes all stored calendar/OAuth credentials undecryptable — every integration must be re-authorised. |
| `NEXTAUTH_SECRET` (auto-generated) | Only rotate in a maintenance window | Critical | Rotating it invalidates all active user sessions, forcing immediate re-login. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `database_type` | `POSTGRES_15` | Critical | Cal.com's Prisma schema targets PostgreSQL only; any other engine breaks startup. |
| `webapp_url` | External LoadBalancer / domain URL | Critical | A wrong or unset URL is baked into every booking/OAuth link; the image's `localhost:3000` default makes the server refuse to boot. |
| `enable_redis` + `redis_host`/`enable_nfs` | consistent pair | High | Redis on with no host and no NFS fails a plan-time precondition — `REDIS_URL` would be empty and Cal.com cannot connect. |
| `memory_limit` | `2Gi` | High | Below 2 GiB, Next.js 16 OOM-crashes at startup and the pod never becomes Ready. |
| `session_affinity` | `ClientIP` | High | Without stickiness, a client's requests hop between pods, disrupting UI sessions. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar provides the PostgreSQL loopback endpoint; disabling it with a real DB is blocked by a plan-time guard. |
| `enable_iap` | only for private instances | High | IAP blocks all unauthenticated requests — including embeds and public booking pages. |
| Open sign-up | disable for private instances | High | Self-hosted Cal.com allows self-service sign-up; leaving it open lets anyone with the URL create an account. |
| `min_instance_count` ≤ `max_instance_count` | keep ordered | Medium | A conflicting HPA range fails a plan-time precondition. |
| `startup_probe` timing | keep the generous default | Medium | Too tight a window fails the probe during first-boot Prisma migrations, wedging the rollout. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Cal.com-specific
application configuration shared with the Cloud Run variant is described in
**[CalCom_Common](CalCom_Common.md)**.
