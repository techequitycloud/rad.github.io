---
title: "Headscale on Google Cloud Run"
description: "Configuration reference for deploying Headscale on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Headscale on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Headscale_CloudRun.png" alt="Headscale on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

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

## What Headscale costs on RAD, and how that compares

**Running Headscale on Cloud Run in your own Google Cloud project costs about $31.01/month in Google Cloud charges**, on top of a one-off 40-credit RAD module fee charged once at deploy time. Headscale is an independent, open-source reimplementation of a private WireGuard coordination server, compatible with official Tailscale clients — it is not a hosted version of any commercial product, so there's no SaaS price to quote against it. In a RAD-managed project the module fee drops to 36 credits (10% lower) and the running cost is metered hourly in credits instead of billed directly by Google — see [Pause it for free](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) below for the one RAD-managed advantage a self-hosted VPS cannot match — or see the [GKE guide](Headscale_GKE.md) if you'd rather run it on Kubernetes.

### What you pay on RAD

| | Own project | RAD-managed project |
|---|---|---|
| Module fee (one-off) | 40 credits | 36 credits (10% lower) |
| Build time | ~3-6 credits per build, either way | ~3-6 credits per build, either way |
| Google Cloud running cost | $31.01/month, billed by Google at list price | ~9 credits/day, metered at list price plus RAD's margin |

**Default running cost in your own project**

| Resource | US$/month (Google list price, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (scaleToZero) | $11.58 |
| NFS/cache file server (small VM) | $13.43 |
| Cloud NAT and networking | $5.00 |
| Cloud Storage (add-ons, backups) | $1.00 |
| **Total** | **$31.01** |

### How it compares

- A self-managed comparison: Hetzner CPX22 (2 vCPU/4GB) runs about $24/mo, a DigitalOcean 2 vCPU/4GB Droplet is the same $24/mo, and a GCP Compute Engine e2-standard-2 (2 vCPU/8GB) is about $49/mo — more than this lightweight 1 vCPU/1 GiB coordination server needs, but the smallest widely-quoted reference point.
- Headscale needs no database of its own in this deployment (it uses SQLite internally), so most of its own-project running cost above is the small NFS file server, not a managed Postgres instance.
- The admin trade-off is the same shape as every entry here: a cheaper VPS, self-patched, versus RAD's managed file server, Secret Manager and monitoring.

### Pause it for free: delete a RAD-managed project, restore it when you need it

This is the headline advantage of a RAD-managed project, and it costs nothing while paused.
Deleting a RAD-managed project unlinks its billing first, then asks Google to delete the
project outright — Google's own 30-day recoverable soft delete. Unlike deleting one module,
this does **not** tear down Cloud SQL, any VM, or the compute resource one by one: the whole
project simply stops, and nothing is charged while it waits, because billing is already
unlinked.

Restoring, within 30 days and only by the project's owner, asks Google to undelete the
project and reattaches its billing account, then asks you to run Update on each deployment to
confirm everything came back. Because nothing was individually destroyed, that Update finds
the same resources already there — it is a check, not a rebuild, and an Update never charges
the module fee again. This costs only a handful of credits (under US$1) in total for a typical
2-3-deployment chain.

What this needs: you must own the project (not one RAD only manages billing for), you must
restore it yourself within 30 days — after that Google deletes it for good — and restoring is
admitted like creating a new project, so your purchased credit balance must still clear the
tier's floor (100 credits for the sandbox tier most study/demo use fits). Google says most
services are fully working again within 36 hours of a restore.

One real gap: nightly backups are written to a bucket inside the project, and that bucket has
Cloud Storage's soft-delete explicitly turned off, so it is very likely gone as soon as you
delete the project — even though the project itself is recoverable for 30 days. If you've
customised Headscale and want to keep that work, copy a backup out (to Google Drive, or a bucket
outside the project) before deleting. For a default install with nothing irreplaceable in it,
this does not matter.

### Pay only while you use it, the other way: delete and redeploy

In your own project, or once 30 days have passed on a RAD-managed one, there is no free pause —
deleting removes the resources for good, and bringing Headscale back means redeploying from
scratch. That costs about 43-46 credits (the 40-credit module fee plus a build).

Deleting only saves money once Headscale would otherwise sit unused long enough to clear that
redeploy cost against its own running cost — for Headscale, that's about 5 days or
more. Most of that running cost is usually the database (and, where this module uses one, the shared file-server VM or GKE cluster) — those stop only once nothing else in the project uses them, so deleting this app while something else shares the project saves only its own compute share.

Keep data first: nightly backups go to a bucket inside the deployment and are deleted with it,
so copy the latest backup out before deleting if you want to keep it.

### Lab sessions and Managed Environments

Lab sessions, for training: a trainer runs a session for a class. Each participant gets the
app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the
trainer sets. Either the trainer funds every place, or each participant pays for their own.
Everything is deleted when the session ends and unused credits go back to the trainer.

Managed Environments, for consultancies: a partner runs the app for a client from a
ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the
partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud Billing Catalog API list prices; [radmodules.dev/pricing](https://radmodules.dev/pricing) for RAD's own fees and daily-credit estimates; [Google's project delete/restore documentation](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore claims.

## 1. Overview

Headscale runs as a single Go binary on Cloud Run v2, built from a custom,
`ko`-based upstream image. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Go service, 1 vCPU / 1 GiB by default; hard-pinned to a single instance |
| Database | Embedded SQLite | No Cloud SQL instance — `database_type = "NONE"` |
| Persistence | Cloud Filestore (NFS) | The SQLite file and WireGuard/Noise keys live at `/var/lib/headscale`, on the NFS share by default |
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
- **Storage is on NFS, and WAL is off.** Cloud Run has no block device, and GCS Fuse
  cannot host SQLite (no POSIX or shared-memory locking), so `/var/lib/headscale` is the
  NFS mount path (`enable_nfs = true` by default) and the GCS Fuse bucket is mounted
  there only if NFS is turned off. NFS provides POSIX locking but not the shared-memory
  mapping WAL needs, so this variant runs SQLite with `write_ahead_log` disabled. See
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

### B. The SQLite storage volume

`/var/lib/headscale` holds `db.sqlite`, `noise_private.key`, and the legacy WireGuard
key. By default it is the NFS mount path. A dedicated `storage` GCS bucket is also
provisioned; it is mounted at `/var/lib/headscale` via GCS Fuse only when
`enable_nfs = false` — avoid that, because a SQLite database written over GCS Fuse is
corrupt while `/health` still passes.

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
| `execution_environment` | `gen2` | Required for the NFS (and GCS Fuse) storage mounts. |
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
| `gcs_volumes` | `[]` | Additional GCS Fuse mounts. The `storage` bucket is added automatically only when `enable_nfs = false`. |
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
| `api_url` | Default `run.app` URL of the service — this is what `server_url` predicts and what clients register against. |
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
| `enable_nfs` | `true` (the default) | **Critical** | Turning NFS off moves `/var/lib/headscale` onto GCS Fuse, which cannot host SQLite: the database is corrupt on arrival while `/health` still passes. For a block device and WAL mode, use [Headscale_GKE](Headscale_GKE.md) with `stateful_pvc_enabled = true` (its default). |
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

<!-- related-guides -->

## Related guides

- [Hands-on lab: Headscale on Cloud Run](../labs/Headscale_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Headscale on GKE Autopilot](Headscale_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Headscale Common — Shared Application Configuration](Headscale_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Synapse on Google Cloud Run](Synapse_CloudRun.md), [Element on Google Cloud Run](Element_CloudRun.md), [Vaultwarden on Google Cloud Run](Vaultwarden_CloudRun.md) in the **Secure Team Communications** solution.
