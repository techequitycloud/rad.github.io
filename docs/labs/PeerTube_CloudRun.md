---
title: "PeerTube on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy PeerTube on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# PeerTube on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/PeerTube_CloudRun)**

## Overview

**Estimated time:** 60–90 minutes

PeerTube is an open-source, ActivityPub-federated video hosting platform — a
self-hosted YouTube alternative that federates videos, comments, and channels
with other PeerTube instances (and the wider Fediverse). This lab takes you
through the full operational lifecycle of the **PeerTube on Cloud Run** module
on Google Cloud: deploy it, access and verify it, run it day-to-day, observe
it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on PeerTube product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/PeerTube_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including the auto-bootstrapped admin account.
- Perform day-2 operations — inspect, scale, update, and manage secrets.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Understand this module's scope (VOD/light transcoding) and when to use the GKE variant instead.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL
  networking, Artifact Registry, and shared service accounts this module
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

1. In the RAD platform, open **PeerTube (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/PeerTube_CloudRun)
   documents every input by group, with defaults. If you have a real domain
   ready, set `host` now (it becomes immutable once real ActivityPub content
   exists) — otherwise leave it empty and the deployment will derive a working
   `run.app`-based federation domain automatically. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (PostgreSQL 15)
   database, its Secret Manager secrets (`PEERTUBE_SECRET`,
   `PT_INITIAL_ROOT_PASSWORD`, GCS HMAC access/secret keys), two Cloud Storage
   buckets (a public `videos` bucket and a private, FUSE-mounted `data`
   bucket), builds the custom container image via Cloud Build, and runs a
   one-shot database-initialisation job (role/database creation plus the
   `pg_trgm`/`unaccent` extensions). First deploys take roughly **20–35
   minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so
   the commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~peertube" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is up and serving its public config endpoint:

   ```bash
   curl -s "$SERVICE_URL/api/v1/config" | head -c 500   # expect real JSON (instance name, signup config, etc.)
   ```

2. Retrieve the auto-bootstrapped `root` admin password. Unlike some
   ActivityPub apps in this catalogue, PeerTube needs **no manual bootstrap
   step** — the `root` account is created automatically on first boot from
   the `PT_INITIAL_ROOT_PASSWORD` secret:

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~root-password" --format="value(name)")
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

3. Open `$SERVICE_URL/login` in a browser and log in as `root` with the
   retrieved password. Confirm the instance's public federation domain
   (Settings → visible in the page footer / instance "About" page) matches
   what you expect — if you left `host` empty, this should show the derived
   `run.app` hostname.

4. If you plan to run this instance in production, decide on registration
   policy now: `enable_open_registration` defaults `false`. Leave it that way
   unless you deliberately want a public sign-up instance.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an
   immutable revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update**
   on the deployment details page — the module owns the service spec, so
   scaling is a configuration change, not a manual `gcloud` edit (a manual
   edit would be reverted on the next apply). This module defaults to
   `cpu_always_allocated = true` (PeerTube's BullMQ transcoding/federation
   queue needs CPU even between inbound requests) — do not flip it to
   request-based billing unless you understand background jobs may stall.

3. **Update the application version tag** by changing the version input in
   the RAD platform and applying it via **Update**; a new image builds via
   the dedicated `PEERTUBE_VERSION` build ARG and a new revision rolls out.

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~peertube"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # the db-init job
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=peertube --project="$PROJECT"
   ```

6. **Check the video storage buckets:**

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~peertube"
   gcloud storage ls gs://<videos-bucket>/
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
   behaviour), and CPU / memory utilisation. Because `cpu_always_allocated =
   true` by default, expect a baseline non-zero CPU cost even at low request
   volume — this is expected (BullMQ background processing). If an uptime
   check is enabled, confirm it is green under Monitoring → Uptime checks,
   and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These
are platform-level diagnostics and do not change with PeerTube releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision
  and its logs for startup errors, and confirm env vars and secrets resolved.
  The startup probe is **TCP** on port 9000 (not HTTP) — if the revision
  never becomes ready, the container likely isn't binding the port at all
  (check for a database connection failure or a missing secret) rather than
  a slow application-level readiness check.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`, the DB password secret exists, and the `db-init` job completed
  successfully. Remember Cloud Run connects over encrypted TCP to the private
  IP here (not a Unix socket) — see the Configuration Guide §3 for why.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Video upload / playback fails with an access error:** check that the
  `videos` bucket's public access prevention is `inherited`, not `enforced`
  — if a manual edit reverted this, the `allUsers:objectViewer` grant PeerTube
  needs will fail:
  ```bash
  gcloud storage buckets describe gs://<videos-bucket> --format='value(iamConfiguration.publicAccessPrevention)'
  ```
- **Image build failed:** review Cloud Build history for the failed build's
  log — a common cause is an invalid `application_version` that doesn't
  resolve to a real `chocobozzz/peertube` tag.
- **403 / permission errors:** verify the runtime service account's IAM
  roles, and specifically the dedicated storage service account's grant on
  the `videos` bucket.
- **Live streaming doesn't work:** this is expected on this module —
  `enable_live_streaming` has no effect on Cloud Run regardless of value.
  RTMP ingest (ports 1935/1936) is a raw TCP protocol that Cloud Run Services
  cannot expose. Use `PeerTube_GKE` (once available) for live streaming.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule never to change `host`
after real ActivityPub content exists, and to never disable `enable_redis`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). Delete removes everything the module
created — the Cloud Run service, Cloud SQL database, Secret Manager secrets,
the `videos` and `data` GCS buckets, and Artifact Registry images. Resources
owned by **Services_GCP** (the VPC, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (PostgreSQL 15), secrets, `videos`/`data` buckets, and runs `db-init` |
| 2 — Access & verify | Manual | Config endpoint responds; log in as the auto-bootstrapped `root` admin |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets, DB and bucket access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, storage IAM, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
