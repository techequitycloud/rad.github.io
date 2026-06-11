---
title: "Qdrant on Cloud Run \u2014 Lab Guide"
---

# Qdrant on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Qdrant_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Qdrant is a high-performance vector database and similarity search engine built
for AI workloads — RAG pipelines, recommendation systems, semantic search, and
embeddings storage. This lab takes you through the full operational lifecycle of
the **Qdrant on Cloud Run** module on Google Cloud: deploy it, access and verify
it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Qdrant product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Qdrant_CloudRun)
— this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
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

1. Click **Deploy** in the RAD platform top navigation, open **Qdrant (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Qdrant_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run v2 (Gen2) service, a Cloud Storage
   bucket mounted at `/qdrant/storage` via GCS FUSE, builds the container image,
   and stores an API key in Secret Manager when `enable_api_key = true`. Qdrant
   has no SQL database and no initialization job. First deploys typically take
   **8–15 minutes** (image build dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~qdrant" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Qdrant exposes two distinct health endpoints —
   use `/readyz` to confirm it has finished loading collections, and `/livez`
   to confirm the process is alive:

   ```bash
   curl -s "$SERVICE_URL/readyz"    # expect {"result":true,"status":"ok",...}
   curl -s "$SERVICE_URL/livez"     # expect {"result":true,"status":"ok",...}
   ```

   > The default `ingress_settings = "internal"` restricts access to the VPC.
   > Run these commands from a VM or Cloud Shell instance in the same VPC, or
   > temporarily switch ingress to allow your source IP.

2. If `enable_api_key = true`, retrieve the API key from Secret Manager before
   making authenticated requests:

   ```bash
   API_KEY_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~qdrant AND name~api-key" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$API_KEY_SECRET" --project="$PROJECT"
   ```

   Pass the retrieved value as the `api-key` header on all Qdrant REST calls.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs in the RAD platform and
   applying it via **Update** — the module owns the service spec, so scaling is a configuration
   change, not a manual `gcloud` edit (a manual edit would be reverted on the
   next apply). Keep `max_instance_count = 1`; Qdrant is a single-writer store
   and multiple instances sharing the same GCS FUSE mount corrupt collections.

3. **Update the application version** by changing the version input in the RAD
   UI and applying it via **Update**; a new image builds and a new revision rolls out.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~qdrant"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # scheduled backup jobs
   ```

5. **Inspect the GCS storage bucket** where Qdrant persists its WAL, collection
   data, and HNSW index files:

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~qdrant" --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, request latency (P50/P95/P99), instance count (scaling
   behaviour), and CPU / memory utilisation. The module also provisions an
   **uptime check** (against `/readyz`); confirm it is green under
   Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Qdrant releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs for startup errors, and confirm env vars and secrets resolved.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Slow startup / `/readyz` returns 503:** Qdrant loads all collections from
  GCS FUSE into memory on startup. Large collections can take tens of seconds to
  load. The startup probe waits for `/readyz`; allow additional time before
  declaring the revision unhealthy.
- **GCS FUSE mount errors:** confirm the Cloud Storage bucket exists, the runtime
  service account has `storage.objectAdmin` on the bucket, and the service is
  using the Gen2 execution environment (required for GCS FUSE).
- **API key errors (401/403):** confirm `enable_api_key = true` was set at
  deploy time, the secret exists, and the `api-key` header is present on requests.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud Storage bucket (and all persisted collections), Secret Manager secrets,
and Artifact Registry images. Resources owned by **Services_GCP** (the VPC,
shared registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, GCS storage bucket, and optional API key secret |
| 2 — Access & verify | Manual | Health checks pass on `/readyz` and `/livez`; API key retrieved if enabled |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, inspect storage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, GCS FUSE, API key, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
