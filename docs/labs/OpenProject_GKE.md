---
title: "OpenProject on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy OpenProject on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# OpenProject on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenProject_GKE)**

## Overview

**Estimated time:** 45–90 minutes

OpenProject is an open-source project-management and collaboration suite — work
packages, Gantt timelines, agile boards, wikis, time tracking, and budgets. This lab
takes you through the full operational lifecycle of the **OpenProject on GKE
Autopilot** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not on
OpenProject product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenProject_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running workload, including the first-login password change.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Artifact Registry, and shared service accounts this module
  depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** authenticated: `gcloud auth login` and
  `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Click **Deploy** in the RAD platform top navigation, open **OpenProject (GKE)** from the **Platform Modules** list to start configuration, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/OpenProject_GKE)
   documents every input by group, with defaults. Review the estimated cost (if credits are enabled) and click **Deploy**, which opens the deployment status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster, provisions a
   Cloud SQL (PostgreSQL 15) database with its Secret Manager secrets
   (`SECRET_KEY_BASE` and the database password), a Cloud Filestore NFS instance for
   attachment storage, builds the container image, and runs the two initialization
   jobs — `db-init` (role + database) then `db-migrate` (`rake db:migrate db:seed`).
   First deploys take roughly **25–40 minutes** (Cloud SQL creation and the migration
   seed dominate).

3. Connect to the cluster and discover the namespace with name-agnostic filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep openproject | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. OpenProject exposes a health endpoint that
   responds only when Rails is fully initialised and PostgreSQL is reachable (send it
   the external host so Rails Host Authorization accepts the `Host` header):

   ```bash
   curl -s "http://${EXTERNAL_IP}/health_checks/default"   # expect "PASSED" / HTTP 200
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. Sign in with the seeded credentials
   **`admin` / `admin`** — OpenProject immediately forces you to set a new admin
   password. Set a strong one and store it in your password manager. Then create your
   first project and confirm work packages, the wiki, and attachments work
   (attachments are written to the NFS mount, shared across pods).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment, pods, and the horizontal autoscaler:

   ```bash
   kubectl get deploy,pods,hpa,pvc,pdb -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the deployment details page —
   the module owns the workload spec, so scaling is a configuration change, not a
   manual `kubectl scale` (a manual edit would be reverted on the next apply). Session
   affinity (`ClientIP`) keeps UI sessions stable, and a PodDisruptionBudget keeps
   pods serving through node upgrades. Note that NFS-backed rollouts use the
   `Recreate` strategy, so an update briefly takes the workload down while the old pod
   terminates before the new one starts.

3. **Update the application version** by changing the version input in the RAD platform
   and applying it via **Update**; a new image builds, the `db-migrate` job runs any
   new migrations, and the pods are replaced. OpenProject publishes numeric major tags
   only — pin to a specific major (e.g. `16`) rather than `latest`.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~openproject"
   kubectl get jobs -n "$NS"          # db-init, db-migrate, and any scheduled jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=openproject --project="$PROJECT"
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
   memory utilisation, restart counts, and request metrics. The module can provision
   an **uptime check** (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with OpenProject releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. Both the startup and
  liveness probes are **TCP** (Puma port-listening) — an HTTP probe would fail Rails
  Host Authorization (`400 Invalid host_name`), so do not switch them to HTTP.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events: scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **"You have N pending migrations" in logs:** the `db-migrate` job did not complete.
  Inspect the job and its pod logs — the migrate job is self-verifying, so a real
  failure fails the apply loudly rather than shipping an empty DB.
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<db-migrate-job-name>
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  DB password secret materialised into the namespace, the Cloud SQL Auth Proxy sidecar
  is running (`enable_cloudsql_volume = true` on GKE), and the init jobs completed.
- **Attachments disappear when a pod moves:** confirm `enable_nfs = true` and that the
  Filestore instance and its PVC are healthy.
- **Pending pod / no external IP:** check `kubectl describe pod` events for resource
  or quota issues, and confirm the LoadBalancer Service has an assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and the node
  service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `SECRET_KEY_BASE` after first
boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon (**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment record is retained for history). If a deployment is stuck and the RAD platform can no longer manage it (for example after manual changes that conflict with the Terraform state), use **Purge** instead — it removes the deployment from RAD's records **without** destroying the cloud resources (it makes RAD forget the project). This removes everything the module created — the Kubernetes workload
and namespace, Cloud SQL database, Secret Manager secrets, Filestore instance, and
Artifact Registry images. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), secrets, Filestore, and runs `db-init` + `db-migrate` |
| 2 — Access & verify | Manual | Health check passes; sign in as `admin`/`admin` and set a new password |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, migration, database, NFS, IP, and image issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
