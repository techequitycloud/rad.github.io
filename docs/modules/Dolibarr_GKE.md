---
title: "Dolibarr on GKE Autopilot"
description: "Configuration reference for deploying Dolibarr on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Dolibarr on GKE Autopilot

Dolibarr is a free, open-source ERP and CRM suite covering customers and prospects,
quotes, orders, invoices, products and stock, HR, projects, and accounting through a
modular PHP web UI. This module deploys Dolibarr on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Dolibarr uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and
the deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md)
rather than repeating them here.

---

## 1. Overview

Dolibarr runs as a single PHP/Apache web workload. The deployment wires together a
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | PHP/Apache pods on port 80, 1 vCPU / 2 GiB by default |
| Database | Cloud SQL for MySQL 8.0 | Required — the engine is fixed at `MYSQL_8_0` |
| File persistence | Cloud Filestore (NFS) | Uploaded documents/PDFs persist under `/var/lib/dolibarr`, shared across pods |
| Object storage | Cloud Storage | A `dolibarr-documents` bucket provisioned automatically |
| Secrets | Secret Manager | Auto-generated `DOLI_ADMIN_PASSWORD` and `DOLI_INSTANCE_UNIQUE_ID`; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer with a reserved static IP; optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is mandatory.** The database engine is fixed by the shared application
  layer (the variant passes `database_type = null`, which keeps the Common default
  `MYSQL_8_0`); other engines are not supported.
- **Cloud SQL is reached via the Auth Proxy sidecar on loopback.** The variant sets
  `DB_HOST = 127.0.0.1`; a cloud-sql-proxy sidecar (`enable_cloudsql_volume = true`)
  listens on `127.0.0.1:3306`, and the wrapper entrypoint aliases the injected
  `DB_*` onto `DOLI_DB_*`.
- **Single replica by default.** `min_instance_count = 1`, `max_instance_count = 1`.
  Dolibarr keeps session and lock state; the NFS-backed workload deploys with the
  `Recreate` strategy, so do not scale beyond 1 without verifying shared-storage
  behaviour.
- **NFS is enabled by default** (`enable_nfs = true`, mounted at `/var/lib/dolibarr`)
  so uploaded documents and generated PDFs persist and can be shared across pods.
- **Session affinity is `ClientIP`** so a client's requests reach the same pod.
- **First-boot auto-install.** `DOLI_INSTALL_AUTO = 1` makes the Dolibarr installer
  create the schema on first start; there is no separate migration job.
- **`DOLI_ADMIN_PASSWORD` and `DOLI_INSTANCE_UNIQUE_ID` are generated automatically**
  and stored in Secret Manager. The admin password creates the first-run super-admin
  account (username `DOLI_ADMIN_LOGIN`, default `admin`).
- **`DOLI_URL_ROOT` is not preset on GKE.** Set it via `environment_variables` to the
  external LoadBalancer or custom-domain URL after the IP is assigned, so absolute
  links and login redirects resolve correctly.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Dolibarr workload

Dolibarr pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Because the workload is NFS-backed, the Deployment uses the
`Recreate` strategy (a rolling update would run two pods against the same NFS volume
and shared DB and deadlock).

- **Console:** Kubernetes Engine → Workloads → select the Dolibarr workload for
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for MySQL 8.0

Dolibarr stores all application data (third parties, invoices, products, users,
accounting) in a managed Cloud SQL for MySQL 8.0 instance. Pods reach it through the
**Cloud SQL Auth Proxy** sidecar on `127.0.0.1:3306`; no public IP is exposed. On
first deploy the `db-init` job creates the application database, user, and grants;
the Dolibarr installer then creates the schema.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and the Secret Manager secret holding the
password are all in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md) for the
connection model, automated backups, and password rotation.

### C. Cloud Storage & file persistence

A dedicated **Cloud Storage** bucket (suffix `dolibarr-documents`) is provisioned
automatically and the workload service account is granted access. Separately,
Dolibarr's document tree lives on **NFS (Cloud Filestore)** at `/var/lib/dolibarr`,
shared across pods.

- **Console:** Cloud Storage → Buckets; Filestore → Instances.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~dolibarr-documents"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Secret Manager

Two Dolibarr secrets are generated automatically and stored in Secret Manager:
`DOLI_ADMIN_PASSWORD` (the first-run super-admin password) and
`DOLI_INSTANCE_UNIQUE_ID` (a per-instance security salt). The database password is
managed separately by the foundation. On GKE, secrets are projected into pods via
the Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~dolibarr"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`, `reserve_static_ip = true` so the address survives
redeploys). A custom domain with a Google-managed certificate can be enabled.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Dolibarr Application Behaviour

- **First-deploy database setup.** The `db-init` job runs `db-init.sh` using
  `mysql:8.0-debian`. It connects to Cloud SQL (Unix socket under `/cloudsql` via the
  Auth Proxy sidecar), idempotently creates the application database, user, and
  grants, verifies the app user can connect, then shuts down the proxy sidecar. The
  job is safe to re-run (`execute_on_apply = true`, `max_retries = 3`).
- **First-boot auto-install (no separate migration job).** With
  `DOLI_INSTALL_AUTO = 1`, the Dolibarr image runs its own installer on first pod
  start, creating the schema in the empty database. Version upgrades run the image's
  own upgrade steps at boot.
- **Admin account.** The installer creates a super-admin whose username is
  `DOLI_ADMIN_LOGIN` (default `admin`) and whose password is the generated
  `DOLI_ADMIN_PASSWORD` secret. Retrieve it before first login.
- **DB env-var aliasing on loopback.** The platform injects `DB_HOST = 127.0.0.1`
  (the proxy sidecar) and the other `DB_*` values; Dolibarr reads `DOLI_DB_*`. The
  wrapper entrypoint aliases them and prefers the injected values over the image's
  baked `mysql`/`dolidb` defaults.
- **NFS-backed rollouts use `Recreate`.** Updates terminate the old pod before
  starting the new one, avoiding two pods deadlocking on the shared NFS volume and DB
  locks.
- **Set `DOLI_URL_ROOT` after the IP is known.** It is not preset on GKE — patch the
  deployment or set `environment_variables` to the external URL once the LoadBalancer
  IP is assigned:
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"dolibarr","env":[
      {"name":"DOLI_URL_ROOT","value":"https://dolibarr.example.com"}]}]}}}}'
  ```
- **Health path.** Startup probe is **TCP** on port 80; liveness probe is **HTTP**
  `GET /` (the login page returns 200 with no auth). Allow several minutes on first
  boot for the installer.
- **Inspect the init job and running config:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep DOLI_DB
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Dolibarr are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `dolibarr` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `dolibarr/dolibarr` image tag used as the custom-build base; `latest` is pinned to a known-good tag (`23.0.3`) at build time. |
| `php_memory_limit` | `512M` | PHP memory limit; raise for heavy modules/large document libraries. |
| `upload_max_filesize` / `post_max_size` | `64M` | Max upload / POST size; keep `post_max_size ≥ upload_max_filesize`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU minimum for Dolibarr + MySQL. |
| `memory_limit` | `2Gi` | Minimum 512Mi; 2Gi recommended for production. |
| `min_instance_count` | `1` | Keep at 1 to keep the workload reachable. |
| `max_instance_count` | `1` | **Keep at 1** unless multi-pod sharing is verified. |
| `container_port` | `80` | Dolibarr runs on Apache, port 80. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar (loopback) — required on GKE. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the Dolibarr UI. |
| `workload_type` | `null` → `Deployment` | Deployment (NFS-backed, `Recreate` strategy). |
| `session_affinity` | `ClientIP` | Sticky routing so a client reaches the same pod. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS is on by default so uploaded documents persist and are shared. |
| `nfs_mount_path` | `/var/lib/dolibarr` | Where Dolibarr stores documents/PDFs. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` | Keeps the Common MySQL 8.0 default. |
| `application_database_name` | `dolibarr` | Database name. Immutable after first deploy. |
| `application_database_user` | `dolibarr` | Application database user; password auto-generated in Secret Manager. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `application_domains` | `[]` | Custom hostnames + managed certificate. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

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
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Dolibarr. |
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

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a `StatefulSet` forced alongside a stateless setting, IAP with no authorized identities, `quota_memory_*` given as bare integers, an out-of-range `container_port`/`backup_retention_days`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critical | Selecting a non-MySQL engine breaks the installer and every query. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and orphans all data. |
| `DOLI_INSTANCE_UNIQUE_ID` (auto-generated) | Never change | Critical | Changing the salt after first boot invalidates signed tokens and cron URLs. |
| `enable_nfs` | `true` | High | Disabling it makes uploaded documents/PDFs ephemeral — lost on pod recreation. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar on `127.0.0.1:3306` is required for DB connectivity on GKE. |
| `max_instance_count` | `1` | High | Scaling beyond 1 without verified shared-storage/lock behaviour risks split sessions and NFS/DB lock contention. |
| `session_affinity` | `ClientIP` | High | Without stickiness, requests bounce between pods and disrupt authenticated sessions. |
| `DOLI_URL_ROOT` (set after IP known) | External LoadBalancer/domain URL | High | A wrong or missing root URL breaks absolute links and the login redirect. |
| `memory_limit` | `2Gi` | High | Below 512Mi the PHP/Apache pod OOMs under load. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `DOLI_ADMIN_PASSWORD` (auto-generated) | Retrieve before first login | Medium | Not knowing it locks you out of the first super-admin account until reset via the DB. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS and `DOLI_URL_ROOT`. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**.
Dolibarr-specific application configuration shared with the Cloud Run variant is
described in **[Dolibarr_Common](Dolibarr_Common.md)**.
