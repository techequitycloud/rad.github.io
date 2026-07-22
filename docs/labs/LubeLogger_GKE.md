---
title: "LubeLogger on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy LubeLogger on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# LubeLogger on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/LubeLogger_GKE)**

## Overview

**Estimated time:** 45–60 minutes

LubeLogger is a free, open-source vehicle maintenance and fuel-mileage tracker
(ASP.NET Core, embedded LiteDB database). This lab takes you through the full
operational lifecycle of the **LubeLogger on GKE Autopilot** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on LubeLogger product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/LubeLogger_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload, including the
  self-service first-run registration flow.
- Perform day-2 operations — inspect the StatefulSet and PVC, understand the
  single-instance constraint, update, and manage storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Artifact Registry, and shared service accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **LubeLogger (GKE)**
   from the **Platform Modules** list to start configuration, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/LubeLogger_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform deploys LubeLogger as a **StatefulSet** into the GKE Autopilot
   cluster with a per-pod block PVC mounted at `/App/data` (`stateful_pvc_enabled = true`
   by default), a small Cloud Storage bucket (`dpkeys`) for ASP.NET Core Data
   Protection keys, and mirrors the official prebuilt image into Artifact Registry.
   There is no Cloud SQL instance and no database-initialisation job, so first
   deploys are comparatively fast — typically **10–15 minutes** (dominated by PVC
   provisioning and cluster scheduling).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep lubelogger | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,svc,pvc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is healthy. LubeLogger exposes its public, unauthenticated
   `/Login` page — the same path the platform's own health probes use:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://${EXTERNAL_IP}/Login"   # expect 200
   ```

3. Open `http://${EXTERNAL_IP}/Login` in a browser. There is **no pre-seeded admin
   credential** — click **Register** and create the first account (name, email,
   password). Because `EnableAuth = "true"` is on by default, this is the ONLY way
   to gain access; the app root `/` redirects unauthenticated visitors to `/Login`.
   Complete this step immediately after deploy.

4. After logging in, add a vehicle and a maintenance/fuel record to confirm the
   database write path (embedded LiteDB, persisted on the block PVC) is working.
   Refresh the page and confirm the record is still there.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pod, and PVC:

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Scaling is intentionally fixed at one replica.** `min_instance_count = 1` and
   `max_instance_count = 1` are enforced by a plan-time validation guard —
   LubeLogger's default mode serves one shared embedded database file from one
   volume, so running multiple replicas risks corruption. There is no supported way
   to horizontally scale this module in its default configuration.

3. **Update the application version** by changing `application_version` in the RAD
   platform and applying it via **Update**; since the image is prebuilt (not
   custom-built), this directly selects the corresponding
   `ghcr.io/hargata/lubelogger` release tag and a rolling update replaces the pod.

4. **Inspect storage:**

   ```bash
   kubectl get pvc -n "$NS"
   gcloud storage buckets list --project="$PROJECT" --filter="name~lubelogger"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation and restart counts (expect a stable single pod, 0 restarts).
   The module can provision an **uptime check** (when enabled); review
   Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with LubeLogger releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The liveness probe
  targets `/Login` and should pass within seconds of the container starting —
  there is no first-boot database migration to wait on.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pod stuck Pending:** check `kubectl describe pod` events for PVC provisioning
  or SSD/HDD quota issues (`stateful_pvc_storage_class`).
- **Data not persisting across pod restarts:** confirm the PVC is bound and mounted
  at `/App/data` (`kubectl describe pod` → Volumes/Mounts section).
- **Logged out unexpectedly after a redeploy:** confirm the `dpkeys` GCS bucket
  exists and is mounted at `/root/.aspnet/DataProtection-Keys` — if it was ever
  deleted/recreated, all existing sessions are invalidated (not fatal, just requires
  re-login).
- **`/` returns a redirect/401 instead of the app:** expected behaviour when
  `EnableAuth = "true"` and you are not logged in. Go to `/Login` directly.
- **Pending pod / no external IP:** confirm the LoadBalancer Service has an
  assigned IP and `service_type = "LoadBalancer"` (not `ClusterIP`).
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule to keep `max_instance_count = 1`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, the PVC, the `dpkeys` Cloud Storage bucket, and Artifact Registry
images (**all vehicle records and uploaded documents are lost**). Resources owned by
**Services_GCP** (the VPC, GKE cluster, registry) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE StatefulSet with a block PVC, a small Cloud Storage bucket, and mirrors the prebuilt image (no database, no build step) |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; register the first account and confirm a record persists |
| 3 — Operate | Manual | Inspect the StatefulSet/PVC, understand the fixed single-replica constraint, update version, inspect storage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, PVC, session, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including all data |
