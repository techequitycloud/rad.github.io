---
title: "Miniflux on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Miniflux on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Miniflux on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Miniflux_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Miniflux is a minimalist, self-hosted RSS/Atom feed reader — a single static Go
binary that stores all of its state in PostgreSQL. This lab takes you through the
full operational lifecycle of the **Miniflux on Cloud Run** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Miniflux product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Miniflux_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and log in with the seeded admin account.
- Perform day-2 operations — inspect revisions, scale, update the version, and
  manage secrets and the feed poller.
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

1. In the RAD platform, open **Miniflux (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Miniflux_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service (2 vCPU / 4 GiB, always-CPU-allocated
   with `min = 1` so the in-process feed poller keeps running), a Cloud SQL
   (PostgreSQL 15) database with its Secret Manager secrets (the auto-generated
   `ADMIN_PASSWORD` and the database password), a default (unused) `data` Cloud
   Storage bucket, builds the container image, and runs a one-shot database-
   initialisation job that creates the `miniflux` database/role and installs the
   `hstore` extension. First deploys take roughly **20–35 minutes** (Cloud SQL
   creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~miniflux" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Miniflux serves an unauthenticated `200 OK` at
   the root path, which is also the probe target:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. Retrieve the seeded initial owner password from Secret Manager (the account is
   created on first boot — there is no self-service signup):

   ```bash
   gcloud secrets versions access latest \
     --secret=secret-<resource-prefix>-miniflux-admin-password --project="$PROJECT"
   ```

   Substitute `<resource-prefix>` with the real secret name from
   `gcloud secrets list --project="$PROJECT" --filter="name~miniflux"`.

3. Open `$SERVICE_URL` in a browser and log in with username `admin` (or the
   `ADMIN_USERNAME` you configured) and the retrieved password. If you front the
   service with a custom domain or load balancer, set `BASE_URL` (via
   `environment_variables`) to that URL so Miniflux emits correct absolute links
   and feed-proxy image URLs.

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
   configuration change, not a manual `gcloud` edit (a manual edit would be
   reverted on the next apply). Keep `min_instance_count = 1` (the default) so the
   in-process feed poller keeps refreshing between requests; dropping to `0`
   (scale-to-zero) stops background polling unless you externalize it with a Cloud
   Scheduler hit to `/v1/feeds/refresh`.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a new revision
   rolls out. Miniflux applies its own schema migrations on boot, so no separate
   migrate step is needed — allow extra time on the first boot after an upgrade.

4. **Manage secrets and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~miniflux"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"        # db-init + any scheduled jobs
   gcloud run jobs executions list --job="${SERVICE}-db-init" \
     --project="$PROJECT" --region="$REGION"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=miniflux --database=miniflux --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer. The entrypoint logs its
   `DATABASE_URL` connection mode (socket / loopback / private-IP TCP) at start —
   useful when diagnosing DB connectivity:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count, and CPU / memory
   utilisation. Because `cpu_always_allocated = true` and `min = 1` are the
   defaults, expect one instance to remain warm continuously (this is the trade-off
   for the in-process feed poller). The module can also provision an **uptime
   check**; if enabled, confirm it is green under Monitoring → Uptime checks, and
   review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Miniflux releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors, and confirm env vars and secrets resolved. The startup
  probe targets `/` (root, unauthenticated) with a generous first-boot window.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret exists, and the `db-init` job completed successfully (it
  creates the `miniflux` database/role and the `hstore` extension owned by the app
  role).
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Feeds not refreshing:** the feed poller runs in-process on
  `POLLING_FREQUENCY`. If the service is scaled to zero (`cpu_always_allocated =
  false` / `min_instance_count = 0`), polling stops while idle unless you drive
  `/v1/feeds/refresh` externally via Cloud Scheduler.
- **Can't log in / lost the admin password:** re-read the `ADMIN_PASSWORD` secret
  (see Task 2); `CREATE_ADMIN` only seeds the account on first boot and is
  idempotent on later boots.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the immutability of `db_name`/`db_user` after first deploy and
the consequences of disabling `cpu_always_allocated`/`min_instance_count`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Cloud SQL database, Secret Manager secrets, the GCS bucket, and any Filestore NFS
mount and Artifact Registry images. Resources owned by **Services_GCP** (the VPC,
shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, a default storage bucket, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; retrieve the seeded admin password and log in |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/jobs, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, feed-poller, and build/IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
