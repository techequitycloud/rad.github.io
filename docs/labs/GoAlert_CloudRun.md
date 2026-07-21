---
title: "GoAlert on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy GoAlert on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# GoAlert on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/GoAlert_CloudRun)**

## Overview

**Estimated time:** 45–75 minutes

GoAlert is an open-source on-call scheduling and incident alert-escalation
platform, originally built by Target, with escalation policies, on-call
rotations/schedules, and outbound notification dispatch (email, webhook, and
optionally Twilio SMS/voice). This lab takes you through the full operational
lifecycle of the **GoAlert on Cloud Run** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on GoAlert product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/GoAlert_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including retrieving the bootstrapped
  admin credentials.
- Perform day-2 operations — inspect, scale, update, and manage secrets.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues, including
  the load-bearing initialization-job ordering.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL,
  Artifact Registry, and shared service accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **GoAlert (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/GoAlert_CloudRun)
   documents every input by group, with defaults. If deploying alongside a
   `GoAlert_GKE` instance in the same project, set `tenant_deployment_id = "cr"`
   (and `"gke"` on the GKE deployment) so the two variants don't collide on shared
   resource names. Review the estimated cost (if credits are enabled) and click
   **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 17)
   database with its Secret Manager secrets (admin password, data-encryption key,
   and the database password), builds the custom container image (Cloud Build
   compiling `GoAlert_Common`'s Dockerfile around the official `goalert/goalert`
   image), and runs the 3-stage database initialization job chain in order
   (`db-init` → `db-migrate` → `admin-bootstrap`). First deploys typically take
   roughly **15–25 minutes** — Cloud SQL instance creation dominates, and each
   Cloud Run Job execution in the chain adds its own scheduling latency (observed
   in practice at roughly 2 minutes per job just for Cloud Run to pick it up and
   run it, on top of the job's own work).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~goalert" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. GoAlert exposes a public, unauthenticated
   `/health` endpoint:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/health"   # expect 200
   ```

2. Retrieve the bootstrapped admin credentials. GoAlert has **no first-visit setup
   wizard** — the only account that exists is the one created by the
   `admin-bootstrap` initialization job at deploy time:

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~goalert AND name~admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

   The admin username defaults to `admin` (the `admin_username` input) unless
   overridden.

3. Open `$SERVICE_URL` in a browser and log in with the username and the password
   retrieved above.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the service spec, so scaling is a
   configuration change, not a manual `gcloud` edit (a manual edit would be
   reverted on the next apply). Keep `min_instance_count >= 1` and
   `cpu_always_allocated = true`: GoAlert runs a continuous in-process escalation
   engine that must keep running to evaluate schedules and fire real alerts — at
   zero instances, or under CPU-throttled request-based billing, escalations can
   be silently delayed or missed.

3. **Update the application version tag** by changing the version input in the
   RAD platform and applying it via **Update**; a new image builds and the
   3-stage init job chain re-runs (all three jobs are idempotent and safe to
   re-run — `db-init` uses `CREATE ... IF NOT EXISTS`-style checks, `db-migrate`
   applies only pending migrations, and `admin-bootstrap` detects an
   already-existing admin user and exits cleanly).

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~goalert"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=goalert --project="$PROJECT"
   ```

6. **Set the public URL for OIDC/notification links.** This module auto-computes a
   `run.app` URL for `GOALERT_PUBLIC_URL` when `public_url` is left empty, so this
   step is usually unnecessary on Cloud Run (unlike the GKE variant) — but if you
   front the service with a custom domain or load balancer, set `public_url` to
   that address so outgoing notification links and OIDC callbacks resolve
   correctly.

7. **Manage on-call schedules and escalation policies** — GoAlert-specific
   day-2 operations performed in the web UI (Escalation Policies, Schedules,
   Rotations, Services) rather than via Terraform; these are GoAlert application
   data, not infrastructure.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Look for a real "listening and serving HTTP" line confirming the server bound
   its port successfully. Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, request latency, instance count, and CPU/memory utilisation
   (expect a steady non-zero CPU baseline since `cpu_always_allocated = true`).
   The module can provision an **uptime check** (when
   `uptime_check_config.enabled = true` — it defaults to `false`); if enabled,
   confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with GoAlert releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs for startup errors, and confirm env vars and secrets resolved. The
  startup probe is TCP against the container port with a 30-second initial delay
  and up to 30 retries (accommodating first-boot migration time).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE` and
  the DB password secret exists. Since GoAlert only accepts a single
  `GOALERT_DB_URL`, a connection failure often traces back to the entrypoint's
  socket/TCP branch resolving the wrong host — check the revision's injected
  `DB_HOST`/`DB_IP` values.
- **Migration failures — the load-bearing step.** If `admin-bootstrap` fails with
  `relation "auth_basic_users" does not exist`, `db-migrate` did not complete
  successfully first. Check its execution logs specifically:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-migrate" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions logs read <execution-name> --project="$PROJECT" --region="$REGION"
  ```
  Then re-run the chain in order (`db-init` → `db-migrate` → `admin-bootstrap`) —
  each job is idempotent and safe to re-execute manually via
  `gcloud run jobs execute <job-name>` if you need to force it outside a full
  Terraform apply.
- **Image build failed:** review Cloud Build history for the failed build's log.
  A common cause when cloning this module's pattern for a similar app: the
  upstream base image's shell is BusyBox, not GNU/bash — verify any shell script
  edits use portable syntax (e.g. `sed 's/[?]/.../'`, not `sed 's/\?/.../'`).
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including why `min_instance_count`/`cpu_always_allocated` must stay at
their defaults for GoAlert's escalation engine to function correctly).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can
no longer manage it (for example after manual changes that conflict with the
Terraform state), use **Purge** instead — it removes the deployment from RAD's
records **without** destroying the cloud resources (it makes RAD forget the
project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, and Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 17), secrets, and runs the `db-init` → `db-migrate` → `admin-bootstrap` chain |
| 2 — Access & verify | Manual | Health check passes on `/health`; retrieve bootstrapped admin credentials from Secret Manager and log in |
| 3 — Operate | Manual | Inspect revisions, scale (keeping always-on CPU), update version, manage secrets, DB access, manage schedules/escalation policies |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, migration-ordering, and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
