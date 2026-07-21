---
title: "Infisical on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Infisical on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Infisical on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Infisical_GKE)**

## Overview

**Estimated time:** 45–75 minutes

Infisical is an open-source, end-to-end encrypted secrets management platform:
teams and CI/CD pipelines store, inject, and rotate application secrets from a
single platform. This lab takes you through the full operational lifecycle of the
**Infisical on GKE Autopilot** module on Google Cloud: deploy it, access and
verify it, run it day-to-day, observe it, diagnose common problems, and tear it
down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Infisical product features. For the complete list of provisioned services
and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Infisical_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over
time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running service, and bootstrap the first admin account.
- Perform day-2 operations — inspect, scale, update, and manage secrets and backups.
- Observe the service with Cloud Logging and Cloud Monitoring.
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
```

---

## Task 1 — Deploy the module [Automated]

1. In the RAD platform, open **Infisical (GKE)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Infisical_GKE)
   documents every input by group, with defaults. Review the estimated cost (if
   credits are enabled) and click **Deploy**, which opens the deployment status
   page with real-time logs.

2. The platform provisions the GKE workload (a stateless `Deployment` behind a
   `LoadBalancer` Service with a reserved static IP), a Cloud SQL (PostgreSQL 15)
   database, its Secret Manager secrets (`ENCRYPTION_KEY`, `AUTH_SECRET`,
   `ADMIN_PASSWORD`, and the database password), builds the custom container
   image, and runs the `db-init` job. First deploys take roughly **20–35
   minutes** (Cloud SQL creation, the custom image build, and the external IP
   reservation dominate).

3. When it completes, get cluster credentials and discover the resources:

   ```bash
   CLUSTER=$(gcloud container clusters list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud container clusters get-credentials "$CLUSTER" --region="$REGION" --project="$PROJECT"

   NAMESPACE=$(kubectl get ns -o name | grep infisical | sed 's|namespace/||' | head -1)
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep infisical | sed 's|service/||' | head -1)
   EXTERNAL_IP=$(kubectl get svc "$SERVICE" -n "$NAMESPACE" \
     -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
   echo "Namespace: $NAMESPACE"
   echo "Service:   $SERVICE"
   echo "External IP: $EXTERNAL_IP"
   ```

---

## Task 2 — Access & verify [Manual]

1. Confirm the service is healthy and connected to its database. Infisical
   exposes an unauthenticated status endpoint:

   ```bash
   curl -s "http://$EXTERNAL_IP/api/status"   # expect HTTP 200 with a JSON body
   ```

2. **Set `site_url` before the admin account can be bootstrapped.** Unlike the
   Cloud Run variant, GKE does not auto-compute a predicted URL — the
   `admin-bootstrap` job targets `site_url` verbatim, and if it was left empty at
   first deploy it defaults to an unreachable `http://localhost:8080` inside the
   job's own pod. Now that the external IP is known, set `site_url =
   "http://<EXTERNAL_IP>"` (or your custom domain) on the deployment and apply
   **Update**. The `admin-bootstrap` job's pod retries automatically (up to 20
   attempts, 15 seconds apart) once the target is reachable — no separate manual
   trigger is needed on GKE.

3. Retrieve the generated admin password and log in at `http://$EXTERNAL_IP`:

   ```bash
   gcloud secrets versions access latest \
     --secret="$(gcloud secrets list --project="$PROJECT" \
       --filter="name~infisical-admin-password" --format='value(name)')" \
     --project="$PROJECT"
   ```

   The admin email is the module's `admin_email` input (default
   `admin@techequity.cloud`). If the account still doesn't exist, check the
   job's pod logs (Task 5).

---

## Task 3 — Operate & keep it running (Day-2) [Manual]

1. **Inspect the workload and its pods:**

   ```bash
   kubectl get pods,svc,hpa -n "$NAMESPACE"
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
   ```

2. **Scale** by changing the min/max instance inputs and clicking **Update** on
   the deployment details page — the module owns the workload spec, so scaling is
   a configuration change, not a manual `kubectl` edit.

3. **Update the application version tag** by changing `application_version` in
   the RAD platform and applying it via **Update**; a new image builds and a new
   rollout begins. `"latest"` maps to a pinned known-good release as the
   Dockerfile build arg.

4. **Manage secrets and jobs:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~infisical"
   kubectl get jobs -n "$NAMESPACE"   # db-init + admin-bootstrap
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=infisical --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs** — from the CLI or the Logs Explorer:

   ```bash
   gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
     --project="$PROJECT" --limit 50
   ```

2. **Monitoring** — review GKE workload metrics (CPU/memory utilisation, HPA
   scaling) and Cloud SQL metrics. The module can provision an **uptime check**
   via `uptime_check_config`; if enabled, confirm it is green under Monitoring →
   Uptime checks.

---

## Task 5 — Troubleshoot & debug [Manual]

Durable techniques for the failure modes you are most likely to hit. These are
platform-level diagnostics and do not change with Infisical releases.

- **Pod not Ready / CrashLoopBackOff:** the startup and liveness probes target
  HTTP `/api/status`, which only returns 2xx once the database (and Redis, if
  enabled) connections are healthy — allow the default generous delay/threshold
  on first boot.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app=infisical
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=200
  ```
- **Database connection errors:** confirm the Cloud SQL instance is `RUNNABLE`,
  the DB password secret exists, and the `db-init` job completed. Confirm the
  Cloud SQL Auth Proxy sidecar container is running (`enable_cloudsql_volume =
  true`).
- **`admin-bootstrap` never creates an account:** check the job's pod logs — the
  most common cause is `site_url` left empty or pointing at an unreachable
  address (see Task 2).
  ```bash
  kubectl logs -n "$NAMESPACE" job/"${SERVICE}-admin-bootstrap"
  ```
- **`REDIS_URL` / `REDIS_SENTINEL_HOSTS` / `REDIS_CLUSTER_HOSTS` must be defined
  crash on boot:** confirm `enable_redis` was forwarded correctly and, if
  `redis_auth` is set, that the Redis secret propagated.
- **Image build failed:** review Cloud Build history for the failed build's log.
- **IAM / Workload Identity errors:** verify the workload service account's IAM
  roles and Workload Identity binding.

See the Configuration Guide's *Configuration Pitfalls* section for setting-specific
gotchas (including the critical rule never to rotate `ENCRYPTION_KEY` after first
boot, and the `site_url` requirement above).

---

## Task 6 — Tear down [Automated]

On the **Deployments** page, open the deployment and click the **Trash** icon
(**Delete**). Delete runs `terraform destroy` and is irreversible (the
deployment record is retained for history). If a deployment is stuck and the RAD
platform can no longer manage it (for example after manual changes that conflict
with the Terraform state), use **Purge** instead — it removes the deployment from
RAD's records **without** destroying the cloud resources (it makes RAD forget the
project). Delete removes everything the module created — the GKE workload and
Service, the reserved static IP, Cloud SQL database, and Secret Manager secrets.
Resources owned by **Services_GCP** (the VPC, GKE cluster, shared Cloud SQL,
registry) are managed separately and are not removed here.

---

## Summary

| Task | Type | Outcome |
|---|---|---|
| 1 — Deploy | Automated | Module provisions the GKE workload, Cloud SQL (PostgreSQL 15), secrets, builds the custom image, and runs `db-init` |
| 2 — Access & verify | Manual | Health check passes; set `site_url` to the external IP so `admin-bootstrap` can succeed, then log in with the generated admin password |
| 3 — Operate | Manual | Inspect pods, scale, update version, manage secrets/jobs, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review GKE/Cloud SQL metrics and uptime check |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, build, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
