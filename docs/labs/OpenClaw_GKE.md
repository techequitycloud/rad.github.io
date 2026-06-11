---
title: "OpenClaw on GKE Autopilot \u2014 Lab Guide"
---

# OpenClaw on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenClaw_GKE)**

## Overview

**Estimated time:** 45–90 minutes

OpenClaw is a multi-tenant AI agent gateway for running isolated, persistent AI assistants
backed by Anthropic models, with dedicated GCS-Fuse workspaces and optional Telegram or
Slack channel integration. This lab takes you through the full operational lifecycle of the
**OpenClaw on GKE Autopilot** module on Google Cloud: deploy it, access and verify it, run
it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
OpenClaw product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenClaw_GKE) — this
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

1. Click **Deploy** in the RAD platform top navigation, open **OpenClaw (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs.
   An Anthropic API key is required on the first deploy — set it in the corresponding
   input field. Configure only what else you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenClaw_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform builds a custom container image (layering `entrypoint.sh` onto the
   upstream OpenClaw image), creates a GCS workspace bucket mounted at `/data` via the
   GCS Fuse CSI driver, stores the Anthropic API key and gateway token in Secret Manager,
   and deploys the Kubernetes workload. OpenClaw requires no Cloud SQL or init job — agent
   state lives entirely on GCS. First deploys take roughly **15–25 minutes** (Cloud Build
   dominates; GKE node provisioning adds time for new clusters).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep openclaw | head -1 | cut -d/ -f2)
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

   If `service_type` is `ClusterIP` (internal only), use port-forward instead:

   ```bash
   kubectl port-forward svc/$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}') \
     8080:8080 -n "$NS"
   # Access at http://localhost:8080
   ```

2. Confirm the service is healthy:

   ```bash
   curl -s "http://${EXTERNAL_IP}/health"   # expect {"status":"ok"}
   ```

3. Retrieve the gateway token from Secret Manager to authenticate API calls:

   ```bash
   GW_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~openclaw~gateway-token" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$GW_SECRET" --project="$PROJECT"
   ```

   The gateway token is the credential used by OpenClaw clients and integrations. The
   Anthropic API key can similarly be retrieved from its Secret Manager secret if needed
   (filter on `~openclaw~anthropic-api-key`).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the horizontal autoscaler:

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply). Note
   that OpenClaw is stateful; the Service uses `ClientIP` session affinity so that
   WebSocket connections are consistently routed to the same pod.

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image builds and a rolling update replaces the pods.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~openclaw"
   kubectl get jobs,cronjobs -n "$NS"   # any scheduled backup jobs
   ```

5. **Inspect the GCS workspace** that backs all agent state, and confirm it is mounted
   inside the pod:

   ```bash
   BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~openclaw~storage" --format="value(name)" --limit=1)
   gcloud storage ls "gs://${BUCKET}/"
   kubectl exec -n "$NS" \
     deploy/$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}') \
     -- ls /data
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
   utilisation, restart counts, and request metrics. When the uptime check is enabled,
   review Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with OpenClaw releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup probe
  targets `GET /health` on port 8080 and allows roughly 3 minutes for GCS Fuse mount
  and Node.js startup (36 × 5 s attempts).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **GCS Fuse mount failure:** confirm the workspace bucket exists and that the pod's
  Workload Identity service account has Storage Object Admin on it.
- **Anthropic API errors (401):** confirm the `anthropic-api-key` secret has a valid
  version materialised in the namespace. Retrieve and verify it via Secret Manager.
- **Gateway token errors:** if clients receive auth failures after a secret rotation,
  the pods must be recycled (rolling restart) to pick up the new token value.
- **Skills repository clone failure:** an unreachable or non-existent `skills_repo_url`
  / `skills_repo_ref` puts the pod into CrashLoopBackOff. Check logs for `skill-library`
  entries and correct the URL/ref in the RAD platform.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource or
  quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload and
namespace, GCS workspace bucket, Secret Manager secrets, and Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, GKE cluster, shared registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the image, provisions the GCS workspace, stores secrets, and deploys the GKE workload |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; gateway token retrieved |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage, inspect GCS workspace |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, GCS Fuse, Anthropic API, gateway token, skills-sync, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
