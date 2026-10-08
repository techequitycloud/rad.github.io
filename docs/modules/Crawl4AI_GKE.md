---
title: "Crawl4AI on GKE Autopilot"
description: "Configuration reference for deploying Crawl4AI on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Crawl4AI on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Crawl4AI_GKE.png" alt="Crawl4AI on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Crawl4AI is an open-source LLM-friendly web crawler and scraper. This module
deploys Crawl4AI on **GKE Autopilot** on top of the [App_GKE](App_GKE.md)
foundation, which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

This guide focuses on the cloud services Crawl4AI uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## What Crawl4AI costs on RAD, and how that compares

**Crawl4AI on RAD's GKE Autopilot module costs about US$164.69 a month in a Google Cloud project you own, plus a one-time 175-credit module fee (US$17.50).** Crawl4AI is an open-source, LLM-friendly web crawler and scraper for RAG ingestion pipelines. For the lowest cost, the [Cloud Run guide](Crawl4AI_CloudRun.md) runs the same Crawl4AI for about US$22.33 a month; pick GKE here only if Crawl4AI must stay up continuously, scale across pods, or run beside other Kubernetes workloads.

If Crawl4AI is only needed occasionally — a demo, a trial, a seasonal or study workload — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that US$164.69 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 175 credits (US$17.50 at the top-up price) | 157.5 credits (10% lower) |
| Build time | A few credits per build (roughly 3–6) | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$164.69 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **117 credits a day**, about 3510 a month (about US$351 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, less on a plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 4x vCPU / 8 GiB | US$158.69 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | shared across every GKE app in the project; $0 if this is your only cluster, else ~73 |
| **Total** | **about US$164.69** |

### How it compares

- Run it yourself and a VPS running Crawl4AI's own container costs less in cash: sized to roughly 4 vCPU/8 GiB, a comparable VPS (Hetzner or DigitalOcean) runs about $24–48 a month, or a GCP `e2-standard-2`-class VM about $49 — plus your own time for backups, security patches and upgrades, which RAD's managed Cloud SQL, Secret Manager and monitoring cover for you.
- RAD never claims to be cheaper than bare infrastructure in cash terms — it usually is not. The difference is what RAD manages for you: patching, backups, secrets and monitoring, plus the ability to pause Crawl4AI for free rather than paying for idle capacity (see below).

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Crawl4AI runs in **a project RAD manages for you**, you have a second option that goes well beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to nothing.** This suits Crawl4AI that you only need occasionally far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google to delete the project. Google does not remove the project immediately: it keeps it, recoverable, for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike deleting one module, this does not tear down GKE Autopilot resources one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's owner can restore it. RAD asks Google to undelete the project and reattaches its billing account, then asks you to run **Update** on each deployment to confirm everything came back. Because nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a rebuild, and an Update never charges the module fee again. That is a handful of credits (under US$1) in total for a typical Crawl4AI chain, against the 180 credits a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$164.69.** Deploy Crawl4AI, use it, delete the project. Restore it next time you want it, confirm with Update, and delete it again when you're done. You pay only for the module fee once, the builds, and whatever hours it was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages billing for), and you restore it yourself within the 30 days — after that, Google deletes it for good. Restoring is admitted like creating a new project: your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier most study and demo use fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap: the backup bucket does not survive.** Nightly backups are written to a bucket inside the project, and that bucket is **not** protected by Cloud Storage's soft-delete, so it is very likely gone as soon as you delete the project — even though the project itself is recoverable for 30 days. If you have customised Crawl4AI and want to keep that work, copy a backup out (to Google Drive, or a bucket outside the project) before you delete. For a default installation with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

GKE Autopilot keeps at least one pod running, so it never scales to zero on its own. The option above only applies to a RAD-managed project; **in your own project, or once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 180 credits (US$18) in your own project. Deleting saves money only once Crawl4AI would otherwise sit unused for about 4 days or more in your own project (US$5.49 a day), or about 2 days or more in a RAD-managed one (117 credits a day).
- **Keep your data first.** Nightly backups are written to a bucket inside the deployment and are deleted with it, so copy the latest backup out before deleting if you want to keep it.
- **Note your settings.** RAD does not recreate a deleted deployment for you; you enter the settings again when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either the trainer funds every place, or each participant pays for their own. Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's own fees and daily-credit estimates from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the 30-day recovery window and what it says about Cloud Storage objects without soft delete. Prices change; check each source before relying on a figure.

## 1. Overview

Crawl4AI runs as a Python/ASGI service managed by supervisord. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Python pods, 4 vCPU / 8 GiB by default, horizontally autoscaled |
| Task queue | Embedded Redis (in-pod) | Supervisord starts Redis inside the container; ephemeral per pod |
| ASGI server | Embedded Gunicorn (in-pod) | Port 11235, managed by supervisord alongside Redis |
| Object storage | Cloud Storage | Optional buckets for crawl result caching (none by default) |
| Secrets | Secret Manager | API keys and JWT secret injected at runtime |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **No external database.** `database_type` is fixed to `NONE` — Cloud SQL is
  not provisioned. All task state lives in the in-pod Redis instance and is
  lost when the pod restarts.
- **Gen2 is not a concern on GKE.** Unlike Cloud Run, GKE provides a proper
  Linux process tree so supervisord runs without constraint. Chromium gets a
  real `/dev/shm` emptyDir volume — the `--disable-dev-shm-usage` Cloud Run
  workaround is not needed.
- **Redis runs inside the pod.** Do not set `REDIS_HOST` or `REDIS_PORT` as
  environment variables — they must stay at `localhost:6379` to reach the
  bundled instance.
- **Session affinity is `None`.** Task IDs issued by one pod are not visible to
  other pods; clients polling task status should route requests back to the
  originating pod or use synchronous crawl calls (`POST /crawl/sync`).
- **Security is off by default.** JWT authentication requires providing a
  `SECRET_KEY` via `secret_environment_variables` and a custom `config.yml`
  with `security.jwt_enabled=true`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Crawl4AI workload

Crawl4AI pods run on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the
minimum and maximum replica counts. Each pod runs its own supervisord tree:
Redis (priority 10) starts first, then Gunicorn (priority 20).

- **Console:** Kubernetes Engine → Workloads → select the Crawl4AI workload to
  see pods, revisions, and events. Kubernetes Engine → Services & Ingress shows
  the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  # Confirm supervisord is managing both processes:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- supervisorctl status
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and workload
type (Deployment vs StatefulSet) are managed.

### B. Embedded Redis and task queue

Redis runs inside each pod as a supervisord-managed process on
`localhost:6379`. It stores task results with a configurable TTL
(`redis_task_ttl_seconds`, default 3600 s). Task results are lost when the pod
restarts — this is expected for an ephemeral crawl API. There is no Memorystore
instance; the embedded Redis does not appear in the Console.

- **CLI (from inside a pod):**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- redis-cli ping
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- redis-cli info keyspace
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- redis-cli dbsize
  ```

### C. Cloud Storage (optional)

Crawl4AI has no default GCS bucket — it is stateless. Optional buckets can be
provisioned via `storage_buckets` to store crawl results or custom
`config.yml` files.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<results-bucket>/
  ```

See [App_GKE](App_GKE.md) for GCS Fuse mounts and CMEK options.

### D. Secret Manager

LLM API keys and the JWT signing secret are stored as Secret Manager secrets
and injected into pods at runtime; plaintext never appears in configuration.
Crawl4AI has no auto-generated secrets — all secrets must be provided via
`secret_environment_variables`.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Recognised secret names (pass the Secret Manager secret name, not the value):
`SECRET_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`,
`GROQ_API_KEY`, `GEMINI_API_KEY`, `LLM_API_KEY`.

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and
rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP.
A custom domain with a Google-managed certificate can be enabled, and a static
IP can be reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN,
and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr (Python logs via `PYTHONUNBUFFERED=1`) flow to Cloud Logging.
GKE metrics flow to Cloud Monitoring. Optional uptime checks and alert policies
are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Crawl4AI Application Behaviour

- **Supervisord startup sequence.** On every pod start, supervisord (PID 1)
  starts Redis first (priority 10), then Gunicorn (priority 20). The `/health`
  endpoint only responds after both processes are ready — allow at least 40
  seconds of initial delay before health checks start.
- **REST API endpoints.** Crawl4AI exposes:

  | Endpoint | Method | Purpose |
  |---|---|---|
  | `/crawl` | POST | Submit an asynchronous crawl job; returns a `task_id` |
  | `/task/{id}` | GET | Poll status and retrieve results for a task |
  | `/crawl/sync` | POST | Synchronous crawl (blocks until complete) |
  | `/health` | GET | Health check — returns `{"status":"ok"}` when ready |
  | `/playground` | GET | Interactive browser-based crawl UI |

- **Task result lifecycle.** Async crawl results are stored in the embedded
  Redis with a TTL of `redis_task_ttl_seconds` (default 1 hour). After the TTL
  expires the result is gone. There is no durable result store.
- **No database migrations or initialization jobs.** Crawl4AI is fully
  stateless — `Crawl4AI_Common` supplies no initialization job. No database
  setup is required.
- **LLM-based extraction.** Provide LLM API keys via `secret_environment_variables`
  and set `LLM_PROVIDER` (or provider-specific keys such as `OPENAI_API_KEY`)
  via `environment_variables` to enable AI-driven content extraction.
- **JWT authentication (optional).** Security is disabled by default.
  To enable, supply `SECRET_KEY` via `secret_environment_variables` and provide
  a custom `config.yml` with `security.jwt_enabled=true`. The `/token` endpoint
  issues short-lived JWTs when authentication is enabled.
- **`CRAWL4AI_HOOKS_ENABLED` warning.** Setting this variable to `"true"`
  enables arbitrary Python code execution via webhook hooks. Only enable in
  a fully trusted environment.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Crawl4AI are listed; every other input is
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
| `application_name` | `crawl4ai` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Crawl4AI Web Crawler` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `0.7.8` | Crawl4AI image version tag; pin to a specific tag for production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision IAM without deploying the workload. |
| `workload_type` | `null` | `"Deployment"` (default, stateless) or `"StatefulSet"` for PVC-backed caching. |
| `container_resources` | `{ cpu_limit="4", memory_limit="8Gi", cpu_request="2", mem_request="4Gi" }` | Container CPU and memory. Minimum 4 GiB memory for stable Chromium operation. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 so a warm Chromium pool is always available. |
| `max_instance_count` | `5` | Maximum replicas (autoscaler ceiling). |
| `timeout_seconds` | `1800` | Pod termination grace period; set ≥ 1800 to allow long batch crawls to drain. |
| `termination_grace_period_seconds` | `60` | Seconds Kubernetes waits after SIGTERM before force-killing. |
| `service_type` | `LoadBalancer` | How the Service is exposed. Use `ClusterIP` for cluster-internal access only. |
| `session_affinity` | `None` | No sticky routing — task IDs are pod-local; use `/crawl/sync` for cross-pod reliability. |
| `container_image_source` | `prebuilt` | `"prebuilt"` uses `unclecode/crawl4ai` directly; `"custom"` builds via Cloud Build. |
| `container_image` | `unclecode/crawl4ai` | Image URI when `container_image_source = "prebuilt"`. |
| `enable_image_mirroring` | `true` | Mirror the image into Artifact Registry to avoid Docker Hub rate limits. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `PYTHONUNBUFFERED` and `REDIS_TASK_TTL` are set automatically. **Do not set `REDIS_HOST` or `REDIS_PORT`**. Recognised overrides: `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_TEMPERATURE`, `CRAWL4AI_HOOKS_ENABLED`. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use for `SECRET_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Target cluster name. Leave empty to auto-discover. |
| `gke_cluster_selection_mode` | `primary` | Cluster selection strategy. |
| `namespace_name` | `""` | Kubernetes namespace. Generated from resource prefix when empty. |
| `enable_multi_cluster_service` | `false` | Enable Multi-Cluster Services ServiceExport. |
| `reserve_static_ip` | `true` | Reserve a static external IP for the load balancer so the address survives redeploys (fleet-wide default per the GKE campaign — an ephemeral IP can otherwise leave `GKE_SERVICE_URL`/self-referencing config pointed at unreachable internal DNS). |
| `static_ip_name` | `""` | Name of an existing static IP to use. Leave empty to auto-create. |

### Group 7 — Backup & Maintenance

Not applicable for Crawl4AI — the service is stateless and carries no database.
`backup_schedule`, `backup_retention_days`, and `enable_backup_import` are
present for interface compatibility but have no effect.

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_cpu_requests` | `8` | Total CPU requests allowed across all pods. |
| `quota_cpu_limits` | `16` | Total CPU limits allowed. |
| `quota_memory_requests` | `32Gi` | **Must use binary units (`32Gi`, `8192Mi`)** — bare integers are read as bytes and block scheduling. |
| `quota_memory_limits` | `64Gi` | **Must use binary units** — same constraint as `quota_memory_requests`. |
| `quota_max_pods` | `20` | Maximum pods in the namespace. |

### Group 9 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 10 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Crawl4AI_Common supplies no default init job — leave empty unless a custom setup step is needed. |
| `cron_jobs` | `[]` | Optional Kubernetes CronJobs (e.g., periodic cache-warming crawls). |

### Group 11 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision any buckets listed in `storage_buckets`. |
| `storage_buckets` | `[]` | No buckets by default — Crawl4AI is stateless. Add entries to provision crawl-result buckets. |
| `gcs_volumes` | `[]` | GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — no Cloud SQL instance is provisioned for Crawl4AI. |

All other database variables (`enable_cloudsql_volume`, `sql_instance_name`,
etc.) are present for interface compatibility and have no effect.

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` / `startup_probe` | HTTP `/health`, 40 s initial delay | Allow supervisord time to start Redis then Gunicorn before the first probe fires. |
| `health_check_config` / `liveness_probe` | HTTP `/health`, 60 s initial delay | Liveness probe after startup. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 16 — Advanced GKE Features

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. Skipped automatically when `max_instance_count ≤ 1`. |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 if you need eviction headroom. |
| `enable_topology_spread` | `false` | Spread pods across zones. |
| `enable_network_segmentation` | `false` | Apply Kubernetes NetworkPolicies to isolate the namespace. |

### Group 17 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable PVC templates if local cache persistence is required. |
| `stateful_pvc_size` | `20Gi` | PVC size per pod. |
| `stateful_pvc_mount_path` | `/mnt/data` | Container path for the PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass. |

### Group 19 — Crawl4AI Application Settings

| Variable | Default | Description |
|---|---|---|
| `redis_task_ttl_seconds` | `3600` | TTL in seconds for task results in embedded Redis. Valid range: 300–86400. Too short causes results to expire before clients poll; too long causes unbounded memory growth. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way
to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Crawl4AI. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of any setup jobs. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
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
| `memory_limit` (in `container_resources`) | `8Gi` | Critical | Below 4 GiB, Chromium processes are OOM-killed mid-crawl returning partial results; below 2 GiB the container fails to start. |
| `quota_memory_requests` / `quota_memory_limits` | binary units (`32Gi`) | Critical | Bare integers are read as bytes by Kubernetes and block all pod scheduling. |
| `REDIS_HOST` / `REDIS_PORT` (env vars) | do not set | Critical | Overriding these breaks the embedded Redis connection; all async crawl jobs fail immediately. |
| `database_type` | `NONE` | Critical | Crawl4AI has no database; changing this causes unnecessary Cloud SQL provisioning and a startup failure. |
| `min_instance_count` | `1` | High | Scale-to-zero (`0`) causes 30–60 s cold starts (supervisord must boot Redis then Gunicorn); the first request typically times out. |
| `cpu_limit` (in `container_resources`) | `4` | High | Below 2 vCPU, Chromium JavaScript rendering triggers internal timeouts on complex pages, slowing crawl throughput significantly. |
| `enable_iap` / `enable_cloud_armor` | enable for production | High | Without IAP or a crawl API token, the LoadBalancer IP is publicly accessible and anyone can submit crawl jobs. |
| `LLM_API_KEY` / provider API keys | via `secret_environment_variables` | High | Missing or expired keys cause LLM-based extraction to fail silently (empty `extracted_content`). Inject as secrets, not plain-text env vars. |
| `redis_task_ttl_seconds` | `3600` | Medium | Too short (< 300 s) causes results to expire before async clients poll; too long causes unbounded Redis memory growth. |
| `session_affinity` | `None` | Medium | Setting to `ClientIP` pins clients to one pod and breaks load distribution without helping task routing (task IDs are already pod-local). |
| `application_version` | pinned tag | Medium | Using `"latest"` is non-reproducible; a rebuild may pull a breaking Crawl4AI API change. |
| `enable_image_mirroring` | `true` | Low | Crawl4AI images are large; without mirroring, every pod start pulls from Docker Hub and risks rate-limit failures. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, and image mirroring — see
**[App_GKE](App_GKE.md)**. Crawl4AI-specific shared application configuration is
described in **[Crawl4AI_Common](Crawl4AI_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Crawl4AI on GKE Autopilot](../labs/Crawl4AI_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Crawl4AI on Google Cloud Run](Crawl4AI_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Crawl4AI Common — Shared Application Configuration](Crawl4AI_Common.md) — the configuration shared by both deployment targets.
