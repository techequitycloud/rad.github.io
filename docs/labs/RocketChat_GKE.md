---
title: "Rocket.Chat on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Rocket.Chat on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Rocket.Chat on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/RocketChat_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Rocket.Chat is an open-source, self-hosted team-communication platform — a Slack/Teams
alternative with channels, direct messages, threads, and voice/video. This lab takes
you through the full operational lifecycle of the **Rocket.Chat on GKE Autopilot**
module on Google Cloud: deploy it, complete the first-run setup wizard, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Rocket.Chat product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/RocketChat_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and complete the setup wizard (admin + organization).
- Perform day-2 operations — inspect the StatefulSet/PVC, update, and manage backups.
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

1. Click **Deploy** in the RAD platform top navigation, open **RocketChat (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. **Confirm `stateful_pvc_enabled = true`** — MongoDB requires a real block
   filesystem; `gcsfuse` corrupts WiredTiger. Configure only what else you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/RocketChat_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform builds a custom container image — the official `rocketchat/rocket.chat`
   image with a **single-node MongoDB 6.0 replica set (`rs0`) baked in** — provisions a
   **StatefulSet with a Persistent Disk PVC** mounted at `/data/db`, and deploys the
   workload into the GKE Autopilot cluster. There is **no Cloud SQL instance**; MongoDB
   is embedded. The image build dominates first-deploy time, roughly **15–25 minutes**.

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep rocketchat | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all,pvc -n "$NS"
   ```

---

## Task 2 — Access & complete the setup wizard [Manual]

1. Confirm the workload is running and the PVC is bound:

   ```bash
   kubectl get statefulset,pods,pvc,svc -n "$NS"
   ```

2. The Service is **ClusterIP** by default. Reach the UI with a port-forward (or enable
   a custom domain + Gateway for permanent external access):

   ```bash
   kubectl port-forward -n "$NS" svc/"$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')" 3000:3000 &
   curl -s "http://localhost:3000/api/info"   # expect {"version":"6.12.1","success":true,...}
   ```

   If it is not yet ready, confirm the embedded MongoDB reached PRIMARY on boot:

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     | grep -i "replica set rs0 is PRIMARY"
   ```

3. Open `http://localhost:3000` in a browser. On first visit Rocket.Chat launches the
   **4-step setup wizard** — no admin credential is pre-seeded:

   - **Step 1 — Admin Info:** full name, username, admin email
     (use `admin@techequity.cloud` for RAD deployments), password.
   - **Step 2 — Organization Info:** organization name, type, industry, size, country.
   - **Step 3 — Register Server:** **Register** with Rocket.Chat Cloud or **Keep standalone**.
   - **Step 4 — Complete:** you land in the admin workspace.

4. (Optional) When you expose Rocket.Chat on a custom domain, set `ROOT_URL` to that
   hostname via `environment_variables` and apply an **Update**.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pod, and PVC:

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Do not scale beyond one replica.** The PVC is `ReadWriteOnce` and the embedded
   MongoDB is a single writer — `min_instance_count` and `max_instance_count` are both
   `1` by design. A second replica cannot attach the disk. Scale **vertically** (more
   CPU/memory, a larger or `premium-rwo` PVC) by changing the inputs and clicking
   **Update**.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and the single pod is recreated
   (brief downtime while the PVC re-attaches). Rocket.Chat runs its own migrations on
   start.

4. **Manage the API token, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~api-key"   # when enable_api_key = true
   kubectl get cronjobs -n "$NS"                                       # scheduled mongodump backups
   ```

5. **Back up MongoDB** by exec-ing a `mongodump` inside the pod against the replica set
   and copying the dump to the storage bucket (see the Configuration Guide's `cron_jobs`).

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — both Rocket.Chat and the embedded `mongod` log to stdout:

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and memory
   utilisation, restart counts, and PVC usage. The module can provision an **uptime
   check** against `/api/info` (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Rocket.Chat releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup probe
  targets `/api/info`; the pod is not Ready until the embedded replica set is `PRIMARY`.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events: scheduling / probe / mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **`/api/info` never returns 200:** grep for `replica set rs0 is PRIMARY`. If MongoDB
  never reaches PRIMARY, check the PVC is bound and mounted at `/data/db` and the pod
  is not OOM-killed (raise `memory_limit`).
- **Data corruption after a restart:** confirm `stateful_pvc_enabled = true` and that
  `/data/db` is on the PVC — a `gcsfuse` mount corrupts WiredTiger and is the classic
  cause of a broken data set.
- **Pending pod / PVC unbound:** check `kubectl describe pvc` and `kubectl describe pod`
  events for storage-class or quota issues.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it (MongoDB 6.0 must install from the bullseye repo at build
  time).

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including keeping `stateful_pvc_enabled = true`, `stateful_pvc_mount_path =
"/data/db"`, and never scaling beyond one replica).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes StatefulSet
and namespace, the Persistent Disk PVC holding the MongoDB data, the Cloud Storage
bucket, any Secret Manager API token, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, GKE cluster, registry) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the image (Rocket.Chat + embedded MongoDB), provisions a StatefulSet + block PVC, and deploys to GKE |
| 2 — Access & setup wizard | Manual | Connect to the cluster; health check passes; complete the 4-step wizard (admin + organization) |
| 3 — Operate | Manual | Inspect StatefulSet/PVC, update version, manage API token/backups; never scale out |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, replica-set, PVC/storage, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
