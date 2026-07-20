---
title: "Mealie on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Mealie on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Mealie on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Mealie_GKE)**

## Overview

**Estimated time:** 30–60 minutes

Mealie is an open-source, self-hosted recipe manager and meal planner with
automatic URL-import recipe scraping. This lab takes you through the full
operational lifecycle of the **Mealie on GKE Autopilot** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Mealie product features. For the complete list of provisioned services
and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Mealie_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running workload, and log in with the default admin credential.
- Perform day-2 operations — inspect, scale, update, and manage backups.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE
  Autopilot cluster, Cloud SQL, Artifact Registry, and shared service accounts
  this module depends on).
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

1. In the RAD platform, open **Mealie (GKE)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Mealie_GKE)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform provisions the Kubernetes workload, a Cloud SQL (PostgreSQL)
   database with its Secret Manager password secret, a `data` GCS bucket, and
   runs a one-shot database-initialisation Job. First deploys take roughly
   **15–25 minutes**.

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep mealie | head -1 | cut -d/ -f2)
   EXTERNAL_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "Service: $SERVICE"
   echo "IP:      $EXTERNAL_IP"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is healthy and serving:

   ```bash
   kubectl get pods -n "$NAMESPACE" -l app="$SERVICE"    # expect N/N Running, 0 restarts
   curl -s "http://$EXTERNAL_IP/" -o /dev/null -w '%{http_code} %{size_download}\n'
   ```

2. Mealie has **no environment-configurable initial admin credential** — as
   of v3.x, upstream hardcodes the same account on every fresh deployment.
   There is no secret to retrieve; the credential is public knowledge by
   design:

   ```text
   Email:    changeme@example.com
   Password: MyPassword
   ```

3. Open `http://$EXTERNAL_IP/` in a browser (or `kubectl port-forward` if
   `service_type = "ClusterIP"`) and log in with the credential above.
   Mealie forces a password reset on first login — **complete it
   immediately**, since the initial credential is well-known, not secret.
   Then create a recipe to confirm the database write path.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload and its rollout history:**

   ```bash
   kubectl get deploy "$SERVICE" -n "$NAMESPACE"
   kubectl rollout status deploy/"$SERVICE" -n "$NAMESPACE"
   ```

2. **Scale** by changing the min/max instance inputs via the RAD platform's
   **Update** flow.

3. **Update the application version tag** via the RAD platform's **Update**
   flow.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~mealie"
   kubectl get jobs -n "$NAMESPACE"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=mealie --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs:**

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
   ```

2. **Monitoring** — open the GKE Workloads dashboard for the deployment and
   review CPU/memory utilisation and replica count.

---

## Task 5 — Troubleshoot & debug [Manual]

- **Pod unhealthy / CrashLoopBackOff:** inspect pod events and logs. The
  startup probe targets `/api/app/about`.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=200
  ```
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE` and check the container logs for the resolved `POSTGRES_SERVER`
  value — on GKE it should be `127.0.0.1` (the cloud-sql-proxy sidecar).
- **Initialisation Job failed:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```
- **Can't log in with the default credential:** the fixed `changeme@example.com`
  / `MyPassword` account is only created on the *first* database
  initialisation — if a prior deploy already initialised the database (or the
  password was already reset), the original default no longer works; reset
  via Mealie's own UI/password-recovery flow instead.
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
the Kubernetes workload, Service, Cloud SQL database, Secret Manager secrets,
and the GCS bucket. Resources owned by **Services_GCP** (the VPC, GKE cluster,
shared Cloud SQL, registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the GKE workload, Cloud SQL (PostgreSQL), secrets, a GCS bucket, and runs DB init |
| 2 — Access & verify | Manual | Pod Ready 0 restarts; log in with the default admin credential and create a recipe |
| 3 — Operate | Manual | Inspect rollout, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
