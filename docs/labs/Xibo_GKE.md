---
title: "Xibo on GKE Autopilot — Lab Guide"
description: "Hands-on lab: deploy Xibo on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Xibo on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Xibo_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Xibo is an open-source digital-signage platform whose CMS schedules and distributes
layouts, playlists and media to networks of display players. This lab takes you
through the full operational lifecycle of the **Xibo on GKE Autopilot** module on
Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Xibo product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Xibo_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform with a persistent media library, and locate the resources it provisions.
- Connect to the GKE cluster and access the running CMS.
- Perform day-2 operations — inspect, update, and manage secrets, storage and the database job.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP** (provides the VPC, GKE Autopilot cluster, Cloud SQL, Artifact
  Registry, and shared service accounts this module depends on). You do not need
  to deploy this yourself first — the platform automatically detects whether it
  already exists in the target project and provisions it before this module if
  not (see Task 1).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** installed; `gcloud auth login` and
  `gcloud auth application-default login` completed.
- **Project Owner** (or equivalent) IAM on the project.
- **Bringing your own project?** Before the first deploy into it, the deployment confirmation dialog asks you to prove you control it (**Get verification code**, run the commands it shows as a project Owner, then **Verify**) and to give the RAD deployment service account the **Owner** role. A project RAD creates for you needs neither.
- **Advanced mode for later changes.** The create form asks only for the first page of inputs (and, in a project RAD creates for you, little more than the tenant name and region). Every other input in the Configuration Guide — including the scaling and version inputs in the Day-2 tasks — is changed afterwards with **Update** on the deployment's page after ticking **Enable advanced mode**, which needs a credit balance that covers the update's estimated build cost (updates never carry a module fee). On a lab environment only an administrator can use Advanced mode.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Open **Solutions → Solution Catalog → RAD modules** in the RAD platform top navigation, open **Xibo (GKE)** from the **Platform Modules** list to start configuration, choose **Configuration Form** under *How would you like to configure this deployment?* (the form opens on the **Conversational Assistant** if you hold purchased credits or are a partner or administrator), set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Xibo_GKE)
   documents every input by group, with defaults. **Decide on media persistence
   now:** with the module's defaults Xibo's media library is not on a persistent
   volume, and a StatefulSet's volume settings cannot be changed in place later. For
   a deployment you intend to keep, set `stateful_pvc_enabled = true`,
   `stateful_pvc_mount_path = "/var/www/cms/library"`, a `stateful_pvc_size` that
   fits your media, and `max_instance_count = 1` (these may only be reachable in
   Advanced mode; see Prerequisites). Click **Deploy Module**, review the estimated cost in the **Deployment Confirmation** dialog when it appears and click **Submit** (if the dialog then adds a confirmation step, such as verifying a project you bring, complete it and click **Confirm**), which opens the deployment status page with real-time logs.

2. The platform builds the Xibo image (a thin wrapper over
   `ghcr.io/xibosignage/xibo-cms`) with Cloud Build, provisions a Cloud SQL
   (MySQL 8.0) database with its Secret Manager secrets, runs the one-shot `db-init`
   job, and deploys the CMS into the GKE Autopilot cluster behind a Gateway. On first
   boot Xibo installs its own schema. First deploys take roughly **20–35 minutes**
   (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep xibo | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and the database job completed:

   ```bash
   kubectl get deploy,statefulset,pods,pvc,jobs -n "$NS"
   POD=$(kubectl get pods -n "$NS" -o name | grep -v db-init | head -1 | cut -d/ -f2)
   kubectl logs -n "$NS" "$POD" | grep "\[startup\]"
   ```

   The `[startup]` line shows the database host and port (the Cloud SQL private IP
   on `3306`) and the `server_name` derived for players.

2. Check whether the media library is on a persistent volume:

   ```bash
   kubectl exec -n "$NS" "$POD" -- df -h /var/www/cms/library
   ```

   If this shows the container's overlay filesystem rather than a mounted volume,
   uploads will be lost when the pod is replaced — see Task 5.

3. Find the URL. On the deployment's page in the RAD platform, read the
   `service_url` output; it is the Gateway's `nip.io` URL unless you set a custom
   domain. Check the login page:

   ```bash
   SERVICE_URL="<service_url from the deployment outputs>"
   curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/login"   # expect 200
   ```

4. Open the CMS over **HTTPS** in a browser (session cookies are marked `Secure`,
   so a login over plain HTTP does not stick). The image seeds a fixed `xibo_admin`
   account; the module does not set its password. Sign in with the initial
   credentials Xibo documents for its Docker image and **change the password
   immediately**. The database password used by the CMS is in Secret Manager:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~xibo" --format="value(name)"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — the CMS workload, its pod and (if enabled) its
   persistent volume:

   ```bash
   kubectl get deploy,statefulset,pods,pvc -n "$NS"
   kubectl describe pod -n "$NS" "$POD"
   ```

2. **Keep one replica.** Each replica would have its own library, so leave
   `min_instance_count`/`max_instance_count` at `1`. Changes go through **Update** on
   the deployment details page — the module owns the workload spec, so a manual
   `kubectl scale` would be reverted on the next apply.

3. **Update the Xibo release** by changing `application_version` via **Update** to
   another exact tag published on `ghcr.io/xibosignage/xibo-cms`. A new image builds,
   the pod is replaced, and Xibo's entrypoint migrates the schema on boot.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~xibo"
   kubectl get jobs -n "$NS"          # db-init and any scheduled jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   DB_USER=$(gcloud sql users list --instance="$INSTANCE" --project="$PROJECT" \
     --format="value(name)" --filter="name~^xibo" --limit=1)
   gcloud sql connect "$INSTANCE" --user="$DB_USER" --project="$PROJECT"
   ```

6. **Custom domain.** If you serve the CMS on your own domain, also set
   `CMS_SERVER_NAME` to that host in `environment_variables` — Xibo writes it into
   the configuration players receive.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" "$POD" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and memory
   utilisation, restart counts, and request metrics. The module also provisions an
   **uptime check** (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Xibo releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The probes target
  `/login`; a probe path of `/healthz` returns 404 and restarts a healthy pod.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  `db-init` job completed, and the `[startup]` line shows the private IP on `3306`.
  If `MYSQL_ATTR_SSL_VERIFY_SERVER_CERT` was overridden to `true`, PDO refuses the
  Cloud SQL connection.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Uploaded media disappeared after a restart:** the library was not on a
  persistent volume (Task 2, step 2). The fix is `stateful_pvc_enabled = true` with
  `stateful_pvc_mount_path = "/var/www/cms/library"`; enabling it on an existing
  deployment replaces the workload with a StatefulSet whose library starts empty, so
  re-upload media afterwards.
- **Login does not stick:** use the HTTPS URL; cookies are `Secure`.
- **Players point at the wrong address:** check `server_name` in the `[startup]`
  line and set `CMS_SERVER_NAME` for a custom domain.
- **Image build failed:** review **Cloud Build → History**; confirm the
  `application_version` tag exists on `ghcr.io/xibosignage/xibo-cms` (not Docker
  Hub).

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead (from the same **Delete** dialog) — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the deployment). Delete removes everything the module created — the Kubernetes workload
and namespace (including any library volume), Cloud SQL database, Secret Manager
secrets, GCS buckets, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the Xibo image, provisions Cloud SQL (MySQL 8.0) and secrets, runs `db-init`, and deploys the CMS |
| 2 — Access & verify | Manual | Connect to the cluster; library persistence checked; `/login` returns 200; admin password changed |
| 3 — Operate | Manual | Inspect workload, keep one replica, update the release, manage secrets/storage/jobs, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, lost-media, login, player-address and build issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
