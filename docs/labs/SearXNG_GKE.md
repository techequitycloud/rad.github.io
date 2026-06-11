---
title: "SearXNG on GKE Autopilot \u2014 Lab Guide"
---

# SearXNG on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/SearXNG_GKE)**

## Overview

**Estimated time:** 30–60 minutes

SearXNG is a privacy-respecting, self-hosted metasearch engine that aggregates
results from 70+ search services without tracking users or serving ads. This lab
takes you through the full operational lifecycle of the **SearXNG on GKE
Autopilot** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on SearXNG product features. For the complete list of provisioned services
and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/SearXNG_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

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

1. Click **Deploy** in the RAD platform top navigation, open **SearXNG (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/SearXNG_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, generates
   the `SEARXNG_SECRET` session key in Secret Manager (injected into pods via
   the CSI driver), and builds or mirrors the container image. Because SearXNG
   is fully stateless (no database, no init job), deploys complete in a few
   minutes once the cluster is ready.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep searxng | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/healthz"
   ```

   Expect HTTP `200`. SearXNG serves its built-in health endpoint at `/healthz`.
   Cold starts are fast (under 5 seconds) because there is no database connection
   or schema migration on startup. The GKE variant always keeps at least one pod
   running (`min_instance_count = 1`).

3. Open `http://${EXTERNAL_IP}` in a browser to reach the SearXNG search
   interface. No admin credential is required — SearXNG has no admin login.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the horizontal autoscaler:

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs in the RAD platform and
   applying it via **Update** — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply).

3. **Update the application version** by changing the version input in the RAD
   UI and applying it via **Update**; a new image builds and a rolling update replaces the pods.

4. **Manage secrets:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~searxng"
   ```

   The `SEARXNG_SECRET` is the auto-generated session key injected into pods at
   runtime via the Kubernetes Secret Store CSI driver. It is generated once and
   shared across all pod replicas. Rotating it invalidates all active user
   sessions — avoid rotation unless required.

5. **Inspect jobs** (SearXNG requires no init or scheduled jobs by default, but
   any cron jobs you configure appear here):

   ```bash
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

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and HPA scaling events. The module also
   provisions an **uptime check** (when enabled); review
   Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with SearXNG releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Empty search results / upstream engines unreachable:** SearXNG must reach
  external search engines over the internet. Confirm the cluster's outbound
  internet access is not blocked by firewall rules or VPC egress restrictions.
- **`SEARXNG_SECRET` not injected:** confirm the secret exists in Secret Manager
  and the pod's service account has `secretmanager.versions.access`. Check the
  CSI driver pod events if the volume mount fails.
  ```bash
  gcloud secrets list --project="$PROJECT" --filter="name~searxng"
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an assigned
  IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes
workload and namespace, Secret Manager secrets, and Artifact Registry images.
SearXNG is stateless so there is no database or persistent storage to remove.
Resources owned by **Services_GCP** (the VPC, GKE cluster, shared registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, generates SEARXNG_SECRET, mirrors image |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes at `/healthz`; search interface loads |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, egress, secret injection, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
