---
title: "Shlink on GKE Autopilot"
description: "Configuration reference for deploying Shlink on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Shlink on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Shlink_GKE.png" alt="Shlink on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Shlink is a self-hosted, open-source URL shortener that exposes a REST API, a
web client, QR code generation, and detailed visit-tracking analytics. This
module deploys Shlink on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Shlink uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Shlink runs as a single stateless PHP/Swoole workload with all state in
PostgreSQL — there is no filesystem persistence to manage.

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | A single container on port `8080`, `1000m` CPU / `512Mi` memory by default |
| Database | Cloud SQL for PostgreSQL 15 | Required — the engine is fixed at `POSTGRES_15` |
| Object storage | Cloud Storage | None provisioned — Shlink stores everything in PostgreSQL |
| Secrets | Secret Manager | Auto-generated `INITIAL_API_KEY` (first REST API key) and the database password |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** `database_type = "POSTGRES_15"` is fixed by
  the Common module; other engines are not supported.
- **Cloud SQL is reached via the Auth Proxy sidecar on loopback.**
  `enable_cloudsql_volume = true` injects a cloud-sql-proxy sidecar; App_GKE
  then sets `DB_HOST = DB_IP = 127.0.0.1`. Shlink reads `DB_HOST`/`DB_USER`/
  `DB_NAME`/`DB_PASSWORD` directly from the environment — no entrypoint
  remapping is needed.
- **`DB_NAME`/`DB_USER` are intentionally left unset by the Common module.**
  The foundation creates the Cloud SQL role/database under its own
  tenant-scoped naming convention and injects the real values; presetting
  them to the short `shlink`/`shlink` names would authenticate as a
  never-created role.
- **No persistent filesystem.** `gcs_volumes` defaults to `[]` and NFS is not
  wired in — Shlink stores short URLs, visits, and API keys entirely in
  PostgreSQL, so there is nothing to persist outside the database.
- **Database migrations run automatically on container start.** The official
  `shlinkio/shlink` image runs its own schema migrations at boot; there is no
  separate migrate job (only `db-init`, which creates the role/database).
- **`INITIAL_API_KEY` is generated automatically** and stored in Secret
  Manager, then injected as a container secret env var so Shlink bootstraps
  its first REST API key on initial start. Retrieve it after deploy — Shlink
  has no admin username/password login; all access is API-key based.
- **The Dockerfile always builds `FROM shlinkio/shlink:stable`** — unlike
  most custom-build modules in this repository, `application_version` is
  **not** wired into the image tag via a build ARG (`container_build_config`
  keeps `build_args = {}`). Changing `application_version` has no effect on
  which image is built. <!-- TODO: verify this is intentional and not a gap --> Pin a specific release by editing the
  Common module's `Dockerfile` `FROM` line directly.
- **Scales 1→3 pods by default** (`min_instance_count = 1`,
  `max_instance_count = 3`). Shlink is stateless per-request against
  PostgreSQL, so horizontal scaling is safe out of the box.
- **`DEFAULT_DOMAIN` is not preset.** The public hostname used when
  generating short URLs is unknown until after deploy — set it via
  `environment_variables` once the LoadBalancer IP or custom domain is known.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Shlink workload

Shlink pods are scheduled on Autopilot, which bills for the CPU/memory the
pods actually request. The workload has no persistent storage, so it deploys
as a standard `Deployment` with the default `RollingUpdate` strategy.

- **Console:** Kubernetes Engine → Workloads → select the Shlink workload for
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows
  the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Shlink stores all application data (short URLs, visit records, tags, and API
keys) in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it through
the **Cloud SQL Auth Proxy** sidecar on `127.0.0.1:5432`; no public IP is
exposed. On first deploy the `db-init` job (using `postgres:15-alpine`)
idempotently creates the application role and database, grants ownership and
privileges, then shuts down its own proxy sidecar via the `quitquitquit`
endpoint.

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

### C. Secret Manager

Two secrets back the deployment: `INITIAL_API_KEY` (Shlink's first REST API
key, auto-generated by `Shlink_Common` and injected as a secret env var so the
app bootstraps it on first start) and the database password (managed by the
foundation). On GKE, secrets are projected into pods via the Secret Store CSI
driver / SecretSync.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~shlink"
  gcloud secrets versions access latest --secret=<initial-api-key-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### D. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing
IP (`service_type = LoadBalancer`, `reserve_static_ip = true` so the address
survives redeploys). A custom domain with a Google-managed certificate can be
enabled.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to
Cloud Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Shlink Application Behaviour

- **First-deploy database setup.** The `db-init` job runs `db-init.sh` using
  `postgres:15-alpine`. It waits for PostgreSQL to be reachable, then
  idempotently `CREATE`s (or `ALTER`s) the application role and database,
  grants ownership and `ALL PRIVILEGES`, and grants `ALL ON SCHEMA public`.
  The job is safe to re-run (`execute_on_apply = true`). It authenticates as
  `postgres` using the same secret as the app's own `DB_PASSWORD`
  (`ROOT_PASSWORD` and `DB_PASSWORD` both reference
  `database_password_secret`). <!-- TODO: verify ROOT_PASSWORD vs DB_PASSWORD sharing the same secret is intentional -->
- **Database migrations run at boot, no separate migrate job.** The official
  `shlinkio/shlink` image runs its own schema migrations on container start
  against the empty database created by `db-init`; there is no
  `execute_on_apply` migrate step to wait on beyond `db-init` itself.
- **No admin account — API-key based access.** Shlink does not have an
  admin username/password. `Shlink_Common` generates `INITIAL_API_KEY` and
  injects it as a secret env var; the image reads it on first start to seed
  the first valid REST API key. Retrieve it from Secret Manager (see
  [2.C](#c-secret-manager)) and use it as the `X-Api-Key` header against the
  REST API or the web client login.
- **DB connectivity is loopback via the Auth Proxy sidecar.** With
  `enable_cloudsql_volume = true` (default), App_GKE injects
  `DB_HOST = DB_IP = 127.0.0.1`; Shlink reads `DB_HOST`, `DB_USER`, `DB_NAME`,
  and `DB_PASSWORD` directly — no socket-path or URL-DSN handling is needed.
- **Health path.** Both the startup and liveness probes are **HTTP**
  `GET /rest/health` — an unauthenticated, public endpoint that returns HTTP
  200 with `{"status":"pass"}` (`application/health+json`). There is no web
  homepage at `/` (it 404s), so use `/rest/health` for manual checks too.
  `failure_threshold = 30` at `period_seconds = 10` on the startup probe
  covers ~300s for first-boot migrations.
- **Stateless — safe to scale horizontally.** All state lives in PostgreSQL,
  so the default `min_instance_count = 1` / `max_instance_count = 3` and the
  standard `RollingUpdate` deployment strategy are both safe without further
  tuning.
- **Set `DEFAULT_DOMAIN` after the IP/domain is known.** It is not preset —
  add it via `environment_variables` once the LoadBalancer IP or custom
  domain is assigned, so generated short URLs use the correct public host:
  ```bash
  kubectl set env deploy/<service-name> -n "$NAMESPACE" DEFAULT_DOMAIN=shlink.example.com
  ```
- **Optional visit geolocation.** Shlink can resolve visitor geolocation via
  a MaxMind GeoLite2 database if a `GEOLITE_LICENSE_KEY` is supplied; it is
  not set by this module — add it via `environment_variables` if geolocation
  is desired. <!-- TODO: verify exact env var name and download behaviour against the running image -->
- **Inspect the init job and running config:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep DB_
  curl -s http://<external-ip-or-domain>/rest/health
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Shlink are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults.

### Group 3 — Application & Database Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `shlink` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Not wired into the image build — the Dockerfile always builds `FROM shlinkio/shlink:stable`. |
| `admin_username` | `shlink` | Not used by Shlink (API-key auth, not admin accounts). Retained for wrapper interface parity. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `custom` | Cloud Build builds the thin `shlinkio/shlink:stable` wrapper image. |
| `container_image` | `shlinkio/shlink:stable` | Used only when `container_image_source = "prebuilt"`. |
| `container_port` | `8080` | Shlink's HTTP server listens on `8080`. |
| `container_resources.cpu_limit` | `1000m` | 1 vCPU. |
| `container_resources.memory_limit` | `512Mi` | Sufficient for the Swoole-based PHP runtime. |
| `min_instance_count` | `1` | Minimum pod replicas (HPA `minReplicas`). |
| `max_instance_count` | `3` | Maximum pod replicas — safe to raise since Shlink is stateless. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar (loopback) — required on GKE. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Unix socket mount path for the proxy sidecar. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the Shlink REST API and web client. |
| `workload_type` | `null` → `Deployment` | Deployment (stateless, `RollingUpdate` strategy). |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | No buckets defined by the Common module — Shlink needs none. |
| `gcs_volumes` | `[]` | Empty by default — Shlink stores all data in PostgreSQL and needs no persistent filesystem. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed — the only supported engine. |
| `application_database_name` | `shlink` | Database name. Immutable after first deploy. |
| `application_database_user` | `shlink` | Application database user; password auto-generated in Secret Manager. |

### Group 22 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/rest/health`, `failure_threshold=30`, `period_seconds=10` | Public, unauthenticated — covers ~300s for first-boot migrations. |
| `health_check_config` | HTTP `/rest/health`, `failure_threshold=3`, `period_seconds=30` | Liveness probe; same public endpoint. |
| `uptime_check_config` | `enabled=false`, `path=/rest/health` | Enable for an external Cloud Monitoring uptime check. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way
to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Shlink. |
| `health_check_url` | Ready-to-curl health-check URL (`/rest/health`) — use this, not `/`, which 404s. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (`127.0.0.1` via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (empty for Shlink). |
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
> through the [App_GKE](App_GKE.md) foundation engine, which validates values
> *and combinations* at plan time — a `StatefulSet` forced alongside a
> stateless setting, IAP with no authorized identities,
> `quota_memory_*` given as bare integers, an out-of-range
> `container_port`/`backup_retention_days`. Invalid configuration fails the
> **plan** with a clear, named error before any resource is created, so most
> mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (fixed) | Critical | Not overridable — Shlink only supports PostgreSQL. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all short URLs and visit history. |
| `environment_variables` (`DB_NAME`/`DB_USER`) | Do not set manually | Critical | Overriding these to the short `shlink`/`shlink` names bypasses the foundation's tenant-scoped role, causing `password authentication failed`. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar on `127.0.0.1:5432` is required for DB connectivity on GKE. |
| `INITIAL_API_KEY` (auto-generated) | Retrieve after deploy | High | Shlink has no admin login — losing track of this secret without rotating it locks you out of the REST API and web client. |
| `startup_probe_config` / `health_check_config` path | `/rest/health` | High | Pointing probes at `/` (404) or an authenticated endpoint prevents the pod from ever becoming Ready. |
| `max_instance_count` | `3` (or higher) | Low | Shlink is stateless; scaling beyond 3 is safe if traffic warrants it — no shared-storage/lock risk. |
| `DEFAULT_DOMAIN` (set post-deploy) | External LoadBalancer/domain URL | Medium | A wrong or missing domain makes generated short URLs point at the wrong host. |
| `memory_limit` | `512Mi` | Medium | The gen2/Autopilot memory floor and Swoole runtime needs; raise if pods OOM under sustained load. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and any hardcoded `DEFAULT_DOMAIN`. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention of short-URL and visit history data. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Shlink-specific application configuration shared
with the Cloud Run variant is described in **[Shlink_Common](Shlink_Common.md)**.
