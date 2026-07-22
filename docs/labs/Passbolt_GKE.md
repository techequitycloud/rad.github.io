---
title: "Passbolt on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Passbolt on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Passbolt on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Passbolt_GKE)**

## Overview

**Estimated time:** 30–60 minutes

Passbolt (Community Edition) is a free, open-source, team-oriented password
manager with GPG-based encryption and per-user/group credential sharing
(AGPL-3.0). This lab takes you through the full operational lifecycle of the
**Passbolt on GKE Autopilot** module on Google Cloud: deploy it, access and
verify it (including the genuinely different admin-bootstrap flow this app
uses), run it day-to-day, observe it, diagnose common problems, and tear it
down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Passbolt product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Passbolt_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it
  provisions.
- Connect to the GKE cluster, retrieve the one-time admin setup URL from pod
  logs, and complete registration via a Passbolt-compatible browser extension.
- Perform day-2 operations — inspect, scale, update, and manage the GPG/JWT
  keypair volumes.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Cloud SQL, Artifact Registry, and shared service accounts
  this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** installed; `gcloud auth login` and
  `gcloud auth application-default login` completed.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.
- A **Passbolt-compatible browser extension** installed (Chrome, Firefox, or
  Edge) — required to complete the admin account setup in Task 2. Install it
  from [passbolt.com/download](https://www.passbolt.com/download) before
  starting.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Click **Deploy** in the RAD platform top navigation, open **Passbolt
   (GKE)** from the **Platform Modules** list to start configuration, set
   `project_id`, and review the inputs. Set `admin_email`, `admin_first_name`,
   and `admin_last_name` to your real details — these seed the one and only
   admin account. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Passbolt_GKE)
   documents every input by group, with defaults. If deploying alongside a
   `Passbolt_CloudRun` instance in the same project, set
   `tenant_deployment_id = "gke"` (and `"cr"` on the Cloud Run deployment) so
   the two variants don't collide on shared resource names. Review the
   estimated cost (if credits are enabled) and click **Deploy**, which opens
   the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster,
   provisions a Cloud SQL (MySQL 8.0) database with its Secret Manager
   password secret, two dedicated GCS-Fuse-mounted buckets (`storage` for the
   GPG server keypair, `jwt` for the JWT keypair), and runs the 2-stage
   initialization job chain (`db-init` → `admin-bootstrap`). First deploys
   typically take roughly **15–25 minutes**. Unlike Cloud Run's
   `execute_on_apply` semantics, on GKE the Jobs' pods are scheduled
   immediately regardless of that setting; correctness of the ordering comes
   from `admin-bootstrap`'s `depends_on_jobs = ["db-init"]`, not from
   Terraform waiting.

3. Connect to the cluster and discover the namespace with name-agnostic
   filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep passbolt | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

Passbolt's admin-account setup is genuinely different from almost every other
application in this catalog: there is no server-side admin password, and no
first-visit web setup wizard. The `admin-bootstrap` init job prints a **one-time
setup URL** to its pod logs, which you open in a Passbolt-compatible browser
extension — the extension then generates your GPG keypair and master password
locally, and registers them with the server via that URL.

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is healthy. Passbolt exposes a public, unauthenticated
   status endpoint:

   ```bash
   curl -s "http://${EXTERNAL_IP}/healthcheck/status.json"
   # expect: {"header":{"status":"success",...},"body":"OK"}
   ```

3. **Retrieve the one-time setup URL from the `admin-bootstrap` job's pod
   logs.** The job printed it to stdout when it ran `cake passbolt
   register_user` (run without the `-q`/quiet flag specifically so this URL
   is visible):

   ```bash
   kubectl get jobs -n "$NS"
   kubectl logs -n "$NS" job/<admin-bootstrap-job-name> | grep '/setup/start/'
   ```

   You should see a line containing a URL of the form:
   ```
   https://<your-service-host>/setup/start/<user-id>/<token>
   ```

   If nothing matches, the job may still be running
   (`kubectl get jobs -n "$NS"` shows completion status), or the pod may have
   already been garbage-collected — check
   `kubectl get pods -n "$NS" -a | grep admin-bootstrap` and, if it's gone,
   re-run the job (Task 5 covers this).

4. **Install the Passbolt browser extension** (Chrome, Firefox, or Edge) from
   [passbolt.com/download](https://www.passbolt.com/download) if you haven't
   already.

5. **Open the setup URL** from step 3 in the browser where the extension is
   installed. The extension walks you through:
   - Generating a new GPG keypair locally (this is *your* personal key,
     distinct from the server's own GPG keypair generated in Task 1).
   - Choosing a master password (this never leaves your browser in
     plaintext).
   - Registering your public key with the Passbolt server.

6. Once setup completes, you are logged in as the admin user you configured in
   `admin_email`/`admin_first_name`/`admin_last_name`. Confirm you can see the
   empty password list — there is nothing to see yet, but a working session
   confirms the full chain (server GPG key, JWT key, schema, admin account,
   your personal GPG key) is functioning.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload:**

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update**
   on the deployment details page — the module owns the workload spec, so
   scaling is a configuration change, not a manual `kubectl scale` (a manual
   edit would be reverted on the next apply).

3. **Update the application version** by changing `application_version` in
   the RAD platform and applying it via **Update**; a new image builds and a
   rolling update replaces the pod, and the `db-init`/`admin-bootstrap` init
   jobs re-run (both are idempotent — an existing schema and admin account
   are left untouched).

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

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU
   and memory utilisation and restart counts. The module can provision an
   **uptime check** (when enabled); review Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Passbolt releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The
  container-level startup probe targets `GET /healthcheck/status.json` with a
  generous failure threshold to accommodate first-boot latency.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```

- **`admin-bootstrap` job fails with an Internal Error / 500 on
  `register_user`:** this is the exact failure mode the job is specifically
  built to avoid by replicating the vendor's own GPG-key-generation/schema-install
  sequence first — if it still fails, check its pod logs for which step
  failed:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<admin-bootstrap-job-name>
  ```
  Confirm `db-init` completed successfully first (`admin-bootstrap` depends on
  it via `depends_on_jobs`) and that the `storage`/`jwt` GCS-Fuse volumes are
  actually mounted with the `uid=33`/`gid=33` options — an `EACCES` error in
  the logs during GPG key generation points straight at a missing or
  incorrect mount option.

- **Setup URL never appears in logs:** confirm `admin-bootstrap` actually
  completed (not just started). If the job pod was garbage-collected or the
  job failed partway, its idempotent GPG/JWT/schema steps are safe to re-run —
  delete the completed/failed Job object and let the next apply recreate it,
  or trigger it manually depending on your cluster's Job semantics.

- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE` and the cloud-sql-proxy sidecar is healthy. On GKE the pod
  connects over loopback TCP (`127.0.0.1`), not a Unix socket — check the
  pod's injected `DATASOURCES_DEFAULT_HOST` value if connections fail.

- **Lost the GPG/JWT keypair volumes:** if the `storage` or `jwt` GCS bucket
  is deleted or emptied, every credential Passbolt has encrypted server-side
  and every issued JWT session is unrecoverable — the server generates a
  brand-new keypair on next boot, which cannot decrypt data encrypted under
  the old one. There is no Terraform-side recovery for this; it is the same
  severity as losing a password manager's own master key. Treat these buckets
  with at least the same care as the Cloud SQL instance.

- **Image pull errors:** confirm the image exists in Artifact Registry (or is
  reachable from Docker Hub, if mirroring is disabled) and the node service
  account can pull it.

- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas, including the GCS Fuse `uid=33`/`gid=33` mount
options that are load-bearing for GPG key generation on GKE.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created —
the Kubernetes workload and namespace, Cloud SQL database, the `storage`/`jwt`
GCS buckets (and the GPG/JWT keypairs within them), and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, GKE cluster, shared
Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (MySQL 8.0), the GPG/JWT GCS buckets, and runs the `db-init` → `admin-bootstrap` chain |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes on `/healthcheck/status.json`; retrieve the one-time setup URL from pod logs and complete registration via a browser extension |
| 3 — Operate | Manual | Inspect workload, scale, update version, inspect the keypair volumes, DB access, manage users/groups |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, admin-bootstrap, database, GCS Fuse permission, and keypair-loss issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
