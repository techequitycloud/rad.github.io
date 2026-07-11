---
title: "N8N_AI on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy N8N_AI on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# N8N_AI on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/N8N_AI_GKE)**

## Overview

**Estimated time:** 45–90 minutes

n8n AI is an open-source workflow automation platform extended with integrated AI capabilities.
Alongside the core n8n workload it deploys two companion Kubernetes Deployments — **Qdrant** (a
vector database for embeddings and semantic search) and **Ollama** (a local LLM inference
server) — all running in the same namespace with ClusterIP-only services, enabling AI agent
workflows, RAG pipelines, and intelligent chatbots on your own infrastructure with no external
AI API dependencies. This lab takes you through the full operational lifecycle of the **N8N_AI
on GKE Autopilot** module on Google Cloud: deploy it, access and verify it, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on n8n
product features. For the complete list of provisioned services and every configuration input
(organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/N8N_AI_GKE) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running n8n, Qdrant, and Ollama workloads.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot cluster,
  Cloud SQL, Artifact Registry, and shared service accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **N8N AI (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs. Configure
   only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/N8N_AI_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys n8n, Qdrant, and Ollama as Kubernetes Deployments into the GKE
   Autopilot cluster, provisions a Cloud SQL (PostgreSQL) database with its Secret Manager
   secrets, Filestore NFS, a GCS bucket for AI data persistence, and runs a one-shot
   database-initialisation job. First deploys take roughly **20–35 minutes** (Cloud SQL
   creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep n8nai | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm all workloads are running and find the external address:

   ```bash
   kubectl get pods,svc,deploy -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm n8n is healthy (the startup probe targets `GET /` on port 5678):

   ```bash
   curl -s "http://${EXTERNAL_IP}:5678/"
   ```

   A redirect or the n8n login page indicates a healthy service.

3. Confirm the in-cluster Qdrant and Ollama services are ready:

   ```bash
   # Qdrant should have a ClusterIP on port 6333; Ollama on port 11434
   kubectl get svc -n "$NS" | grep -E "qdrant|ollama"
   kubectl get pods -n "$NS" | grep -E "qdrant|ollama"
   ```

4. Open `http://${EXTERNAL_IP}:5678` in a browser. On first launch, n8n prompts you to
   create an owner account. The n8n encryption key is auto-generated and stored in Secret
   Manager — back it up before destroying the module, as all saved credentials are
   encrypted with it.

   ```bash
   ENC_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~n8nai AND name~encryption" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ENC_SECRET" --project="$PROJECT"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployments, pods, HPA (n8n), and persistent volumes:

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

   Qdrant and Ollama run as fixed single-replica Deployments alongside n8n, which is
   governed by HPA.

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page — the
   module owns the workload spec, so scaling is a configuration change, not a manual
   `kubectl scale` (a manual edit would be reverted on the next apply).

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds and a rolling update replaces the pods.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~n8nai"
   kubectl get jobs,cronjobs -n "$NS"   # db-init and any scheduled jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=n8n_user --database=n8n_db --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   # n8n workload logs
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -l app=n8nai -o jsonpath='{.items[0].metadata.name}')" --tail=50

   # Qdrant logs
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" | grep qdrant | awk '{print $1}')" --tail=30

   # Ollama logs
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" | grep ollama | awk '{print $1}')" --tail=30
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and memory
   utilisation, restart counts, and HPA scaling events for n8n. The module provisions an
   **uptime check** (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with n8n releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs for all three workloads:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the DB
  password secret materialised into the namespace, and the `db-init` job completed.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Qdrant or Ollama unreachable from n8n:** confirm the companion pods are Running and
  that `QDRANT_URL` / `OLLAMA_HOST` are injected into the n8n pods.
  ```bash
  kubectl describe pod -n "$NS" -l app=n8nai | grep -E "QDRANT_URL|OLLAMA_HOST"
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource or
  quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node service
  account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific gotchas,
including the critical `N8N_ENCRYPTION_KEY` and `enable_redis` notes.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workloads and
namespace (n8n, Qdrant, Ollama), Cloud SQL database, Secret Manager secrets, GCS buckets,
Filestore NFS, and Artifact Registry images. Resources owned by **Services_GCP** (the VPC,
GKE cluster, shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys n8n, Qdrant, and Ollama GKE workloads, Cloud SQL, secrets, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; all pods running; n8n account created; encryption key backed up |
| 3 — Operate | Manual | Inspect workloads, HPA, scale, update version, manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, AI companion, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
