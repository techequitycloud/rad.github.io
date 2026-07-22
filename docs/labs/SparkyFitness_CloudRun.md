---
title: "SparkyFitness on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy SparkyFitness on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# SparkyFitness on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/SparkyFitness_CloudRun)**

## Overview

**Estimated time:** 45–75 minutes

SparkyFitness is a self-hosted, AI-assisted family food, fitness, water, and health
tracker. This lab takes you through the full operational lifecycle of the
**SparkyFitness on Cloud Run** module on Google Cloud: deploy it, access and verify
it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**,
not on SparkyFitness product features. For the complete list of provisioned services
and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/SparkyFitness_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running application, including its two-container architecture.
- Perform day-2 operations — inspect, scale, update, and manage secrets.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL,
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

1. In the RAD platform, open **SparkyFitness (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/SparkyFitness_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform provisions a **single multi-container Cloud Run service** (frontend
   as the ingress container, backend as an in-pod sidecar), a Cloud SQL (PostgreSQL
   15) database with its Secret Manager secrets
   (`SPARKY_FITNESS_API_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`,
   `SPARKY_FITNESS_APP_DB_PASSWORD`, and the database password), and runs a one-shot
   `db-init` job. First deploys take roughly **15–25 minutes** (Cloud SQL creation
   dominates). Both container images are prebuilt — no application build step runs.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~sparkyfitness" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the frontend (ingress container) is serving:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL"   # expect 200
   ```

2. Open `$SERVICE_URL` in a browser. On first visit, sign up to create the first
   user account — SparkyFitness has no pre-seeded admin credential in Secret
   Manager. `SPARKY_FITNESS_ADMIN_EMAIL` only ELEVATES an existing account, it does
   not create one, so signup must happen first.

3. After creating the account, set `admin_email` to that user's email in the RAD
   platform and click **Update** to grant it admin privileges. Consider setting
   `disable_signup = true` afterward to prevent further open registration.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service, its revisions, and both containers** (each deploy creates
   an immutable revision containing both the frontend and backend containers):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions describe "$(gcloud run revisions list --service="$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format='value(name)' --limit=1)" \
     --project="$PROJECT" --region="$REGION" --format='value(spec.containers[].name)'
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the service spec, so scaling is a
   configuration change, not a manual `gcloud` edit (a manual edit would be reverted
   on the next apply).

3. **Update the application version tag** by changing `application_version` in the
   RAD platform and applying it via **Update**. It tags BOTH the frontend and
   backend images identically — use the exact upstream tag format (e.g. `v0.17.3`,
   not a bare `0.17.3`).

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~sparkyfitness"
   ```

5. **Open a database session** for inspection or maintenance (connect as the admin
   role — the app-level role is managed internally by the backend):

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=sparky --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer. Both containers' logs flow to the
   same stream, tagged by container name:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter for the backend sidecar only:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>" AND labels."k8s-pod/app"="backend"`
   (verify the exact label key against a sample log entry — Cloud Run's
   multi-container log labeling may vary by revision).

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and
   CPU / memory utilisation. The module can provision an **uptime check** (when
   `uptime_check_config.enabled = true` — it defaults to `false`); if enabled,
   confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with SparkyFitness releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors on BOTH containers.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **502/504 on `/api/*` calls but the frontend loads fine:** the backend sidecar
  likely hasn't passed its `startup_tcp_port` check yet (its first-boot migrations
  can take longer than expected), or the sidecar crashed — check the backend
  container's logs specifically.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret exists, and the `db-init` job completed successfully. Also
  verify the backend can actually reach the Cloud SQL private IP over TCP — Cloud
  Run's `additional_containers`/`inherit_app_env` mechanism always injects the raw
  IP (not a Unix socket) for a sidecar, so a Cloud SQL instance that enforces SSL
  may need a follow-up investigation.
- **`db-init` job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `BETTER_AUTH_SECRET` after
users enable 2FA).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can
no longer manage it (for example after manual changes that conflict with the
Terraform state), use **Purge** instead — it removes the deployment from RAD's
records **without** destroying the cloud resources (it makes RAD forget the
project). Delete removes everything the module created — the Cloud Run service,
Cloud SQL database, and Secret Manager secrets. Resources owned by **Services_GCP**
(the VPC, shared Cloud SQL, registry) are managed separately and are not removed
here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions a multi-container Cloud Run service, Cloud SQL (PostgreSQL 15), secrets, and runs DB init |
| 2 — Access & verify | Manual | Frontend serves 200; sign up to create the first account, then set `admin_email` |
| 3 — Operate | Manual | Inspect revisions/containers, scale, update version, manage secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging for both containers; review Cloud Monitoring metrics |
| 5 — Troubleshoot | Manual | Diagnose revision, sidecar, database, init-job, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
