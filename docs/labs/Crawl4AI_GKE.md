---
title: "Crawl4AI on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Crawl4AI on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Crawl4AI on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Crawl4AI_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Crawl4AI is an open-source LLM-friendly web crawler and scraper designed for AI
teams building RAG pipelines, knowledge bases, and monitoring workflows. This lab
takes you through the full operational lifecycle of the **Crawl4AI on GKE
Autopilot** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Crawl4AI product features. For the complete list of provisioned services
and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Crawl4AI_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect, scale, update, and manage secrets.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Artifact Registry, and shared service accounts this module
  depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Crawl4AI (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Crawl4AI_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, mirrors the
   container image into Artifact Registry, provisions a Horizontal Pod
   Autoscaler, and exposes the service via a LoadBalancer. Crawl4AI has no
   external database and no initialisation job — first deploys complete faster
   than database-backed modules.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep crawl4ai | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address. On first pod
   start, supervisord must boot Redis then Gunicorn — allow up to 60 seconds
   before the health check responds:

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   curl -s "http://${EXTERNAL_IP}:11235/health"   # expect {"status":"ok"}
   ```

2. Crawl4AI has no admin login and no auto-generated credentials. The service is
   ready when the health check above returns `{"status":"ok"}`. An interactive
   playground is available at `http://${EXTERNAL_IP}:11235/playground` in a
   browser — no sign-in is required by default.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, HPA, and (if enabled) persistent
   volumes:

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs in the RAD platform and
   applying it via **Update** — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply).

3. **Update the application version** by changing the version input in the RAD
   UI and applying it via **Update**; a new image is mirrored and a rolling update replaces the
   pods.

4. **Manage secrets** (LLM API keys and the optional JWT secret are stored in
   Secret Manager if supplied at deploy time):

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~crawl4ai"
   ```

5. Crawl4AI is **fully stateless** — it has no database, no backup jobs, and no
   persistent storage by default. Task results live in the embedded in-pod Redis
   and are lost on pod restart. No database session is needed.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and HPA scaling events. The module can
   also provision an **uptime check** (polling `/health`); when enabled, review
   Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Crawl4AI releases.

- **Pod not Ready / CrashLoopBackOff:** the startup probe hits `/health` after
  a 40-second initial delay to allow supervisord to boot Redis then Gunicorn.
  Inspect events and logs for startup errors:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **OOM / Chromium crashes:** Chromium requires at least 4 GiB per pod. Review
  logs for `OOMKilled` events and increase `container_resources.memory_limit`
  in the RAD platform.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an assigned
  IP (`kubectl get svc -n "$NS"`).
- **LLM extraction returns empty results:** check that any required LLM API keys
  were supplied via `secret_environment_variables` and that the secrets have
  materialised into the namespace.
  ```bash
  gcloud secrets list --project="$PROJECT" --filter="name~crawl4ai"
  kubectl get secrets -n "$NS"
  ```
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes
workload and namespace, Secret Manager secrets (if any were provisioned), and
Artifact Registry images. Crawl4AI provisions no database, so there is no Cloud
SQL instance to delete. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, mirrors image, provisions HPA and LoadBalancer |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes at `/health`; playground accessible |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod health, OOM, scheduling, LLM keys, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
