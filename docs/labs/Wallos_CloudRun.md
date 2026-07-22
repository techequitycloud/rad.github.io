---
title: "Wallos on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Wallos on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Wallos on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Wallos_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Wallos is an open-source, self-hosted subscription and recurring-expense tracker
built on plain PHP 8.3 + php-fpm — it tracks recurring subscriptions, converts
prices across currencies, sends renewal notifications, and supports a household
multi-user mode, with no external database. This lab takes you through the full
operational lifecycle of the **Wallos on Cloud Run** module on Google Cloud:
deploy it, access and verify it, run it day-to-day, observe it, diagnose common
problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Wallos product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Wallos_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, including the default admin login.
- Understand why this module is fixed to a single always-on instance and must
  never be scaled to zero or beyond one replica.
- Perform day-2 operations — inspect revisions, manage ingress, and inspect the
  persistent GCS-backed state.
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

1. In the RAD platform, open **Wallos (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Wallos_CloudRun)
   documents every input by group, with defaults. Note that **ingress defaults to
   `all`** (public) — decide up front whether you need `ingress_settings = "internal"`
   to restrict access to the VPC. Also note that `min_instance_count`,
   `max_instance_count`, and `cpu_always_allocated` are all fixed at their sensible
   defaults (`1`, `1`, `true`) for a real reason — see Task 3 before changing them.
   Review the estimated cost (if credits are enabled) and click **Deploy**, which
   opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, **two** Cloud Storage buckets
   (`db` mounted at `/var/www/html/db` holding the SQLite database, and `uploads`
   mounted at `/var/www/html/images/uploads/logos` holding custom provider logos),
   and pulls the prebuilt `bellamy/wallos` image. There is no Cloud SQL instance,
   no Secret Manager application secret, and no database-initialisation job —
   Wallos is self-contained. First deploys typically complete in **5–10 minutes**.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~wallos" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Wallos documents no dedicated health endpoint,
   so the probe (and this check) hits the login page at `/`:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200
   ```

2. `ingress_settings` defaults to `all` (public), so the URL above should already be
   reachable from your workstation. If it was changed to `internal`, the service is
   only reachable from inside the VPC — curl it from a Cloud Shell/VM on the same
   network, or set `ingress_settings = "all"` in the RAD platform and apply via
   **Update** to reach it from your workstation again.

3. Open `$SERVICE_URL` in a browser and log in with the seeded default credential
   **`admin` / `admin`**. Immediately change the password under **Settings →
   Account** — this credential is well-known and grants full control of the
   subscription data.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Never scale beyond one instance, and never scale to zero.** This is stricter
   than the usual "avoid cold starts" rule of thumb — Wallos runs a real,
   always-on cron daemon (8 baked-in scheduled tasks: exchange-rate refresh,
   renewal notifications, an email-verification poll every 2 minutes, and others)
   that only fires while an instance is running with allocated CPU. Leave
   `min_instance_count = 1`, `max_instance_count = 1`, and `cpu_always_allocated =
   true` in the RAD platform; a manual `gcloud` edit would be reverted on the next
   apply anyway, and scaling to zero silently stops every scheduled task with no
   error — renewal notifications simply stop arriving.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; `bellamy/wallos` is pulled fresh, and a
   new revision rolls out.

4. **Change ingress or add access control** — flip `ingress_settings` between
   `internal` and `all`, or enable `enable_iap` with authorized users/groups, then
   apply via **Update**.

5. **Inspect the persistent state** — the SQLite database lives in the `db` GCS
   bucket, and custom provider logos live in the `uploads` GCS bucket, both
   reported in the deployment Outputs. Never delete either bucket; doing so
   destroys that state permanently:

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~wallos"
   gcloud storage ls gs://<db-bucket>/
   gcloud storage ls gs://<db-bucket>/wallos.db
   gcloud storage ls gs://<uploads-bucket>/
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer. Since Wallos's cron daemon runs
   in-process, its scheduled-task activity is visible only here (there is no
   separate Cloud Run Job for it):

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency, instance count (should stay at exactly 1), and CPU /
   memory utilisation. If `uptime_check_config` is enabled, confirm it is green
   under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Wallos releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for startup errors. The startup probe targets `/` with a 15-second delay —
  startup is fast since there are no migrations to wait on.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Service unreachable from your workstation:** check `ingress_settings` — the
  default is `all` (public); if it has been changed to `internal` (VPC-only), that
  is expected behaviour, not a fault.
- **GCS FUSE mount / state not persisting:** confirm `execution_environment = gen2`
  (required for both GCS FUSE mounts) and that the `db`/`uploads` buckets still
  exist.
  ```bash
  gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  gcloud storage buckets list --project="$PROJECT" --filter="name~wallos"
  ```
- **Renewal notifications or exchange-rate updates stopped arriving:** this almost
  always means the instance scaled to zero or `cpu_always_allocated` was flipped
  to `false` — check `min_instance_count` and `cpu_always_allocated` first, before
  assuming an application-level bug.
- **Login shows `admin`/`admin` still active after redeploy:** this is expected —
  the credential is seeded only if no SQLite DB exists yet at
  `/var/www/html/db/wallos.db`. If a fresh admin/admin prompt appears
  unexpectedly, the `db` bucket may have been replaced or emptied; check for a
  bucket deletion/recreation in Cloud Audit Logs.
- **Missing default provider logos on first deploy:** if `bellamy/wallos` bakes in
  any default assets under the mounted paths, they can be hidden by the volume
  mount (see the Configuration Guide's Pitfalls table) — this is a known,
  unconfirmed risk area to check first.
- **Image pull failed:** confirm `bellamy/wallos` (or the mirrored Artifact
  Registry copy) is reachable; review Cloud Build history if image mirroring is
  enabled.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule to keep `min_instance_count = max_instance_count
= 1` with `cpu_always_allocated = true`, and to never delete the `db`/`uploads`
buckets).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service, the `db` and `uploads` GCS buckets (including the embedded SQLite database and custom logos — this is destructive and unrecoverable), and Artifact Registry images. Resources owned by **Services_GCP** (the VPC, shared Artifact Registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run and the `db`/`uploads` GCS FUSE buckets; no Cloud SQL, no init job |
| 2 — Access & verify | Manual | Health check passes; log in with seeded `admin`/`admin` and change the password immediately |
| 3 — Operate | Manual | Inspect revisions, keep `min = max = 1` + `cpu_always_allocated = true`, update version, adjust ingress, inspect GCS state |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, ingress, GCS FUSE, cron-daemon, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes the service and the `db`/`uploads` buckets (destructive) |
