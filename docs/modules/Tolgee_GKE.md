---
title: "Tolgee on GKE Autopilot"
description: "Configuration reference for deploying Tolgee on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Tolgee on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Tolgee_GKE.png" alt="Tolgee on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Tolgee is an open-source, developer-friendly **localization (i18n) and translation
management** platform built on Spring Boot. This module deploys Tolgee on **GKE
Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and manages
the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Tolgee uses and how to explore and operate them
from the Google Cloud Console and the command line. For the mechanics that are common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer
to the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Tolgee runs as a Java / Spring Boot web workload. The deployment wires together a focused
set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Spring Boot pods, 2 vCPU / 4 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Tolgee does not support MySQL or other engines |
| Object storage | Cloud Storage | A bucket for optional file storage (screenshots/imports) |
| Secrets | Secret Manager | Auto-generated initial admin password and JWT signing secret; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared application
  layer; selecting any other engine breaks startup.
- **Tolgee connects to Cloud SQL over TCP via the Auth Proxy loopback.** Its bundled
  PostgreSQL JDBC driver cannot use a Unix socket, so on GKE the entrypoint connects to
  the Cloud SQL Auth Proxy sidecar on `127.0.0.1` (plain TCP, no SSL — the proxy
  terminates TLS). `enable_cloudsql_volume` therefore defaults to **`true`**.
- **The JWT secret is generated automatically** and stored in Secret Manager. It must
  never be rotated after first boot without a maintenance window — rotating it
  immediately invalidates all active user sessions.
- **`SERVER_PORT`, not `PORT`.** Tolgee reads `SERVER_PORT = 8080`; the module sets it
  explicitly on the container.
- **Session affinity is `ClientIP` by default** so UI sessions from the same client
  return to the same pod.
- **No Redis.** Tolgee stores all translation state in PostgreSQL; `enable_redis`
  defaults to `false`.
- **Minimum 1 replica is maintained** (GKE does not support scale-to-zero); `max_instance_count`
  defaults to `5`, but keep it at `1` for a stateful single-writer deployment unless you
  have validated concurrent-writer safety.
- **Schema is created by Liquibase on first boot** — no separate migration job.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Tolgee workload

Tolgee pods are scheduled on Autopilot, which bills for the CPU/memory the pods actually
request. Horizontal Pod Autoscaling sizes the deployment between the minimum and maximum
replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Tolgee workload to see pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type (Deployment
vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Tolgee stores all application data (projects, languages, keys, translations, users) in a
managed Cloud SQL for PostgreSQL 15 instance. Pods reach it through the **Cloud SQL Auth
Proxy** sidecar on `127.0.0.1` over TCP (Tolgee's JDBC driver cannot use a Unix socket);
no public IP is exposed. On first deploy the foundation's `create-db-and-user.sh` step
creates the database and role, and Tolgee runs its own Liquibase migrations on boot.

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

A **Cloud Storage** bucket (`name_suffix = "storage"`) is provisioned for optional file
storage — Tolgee keeps translations in PostgreSQL, so this bucket holds only uploaded
screenshots or import artifacts if you mount it via `gcs_volumes` or configure Tolgee's
S3-compatible file storage. The workload service account is granted access.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/            # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Secret Manager

Two secrets are generated automatically and stored in Secret Manager: the **initial admin
password** (`TOLGEE_AUTHENTICATION_INITIAL_PASSWORD`) used to log in for the first time,
and the **JWT signing secret** (`TOLGEE_AUTHENTICATION_JWT_SECRET`) used to sign all user
session tokens. The database password is managed separately by the foundation. On GKE the
Common layer also exposes the raw secret values so the workload can bypass Secret
Manager read-after-write consistency (the Keycloak/Directus pattern).

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password OR name~jwt-secret"
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
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks (against `/actuator/health`) and alert policies are
available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Tolgee Application Behaviour

- **First-deploy database setup.** No dedicated init job runs — the App_GKE foundation's
  `create-db-and-user.sh` step creates the PostgreSQL role and database and grants schema
  ownership. Tolgee then creates and migrates its entire schema with **Liquibase**
  automatically on first boot.
- **Migrations on start.** Tolgee applies its Liquibase changesets on every startup, so
  upgrading the `application_version` applies schema changes without a separate step.
- **The JWT secret is immutable after first boot.** It is generated once and written to
  Secret Manager and kept stable across restarts and replicas. Rotating
  `TOLGEE_AUTHENTICATION_JWT_SECRET` immediately invalidates all active user sessions —
  only rotate during a planned maintenance window.
- **First-run login.** After deploy, sign in as the initial owner:
  `TOLGEE_AUTHENTICATION_INITIAL_USERNAME` (default `admin@techequity.cloud`) with the
  generated password from Secret Manager. Change the password and configure additional
  auth providers (Google/OAuth2/SSO) from the Tolgee UI before going live.
- **Health path.** The readiness/startup/liveness probes target **`/actuator/health`**,
  which returns an unauthenticated `200` only after Liquibase migrations complete. Allow
  several minutes on first boot (60-second initial delay plus a wide failure window) —
  Spring Boot + first-run migrations start more slowly than a typical Node app.
- **Single-writer by design.** Tolgee has no queue/coordination layer; scaling beyond one
  pod runs concurrent writers against the same database and NFS attachment volume. Keep a
  single replica unless you have validated concurrent-writer safety for your workload.
- **Inspect the DB wiring injected into the running pod:**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'SPRING_DATASOURCE|SERVER_PORT'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Tolgee are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `tolgee` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Tolgee image tag used as `FROM tolgee/tolgee:<tag>` for the thin custom wrapper build. Pin to a release (e.g. `v3.130.4`) in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_resources` | `cpu_limit=2000m`, `memory_limit=4Gi` | Tolgee requires **at least 2 GiB** memory for reliable operation. |
| `min_instance_count` | `1` | Minimum replicas; GKE requires ≥ 1 (no scale-to-zero). |
| `max_instance_count` | `5` | Maximum replicas. Keep at `1` unless concurrent-writer safety is validated. |
| `container_port` | `8080` | Tolgee's Spring Boot `SERVER_PORT`. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar — required; Tolgee connects to the proxy on `127.0.0.1` over TCP. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing so UI sessions return to the same pod. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (Deployment) | Tolgee stores all state in PostgreSQL/NFS, so a StatefulSet with per-pod PVCs is not needed. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisions Cloud Filestore NFS for optional Tolgee attachment storage. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts for the optional file-storage bucket. |

### Group 15 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Leave off — Tolgee stores all state in PostgreSQL and does not require Redis. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `application_database_name` | `tolgee` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `tolgee` | Application database user. Immutable after first deploy. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

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
| `service_url` | URL to reach Tolgee. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — an out-of-range `redis_port`/`backup_retention_days`, IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts, a `database_type` that does not match an enabled extension, ResourceQuota memory without a binary unit suffix. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `TOLGEE_AUTHENTICATION_JWT_SECRET` (auto-generated) | Only rotate in a maintenance window | Critical | Rotating it invalidates all active user sessions, forcing immediate re-login for everyone. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_cloudsql_volume` | `true` | Critical | The Auth Proxy sidecar is required for Tolgee's TCP JDBC connection; disabling it removes the `127.0.0.1` endpoint and breaks the database connection. |
| `container_resources.memory_limit` | `4Gi` (≥ 2 GiB) | High | Below ~2 GiB the Spring Boot JVM OOMs during first-boot Liquibase migrations. |
| `max_instance_count` | `1` unless validated | High | Tolgee has no coordination layer; multiple concurrent writers against one DB/NFS volume can conflict. |
| `session_affinity` | `ClientIP` | High | Without stickiness, UI sessions bounce between pods and users are logged out unexpectedly. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects `0`. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `application_version` | Pin in production | High | `latest` can pull a new major with incompatible migrations on redeploy. |
| `startup_probe` (`/actuator/health`) | Keep the wide first-boot window | Medium | Too tight a window fails the pod while Liquibase migrations are still running on a fresh DB. |
| `enable_redis` | `false` | Medium | Redis is unused; enabling it adds cost without benefit. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Tolgee-specific
application configuration shared with the Cloud Run variant is described in
**[Tolgee_Common](Tolgee_Common.md)**.
