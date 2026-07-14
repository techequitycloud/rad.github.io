---
title: "Gitea on GKE Autopilot"
description: "Configuration reference for deploying Gitea on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Gitea on GKE Autopilot

Gitea is a lightweight, self-hosted Git service and source-code hosting platform (a
community fork of Gogs) providing repository hosting, issue tracking, pull requests,
a built-in CI/CD runner (Actions), code review, and a package registry from a single
Go binary. This module deploys Gitea on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Gitea uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## 1. Overview

Gitea runs as a single Go binary web workload (repository server + built-in SSH/CI
runner supervised by `s6`). The deployment wires together a focused set of Google
Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Gitea pods on port 3000, 1 vCPU / 512Mi by default |
| Database | Cloud SQL for PostgreSQL 15 | `database_type` defaults to `POSTGRES_15`; the `db-init` job is PostgreSQL-only |
| File persistence | Cloud Filestore (NFS) | Repositories, LFS objects and attachments persist under `/data`, shared across pods |
| Object storage | Cloud Storage | None — `Gitea_Common` declares no GCS buckets (`storage_buckets = []`) |
| Secrets | Secret Manager | Auto-generated `SECRET_KEY` and `INTERNAL_TOKEN`; database password |
| Ingress | Cloud Load Balancing / Gateway | `service_type = LoadBalancer` by default, with `enable_custom_domain = true` provisioning a Gateway + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is the intended engine, and only Postgres actually works.**
  `database_type` defaults to `POSTGRES_15`, but the variable's validation also
  accepts `MYSQL`/`MYSQL_8_0`. The bundled `db-init` script (`scripts/gitea/db-init.sh`)
  is hard-coded to `psql` — selecting a MySQL engine breaks database initialization.
  Leave `database_type` on a Postgres value.
- **Cloud SQL is reached via the Auth Proxy sidecar on loopback by default.**
  `enable_cloudsql_volume = true` runs a `cloud-sql-proxy` sidecar; the platform
  entrypoint (`/platform-entrypoint.sh`) composes `GITEA__database__HOST` from the
  injected `DB_HOST`/`DB_IP` and selects `SSL_MODE=disable` for the socket/loopback
  path or `SSL_MODE=require` for a direct private-IP TCP hop.
- **This is a thin custom build, not the stock `gitea/gitea` image used verbatim.**
  `container_image_source` defaults to `"custom"`: Cloud Build produces
  `FROM gitea/gitea:${APP_VERSION}` plus a platform entrypoint that composes the
  `GITEA__database__*` values at runtime (Cloud Run does not interpolate `$(VAR)`
  references the way Kubernetes does, so the same entrypoint is shared across both
  variants for consistency). The stock `s6-svscan` `CMD` is preserved.
- **NFS is enabled by default** (`enable_nfs = true`, mounted at `/data` via
  `nfs_mount_path`) so repositories, Git LFS objects, and issue/PR attachments
  persist and are shared across pods (`GITEA__server__APP_DATA_PATH`).
- **Scale-to-zero by default.** `min_instance_count = 0`, `max_instance_count = 3`.
  Because repository data lives on shared NFS rather than per-pod storage, running
  more than one replica is generally safe for stateless HTTP requests, but Git's own
  locking and any in-flight background jobs are not explicitly coordinated across
  replicas by this module — keep `max_instance_count` conservative unless verified.
- **No installer, no automated admin account.** `GITEA__security__INSTALL_LOCK =
  "true"` skips the first-run web installer (config is supplied entirely via env
  vars) and `GITEA__service__DISABLE_REGISTRATION = "false"` leaves self-registration
  open. No Terraform-managed job creates an admin user — register the first account
  through the web UI, or promote/create one via `kubectl exec ... -- gitea admin
  user create --admin` (verify the binary path in the deployed image before relying
  on this).
- **`SECRET_KEY` and `INTERNAL_TOKEN` are generated automatically** and stored in
  Secret Manager; the database password is the foundation-managed `DB_PASSWORD`
  secret, delivered to Gitea as `GITEA__database__PASSWD`.
- **`public_domain`/`public_url` default to `localhost`.** Unlike some modules,
  Gitea's clone URLs (`GITEA__server__DOMAIN` / `GITEA__server__ROOT_URL`) are **not**
  auto-populated from the assigned LoadBalancer/Gateway address — set
  `public_domain` (or `public_url`) to your real hostname after deploy, or clone
  links and OAuth/webhook callbacks will reference `localhost`.
- **`enable_redis` has no effect on Gitea's own behaviour.** The variable defaults
  `true` and the foundation injects `REDIS_HOST`/`REDIS_PORT`, but `Gitea_Common`
  never sets any `GITEA__cache__*`/`GITEA__session__*`/`GITEA__queue__*` config to
  consume them — Gitea runs with its built-in in-memory/SQLite-free defaults
  regardless of this setting.
- **git-over-SSH is not exposed.** Only the HTTP port (`container_port`, default
  `3000`) is wired into the Kubernetes Service. The image's own `sshd` (supervised
  by `s6` alongside the web server) is not published — clone over HTTPS, or add a
  custom Service/port mapping if SSH access is required.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Gitea workload

Gitea pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. The default `workload_type` is `Deployment`.

- **Console:** Kubernetes Engine → Workloads → select the Gitea workload for pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external
  IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Gitea stores all application data (repository metadata, issues, pull requests,
users, organizations) in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach
it through the **Cloud SQL Auth Proxy** sidecar; no public IP is exposed. On first
deploy the `db-init` job idempotently creates the application role and database and
grants privileges — Gitea itself creates and migrates its schema on first start.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and the Secret Manager secret holding the
password are all in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the
connection model, automated backups, and password rotation.

### C. NFS storage — repositories, LFS, and attachments

Gitea's document root (`GITEA__server__APP_DATA_PATH`) lives on **NFS (Cloud
Filestore)** mounted at `/data` by default, shared across pods. No GCS buckets are
provisioned for this module.

- **Console:** Filestore → Instances.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h /data
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Secret Manager

Two Gitea secrets are generated automatically and stored in Secret Manager:
`SECRET_KEY` (encrypts sensitive data such as 2FA secrets and OAuth tokens) and
`INTERNAL_TOKEN` (authenticates Gitea's own internal API calls). The database
password is managed separately by the foundation. On GKE, both secrets are
materialised under **simple** Secret Manager keys (`SECRET_KEY` / `INTERNAL_TOKEN`,
not the `GITEA__security__*` names used on Cloud Run) because the Secret Store CSI
driver's SecretSync CRD forbids consecutive underscores in a synced-secret
`targetKey`; Gitea reads them from the CSI-mounted files via its native
`GITEA__section__KEY__FILE` convention.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~gitea"
  gcloud secrets versions access latest --secret=<secret-key-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`, `reserve_static_ip = true`), and
`enable_custom_domain = true` provisions a Gateway with a managed certificate (a
`nip.io` hostname is used automatically if `application_domains` is left empty).

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Gitea Application Behaviour

- **First-deploy database setup.** The `db-init` job runs `db-init.sh` using
  `postgres:15-alpine`. It waits for Cloud SQL to accept connections, idempotently
  creates (or re-passwords) the application role with `CREATEDB`, creates the
  database owned by that role, grants full database and `public`-schema privileges
  (PostgreSQL 15+ requires explicit schema grants), then signals the Cloud SQL Auth
  Proxy sidecar to shut down (`POST /quitquitquit`). The job is safe to re-run
  (`execute_on_apply = true`, `max_retries = 3`).
- **Schema creation is Gitea's own responsibility.** No separate migration job
  exists — Gitea creates and migrates its schema itself on first start against the
  empty database. No Postgres extensions are installed (`db-init.sh` needs none).
- **Database env-var composition at runtime.** The foundation injects discrete
  `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER` (+ the `DB_PASSWORD` secret). The platform
  entrypoint composes `GITEA__database__{HOST,NAME,USER,SSL_MODE}` from these at
  container start — branching on whether `DB_HOST` is a Cloud SQL socket path
  (`/cloudsql/...`, SSL disabled), the local proxy loopback (`127.0.0.1`, SSL
  disabled), or a direct private IP (SSL required) — then hands off to Gitea's stock
  `/usr/bin/entrypoint`.
- **No installer, self-registration open.** `GITEA__security__INSTALL_LOCK = "true"`
  skips the interactive first-run installer; `GITEA__service__DISABLE_REGISTRATION =
  "false"` leaves account self-registration enabled. There is no automated admin
  bootstrap — create/promote an admin manually after first deploy.
- **Repository data on NFS.** `GITEA__server__APP_DATA_PATH` points at the
  `nfs_mount_path` (default `/data`), so repositories, Git LFS objects, and
  attachments persist across pod restarts and redeploys.
- **Set `public_domain`/`public_url` after the IP or domain is known.** They default
  to `localhost` / `http://localhost/`. Patch them via `environment_variables` (or
  the module's `public_domain`/`public_url` variables) once the external address is
  assigned, so clone URLs, webhook callbacks, and OAuth redirects resolve correctly.
- **Health path.** Both startup and liveness probes are **HTTP** `GET /api/healthz`,
  which Gitea serves unauthenticated with HTTP 200 once it has finished booting.
- **Inspect the init job and running config:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep GITEA__
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Gitea are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `gitea` | Base name for resources. Do not change after first deploy. |
| `application_version` | `1` | `gitea/gitea` image tag consumed by the Dockerfile's `APP_VERSION` build arg. |
| `container_image_source` | `custom` | Builds the thin platform-entrypoint wrapper over `gitea/gitea`. `prebuilt` deploys `gitea/gitea` directly with no runtime `GITEA__database__*` composition — only use this if you wire the database env vars yourself. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_port` | `3000` | Gitea's HTTP port (`GITEA__server__HTTP_PORT`). |
| `min_instance_count` | `0` | Scale-to-zero by default. |
| `max_instance_count` | `3` | Cost ceiling; raise cautiously — replica coordination for background Git/CI operations is not explicitly managed by this module. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar (loopback) for Cloud SQL connectivity. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the Gitea UI. |
| `workload_type` | `Deployment` | Stateless Deployment; persistent data lives on NFS, not per-pod storage. |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |
| `public_domain` | `localhost` | Sets `GITEA__server__DOMAIN`; used for clone URLs and links. Set to your real hostname. |
| `public_url` | `""` → `http://<public_domain>/` | Sets `GITEA__server__ROOT_URL`. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS is on by default so repositories, LFS objects, and attachments persist and are shared. |
| `nfs_mount_path` | `/mnt/nfs` | GKE-variant default mount path. Note this differs from `Gitea_Common`'s own internal default of `/data` — whichever value is passed wins and is also what `GITEA__server__APP_DATA_PATH` is set to, so the effective data directory always matches the mount. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | The `db-init` job is PostgreSQL-only (`psql`); do not switch to a MySQL value despite it being accepted by validation. |
| `db_name` | `gitea` | Database name. Immutable after first deploy. |
| `db_user` | `gitea` | Application database user; password auto-generated in Secret Manager. |

### Group 20 — Access & Networking (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Identity-Aware Proxy in front of the Gateway. Requires `enable_custom_domain` or `enable_cdn`. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisions a Gateway + managed certificate; falls back to a `nip.io` hostname if `application_domains` is empty. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `application_domains` | `[]` | Custom hostnames + managed certificate. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

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
| `service_url` | URL to reach Gitea. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (empty — Gitea persists to NFS). |
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

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `StatefulSet` forced alongside a stateless setting, IAP with no authorized identities, `quota_memory_*` given as bare integers, an out-of-range `container_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Switching to a MySQL value passes variable validation but breaks the PostgreSQL-only `db-init.sh` script, leaving the database uninitialized. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all data. |
| `SECRET_KEY` / `INTERNAL_TOKEN` (auto-generated) | Never change | Critical | Changing these after first boot invalidates 2FA secrets, OAuth tokens, and internal API authentication. |
| `enable_nfs` | `true` | Critical | Disabling it makes repositories, LFS objects, and attachments ephemeral — lost on pod recreation. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for the default socket/loopback DB connectivity path. |
| `public_domain` / `public_url` | Set to the real hostname | High | Left at `localhost`, clone URLs, webhook callbacks, and OAuth redirects are wrong for every user. |
| `max_instance_count` | Keep conservative (`3` default) | High | Scaling further without verifying multi-replica coordination for background Git/Actions work is unverified behaviour. |
| `memory_limit` / `cpu_limit` | `512Mi` / `1000m` (defaults) | High | Below Kubernetes' gen2-equivalent floors the pod OOMs or throttles under load; raise for larger repositories or CI workloads. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| Admin account creation | Manual post-deploy step | Medium | No account is bootstrapped automatically; forgetting this step with open self-registration means the first registered user is not guaranteed to be an admin. |
| `enable_redis` | Inert for Gitea | Low | Toggling it has no effect — no `GITEA__cache__*`/`GITEA__session__*` wiring consumes `REDIS_HOST`. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and `public_url`. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Gitea-specific application configuration shared with the Cloud Run variant is
described in **[Gitea_Common](Gitea_Common.md)**.
