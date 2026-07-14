---
title: "Shlink on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Shlink on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Shlink on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Shlink_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Shlink is a self-hosted, open-source URL shortener with detailed visit analytics and a full REST API. This lab takes you through the full operational lifecycle of the **Shlink on Cloud Run** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on Shlink product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Shlink_CloudRun) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service through its health endpoint and REST API.
- Retrieve the auto-generated API key and create your first short URL.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
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

1. Click **Deploy** in the RAD platform top navigation, open **Shlink (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Shlink_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secrets (DB password plus the auto-generated
   `INITIAL_API_KEY`), builds and mirrors the container image into Artifact
   Registry, and runs a one-shot database-initialisation job. Shlink needs no
   NFS share or GCS bucket — all state lives in PostgreSQL. First deploys take
   roughly **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~shlink" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Shlink's health path is `/rest/health` — an
   unauthenticated endpoint returning HTTP 200 with `{"status":"pass",...}`.
   **Do not test `/`** — Shlink is API-first and has no homepage, so the root path
   returns 404 by design. With scale-to-zero, allow ~5–15 seconds for the first
   request to cold-start an instance:

   ```bash
   curl -s "$SERVICE_URL/rest/health"
   # {"status":"pass","version":"...","links":{...}}
   ```

2. Retrieve the auto-generated API key from Secret Manager and create your first
   short URL through the REST API:

   ```bash
   API_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~shlink AND name~initial-api-key" --format="value(name)" --limit=1)
   API_KEY=$(gcloud secrets versions access latest --secret="$API_SECRET" --project="$PROJECT")

   curl -s -X POST "$SERVICE_URL/rest/v3/short-urls" \
     -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
     -d '{"longUrl": "https://cloud.google.com/run"}'
   ```

   Follow the returned `shortUrl` in a browser (or `curl -I`) and confirm the
   redirect; then list recorded visits:

   ```bash
   curl -s "$SERVICE_URL/rest/v3/short-urls" -H "X-Api-Key: $API_KEY"
   ```

3. **Post-deploy hardening/setup:** set `DEFAULT_DOMAIN` (via the
   `environment_variables` input and the **Update** flow) to the service's public
   hostname so generated short URLs carry the right host, and optionally add a
   `GEOLITE_LICENSE_KEY` to enable visit geolocation. For a browser UI, point the
   hosted [shlink-web-client](https://app.shlink.io/) at `$SERVICE_URL` with your
   API key.

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
   manual `gcloud` edit (a manual edit would be reverted on the next apply). The
   default is scale-to-zero (`min = 0`); set `min = 1` to eliminate the cold start
   on the first redirect after idle. Before raising `max_instance_count` well
   beyond 3, enable Redis for shared caching/locking.

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds and a new revision rolls out. Shlink runs its schema migrations automatically on the new revision's first start.

4. **Manage secrets, storage, and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~shlink"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + backup jobs
   ```

5. **Open a database session** for inspection or maintenance (the tenant-scoped
   database user is in the deployment outputs):

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=postgres --project="$PROJECT"
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
   count, request latency (P50/P95/P99 — the metric that matters most for a
   redirect service), instance count (watch scale-to-zero in action between
   requests), and CPU / memory utilisation. The module also provisions an
   **uptime check** against `/rest/health`; confirm it is green under
   Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Shlink releases.

- **`/` returns 404:** not a failure — Shlink has no web homepage. Verify health at
  `/rest/health` and interact via `/rest/v3/...` with the `X-Api-Key` header.
- **Revision unhealthy / service won't serve:** the startup probe allows up to
  ~300 seconds for first-boot database migrations. Inspect the latest revision and
  its logs before concluding the service has failed:
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL (PostgreSQL 15) instance is
  `RUNNABLE`, the DB password secret exists, and the `db-init` job completed. Never
  set `DB_USER`/`DB_NAME` manually in `environment_variables` — the foundation
  injects tenant-scoped values, and overriding them causes
  `password authentication failed`.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **401 on API calls:** the `X-Api-Key` header must carry the value of the
  `initial-api-key` secret (or a key you created with it). Re-fetch it from Secret
  Manager as in Task 2.
- **Wrong host in generated short URLs:** set `DEFAULT_DOMAIN` to the public
  hostname (see Task 2 step 3) — until then Shlink may build short URLs against
  the wrong domain.
- **Image build failed:** review Cloud Build history for the failed build's log;
  the image is a thin wrapper built from `shlinkio/shlink:stable` and mirrored
  into Artifact Registry.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets (including the initial API key), and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, shared
Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, and runs DB init |
| 2 — Access & verify | Manual | `/rest/health` passes; first short URL created via the REST API with the bootstrap key |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, API-key, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
