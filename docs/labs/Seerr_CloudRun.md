---
title: "Seerr on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Seerr on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Seerr on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Seerr_CloudRun)**

## Overview

**Estimated time:** 30–60 minutes

Seerr is the 2026 merger of Jellyseerr and Overseerr — a request UI that
sits in front of Jellyfin, Plex, or Emby, letting users browse and request
titles for an admin to approve. This lab takes you through the full
operational lifecycle of the **Seerr on Cloud Run** module on Google Cloud:
deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Seerr product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Seerr_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and complete Seerr's first-run setup wizard.
- Understand why `DB_TYPE=postgres` matters and how to confirm your deployment is actually using Postgres, not a silently-wiped SQLite fallback.
- Perform day-2 operations — inspect, scale, and update.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud
  SQL, Artifact Registry, and shared service accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.
- (Optional) An existing Jellyfin, Plex, or Emby instance, plus Sonarr/Radarr, to connect during Seerr's setup wizard.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Seerr (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Seerr_CloudRun)
   documents every input by group, with defaults. If you plan to run more
   than one instance and want to avoid a `settings.json` lost-write race,
   consider setting `max_instance_count = 1` explicitly (see the
   Configuration Guide's Pitfalls section). Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL PostgreSQL 15
   database/role, a `storage` GCS bucket mounted at `/app/config`, and a
   Secret Manager secret holding the generated database password. There is
   **no first-run admin credential to retrieve** — Seerr's schema migrations
   run automatically on the app's first boot, and the admin account is
   created through the app's own setup wizard. First deploys typically take
   **5–10 minutes**.

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~seerr" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and serving — this is Seerr's own
   unauthenticated status endpoint, not a generic health page:

   ```bash
   curl -s "$SERVICE_URL/api/v1/status" | head -c 300; echo
   # expect JSON: {"version":"...","commitTag":"...", ...}
   ```

2. Open `$SERVICE_URL` in a browser and complete Seerr's **first-run setup
   wizard**:
   - Sign in with a Jellyfin/Plex/Emby account, or create a local Seerr account.
   - Connect your media server.
   - Connect Sonarr and/or Radarr, if you use them.

3. **Confirm Postgres is actually in use, not the SQLite fallback.** This is
   the single most important verification step for this module — a
   misconfigured `DB_TYPE` would still boot and pass the health check while
   silently writing to a container-local file. Check the injected env var
   directly:

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format='value(spec.template.spec.containers[0].env)' | grep -o 'DB_TYPE[^,]*'
   # expect: name:DB_TYPE value:postgres
   ```

   As a second, behavioral confirmation: make a small settings change (e.g.
   toggle a discovery slider), then force a new revision or restart the
   service, and confirm the change survived — a SQLite fallback would have
   lost it.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions:**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** — the module default is `min_instance_count = 1` /
   `max_instance_count = 5`. If several instances might edit Seerr's
   settings (media server config, discovery sliders, notification agents)
   concurrently, consider lowering `max_instance_count` to `1` via the RAD
   platform's **Update** flow — `settings.json` is a single mutable file,
   not a transactional database, so concurrent writers risk a lost write.

3. **Update the application version tag** via the RAD platform's **Update**
   flow. Since the image is genuinely prebuilt (`ghcr.io/seerr-team/seerr`),
   no local Cloud Build step is involved — the platform just points the next
   revision at the new tag.

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~seerr"
   ```

5. **Inspect the settings volume** — `settings.json` and related files:

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~seerr" \
     --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs:**

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, latency, instance count, and CPU/memory utilisation. The
   module can provision an **uptime check** (disabled by default); if
   enabled, confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

- **Revision unhealthy / service won't serve:** inspect the latest revision
  and its logs. The startup probe targets `/api/v1/status`.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```

- **Settings (media server connection, sliders, notification agents) seem
  to "reset" after a redeploy or restart.** This is the classic symptom of
  the `DB_TYPE` trap — Seerr silently fell back to a container-local SQLite
  database. Verify `DB_TYPE=postgres` is actually injected (see Task 2, step
  3). If you customised `environment_variables` and replaced the map
  wholesale instead of adding to it, this is the most likely cause.

- **App boots and passes health checks, but the request history is empty
  after a scale-to-zero cold start.** Confirm the Cloud SQL instance and the
  database role exist and that `enable_cloudsql_volume = true`:
  ```bash
  gcloud sql instances list --project="$PROJECT"
  gcloud sql databases list --instance=<instance-name> --project="$PROJECT"
  ```

- **401/403 errors calling Sonarr/Radarr from inside Seerr's request
  approval flow.** This is an application-layer credential issue inside
  Seerr's own settings (API keys entered during setup), not a platform/module
  issue — re-check the API key and base URL entered in Seerr's Settings →
  Services page.

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
the Cloud Run service, the Cloud SQL database/role, the `storage` GCS bucket
(and its `settings.json`), Secret Manager secrets, and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, registry, Cloud SQL
instance itself) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL PostgreSQL, and a GCS settings bucket |
| 2 — Access & verify | Manual | `/api/v1/status` returns JSON; complete the setup wizard; confirm `DB_TYPE=postgres` is actually injected |
| 3 — Operate | Manual | Inspect revisions, understand the concurrency/settings-write tradeoff, update version, inspect the settings bucket |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, DB_TYPE-fallback, and cold-start database issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the settings bucket and database |
