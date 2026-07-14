---
title: "Docmost on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Docmost on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Docmost on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Docmost_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Docmost is an open-source, real-time collaborative wiki and documentation platform — a self-hosted Confluence/Notion alternative built on NestJS. This lab takes you through the full operational lifecycle of the **Docmost on Cloud Run** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on Docmost product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Docmost_CloudRun) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service and create the first workspace and admin account.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Understand the roles of PostgreSQL, Redis, and NFS in a collaborative-editing workload.
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

1. Click **Deploy** in the RAD platform top navigation, open **Docmost (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Docmost_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service (port 3000, 1 vCPU / 1 GiB,
   scale-to-zero), a Cloud SQL (PostgreSQL 15) database with its Secret Manager
   secrets, Redis for real-time collaboration and job queues (co-located on the NFS
   server VM by default), an NFS volume mounted at `/app/data/storage` for uploaded
   attachments, a GCS data bucket, and an auto-generated `APP_SECRET`. It builds the
   container image and runs a one-shot database-initialisation job. First deploys
   take roughly **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~docmost" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Docmost's health path is `/api/health`, which
   returns HTTP 200 once the app has booted and run its schema migrations (allow up
   to ~2 minutes on a fresh deploy — the startup probe uses a 60-second initial
   delay plus a retry window; with `min_instance_count = 0` this curl also triggers
   the cold start):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/api/health"
   ```

2. Open `$SERVICE_URL` in a browser. Docmost ships with **no default credentials** —
   the first visitor completes the setup form and creates the initial workspace and
   administrator account. Do this promptly after deploy so no one else can claim the
   workspace. The auto-generated secrets can be inspected if needed:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~docmost"
   # e.g. the DB password or APP_SECRET:
   gcloud secrets versions access latest --secret=<secret-name> --project="$PROJECT"
   ```

3. Verify the collaboration wiring: create a page and open it in two browser tabs —
   edits should appear live in both (real-time sync runs over the `APP_URL`
   WebSocket endpoint, coordinated through Redis).

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
   configuration change, not a manual `gcloud` edit (a manual edit would be reverted
   on the next apply). The default is `min = 0` (scale-to-zero) / `max = 1`; set
   `min_instance_count = 1` to keep the collaboration endpoint warm, and only raise
   `max_instance_count` with Redis enabled (it is, by default) so instances stay
   coordinated.

3. **Update the application version** by changing the version input via **Update**
   on the deployment details page; a new image builds and a new revision rolls out.
   Docmost runs its schema migrations automatically on boot — there is no separate
   migration step.

4. **Manage secrets, storage, and jobs.** Treat `APP_SECRET` as immutable — rotating
   it after first boot logs everyone out and makes data encrypted under the old
   value unrecoverable:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~docmost"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   gcloud storage buckets list --project="$PROJECT" --filter="name~docmost"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=docmost --project="$PROJECT"
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
   count, request latency (P50/P95/P99), instance count (watch cold starts under
   scale-to-zero), and CPU / memory utilisation; Cloud SQL metrics live under the
   SQL page. The module also provisions an **uptime check** (the endpoint is public
   by default); confirm it is green under Monitoring → Uptime checks, and review
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Docmost releases.

- **Revision unhealthy / service won't serve:** the startup probe targets
  `/api/health` with a 60-second initial delay to allow boot-time migrations.
  Inspect the latest revision and its logs before concluding the service has failed:
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL (PostgreSQL 15) instance is
  `RUNNABLE`, the DB password secret exists, and the `db-init` job completed. Note
  the running service connects to the Cloud SQL **private IP over TCP with SSL**
  (Docmost's `postgres.js` driver cannot parse the Unix-socket path), while the
  `db-init` job uses the mounted socket — two different paths that can fail
  independently.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Real-time editing broken / edits don't sync:** verify Redis is reachable
  (`enable_redis = true`; with `redis_host` empty the NFS server VM co-hosts Redis —
  it must be `RUNNING`), and check that `APP_URL` in the running revision matches
  the URL users actually browse to (a mismatch breaks the collaboration WebSocket
  and absolute links — set it explicitly when using a custom domain).
- **Attachments disappear after a restart:** verify `enable_nfs = true` and the
  `gen2` execution environment — with NFS off, uploads land on ephemeral disk.
- **Image build failed:** review Cloud Build history for the failed build's log. The
  image is custom-built with the `DOCMOST_VERSION` build ARG (so
  `application_version = "latest"` maps to a pinned release).
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service, Cloud SQL database, Secret Manager secrets (including `APP_SECRET`), GCS buckets, the NFS-backed attachment volume, and Artifact Registry images. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), Redis, NFS, GCS bucket, secrets, and runs DB init |
| 2 — Access & verify | Manual | `/api/health` passes; create the first workspace and admin account; verify real-time editing |
| 3 — Operate | Manual | Inspect revisions, scale (Redis-coordinated), update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, Redis/collaboration, NFS, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
