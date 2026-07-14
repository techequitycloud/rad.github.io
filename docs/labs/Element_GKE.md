---
title: "Element on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Element on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Element on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Element_GKE)**

## Overview

**Estimated time:** 30–60 minutes

Element is the leading open-source Matrix web client — a self-hosted,
end-to-end-encrypted messaging app that runs as a static single-page application and
connects to a Matrix homeserver you specify. This lab takes you through the full
operational lifecycle of the **Element on GKE Autopilot** module on Google Cloud:
deploy it, point it at a homeserver, verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Element product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Element_GKE) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Point Element at a Matrix homeserver and verify the running workload.
- Perform day-2 operations — inspect pods, scale replicas, update the version, and
  re-point the homeserver.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Artifact Registry, and shared service accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** authenticated: `gcloud auth login`,
  `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.
- A **Matrix homeserver** to connect to — either the public `matrix.org` (the
  default) or your own Synapse/Dendrite instance.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<namespace>"       # from the deployment Outputs
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Element (GKE)**, set `project_id`, and set
   `homeserver_url` / `homeserver_name` to your Matrix homeserver (or leave them blank
   to use the public `matrix.org`). Review the remaining inputs — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Element_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform builds the custom Element image (a thin layer over
   `vectorim/element-web` that generates `config.json` at start-up), pushes it to
   Artifact Registry, and provisions the GKE Deployment plus an external LoadBalancer
   Service. There is **no database, no secret, and no storage bucket** to create.
   First deploys take roughly **10–20 minutes** (Autopilot node provisioning and
   LoadBalancer IP assignment dominate).

3. When it completes, get cluster credentials and discover the workload:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"
   kubectl get pods,svc -n "$NAMESPACE"
   EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is serving and its runtime `config.json` points at your homeserver:

   ```bash
   kubectl exec -n "$NAMESPACE" deploy/element -- env | grep HOMESERVER
   curl -s "http://$EXTERNAL_IP/config.json" | grep -E 'base_url|server_name'
   curl -s -o /dev/null -w '%{http_code}\n' "http://$EXTERNAL_IP/"       # expect 200
   ```

2. Open `http://$EXTERNAL_IP` (or your custom domain) in a browser. Element loads its
   sign-in screen showing the configured homeserver. Log in with an account on that
   homeserver — authentication happens **between your browser and the homeserver**,
   not in the pod.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect pods, the Service, and the autoscaler:**

   ```bash
   kubectl get pods,svc,hpa -n "$NAMESPACE"
   kubectl describe deploy/element -n "$NAMESPACE"
   kubectl logs -n "$NAMESPACE" deploy/element --tail=100
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** — the
   module owns the workload spec, so scaling is a configuration change, not a manual
   `kubectl scale` (a manual edit would be reverted on the next apply). Element is
   stateless with no session affinity, so replicas are freely interchangeable; GKE
   keeps a minimum of 1.

3. **Re-point the homeserver** by changing `homeserver_url` / `homeserver_name` in the
   RAD platform and clicking **Update** — the entrypoint rewrites `config.json` on the
   new pods. No image rebuild is required.

4. **Update the application version** by changing the version input and applying it via
   **Update**; a new image builds and, because `imagePullPolicy=Always` is set for the
   reused custom tag, the rollout pulls the fresh layers.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — pod stdout/stderr (nginx access/error), from the CLI or the Logs
   Explorer:

   ```bash
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project="$PROJECT" --limit=50
   ```

2. **Monitoring** — open the GKE workload dashboard and review pod count, CPU / memory
   utilisation, and restart counts. Review any provisioned uptime check under
   Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Element releases.

- **Pod not Ready / CrashLoopBackOff:** inspect the pod events and nginx logs. The
  startup probe targets `/`, which nginx answers as soon as it binds port 80.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app=element
  kubectl logs -n "$NAMESPACE" deploy/element --tail=100
  ```
- **Login screen shows the wrong homeserver:** the entrypoint writes `config.json`
  from `HOMESERVER_URL` / `HOMESERVER_NAME`; confirm the env on the running pod (Task
  2, step 1) and re-point via **Update**.
- **Users can load the UI but cannot log in:** the homeserver is unreachable or
  incorrect — verify it serves the Matrix client-server API
  (`curl -s <homeserver_url>/_matrix/client/versions`).
- **No external IP assigned:** confirm the LoadBalancer Service and that a static IP
  is reserved:
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project="$PROJECT"
  ```
- **Rebuild runs stale:** verify the pod's image digest matches the freshly built one;
  `imagePullPolicy=Always` should pull the new layers on rollout.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the binary-unit requirement for `quota_memory_*`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can no
longer manage it, use **Purge** instead — it removes the deployment from RAD's records
**without** destroying the cloud resources. This removes everything the module created
— the GKE Deployment, Service, LoadBalancer IP, and Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, cluster, registry) are managed
separately and are not removed here.

Because Element is stateless, there is no database, secret, PVC, or storage bucket to
clean up — teardown is clean and fast.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the Element image and provisions the GKE Deployment + LoadBalancer (no DB/secret/storage) |
| 2 — Access & verify | Manual | `config.json` points at your homeserver; log in via the browser-to-homeserver flow |
| 3 — Operate | Manual | Inspect pods, scale replicas, re-point the homeserver, update the version |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, homeserver-config, login, LoadBalancer, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
