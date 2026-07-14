---
title: "LimeSurvey on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy LimeSurvey on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# LimeSurvey on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/LimeSurvey_GKE)**

## Overview

**Estimated time:** 45–90 minutes

LimeSurvey is a free, open-source online survey and questionnaire platform
(PHP/Yii) supporting unlimited surveys, conditional branching, quotas, and
multi-language surveys. This lab takes you through the full operational
lifecycle of the **LimeSurvey on GKE Autopilot** module on Google Cloud: deploy
it, access and verify it, run it day-to-day, observe it, diagnose common
problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on LimeSurvey survey-authoring features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/LimeSurvey_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload, including the
  first-run super-admin login.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Filestore/NFS, Artifact Registry, and shared service accounts
  this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** installed; `gcloud auth login` and
  `gcloud auth application-default login` completed.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Click **Deploy** in the RAD platform top navigation, open **LimeSurvey (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/LimeSurvey_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (MySQL 8.0) database with its Secret Manager secrets (`ADMIN_PASSWORD`
   and the database password), a Cloud Filestore (NFS) instance for the upload
   directory, a `limesurvey-uploads` Cloud Storage bucket, builds the container
   image, and runs a one-shot `db-init` job that creates the empty database and
   user. LimeSurvey's own console installer then builds the schema on first pod
   start. First deploys take roughly **20–35 minutes** (Cloud SQL and Filestore
   creation dominate), plus a few extra minutes on the very first boot for the
   schema install.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep limesurvey | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is healthy. LimeSurvey's liveness probe is an unauthenticated
   `GET /` on the landing page (300s initial delay, 3 failures) — allow several
   minutes on first boot for the console installer to finish building the schema:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Retrieve the auto-generated super-admin password from Secret Manager:

   ```bash
   gcloud secrets versions access latest --secret=secret-<resource-prefix>-limesurvey-admin-password \
     --project="$PROJECT"
   ```

4. Set `PUBLIC_URL` now that the external IP is known — it is **not** preset on
   GKE, unlike the Cloud Run variant:

   ```bash
   kubectl patch deploy <service-name> -n "$NS" \
     -p '{"spec":{"template":{"spec":{"containers":[{"name":"limesurvey","env":[
       {"name":"PUBLIC_URL","value":"http://'"${EXTERNAL_IP}"'"}]}]}}}}'
   ```

5. Open `http://${EXTERNAL_IP}` in a browser and sign in to the admin panel
   (`/admin`) as `admin` / `admin@techequity.cloud` using the password retrieved
   above. Create a test survey to confirm the database and NFS upload paths both
   work end to end.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and PVCs:

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply). Keep
   `max_instance_count = 1` unless session-sharing behaviour is verified —
   LimeSurvey keeps PHP session state, and `session_affinity = ClientIP` is set by
   default to keep a client's requests on the same pod.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and a rolling update replaces
   the pods. `latest` resolves to the pinned `6-apache` tag via the app-specific
   `LIMESURVEY_VERSION` build arg — pin it explicitly in production to avoid an
   unplanned schema upgrade.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~limesurvey"
   kubectl get jobs -n "$NS"          # db-init job
   gcloud filestore instances list --project="$PROJECT"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=limesurvey --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. Also check the
   Filestore instance's capacity and throughput metrics, since survey uploads
   accumulate there. The module can provision an **uptime check** (when enabled);
   review Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with LimeSurvey releases.

- **Pod Ready but every page 500s with "table settings_global not found":** the
  console installer's schema creation silently failed — almost always a
  storage-engine problem (the image defaults to MyISAM, which Cloud SQL disables;
  this module forces `InnoDB`) or the installer could not reach the database via
  the Auth Proxy sidecar. Check the pod logs from the very first boot.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pod exits immediately on boot:** `ADMIN_PASSWORD` is required — the container
  exits without it. Confirm the secret materialised into the namespace via the
  Secret Store CSI driver.
- **`db-init` job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Uploaded assets vanish after a pod restart:** confirm `enable_nfs = true` and
  that the Filestore instance is reachable — without NFS, `/var/www/html/upload`
  is ephemeral per-pod.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`
  and the cloud-sql-proxy sidecar (loopback `127.0.0.1:3306`, requires
  `enable_cloudsql_volume = true`) is running alongside the app container.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an assigned
  IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule to never revert the forced `InnoDB` engine,
and to never rename `application_database_name`/`application_database_user` after
first deploy).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Cloud Filestore instance, Secret Manager
secrets, GCS buckets, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (MySQL 8.0), Filestore (NFS), storage bucket, secrets, and runs db-init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; retrieve admin password; set PUBLIC_URL; log in and create a test survey |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
