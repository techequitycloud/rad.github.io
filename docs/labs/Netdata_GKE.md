---
title: "Netdata on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Netdata on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Netdata on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Netdata_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Netdata is an open-source, real-time infrastructure and application monitoring
agent that collects thousands of per-second metrics and serves them on a
built-in dashboard and REST API. This lab takes you through the full
operational lifecycle of the **Netdata on GKE Autopilot** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Netdata product features. For the complete list of provisioned services
and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Netdata_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect, keep at single-replica scale, update, and manage secrets and storage.
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

1. Click **Deploy** in the RAD platform top navigation, open **Netdata
   (GKE)** from the **Platform Modules** list to start configuration, set
   `project_id`, and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Netdata_GKE)
   documents every input by group, with defaults. Note that `service_type`
   defaults to `ClusterIP` (internal-only) and `enable_admin_password`
   defaults to `false` — the opposite exposure default from the Cloud Run
   variant of this module — so out of the box the workload is **not**
   reachable outside the cluster. Review the estimated cost (if credits are
   enabled) and click **Deploy**, which opens the deployment status page with
   real-time logs.

2. The platform builds a thin custom image (`FROM netdata/netdata:<pinned
   version>`), pushes it to Artifact Registry, and deploys the workload into
   the GKE Autopilot cluster as a **StatefulSet** (the auto-resolved workload
   type, because `stateful_pvc_enabled = true` by default) with a dedicated
   20Gi `standard-rwo` (SSD) block PVC mounted at `/var/lib/netdata`. A Cloud
   Storage bucket is also created (for the GCS-FUSE fallback path, unused
   while the PVC is enabled). There is **no database** (`database_type =
   NONE`) and **no initialization job** to wait on, so first deploys are
   dominated by the image build and pod scheduling — typically **10–20
   minutes**.

3. Connect to the cluster and discover the namespace with name-agnostic
   filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep netdata | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all,pvc -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and its PVC is bound:

   ```bash
   kubectl get pods,pvc -n "$NS"
   ```

2. Confirm the service is healthy. Netdata exposes an info endpoint that
   responds only once the agent has initialised. Because `service_type`
   defaults to `ClusterIP`, reach it via `kubectl exec` or a port-forward
   rather than an external IP:

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n "$NS" "$POD" -- wget -qO- http://127.0.0.1:19999/api/v1/info

   # or, to browse the dashboard from your machine:
   kubectl port-forward -n "$NS" svc/"$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')" 19999:19999
   # then open http://127.0.0.1:19999
   ```

3. Netdata has **no first-run wizard and no admin-account creation step** —
   the dashboard is fully functional as soon as the pod is Ready. If you set
   `service_type = LoadBalancer` (or configured a custom domain) to expose it
   externally, remember the dashboard itself has **no built-in
   authentication**:

   ```bash
   kubectl get svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```
   If exposed externally, enable `enable_admin_password` and layer an
   authenticating reverse proxy or IAP in front — the generated secret does
   not gate Netdata's own dashboard by itself.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pods, and the PVC:

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Do not scale beyond one replica.** `min_instance_count` and
   `max_instance_count` both default to `1` — Netdata's dbengine metrics
   store is written by a single process against one PVC; scaling out risks
   file corruption or lock contention, not a shared dashboard. Leave these at
   `1` on the deployment details page.

3. **Update the application version** by changing `application_version` in
   the RAD platform and applying it via **Update**. `latest` resolves to a
   pinned known-good tag (`v2.2.6`) at build time via the app-specific
   `NETDATA_VERSION` build argument — set an explicit tag to track a
   different release; a rolling update replaces the StatefulSet's pod.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~netdata"
   kubectl get jobs -n "$NS"          # empty by default — Netdata has no init/migration jobs
   ```

5. **Watch the PVC's SSD quota footprint.** The default
   `stateful_pvc_storage_class` is `standard-rwo` (SSD), which draws the
   tight regional `SSD_TOTAL_GB` quota. If you are running Netdata alongside
   several other stateful modules and see a pod stuck `Pending` with `Quota
   'SSD_TOTAL_GB' exceeded`, redeploy with `-var
   stateful_pvc_storage_class=standard` (HDD) — Netdata's write pattern does
   not need SSD IOPS. Scaling the workload to zero replicas frees CPU/memory
   but **keeps the PVC**; only deleting it reclaims the quota.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU
   and memory utilisation, restart counts, and PVC usage. The module can
   provision an **uptime check** targeting `/api/v1/info` (disabled by
   default, and only useful once the Service is publicly reachable); review
   Monitoring → Uptime checks and Alerting → Policies if enabled.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Netdata releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The liveness
  and startup probes both target `/api/v1/info` (startup: 15s initial delay,
  10 retries).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pod stuck `Pending` with a PVC quota error:** confirm whether
  `SSD_TOTAL_GB` is exhausted (see Task 3, item 5) and switch
  `stateful_pvc_storage_class` to `standard` if so.
- **Metrics corrupted or lost:** confirm `stateful_pvc_enabled` is still
  `true`. Disabling it falls back to a GCS FUSE mount, which is **not**
  block-device-safe for Netdata's dbengine files and can corrupt the metrics
  database — this is a deliberate design constraint, not a transient bug.
- **Dashboard unexpectedly public:** re-check `service_type` and any
  `application_domains` configuration — the module default (`ClusterIP`) is
  internal-only, so external reachability only happens if you explicitly
  changed it. If you did, and the dashboard is exposed with no auth layer,
  enable `enable_admin_password` plus a reverse proxy or IAP.
- **Image pull / build errors:** confirm the image exists in Artifact
  Registry and the node service account can pull it; check Cloud Build
  history if `application_version` was pinned to a nonexistent upstream tag.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the SSD-quota tradeoff and the
PVC-vs-GCS-FUSE persistence constraint).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, the PVC (and with it, all accumulated monitoring history), the
GCS fallback bucket, any Secret Manager secret, and Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, GKE cluster, shared registry)
are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds a pinned custom image and deploys a StatefulSet with a 20Gi SSD PVC — no database, no init job |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; dashboard is immediately usable (no admin setup); default `ClusterIP` keeps it internal |
| 3 — Operate | Manual | Inspect workload, keep single-replica scale, update version, manage secrets/storage, watch SSD quota |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and optional uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, PVC/quota, persistence-mode, and image issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the PVC and accumulated metrics history |
