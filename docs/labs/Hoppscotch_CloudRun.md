---
title: "Hoppscotch on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Hoppscotch on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Hoppscotch on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Hoppscotch_CloudRun)**

## Overview

**Estimated time:** 20–40 minutes

Hoppscotch is an open-source, Postman-style API development platform for designing,
sending, and inspecting HTTP, GraphQL, and WebSocket requests from the browser. This
lab takes you through the full operational lifecycle of the **Hoppscotch on Cloud
Run** module on Google Cloud: deploy it, access and verify it, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**,
not on Hoppscotch product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Hoppscotch_CloudRun) —
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

1. In the RAD platform, open **Hoppscotch (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Hoppscotch_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform builds a thin custom container image (`FROM
   hoppscotch/hoppscotch-frontend`) with Cloud Build, mirrors it into Artifact
   Registry, and provisions a Cloud Run service listening on port 3000. Hoppscotch is
   deliberately stateless — no Cloud SQL instance, no Secret Manager secrets, and no
   Cloud Storage bucket are created. With no database to provision, a first deploy
   typically completes in a few minutes once the image build finishes.

3. When it completes, discover the resource with a name-agnostic filter (so the
   command keeps working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~hoppscotch" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is serving. Hoppscotch has no backend to be reachable from —
   the root path returns the app UI as soon as Caddy binds port 3000:

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/"   # expect 200
   ```

2. Open `$SERVICE_URL` in a browser. Unlike most modules, Hoppscotch has **no
   first-run admin account to create** — the self-hosted frontend has no login or
   user management of its own. You can start building requests immediately.
   Collections, environments, and history are kept in the browser's local storage on
   each user's machine, not on the server.

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
   on the next apply). Because Hoppscotch keeps no shared queue or database, scaling
   is unconstrained — raise `max_instance_count` freely as a cost/throughput ceiling.
   The default `min_instance_count = 0` scales to zero between requests; the first
   request after idle incurs a brief cold start, which is cheap for a static SPA.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a new revision
   rolls out. `HOPPSCOTCH_VERSION` (not the generic `APP_VERSION`) pins the upstream
   `hoppscotch-frontend` tag, so `application_version = "latest"` resolves to a
   pinned, known-good tag at build time rather than the literal string `latest`.

4. **Check secrets** — Hoppscotch provisions none by design; confirm nothing
   unexpected shows up:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~hoppscotch"
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
   count, request latency, instance count (scaling behaviour), and CPU / memory
   utilisation. The module can provision an **uptime check** against `/`; confirm it
   is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Hoppscotch releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs. The startup and liveness probes target the root `/`, which returns HTTP 200
  within seconds of Caddy binding port 3000 — a failing probe almost always means the
  image tag is invalid, not that a backend is unreachable (there is no backend).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Image build failed:** review Cloud Build history for the failed build's log — an
  invalid `application_version` tag most commonly surfaces as `MANIFEST_UNKNOWN`.
  ```bash
  gcloud builds list --project="$PROJECT" --region="$REGION" --limit=5
  ```
- **Wrong container port:** the frontend serves only on port 3000; confirm
  `container_port = 3000` if the startup probe never passes.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including why `container_image_source` must stay `custom` and why
`database_type`/`enable_cloudsql_volume` should stay off).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service
and its Artifact Registry image (Hoppscotch provisions no database, secrets, or
storage buckets, so there is nothing else to clean up). Resources owned by
**Services_GCP** (the VPC, shared registry) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the custom image and provisions the Cloud Run service — no database, secrets, or storage bucket |
| 2 — Access & verify | Manual | Health check passes; open the URL and start using Hoppscotch immediately (no admin account) |
| 3 — Operate | Manual | Inspect revisions, scale (unconstrained), update version, confirm no secrets |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, build, port, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes the Cloud Run service and image |
