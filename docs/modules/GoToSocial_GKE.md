---
title: "GoToSocial on GKE Autopilot"
description: "Configuration reference for deploying GoToSocial on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# GoToSocial on GKE Autopilot

GoToSocial is a lightweight, self-hosted ActivityPub/Fediverse server — a
small alternative to Mastodon, written as a single static Go binary. This
module deploys GoToSocial on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services GoToSocial uses and how to explore
and operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

GoToSocial runs as a single Go binary workload on GKE Autopilot, deployed
directly from the official `docker.io/superseriousbusiness/gotosocial` image
— no custom build. The deployment wires together a focused set of Google
Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Go binary pods on port 8080, 2 vCPU / 4 GiB by default; **`max_instance_count` hard-fixed at 1** |
| Database | Cloud SQL for PostgreSQL 15 | Required — fixed at `POSTGRES_15`; MySQL not supported. Database created with mandatory `LC_COLLATE='C' LC_CTYPE='C'` collation |
| Object storage | Cloud Storage | A `storage` bucket + dedicated HMAC service account, consumed unconditionally via GoToSocial's native S3-compatible client — no GCS FUSE mount |
| Secrets | Secret Manager | Auto-generated `SUPERUSER_PASSWORD`, S3 HMAC access/secret key pair; database password. Projected via the Secret Store CSI driver |
| Ingress | Cloud Load Balancing / Gateway API | `LoadBalancer` Service by default; static IP reserved by default |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 with `C` collation is mandatory.** `database_type =
  "POSTGRES_15"` is the default, and `GoToSocial_GKE`'s `validation.tf`
  rejects any non-Postgres `database_type` at plan time. The `db-init` job
  additionally creates the database with `LC_COLLATE='C' LC_CTYPE='C'` —
  GoToSocial refuses to start against any other collation.
- **Prebuilt image, not custom.** `container_image_source = "prebuilt"`
  deploys `docker.io/superseriousbusiness/gotosocial` directly. No entrypoint
  wrapper is needed — configuration is entirely through discrete `GTS_*` env
  vars the binary reads natively.
- **No migrate job.** GoToSocial creates and upgrades its own schema
  automatically on every start; `db-init` only prepares the C-collation
  database and role.
- **`max_instance_count` is hard-fixed at 1.** GoToSocial's in-process cache
  has no cross-instance synchronization; upstream does not support multiple
  instances against the same database/storage. `min_instance_count = 0`
  (scale-to-zero) is safe.
- **Cloud SQL is reached through the cloud-sql-proxy sidecar loopback —
  `GTS_DB_TLS_MODE = "disable"` is correct on GKE**, unlike Cloud Run (see
  the CloudRun guide's TLS-mode explanation). `App_GKE`'s
  `db_host_env_var_name` implementation prefers `127.0.0.1` when the sidecar
  is present, so `GoToSocial_Common`'s Common-layer default is used
  unmodified — `GoToSocial_GKE`'s `module_env_vars` local is empty.
- **No GCS FUSE mount.** Media/avatar/attachment storage uses GoToSocial's
  native S3-compatible client pointed at GCS's S3-interop XML endpoint via a
  dedicated HMAC service account — not a filesystem mount.
- **Health probes are TCP, not HTTP.** GoToSocial's `/readyz`/`/livez`
  endpoints reject any request lacking a `User-Agent` header with an
  anti-scraper `418` response — Kubernetes' built-in HTTP prober never sends
  one. Both `startup_probe` and `liveness_probe` are TCP against port 8080.
- **The admin account is created best-effort automatically, but not
  guaranteed.** Unlike Cloud Run, GKE's looser initialization-job ordering
  gives the `admin-create` job's retry loop a real chance to win the race
  against the main pod's boot — but it can still lose. See §3.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the GoToSocial workload

- **Console:** Kubernetes Engine → Workloads → select the GoToSocial workload
  for pods, revisions, and events. Kubernetes Engine → Services & Ingress
  shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector="app.kubernetes.io/name=gotosocial" 2>/dev/null \
    || kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

GoToSocial stores all application data (accounts, statuses, follows, media
metadata) in a managed Cloud SQL for PostgreSQL 15 instance, created with the
mandatory `C` collation by the `db-init` job. Pods reach it through the
**cloud-sql-proxy sidecar** on `127.0.0.1`; no public IP is exposed.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~gotosocial"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and password secret are in the
[Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the connection model,
backups, and password rotation.

### C. Cloud Storage — media, avatars, attachments

A dedicated **Cloud Storage** bucket (suffix `storage`) and a service account
holding an **HMAC key** are provisioned automatically, granting the storage
SA `roles/storage.objectAdmin` on the bucket. GoToSocial writes to this
bucket unconditionally from first boot — `GTS_STORAGE_BACKEND=s3` is not
optional.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~gotosocial"
  ```

See [App_GKE](App_GKE.md) for GCS Fuse (not used here) and CMEK options.

### D. Secret Manager

GoToSocial's main container reads `GTS_STORAGE_S3_ACCESS_KEY` and
`GTS_STORAGE_S3_SECRET_KEY` as secret-backed environment variables (projected
via the Secret Store CSI driver); `SUPERUSER_PASSWORD` is only consumed by
the `admin-create` job. The database password is managed separately by the
foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~gotosocial"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation,
and [GoToSocial_Common](GoToSocial_Common.md) §2 for why these secrets flow
through `secret_ids`/`module_secret_env_vars`, not the per-app config
object's (dead) `secret_environment_variables` field.

### E. Networking & ingress

`service_type = "LoadBalancer"` and `reserve_static_ip = true` are both
defaults — **keep `reserve_static_ip = true`**: without a reserved static
IP, `GKE_SERVICE_URL` can fall back to an unreachable internal
`*.svc.cluster.local` hostname before the ephemeral LoadBalancer IP is known
at the moment Terraform renders the Deployment's env vars (a documented,
reproducible fleet-wide race, not specific to GoToSocial).

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to
Cloud Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. GoToSocial Application Behaviour

- **First-deploy database setup.** The `db-init` job runs
  `scripts/db-init.sh` using `postgres:15-alpine`. It waits for Cloud SQL to
  accept connections, then idempotently creates the application role and the
  database with `LC_COLLATE='C' LC_CTYPE='C'`, grants privileges, and signals
  the cloud-sql-proxy sidecar to shut down (`POST
  http://127.0.0.1:9091/quitquitquit`) so the Job completes. Safe to re-run
  (`execute_on_apply = true`, `max_retries = 3`).
- **No separate migrate job.** GoToSocial migrates its own schema
  automatically on every server start.
- **The admin account is best-effort automatic — but confirm it, don't
  assume it.** GoToSocial has no web-based sign-up flow and no REST endpoint
  for the very first account. Confirmed live: the CLI panics with
  `NewSignup: instance application not yet created, run the server at least
  once before creating users` unless the main server has already booted
  successfully once. On GKE, `execute_on_apply` only controls whether
  **Terraform waits** for a job (`App_GKE/jobs.tf`:
  `wait_for_completion = try(execute_on_apply, true)`) — the underlying Job
  pod is still scheduled immediately, racing the main Deployment's first
  pod. `admin-create.sh` retries up to 20 times at 15-second intervals to
  absorb this race and often wins during the same `apply` — but it is not
  guaranteed. Verify the account exists (Task 2 in the lab) and re-trigger
  manually if it does not:
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<admin-create-job-name>
  kubectl create job --from=job/<admin-create-job-name> <admin-create-job-name>-retry -n "$NAMESPACE"
  ```
  Retrieve the generated password:
  ```bash
  SECRET=$(gcloud secrets list --project "$PROJECT" --filter="name~superuser-password" --format="value(name)")
  gcloud secrets versions access latest --secret="$SECRET" --project "$PROJECT"
  ```
- **Orphaned account row — a real, recurring failure mode, not a one-off.**
  If an `admin-create` attempt fails partway through (the common case: it
  raced the server's boot and lost mid-flow, or was interrupted), GoToSocial's
  `NewSignup` flow can leave the `accounts` table row inserted without the
  matching `users` row (it inserts the account first, then panics on the
  user-row step if the instance application doesn't exist yet). A retry then
  fails confusingly: `IsUsernameAvailable` reports "already in use" (the
  orphaned account row exists), but `GetAccountByUsernameDomain`/
  `GetUserByAccountID` (used by both a further `create` retry and
  `admin account promote`) find nothing, panicking with
  `sql: no rows in result set` — a symptom that looks like a completely
  different bug. **Fix:** connect to the database directly (e.g. a one-off
  `postgres:15-alpine` debug pod on GKE, using the DB credentials from Secret
  Manager) and run:
  ```sql
  SELECT id, username, domain FROM accounts WHERE username='<username>';
  DELETE FROM account_settings WHERE account_id='<the id above>';
  DELETE FROM account_stats WHERE account_id='<id>';
  DELETE FROM accounts WHERE id='<id>';
  ```
  then retry `admin-create` cleanly. This can recur on any deploy where the
  first attempt races the boot and loses — see Task 5 of the lab for the
  full walkthrough.
- **Health path — TCP only, and why `curl` needs a `User-Agent`.** GoToSocial
  serves real, unauthenticated `/readyz` (DB `SELECT`, 500 on failure) and
  `/livez` (cheap 200) endpoints, but both reject any request without a
  `User-Agent` header with a `418 I'm a teapot` response — confirmed live.
  Kubernetes' HTTP prober never sends one, so both `startup_probe` and
  `liveness_probe` stay TCP against port 8080. Every manual verification
  command needs an explicit `-A`/`--user-agent` flag:
  ```bash
  curl -A "gotosocial-check/1.0" -s "http://${EXTERNAL_IP}/readyz"
  ```
- **Storage IAM propagation.** GoToSocial panics on boot if it cannot reach
  its S3 storage backend. The storage SA's `roles/storage.objectAdmin` grant
  is wired against the Foundation's own `storage_buckets` output (not a
  whole-module `depends_on`, which would deadlock) — but a fresh first
  deploy can still see the very first pod boot race the IAM grant's ~1–2
  minute propagation delay, producing a brief `Access Denied` crash-loop that
  self-resolves.
- **Inspect the init jobs and running config:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'GTS_HOST|GTS_STORAGE|GTS_DB'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for GoToSocial are listed; every other input
is inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `gotosocial` | Base name for resources. Must be lowercase. Do not change after first deploy. |
| `application_display_name` | `GoToSocial` | Human-readable name shown in the Console. |
| `application_description` | `GoToSocial — a lightweight, self-hosted ActivityPub/Fediverse server, on GKE Autopilot` | Workload description field. |
| `application_version` | `latest` | Docker Hub image tag. |
| `host` | `gotosocial.local` | `GTS_HOST` — the public domain. Baked into every ActivityPub URI at creation time, **immutable after first boot**. Set your real domain before production. |
| `account_domain` | `""` | `GTS_ACCOUNT_DOMAIN` — optional vanity handle domain, separate from `host`. Defaults to `host` when empty. Same immutability risk. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Deploys the official Docker Hub image directly — no custom build needed. |
| `min_instance_count` | `0` | Scale-to-zero is safe — GoToSocial's single-instance constraint is about concurrency, not warmth. |
| `max_instance_count` | `1` | **Hard architectural ceiling** — GoToSocial's in-process cache has no cross-instance synchronization. Do not raise. |
| `container_port` | `8080` | GoToSocial's native `GTS_PORT` default. Must match the probe ports, or the pod never becomes Ready. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | Per-pod CPU/memory. |
| `enable_cloudsql_volume` | `true` | Runs the cloud-sql-proxy sidecar — GoToSocial connects over its `127.0.0.1` loopback. |

### Group 5 — Environment Variables & Secrets

Standard `App_GKE` behaviour — see [App_GKE](App_GKE.md).

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Public-facing app — leave `LoadBalancer`. |
| `workload_type` | `null` (resolves to `Deployment`) | GoToSocial does not need a StatefulSet PVC — media lives in GCS via the S3 client. |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, `/readyz` (informational path only), `initial_delay_seconds=15`, `failure_threshold=10` | The only probe type that works against GoToSocial's User-Agent-gated health endpoints. |
| `liveness_probe` | TCP, `/livez`, `initial_delay_seconds=30`, `failure_threshold=3` | Same reasoning as `startup_probe`. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, various | Foundation-level structured probes; superseded by `startup_probe`/`liveness_probe` above for this module. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisions Filestore. **Not used by GoToSocial** — media storage is via the native S3 client, not a mount. |

### Group 14 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | one generic `data` bucket (overridden) | `main.tf` supplies the actual `storage` bucket via `GoToSocial_Common`'s output, consumed unconditionally from first boot — not opt-in like some other apps' S3 buckets. |
| `gcs_volumes` | `[]` | No GCS Fuse volumes mounted by default. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | GoToSocial has no Redis dependency at all — its cache is in-process. Leave `false`. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | **Plan-validated** — `validation.tf` rejects anything but PostgreSQL 13/14/15 or `NONE`. |
| `application_database_name` | `gotosocial` | The database actually created (with `C` collation) and injected as `GTS_DB_DATABASE`. |
| `application_database_user` | `gotosocial` | The role actually created and injected as `GTS_DB_USER`; password auto-generated in Secret Manager. |
| `db_host_env_var_name` / `db_port_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_password_env_var_name` | `GTS_DB_ADDRESS` / `GTS_DB_PORT` / `GTS_DB_USER` / `GTS_DB_DATABASE` / `GTS_DB_PASSWORD` | **Set by `main.tf`, not left at their generic-empty variable defaults** — the mechanism that lets the GoToSocial binary read the Foundation's DB connection info. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisions a Gateway by default. |
| `application_domains` | `[]` | If empty, a `nip.io`-style hostname based on the reserved static IP is used. |
| `reserve_static_ip` | `true` | **Keep `true`** — see §2E for the internal-DNS race this avoids. |

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
| `service_external_ip` | External LoadBalancer IP (reserved by default). |
| `service_url` | URL to reach GoToSocial. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (`127.0.0.1` via the Auth Proxy sidecar) / port. |
| `storage_buckets` | Created Cloud Storage buckets (the `storage` media bucket). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup (`db-init`, `admin-create`) and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details (repo, trigger, registry). |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time. `GoToSocial_GKE`'s own `validation.tf` additionally blocks `min_instance_count > max_instance_count`, `enable_redis = true` with neither `redis_host` nor `enable_nfs`, `database_type` away from PostgreSQL, `enable_iap = true` without both OAuth credentials, and `enable_cloudsql_volume = true` with `database_type = "NONE"`.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `host` (`GTS_HOST`) | Set your real domain before first deploy | Critical | Baked into every ActivityPub actor/object URI at creation time; changing it after real accounts/posts exist breaks federation for everything created under the old value. |
| `max_instance_count` | `1` (do not raise) | Critical | GoToSocial's in-process cache has no cross-instance synchronization; upstream does not support multiple instances against the same database/storage. |
| `database_type` | `POSTGRES_15` | Critical | Plan-time validated by `GoToSocial_GKE`'s own `validation.tf` — MySQL/SQL Server are rejected before apply. |
| `container_port` / probe ports | `8080` everywhere | Critical | A mismatch makes the probe hit a dead port and the pod never becomes Ready even though the app is healthy. |
| Storage IAM wiring (`google_storage_bucket_iam_member`) | Leave as shipped (references `module.app_gke.storage_buckets["storage"]`) | Critical | GoToSocial panics on boot without S3 access. A `depends_on = [module.app_gke]` alternative would deadlock the Deployment against its own IAM prerequisite. |
| `admin-create` recovery | Follow the orphaned-account-row SQL fix if a retry panics with "no rows" | High | A partially-failed first attempt can leave an orphaned `accounts` row with no matching `users` row; naive retries fail confusingly without the cleanup SQL. |
| Health probes (`startup_probe`/`liveness_probe`) | Leave `type = "TCP"` | High | GoToSocial's `/readyz`/`/livez` reject any request without a `User-Agent` header (`418`); switching to `type = "HTTP"` makes the probe fail forever, since Kubernetes' prober never sends one. |
| `admin-create` job outcome | Verify, don't assume | High | GKE's looser job ordering often lets `admin-create` win its race against the pod's boot automatically, but not always — confirm the account exists before treating the deploy as fully operational. |
| `reserve_static_ip` | `true` (default) | Medium | Without it, `GKE_SERVICE_URL` can fall back to an unreachable internal `*.svc.cluster.local` hostname before the ephemeral LoadBalancer IP is known — a documented fleet-wide race. |
| Manual `curl`/health checks | Always pass `-A "<agent>"` | Medium | Bare `curl` (and most default HTTP clients/monitors) get `418 I'm a teapot` from GoToSocial's anti-scraper User-Agent gate, even on "unauthenticated" endpoints. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `enable_nfs` | `true` (default) or `false` if not needed | Low | Filestore is billed whether or not the app writes to it; GoToSocial does not use the NFS mount at all in its default configuration. |
| `enable_redis` | `false` (default) | Low | GoToSocial has no Redis dependency; leaving this `true` has no functional effect. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. GoToSocial-specific application configuration
shared with the Cloud Run variant (secrets, the `db-init`/`admin-create`
jobs, and the storage service account) is described in
**[GoToSocial_Common](GoToSocial_Common.md)** (module source:
`modules/GoToSocial_Common`).
