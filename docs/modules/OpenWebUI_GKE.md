---
title: "Open WebUI on GKE Autopilot"
description: "Configuration reference for deploying Open WebUI on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Open WebUI on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenWebUI_GKE.png" alt="Open WebUI on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Open WebUI is a self-hosted AI interface providing a polished ChatGPT-style frontend for
Ollama, OpenAI-compatible APIs, and dozens of other LLM providers. This module deploys
Open WebUI on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which
provisions and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Open WebUI uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## What OpenWebUI costs on RAD, and how that compares

**For a small team, OpenWebUI on RAD's GKE Autopilot module costs about US$150 a month with no per-user licence.** GKE suits an Open WebUI that must stay up, scale across pods, or run beside other Kubernetes workloads. For the lowest cost, the [Cloud Run module](OpenWebUI_CloudRun.md) runs the same OpenWebUI for about US$102 a month. Figures are as at 8 October 2026; sources are listed at the end of this section.

If you only need it occasionally — studying for a certification, a demo, a seasonal business — a RAD-managed project can be deleted and restored within 30 days for a few credits, so that US$150 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 175 credits (US$17.50 at the top-up price) | 157.5 credits (10% lower) |
| Build time | About 19 credits per build (RAD's average build takes about 19 minutes) | The same |
| Google Cloud running cost | Billed by Google to your own billing account (table below) | Metered hourly in credits; RAD publishes **116 credits a day**, about 3,480 credits a month (about US$348 at the top-up price, US$278 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 2x vCPU / 4 GiB | US$79.35 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | shared across every GKE app in the project; $0 if this is your only cluster, else ~73 |
| **Total** | **about US$150**, or about US$223 without the free tier |

- GKE's free tier covers the management fee of one Autopilot or zonal cluster per billing account, so it applies only if this is your only such cluster. Cloud SQL costs the same in africa-south1 (Johannesburg); the pod and VM cost about 10% more there.
- **GKE Autopilot does not scale to zero.** At least one OpenWebUI pod always runs, so the cost above is the same whether or not anyone is using it; extra pods are added only under load.
- **Avoid Filestore for a small deployment.** The module uses a small NFS/cache VM by default. Filestore's smallest instance is 1 TiB, which costs about US$164 a month on its own.

### How it compares

- No official "Open WebUI Cloud" exists with public pricing — the project ships as self-hosted software — so this compares against a bare server.
- A bare VPS sized close to Open WebUI's 2 vCPU / 4 GiB footprint — Hetzner CPX22 or a DigitalOcean 2 vCPU/4 GB Droplet, both about US$24/month, or a GCP Compute Engine e2-standard-2 (2 vCPU/8 GB) at about US$49/month — is cheaper in cash than either RAD figure above.
- RAD's managed Cloud SQL (chat history, accounts) and Secret Manager (the API keys for the LLM providers behind it) replace the backups, patching and secrets-handling you would otherwise do yourself on a VPS.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If OpenWebUI runs in **a project RAD manages for you**, you have a second option that
goes well beyond scaling to zero: **delete the whole project, and restore it within 30
days for close to nothing.** This suits occasional use — studying for a certification,
a demo environment, a seasonal business — far better than running OpenWebUI
continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks
  Google to delete the project. Google does not remove the project immediately: it keeps
  it, recoverable, for 30 days. Because billing is already unlinked, nothing is charged
  while it waits. Unlike deleting one module, this does not tear down Cloud SQL, any VM or the GKE cluster
  one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's
  owner can restore it. RAD asks Google to undelete the project and reattaches its
  billing account, then asks you to run **Update** on each deployment to confirm
  everything came back. Because nothing was individually destroyed, that Update finds
  the same resources already there — it is a check, not a rebuild, and an Update never
  charges the module fee again. That costs a handful of credits (under US$1) for a
  typical 2–3-deployment chain, against the 180 credits
  (US$18) a full redeploy costs below.
- **So a month of occasional use can cost a few dollars, not US$150.**
  Deploy OpenWebUI, use it for a while, delete the project. Restore it next time you
  want it, confirm with Update, and delete it again when you're done. You pay only for
  the module fee once, the builds, and whatever time OpenWebUI was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only
  manages billing for), and you restore it yourself within the 30 days — after that,
  Google deletes it for good. Restoring is admitted like creating a new project: your
  purchased credit balance must still clear the tier's floor (100 credits for the
  sandbox tier most study and demo use fits). Google says most services are fully
  working again within 36 hours of a restore.
- **One real gap: the backup bucket does not survive.** OpenWebUI's backups are written
  to a bucket inside the project, and that bucket is **not** protected by Cloud Storage's
  soft-delete, so it is very likely gone as soon as you delete the project — even though
  the project itself is recoverable for 30 days. If you have made changes to OpenWebUI
  you want to keep, copy a backup out (to Google Drive, or a bucket outside the project)
  before you delete, the same as the redeploy workflow below. For a default installation
  with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

GKE Autopilot does not scale to zero between requests. The option above only applies to a RAD-managed project; **in your own project, or once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 180
  credits (US$18), because RAD recreates the project and shared
  services before OpenWebUI. Deleting saves money only once OpenWebUI would otherwise
  sit unused for about 4 days or more, both in your own project (about
  US$4.99 a day) and in a RAD-managed one (116 credits a day).
- **Most of the running cost is usually the database and the shared file/cache VM.**
  They stop only when nothing else in the project uses
  them, so deleting OpenWebUI while something else shares the
  project saves only OpenWebUI's own compute part.
- **Keep data first.** Backups are written to a bucket inside the deployment and are
  deleted with it, so copy the latest backup out before deleting if you want to keep it.
- **RAD does not recreate a deleted deployment for you**; you enter the settings again
  when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant
  gets the app in their own Google Cloud project for 15 minutes to 24 hours, within an
  allowance the trainer sets. Either the trainer funds every place, or each participant
  pays for their own. Everything is deleted when the session ends and unused credits go
  back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs
  low, billing pauses and the data is kept, so nobody receives an unexpected charge. At
  the end the partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and
ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; [radmodules.dev/pricing](https://radmodules.dev/pricing) for RAD's own fees and daily-credit estimates; [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore window and what it says about Cloud Storage objects without soft delete.

---

## 1. Overview

Open WebUI runs as a Python web workload backed by PostgreSQL. The deployment wires
together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Python web pods, 2 vCPU / 4 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — sessions, conversations, and RAG data all live here |
| Shared files | Filestore (NFS) | Optional — needed only when multiple replicas share uploaded files |
| Object storage | Cloud Storage | A dedicated data bucket provisioned automatically |
| Secrets | Secret Manager | Auto-generated `WEBUI_SECRET_KEY` and database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is required.** Open WebUI does not support MySQL or any other engine;
  the database type is fixed internally.
- **No Redis.** Open WebUI persists sessions and all application state in PostgreSQL.
  The `enable_redis` variable defaults to `false` and no Redis environment variables
  are injected.
- **`WEBUI_SECRET_KEY` is auto-generated** and stored in Secret Manager. It signs all
  user sessions; rotating it invalidates every active session simultaneously. Treat it
  as immutable after first use.
- **New users require admin approval by default.** `default_user_role = "pending"`
  means self-registered accounts cannot access the UI until an admin promotes them.
- **`min_instance_count` defaults to `1`** (a warm pod, not scale-to-zero). Set it to
  `0` to allow scale-to-zero, at the cost of 30–60 s cold-start latency on the first
  request (pod + Cloud SQL proxy startup).
- **Health probes target `/health`.** Open WebUI exposes this path natively; both
  startup and liveness probes use it.
- **`DATABASE_URL` is assembled automatically** from the Cloud SQL credentials injected
  by the platform — do not override it.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Open WebUI workload

Open WebUI pods are scheduled on Autopilot, which bills for the CPU and memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Open WebUI workload to see
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows the
  external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Open WebUI stores all application data — user accounts, conversations, RAG indices,
and uploaded document embeddings — in a managed Cloud SQL for PostgreSQL 15 instance.
Pods reach it privately through the **Cloud SQL Auth Proxy** sidecar over a Unix
socket, so no public IP is exposed. On first deploy an initialization Job creates the
application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> \
    --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see
[App_GKE](App_GKE.md).

### C. Cloud Storage

A dedicated **Cloud Storage** bucket (`openwebui-data`) is provisioned automatically
for Open WebUI's backend data directory. The workload service account is granted access
automatically.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for GCS Fuse and CMEK options.

### D. Filestore (NFS) — optional shared storage

NFS is disabled by default. Enable it (`enable_nfs = true`) when running more than one
replica and uploaded files must be visible across all pods. Without shared storage, a
file uploaded to one pod is not visible to another.

- **Console:** Filestore → Instances for the NFS share.
- **CLI:**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

See [App_GKE](App_GKE.md) for NFS provisioning details.

### E. Secret Manager

`WEBUI_SECRET_KEY` (session signing key) and the database password are stored as Secret
Manager secrets and injected into pods at runtime; plaintext never appears in
configuration or logs.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A
custom domain with a Google-managed certificate can be enabled, and a static IP can be
reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and
static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Open WebUI Application Behaviour

- **First-deploy database setup.** An initialization Job (`db-init`) runs
  `postgres:15-alpine` against the Cloud SQL instance through the Auth Proxy. It
  idempotently creates the application database and user before the application starts.
- **Database migrations on start.** Open WebUI runs its own Alembic schema migrations
  on every startup, so upgrading `application_version` applies any new schema changes
  automatically. On first boot this can take 30–60 seconds.
- **`DATABASE_URL` assembly.** The custom entrypoint (`entrypoint.sh`) assembles the
  `DATABASE_URL` from the platform-injected `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and
  `DB_NAME` environment variables. The password is URL-encoded in the process. Do not
  override `DATABASE_URL` directly.
- **`WEBUI_SECRET_KEY` is immutable.** The key signs all user sessions. Rotating it
  (for example by redeploying with a new random value) immediately logs out every
  active user and invalidates all remember-me tokens. Treat it as permanent after the
  first login.
- **AI backend connection.** Open WebUI connects to an Ollama instance or an
  OpenAI-compatible API at startup. If neither `ollama_base_url` nor
  `openai_api_base_url` is configured, the UI starts but has no AI backend — all model
  inference requests fail. Supply API keys (e.g. `OPENAI_API_KEY`) via
  `secret_environment_variables`, not `environment_variables`.
- **User registration flow.** With `default_user_role = "pending"` (the default) all
  self-registered accounts must be promoted by an admin before they can use the UI.
  The first admin account must be created directly through the signup page on first
  boot.
- **Health path.** Both startup and liveness probes target `/health`, which returns
  HTTP 200 once the application and database connection are ready. The startup probe
  allows up to 300 seconds (30 failures × 10-second period) for first-boot migration
  to complete.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Open WebUI are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

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
| `resource_labels` | `{}` | Labels applied to all resources for cost/ownership tracking. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `openwebui` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Open WebUI` | Friendly name shown in the Console. |
| `description` | _(set)_ | Workload description annotation. |
| `application_version` | `latest` | Open WebUI image version tag. Pin to a specific release in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `2000m` | CPU per pod; 2 vCPU recommended for RAG workloads. |
| `memory_limit` | `4Gi` | Memory per pod; 4 GiB recommended (RAG pipelines can use 3–6 GiB under load). |
| `min_instance_count` | `1` | Minimum replicas. Set `1` for interactive team use; `0` enables scale-to-zero. |
| `max_instance_count` | `3` | Maximum replicas (autoscaler ceiling). |
| `container_port` | `8080` | Open WebUI's HTTP port (matches the official image's `EXPOSE`). |
| `timeout_seconds` | `300` | Request timeout. Increase to `600`–`3600` for document-heavy RAG or slow LLM backends. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar — must be `true` when connecting to Cloud SQL. |
| `enable_image_mirroring` | `true` | Mirror the Open WebUI image into Artifact Registry (avoids GHCR rate limits). |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically (disables HPA if enabled). |

### Group 5 — Open WebUI Settings

| Variable | Default | Description |
|---|---|---|
| `ollama_base_url` | `""` | Base URL for the Ollama backend (e.g. `http://ollama:11434`). Leave empty if not using Ollama directly. |
| `openai_api_base_url` | `""` | Base URL for an OpenAI-compatible API (e.g. `https://api.openai.com/v1`). Must include `/v1` suffix. |
| `default_user_role` | `pending` | Role assigned to new self-registered accounts. `pending` requires admin approval; `user` grants immediate access. |
| `enable_signup` | `true` | Allow the signup page. Set `false` after admin accounts are created in production. |
| `webui_auth` | `true` | Enable the login form. Only set `false` for single-user or fully air-gapped deployments. |
| `environment_variables` | `{}` | Extra non-secret settings. Do not override `DATABASE_URL` or `WEBUI_SECRET_KEY`. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use for `OPENAI_API_KEY` and similar. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing — recommended for Open WebUI's session consistency. |
| `workload_type` | `null` | Auto-resolves to `StatefulSet` when `stateful_pvc_enabled = true`. |
| `network_tags` | `['nfsserver']` | Node/pod tags; `nfsserver` is required for NFS connectivity. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable PVC templates in the StatefulSet for local data persistence alongside PostgreSQL. |
| `stateful_pvc_size` | `10Gi` | Storage size for each PVC. Default mount path is `/app/backend/data`. |
| `stateful_pvc_mount_path` | `/app/backend/data` | Container path where the per-pod PVC is mounted. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 if you need eviction headroom. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | `/health` path | HTTP probe against Open WebUI's health endpoint. 30 s initial delay with 30 failures allowed for first-boot migrations. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |
| `cron_jobs` | `[]` | Open WebUI has no required scheduled commands; add any app-specific recurring tasks here. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Shared Filestore volume — needed when multiple replicas must share uploaded files. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the data bucket. |
| `storage_buckets` | `[]` | Additional buckets beyond the automatically provisioned data bucket. |
| `gcs_volumes` | `[]` | GCS Fuse mounts for extra bucket-backed directories. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `db_name` | `openwebui_db` | PostgreSQL database name. Immutable after first deploy. |
| `db_user` | `openwebui_user` | Application user. Immutable after first deploy. |
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
| `enable_custom_domain` | `true` | Provision a Gateway for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Open WebUI. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | `default-waf-policy` | Policy name. |
| `enable_cdn` | `false` | Enable Cloud CDN on the GKE Ingress backend. |

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
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Open WebUI. |
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
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD repo details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_cloudsql_volume` | `true` | Critical | Disabling breaks all database connections when using Cloud SQL. Only disable when connecting to an external PostgreSQL over TCP. |
| `WEBUI_SECRET_KEY` (auto-generated) | immutable after first use | Critical | Rotating the key immediately logs out every active user and invalidates all remember-me tokens. |
| `webui_auth` | `true` | Critical | Disabling removes the login form — anyone who can reach the URL has full admin access with no credentials. |
| `db_name` / `db_user` | set once | Critical | Immutable after first deploy; changing recreates the database/user and destroys all data. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_uri` fails the import job. |
| `database_type` (fixed) | `POSTGRES_15` | Critical | Open WebUI requires PostgreSQL; any other engine breaks migrations and startup. |
| `ollama_base_url` / `openai_api_base_url` | at least one set | High | Without a backend URL, Open WebUI starts but all model inference requests fail immediately. |
| `default_user_role` | `pending` | High | `user` auto-approves all self-registrations; on a publicly exposed service this allows unrestricted sign-up. |
| `enable_signup` | `true` (set `false` in prod after onboarding) | High | Combined with `default_user_role = "user"`, any visitor can self-register and access all models. |
| `memory_limit` | `4Gi` | High | RAG pipelines can consume 3–6 GiB under load; insufficient memory causes OOM kills mid-ingestion. |
| `backup_schedule` | `0 2 * * *` | High | Without automated backups, the PostgreSQL database (users, conversations, RAG data) is unprotected. |
| `application_version` | pinned release in prod | Medium | `latest` risks an unintended upgrade with a schema change that crashes startup. |
| `min_instance_count` | `1` for interactive use | Medium | `0` adds 30–60 s cold-start latency when the first request arrives (pod + Cloud SQL proxy startup). |
| `enable_nfs` | `true` when `max_instance_count > 1` | Medium | Without shared storage, uploaded files are pod-local and invisible to other replicas. |
| `timeout_seconds` | `300` (raise for RAG/LLM) | Medium | Document ingestion and large model responses are cut off at the load balancer timeout. |
| `stateful_pvc_enabled` | `null`/`false` (use GCS instead) | Medium | PVC-backed StatefulSets prevent pod migration; use GCS Fuse unless local IOPS are critical. |
| `enable_iap` / `enable_cloud_armor` | enable for production | Medium | Without them, the UI is publicly reachable with only Open WebUI's built-in auth as a gate. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Open WebUI-specific application configuration shared with the
Cloud Run variant is described in **[OpenWebUI_Common](OpenWebUI_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: OpenWebUI on GKE Autopilot](../labs/OpenWebUI_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Open WebUI on Google Cloud Run](OpenWebUI_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Open WebUI Common — Shared Application Configuration](OpenWebUI_Common.md) — the configuration shared by both deployment targets.
