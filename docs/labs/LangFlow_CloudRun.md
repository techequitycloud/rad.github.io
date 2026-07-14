---
title: "LangFlow on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy LangFlow on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# LangFlow on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/LangFlow_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

LangFlow is an open-source, low-code visual builder for AI agents and workflows,
built on LangChain — you assemble language-model chains, RAG pipelines, and agents by
dragging and wiring components on a canvas, then expose them as APIs. This lab takes
you through the full operational lifecycle of the **LangFlow on Cloud Run** module on
Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on LangFlow product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/LangFlow_CloudRun) —
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

1. In the RAD platform, open **LangFlow (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/LangFlow_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secrets (`LANGFLOW_SECRET_KEY`,
   `LANGFLOW_SUPERUSER_PASSWORD`, and the database password), a Cloud Storage `data`
   bucket, builds the container image, and runs a one-shot database-initialisation job
   that creates the application role, database, and grants. First deploys take
   roughly **20–35 minutes** (Cloud SQL creation dominates), and the first container
   start also runs LangFlow's own Alembic migrations plus component loading (2–4
   minutes) before the service becomes healthy.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~langflow" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. LangFlow exposes a public liveness endpoint that
   returns `200` once the server is fully up (after component loading and Alembic
   migrations):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/health"   # expect 200
   ```

2. Retrieve the auto-generated admin password from Secret Manager, then open
   `$SERVICE_URL` in a browser and sign in as `admin` (or the value you set for
   `langflow_username`) with that password — LangFlow has authentication turned on
   by default (`LANGFLOW_AUTO_LOGIN = "false"`), so there is no open sign-up step:

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~langflow AND name~superuser" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

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
   on the next apply). Keep `max_instance_count = 1`: LangFlow holds in-process
   session and flow-editor state, so running more than one instance splits that state
   and produces inconsistent behaviour. Set `min_instance_count = 1` if you want to
   keep the canvas warm for interactive editing instead of scaling to zero.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a new revision
   rolls out. Pin `application_version` explicitly rather than leaving it at
   `latest` for anything beyond a lab.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~langflow"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init job
   ```

   Never rotate `LANGFLOW_SECRET_KEY` after first boot — it encrypts every stored
   credential embedded in a flow, and rotating it makes them permanently
   undecryptable.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --filter="name~langflow" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=langflowuser --project="$PROJECT"
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
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and
   CPU / memory utilisation. Enable the module's **uptime check** for production use
   (disabled by default); confirm it is green under Monitoring → Uptime checks, and
   review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with LangFlow releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved. The startup
  probe targets `/health` and allows a 60-second initial delay plus a 600-second
  failure window to cover component loading and first-boot Alembic migrations.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret exists, and the `db-init` job completed successfully. LangFlow
  composes `LANGFLOW_DATABASE_URL` at runtime from the injected `DB_*` variables over
  TCP with `sslmode=require` — do not set the DSN manually.
- **`db-init` job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Can't sign in / lost the admin password:** re-fetch `LANGFLOW_SUPERUSER_PASSWORD`
  from Secret Manager (Task 2, step 2); it is not shown anywhere else.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `LANGFLOW_SECRET_KEY` after
first boot, and why `max_instance_count` must stay at `1`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, GCS buckets, and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry)
are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, a `data` storage bucket, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; sign in with the auto-generated admin password from Secret Manager |
| 3 — Operate | Manual | Inspect revisions, scale (keep max=1), update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
