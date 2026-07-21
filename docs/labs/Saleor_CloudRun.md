---
title: "Saleor on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Saleor on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Saleor on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Saleor_CloudRun)**

## Overview

**Estimated time:** 60–90 minutes

Saleor is an open-source, GraphQL-first headless e-commerce platform (product
catalog, checkout, orders, payment plugins) built on Python/Django. This lab takes
you through the full operational lifecycle of the **Saleor on Cloud Run** module on
Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Saleor product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Saleor_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify both the Saleor API and the separate Dashboard service.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
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

1. In the RAD platform, open **Saleor (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Saleor_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform provisions two Cloud Run services (the main Saleor API and a
   separate Dashboard), a Cloud SQL (PostgreSQL 15) database with its Secret
   Manager secrets (`SECRET_KEY`, `RSA_PRIVATE_KEY`, `DJANGO_SUPERUSER_PASSWORD`,
   and the database password), a Cloud Storage `media` bucket, builds the custom
   container image, and runs two sequential database-initialization jobs
   (`db-init` then `db-migrate`). First deploys take roughly **20–35 minutes**
   (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~saleor AND NOT metadata.name~dashboard" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   DASHBOARD=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~saleor AND metadata.name~dashboard" --format="value(metadata.name)" --limit=1)
   DASHBOARD_URL=$(gcloud run services describe "$DASHBOARD" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "API:       $SERVICE ($SERVICE_URL)"
   echo "Dashboard: $DASHBOARD ($DASHBOARD_URL)"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the API is healthy:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/health/"   # expect 200
   ```

2. Run a real GraphQL query to confirm the schema and database wiring work end to
   end:

   ```bash
   curl -s -X POST "$SERVICE_URL/graphql/" \
     -H 'Content-Type: application/json' \
     -d '{"query":"{ shop { name } }"}'
   ```

3. Retrieve the bootstrap superuser credential and log in through the Dashboard:

   ```bash
   gcloud secrets versions access latest \
     --secret="$(gcloud secrets list --project="$PROJECT" --filter="name~saleor-admin-password" --format='value(name)')" \
     --project="$PROJECT"
   ```

   Open `$DASHBOARD_URL` in a browser and sign in with `admin@example.com` and the
   retrieved password (the default `SALEOR_SUPERUSER_EMAIL` — override via
   `environment_variables` on the wiring file before deploying if a different
   address is needed).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the API service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the service spec, so scaling is a
   configuration change, not a manual `gcloud` edit (a manual edit would be
   reverted on the next apply). `cpu_always_allocated = true` remains on
   regardless of instance count — the co-located Celery worker needs continuous
   CPU on every running instance.

3. **Update the application version tag** by changing `application_version` in the
   RAD platform and applying it via **Update**; a new image builds (mapped to the
   `SALEOR_VERSION` build ARG) and a new revision rolls out.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~saleor"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init, db-migrate, scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=saleor_user --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer, for both services:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   gcloud run services logs read "$DASHBOARD" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for each service and review
   request count, request latency (P50/P95/P99), instance count (scaling
   behaviour), and CPU / memory utilisation — the API service's CPU floor stays
   non-zero even between requests because `cpu_always_allocated = true`. The
   module can provision an **uptime check** (when `uptime_check_config.enabled =
   true` — it defaults to `false`); if enabled, confirm it is green under
   Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Saleor releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved. The startup
  probe targets `/health/` with a 20-second initial delay and a 20-failure
  threshold.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret exists, and both `db-init` and `db-migrate` completed
  successfully (in order — `db-migrate` depends on `db-init`).
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-db-migrate" \
    --project="$PROJECT" --region="$REGION"
  ```
- **GraphQL query fails with a database error even though the API is Ready:**
  usually means `db-migrate` did not complete — check its execution logs before
  assuming an application bug.
- **Dashboard loads but can't reach the API:** the Dashboard's `API_URL` is baked
  into its static bundle at container start from the main API's *predicted* URL —
  if the API's actual `run.app` URL differs (e.g. after a service rename), the
  Dashboard needs to be rebuilt/redeployed to pick up the corrected URL.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `RSA_PRIVATE_KEY` outside a
maintenance window).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can
no longer manage it (for example after manual changes that conflict with the
Terraform state), use **Purge** instead — it removes the deployment from RAD's
records **without** destroying the cloud resources (it makes RAD forget the
project). Delete removes everything the module created — both Cloud Run services
(API and Dashboard), the Cloud SQL database, Secret Manager secrets, the GCS
`media` bucket, and Artifact Registry images. Resources owned by **Services_GCP**
(the VPC, shared Cloud SQL instance, registry) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions two Cloud Run services (API + Dashboard), Cloud SQL (PostgreSQL 15), secrets, `media` bucket, and runs `db-init` → `db-migrate` |
| 2 — Access & verify | Manual | Health check and GraphQL query pass; log into the Dashboard with the bootstrap admin credential |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics for both services and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, Dashboard-linkage, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
