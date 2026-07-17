---
title: "Authentik on GKE Autopilot"
description: "Configuration reference for deploying Authentik on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Authentik on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Authentik_GKE.png" alt="Authentik on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

authentik ([goauthentik.io](https://goauthentik.io/)) is an open-source (MIT,
open-core) identity provider: single sign-on via OIDC and SAML, LDAP and SCIM,
multi-factor authentication, and proxy authentication — a self-hosted alternative
to Okta, Auth0, and Keycloak. This module deploys authentik on **GKE Autopilot** on
top of the [App_GKE](App_GKE.md) foundation, which provisions and manages the
shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services authentik uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

authentik runs as a Python/Django Deployment on GKE Autopilot, with its background
worker (`ak worker`) co-located in the same pod container. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Deployment, 2 vCPU / 4 GiB by default, 1–5 replicas |
| Database | Cloud SQL for PostgreSQL 15 | Required — authentik needs PostgreSQL ≥ 14; MySQL is blocked |
| Cache & queue | **None — no Redis** | authentik ≥ 2025.10 moved cache, sessions, task queue, and the WebSocket channel layer into PostgreSQL |
| Media storage | Cloud Storage (GCS Fuse CSI) | Bucket mounted at `/media` for uploaded icons and flow backgrounds |
| Secrets | Secret Manager | Stable `AUTHENTIK_SECRET_KEY`, `akadmin` bootstrap password, database password |
| Image | Artifact Registry + Cloud Build | Thin custom build `FROM ghcr.io/goauthentik/server` (cloud entrypoint + worker launcher) |
| Ingress | Cloud Load Balancing | External LoadBalancer Service; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory and is the *only* datastore.** No Redis, no search
  backend — sessions, cache, and the task queue all live in Cloud SQL.
- **The worker is co-located.** The container entrypoint starts `ak worker` in the
  background next to the server (the same pattern as Chatwoot's Sidekiq worker) —
  no separate worker Deployment. Keep `min_instance_count ≥ 1` so the worker is
  always processing.
- **`max_instance_count = 5`.** authentik is stateless across pods — all state is
  in PostgreSQL — so multiple replicas (each with its own worker) are safe.
- **`AUTHENTIK_SECRET_KEY` is generated automatically** and stored in Secret
  Manager. It must remain stable — rotating it invalidates all sessions and makes
  encrypted fields unreadable. Both secret names are simple (`__`-free), so they
  pass the GKE SecretSync `targetKey` validation; the `AUTHENTIK_POSTGRESQL__*`
  mapping happens inside the entrypoint from the injected `DB_*` variables.
- **The `akadmin` admin account is bootstrapped on first boot** with
  `bootstrap_email` (default `admin@techequity.cloud`) and a Secret Manager-backed
  password. Bootstrap variables apply on the **first** boot only.
- **`application_version = "latest"` is pinned.** authentik publishes no `latest`
  tag on GHCR; the build pins `latest` to a known-good release (`2026.5.4`) via
  the app-specific `AUTHENTIK_VERSION` build ARG.
- **Migrations run automatically at startup**, guarded by a PostgreSQL advisory
  lock so concurrent pods don't collide — no separate migrate job.
- **Health endpoints are unauthenticated**: startup `GET /-/health/ready/`,
  liveness `GET /-/health/live/`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the authentik workload

authentik pods are scheduled on Autopilot, which bills for the CPU/memory the pods
request. Horizontal Pod Autoscaling sizes the Deployment between the minimum and
maximum replica counts. Each pod runs the server, the background worker, and the
Cloud SQL Auth Proxy sidecar.

- **Console:** Kubernetes Engine → Workloads → select the authentik workload for
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> -c <app-container> --tail=100
  kubectl describe hpa -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for Autopilot, scaling, and workload-type management.

### B. Cloud SQL for PostgreSQL 15

authentik stores *everything* here — users, groups, flows, providers, sessions,
cache, and the background task queue. Pods reach the instance privately through
the **Cloud SQL Auth Proxy** sidecar; the container entrypoint maps the injected
`DB_*` variables onto authentik's `AUTHENTIK_POSTGRESQL__*` convention and sets
the SSL mode by connection type — `disable` for the proxy sidecar's loopback TCP
(`127.0.0.1` / `localhost`; the proxy is TLS-terminated but does not speak SSL
itself, so requiring SSL there fails with "server does not support SSL, but SSL
was required"), `require` only for direct TCP to any other host. On first deploy
a single `db-init` Job creates the tenant-scoped database and role.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs) (database and user names are tenant-prefixed). See
[App_GKE](App_GKE.md) for the connection model, backups, and password rotation.

### C. Cloud Storage — media

A dedicated bucket is mounted at `/media` via the GCS Fuse CSI driver for uploaded
media (application icons, flow backgrounds), so uploads survive pod replacement
and scaling.

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

See [Authentik_Common](Authentik_Common.md) for the full secret model and
[App_GKE](App_GKE.md) for SecretSync details.

### E. Networking & ingress

By default the workload is exposed through an external LoadBalancer IP; a custom
domain with a Google-managed certificate can be enabled, and a static IP is
reserved by default so the address survives redeploys. For an IdP a stable,
TLS-fronted hostname matters — the OIDC/SAML redirect URIs you register in client
applications must match the URL users reach authentik on.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

### F. Cloud Logging & Monitoring

Server **and worker** logs both flow to Cloud Logging (they share the container's
stdout/stderr). GKE and Cloud SQL metrics flow to Cloud Monitoring.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. authentik Application Behaviour

- **First-deploy database setup.** A single initialization Job runs `db-init.sh`
  using `postgres:15-alpine`: it waits for PostgreSQL, creates the tenant-scoped
  role and database, grants privileges, defensively grants `cloudsqlsuperuser`,
  and signals the proxy sidecar to shut down so the Job completes. Idempotent and
  safe to re-run.
- **Self-migrating startup.** authentik's server runs its own Django migrations on
  every startup, guarded by a PostgreSQL advisory lock so concurrent pods don't
  collide. There is no separate migrate job. The first boot runs the full suite —
  expect several minutes before `/-/health/ready/` returns 200; the startup probe
  allows ~11 minutes.
- **First login.** Sign in as **`akadmin`** using the `bootstrap_email` value and
  the password in the `...-bootstrap-password` secret. If the bootstrap variables
  were absent on the first boot, complete setup at
  `<service-url>/if/flow/initial-setup/` instead.
- **Applications and providers are configured in-app after deploy.** OIDC/SAML
  providers, applications, outposts, and flows are authentik configuration, not
  Terraform inputs — create them in the Admin interface (`<service-url>/if/admin/`)
  once the workload is ready.
- **Worker co-location.** `ak worker` runs in the same container as the server;
  its log lines are interleaved in the pod logs
  (`kubectl logs ... | grep -i worker`). Keep `min_instance_count ≥ 1` so
  scheduled tasks and outpost sync keep processing.
- **Health endpoints.**
  ```bash
  curl -s "$SERVICE_URL/-/health/ready/" -o /dev/null -w '%{http_code}\n'   # 200 = migrated + DB reachable
  curl -s "$SERVICE_URL/-/health/live/"  -o /dev/null -w '%{http_code}\n'   # 200 = process alive
  ```
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for authentik are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |
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
| `application_name` | `authentik` | Base name for resources (namespace, secrets, buckets). Do not change after first deploy. |
| `application_display_name` | `authentik Identity Provider` | Human-readable name. |
| `application_version` | `latest` | authentik version tag; `latest` is pinned to `2026.5.4` at build time (no upstream `latest` tag). Pin explicitly in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Thin wrapper image built via Cloud Build (adds the cloud entrypoint + worker launcher). |
| `min_instance_count` | `1` | Keep ≥ 1 so the co-located worker keeps processing. |
| `max_instance_count` | `5` | Safe to raise — authentik is stateless across pods. |
| `container_port` | `9000` | authentik's HTTP port (Service exposes 80). |
| `container_resources` | `2000m` / `4Gi` | Shared by server + worker; the Autopilot default gives migration headroom. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar — keep `true` on GKE. |
| `enable_image_mirroring` | `true` | GHCR base image is mirrored into Artifact Registry. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra `AUTHENTIK_*` settings (e.g. email/SMTP: `AUTHENTIK_EMAIL__HOST`, …). Do not set `AUTHENTIK_SECRET_KEY` or `AUTHENTIK_POSTGRESQL__*` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Keys must be `__`-free (SecretSync CRD). |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for browser SSO and OAuth callbacks. |
| `workload_type` | `Deployment` (auto) | authentik is stateless; StatefulSet is unnecessary. |
| `session_affinity` | `ClientIP` | Sticky routing helps the admin UI's WebSocket connections. |
| `termination_grace_period_seconds` | `60` | Grace for in-flight worker tasks on shutdown. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | When enabling, size requests ≥ 2× one pod and use binary memory suffixes (`"8Gi"`). |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protects login availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods during voluntary disruptions. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/-/health/ready/`, 60s delay, 40×15s | Unauthenticated. Generous threshold for first-boot migrations (~11 min budget). |
| `liveness_probe` | HTTP `/-/health/live/`, 60s delay, 3×30s | Unauthenticated process-alive check. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check (point it at `/-/health/live/`). |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in single `db-init` job. |
| `cron_jobs` | `[]` | Not needed — the co-located worker runs authentik's scheduled tasks. |
| `additional_services` | `[]` | Use for extra outposts (e.g. LDAP/RADIUS) if required. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Optional; authentik keeps media on GCS, not NFS. |
| `nfs_mount_path` | `/opt/authentik/storage` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | The `/media` bucket is declared by `Authentik_Common`. |
| `gcs_volumes` | `[]` | Extra GCS Fuse mounts; `/media` is added automatically. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | **Inert.** authentik ≥ 2025.10 removed Redis entirely; `main.tf` pins `enable_redis = false`. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | authentik requires PostgreSQL — MySQL values are rejected by validation. |
| `application_database_name` | `authentik` | Database base name (tenant-prefixed at deploy). Immutable after first deploy. |
| `application_database_user` | `authentik` | Application DB user base name (tenant-prefixed). |
| `database_password_length` | `32` | Generated password length (16–64). |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Ingress + managed certificate for custom hostnames. |
| `application_domains` | `[]` | Hostname(s) to serve. Register OIDC redirect URIs against the domain users actually reach. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys — important for DNS-pinned IdP hostnames. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | IAP in front of an IdP double-gates every login and breaks OAuth/SAML callbacks — leave off unless you know you need it. |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | WAF policy on the Ingress backend — recommended for a public IdP. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

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
| `service_external_ip` | External LoadBalancer IP. |
| `service_url` | URL to reach authentik. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user (tenant-prefixed). |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | Created Cloud Storage buckets (includes the `/media` bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` / `github_repository_*` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `AUTHENTIK_SECRET_KEY` (auto-generated) | Never rotate | Critical | Rotating it invalidates **all** active sessions and makes encrypted fields (stored credentials, tokens) unreadable. |
| `database_type` | `POSTGRES_15` | Critical | MySQL is blocked by validation — authentik requires PostgreSQL ≥ 14. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all identity data. |
| Worker listen ports (entrypoint-managed) | Leave the entrypoint's `AUTHENTIK_LISTEN__*` loopback defaults | Critical | The co-located `ak worker` also starts an HTTP listener and inherits the server's default `0.0.0.0:9000`; if it wins the bind race it answers **every** route — health endpoints included — with empty 200s: a blank UI while the kubelet probes look green. The entrypoint pins the worker to loopback ports (`127.0.0.1:9001`/`9444`/`9301`) so the server owns `:9000` — a 200 with an empty body means the wrong process answered. |
| `min_instance_count` | `≥ 1` | High | `0` is invalid semantics for the co-located worker — background tasks and outpost sync stop; outpost WebSockets disconnect. |
| `secret_environment_variables` keys | Simple, `__`-free names | High | The SecretSync CRD rejects keys with `__` (e.g. `AUTHENTIK_POSTGRESQL__PASSWORD`) at apply time — that mapping belongs in the entrypoint, not a synced secret. |
| `startup_probe.path` | `/-/health/ready/` (unauthenticated) | Medium | Pointing the probe at an authenticated page returns 401/403 to the kubelet — the pod never becomes ready even though authentik booted fine. |
| `bootstrap_password` / `bootstrap_email` | Set before first deploy | Medium | Applied on the **first** boot only. Changing them later has no effect — manage `akadmin` in-app, or use `/if/flow/initial-setup/` if bootstrap vars were absent on first boot. |
| `application_version` | Pin a release | Medium | `latest` is silently pinned to `2026.5.4`; an explicit pin makes upgrades deliberate. Nonexistent tags fail the Cloud Build with `MANIFEST_UNKNOWN`. |
| `quota_memory_requests` / `_limits` | Binary units (`8Gi`), ≥ 2× one pod | Critical | Bare integers are bytes and block all pod scheduling; quota sized to one pod deadlocks rolling updates. |
| `environment_variables` → `AUTHENTIK_POSTGRESQL__*` | Leave unset | Medium | The entrypoint maps the injected `DB_*` values; hardcoding short DB names authenticates as a non-existent role (names are tenant-prefixed). |
| `enable_iap` | `false` | Medium | IAP double-gates every login and breaks OAuth/SAML callbacks from external parties. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict all pods simultaneously during maintenance — a full login outage. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. authentik-specific application configuration shared
with the Cloud Run variant is described in
**[Authentik_Common](Authentik_Common.md)**.
