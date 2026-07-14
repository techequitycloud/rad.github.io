---
title: "CloudBeaver on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy CloudBeaver on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# CloudBeaver on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/CloudBeaver_GKE)**

## Overview

**Estimated time:** 45–90 minutes

CloudBeaver is the web-based database management console from the DBeaver project — a single browser UI for connecting to and querying PostgreSQL, MySQL, SQL Server, Oracle, and many other engines. This lab takes you through the full operational lifecycle of the **CloudBeaver on GKE Autopilot** module on Google Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on CloudBeaver product features. For the complete list of provisioned services and every configuration input (organised by group), see the [Configuration Guide](https://docs.radmodules.dev/docs/modules/CloudBeaver_GKE) — this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload behind its default `ClusterIP` Service.
- Claim the administrator account via the first-run setup wizard and understand why timing matters.
- Perform day-2 operations — inspect the StatefulSet and its block PVC, and update the version.
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

1. Click **Deploy** in the RAD platform top navigation, open **CloudBeaver (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/CloudBeaver_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform builds the container image (from `dbeaver/cloudbeaver` with a custom
   entrypoint), and deploys a single-replica **StatefulSet** (port 8978, 1 vCPU / 1 GiB)
   into the GKE Autopilot cluster with a per-pod **block Persistent Disk** mounted at
   `/opt/cloudbeaver/workspace`. A Cloud Storage bucket is also declared for parity
   with the Cloud Run variant, but is not where the workspace lives. There is **no
   Cloud SQL instance, no Redis, and no application secret** — CloudBeaver keeps all
   of its own state on the block PVC. First deploys typically take **10–20 minutes**
   (the container build and PVC provisioning dominate — there is no database to
   wait for).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep cloudbeaver | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. **Mind the Service type first.** The module defaults to `service_type = "ClusterIP"`
   — appropriate for a database admin console, but it means the workload is only
   reachable from inside the cluster. Confirm the workload is running and check how
   it is exposed:

   ```bash
   kubectl get pods,svc,statefulset -n "$NS"
   ```

2. For quick access without changing the deployment, port-forward to the Service:

   ```bash
   kubectl port-forward -n "$NS" svc/<service-name> 8978:8978
   curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8978/"   # expect 200
   ```

   For durable browser access from outside the cluster, set `service_type =
   "LoadBalancer"` via **Update** on the deployment details page (or add a custom
   domain with IAP), then locate the external address:

   ```bash
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

3. Confirm the service is healthy. CloudBeaver's health path is `/`, which returns
   HTTP 200 once the JVM has finished starting (the startup probe allows a 15-second
   initial delay).

4. Open the reachable address (port-forward URL or, once exposed, `http://${EXTERNAL_IP}`)
   in a browser. On first access CloudBeaver presents its **setup wizard** — there is
   no seeded admin account, so **whoever completes the wizard first becomes the
   administrator**. Complete it immediately: set the server name and create the admin
   username and password. Keep the Service `ClusterIP` (or behind IAP) until you have
   done this.

5. After logging in as admin, add a database connection (New Connection → choose the
   driver → supply host/port/credentials). To reach a private database on the VPC
   (including the shared Cloud SQL from Services_GCP), test reachability from inside
   the pod first:

   ```bash
   kubectl exec -n "$NS" statefulset/<service-name> -- sh -c 'nc -zv <db-private-ip> 5432'
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pods, and the block PVC:

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Do not scale out.** This module deliberately defaults to `min_instance_count = 1`
   (avoids slow JVM cold starts; GKE has no scale-to-zero) and `max_instance_count = 1`.
   The workspace is a **single-writer store** (an embedded H2 database on the block
   PVC) — raising `max_instance_count` above 1 risks corrupting it. Scaling changes,
   like all spec changes, go through **Update** on the deployment details page, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply).

3. **Update the application version** by changing the version input via **Update** on
   the deployment details page; a new image builds from `dbeaver/cloudbeaver:<version>`
   and a rolling update replaces the pod. Pin a specific tag rather than `latest` for
   reproducible deployments.

4. **Manage storage and jobs** — the block PVC is the durable heart of the deployment
   (saved connections, users, settings, the embedded metadata DB). There is no
   application secret and no initialisation job to check:

   ```bash
   kubectl get pvc -n "$NS"
   kubectl exec -n "$NS" statefulset/<service-name> -- ls -la /opt/cloudbeaver/workspace
   kubectl get jobs -n "$NS"                          # expect none — CloudBeaver has no db-init job
   gcloud secrets list --project="$PROJECT" --filter="name~cloudbeaver"   # expect none
   ```

5. **There is no application database to manage.** `database_type = "NONE"` — no
   Cloud SQL instance, no db-init job, no DB password secret. The databases
   CloudBeaver *manages* are external targets you register in its UI.

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" statefulset/<service-name> --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation (watch memory — CloudBeaver is JVM-based), restart counts, and
   PVC usage. The module can provision an **uptime check**, but only when the
   endpoint is publicly reachable (e.g. `service_type = "LoadBalancer"`) — with the
   default `ClusterIP` there is no public endpoint to probe, so Monitoring → Uptime
   checks may legitimately be empty.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with CloudBeaver releases.

- **Can't reach the Service from your machine:** almost always the default
  `ClusterIP` Service type, not an outage. Use `kubectl port-forward` (Task 2) or
  switch to `LoadBalancer` before assuming a failure.
- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup and
  liveness probes target `/` (the CloudBeaver web UI); a slow JVM boot or a mount
  failure on the workspace PVC will keep the pod from becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Workspace state missing / settings reset:** confirm the block PVC exists and is
  bound, and that `stateful_pvc_mount_path` matches CloudBeaver's workspace directory
  (`/opt/cloudbeaver/workspace`) — all CloudBeaver state lives there, not in the GCS
  bucket.
  ```bash
  kubectl get pvc -n "$NS"
  ```
- **Corrupted workspace / odd metadata errors:** check whether `max_instance_count`
  was raised above 1 — two concurrent pods writing the embedded H2 store corrupt it.
  Restore from a PVC snapshot if one exists.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and (if using `LoadBalancer`) confirm the Service has an assigned
  external IP.
- **Can't reach a private database from the UI:** verify the target database is
  reachable on the VPC from the pod (Task 2, step 5).
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas, including the critical rule to keep `max_instance_count = 1` and to use a
block PVC (not GCS FUSE) for the workspace.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload, namespace, and block PVC (and with it **all saved connections, users, and settings**), the Cloud Storage bucket, and Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the image and provisions a single-replica StatefulSet with a block PVC workspace (no DB, no Redis, no secrets) |
| 2 — Access & verify | Manual | Understand the default `ClusterIP` Service; health check passes; claim the admin account via the setup wizard |
| 3 — Operate | Manual | Inspect the StatefulSet and PVC, keep single-instance scaling, update version |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics; understand when the uptime check exists |
| 5 — Troubleshoot | Manual | Diagnose Service reachability, pod, workspace-PVC, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources including the workspace PVC |
