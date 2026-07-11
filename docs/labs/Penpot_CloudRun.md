---
title: "Penpot on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Penpot on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Penpot on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Penpot_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Penpot is an open-source design and prototyping platform — a self-hosted alternative to
Figma — that provides vector design editing, interactive prototyping, component libraries,
and real-time multiplayer collaboration. This lab takes you through the full operational
lifecycle of the **Penpot on Cloud Run** module on Google Cloud: deploy it, access and
verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not
on Penpot product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Penpot_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify all three running services (backend, frontend, exporter).
- Perform day-2 operations — inspect, scale, update, and manage secrets.
- Observe the services with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL,
  Artifact Registry, Redis/NFS, and shared service accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Penpot (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Penpot_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions three coordinated Cloud Run services (backend, frontend,
   exporter), a Cloud SQL PostgreSQL database with its Secret Manager secrets, a GCS
   assets bucket, optional NFS/Redis, builds the container images, and runs a one-shot
   database-initialisation job. The Penpot backend then runs its own PostgreSQL
   migrations on first boot — allow up to 60–120 seconds for JVM startup and
   migration. First deploys take roughly **25–40 minutes** (Cloud SQL creation
   dominates).

3. When it completes, discover the services with name-agnostic filters:

   ```bash
   # Frontend service — the user-facing entry point
   FRONTEND_SVC=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~penpot AND metadata.name~frontend" \
     --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$FRONTEND_SVC" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")

   # Backend and exporter services
   BACKEND_SVC=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~penpot AND metadata.name~backend" \
     --format="value(metadata.name)" --limit=1)
   EXPORTER_SVC=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~penpot AND metadata.name~exporter" \
     --format="value(metadata.name)" --limit=1)

   echo "Frontend: $FRONTEND_SVC  URL: $SERVICE_URL"
   echo "Backend:  $BACKEND_SVC"
   echo "Exporter: $EXPORTER_SVC"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm all three services are healthy:

   ```bash
   gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~penpot"
   ```

2. Confirm the backend API health endpoint responds:

   ```bash
   # The backend health endpoint — expect HTTP 200
   BACKEND_URL=$(gcloud run services describe "$BACKEND_SVC" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   curl -s -o /dev/null -w "%{http_code}" "${BACKEND_URL}/api/health"
   ```

3. Confirm the frontend is reachable at the service URL:

   ```bash
   curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL"
   ```

   Open `$SERVICE_URL` in a browser. If `penpot_flags` includes
   `enable-registration` (the default), self-registration is available. Otherwise,
   an administrator creates accounts directly inside Penpot. No admin credential
   is stored in Secret Manager — Penpot manages its own user accounts.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect all three services and their revisions** (each deploy creates an
   immutable revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~penpot"
   gcloud run revisions list --service="$BACKEND_SVC" \
     --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the service spec, so scaling is a configuration change, not a
   manual `gcloud` edit (a manual edit would be reverted on the next apply). Keep
   `min_instance_count` at 1 or higher; scale-to-zero terminates active WebSocket
   sessions and forces a 60–120 second JVM cold start on reconnect.

3. **Update the application version** by changing the version input via **Update** on the deployment details page; new images build for all three services and new revisions roll out.
   All three services must use the same version tag.

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~penpot"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" \
     --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=penpot --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$BACKEND_SVC" \
     --project="$PROJECT" --region="$REGION" --limit=50
   gcloud run services logs read "$EXPORTER_SVC" \
     --project="$PROJECT" --region="$REGION" --limit=20
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard and review each of the three
   services independently: request count, request latency (P50/P95/P99), instance
   count (scaling behaviour), and CPU/memory utilisation. The module also provisions
   an **uptime check** against `/api/health`; confirm it is green under
   Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Penpot releases.

- **Revision unhealthy / service won't serve:** the backend uses an HTTP startup
  probe on `/api/health` and can take 60–120 seconds to pass on first boot (JVM
  init + PostgreSQL migration). Inspect logs and confirm the revision became
  healthy:
  ```bash
  gcloud run revisions list --service="$BACKEND_SVC" \
    --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$BACKEND_SVC" \
    --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE` and
  the DB password secret exists. Penpot runs its own migrations at startup — a
  migration failure surfaces in the backend logs before the service becomes healthy.
- **WebSocket / real-time collaboration broken:** Redis is mandatory for WebSocket
  fan-out between backend replicas. Confirm Redis connectivity and that
  `enable_redis = true`. Check backend logs for Redis connection errors.
- **Image build failed:** review Cloud Build history for the failed build's log.
  All three service images must be present in Artifact Registry before Cloud Run
  can deploy.
- **403 / permission errors:** verify the runtime service account's IAM roles and
  that the GCS assets bucket policy grants the Cloud Run SA `storage.objectAdmin`.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including `container_protocol = "h2c"` and JVM heap sizing).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — all three Cloud Run
services, the Cloud SQL PostgreSQL database, Secret Manager secrets, the GCS assets
bucket, NFS, and Artifact Registry images. Resources owned by **Services_GCP** (the
VPC, shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions three Cloud Run services, Cloud SQL, GCS bucket, secrets, and NFS |
| 2 — Access & verify | Manual | All three services healthy; frontend reachable; backend `/api/health` returns 200 |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging per service; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database/migration, WebSocket/Redis, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
