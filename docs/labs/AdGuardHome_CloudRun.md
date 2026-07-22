---
title: "AdGuardHome on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy AdGuardHome on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# AdGuardHome on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/AdGuardHome_CloudRun)**

> ⚠️ **CRITICAL — this module does not serve DNS.** AdGuard Home's core value
> (network-wide DNS ad/tracker blocking) requires clients to query it on port
> 53 (TCP+UDP), which Cloud Run cannot expose under any configuration. This
> lab deploys and verifies AdGuard Home's **web admin console only** — do not
> expect it to act as a working DNS resolver for real clients.

## Overview

**Estimated time:** 45–60 minutes

AdGuard Home is an open-source, network-wide DNS ad- and tracker-blocking
server with a web admin console for managing filter lists, custom rules, and
per-client settings. This lab takes you through the full operational
lifecycle of the **AdGuard Home on Cloud Run** module — deploying its web
admin console, verifying it, running it day-to-day, observing it, diagnosing
common problems, and tearing it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on AdGuard Home's DNS-filtering features (which are not
reachable in this deployment shape). For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/AdGuardHome_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running admin console (and understand what it cannot do — serve real DNS).
- Perform day-2 operations — inspect, scale, update, and manage storage.
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

1. In the RAD platform, open **AdGuard Home (Cloud Run)**, set `project_id`,
   and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/AdGuardHome_CloudRun)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform provisions the Cloud Run service, two Cloud Storage buckets
   (`conf` and `work`, mounted via GCS Fuse), and builds the custom container
   image. There is no database and no init job, so this deploy is faster than
   most modules in this catalogue — typically **5–10 minutes**.

3. When it completes, discover the resource with a name-agnostic filter (so
   the command keeps working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~adguardhome" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL   (web admin console ONLY — not a DNS resolver)"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service responds:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/"   # expect 200
   ```

2. Open `$SERVICE_URL` in a browser. On first visit, AdGuard Home serves its
   own **setup wizard** (not a RAD-managed login) on port 3000: choose the
   admin web UI port (**keep it 3000** — see the Pitfalls note below), set the
   admin username and password, and select upstream DNS servers. Complete the
   wizard to reach the dashboard.

3. Confirm the setup persisted by refreshing the page — you should land on
   the login page (not the setup wizard again), proving the configuration was
   written to the persistent `conf` GCS volume rather than lost on a cold
   start.

4. **Remember:** this deployment's DNS server function is not reachable —
   only the web admin console you just configured is. Do not configure real
   devices to use this service's IP/hostname as their DNS server.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions:**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update**
   on the deployment details page — the module owns the service spec, so
   scaling is a configuration change, not a manual `gcloud` edit (a manual
   edit would be reverted on the next apply).

3. **Update the application version tag** by changing the version input in
   the RAD platform and applying it via **Update**; a new image builds and a
   new revision rolls out.

4. **Inspect storage:**

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~adguardhome"
   gcloud storage ls gs://<conf-bucket-name>/
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Look for the entrypoint's DNS-scope reminder banner near the start of a
   fresh revision's logs. Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, request latency, instance count, and CPU/memory
   utilisation. The module can provision an **uptime check** (when
   `uptime_check_config.enabled = true` — it defaults to `false`); if enabled,
   confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit.

- **Revision unhealthy / service won't serve:** inspect the latest revision
  and its logs for startup errors.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Revision stops becoming Ready after you changed the web UI port in the
  setup wizard:** this is the module's #1 known pitfall — the platform's
  health probe and public URL are fixed at `container_port` (3000). If you
  changed AdGuard Home's own web UI port away from 3000 during setup, revert
  it (edit `AdGuardHome.yaml` on the `conf` bucket, or re-run setup) or set
  `container_port` to match.
- **Configuration not persisting across restarts:** confirm the `conf` and
  `work` GCS buckets exist and are mounted — check `gcs_volumes` was not
  overridden to something that omits them.
- **"Is this actually blocking ads on my network?"** No — this deployment's
  DNS server is not reachable from outside the container. This is expected;
  see the CRITICAL note at the top of this guide.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created —
the Cloud Run service, GCS buckets (`conf`, `work`), and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, two GCS buckets (`conf`, `work`), and builds the container image |
| 2 — Access & verify | Manual | Health check passes; complete AdGuard Home's own setup wizard; confirm config persists |
| 3 — Operate | Manual | Inspect revisions, scale, update version, inspect storage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, port-mismatch, storage, and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
