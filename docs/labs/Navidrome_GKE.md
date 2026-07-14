---
title: "Navidrome on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Navidrome on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Navidrome on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Navidrome_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Navidrome is a free, open-source, self-hosted, Subsonic-compatible music streaming
server written in Go. It has no external database — its entire state (library,
users, playlists) lives in an embedded SQLite file, which on GKE is backed by a
real block Persistent Disk rather than a network filesystem. This lab takes you
through the full operational lifecycle of the **Navidrome on GKE Autopilot**
module on Google Cloud: deploy it, access and verify it, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Navidrome product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Navidrome_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running StatefulSet workload.
- Perform day-2 operations — inspect the pod and PVC, mount a music library, and
  manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Artifact Registry, and shared service accounts this module
  depends on — Navidrome itself needs no Cloud SQL instance).
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

1. Click **Deploy** in the RAD platform top navigation, open **Navidrome (GKE)**
   from the **Platform Modules** list to start configuration, set `project_id`,
   and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Navidrome_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster as a
   **StatefulSet** (auto-resolved because `stateful_pvc_enabled = true`), provisions
   a 20Gi block PersistentVolumeClaim at `/data` (SSD `standard-rwo` by default —
   this holds the SQLite database, metadata cache, and search index), a Secret
   Manager secret with a generated admin password (materialised into the namespace
   as a native Kubernetes Secret), and mirrors the `deluan/navidrome` image into
   Artifact Registry. There is **no Cloud SQL instance and no init/migration Job**
   — Navidrome creates its own SQLite schema on first boot. First deploys typically
   complete in **5–15 minutes**, much faster than a database-backed module.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep navidrome | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get statefulset,pods,pvc,svc -n "$NS"
   ```

   Confirm the workload type reads `StatefulSet` (not `Deployment`) — this is what
   gives Navidrome a genuine block-storage PVC instead of the ephemeral-FUSE
   trade-off the Cloud Run variant makes.

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is running and check for an external address (there is none by
   default — `service_type = ClusterIP`):

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: ${EXTERNAL_IP:-<none — ClusterIP only>}"
   ```

2. Without external ingress configured, reach the service with a port-forward and
   confirm the unauthenticated ping endpoint:

   ```bash
   SVC=$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl port-forward -n "$NS" "svc/$SVC" 4533:4533 &
   curl -s http://localhost:4533/ping   # expect {"status":"ok"}
   kill %1
   ```

3. Retrieve the generated admin password from Secret Manager (it is also mirrored
   as a native Kubernetes Secret in the namespace):

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~navidrome-admin-password"
   gcloud secrets versions access latest --secret=<admin-password-secret-name> --project="$PROJECT"
   kubectl get secrets -n "$NS" | grep navidrome
   ```

4. Log in as `admin` with the retrieved password through the port-forward (or the
   external address once configured) and change the password after first login.
   If `enable_admin_password = false` was chosen instead, complete the first-run
   setup wizard yourself immediately.

5. The music library is empty until you mount one. Add a `gcs_volumes` entry with
   `mount_path = "/music"` (read-only is fine — no SQLite state lives there), or
   enable NFS (`enable_nfs = true`, `nfs_mount_path = "/music"`) for a writable
   shared library, then apply via **Update**.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pod, and PVC:

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Do not scale beyond one replica.** `min_instance_count = 1` and
   `max_instance_count = 1` are both fixed by design — Navidrome has no
   multi-writer SQLite mode, and the PVC is bound to the pod's stable StatefulSet
   identity (`<service-name>-0`). Scaling is a configuration input on the
   deployment details page, not something to change with a manual `kubectl scale`
   (a manual edit would be reverted on the next apply).

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and the single pod
   is replaced.

4. **Manage secrets and storage:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~navidrome"
   kubectl get pvc -n "$NS"
   gcloud compute disks list --project="$PROJECT" --filter="name~navidrome"
   ```

5. **Verify the music-library mount and running config:**

   ```bash
   kubectl exec -n "$NS" statefulset/"$SVC" -- env | grep ^ND_
   kubectl exec -n "$NS" statefulset/"$SVC" -- ls /music
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" statefulset/"$SVC" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation (Navidrome holds its search index in memory — watch this on
   a large library), restart counts, and PVC/disk usage under Compute Engine →
   Disks. An optional uptime check can be provisioned once external ingress
   (`application_domains` or `service_type = LoadBalancer`) is configured; review
   it under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Navidrome releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. Both the startup
  and liveness probes target `GET /ping`, an unauthenticated endpoint.
  ```bash
  kubectl describe pod -n "$NS" -l app="$SVC"        # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" -l app="$SVC" --previous      # logs from the crashed container
  ```
- **PVC stuck `Pending` / `Quota 'SSD_TOTAL_GB' exceeded`:** the default
  `stateful_pvc_storage_class = standard-rwo` is SSD-backed and draws the tight
  regional SSD quota. Switch to `-var stateful_pvc_storage_class=standard` (HDD
  `pd-standard`) if a wider campaign of stateful apps has exhausted it — Navidrome's
  `/data` is metadata/index-sized, not bulk-media-sized, so HDD is a safe fallback.
- **Empty library / no songs found:** confirm a `gcs_volumes` entry or NFS mount is
  actually attached at `/music` — nothing is mounted there by default.
- **No external access:** `service_type = ClusterIP` and empty `application_domains`
  are the defaults — reachable only inside the cluster/VPC until you set one of
  them.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section
for setting-specific gotchas (including why `stateful_pvc_enabled` must stay
`true` and why `max_instance_count` must never exceed 1).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes StatefulSet
and namespace, the `/data` PersistentVolumeClaim and its underlying Persistent Disk
(**this permanently deletes the music library metadata, users, and playlists** —
there is no Cloud SQL to separately back up), the always-created `storage` Cloud
Storage bucket, the Secret Manager admin-password secret, and Artifact Registry
images. Resources owned by **Services_GCP** (the VPC, GKE cluster, shared Cloud
SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys a GKE StatefulSet with a block PVC at `/data`, an admin-password secret, and mirrors the image — no Cloud SQL, no init job |
| 2 — Access & verify | Manual | Connect to the cluster; health check (`/ping`) passes via port-forward; retrieve the admin password and log in; mount a music library at `/music` |
| 3 — Operate | Manual | Inspect the StatefulSet/pod/PVC, keep scaling at 1/1, update version, manage secrets/storage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and PVC/disk usage |
| 5 — Troubleshoot | Manual | Diagnose pod, PVC/SSD-quota, empty-library, ingress, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the PVC and its Persistent Disk |
