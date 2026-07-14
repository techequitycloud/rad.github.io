---
title: "Cloudreve on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Cloudreve on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Cloudreve on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Cloudreve_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Cloudreve is an open-source, self-hosted cloud storage and file-sharing
platform written in Go, with a web UI for uploading, organising, previewing,
and sharing files. This lab takes you through the full operational lifecycle
of the **Cloudreve on GKE Autopilot** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common
problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud
platform**, not on Cloudreve product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Cloudreve_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload, including
  retrieving the first-run admin password from pod logs.
- Perform day-2 operations — inspect the StatefulSet and its block Persistent
  Volume, update, and understand the storage-class trade-off.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Artifact Registry, and shared service accounts this
  module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Cloudreve
   (GKE)** from the **Platform Modules** list to start configuration, set
   `project_id`, and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Cloudreve_GKE)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster as a
   **StatefulSet** (`stateful_pvc_enabled = true` by default resolves
   `workload_type` automatically — no need to set both), provisions a
   20Gi block **Persistent Volume** mounted at `/cloudreve` (Cloudreve's
   embedded SQLite database and uploaded files live there — a GCS FUSE mount
   would break SQLite's file locking, so the block device is mandatory, not
   optional), and builds the custom container image (a multi-stage Dockerfile
   that relocates the `cloudreve` binary to `/usr/local/bin/cloudreve` so the
   PVC mount cannot shadow it). There is **no Cloud SQL instance and no
   Secret Manager secret** created — Cloudreve mints its own admin password
   on first boot. First deploys typically take **10–20 minutes** (dominated
   by the image build and PVC provisioning).

3. Connect to the cluster and discover the namespace with name-agnostic
   filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep cloudreve | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get statefulsets,pods,svc,pvc -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address. By default
   `enable_custom_domain = true` and `reserve_static_ip = true`, so external
   access normally goes through a Kubernetes Gateway rather than the Service
   directly:

   ```bash
   kubectl get statefulsets,pods -n "$NS"
   kubectl get svc,gateway,httproute -n "$NS"
   EXTERNAL_IP=$(gcloud compute addresses list --project="$PROJECT" --filter="name~cloudreve" --format="value(address)" --limit=1)
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the pod is serving. Cloudreve has no dedicated health endpoint —
   its own startup/liveness probes target `/`, which returns HTTP 200 once
   the Go binary is serving:

   ```bash
   curl -sI "http://${EXTERNAL_IP}"   # expect HTTP/1.1 200 (or via the Gateway hostname if custom domain is configured)
   ```

3. **Retrieve the first-run admin password.** Cloudreve generates its own
   initial administrator account and password on first boot and prints the
   password to the container's stdout — there is **no Secret Manager
   secret** to read it from, and it is only logged **once**. Capture it
   immediately:

   ```bash
   kubectl logs -n "$NS" statefulset/<service-name> --tail=200 | grep -i "admin\|password"
   ```

   If the log buffer has already rotated past it, there is no other recovery
   path from outside the container — you would need to reset the account via
   whatever mechanism Cloudreve itself exposes for that release, or exec into
   the pod directly (see Task 3).

4. Open the workload's URL (or `http://${EXTERNAL_IP}`) in a browser and sign
   in with the admin account and the password captured above. Change the
   password immediately via the web UI's account settings, since the
   generated one only ever existed in a log line.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pods, and the PVC:

   ```bash
   kubectl get statefulsets,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   kubectl rollout status statefulset/<service-name> -n "$NS"
   ```

2. **Do not scale beyond one replica.** `min_instance_count =
   max_instance_count = 1` by default, and this is intentional: Cloudreve has
   no verified multi-node/clustering mode, and the single block PVC has no
   protection against concurrent writers if you were to attempt a
   multi-replica StatefulSet. Leave it at the platform default. Note
   `enable_pod_disruption_budget = true` with `pdb_min_available = "1"` also
   protects the single stateful pod from voluntary disruption.

3. **Update the application version** by changing the version input in the
   RAD platform and applying it via **Update**. The Dockerfile pins
   `application_version = "latest"` to a specific verified release
   (`3.8.3`) via an app-specific `CLOUDREVE_VERSION` build ARG, so a rebuild
   reproduces a known-good image rather than floating to an untested upstream
   tag.

4. **Inspect the block Persistent Volume** directly by exec'ing into the pod
   — unlike Cloud Run, GKE gives you a real shell:

   ```bash
   kubectl exec -n "$NS" statefulset/<service-name> -- ls -la /cloudreve
   kubectl exec -n "$NS" statefulset/<service-name> -- sqlite3 /cloudreve/cloudreve.db ".tables"
   gcloud compute disks list --project="$PROJECT" --filter="name~cloudreve"
   ```

5. **Understand the storage-class trade-off.** The PVC defaults to
   `stateful_pvc_storage_class = standard-rwo` (SSD-backed Balanced PD),
   which draws the tight `SSD_TOTAL_GB` quota on constrained projects.
   Scaling the workload to zero (`kubectl scale --replicas=0`) frees CPU/memory
   but **keeps the PVC** — only deleting the PVC (or the namespace) releases
   the quota it holds. Switch to `stateful_pvc_storage_class = standard`
   (HDD) if quota pressure is a concern; Cloudreve does not need SSD IOPS.

6. **Manage jobs** (only present if you supplied your own — Cloudreve injects
   no default database-init job, since it has no external database):

   ```bash
   kubectl get jobs -n "$NS"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer. This is also where the
   first-run admin password appears, so it is worth knowing the filter even
   after initial setup:

   ```bash
   kubectl logs -n "$NS" statefulset/<service-name> --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU
   and memory utilisation (memory is worth watching under heavy file-transfer
   load), restart counts, and PVC disk usage. The module can provision an
   **uptime check** (disabled by default); if enabled, review Monitoring →
   Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These
are platform-level diagnostics and do not change with Cloudreve releases.

- **Pod CrashLoopBackOff with `exec ./cloudreve: no such file or
  directory`:** this is the volume-shadowing failure mode the module's
  Dockerfile is built to avoid (binary relocated to
  `/usr/local/bin/cloudreve`, outside the PVC mount at `/cloudreve`). If you
  see it, something reverted that Dockerfile change — check
  `modules/Cloudreve_Common/scripts/Dockerfile` and rebuild:
  ```bash
  kubectl describe pod -n "$NS" <pod>
  kubectl logs -n "$NS" <pod> --previous
  tofu taint 'module.app_gke.module.app_build.null_resource.build_and_push_application_image[0]'
  ```
- **Can't sign in / lost the admin password:** the password is printed to
  pod logs only **once**, on first boot, and is never stored in Secret
  Manager. Search recent history (not just the tail) if the original capture
  was missed:
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NS"'"' \
    --project="$PROJECT" --freshness=7d --limit=1000 | grep -i "admin\|password"
  ```
- **Pod stuck `Pending` with `Quota 'SSD_TOTAL_GB' exceeded`:** the default
  `standard-rwo` storage class is SSD-backed and draws the regional
  `SSD_TOTAL_GB` quota; switch to `stateful_pvc_storage_class = standard`
  (HDD) — see Task 3, step 5.
- **Pod not Ready / liveness probe failing:** the startup probe is HTTP
  `GET /` with `failure_threshold = 10` (up to ~100 seconds) — a failure past
  that window usually means the PVC didn't mount or the binary itself failed
  to start:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl get pvc -n "$NS"
  ```
- **Data appears to reset after a redeploy:** confirm the PVC still exists
  and is still bound (`kubectl get pvc -n "$NS"`) — a namespace or PVC
  deletion (not just a pod restart) is the only thing that actually loses
  the embedded SQLite database and uploads.
- **Image pull errors:** confirm the image exists in Artifact Registry and
  the node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults*
section for setting-specific gotchas (including why `max_instance_count` must
stay at `1` and why a `gcs_volumes` entry must never target `/cloudreve`
while the block PVC is enabled).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, the block Persistent Volume (and everything stored on it,
including the embedded SQLite database and all uploaded files), and Artifact
Registry images. Resources owned by **Services_GCP** (the VPC, GKE cluster,
shared registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys a GKE StatefulSet with a 20Gi block PVC at `/cloudreve` and builds the custom image (no database, no secrets) |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; retrieve the first-run admin password from pod logs and sign in |
| 3 — Operate | Manual | Inspect the StatefulSet/PVC, keep at single replica, update version, manage the storage-class trade-off |
| 4 — Observe | Manual | Query Cloud Logging (including for the admin password); review Cloud Monitoring metrics |
| 5 — Troubleshoot | Manual | Diagnose volume-shadowing, lost-password, SSD-quota, probe, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes the workload, namespace, PVC, and images |
