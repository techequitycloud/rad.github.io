---
title: "Zitadel on Google Cloud Run"
description: "Configuration reference for deploying Zitadel on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Zitadel on Google Cloud Run

Zitadel is an open-source, cloud-native identity and access management (IAM) platform
providing OpenID Connect, OAuth 2.0, SAML, and user/organization management. This
module deploys Zitadel on **Cloud Run v2** on top of the [App_CloudRun](App_CloudRun.md)
foundation, which provisions and manages the shared Google Cloud infrastructure.

This guide focuses on the cloud services Zitadel uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling and
concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

Zitadel runs as a single Go container on Cloud Run v2. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Go service, 2 vCPU / 4 GiB by default; HTTP/2 (gRPC + REST) on port 8080 |
| Database | Cloud SQL for PostgreSQL 15 | Required — Zitadel only supports PostgreSQL; MySQL is rejected at plan time |
| Object storage | Cloud Storage | One bucket provisioned automatically (operator use; core state lives in Postgres) |
| Cache & queue | None | Zitadel stores all state in PostgreSQL — no Redis, no queue |
| Secrets | Secret Manager | Auto-generated `ZITADEL_MASTERKEY` and initial admin password; database password |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL (public); optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **PostgreSQL is mandatory.** `database_type = POSTGRES_15` by default; a plan-time
  validation guard rejects MySQL and any non-Postgres engine. PostgreSQL 13/14 are also
  accepted.
- **`ZITADEL_MASTERKEY` is generated automatically and immutable.** It is exactly 32
  bytes and encrypts all sensitive data at rest. **Never rotate it after first boot** —
  doing so makes previously-encrypted data (client secrets, key material) unreadable.
- **Zitadel runs its own setup + migrations.** The container starts with
  `zitadel start-from-init`, which creates the schema and applies migrations
  idempotently on first boot — there is no separate migrate job.
- **A first-instance admin is created on first boot.** Organization `ZITADEL` and human
  admin `zitadel-admin` are seeded with a generated password from Secret Manager
  (`PASSWORDCHANGEREQUIRED = false`), so you can sign in immediately.
- **HTTP/2 with TLS terminated upstream.** `ZITADEL_EXTERNALSECURE = true`,
  `ZITADEL_EXTERNALPORT = 443`, `ZITADEL_TLS_ENABLED = false`. Zitadel serves cleartext
  HTTP/2 on 8080 and trusts Cloud Run to terminate TLS on `:443`. Set
  `container_protocol = "h2c"` if you need end-to-end HTTP/2 for gRPC API clients.
- **`ZITADEL_EXTERNALDOMAIN` is derived from the service URL.** The entrypoint sets it
  from the runtime `run.app` host. Behind a custom domain you must override it (see the
  Pitfalls table) or the OIDC issuer and Console redirects will point at the wrong host.
- **Public ingress by default.** `ingress_settings = "all"` so the Console and OIDC
  endpoints are reachable. Enabling IAP puts Google sign-in in front of everything,
  including OIDC/machine clients.
- **The service is kept warm.** `cpu_always_allocated = true` and `min_instance_count = 1`
  (no scale-to-zero), so token endpoints have no cold-start latency; `max_instance_count = 5`.
- **NFS is enabled by default but unused by the app.** Zitadel keeps all state in
  PostgreSQL; you can set `enable_nfs = false` unless another reason requires it.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Zitadel service

Zitadel runs as a Cloud Run v2 service that autoscales by request load between the
minimum and maximum instance counts. Each deployment creates an immutable revision;
traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~zitadel"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the entrypoint's derived external domain / DB SSL mode:
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50 \
    | grep cloud-entrypoint
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. Cloud SQL for PostgreSQL 15

Zitadel stores all application data (organizations, users, projects, applications,
sessions, keys) in a managed Cloud SQL for PostgreSQL 15 instance. The service connects
privately through the **Cloud SQL Auth Proxy** over a Unix socket; no public IP is
exposed. On first deploy an initialization Job creates the application database and a
role with `CREATEDB`/`CREATEROLE`; Zitadel then creates its own schema via
`start-from-init`.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~zitadel"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the [Outputs](#5-outputs).
See [App_CloudRun](App_CloudRun.md) for the connection model, backups, and password
rotation.

### C. Cloud Storage

One **Cloud Storage** bucket is provisioned automatically (public access prevention
enforced). Zitadel keeps its core state in PostgreSQL, so the bucket is available for
operator use (exports, assets). Additional buckets can be declared via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/        # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse and CMEK options.

### D. Secret Manager

Two secrets are generated automatically and stored in Secret Manager: `ZITADEL_MASTERKEY`
(encrypts all data at rest) and the initial admin password (seeds the first-instance
human on boot). The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~zitadel"
  # Read the initial admin password to log in the first time:
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-zitadel-admin-password" --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for injection and rotation details, and
[Zitadel_Common](Zitadel_Common.md) for the criticality of the masterkey.

### E. Networking & ingress

The service is reachable at its `run.app` URL by default, which allows the public
access the Console and OIDC endpoints need. An external HTTPS load balancer with a
custom domain, Cloud CDN, and Cloud Armor can be layered on; ingress settings and VPC
egress control connectivity. Because Zitadel serves gRPC + REST over HTTP/2, set
`container_protocol = "h2c"` for end-to-end HTTP/2 when required.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies. The `[cloud-entrypoint]`
log lines show the resolved DB SSL mode and external domain.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Zitadel Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It connects through the Cloud SQL Auth Proxy and idempotently
  creates the application database and a role with `LOGIN CREATEDB CREATEROLE`, then
  grants privileges on the database and `public` schema. The job is safe to re-run. It
  does **not** create Zitadel's schema — Zitadel does that itself.
- **Setup + migrations on start.** The container runs `zitadel start-from-init`, which
  creates the schema and applies migrations idempotently on every start. Upgrading the
  application version applies schema changes without a separate migration step.
- **`ZITADEL_MASTERKEY` is immutable after first boot.** It is generated once (exactly
  32 bytes) and written to Secret Manager. Changing it makes all previously-encrypted
  data unreadable. Only touch it in a planned, understood migration.
- **First-run admin.** Log in with username `zitadel-admin` (default) and the password
  from Secret Manager:
  ```bash
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-zitadel-admin-password" --project "$PROJECT"
  ```
  Then create a real admin, disable or restrict the seeded account, and configure your
  organizations, projects, and OIDC/SAML applications in the Console.
- **External domain must match the browser host.** The OIDC issuer and Console redirect
  URIs are built from `ZITADEL_EXTERNALDOMAIN`. The entrypoint derives it from the
  `run.app` URL; behind a custom domain, set `ZITADEL_EXTERNALDOMAIN` (via
  `environment_variables`) to that host or logins/token exchange will fail.
- **Health path.** Startup, liveness, and readiness probes target `/debug/healthz` — an
  unauthenticated `200` endpoint. Allow ~7–8 minutes on first boot (60-second initial
  delay plus a ~450-second retry window) for setup + migrations.
- **Inspect the running configuration / jobs:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Zitadel are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `zitadel` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Zitadel` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Zitadel image tag; mapped to a pinned tag (`v2.71.0`) when `latest`. Pin explicitly in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Zitadel is a thin custom build FROM the ghcr image — leave as `custom`. |
| `cpu_limit` | `2000m` | CPU per instance; 2 vCPU recommended. |
| `memory_limit` | `4Gi` | Memory per instance. |
| `container_port` | `8080` | Zitadel serves gRPC + REST over HTTP/2 on 8080. |
| `container_protocol` | `http1` | Set `h2c` for end-to-end HTTP/2 to gRPC API clients. |
| `min_instance_count` | `1` | Kept warm (no scale-to-zero) so token endpoints have no cold start. |
| `max_instance_count` | `5` | Maximum instances; safe to raise — all state is in PostgreSQL. |
| `cpu_always_allocated` | `true` | Instance-based billing; keeps Zitadel responsive for auth traffic. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy socket connection. |
| `enable_image_mirroring` | `true` | Mirror the built image into Artifact Registry. |
| `timeout_seconds` | `300` | Maximum request duration. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public ingress for the Console and OIDC/OAuth endpoints. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Route only RFC 1918 traffic via VPC. |
| `enable_iap` | `false` | Require Google sign-in. **Blocks OIDC/machine clients** — enable only for private consoles. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra `ZITADEL_*` settings (e.g. `ZITADEL_EXTERNALDOMAIN`, org/admin overrides). Core DB/TLS/masterkey values are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. **Do not enable masterkey rotation.** |

### Group 7 — Backup & Restore

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated Cloud SQL backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 10 — Load Balancer, CDN & Image Retention

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provision Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | CIDR ranges exempted from WAF rules. |
| `application_domains` | `[]` | Custom domains — remember to set `ZITADEL_EXTERNALDOMAIN` to match. |
| `enable_cdn` | `false` | Enable Cloud CDN on the HTTPS LB backend. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create the declared GCS bucket(s). |
| `storage_buckets` | `[{ name_suffix = "data" }]` | The auto-provisioned bucket; extend the list for additional buckets. |
| `enable_nfs` | `true` | Enabled by default but **unused** — Zitadel keeps all state in PostgreSQL; safe to set `false`. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts (requires gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PostgreSQL only (13/14/15). MySQL is rejected at plan time. |
| `db_name` | `zitadel` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `zitadel` | Application database user (granted `CREATEDB`/`CREATEROLE`). Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | DB password rotation. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Not used — Zitadel has no platform-scheduled recurring tasks. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/debug/healthz`, 60s delay | Startup probe. Allow ~7–8 minutes on first boot. |
| `liveness_probe` | HTTP `/debug/healthz`, 60s delay | Liveness probe. |
| `uptime_check_config` | _(set)_ | Cloud Monitoring uptime check (public endpoints only). |
| `alert_policies` | `[]` | Metric alert policies. |

### Group 21 — Redis

Zitadel does not use Redis (all state is in PostgreSQL). `enable_redis` defaults to
`false` and should be left off; the `redis_*` inputs are inert for this module.

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

All other inputs follow standard App_CloudRun behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the running
resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service (the Zitadel Console). |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and combinations* at plan time — a non-Postgres `database_type`, `enable_cloudsql_volume` with `database_type = NONE`, `min_instance_count > max_instance_count`, Redis enabled with no resolvable host, an out-of-range `redis_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `ZITADEL_MASTERKEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it makes all previously-encrypted data (client secrets, key material) permanently unreadable. |
| `database_type` | `POSTGRES_15` | Critical | Zitadel only supports PostgreSQL; MySQL/other is rejected at plan time, and a wrong engine breaks startup. |
| `db_name` / `db_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/role and destroys all identity data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup source fails the import job. |
| `ZITADEL_EXTERNALDOMAIN` | Match the browser/host | Critical | If it doesn't match the host users reach, the OIDC issuer and Console redirects are wrong and every login/token exchange fails. Set it explicitly behind a custom domain. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy socket is required for PostgreSQL connectivity; disabling it with a database configured is blocked by a plan-time guard. |
| `ingress_settings` | `all` | High | `internal` blocks the Console and all external OIDC/OAuth clients. |
| `enable_iap` | only for private consoles | High | IAP requires Google sign-in for all requests, blocking OIDC/machine clients and token endpoints. |
| `application_version` | Pin a release | High | `latest` maps to a pinned tag today, but pinning explicitly avoids surprise migrations on redeploy. |
| `memory_limit` | `4Gi` | Medium | Setting too low risks OOM under load; gen2 also enforces a 512 MiB floor. |
| `min_instance_count` | `1` | Medium | `0` (scale-to-zero) adds cold-start latency to token/login requests after idle. |
| `enable_nfs` | `false` (unused) | Low | Enabled by default but Zitadel stores no state on disk; leaving it on wastes an NFS mount. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention of identity data. |
| `enable_cloud_armor` | enable for production | Medium | The Console and OIDC endpoints are publicly reachable without WAF protection. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**.
Zitadel-specific application configuration shared with the GKE variant is described in
**[Zitadel_Common](Zitadel_Common.md)**.
