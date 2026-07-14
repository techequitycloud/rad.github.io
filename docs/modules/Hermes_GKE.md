---
title: "Hermes Agent on GKE Autopilot"
description: "Configuration reference for deploying Hermes Agent on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Hermes Agent on GKE Autopilot

Hermes Agent is Nous Research's open-source (MIT-licensed), self-hosted,
self-improving personal AI agent: it learns skills from experience, persists
memory across sessions, and connects to messaging platforms plus an
OpenAI-compatible API from a single gateway process
([documentation](https://hermes-agent.nousresearch.com/docs/)). This module
deploys the official `nousresearch/hermes-agent` image on **GKE Autopilot** on
top of the [App_GKE](App_GKE.md) foundation, which provisions and manages the
shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Hermes uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every GKE application — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## 1. Overview

Hermes runs as a single-replica gateway pod on GKE Autopilot. The deployment
wires together a deliberately small set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Gateway pod, 2 vCPU / 2 GiB by default, `min=1` / `max=1` replicas |
| Agent state | Self-managed NFS (Services_GCP) | Mounted at `/opt/data` — SQLite config, sessions, skills, memories. **No Cloud SQL** |
| Secrets | Secret Manager (+ SecretSync) | `ANTHROPIC_API_KEY`, auto-generated `API_SERVER_KEY` and dashboard password, optional `OPENAI_API_KEY` / `TELEGRAM_BOT_TOKEN` |
| Container image | Artifact Registry (mirror) | Official prebuilt image mirrored in; no custom build, no Cloud Build step |
| Networking | VPC + Cloud Load Balancing | External LoadBalancer Service with reserved static IP by default |
| Database / cache | — | **No Cloud SQL, no Redis** — Hermes is entirely SQLite-on-NFS |

**Sensible defaults worth knowing up front:**

- **All agent state lives at `/opt/data`, and that path is fixed inside the
  image.** The shared platform NFS is mounted directly over it
  (`enable_nfs = true`, `nfs_mount_path = "/opt/data"`, both defaulted and
  **enforced by a plan-time validation**). Without the mount, every pod restart
  or redeploy silently wipes the agent's accumulated identity.
- **`max_instance_count` is validated to 1.** Hermes' state is SQLite, which has
  a single-writer model — a second concurrent replica corrupts the database. The
  foundation additionally deploys NFS-backed apps with the `Recreate` strategy,
  so updates never briefly run two pods against the volume.
- **The OpenAI-compatible API server listens on port 8642** and requires the
  auto-generated `API_SERVER_KEY` as a bearer token.
- **Probes are TCP port-listening by default** — the API server requires auth, so
  an HTTP probe against it would 401 and wedge the rollout.
- **The web dashboard (port 9119, basic auth) is not exposed by the Service** —
  reach it with `kubectl port-forward`.
- **`API_SERVER_KEY` is injected as an explicit Kubernetes Secret** rather than
  via SecretSync, which can materialise an empty value on first deploy before
  Secret Manager replication completes. All other secrets are SecretSync-backed.
- **At least one model-provider key is required on the initial deployment**
  (`anthropic_api_key`, or `enable_openai` + `openai_api_key`); a plan-time check
  warns when none is supplied.
- **No init jobs, no database bootstrap** — first boot only initialises
  `/opt/data` on the NFS share.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Hermes workload

The Hermes gateway pod is scheduled on Autopilot, which bills for the CPU/memory
the pod actually requests. Replicas are pinned at one; the interesting signals
are pod readiness, restarts, and the NFS volume mount.

- **Console:** Kubernetes Engine → Workloads → select the Hermes workload for
  pods and events; Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl describe pod -n "$NAMESPACE" <pod>            # events: probes, mounts
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

See [App_GKE](App_GKE.md) for Autopilot, workload types, and the deployment
lifecycle.

### B. NFS shared storage — the agent's identity

The entire agent state (SQLite config database, API keys, sessions, learned
skills, memories) lives on the shared self-managed NFS server provisioned by
`Services_GCP` (`create_network_filesystem = true`), mounted at `/opt/data` in
the pod. The NFS VM must be `RUNNING` before this module deploys — discovery
finds it by label.

- **Console:** Compute Engine → VM instances (the NFS server VM).
- **CLI:**
  ```bash
  gcloud compute instances list --project "$PROJECT" \
    --filter="name~nfs" --format="table(name,zone,status)"
  # Confirm the mount inside the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h /opt/data
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /opt/data
  ```

The share and its data are **owned by Services_GCP** — destroying the Hermes
deployment does not delete the agent's state on the NFS export.

### C. Secret Manager

Five secrets can exist per deployment: `ANTHROPIC_API_KEY` (operator-supplied),
`API_SERVER_KEY` (auto-generated 64-char hex — the gateway API bearer token),
`HERMES_DASHBOARD_BASIC_AUTH_PASSWORD` (auto-generated), and optionally
`OPENAI_API_KEY` and `TELEGRAM_BOT_TOKEN`. They surface in the namespace as
Kubernetes Secrets (SecretSync for most; an explicit Secret for
`API_SERVER_KEY`).

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~hermes"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  kubectl get secrets -n "$NAMESPACE"
  ```

Blank credential variables on an update deployment preserve the stored `latest`
version. See [App_GKE](App_GKE.md) for the SecretSync integration.

### D. Artifact Registry — the mirrored image

The official `nousresearch/hermes-agent:<version>` image is mirrored into
Artifact Registry before deployment (`enable_image_mirroring = true`) so nodes
never pull from Docker Hub. There is **no Cloud Build step** — this is a prebuilt
module. Mirrored images are pulled with `imagePullPolicy: Always`.

- **Console:** Artifact Registry → Repositories.
- **CLI:**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list \
    "$REGION-docker.pkg.dev/$PROJECT/<repo>" --filter="package~hermes"
  ```

### E. Networking & ingress

The gateway is exposed through an external LoadBalancer Service by default, with
a reserved static IP so the address survives redeploys. The API server enforces
its own bearer-token auth, so the endpoint being public is by design; a custom
domain with a managed certificate can be layered on via the Gateway API.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IPs.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE metrics to Cloud Monitoring. The
uptime check is **disabled by default** — the API server requires auth, so an
unauthenticated uptime check would always fail.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Hermes Application Behaviour

- **First-boot data-directory initialisation.** The image's ENTRYPOINT is
  s6-overlay's `/init`, which starts as root, `chown`s the `/opt/data` volume
  (the fresh NFS directory) to the non-root `hermes` user, then drops privileges
  and starts the gateway (`container_args = ["gateway", "run"]` — the image's
  default CMD is the interactive CLI, so the gateway must be started explicitly).
- **No database init job.** Hermes creates its own SQLite config database under
  `/opt/data` on first boot; there is nothing to bootstrap and
  `initialization_jobs` is empty. `database_type = "NONE"` and
  `enable_redis = false` are hard-coded in the Foundation call.
- **API access requires the `API_SERVER_KEY`.** The OpenAI-compatible endpoint on
  port 8642 authenticates with a bearer token:
  ```bash
  KEY=$(gcloud secrets versions access latest --secret=<api-server-key-secret> --project "$PROJECT")
  EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" \
    -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
  curl -s -H "Authorization: Bearer $KEY" "http://${EXTERNAL_IP}:8642/v1/models"
  ```
  (The Service maps its port to the container port; check `kubectl get svc` for
  the exposed port.)
- **Dashboard via port-forward.** The in-process web dashboard (API-key
  management, profile configuration) runs on port 9119 behind basic auth and is
  not exposed by the Service. Reach it locally:
  ```bash
  kubectl port-forward -n "$NAMESPACE" deploy/<service-name> 9119:9119
  # then open http://localhost:9119 — user `admin`, password from Secret Manager
  ```
- **Connector setup (Telegram).** Set `enable_telegram = true` and supply
  `telegram_bot_token` (from @BotFather). Hermes' Telegram connector
  **long-polls outbound** — no webhook, router, or public callback URL is needed.
  A plan-time validation rejects `enable_telegram = true` with an empty token.
  Other connectors (Discord, Slack, WhatsApp, Signal) are configured through the
  operator `environment_variables` map.
- **Version updates use `Recreate`.** Because the app is NFS-backed, the
  foundation replaces the pod stop-then-start instead of rolling — a brief gap in
  availability during updates is expected and protects the SQLite database from
  a two-writer overlap.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Hermes are listed; every other input is
inherited from [App_GKE](App_GKE.md) with its standard behaviour and defaults.

### Group 1 — Project, Identity & Credentials

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the workload and regional resources. |
| `anthropic_api_key` | `""` | Primary model-provider key, injected as `ANTHROPIC_API_KEY`. Required on the initial deployment (or use OpenAI); omit on updates to keep the stored version. |
| `api_server_key` | `""` (auto) | Bearer token for the OpenAI-compatible API server. Auto-generated 64-char hex when blank. |
| `enable_openai` / `openai_api_key` | `false` / `""` | Optional secondary provider, injected as `OPENAI_API_KEY`. |
| `enable_dashboard` | `true` | Run the port-9119 dashboard in-process; reach via `kubectl port-forward`. |
| `dashboard_username` / `dashboard_password` | `admin` / `""` (auto) | Dashboard basic auth; password auto-generated into Secret Manager. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `hermes` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `nousresearch/hermes-agent` image tag; pin to a release tag in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_resources` | `2000m` / `2Gi` | CPU and memory limits for the gateway container. |
| `min_instance_count` | `1` | Keep at 1 to avoid cold starts for agent sessions. |
| `max_instance_count` | `1` | **Validated to 1** — SQLite single-writer on the shared NFS. |
| `container_port` | `8642` | The gateway's OpenAI-compatible API server port. |
| `timeout_seconds` | `3600` | Agent sessions can be long-running. |
| `container_image_source` | `prebuilt` | Deploys the official image with no build step. |
| `enable_image_mirroring` | `true` | Mirror into Artifact Registry to avoid Docker Hub rate limits. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra config; module-managed vars (`API_SERVER_*`, `HERMES_DASHBOARD*`) take precedence. Use for Discord/Slack/WhatsApp/Signal connector credentials or provider endpoints (e.g. OpenRouter). |
| `secret_environment_variables` | `{}` | Map of env var → existing Secret Manager secret name. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP by default; the API server enforces bearer-token auth. |
| `session_affinity` | `ClientIP` | Sticky routing (single replica, so mostly moot). |
| `termination_grace_period_seconds` | `60` | Time for active agent sessions to complete on shutdown. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | TCP, 10s delay, 36 retries | TCP port-listening — safe regardless of API-server auth; headroom for the NFS mount and first-boot init. |
| `liveness_probe` | TCP, 30s delay | TCP port-listening. |
| `uptime_check_config` | disabled | An unauthenticated uptime check would always fail against the authed API server. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | **Required — validated.** The agent's entire identity lives under `/opt/data`. |
| `nfs_mount_path` | `/opt/data` | The image's fixed data directory; the NFS share is mounted directly over it. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Auxiliary GCSFuse mounts only — never point one at `/opt/data` (SQLite is unsafe on GCSFuse). |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Artifact Registry cleanup policy. |

### Group 15 — Hermes Connectors

| Variable | Default | Description |
|---|---|---|
| `enable_telegram` | `false` | Provision the Telegram bot token secret and inject `TELEGRAM_BOT_TOKEN`. |
| `telegram_bot_token` | `""` | Bot token from @BotFather; required (validated) when `enable_telegram = true`. |

### Group 19 — Custom Domain & Static IP

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Gateway API custom-domain configuration with managed SSL (needs `application_domains`). |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

Inert convention mirrors: the database (group 16), Redis (group 15 mirrors),
custom-SQL (group 18), and `enable_cloudsql_volume` variables are declared for
convention parity but hard-coded off in `main.tf` — Hermes has no database and
no Redis.

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
| `service_url` | URL to reach the gateway API server. |
| `storage_buckets` | Created Cloud Storage buckets (none by default). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `cron_jobs` | Setup and scheduled job names (empty by default). |
| `statefulset_name` | StatefulSet name (when a StatefulSet workload is selected). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `cicd_configuration` | CI/CD status and details. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | CI/CD GitHub details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster endpoint was readable and Kubernetes workloads deployed (false on the first apply of a new inline cluster — re-run apply). |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

> **Plan-time validation.** This module's `validation.tf` and the
> [App_GKE](App_GKE.md) foundation engine validate values *and combinations* at
> plan time — `max_instance_count > 1`, `enable_nfs = false`, a Telegram
> connector without its token, or OpenAI enabled without a key all fail the
> **plan** with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `max_instance_count` | `1` (validated) | Critical | A second concurrent replica writes the same SQLite database on NFS — single-writer violation corrupts the agent's entire state. |
| `enable_nfs` | `true` (validated) | Critical | Without the NFS mount, `/opt/data` is ephemeral pod disk — every restart / redeploy silently wipes the agent's identity (config, sessions, skills, memories). |
| `gcs_volumes` at `/opt/data` | never | Critical | GCSFuse lacks POSIX locking and atomic renames; SQLite on GCSFuse corrupts. Keep state on NFS. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |
| `anthropic_api_key` (or OpenAI pair) | set on first deploy | High | Without any provider key the agent cannot run a single turn. |
| NFS VM not `RUNNING` | wait before deploying | High | Discovery finds no server → the module creates an inline NFS or the mount fails; the pod sticks in `ContainerCreating`. |
| `startup_probe` / `liveness_probe` | TCP (default) | Medium | An HTTP probe against the authed API server returns 401/403 forever — the pod never becomes Ready and the rollout wedges. |
| `min_instance_count` | `1` | Medium | GKE has no scale-to-zero, but a manual scale-down leaves connectors offline. |
| `application_version` | pin a release tag | Medium | `latest` re-resolves per mirror run; behaviour can change under you on redeploy. |
| `enable_telegram` without token | blocked | Low | Plan-time validation rejects it; the connector cannot start without the bot token. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Hermes-specific
application configuration shared with the Cloud Run variant is described in
**[Hermes_Common](Hermes_Common.md)**.
