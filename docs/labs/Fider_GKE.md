---
title: "Fider on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Fider on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Fider on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Fider_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Fider is an open-source, self-hosted feedback and feature-voting board — customers
post ideas, vote, and comment, and you prioritise your roadmap by demand. This lab
takes you through the full operational lifecycle of the **Fider on GKE Autopilot**
module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe
it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Fider product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Fider_GKE) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster, access the workload, and complete Fider's first-run
  site/admin setup.
- Perform day-2 operations — inspect, scale, update, and manage secrets and the
  database.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Filestore NFS, Artifact Registry, and shared service accounts
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

1. Click **Deploy** in the RAD platform top navigation, open **Fider (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and
   review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Fider_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets
   (`JWT_SECRET` and the database password), a Cloud Storage data bucket, a Cloud
   Filestore NFS mount for attachments (enabled by default), builds the container
   image, and runs a one-shot database-initialisation job that creates the
   `fider` role and database. First deploys take roughly **20–35 minutes** (Cloud
   SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep fider | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. Fider exposes an unauthenticated `/_health`
   endpoint that returns `200` once the server has booted and run its schema
   migrations. The container listens on port **3000** — on GKE the `PORT` env is
   **not** auto-injected, so `container_port` and the probe port must both be
   3000 or the pod never becomes Ready even though the app is healthy:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/_health"   # expect 200
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. There are no default credentials —
   the first visit walks you through creating the **site** and its **admin
   owner** account. Complete this immediately after deploy.

4. Email is disabled for the demo (`EMAIL_NOEMAIL = true`), so sign-up and invite
   links are printed to the pod log rather than sent. Check the logs if you
   invite additional users before wiring real SMTP:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     --tail=100 | grep -i "sign-in\|invite"
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the horizontal autoscaler:

   ```bash
   kubectl get deploy,pods,hpa -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the workload spec, so scaling
   is a configuration change, not a manual `kubectl scale` (a manual edit would
   be reverted on the next apply). GKE does not support scale-to-zero, so
   `min_instance_count` stays at least `1`.

3. **Update the application version** by changing the `application_version` input
   in the RAD platform and applying it via **Update**; a new image builds and a
   rolling update replaces the pods. Because Fider is NFS-backed, App_GKE
   deploys it with the `Recreate` update strategy rather than `RollingUpdate` —
   two pods sharing the same NFS volume and database would deadlock, so expect a
   brief moment of downtime during an update, not a zero-downtime rollout. Note
   `getfider/fider` has no `:latest` tag — the module pins `latest` to `stable`;
   pin an explicit SHA tag for reproducible upgrades.

4. **Manage secrets and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~fider"
   kubectl get jobs -n "$NS"          # db-init job
   ```

   `JWT_SECRET` signs all authentication and session tokens (including emailed
   magic sign-in links) — **never rotate it after first boot**; doing so
   invalidates every active session and pending sign-in link.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=fider --project="$PROJECT"
   ```

6. **Check the NFS mount:**

   ```bash
   gcloud filestore instances list --project="$PROJECT"
   kubectl get pvc,pv -n "$NS"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.
   When email is disabled, sign-up / invite links appear here — this is expected,
   not an error.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. The module can
   provision an **uptime check** (when enabled); review Monitoring → Uptime
   checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Fider releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The liveness
  probe targets `/_health` on port 3000; a mismatched `container_port` (GKE does
  not auto-inject `PORT`) or a slow database connection will keep the pod from
  becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`,
  the DB password secret materialised into the namespace, and the `db-init` job
  completed (it idempotently creates the `fider` role/database and is safe to
  re-run).
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Rollout appears stuck after an update:** this is expected for one moment —
  NFS-backed apps use the `Recreate` strategy, so the old pod is fully terminated
  before the new one starts (unlike a `RollingUpdate` surge). Confirm progress
  with:
  ```bash
  kubectl rollout status deploy/<deployment-name> -n "$NS"
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an assigned
  IP.
  ```bash
  kubectl get svc -n "$NS" -o wide
  ```
- **NFS-related mount failures:** confirm the shared Filestore NFS VM (managed by
  `Services_GCP`) is `RUNNING` before this app was deployed; a stopped/absent NFS
  server at deploy time is a common cause of storage mount errors.
  ```bash
  gcloud filestore instances list --project="$PROJECT"
  ```
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section
for setting-specific gotchas (including the critical rule never to rotate
`JWT_SECRET` after first boot, why `application_database_name`/
`application_database_user` are immutable after first deploy, and why
`quota_memory_requests`/`quota_memory_limits` require binary unit suffixes).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, GCS buckets, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared Cloud SQL, Filestore NFS, registry) are managed separately and are
not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), secrets, storage bucket, NFS mount, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; create the site and admin owner on first visit |
| 3 — Operate | Manual | Inspect workload, scale, update version (Recreate strategy), manage secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, rollout, scheduling, NFS, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
