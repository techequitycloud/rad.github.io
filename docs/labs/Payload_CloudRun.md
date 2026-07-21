---
title: "Payload CMS on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Payload CMS on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Payload CMS on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Payload_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Payload CMS is a TypeScript-native, code-first headless CMS and application framework built
directly on Next.js. Unlike most modules in this catalogue, there is **no official Payload Docker
image** — this module builds a real, locally-verified starter application from source (a blank
`create-payload-app` template using the PostgreSQL adapter). This lab takes you through the full
operational lifecycle of the **Payload on Cloud Run** module on Google Cloud: deploy it, access
and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on
Payload's own content-modeling features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Payload_CloudRun) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including creating the first Payload admin account.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL, Artifact
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

1. In the RAD platform, open **Payload (Cloud Run)**, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Payload_CloudRun) documents
   every input by group, with defaults. Review the estimated cost (if credits are enabled) and
   click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15) database with its
   Secret Manager secrets (`PAYLOAD_SECRET` and the database password), **builds the Payload
   application from source via Cloud Build** (there is no prebuilt image to pull), and runs two
   sequential jobs: `db-init` (creates the database role and database) followed by
   `payload-migrate` (applies the Payload schema — this needs the full application source and
   dependency tree, not just the trimmed runtime that serves traffic). First deploys take roughly
   **20–35 minutes** (Cloud SQL creation and the from-source Cloud Build dominate).

3. When it completes, discover the resources with name-agnostic filters (so the commands keep
   working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~payload" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Payload's admin UI route responds unauthenticated once the
   Node.js server has booted:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/admin"   # expect 200
   ```

2. Open `$SERVICE_URL/admin` in a browser. Payload has **no CLI command to create the first admin
   user non-interactively** — with an empty `users` collection, Payload automatically shows a
   signup form. Fill in your email and a password and submit to create the first administrator;
   you are then logged into the admin dashboard. This is a required, one-time manual step — there
   is no pre-seeded admin credential in Secret Manager.

3. Confirm the REST and GraphQL APIs are wired up (both require the auth you just created):
   ```bash
   curl -s "$SERVICE_URL/api/users" -o /dev/null -w '%{http_code}\n'   # 401/403 without auth — expected
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable revision; traffic
   shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment
   details page — the module owns the service spec, so scaling is a configuration change, not a
   manual `gcloud` edit (a manual edit would be reverted on the next apply).

3. **Update the application version tag** by changing the version input in the RAD platform and
   applying it via **Update**; a new Cloud Build run rebuilds the bundled Payload starter app from
   source and rolls out a new revision (there is no upstream image tag to bump — this always
   rebuilds).

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~payload"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + payload-migrate + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=payload --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request count,
   request latency (P50/P95/P99), instance count (scaling behaviour), and CPU / memory
   utilisation. The module can provision an **uptime check** (when `uptime_check_config.enabled =
   true` — it defaults to `false`); if enabled, confirm it is green under Monitoring → Uptime
   checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are platform-level
diagnostics and do not change with Payload releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its logs for
  startup errors. The startup probe targets `/admin` and allows roughly 12 minutes on first boot
  for the `payload-migrate` job to complete.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database queries fail / "relation does not exist":** the schema was never applied. Confirm
  `payload-migrate` completed successfully (it depends on `db-init` finishing first):
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-payload-migrate" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE` and the DB
  password secret exists.
- **Image build failed:** review Cloud Build history for the failed build's log — remember this
  module always builds from source, so a broken Dockerfile or dependency change surfaces here,
  not as an image-pull error.
  ```bash
  gcloud builds list --project="$PROJECT" --limit=10
  ```
- **First admin account missing / can't log in:** the first admin is created manually via the
  `/admin` signup form — there is no pre-seeded credential in Secret Manager to fall back to.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific gotchas
(including why `enable_gcs_storage` and the Redis variables have no effect on this module).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**).
Delete runs `terraform destroy` and is irreversible (the deployment record is retained for
history). If a deployment is stuck and the RAD platform can no longer manage it (for example
after manual changes that conflict with the Terraform state), use **Purge** instead — it removes
the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget
the project). This removes everything the module created — the Cloud Run service, Cloud SQL
database, Secret Manager secrets, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, shared Cloud SQL, registry) are managed separately and are not removed
here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the Payload app from source via Cloud Build and provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, and runs `db-init` → `payload-migrate` |
| 2 — Access & verify | Manual | Health check passes; create the first admin account via the `/admin` signup form |
| 3 — Operate | Manual | Inspect revisions, scale, update version (rebuilds from source), manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, migration-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
