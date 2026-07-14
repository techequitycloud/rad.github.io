---
title: "Focalboard on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Focalboard on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Focalboard on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Focalboard_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Focalboard is an open-source, self-hosted project-management and Kanban board tool
from Mattermost — a Trello/Asana/Notion-boards alternative with multiple board views
(kanban, table, gallery, calendar) for organizing tasks with boards and cards. This lab
takes you through the full operational lifecycle of the **Focalboard on GKE Autopilot**
module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Focalboard product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Focalboard_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
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

1. Click **Deploy** in the RAD platform top navigation, open **Focalboard (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Focalboard_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster as a
   **StatefulSet** (the module's default — `stateful_pvc_enabled = true` auto-resolves
   `workload_type`), giving the single pod a per-pod `10Gi` block PVC for board
   attachments. It also provisions a Cloud SQL (PostgreSQL 15) database with its
   Secret Manager secrets (`FOCALBOARD_ADMIN_PASSWORD` and the database password), a
   Cloud Filestore (NFS) instance (on by default, though not the path Focalboard's own
   attachments use — see Task 5), a Cloud Storage bucket, builds the container image
   (a thin wrapper `FROM mattermost/focalboard`), and runs a one-shot
   database-initialisation job that creates the application role and database. First
   deploys take roughly **20–35 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep focalboard | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,svc,statefulset -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is healthy. Focalboard has no dedicated health API — the
   startup, liveness, and readiness probes all target the web UI root, which returns
   200 only once the Go server has bound its port and completed its own schema
   migrations against Cloud SQL (reached over the Auth Proxy sidecar on
   `127.0.0.1:5432`):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. Focalboard runs in `authMode = native`.
   A `FOCALBOARD_ADMIN_PASSWORD` secret is auto-generated, but it is **not confirmed**
   whether the upstream binary consumes it to bootstrap a login — try retrieving it
   first:

   ```bash
   gcloud secrets versions access latest --secret=<admin-password-secret-name> --project="$PROJECT"
   ```

   If that credential does not work against any pre-existing account, register the
   first account through the UI instead (name, email, password) — it automatically
   becomes the workspace owner. Public shared boards are enabled by default.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pods, and the per-pod PVC:

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Scale with caution.** Changing the min/max instance inputs and clicking
   **Update** on the deployment details page is how the module owns the workload spec
   (a manual `kubectl scale` would be reverted on the next apply) — but unlike apps
   whose state lives entirely in a shared database, Focalboard's board **attachments**
   live on a per-pod block PVC, not a shared filesystem. Raising
   `max_instance_count` above `1` silently splits uploaded attachments across
   isolated volumes with no error; keep it at `1` unless you re-architect storage
   (e.g. move attachments to a shared bucket). Session affinity (`ClientIP`) is set
   by default to keep a client's requests on the same pod.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a rolling update
   replaces the pod. Focalboard applies its own schema migrations on every boot as the
   application database user, so upgrading the version applies schema changes
   automatically — there is no separate migration job.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets,jobs -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~focalboard"
   kubectl get pvc -n "$NS"                # per-pod attachment PVC(s)
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=<db-user> --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer. The entrypoint prints the resolved
   DB host, name, user, and `sslmode` at startup (on GKE this is always the loopback,
   plaintext-to-the-sidecar case):

   ```bash
   kubectl logs -n "$NS" -l app=focalboard --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. The module's uptime check
   (`uptime_check_config`) is **disabled by default**; enable it and confirm it turns
   green under Monitoring → Uptime checks if you need synthetic availability
   monitoring.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Focalboard releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup probe
  targets `/` and allows up to **~8.5 minutes** on first boot (60s initial delay, 15s
  period, 30 retries); a connection failure to PostgreSQL through the Auth Proxy
  sidecar will keep the pod from becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret materialised into the namespace via the Secret Store CSI driver,
  and the `db-init` job completed (it also signals the Auth Proxy sidecar to shut down
  via `quitquitquit` so the job pod completes).
- **`db-init` job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Attachment uploads fail or "vanish" between requests:** confirm you are looking at
  the right volume. Focalboard writes attachments to the block PVC mounted at
  `stateful_pvc_mount_path` (default `/data`) — **not** the Filestore (NFS) mount at
  `nfs_mount_path` (`/opt/focalboard/storage`), which is provisioned by default but
  unused by Focalboard's own storage path. If you scaled beyond one replica, each pod
  has its own isolated PVC — an attachment uploaded via one pod is invisible on
  another (see Task 3).
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or PVC-provisioning issues (including SSD quota — the default
  `stateful_pvc_storage_class = standard-rwo` draws the tighter `SSD_TOTAL_GB`
  quota), and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including why `database_type` is locked to PostgreSQL by a plan-time
precondition, and why `application_database_name`/`application_database_user` are
effectively immutable after first deploy).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes StatefulSet
and namespace (including its per-pod PVC), the Cloud SQL database, the Filestore (NFS)
instance, Secret Manager secrets, GCS buckets, and Artifact Registry images. Resources
owned by **Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE StatefulSet (per-pod PVC), Cloud SQL (PostgreSQL 15), Filestore, secrets, storage bucket, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check (`/`) passes; try the admin-password secret, else register the first account in the UI |
| 3 — Operate | Manual | Inspect workload/PVC, scale with caution (per-pod storage), update version, manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and (optional) uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, storage-path, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
