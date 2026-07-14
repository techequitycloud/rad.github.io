---
title: "Gokapi on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Gokapi on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Gokapi on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Gokapi_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Gokapi is a lightweight, self-hosted file-sharing server written in Go — a
self-hosted alternative to WeTransfer, generating shareable download links with
optional expiry, download-count limits, and password protection. This lab takes
you through the full operational lifecycle of the **Gokapi on Cloud Run** module
on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Gokapi product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Gokapi_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and claim the administrator account.
- Perform day-2 operations — inspect the service, scale correctly, update the
  version, and manage the optional API key.
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

1. In the RAD platform, open **Gokapi (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Gokapi_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions a single-instance Cloud Run service, a Cloud Storage
   bucket mounted into the container via **GCS Fuse** at `/data` (this bucket is
   Gokapi's only persistence — there is no Cloud SQL instance; `database_type` is
   fixed to `NONE` and Gokapi keeps its own internal SQLite database on the
   mount), and builds the container image from a thin wrapper around the upstream
   `f0rc3/gokapi` image. No database-initialisation job runs — Gokapi manages its
   own storage. Because there is no Cloud SQL instance to provision, first deploys
   are considerably faster than database-backed modules — typically **10–20
   minutes**, dominated by the image build.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~gokapi" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is up. Gokapi's health probes hit the public root, so a
   plain `curl` is a sufficient liveness check (no API endpoint or auth required):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Open `$SERVICE_URL` in a browser **immediately**. Gokapi has no pre-seeded
   admin credential — on first visit it serves its own first-run setup wizard,
   and whoever reaches it first claims the administrator account. Because
   `ingress_settings = "all"` makes the service publicly reachable by default,
   don't leave this step for later; if you need a delay before claiming it,
   redeploy with `enable_iap = true` first to gate the URL behind Google sign-in.

3. Confirm data is actually landing on the GCS Fuse mount once you've used the
   UI to upload a file:

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --format="value(name)" --filter="name~storage" | grep -i gokapi | head -1)
   gcloud storage ls "gs://${BUCKET}/config"   # SQLite DB + app config
   gcloud storage ls "gs://${BUCKET}/data"     # uploaded files
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not scale beyond one instance.** `min_instance_count = 1` /
   `max_instance_count = 1` is a hard operational limit, not a tunable default —
   Gokapi's SQLite database is single-writer with no clustering or replication
   story, so raising `max_instance_count` risks database corruption and
   inconsistent uploads. There is nothing to configure here; leave both at 1.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**. Gokapi's Dockerfile resolves the
   platform's `latest` default to a pinned, known-good tag (`v1.9.6`) via an
   app-specific build argument, so leaving the version at `latest` is safe and
   reproducible; pin explicitly if you need a different release.

4. **Manage the optional operator API key** (only present if `enable_api_key =
   true` was set at deploy time — Gokapi has no mandatory secret):

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~api-key"
   gcloud secrets versions access latest --secret=<api-key-secret-name> --project="$PROJECT"
   ```

   This token is a convenience only — Gokapi's real upload/download API keys are
   normally minted from the admin UI after setup.

5. **Inspect the storage bucket directly** for a snapshot of persisted state
   (there is no database session to open — Gokapi has no Cloud SQL instance):

   ```bash
   gcloud storage ls "gs://${BUCKET}/config" "gs://${BUCKET}/data"
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
   count, request latency, instance count, and CPU / memory utilisation (Gokapi is
   a lightweight Go binary, so expect low steady-state usage). The uptime check
   is **disabled by default** (`uptime_check_config.enabled = false`) — enable it
   for a production deployment given the service is publicly reachable by
   default, then confirm it under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Gokapi releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. Both the startup and liveness probes target `/`
  (unauthenticated, no dependency on an external database) — startup allows
  roughly 100 seconds of retry budget after a 15-second initial delay.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Uploads or the SQLite DB appear to vanish or corrupt intermittently:** the GCS
  Fuse mount at `/data` is Gokapi's only persistence path on Cloud Run and does
  not provide true POSIX file locking — this is a known-risk combination inherent
  to running a SQLite-backed app on Cloud Run, not a misconfiguration to fix.
  Confirm `execution_environment = "gen2"` (required for the GCS Fuse mount) and
  review the mount under Cloud Run → service → Revisions → **Volumes**.
- **Someone else claimed the administrator account first:** because the
  first-run setup wizard is public and unauthenticated, there is no built-in
  recovery — redeploying with `enable_iap = true` prevents this on the next
  deploy but does not un-claim an existing admin.
- **Optional API key secret not found:** confirm `enable_api_key` was set to
  `true` at deploy time — it defaults to `false` and no secret is created
  otherwise.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults*
section for setting-specific gotchas (including why `max_instance_count` and
`container_port` must be left at their defaults).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run
service, the Cloud Storage bucket (and with it the SQLite database and every
uploaded file — there is no separate backup of this data by default), the
optional API key secret, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, Artifact Registry) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions a single-instance Cloud Run service, GCS Fuse-mounted storage bucket, and builds the pinned Gokapi image |
| 2 — Access & verify | Manual | Health check passes; claim the first-run admin account immediately (public by default) |
| 3 — Operate | Manual | Inspect revisions, keep scaling at 1, update version, manage optional API key, inspect storage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and (optional) uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, GCS Fuse/SQLite, admin-claim race, secret, and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the SQLite DB and uploads |
