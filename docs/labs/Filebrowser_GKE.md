---
title: "Filebrowser on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Filebrowser on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Filebrowser on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Filebrowser_GKE)**

## Overview

**Estimated time:** 45–90 minutes

File Browser is a lightweight, open-source web file manager written in Go — it
serves a directory tree over HTTP for browsing, uploading, editing, and sharing
files, with no external database. This lab takes you through the full operational
lifecycle of the **Filebrowser on GKE Autopilot** module on Google Cloud: deploy
it, access and verify it, run it day-to-day, observe it, diagnose common problems,
and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Filebrowser product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Filebrowser_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload, including the
  default admin login.
- Perform day-2 operations — inspect the workload, choose GCS FUSE vs. block PVC
  storage, and manage ingress.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Artifact Registry, and shared service accounts this module
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

1. Click **Deploy** in the RAD platform top navigation, open **Filebrowser (GKE)**
   from the **Platform Modules** list to start configuration, set `project_id`,
   and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Filebrowser_GKE)
   documents every input by group, with defaults. Decide up front whether you want
   the default GCS FUSE mount for `/database` or a block PVC
   (`stateful_pvc_enabled = true`) for proper SQLite file locking. Review the
   estimated cost (if credits are enabled) and click **Deploy**, which opens the
   deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster and
   provisions either a Cloud Storage bucket (GCS FUSE, default) or a block PVC
   (StatefulSet mode) mounted at `/database`, then builds the container image.
   There is no Cloud SQL instance, no Secret Manager application secret, and no
   database-initialisation job — Filebrowser is self-contained. First deploys
   typically complete in **10–15 minutes**.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep filebrowser | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running (a single-replica Deployment, or a
   StatefulSet when `stateful_pvc_enabled = true`) and find its address:

   ```bash
   kubectl get pods,svc -n "$NS"
   kubectl get statefulset,pvc -n "$NS"     # only present when stateful_pvc_enabled = true
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

   The Service defaults to `ClusterIP`; without a custom domain or reserved
   static IP, reach the workload in-cluster or via `kubectl port-forward`.

2. Confirm the service is healthy. Filebrowser exposes an unauthenticated health
   endpoint that returns `200` as soon as the server is listening:

   ```bash
   kubectl exec -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- wget -qO- http://localhost:80/health
   ```

3. Open the workload in a browser — via the reserved static IP/custom domain
   (`enable_custom_domain = true` is the default) or a port-forward:

   ```bash
   kubectl port-forward -n "$NS" svc/<service-name> 8080:80
   # then browse to http://localhost:8080
   ```

   Log in with the seeded default credential **`admin` / `admin`**. Immediately
   change the password (and ideally the username) under **Settings → Profile** —
   this credential is well-known and grants full control of the file tree.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment/statefulset, pods, and PVCs:

   ```bash
   kubectl get deploy,statefulset,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"           # or: kubectl describe statefulset -n "$NS"
   ```

2. **Do not scale beyond one replica.** `min_instance_count = max_instance_count = 1`
   is intentional — the embedded SQLite database does not tolerate concurrent
   writers, even with a block PVC's proper file locking. Leave both at `1` in the
   RAD platform; a manual `kubectl scale` would be reverted on the next apply
   anyway.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a rolling
   update replaces the pod. Pin `application_version` explicitly in production
   rather than tracking `latest`.

4. **Switch storage backend or ingress** — toggle `stateful_pvc_enabled` (GCS
   FUSE vs. block PVC; Common auto-disables GCS FUSE when the PVC is on, so don't
   force both), or adjust `enable_custom_domain` / `application_domains`, then
   apply via **Update**.

5. **Inspect the persistent state:**

   ```bash
   # GCS FUSE mode (default)
   gcloud storage buckets list --project="$PROJECT" --filter="name~storage"
   gcloud storage ls gs://<data-bucket>/filebrowser.db

   # StatefulSet / block PVC mode
   kubectl get pvc -n "$NS"
   ```

   Never delete the `/database` bucket or PVC — doing so destroys all users,
   settings, and share links.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation and restart counts (should stay at a single, stable pod).
   If `uptime_check_config` is enabled, review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Filebrowser releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup and
  liveness probes target `/health`; a mount failure or bad image will keep the
  pod from becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Double-mount at `/database`:** if you changed `stateful_pvc_enabled`, confirm
  `enable_gcs_storage_volume` was correctly auto-disabled by `Filebrowser_Common`
  (both mounted at once is a misconfiguration, not a supported state).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # check Volumes / Mounts section
  ```
- **State not persisting across restarts:** confirm `stateful_pvc_mount_path`
  matches `FB_DATABASE`'s directory (`/database` by default); a mismatch stores
  the DB on ephemeral disk and loses state on restart.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the Service/Ingress has an assigned IP if
  `enable_custom_domain = true`.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it; custom/mirrored images use
  `imagePullPolicy = Always`, so a stale local cache is not the cause — check the
  registry and IAM instead.
- **Login shows `admin`/`admin` still active after redeploy:** expected if no
  prior SQLite DB existed at `/database`. If a fresh admin/admin prompt appears
  unexpectedly on a previously-configured deployment, check whether the GCS
  bucket or PVC was replaced/emptied.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule to keep `max_instance_count = 1`, never
delete the `/database` volume, and let Common manage the GCS-FUSE/PVC exclusivity).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload and namespace, the `/database` GCS bucket or PVC (including the embedded SQLite database — this is destructive and unrecoverable), and Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE cluster, shared Artifact Registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload and `/database` storage (GCS FUSE or block PVC); no Cloud SQL, no init job |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; log in with seeded `admin`/`admin` and change the password immediately |
| 3 — Operate | Manual | Inspect workload, keep replicas at 1, update version, switch storage backend/ingress, inspect persistent state |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, mount, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes the workload and the `/database` bucket or PVC (destructive) |
