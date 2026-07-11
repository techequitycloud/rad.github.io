---
title: "Qdrant on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Qdrant on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Qdrant on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Qdrant_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Qdrant is a high-performance vector database and similarity search engine built
for AI workloads — RAG pipelines, recommendation systems, semantic search, and
embeddings storage. This lab takes you through the full operational lifecycle of
the **Qdrant on GKE Autopilot** module on Google Cloud: deploy it, access and
verify it, run it day-to-day, observe it, diagnose common problems, and tear it
down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Qdrant product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Qdrant_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

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

1. Click **Deploy** in the RAD platform top navigation, open **Qdrant (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Qdrant_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions
   persistent storage (a StatefulSet PVC when `stateful_pvc_enabled = true`, or a
   GCS FUSE-mounted Cloud Storage bucket otherwise), builds the container image,
   and stores an API key in Secret Manager when `enable_api_key = true`. Qdrant
   has no SQL database and no initialization job. First deploys typically take
   **10–20 minutes** (image build and node provisioning dominate).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep qdrant | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running. Qdrant exposes two distinct health endpoints
   — `/readyz` (reports ready once all collections are loaded) and `/livez`
   (always responds while the process is alive). Port-forward the service to
   reach them from your shell:

   ```bash
   kubectl get pods,svc -n "$NS"
   SVC=$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl port-forward "svc/$SVC" 6333:6333 -n "$NS" &
   sleep 3
   curl -s http://localhost:6333/readyz    # expect {"result":true,"status":"ok",...}
   curl -s http://localhost:6333/livez     # expect {"result":true,"status":"ok",...}
   ```

   If the service type is `LoadBalancer`, use the external IP directly instead:

   ```bash
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   curl -s "http://${EXTERNAL_IP}:6333/readyz"
   ```

2. If `enable_api_key = true`, retrieve the API key from Secret Manager before
   making authenticated requests:

   ```bash
   API_KEY_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~qdrant AND name~api-key" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$API_KEY_SECRET" --project="$PROJECT"
   ```

   Pass the retrieved value as the `api-key` header on all Qdrant REST calls.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — pods, HPA, and (if enabled) persistent volumes:

   ```bash
   kubectl get deploy,statefulset,pods,hpa,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs in the RAD platform and
   applying it via **Update** — the module owns the workload spec, so scaling is a configuration
   change, not a manual `kubectl scale` (a manual edit would be reverted on the
   next apply). Keep `max_instance_count = 1`; Qdrant is a single-writer store
   and multiple pods sharing the same PVC (RWO) or GCS bucket corrupt collections.

3. **Update the application version** by changing the version input in the RAD
   UI and applying it via **Update**; a new image builds and a rolling update replaces the pods.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~qdrant"
   kubectl get jobs,cronjobs -n "$NS"      # any scheduled snapshot or maintenance jobs
   ```

5. **Inspect storage** — confirm the PVC is bound or the GCS bucket exists:

   ```bash
   kubectl get pvc -n "$NS"
   kubectl exec -n "$NS" \
     "$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- ls /qdrant/storage
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" \
     "$(kubectl get pod -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. The module also
   provisions an **uptime check** (when enabled); review Monitoring → Uptime
   checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Qdrant releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Slow startup / `/readyz` returns 503:** Qdrant loads all collections from
  disk into memory on startup. Large collections can take tens of seconds to
  several minutes. The startup probe waits for `/readyz`; allow additional time
  before declaring the pod unhealthy.
- **PVC not bound / storage errors:** confirm the PVC provisioned successfully
  and the fsGroup is set correctly for write access:
  ```bash
  kubectl get pvc -n "$NS"
  kubectl describe pvc -n "$NS"
  ```
- **API key errors (401/403):** confirm `enable_api_key = true` was set at
  deploy time, the secret materialised into the namespace, and the `api-key`
  header is present on requests.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes
workload and namespace, PVC and underlying Persistent Disk (if used), Cloud
Storage bucket (if used), Secret Manager secrets, and Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, GKE cluster, shared registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, persistent storage, and optional API key secret |
| 2 — Access & verify | Manual | Connect to the cluster; health checks pass on `/readyz` and `/livez`; API key retrieved if enabled |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage/jobs |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, storage, API key, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
