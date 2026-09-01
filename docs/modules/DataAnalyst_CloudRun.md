---
title: "Data Analyst Agent on Google Cloud Run"
description: "Configuration reference for deploying the Data Analyst Agent on Google Cloud Run with the RAD module — variables, architecture, sandboxed code execution, and operations."
---

# Data Analyst Agent on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/DataAnalyst_CloudRun.png" alt="Data Analyst Agent on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

The Data Analyst Agent lets a user upload a small data file (CSV, TSV, JSON, plain text, or
Excel) and ask questions about it in plain language. Unlike a typical chat assistant, it
never guesses: it writes real Python (pandas/numpy/matplotlib) and runs it — isolated inside
Cloud Run's [sandbox launcher](https://docs.cloud.google.com/run/docs/configuring/services/sandboxes)
(gVisor) — to compute the actual answer, and can return a genuine chart alongside its
explanation. This module deploys the agent on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the shared Google
Cloud infrastructure.

This guide focuses on the cloud services the agent uses and how to explore and operate them
from the Google Cloud Console and the command line. For the mechanics common to every Cloud
Run application — service identity, ingress and load balancing, scaling and concurrency,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather
than repeating them here.

---

## 1. Overview

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Python (FastAPI + Google ADK) service; request-based autoscaling by default |
| AI model | Vertex AI (Gemini) | No API key secret to manage — uses the Cloud Run service's own runtime service account, granted `roles/aiplatform.user` |
| Code execution | Cloud Run's sandbox launcher | gVisor-isolated: deny-by-default network egress, writes discarded after each call, no access to this service's own environment variables |
| Uploaded data | Ephemeral container storage | No database and no GCS bucket at all — a file lives only under `/tmp/uploads/<session>/` for the life of a chat session |
| Networking | VPC / Direct VPC Egress | Deployable standalone (inline VPC) or converged onto a shared `Services_GCP` network when one exists in the project |
| Ingress | Cloud Run URL | Default `run.app` URL; Identity-Aware Proxy strongly recommended (see below) |

**Sensible defaults worth knowing up front:**

- **No credential of any kind.** The agent has no Secret Manager secret, no API key, and no
  database password — Vertex AI authentication is entirely the Cloud Run service's own
  runtime identity. There is nothing secret in this deployment to leak.
- **`public_access` defaults to `true`.** Unlike most catalogue modules, this one has no
  proprietary reference material to protect (it started life as a reference-catalogue chat
  advisor and was later re-purposed into a general-purpose sandboxed code-execution agent —
  see [DataAnalyst_Common](DataAnalyst_Common.md) for that history), so there is no
  confidentiality reason to restrict who can self-serve deploy it.
- **The sandbox launcher IS the security boundary, not a convenience.** Every
  code-execution/file-preview tool call runs through it. Disabling `enable_sandbox_launcher`
  removes process isolation entirely — it is not a performance knob.
- **Every `execute_code` run has its own memory/CPU ceiling**
  (`execute_code_memory_limit_mb`, default 512 MiB), independent of and below the container's
  overall `memory_limit` — a runaway allocation fails cleanly with `MemoryError` rather than
  threatening the whole instance.
- **Charts are delivered by the server, not trusted to the model.** The agent can generate a
  matplotlib chart; the image is extracted directly from the tool-call response and pushed to
  the browser as its own message — never relied on to survive intact inside the model's own
  natural-language reply.
- **No hard isolation between concurrent chat sessions on one warm instance.** Session
  directories are named with an unguessable UUID, but that is a soft boundary, not an OS-level
  one — see §3 and §6.
- **`min_instance_count` defaults to `0`** (scale-to-zero); cold start is fast since there is
  no repository to clone and no database connection to establish.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names are reported
in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the agent service

The agent runs as a Cloud Run v2 service. Each deployment creates an immutable revision.

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution environment, and
traffic splitting. Note `max_concurrent_requests` is applied via a `gcloud beta run services
update` escape hatch after the service is created (App_CloudRun has no first-class
concurrency override) — confirm it took effect:
```bash
gcloud run services describe <service-name> --region "$REGION" \
  --format='value(spec.template.spec.containerConcurrency)'
```

### B. Vertex AI — the model backend

The agent calls Gemini via Vertex AI using the Cloud Run service's own runtime service
account — there is no API key to create, store, or rotate.

- **Console:** Vertex AI → Model Garden, or check IAM for the `roles/aiplatform.user` grant
  on the runtime service account.
- **CLI:**
  ```bash
  gcloud projects get-iam-policy "$PROJECT" \
    --flatten="bindings[].members" \
    --filter="bindings.role:roles/aiplatform.user"
  ```

### C. Cloud Run's sandbox launcher — code execution isolation

Not a resource you browse in the Console, but the central mechanism this module exists to
use. Applied post-deploy via a `gcloud beta` escape hatch (`--sandbox-launcher`, no
first-class Terraform field exists for it yet — see `enable_sandbox_launcher`).

- **Confirm it's applied:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(metadata.annotations)'
  ```
- **Confirm it's actually isolating real calls** — look for `[start]`/`[end] exit_code=...`
  lines in Cloud Logging around a real chat interaction:
  ```bash
  gcloud logging read 'resource.type="cloud_run_revision"
    resource.labels.service_name="<service-name>" textPayload:"sandbox"' \
    --project "$PROJECT" --freshness=10m --order=asc
  ```

Cloud Run sandboxes are a **Public Preview** feature — the exact invocation contract and
availability are subject to change without GA-level stability guarantees.

### D. Networking & ingress

The service is reachable at its `run.app` URL by default. If the project already has a
`Services_GCP` deployment, this module converges onto its shared VPC instead of maintaining
its own inline network — see §6 for what that means during an update.

- **Console:** Cloud Run (service URL); VPC network → VPC networks / Subnets.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute networks list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for ingress settings, VPC egress, and load balancing.

### E. Cloud Logging & Monitoring — structured tool-call logs

Every `list_uploaded_files`/`inspect_file`/`execute_code` call emits one JSON line (tool
name, session ID, success/failure, duration, exit code) — Cloud Logging parses this
automatically into `jsonPayload` fields and `severity`, with no logging library or added
dependency involved.

- **Console:** Logging → Logs Explorer.
- **CLI — query by field, not raw text:**
  ```bash
  # every failed execute_code call in the last hour
  gcloud logging read 'resource.type="cloud_run_revision"
    resource.labels.service_name="<service-name>"
    jsonPayload.tool="execute_code" jsonPayload.ok=false' \
    --project "$PROJECT" --freshness=1h

  # a specific session's activity
  gcloud logging read 'resource.type="cloud_run_revision"
    resource.labels.service_name="<service-name>"
    jsonPayload.session_id="<session-id>"' \
    --project "$PROJECT" --freshness=1h --order=asc
  ```

---

## 3. Application Behaviour

- **Upload-then-ask workflow, multiple files at once.** The chat page's upload control
  accepts several files in one selection (uploaded sequentially, one `POST /upload` per
  file), so cross-file analysis (e.g. joining two CSVs) needs no separate "attach" step in
  the chat protocol. Files are validated by extension (`allowed_upload_extensions`) and a
  streamed size cap (`max_upload_size_mb`) before a single byte touches disk.
- **Session-scoped, ephemeral storage.** Uploaded files live under
  `/tmp/uploads/<session_id>/` for the life of a chat session — swept opportunistically the
  next time anyone uploads to the same instance, once older than `upload_ttl_seconds`. A
  cold start or a different instance starts with nothing uploaded.
- **The agent computes; it does not guess.** Every non-trivial question is answered by
  writing and running real code (`execute_code`), never by reasoning from a file preview
  alone. If the code errors, the agent reads the traceback, fixes it, and retries — visible
  directly in the structured logs (§2E) as a failed call followed by a successful one.
- **Chart generation, delivered reliably.** The agent can render a matplotlib chart (Agg
  backend, no display needed) by printing a `CHART_PNG_BASE64:<base64>` marker line from
  inside the sandbox; the server extracts it from the raw tool-call response and pushes it
  to the browser as its own image message — independent of what the model's own text reply
  says, since an LLM is not reliably good at re-quoting a multi-hundred-KB blob verbatim.
- **Excel support.** `.xlsx` files are accepted alongside CSV/TSV/JSON/plain text
  (`openpyxl` backs pandas' Excel engine).
- **Structure-aware preview for JSON.** Rather than a raw byte truncation that could cut a
  JSON file mid-structure, the agent's file preview returns the first few list items or dict
  keys, pretty-printed, falling back to a raw preview only if parsing fails.
- **Per-call resource ceiling.** Each `execute_code` run applies its own memory (`RLIMIT_AS`)
  and CPU-time (`RLIMIT_CPU`) limit before the generated code executes, bounded by
  `execute_code_memory_limit_mb` and the call's own timeout — independent of, and below, the
  container's overall `memory_limit`.
- **Abuse/cost guards.** A per-connection message-length cap and rate limit bound how much
  Vertex AI billing (and how many `execute_code` runs) an unauthenticated caller can drive if
  `enable_iap` is left off.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for `DataAnalyst_CloudRun` are listed; every other input is inherited
from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `dataanalyst` | Base name for the Cloud Run service and Artifact Registry repository. |
| `application_display_name` | `Data Analyst Agent` | Friendly name shown in the Console. |
| `application_description` | _(set)_ | Service description. |
| `application_version` | `1.0.0` | Container image version tag — bump on every code-only redeploy, since the image is referenced by a mutable tag, not a digest. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` | `1000m` | CPU per instance. |
| `memory_limit` | `1Gi` | Memory per instance — headroom above the platform's usual 512Mi floor, since pandas/numpy loading an uploaded file benefits from it. |
| `min_instance_count` | `0` | Minimum instances (0 = scale-to-zero). |
| `max_instance_count` | `2` | Maximum instances. |
| `execution_environment` | `gen2` | Required by the sandbox launcher. |
| `container_protocol` | `http1` | Plain HTTP/1.1 + WebSocket. |
| `timeout_seconds` | `600` | Kept generous since the chat WebSocket holds this open across a turn. |

### Group 5 — Access & Ingress Control

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Which networks may reach the service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | How outbound traffic is routed through the VPC. |
| `enable_iap` | `false` | **Strongly recommended `true`:** every message here is a real Vertex AI call AND can trigger code execution, so an unauthenticated endpoint is a meaningful cost/abuse exposure. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access through IAP. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. |
| `secret_environment_variables` | `{}` | Not used by this module by default — the agent has no secret of its own. |

### Group 8 — CI/CD & Binary Authorization

Standard App_CloudRun Cloud Build / Cloud Deploy integration — see
[App_CloudRun](App_CloudRun.md). Key input specific to this module:

| Variable | Default | Description |
|---|---|---|
| `additional_cloudrun_sa_roles` | `["roles/aiplatform.user"]` | Extra IAM roles for the Cloud Run service account. **Must keep `roles/aiplatform.user`** — removing it breaks every chat message with a Vertex AI permission error. |

### Group 10 — Domain, CDN & Cloud Armor

Standard App_CloudRun load-balancer options (`application_domains`, `enable_cdn`,
`enable_cloud_armor`, `admin_ip_ranges`) — see [App_CloudRun](App_CloudRun.md).

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `GET /_health` | Matches the FastAPI server's health route. Not named `/healthz` — confirmed live that Cloud Run's edge routing treats that exact path as reserved and never reaches the container. |
| `uptime_check_config` | disabled | Cloud Monitoring uptime check. |

### Group 15 — Data Analyst Agent Configuration

| Variable | Default | Description |
|---|---|---|
| `vertex_region` | `us-central1` | Vertex AI region serving the agent's Gemini calls. |
| `agent_model` | `gemini-2.5-flash` | Gemini model ID used via Vertex AI. |
| `enable_sandbox_launcher` | `true` | The actual security boundary for code execution — see §1. |
| `max_upload_size_mb` | `20` | Enforced by streaming the upload and rejecting once this many bytes have arrived — never trusted from the request's declared size. |
| `allowed_upload_extensions` | `[".csv", ".tsv", ".json", ".txt", ".xlsx"]` | Extensions the upload endpoint accepts. |
| `upload_ttl_seconds` | `3600` | How long an uploaded file is kept before cleanup eligibility. |
| `execute_code_memory_limit_mb` | `512` | Per-`execute_code`-call memory ceiling — keep comfortably below `memory_limit`. |
| `max_concurrent_requests` | `10` | Cap on concurrent WebSocket connections per instance — also the knob to set to `1` if the cross-session isolation caveat (§6) matters for your data. |
| `require_services_gcp_module` | `false` | This module has no database/NFS/GKE dependency of its own, so it deploys standalone into a blank project by default. |

### Group 22 — VPC Service Controls & Audit Logging

Standard App_CloudRun options (`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`,
`organization_id`, `enable_audit_logging`) — see [App_CloudRun](App_CloudRun.md).

---

## 5. Outputs

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL — open this to chat with the agent. |
| `service_location` | Region the service runs in. |
| `sandbox_launcher_enabled` | Whether `--sandbox-launcher` was applied. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `network_name` / `network_exists` | VPC network in use, and whether it was discovered (shared) rather than created inline. |
| `storage_buckets` | Always empty — this module provisions no GCS bucket. |
| `monitoring_enabled` | Monitoring status. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `enable_sandbox_launcher` | `true` | Critical | `false` removes the ONLY isolation between LLM-generated code and the rest of the container — the module's entire security model depends on this staying on. |
| `enable_iap` | `true` for anything beyond a quick test | High | Left `false`, an unauthenticated caller can drive unbounded Vertex AI billing and unlimited code-execution runs, bounded only by the per-connection rate limit. |
| `execute_code_memory_limit_mb` | comfortably below `memory_limit` | High | Set too close to (or above) `memory_limit`, a single pathological allocation can still threaten the whole instance instead of failing cleanly with `MemoryError`. |
| `max_concurrent_requests` | `1` for genuinely sensitive data | Medium | Session directories are isolated only by an unguessable name, not an OS-level permission boundary — concurrent sessions on one warm instance can, in principle, read each other's uploaded files. |
| `application_version` | bump on every code-only change | Medium | The image is referenced by a mutable tag; rebuilding under the same tag creates no new revision, so a "redeploy" silently keeps serving the old container. |
| `allowed_upload_extensions` | keep to data formats only | Medium | Widening this to arbitrary file types expands what a sandboxed-but-real Python process can be asked to parse. |
| `upload_ttl_seconds` | shorter for public-facing deployments | Low | A long TTL keeps a stranger's uploaded data on the instance's disk longer than necessary if the browser tab is simply abandoned. |

---

For the foundation behaviour referenced throughout — service identity, scaling and
concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_CloudRun](App_CloudRun.md)**. The shared
application configuration (container build, upload handling, and the sandboxed
code-execution model) is described in **[DataAnalyst_Common](DataAnalyst_Common.md)**.

<!-- related-guides -->

## Related guides

- [DataAnalyst Common — Shared Application Configuration](DataAnalyst_Common.md) — the configuration shared by this deployment target.
