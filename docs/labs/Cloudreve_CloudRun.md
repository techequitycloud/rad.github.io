---
title: "Cloudreve on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Cloudreve on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Cloudreve on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Cloudreve_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Cloudreve is an open-source, self-hosted cloud storage and file-sharing
platform written in Go, with a web UI for uploading, organising, previewing,
and sharing files. This lab takes you through the full operational lifecycle
of the **Cloudreve on Cloud Run** module on Google Cloud: deploy it, access
and verify it, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Cloudreve product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Cloudreve_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including retrieving the first-run
  admin password from Cloud Logging.
- Perform day-2 operations — inspect, scale (or rather, understand why not to),
  update, and manage the GCS FUSE-mounted data volume.
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

1. In the RAD platform, open **Cloudreve (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Cloudreve_CloudRun)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud Storage bucket
   (auto-mounted as a **GCS FUSE** volume at `/cloudreve` — this is the *only*
   persistence mechanism on Cloud Run, since Cloudreve stores its embedded
   SQLite database and uploaded files there), and builds the custom container
   image (a multi-stage Dockerfile that relocates the `cloudreve` binary to
   `/usr/local/bin/cloudreve` so the FUSE mount cannot shadow it). There is
   **no Cloud SQL instance and no Secret Manager secret** created for this
   module — Cloudreve mints its own admin password on first boot. First
   deploys typically take **10–20 minutes** (dominated by the image build).

3. When it completes, discover the resource with a name-agnostic filter (so
   the commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~cloudreve" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is up. Cloudreve has no dedicated health endpoint — its
   own startup/liveness probes target `/`, which returns HTTP 200 once the
   Go binary is serving:

   ```bash
   curl -sI "$SERVICE_URL"   # expect HTTP/2 200
   ```

2. **Retrieve the first-run admin password.** Cloudreve generates its own
   initial administrator account and password on first boot and prints the
   password to container stdout — there is **no Secret Manager secret** to
   read it from, and it is only logged **once**. Capture it immediately:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=200 \
     | grep -i "admin\|password"
   ```

   If the log buffer has already rotated past it, there is no other recovery
   path from outside the container — you would need to reset the account via
   whatever mechanism Cloudreve itself exposes for that release.

3. Open `$SERVICE_URL` in a browser and sign in with the admin account and the
   password captured above. Change the password immediately via the web UI's
   account settings, since the generated one only ever existed in a log line.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not scale beyond one instance.** `min_instance_count = max_instance_count
   = 1` by default, and this is intentional: Cloudreve has no verified
   multi-node/clustering mode, and the GCS FUSE-mounted embedded SQLite file
   has no protection against concurrent writers. Raising `max_instance_count`
   risks database corruption, not just added capacity — leave it at the
   platform default.

3. **Update the application version** by changing the version input in the
   RAD platform and applying it via **Update**. The Dockerfile pins
   `application_version = "latest"` to a specific verified release
   (`3.8.3`) via an app-specific `CLOUDREVE_VERSION` build ARG, so a rebuild
   reproduces a known-good image rather than floating to an untested upstream
   tag.

4. **Inspect the data volume** (the GCS bucket backing `/cloudreve`):

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~storage"
   gcloud storage ls gs://<data-bucket>/
   ```

   There is no `gcloud run` shell-exec equivalent for Cloud Run, so direct
   inspection of the mounted SQLite file has to go through the GCS bucket
   itself (or a one-off job) rather than an interactive session.

5. **Manage jobs** (only present if you supplied your own — Cloudreve injects
   no default database-init job, since it has no external database):

   ```bash
   gcloud run jobs list --project="$PROJECT" --region="$REGION"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer. This is also where the
   first-run admin password appears, so it is worth knowing the filter even
   after initial setup:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, request latency (P50/P95/P99), instance count (should stay
   at exactly 1), and CPU / memory utilisation — memory is worth watching
   under heavy file-transfer load. An uptime check can be enabled via
   `uptime_check_config` (disabled by default); if enabled, confirm it is
   green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These
are platform-level diagnostics and do not change with Cloudreve releases.

- **Revision unhealthy / crash loop with `exec ./cloudreve: no such file or
  directory`:** this is the volume-shadowing failure mode the module's
  Dockerfile is built to avoid (binary relocated to
  `/usr/local/bin/cloudreve`, outside the FUSE mount at `/cloudreve`). If you
  see it, something reverted that Dockerfile change — check
  `modules/Cloudreve_Common/scripts/Dockerfile` and rebuild:
  ```bash
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  tofu taint 'module.app_cloudrun.module.app_build.null_resource.build_and_push_application_image[0]'
  ```
- **Can't sign in / lost the admin password:** the password is printed to
  container logs only **once**, on first boot, and is never stored in Secret
  Manager. Search recent history (not just the last 200 lines) if the
  original capture was missed:
  ```bash
  gcloud logging read 'resource.type="cloud_run_revision"' --project="$PROJECT" --freshness=7d --limit=1000 \
    | grep -i "admin\|password"
  ```
- **Revision won't become Ready:** the startup probe is HTTP `GET /` with
  `failure_threshold = 10` (up to ~100 seconds) — a failure past that window
  usually means the GCS FUSE mount didn't attach or the binary itself failed
  to start; check `execution_environment = gen2` is set (required for GCS
  Fuse) and review the revision's logs.
- **Data appears to reset after a redeploy:** confirm the `storage` bucket
  still exists and is still mounted at `/cloudreve` — `create_cloud_storage`
  must stay `true`, and the bucket name must match what the foundation
  actually created.
- **403 / permission errors:** verify the runtime service account's IAM roles
  on the `storage` bucket.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults*
section for setting-specific gotchas (including why `max_instance_count` must
stay at `1` and why `container_port` should never be changed).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
the GCS FUSE data bucket (and everything stored in it, including the embedded
SQLite database and all uploaded files), and Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, shared registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, a GCS FUSE-mounted data bucket, and builds the custom image (no database, no secrets) |
| 2 — Access & verify | Manual | Health check passes; retrieve the first-run admin password from Cloud Logging and sign in |
| 3 — Operate | Manual | Inspect revisions, keep at single instance, update version, inspect the data bucket |
| 4 — Observe | Manual | Query Cloud Logging (including for the admin password); review Cloud Monitoring metrics |
| 5 — Troubleshoot | Manual | Diagnose volume-shadowing, lost-password, probe, and permission issues |
| 6 — Tear down | Automated | Delete (Trash) removes the service, data bucket, and images |
