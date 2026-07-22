---
title: "Ghostfolio on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Ghostfolio on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Ghostfolio on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ghostfolio_GKE)**

## Overview

**Estimated time:** 45–90 minutes

Ghostfolio is an open-source wealth management application for tracking net worth,
investment portfolios, and asset allocation across multiple brokerage accounts.
This lab takes you through the full operational lifecycle of the **Ghostfolio on
GKE Autopilot** module on Google Cloud: deploy it, access and verify it, run it
day-to-day, observe it, diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**, not
on Ghostfolio product features. For the complete list of provisioned services and
every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Ghostfolio_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running workload, including its combined DB+Redis health check.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Observe the workload with Cloud Logging and Cloud Monitoring.
- Diagnose and resolve the most common deployment and runtime issues.
- Tear the deployment down cleanly.

## Prerequisites

- **Services_GCP deployed** in the target project (provides the GKE Autopilot
  cluster, VPC, Cloud SQL, Artifact Registry, and shared service accounts this
  module depends on).
- A Google Cloud project with **billing enabled**.
- **gcloud CLI** authenticated: `gcloud auth login` and `gcloud auth application-default login`.
- **Project Owner** (or equivalent) IAM on the project.
- **RAD platform access** with permission to deploy modules into the project.

Set these shell variables once; every task below reuses them:

```bash
export PROJECT="<your-gcp-project-id>"
export REGION="us-central1"          # the region you deploy into
export NAMESPACE="<deployment-namespace>"   # from the deployment outputs

gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Ghostfolio (GKE)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Ghostfolio_GKE)
   documents every input by group, with defaults. Note that `enable_redis`
   defaults to `true` and is REQUIRED — do not disable it. Review the estimated
   cost (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform provisions the GKE Deployment + Service, a Cloud SQL
   (PostgreSQL 15) database with its Secret Manager secrets
   (`ACCESS_TOKEN_SALT`, `JWT_SECRET_KEY`, and the database password), builds the
   container image, and runs a one-shot database-initialisation Job. First
   deploys take roughly **20–35 minutes** (Cloud SQL creation dominates).

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   kubectl get deployment -n "$NAMESPACE" | grep -i ghostfolio
   kubectl get svc -n "$NAMESPACE" | grep -i ghostfolio
   SERVICE_IP=$(kubectl get svc -n "$NAMESPACE" -l app=ghostfolio \
     -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
   echo "Service IP: $SERVICE_IP"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the pod is healthy and connected to BOTH its database AND Redis.
   Ghostfolio's health endpoint checks both dependencies and returns 503 until
   both are reachable:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' "http://$SERVICE_IP/api/v1/health"   # expect 200
   curl -s "http://$SERVICE_IP/api/v1/health"                                    # expect {"status":"OK"}
   kubectl get pods -n "$NAMESPACE" -l app=ghostfolio   # expect N/N Running, 0 restarts
   ```

2. Open `http://$SERVICE_IP` (or your configured custom domain) in a browser.
   Ghostfolio has **no email/password login form** — click **Get Started** and
   the app mints a random anonymous "Security Token" as your account owner
   credential. Save this token; it is your only credential for this account.

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload and its rollout history:**

   ```bash
   kubectl describe deployment <deployment-name> -n "$NAMESPACE"
   kubectl rollout history deployment/<deployment-name> -n "$NAMESPACE"
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the Deployment spec, so scaling
   is a configuration change, not a manual `kubectl scale` (a manual scale would
   be reverted on the next apply, though `kubectl scale --replicas=0` is the
   documented way to temporarily park a verified deployment).

3. **Update the application version tag** by changing the version input in the
   RAD platform and applying it via **Update**; a new image builds and the
   Deployment rolls out.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~ghostfolio"
   kubectl get jobs -n "$NAMESPACE"   # init jobs
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=ghostfolio --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   kubectl logs -n "$NAMESPACE" -l app=ghostfolio --tail=100
   ```

   Logs Explorer filter:
   `resource.type="k8s_container" AND resource.labels.namespace_name="<namespace>"`.

2. **Monitoring** — review pod CPU/memory utilisation and restart counts. The
   module can provision an **uptime check** (when
   `uptime_check_config.enabled = true` — it defaults to `false`); if enabled,
   confirm it is green under Monitoring → Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Ghostfolio releases.

- **Pod not Ready / crash-looping:** inspect pod events and logs for startup
  errors. The startup probe targets `/api/v1/health`, which fails until BOTH the
  database AND Redis are reachable — a 503 here often means Redis is not yet
  reachable, not a database problem.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app=ghostfolio
  kubectl logs -n "$NAMESPACE" -l app=ghostfolio --previous
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`
  and the cloud-sql-proxy sidecar is running in the pod
  (`kubectl get pod <pod> -o jsonpath='{.spec.containers[*].name}'`). On GKE,
  Ghostfolio's cloud entrypoint expects `DB_IP` to resolve to `127.0.0.1`
  (the proxy loopback) with `sslmode=disable`.
- **Redis connection errors:** if `redis_host` was left empty, confirm the
  platform NFS server VM is `RUNNING`; otherwise `REDIS_HOST` is empty and the
  health check never passes.
- **Initialisation Job failed:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```
- **Image build failed:** review Cloud Build history for the failed build's log.
- **Unreachable from a browser:** confirm `service_type = "LoadBalancer"` (the
  default) and that an external IP has been assigned
  (`kubectl get svc -n "$NAMESPACE"`).

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `ACCESS_TOKEN_SALT` after
first boot).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the deployment
record is retained for history). If a deployment is stuck and the RAD platform
can no longer manage it (for example after manual changes that conflict with the
Terraform state), use **Purge** instead — it removes the deployment from RAD's
records **without** destroying the cloud resources (it makes RAD forget the
project). Delete removes everything the module created — the GKE Deployment and
Service, Cloud SQL database, Secret Manager secrets, and Artifact Registry images.
Resources owned by **Services_GCP** (the GKE cluster, VPC, shared Cloud SQL,
registry, NFS Redis host) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions GKE Deployment/Service, Cloud SQL (PostgreSQL 15), secrets, and runs DB init |
| 2 — Access & verify | Manual | Health check passes (DB + Redis); mint an anonymous Security Token via "Get Started" |
| 3 — Operate | Manual | Inspect rollout, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, Redis, init-job, build, and networking issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
