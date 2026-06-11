---
title: "SearXNG on Cloud Run \u2014 Lab Guide"
---

# SearXNG on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/SearXNG_CloudRun)**

## Overview

**Estimated time:** 30–60 minutes

SearXNG is a privacy-respecting, self-hosted metasearch engine that aggregates
results from 70+ search services without tracking users or serving ads. This lab
takes you through the full operational lifecycle of the **SearXNG on Cloud Run**
module on Google Cloud: deploy it, access and verify it, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on SearXNG product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/SearXNG_CloudRun)
— this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, update, and manage secrets.
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

1. Click **Deploy** in the RAD platform top navigation, open **SearXNG (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/SearXNG_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, generates the `SEARXNG_SECRET`
   session key in Secret Manager, and builds or mirrors the container image. Because
   SearXNG is fully stateless (no database, no init job), first deploys complete
   in a few minutes.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~searxng" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "${SERVICE_URL}/healthz"
   ```

   Expect HTTP `200`. SearXNG serves its built-in health endpoint at `/healthz`.
   If you see `503`, a new instance is cold-starting — wait a few seconds and
   retry. Cold starts are fast (under 5 seconds) because there is no database
   connection or schema migration on startup.

2. Open `$SERVICE_URL` in a browser to reach the SearXNG search interface.
   No admin credential is required — SearXNG has no admin login.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs in the RAD platform and
   applying it via **Update** — the module owns the service spec, so scaling is a configuration
   change, not a manual `gcloud` edit (a manual edit would be reverted on the
   next apply). Note that `min_instance_count` is fixed at 0; the service scales
   to zero when idle.

3. **Update the application version** by changing the version input in the RAD
   UI and applying it via **Update**; a new image builds and a new revision rolls out.

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~searxng"
   ```

   The `SEARXNG_SECRET` is the auto-generated session key injected at runtime.
   It is generated once and shared across all running instances. Rotating it
   invalidates all active user sessions — avoid rotation unless required.

5. **Inspect Cloud Run jobs** (SearXNG requires no init or scheduled jobs by
   default, but any cron jobs you configure appear here):

   ```bash
   gcloud run jobs list --project="$PROJECT" --region="$REGION"
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
   request count, request latency (P50/P95/P99), instance count (scaling
   behaviour), and CPU / memory utilisation. The module also provisions an
   **uptime check** (when enabled); confirm it is green under
   Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with SearXNG releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs for startup errors, and confirm env vars and secrets resolved.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Empty search results / upstream engines unreachable:** SearXNG must reach
  external search engines over the internet. If `vpc_egress_setting` is
  `PRIVATE_RANGES_ONLY` and Cloud NAT is not configured, outbound internet
  traffic is blocked. Switch to `ALL_TRAFFIC` or add a Cloud NAT gateway.
- **`SEARXNG_SECRET` not resolved:** confirm the secret exists and the runtime
  service account has `secretmanager.versions.access`.
  ```bash
  gcloud secrets list --project="$PROJECT" --filter="name~searxng"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Secret Manager secrets, and Artifact Registry images. SearXNG is stateless so
there is no database or persistent storage to remove. Resources owned by
**Services_GCP** (the VPC, shared registry) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, generates SEARXNG_SECRET, mirrors image |
| 2 — Access & verify | Manual | Health check passes at `/healthz`; search interface loads |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, egress, secret, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
