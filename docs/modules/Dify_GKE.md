---
title: "Dify on GKE Autopilot"
description: "Configuration reference for deploying Dify on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Dify on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Dify_GKE.png" alt="Dify on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Dify is an open-source LLM application development platform for building production-grade AI
applications with a visual workflow builder, RAG pipeline, agent framework, multi-model
management, and built-in observability. This module deploys Dify on **GKE Autopilot** on top of
the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google Cloud and
Kubernetes infrastructure.

This guide focuses on the cloud services Dify uses and how to explore and operate them from the
Google Cloud Console and the command line. For the mechanics that are common to every GKE
application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## What Dify costs on RAD, and how that compares

**Dify on RAD's GKE Autopilot module costs about US$149.81 a month in a Google Cloud project you own, plus a one-time 300-credit module fee (US$30).** Dify is a visual builder for production LLM applications, with a RAG pipeline, agent framework and built-in observability. For the lowest cost, the [Cloud Run guide](Dify_CloudRun.md) runs the same Dify for about US$102 a month; pick GKE here only if Dify must stay up continuously, scale across pods, or run beside other Kubernetes workloads.

If Dify is only needed occasionally — a demo, a trial, a seasonal or study workload — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that US$149.81 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 300 credits (US$30 at the top-up price) | 270 credits (10% lower) |
| Build time | A few credits per build (roughly 3–6) | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$149.81 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **116 credits a day**, about 3480 a month (about US$348 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, less on a plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 2x vCPU / 4 GiB | US$79.35 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | shared across every GKE app in the project; $0 if this is your only cluster, else ~73 |
| **Total** | **about US$149.81** |

### How it compares

- The project's own managed offering, **Dify Cloud**, has a free Sandbox plan, then $590 per workspace a year (about $49 a month) on Professional and $1,590 per workspace a year (about $133 a month) on Team.
- Run it yourself and a VPS running Dify's API, worker and web containers plus PostgreSQL yourself costs less in cash: sized to roughly 2 vCPU/4 GiB, a comparable VPS (Hetzner or DigitalOcean) runs about $24–48 a month, or a GCP `e2-standard-2`-class VM about $49 — plus your own time for backups, security patches and upgrades, which RAD's managed Cloud SQL, Secret Manager and monitoring cover for you.
- RAD never claims to be cheaper than bare infrastructure in cash terms — it usually is not. The difference is what RAD manages for you: patching, backups, secrets and monitoring, plus the ability to pause Dify for free rather than paying for idle capacity (see below).
- Most of the running cost above is the managed PostgreSQL database (and, where used, the shared file server) — the part a bare VPS comparison has to run and back up by hand.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Dify runs in **a project RAD manages for you**, you have a second option that goes well beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to nothing.** This suits Dify that you only need occasionally far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google to delete the project. Google does not remove the project immediately: it keeps it, recoverable, for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike deleting one module, this does not tear down Cloud SQL, the VM or GKE Autopilot resources one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's owner can restore it. RAD asks Google to undelete the project and reattaches its billing account, then asks you to run **Update** on each deployment to confirm everything came back. Because nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a rebuild, and an Update never charges the module fee again. That is a handful of credits (under US$1) in total for a typical Dify chain, against the 305 credits a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$149.81.** Deploy Dify, use it, delete the project. Restore it next time you want it, confirm with Update, and delete it again when you're done. You pay only for the module fee once, the builds, and whatever hours it was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages billing for), and you restore it yourself within the 30 days — after that, Google deletes it for good. Restoring is admitted like creating a new project: your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier most study and demo use fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap: the backup bucket does not survive.** Nightly backups are written to a bucket inside the project, and that bucket is **not** protected by Cloud Storage's soft-delete, so it is very likely gone as soon as you delete the project — even though the project itself is recoverable for 30 days. If you have customised Dify and want to keep that work, copy a backup out (to Google Drive, or a bucket outside the project) before you delete. For a default installation with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

GKE Autopilot keeps at least one pod running, so it never scales to zero on its own. The option above only applies to a RAD-managed project; **in your own project, or once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 305 credits (US$30.50) in your own project. Deleting saves money only once Dify would otherwise sit unused for about 7 days or more in your own project (US$5 a day), or about 3 days or more in a RAD-managed one (116 credits a day).
- **Most of the running cost is usually the database and the shared file or cache server.** They stop only when nothing else in the project uses them, so deleting Dify while something else shares the project saves only this app's own compute part.
- **Keep your data first.** Nightly backups are written to a bucket inside the deployment and are deleted with it, so copy the latest backup out before deleting if you want to keep it.
- **Note your settings.** RAD does not recreate a deleted deployment for you; you enter the settings again when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either the trainer funds every place, or each participant pays for their own. Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's own fees and daily-credit estimates from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the 30-day recovery window and what it says about Cloud Storage objects without soft delete; [Dify Cloud](https://dify.ai/pricing). Prices change; check each source before relying on a figure.

## 1. Overview

Dify runs as a Python/Flask API container (with an embedded Celery worker under supervisord) plus
a separate Next.js web frontend. The deployment wires together a focused set of Google Cloud
services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | API+worker pod (2 vCPU / 4 GiB by default) + web frontend pod, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — pgvector extension enabled for vector storage |
| Vector store | pgvector (in-database) | Reuses the Cloud SQL instance; no separate vector database needed |
| Shared files | Filestore (NFS) | Shared Redis host co-location; NFS VM also used for task state |
| Object storage | Cloud Storage | A dedicated `gcs-dify<resource-prefix>-storage` bucket for uploaded files and assets |
| Cache & task queue | Redis | Required for Celery broker/backend and SSE/WebSocket LLM streaming |
| Secrets | Secret Manager | Auto-generated SECRET_KEY and database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** MySQL and `NONE` are not supported; Dify requires PostgreSQL
  for all metadata, workflow state, and user accounts.
- **pgvector is always enabled.** The `vector` extension is installed on the Cloud SQL instance
  automatically, making the same database instance the vector store — no extra service required.
- **Redis is required.** Celery (workflow execution, document indexing, async LLM calls) and the
  SSE/WebSocket event bus both depend on Redis. Disabling it breaks all background processing.
- **NFS is enabled by default.** The NFS server VM hosts the Redis process when no external Redis
  host is set.
- **A web frontend is deployed automatically.** A `langgenius/dify-web` Deployment is wired to
  the API service URL — you do not need to configure it separately.
- **SECRET_KEY is auto-generated** and stored in Secret Manager; it signs Dify sessions and must
  never be changed after first deployment.
- **Database migrations run on every pod start** (via `MIGRATION_ENABLED=true`), so version
  upgrades apply schema changes automatically.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Dify workload

Dify runs two Autopilot Deployments: the API+worker pod (Flask/gunicorn + Celery via supervisord)
and the web frontend (Next.js). Horizontal Pod Autoscaling sizes each Deployment between the
minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Dify API or web workload to see
  pods, events, and resource usage. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Dify stores all application data (workflows, knowledge bases, user accounts, API keys) in a
managed Cloud SQL for PostgreSQL 15 instance. Pods connect privately through the **Cloud SQL
Auth Proxy** sidecar over a Unix socket — no public IP is exposed. On first deploy an
initialization Job creates the application database and user. The `pgvector` extension is
installed automatically so the same instance serves as the vector store.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the password are
all surfaced in the [Outputs](#5-outputs). For the connection model, automated backups, and
password rotation, see [App_GKE](App_GKE.md).

### C. Filestore (NFS) and Cloud Storage

A **Filestore (NFS)** share is mounted into every pod. The NFS server VM also runs the Redis
process used as the Celery broker when no external Redis host is configured. A dedicated **Cloud
Storage** bucket (`gcs-dify<resource-prefix>-storage`) is provisioned for uploaded files and assets; Dify's
`google-storage` driver accesses it via Workload Identity — no service account key file is
needed.

- **Console:** Filestore → Instances for the NFS share; Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<dify-storage-bucket>/
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### D. Redis — Celery and event bus

Redis is required for three functions in Dify:

| Role | Redis DB | Purpose |
|---|---|---|
| Celery broker & backend | db 1 | Queues and tracks all background tasks (LLM inference, document indexing) |
| Event bus | db 0 | SSE/WebSocket streaming for real-time LLM output |
| General cache | db 0 | Application caching |

When no external Redis host is configured, the NFS server VM IP is used as the Redis endpoint.
For production, point `redis_host` at a dedicated Memorystore for Redis instance.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager

The Dify `SECRET_KEY` (used for JWT signing and session encryption) and the database password
are stored as Secret Manager secrets and injected into pods at runtime; plaintext never appears
in pod specs. The `SECRET_KEY` is generated once and must not be rotated while the deployment
is running — all pods must share the same value.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the Dify service is exposed through an external Cloud Load Balancing IP. A custom
domain with a Google-managed certificate can be enabled, and a static IP can be reserved so the
address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Dify Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) connects to Cloud SQL via
  the Auth Proxy and idempotently creates the Dify database user and database. It runs
  automatically and is safe to re-run.
- **Migrations on start.** Each pod runs Dify's Flask-Migrate database migrations on startup
  (`MIGRATION_ENABLED=true`), so upgrading the application version applies schema changes
  automatically. No separate migration job is needed.
- **API + worker in one pod.** The custom container wraps `langgenius/dify-api` with supervisord.
  Both the gunicorn API server and the Celery worker run inside the same pod — they share CPU and
  memory allocation. Size accordingly: 2 vCPU and 4 GiB is the recommended minimum.
- **Web frontend.** A `langgenius/dify-web` Deployment is deployed automatically and wired to
  the API service URL. Access Dify through the web service external IP or the `web_url` output.
- **LLM provider API keys.** Provider keys (OpenAI, Anthropic, etc.) are configured per-workspace
  via the Dify web console and stored in the application database. Use
  `secret_environment_variables` only for environment-level configuration that cannot be set in
  the UI.
- **CORS.** `WEB_API_CORS_ALLOW_ORIGINS` and `CONSOLE_CORS_ALLOW_ORIGINS` default to `"*"`.
  Restrict to your domain via `environment_variables` in production.
- **Health path.** Readiness and liveness probes target `/health` with a 30-second initial delay
  to allow the API server and database migrations to complete on first boot.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings specific
to or notable for Dify are listed; every other input is inherited from [App_GKE](App_GKE.md)
with its standard behaviour and defaults.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources for cost and ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `dify` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Dify - LLM Application Platform` | Friendly name shown in the Console. |
| `description` | _(set)_ | Workload description annotation. |
| `application_version` | `0.15.0` | Dify image version tag; applies to both API and web containers. Pin to a specific version in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per pod; 2 vCPU minimum — gunicorn and Celery share this allocation. |
| `memory_limit` | `4Gi` | Memory per pod; 4 GiB recommended for LLM workflow caching and document processing. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 so the Celery worker maintains its Redis broker connection. |
| `max_instance_count` | `3` | Maximum replicas (autoscaler ceiling). |
| `container_port` | `5001` | Dify API server listens on port 5001. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for Unix socket connections. Required for database connectivity. |
| `enable_vertical_pod_autoscaling` | `false` | VPA tunes resource requests automatically; enabling it disables HPA. |
| `enable_pod_disruption_budget` | `false` | Creates a PodDisruptionBudget for minimum availability during node maintenance. |
| `pdb_min_available` | `1` | Minimum pods available during disruptions. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. Use to override `WEB_API_CORS_ALLOW_ORIGINS`, `LOG_LEVEL`, etc. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use for LLM provider API keys. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing — recommended for Dify's session state. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when per-pod storage is enabled. |
| `network_tags` | `['nfsserver']` | Node/pod tags; `nfsserver` is required for NFS connectivity. |
| `gke_cluster_name` | `""` | GKE cluster name. Leave empty to auto-discover. |
| `namespace_name` | `""` | Kubernetes namespace. Auto-generated when empty. |
| `termination_grace_period_seconds` | `60` | Seconds Kubernetes waits after SIGTERM before force-killing. |

### Group 7 — StatefulSet Configuration

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable per-pod PVCs. Setting `true` auto-selects `StatefulSet` workload type. |
| `stateful_pvc_size` | `10Gi` | Storage size for each PVC. |
| `stateful_pvc_mount_path` | `/data` | Container path where the per-pod PVC is mounted. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVC provisioning. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` / `startup_probe` | HTTP `/health`, 30 s delay | Startup probe — container receives no traffic until `/health` returns 200. |
| `health_check_config` / `liveness_probe` | HTTP `/health` | Liveness probe. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. Provide a non-empty list to replace it entirely. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs. |
| `additional_services` | `[]` | Additional Kubernetes Deployments alongside Dify (web frontend is wired automatically). |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume; also provides the default Redis host when no external Redis is set. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |
| `nfs_instance_name` | `""` | Name of an existing NFS GCE VM. Leave empty to auto-discover. |
| `nfs_instance_base_name` | `app-nfs` | Base name for an inline NFS GCE VM when none exists. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision additional GCS buckets. The `gcs-dify<resource-prefix>-storage` bucket is always provisioned by Dify_Common. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional buckets beyond the auto-provisioned storage bucket. |
| `gcs_volumes` | `[]` | GCS Fuse mounts via the CSI driver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `dify_db` | PostgreSQL database name. **Immutable after first deploy.** |
| `db_user` | `dify_user` | Application user. **Immutable after first deploy.** |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 30–90 for production/compliance. |
| `enable_backup_import` / `backup_source` / `backup_uri` | restore options | Restore from a backup on deploy. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. **Do not set `false` for Dify** — see the Critical pitfall in [§6](#6-configuration-pitfalls--sensible-defaults): the web frontend's API calls resolve to an unreachable internal hostname without it. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Dify. Requires `enable_custom_domain = true`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `true` | **Required.** Enables Redis for Celery task queue and SSE/WebSocket streaming. |
| `redis_host` | `""` | Leave empty to use the NFS server IP; set explicitly for an external Memorystore instance. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name (Dify API). |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP of the API service. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `web_url` | URL of the Dify web frontend (use this to open the browser UI). |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` | Application database name. |
| `database_user` | Application database user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup and (optional) import jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD repository details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster and workload are ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_redis` | `true` (required) | Critical | All Celery tasks (workflow execution, document indexing, async LLM calls) fail silently without Redis. |
| `enable_cloudsql_volume` | `true` (required) | Critical | The Auth Proxy sidecar is the only path to PostgreSQL; disabling it breaks all database connectivity. |
| `SECRET_KEY` (auto-generated) | immutable once set | Critical | All pods must share the same key; rotating it logs out all users and invalidates active sessions. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; renaming recreates the database and destroys data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `enable_redis` + `enable_nfs` | both `true` if no external Redis | Critical | Without NFS, there is no Redis host when `redis_host` is empty — Celery fails to start. |
| `secret_environment_variables` for LLM keys | always use secret refs | Critical | Plain env vars expose API keys in pod specs visible via `kubectl describe pod`. |
| `enable_redis` + `redis_host` | correct host | High | Incorrect `redis_host` produces a malformed Celery broker URL; all async tasks queue indefinitely. |
| `reserve_static_ip` + `service_type` | `true` / `LoadBalancer` — **do not change for Dify** | Critical | The web frontend's `CONSOLE_API_URL`/`APP_API_URL` resolve via the `$(GKE_SERVICE_URL)` sentinel to `local.service_url`, which falls back to the unreachable internal `*.svc.cluster.local` hostname if `reserve_static_ip=false` or `service_type` is overridden away from `LoadBalancer`. The page loads, but every browser-side API call fails with `net::ERR_NAME_NOT_RESOLVED`. This is a genuine exception to the fleet-wide `reserve_static_ip=false` IP-quota-conservation convention. |
| `memory_limit` | `4Gi` | High | Too little memory causes OOM kills during document ingestion or LLM workflow caching. |
| `min_instance_count` | `1` | High | Scale-to-zero causes cold starts and abandons in-flight Celery tasks. |
| `timeout_seconds` | `300` (raise for workflows) | High | Multi-step workflows and RAG indexing can exceed 300 s; increase to `3600` for complex deployments. |
| `WEB_API_CORS_ALLOW_ORIGINS` | restrict in production | High | Default `"*"` allows cross-origin requests from any domain. |
| `application_version` | pin to a specific version | Medium | Unpinned versions risk unexpected schema migrations that break the application on redeploy. |
| `enable_iap` / `enable_cloud_armor` | enable for production | Medium | The Dify console is publicly reachable without these controls. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity, autoscaling,
ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and
image mirroring — see **[App_GKE](App_GKE.md)**. Dify-specific application configuration shared
with the Cloud Run variant is described in **[Dify_Common](Dify_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Dify on GKE Autopilot](../labs/Dify_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Dify on Google Cloud Run](Dify_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Dify Common — Shared Application Configuration](Dify_Common.md) — the configuration shared by both deployment targets.
