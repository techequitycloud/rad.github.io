---
title: "Budibase on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Budibase on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Budibase on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Budibase_CloudRun)**

## Overview

**Estimated time:** 45–90 minutes

Budibase is an open-source low-code platform for building internal tools,
business apps, and workflows on top of your data. The official image is an
**all-in-one** container that bundles CouchDB, MinIO, and Redis alongside the
Budibase apps/worker/proxy, so this module needs no external managed database.
This lab takes you through the full operational lifecycle of the **Budibase on
Cloud Run** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Budibase product features. For the complete list of
provisioned services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Budibase_CloudRun) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and create the initial administrator account.
- Perform day-2 operations — inspect revisions, understand why scaling is fixed
  at a single instance, update the version, and manage secrets.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues, including
  known instability specific to this module's Cloud Run variant.
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

1. In the RAD platform, open **Budibase (Cloud Run)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Budibase_CloudRun)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform builds a thin pass-through wrapper image (`FROM budibase/budibase`)
   and mirrors it into Artifact Registry, provisions the Cloud Run service (single
   instance, `4000m` CPU / `8Gi` memory by default), a Cloud Storage data bucket,
   and seven internal-credential secrets in Secret Manager (`INTERNAL_API_KEY`,
   `JWT_SECRET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `API_ENCRYPTION_KEY`,
   `REDIS_PASSWORD`, `COUCH_DB_PASSWORD`). There is **no Cloud SQL instance** and
   no database-initialisation job — Budibase self-provisions its bundled CouchDB
   and MinIO on first boot. First deploys take roughly **10–20 minutes**, dominated
   by the container image build.

3. When it completes, discover the resource with a name-agnostic filter (so the
   command keeps working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~budibase" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

1. The startup probe is **TCP** on port 80 (nginx binds the port within seconds,
   but returns 502 until the bundled CouchDB/MinIO/app upstreams finish booting),
   allowing up to roughly 10 minutes on first boot. The liveness and readiness
   probes are HTTP on the unauthenticated root `/`, with a 240-second initial
   delay to clear the post-startup window. Give the first revision the full
   window before concluding it is unhealthy:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/"   # expect 200 once fully booted
   ```

2. Open `$SERVICE_URL` in a browser. Budibase self-hosted ships with **no default
   admin account** — the setup screen prompts you to create the initial
   administrator (email + password). Do this immediately after deploy; until an
   admin is claimed, anyone who reaches the URL can claim the instance.

3. Remember that on Cloud Run, **all Budibase state (CouchDB documents + MinIO
   objects) lives on the container's ephemeral `/data` directory** — there is no
   durable local disk. A restart or new revision loses everything you create in
   this lab. Treat this deployment as demo/evaluation only; use the
   [GKE variant](Budibase_GKE.md) for anything you need to keep.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Do not change scaling.** `min_instance_count = max_instance_count = 1` is a
   hard requirement, not a starting point — the all-in-one container holds all
   state locally, so a second instance would not share the data store
   (split-brain) and scale-to-zero would drop it entirely. Leave these two
   inputs untouched.

3. **Update the application version** by changing `application_version` in the
   RAD platform and applying it via **Update**; this rebuilds the thin wrapper
   image (pinned through the `BUDIBASE_VERSION` build ARG) and rolls out a new
   revision. Never touch the seven auto-generated secrets when doing so — see
   step 4.

4. **Manage secrets** — list them, but never rotate any of them after first boot;
   the data on `/data` is keyed with these exact values and becomes unreadable if
   any of them changes:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~budibase"
   ```

5. **Cloud Storage bucket** — a data bucket is provisioned for foundation-level
   storage integration, but Budibase's own asset/attachment store is the bundled
   MinIO on `/data`, not this bucket:

   ```bash
   gcloud storage ls gs://$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~budibase" --format="value(name)" --limit=1)
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
   instance count (it should hold steady at exactly one), request latency,
   and CPU / memory utilisation. `cpu_always_allocated = true` keeps a full
   vCPU billed continuously so the bundled CouchDB/MinIO/Redis background
   processes keep running between requests — this is expected, not a leak.
   If an **uptime check** is enabled, confirm it is green under
   Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Budibase releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision and
  its logs. Remember the startup probe is TCP (port-listening only) — an HTTP
  502 from `/` for several minutes after the revision goes Ready is expected
  while the bundled CouchDB/MinIO/app upstreams finish booting.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```
- **Instance restarting roughly every 60 seconds:** the Configuration Guide's
  *Configuration Pitfalls* table documents this exact symptom as an out-of-memory
  loop when `container_resources` memory is below the **8Gi** default — the
  writable `/data` directory (CouchDB/MinIO/Redis state) is in-memory on Cloud
  Run gen2 and counts against the memory limit, so 4Gi OOM-loops. Confirm the
  deployed memory limit is at least 8Gi first.
- **Known open issue — instability even at the documented 8Gi/4vCPU sizing:**
  this module's Cloud Run variant has, in practice, been observed to keep
  cycling a new instance roughly every 60 seconds with **zero container
  stdout/stderr** even at the default (and documented-sufficient) 8Gi memory /
  4 vCPU, well past any reasonable probe-patience window. This is currently an
  **unresolved** issue with the Cloud Run path, distinct from the documented
  low-memory OOM loop above. Consistent with the module's own guidance that
  Cloud Run is "ephemeral/demo-only" for Budibase, do not rely on this variant
  for anything beyond a quick evaluation — if you hit persistent, silent
  instance cycling after confirming the 8Gi/4vCPU sizing, treat it as this
  known issue rather than a misconfiguration, and prefer the
  [GKE variant](Budibase_GKE.md) instead.
- **No admin / unclaimed instance:** if you did not create the administrator
  account immediately after first access, anyone reaching the URL can still
  claim it — check whether an unexpected admin account already exists.
- **Image build failed:** review Cloud Build history for the failed build's log
  (the build produces the thin `FROM budibase/budibase:<version>` wrapper).
- **403 / permission errors:** verify the runtime service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule never to rotate any of
the seven auto-generated internal credentials after first boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Cloud Run service,
Secret Manager secrets, GCS bucket, and Artifact Registry images (and with them
the ephemeral CouchDB/MinIO data, which was never durable in the first place).
Resources owned by **Services_GCP** (the VPC, shared registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds a thin wrapper image and provisions Cloud Run (single instance, 8Gi/4vCPU), a GCS bucket, and seven internal-credential secrets — no Cloud SQL |
| 2 — Access & verify | Manual | TCP startup probe passes; HTTP `/` returns 200; create the initial admin account in the UI |
| 3 — Operate | Manual | Inspect revisions, keep scaling fixed at 1/1, update version, manage secrets (never rotate) |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision/probe issues, the documented low-memory OOM loop, and the known unresolved instance-cycling issue on this variant |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources (ephemeral app data is lost regardless) |
