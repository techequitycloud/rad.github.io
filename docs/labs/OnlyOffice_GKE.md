---
title: "OnlyOffice on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy OnlyOffice on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# OnlyOffice on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/OnlyOffice_GKE)**

## Overview

**Estimated time:** 45–90 minutes

ONLYOFFICE Document Server is an open-source collaborative online office suite for
real-time co-editing of documents, spreadsheets, presentations, and PDFs — a
self-hosted alternative to Google Docs / Microsoft Office Online. It is not usually
opened directly by end users; it is embedded by a host application (Nextcloud,
ownCloud, Seafile, or a custom integration) via its API and a shared JWT secret. This
lab takes you through the full operational lifecycle of the **OnlyOffice on GKE
Autopilot** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on OnlyOffice product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/OnlyOffice_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running Document Server.
- Retrieve the JWT secret needed to integrate a host application (Nextcloud, ownCloud, etc.).
- Perform day-2 operations — inspect, scale, update, and manage secrets and storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, the co-located NFS/Redis VM, Artifact Registry, and shared
  service accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **OnlyOffice (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/OnlyOffice_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys a StatefulSet workload into the GKE Autopilot cluster
   (`stateful_pvc_enabled = true` auto-selects `StatefulSet`, with a 20Gi
   `standard-rwo` block PVC per pod at `/var/www/onlyoffice/Data`), provisions a
   Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets (a
   48-character `JWT_SECRET` and the database password), mounts the shared
   Filestore (NFS) at `/opt/onlyoffice/storage`, builds the container image, and
   runs a one-shot database-initialisation job. First deploys take roughly
   **20–35 minutes** (Cloud SQL creation dominates); the pod itself then needs up
   to ~10 more minutes to become Ready (a generous startup-probe budget for the
   bundled Postgres-client/Redis-client/RabbitMQ/nginx/converter stack under
   `supervisord`).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep onlyoffice | head -1 | cut -d/ -f2)
   echo "Cluster: $CLUSTER   Namespace: $NS"
   kubectl get all -n "$NS"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the workload is running and find its external address:

   ```bash
   kubectl get pods,svc,statefulset -n "$NS"
   EXTERNAL_IP=$(kubectl get svc -n "$NS" \
     -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
   echo "External IP: $EXTERNAL_IP"
   ```

2. Confirm the Document Server is healthy. `/healthcheck` returns `true` only once
   nginx and the document services are up and the database is reachable, and is
   served unauthenticated:

   ```bash
   curl -s "http://${EXTERNAL_IP}/healthcheck"   # expect: true
   ```

3. OnlyOffice does not present a browser admin UI to set up — it is embedded by a
   host application. Retrieve the auto-generated JWT secret, which the host
   application (Nextcloud, ownCloud, Seafile, a custom integration) must be
   configured with identically:

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~onlyoffice AND name~jwt" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT"
   ```

   Never rotate this secret once a host application has been configured with it —
   doing so breaks the trust between the Document Server and every connected
   application until all are updated with the new value.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — StatefulSet, pods, and persistent volume claims:

   ```bash
   kubectl get statefulset,pods,pvc -n "$NS"
   kubectl describe statefulset -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply). Each
   StatefulSet pod has its own independent 20Gi PVC — editing/session state is
   shared through Postgres and Redis, not the PVC, so scaling out is safe as long
   as both remain reachable. `session_affinity = "ClientIP"` keeps a client
   pinned to the same pod during a session.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds (pinning `latest` to a fixed
   `ONLYOFFICE_VERSION` at build time) and a rolling update replaces the pods.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~onlyoffice"
   kubectl get jobs -n "$NS"          # db-init job
   gcloud filestore instances list --project="$PROJECT"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=onlyoffice --project="$PROJECT"
   ```

6. **Check the shared Redis connection** — Redis is mandatory (session/editing
   state coordination across pods) and defaults to the co-located NFS-VM Redis
   when `redis_host` is left blank:

   ```bash
   kubectl exec -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" \
     -- env | grep -E 'REDIS_SERVER|DB_|JWT_'
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU and
   memory utilisation (the bundled stack defaults to 2 vCPU / 4Gi — watch for OOM
   during startup), restart counts, and PVC usage. The module can provision an
   **uptime check** (when the endpoint is publicly reachable); review Monitoring →
   Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with OnlyOffice releases.

- **Pod not Ready / CrashLoopBackOff:** the startup probe allows roughly 10 minutes
  of first-boot headroom (`/healthcheck`, 90s initial delay, 15s period, 40
  failures) — the bundled Postgres-client/Redis-client/RabbitMQ/nginx/converter
  stack is genuinely slow to come up. Give it time before assuming a failure, then
  inspect events and logs:
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  Auth Proxy sidecar (`enable_cloudsql_volume = true`) is running alongside the
  app container, and the `db-init` job completed.
- **Initialisation job failed:** inspect the job and its pod logs — it only
  provisions the role/database/grants; the Document Server installs its own
  schema on first boot:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Redis connection / editing-session errors:** `enable_redis = false` is
  rejected at plan time — Redis is mandatory. If `redis_host` was left blank,
  confirm the co-located NFS-VM is `RUNNING` (`enable_nfs` must be `true` in that
  case) and reachable from the pod.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an assigned
  IP (`reserve_static_ip = true` keeps it stable across redeploys).
- **PVC / SSD quota exhausted:** each StatefulSet pod holds a 20Gi
  `standard-rwo` (SSD) PVC that survives scale-to-zero; a wide campaign of
  stateful apps can exhaust the project's `SSD_TOTAL_GB` quota. Override
  `stateful_pvc_storage_class = "standard"` (HDD) if needed.
- **JWT integration failures:** verify the JWT secret value matches what is
  configured in the connected host application (Nextcloud, ownCloud, etc.).
  Retrieve the current value from Secret Manager as shown in Task 2.
- **Image build failed:** review Cloud Build history for the failed build's log.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rules never to rotate `JWT_SECRET` after
integrations exist, and never to change `database_type`, `enable_redis`, or the
application database name/user after first deploy).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, its block PVCs, Cloud SQL database, Secret Manager secrets, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared Cloud SQL, the NFS/Redis VM, registry) are managed separately and
are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE StatefulSet workload (block PVC + NFS), Cloud SQL (PostgreSQL 15), secrets, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; `/healthcheck` returns `true`; retrieve the JWT secret for host-app integration |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage/Redis, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, Redis, PVC/quota, and JWT integration issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
