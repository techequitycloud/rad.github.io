---
title: "Dolibarr on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Dolibarr on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Dolibarr on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Dolibarr_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Dolibarr is a free, open-source ERP and CRM suite covering customers and prospects,
quotes, orders, invoices, products and stock, HR, projects, and accounting. This
lab takes you through the full operational lifecycle of the **Dolibarr on GKE
Autopilot** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Dolibarr product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Dolibarr_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

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
  cluster, Cloud SQL, Cloud Filestore (NFS), Artifact Registry, and shared service
  accounts this module depends on).
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

1. Click **Deploy** in the RAD platform top navigation, open **Dolibarr (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Dolibarr_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (MySQL 8.0) database with its Secret Manager secrets
   (`DOLI_ADMIN_PASSWORD`, `DOLI_INSTANCE_UNIQUE_ID`, and the database password), a
   Cloud Filestore (NFS) share mounted at `/var/lib/dolibarr`, a `dolibarr-documents`
   Cloud Storage bucket, builds the container image, and runs a one-shot
   database-initialisation job. Dolibarr's own installer then creates the schema on
   first pod start (`DOLI_INSTALL_AUTO = 1`) — there is no separate migration job.
   First deploys take roughly **20–35 minutes** (Cloud SQL and Filestore creation
   dominate).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep dolibarr | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. The startup probe is **TCP** on port 80 and the
   liveness probe is **HTTP `GET /`** (the login page returns 200 with no auth).
   Allow several minutes on first boot for the Dolibarr installer to run:

   ```bash
   curl -s -o /dev/null -w "%{http_code}" "http://${EXTERNAL_IP}/"   # expect 200
   ```

3. Retrieve the auto-generated super-admin password before your first login:

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~dolibarr AND name~admin-password" --format="value(name)" --limit=1)
   gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project="$PROJECT"
   ```

   Log in at `http://${EXTERNAL_IP}` with username `admin` (the `DOLI_ADMIN_LOGIN`
   default) and the password above.

4. Set `DOLI_URL_ROOT` now that the external IP is known, so absolute links and the
   login redirect resolve correctly — it is not preset on GKE. Either add it to
   `environment_variables` in the RAD platform and click **Update**, or patch the
   running Deployment directly:

   ```bash
   SVC=$(kubectl get svc -n "$NS" -o jsonpath='{.items[0].metadata.name}')
   kubectl patch deploy "$SVC" -n "$NS" \
     -p '{"spec":{"template":{"spec":{"containers":[{"name":"dolibarr","env":[
       {"name":"DOLI_URL_ROOT","value":"http://'"$EXTERNAL_IP"'"}]}]}}}}'
   ```

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — Deployment, pods, PVC (Filestore-backed), and events:

   ```bash
   kubectl get deploy,pods,pvc -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply). Keep
   `max_instance_count = 1` unless you have verified Dolibarr's shared-session and
   NFS-lock behaviour under multiple pods; the workload uses the `Recreate` update
   strategy specifically because it is NFS-backed (a rolling update would run two
   pods against the same NFS volume and DB and deadlock).

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds and the pod is recreated, running
   Dolibarr's own upgrade steps at boot.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~dolibarr"
   gcloud storage buckets list --project="$PROJECT" --filter="name~dolibarr-documents"
   gcloud filestore instances list --project="$PROJECT"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=dolibarr --project="$PROJECT"
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
   memory utilisation, restart counts, and request metrics, plus the Cloud SQL and
   Filestore instance dashboards. The module can provision an **uptime check** (when
   enabled); review Monitoring → Uptime checks and Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Dolibarr releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The liveness probe
  targets `GET /`; a connection failure to Cloud SQL (via the Auth Proxy sidecar on
  `127.0.0.1:3306`) will keep the pod from becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  kubectl exec -n "$NS" deploy/<service-name> -- env | grep DOLI_DB
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret materialised into the namespace, and the `db-init` job completed
  (it is safe to re-run; `max_retries = 3`).
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-init-job-name>
  ```
- **Installer loops or shows DB errors on first boot:** confirm the `db-init` job ran
  to completion before the first browser visit — `DOLI_INSTALL_AUTO = 1` needs an
  empty, reachable database to create the schema against.
- **Documents/PDFs disappear after a pod restart:** confirm `enable_nfs = true` and
  that the PVC is bound to the Filestore share at `/var/lib/dolibarr` — a disabled
  or unmounted NFS volume makes uploads ephemeral.
  ```bash
  kubectl get pvc -n "$NS"
  gcloud filestore instances list --project="$PROJECT"
  ```
- **Rollout stuck on update (`1 old replicas are pending termination`):** expected
  behaviour for the `Recreate` strategy — the old pod must fully terminate before the
  new one starts, so a brief outage during updates is normal, not a hang. If it
  persists well beyond a minute, check for a stuck NFS/DB lock from the old pod.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls & Sensible Defaults* section
for setting-specific gotchas (including the critical rules never to change
`application_database_name`/`application_database_user` or the auto-generated
`DOLI_INSTANCE_UNIQUE_ID` after first boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Cloud Filestore share, Secret Manager secrets,
GCS buckets, and Artifact Registry images. Resources owned by **Services_GCP** (the
VPC, GKE cluster, shared Cloud SQL, registry) are managed separately and are not
removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (MySQL 8.0), Filestore (NFS), secrets, storage bucket, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; retrieve admin password and log in; set `DOLI_URL_ROOT` |
| 3 — Operate | Manual | Inspect workload, scale (with NFS/lock caveats), update version, manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, NFS, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
