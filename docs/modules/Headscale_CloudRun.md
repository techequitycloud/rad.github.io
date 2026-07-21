---
title: "Headscale on Google Cloud Run"
description: "Configuration reference for deploying Headscale on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Headscale on Google Cloud Run

Headscale is an open-source, self-hosted implementation of the Tailscale
coordination server — a control plane for a private WireGuard mesh VPN,
compatible with the official Tailscale clients. Headscale is **not** a VPN
gateway or relay itself: it authenticates nodes, distributes each peer's
public key and IP allocation, and keeps the mesh's network map in sync.
Actual encrypted traffic between devices flows directly, peer-to-peer, over
WireGuard (or via Tailscale's own public DERP relay infrastructure when a
direct connection isn't possible) — it never passes through Headscale. This
module deploys Headscale on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Headscale uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress
and load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## 1. Overview

Headscale runs as a single Go binary on Cloud Run v2, built from a custom,
`ko`-based upstream image. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Go service, 1 vCPU / 1 GiB by default; hard-pinned to a single instance |
| Database | Embedded SQLite | No Cloud SQL instance — `database_type = "NONE"` |
| Persistence | Cloud Storage (GCS Fuse) | The SQLite file, WAL sidecars, and WireGuard/Noise keys live at `/var/lib/headscale` |
| Secrets | Secret Manager | None — Headscale has no application-level secrets in this module |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; needs to stay public for real Tailscale clients to register |

**Sensible defaults worth knowing up front:**

- **SQLite is the only supported database.** There is no external Cloud SQL
  instance; all state (node registry, pre-auth keys, the Noise-protocol
  private key) lives in a single SQLite file under `/var/lib/headscale`.
- **`max_instance_count` is hardcoded to `1` downstream, not just defaulted.**
  `Headscale_Common` sets `config.max_instance_count = 1` as a literal value —
  the Application Module's `max_instance_count` variable is never actually
  read. Headscale has no active-active support, and two writers against the
  same SQLite file would corrupt it.
- **Scale-to-zero is enabled by default** (`min_instance_count = 0`). Unlike
  apps with a database or search index to warm, Headscale's SQLite file and
  WireGuard key make cold starts fast.
- **Storage is GCS-Fuse-backed on Cloud Run — a real, documented trade-off.**
  SQLite's WAL mode needs genuine POSIX file locking, which gcsfuse does not
  reliably provide. This is acceptable only because concurrent writers are
  structurally impossible (`max_instance_count` pinned to 1). See
  [Pitfalls](#7-pitfalls--gotchas) below.
- **Public ingress is required for Tailscale clients to register.**
  `ingress_settings = "all"` is the default so devices anywhere on the
  internet can reach the coordination server. Enabling IAP would block client
  registration entirely — the `tailscale` CLI cannot present a Google
  identity.
- **MagicDNS is off by default.** It requires `dns.base_domain` set and
  genuinely different from `server_url`'s domain — a constraint a single
  baked default can't reliably satisfy per deployment.
- **No default initialization job.** Unlike apps backed by an external
  database, Headscale's SQLite file is created automatically on first boot.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#6-outputs).

### A. Cloud Run — the Headscale service

Headscale runs as a single Cloud Run v2 service. Because `max_instance_count`
is hardcoded to `1`, there is no horizontal autoscaling to observe — only
scale-to-zero and cold starts.

- **Console:** Cloud Run → select the service for revisions, traffic, logs,
  and metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud Storage — the SQLite storage volume

A dedicated `storage` GCS bucket is provisioned automatically and mounted at
`/var/lib/headscale` via GCS Fuse. It holds `db.sqlite` (+ `-wal`/`-shm`
sidecars in WAL mode), `noise_private.key`, and the legacy WireGuard key.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/          # bucket name is in the Outputs
  ```

See [App_CloudRun](App_CloudRun.md) for GCS Fuse mount mechanics and CMEK
options.

### C. Networking & ingress

The service is reachable at its `run.app` URL by default, allowing public
access — required for real Tailscale clients on arbitrary devices/networks to
reach the coordination server and register. An external HTTPS load balancer
with a custom domain, Cloud CDN, and Cloud Armor can be layered on.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md).

### D. Cloud Logging & Monitoring

Container logs flow to Cloud Logging. On boot, a healthy instance logs
private-key generation, "database opened successfully", and "listening and
serving HTTP". Cloud Run metrics flow to Cloud Monitoring, with optional
uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Headscale Application Behaviour

- **SQLite auto-initializes on boot.** There is no separate database-setup
  job — on first start, Headscale creates `db.sqlite` under
  `/var/lib/headscale` and applies its own internal schema migrations
  automatically.
- **Private key auto-generation.** On first boot Headscale generates its
  Noise-protocol private key at `noise_private.key` (the path configured via
  `noise.private_key_path` in the baked config) if it does not already exist.
  Losing this key (or the storage volume) forces every previously-registered
  client node to re-register.
- **Health endpoint.** `/health` is a real, unauthenticated endpoint —
  confirmed live returning HTTP 200 alongside "listening and serving HTTP" in
  the application logs. Both the startup and liveness probes target it by
  default.
- **First-run setup is a manual, post-deploy step.** Headscale ships with no
  web-based signup flow. Creating the first "user" (namespace) and issuing a
  pre-auth key for registering client nodes both happen via the `headscale`
  CLI, run against the same `/ko-app/headscale` binary the service uses. On
  Cloud Run, the practical way to run these one-off commands is a Cloud Run
  Job execution against the deployed image:
  ```bash
  # Create the first user/namespace:
  gcloud run jobs execute <job-name> --project "$PROJECT" --region "$REGION" \
    --container <service-name> --command="/ko-app/headscale" \
    --args="users,create,myuser" --wait

  # Issue a pre-auth key for that user (valid 1 hour, reusable):
  gcloud run jobs execute <job-name> --project "$PROJECT" --region "$REGION" \
    --container <service-name> --command="/ko-app/headscale" \
    --args="preauthkeys,create,--user,myuser,--reusable,--expiration,1h" --wait
  ```
  See the [hands-on lab](../labs/Headscale_CloudRun.md) for the full,
  concrete walkthrough — the exact job/exec mechanics depend on how the
  platform names its one-off execution resources.
- **Connecting a real Tailscale client.** Once a pre-auth key exists:
  ```bash
  tailscale up --login-server=<server_url> --authkey=<preauthkey>
  ```
  The device then appears as a node in Headscale's registry.
- **Inspecting registered nodes:**
  ```bash
  # Run against the deployed binary the same way as user/key creation above:
  # headscale nodes list
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Headscale are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `headscale` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | `"latest"` resolves to the pinned upstream build `HEADSCALE_VERSION=0.26.1` — a Dockerfile build ARG, not a generic version pass-through. |
| `server_url` | `""` | Public URL of the control plane, baked into every client's registration. Defaults to this service's own deterministic Cloud Run URL when left empty. Changing it later requires re-registering every node. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Per-instance resource limits. |
| `min_instance_count` | `0` | Scale-to-zero; cold starts are fast (no DB/index to warm). |
| `max_instance_count` | `1` | **Hardcoded to `1` downstream regardless of this value** — see [Pitfalls](#7-pitfalls--gotchas). |
| `container_port` | `8080` | Headscale's native listen port. |
| `execution_environment` | `gen2` | Required for the GCS Fuse storage mount. |
| `enable_cloudsql_volume` | `false` | Not applicable — no Cloud SQL. |
| `enable_image_mirroring` | `true` | Mirror the built image into Artifact Registry. |

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Required for real Tailscale clients on arbitrary networks to reach and register. |
| `enable_iap` | `false` | **Never enable for normal use** — IAP requires a Google identity, which the `tailscale` CLI cannot present, blocking every client registration. |

### Group 11 — Cloud Storage & Filesystem

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Creates the `storage` bucket backing `/var/lib/headscale`. |
| `gcs_volumes` | `[]` | Additional GCS Fuse mounts. The `storage` bucket is added automatically. |
| `enable_redis` | `true` (declared) | Not referenced — hardcoded `false` in `main.tf`; Headscale has no use for Redis. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `NONE` | Fixed by `Headscale_Common` — Headscale is entirely SQLite-based, there is no Cloud SQL instance. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | No default job — SQLite initializes itself on first boot. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, 15s delay, threshold 10 | Real, unauthenticated Headscale endpoint. |
| `liveness_probe` | HTTP `/health`, 30s delay, threshold 3 | Same endpoint. |
| `uptime_check_config` | disabled | Optional Cloud Monitoring uptime check on `/health`. |

---

## 5. GCP Service Exploration Reference

See §2 above — Cloud Run, Cloud Storage, networking, and logging/monitoring
are the full set of services this module touches directly (beyond the shared
VPC/IAM/Artifact Registry infrastructure common to every `App_CloudRun`
deployment).

---

## 6. Outputs

Returned on a successful deployment — the quickest way to locate and explore
the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service — this is what `server_url` predicts and what clients register against. |
| `service_location` | Region the service runs in. |
| `stage_services` | Stage-specific service URLs (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | External HTTPS load balancer IP / URL (when enabled). |
| `storage_buckets` | Created Cloud Storage buckets (the `storage` bucket backing `/var/lib/headscale`). |
| `network_name` / `network_exists` / `regions` | VPC network, presence, regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Monitoring status, channels, uptime checks. |
| `initialization_jobs` | Names of any custom setup jobs (empty by default). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 7. Pitfalls & Gotchas

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_CloudRun](App_CloudRun.md) foundation engine, which
> validates values and combinations at plan time. See
> [App_CloudRun](App_CloudRun.md) for the general validation behaviour.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| SQLite on GCS Fuse | Accept the trade-off, or use `Headscale_GKE` for production | **Critical** | SQLite's WAL/journal files need real POSIX file locking, which gcsfuse does not reliably provide — confirmed live via repeated `BufferedWriteHandler.OutOfOrderError` log entries for `db.sqlite`/`db.sqlite-wal`/`db.sqlite-shm`. gcsfuse falls back to a slower legacy write path; the app kept working in observed testing, but this is a known SQLite-corruption risk class documented elsewhere in this catalog. **There is no fix available on Cloud Run** — no block-volume alternative exists, only gcsfuse or ephemeral storage. For a production deployment, use [Headscale_GKE](Headscale_GKE.md) with `stateful_pvc_enabled = true` (its default) instead. |
| `max_instance_count` | Leave at `1` (it's hardcoded anyway) | High | The variable is declared but never actually read by `Headscale_Common` — `config.max_instance_count` is a literal `1`. Setting it higher gives a false impression that horizontal scaling is available; it is not, and would corrupt the SQLite file if it were. |
| `server_url` | Set once, before registering clients | Critical | Baked into every client's registration. Changing it after clients have registered requires re-registering every node against the new URL. |
| `ingress_settings` | `all` | Critical | Setting `internal` makes the coordination server unreachable to real Tailscale clients on the public internet — the entire point of the deployment breaks. |
| `enable_iap` | `false` | Critical | IAP requires a Google identity for every request. The `tailscale` CLI cannot present one, so enabling IAP blocks all client registration and mesh sync traffic. |
| Losing the storage volume/bucket | Never manually delete the `storage` bucket while nodes are registered | Critical | The Noise-protocol private key and the entire node registry live there. Losing it forces every client to re-register from scratch. |
| MagicDNS (`dns.magic_dns`) | Leave `false` unless you also set a genuine `dns.base_domain` | Medium | Enabling MagicDNS without a valid, distinct `base_domain` from `server_url`'s domain produces broken DNS resolution for clients; the module ships it off by design. |
| `-debug` image assumption | Don't assume a shell is available | Low (build-time) | The `-debug` tag bundles busybox but has no `/bin/sh` on `PATH` — a naive Dockerfile change using `#!/bin/sh` or `RUN` shell steps against this base will fail. Already handled correctly in the shipped Dockerfile/entrypoint; relevant if you fork it. |

---

For the foundation behaviour referenced throughout — service identity,
scaling and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Headscale-specific application
configuration shared with the GKE variant is described in
**[Headscale_Common](Headscale_Common.md)**.
