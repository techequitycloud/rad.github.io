---
title: "Navidrome on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Navidrome on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Navidrome on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Navidrome_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Navidrome is a free, open-source, self-hosted, Subsonic-compatible music streaming
server written in Go. It has no external database — its entire state (library,
users, playlists) lives in an embedded SQLite file. This lab takes you through the
full operational lifecycle of the **Navidrome on Cloud Run** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Navidrome product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Navidrome_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and retrieve the generated admin password.
- Perform day-2 operations — inspect revisions, mount a music library, manage
  secrets and backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Artifact
  Registry, and shared service accounts this module depends on — Navidrome itself
  needs no Cloud SQL instance).
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

1. In the RAD platform, open **Navidrome (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Navidrome_CloudRun)
   documents every input by group, with defaults. Note that the service defaults
   to `ingress_settings = internal` (VPC-private) and `enable_admin_password = true`
   (required if you plan to switch to public ingress). Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions the Cloud Run service, a dedicated Cloud Storage bucket
   mounted at `/data` via GCS FUSE (the SQLite database, metadata cache, and search
   index all live there), a Secret Manager secret holding a generated 24-character
   admin password, and mirrors the `deluan/navidrome` image into Artifact Registry.
   There is **no Cloud SQL instance and no database-initialisation job** — Navidrome
   creates and migrates its own SQLite database on first boot. First deploys
   typically complete in **5–15 minutes**, much faster than a database-backed
   module.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~navidrome" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

   With the default `ingress_settings = internal`, `$SERVICE_URL` is reachable only
   from within the VPC (e.g. from a Compute Engine VM or a Cloud Shell with VPC
   access) — not directly from your local machine.

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Navidrome exposes an unauthenticated ping
   endpoint that responds once the server has booted:

   ```bash
   curl -s "$SERVICE_URL/ping"   # expect {"status":"ok"}
   ```

2. Retrieve the generated admin password from Secret Manager:

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~navidrome-admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

3. Open `$SERVICE_URL` in a browser (from a VPC-connected host, or after
   temporarily switching `ingress_settings = all`) and log in as `admin` with the
   retrieved password. Change the password immediately after first login. If
   `enable_admin_password = false` was chosen instead, the first visitor completes
   a create-admin wizard — do this yourself right away.

4. The music library is empty until you mount one. Add a `gcs_volumes` entry (or
   enable NFS) pointing `/music` at your audio collection, then apply via
   **Update** — Navidrome scans `ND_MUSICFOLDER` (`/music`) on every start.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not scale beyond one instance.** `min_instance_count = 1` keeps the server
   warm (avoiding cold-start latency mid-stream); `max_instance_count = 1` must
   stay at 1 — Navidrome is a single-writer server, and multiple instances writing
   to the same SQLite file over GCS FUSE will corrupt the library. Both are
   configuration inputs on the deployment details page, not something to change
   with a manual `gcloud` edit (a manual edit would be reverted on the next apply).

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds (pinned via the
   `NAVIDROME_VERSION` build arg) and a new revision rolls out.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~navidrome"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # scheduled backup job, if configured
   ```

   The `backup_schedule` input (default `0 2 * * *` UTC) snapshots the `/data`
   bucket on a cron schedule; `backup_retention_days` controls how long snapshots
   are kept.

5. **Inspect the `/data` bucket** directly (useful for confirming persistence
   across revisions):

   ```bash
   gcloud storage ls gs://<data-bucket-name>/   # bucket name is in the storage_buckets output
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
   count, request latency, instance count, and CPU / memory utilisation (Navidrome
   holds its search index in memory, so watch memory closely on a large library).
   An **uptime check** is only provisioned when the endpoint is publicly reachable
   (custom domain, or `ingress_settings = all`) — with the default `internal`
   ingress, no uptime check fires; confirm under Monitoring → Uptime checks only
   after switching to public ingress.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Navidrome releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The startup probe targets `GET /ping` with a 15-second
  initial delay and a generous retry window; the liveness probe polls every 30
  seconds.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Empty library / no songs found:** confirm a `gcs_volumes` entry (or NFS mount)
  is actually attached at `/music` — the module does not mount a music source
  automatically, so an unconfigured deployment has nothing to scan.
- **Public URL rejected at plan time:** `ingress_settings = "all"` is blocked
  unless `enable_admin_password = true` — this is intentional, so a stranger can
  never reach an open first-run wizard on a public URL.
- **`/data` looks wiped after a redeploy:** confirm the storage bucket was not
  deleted or repointed — it is the single source of truth for the SQLite database,
  users, and playlists.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section
for setting-specific gotchas (including why `max_instance_count` must never exceed
1, and why `execution_environment` must stay `gen2`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
the `/data` Cloud Storage bucket (**this permanently deletes the music library
metadata, users, and playlists** — there is no Cloud SQL to separately back up),
the Secret Manager admin-password secret, and Artifact Registry images. Resources
owned by **Services_GCP** (the VPC, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the Cloud Run service, a `/data` GCS FUSE bucket, an admin-password secret, and mirrors the image — no Cloud SQL, no init job |
| 2 — Access & verify | Manual | Health check (`/ping`) passes; retrieve the generated admin password and log in; mount a music library at `/music` |
| 3 — Operate | Manual | Inspect revisions, keep scaling at 1/1, update version, manage secrets/backups, inspect `/data` |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics (uptime check only if publicly reachable) |
| 5 — Troubleshoot | Manual | Diagnose revision, empty-library, public-ingress-guard, and build/IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the `/data` bucket |
