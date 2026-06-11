---
title: "Ollama on Cloud Run \u2014 Lab Guide"
---

# Ollama on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ollama_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Ollama is an open-source LLM inference server that serves large language models — Llama,
Mistral, Gemma, Phi, and others — through a REST API. This lab takes you through the full
operational lifecycle of the **Ollama on Cloud Run** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it
down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on
Ollama product features or model-specific workflows. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ollama_CloudRun) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service.
- Perform day-2 operations — inspect, scale, update, and manage model storage and jobs.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Artifact Registry, and
  shared service accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Ollama (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Ollama_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions the Cloud Run v2 (gen2) service, a GCS bucket for model weight
   storage (mounted via GCS Fuse at `/mnt/gcs`), builds or mirrors the container image, and
   optionally runs a one-shot model-pull job if `default_model` is set. There is no database.
   First deploys typically take **10–20 minutes** (longer if a large model is being pulled).

3. When it completes, discover the service with name-agnostic filters:

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~ollama" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

Ollama is deployed with `ingress_settings = "internal"` by default — the API is reachable
from within the same VPC but not from the public internet. To reach it from your local
machine, use the Cloud Run proxy:

```bash
gcloud run services proxy "$SERVICE" \
  --region="$REGION" --project="$PROJECT" --port=11434
```

Leave the proxy running in a separate terminal, then confirm the service is responding:

```bash
curl http://localhost:11434   # expect: Ollama is running
```

Ollama has no admin credentials and no Secret Manager secret to retrieve — the API is
unauthenticated within the VPC by design.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable revision;
   traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the service spec, so scaling is a configuration change, not a manual
   `gcloud` edit (a manual edit would be reverted on the next apply).

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image mirrors and a new revision rolls out.

4. **Inspect the model storage bucket and any jobs:**

   ```bash
   MODELS_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~ollama" --format="value(name)" --limit=1)
   gcloud storage ls "gs://${MODELS_BUCKET}/ollama/models/"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # model-pull job if configured
   ```

5. Ollama has no SQL database — there is no Cloud SQL instance and no `db-init` job to
   manage.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request count,
   request latency (P50/P95/P99), instance count (scaling behaviour), and CPU / memory
   utilisation. Memory utilisation stays elevated while model weights are loaded in memory.
   The module also provisions an **uptime check**; confirm it is green under
   Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Ollama releases.

- **Revision unhealthy / service won't serve:** the startup probe targets `GET /` with a
  generous failure threshold to accommodate GCS Fuse model loading (30–120 s). Inspect the
  latest revision and its logs for startup errors.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Model-pull job failed:** list executions and read the failed one's logs:
  ```bash
  MODEL_PULL_JOB=$(gcloud run jobs list --project="$PROJECT" --region="$REGION" \
    --filter="metadata.name~model-pull" --format="value(metadata.name)" --limit=1)
  gcloud run jobs executions list --job="$MODEL_PULL_JOB" \
    --project="$PROJECT" --region="$REGION"
  ```
- **GCS Fuse errors / model not found:** confirm the models bucket exists, the service
  account has Storage Object Viewer on it, and the `execution_environment` is `gen2`
  (GCS Fuse is not supported on gen1).
- **OOM / container restart loop:** Ollama requires at least 2× the quantised model weight
  size in memory. Increase `memory_limit` in the RAD platform and apply it via **Update**.
- **Image build or mirror failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service, GCS
models bucket (and all downloaded model weights), Artifact Registry images, and Cloud
Monitoring uptime checks. Resources owned by **Services_GCP** (the VPC, shared registry)
are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run (gen2), GCS model storage, and optional model-pull job |
| 2 — Access & verify | Manual | Proxy to VPC-internal service; health check passes at `/` |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage model storage and jobs |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, model-pull job, GCS Fuse, OOM, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources including model weights |
