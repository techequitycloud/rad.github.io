---
title: "Radicale on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Radicale on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Radicale on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Radicale_GKE)**

## Overview

**Estimated time:** 30–60 minutes

Radicale is an open-source, self-hosted CalDAV/CardDAV server for calendar
and contacts sync. This lab takes you through the full operational lifecycle
of the **Radicale on GKE Autopilot** module on Google Cloud: deploy it,
access and verify it, run it day-to-day, observe it, diagnose common
problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Radicale product features. For the complete list of provisioned
services and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Radicale_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform (with a production-style block PVC) and locate the resources it provisions.
- Access and verify the running workload, retrieve the generated admin credential, and connect a CalDAV/CardDAV client.
- Create a NEW calendar on GKE (which works natively, unlike Cloud Run) and understand where the pre-seeded defaults land when a PVC is used.
- Perform day-2 operations — inspect, scale, and update.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Artifact Registry, and shared service accounts this
  module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.
- (Optional) A CalDAV/CardDAV client to verify end-to-end sync — e.g. Thunderbird, Apple Calendar/Contacts, or DAVx5.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<deployment-namespace>"   # reported in the deployment Outputs
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Radicale (GKE)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Radicale_GKE)
   documents every input by group, with defaults. **Set
   `application_display_name = "Radicale"` explicitly** (the module's
   default currently carries a stale value inherited from its clone source),
   and **set `stateful_pvc_enabled = true`** for a production-style
   deployment with real block storage. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform provisions the Kubernetes workload (a StatefulSet when
   `stateful_pvc_enabled = true`, otherwise a Deployment backed by GCS
   FUSE), a Secret Manager secret holding a generated `ADMIN_PASSWORD`, and
   runs the `seed-default-collections` initialization Job. First deploys
   typically take **5–10 minutes**.

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep radicale | head -1 | cut -d/ -f2)
   EXTERNAL_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "Service: $SERVICE"
   echo "IP:      $EXTERNAL_IP"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is healthy and serving:

   ```bash
   kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"    # expect N/N Running, 0 restarts
   curl -s "http://$EXTERNAL_IP/" -o /dev/null -w '%{http_code}\n'   # expect 302
   ```

2. Radicale ships with **no built-in default admin account** — retrieve the
   generated credential from Secret Manager:

   ```bash
   SECRET=$(gcloud secrets list --project="$PROJECT" --filter="name~radicale-admin-password" \
     --format="value(name)" --limit=1)
   ADMIN_PASSWORD=$(gcloud secrets versions access latest --secret="$SECRET" --project="$PROJECT")
   echo "Username: admin"
   echo "Password: $ADMIN_PASSWORD"
   ```

3. Confirm authenticated access works with a `PROPFIND` against the admin's
   principal (expect `207 Multi-Status`):

   ```bash
   curl -s -u "admin:$ADMIN_PASSWORD" -X PROPFIND "http://$EXTERNAL_IP/admin/" \
     -H "Depth: 1" -o /dev/null -w '%{http_code}\n'
   ```

4. **If you deployed with `stateful_pvc_enabled = true`**, the pre-seeded
   Default Calendar/Default Address Book will **not** appear (the seed job
   cannot mount the StatefulSet's PVC — see Task 5). Create your first
   calendar directly — this works natively on GKE, unlike Cloud Run:

   ```bash
   curl -s -u "admin:$ADMIN_PASSWORD" -X MKCOL "http://$EXTERNAL_IP/admin/my-calendar/" \
     -o /dev/null -w '%{http_code}\n'   # expect 201 Created
   ```

   If you deployed **without** a PVC, connect a CalDAV/CardDAV client
   (Thunderbird, Apple Calendar, DAVx5) to `http://$EXTERNAL_IP/admin/` and
   you should see the pre-seeded **Default Calendar** and **Default Address
   Book**.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload and its rollout history:**

   ```bash
   kubectl get statefulset "$SERVICE" -n "$NAMESPACE"     # if stateful_pvc_enabled = true
   kubectl get deploy "$SERVICE" -n "$NAMESPACE"           # otherwise
   kubectl rollout status statefulset/"$SERVICE" -n "$NAMESPACE"
   ```

2. **Scale** — `max_instance_count` is pinned to `1` and should **not** be
   raised: Radicale's storage backend is not designed for concurrent
   multi-instance access. `min_instance_count` can be raised to `1` via the
   RAD platform's **Update** flow if you want to avoid cold starts.

3. **Update the application version tag** via the RAD platform's **Update**
   flow. Remember: Radicale's container registry tags have **no `v` prefix**
   (e.g. `3.7.7`, not `v3.7.7`).

4. **Manage secrets and the PVC:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~radicale"
   kubectl get jobs -n "$NAMESPACE"
   kubectl get pvc -n "$NAMESPACE"    # only when stateful_pvc_enabled = true
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs:**

   ```bash
   kubectl logs -n "$NAMESPACE" statefulset/"$SERVICE" --tail=100
   ```

2. **Monitoring** — open the GKE Workloads dashboard for the workload and
   review CPU/memory utilisation and replica count.

---

## Task 5 — Troubleshoot & debug [Manual]

- **Pod unhealthy / CrashLoopBackOff:** inspect pod events and logs. The
  startup probe targets `/`.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" statefulset/"$SERVICE" --tail=200
  ```
- **`seed-default-collections` succeeded, but no default calendar shows up
  on a PVC-backed deployment.** This is **expected, not a bug**, when
  `stateful_pvc_enabled = true`. The seed job (a shared Cloud-Run/GKE
  Common-module Job) only mounts the shared GCS `storage` bucket — it cannot
  attach to the StatefulSet's `ReadWriteOnce` block PVC, which is already
  held by the running pod. The job's writes land harmlessly in the unused
  GCS bucket. Create your first calendar via `curl -X MKCOL` or a real
  CalDAV client instead (see Task 2, step 4) — this works natively on GKE.
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<seed-default-collections-job-name>
  ```
- **PVC stuck `Pending`:** check the StorageClass and regional quota.
  `stateful_pvc_storage_class` defaults to `standard` (HDD) specifically to
  avoid the tight `SSD_TOTAL_GB` quota — if you overrode it to
  `standard-rwo`/`premium-rwo` (SSD), verify you have SSD quota headroom.
  ```bash
  kubectl describe pvc -n "$NAMESPACE"
  ```
- **401 Unauthorized on every request, even with the right-looking
  credential:** double-check you retrieved the *current* `ADMIN_PASSWORD`
  from Secret Manager, and that you're using `admin` (or your configured
  `ADMIN_USERNAME`), not an email address.
- **403 / permission errors:** verify the Workload Identity binding.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible. If a
deployment is stuck and the RAD platform can no longer manage it, use
**Purge** instead — it removes the deployment from RAD's records **without**
destroying the cloud resources. This removes everything the module created —
the Kubernetes workload, Service, PVC (if used), Secret Manager secrets, and
the GCS bucket. Resources owned by **Services_GCP** (the VPC, GKE cluster,
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the GKE workload (StatefulSet + PVC recommended), a generated admin secret, and runs the default-collection seed job |
| 2 — Access & verify | Manual | Pod Ready 0 restarts; retrieve the generated admin password; create/verify a calendar (MKCOL works natively on GKE) |
| 3 — Operate | Manual | Inspect rollout, understand the `max=1` scaling limit, update version, manage PVC |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics |
| 5 — Troubleshoot | Manual | Diagnose pod, seed-job/PVC-mount, and auth issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources, including the PVC and every stored collection |
