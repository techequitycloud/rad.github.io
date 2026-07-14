---
title: "Plausible Analytics on GKE Autopilot"
description: "Configuration reference for deploying Plausible Analytics on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Plausible Analytics on GKE Autopilot

Plausible Analytics Community Edition is the leading open-source, AGPL-3.0-licensed,
privacy-first web analytics platform — a lightweight, cookie-free, GDPR/CCPA/PECR-compliant
alternative to Google Analytics that you fully own and self-host. This module deploys
Plausible CE on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation,
which provisions and manages the shared Google Cloud and Kubernetes infrastructure.

Plausible is an Elixir/Phoenix application with **two datastores**: Cloud SQL
PostgreSQL 15 holds accounts and site configuration only, and **ClickHouse holds all
analytics events**. ClickHouse is provided by the separate
[ClickHouse_GKE](ClickHouse_GKE.md) module and is **mandatory** — deploy it first.
There is deliberately **no Plausible_CloudRun variant**: ClickHouse cannot run on
Cloud Run, so this pair follows the GKE-only pattern (like Supabase and Temporal).

This guide focuses on the cloud services Plausible uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

Plausible runs as an Elixir/Phoenix (BEAM) web workload on port 8000. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Plausible pods, 1 vCPU by default, horizontally autoscaled 1–10 replicas |
| Config database | Cloud SQL for PostgreSQL 15 | Accounts, sites, and settings ONLY — no analytics events |
| Event store | ClickHouse ([ClickHouse_GKE](ClickHouse_GKE.md)) | **Mandatory** — every pageview/event lands here; deploy it first |
| Secrets | Secret Manager | Auto-generated `SECRET_KEY_BASE` and `TOTP_VAULT_KEY`; DB password; the ClickHouse password (owned by ClickHouse_GKE) |
| Image build | Cloud Build + Artifact Registry | Thin custom build FROM `ghcr.io/plausible/community-edition` |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **ClickHouse is not optional.** A plan-time validation guard **blocks the apply
  when `clickhouse_url` is empty**, and `module_dependency` defaults to
  `["Services_GCP", "ClickHouse_GKE"]`. Wire the ClickHouse_GKE outputs in:
  `clickhouse_url` = `clickhouse_internal_endpoint` (same cluster, preferred) or
  `clickhouse_endpoint`; `clickhouse_db` = `clickhouse_database`; `clickhouse_user` =
  `clickhouse_username`; `clickhouse_password_secret` = `clickhouse_password_secret_id`.
- **The ClickHouse password crosses module boundaries safely.** Plausible references
  the Secret Manager secret *created by ClickHouse_GKE*; the foundation grants
  Plausible's workload SA `secretAccessor` on it and injects it as
  `CLICKHOUSE_PASSWORD`. No password ever appears in Terraform variables.
- **`application_version = "latest"` is a pin, not a tag.** CE publishes **no
  `latest` tag** on `ghcr.io/plausible/community-edition`; the build pins the
  known-good release `v3.2.1` via the app-specific `PLAUSIBLE_VERSION` build ARG
  (the Foundation injects `APP_VERSION` and wins that merge, hence the app-specific
  ARG name).
- **`SECRET_KEY_BASE` and `TOTP_VAULT_KEY` are generated automatically** and stored
  in Secret Manager. Both must remain stable: rotating `SECRET_KEY_BASE` invalidates
  all sessions and logs every user out; rotating `TOTP_VAULT_KEY` breaks every
  enrolled 2FA device.
- **Registration is open by default.** Create the first account at
  `<service URL>/register`, then set `DISABLE_REGISTRATION = "true"` (or
  `"invite_only"`) via `environment_variables`.
- **Port 8000; probes on `/api/health`.** The health endpoint responds without
  authentication, so startup/liveness probes never see a 401/403.
- **1Gi memory is the reliable floor** for the BEAM runtime plus the in-process
  Oban job queue (the shared-layer default).
- **No NFS, no GCS buckets.** All state lives in PostgreSQL and ClickHouse.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Plausible workload

Plausible pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the Deployment between the
minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Plausible workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods -A | grep plausible          # find the namespace and pods
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/"$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')" --tail=100
  ```

The entrypoint logs its composed configuration at startup — look for the
`[plausible-entrypoint]` lines showing the `DATABASE_URL` host, ClickHouse host,
and `BASE_URL`.

### B. Cloud SQL for PostgreSQL 15 — accounts and configuration

Plausible stores accounts, sites, goals, and settings in a managed Cloud SQL for
PostgreSQL 15 instance. Pods reach it privately through the **Cloud SQL Auth Proxy**
sidecar — the entrypoint always connects over TCP `127.0.0.1:5432` (socket-path
hosts are coerced to `127.0.0.1`, because `postgresql://` URLs cannot carry socket
paths). On first deploy a `db-init` Job (`postgres:15-alpine`) creates the
application role and database; Plausible's own migrations run at container startup.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

**Analytics events are NOT here.** If you query PostgreSQL looking for pageviews you
will find nothing — events live in ClickHouse.

### C. ClickHouse — the event store (via ClickHouse_GKE)

Every pageview and custom event is written to ClickHouse, deployed and owned by the
separate [ClickHouse_GKE](ClickHouse_GKE.md) module (a StatefulSet with a persistent
volume). Plausible connects using the composed `CLICKHOUSE_DATABASE_URL`; on first
boot, CE's `db createdb` creates the events database if missing and `db migrate`
applies the ClickHouse schema.

- **CLI:**
  ```bash
  kubectl get pods -A | grep clickhouse                 # the ClickHouse workload
  # Ping ClickHouse from inside the cluster (endpoint = the clickhouse_url you wired in):
  kubectl run ch-ping --rm -it --restart=Never --image=curlimages/curl -- \
    curl -s "<clickhouse_url>/ping"                     # expect: Ok.
  # Confirm the composed wiring inside the Plausible pod:
  kubectl exec -n "$NAMESPACE" deploy/<deploy-name> -- env | grep PLATFORM_CLICKHOUSE
  ```

### D. Secret Manager

Four secrets matter to a running Plausible:

| Secret | Owner | Purpose |
|---|---|---|
| `secret-<prefix>-plausible-secret-key-base` | Plausible_Common | Phoenix session signing — **never rotate** (logs everyone out) |
| `secret-<prefix>-plausible-totp-vault-key` | Plausible_Common | Encrypts 2FA TOTP secrets at rest — **never rotate** (breaks all 2FA) |
| DB password secret | App_GKE foundation | Cloud SQL application-user password |
| ClickHouse password secret | ClickHouse_GKE | Injected as `CLICKHOUSE_PASSWORD`; Plausible's SA is granted `secretAccessor` |

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~plausible"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Cloud Build & Artifact Registry — the custom image

The image is a thin wrapper: `FROM ghcr.io/plausible/community-edition:<tag>` plus
the cloud entrypoint (`plausible-entrypoint.sh`, pure POSIX `sh` — the image has no
bash/node/python). The entrypoint URL-encodes credentials with a pure-shell
percent-encoder, composes `DATABASE_URL` and `CLICKHOUSE_DATABASE_URL`, falls back
`BASE_URL` to the platform-predicted service URL, then runs CE's `db createdb` +
`db migrate` (advisory-locked) before `exec`-ing the server.

- **CLI:**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --include-tags | grep plausible
  ```

Entrypoint edits are baked into the image — they need a rebuild + redeploy. Job
scripts (`create-db-and-user.sh`) are mounted at apply time — no rebuild needed.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP with
a reserved static address. A custom domain with a Google-managed certificate can be
enabled.

On projects capped on **global external static IP quota**, set
`reserve_static_ip = false` and `enable_custom_domain = false`. The default
`enable_custom_domain = true` activates the per-app HTTPS Gateway (zero-config
nip.io HTTPS) even without a custom domain, and the Gateway reserves a **global**
static IP; with both disabled, the Service falls back to an ephemeral LoadBalancer
IP and consumes no static address. The companion
[ClickHouse_GKE](ClickHouse_GKE.md) — whose only consumer is in-cluster Plausible —
can additionally set `service_type = "ClusterIP"` to need no external IP at all.

- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT" --filter="name~plausible"
  ```

Set `base_url` (or leave it empty for the platform-predicted URL) — it drives the
tracking-script snippet Plausible shows for each site and the links in its emails.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. An optional uptime check targets `/api/health`.

- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Plausible Application Behaviour

- **Two-phase database bootstrap.** The `db-init` Job creates the PostgreSQL role
  and database (idempotent, safe to re-run). Then, at every container start, the
  entrypoint runs CE's `db createdb` (creates the ClickHouse events database if
  missing) and `db migrate` (PostgreSQL + ClickHouse migrations, advisory-locked so
  concurrent replicas don't race), before `exec /entrypoint.sh run`.
- **Hard fail on missing ClickHouse.** If `PLATFORM_CLICKHOUSE_URL` is empty at
  runtime the entrypoint exits 1 with an explicit error naming the fix (deploy
  ClickHouse_GKE and set `clickhouse_url`). In practice you never see this because
  the plan-time validation catches it first.
- **First account via `/register`.** There are no seeded credentials. Open
  `<service URL>/register`, create the first account, add your site, and Plausible
  shows the tracking snippet
  (`<script defer data-domain="yourdomain.com" src=".../js/script.js"></script>`).
  After that, close registration with `DISABLE_REGISTRATION = "true"` (or
  `"invite_only"`) in `environment_variables` and apply via **Update**.
- **`BASE_URL` matters for correctness.** It drives the snippet URL and email links.
  The entrypoint defaults it to the platform-predicted service URL
  (`GKE_SERVICE_URL`); set `base_url` explicitly when serving behind a custom
  domain.
- **Health path.** Startup and liveness probes target `GET /api/health`, which is
  unauthenticated by design and returns a JSON status body such as
  `{"sessions":"ok","postgres":"ok","clickhouse":"ok",...}` — a quick end-to-end
  check that both datastores are reachable. Do not repoint probes at authenticated
  pages (they would 401/403 and the pod would never become Ready).
- **Version upgrades.** Set `application_version` to an explicit CE tag (e.g.
  `v3.2.1`) and apply; a new image builds and migrations run on the next start.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Plausible are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project, Identity & ClickHouse

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |
| `clickhouse_url` | `""` | **Effectively required** — the plan blocks when empty. Bare `http(s)://host[:port]` base endpoint, no credentials or path: ClickHouse_GKE's `clickhouse_internal_endpoint` (preferred) or `clickhouse_endpoint`. |
| `clickhouse_password_secret` | `""` | ClickHouse_GKE's `clickhouse_password_secret_id` output. The foundation grants the workload SA access and injects `CLICKHOUSE_PASSWORD`. |
| `clickhouse_db` | `plausible_events_db` | ClickHouse_GKE's `clickhouse_database` output. |
| `clickhouse_user` | `plausible` | ClickHouse_GKE's `clickhouse_username` output. |
| `base_url` | `""` | Public `BASE_URL` — drives the tracking snippet and email links. Empty uses the platform-predicted service URL. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `plausible` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | CE image tag. `latest` pins to `v3.2.1` at build time (CE has no `latest` tag); set an explicit tag to upgrade. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Keep `custom` — the wrapper image's entrypoint composes both database URLs. |
| `container_port` | `8000` | Plausible CE's `HTTP_PORT`. |
| `container_resources` | `1000m` / `512Mi` | Per-pod CPU/memory. Raise memory toward the 1Gi BEAM+Oban floor for production. |
| `min_instance_count` / `max_instance_count` | `1` / `10` | HPA bounds. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar; the entrypoint uses its TCP listener on `127.0.0.1:5432`. |
| `enable_image_mirroring` | `true` | Mirror the base image into Artifact Registry before building. |
| `workload_type` | `Deployment` | Plausible is stateless (state lives in Cloud SQL + ClickHouse). |

### Group 6 — GKE Cluster, Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra settings — e.g. `{ DISABLE_REGISTRATION = "true" }` after the first account. Do not set `DATABASE_URL`, `CLICKHOUSE_DATABASE_URL`, `SECRET_KEY_BASE`, or `TOTP_VAULT_KEY` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `gke_cluster_name` / `namespace_name` | `""` | Empty auto-discovers the Services_GCP cluster / auto-generates the namespace. |
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `session_affinity` | `None` | Stateless — any pod can serve any request. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/api/health`, 30s delay, threshold 30 | Generous window for first-boot migrations. |
| `health_check_config` | HTTP `/api/health`, 30s period, threshold 3 | Liveness probe. |
| `uptime_check_config` | disabled, `/api/health` | Optional Cloud Monitoring uptime check. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job (`postgres:15-alpine` + `create-db-and-user.sh`). |
| `cron_jobs` / `additional_services` | `[]` | Scheduled CronJobs / helper services. |

### Group 15 — Redis

`enable_redis`, `redis_host`, `redis_port`, `redis_auth` are **inert convention
mirrors** of the Foundation variables — Plausible does not use Redis.

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `application_database_name` | `plausible` | PostgreSQL database name (tenant-prefixed by the foundation). Immutable after first deploy. |
| `application_database_user` | `plausible` | Application database role. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |

Groups 5 (IAP), 7 (backup/StatefulSet), 8 (ResourceQuota), 9 (custom SQL/PDB),
12 (CI/CD), 13 (NFS — off), 14 (storage/registry), 17 (backup import), 19 (custom
domain/static IP), 21 (Cloud Armor/CDN), and 22 (VPC-SC/audit logging) are standard
App_GKE inputs — see [App_GKE](App_GKE.md).

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` / `stage_service_cluster_ips` | In-cluster ClusterIP(s). |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Plausible (open `/register` here first). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user (config store only). |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets (empty for Plausible). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD GitHub details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready (re-run apply if `false` on a new inline cluster). |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the
> [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations*
> at plan time. In addition, `Plausible_GKE`'s own validation guard rejects an empty
> `clickhouse_url`, `min > max` instance counts, IAP without OAuth credentials, and a
> Cloud SQL sidecar with `database_type = "NONE"` — all before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| ClickHouse_GKE `application_version` | Keep the pinned `24.12-alpine` | Critical | Overriding the ClickHouse pin with an untested version has broken Plausible upstream (plausible/analytics#3855) — migrations or queries fail against an incompatible ClickHouse. Plausible version-pins ClickHouse for a reason. |
| `SECRET_KEY_BASE` (auto-generated) | Never rotate | Critical | Rotation invalidates every Phoenix session — all users are logged out at once. |
| `TOTP_VAULT_KEY` (auto-generated) | Never rotate | Critical | Rotation makes every enrolled 2FA device unusable; affected users are locked out of 2FA login. |
| `clickhouse_url` | ClickHouse_GKE's `clickhouse_internal_endpoint` | High (blocked) | Left empty, the deploy is **blocked at plan time** by the validation guard — deploy ClickHouse_GKE first and paste its output. A wrong-but-nonempty URL fails at runtime (entrypoint/migrations cannot reach the event store). |
| `clickhouse_password_secret` | ClickHouse_GKE's `clickhouse_password_secret_id` | High | Missing or wrong secret → `CLICKHOUSE_PASSWORD` is absent and ClickHouse authentication fails; pods crash-loop on migrate. |
| `DISABLE_REGISTRATION` | `"true"` (or `"invite_only"`) after the first account | Medium | Registration stays **open by default** — anyone who finds the URL can create an account on your analytics instance. |
| `application_version` | `latest` (pins `v3.2.1`) or an explicit CE tag | High | CE publishes no `latest` tag; without the pin the build would fail `MANIFEST_UNKNOWN`. Pin explicit versions in production. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/role and orphans account/site config. |
| `container_resources.memory_limit` | `1Gi` | High | Below the BEAM + in-process Oban floor, pods OOM under load or during migrations. |
| `base_url` | Custom-domain URL when using one | High | A wrong `BASE_URL` puts the wrong script `src` in every tracking snippet and breaks email links. |
| Probe `path` | `/api/health` | High | Repointing probes at an authenticated page returns 401/403 — the pod never becomes Ready even though the app booted fine. |
| `enable_cloudsql_volume` | `true` | High | The entrypoint connects to `127.0.0.1:5432` via the Auth Proxy sidecar; disabling it breaks the PostgreSQL path (and is blocked when `database_type = "NONE"`). |
| `enable_iap` | `false` for public analytics | High | IAP in front of Plausible blocks the tracking script on your websites — visitors' browsers cannot POST events through a Google login wall. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| Teardown order | Plausible first, then ClickHouse | Medium | Destroying ClickHouse while Plausible still runs leaves pods crash-looping against a vanished event store (and the secret grant dangling). |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict all pods simultaneously during maintenance. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Plausible-specific application configuration (secrets,
entrypoint, database bootstrap) is described in
**[Plausible_Common](Plausible_Common.md)**, and the event store in
**[ClickHouse_GKE](ClickHouse_GKE.md)**.
