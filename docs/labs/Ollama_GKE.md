---
title: "Ollama on GKE Autopilot \u2014 Lab Guide"
---

# Ollama on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ollama_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Ollama is an open-source LLM inference server that serves large language models — Llama,
Mistral, Gemma, Phi, and others — through a REST API. This lab takes you through the full
operational lifecycle of the **Ollama on GKE Autopilot** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it
down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on Ollama
product features or model-specific workflows. For the complete list of provisioned services
and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ollama_GKE) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect, scale, update, and manage model storage and jobs.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot cluster,
  Artifact Registry, and shared service accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Ollama (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs. Configure
   only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Ollama_GKE) documents every
   input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the Ollama workload into the GKE Autopilot cluster, provisions a GCS
   bucket for model weight storage (mounted via GCS Fuse CSI at `/mnt/gcs`), builds or
   mirrors the container image, and optionally runs a one-shot model-pull Kubernetes Job if
   `default_model` is set. There is no database.
   First deploys typically take **15–30 minutes** (longer if a large model is being pulled).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep ollama | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

Ollama is deployed with a `ClusterIP` service by default — the API is reachable from within
the cluster but not from the public internet. To reach it from your local machine, use
`kubectl port-forward`:

```bash
SVC=$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')
kubectl port-forward "svc/${SVC}" 11434:11434 -n "$NS"
```

Leave the port-forward running in a separate terminal, then confirm the service is
responding:

```bash
curl http://localhost:11434   # expect: Ollama is running
```

Ollama has no admin credentials and no Secret Manager secret to retrieve — the API is
unauthenticated within the cluster by design.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, HPA, and (if enabled) persistent volumes:

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a manual
   `kubectl scale` (a manual edit would be reverted on the next apply).

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image mirrors and a rolling update replaces the pods.

4. **Inspect the model storage bucket and Kubernetes jobs:**

   ```bash
   MODELS_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~ollama" --format="value(name)" --limit=1)
   gcloud storage ls "gs://${MODELS_BUCKET}/ollama/models/"
   kubectl get jobs -n "$NS"   # model-pull job if default_model was configured
   ```

5. Ollama has no SQL database — there is no Cloud SQL instance and no `db-init` job to
   manage.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and memory
   utilisation, restart counts, and HPA scaling events. Memory utilisation stays elevated
   while model weights are loaded in memory. The module also provisions an **uptime check**
   (when enabled); review Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Ollama releases.

- **Pod not Ready / CrashLoopBackOff:** the startup probe targets `GET /` with a generous
  failure threshold to accommodate GCS Fuse model loading (30–120 s). Inspect events and
  logs:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **GCS Fuse errors / model not found:** confirm the models bucket exists, the pod's
  Workload Identity service account has Storage Object Viewer on it, and the GCS Fuse CSI
  volume is correctly mounted at `/mnt/gcs`.
- **OOM / container restart loop:** Ollama requires at least 2× the quantised model weight
  size in memory. Increase `container_resources.memory_limit` in the RAD platform and apply it via **Update**.
- **Model-pull job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<model-pull-job>
  ```
- **Pending pod / scheduling stall:** check `kubectl describe pod` events for resource or
  quota issues; GKE Autopilot may need a few minutes to provision the required node capacity.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node service
  account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload and
namespace, GCS models bucket (and all downloaded model weights), Artifact Registry images,
and Cloud Monitoring uptime checks. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, GCS model storage, and optional model-pull job |
| 2 — Access & verify | Manual | Port-forward to cluster-internal service; health check passes at `/` |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage model storage and jobs |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, GCS Fuse, OOM, model-pull job, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources including model weights |
