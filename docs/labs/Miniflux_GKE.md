---
title: "Miniflux on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Miniflux on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Miniflux on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Miniflux_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Miniflux is a minimalist, self-hosted RSS/Atom feed reader — a single static Go
binary that stores all of its state in PostgreSQL. This lab takes you through the
full operational lifecycle of the **Miniflux on GKE Autopilot** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Miniflux product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Miniflux_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster, find the namespace, and access the running workload.
- Perform day-2 operations — inspect, scale, update, and manage secrets and jobs.
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

1. Click **Deploy** in the RAD platform top navigation, open **Miniflux (GKE)** from
   the **Platform Modules** list to start configuration, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Miniflux_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster as a stateless
   Deployment (Miniflux keeps all state in PostgreSQL, so no PVC is required),
   provisions a Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets
   (the auto-generated `ADMIN_PASSWORD` and the database password), builds the
   container image, and runs a one-shot database-initialisation job that creates the
   `miniflux` database/role and installs the `hstore` extension. First deploys take
   roughly **20–35 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep miniflux | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. Miniflux's startup and liveness probes default
   to the root path `/` (the login page, an unauthenticated `200 OK`); a dedicated
   `/healthcheck` endpoint is also available unauthenticated:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Retrieve the seeded initial owner password from Secret Manager (the account is
   created on first boot — there is no self-service signup):

   ```bash
   gcloud secrets versions access latest \
     --secret=secret-<resource-prefix>-miniflux-admin-password --project="$PROJECT"
   ```

   Substitute `<resource-prefix>` with the real secret name from
   `gcloud secrets list --project="$PROJECT" --filter="name~miniflux"`.

4. Open `http://${EXTERNAL_IP}` in a browser and log in with username `admin` (or
   the `ADMIN_USERNAME` you configured) and the retrieved password. If you enable a
   custom domain, set `BASE_URL` (via `environment_variables`) to that URL so
   Miniflux emits correct absolute links.

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
   reverted on the next apply). Keep `min_instance_count = 1` (the default and the
   GKE minimum) so the in-process feed poller keeps refreshing; extra replicas each
   poll independently since there is no shared queue to coordinate them. Session
   affinity (`ClientIP`) is set by default to keep a client pinned to one pod for a
   consistent UI session.

3. **Update the application version** by changing the version input in the RAD
   platform and applying it via **Update**; a new image builds and a rolling update
   replaces the pods. Miniflux applies its own schema migrations on boot, so no
   separate migrate step is needed — allow extra time on the first boot after an
   upgrade.

4. **Manage secrets and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~miniflux"
   kubectl get jobs -n "$NS"          # db-init and any scheduled jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=miniflux --database=miniflux --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer. The entrypoint logs its
   `DATABASE_URL` connection mode at start — useful when diagnosing DB
   connectivity:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation, restart counts, and request metrics. The module can
   provision an **uptime check** (when enabled); review Monitoring → Uptime checks
   and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Miniflux releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The liveness
  probe targets `/`; a connection failure to PostgreSQL (via the Cloud SQL Auth
  Proxy sidecar) will keep the pod from becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret materialised into the namespace, `enable_cloudsql_volume =
  true` (the proxy sidecar is required on GKE), and the `db-init` job completed —
  it creates the `miniflux` database/role and the `hstore` extension owned by the
  app role, then signals the sidecar to exit.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Feeds not refreshing:** the feed poller runs in-process on
  `POLLING_FREQUENCY` inside every pod. Confirm `min_instance_count >= 1` — GKE
  does not scale to zero, but a workload with zero healthy replicas stops polling
  entirely.
- **Can't log in / lost the admin password:** re-read the `ADMIN_PASSWORD` secret
  (see Task 2); `CREATE_ADMIN` only seeds the account on first boot and is
  idempotent on later boots.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the immutability of `application_database_name`/
`application_database_user` after first deploy and the binary-unit requirement on
`quota_memory_requests`/`quota_memory_limits`).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, the GCS bucket, any
Filestore NFS mount, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), secrets, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; retrieve the seeded admin password and log in |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/jobs, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, feed-poller, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
