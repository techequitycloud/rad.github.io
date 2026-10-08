---
title: "Logto on GKE Autopilot"
description: "Configuration reference for deploying Logto on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Logto on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Logto_GKE.png" alt="Logto on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Logto is an open-source, MPL-2.0-licensed identity provider — an Auth0 alternative
that speaks OIDC and OAuth 2.0 and ships with sign-in flows, social/enterprise
connectors, multi-tenancy, and an admin console. This module deploys Logto on
**GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions and
manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Logto uses and how to explore and operate
them from the Google Cloud Console and the command line. For the mechanics that are
common to every GKE application — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, backups, and the
deployment lifecycle — refer to the [App_GKE foundation guide](App_GKE.md) rather than
repeating them here.

---

## What Logto costs on RAD, and how that compares

**Logto on RAD's GKE Autopilot module costs about US$150 a month in your own project, with no per-user or per-MAU fee.** RAD charges 175 credits once per deployment in your own project (157.5 credits, 10% lower, in a project RAD manages), plus build time. The same app also deploys on Cloud Run for about US$110 a month — see the [Cloud Run guide](Logto_CloudRun.md) for the lower-cost option. If you only need it occasionally, a RAD-managed project can be deleted and restored within 30 days for a few credits, so that monthly figure becomes a few dollars instead — see **Pause it for free**, below.


### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 175 credits (US$17.50 at the top-up price) | 157.5 credits (10% lower) |
| Build time | A few credits per build | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$150 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **111 credits a day**, about 3,330 a month (about US$333.00 at the top-up price, less on a plan) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 2x vCPU / 4 GiB | US$79 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51 |
| NFS/cache file server (small VM) | US$13 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | shared across every GKE app in the project; US$0 if this is your only cluster, else ~US$73 |
| **Total** | **about US$150** |

### How it compares

- **Auth0** (B2C) starts at **US$35 a month** on its Essentials plan for up to 500
  monthly active users, scaling with MAUs after that; its B2B Essentials plan starts at
  **US$150 a month**. A free tier covers up to 25,000 MAUs but drops most enterprise features.
- RAD's Logto module costs about US$150 a month in your own project — more than
  Auth0's entry tier at very low user counts, but it has **no MAU-based metering or per-tenant
  pricing tier to grow out of**, and you hold the user database and signing keys yourself
  rather than trusting a third party with every login.
- Self-managed comparison: Logto's 2 vCPU / 4 GiB footprint is close to a GCP Compute Engine
  e2-standard-2 (~US$49/month) or a larger Hetzner/DigitalOcean box, plus you would still need
  to run and patch PostgreSQL and the NFS/cache layer it depends on yourself.


### Pause it for free: delete a RAD-managed project, restore it when you need it

If Logto runs in **a project RAD manages for you**, you have a second option that goes
well beyond scaling to zero: **delete the whole project, and restore it within 30 days for
close to nothing.** This suits Logto you only need occasionally — evaluating it, a demo
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
  is a check, not a rebuild, and an Update never charges the module fee again. For Logto behind Services_GCP (a GKE cluster, a small NFS/cache VM, a Postgres database) and Project_GCP, that is roughly **a handful of credits (under US$1)** in total, against the about 180 credits (US$18.00) a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$150.**
  Deploy Logto, use it for a while, delete the project. Restore it next time you need it,
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
  though the project itself is recoverable for 30 days. If you have customised Logto and
  want to keep that work, copy a backup out (to Google Drive, or a bucket outside the project)
  before you delete. For a default installation with nothing irreplaceable in it, this does
  not matter.


### Pay only while you use it, the other way: delete and redeploy

The option above only applies to a RAD-managed project; **in your own project, or once the
30-day window has passed, the way to stop paying is to delete the deployment and deploy it
again when you need it.**

- **What a redeploy costs.** The module fee again, plus the builds — roughly
  180 credits (US$18.00) in total. Deleting saves money
  only once Logto would otherwise sit unused long enough to clear that redeploy cost
  against its own running cost — about **4 days or more**, both in your own project
  (about US$4.99 a day) and in a RAD-managed one (111 credits a day).
- **Most of the running cost is usually shared.** For Logto that is the database and the shared file/cache VM. They stop only when nothing else in the project uses them, so deleting this app while something else shares the project saves only this app's own compute part.
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


**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD fees and the daily-credit estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore mechanics and what it says about Cloud Storage objects without soft delete; [Auth0](https://auth0.com/pricing). Prices change; check each source before relying on a figure.


## 1. Overview

Logto runs as a Node.js web workload. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Node.js pods, 2 vCPU / 4 GiB by default, horizontally autoscaled |
| Database | Cloud SQL for PostgreSQL 15 | Required — Logto does not support MySQL or other engines |
| Object storage | Cloud Storage | One bucket provisioned automatically; optional for Logto (all core state is in Postgres) |
| Secrets | Secret Manager | Only the database password — Logto has **no** external application secret (OIDC keys are DB-seeded) |
| Ingress | Cloud Load Balancing | External LoadBalancer; optional custom domain + managed certificate (nip.io host by default) |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is mandatory.** The database engine is fixed by the shared
  application layer; a plan-time guard rejects any non-PostgreSQL `database_type`.
- **Logto core is published on port 3001; the admin console (3002) is not.** A single
  GKE Service publishes one port, so only the core API / OIDC endpoint (3001) is
  reachable. The admin console — where the first admin account and applications are
  registered — runs on 3002 and needs a separate route (e.g. `kubectl port-forward`)
  for first-run setup (see §3).
- **There is no application secret to protect.** Logto generates its OIDC signing keys
  on first boot and stores them **in the database**. Nothing in Secret Manager needs to
  be guarded or rotated except the foundation-managed DB password. Protecting Logto's
  keys means protecting Cloud SQL.
- **Cloud SQL over the Auth Proxy loopback.** On GKE the Auth Proxy sidecar listens on
  `127.0.0.1`; Logto's entrypoint connects over plain TCP loopback with SSL disabled
  (the proxy terminates TLS to Cloud SQL).
- **Session affinity is `ClientIP` by default** so a client consistently reaches the
  same pod.
- **`service_type = LoadBalancer` with a static IP and nip.io custom domain by
  default** (`reserve_static_ip = true`, `enable_custom_domain = true`), giving Logto a
  stable externally reachable HTTPS host out of the box.
- **No Redis.** Logto is Postgres-backed; `enable_redis` defaults to `false`.
- **`ENDPOINT` is derived from the service URL.** The entrypoint sets Logto's OIDC
  issuer and absolute URLs from the injected `GKE_SERVICE_URL`; update `ENDPOINT` to
  the external LoadBalancer / custom-domain URL once it is known.
- **Minimum 1 replica is maintained** (GKE does not support scale-to-zero) to keep the
  identity endpoint always reachable.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other
identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Logto workload

Logto pods are scheduled on Autopilot, which bills for the CPU/memory the pods actually
request. Horizontal Pod Autoscaling sizes the deployment between the minimum and
maximum replica counts. The container and Service publish port **3001** (Logto core).

- **Console:** Kubernetes Engine → Workloads → select the Logto workload to see pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_HOST|DB_IP|ENDPOINT'
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload type
(Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Logto stores everything — users, applications, connectors, OIDC signing keys, and
per-tenant roles — in a managed Cloud SQL for PostgreSQL 15 instance. Pods reach it
through the **Cloud SQL Auth Proxy** sidecar on `127.0.0.1`; the entrypoint connects
over plain TCP loopback (the proxy terminates TLS). On first deploy an initialization
Job creates the application database and role (with `CREATEROLE`, required for Logto's
per-tenant RLS roles).

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database (`logto`), user (`logto`), and the Secret Manager secret
holding the password are all surfaced in the [Outputs](#5-outputs). For the connection
model, automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. Cloud Storage

One **Cloud Storage** bucket is provisioned automatically and the workload service
account is granted access. Logto keeps all core state in PostgreSQL, so this bucket is
available for optional assets rather than required runtime storage.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/          # bucket name is in the Outputs
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts.

### D. Secret Manager

Logto has **no external application secret** — its OIDC signing keys are generated and
stored in the database on first boot. The only secret in play is the **database
password**, which the foundation generates and manages and syncs into the pod via the
Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~logto"
  gcloud secrets versions access latest --secret=<database_password_secret> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP with a
reserved static address and a nip.io-based custom domain + managed certificate. Logto's
OIDC issuer and all absolute redirect URLs are built from `ENDPOINT`, so the external
host, the issuer, and registered redirect URIs must all agree — update `ENDPOINT` to
the external URL once the LoadBalancer IP / domain is assigned.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud
Monitoring. The entrypoint prints a `[cloud-entrypoint]` line reporting the resolved DB
connection mode and `ENDPOINT` — useful when diagnosing connection or issuer-URL
problems.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Logto Application Behaviour

- **First-deploy database setup.** An initialization Job runs `db-init.sh` using
  `postgres:15-alpine`. It idempotently creates the application role **with
  `CREATEDB CREATEROLE`** (required for Logto's per-tenant RLS roles) and the
  application database, grants privileges, transfers `public` schema ownership to the
  app role, then signals the Auth Proxy sidecar to shut down so the Job pod can
  complete. The job is safe to re-run.
- **Schema and OIDC keys seeded on boot.** On start Logto runs
  `npm run cli db seed -- --swe` (`--swe` = seed-when-empty, idempotent) which creates
  its schema and generates the OIDC private signing keys **into the database** — only
  when the database is empty. These keys are not stored in Secret Manager; the database
  is their sole custodian. Wiping the database regenerates new keys and invalidates all
  previously issued tokens and registered clients.
- **No application secret to rotate.** There is no encryption key or JWT secret in
  Secret Manager — only the foundation-managed DB password.
- **Admin console (3002) is not published.** The Service exposes only the core (3001).
  Reach the admin console to create the first administrator and register applications
  via a port-forward:
  ```bash
  kubectl port-forward -n "$NAMESPACE" deploy/<service-name> 3002:3002
  # then open http://localhost:3002
  ```
  `ADMIN_ENDPOINT` defaults to the same host as `ENDPOINT` for URL consistency.
- **`ENDPOINT` must match the browser-facing host.** Logto builds its OIDC issuer and
  redirect URLs from `ENDPOINT`; the entrypoint sets it from `GKE_SERVICE_URL`. Update
  it to the external LoadBalancer or custom-domain URL via `environment_variables` once
  the external address is known.
- **Health path.** The startup probe targets `/api/status`; the liveness and readiness
  probes target `/oidc/.well-known/openid-configuration`. The liveness path must return a
  literal `200` because App_GKE mirrors it into the Gateway health check, and
  `/api/status` returns `204`, which the load balancer treats as unhealthy (the Gateway
  would serve 503). The container port and probes must all be `3001`. Verify:
  ```bash
  kubectl port-forward -n "$NAMESPACE" deploy/<service-name> 3001:3001 &
  curl -s http://localhost:3001/oidc/.well-known/openid-configuration
  ```
- **Inspect init-job execution:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Logto are listed; every other input is inherited from
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
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `logto` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Logto image tag (`svhd/logto:<tag>`); pin to a specific release (e.g. `1.33`) in production. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `min_instance_count` | `1` | Minimum replicas; GKE requires ≥ 1. Keeps the identity endpoint reachable. |
| `max_instance_count` | `5` | Maximum replicas. |
| `container_resources` | `{cpu_limit="2000m", memory_limit="4Gi"}` | CPU/memory limits and requests for the Logto container; Logto needs at least 2 GiB memory. |
| `container_port` | `3001` | Logto core listens on 3001; the admin console (3002) is not published. Port and probes must match 3001. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar (loopback TCP). |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Kubernetes Service is exposed. |
| `workload_type` | `null` (→ Deployment) | `Deployment` (stateless; Logto keeps all state in Postgres) or `StatefulSet`. |
| `session_affinity` | `ClientIP` | Sticky routing so a client stays on one pod. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (off) | Not needed — Logto stores all state in PostgreSQL. Enabling auto-selects `StatefulSet`. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/status`, wide first-boot window | Allows time for the seed step. |
| `liveness_probe` | HTTP `/oidc/.well-known/openid-configuration` | Liveness/readiness probe. Must return a literal `200` — it is mirrored into the Gateway health check, and `/api/status` returns `204`. |
| `uptime_check_config` | disabled — `/` | Optional Cloud Monitoring uptime check against the LoadBalancer host; disabled by default. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `db-init` job. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisions a shared Filestore volume. Not required by Logto (it stores all state in PostgreSQL) — safe to override to `false`. |

### Group 15 — Redis Cache & Queue

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Logto uses Postgres for all persistence — leave `false`. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `application_database_name` | `logto` | PostgreSQL database name. Immutable after first deploy. |
| `application_database_user` | `logto` | Application database user (granted `CREATEROLE`). Immutable after first deploy. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress + managed certificate (nip.io host by default). |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `application_domains` | `[]` | Hostnames to serve; set `ENDPOINT` to match. |

### Group 20 — Identity-Aware Proxy (IAP)

> **Warning:** Enabling IAP requires Google identity authentication for **all** inbound
> requests, including the OIDC/login flows Logto exists to serve. Leave off for a
> public identity provider.

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Logto. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate
and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Logto core. |
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

> **Inherited plan-time validation.** This module passes its configuration through the [App_GKE](App_GKE.md) foundation engine, which validates values *and combinations* at plan time — a non-PostgreSQL `database_type`, `min_instance_count > max_instance_count`, Redis enabled with no resolvable host, IAP with no authorized identities, a custom domain with no hostnames. Invalid configuration fails the **plan** with a clear, named error before any resource is created, so most mistakes below are caught up front rather than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| Cloud SQL database | Back up; never wipe | Critical | Logto's OIDC signing keys live in the DB. Wiping it regenerates new keys and invalidates every issued token and registered client. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/role and destroys all identity data. |
| `database_type` | `POSTGRES_15` | Critical | MySQL/other engines are rejected at plan time; Logto only runs on PostgreSQL. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid backup file fails the import job. |
| `ENDPOINT` | External LoadBalancer / custom-domain URL | High | A mismatched issuer breaks OIDC discovery, redirect URIs, and every OAuth callback. |
| `container_port` | `3001` | High | The core listens on 3001; a wrong port makes every probe and request fail. Admin console (3002) is intentionally unpublished. |
| `enable_iap` | `false` for a public IdP | High | IAP blocks all unauthenticated requests, including the OIDC/login flows Logto exists to serve. |
| `container_resources.memory_limit` | `4Gi` (≥ 2 GiB) | High | Below ~2 GiB Logto is prone to OOM under load. |
| `session_affinity` | `ClientIP` | High | Without stickiness, sequential requests from one client can hit different pods mid-flow. |
| Admin console access (3002) | `kubectl port-forward` for setup | High | The first-admin/setup UI is on 3002, unreachable via the LoadBalancer — first-run setup stalls without a port-forward. |
| `min_instance_count` | `1` | High | GKE requires min ≥ 1; the validation guard rejects invalid values. |
| `enable_cloudsql_volume` | `true` | High | The Auth Proxy sidecar is required for the loopback PostgreSQL path on GKE. |
| `enable_redis` | `false` | Low | Logto does not use Redis; enabling it wires an unused dependency. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are bytes and block all pod scheduling in the namespace. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity,
autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, backups, and image mirroring — see **[App_GKE](App_GKE.md)**. Logto-specific
application configuration shared with the Cloud Run variant is described in
**[Logto_Common](Logto_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Logto on GKE Autopilot](../labs/Logto_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Logto on Google Cloud Run](Logto_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Logto Common — Shared Application Configuration](Logto_Common.md) — the configuration shared by both deployment targets.
