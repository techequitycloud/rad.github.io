---
title: "Chibisafe on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Chibisafe on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Chibisafe on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Chibisafe_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Chibisafe is a self-hosted file and image uploader with drag-and-drop uploads,
albums, and a public API. This module deploys the **full Chibisafe stack** —
the chibisafe-server backend, the Next.js web UI and a Caddy reverse proxy,
combined in one custom-built image and listening on port 8000 — as a single
Cloud Run v2 service with no external database — SQLite, uploads, and logs all live on one Cloud Storage
bucket mounted via GCS Fuse. This lab takes you through the full operational
lifecycle of the **Chibisafe on Cloud Run** module: deploy it, access and
verify it, run it day-to-day, observe it, diagnose common problems, and tear
it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Chibisafe product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Chibisafe_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access the Chibisafe web UI and verify the service through its health endpoint.
- Perform day-2 operations — inspect revisions, manage the optional admin
  secret, and understand why the service is pinned to a single instance.
- Inspect the SQLite/uploads/logs state on the Cloud Storage-backed volume.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP** (provides the VPC, Artifact Registry, and shared service
  accounts this module depends on). You do not need to deploy this yourself
  first — the platform automatically detects whether it already exists in the
  target project and provisions it before this module if not (see Task 1).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **Bringing your own project?** Before the first deploy into it, the deployment confirmation dialog asks you to prove you control it (**Get verification code**, run the commands it shows as a project Owner, then **Verify**) and to give the RAD deployment service account the **Owner** role. A project RAD creates for you needs neither.
- **Advanced mode for later changes.** The create form asks only for the first page of inputs (and, in a project RAD creates for you, little more than the tenant name and region). Every other input in the Configuration Guide — including the scaling and version inputs in the Day-2 tasks — is changed afterwards with **Update** on the deployment's page after ticking **Enable advanced mode**, which needs a credit balance that covers the update's estimated build cost (updates never carry a module fee). On a lab environment only an administrator can use Advanced mode.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Chibisafe (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Chibisafe_CloudRun)
   documents every input by group, with defaults. Click **Deploy Module**, review
   the estimated cost in the confirmation dialog (if credits are enabled) and click **Confirm**, which opens the deployment
   status page with real-time logs.

2. The platform builds and pushes the custom chibisafe-server image (pinned to
   `v6.5.5` unless you set a specific version), provisions the Cloud Run v2
   service, and always provisions a `storage` Cloud Storage bucket mounted at
   `/data` via GCS Fuse. No Cloud SQL instance is created — `database_type` is
   fixed to `NONE`. If `enable_api_key = true`, a random admin-password secret
   is also created in Secret Manager. There is no database to provision, so
   first deploys typically take **10–20 minutes** (the custom image build
   dominates).

3. When it completes, discover the resources with name-agnostic filters (so
   the commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~chibisafe" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Inside the container, Caddy routes
   `/api/*` (and the `/docs` OpenAPI reference) to the backend, serves uploaded
   files by name, and sends everything else to the web UI. The health endpoint
   exercises both the proxy and the backend:

   ```bash
   curl -s "$SERVICE_URL/api/health"   # expect HTTP 200, {"status":"yes"}
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/"   # expect 200 — the Chibisafe web UI (HTML)
   ```

2. Open `$SERVICE_URL` in a browser — the Chibisafe web UI loads (dashboard,
   login, uploads, albums). The REST API is at `$SERVICE_URL/api` (the module's
   `api_url` output), which is what ShareX-style clients point at.

3. **Admin credential:** log in to the dashboard as `admin`. By default
   (`enable_api_key = false`) the first-run administrator account uses
   Chibisafe's upstream default password (`admin`) — change it immediately
   after first login. To avoid the well-known default entirely, redeploy with
   `enable_api_key = true`; the module then generates a random value, stores it
   in Secret Manager and injects it as `ADMIN_PASSWORD`. Retrieve it with:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~chibisafe AND name~api-key"
   gcloud secrets versions access latest --secret=<api-key-secret-name> --project="$PROJECT"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not scale beyond one instance.** `min_instance_count = max_instance_count
   = 1` by default and this is a hard requirement, not a tunable default:
   Chibisafe is a single-writer SQLite application sharing one GCS Fuse mount,
   and GCS Fuse's POSIX file-locking semantics are weaker than a real
   filesystem. A second concurrent writer risks corrupting the SQLite
   database. If you need durable, safely-scalable storage, use
   `Chibisafe_GKE` (block PVC) instead.

3. **Update the application version** by changing the `application_version`
   input in the RAD platform and applying it via **Update**; the image is
   rebuilt with the pinned `CHIBISAFE_VERSION` build arg and a new revision
   rolls out.

4. **Manage the optional admin secret:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~chibisafe"
   ```

5. **Inspect the stored state directly** — there is no database client to
   connect with; SQLite, uploads, and logs live on the mounted bucket:

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~chibisafe" --format="value(name)" --limit=1)
   gcloud storage ls "gs://${BUCKET}/database" "gs://${BUCKET}/uploads" "gs://${BUCKET}/logs"
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
   request count, request latency, instance count, and CPU / memory
   utilisation (expect a flat single instance under normal use). An uptime
   check is available but **disabled by default**
   (`uptime_check_config.enabled = false`) — enable it once you have a stable
   public URL, then confirm it green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Chibisafe releases.

- **Revision unhealthy / restart loop:** the startup and liveness probes
  target `/api/health` by default, which passes through Caddy to the backend
  and returns a literal 200 `{"status":"yes"}`. Keep them there — `/` is served
  by the web UI and does not exercise the backend. The container runs the
  backend, web UI and Caddy under one supervisor that exits if any of them
  dies, so a crash in any process shows up as a restart; the logs name which.
  If you have overridden `startup_probe` / `liveness_probe`, revert the path
  to `/api/health`.
- **Uploads larger than 32 MiB fail:** Cloud Run caps HTTP/1 request bodies at
  32 MiB, while Chibisafe's default upload chunk size is larger (~81 MB). Lower
  **Chunk Size** in the dashboard's settings to below 32 MiB.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Uploads or the database appear to reset or corrupt:** GCS Fuse's POSIX
  file-locking semantics are not fully safe for sustained/concurrent SQLite
  writes. Confirm `max_instance_count = 1` has not been changed, and treat
  this Cloud Run variant as suited to light/low-traffic use — move to
  `Chibisafe_GKE` (block PVC) for heavier or production workloads.
- **Service unreachable despite passing health checks:** confirm
  `ingress_settings = "all"` (public) — this module was historically swept up
  in a fleet-wide bug that defaulted some modules' ingress to `internal`; the
  current source default is correctly `all`, but verify your deployed
  configuration.
- **403 / permission errors:** verify the runtime service account's IAM roles.
- **Image build failed:** review Cloud Build history for the failed build's log.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the persistence-model risk, the
`enable_api_key` security trade-off, and the inert `startup_probe_config` /
`health_check_config` / `enable_redis` / `enable_cloudsql_volume` variables).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead (from the same **Delete** dialog) — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the deployment). This removes everything the module created — the Cloud Run service,
the Cloud Storage data bucket (SQLite database, uploads, and logs), and the
optional admin-password secret. There is no Cloud SQL database to remove — none
was ever created. Resources owned by **Services_GCP** (the VPC, Artifact
Registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the custom image and provisions Cloud Run, a GCS data bucket (`/data` via GCS Fuse), and an optional admin secret — no Cloud SQL |
| 2 — Access & verify | Manual | Health check at `/api/health` passes; the Chibisafe web UI loads at `/`; log in as `admin` and change the password |
| 3 — Operate | Manual | Inspect revisions, update version, manage the admin secret, inspect SQLite/uploads/logs on the bucket; never scale past 1 instance |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and optional uptime check |
| 5 — Troubleshoot | Manual | Diagnose probe-path, upload-size, GCS Fuse write-safety, ingress, IAM, and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes the service, bucket, and optional secret |
