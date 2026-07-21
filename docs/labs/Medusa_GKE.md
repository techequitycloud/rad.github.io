---
title: "Medusa on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Medusa on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Medusa on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Medusa_GKE)**

## Overview

**Estimated time:** 60–90 minutes — this is one of the longest labs in this
catalogue. Unlike almost every other application module here, `Medusa_GKE`
builds its container image **from source** (there is no official Medusa
Docker image), and it runs a **four-stage** initialization chain instead of
the usual one or two jobs. Both add real, observable time to a first deploy on
top of normal Cloud SQL provisioning.

Medusa is an open-source, headless e-commerce platform — API-first, with full
programmatic control over products, carts, orders, customers, and payments,
plus a built-in Admin UI served by the same process. This lab takes you
through the full operational lifecycle of the **Medusa on GKE Autopilot**
module on Google Cloud: deploy it, access and verify it, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Medusa's e-commerce product features. For the complete list of
provisioned services and every configuration input (organised by group), see
the [Configuration Guide](https://docs.radmodules.dev/docs/modules/Medusa_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and understand why it takes longer
  than most modules in this catalogue.
- Connect to the GKE cluster and access the running workload, including the
  built-in Admin UI.
- Perform day-2 operations — inspect, scale, update, and manage secrets.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues,
  including image **build** failures — a class of failure this module is
  uniquely exposed to.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Cloud SQL, Artifact Registry, and shared service
  accounts this module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** and **kubectl** installed; `gcloud auth login` and `gcloud
  auth application-default login` completed.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"           # the region you deploy into
```

---

## Task 1 — Deploy the module [Automated]

1. Click **Deploy** in the RAD platform, open **Medusa (GKE)** from the
   **Platform Modules** list, set `project_id`, and review the inputs.
   Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Medusa_GKE)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. **This deploy takes noticeably longer than most modules in this
   catalogue.** Three phases run mostly in sequence:
   - **Image build (~10 minutes):** Cloud Build clones `medusajs/dtc-starter`,
     runs `pnpm install` and `medusa build`, then packages a runtime image —
     a genuine `git clone` + dependency install + application build, not just
     a `docker pull`.
   - **Cloud SQL provisioning (~20–35 minutes on a first deploy):** standard
     for any PostgreSQL-backed module in this catalogue, but dominates the
     overall timeline.
   - **The four-stage init chain (Kubernetes Jobs):** `db-init` →
     `medusa-migrate` → `medusa-verify` → `medusa-admin-create`, each waiting
     on the previous and each showing real multi-minute latency in practice
     (`medusa-migrate` alone is allotted up to 30 minutes).

   Altogether, budget **30–45+ minutes** for a first deploy — this is
   expected, not a sign of a stuck deployment. Watch the live log stream for
   progress through each phase rather than assuming a hang.

3. Connect to the cluster and discover the namespace with name-agnostic
   filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep medusa | head -1 | cut -d/ -f2)
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

2. Confirm the service is healthy:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/health"   # expect 200
   ```

3. Retrieve the auto-created admin credentials from Secret Manager — unlike
   many apps in this catalogue, Medusa's first admin user is bootstrapped
   automatically by the `medusa-admin-create` init job, not created
   interactively on first visit:

   ```bash
   ADMIN_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~medusa-admin-password" --format="value(name)")
   ADMIN_PASSWORD=$(gcloud secrets versions access latest \
     --secret="$ADMIN_SECRET" --project="$PROJECT")
   echo "Admin password: $ADMIN_PASSWORD"
   # Admin email is whatever admin_email was set to at deploy time
   # (default: admin@techequity.cloud)
   ```

4. Open `http://${EXTERNAL_IP}/app` in a browser — Medusa serves its built-in
   Admin UI from the same process and port as the API. Sign in with the
   retrieved email/password.

5. Browse the seeded demo data. On a fresh install, `medusa-migrate` seeds
   sample store/region/product/inventory data as part of Medusa's own
   migration process — you should see a demo product catalogue already
   populated in the Admin UI (Products, Regions) without any manual setup.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload** — deployment and pods:

   ```bash
   kubectl get deploy,pods -n "$NS"
   kubectl describe deploy -n "$NS"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update**
   on the deployment details page. Note the scaling implication specific to
   this module: `MEDUSA_WORKER_MODE = "shared"` means **every** running pod
   handles both API requests and Medusa's background jobs/subscribers/
   workflows — there is no separate worker tier to scale independently.
   Scaling up adds redundant capacity for both request serving and background
   work together, not one or the other. Unlike Cloud Run, GKE has no
   request-based CPU throttling — each pod's CPU limit is available
   continuously regardless of inbound traffic.

3. **Update the application version.** Changing the version input and
   applying via **Update** does **not** simply swap an image tag — because
   there is no upstream image, this triggers a full Cloud Build rebuild
   (~10 minutes for the build step) from source, followed by a rolling
   update of the pods. `application_version` itself doesn't even select what
   gets rebuilt (the Dockerfile has no `ARG` consuming it); only
   `MEDUSA_STARTER_REF` (fixed to the `main` branch of `dtc-starter`)
   determines what code is pulled.

4. **Manage secrets and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~medusa"
   kubectl get jobs -n "$NS"          # the four init jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=medusa --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from `kubectl` or the Logs Explorer:

   ```bash
   kubectl logs -n "$NS" deploy/"$(kubectl get deploy -n "$NS" -o jsonpath='{.items[0].metadata.name}')" --tail=50
   ```

   Look for `"Server is ready on port: 9000"` confirming a healthy boot.
   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE / Kubernetes dashboards and review pod CPU
   and memory utilisation and restart counts. If a pod is being OOM-killed
   under combined API + background-workflow load, consider raising
   `container_resources.memory_limit` above its 1Gi default.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Medusa releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database or Redis connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`, the DB password secret materialised into the namespace, and
  that Redis is actually reachable — remember Medusa logs the deceptively
  calm `"redisUrl not found. A fake redis instance will be used."` and boots
  anyway rather than failing outright, so a missing Redis connection can look
  like a healthy deploy that misbehaves under load.
- **Migration or verification failures:** inspect the job and its pod logs.
  `medusa-verify` is designed to fail the apply loudly (rather than silently
  shipping a healthy-looking pod against an empty database) — if it failed,
  the error message names the table count it found:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<service-name>-medusa-migrate
  kubectl logs -n "$NS" job/<service-name>-medusa-verify
  ```
- **Image build failures — the failure mode most distinctive to this
  module.** Because the image is built from source on every deploy, this
  module is the one in the batch most likely to hit a genuine Cloud Build
  failure — e.g. an upstream change to the `dtc-starter` repository breaking
  the clone, `pnpm install`, or `medusa build` step. Review the Cloud Build
  history for the failed build's full log:
  ```bash
  gcloud builds list --project="$PROJECT" --limit=5
  gcloud builds log <build-id> --project="$PROJECT"
  ```
  A build failing with `"medusa: not found"` at container start time (rather
  than at build time) is the pnpm workspace-isolation bug documented in the
  Configuration Guide's *Configuration Pitfalls* — the fix already lives in
  the shipped Dockerfile, but is worth recognising if you ever modify it.
  When a Cloud-Run-only version of this kind of issue looks like a permanent
  hang with no diagnosable cause from logs alone, GKE's `kubectl exec` shell
  access is a genuine advantage — `kubectl exec <pod> -- ps aux` can show
  whether a slow boot step is still genuinely progressing or has stalled.
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP.

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
secrets, and Artifact Registry images (plus any GCS bucket, if
`enable_gcs_storage` was enabled). Resources owned by **Services_GCP** (the
VPC, GKE cluster, shared Cloud SQL, registry) are managed separately and are
not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module builds the Medusa image from source (~10 min), deploys onto GKE Autopilot with Cloud SQL (PostgreSQL 15), secrets, and runs the four-stage init chain (~30–45+ min total) |
| 2 — Access & verify | Manual | Connect to the cluster; health check passes; retrieve auto-created admin credentials from Secret Manager; log into the built-in Admin UI at `/app`; browse seeded demo products |
| 3 — Operate | Manual | Inspect workload, scale (shared worker mode — every pod does both API + background work), update version (triggers a full source rebuild), manage secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics |
| 5 — Troubleshoot | Manual | Diagnose pod, database/Redis, migration/verify-job, scheduling, and **image build** issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
