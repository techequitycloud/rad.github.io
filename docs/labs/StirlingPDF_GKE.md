---
title: "Stirling-PDF on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Stirling-PDF on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Stirling-PDF on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/StirlingPDF_GKE)**

## Overview

**Estimated time:** 30–60 minutes

Stirling-PDF is a self-hosted web PDF toolkit — merge, split, convert, OCR,
compress, watermark, sign, redact, and 50+ other PDF operations, all processed on
your own infrastructure so documents never touch a third-party service. This lab
takes you through the full operational lifecycle of the **Stirling-PDF on GKE
Autopilot** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Stirling-PDF product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/StirlingPDF_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect, scale, update the version, and gate access.
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

1. Click **Deploy** in the RAD platform top navigation, open **Stirling-PDF (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/StirlingPDF_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform mirrors the official `stirlingtools/stirling-pdf` image into Artifact
   Registry and deploys the workload into the GKE Autopilot cluster with an external
   LoadBalancer. There is **no database, no storage bucket, and no secret** to
   provision — Stirling-PDF is stateless — so first deploys are quick, typically
   **10–15 minutes** (image mirroring and LoadBalancer IP assignment dominate).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep stirlingpdf | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. Stirling-PDF exposes a public status endpoint that
   returns 200 only once the JVM and LibreOffice have fully initialised:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/api/v1/info/status"   # expect 200
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. With login disabled by default the
   toolkit is immediately usable — pick any tool (e.g. **Merge**), upload a couple of
   PDFs, and download the result. Because the instance is open, consider gating access
   before real use (Task 3, step 4).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, the horizontal autoscaler, and the
   PodDisruptionBudget:

   ```bash
   kubectl get deploy,pods,hpa,pdb -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply).
   Stirling-PDF is stateless, so raising `max_instance_count` is safe with no cache
   or session affinity required. GKE requires `min_instance_count ≥ 1`.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; the new image tag is mirrored and a rolling update
   replaces the pods — no migration step, because there is no schema.

4. **Gate access.** The default instance is open. To make it private, set
   `enable_login = true` (Stirling-PDF's built-in auth) and/or enable IAP on the
   Ingress, then **Update**. For a public instance, enable Cloud Armor and
   Redis-backed rate limiting (`enable_redis = true`) to throttle abuse.

5. **Tune for large documents** by raising `container_resources.memory_limit` and
   `timeout_seconds`, and cap uploads with `SYSTEM_MAXFILESIZE` via
   `environment_variables`.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. Watch memory during
   OCR/conversion — sustained pressure near the 2Gi limit is the signal to raise
   `container_resources.memory_limit`. The module can provision an **uptime check**
   (when enabled); review Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Stirling-PDF releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup probe
  targets `/api/v1/info/status` and allows up to ~70 seconds for the JVM and
  LibreOffice to warm up — do not shorten it, or the pod is killed before it is ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pod OOMKilled during a conversion:** raise `container_resources.memory_limit`
  (2Gi floor; heavy OCR/conversion may need 4Gi+). Check
  `kubectl describe pod` for `Reason: OOMKilled`.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.
- **Rollout wedged after an update:** a stateless Deployment uses RollingUpdate
  safely; if a pod is stuck, inspect its events and probe status.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including keeping the instance gated when it processes sensitive documents).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, and its Artifact Registry images. Because Stirling-PDF is stateless
there is no database, bucket, or secret to clean up. Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared registry) are managed separately and
are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module mirrors the image and deploys the stateless GKE workload (no DB, storage, or secrets) |
| 2 — Access & verify | Manual | Connect to the cluster; status endpoint returns 200; run a PDF operation in the UI |
| 3 — Operate | Manual | Inspect workload, scale, update version, gate access, tune for large files |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, OOM, scheduling, image-pull, and rollout issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
