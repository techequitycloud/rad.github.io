---
title: "Maybe Finance on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Maybe Finance on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Maybe Finance on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/MaybeFinance_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Maybe (Maybe Finance) is an open-source, self-hosted alternative to
Mint/Monarch for personal finance and wealth management — budgeting,
net-worth tracking, transaction categorization, and multi-account
aggregation, built on Ruby on Rails. This lab takes you through the full
operational lifecycle of the **Maybe Finance on Cloud Run** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Maybe's product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/MaybeFinance_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including its mandatory PostgreSQL
  and Redis dependencies.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Understand why scale-to-zero affects the co-located Sidekiq background-job
  worker, and how to keep it running continuously.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL,
  Filestore NFS/Redis, Artifact Registry, and shared service accounts this
  module depends on).
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

1. In the RAD platform, open **Maybe Finance (Cloud Run)**, set `project_id`,
   and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/MaybeFinance_CloudRun)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform builds a thin custom wrapper image `FROM
   ghcr.io/maybe-finance/maybe:stable`, provisions the Cloud Run service, a
   Cloud SQL (PostgreSQL 15) database, mounts the shared Filestore NFS volume
   at `/opt/maybefinance/storage` (also the default source of the Redis
   host), creates the `SECRET_KEY_BASE` secret in Secret Manager, provisions
   a `storage` data bucket, and runs two chained one-shot jobs — `db-init`
   (creates the database/user/grants and pre-creates `pgcrypto`) followed by
   `maybefinance-migrate` (`rails db:prepare`). First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~maybefinance" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Maybe's Rails app exposes a public,
   unauthenticated health endpoint that the platform's own startup/liveness
   probes also target:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/up"   # expect 200
   ```

2. Open `$SERVICE_URL` in a browser. Maybe runs with `SELF_HOSTED = "true"`,
   so the **first visitor** to reach the deployment registers the initial
   administrator account through the web UI — there is no pre-seeded admin
   credential in Secret Manager. Register the admin account promptly; anyone
   with the URL who gets there first claims that role.

3. Confirm the background worker is alive — Sidekiq runs in-process inside
   the same container as Rails/Puma, started only if Redis was reachable at
   boot:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --limit=50 | grep -i sidekiq
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
   the deployment details page — the module owns the service spec, so scaling
   is a configuration change, not a manual `gcloud` edit (a manual edit would
   be reverted on the next apply). By default `min_instance_count = 0` and
   `cpu_always_allocated = false` (cost-first): the co-located Sidekiq worker
   only runs while an instance happens to be alive, so account syncing,
   import processing, and notifications silently stop firing during
   scale-to-zero windows. For continuous background-job processing, set
   `min_instance_count = 1` and `cpu_always_allocated = true`, matching the
   GKE variant's defaults.

3. **Update the application version** by changing the version input in the
   RAD platform and applying it via **Update**; a new image builds `FROM
   ghcr.io/maybe-finance/maybe:<tag>` (via the app-specific `MAYBE_VERSION`
   build ARG) and a new revision rolls out.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~maybefinance"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init, maybefinance-migrate, scheduled backup jobs
   ```

   Never rotate the `SECRET_KEY_BASE` secret after first boot — it invalidates
   every active session and makes ActiveRecord-encrypted columns permanently
   unreadable.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=maybefinance --project="$PROJECT"
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
   behaviour), and CPU / memory utilisation — the combined Rails + Sidekiq
   process is memory-hungry under import/sync workloads. The
   `uptime_check_config` is **disabled by default**; enable it via the RAD
   platform and confirm it turns green under Monitoring → Uptime checks, and
   review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Maybe releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision
  and its logs for startup errors. The startup probe targets `/up` and allows
  roughly 8 minutes on first boot (`initial_delay_seconds=60`,
  `failure_threshold=30`).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`. Cloud Run reaches it over the instance's **private IP with
  `sslmode=require`** by default (`enable_cloudsql_volume=false`, since
  Rails' `pg` driver cannot parse the Cloud SQL socket DSN) — check that
  `PGSSLMODE=require` resolved correctly and the `db-init` job completed.
- **Initialisation/migration job failed:** list executions and read the failed
  one's logs, checking `db-init` before `maybefinance-migrate` (the latter
  depends on the former):
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions list --job="${SERVICE}-maybefinance-migrate" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Background jobs (account sync, imports, notifications) not firing:**
  usually means Sidekiq never started — check `REDIS_URL` resolved
  non-empty in the container env, and that the instance hasn't scaled to
  zero between requests (see Task 3, item 2).
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rules never to rotate
`SECRET_KEY_BASE` after first boot, and that `database_type` and
`enable_redis` are enforced by plan-time preconditions that reject anything
but PostgreSQL and a working Redis host).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created —
the Cloud Run service, Cloud SQL database, Secret Manager secrets, and the
`storage`/`data` GCS buckets. Resources owned by **Services_GCP** (the VPC,
the shared Filestore NFS/Redis VM, shared Cloud SQL host, Artifact Registry)
are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds a custom wrapper image, provisions Cloud Run, Cloud SQL (PostgreSQL 15), NFS/Redis wiring, secrets, storage buckets, and runs `db-init` + `maybefinance-migrate` |
| 2 — Access & verify | Manual | `/up` health check passes; register the initial admin account in the UI; confirm Sidekiq started |
| 3 — Operate | Manual | Inspect revisions, scale (mind the Sidekiq/scale-to-zero trade-off), update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and (optional) uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database (SSL mode), init/migration-job, background-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources; shared NFS/Redis and Cloud SQL host are untouched |
