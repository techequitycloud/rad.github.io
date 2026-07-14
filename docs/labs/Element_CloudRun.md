---
title: "Element on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Element on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Element on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Element_CloudRun)**

## Overview

**Estimated time:** 30–60 minutes

Element is the leading open-source Matrix web client — a self-hosted,
end-to-end-encrypted messaging app that runs as a static single-page application and
connects to a Matrix homeserver you specify. This lab takes you through the full
operational lifecycle of the **Element on Cloud Run** module on Google Cloud: deploy
it, point it at a homeserver, verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**,
not on Element product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Element_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Point Element at a Matrix homeserver and verify the running service.
- Perform day-2 operations — inspect, scale, update the version, and re-point the
  homeserver.
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
- A **Matrix homeserver** to connect to — either the public `matrix.org` (the
  default) or your own Synapse/Dendrite instance.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Element (Cloud Run)**, set `project_id`, and set
   `homeserver_url` / `homeserver_name` to your Matrix homeserver (or leave them blank
   to use the public `matrix.org`). Review the remaining inputs — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Element_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform builds the custom Element image (a thin layer over
   `vectorim/element-web` that generates `config.json` at start-up), pushes it to
   Artifact Registry, and provisions the Cloud Run service. There is **no database,
   no secret, and no storage bucket** to create, so first deploys are fast —
   typically **5–10 minutes**, dominated by the container build.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~element" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is serving and that its runtime `config.json` points at your
   homeserver:

   ```bash
   curl -s "$SERVICE_URL/config.json" | grep -E 'base_url|server_name'   # your homeserver
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/"              # expect 200
   ```

2. Open `$SERVICE_URL` in a browser. Element loads its sign-in screen showing the
   configured homeserver. Log in with an account on that homeserver (or register one,
   if the homeserver allows it) — authentication happens **between your browser and
   the homeserver**, not in the Cloud Run container.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the service spec, so scaling is a
   configuration change, not a manual `gcloud` edit (a manual edit would be reverted
   on the next apply). Element is stateless, so scaling is unconstrained; leaving
   `min_instance_count = 0` keeps it free at idle.

3. **Re-point the homeserver** by changing `homeserver_url` / `homeserver_name` in the
   RAD platform and clicking **Update** — the entrypoint rewrites `config.json` on the
   new revision's containers. No image rebuild is required.

4. **Update the application version** by changing the version input and applying it via
   **Update**; a new image builds and a new revision rolls out. Verify the deployed
   revision's image digest if a change appears stale.

5. **Confirm the injected homeserver on the running revision:**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format='value(spec.template.spec.containers[0].env)'
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — nginx access/error logs, from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (scaling behaviour), and CPU /
   memory utilisation. When the endpoint is public, the module also provisions an
   **uptime check**; confirm it is green under Monitoring → Uptime checks, and review
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Element releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its
  logs for nginx startup errors. The startup probe targets `/`, which nginx answers
  as soon as it binds port 80.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Login screen shows the wrong homeserver:** the entrypoint writes `config.json`
  from `HOMESERVER_URL` / `HOMESERVER_NAME`; confirm the env on the running revision
  (Task 3, step 5) and re-point via **Update**.
- **Users can load the UI but cannot log in:** the homeserver is unreachable or
  incorrect — verify `homeserver_url` resolves and serves the Matrix client-server API
  (`curl -s <homeserver_url>/_matrix/client/versions`).
- **Image build failed:** review Cloud Build history for the failed build's log; a
  hand-set `latest` tag on a raw build ARG is a common cause (`MANIFEST_UNKNOWN`).
- **403 / permission errors on deploy:** verify the runtime service account's IAM
  roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can no
longer manage it (for example after manual changes that conflict with the Terraform
state), use **Purge** instead — it removes the deployment from RAD's records
**without** destroying the cloud resources. This removes everything the module created
— the Cloud Run service and its Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, registry) are managed separately and are not removed here.

Because Element is stateless, there is no database, secret, or storage bucket to clean
up — teardown is clean and fast.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the Element image and provisions the Cloud Run service (no DB/secret/storage) |
| 2 — Access & verify | Manual | `config.json` points at your homeserver; log in via the browser-to-homeserver flow |
| 3 — Operate | Manual | Inspect revisions, scale, re-point the homeserver, update the version |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, homeserver-config, login, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
