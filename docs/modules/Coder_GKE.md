---
title: "Coder on GKE Autopilot"
description: "Configuration reference for deploying Coder on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Coder on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Coder_GKE.png" alt="Coder on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Coder is an open-source, self-hosted platform for provisioning remote
development environments ("workspaces") defined as code with Terraform. It
ships as a single Go binary (`coder server`) that serves the control-plane
web UI/API and proxies WebSocket connections for browser IDEs and terminal
sessions to running workspaces. This module deploys the Coder **control
plane** on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation,
which provisions and manages the shared Google Cloud and Kubernetes
infrastructure. Provisioning actual workspaces additionally requires a
configured provisioner and a compute target (for example a Kubernetes
cluster or a cloud VM template) set up post-deploy — this module only stands
up the control plane.

This guide focuses on the cloud services Coder uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Coder's control plane is stateless — all state, including its self-generated
signing keys, lives in PostgreSQL — so the deployment wires together a small,
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Go binary on port 3000, 2 vCPU / 4 GiB by default, HPA-scaled 1–5 replicas |
| Database | Cloud SQL for PostgreSQL 15 | Required — MySQL is rejected at plan time |
| Object storage | Cloud Storage | A `storage` bucket provisioned automatically by `Coder_Common` |
| Secrets | Secret Manager | Only the Foundation-managed database password — Coder has no application secret of its own |
| Ingress | Cloud Load Balancing | Kubernetes Ingress with a reserved global static IP; optional custom domain |
| Container build | Cloud Build + Artifact Registry | Wraps the upstream `ghcr.io/coder/coder` image with a cloud entrypoint |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is required.** `database_type` defaults to `POSTGRES_15`; a
  plan-time validation in `validation.tf` rejects anything that isn't
  `POSTGRES_13`/`14`/`15`/`NONE` — MySQL is not supported.
- **`container_image_source = "custom"` is required, not optional.** The
  upstream `ghcr.io/coder/coder` image cannot parse the Foundation's DB
  wiring on its own; Cloud Build wraps it with a cloud entrypoint that
  assembles `CODER_PG_CONNECTION_URL` and `CODER_ACCESS_URL` at container
  start.
- **Cloud SQL is reached via the Auth Proxy sidecar on loopback.** GKE
  injects `DB_HOST = 127.0.0.1`; the entrypoint builds a `postgres://` DSN
  with `sslmode=disable` (the proxy already TLS-terminates the connection)
  and URL-encodes the password.
- **No NFS, no Redis, and no application secret.** All Coder state —
  workspaces, templates, users, sessions, build queue, and self-generated
  signing keys — lives in PostgreSQL. `enable_nfs` and `enable_redis` both
  default `false` and are not needed for normal operation.
- **No separate migration job.** Coder runs its own schema migrations on
  boot; the only initialization job is `db-init`, which creates the empty
  database and role.
- **Horizontally scalable by default.** `min_instance_count = 1`,
  `max_instance_count = 5` — the stateless control plane can run multiple
  replicas against the shared database, unlike single-instance stateful
  apps.
- **`session_affinity = ClientIP`** keeps a browser's WebSocket-heavy
  terminal/IDE traffic pinned to the same pod across the session.
- **Ingress and a static IP are provisioned out of the box**
  (`enable_custom_domain = true`, `reserve_static_ip = true`).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and
other identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Coder control-plane workload

Coder pods run on Autopilot, billed for the CPU/memory the pods actually
request. Because the control plane is stateless, the workload runs as a
standard `Deployment` with a `RollingUpdate` strategy (no NFS-backed
`Recreate` constraint) and is safe to scale horizontally.

- **Console:** Kubernetes Engine → Workloads → select the Coder workload for
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows
  the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl get hpa -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for how Autopilot, HPA scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Coder stores everything — workspaces, templates, users, audit logs, sessions,
and its own signing keys — in a managed Cloud SQL for PostgreSQL 15 instance.
Pods reach it through the **Cloud SQL Auth Proxy** sidecar on
`127.0.0.1:5432`; no public IP is exposed. On first deploy the `db-init` job
creates the application database and role; Coder's own migration engine then
creates the schema on server boot.

- **Console:** SQL → select the instance for connections, backups, flags,
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and the Secret Manager secret holding the
password are all in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md) for
the connection model, automated backups, and password rotation.

### C. Cloud Storage

A dedicated **Cloud Storage** bucket (suffix `storage`) is provisioned
automatically by `Coder_Common` and the workload service account is granted
access. It is not currently mounted into the Coder container by default —
Coder does not require a shared filesystem, since state lives in PostgreSQL.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts (`gcs_volumes`)
if you need to attach one for a custom workflow.

### D. Secret Manager

Coder is unusual among stateful applications in that it creates **no
application secret of its own** — it self-generates its signing keys and
persists them in the `coder` PostgreSQL database on first boot. The only
credential Secret Manager holds is the Foundation-managed database password.
On GKE, secrets are projected into pods via the Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~coder"
  gcloud secrets versions access latest --secret=<db-password-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through a Kubernetes Ingress backed by a
global static IP (`reserve_static_ip = true` so the address survives
redeploys). A custom domain with a Google-managed certificate can be enabled
via `application_domains`. Because Coder proxies long-lived WebSocket
connections for the web terminal and workspace app traffic, keep
`session_affinity = ClientIP` so a client's requests land on the same pod for
the life of a session.

- **Console:** Network services → Load balancing; VPC network → IP
  addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to
Cloud Monitoring. Optional uptime checks and alert policies are available
(`uptime_check_config` is disabled by default).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Coder Application Behaviour

- **First-deploy database setup, no separate migration job.** The `db-init`
  job runs `db-init.sh` using `postgres:15-alpine`. It waits for the Cloud
  SQL Auth Proxy sidecar, idempotently creates the `coder` role and
  database, grants privileges, and reassigns the `public` schema owner, then
  signals the proxy sidecar to shut down (`--quitquitquit`) so the Job pod
  completes. Coder then runs its own schema migrations on server boot — there
  is no dedicated migrate job, unlike apps with a separate `db-migrate` step.
- **No admin account is pre-provisioned.** The first user to reach the web
  UI after a successful boot completes Coder's interactive first-run setup
  (creating the initial admin account). There is no auto-generated admin
  password secret to retrieve.
- **DSN assembly at container start, not baked into the image.**
  `entrypoint.sh` (in `Coder_Common/scripts/`) builds
  `CODER_PG_CONNECTION_URL` from the Foundation-injected `DB_*` values,
  because Coder's Go driver expects a `postgres://` URL and cannot parse the
  libpq keyword form. On GKE, `DB_HOST=127.0.0.1` (the Auth Proxy sidecar)
  resolves to `sslmode=disable`; the password is RFC-3986 percent-encoded so
  special characters don't break the URL. `CODER_ACCESS_URL` defaults to the
  Foundation-injected `GKE_SERVICE_URL`.
- **WebSocket-heavy traffic needs sticky routing.** The web terminal,
  workspace app proxying, and the CLI's `coder ssh`/port-forward all ride
  long-lived WebSocket connections through the control plane. Keep
  `session_affinity = ClientIP` (the default) so a client's connection
  persists against one pod; scaling `max_instance_count` above 1 is safe for
  the stateless control plane itself, but an in-flight WebSocket session does
  not migrate between pods if one is drained mid-session.
- **Health probe paths.** Startup and liveness probes both target **HTTP
  `GET /health`** with a 60-second initial delay; the startup probe allows up
  to 30 failures at a 15-second period to absorb Coder's first-boot schema
  migration. The Common-supplied readiness probe (used by the Foundation's
  `additional_services`/readiness wiring) targets `GET /healthz` separately.
- **Telemetry is disabled by default** (`CODER_TELEMETRY_ENABLE = "false"`),
  and `CODER_VERBOSE = "false"`.
- **Control plane only — workspaces need a provisioner + target.** This
  module deploys `coder server`; running actual workspaces additionally
  requires configuring a provisioner and a compute target (for example
  another Kubernetes cluster/namespace, or cloud VM templates) through
  Coder's template system after first login.
- **Verify the deployment:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep CODER_
  curl -s https://<service-url>/healthz
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform.
Only settings specific to or notable for Coder are listed; every other input
is inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `coder` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Coder release tag; `latest` maps to a pinned tag (`v2.24.1`) via the app-specific `CODER_VERSION` build ARG so it never resolves against a non-existent `ghcr.io/coder/coder:latest`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `custom` | Required — the upstream image cannot be deployed prebuilt; Cloud Build wraps it with the DSN-assembling entrypoint. |
| `container_port` | `3000` | Coder's `CODER_HTTP_ADDRESS` bind port. |
| `container_resources` | `cpu_limit=2000m`, `memory_limit=4Gi` | 2 vCPU / 4 GiB default for the control plane. |
| `min_instance_count` / `max_instance_count` | `1` / `5` | HPA replica bounds — the stateless control plane scales horizontally against the shared database. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar (loopback) — required on GKE; a plan-time guard rejects it when `database_type = "NONE"`. |
| `enable_image_mirroring` | `true` | Always on for Coder — the GHCR-sourced base image is mirrored into Artifact Registry. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the Coder UI/API. |
| `workload_type` | `null` → `Deployment` | Deployment (stateless, standard `RollingUpdate`). |
| `session_affinity` | `ClientIP` | Sticky routing so a client's WebSocket session reaches the same pod. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Not required — all state is in PostgreSQL. If enabled, `nfs_mount_path` must be a real directory, never a subpath of `/opt/coder` (the `coder` binary, a file). |
| `nfs_mount_path` | `/home/coder/data` | Only used when `enable_nfs = true`. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not required — sessions and the build queue live in PostgreSQL, unlike apps that need an external cache/queue. |
| `redis_host` | `""` | Only relevant if `enable_redis = true`; a plan-time guard requires either `redis_host` or `enable_nfs = true`. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Coder requires PostgreSQL 13+; MySQL is rejected at plan time (`validation.tf`). |
| `application_database_name` | `coder` | Database name. Immutable after first deploy — renaming recreates the DB and orphans all Coder state. |
| `application_database_user` | `coder` | Application database user; password auto-generated in Secret Manager. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | A Kubernetes Ingress is provisioned out of the box. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `application_domains` | `[]` | Custom hostnames + managed certificate. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour. Note:
`elasticsearch_url`, `elasticsearch_username`, and
`elasticsearch_password_secret` are declared in `variables.tf` for catalogue
parity but are **not forwarded** to the Foundation call in `main.tf` — Coder
has no Elasticsearch integration in this module, so setting them has no
effect.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest
way to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Coder. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup (`db-init`) and (optional) import jobs. |
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

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_GKE](App_GKE.md) foundation engine, which validates
> values *and combinations* at plan time — an out-of-range instance count,
> IAP enabled with no OAuth credentials, `quota_memory_*` given as bare
> integers. Coder_GKE additionally layers its own guards in `validation.tf`
> (PostgreSQL-only `database_type`, the Redis host/NFS precondition, the
> Cloud SQL volume vs `database_type = "NONE"` conflict). Invalid
> configuration fails the **plan** with a clear, named error before any
> resource is created, so most mistakes below are caught up front rather
> than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (or 13/14) | Critical | Any non-PostgreSQL engine is rejected at plan time; forcing one around the guard breaks every query Coder issues. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all workspaces, templates, users, and self-generated signing keys. |
| `container_image_source` | `custom` | Critical | Switching to `prebuilt` points GKE at the raw `ghcr.io/coder/coder` image, which cannot assemble `CODER_PG_CONNECTION_URL` from the Foundation's DB vars and fails to boot. |
| `enable_cloudsql_volume` | `true` | Critical | Required for DB connectivity on GKE; a plan-time guard also blocks it when `database_type = "NONE"` to avoid a proxy sidecar with nothing to connect to. |
| `nfs_mount_path` (if `enable_nfs=true`) | A real directory, e.g. `/home/coder/data` | Critical | Mounting over `/opt/coder` — the `coder` binary itself — hides the executable and the container fails to start. |
| `session_affinity` | `ClientIP` | High | Without stickiness, an in-flight WebSocket terminal/IDE session can be routed to a different pod mid-session and drop. |
| `enable_redis` | `false` | Medium | Not needed — enabling it without `redis_host` set or `enable_nfs=true` fails plan-time validation; even correctly configured it adds an unused dependency since Coder keeps all state in PostgreSQL. |
| `max_instance_count` | `5` (adjust to load) | Medium | Safe to raise for a stateless control plane, but each replica still opens its own DB connection pool — watch Cloud SQL `max_connections` at high replica counts. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS, `CODER_ACCESS_URL`, and any registered OAuth/OIDC redirect. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention of workspace/template history. |
| `elasticsearch_url` / `elasticsearch_username` / `elasticsearch_password_secret` | Leave unset | Low | Inert in this module (not forwarded to the Foundation call) — setting them has no effect and does not enable search integration. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Coder-specific application configuration shared
with the Cloud Run variant is described in
**[Coder_Common](Coder_Common.md)**.
