---
title: "Beszel on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Beszel on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Beszel on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Beszel_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Beszel is a lightweight, open-source server-monitoring hub — historical resource metrics, Docker container stats, and configurable alerts, built on PocketBase with an embedded SQLite database. This lab takes you through the full operational lifecycle of the **Beszel on Cloud Run** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on Beszel product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Beszel_CloudRun) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running hub, and complete the first-run admin setup.
- Perform day-2 operations — inspect, update, and manage the FUSE-mounted data bucket.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Artifact
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

1. Click **Deploy** in the RAD platform top navigation, open **Beszel (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Beszel_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service (single Go container on port
   8090), a dedicated Cloud Storage data bucket FUSE-mounted at `/beszel_data`
   (which holds the embedded SQLite database and all monitoring history), and
   mirrors the Beszel image into Artifact Registry. **No Cloud SQL, Redis, or
   init job is created** — Beszel is self-contained, so the deploy is quick
   (typically **10–20 minutes**).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~beszel" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the hub is healthy. Beszel's health path is `/api/health`, a public,
   unauthenticated endpoint that returns HTTP 200 once the hub is ready (first
   boot creates the SQLite schema, so allow up to a minute on a fresh deploy):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/api/health"
   ```

2. Open `$SERVICE_URL` in a browser. On first boot Beszel presents PocketBase's
   first-run **superuser (admin) setup** — enter an admin email and password to
   complete it. No admin credential is stored in Secret Manager; the account you
   create here lives in the SQLite database on the data bucket.

3. After creating the admin, add a system to monitor: the hub shows the agent
   install command and its public key. Install the Beszel agent on a machine you
   want to watch and confirm it starts reporting to the hub URL. Note that
   `ingress_settings = "all"` (the default) is what lets remote agents reach the
   hub — keep it that way unless every agent is inside the VPC.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scaling is deliberately pinned.** Beszel runs `min_instance_count = 1` and
   `max_instance_count = 1` — one warm instance, one SQLite writer. **Do not
   raise `max_instance_count`**: more than one instance against the shared
   FUSE-mounted database risks lock contention and corruption. Any change is a
   configuration change made via **Update** on the deployment details page, not
   a manual `gcloud` edit (a manual edit would be reverted on the next apply).

3. **Update the application version** by changing the version input via **Update**
   on the deployment details page; the new image tag is mirrored and a new
   revision rolls out. Beszel migrates its embedded database automatically on
   upgrade. Pin an explicit tag rather than `latest` to control when that happens.

4. **Inspect the state that matters — the data bucket.** The bucket *is* the
   database (SQLite file, config, metric history):

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~beszel"
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~beszel" --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/"
   ```

   There is no Cloud SQL session to open in this lab — all persistence is this
   bucket. Treat it as production data: never delete or clear it while the
   deployment lives.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (should be flat at 1), and
   CPU / memory utilisation. The module also provisions an **uptime check**;
   confirm it is green under Monitoring → Uptime checks, and review Alerting →
   Policies. (Meta note: this GCP monitoring observes the *hub*; Beszel itself
   monitors the machines its agents run on.)

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Beszel releases.

- **Revision unhealthy / service won't serve:** the startup probe targets
  `/api/health` with a retry window that covers first-boot schema creation.
  Inspect the latest revision and its logs before concluding the service failed:
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **State not persisting / history gone after redeploy:** verify the execution
  environment is `gen2` (required for the GCS FUSE `/beszel_data` mount) and that
  the data bucket exists and is mounted on the running revision
  (`gcloud run services describe "$SERVICE" --format=json` and check the volumes).
- **Agents can't report:** confirm `ingress_settings = "all"` and that IAP is
  **off** — IAP blocks all unauthenticated requests, including agent metric
  posts from machines that cannot present a Google identity.
- **Database locked / intermittent 500s:** check the instance count. If
  `max_instance_count` was raised above 1, two writers are fighting over one
  SQLite file — set it back to 1 immediately.
- **Image pull failed:** the module mirrors the upstream Beszel image into
  Artifact Registry (`enable_image_mirroring = true`); review Cloud Build history
  for the mirror step's log and confirm the tag exists upstream.
- **403 / permission errors:** verify the runtime service account's IAM roles
  (it needs access to the data bucket for the FUSE mount).

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
the Cloud Storage data bucket (which **is** the SQLite database — all monitoring
history and the admin account go with it), and the mirrored Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, shared registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run (port 8090), a GCS FUSE data bucket, and mirrors the image — no DB, no Redis |
| 2 — Access & verify | Manual | `/api/health` returns 200; complete the PocketBase superuser setup and connect an agent |
| 3 — Operate | Manual | Inspect revisions, respect the single-instance pin, update version, inspect the data bucket |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, FUSE persistence, agent-ingress, SQLite-lock, mirror, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources including the data bucket |
