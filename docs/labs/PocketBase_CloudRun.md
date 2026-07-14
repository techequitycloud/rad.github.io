---
title: "PocketBase on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy PocketBase on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# PocketBase on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/PocketBase_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

PocketBase is an open-source backend in a single file — an embedded SQLite database with a
realtime REST API, built-in authentication, file storage, and an admin dashboard. This lab
takes you through the full operational lifecycle of the **PocketBase on Cloud Run** module on
Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common
problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on
PocketBase product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/PocketBase_CloudRun) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and claim the first-run admin account.
- Perform day-2 operations — inspect, back up, and update the deployment.
- Understand why this module is single-instance and why that must not change.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Artifact Registry, and
  shared service accounts this module depends on).
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

1. In the RAD platform, open **PocketBase (Cloud Run)**, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/PocketBase_CloudRun)
   documents every input by group, with defaults. Leave `max_instance_count` at `1` — the
   embedded SQLite database and its GCS FUSE mount are single-writer, and raising it
   corrupts the database. Review the estimated cost (if credits are enabled) and click
   **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service (gen2, port 8090), a Cloud Storage data
   bucket mounted at `/pb_data` via GCS FUSE, and builds the container image. There is **no
   Cloud SQL instance and no database-initialisation job** — PocketBase creates its own
   SQLite schema on first start. First deploys typically complete in **5–15 minutes**, much
   faster than a Cloud-SQL-backed module.

3. When it completes, discover the resources with name-agnostic filters (so the commands
   keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~pocketbase" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. PocketBase exposes a public, unauthenticated health
   endpoint that returns as soon as the binary is up — there is no external database to wait
   on:

   ```bash
   curl -s "$SERVICE_URL/api/health"   # expect {"code":200,"message":"API is healthy."}
   ```

2. Open `$SERVICE_URL/_/` in a browser **immediately**. On first visit, whoever reaches `/_/`
   first is prompted to create the administrator (superuser) account — no admin credential is
   pre-seeded in Secret Manager, and until the account is claimed anyone with the URL can claim
   it. Fill in an email and password and finish the setup wizard. Afterwards, sign in to the
   admin dashboard and browse the default collections to confirm the database initialised
   correctly.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable revision;
   traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not scale beyond one instance.** `min_instance_count` and `max_instance_count` both
   default to `1` and the RAD platform enforces this deliberately — SQLite is single-writer
   and the `/pb_data` GCS FUSE mount is not safe for concurrent writers. If you need more
   capacity, increase `cpu_limit` / `memory_limit` on the single instance rather than raising
   instance counts.

3. **Update the application version** by changing the version input in the RAD platform and
   applying it via **Update**. PocketBase applies any pending schema migrations automatically
   on the next start, so back up `/pb_data` (step 4) before bumping the version — an
   interrupted upgrade can leave the database mid-migration.

4. **Back up `/pb_data`** — the Cloud Storage bucket is the entire database and file store:

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~pocketbase AND name~storage" --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/"
   gcloud storage cp "gs://$BUCKET/data.db" ./pb_data-backup.db
   gcloud storage rsync "gs://$BUCKET/" ./pb_data-backup/ --recursive   # full backup incl. uploads
   ```

5. **Manage your own secrets** (only relevant if you added SMTP or external backup
   credentials — PocketBase auto-generates none):

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~pocketbase"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request count,
   request latency (P50/P95/P99), and CPU / memory utilisation. Instance count should stay
   flat at 1. The uptime check is disabled by default; enable `uptime_check_config` if you
   want alerting on availability, then confirm it under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are platform-level
diagnostics and do not change with PocketBase releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its logs for
  startup errors. The startup and liveness probes target `/api/health`, which needs no
  external dependency, so a failure here almost always points to a container-level problem
  (bad image, missing env var, port mismatch) rather than a database issue.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Data appears missing or reset:** confirm the service is mounting the expected GCS bucket
  (not a fresh/empty one) and that `execution_environment = gen2` — gen1 cannot mount the GCS
  FUSE volume, so the service silently starts with no persistent `/pb_data`.
- **Can't reach `/_/` or someone else claimed the admin account:** there is no reset mechanism
  from the platform side; use the PocketBase CLI/API against the running instance, or restore
  from a pre-claim backup of the data bucket if this happened on a fresh deploy.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles, and check
  whether `enable_iap` is accidentally enabled — IAP blocks the public admin UI and REST API.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific gotchas
(including why `max_instance_count` must never be raised and why `execution_environment` must
stay `gen2`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**).
Delete runs `terraform destroy` and is irreversible (the deployment record is retained for
history). If a deployment is stuck and the RAD platform can no longer manage it (for example
after manual changes that conflict with the Terraform state), use **Purge** instead — it
removes the deployment from RAD's records **without** destroying the cloud resources (it makes
RAD forget the project). This removes everything the module created — the Cloud Run service,
the GCS data bucket (which **is** the entire SQLite database and uploaded files — back it up
first if you need to keep it), and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, shared Artifact Registry) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the Cloud Run service (gen2) and its GCS data bucket; no Cloud SQL, no init job |
| 2 — Access & verify | Manual | Health check passes; claim the first-run admin account at `/_/` immediately |
| 3 — Operate | Manual | Inspect revisions, keep instance count at 1, back up `/pb_data`, update version |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and (optional) uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, storage-mount, admin-claim, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes the service and the GCS bucket that holds all data |
