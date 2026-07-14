---
title: "LobeChat on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy LobeChat on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# LobeChat on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/LobeChat_GKE)**

## Overview

**Estimated time:** 20–40 minutes

An open-source, stateless LLM chat interface with support for multiple AI providers. This lab takes you through the full operational lifecycle of
the **LobeChat on GKE Autopilot** module on Google Cloud: deploy it, access and
verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
LobeChat product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/LobeChat_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

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

1. Click **Deploy** in the RAD platform top navigation, open **LobeChat (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/LobeChat_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, builds the container image, and creates the Kubernetes namespace and deployment. No database or initialisation job is required. First deploys take roughly
   **10–20 minutes** (image build dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep lobechat | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. **Health check** — confirm the pods are running and the service is responding:

   ```bash
   kubectl get pods -n "$NS"
   # Retrieve the external IP or ingress hostname
   kubectl get svc,gateway,httproute -n "$NS"
   ```

   Once you have the service endpoint or Gateway address, confirm HTTP **200**:

   ```bash
   curl -s -o /dev/null -w "%{http_code}" "http://<ENDPOINT>/"
   ```

   Expect HTTP **200**. The response body is the LobeChat Next.js chat UI.

2. **Open the application** — navigate to the service endpoint in your browser. LobeChat is a stateless application; no credentials are required to access the UI. AI provider API keys (OpenAI, Anthropic, etc.) are supplied via environment variable inputs at deploy time and are stored in Secret Manager — you configure which providers to enable in the Configuration Guide inputs. Confirm the chat interface loads and the configured AI provider(s) appear in the model selector.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment or StatefulSet, pods, and (if enabled) the
   horizontal autoscaler and persistent volumes:

   ```bash
   kubectl get deploy,statefulset,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply).

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds and a rolling update replaces the pods.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~lobechat"
   gcloud storage buckets list --project="$PROJECT" --filter="name~lobechat"
   kubectl get jobs,cronjobs -n "$NS"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and memory
   utilisation, restart counts, and request metrics. When enabled, review
   Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with LobeChat releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. Check that all required AI provider API key secrets are correctly populated in the Kubernetes secret.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Pending pod / resource constraints:** check `kubectl describe pod` events for
  Autopilot resource or quota issues.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Secret Manager secrets, and Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE cluster, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | GKE workload deployed; namespace and image created |
| 2 — Access & verify | Manual | Chat UI accessible at cluster endpoint; AI provider(s) confirmed in model selector |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics |
| 5 — Troubleshoot | Manual | Diagnose pod failures, CrashLoopBackOff, image pull errors |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
