---
title: "Tandoor on GKE Autopilot"
description: "Configuration reference for deploying Tandoor on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Tandoor on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Tandoor_GKE.png" alt="Tandoor on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Tandoor Recipes is an open-source, AGPL-3.0-licensed self-hosted recipe manager
and meal planner with a Python/Django REST API backend and a bundled Vue 3
frontend. This module deploys Tandoor on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Tandoor uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Tandoor runs as a single all-in-one web workload — nginx runs *inside* the
container and proxies to gunicorn over a Unix socket, so no sidecar or
`additional_services` entry is needed. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Single-container pods (nginx + gunicorn), 1 vCPU / 512Mi by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Tandoor has no supported production fallback engine |
| Object storage | Cloud Storage | A dedicated `data` bucket provisioned automatically (for recipe images), not auto-mounted |
| Cache | Redis (optional) | Genuinely optional — Django falls back to local-memory cache when unset; no Celery/background worker |
| Secrets | Secret Manager | Auto-generated Django `SECRET_KEY` and initial superuser password; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** `Tandoor_Common` fixes `database_type =
  "POSTGRES_15"` and `DB_ENGINE = django.db.backends.postgresql`. Tandoor's
  `boot.sh` polls `pg_isready` before proceeding — no lazy-connect.
- **Discrete Postgres env vars, not a DSN.** Tandoor reads `POSTGRES_USER` /
  `POSTGRES_PASSWORD` / `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB`
  directly. The platform's standard `DB_*` values are aliased onto these names
  via the `db_*_env_var_name` Foundation variables — on GKE this resolves to
  the Cloud SQL Auth Proxy sidecar's `127.0.0.1` loopback.
- **`SECRET_KEY` and the superuser password are generated automatically** and
  stored in Secret Manager. `SECRET_KEY` must never be rotated after first
  boot without a maintenance window.
- **No fixed/hardcoded admin credential.** Unlike this catalogue's other
  recipe-manager module (Mealie), Tandoor has a `create-superuser` init job
  that bootstraps a real, unique credential from Secret Manager on every
  deployment.
- **`service_type = LoadBalancer` and a reserved static IP by default.**
  Tandoor is a browser-driven interactive UI, so it gets a real external IP
  — not `ClusterIP` (which is only appropriate for internal-only services).
- **NFS is disabled by default.** Tandoor stores all application data in
  PostgreSQL and recipe images in an (optional) GCS-mounted bucket.
- **Redis is genuinely optional and disabled by default.** There is no Celery
  worker or queue to keep warm — enabling Redis only affects Django's cache
  backend.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Tandoor workload

Tandoor pods are scheduled on Autopilot, which bills for the CPU/memory the
pods actually request. Horizontal Pod Autoscaling sizes the deployment
between the minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Tandoor workload to
  see pods, revisions, and events. Kubernetes Engine → Services & Ingress
  shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Tandoor stores all application data (recipes, meal plans, shopping lists,
users) in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it
privately through the **Cloud SQL Auth Proxy** sidecar over a Unix socket. On
first deploy an initialization Job creates the application database and
user, and a second job bootstraps the superuser account.

- **Console:** SQL → select the instance for connections, backups, flags, and
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding
the password are all surfaced in the [Outputs](#5-outputs). For the
connection model, automated backups, and password rotation, see
[App_GKE](App_GKE.md).

### C. Cloud Storage

A dedicated **Cloud Storage** `data` bucket is provisioned automatically for
recipe images. The workload service account is granted access, but the
bucket is **not** auto-mounted — add a `gcs_volumes` entry targeting
`/opt/recipes/mediafiles` to persist uploaded images across pod restarts.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Redis (optional cache)

Redis is **disabled by default**. Tandoor has no Celery worker or background
queue — enabling Redis only switches Django's cache backend from
local-memory to a shared Redis instance.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm REDIS_HOST injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS_HOST
  ```

### E. Secret Manager

Two application secrets are generated automatically and stored in Secret
Manager: the Django `SECRET_KEY` and `DJANGO_SUPERUSER_PASSWORD`. The database
password is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=secret-<prefix>-tandoor-superuser-password --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing
IP with a reserved static address. A custom domain with a Google-managed
certificate can be enabled.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to
Cloud Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Tandoor Application Behaviour

- **First-deploy database setup.** The `db-init` initialization Job
  idempotently creates the application database and user and grants
  privileges. The job is safe to re-run.
- **Superuser bootstrap.** The `create-superuser` init job depends on
  `db-init`. It applies Django migrations (idempotent — a safety net, since
  GKE's `execute_on_apply` only gates whether Terraform *waits* for the job,
  not whether the underlying pod is scheduled before the main Deployment's
  own first boot) and then runs `python manage.py createsuperuser --noinput`,
  reading `DJANGO_SUPERUSER_USERNAME` / `DJANGO_SUPERUSER_EMAIL` /
  `DJANGO_SUPERUSER_PASSWORD` from the environment. It checks for an existing
  account first, so re-applying the module does not error out.
- **Migrations on every start.** Tandoor's own `boot.sh` applies Django
  migrations on every container start (idempotent).
- **`SECRET_KEY` is immutable after first boot.** Rotating it invalidates all
  active sessions and any in-flight signed tokens.
- **Health path.** The startup probe targets `/accounts/login/` — Django's
  public, unauthenticated login view. The liveness probe uses a plain TCP
  (port-listening) check instead, so a transient DB hiccup doesn't flap an
  already-healthy pod.
- **Log in with the generated credential.** Retrieve
  `DJANGO_SUPERUSER_PASSWORD` from Secret Manager and log in at
  `/accounts/login/` with the configured `admin_username` (default `admin`).

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Tandoor are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_deployment_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `tandoor` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Tandoor publishes a genuine `latest` tag. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Tandoor uses the official image directly. |
| `container_image` | `""` | Leave empty for the module default (`vabene1111/recipes`). |
| `min_instance_count` | `0` | Minimum replicas. |
| `max_instance_count` | `1` | Maximum replicas. |
| `container_port` | `80` | Tandoor's nginx listens on port 80. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |
| `enable_image_mirroring` | `true` | Mirror the Tandoor image into Artifact Registry before deployment. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `DB_ENGINE`, `ALLOWED_HOSTS`, `PGSSLMODE`, `DJANGO_SUPERUSER_USERNAME`/`EMAIL` are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Tandoor is an interactive web UI, so it is exposed externally by default. |
| `workload_type` | `Deployment` | Stateless — no PVC needed. |
| `session_affinity` | `None` | No sticky-session requirement (unlike WebSocket-heavy apps). |
| `termination_grace_period_seconds` | `30` | Seconds to wait after SIGTERM before SIGKILL. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |

### Group 7 — Backup & Maintenance / StatefulSet

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise for production/compliance. |
| `stateful_pvc_enabled` | `null` | Not needed — Tandoor is stateless (all data in Postgres + optional GCS). |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Create a Kubernetes ResourceQuota in the application namespace. |
| `quota_cpu_requests` / `quota_cpu_limits` | `""` | Total CPU requests/limits allowed across all pods. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Must use binary unit suffixes (e.g. `4Gi`, `8192Mi`) — bare integers are treated as bytes and block scheduling. |

### Group 9 — Reliability Policies & Custom SQL

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |
| `enable_custom_sql_scripts` | `false` | Run SQL from a GCS bucket after provisioning. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/accounts/login/` | Passes once Postgres connectivity and migrations succeed. |
| `health_check_config` | TCP | A plain port-listening check. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Storage & Jobs

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` + `create-superuser` job pair. |
| `cron_jobs` | `[]` | Not used — Tandoor has no platform-scheduled recurring tasks. |
| `additional_services` | `[]` | Not needed — no sidecar/nginx-router required. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is off by default. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Create additional GCS buckets beyond the auto-provisioned `data` bucket. |
| `storage_buckets` | `[]` | Additional buckets to provision. |
| `gcs_volumes` | `[]` | Add an entry mounted at `/opt/recipes/mediafiles` via the CSI driver to persist recipe images. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` | `7` | Maximum recent Artifact Registry images to keep. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed by `Tandoor_Common`; not forwarded. |
| `application_database_name` | `tandoor` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `tandoor` | Application database user. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `db_host_env_var_name` | `POSTGRES_HOST` | Tandoor's Postgres host env var name. |
| `db_user_env_var_name` | `POSTGRES_USER` | Tandoor's Postgres user env var name. |
| `db_password_env_var_name` | `POSTGRES_PASSWORD` | Tandoor's Postgres password env var name. |
| `db_name_env_var_name` | `POSTGRES_DB` | Tandoor's Postgres database env var name. |
| `db_port_env_var_name` | `POSTGRES_PORT` | Tandoor's Postgres port env var name. |
| `admin_username` | `admin` | Initial superuser username. |
| `admin_email` | `admin@techequity.cloud` | Initial superuser email. |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |

### Group 17 — Backup Import

| Variable | Default | Description |
|---|---|---|
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore from a backup on deploy. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys — recommended for any web-facing app. |

### Group 21 — Redis & Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `enable_cdn` | `false` | Enable Cloud CDN on the GKE Ingress backend. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way
to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Tandoor. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of the setup jobs (`db-init`, `create-superuser`). |
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
> values *and combinations* at plan time. Invalid configuration fails the
> **plan** with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `SECRET_KEY` (auto-generated) | Never rotate after first boot | Critical | Rotating it invalidates all active sessions and any signed tokens (e.g. password-reset links) in flight. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_file` fails the import job. |
| `startup_probe_config` path | `/accounts/login/` | Critical | Tandoor has no other unauthenticated health endpoint; pointing the probe elsewhere returns 401/403 and the pod never becomes Ready. |
| `service_type` | `LoadBalancer` | High | `ClusterIP` (the copy-paste bug found fleet-wide on many earlier modules) makes an interactive web app unreachable from a browser. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity. |
| `DJANGO_SUPERUSER_PASSWORD` (auto-generated) | Retrieve from Secret Manager before first login | Medium | Without retrieving it, you cannot log in — there is no fallback credential like Mealie's fixed default. |
| `db_ssl_mode` (`PGSSLMODE`, set internally) | `prefer` on GKE | Low | The Cloud SQL Auth Proxy sidecar loopback is already plaintext; this module's Common layer defaults correctly, so this should not need manual attention. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict all pods simultaneously during maintenance. |
| `reserve_static_ip` | `true` | Medium | Without it, the LoadBalancer IP can change on redeploy, breaking bookmarked URLs. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Tandoor-specific application configuration shared
with the Cloud Run variant is described in
**[Tandoor_Common](Tandoor_Common.md)**.
