---
title: "Healthchecks on GKE Autopilot"
description: "Configuration reference for deploying Healthchecks on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Healthchecks on GKE Autopilot

Healthchecks is an open-source, self-hosted cron job and heartbeat monitoring
service: scheduled tasks "ping" it on success, and it alerts you by email,
Slack, SMS, or any of 100+ other integrations when a ping is late or missing.
This module deploys Healthchecks on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared
Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Healthchecks uses and how to explore
and operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Healthchecks runs as a Django/uWSGI Pod. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | uWSGI pod, 1 vCPU / 512 MiB by default, single replica |
| Database | Cloud SQL for PostgreSQL 15 | Required — the `DB` env var is explicitly set to `postgres`, overriding the image's SQLite fallback |
| Secrets | Secret Manager | Auto-generated `SECRET_KEY` and initial admin password; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP by default |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory**, and `DB = "postgres"` is set explicitly. The
  upstream image otherwise silently falls back to a throwaway, container-local
  SQLite database with no error.
- **The container image is genuinely prebuilt** (`healthchecks/healthchecks`) —
  `container_image_source` defaults to `"prebuilt"`, verified both in its own
  default AND in the `main.tf` forward (a module that gets either one wrong
  either builds from a non-existent Dockerfile or silently deploys the wrong
  image — see the Prowlarr_GKE precedent in this catalogue).
- **No scale-to-zero needed on GKE.** Unlike the Cloud Run variant, a GKE
  Deployment simply runs its configured replica count continuously, so the
  co-located `sendalerts`/`sendreports` alert loop is always live with zero
  extra configuration — there is no GKE equivalent of `cpu_always_allocated`.
- **No dedicated health endpoint.** Startup/liveness probes target `/` (the
  public login page). `ALLOWED_HOSTS = "*"` is set so the kubelet's own internal
  probe Host header is never rejected by Django's host validation.
- **The initial admin account is seeded once**, not self-healing. An
  `admin-bootstrap` init Job runs migrations and creates the superuser
  (`admin_email` / a generated Secret Manager password) via Django's stock
  `createsuperuser --noinput`. Because GKE's init-job ordering is not as strict
  as Cloud Run's (a job can be scheduled before the main Deployment's own first
  boot), the job runs its own migration first rather than assuming the schema
  already exists.
- **Outbound email is a placeholder by default.** `DEFAULT_FROM_EMAIL` defaults
  to `healthchecks@example.org`. Configure real `EMAIL_HOST`/`EMAIL_HOST_USER`/
  `EMAIL_HOST_PASSWORD` post-deploy or alerts will fail to actually deliver.
- **No Redis, no object storage.** Healthchecks stores all state — checks,
  pings, users, alert configuration — in PostgreSQL alone.
- **`service_type = LoadBalancer` and `reserve_static_ip = true`** — Healthchecks
  is a browser-facing web UI, so it gets a stable public IP by default.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Healthchecks workload

Healthchecks runs as a single-replica Deployment on Autopilot, which bills for
the CPU/memory the pod actually requests.

- **Console:** Kubernetes Engine → Workloads → select the Healthchecks workload
  for pods, revisions, and events. Kubernetes Engine → Services & Ingress shows
  the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for Autopilot scheduling and the workload type
(Deployment vs StatefulSet).

### B. Cloud SQL for PostgreSQL 15

Healthchecks stores all application data (checks, pings, integrations, users,
alert history) in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it
privately through the **Cloud SQL Auth Proxy** sidecar over `127.0.0.1`. On
first deploy, initialization Jobs create the application database/role and seed
the initial admin account.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding
the password are all surfaced in the [Outputs](#5-outputs). For the connection
model, automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Secret Manager

Two cryptographic values are generated automatically and stored in Secret
Manager: `SECRET_KEY` (Django session/CSRF signing key) and `ADMIN_PASSWORD`
(the initial superuser password, seeded once). The database password is managed
separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~healthchecks"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### D. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP,
reserved as a static IP so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains and static IP details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr (including the co-located `sendalerts`/`sendreports`
background workers) flow to Cloud Logging; GKE and Cloud SQL metrics flow to
Cloud Monitoring.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Healthchecks Application Behaviour

- **First-deploy database setup.** The `db-init` initialization Job runs using
  `postgres:15-alpine`, connecting through the Cloud SQL Auth Proxy to
  idempotently create the application role and database.
- **Admin account bootstrap.** The `admin-bootstrap` Job (using the Healthchecks
  image itself) runs `manage.py migrate --noinput`, then `manage.py
  createsuperuser --noinput --username admin --email <admin_email>` (password
  from a generated Secret Manager secret). GKE's `execute_on_apply` setting only
  gates whether Terraform *waits* for the job, not whether Kubernetes schedules
  it immediately — so the job replicates the migration step itself rather than
  assuming the main Deployment has already booted and migrated.
- **Database migrations also run on every normal container start** of the main
  Deployment (the image's `uwsgi.ini` has `hook-pre-app = exec:./manage.py
  migrate` built in), so upgrading `application_version` applies schema changes
  automatically.
- **The `sendalerts`/`sendreports` background loop is co-located in the same
  container**, started automatically by the image's own `uwsgi.ini` alongside
  the web server — no separate worker Deployment exists. Because GKE Deployments
  don't scale to zero on their own, this loop runs continuously as long as the
  Deployment has at least one replica (the default).
- **Health path.** Startup and liveness probes target `/` — Healthchecks has no
  dedicated health endpoint; the root login page always responds unauthenticated
  and would 500 (not render) if the database connection were broken.
- **Inspect job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Healthchecks are listed; every other input
is inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `healthchecks` | Base name for resources. Do not change after first deploy. |
| `admin_email` | `admin@techequity.cloud` | Email/username for the initial superuser, seeded once. |
| `default_from_email` | `healthchecks@example.org` | Placeholder sender address until real SMTP is configured. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | The official image needs no custom build. |
| `container_image` | `""` | Leave empty to use `healthchecks/healthchecks:<application_version>`. |
| `container_port` | `8000` | The upstream image's uWSGI server binds here (`docker/uwsgi.ini`). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar — `DB_HOST` resolves to `127.0.0.1`, which the discrete env var accepts verbatim. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Public web UI — exposed externally by default. |
| `workload_type` | `Deployment` | Stateless — all state lives in PostgreSQL. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Not used — Healthchecks needs no shared filesystem. |

### Group 15 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not used — Healthchecks has no documented Redis integration. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixed; MySQL/SQLite are not wired through this module. |
| `application_database_name` | `healthchecks_db` | Immutable after first deploy. |
| `application_database_user` | `healthchecks_user` | Immutable after first deploy. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_external_ip` | External LoadBalancer IP. |
| `service_url` | URL to reach Healthchecks. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `initialization_jobs` | Names of the setup jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `DB` (auto-set) | `"postgres"` | Critical | If somehow unset, the app silently uses a throwaway local SQLite DB — checks and alert history vanish on every restart, with no error. |
| `container_image_source` | `prebuilt` | Critical | Switching to `custom` with no Dockerfile in `Healthchecks_Common/scripts` fails the Kaniko build. |
| `ADMIN_PASSWORD` (auto-generated) | Retrieve once, rotate via UI after | Medium | The seeded password is only set on the FIRST successful `admin-bootstrap` run; re-running the job does not update it. |
| `DEFAULT_FROM_EMAIL` / SMTP vars | Configure real SMTP post-deploy | High | Left at the placeholder default, `sendalerts` logs delivery errors instead of actually notifying anyone of a missed check-in. |
| `ALLOWED_HOSTS` (auto-set to `"*"`) | Leave as-is unless you have a specific reason | Low | Disabling Django's Host header validation entirely is an accepted trade-off here to keep platform health probes working. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for PostgreSQL connectivity on GKE. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Healthchecks-specific application configuration
shared with the Cloud Run variant is described in
**[Healthchecks_Common](Healthchecks_Common.md)**.
