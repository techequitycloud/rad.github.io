---
title: "Odoo on GKE Autopilot"
description: "Configuration reference for deploying Odoo on GKE Autopilot with the RAD module — variables, architecture, networking, and operations."
---

# Odoo on GKE Autopilot

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Odoo_GKE.png" alt="Odoo on GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Odoo is a comprehensive open-source ERP suite with 12M+ users and modules spanning CRM,
accounting, inventory, manufacturing, HR, and eCommerce. This module deploys Odoo Community
Edition on **GKE Autopilot** on top of the [App_GKE](App_GKE.md) foundation, which provisions
and manages the shared Google Cloud and Kubernetes infrastructure.

This guide focuses on the cloud services Odoo uses and how to explore and operate them from
the Google Cloud Console and the command line. For the mechanics that are common to every GKE
application — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle — refer to the
[App_GKE foundation guide](App_GKE.md) rather than repeating them here.

---

## What Odoo costs on RAD, and how that compares

**For a team of ten, Odoo on RAD's GKE Autopilot module costs about US$130–300 a month with
no per-user licence.** The same team pays about £220–410 a month on Odoo Online and about
£470 on Odoo.sh. GKE suits Odoo that must stay up, scale across pods or run beside other
Kubernetes workloads; for the lowest cost, the [Cloud Run module](Odoo_CloudRun.md) runs the
same Odoo for about US$84 a month. A self-managed server is cheaper in cash, but then you run
the database, backups, security patches and upgrades yourself. Figures are as at 8 October 2026; sources
are listed at the end of this section.

If you only need it occasionally — studying for a certification, a demo, a seasonal
business — a RAD-managed project can be deleted and restored within 30 days for a few
credits, so that US$130-150 becomes a few dollars a month instead. See **Pause it for
free**, below.

### What you pay on RAD

RAD deploys **Odoo Community Edition**, which is open source (LGPL), so there is no licence
fee per user. You pay for three things:

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 175 credits (US$17.50 at the top-up price) | 157.5 credits (10% lower) |
| Build time | About 3 credits per build (an Odoo build takes about 27 minutes) | The same |
| Google Cloud running cost | Billed by Google to your own billing account, about **US$150 a month** for the default configuration (table below) | Metered hourly in credits; RAD publishes **99 credits a day**, about 2,970 a month (about US$297 at the top-up price, US$238 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages,
the database, file server and network are shared by every application in the project, so a
second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud SQL for PostgreSQL 17, 1 vCPU, 3.75 GB, zonal, 10 GB SSD | US$51 |
| NFS file server: an e2-small VM with 20 GB of disk | US$14 |
| GKE Autopilot, one Odoo pod with 1 vCPU and 2 GiB, running all the time | US$40 |
| Load balancing: the Service's load balancer, plus the gateway for the custom domain that is on by default | US$18–37 |
| Cloud NAT gateway and IP address | US$5 |
| Cloud Storage for add-ons and daily backups | US$1 |
| GKE cluster management fee | US$0 under GKE's free tier, otherwise US$73 |
| **Total** | **about US$130–150**, or about US$220 without the free tier |

GKE's free tier covers the management fee of one Autopilot or zonal cluster per billing
account, so it applies only if this is your only such cluster. In africa-south1
(Johannesburg) Cloud SQL costs the same, and the pod and VM about 10% more. Two things shape
the figure:

- **GKE does not scale to zero.** At least one Odoo pod always runs, so scheduled actions
  (fetching mail, recurring invoices, reminders) keep working, and the cost is the same
  whether anyone uses Odoo or not. Extra pods, up to three by default, are added only under
  load.
- **Avoid Filestore for a small deployment.** The module uses a small NFS VM by default.
  Filestore's smallest instance is 1 TiB, which costs about US$164 a month on its own.

### How it compares, for ten internal users

| Option | Edition | Per month | Who runs it |
|---|---|---|---|
| Odoo Online, Standard plan | Enterprise | £220 (10 × £22, billed yearly; £180 in the first year) | Odoo. Custom modules are not allowed |
| Odoo Online, Custom plan | Enterprise | £410 (10 × £41, billed yearly) | Odoo. Adds Studio, the external API and multi-company |
| Odoo.sh, 1 worker, 20 GB, 1 staging branch | Enterprise | About £468 (£58 hosting + £410 Custom licence) | Odoo hosts; you manage your code |
| Enterprise on your own servers | Enterprise | £410 licence, plus the servers | You |
| Managed Community hosting (Cloudpepper Pro, medium server) | Community | €73 | The provider, on shared hosting |
| Your own server (Hetzner CPX22 or DigitalOcean 2 vCPU, 4 GB) | Community | €20, or US$24 plus US$7 for daily backups | You: operating system, PostgreSQL, backups, patches, upgrades |
| **RAD, GKE Autopilot, your own project** | Community | **About US$130–150**, plus US$17.50 once per deployment | RAD's automation, in your project |
| **RAD, GKE Autopilot, a RAD-managed project** | Community | **About 2,970 credits (US$238–297)** | RAD |
| RAD, Cloud Run | Community | About US$84, or 960 credits; see the [Cloud Run guide](Odoo_CloudRun.md) | RAD |

Odoo's prices were read from odoo.com from the United Kingdom. Odoo sets prices by country,
and its prices in many African countries are lower, so check odoo.com/pricing from your own
country. What the table shows:

- **Licences grow with every user; RAD's cost grows with load.** Odoo's plans charge for each
  user with back-office access. RAD's cost is the infrastructure, which a growing team
  reaches only when it needs more capacity. At ten users RAD on GKE costs between a quarter and a
  half of the Odoo Online Custom plan, and the gap widens as the team grows.
- **Community is not Enterprise.** Enterprise adds full accounting, Studio, the mobile apps,
  Helpdesk, Field Service, Planning and other apps (see Odoo's edition comparison). If you need
  those, compare against Odoo Online or Odoo.sh: RAD's module deploys Community.
- **A cheap server is cheap until something breaks.** On RAD the database is Cloud SQL, with
  daily backups and seven days of point-in-time recovery, plus a nightly export of the
  database and files. Passwords are kept in Secret Manager, and logs and monitoring come from
  Google Cloud. On your own server, each of those is a job someone has to do.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Odoo runs in **a project RAD manages for you**, you have a second option that goes well
beyond scaling to zero: **delete the whole project, and restore it within 30 days for close to
nothing.** This suits Odoo you only need occasionally — studying for a certification, a demo
environment, a seasonal business — far better than running it continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks Google
  to delete the project. Google does not remove the project immediately: it keeps it, recoverable,
  for 30 days. Because billing is already unlinked, nothing is charged while it waits. Unlike
  deleting one module, this does not tear down Cloud SQL, the VM or Cloud Run one by one — the
  whole project, and everything in it, simply stops.
- **Restoring costs a few credits, not a rebuild.** Within 30 days, the project's owner can
  restore it. RAD asks Google to undelete the project and reattaches its billing account, then
  asks you to run **Update** on each deployment to confirm everything came back. Because nothing
  was individually destroyed, that Update finds the same resources already there — it is a check,
  not a rebuild, and an Update never charges the module fee again. For Odoo on GKE behind a
  small Services_GCP and Project_GCP, that is about **7 credits in total (under US$1)**, against
  the 185 credits a full redeploy costs.
- **So a month of occasional use can cost a few dollars, not US$130-150.** Deploy Odoo, use it for an
  evening, delete the project. Restore it next time you want it, confirm with Update, and delete
  it again when you're done. You pay only for the module fee once, the builds, and whatever hours
  Odoo was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only manages
  billing for), and you restore it yourself within the 30 days — after that, Google deletes it
  for good. Restoring is admitted like creating a new project: your purchased credit balance must
  still clear the tier's floor (100 credits for the sandbox tier most study and demo use fits).
  Google says most services are fully working again within 36 hours of a restore.
- **One real gap: the backup bucket does not survive.** Odoo's nightly database and file backups
  are written to a bucket inside the project, and that bucket is **not** protected by Cloud
  Storage's soft-delete, so it is very likely gone as soon as you delete the project — even
  though the project itself is recoverable for 30 days. If you have made changes to Odoo you want
  to keep, copy a backup out (to Google Drive, or a bucket outside the project) before you delete,
  the same as the redeploy workflow below. For a default installation with nothing irreplaceable
  in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

GKE keeps at least one pod running, so it never scales to zero on its own. The option above
only applies to a RAD-managed project; **in your own project, or once the 30-day window has
passed, the way to stop paying is to delete the deployment and deploy it again when you need
it.**

- **What a redeploy costs.** The module fee again plus the builds: about 185 credits (US$18.50)
  and about an hour, because RAD recreates the project and shared services before Odoo.
  Deleting saves money if Odoo would otherwise sit unused for about four days or more in your
  own project (about US$5 a day), or about two days in a RAD-managed one (99 credits a day).
- **Delete everything Odoo uses.** Most of the running cost is the database and file server.
  They stop only when nothing else in the project uses them, so deleting Odoo while other
  applications share the project saves only the GKE part.
- **Keep your data first.** The nightly backups are written to a bucket inside the
  deployment, and that bucket is deleted with it. Before deleting, copy the latest backup to
  Google Drive, or to a bucket you keep.
- **Restore when you redeploy.** Deploy again with `enable_backup_import = true`,
  `backup_source = "gdrive"`, `backup_file` set to the Drive file ID and `backup_format` to
  `sql`, `tar` or `zip`. The import reads from Google Drive or from the new deployment's own
  backup bucket, so a copy kept elsewhere in Cloud Storage has to be uploaded there first.
  Check your attachments after the import.
- **Note your settings.** RAD does not recreate a deleted deployment for you; you enter the
  settings again when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs an Odoo session for a class. Each participant
  gets Odoo in their own Google Cloud project for 15 minutes to 24 hours, within an allowance
  the trainer sets. Either the trainer funds every place up front, or each participant pays for
  their own. Everything is deleted when the session ends, and unused credits go back to the
  trainer. A three-hour session costs roughly 20 credits (US$2) per participant in builds and
  running cost, plus the module fee unless fees are waived for the session.
- **Managed Environments, for consultancies.** A partner runs Odoo for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs low,
  billing pauses and the data is kept, so nobody receives an unexpected charge. At the end of
  the engagement the partner hands the project over, and the deployments become the client's
  own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and ZAR,
by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API;
[Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
for the 30-day recovery window and what it says about Cloud Storage objects without soft delete;
RAD fees and the 99-credit daily estimate from [radmodules.dev/pricing](https://radmodules.dev/pricing);
[Odoo pricing](https://www.odoo.com/pricing), [Odoo.sh pricing](https://www.odoo.sh/pricing)
and [Odoo editions](https://www.odoo.com/page/editions);
[Cloudpepper](https://cloudpepper.io/pricing), [Hetzner Cloud](https://www.hetzner.com/cloud)
and [DigitalOcean](https://www.digitalocean.com/pricing/droplets). Prices change; check each
source before relying on a figure.

---

## 1. Overview

Odoo runs as a Python/PostgreSQL ERP workload. The deployment wires together a focused set of
Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | GKE Autopilot | Python/Odoo pods, 1 vCPU / 2 GiB by default, horizontally autoscaled from one to three pods |
| Database | Cloud SQL for PostgreSQL | Required — Odoo does not support MySQL or SQL Server; PostgreSQL 17 by default, from the shared services |
| Shared files | NFS file server (Compute Engine VM) | Odoo's filestore, sessions, and extra-addons directories shared across all replicas; a small e2-small VM by default, with Filestore available as an option |
| Object storage | Cloud Storage | A dedicated addons bucket (`odoo-addons`) for custom and community addons |
| Cache & sessions | Redis (optional) | Disabled by default; required when `max_instance_count > 1` to share session state |
| Secrets | Secret Manager | Auto-generated master password (`ODOO_MASTER_PASS`) and database password |
| Ingress | Cloud Load Balancing | External LoadBalancer, optional custom domain + managed certificate |

**Sensible defaults worth knowing up front:**

- **PostgreSQL is mandatory.** The database engine is fixed; selecting MySQL or `NONE` breaks
  startup.
- **NFS is required.** Without the shared NFS volume, Odoo's filestore (attachments,
  binary fields, compiled assets) is isolated to each pod and lost on restart.
- **Session affinity is `ClientIP`.** Odoo stores sessions on NFS; pinning requests to the
  same pod avoids cross-pod session lookups.
- **Two init jobs run on every deploy.** `nfs-init` sets up NFS directory ownership and
  `db-init` creates the PostgreSQL database and user — both are idempotent.
- **The Odoo master password** is generated automatically and stored in Secret Manager; you
  never set it in plain text.
- **First boot is slow.** Odoo installs the base module and runs schema migrations on first
  start; the startup probe allows up to 9 minutes (180s delay + 3 × 120s period).

---

## 2. Google Cloud Services & How to Explore Them

All commands assume you have run
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
and that `PROJECT`, `REGION`, and `NAMESPACE` are set. The namespace and other identifiers
are reported in the deployment [Outputs](#5-outputs).

### A. GKE Autopilot — the Odoo workload

Odoo pods are scheduled on Autopilot, which bills for the CPU/memory the pods actually
request. Horizontal Pod Autoscaling sizes the deployment between the minimum and maximum
replica counts.

- **Console:** Kubernetes Engine → Workloads → select the Odoo workload to see pods,
  revisions, and events. Kubernetes Engine → Services & Ingress shows the external IP.
- **CLI:**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  # Check Odoo version running in the container:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- odoo --version
  ```

See [App_GKE](App_GKE.md) for how Autopilot, scaling, and the workload
type (Deployment vs StatefulSet) are managed.

### B. Cloud SQL for PostgreSQL

Odoo stores all ERP data (contacts, invoices, inventory, orders) in a managed Cloud SQL
for PostgreSQL instance. Pods reach it privately through the **Cloud SQL Auth Proxy**
sidecar over a Unix socket, so no public IP is exposed. On first deploy the `db-init` job
creates the application database and user.

- **Console:** SQL → select the instance for connections, backups, flags, and metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  # Confirm database and user were created:
  gcloud sql databases list --instance=<instance-name> --project "$PROJECT"
  gcloud sql users list --instance=<instance-name> --project "$PROJECT"
  ```

The instance name, database name, user, and the Secret Manager secret holding the
password are all surfaced in the [Outputs](#5-outputs). For the connection model,
automated backups, and password rotation, see [App_GKE](App_GKE.md).

### C. NFS file server and Cloud Storage

Odoo's filestore (binary attachments, images, compiled assets), session data, and
extra-addons directories are written to an **NFS share** served by a small Compute Engine VM
and mounted into every pod, so all replicas see the same files. Filestore can replace the VM,
but its smallest instance is 1 TiB. A dedicated **Cloud Storage** bucket
(`odoo-addons`) is also provisioned for custom and community addons.

- **Console:** Compute Engine → VM instances for the NFS server; Cloud Storage → Buckets for
  the addons bucket.
- **CLI:**
  ```bash
  gcloud compute instances list --project "$PROJECT"   # the NFS server VM
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<addons-bucket>/        # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  # List NFS directories:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /mnt/
  ```

See [App_GKE](App_GKE.md) for NFS provisioning, GCS Fuse, and CMEK options.

### D. Redis cache (optional)

Redis backs Odoo's session store when multiple replicas are running. Without Redis,
session affinity (`ClientIP`) is the only protection against session loss on pod restart.
Redis is disabled by default; set `enable_redis = true` and `redis_host` to enable it.

- **Console:** Memorystore → Redis (if using a managed instance).
- **CLI:**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm Redis env vars are injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E "^REDIS_"
  ```

### E. Secret Manager

The Odoo master password (`ODOO_MASTER_PASS`) and the database password are stored as
Secret Manager secrets and injected into pods at runtime; plaintext never appears in
configuration.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the master password:
  gcloud secrets list --project "$PROJECT" --filter="name~master-password"
  gcloud secrets versions access latest --secret=<master-password-secret> --project "$PROJECT"
  ```

The database password secret name is in the [Outputs](#5-outputs). See
[App_GKE](App_GKE.md) for the Secret Store CSI integration and rotation.

### F. Networking & ingress

By default the workload is exposed through an external Cloud Load Balancing IP. A custom
domain with a Google-managed certificate can be enabled, and a static IP can be reserved so
the address survives redeploys.

- **Console:** Network services → Load balancing; VPC network → IP addresses.
- **CLI:**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

See [App_GKE](App_GKE.md) for custom domains, Cloud CDN, and static IP
details.

### G. Cloud Logging & Monitoring

Pod stdout/stderr flow to Cloud Logging; GKE and Cloud SQL metrics flow to Cloud Monitoring.
Optional uptime checks and alert policies are available.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  # Monitor startup progress:
  kubectl logs -n "$NAMESPACE" -l app=odoo --follow | grep -E "odoo.modules|http.server"
  ```

---

## 3. Odoo Application Behaviour

- **Two init jobs on every deploy.**
  - `nfs-init` — mounts the NFS share and creates `/mnt/filestore`, `/mnt/sessions`, and
    `/mnt/extra-addons` with ownership `101:101` (the Odoo process user). Must succeed
    before Odoo starts.
  - `db-init` — runs after `nfs-init` and idempotently creates the PostgreSQL database and
    application user. Both jobs are safe to re-run.
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" -l job-name=nfs-init
  kubectl logs -n "$NAMESPACE" -l job-name=db-init
  ```
- **Schema migration on start.** The container starts Odoo with `-i base`, which applies any
  pending schema migrations automatically. Version upgrades are applied on next pod start.
- **Odoo master password.** An auto-generated 16-character alphanumeric password is stored in
  Secret Manager and injected as `ODOO_MASTER_PASS`. It protects the database management
  interface at `/web/database/manager`. Override it using `explicit_secret_values`:
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~master-password"
  gcloud secrets versions access latest --secret=<master-password-secret> --project "$PROJECT"
  ```
- **SMTP for outbound email.** Odoo uses environment variables for its outbound mail
  transport (order confirmations, password resets, CRM notifications). Configure `SMTP_HOST`,
  `SMTP_PORT`, `SMTP_USER`, `SMTP_SSL`, and `EMAIL_FROM` in `environment_variables` before
  going live; move `SMTP_PASSWORD` to `secret_environment_variables`.
- **Health path.** The startup probe allows 180 seconds of initial delay then checks `GET
  /web/health` (HTTP 200 only when Odoo has a live database connection). The liveness probe
  continues checking `/web/health` every 30 seconds. On first boot (schema creation from
  scratch), the startup can take 2–10 minutes depending on available CPU.
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    curl -s -o /dev/null -w "%{http_code}" http://localhost:8069/web/health
  # Expect: 200
  ```
- **Odoo background scheduler (cron).** Odoo's built-in scheduler requires at least one
  running pod. Keep `min_instance_count = 1` in production to prevent cron disruption.

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only settings
specific to or notable for Odoo are listed; every other input is inherited from
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
| `application_name` | `odoo` | Base name for resources. Do not change after first deploy. |
| `application_display_name` | `Odoo ERP` | Friendly name shown in the Console. |
| `application_description` | `Odoo ERP on GKE Autopilot` | Workload description annotation. |
| `application_version` | `18.0` | Odoo nightly channel to install (`"18.0"`, `"17.0"`, `"16.0"`). Increment to upgrade. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `custom` | `"custom"` builds from the Odoo nightly Dockerfile; `"prebuilt"` deploys an existing image. |
| `container_image` | `""` | Override image URI (used with `"prebuilt"`). |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Resource limits per pod. **Raise to ≥ 2 vCPU / 4 GiB for production.** |
| `min_instance_count` | `1` | Minimum replicas. Keep ≥ 1 to preserve the Odoo cron scheduler. |
| `max_instance_count` | `3` | Maximum replicas (autoscaler ceiling). |
| `container_port` | `8069` | Port Odoo listens on. Do not change unless the Odoo server is reconfigured. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy sidecar for socket connections. |
| `enable_vertical_pod_autoscaling` | `false` | Let Autopilot tune resource requests automatically. |
| `enable_image_mirroring` | `true` | Mirror the container image into Artifact Registry. |

### Group 5 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Plain-text settings. Empty by default — set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_SSL`, and `EMAIL_FROM` here for outbound email. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name (e.g. `SMTP_PASSWORD`). |
| `explicit_secret_values` | `{}` | Sensitive values written to Secret Manager during deploy. Use to set a custom `ODOO_MASTER_PASS`. |

### Group 6 — GKE Backend & Cluster

| Variable | Default | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | How the Service is exposed. |
| `session_affinity` | `ClientIP` | Sticky routing; required when Redis is not enabled for session sharing. |
| `workload_type` | `null` | Auto-resolves to StatefulSet when `stateful_pvc_enabled = true`. |
| `network_tags` | `['nfsserver']` | Pod tags; `nfsserver` is required for NFS firewall connectivity. |
| `gke_cluster_name` | `""` | Target cluster name; leave empty for auto-discovery. |
| `namespace_name` | `""` | Kubernetes namespace; leave empty to auto-generate. |

### Group 7 — StatefulSet

| Variable | Default | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Enable per-pod PVCs in the StatefulSet. |
| `stateful_pvc_size` | `10Gi` | PVC size per pod. Plan for 100 GiB+ in active ERP deployments. |
| `stateful_pvc_mount_path` | `/data` | Mount path inside the pod for the PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass for PVCs. |

### Group 8 — Resource Quota

| Variable | Default | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Cap namespace CPU/memory/object counts. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Must use binary units (`4Gi`, `8192Mi`)** — bare integers are treated as bytes by Kubernetes and block scheduling. |

### Group 9 — Reliability Policies

| Variable | Default | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protect availability during node upgrades. |
| `pdb_min_available` | `1` | Raise `min_instance_count` above 1 if you need eviction headroom. |
| `enable_topology_spread` | `false` | Spread pods across zones. |

### Group 10 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe_config` | `{ path = "/web/health", initial_delay_seconds = 180, timeout_seconds = 60, period_seconds = 120, failure_threshold = 3 }` | Generous delay for first-boot schema creation. Increase `failure_threshold` to `5` on very first deploys. |
| `health_check_config` | `{ path = "/web/health", initial_delay_seconds = 30, timeout_seconds = 5, period_seconds = 30, failure_threshold = 3 }` | Liveness check. `/web/health` returns 200 only when Odoo has a live database connection. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Optional Cloud Monitoring uptime check; disabled by default. |
| `alert_policies` | `[]` | Optional metric alert policies. |

### Group 11 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty to use the built-in `nfs-init` + `db-init` jobs. |
| `cron_jobs` | `[]` | User-defined scheduled tasks (Kubernetes CronJobs). |

### Group 12 — CI/CD & GitHub Integration

Standard App_GKE Cloud Build / Cloud Deploy integration — see
[App_GKE](App_GKE.md). Key inputs: `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Group 13 — Filesystem (NFS)

| Variable | Default | Description |
|---|---|---|
| `enable_nfs` | `true` | Required — Odoo's filestore, sessions, and addons directories must reside on shared storage. |
| `nfs_mount_path` | `/mnt` | NFS mount path inside the container as seen by App_GKE. |

### Group 14 — Cloud Storage & Artifact Registry

| Variable | Default | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provision the addons bucket. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Additional buckets beyond the Odoo-managed `odoo-addons` bucket. |
| `gcs_volumes` | `[]` | Additional GCS Fuse mounts. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | CMEK options. |
| `max_images_to_retain` | `7` | Maximum recent Artifact Registry images to keep. |

### Group 15 — Redis Cache

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Enable Redis for session storage. Required when `max_instance_count > 1`. |
| `redis_host` | `""` | Redis endpoint. Required when `enable_redis = true`. |
| `redis_port` | `6379` | Redis port. |
| `redis_auth` | `""` | Optional Redis auth password (sensitive). |

### Group 16 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Fixed — do not change to MySQL or `NONE`. |
| `application_database_name` | `gkeappdb` | Database name. Immutable after first deploy. |
| `application_database_user` | `gkeappuser` | Application user. Immutable after first deploy. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Install PostgreSQL extensions (e.g. `postgis`, `unaccent`) after provisioning. |
| `enable_auto_password_rotation` | `false` | Zero-downtime DB password rotation. |

### Group 17 — Backup & Maintenance

| Variable | Default | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Automated backup cron (UTC). |
| `backup_retention_days` | `7` | Retention; raise to 90+ for financial/compliance data. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | restore options | Restore a PostgreSQL dump on deploy. |

### Group 18 — Custom SQL Scripts

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — run SQL from a GCS bucket after provisioning. See
[App_GKE](App_GKE.md).

### Group 19 — Custom Domain, Static IP & Networking

| Variable | Default | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provision Ingress for custom hostnames + managed certificate. |
| `application_domains` | `[]` | Hostnames to serve. |
| `reserve_static_ip` | `true` | Stable external IP across redeploys. |

### Group 20 — Identity-Aware Proxy (IAP)

| Variable | Default | Description |
|---|---|---|
| `enable_iap` | `false` | Require Google sign-in in front of Odoo. Recommended for admin-only ERP deployments. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Who may access. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Required when IAP is enabled (sensitive). |
| `iap_support_email` | `""` | Shown on the OAuth consent screen. |

### Group 21 — Cloud Armor

| Variable | Default | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attach a Cloud Armor (WAF) policy to the Ingress backend. Strongly recommended for any internet-facing Odoo deployment. |
| `admin_ip_ranges` | `[]` | CIDRs allowed privileged access. |
| `cloud_armor_policy_name` | `default-waf-policy` | Policy name. |

### Group 22 — VPC Service Controls & Audit Logging

| Variable | Default | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Enforce a VPC-SC perimeter (requires `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | Access level CIDRs / dry-run mode. |
| `enable_audit_logging` | `false` | Detailed Cloud Audit Logs. |

---

## 5. Outputs

These values are returned on a successful deployment and are the quickest way to locate and
explore the running resources.

| Output | Description |
|---|---|
| `service_name` | Kubernetes Service name. |
| `namespace` | Namespace the workload runs in. |
| `service_cluster_ip` | In-cluster ClusterIP. |
| `stage_service_cluster_ips` | Map of ClusterIPs for stage-specific services (Cloud Deploy). |
| `service_external_ip` | External LoadBalancer IP (when a static IP is reserved). |
| `service_url` | URL to reach Odoo. |
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
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | CI/CD status and details. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registry and build trigger. |
| `kubernetes_ready` | Whether the cluster/workload is ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging and CMEK status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service degraded) —
> **Medium** (cost or partial degradation) — **Low** (minor).

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `POSTGRES` | Critical | Odoo requires PostgreSQL exclusively; MySQL or `NONE` breaks startup. |
| `enable_nfs` | `true` | Critical | Without NFS, attachments and session data are isolated to each pod and lost on restart. |
| `application_database_name` / `_user` | set once | Critical | Immutable after first deploy; renaming recreates the DB/user and destroys all ERP data. |
| `container_resources.memory_limit` | `≥ 4Gi` for production | Critical | Default `512Mi` causes immediate Python OOM during module loading. Always raise to at least `2Gi`. |
| `enable_backup_import` | `false` unless restoring | Critical | Enabling without a valid `backup_file` fails the import job. |
| `quota_memory_requests` / `_limits` | binary units | Critical | Bare integers are treated as bytes by Kubernetes and block all scheduling. |
| `explicit_secret_values` (ODOO_MASTER_PASS) | strong, unique | Critical | The database manager at `/web/database/manager` is protected only by this password; a weak value exposes drop-database to anyone who can reach the URL. |
| `enable_redis` | `true` when `max_instance_count > 1` | High | Without Redis and `session_affinity = ClientIP`, users are logged out when routed to a different pod. |
| `redis_host` | explicit endpoint | High | Required when `enable_redis = true`; empty causes session backend failures at startup. |
| `application_version` | valid LTS (`18.0`, `17.0`) | High | Invalid version tag fails the Cloud Build step during image build. |
| `container_image_source` | `custom` | High | Odoo requires a custom image to wire the PostgreSQL socket and filestore paths; an upstream image not configured for Cloud SQL Unix sockets will fail to connect. |
| `min_instance_count` | `1` | High | `0` stops the Odoo background scheduler (cron) and adds 30–60 second cold starts. |
| `session_affinity` | `ClientIP` | High | Without stickiness and without Redis, multi-replica deployments continuously lose session state. |
| `backup_retention_days` | `90` for production | High | Odoo contains financial records; 7 days is insufficient for most compliance requirements. |
| `enable_iap` / `enable_cloud_armor` | enable for production | High | The Odoo database manager and admin portal should not be publicly reachable without authentication. |
| `pdb_min_available` vs `min_instance_count` | leave headroom | Medium | `1`/`1` can stall node upgrades when the single pod cannot be evicted. |
| `stateful_pvc_size` | `100Gi`+ for production | Medium | ERP attachments (invoices, contracts, product images) accumulate quickly. |

---

For the foundation behaviour referenced throughout — IAM and Workload Identity, autoscaling,
ingress and certificates, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, backups, and
image mirroring — see **[App_GKE](App_GKE.md)**. Odoo-specific application configuration
shared with the Cloud Run variant is described in **[Odoo_Common](Odoo_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Odoo on GKE Autopilot](../labs/Odoo_GKE.md) — deploy it step by step, with the console screens and commands at each stage.
- [Odoo on Cloud Run](Odoo_CloudRun.md) — the same application on Cloud Run, for when you need the other deployment target.
- [Odoo Shared Application Configuration](Odoo_Common.md) — the configuration shared by both deployment targets.
