---
title: "Odoo on Cloud Run \u2014 Lab Guide"
description: "Hands-on labs: deploy a baseline, then pick feature labs for every configuration group — each with an objective, tested settings, verification, pitfalls and revert steps — plus operations, observability and teardown."
---

# Odoo on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Odoo_CloudRun)**

## Overview

**Estimated time:** core path (Tasks 1–2) about 45–60 minutes, most of it waiting for the first
deploy; each feature lab 10–40 minutes; every lab end to end about 8–9 hours.

Odoo is a comprehensive open-source ERP suite covering CRM, accounting, inventory,
manufacturing, HR, and eCommerce. The **Odoo on Cloud Run** module deploys Odoo Community
Edition as a Cloud Run v2 service (gen2) backed by Cloud SQL for PostgreSQL, with Odoo's
filestore, sessions and configuration on a shared NFS share and an `addons` Cloud Storage bucket
mounted for extra modules. It is a thin wrapper: the Odoo-specific pieces (the container image,
the start-up script that writes and reconciles `odoo.conf`, and the `nfs-init` and `db-init`
jobs) come from the shared Odoo application configuration, and everything else — networking,
secrets, jobs, backups, security and monitoring — comes from the App_CloudRun foundation.

This lab is about operating the **Cloud Run module and the Google Cloud platform**, not Odoo's
business features. It is many labs in one: everyone deploys and verifies a baseline, then you
pick the feature labs you care about from the menu below.

### How this lab is organised

- **Part 1 — Core (Tasks 1–2).** Deploy a baseline with the defaults and verify it, including
  Odoo's first sign-in. Everyone does this.
- **Part 2 — Feature labs.** One lab per variable group on the deployment form, numbered by
  group (Lab 4 = Group 4). After the baseline they are independent of each other and can be run
  in any order. Each states its objective, time, cost and prerequisites, then walks you through
  configure → apply → verify → explore → revert.
- **Part 3 — Operate, observe, troubleshoot, tear down (Tasks 3–6).**

### Lab menu

| Lab | Group | Objective (what you will be able to do) | Time | Adds cost? | External setup |
|---|---|---|---|---|---|
| Task 1 | 1 | Deploy Odoo with defaults and find every resource it created | 30–40 min | Baseline | None |
| [Lab 2](#lab-2--deployment-environment--isolation-group-2) | 2 | Add alert recipients and cost labels, and run Odoo as its own service account instead of the tenant-shared one | 20–25 min | No | Fence only: an organisation-level IAM role |
| [Lab 3](#lab-3--application-identity--version-group-3) | 3 | Rename the service's display text and rebuild Odoo on a different release channel | 15–30 min | No | None |
| [Lab 4](#lab-4--runtime--scaling-group-4) | 4 | Size CPU/memory, keep Odoo's scheduled actions running, remove cold starts, and split traffic between revisions | 30–40 min | Yes (always-on instance) | None |
| [Lab 5](#lab-5--ingress-vpc--iap-group-5) | 5 | Control who can reach the `run.app` URL and put Google sign-in in front of Odoo | 15–30 min | No | IAP only: an OAuth consent screen |
| [Lab 6](#lab-6--environment-variables--secrets-group-6) | 6 | Inject plain and Secret Manager-backed environment variables and see credential-named values moved into Secret Manager automatically | 20 min | Negligible | None |
| [Lab 7](#lab-7--backup--maintenance-group-7) | 7 | Schedule nightly database + filestore backups, run one on demand, and (optionally) restore a dump | 20–30 min | Small (storage) | Import only: a staged backup file |
| [Lab 8](#lab-8--cicd--binary-authorization-group-8) | 8 | Enforce Binary Authorization on the service; read how push-to-deploy and Cloud Deploy promotion are wired | 15 min (+30 with GitHub) | Small | CI/CD only: a GitHub repository and token or app installation |
| [Lab 9](#lab-9--custom-sql-scripts-group-9) | 9 | Run your own ordered SQL scripts against Odoo's database from a bucket | 20 min | Negligible | A bucket you create (steps included) |
| [Lab 10](#lab-10--cloud-armor-domains--artifact-registry-group-10) | 10 | Front Odoo with a global HTTPS load balancer, a WAF and CDN, on a nip.io or custom domain | 30–45 min | Yes (load balancer, Cloud Armor) | Custom domain only: DNS you control |
| [Lab 11](#lab-11--cloud-storage--nfs-group-11) | 11 | Add buckets and a GCS Fuse mount, and prove the filestore survives a restart | 25 min | Small | CMEK options: a KMS key ring (auto-created) |
| [Lab 12](#lab-12--database-backend-group-12) | 12 | Turn on automatic database password rotation and watch a rotation reach Odoo | 25–30 min | Negligible | None |
| [Lab 13](#lab-13--jobs--scheduled-tasks-group-13) | 13 | Add your own chained initialization job and a scheduled job that reports filestore size | 25 min | Small | None |
| [Lab 14](#lab-14--observability--health-group-14) | 14 | Tune Odoo's probes, create an uptime check and a custom alert policy | 20 min | Small | None |
| [Lab 21](#lab-21--redis-cache-group-21) | 21 | Wire Odoo to the Redis server co-hosted on the shared NFS VM | 15 min | No | None |
| [Lab 22](#lab-22--vpc-service-controls--audit-logging-group-22) | 22 | Turn on detailed audit logs; dry-run a VPC Service Controls perimeter | 15–20 min | Yes (log volume) | VPC-SC only: an organisation |

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate every resource it provisions.
- Complete Odoo's first sign-in and confirm the database, filestore and secrets are wired.
- Change any group of settings with **Update**, predict what the change will create, modify or
  replace, and verify the result on the deployed resource rather than trusting a green apply.
- Operate the service day to day — revisions, scaling, versions, secrets, backups, jobs.
- Observe it with Cloud Logging and Cloud Monitoring, and diagnose the common failure modes.
- Tear the deployment down cleanly, including anything the feature labs left behind.

## Prerequisites

- **Services_GCP** (provides the VPC, Cloud SQL, Filestore, Artifact Registry,
  and shared service accounts this module depends on). You do not need to deploy
  this yourself first — the platform automatically detects whether it already
  exists in the target project and provisions it before this module if not (see
  Task 1).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **Bringing your own project?** Before the first deploy into it, the deployment confirmation dialog asks you to prove you control it (**Get verification code**, run the commands it shows as a project Owner, then **Verify**) and to give the RAD deployment service account the **Owner** role. A project RAD creates for you needs neither.
- **Advanced mode for later changes.** The create form asks only for the first page of inputs (and, in a project RAD creates for you, little more than the tenant name and region). Every other input in the Configuration Guide — including the scaling and version inputs in the Day-2 tasks — is changed afterwards with **Update** on the deployment's page after ticking **Enable advanced mode**, which is open to every account while builds are included in the price (on a lab environment, only an administrator can use it). Updates never carry a module fee.
- **RAD platform access** with permission to deploy modules into the project.
- `curl` and (optionally) `jq` on your workstation.

Set these shell variables once; every task below reuses them. `SERVICE` and the names derived
from it are discovered after Task 1.

```bash
export PROJECT="<your-project-id>"
export REGION="us-central1"          # the region you deploy into

# After Task 1 completes:
export SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
  --filter="metadata.name~^odoo" --format="value(metadata.name)" --limit=1)
export SERVICE_URL=$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT" --region="$REGION" --format="value(status.url)")
echo "Service: $SERVICE"; echo "URL: $SERVICE_URL"
```

Every app-scoped resource is named from `SERVICE`, which is `application_name` + `tenant_id` +
an 8-character hash (for example `odoodemo1a2b3c4d`):

| Resource | Name |
|---|---|
| Cloud Run service | `$SERVICE` |
| Init / helper jobs | `$SERVICE-nfs-init`, `$SERVICE-db-init`, `$SERVICE-db-create`, `$SERVICE-nfs-setup` |
| Backup job and schedule | `$SERVICE-db-export`, Cloud Scheduler `$SERVICE-backup-schedule` |
| Buckets | `gcs-$SERVICE-addons`, `gcs-$SERVICE-data`, `gcs-$SERVICE-backups` |
| Database and user | `$SERVICE` with hyphens replaced by underscores |
| Odoo master password secret | `secret-<tenant><hash>-<application_name>-master-password` |
| DB password secret | `secret-<sql-instance>-$SERVICE` |
| NFS subtree on the shared server | `/share/$SERVICE`, mounted at `/mnt` |

## How to change settings in the feature labs

- **Update in advanced mode.** Open **Deployments**, open your Odoo deployment, click
  **Update**, tick **Enable advanced mode**, change the inputs the lab names (they are grouped
  exactly as in the lab headings), then submit. The status page streams the plan and apply logs.
  Updates never carry a module fee; builds are included in the price (5 updates a month free,
  then a small build charge).
- **Update-safe vs not.** Fields flagged *update-safe* can be changed on a running deployment.
  Fields without the flag show a warning before you submit, because changing them may destroy or
  replace a resource (for example removing a bucket from `storage_buckets` deletes that bucket).
  If **Enforce Update Safe** is on for the deployment, unflagged fields are read-only and the labs
  that need them (marked "No" in the *Update-safe* column) cannot be run until it is turned off.
- **Plan-time validation is part of the lesson.** Many invalid combinations are refused before
  anything is created — `min_instance_count` above `max_instance_count`, CDN without Cloud Armor,
  IAP with no authorised users or no OAuth consent screen, custom SQL with no bucket or path,
  `fence_enabled` without the right IAM role. Read the error: it names the variable and the fix.
- **One lab at a time.** Apply one group, verify it, then either **Revert** (each lab says
  exactly what to restore) or keep it if a later lab builds on it.
- **Verify the deployed object, not the green apply.** A successful apply proves Terraform ran;
  it does not prove the setting did what you asked. Every Verify step reads the resource back —
  `gcloud ... describe`, the revision's env vars, a `curl` of the endpoint, or a
  write-restart-read for storage.
- **Settings snippets** in the labs are written as `name = value` lines, the same way the
  Configuration Guide documents them; enter each value in the field of the same name on the form.

---

## Task 1 — Deploy the baseline [Automated]

Group 1 (**Project & Identity**: `project_id`, `tenant_id`, `region`) is set here, on the create
form; there is no separate feature lab for it. Keep the defaults for everything else.

**Baseline settings:**

```hcl
project_id = "<your-project-id>"  # the only required input
tenant_id  = "demo"               # 1–7 lowercase letters/digits; shared by every app in the tenant
region     = "us-central1"        # must match the region Services_GCP uses
# Defaults you get: application_name = "odoo", application_version = "18.0" (custom build),
# 1 vCPU / 2Gi, min 0 / max 1 instances (scale to zero), request-based CPU,
# ingress "all", NFS on, addons bucket + "data" bucket, nightly backup at 02:00 UTC.
```

> **Choose `tenant_id` deliberately.** It is capped at 7 characters (service-account names have a
> 30-character limit) and cannot be changed later. If you also deploy **Odoo on GKE** into the
> same project, give the two different tenants (for example `cr` and `gke`) or different
> `application_name` values — both variants derive every name from the same inputs and would
> otherwise collide on the database, secrets and buckets.

1. Open **Solutions → Solution Catalog → RAD modules** in the RAD platform top navigation, open **Odoo (Cloud Run)** from the **Platform Modules** list to start configuration, choose **Configuration Form** under *How would you like to configure this deployment?* (the form opens on the **Conversational Assistant** if you hold purchased credits or are a partner or administrator), set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Odoo_CloudRun)
   documents every input by group, with defaults. Click **Deploy Module**, review the estimated cost in the **Deployment Confirmation** dialog when it appears and click **Submit** (if the dialog then adds a confirmation step, such as verifying a project you bring, complete it and click **Confirm**), which opens the deployment status page with real-time logs.

2. The platform provisions (or discovers) the shared services, then builds the Odoo image from
   the official nightly package with Cloud Build, creates the Cloud Run service (gen2), the
   database and its user on the shared Cloud SQL instance, the Secret Manager secrets (database
   password and Odoo master password), the `addons` and `data` buckets and the backup bucket,
   and runs the one-shot jobs: `nfs-init` (creates `/mnt/filestore`, `/mnt/sessions` and
   `/mnt/extra-addons`, owned by Odoo's uid 101) and `db-init` (creates or re-syncs the
   PostgreSQL role and database; it runs on every apply and is idempotent). First deploys take
   roughly **20–35 minutes** when Services_GCP is created in the same run (Cloud SQL dominates),
   and about 10–15 minutes into a project where it already exists.

3. When it completes, set the shell variables from *Prerequisites* and confirm what was created:

   ```bash
   gcloud run services list --project="$PROJECT" --region="$REGION"
   gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~^$SERVICE"
   gcloud storage buckets list --project="$PROJECT" --format="value(name)" | grep "$SERVICE"
   gcloud secrets list --project="$PROJECT" --format="value(name)" | grep -E "$SERVICE|master-password"
   gcloud scheduler jobs list --project="$PROJECT" --location="$REGION" | grep "$SERVICE"
   ```

   Expected: one service; jobs including `nfs-init`, `db-init`, `db-create`, `nfs-setup` and
   `db-export`; three buckets (`addons`, `data`, `backups`); the two secrets; and the
   `$SERVICE-backup-schedule` scheduler job.

---

## Task 2 — Access & verify the baseline [Manual]

1. **Health.** Odoo answers `/web/health` once its HTTP server is up, and `/web/login` only once
   it can read its database, so check both:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/web/health"   # expect 200
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/web/login"    # expect 200
   ```

   > On first boot Odoo installs the `base` module into a brand-new database, which takes
   > several minutes. The startup probe is a TCP check on port 8069 (60 s delay, 3 × 30 s), and
   > the liveness probe calls `/web/health` after 120 s. With scale-to-zero, the first request
   > after an idle period also pays a 30–60 s cold start — retry before diagnosing.

2. **Confirm the init jobs succeeded** — Odoo cannot start correctly without them:

   ```bash
   for J in nfs-init db-init; do
     gcloud run jobs executions list --job="$SERVICE-$J" --project="$PROJECT" --region="$REGION" \
       --limit=1 --format="table(name,status.conditions[0].type,status.conditions[0].status,status.succeededCount)"
   done
   ```

3. **First sign-in (Odoo's first run).** You do not create a database by hand on this module:
   the start-up command runs Odoo with `-i base` against the database named in `odoo.conf`
   (`DB_NAME`, which is `$SERVICE` with hyphens turned into underscores), so the database is
   created and initialised on the first boot.
   - Open `$SERVICE_URL/web/login` in a browser.
   - Sign in as **`admin`**. A database initialised from the command line has Odoo's built-in
     default administrator password, **`admin`**.
   - **Change it immediately**: avatar (top right) → **My Profile / Preferences** →
     **Account Security** → **Change Password**. Anyone who can reach the URL can otherwise sign
     in as administrator — Lab 5 (IAP) and Lab 10 (WAF) show how to restrict that.
   - Then set the company name, timezone and language under **Settings**, and install the apps
     you need from **Apps**.

4. **The database manager is switched off — on purpose.** The generated `odoo.conf` sets
   `list_db = False`, so `$SERVICE_URL/web/database/manager` reports that the database manager
   has been disabled. That closes the page that could drop or duplicate the database. Odoo's
   **master password** (`admin_passwd`) is still generated and stored in Secret Manager, and is
   rewritten into `odoo.conf` at every boot; retrieve it if you ever need it:

   ```bash
   MASTER_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~-master-password$" --format="value(name)" | grep -i odoo | head -1)
   gcloud secrets versions access latest --secret="$MASTER_SECRET" --project="$PROJECT"
   ```

5. **See what the baseline provisioned:**

   ```bash
   # Runtime: image, CPU/memory, scaling, probes, mounts, env (names only)
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=export \
     | grep -E "image:|cpu:|memory:|minScale|maxScale|execution-environment|mountPath|tcpSocket|path: /web" 

   # Database and user on the shared instance
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --filter="databaseVersion~POSTGRES" --limit=1)
   gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" | grep -i odoo
   gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" | grep -i odoo

   # NFS server VM and buckets
   gcloud compute instances list --project="$PROJECT" --filter="name~nfs"
   gcloud storage ls "gs://gcs-$SERVICE-addons/"
   ```

   The service mounts the NFS share at `/mnt` (filestore, sessions and `odoo.conf` live there),
   the `addons` bucket at `/mnt/extra-addons` through GCS Fuse (it is on Odoo's addons path), and
   the Cloud SQL socket at `/cloudsql`.

---

## Part 2 — Feature labs

Each lab starts from a healthy baseline. Run `curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/web/login"`
before you begin; it should print `200`.

---

### Lab 2 — Deployment Environment & Isolation (Group 2)

> **Objective:** route alerts to your team, label every resource for cost reporting, and run
> Odoo as its own least-privilege service account inside a shared project.

**You will:** add support users and labels · switch the runtime identity to a dedicated service
account · read how the optional IAM-deny fence works and why it needs organisation-level access.
**Time:** 20–25 min · **Cost:** none · **Prerequisites / external setup:** the fence needs
`roles/iam.denyAdmin` and `roles/resourcemanager.tagAdmin`, and `iam.denyAdmin` can only be
granted at **organisation** (or folder) scope — a project Owner alone cannot enable it.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `support_users` | `[]` | Yes | Emails granted project access and added as notification channels; also turns on the built-in CPU, memory and 5xx alert policies |
| `resource_labels` | `{}` | Yes | Labels applied to every resource the module creates |
| `dedicated_service_account_id` | `""` | No | Run Odoo (and its jobs) as this app-only account instead of the tenant-shared `cloudrun-sa-...`; it gets only network, Cloud SQL client and logging roles project-wide, plus this app's own secrets, buckets and jobs |
| `fence_enabled` | `false` | No | Tags this app's secrets, buckets, service and jobs and adds an IAM deny policy so only its own account and `fence_administrators` can reach them. Requires `dedicated_service_account_id` |
| `fence_administrators` | `[]` | No | People who keep access to fenced resources (the deployer and break-glass admins) |

#### Step 1 — Configure

```hcl
support_users                = ["<your-email>"]                     # alerts + project access
resource_labels              = { environment = "lab", team = "erp" } # lowercase keys/values
dedicated_service_account_id = "odoo-lab-sa"   # 6–30 chars: lowercase, digits, hyphens
fence_enabled                = false            # true only if you hold the org-level roles
fence_administrators         = ["<your-email>"] # used only when fence_enabled = true
```

#### Step 2 — Apply

Expect new IAM bindings and the dedicated account (created on first use), notification channels
and three alert policies, label changes on existing resources, and a **new revision** (the
service account is part of the revision template). About 5–8 minutes.

#### Step 3 — Verify

```bash
# The revision runs as the dedicated account
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="value(spec.template.spec.serviceAccountName)"
# expect: odoo-lab-sa@<your-project-id>.iam.gserviceaccount.com

# Its project-level roles are the narrow set
gcloud projects get-iam-policy "$PROJECT" --flatten="bindings[].members" \
  --filter="bindings.members~odoo-lab-sa@" --format="value(bindings.role)"
# expect roles such as cloudsql.client, compute.networkUser, logging.logWriter, vpcaccess.user

# Labels landed
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format="value(metadata.labels)"
gcloud storage buckets describe "gs://gcs-$SERVICE-addons" --format="value(labels)"

# Alert channels and policies for this service
gcloud alpha monitoring policies list --project="$PROJECT" --format="value(displayName)" | grep "$SERVICE"

# Odoo still works under the new identity (secrets + DB + NFS all reachable)
curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/web/login"   # expect 200
```

#### Explore further

- Compare with the tenant-shared account: list the roles of `cloudrun-sa-*` the same way. The
  shared account has project-wide access to every app's secrets in the tenant; the dedicated one
  is limited to this app's secrets, so it cannot read another app's credentials.
- Read the secret's IAM policy to see the per-secret grant:
  `gcloud secrets get-iam-policy "$MASTER_SECRET" --project="$PROJECT"`.
- **Fence (read-only walkthrough if you lack the org roles).** With `fence_enabled = true` the
  plan first probes the deploying identity's permissions; if `iam.denyAdmin` or `tagAdmin` is
  missing it **fails at plan time** with a message naming the missing permission, before
  anything is created. When it succeeds you will see a tag key `fence-$SERVICE` bound to the
  app's resources and a deny policy that blocks every principal except the dedicated account and
  `fence_administrators`.

#### Watch out for

- Changing `dedicated_service_account_id` after the fact re-points every job and the service; do
  it in a quiet period. Clearing it moves Odoo back to the shared account.
- The dedicated account and its project roles **are deleted on destroy** (it is app-scoped); the
  tenant-shared account is not.
- `support_users` are real IAM grants on the project, not just email recipients.

#### Revert

```hcl
dedicated_service_account_id = ""
fence_enabled                = false
fence_administrators         = []
# keep support_users and resource_labels if you want alerts and labels for later labs
```

Reverting the account creates a new revision running as the shared account; the dedicated
account is removed by the apply.

---

### Lab 3 — Application Identity & Version (Group 3)

> **Objective:** change what operators see for this service and rebuild Odoo on a different
> release channel.

**You will:** change the display name and description · move between Odoo release channels and
watch Cloud Build produce a new image and revision.
**Time:** 15–30 min (a version change rebuilds the image) · **Cost:** none · **Prerequisites:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `application_name` | `odoo` | Yes (but see *Watch out for*) | Base of every resource name (`$SERVICE` = name + tenant + hash). 1–20 chars, starts with a letter |
| `application_display_name` | `Odoo ERP` | Yes | Friendly name shown in the platform and Console |
| `application_description` | `Odoo ERP on Cloud Run` | Yes | Description on the Cloud Run service |
| `application_version` | `18.0` | Yes | Odoo nightly channel built into the image (`18.0`, `17.0`, ...). `latest` builds 18.0 |

#### Step 1 — Configure

```hcl
application_display_name = "Odoo ERP (Lab)"
application_description  = "Odoo on Cloud Run - feature lab instance"
application_version      = "18.0"   # leave as-is first; see Explore further for a channel change
```

#### Step 2 — Apply

Text changes update the service in place. A version change triggers a Cloud Build image build
(5–10 min) and a new revision. Expect 3–15 minutes.

#### Step 3 — Verify

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=export \
  | grep -iE "description|APP_VERSION" -A1
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="value(spec.template.spec.containers[0].image)"
gcloud builds list --project="$PROJECT" --region="$REGION" --limit=3 \
  --format="table(id,status,createTime.date(),substitutions)"
```

Expected: the description is the new text, `APP_VERSION` matches `application_version`, and the
image tag ends in the version.

#### Explore further

- **Odoo version in the UI:** sign in, open **Settings** and scroll to the bottom — the server
  version is shown there. It should match the channel you built.
- Build a newer nightly of the same channel: the image re-pulls the channel's latest nightly on
  each build, so a rebuild picks up fixes within a release.

#### Watch out for

- **Downgrading is not supported by Odoo.** Moving an existing database from 18.0 to 17.0 will
  fail; a major upgrade (17.0 → 18.0) needs Odoo's upgrade process, which `-i base` does not
  perform. Practise channel changes on a fresh lab deployment only.
- **Do not change `application_name` on a running deployment.** Although the form allows it,
  every app-scoped name derives from it, so the next apply creates a new service, database,
  secrets and buckets and removes the old ones.
- An invalid channel fails the Cloud Build step (the nightly package download returns 404).

#### Revert

```hcl
application_display_name = "Odoo ERP"
application_description  = "Odoo ERP on Cloud Run"
application_version      = "18.0"
```

---

### Lab 4 — Runtime & Scaling (Group 4)

> **Objective:** size Odoo correctly, keep its scheduled actions running, remove cold starts,
> and roll out safely with traffic splitting.

**You will:** raise CPU/memory · switch to always-allocated CPU and a warm instance · allow a
second instance · tag and split traffic between revisions · see which runtime fields are live.
**Time:** 30–40 min · **Cost:** yes — `min_instance_count = 1` with always-allocated CPU bills
an instance around the clock (roughly an extra US$40 a month at 1 vCPU) · **Prerequisites:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `deploy_application` | `true` | No | `false` provisions everything except the Cloud Run service |
| `container_image_source` | `custom` | Yes | `custom` builds Odoo from the module's Dockerfile; `prebuilt` deploys `container_image` as-is |
| `container_image` | `""` | Yes | Image URI for `prebuilt` |
| `enable_image_mirroring` | `true` | Yes | Copy the image into Artifact Registry before deploying |
| `cpu_limit` | `1000m` | Yes | vCPU per instance (overrides `container_resources`) |
| `memory_limit` | `2Gi` | Yes | Memory per instance (overrides `container_resources`); must stay above Odoo's 1536 MB hard limit |
| `container_resources` | `null` | Yes | Object form of CPU/memory (`cpu_limit`, `memory_limit`, optional requests) |
| `min_instance_count` | `0` | Yes | Warm instances (0 = scale to zero) |
| `max_instance_count` | `1` | Yes | Instance ceiling; must be ≥ min |
| `cpu_always_allocated` | `false` | Yes | `true` = CPU allocated while an instance is alive (instance-based billing) |
| `container_port` | `8069` | Yes | Port Odoo listens on — leave at 8069 |
| `container_protocol` | `http1` | Yes | `http1` or `h2c` |
| `execution_environment` | `gen2` | Yes | Must stay `gen2` (NFS and GCS Fuse need it; the plan rejects `gen1` with NFS) |
| `timeout_seconds` | `300` | Yes | Per-request timeout (0–3600) |
| `enable_cloudsql_volume` | `true` | Yes | Mount the Cloud SQL socket; Odoo connects through it |
| `cloudsql_volume_mount_path` | `/cloudsql` | Yes | Fixed at `/cloudsql` by the Odoo configuration — this field has no effect here |
| `traffic_split` | `[]` | Yes | Percent split across revisions; entries must sum to 100 |
| `service_annotations` | `{}` | Yes | Extra annotations on the service |
| `service_labels` | `{}` | Yes | Extra labels on the service |

#### Step 1 — Configure

```hcl
cpu_limit            = "2000m"   # 2 vCPU: faster module installs and reports
memory_limit         = "4Gi"     # headroom above Odoo's 1.5 GiB per-worker hard limit
cpu_always_allocated = true      # Odoo's in-process cron (2 threads) needs CPU between requests
min_instance_count   = 1         # no cold starts; scheduled actions keep running
max_instance_count   = 2         # a second instance during bursts or rollouts
timeout_seconds      = 600       # long reports and imports
service_labels       = { tier = "erp" }
service_annotations  = { "lab/owner" = "<your-email>" }
```

#### Step 2 — Apply

Expect an in-place update of the service and **one new revision**. About 3–5 minutes.

#### Step 3 — Verify

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=export \
  | grep -E "cpu:|memory:|minScale|maxScale|cpu-throttling|timeoutSeconds|tier:|lab/owner"
```

Expected: `cpu: 2000m` (or `'2'`), `memory: 4Gi`, `minScale: '1'`, `maxScale: '2'`,
`cpu-throttling: 'false'` (always-allocated), `timeoutSeconds: 600`, plus your label and
annotation. Then confirm an instance stays warm: wait 20 minutes without traffic and time a request —
it should answer in well under a second instead of paying a cold start.

```bash
time curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/web/login"
```

#### Explore further

- **Traffic splitting / canary.** List revisions, then send 10 % to the newest and keep 90 % on
  the previous one, with a stable tag for each:

  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION" --limit=2
  ```

  ```hcl
  traffic_split = [
    { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", percent = 10, tag = "canary" },
    { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", revision = "<previous-revision-name>", percent = 90, tag = "stable" },
  ]
  ```

  Verify with `gcloud run services describe "$SERVICE" ... --format="yaml(status.traffic)"`;
  each tag gets its own URL (`https://canary---...run.app`). Entries that do not sum to 100, or a
  REVISION entry without `revision`, fail the plan.
- **Request-based CPU with a warm instance.** Set `cpu_always_allocated = false` but keep
  `min_instance_count = 1`: the instance stays alive, but CPU is throttled between requests, so
  Odoo's scheduled actions (mail fetching, recurring invoices) slow down or stall. Check
  **Settings → Technical → Scheduled Actions** for each action's *Last run*.
- Try `min_instance_count = 3` with `max_instance_count = 2` to see the plan-time validation.

#### Watch out for

- `memory_limit` below about 2 GiB leaves Odoo's own `limit_memory_hard` (1536 MB) unable to
  fire before Cloud Run kills the container; keep the invariant `soft < hard < container cap`.
- `container_port` must stay 8069 — Odoo is configured to listen there.
- `execution_environment = "gen1"` is refused at plan time while NFS is on.
- `min_instance_count = 1` is what makes the uptime check in Lab 14 possible; returning to 0
  removes the uptime check.
- Before raising `max_instance_count` above 1, read Lab 21 and decide on Redis; the module's
  guidance pairs multiple instances with Redis.

#### Revert

```hcl
cpu_limit            = "1000m"
memory_limit         = "2Gi"
cpu_always_allocated = false
min_instance_count   = 0
max_instance_count   = 1
timeout_seconds      = 300
traffic_split        = []
service_labels       = {}
service_annotations  = {}
```

Reverting creates one more revision and stops the always-on billing.

---

### Lab 5 — Ingress, VPC & IAP (Group 5)

> **Objective:** control which networks can reach Odoo's `run.app` URL and require a Google
> sign-in before anyone sees the Odoo login page.

**You will:** restrict ingress and observe the distinct 404 · choose an egress mode · read (or
apply) IAP and see the plan-time guardrails.
**Time:** 15 min (ingress/egress); +15 min for IAP · **Cost:** none · **Prerequisites / external
setup:** IAP needs an **OAuth consent screen (OAuth brand)** in the project, created in the
Cloud Console (APIs & Services → OAuth consent screen) — gcloud can no longer create one on new
projects. A brand cannot be deleted once created.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `ingress_settings` | `all` | Yes | `all`, `internal`, or `internal-and-cloud-load-balancing` (also creates a load balancer — see Lab 10) |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Yes | Route only RFC 1918 traffic through the VPC (`PRIVATE_RANGES_ONLY`) or all traffic (`ALL_TRAFFIC`, via Cloud NAT) |
| `enable_iap` | `false` | No | Cloud Run's native IAP: Google sign-in in front of the service |
| `iap_authorized_users` | `[]` | Yes | `user:` / `serviceAccount:` members allowed through IAP |
| `iap_authorized_groups` | `[]` | Yes | `group:` members allowed through IAP |

#### Step 1 — Configure

Start with ingress (no external setup):

```hcl
ingress_settings   = "internal"           # only VPC / Google-internal callers
vpc_egress_setting = "PRIVATE_RANGES_ONLY"
```

#### Step 2 — Apply

In-place update, about 2 minutes. No new database or storage changes.

#### Step 3 — Verify

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="value(metadata.annotations['run.googleapis.com/ingress'])"   # expect internal
curl -s "$SERVICE_URL/web/login" | grep -o "<title>[^<]*</title>"
# expect: <title>404 Page not found</title>  (the internal-ingress rejection)
```

Then set `ingress_settings = "all"` again and confirm `/web/login` returns 200.

#### Explore further

- **IAP** (needs the consent screen):

  ```hcl
  enable_iap            = true
  iap_authorized_users  = ["user:<your-email>"]
  iap_authorized_groups = []
  ```

  Verify: an unauthenticated `curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/web/login"`
  now returns **403**, while a browser signed in as an authorised user reaches the Odoo login.
  `gcloud run services get-iam-policy "$SERVICE" --project="$PROJECT" --region="$REGION"` shows
  the IAP service agent as invoker and no `allUsers`.
- **Guardrails, without a brand:** set `enable_iap = true` with no users, or in a project with no
  consent screen. The plan fails before anything changes. This is deliberate: enabling IAP
  removes public access in the same apply, so a later failure would leave Odoo reachable by
  nobody.
- `vpc_egress_setting = "ALL_TRAFFIC"` sends Odoo's outbound calls (SMTP, payment providers)
  through Cloud NAT. Check the service still serves 200.

#### Watch out for

- The three 404s look alike but mean different things: `404 Page not found` = internal ingress;
  Google's `Error 404 (Not Found)!!1` page = missing invoker permission; Odoo's own 404 page =
  wrong path.
- IAP and Cloud CDN are mutually exclusive — do not combine IAP with Lab 10's `enable_cdn`.
- IAP adds a sign-in in front of Odoo; Odoo still requires its own login behind it.

#### Revert

```hcl
ingress_settings      = "all"
vpc_egress_setting    = "PRIVATE_RANGES_ONLY"
enable_iap            = false
iap_authorized_users  = []
iap_authorized_groups = []
```

Disabling IAP restores the public invoker binding.

---

### Lab 6 — Environment Variables & Secrets (Group 6)

> **Objective:** pass configuration and credentials to Odoo safely, and see the module keep
> credential-looking values out of plain text.

**You will:** add plain env vars · reference an existing Secret Manager secret · watch a
credential-named variable get converted to a secret automatically.
**Time:** 20 min · **Cost:** negligible (one or two secrets) · **Prerequisites:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `environment_variables` | `{}` | Yes | Plain env vars on the service (merged over the module's own) |
| `secret_environment_variables` | `{}` | Yes | Env var name → Secret Manager secret name, resolved at instance start |
| `protect_sensitive_environment_variables` | `true` | Yes | Moves non-empty `environment_variables` whose NAME looks like a credential (`*PASSWORD`, `*SECRET`, `*TOKEN`, `*API_KEY`, ...) into Secret Manager and injects them as secret refs. Hidden in RAD-managed projects |
| `secret_rotation_period` | `2592000s` | Yes | Rotation-notification period for the module's secrets; drives Lab 12's automatic rotation |
| `secret_propagation_delay` | `30` | Yes | Seconds to wait after creating/updating secrets before dependent steps |
| `explicit_secret_values` | `{}` | Yes | Keys of `secret_environment_variables` whose secrets are created in the same apply, so the plan-time existence check is skipped for them. It does not itself write values into Secret Manager |

#### Step 1 — Configure

Create the secret you will reference (pinned to your region, which RAD-managed projects require):

```bash
printf 'lab-secret-value' | gcloud secrets create odoo-lab-marker --project="$PROJECT" \
  --replication-policy=user-managed --locations="$REGION" --data-file=-
```

```hcl
environment_variables = {
  TZ                = "UTC"
  ODOO_LAB_MARKER   = "group-6"
  SMTP_PASSWORD     = "not-a-real-password"   # credential-named: will be moved to Secret Manager
}
secret_environment_variables            = { ODOO_LAB_SECRET = "odoo-lab-marker" }
protect_sensitive_environment_variables = true
secret_propagation_delay                = 60
```

#### Step 2 — Apply

Expect one new secret (for `SMTP_PASSWORD`), IAM grants on the secrets, and a new revision.
About 3–5 minutes.

#### Step 3 — Verify

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=export \
  | grep -E "name: (TZ|ODOO_LAB_MARKER|ODOO_LAB_SECRET|SMTP_PASSWORD)" -A4
gcloud secrets list --project="$PROJECT" --format="value(name)" | grep "$SERVICE-env-smtp-password"
```

Expected: `TZ` and `ODOO_LAB_MARKER` have plain `value:` lines; `ODOO_LAB_SECRET` and
`SMTP_PASSWORD` have `secretKeyRef` blocks (no plaintext); a secret named
`secret-$SERVICE-env-smtp-password-...` exists.

#### Explore further

- Set `protect_sensitive_environment_variables = false` and re-apply: `SMTP_PASSWORD` now shows
  as plain text to anyone with read access to the service — the reason the default is `true`.
- Reference a secret that does not exist: the plan prints a warning naming it (it does not fail),
  and the revision then fails to start because the secret cannot be resolved.
- **Outbound mail.** Odoo's outgoing mail server is configured in the UI (**Settings → Technical
  → Outgoing Mail Servers**); keep the password itself in Secret Manager rather than in plain env.

#### Watch out for

- Secrets are read when an instance starts. Adding a new version of a referenced secret reaches
  Odoo only on the next revision or instance restart.
- In a RAD-managed project, secrets must be pinned to the deployment region; a secret with
  automatic (global) replication is refused by the location policy.

#### Revert

```hcl
environment_variables                   = {}
secret_environment_variables            = {}
protect_sensitive_environment_variables = true
secret_propagation_delay                = 30
```

Then delete the secret you created: `gcloud secrets delete odoo-lab-marker --project="$PROJECT" --quiet`.

---

### Lab 7 — Backup & Maintenance (Group 7)

> **Objective:** schedule backups that capture both Odoo's database and its filestore, run one on
> demand, and understand the restore path.

**You will:** change the schedule and retention · trigger a backup now and inspect the archive ·
walk through (or run) a database import.
**Time:** 20–30 min · **Cost:** small (backup storage) · **Prerequisites / external setup:** the
import needs a staged backup file, and it **restores over the live database**.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `backup_schedule` | `0 2 * * *` | Yes | Cron (UTC) for the `$SERVICE-db-export` job; empty disables scheduled backups |
| `backup_retention_days` | `7` | Yes | Lifecycle rule on the backup bucket deletes older backups |
| `enable_backup_import` | `false` | No | Run a one-time import job during the apply |
| `backup_source` | `gcs` | No | `gcs` (the deployment's backup bucket) or `gdrive` (a Drive file ID) |
| `backup_file` | `backup.sql` | No | Bare filename in the backup bucket, or a Drive file ID |
| `backup_format` | `sql` | Yes | `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, or `auto` (`auto` not allowed with `gdrive`) |

#### Step 1 — Configure

```hcl
backup_schedule       = "30 3 * * *"   # 03:30 UTC daily
backup_retention_days = 14             # raise to 90+ for financial records
enable_backup_import  = false          # see Explore further
```

#### Step 2 — Apply

Updates the Cloud Scheduler job and the bucket lifecycle rule in place; about 2 minutes.

#### Step 3 — Verify

```bash
gcloud scheduler jobs describe "$SERVICE-backup-schedule" --location="$REGION" --project="$PROJECT" \
  --format="value(schedule,timeZone)"                      # expect 30 3 * * *  UTC
gcloud storage buckets describe "gs://gcs-$SERVICE-backups" --format="yaml(lifecycle_config)"
# expect a Delete rule with age: 14

# Run a backup now and inspect the result
gcloud run jobs execute "$SERVICE-db-export" --project="$PROJECT" --region="$REGION" --wait
gcloud storage ls -l "gs://gcs-$SERVICE-backups/backups/"
```

The archive contains `database.sql` and an `nfs_files/` copy of the NFS share, i.e. Odoo's
filestore and `odoo.conf` — both halves you need to restore Odoo.

#### Explore further

- **Restore (import) walkthrough.** To practise without outside files, download the archive you
  just made, extract `database.sql`, and upload it to the root of the backup bucket:

  ```bash
  gcloud storage cp "gs://gcs-$SERVICE-backups/backups/<archive-name>" .
  tar -xzf <archive-name>        # look for database.sql inside
  gcloud storage cp database.sql "gs://gcs-$SERVICE-backups/odoo-backup.sql"
  ```

  ```hcl
  enable_backup_import = true
  backup_source        = "gcs"
  backup_file          = "odoo-backup.sql"   # bare filename; the module builds the gs:// URI
  backup_format        = "sql"
  ```

  The apply runs `$SERVICE-backup-import` and fails loudly if the import fails. Because it writes
  into the **live** database, only do this on a lab deployment, then set
  `enable_backup_import = false` again. Remember Odoo's attachments live in the filestore, not
  the database — a database-only restore needs the matching `nfs_files/filestore`.
- Google Drive import: `backup_source = "gdrive"`, `backup_file` = the Drive file ID, and a
  format of `sql`, `tar` or `zip`.

#### Watch out for

- A backup bucket lives inside the deployment and is deleted with it; copy anything you want to
  keep somewhere else before Task 6.
- If an import fails with `password authentication failed`, the database password and secret
  have drifted (see Lab 12); a `pg_hba ... no encryption` line under it is psql's non-SSL retry,
  not a TLS problem.

#### Revert

```hcl
backup_schedule       = "0 2 * * *"
backup_retention_days = 7
enable_backup_import  = false
backup_file           = "backup.sql"
```

Delete the staged dump: `gcloud storage rm "gs://gcs-$SERVICE-backups/odoo-backup.sql"`.

---

### Lab 8 — CI/CD & Binary Authorization (Group 8)

> **Objective:** require attested images for Odoo, and understand how push-to-deploy and staged
> promotion would be wired.

**You will:** enable Binary Authorization and see it on the service · walk through the GitHub
trigger and Cloud Deploy pipeline settings.
**Time:** 15 min (Binary Authorization); +30 min with a GitHub repository · **Cost:** small
(KMS signing key) · **Prerequisites / external setup:** CI/CD needs a GitHub repository plus a
personal access token or a Cloud Build GitHub App installation ID.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_cicd_trigger` | `false` | Yes | Cloud Build trigger: build and deploy on push |
| `github_repository_url` | `""` | Yes | HTTPS URL of the repository (required with the trigger) |
| `github_token` | `""` | Yes | Personal access token (sensitive); or use the app installation |
| `github_app_installation_id` | `""` | Yes | Cloud Build GitHub App installation ID |
| `cicd_trigger_config` | `{ branch_pattern = "^main$" }` | Yes | Branch/file filters, trigger name, substitutions |
| `enable_cloud_deploy` | `false` | Yes | Route releases through a Cloud Deploy pipeline (requires the trigger) |
| `cloud_deploy_stages` | dev → staging → prod (prod approval) | Yes | Promotion stages; each gets its own service |
| `enable_binary_authorization` | `false` | No | Enforce the project's Binary Authorization policy on the service |

#### Step 1 — Configure

```hcl
enable_binary_authorization = true
enable_cicd_trigger         = false   # set true only with a repository and credential
enable_cloud_deploy         = false
```

#### Step 2 — Apply

Expect around 10 new resources (signing key and IAM for Cloud Build attestation) and a new
revision. About 5 minutes.

#### Step 3 — Verify

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=export \
  | grep -i "binary-authorization"            # expect run.googleapis.com/binary-authorization: default
gcloud container binauthz policy export --project="$PROJECT" | grep -i evaluationMode
curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/web/login"   # still 200
```

The project policy stays at its configured evaluation mode (`ALWAYS_ALLOW` unless Services_GCP
set otherwise), so the service keeps serving while the enforcement hook is in place.

#### Explore further

- **CI/CD (external setup).** With a repository containing the Odoo build context:

  ```hcl
  enable_cicd_trigger   = true
  github_repository_url = "https://github.com/<you>/<odoo-repo>"
  github_token          = "<token>"            # or github_app_installation_id = "<id>"
  cicd_trigger_config   = { branch_pattern = "^main$", included_files = ["addons/**"] }
  ```

  Verify with `gcloud builds triggers list --project="$PROJECT" --region="$REGION"`, push a
  commit, and watch `gcloud builds list` produce a build and a new revision.
- **Cloud Deploy** (`enable_cloud_deploy = true`, needs the trigger) creates
  `$SERVICE-dev`, `-staging` and `-prod` services, each with its own database; promote with
  `gcloud deploy releases promote`. Enabling it without the trigger fails the plan.

#### Watch out for

- `enable_binary_authorization` is not update-safe; flipping it re-creates the revision.
- A GitHub token is stored in Secret Manager; prefer the app installation for organisation repos.

#### Revert

```hcl
enable_binary_authorization = false
enable_cicd_trigger         = false
enable_cloud_deploy         = false
github_token                = ""
```

---

### Lab 9 — Custom SQL Scripts (Group 9)

> **Objective:** run your own SQL against Odoo's database in a controlled, ordered way as part of
> a deployment.

**You will:** stage two interdependent scripts in a bucket · run them as the application user or
as root · confirm they ran in lexicographic order.
**Time:** 20 min · **Cost:** negligible · **Prerequisites:** a bucket you create (below).

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_custom_sql_scripts` | `false` | No | Run every `.sql` under the path, in lexicographic order, via `$SERVICE-custom-sql` |
| `custom_sql_scripts_bucket` | `""` | Yes | Bucket name (no `gs://`); required when enabled |
| `custom_sql_scripts_path` | `""` | Yes | Prefix inside the bucket; required when enabled (an empty path would find nothing) |
| `custom_sql_scripts_use_root` | `false` | Yes | Run as the instance's root user instead of the app user |

#### Step 1 — Configure

Stage the scripts (the second depends on the first, so the wrong order fails loudly):

```bash
BUCKET="odoo-lab-sql-$PROJECT"
gcloud storage buckets create "gs://$BUCKET" --project="$PROJECT" --location="$REGION" --uniform-bucket-level-access
cat > 01-create.sql <<'EOF'
CREATE TABLE IF NOT EXISTS lab_sql_order (id serial PRIMARY KEY, note text, at timestamptz DEFAULT now());
EOF
cat > 02-insert.sql <<'EOF'
INSERT INTO lab_sql_order (note) VALUES ('custom SQL ran after 01-create');
EOF
gcloud storage cp 01-create.sql 02-insert.sql "gs://$BUCKET/sql/"
```

```hcl
enable_custom_sql_scripts   = true
custom_sql_scripts_bucket   = "odoo-lab-sql-<your-project-id>"
custom_sql_scripts_path     = "sql"
custom_sql_scripts_use_root = false   # the app user owns Odoo's database, which is enough here
```

#### Step 2 — Apply

Creates the `$SERVICE-custom-sql` job (and, with a dedicated service account from Lab 2, a
read grant on your bucket), then executes it. About 3–5 minutes.

#### Step 3 — Verify

```bash
gcloud run jobs executions list --job="$SERVICE-custom-sql" --project="$PROJECT" --region="$REGION" --limit=1
gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$SERVICE-custom-sql\"" \
  --project="$PROJECT" --limit=50 --format="value(textPayload)" | grep -E "Found|\.sql|CREATE|INSERT"
```

Expected: `Found 2 SQL script(s)`, then `01-create.sql` → `CREATE TABLE` and `02-insert.sql` →
`INSERT 0 1`. To read the row yourself, connect as in Task 3 step 5 and run
`SELECT * FROM lab_sql_order;`.

#### Explore further

- Add `03-fail.sql` with a syntax error and re-apply: the job fails and the apply reports it.
- Set `custom_sql_scripts_use_root = true` for statements that need elevated rights (extensions,
  roles). Prefer the app user otherwise.

#### Watch out for

- Never create tables that collide with Odoo's own (`res_*`, `ir_*`, ...). Odoo manages its
  schema; use custom SQL for reporting views or data fixes you understand.
- The bucket is yours; it is not deleted by the module's teardown.

#### Revert

```hcl
enable_custom_sql_scripts   = false
custom_sql_scripts_bucket   = ""
custom_sql_scripts_path     = ""
custom_sql_scripts_use_root = false
```

Drop the table if you like (`DROP TABLE lab_sql_order;`) and delete the bucket:
`gcloud storage rm -r "gs://$BUCKET"`.

---

### Lab 10 — Cloud Armor, Domains & Artifact Registry (Group 10)

> **Objective:** put Odoo behind a global HTTPS load balancer with a web application firewall,
> optional CDN and a hostname with a managed certificate.

**You will:** enable Cloud Armor (which builds the load balancer and switches ingress) · reach
Odoo on an automatic `nip.io` hostname · prove XSS and SQL-injection probes are blocked · turn
on CDN.
**Time:** 30–45 min (certificate provisioning dominates) · **Cost:** yes — a global forwarding
rule, a static IP and a Cloud Armor policy bill while they exist · **Prerequisites / external
setup:** none for `nip.io`; a custom domain needs DNS you control.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_cloud_armor` | `false` | No | Creates the WAF policy and a global HTTPS load balancer (serverless NEG → service) and sets ingress to `internal-and-cloud-load-balancing` |
| `admin_ip_ranges` | `[]` | Yes | CIDRs allowed by a high-priority allow rule in the policy |
| `application_domains` | `[]` | Yes | Hostnames for Google-managed certificates; empty = automatic `<ip-dashed>.nip.io` |
| `enable_cdn` | `false` | Yes | Cloud CDN on the backend; requires `enable_cloud_armor = true` |
| `max_images_to_retain` | `7` | Yes | Image-count guard for an inline registry |
| `delete_untagged_images` | `true` | Yes | Untagged-image cleanup for an inline registry |
| `image_retention_days` | `30` | Yes | Age-based cleanup for an inline registry |

The three image-retention settings only act on a registry this deployment creates itself. In a
project with Services_GCP, the shared Artifact Registry and its cleanup policy belong to
Services_GCP, so these values are accepted and have no effect.

#### Step 1 — Configure

```hcl
enable_cloud_armor  = true
admin_ip_ranges     = ["203.0.113.0/24"]   # replace with your office/VPN range
application_domains = []                    # empty: use the automatic nip.io hostname
enable_cdn          = true                  # static assets cached at the edge
```

#### Step 2 — Apply

Expect about 15–17 new resources (security policy, NEG, backend service, URL map, global IP,
certificate, HTTPS proxy, forwarding rules) and an ingress change on the service. The apply takes
5–10 minutes; the managed certificate then needs to become `ACTIVE`, which can take another
15–60 minutes.

#### Step 3 — Verify

```bash
LB_IP=$(gcloud compute addresses describe "$SERVICE-lb-ip" --global --project="$PROJECT" --format="value(address)")
LB_HOST="$(echo "$LB_IP" | tr . -).nip.io"; echo "https://$LB_HOST"

# Policy exists and is ATTACHED to the backend (an unattached policy protects nothing)
gcloud compute backend-services describe "$SERVICE-backend" --global --project="$PROJECT" \
  --format="value(securityPolicy,enableCDN)"
gcloud compute security-policies describe "$SERVICE-waf-policy" --project="$PROJECT" \
  --format="table(rules[].priority,rules[].action,rules[].match.config.srcIpRanges)"

# Odoo through the load balancer (after the certificate is ACTIVE)
curl -s -o /dev/null -w "%{http_code}\n" "https://$LB_HOST/web/login"                      # 200
curl -s -o /dev/null -w "%{http_code}\n" "https://$LB_HOST/web/login?q=%3Cscript%3Ealert(1)%3C/script%3E"  # 403
curl -s -o /dev/null -w "%{http_code}\n" "https://$LB_HOST/web/login?id=1%27%20OR%20%271%27=%271"          # 403

# The run.app URL is now closed (ingress is LB-only)
curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/web/login"                            # 404
```

Expected: `securityPolicy` points at `$SERVICE-waf-policy`, `enableCDN` is `True`, the rules
include your admin range, SQLi/XSS/LFI/RCE preconfigured rules and a rate-based ban, and the two
probe URLs return **403**.

#### Explore further

- **Custom domain:** create an `A` record for `odoo.<your-domain>` pointing at `LB_IP`, then set
  `application_domains = ["odoo.<your-domain>"]`. Watch the certificate with
  `gcloud certificate-manager certificates list --project="$PROJECT"` until it is `ACTIVE`.
- HTTP on port 80 redirects to HTTPS while preserving the host:
  `curl -sI "http://$LB_HOST/web/login" | grep -i location`.
- Check CDN hits with `curl -sI "https://$LB_HOST/web/static/img/favicon.ico" | grep -i -E "age|cache"`
  on repeated requests.
- `enable_cdn = true` with Cloud Armor off fails the plan; try it to see the guard.

#### Watch out for

- **WAF rules take about 5–10 minutes to propagate** after the apply; probes may return 200
  until then. Wait before concluding the policy is not working.
- Odoo runs with `proxy_mode = True`, so it builds links from the forwarded host — sign in through
  the load-balancer hostname, not the closed `run.app` URL, once Cloud Armor is on.
- The uptime check (Lab 14) moves to the load-balancer hostname when Cloud Armor is on.
- Do not combine CDN with IAP (Lab 5).

#### Revert

```hcl
enable_cloud_armor  = false
enable_cdn          = false
admin_ip_ranges     = []
application_domains = []
```

Reverting deletes the load balancer, policy, certificate and IP and sets ingress back to your
`ingress_settings` value (`all`). Remove any DNS record you created.

---

### Lab 11 — Cloud Storage & NFS (Group 11)

> **Objective:** add buckets and GCS Fuse mounts without breaking Odoo's addons mount, and prove
> Odoo's filestore is durable.

**You will:** add a bucket and tune the `addons` bucket · add a second GCS Fuse mount · do a
write-restart-read on the filestore.
**Time:** 25 min · **Cost:** small · **Prerequisites / external setup:** the two CMEK options
create a KMS key ring and keys; they were not exercised in the group test.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `create_cloud_storage` | `true` | No | Create the buckets (module's `addons` plus `storage_buckets`) |
| `storage_buckets` | `[{ name_suffix = "data" }]` | No | Your buckets, named `gcs-$SERVICE-<suffix>`; merged with the module's `addons` bucket by suffix (yours wins). **Removing an entry deletes that bucket** |
| `enable_nfs` | `true` | No | Mount the shared NFS share — Odoo's filestore, sessions and `odoo.conf` live there; keep it on |
| `nfs_mount_path` | `/mnt` | Yes | Mount point; Odoo's configuration expects `/mnt` — leave it |
| `nfs_instance_name` | `""` | Yes | Use a specific NFS VM instead of discovery |
| `nfs_instance_base_name` | `app-nfs` | Yes | Base name for an inline NFS VM (standalone deployments only) |
| `gcs_volumes` | `[]` | Yes | GCS Fuse mounts. **Passing any entry replaces the module's default `addons` mount** at `/mnt/extra-addons`, so restate it |
| `manage_storage_kms_iam` | `false` | No | Create a storage CMEK key and encrypt the buckets with it |
| `enable_artifact_registry_cmek` | `false` | No | Create an Artifact Registry CMEK key |

#### Step 1 — Configure

```hcl
create_cloud_storage = true
storage_buckets = [
  { name_suffix = "data" },                                   # keep the default bucket
  { name_suffix = "addons", versioning_enabled = true },      # override the module's addons bucket
  { name_suffix = "media", storage_class = "STANDARD" },      # a new bucket for the extra mount
]
gcs_volumes = [
  # 1. Restate the module's default, or Odoo loses /mnt/extra-addons
  { name = "addons", mount_path = "/mnt/extra-addons", readonly = false,
    mount_options = ["implicit-dirs", "metadata-cache-ttl-secs=60"] },
  # 2. A new mount; bucket_name empty = derived from storage_buckets entry "media"
  { name = "media", bucket_name = "", mount_path = "/mnt/gcs-media", readonly = false },
]
```

#### Step 2 — Apply

Creates `gcs-$SERVICE-media`, turns on versioning for `addons`, and rolls a new revision with the
extra volume. About 3–5 minutes.

#### Step 3 — Verify

```bash
gcloud storage buckets list --project="$PROJECT" --format="table(name,versioning_enabled)" | grep "$SERVICE"
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=export \
  | grep -E "bucketName|mountPath"
# expect gcs-$SERVICE-addons at /mnt/extra-addons, gcs-$SERVICE-media at /mnt/gcs-media,
# the NFS volume at /mnt, and /cloudsql
```

**Write-restart-read on the filestore.** In Odoo, open **Contacts**, create a contact and attach
a small file in the chatter. Then force a new revision and read it back:

```bash
gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --update-env-vars=LAB_RESTART="$(date +%s)"
```

Reload the contact and download the attachment: it must still open. Attachments live in
`/mnt/filestore` on NFS, not in the container, so they survive revisions and scale-to-zero. (The
next **Update** removes the `LAB_RESTART` variable again; that is harmless.)

#### Explore further

- Upload a custom Odoo module to the addons bucket
  (`gcloud storage cp -r my_module "gs://gcs-$SERVICE-addons/"`), restart as above, then in Odoo
  enable developer mode and **Apps → Update Apps List** — it appears because `/mnt/extra-addons`
  is on Odoo's addons path.
- `manage_storage_kms_iam = true` encrypts the buckets with a customer-managed key; check with
  `gcloud storage buckets describe "gs://gcs-$SERVICE-data" --format="value(default_kms_key)"`.

#### Watch out for

- Leaving `addons` out of `gcs_volumes` silently drops `/mnt/extra-addons` from the revision;
  custom modules disappear from Odoo.
- Removing an entry from `storage_buckets` (including the default `data`) deletes that bucket and
  its contents (`force_destroy` defaults to true).
- Do not turn `enable_nfs` off or move `nfs_mount_path`: the start-up script writes `odoo.conf`
  and the filestore under `/mnt`, and without the share every attachment is lost on restart.

#### Revert

```hcl
storage_buckets = [{ name_suffix = "data" }]
gcs_volumes     = []
```

This deletes `gcs-$SERVICE-media` and returns the addons mount to the module default (versioning
on `addons` goes back to off).

---

### Lab 12 — Database Backend (Group 12)

> **Objective:** rotate Odoo's database password automatically and confirm a rotation reaches
> Odoo without an outage.

**You will:** enable the rotation machinery · trigger a rotation on demand · roll a fresh
revision and confirm Odoo reconciles its config · understand which database fields are fixed.
**Time:** 25–30 min · **Cost:** negligible (a scale-to-zero dispatcher and a job) · **Prerequisites:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Yes | Fixed for Odoo: the Odoo configuration pins PostgreSQL, so this field does not change the engine (it only feeds plan-time checks). Odoo cannot run on MySQL |
| `application_database_name` | `odoo` | Yes | Kept for compatibility and inert: the real database name is derived from `$SERVICE` |
| `application_database_user` | `odoo` | Yes | Kept for compatibility and inert: the real user name is derived from `$SERVICE` |
| `database_password_length` | `32` | No | Length of the generated password (16–64). Changing it on a running deployment replaces the password |
| `enable_auto_password_rotation` | `false` | Yes | Deploys a rotator job (`$SERVICE-pw-rotator`) and dispatcher, triggered on `secret_rotation_period` (Lab 6) |
| `rotation_propagation_delay_sec` | `90` | Yes | Seconds the rotator waits after writing the new version before disabling the old one |

#### Step 1 — Configure

```hcl
enable_auto_password_rotation  = true
rotation_propagation_delay_sec = 120
# secret_rotation_period (Group 6) stays "2592000s" = every 30 days
```

#### Step 2 — Apply

About 15–20 new resources: the rotator job and its service account, a scale-to-zero dispatcher
service (`$SERVICE-rot-dispatch`), an Eventarc trigger and Pub/Sub wiring. About 5 minutes.

#### Step 3 — Verify

```bash
gcloud run jobs describe "$SERVICE-pw-rotator" --project="$PROJECT" --region="$REGION" --format="value(name)"
DB_SECRET=$(gcloud secrets list --project="$PROJECT" --format="value(name)" --filter="name~$SERVICE$" | head -1)
gcloud secrets versions list "$DB_SECRET" --project="$PROJECT"        # note the current version

# Rotate now instead of waiting 30 days
gcloud run jobs execute "$SERVICE-pw-rotator" --project="$PROJECT" --region="$REGION" --wait
gcloud secrets versions list "$DB_SECRET" --project="$PROJECT"        # a new ENABLED version; the old one DISABLED
```

The rotator changes the Cloud SQL password and writes a new secret version; it does not restart
Odoo. A running instance keeps the password it booted with, so start a fresh revision and check
that Odoo reconciled `odoo.conf` from the new secret:

```bash
gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --update-env-vars=LAB_RESTART="$(date +%s)"
gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=200 \
  | grep -E "Reconciled database connection settings|password authentication failed"
curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/web/login"     # expect 200
```

Expected: `Reconciled database connection settings in /mnt/odoo.conf.` and no
`password authentication failed` lines.

#### Explore further

- Look at the rotator's log for its numbered steps (find current version → generate → update
  Cloud SQL → write secret → wait → disable old):
  `gcloud logging read "resource.labels.job_name=\"$SERVICE-pw-rotator\"" --project="$PROJECT" --limit=30 --format="value(textPayload)"`.
- Confirm `application_database_name` is inert: the database Odoo uses is
  `gcloud sql databases list --instance="$INSTANCE" --project="$PROJECT" | grep -i odoo`, named
  after `$SERVICE` whatever this field says.

#### Watch out for

- **`database_password_length` is not update-safe.** Changing it writes a new password and
  destroys the old secret version. On Odoo, `db-init` runs on every apply and re-sets the role's
  password, so the database follows; the running instance still needs a fresh revision (as above).
  If authentication fails afterwards, re-run `gcloud run jobs execute "$SERVICE-db-init" ... --wait`.
- After every rotation, roll a fresh revision (or let scale-to-zero replace the instance) before
  the old version's connections are needed again.
- Never set `database_type` to MySQL or `NONE` for Odoo.

#### Revert

```hcl
enable_auto_password_rotation  = false
rotation_propagation_delay_sec = 90
```

The rotation resources are removed; the current password stays as it is.

---

### Lab 13 — Jobs & Scheduled Tasks (Group 13)

> **Objective:** add your own one-time and recurring jobs around Odoo without losing the
> module's essential `nfs-init` and `db-init` jobs.

**You will:** restate the default init jobs and chain a job after them · add a nightly job that
reports filestore size · run the scheduled job on demand.
**Time:** 25 min · **Cost:** small · **Prerequisites:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `initialization_jobs` | `[]` | Yes | One-time jobs (`$SERVICE-<name>`). Empty = the module's `nfs-init` + `db-init`. **Any entry replaces those defaults**, so restate them |
| `cron_jobs` | `[]` | Yes | Recurring jobs: a Cloud Run job `$SERVICE-<name>` triggered by Cloud Scheduler `$SERVICE-<name>-trigger` (UTC) |

#### Step 1 — Configure

```hcl
initialization_jobs = [
  { # restated default 1
    name = "nfs-init", description = "Initialize NFS directories with correct UID for Odoo"
    image = "alpine:3.19", mount_nfs = true, execute_on_apply = true
    command = ["/bin/sh", "-c"]
    args = ["mkdir -p /mnt/filestore /mnt/sessions /mnt/extra-addons && chown -R 101:101 /mnt/filestore /mnt/sessions /mnt/extra-addons && chmod -R 777 /mnt/filestore /mnt/sessions /mnt/extra-addons"]
    cpu_limit = "1000m", memory_limit = "512Mi"
  },
  { # restated default 2
    name = "db-init", description = "Create Odoo Database and User"
    image = "postgres:15-alpine", script_path = "../Odoo_Common/scripts/db-init.sh"
    depends_on_jobs = ["nfs-init"], execute_on_apply = true
    secret_env_vars = { DB_PASSWORD = "DB_PASSWORD", ROOT_PASSWORD = "ROOT_PASSWORD" }
    cpu_limit = "1000m", memory_limit = "512Mi", timeout_seconds = 600, max_retries = 1
  },
  { # your job, chained after db-init
    name = "lab-marker", description = "Write a marker to the NFS share"
    image = "alpine:3.19", mount_nfs = true, depends_on_jobs = ["db-init"], execute_on_apply = true
    command = ["/bin/sh", "-c"]
    args = ["date -u > /mnt/lab-marker.txt && echo 'lab init job ran' && cat /mnt/lab-marker.txt"]
    cpu_limit = "1000m", memory_limit = "512Mi"   # Cloud Run Jobs floor: 1 vCPU / 512Mi
  },
]
cron_jobs = [{
  name = "filestore-size", schedule = "17 3 * * *", image = "alpine:3.19"
  command = ["/bin/sh", "-c"], args = ["du -sh /mnt/filestore && ls /mnt/filestore"]
  mount_nfs = true, cpu_limit = "1000m", memory_limit = "512Mi"
}]
```

#### Step 2 — Apply

Creates `$SERVICE-lab-marker`, `$SERVICE-filestore-size` and the scheduler trigger, and runs the
init chain in order. About 5 minutes.

#### Step 3 — Verify

```bash
for J in nfs-init db-init lab-marker; do
  gcloud run jobs executions list --job="$SERVICE-$J" --project="$PROJECT" --region="$REGION" \
    --limit=1 --format="value(name,status.succeededCount,status.completionTime)"
done
gcloud logging read "resource.labels.job_name=\"$SERVICE-lab-marker\"" --project="$PROJECT" \
  --limit=10 --format="value(textPayload)"                       # "lab init job ran" + a timestamp

gcloud scheduler jobs describe "$SERVICE-filestore-size-trigger" --location="$REGION" --project="$PROJECT" \
  --format="value(schedule,state)"
gcloud scheduler jobs run "$SERVICE-filestore-size-trigger" --location="$REGION" --project="$PROJECT"
# after a minute:
gcloud logging read "resource.labels.job_name=\"$SERVICE-filestore-size\"" --project="$PROJECT" \
  --limit=10 --format="value(textPayload)"                       # the filestore size
```

Expected: each init job succeeded in chain order (`lab-marker` completes after `db-init`), the
scheduler is `ENABLED` with your cron, and the manual run logs the filestore size.

#### Explore further

- Set `paused = true` on the cron entry and re-apply: the scheduler job becomes `PAUSED`.
- Add `secret_env_vars` to a job to give it a secret, as `db-init` does.

#### Watch out for

- Passing `initialization_jobs` with only your own job **drops `nfs-init` and `db-init`**: a
  fresh deployment then has no database role and wrong NFS ownership. Always restate both.
- `script_path` is relative to the module directory, as shown.
- Init jobs bypass Odoo's container entrypoint; they are plain containers with your command.
- Cloud Run Jobs need at least 1 vCPU / 512Mi; smaller values are rejected.

#### Revert

```hcl
initialization_jobs = []
cron_jobs           = []
```

The module's defaults come back; your jobs and the trigger are deleted. Remove the marker if you
like by adding it to a later cron run, or leave it — it is a few bytes.

---

### Lab 14 — Observability & Health (Group 14)

> **Objective:** tune Odoo's probes to its boot time, get an uptime check that pages you, and add
> your own metric alert.

**You will:** inspect and adjust the live probes · create an uptime check on `/web/health` ·
add a request-volume alert.
**Time:** 20 min · **Cost:** small (uptime check; an always-on instance is required — see
below) · **Prerequisites:** `min_instance_count >= 1` (Lab 4) for the uptime check, and
`support_users` (Lab 2) if you want notifications.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `startup_probe` | TCP, delay 60 s, period 30 s, 3 failures | Yes | Live startup probe on port 8069 |
| `liveness_probe` | HTTP `/web/health`, delay 120 s, period 120 s, timeout 60 s, 3 failures | Yes | Live liveness probe |
| `startup_probe_config` | HTTP `/web/health`, delay 180 s | Yes | Not used by this module — the Odoo configuration uses `startup_probe` |
| `health_check_config` | HTTP `/web/health`, delay 30 s | Yes | Not used by this module — the Odoo configuration uses `liveness_probe` |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | No | Cloud Monitoring uptime check (created only when the deployed `min_instance_count >= 1`) |
| `alert_policies` | `[]` | Yes | Custom metric alerts sent to `support_users` |

#### Step 1 — Configure

```hcl
min_instance_count  = 1      # Group 4: a scale-to-zero service deliberately gets no uptime check
uptime_check_config = { enabled = true, path = "/web/health", check_interval = "60s", timeout = "10s" }
alert_policies = [{
  name               = "odoo-request-volume"
  metric_type        = "run.googleapis.com/request_count"
  comparison         = "COMPARISON_GT"
  threshold_value    = 10
  duration_seconds   = 300
  aggregation_period = "300s"
}]
liveness_probe = {
  enabled = true, type = "HTTP", path = "/web/health"
  initial_delay_seconds = 120, timeout_seconds = 60, period_seconds = 60, failure_threshold = 3
}
```

#### Step 2 — Apply

Creates the uptime check, its failure alert (when `support_users` is set) and your alert policy,
and rolls a new revision for the probe change. About 3–5 minutes.

#### Step 3 — Verify

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=export \
  | grep -E "startupProbe|livenessProbe|tcpSocket|httpGet|path:|periodSeconds|initialDelaySeconds"
gcloud monitoring uptime list-configs --project="$PROJECT" \
  --format="table(displayName,httpCheck.path,monitoredResource.labels.host,period)" | grep "$SERVICE"
gcloud alpha monitoring policies list --project="$PROJECT" --format="value(displayName,enabled)" | grep "$SERVICE"
```

Expected: the liveness probe shows `periodSeconds: 60`; an uptime check
`$SERVICE-uptime-check` on `/web/health` against the service host (or the load-balancer
hostname if Lab 10 is applied); a policy `$SERVICE-odoo-request-volume`. In the Console,
**Monitoring → Uptime checks** shows the check passing from several regions within a few minutes.

#### Explore further

- Set `min_instance_count = 0` and re-apply: the uptime check is removed. That is deliberate — a
  check against a scale-to-zero service either reports it down while it sleeps or keeps it warm
  and silently bills it as always-on.
- Edit `startup_probe_config` and watch nothing change on the revision — confirming which fields
  are live.

#### Watch out for

- Do not point an uptime check at `/healthz`: Cloud Run's front end answers that path itself, so
  an external check would fail forever while the service is healthy.
- Do not switch the startup probe to HTTP with a short delay: on first boot Odoo is installing
  `base` and HTTP is not reliable for several minutes.
- For `run.googleapis.com/request_latencies` (a distribution metric) set
  `per_series_aligner = "ALIGN_PERCENTILE_99"` (or another percentile) in the alert.

#### Revert

```hcl
uptime_check_config = { enabled = false, path = "/" }
alert_policies      = []
liveness_probe = {
  enabled = true, type = "HTTP", path = "/web/health"
  initial_delay_seconds = 120, timeout_seconds = 60, period_seconds = 120, failure_threshold = 3
}
min_instance_count  = 0      # only if you are not keeping Lab 4's warm instance
```

---

### Lab 21 — Redis Cache (Group 21)

> **Objective:** give Odoo a Redis endpoint using the Redis server co-hosted on the shared NFS VM,
> and verify exactly what the module wires.

**You will:** enable Redis with the automatic host · confirm the env vars and the `odoo.conf`
lines · understand when an explicit host or auth is needed.
**Time:** 15 min · **Cost:** none (Redis runs on the existing NFS VM) · **Prerequisites:** NFS on
(the default).

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_redis` | `false` | No | Inject Redis settings and write `redis_host`/`redis_port` into `odoo.conf` at boot |
| `redis_host` | `""` | Yes | Explicit host; empty = the NFS VM's IP (which runs Redis) |
| `redis_port` | `6379` | Yes | Redis port |
| `redis_auth` | `""` | Yes | Password (sensitive). Setting it injects `REDIS_AUTH` as a secret and stops injecting `REDIS_URL` |

#### Step 1 — Configure

```hcl
enable_redis = true
redis_host   = ""      # use the Redis on the shared NFS VM
redis_port   = "6379"
```

#### Step 2 — Apply

In-place update and a new revision; about 2–3 minutes.

#### Step 3 — Verify

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=export \
  | grep -E "name: (ENABLE_REDIS|REDIS_HOST|REDIS_PORT|REDIS_URL|NFS_SERVER_IP)" -A1
gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=200 \
  | grep -E "Configured Redis|Redis disabled"
```

Expected: `ENABLE_REDIS` is `true`; `REDIS_HOST` equals the NFS VM's internal IP (for example
`10.0.0.2`); `REDIS_URL` is `redis://<ip>:6379`; and the boot log says
`Configured Redis: host=<ip> port=6379`.

#### Explore further

- **What reads it.** Stock Odoo Community keeps its sessions under its data directory — here
  `/mnt/filestore/sessions` on the shared NFS share, which every instance already sees. The
  `redis_host`/`redis_port` lines in `odoo.conf` take effect only for an addon that reads those
  keys (the image ships the Python `redis` client for that purpose). Decide on Redis for your
  addons, not as a prerequisite for the share.
- Point `redis_host` at a Memorystore instance in the same VPC and confirm the env var and the
  boot log follow it.
- Set `redis_auth` and compare the env list: `REDIS_URL` disappears and `REDIS_AUTH` appears as
  a secret reference.

#### Watch out for

- `enable_redis = true` with an empty `redis_host` needs NFS (on, or discoverable); otherwise the
  plan fails, because the NFS VM is the fallback Redis host.
- With Filestore instead of the NFS VM there is no co-hosted Redis — set `redis_host` explicitly.

#### Revert

```hcl
enable_redis = false
redis_host   = ""
redis_auth   = ""
```

On the next boot the start-up script removes the stale `redis_*` lines from `odoo.conf` and logs
`Redis disabled`.

---

### Lab 22 — VPC Service Controls & Audit Logging (Group 22)

> **Objective:** record every data read and write against the project's APIs, and see how the
> module reports a VPC Service Controls perimeter it could or could not create.

**You will:** enable detailed audit logs and find them · request a dry-run perimeter and read
the module's honest outcome.
**Time:** 15–20 min · **Cost:** yes — DATA_READ/DATA_WRITE audit logs add log volume ·
**Prerequisites / external setup:** a VPC-SC perimeter needs the project to sit in an
**organisation** you can administer; folder-nested projects need `organization_id` set. These
fields are hidden on the form in RAD-managed projects.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_vpc_sc` | `false` | Yes | Create an access level and perimeter for this deployment |
| `vpc_cidr_ranges` | `[]` | Yes | CIDRs for the access level; empty = discovered from the VPC |
| `vpc_sc_dry_run` | `true` | Yes | Log violations instead of blocking them |
| `organization_id` | `""` | Yes | Needed when the project is in a folder |
| `enable_audit_logging` | `false` | No | DATA_READ, DATA_WRITE and ADMIN_READ audit logs for all services in the project |

#### Step 1 — Configure

```hcl
enable_audit_logging = true
enable_vpc_sc        = true    # try it; see what the module reports
vpc_sc_dry_run       = true    # never start with enforcement
vpc_cidr_ranges      = []
organization_id      = ""      # set it if your project is under a folder
```

#### Step 2 — Apply

Adds the project audit config and, if the organisation is reachable, an access level and a
dry-run perimeter. If the organisation cannot be discovered the apply prints
`WARNING: VPC Service Controls skipped — project is nested under a folder` and continues.
About 3–5 minutes.

#### Step 3 — Verify

```bash
gcloud projects get-iam-policy "$PROJECT" --format=json | jq '.auditConfigs'
# expect allServices with DATA_READ, DATA_WRITE, ADMIN_READ

gcloud logging read 'logName:"cloudaudit.googleapis.com%2Fdata_access"' \
  --project="$PROJECT" --limit=5 --format="value(protoPayload.methodName)"
```

Then compare the module outputs on the deployment page: `vpc_sc_enabled` tells you whether a
perimeter really exists (`false` when it was skipped, even though you asked for it), and
`audit_logging_enabled` should be `true`.

#### Explore further

- With an organisation: list the perimeter
  (`gcloud access-context-manager perimeters dry-run list --policy=<policy-id>`), exercise Odoo,
  and look for dry-run violations in Logging before ever setting `vpc_sc_dry_run = false`.

#### Watch out for

- The audit config is a **project-wide singleton** shared by every app that enables it; turning
  it off here turns it off for the project.
- Enforcing a perimeter (`vpc_sc_dry_run = false`) can block the platform's own calls; only do
  it after a clean dry-run period.

#### Revert

```hcl
enable_vpc_sc        = false
vpc_sc_dry_run       = true
enable_audit_logging = false
```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the service spec, so scaling is a configuration change, not a
   manual `gcloud` edit (a manual edit would be reverted on the next apply). See Lab 4 for the
   CPU-allocation choice that keeps Odoo's scheduled actions running.

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds and a new revision rolls out (Lab 3).

4. **Manage secrets, backups, and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --format="value(name)" | grep -E "$SERVICE|master-password"
   gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~^$SERVICE"
   gcloud storage ls -l "gs://gcs-$SERVICE-backups/backups/" | tail -5    # latest backups
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" \
     --filter="databaseVersion~POSTGRES" --limit=1)
   # Role and database are named after the service (hyphens → underscores), e.g. odoodemo1a2b3c4d.
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^odoo" --limit=1)
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" --format="value(name)" --filter="name~$SERVICE$" | head -1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"   # the password
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --database="$DB_USER" --project="$PROJECT"
   ```

6. **Restart Odoo cleanly** (for example after a secret change) by starting a fresh revision:

   ```bash
   gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --update-env-vars=LAB_RESTART="$(date +%s)"
   ```

   At every boot the start-up script reconciles `db_host`, `db_port`, `db_user`, `db_password`,
   `db_name` and `admin_passwd` in `/mnt/odoo.conf` from the injected values; other settings in
   that file persist on the NFS share between revisions.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   gcloud logging read "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\" AND severity>=WARNING" \
     --project="$PROJECT" --limit=20
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

   What you will see: Cloud Run request logs plus the start-up script's lines (`Reconciled
   database connection settings`, `Configured Redis` / `Redis disabled`, `Write access to
   /mnt/filestore verified`, `Starting Odoo server...`). The generated `odoo.conf` sets
   `logfile = /var/log/odoo/odoo.log`, so Odoo's own server log is written to a file inside the
   container rather than to Cloud Logging.

2. **Job logs** — init, backup, custom-SQL and rotation jobs log under `cloud_run_job`:

   ```bash
   gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name~\"^$SERVICE\"" \
     --project="$PROJECT" --limit=30 --format="table(timestamp,resource.labels.job_name,textPayload)"
   ```

3. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and CPU
   / memory utilisation. With `support_users` set (Lab 2) the module also creates CPU, memory and
   5xx alert policies; with `min_instance_count >= 1` and `uptime_check_config.enabled` (Lab 14)
   it creates an **uptime check** — confirm it is green under Monitoring → Uptime checks, and
   review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **First boot slow / health non-200:** Odoo is installing `base`; the startup probe is TCP on
  8069 (60 s delay) and the liveness probe calls `/web/health` after 120 s. Wait for both init jobs
  to succeed before expecting `/web/login` to answer.
- **`ERROR: Cannot write to /mnt/filestore`:** the NFS share is missing or owned wrongly. Check
  the last `$SERVICE-nfs-init` execution succeeded (and, if you passed `initialization_jobs`, that
  you restated `nfs-init` — Lab 13).
- **`password authentication failed`:** the database role and the secret disagree (a password
  length change, a rotation without a restart, or a restore). Re-run `db-init`, then roll a fresh
  revision:
  ```bash
  gcloud run jobs execute "$SERVICE-db-init" --project="$PROJECT" --region="$REGION" --wait
  gcloud run services update "$SERVICE" --project="$PROJECT" --region="$REGION" --update-env-vars=LAB_RESTART="$(date +%s)"
  ```
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-nfs-init" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **A 404 with no container logs** — tell the three apart by the page title: `404 Page not
  found` = ingress is `internal` or LB-only (Lab 5/10); Google's `Error 404 (Not Found)!!1` =
  the `allUsers` invoker binding is missing (`gcloud run services get-iam-policy`); Odoo's own 404
  page = wrong path.
- **Custom modules vanished from Apps:** `gcs_volumes` was set without restating the `addons`
  mount (Lab 11).
- **Cloud Armor probes still return 200:** WAF rules need 5–10 minutes after the apply (Lab 10).
- **Plan refused:** read the precondition message — it names the conflicting settings (min >
  max, CDN without Cloud Armor, IAP without users or consent screen, fence without
  `iam.denyAdmin`, custom SQL without bucket/path, NFS mount without NFS).
- **Quota exceeded on a new revision** (`Error code 9`): the region's Cloud Run CPU or memory quota
  is exhausted by always-on services; lower `min_instance_count` elsewhere and retry after a few
  minutes. Do not use `--scaling=0` to free quota — it pins a service at zero permanently.
- **Image build failed:** review Cloud Build history for the failed build's log
  (`gcloud builds list --project="$PROJECT" --region="$REGION" --limit=5`); an invalid
  `application_version` fails the nightly package download.
- **403 / permission errors:** verify the runtime service account's IAM roles — with a dedicated
  account (Lab 2), access is per secret and per bucket.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead (from the same **Delete** dialog) — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the deployment). This removes everything the module created — the Cloud Run service, Cloud
SQL database, Secret Manager secrets, the app's NFS subtree, GCS buckets (including the backup
bucket), jobs and schedules, any load balancer and Cloud Armor policy, the rotation machinery, and
a dedicated service account with its project roles. Resources owned by **Services_GCP** (the VPC,
shared Cloud SQL instance, NFS server, registry) are managed separately and are not removed here.

**Copy backups out first** — the backup bucket is deleted with the deployment.

**Remove what the feature labs created outside the module:**

```bash
gcloud secrets delete odoo-lab-marker --project="$PROJECT" --quiet            # Lab 6
gcloud storage rm -r "gs://odoo-lab-sql-$PROJECT"                              # Lab 9
# Lab 10: delete any DNS A record you created for a custom domain.
# Lab 5: an OAuth consent screen (brand) cannot be deleted; it is harmless to leave.
# Lab 22: if other apps rely on detailed audit logs, re-enable them on the project.
```

Confirm nothing app-scoped is left:

```bash
gcloud run services list --project="$PROJECT" --region="$REGION" | grep "$SERVICE"
gcloud storage buckets list --project="$PROJECT" --format="value(name)" | grep "$SERVICE"
gcloud secrets list --project="$PROJECT" --format="value(name)" | grep "$SERVICE"
# each should print nothing
```

---

## Appendix — Group 0 platform-wiring variables

These are never shown on the form; the platform or the wrapper sets them.

| Variable | Purpose |
|---|---|
| `module_description`, `module_documentation`, `module_dependency`, `module_services` | Catalogue text, docs link, dependency (`Services_GCP`) and service list |
| `credit_cost`, `require_credit_purchases` | Module fee band (110 credits) and credit check |
| `enable_purge`, `public_access`, `shared_users`, `technical_support_users` | Catalogue visibility, purge permission and support routing |
| `requires_services`, `require_services_gcp_module` | Shared services needed; fail the plan if Services_GCP is absent |
| `resource_creator_identity`, `impersonation_service_account` | Identity Terraform and helper scripts run as |
| `container_build_config` | Declared but unused — Odoo's build config comes from the Odoo configuration |
| `max_revisions_to_retain`, `binauthz_evaluation_mode`, `additional_services` | Declared but not referenced by this module |
| `additional_containers` | In-revision sidecars (none for Odoo) |
| `db_host_env_var_name`, `db_user_env_var_name`, `db_name_env_var_name`, `db_port_env_var_name`, `db_password_env_var_name`, `service_url_env_var_name` | Extra alias names for the injected DB/URL env vars (empty for Odoo) |
| `enable_postgres_extensions`, `postgres_extensions`, `enable_mysql_plugins`, `mysql_plugins` | Extension/plugin installation (unused for Odoo) |
| `job_execution_wait_timeout` | Seconds an apply waits for a job execution (900) |
| `module_writable_secret_ids` | Secrets the workload may write back (none for Odoo) |
| `network_name`, `prereq_subnet_cidr_override` | VPC selection / inline subnet override |
| `nfs_volume_name` | Volume name for the NFS mount (`nfs-data-volume`) |
| `sql_instance_name`, `sql_instance_base_name` | Target or inline Cloud SQL instance name |

---

## Summary

| Task / Lab | Group | Type | Outcome |
|---|---|---|---|
| Task 1 — Deploy | 1 | Automated | Module provisions Cloud Run, Cloud SQL database, NFS subtree, buckets, secrets, and runs nfs-init + db-init |
| Task 2 — Access & verify | — | Manual | `/web/health` and `/web/login` 200; first sign-in as `admin` and password changed; master password located |
| Lab 2 — Environment & isolation | 2 | Feature | Alerts and labels in place; Odoo runs as a dedicated least-privilege account; fence understood |
| Lab 3 — Application identity & version | 3 | Feature | Service text changed; image rebuilt on a chosen Odoo channel |
| Lab 4 — Runtime & scaling | 4 | Feature | 2 vCPU / 4 GiB, always-on CPU, warm instance, traffic split verified on the revision |
| Lab 5 — Ingress, VPC & IAP | 5 | Feature | Internal ingress 404 observed; IAP guardrails understood or IAP in front of Odoo |
| Lab 6 — Env vars & secrets | 6 | Feature | Plain and secret env vars on the container; credential-named value moved to Secret Manager |
| Lab 7 — Backup & maintenance | 7 | Feature | Schedule/retention changed; on-demand backup archive with database + filestore; import path understood |
| Lab 8 — CI/CD & Binary Authorization | 8 | Feature | Binary Authorization enforced on the service; CI/CD wiring understood |
| Lab 9 — Custom SQL scripts | 9 | Feature | Two ordered scripts executed against Odoo's database |
| Lab 10 — Cloud Armor & domains | 10 | Feature | HTTPS via load balancer and nip.io; XSS/SQLi blocked with 403; CDN on |
| Lab 11 — Storage & NFS | 11 | Feature | Extra bucket and mount added with the addons mount kept; filestore survives a restart |
| Lab 12 — Database backend | 12 | Feature | Password rotated; fresh revision reconciled `odoo.conf` with no auth failures |
| Lab 13 — Jobs & scheduled tasks | 13 | Feature | Defaults restated, chained init job and filestore-size cron verified |
| Lab 14 — Observability & health | 14 | Feature | Probes tuned; uptime check and custom alert live |
| Lab 21 — Redis | 21 | Feature | Redis host injected and written to `odoo.conf`; boot log confirms |
| Lab 22 — VPC-SC & audit logging | 22 | Feature | Data-access audit logs flowing; VPC-SC outcome read from outputs |
| Task 3 — Operate | — | Manual | Inspect revisions, scale, update version, manage secrets/backups/jobs, DB access, clean restart |
| Task 4 — Observe | — | Manual | Service and job logs; metrics, alert policies and uptime check |
| Task 5 — Troubleshoot | — | Manual | Diagnose first boot, NFS, auth drift, init jobs, 404 types, WAF timing, quota, build and IAM issues |
| Task 6 — Tear down | — | Automated | Delete (Trash) removes all module resources; lab-created extras removed by hand |
