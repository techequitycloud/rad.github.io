---
title: "CloudBeaver on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy CloudBeaver on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# CloudBeaver on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/CloudBeaver_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

CloudBeaver is the web-based database management console from the DBeaver project — a single browser UI for connecting to and querying PostgreSQL, MySQL, SQL Server, Oracle, and many other engines. This lab takes you through the full operational lifecycle of the **CloudBeaver on Cloud Run** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on CloudBeaver product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/CloudBeaver_CloudRun) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access the service through its default `internal` ingress and verify it is healthy.
- Claim the administrator account via the first-run setup wizard and understand why timing matters.
- Perform day-2 operations — inspect revisions, manage the GCS-backed workspace, and update the version.
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

1. Click **Deploy** in the RAD platform top navigation, open **CloudBeaver (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/CloudBeaver_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform builds the container image (from `dbeaver/cloudbeaver` with a custom
   entrypoint), provisions the Cloud Run service (port 8978, 1 vCPU / 1 GiB), and
   creates a dedicated GCS **workspace bucket** mounted via GCS FUSE at
   `/opt/cloudbeaver/workspace`. There is **no Cloud SQL instance, no Redis, and no
   application secret** — CloudBeaver keeps all of its own state in the workspace.
   First deploys typically take **10–20 minutes** (the container build dominates —
   there is no database to wait for).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~cloudbeaver" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. **Mind the ingress mode first.** The module defaults to
   `ingress_settings = "internal"` — appropriate for a database admin console, but it
   means the service URL is only reachable from inside the VPC. A `curl` from your
   laptop returns **404** in that mode; that is the ingress policy working, not a
   failure. Check the current mode:

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="value(metadata.annotations['run.googleapis.com/ingress'])"
   ```

   For browser access from outside the VPC, either set `ingress_settings = "all"` via
   **Update** on the deployment details page (temporarily, for this lab) or front the
   service with an external HTTPS load balancer and IAP.

2. Once reachable, confirm the service is healthy. CloudBeaver's health path is `/`,
   which returns HTTP 200 once the JVM has finished starting (allow ~15–30 seconds
   after a cold start):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

3. Open `$SERVICE_URL` in a browser. On first access CloudBeaver presents its
   **setup wizard** — there is no seeded admin account, so **whoever completes the
   wizard first becomes the administrator**. Complete it immediately: set the server
   name and create the admin username and password. Keep ingress restricted until you
   have done this.

4. After logging in as admin, add a database connection (New Connection → choose the
   driver → supply host/port/credentials). To reach private databases on the VPC
   (including the shared Cloud SQL from Services_GCP), the foundation-managed VPC
   egress must be in place — verify with:

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="value(spec.template.metadata.annotations)"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not scale out.** This module deliberately defaults to
   `min_instance_count = 1` (avoids slow JVM cold starts) and
   `max_instance_count = 1`. The workspace is a **single-writer store** (an embedded
   H2 database on the GCS FUSE mount) — raising `max_instance_count` above 1 risks
   corrupting it. Scaling changes, like all spec changes, go through **Update** on
   the deployment details page, not manual `gcloud` edits (a manual edit would be
   reverted on the next apply).

3. **Update the application version** by changing the version input via **Update** on
   the deployment details page; a new image builds from `dbeaver/cloudbeaver:<version>`
   and a new revision rolls out. Pin a specific tag rather than `latest` for
   reproducible deployments.

4. **Manage the workspace and storage** — the GCS workspace bucket is the durable
   heart of the deployment (saved connections, users, settings, the embedded metadata
   DB). Back it up before risky changes:

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~cloudbeaver"
   WORKSPACE_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~cloudbeaver" --format="value(name)" --limit=1)
   gcloud storage ls -r "gs://$WORKSPACE_BUCKET/" | head -20
   # One-off backup copy:
   gcloud storage cp -r "gs://$WORKSPACE_BUCKET" "gs://<your-backup-bucket>/cloudbeaver-$(date +%F)"
   ```

5. **There is no application database to manage.** `database_type = "NONE"` — no
   Cloud SQL instance, no db-init job, no DB password secret. The databases
   CloudBeaver *manages* are external targets you register in its UI.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (should sit flat at 1), and
   CPU / memory utilisation (watch memory — CloudBeaver is JVM-based). Note that the
   module's **uptime check** is only provisioned when the endpoint is publicly
   reachable — with the default `internal` ingress there is no public endpoint to
   probe, so Monitoring → Uptime checks may legitimately be empty.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with CloudBeaver releases.

- **URL returns 404 from your machine:** almost always the default `internal`
  ingress, not an outage. Check the ingress annotation (Task 2) before reading logs.
- **Revision unhealthy / service won't serve:** the startup probe targets `/` with a
  15-second initial delay and a 10-failure retry window (the JVM boot is quick but
  not instant). Inspect the latest revision and its logs:
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Workspace state missing / settings reset:** confirm the GCS FUSE mount is present
  and the workspace bucket still exists — all CloudBeaver state lives there. GCS FUSE
  requires the `gen2` execution environment (the module default; don't override to
  `gen1`).
- **Corrupted workspace / odd metadata errors:** check whether `max_instance_count`
  was raised above 1 — two concurrent writers corrupt the embedded H2 store. Restore
  the workspace bucket from a backup copy.
- **Can't reach a private database from the UI:** verify VPC egress is configured on
  the service (Task 2, step 4) and the target database accepts connections from the
  VPC.
- **Image build failed:** review Cloud Build history for the failed build's log. The
  image is custom-built from `dbeaver/cloudbeaver:<version>` via the
  `CLOUDBEAVER_VERSION` build ARG.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service, the GCS workspace bucket (and with it **all saved connections, users, and settings**), and Artifact Registry images. Copy the workspace bucket first if you want to keep the configuration. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the image and provisions Cloud Run + the GCS workspace bucket (no DB, no Redis, no secrets) |
| 2 — Access & verify | Manual | Understand `internal` ingress; health check passes; claim the admin account via the setup wizard |
| 3 — Operate | Manual | Inspect revisions, keep single-instance scaling, update version, back up the workspace bucket |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics; understand when the uptime check exists |
| 5 — Troubleshoot | Manual | Diagnose ingress, revision, workspace, VPC-egress, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources including the workspace bucket |
