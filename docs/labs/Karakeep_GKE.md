---
title: "Karakeep on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Karakeep on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Karakeep on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Karakeep_GKE)**

## Overview

**Estimated time:** 30–60 minutes

Karakeep is an open-source, self-hostable bookmark-everything app with
AI-based automatic tagging and full-text search. This lab takes you through the
full operational lifecycle of the **Karakeep on GKE Autopilot** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it, diagnose
common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Karakeep product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Karakeep_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it
  provisions, including the required Meilisearch search sidecar Service.
- Access and verify the running workload, and create the first (admin) account.
- Perform day-2 operations — inspect, scale limitations, update, and manage backups.
- Observe the workload and its search sidecar with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, NFS/Filestore, Artifact Registry, and shared service accounts this
  module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<deployment-namespace>"   # reported in the deployment Outputs
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Karakeep (GKE)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Karakeep_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions the Kubernetes workload, the required internal-only
   **Meilisearch** search sidecar as a second Service, the two application
   secrets (`NEXTAUTH_SECRET`, `MEILI_MASTER_KEY`), and mounts the shared NFS
   volume for both. There is no Cloud SQL step — first deploys are typically
   **5–10 minutes**.

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep karakeep | grep -v meilisearch | head -1 | cut -d/ -f2)
   EXTERNAL_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   MEILI_SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep meilisearch | head -1 | cut -d/ -f2)
   echo "Service: $SERVICE"
   echo "IP:      $EXTERNAL_IP"
   echo "Meilisearch sidecar: $MEILI_SERVICE"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is healthy and serving:

   ```bash
   kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"    # expect N/N Running, 0 restarts
   curl -s "http://$EXTERNAL_IP/" -o /dev/null -w '%{http_code} %{size_download}\n'   # expect 200 and >0 bytes
   ```

2. Open `http://$EXTERNAL_IP/` in a browser (or `kubectl port-forward` if
   `service_type = "ClusterIP"`). Karakeep shows its sign-up/login page.
   **Create the first account** — whoever registers first automatically becomes
   the admin. After creating it, save a bookmark to confirm the SQLite-over-NFS
   write path, and search for it by keyword to confirm the Meilisearch sidecar
   is reachable and indexing.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload and its rollout history:**

   ```bash
   kubectl get deploy "$SERVICE" -n "$NAMESPACE"
   kubectl rollout status deploy/"$SERVICE" -n "$NAMESPACE"
   ```

2. **Do not raise `max_instance_count` above 1.** Multiple pods writing the same
   SQLite file over NFS risks corruption — this module has no supported way to
   scale Karakeep horizontally.

3. **Update the application version tag** via the RAD platform's **Update**
   flow; a rolling `Recreate` deploy applies the new pulled image (no rebuild —
   the image comes straight from `ghcr.io/karakeep-app/karakeep`).

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~karakeep"
   ```

5. **Inspect the Meilisearch sidecar independently:**

   ```bash
   kubectl get pods -n "$NAMESPACE" -l app=meilisearch
   kubectl logs -n "$NAMESPACE" deploy/"$MEILI_SERVICE" --tail=50
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — the main app and the search sidecar log independently:

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
   kubectl logs -n "$NAMESPACE" deploy/"$MEILI_SERVICE" --tail=100
   ```

2. **Monitoring** — open the GKE Workloads dashboard for both the main app and
   the sidecar — a healthy main app with a struggling sidecar looks fine on the
   main app's own dashboard, so check both.

---

## Task 5 — Troubleshoot & debug [Manual]

- **Pod unhealthy / CrashLoopBackOff:** inspect pod events and logs. The startup
  probe targets `/` with a 30-second initial delay.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=200
  ```
- **App loads but search returns nothing:** the Meilisearch sidecar is likely
  down or `MEILI_ADDR` failed to inject — check its pod status and logs
  independently (Task 3, step 5).
- **Bookmarks don't persist / SQLite errors in logs:** confirm the NFS volume
  mounted successfully and no second replica is concurrently writing.
- **Rollout wedged after an update:** NFS-backed apps use `Recreate` deploy
  strategy automatically to avoid two pods briefly running against the same
  SQLite file — confirm the old pod fully terminated before the new one starts.
- **403 / permission errors:** verify the Workload Identity binding.

See the Configuration Guide's *Configuration Pitfalls* section for
setting-specific gotchas.

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible. If a
deployment is stuck and the RAD platform can no longer manage it, use **Purge**
instead — it removes the deployment from RAD's records **without** destroying
the cloud resources. This removes everything the module created — the
Kubernetes workload, both Services (main app and Meilisearch sidecar), and
Secret Manager secrets. Resources owned by **Services_GCP** (the VPC, GKE
cluster, shared NFS, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the GKE workload (main app + Meilisearch sidecar), NFS mount, and two secrets |
| 2 — Access & verify | Manual | Pod Ready 0 restarts; create the first (admin) account and save/search a bookmark |
| 3 — Operate | Manual | Inspect rollout, update version, manage secrets, inspect sidecar independently |
| 4 — Observe | Manual | Query Cloud Logging for both workloads; review Cloud Monitoring metrics |
| 5 — Troubleshoot | Manual | Diagnose pod, NFS, sidecar, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes both Services and secrets |
