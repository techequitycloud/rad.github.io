---
title: "Stirling-PDF on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Stirling-PDF on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Stirling-PDF on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/StirlingPDF_CloudRun)**

## Overview

**Estimated time:** 30–60 minutes

Stirling-PDF is a self-hosted web PDF toolkit — merge, split, convert, OCR,
compress, watermark, sign, redact, and 50+ other PDF operations, all processed on
your own infrastructure so documents never touch a third-party service. This lab
takes you through the full operational lifecycle of the **Stirling-PDF on Cloud
Run** module on Google Cloud: deploy it, access and verify it, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Stirling-PDF product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/StirlingPDF_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, update the version, and gate access.
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

1. In the RAD platform, open **Stirling-PDF (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/StirlingPDF_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform mirrors the official `stirlingtools/stirling-pdf` image into Artifact
   Registry and deploys the Cloud Run service. There is **no database, no storage
   bucket, and no secret** to provision — Stirling-PDF is stateless — so first
   deploys are quick, typically **5–10 minutes** (image mirroring dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~stirlingpdf" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Stirling-PDF exposes a public status endpoint that
   returns 200 only once the JVM and LibreOffice have fully initialised:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/api/v1/info/status"   # expect 200
   ```

2. Open `$SERVICE_URL` in a browser. With login disabled by default the toolkit is
   immediately usable — pick any tool (e.g. **Merge**), upload a couple of PDFs, and
   download the result to confirm end-to-end operation. Because the instance is open,
   consider gating access before real use (Task 3, step 4).

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
   manual `gcloud` edit (a manual edit would be reverted on the next apply).
   Stirling-PDF is stateless, so raising `max_instance_count` is safe with no cache
   or coordination. Set `min_instance_count = 1` to eliminate the first-request JVM
   cold start for latency-sensitive use.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; the new image tag is mirrored and a new revision
   rolls out — no migration step, because there is no schema.

4. **Gate access.** The default instance is open. To make it private, set
   `enable_login = true` (Stirling-PDF's built-in auth) and/or enable IAP, then
   **Update**. For a public instance, enable Cloud Armor and Redis-backed rate
   limiting (`enable_redis = true`) to throttle abuse.

5. **Tune for large documents** by raising `memory_limit` and `timeout_seconds`, and
   cap uploads with `SYSTEM_MAXFILESIZE` via `environment_variables`.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and
   CPU / memory utilisation. Watch memory during OCR/conversion — sustained pressure
   near the 2Gi limit is the signal to raise `memory_limit`. If you enabled the
   **uptime check**, confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Stirling-PDF releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The startup probe targets `/api/v1/info/status` and
  allows up to ~70 seconds on first boot for the JVM and LibreOffice to warm up —
  do not shorten it.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Container OOM-killed during a conversion:** raise `memory_limit` (2Gi floor;
  heavy OCR/conversion may need 4Gi+).
- **504 on a large file:** raise `timeout_seconds`; the request exceeded the Cloud
  Run request timeout mid-operation.
- **Image pull / mirror failed:** review Cloud Build / Artifact Registry history for
  the mirror step, and confirm the image exists in the repo.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including keeping the instance gated when it processes sensitive documents).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service and
its Artifact Registry images. Because Stirling-PDF is stateless there is no database,
bucket, or secret to clean up. Resources owned by **Services_GCP** (the VPC, shared
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module mirrors the image and provisions the stateless Cloud Run service (no DB, storage, or secrets) |
| 2 — Access & verify | Manual | Status endpoint returns 200; run a PDF operation end-to-end in the UI |
| 3 — Operate | Manual | Inspect revisions, scale, update version, gate access, tune for large files |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, OOM, timeout, image-mirror, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
