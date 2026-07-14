---
title: "Uptime Kuma on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Uptime Kuma on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Uptime Kuma on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/UptimeKuma_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Uptime Kuma is a self-hosted uptime monitoring tool for websites, APIs, TCP ports, and DNS records, with status pages and 90+ notification channels. This lab takes you through the full operational lifecycle of the **Uptime Kuma on Cloud Run** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on Uptime Kuma product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/UptimeKuma_CloudRun) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access the service, complete the first-run admin setup, and verify health.
- Explain why Uptime Kuma needs always-allocated CPU and a running instance to monitor.
- Perform day-2 operations — inspect revisions, scale, update, and check the NFS-backed state.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Filestore/NFS
  networking, Artifact Registry, and shared service accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **UptimeKuma (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/UptimeKuma_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service with **CPU always allocated** (the
   check scheduler runs between requests), a Filestore NFS share mounted at
   `/app/data` for the embedded SQLite database, and mirrors the official
   `louislam/uptime-kuma` image into Artifact Registry. There is **no Cloud SQL
   instance, no application secret, and no initialization job** — this is one of
   the fastest modules to deploy (typically **10–15 minutes**; no database
   provisioning).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~uptimekuma" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Uptime Kuma's health path is `/` on port 3001,
   which returns HTTP 200 once the Node.js server is up (first boot also creates
   the SQLite schema on the NFS volume — allow up to a minute on a fresh deploy):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
   ```

2. Open `$SERVICE_URL` in a browser. On first access Uptime Kuma presents its
   **setup page** — create the admin account (there are no default credentials
   baked into the image). **Do this immediately**: until the admin account exists,
   the setup page is publicly reachable at the `run.app` URL. The account is
   stored in SQLite on the NFS volume, so it survives restarts and revisions.

3. Add a first monitor (e.g. an HTTPS check against a site you own) and watch it
   turn green. Note there is **no secret to retrieve** — the module creates no
   Secret Manager entries:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~uptimekuma"   # expect empty
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale — the setting that matters most for this app.** With the default
   `min_instance_count = 0`, the service scales to zero when idle and **no checks
   run while it is down**. For genuine 24/7 monitoring, set
   `min_instance_count = 1` and `max_instance_count = 1` (SQLite is single-writer)
   and click **Update** on the deployment details page — the module owns the
   service spec, so scaling is a configuration change, not a manual `gcloud` edit
   (a manual edit would be reverted on the next apply). Keep
   `cpu_always_allocated = true`: without allocated CPU the in-process scheduler
   is throttled between requests and checks stall.

3. **Update the application version** by changing the version input via **Update**
   on the deployment details page; the new image tag is mirrored and a new
   revision rolls out. Monitors and history persist on the NFS volume.

4. **Verify the persistent state** lives on NFS, not ephemeral disk:

   ```bash
   gcloud filestore instances list --project="$PROJECT"
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="yaml(spec.template.spec.volumes)"
   ```

5. **No database session to open** — there is no Cloud SQL instance
   (`database_type = "NONE"`); all state is the SQLite file under `/app/data`.
   Back it up by exporting from the Uptime Kuma UI (Settings → Backup) or by
   snapshotting the Filestore share.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, latency, **instance count** (with `min = 1` it should never drop to 0 —
   if it does, your monitoring has gaps), and CPU / memory utilisation. Because
   CPU is always allocated, expect a steady low CPU baseline even with no
   dashboard traffic — that is the check scheduler working.

3. **Monitor the monitor.** Optionally enable the module's `uptime_check_config`
   (disabled by default) so Google Cloud Monitoring probes Uptime Kuma itself —
   an outside-in signal that your monitoring system is up.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Uptime Kuma releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs; the startup probe allows generous time for first boot:
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Monitors show gaps / alerts arrive late:** the classic Uptime Kuma-on-Cloud-Run
  failure. Check `min_instance_count` (0 means checks pause when idle) and
  `cpu_always_allocated` (must be `true`; request-based billing throttles the
  scheduler). Instance-count dropping to zero in Monitoring confirms it.
- **Data lost after a restart or update:** verify `enable_nfs = true`, the mount
  path is exactly `/app/data`, and the execution environment is `gen2` (required
  for Filestore mounts in Cloud Run). If the volume list in Task 3.4 is empty,
  Uptime Kuma has been writing to ephemeral disk.
- **SQLite lock errors / flapping under load:** more than one instance is writing
  the database over NFS — set `max_instance_count = 1`.
- **Cannot reach monitored private targets:** probes to RFC-1918 addresses need
  VPC egress; the default `vpc_egress_setting = "PRIVATE_RANGES_ONLY"` covers
  this. For probes that must egress via the VPC/NAT (stable source IP for
  allow-listed targets), set `ALL_TRAFFIC`.
- **Image pull failed:** confirm `enable_image_mirroring = true` and check the
  mirrored copy in Artifact Registry (`gcloud artifacts docker images list ...`).
  There is no Cloud Build step to debug — the image is prebuilt.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
the Filestore NFS share (including the SQLite database with all monitors and
history — export a backup first if you want to keep them), and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, shared registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run (CPU always allocated), NFS at `/app/data`, and mirrors the prebuilt image — no DB, secrets, or init jobs |
| 2 — Access & verify | Manual | Health check passes; admin account created on the first-run setup page |
| 3 — Operate | Manual | Inspect revisions, set min=1/max=1 for 24/7 single-writer monitoring, update version, verify NFS state |
| 4 — Observe | Manual | Query Cloud Logging; watch instance count and CPU baseline; optionally monitor the monitor |
| 5 — Troubleshoot | Manual | Diagnose revision, scale-to-zero gaps, NFS/data-loss, SQLite lock, egress, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
