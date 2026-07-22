---
title: "Komga on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Komga on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Komga on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Komga_CloudRun)**

## Overview

**Estimated time:** 45–60 minutes

Komga is an open-source, self-hosted comics/manga reading server with a clean web
UI, OPDS feeds, collections, read lists, and full-text search. This lab takes you
through the full operational lifecycle of the **Komga on Cloud Run** module on
Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Komga product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Komga_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, update, and manage the persistent storage.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
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

1. In the RAD platform, open **Komga (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Komga_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud Storage bucket mounted
   at `/config` via GCS FUSE, and deploys the official `gotson/komga` image
   directly (no build step, just an optional Artifact Registry mirror). There is
   no database to provision and no init job to run, so first deploys are fast —
   roughly **3–6 minutes**.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~komga" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Komga exposes an unauthenticated Spring Boot
   Actuator health endpoint:

   ```bash
   curl -s "$SERVICE_URL/actuator/health"   # expect {"status":"UP"}
   ```

   Note: `$SERVICE_URL/api/v1/actuator/health` is a **different, auth-gated**
   endpoint and returns `401 Unauthorized` — this is expected and not a fault.

2. Open `$SERVICE_URL` in a browser. On first visit Komga's setup wizard prompts
   you to create the initial administrator account — no pre-seeded admin
   credential exists in Secret Manager. After creating the admin account, add a
   **library** pointing at a mounted media path (see `gcs_volumes` in the
   Configuration Guide for adding a separate comics/books storage bucket) and
   trigger a scan.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scaling is intentionally fixed at 1.** Komga serves one shared SQLite library
   from one mounted volume — do not raise `max_instance_count` above `1`; multiple
   concurrent writers would risk corrupting the database.

3. **Update the application version tag** by changing the `application_version`
   input in the RAD platform and applying it via **Update** — this deploys the
   corresponding `gotson/komga` tag directly (or its mirrored copy in Artifact
   Registry).

4. **Inspect storage:**

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~komga"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count, and CPU / memory
   utilisation (JVM apps benefit from watching memory closely during large library
   scans). The module can provision an **uptime check** (when
   `uptime_check_config.enabled = true` — it defaults to `false`); if enabled,
   confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Komga releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The startup probe targets `/actuator/health`; confirm
  the probe path was not accidentally changed to the auth-gated
  `/api/v1/actuator/health` (which always returns 401, regardless of app health).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Library state missing after a redeploy:** confirm `enable_gcs_storage_volume`
  is still `true` and the `storage` bucket is correctly mounted at `/config` — if
  this mount is ever disabled with no replacement, all library state (including the
  SQLite database) is lost on the next cold start.
- **Slow or failing library scans:** check for OOM in the logs — Komga's Lucene
  index and thumbnail cache are held in the JVM heap; raise `memory_limit` (and
  optionally `jvm_heap_max`) for very large libraries.
- **Image build failed:** review Cloud Build history — Komga uses a prebuilt image,
  so a build failure here almost always means `container_image_source` was
  accidentally changed to `"custom"` with no Dockerfile present.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Secret Manager entries (if any were added manually), the GCS storage bucket, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, Artifact
Registry repository itself) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, a GCS storage bucket mounted at `/config`, and deploys the prebuilt image — no database, no init job |
| 2 — Access & verify | Manual | Health check passes; create the initial admin account and add a library in the UI |
| 3 — Operate | Manual | Inspect revisions, update version, inspect storage — scaling stays fixed at 1 |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, storage-mount, memory, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
