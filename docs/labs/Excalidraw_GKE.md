---
title: "Excalidraw on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Excalidraw on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Excalidraw on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Excalidraw_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Excalidraw is an open-source virtual whiteboard for sketching hand-drawn-style
diagrams, wireframes, and quick collaborative drawings. The self-hosted distribution is
a **static single-page application served by nginx** — there is no backend, database, or
user accounts. This lab takes you through the full operational lifecycle of the
**Excalidraw on GKE Autopilot** module on Google Cloud: deploy it, access and verify it,
run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Excalidraw product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Excalidraw_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect, scale, and update the deployment.
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

1. Click **Deploy** in the RAD platform top navigation, open **Excalidraw (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Excalidraw_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits
   are enabled) and click **Deploy**, which opens the deployment status page with
   real-time logs.

2. The platform builds a thin custom image (`FROM excalidraw/excalidraw`), mirrors it
   into Artifact Registry, and deploys the workload into the GKE Autopilot cluster as a
   plain `Deployment` behind a `LoadBalancer` Service. There is **no Cloud SQL instance,
   no Secret Manager secret, no GCS bucket, no NFS, and no Redis** — Excalidraw is a
   fully stateless static frontend, so this deploy is one of the fastest in the
   catalogue, typically **10–15 minutes** (dominated by the image build and LoadBalancer
   provisioning).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep excalidraw | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. nginx answers the root path with `200` as soon as a
   pod is Ready — there is no database or backend to wait on:

   ```bash
   curl -sI "http://${EXTERNAL_IP}/" | head -1     # expect: HTTP/1.1 200 OK
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. The whiteboard loads immediately — there
   is no login, no admin account, and no first-run setup. Draw something and use
   **Export** (menu → Export) to save a `.excalidraw`, PNG, or SVG file; this is the only
   persistence mechanism, since drawings otherwise live only in the browser's local
   storage.

4. Note that the live "shareable link" real-time collaboration feature is **not**
   available — it depends on a separate `excalidraw-room` WebSocket server that this
   module does not deploy. Single-user editing works fully out of the box.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the horizontal autoscaler:

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the max-instance input and clicking **Update** on the
   deployment details page — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be reverted on
   the next apply). `min_instance_count` is hardcoded to `1` in `excalidraw.tf`
   regardless of the input value — GKE has no scale-to-zero, so a resident pod always
   keeps the whiteboard reachable. Every pod is identical and stateless, so scaling out
   requires no session affinity or coordination.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds from a new `excalidraw/excalidraw`
   tag and a rolling update replaces the pods. Note that unlike some sibling modules,
   `latest` here does **not** resolve to a pinned known-good tag — it tracks Docker
   Hub's rolling `excalidraw/excalidraw:latest` tag directly, so pin an explicit version
   (e.g. `v1.11.86`) for a reproducible production deploy. Because there is no
   server-side state, upgrades and rollbacks are trivial and non-destructive.

4. **Confirm there is nothing else to manage:** unlike most modules, Excalidraw has no
   secrets, PVCs, or database to inspect:

   ```bash
   kubectl get secrets,pvc -n "$NS"                                            # no app secrets/PVCs
   gcloud secrets list --project="$PROJECT" --filter="name~excalidraw"          # (none)
   gcloud sql instances list --project="$PROJECT" --filter="name~excalidraw"    # (none)
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer (nginx access/error logs):

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and memory
   utilisation, restart counts, and request metrics. Because the app is a static file
   server, resource usage should be consistently low. The module can provision an
   **uptime check** (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Excalidraw releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The liveness probe
  targets the root `/`, which nginx should answer within a second or two — a
  persistently failing probe almost always means a container/image problem, not an app
  dependency (there is no database to wait on).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Startup probe never passes / wrong port:** confirm the pod's listening port matches
  the baked-in nginx port (`80`) — this is fixed in the image and should not be changed
  via `container_port`.
- **`build_and_push_application_image` fails with no Dockerfile / unbuilt image path:**
  confirm `container_image_source` is `custom` (the default).
- **Pod running stale content after a rebuild:** confirm `imagePullPolicy: Always` is set
  on the container (App_GKE sets this automatically for custom-built images) and compare
  the running image digest to the freshly built one:
  ```bash
  kubectl get pod -n "$NS" -o jsonpath='{.items[0].status.containerStatuses[0].imageID}'
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource or
  quota issues, and confirm the LoadBalancer Service has an assigned IP:
  ```bash
  kubectl get svc -n "$NS"
  ```
- **Real-time collaboration doesn't work:** this is expected — the module does not
  deploy the separate `excalidraw-room` WebSocket server that the "shareable link"
  feature requires.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the fixed port, the hardcoded `min_instance_count = 1`, and the
`latest`-tag caveat for production use).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload,
namespace, Service, and the Artifact Registry image. There is no Cloud SQL database,
Secret Manager secret, GCS bucket, or PVC to clean up, since none were created.
Resources owned by **Services_GCP** (the VPC, GKE cluster, shared registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds and mirrors the static image, deploys a stateless Deployment + LoadBalancer — no database, secrets, or storage |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes instantly; whiteboard loads with no login or setup |
| 3 — Operate | Manual | Inspect workload, scale (min=1 hardcoded), update/pin version — no secrets/PVCs/DB to manage |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, port, image, and LoadBalancer issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
