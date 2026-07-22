---
title: "Linkwarden on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Linkwarden on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Linkwarden on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Linkwarden_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Linkwarden is an open-source, self-hosted bookmark manager with full-page
archiving (screenshot, PDF, and single-file "monolith" snapshots via a bundled
headless Chrome). This lab takes you through the full operational lifecycle of
the **Linkwarden on GKE Autopilot** module on Google Cloud: deploy it, access
and verify it, run it day-to-day, observe it, diagnose common problems, and
tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Linkwarden product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Linkwarden_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it
  provisions.
- Connect to the GKE cluster and access the running workload.
- Perform day-2 operations — inspect, scale, update, and manage secrets and
  storage.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Cloud SQL, Artifact Registry, and shared service
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

1. Click **Deploy** in the RAD platform top navigation, open **Linkwarden
   (GKE)** from the **Platform Modules** list to start configuration, set
   `project_id`, and review the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Linkwarden_GKE)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform deploys the workload into the GKE Autopilot cluster,
   provisions a Cloud SQL (PostgreSQL 15) database with its Secret Manager
   secrets (`NEXTAUTH_SECRET` and the database password), a Cloud Storage
   bucket mounted at `/data/data` for archived content, builds the custom
   container image (a thin wrapper around `ghcr.io/linkwarden/linkwarden`),
   and runs a one-shot database-initialisation job. First deploys take
   roughly **20–35 minutes** (Cloud SQL creation dominates).

3. Connect to the cluster and discover the namespace with name-agnostic
   filters:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NS=$(kubectl get ns -o name | grep linkwarden | head -1 | cut -d/ -f2)
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

2. Confirm the service responds (Linkwarden has no confirmed dedicated health
   endpoint, so the root page is the best signal):

   ```bash
   curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "http://${EXTERNAL_IP}"
   # expect 200 and a non-trivial byte size (a rendered page, not an empty body)
   ```

3. Open `http://${EXTERNAL_IP}` in a browser. On first visit Linkwarden shows
   the registration page — no pre-seeded admin credential exists in Secret
   Manager. Register the first account; it automatically becomes the
   instance owner.

4. **Verify archiving end-to-end (the real stateful test).** Log in, add a
   bookmark (any public URL), and wait 10–30 seconds for the background
   archiving worker to process it. Refresh the link's detail view and confirm
   a screenshot/preview has been generated — this proves the DB write, the
   background worker, headless Chrome, and the GCS-backed storage mount are
   all correctly wired.

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
   edit would be reverted on the next apply). Keep `min_instance_count >= 1`
   — GKE has no scale-to-zero, and the in-container background archiving
   worker needs to keep running. Session affinity (`ClientIP`) is set by
   default to keep NextAuth session cookies stable.

3. **Update the application version** by changing the version input in the
   RAD platform and applying it via **Update**; a new image builds and a
   rolling update replaces the pods. Linkwarden publishes a genuine `latest`
   tag upstream, so `latest` tracks the real upstream release.

4. **Manage secrets, storage, and jobs:**

   ```bash
   kubectl get secrets -n "$NS"
   gcloud secrets list --project="$PROJECT" --filter="name~linkwarden"
   kubectl get jobs -n "$NS"          # db-init job
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=linkwarden --project="$PROJECT"
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
   and memory utilisation (watch for spikes during archive-worker batches),
   restart counts, and request metrics. The module can provision an
   **uptime check** (when enabled); review Monitoring → Uptime checks and
   Alerting → Policies.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Linkwarden releases.

- **Pod not Ready / CrashLoopBackOff:** inspect events and logs. The startup
  probe defaults to `/` with a generous window for Next.js cold start plus
  headless Chrome/Playwright initialization; a connection failure to
  PostgreSQL will keep the pod from becoming Ready.
  ```bash
  kubectl describe pod -n "$NS" <pod>          # Events section shows scheduling/probe/mount errors
  kubectl logs -n "$NS" <pod> --previous       # logs from the crashed container
  ```
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE`, the DB password secret materialised into the namespace, and the
  init job completed. Linkwarden's `DATABASE_URL` connects over the
  cloud-sql-proxy sidecar's loopback (`127.0.0.1`) on GKE with
  `sslmode=disable` — confirm the sidecar container in the pod is healthy if
  connections fail.
- **Archiving never completes / links stay un-previewed:** first confirm the
  pod itself is `Ready` (Task 2). If it is, use `kubectl logs` to check for a
  headless Chrome/Playwright launch failure in the worker's output. Unlike
  Cloud Run's gVisor sandbox, GKE runs on real Linux nodes, so this class of
  platform-sandbox incompatibility is far less likely here — a genuine
  archiving failure is more likely a memory constraint (`container_resources.
  memory_limit` too low) or a `disable_browser` misconfiguration.
- **Initialisation job failed:** inspect the job and its pod logs:
  ```bash
  kubectl get jobs -n "$NS"
  kubectl logs -n "$NS" job/<job-name>
  ```
- **Pending pod / no external IP:** check `kubectl describe pod` events for
  resource or quota issues, and confirm the LoadBalancer Service has an
  assigned IP (`reserve_static_ip = true` by default, so the IP should be
  stable across redeploys).
- **Image pull errors:** confirm the image exists in Artifact Registry and
  the node service account can pull it.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas (including the critical rule never to rotate
`NEXTAUTH_SECRET` after first boot).

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
secrets, GCS buckets, and Artifact Registry images. Resources owned by
**Services_GCP** (the VPC, GKE cluster, shared Cloud SQL, registry) are
managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module deploys the GKE workload, Cloud SQL (PostgreSQL 15), secrets, GCS storage bucket, and runs DB init |
| 2 — Access & verify | Manual | Connect to the cluster; service responds; register the first account (becomes owner); confirm archiving completes end-to-end |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/storage, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, archiving, init-job, scheduling, and image-pull issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
