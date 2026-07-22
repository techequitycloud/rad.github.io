---
title: "Jellystat on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Jellystat on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Jellystat on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Jellystat_GKE)**

## Overview

**Estimated time:** 45–75 minutes

Jellystat is an open-source statistics and analytics dashboard for Jellyfin
media servers. This lab takes you through the full operational lifecycle of
the **Jellystat on GKE Autopilot** module on Google Cloud: deploy it, access
and verify it, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Jellystat product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Jellystat_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect, scale, update, and manage secrets.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Cloud SQL, Artifact Registry, and shared service accounts
  this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** installed; `gcloud auth login` and
  `gcloud auth application-default login` completed.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.
- (Optional, for the pairing step in Task 2) A running **Jellyfin** server —
  deploy one first with the **Jellyfin (GKE)** or **Jellyfin (Cloud Run)**
  module if you don't already have one.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Click **Deploy** in the RAD platform top navigation, open **Jellystat
   (GKE)** from the **Platform Modules** list to start configuration, set
   `project_id`, and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Jellystat_GKE)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster (the
   official `cyfershepard/jellystat` prebuilt image — no build step),
   provisions a Cloud SQL (PostgreSQL 15) database with its Secret Manager
   secrets (`JWT_SECRET` and the database password), and runs a one-shot
   database-initialisation job. First deploys take roughly **15–25 minutes**
   (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic
   filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep jellystat | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy. Jellystat exposes a public, unauthenticated
   endpoint that responds only when the server is up:

   ```bash
   curl -s "http://${EXTERNAL_IP}/auth/isConfigured"   # expect 200 with a JSON body
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. On first visit Jellystat
   prompts you to create the initial administrator account — no pre-seeded
   admin credential exists in Secret Manager.

4. **Pair with a Jellyfin server (manual, cannot be automated).** After
   logging in:
   - In your Jellyfin server's own Dashboard → API Keys, generate a new API
     key for Jellystat.
   - In Jellystat's settings, enter your Jellyfin server's URL and paste in
     that API key.
   - Confirm Jellystat begins showing library/user data pulled from Jellyfin.
   There is no environment variable or Terraform input for this pairing — it
   is entirely UI-driven by design of the upstream application.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment and pods:

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update**
   on the deployment details page — the module owns the workload spec, so
   scaling is a configuration change, not a manual `kubectl scale` (a manual
   edit would be reverted on the next apply).

3. **Update the application version** by changing the version input in the
   RAD platform and applying it via **Update**; a rolling update replaces the
   pods with the updated `cyfershepard/jellystat:<tag>` image.

4. **Manage secrets and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~jellystat"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=jellystat_user --project="$PROJECT"
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
   and memory utilisation and restart counts. The module can provision an
   **uptime check** (when enabled); review Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These
are platform-level diagnostics and do not change with Jellystat releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup
  and liveness probes target `/auth/isConfigured`; a connection failure to
  PostgreSQL will keep the pod from becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`, the DB password secret materialised into the namespace, and the
  init job completed. Confirm the pod actually received
  `POSTGRES_IP`/`POSTGRES_USER`/`POSTGRES_DATABASE`/`POSTGRES_PASSWORD` (not
  just `DB_*`):
  ```bash
  kubectl exec -n "$NS" <pod> -- env | grep POSTGRES
  ```
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Jellystat shows no data even though the pod is healthy:** this is almost
  always the Jellyfin pairing step (Task 2, step 4) not having been completed
  yet — it is not automated by this module.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP.
- **Image pull errors:** confirm the image exists in Artifact Registry and
  the node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

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
secrets, and Artifact Registry images. Resources owned by **Services_GCP**
(the VPC, GKE cluster, shared Cloud SQL, registry) are managed separately and
are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), secrets, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; create the admin account; pair with a Jellyfin server |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
