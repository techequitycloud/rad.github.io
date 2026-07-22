---
title: "TechnitiumDNS on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy TechnitiumDNS on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# TechnitiumDNS on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/TechnitiumDNS_CloudRun)**

## Overview

**Estimated time:** 45–75 minutes

> ⚠️ **Before you start:** this module deploys Technitium's **web admin console + REST API only**
> (port 5380/HTTP). Technitium's core DNS resolver function (port 53/udp+tcp) **cannot** be exposed
> through Cloud Run's HTTP(S)-only ingress. This lab covers managing DNS zones/records via the console —
> it does NOT make this deployment usable as an actual DNS resolver from any client.

Technitium DNS Server is an open-source, self-hosted authoritative/recursive DNS server with a
full-featured web console for managing zones, records, DNS-based blocking, and forwarders — no external
database required. This lab takes you through the full operational lifecycle of the **TechnitiumDNS on
Cloud Run** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on
TechnitiumDNS's DNS-server product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/TechnitiumDNS_CloudRun) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running console, including a first login and a zone-creation smoke test.
- Perform day-2 operations — inspect, update, and manage secrets.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Artifact Registry, and shared
  service accounts this module depends on).
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

1. In the RAD platform, open **TechnitiumDNS (Cloud Run)**, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/TechnitiumDNS_CloudRun) documents
   every input by group, with defaults. Review the estimated cost (if credits are enabled) and click
   **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions a single Cloud Run v2 service running the official prebuilt
   `technitium/dns-server` image, plus one Cloud Storage bucket (mounted at `/etc/dns`) and one
   auto-generated admin-password secret. No database is provisioned. Since the image is prebuilt (no
   Cloud Build step) and there is no database-initialisation job to wait for, a first deploy is
   typically fast (roughly **3–7 minutes**).

3. When it completes, discover the service with a name-agnostic filter (so the command keeps working
   regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~technitiumdns" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy — the console root page responds as soon as the server binds its
   port, with no database dependency to wait on:

   ```bash
   curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "$SERVICE_URL/"
   # expect 200 and a large body (the console's rendered HTML, not an empty response)
   ```

2. Retrieve the auto-generated admin password:

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~admin-password" \
     --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

3. Open `$SERVICE_URL` in a browser and log in as `admin` with that password. **Immediately change the
   password from the console's own user-management page** — Technitium only reads
   `DNS_SERVER_ADMIN_PASSWORD` on the very first boot, so rotating the Secret Manager value later has no
   effect on the live console; the console's own change-password flow is the only way to rotate it going
   forward.

4. Run a zone-creation smoke test to confirm the persisted `/etc/dns` volume actually works: in
   **Zones → Add Zone**, create a simple primary zone (e.g. `example.test`), add an `A` record, save,
   then **redeploy or restart the revision** and confirm the zone and record are still present —
   proving the GCS-mounted config volume genuinely persists state across restarts.

5. Remember: **no client anywhere can resolve DNS queries against this deployment.** The console lets
   you fully manage zone data, but only the web console/API is reachable — not port 53.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable revision; traffic shifts
   to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Update the application version** by changing the version input in the RAD platform and applying it
   via **Update**; a new revision rolls out pulling the newly-tagged prebuilt image. Pin an explicit
   version in production rather than relying on `latest`.

3. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~technitiumdns"
   ```

   Only the auto-generated `DNS_SERVER_ADMIN_PASSWORD` appears by default; this list is otherwise only
   populated if you supplied entries via `secret_environment_variables`.

4. **Enable Identity-Aware Proxy** for a production deployment — set `enable_iap = true` with authorized
   users/groups and apply via **Update**. Without IAP, the console is protected only by its own admin
   password over the public internet.

5. There is no database to open a session against — all state lives in the persisted `/etc/dns` volume,
   inspectable via `gcloud storage ls`:

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" --filter="name~-config" \
     --format="value(name)" --limit=1)
   gcloud storage ls "gs://$BUCKET/"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter: `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request count, request
   latency, instance count, and CPU/memory utilisation. Because `cpu_always_allocated = false` by
   default, expect the instance count to fall to zero between admin sessions — this is expected
   scale-to-zero behaviour, not a misconfiguration. If a Cloud Monitoring **uptime check** is enabled,
   confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are platform-level
diagnostics and do not change with TechnitiumDNS releases.

- **Revision unhealthy / console won't load:** inspect the latest revision and its logs for startup
  errors. The startup and liveness probes both target `/`, which should return `200` within seconds of
  boot — TechnitiumDNS has no database to wait on, so a slow or failing probe usually points at a
  container or storage-mount issue rather than a downstream dependency.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **"I can't resolve DNS against this deployment":** this is expected — see the disclosure at the top of
  this guide. This module intentionally exposes only the web console/API, never port 53.
- **Zones/records disappear after a restart:** confirm the config Cloud Storage bucket exists and is
  mounted (`gcloud storage buckets list --filter="name~-config"`); a missing/misconfigured GCS volume
  means `/etc/dns` reverts to an empty ephemeral filesystem on every restart.
- **Can't log in with the Secret Manager password:** remember it only applies on the very first boot. If
  the console was ever started before (even briefly, in an earlier failed deploy attempt with a
  persisted volume), the password already on disk wins — use the console's own password-reset flow or
  clear the volume for a genuinely fresh start.
- **Image pull / build failed:** review Cloud Build history — `container_image_source = "prebuilt"`
  means no build step runs at all, so a failure here usually points at an Artifact Registry mirroring
  issue rather than a Dockerfile problem.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section for setting-specific
gotchas (including the no-DNS-resolver scoping decision and IAP recommendation).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs
`terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment
is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict
with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records
**without** destroying the cloud resources (it makes RAD forget the project). This removes everything the
module created — the Cloud Run service, the config Cloud Storage bucket, the admin-password secret, and
Artifact Registry images. There is no Cloud SQL database to clean up (TechnitiumDNS provisions none).
Resources owned by **Services_GCP** (the VPC, shared registry) are managed separately and are not removed
here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions a single Cloud Run service running the prebuilt TechnitiumDNS image, one config bucket, one secret |
| 2 — Access & verify | Manual | Health check passes; first login succeeds; a zone/record survives a restart |
| 3 — Operate | Manual | Inspect revisions, update version, manage secrets, enable IAP |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, storage-persistence, and access issues; confirm no-DNS-resolver scoping |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
