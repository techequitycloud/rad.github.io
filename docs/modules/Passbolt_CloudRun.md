---
title: "Passbolt on Google Cloud Run"
description: "Configuration reference for deploying Passbolt on Google Cloud Run with the RAD module — variables, architecture, networking, and operations."
---

# Passbolt on Google Cloud Run

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Passbolt_CloudRun.png" alt="Passbolt on Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Passbolt (Community Edition) is a free, open-source, team-oriented password
manager with GPG-based encryption and per-user/group credential sharing —
AGPL-3.0 licensed, ~6k GitHub stars. It occupies a different niche from this
catalog's `Vaultwarden` module: Vaultwarden is a personal/Bitwarden-compatible
vault, while Passbolt is built around organization-wide GPG-encrypted credential
sharing between users and groups. This module deploys the official
`passbolt/passbolt` image on **Cloud Run v2** on top of the
[App_CloudRun](App_CloudRun.md) foundation, which provisions and manages the
shared Google Cloud infrastructure.

This guide focuses on the cloud services Passbolt uses and how to explore and
operate them from the Google Cloud Console and the command line. For the
mechanics common to every Cloud Run application — service identity, ingress and
load balancing, scaling and concurrency, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, backups, and the deployment lifecycle —
refer to the [App_CloudRun foundation guide](App_CloudRun.md) rather than
repeating them here.

---

## What Passbolt costs on RAD, and how that compares

**For a team of ten, Passbolt on RAD's Cloud Run module costs about US$84 a month with no per-user licence.** Passbolt's own Pro edition is a self-hosted licence from US$4.90/user/month (10-user minimum) on top of your own hosting; RAD deploys the free Community Edition, so the licence fee below is for extra features, not a hosted alternative. Figures are as at 8 October 2026; sources are listed at the end of this section.

If you only need it occasionally — studying for a certification, a demo, a seasonal business — a RAD-managed project can be deleted and restored within 30 days for a few credits, so that US$84 becomes a few dollars a month instead. See **Pause it for free**, below.

### What you pay on RAD

| | In a Google Cloud project you own | In a project RAD manages for you |
|---|---|---|
| Module fee, once per deployment | 75 credits (US$7.50 at the top-up price) | 67.5 credits (10% lower) |
| Build time | About 19 credits per build (RAD's average build takes about 19 minutes) | The same |
| Google Cloud running cost | Billed by Google to your own billing account (table below) | Metered hourly in credits; RAD publishes **32 credits a day**, about 960 credits a month (about US$96 at the top-up price, US$77 at the Scale plan's rate) |
| Who owns what | You own the project and its billing; RAD deploys and updates it | RAD owns the project, with guardrails, quotas and budget alerts; you get console access, and a minimum purchased balance is held in reserve |

10 credits cost US$1 on a one-off top-up, and less on a monthly plan. In a project RAD manages, the database, file server and network are shared by every application in the project, so a second application does not add a second database.

**Default running cost in your own project** (us-central1, Google list prices):

| Resource (module default) | Per month |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | US$13.16 |
| Cloud SQL for MySQL, 1 vCPU / 3.75 GB, zonal, 10 GB SSD | US$51.02 |
| NFS/cache file server (small VM) | US$13.43 |
| Cloud NAT and networking | US$5 |
| Cloud Storage (add-ons, backups) | US$1 |
| **Total** | **about US$84** |

- Cloud SQL and Cloud Run cost the same in africa-south1 (Johannesburg); the VM costs about 10% more.
- **Scale-to-zero is the default.** The Cloud Run line above already reflects that cost; setting `min_instance_count = 1` keeps an instance warm and raises this line, in exchange for no cold starts.
- **Avoid Filestore for a small deployment.** The module uses a small NFS/cache VM by default. Filestore's smallest instance is 1 TiB, which costs about US$164 a month on its own.

### How it compares

- **Passbolt sells its own Pro edition** as a self-hosted licence: **US$4.90 per user per month, billed annually, with a 10-user minimum** (passbolt.com/pricing, 8 October 2026) — about US$49/month for a 10-person team. That is a licence fee on top of hosting, adding SSO, LDAP provisioning and tag management to the free Community Edition RAD deploys — it is not a hosted alternative to either RAD figure above.
- A bare VPS running the free Community Edition — Hetzner CPX22 or a DigitalOcean 2 vCPU/4 GB Droplet, both about US$24/month — undercuts RAD's own-project figure above, at the cost of running MySQL, backups and GPG key handling yourself. Passbolt only needs 1 vCPU / 2 GiB, so a smaller/cheaper VPS tier would likely do.
- For a password manager specifically, who can read the backups matters as much as the price: RAD keeps the database and secrets in Cloud SQL and Secret Manager rather than on a server you administer by hand.
- If Passbolt needs to stay up without scaling to zero, or run beside other Kubernetes workloads, see the [GKE guide](Passbolt_GKE.md) instead — about US$110 a month in your own project, or 2,970 credits (about US$238–297) a month in one RAD manages.

### Pause it for free: delete a RAD-managed project, restore it when you need it

If Passbolt runs in **a project RAD manages for you**, you have a second option that
goes well beyond scaling to zero: **delete the whole project, and restore it within 30
days for close to nothing.** This suits occasional use — studying for a certification,
a demo environment, a seasonal business — far better than running Passbolt
continuously.

- **How it works.** Deleting a RAD-managed project unlinks its billing first, then asks
  Google to delete the project. Google does not remove the project immediately: it keeps
  it, recoverable, for 30 days. Because billing is already unlinked, nothing is charged
  while it waits. Unlike deleting one module, this does not tear down Cloud SQL, any VM or Cloud Run
  one by one — the whole project, and everything in it, simply stops.
- **Restoring costs a handful of credits, not a rebuild.** Within 30 days, the project's
  owner can restore it. RAD asks Google to undelete the project and reattaches its
  billing account, then asks you to run **Update** on each deployment to confirm
  everything came back. Because nothing was individually destroyed, that Update finds
  the same resources already there — it is a check, not a rebuild, and an Update never
  charges the module fee again. That costs a handful of credits (under US$1) for a
  typical 2–3-deployment chain, against the 80 credits
  (US$8) a full redeploy costs below.
- **So a month of occasional use can cost a few dollars, not US$84.**
  Deploy Passbolt, use it for a while, delete the project. Restore it next time you
  want it, confirm with Update, and delete it again when you're done. You pay only for
  the module fee once, the builds, and whatever time Passbolt was actually live.
- **What this needs.** You must own the project (not a bring-your-own one RAD only
  manages billing for), and you restore it yourself within the 30 days — after that,
  Google deletes it for good. Restoring is admitted like creating a new project: your
  purchased credit balance must still clear the tier's floor (100 credits for the
  sandbox tier most study and demo use fits). Google says most services are fully
  working again within 36 hours of a restore.
- **One real gap: the backup bucket does not survive.** Passbolt's backups are written
  to a bucket inside the project, and that bucket is **not** protected by Cloud Storage's
  soft-delete, so it is very likely gone as soon as you delete the project — even though
  the project itself is recoverable for 30 days. If you have made changes to Passbolt
  you want to keep, copy a backup out (to Google Drive, or a bucket outside the project)
  before you delete, the same as the redeploy workflow below. For a default installation
  with nothing irreplaceable in it, this does not matter.

### Pay only while you use it, the other way: delete and redeploy

Cloud Run already scales to zero between requests. The option above only applies to a RAD-managed project; **in your own project, or once the 30-day window has passed, the way to stop paying is to delete the deployment and deploy it again when you need it.**

- **What a redeploy costs.** The module fee again plus the builds: about 80
  credits (US$8), because RAD recreates the project and shared
  services before Passbolt. Deleting saves money only once Passbolt would otherwise
  sit unused for about 3 days or more, both in your own project (about
  US$2.79 a day) and in a RAD-managed one (32 credits a day).
- **Most of the running cost is usually the database and the shared file/cache VM.**
  They stop only when nothing else in the project uses
  them, so deleting Passbolt while something else shares the
  project saves only Passbolt's own compute part.
- **Keep data first.** Backups are written to a bucket inside the deployment and are
  deleted with it, so copy the latest backup out before deleting if you want to keep it.
- **RAD does not recreate a deleted deployment for you**; you enter the settings again
  when you deploy.

### Lab sessions and Managed Environments

- **Lab sessions, for training.** A trainer runs a session for a class. Each participant
  gets the app in their own Google Cloud project for 15 minutes to 24 hours, within an
  allowance the trainer sets. Either the trainer funds every place, or each participant
  pays for their own. Everything is deleted when the session ends and unused credits go
  back to the trainer.
- **Managed Environments, for consultancies.** A partner runs the app for a client from a
  ring-fenced wallet it funds, and settles with the client directly. If the wallet runs
  low, billing pauses and the data is kept, so nobody receives an unexpected charge. At
  the end the partner hands the project over and the deployments become the client's own.

Credits can be bought in more than 20 currencies, including XAF, XOF, NGN, GHS, KES and
ZAR, by card, bank transfer or mobile money.

**Sources (8 October 2026):** Google Cloud list prices from the Cloud Billing Catalog API; [radmodules.dev/pricing](https://radmodules.dev/pricing) for RAD's own fees and daily-credit estimates; [Delete and restore projects](https://cloud.google.com/resource-manager/docs/delete-restore-projects) for the pause/restore window and what it says about Cloud Storage objects without soft delete; [Passbolt pricing](https://www.passbolt.com/pricing).

---

## 1. Overview

Passbolt runs as a single Apache/PHP container on Cloud Run v2. The deployment
wires together a focused set of Google Cloud services:

| Capability | Google Cloud service | Notes |
|---|---|---|
| Compute | Cloud Run v2 | Apache/PHP container, port `80`, 1 vCPU / 2Gi by default, `min_instance_count = 0` (scale-to-zero) |
| Database | Cloud SQL for MySQL (`MYSQL_8_0`) | Required — Passbolt is a MySQL-only CakePHP application; discrete `DATASOURCES_DEFAULT_*` env vars, not a single DSN |
| Cryptographic state | Two dedicated GCS buckets (`storage`, `jwt`) | Hold the vendor-self-generated GPG server keypair and JWT keypair — **not** Terraform-generated secrets |
| Secrets | Secret Manager | Only the database password is generated by the foundation — Passbolt itself contributes no secret at all (`Passbolt_Common`'s `secret_ids` output is always empty) |
| Ingress | Cloud Run URL / Cloud Load Balancing | Default `run.app` URL; optional external HTTPS load balancer + custom domain |

**Sensible defaults worth knowing up front:**

- **MySQL is mandatory.** `database_type = "MYSQL_8_0"` is fixed by
  `Passbolt_Common`; Passbolt is built on CakePHP with a MySQL-only schema.
- **No server-side application secret.** Unlike WordPress (multiple salts) or
  Laravel-family apps (`APP_KEY`), Passbolt has no Terraform-generated
  encryption key at all. Its security model is entirely client-side: the
  browser extension generates a GPG keypair and master password locally during
  setup. The server's own GPG keypair (for encrypting data *to* Passbolt) and
  its JWT keypair (API auth tokens) are both self-generated by the vendor's own
  entrypoint on first boot and persisted on dedicated GCS volumes — not created
  or rotated by Terraform.
- **Two purpose-built GCS volumes, not one, and not the whole `/etc/passbolt`
  directory.** `storage` mounts narrowly at `/etc/passbolt/gpg`; `jwt` mounts
  narrowly at `/etc/passbolt/jwt`. Mounting a single volume over all of
  `/etc/passbolt` would shadow baked-in config/PHP files (`app.php`,
  `bootstrap.php`, `routes.php`) that live directly in that directory in the
  image — the same class of bug this catalog previously hit with Cloudreve.
- **`HTTPS = "on"` is always injected.** Passbolt's `bootstrap.php` has
  `$trustProxy = false` hardcoded, so it does not honor `X-Forwarded-Proto` by
  default — but it does check the literal `env('HTTPS')` value directly. Since
  Cloud Run terminates TLS at the edge and forwards plain HTTP to the
  container, this static override makes Passbolt generate `https://` URLs
  correctly in emails and absolute links.
- **`enable_cloudsql_volume` defaults to `false` at this module's variable
  level** — asymmetric with `Passbolt_GKE`, where it defaults `true` (both
  match `Passbolt_Common`'s own default of `true`). Set it explicitly to
  `true` for socket-based MySQL connections on Cloud Run.
- **No first-visit web setup wizard.** The only way an admin account exists is
  via the `admin-bootstrap` init job, which prints a one-time setup URL to
  Cloud Logging for the operator to open in a Passbolt-compatible browser
  extension.
- **No Redis.** `enable_redis = false` by default — Passbolt has no Redis
  integration used by this module.

---

## 2. Google Cloud Services & How to Explore Them

All commands assume `PROJECT` and `REGION` are set. Service and resource names
are reported in the deployment [Outputs](#5-outputs).

### A. Cloud Run — the Passbolt service

- **Console:** Cloud Run → select the service for revisions, traffic, logs, and
  metrics.
- **CLI:**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

See [App_CloudRun](App_CloudRun.md) for scaling, concurrency, execution
environment, and traffic splitting.

### B. Cloud SQL for MySQL

Passbolt stores all application data — users, groups, folders, encrypted
password resources, sharing permissions — in a managed Cloud SQL MySQL 8.0
instance. The database connection uses Passbolt's own discrete env var names
(`DATASOURCES_DEFAULT_HOST`/`_USERNAME`/`_PASSWORD`/`_DATABASE`, confirmed
against the vendor's own `/passbolt/env.sh`), aliased from the Foundation's
standard `DB_*` values by the Application Module.

- **Console:** SQL → select the instance for connections, backups, flags, metrics.
- **CLI:**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

See [App_CloudRun](App_CloudRun.md) for the connection model, backups, and
password rotation.

### C. Cloud Storage — the GPG and JWT keypair volumes

Two GCS buckets are provisioned by `Passbolt_Common` and mounted via GCS Fuse:
`storage` at `/etc/passbolt/gpg`, `jwt` at `/etc/passbolt/jwt`. These are not
generic upload/media buckets — they hold the vendor-self-generated server GPG
keypair and JWT keypair, both generated once on first boot and reused on every
subsequent boot. Losing either bucket invalidates every credential Passbolt has
encrypted server-side and every issued JWT session.

- **Console:** Cloud Storage → find the two buckets (names include `storage`
  and `jwt` suffixes).
- **CLI:**
  ```bash
  gsutil ls -p "$PROJECT" | grep passbolt
  gsutil ls gs://<storage-bucket-name>/    # expect serverkey.asc, serverkey_private.asc
  ```

### D. Secret Manager

Passbolt itself contributes no secret — the only Secret Manager entry related
to this deployment is the database password, managed by the Foundation.

- **Console:** Security → Secret Manager.
- **CLI:**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~passbolt"
  ```

### E. Networking & ingress

The service is reachable at its `run.app` URL by default. An external HTTPS
load balancer with a custom domain, Cloud CDN, and Cloud Armor can be layered
on; ingress settings and VPC egress control connectivity.

- **Console:** Cloud Run (service URL); Network services → Load balancing.
- **CLI:**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

See [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging & Monitoring

Container logs flow to Cloud Logging — including the `admin-bootstrap` init
job's one-time setup URL output. Cloud Run and Cloud SQL metrics flow to Cloud
Monitoring, with optional uptime checks and alert policies.

- **Console:** Logging → Logs Explorer; Monitoring → Dashboards / Alerting.
- **CLI:**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Passbolt Application Behaviour

- **The 2-stage initialization job chain, and why the second job is genuinely
  non-trivial.** `Passbolt_Common` defines two ordered Cloud Run Jobs, both
  with `execute_on_apply = true`:
  1. **`db-init`** (`mysql:8.0-debian`) — creates the MySQL role and database
     (the shared catalog-wide `db-init.sh`, `caching_sha2_password`-safe).
  2. **`admin-bootstrap`** (`passbolt/passbolt:<version>`,
     `depends_on_jobs = ["db-init"]`) — registers the initial admin account.

     Cloud Run Jobs invoke a container's `command`/`args` **directly**,
     bypassing the vendor's own `/docker-entrypoint.sh` chain entirely — so a
     bare `cake passbolt register_user` on a freshly-provisioned container
     fails with an Internal Error 500, because the GPG server keypair
     (normally generated during the vendor entrypoint's own boot sequence)
     doesn't exist yet, and the schema hasn't been installed either. The job
     instead sources the vendor's own entrypoint functions
     (`/passbolt/entrypoint.sh`, `/passbolt/env.sh`,
     `/passbolt/deprecated_paths.sh`), generates/imports the GPG server
     keypair if missing, generates a self-signed SSL cert if missing, runs the
     vendor's own `install()` function (which also handles JWT keypair
     generation and the database schema install/migrate), and only then runs
     `cake passbolt register_user -u <admin_email> -f <admin_first_name>
     -l <admin_last_name> -r admin` — **without** the `-q`/quiet flag, so the
     one-time setup URL is printed and lands in Cloud Logging. Confirmed
     against the real vendor `/passbolt/entrypoint.sh` source. Idempotent:
     `gpg_gen_key`/`install()` no-op once the keys and schema already exist
     from a prior run.

- **No first-visit setup wizard, and a genuinely different bootstrap model
  from most apps in this catalog.** Passbolt requires the client (a browser
  extension) to generate its own GPG keypair and master password — there is no
  server-side password to seed and nothing to retrieve from Secret Manager.
  Retrieve the one-time setup URL instead:
  ```bash
  gcloud logging read \
    'resource.type="cloud_run_job" AND resource.labels.job_name~admin-bootstrap' \
    --project "$PROJECT" --limit 20 --format='value(textPayload)' | grep '/setup/start/'
  ```

- **Health endpoint.** `GET /healthcheck/status.json` returns an
  unauthenticated `200` with `{"header":{"status":"success",...},"body":"OK"}`
  once ready — confirmed via local container testing and live deployment. Both
  the startup and liveness probes target this path by default.

- **Inspect job execution:**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Configuration Variables

Variables are grouped exactly as they appear on the deployment platform. Only
settings specific to or notable for Passbolt are listed; every other input is
inherited from [App_CloudRun](App_CloudRun.md) with its standard behaviour.

### Group 1 — Project & Identity

| Variable | Default | Description |
|---|---|---|
| `project_id` | _(required)_ | Target Google Cloud project. |
| `region` | `us-central1` | Region for the service and regional resources. |

### Group 2 — Deployment Environment

| Variable | Default | Description |
|---|---|---|
| `tenant_id` | `demo` | Short suffix that makes resource names unique per environment. Use a distinct value (e.g. `cr`) from any co-deployed `Passbolt_GKE` (`gke`) to avoid a naming collision. |
| `support_users` | `[]` | Emails granted project access and monitoring alerts. |
| `resource_labels` | `{}` | Labels applied to all resources. |

### Group 3 — Application Identity

| Variable | Default | Description |
|---|---|---|
| `application_name` | `passbolt` | Base name for resources. Do not change after first deploy. |
| `display_name` | `Passbolt` | Human-readable name shown in the Console. |
| `application_version` | `latest` | `passbolt/passbolt` image tag. |
| `admin_email` | `admin@example.com` | Email for the admin account registered by `admin-bootstrap`. |
| `admin_first_name` / `admin_last_name` | `Admin` / `User` | Name fields for the initial admin account. |
| `enable_gcs_storage_volume` | `true` | Mounts the `storage` (GPG) and `jwt` GCS volumes. Keep enabled. |

### Group 4 — Runtime & Scaling

| Variable | Default | Description |
|---|---|---|
| `deploy_application` | `true` | Set `false` to provision infrastructure only. |
| `container_image_source` | `prebuilt` | Deploys the official image directly; Passbolt only supports the prebuilt image. |
| `cpu_limit` | `1000m` | 1 vCPU. |
| `memory_limit` | `2Gi` | Memory limit — PHP 8.x + Apache. |
| `min_instance_count` | `0` | Scale-to-zero by default. |
| `max_instance_count` | `1` | Single instance by default. |
| `container_port` | `80` | Passbolt (Apache) listens here. |
| `execution_environment` | `gen2` | Required execution environment. |
| `enable_cloudsql_volume` | `true` | **Asymmetric with `Passbolt_GKE`'s default of `true`.** Set `true` for socket-based MySQL connections — Passbolt's `DATASOURCES_DEFAULT_HOST` accepts the socket directory directly. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Container path for the Auth Proxy socket. |
| `container_protocol` | `http1` | `"http1"` or `"h2c"`. |
| `enable_image_mirroring` | `true` | Mirrors the Passbolt image into Artifact Registry. |

### Group 5 — Access & Networking

| Variable | Default | Description |
|---|---|---|
| `ingress_settings` | `all` | Traffic ingress control. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | VPC egress control. |
| `enable_iap` | `false` | Identity-Aware Proxy. |

### Group 6 — Environment Variables & Secrets

| Variable | Default | Description |
|---|---|---|
| `environment_variables` | `{}` | Extra non-secret settings. `HTTPS = "on"` and (when known) `APP_FULL_BASE_URL` are set automatically. |
| `secret_environment_variables` | `{}` | Map of env var → Secret Manager secret name. Passbolt itself contributes none. |

### Group 11 — Cloud Storage

| Variable | Default | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Additional GCS buckets to mount, on top of the two Passbolt provisions automatically (`storage`, `jwt`). |
| `enable_nfs` | `true` | Provisions a Filestore volume. **Not used by Passbolt's own persistence model** — the GPG/JWT keypairs live on dedicated GCS volumes and everything else is in MySQL. Harmless generic default. |

### Group 12 — Database Backend

| Variable | Default | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Cloud SQL engine. Passbolt requires MySQL. |
| `db_name` | `passbolt` | MySQL database name. |
| `db_user` | `passbolt` | MySQL application user. |
| `database_password_length` | `32` | Generated password length (16–64). |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_password_env_var_name` | `DATASOURCES_DEFAULT_HOST` / `_USERNAME` / `_DATABASE` / `_PASSWORD` | Set by `passbolt.tf`, not user-facing — Passbolt reads discrete CakePHP/PDO env var names, not the Foundation's standard `DB_*` names. |

### Group 13 — Jobs & Scheduled Tasks

| Variable | Default | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Leave empty for `Passbolt_Common`'s default 2-job chain (`db-init` → `admin-bootstrap`). A non-empty list replaces it entirely. |
| `cron_jobs` | `[]` | Passbolt has no platform-scheduled recurring tasks by default. |

### Group 14 — Observability & Health

| Variable | Default | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthcheck/status.json`, 20s delay, 20 retries | Passbolt's unauthenticated status endpoint. |
| `liveness_probe` | HTTP `/healthcheck/status.json`, 60s delay | Same endpoint. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Cloud Monitoring uptime check. |

### Group 21 — Redis

| Variable | Default | Description |
|---|---|---|
| `enable_redis` | `false` | Not used by Passbolt. Present for platform compatibility. |

### Group 22 — VPC Service Controls & Audit Logging

Standard `App_CloudRun` VPC-SC integration — see [App_CloudRun](App_CloudRun.md).

---

## 5. Outputs

Returned on a successful deployment — the quickest way to locate and explore
the running resources.

| Output | Description |
|---|---|
| `service_name` | Cloud Run service name. |
| `service_url` | Default `run.app` URL of the service. |
| `service_location` | Region the service runs in. |
| `database_instance_name` | Cloud SQL instance name. |
| `database_name` / `database_user` | Application database name / user. |
| `database_password_secret` | Secret Manager secret holding the DB password. |
| `database_host` / `database_port` | DB endpoint / port. |
| `storage_buckets` | The `storage` (GPG) and `jwt` GCS buckets. |
| `container_image` | Deployed image. |
| `initialization_jobs` | Names of the created init jobs (`db-init`, `admin-bootstrap`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Naming identifiers. |
| `project_id` / `project_number` | Project identifiers. |
| `cicd_enabled` / `github_repository_url` | CI/CD status. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | VPC-SC status. |

---

## 6. Configuration Pitfalls & Sensible Defaults

> Risk: **Critical** (data loss / outage / security) — **High** (service
> degraded) — **Medium** (cost or partial degradation) — **Low** (minor).

> **Inherited plan-time validation.** This module passes its configuration
> through the [App_CloudRun](App_CloudRun.md) foundation engine, which
> validates values and combinations at plan time. Invalid configuration fails
> the **plan** with a clear, named error before any resource is created.

| Setting | Sensible value | Risk | Consequence if wrong |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critical | Passbolt's CakePHP schema is MySQL-only — any other engine breaks startup entirely. |
| `enable_gcs_storage_volume` | `true` | Critical | Disabling loses the persistent volumes for the self-generated GPG server keypair and JWT keypair — every credential Passbolt has encrypted server-side, and every issued JWT session, becomes unrecoverable on the next container restart. |
| `initialization_jobs` order (`db-init` → `admin-bootstrap`) | Leave `[]` unless you fully understand the dependency | Critical | The `admin-bootstrap` job's replication of the vendor's own GPG-key-generation/schema-install sequence is load-bearing — a naive replacement job that just runs `cake passbolt register_user` directly fails with an Internal Error because the GPG server keypair and schema don't exist yet. |
| `enable_cloudsql_volume` | `true` (note: defaults `false` on this variant) | Medium | Passbolt's `DATASOURCES_DEFAULT_HOST` works over the Cloud SQL Auth Proxy Unix socket directly; leaving this at its Cloud-Run-side default of `false` uses direct TCP instead, which still works but forgoes the socket's TLS termination and matches neither `Passbolt_Common`'s own default nor the GKE variant. |
| `admin_email` / `admin_first_name` / `admin_last_name` | Set intentionally before first deploy | Medium | These seed the one and only admin account the `admin-bootstrap` job creates; there is no in-app way to change them after the fact except through Passbolt's own admin UI once logged in. |
| No admin password to lose track of | — | — | Unlike most apps in this catalog, there is no Secret-Manager-held admin credential to retrieve. If the one-time setup URL is missed and expires, the fix is deleting and re-running the `admin-bootstrap` job (it is idempotent for the GPG/JWT/schema steps, but `register_user` itself may need a fresh invocation for a new URL — check Passbolt's own CLI docs for re-issuing a setup link). |

---

For the foundation behaviour referenced throughout — service identity, scaling
and concurrency, ingress and load balancing, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, backups, and image mirroring — see
**[App_CloudRun](App_CloudRun.md)**. Passbolt-specific application
configuration shared with the GKE variant is described in
**[Passbolt_Common](Passbolt_Common.md)**.

<!-- related-guides -->

## Related guides

- [Hands-on lab: Passbolt on Cloud Run](../labs/Passbolt_CloudRun.md) — deploy it step by step, with the console screens and commands at each stage.
- [Passbolt on GKE Autopilot](Passbolt_GKE.md) — the same application on Kubernetes, for when you need the other deployment target.
- [Passbolt Common — Shared Application Configuration](Passbolt_Common.md) — the configuration shared by both deployment targets.
- Deployed alongside [Odoo on Cloud Run](Odoo_CloudRun.md), [Metabase on Google Cloud Run](Metabase_CloudRun.md), [Paperless-ngx on Google Cloud Run](Paperless_CloudRun.md), [OnlyOffice on Google Cloud Run](OnlyOffice_CloudRun.md) in the **Integrated ERP Platform** solution.
