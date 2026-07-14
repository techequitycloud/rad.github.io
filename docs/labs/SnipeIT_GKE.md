---
title: "SnipeIT on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy SnipeIT on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# SnipeIT on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/SnipeIT_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Snipe-IT is a free, open-source IT asset and inventory management system for
tracking hardware, software licences, accessories, and consumables, with
asset check-in/out, audit logging, depreciation, and a full REST API. This
lab takes you through the full operational lifecycle of the **Snipe-IT on
GKE Autopilot** module on Google Cloud: deploy it, access and verify it, run
it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud
platform**, not on Snipe-IT product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/SnipeIT_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload, including its first-run `/setup` wizard.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Artifact Registry, and shared service accounts this module
  depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Snipe-IT (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/SnipeIT_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster running the
   official `snipe/snipe-it` PHP/Apache image (no custom build), provisions a
   Cloud SQL for MySQL 8.0 database with its Secret Manager secrets (the
   Laravel `APP_KEY` and the database password), a Cloud Filestore (NFS)
   instance mounted at `/var/lib/snipeit` for uploaded asset
   images/signatures/barcodes, a Cloud Storage `snipeit-uploads` bucket, and
   runs two ordered initialisation jobs (`db-init` then `migrate`). First
   deploys take roughly **20–35 minutes** (Cloud SQL and Filestore creation
   dominate).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NAMESPACE=$(kubectl get ns -o name | grep snipeit | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NAMESPACE"
   kubectl get all -n "$NAMESPACE"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,svc -n "$NAMESPACE"
   EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is healthy. Snipe-IT serves its login/setup page at `/`
   unauthenticated, so a `200` there confirms the PHP application and the
   MySQL connection (reached via the Cloud SQL Auth Proxy sidecar on
   `127.0.0.1:3306`) are both healthy:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. On a fresh install, Snipe-IT
   redirects `/` to the **`/setup`** installation wizard rather than offering
   a self-serve sign-up form. Walk through the wizard to create the first
   administrator account. If the redirect loops or lands on the wrong host,
   confirm `APP_URL` matches the address you're browsing to (Snipe-IT derives
   it automatically from the predicted GKE service URL, but a custom domain
   added after deploy needs `APP_URL` updated via `environment_variables`).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and persistent volume claims:

   ```bash
   kubectl get deploy,pods,pvc -n "$NAMESPACE"
   kubectl describe deploy -n "$NAMESPACE"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the workload spec, so
   scaling is a configuration change, not a manual `kubectl scale` (a manual
   edit would be reverted on the next apply). `min_instance_count` and
   `max_instance_count` both default to `1`; scaling beyond one replica
   without verified shared-NFS/session-driver behaviour risks split sessions
   and lock contention. Session affinity (`ClientIP`) is set by default so a
   client's requests reach the same pod.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image is pulled and a
   rolling update replaces the pods. Pin `application_version` to a specific
   `snipe/snipe-it` release tag in production rather than tracking
   `v8-latest`.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NAMESPACE"
   gcloud secrets list --project="$PROJECT" --filter="name~snipeit"
   kubectl get jobs -n "$NAMESPACE"          # db-init and migrate
   ```

   Never rotate the `APP_KEY` secret after first boot — it invalidates every
   active session and any application data Snipe-IT encrypted with the old key.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=snipeit --database=snipeit --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. `uptime_check_config`
   is **disabled by default** for this module — enable it in the deployment
   inputs if you want a provisioned uptime check and check-failure alert under
   Monitoring → Uptime checks / Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Snipe-IT releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup
  probe is TCP on the container port (30 s initial delay, ~5-minute failure
  window) to allow first-boot DB setup; the liveness probe is HTTP `GET /`
  (300 s initial delay) — a connection failure to MySQL will keep the pod
  from becoming Ready.
  ```bash
  kubectl describe pod -n "$NAMESPACE" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NAMESPACE" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`. This variant reaches Cloud SQL via the **Auth Proxy sidecar on
  `127.0.0.1:3306`** (`enable_cloudsql_volume = true`); confirm the sidecar
  container is running alongside the app container in the pod.
- **Initialisation job failed:** inspect the job and its pod logs for either
  job in the chain (`db-init` runs first, then `migrate`):
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl logs -n "$NAMESPACE" job/<migrate-job-name>
  ```
- **`/setup` wizard loops or 404s:** almost always an `APP_URL` mismatch —
  confirm the injected `APP_URL` matches the host you're browsing to.
- **Uploads/asset images disappear after a restart:** confirm `enable_nfs =
  true`, `network_tags` still includes `nfsserver`, and the Filestore
  instance is reachable — removing the tag while NFS is enabled breaks
  pod-to-Filestore connectivity.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule never to rotate
`APP_KEY` after first boot, and the `upload_max_filesize ≤ post_max_size` /
`min_instance_count ≤ max_instance_count` plan-time guards).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Filestore (NFS) instance, Secret Manager
secrets, GCS buckets, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (MySQL 8.0), NFS, secrets, storage bucket, and runs `db-init` → `migrate` |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; complete the `/setup` wizard to create the first administrator account |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and (optional) uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, `/setup`, and NFS/scheduling issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
