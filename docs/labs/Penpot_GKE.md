---
title: "Penpot on GKE Autopilot \u2014 Lab Guide"
---

# Penpot on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Penpot_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Penpot is an open-source design and prototyping platform — a self-hosted alternative to
Figma — that provides vector design editing, interactive prototyping, component libraries,
and real-time multiplayer collaboration. This lab takes you through the full operational
lifecycle of the **Penpot on GKE Autopilot** module on Google Cloud: deploy it, access
and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Penpot product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Penpot_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workloads.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workloads with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Artifact Registry, Redis/NFS, and shared service accounts this
  module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Penpot (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Penpot_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys three coordinated Kubernetes workloads (backend, frontend,
   exporter) into the GKE Autopilot cluster, provisions a Cloud SQL PostgreSQL
   database with its Secret Manager secrets, a GCS assets bucket, optional NFS/Redis,
   and builds the container images. The Penpot backend then runs its own PostgreSQL
   migrations on first boot — allow up to 60–120 seconds for JVM startup and
   migration. First deploys take roughly **25–40 minutes** (Cloud SQL creation
   dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" \
     --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" \
     --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep penpot | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm all three workloads are running and find the external address:

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the backend health endpoint responds:

   ```bash
   # Health endpoint on the backend pod — expect HTTP 200
   BACKEND_POD=$(kubectl get pods -n "$NS" -o name | grep backend | head -1 | cut -d/ -f2)
   kubectl exec -n "$NS" "$BACKEND_POD" -- \
     wget -qO- http://localhost:6060/api/health
   ```

3. Confirm the frontend is reachable externally:

   ```bash
   curl -s -o /dev/null -w "%{http_code}" "http://${EXTERNAL_IP}"
   ```

   Open `http://$EXTERNAL_IP` in a browser. If `penpot_flags` includes
   `enable-registration` (the default), self-registration is available. Otherwise,
   an administrator creates accounts directly inside Penpot. No admin credential
   is stored in Secret Manager — Penpot manages its own user accounts.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workloads** — deployments, pods, horizontal autoscalers, and (if
   enabled) persistent volumes:

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply). Keep
   `min_instance_count` at 1 or higher; scale-to-zero terminates active WebSocket
   sessions and forces a 60–120 second JVM cold start on reconnect.

3. **Update the application version** by changing the version input via **Update** on the deployment details page; new images build for all three services and a rolling update replaces
   the pods. All three services must use the same version tag.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~penpot"
   kubectl get jobs -n "$NS"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" \
     --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=penpot --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" \
     deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics for all three workloads
   (backend, frontend, exporter). The module also provisions an **uptime check**
   against `/api/health` (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Penpot releases.

- **Pod not Ready / CrashLoopBackOff:** the backend uses an HTTP startup probe on
  `/api/health` and can take 60–120 seconds to pass on first boot (JVM init +
  PostgreSQL migration). Inspect events and logs:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret materialised into the namespace, and the init job completed.
  Penpot runs its own migrations at startup — a migration failure surfaces in the
  backend logs before the pod becomes Ready.
- **WebSocket / real-time collaboration broken:** Redis is mandatory for WebSocket
  fan-out between backend replicas. Check backend pod logs for Redis connection
  errors, confirm `enable_redis = true`, and verify `session_affinity = "ClientIP"`
  is set (prevents WebSocket frames from being routed to different replicas).
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm all three images (backend, frontend, exporter) exist
  in Artifact Registry and the node service account can pull them.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including JVM heap sizing and `quota_memory_requests` binary suffix
requirements).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workloads
and namespace, Cloud SQL PostgreSQL database, Secret Manager secrets, the GCS assets
bucket, NFS, and Artifact Registry images. Resources owned by **Services_GCP** (the
VPC, GKE cluster, shared Cloud SQL, registry) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys three GKE workloads, Cloud SQL, GCS bucket, secrets, and NFS |
| 2 — Access & verify | Manual | Connect to cluster; all workloads healthy; frontend reachable; `/api/health` returns 200 |
| 3 — Operate | Manual | Inspect workloads, scale, update version, manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database/migration, WebSocket/Redis, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
