---
title: "MongoDB on GKE Autopilot \u2014 Lab Guide"
---

# MongoDB on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/MongoDB_GKE)**

## Overview

**Estimated time:** 45–90 minutes

MongoDB is a popular NoSQL document database used for flexible document storage
across content management, IoT data pipelines, mobile backends, and AI/ML feature
stores. This lab takes you through the full operational lifecycle of the
**MongoDB on GKE Autopilot** module on Google Cloud: deploy it, access and verify
it, run it day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on MongoDB product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/MongoDB_GKE) — this
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

1. Click **Deploy** in the RAD platform top navigation, open **MongoDB (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/MongoDB_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys MongoDB as a StatefulSet on the GKE Autopilot cluster,
   provisions an SSD-backed Persistent Disk PVC (mounted at `/data/db`),
   auto-generates the root password and stores it in Secret Manager, and mirrors
   the official `mongo` image into Artifact Registry. There is no Cloud SQL
   instance — MongoDB is its own database engine. First deploys take roughly
   **10–25 minutes** (Autopilot node provisioning and PVC attachment dominate).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep mongodb | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the StatefulSet is running and locate the service endpoint:

   ```bash
   kubectl get statefulset,pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

   > **Note:** MongoDB uses its own binary wire protocol on port 27017 — HTTP health
   > checks always fail. The module configures TCP probes on port 27017. To verify
   > connectivity, use `mongosh` or a TCP connection test below.

2. Retrieve the auto-generated root password from Secret Manager:

   ```bash
   MONGO_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~mongo-root-password" --format="value(name)" --limit=1)
   MONGO_PASSWORD=$(gcloud secrets versions access latest \
     --secret="$MONGO_SECRET" --project="$PROJECT")
   echo "Root password retrieved (${#MONGO_PASSWORD} chars)"
   ```

3. Open a connection to MongoDB using `kubectl port-forward` and `mongosh`:

   ```bash
   kubectl port-forward -n "$NS" svc/$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}') 27017:27017 &
   mongosh "mongodb://admin:${MONGO_PASSWORD}@localhost:27017/admin"
   ```

   A successful connection displays the MongoDB version and a `test>` prompt.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pods, and (if enabled) the horizontal
   autoscaler and persistent volume claim:

   ```bash
   kubectl get statefulset,pods,hpa,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Scale** by changing resource inputs in the RAD platform and applying it via **Update** — the module
   owns the workload spec, so scaling is a configuration change, not a manual
   `kubectl scale` (a manual edit would be reverted on the next apply). Note that
   `max_instance_count` is enforced at 1; MongoDB replica sets are not supported by
   this module.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image mirrors and a rolling update replaces the pod.
   Test major version upgrades against a replica first — MongoDB major versions
   change the on-disk storage format and do not support downgrade.

4. **Manage secrets and backup jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~mongo-root-password"
   kubectl get cronjobs -n "$NS"    # scheduled mongodump backup job (if configured)
   ```

5. **Open a database session** for inspection or maintenance (via port-forward as
   established in Task 2):

   ```bash
   mongosh "mongodb://admin:${MONGO_PASSWORD}@localhost:27017/admin"
   ```

   The correct connection string format when connecting to non-admin databases with
   the root account is:
   `mongodb://<username>:<password>@<host>:27017/<db>?authSource=admin`

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and PVC disk usage. The module can provision
   **Cloud Monitoring alert policies** when `support_users` is configured; review
   Monitoring → Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with MongoDB releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs; pay attention to
  PVC attachment and image pull events:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Startup probe timeout:** GKE Autopilot must provision a node, attach the PVC,
  and pull the image before `mongod` starts. The startup probe allows up to ~8
  minutes. Check that the PVC is `Bound` and the node is `Ready`.
  ```bash
  kubectl get pvc -n "$NS"
  kubectl get nodes
  ```
- **Authentication / connection errors:** confirm the root password secret was
  created, that `MONGO_INITDB_ROOT_PASSWORD` is injected into the pod, and that
  `mongosh` uses `?authSource=admin` when connecting to non-admin databases.
- **Data directory inaccessible:** the MongoDB container runs as UID/GID 999 and
  requires the PVC mount at `/data/db` to be owned by that GID. Confirm the
  StatefulSet's `fsGroup: 999` is set and the PVC is mounted correctly.
  ```bash
  kubectl exec -n "$NS" <pod> -- ls -la /data/db
  ```
- **PVC full:** a full disk causes `mongod` to crash with `No space left on device`.
  Check disk usage; increase `stateful_pvc_size` and apply it via **Update** (PVC size can only be
  increased, not decreased).
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the `mongo` image was mirrored into Artifact
  Registry and the node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes StatefulSet
and namespace, the PVC and all MongoDB data, Secret Manager secrets, and Artifact
Registry images. Export your data with `mongodump` before undeploying if you need
to preserve it. Resources owned by **Services_GCP** (the VPC, GKE cluster, shared
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE StatefulSet, SSD PVC, auto-generates the root password secret, and mirrors the MongoDB image |
| 2 — Access & verify | Manual | Connect to the cluster; retrieve root password; connect with mongosh via port-forward |
| 3 — Operate | Manual | Inspect StatefulSet, scale (within single-node limits), update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and alert policies |
| 5 — Troubleshoot | Manual | Diagnose pod, PVC, authentication, startup probe, disk space, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources including PVC data |
