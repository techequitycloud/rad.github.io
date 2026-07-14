---
title: "Kavita on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Kavita on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Kavita on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Kavita_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Kavita is a fast, self-hosted digital library and reading server for comics,
manga, and e-books — a web reading UI, OPDS feeds, collections, reading lists,
and full-text search, built on .NET with an internal SQLite database. This lab
takes you through the full operational lifecycle of the **Kavita on GKE
Autopilot** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Kavita product features. For the complete list of provisioned services
and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Kavita_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster, access the running workload, and complete the first-run setup wizard.
- Perform day-2 operations — inspect the StatefulSet and PVC, update, and manage storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Artifact Registry, and shared service accounts this module
  depends on — Kavita itself needs no Cloud SQL).
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

1. Click **Deploy** in the RAD platform top navigation, open **Kavita (GKE)**
   from the **Platform Modules** list to start configuration, set
   `project_id`, and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Kavita_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform deploys Kavita as a **StatefulSet** (auto-selected because
   `stateful_pvc_enabled = true`) into the GKE Autopilot cluster with a per-pod
   block PVC mounted at `/kavita/config`, builds the custom container image (a
   thin wrapper over `jvmilazz0/kavita`), and exposes it through the Gateway
   API with a reserved static IP. There is **no database to provision and no
   init job to wait on** — Kavita manages its own internal SQLite database.
   First deploys typically finish in **10–15 minutes**.

3. Connect to the cluster and discover the namespace with a name-agnostic filter:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep kavita | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get statefulset,pvc,pods,svc -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is running and find the external address:

   ```bash
   kubectl get pods,svc,gateway,httproute -n "$NS"
   EXTERNAL_IP=$(kubectl get gateway -n "$NS" \
     -o jsonpath='{.items[0].status.addresses[0].value}' 2>/dev/null)
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is healthy. Kavita exposes a public, unauthenticated
   health endpoint that returns `200` once the server is serving:

   ```bash
   kubectl port-forward -n "$NS" svc/<service-name> 5000:5000 &
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/api/health   # expect 200
   ```

   Or, once the Gateway has an address, hit it directly:
   `curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/api/health"`.

3. Open the service URL in a browser. On first visit Kavita's **first-run setup
   wizard** walks through creating the initial administrator account and adding
   your first library — there is no pre-seeded admin credential in Secret
   Manager. Complete this promptly: until the wizard runs, the service is
   reachable but unclaimed.

4. This module only persists Kavita's **state** directory (`/kavita/config` —
   settings, the SQLite database, covers) on the PVC. It does not provision the
   actual library content. To read anything, add your own `gcs_volumes` (or
   enable NFS) pointing at your comics/manga/e-book files and register that
   path as a library inside the Kavita UI.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload and its storage:**

   ```bash
   kubectl get statefulset,pvc,pods -n "$NS"
   kubectl describe statefulset -n "$NS"
   kubectl describe pvc -n "$NS"
   gcloud compute disks list --project="$PROJECT" --filter="name~kavita"
   ```

2. **Do not scale beyond one replica.** `min_instance_count` and
   `max_instance_count` both default to `1`. Kavita has no clustering or
   shared-storage coordination — running more than one replica against the
   same PVC is unsafe and risks corrupting the SQLite library index.

3. **Storage is a real block PVC by default** — `stateful_pvc_enabled = true`,
   `stateful_pvc_size = "20Gi"`, storage class `standard-rwo` (SSD-backed,
   drawing the project's `SSD_TOTAL_GB` quota). This is deliberate: gcsfuse
   corrupts SQLite/media index files, so GKE's block PVC is the safer default
   compared with [Kavita_CloudRun](https://docs.radmodules.dev/docs/modules/Kavita_CloudRun),
   which has no block-PVC option and must use GCS Fuse. If SSD quota is tight,
   consider `stateful_pvc_storage_class = "standard"` (HDD) — Kavita's I/O
   needs don't require SSD IOPS.

4. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a rolling
   update replaces the pod. Note `application_version = "latest"` resolves to a
   pinned `KAVITA_VERSION = 0.8.7` build argument inside `Kavita_Common`, not
   the generic tag the Foundation injects — bumping the version requires
   editing that pinned value and rebuilding, not just redeploying.

5. **Inspect the (normally unmounted) storage bucket:**

   ```bash
   gcloud storage buckets list --project="$PROJECT" --filter="name~kavita"
   ```

   `Kavita_Common` always creates a `storage` bucket, but with the default
   block-PVC layout it exists and is **not mounted** — it is only mounted at
   `/kavita/config` via GCS Fuse if you set `stateful_pvc_enabled = false`.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" statefulset/<service-name> --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and PVC disk usage. An optional
   **uptime check** against `/api/health` can be enabled (`uptime_check_config`,
   disabled by default for this module); if enabled, review Monitoring →
   Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Kavita releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup
  probe targets `/api/health` with a generous failure budget (10 attempts) to
  tolerate first-boot library indexing before the liveness probe takes over.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **PVC stuck `Pending`:** check for `SSD_TOTAL_GB` quota exhaustion (a common
  issue on quota-constrained projects — Kavita's default `standard-rwo` class
  is SSD-backed); switch to `stateful_pvc_storage_class = "standard"` (HDD) if
  needed.
- **Volume unwritable at boot:** confirm `stateful_fs_group = 3000` is set —
  Kavita runs as UID 1000/GID 2000, and an incorrect or unset `fsGroup` can
  leave the PVC unwritable by the container.
- **Library/data missing after a redeploy:** confirm the PVC (not the unmounted
  `storage` bucket) was preserved — the PVC is the entirety of Kavita's durable
  state under the default layout, and it survives pod restarts but not PVC
  deletion.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the Gateway/HTTPRoute has an assigned
  address.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including why `max_instance_count` must stay at `1`
and why `enable_redis` is inert for this module).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, the block PVC holding Kavita's entire state (SQLite database,
settings, covers), and the unmounted Cloud Storage bucket. Resources owned by
**Services_GCP** (the VPC, GKE cluster, Artifact Registry) are managed
separately and are not removed here. Because the PVC **is** the library index
and reading progress, make sure you have a backup or export you care about
before deleting.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys a StatefulSet with a block PVC mounted at `/kavita/config`; no database, no init job |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; complete the first-run setup wizard to create the admin account and first library |
| 3 — Operate | Manual | Inspect the StatefulSet/PVC, keep replicas at 1, update version, manage storage class |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and optional uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, PVC/quota, fsGroup, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the PVC holding Kavita's entire state |
