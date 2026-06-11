---
title: "N8N_AI on Cloud Run \u2014 Lab Guide"
---

# N8N_AI on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/N8N_AI_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

n8n AI is an open-source workflow automation platform extended with integrated AI capabilities.
Alongside the core n8n service it deploys two companion Cloud Run services — **Qdrant** (a
vector database for embeddings and semantic search) and **Ollama** (a local LLM inference
server) — enabling AI agent workflows, RAG pipelines, and intelligent chatbots on your own
infrastructure with no external AI API dependencies. This lab takes you through the full
operational lifecycle of the **N8N_AI on Cloud Run** module on Google Cloud: deploy it, access
and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on
n8n product features. For the complete list of provisioned services and every configuration
input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/N8N_AI_CloudRun) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running n8n, Qdrant, and Ollama services.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Observe the services with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud SQL,
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

1. Click **Deploy** in the RAD platform top navigation, open **N8N AI (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/N8N_AI_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform provisions three Cloud Run services (n8n, Qdrant internal, Ollama internal),
   a Cloud SQL (PostgreSQL) database with its Secret Manager secrets, Filestore NFS, a GCS
   bucket for AI data persistence, and runs a one-shot database-initialisation job. First
   deploys take roughly **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters (so the commands keep
   working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~n8nai" --format="value(metadata.name)" \
     --sort-by="metadata.creationTimestamp" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"

   # List all three services (n8n, Qdrant, Ollama)
   gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~n8nai"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm n8n is healthy and has connected to its database:

   ```bash
   curl -s "${SERVICE_URL}/"
   ```

   A redirect or the n8n login page indicates a healthy service. Cloud Run will not route
   traffic until the startup probe (targeting `GET /` on port 5678) succeeds, so a response
   here confirms a healthy revision.

2. Confirm the Qdrant and Ollama companion services are ready:

   ```bash
   QDRANT_SVC=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~qdrant" --format="value(metadata.name)" --limit=1)
   OLLAMA_SVC=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~ollama" --format="value(metadata.name)" --limit=1)
   gcloud run services describe "$QDRANT_SVC" \
     --project="$PROJECT" --region="$REGION" --format="value(status.conditions)"
   gcloud run services describe "$OLLAMA_SVC" \
     --project="$PROJECT" --region="$REGION" --format="value(status.conditions)"
   ```

3. Open `$SERVICE_URL` in a browser. On first launch, n8n prompts you to create an owner
   account. The n8n encryption key is auto-generated and stored in Secret Manager — back it
   up before destroying the module, as all saved credentials are encrypted with it.

   ```bash
   ENC_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~n8nai AND name~encryption" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ENC_SECRET" --project="$PROJECT"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the services and their revisions** (each deploy creates an immutable revision;
   traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page — the
   module owns the service spec, so scaling is a configuration change, not a manual `gcloud`
   edit (a manual edit would be reverted on the next apply).

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds and a new revision rolls out.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~n8nai"
   gcloud run jobs list --project="$PROJECT" --region="$REGION"   # db-init + scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=n8n_user --database=n8n_db --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer (all three services):

   ```bash
   # n8n service logs
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50

   # Qdrant service logs
   gcloud run services logs read "$QDRANT_SVC" --project="$PROJECT" --region="$REGION" --limit=30

   # Ollama service logs
   gcloud run services logs read "$OLLAMA_SVC" --project="$PROJECT" --region="$REGION" --limit=30
   ```

   Logs Explorer filter for all n8nai services:
   `resource.type="cloud_run_revision" AND resource.labels.service_name=~"n8nai"`.

2. **Monitoring** — open the Cloud Run dashboard and review request count, request latency
   (P50/P95/P99), instance count (scaling behaviour), and CPU/memory utilisation for each
   service. The module provisions an **uptime check** for the n8n service; confirm it is
   green under Monitoring → Uptime checks, and review Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with n8n releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and its logs for
  startup errors, and confirm env vars and secrets resolved. The startup probe waits up to
  120 seconds for n8n to connect to PostgreSQL before declaring failure.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the DB
  password secret exists, and the `db-init` initialisation job completed successfully.
- **Initialisation job failed:** list executions and read the failed one's logs:
  ```bash
  gcloud run jobs list --project="$PROJECT" --region="$REGION" --filter="name~n8nai"
  gcloud run jobs executions list --job="${SERVICE}-db-init" \
    --project="$PROJECT" --region="$REGION"
  ```
- **Qdrant or Ollama unreachable from n8n:** confirm the companion services have a healthy
  revision and that `QDRANT_URL` / `OLLAMA_HOST` are injected correctly into the n8n service
  env vars.
  ```bash
  gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific gotchas,
including the critical `N8N_ENCRYPTION_KEY` and `enable_redis` notes.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — all three Cloud Run services
(n8n, Qdrant, Ollama), the Cloud SQL database, Secret Manager secrets, GCS buckets, Filestore
NFS, and Artifact Registry images. Resources owned by **Services_GCP** (the VPC, shared Cloud
SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions n8n, Qdrant, and Ollama Cloud Run services, Cloud SQL, secrets, and runs DB init |
| 2 — Access & verify | Manual | Health check passes; companion services ready; n8n account created; encryption key backed up |
| 3 — Operate | Manual | Inspect revisions, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging for all three services; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, database, init-job, AI companion, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
