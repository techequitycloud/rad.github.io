---
title: "LobeChat on GKE Autopilot"
description: "Configuration reference for deploying LobeChat on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# LobeChat on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LobeChat_GKE.png" alt="LobeChat on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

LobeChat is an open-source, modern LLM chat UI (built with Next.js) that lets users
converse with many model providers — OpenAI, Anthropic, Google, and others — through
a single polished interface, with users supplying their own API keys client-side.
This module deploys LobeChat on **GKE Autopilot** on top of the [App_GKE](App_GKE.md)
foundation, which provisions and manages the shared Google Cloud and Kubernetes
infrastructure.

This guide focuses on the cloud services LobeChat uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every GKE application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, and the deployment lifecycle — refer
to the [App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## What LobeChat costs on RAD, and how that compares

**LobeChat on RAD's GKE Autopilot module costs about US$26 a month in your own project.** RAD charges 40 credits once per deployment in your own project (36 credits, 10% lower, in a project RAD manages), plus build time. If you only need it occasionally, a RAD-managed project can be deleted and restored within 30 days for a few credits, so that monthly figure becomes a few dollars instead — see **Pause it for free**, below.


### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 40 credits (US$4.00 at the top-up price) | 36 credits (10% lower) |
| Build time | A few credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$26 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **55 credits a day**, about 1,650 a month (about US$165.00 at the top-up price, less on a plan) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 0.5x vCPU / 1 GiB | US$20 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | shared across every GKE app in the project; US$0 if this is your only cluster, else ~US$73 |
| **Total** | **about US$26** |

### How it compares

- LobeChat is a chat **interface**, not a hosted service with its own
  subscription — it is stateless by default (no database, Redis or persistent storage), and
  users supply their own provider API keys. There is no SaaS equivalent to compare against
  with a verifiable current price: the cost that matters here is the model usage itself,
  which is billed by whichever provider's key each user supplies, not by RAD or by LobeChat.
- Self-managed comparison: at 0.5 vCPU / 1 GiB, LobeChat's footprint is smaller than any of
  the usual reference VPS classes (a Hetzner CPX22 or DigitalOcean 4 GB droplet, both
  ~US$24/month, are sized for a heavier workload), so a cheaper, smaller instance than those
  would do — RAD's US$26 a month includes GKE Autopilot's per-pod billing,
  managed networking and storage rather than a plain VM you patch yourself.
- The real decision is usually "self-host the UI or use a provider's own hosted chat product
  (e.g. the ChatGPT or Gemini web apps)" rather than "self-host or pay for a hosted LobeChat" —
  nobody sells hosted LobeChat as a paid product today.


### Pause it for free: delete a RAD-managed project, restore it when you need it

If LobeChat runs in **a project RAD manages for you**, you have a second option that goes
well beyond scaling to zero: **delete the whole project, and restore it within 30 days for
close to nothing.** This suits LobeChat you only need occasionally — evaluating it, a demo
environment, a seasonal or intermittent workload — far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google
  to delete the project. Google does not remove the project immediately: it keeps it,
  recoverable, for 30 days. Because billing is already unlinked, nothing is charged while it
  waits. Unlike deleting one module, this does not tear down the database, any VM or the
  compute resource one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a few credits, not a rebuild.** Within 30 days, the project's owner can
  restore it. RAD asks Google to undelete the project and reattaches its billing account, then
  asks you to run **Update** on each deployment to confirm everything came back. Because
  nothing was individually destroyed, that Update finds the same resources already there — it
  is a check, not a rebuild, and an Update never charges the module fee again. For LobeChat behind Services_GCP (a GKE cluster) and Project_GCP, that is roughly **a handful of credits (under US$1)** in total, against the about 45 credits (US$4.50) a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$26.**
  Deploy LobeChat, use it for a while, delete the project. Restore it next time you need it,
  confirm with Update, and delete it again when you're done. You pay only for the module fee
  once, the builds, and whatever time it was actually live.
- **What this needs.** You must own the project (not one RAD only manages billing for), and
  you restore it yourself within the 30 days — after that, Google deletes it for good.
  Restoring is admitted like creating a new project: your purchased credit balance must still
  clear the tier's floor (100 credits for the sandbox tier most evaluation use fits). Google
  says most services are fully working again within 36 hours of a restore.
- **One real gap: nightly backups do not survive.** Backups and other generated files are
  written to a bucket inside the project, and that bucket is **not** protected by Cloud
  Storage's soft-delete, so it is very likely gone as soon as you delete the project — even
  though the project itself is recoverable for 30 days. If you have customised LobeChat and
  want to keep that work, copy a backup out (to Google Drive, or a bucket outside the project)
  before you delete. For a default installation with nothing irreplaceable in it, this does
  not matter.


### Pay only while you use it, the other way: delete and redeploy

The option above only applies to a RAD-managed project; **in your own project, or once the
30-day window has passed, the way to stop paying is to delete the deployment and deploy it
again when you need it.**

- **What a redeploy costs.** The module fee again, plus the builds — roughly
  45 credits (US$4.50) in total. Deleting saves money
  only once LobeChat would otherwise sit unused long enough to clear that redeploy cost
  against its own running cost — about **6 days or more**, both in your own project
  (about US$0.86 a day) and in a RAD-managed one (55 credits a day).
- **Most of the running cost is usually shared.** For LobeChat that is the database. They stop only when nothing else in the project uses them, so deleting this app while something else shares the project saves only this app's own compute part.
- **Keep your data first.** Nightly backups go to a bucket inside the deployment and are
  deleted with it, so copy the latest backup out before deleting if you want to keep it.


### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets
  the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
  trainer sets. Either the trainer funds every place, or each participant pays for their own.
  Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
  partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by
card, bank transfer or mobile money.


**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD fees and the daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics and what it says about Cloud Storage objects without soft delete. Prices change; check each source before relying on a figure.


## 1. Overview

LobeChat runs as a single stateless Next.js web workload on Autopilot. Because its
default **client-stored** mode keeps all state in the browser, the deployment wires
together a deliberately minimal set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Next.js pods, 500m vCPU / 1 GiB by default, horizontally autoscaled |
| Database | *(none)* | `database_type = "NONE"` — no Cloud SQL is provisioned; state lives in the browser |
| Object storage | *(none)* | Stateless — no GCS bucket, NFS mount, or PVC declared by default |
| Cache | Redis (optional, off) | Only for rate limiting / bot detection on public deployments |
| Secrets | Secret Manager (none by default) | LobeChat generates no secrets; inject provider keys yourself if desired |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **No database, no secrets, no storage.** LobeChat is stateless in client-stored
  mode — users add their own model API keys in the browser. There is nothing to back
  up and nothing to migrate. (An optional Postgres server mode exists upstream but is
  not wired by this module.)
- **Port 3210 is fixed.** The custom image pins `PORT=3210` and `container_port =
  3210`; do not change it without rebuilding the image.
- **Default is `500m` CPU / `1Gi` memory** (`container_resources`). LobeChat's
  Next.js SSR process (plus its `pdfjs-dist`/`@napi-rs/canvas` rendering deps) OOMs
  and `CrashLoopBackOff`s at 512Mi (`JavaScript heap out of memory`) — 1Gi is the
  floor for a stable boot; raise `container_resources.memory_limit` further under
  heavier load.
- **Minimum 1 replica** (`min_instance_count = 1`, forced by the wiring). GKE does not
  support scale-to-zero, so at least one pod is always running to keep the UI
  reachable; `max_instance_count = 3`.
- **Stateless — Deployment, not StatefulSet.** There is no persistent volume; pods can
  be replaced freely and scaled horizontally without a queue or cache prerequisite.
- **`service_type = LoadBalancer`, `session_affinity = None`.** With no server-side
  session state, requests need no sticky routing.
- **Redis is optional and off.** Enable it only to add rate limiting / bot detection
  in front of a public deployment.
- **`latest` maps to a real image tag.** The build ARG `LOBECHAT_VERSION` passes the
  version through unchanged, so `application_version = "latest"` resolves to the real
  `lobehub/lobe-chat:latest`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the LobeChat workload

LobeChat pods are scheduled on Autopilot, which bills for the CPU/memory the pods
actually request. Horizontal Pod Autoscaling sizes the deployment between the minimum
(1) and maximum replica counts.

- **Console:** Kubernetes Engine → Workloads → select the LobeChat workload to see
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

### B. No database

LobeChat provisions **no Cloud SQL instance** — `database_type = "NONE"`. In
client-stored mode every conversation, setting, and provider key lives in the user's
browser, so there is no server-side database to connect to, back up, or migrate, and
no Cloud SQL Auth Proxy sidecar is injected. Enabling LobeChat's upstream Postgres
server mode (for cross-device sync) is out of scope for this module.

### C. No object storage or persistent volume

No GCS bucket, NFS mount, or block PVC is declared by default (`storage_buckets` is
empty, `enable_nfs = false`, `stateful_pvc_enabled` unset/`null`). The workload is
stateless; pods carry no persistent data.

- **CLI (to confirm none are app-owned):**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"          # none expected
  ```

### D. Redis (optional — rate limiting / bot detection)

Redis is **disabled by default** (`enable_redis = false`). Enable it only to add rate
limiting and bot detection in front of a public LobeChat instance. When
`enable_redis = true` and `redis_host` is empty, the app falls back to `127.0.0.1`
unless the NFS-co-located Redis is used — set `redis_host` (or `enable_nfs = true`)
explicitly.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the Redis env injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### E. Secret Manager

LobeChat generates **no secrets** — there are no cryptographic keys to protect. Secret
Manager (via the Secret Store CSI driver) is used only if *you* choose to inject a
server-side provider key (e.g. `OPENAI_API_KEY`) via `secret_environment_variables`,
which references a secret you create.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~lobechat"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP
(`service_type = LoadBalancer`). A custom domain with a Google-managed certificate can
be enabled, and a static IP reserved so the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. LobeChat Application Behaviour

- **No first-deploy database setup.** There is no `db-init` job and no schema — the
  `initialization_jobs` output is empty. First boot simply starts the Next.js server.
- **No migrations.** With no server-side database in the default mode, upgrading
  `application_version` just rolls out a new image; there is no schema to migrate.
- **No admin account / no default credentials.** LobeChat client-stored mode has no
  server-side user store. The only access gate is the optional `ACCESS_CODE` shared
  passphrase (see below); without it the UI is open to anyone who reaches the
  LoadBalancer IP.
- **Users supply their own model keys.** Each user pastes provider API keys into the
  UI, held in browser `localStorage`. To preconfigure a server-side provider instead,
  inject e.g. `OPENAI_API_KEY` (as a secret) and/or `OPENAI_PROXY_URL` via
  `secret_environment_variables` / `environment_variables`.
- **Gate access with `ACCESS_CODE`.** For any externally exposed deployment, set a
  shared passphrase so the chat UI (and any keys users paste) are not exposed:
  ```bash
  # via the module: environment_variables = { ACCESS_CODE = "<passphrase>" }
  # verify it reached the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep ACCESS_CODE
  ```
- **Health path.** Startup, liveness, and readiness probes target `/` — the LobeChat
  Next.js server returns HTTP 200 there once booted, with no auth. Allow the default
  startup window for the `next-server` cold start.
- **Fixed port 3210.** The custom image pins `PORT=3210`; `container_port` must stay
  `3210`.
- **`imagePullPolicy = Always` for the mirrored image.** App_GKE forces `Always` for
  custom-built/mirrored images so a rebuilt tag is re-pulled on redeploy rather than
  serving a stale cached layer.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for LobeChat are listed; every other input is inherited from
[App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `lobechat` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | LobeChat image tag; `latest` maps to the real `lobehub/lobe-chat:latest`. Pin a specific tag in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_resources` | `500m` CPU / `1Gi` memory | Per-pod requests/limits. Next.js `next-server` (plus `pdfjs-dist`/canvas rendering deps) OOM-crashes at boot under 1Gi — raise memory further if you see the same failure under load. |
| `min_instance_count` | `1` | Minimum replicas (GKE has no scale-to-zero); keeps the UI reachable. |
| `max_instance_count` | `3` | Safe to raise — no shared server-side state or queue prerequisite. |
| `container_port` | `3210` | LobeChat's Next.js server port. Do not change without rebuilding the image. |
| `enable_image_mirroring` | `true` | Mirror `lobehub/lobe-chat` into Artifact Registry. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Optional overrides — notably `ACCESS_CODE` (gate the UI) and provider/theme defaults. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use this for any server-side provider key (e.g. `OPENAI_API_KEY`). |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `null` | Resolves to a stateless Deployment — LobeChat needs no per-pod PVCs. |
| `session_affinity` | `None` | No server-side session state, so no sticky routing is required. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Leave unset — LobeChat is stateless in client-stored mode; there is no data to persist per pod. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable only for rate limiting / bot detection on public deployments. |
| `redis_host` | `""` | Redis endpoint. Set explicitly when `enable_redis = true` (empty falls back to `127.0.0.1`). |
| `redis_port` | `6379` | Redis port. |

The Database Backend, Backup & Maintenance, Filesystem (NFS), and Cloud Storage groups
exist for convention mirroring but are **inert** — `database_type = "NONE"` and no
buckets/volumes are declared, so those inputs create no resources. All other inputs
follow standard [App_GKE](App_GKE.md) behaviour.

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
| `service_url` | URL to reach LobeChat. |
| `storage_buckets` | Created Cloud Storage buckets (empty by default). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` | Names of setup jobs (empty — LobeChat has none). |
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
> plan time — a `workload_type = "Deployment"` alongside `stateful_pvc_enabled = true`,
> IAP with no authorized identities, binary memory-quota units, an out-of-range
> `redis_port`. Invalid configuration fails the **plan** with a clear, named error
> before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `ACCESS_CODE` | Set on any exposed deployment | High | Without it the chat UI — and any provider keys users paste — is open to anyone who reaches the LoadBalancer IP. |
| `container_resources` memory | `1Gi` (floor) | High | Below 1 GiB, Next.js `next-server` OOM-crashes at boot (`JavaScript heap out of memory`) and the pod never becomes Ready. |
| `container_port` | `3210` | High | The image pins `PORT=3210`; a mismatch means the probe never connects and the pod fails to start. |
| Server-side provider keys | Inject via `secret_environment_variables` | High | Putting an API key in plain `environment_variables` exposes it in the pod spec and logs. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects `0`. Keeping 1 ensures the UI stays reachable. |
| `stateful_pvc_enabled` | leave unset (`null`) | Medium | Enabling a PVC adds pointless per-pod storage — LobeChat persists nothing server-side in the default mode. |
| `enable_redis` | `false` unless public | Medium | Enabling without a reachable `redis_host` (empty → `127.0.0.1`) leaves rate limiting non-functional. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `application_version` | Pin a tag in prod | Medium | `latest` moves with upstream; a surprise release can change behaviour on the next rollout. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, and image mirroring — see **[App_GKE](App_GKE.md)**. LobeChat-specific
application configuration shared with the Cloud Run variant is described in
**[LobeChat_Common](LobeChat_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: LobeChat on GKE Autopilot](../labs/LobeChat_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [LobeChat Common — Shared Application Configuration](LobeChat_Common.md) — the configuration shared by both deployment targets.
