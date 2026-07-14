---
title: "Keycloak on GKE Autopilot"
description: "Configuration reference for deploying Keycloak on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Keycloak on GKE Autopilot

Keycloak is an open-source identity and access management platform providing
single sign-on (SSO), OAuth 2.0/OIDC, SAML 2.0, social login, user federation
(LDAP/Active Directory), and fine-grained authorization — a self-hosted
alternative to Auth0/Okta with no per-user fees. This module deploys Keycloak
on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which
provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Keycloak uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Keycloak runs as a single JVM (Quarkus-based) web workload built in
production-optimized mode. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | JVM pod on port 8080, 2 vCPU / 4Gi memory by default |
| Database | Cloud SQL for PostgreSQL 15 | Required — the engine is fixed at `POSTGRES_15`; MySQL is not supported |
| Database connectivity | Cloud SQL Auth Proxy sidecar | Listens on `127.0.0.1:5432`; `KC_DB_URL` is a plain JDBC TCP connection — no Unix-socket issue on GKE |
| Secrets | Secret Manager | Auto-generated `KC_BOOTSTRAP_ADMIN_PASSWORD` (temporary admin) and database password |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; optional custom domain + managed certificate |
| Image build | Cloud Build + Artifact Registry | A custom multi-stage image runs `kc.sh build` at build time, `kc.sh start --optimized` at boot |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** `database_type` defaults to `POSTGRES_15`
  and is fixed by the shared application layer; MySQL/SQL Server are not
  supported for Keycloak.
- **Cloud SQL is reached via the Auth Proxy sidecar on loopback.** GKE sets
  `enable_cloudsql_volume = true` by default (unlike the CloudRun variant,
  which defaults it to `false` because Cloud Run's Cloud SQL integration is a
  Unix-socket mount the JDBC driver can't use). On GKE the sidecar exposes a
  real TCP listener on `127.0.0.1:5432`, so `KC_DB_URL` is a plain
  `jdbc:postgresql://127.0.0.1:5432/<db>` — no socket workaround needed.
- **`KC_DB_USERNAME` is never hardcoded.** The foundation tenant-prefixes the
  real Postgres role (e.g. `keycloakdemo<hash>`); `entrypoint.sh` maps the
  platform-injected `DB_USER`/`DB_PASSWORD` onto `KC_DB_USERNAME`/
  `KC_DB_PASSWORD` at runtime only when they are not already set — this
  module does not hit the hardcoded-DB-user pitfall called out for other
  apps in this repository.
- **min/max replica counts are fixed by this module, not by the
  `min_instance_count`/`max_instance_count` inputs.** `Keycloak_GKE`'s
  `main.tf` hardcodes the per-app scaling config to `min_instance_count = 1`,
  `max_instance_count = 5` when it builds the application config map that
  `App_GKE` actually reads for scaling — the top-level
  `min_instance_count`/`max_instance_count` variables are passed to the
  foundation too, but are shadowed by the app-scoped values. See
  [§6](#6-configuration-pitfalls--sensible-defaults).
- **NFS and Redis are not used.** `enable_nfs` and `enable_redis` both default
  to `false` — Keycloak keeps all state (realms, clients, users, sessions) in
  PostgreSQL, and `Keycloak_Common` provisions no Cloud Storage bucket
  (`storage_buckets = []`).
- **`KC_BOOTSTRAP_ADMIN_PASSWORD` is generated automatically** and stored in
  Secret Manager, paired with `KC_BOOTSTRAP_ADMIN_USERNAME` (default
  `admin`). It is explicitly a **temporary** bootstrap credential — log in,
  create a permanent administrator, then rotate or disable the bootstrap
  account.
- **Session affinity is `ClientIP`** so a client's requests reach the same
  pod.
- **Health/metrics are on a separate management port (9000), not the HTTP
  port (8080).** All probes are TCP checks against port 8080 (the HTTP
  listener accepting connections) rather than HTTP checks against `/health`,
  which lives on 9000 and would always fail a probe aimed at 8080.
- **`KC_HOSTNAME` is auto-detected at runtime.** `entrypoint.sh` queries the
  GCP metadata server / Cloud Run Admin API first and falls back to the
  `SERVICE_URL` injected by `App_GKE`; override it via
  `environment_variables` for a pinned public URL.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Keycloak workload

Keycloak pods are scheduled on Autopilot, which bills for the CPU/memory the
pods actually request. Keycloak is stateless (`workload_type` defaults to
`Deployment`, not `StatefulSet`) since all durable state lives in PostgreSQL.

- **Console:** Kubernetes Engine → Workloads → select the Keycloak workload
  for pods, revisions, and events. Kubernetes Engine → Services & Ingress
  shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Keycloak stores all application data (realms, clients, users, groups,
sessions) in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it
through the **Cloud SQL Auth Proxy** sidecar on `127.0.0.1:5432`; no public
IP is exposed. On first deploy the `db-init` Job idempotently creates the
application role and database, grants ownership, and grants privileges on
`SCHEMA public` (required on PostgreSQL 15+, where `public` is no longer
world-writable) — Keycloak itself then creates and migrates its schema on
first boot.

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

Keycloak's only application-level secret is the **bootstrap admin password**
(`KC_BOOTSTRAP_ADMIN_PASSWORD`, a 20-character random value paired with
username `admin` via `KC_BOOTSTRAP_ADMIN_USERNAME`). The database password is
generated separately by the foundation and is injected directly as
`KC_DB_PASSWORD` (via `db_password_env_var_name = "KC_DB_PASSWORD"` on the
`App_GKE` call), in addition to the standard `DB_PASSWORD`. On GKE, secrets
are projected into pods via the Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~keycloak"
  gcloud secrets versions access latest \
    --secret="$(gcloud secrets list --project "$PROJECT" \
      --filter='name~keycloak-admin-password' --format='value(name)' --limit=1)" \
    --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### D. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing
IP (`service_type = LoadBalancer`, `reserve_static_ip = true` so the address
survives redeploys). A custom domain with a Google-managed certificate can be
enabled via `enable_custom_domain` + `application_domains`.

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
Cloud Monitoring. Optional uptime checks and alert policies are available —
Keycloak serves a public landing page at `/`, which is what
`uptime_check_config` targets.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Keycloak Application Behaviour

- **First-deploy database setup.** The `db-init` Job runs `db-init.sh` using
  `postgres:15-alpine`. It waits for `pg_isready`, then idempotently creates
  the application role (or updates its password), grants that role to
  `postgres` so the superuser can manage its objects, creates/owns the
  database, and grants privileges on the database and on `SCHEMA public`. It
  finishes by sending a `POST /quitquitquit` to the Cloud SQL Proxy sidecar
  on `127.0.0.1:9091` so the Job pod can terminate and be marked Succeeded on
  GKE. The job is safe to re-run (`execute_on_apply = true`, `max_retries =
  3`).
- **No separate migration job — Keycloak migrates its own schema on first
  boot.** The custom image runs `kc.sh build` at build time (baking in
  `KC_DB=postgres`, health, and metrics) and `kc.sh start --optimized` at
  container start; Keycloak's own bootstrap process creates/migrates the
  schema against the empty database created by `db-init`.
  <!-- TODO: verify exact first-boot schema-creation duration under load; the
  startup probe budget below allows up to ~330s. -->
- **Bootstrap admin account.** `entrypoint.sh` execs `kc.sh start --optimized`
  with `KC_BOOTSTRAP_ADMIN_USERNAME=admin` and the generated
  `KC_BOOTSTRAP_ADMIN_PASSWORD` secret. Log in at `<service-url>/admin`,
  create a permanent administrator, then rotate or disable the bootstrap
  account — it is meant to be temporary.
- **DB env-var mapping happens at runtime, never baked in.** The platform
  injects `DB_HOST=127.0.0.1` (the Auth Proxy sidecar), `DB_USER`,
  `DB_PASSWORD`, `DB_NAME`, `DB_PORT`; `entrypoint.sh` maps these onto
  `KC_DB_URL`/`KC_DB_USERNAME`/`KC_DB_PASSWORD` only when the `KC_DB_*`
  variable is not already explicitly set, so operators can still override any
  of them via `environment_variables`.
- **Health path — TCP only, port 8080.** Keycloak 25+ serves `/health`,
  `/health/ready`, `/health/live`, and `/metrics` on the **separate
  management port 9000**, not on the HTTP port 8080 the platform probes. An
  HTTP probe against `8080/health` would always 404. Both the startup probe
  (30s initial delay, 30 failures ≈ up to ~330s total for JVM start + schema
  migration) and the liveness probe (60s initial delay, 3 failures) are
  **TCP** checks against port 8080.
- **Horizontal scaling / clustering caveat.** `Keycloak_GKE`'s wiring comment
  states Keycloak "persists all state in PostgreSQL, so horizontal scaling is
  safe (cluster nodes form a shared cache via the default infinispan)".
  <!-- TODO: verify — `KC_CACHE` is not explicitly set to `ha`/kubernetes-ping
  anywhere in Keycloak_Common's environment or the custom build args, and
  Keycloak's default Infinispan cache stack outside an explicit HA/Kubernetes
  configuration is local (per-pod), which would NOT replicate session/login
  state across replicas. Confirm the actual cache stack in the deployed
  image before relying on `max_instance_count > 1` for session continuity in
  production. -->
- **Verify the running configuration:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E '^KC_'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Keycloak are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `keycloak` | Base name for resources. Do not change after first deploy. |
| `application_version` | `26.0` | Keycloak image tag baked into the custom `kc.sh build`. Never downgrade — schema migrations are one-way. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | The **authoritative** CPU/memory sizing — it is merged into the app config *after* `Keycloak_Common`'s own `cpu_limit`/`memory_limit`, so it always wins. Keycloak's JVM needs at least 2Gi. |
| `cpu_limit` / `memory_limit` | `2000m` / `4Gi` | Legacy top-level sizing inputs, forwarded into `Keycloak_Common` — **shadowed by `container_resources`** (see [§6](#6-configuration-pitfalls--sensible-defaults)) since `container_resources` always has a non-null default. |
| `min_instance_count` / `max_instance_count` | `1` / `5` | Forwarded to the Foundation directly, but **the effective replica bounds are hardcoded to 1/5 in this module's `main.tf`**, independent of these values — see [§6](#6-configuration-pitfalls--sensible-defaults). |
| `container_port` | `8080` | Keycloak's HTTP listener. Health/metrics are on the separate management port 9000 — the platform probes this port over TCP, not HTTP. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar (loopback TCP) — required on GKE for JDBC connectivity. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Path inside the container where the Auth Proxy Unix socket directory is mounted (used by the `db-init` job's `pg_isready`/`psql` calls; the running Keycloak container itself connects over `127.0.0.1:5432`, not this path). |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the Keycloak admin/login UI. |
| `workload_type` | `null` → `Deployment` | Keycloak is stateless; do not switch to `StatefulSet`. |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |
| `termination_grace_period_seconds` | `60` | Time allowed for in-flight requests to complete before a pod is force-killed. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` / `health_check_config` | TCP, port 8080 | Top-level Foundation probe inputs — **the app-scoped `startup_probe`/`liveness_probe` values below are what `App_GKE` actually reads for this workload's probes.** |
| `startup_probe` | TCP, 30s delay, 30 failures | Forwarded into `Keycloak_Common`; generous failure budget for JVM start + first-boot schema creation. |
| `liveness_probe` | TCP, 60s delay, 3 failures | Forwarded into `Keycloak_Common`. TCP only — `/health` on port 9000 is not reachable from the probe. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Keycloak serves a public landing page at `/`. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Not typically required — Keycloak keeps all state in PostgreSQL. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed engine; MySQL/SQL Server are not supported. |
| `db_name` / `db_user` | `keycloak` / `keycloak` | **The authoritative database name/user** — these flow through `Keycloak_Common`'s `config.db_name`/`config.db_user`, which is what `App_GKE` actually provisions. |
| `application_database_name` / `application_database_user` | `keycloak` / `keycloak` | Forwarded to the Foundation call directly, but **shadowed by `db_name`/`db_user`** inside `App_GKE`'s per-app config resolution — both default to the same value, so this is invisible unless only one pair is changed. See [§6](#6-configuration-pitfalls--sensible-defaults). |
| `enable_postgres_extensions` | `false` | Not required for Keycloak. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `application_domains` | `[]` | Custom hostnames + managed certificate. |

### Group 21 — Cloud Armor, CDN & Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Keycloak does not require Redis; leave `false` unless a custom SPI/plugin needs it. |

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
| `service_url` | URL to reach Keycloak. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (`127.0.0.1` via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (empty — Keycloak stores no state outside PostgreSQL). |
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
> stateless setting, IAP with no authorized identities, `quota_memory_*`
> given as bare integers, an out-of-range `container_port`/
> `backup_retention_days`. Invalid configuration fails the **plan** with a
> clear, named error before any resource is created, so most mistakes below
> are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (fixed) | Critical | Selecting a non-Postgres engine breaks Keycloak's schema bootstrap and every query. |
| `db_name` / `db_user` (the authoritative pair) | Set once, before first deploy | Critical | Effectively immutable — `App_GKE` resolves the real Cloud SQL database/user from these, and changing them after first deploy points Keycloak at a different (empty) database/role, orphaning all realms/users. |
| `application_database_name` / `application_database_user` | Leave matching `db_name`/`db_user` | Medium | These are forwarded to the Foundation but shadowed by `db_name`/`db_user` inside `App_GKE`'s per-app config resolution — changing only this pair silently has no effect on the actual database name, which can mislead an operator into thinking a rename happened. |
| `min_instance_count` / `max_instance_count` | Understand they are informational here | Medium | This module hardcodes the effective replica bounds to `1`/`5` in `main.tf` regardless of these variables' values — setting `max_instance_count = 1` for cost control will **not** actually cap replicas at 1. |
| `cpu_limit` / `memory_limit` | Set `container_resources` instead | Medium | `container_resources` always has a non-null default and is merged in last, so changing only the legacy `cpu_limit`/`memory_limit` variables is silently ignored. |
| `KC_BOOTSTRAP_ADMIN_PASSWORD` (auto-generated) | Retrieve, log in, then rotate/disable | High | The bootstrap admin is meant to be temporary; leaving it active indefinitely is a standing credential risk. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar on `127.0.0.1:5432` is required for DB connectivity on GKE; disabling it with no alternative TCP path breaks every DB call. |
| Probe paths | TCP on port 8080 (default) | High | Keycloak's `/health` lives on management port 9000, not 8080 — an HTTP probe against `8080/health` always 404s and the pod never becomes Ready even though Keycloak booted fine. |
| `max_instance_count > 1` (session clustering) | Verify Infinispan/session replication before relying on it | High | If the deployed image's cache stack is not actually distributed across pods (unconfirmed — see [§3](#3-keycloak-application-behaviour)), users can be bounced to a pod with no knowledge of their session, forcing re-authentication. |
| `session_affinity` | `ClientIP` | Medium | Without stickiness, requests bounce between pods more than necessary while the clustering caveat above is unresolved. |
| `application_version` | Never downgrade | Critical | Keycloak schema migrations are one-way; downgrading after a migration has run can corrupt the schema. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and `KC_HOSTNAME`. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Keycloak-specific application configuration shared
with the Cloud Run variant (the custom image build, entrypoint DB/hostname
mapping, secrets, and probe defaults) is described in
**[Keycloak_Common](Keycloak_Common.md)**.
