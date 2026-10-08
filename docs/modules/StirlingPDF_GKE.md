---
title: "Stirling-PDF on GKE Autopilot"
description: "Configuration reference for deploying Stirling-PDF on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Stirling-PDF on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/StirlingPDF_GKE.png" alt="Stirling-PDF on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Stirling-PDF is an open-source (MIT-licensed core), locally-hosted web PDF toolkit —
merge, split, convert, OCR, compress, watermark, sign, redact, and 50+ other PDF
operations, all processed on your own infrastructure so documents never touch a
third-party service. This module deploys Stirling-PDF on **GKE Autopilot** on top of
the [App_GKE](App_GKE.md) foundation, which provisions and manages the shared Google
Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Stirling-PDF uses and how to explore and
operate them from the Google Cloud Console and the command line. For the mechanics
that are common to every GKE application — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather
than repeating them here.

---

## What Stirling-PDF costs on RAD, and how that compares

**Stirling-PDF on RAD's GKE Autopilot module costs about US$45.68 a month in a Google Cloud project you own, with the module fee charged once in RAD credits.** GKE suits Stirling-PDF that needs to sit beside other Kubernetes workloads; for the lowest cost, the [Cloud Run module](StirlingPDF_CloudRun.md) runs the same Stirling-PDF for about US$19.16 a month instead. If you only need it occasionally — a batch of documents, a one-off conversion job — a RAD-managed project can be deleted and restored within 30 days for a handful of credits (under US$1) instead of paying for it to sit idle. See **Pause it for free**, below. Figures are as at 8 October 2026; sources are listed at the end of this section.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 40 credits (US$4 at the top-up price) | 36 credits (10% lower) |
| Build time | About 3-6 credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$45.68 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **64 credits a day**, about 1,920 a month |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the network is shared by every application in the project, so a second application does not add a second set of it.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 1x vCPU / 2 GiB | US$39.68 |
| Cloud NAT and networking | US$5.00 |
| Cloud Storage (add-ons, backups) | US$1.00 |
| GKE cluster management fee | shared across every GKE app in the project; $0 if this is your only cluster, else ~73 |
| **Total** | **US$45.68** |

### How it compares

- Stirling PDF's own hosted plan, **Stirling PDF Team**, costs **$99/month for up to 100 users** on its hosted SaaS — a per-organisation fee aimed at teams, not infrastructure cost (source: [stirling.com/pricing](https://www.stirling.com/pricing)). RAD's own-project figure is a small fraction of that because it's the raw GKE compute cost with no per-seat software fee layered on.
- A self-managed comparison: Hetzner CPX22 (2 vCPU/4GB) runs about $24/month, a DigitalOcean 2 vCPU/4GB Droplet is the same $24/month, and a GCP Compute Engine e2-standard-2 (2 vCPU/8GB) is about $49/month — in the same range as RAD's own-project GKE figure once the shared cluster fee is excluded, and all need to be kept patched by hand, which RAD's managed Secret Manager and monitoring otherwise cover.
- With no database and no persistent state, Stirling-PDF is close to the floor of what any GKE deployment on RAD costs — almost the whole bill is the pod itself plus the shared cluster management fee.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Stirling-PDF runs in a project RAD manages for you, deleting the whole project unlinks its billing first, then asks Google to delete the project outright — Google's own 30-day recoverable soft delete. Unlike deleting one module, this does not tear down the compute resource one by one: the whole project simply stops, and nothing is charged while it waits, because billing is already unlinked.

Restoring, within 30 days and only by the project's owner, asks Google to undelete the project and reattaches its billing account, then asks you to run Update on each deployment to confirm everything came back. Because nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a rebuild, and an Update never charges the module fee again. This costs only a handful of credits (under US$1) in total for a typical 2-3-deployment chain.

What this needs: you must own the project (not one RAD only manages billing for), you must restore it yourself within 30 days — after that Google deletes it for good — and restoring is admitted like creating a new project, so your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier most study/demo use fits). Google says most services are fully working again within 36 hours of a restore.

One real gap: nightly backups are written to a bucket inside the project, and that bucket has Cloud Storage's soft-delete explicitly turned off, so it is very likely gone as soon as you delete the project — even though the project itself is recoverable for 30 days. Stirling-PDF itself holds no database, so for a default install with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

In your own project, or once the 30-day restore window has passed, the alternative is to delete Stirling-PDF outright and redeploy it later. A redeploy costs the module fee again, plus the builds — roughly 45 credits (about US$4.50) in your own project, or 41 credits in a RAD-managed one.

Deleting saves money only once Stirling-PDF would otherwise sit unused long enough to clear that redeploy cost against its own daily running cost — against the own-project total above (about US$1.52 a day), that works out to about 3 days or more, or about 1 days or more in a RAD-managed one (64 credits a day). There's no database here, so deleting this app frees its entire running cost rather than just a share of it — only the shared cluster fee, if any, keeps running for other apps.

Keep data first: anything Stirling-PDF writes to a backup bucket inside the deployment is deleted with it, so copy anything you want to keep out before deleting.

### Lab sessions and Managed Environments

- **Lab sessions, for training:** a trainer runs a session for a class. Each participant gets the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either the trainer funds every place, or each participant pays for their own. Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies:** a partner runs the app for a client from a ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over and the deployments become the client's own.
- Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; [radmodules.dev/pricing](https://radmodules.dev/pricing) for RAD's own fees and daily-credit estimates; [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics; [stirling.com/pricing](https://www.stirling.com/pricing) for Stirling PDF Team's hosted price.

## 1. Overview

Stirling-PDF runs as a Java / Spring Boot web workload (with a bundled LibreOffice
for document conversions). The deployment wires together a deliberately small set of
Google Cloud services — Stirling-PDF is stateless, so there is no database, no
persistent storage, and no secrets to manage:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Java pods, 1 vCPU / 2 GiB by default, horizontally autoscaled |
| Container image | Artifact Registry | Official `stirlingtools/stirling-pdf` image, mirrored in by default |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |
| Redis (inert) | Redis | Off by default. `enable_redis` only makes the Foundation inject `REDIS_*` env vars — Stirling-PDF never reads them, so this provides no rate limiting or bot detection |
| Observability | Cloud Logging / Cloud Monitoring | Pod logs, metrics, optional uptime check and alerts |

**Sensible defaults worth knowing up front:**

- **Stateless — no database, no storage, no secrets.** `database_type = "NONE"`,
  no GCS buckets, no NFS, `workload_type = Deployment`, and an empty secret map.
  Every PDF operation runs in a per-request ephemeral working directory discarded
  on completion.
- **Prebuilt image.** `container_image_source = "prebuilt"` deploys the official
  `stirlingtools/stirling-pdf` image directly; `enable_image_mirroring = true`
  mirrors it into Artifact Registry to avoid Docker Hub rate limits.
- **Login is disabled by default.** `enable_login = false`
  (`SECURITY_ENABLELOGIN=false`) ships an open instance. Enable it and front the
  workload with IAP or Cloud Armor for a private deployment.
- **Minimum 1 replica.** GKE does not support scale-to-zero; `min_instance_count = 1`
  keeps the toolkit reachable. Because there is no shared state, scaling out to
  `max_instance_count > 1` needs no coordination mechanism at all — Redis or
  otherwise.
- **2 GiB memory floor.** The JVM plus LibreOffice needs at least `2Gi`; raise
  `container_resources.memory_limit` for heavy OCR / conversion workloads.
- **External LoadBalancer with a stable IP.** `service_type = "LoadBalancer"`,
  `reserve_static_ip = true`, and `enable_custom_domain = true` by default.
- **Health probes hit `/api/v1/info/status`** — a public, unauthenticated endpoint
  returning 200 once the JVM and LibreOffice have initialised. The full image can
  take 2–4 minutes to bind its port on a cold-provisioned Autopilot node, so the
  startup probe allows a ~5 minute window (20s initial delay, 30 × 10s failures).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Stirling-PDF workload

Stirling-PDF pods are scheduled on Autopilot, which bills for the CPU/memory the
pods actually request. Horizontal Pod Autoscaling sizes the deployment between the
minimum and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Stirling-PDF workload to
  see pods and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Artifact Registry — the container image

The official `stirlingtools/stirling-pdf` image is mirrored into Artifact Registry
(`enable_image_mirroring = true`) and the cluster pulls it from there. No Cloud
Build step runs — the image is prebuilt upstream.

- **Console:** Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  ```

See [App_GKE](App_GKE.md) for the mirroring mechanism and image retention.

### C. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP.
A custom domain with a Google-managed certificate can be enabled, and a static IP is
reserved by default so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### D. Redis (inert — enable_redis has no application effect)

Redis is **disabled by default** (`enable_redis = false`). Setting `enable_redis =
true` only makes the `App_GKE` foundation inject `REDIS_HOST`/`REDIS_PORT`/
`REDIS_AUTH` env vars into the pod — Stirling-PDF **never reads them**.
`stirlingpdf.tf`'s own comment confirms "no DB or Redis", and neither
`StirlingPDF_Common` nor this module maps those env vars into any
Stirling-PDF-recognized setting. Enabling Redis does **not** implement rate
limiting or bot detection for this application. Use `enable_cloud_armor` for
actual abuse mitigation on a public instance.

- **CLI (to confirm the env vars are present but unused):**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### E. Identity-Aware Proxy (optional)

Because Stirling-PDF processes potentially sensitive documents, a private deployment
should gate the Ingress with IAP. Enabling `enable_iap` requires an authenticated,
authorized Google identity before any request reaches the workload.

- **Console:** Security → Identity-Aware Proxy.
- **CLI:**
  ```bash
  gcloud iap web get-iam-policy --resource-type=backend-services --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the IAP OAuth wiring.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Stirling-PDF Application Behaviour

- **Nothing is persisted.** Uploads are written to a per-request ephemeral working
  directory and deleted when the response is returned. There is no database, no PVC,
  and no bucket — a rolling update or pod reschedule loses nothing.
- **Slow first boot.** The full image bundles LibreOffice + OCR and can take 2–4
  minutes to bind its port on a cold-provisioned Autopilot node. The startup probe
  targets `/api/v1/info/status` with a 20s initial delay and 30 failures at 10s
  intervals (~5 minutes total) before a pod is marked unhealthy; the liveness probe
  waits a 120s initial delay so it doesn't race the startup probe mid-warmup.
- **Login is optional and off by default.** `enable_login = false` ships an open
  instance. Set `enable_login = true` to require Stirling-PDF's built-in
  authentication; combine with IAP for defence in depth.
- **Safe to scale out.** With no shared state, `max_instance_count > 1` needs no
  coordination mechanism at all. `enable_redis` is unrelated to this — it is an
  inert Foundation passthrough Stirling-PDF never reads (see §2.D). The HPA scales
  replicas by CPU/memory load.
- **Version upgrades are image-tag bumps.** Changing `application_version` triggers a
  rolling update with no migration step; the default RollingUpdate strategy is fine
  because the app is stateless.
- **Confirm the running configuration:**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -iE 'SECURITY_|SYSTEM_'
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Stirling-PDF are listed; every other input is
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
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `stirlingpdf` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Stirling-PDF` | Human-readable name shown in the Console. |
| `application_version` | `latest` | Stirling-PDF image tag; pin to a specific release in production. |
| `enable_login` | `false` | Enable Stirling-PDF's built-in auth (`SECURITY_ENABLELOGIN`). |
| `default_locale` | `en-US` | Default UI locale (`SYSTEM_DEFAULTLOCALE`). |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Deploy the official image (`prebuilt`) or build a custom one. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="2Gi" }` | CPU/memory limits; **2Gi floor** for JVM + LibreOffice. |
| `min_instance_count` | `1` | Minimum replicas; GKE requires ≥ 1. |
| `max_instance_count` | `3` | Maximum replicas. Safe to raise — no shared state. |
| `container_port` | `8080` | Stirling-PDF listens on port 8080. |
| `enable_image_mirroring` | `true` | Mirror the image into Artifact Registry. |
| `timeout_seconds` | `60` | Maximum request duration; raise for large conversions. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra Stirling-PDF settings (e.g. `SYSTEM_MAXFILESIZE`). Login and locale are set via `enable_login` / `default_locale`. |
| `secret_environment_variables` | `{}` | Secret Manager references. Stirling-PDF needs none by default. |
| `secret_propagation_delay` | `30` | Seconds to wait after secret creation before proceeding. |
| `secret_rotation_period` | `2592000s` | Secret Manager rotation notification frequency. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `null` | Auto-resolves to a stateless Deployment. StatefulSet is unnecessary. |
| `session_affinity` | `None` | Stirling-PDF is stateless — no sticky routing required. |
| `network_tags` | `["nfsserver"]` | Node/pod network tags. |
| `termination_grace_period_seconds` | `30` | Seconds to wait after SIGTERM before SIGKILL. |
| `enable_network_segmentation` | `false` | Create Kubernetes NetworkPolicy resources. |
| `enable_cloudsql_volume` | `false` | Not used — Stirling-PDF has no database. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Leave off — Stirling-PDF stores no state. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` / `stateful_pvc_storage_class` | `10Gi` / `/data` / `standard-rwo` | Only relevant if a StatefulSet is forced. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Minimum pods available during voluntary disruptions. |
| `enable_resource_quota` | `false` | Enforce a namespace ResourceQuota. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Must use binary units (`4Gi`) — bare integers are bytes and block scheduling. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/v1/info/status`, 20s delay, 30 × 10s retries | Startup probe. ~5 minute first-boot window for JVM + LibreOffice. |
| `liveness_probe` | HTTP `/api/v1/info/status`, 120s delay | Liveness probe; delayed to clear the slow first boot. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | None required — Stirling-PDF is stateless. |
| `cron_jobs` | `[]` | Scheduled Kubernetes CronJobs. |
| `additional_services` | `[]` | Sidecar or helper services. |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see [App_GKE](App_GKE.md).
Key inputs: `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS is off by default. Enable only if co-locating Redis on the NFS server VM. |
| `nfs_mount_path` | `/mnt/nfs` | Mount path inside the container. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `false` | Stirling-PDF is stateless — no bucket by default. |
| `storage_buckets` | `[]` | Optional additional buckets. |
| `gcs_volumes` | `[]` | GCS Fuse volume mounts via the CSI driver. |
| `max_images_to_retain` | `7` | Maximum recent Artifact Registry images to keep. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |

### Group 15 — Redis (inert Foundation passthrough)

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Inert for Stirling-PDF: only makes `App_GKE` inject `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` env vars, which the application never reads. No rate limiting or bot detection results from enabling this. |
| `redis_host` | `""` | Redis endpoint. Leave empty to use the NFS server's internal IP. Unused by Stirling-PDF regardless of value. |
| `redis_port` | `6379` | Redis port. Unused by Stirling-PDF regardless of value. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). Unused by Stirling-PDF regardless of value. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed — Stirling-PDF uses no database. |
| `database_password_length` | `32` | Not used. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

> **Note:** Enabling IAP requires Google identity authentication for all inbound
> requests. Recommended for private instances handling sensitive documents.

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Stirling-PDF. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. Recommended for public instances. |
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

These values are returned on a successful deployment and are the quickest way to
locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Stirling-PDF. |
| `storage_buckets` | Created Cloud Storage buckets (empty — Stirling-PDF is stateless). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD GitHub details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — IAP with no authorized identities, a StatefulSet forced with a `Deployment` workload type, `quota_memory_*` in non-binary units, an out-of-range `redis_port`/`timeout_seconds`. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_login` + ingress | `enable_login = true` **or** IAP for private use | High | Default `enable_login = false` + external LoadBalancer leaves an open PDF toolkit anyone with the IP can use. |
| `enable_iap` | Enable for sensitive-document instances | High | Without IAP (and with login off) the workload is unauthenticated; users can upload confidential documents to an open endpoint. |
| `container_resources.memory_limit` | `2Gi` | High | Below ~2Gi the JVM + LibreOffice OOM-kills during conversions. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `timeout_seconds` | `60`, raise for big files | High | Large OCR/conversion jobs exceeding the timeout return 504 mid-operation. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects `0`. |
| `startup_probe` window | Keep the ~5 minute default | Medium | Shortening it marks pods unhealthy before LibreOffice finishes warming up, wedging the rollout. |
| `enable_cloud_armor` | Enable for public instances | Medium | A public toolkit without a WAF is exposed to abuse and scanning. |
| `enable_pod_disruption_budget` | `true` | Medium | Disabling allows GKE to evict all pods simultaneously during maintenance. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, and image mirroring — see **[App_GKE](App_GKE.md)**.
Stirling-PDF-specific application configuration shared with the Cloud Run variant is
described in **[StirlingPDF_Common](StirlingPDF_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Stirling-PDF on GKE Autopilot](../labs/StirlingPDF_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Stirling-PDF on Google Cloud Run](StirlingPDF_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Stirling-PDF Common — Shared Application Configuration](StirlingPDF_Common.md) — the configuration shared by both deployment targets.
