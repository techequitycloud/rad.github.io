---
title: "Wallabag on GKE Autopilot"
description: "Configuration reference for deploying Wallabag on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Wallabag on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Wallabag_GKE.png" alt="Wallabag on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Wallabag is a free, open-source, self-hosted "read it later" article archiving
app — a Pocket alternative. Save articles from a browser extension, bookmarklet,
mobile app, or the REST API, then read them later in a clean, distraction-free
view with full-text search, tagging, annotations, and RSS feeds of your saved
items. This module deploys Wallabag on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Wallabag uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Wallabag runs as a PHP/Symfony pod (nginx + php-fpm under s6-overlay) on GKE
Autopilot. The deployment wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | PHP/Symfony pod, 1 vCPU / 2 GiB by default; single replica by default (GKE has no scale-to-zero) |
| Database | Cloud SQL for MySQL 8.0 | Required — Wallabag_Common fixes the engine; PostgreSQL is not supported |
| Object storage | Cloud Storage | A generic `data` bucket is provisioned, but Wallabag does not read or write it — all content lives in MySQL |
| Secrets | Secret Manager | Auto-generated `APP_SECRET` (Symfony security token); database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, custom domain + managed certificate enabled by default |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed by `Wallabag_Common`;
  selecting any other engine breaks the deployment.
- **`enable_cloudsql_volume = true`.** A Cloud SQL Auth Proxy sidecar listens on
  `127.0.0.1:3306`; `wallabag.tf` additionally pins `DB_HOST = "127.0.0.1"` so the
  wrapper entrypoint always dials the sidecar. The Cloud Run variant instead
  connects over the instance private IP.
- **Single Secret Manager secret.** `APP_SECRET` (a Symfony security token) is
  generated automatically, overriding Wallabag's publicly-known baked-in default.
  There is no separate generated admin-password secret.
- **`min_instance_count = 1`, `max_instance_count = 1` by default.** GKE has no
  scale-to-zero; keep replicas at 1 unless Wallabag's session/cache behaviour
  under multiple pods has been verified.
- **`service_type = LoadBalancer`** with `session_affinity = "ClientIP"`;
  `enable_custom_domain = true` and `reserve_static_ip = true` by default.
- **`enable_nfs` defaults `true` but is functionally unused.** It mounts Cloud
  Filestore NFS at `/var/lib/wallabag`, but Wallabag's image `WORKDIR` is
  `/var/www/wallabag` — nothing writes to the mounted path. Safe to disable.
- **No separate migration job.** Wallabag's own `bin/console wallabag:install`
  handles both schema creation and first-run setup in one idempotent step.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Wallabag workload

Wallabag runs as a single-replica Deployment by default. Autopilot bills for the
CPU/memory the pod actually requests.

- **Console:** Kubernetes Engine → Workloads → select the Wallabag workload for
  pods, events, and logs. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for MySQL 8.0

Wallabag stores all application data (saved articles, tags, users, annotations)
in a managed Cloud SQL for MySQL 8.0 instance. The pod reaches it privately
through a **Cloud SQL Auth Proxy sidecar** listening on `127.0.0.1:3306`. On
first deploy, a `db-init` job creates the application database and user,
followed by `wallabag-install`, which runs Wallabag's own installer to create
the schema.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and the Secret Manager secret holding the
password are all in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the
connection model, automated backups, and password rotation.

### C. Cloud Storage

A generic `data` bucket is provisioned by default (via the Foundation's
`storage_buckets` input), but Wallabag itself never reads or writes it — all
content lives in MySQL, and `gcs_volumes` (which would fuse-mount a bucket into
the pod) is empty by default.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Secret Manager

One secret is generated automatically and stored in Secret Manager: `APP_SECRET`
(materialised under that simple key — GKE's SecretSync CRD rejects `targetKey`
values containing `__`, so the real `SYMFONY__ENV__SECRET` name is aliased at
container start by the wrapper entrypoint rather than being the synced key
itself). The database password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~app-secret"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
with a reserved static IP and a Kubernetes Ingress for custom domains.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Wallabag Application Behaviour

- **Two-stage init chain, not a Laravel-style separate migrate step.**
  `db-init` (`mysql:8.0-debian`) creates the empty application database and user
  and grants privileges. `wallabag-install` then depends on `db-init` and reuses
  the same custom app image (so the wrapper entrypoint's env aliasing still runs)
  with its command overridden to `bin/console wallabag:install --env=prod -n`.
  This single command performs both schema creation *and* first-run setup
  (including seeding the default administrator account) — there is no separate
  migration job to run on upgrades; re-running `wallabag:install` against an
  already-installed database is safe and idempotent.
- **Health check behaviour.** The startup probe is **TCP** on port 80 — it only
  needs nginx to bind, independent of installer progress. The liveness probe is
  **HTTP `GET /`**: an unauthenticated request to the root path returns an
  **HTTP 302 redirect to `/login`**, which Kubernetes' probe semantics treat as
  a passing response (any 2xx–3xx). Do not expect a bare 200 from `/` — a 302
  to `/login` is the expected, healthy result.
  ```bash
  EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
  curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 302
  ```
- **First-run administrator account.** `wallabag:install --env=prod -n` creates
  Wallabag's own default administrator account using Wallabag's documented
  installation defaults (username and password both `wallabag`) — there is no
  Secret Manager secret holding a generated admin password. **Change this
  password immediately after first login.** New accounts cannot self-register
  (`SYMFONY__ENV__FOSUSER_REGISTRATION = "false"`) — create additional users
  from the admin UI or with `kubectl exec ... -- bin/console fos:user:create`.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-or-wallabag-install-job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Wallabag are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the cluster and regional resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `wallabag` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Base image tag for `wallabag/wallabag`. `"latest"` maps to a pinned tag (`2.6.14`) at build time. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `custom` | Builds the wrapper image via Cloud Build. `"prebuilt"` skips the DB/secret-aliasing wrapper entirely. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | GKE has no scale-to-zero; single replica by default. |
| `container_port` | `80` | Wallabag's nginx listens on port 80. |
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Per-pod resource limits. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar on `127.0.0.1`. Keep `true` on GKE. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP by default. |
| `session_affinity` | `ClientIP` | Routes a client's requests to the same pod. |
| `workload_type` | `null` | Auto-resolves to `Deployment` (Wallabag needs no per-pod PVC identity). |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` → `wallabag-install` chain. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | **Functionally unused** — mounted at `/var/lib/wallabag`, but Wallabag's image writes nothing there. Safe to disable. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | Generic bucket. Not read or written by Wallabag. |
| `gcs_volumes` | `[]` | Nothing fuse-mounted into the pod by default. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | resolves to `MYSQL_8_0` | Fixed by `Wallabag_Common`. |
| `application_database_name` / `application_database_user` | `wallabag` | Tenant-prefixed at deploy time. Immutable after first deploy. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `db_password_env_var_name` | `""` (all empty) | **Unused by Wallabag** — the wrapper entrypoint reads the standard `DB_*` vars directly and aliases them onto `SYMFONY__ENV__DATABASE_*` itself. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Kubernetes Ingress with `application_domains`. |
| `reserve_static_ip` | `true` | A stable IP that survives redeploys. |
| `network_tags` | `["nfsserver"]` | Firewall targeting; required for NFS connectivity when `enable_nfs = true`. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Purely optional — only used by Wallabag's asynchronous bulk-import feature. |

Every other input (Group 0 metadata, Group 2 environment, Group 5 secrets,
Group 7 StatefulSet, Group 8 resource quota, Group 9 reliability, Group 10
observability, Group 12 CI/CD, Group 17 backup, Group 18 custom SQL, Group 20
IAP, Group 21 Cloud Armor, Group 22 VPC-SC) behaves exactly as documented in
[App_GKE](App_GKE.md).

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Kubernetes namespace. |
| `service_cluster_ip` / `service_external_ip` | Internal / external IP. |
| `service_url` | Service URL. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` | `127.0.0.1` via the Cloud SQL Auth Proxy sidecar. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `initialization_jobs` | Names of the setup jobs (`db-init`, `wallabag-install`). |
| `kubernetes_ready` | Whether the cluster endpoint is available and all K8s resources are deployed. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time. Invalid configuration fails the **plan** with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| DB driver env var (`SYMFONY__ENV__DATABASE_DRIVER`, hardcoded in `entrypoint.sh`) | must be set explicitly (`pdo_mysql` here) | **Critical** | Wallabag's shipped `parameters.yml` defaults `database_driver` to `pdo_sqlite`. Setting only `SYMFONY__ENV__DATABASE_HOST`/`_PORT`/`_NAME`/`_USER`/`_PASSWORD` with no explicit driver var still silently installs against a throwaway local SQLite file — the install "succeeds," the pod reports Ready, but all data lives in an ephemeral file wiped on every pod restart or redeploy, and MySQL is never touched. No error is raised. **If this module is ever cloned as a template for another Symfony-based application, verify the DB driver env var is set explicitly** — this class of failure is undetectable from the outside; use `kubectl exec` into the pod and check the boot logs (`"Configuring the SQLite database..."` vs. a MySQL connection line) to confirm. See [App_GKE](App_GKE.md) and [App_CloudRun](App_CloudRun.md) for how the Foundation injects DB env vars generically — the app-specific translation and any missing pieces are always the calling module's responsibility. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all saved articles. |
| `APP_SECRET` (auto-generated) | Never hand-edit in Secret Manager after first boot | High | Wallabag uses this as a Symfony security-signing key; changing it invalidates CSRF tokens and any signed URLs already issued. |
| Default administrator credentials (`wallabag` / `wallabag`, seeded by `wallabag:install`) | Change immediately after first login | High | The installer seeds Wallabag's own well-known default credentials — anyone who knows the service URL and the public default can log in until the password is changed. |
| `container_image_source` | `custom` | Critical | Switching to `prebuilt` deploys the stock `wallabag/wallabag` image with no wrapper entrypoint — the DB and secret env-var aliasing never runs, so the pod cannot reach MySQL at all. |
| `enable_cloudsql_volume` | `true` on GKE | Critical | Setting `false` removes the Auth Proxy sidecar the wrapper entrypoint's `DB_HOST = "127.0.0.1"` pin depends on — the pod cannot reach Cloud SQL. |
| `max_instance_count` | `1` unless verified otherwise | High | Scaling beyond 1 pod without verifying Wallabag's session/cache behaviour risks inconsistent user sessions across pods. |
| `enable_nfs` | `false` unless needed for another purpose | Low / cost | Defaults `true` and provisions a Filestore share that Wallabag never uses — a needless recurring cost. |
| `enable_cloud_armor` | enable for production | Medium | The service is publicly reachable without WAF protection by default. |

---

For the foundation behaviour referenced throughout — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and
image mirroring — see **[App_GKE](App_GKE.md)**. Wallabag-specific application
configuration shared with the Cloud Run variant is described in
**[Wallabag_Common](Wallabag_Common.md)**.
