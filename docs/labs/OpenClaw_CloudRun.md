---
title: "OpenClaw on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy OpenClaw on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# OpenClaw on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenClaw_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

OpenClaw is a multi-tenant AI agent gateway for running isolated, persistent AI assistants
backed by Anthropic models, with dedicated GCS-Fuse workspaces and optional Telegram or
Slack channel integration. This lab takes you through the full operational lifecycle of the
**OpenClaw on Cloud Run** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on
OpenClaw product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenClaw_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Serverless VPC Access,
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

1. Click **Deploy** in the RAD platform top navigation, open **OpenClaw (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. An Anthropic API key is required on the first deploy — set it in the
   corresponding input field. Configure only what else you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenClaw_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform builds a custom container image (layering `entrypoint.sh` onto the
   upstream OpenClaw image), creates a GCS workspace bucket mounted at `/data` via
   GCS Fuse, stores the Anthropic API key and gateway token in Secret Manager, and
   deploys the Cloud Run service. OpenClaw requires no Cloud SQL or init job — agent
   state lives entirely on GCS. First deploys take roughly **10–20 minutes** (Cloud
   Build dominates).

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~openclaw" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. By default, `ingress_settings = "internal"` restricts the service to VPC traffic.
   For direct access in this lab, use the `gcloud` proxy:

   ```bash
   gcloud run services proxy "$SERVICE" \
     --region="$REGION" --project="$PROJECT" --port=8080
   # Access at http://localhost:8080
   ```

   Alternatively, set `ingress_settings = "all"` in the RAD platform and apply it via **Update**.

2. Confirm the service is healthy:

   ```bash
   curl -s http://localhost:8080/health   # expect {"status":"ok"}
   ```

3. Retrieve the gateway token from Secret Manager to authenticate API calls:

   ```bash
   GW_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~openclaw~gateway-token" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$GW_SECRET" --project="$PROJECT"
   ```

   The gateway token is the credential used by OpenClaw clients and integrations. The
   Anthropic API key can similarly be retrieved from its Secret Manager secret if needed
   (filter on `~openclaw~anthropic-api-key`).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the service spec, so scaling is a configuration change, not a
   manual `gcloud` edit (a manual edit would be reverted on the next apply). Note that
   OpenClaw is stateful; keep `max_instance_count = 1` per tenant unless sticky
   routing is in place.

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds and a new revision rolls out.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~openclaw"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # scheduled backup jobs
   ```

5. **Inspect the GCS workspace** that backs all agent state:

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~openclaw~storage" --format="value(name)" --limit=1)
   gcloud storage ls "gs://${BUCKET}/"
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
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and CPU
   / memory utilisation. The module also provisions an **uptime check** (when enabled);
   confirm it is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with OpenClaw releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The startup probe targets `GET /health` on port 8080 and
  allows roughly 2 minutes for GCS Fuse mount and Node.js startup.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **GCS Fuse mount failure:** confirm the workspace bucket exists and that the
  runtime service account has Storage Object Admin on it. The service requires
  Gen2 execution environment — Gen1 does not support GCS Fuse and will silently fail.
- **Anthropic API errors (401):** confirm the `anthropic-api-key` secret has a
  valid version. Retrieve and verify it via Secret Manager.
- **Gateway token errors:** if clients receive auth failures after a secret rotation,
  the service must be updated to pick up the new token value.
- **Skills repository clone failure:** an unreachable or non-existent `skills_repo_url`
  / `skills_repo_ref` causes the container to fail at startup. Check Cloud Logging for
  `skill-library` entries and correct the URL/ref in the RAD platform.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service, GCS
workspace bucket, Secret Manager secrets, and Artifact Registry images. Resources owned
by **Services_GCP** (the VPC, shared registry) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the image, provisions the GCS workspace, stores secrets, and deploys Cloud Run |
| 2 — Access & verify | Manual | Proxy or public access; health check passes; gateway token retrieved |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, inspect GCS workspace |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, GCS Fuse, Anthropic API, gateway token, skills-sync, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
