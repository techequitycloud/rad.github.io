---
title: "Maybe Finance on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Maybe Finance on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Maybe Finance on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/MaybeFinance_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Maybe (Maybe Finance) is an open-source, self-hosted alternative to
Mint/Monarch for personal finance and wealth management — budgeting,
net-worth tracking, transaction categorization, and multi-account
aggregation, built on Ruby on Rails. This lab takes you through the full
operational lifecycle of the **Maybe Finance on GKE Autopilot** module on
Google Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud
platform**, not on Maybe's product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/MaybeFinance_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload, including its
  mandatory PostgreSQL and Redis dependencies.
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Understand why the co-located Sidekiq background-job worker needs at least
  one pod running at all times (`min_instance_count = 1`).
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Cloud SQL, Filestore NFS/Redis, Artifact Registry, and
  shared service accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Maybe Finance
   (GKE)** from the **Platform Modules** list to start configuration, set
   `project_id`, and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/MaybeFinance_GKE)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform builds a thin custom wrapper image `FROM
   ghcr.io/maybe-finance/maybe:stable`, deploys the workload into the GKE
   Autopilot cluster with a `cloud-sql-proxy` sidecar (`enable_cloudsql_volume
   = true` on GKE) listening on `127.0.0.1:5432`, provisions a Cloud SQL
   (PostgreSQL 15) database, mounts the shared Filestore NFS volume at
   `/opt/maybefinance/storage` (also the default source of the Redis host),
   creates the `SECRET_KEY_BASE` secret in Secret Manager, provisions a
   `storage` data bucket, and runs two chained one-shot jobs — `db-init`
   (creates the database/user/grants and pre-creates `pgcrypto`) followed by
   `maybefinance-migrate` (`rails db:prepare`). First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep maybefinance | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. Maybe's Rails app exposes a public,
   unauthenticated health endpoint that the platform's own startup/liveness
   probes also target:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/up"   # expect 200
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. Maybe runs with `SELF_HOSTED =
   "true"`, so the **first visitor** to reach the deployment registers the
   initial administrator account through the web UI — there is no pre-seeded
   admin credential in Secret Manager. Register the admin account promptly;
   anyone with the URL who gets there first claims that role.

4. Confirm the background worker is alive — Sidekiq runs in-process inside
   the same pod as Rails/Puma, started only if Redis was reachable at boot:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     --tail=50 | grep -i sidekiq
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the proxy sidecar:

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   kubectl exec -n "$NS" deploy/<service-name> -- ps aux | grep -E 'puma|sidekiq'
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the workload spec, so
   scaling is a configuration change, not a manual `kubectl scale` (a manual
   edit would be reverted on the next apply). `min_instance_count = 1` is the
   default on GKE (unlike the Cloud Run variant's `min = 0`) specifically so
   the co-located Sidekiq worker always has a pod to run account syncing,
   import processing, and notifications in — do not scale to zero in
   production. Session affinity (`ClientIP`) is set by default to keep
   authenticated sessions on the same pod.

3. **Update the application version** by changing the version input in the
   RAD platform and applying it via **Update**; a new image builds `FROM
   ghcr.io/maybe-finance/maybe:<tag>` (via the app-specific `MAYBE_VERSION`
   build ARG) and a rolling update replaces the pods.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~maybefinance"
   kubectl get jobs -n "$NS"          # db-init and maybefinance-migrate
   ```

   Never rotate the `SECRET_KEY_BASE` secret after first boot — it invalidates
   every active session and makes ActiveRecord-encrypted columns permanently
   unreadable.

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=maybefinance --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU
   and memory utilisation (the combined Rails + Sidekiq process is
   memory-hungry under import/sync workloads), restart counts, and request
   metrics. The module can provision an **uptime check** (when enabled);
   review Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Maybe releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The
  liveness probe targets `/up` with roughly 8 minutes of headroom on first
  boot (`initial_delay_seconds=60`, `failure_threshold=30` on the startup
  probe); a stuck `cloud-sql-proxy` sidecar or unreachable database will keep
  the pod from becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`. GKE pods reach it through the **Auth Proxy sidecar on
  `127.0.0.1:5432`** (`enable_cloudsql_volume = true`, required on GKE) with
  `PGSSLMODE=disable` on that loopback connection — check the sidecar
  container's logs alongside the app container's.
- **Initialisation/migration job failed:** inspect the job and its pod logs,
  checking `db-init` before `maybefinance-migrate` (the latter depends on
  the former):
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  kubectl logs -n "$NS" job/<maybefinance-migrate-job-name>
  ```
- **Background jobs (account sync, imports, notifications) not firing:**
  usually means Sidekiq never started — check `REDIS_URL` resolved
  non-empty:
  ```bash
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep -E 'REDIS_URL|REDIS_HOST'
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the
  node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rules never to rotate
`SECRET_KEY_BASE` after first boot, and that `database_type` and
`enable_redis` are enforced by plan-time guards that reject anything but
PostgreSQL and a working Redis host).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the
RAD platform can no longer manage it (for example after manual changes that
conflict with the Terraform state), use **Purge** instead — it removes the
deployment from RAD's records **without** destroying the cloud resources (it
makes RAD forget the project). This removes everything the module created —
the Kubernetes workload and namespace, Cloud SQL database, Secret Manager
secrets, and the `storage`/`data` GCS buckets. Resources owned by
**Services_GCP** (the VPC, GKE cluster, the shared Filestore NFS/Redis VM,
shared Cloud SQL host, Artifact Registry) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds a custom wrapper image, deploys the GKE workload with a Cloud SQL Auth Proxy sidecar, Cloud SQL (PostgreSQL 15), NFS/Redis wiring, secrets, storage buckets, and runs `db-init` + `maybefinance-migrate` |
| 2 — Access & verify | Manual | Connect to the cluster; `/up` health check passes; register the initial admin account in the UI; confirm Sidekiq started |
| 3 — Operate | Manual | Inspect workload, scale (keep `min_instance_count ≥ 1` for Sidekiq), update version, manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and (optional) uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database (Auth Proxy sidecar), init/migration-job, background-job, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources; shared NFS/Redis, GKE cluster, and Cloud SQL host are untouched |
