---
title: "Coder on GKE Autopilot"
description: "Configuration reference for deploying Coder on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Coder on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Coder_GKE.png" alt="Coder on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Coder is an open-source, self-hosted platform for provisioning remote
development environments ("workspaces") defined as code with Terraform. It
ships as a single Go binary (`coder server`) that serves the control-plane
web UI/API and proxies WebSocket connections for browser IDEs and terminal
sessions to running workspaces. This module deploys the Coder **control
plane** on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation,
which provisions and manages the shared Google Cloud and Kubernetes
infrastructure. Provisioning actual workspaces additionally requires a
configured provisioner and a compute target (for example a Kubernetes
cluster or a cloud VM template) set up post-deploy — this module only stands
up the control plane.

This guide focuses on the cloud services Coder uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics that are common to every GKE application — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## What Coder costs on RAD, and how that compares

**Coder on RAD's GKE Autopilot module costs about US$136.37 a month in a Google Cloud project you own, plus a one-time 175-credit module fee (US$17.50).** Coder is the open-source control plane for provisioning remote, Terraform-defined development workspaces. For the lowest cost, the [Cloud Run guide](Coder_CloudRun.md) runs the same Coder for about US$167.44 a month; pick GKE here only if Coder must stay up continuously, scale across pods, or run beside other Kubernetes workloads.

If Coder is only needed occasionally — a demo, a trial, a seasonal or study workload — a RAD-managed project can be deleted and restored within 30 days for a handful of credits, so that US$136.37 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 175 credits (US$17.50 at the top-up price) | 157.5 credits (10% lower) |
| Build time | A few credits per build (roughly 3–6) | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$136.37 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **105 credits a day**, about 3150 a month (about US$315 at the top-up price) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, less on a plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| GKE Autopilot pod, 2x vCPU / 4 GiB | US$79.35 |
| Cloud SQL for PostgreSQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| GKE cluster management fee | shared across every GKE app in the project; $0 if this is your only cluster, else ~73 |
| **Total** | **about US$136.37** |

### How it compares

- Run it yourself and a VPS running the Coder control plane and PostgreSQL yourself costs less in cash: sized to roughly 2 vCPU/4 GiB, a comparable VPS (Hetzner or DigitalOcean) runs about $24–48 a month, or a GCP `e2-standard-2`-class VM about $49 — plus your own time for backups, security patches and upgrades, which RAD's managed Cloud SQL, Secret Manager and monitoring cover for you.
- RAD never claims to be cheaper than bare infrastructure in cash terms — it usually is not. The difference is what RAD manages for you: patching, backups, secrets and monitoring, plus the ability to pause Coder for free rather than paying for idle capacity (see below).
- Most of the running cost above is the managed PostgreSQL database (and, where used, the shared file server) — the part a bare VPS comparison has to run and back up by hand.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Coder runs in **a project RAD manages for you**, you have a second option that goes well beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to nothing.** This suits Coder that you only need occasionally far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google to delete the project. Google does not remove the project immediately: it keeps it, recoverable, for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike deleting one module, this does not tear down Cloud SQL or GKE Autopilot resources one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's owner can restore it. RAD asks Google to undelete the project and reattaches its billing account, then asks you to run **Update** on each deployment to confirm everything came back. Because nothing was individually destroyed, that Update finds the same resources already there — it is a check, not a rebuild, and an Update never charges the module fee again. That is a handful of credits (under US$1) in total for a typical Coder chain, against the 180 credits a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$136.37.** Deploy Coder, use it, delete the project. Restore it next time you want it, confirm with Update, and delete it again when you're done. You pay only for the module fee once, the builds, and whatever hours it was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages billing for), and you restore it yourself within the 30 days — after that, Google deletes it for good. Restoring is admitted like creating a new project: your purchased credit balance must still clear the tier's floor (100 credits for the sandbox tier most study and demo use fits). Google says most services are fully working again within 36 hours of a restore.
- **One real gap: the backup bucket does not survive.** Nightly backups are written to a bucket inside the project, and that bucket is **not** protected by Cloud Storage's soft-delete, so it is very likely gone as soon as you delete the project — even though the project itself is recoverable for 30 days. If you have customised Coder and want to keep that work, copy a backup out (to Google Drive, or a bucket outside the project) before you delete. For a default installation with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

GKE Autopilot keeps at least one pod running, so it never scales to zero on its own. The option above only applies to a RAD-managed project; **in your own project, or once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 180 credits (US$18) in your own project. Deleting saves money only once Coder would otherwise sit unused for about 4 days or more in your own project (US$4.55 a day), or about 2 days or more in a RAD-managed one (105 credits a day).
- **Most of the running cost is usually the database.** It stops only when nothing else in the project uses it, so deleting Coder while something else shares the project saves only this app's own compute part.
- **Keep your data first.** Nightly backups are written to a bucket inside the deployment and are deleted with it, so copy the latest backup out before deleting if you want to keep it.
- **Note your settings.** RAD does not recreate a deleted deployment for you; you enter the settings again when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant gets the app in their own Google Cloud project for 15 minutes to 24 hours, within an allowance the trainer sets. Either the trainer funds every place, or each participant pays for their own. Everything is deleted when the session ends and unused credits go back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low, billing pauses and the data is kept, so nobody receives an unexpected charge. At the end the partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; RAD's own fees and daily-credit estimates from [radmodules.dev/pricing](https://radmodules.dev/pricing); [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the 30-day recovery window and what it says about Cloud Storage objects without soft delete. Prices change; check each source before relying on a figure.

## 1. Overview

Coder's control plane is stateless — all state, including its self-generated
signing keys, lives in PostgreSQL — so the deployment wires together a small,
focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Go binary on port 3000, 2 vCPU / 4 GiB by default, one replica (`max_instance_count = 1`) |
| Database | Cloud SQL for PostgreSQL 15 | Required — MySQL is rejected at plan time |
| Object storage | Cloud Storage | A `storage` bucket provisioned automatically by `Coder_Common` |
| Secrets | Secret Manager | Only the Foundation-managed database password — Coder has no application secret of its own |
| Ingress | Cloud Load Balancing | Kubernetes Ingress with a reserved global static IP; optional custom domain |
| Container build | Cloud Build + Artifact Registry | Wraps the upstream `ghcr.io/coder/coder` image with a cloud entrypoint |

**Sensible defaults worth knowing up front:**

- **PostgreSQL 15 is required.** `database_type` defaults to `POSTGRES_15`; a
  plan-time validation in `validation.tf` rejects anything that isn't
  `POSTGRES_13`/`14`/`15`/`NONE` — MySQL is not supported.
- **`container_image_source = "custom"` is required, not optional.** The
  upstream `ghcr.io/coder/coder` image cannot parse the Foundation's DB
  wiring on its own; Cloud Build wraps it with a cloud entrypoint that
  assembles `CODER_PG_CONNECTION_URL` and `CODER_ACCESS_URL` at container
  start.
- **Cloud SQL is reached via the Auth Proxy sidecar on loopback.** GKE
  injects `DB_HOST = 127.0.0.1`; the entrypoint builds a `postgres://` DSN
  with `sslmode=disable` (the proxy already TLS-terminates the connection)
  and URL-encodes the password.
- **No NFS, no Redis, and no application secret.** All Coder state —
  workspaces, templates, users, sessions, build queue, and self-generated
  signing keys — lives in PostgreSQL. `enable_nfs` and `enable_redis` both
  default `false` and are not needed for normal operation.
- **No separate migration job.** Coder runs its own schema migrations on
  boot; the only initialization job is `db-init`, which creates the empty
  database and role.
- **One replica by default.** `min_instance_count = 1`,
  `max_instance_count = 1`. Coder's multi-replica mode is its high-availability
  feature, which requires a premium licence: without it, extra replicas serve the
  API and UI but never join Coder's relay mesh, so workspace terminal and SSH
  sessions would depend on which replica the load balancer picks.
- **`session_affinity = ClientIP`** keeps a browser's WebSocket-heavy
  terminal/IDE traffic pinned to the same pod across the session.
- **Ingress and a static IP are provisioned out of the box**
  (`enable_custom_domain = true`, `reserve_static_ip = true`).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and
other identifiers are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Coder control-plane workload

Coder pods run on Autopilot, billed for the CPU/memory the pods actually
request. Because the control plane is stateless, the workload runs as a
standard `Deployment` with a `RollingUpdate` strategy (no NFS-backed
`Recreate` constraint). Running more than one replica needs Coder's
licensed high-availability mode (see above).

- **Console:** Kubernetes Engine → Workloads → select the Coder workload for
  pods, revisions, and events. Kubernetes Engine → Services & Ingress shows
  the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl get hpa -n "$NAMESPACE"
  ```

See [App_GKE](App_GKE.md) for how Autopilot, HPA scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL 15

Coder stores everything — workspaces, templates, users, audit logs, sessions,
and its own signing keys — in a managed Cloud SQL for PostgreSQL 15 instance.
Pods reach it through the **Cloud SQL Auth Proxy** sidecar on
`127.0.0.1:5432`; no public IP is exposed. On first deploy the `db-init` job
creates the application database and role; Coder's own migration engine then
creates the schema on server boot.

- **Console:** SQL → select the instance for connections, backups, flags,
  metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

The instance name, database, user, and the Secret Manager secret holding the
password are all in the [Outputs](#5-outputs). See [App_GKE](App_GKE.md) for
the connection model, automated backups, and password rotation.

### C. Cloud Storage

A dedicated **Cloud Storage** bucket (suffix `storage`) is provisioned
automatically by `Coder_Common` and the workload service account is granted
access. It is not currently mounted into the Coder container by default —
Coder does not require a shared filesystem, since state lives in PostgreSQL.

- **Console:** Cloud Storage → Buckets.
- **CLI:**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  ```

See [App_GKE](App_GKE.md) for CMEK options and GCS Fuse mounts (`gcs_volumes`)
if you need to attach one for a custom workflow.

### D. Secret Manager

Coder is unusual among stateful applications in that it creates **no
application secret of its own** — it self-generates its signing keys and
persists them in the `coder` PostgreSQL database on first boot. The only
credential Secret Manager holds is the Foundation-managed database password.
On GKE, secrets are projected into pods via the Secret Store CSI driver.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~coder"
  gcloud secrets versions access latest --secret=<db-password-secret-name> --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### E. Networking & ingress

By default the workload is exposed through a Kubernetes Ingress backed by a
global static IP (`reserve_static_ip = true` so the address survives
redeploys). A custom domain with a Google-managed certificate can be enabled
via `application_domains`. Because Coder proxies long-lived WebSocket
connections for the web terminal and workspace app traffic, keep
`session_affinity = ClientIP` so a client's requests land on the same pod for
the life of a session.

- **Console:** Network services → Load balancing; VPC network → IP
  addresses.
- **CLI:**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### F. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to
Cloud Monitoring. Optional uptime checks and alert policies are available
(`uptime_check_config` is disabled by default).

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Coder Application Behaviour

- **First-deploy database setup, no separate migration job.** The `db-init`
  job runs `db-init.sh` using `postgres:15-alpine`. It waits for the Cloud
  SQL Auth Proxy sidecar, idempotently creates the `coder` role and
  database, grants privileges, and reassigns the `public` schema owner, then
  signals the proxy sidecar to shut down (`--quitquitquit`) so the Job pod
  completes. Coder then runs its own schema migrations on server boot — there
  is no dedicated migrate job, unlike apps with a separate `db-migrate` step.
- **No admin account is pre-provisioned.** The first user to reach the web
  UI after a successful boot completes Coder's interactive first-run setup
  (creating the initial admin account). There is no auto-generated admin
  password secret to retrieve.
- **DSN assembly at container start, not baked into the image.**
  `entrypoint.sh` (in `Coder_Common/scripts/`) builds
  `CODER_PG_CONNECTION_URL` from the Foundation-injected `DB_*` values,
  because Coder's Go driver expects a `postgres://` URL and cannot parse the
  libpq keyword form. On GKE, `DB_HOST=127.0.0.1` (the Auth Proxy sidecar)
  resolves to `sslmode=disable`; the password is RFC-3986 percent-encoded so
  special characters don't break the URL. `CODER_ACCESS_URL` defaults to the
  Foundation-injected `GKE_SERVICE_URL`.
- **WebSocket-heavy traffic needs sticky routing.** The web terminal,
  workspace app proxying, and the CLI's `coder ssh`/port-forward all ride
  long-lived WebSocket connections through the control plane. Keep
  `session_affinity = ClientIP` (the default) so a client's connection
  persists against one pod; `max_instance_count` stays at 1
  unless you hold a Coder licence with high availability.
- **Health probe paths.** Startup and liveness probes both target **HTTP
  `GET /health`** with a 60-second initial delay; the startup probe allows up
  to 30 failures at a 15-second period to absorb Coder's first-boot schema
  migration. The Common-supplied readiness probe (used by the Foundation's
  `additional_services`/readiness wiring) targets `GET /healthz` separately.
- **Telemetry is disabled by default** (`CODER_TELEMETRY_ENABLE = "false"`),
  and `CODER_VERBOSE = "false"`.
- **Control plane only — workspaces need a provisioner + target.** This
  module deploys `coder server`; running actual workspaces additionally
  requires configuring a provisioner and a compute target (for example
  another Kubernetes cluster/namespace, or cloud VM templates) through
  Coder's template system after first login.
- **Verify the deployment:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep CODER_
  curl -s https://<service-url>/healthz
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform.
Only settings specific to or notable for Coder are listed; every other input
is inherited from [App_GKE](App_GKE.md) with its standard behaviour and
defaults.

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `coder` | Base name for resources. Do not change after first deploy. |
| `application_version` | `latest` | Coder release tag; `latest` maps to a pinned tag (`v2.24.1`) via the app-specific `CODER_VERSION` build ARG so it never resolves against a non-existent `ghcr.io/coder/coder:latest`. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `container_image_source` | `custom` | Required — the upstream image cannot be deployed prebuilt; Cloud Build wraps it with the DSN-assembling entrypoint. |
| `container_port` | `3000` | Coder's `CODER_HTTP_ADDRESS` bind port. |
| `container_resources` | `cpu_limit=2000m`, `memory_limit=4Gi` | 2 vCPU / 4 GiB default for the control plane. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Replica bounds. More than one replica needs Coder's licensed high-availability mode. |
| `enable_cloudsql_volume` | `true` | Auth Proxy sidecar (loopback) — required on GKE; a plan-time guard rejects it when `database_type = "NONE"`. |
| `enable_image_mirroring` | `true` | Always on for Coder — the GHCR-sourced base image is mirrored into Artifact Registry. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | External IP for the Coder UI/API. |
| `workload_type` | `null` → `Deployment` | Deployment (stateless, standard `RollingUpdate`). |
| `session_affinity` | `ClientIP` | Sticky routing so a client's WebSocket session reaches the same pod. |

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `false` | Not required — all state is in PostgreSQL. If enabled, `nfs_mount_path` must be a real directory, never a subpath of `/opt/coder` (the `coder` binary, a file). |
| `nfs_mount_path` | `/home/coder/data` | Only used when `enable_nfs = true`. |

### Group 15 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not required — sessions and the build queue live in PostgreSQL, unlike apps that need an external cache/queue. |
| `redis_host` | `""` | Only relevant if `enable_redis = true`; a plan-time guard requires either `redis_host` or `enable_nfs = true`. |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Coder requires PostgreSQL 13+; MySQL is rejected at plan time (`validation.tf`). |
| `application_database_name` | `coder` | Database name. Immutable after first deploy — renaming recreates the DB and orphans all Coder state. |
| `application_database_user` | `coder` | Application database user; password auto-generated in Secret Manager. |

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | A Kubernetes Ingress is provisioned out of the box. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |
| `application_domains` | `[]` | Custom hostnames + managed certificate. |

All other inputs follow standard [App_GKE](App_GKE.md) behaviour. Note:
`elasticsearch_url`, `elasticsearch_username`, and
`elasticsearch_password_secret` are declared in `variables.tf` for catalogue
parity but are **not forwarded** to the Foundation call in `main.tf` — Coder
has no Elasticsearch integration in this module, so setting them has no
effect.

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest
way to locate and explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services. |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Coder. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint (127.0.0.1 via the Auth Proxy) / port. |
| `storage_buckets` | Created Cloud Storage buckets. |
| `network_name` / `network_exists` / `regions` | VPC network, presence, available regions. |
| `container_image` / `container_registry` | Deployed image and Artifact Registry repo. |
| `monitoring_enabled` / `monitoring_notification_channels` | Monitoring status and channels. |
| `initialization_jobs` / `db_import_job` | Names of the setup (`db-init`) and (optional) import jobs. |
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

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_GKE](App_GKE.md) foundation engine, which validates
> values *and combinations* at plan time — an out-of-range instance count,
> IAP enabled with no OAuth credentials, `quota_memory_*` given as bare
> integers. Coder_GKE additionally layers its own guards in `validation.tf`
> (PostgreSQL-only `database_type`, the Redis host/NFS precondition, the
> Cloud SQL volume vs `database_type = "NONE"` conflict). Invalid
> configuration fails the **plan** with a clear, named error before any
> resource is created, so most mistakes below are caught up front rather
> than at apply or runtime.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (or 13/14) | Critical | Any non-PostgreSQL engine is rejected at plan time; forcing one around the guard breaks every query Coder issues. |
| `application_database_name` / `application_database_user` | Set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all workspaces, templates, users, and self-generated signing keys. |
| `container_image_source` | `custom` | Critical | Switching to `prebuilt` points GKE at the raw `ghcr.io/coder/coder` image, which cannot assemble `CODER_PG_CONNECTION_URL` from the Foundation's DB vars and fails to boot. |
| `enable_cloudsql_volume` | `true` | Critical | Required for DB connectivity on GKE; a plan-time guard also blocks it when `database_type = "NONE"` to avoid a proxy sidecar with nothing to connect to. |
| `nfs_mount_path` (if `enable_nfs=true`) | A real directory, e.g. `/home/coder/data` | Critical | Mounting over `/opt/coder` — the `coder` binary itself — hides the executable and the container fails to start. |
| `session_affinity` | `ClientIP` | High | Without stickiness, an in-flight WebSocket terminal/IDE session can be routed to a different pod mid-session and drop. |
| `enable_redis` | `false` | Medium | Not needed — enabling it without `redis_host` set or `enable_nfs=true` fails plan-time validation; even correctly configured it adds an unused dependency since Coder keeps all state in PostgreSQL. |
| `max_instance_count` | `1` | High | Multi-replica Coder is high availability, a premium-licence feature; unlicensed extra replicas never join the relay mesh, so workspace connections break depending on which replica serves them. |
| `quota_memory_requests` / `_limits` | binary units (`4Gi`, `8192Mi`) | Critical | Bare integers are treated as bytes and block all pod scheduling in the namespace. |
| `reserve_static_ip` | `true` | Medium | Without it, the external IP can change across redeploys, breaking DNS, `CODER_ACCESS_URL`, and any registered OAuth/OIDC redirect. |
| `backup_retention_days` | `7` (raise for prod) | Medium | Too short for compliance retention of workspace/template history. |
| `elasticsearch_url` / `elasticsearch_username` / `elasticsearch_password_secret` | Leave unset | Low | Inert in this module (not forwarded to the Foundation call) — setting them has no effect and does not enable search integration. |

---

For the foundation behaviour referenced throughout — IAM and Workload
Identity, autoscaling, ingress and certificates, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, backups, and image mirroring — see
**[App_GKE](App_GKE.md)**. Coder-specific application configuration shared
with the Cloud Run variant is described in
**[Coder_Common](Coder_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Coder on GKE Autopilot](../labs/Coder_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Coder on Google Cloud Run](Coder_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Coder Common — Shared Application Configuration](Coder_Common.md) — the configuration shared by both deployment targets.
