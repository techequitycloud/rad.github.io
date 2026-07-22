---
title: "Passbolt on Cloud Run \u2014 Lab Guide"
description: "Hands-on lab: deploy Passbolt on Cloud Run in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Passbolt on Cloud Run — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Passbolt_CloudRun)**

## Overview

**Estimated time:** 30–60 minutes

Passbolt (Community Edition) is a free, open-source, team-oriented password
manager with GPG-based encryption and per-user/group credential sharing
(AGPL-3.0). This lab takes you through the full operational lifecycle of the
**Passbolt on Cloud Run** module on Google Cloud: deploy it, access and verify
it (including the genuinely different admin-bootstrap flow this app uses), run
it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **Cloud Run module and the Google Cloud
platform**, not on Passbolt product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Passbolt_CloudRun)
— this lab deliberately does not duplicate that detail so it stays accurate
over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it
  provisions.
- Retrieve the one-time admin setup URL from Cloud Logging and complete
  registration via a Passbolt-compatible browser extension.
- Perform day-2 operations — inspect, scale, update, and manage the
  GPG/JWT keypair volumes.
- Observe the service with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, Cloud
  SQL, Artifact Registry, and shared service accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and
  `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.
- A **Passbolt-compatible browser extension** installed (Chrome, Firefox, or
  Edge) — required to complete the admin account setup in Task 2. Install it
  from [passbolt.com/download](https://www.passbolt.com/download) before
  starting.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Passbolt (Cloud Run)**, set `project_id`, and
   review the inputs. Set `admin_email`, `admin_first_name`, and
   `admin_last_name` to your real details — these seed the one and only admin
   account. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Passbolt_CloudRun)
   documents every input by group, with defaults. If deploying alongside a
   `Passbolt_GKE` instance in the same project, set
   `tenant_deployment_id = "cr"` (and `"gke"` on the GKE deployment) so the
   two variants don't collide on shared resource names. Review the estimated
   cost (if credits are enabled) and click **Deploy**, which opens the
   deployment status page with real-time logs.

2. The platform provisions the Cloud Run service, a Cloud SQL (MySQL 8.0)
   database with its Secret Manager password secret, two dedicated GCS buckets
   (`storage` for the GPG server keypair, `jwt` for the JWT keypair), and runs
   the 2-stage initialization job chain in order (`db-init` →
   `admin-bootstrap`). The `admin-bootstrap` job is the slower of the two — it
   replicates the vendor's own boot sequence (GPG key generation, schema
   install) before registering the admin account. First deploys typically take
   roughly **10–20 minutes**.

3. When it completes, discover the resources with name-agnostic filters (so
   the commands keep working regardless of the deployment suffix):

   ```bash
   SERVICE=$(gcloud run services list --project="$PROJECT" --region="$REGION" \
     --filter="metadata.name~passbolt" --format="value(metadata.name)" --limit=1)
   SERVICE_URL=$(gcloud run services describe "$SERVICE" \
     --project="$PROJECT" --region="$REGION" --format="value(status.url)")
   echo "Service: $SERVICE"
   echo "URL:     $SERVICE_URL"
   ```

---

## Task 2 — Access & verify [Manual]

Passbolt's admin-account setup is genuinely different from almost every other
application in this catalog: there is no server-side admin password, and no
first-visit web setup wizard. The `admin-bootstrap` init job prints a **one-time
setup URL** to Cloud Logging, which you open in a Passbolt-compatible browser
extension — the extension then generates your GPG keypair and master password
locally, and registers them with the server via that URL.

1. Confirm the service is healthy. Passbolt exposes a public, unauthenticated
   status endpoint:

   ```bash
   curl -s "$SERVICE_URL/healthcheck/status.json"
   # expect: {"header":{"status":"success",...},"body":"OK"}
   ```

2. **Retrieve the one-time setup URL from Cloud Logging.** The `admin-bootstrap`
   job printed it to stdout when it ran `cake passbolt register_user` (run
   without the `-q`/quiet flag specifically so this URL is visible):

   ```bash
   gcloud logging read \
     'resource.type="cloud_run_job" AND resource.labels.job_name~admin-bootstrap' \
     --project="$PROJECT" --limit=50 --format='value(textPayload)' \
     | grep '/setup/start/'
   ```

   You should see a line containing a URL of the form:
   ```
   https://<your-service-url>/setup/start/<user-id>/<token>
   ```

   If nothing matches, the job may still be running (check
   `gcloud run jobs executions list --job="${SERVICE}-admin-bootstrap"
   --project="$PROJECT" --region="$REGION"`) or may have already completed on
   an earlier apply — re-run the last several log entries without the `grep`
   filter to inspect the full output.

3. **Install the Passbolt browser extension** (Chrome, Firefox, or Edge) from
   [passbolt.com/download](https://www.passbolt.com/download) if you haven't
   already.

4. **Open the setup URL** from step 2 in the browser where the extension is
   installed. The extension walks you through:
   - Generating a new GPG keypair locally (this is *your* personal key, distinct
     from the server's own GPG keypair generated in Task 1).
   - Choosing a master password (this never leaves your browser in plaintext).
   - Registering your public key with the Passbolt server.

5. Once setup completes, you are logged in as the admin user you configured in
   `admin_email`/`admin_first_name`/`admin_last_name`. Confirm you can see the
   empty password list — there is nothing to see yet, but a working session
   confirms the full chain (server GPG key, JWT key, schema, admin account,
   your personal GPG key) is functioning.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the service and its revisions** (each deploy creates an immutable
   revision; traffic shifts to the newest healthy one):

   ```bash
   gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
   gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the service spec, so scaling
   is a configuration change, not a manual `gcloud` edit (a manual edit would
   be reverted on the next apply). The default `min_instance_count = 0` means
   Passbolt cold-starts after inactivity; set `min_instance_count = 1` for a
   team relying on it during working hours.

3. **Update the application version tag** by changing `application_version` in
   the RAD platform and applying it via **Update**. The `db-init` and
   `admin-bootstrap` jobs re-run — both are idempotent, so an existing schema
   and admin account are left untouched.

4. **Inspect the GPG/JWT keypair volumes** (do not delete or empty these —
   see Task 5 for the consequence):

   ```bash
   gsutil ls -p "$PROJECT" | grep passbolt
   gsutil ls gs://<storage-bucket-name>/   # expect serverkey.asc, serverkey_private.asc
   gsutil ls gs://<jwt-bucket-name>/       # expect jwt.key, jwt.pem (or similar)
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=passbolt --project="$PROJECT"
   ```

6. **Manage users, groups, and folders** — Passbolt-specific day-2 operations
   performed in the web UI (or via its REST API/CLI once you have a session)
   rather than via Terraform; these are Passbolt application data, not
   infrastructure. Invite additional team members from the admin UI — each new
   user goes through the same browser-extension setup flow as Task 2.

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
   utilisation. The module can provision an **uptime check** (when
   `uptime_check_config.enabled = true` — it defaults to `false`); if enabled,
   confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Passbolt releases.

- **Revision unhealthy / service won't serve:** inspect the latest revision
  and its logs for startup errors, and confirm env vars and secrets resolved.
  The startup probe targets `GET /healthcheck/status.json` with a generous
  failure threshold to accommodate first-boot latency.
  ```bash
  gcloud run revisions list --service="$SERVICE" --project="$PROJECT" --region="$REGION"
  gcloud run services logs read "$SERVICE" --project="$PROJECT" --region="$REGION" --limit=100
  ```

- **`admin-bootstrap` job fails with an Internal Error / 500 on
  `register_user`:** this is the exact failure mode the job is specifically
  built to avoid by replicating the vendor's own GPG-key-generation/schema-install
  sequence first — if it still fails, check its execution logs for which step
  failed:
  ```bash
  gcloud run jobs executions list --job="${SERVICE}-admin-bootstrap" \
    --project="$PROJECT" --region="$REGION"
  gcloud run jobs executions logs read <execution-name> --project="$PROJECT" --region="$REGION"
  ```
  Confirm `db-init` completed successfully first (`admin-bootstrap` depends on
  it) and that the `storage`/`jwt` GCS volumes are actually mounted
  (`mount_gcs_volumes = ["storage", "jwt"]` on the job).

- **Setup URL never appears in logs:** confirm `admin-bootstrap` actually
  completed (not just started) — `gcloud run jobs executions list` shows the
  execution status. If the job failed partway, its idempotent GPG/JWT/schema
  steps are safe to re-run; re-execute the job manually:
  ```bash
  gcloud run jobs execute "${SERVICE}-admin-bootstrap" --project="$PROJECT" --region="$REGION" --wait
  ```

- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`. Passbolt reads discrete `DATASOURCES_DEFAULT_*` env vars (not a
  single DSN) — check the revision's injected values match the instance's
  actual host/socket.

- **Lost the GPG/JWT keypair volumes:** if the `storage` or `jwt` GCS bucket
  is deleted or emptied, every credential Passbolt has encrypted server-side
  and every issued JWT session is unrecoverable — the server generates a
  brand-new keypair on next boot, which cannot decrypt data encrypted under
  the old one. There is no Terraform-side recovery for this; it is the same
  severity as losing a password manager's own master key. Treat these buckets
  with at least the same care as the Cloud SQL instance.

- **403 / permission errors:** verify the runtime service account's IAM
  roles.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created —
the Cloud Run service, Cloud SQL database, the `storage`/`jwt` GCS buckets
(and the GPG/JWT keypairs within them), and Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, shared Cloud SQL, registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions Cloud Run, Cloud SQL (MySQL 8.0), the GPG/JWT GCS buckets, and runs the `db-init` → `admin-bootstrap` chain |
| 2 — Access & verify | Manual | Health check passes on `/healthcheck/status.json`; retrieve the one-time setup URL from Cloud Logging and complete registration via a browser extension |
| 3 — Operate | Manual | Inspect revisions, scale, update version, inspect the keypair volumes, DB access, manage users/groups |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose revision, admin-bootstrap, database, and keypair-loss issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
