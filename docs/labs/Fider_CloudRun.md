---
title: "Fider on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Fider on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Fider on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Fider_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Fider is an open-source, self-hosted feedback and feature-voting board — customers
post ideas, vote, and comment, and you prioritise your roadmap by demand. This lab
takes you through the full operational lifecycle of the **Fider on Cloud Run**
module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe
it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Fider product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Fider_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access the service and complete Fider's first-run site/admin setup.
- Perform day-2 operations — inspect, scale, update, and manage secrets and the
  database.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL,
  Filestore NFS, Artifact Registry, and shared service accounts this module
  depends on).
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

1. In the RAD platform, open **Fider (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Fider_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secrets (`JWT_SECRET` and the database
   password), a Cloud Storage data bucket, a Cloud Filestore NFS mount for
   attachments (enabled by default), builds the container image, and runs a
   one-shot database-initialisation job that creates the `fider` role and
   database. First deploys take roughly **20–35 minutes** (Cloud SQL creation
   dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~fider" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Fider exposes an unauthenticated `/_health`
   endpoint that returns `200` once the server has booted and run its schema
   migrations:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/_health"   # expect 200
   ```

   Allow up to **~7 minutes** on first boot — the startup probe gives a 30-second
   initial delay plus a 30-failure retry window at a 15-second period while
   `./fider migrate` runs and the server comes up.

2. Open `$SERVICE_URL` in a browser. There are no default credentials — the first
   visit walks you through creating the **site** and its **admin owner** account.
   Complete this immediately after deploy.

3. Email is disabled for the demo (`EMAIL_NOEMAIL = true`), so sign-up and invite
   links are printed to the container log rather than sent. Check the logs if you
   invite additional users before wiring real SMTP:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50 \
     | grep -i "sign-in\|invite"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the service spec, so scaling is
   a configuration change, not a manual `gcloud` edit (a manual edit would be
   reverted on the next apply). Fider has no background worker, so
   `min_instance_count = 0` (scale-to-zero) is data-safe if you prefer to trade a
   cold start for lower cost; the default `min=1` with `cpu_always_allocated=true`
   keeps it consistently warm instead.

3. **Update the application version** by changing the `application_version` input
   in the RAD platform and applying it via **Update**; a new image builds and a
   new revision rolls out. Fider's own migrations run again on start (idempotent),
   so no separate migration step is needed. Note `getfider/fider` has no
   `:latest` tag — the module pins `latest` to `stable`; pin an explicit SHA tag
   for reproducible upgrades.

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~fider"
   ```

   `JWT_SECRET` signs all authentication and session tokens (including emailed
   magic sign-in links) — **never rotate it after first boot**; doing so
   invalidates every active session and pending sign-in link.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=fider --project="$PROJECT"
   ```

6. **Check the init job and NFS mount:**

   ```bash
   gcloud run jobs list --project="$PROJECT" --region="$REGION"
   gcloud filestore instances list --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.
   When email is disabled, sign-up / invite links appear here — this is expected,
   not an error.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, request latency (P50/P95/P99), instance count (scaling
   behaviour), and CPU / memory utilisation. If an **uptime check** is enabled,
   confirm it is green under Monitoring → Uptime checks, and review
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Fider releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs for startup errors, and confirm env vars and secrets resolved. The
  startup and liveness probes target `/_health`; allow up to ~7 minutes on first
  boot for `./fider migrate` plus server startup.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`,
  the DB password secret exists, and the `db-init` job completed successfully
  (it idempotently creates the `fider` role/database and is safe to re-run).
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Blank page / CSP or "invalid origin" style errors:** this is a known
  Foundation-wide Cloud Run behaviour, not a Fider bug — Cloud Run serves a
  service on two URL aliases (the numeric-project `predicted_service_url` form
  injected as `BASE_URL`, and the random-suffix `status.url` form). If you
  browse to the alias that does not match the `BASE_URL` the app booted with,
  strict origin/CSP checks can produce a blank page. Confirm which URL the
  running revision actually injected and use that one consistently, or set a
  custom `BASE_URL` (e.g. behind a load balancer / custom domain) so both match:
  ```bash
  gcloud run revisions describe "$(gcloud run revisions list --service="$SERVICE" \
    --project="$PROJECT" --region="$REGION" --format='value(name)' --limit=1)" \
    --project="$PROJECT" --region="$REGION" --format='value(spec.template.spec.containers[0].env)'
  ```
- **NFS-related mount failures:** confirm the shared Filestore NFS VM (managed by
  `Services_GCP`) is `RUNNING` before this app was deployed; a stopped/absent NFS
  server at deploy time is a common cause of storage mount errors.
  ```bash
  gcloud filestore instances list --project="$PROJECT"
  ```
- **Initialisation job failed:** list executions and read the failed one's logs
  (same command as the database section above).
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section
for setting-specific gotchas (including the critical rule never to rotate
`JWT_SECRET` after first boot, and why `db_name`/`db_user` are immutable after
first deploy).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, GCS buckets, and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, Filestore
NFS, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, storage bucket, NFS mount, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; create the site and admin owner on first visit |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, dual-URL-alias, NFS, init-job, and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
