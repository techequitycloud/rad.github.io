---
title: "Audiobookshelf on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Audiobookshelf on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Audiobookshelf on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Audiobookshelf_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Audiobookshelf is a self-hosted audiobook and podcast server with a web UI, mobile apps, and per-user listening-progress sync. This lab takes you through the full operational lifecycle of the **Audiobookshelf on Cloud Run** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on Audiobookshelf product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Audiobookshelf_CloudRun) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including its ingress setting.
- Perform day-2 operations — inspect, scale, update, and manage the persistent state bucket.
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

1. Click **Deploy** in the RAD platform top navigation, open **Audiobookshelf (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Audiobookshelf_CloudRun)
   documents every input by group, with defaults. If you want to reach the web UI from
   your browser in Task 2, set `ingress_settings = "all"` now (the default is
   `internal`, VPC-only). Review the estimated cost (if credits are enabled) and click
   **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a dedicated GCS **state bucket**
   mounted at `/data` via GCS FUSE, and builds the thin-wrapper container image
   (`FROM ghcr.io/advplyr/audiobookshelf`) into Artifact Registry. There is **no
   Cloud SQL database, no Redis, and no init job** — Audiobookshelf self-initialises
   its SQLite database on first boot. With no database to create, first deploys are
   comparatively fast: roughly **10–20 minutes** (the Cloud Build image build
   dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~audiobookshelf" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Audiobookshelf's health path is `/healthcheck`,
   which returns HTTP 200 unauthenticated once the server is ready (the startup probe
   allows ~115 seconds of first-boot grace):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/healthcheck"
   ```

   > If this returns **404**, the service is still on the default
   > `ingress_settings = "internal"` and is only reachable from inside the VPC.
   > Change the ingress input to `all` via **Update** on the deployment details page
   > (or verify from a VM inside the VPC).

2. Open `$SERVICE_URL` in a browser. On first boot Audiobookshelf presents its
   **first-run setup wizard** — create the initial **root** (admin) user with a strong
   password. There is no generated credential to retrieve: this module creates **no
   application secrets** (no database password, no master key). API tokens for the
   mobile apps or automation are minted later in the web UI.

3. Immediate hardening: because the admin account is created by whoever reaches the
   wizard first, complete step 2 right after deploying — or keep ingress `internal`
   / enable IAP until you have.

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
   on the next apply). **Keep `max_instance_count = 1`**: Audiobookshelf serves one
   shared SQLite library from one volume — a second writer risks corrupting it.
   `min_instance_count = 0` is data-safe (state is on GCS) but adds a cold start.

3. **Update the application version** by changing the `application_version` input via
   **Update** on the deployment details page; Cloud Build produces a new image and a
   new revision rolls out. Note `latest` builds the pinned upstream version — pin an
   explicit tag to control upgrades.

4. **Manage the persistent state and jobs** (all Audiobookshelf state — SQLite DB,
   config, cover art, metadata — lives in the `/data` bucket):

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~audiobookshelf"
   gcloud storage ls "gs://$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~audiobookshelf" --format="value(name)" --limit=1)/"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # backup jobs, if any
   ```

5. **Back up the state** on demand by copying the bucket (the module also supports a
   scheduled backup via `backup_schedule`):

   ```bash
   gcloud storage cp -r "gs://<state-bucket>/config" "gs://<your-backup-bucket>/abs-config-$(date +%F)/"
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
   utilisation (library scans are the CPU/memory spikes to watch). The module's
   **uptime check** is disabled by default because the default ingress is
   VPC-internal; after switching ingress to `all`, enable `uptime_check_config`
   (path `/healthcheck`) via **Update** and confirm it is green under
   Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Audiobookshelf releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs; the startup probe (`/healthcheck`) allows ~115 seconds before the instance is
  declared failed:
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **404 on every request:** almost always the ingress setting — `internal` returns
  404 to external callers. Confirm with
  `gcloud run services describe "$SERVICE" --format="value(metadata.annotations['run.googleapis.com/ingress'])"`.
- **State missing after redeploy / volume errors:** verify the GCS FUSE mount —
  `execution_environment` must be `gen2`, and the `storage` bucket must exist
  (`gcloud storage buckets list --filter="name~audiobookshelf"`). Reports of state loss
  usually mean the bucket was recreated, not that SQLite failed.
- **Initialisation job failed:** this module injects no default init job, so failures
  here only occur for custom jobs you added:
  ```bash
  gcloud run jobs executions list --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log
  (`gcloud builds list --project="$PROJECT" --limit=5`). A `MANIFEST_UNKNOWN` on the
  base image means the requested `application_version` tag does not exist upstream.
- **Slow library scans / sluggish playback starts (app-specific):** SQLite and media
  indexing over GCS FUSE have real latency. For large libraries, reduce scan
  frequency, or move to `Audiobookshelf_GKE`, which uses a block PVC at `/data`.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
the GCS state bucket (including the SQLite database and all library metadata), and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, shared
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, the `/data` GCS state bucket, and builds the image — no database, no secrets |
| 2 — Access & verify | Manual | `/healthcheck` returns 200; create the root user in the first-run wizard |
| 3 — Operate | Manual | Inspect revisions, scale within the single-writer constraint, update version, manage state bucket |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and enable the uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, ingress, FUSE/state, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
