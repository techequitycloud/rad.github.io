---
title: "Synapse on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Synapse on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Synapse on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Synapse_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Synapse is the reference [Matrix](https://matrix.org/) homeserver — the open-source
server for Matrix, an open standard for decentralized, federated real-time
communication. This lab takes you through the full operational lifecycle of the
**Synapse on GKE Autopilot** module on Google Cloud: deploy it, access and verify it,
register an admin and log in via the Matrix API, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
Matrix product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Synapse_GKE) — this lab
deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Register an admin user and log in over the Matrix client API; connect Element.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Artifact Registry, and shared service accounts this module depends
  on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** installed; `gcloud auth login` and
  `gcloud auth application-default login` completed.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.
- A **domain you control** for `server_name` if you intend to federate (set it before
  the first deploy — it is immutable).

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Click **Deploy** in the RAD platform, open **Synapse (GKE)** from the **Platform
   Modules** list, set `project_id`, and — importantly — set **`server_name`** to your
   real domain (it is baked into every user ID and is immutable after first boot).
   Review the rest of the inputs; the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Synapse_GKE) documents
   every input by group, with defaults. Review the estimated cost (if credits are
   enabled) and click **Deploy**, which opens the deployment status page with real-time
   logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a Cloud
   SQL (PostgreSQL 15) database with its Secret Manager secrets (the registration shared
   secret and the database password), a Cloud Storage data bucket and NFS volume for the
   signing key and media, builds the container image, and runs a one-shot `db-init` job
   that creates the database **with the mandatory `C` collation**. There is no separate
   migrate job — Synapse builds its own schema on first start. First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep synapse | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify; register an admin [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,svc -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the homeserver is healthy. Synapse serves an unauthenticated `200 OK` at
   `/health` on port 8008, and the Matrix client API advertises its supported spec
   versions:

   ```bash
   curl -s "http://${EXTERNAL_IP}/health"                    # expect: OK
   curl -s "http://${EXTERNAL_IP}/_matrix/client/versions"   # expect JSON with a "versions" array
   ```

3. **Register the first admin user.** Open self-service registration is disabled by
   default; you create users out-of-band with `register_new_matrix_user`, run from inside
   the pod where `homeserver.yaml` (with its shared secret) is present:

   ```bash
   POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl exec -n "$NS" "$POD" -- \
     register_new_matrix_user -c /data/homeserver.yaml -u admin -p '<strong-password>' -a \
     http://localhost:8008
   ```

4. **Log in over the Matrix API** to confirm the account works end to end:

   ```bash
   curl -s -XPOST "http://${EXTERNAL_IP}/_matrix/client/v3/login" \
     -H 'Content-Type: application/json' \
     -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"admin"},"password":"<the-password>"}'
   # A successful response returns an access_token, device_id, and user_id (@admin:<server_name>).
   ```

5. **Connect a client.** Open the [Element](https://app.element.io/) web app, choose
   *Sign in* → *Edit* the homeserver, and enter your homeserver URL (the external IP or,
   preferably, a custom domain matching `server_name`). Sign in as `admin`.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the horizontal autoscaler:

   ```bash
   kubectl get deploy,pods,hpa,pdb,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Keep at least one replica.** GKE does not scale to zero, which suits a federating
   homeserver that must stay reachable; `min_instance_count = 1` and a PodDisruptionBudget
   keep it available through node upgrades. Scaling is a configuration change via
   **Update**, not a manual `kubectl scale` (a manual edit is reverted on the next
   apply). Session affinity (`ClientIP`) keeps a client's requests on the same pod.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and a rolling update replaces the
   pods (NFS-backed workloads use a `Recreate` strategy to avoid two pods contending on
   the same data directory). Synapse applies any schema upgrades itself on start.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~synapse"
   kubectl get jobs -n "$NS"          # db-init and any scheduled jobs
   ```

5. **Open a database session** for inspection or maintenance — and confirm the
   collation:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=synapse --project="$PROJECT"
   #   SELECT datname, datcollate, datctype FROM pg_database WHERE datname = 'synapse';
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and memory
   utilisation, restart counts, and request metrics. The module can provision an
   **uptime check** (when enabled) against `/health`; review Monitoring → Uptime checks
   and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Synapse releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The probes target
  `/health` on port **8008** — a container port or probe port mismatch makes the probe
  hit a dead port and the pod never becomes Ready even though Synapse is healthy.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events show scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **`Database has incorrect values for … collation`:** the database was not created with
  `C` collation. Confirm the `db-init` job ran; re-run it or recreate the (empty)
  database with `LC_COLLATE='C' LC_CTYPE='C'`.
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job>
  ```
- **Federation broken / device sessions lost after a redeploy:** the signing key was
  regenerated because the data directory was not persistent. Ensure `enable_nfs = true`
  (the default), or use a StatefulSet PVC for `/data`, so the signing key survives pod
  restarts.
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the DB
  password secret materialised into the namespace, and the init job completed.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource or
  quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rules that `server_name` and the signing key are
immutable after first boot, and that the container port and probes must be 8008).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record
is retained for history). If a deployment is stuck and the RAD platform can no longer
manage it (for example after manual changes that conflict with the Terraform state), use
**Purge** instead — it removes the deployment from RAD's records **without** destroying
the cloud resources (it makes RAD forget the project). This removes everything the module
created — the Kubernetes workload and namespace, Cloud SQL database, Secret Manager
secrets, GCS buckets, NFS volume, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15, C collation), secrets, storage, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; register an admin; log in via the Matrix API; connect Element |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, collation, signing-key, database, init-job, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
