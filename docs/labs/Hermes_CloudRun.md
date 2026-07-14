---
title: "Hermes Agent on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Hermes Agent on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Hermes Agent on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Hermes_CloudRun)**

## Overview

**Estimated time:** 45–60 minutes

Hermes Agent is Nous Research's self-hosted, self-improving personal AI agent —
it learns skills from experience, persists memory across sessions, and exposes an
OpenAI-compatible API plus messaging connectors from a single gateway process.
This lab takes you through the full operational lifecycle of the **Hermes on
Cloud Run** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down. Because
Hermes has **no Cloud SQL database**, deploys are noticeably faster than most
modules in this catalogue.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Hermes product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Hermes_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Call the gateway's OpenAI-compatible API with the auto-generated bearer token.
- Perform day-2 operations — update the version, rotate keys, and verify the
  agent's NFS-backed state survives a redeploy.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly, understanding what happens to the agent's
  state.

## Prerequisites

- **Services_GCP deployed** in the target project **with
  `create_network_filesystem = true`** — Hermes stores its entire identity on the
  shared NFS share, so the NFS server VM is **required** and must be `RUNNING`
  before you deploy:
  ```bash
  gcloud compute instances list --project="$PROJECT" \
    --filter="name~nfs" --format="table(name,zone,status)"
  ```
- A Google Cloud project with **billing enabled**.
- An **Anthropic API key** (or an OpenAI key) — the agent cannot run a turn
  without at least one model-provider key.
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

1. In the RAD platform, open **Hermes (Cloud Run)**, set `project_id`, and paste
   your `anthropic_api_key`. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Hermes_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions the Cloud Run service (single always-on instance —
   `min=1`, `max=1`, always-allocated CPU), Secret Manager secrets (your provider
   key plus the auto-generated `API_SERVER_KEY` and dashboard password), mirrors
   the official `nousresearch/hermes-agent` image into Artifact Registry, and
   mounts the shared NFS at `/opt/data`. There is **no Cloud SQL instance, no
   database-init job, and no image build**, so first deploys typically finish in
   **10–15 minutes**.

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~hermes" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"

   gcloud secrets list --project="$PROJECT" --filter="name~hermes"
   ```

---

## Task 2 — Access & verify [Manual]

1. The gateway's OpenAI-compatible API server (port 8642) authenticates every
   request with the auto-generated `API_SERVER_KEY` bearer token. Retrieve it
   from Secret Manager and call the API:

   ```bash
   API_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~hermes AND name~api-server-key" \
     --format="value(name)" --limit=1)
   KEY=$(gcloud secrets versions access latest --secret="$API_SECRET" --project="$PROJECT")

   curl -s -H "Authorization: Bearer $KEY" "$SERVICE_URL/v1/models"
   ```

   A JSON model list confirms the gateway is up, the NFS state directory
   initialised, and the API key wired correctly. Also confirm the response body
   is **non-empty** — a 200 with a zero-length body means the health endpoint
   was answered by the wrong process, not the gateway:

   ```bash
   curl -s -H "Authorization: Bearer $KEY" "$SERVICE_URL/v1/models" | wc -c   # expect a non-zero byte count
   ```

   An unauthenticated request should be rejected:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/v1/models"   # expect 401/403
   ```

2. Note that the **web dashboard (port 9119) is not reachable on Cloud Run** —
   Cloud Run routes a single ingress port (8642). Use the OpenAI-compatible API
   (or the GKE variant's port-forward) for interactive access. If you enabled
   Telegram (`enable_telegram` + bot token), message your bot — the connector
   long-polls outbound, so it works with no webhook or public callback URL.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; the single instance stays warm because CPU is always allocated):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; the mirror re-copies the tag if the
   digest changed and a new revision rolls out. Do **not** raise
   `max_instance_count` — a plan-time validation rejects anything above 1
   (SQLite is single-writer).

3. **Rotate keys.** Supply a new value for `api_server_key` (or
   `anthropic_api_key`) in the RAD platform and click **Update** — a new Secret
   Manager version is created and the service restarts with it. Leaving a
   credential blank on an update preserves the stored version:

   ```bash
   gcloud secrets versions list "$API_SECRET" --project="$PROJECT"
   ```

4. **Verify state survives a redeploy.** The agent's identity (SQLite config,
   sessions, learned skills, memories) lives at `/opt/data` on the shared NFS,
   not in the container. After the version update in step 2, confirm the same
   `API_SERVER_KEY` still works and the agent still remembers its configuration.
   You can also inspect the state files directly from the NFS server VM:

   ```bash
   NFS_VM=$(gcloud compute instances list --project="$PROJECT" \
     --filter="name~nfs" --format="value(name)" --limit=1)
   NFS_ZONE=$(gcloud compute instances list --project="$PROJECT" \
     --filter="name~nfs" --format="value(zone)" --limit=1)
   gcloud compute ssh "$NFS_VM" --zone="$NFS_ZONE" --project="$PROJECT" \
     --command='ls -la /mnt/nfs* 2>/dev/null || ls -la /export 2>/dev/null'
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.
   Look for the s6-overlay init lines and the gateway/API-server startup messages.

2. **Monitoring** — open the Cloud Run dashboard for the service and review
   instance count (expect a flat 1 — this module is intentionally always-on),
   CPU / memory utilisation, and request latency. The uptime check is disabled by
   default (the API server requires auth), so alerting is metric-based — review
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Hermes releases.

- **NFS server VM not `RUNNING` → deploy or startup failure.** If the shared NFS
  VM is stopped or stocked out (`ZONE_RESOURCE_POOL_EXHAUSTED` — a capacity
  issue, not quota), discovery finds no server and the mount fails, or the module
  tries to create an inline NFS and collides with existing resources
  (`409 already exists`). Confirm the VM first, and wait for `RUNNING` before
  re-deploying:
  ```bash
  gcloud compute instances list --project="$PROJECT" \
    --filter="name~nfs" --format="table(name,zone,status)"
  ```
- **Missing model-provider key → agent can't run turns.** The service can be
  healthy (TCP probe passes) while every agent turn fails. Check the logs for
  authentication errors from the provider, and confirm the Anthropic secret has
  a version:
  ```bash
  gcloud secrets versions list "$(gcloud secrets list --project="$PROJECT" \
    --filter='name~hermes AND name~anthropic' --format='value(name)' --limit=1)" \
    --project="$PROJECT"
  ```
  A deploy-time `"Secret was not found"` error means the secret container exists
  but has no version — supply `anthropic_api_key` and update.
- **Revision unhealthy / rollout stuck:** inspect the latest revision and its
  logs. The default startup probe is TCP and the liveness probe is **disabled by
  default** (Cloud Run does not support TCP liveness probes); if someone switched
  the startup probe to an HTTP path on the authed API server it 401s forever and
  the rollout wedges — revert to TCP. Likewise, only enable the liveness probe
  with an HTTP path after verifying the endpoint is unauthenticated — probes run
  unauthenticated, so a 401/403 endpoint kills healthy instances.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Connector auth failures (Telegram):** a wrong or revoked bot token shows as
  repeated 401s from `api.telegram.org` in the logs. Update `telegram_bot_token`
  in the platform and redeploy; the connector long-polls, so no webhook
  registration is involved.
- **403 / permission errors:** verify the runtime service account's IAM roles
  (Secret Manager accessor in particular).

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rules that `max_instance_count`
stays 1 and `enable_nfs` stays true).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform
can no longer manage it (for example after manual changes that conflict with the
Terraform state), use **Purge** instead — it removes the deployment from RAD's
records **without** destroying the cloud resources (it makes RAD forget the
project). This removes everything the module created — the Cloud Run service,
Secret Manager secrets, and mirrored Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, the NFS server, registry) are managed separately and
are not removed here — in particular, **the agent's state directory on the shared
NFS export is retained**, so a later redeploy onto the same tenant reattaches to
the existing agent identity.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the always-on Cloud Run service, Secret Manager secrets, image mirror, and NFS mount — no Cloud SQL, no build |
| 2 — Access & verify | Manual | Authenticated `/v1/models` call succeeds with the Secret Manager bearer token; unauthenticated call is rejected |
| 3 — Operate | Manual | Update version, rotate keys, verify NFS-backed state survives a redeploy |
| 4 — Observe | Manual | Query Cloud Logging; review the flat-1 instance profile and metrics |
| 5 — Troubleshoot | Manual | Diagnose NFS availability, provider-key, probe, connector, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes module resources; agent state on the shared NFS is retained |
