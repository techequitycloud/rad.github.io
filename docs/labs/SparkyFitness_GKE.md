---
title: "SparkyFitness on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy SparkyFitness on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# SparkyFitness on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/SparkyFitness_GKE)**

## Overview

**Estimated time:** 45–75 minutes

SparkyFitness is a self-hosted, AI-assisted family food, fitness, water, and health
tracker. This lab takes you through the full operational lifecycle of the
**SparkyFitness on GKE Autopilot** module on Google Cloud: deploy it, access and
verify it, run it day-to-day, observe it, diagnose common problems, and tear it
down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on SparkyFitness product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/SparkyFitness_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running application (backend + frontend as separate
  Deployments/Services).
- Perform day-2 operations — inspect, scale, update, and manage secrets.
- Observe the workloads with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Cloud SQL, Artifact Registry, and shared service accounts this module
  depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<namespace-from-outputs>"
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **SparkyFitness (GKE)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/SparkyFitness_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status page
   with real-time logs.

2. The platform provisions the **backend** as the main Deployment/Service, the
   **frontend** as a separate `additional_services` Deployment/Service with a
   **reserved static external LoadBalancer IP**, a Cloud SQL (PostgreSQL 15)
   database with its Secret Manager secrets
   (`SPARKY_FITNESS_API_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`,
   `SPARKY_FITNESS_APP_DB_PASSWORD`, and the database password), and runs a one-shot
   `db-init` job. First deploys take roughly **20–30 minutes** (Cloud SQL and cluster
   provisioning dominate). Both container images are prebuilt — no application build
   step runs.

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   kubectl get deployments -n "$NAMESPACE"
   FRONTEND_IP=$(kubectl get service -n "$NAMESPACE" \
     -l app.kubernetes.io/component=frontend -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}' 2>/dev/null || \
     kubectl get services -n "$NAMESPACE" -o wide | grep frontend)
   echo "Frontend: http://$FRONTEND_IP"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the frontend Service has a real external IP and serves:

   ```bash
   kubectl get service -n "$NAMESPACE" -o wide
   curl -s -o /dev/null -w '%{http_code}\n' "http://$FRONTEND_IP"   # expect 200
   ```

2. Open `http://$FRONTEND_IP` in a browser. On first visit, sign up to create the
   first user account — SparkyFitness has no pre-seeded admin credential in Secret
   Manager. `admin_email` only ELEVATES an existing account, it does not create one,
   so signup must happen first.

3. After creating the account, set `admin_email` in the RAD platform and click
   **Update** to grant it admin privileges. Consider setting `disable_signup = true`
   afterward.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect both Deployments and their pods:**

   ```bash
   kubectl get deployments -n "$NAMESPACE"
   kubectl get pods -n "$NAMESPACE" -o wide
   kubectl describe deployment <backend-deployment> -n "$NAMESPACE"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply, though `kubectl scale --replicas=0` is fine
   temporarily for cost-saving between sessions).

3. **Update the application version tag** by changing `application_version` in the
   RAD platform and applying it via **Update**. It tags BOTH the frontend and
   backend images identically — use the exact upstream tag format (e.g. `v0.17.3`,
   not a bare `0.17.3`).

4. **Manage secrets:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~sparkyfitness"
   kubectl get secret -n "$NAMESPACE"
   ```

5. **Open a database session** for inspection or maintenance (connect as the admin
   role — the app-level role is managed internally by the backend):

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=sparky --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer, per Deployment:

   ```bash
   kubectl logs -n "$NAMESPACE" deployment/<backend-deployment> --tail=100
   kubectl logs -n "$NAMESPACE" deployment/<frontend-deployment> --tail=100
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — open the GKE Workloads dashboard and review pod restarts,
   CPU/memory utilisation, and request latency (if configured). Review Monitoring →
   Uptime checks / Alerting → Policies if enabled.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with SparkyFitness releases.

- **Frontend pod healthy but `/api/*` calls hang:** the frontend proxies to the
  backend's Service on port **80** (the fixed App_GKE Service port), not
  `container_port` (3010) — verify with `kubectl get service <backend-service> -n "$NAMESPACE"`
  that port 80 exists and maps to the backend's targetPort.
  ```bash
  kubectl get pods -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deployment/<frontend-deployment> --tail=50
  ```
- **Backend pod CrashLoopBackOff:** check for a database connection failure —
  confirm the Cloud SQL Auth Proxy sidecar is healthy and the instance is `RUNNABLE`.
  ```bash
  kubectl describe pod <backend-pod> -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" <backend-pod> -c cloud-sql-proxy
  ```
- **`db-init` job failed:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/db-init
  ```
- **Frontend LoadBalancer has no external IP:** the reserved static IP
  (`google_compute_address`) may be exhausted against the project's global
  `IN_USE_ADDRESSES` quota — check `gcloud compute addresses list --project "$PROJECT"`.
- **403 / permission errors:** verify the workload service account's IAM roles.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `BETTER_AUTH_SECRET` after
users enable 2FA).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can
no longer manage it (for example after manual changes that conflict with the
Terraform state), use **Purge** instead — it removes the deployment from RAD's
records **without** destroying the cloud resources (it makes RAD forget the
project). Delete removes everything the module created — both Deployments/Services,
the reserved frontend static IP, Cloud SQL database, and Secret Manager secrets.
Resources owned by **Services_GCP** (the VPC, GKE cluster, shared Cloud SQL,
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions backend + frontend Deployments/Services, Cloud SQL (PostgreSQL 15), secrets, and runs DB init |
| 2 — Access & verify | Manual | Frontend LB serves 200; sign up to create the first account, then set `admin_email` |
| 3 — Operate | Manual | Inspect Deployments/pods, scale, update version, manage secrets, DB access |
| 4 — Observe | Manual | Query Cloud Logging per Deployment; review GKE Workloads dashboard |
| 5 — Troubleshoot | Manual | Diagnose frontend/backend pods, database, init-job, and IP-quota issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
