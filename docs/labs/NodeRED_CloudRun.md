---
title: "NodeRED on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy NodeRED on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# NodeRED on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/NodeRED_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Node-RED is an open-source flow-based programming tool for wiring together IoT devices,
APIs, and online services through a visual browser-based editor. This lab takes you
through the full operational lifecycle of the **Node-RED on Cloud Run** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common
problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not
on Node-RED product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/NodeRED_CloudRun) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Filestore NFS,
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

1. Click **Deploy** in the RAD platform top navigation, open **NodeRED (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/NodeRED_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service (gen2, required for NFS), a Filestore
   NFS share mounted at `/data` for persistent flow storage, a Cloud Storage bucket, a
   Secret Manager secret for the flow credential encryption key, and builds or mirrors
   the container image. No database is provisioned. First deploys take roughly
   **8–18 minutes** (Filestore provisioning dominates).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~nodered" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy — Node-RED's startup probe targets HTTP GET `/`,
   which returns the editor UI once the service is fully started:

   ```bash
   curl -s -o /dev/null -w "%{http_code}" "$SERVICE_URL/"
   # expect: 200
   ```

   If you see `503`, wait 30–60 seconds for the NFS remount and startup probe to
   complete, then retry.

2. Open the Node-RED editor in your browser at `$SERVICE_URL`. No credentials are
   required by default; for production deployments, IAP is recommended (see the
   Configuration Guide). The editor exposes full flow editing and credential
   management — do not leave it publicly accessible in production.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the service spec, so scaling is a configuration change, not a
   manual `gcloud` edit (a manual edit would be reverted on the next apply). Keep
   `max_instance_count = 1` unless flows are stateless or Redis-backed external context
   storage is enabled.

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image is mirrored or built and a new revision rolls out.

4. **Manage secrets and backup jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~nodered"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # scheduled backup jobs
   ```

5. **Inspect the NFS-backed storage** — all flows, credentials, and installed palette
   nodes are persisted in the Filestore share mounted at `/data`:

   ```bash
   gcloud filestore instances list --project="$PROJECT"
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format='value(spec.template.spec.volumes)'
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and CPU
   / memory utilisation. The module also provisions an **uptime check** against `/`;
   confirm it is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Node-RED releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The startup probe targets `/` with a 30-second initial
  delay; NFS remount adds to cold-start time.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **NFS mount failure:** confirm the Filestore instance is `READY`, that
  `execution_environment = "gen2"` is set (NFS requires gen2), and that the VPC
  connector allows the service to reach the NFS server IP.
- **Flow credentials unreadable after an **Update**:** the `NODE_RED_CREDENTIAL_SECRET`
  may have been rotated or changed. Retrieve the current secret value and verify it
  matches the key used when flows were last deployed.
  ```bash
  CRED_SECRET=$(gcloud secrets list --project="$PROJECT" \
    --filter="name~nodered" --format="value(name)" --limit=1)
  gcloud secrets versions access latest --secret="$CRED_SECRET" --project="$PROJECT"
  ```
- **Image build or pull failed:** review Cloud Build history for the failed build's
  log. Confirm the image was mirrored into Artifact Registry.
- **403 / permission errors:** verify the runtime service account's IAM roles and
  Secret Manager access.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Filestore NFS instance, Secret Manager secrets, GCS bucket, and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, shared registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run (gen2), Filestore NFS, GCS bucket, and credential secret |
| 2 — Access & verify | Manual | Health check passes (HTTP 200 from `/`); editor loads in browser |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, inspect NFS |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, NFS mount, credential, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
