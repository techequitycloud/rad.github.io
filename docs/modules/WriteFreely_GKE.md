---
title: "WriteFreely on GKE Autopilot"
description: "Configuration reference for deploying WriteFreely on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# WriteFreely on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/WriteFreely_GKE.png" alt="WriteFreely on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

WriteFreely is an open-source, minimalist, federated blogging platform written in Go
— a lightweight Medium alternative for publishing clean, distraction-free writing.
This module deploys WriteFreely on **GKE Autopilot** on top of the
[App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud
and Kubernetes infrastructure.

This guide focuses on the cloud services WriteFreely uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## 1. Overview

WriteFreely runs as a single Go web workload on GKE Autopilot. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Go pods, 1 vCPU / 2 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for MySQL 8.0 | Required — reached through the **Cloud SQL Auth Proxy** sidecar on `127.0.0.1` |
| Object storage | Cloud Storage | A dedicated `writefreely-uploads` data bucket provisioned automatically |
| Secrets | Secret Manager | Three auto-generated AES-256 key secrets; database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **MySQL 8.0 is the fixed engine.** The shared application layer standardises on
  Cloud SQL for MySQL; the GKE variant leaves `database_type` unset and inherits it.
- **Cloud SQL is reached via the Auth Proxy sidecar.** On GKE `enable_cloudsql_volume
  = true` and the variant overrides `DB_HOST = 127.0.0.1` — WriteFreely dials the
  loopback address where the `cloud-sql-proxy` sidecar listens on port 3306.
- **The three AES-256 keys are generated automatically** and stored in Secret Manager
  (`cookies-auth`, `cookies-enc`, `email-key`). They must **never** be rotated after
  first boot — rotating them logs out every user and makes previously encrypted email
  data undecryptable.
- **A custom image is built, not pulled prebuilt.** `container_image_source = custom`:
  the thin config-gen wrapper (renders `config.ini`, seeds the keys, runs
  `writefreely db init`) is built by Cloud Build and pushed to Artifact Registry.
- **Minimum 1 replica is maintained** (`min_instance_count = 1`, `max_instance_count =
  1`; GKE does not support scale-to-zero) to keep the blog always reachable.
- **`service_type = LoadBalancer` with `session_affinity = ClientIP`.** WriteFreely is
  exposed on an external LoadBalancer IP and requests from the same client stick to
  the same pod.
- **NFS is enabled by default** (`enable_nfs = true`), which also co-hosts the
  (unused) Redis endpoint on the NFS server VM.
- **No admin account is created automatically.** Registration is closed; create the
  first account as a post-deploy step (see §3).
- **WriteFreely is Go — Redis and PHP settings are inert.** The `enable_redis` and
  `php_*` variables come from the module scaffold and are not consumed by WriteFreely.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the WriteFreely workload

WriteFreely pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the WriteFreely workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for MySQL 8.0

WriteFreely stores all application data (blogs, posts, users, sessions) in a managed
Cloud SQL for MySQL 8.0 instance. Pods reach it privately through the **Cloud SQL Auth
Proxy** sidecar over `127.0.0.1:3306`; no public IP is exposed. On first deploy an
initialization Job (`db-init`) creates the application database and user; the container
entrypoint then runs `writefreely db init` to build the tables.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and the Secret Manager secret holding the password
are all surfaced in the [Outputs](#5-outputs). For the connection model, automated
backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Storage

A dedicated **Cloud Storage** data bucket (`writefreely-uploads`) is provisioned
automatically and the workload service account is granted access. Additional buckets
can be declared via `storage_buckets`.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Secret Manager

Three cryptographic secrets are generated automatically and stored in Secret Manager —
the AES-256 keys WriteFreely uses to sign session cookies (`cookies-auth`), encrypt
cookie payloads (`cookies-enc`), and encrypt stored email addresses (`email-key`).
They are delivered to the pod via the Secret Store CSI driver and injected as
`WF_KEY_COOKIES_AUTH`, `WF_KEY_COOKIES_ENC`, and `WF_KEY_EMAIL`. The database password
is managed separately by the foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" \
    --filter="name~cookies-auth OR name~cookies-enc OR name~email-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation, and
[WriteFreely_Common](WriteFreely_Common.md) for why these keys must stay stable.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`). A custom domain with a Google-managed certificate can
be enabled, and a static IP can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available. The entrypoint
logs its progress (`WriteFreely: rendered config.ini …`, `… seeded stable encryption
keys …`, `… starting server …`), which is useful when diagnosing first boot.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. WriteFreely Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `mysql:8.0-debian`. It creates the application database and user, grants `ALL
  PRIVILEGES` on the database, verifies the app user can connect, and shuts down the
  Cloud SQL Proxy sidecar. The job is idempotent (`CREATE ... IF NOT EXISTS`,
  `max_retries = 3`) and safe to re-run.
- **Schema created on start.** The container entrypoint renders `config.ini` (with
  `DB_HOST = 127.0.0.1`) and then runs `writefreely db init` on every start to create
  the tables (tolerant if they already exist), so the schema is bootstrapped without a
  separate migration step.
- **The three AES-256 keys are immutable after first boot.** They are generated once
  and written to Secret Manager. Changing any of them logs out every user (cookie
  signatures no longer validate) and makes previously encrypted email addresses
  undecryptable. Only rotate during a planned maintenance window.
- **Create the first account after deploy.** Registration is closed by default
  (`open_registration = false`) and no admin is seeded. To create the first account,
  either temporarily set `WF_OPEN_REGISTRATION = "true"` via `environment_variables`,
  register through the UI, then set it back to `"false"`; or exec WriteFreely's
  `--create-admin` inside a running pod:
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    /usr/local/bin/writefreely --create-admin <user>:<password>
  ```
- **Public URL correctness.** The entrypoint falls back to the foundation-injected
  `GKE_SERVICE_URL` for the public host. After the LoadBalancer IP is assigned, set
  `WF_PUBLIC_URL` (via `environment_variables`) to the external URL or custom domain so
  generated links and federation use the reachable host.
- **Health path.** The startup probe is **TCP** (Ready as soon as port 8080 is bound)
  and the liveness probe is **HTTP `GET /`** — WriteFreely serves its home page with a
  `200` when healthy; there is no dedicated `/health` endpoint.
- **Confirm the injected DB host in the running pod:**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_HOST|WF_'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for WriteFreely are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `writefreely` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `writeas/writefreely` image tag; `latest` resolves the base image to the pinned `0.12.0` build ARG. Pin a release in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | Leave as `custom` — the config-gen wrapper must be built. |
| `min_instance_count` | `1` | Minimum replicas; GKE does not support scale-to-zero. |
| `max_instance_count` | `1` | Maximum replicas. |
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Per-pod resources. |
| `container_port` | `8080` | WriteFreely's web server binds port 8080. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar; `DB_HOST` is overridden to `127.0.0.1`. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP exposure for the blog. |
| `session_affinity` | `ClientIP` | Sticky routing to the same pod. |
| `workload_type` | `null` | Defaults to a stateless Deployment. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra settings. Use for `WF_SITE_NAME`, `WF_SITE_DESCRIPTION`, `WF_PUBLIC_URL`, `WF_OPEN_REGISTRATION`. Do not set `WF_KEY_*` or `DB_*` here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS is provisioned by default (also co-hosts the unused Redis endpoint). |
| `nfs_mount_path` | `/var/lib/writefreely` | Mount path inside the container. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `application_database_name` | `writefreely` | Database name → injected as `DB_NAME`. Immutable after first deploy. |
| `application_database_user` | `writefreely` | Application user → injected as `DB_USER`. Immutable after first deploy. |
| `database_type` | `null` | Inherits `MYSQL_8_0` from the shared application layer. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, 30s delay | Ready as soon as port 8080 is bound. |
| `liveness_probe` | HTTP `/`, 300s delay | Restarts the pod if the home page stops responding. |

### Group 15 — Redis (inert for WriteFreely)

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Not consumed** — WriteFreely stores all state in MySQL. Scaffold leftover. |

All other inputs follow standard App_GKE behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate
and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach WriteFreely. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
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

> **Inherited plan-time validation.** This module passes its configuration through the
> [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at
> plan time — IAP with no authorized identities, a `gen1` runtime with NFS/GCS mounts,
> a `database_type` that does not match an enabled extension, memory quota values
> without binary unit suffixes, an out-of-range `backup_retention_days`. Invalid
> configuration fails the **plan** with a clear, named error before any resource is
> created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| AES-256 keys (`WF_KEY_*`, auto-generated) | Never rotate after first boot | Critical | Rotating logs out every user and makes encrypted email data undecryptable. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all data. |
| `enable_cloudsql_volume` | `true` | Critical | On GKE the Auth Proxy sidecar is required; disabling it removes the `127.0.0.1:3306` listener and breaks MySQL connectivity. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup file fails the import job. |
| `container_image_source` | `custom` | High | Setting `prebuilt` without an image that embeds the config-gen entrypoint yields a pod that cannot render `config.ini` and fails to start. |
| `WF_PUBLIC_URL` | External LoadBalancer URL / domain | High | An incorrect public host breaks generated links, federation, and redirects. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects invalid values. |
| `session_affinity` | `ClientIP` | Medium | Without stickiness, sessions may bounce between pods; stable cookie keys make this tolerable but affinity is preferred. |
| `application_version` | Pin a release | Medium | `latest` can shift the base image across redeploys; pinning keeps builds reproducible. |
| `WF_OPEN_REGISTRATION` | `false` after first admin | Medium | Leaving registration open lets anyone with the URL create an account. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict all pods simultaneously during maintenance. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. WriteFreely-specific
application configuration shared with the Cloud Run variant is described in
**[WriteFreely_Common](WriteFreely_Common.md)**.
