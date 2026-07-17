---
title: "Keycloak on Google Cloud Run"
description: "Configuration reference for deploying Keycloak on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Keycloak on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Keycloak_CloudRun.png" alt="Keycloak on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Keycloak is an open-source identity and access management platform (a CNCF project) providing single sign-on (SSO), OAuth 2.0/OIDC, SAML 2.0, social login, user federation (LDAP/Active Directory), and fine-grained authorization — a self-hosted alternative to Auth0/Okta with no per-user fees. This module deploys Keycloak on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Keycloak uses and how to explore and operate them from the Google Cloud Console and the command line. For the mechanics common to every Cloud Run application — service identity, ingress and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Keycloak runs as a JVM (Quarkus) container on Cloud Run v2, built in **production (optimized) mode** via Cloud Build. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | JVM service, 2 vCPU / 2 GiB by default, request-based autoscaling, gen2 |
| Database | Cloud SQL for PostgreSQL 15 | Required — Keycloak stores realms, clients, users, and sessions here |
| Container build | Cloud Build + Artifact Registry | Custom image: `kc.sh build` bakes the Postgres vendor, then `start --optimized` |
| Secrets | Secret Manager | Bootstrap admin password and database password managed automatically |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL, optional external HTTPS load balancer + custom domain |
| Observability | Cloud Logging & Monitoring | Container logs, metrics, optional uptime check on `/` |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** `database_type = "POSTGRES_15"` is fixed by `Keycloak_Common`; MySQL is not supported.
- **The database connection is TCP over the private VPC, not the Cloud SQL socket.** `enable_cloudsql_volume` defaults to `false` because Keycloak's bundled PostgreSQL **JDBC driver cannot use Unix sockets** — the entrypoint assembles `KC_DB_URL = jdbc:postgresql://<private-ip>:5432/<db>` at runtime, and falls back from a socket path to `DB_IP` automatically if a socket is ever mounted.
- **A `db-init` job runs on every apply** (`postgres:15-alpine`) to idempotently create the Keycloak database and role.
- **The bootstrap admin credential is generated automatically.** Username `admin` (`KC_BOOTSTRAP_ADMIN_USERNAME`), password random and stored in Secret Manager, injected as `KC_BOOTSTRAP_ADMIN_PASSWORD`.
- **Health lives on management port 9000, not 8080.** Keycloak 25+ serves `/health`, `/health/ready`, and `/metrics` on a separate management port the platform does not probe — the **startup probe is therefore TCP on 8080**; the liveness probe targets HTTP `/`.
- **Scale-to-zero by default** (`min_instance_count = 0`). JVM cold starts take 60–120 seconds — set `1` for a production IdP.
- **Redis, NFS, and GCS buckets are not used** — all Keycloak state is in PostgreSQL.
- The **database password** is generated automatically and stored in Secret Manager.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Keycloak service

Keycloak runs as a Cloud Run v2 service that autoscales by request load between the minimum and maximum instance counts. Each deployment creates an immutable revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Keycloak stores all application data (realms, clients, users, sessions, and configuration) in a managed Cloud SQL for PostgreSQL 15 instance. The service connects over **TCP to the instance's private IP** through the VPC (no public IP) — the Cloud SQL Auth Proxy socket is intentionally not used because JDBC cannot connect through Unix sockets. On first deploy a `db-init` Job creates the application database and role.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs). See [App_CloudRun](App_CloudRun.md) for the connection model, backups, and password rotation.

### C. Cloud Build & Artifact Registry — the optimized image

The module builds a **custom image** (`container_image_source = "custom"`): a multi-stage Dockerfile runs `kc.sh build` against the official `quay.io/keycloak/keycloak` image to bake in the PostgreSQL vendor and health/metrics features, then overlays a platform entrypoint and starts with `kc.sh start --optimized` — Keycloak does not re-run its slow build step on every boot.

- **Console:** Cloud Build → History; Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts repositories list --project "$PROJECT"
  ```

### D. Secret Manager

Two secrets protect the deployment: the **bootstrap admin password** (created by `Keycloak_Common`, injected as `KC_BOOTSTRAP_ADMIN_PASSWORD`) and the **database password** (created by the foundation). Both are injected at runtime; plaintext never appears in configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~keycloak"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and VPC egress control connectivity. Note that Keycloak validates its public hostname — the entrypoint auto-detects the `run.app` URL as `KC_HOSTNAME`, so if you front Keycloak with a load balancer or custom domain, set `KC_HOSTNAME` explicitly via `environment_variables`.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud Monitoring, with optional uptime checks and alert policies. The entrypoint prints a configuration summary (`KC_DB_URL`, `KC_HOSTNAME`, proxy settings) at every start — the first place to look when diagnosing connectivity.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Keycloak Application Behaviour

- **First-deploy database setup.** A `db-init` Job (`postgres:15-alpine`) idempotently creates the Keycloak role and database, grants privileges, and grants `ALL ON SCHEMA public` (required for PostgreSQL 15+). It runs on every apply with up to 3 retries and is safe to re-run.
- **Schema migrations on boot.** Keycloak creates and migrates its schema automatically on first start against the empty database. Migrations are one-way — **never downgrade `application_version`**.
- **Runtime env mapping.** The custom entrypoint maps the foundation-injected `DB_HOST`/`DB_IP`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` onto Keycloak's `KC_DB_URL`, `KC_DB_USERNAME`, and `KC_DB_PASSWORD`. If `DB_HOST` is a Cloud SQL socket directory (starts with `/`), it falls back to `DB_IP` because JDBC cannot use Unix sockets. Explicitly set `KC_DB_*` variables always take precedence.
- **Hostname auto-detection.** The entrypoint queries the Cloud Run metadata/Admin API at startup to discover the public service URL and exports it as `KC_HOSTNAME` (with `KC_HOSTNAME_STRICT=false` behind the TLS-terminating front end). Override `KC_HOSTNAME` via `environment_variables` when using a custom domain.
- **Reverse-proxy aware.** `KC_PROXY_HEADERS=xforwarded` and `KC_HTTP_ENABLED=true` are injected so Keycloak trusts the `X-Forwarded-*` headers set by Cloud Run's TLS-terminating front end.
- **Bootstrap admin.** On first boot Keycloak creates a **temporary** bootstrap admin (`admin` / Secret Manager password). Log in at `<url>/admin`, create a permanent administrator, then remove or rotate the bootstrap user.
- **Health gotcha — port 9000.** `/health`, `/health/ready`, `/health/live`, and `/metrics` are served on the **management port 9000**, which Cloud Run does not expose. Probing `8080/health` would always 404 — this is why the startup probe is TCP on 8080.
- **Verification.** The OIDC discovery document is public and confirms end-to-end health:
  ```bash
  curl -s "$SERVICE_URL/realms/master/.well-known/openid-configuration" | head -c 300
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific to or notable for Keycloak are listed; every other input is inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted access and monitoring alerts. |

All other inputs follow standard App_CloudRun behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `keycloak` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Keycloak SSO` | Friendly name shown in the Console. |
| `application_version` | `26.0` | Keycloak image tag. **Never downgrade** — schema migrations are irreversible. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `custom` | `custom` builds the optimized image via Cloud Build — required; the upstream image lacks the entrypoint that maps DB credentials and detects the hostname. |
| `cpu_limit` | `2000m` | Keycloak (JVM) needs at least 1 vCPU; 2 vCPU recommended. |
| `memory_limit` | `2Gi` | JVM heap needs at least 1 GiB; 2 GiB recommended. |
| `container_port` | `8080` | Keycloak HTTP listener. Health/metrics are on the separate management port 9000. |
| `min_instance_count` | `0` | Scale-to-zero. JVM cold starts take 60–120 s — set `1` for a production IdP. |
| `max_instance_count` | `3` | Cost ceiling. |
| `enable_cloudsql_volume` | `false` | **Keep `false`.** JDBC cannot use the Cloud SQL Unix socket; Keycloak connects over private-IP TCP. |
| `execution_environment` | `gen2` | Recommended for faster startup. |
| `enable_image_mirroring` | `true` | Mirror the base image into Artifact Registry. |

All other inputs follow standard App_CloudRun behaviour.

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Keycloak is an internet-facing IdP by default; use `internal-and-cloud-load-balancing` behind an LB. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Required so Keycloak can reach the Cloud SQL private IP over the VPC. |
| `enable_iap` | `false` | IAP in front of an OIDC/SAML IdP breaks the browser redirect flows — leave off unless the console is internal-only. |

All other inputs follow standard App_CloudRun behaviour.

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra `KC_*` settings (e.g. `KC_LOG_LEVEL`, `KC_FEATURES`, or an explicit `KC_HOSTNAME`). `KC_DB`, `KC_PROXY_HEADERS`, `KC_HTTP_ENABLED`, `KC_HEALTH_ENABLED`, `KC_METRICS_ENABLED`, and `KC_BOOTSTRAP_ADMIN_USERNAME` are injected automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g. truststore passwords). |

All other inputs follow standard App_CloudRun behaviour.

### Group 7 — Backup & Restore

Standard App_CloudRun backup behaviour (`backup_schedule` `0 2 * * *`, `backup_retention_days` `7`, optional `enable_backup_import`). All state is in PostgreSQL, so database backups capture the entire Keycloak configuration.

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see [App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Group 9 — Custom SQL

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See [App_CloudRun](App_CloudRun.md).

### Group 10 — Domain, CDN, Cloud Armor & Image Retention

| Variable | Default | Description |
|---|---|---|
| `application_domains` | `[]` | Custom hostnames for the external LB. **Set `KC_HOSTNAME` to match** — Keycloak issues tokens and redirects for its configured hostname. |
| `enable_cloud_armor` | `false` | WAF in front of the IdP — recommended for internet-facing production logins. |

All other inputs follow standard App_CloudRun behaviour.

### Group 11 — Storage & Filesystem

Keycloak needs no object or file storage — `storage_buckets` and `gcs_volumes` default to `[]` and `enable_nfs` to `false`. All state is in PostgreSQL. All inputs follow standard App_CloudRun behaviour.

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Keycloak requires PostgreSQL — do not change. |
| `db_name` | `keycloak` | Database name (tenant-prefixed at deploy time). Immutable after first deploy. |
| `db_user` | `keycloak` | Application role (tenant-prefixed at deploy time). Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |

All other inputs follow standard App_CloudRun behaviour.

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (`postgres:15-alpine`, 3 retries). |
| `cron_jobs` | `[]` | Recurring jobs triggered by Cloud Scheduler. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | **TCP on 8080**, 30 s initial delay, 30 failures (~330 s budget) | TCP because `/health` lives on the unexposed management port 9000. Generous budget for JVM startup + first-boot migrations. |
| `liveness_probe` | HTTP `/`, 60 s initial delay | Keycloak's root path answers on 8080 once started. |
| `uptime_check_config` | disabled, path `/` | Enable for production; Keycloak serves a public landing page at `/`. |

All other inputs follow standard App_CloudRun behaviour.

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Keycloak does not use Redis — leave `false`. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter — worthwhile for an IdP holding credentials. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs follow standard App_CloudRun behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (sensitive) / port. |
| `storage_buckets` | Created Cloud Storage buckets (empty — Keycloak uses none). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of the setup jobs (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Keycloak requires PostgreSQL; any other engine breaks startup. |
| `enable_cloudsql_volume` | `false` | Critical | JDBC cannot use the Cloud SQL Unix socket. With a socket-only connection and no `DB_IP` fallback, Keycloak cannot reach PostgreSQL. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/role and destroys all realms and users. |
| `application_version` | never downgrade | Critical | Keycloak schema migrations are one-way; a downgrade corrupts or refuses the schema. |
| `container_image_source` | `custom` | High | The upstream image lacks the entrypoint that maps DB credentials, assembles the JDBC URL, and detects `KC_HOSTNAME` — and it is not pre-built for `start --optimized`. |
| `startup_probe` | TCP on 8080, ≥30 failures | High | An HTTP probe on `8080/health` always 404s (health is on port 9000); the revision never becomes ready even though Keycloak booted fine. |
| Bootstrap admin | replace after first login | High | `admin` + the Secret Manager password is a **temporary** bootstrap credential; leaving it as the only admin is a standing risk. |
| `KC_HOSTNAME` (via `environment_variables`) | explicit when using a custom domain / LB | High | Auto-detection pins the `run.app` URL; OIDC redirects and issuer URLs then mismatch the domain users actually visit. |
| `memory_limit` | `2Gi` | High | JVM OOM below ~1 GiB, especially during first-boot migrations. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` (or `ALL_TRAFFIC`) | High | Without VPC egress the service cannot reach the Cloud SQL private IP. |
| `min_instance_count` | `1` for production | Medium | `0` adds a 60–120 s JVM cold start to the first SSO redirect after idle — very visible in login flows. |
| `enable_cloud_armor` | on for internet-facing logins | Medium | The login and admin endpoints are otherwise unshielded against volumetric/credential-stuffing traffic. |
| `enable_redis` | `false` | Low | Keycloak does not use Redis; enabling it only injects unused env vars. |

---

For the foundation behaviour referenced throughout — service identity, scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. Keycloak-specific application configuration shared with the GKE variant is described in **[Keycloak_Common](Keycloak_Common.md)**.
