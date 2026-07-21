---
title: "Loki on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Loki on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Loki on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Loki_CloudRun)**

## Overview

**Estimated time:** 30–45 minutes

Grafana Loki is a horizontally-scalable log aggregation system ("Prometheus for
logs") that indexes only a small set of labels per log stream rather than full log
text, keeping storage costs low. This lab takes you through the full operational
lifecycle of the **Loki on Cloud Run** module on Google Cloud: deploy it, access and
verify it, run it day-to-day, observe it, diagnose common problems, and tear it
down.

Loki has no database and no built-in web UI, so this lab is shorter and simpler than
most in this catalog — there is no first-run admin account to create, no schema
migration to wait on. The lab focuses on operating the **Cloud Run module and the
Google Cloud platform**, not on Loki's own query language or Grafana integration.
For the complete list of provisioned services and every configuration input
(organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Loki_CloudRun) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and issue a first LogQL query.
- Perform day-2 operations — inspect, understand the scaling constraint, update, and
  inspect GCS storage usage.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Artifact
  Registry, and shared service accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and
  `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.
- Optional but useful: **`logcli`** (Grafana's official Loki CLI) installed locally
  for Task 2.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Loki (Cloud Run)**, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Loki_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform provisions the Cloud Run service, a dedicated Cloud Storage bucket
   (`storage`) that Loki uses as its chunk/index backend, builds the custom
   container image (a distroless-based wrapper over `grafana/loki` — see the
   Configuration Guide's Pitfalls section), and grants the Cloud Run runtime
   identity `roles/storage.objectAdmin` on the bucket. There is **no database and no
   init job**, so this is one of the faster first deploys in the catalog — expect
   roughly **5–10 minutes**, dominated by the container build.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~loki" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy. Loki exposes an unauthenticated readiness
   endpoint that returns HTTP 200 once the server is listening — typically within
   seconds of boot, since there is no migration step:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/ready"   # expect 200
   ```

2. **Loki has no web UI of its own.** It is normally used as a datasource behind
   **Grafana**, or queried directly with **`logcli`** or plain HTTP against its
   query API. Issue a first query (an empty result is expected if nothing has
   pushed logs yet — the important thing is that the API responds rather than
   erroring):

   ```bash
   # Direct HTTP:
   curl -s "$SERVICE_URL/loki/api/v1/labels" | jq .

   # Or with logcli:
   export LOKI_ADDR="$SERVICE_URL"
   logcli labels
   ```

3. Push a small test log line to confirm end-to-end ingestion (adjust the
   timestamp to the current Unix epoch in nanoseconds):

   ```bash
   NOW_NS=$(date +%s%N)
   curl -s -X POST "$SERVICE_URL/loki/api/v1/push" \
     -H "Content-Type: application/json" \
     -d '{"streams":[{"stream":{"job":"lab-test"},"values":[["'"$NOW_NS"'","hello from the lab"]]}]}'
   # Then query it back (may take a few seconds to become queryable):
   curl -s "$SERVICE_URL/loki/api/v1/query?query=%7Bjob%3D%22lab-test%22%7D" | jq .
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions:**

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scaling caveat — do not scale beyond 1 instance.** Unlike most modules in this
   catalog, `max_instance_count` is **overridden to `1`** by the module regardless
   of what is set on the deployment — Loki's baked config uses an in-memory ring
   (`replication_factor: 1`) and a singleton compactor that cannot coordinate
   retention/deletion across concurrent instances. If you need more throughput,
   raise `cpu_limit`/`memory_limit` on the single instance rather than expecting
   horizontal scale.

3. **Update the application version tag** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds (re-templating the
   same config) and a new revision rolls out.

4. **Inspect GCS storage usage** — the primary thing to monitor day-2, since Loki's
   entire durable state lives here:

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~storage"
   gcloud storage du -s gs://<storage-bucket>/
   gcloud storage ls gs://<storage-bucket>/index_*/     # TSDB index shards
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — Loki's own process logs (not the logs it ingests, which are
   application data inside Loki, not Cloud Logging entries):

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency, instance count, and CPU/memory utilisation. The module
   can provision an **uptime check** (when `uptime_check_config.enabled = true` — it
   defaults to `false`); if enabled, confirm it is green under Monitoring → Uptime
   checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit.

- **Service unhealthy / won't serve:** inspect the latest revision and its logs for
  startup errors. The startup probe targets `/ready` — a failure here almost always
  means the config-templating step in the entrypoint failed (check that
  `LOKI_GCS_BUCKET` resolved to a real bucket name) rather than a slow first-boot
  migration (there isn't one).
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **GCS permission errors** (`403` / `storage: object doesn't exist` on writes):
  confirm the Cloud Run runtime service account has `roles/storage.objectAdmin` on
  the `storage` bucket:
  ```bash
  gcloud storage buckets get-iam-policy gs://<storage-bucket>
  ```
- **Image build failed:** review Cloud Build history for the failed build's log. If
  you (or a future maintainer) modified the Dockerfile and hit `exec: /bin/sh: no
  such file or directory` or `exec /bin/busybox: no such file or directory`, this is
  the distroless-base-image issue documented in the Configuration Guide's Pitfalls
  section — the official `grafana/loki` image has no shell and no dynamic linker.
- **Query returns empty but push succeeded:** confirm the query's label matcher
  matches what you pushed, and allow a few seconds for the write path to flush.
- **403 / permission errors on the service itself:** verify the runtime service
  account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the full distroless-image story and why `max_instance_count` is
pinned).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can
no longer manage it (for example after manual changes that conflict with the
Terraform state), use **Purge** instead — it removes the deployment from RAD's
records **without** destroying the cloud resources (it makes RAD forget the
project). This removes everything the module created — the Cloud Run service, the
GCS `storage` bucket (and all ingested log data in it), Secret Manager entries (if
any were added), and Artifact Registry images. Resources owned by **Services_GCP**
(the VPC, shared Cloud SQL, registry) are managed separately and are not removed
here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the Cloud Run service, GCS `storage` bucket, and builds the distroless-based custom image (no database, no init job) |
| 2 — Access & verify | Manual | `/ready` returns 200; a test log line pushed and queried back successfully |
| 3 — Operate | Manual | Inspect revisions, understand the single-instance scaling constraint, update version, monitor GCS usage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose service health, GCS IAM, image-build, and query issues |
| 6 — Tear down | Automated | Delete (Trash) removes the service, storage bucket (and its log data), and images |
