---
title: "Trilium on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Trilium on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Trilium on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Trilium_CloudRun)**

## Overview

**Estimated time:** 45–60 minutes

Trilium Notes (the actively maintained TriliumNext fork) is a hierarchical,
self-hosted note-taking application with an embedded SQLite database. This lab
takes you through the full operational lifecycle of the **Trilium on Cloud Run**
module on Google Cloud: deploy it, access and verify it, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Trilium product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Trilium_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access the app, verify its health endpoint, and complete the first-run "Set Password" step.
- Perform day-2 operations — inspect the service, keep single-instance scaling, and update the version.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues, including the health-probe-path gotcha.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Artifact
  Registry, and shared service accounts this module depends on).
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

1. In the RAD platform, open **Trilium (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Trilium_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform builds a thin wrapper image over `triliumnext/notes` (via Cloud
   Build), provisions a dedicated Cloud Storage data bucket mounted at
   `/home/node/trilium-data`, and deploys a single Cloud Run service (port 8080,
   1 vCPU / 1 GiB by default). There is **no Cloud SQL instance and no Redis** —
   Trilium's document store is entirely an embedded SQLite database on the mounted
   volume. First deploys typically take **5–10 minutes** (the image build dominates;
   there is no database to wait for).

3. Discover the deployed service with name-agnostic filters:

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~trilium" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Trilium exposes an unauthenticated health
   endpoint — note this is **not** the root path:

   ```bash
   curl -s "$SERVICE_URL/api/health-check"   # expect {"status":"ok"}
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/"   # expect 302 (redirect to setup)
   ```

2. Open `$SERVICE_URL` in a browser. On first visit Trilium presents a **"Set
   Password"** screen — there is no pre-seeded admin credential in Secret Manager,
   unlike apps with an auto-generated password. Choose a strong password and
   complete the setup before sharing the URL with anyone else, especially if
   `ingress_settings = "all"` (the default, public).

3. Verify persistence: create a note, then reload the page and confirm it's still
   there — everything lives in the mounted Cloud Storage bucket:

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~trilium"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not scale out.** The module deliberately pins
   `min_instance_count = max_instance_count = 1`: the embedded SQLite database has
   no multi-writer support — a second instance risks corrupting `document.db`.
   Resource changes (`cpu_limit`, `memory_limit`) go through **Update** on the
   deployment details page, not a manual `gcloud run services update` (a manual
   edit would be reverted on the next apply).

3. **Update the application version** by changing the version input via **Update**
   on the deployment details page; a new image builds and a new revision rolls out.
   Trilium applies its own schema migrations on start, so no separate migration
   step is needed.

4. **There is no database session to open.** `database_type = "NONE"` — no Cloud
   SQL instance, no db-init job, no database password. The only durable state is
   the data bucket.

5. **Back up the notes:**

   ```bash
   DATA_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~trilium" --format="value(name)" --limit=1)
   gcloud storage cp -r "gs://$DATA_BUCKET" "gs://<your-backup-bucket>/trilium-$(date +%F)"
   ```

   Trilium also has its own in-app export/backup feature (Menu → Export) for a
   single-note or whole-tree `.zip` export, independent of the infrastructure-level
   bucket copy above.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, latency, and CPU/memory utilisation. The module can provision an
   **uptime check** (when `uptime_check_config.enabled = true` — it defaults to
   `false`) against `/api/health-check`; if enabled, confirm it is green under
   Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Trilium releases.

- **Revision never becomes Ready:** check the probe path first. If a custom
  `startup_probe`/`liveness_probe` was set to `/` instead of the default
  `/api/health-check`, the 302 redirect it returns fails most HTTP health checks.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **App boots but notes disappear after a restart:** confirm the data bucket is
  actually mounted and its `mount_options` include `uid=1000,gid=1000` — a
  mismatched uid/gid causes gcsfuse to mount the directory root-owned, which
  Trilium (running as uid 1000) cannot write to, and the app would fail to boot
  entirely rather than silently losing data — so this symptom instead points at a
  misconfigured or wrong bucket in `gcs_volumes`.
- **"Set Password" screen reappears on every visit:** this means the SQLite
  database itself isn't persisting — confirm the bucket mount survived a revision
  update (check `gcloud storage ls gs://<bucket>/` for a `document.db` file).
- **Image build failed:** review Cloud Build history for the failed build's log;
  the image is a thin wrapper over `triliumnext/notes`.
- **403 / permission errors:** verify the runtime service account's IAM roles on
  the data bucket.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule to complete "Set Password" immediately for
any publicly reachable deployment).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can
no longer manage it (for example after manual changes that conflict with the
Terraform state), use **Purge** instead — it removes the deployment from RAD's
records **without** destroying the cloud resources (it makes RAD forget the
project). This removes everything the module created — the Cloud Run service, the
Cloud Storage data bucket (all notes and attachments), and Artifact Registry
images. Copy the notes out first (Task 3, step 5) if you want to keep them.
Resources owned by **Services_GCP** (the VPC, Artifact Registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the image and provisions the Cloud Run service and the data bucket (no DB, no Redis) |
| 2 — Access & verify | Manual | Health check passes on `/api/health-check`; complete the first-run "Set Password" step; verify note persistence |
| 3 — Operate | Manual | Inspect revisions, keep single-instance scaling, update version, back up notes |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose probe-path, storage-mount, persistence, and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources including the data bucket |
