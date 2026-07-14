---
title: "code-server on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy code-server on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# code-server on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/CodeServer_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

code-server is Coder's open-source build of Visual Studio Code that runs on a remote server and is accessed entirely through the browser — a full IDE with the extension marketplace, integrated terminal, and a persistent workspace. This lab takes you through the full operational lifecycle of the **code-server on Cloud Run** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud platform**, not on code-server product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/CodeServer_CloudRun) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access the editor through its default `internal` ingress, retrieve the generated password, and verify the service.
- Perform day-2 operations — inspect revisions, manage the GCS-backed workspace, and update the version.
- Understand why the module is pinned to a single instance and how scaling changes are made safely.
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

1. Click **Deploy** in the RAD platform top navigation, open **code-server (Cloud Run)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/CodeServer_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform builds a thin wrapper image over `codercom/code-server` (mirrored
   into Artifact Registry via Cloud Build), provisions the Cloud Run service
   (port 8080, 1 vCPU / 1 GiB, `gen2` execution environment), mounts a dedicated GCS
   **workspace bucket** via GCS FUSE at `/home/coder`, and generates a random editor
   `PASSWORD` in Secret Manager. There is **no Cloud SQL instance and no Redis** —
   code-server has no database. First deploys typically take **10–20 minutes** (the
   container build dominates — there is no database to wait for).

3. When it completes, discover the resources with name-agnostic filters (so the
   commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~codeserver" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. **Mind the ingress mode first.** The module defaults to
   `ingress_settings = "internal"` — the editor is only reachable from inside the
   VPC, and a `curl` from your laptop returns **404** (the ingress policy working,
   not a failure). Check the current mode:

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" \
     --format="value(metadata.annotations['run.googleapis.com/ingress'])"
   ```

   For browser access from outside the VPC, set `ingress_settings = "all"` via
   **Update** on the deployment details page — and **keep `enable_password = true`**
   whenever you do (a public, unauthenticated IDE includes a public terminal).

2. Once reachable, confirm the service is healthy. code-server's unauthenticated
   health path is `/healthz` (note: **not** `/health`, which returns 401 when a
   password is set):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/healthz"
   ```

3. Retrieve the generated editor password from Secret Manager, then open
   `$SERVICE_URL` in a browser and log in:

   ```bash
   PW_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~codeserver AND name~password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$PW_SECRET" --project="$PROJECT"
   ```

4. Verify persistence: create a file or install an extension in the editor, then
   confirm it lands in the workspace bucket — everything under `/home/coder`
   (settings, keybindings, extensions, open projects) lives on GCS FUSE:

   ```bash
   WORKSPACE_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~codeserver" --format="value(name)" --limit=1)
   gcloud storage ls "gs://$WORKSPACE_BUCKET/"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not scale out.** The module deliberately pins
   `min_instance_count = max_instance_count = 1`: editor sessions are held in memory
   and the workspace volume has a single writer — a second instance would split
   sessions and risk concurrent writes to `/home/coder`. Resource changes
   (`cpu_limit`, `memory_limit` for heavy language servers) go through **Update** on
   the deployment details page, not manual `gcloud` edits (a manual edit would be
   reverted on the next apply).

3. **Update the application version** by changing the version input via **Update** on
   the deployment details page; a new image builds and a new revision rolls out.
   There are no migrations — code-server has no schema. `latest` pins to `4.99.1` at
   build time; pin a specific release in production.

4. **Manage secrets and storage:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~codeserver"
   gcloud storage buckets list --project="$PROJECT" --filter="name~codeserver"
   # One-off workspace backup:
   gcloud storage cp -r "gs://$WORKSPACE_BUCKET" "gs://<your-backup-bucket>/codeserver-$(date +%F)"
   ```

5. **There is no database session to open.** `database_type = "NONE"` — no Cloud SQL
   instance, no db-init job, no database password. The only durable state is the
   workspace bucket.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=50
   ```

   Logs Explorer filter:
   `resource.type="cloud_run_revision" AND resource.labels.service_name="<service>"`.

2. **Monitoring** — open the Cloud Run dashboard for the service and review request
   count, request latency (P50/P95/P99), instance count (should sit flat at 1), and
   CPU / memory utilisation — language servers and extensions are the usual memory
   drivers. The module's **uptime check** requires a publicly reachable endpoint;
   with the default `internal` ingress, Monitoring → Uptime checks may legitimately
   be empty.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with code-server releases.

- **URL returns 404 from your machine:** almost always the default `internal`
  ingress, not an outage. Check the ingress annotation (Task 2) before reading logs.
- **Revision never becomes Ready:** check the probe paths. Probes must target the
  unauthenticated `/healthz`; pointing them at `/health` while a password is set
  returns 401 and the revision fails readiness even though the app booted fine:
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Login rejected:** re-read the `PASSWORD` secret (Task 2, step 3) — the value is
  injected as the container's `PASSWORD` env var; a new secret version only takes
  effect on the next revision.
- **Workspace state missing / extensions gone:** confirm the workspace bucket exists
  and the execution environment is `gen2` (GCS FUSE cannot mount under `gen1` — the
  plan-time validation catches this, but verify if the module was overridden).
- **Editor slow / OOM kills:** raise `memory_limit` (heavy language servers can OOM
  below 1 GiB) via the RAD **Update** flow and watch the memory chart in Monitoring.
- **Image build failed:** review Cloud Build history for the failed build's log; the
  image is a thin wrapper over `codercom/code-server` mirrored into Artifact
  Registry.
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service, the Secret Manager `PASSWORD` secret, the GCS workspace bucket (and with it **all files, settings, and extensions under `/home/coder`**), and Artifact Registry images. Copy the workspace bucket first if you want to keep your work. Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the image and provisions Cloud Run + the GCS workspace bucket + the `PASSWORD` secret (no DB, no Redis) |
| 2 — Access & verify | Manual | Understand `internal` ingress; `/healthz` passes; retrieve the password and log in; verify workspace persistence |
| 3 — Operate | Manual | Inspect revisions, keep single-instance scaling, update version, back up the workspace bucket |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics; understand when the uptime check exists |
| 5 — Troubleshoot | Manual | Diagnose ingress, probe-path, password, workspace, memory, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources including the workspace bucket |
