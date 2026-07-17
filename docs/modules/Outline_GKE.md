---
title: "Outline on GKE Autopilot"
description: "Configuration reference for deploying Outline on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Outline on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Outline_GKE.png" alt="Outline on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Outline is an open-source, Notion-style team knowledge base and wiki: real-time
collaborative Markdown documents, powerful full-text search, and nested
document collections, authenticated exclusively through an external identity
provider (OIDC, Google, Slack, etc.) rather than its own username/password
store. This module deploys Outline on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Outline uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Outline runs as a single Node.js workload with a mandatory Redis dependency
(used for realtime collaboration/session coordination, not just caching). The
deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pod on port 3000, 1 vCPU / 2 GiB by default |
| Database | Cloud SQL for PostgreSQL 15 | Required — Outline (Sequelize) supports Postgres only |
| Cache / coordination | Redis (self-managed, co-hosted on the NFS VM by default) | **Required**, not optional — Outline needs it even single-replica |
| File persistence | Cloud Filestore (NFS) | Uploaded files persist under `/var/lib/outline/data`, shared across pods |
| Object storage | Cloud Storage | Two buckets provisioned by default (`...-storage`, `...-data`); neither is mounted into the pod out of the box |
| Secrets | Secret Manager | Auto-generated `SECRET_KEY` and `UTILS_SECRET`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP by default; optional custom domain + managed certificate, IAP, Cloud Armor |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is effectively mandatory** (`database_type` defaults to
  `POSTGRES_15`) — Outline's Sequelize migrations, `pg_trgm` search
  extension, and entrypoint connection-string logic all assume Postgres.
- **Redis is required, not optional.** `enable_redis = true` by default; with
  `enable_nfs = true` (also default) the foundation points `REDIS_HOST` at
  the NFS server IP, which co-hosts Redis — no separate Memorystore needed.
- **Multi-replica by default** (`min_instance_count = 1`,
  `max_instance_count = 3`) — unlike most NFS-backed apps here, Outline is
  designed to run several replicas concurrently (Redis coordinates state).
- **NFS-backed rollouts still use `Recreate`,** stopping **all** replicas
  before starting the new set — with `max_instance_count = 3` that's a
  brief full outage on every redeploy, not a rolling one.
- **Two Cloud Storage buckets are created but unused by default** — one from
  `Outline_Common` (`storage`), one from this variant's own default
  (`data`). Outline actually stores uploads on NFS (`FILE_STORAGE=local`);
  neither bucket is mounted via `gcs_volumes` unless configured.
- **`SECRET_KEY`/`UTILS_SECRET` are auto-generated** in Secret Manager and
  wired both as Secret Manager references and raw `explicit_secret_values`
  (a read-after-write hedge; the Secret-Manager-ID path wins).
- **An auth provider is required before login works.** The `OIDC_*` vars
  ship blank; Outline builds its OIDC `redirect_uri` from `URL`, so with no
  provider configured it registers **zero** auth methods. See
  [Section 3](#3-outline-application-behaviour).
- **The default LoadBalancer is plain HTTP**, which breaks OAuth logins
  outright until a domain and TLS are added — see
  [Section 6](#6-configuration-pitfalls--sensible-defaults).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Outline workload

Outline pods are scheduled on Autopilot, which bills for the CPU/memory the
pods actually request. Because `enable_nfs = true`, the Deployment uses the
`Recreate` strategy — with `max_instance_count > 1` this means every rollout
stops all replicas before starting the replacement set.

- **Console:** Kubernetes Engine → Workloads → select the Outline workload for
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows
  the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector app~outline
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Outline stores all documents, collections, users, and search indexes in a
managed Cloud SQL for PostgreSQL 15 instance, reached through the
**Cloud SQL Auth Proxy** sidecar on `127.0.0.1:5432` (`enable_cloudsql_volume
= true`); no public IP is exposed. On first deploy the `db-init` job creates
the database/user/grants; the custom entrypoint runs Outline's Sequelize
migrations on every container start (idempotent).

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

### C. Redis

Outline's collaboration/session layer and API rate limiting require Redis —
this is not an optional cache tier the way it is for many apps. By default
the foundation points `REDIS_HOST` at the NFS server VM's internal IP (it
co-hosts a Redis process); set `redis_host` to use Memorystore instead.

- **Console:** Compute Engine → VM instances (self-hosted Redis on the NFS
  VM), or Memorystore → Redis instances if you switched to a managed one.
- **CLI:**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E '^REDIS_'
  gcloud redis instances list --project "$PROJECT" --region "$REGION"   # only if using Memorystore
  ```

See [App_GKE](App_GKE.md) for how `enable_redis`/`redis_host` resolve.

### D. Cloud Filestore (NFS) & Cloud Storage

Outline's uploaded files (`FILE_STORAGE=local`) live on **NFS (Cloud
Filestore)**, mounted at `/var/lib/outline/data`, shared across all pods.
Two **Cloud Storage** buckets (suffixes `storage` and `data`) are also
provisioned automatically — neither is mounted into the pod by default, since
Outline is configured for local/NFS storage rather than S3-compatible object
storage.

- **Console:** Filestore → Instances; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  gcloud storage buckets list --project "$PROJECT" --filter="name~outline"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts (`gcs_volumes`)
if you want to wire one of the provisioned buckets in as a mounted volume.

### E. Secret Manager

Two Outline-specific secrets are generated automatically and stored in Secret
Manager: `SECRET_KEY` (encrypts cookies and sensitive data at rest) and
`UTILS_SECRET` (internal API/utilities authentication). The database password
is managed separately by the foundation. On GKE, Secret-Manager-backed
values are materialised into the cluster as native Kubernetes Secrets by the
**SecretSync** controller (the `secretsyncs.secret-sync.gke.io` CRD), which
the App_GKE foundation waits for during cluster bootstrap.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~outline"
  gcloud secrets versions access latest --secret=<secret-key-secret-name> --project "$PROJECT"
  kubectl get secret -n "$NAMESPACE"   # the SecretSync-materialised "<prefix>-secrets" object
  ```

See [App_GKE](App_GKE.md) for the SecretSync/CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing
IP (`service_type = LoadBalancer`, `reserve_static_ip = true`, plain HTTP — no
TLS terminator). A custom domain with a Google-managed certificate can be
enabled via `enable_custom_domain` + `application_domains`, which is required
for Outline's OAuth logins to work at all (see
[Section 6](#6-configuration-pitfalls--sensible-defaults)).

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, IAP, Cloud Armor, and
static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to
Cloud Monitoring. `uptime_check_config` is disabled by default for this
module (`enabled = false`) — enable it once the app is reachable over HTTPS.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Outline Application Behaviour

- **First-deploy database setup.** The `db-init` job runs `db-init.sh` using
  `postgres:15-alpine`. It connects to Cloud SQL through the Auth Proxy
  sidecar, idempotently creates the application role and database (owned by
  that role), grants privileges on the database and `public` schema, then
  signals the proxy sidecar to shut down (`quitquitquit`) so the Job
  completes. Safe to re-run (`execute_on_apply = true`).
- **Migrations run on every container start, not in a separate job.** The
  custom `entrypoint.sh` (baked into the image at build time) assembles
  `DATABASE_URL` from the platform-injected `DB_*` values (branching on
  whether `DB_HOST` is a socket path, `127.0.0.1`, or a private IP), waits
  for Postgres to accept connections, runs Outline's Sequelize migrations
  (`sequelize db:migrate --env=production-ssl-disabled`, idempotent), and
  only then execs the Node server.
- **`URL` must resolve to the public address, or OIDC registers zero
  providers.** Outline derives its OIDC `redirect_uri` from `URL`. Unlike
  the Cloud Run variant (which sets `service_url_env_var_name = "URL"` so
  the foundation injects the predicted URL directly), the GKE variant
  declares **no** `service_url_env_var_name` variable — `App_GKE`
  unconditionally injects the computed URL as `GKE_SERVICE_URL`, and the
  entrypoint applies `URL="${CLOUDRUN_SERVICE_URL:-${GKE_SERVICE_URL:-}}"`
  only **if `URL` isn't already set**. So a fresh deploy fills `URL` in
  automatically from the external LoadBalancer IP (or `https://<domain>`
  once `application_domains` is set) — no manual `URL` override needed
  unless forcing a hostname ahead of DNS/cert provisioning.
- **OIDC placeholders — operator must configure post-deploy.**
  `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_AUTH_URI`, `OIDC_TOKEN_URI`,
  `OIDC_USERINFO_URI` ship blank (`OIDC_DISPLAY_NAME`/`OIDC_SCOPES` are
  pre-filled). Set them via `environment_variables`, or preferably bind
  `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` as `secret_environment_variables`
  (see [Section 6](#6-configuration-pitfalls--sensible-defaults)). Register
  `<URL>/auth/oidc.callback` on the **same host** as `URL`.
- **Health probes.** Startup: **HTTP** `GET /`, 60s initial delay, 10s
  period, failure threshold 6 (~120s budget). Liveness: **HTTP** `GET /`,
  60s initial delay, 30s period, failure threshold 3 — the generous delay
  covers the migration run on first boot. `FORCE_HTTPS` is forced to
  `"false"` by `Outline_Common` so these HTTP probes aren't 301-redirected
  to a `:443` with no listener behind the default plain-HTTP LoadBalancer.
- **Scaling constraints.** `min_instance_count = 1`, `max_instance_count =
  3` by default. Because `enable_nfs = true`, rollouts use the `Recreate`
  strategy — all replicas are stopped before the new ones start, so expect a
  short full outage on every redeploy (not a rolling, zero-downtime one).
- **Inspect the init job and running config:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E '^(URL|OIDC_|REDIS_|DATABASE_URL)'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform
(matching the `{{UIMeta group=N}}` tags in `variables.tf`). Only settings
specific to or notable for Outline are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `outline` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `outlinewiki/outline` image tag used as the custom-build base. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_port` | `3000` | Outline's Node.js server listens on 3000. |
| `container_resources.cpu_limit` / `.memory_limit` | `1000m` / `2Gi` | 1 vCPU / 2 GiB minimum recommended. |
| `min_instance_count` / `max_instance_count` | `1` / `3` | Higher default ceiling than most modules — Outline supports multi-replica via Redis coordination. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar (loopback `127.0.0.1:5432`) — required on GKE. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | (see [Outline_Common](Outline_Common.md)) | Pre-populated with `PGSSLMODE`, `FORCE_HTTPS=false`, `FILE_STORAGE*`, and blank `OIDC_*` placeholders; **set the auth provider and, optionally, `URL` here.** |
| `secret_environment_variables` | `{}` | Secret Manager references injected via SecretSync; use for `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` instead of plain text. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the Outline UI; plain HTTP by default. |
| `workload_type` | `null` → `Deployment` | Deployment, `Recreate` strategy (NFS-backed). |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Required for uploaded files to persist and be shared across replicas. |
| `nfs_mount_path` | `/var/lib/outline/data` | Must match `FILE_STORAGE_LOCAL_ROOT_DIR` set by `Outline_Common`. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | Merged with `Outline_Common`'s own `storage` bucket — two buckets are created; neither is used by the app by default. |
| `gcs_volumes` | `[]` | Not populated by default; Outline uses NFS, not GCS Fuse, for uploads. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Required by Outline** — do not disable. |
| `redis_host` | `""` → NFS server IP | Leave blank to use the co-hosted Redis on the NFS VM; set for an external Memorystore instance. |
| `redis_port` | `6379` | Redis port. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PostgreSQL only — Outline's migrations and `pg_trgm` extension assume Postgres. |
| `application_database_name` | `outline` | Database name. Immutable after first deploy. |
| `application_database_user` | `outline` | Application database user; password auto-generated in Secret Manager. |
| `postgres_extensions` | `["pg_trgm"]` | Required for Outline's full-text document search. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisions an Ingress; needed for real (non-nip.io) TLS. |
| `application_domains` | `[]` | Setting a real hostname here (plus a cert) is what actually gets `service_url`/`URL` onto `https://` — see [Section 6](#6-configuration-pitfalls--sensible-defaults). |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

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
| `service_url` | URL to reach Outline (also injected into the container as `GKE_SERVICE_URL`). |
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
> values *and combinations* at plan time — a `StatefulSet` forced alongside a
> stateless setting, IAP with no authorized identities, `quota_memory_*`
> given as bare integers, an out-of-range `container_port`/
> `backup_retention_days`. Invalid configuration fails the **plan** with a
> clear, named error before any resource is created, so most mistakes below
> are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Outline's Sequelize migrations and `pg_trgm` search extension assume Postgres; a non-Postgres engine breaks the schema and search. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all documents. |
| `SECRET_KEY` (auto-generated) | Never change | Critical | Rotating it invalidates every existing session cookie and any data encrypted at rest with the old key. |
| `URL` / auto-injected `GKE_SERVICE_URL` | Left unset (auto) or explicitly the real public URL | Critical | If it resolves to the wrong host, Outline's OIDC `redirect_uri` won't match what's registered with the IdP, and/or zero providers register — unusable login page. |
| HTTPS in front of the Service | Configure `enable_custom_domain` + `application_domains` + TLS before enabling auth | Critical | Passport sets the OAuth `state` cookie `secure: true`; over the default plain-HTTP L4 LoadBalancer, `/auth/<provider>` returns `500 — Cannot send secure cookie over unencrypted connection`. The landing page loads fine, masking the real cause. |
| `enable_redis` | `true` | Critical | Outline requires Redis even at a single replica; disabling it breaks realtime/session coordination and the app will not function correctly. |
| `enable_nfs` | `true` | High | Disabling it makes uploaded files ephemeral — lost on pod recreation — and breaks sharing across replicas. |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` moved from plain to secret-backed | Set only in `secret_environment_variables`; remove from `environment_variables` in the same apply | High | These ship as **plain empty-string env vars**. Unlike Cloud Run's imperative `gcloud run services update` (which needs a `--remove-env-vars` step first, erroring "already set with a different type"), GKE's switch is declarative — `tofu apply` renders the whole desired `env` list in one pass. But leaving the key in **both** maps at once puts **two `env` entries of the same name** in the Pod spec (one `value`, one `valueFrom.secretKeyRef`); Kubernetes accepts this, but which value the process observes is unverified here — remove the plain-text key when adding the secret-backed one. <!-- TODO: verify observed env precedence for a duplicate plain+secret env name on this cluster's container runtime --> |
| `max_instance_count` with `enable_nfs = true` | Understand the `Recreate` trade-off | High | Every redeploy stops **all** running replicas (not just a surge pod) before starting the replacement set — a brief full outage on every update, worse than the single-replica case in most other NFS-backed modules. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS, the registered OIDC redirect URI, and `URL`. |
| `uptime_check_config.enabled` | `false` by default | Medium | No automatic outage alerting until you turn it on — sensible to leave off until HTTPS/auth are configured, since the app is expected to be unusable (crashlooping or 500 on login) until then. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Outline-specific application configuration shared
with the Cloud Run variant — the auto-generated secrets, default
environment variables, `entrypoint.sh`/`Dockerfile`, and the `db-init` job —
is described in **[Outline_Common](Outline_Common.md)**.
