---
title: "Chroma on Cloud Run \u2014 Lab Guide"
---

# Chroma on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Chroma_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Chroma is an AI-native open-source vector database purpose-built for embeddings and
similarity search. It powers RAG pipelines, semantic search, and LangChain/LlamaIndex
workflows. This lab takes you through the full operational lifecycle of the **Chroma
on Cloud Run** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**,
not on Chroma product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Chroma_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
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

1. Click **Deploy** in the RAD platform top navigation, open **Chroma (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Chroma_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud Storage bucket (mounted via
   GCS FUSE at `/data` as Chroma's persistence backend), builds the container image,
   and optionally creates a Secret Manager auth token. Chroma requires no database and
   no initialisation job. First deploys take roughly **10–15 minutes** (image build
   dominates).

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~chroma" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Chroma exposes a single health endpoint:

   ```bash
   curl -s "$SERVICE_URL/api/v2/heartbeat"   # expect {"nanosecond heartbeat": <timestamp>}
   ```

   > **Note:** The service URL is internal by default (`ingress_settings = "internal"`).
   > Run this command from a machine within the VPC, or change to `ingress_settings = "all"`
   > with `enable_auth_token = true` before deploying.

2. If `enable_auth_token = true` was set at deploy time, retrieve the auth token from
   Secret Manager before making further API calls:

   ```bash
   AUTH_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~chroma AND name~auth-token" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$AUTH_SECRET" --project="$PROJECT"
   ```

   Pass the token as `Authorization: Bearer <token>` on every API request.

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
   manual `gcloud` edit (a manual edit would be reverted on the next apply). Keep
   `max_instance_count = 1`: multiple instances sharing the same GCS FUSE path have
   no distributed write lock and will corrupt collections.

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds and a new revision rolls out.

4. **Manage secrets and storage:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~chroma"
   DATA_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~chroma" --format="value(name)" --limit=1)
   gcloud storage ls "gs://${DATA_BUCKET}/"   # inspect Chroma's on-disk layout
   ```

5. **List any scheduled backup jobs:**

   ```bash
   gcloud run jobs list --project="$PROJECT" --region="$REGION"
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
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and CPU
   / memory utilisation. The module also provisions an **uptime check** targeting
   `/api/v2/heartbeat`; confirm it is green under Monitoring → Uptime checks, and
   review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Chroma releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. Chroma loads HNSW indexes from the GCS bucket on startup —
  allow time for the `/api/v2/heartbeat` probe to pass.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **GCS FUSE mount errors:** verify the GCS bucket exists, the service account has
  `storage.objectAdmin` on the bucket, and `execution_environment = "gen2"` is set
  (GCS FUSE requires Gen2).
- **Auth token errors (401):** confirm `enable_auth_token = true` was set, the secret
  exists, and the `Authorization: Bearer <token>` header is included in every request.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
GCS data bucket and all stored collections, Secret Manager secrets, and Artifact
Registry images. Resources owned by **Services_GCP** (the VPC, shared registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, GCS data bucket, and optional auth token |
| 2 — Access & verify | Manual | Heartbeat check passes; auth token retrieved if enabled |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets and storage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, GCS FUSE mount, auth token, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
