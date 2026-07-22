---
title: "Homepage on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Homepage on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Homepage on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Homepage_CloudRun)**

## Overview

**Estimated time:** 30–45 minutes

Homepage is a self-hosted, highly customizable application dashboard — a
single landing page of links, bookmarks, and live status/stats widgets for
your other self-hosted services, configured entirely through YAML files. This
lab takes you through the full operational lifecycle of the **Homepage on
Cloud Run** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Homepage's own dashboard-editing features. For the
complete list of provisioned services and every configuration input
(organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Homepage_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate
over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Understand why Homepage has no database or first-run setup wizard, and where its configuration actually lives.
- Perform day-2 operations — inspect, scale, and update.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC,
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

1. In the RAD platform, open **Homepage (Cloud Run)**, set `project_id`, and
   review the inputs. Most deployments need no changes to the defaults — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Homepage_CloudRun)
   documents every input by group. Review the estimated cost (if credits are
   enabled) and click **Deploy**, which opens the deployment status page with
   real-time logs.

2. The platform provisions the Cloud Run service and a `storage` GCS bucket
   mounted at `/app/config`. **There is no Cloud SQL instance, no Redis, and
   no Secret Manager secret** — Homepage needs none of them. First deploys
   typically complete in **3–6 minutes**, faster than most modules in this
   catalogue since there is no database to provision.

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~homepage" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and serving — Homepage's own
   unauthenticated health endpoint:

   ```bash
   curl -s "$SERVICE_URL/api/healthcheck" -o /dev/null -w '%{http_code} %{size_download}\n'
   # expect: 200 <n-bytes>
   curl -s "$SERVICE_URL/api/healthcheck"
   # expect: "up"
   ```

2. Open `$SERVICE_URL` in a browser. **There is no first-run setup wizard and
   no login** — Homepage renders its dashboard immediately from whatever
   config exists in `/app/config` (the upstream image's own bundled defaults
   on a fresh deployment). You should see Homepage's default landing page.

3. Confirm where the configuration actually lives — the GCS bucket mounted
   at `/app/config`, not any database:

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~homepage" \
     --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/"
   gcloud storage cat "gs://$BUCKET/settings.yaml"
   ```

4. Make a real, stateful change and confirm it persists — edit
   `services.yaml` directly in the bucket, then reload the page:

   ```bash
   gcloud storage cp "gs://$BUCKET/services.yaml" /tmp/services.yaml
   # edit /tmp/services.yaml — add a service entry
   gcloud storage cp /tmp/services.yaml "gs://$BUCKET/services.yaml"
   ```

   Reload `$SERVICE_URL` in the browser — Homepage reads its YAML config live
   on every request, so the new entry appears immediately with no restart
   required. This is the actual proof the storage wiring works end-to-end.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions:**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** — the module default is `min_instance_count = 0` /
   `max_instance_count = 3`. Unlike most stateful apps in this catalogue,
   both directions are genuinely safe for Homepage: it reads its config live
   from disk (no in-process cache to warm) and has no single-writer state to
   race, so there is no need to pin `max_instance_count = 1` here.

3. **Update the application version tag** via the RAD platform's **Update**
   flow. Since the image is genuinely prebuilt (`ghcr.io/gethomepage/homepage`),
   no local Cloud Build step is involved — the platform just points the next
   revision at the new tag.

4. **Confirm there are no secrets to manage:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~homepage"
   # expect: no results — this is correct, not a misconfiguration
   ```

5. **Inspect or back up the configuration volume:**

   ```bash
   gcloud storage ls "gs://$BUCKET/"
   gcloud storage rsync "gs://$BUCKET/" /tmp/homepage-config-backup/
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs:**

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

2. **Check the GCS FUSE mount log line.** Near container start, Cloud
   Logging shows a GCSFuse "CLI Flags" line — a useful, low-stakes example of
   verifying actual runtime behavior against configured Terraform values (see
   the Configuration Guide's Pitfalls section for why this specific line is
   worth knowing about):

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100 \
     | grep -i gcsfuse
   ```

3. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, latency, instance count, and CPU/memory utilisation. The
   module can provision an **uptime check** (disabled by default); if
   enabled, confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

- **Revision unhealthy / service won't serve:** inspect the latest revision
  and its logs. The startup probe targets `/api/healthcheck`.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```

- **Widgets fail to load data / `/api/*` calls 400.** This is almost always
  `HOMEPAGE_ALLOWED_HOSTS` rejecting the request's `Host` header. The default
  is `*` (accepts any host), so this should only happen if it was tightened
  and the deployed hostname changed since. Verify the injected value:
  ```bash
  gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | grep -o 'HOMEPAGE_ALLOWED_HOSTS[^,]*'
  ```

- **Configuration edits made through the bucket don't appear.** Confirm you
  edited the file actually mounted at `/app/config` (the `storage` bucket
  from Task 1) and that the browser tab was reloaded — Homepage has no
  server-side cache to invalidate, so a stale view is almost always a stale
  browser tab, not a wiring problem.

- **Unexpected file ownership when inspecting the mount.** If you ever
  `kubectl`/shell into the container (not applicable on Cloud Run directly,
  but relevant if comparing against a future GKE deployment) and see
  `uid=2000`/`gid=2000` on files instead of the configured `uid=1000`,
  that's expected — see the Configuration Guide's Pitfalls section on the
  GCS FUSE mount-option override.

- **403 / permission errors from GCP itself:** verify the runtime service
  account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible. If a
deployment is stuck and the RAD platform can no longer manage it, use
**Purge** instead — it removes the deployment from RAD's records **without**
destroying the cloud resources. This removes everything the module created —
the Cloud Run service, the `storage` GCS bucket (and every YAML config file
in it), and any Artifact Registry images. Resources owned by **Services_GCP**
(the VPC, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run and a `storage` GCS bucket at `/app/config` — no database, no Redis, no secrets |
| 2 — Access & verify | Manual | `/api/healthcheck` returns `200 "up"`; dashboard renders with no setup wizard; a direct YAML edit proves the storage wiring |
| 3 — Operate | Manual | Inspect revisions, confirm scaling is safe in both directions, update version, back up the config bucket |
| 4 — Observe | Manual | Query Cloud Logging (including the GCSFuse mount-flags line); review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision health, `HOMEPAGE_ALLOWED_HOSTS`, and config-propagation issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the configuration bucket |
