---
title: "Dify on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Dify on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Dify on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Dify_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Dify is an open-source LLM application development platform for building
production-grade AI applications with a visual workflow builder, RAG pipeline,
agent framework, and multi-model management. This lab takes you through the full
operational lifecycle of the **Dify on GKE Autopilot** module on Google Cloud:
deploy it, access and verify it, run it day-to-day, observe it, diagnose common
problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Dify product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Dify_GKE) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workloads, including the web frontend.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Artifact Registry, Filestore NFS, and shared service accounts
  this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Dify (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Dify_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys two workloads into the GKE Autopilot cluster (the API+Celery
   pod and the Next.js web frontend), provisions a Cloud SQL (PostgreSQL 15 with
   pgvector) database with its Secret Manager secrets, a dedicated GCS storage bucket,
   Redis via the NFS server, builds the container image, and runs a one-shot
   database-initialisation job. First deploys take roughly **25–40 minutes** (Cloud SQL
   creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep dify | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workloads are running and find the external address:

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}' \
     | awk '{print $1}')
   echo "External IP: $EXTERNAL_IP"
   curl -s "http://${EXTERNAL_IP}/health"   # expect {"status":"ok"}
   ```

2. Dify does not store a pre-generated admin password in Secret Manager. On the first
   visit the application displays a **setup wizard** where you create the admin account.
   Open the web frontend address in a browser and complete the setup:

   ```bash
   echo "http://${EXTERNAL_IP}"
   ```

   Enter your admin email and a password when prompted. After completing setup, the Dify
   console opens. Dify's own product documentation covers the workflow builder, RAG
   pipeline, and LLM provider configuration.

3. Confirm both Deployments are present and the `SECRET_KEY` is stored in Secret Manager:

   ```bash
   kubectl get deployments -n "$NS"

   gcloud secrets list --project="$PROJECT" --filter="name~dify AND name~secret-key"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployments, pods, and (if enabled) the horizontal
   autoscaler and persistent volumes:

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply). Keep
   `min_instance_count` at 1 or higher so the embedded Celery worker maintains its
   Redis broker connection.

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds and a rolling update replaces the pods across both
   Deployments.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~dify"
   gcloud storage buckets list --project="$PROJECT" --filter="name~dify"
   kubectl get jobs -n "$NS"          # DB-init and any scheduled jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" \
     --filter="name~dify" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=dify_user --project="$PROJECT"
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
   utilisation, restart counts, and HPA scaling events. The module provisions an
   optional **uptime check** targeting `/health`; review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Dify releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The API container runs
  database migrations on startup, so allow the configured startup probe delay before
  expecting readiness.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the DB
  password secret materialised into the namespace, and the db-init job completed.
  Without the Cloud SQL Auth Proxy sidecar (`enable_cloudsql_volume = true`) the pod
  cannot reach the database at all.
- **Celery tasks not running / async failures:** Redis is required for all background
  processing. Confirm NFS is enabled and that the NFS volume mounted correctly in the
  pod (`kubectl describe pod` shows mount events).
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workloads and
namespace, Cloud SQL database, GCS storage bucket, Secret Manager secrets, and Artifact
Registry images. Resources owned by **Services_GCP** (the VPC, GKE cluster, Filestore
NFS, shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys two GKE workloads, Cloud SQL (PostgreSQL + pgvector), secrets, GCS bucket, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; complete the admin setup wizard |
| 3 — Operate | Manual | Inspect workloads, scale, update version, manage secrets/storage/jobs, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, Celery/Redis, init-job, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
