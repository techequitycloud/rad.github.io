---
title: "Excalidraw on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Excalidraw on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Excalidraw on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Excalidraw_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Excalidraw is an open-source virtual whiteboard for sketching hand-drawn-style
diagrams, wireframes, and quick collaborative drawings. The self-hosted distribution is
a **static single-page application served by nginx** — there is no backend, database, or
user accounts. This lab takes you through the full operational lifecycle of the
**Excalidraw on Cloud Run** module on Google Cloud: deploy it, access and verify it, run
it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not
on Excalidraw product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Excalidraw_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, and update the deployment.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Artifact Registry,
  and shared service accounts this module depends on).
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

1. In the RAD platform, open **Excalidraw (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Excalidraw_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits
   are enabled) and click **Deploy**, which opens the deployment status page with
   real-time logs.

2. The platform builds a thin custom image (`FROM excalidraw/excalidraw`), mirrors it
   into Artifact Registry, and provisions the Cloud Run service. There is **no Cloud
   SQL instance, no Secret Manager secret, no GCS bucket, and no Redis** — Excalidraw is
   a fully stateless static frontend, so this deploy is one of the fastest in the
   catalogue, typically **5–10 minutes** (dominated by the image build).

3. When it completes, discover the resource with a name-agnostic filter (so the command
   keeps working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~excalidraw" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. nginx answers the root path with `200` as soon as
   the revision is serving — there is no database or backend to wait on:

   ```bash
   curl -sI "$SERVICE_URL/" | head -1     # expect: HTTP/2 200
   ```

2. Open `$SERVICE_URL` in a browser. The whiteboard loads immediately — there is no
   login, no admin account, and no first-run setup. Draw something and use **Export**
   (menu → Export) to save a `.excalidraw`, PNG, or SVG file; this is the only
   persistence mechanism, since drawings otherwise live only in the browser's local
   storage.

3. Note that the live "shareable link" real-time collaboration feature is **not**
   available — it depends on a separate `excalidraw-room` WebSocket server that this
   module does not deploy. Single-user editing works fully out of the box.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the max-instance input and clicking **Update** on the
   deployment details page — the module owns the service spec, so scaling is a
   configuration change, not a manual `gcloud` edit (a manual edit would be reverted on
   the next apply). `min_instance_count` is forced to `0` by the wrapper: Excalidraw has
   no background work to keep warm, so scale-to-zero is always on and idle deployments
   cost nothing. Because every request is served identically from static files, there is
   no session affinity to worry about when scaling out.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds from a new `excalidraw/excalidraw`
   tag and a new revision rolls out. Because there is no server-side state, upgrades and
   rollbacks are trivial — traffic can be shifted back to a prior revision at any time
   with no data-consistency concerns.

4. **Confirm there is nothing else to manage:** unlike most modules, Excalidraw has no
   secrets, backup jobs, or database to inspect:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~excalidraw"          # (none)
   gcloud sql instances list --project="$PROJECT" --filter="name~excalidraw"    # (none)
   gcloud run jobs list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~excalidraw"                                       # (none)
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer (nginx access/error logs):

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and
   CPU / memory utilisation. Because the app is a static file server, latency should be
   consistently low and CPU usage minimal. The module also provisions an **uptime
   check**; confirm it is green under Monitoring → Uptime checks, and review
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Excalidraw releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The startup probe targets the root `/`, which nginx should
  answer within a second or two — a persistently failing probe almost always means a
  container/image problem, not an app dependency (there is no database to wait on).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Startup probe never passes / wrong port:** confirm the running revision's listening
  port matches the baked-in nginx port (`80`) — this is fixed in the image and should
  not be changed via `container_port`:
  ```bash
  gcloud run services describe "$SERVICE" --region="$REGION" \
    --format='value(spec.template.spec.containers[0].ports[0].containerPort, spec.template.spec.containers[0].image)'
  ```
- **`Image not found`:** confirm `container_image_source` is `custom` (the default) and
  that the Cloud Build history shows a successful build/push into Artifact Registry.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.
- **Whiteboard unreachable from a browser:** confirm `ingress_settings` is `all` (the
  default) — `internal` restricts access to the VPC only.
- **Real-time collaboration doesn't work:** this is expected — the module does not
  deploy the separate `excalidraw-room` WebSocket server that the "shareable link"
  feature requires.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the fixed port and the `latest`-tag caveat for production use).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service and
its Artifact Registry image. There is no Cloud SQL database, Secret Manager secret, or
GCS bucket to clean up, since none were created. Resources owned by **Services_GCP**
(the VPC, shared registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds and mirrors the static image, provisions the Cloud Run service — no database, secrets, or storage |
| 2 — Access & verify | Manual | Health check passes instantly; whiteboard loads with no login or setup |
| 3 — Operate | Manual | Inspect revisions, scale (scale-to-zero forced), update version — no secrets/DB/backups to manage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, port, build, and ingress issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
