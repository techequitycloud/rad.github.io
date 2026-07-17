---
title: "Authentik on Google Cloud Run"
description: "Configuration reference for deploying Authentik on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Authentik on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Authentik_CloudRun.png" alt="Authentik on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

authentik ([goauthentik.io](https://goauthentik.io/)) is an open-source (MIT,
open-core) identity provider: single sign-on via OIDC and SAML, LDAP and SCIM,
multi-factor authentication, and proxy authentication — a self-hosted alternative
to Okta, Auth0, and Keycloak. This module deploys authentik on **Cloud Run v2** on
top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages
the shared Google Cloud infrastructure.

This guide focuses on the cloud services authentik uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every Cloud Run application — service identity, ingress and load
balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

authentik runs as a Python/Django container on Cloud Run v2, with its background
worker (`ak worker`) co-located in the same container. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Server + co-located worker, 2 vCPU / 2 GiB by default, always-on CPU, min 1 instance |
| Database | Cloud SQL for PostgreSQL 15 | Required — authentik needs PostgreSQL ≥ 14; MySQL is blocked |
| Cache & queue | **None — no Redis** | authentik ≥ 2025.10 moved cache, sessions, task queue, and the WebSocket channel layer into PostgreSQL |
| Media storage | Cloud Storage (GCS Fuse) | Bucket mounted at `/media` for uploaded icons and flow backgrounds |
| Secrets | Secret Manager | Stable `AUTHENTIK_SECRET_KEY`, `akadmin` bootstrap password, database password |
| Image | Artifact Registry + Cloud Build | Thin custom build `FROM ghcr.io/goauthentik/server` (cloud entrypoint + worker launcher) |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS LB + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory and is the *only* datastore.** No Redis, no search
  backend — sessions, cache, and the task queue all live in Cloud SQL.
- **The worker is co-located.** The container entrypoint starts `ak worker` in the
  background next to the server (the same pattern as Chatwoot's Sidekiq worker).
  This is why `cpu_always_allocated = true` and `min_instance_count = 1` are the
  defaults: scheduled tasks, outpost sync, and the Postgres-backed queue must keep
  processing between requests, outposts hold a WebSocket to the server, and login
  latency matters for an IdP. The variable documents the lab/demo flip-back
  (`false` + `min_instance_count = 0`).
- **`max_instance_count = 5`.** authentik is stateless across instances — all
  state is in PostgreSQL — so multiple instances (each with its own worker) are
  safe.
- **`AUTHENTIK_SECRET_KEY` is generated automatically** and stored in Secret
  Manager. It must remain stable for the deployment's life — rotating it
  invalidates all sessions and makes encrypted fields unreadable.
- **The `akadmin` admin account is bootstrapped on first boot** with
  `bootstrap_email` (default `admin@techequity.cloud`) and a Secret Manager-backed
  password. Bootstrap variables apply on the **first** boot only.
- **`application_version = "latest"` is pinned.** authentik publishes no `latest`
  tag on GHCR; the build pins `latest` to a known-good release (`2026.5.4`) via
  the app-specific `AUTHENTIK_VERSION` build ARG.
- **Migrations run automatically at startup** (advisory-lock guarded), so version
  upgrades need no separate migration job — the startup probe's generous
  threshold covers the first-boot migration suite.
- **Health endpoints are unauthenticated**: startup `GET /-/health/ready/`,
  liveness `GET /-/health/live/`.
- **LDAP/RADIUS outposts are out of scope on Cloud Run** (non-HTTP long-running
  listeners). Browser SSO (OIDC/SAML) and the embedded outpost work normally.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the authentik service

authentik runs as a Cloud Run v2 service with instance-based billing (always-on
CPU) so the co-located worker keeps processing between requests. Each deployment
creates an immutable revision.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

authentik stores *everything* here — users, groups, flows, providers, sessions,
cache, and the background task queue. The service connects privately through the
**Cloud SQL Auth Proxy** over a Unix socket; the container entrypoint maps the
injected `DB_*` variables onto authentik's `AUTHENTIK_POSTGRESQL__*` convention
and sets the SSL mode by connection type. On first deploy a single `db-init` job
creates the tenant-scoped database and role.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs) (database and user names are tenant-prefixed). See
[App_CloudRun](App_CloudRun.md) for the connection model, backups, and password
rotation.

### C. Cloud Storage — media

A dedicated bucket is mounted at `/media` via GCS Fuse for uploaded media
(application icons, flow backgrounds). Uploads survive instance replacement and
scaling.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/        # bucket name is in the Outputs
  ```

### D. Secret Manager

Two authentik secrets are generated automatically:

- `AUTHENTIK_SECRET_KEY` — signs sessions/cookies and derives internal
  encryption. **Never rotate it.**
- `AUTHENTIK_BOOTSTRAP_PASSWORD` — the initial `akadmin` password, applied on
  first boot only.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~authentik"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [Authentik_Common](Authentik_Common.md) for the full secret model.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load
balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on. For
an IdP a stable, TLS-fronted hostname matters — the OIDC/SAML redirect URIs you
register in client applications must match the URL users reach authentik on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

### F. Cloud Logging & Monitoring

Server **and worker** logs both flow to Cloud Logging (they share the container's
stdout/stderr). Cloud Run and Cloud SQL metrics flow to Cloud Monitoring.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. authentik Application Behaviour

- **First-deploy database setup.** A single initialization job runs `db-init.sh`
  using `postgres:15-alpine`: it waits for PostgreSQL, creates the tenant-scoped
  role and database, grants privileges, and defensively grants
  `cloudsqlsuperuser` (so any future `CREATE EXTENSION` in upstream migrations
  succeeds). The job is idempotent and safe to re-run.
- **Self-migrating startup.** authentik's server runs its own Django migrations on
  every startup, guarded by a PostgreSQL advisory lock. There is no separate
  migrate job. The first boot runs the full suite — expect several minutes before
  `/-/health/ready/` returns 200; the startup probe allows ~11 minutes.
- **First login.** Sign in as **`akadmin`** using the `bootstrap_email` value and
  the password in the `...-bootstrap-password` secret. If the bootstrap variables
  were absent on the first boot, complete setup at
  `<service-url>/if/flow/initial-setup/` instead.
- **Applications and providers are configured in-app after deploy.** OIDC/SAML
  providers, applications, outposts, and flows are authentik configuration, not
  Terraform inputs — create them in the Admin interface (`<service-url>/if/admin/`)
  once the service is up.
- **Worker co-location.** `ak worker` runs in the same container; its log lines
  are interleaved with the server's in Cloud Logging. It requires the always-on
  CPU default — flipping to request-based billing throttles the worker between
  requests.
- **Health endpoints.**
  ```bash
  curl -s "$SERVICE_URL/-/health/ready/" -o /dev/null -w '%{http_code}\n'   # 200 = migrated + DB reachable
  curl -s "$SERVICE_URL/-/health/live/"  -o /dev/null -w '%{http_code}\n'   # 200 = process alive
  ```
- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for authentik are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |
| `bootstrap_email` | `admin@techequity.cloud` | Email of the built-in `akadmin` account, set on first boot. |
| `bootstrap_password` | `""` (auto-generated) | Initial `akadmin` password. **First boot only**; stored in Secret Manager. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `authentik` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | authentik version tag; `latest` is pinned to `2026.5.4` at build time (no upstream `latest` tag). Pin explicitly in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Thin wrapper image built via Cloud Build (adds the cloud entrypoint + worker launcher). |
| `cpu_limit` | `2000m` | CPU per instance — shared by server and worker. |
| `memory_limit` | `2Gi` | Memory per instance — 2 GiB is the reliable floor for server + worker. |
| `cpu_always_allocated` | `true` | **Keep true.** The co-located worker and outpost WebSockets do work between requests. Flip to `false` + `min_instance_count = 0` only for lab/demo cost-first cold-start. |
| `min_instance_count` | `1` | Keeps the worker running and outpost WebSockets connected. |
| `max_instance_count` | `5` | Safe to raise — authentik is stateless across instances. |
| `container_port` | `9000` | authentik's HTTP port. |
| `enable_cloudsql_volume` | `true` | Auth Proxy Unix socket — the entrypoint sets `SSLMODE=disable` for the Auth Proxy (socket directory or loopback TCP; the proxy doesn't speak SSL itself), `require` only for direct TCP to any other host. |
| `timeout_seconds` | `300` | Maximum request duration. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | authentik is a user-facing IdP; browsers and OAuth redirects must reach it. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | IAP in front of an IdP double-gates every login and blocks OIDC callbacks from non-Google identities — leave off unless you know you need it. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra `AUTHENTIK_*` settings (e.g. email/SMTP: `AUTHENTIK_EMAIL__HOST`, …). Do not set `AUTHENTIK_SECRET_KEY` or `AUTHENTIK_POSTGRESQL__*` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 10 — Load Balancer, CDN & Custom Domain

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Global HTTPS LB + Cloud Armor WAF — recommended for a public IdP. |
| `application_domains` | `[]` | Custom hostname(s). Register OIDC redirect URIs against the domain users actually reach. |
| `enable_cdn` | `false` | CDN adds little for an IdP (dynamic, authenticated traffic). |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | The `/media` bucket is declared by `Authentik_Common`. |
| `enable_nfs` | `true` | Optional; authentik keeps media on GCS, not NFS. |
| `gcs_volumes` | `[]` | Extra GCS Fuse mounts; `/media` is added automatically. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | authentik requires PostgreSQL — MySQL values are rejected by validation. |
| `db_name` | `authentik` | Database base name (tenant-prefixed at deploy). Immutable after first deploy. |
| `db_user` | `authentik` | Application DB user base name (tenant-prefixed). |
| `database_password_length` | `32` | Generated password length (16–64). |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in single `db-init` job. |
| `cron_jobs` | `[]` | Not needed — the co-located worker runs authentik's scheduled tasks. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/-/health/ready/`, 60s delay, 40×15s | Unauthenticated. Generous threshold for first-boot migrations (~11 min budget). |
| `liveness_probe` | HTTP `/-/health/live/`, 60s delay, 3×30s | Unauthenticated process-alive check. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check (point it at `/-/health/live/`). |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | **Inert.** authentik ≥ 2025.10 removed Redis entirely; `main.tf` pins `enable_redis = false`. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service names (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user (tenant-prefixed). |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets (includes the `/media` bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` / `github_repository_*` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `AUTHENTIK_SECRET_KEY` (auto-generated) | Never rotate | Critical | Rotating it invalidates **all** active sessions and makes encrypted fields (stored credentials, tokens) unreadable. |
| `database_type` | `POSTGRES_15` | Critical | MySQL is blocked by validation — authentik requires PostgreSQL ≥ 14. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all identity data. |
| Worker listen ports (entrypoint-managed) | Leave the entrypoint's `AUTHENTIK_LISTEN__*` loopback defaults | Critical | The co-located `ak worker` also starts an HTTP listener and inherits the server's default `0.0.0.0:9000`; if it wins the bind race it answers **every** route — health endpoints included — with empty 200s: a blank UI with phantom-healthy probes. The entrypoint pins the worker to loopback ports (`127.0.0.1:9001`/`9444`/`9301`) so the server owns `:9000` — a 200 with an empty body means the wrong process answered. |
| `min_instance_count` | `1` (with always-on CPU) | High | `0` lets the instance scale away: outpost WebSockets disconnect, and background tasks (scheduled jobs, outpost sync) are delayed until the next request wakes an instance. |
| `cpu_always_allocated` | `true` | High | Request-based billing throttles the co-located worker between requests — the task queue stalls even at `min=1`. |
| `startup_probe.path` | `/-/health/ready/` (unauthenticated) | Medium | Pointing the probe at an authenticated page returns 401/403 to the prober — the revision never becomes ready even though authentik booted fine. |
| `bootstrap_password` / `bootstrap_email` | Set before first deploy | Medium | Applied on the **first** boot only. Changing them later has no effect — manage `akadmin` in-app, or use `/if/flow/initial-setup/` if bootstrap vars were absent on first boot. |
| `application_version` | Pin a release | Medium | `latest` is silently pinned to `2026.5.4`; an explicit pin makes upgrades deliberate. Nonexistent tags fail the Cloud Build with `MANIFEST_UNKNOWN`. |
| `memory_limit` | `2Gi` | Medium | Server + worker share the limit; lower values risk OOM during migrations or flow imports. |
| `environment_variables` → `AUTHENTIK_POSTGRESQL__*` | Leave unset | Medium | The entrypoint maps the injected `DB_*` values; hardcoding short DB names authenticates as a non-existent role (names are tenant-prefixed). |
| LDAP/RADIUS outposts | Not on Cloud Run | Low | Non-HTTP listeners can't be served by Cloud Run — use the GKE variant or an external host for those outposts. |
| `enable_iap` | `false` | Medium | IAP double-gates every login and breaks OAuth/SAML callbacks from external parties. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. authentik-specific application configuration
shared with the GKE variant is described in
**[Authentik_Common](Authentik_Common.md)**.
