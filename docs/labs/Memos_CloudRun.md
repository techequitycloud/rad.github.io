---
title: "Memos on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Memos on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Memos on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Memos_CloudRun)**

## Overview

**Estimated time:** 30–60 minutes

Memos is an open-source, self-hosted, markdown-native note-taking service for
quick capture. This lab takes you through the full operational lifecycle of the
**Memos on Cloud Run** module on Google Cloud: deploy it, access and verify it,
run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Memos product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Memos_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and create the first (admin) account.
- Perform day-2 operations — inspect, scale, update, and manage backups.
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

1. In the RAD platform, open **Memos (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Memos_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager password secret, builds the container image,
   and runs a one-shot database-initialisation job. First deploys take roughly
   **15–25 minutes** (Cloud SQL creation dominates; Memos's own build and boot are
   fast — a single small Go binary).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~memos" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and serving:

   ```bash
   curl -s "$SERVICE_URL/" -o /dev/null -w '%{http_code} %{size_download}\n'   # expect 200 and >0 bytes
   ```

2. Open `$SERVICE_URL` in a browser. Memos shows its sign-up/login page. **Create
   the first account** — unlike most apps in this catalogue, there is no
   pre-seeded admin credential in Secret Manager to retrieve; whoever registers
   first automatically becomes the host/admin. After creating it, write your first
   note to confirm the database round-trip (the note persists on refresh — proof
   the `MEMOS_DSN` wiring and `db-init` job worked). Consider disabling public
   self-registration from within Memos's own settings afterward if the deployment
   should not accept further public sign-ups.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the service spec, so scaling is a
   configuration change, not a manual `gcloud` edit (a manual edit would be
   reverted on the next apply). Memos has no cross-instance state coordination
   concern (no in-process cache, no WebSocket push), so raising `max_instance_count`
   is safe without enabling anything else.

3. **Update the application version tag** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a new revision
   rolls out. `Memos_Common` maps `"latest"` to a pinned `MEMOS_VERSION` build arg,
   so set an explicit version (e.g. `0.28.0`) to track a specific upstream release.

4. **Manage backups:**

   ```bash
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=memos --project="$PROJECT"
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
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and
   CPU / memory utilisation. The module can provision an **uptime check** (when
   `uptime_check_config.enabled = true` — it defaults to `false`); if enabled,
   confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Memos releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs for startup errors. The startup probe targets `/` with a 30-second
  initial delay.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors (`MEMOS_DSN` parse failures, auth failures):**
  confirm the Cloud SQL instance is `RUNNABLE`, the DB password secret exists, and
  the initialisation job completed successfully. Check the container logs for the
  `memos-entrypoint.sh` startup banner (`DB host:`/`DB name:`/`DB user:`) to see
  what values it resolved.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log —
  a common cause is `MEMOS_VERSION` resolving to a tag that doesn't exist upstream.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the "first account becomes admin" behaviour and the
`container_image_source` trade-off).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can
no longer manage it (for example after manual changes that conflict with the
Terraform state), use **Purge** instead — it removes the deployment from RAD's
records **without** destroying the cloud resources (it makes RAD forget the
project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secret, and Artifact Registry images. Resources
owned by **Services_GCP** (the VPC, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), DB password secret, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; create the first (admin) account in the UI and write a note |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
