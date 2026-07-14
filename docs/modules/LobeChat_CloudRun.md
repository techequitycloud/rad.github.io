---
title: "LobeChat on Google Cloud Run"
description: "Configuration reference for deploying LobeChat on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# LobeChat on Google Cloud Run

LobeChat is an open-source, modern LLM chat UI (built with Next.js) that lets users
converse with many model providers — OpenAI, Anthropic, Google, and others — through
a single polished interface, with users supplying their own API keys client-side.
This module deploys LobeChat on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared
Google Cloud infrastructure.

This guide focuses on the cloud services LobeChat uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics common to
every Cloud Run application — service identity, ingress and load balancing, scaling
and concurrency, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
and the deployment lifecycle — refer to the
[App_CloudRun foundation guide](App_CloudRun.md) rather than repeating them here.

---

## 1. Overview

LobeChat runs as a single stateless Next.js container on Cloud Run v2. Because its
default **client-stored** mode keeps all state in the browser, the deployment wires
together a deliberately minimal set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Next.js service, 1 vCPU / 2 GiB by default, serverless autoscaling; scale-to-zero enabled |
| Database | *(none)* | `database_type = "NONE"` — no Cloud SQL is provisioned; state lives in the browser |
| Object storage | *(none)* | Stateless — no GCS bucket is declared by default |
| Cache | Redis (optional, off) | Only for rate limiting / bot detection on public deployments |
| Secrets | Secret Manager (none by default) | LobeChat generates no secrets; inject provider keys yourself if desired |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **No database, no secrets, no storage.** LobeChat is stateless in client-stored
  mode — users add their own model API keys in the browser. There is nothing to back
  up and nothing to migrate. (An optional Postgres server mode exists upstream but is
  not wired by this module.)
- **Port 3210 is fixed.** The custom image pins `PORT=3210` and `container_port =
  3210`; do not change it without rebuilding the image.
- **2 GiB memory is the floor.** Next.js 15's `next-server` OOM-crashes at boot under
  512 Mi/1 Gi; `memory_limit = 2Gi` is the safe minimum. `cpu_limit` defaults to
  `1000m`.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`, forced by the
  wiring). Cold starts add a few seconds on the first request after idle; the app
  needs no warm state, so this is safe.
- **`max_instance_count = 3`.** Because there is no shared server-side state, LobeChat
  scales horizontally without a queue or cache prerequisite.
- **Public ingress by default** (`ingress_settings = "all"`) so the chat UI is
  reachable. Add `ACCESS_CODE` (see §3) or IAP to gate access.
- **Redis is optional and off.** Enable it only to add rate limiting / bot detection
  in front of a public deployment.
- **`latest` maps to a real image tag.** The build ARG `LOBECHAT_VERSION` passes the
  version through unchanged, so `application_version = "latest"` resolves to the real
  `lobehub/lobe-chat:latest`.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are
reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the LobeChat service

LobeChat runs as a Cloud Run v2 service that autoscales by request load between the
minimum (0) and maximum instance counts. Each deployment creates an immutable
revision; traffic can be split across revisions for safe rollouts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~lobechat"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the port and image the running revision uses:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].ports,spec.template.spec.containers[0].image)'
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment,
and traffic splitting.

### B. No database

LobeChat provisions **no Cloud SQL instance** — `database_type = "NONE"`. In
client-stored mode every conversation, setting, and provider key lives in the user's
browser, so there is no server-side database to connect to, back up, or migrate. If
you need cross-device sync you would enable LobeChat's upstream Postgres server mode,
which this module does not wire (it requires a full `DATABASE_URL` and auth stack).

### C. No object storage

No GCS bucket is declared by default (`storage_buckets` is empty). The service is
stateless; there is nothing to persist to Cloud Storage. Any buckets that do appear
in the project come from the foundation (e.g. the image build context), not from
application data.

- **CLI (to confirm none are app-owned):**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
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
  # Confirm the Redis env injected into the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager

LobeChat generates **no secrets** — there are no cryptographic keys to protect. Secret
Manager is used only if *you* choose to inject a server-side provider key (e.g.
`OPENAI_API_KEY`) via `secret_environment_variables`, which references a secret you
create.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~lobechat"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for secret injection and rotation.

### F. Networking & ingress

The service is reachable at its `run.app` URL by default (`ingress_settings = "all"`),
which allows public access to the chat UI. An external HTTPS load balancer with a
custom domain, Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging & Monitoring

Container logs flow to Cloud Logging; Cloud Run metrics flow to Cloud Monitoring, with
an optional uptime check (targeting `/`) and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. LobeChat Application Behaviour

- **No first-deploy database setup.** There is no `db-init` job and no schema — the
  `initialization_jobs` output is empty. First boot simply starts the Next.js server.
- **No migrations.** Because there is no server-side database in the default mode,
  upgrading `application_version` just deploys a new image revision; there is no
  schema to migrate.
- **No admin account / no default credentials.** LobeChat client-stored mode has no
  server-side user store. The only access gate is the optional `ACCESS_CODE` shared
  passphrase (see below); without it the UI is open to anyone with the URL.
- **Users supply their own model keys.** Each user pastes provider API keys into the
  UI, held in browser `localStorage`. To preconfigure a server-side provider instead,
  inject e.g. `OPENAI_API_KEY` (as a secret) and/or `OPENAI_PROXY_URL` via the
  variant's `secret_environment_variables` / `environment_variables`.
- **Gate access with `ACCESS_CODE`.** For any public deployment, set a shared
  passphrase so the chat UI (and any keys users paste) are not exposed:
  ```bash
  # via the module: environment_variables = { ACCESS_CODE = "<passphrase>" }
  # verify it reached the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
- **Health path.** Startup, liveness, and readiness probes target `/` — the LobeChat
  Next.js server returns HTTP 200 there once booted, with no auth. Allow the default
  startup window for the `next-server` cold start.
- **Fixed port 3210.** The custom image pins `PORT=3210`; `container_port` must stay
  `3210`.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for LobeChat are listed; every other input is inherited from
[App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `lobechat` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | LobeChat image tag; `latest` maps to the real `lobehub/lobe-chat:latest`. Pin a specific tag in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `2Gi` | **Minimum 2 GiB** — Next.js `next-server` OOM-crashes at boot below this. |
| `min_instance_count` | `0` | Scale-to-zero (forced by the wiring); LobeChat holds no warm state. |
| `max_instance_count` | `3` | Safe to raise — no shared server-side state or queue prerequisite. |
| `container_port` | `3210` | LobeChat's Next.js server port. Do not change without rebuilding the image. |
| `enable_image_mirroring` | `true` | Mirror `lobehub/lobe-chat` into Artifact Registry. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Public access to the chat UI. Combine with `ACCESS_CODE` or IAP to gate it. |
| `enable_iap` | `false` | Require Google sign-in in front of LobeChat. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Optional overrides — notably `ACCESS_CODE` (gate the UI) and provider/theme defaults. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Use this for any server-side provider key (e.g. `OPENAI_API_KEY`). |

### Group 21 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable only for rate limiting / bot detection on public deployments. |
| `redis_host` | `""` | Redis endpoint. Set explicitly when `enable_redis = true` (empty falls back to `127.0.0.1`). |
| `redis_port` | `6379` | Redis port. |

The Database Backend, Backup & Restore, and Storage groups exist for convention
mirroring but are **inert** — `database_type = "NONE"` and no buckets are declared, so
those inputs create no resources. All other inputs follow standard
[App_CloudRun](App_CloudRun.md) behaviour.

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore the
running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service details (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (empty by default). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of setup jobs (empty — LobeChat has none). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration through the
> [App_CloudRun](App_CloudRun.md) foundation engine, which validates values *and
> combinations* at plan time — a `gen1` runtime with NFS/GCS mounts, IAP with no
> authorized identities, an out-of-range `redis_port`. Invalid configuration fails the
> **plan** with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `ACCESS_CODE` | Set on any public deployment | High | Without it the chat UI — and any provider keys users paste — is open to anyone with the URL. |
| `memory_limit` | `2Gi` (floor) | High | Below 2 GiB, Next.js `next-server` OOM-crashes at boot and the revision never becomes healthy. |
| `container_port` | `3210` | High | The image pins `PORT=3210`; a mismatch means the probe never connects and the revision fails to start. |
| Server-side provider keys | Inject via `secret_environment_variables` | High | Putting an API key in plain `environment_variables` exposes it in the revision spec and logs. |
| `ingress_settings` | `all` (or IAP) | Medium | `internal` makes the public chat UI unreachable; `all` without `ACCESS_CODE`/IAP leaves it open. |
| `enable_redis` | `false` unless public | Medium | Enabling without a reachable `redis_host` (empty → `127.0.0.1`) leaves rate limiting non-functional. |
| `application_version` | Pin a tag in prod | Medium | `latest` moves with upstream; a surprise release can change behaviour on the next redeploy. |
| `min_instance_count` | `0` | Low | Scale-to-zero adds a few seconds of cold-start latency after idle; harmless for a stateless UI. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**.
LobeChat-specific application configuration shared with the GKE variant is described
in **[LobeChat_Common](LobeChat_Common.md)**.
