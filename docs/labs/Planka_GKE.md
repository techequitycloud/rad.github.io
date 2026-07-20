---
title: "Planka on GKE Autopilot \u2014 Lab Guide"
description: "Hands-on lab: deploy Planka on GKE Autopilot in your own Google Cloud project — guided setup, verification, operations, observability, and teardown."
---

# Planka on GKE Autopilot — Lab Guide

📖 **[Configuration Guide](https://docs.radmodules.dev/docs/modules/Planka_GKE)**

## Overview

**Estimated time:** 30–60 minutes

Planka is an open-source, self-hosted, Trello-like kanban board application
for team and personal project management. This lab takes you through the full
operational lifecycle of the **Planka on GKE Autopilot** module on Google
Cloud: deploy it, access and verify it, run it day-to-day, observe it,
diagnose common problems, and tear it down.

The lab focuses on operating the **GKE module and the Google Cloud platform**,
not on Planka product features. For the complete list of provisioned services
and every configuration input (organised by group), see the
[Configuration Guide](https://docs.radmodules.dev/docs/modules/Planka_GKE) —
this lab deliberately does not duplicate that detail so it stays accurate over time.

## Objectives

By the end of this lab you will be able to:

- Deploy the module from the RAD platform and locate the resources it provisions.
- Access and verify the running workload, and log in with the generated admin credential.
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

1. In the RAD platform, open **Planka (GKE)**, set `project_id`, and review
   the inputs. Configure only what you need — the
   [Configuration Guide](https://docs.radmodules.dev/docs/modules/Planka_GKE)
   documents every input by group, with defaults. Review the estimated cost
   (if credits are enabled) and click **Deploy**, which opens the deployment
   status page with real-time logs.

2. The platform builds the custom Planka image (thin wrapper `FROM
   ghcr.io/plankanban/planka`), provisions the Kubernetes workload, a Cloud
   SQL (PostgreSQL) database with its Secret Manager password secret, the
   `SECRET_KEY` and `DEFAULT_ADMIN_PASSWORD` secrets, a `storage` GCS bucket,
   and runs a one-shot database-initialisation Job. First deploys take
   roughly **15–25 minutes**.

3. When it completes, discover the resources with name-agnostic filters:

   ```bash
   SERVICE=$(kubectl get svc -n "$NAMESPACE" -o name | grep planka | head -1 | cut -d/ -f2)
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

2. Retrieve the generated admin password — unlike a fixed, publicly-known
   default credential, Planka's `DEFAULT_ADMIN_PASSWORD` is a real,
   per-deployment generated secret:

   ```bash
   PASSWORD_SECRET=$(gcloud secrets list --project="$PROJECT" \
     --filter="name~planka AND name~default-admin-password" \
     --format="value(name)" | head -1)
   gcloud secrets versions access latest --secret="$PASSWORD_SECRET" --project="$PROJECT"
   ```

3. Open `http://$EXTERNAL_IP/` in a browser and log in with
   `admin@example.com` and the password retrieved above. **Planka does not
   force a password reset on first login** — change the password immediately
   via Planka's own account settings. Then create a board, list, and card to
   confirm the database write path.

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
   flow — this re-triggers the custom image build with the new
   `PLANKA_VERSION` build ARG.

4. **Manage secrets and backups:**

   ```bash
   gcloud secrets list --project="$PROJECT" --filter="name~planka"
   kubectl get jobs -n "$NAMESPACE"
   ```

5. **Open a database session** for inspection or maintenance:

   ```bash
   INSTANCE=$(gcloud sql instances list --project="$PROJECT" --format="value(name)" --limit=1)
   gcloud sql connect "$INSTANCE" --user=planka --project="$PROJECT"
   ```

---

## Task 4 — Observe: Logging & Monitoring [Manual]

1. **Logs:**

   ```bash
   kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=100
   ```

   Look for the `[cloud-entrypoint]` line — it reports which `DATABASE_URL`
   connection mode the entrypoint resolved and the derived `BASE_URL`.

2. **Monitoring** — open the GKE Workloads dashboard for the deployment and
   review CPU/memory utilisation and replica count.

---

## Task 5 — Troubleshoot & debug [Manual]

- **Pod unhealthy / CrashLoopBackOff:** inspect pod events and logs. If the
  pod never becomes Ready, check the startup probe's configured path —
  Planka's own healthcheck target is the root path `/`, but this module's
  `startup_probe`/`liveness_probe` variables currently default to
  `/api/status`. If probes are failing, override the path to `/` and
  redeploy.
  ```bash
  kubectl describe pod -n "$NAMESPACE" -l app="$SERVICE"
  kubectl logs -n "$NAMESPACE" deploy/"$SERVICE" --tail=200
  ```
- **Database connection errors:** confirm the Cloud SQL instance is
  `RUNNABLE` and check the container logs for the `[cloud-entrypoint]` line —
  on GKE it should report the loopback (`127.0.0.1`) connection mode via the
  cloud-sql-proxy sidecar.
- **Initialisation Job failed:**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```
- **Can't log in with the admin credential:** `DEFAULT_ADMIN_PASSWORD` only
  seeds the account on the *first* (empty-database) boot — if the database
  was already initialised, or the password was already changed, the original
  seeded value no longer works; use Planka's own password-recovery flow
  instead.
- **Attachment links / emails point at an unreachable address:** confirm
  `reserve_static_ip = true` (the module default) — without it, `BASE_URL`
  can fall back to unreachable internal `*.svc.cluster.local` DNS.
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
| 1 — Deploy | Automated | Module builds the custom image and provisions the GKE workload, Cloud SQL (PostgreSQL), secrets, a GCS bucket, and runs DB init |
| 2 — Access & verify | Manual | Pod Ready 0 restarts; log in with the generated admin credential and create a board |
| 3 — Operate | Manual | Inspect rollout, scale, update version, manage secrets/backups, DB access |
| 4 — Observe | Manual | Query Cloud Logging; review Cloud Monitoring metrics |
| 5 — Troubleshoot | Manual | Diagnose pod, database, init-job, and IAM issues |
| 6 — Tear down | Automated | Delete (Trash) removes all module resources |
