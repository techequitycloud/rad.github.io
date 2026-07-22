---
title: "Gatus on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Gatus on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Gatus on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Gatus_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Gatus is an open-source, developer-oriented status page and health-check monitor:
it polls configured HTTP, TCP, DNS, and other endpoints on independent schedules,
evaluates simple pass/fail conditions, and serves a live public status page plus
alerting — no external database required. This lab takes you through the full
operational lifecycle of the **Gatus on Cloud Run** module on Google Cloud: deploy
it, access and verify it, run it day-to-day, observe it, diagnose common problems,
and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Gatus product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Gatus_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including viewing the live status page.
- Perform day-2 operations — inspect, scale considerations, update, and manage
  secrets.
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

1. In the RAD platform, open **Gatus (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Gatus_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions a single Cloud Run v2 service running the Gatus Go
   binary and builds the container image (which bakes in a default `config.yaml`
   with one example HTTP check). No database, cache, or object-storage bucket is
   provisioned — Gatus's optional history store is a local SQLite file. There is no
   database-initialisation job to wait for, so a first deploy is typically much
   faster than a database-backed module (roughly **5–10 minutes**, dominated by the
   image build).

3. When it completes, discover the service with a name-agnostic filter (so the
   command keeps working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~gatus" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Gatus's health endpoint responds as soon as the
   server binds its port — there is no database dependency to wait on:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/health"   # expect 200
   ```

2. Open `$SERVICE_URL` in a browser to view the live status page — it shows the
   baked-in `example` endpoint check and its up/down history as checks accumulate.

3. Gatus ships with **no authentication** on its status page by default — anyone
   with the URL can view it. There is no admin account to create. If the page will
   list sensitive endpoint names, edit `modules/Gatus_Common/scripts/config.yaml`'s
   `security` block (basic auth or OIDC) and redeploy — this requires a rebuild,
   not a runtime setting.

4. Gatus has **no runtime API or UI for adding monitored endpoints**. To monitor a
   real endpoint instead of (or alongside) the baked-in example, edit the
   `endpoints` list in `modules/Gatus_Common/scripts/config.yaml` and redeploy.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not scale beyond one instance.** `max_instance_count` defaults to `1` and
   should stay there — Gatus's watchdog polling loop has no shared coordination
   between instances, so scaling out would have each instance independently poll
   every endpoint and duplicate alert notifications. Any change to min/max
   instances is made via the RAD platform's deployment details page and applied via
   **Update**, not a manual `gcloud` edit (which would be reverted on the next
   apply).

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a new revision
   rolls out. Pin an explicit `v5.x.y` in production rather than relying on
   `latest`.

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~gatus"
   ```

   Gatus generates no secrets of its own at deploy time — this list is only
   populated if you supplied entries via `secret_environment_variables`.

5. **Persistent history is intentionally NOT the default on Cloud Run.** Gatus
   hardcodes SQLite WAL journal mode for its history store, and SQLite's own
   documentation states WAL is unsupported on network filesystems — so `enable_nfs`
   carries a real corruption risk here. If durable check history matters, deploy
   `Gatus_GKE` with `stateful_pvc_enabled = true` instead (a real block device);
   Cloud Run has no equivalent option.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.
   Gatus logs each endpoint check's result (success/failure, duration) as it runs —
   useful for confirming a newly-added endpoint is actually being polled.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency, instance count, and CPU / memory utilisation. Because
   `cpu_always_allocated = true` by default, expect a steady CPU baseline even at
   low traffic — this is required to keep the watchdog polling loop running, not a
   misconfiguration. If a Cloud Monitoring **uptime check** is enabled, confirm it
   is green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Gatus releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The startup and liveness probes both target `/health`,
  which should return `200` within seconds of boot — Gatus has no database to wait
  on, so a slow or failing probe usually points at a container build or config
  issue rather than a downstream dependency.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Check history "disappears" after a redeploy:** this is expected with the
  default ephemeral storage — every restart/redeploy resets history by design
  (the configured endpoints themselves are unaffected, only their historical
  results/uptime percentages reset). See Task 3 step 5 for the durable-history
  options and their tradeoffs.
- **A newly-added endpoint isn't being checked:** confirm you edited
  `modules/Gatus_Common/scripts/config.yaml` and redeployed — Gatus has no runtime
  API for adding checks, so an endpoint added anywhere else has no effect.
- **Status page is unreachable / blocked unexpectedly:** check `ingress_settings`
  (must be `all` for public traffic) and whether `enable_iap` was turned on — IAP
  requires Google sign-in and blocks unauthenticated viewing, which is usually not
  what a public status page wants.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section
for setting-specific gotchas (including keeping `max_instance_count = 1` and
`cpu_always_allocated = true` for correct scheduled-check delivery, and the
SQLite WAL persistence caveat).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service
and Artifact Registry images. There is no Cloud SQL database, GCS bucket, or
auto-generated secret to clean up (Gatus provisions none by default). Resources
owned by **Services_GCP** (the VPC, shared registry) are managed separately and are
not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions a single Cloud Run service running Gatus; no database or storage bucket |
| 2 — Access & verify | Manual | Health check passes; live status page renders with the baked-in example check |
| 3 — Operate | Manual | Inspect revisions, keep max instances at 1, update version, manage secrets, understand the persistence tradeoff |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, config-edit, access, and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
