---
title: "Elasticsearch on GKE Autopilot \u2014 Lab Guide"
---

# Elasticsearch on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Elasticsearch_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Elasticsearch is an open-source distributed search and analytics engine commonly used for
full-text search, vector (k-NN) search, log analytics, and real-time observability. This
lab takes you through the full operational lifecycle of the **Elasticsearch on GKE
Autopilot** module on Google Cloud: deploy it, access and verify it, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Elasticsearch product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Elasticsearch_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect, scale, update, and manage the StatefulSet and PVC.
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

1. Click **Deploy** in the RAD platform top navigation, open **Elasticsearch (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Elasticsearch_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform mirrors the official Elasticsearch image into Artifact Registry, deploys a
   StatefulSet in the GKE Autopilot cluster, provisions a PersistentVolumeClaim (SSD) for
   durable index storage, and exposes the HTTP API through a LoadBalancer Service on port
   9200. There is no Cloud SQL database and no initialisation job — Elasticsearch
   bootstraps itself on first start. First deploys typically take **10–20 minutes** (GKE
   Autopilot must provision a node and attach the PVC before the container starts).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep elasticsearch | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the StatefulSet pod and PVC are healthy and retrieve the external IP:

   ```bash
   kubectl get statefulset,pods,pvc,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "Elasticsearch endpoint: http://${EXTERNAL_IP}:9200"
   ```

2. Verify the cluster is up and healthy via the Elasticsearch REST API (port 9200):

   ```bash
   curl -s "http://${EXTERNAL_IP}:9200/_cluster/health?pretty"
   ```

   A `"status": "green"` or `"status": "yellow"` response confirms Elasticsearch is
   running. Yellow is normal for a single-node cluster with indices that have replicas
   configured (replicas cannot be assigned on a single node).

3. Note the `elasticsearch_endpoint` output from the deployment's **Outputs** tab —
   this URL is the value to pass to the `elasticsearch_hosts` variable when deploying
   RAGFlow or another application that consumes this cluster.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pods, the horizontal autoscaler (if enabled),
   and the persistent volume:

   ```bash
   kubectl get statefulset,pods,hpa,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply). Note that
   Elasticsearch is deployed in single-node mode; consult the Configuration Guide before
   increasing the replica count.

3. **Update the application version** by changing the version input via **Update** on the deployment details page; the image is re-mirrored from the Elastic registry and a rolling update
   replaces the pod. Review the Elasticsearch migration guide for any index compatibility
   steps before a major version upgrade.

4. **Manage secrets and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~elasticsearch"
   kubectl get jobs -n "$NS"     # any optional initialization jobs
   ```

5. **Inspect the persistent volume** — all indexed data lives in this PVC:

   ```bash
   kubectl describe pvc -n "$NS"
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n "$NS" "$POD" -- df -h /usr/share/elasticsearch/data
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" \
     "$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and memory
   utilisation, restart counts, and PVC disk usage. The module also provisions an
   **uptime check** when enabled; review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Elasticsearch releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **PVC not Bound / pod stuck in Pending:** confirm the StorageClass exists and Autopilot
  has provisioned a node with enough CPU and memory for the pod's resource requests.
  ```bash
  kubectl describe pvc -n "$NS"
  kubectl get events -n "$NS" --sort-by='.lastTimestamp'
  ```
- **Startup probe failures:** Elasticsearch needs generous time on a cold node (JVM init
  + shard recovery). The startup probe allows up to 60 attempts. If it still times out,
  check that `es_java_heap` is at most half of `memory_limit` — oversized heap triggers
  OOM kills before the probe can succeed.
- **`/_cluster/health` returns 401:** X-Pack security is enabled. The probe type should
  be `TCP` in this mode — update the probe config and apply it via **Update** in the RAD platform.
- **Data lost after pod restart:** the PVC was not attached (check `stateful_pvc_enabled =
  true`) or `stateful_pvc_mount_path` does not match `path.data`.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource or
  quota issues, and confirm the LoadBalancer Service has been assigned an external IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes StatefulSet and
namespace, the PersistentVolumeClaim and its underlying disk (all indexed data is
permanently deleted), Secret Manager secrets, and the mirrored Artifact Registry image.
Resources owned by **Services_GCP** (the VPC, GKE cluster, shared registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module mirrors the image, deploys the GKE StatefulSet, provisions the PVC, and exposes port 9200 |
| 2 — Access & verify | Manual | Connect to the cluster; confirm health via `/_cluster/health`; note the endpoint for RAGFlow |
| 3 — Operate | Manual | Inspect StatefulSet/PVC, scale, update version, manage secrets and jobs |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, PVC, startup probe, X-Pack, data persistence, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources including indexed data |
