---
title: "Ntfy on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Ntfy on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Ntfy on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ntfy_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

ntfy is an open-source pub/sub push-notification server: applications publish
messages over a simple REST/HTTP API and clients receive them instantly over
WebSocket or Server-Sent-Events streams, with no external database required. This
lab takes you through the full operational lifecycle of the **ntfy on Cloud Run**
module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe
it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on ntfy product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ntfy_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including a publish/subscribe smoke test.
- Perform day-2 operations — inspect, scale considerations, update, and manage
  secrets.
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

1. In the RAD platform, open **Ntfy (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Ntfy_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions a single Cloud Run v2 service running the ntfy Go
   binary and builds the container image. No database, cache, or object-storage
   bucket is provisioned — ntfy keeps its message cache in a local SQLite file.
   There is no database-initialisation job to wait for, so a first deploy is
   typically much faster than a database-backed module (roughly **5–10 minutes**,
   dominated by the image build).

3. When it completes, discover the service with a name-agnostic filter (so the
   command keeps working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~ntfy" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. ntfy's health endpoint responds as soon as the
   server binds its port — there is no database dependency to wait on:

   ```bash
   curl -s "$SERVICE_URL/v1/health"   # expect {"healthy":true}
   ```

2. Run a publish/subscribe smoke test:

   ```bash
   curl -d "hello from ntfy" "$SERVICE_URL/mytopic"     # publish
   curl -s "$SERVICE_URL/mytopic/json"                   # subscribe (streaming JSON; Ctrl-C to stop)
   ```

   Open `$SERVICE_URL/mytopic` in a browser to see the built-in web UI receive the
   message in real time.

3. ntfy ships with **open access** — any client can publish to or subscribe from
   any topic on the public URL. There is no admin account to create. If you need
   access control, configure users and per-topic ACLs post-deploy via ntfy's CLI
   (`ntfy user add`, `ntfy access`) or by setting `NTFY_AUTH_*` environment
   variables in `environment_variables` and applying via **Update**. If you plan to
   use attachments or browser web-push, also set `NTFY_BASE_URL` to `$SERVICE_URL`.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not scale beyond one instance.** `max_instance_count` defaults to `1` and
   should stay there — a subscriber's WebSocket/SSE stream is anchored to the
   instance holding it, and ntfy has no shared message bus. Scaling out silently
   splits subscribers across instances, so a message published against one
   instance is never delivered to a subscriber pinned to another. Any change to
   min/max instances is made via the RAD platform's deployment details page and
   applied via **Update**, not a manual `gcloud` edit (which would be reverted on
   the next apply).

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a new revision
   rolls out. Pin an explicit `v2.x.y` in production rather than relying on
   `latest`.

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~ntfy"
   ```

   ntfy generates no secrets of its own at deploy time — this list is only
   populated if you supplied entries via `secret_environment_variables`.

5. **Enable durable message history**, if the default ephemeral cache is not
   acceptable: set `enable_nfs = true` and point `NTFY_CACHE_FILE`'s directory at
   the NFS mount, then apply via **Update**. Without this, the SQLite cache is
   lost on every restart or redeploy.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.
   ntfy logs its listen address and resolved cache path on startup — check here
   first if the cache fell back to `/tmp/ntfy`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency, instance count, and CPU / memory utilisation. Because
   `cpu_always_allocated = true` by default, expect a steady CPU baseline even at
   low traffic — this is required to keep subscriber streams alive, not a
   misconfiguration. If a Cloud Monitoring **uptime check** is enabled, confirm it
   is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with ntfy releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The startup and liveness probes both target
  `/v1/health`, which should return `200` within seconds of boot — ntfy has no
  database to wait on, so a slow or failing probe usually points at a container
  build or config issue rather than a downstream dependency.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Messages "disappear" or subscribers don't see history:** check
  `max_instance_count` (should be `1`) and whether `enable_nfs` is set — with the
  default ephemeral cache, a restart or redeploy wipes message history by design,
  which is easy to mistake for a delivery bug.
- **Attachments or web-push links are broken:** confirm `NTFY_BASE_URL` is set to
  the service's actual public URL in `environment_variables`.
- **Publish/subscribe blocked unexpectedly:** check `ingress_settings` (must be
  `all` for public traffic) and whether `enable_iap` was turned on — IAP requires
  Google sign-in and blocks unauthenticated publish/subscribe calls, which is
  usually not what a notification endpoint wants.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section
for setting-specific gotchas (including keeping `max_instance_count = 1` and
`cpu_always_allocated = true` for correct real-time delivery).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service
and Artifact Registry images. There is no Cloud SQL database, GCS bucket, or
auto-generated secret to clean up (ntfy provisions none by default). Resources
owned by **Services_GCP** (the VPC, shared registry) are managed separately and are
not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions a single Cloud Run service running ntfy; no database or storage bucket |
| 2 — Access & verify | Manual | Health check passes; publish/subscribe smoke test confirms real-time delivery |
| 3 — Operate | Manual | Inspect revisions, keep max instances at 1, update version, manage secrets, enable NFS for durability |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, cache-persistence, access, and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
