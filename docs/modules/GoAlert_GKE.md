---
title: "GoAlert on GKE Autopilot"
description: "Configuration reference for deploying GoAlert on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# GoAlert on GKE Autopilot

GoAlert is an open-source, Apache 2.0-licensed on-call scheduling and incident
alert-escalation platform, originally built by Target and run in production at
scale. It lets teams define escalation policies, on-call rotations and schedules,
and dispatch outbound notifications by email, webhook, or (optionally) Twilio
SMS/voice. This module deploys GoAlert on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services GoAlert uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

GoAlert runs as a single Go binary pod on GKE Autopilot. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Go binary pod, 1 vCPU / 512 MiB by default, `min_instance_count = 1`, `max_instance_count = 1` |
| Database | Cloud SQL for PostgreSQL (`POSTGRES_17`) | Required — GoAlert does not support MySQL or other engines; `pgcrypto` extension installed automatically |
| Secrets | Secret Manager | Auto-generated admin password and a data-encryption key; database password managed by the foundation |
| Ingress | Cloud Load Balancing | External LoadBalancer Service by default, optional custom domain + managed certificate |

There is **no object storage row** in this table — `GoAlert_Common`'s
`storage_buckets` output is always `[]`. GoAlert has no file-upload/attachment
feature; every piece of application state (escalation policies, schedules, alerts,
notification history, users) lives in PostgreSQL.

**Sensible defaults worth knowing up front:**

- **PostgreSQL is mandatory.** `database_type = "POSTGRES_17"` is fixed by
  `GoAlert_Common`; selecting any other engine breaks startup.
- **`application_database_name` / `application_database_user` default to
  `"admin"`, not `"goalert"`.** This variant wires `db_name`/`db_user` in
  `GoAlert_Common` from the generic App_GKE-level `application_database_name` /
  `application_database_user` variables, whose module-level defaults are
  `"admin"` — inconsistent with the Cloud Run variant's `db_name`/`db_user`
  variables (default `"goalert"`). Cosmetic, but worth knowing before you go
  looking in Cloud SQL for a database named `goalert`.
- **A single, always-warm pod.** `min_instance_count = 1`, `max_instance_count = 1`
  — GoAlert runs a continuous in-process "engine" loop that evaluates
  escalation-policy timing, rotation state, and outbound notification dispatch;
  there is no scale-to-zero concept on GKE in this module, and a single instance
  matches GoAlert's own recommendation against running multiple default-mode
  engine instances without a `--api-only` topology this module doesn't wire.
- **No Redis, no object storage.** GoAlert's state lives entirely in PostgreSQL; it
  needs no external cache, queue, or file storage.
- **`GOALERT_DB_URL` is assembled at container start, not at plan time.** GoAlert
  accepts only a single Postgres connection-string env var, and the runtime
  Secret-Manager-sourced `DB_PASSWORD` can't be URL-encoded until the container
  actually starts — `entrypoint.sh` (and each init-job script) builds it from the
  discrete `DB_*` values the Foundation injects, branching on whether the resolved
  host is the cloud-sql-proxy loopback (`127.0.0.1`, no TLS) or a real socket/IP.
- **`public_url` has no auto-computed default on GKE.** Unlike `GoAlert_CloudRun`,
  this module passes `public_url = var.public_url` straight through with no
  fallback computation — leave it empty and `GOALERT_PUBLIC_URL` falls back to
  GoAlert's own `http://localhost:8081`, breaking OIDC callbacks and links in
  outgoing notifications. Set it explicitly once the external LoadBalancer IP or
  custom domain is known.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the GoAlert workload

GoAlert runs as a single always-on pod on Autopilot (`min = max = 1`), which bills
for the CPU/memory the pod actually requests.

- **Console:** Kubernetes Engine → Workloads → select the GoAlert workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot and the workload type (Deployment vs
StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL

GoAlert stores all application data — escalation policies, schedules, rotations,
alerts, notification history, and users — in a managed Cloud SQL PostgreSQL
instance. Pods reach it privately through the **Cloud SQL Auth Proxy** sidecar over
a loopback TCP connection (`127.0.0.1`); `entrypoint.sh` detects this and skips the
Unix-socket branch used on Cloud Run.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md)
for the connection model, automated backups, and password rotation.

### C. Secret Manager

Two secrets are generated automatically by `GoAlert_Common` and stored in Secret
Manager: the **admin password** (consumed by the `admin-bootstrap` init job) and a
**data-encryption key** (recommended by upstream GoAlert docs). The database
password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~goalert"
  gcloud secrets versions access latest --secret=<admin-password-secret-id> --project "$PROJECT"
  ```

### D. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`). A custom domain with a Google-managed certificate
can be enabled, and a static IP can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. GoAlert Application Behaviour

- **The 3-stage initialization job chain is load-bearing.** `GoAlert_Common` defines
  three ordered Kubernetes Jobs, each depending on the one before it, all with
  `execute_on_apply = true`:
  1. **`db-init`** (`postgres:15-alpine`) — creates the PostgreSQL role and
     database.
  2. **`db-migrate`** (`goalert/goalert:<version>`, `depends_on_jobs = ["db-init"]`)
     — runs `goalert migrate --db-url=...`, applying GoAlert's own schema. This
     **must** run before `admin-bootstrap`: `goalert add-user` has no migration
     logic of its own, and on a fresh database it fails with
     `relation "auth_basic_users" does not exist`.
  3. **`admin-bootstrap`** (`goalert/goalert:<version>`, `depends_on_jobs =
     ["db-migrate"]`) — runs `goalert add-user --admin` directly against Postgres to
     create the first admin login.

  On GKE, `execute_on_apply = false` only stops Terraform from **waiting** for a
  job to finish — the underlying Kubernetes Job/pod is still created and scheduled
  immediately either way. Correctness here relies on `depends_on_jobs`
  (App_GKE's 3-tier job dependency system), not on apply-time sequencing. All three
  scripts also retry internally (up to 10 attempts, 5s apart) to absorb Cloud
  SQL/scheduling latency.

- **No first-visit setup wizard.** GoAlert has no web-based initial-admin flow —
  the `admin-bootstrap` job is the only way an admin account gets created. Retrieve
  the generated password:
  ```bash
  gcloud secrets versions access latest --secret=<admin_password_secret_id output>
  ```

- **Health endpoint.** `/health` is GoAlert's documented public, unauthenticated
  endpoint (200 once the app lifecycle leaves the "Starting" state). This module's
  startup and liveness probes default to a **TCP** port check rather than an HTTP
  path check — Kubernetes supports `tcpSocket` for both probe types (unlike Cloud
  Run, which forbids a TCP liveness probe) — and both proved correct on live
  verification (HTTP 200 on `/health` with real "listening and serving HTTP" log
  lines).

- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for GoAlert are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. Use a distinct value (e.g. `gke`) from any co-deployed `GoAlert_CloudRun` (`cr`) to avoid a naming collision. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application & Database Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `goalert` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `GoAlert` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Image tag. `"latest"` maps to a pinned Dockerfile build arg (`GOALERT_VERSION = v0.34.1`). |
| `admin_username` | `admin` | Username created by the `admin-bootstrap` init job. |
| `admin_email` | `admin@techequity.cloud` | Email for the initial admin account. |
| `public_url` | `""` | **No auto-computed default on GKE.** Set explicitly once the external LoadBalancer IP or custom domain is known. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | CPU/memory requests and limits. |
| `container_port` | `8081` | GoAlert's native HTTP port. |
| `min_instance_count` | `1` | Minimum pod replicas. |
| `max_instance_count` | `1` | Single default-mode engine instance; multi-instance needs a `--api-only` topology this module doesn't wire. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar. |
| `enable_image_mirroring` | `true` | Mirrors the GoAlert base image into Artifact Registry. |

### Group 9 — GKE Backend Configuration

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `null` (resolves to `Deployment`) | `"Deployment"` or `"StatefulSet"`. |
| `session_affinity` | `ClientIP` | Session affinity for the Kubernetes Service. |
| `namespace_name` | `""` (auto-generated) | Kubernetes namespace. |

### Group 16/17 — Database Configuration

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_17` | Cloud SQL engine. GoAlert requires PostgreSQL. |
| `application_database_name` | `admin` | PostgreSQL database name — see the naming-inconsistency note in Overview. |
| `application_database_user` | `admin` | PostgreSQL application user. |
| `database_password_length` | `32` | Generated password length (16–64). |

### Group 11/12 — Workload Automation

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty for `GoAlert_Common`'s default 3-job chain (`db-init` → `db-migrate` → `admin-bootstrap`). |
| `cron_jobs` | `[]` | GoAlert has no platform-scheduled recurring tasks by default. |

### Group 22 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | TCP, 30s delay, 30 retries | Accommodates first-boot migration latency (`db-migrate`). |
| `health_check_config` | TCP, 30s delay, 3 retries | Kubernetes liveness probe. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Cloud Monitoring uptime check. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not required by GoAlert; present for platform compatibility. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames. |
| `reserve_static_ip` | `true` | Reserve a stable global static IP for the load balancer — recommended so `public_url` doesn't need to change after every redeploy. |

Every other input (Module Metadata, Environment Variables & Secrets, CI/CD &
GitHub Integration, Custom SQL, Storage & Filesystem, IAP & Cloud Armor,
StatefulSet Configuration, VPC Service Controls, Reliability Policies) is
inherited from `App_GKE` with its standard behaviour — see
[App_GKE](App_GKE.md) for the full, group-organized list.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` / `service_external_ip` | In-cluster ClusterIP / external LoadBalancer IP. |
| `service_url` | URL to reach GoAlert. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (`127.0.0.1` via the Auth Proxy sidecar) / port. |
| `storage_buckets` | Always `[]` — GoAlert provisions no storage buckets. |
| `container_image` | Deployed image. |
| `initialization_jobs` | Names of the created init jobs (`db-init`, `db-migrate`, `admin-bootstrap`). |
| `kubernetes_ready` | Whether the cluster endpoint is available and all workload resources are deployed. `false` on the first apply of a new inline cluster — a re-run completes the deployment. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through
> the [App_GKE](App_GKE.md) foundation engine, which validates values and
> combinations at plan time. Invalid configuration fails the **plan** with a clear,
> named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_17` | Critical | Any other engine breaks GoAlert's schema and startup entirely — `pgcrypto` and the whole `goalert migrate` flow are Postgres-specific. |
| `initialization_jobs` order (`db-init` → `db-migrate` → `admin-bootstrap`) | Leave `[]` unless you fully understand the dependency chain | Critical | Running `admin-bootstrap` before `db-migrate` fails with `relation "auth_basic_users" does not exist` on a fresh database — `goalert add-user` has no migration logic of its own. On GKE, `execute_on_apply=false` does NOT delay pod scheduling, only Terraform's wait — the ordering guarantee comes entirely from `depends_on_jobs`. |
| `public_url` | Set explicitly once the LoadBalancer IP/domain is known | High | This module does **not** auto-compute a service URL (unlike the Cloud Run variant) — an unset `public_url` falls back to GoAlert's own `http://localhost:8081`, breaking OIDC auth callbacks and every link in outgoing notification emails. |
| `min_instance_count` | `1` | High | GoAlert's escalation-timing engine is a continuous in-process loop — at zero replicas, escalations for real alerts are silently missed entirely. |
| `application_database_name` / `application_database_user` | Confirm actual values (`admin`/`admin` by default, not `goalert`) | Medium | Looking for a database literally named `goalert` in Cloud SQL will not find it under this variant's defaults. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity on GKE. |
| `reserve_static_ip` | `true` | Medium | Without a reserved static IP, the external LoadBalancer address can change across redeploys, breaking any `public_url` you've configured. |
| `admin_username` / `admin_email` | Set once, retrieve password from Secret Manager | Medium | GoAlert has no self-service password reset flow visible from Terraform; losing track of the bootstrapped admin credential means using the `goalert` CLI directly against the database to create a new one. |
| `max_instance_count` | `1` unless you wire a `--api-only` topology | Medium | GoAlert supports multiple engine instances safely (not a double-fire bug per upstream docs), but this module has no built-in mechanism to designate `--api-only` replicas. |

---

For the foundation behaviour referenced throughout — Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. GoAlert-specific application configuration shared with
the Cloud Run variant is described in **[GoAlert_Common](GoAlert_Common.md)**.
