---
title: "Ghostfolio on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Ghostfolio on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Ghostfolio on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ghostfolio_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Ghostfolio is an open-source wealth management application for tracking net worth,
investment portfolios, and asset allocation across multiple brokerage accounts.
This lab takes you through the full operational lifecycle of the **Ghostfolio on
Cloud Run** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Ghostfolio product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ghostfolio_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including its combined DB+Redis health check.
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

1. In the RAD platform, open **Ghostfolio (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Ghostfolio_CloudRun)
   documents every input by group, with defaults. Note that `enable_redis` defaults
   to `true` and is REQUIRED — do not disable it. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secrets (`ACCESS_TOKEN_SALT`,
   `JWT_SECRET_KEY`, and the database password), builds the container image, and
   runs a one-shot database-initialisation job. First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~ghostfolio" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and connected to BOTH its database AND Redis.
   Ghostfolio's health endpoint checks both dependencies and returns 503 until
   both are reachable:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/api/v1/health"   # expect 200
   curl -s "$SERVICE_URL/api/v1/health"                                    # expect {"status":"OK"}
   ```

2. Open `$SERVICE_URL` in a browser. Ghostfolio has **no email/password login
   form** — click **Get Started** and the app mints a random anonymous "Security
   Token" as your account owner credential. Save this token; it is your only
   credential for this account (there is no recovery email). There is no admin
   account to bootstrap and no sign-up toggle to disable afterward.

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
   reverted on the next apply).

3. **Update the application version tag** by changing the version input in the
   RAD platform and applying it via **Update**; a new image builds and a new
   revision rolls out. Unlike many prebuilt-image modules in this catalogue,
   Ghostfolio's `latest` tag is genuinely valid on Docker Hub, so `latest` tracks
   the newest published release.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~ghostfolio"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # init jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=ghostfolio --project="$PROJECT"
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
   behaviour), and CPU / memory utilisation. The module can provision an
   **uptime check** (when `uptime_check_config.enabled = true` — it defaults to
   `false`); if enabled, confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Ghostfolio releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs for startup errors. The startup probe targets `/api/v1/health`, which
  fails until BOTH the database AND Redis are reachable — a 503 here often means
  Redis is not yet reachable, not a database problem.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`,
  the DB password secret exists, and the initialisation job completed
  successfully. Recall that Ghostfolio's `DATABASE_URL` always connects over the
  private Cloud SQL IP (never the Unix-socket path) with `sslmode=require`.
- **Redis connection errors:** if `redis_host` was left empty, confirm the
  platform NFS server VM is `RUNNING` (`enable_nfs` or a discovered
  `Services_GCP` NFS instance); otherwise `REDIS_HOST` is empty and the health
  check never passes.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `ACCESS_TOKEN_SALT` after
first boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform
can no longer manage it (for example after manual changes that conflict with the
Terraform state), use **Purge** instead — it removes the deployment from RAD's
records **without** destroying the cloud resources (it makes RAD forget the
project). Delete removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, and Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry, NFS
Redis host) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, and runs DB init |
| 2 — Access & verify | Manual | Health check passes (DB + Redis); mint an anonymous Security Token via "Get Started" |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, Redis, init-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
