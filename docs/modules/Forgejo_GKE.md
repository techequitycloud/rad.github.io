---
title: "Forgejo on GKE Autopilot"
description: "Configuration reference for deploying Forgejo on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Forgejo on GKE Autopilot

Forgejo is a lightweight, community-managed, self-hosted Git service — a fork of
Gitea — providing repository hosting, issue tracking, pull requests, a built-in
CI/CD (Actions) runner, code review, and a package registry from a single Go
binary. This module deploys Forgejo on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Forgejo uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

Forgejo runs as a single Go binary supervised by `s6` inside the stock
`codeberg.org/forgejo/forgejo` image, wrapped by a thin platform entrypoint that
composes the database connection at runtime. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Forgejo pods on port 3000 (HTTP), 2 vCPU / 2Gi by default |
| Database | Cloud SQL for PostgreSQL 15 | Locked in practice — `db-init.sh` uses `psql`; the `database_type` dropdown lists MYSQL/NONE as options but they are not supported |
| File persistence | Cloud Filestore (NFS) | Enabled by default; repositories, LFS objects and attachments live under the NFS mount (`/mnt/nfs`), shared across pods |
| Object storage | Cloud Storage | A generic, unused `data`-suffixed bucket is provisioned by the foundation default — Forgejo itself stores nothing in GCS |
| Secrets | Secret Manager | Auto-generated `SECRET_KEY` and `INTERNAL_TOKEN`, plus the database password; delivered to pods via CSI-mounted files because the GKE SecretSync CRD forbids `__` in synced-secret keys |
| Ingress | Cloud Load Balancing (Gateway API) | External LoadBalancer with a reserved static IP; custom domain support is enabled by default, falling back to an auto-provisioned `nip.io` HTTPS hostname when no domain is set |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is the only engine that actually works.** `database_type`
  defaults to `POSTGRES_15`; the `db-init` job's script is written entirely
  against `psql`, so selecting MySQL or `NONE` breaks database setup even though
  the variable metadata lists them as options.
- **Cloud SQL is reached via the Auth Proxy sidecar on loopback.**
  `enable_cloudsql_volume = true` by default, so a `cloud-sql-proxy` sidecar
  listens on `127.0.0.1:5432`; the platform entrypoint selects `SSL_MODE=disable`
  for that hop.
- **Deployment (not StatefulSet), NFS-backed, scale-to-zero capable.**
  `workload_type = "Deployment"`, `min_instance_count = 0`,
  `max_instance_count = 3`. Because `enable_nfs = true` by default, the
  foundation forces the `Recreate` rollout strategy (see
  [App_GKE](App_GKE.md)) so an update never runs two pods against the same NFS
  volume and database simultaneously.
- **NFS is enabled by default**, mounted at `/mnt/nfs` (`GITEA__server__APP_DATA_PATH`)
  — this is where repositories, Git LFS objects, and attachments persist.
- **Session affinity is `ClientIP`.**
- **No separate migration job.** `GITEA__security__INSTALL_LOCK = "true"` skips
  Forgejo's web installer; the `forgejo/forgejo` image creates and migrates its
  own schema on container start against the empty database the `db-init` job
  prepared.
- **No admin account is bootstrapped by Terraform.** There is no init job that
  creates a Forgejo admin user — see [Section 3](#3-forgejo-application-behaviour)
  for the manual step.
- **`SECRET_KEY` and `INTERNAL_TOKEN` are auto-generated** and stored in Secret
  Manager; on GKE they (and the DB password) are read from CSI-mounted secret
  files via Forgejo's native `GITEA__section__KEY__FILE` convention.
- **`public_domain` / `public_url` default to `localhost`.** Even though
  `enable_custom_domain = true` auto-provisions a reachable HTTPS endpoint,
  `GITEA__server__DOMAIN` / `GITEA__server__ROOT_URL` are not automatically
  synced to it — set `public_domain` (and optionally `public_url`) to the real
  external hostname so clone URLs and links resolve correctly.
- **Self-registration is open by default** (`GITEA__service__DISABLE_REGISTRATION = "false"`).
- **Redis is provisioned but not actually wired into Forgejo's config.**
  `enable_redis = true` by default and the foundation injects `REDIS_HOST` /
  `REDIS_PORT` into the container, but `Forgejo_Common` sets no
  `GITEA__cache__*` / `GITEA__session__*` / `GITEA__queue__*` variables to
  consume them — Forgejo falls back to its built-in cache/session defaults
  unless you add that wiring yourself via `environment_variables`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Forgejo workload

Forgejo pods run the `codeberg.org/forgejo/forgejo` image behind a thin custom
build that installs a platform entrypoint (`/platform-entrypoint.sh`), then execs
the stock Forgejo entrypoint under `s6`. Because the workload is NFS-backed by
default, the Deployment uses the `Recreate` strategy.

- **Console:** Kubernetes Engine → Workloads → select the Forgejo workload for
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector app=forgejo 2>/dev/null || kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Forgejo stores all application metadata (users, repositories, issues, pull
requests, Actions runs) in a managed Cloud SQL for PostgreSQL 15 instance. Pods
reach it through the **Cloud SQL Auth Proxy** sidecar on `127.0.0.1:5432`; no
public IP is exposed. On first deploy the `db-init` job creates the application
role and database; Forgejo then creates and migrates its own schema on first
container start.

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

### C. Cloud Filestore (NFS) — repository storage

Forgejo's repository data, Git LFS objects, and attachments live on **NFS
(Cloud Filestore)**, mounted inside the pod at `/mnt/nfs` by default
(`GITEA__server__APP_DATA_PATH`). No GCS bucket is used for application data —
`Forgejo_Common` always reports an empty `storage_buckets` output — though the
generic `storage_buckets` variable default still creates one unused
`data`-suffixed bucket unless overridden.

- **Console:** Filestore → Instances; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  gcloud storage buckets list --project "$PROJECT" --filter="name~data"
  ```

See [App_GKE](App_GKE.md) for NFS discovery/creation and GCS Fuse mounts.

### D. Secret Manager

Two Forgejo secrets are generated automatically and stored in Secret Manager:
`SECRET_KEY` (encrypts sensitive data such as 2FA and OAuth tokens) and
`INTERNAL_TOKEN` (authenticates Forgejo's own internal API calls). The database
password is the foundation-managed secret. On GKE, all three are projected into
pods as files via the Secret Store CSI driver and read by Forgejo through the
`GITEA__section__KEY__FILE` convention (`GITEA__database__PASSWD__FILE`,
`GITEA__security__SECRET_KEY__FILE`, `GITEA__security__INTERNAL_TOKEN__FILE`) —
because the GKE SecretSync CRD rejects `__` in a synced-secret's `targetKey`,
these are materialised under the simple keys `SECRET_KEY` / `INTERNAL_TOKEN`
rather than the `GITEA__` names used on Cloud Run.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~forgejo"
  gcloud secrets versions access latest --secret=<secret-key-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`, `reserve_static_ip = true` so the address
survives redeploys) fronted by a Gateway (`enable_custom_domain = true`), which
provisions an automatic `nip.io` HTTPS hostname when no `application_domains`
are supplied. Only the HTTP port (`container_port = 3000`) is wired into the
Kubernetes Service — Forgejo's internal `sshd` (supervised by the same `s6`
process, per the Dockerfile) is **not** exposed by this module, so
`git+ssh://` clone URLs are not reachable externally without additional,
manually-added networking.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,gateway -n "$NAMESPACE"
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

## 3. Forgejo Application Behaviour

- **First-deploy database setup.** The `db-init` job runs `db-init.sh` using
  `postgres:15-alpine`. It waits for Cloud SQL to accept connections, idempotently
  creates (or re-passwords) the application role with `CREATEDB`, creates the
  database owned by that role, and grants full database + `public` schema
  privileges (PG15+). No Postgres extensions are installed by the script itself.
  The job is safe to re-run (`execute_on_apply = true`, `max_retries = 3`) and
  signals the Cloud SQL Auth Proxy sidecar to shut down (`POST /quitquitquit` on
  `localhost:9091`) so the Job container exits cleanly.
- **No separate migration job — schema creation happens on container boot.**
  With `GITEA__security__INSTALL_LOCK = "true"`, Forgejo's web installer is
  skipped; the stock `forgejo/forgejo` entrypoint creates and migrates the
  schema in the empty database on first start, and applies further migrations
  on subsequent version upgrades.
- **No admin account is created automatically.** No initialization job runs a
  `forgejo admin user create` (or equivalent) step, and self-registration is
  enabled (`GITEA__service__DISABLE_REGISTRATION = "false"`), so anyone who can
  reach the service can create an account. The operator-side step to bootstrap
  the first administrator is to `kubectl exec` into a running pod and use
  Forgejo's own admin CLI. TODO: the exact CLI invocation and confirmation that
  the CLI binary is on `PATH` inside the deployed container were not verified
  from this repository's source — confirm against the running pod
  (`kubectl exec -n "$NAMESPACE" deploy/<service-name> -- forgejo admin user create --help`)
  before relying on it.
- **DB connection env-var wiring.** The foundation injects `DB_HOST` (the Cloud
  SQL Auth Proxy loopback address on GKE), `DB_NAME`, `DB_USER`, and the
  `DB_PASSWORD` secret. Because Kubernetes-style `$(VAR)` references are not used
  (Cloud Run doesn't interpolate them, so the same entrypoint works on both
  platforms), `/platform-entrypoint.sh` composes `GITEA__database__{HOST,NAME,USER,SSL_MODE}`
  at runtime from the injected `DB_*` values, selecting `SSL_MODE=disable` for
  the Unix-socket / loopback-proxy hops used on GKE.
  `GITEA__database__PASSWD` is not injected directly on GKE; instead Forgejo
  reads it from the CSI-mounted `GITEA__database__PASSWD__FILE`.
- **NFS-backed rollouts use `Recreate`.** Updates terminate the old pod before
  starting the new one, avoiding two pods writing to the same repository data on
  NFS. `max_instance_count` still defaults to `3` (not `1`) — Forgejo is not a
  single-writer app in the same sense as a SQLite-backed one, but no
  multi-replica correctness testing for concurrent Git writes against the same
  NFS-backed data directory is documented in this module, so treat scaling
  beyond a single steady-state replica with the same caution as any other
  shared-filesystem workload.
- **Health path.** Both probes are **HTTP** `GET /api/healthz`, which Forgejo
  serves without authentication once database migrations complete: startup probe
  `initial_delay_seconds=0`, `timeout_seconds=10`, `period_seconds=30`,
  `failure_threshold=10`; liveness probe `initial_delay_seconds=60`,
  `timeout_seconds=5`, `period_seconds=30`, `failure_threshold=3`.
- **Inspect the init job and running config:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep GITEA__
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Forgejo are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `forgejo` | Base name for resources. Do not change after first deploy. |
| `application_version` | `11` | `codeberg.org/forgejo/forgejo` image tag, applied via the app-specific `FORGEJO_VERSION` build arg (`latest` maps to the pinned `11`). |
| `description` | `Forgejo - Self-hosted Git service and source-code hosting` | Populates the workload description field. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `custom` | Builds a thin wrapper `FROM codeberg.org/forgejo/forgejo:${FORGEJO_VERSION}` that adds the platform DB-wiring entrypoint. |
| `container_port` | `3000` | Forgejo HTTP port; also sets `GITEA__server__HTTP_PORT`. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar on loopback — required on GKE. |
| `cpu_limit` | `2000m` | 2 vCPU per pod (Forgejo-specific override of the generic `container_resources` default). |
| `memory_limit` | `2Gi` | 2Gi per pod (Forgejo-specific override). |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `workload_type` | `Deployment` | Deployment (NFS-backed, `Recreate` strategy — see [App_GKE](App_GKE.md)). |
| `service_type` | `LoadBalancer` | External IP for the Forgejo UI/Git-over-HTTP. |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |
| `public_domain` | `localhost` | Sets `GITEA__server__DOMAIN`; used to build clone URLs and links. Override before/after first deploy. |
| `public_url` | `""` → `http://<public_domain>/` | Sets `GITEA__server__ROOT_URL`. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/healthz`, `failure_threshold=10`, `period_seconds=30` | App-specific startup probe (see [Section 3](#3-forgejo-application-behaviour)). |
| `liveness_probe` | HTTP `/api/healthz`, `initial_delay_seconds=60`, `period_seconds=30`, `failure_threshold=3` | App-specific liveness probe. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS is on by default so repositories, LFS objects, and attachments persist and are shared across pods. |
| `nfs_mount_path` | `/mnt/nfs` | Mounted path, also set as `GITEA__server__APP_DATA_PATH`. This is the effective default for this module — the `Forgejo_Common` module's own internal default (`/data`) is overridden by this variant. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | Injects `REDIS_HOST` (defaulting to the NFS server IP) / `REDIS_PORT` into the container, but `Forgejo_Common` does not set any `GITEA__cache__*` / `GITEA__session__*` config to consume them — see the caution in [Section 1](#1-overview). |
| `redis_host` | `""` | Override to point at Cloud Memorystore or another Redis instance. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` (sensitive) | Redis AUTH password, if required. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | The only engine `db-init.sh` supports — do not change. |
| `db_name` | `forgejo` | Database name, injected as `GITEA__database__NAME`. Immutable after first deploy. |
| `db_user` | `forgejo` | Database user, injected as `GITEA__database__USER`; password auto-generated in Secret Manager and delivered via `GITEA__database__PASSWD__FILE`. |
| `enable_postgres_extensions` | `true` | `postgres_extensions` defaults to `["uuid-ossp"]`. Forgejo's own schema does not require any Postgres extension; this is a foundation-level convenience default. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisions a Gateway with a static IP; falls back to an auto-generated `nip.io` hostname when `application_domains` is empty. |
| `application_domains` | `[]` | Custom hostnames + managed certificate. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

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
| `service_url` | URL to reach Forgejo. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (`127.0.0.1` via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (the generic, unused `data`-suffixed bucket by default). |
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
| `database_type` | `POSTGRES_15` | Critical | `db-init.sh` is `psql`-only; MySQL/`NONE` breaks database setup even though the variable metadata lists them. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all repositories, issues, and PRs stored against the old role. |
| `SECRET_KEY` / `INTERNAL_TOKEN` (auto-generated) | Never change | Critical | Rotating these invalidates 2FA/OAuth-encrypted data and Forgejo's own internal API auth, breaking Git and API operations. |
| `enable_nfs` | `true` | Critical | Disabling it makes repositories, LFS objects, and attachments ephemeral — lost on pod recreation. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar on `127.0.0.1:5432` is required for DB connectivity on GKE; the entrypoint's SSL-mode selection assumes it. |
| `public_domain` / `public_url` | Real external hostname | High | Defaults to `localhost` / `http://localhost/`, producing wrong Git clone URLs and broken links until overridden. |
| `GITEA__service__DISABLE_REGISTRATION` (via `environment_variables`) | `true` for non-public instances | High | Self-registration is open by default and no admin account is auto-created — anyone reaching the service can sign up. |
| Initial admin account | Create manually post-deploy | High | No init job bootstraps an admin; until one is created via the Forgejo CLI, the instance has no privileged user. |
| `enable_redis` | `true`, but confirm it is actually needed | Medium | `REDIS_HOST`/`REDIS_PORT` are injected with no effect unless you also add the matching `GITEA__cache__*`/`GITEA__session__*` config — provisioning Redis capacity for no benefit otherwise. |
| `max_instance_count` | `3` (default) | Medium | Concurrent replicas share the same NFS-backed Git data directory and Postgres DB; multi-replica correctness for concurrent writes is not documented here — treat scaling like any shared-filesystem workload. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `storage_buckets` | Leave as-is or set `create_cloud_storage = false` | Low | The default `data`-suffixed bucket is provisioned but unused by Forgejo (all app data lives on NFS) — minor unnecessary cost if left enabled needlessly. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and `public_domain`/`public_url`. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Forgejo-specific application configuration shared with the Cloud Run variant is
described in **[Forgejo_Common](Forgejo_Common.md)**.
