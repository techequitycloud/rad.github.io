---
title: "Ollama on GKE Autopilot"
description: "Configuration reference for deploying Ollama on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Ollama on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ollama_GKE.png" alt="Ollama on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ollama is an open-source LLM inference server that serves large language models — Llama,
Mistral, Gemma, Phi, and others — via a REST API. This module deploys Ollama on **GKE
Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and manages
the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Ollama uses and how to explore and operate them
from the Google Cloud Console and the command line. For the mechanics that are common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to
the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## What Ollama costs on RAD, and how that compares

**Ollama on RAD's GKE Autopilot module costs about US$323–396 a month, with the module fee charged once in RAD credits.** GKE Autopilot suits Ollama that must stay up, scale across pods or run beside other Kubernetes workloads; for the lowest cost, the [Cloud Run module](Ollama_CloudRun.md) runs the same Ollama for about US$85 a month. If you only need it occasionally — a demo, a seasonal project, something you're evaluating — a RAD-managed project can be deleted and restored within 30 days for a handful of credits (under US$1) instead of paying for it to sit idle. See **Pause it for free**, below. Figures are as at 8 October 2026; sources are listed at the end of this section.

### What you pay on RAD

RAD deploys **Ollama**, which is open source, so there is no licence fee per user. You pay for
three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 300 credits (US$30 at the top-up price) | 270 credits (10% lower) |
| Build time | About 3-6 credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$323 a month** for the default configuration (table below) — more if this isn't your only Autopilot cluster | Metered hourly in credits; RAD publishes **180 credits a day**, about 5,400 a month (about US$540 at the top-up price, US$432 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second set of them.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 8x vCPU / 16 GiB | US$317.38 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | shared across every GKE app in the project; $0 if this is your only cluster, else ~73 |
| **Total** | **about US$323** (about US$396 if this isn't your only Autopilot cluster) |

### How it compares

- **No turnkey managed SaaS was verified for Ollama itself**, so the honest comparison is a self-managed server: a Hetzner CPX22 (2 vCPU/4 GB) costs about $24/month, a DigitalOcean 2 vCPU/4 GB Droplet about $24/month, and a GCP Compute Engine e2-standard-2 (2 vCPU/8 GB) about $49/month.
- This needs considerably more CPU and memory than the reference boxes below, so a self-managed equivalent would cost noticeably more than the $24-49/month entry-level class — likely a dedicated high-memory instance.
- There is no managed SaaS that hosts *your own* Ollama instance the way this module does — a hosted model-inference API is a different product from a private inference server, so it isn't a like-for-like comparison and no figure is given here. The realistic alternative is self-hosting on your own hardware or a cloud VM sized for the models you run.
- **The VPS price is not the whole cost.** On a bare VPS you are also the one patching the OS, rotating backups and keeping the database (if any) healthy. RAD's managed Cloud SQL, Secret Manager and monitoring cover that for you, which is the real argument for RAD over a cheaper box — not the sticker price.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Ollama runs in **a project RAD manages for you**, you have a second option that goes well
beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to
nothing.** This suits Ollama you only need occasionally — a demo, an evaluation, a seasonal
project — far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google to
  delete the project. Google does not remove the project immediately: it keeps it, recoverable,
  for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike
  deleting one module, this does not tear down the cluster or the compute resource
  one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a few credits, not a rebuild.** Within 30 days, the project's owner can restore
  it. RAD asks Google to undelete the project and reattaches its billing account, then asks you to
  run **Update** on each deployment to confirm everything came back. Because nothing was
  individually destroyed, that Update finds the same resources already there — it is a check, not a
  rebuild, and an Update never charges the module fee again. That costs roughly a handful of credits (under US$1) in
  total for a typical 2-3-deployment chain.
- **So a month of occasional use can cost a few dollars, not US$323.** Deploy Ollama, use
  it for a while, delete the project. Restore it next time you want it, confirm with Update, and
  delete it again when you're done. You pay only for the module fee once, the builds, and whatever
  time Ollama was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages billing
  for), and you restore it yourself within the 30 days — after that, Google deletes it for good.
  Restoring is admitted like creating a new project: your purchased credit balance must still clear
  the tier's floor (100 credits for the sandbox tier most study and demo use fits). Google says most
  services are fully working again within 36 hours of a restore.
- **One real gap: nightly backups don't survive.** Backups are written to a bucket inside the
  project, and that bucket is **not** protected by Cloud Storage's soft-delete, so it is very likely
  gone as soon as you delete the project — even though the project itself is recoverable for 30
  days. If you've customised Ollama and want to keep that work, copy a backup out (to Google Drive,
  or a bucket outside the project) before you delete. For a default installation with nothing
  irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

The option above only applies to a RAD-managed project; **in your own project, or once the 30-day
window has passed, the way to stop paying is to delete the deployment and deploy it again when you
need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 305
  credits (US$30.50) in your own project, or 275
  credits in a RAD-managed one. Deleting saves money once Ollama would otherwise sit unused for
  about 3 days or more in your own project (about US$10.78 a
  day), or about 2 days or more in a RAD-managed one (180 credits a
  day).
- **Most of the running cost is usually the database and any shared file/cache VM.** They stop only
  when nothing else in the project uses them, so deleting Ollama while something else shares the
  project saves only this app's own compute part.
- **Keep your data first.** Nightly backups go to a bucket inside the deployment and are deleted
  with it, so copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  Ollama in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs Ollama for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing
  pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands
  the project over and the deployments become the client's own.
- Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by
  card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the 30-day recovery window and what it says about Cloud Storage objects without soft delete; RAD fees and the daily-credit estimates from [radmodules.dev/pricing](https://radmodules.dev/pricing). Prices change; check each source before relying on a figure.

## 1. Overview

Ollama runs as a containerised inference server. The deployment wires together a focused set
of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Ollama pods, 8 vCPU / 16 GiB by default (7B models), horizontally autoscaled |
| Model storage | Cloud Storage + GCS Fuse CSI | Models bucket mounted at `/mnt/gcs`; weights persist across pod restarts |
| Secrets | Secret Manager | No app-managed secrets — Ollama requires no credentials |
| Ingress | Kubernetes ClusterIP | Internal-only by default; use `LoadBalancer` only when external access is required |

**Sensible defaults worth knowing up front:**

- **No database, no Redis.** Ollama is stateless beyond its GCS-backed model cache. Neither
  Cloud SQL nor Redis is provisioned.
- **GCS Fuse is the persistence layer.** Model weights are stored in a dedicated GCS bucket
  and mounted into the pod at `/mnt/gcs`. Pod restarts load models from GCS rather than
  re-downloading them.
- **ClusterIP by default.** Ollama is designed as a shared in-cluster inference endpoint. Any
  pod in the same cluster reaches it at
  `http://<service-name>.<namespace>.svc.cluster.local:11434`. Setting `service_type =
  "LoadBalancer"` exposes the unauthenticated API publicly — do not do this without IAP or
  Cloud Armor.
- **Automatic model pull.** When `default_model` is set and no custom `initialization_jobs`
  are provided, a Kubernetes Job named `model-pull` is created on first deployment and stores
  the model in the GCS bucket.
- **Three environment variables are always injected:** `OLLAMA_MODELS`, `OLLAMA_HOST`, and
  `OLLAMA_KEEP_ALIVE`. Do not override `OLLAMA_MODELS` or `OLLAMA_HOST` in
  `environment_variables`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other identifiers
are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Ollama workload

Ollama pods are scheduled on Autopilot, which bills for the CPU and memory the pods actually
request. Horizontal Pod Autoscaling scales the deployment between the minimum and maximum
replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Ollama workload to see pods and
  events. Kubernetes Engine → Services & Ingress shows the ClusterIP (or external IP when
  `service_type = "LoadBalancer"`).
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  # Verify Ollama is responding inside the cluster:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    curl -s http://localhost:11434/api/tags | jq '.models[].name'
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud Storage — model weight persistence

Ollama model weights are stored in a dedicated GCS bucket (named
`<resource_prefix>-models`) and mounted into every pod via the **GCS Fuse CSI driver** at
`/mnt/gcs`. The environment variable `OLLAMA_MODELS` is set to
`/mnt/gcs/ollama/models` so Ollama discovers and caches models there.

- **Console:** Cloud Storage → Buckets → select the models bucket to browse downloaded model
  files.
- **CLI:**
  ```bash
  # Bucket name is in the Outputs (models_bucket)
  gcloud storage ls gs://<models-bucket>/ollama/models/
  gcloud storage buckets describe gs://<models-bucket> --project "$PROJECT"
  # Confirm the GCS volume is mounted inside a running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /mnt/gcs/ollama/models/
  ```

The bucket name is reported as the `models_bucket` output. See
[App_GKE](App_GKE.md) for GCS Fuse, CMEK options, and bucket lifecycle policies.

### C. Secret Manager

Ollama requires no application-managed credentials — there is no admin password and no
database password. Secret Manager is available for any custom secrets you inject via
`secret_environment_variables`.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### D. Networking & ingress

By default the Ollama service is exposed only within the cluster (ClusterIP). When
`service_type = "LoadBalancer"` is set, an external Cloud Load Balancing IP is provisioned.
A custom domain, Cloud Armor WAF, and IAP can be layered on for external access scenarios.

- **Console:** Kubernetes Engine → Services & Ingress; Network services → Load balancing;
  VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  # Internal cluster URL (printed as ollama_cluster_url output):
  echo "http://<service-name>.$NAMESPACE.svc.cluster.local:11434"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### E. Cloud Logging & Monitoring

Pod stdout/stderr flows to Cloud Logging; GKE metrics flow to Cloud Monitoring. Optional
uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Ollama Application Behaviour

- **No first-deploy database setup.** Ollama has no database. There is no `db-init` job and
  no Cloud SQL instance.
- **Model pull on first deploy.** When `default_model` is set and `initialization_jobs` is
  empty, a Kubernetes Job named `model-pull` runs once. It starts a local Ollama server in
  the background, pulls the named model, stores it in the GCS bucket, then shuts down. The
  job mounts the `ollama-models` GCS volume so the weights persist. The timeout is controlled
  by `model_pull_timeout_seconds` (default 3600 seconds); large models (7B+) can take 20–30
  minutes on first pull.
- **Cold-start model loading.** On each pod start, Ollama loads model weights from GCS Fuse.
  This typically takes 30–120 seconds depending on model size. The startup probe uses a 30 s
  initial delay with 20 failure attempts (roughly 5 minutes) to accommodate this.
  `OLLAMA_KEEP_ALIVE` is set to `"24h"` so loaded models stay resident in memory between
  requests. Override via `environment_variables`.
- **Automatically injected variables.** `OLLAMA_MODELS` (`/mnt/gcs/ollama/models`),
  `OLLAMA_HOST` (`0.0.0.0:11434`), and `OLLAMA_KEEP_ALIVE` (`24h`) are injected
  automatically. Do not override the first two; the third may be overridden.
- **Health endpoint.** The Ollama root path (`/`) responds with `"Ollama is running"` once
  the server is ready. Readiness and liveness probes target this path.
- **Additional tuning.** Use `environment_variables` to set `OLLAMA_NUM_PARALLEL` (default
  `1`, increase for concurrent callers), `OLLAMA_ORIGINS` (restrict CORS), and other Ollama
  environment variables.
- **Manual model management.** Pull additional models or remove existing ones directly:
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ollama pull mistral
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ollama list
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ollama rm mistral
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Ollama are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

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
| `application_name` | `ollama` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Ollama LLM Server` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Workload description annotation. |
| `application_version` | `latest` | Ollama image tag; pin to a specific version (e.g., `0.3.12`) in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision storage and IAM without deploying the workload. |
| `container_resources` | `{ cpu_limit="8", memory_limit="16Gi", cpu_request="4", mem_request="8Gi" }` | Container CPU and memory. 3B models: `cpu_limit="4"`, `memory_limit="8Gi"`. 7B models: `cpu_limit="8"`, `memory_limit="16Gi"`. |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 to avoid cold-start model-load latency on each request. |
| `max_instance_count` | `3` | Maximum replicas (autoscaler ceiling). Each pod independently loads the model into memory — size accordingly. |
| `timeout_seconds` | `300` | Pod termination grace period. Increase for long-running inference requests. |
| `termination_grace_period_seconds` | `60` | Seconds Kubernetes waits before force-killing the pod after SIGTERM. |
| `service_type` | `ClusterIP` | Kubernetes Service type. `ClusterIP` keeps the API internal. `LoadBalancer` exposes it publicly without authentication. |
| `session_affinity` | `None` | Session affinity for the Kubernetes Service. `ClientIP` improves multi-turn context continuity but skews load distribution. |
| `enable_image_mirroring` | `true` | Mirror `ollama/ollama` to Artifact Registry to avoid Docker Hub rate limits. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |
| `container_image_source` | `prebuilt` | Not forwarded — `main.tf` pins `"prebuilt"`, so `ollama/ollama:<application_version>` is always mirrored and never built. |
| `container_image` | `ollama/ollama` | Full image URI when `container_image_source = "prebuilt"`. |
| `enable_cloudsql_volume` | `false` | Not needed for Ollama (no database). |

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in via Identity-Aware Proxy. Recommended when `service_type = "LoadBalancer"`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled. |
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. |
| `application_domains` | `[]` | Custom hostnames for the load balancer. |
| `enable_custom_domain` | `true` | Configure a custom domain and managed certificate. |
| `reserve_static_ip` | `true` | Reserve a stable external IP address. |
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `OLLAMA_MODELS`, `OLLAMA_HOST`, and `OLLAMA_KEEP_ALIVE` are injected automatically. Use `OLLAMA_NUM_PARALLEL`, `OLLAMA_ORIGINS`, etc. here. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. |

### Group 7 — Backup & Maintenance

Not applicable for Ollama — model weights are stored durably in GCS. These variables are
present for interface compatibility only. See [App_GKE](App_GKE.md).

### Group 8 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

Also in this group: `enable_resource_quota`, `quota_cpu_requests`, `quota_cpu_limits`,
`quota_memory_requests`, `quota_memory_limits`, `quota_max_pods`, `quota_max_services`,
`quota_max_pvcs`. When `enable_resource_quota = true`, memory values **must use binary unit
suffixes** (`4Gi`, `8192Mi`) — bare integers are treated as bytes by Kubernetes and block all
pod scheduling.

### Group 9 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty and set `default_model` to use the auto-generated model-pull job. Provide a non-empty list to replace it entirely. |
| `cron_jobs` | `[]` | Recurring Kubernetes CronJobs for model management or other tasks. |
| `additional_services` | `[]` | Additional containers deployed as separate Kubernetes Deployments (e.g., a Qdrant vector database alongside Ollama). |
| `enable_topology_spread` | `false` | Spread pods across zones for higher availability. |

### Group 11 — Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision GCS buckets in `storage_buckets`. The models bucket is always created regardless. |
| `storage_buckets` | `[]` | Additional GCS buckets beyond the models bucket. |
| `enable_nfs` | `false` | Not required for Ollama (uses GCS Fuse). |
| `gcs_volumes` | `[]` | Additional GCS Fuse volume mounts. The `ollama-models` bucket at `/mnt/gcs` is always appended automatically. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 12 — Database Backend

Not applicable for Ollama. `database_type` is fixed to `"NONE"` — no Cloud SQL instance is
provisioned. These variables are present for interface compatibility only.

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | `{ type="HTTP", path="/", initial_delay_seconds=30, failure_threshold=20 }` | 20-attempt threshold allows ~5 minutes for model loading from GCS. |
| `liveness_probe` | `{ type="HTTP", path="/", initial_delay_seconds=60, failure_threshold=3 }` | 60 s delay avoids false restarts during model load. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check; disabled by default, enable explicitly to activate. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 15 — Redis

Not applicable for Ollama. `enable_redis` is hard-coded to `false` regardless of this
setting.

### Group 16 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `gke_cluster_name` | `""` | GKE cluster name; leave empty for auto-discovery from Services_GCP. |
| `namespace_name` | `""` | Kubernetes namespace; auto-generated from the application name when empty. |
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Ensure `max_instance_count ≥ 2` when using a PDB so rolling upgrades can proceed. |
| `deployment_timeout` | `1800` | Seconds Terraform waits for the Deployment rollout. Increase to `1200` for large models (13B+). |

### Group 17 — StatefulSet

Applies only when `workload_type = "StatefulSet"`. The default Deployment workload with GCS
Fuse persistence is recommended; these settings are not needed in the typical case.

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable a PVC for local model storage. Not required when using GCS Fuse. |
| `stateful_pvc_size` | `50Gi` | PVC size (e.g., `"100Gi"` for multiple large models). |
| `stateful_pvc_mount_path` | `/mnt/data` | Container path for the PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass. |

### Group 19 — Ollama Model Configuration

| Variable | Default | Description |
|---|---|---|
| `default_model` | `""` | Model to pull on first deployment (e.g., `"llama3.2:3b"`, `"mistral"`, `"phi3:mini"`). Leave empty to skip the auto-pull job. |
| `model_pull_timeout_seconds` | `3600` | Timeout for the model-pull Kubernetes Job. Large models (7B+) can take 20–30 minutes. Valid range: 300–7200. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate and
explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `ollama_cluster_url` | Internal Kubernetes URL: `http://<service-name>.<namespace>.svc.cluster.local:11434`. Use this in other pods to call the Ollama API. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP (when `service_type = "LoadBalancer"` and a static IP is reserved). |
| `api_url` | Service URL. |
| `models_bucket` | GCS bucket name where Ollama model weights are persisted. |
| `storage_buckets` | All provisioned Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of the setup jobs (including `model-pull` when triggered). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `kubernetes_ready` | `true` when the cluster endpoint is available and workloads are deployed. `false` on first apply of a new inline cluster — re-run apply to complete. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `service_type` | `ClusterIP` | Critical | `LoadBalancer` exposes the unauthenticated Ollama API publicly on port 11434. Ollama has no built-in auth. |
| `container_resources.memory_limit` | `16Gi` (7B) / `8Gi` (3B) | Critical | Insufficient memory causes OOM-kill mid-inference and crash-loops the pod. Allocate at least 2× the quantised model weight size. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8Gi`) | Critical | Bare integers (e.g., `"4"`) are treated as bytes by Kubernetes and block all pod scheduling in the namespace. |
| `enable_iap` | `true` if `service_type = "LoadBalancer"` | Critical | Without IAP or VPC restriction, the Ollama API is unauthenticated and publicly reachable. |
| `container_resources.cpu_limit` | `8` (7B) / `4` (3B) | High | Too few CPUs makes token generation extremely slow. For production 7B inference, 6–8 cores are needed. |
| `min_instance_count` | `1` | High | `0` enables scale-to-zero but causes 60–120 s cold starts while the model reloads from GCS. |
| `model_pull_timeout_seconds` | `3600` | High | A short timeout causes the model-pull Job to fail before the download completes for models over 2 GB. |
| `deployment_timeout` | `600` | High | Too short for a large model (13B+) loading from GCS on first start. Increase to `1200`. |
| `max_instance_count` | `3` | High | Each pod independently loads the full model into memory. Three 7B replicas require ~48 GiB. |
| `default_model` | set to desired model | Medium | Leaving empty is safe for initial deploy but the API returns an error on all inference requests until a model is pulled manually. |
| `environment_variables.OLLAMA_NUM_PARALLEL` | `2`–`4` for shared use | Medium | Default `1` serialises all requests. Increase for shared cluster deployments with concurrent callers. |
| `environment_variables.OLLAMA_KEEP_ALIVE` | `24h` (injected automatically) | Medium | Ollama's own default (`5m`) evicts models from memory after inactivity, causing 30–60 s reload delays. The module injects `24h` automatically. |
| `enable_pod_disruption_budget` | `true` | Medium | With `pdb_min_available = 1` and only one replica, rolling node upgrades stall. Ensure `max_instance_count ≥ 2`. |
| `enable_resource_quota` | enable for shared clusters | Medium | Without a ResourceQuota, a misconfigured pod can consume all cluster resources. |
| `gcs_volumes` mount options | include `implicit-dirs` | Medium | Without `implicit-dirs`, GCS Fuse directory listings fail and Ollama cannot discover cached models. |
| `enable_image_mirroring` | `true` | Medium | Disabling pulls from Docker Hub, which is rate-limited. Keep `true` in production. |

---

For the foundation behaviour referenced throughout — Workload Identity, autoscaling, ingress
and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and image
mirroring — see **[App_GKE](App_GKE.md)**. Ollama-specific shared application configuration
is described in **[Ollama_Common](Ollama_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Ollama on GKE Autopilot](../labs/Ollama_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Ollama on Google Cloud Run](Ollama_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Ollama Common — Shared Application Configuration](Ollama_Common.md) — the configuration shared by both deployment targets.
