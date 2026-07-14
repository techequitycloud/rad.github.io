---
title: "Hoppscotch on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Hoppscotch on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Hoppscotch on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Hoppscotch_GKE)**

## Overview

**Estimated time:** 20–40 minutes

Hoppscotch is an open-source, Postman-style API development platform for designing,
sending, and inspecting HTTP, GraphQL, and WebSocket requests from the browser. This
lab takes you through the full operational lifecycle of the **Hoppscotch on GKE
Autopilot** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Hoppscotch product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Hoppscotch_GKE) — this
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

1. Click **Deploy** in the RAD platform top navigation, open **Hoppscotch (GKE)**
   from the **Platform Modules** list to start configuration, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Hoppscotch_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform builds a thin custom container image (`FROM
   hoppscotch/hoppscotch-frontend`) with Cloud Build, mirrors it into Artifact
   Registry, and deploys it as a stateless Deployment on the GKE Autopilot cluster,
   fronted by a LoadBalancer Service with a reserved static IP. Hoppscotch is
   deliberately stateless — no Cloud SQL instance, no Secret Manager secrets, and no
   Cloud Storage bucket are created (`database_type = "NONE"` is enforced by a
   plan-time guard). With no database to provision, a first deploy typically
   completes in well under the time a stateful module needs.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep hoppscotch | head -1 | cut -d/ -f2)
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

2. Confirm the service is serving. Hoppscotch has no backend to be reachable from —
   the root path returns the app UI as soon as Caddy binds port 3000:

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. Unlike most modules, Hoppscotch has
   **no first-run admin account to create** — the self-hosted frontend has no login
   or user management of its own. You can start building requests immediately.
   Collections, environments, and history are kept in the browser's local storage on
   each user's machine, not on the server.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the horizontal autoscaler:

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply). Because Hoppscotch keeps no shared queue or
   database, scaling is unconstrained — raise `max_instance_count` freely as a
   throughput ceiling. Note that GKE has no scale-to-zero, so `min_instance_count`
   must stay at least `1` (the default). `session_affinity` defaults to `None`
   because the static bundle is identical on every pod, so sticky routing is
   unnecessary.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a rolling update
   replaces the pods (safe here — the SPA is stateless, so there is no shared NFS or
   database lock to deadlock on). `HOPPSCOTCH_VERSION` (not the generic
   `APP_VERSION`) pins the upstream `hoppscotch-frontend` tag, so
   `application_version = "latest"` resolves to a pinned, known-good tag at build
   time rather than the literal string `latest`.

4. **Check secrets** — Hoppscotch provisions none by design; confirm nothing
   unexpected shows up:

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~hoppscotch"
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
   memory utilisation and restart counts. The module can provision an **uptime
   check** against the LoadBalancer host (when enabled); review Monitoring → Uptime
   checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Hoppscotch releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The liveness probe
  targets the root `/`, which returns HTTP 200 within seconds of Caddy binding port
  3000 — a failing probe almost always means the image tag is invalid, not that a
  backend is unreachable (there is no backend).
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it. Custom/mirrored images use `imagePullPolicy=Always`,
  so a rebuilt tag is never served stale from a node cache.
  ```bash
  kubectl get deploy -n "$NS" -o jsonpath='{.items[0].spec.template.spec.containers[0].image}'
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Plan fails with a `database_type` error:** this module enforces
  `database_type = "NONE"` at plan time — Hoppscotch has no backend to connect to a
  database. Leave the default rather than trying to select an engine.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including why `container_image_source` must stay `custom` and why
`min_instance_count` cannot be `0` on GKE).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload,
namespace, LoadBalancer, and reserved static IP, plus the Artifact Registry image
(Hoppscotch provisions no database, secrets, or storage buckets, so there is nothing
else to clean up). Resources owned by **Services_GCP** (the VPC, GKE cluster, shared
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the custom image and deploys the GKE workload + LoadBalancer — no database, secrets, or storage bucket |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; open the external IP and start using Hoppscotch immediately (no admin account) |
| 3 — Operate | Manual | Inspect workload, scale (unconstrained, min ≥ 1), update version, confirm no secrets |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, image-pull, scheduling, and `database_type` guard issues |
| 6 — Tear down | Automated | Delete (Trash) removes the workload, LoadBalancer, and image |
