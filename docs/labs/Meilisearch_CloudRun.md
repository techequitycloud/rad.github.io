---
title: "Meilisearch on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Meilisearch on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Meilisearch on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Meilisearch_CloudRun)**

## Overview

**Estimated time:** 30–60 minutes

Meilisearch is a fast, open-source search engine — a single Rust binary that
delivers instant, typo-tolerant, faceted search behind a simple REST API, widely
used as a self-hostable alternative to Algolia. This lab takes you through the full
operational lifecycle of the **Meilisearch on Cloud Run** module on Google Cloud:
deploy it, access and verify it, build a real search index and query it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on every Meilisearch feature. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Meilisearch_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service and retrieve the master key.
- Create an index, add documents, and run a typo-tolerant search via the REST API.
- Perform day-2 operations — inspect, update, mint scoped keys, and manage backups.
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

1. In the RAD platform, open **Meilisearch (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Meilisearch_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform generates the `MEILI_MASTER_KEY` and stores it in Secret Manager,
   creates a Cloud Storage bucket (mounted at `/meili_data` for persistent index
   storage), builds and mirrors the `getmeili/meilisearch:v1.11` container image,
   and starts the Cloud Run service. There is **no** Cloud SQL database and **no**
   init job — Meilisearch manages its own storage. First deploys take roughly
   **5–10 minutes** (the image build dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~meilisearch" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~api-key" --format="value(name)" --limit=1)
   MEILI_MASTER_KEY=$(gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

> **Ingress note:** the module defaults to `ingress_settings = "internal"`, so the
> service URL is reachable only from inside the VPC. Run the `curl` commands below
> from a VM/Cloud Shell on the same VPC, or set `ingress_settings = "all"` (which
> requires `enable_api_key = true`, the default) to reach it from your workstation.

---

## Task 2 — Access & verify [Manual]

1. Confirm the engine is healthy. Meilisearch exposes an unauthenticated `/health`
   endpoint that returns `{"status":"available"}` once it is ready to serve:

   ```bash
   curl -s "$SERVICE_URL/health"          # expect {"status":"available"}
   ```

2. Confirm the master key works and lists the (initially empty) set of indexes:

   ```bash
   curl -s "$SERVICE_URL/indexes" -H "Authorization: Bearer $MEILI_MASTER_KEY"
   # expect {"results":[],"offset":0,"limit":20,"total":0}
   ```

   A `401`/`403` here means the key does not match — re-read it from Secret Manager
   (Task 1, step 3).

---

## Task 3 — Build an index and search it (worked example) [Manual]

This is the core of Meilisearch. You will create an index, add documents, and run a
typo-tolerant search — all through the REST API with the master key as a Bearer
token.

1. **Add documents.** Meilisearch creates the index automatically on the first write.
   Note the `id` field — Meilisearch uses it as the primary key:

   ```bash
   curl -s -X POST "$SERVICE_URL/indexes/movies/documents" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '[
       {"id":1,"title":"Interstellar","genre":"Sci-Fi","year":2014},
       {"id":2,"title":"Inception","genre":"Sci-Fi","year":2010},
       {"id":3,"title":"The Grand Budapest Hotel","genre":"Comedy","year":2014}
     ]'
   # returns a task: {"taskUid":0,"status":"enqueued",...}
   ```

2. **Wait for indexing** (Meilisearch processes writes asynchronously as tasks):

   ```bash
   curl -s "$SERVICE_URL/indexes/movies/tasks" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" | head
   # look for "status":"succeeded"
   ```

3. **Search — with a deliberate typo** to demonstrate built-in typo tolerance
   (`interstellr` still finds *Interstellar*):

   ```bash
   curl -s "$SERVICE_URL/indexes/movies/search" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '{"q":"interstellr"}'
   # returns the Interstellar hit in a few milliseconds ("processingTimeMs" is tiny)
   ```

4. **Filter and facet.** Make `genre` and `year` filterable, then query them:

   ```bash
   curl -s -X PATCH "$SERVICE_URL/indexes/movies/settings/filterable-attributes" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '["genre","year"]'

   curl -s "$SERVICE_URL/indexes/movies/search" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '{"q":"","filter":"year = 2014 AND genre = Sci-Fi"}'
   # returns only Interstellar
   ```

5. **Persistence check.** All of this now lives in the `/meili_data` GCS bucket. It
   survives a revision rollout or restart — no database involved.

---

## Task 4 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not scale horizontally.** Meilisearch is single-writer; the module pins
   `min = max = 1`. To handle more load, raise `cpu_limit`/`memory_limit` via
   **Update**, not the instance count — the module owns the service spec, so scaling
   is a configuration change, not a manual `gcloud` edit (which would be reverted on
   the next apply).

3. **Mint a scoped, search-only API key** for your application instead of sharing the
   master key:

   ```bash
   curl -s -X POST "$SERVICE_URL/keys" \
     -H "Authorization: Bearer $MEILI_MASTER_KEY" \
     -H 'Content-Type: application/json' \
     --data '{"description":"web search-only","actions":["search"],"indexes":["movies"],"expiresAt":null}'
   # returns a scoped "key" — distribute THIS, never the master key
   ```

4. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and a new revision rolls out.

5. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~meilisearch"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # scheduled backup jobs
   gcloud storage ls gs://<storage-bucket>/                        # the /meili_data contents
   ```

---

## Task 5 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count, and CPU / memory
   utilisation (watch memory as your index grows). If you enabled the **uptime
   check** against `/health`, confirm it is green under Monitoring → Uptime checks,
   and review Alerting → Policies.

---

## Task 6 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Meilisearch releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs. A common cause is a **missing master key** — in production mode Meilisearch
  exits immediately if `MEILI_MASTER_KEY` is unset or shorter than 16 bytes. Confirm
  `enable_api_key = true` and that the secret injected.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **`401`/`403` on API calls:** the key you sent does not match the deployed
  `MEILI_MASTER_KEY`. Re-read it from Secret Manager and retry.
- **Index looks empty after a redeploy:** confirm the `/meili_data` GCS bucket mounted
  (gen2 execution environment is required for GCS FUSE) and that you are querying the
  same index name.
- **`Image not found` / build failed:** review Cloud Build history for the failed
  build's log.
- **Cannot reach the URL from your laptop:** the default `ingress_settings = "internal"`
  restricts access to the VPC — use Cloud Shell/a VM on the VPC, or switch to `"all"`.
- **403 / permission errors:** verify the runtime service account's IAM roles
  (Secret Manager accessor, Storage object admin on the bucket).

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including never running more than one instance against the same storage
path).

---

## Task 7 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
the `MEILI_MASTER_KEY` secret, the Cloud Storage bucket (and all indexed data), and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, registry)
are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, the master-key secret, and the `/meili_data` storage bucket; builds the image (no DB) |
| 2 — Access & verify | Manual | `/health` returns available; master key lists indexes |
| 3 — Index & search | Manual | Create an index, add documents, run a typo-tolerant + filtered search via curl |
| 4 — Operate | Manual | Inspect revisions, right-size vertically, mint scoped keys, update version, manage backups |
| 5 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 6 — Troubleshoot | Manual | Diagnose master-key, auth, storage, build, ingress, and IAM issues |
| 7 — Tear down | Automated | Delete (Trash) removes all module resources including indexed data |
