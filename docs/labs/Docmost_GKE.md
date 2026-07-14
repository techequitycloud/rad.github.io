---
title: "Docmost on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Docmost on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Docmost on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Docmost_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Docmost is an open-source, real-time collaborative wiki and documentation platform —
a self-hosted Confluence/Notion alternative built on NestJS. This lab takes you
through the full operational lifecycle of the **Docmost on GKE Autopilot** module on
Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Docmost product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Docmost_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Access and verify the running service and create the first workspace and admin account.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Understand the roles of PostgreSQL, Redis, and NFS in a collaborative-editing workload.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Artifact Registry, and shared service accounts this module
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

1. Click **Deploy** in the RAD platform top navigation, open **Docmost (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Docmost_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster (port 3000,
   1–3 replicas via HPA), provisions a Cloud SQL (PostgreSQL 15) database with its
   Secret Manager secrets (the auto-generated `APP_SECRET` and the database
   password), Redis for real-time collaboration and job queues (co-located on the
   NFS server VM by default), an NFS volume mounted at `/app/data/storage` for
   uploaded attachments, and a GCS data bucket. It builds a custom container image
   (wrapping `docmost/docmost:latest`) via Cloud Build and runs a one-shot
   database-initialisation Job. First deploys take roughly **20–35 minutes** (Cloud
   SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep docmost | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,svc,hpa -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the service is healthy. Docmost's health path is `/api/health`, which
   returns HTTP 200 once the app has booted and run its schema migrations (allow
   up to ~2 minutes on a fresh deploy — the startup probe uses a 60-second initial
   delay plus a retry window):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/api/health"
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. Docmost ships with **no default
   credentials** — the first visitor completes the setup form and creates the
   initial workspace and administrator account. Do this promptly after deploy so
   no one else can claim the workspace. The auto-generated secrets can be
   inspected if needed:

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~docmost"
   kubectl get secret -n "$NS"
   ```

4. Set `APP_URL` to the external address once it is known, so absolute links and
   the collaboration WebSocket resolve correctly (the module injects the
   internal/predicted URL by default):

   ```bash
   kubectl set env deploy/$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}') \
     -n "$NS" APP_URL="http://${EXTERNAL_IP}"
   ```

5. Verify the collaboration wiring: create a page and open it in two browser tabs —
   edits should appear live in both (real-time sync runs over the `APP_URL`
   WebSocket endpoint, coordinated through Redis).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the horizontal autoscaler:

   ```bash
   kubectl get deploy,pods,hpa,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply). `min_instance_count` defaults to `1` (GKE does not
   support scale-to-zero, unlike the Cloud Run variant); `max_instance_count`
   defaults to `3`. Redis is enabled by default, so multiple replicas stay
   coordinated for real-time editing and background queues. Session affinity
   (`ClientIP`) is set by default to keep a client's collaboration WebSocket on
   one pod.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a rolling
   deployment replaces the pods. Because attachments live on the shared NFS
   volume, the Deployment uses the `Recreate` strategy (not rolling update) to
   avoid two pods writing the same NFS/DB state during the transition. Docmost
   runs its schema migrations automatically on boot — there is no separate
   migration step.

4. **Manage secrets, storage, and jobs.** Treat `APP_SECRET` as immutable —
   rotating it after first boot logs everyone out and makes data encrypted under
   the old value unrecoverable:

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~docmost"
   kubectl get jobs -n "$NS"          # db-init and any scheduled jobs
   kubectl get pvc -n "$NS"
   gcloud filestore instances list --project="$PROJECT"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=docmost --database=docmost --project="$PROJECT"
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
   memory utilisation, restart counts, and request metrics; Cloud SQL metrics
   live under the SQL page. The module can provision an **uptime check** (when
   the endpoint is publicly reachable); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Docmost releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup and
  liveness probes target `/api/health`; a connection failure to PostgreSQL (via
  the Cloud SQL Auth Proxy sidecar on `127.0.0.1`) will keep the pod from
  becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL (PostgreSQL 15) instance
  is `RUNNABLE`, the DB password secret materialised into the namespace, and the
  `db-init` job completed. Note the pod connects through the Auth Proxy sidecar
  over plaintext loopback (`sslmode=disable`) — this differs from the Cloud Run
  variant, which connects over private-IP TCP with SSL.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Real-time editing broken / edits don't sync:** verify Redis is reachable
  (`enable_redis = true`; with `redis_host` empty the NFS server VM co-hosts
  Redis — it must be `RUNNING`), and check that `APP_URL` in the running pod
  matches the URL users actually browse to (a mismatch breaks the collaboration
  WebSocket and absolute links):
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep -E 'APP_URL|REDIS_URL'
  ```
- **Attachments disappear after a restart:** verify `enable_nfs = true` (the
  default) and that the NFS volume is mounted at `/app/data/storage`; with NFS
  off, uploads land on ephemeral pod disk and are lost on restart / not shared
  across replicas.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an assigned
  IP.
- **Image pull errors:** confirm the custom-built image exists in Artifact
  Registry and the node service account can pull it. The image is built with the
  `DOCMOST_VERSION` build ARG (so `application_version = "latest"` maps to a
  pinned release); rebuilt images deploy with `imagePullPolicy=Always` so nodes
  don't serve a stale cached layer.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `APP_SECRET` after first boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets (including `APP_SECRET`),
GCS buckets, the NFS-backed attachment volume, and Artifact Registry images.
Resources owned by **Services_GCP** (the VPC, GKE cluster, shared Cloud SQL,
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), Redis, NFS, GCS bucket, secrets, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; `/api/health` passes; create the first workspace and admin account; verify real-time editing |
| 3 — Operate | Manual | Inspect workload, scale (Redis-coordinated), update version (Recreate strategy), manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, Redis/collaboration, NFS, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
