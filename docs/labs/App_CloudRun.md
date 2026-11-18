---
title: "App CloudRun \u2014 Lab Guide"
description: "Hands-on labs: deploy a baseline, then pick feature labs for every configuration group — each with an objective, tested settings, verification, pitfalls and revert steps — plus operations, observability and teardown."
---

# App CloudRun — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/App_CloudRun)**

## Overview

**Estimated time:** core path (Tasks 1–2) ~45–60 minutes; each feature lab 10–40 minutes; all labs and tasks ~10–12 hours.

`App CloudRun` is the **foundation deployment engine** for all Cloud Run application modules in this platform. It provisions a production-ready Cloud Run v2 service for any containerised workload — complete with optional Cloud SQL (PostgreSQL, MySQL, or SQL Server), NFS shared storage, GCS buckets and GCS Fuse mounts, Secret Manager, Cloud Build CI/CD and Cloud Deploy, Cloud Monitoring, Identity-Aware Proxy, and an optional Global HTTPS Load Balancer with Cloud Armor WAF and CDN. Application modules such as `Django_CloudRun` and `Ghost_CloudRun` call this engine internally; you can also deploy it directly, as this lab does.

Deployed on its own, the module builds and runs a **built-in sample Flask application** (from the module's `scripts/` directory: `app.py` plus a `Dockerfile` based on `python:3.11-slim`, served by gunicorn on port `8080`). It gives you real endpoints to test against:

| Endpoint | What it returns | Why it is useful in this lab |
|---|---|---|
| `/` | `Hello from Sample App! Visitor count: N` — increments a counter row in PostgreSQL | Proves the whole chain: ingress → container → Cloud SQL. If the database is unreachable it still answers 200 but says `(DB unavailable: …)`, so **read the body, not just the status code**. |
| `/db` | JSON `{"status": "connected", "version": "PostgreSQL …"}`, or HTTP 500 with the error | A direct database connectivity check. |
| `/whoami` | JSON with `remote_addr`, the forwarding headers (`X-Forwarded-For`, `Forwarded`, …) and the *names* of all request headers | Shows exactly what the platform's front end delivers to the container. |
| `/healthz` | JSON `{"status": "healthy"}` | Used by the startup and liveness probes. **Through the public `*.run.app` URL it returns Google's 404**, because Cloud Run's front end answers `/healthz` itself — probes bypass the front end and see the app's 200. Never point an external check at `/healthz`. |

The sample app speaks **PostgreSQL only**; its `db-init` job (image `postgres:15-alpine`) creates the user, database and `visitors` table.

This lab is about operating the **Cloud Run module and the Google Cloud platform**, not the workload inside the container. Every input is documented, group by group, in the [Configuration Guide](https://docs.radmodules.dev/docs/modules/App_CloudRun); this lab shows you how to *exercise* each group and prove it worked.

> **This lab deploys onto a `Services_GCP` foundation.** Use the **same `tenant_id`** as your `Services_GCP` deployment so `App CloudRun` auto-discovers and binds to the shared VPC, Cloud SQL instance, NFS server, and Artifact Registry instead of provisioning its own inline copies. (Standalone deployment — with `require_services_gcp_module = false` — is supported, but the point of this lab is to exercise the foundation.)

> **Inputs are validated at plan time.** The module rejects invalid values and invalid feature combinations — a read-replica with no primary, IAP with no authorized users, a `gen1` runtime with NFS, a `mount_nfs` job with `enable_nfs = false`, a `prebuilt` image source with no image, CDN without Cloud Armor, `database_type = "NONE"` with the Cloud SQL volume still on — *before* anything is created, with a clear error naming the variable. You will see a fast, explicit failure rather than a half-built deployment. The [Configuration Guide's *Configuration Pitfalls*](https://docs.radmodules.dev/docs/modules/App_CloudRun) table marks which combinations are caught this way.

### How this lab is organised

- **Part 1 — Core (Tasks 1–2).** Deploy a baseline and verify it. Everyone does this; every feature lab starts from it.
- **Part 2 — Feature labs.** One lab per variable group of the deploy form (Lab 2 = Group 2, Lab 3 = Group 3, …, Lab 18 = Group 18), plus **Lab I** for the isolation settings that carry no group. After the baseline they are independent of each other: run them in any order, and pick only the ones you care about from the menu below. Each lab states its objective, time, cost and prerequisites, and ends with a **Revert** step.
- **Part 3 — Operate, observe, troubleshoot, tear down (Tasks 3–6).**

### Lab menu

| Lab | Group | Objective (what you will be able to do) | Time | Adds cost? | External setup |
|---|---|---|---|---|---|
| [Lab 2](#lab-2--support-users--resource-labels-group-2) | 2 | Route Cloud Monitoring alerts to your team and label every resource for cost attribution, then read both back | 10–15 min | No | None |
| [Lab 3](#lab-3--application-identity-group-3) | 3 | Rename the app's display name/description, bump `application_version` and trace the new image and revision it produces | 15 min | No | None |
| [Lab 4](#lab-4--runtime--scaling-group-4) | 4 | Size and scale the service (min/max instances, CPU/memory, billing mode, timeout), switch image source, and split traffic between revisions | 30–40 min | Yes, while `min_instance_count ≥ 1` | None |
| [Lab 5](#lab-5--environment-variables--secrets-group-5) | 5 | Inject plain and Secret Manager environment variables, watch a credential-named variable get moved into Secret Manager automatically, and label/annotate the service | 20–30 min | No | Create one secret (shown) |
| [Lab 6](#lab-6--initialization-jobs--health-checks-group-6) | 6 | Tune startup/liveness probes, create an uptime check that actually works on Cloud Run, add a latency alert, and extend the init-job chain without losing `db-init` | 30–40 min | Small (uptime check needs an always-on instance) | None |
| [Lab 7](#lab-7--cron-jobs-additional-services--sidecars-group-7) | 7 | Add a scheduled Cloud Run Job, a sibling Cloud Run service and an in-revision sidecar, and prove the sibling is reachable only through the VPC | 30–40 min | Small | None |
| [Lab 8](#lab-8--cicd--github-integration-group-8) | 8 | Turn on Binary Authorization and read its enforcement back; walk through (or run) the GitHub → Cloud Build → Cloud Deploy pipeline | 20 min (BinAuthz) / 40+ min (CI/CD) | No | **[External setup required]** for CI/CD: GitHub repo + token or App installation |
| [Lab 9](#lab-9--storage--filesystem--nfs-group-9) | 9 | Move the NFS mount, then prove files on it survive a fresh container with a write-restart-read test | 20–30 min | No | None |
| [Lab 10](#lab-10--storage-filesystem--image-registry-group-10) | 10 | Create a versioned GCS bucket, mount it with GCS Fuse, and prove writes through the mount land in the bucket | 20–30 min | Low (bucket storage) | None (AR CMEK changes project KMS state) |
| [Lab 11](#lab-11--redis-cache-group-11) | 11 | See exactly which Redis variables the module injects, and how setting `redis_auth` changes them | 15 min | No | None |
| [Lab 12](#lab-12--database-backend-group-12) | 12 | Find the app's database and credentials, add env-var aliases for them, and run an automatic password rotation end to end | 30–40 min | Low | None |
| [Lab 13](#lab-13--backup--maintenance-group-13) | 13 | Reschedule the database backup, take one on demand, and restore the shipped validation dump into the database | 20–30 min | Low | None for the shipped sample dump |
| [Lab 14](#lab-14--custom-initialisation--sql-group-14) | 14 | Stage ordered SQL scripts in a bucket and have the module run them against the app database | 20–30 min | No | Upload two `.sql` files (shown) |
| [Lab 15](#lab-15--access--networking-group-15) | 15 | Restrict ingress, route all egress through the VPC, and tell the three Cloud Run 404s apart | 20–30 min | No | None |
| [Lab 16](#lab-16--identity-aware-proxy-group-16) | 16 | Put Google sign-in in front of the service and verify who may reach it | 20–30 min | No | **[External setup required]**: an OAuth consent screen (cannot be deleted once created) |
| [Lab 17](#lab-17--cloud-armor--cdn-group-17) | 17 | Front the service with a Global HTTPS Load Balancer, Cloud Armor WAF and CDN, and watch an XSS probe get blocked | 30–40 min | **Yes** (load balancer, policy) | None (custom domain optional: needs DNS) |
| [Lab 18](#lab-18--vpc-service-controls--audit-logging-group-18) | 18 | Enable detailed audit logging, and attempt a VPC-SC perimeter, reading back whether it was really created | 20–30 min | Yes (log volume) | **[External setup required]** for VPC-SC: a GCP organisation |
| [Lab I](#lab-i--isolation-in-a-shared-project-no-group) | — | Run the app as its own service account, grant it extra roles, and fence its secrets, buckets, service and jobs off from every other app in the project | 30–40 min | No | Fence only: `roles/iam.denyAdmin` at **organisation** scope |

> **Group numbers match the deploy form.** Each lab's group is the group heading you see on the RAD configuration form. The [Configuration Guide](https://docs.radmodules.dev/docs/modules/App_CloudRun) currently numbers this module's groups one lower (its Group 2 is the form's Group 3, and so on), and files `support_users` and `resource_labels` under its Group 1.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform onto a `Services_GCP` foundation and locate everything it provisions.
- Verify a deployment by reading the deployed objects back — not by trusting a green apply.
- Change any group of settings safely with **Update**, knowing which changes are update-safe and which replace resources.
- Exercise every configuration group: runtime and scaling, secrets, probes and monitoring, jobs and sibling services, CI/CD and Binary Authorization, NFS and GCS storage, Redis, the database and its password rotation, backups and restores, custom SQL, networking, IAP, Cloud Armor/CDN, VPC-SC and audit logging, and per-app isolation in a shared project.
- Operate, observe, troubleshoot and cleanly tear down the deployment.

## Prerequisites

- **Services_GCP** (provides the VPC, Cloud SQL, Artifact Registry, and shared
  service accounts this module depends on). You do not need to deploy this
  yourself first — the platform automatically detects whether it already exists
  in the target project and provisions it before this module if not (see Task
  1).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **Bringing your own project?** Before the first deploy into it, the deployment confirmation dialog asks you to prove you control it (**Get verification code**, run the commands it shows as a project Owner, then **Verify**) and to give the RAD deployment service account the **Owner** role. A project RAD creates for you needs neither.
- **Advanced mode for later changes.** The create form asks only for the first page of inputs (and, in a project RAD creates for you, little more than the tenant name and region). Every other input in the Configuration Guide — including the scaling and version inputs in the Day-2 tasks — is changed afterwards with **Update** on the deployment's page after ticking **Enable advanced mode**, which is open to every account while builds are included in the price (on a lab environment, only an administrator can use it). Updates never carry a module fee.
- **RAD platform access** with permission to deploy modules into the project.
- `curl` on your workstation (or use Cloud Shell, which has everything above).

Set these shell variables once; every task and lab below reuses them. Set `APP` and `TENANT` to the `application_name` and `tenant_id` you deploy with:

```bash
export PROJECT="<your-project-id>"
export REGION="us-central1"          # the region you deploy into
export APP="crapp"                   # application_name (default "crapp")
export TENANT="demo"                 # tenant_id — must match your Services_GCP deployment

# Run these AFTER Task 1 completes. The service is named
# <application_name><tenant_id><8-hex tenant hash>, e.g. crappdemo1a2b3c4d.
export SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
  --filter="metadata.name~^${APP}${TENANT}[0-9a-f]{8}$" \
  --format="value(metadata.name)" --limit=1)
export SERVICE_URL=$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT" --region="$REGION" --format="value(status.url)")
export TENANT_PREFIX="${SERVICE#$APP}"            # tenant + hash, e.g. demo1a2b3c4d
export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format="value(projectNumber)")
echo "Service: $SERVICE"; echo "URL: $SERVICE_URL"; echo "Tenant prefix: $TENANT_PREFIX"
```

Almost everything the module creates is named after `$SERVICE`: jobs are `$SERVICE-<job>`, buckets `gcs-$SERVICE-<suffix>`, the backup bucket `gcs-$SERVICE-backups`, the database and its user `$SERVICE` (hyphens become underscores), the database password secret `secret-<sql-instance>-$SERVICE`. The tenant-shared service account the app runs as is `cloudrun-sa-$TENANT_PREFIX`.

## How to change settings in the feature labs

- **Update with advanced mode.** On the **Deployments** page, open your deployment, click **Update**, tick **Enable advanced mode** so every group is shown, change the inputs the lab names, and submit. The update runs the same plan/apply pipeline as the first deploy, with real-time logs. The HCL snippets in each lab show the *values* to enter in the form; field names match the variable names.
- **Update-safe vs not.** Fields flagged update-safe (the **Update-safe** column in each lab's settings table) can be changed on a running deployment. Changing an **unflagged** field raises a warning that the change may destroy or replace resources — for example a bucket, the database password, or the load balancer. Read the lab's *Step 2 — Apply* before confirming. When the deployment's **Enforce Update Safe** option is on, unflagged fields are read-only and the lab cannot be run until it is turned off.
- **Plan-time rejection is expected and instructive.** Several labs ask you to submit an invalid combination on purpose (CDN without Cloud Armor, IAP without users). The update fails at *plan* with an error naming the variable and nothing is changed — that is the guardrail working.
- **One lab at a time.** Apply, verify, then **Revert** before starting the next lab — unless a lab says a later one builds on it. Passing a list such as `cron_jobs`, `initialization_jobs`, `storage_buckets` or `gcs_volumes` **replaces** the whole list, so restate any entries you want to keep.
- **Verify by reading the deployed object back.** A green apply proves only that Terraform finished. Every *Verify* step reads the live service, job, bucket, secret or policy, or exercises the endpoint. Group tests on this module found several settings that applied cleanly and did nothing; the read-back is the only reliable signal.
- **Group 0 variables are never shown on the form** — they are set by the platform or by a wrapper module. See the [Appendix](#appendix--group-0-platform-wiring-variables).

---

## Task 1 — Deploy the baseline [Automated]

### Step 1.0 — Choose the baseline settings

The baseline is deliberately minimal: the module defaults plus the Group 1 inputs. Group 1 (*Project & Identity*) has no separate lab — you set it here. Everything else stays at its default; support contacts and labels (Group 2) are Lab 2.

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `project_id` | *(required)* | No | The project everything is created in. |
| `tenant_id` | `"demo"` | No | 1–7 lowercase letters/digits; baked into every resource name and shared by every module of the tenant. **Must match your `Services_GCP` tenant.** |
| `region` | `"us-central1"` | No | Used only when the region cannot be discovered from the `Services_GCP` subnet. |

```hcl
project_id = "<your-project-id>"
tenant_id  = "demo"                # MUST match your Services_GCP deployment
region     = "us-central1"
```

What the defaults give you:

- **A custom build** of the sample Flask app (`container_image_source = "custom"`), pushed to the shared Artifact Registry and deployed as Cloud Run service `$SERVICE` on `gen2`, 1 vCPU / 512Mi, `min_instance_count = 0`, `max_instance_count = 1`, request-based CPU billing, ingress `all`.
- **A PostgreSQL database and user** inside the shared Cloud SQL instance (no new instance), the password in Secret Manager, the socket mounted at `/cloudsql`, and the `db-init` job run on every apply.
- **NFS** from the shared NFS server mounted at `/mnt/nfs`, and **Redis** wiring pointing at the same NFS VM (which co-hosts Redis).
- **A backup bucket** `gcs-$SERVICE-backups`, a daily backup job and its Cloud Scheduler trigger (02:00 UTC).
- Startup and liveness probes on `/healthz`; **no** uptime check (it is off by default and is only ever created for an always-on service).

### Step 1.1 — Deploy

1. Open **Solutions → Solution Catalog → RAD modules** in the RAD platform top navigation, open **App (Cloud Run)** from the **Platform Modules** list to start configuration, choose **Configuration Form** under *How would you like to configure this deployment?* (the form opens on the **Conversational Assistant** if you hold purchased credits or are a partner or administrator), set `project_id` and `tenant_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/App_CloudRun)
   documents every input by group, with defaults. Click **Deploy Module**, review the estimated cost in the **Deployment Confirmation** dialog when it appears and click **Submit** (if the dialog then adds a confirmation step, such as verifying a project you bring, complete it and click **Confirm**), which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, the database and user with their Secret Manager secret, NFS/Redis wiring and the backup bucket, builds the sample image with Cloud Build, and runs the `db-init` job before the service is created. With `Services_GCP` already present, a first deploy takes roughly **10–20 minutes**; if the platform must provision `Services_GCP` first (VPC, Cloud SQL, NFS VM), allow **20–35 minutes**.

3. When it completes, run the discovery block from **Prerequisites** to set `SERVICE`, `SERVICE_URL`, `TENANT_PREFIX` and `PROJECT_NUMBER`, then list what was created:

   ```bash
   gcloud run services list --project="$PROJECT" --region="$REGION" --filter="metadata.name~^$SERVICE"
   gcloud run jobs list     --project="$PROJECT" --region="$REGION" --filter="metadata.name~^$SERVICE"
   gcloud storage buckets list --project="$PROJECT" --filter="name~$SERVICE" --format="value(name)"
   gcloud secrets list --project="$PROJECT" --filter="name~$SERVICE" --format="value(name.basename())"
   gcloud scheduler jobs list --project="$PROJECT" --location="$REGION" --filter="name~$SERVICE"
   ```

   Expect the service `$SERVICE`; jobs including `$SERVICE-db-init`, `$SERVICE-db-create`, `$SERVICE-db-export` (backup) and `$SERVICE-nfs-setup`; the bucket `gcs-$SERVICE-backups`; the database password secret; and the `$SERVICE-backup-schedule` scheduler job.

---

## Task 2 — Access & verify the baseline [Manual]

1. **The app answers, and reaches its database.** Call `/`, not `/healthz` (Cloud Run's front end intercepts `/healthz` on the public URL):

   ```bash
   curl -s "$SERVICE_URL/"          # expect: Hello from Sample App! Visitor count: 1 (then 2, 3, …)
   curl -s "$SERVICE_URL/db"        # expect: {"status":"connected","version":"PostgreSQL 1x.x …"}
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/healthz"   # expect 404 — Google's page, not the app's
   ```

   The first request after idle may take a few seconds: `min_instance_count = 0` means the service scales to zero. A climbing visitor count is the end-to-end proof — container, Cloud SQL socket, credentials and schema all work.

2. **The service is bound to the foundation**, not to inline copies — the shared VPC and the shared Cloud SQL instance:

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml \
     | grep -E "cloudsql-instances|network-interfaces|vpc-access"
   ```

   Expect a `run.googleapis.com/cloudsql-instances` annotation naming `<project>:<region>:<instance>` and a network interface on the `Services_GCP` network.

3. **The injected wiring.** List the environment the container receives:

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="yaml(spec.template.spec.containers[0].env)"
   ```

   Expect `DB_HOST` = `/cloudsql/<project>:<region>:<instance>` (a socket directory), `DB_IP` (the instance's private IP), `DB_NAME` and `DB_USER` = `$SERVICE`, `DB_PORT` = `5432`, `DB_PASSWORD` as a secret reference, `CLOUDRUN_SERVICE_URL`, `NFS_SERVER_IP`, and `REDIS_HOST` / `REDIS_PORT` / `REDIS_URL`.

4. **The database and its secret.**

   ```bash
   export SQL_CONN=$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="value(spec.template.metadata.annotations['run.googleapis.com/cloudsql-instances'])")
   export SQL_INSTANCE="${SQL_CONN##*:}"
   gcloud sql databases list --instance="$SQL_INSTANCE" --project="$PROJECT" --filter="name=$SERVICE"
   gcloud sql users list --instance="$SQL_INSTANCE" --project="$PROJECT" --filter="name=$SERVICE"
   export DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~secret-.*-${SERVICE}$" --format="value(name.basename())" --limit=1)
   gcloud secrets versions list "$DB_SECRET" --project="$PROJECT"
   ```

5. **The init job ran.**

   ```bash
   gcloud run jobs executions list --job="$SERVICE-db-init" --project="$PROJECT" --region="$REGION" \
     --format="table(metadata.name,status.succeededCount,status.failedCount,status.completionTime)"
   ```

   Expect at least one execution with `succeededCount = 1`. Its logs end with `Sample DB Init complete.`

6. **NFS and the network path.** The NFS volume is mounted at `/mnt/nfs` and the service uses Direct VPC egress:

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml \
     | grep -B2 -A4 -i "nfs"
   ```

7. **What the front end delivers.** `/whoami` shows that Cloud Run appends your real client IP to `X-Forwarded-For` and `Forwarded`, and that `remote_addr` is a link-local front-end address:

   ```bash
   curl -s "$SERVICE_URL/whoami"
   ```

8. **The platform labels.** Every resource carries the reserved labels the platform sets:

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format="yaml(metadata.labels)"
   ```

   Expect `application`, `deployment`, `tenant`, `managed-by: app-cloudrun` and `module: app-cloudrun`. Lab 2 adds your own.

---

## Part 2 — Feature labs

Every lab assumes the baseline from Task 1 and the shell variables from **Prerequisites**. Values in the *Configure* snippets are the ones verified on a live deployment of this module, adjusted to use placeholders.

### Lab 2 — Support Users & Resource Labels (Group 2)

> **Objective:** make sure alerts reach a person, and that every resource the module creates can be attributed in billing and inventory.

**You will:** add yourself as a support contact and find the notification channel it creates · add your own labels and read them back from several resource types · see which label keys the platform reserves.
**Time:** 10–15 min · **Cost:** none · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `support_users` | `[]` | Yes | Emails that receive Cloud Monitoring alerts (one e-mail notification channel each). Grants no IAM. Alerts from Lab 6 (uptime check, `alert_policies`) go here. |
| `resource_labels` | `{}` | Yes | Labels on every resource the module creates. The keys `application`, `deployment`, `tenant`, `managed-by` and `module` are reserved and always overridden by the platform. |

#### Step 1 — Configure

```hcl
support_users   = ["<your-email>"]                               # receives every alert this module raises
resource_labels = { environment = "lab", cost-center = "training" }   # applied to every resource
```

#### Step 2 — Apply

**Update**. Creates one notification channel per e-mail and relabels the service, jobs, buckets and secrets in place (~2 min). No revision traffic is disrupted.

#### Step 3 — Verify

```bash
# Labels on the service, a job, a bucket and a secret
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format="yaml(metadata.labels)"
gcloud run jobs describe "$SERVICE-db-init" --project="$PROJECT" --region="$REGION" --format="yaml(metadata.labels)"
gcloud storage buckets describe "gs://gcs-$SERVICE-backups" --format=yaml | grep -A8 -i labels
gcloud secrets describe "$DB_SECRET" --project="$PROJECT" --format="yaml(labels)"

# The notification channel for your address
gcloud beta monitoring channels list --project="$PROJECT" --format="table(displayName,type,labels.email_address)"
```

Expect `environment: lab` and `cost-center: training` beside the reserved labels on each resource (`$DB_SECRET` is set in Task 2, step 4), and an `email` channel for your address.

#### Explore further

- Add `module = "mine"` to `resource_labels` and re-apply: the label still reads `module: app-cloudrun` — reserved keys cannot be overridden.
- Do Lab 6 next with an uptime check: its failure alert is delivered to this channel.

#### Watch out for

- Label values must be lowercase letters, digits, `_` or `-` (GCP label rules); an e-mail address is not a valid label value.
- `support_users` only routes alerts. It grants no access to the project.

#### Revert

```hcl
support_users   = []
resource_labels = {}
```

The notification channels are deleted and your labels removed; the reserved labels stay.

---

### Lab 3 — Application Identity (Group 3)

> **Objective:** change how the application is named and versioned, and trace a version bump through to a new image and revision.

**You will:** set a display name and description · bump `application_version` and watch a new build and revision roll out · confirm which name must never change.
**Time:** 15 min · **Cost:** none · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `application_name` | `"crapp"` | Yes (flag) — but see *Watch out for* | Base of every resource name (`$SERVICE`, jobs, buckets, secrets, database). 1–20 chars, lowercase, starts with a letter. |
| `application_display_name` | `"App_CloudRun Application"` | Yes | Human-readable name for the platform UI and dashboards. |
| `application_description` | `"App CloudRun Custom Application…"` | Yes | Description recorded on the Cloud Run service. |
| `application_version` | `"1.0.0"` | Yes | Image tag for the custom build; changing it triggers a new Cloud Build run and a new revision. Injected as `APP_VERSION`. |

#### Step 1 — Configure

```hcl
application_display_name = "App CloudRun (lab)"            # free text, safe to change any time
application_description  = "Foundation module lab walkthrough"
application_version      = "1.0.1"                         # was 1.0.0 — forces a new build + revision
```

#### Step 2 — Apply

**Update** with advanced mode. The version change runs Cloud Build (~3–5 min) and creates a new revision; the name fields update the service in place. Nothing is destroyed.

#### Step 3 — Verify

```bash
# Image tag and APP_VERSION follow application_version
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="value(spec.template.spec.containers[0].image)"          # expect …/crapp:1.0.1 (or @sha256 digest of it)
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -A1 APP_VERSION   # expect 1.0.1

# A new revision now serves 100% of traffic
gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="table(metadata.name,metadata.creationTimestamp,status.conditions[0].status)"

# Description recorded on the service
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml | grep -i description

# The build that produced it
gcloud builds list --project="$PROJECT" --region="$REGION" --limit=3 --format="table(id,status,createTime)"
```

The app still answers `curl -s "$SERVICE_URL/"` with an incrementing count — the database survives a new revision.

#### Explore further

- Set `application_version = "latest"` and re-apply: the tag `latest` is reused, so you cannot tell from the tag what is running. Read the image **digest** from the revision instead (`gcloud run revisions describe <rev> --format="value(status.imageDigest)"`).
- Re-apply with the *same* version: no new build or revision is created — a rebuild needs a version change.

#### Watch out for

- **Never change `application_name` (or `tenant_id`) after the first deploy**, even though the form does not warn. Both are embedded in every resource name; a change creates a brand-new service, database, buckets and secrets and orphans or destroys the old ones.
- `application_name` plus `tenant_id` must fit the 63-character naming budget — a plan-time check rejects names that are too long.

#### Revert

Restore `application_display_name = "App_CloudRun Application"` and the default description. Leave `application_version` at the bumped value (rolling back to `1.0.0` triggers another build), or set it back if you prefer.

---

### Lab 4 — Runtime & Scaling (Group 4)

> **Objective:** control how the container is sourced, sized, billed and scaled, and split traffic between revisions.

**You will:** keep one instance warm and allow two · switch to always-allocated CPU and a longer request timeout · resize CPU/memory · prune old revisions · split traffic with a tagged canary.
**Time:** 30–40 min · **Cost:** **yes** — `min_instance_count = 1` with `cpu_always_allocated = true` bills one vCPU continuously until you revert · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `deploy_application` | `true` | No | `false` provisions everything except the Cloud Run service (infrastructure-first). |
| `container_image_source` | `"custom"` | No | `custom` builds the sample app with Cloud Build; `prebuilt` deploys `container_image` as-is. |
| `container_image` | `""` | Yes | Image URI for `prebuilt` (required then — plan-time check), or the mirroring source. |
| `container_build_config` | `{ enabled = true }` | Yes | Dockerfile path/content, context, `build_args`, target repo, `base_image` for the custom build. |
| `enable_image_mirroring` | `true` | Yes | Copies an external image into Artifact Registry before deploying it. |
| `min_instance_count` | `0` | Yes | Instances kept warm. `0` = scale to zero. |
| `max_instance_count` | `1` | Yes | Scaling ceiling (cost cap). Must be ≥ min (plan-time check). |
| `cpu_always_allocated` | `false` | Yes | `true` = CPU between requests (instance-based billing); `false` = request-based. |
| `container_port` | `8080` | Yes | Port the app listens on — the sample listens on 8080. |
| `container_protocol` | `"http1"` | Yes | `http1` or `h2c` (end-to-end HTTP/2, e.g. gRPC). |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Yes | CPU/memory limits (optional `cpu_request`, `mem_request`). |
| `execution_environment` | `"gen2"` | Yes | `gen2` is required for NFS and GCS Fuse; `gen1` with either is rejected at plan. |
| `timeout_seconds` | `300` | Yes | Per-request timeout, 0–3600. |
| `enable_cloudsql_volume` | `true` | Yes | Mounts the Cloud SQL socket. Must be `false` when `database_type = "NONE"`. |
| `cloudsql_volume_mount_path` | `"/cloudsql"` | Yes | Where the socket directory appears. |
| `traffic_split` | `[]` | Yes | Traffic allocation across revisions; entries must sum to 100. |
| `max_revisions_to_retain` | `7` | Yes | Older revisions beyond this are pruned after each apply (0 = never prune). |

#### Step 1 — Configure

```hcl
min_instance_count      = 1          # one instance always warm: no cold starts (and it bills)
max_instance_count      = 2          # allow scale-out to two instances
cpu_always_allocated    = true       # CPU between requests; instance-based billing
timeout_seconds         = 600        # 10-minute request timeout
container_port          = 8080       # the sample app's real port — do not change
container_resources     = { cpu_limit = "1000m", memory_limit = "1Gi" }   # more memory
max_revisions_to_retain = 5          # keep at most 5 revisions
```

#### Step 2 — Apply

**Update**. All fields are update-safe: one new revision is created and traffic moves to it (~2–4 min). No build runs.

#### Step 3 — Verify

```bash
# Scaling, billing mode, environment and timeout on the live revision template
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml \
  | grep -E "minScale|maxScale|cpu-throttling|execution-environment|timeoutSeconds"
# expect minScale '1', maxScale '2', cpu-throttling 'false', execution-environment gen2, timeoutSeconds 600

# Resources actually applied to the container
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="yaml(spec.template.spec.containers[0].resources)"        # expect memory 1Gi, cpu 1000m

# Revision count stays at or below 5
gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION" --format="value(name)" | wc -l
```

With `min_instance_count = 1`, the first request after a long idle period no longer pays a cold start: `curl -s -w "\n%{time_total}s\n" "$SERVICE_URL/"`.

#### Explore further

- **Canary with a tagged URL.** Note the current and previous revision names (`gcloud run revisions list …`), then set:

  ```hcl
  traffic_split = [
    { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST",   percent = 90 },
    { type = "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION", percent = 10, revision = "<previous-revision-name>", tag = "canary" },
  ]
  ```

  Verify with `gcloud run services describe "$SERVICE" … --format="yaml(status.traffic)"`; the tagged revision gets its own URL (`https://canary---…run.app`). A split that does not sum to 100 is rejected at plan.
- **Prebuilt image.** Set `container_image_source = "prebuilt"` and `container_image = "us-docker.pkg.dev/cloudrun/container/hello"`; with mirroring on, the image is copied into Artifact Registry first (check the revision's image path). Leaving `container_image` empty fails the plan. Revert to `custom` afterwards — the sample endpoints only exist in the custom build.
- **Fractional CPU.** `container_resources = { cpu_limit = "500m", memory_limit = "512Mi" }` is accepted only with `cpu_always_allocated = false`; gen2 never goes below 512Mi.
- **`execution_environment = "gen1"`** with the default `enable_nfs = true` — submit it and read the plan-time error.

#### Watch out for

- `cpu_always_allocated = true` with `min_instance_count ≥ 1` holds a vCPU 24/7. Use it only for work that runs with no inbound request (schedulers, queue workers, WebSockets, slow first-boot setup).
- Every `additional_services` sibling inherits `cpu_always_allocated` (Lab 7), so its resources must then be at least 1000m/512Mi.
- `container_port` must match the port the app binds; a mismatch fails the startup probe and the revision never becomes ready.
- `max_revisions_to_retain` prunes only after a **successful** apply.

#### Revert

```hcl
min_instance_count      = 0
max_instance_count      = 1
cpu_always_allocated    = false
timeout_seconds         = 300
container_resources     = { cpu_limit = "1000m", memory_limit = "512Mi" }
max_revisions_to_retain = 7
traffic_split           = []
```

Reverting creates one more revision and returns the service to scale-to-zero (stops the continuous charge).

---

### Lab 5 — Environment Variables & Secrets (Group 5)

> **Objective:** deliver configuration and credentials to the container the right way, and see the module protect a credential you put in the wrong place.

**You will:** add plain environment variables · reference an existing Secret Manager secret · watch a credential-named plain variable get converted into a secret · add a custom service annotation and service labels.
**Time:** 20–30 min · **Cost:** none · **Prerequisites / external setup:** create one secret (Step 1).

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `environment_variables` | `{}` | Yes | Plain-text env vars. Visible to anyone who can read the service. |
| `secret_environment_variables` | `{}` | Yes | Env var name → **existing** secret name; resolved at instance start (`latest`). The module grants the service account access per secret. |
| `protect_sensitive_environment_variables` | `true` | Yes | Moves any non-empty `environment_variables` entry whose name looks like a credential (`…PASSWORD`, `…SECRET`, `…TOKEN`, `…API_KEY`, …) into Secret Manager and injects it as a secret under the same name. Hidden in RAD-managed projects. |
| `service_annotations` | `{}` | Yes | Annotations on the service. Keys under `run.googleapis.com/` are system annotations and are rejected by the API. |
| `service_labels` | `{}` | Yes | Labels on the Cloud Run service only (on top of `resource_labels`). |
| `secret_rotation_period` | `"2592000s"` | Yes | How often Secret Manager publishes a rotation *notification* for the module's secrets (the DB password). Must end in `s`. It does not rotate anything by itself — see Lab 12. |
| `secret_propagation_delay` | `30` | Yes | Seconds to wait after writing a secret before dependent resources use it. |

#### Step 1 — Configure

Create the secret the service will reference (a user-managed replica in your region, which satisfies location-restricting org policies):

```bash
printf 'lab-demo-value' | gcloud secrets create lab-api-key --project="$PROJECT" \
  --replication-policy=user-managed --locations="$REGION" --data-file=-
```

Then set:

```hcl
environment_variables = {
  LOG_LEVEL    = "info"                 # plain configuration
  LAB_PASSWORD = "not-a-real-secret"    # credential-named: will be moved into Secret Manager
}
secret_environment_variables = { API_KEY = "lab-api-key" }               # existing secret by NAME
service_annotations          = { "lab.example.com/owner" = "platform-team" }  # NOT run.googleapis.com/*
service_labels               = { tier = "frontend" }
secret_propagation_delay     = 45
```

#### Step 2 — Apply

**Update**. Creates one new secret for `LAB_PASSWORD`, IAM grants on both secrets, and a new revision (~3 min).

#### Step 3 — Verify

```bash
# Plain vs secret-backed variables on the live revision
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -A4 -E "LOG_LEVEL|LAB_PASSWORD|API_KEY"
# expect LOG_LEVEL with a plain value; LAB_PASSWORD and API_KEY with valueFrom.secretKeyRef

# The secret the module created for LAB_PASSWORD
gcloud secrets list --project="$PROJECT" --filter="name~${SERVICE}-env-lab-password" --format="value(name.basename())"

# The service account was granted access to your secret
gcloud secrets get-iam-policy lab-api-key --project="$PROJECT" --format="table(bindings.role,bindings.members)"

# Annotation and labels
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="yaml(metadata.annotations,metadata.labels)" | grep -E "lab.example.com|tier"
```

`LAB_PASSWORD`'s value no longer appears anywhere in the service description — only a secret reference does — yet the container still sees `LAB_PASSWORD=not-a-real-secret`.

#### Explore further

- Reference a secret that does not exist (`{ MISSING = "no-such-secret" }`) and read the failure — referenced secrets must exist before deployment.
- Change `secret_rotation_period` to `"604800s"` (7 days) and check `gcloud secrets describe "$DB_SECRET" --project="$PROJECT" --format="yaml(rotation,topics)"`. Try `"604800"` without the `s` to see the plan-time format check.
- Name a variable `SMTP_PASSWORD_SECRET_NAME`: names like `*_SECRET_NAME`, `*_SECRET_ID`, `*_KEY_ID` and `*_PUBLIC_KEY` are deliberately left as plain text.

#### Watch out for

- A `run.googleapis.com/…` key in `service_annotations` fails the apply — those are system annotations.
- Secret values are read at **instance start**; adding a new secret version does not reach running instances until a new instance starts.
- `secret_rotation_period` only schedules a notification. Without `enable_auto_password_rotation` (Lab 12) nothing is rotated.

#### Revert

Set `environment_variables = {}`, `secret_environment_variables = {}`, `service_annotations = {}`, `service_labels = {}`, `secret_propagation_delay = 30`, and apply. Then delete the secret you created yourself: `gcloud secrets delete lab-api-key --project="$PROJECT"`. The module-created `LAB_PASSWORD` secret is removed by the apply.

---

### Lab 6 — Initialization Jobs & Health Checks (Group 6)

> **Objective:** control what runs before the service starts and how its health is judged — the init-job chain, tuned probes inside Cloud Run, an external uptime check that actually works, and an alert that reaches you.

**You will:** add a second init job after `db-init` without losing it · tune the startup probe · create an uptime check on the right path · add a latency alert policy · see why a scale-to-zero service gets no uptime check.
**Time:** 30–40 min · **Cost:** small — the uptime check requires `min_instance_count ≥ 1` · **Prerequisites / external setup:** `support_users` set (Lab 2) to receive alert e-mail.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `initialization_jobs` | `[{ name = "db-init", image = "postgres:15-alpine", script_path = "scripts/db-init.sh", execute_on_apply = true }]` | Yes | Cloud Run Jobs (`$SERVICE-<name>`) run during deployment, before the service is created, ordered by `depends_on_jobs`. Supplying the list **replaces** the default `db-init`. |
| `startup_probe_config` | `{ enabled = true, path = "/healthz" }` | Yes | Gate before an instance gets traffic. Fields: `type` (HTTP/TCP), `path`, `initial_delay_seconds` (10), `timeout_seconds` (5), `period_seconds` (10), `failure_threshold` (10). |
| `prereq_subnet_cidr_override` | `""` | No | Primary subnet CIDR of the **inline** VPC (standalone mode only). Empty = a unique /24 derived per deployment. Ignored on a `Services_GCP` foundation, so this lab does not change it. |
| `health_check_config` | `{ enabled = true, path = "/healthz" }` | Yes | Liveness probe; restarts the container after `failure_threshold` (3) failures every `period_seconds` (30). |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | No | Cloud Monitoring uptime check from global locations (`check_interval` 60s, `timeout` 10s). Created **only** when the deployed `min_instance_count ≥ 1` and the endpoint is public. |
| `alert_policies` | `[]` | Yes | Metric-threshold alert policies notifying `support_users`. Fields: `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`, `aggregation_period`, `per_series_aligner` (default `ALIGN_MEAN`). |

#### Step 1 — Configure

```hcl
# The list REPLACES the default, so restate db-init and chain a second job after it
initialization_jobs = [
  { name = "db-init", image = "postgres:15-alpine", command = ["/bin/sh"],
    script_path = "scripts/db-init.sh", execute_on_apply = true },
  { name = "post-init", image = "busybox:1.36", command = ["sh", "-c"],
    args = ["echo post-init ran"], depends_on_jobs = ["db-init"], execute_on_apply = true },
]
min_instance_count = 1          # Group 4 — REQUIRED for an uptime check; scale-to-zero services get none
startup_probe_config = {
  enabled = true, type = "HTTP", path = "/healthz",     # probes bypass the front end: /healthz is fine here
  initial_delay_seconds = 15, timeout_seconds = 5, period_seconds = 10, failure_threshold = 12
}
# "/" NOT "/healthz": the uptime check goes THROUGH Cloud Run's front end, which answers /healthz itself (404)
uptime_check_config = { enabled = true, path = "/", check_interval = "60s", timeout = "10s" }
alert_policies = [{
  name               = "high-latency"
  metric_type        = "run.googleapis.com/request_latencies"
  comparison         = "COMPARISON_GT"
  threshold_value    = 1000          # ms
  duration_seconds   = 300
  aggregation_period = "60s"
  per_series_aligner = "ALIGN_PERCENTILE_99"   # REQUIRED: latency is a DISTRIBUTION metric
}]
```

#### Step 2 — Apply

**Update**. Runs `db-init` then `post-init`, creates a new revision (probe change), an uptime check and its failure alert, and the alert policy (~4 min).

#### Step 3 — Verify

```bash
# Both init jobs exist and ran, post-init after db-init
gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~^$SERVICE-(db-init|post-init)$"
gcloud run jobs executions list --job="$SERVICE-post-init" --project="$PROJECT" --region="$REGION" \
  --format="table(metadata.name,status.succeededCount,status.completionTime)"
gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$SERVICE-post-init\"" \
  --project="$PROJECT" --limit=5 --format="value(textPayload)"          # expect: post-init ran

# Probe settings on the live revision
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="yaml(spec.template.spec.containers[0].startupProbe,spec.template.spec.containers[0].livenessProbe)"
# expect startupProbe failureThreshold 12, initialDelaySeconds 15, httpGet path /healthz

# Uptime check exists, probing "/" on the run.app host
gcloud monitoring uptime list-configs --project="$PROJECT" \
  --format="table(displayName,httpCheck.path,period,monitoredResource.labels.host)" | grep -i "$SERVICE"

# Alert policies
gcloud alpha monitoring policies list --project="$PROJECT" --format="table(displayName,enabled)" | grep -iE "high-latency|$SERVICE"
```

Compare the `completionTime` of the latest `$SERVICE-db-init` and `$SERVICE-post-init` executions: `post-init` finishes after `db-init`. The app still counts visitors (`curl -s "$SERVICE_URL/"`), proving `db-init` survived the replacement. In the console, **Monitoring → Uptime checks** should turn green within a few minutes. You can confirm why the path matters from your workstation: `curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"` returns 200 while `…/healthz` returns 404.

#### Explore further

- Set `min_instance_count = 0` with the uptime check still enabled and apply: the uptime check is **removed**. This is deliberate — a check against a scale-to-zero service either reports it down on every cold start or keeps it warm and silently changes its cost.
- Make the startup probe fail on purpose (`path = "/does-not-exist"`): the new revision never becomes ready, traffic stays on the old one, and the apply reports the failure. Revert straight away.
- Switch the startup probe to `type = "TCP"` — the choice for apps with no cheap HTTP health endpoint.
- Set `execute_on_apply = false` on `post-init`: the job is still created, but the apply no longer runs it; run it yourself with `gcloud run jobs execute "$SERVICE-post-init" --project="$PROJECT" --region="$REGION" --wait`.

#### Watch out for

- **Supplying `initialization_jobs` without `db-init` removes the sample database setup** from future applies — nothing in the plan flags it.
- Cloud Run Jobs need at least 1 vCPU / 512Mi; init jobs complete before the service is created on Cloud Run.
- An uptime check on `/healthz` through a `run.app` URL fails forever while the service is healthy.
- `request_latencies` with the default `ALIGN_MEAN` (or `ALIGN_DELTA`) is rejected by Cloud Monitoring — use an `ALIGN_PERCENTILE_*` aligner. Thresholds are evaluated per revision, not per service.
- A slow liveness endpoint causes false restarts; keep it trivial.
- `prereq_subnet_cidr_override` matters only for a standalone deployment that owns its own VPC; changing it there replaces the subnet.

#### Revert

```hcl
initialization_jobs  = [{ name = "db-init", image = "postgres:15-alpine", command = ["/bin/sh"],
                          script_path = "scripts/db-init.sh", execute_on_apply = true }]
min_instance_count   = 0
startup_probe_config = { enabled = true, path = "/healthz" }
uptime_check_config  = { enabled = false, path = "/" }
alert_policies       = []
```

The `post-init` job, the uptime check, its alert and the policy are deleted; the service returns to scale-to-zero.

---

### Lab 7 — Cron Jobs, Additional Services & Sidecars (Group 7)

> **Objective:** run work beside the main service — a scheduled job, a sibling Cloud Run service and an in-revision sidecar — and prove how the sibling can be reached.

**You will:** add a Cloud Scheduler–triggered job · deploy a sibling service and see its URL injected · add a sidecar container · prove the sibling is reachable from inside the VPC.
**Time:** 30–40 min · **Cost:** small (one extra service, scale-to-zero) · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `cron_jobs` | `[]` | Yes | Cloud Run Jobs (`$SERVICE-<name>`) triggered by Cloud Scheduler (`$SERVICE-<name>-trigger`). `paused = true` keeps the job but stops the schedule. |
| `additional_services` | `[]` | Yes | Separate Cloud Run services named `$SERVICE-<name>`. Their URL is injected into the main container as `<NAME>_URL` (or `output_env_var_name`). Default ingress is internal-only. |
| `additional_containers` | `[]` | Yes | Sidecar containers in the **same** revision, sharing `localhost`. `startup_tcp_port` makes the main container wait for the sidecar. |

#### Step 1 — Configure

First get the sibling's future URL form: it is `https://$SERVICE-api-$PROJECT_NUMBER.$REGION.run.app`. Print it and paste it into the cron job below:

```bash
echo "https://${SERVICE}-api-${PROJECT_NUMBER}.${REGION}.run.app/"
```

```hcl
additional_services = [{
  name  = "api"                 # becomes service $SERVICE-api, URL injected as API_URL
  image = "nginx:alpine"
  port  = 80
}]

additional_containers = [{
  name    = "sidecar"           # runs inside the main revision
  image   = "curlimages/curl:8.11.1"
  command = ["sh", "-c"]
  args    = ["while true; do sleep 3600; done"]
}]

cron_jobs = [{
  name     = "sibling-probe"    # job $SERVICE-sibling-probe, trigger $SERVICE-sibling-probe-trigger
  schedule = "0 3 * * *"        # daily 03:00 UTC
  image    = "curlimages/curl:8.11.1"
  command  = ["sh", "-c"]
  # %%{ escapes HCL's template syntax; curl receives %{http_code}
  args     = ["curl -sS -o /dev/null -w 'SIBLING_HTTP=%%{http_code}\\n' --max-time 30 <sibling-url-from-above> || echo SIBLING_UNREACHABLE"]
}]

vpc_egress_setting = "ALL_TRAFFIC"   # Group 15 — REQUIRED for the internal-only sibling to be reachable (see Watch out for)
```

#### Step 2 — Apply

**Update**. Creates the sibling service, the cron job and its scheduler trigger, and a new two-container revision of the main service (~4–6 min).

#### Step 3 — Verify

```bash
# The sibling service exists with internal-only ingress
gcloud run services describe "$SERVICE-api" --project="$PROJECT" --region="$REGION" --format=yaml | grep -i "ingress"

# Its URL was injected into the main container
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="yaml(spec.template.spec.containers)" | grep -A1 API_URL

# The main revision now has two containers
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="value(spec.template.spec.containers[].name)"

# Scheduler trigger and job
gcloud scheduler jobs describe "$SERVICE-sibling-probe-trigger" --project="$PROJECT" --location="$REGION" \
  --format="value(schedule,state)"                    # expect 0 3 * * *   ENABLED

# Run the job now and read its result
gcloud run jobs execute "$SERVICE-sibling-probe" --project="$PROJECT" --region="$REGION" --wait
gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$SERVICE-sibling-probe\"" \
  --project="$PROJECT" --limit=5 --format="value(textPayload)"     # expect SIBLING_HTTP=200
```

From your workstation the sibling is **not** reachable — it is internal-only: `curl -s -o /dev/null -w "%{http_code}\n" "https://${SERVICE}-api-${PROJECT_NUMBER}.${REGION}.run.app/"` returns 404.

#### Explore further

- Set `vpc_egress_setting = "PRIVATE_RANGES_ONLY"` (the default), re-apply and re-run the job: it now prints `SIBLING_HTTP=404`. The injected URL is the sibling's public `run.app` hostname, so with private-ranges egress the call never enters the VPC and the internal-only sibling rejects it.
- Set `paused = true` on the cron job and confirm the scheduler state becomes `PAUSED` while the job remains runnable by hand.

#### Watch out for

- Init jobs (run once per apply, before the service) are Group 6 — see Lab 6. Cron jobs here run on a schedule and never block the apply.
- `additional_services` inherit `cpu_always_allocated`; under always-on CPU they need at least 1000m/512Mi (the defaults).
- In HCL strings, `%{` starts a template directive — escape it as `%%{`.
- A sidecar with `mount_nfs = true` mounts the share at **its own** `nfs_mount_path` (default `/data/db`), not the main container's path.

#### Revert

```hcl
additional_services   = []
additional_containers = []
cron_jobs             = []
vpc_egress_setting    = "PRIVATE_RANGES_ONLY"
```

The sibling service, job and trigger are deleted, and the main revision returns to one container.

---

### Lab 8 — CI/CD & GitHub Integration (Group 8)

> **Objective:** enforce Binary Authorization on the service, and understand (or run) the GitHub-driven build and Cloud Deploy promotion pipeline.

**You will:** enable Binary Authorization and read the enforcement back from the service and its siblings · see a plan-time guard on the Cloud Deploy toggles · *(external)* connect a GitHub repository and build on push · *(external)* promote a release through dev → staging → prod.
**Time:** 20 min (Binary Authorization) / 40+ min (CI/CD) · **Cost:** none (Cloud Deploy stages add services) · **Prerequisites / external setup:** **[External setup required]** for CI/CD only — a GitHub repository you control and either a Personal Access Token (scopes `repo`, `admin:repo_hook`) or a Cloud Build GitHub App installation ID. Binary Authorization needs nothing external.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_cicd_trigger` | `false` | Yes | Creates a Cloud Build v2 GitHub connection and a push trigger. Needs `github_repository_url` (plan-time check) and a token or an existing stored token. |
| `github_repository_url` | `""` | Yes | `https://github.com/ORG/REPO`. |
| `github_token` | `""` | Yes | PAT used to create the connection; stored as `secret-$SERVICE-github-token` and reused afterwards. Sensitive. |
| `github_app_installation_id` | `""` | Yes | Cloud Build GitHub App installation (preferred for organisations). |
| `cicd_trigger_config` | `{ branch_pattern = "^main$" }` | Yes | `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `description`, `substitutions`. |
| `enable_cloud_deploy` | `false` | Yes | Creates a Cloud Deploy pipeline and one service per stage. Requires `enable_cicd_trigger` (plan-time check). |
| `cicd_enable_cloud_deploy` | `false` | Yes | Trigger creates Cloud Deploy releases instead of updating the service. Requires `enable_cloud_deploy` (plan-time check). |
| `cloud_deploy_stages` | dev, staging, prod (prod requires approval) | Yes | Ordered stages: `name`, `target_name`, `service_name`, `project_id`, `region`, `require_approval`, `auto_promote`. |
| `enable_binary_authorization` | `false` | No | Sets Binary Authorization on the service **and** every `additional_services` sibling; creates the attestor, KMS key and policy if absent and attests the built image. |
| `binauthz_evaluation_mode` | `"ALWAYS_ALLOW"` | Yes | `ALWAYS_ALLOW`, `REQUIRE_ATTESTATION`, `ALWAYS_DENY` (only when `Services_GCP` has not configured the policy). |

#### Step 1 — Configure

Binary Authorization (no external setup):

```hcl
enable_binary_authorization = true
binauthz_evaluation_mode    = "ALWAYS_ALLOW"   # observe first; REQUIRE_ATTESTATION / ALWAYS_DENY block by design
```

CI/CD (external — only if you have a repository and credentials):

```hcl
enable_cicd_trigger   = true
github_repository_url = "https://github.com/<your-org>/<your-repo>"
github_token          = "<your-github-pat>"        # or github_app_installation_id = "<installation-id>"
cicd_trigger_config   = { branch_pattern = "^main$", ignored_files = ["**.md"] }
```

#### Step 2 — Apply

**Update**. `enable_binary_authorization` is not update-safe: the service is updated with a Binary Authorization policy reference and the image is signed (~5 min). CI/CD adds the connection, repository link and trigger (~3 min).

#### Step 3 — Verify

```bash
# Binary Authorization is set on the service (and on any additional_services sibling)
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml | grep -i "binary-authorization"
# expect run.googleapis.com/binary-authorization: default

# The project policy and its evaluation mode
gcloud container binauthz policy export --project="$PROJECT"
gcloud container binauthz attestors list --project="$PROJECT"
```

If you configured CI/CD:

```bash
gcloud builds triggers list --project="$PROJECT" --region="$REGION" --format="table(name,disabled)"
# push a commit to the matching branch, then:
gcloud builds list --project="$PROJECT" --region="$REGION" --limit=5 --format="table(id,status,createTime)"
```

Expect a trigger whose name contains your tenant and application name, and a new build (and revision) for each push to the branch.

#### Explore further

- **Guard rails.** Submit `cicd_enable_cloud_deploy = true` alone, then `enable_cloud_deploy = true` without `enable_cicd_trigger`: both fail at plan with an explicit message.
- **Cloud Deploy** *(external)*: with the trigger working, set `enable_cloud_deploy = true` and `cicd_enable_cloud_deploy = true`. Inspect `gcloud deploy delivery-pipelines list --project="$PROJECT" --region="$REGION"` and the stage services `$SERVICE-dev`, `$SERVICE-staging`, `$SERVICE-prod`. Promotion into `prod` waits for approval (`require_approval = true`).

#### Watch out for

- `REQUIRE_ATTESTATION` without a pipeline that attests every image blocks all new revisions, including rollbacks; `ALWAYS_DENY` blocks everything.
- Cloud Deploy is a **second code path**: each stage has its own service, database and jobs. A Cloud Deploy prebuilt deployment mirrors its image like the direct path.
- The GitHub token is needed only for the first connection; it is then kept in Secret Manager.

#### Revert

Set `enable_binary_authorization = false` (and `enable_cicd_trigger = false`, `enable_cloud_deploy = false`, `cicd_enable_cloud_deploy = false` if you set them). The service drops its policy reference; the trigger and pipeline are removed. The project-level attestor and policy that the module created if absent are shared resources and are not removed.

---

### Lab 9 — Storage & Filesystem — NFS (Group 9)

> **Objective:** mount shared NFS storage where you want it and prove that data written there survives a fresh container.

**You will:** move the NFS mount path and volume name · run a write-restart-read test with a job that mounts the same share · locate the NFS server the module discovered.
**Time:** 20–30 min · **Cost:** none (uses the shared NFS server) · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_nfs` | `true` | No | Mounts the discovered `Services_GCP` NFS server (an inline VM only when no `Services_GCP` exists). Requires `gen2`. |
| `nfs_mount_path` | `"/mnt/nfs"` | Yes | Mount path in the main container and in jobs with `mount_nfs = true`. |
| `nfs_volume_name` | `"nfs-data-volume"` | Yes | Volume name used on the revision. |
| `nfs_instance_name` | `""` | Yes | Target a specific NFS VM instead of auto-discovery. |
| `nfs_instance_base_name` | `"app-nfs"` | Yes | Base name for an inline NFS VM (standalone mode only). |

Each app gets its own subtree on the server: `/share/$SERVICE`.

#### Step 1 — Configure

```hcl
enable_nfs      = true
nfs_mount_path  = "/srv/appdata"          # move the mount off the generic default
nfs_volume_name = "lab-nfs-vol"
cron_jobs = [{                            # a paused job used only as a probe; replaces any Lab 7 cron_jobs
  name      = "nfs-probe"
  schedule  = "0 0 1 1 *"
  paused    = true
  image     = "busybox:1.36"
  command   = ["sh", "-c"]
  args      = ["date >> /srv/appdata/probe.log; echo CONTENTS:; cat /srv/appdata/probe.log"]
  mount_nfs = true                        # mounts the SAME share at nfs_mount_path
}]
```

#### Step 2 — Apply

**Update**. New revision with the moved mount, plus the probe job (~3 min). Nothing on the share is deleted.

#### Step 3 — Verify

```bash
# The mount moved
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml \
  | grep -B1 -A3 -E "lab-nfs-vol|/srv/appdata"

# The NFS server the module bound to
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -A1 NFS_SERVER_IP
gcloud compute instances list --project="$PROJECT" --filter="name~nfs" --format="table(name,zone,status,networkInterfaces[0].networkIP)"

# Write-restart-read: two executions = two fresh containers on the same share
gcloud run jobs execute "$SERVICE-nfs-probe" --project="$PROJECT" --region="$REGION" --wait
gcloud run jobs execute "$SERVICE-nfs-probe" --project="$PROJECT" --region="$REGION" --wait
gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$SERVICE-nfs-probe\"" \
  --project="$PROJECT" --limit=10 --format="value(timestamp,textPayload)"
```

The second execution prints **two** timestamps after `CONTENTS:` — the first was written by a container that no longer exists. That, not the presence of a mount, is the proof of persistence.

#### Explore further

- Set `enable_nfs = false` while the probe job still has `mount_nfs = true`: the plan fails, because a job would mount a volume that does not exist.
- Set `enable_nfs = false` and `execution_environment = "gen1"` together — accepted — then flip `enable_nfs` back on: rejected (gen1 cannot mount NFS).

#### Watch out for

- Mount where the application actually **writes**. A mount on the wrong path is a healthy, empty share while the data stays on the ephemeral disk; only a write-restart-read finds this.
- Do not put databases that rely on file locking (SQLite WAL, LevelDB, bbolt, LMDB) on NFS.
- With `enable_redis = true` and no `redis_host`, Redis is the NFS VM — turning NFS off can remove the app's Redis too (Lab 11).
- `enable_nfs` is not update-safe: disabling it removes the volume from the service.

#### Revert

```hcl
nfs_mount_path  = "/mnt/nfs"
nfs_volume_name = "nfs-data-volume"
cron_jobs       = []
```

The probe file stays on the share under `/share/$SERVICE` until teardown, which runs an NFS cleanup job for the app's subtree.

---

### Lab 10 — Storage, Filesystem & Image Registry (Group 10)

> **Objective:** provision an application bucket, mount it into the container with GCS Fuse, and prove writes through the mount land in the bucket.

**You will:** create a versioned bucket · mount it at a path · write through the mount from a job and read the object with `gcloud` · see which registry settings apply on a foundation.
**Time:** 20–30 min · **Cost:** low (bucket storage) · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `create_cloud_storage` | `true` | No | Master switch for `storage_buckets`. |
| `storage_buckets` | `[]` | **No** | Buckets named `gcs-$SERVICE-<name_suffix>`: `location`, `storage_class`, `force_destroy` (true), `versioning_enabled`, `lifecycle_rules`, `public_access_prevention` (enforced), `uniform_bucket_level_access` (true), `cors`. **Removing an entry destroys that bucket.** |
| `gcs_volumes` | `[]` | Yes | GCS Fuse mounts: `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. An empty `bucket_name` resolves to the `storage_buckets` entry whose `name_suffix` equals the volume `name`. Requires `gen2`. |
| `manage_storage_kms_iam` | `false` | No | Creates the project CMEK key ring/`storage-key` if absent and grants the service account encrypt/decrypt on it. |
| `enable_artifact_registry_cmek` | `false` | No | Creates an Artifact Registry KMS key and grants the registry service identity. **[External]** in the sense that it changes project KMS state. |
| `max_images_to_retain` | `7` | Yes | Registry cleanup KEEP policy. |
| `delete_untagged_images` | `true` | Yes | Registry cleanup DELETE policy for untagged images. |
| `image_retention_days` | `30` | Yes | Registry age-based DELETE policy. |

#### Step 1 — Configure

```hcl
create_cloud_storage = true
storage_buckets = [{
  name_suffix        = "assets"            # bucket gcs-$SERVICE-assets
  versioning_enabled = true
}]
gcs_volumes = [{
  name       = "assets"                    # same as name_suffix, so bucket_name can be left empty
  mount_path = "/mnt/assets"
}]
cron_jobs = [{                             # a paused probe job that writes through the mount
  name              = "gcs-probe"
  schedule          = "0 0 1 1 *"
  paused            = true
  image             = "busybox:1.36"
  command           = ["sh", "-c"]
  args              = ["date > /mnt/assets/written-by-job.txt; ls -l /mnt/assets"]
  mount_gcs_volumes = ["assets"]
}]
```

#### Step 2 — Apply

**Update**. Creates the bucket and its IAM grants, a new revision with the Fuse mount, and the probe job (~3 min).

#### Step 3 — Verify

```bash
# The bucket exists with the derived app-scoped name and versioning on
gcloud storage buckets describe "gs://gcs-$SERVICE-assets" --format=yaml | grep -iE "^name|versioning|public_access|uniform"

# The revision mounts it
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml \
  | grep -B2 -A4 "gcs-$SERVICE-assets"

# Write through the mount, then read the object directly from the bucket
gcloud run jobs execute "$SERVICE-gcs-probe" --project="$PROJECT" --region="$REGION" --wait
gcloud storage cat "gs://gcs-$SERVICE-assets/written-by-job.txt"     # expect the job's timestamp
```

#### Explore further

- Upload a file with `gcloud storage cp` and re-run the job: it appears in the job's `ls` output — the mount sees objects written by other clients.
- Set `readonly = true` on the volume and re-run the job: the write fails.
- Add `manage_storage_kms_iam = true` and check the key ring: `gcloud kms keys list --keyring="$PROJECT-cmek-keyring" --location="$REGION" --project="$PROJECT"`.

#### Watch out for

- **`storage_buckets` is not update-safe.** Removing or renaming an entry destroys that bucket, and with `force_destroy = true` (the default) its contents go with it. Set `force_destroy = false` for data you must keep.
- A `gcs_volumes` entry whose `name` matches no `name_suffix` and has no `bucket_name` mounts nothing useful. Never hand-build a bucket name from the tenant prefix — buckets are app-scoped (`gcs-$SERVICE-…`).
- GCS Fuse has no POSIX locking and higher latency; it suits assets and logs, not databases.
- On a `Services_GCP` foundation the image is pushed to the **shared** registry, which this module does not manage, so `max_images_to_retain`, `delete_untagged_images` and `image_retention_days` have no effect there. They apply only to the registry the module creates in standalone mode.

#### Revert

Set `gcs_volumes = []` and `cron_jobs = []` first and apply; then set `storage_buckets = []` and apply — the form warns that this destroys `gcs-$SERVICE-assets` and its contents, which is expected here.

---

### Lab 11 — Redis Cache (Group 11)

> **Objective:** see exactly what the module tells the application about Redis, and how setting a password changes it.

**You will:** read the injected Redis variables · change the port · set `redis_auth` and observe what is added and what is removed.
**Time:** 15 min · **Cost:** none · **Prerequisites / external setup:** none (the shared NFS VM co-hosts Redis).

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_redis` | `true` | No | Injects `REDIS_HOST`, `REDIS_PORT` and (without auth) `REDIS_URL`. With no `redis_host`, the host is the NFS VM (which runs Redis). |
| `redis_host` | `""` | Yes | Explicit Redis host (e.g. a Memorystore IP). Memorystore is never auto-discovered. |
| `redis_port` | `"6379"` | Yes | Injected as `REDIS_PORT`. |
| `redis_auth` | `""` | Yes | Stored as secret `secret-$SERVICE-redis-auth` and injected as `REDIS_AUTH`. **Setting it stops the module injecting `REDIS_URL`.** |

#### Step 1 — Configure

```hcl
enable_redis = true
redis_port   = "6380"                     # changes only what is injected; it does not reconfigure Redis
redis_auth   = "lab-redis-secret"         # injected as a SECRET; REDIS_URL is withdrawn
```

#### Step 2 — Apply

**Update**. Creates the Redis auth secret and a new revision (~2 min).

#### Step 3 — Verify

Read the variables before and after:

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -A3 REDIS
```

| `redis_auth` | Injected |
|---|---|
| `""` (baseline) | `REDIS_HOST` = NFS VM IP, `REDIS_PORT` = 6379, `REDIS_URL` = `redis://<ip>:6379` |
| set | `REDIS_HOST`, `REDIS_PORT` = 6380, `REDIS_AUTH` as a secret reference — **no `REDIS_URL`** |

`REDIS_HOST` equals `NFS_SERVER_IP` when `redis_host` is empty — check both in the same output.

#### Explore further

- Set `enable_redis = true`, `redis_host = ""` and `enable_nfs = false` in a project with no discoverable NFS server: the plan fails, because there is no host to fall back to.

#### Watch out for

- An app that reads only `REDIS_URL` loses its Redis configuration the moment you set `redis_auth`; such an app must build the URL itself from `REDIS_HOST`, `REDIS_PORT` and `REDIS_AUTH`.
- `redis_port` and `redis_auth` describe the server; they do not change it. Setting them wrong yields an app that cannot connect while the deploy succeeds.
- Set `enable_redis = false` for apps that do not use Redis.

#### Revert

```hcl
redis_port = "6379"
redis_auth = ""
```

`REDIS_URL` returns and the auth secret is deleted.

---

### Lab 12 — Database Backend (Group 12)

> **Objective:** find and use the application's database identity, expose it under the names an app expects, and rotate its password automatically without breaking the app.

**You will:** confirm which variables really name the database · add env-var aliases and compare them with `DB_HOST` · enable automatic password rotation and run it end to end.
**Time:** 30–40 min · **Cost:** low (a rotation job and a small dispatcher service) · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `database_type` | `"POSTGRES"` | Yes (flag) — see *Watch out for* | `POSTGRES`, `MYSQL` (and pinned variants) or `NONE`. With `Services_GCP`, only a database and user are created inside the shared instance of that engine. |
| `sql_instance_name` | `""` | Yes | Target a specific instance instead of discovery. |
| `sql_instance_base_name` | `"app-sql"` | Yes | Base name for an inline instance (standalone only). |
| `application_database_name` | `"crappdb"` | Yes | **Inert.** The database is always named after `$SERVICE` (hyphens → underscores). |
| `application_database_user` | `"crappuser"` | Yes | **Inert.** The user is always named after `$SERVICE`. |
| `database_password_length` | `32` | **No** | Length of the generated password (16–64). Changing it on a running deployment breaks database login — see *Watch out for*. |
| `db_password_env_var_name` | `""` | Yes | Extra env var holding the password (same secret as `DB_PASSWORD`). |
| `db_host_env_var_name` | `""` | Yes | Extra env var for the host — on Cloud Run this is the instance's **private IP**, not the socket path. |
| `db_user_env_var_name` | `""` | Yes | Extra env var for the user. |
| `db_name_env_var_name` | `""` | Yes | Extra env var for the database name. |
| `db_port_env_var_name` | `""` | Yes | Extra env var for the port. |
| `service_url_env_var_name` | `""` | Yes | Extra env var for the service URL (`CLOUDRUN_SERVICE_URL`). |
| `enable_postgres_extensions` | `false` | Yes | Validation only when deploying `App_CloudRun` directly — extensions are installed only when a wrapper module supplies them. |
| `enable_mysql_plugins` | `false` | Yes | Same as above for MySQL plugins. |
| `enable_auto_password_rotation` | `false` | Yes | Deploys a rotation job (`$SERVICE-pw-rotator`), a dispatcher service and an Eventarc trigger fired by the secret's rotation schedule (`secret_rotation_period`, Lab 5). |
| `rotation_propagation_delay_sec` | `90` | Yes | Wait between writing the new secret version and disabling the old one. |

(`postgres_extensions` and `mysql_plugins` are Group 0 — set by wrapper modules, not on the form.)

#### Step 1 — Configure

```hcl
db_host_env_var_name     = "MYAPP_DB_HOST"
db_user_env_var_name     = "MYAPP_DB_USER"
db_name_env_var_name     = "MYAPP_DB_NAME"
db_port_env_var_name     = "MYAPP_DB_PORT"
db_password_env_var_name = "MYAPP_DB_PASSWORD"
service_url_env_var_name = "APP_PUBLIC_URL"
enable_auto_password_rotation  = true
rotation_propagation_delay_sec = 90
```

#### Step 2 — Apply

**Update**. Adds the aliases (new revision) and the rotation job, dispatcher service, Eventarc trigger and a dedicated rotator service account (~4 min).

#### Step 3 — Verify

```bash
# Aliases next to the canonical variables
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -A2 -E "DB_HOST|DB_IP|MYAPP_|APP_PUBLIC_URL"
```

Expect `DB_HOST = /cloudsql/<project>:<region>:<instance>` but `MYAPP_DB_HOST = <private IP>` (equal to `DB_IP`). **They disagree on purpose**: an app wired to the alias connects over TCP to the private IP and needs `sslmode=require`; one reading `DB_HOST` uses the socket. `MYAPP_DB_PASSWORD` is a secret reference.

Now rotate the password end to end:

```bash
gcloud secrets versions list "$DB_SECRET" --project="$PROJECT" --format="table(name,state,createTime)"   # before
gcloud run jobs execute "$SERVICE-pw-rotator" --project="$PROJECT" --region="$REGION" --wait
gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$SERVICE-pw-rotator\"" \
  --project="$PROJECT" --limit=20 --format="value(textPayload)" | grep -E "Step|Rotation complete"
gcloud secrets versions list "$DB_SECRET" --project="$PROJECT" --format="table(name,state,createTime)"   # after
curl -s "$SERVICE_URL/db"
```

Expect `=== Rotation complete. New=… Old=… ===`, a new `ENABLED` version with the previous one `DISABLED` (kept for rollback), and `/db` still `connected`. Instances read the password at start-up, so to prove a *fresh* instance uses the new password, force one: apply an **Update** with a harmless change (e.g. `environment_variables = { ROTATION_CHECK = "1" }`) and call `/db` again.

Rotation also runs on its own schedule: `gcloud eventarc triggers list --project="$PROJECT" --location="$REGION" --filter="name~$SERVICE"`.

#### Explore further

- Set `application_database_name = "labdb"` and apply: no `labdb` database appears (`gcloud sql databases list --instance="$SQL_INSTANCE" --project="$PROJECT"`) and `DB_NAME` is unchanged. A validation block on a variable does not prove anything consumes it.
- `database_type = "NONE"`: submit it with `enable_cloudsql_volume` still `true` and read the plan error; then set both (`database_type = "NONE"`, `enable_cloudsql_volume = false`). The sample `db-init` exits immediately with `No database configured`, and `/` answers with `(DB unavailable: …)`. Do this only if you will revert straight away — see below.

#### Watch out for

- **`database_password_length` breaks login if changed on a running deployment.** It writes a new password to Secret Manager and destroys the old version while the database still holds the old password. Recover by re-running the idempotent database job: `gcloud run jobs execute "$SERVICE-db-create" --project="$PROJECT" --region="$REGION" --wait`. Use `enable_auto_password_rotation` to change passwords.
- **Do not change `database_type` on a running deployment.** The form permits it, but it moves the app to a different engine (or none), and the sample app supports PostgreSQL only. On a `Services_GCP` foundation, `MYSQL` also requires the foundation to provide a MySQL instance — otherwise the plan fails.
- When diagnosing a login failure, a `pg_hba.conf … no encryption` line under `password authentication failed` is psql's non-SSL retry, not a TLS fault — fix the credential.

#### Revert

Set all six `*_env_var_name` fields back to `""` and `enable_auto_password_rotation = false`, then apply. The rotation job, dispatcher, trigger and rotator account are removed; the database keeps the most recent password, which matches the latest secret version. If you tried `database_type = "NONE"`, set `database_type = "POSTGRES"` and `enable_cloudsql_volume = true` and apply; `db-init` recreates the user and schema if needed.

---

### Lab 13 — Backup & Maintenance (Group 13)

> **Objective:** schedule database backups, take one on demand, and restore a dump into the database.

**You will:** change the backup schedule and retention · run an on-demand backup and find the file · restore the module's shipped validation dump and check the data it creates.
**Time:** 20–30 min · **Cost:** low (bucket storage) · **Prerequisites / external setup:** none for the shipped sample dump, which the module uploads to `gs://gcs-$SERVICE-backups/backup.sql` itself. To restore your own dump, upload it there first.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Yes | Cron (UTC) for the scheduler job `$SERVICE-backup-schedule`, which runs the export job `$SERVICE-db-export`. |
| `backup_retention_days` | `7` | Yes | Lifecycle deletion age on `gcs-$SERVICE-backups`. |
| `enable_backup_import` | `false` | No | Runs `$SERVICE-backup-import` during the apply to restore `backup_file`. Rejected at plan with `database_type = "NONE"`. |
| `backup_source` | `"gcs"` | No | `gcs` (the backup bucket) or `gdrive`. |
| `backup_file` | `"backup.sql"` | No | A bare **filename** — the module builds `gs://gcs-$SERVICE-backups/<file>` itself. |
| `backup_format` | `"sql"` | Yes | `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto` (`auto` not with `gdrive`). |

#### Step 1 — Configure

```hcl
backup_schedule       = "30 4 * * *"    # daily 04:30 UTC
backup_retention_days = 21
enable_backup_import  = true            # restore once during this apply
backup_source         = "gcs"
backup_file           = "backup.sql"    # bare filename; the shipped validation dump
backup_format         = "sql"
```

The shipped `backup.sql` is non-destructive: it creates a `platform_validation` table and inserts one row.

#### Step 2 — Apply

**Update**. Updates the scheduler and bucket lifecycle and runs the import job; the apply fails loudly if the import exits non-zero (~3–5 min).

#### Step 3 — Verify

```bash
# Schedule and retention
gcloud scheduler jobs describe "$SERVICE-backup-schedule" --project="$PROJECT" --location="$REGION" --format="value(schedule)"
gcloud storage buckets describe "gs://gcs-$SERVICE-backups" --format=yaml | grep -A6 -i lifecycle    # expect age: 21

# The restore ran and created data (not merely "succeeded")
gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$SERVICE-backup-import\"" \
  --project="$PROJECT" --limit=30 --format="value(textPayload)" | grep -E "CREATE TABLE|INSERT|validation table"

# Take a backup now and find the file
gcloud run jobs execute "$SERVICE-db-export" --project="$PROJECT" --region="$REGION" --wait
gcloud storage ls -l "gs://gcs-$SERVICE-backups/"
```

Expect `CREATE TABLE`, `INSERT 0 1` and `Platform validation table is ready.` in the import log, and a new dump file next to `backup.sql`. To see the row itself, open **Cloud SQL → your instance → Cloud SQL Studio**, sign in to database `$SERVICE` as user `$SERVICE` with the password from `gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"`, and run `SELECT * FROM platform_validation;`.

#### Explore further

- Trigger the scheduled path instead of the job: `gcloud scheduler jobs run "$SERVICE-backup-schedule" --project="$PROJECT" --location="$REGION"`.
- Restore one of your own exports: download it, rename it, upload it to the backup bucket, and set `backup_file` to that name.

#### Watch out for

- **A restore runs over the live database.** Leaving `enable_backup_import = true` re-imports on later applies; turn it off immediately after a successful restore.
- `backup_file` is a filename, not a URI. A wrong name fails the import job, and the apply with it.
- An import that fails with `password authentication failed` usually means the database password and secret have diverged (see Lab 12, `database_password_length`); re-run `$SERVICE-db-create`.

#### Revert

```hcl
enable_backup_import  = false
backup_schedule       = "0 2 * * *"
backup_retention_days = 7
```

The `platform_validation` table remains in the database; it is harmless.

---

### Lab 14 — Custom Initialisation & SQL (Group 14)

> **Objective:** run your own ordered SQL scripts against the app database as part of a deployment.

**You will:** stage two interdependent scripts in a bucket · run them through the module's job · prove they ran in lexicographic order with the app user's privileges.
**Time:** 20–30 min · **Cost:** none · **Prerequisites / external setup:** a bucket holding your `.sql` files — this lab uses the bucket from Lab 10 (`gcs-$SERVICE-assets`); re-create it from Lab 10 Step 1 if you reverted, or use any bucket in the project.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_custom_sql_scripts` | `false` | No | Runs job `$SERVICE-custom-sql`, executing every `.sql` under the path in lexicographic order. Requires a bucket, a path and a database (plan-time checks). |
| `custom_sql_scripts_bucket` | `""` | Yes | Bucket name; the service account is granted read access to it. |
| `custom_sql_scripts_path` | `""` | Yes | Prefix inside the bucket, e.g. `sqlscripts`. |
| `custom_sql_scripts_use_root` | `false` | Yes | `true` runs as the instance's root user instead of the app user. |

#### Step 1 — Configure

Stage two scripts where the second depends on the first, so the wrong order would fail loudly:

```bash
printf 'CREATE TABLE IF NOT EXISTS lab_order (id SERIAL PRIMARY KEY, note TEXT);\n' > 01-create.sql
printf "INSERT INTO lab_order (note) VALUES ('ran second');\n"                   > 02-insert.sql
gcloud storage cp 01-create.sql 02-insert.sql "gs://gcs-$SERVICE-assets/sqlscripts/"
```

```hcl
enable_custom_sql_scripts   = true
custom_sql_scripts_bucket   = "gcs-<service>-assets"   # paste the real bucket name ($SERVICE expanded)
custom_sql_scripts_path     = "sqlscripts"
custom_sql_scripts_use_root = false                    # prove the app user has enough privilege
```

#### Step 2 — Apply

**Update**. Creates and runs the job (~2–3 min).

#### Step 3 — Verify

```bash
gcloud run jobs executions list --job="$SERVICE-custom-sql" --project="$PROJECT" --region="$REGION" \
  --format="table(metadata.name,status.succeededCount,status.failedCount)"
gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$SERVICE-custom-sql\"" \
  --project="$PROJECT" --limit=30 --format="value(textPayload)" | grep -E "Found|\.sql|CREATE|INSERT|ERROR"
```

Expect `Found 2 SQL script(s)`, then `01-create.sql` → `CREATE TABLE` before `02-insert.sql` → `INSERT 0 1`, and no `relation does not exist`.

#### Explore further

- Add `03-grant.sql` with `CREATE EXTENSION IF NOT EXISTS pg_trgm;` and re-run with `use_root = false`, then `true`, to see which statements need the root user.
- Set `enable_custom_sql_scripts = true` with an empty path and read the plan-time error (an empty prefix would silently run nothing).

#### Watch out for

- Every `.sql` under the prefix runs, on every apply where the job executes — write idempotent scripts (`IF NOT EXISTS`).
- `use_root = true` runs arbitrary SQL with instance-wide privileges on a **shared** instance.

#### Revert

Set `enable_custom_sql_scripts = false` and clear the bucket/path; apply. Delete the staged files: `gcloud storage rm "gs://gcs-$SERVICE-assets/sqlscripts/**"`. The `lab_order` table stays in the database.

---

### Lab 15 — Access & Networking (Group 15)

> **Objective:** control who can reach the service and how it reaches out, and read Cloud Run's 404s correctly.

**You will:** restrict ingress to internal and see the internal-ingress 404 · route all egress through the VPC · pin the network by name · learn the three 404 shapes.
**Time:** 20–30 min · **Cost:** none · **Prerequisites / external setup:** none.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `ingress_settings` | `"all"` | Yes | `all`, `internal`, `internal-and-cloud-load-balancing`. Forced to the last when Cloud Armor/CDN is on (Lab 17). |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | Yes | `PRIVATE_RANGES_ONLY` or `ALL_TRAFFIC` through the VPC (and its Cloud NAT). |
| `network_name` | `""` | Yes | VPC to attach to; empty = discover the `Services_GCP` network. |

#### Step 1 — Configure

Find the network the service uses today, then pin it explicitly and restrict ingress:

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml | grep -A3 network-interfaces
```

```hcl
ingress_settings   = "internal"                  # no direct internet access
vpc_egress_setting = "ALL_TRAFFIC"               # all outbound traffic through the VPC
network_name       = "<services-gcp-network>"    # the network shown above, e.g. vpc-network-<tenant-prefix>
```

#### Step 2 — Apply

**Update**. Updates the service's ingress and creates a new revision for the egress/network change (~2 min).

#### Step 3 — Verify

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml \
  | grep -E "ingress|vpc-access-egress|network-interfaces" -A2
curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"     # expect 404
curl -s "$SERVICE_URL/" | grep -o "<title>[^<]*</title>"     # expect <title>404 Page not found</title>
```

Three different 404s present as "404 with no container logs" — the title tells them apart:

| Title | Meaning | Fix |
|---|---|---|
| `404 Not Found` (the app's page) | The path does not exist in the app | Use a real path |
| `Error 404 (Not Found)!!1` (Google's page) | Missing `run.invoker` for the caller, or a path the front end owns (`/healthz`) | Check `gcloud run services get-iam-policy`; avoid `/healthz` externally |
| `404 Page not found` | Ingress rejected the request (internal-only) | Call from inside the VPC or relax `ingress_settings` |

#### Explore further

- With ingress `internal`, add the Lab 7 probe job pointing at `$SERVICE_URL/`: from inside the VPC with `ALL_TRAFFIC` egress it gets 200.
- Compare `/whoami` output before and after `ALL_TRAFFIC`: inbound headers do not change — egress affects only outbound calls.

#### Watch out for

- `PRIVATE_RANGES_ONLY` sends calls to *public* addresses — including another service's `run.app` URL — straight to the internet, outside the VPC. Internal-only targets then reject them (Lab 7).
- `ALL_TRAFFIC` changes the app's outbound IP to the VPC's Cloud NAT address.
- Pinning `network_name` to a network that is not `Services_GCP`'s disables discovery of the shared database and NFS server, and the plan fails if the app needs them.

#### Revert

```hcl
ingress_settings   = "all"
vpc_egress_setting = "PRIVATE_RANGES_ONLY"
network_name       = ""
```

---

### Lab 16 — Identity-Aware Proxy (Group 16)

> **Objective:** require Google sign-in in front of the service and control exactly who gets through.

**You will:** see both plan-time guards fire · configure the OAuth consent screen · enable IAP for yourself and a group · verify anonymous access is refused.
**Time:** 20–30 min · **Cost:** none · **Prerequisites / external setup:** **[External setup required]** — the project needs an IAP OAuth brand (consent screen). On recent projects it can only be created in the Console, and **a brand cannot be deleted once created**. You can read this lab without doing that.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_iap` | `false` | No | Turns on Cloud Run's built-in IAP and removes the public `allUsers` invoker binding. |
| `iap_authorized_users` | `[]` | Yes | Users/service accounts allowed through (`user:` prefix added if missing). The deployer is added automatically. |
| `iap_authorized_groups` | `[]` | Yes | Google Groups allowed through (`group:…`). |

#### Step 1 — Configure

1. *(Guard check — optional.)* Submit `enable_iap = true` with both lists empty. The plan fails on **two** preconditions: no authorised identities, and (if the project has none) no OAuth brand. Nothing is created — this is deliberate, because enabling IAP revokes public access in the same apply, and a failure later in that apply would leave the service reachable by nobody.
2. Create the brand: **Google Auth Platform / APIs & Services → OAuth consent screen**, choose *Internal* (or *External*), enter an app name and a support e-mail, and save. (`gcloud iap oauth-brands create` is reported as shut down for new projects.)
3. Set:

```hcl
enable_iap            = true
iap_authorized_users  = ["<your-email>"]                 # "user:" is added automatically
iap_authorized_groups = ["group:<team>@<your-domain>"]   # optional
```

Do **not** combine IAP with `enable_cdn` (Lab 17) — they are mutually exclusive.

#### Step 2 — Apply

**Update**. Enables IAP on the service, grants the IAP service agent `run.invoker`, grants each principal `run.invoker` and `iap.httpsResourceAccessor`, and removes `allUsers` (~2 min).

#### Step 3 — Verify

```bash
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format=yaml | grep -i "iap"
gcloud run services get-iam-policy "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --format="table(bindings.role,bindings.members)"              # no allUsers; gcp-sa-iap and your principals present
gcloud projects get-iam-policy "$PROJECT" --flatten="bindings[].members" \
  --filter="bindings.role=roles/iap.httpsResourceAccessor" --format="value(bindings.members)"
curl -s -o /dev/null -w "anonymous: %{http_code}\n" "$SERVICE_URL/"   # expect 403
```

Then open `$SERVICE_URL` in a browser signed in as an authorised user: you pass Google sign-in and see the visitor counter. An account that is not on the lists is refused.

#### Explore further

- Remove yourself from `iap_authorized_users` but keep a group you belong to — access still works through the group (membership is managed in Google Groups, no redeploy needed).

#### Watch out for

- Enabling IAP makes the `run.app` URL private. Uptime checks and any machine caller now need an authorised identity.
- Brands are permanent project state; create one deliberately.

#### Revert

Set `enable_iap = false` and apply. The `allUsers` invoker binding is restored and anonymous `curl` returns 200 again. The OAuth brand remains (it cannot be deleted).

---

### Lab 17 — Cloud Armor & CDN (Group 17)

> **Objective:** put a Global HTTPS Load Balancer with a Cloud Armor WAF and CDN in front of the service, and prove the WAF blocks attacks.

**You will:** see the CDN-without-Armor guard fire · provision the LB, policy and a zero-config nip.io certificate · confirm the policy is attached and CDN is on · watch an XSS probe turn into a 403 · see the direct `run.app` URL closed.
**Time:** 30–40 min (certificate issuance takes 10–30 min) · **Cost:** **yes** — forwarding rules, a global IP and the Cloud Armor policy bill while they exist · **Prerequisites / external setup:** none; a custom domain is optional and needs DNS control.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_cloud_armor` | `false` | No | Creates the global LB (serverless NEG `$SERVICE-neg`, backend `$SERVICE-backend`, URL map, IP `$SERVICE-lb-ip`, HTTP→HTTPS redirect) and policy `$SERVICE-waf-policy`; forces ingress to `internal-and-cloud-load-balancing`. |
| `admin_ip_ranges` | `[]` | Yes | CIDRs allowed ahead of the WAF rules (priority 100). Also used as VPC-SC admin access levels (Lab 18). |
| `application_domains` | `[]` | Yes | Custom domains with Google-managed certificates. Empty = `<ip-dashed>.nip.io`. |
| `enable_cdn` | `false` | Yes | Cloud CDN on the backend. Requires `enable_cloud_armor` (plan-time check). |

#### Step 1 — Configure

1. *(Guard check.)* Submit `enable_cdn = true` alone: the plan fails — there is no load balancer to attach CDN to.
2. Set:

```hcl
enable_cloud_armor = true
enable_cdn         = true
admin_ip_ranges    = ["203.0.113.0/24"]   # a SPECIFIC trusted range (documentation range here) — never 0.0.0.0/0
# application_domains = ["app.<your-domain>"]   # optional: then add a DNS A record to the LB IP
```

#### Step 2 — Apply

**Update**. Creates about 17 resources (~5–8 min). The service's ingress changes, so the `run.app` URL closes.

#### Step 3 — Verify

```bash
export LB_IP=$(gcloud compute addresses describe "$SERVICE-lb-ip" --global --project="$PROJECT" --format="value(address)")
export LB_HOST="${LB_IP//./-}.nip.io"
echo "https://$LB_HOST"

# 1. Policy exists and 2. is ATTACHED to the backend; 3. CDN is on
gcloud compute backend-services describe "$SERVICE-backend" --global --project="$PROJECT" \
  --format="yaml(securityPolicy,enableCDN)"                         # expect …/$SERVICE-waf-policy, enableCDN: true
# 4. Rules: admin allow at 100, WAF 1000–1003, rate-based ban at 2000, default allow last
gcloud compute security-policies describe "$SERVICE-waf-policy" --project="$PROJECT" \
  --format="table(rules.priority,rules.action,rules.match.config.srcIpRanges)"

# Certificate status (PROVISIONING until it is ACTIVE)
gcloud compute ssl-certificates list --project="$PROJECT" --filter="name~$SERVICE" \
  --format="table(name,managed.domains,managed.status)"

# Through the LB (once the certificate is ACTIVE)
curl -s "https://$LB_HOST/"                                         # expect the visitor counter
curl -s -o /dev/null -w "direct run.app: %{http_code}\n" "$SERVICE_URL/"   # expect 404 (ingress)
```

Then test the WAF. Allow **5–10 minutes after the apply** for rules to take effect:

```bash
curl -s -o /dev/null -w "XSS:  %{http_code}\n" "https://$LB_HOST/?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E"   # expect 403
curl -s -o /dev/null -w "SQLi: %{http_code}\n" "https://$LB_HOST/?id=1%27%20OR%20%271%27%3D%271"          # expect 403
curl -s -o /dev/null -w "OK:   %{http_code}\n" "https://$LB_HOST/"                                        # expect 200
```

A 200 with real content (the counter) through the LB proves the whole chain — LB → Cloud Armor → serverless NEG → Cloud Run → Cloud SQL. Backend health checks are not supported for serverless NEGs, so the HTTP response is the only signal.

#### Explore further

- `curl -sI "http://$LB_HOST/"` returns a redirect to `https://$LB_HOST/` — host-preserving. Calling by bare IP gives a certificate mismatch; always use the nip.io host.
- `curl -s "https://$LB_HOST/whoami"`: `X-Forwarded-For` now carries your IP followed by the LB's addition. Only the **rightmost** entry is trustworthy.
- Fetch the same static response twice and look for an `Age` header to see CDN caching (the sample app sends no cache headers, so most responses are not cached).

#### Watch out for

- Do not leave a request to the direct `run.app` URL as your health signal — it is closed by design once the LB is on.
- A custom domain's certificate stays `PROVISIONING` until its DNS A record points at `$LB_IP`.
- Never put `0.0.0.0/0` in `admin_ip_ranges`; it exempts everyone from the WAF.

#### Revert

```hcl
enable_cdn         = false
enable_cloud_armor = false
admin_ip_ranges    = []
```

The LB, certificate, IP and policy are destroyed and ingress returns to your `ingress_settings` value (`all`), reopening the `run.app` URL. If you used a custom domain, remove its DNS record yourself.

---

### Lab 18 — VPC Service Controls & Audit Logging (Group 18)

> **Objective:** enable detailed audit logging, and request a VPC-SC perimeter while checking honestly whether one was created.

**You will:** turn on DATA_READ/DATA_WRITE/ADMIN_READ audit logs and read the project config back · request a dry-run VPC-SC perimeter · compare what you asked for with the module's outputs.
**Time:** 20–30 min · **Cost:** yes — detailed audit logs increase Cloud Logging volume · **Prerequisites / external setup:** **[External setup required]** for VPC-SC: the project must belong to a GCP **organisation**, the deployer needs org-level Access Context Manager rights, a folder-nested project needs `organization_id`, and `admin_ip_ranges` must be non-empty. Audit logging needs nothing external. In RAD-managed projects the VPC-SC fields are hidden.

#### Settings in this group

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `enable_vpc_sc` | `false` | Yes | Creates an access policy (or reuses the org's), four access levels and a regular perimeter around the APIs the module uses. Skips with a warning when it cannot. |
| `vpc_sc_dry_run` | `true` | Yes | Log violations without blocking. Keep `true` until the logs are clean. |
| `vpc_cidr_ranges` | `[]` | Yes | CIDRs for the network access level; empty = discover the VPC's subnets. |
| `organization_id` | `""` | Yes | Numeric org ID; required for folder-nested projects. |
| `enable_audit_logging` | `false` | No | Project audit configs: `allServices` ADMIN_READ/DATA_READ/DATA_WRITE plus Secret Manager and KMS overrides. |

#### Step 1 — Configure

```hcl
enable_audit_logging = true
enable_vpc_sc        = true
vpc_sc_dry_run       = true              # observe, never enforce on first enable
vpc_cidr_ranges      = ["10.0.0.0/8"]
admin_ip_ranges      = ["<your-admin-cidr>"]   # Group 17 variable; VPC-SC skips when empty
# organization_id    = "<your-org-id>"   # required if the project sits under a folder
```

#### Step 2 — Apply

**Update** (~3–5 min). In a project without an organisation, or folder-nested without `organization_id`, the log shows `WARNING: VPC Service Controls skipped — …` and no perimeter is created; the apply still succeeds.

#### Step 3 — Verify

```bash
# Audit logging is real
gcloud projects get-iam-policy "$PROJECT" --format="yaml(auditConfigs)"
# expect allServices with ADMIN_READ, DATA_READ, DATA_WRITE, plus secretmanager and cloudkms entries

# Did a perimeter actually get created?
gcloud access-context-manager policies list --organization="<your-org-id>" 2>/dev/null
gcloud access-context-manager perimeters list --policy="<policy-id>" 2>/dev/null | grep -i "$PROJECT"
```

Compare with the deployment's outputs on the RAD deployment page: `vpc_sc_enabled`, `vpc_sc_perimeter_name`, `vpc_sc_dry_run_mode`, `audit_logging_enabled`. When VPC-SC was skipped, `vpc_sc_enabled = false` and `vpc_sc_perimeter_name` is empty **even though you set `enable_vpc_sc = true`** — the module reports what happened, not what was requested. Trust the output and the perimeter list, not the input.

If a dry-run perimeter exists, read its would-be denials:

```bash
gcloud logging read 'protoPayload.metadata.@type="type.googleapis.com/google.cloud.audit.VpcServiceControlAuditMetadata"' \
  --project="$PROJECT" --limit=20 --format="table(timestamp,protoPayload.serviceName,protoPayload.methodName)"
```

#### Explore further

- Read a secret (`gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"`) and find the DATA_READ entry for it in Logs Explorer — it only exists with audit logging on.

#### Watch out for

- `vpc_sc_dry_run = false` on first enable can block Cloud Build, deployments and the running app at once if any identity or IP is missing from the access levels.
- With an empty `admin_ip_ranges`, VPC-SC is skipped to avoid locking administrators out.

#### Revert

```hcl
enable_vpc_sc        = false
enable_audit_logging = false
admin_ip_ranges      = []
```

---

### Lab I — Isolation in a Shared Project (no group)

> **Objective:** give the app a place of its own inside a shared project — its own service account, only the extra roles it needs, and a fence that keeps every other identity away from its secrets, data, service and jobs.

**You will:** move the app onto a dedicated service account and verify every job runs as it · grant an extra role and see where it lands · enable the fence (if you have the org-level role) and prove the shared account is denied.
**Time:** 30–40 min · **Cost:** none · **Prerequisites / external setup:** the dedicated account needs nothing external. The fence needs `roles/resourcemanager.tagAdmin` on the project **and `roles/iam.denyAdmin`, which can only be granted at organisation (or folder) scope** — a project Owner without org access cannot satisfy it, and the plan says so. Testing the fence from outside also needs `roles/iam.serviceAccountTokenCreator` on the shared account.

These variables carry no UIMeta group, so they render on the form without a group heading.

#### Settings in this lab

| Variable | Default | Update-safe | What it does |
|---|---|---|---|
| `dedicated_service_account_id` | `""` | No | Run the app as its own account (6–30 chars). It gets only network, Cloud SQL client, VPC access and logging roles project-wide, plus its own secrets, buckets and jobs; Cloud Scheduler runs its jobs as it. |
| `additional_cloudrun_sa_roles` | `[]` | No | Extra project roles for the account the app runs as (shared or dedicated). Owner/Editor/IAM/resource-manager/org-policy/billing roles are refused. |
| `fence_enabled` | `false` | No | Tag key `fence-$SERVICE` = `fenced` on the service, every job, the buckets, the DB password secret and `fence_secret_ids`/`fence_resources`, plus IAM deny policy `fence-$SERVICE` on the project. Needs a dedicated account. |
| `fence_administrators` | `[]` | No | Emails still allowed through the fence: whoever deploys it, and break-glass admins. |
| `fence_secret_ids` | `[]` | No | Extra secrets the app owns (never one another app reads). |
| `fence_resources` | `[]` | No | Other location-scoped resources to fence: `{ name = "//…full resource name", location = "…" }`. |

#### Step 1 — Configure

Start with the dedicated account alone:

```hcl
dedicated_service_account_id = "crapp-lab-sa"                 # becomes crapp-lab-sa@<project>.iam.gserviceaccount.com
additional_cloudrun_sa_roles = ["roles/cloudtrace.agent"]     # granted to the account the app runs as
```

Then, only if you hold the org-level role, add the fence:

```hcl
fence_enabled        = true
fence_administrators = ["<your-email>"]                      # include yourself, or you lock yourself out
```

#### Step 2 — Apply

**Update**. The dedicated account is created, granted its project roles and per-resource access, and the service and every job move onto it (new revision, ~4–6 min). With the fence, the tag key/value, tag bindings and deny policy are added last. If you lack `iam.denyAdmin`, the plan fails naming the missing permission and nothing is changed.

#### Step 3 — Verify

```bash
export APP_SA="crapp-lab-sa@${PROJECT}.iam.gserviceaccount.com"

# The service and EVERY job run as the dedicated account
gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format="value(spec.template.spec.serviceAccountName)"
for j in $(gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~^$SERVICE" --format="value(metadata.name)"); do
  echo "$j: $(gcloud run jobs describe "$j" --project="$PROJECT" --region="$REGION" --format="value(spec.template.spec.template.spec.serviceAccountName)")"
done

# Its project-wide roles: only network, Cloud SQL client, VPC access, logging — plus the extra role
gcloud projects get-iam-policy "$PROJECT" --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:$APP_SA" --format="value(bindings.role)"

# It can read its own DB password secret
gcloud secrets get-iam-policy "$DB_SECRET" --project="$PROJECT" --format="table(bindings.role,bindings.members)"

# And the app still works
curl -s "$SERVICE_URL/db"
```

With the fence:

```bash
gcloud resource-manager tags keys list --parent="projects/$PROJECT" --filter="shortName~fence-"
gcloud iam policies list --attachment-point="cloudresourcemanager.googleapis.com/projects/$PROJECT" --kind=denypolicies
# From OUTSIDE the fence: impersonate the tenant-shared account and try to read the app's secret
gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT" \
  --impersonate-service-account="cloudrun-sa-${TENANT_PREFIX}@${PROJECT}.iam.gserviceaccount.com"
# expect PERMISSION_DENIED — while the app (dedicated account) and you (fence administrator) still succeed
```

#### Explore further

- Add a cron job (Lab 7) after enabling the dedicated account: it is created already running as the dedicated account, and its scheduler trigger can still run it.
- If your app owns another resource (a KMS key ring, say), list it in `fence_resources` and confirm the tag binding.

#### Watch out for

- **Adopt in order**: dedicated account first, verify the app and every job, then the fence.
- **Leave yourself in `fence_administrators`**; the deny policy overrides every allow, including Owner.
- What no single app can fence: the shared Cloud SQL root password (every app's database jobs use it) and secrets several apps read.
- **`additional_cloudrun_sa_roles` on the shared account affects every app of the tenant**, and removing a role from the list does **not** revoke it — remove it yourself with `gcloud projects remove-iam-policy-binding`. Roles on a dedicated account are deleted with that account on destroy.

#### Revert

Set `fence_enabled = false`, `fence_administrators = []` and apply (the deny policy and tags go first). Then set `dedicated_service_account_id = ""` and `additional_cloudrun_sa_roles = []` and apply: the app returns to `cloudrun-sa-$TENANT_PREFIX` and the dedicated account and its project roles are deleted. If you granted an extra role while on the shared account, revoke it by hand:

```bash
gcloud projects remove-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:cloudrun-sa-${TENANT_PREFIX}@${PROJECT}.iam.gserviceaccount.com" --role="roles/cloudtrace.agent"
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
   manual `gcloud` edit (a manual edit would be reverted on the next apply). See Lab 4.

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds or is mirrored and a new revision rolls out. See Lab 3.

4. **Manage secrets, storage, and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~$SERVICE" --format="value(name.basename())"
   gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~^$SERVICE"   # init + scheduled jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~$SERVICE" --format="value(name)"
   ```

5. **Re-run a database job** when credentials and database drift apart (for example after a password-length change): `gcloud run jobs execute "$SERVICE-db-create" --project="$PROJECT" --region="$REGION" --wait`. Init jobs with `execute_on_apply = true` also re-run on every **Update**.

6. **Take a backup before risky changes**: `gcloud run jobs execute "$SERVICE-db-export" --project="$PROJECT" --region="$REGION" --wait` (Lab 13).

7. **Open a database session** for inspection or maintenance. The shared instance is usually private-IP only, so use **Cloud SQL Studio** in the console (database and user `$SERVICE`, password from `gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"`). If the instance has a public IP, `gcloud sql connect "$SQL_INSTANCE" --project="$PROJECT" --user="$SERVICE" --database="$SERVICE"` also works.

8. **Mind regional quotas.** An always-on service holds Cloud Run CPU quota 24/7. Scale down with `min_instance_count = 0` through **Update**; never use `gcloud run services update --scaling=0`, which pins the service to zero instances permanently while still reporting `Ready`.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   # a job's logs
   gcloud logging read "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$SERVICE-db-init\"" \
     --project="$PROJECT" --limit=50 --format="value(timestamp,textPayload)"
   ```

   Logs Explorer filters:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"` and
   `resource.type="cloud_run_job" AND resource.labels.job_name="<service>-<job>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and CPU
   / memory utilisation. The module creates CPU and memory alert policies when monitoring is configured (`support_users`, `alert_policies` or an uptime check). An **uptime check** exists only if you enabled it **and** the service keeps at least one instance warm (Lab 6); confirm it is green under Monitoring → Uptime checks, and review Alerting → Policies.

3. **Audit trail** — with `enable_audit_logging = true` (Lab 18), data-access entries for secrets and KMS appear under **Logging → Logs Explorer** with `logName:"cloudaudit.googleapis.com%2Fdata_access"`.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with the workload deployed inside
the container.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved. A wrong `container_port` or a startup probe on a path the app does not serve keeps the revision from ever becoming ready, while traffic stays on the previous revision.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **404 with no container logs:** read the page title (Lab 15) — the app's 404, Google's 404 (missing `run.invoker` or a front-end-owned path like `/healthz`), or the ingress 404 (`404 Page not found`). Check `gcloud run services get-iam-policy "$SERVICE" …` for `allUsers` before suspecting the app.
- **200 but the app is broken:** `/` answers 200 even when the database is down — read the body (`DB unavailable: …`) or call `/db`.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret exists and is accessible to the service account, and the init job completed. `password authentication failed` after an apply that touched `database_password_length` means the secret and the database diverged — re-run `$SERVICE-db-create`. A following `pg_hba.conf … no encryption` line is psql's non-SSL retry, not a TLS problem.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="metadata.name~^$SERVICE"
  gcloud run jobs executions list --job="$SERVICE-db-init" --project="$PROJECT" --region="$REGION"
  ```
  If you supplied `initialization_jobs` without `db-init`, the database setup no longer runs.
- **Sibling service unreachable (`404` from inside):** `additional_services` are internal-only and their injected URL is public — set `vpc_egress_setting = "ALL_TRAFFIC"` (Lab 7).
- **App lost its Redis URL:** setting `redis_auth` withdraws `REDIS_URL` (Lab 11).
- **Uptime check failing on a healthy service:** it is probing `/healthz` through the front end; use `/` (Lab 6). No uptime check at all: the service scales to zero.
- **Data missing after a restart:** prove where the app writes with a write-restart-read (Lab 9/10) — a mount on the wrong path looks healthy and stays empty.
- **WAF probes still return 200:** Cloud Armor rules take 5–10 minutes to take effect after the apply (Lab 17).
- **Plan fails on IAP, the fence, or a feature combination:** read the message — these guards fire before anything is changed (Labs 16, I, 17).
- **Image build or mirror failed:** review Cloud Build history for the failed build's
  log under Cloud Build → History.
- **403 / permission errors:** verify the runtime service account's IAM roles and
  that all referenced secrets exist in Secret Manager. With a fence on, an identity outside `fence_administrators` is denied by design.
- **`Quota exceeded` / 503 with no logs on cold start:** regional Cloud Run CPU quota is exhausted by always-on services; scale others down with `min_instance_count = 0` and wait a few minutes.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead (from the same **Delete** dialog) — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the deployment). This removes everything the module created — the Cloud Run service,
the app's database and user, Secret Manager secrets, GCS buckets, Cloud Run Jobs,
and Artifact Registry images. Resources owned by **Services_GCP** (the VPC, shared
Cloud SQL, registry) are managed separately and are not removed here.

Feature labs can leave things behind that the module does not own — remove them yourself:

| Left behind by | What | How to remove |
|---|---|---|
| Lab 5 | Secret `lab-api-key` you created | `gcloud secrets delete lab-api-key --project="$PROJECT"` |
| Lab 14 | Local `01-create.sql` / `02-insert.sql` files (the bucket copies go with the bucket) | delete locally |
| Lab 16 | The OAuth brand / consent screen | cannot be deleted; harmless |
| Lab 17 | DNS A record for a custom domain | remove at your DNS provider |
| Lab I | An extra role granted to the **shared** `cloudrun-sa-…` account | `gcloud projects remove-iam-policy-binding` (shown in Lab I) |
| Lab 8 | Binary Authorization attestor/KMS key the module created if absent | shared project resources; keep or delete deliberately |
| Lab 18 | A VPC-SC access policy reused from the organisation | org-owned; not removed |

If the destroy fails with `resourceInUseByAnotherResource` on the network shortly after the service is deleted, GCP is still releasing the service's serverless IP reservations — wait 20–30 minutes and run **Delete** again.

---

## Appendix — Group 0 platform-wiring variables

These are never shown on the form. The platform or a wrapper module sets them; leave them at their defaults when deploying `App_CloudRun` directly.

| Variable | Purpose |
|---|---|
| `module_description`, `module_documentation`, `module_dependency`, `module_services` | Catalogue metadata: description, docs link, dependency on `Services_GCP`, services list. |
| `credit_cost`, `require_credit_purchases` | Module fee and whether it must be paid from purchased credits. |
| `enable_purge`, `public_access`, `shared_users`, `technical_support_users` | Catalogue visibility, purge permission, who may deploy, who supports it. |
| `requires_services` | Which `Services_GCP` `create_*` toggles the platform must enable (Postgres and NFS by default). |
| `require_services_gcp_module` | `true` fails the plan when no `Services_GCP` network exists; `false` allows standalone inline mode. |
| `resource_creator_identity`, `impersonation_service_account` | Identities Terraform and helper scripts use. |
| `job_execution_wait_timeout` | Seconds an apply waits for a job execution (default 900). |
| `module_storage_buckets`, `module_env_vars`, `module_secret_env_vars`, `module_writable_secret_ids`, `module_explicit_secret_values`, `module_service_needs_root_password`, `scripts_dir` | Injected by wrapper modules (extra buckets, env, secrets, script directory). |
| `postgres_extensions`, `mysql_plugins` | Extension/plugin lists, supplied by wrapper modules. |
| `application_config` | The wrapper module's application configuration map; replaces the built-in sample-app preset when `App_CloudRun` is called as a child module. |

---

## Summary

| Task / Lab | Type | Outcome |
|---|---|---|
| 1 — Deploy the baseline | Automated | Module binds to the `Services_GCP` foundation; builds the sample app; creates the service, database and user, secret, NFS/Redis wiring, backup bucket and jobs |
| 2 — Access & verify | Manual | Visitor counter and `/db` prove the chain; foundation binding, injected env, database, secret, init job, NFS and platform labels read back |
| Lab 2 — Support Users & Resource Labels | Feature | Alert e-mail channel created; custom labels on service, jobs, buckets and secrets; reserved keys enforced |
| Lab 3 — Application Identity | Feature | Version bump traced to a new image tag, `APP_VERSION` and revision |
| Lab 4 — Runtime & Scaling | Feature | Warm instance, scale-out, always-on CPU, resources, revision pruning, tagged canary |
| Lab 5 — Environment Variables & Secrets | Feature | Plain and secret env vars; a credential-named variable moved into Secret Manager automatically |
| Lab 6 — Initialization Jobs & Health Checks | Feature | Chained init job added with `db-init` kept; tuned probes, a working uptime check on `/`, a latency alert; no check for scale-to-zero |
| Lab 7 — Cron Jobs, Additional Services & Sidecars | Feature | Cron job, sibling service (reachable only with `ALL_TRAFFIC` egress) and sidecar |
| Lab 8 — CI/CD & GitHub Integration | Feature | Binary Authorization read back from the service; CI/CD and Cloud Deploy guards and pipeline |
| Lab 9 — Storage & Filesystem — NFS | Feature | Mount moved; persistence proven by write-restart-read |
| Lab 10 — Storage, Filesystem & Image Registry | Feature | Versioned app-scoped bucket mounted with GCS Fuse; job writes land in the bucket |
| Lab 11 — Redis Cache | Feature | Injected Redis variables; `redis_auth` swaps `REDIS_URL` for a `REDIS_AUTH` secret |
| Lab 12 — Database Backend | Feature | DB identity and aliases (socket vs private IP); automatic password rotation end to end |
| Lab 13 — Backup & Maintenance | Feature | Schedule and retention changed; on-demand backup; validation dump restored and checked |
| Lab 14 — Custom Initialisation & SQL | Feature | Ordered SQL scripts run from a bucket as the app user |
| Lab 15 — Access & Networking | Feature | Internal ingress, all-traffic egress, pinned network; three 404s told apart |
| Lab 16 — Identity-Aware Proxy | Feature | Plan guards seen; Google sign-in enforced; anonymous access 403 |
| Lab 17 — Cloud Armor & CDN | Feature | LB + WAF + CDN attached and verified; XSS/SQLi blocked; `run.app` closed |
| Lab 18 — VPC Service Controls & Audit Logging | Feature | Audit configs live; VPC-SC outcome read honestly from outputs |
| Lab I — Isolation in a Shared Project | Feature | Dedicated service account on service and every job; extra roles; fence denies the shared account |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/jobs/storage, re-run DB jobs, back up, DB access, quota hygiene |
| 4 — Observe | Manual | Service and job logs; Cloud Run metrics, alert policies, uptime check, audit logs |
| 5 — Troubleshoot | Manual | Diagnose revisions, the three 404s, DB credential drift, init jobs, siblings, Redis, storage paths, WAF timing, IAM |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources; `Services_GCP`-owned shared resources remain; lab leftovers removed by hand |
