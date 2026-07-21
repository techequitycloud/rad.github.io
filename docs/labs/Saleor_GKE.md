---
title: "Saleor on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Saleor on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Saleor on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Saleor_GKE)**

## Overview

**Estimated time:** 60–90 minutes

Saleor is an open-source, GraphQL-first headless e-commerce platform (product
catalog, checkout, orders, payment plugins) built on Python/Django. This lab takes
you through the full operational lifecycle of the **Saleor on GKE Autopilot**
module on Google Cloud: deploy it, access and verify it, run it day-to-day,
observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Saleor product features. For the complete list of provisioned services and every
configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Saleor_GKE) — this
lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify both the Saleor API and the separate Dashboard workload.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the VPC, GKE Autopilot
  cluster, Artifact Registry, and shared service accounts this module depends on).
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

1. In the RAD platform, open **Saleor (GKE)**, set `project_id`, and review the
   inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Saleor_GKE)
   documents every input by group, with defaults.

   > **IP quota note:** the module defaults `service_type = "LoadBalancer"`. If the
   > project's external IP quota (`IN_USE_ADDRESSES`) is exhausted, set
   > `service_type = "ClusterIP"` in the deployment inputs (or `config/deploy.tfvars`
   > for a maintainer apply) — this is exactly what the live reference deployment for
   > this module currently runs. Switch back to `LoadBalancer` (with
   > `reserve_static_ip = true`) once quota is available.

2. Review the estimated cost (if credits are enabled) and click **Deploy**, which
   opens the deployment status page with real-time logs.

3. The platform provisions two Kubernetes workloads (the main Saleor API and a
   separate Dashboard), a Cloud SQL (PostgreSQL 15) database with its Secret
   Manager secrets (`SECRET_KEY`, `RSA_PRIVATE_KEY`, `DJANGO_SUPERUSER_PASSWORD`,
   and the database password), a Cloud Storage `media` bucket, builds the custom
   container image, and runs two sequential database-initialization jobs
   (`db-init` then `db-migrate`). First deploys take roughly **20–35 minutes**
   (Cloud SQL and GKE cluster provisioning dominate).

4. When it completes, discover the resources with name-agnostic filters:

   ```bash
   NAMESPACE=$(kubectl get ns -o name | grep saleor | sed 's|namespace/||' | head -1)
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep -v dashboard | grep saleor | sed 's|service/||' | head -1)
   DASHBOARD=$(kubectl get svc -n "$NAMESPACE" -o name | grep dashboard | sed 's|service/||' | head -1)
   echo "Namespace: $NAMESPACE"
   echo "API svc:   $SERVICE"
   echo "Dashboard: $DASHBOARD"
   ```

---

## Task 2 — Access & verify [Manual]

1. If `service_type = "ClusterIP"` (the current default on the reference
   deployment because of exhausted IP quota — see Task 1), reach the services via
   port-forward:

   ```bash
   kubectl port-forward -n "$NAMESPACE" svc/"$SERVICE" 18080:8000 &
   kubectl port-forward -n "$NAMESPACE" svc/"$DASHBOARD" 18081:80 &
   curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:18080/health/"   # expect 200
   curl -s -X POST "http://localhost:18080/graphql/" \
     -H 'Content-Type: application/json' -d '{"query":"{ shop { name } }"}'
   ```

   If `service_type = "LoadBalancer"`, use the external IP from
   `kubectl get svc -n "$NAMESPACE"` instead.

2. Retrieve the bootstrap superuser credential and log in through the Dashboard:

   ```bash
   gcloud secrets versions access latest \
     --secret="$(gcloud secrets list --project="$PROJECT" --filter="name~saleor-admin-password" --format='value(name)')" \
     --project="$PROJECT"
   ```

   Open the Dashboard (via port-forward at `http://localhost:18081` or the
   external URL) and sign in with `admin@example.com` and the retrieved password.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload and its pods:**

   ```bash
   kubectl get deploy,pods,svc -n "$NAMESPACE"
   kubectl describe deploy "$SERVICE" -n "$NAMESPACE"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on the
   deployment details page — the module owns the workload spec, so scaling is a
   configuration change, not a manual `kubectl scale` (a manual edit would be
   reverted on the next apply, and would not persist Celery worker CPU
   guarantees).

3. **Update the application version tag** by changing `application_version` in the
   RAD platform and applying it via **Update**; a new image builds (mapped to the
   `SALEOR_VERSION` build ARG) and a rolling update deploys.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~saleor"
   kubectl get jobs -n "$NAMESPACE"   # db-init, db-migrate, scheduled backup jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=saleor_user --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer, for both workloads:

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
   kubectl logs -n "$NAMESPACE" deploy/"$DASHBOARD" --tail=100
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — review GKE workload CPU/memory utilisation in the Console
   (Kubernetes Engine → Workloads). The module can provision an **uptime check**
   (when `uptime_check_config.enabled = true` — it defaults to `false`, and
   requires a publicly reachable endpoint, i.e. `service_type = "LoadBalancer"`);
   confirm it is green under Monitoring → Uptime checks if enabled.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Saleor releases.

- **Pod not Ready:** inspect events and logs; the startup probe targets `/health/`
  with a 90-second initial delay (giving `db-migrate` time to complete first).
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=200
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`, the
  Cloud SQL Auth Proxy sidecar is healthy, and both `db-init` and `db-migrate`
  completed successfully (in order — `db-migrate` depends on `db-init`).
- **Initialisation job failed:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/db-init
  kubectl logs -n "$NAMESPACE" job/db-migrate
  ```
- **GraphQL query fails with a database error even though the pod is Ready:**
  usually means `db-migrate` did not complete — check its job logs before assuming
  an application bug.
- **Service unreachable from a browser:** confirm `service_type` — if it is
  `ClusterIP` (the current state on the reference deployment due to exhausted IP
  quota), you must use `kubectl port-forward`; there is no external IP by design
  until it is switched to `LoadBalancer`.
- **Dashboard loads but can't reach the API:** the Dashboard's `API_URL` is baked
  into its static bundle at container start from `$(GKE_SERVICE_URL)` — if the
  Service was recreated with a different name/IP, the Dashboard needs to be
  redeployed to pick up the corrected URL.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **403 / permission errors:** verify the workload's Workload Identity bindings.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `RSA_PRIVATE_KEY` outside a
maintenance window).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform can
no longer manage it (for example after manual changes that conflict with the
Terraform state), use **Purge** instead — it removes the deployment from RAD's
records **without** destroying the cloud resources (it makes RAD forget the
project). Delete removes everything the module created — both Kubernetes workloads
(API and Dashboard), the Cloud SQL database, Secret Manager secrets, the GCS
`media` bucket, and Artifact Registry images. Resources owned by **Services_GCP**
(the VPC, GKE Autopilot cluster, shared Cloud SQL instance, registry) are managed
separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions two GKE workloads (API + Dashboard), Cloud SQL (PostgreSQL 15), secrets, `media` bucket, and runs `db-init` → `db-migrate` |
| 2 — Access & verify | Manual | Health check and GraphQL query pass (via port-forward if `ClusterIP`); log into the Dashboard with the bootstrap admin credential |
| 3 — Operate | Manual | Inspect workload, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review GKE workload metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, Dashboard-linkage, build, and Workload Identity issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
