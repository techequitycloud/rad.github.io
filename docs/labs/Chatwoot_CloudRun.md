---
title: "Chatwoot on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Chatwoot on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Chatwoot on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Chatwoot_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Chatwoot is an open-source, multi-channel helpdesk and customer-engagement
platform (email, live chat, social, and messaging inboxes, SLA tracking, and
reporting) — a GDPR-compliant alternative to Zendesk or Intercom. This lab
takes you through the full operational lifecycle of the **Chatwoot on Cloud
Run** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Chatwoot product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Chatwoot_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, update, and manage secrets and jobs.
- Observe the service (and its co-located Sidekiq worker) with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL,
  NFS/Redis, Artifact Registry, and shared service accounts this module depends on).
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

1. In the RAD platform, open **Chatwoot (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Chatwoot_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform builds a custom Chatwoot container image (`chatwoot/chatwoot`
   wrapped with a cloud entrypoint), provisions the Cloud Run service, a Cloud
   SQL (PostgreSQL 15, with `pgvector`) database with its Secret Manager
   secrets (`SECRET_KEY_BASE` and the database password), a Cloud Storage
   bucket, a Filestore NFS mount for attachments, and Redis. It then runs two
   **chained** initialization jobs — `db-init` (creates the database, role,
   and grants, including `cloudsqlsuperuser`) followed by `chatwoot-prepare`
   (`rails db:chatwoot_prepare`, using the built app image, to create the
   schema). First deploys take roughly **20–35 minutes** (Cloud SQL creation
   and the custom image build dominate).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~chatwoot" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Chatwoot's login/onboarding page responds
   with HTTP 200 and needs no authentication:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Confirm the chained initialization jobs both completed successfully before
   trusting the schema is ready:

   ```bash
   gcloud run jobs executions list --job="${SERVICE}-db-init" \
     --project="$PROJECT" --region="$REGION"
   gcloud run jobs executions list --job="${SERVICE}-chatwoot-prepare" \
     --project="$PROJECT" --region="$REGION"
   ```

3. Open `$SERVICE_URL` in a browser. On first visit Chatwoot's onboarding UI
   prompts you to create the initial administrator account interactively — no
   pre-seeded admin credential exists in Secret Manager. Fill in your name,
   email, and a password to finish onboarding. `ENABLE_ACCOUNT_SIGNUP`
   defaults to `"false"`, so afterwards only invited users can join; flip it
   temporarily via `environment_variables` if you need public self-service
   signup.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the service spec, so scaling
   is a configuration change, not a manual `gcloud` edit (a manual edit would
   be reverted on the next apply). Chatwoot's Sidekiq worker (background job
   delivery, notifications, reports) and ActionCable (real-time UI updates)
   run co-located inside the same container and only work while a request is
   being served or during the post-request keep-warm window (`cpu_always_allocated
   = false` by default). For production, set `min_instance_count >= 1` and
   `cpu_always_allocated = true` to keep background delivery continuous.

3. **Update the application version** by changing the `application_version`
   input (the `chatwoot/chatwoot` image tag) in the RAD platform and applying
   it via **Update**; a new image builds and a new revision rolls out.

4. **Manage secrets and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~chatwoot"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + chatwoot-prepare
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=chatwoot --project="$PROJECT"
   ```

6. **Check attachment persistence** — uploaded files live on Filestore NFS at
   `/opt/chatwoot/storage`, not the auto-provisioned `storage`-suffixed GCS
   bucket:

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~chatwoot"
   gcloud filestore instances list --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer. Both the Rails web process
   and the co-located Sidekiq worker write to the same container stdout/stderr:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and
   CPU / memory utilisation. If an uptime check is enabled (`uptime_check_config`),
   confirm it is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Chatwoot releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs for startup errors, and confirm env vars and secrets resolved. The
  startup probe targets `GET /` and allows an initial 60-second delay plus up
  to 30 retries at a 15-second period (~8 minutes) — sized to absorb
  `chatwoot-prepare` finishing ahead of the app container.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Initialization job failed:** `chatwoot-prepare` depends on `db-init`
  completing first; if schema prep fails with `must be superuser` on `CREATE
  EXTENSION`, the `cloudsqlsuperuser` grant in `db-init` did not land. List
  executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-chatwoot-prepare" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`
  and the DB password secret exists. Remember Cloud Run reaches Postgres over
  a Unix socket (`/cloudsql/<instance>`), not a `127.0.0.1` TCP loopback — that
  loopback form only applies on the GKE variant.
- **Background jobs/notifications not delivering but the UI loads fine:**
  Sidekiq only runs while the container is alive. Check `min_instance_count`
  and `cpu_always_allocated` — at `min=0`/`cpu_always_allocated=false`, Sidekiq
  pauses between requests and the keep-warm window.
- **Image build failed:** review Cloud Build history for the failed build's
  log. A nonexistent `application_version` tag (e.g. an inherited default from
  another app) fails the pull with `MANIFEST_UNKNOWN` — confirm the tag exists
  on Docker Hub for `chatwoot/chatwoot`.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule never to rotate
`SECRET_KEY_BASE` after first boot, and never to disable `enable_redis`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, GCS buckets, NFS-hosted
attachments, and Artifact Registry images. Resources owned by **Services_GCP**
(the VPC, shared Cloud SQL, NFS/Redis, registry) are managed separately and
are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the custom Chatwoot image, provisions Cloud Run, Cloud SQL (PostgreSQL 15 + pgvector), secrets, storage, NFS, Redis, and runs the chained `db-init` → `chatwoot-prepare` jobs |
| 2 — Access & verify | Manual | Health check (`GET /`) passes; init jobs confirmed successful; create the initial admin account in the UI |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/jobs, DB access, verify attachment persistence |
| 4 — Observe | Manual | Query Cloud Logging (web + Sidekiq); review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, init-job, database, background-delivery, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
