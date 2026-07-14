---
title: "Netdata on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Netdata on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Netdata on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Netdata_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Netdata is an open-source, real-time infrastructure and application monitoring
agent that collects thousands of per-second metrics and serves them on a
built-in dashboard and REST API. This lab takes you through the full
operational lifecycle of the **Netdata on Cloud Run** module on Google Cloud:
deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Netdata product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Netdata_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and understand its default exposure.
- Perform day-2 operations — inspect, keep at single-instance scale, update, and manage secrets.
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

1. In the RAD platform, open **Netdata (Cloud Run)**, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Netdata_CloudRun)
   documents every input by group, with defaults. **Pay close attention to
   `ingress_settings` and `enable_admin_password`**: the module defaults to
   `ingress_settings = "all"` (public internet access) paired with
   `enable_admin_password = true` (a Secret-Manager-backed credential is
   generated to satisfy the module's plan-time guard) — but Netdata's own
   dashboard has **no built-in login**, so out of the box the deployment is
   **publicly reachable and unauthenticated**. If this is not what you want,
   set `ingress_settings = "internal"` before deploying. Review the estimated
   cost (if credits are enabled) and click **Deploy**, which opens the
   deployment status page with real-time logs.

2. The platform builds a thin custom image (`FROM netdata/netdata:<pinned
   version>`), pushes it to Artifact Registry, provisions the Cloud Run
   service, a Cloud Storage data bucket mounted as a **GCS FUSE** volume at
   `/var/lib/netdata` (requires the gen2 execution environment), and — if
   `enable_admin_password = true` — a Secret Manager secret holding
   `NETDATA_ADMIN_PASSWORD`. There is **no database** (`database_type = NONE`)
   and **no initialization job** to wait on, so first deploys are dominated by
   the image build rather than by database provisioning — typically **10–20
   minutes**.

3. When it completes, discover the resources with name-agnostic filters (so
   the commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~netdata" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Netdata exposes an info endpoint that
   responds only once the agent has initialised:

   ```bash
   curl -s "$SERVICE_URL/api/v1/info"   # expect a 200 JSON body describing the running agent
   ```

2. Open `$SERVICE_URL` in a browser. Unlike most application modules, Netdata
   has **no first-run wizard and no admin-account creation step** — the
   dashboard is fully functional the moment the service is Ready. If you kept
   the default `ingress_settings = "all"`, this dashboard (full host CPU,
   memory, disk, network, and container metrics) is reachable by anyone with
   the URL. Treat this as expected-but-risky default behaviour, not a bug:
   - For a quick fix, flip `ingress_settings` to `internal` in the RAD
     platform and apply via **Update**.
   - To keep it public but add a login gate, enable `enable_iap` (Google
     sign-in in front of an external load balancer) — see the Configuration
     Guide.

3. If `enable_admin_password = true`, retrieve the generated credential — it
   does **not** gate Netdata's own dashboard, but it is available for an
   operator-managed reverse proxy or the Netdata Cloud claim flow:

   ```bash
   gcloud secrets versions access latest \
     --secret="$(gcloud secrets list --project="$PROJECT" --filter="name~netdata-admin-password" --format='value(name)')" \
     --project="$PROJECT"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an
   immutable revision):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not scale beyond one instance.** `min_instance_count` and
   `max_instance_count` both default to `1` — Netdata keeps its metrics
   database on the local/GCS-backed volume of a single instance, so scaling
   out produces independent, non-federated agents rather than a shared
   dashboard. Leave these at `1` on the deployment details page.

3. **Update the application version** by changing `application_version` in
   the RAD platform and applying it via **Update**. `latest` resolves to a
   pinned known-good tag (`v2.2.6`) at build time via the app-specific
   `NETDATA_VERSION` build argument — set an explicit tag to track a
   different release, then confirm the rebuild picked it up:

   ```bash
   gcloud run revisions describe "$(gcloud run revisions list --service="$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format='value(metadata.name)' --limit=1)" \
     --project="$PROJECT" --region="$REGION" --format='value(spec.containers[0].image)'
   ```

4. **Manage secrets and check for jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~netdata"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # empty by default — Netdata has no init/backup jobs
   ```

5. **Check metrics storage usage** — the GCS FUSE bucket backing
   `/var/lib/netdata` holds the dbengine metrics store, alarm log, and
   configuration:

   ```bash
   gcloud storage ls -L gs://<data-bucket>/ | head
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   request count, request latency, instance count, and CPU/memory
   utilisation. The module can provision an **uptime check** targeting
   `/api/v1/info` (disabled by default); if enabled, confirm it is green under
   Monitoring → Uptime checks, and review Alerting → Policies. Netdata's own
   dashboard is also a monitoring surface — it self-reports collector health
   and chart counts on its front page.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Netdata releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision
  and its logs for startup errors. The startup probe targets `/api/v1/info`
  with a 15-second initial delay and 10 retries.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Metrics reset on every deploy:** confirm `enable_gcs_storage_volume` (and
  the underlying `create_cloud_storage`) is still enabled, and that the
  service's execution environment is **gen2** — GCS FUSE for
  `/var/lib/netdata` requires it; gen1 cannot mount the volume, and every new
  revision then starts with a blank metrics database.
- **Dashboard unexpectedly public:** re-check `ingress_settings` — the module
  default is `all`. Combined with the default `enable_admin_password = true`,
  this passes plan-time validation but still leaves the raw dashboard
  unauthenticated to anyone who reaches the URL. Switch to `internal`, or add
  `enable_iap` / an authenticating reverse proxy in front of an external LB.
- **Image build failed:** review Cloud Build history for the failed build's
  log; a common cause is pinning `application_version` to a tag that does not
  exist upstream for `netdata/netdata`.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the `ingress_settings` +
`enable_admin_password` pairing and the gen2/GCS-FUSE requirement).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
the GCS data bucket (and with it, all accumulated monitoring history), any
Secret Manager secret, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, shared registry) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds a pinned custom image, provisions Cloud Run, a GCS FUSE data bucket, and (by default) an admin-password secret — no database, no init job |
| 2 — Access & verify | Manual | Health check passes; dashboard is immediately usable (no admin setup) — confirm the exposure you intended (`ingress_settings`) |
| 3 — Operate | Manual | Inspect revisions, keep single-instance scale, update version, manage secrets, check metrics storage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and optional uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, GCS FUSE/persistence, public-exposure, and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including accumulated metrics history |
