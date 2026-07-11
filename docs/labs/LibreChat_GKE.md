---
title: "LibreChat on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy LibreChat on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# LibreChat on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/LibreChat_GKE)**

## Overview

**Estimated time:** 45–90 minutes

LibreChat is an open-source AI chat interface that provides a unified experience across 20+
LLM providers including OpenAI, Anthropic, Google Gemini, and Ollama. This lab takes you
through the full operational lifecycle of the **LibreChat on GKE Autopilot** module on
Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
LibreChat product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/LibreChat_GKE) — this
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

1. Click **Deploy** in the RAD platform top navigation, open **LibreChat (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/LibreChat_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, mirrors the LibreChat
   container image to Artifact Registry, injects an in-namespace MongoDB sidecar service
   (when no external `mongodb_uri` is supplied), generates cryptographic secrets in Secret
   Manager, and provisions a GCS uploads bucket. First deploys take roughly **20–35
   minutes** (GKE Autopilot node provisioning and image mirroring dominate).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep librechat | head -1 | cut -d/ -f2)
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
   curl -s -o /dev/null -w "%{http_code}" "http://${EXTERNAL_IP}/"
   # expect 200
   ```

   LibreChat's root path (`/`) returns HTTP 200 once the application is fully initialised
   and connected to MongoDB. If you receive a non-200 response, the pods may still be
   starting — wait for all pods to reach `Running 1/1` before diagnosing further.

2. Open `http://${EXTERNAL_IP}` in a browser. The LibreChat login and registration page
   appears. Register the initial admin account. After registration, navigate back to the
   RAD platform and set `allow_registration = false`, then apply it via **Update** to prevent unauthorised
   self-sign-ups on public deployments.

3. Confirm the auto-generated application secrets are in place:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~librechat"
   ```

   You should see secrets for `creds-key`, `creds-iv`, `jwt-secret`, `jwt-refresh-secret`,
   and `mongo-uri`. These are injected at runtime via the Secret Store CSI driver — they
   never appear as plaintext in pod specs.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and (if enabled) the horizontal autoscaler
   and persistent volumes:

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page — the
   module owns the workload spec, so scaling is a configuration change, not a manual
   `kubectl scale` (a manual edit would be reverted on the next apply). Enable Redis when
   running more than one replica to maintain session consistency across pods.

3. **Update the application version** by changing the version input via **Update** on the deployment details page; a new image is mirrored and a rolling update replaces the pods.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~librechat"

   # Inspect the GCS uploads bucket
   UPLOADS_BUCKET=$(gcloud storage buckets list --project="$PROJECT" \
     --filter="name~librechat" --format="value(name)" --limit=1)
   gcloud storage ls "gs://${UPLOADS_BUCKET}/"

   kubectl get jobs -n "$NS"          # any custom initialization jobs
   ```

5. **Inject AI provider API keys** using `secret_environment_variables` (not plain
   `environment_variables`) so they are never exposed in pod specs or audit logs. Create
   the secrets in Secret Manager first, then reference them by name in the RAD platform and
   apply it via **Update**.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and memory
   utilisation, restart counts, and request metrics. The module also provisions an
   **uptime check** (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with LibreChat releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **MongoDB connection errors:** confirm the in-namespace MongoDB sidecar service is
  running (or that the external `mongodb_uri` is reachable), and that the `mongo-uri`
  secret has a valid version materialised in the namespace.
  ```bash
  kubectl get svc -n "$NS" | grep mongo
  gcloud secrets list --project="$PROJECT" --filter="name~librechat AND name~mongo-uri"
  ```
- **Startup probe failures:** LibreChat cold starts can take 15–30 seconds while the
  MongoDB connection is established and assets load. The startup probe has a generous
  failure threshold — confirm with `kubectl describe pod` that the probe is counting
  failures but has not yet exceeded the threshold before diagnosing further.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource or
  quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload and
namespace, Secret Manager secrets, GCS uploads bucket, and Artifact Registry images. The
**Firestore database is intentionally retained** (ABANDON policy) to prevent data loss;
delete it manually via the GCP Console if it is no longer needed. Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared registry) are managed separately and are
not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, MongoDB sidecar, secrets, and GCS uploads bucket |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; register initial admin account |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, MongoDB, startup-probe, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources; Firestore database is retained |
