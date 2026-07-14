---
title: "AFFiNE on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy AFFiNE on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# AFFiNE on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Affine_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

AFFiNE is an open-source knowledge base that unifies docs, whiteboards, and databases in one workspace — a self-hostable alternative to Notion and Miro. This lab takes you through the full operational lifecycle of the **AFFiNE on Cloud Run** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on AFFiNE product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Affine_CloudRun) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service and complete AFFiNE's first-run setup.
- Perform day-2 operations — inspect revisions, resize, update, and manage secrets and backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL,
  Artifact Registry, NFS/Redis host, and shared service accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **AFFiNE (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Affine_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15) database
   with its Secret Manager password secret, an NFS share for blob storage (whose host
   also serves as the default Redis endpoint), a dedicated `storage` GCS bucket, builds
   the custom container image (thin wrapper over `ghcr.io/toeverything/affine`), and
   runs two one-shot jobs: `db-init` (database + user) and `affine-migrate` (AFFiNE's
   `self-host-predeploy` schema migration and signing-key generation). First deploys
   take roughly **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~affine" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. AFFiNE's health path is `/`, which returns HTTP 200
   once the server is ready (the startup probe allows a generous window, but a healthy
   instance typically answers within a minute or two of a fresh deploy):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

2. Open `$SERVICE_URL` in a browser and **create the first account** — on a fresh
   AFFiNE self-host instance the first registered user becomes the server
   administrator (the admin panel is at `${SERVICE_URL}/admin`). Do this immediately
   after deploying: until an admin account exists, anyone who reaches the URL can
   register it. The database password (the only credential in Secret Manager) can be
   retrieved if needed:

   ```bash
   DB_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~affine" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$DB_SECRET" --project="$PROJECT"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scaling is vertical, not horizontal.** AFFiNE is pinned to a single always-on
   instance (`min = max = 1`, `cpu_always_allocated = true`) because collaboration
   blobs live on the NFS filesystem and real-time editing state is per-process. To
   give it more headroom, raise `cpu_limit` / `memory_limit` and click **Update** on
   the deployment details page — the module owns the service spec, so this is a
   configuration change, not a manual `gcloud` edit (a manual edit would be reverted
   on the next apply). Do **not** raise `max_instance_count`.

3. **Update the application version** by changing the `application_version` input
   (e.g. `stable` → a pinned release tag) via **Update** on the deployment details
   page; a new image builds and a new revision rolls out. The `affine-migrate` job
   re-runs idempotently.

4. **Manage secrets, storage, and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~affine"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init, affine-migrate, backup jobs
   gcloud storage buckets list --project="$PROJECT" --filter="name~affine"
   ```

5. **Open a database session** for inspection or maintenance (PostgreSQL 15):

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=affine --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer. The `[cloud-entrypoint]` lines show
   which database host and Redis endpoint the container resolved at startup:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (expect a flat `1` — the
   instance is always-on), and CPU / memory utilisation. If you enabled
   `uptime_check_config`, confirm the check is green under Monitoring → Uptime checks,
   and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with AFFiNE releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs. The `[cloud-entrypoint]` startup lines confirm whether the DB host and Redis
  endpoint resolved:
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL (PostgreSQL 15) instance is
  `RUNNABLE`, the DB password secret exists, and the `db-init` job completed. Note
  AFFiNE connects over the instance **private IP with `sslmode=require`** (not the
  Auth Proxy socket) — VPC egress must be intact.
- **Initialisation job failed:** list executions and read the failed one's logs.
  `affine-migrate` retries up to 3 times and must succeed before the server has a
  schema:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-affine-migrate" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Real-time collaboration not syncing:** Redis is mandatory. Verify the NFS/Redis
  host VM is `RUNNING` (the NFS server IP is the default Redis endpoint) and that
  logs show a non-empty `REDIS_SERVER_HOST`.
- **Image build failed:** review Cloud Build history for the failed build's log.
  `container_image_source` must be `custom` — the upstream image lacks the entrypoint
  that assembles `DATABASE_URL` / `REDIS_SERVER_*`. A nonexistent image tag (e.g. a
  literal `latest`) fails the base-image pull; the module maps `latest` → `stable`.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, GCS buckets (including the `storage`
bucket), the NFS share, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, shared Cloud SQL, registry, NFS/Redis host) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), NFS/Redis, GCS bucket, secrets, and runs db-init + affine-migrate |
| 2 — Access & verify | Manual | Health check passes; first registered account becomes the server admin |
| 3 — Operate | Manual | Inspect revisions, resize vertically, update version, manage secrets/backups/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, Redis, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
